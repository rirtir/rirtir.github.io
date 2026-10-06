"""Pixel Workbench の部品を組み、共通パレットのゲーム用アトラスを出力する。"""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[3]
GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'Image/PixelWorkbench'))
from engine import Editor, load
from pixelwork import export, save


def header(size, pivot):
    return [f'canvas {size[0]} {size[1]}', f'pivot {pivot[0]} {pivot[1]}'] + [
        f'palette {k} {v}' for k, v in load(GAME / 'art/props.json')['palette'].items() if k != '.'
    ]


def part(lines, name, rows):
    lines.append(f'part {name} {len(rows[0])} {len(rows)}')
    lines.extend(f'row {y} 0 {pixels}' for y, pixels in enumerate(rows))


def finish(sheet, lines, pivot, target):
    recipe = GAME / 'art' / f'{sheet}.dot'
    recipe.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    project = Editor().apply(recipe.read_text(encoding='utf-8'))
    save(project, GAME / 'art' / f'{sheet}.json')
    report = export(project, GAME / 'assets' / sheet, columns=8)
    path = GAME / 'assets/manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    manifest['sheets'][sheet] = {
        'image': f'{sheet}/atlas.png', 'atlas': f'{sheet}/atlas.json', 'pivot': list(pivot),
        'names': [f['name'] for f in project['frames']], 'overrides': target,
    }
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{sheet}: {report["frames"]} frames; {len(report["warnings"])} warnings')
    return project
