// 実入力モデルの戦闘対象選択。敵 HP・無敵・攻撃結果を直接変更しない。
import * as sim from '../simulation.js';
import { createWorld, isWalkable, isBuildTerrain, nodeAt } from '../world.js';
import { makeEnemy, playerDeath } from '../combat.js';
import { BALANCE, TILE } from '../data.js';
import { createReviewFixture } from './gameplay.js';
import { cropRipe } from '../settlement.js';

export function runContentInteractionAudit() {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  const s = sim.createState(createWorld()), m = s.world.surface, camp = m.landmarks.camp;
  let site = null;
  for (let y = 4; y < m.h - 4 && !site; y++) for (let x = 4; x < m.w - 4 && !site; x++) {
    const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
    if (!isWalkable(m,x,y) || Math.hypot(x-camp.x,y-camp.y)<18) continue;
    if (m.nodes.some(n=>Math.hypot(n.px-px,n.py-py)<80)) continue;
    site={x,y};
  }
  if (!site || !sim.teleport(s,'surface',site.x,site.y)) throw Error('No clear combat test site');
  sim.addItem(s,'stone',BALANCE.items.stack*BALANCE.items.bagSlots);
  const enemy=makeEnemy(s,'slime','surface',s.player.x+20,s.player.y);
  s.enemies.push(enemy);
  sim.spawnGround(s,'surface',s.player.x+12,s.player.y-2,'wood',1);
  const hp=enemy.hp;
  for(let i=0;i<20;i++)sim.step(s,.01,{actPressed:i===0,act:true});
  check('満杯で拾えないドロップが E 攻撃を遮らない',enemy.hp<hp,
    {beforeHp:hp,afterHp:enemy.hp,focus:s.focus?.kind,action:s.player.action?.type||null,ground:s.groundItems.length});

  const q=sim.createState(createWorld()),grass=q.world.surface.nodes.find(n=>n.type==='grass'
    &&Math.hypot(n.tx-camp.x,n.ty-camp.y)>18&&sim.teleport(q,'surface',n.tx-1,n.ty));
  if(!grass)throw Error('No reachable grass test site');
  const foe=makeEnemy(q,'slime','surface',grass.px,grass.py);
  q.enemies.push(foe);
  sim.step(q,.01,{aim:{x:foe.x,y:foe.y-8},aimActive:true,actPressed:true,act:true});
  check('敵に重なる草を照準した場合も戦闘対象を選べる',q.player.action?.type==='swing',
    {focus:q.focus?.kind,action:q.player.action?.type,enemyHp:foe.hp});

  const peaceful=sim.createState(createWorld());
  const plant=peaceful.world.surface.nodes.find(n=>n.type==='grass'
    &&sim.teleport(peaceful,'surface',n.tx-1,n.ty));
  sim.step(peaceful,.01,{aim:{x:plant.px,y:plant.py-8},aimActive:true,actPressed:true,act:true});
  check('敵のいない通常の草刈りを維持する',peaceful.player.action?.type==='gather',
    {focus:peaceful.focus?.kind,action:peaceful.player.action?.type});
  return {passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks};
}

export function runDeathQuantityAudit() {
  const s=sim.createState(createWorld());
  const full= BALANCE.items.stack*BALANCE.items.bagSlots;
  sim.addItem(s,'stone',full);
  playerDeath(s);
  const first=s.deathBag.items.reduce((n,x)=>n+(x.id==='stone'?x.n:0),0);
  sim.addItem(s,'stone',full);
  const before=first+sim.countItem(s,'stone');
  playerDeath(s);
  const second=s.deathBag.items.reduce((n,x)=>n+(x.id==='stone'?x.n:0),0);
  const loaded=sim.createState(createWorld(),sim.serialize(s));
  const restored=loaded.deathBag.items.reduce((n,x)=>n+(x.id==='stone'?x.n:0),0);
  const checks=[
    {name:'二度死亡の資源袋統合で素材総量を失わない',ok:second===before,detail:{first,before,second}},
    {name:'大きい資源袋の保存・復元で素材総量を失わない',ok:restored===before,detail:{before,second,restored}},
  ];
  sim.addItem(loaded,'berry',BALANCE.items.stack*(BALANCE.items.bagSlots-1));
  const recovered=sim.collectDeathBag(loaded);
  const remaining=loaded.deathBag.items.reduce((n,x)=>n+(x.id==='stone'?x.n:0),0);
  const carried=sim.countItem(loaded,'stone');
  checks.push({name:'大きい資源袋の部分回収で残量と総量を保持する',
    ok:recovered===BALANCE.items.stack&&remaining+carried===before,
    detail:{recovered,remaining,carried,total:remaining+carried}});
  playerDeath(loaded);
  const afterAgain=loaded.deathBag.items.reduce((n,x)=>n+(x.id==='stone'?x.n:0),0);
  const final=sim.createState(createWorld(),sim.serialize(loaded));
  const finalAmount=final.deathBag.items.reduce((n,x)=>n+(x.id==='stone'?x.n:0),0);
  checks.push({name:'部分回収後の再死亡と再保存で素材を複製も消失もしない',
    ok:afterAgain===before&&finalAmount===before,detail:{before,afterAgain,finalAmount}});
  return {passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks};
}

