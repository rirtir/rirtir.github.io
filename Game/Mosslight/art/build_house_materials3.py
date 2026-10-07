"""屋根/正面壁/床の中立アルベド + 幾何由来の法線・高さ（レビュー前の試作）。本番には触れない。

  python art/build_house_materials3.py

書くもの: .review/v3/house-materials/<sheet>/{albedo,normal,height}.json と各Workbench書き出し(atlas/contact)。
形・窓・筋交い・剥落・瓦・苔・木目は build_style_houses の draw_* を再利用し、固定光源の段(T4/T2, L3/L1の膨らみと落ち影,
窓A5/A4, 木のW4/W3/W2塗分)を同一顔料へ寄せる。色むらはタイル周期32の低頻度ノイズと部材単位の顔料差(継ぎ目なし)。
法線: n=(-dh/dx, dh/dy_img, 1)を正規化しVECTORS最近傍。Nyは上、画面下を向く面は負。h式の勾配のみで輝度は使わない。
  屋根: 傾斜面(-.5*y) + COLUMNS(32周期)の丸瓦断面 + 8周期の段継ぎ。壁: h=60-y(pivotY-y, 64px以内)の前向き平面
  + 柱x0,1/30,31の半円柱 + 梁y8..11の丸い張出し + 窓台 + 石基礎y52..59の2段の矩形石(縁取り斜面)。床: 板継ぎ縁の小さい斜面。
高さ: R=真高さ(64px decode, 2px刻み), G=粗さ(木/土.8, ガラス.3), B=128。ランプ番号は高さに使わない。
"""
import json
import math
import re
import style  # noqa: F401  Workbenchのパスを通す
from style import GAME, SYMBOLS, SYMBOL_OF, COLORS, GROUP_OF, HEX_OF, RAMPS, part, frame, check
from engine import Editor
from pixelwork import export, save
from build_normal_maps import VECTORS, NORMAL_COLORS
from build_tree3_demo import HEIGHT_COLORS
import build_style_houses as bs

OUT = GAME / '.review/v3/house-materials'
GLASS = ['#%s%02x80' % (h[1:3], round(.3 * 255)) for h in HEIGHT_COLORS]   # ガラスは粗さ.3
PLASTER = {'#c9b48a': '#9b8668', '#e2d0a4': '#c8b38e', '#f1e6c4': '#d0bb97'}
PALETTES = {'albedo': [(SYMBOL_OF[c], PLASTER.get(c, c)) for c in COLORS], 'normal': list(zip(SYMBOLS, NORMAL_COLORS)),
            'height': list(zip(SYMBOLS, HEIGHT_COLORS + GLASS))}


def sym(name): return bs.c(name)


def nm(s):
    g = GROUP_OF.get(s)
    return (g, RAMPS[g].index(HEX_OF[s]) + 1) if g else (None, 0)


def pn(x, y, per, seed):
    n = ((x % per) * 374761393 + y * 668265263 + seed * 1442695041) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffff) / 65535


