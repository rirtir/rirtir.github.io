"""主人公 Explorer4: 静止案C(build_hero_studies4)の部品から、下・上・右・左 × idle2/walk4/attack3/roll3 の48コマを組む。
部品(髪・顔・上着・袖・手・脚・靴・スカーフ・ポーチ)を姿勢ごとに動かす/描き直す。帯の横ずらしや画像の変形は使わない。
法線と高さは部品ごとの解析形状(HS.surface / 自前の vol・capsule)から作り、画素の明度は使わない。
高さは h = 0.85*(接地y - 画素y) + 部品の膨らみ。接地y は部品ごとの地面(足の前後移動は地面の変位、持ち上げは高さ)。
down_idle0 は HS の静止案Cと同じ画素・法線・高さ(実行時に照合する)。左は右の鏡像(Nx 反転、メタ座標も反転)。
歩行は STEP(=6px)ごとに1コマ進める。接地足は連続する3コマで地面に固定(前後 +STEP,0,-STEP)、持ち上げ足は高さ2。
キャンバスは 48×72(元の48×64の下に透明8行。pivot (24,58) 不変)。down_idle0 は上64行が静止案Cと画素一致。
実行: python art/build_explorer4.py [--out .review/v4/explorer-production] [--columns 8]
出力: albedo/normal/height(.json と各フォルダ: atlas・contact・review・タグGIF)と poses.json。assets/ へは昇格しない。"""
import argparse, json, math, sys
from pathlib import Path

ART = Path(__file__).resolve().parent
sys.path.insert(0, str(ART))
import build_hero_studies4 as HS  # noqa: E402  (Image/PixelWorkbench を sys.path へ入れる)
from engine import Editor, SYMBOLS, render, digest  # noqa: E402
from pixelwork import export, save  # noqa: E402

