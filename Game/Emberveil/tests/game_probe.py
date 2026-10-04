"""実シミュレーションの操作・クラフト・戦闘進行・保存をChromeで検証。"""
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
    browser=p.chromium.launch(channel='chrome',headless=True);page=browser.new_page();page.goto(url)
    result=page.evaluate('''async()=>{
      const {Game,validateSave,SaveStore}=await import('../world.js'),{DATA}=await import('../data.js');
      const checks=[],check=(name,ok,detail)=>{if(!ok)throw new Error(name+': '+JSON.stringify(detail));checks.push(name);};
      const g=new Game(DATA);g.newGame({slot:1,seed:'integration',difficulty:'gentle'});window.testGame=g;
      check('new game and initial save',g.mode==='playing'&&validateSave(g.toSave()).ok,validateSave(g.toSave()).errors);
      const x=g.player.x;g.input.moveX=1;for(let i=0;i<60;i++)g.update(1/60);g.input.moveX=0;
      check('movement and collision',g.player.x>x+.2&&!g.world.isSolid(Math.floor(g.player.x),Math.floor(g.player.y)),[x,g.player.x]);
      const time=g.time;g.setPaused('menu',true);g.update(1/60);check('pause',g.time===time);g.setPaused('menu',false);
      g.giveItem('capwood',12);g.giveItem('glowcap',4);const wood=g.itemCount('capwood'),caps=g.itemCount('glowcap'),torches=g.itemCount('torch');
      const made=g.craft('torch',3);check('craft result',made.ok&&g.itemCount('torch')===torches+6,made);
      check('craft consumes exact materials',g.itemCount('capwood')===wood-3&&g.itemCount('glowcap')===caps-3);
      const impossible=g.craft('sword_ember',1);check('locked craft rejected',!impossible.ok);
      const save=g.toSave(),valid=validateSave(save);check('played save validates',valid.ok,valid.errors);
      const h=new Game(DATA),loaded=h.loadFromSave(valid.save,2);check('restore',loaded.ok&&h.seed===g.seed&&h.itemCount('torch')===g.itemCount('torch'),loaded);
      const bad=structuredClone(save);bad.player.hp=Infinity;check('nonfinite save rejected',!validateSave(bad).ok);
      const short=structuredClone(save);short.world.ground.pop();check('truncated world rejected',!validateSave(short).ok);
      const before={seed:h.seed,hp:h.player.hp,world:h.world};const broken=h.loadFromSave(bad,2);check('failed restore keeps world',!broken.ok&&h.seed===before.seed&&h.player.hp===before.hp&&h.world===before.world,broken);
      const store=new SaveStore();check('store write',store.write(1,save).ok);check('store read',store.read(1).ok);
      const text=store.getRaw('slot1');check('bad write rejected',!store.write(1,bad).ok&&store.getRaw('slot1')===text);
      for(const name of['getHUD','getObjective','getMapData','getCodex','getAchievements','getEndingStats','getRecipeView','getRenderState']){
        const value=g[name]();check('query '+name,value!=null);
      }
      const view=g.getRenderState();check('render contract',view.width===128&&view.height===128&&view.tileAt(64,64)&&Number.isFinite(view.player.x));
      for(let i=0;i<600;i++)g.update(1/60);check('continued simulation save',validateSave(g.toSave()).ok,validateSave(g.toSave()).errors);
      return {checks,count:checks.length,items:g.player.inventory.filter(Boolean).length};
    }''')
    print(json.dumps(result,ensure_ascii=False,indent=2),flush=True);browser.close()
server.shutdown()
print('PASS: game simulation and save integration')
