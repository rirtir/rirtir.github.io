# -*- coding: utf-8 -*-
"""段階C: 間引いたメッシュから、スキンウェイト・マスク・トゥーン用法線・モーフターゲットを作って書き出す。
入力: tools/out/lowres.npz
出力: assets/body.bin, assets/body.json

モーフの作り方（干渉と裏返りを防ぐ）:
 1. 基準メッシュは表面上でならして、細長い三角形を減らしておく
 2. スライダーのパラメータを変えた SDF に対し、プリミティブごとの対応で頂点を移す
 3. 保護領域を「剛体の平行移動」に置き換える
      体のスライダー → 頭全体（顔の形は変えない）
      顔のスライダー → 目の周り（目の形は変えない）
 4. 移動量をメッシュ上で平滑化し、法線方向だけ新しい表面へ合わせ直す
 5. それでも裏返る三角形があれば、その周辺だけ追加で平滑化する
"""
import os, sys, json, time
import numpy as np
import scipy.sparse as sp

sys.path.insert(0, os.path.dirname(__file__))
import kemono_sdf as K

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
ASSETS = os.path.join(HERE, '..', 'assets')

# スライダー: (パラメータ名, 両方向か, 系統)
#   body: 頭を剛体として動かす / face: 目の周りを剛体として動かす / free: 保護なし
SLIDERS = [
    ('legLen', True, 'body'), ('torsoLen', True, 'body'), ('armLen', True, 'body'), ('shoulderW', True, 'body'),
    ('chest', True, 'body'), ('muscle', False, 'body'), ('fat', True, 'face'), ('belly', False, 'body'),
    ('waist', True, 'body'), ('hipW', True, 'body'), ('armThick', True, 'body'), ('legThick', True, 'body'),
    ('neckThick', True, 'body'), ('neckLen', True, 'body'), ('handSize', True, 'body'), ('footSize', True, 'body'),
    ('pecs', True, 'body'), ('glutes', True, 'body'), ('calf', True, 'body'), ('bulk', True, 'body'), ('traps', True, 'body'),
    ('headSize', True, 'free'), ('headW', True, 'face'), ('craniumH', True, 'face'), ('cheek', True, 'face'),
    ('jaw', True, 'face'), ('stop', True, 'face'), ('brow', True, 'face'), ('forehead', True, 'face'),
    ('muzLen', True, 'face'), ('muzW', True, 'face'), ('muzH', True, 'face'), ('muzDrop', True, 'face'),
    ('muzTaper', True, 'face'), ('jawLen', True, 'face'), ('padSize', True, 'face'), ('bridge', True, 'face'),
]


# 基準メッシュを作るときのパラメータ（縮める変形は折れやすいので、短い側を基準にして伸ばす）
BASE = {'muzLen': -0.5}


def vertex_normals(V, F):
    n = np.zeros_like(V)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    for i in range(3):
        np.add.at(n, F[:, i], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def face_normals(V, F):
    return np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])


def grad(prims, P, e=5e-4):
    g = np.zeros_like(P)
    for a in range(3):
        d = np.zeros(3); d[a] = e
        g[:, a] = (K.eval_union(prims, P + d) - K.eval_union(prims, P - d)) / (2 * e)
    return g


def project(prims, P, iters=6, maxstep=0.02, scale=None):
    """SDF の勾配方向へ表面まで移す（scale で頂点ごとに効き目を弱められる）"""
    P = P.copy()
    if len(P) == 0:
        return P
    for _ in range(iters):
        f = K.eval_union(prims, P)
        g = grad(prims, P)
        gl2 = np.sum(g * g, axis=1) + 1e-12
        step = (f / gl2)[:, None] * g
        sl = np.linalg.norm(step, axis=1, keepdims=True)
        step = step * np.minimum(1.0, maxstep / (sl + 1e-12))
        if scale is not None:
            step = step * scale[:, None]
        P -= step
    return P


def toon_normals(prims, P, geo_n, delta):
    """表面から外側へ delta だけ離れた点で SDF 勾配を取る -> なだらかな法線（トゥーンの影がきれいになる）"""
    g = grad(prims, P + geo_n * delta[:, None], e=1e-3)
    return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-12)


