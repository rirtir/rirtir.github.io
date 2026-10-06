"""既存の形を下絵として、材質ごとの固定色と2pxクラスタでWorkbenchへ描き直す。"""
import argparse, json
from collections import Counter
from style import Canvas, COLORS, HEX_OF, SYMBOL_OF, RAMPS, GAME, compose, load, finish, header, part, frame
from restyle import merge_isolated

def rgb(color):
    return tuple(int(color[i:i+2],16) for i in (1,3,5))

def distance(a,b):
    return sum(w*(x-y)**2 for w,x,y in zip((.3,.59,.11),a,b))

def material(sheet, name):
    if sheet in ('guardian',): return 'KGMWRC'
    if sheet in ('warden',): return 'KRCHE'
    if any(word in name for word in ['copper','iron','crystal','stone','rock','grave','statue','ruin','stairs','altar']):
        return 'KRGCUILW'
    if any(word in name for word in ['leaf','fern','grass','flower','reeds','crop','bush','berry','moss_clump','drygrass','lilypad']):
        return 'KGPMWTHL'
    if sheet == 'creatures': return 'KGPCMBHL'
    if sheet in ('materials','equipment','foods','furniture_icons','icons','actors'): return ''.join(RAMPS)
    if any(word in name for word in ['water','shore']): return 'KAS'
    if sheet in ('tiles','edges','caveedges','quiet_ground'): return ''.join(RAMPS)
    return 'KWREGALH'

def repaint(project, sheet, source_frame):
    old = compose_old(project, source_frame)
    allowed = {SYMBOL_OF[c]:rgb(c) for group in material(sheet,source_frame['name']) for c in RAMPS[group]}
    lookup = {}
    for symbol,color in project['palette'].items():
        if symbol == '.' or color.lower().endswith('00') and len(color)==9:
            lookup[symbol]='.'
        else:
            original=rgb(color)
            lookup[symbol]=min(allowed,key=lambda s:distance(original,allowed[s]))
    cv=Canvas(*project['size'])
    cv.g=[[lookup.get(c,'.') for c in row] for row in old]
    limit=22 if sheet in ('guardian','warden') else 18 if max(project['size'])>=64 else 12
    counts=Counter(c for row in cv.g for c in row if c!='.')
    while len(counts)>limit:
        victim=min(counts,key=counts.get)
        replacement=min((c for c in counts if c!=victim),key=lambda c:distance(allowed[victim],allowed[c]))
        cv.g=[[replacement if c==victim else c for c in row] for row in cv.g]
        counts[replacement]+=counts.pop(victim)
    # 材質面の内側だけ2x2の塊へ整える。透明に接する輪郭と細い柄は残す。
    if sheet not in ('tools','materials','equipment','foods','furniture_icons','icons','crops','actors'):
        src=[row[:] for row in cv.g]
        for y in range(1,cv.h-2,2):
            for x in range(1,cv.w-2,2):
                area=[src[y+dy][x+dx] for dy in (0,1) for dx in (0,1)]
                if '.' in area or len(set(area))==1: continue
                border=[src[y-1][x],src[y-1][x+1],src[y+2][x],src[y+2][x+1],
                        src[y][x-1],src[y+1][x-1],src[y][x+2],src[y+1][x+2]]
                if '.' in border: continue
                common=Counter(area)
                if max(common.values())<2: continue
                dominant=max(common,key=common.get)
                for dy in (0,1):
                    for dx in (0,1):
                        if distance(allowed[src[y+dy][x+dx]],allowed[dominant])<2200:
                            cv.g[y+dy][x+dx]=dominant
    merge_isolated(cv.g,budget=.01)
    return cv

def compose_old(project, fr):
    # Workbenchのrenderで全レイヤの座標と反転を保つ。RGBAを独自加工しない。
    from engine import render
    image,_=render(project,fr)
    lookup={rgb(c):s for s,c in project['palette'].items() if s!='.' and not (len(c)==9 and c.endswith('00'))}
    pixels=list(image.getdata())
    return [['.' if pixels[y*image.width+x][3]<128 else lookup[pixels[y*image.width+x][:3]]
             for x in range(image.width)] for y in range(image.height)]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--sheet',action='append',required=True)
    args=parser.parse_args()
    for sheet in args.sheet:
        original=load(GAME/'art'/f'{sheet}.json')
        lines=header(tuple(original['size']),tuple(original['pivot']))
        for index,fr in enumerate(original['frames']):
            cv=repaint(original,sheet,fr)
            part(lines,f'p{index}',cv.rows())
        for index,fr in enumerate(original['frames']):
            frame(lines,fr['name'],[(f'p{index}',0,0)],duration=fr['duration'],tag=fr.get('tag',''))
        finish(sheet,lines)

if __name__=='__main__': main()
