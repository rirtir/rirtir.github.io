"""録音から、MMLの各音が「鳴ったか／鳴らなかったか」を判定する。

手順
 1. 録音を読み込み（ffmpegで何でも読める）、スペクトル（STFT）を作る
 2. 演奏の開始時刻（と、あれば時間の伸び縮み）を、音符の並びと録音の変化の並びを突き合わせて求める
 3. 各時刻に鳴っているはずの音の高さだけを候補にして、スペクトルを非負最小二乗(NNLS)で分解する
    （倍音が重なる音があっても、同時に説明することで取り違えを減らす）
 4. 各音の始まりで、その高さの強さが立ち上がっているかを見て、鳴った／鳴らなかったを決める
"""
import subprocess

import numpy as np
from scipy.optimize import nnls
from scipy.signal import correlate, resample_poly

SR = 22050
NFFT = 2048
HOP = 256
BIN_HZ = SR / NFFT
FMIN, FMAX = 100.0, 5000.0

# ゲームのマンドリンを実測した倍音の強さ(dB)：D4以下 / E4以上
HARM = [
    [0, -7.8, -20, -38.5, -31.3, -23.4, -39.9, -42.8, -46, -46, -48, -48],
    [0, -32.7, -15.9, -28.6, -37.1, -29.5, -31.5, -38.9, -34, -40, -42, -44],
]


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def load_audio(path, sr=SR):
    """録音ファイル（wav / mkv / mp4 など）を、モノラルの float32 で読み込む"""
    cmd = ['ffmpeg', '-v', 'error', '-i', str(path), '-vn', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError('録音ファイルを読めませんでした: ' + r.stderr.decode('utf-8', 'replace')[:200])
    return np.frombuffer(r.stdout, dtype=np.float32).copy()


def stft_mag(x, nfft=NFFT, hop=HOP):
    """スペクトルの大きさ。戻り値 (bins x frames), 各フレームの中心時刻(秒)"""
    if len(x) < nfft:
        x = np.pad(x, (0, nfft - len(x)))
    n = 1 + (len(x) - nfft) // hop
    idx = np.arange(nfft)[None, :] + hop * np.arange(n)[:, None]
    fr = x[idx] * np.hanning(nfft)[None, :]
    M = np.abs(np.fft.rfft(fr, axis=1)).T / (nfft / 4)
    times = (np.arange(n) * hop + nfft / 2) / SR
    return M.astype(np.float32), times


def hann_resp(d):
    d = np.asarray(d, dtype=float)
    d = np.where(np.abs(np.abs(d) - 1) < 1e-6, d + 1e-6, d)
    return np.abs(np.sinc(d) / (1 - d ** 2))


_TIMBRE = {'loaded': False, 'data': {}}


def learned_profile(midi):
    """learn で覚えた音色（高さごとの倍音の強さ）。一番近い高さのものを使う。なければ None"""
    if not _TIMBRE['loaded']:
        try:
            import store
            _TIMBRE['data'] = {int(k): v for k, v in store.load_config().get('timbre', {}).items()}
        except Exception:
            _TIMBRE['data'] = {}
        _TIMBRE['loaded'] = True
    d = _TIMBRE['data']
    if not d:
        return None
    k = min(d, key=lambda p: abs(p - midi))
    return d[k] if abs(k - midi) <= 6 else None


_AMP = {'loaded': False, 'data': {}}


def learned_amp(midi):
    """learn で覚えた「その高さの音の標準の立ち上がりの大きさ」。近い高さ(±1)になければ None"""
    if not _AMP['loaded']:
        try:
            import store
            _AMP['data'] = {int(k): v for k, v in store.load_config().get('amp', {}).items()}
        except Exception:
            _AMP['data'] = {}
        _AMP['loaded'] = True
    d = _AMP['data']
    if not d:
        return None
    k = min(d, key=lambda q: abs(q - midi))
    return d[k] if abs(k - midi) <= 1 else None


def reset_learned():
    _TIMBRE['loaded'] = False
    _AMP['loaded'] = False


def make_template(midi, kmin, kmax):
    """ある高さの音が作るスペクトルの形（基音＋倍音。ハン窓の山の形で配置）"""
    f0 = mtof(midi)
    prof = learned_profile(midi) or HARM[0 if midi < 63.5 else 1]
    T = np.zeros(kmax - kmin + 1)
    for h, db in enumerate(prof, start=1):
        f = f0 * h
        if f > FMAX:
            break
        b = f / BIN_HZ
        for k in range(int(np.floor(b)) - 2, int(np.floor(b)) + 4):
            if kmin <= k <= kmax:
                T[k - kmin] += 10 ** (db / 20) * hann_resp(k - b)
    return T


# ---------------------------------------------------------------- 開始時刻の推定
def onset_flux(M):
    band = slice(int(150 / BIN_HZ), int(4000 / BIN_HZ))
    ref = np.percentile(M[band], 99) + 1e-9
    L = np.log1p(30 * M[band] / ref)
    fl = np.maximum(0, np.diff(L, axis=1, prepend=L[:, :1])).sum(axis=0)
    return np.convolve(fl, np.ones(3) / 3, mode='same')


def impulses(starts, dt, length, tau=0.0, scale=1.0):
    imp = np.zeros(length)
    for s in starts:
        p = (s * scale + tau) / dt
        i = int(np.floor(p))
        w = p - i
        if 0 <= i < length:
            imp[i] += 1 - w
        if 0 <= i + 1 < length:
            imp[i + 1] += w
    return imp


def _refine(flux, starts, tau, scale):
    """時間の伸び縮み（テンポのずれ）を、各音の近くの変化の山から求めて、tau と scale を直す"""
    dt = HOP / SR
    for _ in range(2):
        res, xs = [], []
        thr = np.median(flux) + 2 * np.median(np.abs(flux - np.median(flux))) + 1e-9
        for s in starts:
            p = (s * scale + tau) / dt
            lo, hi = int(p - 0.06 / dt), int(p + 0.06 / dt) + 1
            if lo < 0 or hi >= len(flux):
                continue
            j = lo + int(np.argmax(flux[lo:hi]))
            if flux[j] > thr * 2:
                res.append(j * dt - (s * scale + tau)); xs.append(s)
        if len(res) >= 8:
            res, xs = np.array(res), np.array(xs)
            keep = np.abs(res - np.median(res)) < 0.05
            if keep.sum() >= 6:
                A = np.vstack([np.ones(keep.sum()), xs[keep]]).T
                (a, b), *_ = np.linalg.lstsq(A, res[keep], rcond=None)
                tau += a
                scale += b
    return float(tau), float(np.clip(scale, 0.97, 1.03))


def align_candidates(flux, dt, notes, k=4):
    """演奏開始時刻の候補（一致の強い順に最大k個）。(tau, scale, z) のリスト。
    音が等間隔だと、1音ぶんずれた位置も同じくらい一致するので、候補を複数出しておく"""
    from scipy.signal import find_peaks
    starts = np.array(sorted({round(n['start_s'], 3) for n in notes}))
    dur = max(n['end_s'] for n in notes)
    L = int(dur / dt) + 4
    f = np.concatenate([flux - np.median(flux), np.zeros(L)])
    imp = impulses(starts, dt, L)
    corr = correlate(f, imp, mode='valid')[:len(flux)]
    pk, _ = find_peaks(corr, distance=max(1, int(0.12 / dt)), height=0.7 * corr.max())
    order = sorted(pk, key=lambda i: -corr[i])[:k] or [int(np.argmax(corr))]
    out = []
    for i in order:
        z = (corr[i] - corr.mean()) / (corr.std() + 1e-9)
        tau, scale = _refine(flux, starts, i * dt, 1.0)
        out.append((tau, scale, float(z)))
    return out


def align(flux, dt, notes):
    """演奏開始時刻 tau（録音の先頭から何秒後に楽譜の0秒が来るか）と、時間の伸び縮み scale、一致の強さ z"""
    return align_candidates(flux, dt, notes, 1)[0]


def _score_tau(M, times, notes, tau, scale):
    ns = [dict(n) for n in notes]
    analyze_notes(M, times, ns, tau, scale, 0)
    return sum(max(0.0, n['rise']) for n in ns)


def best_alignment(M, times, flux, notes, k=8, fine=False):
    """候補のうち、音の高さまで含めて一番よく合うもの（各音の立ち上がりの合計が最大）を選び、
    さらに時刻を少しずつ動かして、一番よく合うところに細かく合わせる"""
    cands = align_candidates(flux, HOP / SR, notes, k)
    if len(cands) == 1:
        best = (None, *cands[0])
    else:
        best = None
        for tau, scale, z in cands:
            tr = _score_tau(M, times, notes, tau, scale)
            if best is None or tr > best[0]:
                best = (tr, tau, scale, z)
    _, tau, scale, z = best
    if not fine:
        return float(tau), float(scale), float(z)
    # 細かい合わせ：音を間引いて（最大60音）、時刻を前後に動かして、立ち上がりの合計が最大のところを探す
    sub = notes if len(notes) <= 60 else [notes[i] for i in np.linspace(0, len(notes) - 1, 60).astype(int)]
    for span, step in ((0.4, 0.05), (0.04, 0.01)):
        cs = [(_score_tau(M, times, sub, tau + d, scale), tau + d) for d in np.arange(-span, span + 1e-9, step)]
        tau = max(cs)[1]
    return float(tau), float(scale), float(z)


# ---------------------------------------------------------------- 各音の判定
def analyze_notes(M, times, notes, tau, scale, octave_shift=0, params=None):
    """録音のスペクトル M から、各音の強さの立ち上がりを求める"""
    P = dict(pre=0.12, win_lo=0.02, win_hi=0.16, win_pad_lo=0.10, win_pad_hi=0.40,
             rel_thr=0.30, abs_thr=3.0, mid_thr=0.15)
    if params:
        P.update(params)
    kmin, kmax = int(FMIN / BIN_HZ), int(FMAX / BIN_HZ)
    nb = kmax - kmin + 1
    Y = M[kmin:kmax + 1]
    nf = Y.shape[1]
    # 楽譜上の各音（録音の時間に直す）
    for n in notes:
        n['t0'] = n['start_s'] * scale + tau
        n['t1'] = n['end_s'] * scale + tau
        n['mp'] = n['pitch'] + octave_shift
    exp_pitches = sorted({n['mp'] for n in notes})
    tmpl, dist_of = {}, {}
    for p in exp_pitches:
        tmpl[p] = make_template(p, kmin, kmax)
    for p in exp_pitches:                       # 隣の半音（比較用のおとり）
        for q in (p - 1, p + 1):
            if q not in exp_pitches and q not in tmpl:
                tmpl[q] = make_template(q, kmin, kmax)
    flat = np.ones(nb) * 0.02
    pink = 1.0 / (1 + np.arange(nb) / 20.0) * 0.1
    # 各高さが「鳴っているはずの区間」
    ivs = {p: [] for p in exp_pitches}
    for n in notes:
        ivs[n['mp']].append((n['t0'] - P['win_pad_lo'], n['t1'] + P['win_pad_hi']))
    act = {p: np.zeros(nf) for p in exp_pitches}
    dis = {p: np.zeros(nf) for p in exp_pitches}
    t_lo = min(n['t0'] for n in notes) - 0.5
    t_hi = max(n['t1'] for n in notes) + 1.0
    frames = np.where((times >= t_lo) & (times <= t_hi))[0]
    for t in frames:
        tt = times[t]
        on = [p for p in exp_pitches if any(a <= tt <= b for a, b in ivs[p])]
        if not on:
            continue
        cols, owner = [], []
        for p in on:
            cols.append(tmpl[p]); owner.append(('a', p))
        for p in on:
            for q in (p - 1, p + 1):
                if q not in on:
                    cols.append(tmpl[q]); owner.append(('d', p))
        cols.append(flat); owner.append(('n', 0)); cols.append(pink); owner.append(('n', 1))
        A = np.stack(cols, axis=1)
        x, _ = nnls(A, Y[:, t])
        for (kind, p), v in zip(owner, x):
            if kind == 'a':
                act[p][t] = v
            elif kind == 'd':
                dis[p][t] = max(dis[p][t], v)
    # 各音の「立ち上がり」
    dt = HOP / SR
    for n in notes:
        a = act[n['mp']]
        s = n['t0']
        i_pre0, i_pre1 = int((s - P['pre']) / dt), int((s - 0.01) / dt)
        i_w0, i_w1 = int((s + P['win_lo']) / dt), int((s + P['win_hi']) / dt) + 1
        # 窓の中心時刻とフレーム番号の対応（times[0] = NFFT/2/SR）
        off = times[0] / dt
        i_pre0, i_pre1, i_w0, i_w1 = [int(round(v - off)) for v in (i_pre0, i_pre1, i_w0, i_w1)]
        i_pre0, i_w0 = max(0, i_pre0), max(0, i_w0)
        peak = float(a[i_w0:max(i_w1, i_w0 + 1)].max()) if i_w0 < nf else 0.0
        pre = float(a[i_pre0:max(i_pre1, i_pre0 + 1)].min()) if i_pre0 < nf else 0.0
        dpk = float(dis[n['mp']][i_w0:max(i_w1, i_w0 + 1)].max()) if i_w0 < nf else 0.0
        n['peak'], n['pre'], n['rise'], n['distractor'] = peak, pre, peak - pre, dpk
        # 最大の立ち上がりの時刻（時間のずれの目安）
        seg = a[i_w0:max(i_w1, i_w0 + 1)]
        n['t_peak_off'] = float(((int(np.argmax(seg)) + i_w0 + off) * dt) - s) if len(seg) else 0.0
    return act, dis


def decide(notes, params=None):
    """立ち上がりの大きさから、鳴った(True)／鳴らなかった(False)／はっきりしない(None) を決める"""
    P = dict(rel_thr=0.30, mid_thr=0.15)
    if params:
        P.update(params)
    # 基準の大きさ：パートごとの立ち上がりの中央値（大半の音が鳴っている前提）
    by_part_notes = {}
    for n in notes:
        by_part_notes.setdefault(n['part'], []).append(n)
    allr = np.array([n['rise'] for n in notes])
    # 基準：音の高さごとの標準の大きさ（learn で覚えたもの）に、パートごとの音量の違いを掛けたもの。
    # （ゲームの音は、音域でかなり大きさが違う。半音階の録音で、その高さの音が普通に鳴ったときの大きさを測ってある）
    pct = lambda v: float(np.percentile(v, 85)) if len(v) else 0.0
    ref_all = pct([r for r in allr if r > 0]) or 1.0
    gain = {}
    for part, ns_ in by_part_notes.items():
        ratios = []
        for m in ns_:
            e = learned_amp(m['mp'])
            m['_exp'] = e
            if e and m['rise'] > 0:
                ratios.append(m['rise'] / e)
        gain[part] = pct(ratios)
    for n in notes:
        e = n.get('_exp')
        if e and gain.get(n['part']):
            n['_ref'] = gain[n['part']] * e
            continue
        # 標準の大きさが分からない音は、同じパートの近い高さの音の、上位15%を基準にする
        peers = [m for m in by_part_notes[n['part']] if m['rise'] > 0]
        for w in (4, 8, 14, 200):
            near = [m['rise'] for m in peers if abs(m['mp'] - n['mp']) <= w]
            if len(near) >= 10:
                break
        n['_ref'] = pct(near) or ref_all
    for n in notes:
        r = n.pop('_ref')
        n.pop('_exp', None)
        n['ref'] = r
        n['rel'] = n['rise'] / (r + 1e-12)
        if n['rel'] >= P['rel_thr']:
            n['detected'] = True
        elif n['rel'] < P['mid_thr']:
            n['detected'] = False
        else:
            n['detected'] = None
    # 同じ高さの音が近くにあると、録音の上では区別しにくい（連打・ユニゾン）ので、確かさを下げる
    for n in notes:
        near = [m for m in notes if m is not n and m['mp'] == n['mp']
                and m['t0'] < n['t1'] + 0.15 and m['t1'] > n['t0'] - 0.35]
        n['ambiguous'] = bool(near)
        n['low_register'] = n['mp'] < 48            # 低い音は、半音の間隔が狭すぎて、この解析では分けにくい
        n['confidence'] = 'low' if (near or n['low_register']) else 'high'
    return notes


def run_analysis(x, score, octave_candidates=(0,), params=None):
    """録音 x（22050Hz, モノラル）と Score から、各音の判定結果を返す"""
    M, times = stft_mag(x)
    flux = onset_flux(M)
    dt = HOP / SR
    notes_base = score.notes
    tau, scale, z = best_alignment(M, times, flux, notes_base)
    cands = []
    for osh in octave_candidates:
        ns = [dict(n) for n in notes_base]
        analyze_notes(M, times, ns, tau, scale, osh, params)
        decide(ns, params)
        total_rise = sum(max(0.0, n['rise']) for n in ns)
        cands.append((total_rise, osh, ns))
    # 1オクターブ違いは倍音のせいで「鳴った音の数」がほぼ同じになる。立ち上がりの合計で比べ、
    # 楽譜どおり(0)を基本にして、ほかが1.5倍以上よいときだけ採用する
    base = next((c for c in cands if c[1] == 0), cands[0])
    top = max(cands, key=lambda c: c[0])
    best = (None, top[1], top[2]) if top[0] >= 1.5 * base[0] else (None, base[1], base[2])
    _, osh, ns = best
    info = dict(tau=tau, scale=scale, align_z=z, octave_shift=osh, frames=len(times),
                duration_rec=len(x) / SR)
    return ns, info, M, times


def learn_timbre(x, score, params=None):
    """「楽譜の音が全部鳴っている録音」から、音色（高さごとの倍音の強さ）を測って返す。
    戻り値: {音の高さ(MIDI): [基音を0dBとした倍音1〜8の強さ(dB)]}"""
    M, times = stft_mag(x)
    flux = onset_flux(M)
    tau, scale, z = best_alignment(M, times, flux, score.notes)
    per = {}
    for n in score.notes:
        t0 = n['start_s'] * scale + tau
        fr = np.where((times >= t0 + 0.05) & (times <= t0 + min(0.25, n['dur_s'] * scale)))[0]
        if len(fr) == 0:
            continue
        f0 = mtof(n['pitch'])
        amps = []
        for h in range(1, 9):
            f = f0 * h
            if f > FMAX:
                break
            b = int(round(f / BIN_HZ))
            amps.append(float(M[max(0, b - 1):b + 2, fr].max(axis=0).mean()))
        if len(amps) >= 3 and amps[0] > 1e-6:
            per.setdefault(n['pitch'], []).append([20 * np.log10(a / amps[0] + 1e-6) for a in amps])
    out = {}
    for p, v in per.items():
        L = max(len(a) for a in v)
        arr = np.full((len(v), L), np.nan)
        for i, a in enumerate(v):
            arr[i, :len(a)] = a
        prof = np.nanmedian(arr, axis=0)
        out[p] = [0.0] + [float(max(-60.0, q)) for q in prof[1:]]
    return out, dict(tau=tau, scale=scale, z=z)