def adjacency(F, n):
    i = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    j = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    A = sp.coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    A.data[:] = 1.0
    deg = np.asarray(A.sum(axis=1)).ravel()
    return sp.diags(1.0 / np.maximum(deg, 1)) @ A


def relax_mesh(prims, V, F, L, iters=10, lam=0.45):
    """接平面方向のラプラシアン平滑化 + 表面への投影 → 三角形の形をそろえる"""
    for it in range(iters):
        n = vertex_normals(V, F)
        d = L @ V - V
        d -= n * np.sum(d * n, axis=1, keepdims=True)
        V = V + lam * d
        V = project(prims, V, iters=2)
    return V


def cavity(prims, P, n, h=0.016):
    """くぼみ具合（0..1）: 表面から法線方向へ h 離れた点が、ほかの面に近いほど大きい"""
    f = K.eval_union(prims, P + n * h)
    return np.clip((h - f) / h, 0.0, 1.0)


def softmin_weights(D, tau):
    m = D.min(axis=1, keepdims=True)
    w = np.exp(-(D - m) / tau)
    return w / w.sum(axis=1, keepdims=True)


def chain_t(P, pts):
    """ポリライン pts に沿った正規化弧長と距離。"""
    seg = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    lens = [np.linalg.norm(b - a) for a, b in seg]
    tot = sum(lens)
    best_d = np.full(len(P), 1e9); best_t = np.zeros(len(P))
    acc = 0.0
    for (a, b), Ln in zip(seg, lens):
        ab = b - a
        t = np.clip(((P - a) @ ab) / (Ln * Ln), 0, 1)
        q = a + t[:, None] * ab
        d = np.linalg.norm(P - q, axis=1)
        better = d < best_d
        best_d = np.where(better, d, best_d)
        best_t = np.where(better, (acc + t * Ln) / tot, best_t)
        acc += Ln
    return best_t, best_d


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def shape_changed(a, b):
    """位置以外（大きさ・向き・長さ）が変わったか"""
    if hasattr(a, 'cv'):
        if np.abs(a.Z - b.Z).max() > 1e-9 or abs(a.hsz - b.hsz) > 1e-9 or abs(a.hw - b.hw) > 1e-9:
            return True
        return any(np.abs(a.cv[k] - b.cv[k]).max() > 1e-9 for k in a.cv)
    for k in ('r', 'R', 'ra', 'rb', 'sq', 'w0', 'w1', 'L', 'F'):
        if hasattr(a, k):
            va, vb = np.asarray(getattr(a, k)), np.asarray(getattr(b, k))
            if va.shape != vb.shape or np.abs(va - vb).max() > 1e-9:
                return True
    return False


def prim_changed(a, b):
    if hasattr(a, 'cv'):
        return shape_changed(a, b) or np.abs(a.H - b.H).max() > 1e-9
    for k in ('c', 'r', 'R', 'a', 'b', 'ra', 'rb', 'sq', 'w0', 'w1'):
        if hasattr(a, k):
            va, vb = np.asarray(getattr(a, k)), np.asarray(getattr(b, k))
            if va.shape != vb.shape or np.abs(va - vb).max() > 1e-9:
                return True
    return False


def find_eyes(prims, J):
    """目の位置: 削った目の面の中心（法線方向から表面に乗せる）。向きは目の面の法線"""
    eyes = {}
    for side in ('L', 'R'):
        n = np.asarray(J['eyeN.' + side], float)
        p = np.asarray(J['eye.' + side], float) + n * 0.05
        for _ in range(60):
            p = p - n * K.eval_union(prims, p[None])[0]
        eyes[side] = dict(pos=p.tolist(), normal=n.tolist(), dir=n.tolist())
    return eyes


