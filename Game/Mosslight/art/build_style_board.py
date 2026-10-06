"""束1: スタイル見本ボード（native 320x180）を、左右2つのsub-boardとしてWorkbenchで描く。

Workbenchのcanvas上限は256なので、縮小せず 160x180 の左右2枚に分け、HTML/CSSで原寸のまま横に並べる。
地面はグリッドで左右にまたがって連続し、物（木・岩・茂み・丸太・hero/house）は必ず片方のsub-boardに収める。
このスクリプトはPillowで合成しない。.review/style-board.png は style-board.html をPlaywrightで
320x180 screenshot して保存する（Codex担当）。

前提: build_style_ground.py と build_style_nature.py を先に実行して art/r2/{ground,edges,trees,props}.json があること。
hero / house は art/r2/hero.json / art/r2/house.json があれば先頭frameを置き、無ければ読み飛ばす。

使い方: python art/build_style_board.py
出力: art/r2/style_board_{left,right}.{dot,json} / assets/r2-preview/style_board_{left,right}/
      .review/style-board-{left,right}.png と .review/style-board.html
"""
import argparse
import random

from style import (Canvas, REVIEW_DIR, R2_DIR, compose, finish, frame, header, load, part, ramp,
                   render_image)

BOARD_W, BOARD_H, SUB_W = 320, 180, 160
CELL = 32
COLS, ROWS = BOARD_W // CELL, 6   # 6行目は20pxだけ見える（canvasの下端で切る）
MARGIN = 2

# 地形図（D=暗い草 g=草 t=土 p=踏み跡 s=砂 w=水）。奥の2行は森の暗い地、手前右に浜。
TERRAIN_MAP = [
    'DDDDDDDDDD',
    'DDDDDDDDDD',
    'gggggggggg',
    'ggtttggggg',
    'gttpttggss',
    'gggttgssww',
]
FAMILY = {'D': 'darkgrass', 'g': 'grass', 't': 'dirt', 'p': 'dirt', 's': 'sand', 'w': 'water'}
PLAIN = {'D': 'darkgrass', 'g': 'grass', 't': 'dirt', 'p': 'path', 's': 'sand'}
PRIORITY = ('water', 'sand', 'dirt', 'grass', 'darkgrass')   # 低い方から重ねる
# 接地の影（整数座標の画素の楕円・ぼかさない）の半径 (rx, ry)
SHADOW = {'oak': (24, 4), 'pine': (20, 4), 'rock': (19, 4), 'smallrock0': (8, 2), 'smallrock1': (7, 2),
          'bush': (13, 3), 'log': (16, 3), 'hero': (7, 2)}

# 配置表: (sheet, frame, 接地点x, 接地点y)  座標は各sub-board内。ここを直せば配置が変わる。
OBJECTS = {
    'left': [
        ('trees', 'pine', 42, 78), ('trees', 'oak', 108, 82),
        ('house', None, 54, 168), ('hero', None, 138, 168),
        ('props', 'rock', 120, 134), ('props', 'smallrock0', 98, 146), ('props', 'smallrock1', 142, 152),
        ('props', 'bush', 56, 172),
    ],
    'right': [
        ('trees', 'oak', 48, 80), ('trees', 'pine', 118, 80),
        ('props', 'log', 52, 138), ('props', 'bush', 24, 120),
        ('props', 'smallrock0', 96, 132), ('props', 'rock', 112, 164), ('props', 'smallrock1', 40, 160),
    ],
}


def load_sheet(name, optional=False):
    path = R2_DIR / f'{name}.json'
    if not path.exists():
        if optional:
            print(f'skip: {path.name} が無いので {name} は置きません')
            return None
        raise FileNotFoundError(f'{path} がありません。先に build_style_ground.py / build_style_nature.py を実行してください')
    return load(path)


def frame_name(project, wanted):
    return wanted if wanted else project['frames'][0]['name']


def terrain_at(i, j):
    """セル座標のはみ出しは端のセルと同じとして扱う（縁の房が画面端で出ないように）。"""
    return TERRAIN_MAP[min(max(j, 0), ROWS - 1)][min(max(i, 0), COLS - 1)]


