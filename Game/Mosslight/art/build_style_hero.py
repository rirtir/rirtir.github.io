"""2.6頭身の探索者。部品を手で描き、ポーズごとに接地と握りを確定する。"""
from pathlib import Path
import json,sys

GAME=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(GAME.parents[1]/'Image/PixelWorkbench'))
from engine import Editor
from pixelwork import save,export

spec=json.loads((GAME/'art/palette.json').read_text(encoding='utf-8'))
symbols='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@+'
palette={'.':'#00000000',**dict(zip(symbols,spec['colors']))}
def color(group,index): return symbols[spec['colors'].index(spec['ramps'][group][index-1])]
# 部品の読みやすさのためのローカル記号。出力時に正本の記号へ変換する。
ink={'.':'.','0':color('K',1),'1':color('K',2),
     'a':color('E',2),'b':color('E',3),'c':color('E',4),
     's':color('F',2),'t':color('F',3),'u':color('F',4),
     'd':color('B',2),'e':color('B',3),'f':color('B',4),
     'p':color('W',1),'q':color('W',2)}

heads={
'down':[
'...11bbb11...', '..1bbccccb1..', '.1bbcccbbba1.', '.1bcbbbbbba1.',
'.1bb1uuu1ba1.', '.1atuuuuus1a.', '..1tuutuus1..', '..1tu0u0us1..',
'...1tuutus1..', '...1tttts1...', '....11111....'],
'up':[
'...11bbb11...', '..1bbccccb1..', '.1bbcccbbba1.', '.1bcbbbbbba1.',
'.1bbbbbbbaa1.', '.1bbbbbbbaa1.', '..1bbbbbba1..', '..1bbbbbba1..',
'...1bbbba1...', '...1aaa11....', '....11111....'],
'right':[
'...11bbb11...', '..1bbccccb1..', '.1bbcccbbba1.', '.1bcbbbbbba1.',
'.1bbbbbuuu1..', '.1bbbb1utuu1.', '..1bba1uu0u1.', '..1aaa1utuuu1',
'...1111utus1.', '....1ttts1...', '.....1111....']}

coats={
'down':['..11dddd11..', '.1dfeeeedp1.', '1dffeeeeedp1', '1dfeeeeedqp1',
         '1dfeeeedqqp1', '.1deeeqqqdp1', '.1deqqqeddp1', '..1qqqqqq1..', '..11ddd111..'],
'up':['..11dddd11..', '.1dffeeddd1.', '1dffeeeeddd1', '1dfepqqqpd1',
       '1deqpcccpqd1', '.1dqpcccqp1.', '.1dqpbcbqp1.', '..1qqqqqq1..', '..11ddd111..'],
'right':['...11ddd11..', '..1dffeedp1.', '..1dfeeqqp1.', '..1dfedqqp1.',
         '..1deedqqp1.', '..1dedqqdp1.', '...1qqqddp1.', '...1qqqqp1..', '....1dd111..']}

def translate(rows): return [''.join(ink[p] for p in row) for row in rows]
def canvas(): return [['.']*32 for _ in range(48)]
def stamp(dest,rows,x,y):
    for j,row in enumerate(rows):
        for i,p in enumerate(row):
            if p!='.' and 0<=x+i<32 and 0<=y+j<48: dest[y+j][x+i]=ink.get(p,p)