GAME = HS.GAME
OUT = GAME / '.review' / 'v4' / 'explorer-production'
CANON = GAME / 'assets' / 'explorer' / 'atlas.json'
W, FH, PV = 48, 72, (24, 58)               # キャンバス高は 64→72(下に透明8行。幅・pivot は不変)。前に出る足の接地が +y に伸びる分
OLD_FH = 64                                # 静止案Cの元のキャンバス高。down_idle0 は上 OLD_FH 行が静止案Cと画素一致、残りは透明
SL = .85
A4 = HS.ALL4
STEP = 6                                   # 歩行1コマあたりの移動距離(px)。1周 = 4コマ = 24px。
# STEP=8 は検討したが採用しない: 下・上向きの後ろ足は接地が -8 で靴底 y=49 となり、全体が上着(y40-49)の裏に隠れる。
# 6 なら靴底 y=51 で靴の下2行(y50-51)が見える。下上向きの接地は画面yへ1:1(接地の真実性を優先)。
SHORT = ('idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'attack0', 'attack1', 'attack2', 'roll0', 'roll1', 'roll2')
GAIT = {'L': [(STEP, 0), (0, 0), (-STEP, 0), (0, 2)], 'R': [(-STEP, 0), (0, 2), (STEP, 0), (0, 0)]}   # (前方への足位置o, 持ち上げpx)
ARM = lambda o: (-o * 2) // STEP           # 腕は同じ側の足と逆に振る。振れ幅は常に ±2
BOB = (0, -1, 0, -1)                       # 通過コマで1px上がる
LAG = (-1, 0, -1, 0)                       # 外套・尾は1コマ遅れる
WALK = dict(distance_per_frame=STEP, cycle_px=4 * STEP, frames=4, frame_index='floor(walkT / distance_per_frame) % 4',
            planted_frames=3, forward_offsets_planted=[STEP, 0, -STEP], lifted_height_px=2, lifted_offset=0,
            note='接地足は連続3コマで o が -STEP ずつ動き、地面に対して静止する。持ち上げ足は o=0・高さ2')
FAIL = []

def check(ok, msg):
    if not ok: FAIL.append(msg)
    return bool(ok)

RIMX = dict(HS.RIM)
RIMX.update({n: ('p', A4) for n in ('leg_l', 'leg_r', 'leg_n', 'leg_f')})
RIMX.update(face_side=('a', A4), jacket_side=('d', A4), mantle_side=('d', A4), scarf_side=('o', A4), tail_side=('o', A4),
            sleeve_side=('d', A4), hand_side=('a', ((1, 0), (0, 1))), ball=('d', A4), crown=('h', A4), boot_side=('b', A4[:2]))

# ---- 静止案C の生の部品(縁取り前) ----
def raw_c():
    y0, rows, cuts, opts = HS.HEADS['C']
    P = HS.head(y0, rows, cuts, **opts)
    HS.legs_boots(P)
    order = HS.build_C(P)
    assert set(order) == set(P)
    return P, order
P0, ORDER0 = raw_c()
mir = lambda cells: {(47 - x, y): c for (x, y), c in cells.items()}

# ---- 量子化(HS と同じ) ----
VECT = HS.VECT
near = lambda N: max(range(61), key=lambda i: sum(p * q for p, q in zip(VECT[i], N)))
MIRROR_IDX = [min(range(61), key=lambda j: sum((a - b) ** 2 for a, b in zip(VECT[j], (-v[0], v[1], v[2])))) for v in VECT]
hq = lambda h, r: (min(62, round(h / 2) * 2), r)

# ---- 形状 ----
def ell_cells(cx, cy, rx, ry):
    return {(x, y) for y in range(int(cy - ry) - 1, int(cy + ry) + 2) for x in range(int(cx - rx) - 1, int(cx + rx) + 2)
            if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1}

def cells_of(*rows):                        # (y, 記号, (x0,x1), ...)。後の指定が上書き
    c = {}
    for y, sym, *rs in rows:
        for a, b in rs:
            for x in range(a, b + 1): c[(x, y)] = sym
    return c

def vol(cells, kind, a=None, bulge=4., gy=58., sl=SL, rough=.8):
    """HS.surface と同じ式。gy は接地y(数値か (px,py)->値)。返り値 {画素: (法線, 高さ, 粗さ)}"""
    cells = list(cells)
    xs, ys = [p[0] for p in cells], [p[1] for p in cells]
    bx, by = (min(xs) + max(xs) + 1) / 2, (min(ys) + max(ys) + 1) / 2
    hx, hy = (max(xs) - min(xs) + 1) / 2, (max(ys) - min(ys) + 1) / 2
    ext = {}
    for x, y in cells:
        lo, hi = ext.get(y, (x, x)); ext[y] = (min(lo, x), max(hi, x))
    out = {}
    for x, y in cells:
        px, py = x + .5, y + .5
        if kind == 'ell': u, v = (px - a[0]) / a[2], -(py - a[1]) / a[3]
        elif kind == 'fit': u, v = (px - bx) / hx, -(py - by) / hy
        elif kind == 'cyl':
            cx, rx = min(a, key=lambda t: abs(px - t[0])); u, v = (px - cx) / rx, .15
        else:
            lo, hi = ext[y]; u, v = (px - (lo + hi + 1) / 2) / ((hi - lo + 1) / 2), .15
        r2 = u * u + v * v
        if r2 > .98: k = math.sqrt(.98 / r2); u, v, r2 = u * k, v * k, .98
        nz = math.sqrt(1 - r2)
        g = gy(px, py) if callable(gy) else gy
        out[(x, y)] = ((u, v, nz), max(0., sl * (g - py)) + bulge * nz, rough)
    return out

def capsule(p0, p1, r, gy0=58., gy1=58., bulge=3., rough=.8):
    """2関節間の丸端カプセル。法線は軸に垂直(画面)、接地yは軸方向に gy0→gy1 と補間"""
    vx, vy = p1[0] - p0[0], p1[1] - p0[1]
    l2 = vx * vx + vy * vy
    ln = math.sqrt(l2) or 1.
    qx, qy = -vy / ln, vx / ln
    R = r + 1
    out = {}
    for y in range(int(math.floor(min(p0[1], p1[1]) - R)), int(math.ceil(max(p0[1], p1[1]) + R))):
        for x in range(int(math.floor(min(p0[0], p1[0]) - R)), int(math.ceil(max(p0[0], p1[0]) + R))):
            cx, cy = x + .5, y + .5
            t = 0. if l2 == 0 else min(1., max(0., ((cx - p0[0]) * vx + (cy - p0[1]) * vy) / l2))
            ax, ay = p0[0] + t * vx, p0[1] + t * vy
            if math.hypot(cx - ax, cy - ay) > r: continue
            s = max(-.98, min(.98, ((cx - ax) * qx + (cy - ay) * qy) / r))
            nz = math.sqrt(1 - s * s)
            g = gy0 + (gy1 - gy0) * t
            out[(x, y)] = ((qx * s, -qy * s, nz), max(0., SL * (g - cy)) + bulge * nz, rough)
    return out

# ---- レイヤー: cells {画素: 記号}, field {画素: (法線, 高さ, 粗さ)}, rim=縁取りの鍵, sl=高さの傾き ----
def lay(name, cells_or_sym, fld, rim=None, sl=SL):
    cells = cells_or_sym if isinstance(cells_or_sym, dict) else {p: cells_or_sym for p in fld}
    return dict(name=name, cells=cells, field=fld, rim=rim or name, sl=sl)

def placed(l, dx=0, dy=0, gdy=0.):
    """部品を(dx,dy)動かす。地面が gdy だけ動く(奥行き移動)なら高さは変えず、持ち上げなら高さが変わる"""
    if not (dx or dy or gdy): return l
    return dict(l, cells={(x + dx, y + dy): c for (x, y), c in l['cells'].items()},
                field={(x + dx, y + dy): (N, max(0., h + l['sl'] * (gdy - dy)), r) for (x, y), (N, h, r) in l['field'].items()})

def native(name, shape=None, cells=None, keep=None, dx=0, dy=0, gdy=0., rim=None, sym=None, lname=None):
    """静止案Cの部品(または同じ形状種を使う別の画素)を HS.surface で場にして動かす"""
    shape = shape or name
    src = P0[name] if cells is None else cells
    if keep: src = {p: c for p, c in src.items() if keep(p)}
    geo = HS.surface(shape, src)
    sl = .88 if shape in ('face', 'eyes') else SL
    rough = HS.ROUGH.get(shape, .8)
    cs, fld = {}, {}
    for (x, y), c in src.items():
        N, h = geo[(x, y)]
        q = (x + dx, y + dy)
        cs[q] = sym or c
        fld[q] = (N, max(0., h + sl * (gdy - dy)), rough)
    return dict(name=lname or name, cells=cs, field=fld, rim=rim or name, sl=sl)

def blob_layer(name, cx, cy, rx, ry, symf, rim, bulge=8., gy=58., rough=.8):
    cs = ell_cells(cx, cy, rx, ry)
    return lay(name, {p: symf(p) for p in cs}, vol(cs, 'ell', (cx, cy, rx, ry), bulge=bulge, gy=gy, rough=rough), rim=rim)

def compose(layers):
    """奥から手前へ塗る。縁取りは全部品の合成輪郭(透明と接する辺)だけ(HS.rim と同じ規則)"""
    occ = set()
    for l in layers: occ.update(l['cells'])
    pix = {}
    for l in layers:
        sym, dirs = RIMX.get(l['rim'], (None, ()))
        for p, c in l['cells'].items():
            if not (0 <= p[0] < W and 0 <= p[1] < FH): raise ValueError(f"{l['name']} が画面外: {p}")
            if sym and c != 'k' and any((p[0] + dx, p[1] + dy) not in occ for dx, dy in dirs): c = sym
            N, h, r = l['field'][p]
            pix[p] = (c, near(N), hq(h, r), l['name'], h)
    return pix

def finish(layers, info):
    by = {l['name']: l for l in layers}
    assert len(by) == len(layers), 'レイヤー名が重複'
    return dict(pix=compose(layers), info=info, by=by, names=[l['name'] for l in layers])

# ---- 後ろ姿の頭: 前の頭の輪郭(y<=36)を髪で埋め、大小2つの前髪相当のまとまり(H)を後頭部に置く。顔・目なし ----
def back_head():
    S = {p: 'D' for n in ('hair_back', 'face', 'side_locks', 'forelock_l', 'forelock_m', 'forelock_r') for p in P0[n] if p[1] <= 36}
    # 後頭部は大きな1つの髪の塊(H)。外周1画素は暗い縁(D)。長さの違う3本の短い割れ目(D)だけで塊を分ける。
    # 光はベイクしない: 素材は塊全体で同じ。法線は塊全体を1つの体積として張り、割れ目は少し凹ませるだけ
    inset = {p for p in S if p[1] <= 34 and all(q in S for q in ((p[0] - 1, p[1]), (p[0] + 1, p[1]), (p[0], p[1] - 1), (p[0], p[1] + 1)))}
    seams = {(21, 16), (21, 17), (20, 18), (20, 19), (19, 20), (19, 21), (19, 22),
             (28, 19), (28, 20), (29, 21), (29, 22),
             (24, 26), (24, 27), (25, 28), (25, 29), (25, 30)} & inset
    fld = vol(inset, 'fit', bulge=6.)
    for p in seams:
        N, h, r = fld[p]
        fld[p] = (N, max(0., h - 1.5), r)
    dome = lay('hair_dome', {p: ('D' if p in seams else 'H') for p in inset}, fld, rim='hair_back')
    return [native('hair_back', cells=S), dome]

NECK_UP = cells_of((37, 'a', (20, 27)))      # 後ろ姿の首筋(後頭部の最下行 y36 x16〜31 とスカーフ最上行 y38 x17〜30 の間を1行でつなぐ)

def native_front():
    """down_idle0: 静止案Cそのもの(部品・順序・場)。靴の高さも C の値のまま"""
    return [native(n) for n in ORDER0], dict(planted={'L': True, 'R': True}, o={'L': 0, 'R': 0}, screen_o={'L': 0, 'R': 0},
                                              boots={'L': 'boot_l', 'R': 'boot_r'}, head=[24, 23], hands=['hand_l', 'hand_r'], native=True)

# ---- 正面(down)/背面(up)の標準姿勢 ----
def std_frame(view, hd=(0, 0), up=(0, 0), tl=None, hip=0, foot=None, hand=None, gd=None, boots_front=False, pdx=0):
    """hd=頭の移動 up=上半身 tl=外套・尾(遅れ) hip=腰の上下 foot={'L':(o,持ち上げ)} o=前方への地面位置(downは+y,upは-y)
    hand={'L':(左上x,左上y)} gd=手の接地yの変位 pdx=ポーチを横へ逃がす量"""
    dn = view == 'down'
    sg = 1 if dn else -1
    ux, uy = up
    tx, ty = up if tl is None else tl
    foot, hand, gd = foot or {}, hand or {}, gd or {}
    if dn:
        hb = native('hair_back', dx=hd[0], dy=hd[1])
        hf = [native(n, dx=hd[0], dy=hd[1]) for n in ('face', 'eyes', 'side_locks', 'forelock_l', 'forelock_m', 'forelock_r')]
    else:
        hb, hf = None, [placed(l, hd[0], hd[1]) for l in back_head()]
    lb, planted, offs, so_, bl, hem = [], {}, {}, {}, {}, []
    for s, x0, cx in (('L', 17, 20.), ('R', 25, 28.)):
        o, lift = foot.get(s, (0, 0))
        so = sg * o                                      # 接地点の画面y変位
        S = 57 + so - lift                               # 靴底の行
        bc = {(x, y + S - 57): c for (x, y), c in P0['boot_' + s.lower()].items()}
        boot = lay('boot_' + s.lower(), bc, vol(bc, 'cyl', ((cx, 3.),), bulge=.5, gy=58. + so, rough=.85))
        yT, yB = 52 + hip, S - 3
        leg = None
        if yB >= yT:
            span = max(1., yB + 1 - yT)
            gyf = lambda px, py, so=so, yT=yT, span=span: 58. + so * min(1., max(0., (py - yT) / span))
            if yB - yT >= 6:                             # 前へ出る長い脚: 腿は外套の裾の奥で内へ1px曲げ、膝の線(p)の下に短い脛(3〜4行)と靴
                kr, d = yB - 4, (1 if s == 'L' else -1)
                th = {(x, y): 'q' for x in range(x0 + d, x0 + d + 6) for y in range(yT, kr)}
                sh = {(x, y): 'q' for x in range(x0, x0 + 6) for y in range(kr, yB + 1)}
                for x in range(x0, x0 + 6): sh[(x, kr)] = 'p'; sh[(x, yB)] = 'p'
                lf = vol(th, 'cyl', ((cx + d, 3.),), bulge=3., gy=gyf)
                lf.update(vol(sh, 'cyl', ((cx, 3.),), bulge=3., gy=gyf))
                lc = {**th, **sh}
                hem.append((x0, x0 + 5))
            else:
                lc = {(x, y): 'q' for x in range(x0, x0 + 6) for y in range(yT, yB + 1)}
                if yB - yT >= 4:                         # 長く伸びる脚は靴の上に濃い裾(p)を1行入れ、単色の長ズボンにしない
                    for x in range(x0, x0 + 6): lc[(x, yB)] = 'p'
                lf = vol(lc, 'cyl', ((cx, 3.),), bulge=3., gy=gyf)
            leg = lay('leg_' + s.lower(), lc, lf)
        lb.append((S, leg, boot))
        planted[s], offs[s], so_[s], bl[s] = lift == 0, o, so, 'boot_' + s.lower()
    lb.sort(key=lambda t: t[0])                          # 画面で上(奥)の足から描く
    pre, post = [], []
    for _, leg, boot in lb:
        if leg: pre.append(leg)
        (post if boots_front else pre).append(boot)
    hips = native('legs', keep=lambda p: p[1] <= 51, dy=hip, lname='hips')
    arms, hands = [], []
    for s, sx, h0 in (('L', 15.5, 14), ('R', 32.5, 31)):
        t = hand.get(s, (h0 + ux, 47 + uy))
        g = float(gd.get(s, 0.))
        arms.append(lay('sleeve_' + s.lower(), 'd', capsule((sx + ux, 45.5 + uy), (t[0] + 1.5, t[1] + .5), 1.5, 58., 58. + g, 3.)))
        hands.append(native('hand_' + s.lower(), dx=t[0] - h0, dy=t[1] - 47, gdy=g))
    jacket, mantle = native('jacket', dx=ux, dy=uy), native('mantle', dx=tx, dy=ty)
    for xa, xb in hem:                                   # 動く脚の側だけ外套の裾を1px下げて腿を隠す
        for x in range(xa, xb + 1):
            col = [y for (px, y) in jacket['cells'] if px == x]
            if col and (x, max(col) + 1) not in jacket['cells']:
                b = (x, max(col)); q = (x, b[1] + 1)
                jacket['cells'][q] = jacket['cells'][b]; jacket['field'][q] = jacket['field'][b]
    if dn:
        scarf, tail = native('scarf', dx=ux, dy=uy), native('scarf_tail', dx=tx, dy=ty)
        pouch = native('pouch', dx=ux + pdx, dy=uy)
    else:
        scarf = native('scarf', cells={p: ('O' if c == 'P' else c) for p, c in P0['scarf'].items()}, dx=ux, dy=uy)
        tail = native('scarf_tail', cells=mir(P0['scarf_tail']), dx=tx, dy=ty)
        pouch = native('pouch', cells=mir(P0['pouch']), dx=ux + pdx, dy=uy)
        neck = native('scarf', cells=NECK_UP, lname='neck', rim='neck', dx=ux, dy=uy)   # 後頭部(y<=36)とスカーフ(y>=38)の間の首筋
    seq = ([hb] if dn else []) + [hips] + pre + [jacket] + arms + [pouch] + post + [mantle, tail] + ([] if dn else [neck]) + [scarf] + hf + hands
    return seq, dict(planted=planted, o=offs, screen_o=so_, boots=bl, head=[24 + hd[0], 23 + hd[1]], hands=['hand_l', 'hand_r'])

# ---- 丸まり(roll1): 外套の球、髪の頭頂、横へ出る靴、スカーフ ----
def coat_sym(cx, cy, rx, ry):
    def f(p):
        u, v = (p[0] + .5 - cx) / rx, (p[1] + .5 - cy) / ry
        return 'c' if .5 <= math.hypot(u, v) <= .62 and u < -.1 and v < -.1 else 'C'
    return f

def crown_sym(hx, hy, rx, ry):
    return lambda p: 'H' if ((p[0] + .5 - hx) / rx) ** 2 + ((p[1] + .5 - hy) / ry) ** 2 <= 1 else 'D'

def roll_ball(view):
    dn = view == 'down'
    cx, cy, rx, ry = 24., 46.4, 12.2, 11.2
    ball = blob_layer('ball', cx, cy, rx, ry, coat_sym(cx, cy, rx, ry), 'ball')
    kx, ky = (24., 50.3) if dn else (24., 41.)
    hh = (20.5, 48.5) if dn else (27.5, 39.5)
    crown = blob_layer('crown', kx, ky, 9.5, 6.3, crown_sym(hh[0], hh[1], 4.3, 3.), 'crown', bulge=7.)
    boots, bl = [], {}
    for s, d in (('L', -6), ('R', 6)):
        bc = {(x + d, y - 5): c for (x, y), c in P0['boot_' + s.lower()].items()}
        cxb = (20. if s == 'L' else 28.) + d
        boots.append(lay('boot_' + s.lower(), bc, vol(bc, 'cyl', ((cxb, 3.),), bulge=.5, gy=58., rough=.85)))
        bl[s] = 'boot_' + s.lower()
    if dn:
        scarf, tail = native('scarf', dy=-2), native('scarf_tail', dx=1, dy=-1)
        seq = [ball] + boots + [scarf, tail, crown]
    else:
        scarf = native('scarf', cells={p: ('O' if c == 'P' else c) for p, c in P0['scarf'].items()}, dy=4)
        tail = native('scarf_tail', cells=mir(P0['scarf_tail']), dx=-1, dy=-1)
        seq = [ball] + boots + [crown, scarf, tail]
    return seq, dict(planted={'L': False, 'R': False}, o={}, screen_o={}, boots=bl, head=[24, int(ky)], hands=[], tucked=True)

ATK = {'down': {'attack0': dict(hd=(1, 0), tl=(1, 0), hand={'R': (35, 40)}, gd={'R': 0.}),
                'attack1': dict(hd=(0, 1), up=(0, 1), foot={'L': (-1, 0), 'R': (2, 0)}, hand={'R': (34, 49)}, gd={'R': 3.}),
                'attack2': dict(hd=(-1, 1), up=(0, 1), foot={'R': (1, 0)}, hand={'R': (28, 49)}, gd={'R': 2.})},
       'up': {'attack0': dict(hd=(1, 0), tl=(1, 0), hand={'R': (35, 40)}, gd={'R': 0.}),
              'attack1': dict(foot={'L': (-1, 0), 'R': (2, 0)}, hand={'R': (33, 38)}, gd={'R': -3.}),
              'attack2': dict(hd=(-1, 0), hand={'R': (28, 47)}, gd={'R': -2.})}}

def pose_std(view, short):
    dn = view == 'down'
    sg = 1 if dn else -1
    if short == 'idle0': return native_front() if dn else std_frame(view)
    if short == 'idle1': return std_frame(view, hd=(0, 1), up=(0, 1))
    if short.startswith('walk'):
        f = int(short[-1])
        foot = {'L': GAIT['L'][f], 'R': GAIT['R'][f]}
        b = BOB[f]
        hand, gd = {}, {}
        for s, x0 in (('L', 14), ('R', 31)):
            ady = sg * ARM(foot[s][0])                   # 腕は同じ側の脚と逆に振る
            hand[s], gd[s] = (x0, 47 + b + ady), ady
        return std_frame(view, hd=(0, b), up=(0, b), tl=(0, LAG[f]), hip=b, foot=foot, hand=hand, gd=gd)
    if short.startswith('attack'):
        spec = ATK[view][short]
        seq, info = std_frame(view, **spec)
        h = spec['hand']['R']
        info['grip'] = [h[0] + 1, h[1] + 1]              # 握る手の中心画素
        return seq, info
    po = -2 if dn else 2
    if short == 'roll0':
        return std_frame(view, hd=(0, 7), up=(0, 6), hip=3, hand={'L': (15, 52), 'R': (30, 52)}, boots_front=dn, pdx=po)
    if short == 'roll1': return roll_ball(view)
    return std_frame(view, hd=(0, 4), up=(0, 3), hip=1, foot={'L': (2, 0), 'R': (-2, 0)}, hand={'L': (13, 51), 'R': (32, 51)},
                     boots_front=dn, pdx=po)

# ---- 右向き(+x)。近い側=N、遠い側=F。頭は新規: 目は1つ、鼻は小さな出っ張り、顔は前を向く浅い面 ----
SIDE_W = {12: (17, 30), 13: (15, 32), 14: (14, 33), 15: (13, 34), 33: (13, 35), 34: (15, 35), 35: (17, 34), 36: (19, 33), 37: (22, 31)}
SIDE_W.update({y: (12, 35) for y in range(16, 33)})
SIDE_BOOT = ['BBB....', 'BBB....', 'BBBBBBB', 'bbbbbbb', 'kkkkkkk']      # 爪先は+x、靴底は最下行
FAR_T = str.maketrans('B', 'b')

def face_fld(cells, lean=.35):
    """正面と同じ浅い面(下向き傾き -.65)に、前(+x)への傾きだけ足す。目・鼻も同じ式なので同じ法線・高さ・粗さ"""
    out = {}
    for x, y in cells:
        px, py = x + .5, y + .5
        u, v = lean + (px - 30) / 12 * .3, -.65
        nz = math.sqrt(max(.1, 1 - u * u - v * v))
        out[(x, y)] = ((u, v, nz), max(0., .88 * (58 - py)) + 1.5 * nz, .85)
    return out

def side_head():
    sil = {(x, y) for y, (a, b) in SIDE_W.items() for x in range(a, b + 1)}
    face = {p for p in sil if (p[1] >= 26 and p[0] >= 24) or (p[1] >= 22 and p[0] >= 32) or (p[1] >= 33 and p[0] >= 19)}
    hair = {p: 'D' for p in sil - face}
    HS.put(hair, 15, 11, ['hDDDDh']); HS.put(hair, 16, 10, ['hDDh']); HS.put(hair, 17, 9, ['hh']); HS.put(hair, 27, 11, ['hDh'])   # 大小2つの跳ね
    big = {p for p in hair if p[1] >= 13 and ((p[0] + .5 - 28.5) / 8) ** 2 + ((p[1] + .5 - 19.5) / 6.5) ** 2 <= 1}
    small = {p for p in hair if p not in big and p[1] >= 13 and ((p[0] + .5 - 16.5) / 4.2) ** 2 + ((p[1] + .5 - 21.5) / 6.5) ** 2 <= 1}
    fs = {p: ('a' if (p[0], p[1] - 1) in hair and p[1] <= 27 else 's') for p in face}
    fs[(31, 33)] = fs[(32, 33)] = 'r'
    eyes = {(x, y): 'k' for x in (30, 31) for y in (29, 30, 31)}
    nose = {(36, 31): 's', (36, 32): 's', (37, 32): 'a'}
    return [native('hair_back', cells=hair),
            lay('face', fs, face_fld(fs)), lay('nose', nose, face_fld(nose)), lay('eyes', eyes, face_fld(eyes)),
            native('forelock_l', cells={p: 'H' for p in big}, lname='tuft_big'),
            native('forelock_r', cells={p: 'H' for p in small}, lname='tuft_small')]
SIDE_HEAD = side_head()

JK_S = cells_of(*[(40, 'C', (19, 28)), (41, 'C', (18, 29)), (42, 'C', (19, 28))], *[(y, 'C', (20, 27)) for y in range(43, 47)],
                (47, 'C', (19, 28)), (48, 'C', (19, 28)), (49, 'd', (20, 27)))           # 細い腰、段のある裾
MN_S = cells_of((40, 'C', (19, 29)), (41, 'C', (18, 29)), (42, 'C', (17, 28)), (43, 'C', (17, 20), (23, 27)), (44, 'c', (17, 19), (24, 26)))
SC_S = cells_of((38, 'O', (20, 28)), (39, 'O', (20, 29)), (40, 'O', (21, 28)), (41, 'o', (21, 27)), (39, 'P', (19, 19)), (40, 'P', (19, 20)))
TL_S = cells_of((41, 'O', (15, 19)), (42, 'O', (14, 18)), (43, 'O', (13, 17)), (44, 'O', (13, 15)))
HIP_S = cells_of((50, 'p', (20, 27)), (51, 'q', (20, 27)))

def side_frame(hd=(0, 0), up=(0, 0), tl=None, hip=0, foot=None, hand=None, boots_front=False):
    """foot={'N':(o,持ち上げ)} o=爪先方向(+x)への足位置(靴の左端 x0=21+o)。hand={'N':(左上x,左上y)}"""
    ux, uy = up
    tx, ty = up if tl is None else tl
    base = {'N': (2, 0), 'F': (0, 0)}
    foot, hand = foot or {}, hand or {}
    parts, planted, offs, bl = {}, {}, {}, {}
    for s in 'NF':
        far = s == 'F'
        o, lift = foot.get(s, base[s])
        S, x0, sl_ = 57 - lift, 21 + o, s.lower()
        rows = [r.translate(FAR_T) if far else r for r in SIDE_BOOT]
        bc = {(x0 + i, S - 4 + j): c for j, r in enumerate(rows) for i, c in enumerate(r) if c != '.'}
        parts['boot_' + sl_] = lay('boot_' + sl_, bc, vol(bc, 'cyl', ((x0 + 3.5, 3.5),), bulge=.5, gy=58., rough=.85), rim='boot_side')
        parts['leg_' + sl_] = lay('leg_' + sl_, 'p' if far else 'q', capsule((23. if far else 24., 51. + hip), (x0 + 1.5, S - 3.), 1.8), rim='leg_' + sl_)
        t = hand.get(s, ((22 if far else 23) + ux, 47 + uy))
        parts['sleeve_' + sl_] = lay('sleeve_' + sl_, 'd', capsule(((22.5 if far else 24.) + ux, 45.5 + uy), (t[0] + 1.5, t[1] + .5), 1.5), rim='sleeve_side')
        parts['hand_' + sl_] = native('hand_r', dx=t[0] - 31, dy=t[1] - 47, rim='hand_side', sym='a' if far else None, lname='hand_' + sl_)
        planted[s], offs[s], bl[s] = lift == 0, o, 'boot_' + sl_
    hips = native('legs', cells=HIP_S, dy=hip, lname='hips')
    jacket = native('jacket', cells=JK_S, rim='jacket_side', dx=ux, dy=uy)
    mantle = native('mantle', cells=MN_S, rim='mantle_side', dx=tx, dy=ty)
    scarf = native('scarf', cells=SC_S, rim='scarf_side', dx=ux, dy=uy)
    tail = native('scarf_tail', cells=TL_S, rim='tail_side', dx=tx, dy=ty)
    pouch = native('pouch', dx=2 + ux, dy=uy)                                  # 背中側の腰に下がる
    head = [placed(l, hd[0], hd[1]) for l in SIDE_HEAD]
    bn = parts['boot_n']
    seq = ([parts['sleeve_f'], parts['hand_f'], parts['leg_f'], parts['boot_f'], tail, hips, parts['leg_n']] + ([] if boots_front else [bn])
           + [jacket, pouch] + ([bn] if boots_front else []) + [parts['sleeve_n'], mantle, scarf] + head + [parts['hand_n']])
    return seq, dict(planted=planted, o=offs, screen_o={'N': 0, 'F': 0}, boots=bl, head=[24 + hd[0], 24 + hd[1]], hands=['hand_n', 'hand_f'])

def roll_side():
    cx, cy, rx, ry = 24., 46.4, 12.2, 11.2
    ball = blob_layer('ball', cx, cy, rx, ry, coat_sym(cx, cy, rx, ry), 'ball')
    crown = blob_layer('crown', 31.5, 45.5, 6.8, 6.8, crown_sym(34., 43.5, 3., 3.), 'crown', bulge=7.)
    boots, bl = {}, {}
    for s, x0, S in (('n', 8, 51), ('f', 12, 55)):
        rows = [r.translate(FAR_T) if s == 'f' else r for r in SIDE_BOOT]
        bc = {(x0 + i, S - 4 + j): c for j, r in enumerate(rows) for i, c in enumerate(r) if c != '.'}
        boots[s] = lay('boot_' + s, bc, vol(bc, 'cyl', ((x0 + 3.5, 3.5),), bulge=.5, gy=58., rough=.85), rim='boot_side')
        bl[s.upper()] = 'boot_' + s
    tail = lay('scarf_tail', 'O', capsule((14., 41.), (4., 38.), 1.4, 58., 58., 2.), rim='tail_side')
    scarf = blob_layer('scarf', 26., 38., 6., 2.2, lambda p: 'O', 'scarf_side', bulge=3.)
    return ([boots['f'], ball, boots['n'], tail, scarf, crown],
            dict(planted={'N': False, 'F': False}, o={}, screen_o={}, boots=bl, head=[31, 45], hands=[], tucked=True))

SATK = {'attack0': dict(hd=(-1, 0), up=(-1, 0), tl=(-1, 0), foot={'N': (0, 0), 'F': (-3, 0)}, hand={'N': (18, 40), 'F': (21, 47)}),
        'attack1': dict(hd=(2, 1), up=(1, 0), tl=(0, 0), foot={'N': (3, 0), 'F': (-3, 0)}, hand={'N': (29, 45), 'F': (21, 47)}),
        'attack2': dict(hd=(1, 1), up=(1, 0), tl=(0, 0), foot={'N': (2, 0), 'F': (-2, 0)}, hand={'N': (27, 48), 'F': (21, 47)})}

def pose_side(short):
    if short == 'idle0': return side_frame()
    if short == 'idle1': return side_frame(hd=(0, 1), up=(0, 1))
    if short.startswith('walk'):
        f = int(short[-1])
        foot = {'N': GAIT['L'][f], 'F': GAIT['R'][f]}
        b = BOB[f]
        hand = {'N': (23 + ARM(foot['N'][0]), 47 + b), 'F': (22 + ARM(foot['F'][0]), 47 + b)}
        return side_frame(hd=(0, b), up=(0, b), tl=(0, LAG[f]), hip=b, foot=foot, hand=hand)
    if short.startswith('attack'):
        spec = SATK[short]
        seq, info = side_frame(**spec)
        h = spec['hand']['N']
        info['grip'] = [h[0] + 1, h[1] + 1]
        return seq, info
    if short == 'roll0':
        return side_frame(hd=(3, 7), up=(1, 6), tl=(0, 6), hip=3, foot={'N': (3, 0), 'F': (1, 0)}, hand={'N': (27, 50), 'F': (22, 51)}, boots_front=True)
    if short == 'roll1': return roll_side()
    return side_frame(hd=(2, 4), up=(1, 3), tl=(0, 3), hip=1, foot={'N': (3, 0), 'F': (1, 2)}, hand={'N': (28, 50), 'F': (23, 50)})

# ---- メタデータと検査 ----
def contract():
    a = json.loads(CANON.read_text(encoding='utf-8'))
    names = list(a['frames'])
    tag = {}
    for t in a['meta']['frameTags']:
        for i in range(t['from'], t['to'] + 1): tag[names[i]] = t['name'].rsplit('-', 1)[0]
    exp = [f'hero_{d}_{s}' for d in ('down', 'up', 'right', 'left') for s in SHORT]
    assert names == exp and set(tag) == set(names), '正本の48コマ名・順序が想定と違う'
    return names, {n: a['frames'][n]['duration'] for n in names}, tag

def feet_meta(f):
    out = {}
    for fid, bn in f['info']['boots'].items():
        l = f['by'][bn]
        sy = max(y for _, y in l['cells'])
        xs = [x for x, y in l['cells'] if y == sy]
        sx = (min(xs) + max(xs) + 1) / 2
        hm = sum(l['field'][(x, sy)][1] for x in xs) / len(xs)
        so = f['info']['screen_o'].get(fid, 0)
        out[fid] = dict(sole=[sx, sy + 1], local=[sx - PV[0], sy + 1 - PV[1]], ground=[sx, PV[1] + so], planted=f['info']['planted'][fid],
                        height=round(hm, 2), height_level=hq(hm, .85)[0], forward_offset=f['info']['o'].get(fid))
    return out

def components(cells):
    cells, n = set(cells), 0
    while cells:
        n += 1
        st = [cells.pop()]
        while st:
            x, y = st.pop()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q in cells: cells.remove(q); st.append(q)
    return n

def min_dist(a, b):
    return min((max(abs(p[0] - q[0]), abs(p[1] - q[1])) for p in a for q in b), default=None)

def analyze(name, f, view):
    pix, info = f['pix'], f['info']
    xs, ys = [p[0] for p in pix], [p[1] for p in pix]
    bb = [min(xs), min(ys), max(xs), max(ys)]
    feet = feet_meta(f)
    c = dict(bbox=bb, opaque_px=len(pix), components8=components(pix))
    check(bb[0] >= 1 and bb[2] <= 46 and bb[1] >= 2 and bb[3] <= FH - 2, f'{name}: 範囲外 {bb}')
    check(c['components8'] == 1, f'{name}: 輪郭が{c["components8"]}個に分離(付着が切れている)')
    if view == 'up': check(not {'face', 'eyes', 'nose'} & set(f['names']), f'{name}: 背面に顔の部品')
    if view == 'right':
        check(sum(1 for v in pix.values() if v[3] == 'eyes') == 6 or info.get('tucked'), f'{name}: 側面の目が1つ(6画素)でない')
    grip = info.get('grip')
    if grip: c['grip_on_hand'] = check(tuple(grip) in pix and pix[tuple(grip)][3] in info['hands'], f'{name}: 握り位置が手の画素でない')
    for fid, m in feet.items():
        if info.get('tucked'): continue
        if m['planted']:
            check(m['height_level'] == 0 and abs(m['ground'][1] - m['sole'][1]) < 1e-6, f'{name}: 接地足{fid}の靴底が高さ0/接地点でない {m}')
        else:
            check(m['height_level'] >= 2, f'{name}: 持ち上げ足{fid}の高さが2未満 {m}')
    hand = {p for p, v in pix.items() if v[3].startswith('hand')}
    pouch = {p for p, v in pix.items() if v[3] == 'pouch'}
    boots = {p for p, v in pix.items() if v[3].startswith('boot')}
    c['hand_pouch_min_dist'], c['boot_pouch_min_dist'] = min_dist(hand, pouch), min_dist(boots, pouch)
    if view == 'right' and not info.get('tucked') and 'roll' not in name:
        for k in ('hand_pouch_min_dist', 'boot_pouch_min_dist'):
            check(c[k] is None or c[k] >= 2, f'{name}: 側面で{k}={c[k]}(ポーチと手/足が接している)')
    return c, feet

def make_meta(name, dur, tag, f, view, c, feet):
    info = f['info']
    m = dict(name=name, duration=dur, tag=tag, pivot=list(PV), foot=list(PV), head=info['head'], grip=info.get('grip'), feet=feet,
             lantern={'visible': False}, checks=c, bbox=c['bbox'], opaque_px=c['opaque_px'], view=view,
             foot_ids='L/R=画面左右(down/up)、N/F=近い側/遠い側(right/left)', sole_note='sole=[靴底中央x, 靴底下端y](端座標)、ground=接地点')
    if tag == 'walk': m.update(walk_distance_per_frame=STEP, gait_phase=int(name[-1]))
    return m

def mirror_frame(f):
    pix = {(47 - x, y): (c, MIRROR_IDX[n], hl, ln, h) for (x, y), (c, n, hl, ln, h) in f['pix'].items()}
    return dict(f, pix=pix, mirrored=True)

def mirror_meta(m, name, dur, tag):
    fl = lambda p: [48 - p[0], p[1]]
    bb = m['bbox']
    r = dict(m, name=name, duration=dur, tag=tag, view='left', head=[47 - m['head'][0], m['head'][1]],
             grip=[47 - m['grip'][0], m['grip'][1]] if m['grip'] else None,
             bbox=[47 - bb[2], bb[1], 47 - bb[0], bb[3]],
             feet={k: dict(v, sole=fl(v['sole']), ground=fl(v['ground']), local=[48 - v['sole'][0] - PV[0], v['local'][1]]) for k, v in m['feet'].items()})
    r.update(local_x_flip=True, mirror_of=m['name'], flip_pivot=list(PV))
    return r

def check_gait(view, infos):
    """接地足は連続コマで o が -STEP ずつ(地面に静止)、持ち上げ足は前後の差 2*STEP、常に片足以上が接地"""
    for fid in infos[0]['o']:
        o = [infos[f]['o'][fid] for f in range(4)]
        pl = [infos[f]['planted'][fid] for f in range(4)]
        check(sum(pl) == 3, f'{view}/{fid}: 接地が3コマでない {pl}')
        for k in range(4):
            if pl[k] and pl[(k + 1) % 4]: check(o[(k + 1) % 4] - o[k] == -STEP, f'{view}/{fid}: 接地足が地面に静止していない {o}')
            if not pl[k]: check(o[(k + 1) % 4] - o[(k - 1) % 4] == 2 * STEP and o[k] == 0, f'{view}/{fid}: 持ち上げ足の振り出し量が不正 {o}')
    for k in range(4): check(any(infos[k]['planted'].values()), f'{view}: コマ{k}で両足が浮く')

# ---- Workbench プロジェクト(1コマ=1部品。書き込みは全て Editor.apply/save/export) ----
def project(frames, palette, grid):
    cmds = [f'canvas {W} {FH}', f'pivot {PV[0]} {PV[1]}'] + [f'palette {k} {v}' for k, v in palette.items()]
    placed_ = []
    for name, dur, tag, f in frames:
        g = grid(f['pix'])
        xs, ys = [p[0] for p in g], [p[1] for p in g]
        x0, y0, w, h = min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        cmds += [f'part {name}_1 {w} {h}', 'rows ' + '|'.join(''.join(g.get((x0 + i, y0 + j), '.') for i in range(w)) for j in range(h))]
        placed_.append((name, dur, tag, x0, y0))
    for name, dur, tag, x0, y0 in placed_:
        cmds += [f'frame {name} {dur}', f'tag {tag}', f'place {name} {name}_1 {x0} {y0}']
    return Editor().apply('\n'.join(cmds) + '\n')

def alpha_of(proj, i):
    im = render(proj, proj['frames'][i])[0]
    return {(j % W, j // W) for j, v in enumerate(im.getchannel('A').getdata()) if v}

def native_front_images():
    """HS.main と同じ手順で作った静止案C(正解)"""
    y0, rows, cuts, opts = HS.HEADS['C']
    P = HS.head(y0, rows, cuts, **opts); HS.legs_boots(P)
    order = HS.build_C(P)
    P = HS.rim(P)
    geo = {n: HS.surface(n, P[n]) for n in order}
    hqn = lambda n, g: (min(62, round(g[1] / 2) * 2), HS.ROUGH.get(n, .8))
    levels = sorted({hqn(n, g) for n in order for g in geo[n].values()})
    hsym = {lv: SYMBOLS[i] for i, lv in enumerate(levels)}
    hpal = {SYMBOLS[i]: '#%02x%02x80' % (round(lv[0] / 64 * 255), round(lv[1] * 255)) for i, lv in enumerate(levels)}
    prj = (HS.build(P, order, HS.PAL),
           HS.build({n: {p: SYMBOLS[near(g[0])] for p, g in geo[n].items()} for n in order}, order, HS.NPAL),
           HS.build({n: {p: hsym[hqn(n, g)] for p, g in geo[n].items()} for n in order}, order, hpal))
    return [render(v, v['frames'][0])[0] for v in prj]

def add_frame_meta(path, meta, names):
    d = json.loads(path.read_text(encoding='utf-8'))
    c = json.loads(CANON.read_text(encoding='utf-8'))
    check(list(d['frames']) == names, f'{path}: フレーム名・順序が正本と違う')
    for n in names:
        if n in d['frames']:
            cf, nf = c['frames'][n]['frame'], d['frames'][n]['frame']
            want = dict(cf, y=cf['y'] // cf['h'] * FH, h=FH)
            check(nf == want and d['frames'][n]['duration'] == c['frames'][n]['duration'], f'{path}: {n} の矩形/時間が違う {nf} != {want}')
    check(d['meta']['frameTags'] == c['meta']['frameTags'], f'{path}: frameTags が正本と違う')
    cs, ds = c['meta']['size'], d['meta']['size']
    old_height = next(iter(c['frames'].values()))['frame']['h']
    check(d['meta']['pivot'] == c['meta']['pivot'] and ds['w'] == cs['w'] and ds['h'] == cs['h'] // old_height * FH, f'{path}: pivot/size が違う {ds} vs {cs}')
    d['meta']['frameMeta'] = meta
    # 歩行の説明は poses.json、実行に必要な歩幅は各 frameMeta に保存する。
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(OUT))
    ap.add_argument('--columns', type=int, default=8)
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    names, dur, tag = contract()
    G, meta, infos = {}, {}, {}
    for view in ('down', 'up', 'right'):
        for sh in SHORT:
            seq, info = pose_side(sh) if view == 'right' else pose_std(view, sh)
            f = finish(seq, info)
            n = f'hero_{view}_{sh}'
            c, feet = analyze(n, f, view)
            G[n], meta[n], infos[(view, sh)] = f, make_meta(n, dur[n], tag[n], f, view, c, feet), info
        check_gait(view, [infos[(view, f'walk{k}')] for k in range(4)])
        grips = [meta[f'hero_{view}_attack{k}']['grip'] for k in range(3)]
        check(all(grips) and len({tuple(g) for g in grips}) == 3, f'{view}: 攻撃の握り位置が3コマで異ならない {grips}')
    for sh in SHORT:
        n, r = f'hero_left_{sh}', f'hero_right_{sh}'
        G[n], meta[n] = mirror_frame(G[r]), mirror_meta(meta[r], n, dur[n], tag[n])
    frames = [(n, dur[n], tag[n], G[n]) for n in names]
    levels = sorted({v[2] for _, _, _, f in frames for v in f['pix'].values()})
    check(len(levels) <= 64, f'高さの色が{len(levels)}色(>64)')
    hsym = {lv: SYMBOLS[i] for i, lv in enumerate(levels[:64])}
    hpal = {SYMBOLS[i]: '#%02x%02x80' % (round(lv[0] / 64 * 255), round(lv[1] * 255)) for i, lv in enumerate(levels[:64])}
    projs = {'albedo': project(frames, HS.PAL, lambda px: {p: v[0] for p, v in px.items()}),
             'normal': project(frames, HS.NPAL, lambda px: {p: SYMBOLS[v[1]] for p, v in px.items()}),
             'height': project(frames, hpal, lambda px: {p: hsym[v[2]] for p, v in px.items()})}
    colors = {k: len([c for c in p['palette'] if c != '.']) for k, p in projs.items()}
    for k, n in colors.items(): check(n <= 64, f'{k} のパレットが{n}色')
    bad = []
    for i, (n, _, _, f) in enumerate(frames):
        for k, p in projs.items():
            if alpha_of(p, i) != set(f['pix']): bad.append(f'{n}:{k}')
    check(not bad, f'alpha不一致 {bad[:6]}')
    ref = native_front_images()
    same = {}
    for k, im in zip(('albedo', 'normal', 'height'), ref):      # 上 OLD_FH 行は静止案Cと画素一致、追加した下の行は完全に透明
        ours = render(projs[k], projs[k]['frames'][0])[0]
        same[k] = (ours.size == (W, FH) and list(ours.crop((0, 0, W, OLD_FH)).getdata()) == list(im.getdata())
                   and ours.crop((0, OLD_FH, W, FH)).getchannel('A').getbbox() is None)
    check(all(same.values()), f'down_idle0 が静止案Cの上{OLD_FH}行と一致しない/追加行が透明でない {same}')
    mirror_bad = 0
    for sh in SHORT:
        i, j = names.index(f'hero_right_{sh}'), names.index(f'hero_left_{sh}')
        R, L = [list(render(projs['normal'], projs['normal']['frames'][k])[0].getdata()) for k in (i, j)]
        for y in range(FH):
            for x in range(W):
                p, q = R[y * W + x], L[y * W + 47 - x]
                if p[3] != q[3] or (p[3] and not (255 <= p[0] + q[0] <= 257 and p[1] == q[1] and p[2] == q[2])): mirror_bad += 1
    check(mirror_bad == 0, f'左右の法線が鏡像でない画素 {mirror_bad}')
    for k, p in projs.items():
        save(p, out / f'{k}.json')
        rep = export(p, out / k, columns=a.columns)
        add_frame_meta(out / k / 'atlas.json', meta, names)
        FAIL.extend(f'{k} export: {w}' for w in rep.get('warnings', []))
    (out / 'poses.json').write_text(json.dumps(dict(
        size=[W, FH], pivot=list(PV), frame_count=len(frames), walk=WALK, palette_colors=colors,
        albedo_sha=digest(projs['albedo']), idle0_matches_static_c=same, left_mirror_bad_px=mirror_bad, check_failures=FAIL,
        status='コードで生成。実行結果と contact.png を Codex が確認するまで採用不可。靴の高さは全コマで靴底=0(静止案Cも HS.surface で靴底基準に修正済み)',
        canvas_extension=dict(old=[W, OLD_FH], new=[W, FH], note='下に透明8行を追加。pivot・幅は不変。--resize 昇格が必要'),
        frames=meta), ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(dict(frames=len(frames), colors=colors, idle0_same=same, mirror_bad=mirror_bad, failures=FAIL[:12], n_failures=len(FAIL), out=str(out)), ensure_ascii=False))
    if FAIL: sys.exit(1)

if __name__ == '__main__':
    main()
