"""畑シート farmland（farmland_join0..15）の新規制作 v4。正本の manifest・art/farmland.json・assets/・runtime は変えず、.review/v4/farmland-production/ だけを書く。

  python art/build_farmland4.py

38x38, pivot (3,3)。32x32 の区画は枠の 3..34 に置き、外側 3px は「つながっていない辺」だけに出る土の縁（ragged 1〜3px）。
マスク = 4近傍の「つながっている」ビット: N=1 / E=2 / S=4 / W=8（farmland_join0 = 孤立、15 = 四方に隣接）。
形: 本体 = 耕した壌土。幅2pxの畝（高さ +2px）と幅2pxの溝を横方向に4本（間隔 9,7,9,7 の不揃い、畝は緩く波打ち、切れ目あり）。
    土塊（2x1）と窪み（1px）を数個。どの向きの光も描かない。明るさは高さ（畝の頂は乾いて明るく、溝は湿って暗い）で決まる固有色だけ。
    本体は 32px 周期（左右・上下とも）なので、つながった辺は全マスク同じ画素で、連続した畝になる。
    つながっていない辺 = 内側 0〜2px の平らな縁（畝が途切れる）+ 外側 1〜3px の崩れた土の縁（辺ごとの周期プロファイル）。
    外側の角は両辺がつながっていないときだけ丸く出る（つながった隣へ 3px はみ出さない）。
作り方: アルベドは Workbench の名前付き部品（body / lip_n,e,s,w / corner_nw,ne,sw,se）を place で重ねる。Pillow は使わない。
法線: 高さ（半px単位の整数）の勾配から求める。画面 y 下向きの高さ増加 → Ny 正（上向き。ground.js の縁と同じ規約）。色の明るさは使わない。
高さ: R = px/64×255、G = 230（粗さ .9）、B = 128（中立ゲイン）。地面側の高さは 0.5px（縁の外）として勾配を取る。
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

T, RIM = 32, 3
W = H = T + 2 * RIM
PIVOT = (RIM, RIM)
DURATION = 140
NAMES = [f'farmland_join{m}' for m in range(16)]
BIT = {'n': 1, 'e': 2, 's': 4, 'w': 8}
OUT = GAME / '.review/v4/farmland-production'
GROUND_HP = 1   # 縁の外（地面）の高さ。半px単位 = 0.5px

# 固有色（光を含まない。壌土の ramp）
COL = {'trough': '#2a1e1a', 'pit': '#35261f', 'loam': '#4a382c', 'loam2': '#523f31', 'shoulder': '#5b4636', 'crest': '#6b5441',
       'clod': '#7a6249', 'lip': '#5d4836', 'lip2': '#4f3d2e', 'spill1': '#58432f', 'spill2': '#46352a'}

# 畝: (開始行, 間隔, 波の振幅, 周期数, 位相)。32行に4本。間隔は不揃い（9,7,9,7）。
FURROWS = [(3, 9, 1, 1, 0), (12, 7, 1, 2, 5), (19, 9, 1, 1, 17), (28, 7, 1, 2, 11)]
# 畝の1本ぶん（開始行からの行）。高さは半px: 溝 2(=1px) / 平らな壌土 3 / 畝の肩 4 / 畝の頂 6(=3px)。頂 +2px が畝の高さ。左右対称（上下の向きを持たない）。
ROW = [('shoulder', 4), ('crest', 6), ('crest', 6), ('shoulder', 4), ('trough', 2), ('trough', 2)]
FLAT = ('loam', 3)
GAPS = [(1, 12, 16), (3, 3, 6), (0, 24, 28), (2, 18, 20)]          # (畝, u0, u1): 頂が崩れて肩の高さになる区間
FLAT2 = [(0, 6, 13), (1, 20, 27), (2, 2, 8), (3, 15, 22)]          # (畝, u0, u1): 平らな壌土が一段明るい斑
CLODS = [(6, 13), (21, 25), (26, 8), (11, 21)]                     # 2x1 の土塊（高さ +0.5px）
PITS = [(9, 5), (17, 17), (23, 27), (4, 26)]                       # 1px の窪み（高さ -0.5px）

# 辺ごとの周期プロファイル（u = 辺に沿った区画内の座標 0..31）。外側の縁の厚み 1〜3px、内側の平らな縁 0〜2px。
OUT_D = {'n': '22322332322133223323223322321332', 'e': '32233223233221322332233233223212',
         's': '23332232232233213322323322332232', 'w': '33223322322323312233222332233223'}
LIP = {'n': '12011210211021210121102211201121', 'e': '21120112102120112210121012110211',
       's': '01221011201211021102210121101221', 'w': '12102112011212012101221110221021'}
SIDE_BOX = {'n': (RIM, 0, T, 5), 'e': (RIM + T - 2, RIM, 5, T), 's': (RIM, RIM + T - 2, T, 5), 'w': (0, RIM, 5, T)}   # x, y, w, h（内側2 + 外側3）
CORNERS = {'nw': ('w', 'n'), 'ne': ('e', 'n'), 'sw': ('w', 's'), 'se': ('e', 's')}   # 角 → (横の辺, 縦の辺)


def wave(i, u):
    _, _, amp, cyc, ph = FURROWS[i]
    return int(math.floor(amp * math.sin(2 * math.pi * (cyc * u + ph) / T) + .5))


def body_cell(u, v):
    bounds = [(s + wave(i, u)) % T for i, (s, *_) in enumerate(FURROWS)]
    off = [(v - b) % T for b in bounds]
    i = min(range(len(off)), key=lambda k: off[k])
    o = off[i]
    if o < len(ROW):
        key, hp = ROW[o]
        if o in (1, 2) and any(g[0] == i and g[1] <= u <= g[2] for g in GAPS):
            key, hp = 'shoulder', 4
        return key, hp
    return ('loam2', 3) if any(f[0] == i and f[1] <= u <= f[2] for f in FLAT2) else FLAT


def build_body():
    tab = [[body_cell(u, v) for u in range(T)] for v in range(T)]
    for u, v in CLODS:
        for du in (0, 1):
            tab[v][u + du] = ('clod', min(8, tab[v][u + du][1] + 1))
    for u, v in PITS:
        tab[v][u] = ('pit', max(1, tab[v][u][1] - 1))
    return tab


BODY = build_body()
BODY_PX = {(RIM + u, RIM + v): BODY[v][u] for v in range(T) for u in range(T)}


def side_pixels(s):
    x0, y0, w, h = SIDE_BOX[s]
    out = {}
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            a = j = 0
            if s == 'n':
                a, j = (RIM - y, 0) if y < RIM else (0, y - RIM)
            elif s == 's':
                a, j = (y - (RIM + T) + 1, 0) if y >= RIM + T else (0, RIM + T - 1 - y)
            elif s == 'w':
                a, j = (RIM - x, 0) if x < RIM else (0, x - RIM)
            else:
                a, j = (x - (RIM + T) + 1, 0) if x >= RIM + T else (0, RIM + T - 1 - x)
            u = (x if s in 'ns' else y) - RIM
            if a:
                if a <= int(OUT_D[s][u]):
                    out[(x, y)] = ('spill1', 2) if a == 1 else ('spill2', 1)
            elif j < int(LIP[s][u]):
                out[(x, y)] = ('lip', 3) if j == 0 else ('lip2', 3)
    return out


def corner_pixels(c):
    hs, vs = CORNERS[c]
    left, top = hs == 'w', vs == 'n'
    x0, y0 = (0 if left else RIM + T), (0 if top else RIM + T)
    ui, vi = (0 if left else T - 1), (0 if top else T - 1)
    out = {}
    for cy in range(RIM):
        for cx in range(RIM):
            a = RIM - cx if left else cx + 1
            b = RIM - cy if top else cy + 1
            if a <= int(OUT_D[hs][vi]) and b <= int(OUT_D[vs][ui]) and a * a + b * b <= 8:
                out[(x0 + cx, y0 + cy)] = ('spill1', 2) if max(a, b) == 1 else ('spill2', 1)
    return out


SIDE_PX = {s: side_pixels(s) for s in BIT}
CORNER_PX = {c: corner_pixels(c) for c in CORNERS}
CORNER_BOX = {c: (0 if CORNERS[c][0] == 'w' else RIM + T, 0 if CORNERS[c][1] == 'n' else RIM + T, RIM, RIM) for c in CORNERS}
PARTS = {'farmland_body': ((RIM, RIM, T, T), BODY_PX),
         **{f'lip_{s}': (SIDE_BOX[s], SIDE_PX[s]) for s in BIT},
         **{f'corner_{c}': (CORNER_BOX[c], CORNER_PX[c]) for c in CORNERS}}


def layers(m):
    """マスク m のフレームに重ねる部品（奥 → 手前）。つながった辺には縁を置かない。角は両辺がつながっていないときだけ。"""
    out = ['farmland_body'] + [f'lip_{s}' for s in 'nesw' if not m & BIT[s]]
    return out + [f'corner_{c}' for c, (hs, vs) in CORNERS.items() if not m & BIT[hs] and not m & BIT[vs]]


def compose(m):
    comp = {}
    for name in layers(m):
        comp.update(PARTS[name][1])
    return comp


def body_hp(x, y):
    return BODY[(y - RIM) % T][(x - RIM) % T][1]


def normals(m, comp):
    """高さ（半px）の中心差分から法線。枠の外・透明は、つながった辺の外なら隣の本体（周期）、そうでなければ地面の高さ。"""
    def hs(x, y):
        p = comp.get((x, y))
        if p:
            return p[1]
        ox = -1 if x < RIM else 1 if x >= RIM + T else 0
        oy = -1 if y < RIM else 1 if y >= RIM + T else 0
        if (ox < 0 and m & 8) or (ox > 0 and m & 2) or (oy < 0 and m & 1) or (oy > 0 and m & 4):
            return body_hp(x, y)
        return GROUND_HP

    out = {}
    for (x, y) in comp:
        dx, dy = (hs(x + 1, y) - hs(x - 1, y)) / 4., (hs(x, y + 1) - hs(x, y - 1)) / 4.   # 半px → px、中心差分の 1/2
        n = (-dx, dy, 1.)                                                                    # 画面 y 下へ高さが増える → Ny 正（上向き）
        L = math.sqrt(sum(v * v for v in n))
        out[(x, y)] = min(range(len(VECTORS)), key=lambda i: sum((a - b / L) ** 2 for a, b in zip(VECTORS[i], n)))
    return out


def sheet_rows(plane, enc):
    return [''.join(SYMBOLS[enc(plane[(x, y)])] if (x, y) in plane else '.' for x in range(W)) for y in range(H)]


def part_rows(box, px, sym):
    x0, y0, w, h = box
    return [''.join(sym[COL[px[(x, y)][0]]] if (x, y) in px else '.' for x in range(x0, x0 + w)) for y in range(y0, y0 + h)]


def albedo_project(sym):
    lines = [f'canvas {W} {H}', f'pivot {PIVOT[0]} {PIVOT[1]}'] + [f'palette {s} {h}' for h, s in sym.items()]
    for name, (box, px) in PARTS.items():
        rows = part_rows(box, px, sym)
        lines += [f'part {name} {len(rows[0])} {len(rows)}', 'rows ' + '|'.join(rows)]
    for m, name in enumerate(NAMES):
        lines += [f'frame {name} {DURATION}', 'tag default']
        lines += [f'place l{i} {p} {PARTS[p][0][0]} {PARTS[p][0][1]}' for i, p in enumerate(layers(m))]
    return Editor().apply('\n'.join(lines))


# ---- 確認用の配置（アルベドのみ）: 孤立・隣接・L字・穴のある環 ----
LAYOUTS = {'shapes': {(0, 0), (1, 0), (2, 0), (0, 1), (2, 1), (0, 2), (1, 2), (2, 2),    # 3x3 の環（中央が穴）
                      (4, 0), (4, 1), (4, 2), (5, 2),                                      # L字
                      (0, 4), (1, 4), (3, 4), (5, 4)},                                    # 隣接2つと孤立2つ
           'block': {(x, y) for x in range(1, 5) for y in range(1, 4)} | {(0, 0)}}
LAYOUT_COLS, LAYOUT_ROWS = 6, 5


def mask_of(plots, x, y):
    return sum(bit for (dx, dy), bit in (((0, -1), 1), ((1, 0), 2), ((0, 1), 4), ((-1, 0), 8)) if (x + dx, y + dy) in plots)


def layout_project(sym, frames):
    lw, lh = LAYOUT_COLS * T + 2 * RIM + 0, LAYOUT_ROWS * T + 2 * RIM
    lines = [f'canvas {lw} {lh}', 'pivot 0 0'] + [f'palette {s} {h}' for h, s in sym.items()]
    for m, comp in frames.items():
        rows = sheet_rows({xy: COL[p[0]] for xy, p in comp.items()}, lambda hexv: SYMBOLS.index(sym[hexv]))
        lines += [f'part f{m} {W} {H}', 'rows ' + '|'.join(rows)]
    for name, plots in LAYOUTS.items():
        lines += [f'frame {name} {DURATION}', 'tag default']
        lines += [f'place p{x}_{y} f{mask_of(plots, x, y)} {x * T} {y * T}' for (x, y) in sorted(plots, key=lambda p: (p[1], p[0]))]
    return Editor().apply('\n'.join(lines))


# ---- 検査（退行検出用。見た目の良さの証明ではない） ----
def fail(msg):
    raise SystemExit(msg)


def verify_structure(frames, nrm):
    for i in range(len(FURROWS)):
        if any(wave(i, u) != wave(i, u + T) for u in range(T)):
            fail(f'畝 {i} の波が32px周期でない')
    for s in BIT:
        if len(OUT_D[s]) != T or len(LIP[s]) != T:
            fail(f'{s}: プロファイルの長さが {T} でない')
        if not 1 <= min(map(int, OUT_D[s])) or max(map(int, OUT_D[s])) > 3 or max(map(int, LIP[s])) > 2 or min(map(int, LIP[s])) != 0:
            fail(f'{s}: 外側は 1〜3px、内側は 0〜2px（0 を含む＝全周の縁にしない）')
    crumbs = sum(1 for row in BODY for k, _ in row if k in ('clod', 'pit'))
    if crumbs > T * T * .02 or any(not (3 <= u <= 28 and 3 <= v <= 28) for u, v in CLODS + PITS):
        fail('土塊・窪みは本体の2%以下で、縁の帯（辺から3px）に置かない')
    if max(max(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in COL.values()) > 0x80:
        fail('固有色に明るい色（白い縁になりうる値）がある')
    for m, comp in frames.items():
        for y in range(RIM, RIM + T):
            for x in range(RIM, RIM + T):
                if (x, y) not in comp:
                    fail(f'{NAMES[m]}: 区画の内側に透明がある ({x},{y})')
        for (x, y) in comp:
            if not (0 <= x < W and 0 <= y < H):
                fail(f'{NAMES[m]}: 枠の外の画素')
            need = [s for s, out in (('w', x < RIM), ('e', x >= RIM + T), ('n', y < RIM), ('s', y >= RIM + T)) if out]
            if any(m & BIT[s] for s in need):
                fail(f'{NAMES[m]}: つながった辺の外側に画素がある ({x},{y}) — 隣へはみ出す')
        for s in BIT:
            if m & BIT[s]:
                continue
            for u in range(T):
                x0, y0, w, h = SIDE_BOX[s]
                cells = [(x, y) for y in range(y0, y0 + h) for x in range(x0, x0 + w)
                         if (x, y) in comp and (x if s in 'ns' else y) - RIM == u and
                         (y < RIM or y >= RIM + T if s in 'ns' else x < RIM or x >= RIM + T)]
                if not 1 <= len(cells) <= 3:
                    fail(f'{NAMES[m]}: {s} 辺 u={u} の外側の縁が {len(cells)}px（1〜3）')
    # つながった辺の帯（辺から2px、両端3pxを除く）は、全マスクでマスク15（本体のみ）と同じ 色・法線・高さ
    for m in range(16):
        for s, bit in BIT.items():
            if not m & bit:
                continue
            for k in range(3, T - 3):
                for j in range(2):
                    xy = {'n': (RIM + k, RIM + j), 's': (RIM + k, RIM + T - 1 - j), 'w': (RIM + j, RIM + k), 'e': (RIM + T - 1 - j, RIM + k)}[s]
                    if (frames[m][xy], nrm[m][xy]) != (frames[15][xy], nrm[15][xy]):
                        fail(f'{NAMES[m]}: つながった {s} 辺の帯 {xy} がマスク15と違う（色/法線/高さ）')
    # 法線の向き規約: 勾配が縦だけ（横だけ）の画素で、Ny は dh/dy_下 と同符号、Nx は -dh/dx と同符号
    flat = frames[15]
    for (x, y), (_, hp) in flat.items():
        if not (RIM + 1 <= x < RIM + T - 1 and RIM + 1 <= y < RIM + T - 1):
            continue
        dx, dy = flat[(x + 1, y)][1] - flat[(x - 1, y)][1], flat[(x, y + 1)][1] - flat[(x, y - 1)][1]
        vx, vy, _ = VECTORS[nrm[15][(x, y)]]
        if dx == 0 and abs(dy) >= 2 and (vy > 0) != (dy > 0):
            fail(f'法線の規約違反（Ny） ({x},{y})')
        if dy == 0 and abs(dx) >= 2 and (vx > 0) != (dx < 0):
            fail(f'法線の規約違反（Nx） ({x},{y})')
    if len({tuple(sorted(c.items())) for c in frames.values()}) != 16:
        fail('16状態に同一のフレームがある')


def verify_render(projects, frames):
    for i, name in enumerate(NAMES):
        alphas = []
        for key, pr in projects.items():
            img, outside = render(pr, pr['frames'][i])
            if outside:
                fail(f'{name}/{key}: キャンバス外の画素')
            alphas.append([p[3] > 0 for p in img.getdata()])
        want = [(x, y) in frames[i] for y in range(H) for x in range(W)]
        if not alphas[0] == alphas[1] == alphas[2] == want:
            fail(f'{name}: albedo/normal/height の alpha が一致しない、または部品の合成が期待と違う')
        rgb = [p[:3] for p in render(projects['albedo'], projects['albedo']['frames'][i])[0].getdata()]
        if any(w and c != tuple(int(COL[frames[i][(k % W, k // W)][0]][j:j + 2], 16) for j in (1, 3, 5)) for k, (w, c) in enumerate(zip(want, rgb))):
            fail(f'{name}: 部品を重ねたアルベドの色が期待と違う')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    frames = {m: compose(m) for m in range(16)}
    nrm = {m: normals(m, frames[m]) for m in range(16)}
    verify_structure(frames, nrm)
    used = sorted({COL[k] for comp in frames.values() for k, _ in comp.values()})
    if len(used) > 64:
        fail(f'アルベドの色が {len(used)} 色（64色以下にする）')
    sym = {h: SYMBOLS[i] for i, h in enumerate(used)}
    stub = {'size': [W, H], 'pivot': list(PIVOT), 'frames': [{'name': n, 'duration': DURATION} for n in NAMES]}
    height_colors = ['#%02x%02x80' % (round(hp / 2 / 64 * 255), 230) for hp in range(1, 9)]   # R=高さ/64, G=粗さ.9, B=128 中立ゲイン
    projects = {'albedo': albedo_project(sym),
                'normal': project_lines(stub, NORMAL_COLORS, [sheet_rows(nrm[m], lambda v: v) for m in range(16)]),
                'height': project_lines(stub, height_colors, [sheet_rows(frames[m], lambda p: p[1] - 1) for m in range(16)])}
    verify_render(projects, frames)
    OUT.mkdir(parents=True, exist_ok=True)
    for key, project in projects.items():
        save(project, OUT / f'{key}.json')
        print(key, 'parts:', len(project['parts']), 'warnings:', export(project, OUT / key, columns=4)['warnings'])
    layout = layout_project(sym, frames)
    save(layout, OUT / 'layout.json')
    print('layout warnings:', export(layout, OUT / 'layout', columns=1)['warnings'])
    fragment = {'sheets': {'farmland': {'image': 'farmland/atlas.png', 'atlas': 'farmland/atlas.json', 'pivot': list(PIVOT), 'names': NAMES,
                                        'overrides': 'tiles', 'normal': 'farmland/normal.png', 'height': 'farmland/height.png'}}}
    (OUT / 'manifest-fragment.json').write_text(json.dumps(fragment, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for m in (0, 5, 10, 15):
        comp = frames[m]
        print(f'[{NAMES[m]}] opaque {len(comp)}  albedo colors {len({COL[k] for k, _ in comp.values()})}  normals {len(set(nrm[m].values()))}  '
              f'height hp {min(p[1] for p in comp.values())}..{max(p[1] for p in comp.values())}')


if __name__ == '__main__':
    main()
