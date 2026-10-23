"""マビノギモバイルで MML を演奏したとき、どの音が鳴らなかったかを検証する道具（入口）。

基本の使い方（ゲームで演奏する前に実行する）:
    python scripts/mml_verify/run.py run                 # クリップボードのMMLを検証（録音→停止→自動解析）
    python scripts/mml_verify/run.py run --probe 08_dense16   # 検証用のMMLを使う（MMLは自動でコピーされます）
    python scripts/mml_verify/run.py run --file my.txt   # ファイルのMML
詳しくは README.md を見てください。
"""
import argparse
import json
import sys
import time

import numpy as np

import detect
import features
import patterns
import probes
import recorder
import report
import store
from mmlparse import Score

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


def to_py(o):
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    raise TypeError(type(o))


def get_mml(args):
    """MML を、指定された場所から取り出す。戻り値: (MML, 出どころ, クリップボードから取ったか)"""
    if getattr(args, 'probe', None):
        p = probes.all_probes()
        if args.probe not in p:
            raise SystemExit('その検証用MMLはありません。probes で一覧を確認してください: ' + args.probe)
        return p[args.probe]['mml'], 'probe:' + args.probe, False
    if getattr(args, 'file', None):
        return open(args.file, encoding='utf-8').read().strip(), 'file:' + str(args.file), False
    if getattr(args, 'text', None):
        return args.text, 'text', False
    import pyperclip
    t = pyperclip.paste().strip()
    if 'MML@' not in t.upper():
        raise SystemExit('クリップボードに MML がありません（「MML@…;」をコピーしてから実行してください）。')
    return t, 'clipboard', True