export function runConstructionCapacityAudit() {
  const s=sim.createState(createWorld()),m=s.world.surface,limit=BALANCE.save.maxStructures;
  let extra=null;
  for(let y=1;y<m.h-1&&!extra;y++)for(let x=1;x<m.w-1&&!extra;x++){
    if(m.protect[y*m.w+x]||!isBuildTerrain(m,x,y)||nodeAt(m,x,y)||sim.floorAt(s,'surface',x,y))continue;
    if(!sim.teleport(s,'surface',x,y))continue;
    if(!sim.countItem(s,'path_stone'))sim.addItem(s,'path_stone',1);
    if(s.structures.length>=limit){extra={x,y};break;}
    if(sim.canBuild(s,'path_stone',x,y).ok)sim.place(s,'path_stone',x,y);
  }
  if(!extra||s.structures.length!==limit)throw Error('Could not reach construction capacity through place API');
  const atLimit=sim.validateSave(sim.serialize(s));
  const before=sim.countItem(s,'path_stone'),result=sim.place(s,'path_stone',extra.x,extra.y);
  const checks=[{name:'構造物上限ちょうどで通常保存が成立する',ok:atLimit.ok,
    detail:{structures:limit,errors:atLimit.errors}},
    {name:'保存上限の構造物を超える建築を材料無消費で拒否する',
    ok:!result.ok&&s.structures.length===limit&&sim.countItem(s,'path_stone')===before,
    detail:{limit,structures:s.structures.length,before,after:sim.countItem(s,'path_stone'),result}}];
  const old=s.structures.find(v=>v.type==='path_stone');
  sim.teleport(s,'surface',old.x,old.y);
  const removed=sim.remove(s,old.x,old.y);
  sim.teleport(s,'surface',extra.x,extra.y);
  const replacement=sim.place(s,'path_stone',extra.x,extra.y);
  const validation=sim.validateSave(sim.serialize(s));
  checks.push({name:'取り壊しで空きを作ると建築と保存を再開できる',
    ok:removed.ok&&replacement.ok&&s.structures.length===limit&&validation.ok,
    detail:{removed:removed.ok,replacement:replacement.ok,structures:s.structures.length,errors:validation.errors}});
  const loaded=sim.createState(createWorld(),sim.serialize(s));
  const signature=st=>st.structures.map(x=>`${x.type}:${x.map}:${x.x},${x.y}`).sort().join('|');
  checks.push({name:'上限での建築再開後も全構造物を保存・復元できる',
    ok:signature(loaded)===signature(s),detail:{original:s.structures.length,restored:loaded.structures.length}});
  return {passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks};
}

export function runFarmerCapacityAudit() {
  const {state:s}=createReviewFixture('house');
  const goFarmer=()=>{const n=s.npcs.find(n=>n.id==='farmer');sim.teleport(s,'surface',Math.floor(n.x/TILE),Math.floor(n.y/TILE));};
  goFarmer();sim.collectResident(s,'farmer');
  const crop=s.crops.find(c=>c.kind==='moss_potato');
  for(const c of [...s.crops])if(c!==crop){sim.teleport(s,'surface',c.x,c.y);sim.remove(s,c.x,c.y);}
  goFarmer();
  let elapsed=0;
  for(;elapsed<5000&&(s.progress.npcs.farmer.basket.moss_potato||0)<40;elapsed++)sim.step(s,1);
  if(s.progress.npcs.farmer.basket.moss_potato!==40)throw Error('Farmer did not fill basket through normal crop production');
  for(const slot of [...s.player.bag])if(slot)sim.removeItem(s,slot.id,slot.n);
  sim.addItem(s,'stone',BALANCE.items.stack*(BALANCE.items.bagSlots-1));
  sim.addItem(s,'moss_potato',BALANCE.items.stack-1);
  goFarmer();sim.collectResident(s,'farmer');
  const total=()=>sim.countItem(s,'moss_potato')+(s.progress.npcs.farmer.basket.moss_potato||0)
    +s.groundItems.filter(g=>g.item==='moss_potato').reduce((n,g)=>n+g.n,0);
  const before=total();let harvested=false,previous=crop.growth;
  for(let i=0;i<500;i++){
    sim.step(s,1);
    if(crop.growth<previous){harvested=true;break;}
    previous=crop.growth;
  }
  // 空き不足なら成熟畑を保留してよい。収穫したなら再植付1個を除く純増2個を全数保持する。
  const ok=harvested?total()===before+2:cropRipe(crop)&&total()===before;
  const checks=[{name:'農夫の籠残り1枠で収穫物を切り捨てない',ok,
    detail:{setupSimSeconds:elapsed,harvested,before,after:total(),basket:s.progress.npcs.farmer.basket,cropGrowth:crop.growth}}];
  return {passed:ok?1:0,failed:ok?0:1,checks};
}
