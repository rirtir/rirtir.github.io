# -*- coding: utf-8 -*-
"""段階C: 間引いたメッシュから、スキンウェイト・マスク・トゥーン用法線・モーフターゲットを作って書き出す。
入力: tools/out/lowres.npz
出力: assets/body.bin, assets/body.json
"""
import os, sys, json, time
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import kemono_sdf as K

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
ASSETS = os.path.join(HERE, '..', 'assets')

# スライダー: (パラメータ名, 両方向か)
SLIDERS = [
    ('legLen', True), ('torsoLen', True), ('armLen', True), ('shoulderW', True), ('chest', True),
    ('muscle', False), ('fat', True), ('belly', False), ('waist', True), ('hipW', True),
    ('armThick', True), ('legThick', True), ('neckThick', True), ('neckLen', True),
    ('handSize', True), ('footSize', True), ('pecs', True), ('glutes', True), ('calf', True),
    ('headSize', True), ('headW', True), ('craniumH', True), ('cheek', True), ('jaw', True),
    ('stop', True), ('brow', True), ('forehead', True),
    ('muzLen', True), ('muzW', True), ('muzH', True), ('muzDrop', True), ('muzTaper', True),
    ('jawLen', True), ('padSize', True), ('bridge', True),
]


def vertex_normals(V, F):
    n = np.zeros_like(V)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    for i in range(3):
        np.add.at(n, F[:, i], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def grad(prims, P, e=5e-4):
    g = np.zeros_like(P)
    for a in range(3):
        d = np.zeros(3); d[a] = e
        g[:, a] = (K.eval_union(prims, P + d) - K.eval_union(prims, P - d)) / (2 * e)
    return g


def project(prims, P, iters=6, maxstep=0.02):
    P = P.copy()
    for _ in range(iters):
        f = K.eval_union(prims, P)
        g = grad(prims, P)
        gl2 = np.sum(g * g, axis=1) + 1e-12
        step = (f / gl2)[:, None] * g
        sl = np.linalg.norm(step, axis=1, keepdims=True)
        step = step * np.minimum(1.0, maxstep / (sl + 1e-12))
        P -= step
    return P


def toon_normals(prims, P, geo_n, delta):
    """表面から外側へ delta だけ離れた点で SDF 勾配を取る -> なだらかな法線（トゥーンの影がきれいになる）"""
    g = grad(prims, P + geo_n * delta[:, None], e=1e-3)
    return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-12)


