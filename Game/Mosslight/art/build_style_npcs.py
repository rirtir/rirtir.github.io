"""探索者と同じ体格を使い、帽子・前掛け・髭で住人の輪郭を変える。"""
from pathlib import Path
import json,sys

GAME=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(GAME.parents[1]/'Image/PixelWorkbench'))
from engine import Editor,load
from pixelwork import save,export
source=load(GAME/'art/r2/explorer.json')
spec=json.loads((GAME/'art/palette.json').read_text(encoding='utf-8'))
symbols='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@+'
def c(group,i): return symbols[spec['colors'].index(spec['ramps'][group][i-1])]
lines=['canvas 32 48','pivot 16 40']+[f'palette {k} {v}' for k,v in source['palette'].items() if k!='.']
frames=[]
for role in ('cook','farmer','builder'):
    for direction in ('down','up','left','right'):
        for i in range(4):
            name=f'npc_{role}_{direction}_walk{i}'
            rows=[list(row) for row in source['parts'][f'hero_{direction}_walk{i}']['rows']]
            # 布の最明色を一段へまとめ、職業の材質を足しても14色以内にする。
            rows=[[c('B',3) if p==c('B',4) else p for p in row] for row in rows]
            left=direction=='left'
            lean=0; bob=-1 if i%2 else 0
            def stamp(part,x,y,ink):
                for yy,row in enumerate(part):
                    for xx,p in enumerate(row):
                        tx=x+xx; ty=y+yy
                        if p!='.' and 0<=tx<32 and 0<=ty<48:
                            rows[ty][31-tx if left else tx]=ink[p]
            common={'0':c('K',1),'a':c('K',2),'s':c('W',2)}
            if role=='cook':
                stamp(['...00000000...','..0wwwwwwww0..','.0wvvvvvvvvw0.',
                       '0wvvvvvvvvvvw0','0wvvvvvvvvvvw0','.0wwwwwwwwww0.','..0wwwwwwww0..'],9+lean,3+bob,
                      {**common,'v':c('L',3),'w':c('L',2)})
                if direction!='up':
                    stamp(['.wwwwwwww.','wvvvvvvvww','wvvvvvvvww','wvvvvvvvww','wvvvvvvvww','.wwwwwwww.'],11+lean,23+bob,
                          {'v':c('L',3),'w':c('L',2)})
            elif role=='farmer':
                stamp(['.....000000.....','....0mmmnnm0....','...0mmnnnnmm0...',
                       '..0mmmmmmmmm00..','.0mmnnnnnnnmmmm0','0mmmmmmmmmmmmmm0','.00000000000000.'],8+lean,4+bob,
                      {**common,'m':c('M',2),'n':c('M',3)})
            else:
                stamp(['...00000000...','..0mmmmmmss0..','.0mmmmmmmmss0.',
                       '.0mmmmmmmmss0.','0mmmmmmmmmmmss0','.0000000000000.'],9+lean,5+bob,
                      {**common,'m':c('M',2)})
                if direction!='up':
                    stamp(['.sssss.','sssssaa','.ssaaa.','..aaa..'],14+lean if direction=='right' else 13+lean,19+bob,common)
                    stamp(['..sssss..','.ssqqqqs.','ssqqqqqss','ssqqqqqss','.ssqqqss.','..ssss...'],12+lean,23+bob,
                          {**common,'q':c('W',3)})
            lines.append(f'part {name} 32 48')
            lines.extend(f'row {y} 0 {"".join(row)}' for y,row in enumerate(rows))
            frames.append(name)
for name in frames: lines.extend((f'frame {name} 180','tag resident',f'place sprite {name} 0 0'))
project=Editor().apply('\n'.join(lines))
target=GAME/'art/r2';target.mkdir(exist_ok=True)
(target/'villagers.dot').write_text('\n'.join(lines)+'\n',encoding='utf-8')
save(project,target/'villagers.json')
report=export(project,GAME/'assets/r2-preview/villagers',columns=8)
print(f'villagers: {report["frames"]} frames, {len(report["warnings"])} warnings; preview only')