def cell(x, y, sx, sy, seed): return pn(x // sx, y // sy, 32 // sx, seed)   # x周期32: タイルを並べても継ぎ目が出ない


def sq(v): return math.sqrt(max(0., v))


def nidx(h, x, y, e=.4):
    gx, gy = (h(x + e, y) - h(x - e, y)) / (2 * e), (h(x, y + e) - h(x, y - e)) / (2 * e)
    n = (-gx, gy, 1.)
    s = math.sqrt(sum(v * v for v in n))
    n = tuple(v / s for v in n)
    return min(range(len(VECTORS)), key=lambda i: sum((a - b) ** 2 for a, b in zip(VECTORS[i], n)))


def neutral(kind, x, y, s, stone):
    """元の記号を、光方向を含まない顔料へ。暗い接触溝(T1/W1/R1/K)は残す。"""
    g, i = nm(s)
    if g == 'T' and i > 1:   # 瓦: T4/T2を捨て、丸瓦(列×段)ごとの顔料差と疎な斑
        ci = next(k for k, (a, w) in enumerate(bs.COLUMNS) if a <= x < a + w)
        r = pn(ci, y // 8, 4, 11)
        return sym('T2' if cell(x, y, 1, 1, 12) < .06 or r < .2 else 'T4' if r > .85 else 'T3')
    if g == 'G' and i == 5: return sym('G4')   # 苔の左上ハイライト
    if g == 'W' and i > 1:   # 板/梁/柱: 部材ごとにW2かW3の1色
        r = cell(x, y, 4, 64, 13) if kind != 'roof' and 12 <= y < 52 else cell(x, y, 8, 1, 14)
        return sym('W3' if r > .75 else 'W2')
    if g == 'L' and not (i == 1 and (y == 12 or 47 <= y < 52)):   # 膨らみ/落ち影を均す。梁下の溝と跳ね返りの汚れは残す
        return sym('L3' if cell(x, y, 8, 4, 15) > .82 else 'L2')
    if g == 'A': return sym('A2' if cell(x, y, 2, 2, 16) < .15 else 'A3')
    if g == 'R' and i > 1: return sym(stone.get((x, y), 'R2'))
    return s


def stones(o):
    """石基礎の矩形石(a,b,y0,y1,顔料)。R1の縦目地で区切る。下の段の最下行は目地。"""
    out = []
    for y0, last in ((52, False), (56, True)):
        a = 0
        for x in range(33):
            if x == 32 or nm(o[y0][x]) == ('R', 1):
                if x > a: out.append((a, x, y0, y0 + (3 if last else 4), 'R3' if pn(a, y0, 32, 17) < .5 else 'R2'))
                a = x + 1
    return out


def roof_h(x, y, ey, plane=0.):
    xm = x % 32
    a, w = next((a, w) for a, w in bs.COLUMNS if a <= xm < a + w)
    t, v = 2 * (xm - a) / w - 1, y % 8
    h = (34, 26, 18)[ey] + 3 * sq(1 - t * t) * (1 - .5 * max(0, (v - 5) / 3) ** 2) + 1.5 * v / 7   # 丸瓦断面・下端の丸み・段継ぎ
    if ey == 0 and y < 3: h = 34 + 4 * sq(1 - ((y - 1.5) / 1.8) ** 2)   # 棟木の丸い断面
    return h - plane * y


def wall_h(x, y, kind, sts):
    h = 60. - y
    if 12 <= y < 52: h += 3 * sq(1 - (min(x, 32 - x) / 2) ** 2)   # 柱: 軸がタイル端の半円柱(隣と合わせて4px)
    if 8 <= y < 12: h += 3 * sq(1 - ((y - 10) / 2) ** 2)   # 梁の丸い張出し
    if kind == 'window' and 8 <= x < 24 and 36 <= y < 38: h += 2 * sq(1 - (y - 37) ** 2)   # 窓台
    for a, b, y0, y1, _ in sts:   # 矩形石: 縁から1pxの斜面で立ち上がる
        d = min(x - a, b - x, y - y0, y1 - y)
        if d > 0: h += 2 * min(1, d)
    return h


def relief(s):   # 高さだけに足す部材差(家族のみ)。木+1, ガラス-1.5(窓枠の奥), 金具+1.5
    return {'W': 1., 'A': -1.5, 'I': 1.5}.get(nm(s)[0], 0.)


def floor_h(x, y, xs):
    p, v, u = int(y // 8) % 4, y % 8, (x - xs[int(y // 8) % 4] - 1) % 32
    return 0. if not (1 <= v < 8 and u < 31) else 3 * min(1, min(v - 1, 8 - v, u, 31 - u) / 1.5)


def frame_maps(sheet, name, size, idx):
    """1フレームの(albedo, normal, height)の行リストと元の不透明マスク。"""
    stone, rel = {}, relief
    if sheet.startswith('roofs'):
        m = re.fullmatch(r'roof(?:_full)?(\d)(?:_v(\d))?', name)
        t, v = int(m[1]), int(m[2] or 0)
        kind, ey = 'roof', t // 3
        o = bs.draw_roof(size[1], t % 3, t // 3, v).px
        field, hfun, rel = (lambda x, y: roof_h(x, y, ey, .5)), (lambda x, y: roof_h(x, y, ey)), (lambda s: 0.)
    elif sheet == 'facades':
        m = re.fullmatch(r'facade_(wall|window|door)(?:_v(\d))?', name)
        kind = m[1]
        o = bs.draw_facade(kind, int(m[2] or 0)).px
        sts = stones(o)
        for a, b, y0, y1, pig in sts:
            stone.update({(x, y): pig for x in range(a, b) for y in range(y0, y1)})
        field = hfun = lambda x, y: wall_h(x, y, kind, sts)
    else:
        kind = 'floor'
        o = bs.draw_floor(bs.FLOOR_NAMES.index(name)).px
        xs = [next(x for x in range(32) if all(o[p * 8 + v][x] == sym('W1') for v in range(1, 8))) for p in range(4)]
        pig = ['W3' if pn(p, 0, 4, 21 + idx) > .5 else 'W2' for p in range(4)]
        field = hfun = lambda x, y: floor_h(x, y, xs)
    alb, nrm, hgt = [], [], []
    for y, row in enumerate(o):
        a, n, h = [], [], []
        for x, s in enumerate(row):
            if s == '.':
                a.append('.'); n.append('.'); h.append('.')
                continue
            g, i = nm(s)
            if kind == 'floor':   # 板ごとの顔料。板の中ほどの細い木目(v>=4)だけ逆側の色で残す
                p = y // 8
                a.append(s if g != 'W' or i == 1 else sym(('W2' if pig[p] == 'W3' else 'W3') if i >= 3 and y % 8 >= 4 else pig[p]))
            else:
                a.append(neutral(kind, x, y, s, stone))
            n.append(SYMBOLS[nidx(field, x + .5, y + .5)])
            hv = hfun(x + .5, y + .5) + rel(s)
            h.append(SYMBOLS[min(31, max(0, int(hv / 2 + .5))) + (32 if g == 'A' else 0)])
        alb.append(''.join(a)); nrm.append(''.join(n)); hgt.append(''.join(h))
    return (alb, nrm, hgt), [[ch != '.' for ch in r] for r in o]


def spec(sheet):
    """manifest・現行source・配布atlasから条件を読み、食い違えば中止する。"""
    man = json.loads((GAME / 'assets/manifest.json').read_text(encoding='utf-8'))['sheets'][sheet]
    src = json.loads((GAME / f'art/{sheet}.json').read_text(encoding='utf-8'))
    atlas = json.loads((GAME / f'assets/{sheet}/atlas.json').read_text(encoding='utf-8'))
    names, meta = man['names'], atlas['meta']
    tags = [None] * len(names)
    for t in meta['frameTags']:
        tags[t['from']:t['to'] + 1] = [t['name']] * (t['to'] - t['from'] + 1)
    ok = ([f['name'] for f in src['frames']] == names == list(atlas['frames'])
          and src['pivot'] == man['pivot'] == meta['pivot']
          and [f['duration'] for f in src['frames']] == [atlas['frames'][n]['duration'] for n in names]
          and [f.get('tag') for f in src['frames']] == tags
          and all(src['size'] == [fr['sourceSize']['w'], fr['sourceSize']['h']] for fr in atlas['frames'].values()))
    if not ok: raise SystemExit(f'{sheet}: names/size/pivot/duration/tag が manifest・source・atlas で一致しません')
    return src, atlas, len({fr['frame']['x'] for fr in atlas['frames'].values()})


def project(src, kind, parts):
    lines = [f'canvas {src["size"][0]} {src["size"][1]}', f'pivot {src["pivot"][0]} {src["pivot"][1]}']
    lines += [f'palette {s} {c}' for s, c in PALETTES[kind]]
    for f in src['frames']: part(lines, f['name'], parts[f['name']])
    for f in src['frames']: frame(lines, f['name'], [(f['name'], 0, 0)], duration=f['duration'], tag=f.get('tag'))
    p = Editor().apply('\n'.join(lines))
    check(p)
    return p


def main():
    assert all(abs(roof_h(x + dx, y + dy, 1) - roof_h(x, y, 1)) < 1e-9   # 同じh式が32/8周期で辺を越えて続く
               for x in (.1, 15.5, 31.9) for y in (3.2, 9.7) for dx, dy in ((32, 0), (0, 8)))
    for sheet in ('roofs', 'roofs_full', 'facades', 'floor'):
        src, atlas, cols = spec(sheet)
        parts = {k: {} for k in PALETTES}
        for idx, f in enumerate(src['frames']):
            maps, mask = frame_maps(sheet, f['name'], src['size'], idx)
            if mask != [[ch != '.' for ch in r] for r in src['parts'][f['name']]['rows']]:
                raise SystemExit(f'{sheet}/{f["name"]}: 現行sourceと不透明形が違います')
            for k, rows in zip(PALETTES, maps): parts[k][f['name']] = rows
        for k in PALETTES:
            proj = project(src, k, parts[k])
            d = OUT / sheet / k
            d.mkdir(parents=True, exist_ok=True)
            save(proj, OUT / sheet / f'{k}.json')
            report = export(proj, d, columns=cols)
            if json.loads((d / 'atlas.json').read_text(encoding='utf-8')) != atlas:
                raise SystemExit(f'{sheet}/{k}: atlas.metadata が配布atlasと違います')
            print(sheet, k, report['frames'], 'frames, warnings:', report['warnings'])


if __name__ == '__main__':
    main()
