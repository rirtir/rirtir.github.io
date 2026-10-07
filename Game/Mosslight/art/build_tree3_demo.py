"""oak3 デモ（96x96, pivot 48,80）。中立アルベド・法線・高さを、同じ形の定義から作る。レビュー前の試作。

  python art/build_tree3_demo.py

書くもの: art/tree3-demo{,-normal,-height}.json と .review/v3/tree3-demo/ の書き出し。
manifest・runtime・既存の flora には触れない。色は画素配列から Workbench の part rows として組み、Pillow では編集しない。
高さ・法線は幹/枝/根（円柱）と葉の塊（楕円体）の式から解析的に求め、アルベドの明るさは使わない。
"""
from collections import Counter
import math
import random
import style  # noqa: F401  Workbenchのパスを通す
from style import GAME, SYMBOLS, SYMBOL_OF, header, part, frame, check
from engine import Editor
from pixelwork import export, save
from build_normal_maps import VECTORS, NORMAL_COLORS

W = H = 96
PIVOT = (48, 80)
AX = 48.0                     # 幹の軸（画素の境界座標）。根元の中心 = pivot x
REVIEW = GAME / '.review/v3/tree3-demo'
HEIGHT_VALUES = list(range(0, 64, 2))   # HEIGHT_SPAN 64。gain は常に中立（B=128）、粗さ80%
HEIGHT_COLORS = ['#%02x%02x%02x' % (round(h / 64 * 255), round(.8 * 255), 128) for h in HEIGHT_VALUES]

# 葉の固有色（光を含まない）。族ごとに3値＋稀な差し色。閾値で族ごとの混ざり方が変わる。
LEAF = [(('#2c4d36', '#3d6340', '#557a45'), '#7a9a4c', (.40, .78, .92)),
        (('#2c4d36', '#3d6340', '#557a45'), '#7d6a2c', (.30, .62, .94)),
        (('#2c4d36', '#3d6340', '#557a45'), '#7d6a2c', (.22, .50, .82))]
LEAF_OUTLINE, LEAF_OCC = '#1f3a2e', '#17302c'
BARK = ('#4a2f24', '#5a3f2c', '#6b4430', '#7a5636')
BARK_DARK, MOSS = '#3b2a22', '#3d6340'


def _hash(ix, iy, seed):
    n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffff) / 65535.0


def vnoise(x, y, seed):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _hash(ix, iy, seed), _hash(ix + 1, iy, seed)
    c, d = _hash(ix, iy + 1, seed), _hash(ix + 1, iy + 1, seed)
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy


class Clump:
    """葉の塊: 輪郭を揺らした楕円体。高さ = base + (top-base)·√(1-q)。奥(上)ほど低く、手前(下)ほど高い。"""
    kind = 'leaf'

    def __init__(self, cx, cy, rx, ry, family, seed):
        self.cx, self.cy, self.rx, self.ry, self.family, self.seed = cx, cy, rx, ry, family, seed
        self.base = 14 + .4 * cy
        self.top = self.base + .7 * min(rx, ry) + 3
        rng = random.Random(seed)
        self.ph = [rng.uniform(0, 6.28) for _ in range(3)]

    def q(self, x, y):
        dx, dy = (x - self.cx) / self.rx, (y - self.cy) / self.ry
        th = math.atan2(dy, dx)
        s = 1 + .10 * math.sin(3 * th + self.ph[0]) + .08 * math.sin(5 * th + self.ph[1]) + .07 * math.sin(11 * th + self.ph[2])
        return (dx * dx + dy * dy) / (s * s)

    def inside(self, x, y):   # 葉先のぎざぎざ: 輪郭だけに細かい揺れを足す
        return self.q(x, y) < 1 + .25 * (vnoise(x / 1.6, y / 1.6, self.seed + 7) - .5)

    def h(self, x, y):
        return (self.base + (self.top - self.base) * math.sqrt(max(.06, 1 - self.q(x, y)))
                + vnoise(x / 3., y / 3., self.seed))


