// MOSSLIGHT gameplay tests (static browser ES module, no Node dependency).
//   import { runGameTests } from './gameplay.js';  const r = await runGameTests();  // {passed, failed, checks:[{name,ok,detail}]}
// Each scenario builds its own fresh createWorld()/createState() fixtures. Game actions go through public simulation functions;
// fixtures only use grants (addItem), teleport, setClock and a quiet() isolation of random enemy spawns.
import { BALANCE, TILE, ITEMS, NODES, STRUCTURES, BOSSES, WALL, TERRAIN, RECIPES, validateData } from '../data.js';
import { createWorld, isBuildTerrain, nodeAt, getTile, isWalkable } from '../world.js';
import * as sim from '../simulation.js';
import { playerDeath, bossEntity, makeEnemy } from '../combat.js';
import { isTillableTile, cropRipe } from '../settlement.js';
import { cropAt, farmAt } from '../layers.js';
import { SAVE_VERSION, SAVE_FORMAT } from '../save.js';

/* ================================================================== infrastructure */
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const errText = (e) => (e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : String(e));
const cpx = (t) => t * TILE + TILE / 2;
const tileOf = (v) => Math.floor(v / TILE);
const J = (v) => JSON.stringify(v);

function makeT(prefix, checks) {
  const add = (label, ok, detail) => checks.push({ name: `${prefix}: ${label}`, ok: !!ok, detail: ok ? '' : String(detail === undefined ? '' : detail) });
  return {
    ok: (c, label, detail) => add(label, c, detail),
    eq(actual, expected, label) { const a = J(actual), b = J(expected); add(label, a === b, `expected ${b}, got ${a}`); },
    approx(actual, expected, tol, label) { add(label, Math.abs(actual - expected) <= tol, `expected ${expected}±${tol}, got ${actual}`); },
    async section(label, fn) {
      const sub = makeT(`${prefix} / ${label}`, checks);
      try { await fn(sub); } catch (e) { checks.push({ name: `${prefix} / ${label}: threw`, ok: false, detail: errText(e) }); }
    },
  };
}

function must(r, label) {
  if (!r || r.ok === false) throw new Error(`${label} failed: ${J(r)}`);
  return r;
}

/* ================================================================== fixtures & helpers */
function fresh() { const world = createWorld(); return { world, state: sim.createState(world) }; }
function drain(state) { return state.events.splice(0, state.events.length); }
function invMap(state) { const m = {}; for (const s of state.player.bag) if (s) m[s.id] = (m[s.id] || 0) + s.n; return m; }
function snap(state) { const p = state.player; return J({ bag: p.bag, tools: p.tools, equip: p.equip, hot: p.hotbar }); }
function grant(state, id, n) {
  const left = sim.addItem(state, id, n, { silent: true });
  if (left > 0) throw new Error(`fixture grant of ${n} ${id} left ${left}`);
}
function groundSum(state, item) { return state.groundItems.reduce((a, g) => a + (g.item === item ? g.n : 0), 0); }
function quiet(state) { state.timers.spawn = -1e9; state.enemies = state.enemies.filter((e) => e.boss); }
function go(state, mapId, tx, ty) {
  if (!sim.teleport(state, mapId, tx, ty)) throw new Error(`teleport to ${mapId} ${tx},${ty} failed`);
  quiet(state);
}

// o: {input: obj|fn(i), dt, events: array to collect, until: fn(i)->bool}. Events are drained every step (queue is capped at 400).
function run(state, seconds, o = {}) {
  const dt = o.dt || 1 / 60;
  const n = Math.max(1, Math.round(seconds / dt));
  let i = 0;
  for (; i < n; i++) {
    sim.step(state, dt, typeof o.input === 'function' ? o.input(i) : o.input);
    if (o.events) o.events.push(...state.events);
    state.events.length = 0;
    if (o.until && o.until(i)) { i++; break; }
  }
  return i;
}
function runUntil(state, pred, seconds, o = {}) {
  let hit = -1;
  run(state, seconds, { ...o, until: (i) => { if (pred(i)) { hit = i + 1; return true; } return false; } });
  return hit;
}
const tick = (state, s) => run(state, s, { dt: 0.1 });

function nearestNodes(state, type, count, maxR = 22) {
  const map = state.world.surface, camp = map.landmarks.camp;
  const list = map.nodes.filter((n) => n.type === type && !n.unreachable && sim.nodeAlive(state, n) && Math.hypot(n.tx - camp.x, n.ty - camp.y) <= maxR)
    .sort((a, b) => Math.hypot(a.tx - camp.x, a.ty - camp.y) - Math.hypot(b.tx - camp.x, b.ty - camp.y));
  if (list.length < count) throw new Error(`need ${count} '${type}' nodes near camp, found ${list.length}`);
  return list.slice(0, count);
}
function pickIsolated(state, type, count) {
  const map = state.world.surface, camp = map.landmarks.camp;
  const iso = (n) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && nodeAt(map, n.tx + dx, n.ty + dy)) return false; return true; };
  const list = map.nodes.filter((n) => n.type === type && !n.unreachable && sim.nodeAlive(state, n) && Math.hypot(n.tx - camp.x, n.ty - camp.y) <= 14)
    .map((n) => ({ n, iso: iso(n), d: Math.hypot(n.tx - camp.x, n.ty - camp.y) }))
    .sort((a, b) => (b.iso - a.iso) || (a.d - b.d));
  if (list.length < count) throw new Error(`need ${count} '${type}' nodes within 14 tiles of camp, found ${list.length}`);
  return list.slice(0, count).map((x) => x.n);
}

// Real step input: aim the mouse at a node and hold the action button.
function gatherByInput(state, nd) {
  go(state, 'surface', nd.tx, nd.ty);
  const base = { aim: { x: nd.px, y: nd.py - 6 }, aimActive: true, act: true };
  let focus = null;
  const steps = run(state, 3, {
    input: (i) => ({ ...base, actPressed: i === 0 }),
    until: () => { if (!focus && state.focus) focus = { kind: state.focus.kind, ok: state.focus.ok, reason: state.focus.reason }; return !sim.nodeAlive(state, nd); },
  });
  return { steps, focus };
}

function placeNearby(state, type, minDist = 40, maxDist = 90) {
  const p = state.player, tx = tileOf(p.x), ty = tileOf(p.y), c = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const d = Math.hypot(cpx(tx + dx) - p.x, cpx(ty + dy) - p.y);
    if (d >= minDist && d <= maxDist) c.push([tx + dx, ty + dy, d]);
  }
  c.sort((a, b) => a[2] - b[2]);
  for (const [x, y] of c) {
    if (sim.canBuild(state, type, x, y).ok) { must(sim.place(state, type, x, y), `place ${type}`); return { x, y }; }
  }
  throw new Error(`no free tile near the player for ${type}`);
}
function ensureStation(state, station, item) {
  if (sim.nearbyStations(state).has(station)) return;
  grant(state, item, 1);
  placeNearby(state, item);
}
function setupHoe(state) {
  grant(state, 'wood', 6); grant(state, 'stone', 4);
  must(sim.craft(state, 'workbench'), 'craft workbench');
  placeNearby(state, 'workbench');
  grant(state, 'branch', 2); grant(state, 'stone', 2); grant(state, 'fiber', 2);
  must(sim.craft(state, 'hoe_stone'), 'craft hoe');
}
function equip(state, id) {
  if (!sim.countItem(state, id)) grant(state, id, 1);
  const slot = state.player.bag.findIndex((s) => s && s.id === id);
  must(sim.equipFromBag(state, slot), `equip ${id}`);
}

/* ---- building sites ---- */
const bareNode = (nd) => { const d = NODES[nd.type]; return !!d && !d.tool && !d.decor && !d.landmark && !d.solid && d.hp === 1; };
const overlaps = (r, x0, y0, w, h, gap) => x0 < r.x0 + r.w + gap && x0 + w > r.x0 - gap && y0 < r.y0 + r.h + gap && y0 + h > r.y0 - gap;
const inAny = (rects, x, y, gap = 1) => (rects || []).some((r) => overlaps(r, x, y, 1, 1, gap));

function siteClear(state, x0, y0, w, h, used, margin, tillable) {
  const map = state.world.surface;
  if (!sim.inSafeZone(state, (x0 + w / 2) * TILE, (y0 + h / 2) * TILE, -margin)) return false;
  for (const u of used) if (overlaps(u, x0, y0, w, h, 1)) return false;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (!isBuildTerrain(map, x, y)) return false;
    if (tillable && !isTillableTile(map, x, y)) return false;
    if (sim.structureAt(state, 'surface', x, y) || farmAt(state, 'surface', x, y)) return false;
    const nd = nodeAt(map, x, y);
    if (nd && !bareNode(nd)) return false;
  }
  return true;
}
function findSite(state, w, h, o = {}) {
  const camp = state.world.surface.landmarks.camp, used = o.used || [], margin = o.margin ?? 2, maxR = o.maxR || 15;
  const offs = [];
  for (let dy = -maxR; dy <= maxR; dy++) for (let dx = -maxR; dx <= maxR; dx++) offs.push([dx, dy]);
  offs.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
  for (const [dx, dy] of offs) {
    const x0 = camp.x + dx - Math.floor(w / 2), y0 = camp.y + dy - Math.floor(h / 2);
    if (siteClear(state, x0, y0, w, h, used, margin, o.tillable)) return { x0, y0, w, h };
  }
  return null;
}
function needSite(state, w, h, o) {
  const s = findSite(state, w, h, o);
  if (!s) throw new Error(`no clear ${w}x${h} site inside the safe zone`);
  return s;
}
// Bare-hand gatherable plants may be cleared legitimately through interact().
function prepareSite(state, site) {
  const map = state.world.surface;
  for (let y = site.y0; y < site.y0 + site.h; y++) for (let x = site.x0; x < site.x0 + site.w; x++) {
    const nd = nodeAt(map, x, y);
    if (nd && bareNode(nd) && sim.nodeAlive(state, nd)) sim.interact(state, { kind: 'node', ref: nd });
  }
}

// Ring of walls (ring = interior + 1) with door at the bottom middle; bed/light in the first interior row.
function buildHouse(state, site, o = {}) {
  const iw = o.iw || 3, ih = o.ih || 3, x0 = site.x0, y0 = site.y0;
  const key = (x, y) => `${x},${y}`;
  const interior = [], ring = [];
  for (let dy = 0; dy < ih + 2; dy++) for (let dx = 0; dx < iw + 2; dx++) {
    ((dx === 0 || dy === 0 || dx === iw + 1 || dy === ih + 1) ? ring : interior).push([x0 + dx, y0 + dy]);
  }
  const door = [x0 + 1 + Math.floor(iw / 2), y0 + ih + 1];
  const stand = [x0 + 1, y0 + 1], bed = [x0 + 2, y0 + 1], light = [x0 + 1, y0 + 2];
  const rel = (arr) => new Set((arr || []).map(([dx, dy]) => key(x0 + dx, y0 + dy)));
  const skip = rel(o.skipRel), fence = rel(o.fenceRel), noFloor = rel(o.noFloorRel);
  const plan = [];
  for (const [x, y] of interior) if (!noFloor.has(key(x, y))) plan.push(['floor_wood', x, y]);
  if (!o.noBed) plan.push(['bed', bed[0], bed[1]]);
  if (!o.noLight) plan.push([o.lightType || 'candlestick', light[0], light[1]]);
  for (const [x, y] of ring) {
    const k = key(x, y);
    if (k === key(door[0], door[1])) plan.push([o.noDoor ? 'wall_wood' : 'door_wood', x, y]);
    else if (fence.has(k)) plan.push(['fence_wood', x, y]);
    else if (!skip.has(k)) plan.push(['wall_wood', x, y]);
  }
  prepareSite(state, site);
  go(state, 'surface', stand[0], stand[1]);
  const need = {};
  for (const [type] of plan) need[type] = (need[type] || 0) + 1;
  for (const [type, n] of Object.entries(need)) grant(state, STRUCTURES[type].item, n);
  for (const [type, x, y] of plan) must(sim.place(state, type, x, y), `place ${type} at ${x},${y}`);
  return { site, interior, ring, door, stand, bed, light, x0, y0 };
}
function newHouse(state, used, o = {}) {
  const site = needSite(state, (o.iw || 3) + 2, (o.ih || 3) + 2, { used, margin: o.margin ?? 2, maxR: o.maxR });
  used.push(site);
  const h = buildHouse(state, site, o);
  tick(state, 0.2);
  return h;
}

function offerForge(state) {
  const a = state.world.surface.landmarks.forgeAltar;
  grant(state, 'copper_bar', 4); grant(state, 'moss_oil', 2); grant(state, 'forest_stew', 1);
  go(state, 'surface', a.x, a.y + 2);
  return must(sim.restoreLight(state, 'forge'), 'restore forge light');
}
function establishForge(state, used) {
  const h = newHouse(state, used);
  if (sim.getHouseStatus(state).valid < 1) throw new Error('fixture house is not valid');
  offerForge(state);
  return h;
}
function summonVine(state) {
  const a = state.world.underground.landmarks.mossAltar;
  go(state, 'underground', a.x - 1, a.y + 1);
  grant(state, 'crystal_moss', 3);
  must(sim.restoreLight(state, 'moss'), 'place 3 crystals');
  const boss = bossEntity(state, 'vine');
  if (!boss) throw new Error('vine boss did not appear after 3 crystals');
  quiet(state);
  return boss;
}
function killBoss(state, boss, dmg) {
  let n = 0;
  while (boss.hp > 0 && n < 200) { sim.damageEnemy(state, boss, dmg, 0, 0); n++; }
  return n;
}
function collectBossLoot(state, items) {
  run(state, .8);
  for (const drop of [...state.groundItems]) {
    if (!items.includes(drop.item)) continue;
    go(state, drop.map, tileOf(drop.x), tileOf(drop.y));
    run(state, 1);
  }
}
const swordDmg = (state) => ITEMS[state.player.equip.weapon].weapon.dmg;

