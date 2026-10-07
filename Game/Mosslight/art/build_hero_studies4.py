"""主人公の正面静止案 A/B/C。髪・顔・スカーフ・上着などの名前付き部品を、手書きの画素行とスパンで描く。
縮小・部品の画像リサイズ・輝度由来の法線は使わない。法線と高さは部品ごとの解析形状(SHAPE)から作る。
実行: python art/build_hero_studies4.py → .review/v4/hero-studies/<A|B|C>/ と compare.png"""
import json, math, sys
from pathlib import Path
from PIL import Image

GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GAME.parents[1] / 'Image' / 'PixelWorkbench'))
from engine import Editor, SYMBOLS, connected_count, render  # noqa: E402
import pixelwork  # noqa: E402

OUT = GAME / '.review' / 'v4' / 'hero-studies'
W, FH, PIVOT = 48, 64, (24, 58)
PAL = dict(s='#E2B088', a='#C48D68', r='#D58970', h='#5E3424', D='#8E4B2E', H='#B8653A', d='#22474F', c='#2F6B6C',
           C='#4A9088', o='#A9502F', O='#E07B3C', P='#F2A05A', p='#2E3A55', q='#3E4D6E', b='#5A3A28', B='#8A5A3A', k='#2A2230')
J = lambda *p: ''.join(p)
ALL4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
# 透明と接する縁だけを、その素材の最暗色にする(形は変えない)。靴底の k は上書きしない。
RIM = {n: (s, ALL4) for n, s in (('hair_back', 'h'), ('side_locks', 'h'), ('forelock_l', 'h'), ('forelock_m', 'h'), ('forelock_r', 'h'),
       ('face', 'a'), ('scarf', 'o'), ('scarf_tail', 'o'), ('jacket', 'd'), ('tunic', 'd'), ('mantle', 'd'), ('sleeve_l', 'd'),
       ('sleeve_r', 'd'), ('hood_l', 'd'), ('hood_r', 'd'), ('legs', 'p'))}
RIM.update(boot_l=('b', ALL4[:2]), boot_r=('b', ALL4[:2]), hand_l=('a', ((-1, 0), (0, 1))), hand_r=('a', ((1, 0), (0, 1))))

# ---- 画素の書き込み道具 ----
def put(part, x0, y0, rows):            # '.' は書かない。行ごとの幅は自由
    for dy, row in enumerate(rows):
        for dx, c in enumerate(row):
            if c != '.':
                part[(x0 + dx, y0 + dy)] = c

def spans(part, y, sym, *ranges):       # y 行の x 範囲(両端を含む)を sym で塗る
    for a, b in ranges:
        for x in range(a, b + 1):
            part[(x, y)] = sym

def mirror(cells):                      # 手描きした左側を x=47-x へ写す(正面像は左右対称)
    return {(47 - x, y): c for (x, y), c in cells.items()}

def pair(P, name, cells):
    P[name + '_l'], P[name + '_r'] = cells, mirror(cells)

# ---- 頭: 26桁、x=11+桁。h=髪の外形 D=後ろ髪 H=前髪 s=肌 a=肌の影。1案ごとに髪の形が違う ----
A_ROWS = [  # y10〜28。Opus図の流し前髪。y28の眉上の影だけ消し、アホ毛を1px伸ばした
    '.................h........', '................hh........', '.........hhhhhhhDh........',
    '.......hhDDDDDDDDDhh......', '.....hhDDDDDDDDDDDDDhh....', '....hDDDDDDDDDDDDDDDDDh...',
    '...hDDDDDDDDDDDDDDDDDDDh..', '..hDDDDHHHHHHHDDDDDDDDDDh.', '.hDDDHHHHHHHHHDDHHHHHDDDh.',
    '.hDDHHHHHHHHHHHDHHHHHHDDh.', 'hDDHHHHHHHHHHHHDHHHHHHHDDh', 'hDDHHHHHHHHHHHHsHHHHHHHDDh',
    'hDDHHHHHHHHHHHsssHHHHHHDDh', 'hDDHHHHHHHHHHssssssHHHHDDh', 'hDDHHHHHHHHHsssssssaHHHDDh',
    'hDDsHHHHHHaasssssssssaHDDh', 'hDDsaaHHHassssssssssssaDDh', 'hDDsssaHassssssssssssssDDh', J('hDD', 's' * 20, 'DDh')]
