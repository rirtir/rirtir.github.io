"""黎明列車 2.1 用のオリジナルBGM・効果音を生成する。

外部素材やサンプル音源は使用せず、加算合成、ノイズ励振、物理モデリング風の
弦、残響処理から音声ファイルを作る。実行時依存: numpy / scipy / soundfile。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal


SR = 32_000
ROOT = Path(__file__).resolve().parents[1]
BGM_DIR = ROOT / "assets" / "audio" / "bgm"
SFX_DIR = ROOT / "assets" / "audio" / "sfx"
RNG = np.random.default_rng(731_019)


def midi(note: float) -> float:
    return 440.0 * 2.0 ** ((note - 69.0) / 12.0)


def envelope(length: int, attack: float, release: float, sustain: float = 1.0) -> np.ndarray:
    env = np.full(length, sustain, dtype=np.float32)
    a = min(length, max(1, int(attack * SR)))
    r = min(length, max(1, int(release * SR)))
    env[:a] = np.sin(np.linspace(0, np.pi / 2, a, endpoint=True)) ** 1.7
    env[-r:] *= np.cos(np.linspace(0, np.pi / 2, r, endpoint=True)) ** 1.5
    return env


def lowpass(x: np.ndarray, hz: float, order: int = 3) -> np.ndarray:
    sos = signal.butter(order, min(0.98, hz / (SR / 2)), btype="low", output="sos")
    return signal.sosfilt(sos, x).astype(np.float32)


def highpass(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, max(0.001, hz / (SR / 2)), btype="high", output="sos")
    return signal.sosfilt(sos, x).astype(np.float32)


def bandpass(x: np.ndarray, low: float, high: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, [low / (SR / 2), high / (SR / 2)], btype="band", output="sos")
    return signal.sosfilt(sos, x).astype(np.float32)


def bowed(freq: float, duration: float, dark: float = 0.5) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n, dtype=np.float64) / SR
    vibrato = 0.0028 * np.sin(2 * np.pi * (4.7 + RNG.uniform(-0.25, 0.25)) * t)
    phase = 2 * np.pi * freq * t + vibrato * freq
    out = np.zeros(n, dtype=np.float64)
    harmonics = 8 if dark > 0.5 else 12
    for h in range(1, harmonics + 1):
        strength = 1.0 / (h ** (1.28 + dark * 0.5))
        out += strength * np.sin(h * phase + RNG.uniform(0, 2 * np.pi))
    bow = bandpass(RNG.normal(0, 1, n).astype(np.float32), 280, 4_200) * (0.025 + 0.018 * dark)
    out = out.astype(np.float32) + bow
    out = lowpass(out, 2_400 + (1 - dark) * 3_800)
    return out * envelope(n, min(0.55, duration * 0.22), min(0.9, duration * 0.3), 0.82)


def breath(freq: float, duration: float) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n, dtype=np.float64) / SR
    phase = 2 * np.pi * freq * t + 0.9 * np.sin(2 * np.pi * 5.1 * t)
    out = (
        np.sin(phase)
        + 0.34 * np.sin(3 * phase + 0.3)
        + 0.13 * np.sin(5 * phase + 1.1)
    ).astype(np.float32)
    air = bandpass(RNG.normal(0, 1, n).astype(np.float32), 900, 6_500) * 0.035
    return lowpass(out + air, 5_200) * envelope(n, 0.12, 0.28, 0.72)


def piano(freq: float, duration: float = 3.8, soft: bool = True) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n, dtype=np.float64) / SR
    out = np.zeros(n, dtype=np.float64)
    for h, amp, decay in [(1, 1.0, 1.5), (2.003, 0.44, 1.18), (3.012, 0.21, 0.92), (4.03, 0.1, 0.68)]:
        out += amp * np.sin(2 * np.pi * freq * h * t + RNG.uniform(0, 1.4)) * np.exp(-t / decay)
    hammer = highpass(RNG.normal(0, 1, n).astype(np.float32), 1_400) * np.exp(-t / 0.018) * (0.035 if soft else 0.07)
    body = lowpass(out.astype(np.float32), 5_500 if soft else 7_500)
    return (body + hammer.astype(np.float32)) * envelope(n, 0.006, 0.55, 0.9)


def pluck(freq: float, duration: float = 1.15, damping: float = 0.992) -> np.ndarray:
    n = int(duration * SR)
    delay = max(8, int(SR / freq))
    excitation = np.zeros(n, dtype=np.float32)
    excitation[:delay] = RNG.normal(0, 0.65, delay)
    denominator = np.zeros(delay + 1, dtype=np.float64)
    denominator[0] = 1.0
    denominator[-1] = -damping
    out = signal.lfilter([1.0], denominator, excitation).astype(np.float32)
    out = lowpass(out, 4_000)
    return out * envelope(n, 0.003, 0.3, 0.9)


def drum(duration: float = 1.25, pitch: float = 58.0, strength: float = 1.0) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n, dtype=np.float64) / SR
    phase = 2 * np.pi * (pitch * t + 24 * (1 - np.exp(-t * 22)))
    body = np.sin(phase) * np.exp(-t * 5.1)
    skin = lowpass(RNG.normal(0, 1, n).astype(np.float32), 620) * np.exp(-t * 14) * 0.46
    return ((body * 0.82 + skin).astype(np.float32) * envelope(n, 0.004, 0.4, 1.0) * strength)


def metal(duration: float = 1.2, low: bool = False) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n, dtype=np.float64) / SR
    base = 116 if low else 292
    partials = [(1.0, 0.46), (1.414, 0.26), (2.17, 0.18), (3.73, 0.1)]
    out = np.zeros(n, dtype=np.float64)
    for ratio, amp in partials:
        out += amp * np.sin(2 * np.pi * base * ratio * t + RNG.uniform(0, 2 * np.pi)) * np.exp(-t * (2.7 + ratio))
    strike = bandpass(RNG.normal(0, 1, n).astype(np.float32), 420, 7_000) * np.exp(-t * 32) * 0.32
    return (out.astype(np.float32) + strike.astype(np.float32)) * envelope(n, 0.002, 0.28, 1.0)


def wind(duration: float, dark: bool = False) -> np.ndarray:
    n = int(duration * SR)
    noise = RNG.normal(0, 1, n).astype(np.float32)
    base = bandpass(noise, 38 if dark else 70, 720 if dark else 1_900)
    t = np.arange(n) / SR
    swell = 0.45 + 0.25 * np.sin(2 * np.pi * t / 11.0) + 0.12 * np.sin(2 * np.pi * t / 4.7 + 1.2)
    return base * swell.astype(np.float32)


def place(track: np.ndarray, sound: np.ndarray, start: float, gain: float = 1.0, pan: float = 0.0) -> None:
    begin = max(0, int(start * SR))
    if begin >= len(track):
        return
    end = min(len(track), begin + len(sound))
    source = sound[: end - begin]
    left = np.sqrt((1 - np.clip(pan, -1, 1)) * 0.5)
    right = np.sqrt((1 + np.clip(pan, -1, 1)) * 0.5)
    track[begin:end, 0] += source * gain * left
    track[begin:end, 1] += source * gain * right


def add_reverb(track: np.ndarray, amount: float = 0.18, seconds: float = 1.65) -> np.ndarray:
    wet = np.zeros_like(track)
    # 長い畳み込みを避け、左右で異なる多数の反射を重ねる。生成時のメモリを
    # 抑えながら、客車・車庫のような短く暗い残響を作れる。
    taps = [
        (0.031, 0.42), (0.047, 0.34), (0.071, 0.28), (0.109, 0.23),
        (0.163, 0.19), (0.239, 0.15), (0.347, 0.12), (0.503, 0.095),
        (0.719, 0.072), (0.997, 0.052), (1.271, 0.036), (1.53, 0.025),
    ]
    for index, (delay, gain) in enumerate(taps):
        if delay > seconds:
            continue
        offset = int(delay * SR)
        source_channel = index % 2
        target_channel = (index // 2) % 2
        wet[offset:, target_channel] += track[:-offset, source_channel] * gain
    wet[:, 0] = lowpass(wet[:, 0], 5_100)
    wet[:, 1] = lowpass(wet[:, 1], 4_800)
    return track * (1 - amount) + wet * amount


def finish(track: np.ndarray, reverb: float = 0.18, loop: bool = True) -> np.ndarray:
    if reverb:
        track = add_reverb(track, reverb)
    for ch in range(2):
        track[:, ch] = highpass(track[:, ch], 28)
        track[:, ch] = lowpass(track[:, ch], 13_000)
    if loop:
        # HTMLAudioElementのループ境界でクリックが出ないよう、曲頭と曲末の
        # 160msだけゼロクロスへ寄せる。長い無音は作らず、呼吸程度に留める。
        n = min(int(0.16 * SR), len(track) // 16)
        track[:n] *= np.sin(np.linspace(0, np.pi / 2, n, dtype=np.float32))[:, None]
        track[-n:] *= np.cos(np.linspace(0, np.pi / 2, n, dtype=np.float32))[:, None]
    track = np.tanh(track * 0.92)
    peak = float(np.max(np.abs(track)))
    return (track * (0.86 / max(peak, 1e-6))).astype(np.float32)


def pad_chord(track: np.ndarray, start: float, duration: float, root: int, intervals: tuple[int, ...], gain: float, dark: float) -> None:
    pans = np.linspace(-0.58, 0.58, len(intervals))
    for note, pan in zip(intervals, pans):
        place(track, bowed(midi(root + note), duration, dark), start, gain, float(pan))


def title_music() -> np.ndarray:
    duration, bar = 64.0, 4.0
    track = np.zeros((int(duration * SR), 2), dtype=np.float32)
    place(track, wind(duration, True), 0, 0.055, -0.1)
    progression = [(38, (0, 7, 15)), (34, (0, 7, 16)), (41, (0, 7, 14)), (36, (0, 7, 15))]
    melody = [62, 65, 69, 67, 62, 60, 57, 60, 62, 65, 69, 72, 70, 69, 65, 62]
    for i in range(16):
        root, chord = progression[i % 4]
        pad_chord(track, i * bar, bar + 1.4, root, chord, 0.105, 0.72)
        place(track, bowed(midi(root - 12), bar + 1.1, 0.9), i * bar, 0.11, -0.12)
        place(track, piano(midi(melody[i]), 3.3, True), i * bar + (0.35 if i % 2 else 0.75), 0.15, (-0.3 if i % 2 else 0.28))
        if i in (3, 7, 11, 15):
            place(track, metal(1.7, True), i * bar + 3.25, 0.035, 0.42)
    return finish(track, 0.24)


def journey_music() -> np.ndarray:
    duration, bar = 64.0, 3.2
    track = np.zeros((int(duration * SR), 2), dtype=np.float32)
    place(track, wind(duration, False), 0, 0.033, 0.1)
    progression = [(45, (0, 7, 15)), (41, (0, 7, 16)), (48, (0, 7, 16)), (43, (0, 7, 14))]
    motif = [0, 7, 3, 10, 7, 12, 10, 7]
    for i in range(20):
        root, chord = progression[i % 4]
        pad_chord(track, i * bar, bar + 0.8, root, chord, 0.068, 0.58)
        place(track, bowed(midi(root - 12), bar + 0.6, 0.88), i * bar, 0.075, -0.18)
        for step in range(8):
            note = root + motif[step]
            place(track, pluck(midi(note), 0.92, 0.991), i * bar + step * (bar / 8), 0.043 if step else 0.06, -0.42 + step * 0.12)
        if i % 2 == 1:
            phrase = [root + 12, root + 15, root + 19, root + 15]
            for k, note in enumerate(phrase):
                place(track, breath(midi(note), 0.76), i * bar + 0.2 + k * 0.72, 0.052, 0.3)
        for beat in range(4):
            place(track, drum(0.65, 48, 0.42), i * bar + beat * (bar / 4), 0.032 if beat else 0.046, -0.05)
    return finish(track, 0.17)


def battle_music() -> np.ndarray:
    duration, bar = 48.0, 2.4
    track = np.zeros((int(duration * SR), 2), dtype=np.float32)
    place(track, wind(duration, True), 0, 0.052, 0)
    roots = [38, 39, 36, 41]
    ostinato = [0, 7, 3, 7, 0, 10, 7, 3]
    for i in range(20):
        root = roots[i % 4]
        pad_chord(track, i * bar, bar + 0.55, root, (0, 7, 15), 0.055, 0.82)
        for step, interval in enumerate(ostinato):
            place(track, pluck(midi(root + interval), 0.68, 0.988), i * bar + step * (bar / 8), 0.07, -0.55 + (step % 4) * 0.34)
        for beat in range(4):
            place(track, drum(0.82, 52 if beat % 2 == 0 else 69, 0.7), i * bar + beat * (bar / 4), 0.092 if beat == 0 else 0.052, 0)
        if i % 2:
            place(track, metal(0.8, i % 4 == 3), i * bar + bar * 0.72, 0.038, 0.58 if i % 4 else -0.58)
    return finish(track, 0.13)


def boss_music() -> np.ndarray:
    duration, bar = 56.0, 2.8
    track = np.zeros((int(duration * SR), 2), dtype=np.float32)
    place(track, wind(duration, True), 0, 0.075, 0)
    roots = [34, 35, 31, 38]
    for i in range(20):
        root = roots[i % 4]
        pad_chord(track, i * bar, bar + 0.9, root, (0, 6, 13, 17), 0.072, 0.9)
        place(track, bowed(midi(root - 12), bar + 0.7, 0.97), i * bar, 0.13, -0.08)
        for beat in (0, 1.5, 2.5):
            place(track, drum(1.15, 43 if beat == 0 else 54, 0.95), i * bar + beat * (bar / 4), 0.115 if beat == 0 else 0.07, -0.18 if beat == 1.5 else 0.18)
        if i % 2 == 0:
            for k, note in enumerate([root + 12, root + 13, root + 18]):
                place(track, breath(midi(note), 1.15), i * bar + 0.25 + k * 0.78, 0.052, 0.38)
        place(track, metal(1.3, True), i * bar + bar * 0.79, 0.046, -0.5 if i % 2 else 0.5)
    return finish(track, 0.2)


def ending_music() -> np.ndarray:
    duration, bar = 64.0, 4.0
    track = np.zeros((int(duration * SR), 2), dtype=np.float32)
    place(track, wind(duration, False), 0, 0.025, 0.15)
    progression = [(48, (0, 4, 7, 12)), (43, (0, 7, 12, 16)), (45, (0, 7, 12, 15)), (41, (0, 7, 12, 16))]
    melody = [67, 69, 72, 76, 74, 72, 69, 67, 64, 67, 69, 72, 76, 74, 72, 67]
    for i in range(16):
        root, chord = progression[i % 4]
        pad_chord(track, i * bar, bar + 1.3, root, chord, 0.095, 0.46)
        place(track, bowed(midi(root - 12), bar + 1.0, 0.84), i * bar, 0.075, -0.2)
        place(track, piano(midi(root), 3.4, True), i * bar + 0.12, 0.09, -0.32)
        place(track, piano(midi(root + 7), 2.9, True), i * bar + 1.4, 0.07, 0.32)
        place(track, breath(midi(melody[i]), 2.35), i * bar + 0.75, 0.056, 0.2)
    return finish(track, 0.27)


def noise_burst(duration: float, low_hz: float, high_hz: float, decay: float) -> np.ndarray:
    n = int(duration * SR)
    t = np.arange(n) / SR
    x = bandpass(RNG.normal(0, 1, n).astype(np.float32), low_hz, high_hz)
    return x * np.exp(-t * decay).astype(np.float32)


def sfx_track(duration: float) -> np.ndarray:
    return np.zeros((int(duration * SR), 2), dtype=np.float32)


def make_sfx() -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}

    x = sfx_track(0.34)
    place(x, noise_burst(0.24, 100, 1_800, 19), 0, 0.25, -0.12)
    place(x, metal(0.28, True), 0.025, 0.18, 0.12)
    out["confirm"] = finish(x, 0.08, False)

    x = sfx_track(0.78)
    place(x, noise_burst(0.42, 45, 520, 7), 0, 0.35, -0.2)
    place(x, metal(0.62, True), 0.09, 0.27, 0.22)
    place(x, noise_burst(0.52, 720, 8_000, 4.5), 0.23, 0.11, 0.3)
    out["lever"] = finish(x, 0.13, False)

    x = sfx_track(0.28)
    place(x, noise_burst(0.24, 180, 1_100, 18), 0, 0.22, 0.05)
    out["cancel"] = finish(x, 0.04, False)

    x = sfx_track(0.56)
    for i, at in enumerate((0, 0.07, 0.15, 0.25)):
        place(x, noise_burst(0.2, 900, 9_000, 15), at, 0.1 - i * 0.012, -0.35 + i * 0.22)
    out["paper"] = finish(x, 0.06, False)
    out["story"] = out["paper"].copy()

    x = sfx_track(0.52)
    for at, pan in ((0, -0.22), (0.19, 0.24)):
        place(x, noise_burst(0.26, 65, 720, 13), at, 0.22, pan)
        place(x, metal(0.22, True), at + 0.03, 0.09, pan)
    out["move"] = finish(x, 0.07, False)

    x = sfx_track(0.88)
    place(x, noise_burst(0.52, 35, 9_000, 8), 0, 0.48, 0)
    place(x, drum(0.84, 46, 1.25), 0, 0.45, -0.12)
    place(x, metal(0.7, True), 0.018, 0.22, 0.15)
    out["attack"] = finish(x, 0.14, False)

    x = sfx_track(0.72)
    place(x, noise_burst(0.48, 45, 2_600, 9), 0, 0.42, 0)
    place(x, metal(0.66, True), 0, 0.35, -0.1)
    place(x, metal(0.42, False), 0.04, 0.16, 0.25)
    out["hit"] = finish(x, 0.12, False)

    x = sfx_track(1.05)
    for i in range(5):
        place(x, metal(0.27, False), i * 0.14, 0.11, -0.32 + i * 0.16)
    place(x, noise_burst(0.82, 90, 1_400, 3.6), 0.12, 0.08, 0)
    out["repair"] = finish(x, 0.1, False)

    x = sfx_track(1.35)
    hiss = bandpass(RNG.normal(0, 1, int(1.25 * SR)).astype(np.float32), 600, 10_500)
    hiss *= envelope(len(hiss), 0.12, 0.48, 0.72)
    place(x, hiss, 0, 0.26, 0.1)
    place(x, noise_burst(1.1, 45, 330, 2.8), 0.03, 0.14, -0.2)
    out["steam"] = finish(x, 0.1, False)

    x = sfx_track(2.35)
    reverse = noise_burst(1.5, 150, 7_500, 0.7)[::-1].copy()
    place(x, reverse, 0, 0.13, 0)
    place(x, metal(1.7, False), 1.16, 0.22, 0.25)
    place(x, noise_burst(1.15, 650, 10_000, 2.4), 1.05, 0.13, -0.25)
    out["victory"] = finish(x, 0.22, False)

    x = sfx_track(2.55)
    place(x, drum(2.2, 39, 1.15), 0, 0.46, 0)
    place(x, metal(2.0, True), 0.16, 0.32, -0.25)
    place(x, noise_burst(2.2, 28, 640, 1.25), 0.08, 0.3, 0.2)
    out["defeat"] = finish(x, 0.23, False)
    return out


def write_ogg(path: Path, data: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Windows版libsndfileは長いVorbis配列を一度に渡すとスタックを使い切る
    # 場合があるため、1秒ずつストリーム書き込みする。
    with sf.SoundFile(path, mode="w", samplerate=SR, channels=2, format="OGG", subtype="VORBIS") as output:
        for start in range(0, len(data), SR):
            output.write(data[start : start + SR])
    print(f"{path.relative_to(ROOT)}  {len(data) / SR:.2f}s")


def main() -> None:
    BGM_DIR.mkdir(parents=True, exist_ok=True)
    SFX_DIR.mkdir(parents=True, exist_ok=True)
    tracks = {
        "title": title_music,
        "journey": journey_music,
        "battle": battle_music,
        "boss": boss_music,
        "ending": ending_music,
    }
    for name, build in tracks.items():
        print(f"rendering BGM: {name}")
        write_ogg(BGM_DIR / f"{name}.ogg", build())
    print("rendering SFX")
    for name, audio in make_sfx().items():
        write_ogg(SFX_DIR / f"{name}.ogg", audio)


if __name__ == "__main__":
    main()
