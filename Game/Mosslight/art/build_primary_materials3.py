"""主要素材パック 2枚（minerals: rock/copper/iron/crystal、nature_props: rock/berry/bush/smallrock0/smallrock1/log）の本番生成。
64x56, pivot 32,48。中立アルベド + 形から解析的に求めた法線・高さ。左上の固定ハイライトは描かない。

  python art/build_primary_materials3.py                      確認用。.review/v3/primary-materials/<sheet>/ だけを書く
  python art/build_primary_materials3.py --sheet minerals     1枚だけ
  python art/build_primary_materials3.py --integrate          画像を確認した後。art/<sheet>.json・normalmaps・assets/<sheet> を置き換える

manifest・runtime・他シート・既存の名前/順/大きさ/pivot/枠の時間/タグ/atlas列数は変えない（変わるなら何も置き換えずに止まる）。Pillowは使わない。
形: 岩 = 凸多角形の面ごとに傾きが違う屋根形（前面は急、上面は平ら）。鉱脈 = 岩の中を走る顔料の帯（光ではない）。
    結晶 = 軸に沿った2面の角柱。葉 = 中肋を稜線にした先の尖った2面の葉を枝に対で付けた群。実 = 小さな球。
    丸太・枝 = 解析的なカプセル、切り口 = 年輪の楕円。明るさは非方向の顔料の斑・輪郭・図形どうしの接触線・上面の苔だけ。
法線・高さは図形の高さ式から求め、アルベドの色は使わない。発光の印（法線 61）は結晶の芯だけ。
"""
import argparse
import json
import math
import os
import random
import shutil
import sys
import build_tree3_demo as demo
from build_tree3_demo import Limb, vnoise, normal_index, HEIGHT_COLORS
from style import GAME, SYMBOLS, SYMBOL_OF, header, part, frame, check
from engine import Editor
from pixelwork import export, save
from build_normal_maps import VECTORS, NORMAL_COLORS, project_lines

W, H, PIVOT = 64, 56, (32, 48)
YMAX = 47.6                        # 岩の底。pivot(y48) の直上で接地する
EMIT = len(NORMAL_COLORS) - 1      # 発光の印（結晶の芯だけ）
REVIEW = GAME / '.review/v3/primary-materials'
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
NAMES = {'minerals': ['rock', 'copper', 'iron', 'crystal'],
         'nature_props': ['rock', 'berry', 'bush', 'smallrock0', 'smallrock1', 'log']}

# 顔料（すべて art/palette.json の色）。光を含まない。
TONES = (('#3c4250', '#59606b', '#7c8389'), ('#262a33', '#3c4250', '#59606b'), ('#59606b', '#7c8389', '#a4a9a6'))
MOSS3 = ('#2c4d36', '#3d6340', '#557a45')
GREENS = (('#2c4d36', '#3d6340', '#557a45'), ('#3d6340', '#557a45', '#7a9a4c'), ('#1f3a2e', '#2c4d36', '#3d6340'))
BARK = ('#4a2f24', '#6b4430', '#8f5e3a', '#b07d4a')
COPPER = dict(pig=('#934f3f', '#b4642e', '#e0965a'), acc='#2f7a6e', at=.84)    # 銅 + 緑青の斑
IRON = dict(pig=('#21485f', '#2f6476', '#5d9aa0'), acc='#c8e0d6', at=.87)      # 翠鉄（青緑）+ 淡い塊


def hull(pts):
    pts = sorted(set(pts))

    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and (out[-1][0] - out[-2][0]) * (p[1] - out[-2][1]) - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0]) <= 0:
                out.pop()
            out.append(p)
        return out
    return half(pts)[:-1] + half(pts[::-1])[:-1]


