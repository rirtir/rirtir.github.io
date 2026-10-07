"""開始キャンプの小道具 5枚（small: chest, barrel, sign, campfire / furniture: workbench）の作り直し v4。
正本の art/*.json・assets・manifest・ランタイムは変えず、.review/v4/camp-props/{small,furniture}/ だけを書く。

  python art/build_camp_props4.py

2枚のシートの他のコマは、アルベド・法線・高さとも既存と1画素も違わない（実行時に render で全画素比較して止める）。
枠名・順・時間・タグ・大きさ・pivot・atlas 配置も production（assets/*/atlas.json）と同じ（違えば止まる）。Pillow は描画・縮小・輝度計算に使わない。
形: 整数画素の名前付き部品を奥から手前へ重ねる。アルベドは素材ごとの固有色（既存パレットの色そのまま）と局所の接触の輪郭だけ。
    左上が明るい等の方向のある光・影は描かない。法線と高さは部品の形（円柱・平らな天板・南向きの垂直面・小さな丸石）から作る。
法線: 幾何の法線で +y が画面の上（南向きの面は y が負）。天板と蓋は平ら(0,0,1)、前面は南へ傾く。焚き火の炎・熾火だけ発光（B=255）、石・薪は発光しない。
高さ: 逆投影は groundY = screenY + height（係数1）。足元の行（small は y=52、workbench は y=80）が地面で、直立面は h = 地面の行 - y。
    炎・熾火も同じ物理軸（足元 y=52 から）: 炎の先端 y=28 は h=24（ランタイム発光点 ay-24 と一致）、熾火は h=4..6。
    B=128（中立ゲイン）、粗さ 木0.85 / 鉄0.55 / 石0.9。
パレット: 64色以下。未使用色は含めず、変えないコマの色はそのまま残す。高さの色が足りなければ、新規コマの高さだけを粗い段に丸める。
"""
import json
import math
import sys
from collections import namedtuple
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GAME.parents[1] / 'Image/PixelWorkbench'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import Editor, SYMBOLS, load, render  # noqa: E402
from pixelwork import export, save  # noqa: E402
from build_normal_maps import VECTORS, NORMAL_COLORS  # noqa: E402

OUT = GAME / '.review/v4/camp-props'
SHEETS = {'small': ('chest', 'barrel', 'sign', 'campfire'), 'furniture': ('workbench',)}
KINDS = ('albedo', 'normal', 'height')
OLD_ART = {'albedo': 'art/{s}.json', 'normal': 'art/normalmaps/{s}-normal.json', 'height': 'art/normalmaps/{s}-height.json'}
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))
ROUGH = {'wood': .85, 'iron': .55, 'stone': .9}
FLAT = (0., 0., 1.)
FRONT = (0., -.8, .6)   # 南向きの垂直面（+y が画面の上なので y は負）

# 既存の small/furniture パレットの色をそのまま使う（記号は出力時に付け直す）
COL = {'E': '#3B2A22', 'M': '#4A2F24', 'F': '#5A3F2C', 'N': '#6B4430', 'G': '#7A5636', 'O': '#8F5E3A', 'H': '#98703F', 'P': '#B07D4A',
       'Q': '#262A33', 'R': '#3C4250', 'S': '#59606B', 'T': '#7C8389',
       'z': '#D0602A', '@': '#F2A33A', '+': '#FFE08A', 'u': '#B4642E'}
Px = namedtuple('Px', 'c n h m e')   # 色, 法線(x, y, z), 高さ(整数 px), 素材, 発光


def px(c, n, h, m, e=False):
    return Px(COL[c], n, h, m, e)


def round_n(u):
    """直立した円柱の前面。u=-1..1（幅方向）。左右の縁は外へ、中央は南へ傾く。"""
    u = max(-1., min(1., u))
    return (.8 * u, -.6 * math.sqrt(1 - u * u), .7)


