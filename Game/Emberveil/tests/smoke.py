"""実際のページで起動・新規開始・メニュー・PC/タッチを確認する。"""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
import json

root=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent/'screenshots';out.mkdir(exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root)));Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/Game/Emberveil/'
errors=[];checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    for name,w,h,touch in [('desktop',1440,900,False),('mobile',390,844,True),('landscape',844,390,True)]:
        ctx=browser.new_context(viewport={'width':w,'height':h},has_touch=touch,is_mobile=touch)
        page=ctx.new_page();page.on('pageerror',lambda e:(errors.append(str(e)),print('JS ERROR:',e,flush=True)))
        page.on('console',lambda m:(errors.append(m.text),print('CONSOLE ERROR:',m.text,flush=True)) if m.type=='error' else None)
        page.goto(url);page.wait_for_function("window.emberveil && !document.querySelector('#title-screen').hidden",timeout=30000)
        page.screenshot(path=str(out/(name+'-title.png')))
        page.locator('#btn-new-game').click();page.locator('#newgame-seed').fill('smoke-'+name)
        page.locator('#btn-newgame-start').click();page.wait_for_function("emberveil.game.mode==='playing'",timeout=15000)
        page.locator('#btn-end-secondary').click()
        page.wait_for_timeout(350)
        state=page.evaluate('''() => ({mode:emberveil.game.mode,paused:emberveil.game.paused,seed:emberveil.game.seed,time:emberveil.game.time,canvas:[emberveil.renderer.canvas.width,emberveil.renderer.canvas.height],touch:!document.querySelector('#touch-controls').hidden,overflow:document.documentElement.scrollWidth>innerWidth})''')
        assert state['mode']=='playing' and not state['paused'],state
        assert page.evaluate('emberveil.renderer.ready'),'renderer failed to load'
        assert not state['overflow'],state
        page.screenshot(path=str(out/(name+'-game.png')))
        for button,panel in [('btn-inventory','inventory'),('btn-craft','craft'),('btn-map','map'),('btn-codex','codex')]:
            page.locator('#'+button).click();page.wait_for_timeout(120)
            assert page.locator('#modal').is_visible() and page.locator('#panel-'+panel).is_visible(),panel
            assert page.evaluate('emberveil.game.paused'),panel
            page.screenshot(path=str(out/(name+'-'+panel+'.png')))
            page.locator('#modal-close').click();page.wait_for_timeout(60)
            assert not page.evaluate('emberveil.game.paused'),panel
        checks.append(name+' start and 4 modal transitions')
        print(name,json.dumps(state),flush=True);ctx.close()
    browser.close()
server.shutdown()
assert not errors,errors
print('PASS:',checks)
