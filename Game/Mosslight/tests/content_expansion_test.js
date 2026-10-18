// Independent content acceptance. Public game actions; grants, teleport, setClock and
// existing review fixtures accelerate preparation, never substitute successful actions.
import * as sim from '../simulation.js';
import { createWorld, isWaterTile, isWalkable, nodeAt } from '../world.js';
import { BALANCE, TILE, ITEMS, NODES, RECIPES, CONTENT_RECIPES, CONTENT_ITEMS,
  STRUCTURES, CROPS, FISH, FISH_TIME_RANGES, REQUESTS, EXTRA_GOALS, SPAWN_RULES,
  ENEMIES, NPCS } from '../data.js';
import { canTill, cropRipe } from '../settlement.js';
import { cropAt, objectAt, floorAt, farmAt } from '../layers.js';
import { bossEntity, damagePlayer } from '../combat.js';
import { createReviewFixture } from './gameplay.js';

const fresh = () => sim.createState(createWorld());
const json = v => JSON.stringify(v);
function must(result, label) { if (!result || result.ok === false) throw Error(`${label}: ${json(result)}`); return result; }
function grant(s,id,n=1) { if(sim.addItem(s,id,n,{silent:true}))throw Error(`grant ${id} ${n} overflow`); }
function quiet(s) { s.timers.spawn=-1e9; }
function go(s,map,x,y) { if(!sim.teleport(s,map,x,y))throw Error(`teleport ${map} ${x},${y}`);quiet(s); }
function advance(s,seconds) { for(let t=0;t<seconds;t+=.25){sim.step(s,Math.min(.25,seconds-t));s.events.length=0;} }
function clearBag(s) { const counts={};for(const slot of s.player.bag)if(slot)counts[slot.id]=(counts[slot.id]||0)+slot.n;for(const [id,n]of Object.entries(counts))if(!sim.removeItem(s,id,n))throw Error(`Cannot clear ${id}`); }
function owned(s,id) { return sim.countItem(s,id)+Object.values(s.player.equip).filter(x=>x===id).length; }
function restore(s) { const raw=sim.serialize(s);if(!sim.validateSave(raw).ok)throw Error('generated save invalid');return sim.createState(createWorld(),raw); }
function shore(s) {
  const m=s.world.surface;
  for(let y=1;y<m.h-1;y++)for(let x=1;x<m.w-1;x++) {
    if(!isWaterTile(m,x,y))continue;
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      if(isWalkable(m,x+dx,y+dy)&&sim.teleport(s,'surface',x+dx,y+dy)
        &&Math.hypot((x+.5)*TILE-s.player.x,(y+.5)*TILE-s.player.y)<=4*TILE) {
        quiet(s);return {x,y};
      }
    }
  }
  throw Error('No reachable shore');
}
function rod(s,id='rod_wood') {
  grant(s,id);if(!sim.assignHotbar(s,0,id))throw Error('Rod cannot enter hotbar');s.player.sel=0;
}
function bite(s,aim) { must(sim.startCast(s,aim),'cast');const f=s.fishing;sim.updateFishing(s,f.biteAt+.001,{});if(s.fishing?.phase!=='bite')throw Error('No bite');return f; }
function unlockMoss(s) {
  const a=s.world.underground.landmarks.mossAltar;
  go(s,'underground',a.x-1,a.y+1);grant(s,'crystal_moss',3);must(sim.restoreLight(s,'moss'),'crystals');
  const boss=bossEntity(s,'vine');if(!boss)throw Error('No vine');
  // Boss defeat is fixture preparation, not a claim of actual-input combat success.
  for(let i=0;boss.hp>0&&i<200;i++)sim.damageEnemy(s,boss,ITEMS[s.player.equip.weapon].weapon.dmg,0,0);
  advance(s,.8);
  const wick=s.groundItems.find(g=>g.item==='moss_wick');if(!wick)throw Error('No wick');
  go(s,wick.map,Math.floor(wick.x/TILE),Math.floor(wick.y/TILE));advance(s,1);
  go(s,'underground',a.x-1,a.y+1);must(sim.restoreLight(s,'moss'),'moss');
}
function nearNpc(s,id) { const n=s.npcs.find(n=>n.id===id);if(!n)throw Error(`Missing resident ${id}`);go(s,'surface',Math.floor(n.x/TILE),Math.floor(n.y/TILE)); }
function install(s,type) {
  const m=s.world.surface,c=m.landmarks.camp;grant(s,STRUCTURES[type].item);
  for(let y=c.y-9;y<c.y+10;y++)for(let x=c.x-9;x<c.x+10;x++) {
    if(!isWalkable(m,x,y)||nodeAt(m,x,y))continue;
    go(s,'surface',x,y+1);
    if(sim.canBuild(s,type,x,y).ok){must(sim.place(s,type,x,y),`place ${type}`);return;}
  }
  throw Error(`No site ${type}`);
}

