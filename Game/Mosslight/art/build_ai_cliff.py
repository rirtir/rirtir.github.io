"""連続した崖の自作原画をWorkbenchで4タイルへ整える。manifestは変更しない。"""
from pathlib import Path
import argparse,subprocess,sys
from style import GAME,WORKBENCH,REVIEW_DIR,R2_DIR,Canvas,HEX_OF,ramp,compose,load,finish,build_lines
from engine import import_image
from pixelwork import save
from restyle import merge_isolated

def main():
    parser=argparse.ArgumentParser();parser.add_argument('image',type=Path);a=parser.parse_args()
    symbols=[ramp(g,i) for g,n in [('G',5),('E',5),('R',5),('K',2)] for i in range(1,n+1)]
    palette={'.':'#00000000',**{s:HEX_OF[s] for s in symbols}}
    imported=import_image(a.image,size=(256,86),palette=palette)
    rows=imported['parts']['import0']['rows']
    occupied=[y for y,row in enumerate(rows) if any(c!='.' for c in row)]
    top,bottom=min(occupied),max(occupied)+1
    source=REVIEW_DIR/'cliff-import.json';save(imported,source)
    cropped=REVIEW_DIR/'cliff-crop.png'
    subprocess.run([sys.executable,str(WORKBENCH/'pixelwork.py'),'inspect',str(source),
        '--frame','frame0','--crop','0',str(top),'256',str(bottom-top),'--image',str(cropped)],check=True,capture_output=True)
    native=import_image(cropped,size=(128,32),palette=palette)
    strip=Canvas(128,32);strip.g=[list(r) for r in native['parts']['import0']['rows']]
    merge_isolated(strip.g,budget=.012)
    # 128px周期の端は同じ輪郭・色へ接続し、途中の4枚は原画の連続性を保つ。
    for y in range(32):
        for x in (126,127): strip.g[y][x]=strip.g[y][x-126]
    current=load(GAME/'art/environment.json')
    items=[]
    for fr in current['frames']:
        name=fr['name']
        if name.startswith('cliff_face'):
            n=int(name[-1]);cv=Canvas(32,32)
            cv.g=[row[n*32:(n+1)*32] for row in strip.g]
        elif name in ('cliff_left','cliff_right'):
            # 端は全幅の追加パネルではなく、既存断面の最端3pxだけを使う。
            cv=Canvas(32,32);left=name=='cliff_left';start=0 if left else 125
            for y in range(32):
                for j in range(3): cv.set(j if left else 29+j,y,strip.get(start+j,y))
        else: cv=compose(current,name)
        items.append((name,cv))
    finish('environment',build_lines((32,32),(0,0),items))
    print('native cliff strip',128,32,'source crop',top,bottom)

if __name__=='__main__':main()