B_ROWS = [  # y10〜28。左奥のアホ毛、同じ大きさの2つの前髪、V字の頂点y=21、右側髪だけ外へ跳ねる
    J('.' * 4, 'hh', '.' * 20), J('...', 'hDDh', '.' * 19), J('...', 'hDDD', 'h' * 9, '.' * 10),
    J('..', 'hh', 'D' * 12, 'hh', '.' * 8), J('.', 'hh', 'D' * 17, 'hh', '.' * 4), J('.', 'h', 'D' * 21, 'h', '..'),
    J('h', 'D' * 24, 'h'), J('hDDD', 'H' * 18, 'DDDh'), *[J('hDD', 'H' * 20, 'DDh')] * 3,
    J('hDD', 'H' * 9, 'ss', 'H' * 9, 'DDh'), J('hDD', 'H' * 8, 's' * 4, 'H' * 8, 'DDh'), J('hDD', 'H' * 7, 's' * 6, 'H' * 7, 'DDh'),
    J('hDD', 'H' * 6, 's' * 8, 'H' * 6, 'DDh'), J('hDD', 'H' * 5, 's' * 10, 'H' * 5, 'DDh'), J('hDD', 'H' * 4, 's' * 12, 'H' * 4, 'DDh'),
    J('hDD', 'HH', 's' * 16, 'HH', 'DDh'), J('hDD', 'H', 's' * 18, 'H', 'DDh')]
C_ROWS = [  # y9〜28。左の大きな跳ねから丸い頭頂へ続き、右の小さな跳ねは4px低くする。
    J('.' * 6, 'hh', '.' * 18), J('.' * 5, 'hDDh', '.' * 17), J('.' * 4, 'hDDDDh', '.' * 16),
    J('...', 'hh', 'D' * 8, 'hhh', '.' * 10), J('..', 'h', 'D' * 15, 'h', '..', 'hDh', '..'),
    J('.', 'h', 'D' * 21, 'hh', '.'), J('h', 'D' * 24, 'h'), *[J('.', 'hD', 'H' * 19, 'DDh', '.')] * 4,
    J('hDD', 'H' * 8, 's', 'H' * 6, 's', 'H' * 4, 'DDh'), J('hDD', 'H' * 8, 'ss', 'H' * 5, 's', 'H' * 4, 'DDh'),
    J('hDD', 'H' * 7, 'sss', 'H' * 4, 'ss', 'H' * 4, 'DDh'), J('hDD', 's', 'H' * 5, 'ssss', 'H' * 3, 'ssss', 'H' * 3, 'DDh'),
    J('hDD', 'ss', 'H' * 4, 'ssss', 'H' * 3, 's' * 5, 'H', 's', 'DDh'), J('hDD', 'sss', 'H' * 3, 'ssss', 'HH', 's' * 8, 'DDh'),
    J('hDD', 's' * 4, 'HH', 's' * 5, 'H', 's' * 8, 'DDh'), J('hDD', 's' * 4, 'H', 's' * 15, 'DDh'), J('hDD', 's' * 20, 'DDh')]
HEADS = {'A': (10, A_ROWS, (16,), {}), 'B': (10, B_ROWS, (13,), dict(cheeks=True, shade=True)),
         'C': (9, C_ROWS, (11, 19), dict(cheeks=True, mouth=True, shade=True))}
FACE_LO = ['s' * 20] * 6 + ['.' + 's' * 18 + '.', '..' + 's' * 16 + '..', '....' + 's' * 12 + '....']   # 顎 y29〜37 (x14〜33)

