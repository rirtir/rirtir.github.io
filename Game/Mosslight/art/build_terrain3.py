"""地面素材(ground シート: 8材質 × 6変種 = 48枚, 32x32)の作り直し。中立アルベド + 形から作る法線/高さ。

  python art/build_terrain3.py                  レビュー用の書き出しだけ(.review/v3/terrain-production/)。ゲームのファイルには触れない
  python art/build_terrain3.py --integrate      レビュー後にだけ実行する。契約(名前・並び・サイズ・タグ・時間・列数)を検査してから、
                                                art/ground.json, art/normalmaps/ground-{normal,height}.json, assets/ground/{atlas,normal,height}.png を置き換える

manifest・atlas.json・renderer・lighting・他のart scriptには触れない(atlas.json は契約が同じなら変わらないので置き換えない)。
色は記号の格子から Workbench の part rows として組み、Pillow では編集しない。パレットはこの素材専用(art/palette.json は64色で埋まっていて、
#617b47 系の草色を足せないため)。レビューで合否を見る。

設計:
- アルベド: 光を含まない固有色。材質ごとに低コントラストの4段 + 差し色1段。広い形のかたまり(macro)と細かい粒(grain)を、周期32pxの値ノイズで作る。
- 継ぎ目: 縁から2px以内は macro と grain の「共通成分」だけ。変種ごとの違いは内側(縁から3px以降)にだけ入る。だから別の変種が隣り合っても継ぎ目が出ない。
- 高さ: 色とは別のノイズ・形の式から作る(色の明るさは使わない)。土は細かい粒の起伏、草は小さな葉の盛り上がり、石は面の傾き(低い面)。
- 法線: 高さの勾配から作り、build_normal_maps の量子化ベクトルに最近傍で丸める。
- 高さの画素値: R = px/64*255(0〜4px を 0.25px 刻み), G = 粗さ 0.8, B = gain 1.0(中立)。
"""
import argparse
import json
import math
import os
import random
import shutil

import style  # noqa: F401  Workbenchのパスを通す
from style import GAME, SYMBOLS, check
from engine import Editor
from pixelwork import export, save
from build_normal_maps import VECTORS, NORMAL_COLORS

T = 32
VARIANTS = 6
DURATION = 100
COLUMNS = 8
REVIEW = GAME / '.review/v3/terrain-production'

# 材質の順は assets/manifest.json の ground シートの names と同じ(grass0..5, darkgrass0..5, ...)
MATERIALS = ['grass', 'darkgrass', 'dirt', 'path', 'sand', 'cave', 'moss', 'ruin']

# 各材質: 暗→明の5段(最後の1段は葉先・小石・欠けなどの差し色)。草は #617b47 / #6c894c の系統。土は静かな泥色(黄色の帯を作らない)
RAMPS = {
    'grass': ['#4f663b', '#58713f', '#617b47', '#6c894c', '#748c50'],
    'darkgrass': ['#44593a', '#4c6340', '#556c45', '#5f7a4c', '#668050'],
    'moss': ['#46604a', '#4f6b50', '#5a775a', '#648362', '#68845f'],
    'dirt': ['#5a4838', '#654f3d', '#705843', '#7a614a', '#86705a'],
    'path': ['#6a5846', '#74614d', '#7e6a55', '#887460', '#8d7c69'],
    'sand': ['#ae9b72', '#b9a67c', '#c3b186', '#cdbb91', '#d6c69f'],
    'cave': ['#3d404b', '#464955', '#4f525e', '#585b67', '#656873'],
    'ruin': ['#555c66', '#5e656f', '#676e78', '#717880', '#777f86'],
}

