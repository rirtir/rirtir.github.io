"""束5: 水・洞窟の壁・地表の崖のenvironmentシート（32x32、pivot 0,0）をWorkbenchへ出力する。

使い方: python art/build_style_environment.py
出力: art/r2/environment.{dot,json} / assets/r2-preview/environment/ だけ（既存manifestには触れない）
frame名は既存どおり。cavewall_top の連結は N=1 E=2 S=4 W=8（その側が壁なら立てる）。
*wall_face は32x32全面を描く: 上12行=壁の上面、下20行=南向きの前面。
岩の面は矩形にせず、不規則な多角形を「明・中・暗」の3面（対角の斜面）に塗り分ける。
左右の端と上面/前面の境の位置はvariantを問わず固定し、隣接タイルとの輪郭ずれを小さくする。
"""
import random

from style import Canvas, build_lines, finish, ramp

N = 32
WAVE_SHIFT = (0, 1, 2, 1)   # 4コマで往復する横ずれ。形は変えず、ループの継ぎ目でも跳ばない
K0 = ramp('K', 1)


def waves(deep):
    """波紋の(行, 開始x, 長さ)。行は4px以上離す。全コマで同じ形。"""
    rng = random.Random('deep' if deep else 'shallow')
    rows = sorted(rng.sample(range(2, 30, 4), 4 if deep else 5))
    return [(y, rng.randrange(N), rng.choice((5, 6, 7))) for y in rows]


def tile_water(deep, frame):
    """浅い水はA3の地にA4の波紋(2px厚)とA5の短い光。深い水はA2の地にA3の波紋と、動かないA1の暗がり。"""
    base, wave = (ramp('A', 2), ramp('A', 3)) if deep else (ramp('A', 3), ramp('A', 4))
    cv = Canvas(N, N, base)
    if deep:
        for x, y in ((5, 8), (19, 21)):
            cv.rect(x, y, 7, 3, ramp('A', 1))
    for y, x0, length in waves(deep):
        x0 += WAVE_SHIFT[frame]
        for i in range(length):
            cv.set(x0 + i, y, wave, wrap=True)
            cv.set(x0 + i, y + 1, wave, wrap=True)
        if not deep:
            for i in range(3):
                cv.set(x0 + 1 + i, y, ramp('A', 5), wrap=True)
    return cv


# ---- 岩の面を作る共通部品 ----

def shape(pts):
    """多角形の画素集合（タイル内に切り取る）。"""
    tmp = Canvas(N, N)
    tmp.poly(pts, '#')
    return {(x, y) for y in range(N) for x in range(N) if tmp.g[y][x] == '#'}


def wobble(pts, rng):
    """頂点を±1ずらす。タイル外(x<=-1, x>=33)の頂点は隣接タイルとの継ぎ目なので動かさない。"""
    return [(x, y) if x <= -1 or x >= 33 else (x + rng.choice((-1, 0, 1)), y + rng.choice((-1, 0, 1))) for x, y in pts]


def facet(cv, pts, tones, rng, hi=None):
    """多角形を 明/中/暗 の3面に塗る。境界は対角の斜面で、行ごとにわずかに揺らす。返り値は画素集合。"""
    lit, mid, dark = tones
    area = shape(pts)
    x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    shift, wob = 0.0, {}
    for y in range(y0, y1 + 1):
        shift = max(-0.1, min(0.1, shift + rng.choice((-0.04, 0, 0.04))))
        wob[y] = shift
    for x, y in area:
        u = (x + 0.5 - x0) / w + (y + 0.5 - y0) / h + wob[y]
        c = lit if u < 0.6 else dark if u > 1.25 else mid
        if c != lit and y + 1 < N and (x, y + 1) not in area:
            c = dark   # 下の縁は暗くして接地・段差を締める
        cv.set(x, y, c)
    if hi:
        top = sorted((x, y) for x, y in area if y > 0 and (x, y - 1) not in area and cv.get(x, y) == lit)
        if top:
            sx, sy = top[rng.randrange(len(top))]
            for k in range(4):
                if (sx + k, sy) in area and cv.get(sx + k, sy) == lit:
                    cv.set(sx + k, sy, hi)
    return area


def crack_line(cv, x, y, length, rng, c, area=None):
    """細い割れ目。2行ごとに最大1px曲がり、面の外へ出たら止める。"""
    for i in range(length):
        if area is not None and (x, y) not in area:
            break
        cv.set(x, y, c)
        if i % 2 == 1:
            x += rng.choice((-1, 0, 1))
        y += 1