class Limb:
    """幹・根・枝: 半径が変わる円柱。pts=(x,y,半径,稜線の高さ)。高さ = 稜線 - .6r·(1-√(1-u²))。creases は幹の縦溝。"""
    kind = 'bark'

    def __init__(self, role, pts, seed, creases=()):
        self.role, self.pts, self.seed, self.creases = role, pts, seed, creases

    def _near(self, x, y):
        best = None
        for (x0, y0, r0, z0), (x1, y1, r1, z1) in zip(self.pts, self.pts[1:]):
            vx, vy = x1 - x0, y1 - y0
            t = max(0., min(1., ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy)))
            r = r0 + (r1 - r0) * t
            u = math.hypot(x - x0 - vx * t, y - y0 - vy * t) / r
            if best is None or u < best[0]:
                best = (u, r, z0 + (z1 - z0) * t)
        return best

    def inside(self, x, y):
        return self._near(x, y)[0] < 1

    def crease(self, x, y):
        r = self._near(x, y)[1]
        s = (x - AX) / r
        return max([0.] + [1 - abs(s - c - .05 * math.sin(y * .23 + c * 9)) / .3 for c in self.creases])

    def h(self, x, y):
        u, r, z = self._near(x, y)
        return z - .6 * r * (1 - math.sqrt(max(.06, 1 - u * u))) - 1.8 * self.crease(x, y)


# 葉の塊 (cx, cy, rx, ry, 族)。大小を混ぜ、幹の上に隙間（負の空間）を残す。左右は非対称。
CLUMPS = [
    (30, 13, 10, 8, 0), (45, 9, 9, 7, 1), (60, 11, 10, 8, 0), (74, 18, 9, 7, 2), (17, 20, 9, 8, 1),
    (38, 22, 12, 9, 0), (57, 23, 11, 9, 1), (26, 31, 10, 8, 2), (47, 30, 9, 7, 0), (68, 30, 10, 8, 0),
    (84, 30, 5, 5, 2), (10, 32, 7, 6, 0), (18, 41, 9, 6, 1), (33, 38, 9, 7, 0), (63, 39, 9, 7, 2),
    (77, 40, 8, 6, 1), (27, 49, 7, 4, 0), (70, 48, 7, 4, 1), (7, 25, 4, 4, 2), (86, 22, 4, 4, 0),
    (39, 6, 5, 4, 0), (54, 5, 4, 3, 2), (69, 7, 5, 4, 1), (22, 10, 5, 4, 2), (11, 45, 5, 4, 2),
    (85, 41, 4, 4, 0), (40, 50, 4, 3, 1), (55, 51, 4, 3, 0), (33, 27, 4, 3, 1), (63, 16, 5, 4, 0),
]


def tz(y):   # 幹の稜線の高さ: 上へ行くほど高い（奥へ立ち上がる円柱）
    return 6 + (79.5 - y) * .45


def bz(y):
    return 6 + (62 - y) * .32


