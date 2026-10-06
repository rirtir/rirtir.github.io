"""Workbenchで形と材質から2.5D法線/高さを作る。画像のRGB輝度は高さに使わない。"""
from pathlib import Path
import argparse, json, math, sys
from style import GAME, WORKBENCH, SYMBOLS, GROUP_OF, HEX_OF, SYMBOL_OF, ramp
from engine import Editor, load, render
from pixelwork import export, save

AZIMUTHS=12
VECTORS=[(0.,0.,1.)]
for slope in (.12,.25,.45,.65,.8):
    for direction in range(AZIMUTHS):
        angle=direction*2*math.pi/AZIMUTHS
        VECTORS.append((slope*math.cos(angle),slope*math.sin(angle),math.sqrt(1-slope*slope)))
NORMAL_COLORS=['#%02x%02x00'%(round(x*127+128),round(y*127+128)) for x,y,z in VECTORS]
NORMAL_COLORS.append('#8080ff')
HEIGHTS=(0.,.5,1.,2.,4.,8.,16.,32.)
GAINS=(.8,.95,1.1,1.25)
HEIGHT_VALUES=[(height,rough,gain) for height in HEIGHTS for rough in (.45,.8) for gain in GAINS]
HEIGHT_COLORS=['#%02x%02x%02x'%(round(h/64*255),round(r*255),round(g*128)) for h,r,g in HEIGHT_VALUES]
REF=(-.5/math.sqrt(.99),.5/math.sqrt(.99),.7/math.sqrt(.99))

def nearest_color_group(color):
    if color in SYMBOL_OF: return GROUP_OF[SYMBOL_OF[color]]
    rgb=tuple(int(color[i:i+2],16) for i in (1,3,5))
    def distance(symbol):
        target=tuple(int(HEX_OF[symbol][i:i+2],16) for i in (1,3,5))
        return sum((a-b)**2 for a,b in zip(rgb,target))
    return GROUP_OF[min(HEX_OF,key=distance)]