// 見た目のレビューも同じ実ルールの設置・進行を使い、検証画面を再現する。
export function createReviewFixture(scene = 'house') {
  const {world, state} = fresh();
  quiet(state);
  ensureStation(state,'workbench','workbench');
  for (const id of ['axe_iron','pick_iron','hoe_stone']) {
    const recipe=RECIPES.find(r=>r.out===id);
    for (const [material,count] of Object.entries(recipe.inputs)) grant(state,material,count);
    must(sim.craft(state,id),'review tool');
  }
  equip(state, 'sword_iron'); equip(state, 'armor_iron');
  const used = [];
  const home = establishForge(state, used);
  if (scene === 'vine' || scene === 'ash') {
    const vine = summonVine(state);
    if (scene === 'ash') {
      killBoss(state, vine, swordDmg(state));
      collectBossLoot(state, ['moss_wick', 'iron_ore']);
      const altar = world.underground.landmarks.mossAltar;
      go(state, 'underground', altar.x-1, altar.y+1);
      must(sim.restoreLight(state, 'moss'), 'review moss light');
      grant(state, 'moss_oil', 3);
      for (const dish of world.underground.nodes.filter(n=>n.type==='dish')) {
        go(state, 'underground', dish.tx, dish.ty);
        sim.interact(state, {kind:'node',ref:dish});
      }
      go(state, 'underground', 80, 78);
    } else go(state, 'underground', 24, 68);
    run(state, .2);
  } else {
    newHouse(state, used); newHouse(state, used);
    grant(state, 'wheat_seed', 12); grant(state, 'moss_potato', 12);
    const plot=needSite(state,6,2,{used,margin:1,tillable:true,maxR:18});
    prepareSite(state,plot);
    for (let i=0;i<12;i++) {
      const x=plot.x0+i%6, y=plot.y0+Math.floor(i/6);
      go(state,'surface',x,y);
      must(sim.till(state,x,y),'review till');
      must(sim.plant(state,i%2?'wheat':'moss_potato',x,y),'review plant');
    }
    run(state, 310, {dt:1});
    for (const [type,x,y] of [['table',home.x0+2,home.y0+2],['chair',home.x0+3,home.y0+2],['chest_wood',home.x0+3,home.y0+3]]) {
      go(state,'surface',home.stand[0],home.stand[1]);
      grant(state,type,1); must(sim.place(state,type,x,y),'review furniture');
    }
    go(state,'surface',home.door[0],home.door[1]+2);
    if (scene==='inside') go(state,'surface',home.stand[0],home.stand[1]);
    sim.setClock(state,scene==='night'?510:90);
    run(state,.1);
  }
  state.events.length=0;
  return {state,world,home};
}

function checkGoalInvariants(t, state, label) {
  const goals = sim.getLifeGoals(state);
  t.eq(goals.map((g) => g.id), ['houses', 'lanterns', 'farms', 'foods', 'residents', 'roads', 'iron', 'rematch'], `${label}: eight life goals in order`);
  t.ok(goals.every((g) => g.value >= 0 && g.value <= g.target && g.done === (g.value >= g.target)), `${label}: goal.done matches value>=target`, J(goals));
  t.eq(sim.getJournal(state).goals, goals, `${label}: journal goals equal getLifeGoals`);
  const jl = sim.getJournal(state).lights;
  t.ok(jl.every((l) => l.done === !!state.progress.lights[l.id]), `${label}: journal light flags match progress`, J(jl.map((l) => [l.id, l.done])));
}

/* ================================================================== scenarios: start, gathering, tools */
async function sBaseline(t) {
  const v = validateData();
  t.ok(v.ok, 'validateData() has no errors', v.errors.join('; '));
  t.eq(RECIPES.length, 40, 'recipe table has the 40 recipes of DESIGN 3.3');
  const { world, state } = fresh();
  t.ok(world.report && world.report.ok, 'generated world passes its reachability report', 'report.ok=' + (world.report && world.report.ok));
  t.eq([world.surface.w, world.surface.h, world.underground.w, world.underground.h], [128, 128, 96, 96], 'map sizes');
  const w2 = createWorld();
  t.ok(world.surface.terrain.every((x, i) => x === w2.surface.terrain[i]) && world.underground.terrain.every((x, i) => x === w2.underground.terrain[i]) && world.surface.nodes.length === w2.surface.nodes.length, 'same seed generates the same world');
  const u = world.underground;
  let copper = 0, iron = 0;
  for (let i = 0; i < u.wallKind.length; i++) { if (u.wallKind[i] === WALL.COPPER) copper++; if (u.wallKind[i] === WALL.IRON) iron++; }
  t.ok(copper >= 30 && iron >= 40, 'cave has at least 30 copper and 40 iron walls', `copper=${copper} iron=${iron}`);
  const p = state.player;
  t.eq([p.hp, p.satiety, p.tools, p.bag.filter(Boolean).length], [100, 100, { axe: 0, pick: 0, hoe: 0 }, 0], 'start: full HP/satiety, no tools, empty bag');
  const camp = world.surface.landmarks.camp;
  const fire = sim.structureAt(state, 'surface', camp.x, camp.y);
  t.ok(fire && fire.type === 'campfire', 'campfire stands at camp');
  const chest = state.structures.find((s) => s.type === 'chest_wood');
  t.ok(chest && state.containers[chest.id].some((s) => s && s.id === 'wheat_seed' && s.n === 3), 'starter chest holds 3 wheat seeds');
  t.eq(sim.getLifeGoals(state).map((g) => g.value), [0, 0, 0, 0, 0, 0, 0, 0], 'no life goal progress at start');
  checkGoalInvariants(t, state, 'start');
}

async function sGather(t) {
  const { state } = fresh();
  const p = state.player;
  const early = sim.craft(state, 'axe_stone');
  t.ok(!early.ok && !p.tools.axe, 'stone axe cannot be crafted from an empty bag');
  t.ok(/斧/.test(sim.getObjective(state).text), 'first objective points at the stone axe', sim.getObjective(state).text);
  const plan = [['branch', 3, { branch: 1 }], ['pebble', 2, { stone: 1 }], ['grass', 1, { fiber: 2 }]];
  for (const [type, count, gain] of plan) {
    for (const nd of pickIsolated(state, type, count)) {
      const before = invMap(state), g0 = state.progress.stats.gathered;
      const r = gatherByInput(state, nd);
      t.ok(r.focus && r.focus.kind === 'node' && r.focus.ok, `${type}: target is focused as a usable node`, J(r.focus));
      t.ok(!sim.nodeAlive(state, nd), `${type}: bare-hand input depletes the node`, `steps=${r.steps}`);
      const got = runUntil(state, () => Object.entries(gain).every(([id, n]) => sim.countItem(state, id) >= (before[id] || 0) + n), 5);
      t.ok(got >= 0, `${type}: dropped items are picked up`, J(invMap(state)));
      for (const [id, n] of Object.entries(gain)) t.eq(sim.countItem(state, id) - (before[id] || 0), n, `${type}: exactly ${n} ${id} gained`);
      t.eq(state.progress.stats.gathered, g0 + 1, `${type}: gather statistic +1`);
    }
  }
  const bag = invMap(state);
  t.ok(bag.branch === 3 && bag.stone === 2 && bag.fiber === 2, 'bag holds 3 branch / 2 stone / 2 fiber', J(bag));
  const c = sim.craft(state, 'axe_stone');
  t.ok(c.ok, 'stone axe crafts by hand from gathered materials', J(c));
  const after = invMap(state);
  t.ok(!after.branch && !after.stone && !after.fiber, 'craft consumed exactly the recipe inputs', J(after));
  t.eq(p.tools.axe, 1, 'axe tier 1 owned');
  t.ok(!p.bag.some((s) => s && s.id === 'axe_stone'), 'tools use no bag slot');
  grant(state, 'branch', 3); grant(state, 'stone', 2); grant(state, 'fiber', 2);
  const s0 = snap(state), again = sim.craft(state, 'axe_stone');
  t.ok(!again.ok && snap(state) === s0, 'crafting an owned tool is refused without consuming inputs', J(again));
  t.ok(/木材|作業台/.test(sim.getObjective(state).text), 'objective advances to wood/workbench', sim.getObjective(state).text);
}

async function sToolTiers(t) {
  const { state } = fresh();
  const p = state.player;
  const trees = nearestNodes(state, 'tree', 3), rock = nearestNodes(state, 'rock', 1)[0], cu = nearestNodes(state, 'copper_deposit', 1, 60)[0];
  const hits = (nd) => { let n = 0; while (sim.nodeAlive(state, nd) && n < 30) { if (!sim.interact(state, { kind: 'node', ref: nd })) break; n++; } return n; };
  go(state, 'surface', trees[0].tx, trees[0].ty + 1);
  drain(state);
  t.eq(sim.interact(state, { kind: 'node', ref: trees[0] }), false, 'tree: no axe -> refused');
  t.ok(drain(state).some((e) => e.type === 'msg' && e.tone === 'warn' && /斧/.test(e.text)), 'tree: warns that an axe is needed');
  t.ok(sim.nodeAlive(state, trees[0]) && !state.nodes.has(trees[0].key), 'tree: refused swing does no damage');
  grant(state, 'branch', 3); grant(state, 'stone', 2); grant(state, 'fiber', 2);
  must(sim.craft(state, 'axe_stone'), 'axe');
  t.eq(hits(trees[0]), 3, 'stone axe fells a tree in 3 hits');
  t.eq([groundSum(state, 'wood'), groundSum(state, 'resin')], [4, 1], 'tree drops 4 wood and 1 resin');
  t.ok(runUntil(state, () => sim.countItem(state, 'wood') >= 4 && sim.countItem(state, 'resin') >= 1, 5) >= 0, 'tree drops are collected');

  go(state, 'surface', rock.tx, rock.ty + 1);
  drain(state);
  t.eq(sim.interact(state, { kind: 'node', ref: rock }), false, 'rock: no pickaxe -> refused');
  t.ok(drain(state).some((e) => e.type === 'msg' && /ツルハシ/.test(e.text)), 'rock: warns that a pickaxe is needed');
  grant(state, 'branch', 3); grant(state, 'stone', 3); grant(state, 'fiber', 2);
  must(sim.craft(state, 'pick_stone'), 'pick');
  const s0 = groundSum(state, 'stone');
  t.eq(hits(rock), 4, 'stone pickaxe breaks a rock in 4 hits');
  t.eq(groundSum(state, 'stone') - s0, 5, 'rock drops 5 stone');
  go(state, 'surface', cu.tx, cu.ty + 1);
  t.eq(hits(cu), 5, 'stone pickaxe mines a copper deposit in 5 hits');
  t.eq(groundSum(state, 'copper_ore'), 3, 'copper deposit drops 3 ore');

  // higher tiers need a workbench and are chosen automatically
  go(state, 'surface', trees[0].tx, trees[0].ty + 1);
  grant(state, 'wood', 6); grant(state, 'stone', 4);
  must(sim.craft(state, 'workbench'), 'bench');
  const bench = placeNearby(state, 'workbench');
  grant(state, 'copper_bar', 3); grant(state, 'wood', 2);
  must(sim.craft(state, 'axe_copper'), 'copper axe');
  t.eq(p.tools.axe, 2, 'copper axe owned (replaces stone tier)');
  go(state, 'surface', trees[1].tx, trees[1].ty + 1);
  t.eq(hits(trees[1]), 2, 'copper axe fells a tree in 2 hits');
  go(state, 'surface', bench.x, bench.y + 1);
  grant(state, 'iron_bar', 3); grant(state, 'copper_bar', 1);
  must(sim.craft(state, 'axe_iron'), 'iron axe');
  go(state, 'surface', trees[2].tx, trees[2].ty + 1);
  t.eq(hits(trees[2]), 1, 'iron axe fells a tree in 1 hit');
}

function findWallBy(u, kind) {
  for (let y = 2; y < u.h - 2; y++) for (let x = 2; x < u.w - 2; x++) {
    if (u.wallKind[y * u.w + x] !== kind) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (u.wallKind[ny * u.w + nx] === 0 && isWalkable(u, nx, ny) && !nodeAt(u, nx, ny)) return { x, y, nx, ny };
    }
  }
  return null;
}

