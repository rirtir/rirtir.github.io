// 畑の取り壊しと切り株への苗植え。実操作・保存・アイテム総量を検証する。
import * as sim from '../simulation.js';
import { createWorld } from '../world.js';
import { CROPS, NODES } from '../data.js';
import { createReviewFixture } from './gameplay.js';

export function runSustainabilityTests() {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name: `再生・農業: ${name}`, ok: !!ok, detail });
  const total = (s, id) => sim.countItem(s,id) + s.groundItems.filter(g=>g.item===id).reduce((n,g)=>n+g.n,0);
  const {state: farm} = createReviewFixture('house');
  for (const kind of ['moss_potato', 'wheat']) {
    const c=farm.crops.find(c=>c.kind===kind && c.growth>=CROPS[kind].stages*CROPS[kind].stageTime);
    sim.teleport(farm,'surface',c.x,c.y);
    const before=Object.fromEntries(CROPS[kind].harvest.map(d=>[d.item,total(farm,d.item)]));
    check(`${kind} 成熟畑を取り壊せる`,sim.remove(farm,c.x,c.y).ok);
    for (const d of CROPS[kind].harvest) check(`${kind} 成熟収穫物 ${d.item} を全数返す`,total(farm,d.item)===before[d.item]+d.n);
    check(`${kind} 取り壊し後は畑も作物もない`,!farm.crops.includes(c)&&!farm.farmland.some(f=>f.x===c.x&&f.y===c.y));
  }
  const young=farm.crops.find(c=>c.growth>=CROPS[c.kind].stages*CROPS[c.kind].stageTime);
  sim.teleport(farm,'surface',young.x,young.y);
  sim.harvest(farm,young);
  const seed=CROPS[young.kind].seed;
  const before=total(farm,seed);
  check('未熟畑は取り壊して種を1個返す',sim.remove(farm,young.x,young.y).ok&&total(farm,seed)===before+1);
  const full=farm.crops.find(c=>c.growth>=CROPS[c.kind].stages*CROPS[c.kind].stageTime);
  sim.teleport(farm,'surface',full.x,full.y);
  sim.addItem(farm,'stone',99999);
  const fullBefore=Object.fromEntries(CROPS[full.kind].harvest.map(d=>[d.item,total(farm,d.item)]));
  sim.remove(farm,full.x,full.y);
  for(const d of CROPS[full.kind].harvest)check(`満杯時の ${d.item} は地面も含め全数返す`,total(farm,d.item)===fullBefore[d.item]+d.n);

  const world=createWorld(),s=sim.createState(world);
  s.timers.spawn=-1e9;
  const tree=world.surface.nodes.find(n=>n.type==='tree');
  sim.teleport(s,'surface',tree.tx,tree.ty);
  for(const [id,n]of [['branch',3],['stone',2],['fiber',2]])sim.addItem(s,id,n);
  check('植樹用の斧を実際に制作',sim.craft(s,'axe_stone').ok);
  sim.addItem(s,'sapling',2);
  let count=sim.countItem(s,'sapling');
  check('生きた木は苗を消費せず拒否',!sim.replantTree(s,tree).ok&&sim.countItem(s,'sapling')===count);
  for(let i=0;i<3;i++)sim.interact(s,{kind:'node',ref:tree});
  check('実際の3打で切り株になる',!sim.nodeAlive(s,tree));
  sim.teleport(s,'surface',tree.tx+6,tree.ty);
  count=sim.countItem(s,'sapling');
  check('遠い切り株は無消費で拒否',!sim.replantTree(s,tree).ok&&sim.countItem(s,'sapling')===count);
  sim.teleport(s,'surface',tree.tx,tree.ty);
  sim.removeItem(s,'sapling',sim.countItem(s,'sapling'));
  check('苗なしでは再植樹を拒否',!sim.replantTree(s,tree).ok);
  sim.addItem(s,'sapling',2);
  sim.addItem(s,'floor_wood',1);
  check('切り株の上に床を設置できる',sim.place(s,'floor_wood',tree.tx,tree.ty).ok);
  count=sim.countItem(s,'sapling');
  check('設備のある切り株は無消費で拒否',!sim.replantTree(s,tree).ok&&sim.countItem(s,'sapling')===count);
  sim.remove(s,tree.tx,tree.ty);
  s.hitStop=0;
  for(let i=0;i<30;i++)sim.step(s,.1);
  sim.step(s,.01,{aimActive:true,aim:{x:tree.px,y:tree.py-8}});
  check('切り株の自然なフォーカス名・動詞',s.focus?.kind==='stump'&&s.focus.name==='切り株'&&s.focus.verb==='苗を植える',JSON.stringify({focus:s.focus?.kind,reason:s.focus?.reason}));
  const remaining=s.nodes.get(tree.key).respawnAt-s.time.clock;
  check('通常の再生は苗植えより遅い',remaining>NODES.tree.saplingGrow);
  count=sim.countItem(s,'sapling');
  sim.step(s,.01,{aimActive:true,aim:{x:tree.px,y:tree.py-8},actPressed:true,act:true});
  check('実入力で苗を1個だけ消費',sim.countItem(s,'sapling')===count-1);
  const at=s.nodes.get(tree.key).respawnAt;
  check('苗の成長は60秒',Math.abs(at-s.time.clock-60)<.001);
  count=sim.countItem(s,'sapling');
  check('連続植樹は無消費で拒否',!sim.replantTree(s,tree).ok&&sim.countItem(s,'sapling')===count&&s.nodes.get(tree.key).respawnAt===at);
  const save=sim.serialize(s),loaded=sim.createState(createWorld(),save),n=loaded.world.surface.nodes.find(n=>n.key===tree.key);
  check('保存後も切り株・苗の個数・成長時刻を保持',!sim.nodeAlive(loaded,n)&&sim.countItem(loaded,'sapling')===count&&loaded.nodes.get(n.key).respawnAt===at);
  loaded.timers.spawn=-1e9;
  sim.teleport(loaded,'surface',world.surface.landmarks.camp.x,world.surface.landmarks.camp.y+2);
  for(let i=0;i<61;i++)sim.step(loaded,1);
  check('離れて60秒待つと同じ木が再生',sim.nodeAlive(loaded,n));
  check('再生によるノード複製・苗増殖はない',loaded.world.surface.nodes.length===world.surface.nodes.length&&sim.countItem(loaded,'sapling')===count);
  return {passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks};
}
