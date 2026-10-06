"""束1の見本: 広葉樹oak・松pine・大岩rock・小岩smallrock0/1・茂みbush・丸太logを直接描く。

第2巡（STYLE_BOARD_REVIEW.md）の作り直し:
- 樹冠は判子の敷き詰めをやめ、4〜5個の「大房」と葉先4形の2階層。房の継ぎ目にG1の窪み、下側に抜け穴と枝。
- 松は段の縁に下向きの枝先（幅7・幅5）を並べる。
- 岩は上面の平板をやめ、丸い岩の重なり（球面の明暗・R1の継ぎ目溝・接地影・垂れる苔）。
これはCodexが目視で直すための編集可能な試作（形は seed と座標表で調整できる）。

使い方: python art/build_style_nature.py [--only trees|props]
出力: art/r2/trees.{dot,json}（96x96 pivot 48,80） / art/r2/props.{dot,json}（64x56 pivot 32,48）
"""
import argparse
import math
import random
from collections import Counter

from style import Canvas, build_lines, finish, group_of, outline, ramp

TREE_SIZE, TREE_PIVOT = (96, 96), (48, 80)
PROP_SIZE, PROP_PIVOT = (64, 56), (32, 48)

# 葉先の4形（5が葉先の画素）。G4の帯にはG5、G3の帯にはG4で置く
LEAF_TIPS = (('55', '5.'), ('.5', '55'), ('555', '.5.'), ('5.', '55', '.5'))
# 抜け穴の中に見える枝（2がW2、.は透明）
HOLE_PATTERNS = (('.....', '...22', '.222.', '22...'), ('....', '..22', '222.'))
# 松の枝先。数字は明るさ（3が最も明、1が最も暗）で、段の左・中・右の色と小さい方を採る
PINE_TIPS = (('3332221', '.33221.', '..321..'), ('33221', '.321.', '..1..'))


def runs(rng, xs, lo, hi):
    """並んだ列を、lo〜hi列ずつの連なりに区切る。"""
    out, i = [], 0
    while i < len(xs):
        n = rng.randint(lo, hi)
        out.append(xs[i:i + n])
        i += n
    return out


def lobe_columns(cx, cy, w, h, rng):
    """大房の列ごとの(上端行, 下端行)。下半分は楕円、上の縁は幅3〜6pxの凸で波打つ（同じ幅を続けない）。"""
    rx, ry = w / 2, h / 2
    xs = [x for x in range(math.floor(cx - rx) - 1, math.ceil(cx + rx) + 2) if abs((x + 0.5 - cx) / rx) < 1]
    lifts, i, prev = {}, 0, 0
    while i < len(xs):
        width = rng.choice([v for v in (3, 4, 5, 6) if v != prev])
        prev = width
        peak = rng.choice((3.0, 3.4, 3.8))
        for j in range(min(width, len(xs) - i)):
            v = (2 * j + 1 - width) / width
            lifts[xs[i + j]] = math.floor(peak * math.sqrt(1 - v * v))
        i += width
    cols = {}
    for x in xs:
        e = math.sqrt(1 - ((x + 0.5 - cx) / rx) ** 2)
        lift = lifts[x] if e >= 0.5 else 0
        top = math.ceil(cy - ry * e - lift - 0.5)
        bot = math.floor(cy + ry * e - 0.5)
        if bot - top >= 1:
            cols[x] = (top, bot)
    return cols


