"""独立レビューで再現した保存・料理・建築上限の回帰検証。
実際のChromeで同じゲームエンジンを動かす。上限検証だけ大量資源を固定配置する。
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from time import perf_counter
import json

from playwright.sync_api import sync_playwright


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


started = perf_counter()
root = Path(__file__).resolve().parents[3]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page()
        page.goto(f'http://127.0.0.1:{server.server_port}/Game/Emberveil/dev/module-probe.html')
        result = page.evaluate('''async () => {
          const {Game, SaveStore, TabLock, makeObject, validateSave} = await import('../world.js');
          const {DATA} = await import('../data.js');
          const checks = [];
          const check = (name, ok, detail) => {
            if (!ok) throw new Error(name + ': ' + JSON.stringify(detail));
            checks.push(name);
          };
          const fresh = () => { const g = new Game(); g.newGame({seed:'engine-review',slot:1}); return g; };

          // 素材を半分消費しても空き枠ができない状態で、99個を超える出力を作る。
          const mass = fresh();
          mass.player.inventory = Array.from({length:32}, () => ({id:'stone',n:99}));
          mass.player.inventory[0] = {id:'capwood',n:99};
          mass.player.inventory[1] = {id:'glowcap',n:99};
          check('bulk craft creates 100 torches', mass.craft('torch',50).made === 100);
          check('overflow preserves all output in valid stacks',
            mass.drops.reduce((n,d)=>n+d.n,0) === 100 &&
            mass.drops.every(d=>d.item==='torch' && d.n>0 && d.n<=DATA.ITEMS[d.item].stack),mass.drops);
          check('bulk craft save validates', validateSave(mass.toSave()).ok);
          const storageMap = new Map();
          const storage = {getItem:k=>storageMap.get(k)??null,setItem:(k,v)=>storageMap.set(k,String(v)),removeItem:k=>storageMap.delete(k)};
          const store = new SaveStore(storage,'emberveil.review');
          const a = new TabLock(store), b = new TabLock(store);
          try {
            check('fresh lease acquired', a.acquire(1).ok);
            check('live other lease is denied', !b.acquire(1).ok);
            check('bulk craft writes persistently', store.write(1,mass.toSave(),{lock:a}).ok);
            check('persisted bulk output restores', store.read(1).save.world.drops.reduce((n,d)=>n+d.n,0)===100);
            a.release(1);
            store.setRaw('lock.slot1',JSON.stringify({tabId:'future',ts:Date.now()+31536000000}));
            check('future lease cannot block acquisition', b.acquire(1).ok);
            b.release(1);
            store.setRaw('lock.slot1',JSON.stringify({tabId:'invalid',ts:Infinity}));
            check('nonfinite lease cannot block acquisition', a.acquire(1).ok);
            check('explicit takeover succeeds', b.acquire(1,{takeover:true}).ok);
            check('previous owner cannot save after takeover', !store.write(1,mass.toSave(),{lock:a}).ok);
          } finally {a.release();b.release();a.channel?.close();b.channel?.close();}

          // 回復値が不要でも、有効なバフを得る食事は使用できる。
          for (const key of ['jelly','stew','pepper_fish','golden_feast']) {
            const g=fresh(), p=g.player, food=DATA.ITEMS[key].food;
            p.hp=p.maxHp;p.hunger=p.maxHunger;g.giveItem(key,3);
            const ix=p.inventory.findIndex(s=>s?.id===key), before=g.itemCount(key);
            const buffs=[...(food.buffs||[]),...(food.buff?[food.buff]:[])];
            check(key+' applies buff at full vitals',g.useItem({box:'inv',i:ix}).ok&&
              buffs.every(b=>p.buffs.some(active=>active.id===b.id&&active.t===b.t)));
            check(key+' consumes exactly one serving',g.itemCount(key)===before-1);
            check(key+' redundant serving rejected',!g.useItem({box:'inv',i:ix}).ok&&g.itemCount(key)===before-1);
            for(const active of p.buffs)active.t-=1;
            check(key+' shortened buff refreshes',g.useItem({box:'inv',i:ix}).ok&&
              buffs.every(b=>p.buffs.some(active=>active.id===b.id&&active.t===b.t)));
          }
          const plain=fresh();plain.player.hp=plain.player.maxHp;plain.player.hunger=plain.player.maxHunger;
          for(const key of ['roast_tuber','salve']) {
            plain.giveItem(key,1);const ix=plain.player.inventory.findIndex(s=>s?.id===key);
            check(key+' is not wasted at full vitals',!plain.useItem({box:'inv',i:ix}).ok&&plain.itemCount(key)===1);
          }

          const live=fresh(), beforeWorld=live.world, before=JSON.stringify(live.toSave().player);
          const corrupt=live.toSave();corrupt.world.objects.push({t:'altar',x:64,y:68,boss:false});
          check('misplaced altar save rejected',!validateSave(corrupt).ok);
          check('misplaced altar load rejected',!live.loadFromSave(corrupt,2).ok);
          check('failed load preserves current game',live.world===beforeWorld&&JSON.stringify(live.toSave().player)===before);
          let guarded=true;try{live._interact(makeObject('altar',64,68));}catch(e){guarded=false;}
          check('unmatched altar interaction is guarded',guarded);

          // 世界を8,000個近くまで増やし、建設と死亡袋を同じ保存で検証する。
          const large=fresh(), w=large.world, p=large.player;
          const count=()=>new Set(w.objects.values()).size;
          const reserve=(x,y)=>x>=78&&x<=83&&y>=78&&y<=83;
          for(let y=78;y<=83;y++)for(let x=78;x<=83;x++){
            const existing=w.objectAt(x,y);if(existing)w.deleteObject(existing);
            const i=w.idx(x,y);w.wall[i]=0;w.ground[i]=1;w.build[i]=0;w.flags[i]=0;
          }
          p.x=80.5;p.y=81.5;large.enemies=[];
          const target=DATA.BALANCE.limits.objects-2;
          for(let y=1;y<127&&count()<target;y++)for(let x=1;x<127&&count()<target;x++){
            const i=w.idx(x,y);
            if(w.flags[i]||reserve(x,y)||w.objects.has(i))continue;
            w.wall[i]=0;w.ground[i]=1;w.build[i]=0;
            w.setObject(makeObject('glowcap',x,y));
          }
          check('large world fixture reaches reservation threshold',count()===target,count());
          check('large world before construction saves',validateSave(large.toSave()).ok);
          large.giveItem('torch',2);p.selected=p.inventory.findIndex(s=>s?.id==='torch');
          p.placePreview={x:80,y:80,item:'torch',valid:true};large._placeSelected();
          check('last construction slot remains usable',w.objectAt(80,80)?.type==='torch'&&count()===target+1&&large.itemCount('torch')===1);
          p.placePreview={x:81,y:80,item:'torch',valid:true};large._placeSelected();
          check('construction preserves death-bag reservation',!w.objectAt(81,80)&&large.itemCount('torch')===1&&count()===target+1);
          large.giveItem('cap_spore',1);
          check('tree planting preserves reservation and item',!large.plantAt(81,80,'cap_spore').ok&&large.itemCount('cap_spore')===1);
          p.inventory[20]={id:'stone',n:5};large._directDamage(999,'review-fixture');
          check('death bag fits reserved slot',large.mode==='dead'&&count()===DATA.BALANCE.limits.objects&&
            [...new Set(w.objects.values())].some(o=>o.type==='satchel'&&o.items.some(s=>s.id==='stone'&&s.n===5)));
          large.respawn();const finalSave=large.toSave(), finalValidation=validateSave(finalSave);
          check('large world after death remains savable',large.canSave().ok&&finalValidation.ok,finalValidation.errors);
          check('large world recovery writes to storage',store.write(2,finalSave).ok);
          return {checks,count:checks.length};
        }''')
        print(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()
finally:
    server.shutdown()
print(f'PASS: engine review regressions ({perf_counter()-started:.2f}s)')