def main():
    t0 = time.time()
    d = np.load(os.path.join(OUT, 'lowres.npz'))
    V0, F = d['verts'].astype(np.float64), d['faces'].astype(np.int64)
    prims, J = K.build(BASE)
    names = [p.name for p in prims]
    nV = len(V0)
    L = adjacency(F, nV)
    V = project(prims, V0)
    V = relax_mesh(prims, V, F, L)
    print('verts', nV, 'faces', len(F), 'relaxed', round(time.time() - t0, 1))
    _, D = K.eval_union(prims, V, return_all=True)
    Wm = softmin_weights(D, 0.008)    # プリミティブ所属（モーフ対応用）
    Ws = softmin_weights(D, 0.016)    # スキン用（なめらか）
    bones = K.BONES
    bidx = {b: i for i, b in enumerate(bones)}
    BW = np.zeros((nV, len(bones)))
    for i, p in enumerate(prims):
        for b, w in p.bones.items():
            BW[:, bidx[b]] += Ws[:, i] * w
    order = np.argsort(-BW, axis=1)[:, :4]
    top = np.take_along_axis(BW, order, axis=1)
    top = top / top.sum(axis=1, keepdims=True)
    top = np.where(top < 0.02, 0, top)
    top = top / top.sum(axis=1, keepdims=True)
    skinIndex = order.astype(np.uint8)
    skinWeight = np.round(top * 255).astype(np.int32)
    skinWeight[:, 0] += 255 - skinWeight.sum(axis=1)
    skinWeight = skinWeight.astype(np.uint8)

    # マスク
    grp = np.array([p.group for p in prims])
    muz = Wm[:, grp == 'muzzle'].sum(axis=1)
    head = Wm[:, (grp == 'head') | (grp == 'muzzle')].sum(axis=1)
    padm = Wm[:, grp == 'pad'].sum(axis=1)
    armT = np.zeros(nV); legT = np.zeros(nV)
    for side in ('L', 'R'):
        sx = 1 if side == 'L' else -1
        tipA = J['hand.' + side] + (J['hand.' + side] - J['forearm.' + side]) / np.linalg.norm(J['hand.' + side] - J['forearm.' + side]) * 0.19
        t, dd = chain_t(V, [J['upperarm.' + side], J['forearm.' + side], J['hand.' + side], tipA])
        sel = (V[:, 0] * sx > 0.16) & (dd < 0.1)
        armT = np.where(sel, np.maximum(armT, t), armT)
        toe = J['foot.' + side] + np.array([0, -0.06, 0.17])
        t, dd = chain_t(V, [J['thigh.' + side], J['shin.' + side], J['foot.' + side], toe])
        sel = (V[:, 0] * sx > 0.0) & (V[:, 1] < J['thigh.' + side][1] + 0.02) & (dd < 0.15)
        legT = np.where(sel, np.maximum(legT, t), legT)
    handfoot = Wm[:, np.isin(names, ['palm', 'palmPad', 'finger', 'fingerPad', 'thumb', 'foot', 'toe', 'toePad', 'solePad', 'heel'])].sum(axis=1)

    gn = vertex_normals(V, F)
    tdelta = 0.012 + 0.012 * head - 0.009 * handfoot
    N = toon_normals(prims, V, gn, tdelta)
    eyes = find_eyes(prims, J)
    cavBase = cavity(prims, V, gn)
    cavMus = cavBase.copy()

    # 保護領域
    headProt = smoothstep(0.55, 0.9, head)
    # 体のスライダーで守るのは顔（あごより上）。のど・首の境目は変形させて、首との衝突で折れないようにする
    bodyProt = headProt * smoothstep(J['head'][1] + 0.025, J['head'][1] + 0.07, V[:, 1])
    BWn = BW / np.maximum(BW.sum(axis=1, keepdims=True), 1e-9)
    eyeProt = {}
    eyeCore = {}
    for side in ('L', 'R'):
        ec = np.array(eyes[side]['pos'])
        dist = np.linalg.norm(V - ec, axis=1)
        eyeProt[side] = 1.0 - smoothstep(0.026, 0.044, dist)
        eyeCore[side] = dist < 0.012
    nF = face_normals(V, F)

    meta_morphs = []
    blobs = []
    slider_map = {}
    total_flips = 0
    for pname, both, kind in SLIDERS:
        slider_map[pname] = {'base': BASE.get(pname, 0.0)}
        for sgn in ((1.0, -1.0) if both else (1.0,)):
            pk, Jk = K.build({**BASE, pname: sgn})
            assert [p.name for p in pk] == names
            changed = [i for i, (a, b) in enumerate(zip(prims, pk)) if prim_changed(a, b)]
            # 1) プリミティブ対応で移す
            Vm = V.copy()
            wsum = Wm[:, changed].sum(axis=1) if changed else np.zeros(nV)
            aff = wsum > 1e-5
            if changed:
                acc = np.zeros((aff.sum(), 3))
                Va = V[aff]
                for i, (pa, pb) in enumerate(zip(prims, pk)):
                    w = Wm[aff, i]
                    s = w > 1e-6
                    if not np.any(s):
                        continue
                    if i in changed:
                        acc[s] += w[s, None] * pa.map_to(pb, Va[s])
                    else:
                        acc[s] += w[s, None] * Va[s]
                Vm[aff] = acc
            # SDF が変わった頂点も含める
            fk = K.eval_union(pk, V)
            aff |= np.abs(fk) > 2e-5
            Vm[aff] = project(pk, Vm[aff], iters=5)
            delta = Vm - V
            # 2) 骨の平行移動による成分（形は変えずに動くだけ）と、形の変化による成分に分ける
            Tb = np.array([np.asarray(Jk[b]) - np.asarray(J[b]) for b in bones])
            rigid = BWn @ Tb
            shp = [i for i in changed if shape_changed(prims[i], pk[i])]
            resW = Wm[:, shp].sum(axis=1) if shp else np.zeros(nV)
            resMask = smoothstep(2e-4, 2e-2, resW)
            for _ in range(3):
                resMask = np.maximum(resMask, (L @ resMask) * 0.85)
            residual = (delta - rigid) * resMask[:, None]
            # 3) 保護領域
            prot = np.zeros(nV)
            target = np.zeros((nV, 3))
            if kind == 'body':
                prot = bodyProt.copy()
            elif kind == 'face':
                for side in ('L', 'R'):
                    tgt = residual[eyeCore[side]].mean(axis=0)
                    pr = eyeProt[side]
                    m = pr > prot
                    prot = np.where(m, pr, prot)
                    target[m] = tgt
            residual = residual * (1 - prot[:, None]) + target * prot[:, None]
            # 4) 形の変化成分だけをならす（表面に沿う成分は強く、法線方向は軽く）
            if np.abs(residual).max() > 1e-7:
                dn = np.sum(residual * gn, axis=1, keepdims=True) * gn
                dt = residual - dn
                tt = target - np.sum(target * gn, axis=1, keepdims=True) * gn
                for it in range(28):
                    dt = 0.5 * dt + 0.5 * (L @ dt)
                    if it < 6:
                        dn = 0.5 * dn + 0.5 * (L @ dn)
                    dt = dt * (1 - prot[:, None]) + tt * prot[:, None]
                    dn = dn * (1 - prot[:, None]) + (target - tt) * prot[:, None]
                residual = dt + dn
            delta = rigid + residual
            pscale = resMask * (1 - prot)
            act = pscale > 1e-3
            Vm = V + delta
            if act.any():
                Vm[act] = project(pk, Vm[act], iters=3, scale=pscale[act])
                # 5) 裏返りの修正（形の変化成分だけ追加でならす）
                for rep_ in range(6):
                    nk = face_normals(Vm, F)
                    bad = np.sum(nk * nF, axis=1) <= 0
                    if not bad.any():
                        break
                    region = np.zeros(nV, bool)
                    region[F[bad].ravel()] = True
                    for _ in range(2 + rep_):
                        region = region | ((L @ region.astype(float)) > 0)
                    dl = Vm - V - rigid
                    for _ in range(6 + 4 * rep_):
                        sm = 0.5 * dl + 0.5 * (L @ dl)
                        dl[region] = sm[region]
                    Vm = V + rigid + dl
                    rg = region & act
                    Vm[rg] = project(pk, Vm[rg], iters=2, scale=pscale[rg] * 0.7)
            delta = Vm - V
            if pname == 'muscle' and sgn > 0:
                cavMus = cavity(pk, V + delta, vertex_normals(V + delta, F))
            nk = face_normals(V + delta, F)
            flips = int((np.sum(nk * nF, axis=1) <= 0).sum())
            total_flips += flips
            # トゥーン法線
            act = np.abs(delta).max(axis=1) > 1e-6
            Nm = N.copy()
            if act.any():
                gnm = vertex_normals(V + delta, F)
                Nm[act] = toon_normals(pk, (V + delta)[act], gnm[act], tdelta[act])
            dP = delta
            dN = Nm - N
            sel = np.nonzero((np.abs(dP).max(axis=1) > 2e-4) | (np.abs(dN).max(axis=1) > 0.01))[0]
            mname = f'{pname}{"+" if sgn > 0 else "-"}'
            spv = float(np.abs(dP[sel]).max()) if len(sel) else 1e-6
            snv = float(np.abs(dN[sel]).max()) if len(sel) else 1e-6
            qi = sel.astype(np.uint16 if nV < 65536 else np.uint32)
            qp = np.round(dP[sel] / spv * 32767).astype(np.int16)
            qn = np.round(dN[sel] / snv * 127).astype(np.int8)
            jd = {k: (np.asarray(Jk[k]) - np.asarray(J[k])).round(6).tolist() for k in J
                  if np.abs(np.asarray(Jk[k]) - np.asarray(J[k])).max() > 1e-6}
            meta_morphs.append(dict(name=mname, count=int(len(sel)), sp=spv, sn=snv, joints=jd))
            blobs += [qi.tobytes(), qp.tobytes(), qn.tobytes()]
            slider_map[pname]['pos' if sgn > 0 else 'neg'] = len(meta_morphs) - 1
            print(f'  morph {mname:12s} verts {len(sel):6d} max {spv:.4f} flips {flips:3d}  t={time.time() - t0:.1f}', flush=True)
    print('total single-morph flips', total_flips)

    # 書き出し
    os.makedirs(ASSETS, exist_ok=True)
    head_bytes = []
    layout = {}
    off = 0

    def add(name, arr):
        nonlocal off
        b = np.ascontiguousarray(arr).tobytes()
        pad = (-off) % 4
        if pad:
            head_bytes.append(b'\0' * pad); off += pad
        layout[name] = dict(offset=off, length=len(b), dtype=str(arr.dtype), shape=list(arr.shape))
        head_bytes.append(b); off += len(b)

    add('position', V.astype(np.float32))
    add('normal', N.astype(np.float32))
    idx = F.astype(np.uint16 if nV < 65536 else np.uint32)
    add('index', idx)
    add('skinIndex', skinIndex)
    add('skinWeight', skinWeight)
    maskA = np.stack([muz, head, padm, handfoot], axis=1)
    maskB = np.stack([armT, legT, cavBase, cavMus], axis=1)
    print('cavity', np.percentile(cavBase, [50, 90, 99]), np.percentile(cavMus, [50, 90, 99]))
    add('maskA', np.round(np.clip(maskA, 0, 1) * 255).astype(np.uint8))
    add('maskB', np.round(np.clip(maskB, 0, 1) * 255).astype(np.uint8))
    for m, (bi, bp, bn) in zip(meta_morphs, zip(blobs[0::3], blobs[1::3], blobs[2::3])):
        for kind_, b in (('i', bi), ('p', bp), ('n', bn)):
            pad = (-off) % 4
            if pad:
                head_bytes.append(b'\0' * pad); off += pad
            m['off_' + kind_] = off
            head_bytes.append(b); off += len(b)
    with open(os.path.join(ASSETS, 'body.bin'), 'wb') as fp:
        for b in head_bytes:
            fp.write(b)
    meta = dict(
        version=2, vertexCount=int(nV), indexCount=int(F.size), layout=layout,
        indexType='uint16' if nV < 65536 else 'uint32',
        bones=[dict(name=b, parent=K.BONE_PARENT[b]) for b in bones],
        joints={k: v.tolist() for k, v in J.items()}, morphs=meta_morphs, sliders=slider_map, eyes=eyes,
    )
    with open(os.path.join(ASSETS, 'body.json'), 'w', encoding='utf-8') as fp:
        json.dump(meta, fp, ensure_ascii=False, separators=(',', ':'))
    print('wrote', off / 1e6, 'MB', time.time() - t0)


if __name__ == '__main__':
    main()