def barrel():
    """樽: 板の円柱 + 鉄の帯2本 + 平らな楕円の蓋。足元 y=52。蓋の高さは前縁 y=34 の壁の高さ(18)に一致。"""
    body, hoops, lid = {}, {}, {}
    # 膨らんだ板の輪郭: 上下が細く中ほどが太い（行ごとの幅）。法線は行ごとの半径で円柱にする
    spans = {}
    for ys, span in ((range(31, 34), (17, 30)), (range(34, 37), (16, 31)), (range(37, 47), (15, 32)),
                     (range(47, 51), (16, 31)), (range(51, 53), (18, 29))):
        for y in ys:
            spans[y] = span

    def cyl(x, y):
        xl, xr = spans[y]
        return round_n((x + .5 - (xl + xr + 1) / 2.) / ((xr + 1 - xl) / 2.))
    for y, (xl, xr) in spans.items():
        for x in range(xl, xr + 1):
            edge = x in (xl, xr) or y == 52
            c = 'E' if edge else 'F' if (x - 16) % 4 == 0 else 'G' if (x - 16) // 4 % 2 == 0 else 'O'
            body[(x, y)] = px(c, cyl(x, y), 52 - y, 'wood')
    for base in (37, 47):   # 鉄の帯: 体の幅に沿い、前面の中央が1行下がる緩い楕円の弧（2行厚、全体で3行）
        for x in range(15, 33):
            u = (x + .5 - 24) / 9.
            sag = 1 if abs(u) < .6 else 0
            for k in (0, 1):
                y = base + sag + k
                if (x, y) in body:
                    c = 'Q' if x == spans[y][0] or x == spans[y][1] else 'R'
                    hoops[(x, y)] = px(c, cyl(x, y), 53 - y, 'iron')

    def inside(x, y):
        return ((x + .5 - 24) / 8.) ** 2 + ((y + .5 - 31.5) / 3.5) ** 2 <= 1
    for y in range(28, 35):
        for x in range(16, 32):
            if inside(x, y):
                rim = not all(inside(x + dx, y + dy) for dx, dy in N4)
                c = 'E' if rim else 'F' if x in (21, 26) else 'O' if 21 < x < 26 else 'H'
                lid[(x, y)] = px(c, FLAT, 18, 'wood')
    return [('body', body), ('hoops', hoops), ('lid', lid)]


def chest():
    """宝箱: 幅22×高さ18の低い箱。丸めた肩の平らな天板(高さ13)、南向きの蓋の前面と胴、鉄の帯2本、小さな掛け金、2本の足。"""
    feet, body, straps, latch = {}, {}, {}, {}
    for x0 in (14, 31):
        for y in (51, 52):
            for x in range(x0, x0 + 3):
                feet[(x, y)] = px('E' if y == 52 else 'M', FRONT, 52 - y, 'wood')
    for y in range(35, 51):
        xl, xr = {35: (16, 31), 36: (14, 33)}.get(y, (13, 34))
        for x in range(xl, xr + 1):
            edge = x in (xl, xr) or y in (35, 50)
            if y <= 38:
                c = 'E' if edge else 'N' if y == 38 else 'F' if y == 37 else 'O'
                body[(x, y)] = px(c, FLAT, 13, 'wood')
            else:
                c = 'E' if edge else 'F' if y in (42, 46) else 'G'
                body[(x, y)] = px(c, FRONT, 52 - y, 'wood')
    for (x, y), p in body.items():
        if x in (15, 16, 17, 30, 31, 32) and 36 <= y <= 49:
            straps[(x, y)] = px('R' if x in (16, 31) else 'Q', p.n, p.h + 1, 'iron')
    for y in range(41, 46):
        for x in range(22, 26):
            ring = x in (22, 25) or y in (41, 45) or (y == 43 and x in (23, 24))
            latch[(x, y)] = px('Q' if ring else 'S', FRONT, 53 - y, 'iron')
    return [('feet', feet), ('body', body), ('straps', straps), ('latch', latch)]


def sign():
    """立て札: 12×8 の板（外形。刻んだ2行）とまっすぐな4px幅の支柱。支柱は板の下に接し、足元 y=52。"""
    post, board = {}, {}
    for y in range(38, 53):
        for x in range(22, 26):
            edge = x in (22, 25) or y == 52
            post[(x, y)] = px('E' if edge else 'G', round_n((x + .5 - 24) / 2.), 52 - y, 'wood')
    for y in range(30, 38):
        for x in range(18, 30):
            edge = x in (18, 29) or y in (30, 37)
            text = (y == 32 and 20 <= x <= 27) or (y == 34 and 20 <= x <= 25)
            board[(x, y)] = px('E' if edge else 'M' if text else 'O', FRONT, 52 - y, 'wood')
    return [('post', post), ('board', board)]


STONE = ('.QQQ.', 'QbbbQ', 'QbcbQ', 'QQQQQ')   # 5×4 の小さな丸石。Q は接触の輪郭、b は基準色、c は中心