def rect(dest,x,y,w,h,c): stamp(dest,[c*w]*h,x,y)
def stroke(dest,x0,y0,x1,y1,c,width=1):
    n=max(abs(x1-x0),abs(y1-y0),1)
    for i in range(n+1):
        x=round(x0+(x1-x0)*i/n);y=round(y0+(y1-y0)*i/n)
        rect(dest,x-width//2,y-width//2,width,width,c)
def boot(dest,x,y,side=0):
    stamp(dest,['.00..','0qq0.','0qcq0','00000'] if side>=0 else ['..00.','.0qq0','0qcq0','00000'],x,y)

HANDS={'down':[(6,-20),(8,-9),(-2,-13)],'right':[(7,-22),(12,-13),(6,-16)],'up':[(6,-25),(8,-27),(5,-20)]}
frames=[]
parts={}
for direction in ('down','up','right','left'):
    base='right' if direction=='left' else direction
    for action,count in [('idle',2),('walk',4),('attack',3),('roll',3)]:
        for i in range(count):
            out=canvas()
            bob=-1 if action=='walk' and i%2 else 0
            lean=[-2,2,0][i] if action=='attack' else 0
            crouch=(3 if i==0 else 2) if action=='roll' else 0
            if action=='roll' and i==1:
                stamp(out,['.....000000.....','...00dddddd00...','..0dffeeeeedd0..',
                           '.0dffeeeeeeddd0.','0dffeeeeeeddqqd0','0deeeeeqqqddqqd0',
                           '0deeeeqccqddqqd0','0deeeeqccqdddqd0',
                           '0deeqqqqqqdddqd0','0deqqpppqqdddqd0','.0eqpqqqpqdddq0.',
                           '..0qpqqqpqddq0..','...00ppppdd00...','.....000000.....'],8,25)
                boot(out,9,29,-1);boot(out,21,28,1)
                # 方向別の顔を、丸まった姿勢に描き直す。
                face=(['.1bbu1','1bbuu1','1bu0u1','.1uus1','..111.'] if base=='right' else
                      ['.11bbb11.','1bbcccbba1','1bbbbbaaa1','.1uu0uu1.' if base=='down' else '.1aaaaa1.','..11111..'])
                stamp(out,face,18 if base=='right' else 11,25)
            else:
                step=[-2,0,2,0][i] if action=='walk' else 0
                # 脚は歩行時に3〜4px開き、通過時に重なる。
                farx=17+step if base!='right' else 15-step
                nearx=11-step if base!='right' else 14+step
                rect(out,11,28+crouch,12,3,'0');rect(out,12,28+crouch,10,2,'d')
                farlift=2 if action=='walk' and i==3 else 0
                nearlift=2 if action=='walk' and i==1 else 0
                rect(out,farx,29+crouch,4,max(2,6-crouch-farlift),'0')
                rect(out,farx+1,29+crouch,2,max(2,6-crouch-farlift),'d')
                boot(out,farx-1,35-farlift,-1)
                rect(out,nearx,29+crouch,4,max(2,6-crouch-nearlift),'0')
                rect(out,nearx+1,29+crouch,2,max(2,6-crouch-nearlift),'e')
                boot(out,nearx-1,35-nearlift,1)
                if action=='walk' and i in (1,3):
                    knee=nearx if i==1 else farx
                    stroke(out,knee+1,31,knee+3,32,'e' if i==1 else 'd',3)
                # 影側の腕→胴→顔→光側の腕。肌の継ぎ目を衣服の輪郭内に埋める。
                swing=[-1,1,1,-1][i] if action=='walk' else 0
                stamp(out,['.00.','0dd0','0de0','0ds0','.tu.','.00.'],8+lean,22+bob+crouch-swing)
                rect(out,14+lean,20+bob+crouch,4,4,'t')
                stamp(out,coats[base],10+lean,21+bob+crouch-(1 if action=='idle' and i else 0))
                if action=='attack':
                    gx,gy=HANDS[base][i];hx,hy=16+gx,40+gy
                    stroke(out,22+lean,23+bob+crouch,hx,hy-2,'0',5)
                    stroke(out,22+lean,23+bob+crouch,hx,hy-2,'d',3)
                    stroke(out,21+lean,22+bob+crouch,hx-1,hy-3,'f',1)
                    rect(out,hx-1,hy-1,3,3,'t');rect(out,hx-1,hy-1,2,1,'u')
                stamp(out,heads[base],10+lean,10+bob+crouch)
                if action!='attack':
                    stamp(out,['.00.','0ef0','0ee0','0ds0','.tu.','.00.'],20+lean,23+bob+crouch+swing)
                if action=='roll':
                    stroke(out,13,30+crouch,10,33,'0',5)
                    stroke(out,13,30+crouch,10,33,'e',3)
                    if i==2:
                        stroke(out,22,26,24,36,'0',4);stroke(out,22,26,24,36,'e',2)
                        rect(out,23,36,3,3,'t')
            if direction=='left': out=[row[::-1] for row in out]
            name=f'hero_{direction}_{action}{i}'
            parts[name]={'size':[32,48],'rows':[''.join(row) for row in out]}
            frames.append({'name':name,'duration':104 if action=='walk' else 100,'tag':action,
                           'layers':[{'id':'sprite','part':name,'x':0,'y':0}]})
lines=['canvas 32 48','pivot 16 40']+[f'palette {k} {v}' for k,v in palette.items() if k!='.']
for name,p in parts.items():
    lines.append(f'part {name} 32 48')
    lines.extend(f'row {y} 0 {row}' for y,row in enumerate(p['rows']))
for f in frames: lines.extend((f'frame {f["name"]} {f["duration"]}',f'tag {f["tag"]}',f'place sprite {f["name"]} 0 0'))
target=GAME/'art/r2';target.mkdir(exist_ok=True)
(target/'explorer.dot').write_text('\n'.join(lines)+'\n',encoding='utf-8')
project=Editor().apply('\n'.join(lines))
save(project,target/'explorer.json')
report=export(project,GAME/'assets/r2-preview/explorer',columns=8)
print(f'explorer: {report["frames"]} frames, {len(report["warnings"])} warnings; preview only')