async function sWalls(t) {
  const { world, state } = fresh();
  const u = world.underground, p = state.player;
  const spot = {};
  for (const [k, kind] of [['dirt', WALL.DIRT], ['moss', WALL.MOSS], ['copper', WALL.COPPER], ['iron', WALL.IRON]]) {
    spot[k] = findWallBy(u, kind);
    if (!spot[k]) throw new Error(`no ${k} wall next to a floor`);
  }
  const ref = (s, kind) => ({ kind: 'wall', ref: { tx: s.x, ty: s.y, wall: kind } });
  const mine = (s, kind) => { let n = 0; while (u.wallKind[s.y * u.w + s.x] === kind && n < 20) { if (!sim.interact(state, ref(s, kind))) break; n++; } return n; };
  const intact = (s, kind) => u.wallKind[s.y * u.w + s.x] === kind && !state.wallHp.size;
  const at = (s) => go(state, 'underground', s.nx, s.ny);
  const outcrop = u.nodes.find((n) => n.type === 'iron_outcrop');

  at(spot.dirt); drain(state);
  t.eq(sim.interact(state, ref(spot.dirt, WALL.DIRT)), false, 'dirt wall: no pickaxe -> refused');
  t.ok(intact(spot.dirt, WALL.DIRT), 'dirt wall untouched after refusal');
  grant(state, 'branch', 3); grant(state, 'stone', 3); grant(state, 'fiber', 2);
  must(sim.craft(state, 'pick_stone'), 'stone pick');
  const s0 = groundSum(state, 'stone');
  t.eq(mine(spot.dirt, WALL.DIRT), 2, 'dirt wall (hp20): stone pick needs 2 hits');
  const di = spot.dirt.y * u.w + spot.dirt.x;
  t.ok(groundSum(state, 'stone') - s0 === 1 && isWalkable(u, spot.dirt.x, spot.dirt.y) && state.mined.underground[di] === 1, 'dirt wall opens to floor, drops 1 stone, is recorded as mined');

  at(spot.moss); drain(state);
  t.eq(sim.interact(state, ref(spot.moss, WALL.MOSS)), false, 'moss wall (hardness 2): stone pick refused');
  t.ok(drain(state).some((e) => e.type === 'msg' && /銅/.test(e.text)), 'refusal names the copper pickaxe');
  t.ok(intact(spot.moss, WALL.MOSS), 'moss wall unchanged after refusal');
  at(spot.copper);
  t.eq(mine(spot.copper, WALL.COPPER), 3, 'copper wall (hp30, hardness 1): stone pick 3 hits');
  t.eq(groundSum(state, 'copper_ore'), 2, 'copper wall drops 2 ore');
  at(spot.iron);
  t.eq(sim.interact(state, ref(spot.iron, WALL.IRON)), false, 'iron wall: stone pick refused');
  if (outcrop) {
    go(state, 'underground', outcrop.tx, outcrop.ty);
    t.eq(sim.interact(state, { kind: 'node', ref: outcrop }), false, 'iron outcrop: stone pick refused');
    t.ok(sim.nodeAlive(state, outcrop) && !state.nodes.has(outcrop.key), 'iron outcrop undamaged after refusal');
  }

  grant(state, 'wood', 6); grant(state, 'stone', 4);
  must(sim.craft(state, 'workbench'), 'bench');
  placeNearby(state, 'workbench');
  grant(state, 'copper_bar', 3); grant(state, 'wood', 2);
  must(sim.craft(state, 'pick_copper'), 'copper pick');
  t.eq(p.tools.pick, 2, 'copper pickaxe owned');
  at(spot.moss);
  const s1 = groundSum(state, 'stone');
  t.eq(mine(spot.moss, WALL.MOSS), 3, 'moss wall: copper pick 3 hits');
  t.eq(groundSum(state, 'stone') - s1, 2, 'moss wall drops 2 stone');
  at(spot.iron);
  t.eq(mine(spot.iron, WALL.IRON), 4, 'iron wall: copper pick 4 hits');
  t.eq(groundSum(state, 'iron_ore'), 2, 'iron wall drops 2 ore');
  if (outcrop) {
    go(state, 'underground', outcrop.tx, outcrop.ty);
    let n = 0; while (sim.nodeAlive(state, outcrop) && n < 20) { if (!sim.interact(state, { kind: 'node', ref: outcrop })) break; n++; }
    t.eq([n, groundSum(state, 'iron_ore')], [4, 5], 'iron outcrop: copper pick 4 hits, +3 ore');
  }

  // ruin walls and the seal can never be mined or built on
  for (const [label, kind] of [['ruin wall', WALL.RUIN], ['seal door', WALL.SEAL]]) {
    const s = findWallBy(u, kind);
    if (!s) { t.ok(false, `${label}: found a test spot`, 'none'); continue; }
    at(s);
    const input = { aim: { x: cpx(s.x), y: cpx(s.y) }, aimActive: true, act: true, actPressed: true };
    const before = state.groundItems.length;
    run(state, 1.5, { input });
    t.ok(u.wallKind[s.y * u.w + s.x] === kind && state.groundItems.length === before, `${label}: act input cannot break it`);
  }
  const rf = findWallBy(u, WALL.RUIN);
  if (rf && u.protect[rf.ny * u.w + rf.nx]) {
    go(state, 'underground', rf.nx, rf.ny);
    grant(state, 'wall_wood', 1);
    const r = sim.place(state, 'wall_wood', rf.nx + (rf.nx - rf.x), rf.ny + (rf.ny - rf.y));
    t.ok(r.ok === false && sim.countItem(state, 'wall_wood') === 1, 'building inside the ruin is refused without using the item', J(r));
  }
}

/* ================================================================== bag, crafting, building */
async function sBag(t) {
  const { state } = fresh();
  const bag = state.player.bag;
  t.eq(sim.addItem(state, 'stone', 150), 0, '150 stone fit');
  t.eq(bag.filter(Boolean).map((s) => s.n), [99, 51], 'stack splits at 99');
  sim.swapBag(state, 0, 1);
  t.ok(bag.every((s) => !s || s.n <= 99) && sim.countItem(state, 'stone') === 150, 'merging stacks via swap keeps <=99 and conserves the total', J(bag.filter(Boolean)));
  t.eq(sim.addItem(state, 'sword_stone', 3), 0, '3 swords added');
  t.eq(bag.filter((s) => s && s.id === 'sword_stone').map((s) => s.n), [1, 1, 1], 'equipment never stacks');
  t.eq([sim.addItem(state, 'nope_item', 3), sim.countItem(state, 'nope_item')], [3, 0], 'unknown item id is not added');
  const s0 = snap(state);
  sim.addItem(state, 'stone', 0); sim.addItem(state, 'stone', -5);
  t.eq(snap(state), s0, 'zero or negative amounts change nothing');
  t.eq(sim.removeItem(state, 'stone', 151), false, 'removing more than owned fails');
  t.eq(snap(state), s0, 'failed removal changes nothing');
  t.eq([sim.removeItem(state, 'stone', 120), sim.countItem(state, 'stone')], [true, 30], 'removal spans stacks');

  const f = fresh().state;
  const fb = f.player.bag;
  t.eq(sim.addItem(f, 'stone', 99 * 30 + 5), 5, 'overflow beyond 30x99 is returned, not lost silently');
  t.eq([sim.canFit(f, 'wood', 1), sim.canFit(f, 'stone', 1)], [false, false], 'full bag fits nothing');
  sim.removeItem(f, 'stone', 1);
  t.eq([sim.canFit(f, 'stone', 1), sim.canFit(f, 'stone', 2), sim.canFit(f, 'wood', 1)], [true, false, false], 'one missing stone fits only a stone');
  sim.removeItem(f, 'stone', 99);
  t.eq(sim.addItem(f, 'wood', 150), 51, 'partial fit returns the remainder');
  t.eq(sim.countItem(f, 'wood'), 99, 'the fitting part was added');

  const g = fresh().state;
  sim.addItem(g, 'berry', 2);
  t.ok(g.player.hotbar.includes('berry'), 'food is auto-assigned to the hotbar');
  sim.removeItem(g, 'berry', 2);
  t.ok(!g.player.hotbar.includes('berry'), 'hotbar entry clears when the last item is gone');
  grant(g, 'crystal_moss', 1);
  const slot = g.player.bag.findIndex((s) => s && s.id === 'crystal_moss');
  t.eq([sim.dropItem(g, slot), sim.countItem(g, 'crystal_moss')], [false, 1], 'key items cannot be dropped');
  grant(g, 'stone', 30);
  const ss = g.player.bag.findIndex((s) => s && s.id === 'stone');
  sim.dropItem(g, ss, 10);
  t.eq([sim.countItem(g, 'stone'), groundSum(g, 'stone')], [20, 10], 'dropping 10 moves exactly 10 to the ground');

  // chest transfer when the bag is full must not lose the item
  const h = fresh().state;
  const chest = h.structures.find((s) => s.type === 'chest_wood');
  sim.addItem(h, 'stone', 99 * 30);
  const boxBefore = J(h.containers[chest.id]);
  t.eq(sim.transfer(h, chest.id, 'box', 0), false, 'taking from a chest into a full bag is refused');
  t.eq(J(h.containers[chest.id]), boxBefore, 'chest content unchanged after refusal');
  sim.removeItem(h, 'stone', 99);
  t.eq([sim.transfer(h, chest.id, 'box', 0), sim.countItem(h, 'wheat_seed')], [true, 3], 'seeds move from chest to bag');

  // ground pickup is atomic with bag capacity
  const k = fresh().state;
  sim.addItem(k, 'stone', 99 * 30);
  sim.spawnGround(k, 'surface', k.player.x, k.player.y, 'wood', 5);
  const kb = J(k.player.bag);
  run(k, 3);
  t.ok(J(k.player.bag) === kb && groundSum(k, 'wood') === 5, 'a full bag leaves the ground item in place');
  sim.removeItem(k, 'stone', 99);
  run(k, 2);
  t.ok(sim.countItem(k, 'wood') === 5 && groundSum(k, 'wood') === 0, 'after freeing a slot the item is picked up whole');
}

async function sCraft(t) {
  const { world, state } = fresh();
  const p = state.player, camp = world.surface.landmarks.camp;
  const refused = (id, label, times = 1) => {
    const s0 = snap(state), r = sim.craft(state, id, times);
    t.ok(!r.ok && snap(state) === s0, `${label}: refused and nothing consumed`, J(r));
  };
  refused('nonexistent_recipe', 'unknown recipe');
  refused('crystal_moss', 'key item is not craftable');
  grant(state, 'branch', 3); grant(state, 'stone', 1); grant(state, 'fiber', 2);
  refused('axe_stone', 'one stone short');
  grant(state, 'wood', 6); grant(state, 'stone', 6);
  refused('hoe_stone', 'workbench recipe without a workbench');
  must(sim.craft(state, 'sword_stone'), 'sword');
  t.eq(p.equip.weapon, 'sword_stone', 'crafted sword auto-equips into the empty slot');
  must(sim.craft(state, 'workbench'), 'bench');
  t.eq(sim.countItem(state, 'wood'), 0, 'workbench consumed exactly 6 wood');
  refused('table', 'workbench in the bag but not placed');
  const bench = placeNearby(state, 'workbench');
  grant(state, 'branch', 2); grant(state, 'stone', 2); grant(state, 'fiber', 2);
  must(sim.craft(state, 'hoe_stone'), 'hoe at bench');
  t.eq(p.tools.hoe, 1, 'hoe crafted next to the workbench');
  grant(state, 'wood', 5);
  go(state, 'surface', bench.x + 9, bench.y);
  refused('table', 'bench 9 tiles away');
  go(state, 'surface', bench.x, bench.y + 1);
  must(sim.craft(state, 'table'), 'table near bench');
  grant(state, 'fiber', 16);
  must(sim.craft(state, 'cloth', 5), 'cloth x5');
  t.eq([sim.countItem(state, 'cloth'), sim.countItem(state, 'fiber')], [5, 1], 'x5 crafting multiplies inputs and outputs');
  sim.removeItem(state, 'fiber', 1); grant(state, 'fiber', 14);
  refused('cloth', 'x5 with 14 fiber', 5);

  // furnace / campfire / pot ranges
  grant(state, 'copper_ore', 2); grant(state, 'wood', 1);
  refused('copper_bar', 'smelting without a furnace');
  grant(state, 'furnace', 1);
  placeNearby(state, 'furnace');
  must(sim.craft(state, 'copper_bar'), 'smelt near furnace');
  t.eq(sim.countItem(state, 'copper_bar'), 1, 'copper bar smelted');
  go(state, 'surface', camp.x, camp.y + 2);
  grant(state, 'mushroom', 4);
  must(sim.craft(state, 'roast_mushroom'), 'roast at campfire');
  go(state, 'surface', camp.x + 12, camp.y + 4);
  refused('roast_mushroom', 'campfire 12 tiles away');
  go(state, 'surface', camp.x, camp.y + 2);
  grant(state, 'wheat', 3);
  refused('wheat_bread', 'bread needs a pot, campfire is not enough');
  grant(state, 'pot', 1);
  placeNearby(state, 'pot');
  must(sim.craft(state, 'wheat_bread'), 'bread at pot');
  t.ok(state.progress.stats.foods.roast_mushroom && state.progress.stats.foods.wheat_bread, 'cooked foods are recorded for the life goal');
  t.eq(sim.getLifeGoals(state).find((g) => g.id === 'foods').value, 2, 'foods goal counts 2 kinds');

  // 消費で空く枠を使える。成果物が収まらない場合だけ原子的に拒否する。
  const f = fresh().state;
  grant(f, 'stone', 99 * 28); grant(f, 'branch', 2); grant(f, 'resin', 2);
  const s0 = snap(f), r = sim.craft(f, 'torch');
  t.ok(!r.ok && snap(f) === s0, 'full bag: torch craft refused atomically', J(r));
  sim.removeItem(f, 'branch', 1); sim.removeItem(f, 'resin', 1);
  must(sim.craft(f, 'torch'), 'ingredients free slots in full bag');
  t.eq([sim.countItem(f, 'torch'), sim.countItem(f, 'branch'), sim.countItem(f, 'resin')], [4, 0, 0], 'freed ingredient slots fit the result');
  sim.removeItem(f, 'stone', 99);
  grant(f, 'branch', 1); grant(f, 'resin', 1);
  must(sim.craft(f, 'torch'), 'torch with a free slot');
  t.eq([sim.countItem(f, 'torch'), sim.countItem(f, 'branch'), sim.countItem(f, 'resin')], [8, 0, 0], 'torch recipe 1 branch + 1 resin -> 4');
}

