"""全出力先を同時に録音して、音が出ている出力先を自動で選べるかの確認（短く小さい音で鳴ります）"""
import os, sys, tempfile, time, threading
os.environ['MML_VERIFY_DATA'] = tempfile.mkdtemp(prefix='mmlverify_')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np, soundcard as sc
import recorder
name_part = sys.argv[1] if len(sys.argv) > 1 else 'EV2795'
spk = next(s for s in sc.all_speakers() if name_part in s.name)
devs = recorder.loopback_devices()
print('録音する出力先の数:', len(devs))
tone = (0.1 * np.sin(2 * np.pi * 440 * np.arange(48000) / 48000)).astype(np.float32)
def play():
    time.sleep(1.5)
    with spk.player(samplerate=48000, channels=1) as p:
        p.play(tone)
threading.Thread(target=play, daemon=True).start()
# Enter の代わりに、音が止まって自動停止させる（期待する長さ 1 秒）
x, sr, name = recorder.record_until_stop(devs, auto_stop=2.0, expect_seconds=1.0)
print('選ばれた出力先:', name, '／ 録音', round(len(x) / sr, 1), '秒、最大', round(float(np.abs(x).max()), 3))
