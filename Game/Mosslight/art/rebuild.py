"""保存済み Workbench JSON から配布画像を再出力する。manifest と原画は変更しない。"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

GAME = Path(__file__).resolve().parents[1]
ROOT = GAME.parents[1]
ART = GAME / 'art'
ASSETS = GAME / 'assets'
WORKBENCH = ROOT / 'Image' / 'PixelWorkbench'


def within(base: Path, relative: str) -> Path:
    """manifest の出力先が assets 外へ出ないことを確認する。"""
    path = (base / relative).resolve()
    if not path.is_relative_to(base.resolve()):
        raise ValueError(f'assets 外のパス: {relative}')
    return path


def preflight(load):
    manifest_path = ASSETS / 'manifest.json'
    original = manifest_path.read_bytes()
    manifest = json.loads(original.decode('utf-8'))
    if manifest.get('version') != 1 or manifest.get('tileSize') != 32:
        raise ValueError('未対応の manifest 契約です')
    sheets = manifest.get('sheets')
    if not isinstance(sheets, dict) or not sheets:
        raise ValueError('manifest.sheets が空です')
    jobs, inputs, destinations = [], {}, set()
    for name, definition in sheets.items():
        # 初期 hero アトラスだけ、保存された組立ソース名が異なる。
        source = ART / ('hero-animated.json' if name == 'hero' else f'{name}.json')
        if source.parent.resolve() != ART.resolve():
            raise ValueError(f'不正なシート名: {name}')
        inputs[source] = source.read_bytes()
        project = load(source)
        names = [frame['name'] for frame in project['frames']]
        if names != definition.get('names'):
            raise ValueError(f'{name}: ソースと manifest のフレーム順が不一致')
        if project.get('pivot') != definition.get('pivot'):
            raise ValueError(f'{name}: ソースと manifest の pivot が不一致')
        image_path = within(ASSETS, definition['image'])
        atlas_path = within(ASSETS, definition['atlas'])
        inputs[atlas_path] = atlas_path.read_bytes()
        atlas = json.loads(inputs[atlas_path].decode('utf-8'))
        if list(atlas['frames']) != names:
            raise ValueError(f'{name}: 現在の atlas とソースのフレーム順が不一致')
        width, height = project['size']
        atlas_width = atlas['meta']['size']['w']
        columns, remainder = divmod(atlas_width, width)
        if remainder or not 1 <= columns <= 16:
            raise ValueError(f'{name}: atlas の列数を復元できません')
        for index, frame_name in enumerate(names):
            expected = {'x': index % columns * width, 'y': index // columns * height,
                        'w': width, 'h': height}
            if atlas['frames'][frame_name]['frame'] != expected:
                raise ValueError(f'{name}: 対応外の atlas 配置です ({frame_name})')
        targets = [image_path, atlas_path]
        if name in ('ui', 'logo'):
            targets.extend(within(ASSETS, f'{name}/{frame}.png') for frame in names)
        if any(target in destinations for target in targets):
            raise ValueError(f'{name}: 出力先が他のシートと重複しています')
        destinations.update(targets)
        map_jobs = []
        for kind in ('normal', 'height'):
            if kind not in definition:
                continue
            map_source = ART / 'normalmaps' / f'{name}-{kind}.json'
            inputs[map_source] = map_source.read_bytes()
            map_project = load(map_source)
            if (map_project['size'] != project['size'] or map_project['pivot'] != project['pivot']
                    or [f['name'] for f in map_project['frames']] != names):
                raise ValueError(f'{name}/{kind}: 色画像と法線・高さの配置契約が不一致')
            map_target = within(ASSETS, definition[kind])
            if map_target in destinations:
                raise ValueError(f'{name}/{kind}: 出力先が重複')
            destinations.add(map_target)
            map_jobs.append((kind, map_project, map_target))
        jobs.append((name, project, columns, image_path, atlas_path, atlas, map_jobs))
    return manifest_path, original, jobs, inputs


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true',
                        help='ソース・契約・配置だけを確認し、ファイルを出力しない')
    args = parser.parse_args()
    if not (WORKBENCH / 'pixelwork.py').is_file():
        raise FileNotFoundError('Image/PixelWorkbench が必要です。配布ゲームの起動には不要です。')
    sys.path.insert(0, str(WORKBENCH))
    from engine import load, render
    from pixelwork import export

    manifest_path, original, jobs, inputs = preflight(load)
    if args.check_only:
        print(f'OK: {len(jobs)} シートのソース・フレーム順・pivot・列数。出力なし。')
        return

    # 全シートの書き出しが成功してから配布ファイルを置換する。
    # Workbench のレビュー用 GIF/HTML/contact は一時フォルダにのみ生成する。
    outputs = []
    with tempfile.TemporaryDirectory(prefix='.rebuild-', dir=ASSETS) as temporary:
        staging = Path(temporary)
        for name, project, columns, image_path, atlas_path, old_atlas, map_jobs in jobs:
            destination = staging / name
            report = export(project, destination, columns=columns)
            atlas = json.loads((destination / 'atlas.json').read_text(encoding='utf-8'))
            if atlas != old_atlas:
                raise ValueError(f'{name}: ソースからの出力が既存 atlas メタデータと不一致。置換中止。')
            outputs.extend(((destination / 'atlas.png', image_path),
                            (destination / 'atlas.json', atlas_path)))
            for kind, map_project, map_target in map_jobs:
                map_destination = destination / kind
                map_report = export(map_project, map_destination, columns=columns)
                if map_report['warnings']:
                    raise ValueError(f'{name}/{kind}: {map_report["warnings"]}')
                map_atlas = json.loads((map_destination / 'atlas.json').read_text(encoding='utf-8'))
                if any(map_atlas['frames'][n]['frame'] != old_atlas['frames'][n]['frame']
                       for n in old_atlas['frames']):
                    raise ValueError(f'{name}/{kind}: atlas 配置が色画像と不一致')
                outputs.append((map_destination / 'atlas.png', map_target))
            if name in ('ui', 'logo'):
                for frame in project['frames']:
                    standalone = destination / f'{frame["name"]}.png'
                    render(project, frame)[0].save(standalone)
                    outputs.append((standalone, within(ASSETS, f'{name}/{standalone.name}')))
            print(f'{name}: {report["frames"]} frames, {len(report["warnings"])} warnings')
        if manifest_path.read_bytes() != original:
            raise RuntimeError('再構築中に manifest が変更されました。置換中止。')
        for path, content in inputs.items():
            if path.read_bytes() != content:
                raise RuntimeError(f'再構築中に入力が変更されました: {path.name}。置換中止。')
        for source, target in outputs:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(source, target)
    print(f'OK: {len(jobs)} シートを再出力。manifest の内容と順序は変更していません。')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, RuntimeError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
