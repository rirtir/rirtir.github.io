"""小物は元の部品から目的の原寸へWorkbenchで変換する。"""
from assemble import GAME, load, header, part, finish
from engine import extract, import_image, render
from pixelwork import save

source = load(GAME / 'art/furniture.json')
temporary = GAME / '.review' / 'workbench'
temporary.mkdir(parents=True, exist_ok=True)
lines = header((48, 64), (24, 52))
sizes = {'chest': (30, 30), 'chair': (24, 24), 'barrel': (28, 28), 'torch_small': (22, 22),
         'lantern': (28, 28), 'bed': (36, 48), 'pot': (36, 36), 'sign': (30, 30), 'campfire': (32, 32),
         'log': (34, 28), 'stump': (32, 32)}
for name, size in sizes.items():
    original = 'torch' if name == 'torch_small' else name
    frame = next(f for f in source['frames'] if f['name'] == original)
    # 切り出し→描き出し→原寸インポートの全工程を指定ツールで行う。
    isolated = extract(source, original, 'isolated', (28, 40, 40, 40))
    isolated['frames'] = [{'name': 'sprite', 'duration': 140, 'layers': [{'id': 'sprite', 'part': 'isolated', 'x': 0, 'y': 0}]}]
    isolated['size'] = [40, 40]
    isolated['pivot'] = [20, 40]
    image_path = temporary / f'{name}.png'
    render(isolated, isolated['frames'][0])[0].save(image_path)
    scaled = import_image(image_path, size=size, palette=source['palette'])
    rows = next(iter(scaled['parts'].values()))['rows']
    part(lines, name, rows)
    lines.extend((f'frame {name} 140', 'tag native', f'place sprite {name} {(48-size[0])//2} {52-size[1]}'))

details = load(GAME / 'art/details.json')['parts']
for name, original in [('branch_small', 'branch'), ('pebble_small', 'pebble'), ('grass_small', 'grass'),
                        ('mushroom', 'mushroom_small')]:
    rows = details[original]['rows']
    part(lines, name, rows)
    lines.extend((f'frame {name} 140', 'tag native', f'place sprite {name} 14 32'))
finish('small', lines, (24, 52), 'props')