def resample_to_22050(x, sr):
    if sr == detect.SR:
        return x.astype(np.float32)
    from scipy.signal import resample_poly
    from math import gcd
    g = gcd(detect.SR, sr)
    return resample_poly(x, detect.SR // g, sr // g).astype(np.float32)


def analyze_and_save(mml, x, source, note='', sid=None, device=''):
    import soundfile as sf
    sc = Score(mml)
    if not sc.notes:
        raise SystemExit('MMLから音を読み取れませんでした。')
    for w in sc.warnings[:5]:
        print('  注意:', w)
    features.add_features(sc.notes)
    if source.startswith('probe:'):
        pr = probes.all_probes().get(source.split(' / ')[0].split(':', 1)[1])
        if pr and pr.get('sections'):
            for n in sc.notes:
                for a, b, kind in pr['sections']:
                    if a - 1e-6 <= n['start_s'] < b - 1e-6:
                        n['f_section'] = probes.SECTION_JP.get(kind, kind)
                        break
    if len(x) < detect.SR * 2 or float(np.abs(x).max()) < 1e-3:
        print('  ※ 録音がほとんど無音（または短すぎ）でした。解析をやめます。録音先が違う可能性があります（「録音先を探す」を実行してください）。')
        return None
    t0 = time.time()
    ns, info, M, times = detect.run_analysis(x, sc, octave_candidates=(0, -12, 12))
    sid = sid or store.new_session_id(source.split(' / ')[0].split(':', 1)[-1] if source.startswith('probe') else '')
    d = store.session_dir(sid)
    sf.write(str(d / 'rec.wav'), x, detect.SR, subtype='PCM_16')
    title = f'{sid}  MML {sc.hash}  ({source})'
    txt = report.text_report(sc, ns, info, title)
    (d / 'report.txt').write_text(txt, encoding='utf-8')
    report.write_html(d / 'report.html', sc, ns, info, M, times, title, note)
    rec = dict(session=sid, time=time.strftime('%Y-%m-%d %H:%M:%S'), source=source, note=note, device=device,
               mml=mml, mml_hash=sc.hash, info=info, tempo_events=sc.tempo_events,
               notes=[{k: n[k] for k in report.NOTE_KEYS + [k for k in n if k.startswith('f_')] if k in n} for n in ns])
    (d / 'result.json').write_text(json.dumps(rec, ensure_ascii=False, default=to_py), encoding='utf-8')
    store.append_result(json.loads(json.dumps(rec, default=to_py)))
    print()
    print(txt)
    print()
    print(f'  （解析 {time.time() - t0:.1f}秒）詳しい図: {d / "report.html"}')
    return rec


def run_once(mml, source, from_clipboard, args, sid=None):
    sc = Score(mml)
    print(f'MML {sc.hash}  {sc.n_parts}パート・音{len(sc.notes)}個・曲の長さ約{sc.duration:.1f}秒  [{source}]')
    if not from_clipboard:
        import pyperclip
        pyperclip.copy(mml)
        print('  → このMMLをクリップボードにコピーしました。ゲームの作曲画面で貼り付けてください。')
    cfg = store.load_config()
    auto_pick = not args.device and not cfg.get('device')
    if auto_pick:
        devs = recorder.loopback_devices()
        print(f'  録音先: まだ決まっていないので、全部の出力先（{len(devs)}個）を同時に録音して、一番音が大きかった所を自動で選びます')
    else:
        devs = [recorder.find_device(args.device)]
        print(f'  録音先: {devs[0].name}')
    print()
    print('★ 録音を開始しました。ゲームでMMLを貼り付けて、演奏を始めてください。')
    print('   演奏が終わって静かになると、自動で停止して解析します（すぐ止めたいときは、このウィンドウで Enter キー）。')
    x, sr, dev_name = recorder.record_until_stop(devs, auto_stop=None if args.no_auto_stop else args.auto_stop, expect_seconds=sc.duration)
    x = resample_to_22050(x, sr)
    print(f'録音 {len(x) / detect.SR:.1f}秒（録音先: {dev_name}）を解析します…')
    if auto_pick and len(x) > detect.SR * 2 and float(np.abs(x).max()) > 1e-3:
        cfg['device'] = dev_name
        store.save_config(cfg)
        print(f'  → 音が出ていた「{dev_name}」を、次回からの録音先として覚えました。')
    return analyze_and_save(mml, x, source, args.note or '', sid, dev_name)


def cmd_run(args):
    if args.all_probes:
        P = probes.all_probes()
        names = [n for n, p in P.items() if p['group'] == args.set or args.set == 'all']
        if args.start_from:
            names = names[names.index(args.start_from):]
        total = sum(Score(P[n]['mml']).duration for n in names) * args.times
        print()
        print(f'■ 3パート（メロディ＋和音1＋和音2）の長い曲（約1分）を {len(names)} 曲、1曲あたり {args.times} 回ずつ演奏してもらいます。')
        print('  1回ごとに：①MMLが自動でコピーされる → ②ゲームに貼り付けて、最後まで演奏 → ③演奏後、静かになると自動で解析')
        print(f'  演奏時間の合計は約{total / 60:.0f}分（貼り付けなどを含めて、全部で{total / 60 + len(names) * args.times * 0.4:.0f}分ほど）。いつでも q で終われます。')
        for i, name in enumerate(names):
            print(f'\n==================== 曲 {i + 1}/{len(names)}: {name} ====================')
            print(f'{P[name]["desc"]}。{P[name]["why"]}')
            args.probe = name
            mml, source, clip = get_mml(args)
            for rep in range(args.times):
                if args.times > 1:
                    print(f'\n--- {name}  {rep + 1}回目 / {args.times} ---')
                run_once(mml, source, clip or rep > 0, args)
                if rep + 1 < args.times:
                    try:
                        r = input('\n同じ曲をもう1回演奏します（Enter＝録音開始 / q＝終了）: ').strip().lower()
                    except EOFError:
                        r = 'q'
                    if r == 'q':
                        return
            if i + 1 < len(names):
                try:
                    r = input('\n次の曲へ進みます（Enter＝進む / q＝ここで終了）: ').strip().lower()
                except EOFError:
                    r = 'q'
                if r == 'q':
                    break
        print('\nお疲れさまでした。「法則を探す」を実行すると、結果から条件を探します。')
        return
    mml, source, clip = get_mml(args)
    while True:
        run_once(mml, source, clip, args)
        if not args.repeat:
            break
        try:
            r = input('\n同じMMLでもう一度録音しますか？（Enter＝もう一度 / q＝終了）: ').strip().lower()
        except EOFError:
            r = 'q'
        if r == 'q':
            break
        clip = True       # 2回目以降は、クリップボードにすでに入っている


def cmd_analyze(args):
    mml, source, _ = get_mml(args)
    print(f'録音ファイルを読み込みます: {args.audio}')
    x = detect.load_audio(args.audio)
    print(f'録音 {len(x) / detect.SR:.1f}秒 を解析します…')
    analyze_and_save(mml, x, source + ' / ' + str(args.audio), args.note or '')


def cmd_learn(args):
    if args.reset:
        cfg = store.load_config()
        cfg.pop('timbre', None)
        store.save_config(cfg)
        print('覚えた音色を消しました（標準の音色に戻ります）。')
        return
    mml, source, _ = get_mml(args)
    sc = Score(mml)
    print(f'録音ファイルを読み込みます: {args.audio}')
    x = detect.load_audio(args.audio)
    timbre, info = detect.learn_timbre(x, sc)
    print(f'演奏の開始位置 {info["tau"]:.2f}秒目、時間のずれ {info["scale"]:.4f}倍、一致の強さ z={info["z"]:.1f}'
          + ('  ※一致が弱いので、この録音は使わないほうがよいかもしれません' if info['z'] < 4 else ''))
    if not timbre:
        raise SystemExit('音色を測れませんでした。')
    cfg = store.load_config()
    cfg['timbre'] = {str(k): v for k, v in timbre.items()}
    store.save_config(cfg)
    print(f'{len(timbre)}種類の高さの音色を覚えました（以後の解析はこの音色を使います）。')
    for p in sorted(timbre)[::max(1, len(timbre) // 6)]:
        print('   ', p, ' '.join(f'{v:6.1f}' for v in timbre[p][:6]), 'dB（基音, 2倍音, 3倍音…）')


def cmd_probes(args):
    P = probes.all_probes()
    for p in P.values():
        print(f'  {"★" if p["group"] == "focus" else " "} {p["name"]:22s} {len(p["mml"]):4d}文字  {p["desc"]}')
    if args.write:
        store.ensure()
        for p in P.values():
            (store.PROBES / (p['name'] + '.txt')).write_text(p['mml'], encoding='utf-8')
        print(f'\n{store.PROBES} に、1つずつファイルとして書き出しました。')


def cmd_open_latest(args):
    import os
    d = sorted(store.SESSIONS.glob('*')) if store.SESSIONS.exists() else []
    d = [x for x in d if (x / 'report.html').exists()]
    if not d:
        print('結果がまだありません。')
        return
    print('最新の結果:', d[-1].name)
    os.startfile(str(d[-1] / 'report.html'))


def cmd_patterns(args):
    txt = patterns.report(include_low=args.include_low)
    print(txt)
    store.ensure()
    (store.DATA / 'patterns.txt').write_text(txt, encoding='utf-8')
    print(f'\n（{store.DATA / "patterns.txt"} にも保存しました）')


def main():
    ap = argparse.ArgumentParser(description='マビノギモバイルのMML演奏で、鳴らなかった音を検証する')
    sub = ap.add_subparsers(dest='cmd', required=True)

    def add_src(p):
        g = p.add_mutually_exclusive_group()
        g.add_argument('--probe', help='検証用のMMLの名前（probes で一覧）')
        g.add_argument('--file', help='MMLが書かれたテキストファイル')
        g.add_argument('--text', help='MMLの文字列')
        p.add_argument('--note', help='メモ（結果に残す。例：「BGMなし」「楽器=マンドリン」）')

    r = sub.add_parser('run', help='録音して解析する（ゲームで演奏する前に実行）')
    add_src(r)
    r.add_argument('--device', help='録音先（devices の番号か名前の一部）。省略すると calibrate で覚えたもの')
    r.add_argument('--auto-stop', type=float, default=4.0, metavar='秒', help='演奏が終わったあと、この秒数だけ無音が続いたら自動で停止（既定4秒）')
    r.add_argument('--no-auto-stop', action='store_true', help='自動停止を使わず、Enterキーで止める')
    r.add_argument('--repeat', action='store_true', help='同じMMLを続けて何回も録音する（再現性を見る）')
    r.add_argument('--all-probes', action='store_true', help='3パートの検証用MML（集中検証セット）を、順番に続けて検証する')
    r.add_argument('--set', choices=['focus', 'short', 'all'], default='focus', help='--all-probes で使うMML：focus=長い3パート曲（既定） / short=短い3パート曲 / all=全部')
    r.add_argument('--times', type=int, default=2, help='--all-probes で、1曲を何回ずつ演奏するか（既定2回。同じ曲で毎回同じ音が抜けるかが分かる）')
    r.add_argument('--start-from', help='--all-probes を、この名前のところから始める')
    r.set_defaults(fn=cmd_run)

    a = sub.add_parser('analyze', help='すでにある録音ファイル（OBSの録画など）を解析する')
    a.add_argument('audio', help='wav / mkv / mp4 など')
    add_src(a)
    a.set_defaults(fn=cmd_analyze)

    le = sub.add_parser('learn', help='全部の音が鳴った録音から、ゲームの音色を覚える（解析が正確になる）')
    le.add_argument('audio', nargs='?', help='全部の音が鳴ったことが分かっている録音')
    add_src(le)
    le.add_argument('--reset', action='store_true', help='覚えた音色を消す')
    le.set_defaults(fn=cmd_learn)

    sub.add_parser('open-latest', help='最新の結果（図）をブラウザで開く').set_defaults(fn=cmd_open_latest)
    sub.add_parser('devices', help='録音できる出力先の一覧').set_defaults(fn=lambda a: recorder.list_devices())
    c = sub.add_parser('calibrate', help='ゲームの音が出ている出力先を自動で探して覚える')
    c.add_argument('--seconds', type=int, default=8)
    c.set_defaults(fn=lambda a: recorder.calibrate(a.seconds))
    pr = sub.add_parser('probes', help='検証用のMMLの一覧')
    pr.add_argument('--write', action='store_true', help='ファイルとして書き出す')
    pr.set_defaults(fn=cmd_probes)
    pa = sub.add_parser('patterns', help='たまった結果から、鳴らなかった音の法則を探す')
    pa.add_argument('--include-low', action='store_true', help='確かさが低い判定も含める')
    pa.set_defaults(fn=cmd_patterns)
    sub.add_parser('selftest', help='解析の自己検証（疑似録音で）').set_defaults(fn=lambda a: __import__('selftest').evaluate(20, 3))

    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()