# soft: 値ノイズの段分け。macro/grain はセルの大きさ(32の約数)、thr は4段のしきい値、relief は高さの振れ(px)
# facet: 周期ボロノイの面。sites は面の数、amp は面の傾き(px/px)、crack は面の境の溝の幅
SPEC = {
    'grass': dict(kind='soft', seed=11, macro=8, grain=4, thr=(.22, .38, .76), relief=.25, hmacro=8, hgrain=2, blades=2),
    'darkgrass': dict(kind='soft', seed=23, macro=8, grain=4, thr=(.22, .40, .76), relief=.25, hmacro=8, hgrain=2, blades=2),
    'moss': dict(kind='soft', seed=37, macro=8, grain=2, thr=(.22, .38, .76), relief=.25, hmacro=8, hgrain=2, blades=1),
    'dirt': dict(kind='soft', seed=41, macro=16, grain=2, thr=(.20, .40, .76), relief=.5, hmacro=16, hgrain=2, pebbles=(1, 3)),
    'path': dict(kind='soft', seed=53, macro=16, grain=4, thr=(.20, .38, .78), relief=.3, hmacro=16, hgrain=4, pebbles=(0, 1)),
    'sand': dict(kind='soft', seed=67, macro=16, grain=4, thr=(.36, .50, .66), relief=.6, hmacro=16, hgrain=4),
    'cave': dict(kind='facet', seed=71, sites=10, amp=.30, crack=1.1, chips=2),
    'ruin': dict(kind='facet', seed=89, sites=6, amp=.16, crack=1.4, chips=1),
}

HEIGHT_STEP = .25
HEIGHT_MAX = 4.
HEIGHT_COLORS = ['#%02x%02x%02x' % (round(i * HEIGHT_STEP / 64 * 255), round(.8 * 255), 128)
                 for i in range(int(HEIGHT_MAX / HEIGHT_STEP) + 1)]


# ---- 周期ノイズ(32pxで繰り返す) ----
def _hash(ix, iy, seed):
    n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffff) / 65535.0


def pnoise(x, y, cell, seed):
    n = T // cell
    fx, fy = x / cell, y / cell
    ix, iy = math.floor(fx), math.floor(fy)
    tx, ty = fx - ix, fy - iy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a, b = _hash(ix % n, iy % n, seed), _hash((ix + 1) % n, iy % n, seed)
    c, d = _hash(ix % n, (iy + 1) % n, seed), _hash((ix + 1) % n, (iy + 1) % n, seed)
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty


def inner(x, y):
    """変種ごとの差を入れてよい度合い。縁から2px以内は0(全変種で共通)、6px以降は1。"""
    d = min(x, y, T - 1 - x, T - 1 - y)
    return 0. if d < 3 else 1. if d >= 6 else (d - 2) / 4.


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


# ---- 材質ごとの形(クラス格子 cls[y][x] = 0..4 と 高さ格子 hgt[y][x] px) ----
def soft_tile(spec, v):
    cls = [[0] * T for _ in range(T)]
    hgt = [[0.] * T for _ in range(T)]
    s = spec['seed']
    t0, t1, t2 = spec['thr']
    for y in range(T):
        for x in range(T):
            xc, yc, w = x + .5, y + .5, inner(x, y)
            macro = pnoise(xc, yc, spec['macro'], s)
            gs, gv = pnoise(xc, yc, spec['grain'], s + 1), pnoise(xc, yc, spec['grain'], s + 17 + v * 7)
            f = .5 * macro + .5 * (gs + w * (gv - gs))
            cls[y][x] = 0 if f < t0 else 1 if f < t1 else 2 if f < t2 else 3
            # 高さは色とは別の種のノイズ。色の段は使わない
            hm = pnoise(xc, yc, spec['hmacro'], s + 101)
            hs, hv = pnoise(xc, yc, spec['hgrain'], s + 102), pnoise(xc, yc, spec['hgrain'], s + 103 + v * 5)
            hgt[y][x] = spec['relief'] * (.35 * hm + .65 * (hs + w * (hv - hs)))
    rng = random.Random(s * 1000 + v)
    for _ in range(spec.get('blades', 0)):
        # 草の房: 近い位置に3〜4枚の葉(根元は暗く、先は明るい差し色)。房は離して置く
        cx, cy = rng.randint(6, 25), rng.randint(7, 25)
        for _ in range(rng.randint(3, 4)):
            bx, by = clamp(cx + rng.randint(-3, 3), 4, 27), clamp(cy + rng.randint(-2, 3), 5, 27)
            lean = rng.choice((-1, 0, 1))
            cls[by][bx], hgt[by][bx] = 0, hgt[by][bx] + .5
            cls[by - 1][bx], hgt[by - 1][bx] = 3, hgt[by - 1][bx] + .8
            if rng.random() < .6:
                tx = clamp(bx + lean, 4, 27)
                cls[by - 2][tx], hgt[by - 2][tx] = 4, hgt[by - 2][tx] + 1.0
    lo, hi = spec.get('pebbles', (0, 0))
    for _ in range(rng.randint(lo, hi)):
        # 小石: 2x1 か 2x2 の低いドーム。上の段は明るい差し色、下の段は土の色のまま高さだけ持つ
        px, py = rng.randint(5, 25), rng.randint(5, 25)
        two_rows = rng.random() < .5
        for dx in (0, 1):
            cls[py][px + dx], hgt[py][px + dx] = 4, hgt[py][px + dx] + 1.5
            if two_rows:
                hgt[py + 1][px + dx] += 1.0
    return cls, hgt