async function sBuild(t) {
  const { world, state } = fresh();
  const p = state.player, map = world.surface;
  grant(state, 'wall_wood', 4); grant(state, 'floor_wood', 2); grant(state, 'bed', 1);
  const wallN = () => sim.countItem(state, 'wall_wood');
  const spot = placeNearby(state, 'wall_wood');
  t.eq(wallN(), 3, 'placing consumes one wall');
  t.ok(sim.structureAt(state, 'surface', spot.x, spot.y).type === 'wall_wood' && state.progress.built.wall_wood, 'wall exists and is recorded as built');
  const dup = sim.place(state, 'wall_wood', spot.x, spot.y);
  t.ok(!dup.ok && wallN() === 3, 'cannot place on an occupied tile, item kept', J(dup));
  const camp = map.landmarks.camp;
  const onFire = sim.place(state, 'wall_wood', camp.x, camp.y);
  t.ok(!onFire.ok && wallN() === 3, 'cannot build on the campfire');
  const own = sim.place(state, 'wall_wood', tileOf(p.x), tileOf(p.y));
  t.ok(!own.ok && wallN() === 3, 'cannot wall in your own tile', J(own));
  const noItem = sim.place(state, 'chair', spot.x + 1, spot.y);
  t.ok(!noItem.ok, 'placing something you do not hold is refused');
  // distance
  let far = null;
  for (let d = 9; d < 14 && !far; d++) for (const dx of [d, -d]) {
    const x = tileOf(p.x) + dx, y = tileOf(p.y);
    if (isBuildTerrain(map, x, y) && !nodeAt(map, x, y) && !sim.structureAt(state, 'surface', x, y)) { far = [x, y]; break; }
  }
  if (far) {
    const r = sim.place(state, 'wall_wood', far[0], far[1]);
    t.ok(!r.ok && wallN() === 3 && !sim.structureAt(state, 'surface', far[0], far[1]), 'too far: refused, nothing consumed', J(r));
    go(state, 'surface', far[0], far[1] + 1);
    t.ok(sim.place(state, 'wall_wood', far[0], far[1]).ok, 'same tile is accepted once in range (distance was the cause)');
    sim.remove(state, far[0], far[1]);
    go(state, 'surface', spot.x, spot.y + 2);
  }
  // water
  let shore = null;
  for (let y = 1; y < map.h - 1 && !shore; y++) for (let x = 1; x < map.w - 1 && !shore; x++) {
    if (getTile(map, x, y) !== TERRAIN.SHALLOW) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (getTile(map, x + dx, y + dy) === TERRAIN.DEEP) { shore = { sx: x, sy: y, dx: x + dx, dy: y + dy }; break; }
  }
  if (shore) {
    go(state, 'surface', shore.sx, shore.sy);
    const r = sim.place(state, 'wall_wood', shore.dx, shore.dy);
    t.ok(!r.ok && wallN() === 3, 'deep water: refused, item kept', J(r));
    go(state, 'surface', spot.x, spot.y + 2);
  }
  // floor and wall share a tile; demolition returns exactly one item per call
  const fl = placeNearby(state, 'floor_wood');
  t.ok(sim.place(state, 'wall_wood', fl.x, fl.y).ok, 'a wall can stand on a floor tile (separate layers)');
  const w0 = wallN();
  must(sim.remove(state, fl.x, fl.y), 'remove wall');
  t.eq([wallN(), sim.structureAt(state, 'surface', fl.x, fl.y).type], [w0 + 1, 'floor_wood'], 'demolishing the wall refunds 100% and leaves the floor');
  must(sim.remove(state, fl.x, fl.y), 'remove floor');
  t.eq(sim.countItem(state, 'floor_wood'), 2, 'floor refunded');
  t.ok(!sim.remove(state, camp.x, camp.y).ok, 'the campfire cannot be demolished');
  const chest = state.structures.find((s) => s.type === 'chest_wood');
  go(state, 'surface', chest.x, chest.y + 1);
  const rc = sim.remove(state, chest.x, chest.y);
  t.ok(!rc.ok && state.structures.includes(chest), 'a chest with items cannot be demolished', J(rc));
  t.ok(!sim.remove(state, chest.x + 5, chest.y + 5).ok, 'demolishing an empty tile is refused');
}

/* ================================================================== houses, farming, sleep, residents, forge */
async function sHouses(t) {
  const world = createWorld();
  const variants = [
    ['complete 3x3 house', {}, 1, 1],
    ['gap in a wall', { skipRel: [[0, 2]] }, 0, 1],
    ['fence instead of wall', { fenceRel: [[0, 2]] }, 0, 1],
    ['wall where the door should be', { noDoor: true }, 0, 1],
    ['no light', { noLight: true }, 0, 1],
    ['torch as the only light (DESIGN 6 names candlestick/lantern only)', { lightType: 'torch' }, 0, 1],
    ['lantern as light', { lightType: 'lantern_stone' }, 1, 1],
    ['one interior tile without floor', { noFloorRel: [[2, 2]] }, 0, 1],
    ['no bed', { noBed: true }, 0, 0],
    ['interior only 2x3', { iw: 2, ih: 3 }, 0, 1],
  ];
  for (const [label, o, valid, total] of variants) {
    const state = sim.createState(world);
    try {
      const site = findSite(state, (o.iw || 3) + 2, (o.ih || 3) + 2, { margin: 2 });
      if (!site) { t.ok(false, `${label}: clear build site exists`, 'none found'); continue; }
      const h = buildHouse(state, site, o);
      tick(state, 0.2);
      const hs = sim.getHouseStatus(state);
      t.eq([hs.valid, hs.total], [valid, total], `${label}: valid/total houses`);
      if (total && !valid) t.ok(hs.houses[0].reasons.length > 0, `${label}: invalid house explains why`, J(hs.houses[0].reasons));
      if (label === 'complete 3x3 house') {
        const H = hs.houses[0], bed = sim.structureAt(state, 'surface', h.bed[0], h.bed[1]);
        t.ok(H.cells.length === 9 && H.doors.length === 1 && H.lights.length === 1 && H.bed === bed.id && H.safe === true, 'valid house: 9 cells, 1 door, 1 light, its bed, inside safe zone', J({ c: H.cells.length, d: H.doors, l: H.lights, safe: H.safe }));
        sim.remove(state, h.x0, h.y0 + 2);
        tick(state, 3);
        t.eq(sim.getHouseStatus(state).valid, 0, 'removing one wall invalidates the house within 3 seconds');
        must(sim.place(state, 'wall_wood', h.x0, h.y0 + 2), 'repair wall');
        tick(state, 0.6);
        t.eq(sim.getHouseStatus(state).valid, 1, 'repairing the wall restores the house');
      }
      if (label === 'gap in a wall') {
        grant(state, 'wall_wood', 1);
        must(sim.place(state, 'wall_wood', h.x0, h.y0 + 2), 'fill gap');
        tick(state, 0.6);
        t.eq(sim.getHouseStatus(state).valid, 1, 'closing the gap makes the same house valid');
      }
    } catch (e) { t.ok(false, `${label}: fixture threw`, errText(e)); }
  }
}

function findPlot(state, avoid) {
  const p = state.player, tx = tileOf(p.x), ty = tileOf(p.y), c = [];
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) c.push([tx + dx, ty + dy, Math.hypot(dx, dy)]);
  c.sort((a, b) => a[2] - b[2]);
  for (const [x, y] of c) if (!inAny(avoid, x, y) && Math.hypot(cpx(x) - p.x, cpx(y) - p.y) > 40 && sim.canBuild(state, 'farm', x, y).ok) return [x, y];
  throw new Error('no tillable tile near the player');
}

async function sFarming(t) {
  const { world, state } = fresh();
  const p = state.player, map = world.surface;
  // refusals before the hoe exists
  const nt = Math.floor(p.x / TILE) + 2, nty = Math.floor(p.y / TILE);
  const noHoe = sim.till(state, nt, nty);
  t.ok(!noHoe.ok && state.farmland.length === 0, 'tilling without a hoe is refused', J(noHoe));
  setupHoe(state);
  go(state, 'underground', world.underground.landmarks.spawn.x, world.underground.landmarks.spawn.y);
  t.ok(!sim.till(state, 5, 5).ok, 'no farming underground');
  const bench = state.structures.find((s) => s.type === 'workbench');
  go(state, 'surface', bench.x, bench.y + 1);
  const occ = sim.till(state, bench.x, bench.y);
  t.ok(!occ.ok, 'cannot till under a workbench', J(occ));
  let sand = null;
  for (let y = 1; y < map.h - 1 && !sand; y++) for (let x = 1; x < map.w - 1 && !sand; x++) if (getTile(map, x, y) === TERRAIN.SAND && !nodeAt(map, x, y)) sand = [x, y];
  if (sand) { go(state, 'surface', sand[0], sand[1]); t.ok(!sim.till(state, sand[0], sand[1]).ok, 'sand cannot be tilled'); }
  const grass = nearestNodes(state, 'grass', 1)[0];
  go(state, 'surface', grass.tx, grass.ty + 1);
  t.ok(!sim.till(state, grass.tx, grass.ty).ok, 'a tile with an uncut plant cannot be tilled');

  // strip: potato A (lit by a candlestick), wheat, potato B (unlit)
  const site = needSite(state, 9, 1, { tillable: true, margin: 2 });
  prepareSite(state, site);
  const y = site.y0, X = (i) => site.x0 + i;
  go(state, 'surface', X(4), y);
  for (const i of [1, 5, 8]) must(sim.till(state, X(i), y), `till ${i}`);
  t.ok(!sim.till(state, X(1), y).ok, 'tilling twice is refused');
  t.eq(state.farmland.length, 3, 'three plots tilled');
  const chest = state.structures.find((s) => s.type === 'chest_wood');
  go(state, 'surface', chest.x, chest.y + 1);
  must({ ok: sim.transfer(state, chest.id, 'box', 0) }, 'take seeds');
  go(state, 'surface', X(4), y);
  t.ok(!sim.plant(state, 'wheat', X(3), y).ok, 'planting on untilled ground is refused');
  grant(state, 'moss_potato', 2);
  must(sim.plant(state, 'moss_potato', X(1), y), 'plant A');
  must(sim.plant(state, 'moss_potato', X(8), y), 'plant B');
  must(sim.plant(state, 'wheat', X(5), y), 'plant wheat');
  t.eq([sim.countItem(state, 'moss_potato'), sim.countItem(state, 'wheat_seed')], [0, 2], 'each planting consumed one seed');
  t.ok(!sim.plant(state, 'wheat', X(5), y).ok, 'a plot holds one crop');
  grant(state, 'candlestick', 1);
  must(sim.place(state, 'candlestick', X(3), y), 'candle');
  const A = cropAt(state, 'surface', X(1), y), B = cropAt(state, 'surface', X(8), y), W = cropAt(state, 'surface', X(5), y);
  run(state, 100, { dt: 1 });
  t.approx(B.growth, 100, 2, 'unlit potato grows 1 per second');
  t.approx(A.growth, 125, 3, 'potato within 4 tiles of a candlestick grows 1.25x');
  const keep = invMap(state);
  go(state, 'surface', X(1), y);
  t.eq(sim.interact(state, { kind: 'crop', ref: A }), false, 'unripe crop cannot be harvested');
  t.eq(J(invMap(state)), J(keep), 'unripe harvest changes nothing');
  run(state, 40, { dt: 1 });
  t.ok(!cropRipe(A), 'lit potato not ripe after 140s (needs 144s)', 'growth ' + A.growth);
  run(state, 10, { dt: 1 });
  t.ok(cropRipe(A) && !cropRipe(B), 'after 150s lit potato is ripe, unlit one is not');
  const potBefore = sim.countItem(state, 'moss_potato');
  const hv = sim.harvest(state, A);
  t.ok(hv.ok && hv.replanted, 'harvest succeeds and replants', J(hv));
  t.eq(sim.countItem(state, 'moss_potato') - potBefore, 2, 'harvest +3 potatoes, 1 used to replant');
  const A2 = cropAt(state, 'surface', X(1), y);
  t.ok(A2 && A2 !== A && A2.growth === 0, 'a fresh crop stands on the plot');
  run(state, 90, { dt: 1 });
  t.ok(cropRipe(B), 'unlit potato ripe after 240s total (180s needed)', 'growth ' + B.growth);
  t.ok(cropRipe(W), 'wheat (lit, 192s) ripe after 240s', 'growth ' + W.growth);
  go(state, 'surface', X(5), y);
  const wheatSeedBefore = sim.countItem(state, 'wheat_seed'), w0 = sim.countItem(state, 'wheat');
  must(sim.harvest(state, W), 'harvest wheat');
  t.eq([sim.countItem(state, 'wheat') - w0, sim.countItem(state, 'wheat_seed') - wheatSeedBefore], [3, 1], 'wheat: +3 grain, +2 seeds -1 replant');
  // demolishing an unripe plot returns its seed
  const A3 = cropAt(state, 'surface', X(1), y);
  go(state, 'surface', X(1), y);
  const pb = sim.countItem(state, 'moss_potato');
  must(sim.remove(state, X(1), y), 'remove plot');
  t.ok(!cropAt(state, 'surface', X(1), y) && !farmAt(state, 'surface', X(1), y) && sim.countItem(state, 'moss_potato') === pb + 1 && A3, 'removing an unripe plot returns the seed');
}

async function sSleep(t) {
  const { state } = fresh();
  const p = state.player;
  setupHoe(state);
  const used = [];
  const h = newHouse(state, used);
  const [px, py] = findPlot(state, used);
  must(sim.till(state, px, py), 'till');
  grant(state, 'moss_potato', 1);
  must(sim.plant(state, 'moss_potato', px, py), 'plant');
  const crop = cropAt(state, 'surface', px, py);
  const bed = sim.structureAt(state, 'surface', h.bed[0], h.bed[1]);
  const house = sim.getHouseStatus(state).houses[0];
  const spawn0 = J(p.spawn), clock0 = state.time.clock;

  drain(state);
  sim.interact(state, { kind: 'structure', ref: bed });
  const ev = drain(state);
  t.ok(state.time.clock === clock0 && J(p.spawn) === spawn0 && !ev.some((e) => e.type === 'sleep'), 'daytime: sleeping is refused, clock and spawn unchanged');
  t.ok(ev.some((e) => e.type === 'msg' && e.tone === 'warn'), 'daytime refusal is explained');

  sim.setClock(state, 420);
  const broken = [h.x0, h.y0 + 2];
  must(sim.remove(state, broken[0], broken[1]), 'open wall');
  const c1 = state.time.clock;
  sim.interact(state, { kind: 'structure', ref: bed });
  t.ok(state.time.clock === c1 && !drain(state).some((e) => e.type === 'sleep'), 'night but house invalid: sleeping refused');
  must(sim.place(state, 'wall_wood', broken[0], broken[1]), 'repair');

  p.hp = 40;
  const sat0 = p.satiety, g0 = crop.growth;
  sim.interact(state, { kind: 'structure', ref: bed });
  const ev2 = drain(state);
  t.ok(ev2.some((e) => e.type === 'sleep'), 'night in a valid house: sleep happens');
  t.approx(sim.timeOfDay(state), BALANCE.day.sleepTo, 0.5, 'wakes at 30s of the next day');
  t.eq(state.time.day, 2, 'day counter advanced');
  t.eq(p.hp, 100, 'sleep restores HP');
  t.eq(sat0 - p.satiety, BALANCE.hunger.sleepCost, 'sleep costs 15 satiety');
  t.ok(Math.hypot(p.spawn.x - house.x, p.spawn.y - house.y) < 1 && p.spawn.map === 'surface', 'spawn moved to the house');
  t.ok(crop.growth > g0 && cropRipe(crop), 'skipped time counts as crop growth (potato ripe)', `growth ${g0} -> ${crop.growth}`);
  const c2 = state.time.clock;
  sim.interact(state, { kind: 'structure', ref: bed });
  t.ok(state.time.clock === c2, 'cannot sleep again right after waking (morning)');
  go(state, 'surface', h.stand[0] + 3, h.y0 - 3);
  playerDeath(state);
  t.ok(Math.hypot(p.x - house.x, p.y - house.y) < 48 && p.map === 'surface', 'after death the player wakes inside the house', `at ${p.x},${p.y} house ${house.x},${house.y}`);
}