def head(y0, rows, cuts, cheeks=False, mouth=False, shade=False):
    assert all(len(r) == 26 for r in rows), '頭の行幅は26'
    names = 'lmr' if len(cuts) == 2 else 'lr'
    P = {n: {} for n in ('hair_back', 'face', 'eyes') + tuple('forelock_' + s for s in names)}
    for dy, row in enumerate(rows):
        for col, c in enumerate(row):
            p = (11 + col, y0 + dy)
            if c in 'hD': P['hair_back'][p] = c
            elif c in 'sa': P['face'][p] = c
            elif c == 'H': P['forelock_' + names[sum(col >= k for k in cuts)]][p] = c
    put(P['face'], 14, 29, FACE_LO)
    for x in (18, 19, 28, 29):                       # 目: 等幅の暗い 2×3、白目・まぶたなし
        for y in (29, 30, 31): P['eyes'][(x, y)] = 'k'
    if cheeks:
        for x in (16, 17, 30, 31): P['face'][(x, 33)] = 'r'
    if mouth: P['face'][(23, 35)] = P['face'][(24, 35)] = 'a'
    if shade:                                        # 前髪の下端の肌影(y24〜27だけ。目の上には置かない)
        hs = {p for n, c in P.items() if n.startswith('forelock') for p in c}
        for p, c in list(P['face'].items()):
            if c == 's' and 24 <= p[1] <= 27 and (p[0], p[1] - 1) in hs: P['face'][p] = 'a'
    return P

def locks(P, left, right):                           # 側髪(顔の上に重なる)。左は x11〜、右は x34〜
    P['side_locks'] = {}
    put(P['side_locks'], 11, 29, left)
    put(P['side_locks'], 34, 29, right)

def legs_boots(P):                                   # 共通: 短い脚と靴。脚の間 x23–24、靴 y53–57、靴底 y57=k
    legs = {}
    spans(legs, 50, 'p', (17, 30)); spans(legs, 51, 'q', (17, 30))
    for y in (52, 53): spans(legs, y, 'q', (17, 22), (25, 30))
    P['legs'] = legs
    boot = {}
    put(boot, 17, 53, ['BBBBBB'] * 3 + ['bbbbbb', 'kkkkkk'])
    pair(P, 'boot', boot)

def sleeves(P, y0, y1, sym):
    s = {}
    for y in range(y0, y1): spans(s, y, sym, (14, 16))
    pair(P, 'sleeve', s)

def hands(P, y):                                     # 3×3 の手。外側と下だけ肌の影(RIM)
    h = {}
    put(h, 14, y, ['sss'] * 3)
    pair(P, 'hand', h)

# ---- 案ごとの上半身・スカーフ・髪の側 ----
def build_A(P):      # 立ち襟ジャケット + 右の結び目から外へ流れる尾
    locks(P, ['hDD'] * 6 + ['.hD'], ['DDh'] * 4 + ['Dh'])
    jk = {}
    spans(jk, 39, 'C', (17, 17), (30, 30)); spans(jk, 40, 'C', (15, 17), (30, 32)); spans(jk, 41, 'C', (15, 32))
    for y in range(42, 49):
        spans(jk, y, 'C', (16, 31) if y < 44 else (17, 30)); jk[(23, y)] = 'c'
    spans(jk, 49, 'd', (17, 30))
    P['jacket'] = jk
    sleeves(P, 42, 47, 'c'); hands(P, 47)
    sc = {}
    spans(sc, 38, 'O', (17, 30)); spans(sc, 39, 'O', (18, 29)); spans(sc, 40, 'o', (18, 29))
    for y in (39, 40): spans(sc, y, 'P', (27, 29))
    spans(sc, 41, 'O', (27, 29))
    P['scarf'] = sc
    tl = {}
    spans(tl, 41, 'O', (30, 32)); spans(tl, 42, 'O', (32, 34))
    for y in range(43, 47): spans(tl, y, 'O', (34, 36))
    spans(tl, 47, 'O', (34, 34), (36, 36))
    P['scarf_tail'] = tl
    return ['hair_back', 'legs', 'boot_l', 'boot_r', 'jacket', 'sleeve_l', 'sleeve_r', 'hand_l', 'hand_r', 'scarf_tail', 'scarf',
            'face', 'eyes', 'side_locks', 'forelock_l', 'forelock_r']