class Stone:
    """不規則な凸多角形の岩。高さ = 各辺の面（傾き違い）の最小。辺の外向きが画面下（前面）なら急、後ろ・横は緩く、頂は top で平ら。
    傾きは辺ごとの乱数で、光の向きとは無関係。ore を渡すと、岩の中を走る鉱脈（または全面が鉱石の露頭）になる。"""
    kind, out, occ, gap, bias = 'stone', '#262a33', '#262a33', 5., .3

    def __init__(self, cx, cy, rx, ry, radii, top, seed, tones=0, moss=0., ore=None, z0=1., rot=0.):
        rng = random.Random(seed)
        n = len(radii)
        angles = [math.radians(rot) + 2 * math.pi * (i + rng.uniform(-.28, .28)) / n for i in range(n)]
        self.pts = hull([(cx + rx * r * math.cos(a), min(YMAX, cy + ry * r * math.sin(a))) for r, a in zip(radii, angles)])
        gx, gy = sum(p[0] for p in self.pts) / len(self.pts), sum(p[1] for p in self.pts) / len(self.pts)
        self.edges = []
        for (x0, y0), (x1, y1) in zip(self.pts, self.pts[1:] + self.pts[:1]):
            L = math.hypot(x1 - x0, y1 - y0)
            nx, ny = (y1 - y0) / L, -(x1 - x0) / L
            if (gx - x0) * nx + (gy - y0) * ny < 0:
                nx, ny = -nx, -ny
            self.edges.append((x0, y0, nx, ny, .42 + .85 * max(0., -ny) + .3 * rng.random()))   # 内向きが上 = 外向きが下 = 前面 = 急
        self.top, self.seed, self.tones, self.moss, self.ore, self.z0 = top, seed, tones, moss, ore, z0

    def inside(self, x, y):
        return min((x - e[0]) * e[2] + (y - e[1]) * e[3] for e in self.edges) + .7 * (vnoise(x / 2.6, y / 2.6, self.seed + 3) - .5) > 0

    def h(self, x, y):
        v = min(self.z0 + e[4] * ((x - e[0]) * e[2] + (y - e[1]) * e[3]) for e in self.edges)
        return max(0., min(self.top, v)) + .5 * (vnoise(x / 6., y / 6., self.seed) - .5)

    def ore_color(self, xc, yc):
        o, s = self.ore, self.seed
        band = abs(vnoise(xc / 7. + 3, yc / 7., s + 21) - .5)
        on = band < o['vw'] or (abs(vnoise(xc / 4.2, yc / 4.2 + 5, s + 22) - .5) < o['vw'] * .55 and vnoise(xc / 9., yc / 9., s + 23) > .45)
        if o['solid']:
            on = on or vnoise(xc / 5. + 11, yc / 5., s + 24) < .78
        if not on:
            return None
        if vnoise(xc / 2.6 + 40, yc / 2.6, s + 26) > o['at']:
            return o['acc']
        v = vnoise(xc / 3., yc / 3., s + 25)
        return o['pig'][0 if v < .33 else 1 if v < .7 else 2]

    def color(self, xc, yc, g):
        s = self.seed
        if self.ore:
            c = self.ore_color(xc, yc)
            if c:
                return c
        if self.moss and g < .4 and vnoise(xc / 5. + 7, yc / 5., s + 9) > 1 - self.moss:   # 苔は平らな上面だけ（光の向きではなく傾きで決まる）
            v = vnoise(xc / 3.5, yc / 3.5, s + 11)
            return MOSS3[0 if v < .3 else 1 if v < .75 else 2]
        pig = TONES[self.tones]
        v = .8 * vnoise(xc / 4.6, yc / 4.6, s + 5) + .2 * vnoise(xc / 2.8 + 17, yc / 2.8, s + 6)
        return pig[0] if v < .4 else pig[1] if v < .68 else pig[2]


class Mat:
    """岩の足元の低い苔の敷き。接地用。"""
    kind, out, occ, gap, bias = 'mat', '#1f3a2e', '#1f3a2e', 99., 0.

    def __init__(self, cx, cy, rx, ry, seed):
        self.cx, self.cy, self.rx, self.ry, self.seed = cx, cy, rx, ry, seed

    def inside(self, x, y):
        return ((x - self.cx) / self.rx) ** 2 + ((y - self.cy) / self.ry) ** 2 < 1 + .35 * (vnoise(x / 3., y / 3., self.seed) - .5)

    def h(self, x, y):
        return .3 + .5 * vnoise(x / 5., y / 5., self.seed + 1)

    def color(self, xc, yc, g):
        v = vnoise(xc / 3.5, yc / 3.5, self.seed + 2)
        return MOSS3[0 if v < .35 else 1 if v < .75 else 2]


