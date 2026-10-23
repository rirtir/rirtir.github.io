"""別の音色の録音で、音色を学習した場合としない場合の精度を比べる"""
import os, sys, tempfile
tmp = tempfile.mkdtemp(prefix='mmlverify_'); os.environ['MML_VERIFY_DATA'] = tmp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np, synth, detect, probes, store
from mmlparse import Score
from selftest import random_mml
# 奇数倍音が強い（クラリネットのような）音色
ODD = [[0, -40, -6, -40, -12, -40, -18, -40, -24, -40, -30, -40]] * 2
def evaluate(label, trials=15):
    rng = np.random.default_rng(11); tp = fn = fp = tn = 0
    for t in range(trials):
        sc = Score(random_mml(rng, density=float(rng.uniform(0.4, 0.8))))
        if len(sc.notes) < 10: continue
        g = [n['gid'] for n in sc.notes]; k = int(rng.integers(1, max(2, len(g) // 8)))
        drop = set(int(v) for v in rng.choice(g, size=k, replace=False))
        x = synth.render(sc.notes, drop=drop, offset=float(rng.uniform(0, 3)), noise=1.0, seed=t, harm=ODD)
        ns, info, M, ti = detect.run_analysis(x, sc)
        for n in ns:
            if n['detected'] is None or n['confidence'] != 'high': continue
            m = n['gid'] in drop
            if m and n['detected'] is False: tp += 1
            elif m: fn += 1
            elif n['detected'] is False: fp += 1
            else: tn += 1
    print(f'{label}: 抜けた音 {tp+fn} → 見抜けた {tp} / 見逃し {fn}   鳴った音 {tn+fp} → 誤報 {fp}')
evaluate('学習なし（標準の音色のまま）')
sc = Score(probes.all_probes()['01_scale']['mml'])
x = synth.render(sc.notes, noise=1.0, harm=ODD)
tim, info = detect.learn_timbre(x, sc)
cfg = store.load_config(); cfg['timbre'] = {str(k): v for k, v in tim.items()}; store.save_config(cfg)
detect._TIMBRE['loaded'] = False
print(f'学習: {len(tim)}種類の高さ、 C4の倍音(dB) =', [round(v) for v in tim[60][:6]])
evaluate('学習あり')
