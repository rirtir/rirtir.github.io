"""実生成の再現性・導入資源・必須経路・レシピ参照をブラウザで検証。"""
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
url=f'http://127.0.0.1:{server.server_port}/Game/Emberveil/dev/render-preview.html'
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True);page=browser.new_page(viewport={'width':1440,'height':900});page.goto(url)
    page.evaluate('''async()=>{window.engine=await import('../world.js');window.DATA=(await import('../data.js')).DATA;}''')
    data=page.evaluate('''() => {
      const d=DATA, errors=[];const ids=new Set();
      for(const r of d.RECIPES){
        if(ids.has(r.id))errors.push('duplicate recipe '+r.id);ids.add(r.id);
        if(!d.ITEMS[r.out])errors.push('unknown output '+r.out);
        for(const i of r.in){if(i.key&&!d.ITEMS[i.key])errors.push('unknown ingredient '+i.key);if(!(i.n>0))errors.push('bad count '+r.id);}
      }
      const keys=new Map();for(const[a,codes]of Object.entries(d.KEYBINDS))for(const code of codes){if(keys.has(code))errors.push('key collision '+code);keys.set(code,a);}
      return {errors,recipes:d.RECIPES.length,items:Object.keys(d.ITEMS).length,achievements:d.ACHIEVEMENTS.length,frozen:Object.isFrozen(d.ITEMS)};
    }''')
    assert not data['errors'],data
    assert data['achievements']==20 and data['frozen']
    print('Definitions:',json.dumps(data),flush=True)
    for seed in ['emberveil','深庭','0','a','moss','seed-1','seed-2','seed-3','seed-4','seed-5','seed-6','seed-7']:
        report=page.evaluate('''seed=>{
          const a=engine.generateWorld(seed),b=engine.generateWorld(seed),w=a.world,z=b.world;
          const equal=['ground','wall','build','biome'].every(key=>w[key].every((v,i)=>v===z[key][i]));
          const start=w.anchors.start;
          const counts={};for(const o of w.objects.values())counts[o.type]=(counts[o.type]||0)+1;
          return {equal,startWalkable:w.isWalkable(start.x,start.y),size:[w.width,w.height],report:a.report,counts};
        }''',seed)
        assert report['equal'],seed
        assert report['size']==[128,128] and report['startWalkable'],(seed,report)
        assert not report['report']['failed'],(seed,report['report'])
        assert report['counts'].get('cap_tree',0)>=120,(seed,report['counts'])
        assert report['counts'].get('rubble',0)>=4 and report['counts'].get('altar',0)>=3,(seed,report['counts'])
        print('PASS seed',seed,'routes',json.dumps(report['report']['segments']),flush=True)
    page.wait_for_function('window.ready===true')
    page.evaluate('''() => {
      const w=engine.generateWorld('emberveil').world,d=DATA;
      const player={x:w.anchors.start.x+.5,y:w.anchors.start.y+.5,faceX:1,faceY:0};
      const view={width:128,height:128,player,mode:'title',objects:[...new Set(w.objects.values())].map(o=>({kind:d.OBJECTS[o.type].render,type:o.type,x:o.x+.5,y:o.y+.8})),enemies:[],effects:[],
        tileAt(x,y){const i=w.idx(x,y),wall=w.wall[i],b=w.build[i],g=w.ground[i];return {kind:wall?'wall':b===6||b===7?'bridge':b===1?'woodfloor':b>0?'stonefloor':g===9||g===10?'water':g===12?'lava':g===6||g===7?'stonefloor':'floor',biome:Math.max(0,w.biome[i]-1),ore:d.WALL[wall]?.ore};}};
      window.renderer.game={world:w,getRenderState:()=>view};window.renderer.camera.initialized=false;window.renderer.render(1/60);
    }''')
    out=Path(__file__).resolve().parent/'screenshots';out.mkdir(exist_ok=True)
    page.screenshot(path=str(out/'generated-world.png'))
    browser.close()
server.shutdown()
print('PASS: recipes, keys, 20 achievements, 12 seeds, repeatable geometry, guaranteed resources and routes')