class Crystal:
    """軸に沿った2面の角柱。稜線が軸で、先は尖る。芯（軸の帯）は発光の印。"""
    kind, out, occ, gap, bias = 'crystal', '#1d4a4a', '#1d4a4a', 3., .3

    def __init__(self, bx, by, tx, ty, w, z0, seed):
        dx, dy = tx - bx, ty - by
        self.bx, self.by, self.len, self.w, self.z0, self.seed = bx, by, math.hypot(dx, dy), w, z0, seed
        self.ux, self.uy = dx / self.len, dy / self.len
        self.zt = z0 + .55 * self.len

    def tp(self, x, y):
        return ((x - self.bx) * self.ux + (y - self.by) * self.uy) / self.len, -(x - self.bx) * self.uy + (y - self.by) * self.ux

    def inside(self, x, y):
        t, p = self.tp(x, y)
        return -.03 <= t <= 1 and abs(p) < self.w * (1. if t < .7 else (1 - t) / .3) + .2 * (vnoise(x / 2., y / 2., self.seed) - .5)

    def h(self, x, y):
        t, p = self.tp(x, y)
        return self.z0 + (self.zt - self.z0) * max(0., t) - 3.4 * min(1., abs(p) / self.w)

    def emit(self, xc, yc):
        t, p = self.tp(xc, yc)
        return abs(p) < .28 * self.w and .25 < t < .95

    def color(self, xc, yc, g):
        t, p = self.tp(xc, yc)
        return '#4fb39a' if abs(p) < .3 * self.w else '#9fe6c8' if t > .88 else '#1d4a4a' if t < .16 else '#2f7a6e'


class Dome:
    """植物全体の低い丸み（世界高さ）。葉の高さはこれに葉ごとの起伏を足す。"""

    def __init__(self, cx, cy, rx, ry, base, top):
        self.a = (cx, cy, rx, ry, base, top)

    def __call__(self, x, y):
        cx, cy, rx, ry, b, t = self.a
        return b + (t - b) * math.sqrt(max(.1, 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2))


class Leaf:
    """先の尖った葉。中肋が稜線の2面（断面が山形）で、葉先がやや高い。幅は sin(π t^.75)。"""
    kind, out, occ, gap, bias = 'leaf', '#1f3a2e', '#17302c', 2.9, .4

    def __init__(self, bx, by, tx, ty, w, pig, z0, seed, dome):
        dx, dy = tx - bx, ty - by
        self.bx, self.by, self.len, self.w, self.pig, self.z0, self.seed, self.dome = bx, by, math.hypot(dx, dy), w, pig, z0, seed, dome
        self.ux, self.uy = dx / self.len, dy / self.len

    def tp(self, x, y):
        return ((x - self.bx) * self.ux + (y - self.by) * self.uy) / self.len, -(x - self.bx) * self.uy + (y - self.by) * self.ux

    def wid(self, t):
        return self.w * math.sin(math.pi * min(1., max(0., t)) ** .75)

    def inside(self, x, y):
        t, p = self.tp(x, y)
        return 0 <= t <= 1 and abs(p) < self.wid(t) + .25 * (vnoise(x / 2., y / 2., self.seed) - .5)

    def h(self, x, y):
        t, p = self.tp(x, y)
        return self.dome(x, y) + self.z0 + 1.5 * (t - .5) - 1.7 * min(1., abs(p) / max(.8, self.wid(t)))

    def color(self, xc, yc, g):
        t, p = self.tp(xc, yc)
        v = vnoise(xc / 3.4, yc / 3.4, self.seed)
        i = 0 if v < .32 else 1 if v < .7 else 2
        if abs(p) < .55 and .1 < t < .88:   # 中肋: 1段だけ違う顔料
            return self.pig[2] if i < 2 else self.pig[1]
        return self.pig[i]


class Berry:
    kind, occ, gap, bias = 'fruit', '#6e3a33', 3.5, .4
    out = '#6e3a33'

    def __init__(self, cx, cy, r, z, pig, seed):
        self.cx, self.cy, self.r, self.z, self.pig, self.seed = cx, cy, r, z, pig, seed

    def q(self, x, y):
        return ((x - self.cx) ** 2 + (y - self.cy) ** 2) / self.r ** 2

    def inside(self, x, y):
        return self.q(x, y) < 1

    def h(self, x, y):
        return self.z + 1.1 * self.r * math.sqrt(max(.05, 1 - self.q(x, y)))

    def color(self, xc, yc, g):
        return self.pig