async function sResidents(t) {
  const { state } = fresh();
  const p = state.player, used = [];
  setupHoe(state);
  const sites = [];
  for (let i = 0; i < 3; i++) sites.push(needSite(state, 5, 5, { used: sites, margin: 2 }));
  const residents = () => Object.fromEntries(Object.entries(state.progress.npcs).map(([k, v]) => [k, !!v.joined]));
  void used;
  buildHouse(state, sites[0]); tick(state, 5);
  t.ok(state.progress.npcs.cook && !state.progress.npcs.cook.joined && !state.npcs.some((n) => n.id === 'cook'), 'cook is announced but has not arrived after 5s');
  tick(state, 7);
  const cook = state.npcs.find((n) => n.id === 'cook');
  t.ok(cook && cook.active && state.progress.npcs.cook.joined, 'cook arrives after ~10s and lives in the house');
  t.ok(!state.progress.npcs.farmer && !state.progress.npcs.builder, 'farmer and builder are not available with one house');

  const h2 = buildHouse(state, sites[1]); tick(state, 12);
  t.ok(!state.progress.npcs.farmer, 'two houses without farm plots: no farmer yet');
  let plots = 0;
  while (plots < 4) { const [x, y] = findPlot(state, sites); must(sim.till(state, x, y), 'till'); plots++; }
  tick(state, 12);
  t.ok(state.progress.npcs.farmer && state.progress.npcs.farmer.joined, 'two houses + 4 plots: farmer joins');

  buildHouse(state, sites[2]); tick(state, 12);
  t.eq(sim.getHouseStatus(state).valid, 3, 'three valid houses');
  t.ok(!state.progress.npcs.builder, 'three houses without the forge light: no builder');
  offerForge(state); tick(state, 12);
  t.eq(residents(), { cook: true, farmer: true, builder: true }, 'forge restored: builder joins, all three live here');
  const hs = state.npcs.map((n) => n.house);
  t.eq(new Set(hs).size, 3, 'each resident has their own house', J(hs));

  // production: potato basket, builder basket, farmer harvesting a ripe wheat plot
  const chest = state.structures.find((s) => s.type === 'chest_wood');
  go(state, 'surface', chest.x, chest.y + 1);
  sim.transfer(state, chest.id, 'box', 0);
  const [wx, wy] = findPlot(state, sites);
  go(state, 'surface', wx, wy);
  must(sim.till(state, wx, wy), 'till wheat plot');
  must(sim.plant(state, 'wheat', wx, wy), 'plant wheat');
  quiet(state);
  run(state, 310, { dt: 1 });
  const rec = state.progress.npcs;
  t.ok((rec.cook.basket.baked_potato || 0) >= 1, 'cook basket gained a baked potato', J(rec.cook.basket));
  t.ok((rec.builder.basket.wood || 0) >= 6 && (rec.builder.basket.stone || 0) >= 6, 'builder basket gained wood and stone', J(rec.builder.basket));
  t.ok((rec.farmer.basket.wheat || 0) >= 3, 'farmer harvested the ripe wheat into the basket', J(rec.farmer.basket));
  const wc = cropAt(state, 'surface', wx, wy);
  t.ok(wc && wc.growth < 100, 'harvested plot was replanted (growth reset)', wc ? String(wc.growth) : 'no crop');
  const bres = state.npcs.find((n) => n.id === 'builder');
  go(state, 'underground', 10, 11);
  const far = sim.collectResident(state, 'builder');
  t.ok(!far.ok, 'cannot collect from another map');
  go(state, 'surface', tileOf(bres.x), tileOf(bres.y));
  const bw = sim.countItem(state, 'wood'), bs = sim.countItem(state, 'stone'), bb = { ...rec.builder.basket };
  must(sim.collectResident(state, 'builder'), 'collect');
  t.eq([sim.countItem(state, 'wood') - bw, sim.countItem(state, 'stone') - bs], [bb.wood, bb.stone], 'collected exactly the basket content');
  t.eq([rec.builder.basket.wood, rec.builder.basket.stone], [0, 0], 'basket emptied');
  const camp = state.world.surface.landmarks.camp;
  t.ok(state.npcs.every((n) => Math.hypot(n.x - cpx(camp.x), n.y - cpx(camp.y)) < BALANCE.safe.radiusAfterForge * TILE), 'residents stay inside the safe zone');

  // breaking a house must not remove residents or throw; one of three loses a home
  go(state, 'surface', sites[0].x0 + 1, sites[0].y0 + 1);
  must(sim.remove(state, sites[0].x0, sites[0].y0 + 2), 'break wall');
  tick(state, 1);
  t.eq(state.npcs.filter((n) => !n.active).length, 1, 'one resident waits at the campfire without a house');
  t.ok(Object.values(state.progress.npcs).every((r) => r.joined), 'residents remain joined');
  must(sim.place(state, 'wall_wood', sites[0].x0, sites[0].y0 + 2), 'repair');
  tick(state, 1);
  t.eq(state.npcs.filter((n) => n.active).length, 3, 'repairing the house reactivates everyone');
  void h2; void p;
}

async function sForge(t) {
  const { state } = fresh();
  const a = state.world.surface.landmarks.forgeAltar;
  const have = () => J([sim.countItem(state, 'copper_bar'), sim.countItem(state, 'moss_oil'), sim.countItem(state, 'forest_stew')]);
  const refuse = (label) => {
    const h0 = have(), r = sim.restoreLight(state, 'forge');
    t.ok(!r.ok && !state.progress.lights.forge && have() === h0, `${label}: refused, nothing consumed`, J(r));
  };
  grant(state, 'copper_bar', 4); grant(state, 'moss_oil', 2); grant(state, 'forest_stew', 1);
  refuse('away from the altar');
  go(state, 'surface', a.x, a.y + 2);
  refuse('altar reached but no house');
  const used = [];
  newHouse(state, used);
  go(state, 'surface', a.x, a.y + 2);
  sim.removeItem(state, 'copper_bar', 1); refuse('3 of 4 copper bars'); grant(state, 'copper_bar', 1);
  sim.removeItem(state, 'moss_oil', 1); refuse('1 of 2 oil'); grant(state, 'moss_oil', 1);
  sim.removeItem(state, 'forest_stew', 1); refuse('no stew'); grant(state, 'forest_stew', 1);
  grant(state, 'copper_bar', 2); grant(state, 'moss_oil', 1); grant(state, 'forest_stew', 1);
  const camp = state.world.surface.landmarks.camp;
  const edge = cpx(camp.x) + 16 * TILE, ey = cpx(camp.y);
  t.eq(sim.inSafeZone(state, edge, ey), false, 'point 16 tiles from camp is outside the safe zone');
  drain(state);
  must(sim.restoreLight(state, 'forge'), 'restore');
  t.eq(have(), J([2, 1, 1]), 'exactly 4 bars, 2 oil, 1 stew consumed');
  t.ok(state.progress.lights.forge && drain(state).some((e) => e.type === 'light' && e.id === 'forge'), 'forge light restored with a light event');
  t.eq(sim.inSafeZone(state, edge, ey), true, 'safe zone grows from 14 to 20 tiles');
  const again = sim.restoreLight(state, 'forge');
  t.ok(again.ok && have() === J([2, 1, 1]), 'second call consumes nothing');
  const j = sim.getJournal(state);
  t.ok(j.lights[0].done && j.lights[0].requirements.every((r) => r.done), 'journal shows the forge light complete');
  checkGoalInvariants(t, state, 'after forge');
}

/* ================================================================== moss light, bosses, death */
async function sMoss(t) {
  const { world, state } = fresh();
  const u = world.underground, lm = u.landmarks;
  const crystalNode = u.nodes.find((n) => n.type === 'crystal_node' && n.meta && n.meta.room === 0);
  go(state, 'underground', crystalNode.tx, crystalNode.ty);
  t.ok(sim.interact(state, { kind: 'node', ref: crystalNode }), 'crystal can be taken bare-handed');
  t.ok(runUntil(state, () => sim.countItem(state, 'crystal_moss') >= 1, 4) >= 0, 'crystal drop is picked up');
  const slot = state.player.bag.findIndex((s) => s && s.id === 'crystal_moss');
  t.eq([sim.dropItem(state, slot), sim.craft(state, 'crystal_moss').ok], [false, false], 'crystal is neither droppable nor craftable');

  go(state, 'surface', 40, 72);
  const s0 = snap(state);
  t.ok(!sim.restoreLight(state, 'moss').ok && snap(state) === s0 && state.progress.crystalsPlaced === 0, 'far from the altar: refused, crystal kept');
  go(state, 'underground', lm.mossAltar.x - 1, lm.mossAltar.y + 1);
  must(sim.restoreLight(state, 'moss'), 'first crystal');
  t.eq([state.progress.crystalsPlaced, sim.countItem(state, 'crystal_moss'), !!bossEntity(state, 'vine')], [1, 0, false], '1 crystal placed, no boss yet');
  const none = sim.restoreLight(state, 'moss');
  t.ok(!none.ok && state.progress.crystalsPlaced === 1, 'without crystals the altar does nothing', J(none));
  grant(state, 'crystal_moss', 4);
  must(sim.restoreLight(state, 'moss'), 'reach 3');
  t.eq([state.progress.crystalsPlaced, sim.countItem(state, 'crystal_moss')], [3, 2], 'only the 2 missing crystals were taken (never more than 3 placed)');
  const boss = bossEntity(state, 'vine');
  t.ok(boss && boss.hp === 400 && boss.map === 'underground' && !boss.engaged, 'the third crystal summons the vine boss at full HP');
  grant(state, 'moss_wick', 1);
  const r = sim.restoreLight(state, 'moss');
  t.ok(!r.ok && !state.progress.lights.moss && sim.countItem(state, 'moss_wick') === 1, 'wick is refused before the boss is defeated and stays in the bag', J(r));
  const vineNode = u.nodes.find((n) => n.type === 'return_vine');
  go(state, 'underground', vineNode.tx, vineNode.ty);
  sim.interact(state, { kind: 'node', ref: vineNode });
  t.eq(state.player.map, 'underground', 'return vine stays closed before the boss falls');
  // guards on other lights
  grant(state, 'ancient_wick', 1);
  const lh = lm.lighthouse;
  go(state, 'underground', lh.x, lh.y - 1);
  const an = sim.restoreLight(state, 'ancient');
  t.ok(!an.ok && !state.progress.cleared && sim.countItem(state, 'ancient_wick') === 1, 'ancient light cannot be lit without the other prerequisites', J(an));
  t.ok(!sim.restoreLight(state, 'nonsense').ok, 'unknown light id is refused');
  t.ok(!sim.bossRematch(state, 'vine').ok && !sim.bossRematch(state, 'common').ok, 'rematch is refused before the light is restored');
}

// One fixed first attack (rng stub 0.9 -> vine always opens with the 1.0s lash).
function lashTrial(world, mode) {
  const state = sim.createState(world);
  const boss = summonVine(state);
  state.rng = () => 0.9;
  const p = state.player;
  if (mode === 'death') { p.hp = 10; grant(state, 'wood', 30); grant(state, 'stone', 5); grant(state, 'berry', 4); grant(state, 'crystal_moss', 1); equip(state, 'sword_stone'); }
  const start = runUntil(state, () => boss.state === 'tele' && boss.attack === 'lash', 5);
  const hp0 = p.hp;
  const out = { state, boss, start, hp0, tele: null };
  if (start < 0) return out;
  out.tele = state.telegraphs.find((x) => x.owner === boss.id) || null;
  out.teleDur = boss.dur;
  if (mode === 'roll') {
    runUntil(state, () => boss.t >= 0.88, 1);
    sim.step(state, 1 / 60, { dodgePressed: true });
    runUntil(state, () => boss.state !== 'tele', 1);
    out.frames = 0;
  } else if (mode === 'walk') {
    runUntil(state, () => boss.state !== 'tele', 1.6, { input: { moveX: 1 } });
    out.frames = 0;
  } else {
    out.frames = runUntil(state, () => p.hp < hp0 || p.map !== 'underground', 3);
  }
  return out;
}

