"""ボスと遺跡の細かな内側の粒を整理する試作。正本・manifestは変更しない。"""
from collections import Counter
import json
from pathlib import Path
import sys

from style import GAME, HEX_OF, GROUP_OF, SYMBOL_OF, Canvas, ramp
from engine import Editor, load, render
from pixelwork import export, save

sys.stdout.reconfigure(encoding='utf-8')
TARGETS = ('guardian', 'warden', 'landmarks')


def family(symbol):
    group = GROUP_OF.get(symbol, 'K')
    if group in ('W', 'E', 'S', 'L', 'T', 'U', 'I'):
        return 'earth'
    if group in ('G', 'P', 'M'):
        return 'leaf'
    return group


def chosen(key):
    if key == 'guardian':
        return [ramp('K', 1), ramp('K', 3)] + [ramp('W', i) for i in (1,2,3,4)] + [ramp('G', i) for i in (1,3,4,5)] + [ramp('M', i) for i in (1,2,3)] + [ramp('C', i) for i in (1,2,3,4)]
    if key == 'warden':
        return [ramp('K', 1), ramp('K', 3)] + [ramp('R', i) for i in (1,2,3,4,5)] + [ramp('E', i) for i in (1,2,3)] + [ramp('H', i) for i in (1,2,3)] + [ramp('C', i) for i in (1,2,4)]
    return [ramp('K', 1), ramp('K', 3)] + [ramp('R', i) for i in (2,3,4)] + [ramp('W', i) for i in (1,2,3)] + [ramp('E', i) for i in (2,3)] + [ramp('G', i) for i in (2,3,4,5)] + [ramp('L', i) for i in (1,2)] + [ramp('C', i) for i in (2,4)]


def rgb(symbol):
    return tuple(int(HEX_OF[symbol][i:i+2], 16) for i in (1,3,5))


def reduce_symbol(symbol, key, allowed):
    if symbol in allowed:
        return symbol
    group = GROUP_OF[symbol]
    if key == 'guardian' and group == 'R':
        return ramp('W', 1)
    # 同じ材質を優先し、ない材質だけ近い色へ接続する。
    candidates = [s for s in allowed if GROUP_OF[s] == group]
    if not candidates:
        candidates = [s for s in allowed if family(s) == family(symbol)] or allowed
    c = rgb(symbol)
    return min(candidates, key=lambda s:sum((a-b)**2 for a,b in zip(c,rgb(s))))


def flatten(project, frame):
    image, _ = render(project, frame)
    w,h = project['size']
    pixels = list(image.getdata())
    cv = Canvas(w,h)
    for y in range(h):
        for x in range(w):
            r,g,b,a = pixels[y*w+x]
            if a:
                cv.g[y][x] = SYMBOL_OF[f'#{r:02x}{g:02x}{b:02x}']
    return cv


def components(grid):
    h,w=len(grid),len(grid[0]); todo={(x,y) for y in range(h) for x in range(w) if grid[y][x]!='.'}
    sizes={}
    while todo:
        start=todo.pop(); symbol=grid[start[1]][start[0]]; queue=[start]; group=[]
        while queue:
            x,y=queue.pop();group.append((x,y))
            for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if (nx,ny) in todo and grid[ny][nx]==symbol:
                    todo.remove((nx,ny));queue.append((nx,ny))
        for cell in group:sizes[cell]=len(group)
    return sizes


