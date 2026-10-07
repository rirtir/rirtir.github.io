"""hero-static3 の法線/高さを、宣言済み部品の解析的な形(楕円体・円柱・布のひだ)から作り、光の箱で確認する。
画像のRGB輝度・alpha距離は形に使わない。形は「その画素を持つ最前面の部品」と部品ごとのプリミティブだけで決まる。
出力: art/hero-static3-{normal,height}.json, .review/v3/hero-static3/{normal,height}.png, .review/v3/hero-lightbox3/
"""
from pathlib import Path
import json, math, random, shutil, tempfile
from collections import Counter
from style import GAME, SYMBOLS
from engine import Editor, load, render
from pixelwork import export, save
from build_normal_maps import VECTORS, NORMAL_COLORS  # 現行の61方向 + 平坦/発光

K = .75          # 斜投影: 画面上 = Z + K*Y。壁(0,-1,0)の傾きが現行最大の .8 になる
Y0 = 1.5         # 体の軸の奥行き
TAU = 1.1        # 部品内のなめらかな和(関節・ひだを折れ目にしない)
ROUGH = {'cloth': .8, 'skin': .85, 'metal': .45}
SKIN_PARTS = ('head_face',)   # 手は手袋(布)
OUTLINE = 'outline'           # 合成マスクの外周1px。形は隣接する最前面の部品から借りる
LAMP = (32, 51)               # 右手から下げたランタンの中心

# ---- 再利用できる形の関数: 部品の矩形(layout)に合わせた楕円体/超楕円柱 ----
def ell(rect, pivot, fx, fy, fw, fh, depth=.62, n=2, rot=0.):
    """矩形内の中心(fx,fy)・幅fw・長さfh(割合)。n>2で円柱状、rotは画面内(XZ)の傾き。奥行き半径 = depth*a。"""
    x0, y0, w, h = rect
    a, H = fw * w / 2, fh * h / 2
    b = min(max(depth * a, .8), .9 * H / K)
    c = math.sqrt(max(H * H - K * K * b * b, .4))
    sy = pivot[1] - (y0 + fy * h)
    return dict(c=(x0 + fx * w, Y0, sy - K * Y0), r=(a, b, c), n=n, t=rot, H=H)

def shapes(name, rect, pv):
    side = name[-1:] if name[-2:-1] == '_' else ''
    base = name[:-2] if side else name
    def E(fx, fy, fw, fh, depth=.62, n=2, rot=0.):
        if base in ('boot', 'arm') and side == 'R': fx, rot = 1 - fx, -rot   # boot_R / arm_R は左の図の左右反転
        return ell(rect, pv, fx, fy, fw, fh, depth, n, rot)
    table = {
        # 後ろ髪: 頭頂のドーム + くせ毛(x25-27) + 左右2本ずつの房(外側 y26 / 内側 y28 まで)
        # v3b: 王冠は少し右寄り + つむじ(x24-26) + 長い左の房(y28) + 短い右の房(y24)と小さなカール(y25-27)
        'hair_back': [E(.5, .4, .86, .8, .8), E(.57, .04, .14, .14, .9),
                      E(.07, .69, .14, .55, .7), E(.93, .62, .14, .45, .7), E(.9, .84, .14, .22, .8)],
        # 顔: 正面の主面を上向き寄りにする(奥行き半径を大きく、Z方向を n=4 で平らに)。眉・目・口は面ではなく絵
        'head_face': [E(.5, .5, 1., 1., 1., 4)],
        # 前髪: 実際の行(y16-23)に合わせた5本の房。左右の房は y23 まで、中央は鼻筋の上
        # 前髪: 髪の塊 + 3本の房(左:長い y23 / 中:短い / 右:さらに短い y22)。分け目は x21
        'hair_front': [E(.5, .18, .92, .4, .6), E(.17, .62, .3, .85, .55, rot=-.3), E(.5, .5, .2, .65, .55), E(.8, .45, .3, .6, .55, rot=.3)],
        # 胴: 肩が最も広く(上向きの面が y34 の1画素)、胸は腰へ向かって細くなり、裾で少し広がる
        'torso_mantle': [E(.5, .58, .9, .9, .95, 4), E(.5, .14, 1., .26, 1.4, 4), E(.5, .9, .78, .22, .9)],
        # スカーフ: 首の帯 + 右寄りの結び目。小さな垂れ(tail)は1本だけ
        'scarf': [E(.5, .4, 1., .7, .9), E(.68, .8, .3, .45, 1.)],
        'scarf_tail': [E(.5, .25, .8, .5, .9), E(.5, .72, .6, .6, .9)],
        # 腕(左の図): 上腕 / 肘(外へ1px) / 前腕。肩から肘で折れる
        'arm': [E(.6, .2, .8, .4, .9, 4), E(.4, .55, .8, .35, .9, 4), E(.6, .85, .8, .35, .9, 4)],
        'hand': [E(.5, .5, 1., 1., .9)],
        'hips': [E(.5, .5, 1., 1., .9, 4)],
        'leg': [E(.5, .28, .95, .6, .9, 4), E(.5, .74, .8, .55, .9, 4)],
        # 靴(左足の図): 筒(y51-54)、甲=上向きの平面(奥行き大・n=4)、つま先の丸み、靴底
        # 8行(y50-57): 筒(y50-53)、甲=上向きの平面(y54-56)、つま先、靴底(y57)
        'boot': [E(.64, .25, .7, .5, .9, 4), E(.43, .7, .85, .5, 1.4, 4), E(.2, .74, .4, .45, 1.3), E(.45, .94, .9, .18, 1.)],
        'pouch': [E(.5, .55, 1., 1., .9, 4), E(.5, .2, 1., .4, 1.)],
        'lantern': [E(.5, .55, 1., .9, .9, 4), E(.5, .1, .8, .25, .9)],
    }
    return table[base]