def limbs():
    trunk = Limb('trunk', [(48, 42, 3.4, tz(42)), (48, 54, 4.0, tz(54)), (48, 64, 4.8, tz(64)),
                           (48, 72, 6.4, tz(72)), (48, 79.5, 9.0, tz(79.5))], 1, creases=(-.62, -.2, .26, .66))
    roots = [  # 根: 短い・長い・手前・奥を混ぜ、先端は y79.5 まで
        [(46, 72, 3.2, 7), (38, 76, 2.4, 4.5), (30, 78.5, 1.5, 3)],
        [(50, 72, 3.2, 7), (58, 75.5, 2.4, 4.5), (67, 78, 1.4, 3)],
        [(44, 74, 3.0, 6), (41, 78, 2.0, 4), (39, 79.5, 1.2, 2.5)],
        [(52, 74, 2.8, 6), (55, 78, 1.8, 4), (58, 79.5, 1.2, 2.5)],
        [(42, 70, 2.2, 6), (34, 70, 1.5, 4), (28, 66, 1.1, 3)],
        [(55, 70, 2.2, 6), (63, 69, 1.5, 4), (69, 65, 1.1, 3)],
    ]
    branches = [  # 枝: 樹冠の下を通り、塊の隙間から見える
        [(46, 56, 3.6), (38, 50, 2.8), (29, 43, 2.0), (21, 38, 1.3)],
        [(50, 55, 3.4), (59, 48, 2.6), (68, 43, 1.9), (77, 38, 1.2)],
        [(48, 52, 3.2), (49, 42, 2.4), (46, 30, 1.7), (48, 22, 1.1)],
        [(45, 60, 2.6), (36, 58, 2.0), (27, 54, 1.4)],
        [(51, 59, 2.6), (62, 59, 2.0), (72, 56, 1.4)],
        [(38, 50, 1.6), (33, 41, 1.2), (31, 34, .9)],
        [(61, 47, 1.6), (63, 38, 1.2), (60, 30, .9)],
    ]
    out = [trunk]
    out += [Limb('root', p, 20 + i) for i, p in enumerate(roots)]
    out += [Limb('branch', [(x, y, r, bz(y)) for x, y, r in p], 40 + i) for i, p in enumerate(branches)]
    return out