def facet_tile(spec, v):
    s = spec['seed']
    rng = random.Random(s)   # 面は全変種で共通(継ぎ目のため)
    sites = []
    for _ in range(spec['sites']):
        sites.append(dict(x=rng.uniform(0, T), y=rng.uniform(0, T), cls=rng.choice((1, 1, 2, 2, 3)),
                          a=rng.uniform(-spec['amp'], spec['amp']), b=rng.uniform(-spec['amp'], spec['amp']),
                          h0=rng.uniform(1., 2.4)))
    cls = [[0] * T for _ in range(T)]
    hgt = [[0.] * T for _ in range(T)]
    for y in range(T):
        for x in range(T):
            xc, yc = x + .5, y + .5
            best = []
            for i, st in enumerate(sites):
                ox = (xc - st['x'] + T / 2) % T - T / 2
                oy = (yc - st['y'] + T / 2) % T - T / 2
                best.append((math.hypot(ox, oy), i, ox, oy))
            best.sort()
            (d1, i1, ox, oy), d2 = best[0], best[1][0]
            st = sites[i1]
            h = st['h0'] + st['a'] * ox + st['b'] * oy
            g = pnoise(xc, yc, 2, s + 5)
            if d2 - d1 < spec['crack']:
                cls[y][x], h = 0, h - .9
            else:
                cls[y][x] = int(clamp(st['cls'] + (1 if g > .82 else -1 if g < .16 else 0), 1, 3))
            hgt[y][x] = clamp(h, 0., HEIGHT_MAX)
    rv = random.Random(s * 1000 + v)
    for _ in range(spec['chips']):
        # 欠け・砂利: 内側にだけ置く2x1
        px, py = rv.randint(5, 25), rv.randint(5, 26)
        for dx in (0, 1):
            cls[py][px + dx], hgt[py][px + dx] = 4, hgt[py][px + dx] + .6
    return cls, hgt


def normal_index(hgt, x, y):
    gx = (hgt[y][(x + 1) % T] - hgt[y][(x - 1) % T]) / 2
    gy = (hgt[(y + 1) % T][x] - hgt[(y - 1) % T][x]) / 2
    n = (-gx, gy, 1.)
    s = math.sqrt(sum(c * c for c in n))
    n = tuple(c / s for c in n)
    return min(range(len(VECTORS)), key=lambda i: sum((a - b) ** 2 for a, b in zip(VECTORS[i], n)))


def height_index(h):
    return int(clamp(round(h / HEIGHT_STEP), 0, len(HEIGHT_COLORS) - 1))


# ---- 組み立て ----
def palette_symbols():
    colors = []
    for m in MATERIALS:
        for c in RAMPS[m]:
            if c not in colors:
                colors.append(c)
    if len(colors) > len(SYMBOLS):
        raise ValueError(f'色数 {len(colors)} が記号表を超えています')
    return colors, {c: SYMBOLS[i] for i, c in enumerate(colors)}


