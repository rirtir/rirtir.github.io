"""自然物の原画をWorkbenchの取り込み・切り出し・固定色で仕上げる。"""
from pathlib import Path
import argparse, subprocess, sys
from style import Canvas, HEX_OF, ramp, finish, build_lines, compose, load, R2_DIR, REVIEW_DIR, WORKBENCH
from engine import import_image
from pixelwork import save
from restyle import merge_isolated

def sprite(source, name, box, dimensions, groups):
    cropped = REVIEW_DIR/f'ai-{name}-crop.png'
    subprocess.run([sys.executable, str(WORKBENCH/'pixelwork.py'), 'inspect', str(source),
                    '--frame','frame0','--crop', *map(str,box), '--image',str(cropped)],
                   check=True, capture_output=True)
    symbols = [ramp(g,i) for g,n in groups for i in range(1,n+1)]
    palette = {'.':'#00000000', **{s:HEX_OF[s] for s in symbols}}
    project = import_image(cropped, size=dimensions, palette=palette)
    cv = Canvas(*dimensions)
    cv.g = [list(row) for row in project['parts']['import0']['rows']]
    merge_isolated(cv.g, budget=0.01)
    return cv

def placed(cv, size, position):
    result = Canvas(*size)
    result.paste(cv,*position)
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image',type=Path)
    args = parser.parse_args()
    raw = import_image(args.image, size=(256,256), colors=64)
    source = REVIEW_DIR/'ai-nature-input.json'
    save(raw, source)
    pine = sprite(source,'pine',(4,6,122,158),(66,84),[('P',3),('G',5),('W',4),('K',1)])
    amber = sprite(source,'amber',(130,18,124,146),(80,84),[('M',3),('G',3),('W',4),('K',2)])
    rock = sprite(source,'rock',(20,174,102,70),(48,32),[('R',5),('G',5),('K',2)])
    berry = sprite(source,'berry',(138,174,108,70),(40,28),[('G',5),('W',3),('T',4),('K',1)])
    oak = compose(load(R2_DIR/'trees.json'),'oak')
    oak2 = Canvas(80,84)
    recolor = {ramp('M',1):ramp('G',3),ramp('M',2):ramp('G',4),ramp('M',3):ramp('G',5)}
    oak2.g = [[recolor.get(c,c) for c in row] for row in amber.g]
    trees = [('oak',oak),('oak2',placed(oak2,(96,96),(8,0))),
             ('pine',placed(pine,(96,96),(15,0))),('amber_tree',placed(amber,(96,96),(8,0)))]
    finish('trees',build_lines((96,96),(48,80),trees))
    rock_canvas = placed(rock,(64,56),(8,17))
    minerals = [('rock',rock_canvas)]
    for name, group, count in [('copper','U',3),('iron','I',2),('crystal','C',4)]:
        ore = Canvas(64,56); ore.g = [row[:] for row in rock_canvas.g]
        for x,y in [(25,31),(36,26),(43,35)]:
            ore.poly([(x,y-3),(x+4,y),(x+3,y+4),(x-2,y+3)],ramp('R',1))
            ore.poly([(x,y-2),(x+3,y),(x+2,y+3),(x-1,y+2)],ramp(group,1))
            ore.rect(x,y-1,2,2,ramp(group,count))
        minerals.append((name,ore))
    finish('minerals',build_lines((64,56),(32,48),minerals))
    from build_style_nature import make_smallrock0, make_smallrock1, make_log
    bush = Canvas(40,28)
    reds = {ramp('T',i) for i in range(1,5)}
    bush.g = [[ramp('G',3) if c in reds else c for c in row] for row in berry.g]
    items = [('rock',rock_canvas),('berry',placed(berry,(64,56),(12,21))),
             ('bush',placed(bush,(64,56),(12,21)))]
    for name,maker in [('smallrock0',make_smallrock0),('smallrock1',make_smallrock1),('log',make_log)]:
        shape,anchor=maker()
        items.append((name,placed(shape,(64,56),(32-anchor[0],48-anchor[1]))))
    finish('props',build_lines((64,56),(32,48),items))

if __name__ == '__main__':
    main()
