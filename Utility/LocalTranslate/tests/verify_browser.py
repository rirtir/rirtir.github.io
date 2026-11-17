"""実モデルをChromeで取得し、翻訳・オフライン再起動を検証する。"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time

from playwright.sync_api import sync_playwright, expect

REPO = Path(__file__).resolve().parents[3]
ARTIFACTS = REPO / '.local/plamo'


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run(compat=False):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 8766), partial(Handler, directory=str(REPO)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    results, errors, requests = [], [], []
    try:
        with sync_playwright() as pw:
            context = pw.chromium.launch_persistent_context(
                str(ARTIFACTS / 'chrome-profile'), channel='chrome', headless=True,
                viewport={'width': 1120, 'height': 960},
            )
            try:
                if compat:
                    context.add_init_script("Object.defineProperty(WebAssembly, 'Suspending', {value:undefined, configurable:true});")
                page = context.pages[0] if context.pages else context.new_page()
                cdp = context.new_cdp_session(page)
                cdp.send('Storage.clearDataForOrigin', {'origin': 'http://127.0.0.1:8766', 'storageTypes': 'service_workers,cache_storage'})
                cdp.send('Network.clearBrowserCache')
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('request', lambda request: requests.append({'url': request.url, 'method': request.method, 'body': request.post_data}))
                page.on('console', lambda message: print('CONSOLE', message.type, message.text[:700], flush=True) if message.type in ('error', 'warning') else None)
                response = page.goto('http://127.0.0.1:8766/Utility/LocalTranslate/')
                assert response.status == 200
                print('ENGINE', page.evaluate("async () => (await import('./vendor/wllama.js?v=3.13.0')).Wllama.getLibllamaVersion()"), flush=True)
                expect(page.locator('#prepare')).to_be_enabled(timeout=30000)
                expect(page.locator('#offlineStatus')).to_contain_text('保存済み', timeout=90000)
                page.locator('#prepare').click()
                start, last_status = time.monotonic(), ''
                while time.monotonic() - start < 900:
                    status = page.locator('#status').inner_text()
                    progress = page.locator('#progressText').inner_text()
                    current = status + ' ' + progress
                    if current != last_status:
                        print(current, flush=True)
                        last_status = current
                    if page.locator('#modelBadge').inner_text() == '利用可能':
                        break
                    if not page.locator('#prepare').is_disabled():
                        raise AssertionError(status)
                    page.wait_for_timeout(2000)
                expect(page.locator('#modelBadge')).to_have_text('利用可能')
                results.append('実モデルの取得・OPFS保存・WASM読み込み')

                def translate(text, source, target, expected):
                    page.locator('#source').select_option(source)
                    page.locator('#target').select_option(target)
                    page.locator('#input').fill(text)
                    before = len(requests)
                    page.locator('#translate').click()
                    page.wait_for_function("!document.querySelector('#input').readOnly", timeout=180000)
                    expect(page.locator('#status')).to_have_text('翻訳しました。')
                    output = page.locator('#output').input_value()
                    assert output.strip() and expected(output), output
                    assert not requests[before:], requests[before:]
                    print('TRANSLATION', repr(text), '=>', repr(output), page.locator('#timing').inner_text(), flush=True)
                    return output

                ja_en = translate('会議は来週の月曜日に変更されました。', 'ja', 'en', lambda output: 'Monday' in output and 'meeting' in output.lower())
                en_ja = translate('Please open the window.', 'en', 'ja', lambda output: '窓' in output and '開' in output)
                results.append('日英・英日翻訳、推論中の通信なし')
                page.screenshot(path=str(ARTIFACTS / ('compat-desktop.png' if compat else 'desktop.png')), full_page=True)
                page.set_viewport_size({'width': 390, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=str(ARTIFACTS / 'mobile.png'), full_page=True)
                results.append('幅390pxで横スクロールなし')

                context.set_offline(True)
                response = page.reload()
                assert response.status == 200
                expect(page.locator('#prepare')).to_have_text('保存したモデルを読み込む', timeout=30000)
                page.locator('#prepare').click()
                expect(page.locator('#modelBadge')).to_have_text('利用可能', timeout=180000)
                offline = translate('ありがとうございます。', 'ja', 'en', lambda output: 'thank' in output.lower())
                results.append('オフライン再読み込み・保存モデル再利用・実翻訳')
                page.locator('#input').fill('これは翻訳の中止と再開を検証するための長い文章です。' * 8)
                page.locator('#translate').click()
                page.wait_for_function("document.querySelector('#output').value.length > 0", timeout=180000)
                page.locator('#stop').click()
                page.wait_for_function("!document.querySelector('#input').readOnly", timeout=30000)
                expect(page.locator('#status')).to_contain_text('中止しました')
                translate('こんにちは。', 'ja', 'en', lambda output: 'hello' in output.lower())
                results.append('生成中止後に再翻訳できる')
                if not compat:
                    page.locator('#remove').click()
                    expect(page.locator('#modelBadge')).to_have_text('未ダウンロード', timeout=30000)
                    assert page.evaluate("async () => (await import('./storage.js')).savedModel().then(file => file === null)")
                    results.append('保存モデルの削除')
                assert not errors, errors
                report = {'compat': compat, 'checks': results, 'translations': [ja_en, en_ja, offline], 'page_errors': errors}
                (ARTIFACTS / ('compat-results.json' if compat else 'browser-results.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
            except Exception:
                print('PAGE_ERRORS', errors, flush=True)
                page.screenshot(path=str(ARTIFACTS / 'failure.png'), full_page=True)
                print('PAGE_TEXT', page.locator('body').inner_text()[:6500], flush=True)
                raise
            finally:
                context.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--compat', action='store_true')
    run(parser.parse_args().compat)