def paint_lobe(cv, owner, idx, spec, rng):
    """大房を1つ描く。先に、手前になる房の上の縁から奥の房へ3〜5行のG1の窪みを落とし、そのあと自分を塗る。

    段は上35%=G4・中35%=G3・下30%=G2・最下2行=G1。段の境目は左を下げ右を上げ、3〜5列ごとの段差でつなぐ。
    """
    cx, cy, w, h = spec
    rx, ry = w / 2, h / 2
    cols = lobe_columns(cx, cy, w, h, rng)
    xs = sorted(cols)
    for run in runs(rng, xs, 4, 7):
        depth = rng.choice((3, 4, 5))
        for x in run:
            top = cols[x][0]
            for k in range(1, depth + 1):
                c = cv.get(x, top - k)
                if c != '.' and group_of(c) == 'G':
                    cv.set(x, top - k, ramp('G', 1))
    shift = {}
    for run in runs(rng, xs, 3, 5):
        mid = run[len(run) // 2] + 0.5
        s = round((cx - mid) / rx * 2.5) + rng.choice((-1, 0, 1))
        for x in run:
            shift[x] = s
    t0 = cy - ry
    for x in xs:
        top, bot = cols[x]
        b4 = t0 + 0.35 * h + shift[x]
        b3 = t0 + 0.70 * h + shift[x]
        for y in range(top, bot + 1):
            if y >= bot - 1:
                c = ramp('G', 1)
            elif y + 0.5 < b4:
                c = ramp('G', 4)
            elif y + 0.5 < b3:
                c = ramp('G', 3)
            else:
                c = ramp('G', 2)
            cv.set(x, y, c)
            owner[(x, y)] = idx


def try_tip(cv, owner, idx, shape, x, y, reserved):
    """葉先を1つ置く。形の全画素が同じ房・同じ段（G4かG3）にあり、他の葉先や穴と接しない時だけ。"""
    pts = [(x + i, y + j) for j, row in enumerate(shape) for i, ch in enumerate(row) if ch == '5']
    if any(p in reserved or owner.get(p) != idx for p in pts):
        return False
    found = {cv.get(*p) for p in pts}
    if found == {ramp('G', 4)}:
        paint = ramp('G', 5)
    elif found == {ramp('G', 3)}:
        paint = ramp('G', 4)
    else:
        return False
    for p in pts:
        cv.set(p[0], p[1], paint)
    reserved.update((p[0] + a, p[1] + b) for p in pts for a in (-1, 0, 1) for b in (-1, 0, 1))
    return True


def place_tips(cv, owner, idx, spec, rng, limit, reserved):
    """葉先を、房の上の縁と同心の弧に沿って、4〜5pxの段ごと・5〜8px間隔で置く（段ごとに半ピッチずらし、同じ形を続けない）。"""
    cx, cy, w, h = spec
    rx, ry = w / 2, h / 2
    count, tier, depth = 0, 0, 2.5
    while depth < 0.62 * h and count < limit:
        prev = None
        x = cx - rx * 0.8 + (tier % 2) * 3.0 + rng.uniform(0, 2)
        while x < cx + rx * 0.8 and count < limit:
            u = (x - cx) / rx
            y = cy - ry * math.sqrt(max(0.0, 1 - u * u)) + depth
            shape = rng.choice([s for s in LEAF_TIPS if s is not prev])
            prev = shape
            if try_tip(cv, owner, idx, shape, round(x), round(y), reserved):
                count += 1
            x += rng.randint(5, 8)
        depth += rng.uniform(4, 5)
        tier += 1
    return count


def find_hole(cv, pattern, target, reserved):
    """目標の近くで、穴と1px輪郭と余白（全体で周囲2px）がすべて葉の中に収まる位置を探す。なければNone。"""
    w, h = len(pattern[0]), len(pattern)
    offsets = sorted(((dx, dy) for dx in range(-6, 7) for dy in range(-5, 6)), key=lambda d: d[0] ** 2 + d[1] ** 2)
    for dx, dy in offsets:
        ix, iy = target[0] + dx, target[1] + dy
        rect = [(x, y) for x in range(ix - 2, ix + w + 2) for y in range(iy - 2, iy + h + 2)]
        if all(cv.get(x, y) != '.' and (x, y) not in reserved for x, y in rect):
            return ix, iy
    return None


def carve_hole(cv, pattern, ix, iy):
    """抜け穴をあける: 穴の4近傍にG1の輪郭を1px引き、穴の中にW2の枝（幅2px）を残す。外周の輪郭を引いた後に呼ぶ。"""
    inside = {(ix + i, iy + j) for j, row in enumerate(pattern) for i in range(len(row))}
    ring = {(x + a, y + b) for x, y in inside for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))} - inside
    for x, y in ring:
        if cv.get(x, y) != '.':
            cv.set(x, y, ramp('G', 1))
    for j, row in enumerate(pattern):
        for i, ch in enumerate(row):
            cv.set(ix + i, iy + j, ramp('W', 2) if ch == '2' else '.')


