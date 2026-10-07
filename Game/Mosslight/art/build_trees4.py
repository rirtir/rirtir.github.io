"""flora 4枚（oak, oak2, pine, amber_tree）の新規制作 v4。正本 flora・manifest・ランタイムは変えず、.review/v4/trees/ だけを書く。

  python art/build_trees4.py

96x96, pivot 48,80。フレーム名・順・atlas 配置・時間は assets/flora/atlas.json と同じ（違えば止まる）。Pillow は使わない。
形: 先端の向きを持つ幅2〜4px の葉型（上向きと右上向きの2種。他の向きは転置・反転）を、向きと重なりで組み合わせて葉束にする。
    葉束・幹・枝・根を名前付き部品（要素）にし、奥から手前へ重ねる。build_trees3 の楕円・ノイズは使わない。
アルベド: 固有色と局所の接触（外縁・上に重なる別部品の直下・葉の重なりの直下）だけ。方向のある光・影は描かない。
法線: 葉ごとの向き（先端方向への傾き）+ 葉束の丸み + 樹冠全体の丸み。幹・枝は軸に沿った円柱、根は外へ傾ける。画素の色・不透明度の距離からは作らない。
高さ: 逆投影は groundY = screenY + height（係数1）。y=80 に立つ直立物は h = 80-y なので、幹の中心は各 y で pivot（地面 y=80）に戻り、
    葉は幹と枝の真上に広がる。樹冠の下地は手描き多角形（mass）の連続した G の面で、その上に葉束を重ねる。
    R の上限 63 を超える高い所（y<28 付近）だけ lift() で頭打ちにする＝後方へ奥行きを持たせる。全体を一律に縮めない。B=128（中立ゲイン）。
"""
import json
import math
import sys
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GAME.parents[1] / 'Image/PixelWorkbench'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import Editor, SYMBOLS, render  # noqa: E402
from pixelwork import export, save  # noqa: E402
from build_normal_maps import VECTORS, NORMAL_COLORS, project_lines  # noqa: E402

W = H = 96
PIVOT = (48, 80)
NAMES = ['oak', 'oak2', 'pine', 'amber_tree']
OUT = GAME / '.review/v4/trees'
OLD = GAME / 'assets/flora/atlas.json'
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))   # 右, 左, 下, 上
DIRS = [(1, 0), (.7071, .7071), (0, 1), (-.7071, .7071), (-1, 0), (-.7071, -.7071), (0, -1), (.7071, -.7071)]   # 右から時計回り
SKIN = {'green': ('#1E3A2A', '#2E5534', '#457A3E', '#6E9F48'), 'amber': ('#6E4220', '#9C6526', '#D39A3A', '#F0C25A')}   # o g G l
BARK = {'k': '#3B2A22', 'm': '#6A4A35', 'n': '#85603F'}
# 葉の基本形。先端が上(UP)と右上(DIAG)。先端側が細く根元側が太い2〜4px 幅の帯。(種類, 大きい葉か)
STAMPS = {(0, 1): ['.XX.', '.XX.', 'XXXX', 'XXXX', 'XXXX', 'XXXX', '.XX.'],
          (1, 1): ['....XX', '...XXX', '..XXXX', '.XXXX.', 'XXXX..', 'XXX...'],
          (0, 0): ['.X.', 'XXX', 'XXX', 'XXX'], (1, 0): ['...X', '.XXX', 'XXXX', 'XXX.']}
# 葉束: rx, ry, 大きい葉か, 外周の葉数, 内側の葉数, 丸みの高さ, 渦の接線ずれ
SIZES = {'L': (10, 7, 1, 7, 3, 3., 1.2), 'M': (7, 5, 1, 5, 2, 2., .8), 'S': (4, 3, 0, 3, 1, 1.5, .5)}


LOBE_SOFT, LOBE_N, LOBE_H = 7., .55, 5.   # 葉塊の重なりの滑らかさ・法線の強さ・高さ(px)


