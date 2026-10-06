"""新パレットの屋根・正面壁・木床の試作。瓦・石・板の部品を手で積み、Workbench Editorで書き出す。"""
from pathlib import Path
import json,sys

GAME=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(GAME.parents[1]/'Image/PixelWorkbench'))
from engine import Editor
from pixelwork import save,export

spec=json.loads((GAME/'art/palette.json').read_text(encoding='utf-8'))
symbols='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@+'
palette=dict(zip(symbols,spec['colors']))
_symbol_cache={}
def c(name):
    """'T3' のようなランプ名(暗→明、1始まり)を正本の記号へ変換する。"""
    if name=='.': return '.'
    if name not in _symbol_cache:
        _symbol_cache[name]=symbols[spec['colors'].index(spec['ramps'][name[0]][int(name[1:])-1])]
    return _symbol_cache[name]

class Rng:
    """配置用の決定的な乱数。ハッシュ乱数は実行ごとに変わるので使わない。"""
    def __init__(self,seed): self.s=(seed*2654435761+12345)&0xFFFFFFFF
    def step(self):
        self.s=(self.s*1664525+1013904223)&0xFFFFFFFF
        return self.s>>8
    def rand(self): return (self.step()&0xFFFF)/65536
    def rint(self,a,b): return a+self.step()%(b-a+1)

class Grid:
    def __init__(self,w,h):
        self.w=w;self.h=h;self.px=[['.']*w for _ in range(h)]
    def put(self,x,y,name):
        if 0<=x<self.w and 0<=y<self.h: self.px[y][x]=c(name)
    def rect(self,x,y,w,h,name):
        for j in range(h):
            for i in range(w): self.put(x+i,y+j,name)
    def blob(self,x,y,w,h,name):
        """四隅を1px欠いた面。塗り面を角ばらせないための部品。"""
        for j in range(h):
            for i in range(w):
                if w>=4 and h>=3 and i in (0,w-1) and j in (0,h-1): continue
                self.put(x+i,y+j,name)
    def rows(self): return [''.join(r) for r in self.px]

# ---- 屋根 -------------------------------------------------------------
# 縦に流れる丸瓦。列(幅8,7,9,8)は32px周期の固定位置で、谷のT1が左右・上下の部品を越えてつながる。
# 段は高さ8。調子は棟の下だけ明、軒の段だけ暗で、乱数は使わない。
COLUMNS=((0,8),(8,7),(15,9),(24,8))
TONES={'bright':(3,2),'base':(2,2),'dark':(1,3)}  # 光の筋の幅, 右の側面の幅
MOSS={'h':'G5','m':'G4','g':'G3','d':'G2'}
MOSS_ROWS=('..hhm.........',
           '.hhmmmm..mmm..',
           '.mmmmmmmmmmmg.',
           '.gmmmmmmmmmgg.',
           '..ddggggggdd..')
CHIP_ROWS=('K2','K2','W3','W2','W2','W1','W2','W2')  # 上の瓦の影, 桟の上面・側面・継ぎ目

def barrel_rows(w,tone):
    """丸瓦1本(幅w×高さ8)の8行。r0は上の段の下端が落とす影、r5〜r7が丸い下端。"""
    hw,fw=TONES[tone]
    body=['T1','T3']+['T4']*hw+['T3']*(w-2-hw-fw)+['T2']*fw
    r0=body[:2+hw]+['T2']*(w-2-hw)
    r5=body[:-1]+['T1']
    r6=['T1','T1']+['T4']*hw+['T3']*(w-4-hw)+['T1','T1']
    r7=['T1','T1']+['T2']*(w-4)+['T1','T1']
    return [r0,body,body,body,body,r5,r6,r7]

def mouth_rows(w):
    """軒の段の下3行。丸瓦の口(∩)とK1の輪郭。"""
    return [['T1','T3','T3']+['K2']*(w-6)+['T2','T2','T1'],
            ['T1','T3']+['K2']*(w-4)+['T2','T1'],
            ['K1']*w]

