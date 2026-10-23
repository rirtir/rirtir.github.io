"""解析の自己検証：わざと音を抜いた疑似録音を作り、抜けた音を見抜けるかを測る。

  python scripts/mml_verify/selftest.py            # 標準の条件で
  python scripts/mml_verify/selftest.py --hard     # BGM・雑音・テンポのずれを強めて
"""
import argparse
import time

import numpy as np

import detect
import synth
from mmlparse import Score

NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b']


def random_mml(rng, n_parts=3, bars=8, density=0.5, tempo=None):
    """ランダムなMML（和音パートは低め）。音の長さは16分〜2分。"""
    tempo = tempo or int(rng.integers(80, 150))
    parts = []
    lens = [(16, 0.2), (8, 0.35), (4, 0.3), (2, 0.15)]
    for k in range(n_parts):
        lo = 60 - 12 * k if k else 62
        s = (f't{tempo}' if k == 0 else '') + f'v{12 if k == 0 else 8}'
        total, target = 0.0, bars * 192.0
        while total < target:
            ln = int(rng.choice([l for l, _ in lens], p=[w for _, w in lens]))
            ticks = 192 / ln
            if total + ticks > target + 1e-6:
                ln = 16; ticks = 12
            if rng.random() < density:
                m = int(rng.integers(lo, lo + 17))
                o = m // 12 - 1
                s += f'o{o}{NAMES[m % 12]}{ln}'
            else:
                s += f'r{ln}'
            total += ticks
        parts.append(s)
    return 'MML@' + ','.join(parts) + ';'


def evaluate(n_trials=10, seed=1, hard=False, verbose=False, bgm=None, noise=None, drift=None):
    rng = np.random.default_rng(seed)
    tp = fp = fn = tn = unc_pres = unc_miss = 0
    t_all = time.time()
    for trial in range(n_trials):
        mml = random_mml(rng, density=float(rng.uniform(0.4, 0.8)))
        sc = Score(mml)
        if len(sc.notes) < 10:
            continue
        gids = [n['gid'] for n in sc.notes]
        k = int(rng.integers(1, max(2, len(gids) // 8)))
        drop = set(int(g) for g in rng.choice(gids, size=k, replace=False))
        x = synth.render(sc.notes, drop=drop, offset=float(rng.uniform(0, 3)),
                         scale=float(rng.uniform(1 - (drift if drift is not None else (0.003 if not hard else 0.01)), 1 + (drift if drift is not None else (0.003 if not hard else 0.01)))),
                         bgm=(bgm if bgm is not None else (0.0 if not hard else 1.0)), noise=(noise if noise is not None else (1.0 if not hard else 4.0)), seed=trial)
        ns, info, M, times = detect.run_analysis(x, sc)
        for n in ns:
            truth_missing = n['gid'] in drop
            d = n['detected']
            if d is None:
                if truth_missing: unc_miss += 1
                else: unc_pres += 1
            elif truth_missing and d is False: tp += 1
            elif truth_missing and d is True: fn += 1
            elif not truth_missing and d is False: fp += 1
            else: tn += 1
        if verbose:
            bad = [(n['part'], n['idx'], n['name'], round(n['start_s'], 2), n['detected'], round(n['rel'], 2)) for n in ns
                   if (n['gid'] in drop) != (n['detected'] is False) and n['detected'] is not None]
            print(f'試行{trial}: 音{len(ns)} 抜き{len(drop)} tau={info["tau"]:.2f}s scale={info["scale"]:.4f} z={info["align_z"]:.1f} 間違い{len(bad)}', bad[:4])
    n_miss, n_pres = tp + fn + unc_miss, tn + fp + unc_pres
    print(f'抜けた音 {n_miss} 個 → 見抜けた {tp} / 見逃し {fn} / 判定不能 {unc_miss}')
    print(f'鳴った音 {n_pres} 個 → 正しく鳴ったと判定 {tn} / 抜けたと誤判定 {fp} / 判定不能 {unc_pres}')
    print(f'検出率(再現率) {tp / max(1, n_miss):.1%}、 誤報率 {fp / max(1, n_pres):.1%}、'
          f' 判定不能 {(unc_miss + unc_pres) / max(1, n_miss + n_pres):.1%}  （{time.time() - t_all:.0f}秒）')
    return dict(tp=tp, fn=fn, fp=fp, tn=tn)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--trials', type=int, default=10)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--hard', action='store_true')
    ap.add_argument('-v', '--verbose', action='store_true')
    ap.add_argument('--bgm', type=float); ap.add_argument('--noise', type=float); ap.add_argument('--drift', type=float)
    a = ap.parse_args()
    evaluate(a.trials, a.seed, a.hard, a.verbose, a.bgm, a.noise, a.drift)
