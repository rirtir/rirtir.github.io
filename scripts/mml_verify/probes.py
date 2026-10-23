"""「どんな条件で音が鳴らなくなるか」を切り分けるための、検証用のMMLを作る。

どれも決まった内容（毎回同じ）。1つずつゲームに貼って演奏し、結果をためて比べる。
 - 1つのことだけを変えたMML（音の高さ・同じ音の連打・速さ・同時に鳴らす数・長い音+速い音…）
 - ランダムなMML（いろいろな条件が混ざったものを集めて、統計で法則を探す）
"""
import numpy as np

NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b']


def N(m, ln):
    """音：MIDI番号 m、長さ ln（4=4分音符…）"""
    return f'o{m // 12 - 1}{NAMES[m % 12]}{ln}'


def R(ln):
    return f'r{ln}'


def build(parts, tempo=120, vols=(12, 8, 8)):
    ps = []
    for k, toks in enumerate(parts):
        head = (f't{tempo}' if k == 0 else '') + f'v{vols[min(k, len(vols) - 1)]}'
        ps.append(head + ''.join(toks))
    return 'MML@' + ','.join(ps) + ';'


def probe_scale_single():
    # 半音階を C3 から C6 まで、メロディだけで（音の高さによる違いを見る）
    return build([[N(m, 4) for m in range(48, 85)]])


def probe_repeat_single():
    # 同じ高さの音の連打（長さ 4/8/16/32 分）。間に休符
    toks = []
    for ln in (4, 8, 16, 32):
        for pitch in (60, 67):
            toks += [N(pitch, ln)] * 8 + [R(4)]
    return build([toks])


def probe_speed(tempo):
    # 16分音符の上り下り（速さによる違いを見る）
    up = [60, 62, 64, 65, 67, 69, 71, 72]
    toks = [N(m, 16) for m in up] + [N(m, 16) for m in reversed(up)]
    return build([toks * 3], tempo=tempo)


def probe_two(interval):
    mel = [64, 67, 69, 67, 64, 62, 60, 62, 64, 67, 72, 69, 67, 64, 62, 60]
    p0 = [N(m, 8) for m in mel]
    p1 = [N(m - interval, 8) for m in mel]
    return build([p0, p1])


def probe_triads():
    ch = [(60, 64, 67), (65, 69, 72), (67, 71, 74), (57, 60, 64)] * 4
    return build([[N(c[2], 4) for c in ch], [N(c[1], 4) for c in ch], [N(c[0] - 12, 4) for c in ch]])


def probe_dense16():
    a = [72, 74, 76, 77, 79, 77, 76, 74]
    b = [64, 65, 67, 69, 67, 65, 64, 62]
    c = [48, 55, 52, 55, 48, 55, 52, 55]
    return build([[N(m, 16) for m in a * 4], [N(m, 16) for m in b * 4], [N(m, 16) for m in c * 4]])


def probe_long_vs_fast():
    # 和音パートは全音符を伸ばし、メロディは16分音符で動く（余韻が残っている音が多いとき）
    mel = [N(m, 16) for m in [72, 74, 76, 79, 76, 74, 72, 74, 76, 79, 81, 79, 76, 74, 72, 71] * 2]
    return build([mel, [N(55, 1), N(57, 1)], [N(48, 1), N(50, 1)]])


def probe_staggered():
    # 3つのパートで、始まるタイミングを16分ずつずらす
    m0 = [N(m, 8) for m in [72, 71, 72, 74, 76, 74, 72, 71] * 2]
    m1 = [R(16)] + [N(m, 8) for m in [64, 65, 67, 65, 64, 62, 64, 65] * 2]
    m2 = [R(8), R(16)] + [N(m, 8) for m in [55, 57, 59, 57, 55, 53, 55, 57] * 2]
    return build([m0, m1, m2])


def probe_ties():
    toks = []
    for a, b in ((4, 4), (4, 8), (8, 8), (2, 4), (16, 16)):
        for pitch in (60, 64, 67):
            toks.append(N(pitch, a) + '&' + N(pitch, b))
        toks.append(R(8))
    return build([toks])


def probe_volume():
    toks = []
    for v in range(1, 16):
        toks.append(f'v{v}' + N(64, 8))
    return build([toks * 2])


def probe_after_rest():
    return build([[R(1), R(2)] + [N(m, 4) for m in (60, 62, 64, 65, 67)]])


def probe_chord2_only():
    return build([[R(1)] * 4, [R(1)] * 4, [N(m, 4) for m in (60, 62, 64, 65, 67, 69, 71, 72)]])