def stone(x0, y0, k):
    """丸石1個。素材色は奇数/偶数で変える（固有の違い）。法線は小さなドーム、高さは自分の足元(y0+3)から。"""
    base, mid = ('S', 'T') if k % 2 == 0 else ('R', 'S')
    out = {}
    for j, row in enumerate(STONE):
        for i, ch in enumerate(row):
            if ch != '.':
                u, v = (i + .5 - 2.5) / 2.5, (j + .5 - 2.) / 2.
                out[(x0 + i, y0 + j)] = px({'Q': 'Q', 'b': base, 'c': mid}[ch], (.7 * u, -.7 * v, 1.),
                                           3 - j + {'Q': 0, 'b': 1, 'c': 2}[ch], 'stone')
    return out


def log(x0, y0, x1, y1):
    """薪1本。中心線 (x0,y0)→(x1,y1) に沿う4行厚の帯。両端は木口、上下の縁は輪郭、法線は上が平ら・下が南へ傾く円柱。"""
    out = {}
    for x in range(x0, x1 + 1):
        ym = round(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
        for k in range(4):
            c = 'E' if k in (0, 3) else 'P' if x in (x0, x1) else 'F' if x % 4 == 0 else 'G'
            out[(x, ym - 1 + k)] = px(c, (0., -.7 * k / 3., 1.), 4 - k, 'wood')
    return out


FLAME = {28: 1, 29: 2, 30: 2, 31: 3, 32: 4, 33: 4, 34: 5, 35: 6, 36: 6, 37: 7, 38: 8, 39: 8, 40: 8, 41: 8, 42: 7, 43: 6, 44: 5}


def campfire():
    """焚き火: 石の輪（小さな丸石9個）・熾火・交差する薪2本・炎。炎の先端は (24, 28) = pivot の 24px 上（ランタイムの発光点 ay-24 に一致）。"""
    back = {}
    for i, (x, y) in enumerate(((17, 42), (22, 42), (27, 42), (14, 45), (30, 45))):
        back.update(stone(x, y, i))
    embers = {}
    for y in range(46, 49):
        for x in range(18, 31):
            if ((x + .5 - 24) / 5.5) ** 2 + ((y + .5 - 47.5) / 1.8) ** 2 <= 1:
                embers[(x, y)] = px('@' if (x + y) % 3 == 0 else 'u', FLAT, 52 - y, 'stone', True)   # 熾火の面: 中心 y=47 で h=5（4..6）
    flame = {}
    for y, w in FLAME.items():
        xl = 24 - w // 2
        for x in range(xl, xl + w):
            d = min(x - xl, xl + w - 1 - x, (y - 28) // 2)
            flame[(x, y)] = px('z' if d == 0 else '@' if d == 1 else '+', FLAT, 52 - y, 'wood', True)   # 物理軸は足元 y=52: 先端 y=28 で h=24
    front = {}
    for i, (x, y) in enumerate(((15, 49), (20, 49), (25, 49), (30, 49))):
        front.update(stone(x, y, i + 1))
    return [('ring_back', back), ('embers', embers), ('log_a', log(19, 46, 29, 41)), ('log_b', log(19, 41, 29, 46)),
            ('flame', flame), ('ring_front', front)]


def workbench():
    """作業台: 天板の板2枚（平ら、高さ18）+ 南向きの前板 + 2本の脚 + 道具1つ（金槌: 木の柄と鉄の頭）。足元 y=80。"""
    legs, top, front, tool = {}, {}, {}, {}
    for x0 in (31, 61):
        for y in range(66, 81):
            for x in range(x0, x0 + 4):
                legs[(x, y)] = px('E' if x in (x0, x0 + 3) or y == 80 else 'G', FRONT, 80 - y, 'wood')
    for y in range(56, 62):
        for x in range(28, 68):
            joint = (y in (57, 58) and x == 44) or (y in (60, 61) and x == 52)
            c = 'E' if x in (28, 67) or y == 56 else 'F' if joint or y == 59 else 'O' if y < 59 else 'G'
            top[(x, y)] = px(c, FLAT, 18, 'wood')
    for y in range(62, 66):
        for x in range(28, 68):
            front[(x, y)] = px('E' if x in (28, 67) or y == 65 else 'N' if y == 62 else 'G', FRONT, 80 - y, 'wood')
    for x in range(47, 59):
        tool[(x, 59)] = px('E', FLAT, 19, 'wood')
        tool[(x, 57)] = tool[(x, 58)] = px('N', FLAT, 20, 'wood')
    for y in range(55, 61):
        for x in range(59, 63):
            tool[(x, y)] = px('Q' if x in (59, 62) or y in (55, 60) else 'S', FLAT, 21, 'iron')
    return [('legs', legs), ('top', top), ('front', front), ('tool', tool)]


BUILD = {'chest': chest, 'barrel': barrel, 'sign': sign, 'campfire': campfire, 'workbench': workbench}


def nearest(n):
    m = math.sqrt(sum(v * v for v in n))
    return min(range(len(VECTORS)), key=lambda i: sum((a - b / m) ** 2 for a, b in zip(VECTORS[i], n)))


def n_hex(p):
    return (NORMAL_COLORS[-1] if p.e else NORMAL_COLORS[nearest(p.n)]).upper()   # 末尾の #8080ff が B=255 の発光


def h_hex(p, step):
    q = min(63, max(0, int(round(p.h / step)) * step))
    return '#%02X%02X80' % (round(q / 64 * 255), round(ROUGH[p.m] * 255))   # R=高さ/64, G=粗さ, B=128 中立ゲイン


def resolve(order, W, H):
    """奥から手前へ重ねて見える画素表 {(x,y): (要素番号, Px)}。キャンバス外は黙って捨てずに止める。"""
    grid = {}
    for i, (name, cells) in enumerate(order):
        for (x, y), p in cells.items():
            if not (0 <= x < W and 0 <= y < H):
                raise SystemExit(f'{name}: ({x},{y}) がキャンバス外')
            grid[(x, y)] = (i, p)
    return grid


def check_frame(nm, grid, W, H, PX, PY):
    """新規コマの契約: 1px 以上の余白（クリップなし）・足元が pivot 行・8近傍で単一の塊（浮いた破片なし）・発光は焚き火の炎だけ。"""
    xs, ys = [x for x, _ in grid], [y for _, y in grid]
    if min(xs) < 1 or min(ys) < 1 or max(xs) > W - 2 or max(ys) > H - 2:
        raise SystemExit(f'{nm}: キャンバスの縁に接している（クリップの危険）')
    if max(ys) != PY:
        raise SystemExit(f'{nm}: 足元の行が {max(ys)}（pivot の行 {PY} と違う）')
    seen, todo = {next(iter(grid))}, [next(iter(grid))]
    while todo:
        x, y = todo.pop()
        for dx, dy in N8:
            if (x + dx, y + dy) in grid and (x + dx, y + dy) not in seen:
                seen.add((x + dx, y + dy))
                todo.append((x + dx, y + dy))
    if len(seen) != len(grid):
        raise SystemExit(f'{nm}: 本体から離れた画素が {len(grid) - len(seen)} 個ある')
    emit = [xy for xy, (_, p) in grid.items() if p.e]
    if bool(emit) != (nm == 'campfire'):
        raise SystemExit(f'{nm}: 発光画素の有無が仕様と違う')
    if nm == 'campfire':
        top = min(y for _, y in emit)
        if top != PY - 24 or [x for x, y in emit if y == top] != [PX]:
            raise SystemExit(f'campfire: 炎の先端が ({PX},{PY - 24}) にない')
        tip = grid[(PX, top)][1]
        if tip.h != 24 or max(grid[xy][1].h for xy in emit) != 24:
            raise SystemExit(f'campfire: 炎の先端の世界高さが {tip.h}（24 でなければならない）')
        if any(not 4 <= grid[xy][1].h <= 6 for xy in emit if grid[xy][1].m == 'stone'):
            raise SystemExit('campfire: 熾火の高さが 4..6 でない')


def grid_of(project, frame):
    """render した結果から {(x,y): '#RRGGBB'}。不透明(255)と透明(0)以外の alpha は契約外なので止める。"""
    img, outside = render(project, frame)
    if outside:
        raise SystemExit(f"{frame['name']}: キャンバス外の画素がある")
    w = project['size'][0]
    cells = {}
    for i, p in enumerate(img.getdata()):
        if p[3] == 255:
            cells[(i % w, i // w)] = '#%02X%02X%02X' % p[:3]
        elif p[3] != 0:
            raise SystemExit(f"{frame['name']}: 半透明の画素がある")
    return cells


def element_parts(nm, order, grid):
    """要素ごとに、最終的に見えている画素だけの名前付き部品。layers を順に重ねると完成フレームと一致する。"""
    parts, layers = {}, []
    for i, (en, _) in enumerate(order):
        cells = {xy: p.c for xy, (j, p) in grid.items() if j == i}
        if cells:
            x0, x1, y0, y1 = min(x for x, _ in cells), max(x for x, _ in cells), min(y for _, y in cells), max(y for _, y in cells)
            parts[f'{nm}_{en}'] = (x0, y0, x1, y1, cells)
            layers.append((f'l{len(layers)}', f'{nm}_{en}', x0, y0))
    return parts, layers


def make_project(old, items, kind):
    colors = sorted({c for it in items for pt in it['parts'].values() for c in pt[4].values()})
    if len(colors) > 64:
        raise SystemExit(f'{kind}: 使う色が {len(colors)} 色（64色以下にする）')
    sym = {c: SYMBOLS[i] for i, c in enumerate(colors)}
    lines = [f"canvas {old['size'][0]} {old['size'][1]}", f"pivot {old['pivot'][0]} {old['pivot'][1]}"] + [f'palette {s} {c}' for c, s in sym.items()]
    for it in items:
        for pn, (x0, y0, x1, y1, cells) in it['parts'].items():
            lines += [f'part {pn} {x1 - x0 + 1} {y1 - y0 + 1}',
                      'rows ' + '|'.join(''.join(sym[cells[(x, y)]] if (x, y) in cells else '.' for x in range(x0, x1 + 1)) for y in range(y0, y1 + 1))]
    for it in items:
        lines.append(f"frame {it['name']} {it['duration']}")
        if it['tag']:
            lines.append(f"tag {it['tag']}")
        lines += [f'place {lid} {pn} {x} {y}' for lid, pn, x, y in it['layers']]
    return Editor().apply('\n'.join(lines))


def build_sheet(sheet, changed):
    old = {k: load(GAME / p.format(s=sheet)) for k, p in OLD_ART.items()}
    prod = json.loads((GAME / 'assets' / sheet / 'atlas.json').read_text(encoding='utf-8'))
    W, H = old['albedo']['size']
    PX, PY = old['albedo']['pivot']
    names = [f['name'] for f in old['albedo']['frames']]
    for k in KINDS:   # 3つの正本と production atlas の枠名・順・時間・大きさ・pivot が同じ
        if [f['name'] for f in old[k]['frames']] != names or old[k]['size'] != [W, H] or old[k]['pivot'] != [PX, PY]:
            raise SystemExit(f'{sheet}/{k}: 既存プロジェクトの枠・大きさ・pivot が albedo と違う')
        if [f['duration'] for f in old[k]['frames']] != [f['duration'] for f in old['albedo']['frames']]:
            raise SystemExit(f'{sheet}/{k}: 時間が albedo と違う')
    if list(prod['frames']) != names or any(prod['frames'][n]['duration'] != d for n, d in zip(names, (f['duration'] for f in old['albedo']['frames']))):
        raise SystemExit(f'{sheet}: production atlas の枠名・順・時間が正本と違う')
    if any(n not in names for n in changed):
        raise SystemExit(f'{sheet}: 差し替えるコマが無い')
    cols = prod['meta']['size']['w'] // W

    built = {}
    for nm in changed:
        order = BUILD[nm]()
        grid = resolve(order, W, H)
        check_frame(nm, grid, W, H, PX, PY)
        built[nm] = (order, grid)
    old_all = {k: {f['name']: grid_of(old[k], f) for f in old[k]['frames']} for k in KINDS}
    keep = {k: {n: g for n, g in old_all[k].items() if n not in changed} for k in KINDS}

    used_h = {c for g in keep['height'].values() for c in g.values()}
    for step in range(1, 17):   # 高さの色数が64を超えるときだけ、新規コマの高さを粗い段に丸める
        if len(used_h | {h_hex(p, step) for _, g in built.values() for _, p in g.values()}) <= 64:
            break
    else:
        raise SystemExit(f'{sheet}: 高さの色が64色に収まらない')
    new = {k: {} for k in KINDS}
    for nm, (order, grid) in built.items():
        new['albedo'][nm] = {xy: p.c for xy, (_, p) in grid.items()}
        new['normal'][nm] = {xy: n_hex(p) for xy, (_, p) in grid.items()}
        new['height'][nm] = {xy: h_hex(p, step) for xy, (_, p) in grid.items()}
        if any(c[5:] != '80' for c in new['height'][nm].values()) or any((c[5:] == 'FF') != p.e for c, (_, p) in zip(new['normal'][nm].values(), grid.values())):
            raise SystemExit(f'{nm}: 高さ B=128 / 法線 B（発光だけ255）の契約違反')
        if nm == 'campfire':   # 丸めた後の先端の高さも 24（R=96=0x60）のままか
            tx, ty = PX, min(y for (_, y), (_, p) in grid.items() if p.e)
            if new['height'][nm][(tx, ty)][1:3] != '60':
                raise SystemExit(f'campfire: 先端の高さ色 {new["height"][nm][(tx, ty)]} が h=24 でない（丸め段 {step}）')

    projects = {}
    for k in KINDS:
        items = []
        for fr in old[k]['frames']:
            nm = fr['name']
            if nm in changed and k == 'albedo':
                parts, layers = element_parts(nm, *built[nm])
            elif nm in changed:
                parts, layers = {f'{nm}_{k}': (0, 0, W - 1, H - 1, new[k][nm])}, [('image', f'{nm}_{k}', 0, 0)]
            else:
                lay = fr['layers']
                if len(lay) != 1 or (lay[0]['x'], lay[0]['y']) != (0, 0):
                    raise SystemExit(f'{sheet}/{k}/{nm}: 変えないコマが単一レイヤーの全面部品ではない')
                parts, layers = {lay[0]['part']: (0, 0, W - 1, H - 1, keep[k][nm])}, [(lay[0]['id'], lay[0]['part'], 0, 0)]
            items.append(dict(name=nm, duration=fr['duration'], tag=fr.get('tag'), parts=parts, layers=layers))
        projects[k] = make_project(old[k], items, f'{sheet}/{k}')
        if len(projects[k]['parts']) > 256:
            raise SystemExit(f'{sheet}/{k}: 部品が256を超える')

    for k, pr in projects.items():   # 数値の契約: 変えないコマは全画素一致、新規コマは設計と一致、3つの alpha が一致
        if [(f['name'], f['duration'], f.get('tag')) for f in pr['frames']] != [(f['name'], f['duration'], f.get('tag')) for f in old[k]['frames']]:
            raise SystemExit(f'{sheet}/{k}: 枠名・順・時間・タグが既存と違う')
        for fr in pr['frames']:
            got, want = grid_of(pr, fr), (new[k][fr['name']] if fr['name'] in changed else old_all[k][fr['name']])
            if got != want:
                raise SystemExit(f"{sheet}/{k}/{fr['name']}: 描画結果が期待と違う")
    for nm in names:
        masks = [set(grid_of(projects[k], next(f for f in projects[k]['frames'] if f['name'] == nm))) for k in KINDS]
        if nm in changed and not masks[0] == masks[1] == masks[2]:
            raise SystemExit(f'{sheet}/{nm}: albedo/normal/height の alpha が一致しない')

    for k, pr in projects.items():
        (OUT / sheet).mkdir(parents=True, exist_ok=True)
        save(pr, OUT / sheet / f'{k}.json')
        print(sheet, k, 'parts:', len(pr['parts']), 'colors:', len(pr['palette']), 'warnings:', export(pr, OUT / sheet / k, columns=cols)['warnings'])
        atlas = json.loads((OUT / sheet / k / 'atlas.json').read_text(encoding='utf-8'))
        if atlas['frames'] != prod['frames'] or any(atlas['meta'][m] != prod['meta'][m] for m in (('size', 'pivot', 'frameTags') if k == 'albedo' else ('size', 'pivot'))):
            raise SystemExit(f'{sheet}/{k} の atlas.json が production の枠・大きさ・pivot' + ('・タグ' if k == 'albedo' else '') + 'と違う')
    print(f'{sheet}: 高さの丸め段 {step}  変えないコマ {len(names) - len(changed)}（全画素一致を確認）')
    for nm, (order, grid) in built.items():
        xs, ys = [x for x, _ in grid], [y for _, y in grid]
        print(f'  [{nm}] opaque old {len(old_all["albedo"][nm])} -> new {len(grid)}  bbox x {min(xs)}..{max(xs)} y {min(ys)}..{max(ys)}  '
              f'parts {len({i for i, _ in grid.values()})}  albedo colors {len(set(new["albedo"][nm].values()))}  normals {len(set(new["normal"][nm].values()))}  '
              f'height {min(p.h for _, p in grid.values())}..{max(p.h for _, p in grid.values())}')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    for sheet, changed in SHEETS.items():
        build_sheet(sheet, changed)


if __name__ == '__main__':
    main()