async function sBossCombat(t) {
  const world = createWorld();
  const dmg = BOSSES.vine.attacks.lash.dmg;
  const stand = lashTrial(world, 'stand');
  t.ok(stand.start >= 0, 'vine begins a lash telegraph after engaging', 'start=' + stand.start);
  t.ok(stand.tele && stand.tele.kind === 'line' && stand.tele.remaining > 0.5, 'telegraph is published as a line with time remaining', J(stand.tele));
  t.ok(stand.teleDur >= 0.4, 'telegraph lasts at least 0.4s (DESIGN)', 'dur=' + stand.teleDur);
  t.ok(stand.frames >= 0.4 * 60 && stand.frames <= 75, 'standing still: damage lands only after the telegraph', 'frames=' + stand.frames);
  t.eq(stand.hp0 - stand.state.player.hp, dmg, 'lash damage equals its listed damage with no armor');
  const roll = lashTrial(world, 'roll');
  t.ok(roll.start >= 0 && roll.state.player.hp === roll.hp0 && roll.boss.state !== 'tele', 'dodge roll during the hit frame avoids the lash that hits when standing', `hp ${roll.state.player.hp}/${roll.hp0} bossState=${roll.boss.state}`);
  const walk = lashTrial(world, 'walk');
  t.ok(walk.start >= 0 && walk.state.player.hp === walk.hp0, 'walking out of the line during the telegraph avoids the lash', `hp ${walk.state.player.hp}/${walk.hp0}`);

  const d = lashTrial(world, 'death');
  const s = d.state, p = s.player, camp = world.surface.landmarks.camp;
  t.ok(d.frames >= 0 && p.map === 'surface', 'a lethal lash kills the player and respawns them on the surface', `map=${p.map}`);
  t.eq([p.hp, p.satiety >= 40], [BALANCE.death.hp, true], 'respawn HP 60, satiety at least 40');
  t.eq([sim.countItem(s, 'berry'), sim.countItem(s, 'crystal_moss'), p.equip.weapon, sim.countItem(s, 'wood')], [4, 1, 'sword_stone', 0], 'food, key item and equipment kept; materials left the bag');
  const bag = s.deathBag;
  t.ok(bag && bag.map === 'underground' && bag.items.find((i) => i.id === 'wood' && i.n === 30) && bag.items.find((i) => i.id === 'stone' && i.n === 5), 'dropped bag at the death spot holds exactly the materials', J(bag));
  const vine = bossEntity(s, 'vine');
  t.ok(vine && vine.hp === vine.maxHp && !vine.engaged && !s.enemies.includes(vine) && s.dormant.includes(vine) && !s.boss, 'boss reset to full HP and is parked off the surface map');
  t.eq([s.projectiles.length, s.progress.crystalsPlaced], [0, 3], 'projectiles cleared, crystal progress kept');
  t.ok(Math.hypot(p.x - cpx(camp.x), p.y - cpx(camp.y)) < 3 * TILE, 'respawned beside the campfire');
  // the dropped bag is only collectable on its own map
  t.eq([sim.collectDeathBag(s), s.deathBag === bag], [0, true], 'bag cannot be collected from another map');
  go(s, 'underground', tileOf(bag.x), tileOf(bag.y));
  run(s, 1.5);
  t.ok(s.deathBag === null && sim.countItem(s, 'wood') === 30 && sim.countItem(s, 'stone') === 5, 'walking onto the bag returns every material');

  // leaving the arena for 5s resets a fight
  const st = sim.createState(world);
  const boss = summonVine(st);
  for (let i = 0; i < 3; i++) sim.damageEnemy(st, boss, 24, 0, 0);
  t.ok(boss.engaged && boss.hp === 400 - 72, 'damage engages the boss and sticks');
  go(st, 'underground', 24, 40);
  t.ok(runUntil(st, () => boss.hp === boss.maxHp && !boss.engaged, 8) >= 0, 'fleeing 10+ tiles for 5s resets the boss to full HP');
}

async function sDeathBag(t) {
  const { world, state } = fresh();
  const p = state.player, camp = world.surface.landmarks.camp;
  grant(state, 'stone', 150); grant(state, 'wood', 20); grant(state, 'branch', 3);
  grant(state, 'berry', 4); grant(state, 'workbench', 1); grant(state, 'crystal_moss', 1);
  equip(state, 'sword_stone'); equip(state, 'tunic_fiber');
  go(state, 'surface', camp.x + 8, camp.y + 5);
  const near = makeEnemy(state, 'slime', 'surface', p.spawn.x + 40, p.spawn.y);
  const farE = makeEnemy(state, 'slime', 'surface', p.spawn.x + 30 * TILE, p.spawn.y);
  state.enemies.push(near, farE);
  p.hp = 30; p.satiety = 10;
  playerDeath(state);
  const b1 = state.deathBag;
  t.ok(b1 && b1.map === 'surface' && b1.items.length === 3, 'one dropped bag with the three material kinds', J(b1));
  t.eq([sim.countItem(state, 'berry'), sim.countItem(state, 'workbench'), sim.countItem(state, 'crystal_moss'), p.equip.weapon, p.equip.armor], [4, 1, 1, 'sword_stone', 'tunic_fiber'], 'food, placeable, key item and equipment survive death');
  t.eq([p.hp, p.satiety, state.progress.stats.deaths], [60, 40, 1], 'HP 60, satiety raised to 40, death counted');
  t.ok(!state.enemies.includes(near) && state.enemies.includes(farE), 'enemies near the respawn are cleared, far ones are not');
  go(state, 'surface', camp.x - 8, camp.y + 5);
  grant(state, 'stone', 10); grant(state, 'fiber', 4);
  playerDeath(state);
  const b2 = state.deathBag, tot = Object.fromEntries(b2.items.map((i) => [i.id, i.n]));
  t.ok(b2 !== b1 && b2.x < b1.x && tot.stone === 160 && tot.wood === 20 && tot.branch === 3 && tot.fiber === 4, 'a second death merges the old bag into one new bag', J(tot));

  // collecting with a full bag never loses items
  const free = 30 - p.bag.filter(Boolean).length;
  grant(state, 'path_stone', free * 99);
  go(state, 'surface', tileOf(b2.x), tileOf(b2.y));
  const before = J(b2.items);
  run(state, 1);
  t.ok(state.deathBag && J(state.deathBag.items) === before, 'full bag: dropped bag keeps everything');
  sim.removeItem(state, 'path_stone', 198);
  run(state, 4);
  const inBag = invMap(state), left = Object.fromEntries((state.deathBag ? state.deathBag.items : []).map((i) => [i.id, i.n]));
  const ok = ['stone', 'wood', 'branch', 'fiber'].every((id) => (inBag[id] || 0) + (left[id] || 0) === tot[id]);
  t.ok(ok && state.deathBag, 'with 2 free slots part is collected and the remainder stays in the bag (conserved)', J({ inBag, left }));
  sim.removeItem(state, 'path_stone', sim.countItem(state, 'path_stone'));
  run(state, 4);
  t.ok(state.deathBag === null && sim.countItem(state, 'stone') === 160 && sim.countItem(state, 'wood') === 20 && sim.countItem(state, 'branch') === 3 && sim.countItem(state, 'fiber') === 4, 'once there is room everything is back and the bag is gone');
}

/* ================================================================== campaign: lights, bosses, ending, rematch, life goals */
const keyTotal = (state, id) => sim.countItem(state, id) + groundSum(state, id)
  + Object.values(state.containers).reduce((a, box) => a + box.reduce((b, s) => b + (s && s.id === id ? s.n : 0), 0), 0);

function placeMany(state, type, count, avoid) {
  const camp = state.world.surface.landmarks.camp, anchors = [];
  for (let dy = -16; dy <= 16; dy += 4) for (let dx = -16; dx <= 16; dx += 4) anchors.push([camp.x + dx, camp.y + dy]);
  anchors.sort((a, b) => Math.hypot(a[0] - camp.x, a[1] - camp.y) - Math.hypot(b[0] - camp.x, b[1] - camp.y));
  let placed = 0;
  for (const [ax, ay] of anchors) {
    if (placed >= count) break;
    if (!sim.teleport(state, 'surface', ax, ay)) continue;
    const p = state.player, tx = tileOf(p.x), ty = tileOf(p.y);
    for (let y = ty - 4; y <= ty + 4 && placed < count; y++) for (let x = tx - 4; x <= tx + 4 && placed < count; x++) {
      if (inAny(avoid, x, y) || Math.hypot(cpx(x) - p.x, cpx(y) - p.y) < 42) continue;
      if (!sim.canBuild(state, type, x, y).ok) continue;
      const r = type === 'farm' ? sim.till(state, x, y) : sim.place(state, type, x, y);
      if (r.ok) placed++;
    }
  }
  return placed;
}