def moss_patch(g,y0,i):
    """隣り合う列i,i+1の上に載る苔。垂れは2列の間の谷のx。"""
    x0=COLUMNS[i][0]+1;drop=COLUMNS[i][1]-1
    rows=MOSS_ROWS+('.'*drop+'g'+'.'*(13-drop),)*2
    for v,row in enumerate(rows):
        for u,ch in enumerate(row):
            if ch!='.': g.put(x0+u,y0+1+v,MOSS[ch])

def chip_cell(g,i,y0):
    """瓦1枚分が抜けて、下地の桟が見える。左右はT1の枠。"""
    start,w=COLUMNS[i]
    for v,name in enumerate(CHIP_ROWS):
        g.put(start,y0+v,'T1');g.put(start+w-1,y0+v,'T1')
        for u in range(1,w-1): g.put(start+u,y0+v,name)

def edge_cut(g,h,ex,ey):
    """角の切り方は旧build_houses.pyと同じ。切り口に輪郭1px+破風板2pxを置く。"""
    step=h//8
    for y in range(h):
        inset=(h-1-y)//step if ey==0 else y//step if ey==2 else 0
        keep_row=(ey==0 and y==0) or (ey==2 and y==h-1)  # 棟と軒先の輪郭行は上書きしない
        if ex==0:
            for x in range(inset): g.px[y][x]='.'
            if keep_row: continue
            g.put(inset,y,'W1');g.put(inset+1,y,'W3');g.put(inset+2,y,'W2')
            if not (ey==0 and y<3) and not (ey==2 and y>=h-4): g.put(inset+3,y,'T1')
        else:
            xr=31-inset
            for x in range(xr+1,32): g.px[y][x]='.'
            if keep_row: continue
            g.put(xr,y,'W1');g.put(xr-1,y,'W2');g.put(xr-2,y,'W3')

def draw_roof(h,ex,ey,var):
    g=Grid(32,h);nr=h//8
    rng=Rng(3001+h*7+ex*131+ey*17+var*1009)
    for r in range(nr):
        tone='bright' if ey==0 and r==0 else 'dark' if ey==2 and r==nr-1 else 'base'
        for start,w in COLUMNS:
            rows=barrel_rows(w,tone)
            if ey==2 and r==nr-1: rows[5:]=mouth_rows(w)  # 軒の口
            if ey==0 and r==0: rows[3]=barrel_rows(w,tone)[0]  # 棟の影
            for v,row in enumerate(rows):
                for u,name in enumerate(row): g.put(start+u,r*8+v,name)
    free=[r for r in range(nr) if not (ey==0 and r==0) and not (ey==2 and r==nr-1)]
    if var==1:  # 苔: 隣り合う2列にまたがる塊を1タイルに1〜2枚
        for _ in range(min(1 if h==16 else rng.rint(1,2),len(free))):
            moss_patch(g,free.pop(rng.rint(0,len(free)-1))*8,rng.rint(0,2))
    if var==2:  # 欠け: 1〜2セル。横に隣り合わせない。x0とx31は基本のまま
        chosen=[]
        for _ in range(rng.rint(1,2)):
            for _ in range(20):
                r=free[rng.rint(0,len(free)-1)];i=rng.rint(0,2)
                if all(r!=r2 or abs(i-i2)>1 for r2,i2 in chosen):
                    chosen.append((r,i));break
        for r,i in chosen: chip_cell(g,i,r*8)
    if ey==0:  # 棟木3px。直下のr0行が棟の影になる
        for x in range(32):
            g.put(x,0,'W1');g.put(x,1,'W3');g.put(x,2,'W2')
        for x in ((9+5*var)%32,(24+5*var)%32):
            g.put(x,1,'W1');g.put(x,2,'W1')
    if ex!=1: edge_cut(g,h,ex,ey)
    return g

# ---- 正面壁 -----------------------------------------------------------
# 32×64、pivot 16,60。y4-7 軒影 / y8-11 梁 / y12-51 漆喰 / y52-59 石の基礎。
PANE_HI=(('A5','A5','A4','A3'),('A4','A4','A4','A3'),('A3','A3','A3','A3'),('A3','A3','A2','A2'),('A2','A2','A2','A2'))
PANE_PLAIN=(('A4','A4','A3','A3'),('A3','A3','A3','A3'),('A3','A3','A3','A2'),('A3','A2','A2','A2'),('A2','A2','A2','A2'))

