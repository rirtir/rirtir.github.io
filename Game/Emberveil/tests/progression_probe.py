"""建築・農業・収納・釣り・死亡回収・三守護者・エンディングを実エンジンで検証。
戦闘は各段階の警告と状態遷移を動かし、討伐判定だけ固定ダメージを使う。
"""
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
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True);page=browser.new_page()
    page.goto(f'http://127.0.0.1:{server.server_port}/Game/Emberveil/dev/module-probe.html')
    result=page.evaluate('''async()=>{
      const {Game,makeObject,validateSave}=await import('../world.js'),{DATA}=await import('../data.js');
      const checks=[],check=(name,ok,detail)=>{if(!ok)throw new Error(name+': '+JSON.stringify(detail));checks.push(name);};
      const g=new Game(DATA);g.newGame({slot:1,seed:'progression',difficulty:'gentle'});
      const w=g.world,p=g.player;g.enemies=[];
      let spot;for(let y=55;y<80&&!spot;y++)for(let x=52;x<76&&!spot;x++){
        const i=w.idx(x,y);if(!w.flags[i]&&!w.wall[i]&&!w.objects.has(i)&&DATA.GROUND[w.ground[i]].walk&&w.isWalkable(x,y+1))spot={x,y};
      }
      check('buildable clearing exists',!!spot);
      p.x=spot.x+.5;p.y=spot.y+1.5;
      g.giveItem('planter',1);p.selected=p.inventory.findIndex(s=>s?.id==='planter');p.placePreview={...spot,item:'planter',valid:true};g._placeSelected();
      check('place consumes and creates',w.objectAt(spot.x,spot.y)?.type==='planter'&&g.itemCount('planter')===0);
      g.giveItem('seed_tuber',2);check('plant consumes seed',g.plantAt(spot.x,spot.y,'seed_tuber').ok&&g.itemCount('seed_tuber')===1);
      check('double planting rejected',!g.plantAt(spot.x,spot.y,'seed_tuber').ok&&g.itemCount('seed_tuber')===1);
      const planter=w.objectAt(spot.x,spot.y),ix=w.idx(spot.x,spot.y);w.light[ix]=0;
      g._updateWorldTimers(300);check('crops wait for light',planter.stage===0&&planter.dark);
      w.light[ix]=1;g._updateWorldTimers(300);check('lit crop matures',planter.stage===3);
      const tubers=g.itemCount('tuber');g._harvestPlanter(planter);check('harvest and seed returned',g.itemCount('tuber')>=tubers+2&&g.itemCount('seed_tuber')>=2&&!planter.crop);
      check('remove refunds',g._removeAt(spot.x,spot.y)===true&&!w.objectAt(spot.x,spot.y)&&g.itemCount('planter')===1);
      const chest=makeObject('chest',spot.x,spot.y);w.setObject(chest);g._trackObject(chest);g.openContainer=ix;
      p.inventory[12]={id:'capwood',n:15};check('deposit bag only',g.depositAll().moved>=15&&chest.items.some(s=>s?.id==='capwood'&&s.n>=15));
      check('nonempty chest protected',typeof g._removeAt(spot.x,spot.y)==='string');
      check('take chest contents',g.takeAll().ok&&!chest.items.some(Boolean));g.closeContainer();
      check('empty chest removable',g._removeAt(spot.x,spot.y)===true);
      let water;for(let y=1;y<127&&!water;y++)for(let x=1;x<127&&!water;x++)if(DATA.GROUND[w.ground[w.idx(x,y)]].fish&&!w.wall[w.idx(x,y)]&&w.isWalkable(x-1,y))water={x,y};
      check('fishable shore exists',!!water);p.x=water.x-.5;p.y=water.y+.5;p._dir=[1,0];g._idle();g._startFishing();
      check('cast from real shore',g.fishing?.phase==='cast',g.fishing);
      for(let i=0;i<900&&g.fishing?.phase!=='bite';i++){p.invulnT=100;g.update(1/60);}
      check('fish bite window reached',g.fishing?.phase==='bite',g.fishing);g._fishPress();
      check('caught fish and recorded',!g.fishing&&Object.values(g.stats.fish).reduce((a,b)=>a+b,0)===1);
      p.inventory[20]={id:'capwood',n:7};const held=p.inventory.slice(0,8).map(s=>s&&{...s});g._directDamage(999,'fixture');
      check('death keeps hotbar',g.mode==='dead'&&JSON.stringify(p.inventory.slice(0,8))===JSON.stringify(held));
      const sat=[...w.objects.values()].find(o=>o.type==='satchel');check('bag becomes recoverable satchel',!!sat&&sat.items.some(s=>s.id==='capwood'&&s.n>=7));
      g.respawn();check('respawn restores control',g.mode==='playing'&&p.hp>0);const recovered=g.itemCount('capwood');g._recoverSatchel(sat);
      check('recover lost items',g.itemCount('capwood')>=recovered+7&&!w.objectAt(sat.x,sat.y));
      check('early core offering rejected',!g.offerHearts().ok);
      for(const key of ['moss','crystal','ember']){
        const a=w.anchors.arenas[key];p.x=a.cx+.5;p.y=a.cy+3.5;g.enemies=[];g._startBoss(key);
        let warning=false;for(let i=0;i<960;i++){p.invulnT=100;p.hp=p.maxHp;g.update(1/60);if(g.hazards.some(h=>h.phase==='warn')){warning=true;break;}}
        check(key+' warning before attack',warning,{state:g.boss?.state,hazards:g.hazards});
        g._damageBoss(Math.ceil(g.boss.maxHp*.65),{item:'sword_wood',combo:0});check(key+' phase two',g.boss.phase===2);
        g._damageBoss(99999,{item:'sword_wood',combo:0});for(let i=0;i<240&&g.boss;i++){p.invulnT=100;g.update(1/60);}
        check(key+' defeat reward and heart',!g.boss&&g.progress.hearts[key]&&g.stats.killed[key]===1);
        if(key!=='ember')check(key+' next gate open',g.progress.gates[key==='moss'?'crystal':'ember']);
        check(key+' save after boss',validateSave(g.toSave()).ok,validateSave(g.toSave()).errors);
      }
      p.x=64.5;p.y=65.5;check('offer three hearts',g.offerHearts().ok&&g.mode==='ending'&&g.progress.coreRestored);
      for(let i=0;i<900&&g.ending.phase!=='text';i++)g.update(1/60);
      check('ending text reached',g.ending.phase==='text');g.finishEnding();check('postgame continues',g.mode==='playing'&&g.progress.endingSeen);
      const s=g.toSave(),v=validateSave(s);check('finished save valid',v.ok,v.errors);const h=new Game(DATA);check('finished save restores',h.loadFromSave(s,2).ok&&h.progress.coreRestored&&h.progress.endingSeen);
      return {checks,count:checks.length};
    }''')
    print(json.dumps(result,ensure_ascii=False,indent=2));browser.close()
server.shutdown()
print('PASS: progression systems')
