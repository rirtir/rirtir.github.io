"""公開ツールの起動・依存ファイル・PC/スマホ幅を実Chromeで点検する。"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_support import ARTIFACTS, REPO, local_server


def run():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    results = []
    with local_server() as base, sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        # ゲームは起動時のみ。セーブデータを共有しない独立contextで確認する。
        targets = [REPO / 'index.html'] + sorted(p for d in ('Image', 'Audio', 'Utility', 'Game') for p in (REPO / d).glob('*/index.html'))
        for target in targets:
            context = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
            page = context.new_page()
            errors, failed = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('requestfailed', lambda r: failed.append({'url': r.url.replace(base, ''), 'error': r.failure}))
            page.on('response', lambda r: failed.append({'url': r.url.replace(base, ''), 'status': r.status}) if r.status >= 400 else None)
            page.on('dialog', lambda d: d.dismiss())
            rel = target.relative_to(REPO).as_posix()
            item = {'path': rel}
            try:
                response = page.goto(base + '/' + rel, wait_until='domcontentloaded', timeout=25000)
                page.wait_for_timeout(1200)
                item.update(status=response.status, title=page.title(), desktopOverflow=page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'))
                page.set_viewport_size({'width': 390, 'height': 844})
                page.wait_for_timeout(150)
                item['mobileOverflow'] = page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            except Exception as exc:
                item['exception'] = str(exc).splitlines()[0]
            item.update(errors=errors, failed=failed)
            results.append(item)
            print(json.dumps(item, ensure_ascii=False), flush=True)
            context.close()
        browser.close()
    name = 'scan-after.json' if '--after' in sys.argv else 'scan.json'
    (ARTIFACTS / name).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    run()
