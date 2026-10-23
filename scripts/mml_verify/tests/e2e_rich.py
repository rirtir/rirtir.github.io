"""長い曲で、解析→記録→パターン別の集計までを通して確かめる。
「ずらして入る区間で、3つ目に入る音が抜ける」という隠れた法則を仮定して録音を作り、見つけられるか見る。"""
import os, sys, tempfile, io, contextlib
os.environ['MML_VERIFY_DATA'] = tempfile.mkdtemp(prefix='mmlverify_')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np, synth, features, probes, patterns, run
from mmlparse import Score
P = probes.all_probes()
for name in ['R1_t110', 'R2_t130', 'R3_t90']:
    for rep in range(2):
        sc = Score(P[name]['mml']); features.add_features(sc.notes)
        for n in sc.notes:
            for a, b, kind in P[name]['sections']:
                if a <= n['start_s'] < b: n['sec'] = kind
        # 隠れた法則：「ずらして入る」区間の、2番目より後に入る音（和音2）が、3回に1回抜ける
        drop = {n['gid'] for n in sc.notes if n.get('sec') == 'stagger' and n['part'] == 2 and n['gid'] % 3 == 0}
        x = synth.render(sc.notes, drop=drop, offset=2.0 + rep, noise=1.0, seed=rep)
        with contextlib.redirect_stdout(io.StringIO()):
            run.analyze_and_save(P[name]['mml'], x, 'probe:' + name, sid=f'{name}-{rep}')
        print(f'{name} {rep}: 本当に抜いた {len(drop)}')
txt = patterns.report()
i = txt.index('曲の中のパターン')
print(txt[:txt.index('■ 一番')][:900]); print('...'); print(txt[i:i + 900])
