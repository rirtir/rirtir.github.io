"""8px silhouettes -> nearest-neighbour 16px cores -> hand placed details.

All drawing and export use PixelWorkbench. These inventory icons leave existing
characters, trees, and world fish sprites unchanged.
"""
from pathlib import Path
import json
import sys

GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GAME.parents[1] / 'Image/PixelWorkbench'))
from engine import Editor
from pixelwork import save, export

INK = '#1d3030'
SPEC = {
 'minnow': (['........','........','........','..a.....','..aabaa.','...aaaac','..aabb..','........'], ['#afc9c1','#668d91','#dde3c5'], [(13,10)]),
 'goby': (['........','....a...','..aaa...','aabaaaa.','.abbbaaa','aabbbbcc','..bbcc..','........'], ['#b69b60','#75654a','#d9bd83'], [(13,8)]),
 'carp': (['........','....a...','..aaaa..','aabbaaa.','.aaaaaaa','aabbbbcc','..bbcc..','...b....'], ['#72a48a','#426c62','#c4cba0'], [(13,8)]),
 'trout': (['........','...a....','..aa....','aabaaaa.','.aaaaaaa','aabbbbcc','..bccc..','........'], ['#91b8b5','#4a7e89','#d5d4b0'], [(13,8)]),
 'catfish': (['........','........','...aaa..','aabaaaa.','.abbbaaa','aabbbbbc','...bbbb.','........'], ['#759687','#405f60','#b8b794'], [(13,8)]),
 'eel': (['......aa','.....aaa','....ab..','...ab...','..ab....','..ba....','...ba...','....bb..'], ['#8cc8b8','#3e827d','#d5dec0'], [(13,2)]),
 'bream': (['....a...','...aaa..','..aaaa..','.abaaaa.','..aabaaa','.abbbbcc','..bbbcc.','...bb...'], ['#a9babe','#687f93','#d9deca'], [(13,6)]),
 'pike': (['........','..aa....','..aaa...','aabaaaa.','.aaaaaaa','aabbbbb.','..bbb...','........'], ['#87a374','#4f7460','#c8c593'], [(13,6)]),
}
SYMS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
colors = [INK]
for _, palette, _ in SPEC.values():
    for color in palette:
        if color not in colors: colors.append(color)
symbols = dict(zip(colors, SYMS))

def make_project(size, frames):
    commands = [f'canvas {size} {size}', f'pivot {size//2} {size//2}']
    commands += [f'palette {symbols[c]} {c}' for c in colors]
    for name, cells in frames.items():
        rows = [''.join('.' if c is None else symbols[c] for c in row) for row in cells]
        commands += [f'part {name}_body {size} {size}', 'rows '+'|'.join(rows),
                     f'frame {name} 100', f'place body {name}_body 0 0']
    return Editor().apply('\n'.join(commands)+'\n')

def main():
    base, final = {}, {}
    for species, (rows, palette, eyes) in SPEC.items():
        assert len(rows)==8 and all(len(row)==8 for row in rows)
        name = 'fish_'+species
        legend = dict(zip('abc',palette))
        cells = [[legend.get(c) for c in row] for row in rows]
        base[name] = cells
        canvas = [[None]*24 for _ in range(24)]
        for y in range(16):
            for x in range(16): canvas[y+4][x+4] = cells[y//2][x//2]
        # A single pixel outline surrounds the enlarged silhouette. Keep inner
        # clusters broad; a pupil, gill, and a few species marks carry identity.
        opaque = {(x,y) for y,row in enumerate(canvas) for x,c in enumerate(row) if c is not None}
        for x,y in opaque:
            for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
                nx,ny=x+dx,y+dy
                if 0<=nx<24 and 0<=ny<24 and (nx,ny) not in opaque: canvas[ny][nx]=INK
        for x,y in eyes: canvas[y+4][x+4]=INK
        if species!='eel':
            for x,y in [(11,7),(11,8),(10,9)]:
                if canvas[y+4][x+4] not in (None,INK): canvas[y+4][x+4]=palette[1]
        if species in ('carp','trout','pike'):
            for x,y in [(6,7),(8,9),(10,6)]:
                if canvas[y+4][x+4] is not None: canvas[y+4][x+4]=palette[1]
        if species=='catfish':
            for x,y in [(20,13),(21,14),(22,15),(20,15),(21,16),(22,17)]: canvas[y][x]=palette[2]
        if species=='pike':
            for x,y in [(20,11),(21,11),(22,12),(21,13),(20,13)]: canvas[y][x]=INK
            canvas[12][20]=palette[0];canvas[12][21]=palette[0]
        if species=='eel':
            for x,y in [(7,16),(11,12),(15,7)]:
                if canvas[y][x] not in (None,INK): canvas[y][x]=palette[2]
        final[name]=canvas
    base_project = make_project(8,base)
    study = GAME/'art/studies/fish-icons7-base8.json'
    study.parent.mkdir(parents=True,exist_ok=True)
    save(base_project,study)
    sheet='content_fish_icons7'
    project=make_project(24,final)
    save(project,GAME/f'art/{sheet}.json')
    out=GAME/f'.review/v7/{sheet}'
    export(project,out,columns=8)
    dest=GAME/f'assets/{sheet}'
    dest.mkdir(parents=True,exist_ok=True)
    for name in ['atlas.png','atlas.json']: (dest/name).write_bytes((out/name).read_bytes())
    for kind,color in [('normal','#8080ff'),('height','#028080')]:
        commands=['canvas 24 24','pivot 12 12',f'palette N {color}']
        for name,cells in final.items():
            rows=[''.join('.' if c is None else 'N' for c in row) for row in cells]
            commands += [f'part {name}_surface 24 24','rows '+'|'.join(rows),f'frame {name} 100',f'place surface {name}_surface 0 0']
        maps=Editor().apply('\n'.join(commands)+'\n')
        save(maps,GAME/f'art/normalmaps/{sheet}-{kind}.json')
        export(maps,out/kind,columns=8)
        (dest/f'{kind}.png').write_bytes((out/kind/'atlas.png').read_bytes())
    path=GAME/'assets/manifest.json'
    manifest=json.loads(path.read_text(encoding='utf-8'))
    manifest['sheets'][sheet]={'image':f'{sheet}/atlas.png','atlas':f'{sheet}/atlas.json','pivot':[12,12],
       'names':list(final),'normal':f'{sheet}/normal.png','height':f'{sheet}/height.png','overrides':'icons'}
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'sheet':sheet,'frames':len(final),'palette':len(colors),'base':str(study)},ensure_ascii=False))

if __name__=='__main__': main()
