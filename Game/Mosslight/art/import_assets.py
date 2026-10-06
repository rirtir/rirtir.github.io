"""原画をPixel Workbenchで減色・部品化し、ゲーム用の名前付きアトラスへ変換する。"""
from pathlib import Path
import argparse
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'Image/PixelWorkbench'))
from engine import extract, import_image, validate, load, render
from pixelwork import export, save


def clean_islands(rows, minimum):
    """切り出し端に残った細片を、原寸の部品から除く。隣接する本体は保持する。"""
    pixels = [list(row) for row in rows]
    visited = set()
    for y, row in enumerate(pixels):
        for x, value in enumerate(row):
            if value == '.' or (x, y) in visited:
                continue
            pending = [(x, y)]
            group = []
            visited.add((x, y))
            while pending:
                px, py = pending.pop()
                group.append((px, py))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = px+dx, py+dy
                        if 0 <= ny < len(pixels) and 0 <= nx < len(row) and pixels[ny][nx] != '.' and (nx, ny) not in visited:
                            visited.add((nx, ny))
                            pending.append((nx, ny))
            if len(group) < minimum:
                for px, py in group:
                    pixels[py][px] = '.'
    return [''.join(row) for row in pixels]


def build(sheet, master, grid, cell, names, canvas=(96, 96), pivot=(48, 80), colors=64, target='props', row_bounds=None, clean=0):
    """画像処理はWorkbenchのimport/extract/exportを使う。座標・命名のみここで管理する。"""
    cols, rows = grid
    width, height = cell
    if len(names) != cols * rows:
        raise ValueError('セル数とフレーム名の数が一致しません')
    if row_bounds and (len(row_bounds) != rows + 1 or row_bounds[0] != 0 or row_bounds[-1] != 1 or row_bounds != sorted(row_bounds)):
        raise ValueError('行の境界は0から1までの昇順で、行数+1個必要です')
    source = import_image(master, size=(cols * width, rows * height), colors=colors,
                          palette=load(GAME / 'art/props.json')['palette'])
    save(source, GAME / 'art' / f'{sheet}-import.json')
    lines = [f'canvas {canvas[0]} {canvas[1]}', f'pivot {pivot[0]} {pivot[1]}']
    lines.extend(f'palette {symbol} {color}' for symbol, color in source['palette'].items() if symbol != '.')
    for i, name in enumerate(names):
        row = i // cols
        top = round(row_bounds[row] * rows * height) if row_bounds else row * height
        bottom = round(row_bounds[row + 1] * rows * height) if row_bounds else top + height
        box = (i % cols * width, top, width, bottom - top)
        sliced = extract(source, 'frame0', name, box)
        part = sliced['parts'][name]
        if row_bounds:
            # 原画の行間が不均等な場合、隣の生物が混ざらない位置で切って原寸へ揃える。
            sliced['size'] = [width, bottom-top]
            sliced['pivot'] = [width//2, bottom-top]
            sliced['frames'] = [{'name':'sprite','duration':140,'layers':[{'id':'sprite','part':name,'x':0,'y':0}]}]
            temporary = GAME / '.review' / 'workbench'
            temporary.mkdir(parents=True, exist_ok=True)
            path = temporary / f'{sheet}-{name}.png'
            render(sliced, sliced['frames'][0])[0].save(path)
            resized = import_image(path, size=cell, palette=source['palette'])
            part = next(iter(resized['parts'].values()))
        lines.append(f'part {name} {width} {height}')
        pixels = clean_islands(part['rows'], clean) if clean else part['rows']
        lines.extend(f'row {y} 0 {pixels}' for y, pixels in enumerate(pixels))
        lines.extend((f'frame {name} 140', 'tag static', f'place sprite {name} {(canvas[0]-width)//2} {max(0,pivot[1]-height)}'))
    recipe = GAME / 'art' / f'{sheet}.dot'
    recipe.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    from engine import Editor
    project = validate(Editor().apply(recipe.read_text(encoding='utf-8')))
    save(project, GAME / 'art' / f'{sheet}.json')
    report = export(project, GAME / 'assets' / sheet, columns=4)
    manifest_path = GAME / 'assets/manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['sheets'][sheet] = {'image': f'{sheet}/atlas.png', 'atlas': f'{sheet}/atlas.json',
                                'pivot': list(pivot), 'names': names, 'overrides': target}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('sheet')
    parser.add_argument('master', type=Path)
    parser.add_argument('--grid', nargs=2, type=int, default=(2, 2))
    parser.add_argument('--cell', nargs=2, type=int, default=(96, 80))
    parser.add_argument('--names', nargs='+', required=True)
    parser.add_argument('--canvas', nargs=2, type=int, default=(96, 96))
    parser.add_argument('--pivot', nargs=2, type=int, default=(48, 80))
    parser.add_argument('--target', default='props')
    parser.add_argument('--row-bounds', nargs='+', type=float)
    parser.add_argument('--clean-islands', type=int, default=0)
    args = parser.parse_args()
    build(args.sheet, args.master, args.grid, args.cell, args.names, args.canvas, args.pivot, target=args.target, row_bounds=args.row_bounds, clean=args.clean_islands)
