"""MMLを、「1パート2400文字以内」「3音まで」などの条件に合わせて作り直す。

  ・和音の音を、パートが休んでいる時間をうまく使って割り振り直す（音の高さが近い音を同じパートに集める）
  ・同時に鳴る音が多すぎるときは、主要な音（メロディ・低音・長い音）を残して、ほかを短くする／省く
  ・同じ音域の同時開始を、後ろのパートの音だけ1/64ずらす（音抜け対策。desync と同じ）
文字数は、作曲ツール（Audio/MMLComposer）がMMLを書き出す規則と同じやり方で数える。
"""
import re

from mmlparse import TPW, Score, split_parts

NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b']
LIMIT = 2400

# ---- 長さ記号（作曲ツールの TOK と同じ） ----
TOK = []
for n in (1, 2, 4, 8, 16, 32, 64):
    t = TPW / n
    TOK.append((t, n, 0, 0))
    if float(t * 1.5).is_integer():
        TOK.append((t * 1.5, n, 1, 0))
for n in (3, 6, 12, 24, 48):
    TOK.append((TPW / n, n, 0, 1))
MAXD = TPW * 8
_INF = 10 ** 9
_dp = [_INF] * (MAXD + 1)
_pick = [-1] * (MAXD + 1)
_dp[0] = 0
for _d in range(1, MAXD + 1):
    for _i, (_t, _n, _dt, _c) in enumerate(TOK):
        _t = int(_t) if float(_t).is_integer() else _t
        if isinstance(_t, int) and _d >= _t and _dp[_d - _t] + 100 + _c < _dp[_d]:
            _dp[_d] = _dp[_d - _t] + 100 + _c
            _pick[_d] = _i


def decompose(d):
    d = int(round(d))
    out = []
    while d > MAXD:
        out.append(TOK[[i for i, k in enumerate(TOK) if k[1] == 1 and not k[2]][0]])
        d -= TPW
    if d > 0 and _dp[d] >= _INF:
        d -= d % 3
    part = []
    while d > 0:
        k = TOK[_pick[d]]
        part.append(k)
        d -= int(k[0])
    part.sort(key=lambda k: -k[0])
    return out + part