def build_tiles():
    """返り値: [(name, albedo_rows, normal_rows, height_rows, meta)] (ground シートの順)。"""
    colors, sym = palette_symbols()
    tiles = []
    for m in MATERIALS:
        spec = SPEC[m]
        for v in range(VARIANTS):
            cls, hgt = (soft_tile if spec['kind'] == 'soft' else facet_tile)(spec, v)
            alb = [''.join(sym[RAMPS[m][c]] for c in row) for row in cls]
            nrm = [''.join(SYMBOLS[normal_index(hgt, x, y)] for x in range(T)) for y in range(T)]
            hts = [''.join(SYMBOLS[height_index(hgt[y][x])] for x in range(T)) for y in range(T)]
            tiles.append((f'{m}{v}', alb, nrm, hts, dict(material=m, variant=v, cls=cls, hgt=hgt)))
    return colors, tiles


def project(palette, tiles, rows_of):
    lines = [f'canvas {T} {T}', 'pivot 0 0'] + [f'palette {SYMBOLS[i]} {c}' for i, c in enumerate(palette)]
    for i, tile in enumerate(tiles):
        lines += [f'part p{i} {T} {T}', 'rows ' + '|'.join(rows_of(tile)),
                  f'frame {tile[0]} {DURATION}', f'place image p{i} 0 0']
    return Editor().apply('\n'.join(lines))