def bake_ground(ground, edges):
    """セルごとの基準タイル → 地形の優先順にdual-gridの縁を重ねて、320x192の地面を作る。"""
    cv = Canvas(COLS * CELL, ROWS * CELL)
    rng = random.Random('board-ground')
    names = {f['name'] for f in edges['frames']}
    variant = {}
    for j in range(ROWS):
        for i in range(COLS):
            code = TERRAIN_MAP[j][i]
            if code == 'w':
                cv.paste(Canvas(CELL, CELL, ramp('A', 2)), i * CELL, j * CELL)
                continue
            # 同じ変種を横・縦に続けない
            choices = [v for v in range(6) if v != variant.get((i - 1, j)) and v != variant.get((i, j - 1))]
            variant[(i, j)] = rng.choice(choices)
            cv.paste(compose(ground, f'{PLAIN[code]}{variant[(i, j)]}'), i * CELL, j * CELL)
    for terrain in PRIORITY[1:]:
        rank = PRIORITY.index(terrain)
        for j in range(ROWS + 1):
            for i in range(COLS + 1):
                cells = [FAMILY[terrain_at(i - 1, j - 1)], FAMILY[terrain_at(i, j - 1)],
                         FAMILY[terrain_at(i - 1, j)], FAMILY[terrain_at(i, j)]]
                # 優先順が同じか高いセルは「縁の地形側」として塗り、高い地形の縁がそれを上書きする
                mask = sum(bit for bit, fam in zip((1, 2, 4, 8), cells) if PRIORITY.index(fam) >= rank)
                if mask in (0, 15):
                    continue
                others = {fam for fam in cells if PRIORITY.index(fam) < rank}
                kind = terrain
                if terrain == 'grass' and 'sand' in others:
                    kind = 'grass_sand'
                if terrain == 'sand' and 'water' in others:
                    kind = 'sand_water'
                name = f'edge_{kind}_{mask}'
                if name not in names:
                    raise KeyError(f'edges.json に {name} がありません')
                cv.paste(compose(edges, name), i * CELL - CELL // 2, j * CELL - CELL // 2)
    paint_water(cv)
    return cv


def paint_water(cv):
    """水セルの色を岸からの距離で4段にし、岸沿いにA6の泡を途切れた線で引く（見本ボード用の仮表現）。"""
    deep = ramp('A', 2)
    water = [[cv.g[y][x] == deep and TERRAIN_MAP[min(y // CELL, ROWS - 1)][x // CELL] == 'w' for x in range(cv.w)]
             for y in range(cv.h)]
    far = 999
    dist = [[0 if not water[y][x] else far for x in range(cv.w)] for y in range(cv.h)]
    for y in range(cv.h):
        for x in range(cv.w):
            if dist[y][x]:
                dist[y][x] = min(dist[y][x], (dist[y - 1][x] if y else far) + 1, (dist[y][x - 1] if x else far) + 1)
    for y in range(cv.h - 1, -1, -1):
        for x in range(cv.w - 1, -1, -1):
            if dist[y][x]:
                dist[y][x] = min(dist[y][x], (dist[y + 1][x] if y < cv.h - 1 else far) + 1,
                                 (dist[y][x + 1] if x < cv.w - 1 else far) + 1)
    for y in range(cv.h):
        for x in range(cv.w):
            if not water[y][x]:
                continue
            d = dist[y][x]
            if d == 1 and (x // 3) % 2 == 0:
                cv.g[y][x] = ramp('A', 6)
            elif d <= 7:
                cv.g[y][x] = ramp('A', 4)
            elif d <= 14:
                cv.g[y][x] = ramp('A', 3)


def shadow_color(side, x, y):
    code = terrain_at((x + (SUB_W if side == 'right' else 0)) // CELL, y // CELL)
    return ramp('S', 1) if code == 's' else ramp('E', 2) if code in 'tp' else ramp('G', 1)


def place_objects(side, sources):
    """配置表から (part名, Canvas, x, y) を奥→手前の順に作る。sub-boardからはみ出す配置は即エラー。"""
    placed = []
    for n, (sheet, wanted, x, y) in enumerate(sorted(OBJECTS[side], key=lambda o: o[3])):
        project = sources.get(sheet)
        if project is None:
            continue
        name = frame_name(project, wanted)
        sprite, ox, oy = compose(project, name).trim()
        px, py = project['pivot']
        pos = (x - px + ox, y - py + oy)
        if pos[0] < MARGIN or pos[0] + sprite.w > SUB_W - MARGIN or pos[1] < 0 or pos[1] + sprite.h > BOARD_H:
            raise ValueError(f'{side}: {sheet}/{name} が余白{MARGIN}pxを割ってsub-boardからはみ出します（位置{pos} 大きさ{sprite.w}x{sprite.h}）')
        shadow = SHADOW.get(name if sheet != 'hero' else 'hero')
        if shadow:
            rx, ry = shadow
            cv = Canvas(2 * rx + 1, 2 * ry + 1)
            cv.ellipse(rx + 0.5, ry + 0.5, rx + 0.5, ry + 0.5, shadow_color(side, x, y))
            placed.append((f's{n}_{name}', cv, x - rx, y - 1 - ry))
        placed.append((f'o{n}_{name}', sprite, pos[0], pos[1]))
    return placed


def board_project(side, ground_cv, sources):
    lines = header((SUB_W, BOARD_H), (0, 0))
    placed = [('ground', ground_cv, 0, 0)] + place_objects(side, sources)
    for name, cv, _, _ in placed:
        part(lines, name, cv.rows())
    frame(lines, 'board', [(name, x, y) for name, _, x, y in placed])
    return finish(f'style_board_{side}', lines)


HTML = """<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<title>Mosslight style board 320x180</title>
<style>
html, body {{ margin: 0; background: #000; }}
#board {{ position: relative; width: {w}px; height: {h}px; overflow: hidden; }}
#board img {{ position: absolute; top: 0; display: block; image-rendering: pixelated; }}
</style>
<div id="board">
<img src="style-board-left.png" style="left: 0" width="{sub}" height="{h}" alt="">
<img src="style-board-right.png" style="left: {sub}px" width="{sub}" height="{h}" alt="">
</div>
"""


def main():
    argparse.ArgumentParser(description='束1 スタイル見本ボード（左右sub-board + HTML）を出力する').parse_args()
    ground, edges = load_sheet('ground'), load_sheet('edges')
    sources = {'trees': load_sheet('trees'), 'props': load_sheet('props'),
               'hero': load_sheet('explorer', optional=True), 'house': load_sheet('house', optional=True)}
    baked = bake_ground(ground, edges)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for side, x0 in (('left', 0), ('right', SUB_W)):
        project = board_project(side, baked.crop(x0, 0, SUB_W, BOARD_H), sources)
        path = REVIEW_DIR / f'style-board-{side}.png'
        render_image(project, 0).save(path)
        print(f'wrote {path.relative_to(REVIEW_DIR.parent)}')
    html = REVIEW_DIR / 'style-board.html'
    html.write_text(HTML.format(w=BOARD_W, h=BOARD_H, sub=SUB_W), encoding='utf-8')
    print(f'wrote {html.relative_to(REVIEW_DIR.parent)}')


if __name__ == '__main__':
    main()