def fields(project, fr, key):
    image,_=render(project,fr)
    pixels=list(image.getdata()); w,h=project['size']
    mask=[[pixels[y*w+x][3]>=128 for x in range(w)] for y in range(h)]
    groups={color[:7].lower():nearest_color_group(color[:7].lower())
            for color in project['palette'].values() if color[0]=='#' and not color.endswith('00')}
    def group(x,y):
        return groups.get('#%02x%02x%02x'%pixels[y*w+x][:3],'K')
    dist=[[999 if mask[y][x] else 0 for x in range(w)] for y in range(h)]
    for y in range(h):
        for x in range(w):
            if mask[y][x]:
                dist[y][x]=min(dist[y][x],dist[y-1][x]+1 if y else 1,dist[y][x-1]+1 if x else 1)
    for y in range(h-1,-1,-1):
        for x in range(w-1,-1,-1):
            if mask[y][x]:
                dist[y][x]=min(dist[y][x],dist[y+1][x]+1 if y<h-1 else 1,dist[y][x+1]+1 if x<w-1 else 1)
    name=fr['name']
    terrain=key in ('tiles','edges','caveedges','ground','quiet_ground','floor')
    water='water' in name
    height=[[0. for _ in range(w)] for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if not mask[y][x]: continue
            g=group(x,y)
            if water:
                # 材質の明るさから作らず、整数タイルへ連続する小さい波の形を与える。
                phase=int(name[-1]) if name[-1:].isdigit() else 0
                value=.5+.02*math.sin(x*2*math.pi/32-phase*math.pi/2)+.28*math.cos(y*2*math.pi/16+phase*math.pi/2)
            elif key=='environment' and 'wall_top' in name:
                value=24.+min(dist[y][x],3)*.3
            elif key=='environment' and ('wall_face' in name or 'cliff_' in name):
                value=22. if y<12 else max(3.,22.-(y-12)*.95)
            elif key=='facades':
                value=max(2.,30.-y*.45)
            elif key in ('roofs','roofs_full'):
                value=30.+(h-y)*.15
            elif terrain or name in ('moss_roots','ruin_fragment'):
                # 材質の分類と筆致に小さい高さを指定。紙・火の明るさからの高さ推定はしない。
                value={'G':.6,'P':.3,'R':.5,'E':.15,'S':.1,'W':.4}.get(g,0.)
                rgb=pixels[y*w+x][:3]
                color='#%02x%02x%02x'%rgb
                if color in ('#557a45','#7a9a4c'): value=1.5
                # 筆致の役割を指定する。明度の微分ではなく、土のくぼみ/小石/石目地の高さ。
                symbol=SYMBOL_OF.get(color)
                if key in ('ground','edges'):
                    kind=next((k for k in ('darkgrass','grass','dirt','path','sand','cave','moss','ruin') if k in name),None)
                    roles={
                        'dirt':{'E':{2:0.,3:.5,4:1.4}},
                        'path':{'E':{2:0.,3:.45,4:.5}},
                        'cave':{'R':{1:0.,2:.5,3:1.6}},
                        'ruin':{'R':{1:0.,2:1.,3:1.4},'G':{2:1.3,3:1.5}},
                        'grass':{'G':{2:.3,3:.7,4:.9,5:1.5}},
                        'darkgrass':{'G':{1:.2,2:.7,3:1.1}},
                        'moss':{'G':{1:.3,2:.8,3:1.1}},
                        'sand':{'S':{1:.2,2:.4,3:.7}},
                    }.get(kind,{})
                    for family,levels in roles.items():
                        for level,z in levels.items():
                            if symbol==ramp(family,level): value=z
                if name=='moss_roots' and g=='W': value=3.
                if name=='ruin_fragment' and g=='R': value=2.
            elif key=='flora':
                value=(23.+min(dist[y][x],10)*.65) if y<project['pivot'][1]-20 else 4.+min(dist[y][x],6)*.9
            elif key in ('explorer','villagers','actors') and name.startswith(('hero_','npc_')):
                value=(18. if y<24 else 11. if y<34 else 3.)+min(dist[y][x],5)*.6
            else:
                value=4.+min(dist[y][x],12)*1.05
            height[y][x]=min(32.,value)
    # 階段状の画素から急な照明ノイズを作らない。輪郭の外は混ぜない。
    smooth=[[0. for _ in range(w)] for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if not mask[y][x]: continue
            samples=[height[yy][xx] for yy in range(max(0,y-1),min(h,y+2))
                     for xx in range(max(0,x-1),min(w,x+2)) if mask[yy][xx]]
            smooth[y][x]=sum(samples)/len(samples)
    norm_rows=[]; height_rows=[]
    can_emit=any(word in name for word in ('torch','campfire','lantern','beacon_lit','wisp'))
    for y in range(h):
        nr=[]; hr=[]
        for x in range(w):
            if not mask[y][x]: nr.append('.');hr.append('.');continue
            def sample(xx,yy):
                return smooth[yy][xx] if 0<=xx<w and 0<=yy<h and mask[yy][xx] else smooth[y][x]
            dx=(sample(x+1,y)-sample(x-1,y))*.5
            dy=(sample(x,y+1)-sample(x,y-1))*.5
            length=math.sqrt(1+dx*dx+dy*dy)
            normal=(-dx/length,dy/length,1/length)
            index=min(range(len(VECTORS)),key=lambda i:sum((a-b)**2 for a,b in zip(VECTORS[i],normal)))
            if can_emit and group(x,y)=='H': index=len(NORMAL_COLORS)-1
            nr.append(SYMBOLS[index])
            # 基準光の補正は上限付き。輪郭/AO/色相差は完全なalbedo復元ではない。
            gain=1. if terrain or water else max(.8,min(1.25,1/(.55+.65*max(0,sum(a*b for a,b in zip(normal,REF))))))
            rough=.45 if water else .8
            hi=min(range(len(HEIGHT_VALUES)),key=lambda i:
                   (HEIGHT_VALUES[i][0]-smooth[y][x])**2+100*(HEIGHT_VALUES[i][1]-rough)**2+10*(HEIGHT_VALUES[i][2]-gain)**2)
            hr.append(SYMBOLS[hi])
        norm_rows.append(''.join(nr));height_rows.append(''.join(hr))
    return norm_rows,height_rows

def project_lines(project, palette, rows):
    w,h=project['size']; px,py=project['pivot']
    lines=[f'canvas {w} {h}',f'pivot {px} {py}']
    lines.extend(f'palette {SYMBOLS[i]} {color}' for i,color in enumerate(palette))
    for i,data in enumerate(rows): lines.extend([f'part p{i} {w} {h}','rows '+'|'.join(data)])
    for i,fr in enumerate(project['frames']):
        lines.extend([f'frame {fr["name"]} {fr["duration"]}',f'place image p{i} 0 0'])
    return Editor().apply('\n'.join(lines))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--sheet',action='append')
    args=parser.parse_args()
    manifest_path=GAME/'assets/manifest.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    output=GAME/'art/normalmaps';output.mkdir(exist_ok=True)
    for key,definition in manifest['sheets'].items():
        if key in ('ui','logo'): continue
        if args.sheet and key not in args.sheet: continue
        source=load(GAME/'art'/f'{key}.json')
        normal=[];height=[]
        for fr in source['frames']:
            nr,hr=fields(source,fr,key);normal.append(nr);height.append(hr)
        atlas=json.loads((GAME/'assets'/definition['atlas']).read_text(encoding='utf-8'))
        columns=atlas['meta']['size']['w']//source['size'][0]
        for kind,palette,rows in [('normal',NORMAL_COLORS,normal),('height',HEIGHT_COLORS,height)]:
            project=project_lines(source,palette,rows)
            save(project,output/f'{key}-{kind}.json')
            preview=GAME/'assets/r2-preview'/f'{key}-{kind}'
            report=export(project,preview,columns=columns)
            if report['warnings']: raise ValueError(report['warnings'])
            destination=GAME/'assets'/key/f'{kind}.png'
            destination.write_bytes((preview/'atlas.png').read_bytes())
            definition[kind]=f'{key}/{kind}.png'
        print('maps',key,len(source['frames']),flush=True)
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__': main()
