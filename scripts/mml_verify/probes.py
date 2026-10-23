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

# ---- 3パート（メロディ＋和音1＋和音2）が重なる曲だけを集めた「集中検証セット」 ----
CH = [(76, 67, 60), (77, 69, 60), (79, 71, 62), (76, 69, 57)]       # メロディ・和音1・和音2（C, F, G, Am）


def three_same_rhythm(chords, ln, rest=None):
    """3つのパートが、同じタイミングで同じ長さの音を鳴らす。rest を指定すると、音のあとに休符を入れて音を短くする"""
    parts = [[], [], []]
    for c in chords:
        for k in range(3):
            parts[k].append(N(c[k], ln))
            if rest:
                parts[k].append(R(rest))
    return build(parts)


def focus_probes():
    out = []
    cc = lambda n: (CH * n)
    out.append(('F01_chords_quarter', '3つが同時に始まる音（和音）を、4分音符で',
                '3つのパートが同時に鳴り始める、いちばん基本の形。', three_same_rhythm(cc(2), 4)))
    out.append(('F02_chords_eighth', '同じ和音を、8分音符で（2倍の速さ）',
                '同時に始まる和音を、速くしたとき。速さが関係するか。', three_same_rhythm(cc(4), 8)))
    out.append(('F03_chords_16th', '同じ和音を、16分音符で（4倍の速さ）',
                '同時に始まる和音を、さらに速くしたとき。', three_same_rhythm(cc(8), 16)))
    out.append(('F04_staggered', '3つの始まりを、8分・16分ずつずらす',
                '同時ではなく、少しずつずれて3つ目が入ってくるとき。', build([
                    [N(c[0], 4) for c in cc(2)],
                    [R(8)] + [N(c[1], 4) for c in cc(2)],
                    [R(16)] + [N(c[2], 4) for c in cc(2)]])))
    out.append(('F05_hold2_move1', '和音1・和音2は全音符で伸ばし、メロディだけ8分で動く',
                '2つが鳴り続けているところへ、3つ目の音が次々と入るとき。', build([
                    [N(m, 8) for m in [76, 79, 77, 74, 76, 79, 84, 79] * 2],
                    [N(67, 1), N(69, 1)], [N(60, 1), N(57, 1)]])))
    out.append(('F06_hold1_move2', 'メロディは全音符で伸ばし、和音1・和音2が8分で動く',
                '長い音が1つ鳴り続けているところへ、2つのパートが動くとき。', build([
                    [N(79, 1), N(76, 1)],
                    [N(m, 8) for m in [64, 67, 65, 62, 64, 67, 72, 67] * 2],
                    [R(16)] + [N(m, 8) for m in [55, 59, 57, 53, 55, 59, 64, 59] * 2][:15]])))
    out.append(('F07_chords_staccato', '同じ和音を、短く切って（音と音が重ならない）',
                '音が短く、次の和音までに切れているとき。長さ（重なり）が関係するか。', three_same_rhythm(cc(2), 16, '8.')))
    out.append(('F08_cluster', '3つの音が、半音〜全音で密集した和音',
                '3つの音の高さが近いとき。', three_same_rhythm([(72, 71, 70), (74, 72, 71), (76, 75, 74), (73, 72, 71)] * 2, 4)))
    out.append(('F09_octaves', '3つとも同じ音名（オクターブ違い）の和音',
                '3つが同じ音名で、オクターブだけ違うとき。', three_same_rhythm([(84, 72, 60), (86, 74, 62), (88, 76, 64), (84, 72, 60)] * 2, 4)))
    for k in (1, 2, 3):
        out.append((f'F10_random{k}', f'ランダムな3パートの曲（{k}）',
                    '条件がいろいろ混ざった、実際の曲に近い形（3パートとも常に動く）。', random_mml(100 + k, bars=4, density=0.8)))
    return out


# ---- 長く（約1分）、いろいろな重なり方を順番に詰め込んだ3パートの曲 ----
LEN_TOK = {12: '16', 24: '8', 36: '8.', 48: '4', 72: '4.', 96: '2', 144: '2.', 192: '1'}
SCALE = {0, 2, 4, 5, 7, 9, 11}
REG = [(71, 83), (62, 74), (50, 62)]        # メロディ・和音1・和音2 の音域（C3より上：録音で判定しやすい）
SECTION_JP = {'sync4': '同時・4分', 'sync8': '同時・8分', 'sync16': '同時・16分', 'stagger': 'ずらして入る', 'hold2move1': '2つ伸ばし1つ動く',
              'hold1move2': '1つ伸ばし2つ動く', 'staccato': '短く切る', 'poly': '3つがバラバラの長さ', 'rand': 'ランダム'}


