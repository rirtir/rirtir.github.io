"""各音の「条件」（特徴量）を計算する。鳴らなかった音に共通する条件を探すための材料。

ゲーム側で何が起きているか分からないので、考えられそうな条件を広く用意しておく：
 - 同時に鳴る音の数、直前に始まった音の数（余韻が残っている音の数の目安）
 - 同じ高さの音が近くにあるか、音の高さ・長さ・速さ・パート・曲の中での位置 など
"""
import numpy as np


def add_features(notes):
    """notes: Score.notes のリスト（各 dict に特徴量を追加する）"""
    ns = sorted(notes, key=lambda n: (n['start_s'], n['part']))
    starts = np.array([n['start_s'] for n in ns])
    ends = np.array([n['end_s'] for n in ns])
    pitches = np.array([n['pitch'] for n in ns])
    parts = np.array([n['part'] for n in ns])
    last_in_part = {}
    n_parts = len({n['part'] for n in ns})
    for gi, n in enumerate(ns):
        s, e = n['start_s'], n['end_s']
        others = np.arange(len(ns)) != gi
        # 同時に始まる音（±30ms）
        simul = others & (np.abs(starts - s) <= 0.03)
        n['f_simul_start'] = int(simul.sum())
        # 譜面の長さの上で、鳴っている最中の他の音
        active = others & (starts <= s + 0.03) & (ends > s + 0.03)
        n['f_active_notated'] = int(active.sum())
        # 余韻の目安：直前の 1/2/3 秒以内に始まった音の数
        for w in (0.5, 1.0, 2.0, 3.0):
            n[f'f_ring_{w:g}s'] = int((others & (starts < s - 0.03) & (starts >= s - w)).sum())
        # 直前の 0.25 秒・0.5 秒の間に始まった音（連続して鳴らす負荷）
        n['f_started_prev_0.25s'] = int((others & (starts < s - 0.001) & (starts >= s - 0.25)).sum())
        # 同じ高さの音が近くにある
        same = others & (pitches == n['pitch'])
        n['f_same_pitch_near'] = int((same & (starts < e + 0.15) & (ends > s - 0.35)).sum())
        n['f_same_pitch_other_part'] = int((same & (parts != n['part']) & (starts < e) & (ends > s)).sum())
        # 同時に始まる音の中での高さの順位（0=一番高い）
        grp = [j for j in np.where(simul)[0]] + [gi]
        if len(grp) > 1:
            order = sorted(grp, key=lambda j: -pitches[j])
            n['f_chord_rank'] = order.index(gi)
            n['f_chord_size'] = len(grp)
        else:
            n['f_chord_rank'] = 0
            n['f_chord_size'] = 1
        # 同じパートの直前の音との関係
        prev = last_in_part.get(n['part'])
        if prev is None:
            n['f_gap_prev'] = None
            n['f_interval_prev'] = None
        else:
            n['f_gap_prev'] = round(s - prev['end_s'], 4)          # 負：重なり／0：隙間なし
            n['f_interval_prev'] = int(n['pitch'] - prev['pitch'])
        last_in_part[n['part']] = n
        # パートの数と、同時に鳴っているパートの組（1=メロディ, 2=和音1, 4=和音2 の合計）
        n['f_n_parts'] = n_parts
        snd = (starts <= s + 0.03) & (ends > s + 0.03)
        snd[gi] = True
        n['f_parts_active'] = int(len(set(parts[snd].tolist())))
        n['f_part_combo'] = int(sum(1 << int(p) for p in set(parts[snd].tolist())))
        n['f_parts_start_simul'] = int(len(set(parts[(np.abs(starts - s) <= 0.03)].tolist() + [n['part']])))
        n['f_octave'] = n['pitch'] // 12 - 1
        n['f_pc'] = n['pitch'] % 12
        n['f_dur_s'] = round(n['dur_s'], 4)
        n['f_global_index'] = gi
        n['f_is_tied'] = int(n['ties'] > 1)
        n['f_is_first_in_part'] = int(n['idx'] == 0)
    return notes
