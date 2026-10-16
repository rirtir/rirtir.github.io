# -*- coding: utf-8 -*-
"""頭だけを細かくメッシュ化し、目が描かれる範囲に色を付けて書き出す（造形確認用）。
python head_preview.py out_prefix '{"muzLen":0.3}'
→ out/<prefix>.npz を作り、blender_head.py で6方向からレンダリングする
"""
import os, sys, json, subprocess
import numpy as np
from skimage import measure

sys.path.insert(0, os.path.dirname(__file__))
import kemono_sdf as K

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
BLENDER = r'C:/Program Files/Blender Foundation/Blender 3.2/blender.exe'


def eye_frame(prims, J, side):
    n = np.asarray(J['eyeN.' + side])
    p = np.asarray(J['eye.' + side]) + n * 0.08
    for _ in range(80):
        p = p - n * K.eval_union(prims, p[None])[0]
    R = np.cross([0, 1, 0], n); R /= np.linalg.norm(R)
    U = np.cross(n, R)
    return p, n, R, U


def main(prefix, params, step=0.0025):
    prims, J = K.build(params)
    H = J['head']
    lo = H + np.array([-0.17, -0.12, -0.17])
    hi = H + np.array([0.17, 0.30, 0.30])
    nx = int(np.ceil(0.17 / step))
    xs = np.arange(-nx, nx + 1) * step
    ys = np.arange(lo[1], hi[1], step)
    zs = np.arange(lo[2], hi[2], step)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    # 頭のプリミティブだけ使う（体はじゃまなので首から下は省く）
    use = [p for p in prims if p.group in ('head', 'muzzle') or p.name in ('neck', 'trap')]
    vol = np.empty(len(P), np.float32)
    for i in range(0, len(P), 400000):
        vol[i:i + 400000] = K.eval_union(use, P[i:i + 400000])
    vol = vol.reshape(X.shape)
    V, F, _, _ = measure.marching_cubes(vol, 0.0, spacing=(step,) * 3)
    V = V + np.array([xs[0], ys[0], zs[0]])
    F = F[:, ::-1]
    # 色: 肌 / 目の範囲 / 眉
    C = np.tile(np.array([0.85, 0.75, 0.62]), (len(V), 1))
    eyeW = float(params.get('_eyeW', 0.0195))
    for side in ('L', 'R'):
        p0, n, R, U = eye_frame(use, J, side)
        d = V - p0
        x = d @ R / eyeW
        y = d @ U / eyeW
        front = d @ n > -0.02
        almond = (x * x + (y / 0.62) ** 2 < 1) & front
        C[almond] = [0.95, 0.95, 0.9]
        iris = (x * x + ((y + 0.05) / 0.62) ** 2 < 0.3) & front
        C[iris] = [0.2, 0.45, 0.25]
        lid = (np.abs(y - 0.62 * np.sqrt(np.clip(1 - x * x, 0, 1))) < 0.12) & (np.abs(x) < 1.05) & front
        C[lid] = [0.1, 0.07, 0.07]
        brow = (np.abs(y - 1.35 + 0.1 * x * x) < 0.14) & (np.abs(x) < 1.0) & front
        C[brow] = [0.35, 0.22, 0.15]
    # 鼻先
    nt = np.asarray(J['noseTip'])
    C[np.linalg.norm(V - nt, axis=1) < 0.012] = [0.1, 0.1, 0.1]
    path = os.path.join(OUT, prefix + '.npz')
    np.savez(path, verts=V.astype(np.float32), faces=F.astype(np.int32), colors=C.astype(np.float32),
             target=np.asarray(H + np.array([0, 0.09, 0.04])))
    subprocess.run([BLENDER, '-b', '--factory-startup', '-P', os.path.join(HERE, 'blender_head.py'), '--',
                    path, os.path.join(OUT, 'prev', prefix).replace('\\', '/')], capture_output=True)
    from PIL import Image
    names = ['front', 'q30', 'q55', 'side', 'low', 'high']
    ims = [Image.open(os.path.join(OUT, 'prev', f'{prefix}_{n}.png')).convert('RGB') for n in names]
    W, Hh = ims[0].size
    sheet = Image.new('RGB', (W * 3, Hh * 2))
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % 3) * W, (i // 3) * Hh))
    sheet.save(os.path.join(OUT, 'prev', prefix + '_sheet.png'))
    print('sheet', os.path.join(OUT, 'prev', prefix + '_sheet.png'))


if __name__ == '__main__':
    main(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
