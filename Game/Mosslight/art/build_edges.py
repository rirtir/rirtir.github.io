"""Workbenchの原画テクスチャから、四隅の所属で繋がる16通りの境界を作る。"""
from pathlib import Path
import json
import math
import sys
ROOT = Path(__file__).resolve().parents[3]
GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'Image/PixelWorkbench'))
from engine import Editor, load
from pixelwork import export, save

palette = load(GAME/'art/props.json')['palette']
original = load(GAME/'art/tiles.json')
ground = load(GAME/'art/ground.json')
parts = {**original['parts'], **ground['parts']}
if (GAME/'art/quiet_ground.json').exists():
    parts.update(load(GAME/'art/quiet_ground.json')['parts'])
if (GAME/'art/architecture.json').exists():
    architecture = load(GAME/'art/architecture.json')
    parts.update({k: v for k,v in architecture['parts'].items() if k.startswith('water')})
for sheet, materials in [('edges', ['water','sand','dirt','path','grass','darkgrass','moss']), ('caveedges', ['cave','ruin'])]:
    lines = ['canvas 32 32','pivot 0 0']
    lines.extend(f'palette {key} {color}' for key,color in palette.items() if key != '.')
    names=[]
    for material in materials:
        texture=parts[f'{material}0']['rows']
        for mask in range(1,16):
            name=f'edge_{material}_{mask}'
            names.append(name)
            lines.append(f'part {name} 32 32')
            corners=[(mask>>i)&1 for i in range(4)]
            for y in range(32):
                row=''
                for x in range(32):
                    u=x/31; v=y/31
                    value=(corners[0]*(1-u)+corners[1]*u)*(1-v)+(corners[2]*(1-u)+corners[3]*u)*v
                    # 四辺で同じ値になる周期ノイズ。接続点を保ち、三角の反復を作らない。
                    ripple=0.045*math.sin(2*math.pi*u)*math.cos(4*math.pi*v)+0.025*math.cos(4*math.pi*u)*math.sin(2*math.pi*v)
                    value+=ripple
                    pixel=texture[y][x] if value>=0.5 else '.'
                    if material in ('grass','darkgrass','moss') and 0.5<=value<0.535 and mask!=15:
                        pixel='3' if material in ('grass','darkgrass') else '2'
                    elif material=='sand' and 0.5<=value<0.545 and mask!=15:
                        pixel='H'  # 水に落ちる岸の土の側面
                    row+=pixel
                lines.append(f'row {y} 0 {row}')
            lines.extend((f'frame {name} 140','tag edges',f'place sprite {name} 0 0'))
    path=GAME/'art'/f'{sheet}.dot'
    path.write_text('\n'.join(lines)+'\n', encoding='utf-8')
    project=Editor().apply(path.read_text(encoding='utf-8'))
    save(project,GAME/'art'/f'{sheet}.json')
    print(json.dumps(export(project,GAME/'assets'/sheet,columns=15),ensure_ascii=True))
    path=GAME/'assets/manifest.json'
    manifest=json.loads(path.read_text(encoding='utf-8'))
    manifest['sheets'][sheet]={'image':f'{sheet}/atlas.png','atlas':f'{sheet}/atlas.json','pivot':[0,0],'names':names,'overrides':'tiles'}
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