def build_crown(cv, lobes, rng, tip_limit, holes=()):
    """大房を奥から手前の順に描き、穴の位置を決め、葉先を置く。穴は輪郭を引いた後に carve_hole で開ける。"""
    owner = {}
    for idx, spec in enumerate(lobes):
        paint_lobe(cv, owner, idx, spec, rng)
    fill_holes(cv)
    reserved, spots = set(), []
    for pattern, target in holes:
        pos = find_hole(cv, pattern, target, reserved)
        if pos is None:
            continue
        w, h = len(pattern[0]), len(pattern)
        reserved.update((x, y) for x in range(pos[0] - 3, pos[0] + w + 3) for y in range(pos[1] - 3, pos[1] + h + 3))
        spots.append((pattern, pos[0], pos[1]))
    for idx, spec in enumerate(lobes):
        place_tips(cv, owner, idx, spec, rng, tip_limit, reserved)
    return spots


def fill_holes(cv, passes=2):
    """房の隙間にできた3方向を囲まれた穴を、多数派の色で埋める。"""
    for _ in range(passes):
        fixes = []
        for y in range(cv.h):
            for x in range(cv.w):
                if cv.g[y][x] != '.':
                    continue
                near = [cv.get(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
                near = [c for c in near if c != '.']
                if len(near) >= 3:
                    fixes.append((x, y, Counter(near).most_common(1)[0][0]))
        for x, y, c in fixes:
            cv.g[y][x] = c


def underside(cv, band, trunk_shade=None):
    """葉の下端に2pxの暗い帯（ぼかさない。bandがNoneなら省く）。葉の真下に幹があれば、幹の上端を暗くして影にする。"""
    def is_leaf(c):
        return c != '.' and group_of(c) in ('G', 'P')

    marks, shades = [], []
    for y in range(cv.h):
        for x in range(cv.w):
            if not is_leaf(cv.g[y][x]) or is_leaf(cv.get(x, y + 1)):
                continue
            marks.append((x, y))
            if is_leaf(cv.get(x, y - 1)):
                marks.append((x, y - 1))
            for k in (1, 2, 3):
                below = cv.get(x, y + k)
                if trunk_shade and below != '.' and group_of(below) == 'W':
                    shades.append((x, y + k))
    if band:
        for x, y in marks:
            cv.g[y][x] = band
    for x, y in shades:
        cv.g[y][x] = trunk_shade


def draw_trunk(cv, cx, top, base, w_top, w_base):
    """幹はW1〜W3の3段（左が明）。根元に向かって広がり、足元に1pxのK1の接地線を引く。"""
    w1, w2, w3 = ramp('W', 1), ramp('W', 2), ramp('W', 3)
    for y in range(top, base):
        f = (y - top) / (base - 1 - top)
        w = round(w_top + (w_base - w_top) * f ** 2.2)
        xl = cx - w // 2
        lit, dark = max(2, w // 3), max(2, w // 4)
        for i in range(w):
            cv.set(xl + i, y, w3 if i < lit else w1 if i >= w - dark else w2)
    for dx, dy, length, color in ((-1, 6, 4, w1), (1, 13, 5, w1), (-2, 20, 4, w1), (-3, 9, 3, w3)):
        for k in range(length):
            if top + dy + k < base - 2:
                cv.set(cx + dx, top + dy + k, color)
    half = w_base // 2
    for x in range(cx - half - 1, cx - half + w_base + 1):
        cv.set(x, base, ramp('K', 1))


def make_oak():
    """広葉樹: 奥から L1奥上・L5左上の小房・L3右・L2左・L4手前中央の5大房（中心x, 中心y, 幅, 高さ）。"""
    rng = random.Random('oak')
    cv = Canvas(*TREE_SIZE)
    draw_trunk(cv, 48, 52, 80, 11, 17)
    lobes = ((48, 22, 34, 20), (30, 22, 18, 12), (68, 36, 26, 20), (28, 38, 28, 22), (46, 48, 32, 20))
    holes = ((HOLE_PATTERNS[0], (33, 49)), (HOLE_PATTERNS[1], (57, 49)))
    spots = build_crown(cv, lobes, rng, 10, holes)
    underside(cv, ramp('G', 1), ramp('W', 1))
    outline(cv, selout=True)
    for pattern, ix, iy in spots:
        carve_hole(cv, pattern, ix, iy)
    return cv


def pine_rank(x, half):
    """段の左1/3=3・中央=2・右1/3=1。"""
    return 3 if x < 48 - half / 3 else 1 if x > 48 + half / 3 else 2


def pine_tier(rng, apex, base, hw, tones):
    """松の1段。三角の面は左・中・右の3色（tones）。下端は幅7と幅5の下向きの枝先を交互に並べる。"""
    tc = Canvas(*TREE_SIZE)
    last = base - 3
    for y in range(apex, last + 1):
        f = (y - apex) / max(1, last - apex)
        half = min(hw + 1.5, hw * f + (1.5 if ((y - apex) // 3) % 2 == 0 else 0))
        for x in range(round(48 - half), round(48 + half) + 1):
            tc.set(x, y, tones[3 - pine_rank(x, half)])
    seq, total, w = [], 0, rng.choice((7, 5))
    while total < 2 * hw + 1:
        seq.append(w)
        total += w
        w = 12 - w
    x = 48 - total // 2 + rng.randint(-1, 1)
    for w in seq:
        shape = PINE_TIPS[0] if w == 7 else PINE_TIPS[1]
        for r, row in enumerate(shape):
            for i, ch in enumerate(row):
                if ch != '.':
                    rank = min(int(ch), pine_rank(x + i, hw))
                    tc.set(x + i, base - 2 + r, tones[3 - rank])
        x += w
    return tc


def shadow_below(cv, tc):
    """上の段の枝先の真下（下の段の葉の上）へ、P1の帯を2px引く。"""
    for x in range(tc.w):
        ys = [y for y in range(tc.h) if tc.g[y][x] != '.']
        if not ys:
            continue
        y = max(ys)
        for k in (1, 2):
            c = cv.get(x, y + k)
            if c != '.' and group_of(c) in ('G', 'P'):
                cv.set(x, y + k, ramp('P', 1))


def make_pine():
    rng = random.Random('pine')
    cv = Canvas(*TREE_SIZE)
    draw_trunk(cv, 48, 58, 80, 7, 11)
    back = (ramp('P', 3), ramp('P', 2), ramp('P', 1))
    front = (ramp('G', 4), ramp('P', 2), ramp('P', 1))
    # (頂点y, 下端y, 半幅)。大きい下の段（奥・暗）から描き、上の段の枝先を手前に重ねる
    tiers = ((48, 66, 29), (36, 55, 25), (24, 43, 20), (13, 31, 15), (4, 20, 10))
    for i, (apex, base, hw) in enumerate(tiers):
        tc = pine_tier(rng, apex, base, hw, back if i < 2 else front)
        shadow_below(cv, tc)
        cv.paste(tc, 0, 0)
    underside(cv, None, ramp('W', 1))
    outline(cv, selout=True)
    return cv


def rock_pixels(cx, cy, rx, ry, lean, p_top=1.6, p_bot=2.4):
    """丸い岩の画素 {(x, y): (u, v)}（u,vは中心からの正規化座標）。上は尖らせ（上辺の直線を約5pxに抑え）、下は平らに接地する。"""
    cells = {}
    for y in range(math.floor(cy - ry), math.ceil(cy + ry) + 1):
        v = (y + 0.5 - cy) / ry
        if abs(v) >= 1:
            continue
        p = p_top if v < 0 else p_bot
        half = rx * (1 - abs(v) ** p) ** (1 / p)
        mid = cx - lean * v
        for x in range(math.ceil(mid - half - 0.5), math.floor(mid + half - 0.5) + 1):
            cells[(x, y)] = ((x + 0.5 - cx) / rx, v)
    return cells


def shade_rock(cv, cells):
    """球に沿った明暗。左上の光 s: R5(三日月)>0.8 / R4>0.45（R4+R5は約25%） / R3>-0.1 / R2 / 右下の縁R1<-0.65、最下2行もR1。"""
    for (x, y), (u, v) in cells.items():
        s = -(0.55 * u + 0.85 * v)
        n = 5 if s > 0.8 else 4 if s > 0.45 else 3 if s > -0.1 else 2 if s > -0.65 else 1
        cv.set(x, y, ramp('R', n))
    bottoms = {}
    for x, y in cells:
        bottoms[x] = max(bottoms.get(x, y), y)
    for x, y in bottoms.items():
        cv.set(x, y, ramp('R', 1))
        if (x, y - 1) in cells:
            cv.set(x, y - 1, ramp('R', 1))


def despeckle(cv, cells):
    """同色の4近傍が1つもない孤立画素を、周りの多数派の色にする（1pxの点を残さない）。"""
    fixes = []
    for x, y in cells:
        c = cv.get(x, y)
        near = [cv.get(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
        if c in near:
            continue
        near = [n for n in near if n != '.']
        if near:
            fixes.append((x, y, Counter(near).most_common(1)[0][0]))
    for x, y, c in fixes:
        cv.set(x, y, c)


def groove(cv, cells):
    """手前の岩の周囲2pxで、奥の岩にR1の継ぎ目の溝を引く。手前の岩を塗る前に呼ぶ。"""
    ring = set(cells)
    for _ in range(2):
        ring |= {(x + a, y + b) for x, y in ring for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))}
    for x, y in ring - set(cells):
        c = cv.get(x, y)
        if c != '.' and group_of(c) == 'R':
            cv.set(x, y, ramp('R', 1))


def draw_rocks(size, parts):
    """parts = [(cx, cy, rx, ry, lean)] を奥から手前へ重ねる。返り値は (Canvas, 各岩の画素)。"""
    cv = Canvas(*size)
    rocks = []
    for i, (cx, cy, rx, ry, lean) in enumerate(parts):
        cells = rock_pixels(cx, cy, rx, ry, lean)
        if i:
            groove(cv, cells)
        shade_rock(cv, cells)
        despeckle(cv, cells)
        rocks.append(cells)
    return cv, rocks


def moss_lump(cv, cells, mx, my, rx, ry, spot=False, drip=None):
    """岩の上に載る苔の塊: G3の地・G4の本体・左上だけG5。spotでM2の2x2を1か所、dripで下の面へ1x2pxのG3の垂れを1本。"""
    body = {}
    for y in range(math.floor(my - ry) - 1, math.ceil(my + ry) + 2):
        for x in range(math.floor(mx - rx) - 1, math.ceil(mx + rx) + 2):
            u, v = (x + 0.5 - mx) / rx, (y + 0.5 - my) / ry
            if u * u + v * v > 1 or (x, y) not in cells:
                continue
            body[(x, y)] = ramp('G', 3) if v > 0.35 else ramp('G', 5) if u + v < -1.0 else ramp('G', 4)
    for (x, y), c in body.items():
        cv.set(x, y, c)
    if spot:
        for x, y in sorted(body, key=lambda p: (p[0] - mx - 1) ** 2 + (p[1] - my) ** 2):
            quad = [(x + a, y + b) for a in (0, 1) for b in (0, 1)]
            if all(body.get(p) == ramp('G', 4) for p in quad):
                for p in quad:
                    cv.set(p[0], p[1], ramp('M', 2))
                break
    if drip is not None:
        x = round(mx + drip)
        low = max((y for (px, y) in body if px == x), default=None)
        if low is not None:
            for k in (1, 2):
                if (x, low + k) in cells:
                    cv.set(x, low + k, ramp('G', 3))


def draw_crack(cv, cells, x, y):
    """主岩の亀裂1本（5px、R1。下端の1pxだけR2）。全画素が岩の面の上にある時だけ描く。"""
    pts = [(x, y), (x, y + 1), (x + 1, y + 2), (x + 1, y + 3), (x + 1, y + 4)]
    if all(p in cells and group_of(cv.get(*p)) == 'R' for p in pts):
        for p in pts[:-1]:
            cv.set(p[0], p[1], ramp('R', 1))
        cv.set(pts[-1][0], pts[-1][1], ramp('R', 2))


def contact_shadow(cv, cells):
    """輪郭の下に地面の1段暗い色（草の上のG1）の影を2行。右へ2〜3px長く伸ばす。輪郭を引いた後に呼ぶ。"""
    xs = [x for x, _ in cells]
    xl, xr = min(xs), max(xs)
    width = xr - xl + 1
    bb = max(y for _, y in cells)
    for y, x0, x1 in ((bb + 2, xl + width // 6, xr + 3), (bb + 3, xl + width // 4, xr + 2)):
        for x in range(x0, x1 + 1):
            if cv.get(x, y) == '.':
                cv.set(x, y, ramp('G', 1))


def finish_rocks(cv, rocks):
    outline(cv)
    for cells in rocks:
        contact_shadow(cv, cells)
    return cv


def make_rock():
    """大岩: 主岩（幅28・高さ20）と、右奥で1/3重なる従岩（幅16・高さ14）。主岩の頂上に苔の塊2つ、亀裂1本。"""
    cv, rocks = draw_rocks((50, 38), [(36, 21, 8, 7, 0.8), (19, 23, 14, 10, -1.0)])
    main = rocks[1]
    moss_lump(cv, main, 16.5, 16.5, 5, 2.6, spot=True, drip=-1.5)
    moss_lump(cv, main, 24, 17.5, 3.5, 2.0, drip=0.5)
    draw_crack(cv, main, 21, 24)
    return finish_rocks(cv, rocks), (24, 33)


def make_smallrock0():
    """小岩の群れ: 3つの丸い岩（幅12・11・8）を重ねる。左奥の岩に小さな苔。"""
    cv, rocks = draw_rocks((30, 20), [(9, 10, 6, 5, 0.5), (20, 11, 6, 4.75, -0.6), (13, 12.5, 4, 3.5, 0.3)])
    moss_lump(cv, rocks[0], 9, 7, 3.2, 1.8)
    return finish_rocks(cv, rocks), (13, 16)


def make_smallrock1():
    """小岩の単体: 幅14の丸い岩。"""
    cv, rocks = draw_rocks((22, 18), [(10, 9.5, 7, 5.5, -0.5)])
    return finish_rocks(cv, rocks), (10, 15)


def make_bush():
    """茂み: 18x12前後の大房2つ（奥(19,23)・手前(30,26)）。葉先は5個まで。"""
    rng = random.Random('bush')
    cv = Canvas(48, 40)
    build_crown(cv, ((19, 23, 18, 12), (30, 26, 18, 12)), rng, 5)
    underside(cv, ramp('G', 1))
    outline(cv)
    return cv, (24, 35)


def make_log():
    """丸太: 上が明るいW3、中W2、下W1の横木。左に年輪の切り口、上に苔と枝の切り株。"""
    cv = Canvas(48, 20)
    w1, w2, w3, w4 = (ramp('W', i) for i in (1, 2, 3, 4))
    for y in range(4, 16):
        c = w3 if y <= 6 else w2 if y <= 12 else w1
        cv.rect(8, y, 33, 1, c)
    cv.ellipse(41, 10, 3.5, 6, w2)
    for x, y, n in ((14, 8, 3), (22, 10, 4), (30, 8, 3), (35, 11, 3)):
        cv.rect(x, y, 1, n, w1)
    cv.rect(18, 5, 4, 1, w4)
    cv.rect(24, 2, 4, 3, w2)
    cv.rect(24, 2, 2, 1, w3)
    cv.ellipse(8, 10, 4.5, 6, w3)
    cv.ellipse(8.5, 10, 3, 4.5, w4)
    cv.rect(8, 9, 2, 2, w3)
    cv.ellipse(31, 4.5, 3.5, 1.8, ramp('G', 4))
    cv.rect(29, 3, 2, 1, ramp('G', 5))
    outline(cv)
    return cv, (24, 16)


def main():
    ap = argparse.ArgumentParser(description='束1 自然物の見本をWorkbenchへ出力する')
    ap.add_argument('--only', choices=('trees', 'props'), help='片方だけ出力する')
    args = ap.parse_args()
    if args.only in (None, 'trees'):
        finish('trees', build_lines(TREE_SIZE, TREE_PIVOT, [('oak', make_oak()), ('pine', make_pine())]))
    if args.only in (None, 'props'):
        items = []
        for name, (cv, anchor) in (
            ('rock', make_rock()), ('smallrock0', make_smallrock0()), ('smallrock1', make_smallrock1()),
            ('bush', make_bush()), ('log', make_log()),
        ):
            items.append((name, cv, PROP_PIVOT[0] - anchor[0], PROP_PIVOT[1] - anchor[1]))
        finish('props', build_lines(PROP_SIZE, PROP_PIVOT, items))


if __name__ == '__main__':
    main()