def owner_at(project, fr, x, y, skip=None):
    """画素(x,y)を持つ最前面の層。返り値 (部品名, 記号, lx, ly, 層番号) か None。skip の部品は無視する。"""
    for i in range(len(fr['layers']) - 1, -1, -1):
        L = fr['layers'][i]
        if L['part'] == skip: continue
        part = project['parts'][L['part']]
        lx, ly = x - L['x'], y - L['y']
        if L.get('flip_x'): lx = part['size'][0] - 1 - lx
        if 0 <= lx < part['size'][0] and 0 <= ly < part['size'][1] and part['rows'][ly][lx] != '.':
            return L['part'], part['rows'][ly][lx], lx, ly, i
    return None

def hit(p, X, sy):
    """画素中心(X, sy)を通る視線(Zを下げながらY=(sy-Z)/K)と形の交点。返り値(Z, 画面法線)かNone。"""
    (cx, cy, cz), (a, b, c), n, t = p['c'], p['r'], p['n'], p['t']
    ct, st = math.cos(t), math.sin(t)
    def f(Z):
        dx, dy, dz = X - cx, (sy - Z) / K - cy, Z - cz
        x, z = dx * ct - dz * st, dx * st + dz * ct
        return (x / a) ** 2 + (dy / b) ** 2 + abs(z / c) ** n - 1, x, dy, z
    top, bot = cz + max(a, c) + 1, cz - max(a, c) - 1
    Z, prev = top, None
    while Z >= bot:
        if f(Z)[0] <= 0:
            lo, hi = Z, prev if prev is not None else Z + .25   # lo=内, hi=外
            for _ in range(14):
                mid = (lo + hi) / 2
                lo, hi = (mid, hi) if f(mid)[0] <= 0 else (lo, mid)
            Z = (lo + hi) / 2
            _, x, dy, z = f(Z)
            gx, gy = 2 * x / a ** 2, 2 * dy / b ** 2
            gz = n * abs(z / c) ** (n - 1) * (1 if z >= 0 else -1) / c
            nX, nY, nZ = gx * ct + gz * st, gy, -gx * st + gz * ct
            v = (nX, nY / K, K * nZ - nY)
            l = math.sqrt(sum(q * q for q in v)) or 1
            return Z, tuple(q / l for q in v)
        prev, Z = Z, Z - .25
    return None

def surface(prims, x, y, pv):
    """部品内のなめらかな和。重なるプリミティブの法線/高さを奥行きで重み付けし、折れ目を作らない。"""
    X, sy = x + .5, pv[1] - (y + .5)
    hs = [h for h in (hit(p, X, sy) for p in prims) if h]
    if hs:
        top = max(h[0] for h in hs)
        ws = [math.exp((h[0] - top) / TAU) for h in hs]
        s = sum(ws)
        n = [sum(w * h[1][i] for w, h in zip(ws, hs)) / s for i in range(3)]
        l = math.sqrt(sum(q * q for q in n)) or 1
        return sum(w * h[0] for w, h in zip(ws, hs)) / s, tuple(q / l for q in n)
    # 輪郭の取りこぼしは最寄りの形の外向き縁(傾き大)にする
    def d(p):
        Hs = math.sqrt(p['r'][2] ** 2 + K * K * p['r'][1] ** 2)
        return ((X - p['c'][0]) / p['r'][0]) ** 2 + ((sy - p['c'][2] - K * Y0) / Hs) ** 2, Hs
    p = min(prims, key=lambda q: d(q)[0])
    ux, uy = (X - p['c'][0]) / p['r'][0], (sy - p['c'][2] - K * Y0) / d(p)[1]
    l = math.hypot(ux, uy) or 1
    v = (ux / l * .8, uy / l * .8, .6)
    return max(0., p['c'][2]), v

