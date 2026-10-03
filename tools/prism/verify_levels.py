"""PRISM の全ステージを検証する（Playwright + Chrome が必要）。

  python tools/prism/verify_levels.py            # すべて
  python tools/prism/verify_levels.py 4-1 4-2    # 指定したステージだけ

確認する内容:
  - 「解の配置」で全受光器が点灯する（＝解ける）
  - 開始配置（ストック）で既に解けていない
  - 開始・解の配置で、パーツ同士が重なっていない／盤面からはみ出していない
  - 可動パーツが 0.25 グリッド・2.5° 刻みに乗っている（プレイヤーが再現できる）
"""
import functools
import http.server
import io
import json
import os
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

JS = r"""
async (only) => {
  const O = await import('/Game/Prism/js/optics.js');
  const L = await import('/Game/Prism/js/levels.js');
  const out = [];
  L.CHAPTERS.forEach((ch, ci) => ch.levels.forEach((def, li) => {
    const id = ch.id + '-' + (li + 1);
    if (only.length && !only.includes(id)) return;
    const r = { id, name: def.name, issues: [] };
    const els = O.loadLevel(def);
    if (O.allSolved(O.trace(els))) r.issues.push('開始状態で解けている');
    for (const e of els) if (!O.placementOk(e, els)) r.issues.push('開始配置が衝突/はみ出し: ' + e.type);
    O.applySolution(els);
    for (const e of els) if (!O.placementOk(e, els)) r.issues.push('解配置が衝突/はみ出し: ' + e.type + '@' + e.x + ',' + e.y);
    const tr = O.trace(els);
    if (!O.allSolved(tr)) r.issues.push('解で解けない');
    for (const e of els) if (e.mv || (e.rt && !e.mv)) {
      if (e.mv && (Math.abs(e.x * 4 - Math.round(e.x * 4)) > 1e-6 || Math.abs(e.y * 4 - Math.round(e.y * 4)) > 1e-6)) r.issues.push('グリッド外: ' + e.type + ' ' + e.x + ',' + e.y);
      const deg = e.a * 180 / Math.PI;
      if (Math.abs(deg / 2.5 - Math.round(deg / 2.5)) > 1e-6) r.issues.push('2.5度刻みでない: ' + e.type + ' ' + deg.toFixed(2));
    }
    out.push(r);
  }));
  return out;
}
"""


def main():
    only = sys.argv[1:]
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=d3d11'])
        pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'http://127.0.0.1:{port}/Game/Prism/index.html')
        pg.wait_for_timeout(800)
        res = pg.evaluate(JS, only)
        bad = 0
        for r in res:
            print(('OK ' if not r['issues'] else 'NG '), r['id'], r['name'])
            for i in r['issues']:
                print('     !', i)
            bad += bool(r['issues'])
        print(f'{len(res)} stages, {bad} NG')
        for e in errs:
            print('ERR', e)
        b.close()
    sys.exit(1 if bad or errs else 0)


if __name__ == '__main__':
    main()
