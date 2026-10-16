# -*- coding: utf-8 -*-
"""モーフの品質チェック: スライダーをランダムに組み合わせて
 - 裏返る三角形（面法線が基準と逆向き）の数
 - 各スライダーが「目の周り」をどれだけ動かすか（干渉）
を数える。 python qa_morphs.py [試行数]
"""
import os, sys, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, '..', 'assets')
DT = {'float32': np.float32, 'uint16': np.uint16, 'uint32': np.uint32, 'uint8': np.uint8}


def load():
    meta = json.load(open(os.path.join(A, 'body.json'), encoding='utf-8'))
    raw = open(os.path.join(A, 'body.bin'), 'rb').read()

    def view(name):
        l = meta['layout'][name]
        return np.frombuffer(raw, dtype=DT[l['dtype']], count=int(np.prod(l['shape'])), offset=l['offset']).reshape(l['shape'])
    n = meta['vertexCount']
    P = view('position').astype(np.float64)
    F = view('index').astype(np.int64).reshape(-1, 3)
    IT = np.uint16 if n < 65536 else np.uint32
    D = []
    for m in meta['morphs']:
        idx = np.frombuffer(raw, dtype=IT, count=m['count'], offset=m['off_i']).astype(np.int64)
        q = np.frombuffer(raw, dtype=np.int16, count=m['count'] * 3, offset=m['off_p']).reshape(-1, 3)
        d = np.zeros((n, 3))
        d[idx] = q * (m['sp'] / 32767)
        D.append(d)
    return meta, P, F, np.stack(D)


def face_n(V, F):
    return np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])


def weights(meta, vals):
    w = np.zeros(len(meta['morphs']))
    for k, s in meta['sliders'].items():
        v = vals.get(k, 0)
        b = s.get('base', 0.0)
        if v > b and 'pos' in s: w[s['pos']] = (v - b) / (1 - b)
        if v < b and 'neg' in s: w[s['neg']] = (b - v) / (1 + b)
    return w


def main(trials=300):
    meta, P, F, D = load()
    rng = np.random.default_rng(1)
    n0 = face_n(P, F)
    a0 = np.linalg.norm(n0, axis=1)
    keys = list(meta['sliders'].keys())
    worst = []
    flips = []
    for t in range(trials):
        vals = {k: float(rng.uniform(-1, 1)) if rng.random() < 0.6 else 0.0 for k in keys}
        if t < 2:
            vals = {k: (1.0 if t == 0 else -1.0) for k in keys}
        w = weights(meta, vals)
        V = P + np.tensordot(w, D, axes=1)
        n1 = face_n(V, F)
        bad = np.sum(n1 * n0, axis=1) / (a0 * a0 + 1e-18) < 0.0
        flips.append(bad.sum())
        if bad.sum():
            worst.append((int(bad.sum()), vals))
    flips = np.array(flips)
    print(f'trials {trials}: flipped tris mean {flips.mean():.1f}, max {flips.max()}, cases with flips {np.sum(flips > 0)}')
    worst.sort(key=lambda x: -x[0])
    for c, v in worst[:3]:
        top = sorted(v.items(), key=lambda kv: -abs(kv[1]))[:8]
        print('  ', c, {k: round(x, 2) for k, x in top})
    # 目の周りへの干渉
    eye = np.array(meta['eyes']['L']['pos'])
    near = np.linalg.norm(P - eye, axis=1) < 0.022   # 左目の中心付近だけ
    print('eye-region vertices', near.sum())
    rows = []
    for i, m in enumerate(meta['morphs']):
        dd = D[i][near]
        # 目の周りの「形の変化」= 平行移動を除いた残り
        dd = dd - dd.mean(axis=0)
        d = np.linalg.norm(dd, axis=1)
        rows.append((m['name'], d.max() * 1000))
    rows.sort(key=lambda r: -r[1])
    print('morphs deforming the eye region most (mm, translation removed):')
    for nme, mm in rows[:14]:
        print(f'   {nme:12s} {mm:6.2f}')


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 300)
