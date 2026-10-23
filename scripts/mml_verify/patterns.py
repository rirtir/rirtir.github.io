"""たまった結果から、「どんな音が鳴らなかったか」の法則を探す。

  - 条件ごとの「鳴らなかった率」の表
  - 一番よく分ける条件の順位（しきい値つき）
  - 決定木による「こういう条件だと鳴らない」ルール
  - 同じMMLを複数回演奏したときの再現性（毎回同じ音が抜けるか）
"""
import math
from collections import defaultdict

import numpy as np

import store
from report import status_of, part_name

NUM_FEATS = [
    ('pitch', '音の高さ(MIDI番号)'), ('f_octave', 'オクターブ'), ('part', 'パート'), ('vol', '音量(v)'), ('tempo', 'テンポ'),
    ('f_dur_s', '音の長さ(秒)'), ('start_s', '曲の中の時刻(秒)'), ('f_global_index', '曲の中の何音目か'),
    ('f_n_parts', 'MMLのパート数'), ('f_parts_active', '同時に鳴っているパートの数(自分を含む)'),
    ('f_part_combo', '同時に鳴っているパートの組(1=メロディ 2=和音1 4=和音2 の合計。7=3パートとも)'),
    ('f_parts_start_simul', '同時に始まるパートの数(自分を含む)'),
    ('f_simul_start', '同時に始まる他の音の数'), ('f_active_notated', '譜面上、鳴っている最中の他の音の数'),
    ('f_ring_0.5s', '直前0.5秒以内に始まった音の数'), ('f_ring_1s', '直前1秒以内に始まった音の数'),
    ('f_ring_2s', '直前2秒以内に始まった音の数'), ('f_ring_3s', '直前3秒以内に始まった音の数'),
    ('f_started_prev_0.25s', '直前0.25秒以内に始まった音の数'),
    ('f_same_pitch_near', '同じ高さの音が近くにある数'), ('f_same_pitch_other_part', '同じ高さの音が他パートで鳴っている数'),
    ('f_chord_rank', '同時に始まる音の中の高さの順位(0=最高)'), ('f_chord_size', '同時に始まる音の数(自分を含む)'),
    ('f_gap_prev', '同じパートの直前の音との隙間(秒)'), ('f_interval_prev', '直前の音との音程差(半音)'),
    ('f_is_tied', 'タイ(&)を含む'), ('f_is_first_in_part', 'パートの最初の音'), ('ties', 'タイでつないだ数'),
]


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def collect(results, include_low=False):
    """結果から、確かな判定の音だけを集めた行のリストを作る"""
    rows = []
    for r in results:
        for n in r['notes']:
            st = status_of(n)
            if st in ('present', 'missing') or (include_low and st in ('unsure_present', 'unsure_missing')):
                row = dict(n)
                row['missing'] = 1 if st in ('missing', 'unsure_missing') else 0
                row['session'] = r['session']
                row['hash'] = r['mml_hash']
                rows.append(row)
    return rows


def bins_for(values):
    """特徴量を、表に出す区間に分ける。値の種類が少なければそのまま、多ければ分位で区切る"""
    vs = sorted({v for v in values if v is not None})
    if len(vs) <= 12:
        return [('=', v) for v in vs]
    qs = sorted({round(float(np.quantile([v for v in values if v is not None], q)), 3) for q in (0.2, 0.4, 0.6, 0.8)})
    return [('<', qs[0])] + [('range', (a, b)) for a, b in zip(qs[:-1], qs[1:])] + [('>=', qs[-1])]


def label_of(kind, v):
    if kind == '=':
        return f'{v:g}' if isinstance(v, (int, float)) else str(v)
    if kind == '<':
        return f'〜{v:g}未満'
    if kind == '>=':
        return f'{v:g}以上'
    return f'{v[0]:g}以上〜{v[1]:g}未満'


def match(kind, v, x):
    if x is None:
        return False
    if kind == '=':
        return x == v
    if kind == '<':
        return x < v
    if kind == '>=':
        return x >= v
    return v[0] <= x < v[1]


def univariate(rows):
    out = []
    for key, jp in NUM_FEATS:
        vals = [r.get(key) for r in rows]
        if all(v is None for v in vals):
            continue
        lines = []
        for kind, v in bins_for(vals):
            sel = [r for r in rows if match(kind, v, r.get(key))]
            if not sel:
                continue
            k = sum(r['missing'] for r in sel)
            lo, hi = wilson(k, len(sel))
            lines.append((label_of(kind, v), len(sel), k, k / len(sel), lo, hi))
        out.append((key, jp, lines))
    return out