async function sCampaign(t) {
  const { world, state } = fresh();
  const p = state.player, u = world.underground, lm = u.landmarks, used = [];
  quiet(state);
  const sealIdx = lm.seal.y * u.w + lm.seal.x, gateIdx = lm.gate.y * u.w + lm.gate.x;
  const ancientRefused = (label, wickInBag) => {
    go(state, 'underground', lm.lighthouse.x, lm.lighthouse.y - 1);
    const had = sim.countItem(state, 'ancient_wick');
    const r = sim.restoreLight(state, 'ancient');
    t.ok(!r.ok && !state.progress.cleared && !state.progress.lights.ancient && sim.countItem(state, 'ancient_wick') === had, `ancient light refused: ${label}`, J(r));
    void wickInBag;
  };

  await t.section('forge light', async (s) => {
    establishForge(state, used);
    s.ok(state.progress.lights.forge, 'forge light restored through the altar');
    s.eq(u.wallKind[sealIdx], WALL.SEAL, 'seal stays closed with only one light');
  });

  await t.section('moss light and vine boss', async (s) => {
    const boss = summonVine(state);
    s.ok(boss.hp === 400, 'vine appears after 3 crystals');
    equip(state, 'sword_iron');
    const dmg = swordDmg(state);
    ancientRefused('no braziers, no boss, seal closed', false);
    go(state, 'underground', 24, 68);
    const half = Math.ceil((boss.maxHp - boss.maxHp / 2) / dmg);
    for (let i = 0; i < half; i++) sim.damageEnemy(state, boss, dmg, 0, 0);
    run(state, 0.4);
    s.ok(boss.phase === 2, 'at <=50% HP the boss enters phase 2', 'hp ' + boss.hp);
    const slimes = state.enemies.filter((e) => e.summoned).length;
    s.ok(slimes >= 1 && slimes <= 4, 'phase 2 summons slimes (max 4)', 'slimes ' + slimes);
    const need = Math.ceil(boss.maxHp / dmg);
    s.eq(killBoss(state, boss, dmg), need - half, 'boss dies on the expected hit (HP 400 / sword damage)');
    s.ok(!state.enemies.some((e) => e.summoned) && state.projectiles.length === 0, 'summons and projectiles are cleaned up on death');
    s.ok(state.progress.bosses.vine && !bossEntity(state, 'vine'), 'boss recorded defeated and removed');
    s.eq([groundSum(state, 'moss_wick'), groundSum(state, 'iron_ore')], [1, 10], 'rewards: 1 wick and 10 iron ore on the ground');
    collectBossLoot(state, ['moss_wick', 'iron_ore']);
    s.ok(runUntil(state, () => sim.countItem(state, 'moss_wick') === 1 && sim.countItem(state, 'iron_ore') === 10, 5) >= 0, 'rewards are picked up');
    s.eq(u.wallKind[sealIdx], WALL.SEAL, 'seal still closed before the moss light');
    go(state, 'underground', lm.mossAltar.x - 1, lm.mossAltar.y + 1);
    s.ok(sim.restoreLight(state, 'moss').ok, 'wick restores the moss light');
    s.eq([sim.countItem(state, 'moss_wick'), state.progress.lights.moss], [0, true], 'wick consumed');
    s.eq(u.wallKind[sealIdx], WALL.NONE, 'forge + moss lights open the seal');
    const seal = u.nodes.find((n) => n.type === 'seal_door');
    s.ok(!sim.nodeAlive(state, seal), 'seal door node is gone');
    run(state, 6);
    s.eq([keyTotal(state, 'moss_wick'), keyTotal(state, 'crystal_moss')], [0, 0], 'no duplicate quest keys appear later');
    const rv = u.nodes.find((n) => n.type === 'return_vine');
    go(state, 'underground', rv.tx, rv.ty);
    sim.interact(state, { kind: 'node', ref: rv });
    s.eq(p.map, 'surface', 'return vine carries the player to the surface');
    const rs = world.surface.nodes.find((n) => n.type === 'return_vine');
    go(state, 'surface', rs.tx, rs.ty);
    sim.interact(state, { kind: 'node', ref: rs });
    s.eq(p.map, 'underground', 'and back down again');
  });

  await t.section('braziers and ash boss', async (s) => {
    const dishes = u.nodes.filter((n) => n.type === 'dish').sort((a, b) => a.meta.dish - b.meta.dish);
    s.eq(dishes.length, 3, 'three dishes exist');
    const dish = (i) => { go(state, 'underground', dishes[i].tx, dishes[i].ty); sim.interact(state, { kind: 'node', ref: dishes[i] }); };
    dish(0);
    s.eq(state.progress.braziers, [false, false, false], 'no oil: dish stays dark');
    grant(state, 'moss_oil', 3);
    dish(0); dish(0);
    s.eq([state.progress.braziers, sim.countItem(state, 'moss_oil')], [[true, false, false], 2], 'one dish costs exactly one oil; relighting costs nothing');
    ancientRefused('only 1 of 3 braziers', false);
    dish(1);
    s.eq(u.wallKind[gateIdx], WALL.GATE, 'arena gate still shut with 2 of 3');
    s.ok(!bossEntity(state, 'ash'), 'ash does not spawn early');
    dish(2);
    s.eq([state.progress.braziers, sim.countItem(state, 'moss_oil'), u.wallKind[gateIdx]], [[true, true, true], 0, WALL.NONE], 'third dish opens the arena gate');
    const ash = bossEntity(state, 'ash');
    s.ok(ash && ash.hp === 700, 'ash boss spawns at full HP');
    ancientRefused('ash still alive', false);
    go(state, 'underground', lm.arena.x, lm.arena.y + 1);
    const per = swordDmg(state) - BOSSES.ash.def, n = Math.ceil(700 / per);
    for (let i = 0; i < n - 1; i++) sim.damageEnemy(state, ash, swordDmg(state), 0, 0);
    s.ok(ash.hp > 0, 'ash survives one hit fewer than needed (armor 4 applies)', 'hp ' + ash.hp);
    sim.damageEnemy(state, ash, swordDmg(state), 0, 0);
    s.ok(ash.hp <= 0 && state.progress.bosses.ash, 'ash falls on the final hit');
    s.eq([groundSum(state, 'ancient_wick'), groundSum(state, 'iron_ore')], [1, 0], 'ash rewards only the ancient wick');
    ancientRefused('wick still lying on the floor', false);
    s.eq(keyTotal(state, 'ancient_wick'), 1, 'refusal does not duplicate the wick');
    collectBossLoot(state, ['ancient_wick']);
    s.ok(runUntil(state, () => sim.countItem(state, 'ancient_wick') === 1, 5) >= 0, 'wick picked up');
  });

  await t.section('save during the late game', async (s) => {
    const saved = JSON.parse(JSON.stringify(sim.serialize(state)));
    const r = sim.validateSave(saved);
    s.ok(r.ok, 'late-game save validates', J(r.errors));
    const w2 = createWorld(), st2 = sim.createState(w2, saved);
    const u2 = w2.underground;
    s.eq([st2.progress.lights, st2.progress.braziers, st2.progress.bosses], [state.progress.lights, state.progress.braziers, state.progress.bosses], 'lights, braziers and bosses survive a reload');
    s.eq([u2.wallKind[sealIdx], u2.wallKind[gateIdx]], [WALL.NONE, WALL.NONE], 'seal and arena gate stay open after reload');
    s.eq(sim.countItem(st2, 'ancient_wick'), 1, 'wick is still in the bag after reload');
  });

  await t.section('ending', async (s) => {
    go(state, 'underground', lm.lighthouse.x, lm.lighthouse.y - 1);
    drain(state);
    const r = sim.restoreLight(state, 'ancient');
    s.ok(r.ok && r.ending, 'all prerequisites met: the ancient light is lit', J(r));
    s.ok(state.progress.cleared && state.progress.lights.ancient && sim.countItem(state, 'ancient_wick') === 0, 'cleared, light on, wick consumed');
    s.ok(drain(state).some((e) => e.type === 'ending'), 'ending event is emitted');
    s.eq(keyTotal(state, 'ancient_wick'), 0, 'no wick left anywhere');
    s.ok(/暮らしの目標/.test(sim.getObjective(state).text), 'after the ending the objective points at life goals', sim.getObjective(state).text);
    checkGoalInvariants(s, state, 'after ending');
  });

  await t.section('boss rematch', async (s) => {
    s.ok(sim.bossRematch(state, 'vine').ok === false, 'rematch refused away from the altar');
    go(state, 'underground', lm.mossAltar.x - 1, lm.mossAltar.y + 1);
    must(sim.bossRematch(state, 'vine'), 'vine rematch');
    s.ok(!sim.bossRematch(state, 'vine').ok && state.enemies.filter((e) => e.bossId === 'vine').length === 1, 'a second request does not duplicate the boss');
    const vine = bossEntity(state, 'vine');
    const ore0 = sim.countItem(state, 'iron_ore') + groundSum(state, 'iron_ore');
    killBoss(state, vine, swordDmg(state));
    s.eq([groundSum(state, 'iron_ore') + sim.countItem(state, 'iron_ore') - ore0, state.progress.stats.rematchVine], [10, true], 'rematch pays 10 iron ore and is recorded');
    go(state, 'underground', lm.lighthouse.x, lm.lighthouse.y - 1);
    must(sim.bossRematch(state, 'ash'), 'ash rematch');
    killBoss(state, bossEntity(state, 'ash'), swordDmg(state));
    s.ok(state.progress.stats.rematchAsh, 'ash rematch recorded');
    run(state, 6);
    s.eq([keyTotal(state, 'moss_wick'), keyTotal(state, 'ancient_wick'), keyTotal(state, 'crystal_moss')], [0, 0, 0], 'rematches create no quest keys');
    s.eq(sim.getLifeGoals(state).find((g) => g.id === 'rematch').value, 2, 'rematch life goal 2/2');
  });

  await t.section('life goals and fountain', async (s) => {
    go(state, 'surface', world.surface.landmarks.camp.x + 1, world.surface.landmarks.camp.y + 3);
    const sites = [...used];
    for (let i = 0; i < 3; i++) { const h = newHouse(state, sites, { margin: 1, maxR: 17 }); void h; }
    s.eq(sim.getLifeGoals(state).find((g) => g.id === 'houses').value, 4, 'four valid houses counted');
    go(state, 'surface', world.surface.landmarks.camp.x + 1, world.surface.landmarks.camp.y + 3);
    ensureStation(state, 'workbench', 'workbench');
    grant(state, 'branch', 2); grant(state, 'stone', 2); grant(state, 'fiber', 2);
    must(sim.craft(state, 'hoe_stone'), 'hoe');
    grant(state, 'iron_bar', 13); grant(state, 'copper_bar', 4); grant(state, 'cloth', 4);
    must(sim.craft(state, 'axe_iron'), 'iron axe'); must(sim.craft(state, 'pick_iron'), 'iron pick'); must(sim.craft(state, 'armor_iron'), 'iron armor');
    ensureStation(state, 'pot', 'pot');
    grant(state, 'mushroom', 4); grant(state, 'moss_potato', 4); grant(state, 'wheat', 5); grant(state, 'berry', 6); grant(state, 'glowmoss', 2); grant(state, 'slime_jelly', 2);
    for (const f of ['roast_mushroom', 'baked_potato', 'wheat_bread', 'forest_stew', 'moss_pie', 'potion']) must(sim.craft(state, f), 'cook ' + f);
    const goal = (id) => sim.getLifeGoals(state).find((g) => g.id === id);
    s.eq([goal('iron').value, goal('foods').value], [4, 6], 'iron gear 4/4 and six dishes');
    grant(state, 'lantern_stone', 8); grant(state, 'path_stone', 60);
    s.eq(placeMany(state, 'farm', 12, sites), 12, 'twelve plots tilled');
    s.eq(placeMany(state, 'lantern_stone', 8, sites), 8, 'eight lanterns placed');
    s.eq(placeMany(state, 'path_stone', 59, sites), 59, '59 road tiles placed');
    tick(state, 12);
    s.eq(goal('roads').value, 59, 'roads 59/60');
    s.ok(!goal('roads').done && sim.countItem(state, 'moss_fountain') === 0, 'one road short: goal open and no fountain yet');
    s.eq(placeMany(state, 'path_stone', 1, sites), 1, 'last road tile');
    tick(state, 12);
    s.eq(Object.values(state.progress.npcs).filter((n) => n.joined).length, 3, 'all three residents moved in');
    checkGoalInvariants(s, state, 'all goals');
    s.ok(sim.getLifeGoals(state).every((g) => g.done), 'all eight goals done', J(sim.getLifeGoals(state)));
    s.eq([sim.countItem(state, 'moss_fountain'), state.progress.fountain], [1, true], 'the fountain is granted exactly once');
    tick(state, 5);
    s.eq(sim.countItem(state, 'moss_fountain'), 1, 'no second fountain later');
    const hs = sim.getHouseStatus(state).houses[0];
    go(state, 'surface', hs.minX + 1, hs.minY + 1);
    sim.remove(state, hs.minX - 1, hs.minY + 1);
    tick(state, 2);
    s.eq(goal('houses').done, true, 'a goal, once reached, stays achieved after a house is broken');
    const rewardSlot=state.player.bag.findIndex(x=>x?.id==='moss_fountain');
    s.ok(sim.dropItem(state,rewardSlot), 'reward can be dropped as an ordinary placeable');
    go(state,'underground',world.underground.landmarks.spawn.x,world.underground.landmarks.spawn.y);
    run(state,BALANCE.items.groundLife+2,{dt:1});
    s.eq(groundSum(state,'moss_fountain'),1,'the unique dropped reward survives ordinary ground expiry');
    const rewardSave=sim.serialize(state),restored=sim.createState(createWorld(),rewardSave);
    quiet(restored);
    s.eq([restored.progress.fountain,groundSum(restored,'moss_fountain')],[true,1],'reward and awarded flag survive save restoration');
    run(restored,BALANCE.items.groundLife+2,{dt:1});
    s.eq(groundSum(restored,'moss_fountain'),1,'restored unique reward also survives ground expiry');
    const reward=restored.groundItems.find(x=>x.item==='moss_fountain');
    go(restored,reward.map,tileOf(reward.x),tileOf(reward.y));
    tick(restored,3);
    s.eq([sim.countItem(restored,'moss_fountain'),groundSum(restored,'moss_fountain')],[1,0],'reward can be picked up without duplication');
    const box=restored.structures.find(x=>x.type==='chest_wood');
    go(restored,box.map,box.x,box.y+1);
    s.ok(sim.transfer(restored,box.id,'bag',restored.player.bag.findIndex(x=>x?.id==='moss_fountain')),'reward can be stored in an ordinary chest');
    s.eq([sim.countItem(restored,'moss_fountain'),restored.containers[box.id].filter(x=>x?.id==='moss_fountain').reduce((n,x)=>n+x.n,0)],[0,1],'chest transfer preserves one reward');
    playerDeath(restored);
    s.eq(restored.containers[box.id].filter(x=>x?.id==='moss_fountain').reduce((n,x)=>n+x.n,0),1,'death does not duplicate or remove a stored reward');
    tick(restored,3);
    s.eq(sim.countItem(restored,'moss_fountain')+groundSum(restored,'moss_fountain'),0,'completed goals do not generate another reward after death');
  });
}

/* ================================================================== save / load */
function baseSave() {
  const { world, state } = fresh();
  grant(state, 'stone', 12); grant(state, 'berry', 3); grant(state, 'wheat_seed', 2);
  equip(state, 'sword_stone');
  sim.step(state, 0.1);
  return { world, state, save: JSON.parse(JSON.stringify(sim.serialize(state))) };
}
const mut = (base, fn) => { const o = JSON.parse(JSON.stringify(base)); fn(o); return o; };

async function sSaveRejects(t) {
  const { world, state, save: base } = baseSave();
  t.ok(sim.validateSave(base).ok, 'a serialized state validates');
  t.eq([base.format, base.version], [SAVE_FORMAT, SAVE_VERSION], 'save carries format and version');
  const deep = {}; let cur = deep; for (let i = 0; i < 40; i++) { cur.a = {}; cur = cur.a; }
  const bigStructs = Array.from({ length: BALANCE.save.maxStructures + 1 }, () => ({}));
  const id1 = base.world.structures[0].id;
  const cases = [
    ['null', null], ['undefined', undefined], ['number', 42], ['string', 'save'], ['array', []], ['empty object', {}],
    ['wrong format', mut(base, (o) => { o.format = 'other'; })],
    ['future version', mut(base, (o) => { o.version = 99; })],
    ['version 0', mut(base, (o) => { o.version = 0; })],
    ['fractional version', mut(base, (o) => { o.version = 1.5; })],
    ['string version', mut(base, (o) => { o.version = '1'; })],
    ['missing player', mut(base, (o) => { delete o.player; })],
    ['missing world', mut(base, (o) => { delete o.world; })],
    ['progress is an array', mut(base, (o) => { o.progress = []; })],
    ['lights is an array', mut(base, (o) => { o.progress.lights = []; })],
    ['light flag is a string', mut(base, (o) => { o.progress.lights.forge = 'yes'; })],
    ['bag is a string', mut(base, (o) => { o.player.bag = 'x'; })],
    ['hp is a string', mut(base, (o) => { o.player.hp = '100'; })],
    ['tools is a number', mut(base, (o) => { o.player.tools = 5; })],
    ['equip is a string', mut(base, (o) => { o.player.equip = 'x'; })],
    ['armor in the weapon slot', mut(base, (o) => { o.player.equip.weapon = 'armor_iron'; })],
    ['sword in the armor slot', mut(base, (o) => { o.player.equip.armor = 'sword_stone'; })],
    ['sword in the trinket slot', mut(base, (o) => { o.player.equip.trinket = 'sword_stone'; })],
    ['numeric equipment id', mut(base, (o) => { o.player.equip.weapon = 12; })],
    ['hotbar is a string', mut(base, (o) => { o.player.hotbar = 'x'; })],
    ['structures is an object', mut(base, (o) => { o.world.structures = {}; })],
    ['crops is a string', mut(base, (o) => { o.world.crops = 'x'; })],
    ['containers is an array', mut(base, (o) => { o.world.containers = []; })],
    ['deathBag is a number', mut(base, (o) => { o.world.deathBag = 5; })],
    ['npcs is an array', mut(base, (o) => { o.progress.npcs = []; })],
    ['braziers is an object', mut(base, (o) => { o.progress.braziers = {}; })],
    ['duplicate structure id', mut(base, (o) => { o.world.structures[1].id = id1; })],
    ['two objects on one tile', mut(base, (o) => { o.world.structures[1].x = o.world.structures[0].x; o.world.structures[1].y = o.world.structures[0].y; })],
    ['structure id 0', mut(base, (o) => { o.world.structures[0].id = 0; })],
    ['chest with too many slots', mut(base, (o) => { o.world.containers[String(o.world.structures[1].id)] = new Array(40).fill(null); })],
    ['garbage mined bits', mut(base, (o) => { o.world.mined = { underground: 'not!base64' }; })],
    ['too many structures', mut(base, (o) => { o.world.structures = bigStructs; })],
    ['too many ground items', mut(base, (o) => { o.world.groundItems = Array.from({ length: 601 }, () => ({ map: 'surface', item: 'stone', n: 1, x: 1, y: 1 })); })],
    ['nesting bomb', mut(base, (o) => { o.player.extra = deep; })],
  ];
  for (const [label, obj] of cases) {
    const before = obj !== null && typeof obj === 'object' ? J(obj) : null;
    let r = null;
    try { r = sim.validateSave(obj); } catch (e) { t.ok(false, `${label}: validateSave must not throw`, errText(e)); continue; }
    t.ok(r.ok === false && r.save === null && Array.isArray(r.errors) && r.errors.length > 0 && typeof r.errors[0] === 'string', `${label}: rejected with a message`, J(r.errors));
    if (before !== null) t.ok(J(obj) === before, `${label}: input object is not modified`);
    if (obj && typeof obj === 'object') {
      const keep = snap(state);
      const s2 = sim.createState(world, obj);
      t.ok(Array.isArray(s2.loadErrors) && s2.loadErrors.length > 0 && s2.player.bag.every((x) => !x) && s2.structures.some((x) => x.type === 'campfire'), `${label}: loading falls back to a clean new game and reports why`);
      t.ok(snap(state) === keep, `${label}: the running state keeps its inventory`);
    }
  }
  t.eq(J(sim.migrateSave(base)), J(base), 'migrateSave leaves a current-version save unchanged');
  t.ok((() => { try { sim.migrateSave(null); sim.migrateSave(5); sim.migrateSave({}); return true; } catch { return false; } })(), 'migrateSave tolerates garbage');
  t.ok(sim.summarizeSave(base) && sim.summarizeSave(base).lights === 0 && sim.summarizeSave({}) === null, 'summarizeSave: valid -> summary, invalid -> null');
}