def _tok(d):
    """ticks を、1つの長さ記号で書ける長さに分ける（大きい順）"""
    out = []
    for v in (192, 144, 96, 72, 48, 36, 24, 12):
        while d >= v:
            out.append(v)
            d -= v
    return out


def section_events(kind, rng, bars):
    """1つの区間の、3パートぶんの (開始, 長さ) の並び（ticks）。区間の長さを返す。"""
    L = 192 * bars
    ev = [[], [], []]
    if kind in ('sync4', 'sync8', 'sync16'):
        d = {'sync4': 48, 'sync8': 24, 'sync16': 12}[kind]
        for k in range(3):
            ev[k] = [(t, d) for t in range(0, L, d)]
    elif kind == 'stagger':
        for k, off in enumerate((0, 24, 12)):
            ev[k] = [(t, 48) for t in range(off, L - 48 + 1, 48)]
    elif kind == 'hold2move1':
        ev[0] = [(t, 24) for t in range(0, L, 24)]
        for k in (1, 2):
            ev[k] = [(t, 192) for t in range(0, L, 192)]
    elif kind == 'hold1move2':
        ev[0] = [(t, 192) for t in range(0, L, 192)]
        ev[1] = [(t, 24) for t in range(0, L, 24)]
        ev[2] = [(t, 24) for t in range(12, L - 24 + 1, 24)]
    elif kind == 'staccato':
        for k in range(3):
            ev[k] = [(t, 12) for t in range(0, L, 48)]
    elif kind == 'poly':
        for k, d in enumerate((24, 72, 48)):
            ev[k] = [(t, d) for t in range(0, L - d + 1, d)]
    else:   # rand
        for k in range(3):
            t = 0
            while t < L:
                d = int(rng.choice([12, 24, 24, 48, 48, 96]))
                d = min(d, L - t)
                d = max(v for v in LEN_TOK if v <= d)
                if rng.random() > 0.2:
                    ev[k].append((t, d))
                t += d
    return ev, L


def rich_mml(seed, tempo, n_sections=8):
    rng = np.random.default_rng(seed)
    kinds = ['sync4', 'sync8', 'sync16', 'stagger', 'hold2move1', 'hold1move2', 'staccato', 'poly', 'rand', 'rand']
    order = list(rng.permutation(kinds))[:n_sections]
    ev, secs, t0 = [[], [], []], [], 0
    for kind in order:
        bars = 2 if kind == 'sync16' else 4
        e, L = section_events(kind, rng, bars)
        for k in range(3):
            ev[k] += [(t0 + a, d) for a, d in e[k]]
        secs.append((t0, t0 + L, kind))
        t0 += L
    # 音の高さを決める：なるべく自然につなぎ、同じ高さの音が近くに重ならないようにする（録音で区別しやすくするため）
    allnotes = sorted(((a, k, d) for k in range(3) for a, d in ev[k]))
    pitch, last = {}, [None, None, None]
    for a, k, d in allnotes:
        lo, hi = REG[k]
        cands = [m for m in range(lo, hi + 1) if m % 12 in SCALE]
        near = [m for m in cands if last[k] is None or abs(m - last[k]) <= 5]
        def ok(m):
            for (a2, k2, d2), m2 in pitch.items():
                if m2 == m and abs(a2 - a) <= 120 and not (k2 == k and a2 == a):
                    return False
            return True
        pool = [m for m in near if ok(m)] or [m for m in cands if ok(m)] or near
        m = int(rng.choice(pool))
        pitch[(a, k, d)] = m
        last[k] = m
    parts = []
    for k in range(3):
        toks, t = [], 0
        for a, d in sorted(ev[k]):
            if a > t:
                toks += [R(LEN_TOK[v]) for v in _tok(a - t)]
            toks.append(N(pitch[(a, k, d)], LEN_TOK[d]))
            t = a + d
        parts.append(toks)
    sec_s = [(a * 240 / tempo / 192, b * 240 / tempo / 192, kind) for a, b, kind in secs]
    return build(parts, tempo=tempo), sec_s


def rich_probes():
    """(名前, 説明, MML, 区間の一覧[(開始秒, 終了秒, 種類)])"""
    out = []
    for i, (tempo, seed) in enumerate([(110, 11), (130, 12), (90, 13), (150, 14), (120, 15), (100, 16)], start=1):
        mml, secs = rich_mml(seed, tempo)
        out.append((f'R{i}_t{tempo}', f'長い3パート曲（テンポ{tempo}・約{secs[-1][1]:.0f}秒）', mml, secs))
    return out


