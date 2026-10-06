"""Pixel Workbenchの抽出部品から方向別の歩行・採取・回避ポーズを組む。"""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[3]
GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'Image/PixelWorkbench'))
from engine import Editor, extract, load
from pixelwork import export, save

base = load(GAME / 'art/hero.json')
lines = ['canvas 32 48', 'pivot 16 40']
lines.extend(f'palette {symbol} {color}' for symbol, color in base['palette'].items() if symbol != '.')
names = []
for direction in ('down', 'up', 'left', 'right'):
    original = f'hero_{direction}_idle0'
    boxes = {'head': (0, 0, 32, 16), 'body': (13, 16, 10, 13),
             'armL': (0, 16, 13, 13), 'armR': (23, 16, 9, 13),
             'legL': (0, 29, 17, 11), 'legR': (17, 29, 15, 11)}
    for part, box in boxes.items():
        name = f'{direction}_{part}'
        sliced = extract(base, original, name, box)['parts'][name]
        lines.append(f'part {name} {box[2]} {box[3]}')
        lines.extend(f'row {y} 0 {row}' for y, row in enumerate(sliced['rows']))
    for mode, count in [('idle', 2), ('walk', 4), ('attack', 3), ('roll', 3)]:
        for n in range(count):
            name = f'hero_{direction}_{mode}{n}'
            names.append(name)
            lines.extend((f'frame {name} {150 if mode == "idle" else 100}', f'tag {direction}_{mode}'))
            positions = {p: [b[0], b[1]] for p, b in boxes.items()}
            if mode == 'walk':
                stride = (0, 2, 0, -2)[n]
                positions['legL'][1] += stride
                positions['legR'][1] -= stride
                positions['armL'][1] -= stride // 2
                positions['armR'][1] += stride // 2
                if direction in ('left', 'right'):
                    positions['legL'][0] += stride
                    positions['legR'][0] -= stride
                positions['head'][1] += (0, -1, 0, -1)[n]
                positions['body'][1] += (0, -1, 0, -1)[n]
            elif mode == 'idle' and n == 1:
                positions['head'][1] -= 1
                positions['armL'][1] -= 1
                positions['armR'][1] -= 1
            elif mode == 'attack':
                side = -1 if direction == 'left' else 1
                positions['armR'][0] += side * (0, 3, 1)[n]
                positions['armR'][1] += (-3, -1, 0)[n]
                positions['head'][0] += side * (0, 1, 0)[n]
                positions['body'][0] += side * (0, 1, 0)[n]
                positions['legR'][0] += side * (0, 1, 0)[n]
            elif mode == 'roll':
                positions['head'][1] += (2, 5, 2)[n]
                positions['body'][1] += (1, 2, 1)[n]
                positions['armL'][0] += 1
                positions['armR'][0] -= 1
                positions['legL'][1] -= (0, 2, 0)[n]
                positions['legR'][1] -= (0, 2, 0)[n]
            for part, (x, y) in positions.items():
                lines.append(f'place {part} {direction}_{part} {x} {y}')
recipe = GAME / 'art/hero-animated.dot'
recipe.write_text('\n'.join(lines) + '\n', encoding='utf-8')
project = Editor().apply(recipe.read_text(encoding='utf-8'))
save(project, GAME / 'art/hero-animated.json')
print(json.dumps(export(project, GAME / 'assets/hero', columns=6), ensure_ascii=True))
manifest_path = GAME / 'assets/manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['sheets']['hero']['names'] = names
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
