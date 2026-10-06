"""灯の状態差分と、切り出し境界で混ざった小物を原寸で補正する。"""
from assemble import GAME, load, header, part, finish
from engine import extract, render, import_image
from import_assets import clean_islands

lines = header((96,96),(48,80))


def sprite(name, rows):
    width, height = len(rows[0]), len(rows)
    part(lines, name, rows)
    lines.extend((f'frame {name} 140','tag accent',f'place sprite {name} {(96-width)//2} {80-height}'))


landmarks = load(GAME/'art/landmarks.json')
rows = landmarks['parts']['beacon']['rows']
sprite('beacon_lit', [''.join({'h':'i','i':'j','j':'k','k':'l'}.get(p,p) for p in row) for row in rows])
decor = load(GAME/'art/decor.json')
clay = decor['parts']['clay_small']['rows']
sprite('clay_small', clean_islands(clay[:33] + ['.'*40]*7, 5))
cart = decor['parts']['handcart']['rows']
sprite('handcart', clean_islands(cart[:36] + ['.'*40]*4, 5))
# 噴水の上端は等間隔セルの4px上にある。原画全体から位置を変えて切り出す。
source = load(GAME/'art/decor-import.json')
isolated = extract(source,'frame0','well',(80,115,40,45))
isolated['size'] = [40,45]
isolated['pivot'] = [20,45]
isolated['frames'] = [{'name':'sprite','duration':140,'layers':[{'id':'sprite','part':'well','x':0,'y':0}]}]
temporary = GAME/'.review/workbench/fountain.png'
temporary.parent.mkdir(parents=True,exist_ok=True)
render(isolated,isolated['frames'][0])[0].save(temporary)
corrected = import_image(temporary,size=(40,40),palette=decor['palette'])
sprite('well',clean_islands(next(iter(corrected['parts'].values()))['rows'],3))
finish('accents',lines,(48,80),'props')