def entropy(p):
    return 0.0 if p <= 0 or p >= 1 else -(p * math.log2(p) + (1 - p) * math.log2(1 - p))


def best_stumps(rows, min_leaf=None):
    """各特徴量について、「この値以上か」で分けたときに鳴らなかった率が一番変わる区切りを探す"""
    n = len(rows)
    y = np.array([r['missing'] for r in rows], dtype=float)
    base = entropy(y.mean())
    min_leaf = min_leaf or max(5, int(n * 0.02))
    res = []
    for key, jp in NUM_FEATS:
        x = np.array([np.nan if r.get(key) is None else float(r[key]) for r in rows])
        ok = ~np.isnan(x)
        if ok.sum() < 2 * min_leaf:
            continue
        cands = np.unique(x[ok])
        if len(cands) > 40:
            cands = np.unique(np.quantile(x[ok], np.linspace(0.05, 0.95, 40), method='lower'))
        best = None
        for c in cands:
            hi, lo = ok & (x >= c), ok & (x < c)
            if hi.sum() < min_leaf or lo.sum() < min_leaf:
                continue
            ph, pl = y[hi].mean(), y[lo].mean()
            gain = base - (hi.sum() * entropy(ph) + lo.sum() * entropy(pl)) / (hi.sum() + lo.sum())
            if best is None or gain > best[0]:
                best = (gain, float(c), float(ph), float(pl), int(hi.sum()), int(lo.sum()), (ok & (x >= c)).tobytes())
        if best:
            res.append((best[0], key, jp) + best[1:])
    res.sort(key=lambda r: -r[0])
    # 分け方がまったく同じ条件は、1行にまとめる
    out, seen = [], {}
    for r in res:
        sig = r[-1]
        if sig in seen:
            seen[sig][-1].append(r[2])
            continue
        row = list(r[:-1]) + [[]]
        seen[sig] = row
        out.append(row)
    return out


def fit_tree(rows, depth=3, min_leaf=None):
    n = len(rows)
    min_leaf = min_leaf or max(6, int(n * 0.03))
    keys = [k for k, _ in NUM_FEATS]
    names = dict(NUM_FEATS)
    X = np.array([[np.nan if r.get(k) is None else float(r[k]) for k in keys] for r in rows])
    y = np.array([r['missing'] for r in rows], dtype=float)
    rules = []

    def gini(yy):
        p = yy.mean() if len(yy) else 0
        return 2 * p * (1 - p)

    def rec(idx, d, conds):
        yy = y[idx]
        if d == 0 or len(idx) < 2 * min_leaf or yy.min() == yy.max():
            rules.append((conds, len(idx), int(yy.sum())))
            return
        best = None
        for j, k in enumerate(keys):
            col = X[idx, j]
            ok = ~np.isnan(col)
            if ok.sum() < 2 * min_leaf:
                continue
            cv = np.unique(col[ok])
            for c in (cv if len(cv) <= 25 else np.unique(np.quantile(col[ok], np.linspace(0.1, 0.9, 25), method='lower'))):
                hi, lo = ok & (col >= c), ok & (col < c)
                if hi.sum() < min_leaf or lo.sum() < min_leaf:
                    continue
                g = gini(yy) - (hi.sum() * gini(yy[hi]) + lo.sum() * gini(yy[lo])) / len(idx)
                if best is None or g > best[0]:
                    best = (g, j, float(c))
        if best is None or best[0] < 1e-4:
            rules.append((conds, len(idx), int(yy.sum())))
            return
        _, j, c = best
        col = X[idx, j]
        rec(idx[col >= c], d - 1, conds + [f'{names[keys[j]]} が {c:g} 以上'])
        rec(idx[~(col >= c)], d - 1, conds + [f'{names[keys[j]]} が {c:g} 未満'])

    rec(np.arange(n), depth, [])
    return rules


