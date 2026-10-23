"""1回の演奏の結果を、文章とHTML（スペクトログラム上に鳴った音・鳴らなかった音を重ねた図つき）で出す。"""
import html

import numpy as np

import detect

NOTE_KEYS = ['part', 'idx', 'pitch', 'name', 'start_s', 'dur_s', 'vol', 'tempo', 'ties', 'text',
             'char_start', 'char_end', 'detected', 'confidence', 'rel', 'rise', 'peak', 't_peak_off']


def status_of(n):
    """'present' / 'missing' / 'unsure'（確かさが高い判定だけ present/missing とする）"""
    if n['detected'] is None:
        return 'unsure'
    if n.get('confidence') == 'low':
        return 'unsure_present' if n['detected'] else 'unsure_missing'
    return 'present' if n['detected'] else 'missing'


def summarize(ns):
    c = {'present': 0, 'missing': 0, 'unsure_present': 0, 'unsure_missing': 0, 'unsure': 0}
    for n in ns:
        c[status_of(n)] += 1
    return c


def part_name(p):
    return 'メロディ' if p == 0 else f'和音{p}'


def text_report(sc, ns, info, title=''):
    c = summarize(ns)
    lines = []
    lines.append(f'=== 結果 {title} ===')
    lines.append(f'音の数 {len(ns)}（{sc.n_parts}パート、曲の長さ {sc.duration:.1f}秒）  録音 {info["duration_rec"]:.1f}秒')
    lines.append(f'演奏の開始位置 録音の {info["tau"]:.2f}秒目  時間のずれ {info["scale"]:.4f}倍  一致の強さ z={info["align_z"]:.1f}'
                 + ('  ※一致が弱いので、MMLと録音が合っていない可能性があります' if info['align_z'] < 4 else '')
                 + (f'  オクターブ補正 {info["octave_shift"]:+d}' if info['octave_shift'] else ''))
    lines.append(f'鳴った {c["present"]}   鳴らなかった {c["missing"]}   '
                 f'（確かさが低い: 鳴った? {c["unsure_present"]} / 鳴らなかった? {c["unsure_missing"]}、判定不能 {c["unsure"]}）')
    miss = [n for n in ns if status_of(n) in ('missing', 'unsure_missing')]
    if miss:
        lines.append('')
        lines.append('鳴らなかった音:')
        for n in sorted(miss, key=lambda n: n['start_s']):
            tag = '' if status_of(n) == 'missing' else '（?：同じ高さの音が近くにあり、確かでない）'
            lines.append(f'  {part_name(n["part"])} の {n["idx"] + 1}番目  {n["name"]}  {n["start_s"]:.2f}秒  長さ{n["dur_s"]:.2f}秒  MML「{n["text"]}」(文字位置 {n["char_start"]}〜{n["char_end"]}){tag}')
    else:
        lines.append('')
        lines.append('鳴らなかった音は見つかりませんでした。')
    # 録音がほとんど無音のときの警告
    refs = [n['ref'] for n in ns if 'ref' in n]
    if refs and max(refs) < 0.02:
        lines.append('')
        lines.append('※ 音がほとんど録れていないようです。録音先が違う可能性があります（calibrate で探せます）。')
    return '\n'.join(lines)


COLORS = {'present': '#2ca25f', 'missing': '#e03131', 'unsure_present': '#8fd19e', 'unsure_missing': '#f08c00', 'unsure': '#adb5bd'}