# ---- 仮説を確かめる実験用の曲：8分音符で全パートが同時に鳴る（音域をそろえる／ずらす／パート数を変える） ----
ZONES = {'mid_m': list(range(71, 77)), 'mid_c1': list(range(64, 71)), 'low_c2': list(range(52, 61)), 'high_m': list(range(77, 84)),
         'low_c1': list(range(57, 63))}


def exp_mml(kind, seed=21, slots=100, tempo=120):
    rng = np.random.default_rng(seed)

    def seq(zone, n):
        out, last = [], None
        for _ in range(n):
            m = int(rng.choice([x for x in ZONES[zone] if x != last]))
            out.append(m)
            last = m
        return out
    mel = seq('high_m' if kind == 'X7_diff_zone' else 'mid_m', slots)
    c1 = seq('mid_c1', slots)
    c2 = seq('low_c2', slots)
    A = [N(m, 8) for m in mel]
    B = [N(m, 8) for m in c1]
    C = [N(m, 8) for m in c2]
    if kind == 'X1_two_parts':
        return build([A, B])
    if kind == 'X3_third_rests':
        return build([A, B, [R(1)] * (slots // 8) + [R(8)] * (slots % 8)])
    if kind == 'X4_third_holds':
        return build([A, B, [N(m, 1) for m in (c2[:slots // 8] if slots >= 8 else c2)]])
    if kind == 'X5_offset_64th':
        return build([A, [R(64)] + B, C])
    if kind == 'X6_offset_32nd':
        return build([A, [R(32)] + B, C])
    if kind == 'X8_offset_96th':          # 1/64より細かい長さ（ゲームが受け付けるかの実験）
        return build([A, [R(96)] + B, C])
    if kind == 'X9_offset_128th':
        return build([A, [R(128)] + B, C])
    return build([A, B, C])         # X2_three_same_zone / X7_diff_zone


def exp_probes():
    items = [
        ('X1_two_parts', '2パートだけ：メロディ(中音域)＋和音1(中音域)が同時', '同じ音域の2音が同時に始まるとき、2パートだけでも抜けるか。'),
        ('X2_three_same_zone', '3パート：メロディ・和音1が中音域、和音2が低音域（すべて同時）', '基準になる形。メロディの中音域の音が抜けやすいはず。'),
        ('X3_third_rests', '3パートのMMLだが、和音2はずっと休符', '3つ目のパートが「あるだけ」で音は鳴らないとき。抜けるか。'),
        ('X4_third_holds', '3つ目（和音2）が長い音を鳴らし続け、メロディ・和音1が同時に動く', '3つ目がすでに鳴っているところへ、同じ音域の2音が同時に入るとき。'),
        ('X5_offset_64th', '和音1を、64分音符ぶんだけ遅らせて始める', 'ごくわずかなずらしで、抜けなくなるか。'),
        ('X6_offset_32nd', '和音1を、32分音符ぶんだけ遅らせて始める', '少しだけずらしたら、抜けなくなるか。'),
        ('X8_offset_96th', '和音1を、96分音符（1/64より細かい）だけ遅らせる', 'MMLの長さは1〜64のはずだが、96を入れたらどうなるか。ゲームが受け付けるか・抜けなくなるかの実験（受け付けないと、貼り付けでエラーになるかも）。'),
        ('X9_offset_128th', '和音1を、128分音符（1/64より細かい）だけ遅らせる', '同上（さらに細かい）。'),
        ('X7_diff_zone', '3パート：メロディが高音域、和音1が中音域、和音2が低音域（すべて同時）', '音域がすべて違うとき。抜けないはず（対照）。'),
    ]
    return [(n, d, why, exp_mml(n)) for n, d, why in items]


def all_probes():
    P = {}

    def add(name, desc, mml, group='other', why=''):
        P[name] = dict(name=name, desc=desc, mml=mml, group=group, why=why or desc)
    for name, desc, mml, secs in rich_probes():
        add(name, desc, mml, group='focus', why='いろいろな重なり方を順番に入れた長い曲。どのパターンで・どの音が抜けるかを調べる。')
        P[name]['sections'] = secs
    for name, desc, why, mml in focus_probes():
        add(name, desc, mml, group='short', why=why)
    for name, desc, why, mml in exp_probes():
        add(name, desc, mml, group='exp', why=why)
    # ---- （参考）パートの組み合わせ・割り当てを変えた検証：集中検証セットには含めない ----
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
        print(p['group'], p['name'], len(p['mml']), '文字', '-', p['desc'])
