"""疑似録音で、解析→記録→法則探し までを通して確かめる。
「ゲーム側に隠れた法則がある」と仮定して録音を作り、法則探しがそれを見つけられるかを見る。
実際の結果とは混ぜないよう、保存先は一時フォルダにする。"""
import os, sys, tempfile
tmp = tempfile.mkdtemp(prefix='mmlverify_')
os.environ['MML_VERIFY_DATA'] = tmp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np, synth, features, probes, patterns, run
from mmlparse import Score

def hidden_rule(n):           # 例：3パートが同時に鳴っている音のうち、5音に1音だけ鳴らない（2パートでは鳴る）
    return n['f_parts_active'] >= 3 and n['gid'] % 5 == 0

names = ['00a_melody_chord1', '00b_melody_chord2', '00c_chord1_chord2', '00d_all3', '00e_perm_102', '00e_perm_210', '07_triads', '20_random1', '20_random2']
P = probes.all_probes()
for rep in range(2):          # 2回ずつ（再現性の確認）
    for name in names:
        sc = Score(P[name]['mml']); features.add_features(sc.notes)
        drop = {n['gid'] for n in sc.notes if hidden_rule(n)}
        x = synth.render(sc.notes, drop=drop, offset=1.0 + 0.3 * rep, noise=1.0, seed=rep)
        import io, contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            run.analyze_and_save(P[name]['mml'], x, 'probe:' + name, note=f'隠れた法則の試験 {rep}', sid=f'{name}-{rep}')
        print(f'{name} {rep}: 音{len(sc.notes)} 本当に抜いた{len(drop)}')
print(patterns.report())
print('保存先', tmp)
