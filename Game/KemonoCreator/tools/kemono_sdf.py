# -*- coding: utf-8 -*-
"""ケモノ男性ボディの SDF 定義。

体はプリミティブ（楕円体・ラウンドコーン）のスムーズ和で表す。
パラメータ dict -> (プリミティブ列, 関節位置) を返す build() が中心。
同じプリミティブ列をパラメータ違いで作れば、プリミティブごとのアフィン対応が取れるので
「基準メッシュの頂点 -> 変形後の頂点」をきれいに求められる（モーフターゲット生成に使う）。

座標系: Y 上, Z 前（キャラの正面）, X はキャラの左手側。単位はメートル。
"""
import numpy as np

# ---------------------------------------------------------------- utils

def nrm(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


def frame_from(w, up_hint=(0.0, 1.0, 0.0)):
    """w を第3軸とする正規直交フレーム (列: u, v, w)。"""
    w = nrm(w)
    up = np.asarray(up_hint, dtype=np.float64)
    if abs(np.dot(up, w)) > 0.95:
        up = np.array([1.0, 0.0, 0.0]) if abs(w[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
    u = nrm(np.cross(up, w))
    v = np.cross(w, u)
    return np.stack([u, v, w], axis=1)


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


# ---------------------------------------------------------------- primitives

class Prim:
    name = ''
    k = 0.02          # スムーズ和の半径
    bones = None      # {bone: weight}
    group = ''        # マスク用グループ
    sub = False       # True なら引き算（smax）

    def local(self, P):
        raise NotImplementedError


class Ellipsoid(Prim):
    def __init__(self, name, c, r, R=None, k=0.02, bones=None, group=''):
        self.name, self.c, self.r = name, np.asarray(c, float), np.maximum(np.asarray(r, float), 1e-4)
        self.R = np.eye(3) if R is None else np.asarray(R, float)
        self.k, self.bones, self.group = k, bones or {}, group

    def sdf(self, P):
        q = (P - self.c) @ self.R
        k0 = np.linalg.norm(q / self.r, axis=1)
        k1 = np.linalg.norm(q / (self.r * self.r), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

    def map_to(self, other, P):
        q = (P - self.c) @ self.R
        q = q / self.r * other.r
        return other.c + q @ other.R.T


class RoundCone(Prim):
    """a->b のラウンドコーン。sq=(sx, sy) で軸に垂直な断面を楕円に潰す。"""

    def __init__(self, name, a, b, ra, rb, sq=(1.0, 1.0), up=(0, 1, 0), k=0.02, bones=None, group=''):
        self.name = name
        self.a, self.b = np.asarray(a, float), np.asarray(b, float)
        self.ra, self.rb = float(max(ra, 1e-4)), float(max(rb, 1e-4))
        self.sq = np.asarray(sq, float)
        self.F = frame_from(self.b - self.a, up)
        self.L = float(np.linalg.norm(self.b - self.a))
        self.k, self.bones, self.group = k, bones or {}, group

    def sdf(self, P):
        q = (P - self.a) @ self.F            # (u, v, w)
        q = q / np.array([self.sq[0], self.sq[1], 1.0])
        s = min(self.sq[0], self.sq[1], 1.0)
        # iq round cone, a=0, b=(0,0,L)
        L = max(self.L, 1e-6)
        r1, r2 = self.ra, self.rb
        l2 = L * L
        rr = r1 - r2
        a2 = l2 - rr * rr
        il2 = 1.0 / l2
        y = q[:, 2] * L
        z = y - l2
        x2 = (q[:, 0] ** 2 + q[:, 1] ** 2) * l2 * l2
        y2 = y * y * l2
        z2 = z * z * l2
        kk = np.sign(rr) * rr * rr * x2
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
        d1 = np.sqrt(x2 + z2) * il2 - r2
        d2 = np.sqrt(x2 + y2) * il2 - r1
        d = np.where(np.sign(z) * a2 * z2 > kk, d1, np.where(np.sign(y) * a2 * y2 < kk, d2, d3))
        return d * s

    def map_to(self, o, P):
        q = (P - self.a) @ self.F
        t = q[:, 2] / max(self.L, 1e-6)
        tc = np.clip(t, 0.0, 1.0)
        r0 = self.ra + (self.rb - self.ra) * tc
        r1 = o.ra + (o.rb - o.ra) * tc
        sc = (r1 / r0)
        u = q[:, 0] * sc * (o.sq[0] / self.sq[0])
        v = q[:, 1] * sc * (o.sq[1] / self.sq[1])
        w = np.where(t < 0, q[:, 2] * (o.ra / self.ra),
                     np.where(t > 1, o.L + (q[:, 2] - self.L) * (o.rb / self.rb), t * o.L))
        return o.a + np.stack([u, v, w], axis=1) @ o.F.T



class TaperBox(Prim):
    """先細りの角丸ボックス。a から b へ伸び、断面の半幅が (wx0,wy0) -> (wx1,wy1) と変わる。
    マズルのように「側面と上面が平らで先が鈍い」形に使う。"""

    def __init__(self, name, a, b, w0, w1, r, up=(0, 1, 0), k=0.02, bones=None, group=''):
        self.name = name
        self.a, self.b = np.asarray(a, float), np.asarray(b, float)
        self.w0, self.w1 = np.asarray(w0, float), np.asarray(w1, float)
        self.r = float(r)
        self.F = frame_from(self.b - self.a, up)
        self.L = float(np.linalg.norm(self.b - self.a))
        self.k, self.bones, self.group = k, bones or {}, group

    def _hw(self, t):
        t = np.clip(t, 0.0, 1.0)[:, None]
        return self.w0[None, :] * (1 - t) + self.w1[None, :] * t

    def sdf(self, P):
        q = (P - self.a) @ self.F
        t = q[:, 2] / max(self.L, 1e-6)
        hw = self._hw(t)
        r = np.minimum(self.r, hw.min(axis=1) * 0.95)
        dx = np.abs(q[:, 0]) - hw[:, 0] + r
        dy = np.abs(q[:, 1]) - hw[:, 1] + r
        dz = np.abs(q[:, 2] - self.L * 0.5) - self.L * 0.5 + r
        m = np.stack([dx, dy, dz], axis=1)
        out = np.linalg.norm(np.maximum(m, 0.0), axis=1) + np.minimum(m.max(axis=1), 0.0) - r
        return out * 0.9

    def map_to(self, o, P):
        q = (P - self.a) @ self.F
        t = q[:, 2] / max(self.L, 1e-6)
        h0, h1 = self._hw(t), o._hw(t)
        u = q[:, 0] * h1[:, 0] / h0[:, 0]
        v = q[:, 1] * h1[:, 1] / h0[:, 1]
        w = np.where(t < 0, q[:, 2], np.where(t > 1, o.L + (q[:, 2] - self.L), t * o.L))
        return o.a + np.stack([u, v, w], axis=1) @ o.F.T



def _pchip(zs, vs, z):
    from scipy.interpolate import PchipInterpolator
    return PchipInterpolator(zs, vs, extrapolate=True)(z)


class Loft(Prim):
    """頭の土台: 前後方向 (z) に並べた断面（上下で幅の違う超楕円）をなめらかにつないだ形。
    横顔の上の線 yt(z)・下の線 yb(z)、上半分の幅 wt(z)・下半分の幅 wb(z)、角張り n(z) を
    共通の節点 Z で与える。頭ローカル座標（H を原点、hsz 倍、x は hw 倍）で定義する。"""

    def __init__(self, name, H, hsz, hw, Z, yt, yb, wt, wb, ne, k=0.03, bones=None, group=''):
        self.name = name
        self.H, self.hsz, self.hw = np.asarray(H, float), float(hsz), float(hw)
        self.Z = np.asarray(Z, float)
        self.cv = {k_: np.asarray(v, float) for k_, v in dict(yt=yt, yb=yb, wt=wt, wb=wb, ne=ne).items()}
        self.k, self.bones, self.group = k, bones or {}, group

    def _f(self, key, z):
        return _pchip(self.Z, self.cv[key], z)

    def _local(self, P):
        q = (P - self.H) / self.hsz
        return q[:, 0] / self.hw, q[:, 1], q[:, 2]

    def _sec(self, z):
        zc = np.clip(z, self.Z[0], self.Z[-1])
        yt, yb = self._f('yt', zc), self._f('yb', zc)
        return zc, yt, yb, self._f('wt', zc), self._f('wb', zc), self._f('ne', zc)

    def sdf(self, P):
        x, y, z = self._local(P)
        zc, yt, yb, wt, wb, ne = self._sec(z)
        yc, h = (yt + yb) * 0.5, np.maximum((yt - yb) * 0.5, 1e-4)
        t = (y - yc) / h
        s_ = np.clip((t + 0.45) / 0.9, 0, 1)
        w = np.maximum(wb + (wt - wb) * (s_ * s_ * (3 - 2 * s_)), 1e-4)
        r = (np.abs(x / w) ** ne + np.abs(t) ** ne) ** (1.0 / ne)
        d2 = (r - 1.0) * np.minimum(w, h) * 0.85
        dz = np.maximum(self.Z[0] - z, z - self.Z[-1])     # 前後の端までの符号付き距離（内側は負）
        out = np.sqrt(np.maximum(d2, 0) ** 2 + np.maximum(dz, 0) ** 2) + np.minimum(np.maximum(d2, dz), 0)
        return out * self.hsz * min(1.0, self.hw)

    def map_to(self, o, P):
        x, y, z = self._local(P)
        z2 = np.interp(z, self.Z, o.Z, left=np.nan, right=np.nan)
        z2 = np.where(z < self.Z[0], o.Z[0] + (z - self.Z[0]), z2)
        z2 = np.where(z > self.Z[-1], o.Z[-1] + (z - self.Z[-1]), z2)
        _, yt, yb, wt, wb, _ = self._sec(z)
        _, yt2, yb2, wt2, wb2, _ = o._sec(z2)
        yc, h = (yt + yb) * 0.5, np.maximum((yt - yb) * 0.5, 1e-4)
        yc2, h2 = (yt2 + yb2) * 0.5, (yt2 - yb2) * 0.5
        t = (y - yc) / h
        s_ = np.clip((t + 0.45) / 0.9, 0, 1)
        sm = s_ * s_ * (3 - 2 * s_)
        w = wb + (wt - wb) * sm
        w2 = wb2 + (wt2 - wb2) * sm
        x2 = x * w2 / np.maximum(w, 1e-4)
        y2 = yc2 + t * h2
        loc = np.stack([x2 * o.hw, y2, z2], axis=1) * o.hsz
        return o.H + loc


def eval_union(prims, P, return_all=False):
    d = None
    D = [] if return_all else None
    for p in prims:
        di = p.sdf(P)
        if return_all:
            D.append(di)
        if d is None:
            d = di
        elif p.sub:
            d = smax(d, -di, p.k)
        else:
            d = smin(d, di, p.k)
    if return_all:
        return d, np.stack(D, axis=1)
    return d


# ---------------------------------------------------------------- parameters

DEFAULTS = dict(
    # 体
    legLen=0.0, torsoLen=0.0, armLen=0.0, shoulderW=0.0, chest=0.0, muscle=0.0, fat=0.0,
    belly=0.0, waist=0.0, hipW=0.0, armThick=0.0, legThick=0.0, neckThick=0.0, neckLen=0.0,
    handSize=0.0, footSize=0.0, pecs=0.0, glutes=0.0, calf=0.0, digi=0.0, bulk=0.0, traps=0.0, socket=0.0,
    # 頭
    headSize=0.0, headW=0.0, craniumH=0.0, cheek=0.0, jaw=0.0, stop=0.0, brow=0.0, forehead=0.0,
    # マズル
    muzLen=0.0, muzW=0.0, muzH=0.0, muzDrop=0.0, muzTaper=0.0, jawLen=0.0, padSize=0.0, bridge=0.0,
)

ARM_ANGLE = np.radians(50.0)   # Aポーズの腕の下がり角


def build(params=None):
    """params（-1..1 の値, DEFAULTS 参照）からプリミティブ列と関節を作る。"""
    p = dict(DEFAULTS)
    if params:
        p.update(params)
    g = lambda k: p[k]

    prims = []
    J = {}

    def E(name, c, r, R=None, k=0.025, bones=None, group='', sub=False):
        e = Ellipsoid(name, c, r, R, k, bones, group)
        e.sub = sub
        prims.append(e)

    def C(name, a, b, ra, rb, sq=(1, 1), up=(0, 1, 0), k=0.025, bones=None, group=''):
        prims.append(RoundCone(name, a, b, ra, rb, sq, up, k, bones, group))

    def TB(name, a, b, w0, w1, r, up=(0, 1, 0), k=0.02, bones=None, group=''):
        prims.append(TaperBox(name, a, b, w0, w1, r, up, k, bones, group))

    fat = max(g('fat'), 0.0) - 0.35 * max(-g('fat'), 0.0)
    mus = g('muscle')
    musP = max(mus, 0.0)
    bw = 1.0 + 0.12 * g('bulk')          # 体格（骨太さ・胴の厚み）

    # ---------------- skeleton
    legL = 1.0 + 0.12 * g('legLen')
    torsoL = 1.0 + 0.12 * g('torsoLen')
    armL = 1.0 + 0.12 * g('armLen')
    shW = 1.0 + 0.14 * g('shoulderW')
    hipW = 1.0 + 0.14 * g('hipW')
    digi = max(g('digi'), 0.0)

    Lt, Ls = 0.42 * legL, 0.41 * legL
    hipY = 0.085 + 0.83   # 腰の高さは固定し、脚の長さは足元側へ伸ばす（接地は JS 側で合わせる）
    ankleY = hipY - Lt - Ls + 0.06 * digi
    J['sole'] = np.array([0.0, ankleY - 0.085, 0.0])
    J['hips'] = np.array([0.0, hipY + 0.04, -0.005])
    J['spine'] = J['hips'] + np.array([0, 0.13 * torsoL, 0.005])
    J['chest'] = J['spine'] + np.array([0, 0.20 * torsoL, -0.01])
    J['neck'] = J['chest'] + np.array([0, 0.20 * torsoL, -0.005])
    nl = g('neckLen')
    neckL = 0.085 * (1.0 + (0.35 if nl > 0 else 0.25) * nl)
    J['head'] = J['neck'] + np.array([0, neckL, 0.02])

    for side, sx in (('L', 1.0), ('R', -1.0)):
        sh = np.array([sx * (0.185 * shW + 0.03 + 0.022 * max(g('muscle'), 0.0) + 0.02 * max(g('fat'), 0.0) + 0.012 * g('bulk')), J['neck'][1] - 0.05, -0.015])
        J['clav.' + side] = np.array([sx * 0.03, J['neck'][1] - 0.03, 0.01])
        J['upperarm.' + side] = sh
        dirA = np.array([sx * np.cos(ARM_ANGLE), -np.sin(ARM_ANGLE), 0.0])
        el = sh + dirA * 0.29 * armL + np.array([0, 0, -0.02])
        wr = el + dirA * 0.26 * armL + np.array([0, 0, 0.015])
        J['forearm.' + side] = el
        J['hand.' + side] = wr
        hip = np.array([sx * (0.095 * hipW + 0.03 * max(g('fat'), 0.0) + 0.012 * max(g('muscle'), 0.0) + 0.01 * max(g('legThick'), 0.0) + 0.008 * max(g('bulk'), 0.0)), hipY, 0.0])
        J['thigh.' + side] = hip
        if digi > 0:
            kn = hip + np.array([sx * 0.012, -Lt, 0.03 + 0.06 * digi])
            an = kn + np.array([sx * 0.005, -Ls * 0.62, -0.03 - 0.12 * digi])
        else:
            kn = hip + np.array([sx * 0.012, -Lt, 0.015])
            an = kn + np.array([sx * 0.004, -Ls, -0.03])
        J['shin.' + side] = kn
        J['foot.' + side] = an

    # ---------------- torso
    T = lambda n: {n: 1.0}
    chestS = 1.0 + 0.12 * g('chest')
    waist = 1.0 + 0.15 * g('waist')
    E('pelvis', J['hips'] + [0, -0.03, -0.012], np.array([0.150 * hipW * bw, 0.112, 0.100 * bw]) + fat * np.array([0.075, 0.03, 0.07]),
      k=0.06, bones=T('hips'))
    glS = 1.0 + 0.12 * g('glutes') + 0.25 * fat + 0.12 * musP
    for sx in (1, -1):
        E('glute', J['hips'] + [sx * 0.064 * hipW, -0.055, -0.068 - 0.01 * fat], np.array([0.074, 0.085, 0.052]) * glS,
          R=rot_x(0.2), k=0.06, bones={'hips': 0.8, 'thigh.' + ('L' if sx > 0 else 'R'): 0.2})
    E('abdomen', J['spine'] + [0, -0.01, 0.0], np.array([0.138 * waist * bw + 0.008 * musP, 0.14 * torsoL, 0.095 * bw]) + fat * np.array([0.07, 0.01, 0.08]),
      k=0.07, bones=T('spine'))
    bel = min(1.6, max(g('belly'), 0.0) + 0.9 * fat)
    E('belly', J['spine'] + [0, -0.03 - 0.025 * bel, 0.02 + 0.05 * bel], np.array([0.12 + 0.07 * bel, 0.11 + 0.05 * bel, 0.07 + 0.075 * bel]) * (0.6 + 0.25 * bel),
      k=0.1, bones=T('spine'))
    for sx in (1, -1):   # 脇腹の肉（肉づき）
        E('loveHandle', J['spine'] + [sx * (0.1 + 0.03 * fat), -0.04, -0.005], np.array([0.05, 0.065, 0.075]) * (0.45 + 0.9 * max(fat, 0.0)),
          k=0.06, bones=T('spine'))
    E('ribcage', J['chest'] + [0, 0.02, -0.012], np.array([0.172 * chestS * (0.92 + 0.08 * shW) * bw + 0.012 * musP, 0.18 * torsoL, 0.118 * chestS * bw + 0.01 * musP]) + fat * np.array([0.06, 0.01, 0.065]),
      k=0.07, bones=T('chest'))
    pecS = 1.0 + 0.75 * musP + 0.2 * g('pecs') + 0.35 * fat
    for sx in (1, -1):
        E('pec', J['chest'] + [sx * (0.074 + 0.008 * musP), 0.07 - 0.018 * fat, 0.055 + 0.022 * (pecS - 1)],
          np.array([0.088, 0.062, 0.042]) * pecS * np.array([1, 1, 0.92]), R=rot_z(sx * 0.2) @ rot_x(0.15 + 0.1 * fat), k=0.05, bones=T('chest'))
        # 広背筋（背中の逆三角形）
        E('lat', J['chest'] + [sx * 0.105 * bw, -0.035, -0.04], np.array([0.05, 0.12, 0.06]) * (0.75 + 0.55 * musP + 0.2 * fat),
          R=rot_z(-sx * 0.25), k=0.06, bones=T('chest'))
    # 腹筋（muscle>0 で浮き出る）
    absS = 0.75 + 0.3 * musP
    for i, yy in enumerate((0.06, 0.0, -0.06)):
        for sx in (1, -1):
            E('abs', J['spine'] + [sx * 0.032, yy + 0.02, 0.07 + 0.012 * musP - 0.016 * (1 - musP) + 0.05 * fat],
              np.array([0.033 * absS, 0.028 * absS, 0.018 + 0.004 * musP]), k=0.03, bones=T('spine'))
    # 首・僧帽筋
    nT = 1.0 + 0.18 * g('neckThick') + 0.35 * musP + 0.45 * fat + 0.08 * g('bulk')
    C('neck', J['neck'] + [0, -0.05, -0.012], J['head'] + [0, 0.03, 0.0], 0.074 * nT, 0.064 * nT, k=0.06,
      bones={'neck': 1.0})
    trS = 1.0 + 0.6 * musP + 0.18 * g('traps') + 0.15 * fat
    for side, sx in (('L', 1), ('R', -1)):
        sh = J['upperarm.' + side]
        C('trap', J['neck'] + [0, 0.035 + 0.02 * (trS - 1), -0.04], sh + [-sx * 0.06, 0.02 + 0.012 * (trS - 1), -0.03], 0.05 * nT * (0.85 + 0.15 * trS), 0.044 * trS,
          k=0.07, bones={'neck': 0.3, 'chest': 0.7})
        dS = 1.0 + 0.5 * musP + 0.15 * fat + 0.06 * g('bulk')
        dirA = nrm(J['forearm.' + side] - sh)
        E('deltoid', sh + [sx * (0.004 + 0.01 * musP), 0.006, 0.0] + dirA * 0.025, np.array([0.06, 0.062, 0.075]) * dS,
          R=frame_from(dirA, (0, 0, 1)), k=0.06, bones={'upperarm.' + side: 0.65, 'chest': 0.35})

    # ---------------- arms
    aT = 1.0 + 0.18 * g('armThick') + 0.5 * fat + 0.08 * g('bulk') + 0.18 * musP
    hs = 1.0 + 0.15 * g('handSize')
    for side, sx in (('L', 1), ('R', -1)):
        sh, el, wr = J['upperarm.' + side], J['forearm.' + side], J['hand.' + side]
        ua, fa = 'upperarm.' + side, 'forearm.' + side
        hb = 'hand.' + side
        C('upperarm', sh, el, 0.056 * aT, 0.045 * aT, k=0.04, bones={ua: 1.0})
        d1 = nrm(el - sh)
        bS = 1.0 + 0.8 * musP
        E('biceps', sh + (el - sh) * 0.52 + [0, 0, 0.016], np.array([0.034 * bS * aT, 0.034 * bS * aT, 0.085]),
          R=frame_from(d1, (0, 0, 1)), k=0.03, bones={ua: 1.0})
        E('triceps', sh + (el - sh) * 0.4 + [0, 0, -0.018], np.array([0.032 * aT * (1 + 0.6 * musP), 0.032 * aT * (1 + 0.3 * musP), 0.09]),
          R=frame_from(d1, (0, 0, 1)), k=0.03, bones={ua: 1.0})
        C('forearm', el, wr, 0.047 * aT, 0.033 * aT, k=0.04, bones={fa: 1.0})
        d2 = nrm(wr - el)
        E('forearmM', el + (wr - el) * 0.3 + [0, 0, 0.004], np.array([0.039 * aT * (1 + 0.5 * musP), 0.036 * aT * (1 + 0.3 * musP), 0.085]),
          R=frame_from(d2, (0, 0, 1)), k=0.03, bones={fa: 0.8, ua: 0.2})
        # 手（手のひらは体側・やや下を向く）
        a = d2
        n = nrm(np.array([-sx * np.sin(ARM_ANGLE), -np.cos(ARM_ANGLE), 0.0]))  # 手のひら法線
        n = nrm(n - a * np.dot(n, a))
        z = nrm(np.cross(a, n)) * (1 if sx > 0 else -1)  # 前方向 (+z 付近)
        if z[2] < 0:
            z = -z
        Fh = np.stack([z, n, a], axis=1)  # 列: 幅, 厚み, 長さ
        pc = wr + a * 0.048 * hs
        E('palm', pc, np.array([0.046, 0.022, 0.05]) * hs, R=Fh, k=0.016, bones={hb: 1.0})
        E('palmPad', pc + n * 0.016 * hs + a * 0.006 * hs, np.array([0.028, 0.009, 0.026]) * hs, R=Fh, k=0.012,
          bones={hb: 1.0}, group='pad')
        for i, (off, ln) in enumerate(((0.032, 0.05), (0.011, 0.058), (-0.011, 0.056), (-0.032, 0.048))):
            base = pc + a * 0.036 * hs + z * off * hs * 0.9 + n * 0.002
            fan = z * off * 2.2
            f1 = nrm(a * np.cos(0.3) + n * np.sin(0.3) + fan)
            mid = base + f1 * ln * 0.55 * hs
            f2 = nrm(a * np.cos(0.8) + n * np.sin(0.8) + fan * 0.6)
            tip = mid + f2 * ln * 0.45 * hs
            C('finger', base, mid, 0.0118 * hs, 0.0108 * hs, k=0.007, bones={hb: 1.0})
            C('finger', mid, tip, 0.0108 * hs, 0.0098 * hs, k=0.004, bones={hb: 1.0})
            E('fingerPad', tip + n * 0.006 * hs - f2 * 0.002, np.array([0.0085, 0.0055, 0.0085]) * hs,
              R=frame_from(f2, n), k=0.004, bones={hb: 1.0}, group='pad')
        tb = pc - a * 0.015 * hs + z * 0.036 * hs + n * 0.006 * hs
        td = nrm(a * 0.55 + z * 0.55 + n * 0.45)
        tm = tb + td * 0.03 * hs
        tt = tm + nrm(a * 0.7 + z * 0.2 + n * 0.55) * 0.028 * hs
        C('thumb', tb, tm, 0.0158 * hs, 0.0138 * hs, k=0.015, bones={hb: 1.0})
        C('thumb', tm, tt, 0.0138 * hs, 0.0118 * hs, k=0.008, bones={hb: 1.0})

    # ---------------- legs
    lT = 1.0 + 0.18 * g('legThick') + 0.55 * fat + 0.08 * g('bulk') + 0.12 * musP
    fs = 1.0 + 0.15 * g('footSize')
    cS = 1.0 + 0.25 * g('calf') + 0.45 * musP + 0.15 * fat
    for side, sx in (('L', 1), ('R', -1)):
        hp, kn, an = J['thigh.' + side], J['shin.' + side], J['foot.' + side]
        th, sh, ft = 'thigh.' + side, 'shin.' + side, 'foot.' + side
        C('thigh', hp + [0, 0.01, 0], kn, 0.09 * lT, 0.06 * lT, k=0.06, bones={th: 1.0})
        dT = nrm(kn - hp)
        E('quad', hp + (kn - hp) * 0.45 + [sx * 0.006, 0, 0.022], np.array([0.058 * lT * (1 + 0.45 * musP), 0.055 * lT * (1 + 0.4 * musP), 0.2]),
          R=frame_from(dT, (0, 0, 1)), k=0.035, bones={th: 1.0})
        E('adductor', hp + (kn - hp) * 0.25 + [-sx * 0.03, 0, -0.005], np.array([0.05, 0.05, 0.14]) * lT,
          R=frame_from(dT, (0, 0, 1)), k=0.04, bones={th: 0.8, 'hips': 0.2})
        E('kneecap', kn + [0, 0.01, 0.036], np.array([0.036, 0.04, 0.025]), k=0.03, bones={sh: 0.5, th: 0.5})
        if digi > 0:
            mt = an  # 中足（つま先立ちの“かかと”から先）
            ball = an + np.array([sx * 0.004, -(ankleY - 0.035), 0.09 * (1 - 0.2 * digi)])
            C('shin', kn, an, 0.052 * lT, 0.036 * lT, k=0.03, bones={sh: 1.0})
            C('metatarsal', an, ball, 0.036 * lT, 0.03 * lT, k=0.025, bones={ft: 1.0})
            E('calf', kn + (an - kn) * 0.3 + [0, 0, -0.028], np.array([0.045 * cS, 0.042 * cS, 0.1]),
              R=frame_from(nrm(an - kn), (0, 0, 1)), k=0.03, bones={sh: 1.0})
            footC = ball + np.array([0, 0.0, 0.035])
            E('foot', footC, np.array([0.05, 0.034, 0.06]) * fs, k=0.025, bones={ft: 1.0})
            toeBase = footC + np.array([0, -0.004, 0.035]) * fs
        else:
            C('shin', kn, an, 0.056 * lT, 0.038 * lT, k=0.04, bones={sh: 1.0})
            E('calf', kn + (an - kn) * 0.28 + [0, 0, -0.03], np.array([0.05 * cS, 0.048 * cS, 0.13]),
              R=frame_from(nrm(an - kn), (0, 0, 1)), k=0.035, bones={sh: 1.0})
            E('heel', an + [0, -0.045, -0.022], np.array([0.038, 0.04, 0.042]) * fs, k=0.025, bones={ft: 1.0})
            footC = an + np.array([sx * 0.006, -0.048, 0.065 * fs])
            E('foot', footC, np.array([0.05, 0.037, 0.09]) * fs, k=0.03, bones={ft: 1.0})
            toeBase = footC + np.array([0, -0.004, 0.07]) * fs
        for off in (0.03, 0.01, -0.01, -0.03):
            tp = toeBase + np.array([off * fs + sx * 0.002, 0.0, -abs(off) * 0.4])
            E('toe', tp, np.array([0.016, 0.019, 0.024]) * fs, k=0.012, bones={ft: 1.0})
            E('toePad', tp + np.array([0, -0.014, 0.004]) * fs, np.array([0.011, 0.006, 0.012]) * fs, k=0.006,
              bones={ft: 1.0}, group='pad')
        E('solePad', footC + np.array([0, -0.032, 0.022]) * fs, np.array([0.03, 0.008, 0.026]) * fs, k=0.012,
          bones={ft: 1.0}, group='pad')

    # ---------------- head
    hsz = 1.16 * (1.0 + 0.13 * g('headSize'))
    hw = 1.0 + 0.12 * g('headW')
    H = J['head']

    def hp_(v):  # 頭ローカル -> ワールド
        v = np.asarray(v, float)
        return H + np.array([v[0] * hw, v[1], v[2]]) * hsz

    hb = {'head': 1.0}
    crH = 1.0 + 0.12 * g('craniumH')
    fh = g('forehead')
    ch = 1.0 + 0.2 * g('cheek') + 0.25 * fat
    br = 1.0 + 0.45 * g('brow')
    jw = 1.0 + 0.15 * g('jaw') + 0.25 * fat
    hd = dict(bones=hb, group='head')
    # ---- 頭の土台（ロフト）。節点: 後頭 / 後頭部 / 頭頂 / 額 / 眉骨 / ストップ / マズル中ほど / あご先 / 鼻先手前 / 鼻先
    ml_ = g('muzLen')
    mL = 0.118 * (1.0 + (0.42 if ml_ > 0 else 0.62) * ml_)
    mW = 1.0 + 0.22 * g('muzW')
    mH = 1.0 + 0.2 * g('muzH')
    tap = 1.0 - 0.25 * g('muzTaper')
    jL = 1.0 + 0.2 * g('jawLen')
    pad = 1.0 + 0.25 * g('padSize')
    st = g('stop')
    bh = g('bridge')
    dr = g('muzDrop')
    zS = 0.07
    Z = [-0.118, -0.075, -0.03, 0.024, 0.056, zS, zS + 0.5 * mL, zS + min(0.72 * jL, 0.84) * mL, zS + 0.9 * mL, zS + mL]
    yS = 0.11 - 0.01 * st
    yTip = 0.044 + 0.042 * mH - 0.018 * dr
    yMid = yS + (yTip - yS) * 0.5 + 0.004 * bh
    yCh = yS + (yTip - yS) * min(0.72 * jL, 0.84)
    yt = [0.08, 0.146 * crH, 0.166 * crH, 0.156 + 0.004 * fh, 0.13 + 0.006 * fh, yS, yMid, yCh, yTip, yTip - 0.014]
    ym = 0.046 - 0.012 * dr              # 口の線（上唇の下）の高さ
    yb = [0.062, 0.016, -0.006 - 0.004 * (jw - 1) * 4, -0.004, -0.002, 0.0, 0.003, 0.012 - 0.006 * (jw - 1) * 4, ym - 0.004, ym + 0.004]
    wt = [0.034, 0.07, 0.081, 0.076, 0.066, 0.043 * mW, 0.034 * mW, 0.03 * mW * tap, 0.027 * mW * tap, 0.019 * mW]
    wb = [0.034, 0.062 * jw, 0.071 * ch, 0.07 * ch, 0.066 * ch, 0.058 * (0.5 + 0.5 * mW) * ch, 0.043 * mW * pad, 0.035 * mW * pad * tap, 0.029 * mW * tap, 0.02 * mW]
    ne = [2.2, 2.2, 2.2, 2.3, 2.3, 2.4, 2.7, 2.8, 2.7, 2.4]
    prims.append(Loft('skull', H, hsz, hw, Z, yt, yb, wt, wb, ne, k=0.03, bones=hb, group='head'))
    # ---- 目の面: 眉骨の下〜頬骨の上を、広く浅く平らに削る（目の絵がゆがまない）
    sdep = 0.0042 * hsz * (1.0 + 0.6 * g('socket'))
    sthk = 0.022 * hsz
    for side, sx in (('L', 1), ('R', -1)):
        a = np.radians(30.0)
        n = nrm(np.array([sx * np.sin(a) / hw, 0.06, np.cos(a)]))
        c = hp_([sx * 0.045, 0.092, 0.05])
        q0 = c + n * 0.1
        for _ in range(80):
            q0 = q0 - n * eval_union(prims, q0[None])[0]
        Rv = nrm(np.cross([0.0, 1.0, 0.0], n))
        Uv = np.cross(n, Rv)
        E('socket', q0 + n * (sthk - sdep), np.array([0.03 * hsz, 0.024 * hsz, sthk]),
          R=np.stack([Rv, Uv, n], axis=1), k=0.018, group='head', bones=hb, sub=True)
        J['eye.' + side] = q0 - n * sdep
        J['eyeN.' + side] = n
    # ---- 眉骨（目の上の庇）・頬骨・上唇・あご先
    for sx in (1, -1):
        C('brow', hp_([sx * 0.01, 0.118, 0.062]), hp_([sx * 0.058, 0.111, 0.036]), 0.012 * br * hsz, 0.0085 * br * hsz,
          k=0.016, **hd)
        E('zygoma', hp_([sx * 0.058, 0.066, 0.02]), np.array([0.017, 0.012, 0.034]) * hsz, R=rot_y(sx * 0.42), k=0.026, **hd)
        E('lipPad', hp_([sx * 0.014 * mW, ym + 0.011, zS + 0.82 * mL]), np.array([0.014 * mW, 0.008, 0.022]) * hsz * pad,
          k=0.016, bones=hb, group='muzzle')
    E('chin', hp_([0, yb[7] + 0.006, Z[7] - 0.004]), np.array([0.016 * mW, 0.01, 0.018]) * hsz * jw, k=0.02, bones=hb, group='muzzle')
    M0 = hp_([0, yS - 0.04, zS])
    # 鼻: マズルの先端の表面を前から探し、少しめり込ませて置く
    q0 = hp_([0, yTip - 0.012, zS + mL + 0.06])
    fwd = nrm(hp_([0, yTip - 0.012, zS + mL]) - q0)
    for _ in range(60):
        q0 = q0 + fwd * eval_union(prims, q0[None])[0]
    J['noseTip'] = q0 + fwd * 0.004 * hsz
    J['muzzleRoot'] = M0
    J['headTop'] = hp_([0, 0.2, -0.02])
    # 目の中心（表面に乗せる前の目安）。build_body 側で表面に投影する
    for side, sx in (('L', 1), ('R', -1)):
        J['ear.' + side] = hp_([sx * 0.062, 0.175, -0.025])
    J['tail'] = J['hips'] + np.array([0, -0.01, -0.105]) + fat * np.array([0, 0, -0.03])
    return prims, J


BONE_PARENT = {
    'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
    'clav.L': 'chest', 'upperarm.L': 'clav.L', 'forearm.L': 'upperarm.L', 'hand.L': 'forearm.L',
    'clav.R': 'chest', 'upperarm.R': 'clav.R', 'forearm.R': 'upperarm.R', 'hand.R': 'forearm.R',
    'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L',
    'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R',
}
BONES = list(BONE_PARENT.keys())