def geometry(project):
    """{(frame, x, y): (法線, 高さ, 粗さ, 発光)}。色は部品の記号(材質)にだけ使い、RGB値は読まない。"""
    pv, out = project['pivot'], {}
    lay = json.loads((GAME / 'art/hero-static3-layout.json').read_text(encoding='utf-8'))
    layout, mats = lay['parts'], lay['materials']      # 材質は記号で持つ(色の値は読まない)
    cache = {}
    for fi, fr in enumerate(project['frames']):
        image, _ = render(project, fr)
        px = list(image.getdata())
        w = project['size'][0]
        for y in range(project['size'][1]):
            for x in range(w):
                if px[y * w + x][3] == 0:
                    continue
                owner = owner_at(project, fr, x, y)
                if owner is None: continue
                name, sym, lx, ly, _ = owner
                outline = name == OUTLINE
                if outline:   # 外形は、隣接する最前面の部品の形・材質を借りる(albedo/normal/height の alpha を一致させる)
                    near = [o for o in (owner_at(project, fr, x + dx, y + dy, OUTLINE) for dx, dy in ((0, 1), (0, -1), (-1, 0), (1, 0))) if o]
                    if not near: raise ValueError(('孤立した外形', x, y))
                    name, sym, lx, ly, _ = max(near, key=lambda o: o[4])
                rect = (*layout[name]['at'], *layout[name]['size'])
                if name not in cache: cache[name] = shapes(name, rect, pv)
                Z, N = surface(cache[name], x, y, pv)
                rough = ROUGH['metal'] if sym in mats['metal'] else ROUGH['skin'] if name in SKIN_PARTS else ROUGH['cloth']
                glass = not outline and name == 'lantern' and sym in mats['glass']    # ランタンのガラス2画素だけ発光
                out[(fi, x, y)] = (N, max(0., Z), rough, glass)
    return out

def quantize_height(vals):
    for step in (1, 1.5, 2, 2.5, 3, 4):
        q = {k: (round(v[1] / step) * step, v[2]) for k, v in vals.items()}
        if len(set(q.values())) <= 64: return q
    raise ValueError('高さ色が64色を超えます')

def build(project, geo, kind):
    """source の名前/duration/順序/寸法/pivot を保った Workbench project(1コマ=1部品、atlas columns=1)。"""
    w, h = project['size']; lines = [f'canvas {w} {h}', f'pivot {project["pivot"][0]} {project["pivot"][1]}']
    if kind == 'normal':
        palette = NORMAL_COLORS
        def code(v):
            N, glass = v[0], v[3]
            if glass: return len(NORMAL_COLORS) - 1
            return max(range(len(VECTORS)), key=lambda i: sum(a * b for a, b in zip(VECTORS[i], N)))
        cells = {k: code(v) for k, v in geo.items()}
    else:
        q = quantize_height(geo)
        palette = sorted(set(q.values()))
        palette_hex = ['#%02x%02x%02x' % (round(min(hh, 64) / 64 * 255), round(r * 255), 128) for hh, r in palette]  # B=128: gain 中立
        cells = {k: palette.index(v) for k, v in q.items()}; palette = palette_hex
    lines += [f'palette {SYMBOLS[i]} {c}' for i, c in enumerate(palette)]
    for fi, fr in enumerate(project['frames']):
        rows = [''.join(SYMBOLS[cells[(fi, x, y)]] if (fi, x, y) in cells else '.' for x in range(w)) for y in range(h)]
        lines += [f'part p{fi} {w} {h}', 'rows ' + '|'.join(rows)]
    for fi, fr in enumerate(project['frames']): lines += [f'frame {fr["name"]} {fr["duration"]}', f'place image p{fi} 0 0']
    return Editor().apply('\n'.join(lines))

# ---- 光の箱: lighting.js の式(Lambert + sky + 控えめBlinn-Phong + 局所光 + 発光)をCPUで計算する近似 ----
def norm(v): l = math.sqrt(sum(q * q for q in v)) or 1; return tuple(q / l for q in v)
def dot(a, b): return sum(p * q for p, q in zip(a, b))
def spec(N, L, rough):
    g = 1 - rough; g2 = g * g
    return min(max(0., dot(N, norm((L[0], L[1], L[2] + 1)))) ** (8 + 72 * g2) * g2 * g * .35, .3)

CONDS = [  # 名前, sky, sun(dir,color), moon(dir,color), 手元ランプ
    ('AM sun right', (.34, .38, .48), (norm((.75, .25, .61)), (1.05, .85, .6)), None, False),
    ('noon', (.4, .45, .55), (norm((0., .2, .98)), (1.05, 1., .92)), None, False),
    ('PM sun left', (.3, .3, .4), (norm((-.75, .25, .61)), (1.1, .68, .42)), None, False),
    ('night + hip lamp', (.05, .07, .13), None, (norm((-.35, .45, .82)), (.2, .27, .42)), True)]