async function sSaveNormalise(t) {
  const { world, save: base } = baseSave();
  const finiteIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const chk = (label, obj, fn) => {
    const r = sim.validateSave(obj);
    if (!r.ok) { t.ok(true, `${label}: rejected (acceptable)`); return; }
    t.ok(fn(r.save, r), `${label}: normalised into a safe value`, J(r.warnings));
  };
  chk('hp NaN', mut(base, (o) => { o.player.hp = NaN; }), (s) => finiteIn(s.player.hp, 1, 100));
  chk('hp Infinity', mut(base, (o) => { o.player.hp = Infinity; }), (s) => finiteIn(s.player.hp, 1, 100));
  chk('hp huge', mut(base, (o) => { o.player.hp = 1e12; }), (s) => s.player.hp === 100);
  chk('hp negative', mut(base, (o) => { o.player.hp = -50; }), (s) => finiteIn(s.player.hp, 1, 100));
  chk('satiety out of range', mut(base, (o) => { o.player.satiety = 500; }), (s) => s.player.satiety === 100);
  chk('tool tiers out of range', mut(base, (o) => { o.player.tools = { axe: 99, pick: -3, hoe: 5 }; }), (s) => s.player.tools.axe === 3 && s.player.tools.pick === 0 && s.player.tools.hoe === 1);
  chk('crystals out of range', mut(base, (o) => { o.progress.crystalsPlaced = 9; }), (s) => s.progress.crystalsPlaced <= 3);
  chk('negative clock', mut(base, (o) => { o.world.clock = -100; }), (s) => s.world.clock >= 0);
  chk('unknown map', mut(base, (o) => { o.player.map = 'moon'; }), (s) => s.player.map === 'surface');
  chk('prototype keys', JSON.parse(JSON.stringify(base).replace('"player":', '"__proto__":{"evil":1},"player":')), (s, r) => ({}).evil === undefined && s.evil === undefined && r.warnings.length > 0);
  chk('future generation version', mut(base, (o) => { o.genVersion = 7; }), (s, r) => r.warnings.length > 0);
  chk('ancient light without the others', mut(base, (o) => { o.progress.lights.ancient = true; }), (s) => s.progress.lights.forge && s.progress.lights.moss && s.progress.cleared);
  chk('moss light without crystals or boss', mut(base, (o) => { o.progress.lights.moss = true; }), (s) => s.progress.crystalsPlaced === 3 && s.progress.bosses.vine);
  chk('non-material in the dropped bag', mut(base, (o) => { o.world.deathBag = { map: 'surface', x: 100, y: 100, items: [{ id: 'wood', n: 3 }, { id: 'sword_stone', n: 1 }] }; }), (s) => s.world.deathBag && s.world.deathBag.items.length === 1 && s.world.deathBag.items[0].id === 'wood');
  chk('fractional / oversized stack counts', mut(base, (o) => { o.player.bag = [{ id: 'stone', n: 2.7 }, { id: 'wood', n: 5000 }]; }), (s) => {
    const tot = {}; for (const x of s.player.bag) tot[x.id] = (tot[x.id] || 0) + x.n;
    return tot.stone === 2 && tot.wood <= 2970;
  });
  chk('non-positive counts must not create items', mut(base, (o) => { o.player.bag = [{ id: 'stone', n: -5 }, { id: 'wood', n: 0 }]; }), (s) => s.player.bag.every((x) => x.n >= 1) && !s.player.bag.some((x) => x.id === 'stone' || x.id === 'wood'));
  chk('struct outside the map', mut(base, (o) => { o.world.structures.push({ id: 99, type: 'wall_wood', map: 'surface', x: 5000, y: 3, rot: 0 }, { id: 100, type: 'wall_wood', map: 'surface', x: 1.5, y: 3, rot: 0 }); }), (s) => !s.world.structures.some((x) => x.id === 99 || x.id === 100));

  // unknown content: dropped with a count, never an error
  const unk = mut(base, (o) => {
    o.player.bag.push({ id: 'mystery_gem', n: 3 }, { id: '__proto__', n: 1 }, { id: 'constructor', n: 1 }, { id: 'toString', n: 1 });
    o.player.equip.armor = 'armor_mystery';
    o.world.structures.push({ id: 77, type: 'hover_pad', map: 'surface', x: 3, y: 3, rot: 0 });
    o.world.crops = [{ map: 'surface', x: 3, y: 3, kind: 'moonflower', growth: 1, lastClock: 0 }];
  });
  const r = sim.validateSave(unk);
  t.ok(r.ok && r.droppedItems >= 6, 'unknown items/structures/crops are dropped, not fatal', J({ ok: r.ok, dropped: r.droppedItems, errors: r.errors }));
  t.ok(r.unknownIds.includes('mystery_gem') && r.warnings.some((w) => /未知|取り除/.test(w)), 'unknown ids are reported in unknownIds and warnings', J(r.unknownIds));
  t.ok(r.save.player.bag.every((x) => Object.hasOwn(ITEMS, x.id)) && r.save.player.equip.armor === null && !r.save.world.structures.some((x) => x.id === 77), 'only known content is kept');
  const st = sim.createState(world, unk);
  t.ok(sim.countItem(st, 'stone') === 12 && sim.countItem(st, 'mystery_gem') === 0 && st.events.some((e) => e.type === 'msg' && e.tone === 'warn' && /取り除/.test(e.text)), 'loading drops unknown items and tells the player');

  // out-of-range positions end up on walkable ground inside the map
  const positions = [
    ['far outside', { map: 'surface', x: 1e9, y: -1e9 }], ['NaN position', { map: 'surface', x: NaN, y: NaN }],
    ['inside bedrock', { map: 'underground', x: 0, y: 0 }], ['inside a cave wall', { map: 'underground', x: 5 * TILE, y: 3 * TILE }],
  ];
  for (const [label, pos] of positions) {
    const o = mut(base, (x) => { Object.assign(x.player, pos); });
    if (Number.isNaN(pos.x)) { o.player.x = NaN; o.player.y = NaN; }
    const rr = sim.validateSave(o);
    if (!rr.ok) { t.ok(true, `${label}: rejected (acceptable)`); continue; }
    const s = sim.createState(world, o), p = s.player, m = s.world.maps[p.map];
    const tx = tileOf(p.x), ty = tileOf(p.y);
    t.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && isWalkable(m, tx, ty), `${label}: player is placed on walkable ground inside the map`, `${p.map} ${p.x},${p.y}`);
  }
}

async function sSaveRoundTrip(t) {
  const { world, state } = fresh();
  const p = state.player, used = [];
  setupHoe(state);
  const h = newHouse(state, used);
  offerForge(state);
  go(state, 'surface', h.stand[0], h.stand[1]);
  const [px, py] = findPlot(state, used);
  must(sim.till(state, px, py), 'till');
  grant(state, 'moss_potato', 1);
  must(sim.plant(state, 'moss_potato', px, py), 'plant');
  run(state, 50, { dt: 1 });
  run(state, 12, { dt: 0.5 });
  const g = nearestNodes(state, 'grass', 1)[0];
  sim.interact(state, { kind: 'node', ref: g });
  const chest = state.structures.find((s) => s.type === 'chest_wood');
  go(state, 'surface', chest.x, chest.y + 1);
  sim.transfer(state, chest.id, 'box', 0);
  // mine a wall underground
  const dw = findWallBy(world.underground, WALL.DIRT);
  go(state, 'underground', dw.nx, dw.ny);
  grant(state, 'branch', 3); grant(state, 'stone', 3); grant(state, 'fiber', 2);
  must(sim.craft(state, 'pick_stone'), 'pick');
  while (world.underground.wallKind[dw.y * world.underground.w + dw.x] === WALL.DIRT) sim.interact(state, { kind: 'wall', ref: { tx: dw.x, ty: dw.y, wall: WALL.DIRT } });
  go(state, 'surface', h.stand[0], h.stand[1]);
  grant(state, 'stone', 60); grant(state, 'wood', 30); grant(state, 'berry', 5);
  equip(state, 'sword_stone');
  playerDeath(state); // creates a dropped bag
  grant(state, 'stone', 40); grant(state, 'berry', 2);
  sim.spawnGround(state, 'surface', p.x + 64, p.y, 'fiber', 3);
  state.groundItems[state.groundItems.length - 1].vx = 0; state.groundItems[state.groundItems.length - 1].vy = 0;
  const saved = JSON.parse(JSON.stringify(sim.serialize(state)));
  const v = sim.validateSave(saved);
  t.ok(v.ok, 'rich state validates', J(v.errors));

  const w2 = createWorld(), s2 = sim.createState(w2, saved);
  t.ok(!s2.loadErrors, 'rich state loads without errors', J(s2.loadErrors));
  const key = (s) => `${s.type}@${s.map}:${s.x},${s.y}r${s.rot || 0}#${s.id}`;
  t.eq(s2.structures.map(key).sort(), state.structures.map(key).sort(), 'every structure (house, bench, chest, campfire) is restored with its id');
  t.eq(J(invMap(s2)), J(invMap(state)), 'bag contents are identical');
  t.eq([s2.player.equip, s2.player.tools, s2.player.hotbar], [p.equip, p.tools, p.hotbar], 'equipment, tool tiers and hotbar are identical');
  t.eq([s2.player.hp, s2.player.satiety, s2.player.map], [p.hp, p.satiety, p.map], 'vitals and map are identical');
  t.ok(Math.abs(s2.player.x - p.x) < 1 && Math.abs(s2.player.y - p.y) < 1, 'player position is restored');
  t.ok(Math.abs(s2.time.clock - state.time.clock) < 1e-6 && s2.time.day === state.time.day, 'clock and day are restored');
  const c1 = state.crops[0], c2 = s2.crops[0];
  t.ok(c2 && c2.kind === c1.kind && c2.x === c1.x && Math.abs(c2.growth - c1.growth) < 1e-6 && c2.lastClock <= s2.time.clock, 'crop and its growth are restored');
  t.eq(s2.farmland.length, state.farmland.length, 'tilled plots are restored');
  t.eq(J(s2.containers[chest.id]), J(state.containers[chest.id]), 'chest contents (seeds taken) are restored');
  t.eq(J(s2.deathBag), J(state.deathBag), 'the dropped bag is restored');
  t.eq(s2.groundItems.map((x) => `${x.item}:${x.n}`).sort(), state.groundItems.map((x) => `${x.item}:${x.n}`).sort(), 'items on the ground are restored');
  const nk = `surface:${g.tx},${g.ty}`;
  t.ok(s2.nodes.get(nk) && !sim.nodeAlive(s2, g) || !sim.nodeAlive(s2, w2.surface.nodes.find((n) => n.key === nk)), 'the harvested plant is still depleted after loading');
  const di = dw.y * w2.underground.w + dw.x;
  t.ok(w2.underground.wallKind[di] === WALL.NONE && s2.mined.underground[di] === 1, 'the mined wall is still open after loading');
  t.eq([s2.progress.lights, s2.progress.npcs.cook.joined, J(s2.progress.npcs.cook.basket)], [state.progress.lights, true, J(state.progress.npcs.cook.basket)], 'forge light and the resident are restored');
  const hs = sim.getHouseStatus(s2);
  t.eq([hs.valid, hs.total], [1, 1], 'the house is valid again right after loading');
  tick(s2, 1);
  t.ok(s2.npcs.some((n) => n.id === 'cook' && n.active), 'the resident is back in the house after one step');
  const camp = w2.surface.landmarks.camp;
  t.ok(sim.inSafeZone(s2, cpx(camp.x) + 16 * TILE, cpx(camp.y)), 'the widened safe zone is restored');
  const again = sim.serialize(s2), orig = sim.serialize(state);
  t.eq(again.world.structures.map(key).sort(), orig.world.structures.map(key).sort(), 'serialize(load(save)) keeps the structures');
  t.eq(again.player.bag.map((x) => `${x.id}:${x.n}`).sort(), orig.player.bag.map((x) => `${x.id}:${x.n}`).sort(), 'serialize(load(save)) keeps the bag');
  const fresh0 = sim.createState(createWorld());
  t.ok(fresh0.progress.lights.forge === false && fresh0.structures.length === 2, 'a new game after loading starts clean');
}

/* ================================================================== runner */
export const SCENARIOS = [
  ['baseline', sBaseline],
  ['gathering by real input and the stone axe', sGather],
  ['tool tiers: trees, rocks, deposits', sToolTiers],
  ['underground walls and protected tiles', sWalls],
  ['bag capacity, stacks and atomic removal', sBag],
  ['crafting stations and atomic crafts', sCraft],
  ['placement, refusal and demolition', sBuild],
  ['house validity and invalid enclosures', sHouses],
  ['farming and growth', sFarming],
  ['sleep and respawn point', sSleep],
  ['three residents and baskets', sResidents],
  ['forge altar', sForge],
  ['moss crystals and vine summon', sMoss],
  ['boss telegraph, dodge, death', sBossCombat],
  ['dropped bag merge and collection', sDeathBag],
  ['campaign: lights, bosses, ending, rematch, goals', sCampaign],
  ['save rejects corrupt data', sSaveRejects],
  ['save normalises and drops unknown content', sSaveNormalise],
  ['save round trip', sSaveRoundTrip],
];

// options: {only: name|name[], onProgress(name, checks)}
export async function runGameTests(options = {}) {
  const checks = [], durations = {};
  const only = options.only ? [].concat(options.only) : null;
  for (const [name, fn] of SCENARIOS) {
    if (only && !only.includes(name)) continue;
    const t = makeT(name, checks);
    const t0 = now();
    try { await fn(t); } catch (e) { checks.push({ name: `${name}: scenario threw`, ok: false, detail: errText(e) }); }
    durations[name] = Math.round(now() - t0);
    if (options.onProgress) { try { options.onProgress(name, checks); } catch { /* ignore */ } }
    await new Promise((r) => setTimeout(r, 0));
  }
  const failed = checks.filter((c) => !c.ok).length;
  return { passed: checks.length - failed, failed, checks, durations };
}
