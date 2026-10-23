"""実機の確認：疑似演奏を実際にスピーカーから鳴らし、録音機能で録って、解析まで通す。
1音だけ抜いておき、見つけられるかを見る。（短い・小さい音量で鳴ります）"""
import os, sys, tempfile, time, threading
tmp = tempfile.mkdtemp(prefix='mmlverify_'); os.environ['MML_VERIFY_DATA'] = tmp
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np, soundcard as sc
from scipy.signal import resample_poly
import synth, detect, probes, recorder, features, report
from mmlparse import Score

name_part = sys.argv[1] if len(sys.argv) > 1 else 'EV2795'
spk = next(s for s in sc.all_speakers() if name_part in s.name)
dev = next(m for m in recorder.loopback_devices() if name_part in m.name)
print('出力先:', spk.name)
mml = probes.all_probes()['04_two_third']['mml']
S = Score(mml); features.add_features(S.notes)
victim = next(n for n in S.notes if n['part'] == 0 and n['idx'] == 5)
x22 = synth.render(S.notes, drop={victim['gid']}, offset=0.5, gain=0.12)
x48 = resample_poly(x22, 320, 147).astype(np.float32)
rec = recorder.Recorder(dev); rec.start(); time.sleep(1.0)
t0 = time.time()
with spk.player(samplerate=48000, channels=1) as p:
    p.play(x48)
time.sleep(1.0)
x = rec.stop()
print(f'再生 {len(x48)/48000:.1f}秒 / 録音 {len(x)/48000:.1f}秒 / 録音の最大音量 {np.abs(x).max():.3f}')
x = resample_poly(x, 147, 320).astype(np.float32)
ns, info, M, times = detect.run_analysis(x, S, octave_candidates=(0, -12, 12))
print(report.text_report(S, ns, info, '実機の確認'))
print('抜いた音:', f"メロディの{victim['idx']+1}番目 {victim['name']} {victim['start_s']:.2f}秒")
