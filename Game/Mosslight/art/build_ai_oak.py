"""原画をWorkbenchで固定色・整数画素へ取り込み、樹木の見本だけを更新する。"""
import argparse
from pathlib import Path
from style import Canvas, HEX_OF, ramp, finish, build_lines, compose, load, R2_DIR
from engine import import_image
from restyle import merge_isolated

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image', type=Path)
    args = parser.parse_args()
    colors = [ramp(g, i) for g, count in [('G', 6), ('W', 4), ('K', 3)] for i in range(1, count+1)]
    palette = {'.': '#00000000', **{symbol: HEX_OF[symbol] for symbol in colors}}
    project = import_image(args.image, size=(80, 84), palette=palette)
    imported = project['parts']['import0']
    cv = Canvas(96, 96)
    native = Canvas(80, 84)
    native.g = [list(row) for row in imported['rows']]
    merge_isolated(native.g, budget=0.015)
    # 最明部は葉先のまとまりに限定。小さな粒を一段落として点描を抑える。
    seen = set()
    bright = ramp('G', 6)
    for y in range(native.h):
        for x in range(native.w):
            if (x,y) in seen or native.g[y][x] != bright:
                continue
            queue, component = [(x,y)], []
            while queue:
                px,py = queue.pop()
                if (px,py) in seen or not (0 <= px < native.w and 0 <= py < native.h):
                    continue
                if native.g[py][px] != bright:
                    continue
                seen.add((px,py)); component.append((px,py))
                queue.extend([(px-1,py),(px+1,py),(px,py-1),(px,py+1)])
            if len(component) < 3:
                for px,py in component:
                    native.g[py][px] = ramp('G',5)
    # 幹の周囲だけ暗い葉の帯へまとめ、枝と抜け穴は保持する。
    wood = {ramp('W',i) for i in range(1,5)}
    ink = {ramp('K',i) for i in range(1,4)}
    for y in range(38,59):
        for x in range(22,46):
            if native.g[y][x] not in ink:
                continue
            near = [native.g[py][px] for px,py in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]]
            if '.' not in near and any(c in wood for c in near):
                native.g[y][x] = ramp('G',1)
    cv.paste(native, 8, 0)
    # 松はまだ旧見本。樹冠1本の画像レビューに通るまで量産しない。
    previous = load(R2_DIR/'trees.json')
    finish('trees', build_lines((96,96), (48,80), [('oak', cv), ('pine', compose(previous,'pine'))]))

if __name__ == '__main__':
    main()