def build_B(P):      # 肩ケープ(釣鐘)。腕は隠れ、手だけ裾から出る。スカーフの尾は左肩の後ろへ
    locks(P, ['hDD'] * 6 + ['.hD', '..h'], ['DDh'] * 3 + ['DDDh', 'Dh'])
    for x in range(18, 30): P['face'][(x, 36)] = 'a'          # 顎の下の影(スカーフとの境)
    cape = {}
    for y, ab, s in ((40, (16, 31), 'C'), (41, (16, 31), 'C'), (42, (15, 32), 'c'), (43, (15, 32), 'c'),
                     (44, (14, 33), 'c'), (45, (14, 33), 'c'), (46, (13, 34), 'c')):
        spans(cape, y, s, ab)
    spans(cape, 47, 'c', (13, 16), (18, 22), (25, 29), (31, 34))   # 裾は3つの山。隙間から下の短衣が見える
    P['jacket'] = cape
    tun = {}
    for y in range(46, 50): spans(tun, y, 'd', (17, 30))
    P['tunic'] = tun
    hands(P, 46)
    sc = {}
    spans(sc, 37, 'O', (18, 29)); spans(sc, 38, 'O', (17, 30)); spans(sc, 39, 'o', (17, 30))
    spans(sc, 38, 'P', (14, 16)); spans(sc, 39, 'P', (14, 16)); spans(sc, 40, 'O', (14, 16))   # 左の結び目
    P['scarf'] = sc
    tl = {}
    for y, ab in ((39, (12, 16)), (40, (11, 15)), (41, (10, 14)), (42, (9, 13)), (43, (9, 12)), (44, (9, 11))): spans(tl, y, 'O', ab)
    spans(tl, 45, 'O', (9, 9), (11, 11))
    P['scarf_tail'] = tl
    return ['hair_back', 'scarf_tail', 'legs', 'boot_l', 'boot_r', 'tunic', 'jacket', 'hand_l', 'hand_r', 'face', 'scarf', 'eyes',
            'side_locks', 'forelock_l', 'forelock_r']

def build_C(P):      # 短い外套と、片側へ流れる橙スカーフ。肩の囲みと交差する飾りを省く。
    locks(P, ['hDD'] * 3 + ['.hD', '..h'], ['DDh'] * 2 + ['Dh'])
    jk = {}
    spans(jk, 40, 'C', (16, 31)); spans(jk, 41, 'C', (15, 32))
    for y in range(42, 47): spans(jk, y, 'C', (17, 30))
    for y in (47, 48): spans(jk, y, 'C', (16, 31))
    spans(jk, 49, 'd', (16, 22), (25, 31))
    P['jacket'] = jk
    sleeves(P, 44, 47, 'd'); hands(P, 47)
    m = {}
    spans(m, 40, 'C', (15, 32)); spans(m, 41, 'C', (14, 33))
    spans(m, 42, 'C', (13, 34))
    spans(m, 43, 'C', (14, 17), (20, 27), (30, 33))
    spans(m, 44, 'c', (15, 17), (22, 25), (30, 32))
    P['mantle'] = m
    sc = {}
    spans(sc, 38, 'O', (17, 30)); spans(sc, 39, 'O', (17, 30))
    spans(sc, 40, 'O', (18, 29)); spans(sc, 41, 'o', (19, 28))
    spans(sc, 40, 'P', (28, 29))
    P['scarf'] = sc
    tl = {}
    for y, ab in ((40, (30, 32)), (41, (32, 34)), (42, (33, 35)), (43, (34, 36)), (44, (35, 36)), (45, (35, 35))): spans(tl, y, 'O', ab)
    P['scarf_tail'] = tl
    pouch = {}
    put(pouch, 12, 46, ['.bbbb.', 'bBBBBb', 'bBBBBb', 'bBBBBb', 'bBBBbb', '.bbb..'])
    P['pouch'] = pouch
    return ['hair_back', 'legs', 'boot_l', 'boot_r', 'jacket', 'sleeve_l', 'sleeve_r', 'pouch', 'hand_l', 'hand_r', 'mantle',
            'scarf_tail', 'scarf', 'face', 'eyes', 'side_locks', 'forelock_l', 'forelock_m', 'forelock_r']

BUILD = {'A': build_A, 'B': build_B, 'C': build_C}

def rim(P):
    occ = set().union(*P.values())
    out = {}
    for n, cells in P.items():
        sym, dirs = RIM.get(n, (None, ()))
        out[n] = {p: (sym if sym and c != 'k' and any((p[0] + dx, p[1] + dy) not in occ for dx, dy in dirs) else c) for p, c in cells.items()}
    return out