def top_edge(area, lo, hi):
    """面の上縁の画素のうち x が lo..hi のもの。"""
    return sorted((x, y) for x, y in area if lo <= x <= hi and (x, y - 1) not in area)


# ---- 洞窟の上面 ----

# 面の頂点。どれも内側(4..28)に収め、タイルの縁の連結を壊さない。
TOP_LAYOUTS = (
    (((5, 5), (17, 4), (21, 9), (18, 15), (8, 16), (4, 11)),
     ((15, 19), (26, 17), (28, 24), (22, 28), (12, 26)),
     ((23, 6), (28, 8), (27, 14), (24, 13))),
    (((6, 4), (14, 5), (16, 12), (10, 17), (4, 13)),
     ((18, 8), (27, 7), (28, 17), (22, 19), (18, 14)),
     ((8, 21), (20, 22), (24, 27), (10, 28), (5, 25))),
    (((4, 6), (11, 4), (20, 6), (22, 13), (12, 14), (5, 12)),
     ((6, 18), (17, 17), (19, 24), (14, 28), (6, 26)),
     ((21, 17), (28, 19), (27, 27), (22, 26))),
)


def rim_profile(side):
    """開いた辺の欠けの深さ(1〜3px)。辺ごとに固定で、両端は1pxにして隣接タイルとの段差を抑える。"""
    rng = random.Random(f'rim:{side}')
    prof = []
    while len(prof) < N:
        prof += [rng.choice((1, 2, 3))] * rng.randint(2, 5)
    prof = prof[:N]
    prof[0] = prof[-1] = 1
    return prof


