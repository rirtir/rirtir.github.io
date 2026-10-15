# -*- coding: utf-8 -*-
"""段階A: 基準パラメータの SDF を細かいグリッドで評価し、マーチングキューブで高解像度メッシュを作る。
出力: tools/out/hires.npz (verts, faces)
"""
import os, sys, time
import numpy as np
from skimage import measure

sys.path.insert(0, os.path.dirname(__file__))
import kemono_sdf as K

OUT = os.path.join(os.path.dirname(__file__), 'out')
os.makedirs(OUT, exist_ok=True)


def sample(prims, xs, ys, zs, chunk=400_000):
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    out = np.empty(len(P), dtype=np.float32)
    for i in range(0, len(P), chunk):
        out[i:i + chunk] = K.eval_union(prims, P[i:i + chunk])
    return out.reshape(X.shape)


def main(step=0.004):
    t0 = time.time()
    prims, J = K.build()
    lo = np.array([-0.82, -0.01, -0.24])
    hi = np.array([0.82, 1.92, 0.36])
    # x はゼロを中心に左右対称なグリッドにする
    nx = int(np.ceil(hi[0] / step))
    xs = (np.arange(-nx, nx + 1) * step).astype(np.float64)
    ys = np.arange(lo[1], hi[1], step)
    zs = np.arange(lo[2], hi[2], step)
    cs = step * 4
    cxs, cys, czs = xs[::4], ys[::4], zs[::4]
    coarse = sample(prims, cxs, cys, czs)
    print('coarse', coarse.shape, time.time() - t0)
    near = np.abs(coarse) < cs * 1.9
    ix = np.minimum(np.round((xs - cxs[0]) / cs).astype(int), len(cxs) - 1)
    iy = np.minimum(np.round((ys - cys[0]) / cs).astype(int), len(cys) - 1)
    iz = np.minimum(np.round((zs - czs[0]) / cs).astype(int), len(czs) - 1)
    mask = near[ix[:, None, None], iy[None, :, None], iz[None, None, :]]
    vol = coarse[ix[:, None, None], iy[None, :, None], iz[None, None, :]].astype(np.float32)
    idx = np.nonzero(mask)
    P = np.stack([xs[idx[0]], ys[idx[1]], zs[idx[2]]], axis=1)
    print('fine points', len(P))
    vals = np.empty(len(P), dtype=np.float32)
    ch = 300_000
    for i in range(0, len(P), ch):
        vals[i:i + ch] = K.eval_union(prims, P[i:i + ch])
    vol[idx] = vals
    print('fine done', time.time() - t0)
    verts, faces, normals, _ = measure.marching_cubes(vol, level=0.0, spacing=(step, step, step))
    verts = verts + np.array([xs[0], ys[0], zs[0]])
    # skimage の面の向きを外向きにそろえる（法線と面法線の比較）
    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    fn = np.cross(v1 - v0, v2 - v0)
    cen = (v0 + v1 + v2) / 3
    e = 1e-3
    g = np.zeros_like(cen)
    for a in range(3):
        d = np.zeros(3); d[a] = e
        g[:, a] = K.eval_union(prims, cen + d) - K.eval_union(prims, cen - d)
    if np.mean(np.sum(fn * g, axis=1) > 0) < 0.5:
        faces = faces[:, ::-1]
    print('mc', verts.shape, faces.shape, time.time() - t0)
    np.savez(os.path.join(OUT, 'hires.npz'), verts=verts.astype(np.float32), faces=faces.astype(np.int32))


if __name__ == '__main__':
    main(float(sys.argv[1]) if len(sys.argv) > 1 else 0.004)