def lift(v):
    """画面上の高さ(80-y 相当) → 高さ値。52 までは係数1のまま、それより上だけ 63 へ緩やかに頭打ち（高い樹冠は後方の奥行き）。"""
    return v if v <= 52 else 52 + 11 * (1 - math.exp(-(v - 52) / 11))


def mass(poly, depth):
    """樹冠の下地: 手描き多角形 poly=[(x, y)] の内側（画素中心で判定）を連続した G の面にする。n/h は樹冠全体の丸みだけを finish で足す。"""
    out = {}
    for y in range(min(p[1] for p in poly), max(p[1] for p in poly) + 1):
        for x in range(min(p[0] for p in poly), max(p[0] for p in poly) + 1):
            inside = False
            for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
                if (ay > y + .5) != (by > y + .5) and x + .5 < ax + (y + .5 - ay) * (bx - ax) / (by - ay):
                    inside = not inside
            if inside:
                out[(x, y)] = dict(c='G', crown=True, n=(0., 0., 1.), h=depth)
    return out


def hexof(tree, key):
    return SKIN[SPECS[tree]['skin']]['ogGl'.index(key)] if key in 'ogGl' else BARK[key]


def leaf(big, k):
    """向き k（DIRS の添字）の葉の画素 [(x, y)] と幅・高さ。先端が DIRS[k] の向き。"""
    rows = STAMPS[(k % 2, big)]
    cs = [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == 'X']
    w, h = len(rows[0]), len(rows)
    if k in (0, 4):
        cs, w, h = [(y, x) for x, y in cs], h, w
    if k in (0, 5, 3):
        cs = [(w - 1 - x, y) for x, y in cs]
    if k in (1, 2, 3):
        cs = [(x, h - 1 - y) for x, y in cs]
    return cs, w, h


def put_leaf(px, lx, ly, big, k, rank, tc=None, keep=True):
    """葉1枚（中心 lx, ly）を置く。後から置いた葉が上。tilt は先端方向（外へ垂れる向き）へのごく弱い傾き（法線の主役は樹冠全体の丸み）。
    tc は先端画素の固有色。keep=False の葉は、その葉が上に重なっても下の葉との接触の暗い輪郭を作らない（輪郭は構造上の一部の葉だけ）。"""
    cs, w, h = leaf(big, k)
    ox, oy = math.floor(lx - w / 2 + .5), math.floor(ly - h / 2 + .5)
    d = DIRS[k]
    dots = [x * d[0] + y * d[1] for x, y in cs]
    top = max(dots)
    for (x, y), v in zip(cs, dots):
        px[(ox + x, oy + y)] = dict(rank=rank, tc=tc if v >= top - (1.05 if big else .7) else None, ov=None, keep=keep, tilt=(d[0] * .05, -d[1] * .05))


def bake(px, cx, cy, rx, ry, amp, depth):
    """葉の画素表を要素の画素（色・法線・高さの局所分）にする。同じ葉束の中で、真上の画素が後の葉なら重なりの陰 g。"""
    out = {}
    for (x, y), e in px.items():
        u, v = (x + .5 - cx) / rx, (y + .5 - cy) / ry
        q = u * u + v * v
        s = math.sqrt(1 - min(q, .8))
        up = px.get((x, y - 1), e)
        above = up['rank'] > e['rank'] and up.get('keep', True)   # 上に重なる葉が構造上の接触の葉のときだけ暗い輪郭。他は近くの G へ溶ける
        out[(x, y)] = dict(c=e['ov'] or e['tc'] or ('g' if above else 'G'), crown=True,
                           n=(e['tilt'][0] + .08 * u / s, e['tilt'][1] - .08 * v / s, 1.),
                           h=depth + .5 * (amp / 3) * math.sqrt(max(0., 1 - q)) + .05 * min(e['rank'] + 1, 5))   # 層・束・葉の起伏は合計1px以内（高さの主役は finish の樹冠全体）
    return out