def random_mml(seed, n_parts=3, bars=6, density=0.7, tempo=None):
    rng = np.random.default_rng(seed)
    tempo = tempo or int(rng.choice([90, 110, 130, 150]))
    lens, w = [16, 8, 4, 2], [0.25, 0.4, 0.28, 0.07]
    parts = []
    for k in range(n_parts):
        base = 72 if k == 0 else (64 if k == 1 else 52)
        toks, total = [], 0.0
        while total < bars * 192:
            ln = int(rng.choice(lens, p=w))
            ticks = 192 / ln
            if total + ticks > bars * 192 + 1e-6:
                ln, ticks = 16, 12
            toks.append(N(int(rng.integers(base - 5, base + 9)), ln) if rng.random() < density else R(ln))
            total += ticks
        parts.append(toks)
    return build(parts, tempo=tempo)


def three_contents(seed, bars=4):
    """3つのパートの中身（音の列）を作る。短めの音が多く、同時に鳴る場面が多い"""
    rng = np.random.default_rng(seed)
    lens, w = [16, 8, 4], [0.3, 0.5, 0.2]
    out = []
    for k, base in enumerate((72, 64, 52)):
        toks, total = [], 0.0
        while total < bars * 192:
            ln = int(rng.choice(lens, p=w))
            ticks = 192 / ln
            if total + ticks > bars * 192 + 1e-6:
                ln, ticks = 16, 12
            toks.append(N(int(rng.integers(base - 5, base + 8)), ln) if rng.random() < 0.9 else R(ln))
            total += ticks
        out.append(toks)
    return out


def combo_mml(contents, slots, bars=4):
    """slots[k] = k番目のパートに入れる中身の番号（None なら休符）"""
    rest = [R(1)] * bars
    return build([contents[s] if s is not None else rest for s in slots])


def all_probes():
    P = {}

    def add(name, desc, mml):
        P[name] = dict(name=name, desc=desc, mml=mml)
    # ---- 「3パートそろってから音が抜ける」の確認：同じ中身を、パートの組み合わせ・割り当てを変えて ----
    C = three_contents(7)
    add('00a_melody_chord1', '2パート：メロディ＋和音1（3パートではないので、抜けないはず）', combo_mml(C, (0, 1, None)))
    add('00b_melody_chord2', '2パート：メロディ＋和音2（和音1は休符）', combo_mml(C, (0, None, 1)))
    add('00c_chord1_chord2', '2パート：和音1＋和音2（メロディは休符）', combo_mml(C, (None, 0, 1)))
    add('00d_all3', '3パートとも：メロディ＋和音1＋和音2（同じ中身）', combo_mml(C, (0, 1, 2)))
    import itertools
    for perm in itertools.permutations((0, 1, 2)):
        if perm == (0, 1, 2):
            continue
        add('00e_perm_' + ''.join(map(str, perm)), f'3パートの中身を入れ替え（メロディ←{perm[0]} 和音1←{perm[1]} 和音2←{perm[2]}）：抜ける音が中身につくか、パートにつくか',
            combo_mml(C, perm))
    add('01_scale', '半音階（メロディのみ）C3〜C6：音の高さによる違い', probe_scale_single())
    add('02_repeat', '同じ高さの連打（4/8/16/32分）：連打の速さによる違い', probe_repeat_single())
    for t in (80, 120, 160, 200):
        add(f'03_speed_t{t}', f'16分音符の上り下り（テンポ{t}）：速さによる違い', probe_speed(t))
    add('04_two_third', '2パート：メロディ＋3度下', probe_two(4))
    add('05_two_octave', '2パート：メロディ＋1オクターブ下', probe_two(12))
    add('06_two_fifth', '2パート：メロディ＋5度下', probe_two(7))
    add('07_triads', '3パート：4分音符の三和音の進行', probe_triads())
    add('08_dense16', '3パート：全パートが16分音符で動く（負荷が高い）', probe_dense16())
    add('09_long_vs_fast', '和音は全音符を伸ばし、メロディは16分音符で動く', probe_long_vs_fast())
    add('10_staggered', '3パート：始まるタイミングを16分ずつずらす', probe_staggered())
    add('11_ties', 'タイ(&)でつないだ音', probe_ties())
    add('12_volume', '音量 v1〜v15 の順に、同じ高さの音', probe_volume())
    add('13_after_rest', '長い休符のあとに始まる音', probe_after_rest())
    add('14_chord2_only', '和音2だけが鳴る（他は休符）', probe_chord2_only())
    for k in range(1, 9):
        add(f'20_random{k}', f'ランダムな3パート（種{k}）：条件が混ざった曲', random_mml(k, density=0.55 + 0.05 * (k % 4)))
    return P


if __name__ == '__main__':
    for p in all_probes().values():
        print(p['name'], len(p['mml']), '文字', '-', p['desc'])