def reproducibility(results):
    """同じMMLを複数回演奏したときの、音ごとの鳴らなかった頻度"""
    by_hash = defaultdict(list)
    for r in results:
        by_hash[r['mml_hash']].append(r)
    out = []
    for h, rs in by_hash.items():
        if len(rs) < 2:
            continue
        per = defaultdict(list)
        text = {}
        for r in rs:
            for n in r['notes']:
                st = status_of(n)
                if st in ('present', 'missing'):
                    per[(n['part'], n['idx'])].append(1 if st == 'missing' else 0)
                    text[(n['part'], n['idx'])] = (n['name'], n['start_s'], n['text'])
        always = [k for k, v in per.items() if len(v) >= 2 and sum(v) == len(v)]
        never = [k for k, v in per.items() if len(v) >= 2 and sum(v) == 0]
        some = [k for k, v in per.items() if len(v) >= 2 and 0 < sum(v) < len(v)]
        out.append(dict(hash=h, sessions=len(rs), always=sorted(always), some=sorted(some), never=len(never), text=text,
                        freq={k: (sum(v), len(v)) for k, v in per.items()}))
    return out


def report(include_low=False):
    results = store.load_results()
    lines = []
    if not results:
        return '結果がまだありません。run で演奏と録音をしてください。'
    rows = collect(results, include_low)
    n_miss = sum(r['missing'] for r in rows)
    lines.append(f'結果 {len(results)}回ぶん（MMLの種類 {len({r["mml_hash"] for r in results})}）、判定が確かな音 {len(rows)}個、うち鳴らなかった音 {n_miss}個（{n_miss / max(1, len(rows)):.1%}）')
    if n_miss < 8:
        lines.append('※ 鳴らなかった音がまだ少ないので、法則は当てになりません。いろいろなMMLで演奏を重ねてください。')
    rep = reproducibility(results)
    lines.append('')
    lines.append('■ 再現性（同じMMLを複数回演奏したとき）')
    if not rep:
        lines.append('  同じMMLを2回以上演奏した結果がまだありません（run --repeat で続けて録れます）。')
    for r in rep:
        tot = len(r['always']) + len(r['some'])
        lines.append(f'  MML {r["hash"]}（{r["sessions"]}回）: 毎回鳴らなかった音 {len(r["always"])}個 / たまに鳴らなかった音 {len(r["some"])}個 / 毎回鳴った音 {r["never"]}個')
        for k in r['always']:
            nm, st, tx = r['text'][k]
            lines.append(f'     毎回: {part_name(k[0])}の{k[1] + 1}番目 {nm} {st:.2f}秒「{tx}」')
        for k in r['some']:
            nm, st, tx = r['text'][k]
            m, t = r['freq'][k]
            lines.append(f'     たまに({m}/{t}回): {part_name(k[0])}の{k[1] + 1}番目 {nm} {st:.2f}秒「{tx}」')
        if tot:
            lines.append(f'     → 抜ける音のうち、毎回抜ける割合 {len(r["always"]) / tot:.0%}（100%に近いほど「楽譜で決まる」）')
    if n_miss >= 1 and len(rows) - n_miss >= 1:
        lines.append('')
        lines.append('■ 一番よく分ける条件（この値以上かどうかで、鳴らなかった率が一番変わる順）')
        for gain, key, jp, thr, ph, pl, nh, nl, same in best_stumps(rows)[:8]:
            lines.append(f'  {jp}  {thr:g} 以上: 鳴らなかった率 {ph:.1%}（{nh}音）  /  未満: {pl:.1%}（{nl}音）   [情報量 {gain:.3f}]')
            if same:
                lines.append('       （同じ分け方になる条件: ' + ' / '.join(same) + '）')
        lines.append('')
        lines.append('■ 決定木で見つけた「鳴らなかった率が高い条件」')
        shown = 0
        for conds, n, k in sorted(fit_tree(rows), key=lambda r: -(r[2] / max(1, r[1]))):
            if n >= 6 and k / n >= 0.2:
                lines.append(f'  {" かつ ".join(conds) or "（全部）"} → 鳴らなかった {k}/{n}（{k / n:.0%}）')
                shown += 1
                if shown >= 6:
                    break
        if not shown:
            lines.append('  （鳴らなかった率が高い、はっきりした条件は見つかりませんでした）')
        lines.append('')
        lines.append('■ 条件ごとの鳴らなかった率（件数が少ない区間は幅が広い。[ ]は95%の範囲の目安）')
        for key, jp, ls in univariate(rows):
            lines.append(f'  {jp}')
            for lab, n, k, rate, lo, hi in ls:
                bar = '#' * int(rate * 20)
                lines.append(f'     {lab:>14s}: {k:3d}/{n:4d} = {rate:6.1%} [{lo:.0%}〜{hi:.0%}] {bar}')
    return '\n'.join(lines)