class LeafMass:
    """株の内側の重なる小葉。外周の枝葉と同じ高さから法線を求める。"""
    kind, out, occ, gap, bias = 'leaf', '#1f3a2e', '#2c4d36', 5., .2

    def __init__(self, dome):
        self.dome = dome

    def inside(self, x, y):
        q = ((x - 32) / 17) ** 2 + ((y - 36) / 9) ** 2
        return q < .93 + .2 * vnoise(x / 3, y / 3, 591)

    def h(self, x, y):
        return self.dome(x, y) - 1 + .6 * vnoise(x / 3, y / 3, 592)

    def color(self, xc, yc, g):
        v = vnoise(xc / 3.5, yc / 3.5, 593)
        return '#2c4d36' if v < .34 else '#3d6340' if v < .76 else '#557a45'


class Rod(Limb):
    """丸太・枝: 解析的なカプセル。断面は円 h = z - r(1-√(1-u²))。xmax で切って切り口を置く。"""
    gap, bias, k = 3., .3, 1.

    def __init__(self, role, pts, seed, xmax=None, moss=0.):
        super().__init__(role, pts, seed)
        self.xmax, self.moss = xmax, moss
        self.kind, self.out, self.occ = 'bark', '#3b2a22', '#4a2f24'

    def inside(self, x, y):
        return (self.xmax is None or x < self.xmax) and Limb.inside(self, x, y)

    def h(self, x, y):
        u, r, z = self._near(x, y)
        return z - self.k * r * (1 - math.sqrt(max(.05, 1 - u * u)))

    def color(self, xc, yc, g):
        s = self.seed
        if self.role == 'log':
            su = (yc - self.pts[0][1]) / self._near(xc, yc)[1]
            for c in (-.55, .05, .55):   # 横に走る樹皮の溝
                if abs(su - c - .06 * math.sin(xc * .17 + c * 9)) < .11:
                    return BARK[0]
            if self.moss and g < .4 and vnoise(xc / 5. + 5, yc / 4., s + 9) > 1 - self.moss:
                return MOSS3[0 if vnoise(xc / 3., yc / 3., s + 11) < .4 else 1]
        n = vnoise(xc / 6., yc / 1.7, s) if self.role == 'log' else vnoise(xc / 4., yc / 4., s)   # 丸太は横に流れる斑
        return BARK[0] if n < .2 else BARK[1] if n < .5 else BARK[2] if n < .8 else BARK[3]


class EndDisc:
    """丸太の切り口（年輪）。軸に垂直な面なので手前（+x）向きに傾く平面。"""
    kind, out, occ, gap, bias = 'cut', '#4a2f24', '#4a2f24', 3., .3

    def __init__(self, cx, cy, rx, ry, z, seed):
        self.cx, self.cy, self.rx, self.ry, self.z, self.seed = cx, cy, rx, ry, z, seed

    def rho(self, x, y):
        return math.sqrt(((x - self.cx) / self.rx) ** 2 + ((y - self.cy) / self.ry) ** 2)

    def inside(self, x, y):
        return self.rho(x, y) < 1 + .06 * (vnoise(x / 2., y / 2., self.seed) - .5)

    def h(self, x, y):
        return self.z - .7 * (x - self.cx)

    def color(self, xc, yc, g):
        r = self.rho(xc, yc)
        if r > .86:
            return BARK[1]                                  # 樹皮の縁
        if abs(yc - self.cy) < .6 and xc > self.cx:
            return BARK[0]                                  # 放射状のひび
        return ('#8f5e3a', '#dcc185', '#b07d4a', '#dcc185')[min(3, int(r * 4.4))]   # 髄 → 年輪 3 本