def rasterize(prims):
    """各画素で最も高い図形が勝つ。返り値 grid[y][x] = (高さ, 図形) か None。1px の孤立点は消す。"""
    grid = [[None] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            best = None
            for p in prims:
                if p.inside(x + .5, y + .5):
                    h = p.h(x + .5, y + .5)
                    if best is None or h > best[0]:
                        best = (h, p)
            grid[y][x] = best
    for _ in range(2):
        for y in range(H):
            for x in range(W):
                if grid[y][x] and sum(1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                                      if 0 <= x + dx < W and 0 <= y + dy < H and grid[y + dy][x + dx]) < 2:
                    grid[y][x] = None
    return grid


def normal_index(p, x, y):
    """図形の高さ式の勾配から面の法線。Nx 右, Ny 上(画像の y は下向きなので符号を合わせる), Nz 手前。"""
    e = .4
    gx = (p.h(x + e, y) - p.h(x - e, y)) / (2 * e)
    gy = (p.h(x, y + e) - p.h(x, y - e)) / (2 * e)
    n = (-gx, gy, 1.)
    s = math.sqrt(sum(v * v for v in n))
    n = tuple(v / s for v in n)
    return min(range(len(VECTORS)), key=lambda i: sum((a - b) ** 2 for a, b in zip(VECTORS[i], n)))


def albedo_hex(grid, x, y):
    """固有色のみ。方向のある光は描かない。暗くするのは輪郭・塊の交差・樹皮の溝・根の付け根だけ。"""
    h, p = grid[y][x]
    leaf = p.kind == 'leaf'
    edge = any(not (0 <= x + dx < W and 0 <= y + dy < H and grid[y + dy][x + dx])
               for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    if edge:
        return LEAF_OUTLINE if leaf else BARK_DARK
    for r, gap in ((1, 3), (2, 8)):   # どの向きでも同じ規則: 近くに自分より高い別の図形があれば遮蔽
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                nx, ny = x + dx, y + dy
                if (dx or dy) and 0 <= nx < W and 0 <= ny < H and grid[ny][nx]:
                    nh, np_ = grid[ny][nx]
                    if np_ is not p and nh - h >= gap:
                        return LEAF_OCC if leaf else BARK_DARK
    xc, yc = x + .5, y + .5
    if leaf:
        pig, accent, (t1, t2, ta) = LEAF[p.family]
        n1 = vnoise(xc / 3.3, yc / 3.3, p.seed)
        n2 = vnoise(xc / 1.9 + 17, yc / 1.9, p.seed + 3)
        if n2 > ta:
            return accent
        v = .7 * n1 + .3 * n2
        return pig[0] if v < t1 else pig[1] if v < t2 else pig[2]
    if p.creases and p.crease(xc, yc) > .45:
        return BARK_DARK
    if p.role != 'branch' and y > 58 and vnoise(xc / 3, yc / 3, p.seed + 9) > .8:
        return MOSS
    n = vnoise(xc / 2.2, yc / 5.5, p.seed)   # 縦に流れる2〜5pxの樹皮の斑
    return BARK[0] if n < .28 else BARK[1] if n < .52 else BARK[2] if n < .78 else BARK[3]


def project_rows(grid):
    alb, nrm, hgt, nvec, heights, rgbs = [], [], [], [], [], []
    for y in range(H):
        a, n, g = [], [], []
        for x in range(W):
            if not grid[y][x]:
                a.append('.'); n.append('.'); g.append('.')
                continue
            h, p = grid[y][x]
            hexv = albedo_hex(grid, x, y)
            ni = normal_index(p, x + .5, y + .5)
            hi = min(len(HEIGHT_VALUES) - 1, max(0, round(h / 2)))
            a.append(SYMBOL_OF[hexv]); n.append(SYMBOLS[ni]); g.append(SYMBOLS[hi])
            rgbs.append((x, y, tuple(int(hexv[i:i + 2], 16) for i in (1, 3, 5)), ni, hi * 2))
        alb.append(''.join(a)); nrm.append(''.join(n)); hgt.append(''.join(g))
    return alb, nrm, hgt, rgbs


def map_project(palette, rows):
    lines = [f'canvas {W} {H}', f'pivot {PIVOT[0]} {PIVOT[1]}']
    lines += [f'palette {SYMBOLS[i]} {c}' for i, c in enumerate(palette)]
    lines += [f'part oak {W} {H}', 'rows ' + '|'.join(rows), 'frame oak 1000', 'tag flora', 'place image oak 0 0']
    return Editor().apply('\n'.join(lines))


def albedo_project(rows):
    lines = header((W, H), PIVOT)
    part(lines, 'oak', rows)
    frame(lines, 'oak', [('oak', 0, 0)], duration=1000, tag='flora')
    return Editor().apply('\n'.join(lines))


# ---- lightbox（確認用。shader と同じ形の式。法線は量子化後のベクトルを使う） ----
def _dir(az, el=45.):
    c = math.cos(math.radians(el))
    return (c * math.cos(math.radians(az)), c * math.sin(math.radians(az)), math.sin(math.radians(el)))


def lit(rgb, vec, sun, flip):
    nx, ny, nz = vec
    nx = -nx if flip else nx
    d = max(0., nx * sun[0] + ny * sun[1] + nz * sun[2])
    sky = .5 * (.7 + .3 * nz)
    return tuple(min(255, round(c * (s * sky + k * d))) for c, s, k in zip(rgb, (.62, .72, .9), (.98, .9, .78)))


def raster_project(grid, scale=1):
    """色の格子 -> ≤64色へ減色した Workbench project（頻度上位63色、他は最近色）。透明は None。"""
    counts = Counter(c for row in grid for c in row if c)
    pal = [c for c, _ in counts.most_common(63)]
    near = {c: c if c in pal else min(pal, key=lambda p: sum((a - b) ** 2 for a, b in zip(p, c))) for c in counts}
    sym = {c: SYMBOLS[i] for i, c in enumerate(pal)}
    rows = []
    for row in grid:
        line = ''.join('.' if not c else sym[near[c]] for c in row for _ in range(scale))
        rows.extend([line] * scale)
    w, h = len(rows[0]), len(rows)
    lines = [f'canvas {w} {h}', 'pivot 0 0'] + ['palette %s #%02x%02x%02x' % ((sym[c],) + c) for c in pal]
    lines += [f'part lit {w} {h}', 'rows ' + '|'.join(rows), 'frame lit 100', 'place image lit 0 0']
    return Editor().apply('\n'.join(lines))


def lightbox(rgbs):
    pix = {(x, y): (rgb, VECTORS[ni]) for x, y, rgb, ni, _ in rgbs}
    suns = (_dir(17), _dir(163))   # 朝（東=画面右）と夕（西=画面左）
    panels = [(suns[0], False), (suns[1], False), (suns[0], True), (suns[1], True)]
    native = [[None] * (2 * W) for _ in range(2 * H)]
    for i, (sun, flip) in enumerate(panels):
        ox, oy = (i % 2) * W, (i // 2) * H
        for (x, y), (rgb, vec) in pix.items():
            native[oy + y][ox + (W - 1 - x if flip else x)] = lit(rgb, vec, sun, flip)
    crop = [row[16:80] for row in native[0:64]]   # 4倍: 64x64 の切り出し × 4 = 256
    return raster_project(native), raster_project(crop, 4)


# ---- 数値検査（退行の検出用。見た目の良さの証明ではない） ----
def lstar(rgb):
    lin = [(c / 255 / 12.92) if c / 255 <= .04045 else ((c / 255 + .055) / 1.055) ** 2.4 for c in rgb]
    y = .2126 * lin[0] + .7152 * lin[1] + .0722 * lin[2]
    return 116 * y ** (1 / 3) - 16 if y > .008856 else 903.3 * y


def corr(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else 0.


def report(rgbs, grid, rows3):
    ls = [lstar(r[2]) for r in rgbs]
    worst = max(abs(corr(ls, [max(0., sum(a * b for a, b in zip(VECTORS[r[3]], _dir(az * 45))) ) for r in rgbs]))
                for az in range(8))
    left = [l for l, r in zip(ls, rgbs) if r[0] < 48]
    right = [l for l, r in zip(ls, rgbs) if r[0] >= 48]
    trunk = [(min(x for x in range(W) if grid[y][x] and grid[y][x][1].role == 'trunk') + 1 +
              max(x for x in range(W) if grid[y][x] and grid[y][x][1].role == 'trunk')) / 2 for y in range(56, 73)]
    shapes = [tuple(tuple(c == '.' for c in row) for row in rows) for rows in rows3]
    print(f'clumps {len(CLUMPS)}  |r(L*,N.L)| max over 8 az: {worst:.3f} (<=.15)')
    print(f'L* left-right mean diff: {abs(sum(left) / len(left) - sum(right) / len(right)):.2f} (<=4)')
    print(f'|corr(L*, height)|: {abs(corr(ls, [r[4] for r in rgbs])):.3f} (<=.5)')
    print(f'trunk centre x (rows 56-72): {min(trunk):.2f}..{max(trunk):.2f} (48.0)')
    print('alpha shapes match:', shapes[0] == shapes[1] == shapes[2])
    print('colors albedo/normal/height:', *(len({c for row in rows for c in row} - {'.'}) for rows in rows3))


def main():
    prims = [Clump(*c[:5], 100 + i * 7) for i, c in enumerate(CLUMPS)] + limbs()
    grid = rasterize(prims)
    alb, nrm, hgt, rgbs = project_rows(grid)
    projects = {'tree3-demo': albedo_project(alb), 'tree3-demo-normal': map_project(NORMAL_COLORS, nrm),
                'tree3-demo-height': map_project(HEIGHT_COLORS, hgt)}
    native, big = lightbox(rgbs)
    REVIEW.mkdir(parents=True, exist_ok=True)
    for name, project in projects.items():
        check(project)
        save(project, GAME / f'art/{name}.json')
        warns = export(project, REVIEW / name.replace('tree3-demo', 'albedo' if name == 'tree3-demo' else '').strip('-'),
                       columns=1)['warnings']
        print(name, 'warnings:', warns)
    for name, project in (('lightbox-native', native), ('lightbox-4x', big)):
        check(project)
        print(name, project['size'], 'warnings:', export(project, REVIEW / name, columns=1)['warnings'])
    report(rgbs, grid, (alb, nrm, hgt))


if __name__ == '__main__':
    main()