def laplacian_relax(V, F, mask_w, iters=3, lam=0.35):
    """変化のあった頂点だけ接平面方向にならす（伸びた部分の頂点の偏りを減らす）"""
    nv = len(V)
    # 隣接平均
    for _ in range(iters):
        acc = np.zeros_like(V); cnt = np.zeros(nv)
        for i, j in ((0, 1), (1, 2), (2, 0), (1, 0), (2, 1), (0, 2)):
            np.add.at(acc, F[:, i], V[F[:, j]]); np.add.at(cnt, F[:, i], 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        V = V + (avg - V) * (lam * mask_w)[:, None]
    return V


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
    for (a, b), L in zip(seg, lens):
        ab = b - a
        t = np.clip(((P - a) @ ab) / (L * L), 0, 1)
        q = a + t[:, None] * ab
        d = np.linalg.norm(P - q, axis=1)
        better = d < best_d
        best_d = np.where(better, d, best_d)
        best_t = np.where(better, (acc + t * L) / tot, best_t)
        acc += L
    return best_t, best_d


def main():
    t0 = time.time()
    d = np.load(os.path.join(OUT, 'lowres.npz'))
    V0, F = d['verts'].astype(np.float64), d['faces'].astype(np.int64)
    prims, J = K.build()
    names = [p.name for p in prims]
    V = project(prims, V0)
    print('verts', len(V), 'faces', len(F), 'projected', time.time() - t0)
    _, D = K.eval_union(prims, V, return_all=True)
    Wm = softmin_weights(D, 0.008)    # プリミティブ所属（モーフ対応用）
    Ws = softmin_weights(D, 0.016)    # スキン用（なめらか）
    bones = K.BONES
    bidx = {b: i for i, b in enumerate(bones)}
    BW = np.zeros((len(V), len(bones)))
    for i, p in enumerate(prims):
        for b, w in p.bones.items():
            BW[:, bidx[b]] += Ws[:, i] * w
    order = np.argsort(-BW, axis=1)[:, :4]
    top = np.take_along_axis(BW, order, axis=1)
    top = top / top.sum(axis=1, keepdims=True)
    # 小さい影響は切る
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
    armT = np.zeros(len(V)); legT = np.zeros(len(V))
    for side in ('L', 'R'):
        sx = 1 if side == 'L' else -1
        tipA = J['hand.' + side] + (J['hand.' + side] - J['forearm.' + side]) / np.linalg.norm(J['hand.' + side] - J['forearm.' + side]) * 0.19
        t, dd = chain_t(V, [J['upperarm.' + side], J['forearm.' + side], J['hand.' + side], tipA])
        sel = (V[:, 0] * sx > 0.16) & (dd < 0.085)
        armT = np.where(sel, np.maximum(armT, t), armT)
        toe = J['foot.' + side] + np.array([0, -0.06, 0.17])
        t, dd = chain_t(V, [J['thigh.' + side], J['shin.' + side], J['foot.' + side], toe])
        sel = (V[:, 0] * sx > 0.0) & (V[:, 1] < J['thigh.' + side][1] + 0.02) & (dd < 0.13)
        legT = np.where(sel, np.maximum(legT, t), legT)
    handfoot = Wm[:, np.isin(names, ['palm', 'palmPad', 'finger', 'fingerPad', 'thumb', 'foot', 'toe', 'toePad', 'solePad', 'heel'])].sum(axis=1)

    gn = vertex_normals(V, F)
    # 法線のなだらかさ: 頭は強め・手足は弱め
    delta = 0.012 + 0.012 * head - 0.009 * handfoot
    N = toon_normals(prims, V, gn, delta)

    # ---------------- morphs
    meta_morphs = []
    blobs = []
    joints_base = {k: v.tolist() for k, v in J.items()}
    slider_map = {}
    for pname, both in SLIDERS:
        slider_map[pname] = {}
        for sgn in ((1.0, -1.0) if both else (1.0,)):
            pk, Jk = K.build({pname: sgn})
            assert [p.name for p in pk] == names
            Vm = np.zeros_like(V)
            for i, (pa, pb) in enumerate(zip(prims, pk)):
                w = Wm[:, i]
                sel = w > 1e-4
                if not np.any(sel):
                    continue
                Vm[sel] += w[sel, None] * pa.map_to(pb, V[sel])
            # 下半身（脚）以外は足元基準でなく元の位置基準。地面合わせは JS で行う
            Vm = project(pk, Vm, iters=6)
            moved = np.linalg.norm(Vm - V, axis=1)
            if moved.max() > 0.004:
                rw = np.clip(moved / 0.01, 0, 1)
                Vm = laplacian_relax(Vm, F, rw * 0.6, iters=2)
                Vm = project(pk, Vm, iters=4)
            gnm = vertex_normals(Vm, F)
            Nm = toon_normals(pk, Vm, gnm, delta)
            dP = (Vm - V)
            dN = (Nm - N)
            sel = np.nonzero((np.abs(dP).max(axis=1) > 2e-4) | (np.abs(dN).max(axis=1) > 0.01))[0]
            mname = f'{pname}{"+" if sgn > 0 else "-"}'
            sp = float(np.abs(dP[sel]).max()) if len(sel) else 1e-6
            sn = float(np.abs(dN[sel]).max()) if len(sel) else 1e-6
            qi = sel.astype(np.uint16 if len(V) < 65536 else np.uint32)
            qp = np.round(dP[sel] / sp * 32767).astype(np.int16)
            qn = np.round(dN[sel] / sn * 127).astype(np.int8)
            jd = {k: (np.asarray(Jk[k]) - np.asarray(J[k])).round(6).tolist() for k in J
                  if np.abs(np.asarray(Jk[k]) - np.asarray(J[k])).max() > 1e-6}
            meta_morphs.append(dict(name=mname, count=int(len(sel)), sp=sp, sn=sn, joints=jd))
            blobs += [qi.tobytes(), qp.tobytes(), qn.tobytes()]
            slider_map[pname]['pos' if sgn > 0 else 'neg'] = len(meta_morphs) - 1
            print(f'  morph {mname:12s} verts {len(sel):6d} max {sp:.4f}  t={time.time() - t0:.1f}')

    # 目の位置を表面に乗せる
    eyes = {}
    for side, sx in (('L', 1), ('R', -1)):
        e = K.nrm([sx * np.sin(np.radians(30)), 0.1, np.cos(np.radians(30))])
        p = np.asarray(J['eye.' + side]) + e * 0.12
        for _ in range(60):
            f = K.eval_union(prims, p[None])[0]
            p = p - e * f
        nn = grad(prims, p[None])[0]; nn = nn / np.linalg.norm(nn)
        eyes[side] = dict(pos=p.tolist(), normal=nn.tolist(), dir=e.tolist())

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
    idx = F.astype(np.uint16 if len(V) < 65536 else np.uint32)
    add('index', idx)
    add('skinIndex', skinIndex)
    add('skinWeight', skinWeight)
    maskA = np.stack([muz, head, padm, handfoot], axis=1)
    maskB = np.stack([armT, legT, np.zeros(len(V)), np.zeros(len(V))], axis=1)
    add('maskA', np.round(np.clip(maskA, 0, 1) * 255).astype(np.uint8))
    add('maskB', np.round(np.clip(maskB, 0, 1) * 255).astype(np.uint8))
    for m, (bi, bp, bn) in zip(meta_morphs, zip(blobs[0::3], blobs[1::3], blobs[2::3])):
        for kind, b in (('i', bi), ('p', bp), ('n', bn)):
            pad = (-off) % 4
            if pad:
                head_bytes.append(b'\0' * pad); off += pad
            m['off_' + kind] = off
            head_bytes.append(b); off += len(b)
    with open(os.path.join(ASSETS, 'body.bin'), 'wb') as fp:
        for b in head_bytes:
            fp.write(b)
    meta = dict(
        version=1, vertexCount=int(len(V)), indexCount=int(F.size), layout=layout,
        indexType='uint16' if len(V) < 65536 else 'uint32',
        bones=[dict(name=b, parent=K.BONE_PARENT[b]) for b in bones],
        joints=joints_base, morphs=meta_morphs, sliders=slider_map, eyes=eyes,
    )
    with open(os.path.join(ASSETS, 'body.json'), 'w', encoding='utf-8') as fp:
        json.dump(meta, fp, ensure_ascii=False, separators=(',', ':'))
    print('wrote', off / 1e6, 'MB', time.time() - t0)


if __name__ == '__main__':
    main()
