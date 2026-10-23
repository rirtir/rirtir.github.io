"""疑似ゲーム録音の生成（解析の自己検証用）。

ゲームのマンドリンを実測した値（Audio/MMLComposer の「マンドリン風」と同じ）で音を合成し、
指定した音を「鳴らさない」ことで、わざと音が抜けた録音を作る。BGM・雑音・時間のずれも混ぜられる。
"""
import numpy as np

SR_DEFAULT = 22050
# 倍音の強さ(dB)：D4以下 / E4以上
HARM = [
    [0, -7.8, -20, -38.5, -31.3, -23.4, -39.9, -42.8, -46, -46, -48, -48],
    [0, -32.7, -15.9, -28.6, -37.1, -29.5, -31.5, -38.9, -34, -40, -42, -44],
]
ENV = [(0.04, 1.0), (0.3, 0.33), (0.5, 0.19), (1.0, 0.095), (2.5, 0.012), (8.0, 0.0005)]


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env_at(tau):
    tau = np.asarray(tau, dtype=float)
    out = np.zeros_like(tau)
    a = tau < ENV[0][0]
    out[a] = 0.12 + 0.88 * tau[a] / ENV[0][0]
    for (t1, v1), (t2, v2) in zip(ENV[:-1], ENV[1:]):
        m = (tau >= t1) & (tau < t2)
        out[m] = v1 * (v2 / v1) ** ((tau[m] - t1) / (t2 - t1))
    return out


def note_wave(midi, dur, sr=SR_DEFAULT, vol=1.0, rel=0.08, harm=None):
    """1音ぶんの波形（音の長さ dur 秒＋切れる時間 rel 秒）"""
    n = int((dur + rel) * sr)
    tt = np.arange(n) / sr
    f0 = mtof(midi)
    prof = (harm or HARM)[0 if midi < 63.5 else 1]
    w = np.zeros(n)
    for h, db in enumerate(prof, start=1):
        if f0 * h > sr * 0.45:
            break
        w += 10 ** (db / 20) * np.sin(2 * np.pi * f0 * h * tt)
    e = env_at(tt) * np.where(tt > dur, np.clip(1 - (tt - dur) / rel, 0, 1) ** 2, 1.0)
    return w * e * vol


def render(notes, drop=(), sr=SR_DEFAULT, lead=1.5, tail=2.0, offset=0.0, scale=1.0, gain=0.3,
           bgm=0.0, noise=0.0, seed=0, vol_by_part=None, harm=None):
    """notes: Score.notes のリスト。drop: 鳴らさない音の gid の集合。
    offset: 演奏開始までの無音(秒)に足す量、scale: 時間の伸び縮み、bgm/noise: 混ぜる大きさ(0〜)"""
    rng = np.random.default_rng(seed)
    total = max(n['end_s'] for n in notes) * scale + lead + tail + offset
    out = np.zeros(int(total * sr))
    for n in notes:
        if n['gid'] in drop:
            continue
        v = (n['vol'] / 15.0) ** 1.4 if vol_by_part is None else vol_by_part[n['part']]
        w = note_wave(n['pitch'], n['dur_s'] * scale, sr, v, harm=harm)
        i0 = int((lead + offset + n['start_s'] * scale) * sr)
        out[i0:i0 + len(w)] += w[:len(out) - i0]
    out *= gain
    if bgm > 0:      # 持続する和音（BGMのつもり）をゆっくり入れ替えながら流す
        t = np.arange(len(out)) / sr
        seg = 3.0
        for k in range(int(total / seg) + 1):
            root = int(rng.integers(45, 65))
            for iv in (0, 4, 7, 12):
                f = mtof(root + iv)
                m = (t >= k * seg) & (t < (k + 1) * seg + 0.5)
                fade = np.clip(np.minimum(t[m] - k * seg, (k + 1) * seg + 0.5 - t[m]) / 0.5, 0, 1)
                out[m] += bgm * 0.08 * fade * (np.sin(2 * np.pi * f * t[m]) + 0.3 * np.sin(2 * np.pi * 2 * f * t[m]))
    if noise > 0:
        out += noise * 0.01 * rng.standard_normal(len(out))
    return out.astype(np.float32)