def rasterize(prims):
    """各画素で key = 高さ + bias·y が最大の図形が勝つ（手前ほど有利）。grid[y][x] = (key, 図形, 高さ) か None。孤立した 1px は消す。"""
    grid = [[None] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            best = None
            for p in prims:
                if p.inside(x + .5, y + .5):
                    h = p.h(x + .5, y + .5)
                    if best is None or h + p.bias * (y + .5) > best[0]:
                        best = (h + p.bias * (y + .5), p, h)
            grid[y][x] = best
    for _ in range(2):
        for y in range(H):
            for x in range(W):
                if grid[y][x] and sum(1 for dx, dy in N4 if 0 <= x + dx < W and 0 <= y + dy < H and grid[y + dy][x + dx]) < 2:
                    grid[y][x] = None
    return grid


def grad(p, x, y):
    e = .5
    return math.hypot((p.h(x + e, y) - p.h(x - e, y)) / (2 * e), (p.h(x, y + e) - p.h(x, y - e)) / (2 * e))


def albedo_hex(grid, x, y):
    """固有色のみ。暗くするのは輪郭（どの向きも同じ）と、自分より key がかなり高い別の図形に接する画素だけ。"""
    k, p, _ = grid[y][x]
    if any(not (0 <= x + dx < W and 0 <= y + dy < H and grid[y + dy][x + dx]) for dx, dy in N4):
        return p.out
    for dx, dy in N4:
        nk, q, _ = grid[y + dy][x + dx]
        if q is not p and nk - k >= p.gap:
            return p.occ
    return p.color(x + .5, y + .5, grad(p, x + .5, y + .5))


def project_rows(grid):
    alb, nrm, hgt, rgbs = [], [], [], []
    for y in range(H):
        a, n, g = [], [], []
        for x in range(W):
            if not grid[y][x]:
                a.append('.'); n.append('.'); g.append('.')
                continue
            _, p, h = grid[y][x]
            hexv = albedo_hex(grid, x, y)
            ni = normal_index(p, x + .5, y + .5)
            emit = hasattr(p, 'emit') and p.emit(x + .5, y + .5)
            hi = min(len(HEIGHT_COLORS) - 1, max(0, round(h / 2)))
            a.append(SYMBOL_OF[hexv]); n.append(SYMBOLS[EMIT if emit else ni]); g.append(SYMBOLS[hi])
            rgbs.append((x, y, tuple(int(hexv[i:i + 2], 16) for i in (1, 3, 5)), ni, hi * 2, emit))
        alb.append(''.join(a)); nrm.append(''.join(n)); hgt.append(''.join(g))
    return alb, nrm, hgt, rgbs


# ---- 各フレームの形 ----
def rock(v):
    """4つの岩 + 小石。v=1 は左右を入れ替えた別の乱数（minerals の rock と nature_props の rock を同じにしない）。"""
    s, m = 100 + 50 * v, (lambda x: 64 - x) if v else (lambda x: x)
    return [Stone(m(27), 36, 15, 11, [1, .9, 1.05, .88, 1, .92, 1.03, .9], 12, s + 1, 0, .34),
            Stone(m(45), 40, 9, 7, [1, .88, 1.02, .9, 1, .94, 1.04], 7, s + 2, 1, .2),
            Stone(m(13), 41, 8, 6, [.95, 1.04, .9, 1, .88, 1.02], 6, s + 3, 2, .12),
            Stone(m(38), 31, 8, 7, [1, .92, 1.04, .88, 1, .95, 1.02, .9], 10, s + 4, 0, .3),
            Stone(m(51), 45, 4, 3, [1, .9, 1.05, .92, 1], 3.5, s + 5, 1)]


def ore_rock(ore, s):
    """宿主の岩 3つ（鉱脈が走る）+ 鉱石の露頭 2つ（ほぼ全面が鉱石で、宿主の筋が少し残る）。"""
    vein = dict(ore, vw=.05, solid=False)
    outcrop = dict(ore, vw=.3, solid=True)
    return [Stone(27, 37, 14, 10, [1, .9, 1.04, .88, 1, .93, 1.03, .9], 10, s + 1, 0, .28, vein),
            Stone(44, 41, 9, 6.5, [1, .9, 1.03, .88, 1, .95], 6.5, s + 2, 1, .14, dict(vein, vw=.06)),
            Stone(13, 42, 8, 5.5, [.95, 1.04, .9, 1, .88, 1.02], 5, s + 3, 0, .1),
            Stone(36, 31, 8, 6.5, [1, .9, 1.04, .88, 1, .94, 1.02], 11, s + 4, 0, 0., outcrop, 2.),
            Stone(23, 43, 5, 3.5, [1, .9, 1.04, .92, 1], 4.5, s + 5, 0, 0., outcrop)]


def crystal_cluster():
    return [Stone(28, 40, 15, 8, [1, .9, 1.04, .88, 1, .93, 1.03, .9], 7, 401, 1, .3),
            Stone(44, 42, 10, 6, [1, .9, 1.03, .88, 1, .95], 5, 402, 0, .2),
            Stone(15, 43, 8, 5, [.95, 1.04, .9, 1, .88, 1.02], 4, 403, 1, .15),
            Crystal(23, 44, 15, 28, 3.2, 5, 411), Crystal(38, 44, 46, 24, 3.4, 5, 412), Crystal(30, 43, 28, 15, 4.2, 5, 413),
            Crystal(44, 45, 52, 35, 2.4, 4, 414), Crystal(20, 45, 23, 33, 2.2, 4, 415)]


def plant(seed, dome, stems, berries=(), lens=(9., 8.2, 7.4), width=2.6):
    """枝（カプセル）ごとに、3組の対の葉と先端の1枚。枝ごとに顔料の族が1つで、葉の群として読める。実は葉より上に出る。"""
    rng = random.Random(seed)
    out = []
    for i, (tx, ty, fam) in enumerate(stems):
        bx, by = 32 + (tx - 32) * .15 + rng.uniform(-2, 2), 45.5 - rng.random() * 1.5
        L = math.hypot(tx - bx, ty - by)
        ux, uy = (tx - bx) / L, (ty - by) / L
        out.append(Rod('twig', [(bx, by, 1.1, dome(bx, by) - .3), (tx, ty, .7, dome(tx, ty) - .3)], seed + i))
        for k, t in enumerate((.3, .52, .74)):
            px, py = bx + ux * L * t, by + uy * L * t
            for side in (-1, 1):
                a = math.atan2(uy, ux) + side * math.radians(52 + 10 * rng.random())
                out.append(Leaf(px, py, px + lens[k] * math.cos(a), py + lens[k] * math.sin(a), width, GREENS[fam],
                                ((i * 3 + k * 2 + (side > 0)) % 4) * 1.5, seed + 10 * i + 2 * k + (side > 0), dome))
        a = math.atan2(uy, ux) + rng.uniform(-.15, .15)
        out.append(Leaf(tx, ty, tx + lens[0] * math.cos(a), ty + lens[0] * math.sin(a), width + .2, GREENS[fam],
                        (i % 4) * 1.5, seed + 10 * i + 9, dome))
    for j, (cx, cy) in enumerate(berries):
        out.append(Berry(cx, cy, 1.8, dome(cx, cy) + 5.5, '#934f3f', seed + 200 + j))
    return out


def berry_bush():
    dome = Dome(32, 34, 24, 15, 2, 12)
    stems = [(17, 35, 0), (24, 29, 1), (32, 26, 0), (40, 29, 2), (47, 35, 0), (32, 36, 1), (22, 40, 2), (42, 40, 1)]
    berries = [(23, 40), (27, 34), (37, 31), (39, 37), (34, 41), (45, 39)]
    return [LeafMass(dome)] + plant(500, dome, stems, berries)


def leaf_bush():
    dome = Dome(32, 34, 24, 14, 2, 11)
    stems = [(15, 37, 0), (22, 31, 1), (29, 27, 0), (36, 26, 2), (43, 30, 0), (49, 36, 1), (26, 38, 2), (38, 38, 0)]
    return plant(600, dome, stems, lens=(9.5, 8.6, 7.8), width=2.8)


def smallrock0():
    return [Mat(32, 45, 17, 4, 701), Stone(26, 42, 8, 5, [1, .9, 1.04, .9, 1, .94], 5, 702, 0, .25, z0=.8),
            Stone(37, 43, 7, 4.5, [1, .92, 1.04, .88, 1, .95], 4.5, 703, 2, .1, z0=.8), Stone(32, 45.5, 3, 2.2, [1, .9, 1.05, .92, 1], 2.4, 704, 1, z0=.8)]


def smallrock1():
    return [Stone(32, 42, 9, 6, [1, .9, 1.04, .88, 1, .94, 1.02], 6, 801, 0, .15), Stone(43, 46, 3.2, 2.2, [1, .9, 1.05, .92, 1], 2.4, 802, 1)]


def log():
    r, yc, xe = 8, 40, 47
    return [Rod('log', [(13, yc, r, r), (xe, yc, r, r)], 301, xmax=xe, moss=.28), Rod('twig', [(21, 33, 2.1, 6.5), (19, 26, 1.5, 8.2)], 302),
            EndDisc(xe, yc, 5, .96 * r, r + 1.3, 303)]


FRAMES = {'minerals': {'rock': lambda: rock(0), 'copper': lambda: ore_rock(COPPER, 200), 'iron': lambda: ore_rock(IRON, 300), 'crystal': crystal_cluster},
          'nature_props': {'rock': lambda: rock(1), 'berry': berry_bush, 'bush': leaf_bush, 'smallrock0': smallrock0, 'smallrock1': smallrock1, 'log': log}}


def check_convex():
    """全ての Stone の面が3つ以上あること（hull の退化で消えていない）を確かめる。"""
    for sheet, frames in FRAMES.items():
        for name, make in frames.items():
            for p in make():
                if isinstance(p, Stone) and len(p.edges) < 4:
                    raise SystemExit(f'{sheet}/{name}: 面が {len(p.edges)} しかない岩があります（radii を見直す）')


# ---- 書き出し ----
def lightbox(frames_rgbs):
    """確認用。朝（右光）と夕（左光）の2段。shader と同じ形の式で、法線は量子化後のベクトル。"""
    suns, n = (demo._dir(17), demo._dir(163)), len(frames_rgbs)
    cols = min(n, 4)
    groups = math.ceil(n / cols)
    native = [[None] * (W * cols) for _ in range(2 * H * groups)]
    for i, rgbs in enumerate(frames_rgbs):
        for row, sun in enumerate(suns):
            for x, y, rgb, ni, _, _ in rgbs:
                native[(row * groups + i // cols) * H + y][(i % cols) * W + x] = demo.lit(rgb, VECTORS[ni], sun, False)
    return demo.raster_project(native)


def report(sheet, name, rgbs, rows3):
    ls = [demo.lstar(r[2]) for r in rgbs]
    worst = max(abs(demo.corr(ls, [VECTORS[r[3]][0] * math.cos(a) + VECTORS[r[3]][1] * math.sin(a) for r in rgbs]))
                for a in (k * math.pi / 4 for k in range(8)))
    xs, ys = [r[0] for r in rgbs], [r[1] for r in rgbs]
    print(f'[{sheet}/{name}] px {len(rgbs)}  bbox x {min(xs)}..{max(xs)} y {min(ys)}..{max(ys)}  albedo colors {len({r[2] for r in rgbs})}  '
          f'normals {len({r[3] for r in rgbs})}  emit px {sum(1 for r in rgbs if r[5])}  height {min(r[4] for r in rgbs)}..{max(r[4] for r in rgbs)}  '
          f'|r(L*, horizontal N)| max {worst:.3f}  alpha match {len({tuple(c == "." for row in rows for c in row) for rows in rows3}) == 1}')


def preflight(sheet):
    """既存の manifest / atlas の名前・順・大きさ・pivot・枠・タグを読む。違えば何も書かずに止まる。"""
    manifest = json.loads((GAME / 'assets/manifest.json').read_text(encoding='utf-8'))['sheets'][sheet]
    old = json.loads((GAME / 'assets' / manifest['atlas']).read_text(encoding='utf-8'))
    names = NAMES[sheet]
    frames = list(old['frames'].values())
    if manifest['names'] != names or list(old['frames']) != names:
        raise SystemExit(f'{sheet}: フレーム名・順が既存と違います')
    if list(manifest['pivot']) != list(PIVOT) or list(old['meta']['pivot']) != list(PIVOT):
        raise SystemExit(f'{sheet}: pivot が既存と違います')
    if any((f['frame']['w'], f['frame']['h']) != (W, H) or f['trimmed'] or f['rotated'] for f in frames):
        raise SystemExit(f'{sheet}: 枠の大きさ・trim が {W}x{H} 固定と違います')
    if old['meta']['size']['w'] % W or old['meta']['size']['h'] % H:
        raise SystemExit(f'{sheet}: atlas の大きさが枠の倍数ではありません')
    for key in ('normal', 'height'):
        if not (GAME / 'assets' / manifest[key]).exists():
            raise SystemExit(f'{sheet}: manifest の {key} 画像がありません')
    tags = [None] * len(names)
    for t in old['meta']['frameTags']:
        for i in range(t['from'], t['to'] + 1):
            tags[i] = t['name']
    return old, [f['duration'] for f in frames], tags, old['meta']['size']['w'] // W


def integrate(sheet, old):
    root = REVIEW / sheet
    new = json.loads((root / 'albedo/atlas.json').read_text(encoding='utf-8'))
    if new['frames'] != old['frames'] or list(new['frames']) != list(old['frames']) or \
            any(new['meta'][k] != old['meta'][k] for k in ('size', 'pivot', 'frameTags')):
        raise SystemExit(f'{sheet}: 新しい atlas.json が既存の枠・タグ・pivot・大きさと違うため、何も置き換えません')
    for key in ('normal', 'height'):
        n2 = json.loads((root / key / 'atlas.json').read_text(encoding='utf-8'))
        if list(n2['frames']) != list(old['frames']) or n2['meta']['size'] != old['meta']['size']:
            raise SystemExit(f'{sheet}: {key} の atlas が既存の枠・大きさと違うため、何も置き換えません')
    dst = GAME / 'assets' / sheet
    return [(root / 'albedo.json', GAME / f'art/{sheet}.json'), (root / 'normal.json', GAME / f'art/normalmaps/{sheet}-normal.json'),
            (root / 'height.json', GAME / f'art/normalmaps/{sheet}-height.json'), (root / 'albedo/atlas.png', dst / 'atlas.png'),
            (root / 'albedo/atlas.json', dst / 'atlas.json'), (root / 'normal/atlas.png', dst / 'normal.png'),
            (root / 'height/atlas.png', dst / 'height.png')]


def build(sheet, old, durations, tags, cols):
    names = NAMES[sheet]
    built = []
    for n in names:
        grid = rasterize(FRAMES[sheet][n]())
        built.append(project_rows(grid))
    for b in built:   # 3つの alpha 形は同一でなければならない
        if len({tuple(c == '.' for r in rows for c in r) for rows in b[:3]}) != 1:
            raise SystemExit(f'{sheet}: albedo/normal/height の alpha が一致しません')
    lines = header((W, H), PIVOT)
    for n, b in zip(names, built):
        part(lines, n, b[0])
    for i, n in enumerate(names):
        frame(lines, n, [(n, 0, 0)], duration=durations[i], tag=tags[i])
    stub = {'size': [W, H], 'pivot': list(PIVOT), 'frames': [{'name': n, 'duration': d} for n, d in zip(names, durations)]}
    projects = {'albedo': Editor().apply('\n'.join(lines)), 'normal': project_lines(stub, NORMAL_COLORS, [b[1] for b in built]),
                'height': project_lines(stub, HEIGHT_COLORS, [b[2] for b in built])}
    root = REVIEW / sheet
    root.mkdir(parents=True, exist_ok=True)
    for key, project in projects.items():
        check(project)
        save(project, root / f'{key}.json')
        print(sheet, key, 'warnings:', export(project, root / key, columns=cols)['warnings'])
    lb = lightbox([b[3] for b in built])
    check(lb)
    export(lb, root / 'lit', columns=1)
    for n, b in zip(names, built):
        report(sheet, n, b[3], b[:3])


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', action='append', choices=list(NAMES))
    ap.add_argument('--integrate', action='store_true')
    args = ap.parse_args()
    sheets = args.sheet or list(NAMES)
    check_convex()
    meta = {s: preflight(s) for s in sheets}   # 何かを書く前に、全シートの既存メタデータを確認
    for s in sheets:
        build(s, *meta[s])
    if args.integrate:
        jobs = [j for s in sheets for j in integrate(s, meta[s][0])]   # 全シートの検査が通ってから置き換える
        for src, dst in jobs:
            shutil.copyfile(src, f'{dst}.tmp')
        for src, dst in jobs:
            os.replace(f'{dst}.tmp', dst)
        print('integrated:', *(str(d.relative_to(GAME)) for _, d in jobs), sep='\n  ')


if __name__ == '__main__':
    main()