def write_spectrogram(path, ns, info, M, times):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    t0 = max(0, min(n['t0'] for n in ns) - 0.7)
    t1 = min(times[-1], max(n['t1'] for n in ns) + 1.0)
    kmin, kmax = int(100 / detect.BIN_HZ), int(4500 / detect.BIN_HZ)
    sel = (times >= t0) & (times <= t1)
    S = 20 * np.log10(M[kmin:kmax, sel] + 1e-4)
    f = np.arange(kmin, kmax) * detect.BIN_HZ
    fig, ax = plt.subplots(figsize=(min(36, max(10, (t1 - t0) * 1.3)), 6.2), dpi=90)
    ax.pcolormesh(times[sel], f, S, cmap='magma', vmin=np.percentile(S, 50), vmax=S.max(), shading='auto')
    ax.set_yscale('log')
    ax.set_ylim(100, 4500)
    ax.set_xlim(t0, t1)
    for n in ns:
        fq = detect.mtof(n['mp'])
        col = COLORS[status_of(n)]
        ax.plot([n['t0'], n['t1']], [fq, fq], color=col, lw=3.2 if status_of(n) in ('missing', 'unsure_missing') else 2.0, alpha=0.95)
        if status_of(n) == 'missing':
            ax.text(n['t0'], fq * 1.06, '×', color='#ff6b6b', fontsize=11, ha='center', fontweight='bold')
    ax.set_xlabel('録音の時間 (秒)')
    ax.set_ylabel('周波数 (Hz)')
    ax.set_title('緑=鳴った / 赤=鳴らなかった / 橙・薄緑=確かさが低い（線の位置が、その音の高さ・時間）')
    plt.rcParams['font.family'] = ['Yu Gothic', 'Meiryo', 'MS Gothic', 'sans-serif']
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def write_html(path, sc, ns, info, M, times, title='', note=''):
    png = path.with_suffix('.png')
    try:
        write_spectrogram(png, ns, info, M, times)
        img = f'<img src="{png.name}" style="max-width:100%">'
    except Exception as e:
        img = f'<p>スペクトログラムを作れませんでした: {html.escape(str(e))}</p>'
    # MMLの文字列に、鳴らなかった音を赤く塗る
    spans = sorted([(n['char_start'], n['char_end'], status_of(n)) for n in ns if status_of(n) in ('missing', 'unsure_missing')])
    out, pos = [], 0
    for a, b, st in spans:
        if a < pos:
            continue
        out.append(html.escape(sc.mml[pos:a]))
        out.append(f'<mark style="background:{COLORS[st]};color:#fff">{html.escape(sc.mml[a:b])}</mark>')
        pos = b
    out.append(html.escape(sc.mml[pos:]))
    rows = []
    for n in sorted(ns, key=lambda n: (n['start_s'], n['part'])):
        st = status_of(n)
        rows.append(f'<tr style="background:{"#ffe3e3" if st == "missing" else "#fff4e0" if st == "unsure_missing" else "transparent"}">'
                    f'<td>{part_name(n["part"])}</td><td>{n["idx"] + 1}</td><td>{n["name"]}</td><td>{n["start_s"]:.2f}</td><td>{n["dur_s"]:.2f}</td>'
                    f'<td>{html.escape(n["text"])}</td><td>{ {"present": "鳴った", "missing": "鳴らなかった", "unsure_present": "鳴った?", "unsure_missing": "鳴らなかった?", "unsure": "不明"}[st] }</td>'
                    f'<td>{n["rel"]:.2f}</td></tr>')
    c = summarize(ns)
    doc = f'''<!doctype html><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>body{{font-family:sans-serif;margin:20px;color:#222}} table{{border-collapse:collapse;font-size:13px}} td,th{{border:1px solid #ccc;padding:3px 8px}}
pre{{background:#f4f4f4;padding:10px;white-space:pre-wrap;word-break:break-all}} .k{{display:inline-block;margin-right:18px}}</style>
<h2>{html.escape(title)}</h2>
<p>{html.escape(note)}</p>
<p><span class="k">鳴った <b>{c["present"]}</b></span><span class="k" style="color:#e03131">鳴らなかった <b>{c["missing"]}</b></span>
<span class="k">確かさが低い: 鳴った? {c["unsure_present"]} / 鳴らなかった? {c["unsure_missing"]}</span><span class="k">判定不能 {c["unsure"]}</span></p>
<p>演奏の開始: 録音の {info["tau"]:.2f}秒目 / 時間のずれ {info["scale"]:.4f}倍 / 一致の強さ z={info["align_z"]:.1f}</p>
<h3>MML（鳴らなかった音を赤く表示）</h3><pre>{"".join(out)}</pre>
<h3>録音のスペクトログラム</h3>{img}
<h3>全部の音</h3>
<table><tr><th>パート</th><th>番号</th><th>音</th><th>開始(秒)</th><th>長さ(秒)</th><th>MML</th><th>判定</th><th>強さ(基準比)</th></tr>{"".join(rows)}</table>'''
    path.write_text(doc, encoding='utf-8')