def mosaic(palette, tiles, rows_of, across=2, down=2, per_row=4):
    """材質ごとの隣接変種を、Workbenchの256px上限内で並べる。"""
    by_mat = {m: [t for t in tiles if t[4]['material'] == m] for m in MATERIALS}
    pw, ph = across * T, down * T
    w, h = pw * per_row, ph * (len(MATERIALS) // per_row)
    out = [[None] * w for _ in range(h)]
    for k, m in enumerate(MATERIALS):
        ox, oy = (k % per_row) * pw, (k // per_row) * ph
        for ty in range(down):
            for tx in range(across):
                rows = rows_of(by_mat[m][(2 * tx + 3 * ty) % VARIANTS])
                for y in range(T):
                    for x in range(T):
                        out[oy + ty * T + y][ox + tx * T + x] = rows[y][x]
    lines = [f'canvas {w} {h}', 'pivot 0 0'] + [f'palette {SYMBOLS[i]} {c}' for i, c in enumerate(palette)]
    lines += [f'part m {w} {h}', 'rows ' + '|'.join(''.join(r) for r in out), 'frame m 100', 'place image m 0 0']
    return Editor().apply('\n'.join(lines))


# ---- 数値検査(退行の検出用。見た目の良さの証明ではない) ----
def lum(hexv):
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    return .2126 * r + .7152 * g + .0722 * b


def corr(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / den if den else 0.


def report(tiles):
    problems = []
    for m in MATERIALS:
        ts = [t for t in tiles if t[4]['material'] == m]
        # 継ぎ目: 縁から2px以内の色の段・高さが全変種で同じ(別変種が隣り合っても繋がる)
        for t in ts[1:]:
            for y in range(T):
                for x in range(T):
                    if min(x, y, T - 1 - x, T - 1 - y) <= 1:
                        if (t[4]['cls'][y][x], t[4]['hgt'][y][x]) != (ts[0][4]['cls'][y][x], ts[0][4]['hgt'][y][x]):
                            problems.append(f'{m}{t[4]["variant"]}: 縁の画素 ({x},{y}) が変種0と違う')
        cls = [c for t in ts for row in t[4]['cls'] for c in row]
        ls = [lum(RAMPS[m][c]) for c in cls]
        hs = [h for t in ts for row in t[4]['hgt'] for h in row]
        hist = [round(100 * cls.count(i) / len(cls)) for i in range(5)]
        print(f'{m:10s} 段の割合% {hist}  輝度の幅 {max(ls) - min(ls):.0f}  |corr(輝度, 高さ)| {abs(corr(ls, hs)):.2f}  高さ {min(hs):.1f}..{max(hs):.1f}px')
        if max(ls) - min(ls) > 40:
            problems.append(f'{m}: 輝度の幅が大きすぎます')
    print('検査:', '問題なし' if not problems else f'{len(problems)}件')
    for p in problems[:20]:
        print('  ', p)
    return problems


# ---- 統合(レビュー後・root だけが実行する) ----
def integrate(projects, out):
    atlas_path = GAME / 'assets/ground/atlas.json'
    old = json.loads(atlas_path.read_text(encoding='utf-8'))
    manifest = json.loads((GAME / 'assets/manifest.json').read_text(encoding='utf-8'))
    names = [f'{m}{v}' for m in MATERIALS for v in range(VARIANTS)]
    stage = out / '_integrate'
    if stage.exists():
        shutil.rmtree(stage)
    for kind, proj in projects.items():
        warns = export(proj, stage / kind, columns=COLUMNS)['warnings']
        if warns:
            raise SystemExit(f'中止: {kind} の書き出しに警告があります: {warns}')
    fails = []
    if manifest['sheets']['ground']['names'] != names:
        fails.append('manifest の ground.names がこの並びと違います')
    for kind in projects:
        new = json.loads((stage / kind / 'atlas.json').read_text(encoding='utf-8'))
        for key in ('frames',):
            if json.dumps(new[key], sort_keys=True) != json.dumps(old[key], sort_keys=True):
                fails.append(f'{kind}: frames(名前・並び・矩形・時間)が既存の atlas.json と違います')
        for key in ('size', 'frameTags', 'pivot'):
            if new['meta'].get(key) != old['meta'].get(key):
                fails.append(f'{kind}: meta.{key} が違います 新={new["meta"].get(key)} 既存={old["meta"].get(key)}')
    if fails:
        raise SystemExit('中止(何も置き換えていません):\n  ' + '\n  '.join(fails))
    moves = [
        (stage / 'albedo/atlas.png', GAME / 'assets/ground/atlas.png'),
        (stage / 'normal/atlas.png', GAME / 'assets/ground/normal.png'),
        (stage / 'height/atlas.png', GAME / 'assets/ground/height.png'),
    ]
    jsons = [(projects['albedo'], GAME / 'art/ground.json'),
             (projects['normal'], GAME / 'art/normalmaps/ground-normal.json'),
             (projects['height'], GAME / 'art/normalmaps/ground-height.json')]
    staged = []
    for src, dst in moves:   # 先に全部 .new へ置く。途中で失敗しても本物は無傷
        shutil.copyfile(src, str(dst) + '.new')
        staged.append((str(dst) + '.new', dst))
    for proj, dst in jsons:
        save(proj, str(dst) + '.new')
        staged.append((str(dst) + '.new', dst))
    for tmp, dst in staged:
        os.replace(tmp, dst)
    print('統合しました:', ', '.join(str(d.relative_to(GAME)) for _, d in staged))


def main():
    ap = argparse.ArgumentParser(description='地面素材の作り直し(既定はレビュー用の書き出しだけ)')
    ap.add_argument('--out', default=str(REVIEW), help='レビュー用の出力先')
    ap.add_argument('--integrate', action='store_true', help='レビュー後に、契約を検査して art/ と assets/ground を置き換える')
    args = ap.parse_args()
    out = type(REVIEW)(args.out)
    palette, tiles = build_tiles()
    projects = {
        'albedo': project(palette, tiles, lambda t: t[1]),
        'normal': project(NORMAL_COLORS, tiles, lambda t: t[2]),
        'height': project(HEIGHT_COLORS, tiles, lambda t: t[3]),
    }
    out.mkdir(parents=True, exist_ok=True)
    for kind, proj in projects.items():
        check(proj)
        print(kind, 'warnings:', export(proj, out / kind, columns=COLUMNS)['warnings'])
    for kind, pal, idx in (('mosaic-albedo', palette, 1), ('mosaic-normal', NORMAL_COLORS, 2), ('mosaic-height', HEIGHT_COLORS, 3)):
        mp = mosaic(pal, tiles, lambda t, i=idx: t[i])
        check(mp)
        print(kind, 'warnings:', export(mp, out / kind, columns=1)['warnings'])
    problems = report(tiles)
    if args.integrate:
        if problems:
            raise SystemExit('数値検査に問題があるため統合しません')
        integrate(projects, out)


if __name__ == '__main__':
    main()