def tuft(kind, cx, cy, layer, a0, sw):
    """葉束。下地(g)の上に外周の葉を a0 から等角度に並べ（先端は外向き＋渦22°、位置は接線へずらす）、内側の葉を重ねる。sw=±1 が渦の向き。"""
    rx, ry, big, n, m, amp, tau = SIZES[kind]
    px = {}
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if ((x + .5 - cx) / (.8 * rx)) ** 2 + ((y + .5 - cy) / (.78 * ry)) ** 2 <= 1:   # 葉の間を G でつなぐ。暗い g は葉の直下だけ
                px[(x, y)] = dict(rank=-1, tc=None, ov=None, tilt=(0., 0.))
    for j in range(n + m):
        ang, rho = (a0 + j * 360. / n, .55) if j < n else (a0 + 40 + 180. * (j - n), .18)
        t = math.radians(ang)
        vx, vy = rx * math.cos(t), ry * math.sin(t)
        k = round(((math.degrees(math.atan2(vy, vx)) + sw * 22) % 360) / 45) % 8
        put_leaf(px, cx + rho * vx - sw * tau * math.sin(t), cy + rho * vy + sw * tau * math.cos(t), big, k, j, 'l' if (j + int(a0) // 20) % 3 == 0 else None,
                 keep=(j + int(a0) // 15) % 2 == 0)   # 葉先の色は束ごとに数と位置を変える。接触の輪郭は葉の約半分だけ
    return bake(px, cx, cy, rx, ry, amp, .4 * layer)   # 層の差は高さ0.4px刻み（段差で自己影の斑が出ない）


def tier(y0, y1, wid, cx, top):
    """松の段。上が細い台形の本体（下2行は g）、両脇へ垂れる大きな葉、下縁の下向きの小さな葉（間隔と深さを不揃いにした鋸歯）。"""
    r, px = wid / 2, {}
    for y in range(y0, y1):
        t = (y - y0) / (y1 - y0 - 1)
        hw = r * (top + (1 - top) * t)
        for x in range(int(cx - hw) - 1, int(cx + hw) + 2):
            if abs(x + .5 - cx) <= hw:
                px[(x, y)] = dict(rank=0, tc=None, ov='g' if y >= y1 - 2 else None, tilt=((x + .5 - cx) / r * .5, -.3 * t))
    for sgn, k in ((-1, 3), (1, 1)):
        put_leaf(px, cx + sgn * r * .68, y0 + (y1 - y0) * .5, 1, k, 1, 'l')
    x, i = cx - r + 2, 0
    while x <= cx + r - 2:
        if (i + y0) % 7 != 5:
            put_leaf(px, x, y1 - 1 + (0, 1, 0, 2, 1, 0, 1, 2)[(i + y0) % 8], 0, 2, 2 + i, 'g')
        x += (4, 5, 3, 4, 4, 5, 3)[(i + y0) % 7]
        i += 1
    return bake(px, cx, (y0 + y1) / 2, r, (y1 - y0) / 2, 2., 0.)


def bark(x, y, u, r):
    """幹の樹皮: 縦の割れ目2本（途切れ、位置が揺れる）と中央の板の明るい面。左右対称で光の向きを持たない。"""
    for s, ph in ((-.42, 0), (.38, 4)):
        if abs(u * r - s * r - round(1.2 * math.sin(y * .4 + ph))) < .5 and (y * 3 + ph * 5) % 13 > 3:
            return 'k'
    return 'n' if abs(u) < .38 and (y // 5) % 3 != 2 else 'm'


def limb(pts, kind='limb', root=0):
    """折れ線の軸 pts=[(x, y, 半径)]（下→上）に沿った円柱。画素中心から最も近い軸上の点で、軸に垂直な位置 u（-1..1）→ 法線・高さ。root は外へ傾ける。"""
    out = {}
    xa, xb = int(min(p[0] - p[2] for p in pts)) - 1, int(max(p[0] + p[2] for p in pts)) + 2
    for y in range(max(0, int(min(p[1] - p[2] for p in pts)) - 1), min(H, int(max(p[1] + p[2] for p in pts)) + 2)):
        for x in range(max(0, xa), min(W, xb)):
            qx, qy, best = x + .5, y + .5, None
            for (ax, ay, ar), (bx, by, br) in zip(pts, pts[1:]):
                dx, dy = bx - ax, by - ay
                ln = math.hypot(dx, dy)
                t = min(1., max(0., ((qx - ax) * dx + (qy - ay) * dy) / ln ** 2))
                r = ar + (br - ar) * t
                ex, ey = qx - ax - t * dx, qy - ay - t * dy
                d = math.hypot(ex, ey)
                if d <= r and (best is None or d / r < best[0]):
                    best = (d / r, (ex * -dy + ey * dx) / ln / r, -dy / ln, dx / ln, r)
            if best:
                _, u, p_x, p_y, r = best
                nz = math.sqrt(max(.05, 1 - u * u))
                out[(x, y)] = dict(c=bark(x, y, u, r) if kind == 'trunk' and r >= 2.6 else 'm', crown=False, thin=r < 1.8,
                                   n=(u * p_x + (.35 if qx > 48 else -.35) * root, -u * p_y, nz), h=(80 - qy) - .55 * r * (1 - nz))
    return out


def roots(s):   # 根は y<=79 の地面すれすれで外へ。左右で長さが違い、先が2つ
    return [('limb', 'root_l', [(48 - 9 * s, 79.3, .9), (48 - 5.5 * s, 78.3, 1.6), (48 - 2.5 * s, 76.2, 2.6)], 'limb', 1),
            ('limb', 'root_r', [(48 + 9.5 * s, 79.4, .9), (48 + 5.5 * s, 78.4, 1.6), (48 + 2.5 * s, 76.2, 2.5)], 'limb', 1)]


# 要素を奥から手前の順に並べる。幹・枝を先に描き、樹冠の下地 ('mass', 多角形, 奥行き) と葉束がその上を覆う（枝は樹冠の下縁の切れ込みだけから見える）。
# ('tuft', 種類, cx, cy, 層0..2, 開始角, 渦±1) / ('limb', 名前, 軸, 種類, 根) / ('tier', y0, y1, 幅, cx, 上の細さ)。
# crown=(cx, cy, rx, ry) は樹冠全体の丸み（法線と高さ）の楕円。
SPECS = {
    'oak': dict(skin='green', crown=(48, 31, 40, 25, [(28, 35, 24, 18), (68, 35, 24, 18), (48, 24, 26, 17)]), parts=[   # 横広(幅74×高さ48)の連続した樹冠。下縁中央の切れ込みから幹の分岐が見える
        *roots(1.),
        ('limb', 'trunk', [(48, 79.6, 4.5), (48, 76, 4.3), (48, 70, 4.0), (48, 64, 3.7), (48, 59, 3.2), (48, 56, 3.0)], 'trunk', 0),
        ('limb', 'branch_l', [(47, 58, 2.2), (44, 52, 1.9), (41, 46, 1.5), (39, 40, 1.2), (38, 35, 1.0)], 'limb', 0),
        ('limb', 'branch_r', [(49, 58, 2.2), (52, 52, 1.9), (55, 46, 1.5), (57, 40, 1.2), (58, 35, 1.0)], 'limb', 0),
        ('limb', 'twig', [(45.3, 51, 1.0), (47, 45, .8), (47.5, 40, .7)], 'limb', 0),
        ('mass', [(11, 36), (13, 30), (18, 27), (16, 22), (22, 17), (29, 16), (31, 11), (39, 8), (46, 10), (52, 7), (60, 9), (64, 14), (71, 12),
                  (75, 18), (74, 23), (80, 25), (85, 31), (84, 38), (80, 44), (75, 46), (73, 52), (65, 54), (58, 52), (54, 49), (50, 47),
                  (44, 48), (40, 52), (32, 55), (24, 53), (19, 49), (13, 44)], 0.),
        ('tuft', 'L', 40, 15, 0, 20, 1), ('tuft', 'L', 58, 14, 0, 95, -1), ('tuft', 'M', 25, 23, 0, 150, 1), ('tuft', 'M', 72, 22, 0, 60, -1),
        ('tuft', 'L', 33, 29, 1, 55, 1), ('tuft', 'L', 50, 27, 1, 130, -1), ('tuft', 'L', 67, 29, 1, 10, 1),
        ('tuft', 'L', 19, 36, 1, 160, -1), ('tuft', 'L', 76, 36, 1, 90, 1),
        ('tuft', 'L', 38, 41, 2, 100, -1), ('tuft', 'L', 60, 41, 2, 35, 1), ('tuft', 'L', 25, 47, 2, 70, 1), ('tuft', 'L', 73, 45, 2, 140, -1),
        ('tuft', 'M', 36, 51, 2, 35, -1), ('tuft', 'M', 64, 51, 2, 150, 1)]),
    'oak2': dict(skin='green', crown=(48, 31, 30, 26, [(36, 39, 20, 17), (58, 30, 18, 18), (46, 17, 17, 13)]), parts=[   # 上へ長い(幅58×高さ51)。右が切れ込み、下縁中央から分岐が見える
        *roots(.9),
        ('limb', 'trunk', [(48, 79.6, 3.6), (48, 74, 3.3), (48, 66, 3.1), (48, 60, 2.9), (48, 56, 2.7)], 'trunk', 0),
        ('limb', 'branch_l', [(47, 58, 2.0), (44, 53, 1.7), (40, 47, 1.4), (36, 42, 1.1), (34, 37, .9)], 'limb', 0),
        ('limb', 'branch_r', [(49, 58, 2.1), (53, 53, 1.9), (58, 47, 1.6), (63, 41, 1.3), (66, 35, 1.0), (67, 31, .8)], 'limb', 0),
        ('limb', 'twig', [(56, 50, .9), (55, 44, .8), (53, 40, .7)], 'limb', 0),
        ('mass', [(27, 28), (24, 22), (29, 16), (33, 10), (41, 6), (49, 8), (55, 5), (62, 10), (66, 16), (72, 19), (76, 26), (73, 33), (77, 37),
                  (70, 41), (66, 45), (68, 50), (62, 55), (55, 53), (51, 49), (46, 48), (42, 53), (34, 56), (26, 52), (21, 46), (24, 40),
                  (19, 34)], 0.),
        ('tuft', 'M', 37, 13, 0, 40, 1), ('tuft', 'M', 51, 12, 0, 80, -1), ('tuft', 'M', 30, 20, 0, 120, 1), ('tuft', 'L', 58, 19, 0, 15, 1),
        ('tuft', 'L', 30, 30, 1, 60, 1), ('tuft', 'L', 47, 28, 1, 170, -1), ('tuft', 'L', 66, 27, 1, 100, 1),
        ('tuft', 'L', 29, 42, 2, 140, -1), ('tuft', 'L', 47, 39, 2, 20, 1), ('tuft', 'M', 62, 38, 2, 90, -1),
        ('tuft', 'M', 38, 50, 2, 50, 1), ('tuft', 'M', 60, 50, 2, 110, -1)]),
    'pine': dict(skin='green', crown=(48, 32, 27, 30), parts=[   # 鋸歯の段5つ。下の段から先に描き、上の段が重なる
        *roots(.8), ('limb', 'trunk', [(48, 79.6, 3.5), (48, 74, 3.2), (48, 66, 3.0), (48, 58, 2.9)], 'trunk', 0),
        ('tier', 47, 60, 50, 49, .5), ('tier', 37, 50, 42, 46, .5), ('tier', 25, 39, 34, 49, .5), ('tier', 14, 27, 26, 47, .5), ('tier', 4, 16, 18, 48, .16)]),
    'amber_tree': dict(skin='amber', crown=(50, 29, 36, 21, [(28, 33, 19, 12), (72, 33, 17, 12), (50, 24, 26, 14)]), parts=[   # やや疎らな傘形。下縁の切れ込みから枝が見えるが、樹冠の面は連続
        *roots(1.1), ('limb', 'trunk', [(48, 79.6, 4.4), (48, 74, 4.0), (48, 66, 3.7), (48, 58, 3.3), (48, 53, 3.0)], 'trunk', 0),
        ('limb', 'branch_l', [(47, 52, 2.0), (41, 47, 1.8), (34, 42, 1.5), (27, 38, 1.2), (21, 36, 1.0)], 'limb', 0),
        ('limb', 'branch_c', [(48, 51, 2.0), (48, 44, 1.8), (47, 37, 1.5), (48, 30, 1.2), (49, 25, 1.0)], 'limb', 0),
        ('limb', 'branch_r', [(49, 52, 2.0), (55, 47, 1.8), (62, 43, 1.5), (69, 39, 1.2), (76, 36, 1.0)], 'limb', 0),
        ('limb', 'twig_l', [(34, 42, .9), (32, 38, .8), (31, 34, .7)], 'limb', 0), ('limb', 'twig_r', [(62, 43, .9), (63, 38, .8), (62, 34, .7)], 'limb', 0),
        ('mass', [(16, 38), (15, 31), (21, 26), (24, 20), (32, 15), (41, 13), (49, 9), (58, 12), (67, 14), (74, 19), (79, 26), (84, 32), (83, 40),
                  (76, 45), (68, 42), (62, 47), (54, 44), (49, 42), (44, 46), (36, 44), (30, 48), (23, 46)], 0.),
        ('tuft', 'M', 50, 17, 0, 30, 1), ('tuft', 'L', 35, 22, 0, 110, -1), ('tuft', 'M', 66, 22, 0, 60, 1),
        ('tuft', 'L', 22, 32, 1, 140, -1), ('tuft', 'L', 76, 33, 1, 5, 1), ('tuft', 'M', 44, 29, 1, 80, 1), ('tuft', 'M', 58, 30, 1, 160, -1),
        ('tuft', 'S', 20, 40, 1, 20, -1), ('tuft', 'M', 30, 40, 2, 100, 1), ('tuft', 'M', 68, 39, 2, 45, -1), ('tuft', 'S', 80, 40, 2, 100, 1)]),
}


def build(name):
    order = []
    for n, item in enumerate(SPECS[name]['parts']):
        if item[0] == 'limb':
            order.append((item[1], limb(*item[2:])))
        elif item[0] == 'mass':
            order.append(('mass', mass(*item[1:])))
        elif item[0] == 'tuft':
            order.append((f'{item[1].lower()}{n:02d}', tuft(*item[1:])))
        else:
            order.append((f't{n:02d}', tier(*item[1:])))
    return order


def nearest(n):
    m = math.sqrt(sum(v * v for v in n))
    return min(range(len(VECTORS)), key=lambda i: sum((a - b / m) ** 2 for a, b in zip(VECTORS[i], n)))


def lobe_field(lobes, x, y):
    """大きな葉塊（楕円ドーム）の滑らかな合成。重み w は各塊の (1-q) のソフトマックスで連続。
    返り値: (最大の塊の番号, 法線の x 補正, 法線の y 補正, 高さの加算)。法線は塊ごとのドーム法線の重み付き和、高さは塊のドーム高の重み付き和（段差なし）。"""
    ts, doms = [], []
    for cx, cy, rx, ry in lobes:
        u, v = (x + .5 - cx) / rx, (y + .5 - cy) / ry
        q = u * u + v * v
        s = math.sqrt(1 - min(q, .85))
        ts.append(1 - q)
        doms.append((u / s, -v / s, math.sqrt(max(0., 1 - q))))
    m = max(ts)
    ws = [math.exp(LOBE_SOFT * (t - m)) for t in ts]
    tot = sum(ws)
    nx = sum(w * d[0] for w, d in zip(ws, doms)) / tot
    ny = sum(w * d[1] for w, d in zip(ws, doms)) / tot
    hh = sum(w * d[2] for w, d in zip(ws, doms)) / tot
    return ts.index(m), LOBE_N * nx, LOBE_N * ny, LOBE_H * hh


def finish(order, crown):
    """要素を奥から手前へ重ね、最終の固有色・法線・高さを求める。暗くするのは外縁と、真上が後ろの要素のときだけ。"""
    grid = {}
    for i, (_, px) in enumerate(order):
        for xy, e in px.items():
            if 0 <= xy[0] < W and 0 <= xy[1] < H:
                grid[xy] = (i, e)
    col, nrm, hgt = {}, {}, {}
    cx, cy, rx, ry = crown[:4]
    lobes = crown[4] if len(crown) > 4 else []
    field = {xy: lobe_field(lobes, *xy) for xy, (_, e) in grid.items() if e['crown'] and lobes}
    for (x, y), (i, e) in grid.items():
        around = [grid.get((x + dx, y + dy)) for dx, dy in N4]
        c, n, h = e['c'], list(e['n']), e['h']
        covered = around[3] is not None and around[3][0] > i   # 真上が後に描かれた別の要素
        if e['crown'] and lobes:
            owner, (lx, ly, lh) = field[(x, y)][0], field[(x, y)][1:]
            if c == 'G' and (x * 3 + y) % 11 < 8 and (x, y - 1) in field and field[(x, y - 1)][0] > owner:
                c = 'g'   # 大きな葉塊が手前で重なる境の直下だけ、幅1pxの接触帯（間欠）
            n[0] += lx
            n[1] += ly
            h += lh
        if e['crown']:
            if c != 'l':   # 葉先の固有色 l は外縁でも残す（方向のない点在）
                # 束の境の暗い接触は、構造上の区間（覆う束ごとに幅7pxの帯の偶奇）の約半分だけ。残りは手前の G へ溶け、束の先端 l は境に残る
                zone = (x // 7 + around[3][0]) % 2 == 0 if covered else False
                c = 'o' if any(a is None for a in around) else 'g' if c == 'G' and zone else c
            u, v = (x + .5 - cx) / rx, (y + .5 - cy) / ry
            q = u * u + v * v
            s = math.sqrt(1 - min(q, .85))
            k = .3 if lobes else .6   # 樹冠全体の連続した丸み（束・葉の傾きは弱い補助）。葉塊があるときは葉塊の法線が主役
            n[0] += k * u / s
            n[1] -= k * v / s
            h += (80 - y - .5) + (2 if lobes else 4) * math.sqrt(max(0., 1 - q))
        else:
            free = [a is None or (a[0] < i and a[1]['crown']) for a in around]   # 後ろの葉に接する縁も輪郭にする
            c = 'k' if (free[2] if e['thin'] else any(free)) or covered else c
        col[(x, y)], nrm[(x, y)], hgt[(x, y)] = c, nearest(n), min(63, max(0, round(lift(h))))
    return grid, col, nrm, hgt


def albedo_parts(tree, order, grid, col, sym):
    """要素ごとに、最終的に見えている画素だけの名前付き部品。順に重ねると完成フレームと一致する。"""
    out = []
    for i, (nm, _) in enumerate(order):
        pts = [xy for xy, (j, _) in grid.items() if j == i]
        if pts:
            x0, x1, y0, y1 = min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts)
            rows = [''.join(sym[hexof(tree, col[(x, y)])] if grid.get((x, y), (-1,))[0] == i else '.' for x in range(x0, x1 + 1))
                    for y in range(y0, y1 + 1)]
            out.append((f'{tree}_{nm}', x0, y0, rows))
    return out


def albedo_project(trees, sym, durations):
    lines = [f'canvas {W} {H}', f'pivot {PIVOT[0]} {PIVOT[1]}'] + [f'palette {s} {h}' for h, s in sym.items()]
    for _, parts in trees:
        for pn, _, _, rows in parts:
            lines += [f'part {pn} {len(rows[0])} {len(rows)}', 'rows ' + '|'.join(rows)]
    for (name, parts), d in zip(trees, durations):
        lines += [f'frame {name} {d}', 'tag default'] + [f'place l{i} {pn} {x} {y}' for i, (pn, x, y, _) in enumerate(parts)]
    return Editor().apply('\n'.join(lines))


def sheet_rows(m, enc):
    return [''.join(SYMBOLS[enc(m[(x, y)])] if (x, y) in m else '.' for x in range(W)) for y in range(H)]


def report(name, order, grid, col, nrm, hgt):
    """数値検査（退行の検出用）。見た目の良さの証明ではない。"""
    xs, ys = [p[0] for p in grid], [p[1] for p in grid]
    ctr = [(min(r) + 1 + max(r)) / 2 for y in range(60, 80)
           if (r := [x for (x, yy), (i, _) in grid.items() if yy == y and order[i][0] == 'trunk'])]
    groups = {i for i, e in grid.values() if e['crown']}
    print(f'[{name}] opaque {len(grid)}  bbox x {min(xs)}..{max(xs)} y {min(ys)}..{max(ys)}  colors {len(set(col.values()))}  '
          f'leaf groups {len(groups)}  parts {len({i for i, _ in grid.values()})}  trunk centre y60-79 {min(ctr):.1f}..{max(ctr):.1f}  '
          f'height {min(hgt.values())}..{max(hgt.values())}  normals {len(set(nrm.values()))}')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    old = json.loads(OLD.read_text(encoding='utf-8'))
    if list(old['frames']) != NAMES:
        raise SystemExit('flora のフレーム名・順が既存と違います')
    cols, durs = old['meta']['size']['w'] // W, [old['frames'][n]['duration'] for n in NAMES]
    built = [(n, order) + finish(order, SPECS[n]['crown']) for n in NAMES for order in [build(n)]]
    used = sorted({hexof(n, c) for n, _, _, col, _, _ in built for c in set(col.values())})
    if len(used) > 64:
        raise SystemExit(f'アルベドの色が {len(used)} 色（64色以下にする）')
    sym = {h: SYMBOLS[i] for i, h in enumerate(used)}
    stub = {'size': [W, H], 'pivot': list(PIVOT), 'frames': [{'name': n, 'duration': d} for n, d in zip(NAMES, durs)]}
    height_colors = ['#%02x%02x%02x' % (round(i / 64 * 255), 204, 128) for i in range(64)]   # R=高さ/64, G=粗さ80%, B=128 中立ゲイン
    projects = {'albedo': albedo_project([(b[0], albedo_parts(b[0], b[1], b[2], b[3], sym)) for b in built], sym, durs),
                'normal': project_lines(stub, NORMAL_COLORS, [sheet_rows(b[4], lambda v: v) for b in built]),
                'height': project_lines(stub, height_colors, [sheet_rows(b[5], lambda v: v) for b in built])}
    for i, n in enumerate(NAMES):   # 3つの alpha は完全に一致し、キャンバス外にはみ出さない
        masks = [[p[3] > 0 for p in render(pr, pr['frames'][i])[0].getdata()] for pr in projects.values()]
        if not masks[0] == masks[1] == masks[2] or render(projects['albedo'], projects['albedo']['frames'][i])[1]:
            raise SystemExit(f'{n}: albedo/normal/height の alpha が一致しないか、キャンバス外の画素があります')
    OUT.mkdir(parents=True, exist_ok=True)
    for key, project in projects.items():
        save(project, OUT / f'{key}.json')
        print(key, 'parts:', len(project['parts']), 'warnings:', export(project, OUT / key, columns=cols)['warnings'])
        new = json.loads((OUT / key / 'atlas.json').read_text(encoding='utf-8'))
        if new['frames'] != old['frames'] or any(new['meta'][k] != old['meta'][k] for k in ('size', 'pivot', 'frameTags')):
            raise SystemExit(f'{key} の atlas.json が既存の枠・タグ・pivot・大きさと違います')
    for b in built:
        report(*b)


if __name__ == '__main__':
    main()