# ---- 法線・高さ: 部品ごとの解析形状。kind=ell(中心と半径を明示)/fit(部品の外接矩形に内接する楕円体)/cyl(縦円柱 (中心x,半径))/row(行ごとの幅に合わせた円柱)
FACE = ('ell', (24.0, 28.0, 10.5, 10.5), 6)         # 顔: 中心(24,28)の正面向きの球面。目は同じ面の上
SHAPE = {'hair_back': ('ell', (24.0, 24.5, 13.5, 13.0), 8), 'face': FACE, 'eyes': FACE, 'side_locks': ('fit', None, 6),
         'scarf': ('fit', None, 4), 'scarf_tail': ('fit', None, 3), 'hand_l': ('fit', None, 2), 'hand_r': ('fit', None, 2),
         'hood_l': ('fit', None, 4), 'hood_r': ('fit', None, 4), 'jacket': ('row', None, 4), 'tunic': ('row', None, 3),
         'mantle': ('row', None, 5), 'sleeve_l': ('cyl', ((15.5, 1.7),), 3), 'sleeve_r': ('cyl', ((32.5, 1.7),), 3),
         'legs': ('cyl', ((20., 3.), (28., 3.)), 3), 'boot_l': ('cyl', ((20., 3.),), 3), 'boot_r': ('cyl', ((28., 3.),), 3)}
SHAPE.update({'forelock_' + s: ('fit', None, 9) for s in 'lmr'})
SHAPE['pouch'] = ('fit', None, 2)
ROUGH = {n: .85 for n in ('face', 'eyes', 'hand_l', 'hand_r', 'boot_l', 'boot_r')}
VECT = [(0., 0., 1.)] + [(s * math.cos(i * math.pi / 6), s * math.sin(i * math.pi / 6), math.sqrt(1 - s * s))
                         for s in (.12, .25, .45, .65, .8) for i in range(12)]          # 現行の61方向(平坦+5傾斜×12方位)
NPAL = {SYMBOLS[i]: '#%02x%02x00' % (round(v[0] * 127 + 128), round(v[1] * 127 + 128)) for i, v in enumerate(VECT)}

def surface(name, cells):
    kind, a, bulge = SHAPE[name]
    xs, ys = [p[0] for p in cells], [p[1] for p in cells]
    bx, by = (min(xs) + max(xs) + 1) / 2, (min(ys) + max(ys) + 1) / 2
    hx, hy = (max(xs) - min(xs) + 1) / 2, (max(ys) - min(ys) + 1) / 2
    ext = {}
    for x, y in cells:
        lo, hi = ext.get(y, (x, x)); ext[y] = (min(lo, x), max(hi, x))
    res = {}
    for x, y in cells:
        px, py = x + .5, y + .5
        if name in ('face', 'eyes'):
            # 顔は上を向く球の頂面ではなく、正面を向く浅い面。目にも同じ面を使う。
            u = (px - 24) / 10.5 * .3
            v = -.65
            nz = math.sqrt(max(.1, 1 - u * u - v * v))
            res[(x, y)] = ((u, v, nz), max(0., .88 * (58 - py)) + 1.5 * nz)
            continue
        if kind == 'ell': u, v = (px - a[0]) / a[2], -(py - a[1]) / a[3]
        elif kind == 'fit': u, v = (px - bx) / hx, -(py - by) / hy
        elif kind == 'cyl':
            cx, rx = min(a, key=lambda t: abs(px - t[0])); u, v = (px - cx) / rx, .15
        else:
            lo, hi = ext[y]; u, v = (px - (lo + hi + 1) / 2) / ((hi - lo + 1) / 2), .15
        r2 = u * u + v * v
        if r2 > .98: k = math.sqrt(.98 / r2); u, v, r2 = u * k, v * k, .98
        nz = math.sqrt(1 - r2)
        if name.startswith('boot'):                 # 靴: 高さは靴自身の最下行(靴底)を基準にし、靴底に膨らみを足さない。法線は上と同じ
            res[(x, y)] = ((u, v, nz), max(0., .85 * (max(ys) + 1 - py)))
            continue
        res[(x, y)] = ((u, v, nz), max(0., .85 * (58 - py)) + bulge * nz)   # 高さ: 足元からの高さ + 部品の膨らみ
    return res

