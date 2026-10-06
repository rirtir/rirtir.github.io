"""64pxの連続原画を32pxのタイルへ分ける。減色と切り出しはWorkbenchで行う。"""
from pathlib import Path
import json
import sys
ROOT = Path(__file__).resolve().parents[3]
GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'Image/PixelWorkbench'))
from engine import Editor, extract, import_image, load
from pixelwork import export, save

source = import_image(GAME/'art/masters/ground.png', size=(128, 128), palette=load(GAME/'art/props.json')['palette'])
save(source, GAME/'art/ground-import.json')
lines = ['canvas 32 32', 'pivot 0 0']
lines.extend(f'palette {key} {color}' for key, color in source['palette'].items() if key != '.')
names = []
def ground_symbol(symbol, material):
    if symbol == '.':
        return symbol
    color = source['palette'][symbol].lstrip('#')
    r, g, b = [int(color[i:i+2], 16) for i in (0, 2, 4)]
    light = .2126*r + .7152*g + .0722*b
    # 草地の茶色の斑点と白い砂粒を抑え、細部は樹木・小物に持たせる。
    if material == 'grass':
        return '3' if light < 56 else '4' if light < 108 else '5'
    if material in ('darkgrass', 'moss'):
        return '2' if light < 54 else '3' if light < 102 else '4'
    if material in ('dirt', 'path'):
        return 'H' if light < 76 else 'I' if light < 160 else 'J'
    if material == 'cave':
        return '9' if light < 56 else 'N' if light < 130 else 'O'
    return symbol
for material, origin in [('grass',(0,0)), ('darkgrass',(64,0)), ('dirt',(0,64)), ('path',(0,64)), ('cave',(64,64)), ('moss',(64,64))]:
    for i in range(4):
        name = f'{material}{i}'
        part = extract(source, 'frame0', name, (origin[0]+(i%2)*32, origin[1]+(i//2)*32, 32,32))['parts'][name]
        lines.append(f'part {name} 32 32')
        lines.extend(f'row {y} 0 {"".join(ground_symbol(p, material) for p in row)}' for y,row in enumerate(part['rows']))
        lines.extend((f'frame {name} 140', 'tag ground', f'place sprite {name} 0 0'))
        names.append(name)
recipe = GAME/'art/ground.dot'
recipe.write_text('\n'.join(lines)+'\n', encoding='utf-8')
project = Editor().apply(recipe.read_text(encoding='utf-8'))
save(project, GAME/'art/ground.json')
print(json.dumps(export(project, GAME/'assets/ground', columns=4),ensure_ascii=True))
path = GAME/'assets/manifest.json'
manifest = json.loads(path.read_text(encoding='utf-8'))
manifest['sheets']['ground'] = {'image':'ground/atlas.png','atlas':'ground/atlas.json','pivot':[0,0],'names':names,'overrides':'tiles'}
path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