def gen_part(notes, vol, tempo=None):
    """音のリスト（s, l, p）から、1パートぶんのMML文字列を作る（作曲ツールの genTrack と同じ規則）"""
    notes = sorted(notes, key=lambda n: (n['s'], n['p']))
    pieces, emitted = [], 0
    for n in notes:
        if n['s'] > emitted:
            for k in decompose(n['s'] - emitted):
                pieces.append(('r', k))
                emitted += k[0]
        for i, k in enumerate(decompose(n['s'] + n['l'] - emitted)):
            pieces.append(('n', n['p'], k, i > 0))
            emitted += k[0]
    head = (f't{tempo}' if tempo else '') + f'v{vol}'
    if not pieces:
        return head + 'r1'
    cnt = {}
    for pc in pieces:
        k = pc[1] if pc[0] == 'r' else pc[2]
        cnt[k[1]] = cnt.get(k[1], 0) + 1
    L = sorted(cnt, key=lambda n: (-cnt[n], n))[0]
    ls = lambda k: ('' if k[1] == L else str(k[1])) + ('.' if k[2] else '')
    out, oc = [head + f'l{L}'], None
    for pc in pieces:
        if pc[0] == 'r':
            out.append('r' + ls(pc[1]))
            continue
        _, p, k, tie = pc
        octv = max(1, min(8, p // 12 - 1))
        if tie:
            out.append('&' + NAMES[p % 12] + ls(k))
            continue
        if octv != oc:
            out.append(f'o{octv}')
            oc = octv
        out.append(NAMES[p % 12] + ls(k))
    return ''.join(out)


# ---- 音域・同時開始のずらし ----
def zone(p):
    return 0 if p <= 63 else (1 if p <= 76 else 2)


def desync_notes(parts, unit=3):
    """parts: パートごとの音のリストのリスト。後ろのパートの音の始まりを、順に unit tick ずつ遅らせた新しいリストを返す"""
    new = [[dict(n) for n in ns] for ns in parts]
    groups = {}
    for pi, ns in enumerate(new):
        for n in ns:
            groups.setdefault((round(n['s']), zone(n['p'])), []).append((pi, n))
    shifted = 0
    for g in groups.values():
        if len({pi for pi, _ in g}) < 2:
            continue
        for rank, (pi, n) in enumerate(sorted(g, key=lambda x: x[0])):
            if rank == 0:
                continue
            off = rank * unit
            if n['l'] - off >= 3:
                n['s'] += off
                n['l'] -= off
                shifted += 1
    return new, shifted


# ---- 割り振り ----
def assign(notes, K, lam=0.0, drop_ok=False):
    """音を K 個のパートに割り振る（同じパートで音が重ならないように）。音の高さが近い音を同じパートに集める。
    戻り値: (パートごとの音のリスト, 入りきらなかった音)"""
    notes = sorted(notes, key=lambda n: (n['s'], -n['p']))
    parts = [[] for _ in range(K)]
    free = [0.0] * K
    last = [None] * K
    left = []
    for n in notes:
        cands = [k for k in range(K) if free[k] <= n['s'] + 1e-6]
        if not cands:
            left.append(n)
            continue

        def cost(k):
            c = 0.0
            if last[k] is not None:
                c += abs(n['p'] - last[k]) * 0.6 + (8 if n['p'] // 12 != last[k] // 12 else 0)
            c += min(n['s'] - free[k], 192) * 0.03        # 休符が長いほど、文字が増える
            c += lam * len(parts[k])
            return c
        k = min(cands, key=cost)
        parts[k].append(dict(n))
        free[k] = n['s'] + n['l']
        last[k] = n['p']
    return parts, left


def thin(chord_notes, melody_notes, K):
    """同時に鳴る和音の音が K 個を超えないように、主要でない音を短くする／省く。戻り値: (残った音, 短くした数, 省いた数)"""
    mel = sorted(melody_notes, key=lambda n: n['s'])

    def mel_pc(t):
        return {m['p'] % 12 for m in mel if m['s'] <= t < m['s'] + m['l']}

    allnotes = sorted(chord_notes, key=lambda n: (n['s'], n['p']))
    # 重要度：長い音・低音（そのときの一番低い音）・メロディと同じ音名でない音
    starts = {}
    for n in allnotes:
        starts.setdefault(round(n['s']), []).append(n)
    for t, g in starts.items():
        low = min(x['p'] for x in g)
        pcs = mel_pc(t)
        for n in g:
            w = min(n['l'], 96) + 12.0
            if n['p'] == low:
                w *= 2.5                        # 低音
            if n['p'] % 12 in pcs:
                w *= 0.6                        # メロディと同じ音名（重ね）
            n['_w'] = w
    active, kept, cut, dropped = [], [], 0, 0
    for n in allnotes:
        n = dict(n)
        active = [a for a in active if a['s'] + a['l'] > n['s'] + 1e-6]
        active.append(n)
        while len(active) > K:
            v = min(active, key=lambda a: a['_w'])
            active.remove(v)
            if v is n:
                dropped += 1
                n = None
                break
            v['l'] = n['s'] - v['s']          # すでに鳴っている音を、新しい音の始まりまでで切る
            if v['l'] < 12:
                kept.remove(v)
                dropped += 1
            else:
                cut += 1
        if n is not None:
            kept.append(n)
    for n in kept:
        n.pop('_w', None)
    return kept, cut, dropped


def notes_of(score, part):
    return [dict(s=n['start'], l=n['dur'], p=n['pitch']) for n in score.notes if n['part'] == part]


# ---- まとめ：MML全体を、パート数・文字数の条件に合わせて作り直す ----
def _max_overlap(notes):
    ev = sorted([(n['s'], 1) for n in notes] + [(n['s'] + n['l'], -1) for n in notes], key=lambda e: (e[0], e[1]))
    c = m = 0
    for _, d in ev:
        c += d
        m = max(m, c)
    return m


def fit_mml(text, max_parts, limit=LIMIT, do_desync=True, unit=3):
    """メロディ（1つ目のパート）はそのまま、和音のパートを、max_parts-1 個に割り振り直す。
    同時に鳴る和音が多すぎるときは、主要な音を残して短くする／省く。戻り値: (新しいMML, 報告の辞書)"""
    sc = Score(text)
    ptxt = [p for p, _ in split_parts(text)]
    tempo = sc.tempo_events[0][1]
    mel = notes_of(sc, 0)
    chord = [n for k in range(1, sc.n_parts) for n in notes_of(sc, k)]
    vol = int((re.search(r'v(\d+)', ptxt[1]) or [0, 8])[1]) if len(ptxt) > 1 else 8
    K = max_parts - 1
    rep = dict(chord_notes=len(chord), omitted=0, cut=0, max_overlap=_max_overlap(chord))
    if rep['max_overlap'] > K:
        chord, rep['cut'], rep['omitted'] = thin(chord, mel, K)
    import numpy as np
    best = None
    for lam in np.arange(0, 3.01, 0.1):
        parts, left = assign(chord, K, float(lam))
        if left:
            continue
        parts.sort(key=lambda ns: -sum(n['p'] for n in ns) / max(1, len(ns)))      # 高い音のパートを和音1にする
        allp = [mel] + parts
        if do_desync:
            allp, shifted = desync_notes(allp, unit)
        else:
            shifted = 0
        lens = [len(gen_part(ns, vol)) for ns in allp[1:]]
        key = (max(lens), sum(lens))
        if best is None or key < best[0]:
            best = (key, float(lam), allp, shifted, lens)
    if best is None:
        raise RuntimeError('音を割り振れませんでした')
    _, lam, allp, shifted, lens = best
    texts = [ptxt[0]] + [gen_part(ns, vol) for ns in allp[1:]]
    rep.update(lam=lam, shifted=shifted, lens=[len(texts[0])] + lens, over=[i for i, n in enumerate([len(texts[0])] + lens) if n > limit])
    return 'MML@' + ','.join(texts) + ';', rep


def check_fit(orig, new, limit=LIMIT, thinned=False):
    """作り直したMMLを読み直して、問題がないか調べる。戻り値: (問題のリスト, 統計の辞書)"""
    import desync
    a, b = Score(orig), Score(new)
    bad, st = [], {}
    lens = [len(p) for p, _ in split_parts(new)]
    st['lens'] = lens
    for i, n in enumerate(lens):
        if n > limit:
            bad.append(f'パート{i}が{limit}文字を超えている（{n}文字）')
    # 同じパートで音が重なっていないか
    for k in range(b.n_parts):
        ns = sorted([n for n in b.notes if n['part'] == k], key=lambda n: n['start'])
        for x, y in zip(ns, ns[1:]):
            if y['start'] < x['start'] + x['dur'] - 0.5:
                bad.append(f'パート{k}で音が重なっている: {x["start"]}')
                break
    # メロディが変わっていないか
    ma = [(round(n['start']), round(n['dur']), n['pitch']) for n in a.notes if n['part'] == 0]
    mb = [(round(n['start']), round(n['dur']), n['pitch']) for n in b.notes if n['part'] == 0]
    if ma != mb:
        bad.append('メロディが変わっている')
    # 和音の音：元のどれかの音に当てはまるか（始まりは最大で 9 tick 遅れる・終わりは同じか早い）
    pool = {}
    for n in a.notes:
        if n['part'] > 0:
            pool.setdefault(n['pitch'], []).append([n['start'], n['start'] + n['dur'], False])
    used = unmatched = 0
    for n in b.notes:
        if n['part'] == 0:
            continue
        end = n['start'] + n['dur']
        cand = [o for o in pool.get(n['pitch'], []) if not o[2] and o[0] - 0.5 <= n['start'] <= o[0] + 9.5 and end <= o[1] + 0.5]
        if not cand:
            unmatched += 1
            continue
        min(cand, key=lambda o: abs(o[1] - end))[2] = True
        used += 1
    total_old = sum(len(v) for v in pool.values())
    st['kept'], st['old'], st['unmatched'] = used, total_old, unmatched
    if unmatched:
        bad.append(f'元にない音が {unmatched}個ある')
    if not thinned and used != total_old:
        bad.append(f'音が減っている: {total_old} → {used}')
    left = desync.find_conflicts(b)
    st['conflicts'] = len(left)
    return bad, st
