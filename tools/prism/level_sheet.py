"""PRISM のステージを「解いた状態」でスクリーンショットしてコンタクトシートにする（確認用）。

  python tools/prism/level_sheet.py out.png 1-1 1-2 4-6 8-3
"""
import functools
import http.server
import os
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def main():
    out, ids = sys.argv[1], sys.argv[2:]
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    shots = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': 960, 'height': 540})
        pg.goto(f'http://127.0.0.1:{port}/Game/Prism/index.html')
        pg.wait_for_timeout(1200)
        for i in ids:
            ch, lv = i.split('-')
            pg.evaluate(
                "async ([ch, lv]) => { const L = await import('/Game/Prism/js/levels.js'); const O = await import('/Game/Prism/js/optics.js');"
                "const ci = L.CHAPTERS.findIndex(c => c.id == ch); __start.startLevel(L.CHAPTERS[ci].levels[lv - 1], {kind: 'custom', label: ch + '-' + lv, name: ''});"
                "O.applySolution(__game.els); __game.sandbox = true; __game.dirty = true; }", [ch, int(lv)])
            pg.wait_for_timeout(1700)
            shots.append(pg.screenshot())
        b.close()
    from PIL import Image
    import io
    ims = [Image.open(io.BytesIO(s)).convert('RGB') for s in shots]
    cols = min(3, len(ims))
    rows = (len(ims) + cols - 1) // cols
    w, h = ims[0].size
    sheet = Image.new('RGB', (w * cols, h * rows))
    for k, im in enumerate(ims):
        sheet.paste(im, ((k % cols) * w, (k // cols) * h))
    sheet.save(out)
    print('saved', out)


if __name__ == '__main__':
    main()