def build(parts, order, palette):
    lines = [f'canvas {W} {FH}', f'pivot {PIVOT[0]} {PIVOT[1]}'] + [f'palette {k} {v}' for k, v in palette.items()]
    place = []
    for n in order:
        xs, ys = [p[0] for p in parts[n]], [p[1] for p in parts[n]]
        x0, y0, w, h = min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        lines += [f'part {n} {w} {h}', 'rows ' + '|'.join(''.join(parts[n].get((x0 + i, y0 + j), '.') for i in range(w)) for j in range(h))]
        place.append(f'place {n} {n} {x0} {y0}')
    return Editor().apply('\n'.join(lines + ['frame front 100'] + place))

def compare(images):
    bgs = ('#587a3e', '#7b5a3c', '#10161f')              # 草・土・夜
    sheet = Image.new('RGB', (len(images) * 152 + 8, len(bgs) * 200 + 72), '#000')
    for i, im in enumerate(images):
        for j, bg in enumerate(bgs):
            big = Image.new('RGBA', (144, 192), bg); big.alpha_composite(im.resize((144, 192), Image.Resampling.NEAREST))
            small = Image.new('RGBA', (48, 64), bg); small.alpha_composite(im)
            sheet.paste(big, (8 + i * 152, 8 + j * 200)); sheet.paste(small, (8 + i * 152 + j * 50, 8 + len(bgs) * 200))
    sheet.save(OUT / 'compare.png')

def main():
    shown, report = [], {}
    for key in 'ABC':
        y0, rows, cuts, opts = HEADS[key]
        P = head(y0, rows, cuts, **opts)
        legs_boots(P)
        order = BUILD[key](P)
        assert set(order) == set(P), (key, set(P) ^ set(order))
        assert all(0 <= x < W and 0 <= y < FH for c in P.values() for x, y in c), '画面外の画素'
        P = rim(P)
        geo = {n: surface(n, P[n]) for n in order}
        hq = lambda n, g: (min(62, round(g[1] / 2) * 2), ROUGH.get(n, .8))
        levels = sorted({hq(n, g) for n in order for g in geo[n].values()})
        assert len(levels) <= 64, '高さ色が64色を超える'
        hsym = {lv: SYMBOLS[i] for i, lv in enumerate(levels)}
        hpal = {SYMBOLS[i]: '#%02x%02x80' % (round(lv[0] / 64 * 255), round(lv[1] * 255)) for i, lv in enumerate(levels)}   # B=128: 中立
        near = lambda nv: max(range(61), key=lambda i: sum(p * q for p, q in zip(VECT[i], nv)))
        alb = build(P, order, PAL)
        nrm = build({n: {p: SYMBOLS[near(g[0])] for p, g in geo[n].items()} for n in order}, order, NPAL)
        hgt = build({n: {p: hsym[hq(n, g)] for p, g in geo[n].items()} for n in order}, order, hpal)
        img = {k: render(v, v['frames'][0])[0] for k, v in (('albedo', alb), ('normal', nrm), ('height', hgt))}
        assert img['albedo'].getchannel('A').tobytes() == img['normal'].getchannel('A').tobytes() == img['height'].getchannel('A').tobytes(), 'alpha不一致'
        colors = len({c for c in img['albedo'].getdata() if c[3]})
        assert 16 <= colors <= 20, f'アルベド色数 {colors}'
        dest = OUT / key
        for sub, proj, stem in (('', alb, 'hero'), ('normal', nrm, 'hero-normal'), ('height', hgt, 'hero-height')):
            pixelwork.save(proj, dest / sub / f'{stem}.json')
            pixelwork.export(proj, dest / sub)
        shown.append(img['albedo'])
        report[key] = dict(colors=colors, normal_colors=len({c for c in img['normal'].getdata() if c[3]}), height_colors=len(levels),
                           bbox=img['albedo'].getbbox(), singletons=connected_count(img['albedo']).count(1), parts=len(order))
    compare(shown)
    print(json.dumps(report, ensure_ascii=False))

if __name__ == '__main__':
    main()
