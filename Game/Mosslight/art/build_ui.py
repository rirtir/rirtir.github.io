"""Workbenchのドット文字と9分割用ピクセル枠。ぼかしやWeb風の角丸を使わない。"""
from pathlib import Path
import json
import random
import sys
ROOT=Path(__file__).resolve().parents[3]
GAME=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'Image/PixelWorkbench'))
from engine import Editor, load, render
from pixelwork import export, save
palette=load(GAME/'art/props.json')['palette']

def finish(sheet,lines,pivot):
    recipe=GAME/'art'/f'{sheet}.dot'
    recipe.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    project=Editor().apply(recipe.read_text(encoding='utf-8'))
    save(project,GAME/'art'/f'{sheet}.json')
    destination=GAME/'assets'/sheet
    export(project,destination)
    for frame in project['frames']: render(project,frame)[0].save(destination/f'{frame["name"]}.png')
    path=GAME/'assets/manifest.json'
    manifest=json.loads(path.read_text(encoding='utf-8'))
    manifest['sheets'][sheet]={'image':f'{sheet}/atlas.png','atlas':f'{sheet}/atlas.json','pivot':pivot,'names':[f['name'] for f in project['frames']]}
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

lines=['canvas 24 24','pivot 0 0']+[f'palette {k} {v}' for k,v in palette.items() if k!='.']
for name,edge,highlight,fill in [('panel','H','J','1'),('button','H','K','1'),('selected','n','q','G'),('disabled','2','3','1'),('hotbar','H','J','0')]:
    lines += [f'part {name} 24 24', 'rect 2 0 20 24 0','rect 0 2 24 20 0',
              f'rect 2 1 20 22 {edge}',f'rect 1 2 22 20 {edge}',f'rect 3 2 18 20 {highlight}',
              f'rect 2 3 20 18 {highlight}',f'rect 3 4 18 17 {fill}',f'rect 4 3 16 18 {fill}',
              f'pixel 2 2 {highlight}',f'pixel 21 2 {highlight}',f'pixel 2 21 {edge}',f'pixel 21 21 {edge}',
              f'frame {name} 140','tag ui',f'place sprite {name} 0 0']
finish('ui',lines,[0,0])

glyphs={
 'M':['10001','11011','10101','10101','10001','10001','10001'],
 'O':['01110','10001','10001','10001','10001','10001','01110'],
 'S':['01111','10000','10000','01110','00001','00001','11110'],
 'L':['10000','10000','10000','10000','10000','10000','11111'],
 'I':['11111','00100','00100','00100','00100','00100','11111'],
 'G':['01110','10001','10000','10111','10001','10001','01110'],
 'H':['10001','10001','10001','11111','10001','10001','10001'],
 'T':['11111','00100','00100','00100','00100','00100','00100'],
}
lines=['canvas 240 56','pivot 0 0']+[f'palette {k} {v}' for k,v in palette.items() if k!='.']+['part logo 240 56']
for i,char in enumerate('MOSSLIGHT'):
    for y,row in enumerate(glyphs[char]):
        for x,bit in enumerate(row):
            if bit=='1':
                px=12+i*24+x*4; py=12+y*4
                color=('q','M','L','8','7','6','5')[y]
                lines.extend((f'rect {px+2} {py+3} 4 4 0',f'rect {px} {py} 4 4 {color}'))
                if y==0: lines.append(f'rect {px} {py} 4 1 q')
rng=random.Random(349)
for i in range(35):
    x=rng.randrange(12,221); y=rng.choice([8,9,40,41,42])
    lines.append(f'rect {x} {y} {rng.choice([1,2,3])} 2 {rng.choice(["4","5","6","7"])}')
lines += ['part lantern 8 16','rect 3 0 2 3 J','rect 1 3 6 9 H','rect 2 4 4 7 n','rect 3 5 2 5 q','rect 0 12 8 2 H',
          'frame logo 140','tag title','place sprite logo 0 0','place light lantern 223 19']
finish('logo',lines,[0,0])
print('Workbench UI 5 frames, logo 240x56')