def lit(albedo, N, hpx, rough, emis, cond, xy):
    _, sky, sun, moon, lamp = cond
    a = [(c / 255) ** 2.2 for c in albedo]; res = []; sp = 0.
    light = [sky[i] * (.7 + .3 * N[2]) for i in range(3)]
    for d in (sun, moon):
        if d:
            nl = max(0., dot(N, d[0]))
            light = [light[i] + d[1][i] * nl for i in range(3)]
            if nl > 0: sp += spec(N, d[0], rough) * (1 if d is sun else .5)
    if lamp:  # lighting.js の局所光: 距離^2減衰, 灯の高さ12px, 半径64px, LIGHT_GAIN=2.8
        dx, dy = LAMP[0] - xy[0], LAMP[1] - xy[1]; dist = math.hypot(dx, dy)
        if dist < 64:
            att = (1 - dist / 64) ** 2; L = norm((dx, -dy, 12 - hpx)); nd = max(0., dot(N, L)); k = 2.8 * att
            light = [light[i] + (1., .62, .3)[i] * k * nd for i in range(3)]
            sp += k * spec(N, L, rough) * .3
    for i in range(3):
        v = a[i] * light[i] + min(sp, .4) + a[i] * emis * 1.5
        res.append(round(min(1., max(0., v)) ** (1 / 2.2) * 255))
    return tuple(res)

def lightbox(project, geo, out):
    image, _ = render(project, project['frames'][0]); w, h = project['size']; px = list(image.getdata())
    bg, clay = (69, 92, 56), (158, 153, 143)
    W, H = w * len(CONDS), h * 2; cells = {}; groups = [Counter(), Counter(), Counter()]
    for row, clayrow in enumerate((False, True)):
        for ci, cond in enumerate(CONDS):
            for y in range(h):
                for x in range(w):
                    g = geo.get((0, x, y))
                    base = clay if clayrow else px[y * w + x][:3]
                    c = lit(base, g[0], g[1], g[2], 1. if g[3] else 0., cond, (x, y)) if g else lit(bg, (0, 0, 1), 0., .8, 0., cond, (x, y))
                    cells[(ci * w + x, row * h + y)] = c
                    groups[row if g else 2][c] += 1
    # 背景の頻度で人物の肌・髪の色が失われないよう、各表示へ色枠を割り当てる。
    top = list(dict.fromkeys(c for group, limit in zip(groups, (30, 18, 15))
                            for c, _ in group.most_common(limit)))
    near = lambda c: min(range(len(top)), key=lambda i: sum((a - b) ** 2 for a, b in zip(top[i], c)))
    memo = {c: near(c) for c in set(cells.values())}
    lines = [f'canvas {W} {H}', 'pivot 0 0'] + [f'palette {SYMBOLS[i]} #%02x%02x%02x' % c for i, c in enumerate(top)]
    lines += [f'part p {W} {H}', 'rows ' + '|'.join(''.join(SYMBOLS[memo[cells[(x, y)]]] for x in range(W)) for y in range(H))]
    lines += ['frame lightbox 100', 'place image p 0 0']
    return export(Editor().apply('\n'.join(lines)), out, columns=1)

def main():
    project = load(GAME / 'art/hero-static3.json'); geo = geometry(project)
    # 証明: 全パレット色をランダムな別色へ差し替えても(alphaは維持)形は1画素も変わらない
    rnd = random.Random(7); alt = json.loads(json.dumps(project))
    for s, c in alt['palette'].items():
        if c.startswith('#') and not c.endswith('00'): alt['palette'][s] = '#%06x' % rnd.randrange(1 << 24)
    independent = geometry(alt) == geo
    review = GAME / '.review/v3/hero-static3'; review.mkdir(parents=True, exist_ok=True)
    for kind in ('normal', 'height'):
        built = build(project, geo, kind); save(built, GAME / f'art/hero-static3-{kind}.json')
        with tempfile.TemporaryDirectory() as tmp:
            report = export(built, Path(tmp), columns=1)
            if report['warnings']: raise ValueError(report['warnings'])
            shutil.copyfile(Path(tmp) / 'atlas.png', review / f'{kind}.png')
    box = lightbox(project, geo, GAME / '.review/v3/hero-lightbox3')
    hs = [v[1] for v in geo.values()]
    print(json.dumps({'pixels': len(geo), 'albedo_independent': independent, 'height_min': round(min(hs), 2), 'height_max': round(max(hs), 2),
                      'emissive': sum(v[3] for v in geo.values()), 'lightbox_warnings': box['warnings']}, ensure_ascii=False))

if __name__ == '__main__': main()