def cave_top(mask):
    """洞窟の上面: R3の地にR4の大きな非矩形面2〜3個、面の下側のR2の短い斜面、R1の割れ目1〜2本。
    開いた辺(壁でない側)だけ1〜3pxの欠けをR2/R1で不規則に作る。連結した辺は何も描かず隣へ続く。"""
    rng = random.Random(f'top:{mask}')
    cv = Canvas(N, N, ramp('R', 3))
    layout = TOP_LAYOUTS[mask % 3]
    flip = bool(mask & 2)
    areas = []
    for pts in layout:
        pts = [(N - x, y) for x, y in pts] if flip else list(pts)
        areas.append(facet(cv, wobble(pts, rng), (ramp('R', 4), ramp('R', 4), ramp('R', 3)), rng,
                           hi=ramp('R', 5) if not areas else None))
    # 面の下縁に沿った局所の斜面（8px幅まで）
    for area in areas:
        edge = sorted((x, y) for x, y in area if (x, y + 1) not in area and y + 1 < N)
        if edge:
            start = rng.choice(edge)[0]
            for x, y in edge:
                if start <= x < start + 8 and cv.get(x, y + 1) == ramp('R', 3):
                    cv.set(x, y + 1, ramp('R', 2))
    # 割れ目
    for area in areas[:1 + (mask % 2)]:
        top = top_edge(area, 0, N)
        if top:
            x, y = top[max(0, min(len(top) - 1, len(top) // 2 + rng.randint(-2, 2)))]
            crack_line(cv, x, y + 1, rng.randint(6, 9), rng, ramp('R', 1))
    # 開いた辺の欠け
    for bit, side in ((1, 'N'), (4, 'S'), (2, 'E'), (8, 'W')):
        if mask & bit:
            continue
        for i, depth in enumerate(rim_profile(side)):
            for k in range(depth):
                c = ramp('R', 1) if k == 0 and depth >= 2 else ramp('R', 2)
                x, y = {'N': (i, k), 'S': (i, N - 1 - k), 'E': (N - 1 - k, i), 'W': (k, i)}[side]
                cv.set(x, y, c)
    return cv


# ---- 洞窟の前面（南向き） ----

def lump(cv, cx, cy, rx, ry, colors):
    """鉱塊: 暗い縁で地の岩から切り離し、左上を明、右下を暗にした楕円。"""
    shade, body, lit = colors
    cv.ellipse(cx, cy, rx + 1, ry + 1, ramp('R', 1))
    for y in range(cy - ry - 1, cy + ry + 1):
        for x in range(cx - rx - 1, cx + rx + 1):
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            if dx * dx + dy * dy <= 1:
                t = dx + dy
                cv.set(x, y, lit if t < -0.7 else shade if t > 0.6 else body)


def spike(cv, cx, cy, height):
    """青緑の結晶（遺跡用）: 左を明るく、先端と根元で締める。"""
    top, base = cy - height // 2, cy + height // 2
    area = shape([(cx - 2, base), (cx - 1, top + 2), (cx, top), (cx + 1, top + 2), (cx + 2, base)])
    for x, y in area:
        cv.set(x, y, ramp('C', 4) if y == top else ramp('C', 1) if y == base - 1 else ramp('C', 3) if x < cx else ramp('C', 2))


def find_spots(solid, cv, rng, count, hw, hh):
    """岩の中で hw x hh の余白が全部岩(割れ目を含まない)の場所を、間隔8px以上で探す。"""
    spots = []
    for _ in range(600):
        if len(spots) == count:
            break
        cx, cy = rng.randint(4, 27), rng.randint(14, 27)
        if any(max(abs(cx - a), abs(cy - b)) < 8 for a, b in spots):
            continue
        cells = [(x, y) for x in range(cx - hw, cx + hw + 1) for y in range(cy - hh, cy + hh + 1)]
        if all((x, y) in solid and cv.get(x, y) != K0 for x, y in cells):
            spots.append((cx, cy))
    return spots


def wall_face(spec, variant):
    """前面: 裂け目の深い影の中に、非矩形の大きな岩体3つ。上12行はR4/R3の面とR1の割れ目の上面。"""
    rng = random.Random(f'face:{variant}')
    cv = Canvas(N, N, ramp('R', 2))
    cv.rect(0, 11, N, 21, ramp('R', 1))
    cv.rect(0, 28, N, 4, K0)   # 岩の隙間の底だけが接地の黒になる（岩が覆うので帯にならない）
    # 上面: 左右の端は固定。2枚の面とその間のR1の裂け目
    tones = (ramp('R', 4), ramp('R', 4), ramp('R', 3))
    facet(cv, wobble([(-1, -1), (16, -1), (18, 4), (13, 8), (-1, 8)], rng), tones, rng, hi=ramp('R', 5))
    facet(cv, wobble([(19, -1), (33, -1), (33, 7), (27, 9), (22, 6)], rng), tones, rng)
    crack_line(cv, 17 + rng.randint(0, 2), 0, 11, rng, ramp('R', 1))
    # 前面の岩体
    rock = (ramp('R', 4), ramp('R', 3), ramp('R', 2))
    parts = [
        wobble([(-1, 11), (8, 10), (17, 11), (19, 17), (15, 23), (8, 24), (-1, 22)], rng),
        wobble([(21, 11), (33, 11), (33, 21), (28, 23), (23, 20), (20, 15)], rng),
        wobble([(-1, 26), (8, 27), (15, 26), (21, 24), (27, 25), (33, 24), (33, 32), (25, 32),
                (17, 31), (9, 32), (-1, 32)], rng),
    ]
    areas = [facet(cv, pts, rock, rng, hi=ramp('R', 5) if n == 0 else None) for n, pts in enumerate(parts)]
    solid = set().union(*areas)
    # 深い亀裂（大きい岩体の上縁から）
    for area in (areas[0], areas[2]):
        top = top_edge(area, 6, 24)
        if top:
            x, y = top[rng.randrange(len(top))]
            crack_line(cv, x, y + 1, rng.randint(6, 9), rng, K0, area)
    if spec.get('joints'):
        # 遺跡: 各岩体に縦の継ぎ目を1本。小さなレンガにせず、巨大な加工石の節に見せる
        for area in areas:
            xs = sorted(x for x, _ in area)
            jx = xs[len(xs) * (2 + variant) // 7]
            tops = [y for x, y in area if x == jx]
            for y in range(min(tops) + 1, min(tops) + 8):
                if (jx, y) in area:
                    cv.set(jx, y, ramp('R', 1))
    if spec.get('ore'):
        shade, body, lit = spec['ore']
        for n, (cx, cy) in enumerate(find_spots(solid, cv, rng, 2 + variant % 3, 3, 2)):
            rx = 3 if n % 2 == 0 else 2
            lump(cv, cx, cy, rx, 2, spec['ore'])
            sx, sy = cx + rx + 2, cy + 2
            if all((x, y) in solid and cv.get(x, y) != K0 for x in range(sx - 3, sx + 3) for y in range(sy - 3, sy + 2)):
                lump(cv, sx, sy, 2, 1, spec['ore'])
    if spec.get('crystal') and variant in spec['crystal']:
        for cx, cy in find_spots(solid, cv, rng, 1, 4, 5):
            spike(cv, cx, cy, 8)
            spike(cv, cx + 4, cy + 2, 5)
    if variant in (1, 2):
        # 付着苔: 2〜4pxの小さな面をごく少数
        top = top_edge(areas[1], 22, 29)
        if top:
            x, y = top[rng.randrange(len(top))]
            for px, py, c in ((x, y, ramp('G', 4)), (x + 1, y, ramp('G', 3)), (x, y + 1, ramp('G', 3)), (x + 1, y + 1, ramp('G', 2))):
                if (px, py) in areas[1]:
                    cv.set(px, py, c)
    return cv


FACES = {
    'cavewall_face': {},
    'copperwall_face': dict(ore=(ramp('U', 1), ramp('U', 2), ramp('U', 3))),
    'ironwall_face': dict(ore=(ramp('I', 1), ramp('I', 2), ramp('X', 1))),
    'ruinwall_face': dict(joints=True, crystal=(1, 3)),
}


# ---- 地表の崖 ----

def grass_depth(rng):
    """草の下縁の深さ(0〜3px)。山形を連ねて縁をジグザグにする。両端は0で隣のタイルとつながる。"""
    depth, x = [], 0
    while x < N:
        w = rng.randint(4, 6) if N - x > 7 else N - x
        peak = rng.randint(1, 3)
        for i in range(w):
            depth.append(round(peak * (1 - abs(2 * (i + 0.5) / w - 1))))
        x += w
    return depth


def cliff_face(variant):
    """地表の崖: 上は草のジグザグ縁と細い根2本、下は土/岩の大きな斜面3個。接地のK1は隙間の底だけ。"""
    rng = random.Random(f'cliff:{variant}')
    cv = Canvas(N, N, ramp('E', 1))
    cv.rect(0, 28, N, 4, K0)
    dirt = (ramp('E', 4), ramp('E', 3), ramp('E', 2))
    rock = (ramp('R', 4), ramp('R', 3), ramp('R', 2))
    bodies = [
        (wobble([(-1, 4), (19, 4), (22, 11), (17, 18), (10, 22), (-1, 20)], rng), dirt, ramp('E', 5)),
        (wobble([(21, 4), (33, 4), (33, 17), (27, 20), (22, 15)], rng), dirt, ramp('E', 5)),
        (wobble([(-1, 23), (9, 21), (20, 22), (26, 19), (33, 18), (33, 32), (27, 29), (21, 31),
                 (14, 29), (8, 31), (-1, 32)], rng), rock if variant % 2 else dirt, ramp('R', 5) if variant % 2 else None),
    ]
    for pts, tones, hi in bodies:
        facet(cv, pts, tones, rng, hi=hi)
    # 草の縁
    depth = grass_depth(rng)
    for x in range(N):
        h = 5 + depth[x]
        for y in range(h):
            cv.set(x, y, ramp('G', 4) if y == 0 else ramp('G', 2) if y == h - 1 else ramp('G', 3))
    # 草から垂れる細い根2本
    for x in (rng.randint(4, 12), rng.randint(19, 27)):
        y = 5 + depth[x]
        for i in range(rng.randint(6, 9)):
            cv.set(x, y + i, ramp('E', 1))
            if i % 3 == 2:
                x += rng.choice((-1, 1))
    return cv


def cliff_end(left):
    """崖の端の欠け: 草(上6行)と土を、行ごとに幅の違う不規則な縁にした面。右は左の反転。"""
    rng = random.Random('cliff_end')
    cv = Canvas(N, N)
    w = 4
    for y in range(N):
        if y < 6:
            w, g = (2, 2, 3, 3, 3, 2)[y], True
        else:
            w = 2 if y >= 30 else max(3, min(5, w + rng.choice((-1, 0, 0, 1))))
            g = False
        for x in range(w):
            if g:
                cv.set(x, y, ramp('G', 1) if x == 0 else ramp('G', 2) if x == 1 else ramp('G', 3))
            else:
                cv.set(x, y, ramp('E', 1) if x == 0 else ramp('E', 2) if x == 1 else ramp('E', 3))
    return cv if left else cv.flipped()


def main():
    items = [(f'{"deepwater" if deep else "water"}{f}', tile_water(deep, f)) for deep in (False, True) for f in range(4)]
    items += [(f'cavewall_top{m}', cave_top(m)) for m in range(16)]
    items += [(f'{name}{v}', wall_face(spec, v)) for name, spec in FACES.items() for v in range(4)]
    items += [(f'cliff_face{v}', cliff_face(v)) for v in range(4)]
    items += [('cliff_left', cliff_end(True)), ('cliff_right', cliff_end(False))]
    finish('environment', build_lines((N, N), (0, 0), items))


if __name__ == '__main__':
    main()
