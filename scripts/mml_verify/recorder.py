"""ゲームの音（パソコンから出ている音）を録音する。Windows の WASAPI ループバックを使う。

  - 出力先（スピーカー等）ごとに録音できる。ゲームの音がどの出力先から出ているかは
    calibrate（自動判定）で探して、.local/mml_verify/config.json に覚えておく。
  - OBS などで録った動画・音声ファイルを、そのまま解析に使うこともできる（recorder は不要）。
"""
import sys
import threading
import time
import warnings

import numpy as np

import store

warnings.filterwarnings('ignore')
SR_REC = 48000


def _sc():
    try:
        import soundcard as sc
        return sc
    except ImportError:
        raise SystemExit('録音には soundcard が必要です:  pip install soundcard')


def loopback_devices():
    sc = _sc()
    return [m for m in sc.all_microphones(include_loopback=True) if getattr(m, 'isloopback', False)]


def list_devices():
    sc = _sc()
    cfg = store.load_config()
    print('パソコンから出ている音を録音できる出力先（ループバック）:')
    for i, m in enumerate(loopback_devices()):
        mark = '  ← 既定のスピーカー' if m.name == sc.default_speaker().name else ''
        sel = '  ★選択中' if cfg.get('device') == m.name else ''
        print(f'  [{i}] {m.name}{mark}{sel}')


def find_device(name_or_index=None):
    devs = loopback_devices()
    if name_or_index is None:
        name_or_index = store.load_config().get('device')
    if name_or_index is None:
        sc = _sc()
        name_or_index = sc.default_speaker().name
    if isinstance(name_or_index, str) and name_or_index.isdigit():
        name_or_index = int(name_or_index)
    if isinstance(name_or_index, int):
        return devs[name_or_index]
    for m in devs:
        if m.name == name_or_index:
            return m
    for m in devs:
        if str(name_or_index).lower() in m.name.lower():
            return m
    raise SystemExit(f'録音できる出力先が見つかりません: {name_or_index}（devices で一覧を確認してください）')


class Recorder:
    def __init__(self, device, sr=SR_REC):
        self.device, self.sr = device, sr
        self.blocks, self._stop, self.level, self.peak = [], threading.Event(), 0.0, 0.0
        self._th = None
        self.error = None

    def start(self):
        self._th = threading.Thread(target=self._run, daemon=True)
        self._th.start()

    def _run(self):
        try:
            with self.device.recorder(samplerate=self.sr, channels=2, blocksize=4096) as r:
                while not self._stop.is_set():
                    d = r.record(numframes=2048)
                    self.blocks.append(d.astype(np.float32).mean(axis=1))
                    self.level = float(np.abs(self.blocks[-1]).max())
                    self.peak = max(self.peak, self.level)
        except Exception as e:           # 録音が始められない／途中で失敗
            self.error = e

    def stop(self):
        self._stop.set()
        if self._th:
            self._th.join(timeout=5)
        if self.error:
            raise RuntimeError(f'録音でエラーが出ました: {self.error}')
        return np.concatenate(self.blocks) if self.blocks else np.zeros(0, np.float32)

    @property
    def seconds(self):
        return sum(len(b) for b in self.blocks) / self.sr


def record_until_stop(devices, auto_stop=None, expect_seconds=None):
    """録音を開始し、Enter が押されるまで（または自動停止まで）録音する。
    devices が複数なら全部を同時に録音し、一番音が大きかった出力先の録音を返す。
    戻り値: (波形, サンプルレート, 選ばれた出力先の名前)"""
    if not isinstance(devices, (list, tuple)):
        devices = [devices]
    recs = [Recorder(d) for d in devices]
    for r in recs:
        r.start()
    stop_flag = threading.Event()

    def enter_pressed():
        """Enter が押されたか（裏で入力待ちをしない方式：自動停止のあとに、次の入力を横取りしないため）"""
        try:
            import msvcrt
            hit = False
            while msvcrt.kbhit():
                if msvcrt.getwch() in ('\r', '\n'):
                    hit = True
            return hit
        except ImportError:
            return False

    t0 = time.time()
    heard, last_sound, first_sound = False, time.time(), None
    try:
        while not stop_flag.is_set():
            time.sleep(0.2)
            if enter_pressed():
                break
            top = max(recs, key=lambda r: r.peak)
            lv = max(r.level for r in recs)
            if lv > 0.003:
                if not heard:
                    first_sound = time.time()
                heard, last_sound = True, time.time()
            bar = '#' * min(30, int(lv * 120))
            where = f'  [{top.device.name[:24]}]' if len(recs) > 1 and heard else ''
            sys.stdout.write('\r  録音中 %5.1f秒  音量 |%-30s|' % (time.time() - t0, bar) + ('  (音を検出)' if heard else '  (まだ無音)') + where + '   ')
            sys.stdout.flush()
            if all(r.error for r in recs):
                break
            if auto_stop and heard and time.time() - last_sound > auto_stop and (not expect_seconds or time.time() - first_sound > expect_seconds * 0.9):
                print(f'\n  {auto_stop:g}秒間の無音を検出したので、自動で停止します')
                break
    except KeyboardInterrupt:
        pass
    print()
    results = []
    for r in recs:
        try:
            x = r.stop()
        except Exception:
            continue
        rms = float(np.sqrt((x ** 2).mean())) if len(x) else 0.0
        results.append((rms, x, r.sr, r.device.name))
    if not results:
        raise RuntimeError('どの出力先でも録音を始められませんでした。')
    results.sort(key=lambda t: -t[0])
    rms, x, sr, name = results[0]
    return x, sr, name


def calibrate(seconds=8):
    """全部の出力先を同時に録音して、音が出ている出力先を探し、設定に保存する"""
    devs = loopback_devices()
    print(f'ゲーム（または何か音）を {seconds} 秒間、普通に鳴らしてください。全部の出力先を録音して、音が出ている所を探します…')
    recs = [Recorder(d) for d in devs]
    for r in recs:
        r.start()
    t0 = time.time()
    while time.time() - t0 < seconds:
        time.sleep(0.5)
        sys.stdout.write(f'\r  残り {seconds - (time.time() - t0):4.1f}秒 ')
        sys.stdout.flush()
    print()
    res = []
    for d, r in zip(devs, recs):
        try:
            x = r.stop()
            rms = float(np.sqrt((x ** 2).mean())) if len(x) else 0.0
            pk = float(np.abs(x).max()) if len(x) else 0.0
        except Exception:
            rms = pk = 0.0
        res.append((rms, pk, d.name))
    res.sort(reverse=True)
    for rms, pk, name in res:
        print(f'  {name:55s} 平均 {rms:.4f}  最大 {pk:.3f}')
    if res and res[0][1] > 0.003:
        cfg = store.load_config()
        cfg['device'] = res[0][2]
        store.save_config(cfg)
        print(f'→ 「{res[0][2]}」を録音先として覚えました。')
        return res[0][2]
    print('→ どの出力先でも音を検出できませんでした。音が出ている状態で、もう一度試してください。')
    return None
