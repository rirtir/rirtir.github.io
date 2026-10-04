from pathlib import Path
import json
import re
import tempfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / 'index.html').as_uri()
KEY = 'starsprout.v1'
checks = []
errors = []
remote = []

def check(name, condition, detail=''):
    if not condition:
        raise AssertionError(f'{name}: {detail}')
    checks.append(name)

def fixture(**changes):
    state = dict(ver=1, drops=0, total=0, lv=dict(w=0,l=0,p=0), stars=0,
                 ach=[], tapCount=0, lastSeen=0)
    state.update(changes)
    return state

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)

    def open_case(state=None, elapsed=0, corrupt=None, viewport=None, reduced=False, blocked_storage=False):
        ctx = browser.new_context(viewport=viewport or dict(width=1440,height=1000),
                                  reduced_motion='reduce' if reduced else 'no-preference')
        page = ctx.new_page()
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.on('request', lambda req: remote.append(req.url) if req.url.startswith(('http:','https:')) else None)
        if blocked_storage:
            page.add_init_script("Storage.prototype.getItem=function(){throw new DOMException('Blocked','SecurityError')};Storage.prototype.setItem=function(){throw new DOMException('Blocked','SecurityError')};")
        elif state is not None or corrupt is not None:
            payload = json.dumps(state, ensure_ascii=False) if corrupt is None else corrupt
            page.add_init_script("""if (!sessionStorage.getItem('fixture-seeded')) {
                sessionStorage.setItem('fixture-seeded','1');
                const raw=%s;
                try { const data=JSON.parse(raw); data.lastSeen=Date.now()-(%s); localStorage.setItem(%s,JSON.stringify(data)); }
                catch(e) { localStorage.setItem(%s,raw); }
            }""" % (json.dumps(payload), elapsed*1000, json.dumps(KEY), json.dumps(KEY)))
        page.goto(URL, wait_until='load')
        page.wait_for_timeout(400)
        if page.locator('#dlg-offline').evaluate('(el)=>el.open'):
            page.locator('#do-ok').click()
        return ctx, page

    def saved(page):
        return page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', KEY)

    ctx, page = open_case()
    check('initial UI', page.locator('#stage-name').inner_text() == '種')
    check('initial passive rate', '0.5' in page.locator('#rate').inner_text())
    page.locator('#btn-collect').click(click_count=12, delay=20)
    page.wait_for_timeout(900)
    check('manual collection', saved(page)['tapCount'] == 12)
    check('purchase enabled', page.locator('#shop button').first.is_enabled())
    page.locator('#shop button').first.click()
    check('watering can upgrade', saved(page)['lv']['w'] == 1)
    before = saved(page)
    page.reload()
    page.wait_for_timeout(250)
    check('reload persistence', saved(page)['lv']['w'] == before['lv']['w'])
    taps_before = saved(page)['tapCount']
    page.locator('#btn-collect').focus()
    page.keyboard.press('Enter')
    page.wait_for_timeout(900)
    check('keyboard collection', saved(page)['tapCount'] == taps_before+1)
    check('desktop no overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
    page.screenshot(path=str(Path(tempfile.gettempdir())/'starsprout-desktop.png'), full_page=True)
    ctx.close()

    ctx, page = open_case(viewport=dict(width=375,height=812), reduced=True)
    check('mobile no overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
    check('mobile collection visible', page.locator('#btn-collect').is_visible())
    collect_box = page.locator('#btn-collect').bounding_box()
    nav_box = page.locator('#tabbar').bounding_box()
    check('mobile initial button clear of navigation', collect_box['y']+collect_box['height'] <= nav_box['y'])
    check('reduced motion enabled', page.locator('html').get_attribute('data-motion') == 'reduce')
    check('reduced motion stops plant animation', page.locator('#plant').evaluate("el=>getComputedStyle(el).animationName") == 'none')
    page.screenshot(path=str(Path(tempfile.gettempdir())/'starsprout-mobile.png'), full_page=True)
    ctx.close()

    for total, name in [(0,'種'),(30,'芽'),(300,'若葉'),(1500,'つぼみ'),(6000,'星の花')]:
        ctx, page = open_case(fixture(drops=total,total=total))
        check('growth '+name, page.locator('#stage-name').inner_text() == name)
        ctx.close()

    ctx, page = open_case(fixture(drops=1000,total=12000,lv=dict(w=3,l=4,p=2)))
    page.locator('#btn-harvest').click()
    if page.locator('#dlg-confirm').evaluate('(el)=>el.open'):
        page.locator('#dc-ok').click()
        page.wait_for_timeout(100)
    after = saved(page)
    check('harvest stars', after['stars'] == 2, after)
    check('harvest resets equipment', after['lv'] == dict(w=0,l=0,p=0), after)
    check('harvest new plant', page.locator('#stage-name').inner_text() == '種')
    check('permanent bonus', '1.20' in page.locator('#mult').inner_text())
    ctx.close()

    ctx, page = open_case(fixture(), elapsed=12*3600)
    state = saved(page)
    check('offline 8 hour cap at 50 percent', 7200 <= state['total'] <= 7202, state)
    before = state['total']
    page.reload()
    page.wait_for_timeout(250)
    check('offline no double award', saved(page)['total']-before < 2)
    ctx.close()

    ctx, page = open_case(fixture(), elapsed=-3600)
    check('future timestamp clamped', saved(page)['total'] < 2)
    ctx.close()

    ctx, page = open_case(corrupt='{invalid json')
    page.locator('#btn-collect').click()
    page.wait_for_timeout(900)
    check('corrupt save recovers', saved(page)['tapCount'] == 1)
    check('corrupt save preserved', page.evaluate("localStorage.getItem('starsprout.v1.bak')") is not None)
    ctx.close()

    ctx, page = open_case(fixture(drops=-10))
    check('negative save recovers', saved(page)['drops'] >= 0)
    ctx.close()

    ctx, page = open_case(fixture(drops=100,total=100))
    page.locator('#tab-set').click()
    page.locator('#btn-reset').click()
    check('dialog starts on safe choice', page.evaluate('document.activeElement.id') == 'dc-cancel')
    page.keyboard.press('Shift+Tab')
    check('dialog focus stays inside', page.evaluate('document.activeElement.id') == 'dc-ok')
    page.keyboard.press('Tab')
    check('dialog focus wraps', page.evaluate('document.activeElement.id') == 'dc-cancel')
    page.keyboard.press('Escape')
    page.wait_for_timeout(100)
    check('reset cancel preserves progress', saved(page)['total'] >= 100)
    check('dialog restores focus', page.evaluate('document.activeElement.id') == 'btn-reset')
    page.locator('#btn-reset').click()
    page.locator('#dc-ok').click()
    page.wait_for_timeout(100)
    check('reset confirm clears progress', saved(page)['total'] < 2 and saved(page)['stars'] == 0)
    ctx.close()

    ctx, page = open_case(blocked_storage=True)
    page.locator('#btn-collect').click()
    check('storage disabled remains playable', '保存' in page.locator('#notices').inner_text() or '保存' in page.locator('#badge-save-text').inner_text())
    ctx.close()

    ctx, first = open_case()
    second = ctx.new_page()
    second.on('pageerror', lambda err: errors.append(str(err)))
    second.goto(URL)
    second.wait_for_timeout(700)
    check('only one active tab', first.locator('#tab-banner').is_visible() != second.locator('#tab-banner').is_visible())
    follower = first if first.locator('#tab-banner').is_visible() else second
    other = second if follower == first else first
    follower.locator('#btn-takeover').click()
    follower.wait_for_timeout(700)
    check('explicit tab takeover', not follower.locator('#tab-banner').is_visible() and other.locator('#tab-banner').is_visible())
    ctx.close()

    check('no JavaScript errors', not errors, errors)
    check('no runtime external requests', not remote, remote)
    browser.close()

print(json.dumps(dict(passed=len(checks),checks=checks,errors=errors,externalRequests=remote),ensure_ascii=False,indent=2))
