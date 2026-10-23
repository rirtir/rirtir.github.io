"""音抜け対策：「同じ音域の音が同時に始まる」所だけ、後ろのパートの音の始まりを、ほんの少し（1/64音符）遅らせる。

検証（Mabinogi Mobile、実験 X1〜X7）で、
  ・音域が同じ（低: D#4以下 / 中: E4〜E5 / 高: F5以上）2音が同時に始まると、前のパートの音が約26%の確率で鳴らない
  ・同時に始まる音を1/64ずらすだけで、鳴らなくなる現象は見られなかった（0/346）
と分かったので、その所だけをずらす。メロディは触らない。ずらした音は、終わりの位置を変えずに、短くする。
"""
import re

from mmlparse import TPW, Score

UNIT_TICKS = 3        # 1/64音符


def zone(p):
    return 0 if p <= 63 else (1 if p <= 76 else 2)


# 1つの記号で書ける長さ（ticks → 記号）
_TOK = {}
for n in (1, 2, 4, 8, 16, 32, 64):
    _TOK[TPW / n] = str(n)
    _TOK[TPW / n * 1.5] = f'{n}.'
_VALS = sorted(_TOK, reverse=True)


def decompose(d):
    """ticks を、最小個数の長さ記号に分ける（大きい順）。できなければ None"""
    target = int(round(d * 2))                 # 0.5 tick 刻みの整数にして数える
    steps = [(int(round(v * 2)), t) for v, t in _TOK.items()]
    INF = 10 ** 9
    dp = [INF] * (target + 1)
    pick = [None] * (target + 1)
    dp[0] = 0
    for g in range(target + 1):
        if dp[g] >= INF:
            continue
        for v, t in steps:
            h = g + v
            if h <= target and dp[g] + 1 < dp[h]:
                dp[h], pick[h] = dp[g] + 1, (v, t)
    if dp[target] >= INF:
        return None
    out, g = [], target
    while g > 0:
        v, t = pick[g]
        out.append((v, t))
        g -= v
    out.sort(key=lambda x: -x[0])
    return [t for _, t in out]


def find_conflicts(score):
    """同じ音域の音が、別のパートで同時に始まっている所。[(音のリスト(パート順))]"""
    groups = {}
    for n in score.notes:
        groups.setdefault((round(n['start']), zone(n['pitch'])), []).append(n)
    out = []
    for g in groups.values():
        parts = {n['part'] for n in g}
        if len(g) >= 2 and len(parts) >= 2:
            out.append(sorted(g, key=lambda n: n['part']))
    return out


def desync(mml, unit=UNIT_TICKS):
    """戻り値: (新しいMML, 報告の辞書)"""
    sc = Score(mml)
    conflicts = find_conflicts(sc)
    edits = []          # (開始位置, 終了位置, 置き換える文字列)
    rep = dict(conflicts=len(conflicts), shifted=0, skipped=[], by_part={}, notes_total=len(sc.notes))
    for grp in conflicts:
        for rank, n in enumerate(grp):
            if rank == 0:
                continue                       # 一番前のパートは、そのまま
            off = rank * unit
            d_new = n['dur'] - off
            m = re.match(r'[a-g][+\-#]*', n['text'].lower())
            toks = decompose(d_new) if d_new >= unit else None
            rest = decompose(off)
            if not m or not toks or not rest:
                rep['skipped'].append((n['part'], n['idx'], n['text'], '長さを書き表せない'))
                continue
            name = m.group(0)
            dl, dd = n.get('deflen', (None, 0))
            default = f'{dl}' + '.' * dd if dl else None
            new = ''.join('r' + t for t in rest) + '&'.join(name + ('' if t == default else t) for t in toks)
            edits.append((n['char_start'], n['char_end'], new))
            rep['shifted'] += 1
            rep['by_part'][n['part']] = rep['by_part'].get(n['part'], 0) + 1
    out = mml
    for a, b, new in sorted(edits, reverse=True):
        out = out[:a] + new + out[b:]
    return out, rep


def verify(old_mml, new_mml, unit=UNIT_TICKS):
    """加工の前後を比べて、問題がないか調べる。戻り値: 問題の文字列のリスト（空なら問題なし）"""
    a, b = Score(old_mml), Score(new_mml)
    bad = []
    if len(a.notes) != len(b.notes):
        bad.append(f'音の数が変わった: {len(a.notes)} → {len(b.notes)}')
        return bad
    if abs(a.end_tick - b.end_tick) > 0.5:
        bad.append(f'曲の長さが変わった: {a.end_tick} → {b.end_tick}')
    ka = {(n['part'], n['idx']): n for n in a.notes}
    kb = {(n['part'], n['idx']): n for n in b.notes}
    moved = 0
    for k, n in ka.items():
        m = kb.get(k)
        if m is None or m['pitch'] != n['pitch']:
            bad.append(f'音の高さ・並びが変わった: {k}')
            continue
        if abs((m['start'] + m['dur']) - (n['start'] + n['dur'])) > 0.5:
            bad.append(f'音の終わりの位置が変わった: {k}')
        ds = m['start'] - n['start']
        if abs(ds) > 0.5:
            moved += 1
            if ds < 0 or ds > 4 * unit + 0.5:
                bad.append(f'ずれ方が想定外: {k} {ds:+.1f} ticks')
        if n['part'] == 0 and abs(ds) > 0.5:
            bad.append(f'メロディが動いた: {k}')
    # 同じ音域の同時開始が残っていないか（0.5 tick 以内を同時とみなす）
    left = [g for g in find_conflicts(b)]
    if left:
        bad.append(f'同じ音域の同時開始が {len(left)} か所に残っている')
    return bad
