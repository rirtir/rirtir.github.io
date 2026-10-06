"""実ブラウザの操作・保存・タッチを検証。ChromeとPython Playwrightを使用する。"""
from pathlib import Path
import argparse
import json
import sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
GAME = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8765/Game/Mosslight/?debug=1')
args = parser.parse_args()
output = GAME / 'tests/output'
output.mkdir(parents=True, exist_ok=True)
checks = []


def check(name, ok, detail=''):
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + (': ' + detail if not ok else ''))


def start(page):
    page.goto(args.url)
    page.get_by_role('button', name='はじめから', exact=False).click()
    page.wait_for_function("window.__mosslight?.mode === 'play'")


def state(page, expression):
    return page.evaluate('() => ' + expression)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    desktop = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    page = desktop.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    start(page)
    before = state(page, '__mosslight.state.player.x')
    page.keyboard.down('ArrowRight')
    page.wait_for_timeout(450)
    page.keyboard.up('ArrowRight')
    check('矢印キーで実際に歩く', state(page, '__mosslight.state.player.x') > before+10)
    for key, label in [('Tab', 'バッグ'), ('c', '制作'), ('b', '建築'), ('m', 'マップ'), ('j', '日誌')]:
        page.keyboard.press(key)
        dialog = page.get_by_role('dialog', name=label, exact=True)
        dialog.wait_for()
        check(label+'をキーボードで開く', dialog.is_visible())
        clock = state(page, '__mosslight.state.time.clock')
        page.wait_for_timeout(250)
        check(label+'中にゲームを停止する', abs(state(page, '__mosslight.state.time.clock')-clock) < .01)
        page.keyboard.press('Escape')
        dialog.wait_for(state='detached')
    # 採集ルールはgameplay.js。ここでは材料のみ付与し、制作画面の操作を検証する。
    page.evaluate("() => {for(const [id,n] of [['branch',3],['stone',2],['fiber',2]]) __mosslight.api.addItem(__mosslight.state,id,n);}")
    page.keyboard.press('c')
    page.locator('[data-id="axe_stone"]').click()
    page.get_by_role('button', name='×1を作る', exact=True).click()
    check('制作ボタンで石の斧を作る', state(page, '__mosslight.state.player.tools.axe') == 1)
    page.screenshot(path=str(output/'desktop-craft.png'))
    page.keyboard.press('Escape')
    page.keyboard.press('Escape')
    page.get_by_role('button', name='保存する', exact=True).click()
    check('メニューから保存する', state(page, "JSON.parse(localStorage.getItem('mosslight.save.v1')).player.tools.axe") == 1)
    page.get_by_role('button', name='設定', exact=True).click()
    with page.expect_download() as download_info:
        page.get_by_role('button', name='書き出す', exact=True).click()
    download = download_info.value
    download.save_as(str(output/'export.json'))
    exported = (output/'export.json').read_bytes()
    check('セーブを書き出す', json.loads(exported)['player']['tools']['axe'] == 1)
    with page.expect_file_chooser() as chooser_info:
        page.get_by_role('button', name='ファイルから読み込む', exact=True).click()
    chooser_info.value.set_files({'name':'broken.json','mimeType':'application/json','buffer':b'{broken'})
    page.get_by_role('alertdialog', name='読み込めません', exact=True).wait_for()
    check('壊れた読み込みで進行を守る', state(page, '__mosslight.state.player.tools.axe') == 1)
    page.get_by_role('alertdialog').get_by_role('button', name='閉じる', exact=True).click()
    with page.expect_file_chooser() as chooser_info:
        page.get_by_role('button', name='ファイルから読み込む', exact=True).click()
    chooser_info.value.set_files({'name':'export.json','mimeType':'application/json','buffer':exported})
    page.get_by_role('alertdialog', name='ファイルから読み込む', exact=True).get_by_role('button', name='読み込む', exact=True).click()
    page.wait_for_function("!document.querySelector('[role=alertdialog]')")
    check('書き出したファイルで再開する', state(page, '__mosslight.state.player.tools.axe') == 1)
    page.reload()
    page.get_by_role('button', name='続きから', exact=False).click()
    page.wait_for_function("window.__mosslight?.mode === 'play'")
    check('再読み込み後も続きから遊べる', state(page, '__mosslight.state.player.tools.axe') == 1)
    check('アセットの欠落がない', state(page, '[...__mosslight.assets.missing].length') == 0)
    page.screenshot(path=str(output/'desktop-play.png'))
    check('デスクトップに実行例外がない', not errors, json.dumps(errors, ensure_ascii=False))
    desktop.close()

    for width, height, label in [(390,844,'portrait'), (844,390,'landscape')]:
        mobile = browser.new_context(viewport={'width':width,'height':height}, device_scale_factor=1, has_touch=True, is_mobile=True)
        page = mobile.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        start(page)
        check(label+' 横へのはみ出しがない', state(page, 'document.documentElement.scrollWidth <= innerWidth'))
        check(label+' 全8枠のホットバーが画面内', page.locator('.hotbar button').evaluate_all('(els) => els.length === 8 && els.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})'))
        joy = page.locator('.joy')
        box = joy.bounding_box()
        x, y = box['x']+box['width']/2, box['y']+box['height']/2
        before = state(page, '__mosslight.state.player.x')
        # Chromeの本物のtouchイベント。Pointer Eventsとcaptureへの変換も検証する。
        session = mobile.new_cdp_session(page)
        session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        session.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x+32,'y':y}]})
        page.wait_for_timeout(450)
        session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        check(label+' スティックで歩く', state(page, '__mosslight.state.player.x') > before+10)
        stopped = state(page, '__mosslight.state.player.x')
        page.wait_for_timeout(180)
        check(label+' 指を離すと止まる', abs(state(page, '__mosslight.state.player.x')-stopped) < 2)
        page.get_by_role('button', name='回避', exact=True).tap()
        page.wait_for_timeout(80)
        check(label+' 回避ボタンが働く', state(page, '__mosslight.state.player.rollCd') > 0)
        page.get_by_role('button', name='バッグ', exact=False).first.tap()
        dialog = page.get_by_role('dialog', name='バッグ', exact=True)
        dialog.wait_for()
        check(label+' バッグをタッチで開く', dialog.is_visible())
        page.screenshot(path=str(output/f'mobile-{label}-bag.png'))
        page.keyboard.press('Escape')
        page.screenshot(path=str(output/f'mobile-{label}-play.png'))
        check(label+' 実行例外がない', not errors, json.dumps(errors, ensure_ascii=False))
        mobile.close()
    browser.close()

(output/'browser-report.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
failed = sum(not c['ok'] for c in checks)
print(f'{len(checks)-failed} 成功 / {failed} 失敗')
sys.exit(1 if failed else 0)