def brace(g,x0,y0,x1,y1,thick,clip):
    """筋交い。縦に厚さthickの帯を、明/中/暗の3段で斜めに通す。"""
    third=max(1,thick//3)
    for x in range(min(x0,x1),max(x0,x1)+1):
        top=round(y0+(y1-y0)*(x-x0)/(x1-x0)-thick/2)
        for k in range(thick):
            y=top+k
            if clip[0]<=x<=clip[2] and clip[1]<=y<=clip[3]:
                g.put(x,y,'W3' if k<third else 'W2' if k<2*third else 'W1')

def draw_window(g,var):
    g.rect(23,21,2,16,'L1')
    g.rect(9,20,14,16,'W1')
    g.rect(10,21,12,14,'W2')
    g.rect(10,21,12,1,'W3');g.rect(10,21,1,14,'W3')
    for ox,oy,pane in ((11,22,PANE_HI),(17,22,PANE_PLAIN),(11,29,PANE_PLAIN),(17,29,PANE_PLAIN)):
        for j,row in enumerate(pane):
            for i,name in enumerate(row): g.put(ox+i,oy+j,name)
    g.rect(15,22,1,12,'W3');g.rect(16,22,1,12,'W2')
    g.rect(11,27,10,1,'W3');g.rect(11,28,10,1,'W2')
    g.rect(8,36,16,2,'L3')   # 窓台
    g.rect(9,38,16,2,'L1')   # 窓台の落ち影
    if var==1:  # 木の鎧戸。ルーバーは2段の明面と1段の暗線
        for x in (5,23):
            g.rect(x,20,4,16,'W1')
            for y in range(21,35):
                g.rect(x,y,3,1,('W3','W3','W2','W1')[(y-21)%4])

def draw_door(g,var):
    g.rect(24,25,2,27,'L1')
    g.rect(8,24,16,28,'W1')
    widths=((4,4,4),(5,4,3),(3,4,5))[var]
    tones=(('W4','W3'),('W3','W2'),('W3','W2'))
    x=9
    starts=[]
    for k,wd in enumerate(widths):
        hi,lo=tones[k]
        starts.append((x,wd))
        g.rect(x,25,(wd+1)//2,26,hi)
        g.rect(x+(wd+1)//2,25,wd-(wd+1)//2,26,lo)
        x+=wd+1  # 板の間はW1の1px
    rng=Rng(8101+var*61)
    for _ in range(2):  # 節。2x2の暗い面
        sx,wd=starts[rng.rint(0,2)]
        g.rect(sx+rng.rint(0,max(0,wd-2)),rng.rint(31,44),2,2,'W1')
    for y in ((29,45),(27,47),(31,43))[var]:
        g.rect(9,y,8,1,'I2');g.rect(9,y+1,8,1,'I1')
    g.rect(20,38,2,1,'I2');g.rect(20,39,2,3,'I1')

PEEL_10x7=('..aaaaaa..','.a333322b.','a33332221b','a11111111b','a22233333b','.a222233b.','..bbbbbb..')
PEEL_9x5=('..aaaaa..','.a33322b.','a1111111b','.a22333b.','..bbbbb..')
PEEL_COLORS={'a':'L1','b':'L3','3':'W3','2':'W2','1':'W1'}

def draw_pillar(g,right):
    """柱は半分ずつ。隣のタイルの半分と合わさって4px幅の1本になる。木継ぎは全タイル同じy。"""
    x0=30 if right else 0
    for i,name in enumerate(('W2','W3') if right else ('W3','W1')): g.rect(x0+i,12,1,40,name)
    g.rect(x0,30,2,1,'W1');g.put(30 if right else 1,31,'W2')

def stamp(g,x,y,rows):
    for j,row in enumerate(rows):
        for i,ch in enumerate(row):
            if ch!='.': g.put(x+i,y+j,PEEL_COLORS[ch])

def plaster_bump(g,x,y,w,h):
    """塗りの盛り上がり。本体L3の下と右の外側にL1を1px付ける。"""
    body={(x+i,y+j) for j in range(h-1) for i in range(w-1)
          if not (i in (0,w-2) and j in (0,h-2))}
    for px,py in body: g.put(px,py,'L3')
    for px,py in body:
        for qx,qy in ((px+1,py),(px,py+1)):
            if (qx,qy) not in body: g.put(qx,qy,'L1')

def splash_band(g):
    """基礎の真上の跳ね返りの汚れ。幅3〜6pxごとに高さ4〜6を上下させる。両端は高さ5。"""
    rng=Rng(7777)
    x=2;hh=5;widths=[]
    while x<=29:
        wd=rng.rint(3,6)
        while len(widths)>=2 and widths[-1]==widths[-2]==wd: wd=rng.rint(3,6)
        wd=min(wd,30-x)
        widths.append(wd)
        if x+wd>29: hh=5
        g.rect(x,52-hh,wd,hh,'L1')
        x+=wd
        hh=max(4,min(6,hh+rng.rint(-1,1)))

def draw_course(g,y0,joints,rng,bottom):
    start=0;spans=[]
    for j in joints:
        spans.append((start,j,True));start=j+1
    if start<=31: spans.append((start,31,False))  # タイル端でちぎれる石
    for a,b,joint in spans:
        tones=('R3','R2','R2','R2') if rng.rand()<0.3 else ('R4','R3','R3','R2')  # 上の明面/前面2段/下の影
        if bottom: tones=tones[:3]+('R1',)
        end=b-1 if joint else b
        for v,name in enumerate(tones): g.rect(a,y0+v,end-a+1,1,name)
        if joint: g.rect(b,y0,1,4,'R1')

def draw_facade(kind,var):
    g=Grid(32,64)
    rng=Rng(7001+var*53+('wall','window','door').index(kind)*211)
    g.rect(2,12,28,40,'L2')
    g.rect(2,12,28,2,'L1');g.rect(2,14,2,38,'L1')  # 梁の下と柱右側の落ち影
    zones=[(15,20),(27,33),(38,41)]  # 塗りの盛り上がりは1タイルに2〜3個
    if rng.rint(2,3)==2: zones.pop(rng.rint(0,2))
    for lo,hi in zones:
        bw=rng.rint(7,10);bh=rng.rint(4,6)
        plaster_bump(g,rng.rint(5,29-bw),rng.rint(lo,hi),bw,bh)
    if kind=='wall' and var==1: stamp(g,6,34,PEEL_10x7)  # 剥落: 下に編んだ木の下地
    if kind=='window' and var==1: stamp(g,11,40,PEEL_9x5)
    splash_band(g)
    if var==2:  # 筋交いはvariation2だけの1本
        if kind=='wall': brace(g,6,46,26,14,6,(2,12,29,51))
        elif kind=='window': brace(g,5,19,13,13,4,(2,12,29,19))
        else: brace(g,5,23,14,13,4,(2,12,29,23))
    if kind=='window': draw_window(g,var)
    if kind=='door': draw_door(g,var)
    draw_pillar(g,False);draw_pillar(g,True)
    g.rect(0,8,32,2,'W3');g.rect(0,10,32,1,'W2');g.rect(0,11,32,1,'W1')
    seam=(16,11,21)[var]
    g.rect(seam,8,1,4,'W1');g.rect(seam+1,8,1,3,'W2')
    g.rect(5+var*2,9,6,1,'W2');g.rect(20-var*3,8,5,1,'W2')
    g.rect(0,4,32,2,'K1');g.rect(0,6,32,2,'T1')
    draw_course(g,52,((7,13,22,31),(5,14,21,31),(8,15,23,31))[var],rng,False)
    draw_course(g,56,((4,12,20,27),(3,10,19,26),(6,13,21,29))[var],rng,True)
    return g

# ---- 木床 -------------------------------------------------------------
PLANKS={'A':('W1','W3','W3','W2','W2','W2','W2','W2'),
        'B':('W1','W2','W2','W2','W2','W2','W2','W2'),
        'C':('W1','W3','W3','W3','W2','W2','W2','W2')}
FLOOR_ORDER=(('A','B','C','B'),('B','C','A','C'),('C','A','B','A'),('A','C','B','C'),('B','A','C','A'),('C','B','A','B'))
FLOOR_NAMES=('floor','floor_wood','timber_floor0','timber_floor1','timber_floor2','timber_floor3')
FLOOR_KNOTS=(0,0,1,1,2,1)
FLOOR_WEAR=(0,1,0,1,0,1)

def draw_floor(idx):
    g=Grid(32,32);rng=Rng(9001+idx*377)
    for p,kind in enumerate(FLOOR_ORDER[idx]):
        for v,name in enumerate(PLANKS[kind]): g.rect(0,p*8+v,32,1,name)
    if FLOOR_WEAR[idx]:  # すり減り: 明るい面の中にW4の細い芯
        p=rng.rint(0,3);x=rng.rint(3,20);w=rng.rint(8,11)
        g.blob(x,p*8+3,w,4,'W3');g.rect(x+2,p*8+4,w-4,2,'W4')
    for _ in range(FLOOR_KNOTS[idx]):  # 節: 暗い楕円
        p=rng.rint(0,3);kx=rng.rint(3,26);ky=p*8+rng.rint(3,4)
        g.rect(kx+1,ky,2,1,'W1');g.rect(kx,ky+1,4,1,'W1');g.rect(kx+1,ky+2,2,1,'W1')
    for p in range(4):  # 木目は板に1本、4〜6px
        g.rect(rng.rint(1,24),p*8+rng.rint(4,6),rng.rint(4,6),1,'W3')
    base=rng.rint(0,31)
    for p in range(4):  # 板継ぎは板ごとにずらす
        g.rect((base+p*11)%32,p*8+1,1,7,'W1')
    return g

# ---- 出力 -------------------------------------------------------------
def audit(g):
    """色数と、4近傍に同色のない孤立1pxの割合。"""
    opaque=0;isolated=0;colors=set()
    for y,row in enumerate(g.px):
        for x,s in enumerate(row):
            if s=='.': continue
            opaque+=1;colors.add(s)
            if not any(0<=x+dx<g.w and 0<=y+dy<g.h and g.px[y+dy][x+dx]==s
                       for dx,dy in ((1,0),(-1,0),(0,1),(0,-1))): isolated+=1
    return len(colors),isolated/opaque if opaque else 0

def write_sheet(sheet,size,pivot,parts,tag,columns):
    w,h=size
    lines=[f'canvas {w} {h}',f'pivot {pivot[0]} {pivot[1]}']+[f'palette {k} {v}' for k,v in palette.items()]
    for name,g in parts:
        lines.append(f'part {name} {w} {h}')
        lines.extend(f'row {y} 0 {row}' for y,row in enumerate(g.rows()))
    for name,_ in parts: lines.extend((f'frame {name} 140',f'tag {tag}',f'place sprite {name} 0 0'))
    text='\n'.join(lines)
    target=GAME/'art/r2';target.mkdir(parents=True,exist_ok=True)
    (target/f'{sheet}.dot').write_text(text+'\n',encoding='utf-8')
    project=Editor().apply(text)
    save(project,target/f'{sheet}.json')
    report=export(project,GAME/'assets/r2-preview'/sheet,columns=columns)
    stats=[(n,)+audit(g) for n,g in parts]
    worst=max(stats,key=lambda s:s[2])
    print(f'{sheet}: {report["frames"]} frames, {len(report["warnings"])} warnings, '
          f'max colors {max(s[1] for s in stats)}, worst isolated {worst[2]*100:.1f}% ({worst[0]}); preview only')

def main():
    for sheet,h,prefix in (('roofs',16,'roof'),('roofs_full',24,'roof_full')):
        parts=[]
        for i in range(27):
            tile,var=i%9,i//9
            name=f'{prefix}{tile}'+(f'_v{var}' if var else '')
            parts.append((name,draw_roof(h,tile%3,tile//3,var)))
        write_sheet(sheet,(32,h),(0,0),parts,'roof',9)
    parts=[]
    for i in range(9):
        kind,var=('wall','window','door')[i%3],i//3
        parts.append((f'facade_{kind}'+(f'_v{var}' if var else ''),draw_facade(kind,var)))
    write_sheet('facades',(32,64),(16,60),parts,'facade',3)
    write_sheet('floor',(32,32),(0,0),[(n,draw_floor(i)) for i,n in enumerate(FLOOR_NAMES)],'floor',3)

if __name__=='__main__':
    main()