def simplify(cv, key):
    allowed=chosen(key); w,h=cv.w,cv.h
    original=[row[:] for row in cv.g]
    grid=[[reduce_symbol(s,key,allowed) if s!='.' else '.' for s in row] for row in original]
    protected=set()
    # 顔の目・核・発光の周囲は変えない。α輪郭も色の整理だけに留める。
    for y in range(h):
        for x in range(w):
            s=grid[y][x]
            if s=='.':continue
            if family(s) in ('C','H'):
                protected.update((nx,ny) for ny in range(max(0,y-2),min(h,y+3)) for nx in range(max(0,x-2),min(w,x+3)))
            if any(nx<0 or ny<0 or nx>=w or ny>=h or grid[ny][nx]=='.' for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1))):
                protected.add((x,y))
    rounds=4 if key!='landmarks' else 2
    for _ in range(rounds):
        sizes=components(grid); result=[row[:] for row in grid]
        for y in range(2,h-2):
            for x in range(2,w-2):
                current=grid[y][x]
                if current=='.' or (x,y) in protected:continue
                nearby=Counter(grid[yy][xx] for yy in range(y-2,y+3) for xx in range(x-2,x+3) if grid[yy][xx]!='.')
                cardinal=sum(grid[yy][xx]==current for xx,yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)))
                if sizes[(x,y)]>10 and cardinal>2 and nearby[current]>7:continue
                candidates={s:n for s,n in nearby.items() if family(s)==family(current) or family(current)=='K'}
                candidates={s:n for s,n in candidates.items() if family(s) not in ('C','H')}
                if not candidates:continue
                winner=max(candidates,key=candidates.get)
                if candidates[winner]>=max(5,nearby[current]+2):result[y][x]=winner
        grid=result
    # 内部だけ2×2単位で同材質の色面へまとめる。境界・顔・発光は対象外。
    # 色を補間して増やさず、4画素中で最多の既存shadeを選ぶ。
    if key!='landmarks':
        for y in range(2,h-2,2):
            for x in range(2,w-2,2):
                cells=[(xx,yy) for yy in (y,y+1) for xx in (x,x+1)]
                if any((xx,yy) in protected or grid[yy][xx]=='.' for xx,yy in cells):continue
                shades=[grid[yy][xx] for xx,yy in cells]
                groups=Counter(GROUP_OF[s] for s in shades)
                material=max(groups,key=groups.get)
                if len(groups)>1:
                    if material=='K' or groups[material]<3 or any(g not in (material,'K') for g in groups):continue
                    candidates=[s for s in shades if GROUP_OF[s]==material]
                else:candidates=shades
                counts=Counter(candidates);winner=max(counts,key=counts.get)
                if counts[winner]<2:
                    # 明・中・暗が1pxずつ交互の内部は中間段を1面にする。
                    winner=sorted(candidates,key=lambda s:sum(rgb(s)))[len(candidates)//2]
                for xx,yy in cells:grid[yy][xx]=winner
    cv.g=grid
    changed=sum(a!=b for ra,rb in zip(original,grid) for a,b in zip(ra,rb))
    small_before=sum(n<=3 for n in components(original).values())
    small_after=sum(n<=3 for n in components(grid).values())
    return {'changed':changed,'small_cluster_pixels_before':small_before,'small_cluster_pixels_after':small_after,
            'used_colors':len({s for row in grid for s in row if s!='.'})}


def build(key):
    source=load(GAME/'art'/f'{key}.json')
    w,h=source['size']; pivot=source['pivot']; lines=[f'canvas {w} {h}',f'pivot {pivot[0]} {pivot[1]}']
    allowed=chosen(key);lines += [f'palette {s} {HEX_OF[s]}' for s in allowed]
    stats=[]
    for frame in source['frames']:
        cv=flatten(source,frame); original_mask=[[s!='.' for s in row] for row in cv.g]
        info=simplify(cv,key)
        if original_mask!=[[s!='.' for s in row] for row in cv.g]:raise ValueError('αシルエットを変更しています')
        lines.append(f'part {frame["name"]} {w} {h}')
        lines += [f'row {y} 0 {"".join(row)}' for y,row in enumerate(cv.g)]
        stats.append({'name':frame['name'],**info})
    for frame in source['frames']:
        lines += [f'frame {frame["name"]} {frame["duration"]}',f'tag {frame.get("tag","focus")}',f'place sprite {frame["name"]} 0 0']
    project=Editor().apply('\n'.join(lines))
    destination=GAME/'assets/r2-preview'/key
    save(project,GAME/'art/r2'/f'{key}.json')
    report=export(project,destination,previous=source,columns=4)
    # 原寸の静止画もWorkbenchのrenderで作る。Pillowで画像を編集しない。
    for frame in project['frames']:
        render(project,frame)[0].save(destination/f'{frame["name"]}-native.png')
    (destination/'cluster-report.json').write_text(json.dumps(stats,indent=2)+'\n',encoding='utf-8')
    print(key, 'warnings',len(report['warnings']),json.dumps(stats))


if __name__=='__main__':
    for target in TARGETS:build(target)
