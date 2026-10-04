"""原画・整数拡大・実描画をChromeで検証する。"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
import json,time

root=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent/'screenshots';out.mkdir(exist_ok=True)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(root)))
Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/Game/Emberveil/dev/render-preview.html'
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    for name,w,h in [('render-desktop',1440,900),('render-mobile',390,844)]:
        page=browser.new_page(viewport={'width':w,'height':h})
        page.on('pageerror',lambda e:(errors.append(str(e)),print('JS ERROR:',str(e),flush=True)))
        page.on('response',lambda r:(errors.append(str(r.status)+' '+r.url),print('HTTP ERROR:',r.status,r.url,flush=True)) if r.status>=400 else None)
        page.goto(url);page.wait_for_function('window.ready===true',timeout=30000);page.wait_for_timeout(400)
        info=page.evaluate('''() => {const r=window.renderer,c=r.canvas,rect=c.getBoundingClientRect();return {native:[c.width,c.height],display:[rect.width,rect.height],smooth:r.ctx.imageSmoothingEnabled,center:r.screenToWorld(rect.left+rect.width/2,rect.top+rect.height/2),camera:r.camera};}''')
        assert not info['smooth']
        assert info['display'][0]/info['native'][0] in (1,2,3)
        assert info['display'][1]/info['native'][1]==info['display'][0]/info['native'][0]
        assert abs(info['center']['x']-info['camera']['x']/24)<.001
        start=time.perf_counter();page.evaluate('''() => {window.renderer.reducedMotion=true;for(let i=0;i<60;i++)window.renderer.render(1/60);}''');elapsed=time.perf_counter()-start
        page.screenshot(path=str(out/(name+'.png')))
        print(name,json.dumps(info),f'60 native frames: {elapsed:.2f}s')
        page.close()
    browser.close()
server.shutdown()
assert not errors,errors
print('PASS: browser renderer, assets, coordinate conversion, exact integer scaling, no JS errors')