export async function runContentExpansionTests() {
  const checks=[];
  const check=(name,ok,detail='')=>checks.push({name:`content expansion: ${name}`,ok:!!ok,detail:ok?'':typeof detail==='string'?detail:json(detail)});
  const eq=(name,a,b)=>check(name,json(a)===json(b),{expected:b,actual:a});
  const section=async(name,fn)=>{try{await fn();}catch(e){check(`${name} exception`,false,String(e.stack||e));}};

  await section('availability',()=>{
    const s=fresh(),have=new Set(),stations=new Set(['hand','campfire']),tiers={axe:0,pick:0,hoe:0};
    // Actual generated node types (including walls), rather than all hypothetical nodes.
    const types=new Set([...s.world.surface.nodes,...s.world.underground.nodes].map(n=>n.type));
    for(const id of ['dirt_wall','moss_wall','copper_wall','iron_wall'])types.add(id);
    for(const box of Object.values(s.containers))for(const v of box)if(v)have.add(v.id);
    let changed=true;
    const add=id=>{if(!have.has(id)){have.add(id);changed=true;}};
    while(changed){changed=false;
      for(const type of types){const d=NODES[type];if(!d||d.tool&&tiers[d.tool]<(d.hardness||1))continue;for(const drop of d.drops||[])add(drop.item);}
      // Ordinary enemy resources become available after obtaining the stone sword.
      if(have.has('sword_stone'))for(const d of Object.values(ENEMIES))for(const drop of d.drop||[])add(drop.item);
      for(const r of RECIPES)if(r.stations.some(st=>stations.has(st))&&Object.keys(r.inputs).every(id=>have.has(id))) {
        add(r.out);const d=ITEMS[r.out];if(d.tool&&tiers[d.tool]<d.tier){tiers[d.tool]=d.tier;changed=true;}
        if(d.place)for(const st of STRUCTURES[d.place]?.provides||[])if(!stations.has(st)){stations.add(st);changed=true;}
      }
      if(tiers.hoe)for(const d of Object.values(CROPS))if(have.has(d.seed))for(const drop of d.harvest)add(drop.item);
      for(const f of Object.values(FISH))if(Object.keys(ITEMS).some(id=>have.has(id)&&ITEMS[id].rod>=f.minRod)&&(!f.bait||have.has(f.bait)))add(f.item);
      // Residents require available housing supplies; request stages are checked separately.
      if(['wall_wood','floor_wood','door_wood','bed','candlestick'].every(id=>have.has(id))) {
        for(const n of Object.values(NPCS))for(const d of [].concat(n.produce||[]))if(d.item)add(d.item);
        for(const r of Object.values(REQUESTS))if(Object.keys(r.needs).every(id=>have.has(id)))for(const id of Object.keys(r.reward.items))add(id);
      }
    }
    for(const d of CONTENT_ITEMS)check(`${d.id} obtainable through generated resources/tools/stations`,have.has(d.id),{missing:d.id});
    for(const [id,d]of Object.entries(ITEMS))if(!d.key&&!d.reward)check(`${id} complete item-graph reachability with required tool tiers`,have.has(id));
    for(const r of CONTENT_RECIPES)check(`${r.id} inputs and working station reachable`,Object.keys(r.inputs).every(id=>have.has(id))&&r.stations.some(st=>stations.has(st)));
    const goals=sim.getLifeGoals(s).slice(8);
    eq('six added goals retain defined identities/targets',goals.map(g=>[g.id,g.target]),EXTRA_GOALS.map(g=>[g.id,g.target]));
    check('all six added goals start empty',goals.length===6&&goals.every(g=>g.value===0&&!g.done));
    for(const rule of SPAWN_RULES)check(`${rule.id} exists in an initialized world`,s.world.maps[rule.layer].nodes.some(n=>n.type===rule.node));
  });

  await section('recipes',()=>{
    const s=createReviewFixture('house').state;
    for(const type of ['furnace','pot','loom','kiln','smoker'])install(s,type);
    for(const r of CONTENT_RECIPES){
      clearBag(s);for(const [id,n]of Object.entries(r.inputs))grant(s,id,n);
      const st=s.structures.find(v=>STRUCTURES[v.type].provides?.some(p=>r.stations.includes(p)));
      if(!r.stations.includes('hand')){if(!st)throw Error(`No station ${r.id}`);go(s,st.map,st.x,st.y+1);}
      const before=owned(s,r.out),result=sim.craft(s,r.id);
      check(`${r.id} crafts exact output and consumes exact inputs`,result.ok&&owned(s,r.out)-before===r.n&&Object.keys(r.inputs).every(id=>sim.countItem(s,id)===0),result);
      if(ITEMS[r.out].eat){
        check(`${r.id} records actual cooking in journal`,s.progress.journal.dish[r.out]>=r.n);
        const buff=ITEMS[r.out].eat.buff;
        advance(s,6); // Get naturally hungry, and finish any previous eat animation.
        check(`${r.id} can be eaten`,sim.eat(s,r.out).ok);
        advance(s,BALANCE.hunger.eatTime+.1);
        check(`${r.id} eating consumes one real portion`,owned(s,r.out)===before+r.n-1);
        if(buff){
          check(`${r.id} applies its advertised buff`,s.player.buffs.some(b=>b.id===buff.id&&b.v===buff.v&&b.until>s.time.clock));
          advance(s,buff.time+1);check(`${r.id} buff expires`,!s.player.buffs.some(b=>b.id===buff.id&&b.until>s.time.clock));
        }
      }
    }
    const loaded=restore(s);eq('dish journal and extra progress survive roundtrip',loaded.progress.journal,s.progress.journal);
    sim.step(s,1);
    check('ten actual cooked dishes complete and persist the dish goal',sim.getLifeGoals(s).find(g=>g.id==='dish_ten')?.done&&restore(s).progress.goals.dish_ten);
  });

  await section('fishing',()=>{
    const s=fresh(),aim=shore(s);rod(s);grant(s,'bait_worm',3);
    const initial=json(s.player.bag);
    must(sim.startCast(s,aim),'cancel cast');sim.cancelFishing(s,'modal');
    eq('modal cancellation consumes nothing',s.player.bag,JSON.parse(initial));
    must(sim.startCast(s,aim),'early cast');sim.updateFishing(s,0,{});sim.updateFishing(s,.01,{actPressed:true});
    check('early input cancels without bait consumption',!s.fishing&&json(s.player.bag)===initial);
    let f=bite(s,aim),fish=f.fish,bait=f.bait,oldCount=sim.countItem(s,FISH[fish].item),oldBait=sim.countItem(s,bait);
    sim.updateFishing(s,0,{actPressed:true});sim.updateFishing(s,0,{actPressed:true});
    check('same-frame double input awards exactly one fish and one journal count',sim.countItem(s,FISH[fish].item)===oldCount+1&&s.progress.journal.fish[fish]?.n===1&&s.progress.fishing.catches===1);
    check('successful catch consumes exactly one selected bait',sim.countItem(s,bait)===oldBait-1);
    f=bite(s,aim);const bag=json(s.player.bag);sim.updateFishing(s,f.window+.001,{});
    check('elapsed bite window cancels without any consumption',!s.fishing&&json(s.player.bag)===bag);
    sim.updateFishing(s,0,{actPressed:true});eq('late input after timeout cannot claim catch',s.player.bag,JSON.parse(bag));
    f=bite(s,aim);const endCount=s.progress.fishing.catches;
    sim.updateFishing(s,f.window,{});sim.updateFishing(s,0,{actPressed:true});
    check('exact window end allows exactly one catch',s.progress.fishing.catches===endCount+1&&!s.fishing);
    f=bite(s,aim);const crossingBag=json(s.player.bag),crossingCount=s.progress.fishing.catches;
    sim.updateFishing(s,f.window-1/120,{});
    sim.step(s,1/60,{actPressed:true}); // Current frame is 1/120s beyond the bite deadline.
    check('input in a frame crossing the bite deadline cannot catch or consume',!s.fishing&&s.progress.fishing.catches===crossingCount&&json(s.player.bag)===crossingBag,
      {window:f.window,previousElapsed:f.window-1/120,frameDelta:1/60,catchesBefore:crossingCount,catchesAfter:s.progress.fishing.catches});
    for(const reason of ['manual','modal','dodge','damage','mapchange']) {
      must(sim.startCast(s,aim),`${reason} cast`);const before=json(s.player.bag);sim.cancelFishing(s,reason);
      check(`${reason} cancellation is idempotent and nonconsuming`,!s.fishing&&!sim.cancelFishing(s,reason)&&json(s.player.bag)===before);
    }
    must(sim.startCast(s,aim),'real dodge cast');const dodgedBag=json(s.player.bag);
    sim.step(s,.01,{dodgePressed:true});check('actual dodge input cancels without consumption',!s.fishing&&json(s.player.bag)===dodgedBag);
    advance(s,2);shore(s);must(sim.startCast(s,aim),'real damage cast');const hurtBag=json(s.player.bag),hp=s.player.hp;
    const hurt=damagePlayer(s,6,s.player.x-20,s.player.y);
    check('actual damage cancels fishing without bait consumption',hurt&&s.player.hp<hp&&!s.fishing&&json(s.player.bag)===hurtBag);
    shore(s);must(sim.startCast(s,aim),'switch cast');sim.assignHotbar(s,0,null);sim.step(s,.01);
    check('removing selected rod cancels on game update',!s.fishing);sim.assignHotbar(s,0,'rod_wood');
    const distanceBag=json(s.player.bag);go(s,'surface',s.world.surface.landmarks.camp.x,s.world.surface.landmarks.camp.y+2);
    check('far shore target rejects before any consumption',!sim.startCast(s,aim).ok&&json(s.player.bag)===distanceBag);shore(s);
    must(sim.startCast(s,aim),'layer cast');const spawn=s.world.underground.landmarks.spawn;
    go(s,'underground',spawn.x,spawn.y);sim.step(s,.01);check('actual teleport cancels fishing on next game update',!s.fishing);shore(s);
    must(sim.startCast(s,aim),'movement cast');advance(s,.5);sim.step(s,.5,{moveX:Math.sign(s.player.x-(aim.x+.5)*TILE),moveY:Math.sign(s.player.y-(aim.y+.5)*TILE)});
    check('real movement cancels fishing',!s.fishing);
    shore(s);f=bite(s,aim);const transient=restore(s);check('save/load never restores transient fishing/action',!transient.fishing&&transient.player.action?.type!=='fish');sim.cancelFishing(s);
    clearBag(s);grant(s,'rod_wood');grant(s,'bait_worm',2);grant(s,'stone',99*28);
    // rod+bait+28 full stone stacks occupy all 30 slots; bait-1 does not free a slot.
    f=bite(s,aim);const full=json(s.player.bag),catches=s.progress.fishing.catches;
    sim.updateFishing(s,0,{actPressed:true});
    check('full bag catch consumes neither bait nor fish; journal unchanged',!s.fishing&&json(s.player.bag)===full&&s.progress.fishing.catches===catches);
    clearBag(s);grant(s,'rod_wood');grant(s,'bait_worm',1);grant(s,'stone',99*28);
    f=bite(s,aim);sim.updateFishing(s,0,{actPressed:true});
    check('last bait frees a slot for the catch in a full bag',!s.fishing&&sim.countItem(s,'bait_worm')===0&&sim.countItem(s,FISH[f.fish].item)===1);
    for(const region of ['shore','deep'])for(const slot of Object.keys(FISH_TIME_RANGES))check(`${region}/${slot} beginner fish table nonempty`,sim.fishTable(region,slot,1,null).length>0);
    const all=fresh(),water=shore(all);rod(all,'rod_copper');grant(all,'bait_worm',300);grant(all,'bait_glow',300);
    const slots=['morning','day','dusk','night'];let attempts=0;
    for(;attempts<320&&Object.keys(all.progress.journal.fish).length<8;attempts++){
      // Consecutive casts per time slot prevent cadence aliasing with automatic bait parity.
      const slot=slots[Math.floor(attempts/40)%4];sim.setClock(all,FISH_TIME_RANGES[slot][0][0]+1);
      f=bite(all,water);sim.updateFishing(all,0,{actPressed:true});
    }
    for(const [id,d]of Object.entries(FISH))check(`${id} actually caught with valid time/rod/bait`,all.progress.journal.fish[id]?.n>=1&&all.progress.journal.fish[id].max>=d.sizeMin&&all.progress.journal.fish[id].max<=d.sizeMax,{attempts});
    eq('fish count/maximum/cast statistics persist',restore(all).progress.journal.fish,all.progress.journal.fish);
    const book=sim.getJournalEntries(all).find(group=>group.kind==='fish');
    check('public journal API reports all eight caught fish and their actual records',book.total===8&&book.seen===8&&book.entries.every(e=>e.seen&&e.n===all.progress.journal.fish[e.id].n&&e.max===all.progress.journal.fish[e.id].max));
    check('eight real catches complete the added fish goal',sim.getLifeGoals(all).find(g=>g.id==='fish_all')?.value===8);
    sim.step(all,1);check('completed fish goal is saved',restore(all).progress.goals.fish_all);
  });

  await section('requests',()=>{
    const s=createReviewFixture('house').state;
    for(const [id,n]of Object.entries(REQUESTS.cook_cave.needs))grant(s,id,n);
    const blocked=json(s.player.bag);
    check('request stage refusal before moss is nonconsuming despite owned needs',sim.deliverRequest(s,'cook_cave').code==='stage'&&json(s.player.bag)===blocked);
    const no=fresh(),empty=json(no.player.bag);check('absent resident refuses without consumption',sim.deliverRequest(no,'cook_herbs').code==='absent'&&json(no.player.bag)===empty);
    unlockMoss(s);
    for(const [id,r]of Object.entries(REQUESTS)) {
      nearNpc(s,r.npc);clearBag(s);
      const before=json(s.player.bag);check(`${id} insufficient materials refuse atomically`,!sim.deliverRequest(s,id).ok&&json(s.player.bag)===before);
      for(const [item,n]of Object.entries(r.needs))grant(s,item,n);
      const baseline=Object.fromEntries(Object.keys(r.reward.items).map(item=>[item,owned(s,item)]));
      const result=sim.deliverRequest(s,id);
      check(`${id} exact delivery/reward/completion`,result.ok&&s.progress.requests[id]===1&&Object.entries(r.reward.items).every(([item,n])=>owned(s,item)===baseline[item]-(r.needs[item]||0)+n)&&Object.keys(r.needs).every(item=>sim.countItem(s,item)===(r.reward.items[item]||0)),result);
      const once=json(s.player.bag);check(`${id} duplicate delivery cannot pay again`,sim.deliverRequest(s,id).code==='done'&&json(s.player.bag)===once);
    }
    const loaded=restore(s);eq('all fifteen request completions persist',loaded.progress.requests,s.progress.requests);
    check('request goal equals fifteen actual deliveries',sim.getLifeGoals(s).find(g=>g.id==='requests_all')?.value===15);
    sim.step(s,1);check('completed request goal is saved',restore(s).progress.goals.requests_all);
    const cap=createReviewFixture('house').state;nearNpc(cap,'cook');clearBag(cap);
    grant(cap,'herb',5);grant(cap,'mushroom',3);grant(cap,'stone',99*28);
    const before=json(cap.player.bag);check('reward overflow refuses before consuming any needs',sim.deliverRequest(cap,'cook_herbs').code==='full'&&json(cap.player.bag)===before&&!cap.progress.requests.cook_herbs);
    sim.removeItem(cap,'herb',1);sim.removeItem(cap,'mushroom',1);
    check('consuming needs frees precisely two reward slots',sim.deliverRequest(cap,'cook_herbs').ok);
    clearBag(cap);for(const [id,n]of Object.entries(REQUESTS.cook_smoke.needs))grant(cap,id,n);
    const distance=json(cap.player.bag),npc=cap.npcs.find(n=>n.id==='cook');go(cap,'surface',Math.floor(npc.x/TILE)+10,Math.floor(npc.y/TILE));
    check('distant resident rejects complete materials without consuming',sim.deliverRequest(cap,'cook_smoke').code==='far'&&json(cap.player.bag)===distance);
  });

  await section('crops',()=>{
    const s=createReviewFixture('house').state,m=s.world.surface;
    // New plots away from residents' existing ripe fields, using actual canTill/till.
    const plots=[];
    for(let y=2;y<m.h-2&&plots.length<8;y++)for(let x=2;x<m.w-2&&plots.length<8;x++){
      if(!isWalkable(m,x,y)||nodeAt(m,x,y))continue;go(s,'surface',x,y);
      if(canTill(s,x,y).ok){must(sim.till(s,x,y),'till');plots.push({x,y});}
    }
    if(plots.length!==8)throw Error('No eight plots');
    for(const [i,[kind,d]]of Object.entries(Object.entries(CROPS))) {
      const site=plots[+i];go(s,'surface',site.x,site.y);clearBag(s);grant(s,d.seed,1);
      must(sim.plant(s,kind,site.x,site.y),`${kind} plant`);
      check(`${kind} planting consumes one seed and refuses early harvest`,sim.countItem(s,d.seed)===0&&!sim.harvest(s,cropAt(s,'surface',site.x,site.y)).ok);
      advance(s,d.stages*d.stageTime+2);
      const crop=cropAt(s,'surface',site.x,site.y);
      check(`${kind} grows naturally through all stages`,cropRipe(crop));
      const result=sim.harvest(s,crop);
      check(`${kind} exact harvest and automatic reseed`,result.ok&&result.replanted&&d.harvest.every(h=>sim.countItem(s,h.item)===h.n-(h.item===d.seed?1:0))&&cropAt(s,'surface',site.x,site.y)?.growth===0,result);
      check(`${kind} journal counts actual yield once`,s.progress.journal.crop[kind]>=d.harvest[0].n);
      const after=json(s.player.bag);check(`${kind} stale crop cannot duplicate harvest`,!sim.harvest(s,crop).ok&&json(s.player.bag)===after);
      const split=CONTENT_RECIPES.find(r=>r.id===`${kind}_seed_split`);
      if(split){const seeds=sim.countItem(s,d.seed);check(`${kind} produce can recover two seeds`,sim.craft(s,split.id).ok&&sim.countItem(s,d.seed)===seeds+2);}
    }
    eq('all crop kinds and growth persist',restore(s).crops.map(c=>[c.kind,c.growth]),s.crops.map(c=>[c.kind,c.growth]));
    eq('crop journal survives save',restore(s).progress.journal.crop,s.progress.journal.crop);
    check('eight real harvests complete the added crop goal',sim.getLifeGoals(s).find(g=>g.id==='crops_eight')?.value===8);
    sim.step(s,1);check('completed crop goal is saved',restore(s).progress.goals.crops_eight);
    // A ripe new crop may overflow to ground, but no harvest quantity disappears.
    const kind='flax',d=CROPS[kind],site=plots[2];go(s,'surface',site.x,site.y);advance(s,d.stages*d.stageTime+2);clearBag(s);grant(s,'stone',99*30);
    const crop=cropAt(s,'surface',site.x,site.y),prior=Object.fromEntries(d.harvest.map(h=>[h.item,s.groundItems.filter(g=>g.item===h.item).reduce((n,g)=>n+g.n,0)]));
    must(sim.harvest(s,crop),'full bag crop harvest');
    check('full-bag crop harvest conserves every produce/seed on ground',d.harvest.every(h=>s.groundItems.filter(g=>g.item===h.item).reduce((n,g)=>n+g.n,0)-prior[h.item]===h.n)&&!cropAt(s,'surface',site.x,site.y));
  });

  await section('light/save/nodes',()=>{
    const s=fresh();grant(s,'wood',1);grant(s,'resin',2);grant(s,'fiber',2);grant(s,'stone',1);
    check('old-save accessible surface resources craft lantern',sim.craft(s,'lantern').ok&&s.player.equip.trinket==='lantern'&&sim.getPlayerLight(s).radius===4);
    must(sim.unequip(s,'trinket'),'unequip');check('owned unequipped lantern gives no surface light',sim.getPlayerLight(s).radius===0);
    const spawn=s.world.underground.landmarks.spawn;go(s,'underground',spawn.x,spawn.y);check('unlit underground rescue radius is 1.5',sim.getPlayerLight(s).radius===1.5);
    must(sim.equipFromBag(s,s.player.bag.findIndex(v=>v?.id==='lantern')),'equip lantern');check('equipped lantern radius 4 in cave',sim.getPlayerLight(s).radius===4);
    grant(s,'crystal_lantern');must(sim.equipFromBag(s,s.player.bag.findIndex(v=>v?.id==='crystal_lantern')),'equip crystal');check('crystal radius 6 survives save/load',sim.getPlayerLight(restore(s)).radius===6);
    sim.step(s,1);check('two owned lights complete and persist their goal',sim.getLifeGoals(s).find(g=>g.id==='lanterns_two')?.done&&restore(s).progress.goals.lanterns_two);
    const raw=sim.serialize(s);delete raw.progress.requests;delete raw.progress.journal;delete raw.progress.fishing;
    const old=sim.createState(createWorld(),raw);
    check('v1 missing-content progress defaults empty without inventory backfill',Object.keys(old.progress.requests).length===0&&Object.values(old.progress.journal).every(part=>Object.keys(part).length===0)&&old.progress.fishing.casts===0);
    eq('v1 existing inventory/equipment/structures preserved', {bag:old.player.bag,equip:old.player.equip,structures:old.structures}, {bag:s.player.bag,equip:s.player.equip,structures:s.structures});
    const signature=w=>Object.values(w.maps).flatMap(m=>m.nodes.map(n=>[n.key,n.type,n.tx,n.ty]));
    const w=createWorld();sim.createState(w);const first=signature(w);sim.createState(w);eq('shared-world state initialization adds no duplicated/moved nodes',signature(w),first);
    const herb=old.world.surface.nodes.find(n=>n.type==='herb');go(old,'surface',herb.tx,herb.ty);sim.interact(old,{kind:'node',ref:herb});advance(old,.5);
    check('actual new-node harvest records forage',!sim.nodeAlive(old,herb)&&old.progress.journal.forage.herb>=2);
    const reloaded=restore(old),again=reloaded.world.surface.nodes.find(n=>n.key===herb.key);
    eq('new-node depletion/regen survives roundtrip',reloaded.nodes.get(herb.key)?.respawnAt,old.nodes.get(herb.key)?.respawnAt);
    check('new node remains depleted after reload',again&&!sim.nodeAlive(reloaded,again));
    const before=json(old.progress.journal);check('unknown journal IDs ignored safely',sim.recordSeen(old,'fish','__proto__',3)===false&&json(old.progress.journal)===before);
    const house=createReviewFixture('house').state;
    eq('content supplementation does not overlap existing buildings/farms on reload',restore(house).world.surface.nodes.filter(n=>SPAWN_RULES.some(r=>r.node===n.type)&&(objectAt(house,'surface',n.tx,n.ty)||floorAt(house,'surface',n.tx,n.ty)||farmAt(house,'surface',n.tx,n.ty))).map(n=>n.key),[]);
    for(let i=0;i<10;i++)install(house,'rug');sim.step(house,1);
    check('ten real decor placements complete and persist their goal',sim.getLifeGoals(house).find(g=>g.id==='decor_ten')?.done&&restore(house).progress.goals.decor_ten);
    const node=house.world.surface.nodes.find(n=>n.type==='herb');go(house,'surface',node.tx,node.ty);
    sim.interact(house,{kind:'node',ref:node});advance(house,.5);must(sim.till(house,node.tx,node.ty),'farm over depleted content node');
    const expiry=house.nodes.get(node.key)?.respawnAt,withFarm=restore(house);
    check('farm suppresses only the occupied new node and preserves its pending saved expiry',!withFarm.world.surface.nodes.some(n=>n.key===node.key)&&withFarm.pendingNodeSave[node.key]?.respawnAt===expiry);
    go(withFarm,'surface',node.tx,node.ty);must(sim.remove(withFarm,node.tx,node.ty),'remove suppressing farm');const returned=restore(withFarm);
    check('removing that farm restores the same node key/depletion without duplicate resources',returned.world.surface.nodes.filter(n=>n.key===node.key).length===1&&returned.nodes.get(node.key)?.respawnAt===expiry&&!sim.nodeAlive(returned,returned.world.surface.nodes.find(n=>n.key===node.key)));
  });
  return {passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks};
}
