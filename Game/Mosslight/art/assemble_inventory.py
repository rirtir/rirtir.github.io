"""設備のアイコンはゲームに使う原画から作り、画面間で形を統一する。"""
from assemble import GAME, load, header, part, finish
from engine import extract, render, import_image
import json

lines = header((24,24),(12,12))
mapping = {'workbench':'workbench','furnace':'furnace','chest':'chest','bed':'bed',
           'well':'well','fence':'fence','gate':'gate','wall':'timber_wall10','floor':'timber_floor0',
           'path':'ruin0','bridge':'bridge','carpet':'carpet'}
manifest = json.loads((GAME/'assets/manifest.json').read_text(encoding='utf-8'))
sources = {}
for sheet, definition in manifest['sheets'].items():
    if definition.get('overrides') not in ('props','tiles') and sheet not in ('props','tiles'):
        continue
    project = load(GAME/'art'/f'{sheet}.json')
    for frame in project['frames']:
        sources[frame['name']] = (project,frame)
temporary = GAME/'.review/workbench'
temporary.mkdir(parents=True,exist_ok=True)
for name, original in mapping.items():
    project, frame = sources[original]
    bounds = render(project,frame)[0].getbbox()
    x,y,right,bottom = bounds
    width, height = right-x, bottom-y
    isolated = extract(project,original,'item',(x,y,width,height))
    isolated['size']=[width,height]; isolated['pivot']=[0,0]
    isolated['frames']=[{'name':'sprite','duration':140,'layers':[{'id':'sprite','part':'item','x':0,'y':0}]}]
    image = temporary/f'icon-{name}.png'
    render(isolated,isolated['frames'][0])[0].save(image)
    factor = 20/max(width,height)
    size = [max(1,round(width*factor)),max(1,round(height*factor))]
    imported = import_image(image,size=size,palette=project['palette'])
    rows = next(iter(imported['parts'].values()))['rows']
    part(lines,name,rows)
    lines.extend((f'frame {name} 140','tag inventory',f'place sprite {name} {(24-size[0])//2} {(24-size[1])//2}'))
finish('furniture_icons',lines,(12,12),'icons')
