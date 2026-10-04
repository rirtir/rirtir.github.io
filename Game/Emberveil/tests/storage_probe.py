"""保存不可の環境と、操作権引き継ぎ後の古いタブを検証。"""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
import json

root=Path(__file__).resolve().parents[3]
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root)));Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/Game/Emberveil/dev/module-probe.html'
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page();page.goto(url)
    report=page.evaluate('''async()=>{
      const {SaveStore,TabLock,validateSave}=await import('../world.js');
      const ns='emberveil-test.'+Date.now(),a=new TabLock(ns),b=new TabLock(ns);
      const first=a.acquire(1),denied=b.acquire(1),take=b.acquire(1,{takeover:true}),old=a.ensure(1),owner=b.isOwner(1);
      a.release();b.release();
      // 同一のイベントループ内でも、期限が切れた別の所有者を旧タブが奪い直してはいけない。
      const c=new TabLock(ns+'-stale'),d=new TabLock(ns+'-stale');c.acquire(2);d.acquire(2,{takeover:true});
      d.store.setRaw('lock.slot2',JSON.stringify({tabId:d.tabId,ts:Date.now()-20000}));
      const resurrect=c.ensure(2);c.release();d.release();
      const bad=new SaveStore({setItem(){throw new DOMException('Denied','SecurityError')}});
      const fallback=bad.setRaw('example','retained'),memory=bad.getRaw('example');
      const reject=validateSave({format:'emberveil-save',version:1});
      for(const l of[a,b,c,d])l.channel?.close();
      return {first,denied,take,old,owner,resurrect,blocked:!bad.isAvailable(),fallback,memory,reject:!reject.ok};
    }''')
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
    assert report['first']['ok'] and not report['denied']['ok'] and report['denied']['heldByOther']
    assert report['take']['ok'] and report['owner'] and not report['old']['ok']
    assert report['blocked'] and report['fallback']['ok'] and report['memory']=='retained' and report['reject']
    assert not report['resurrect']['ok'],'期限切れの別タブから旧タブが操作権を自動で奪い直した'
    browser.close()
server.shutdown()
print('PASS: blocked storage fallback / malformed save rejected / takeover / stale session prevented')
