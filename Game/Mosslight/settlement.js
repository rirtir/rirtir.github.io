// 畑・住居・住人・炉の灯・生活目標。simulationのサービスは引数 api で受け取り、循環importを防ぐ。
//   api: { countItem, addItem, removeItem, spawnGround, nodeAlive, onSleep? }
import { BALANCE, TILE, TERRAIN as T, CROPS, NPCS, STRUCTURES, LIGHTS, ITEMS, GROWTH_LIGHTS } from './data.js';
import { getTile, nodeAt } from './world.js';
import {
  objectAt, floorAt, farmAt, cropAt, addFarmRecord, removeFarmRecord, addCropRecord, removeCropRecord,
} from './layers.js';

const P = BALANCE.player;
const DAY = BALANCE.day.length;
const NPC_IDS = ['cook', 'farmer', 'builder'];
const TILLABLE = new Set([T.GRASS, T.DARKGRASS, T.DIRT, T.MOSS, T.PATH]);
const LAMPS = new Set(GROWTH_LIGHTS);
const HOUSE_LIGHTS = new Set(['candlestick', 'lantern_stone']);

const cellCenter = (x, y) => ({ x: x * TILE + 16, y: y * TILE + 16 });
const notice = (state, text, tone = 'info') => { state.events.push({ type: 'msg', text, tone }); };
const now = (state) => state.time.clock;
const near = (state, x, y, range) => {
  const c = cellCenter(x, y);
  return Math.hypot(c.x - state.player.x, c.y - state.player.y) <= range;
};

export function initializeSettlement(state) {
  state.crops ||= []; state.farmland ||= []; state.houses ||= []; state.npcs ||= [];
  state.progress.npcs ||= {};
  state.progress.stats.foods ||= {};
  state.timers.housing = 0; state.timers.crops = 0;
}

/* ------------------------------------------------------------------ 畑 */
export function cropRipeTime(crop) { const d = CROPS[crop.kind]; return d.stages * d.stageTime; }
export function cropRipe(crop) { return crop.growth >= cropRipeTime(crop); }
// 0..stages(最後が収穫できる段階)
export function cropStage(crop) { const d = CROPS[crop.kind]; return Math.min(d.stages, Math.floor(crop.growth / d.stageTime)); }

export function isTillableTile(map, x, y) {
  return x >= 0 && y >= 0 && x < map.w && y < map.h && TILLABLE.has(getTile(map, x, y));
}

export function canTill(state, x, y) {
  const p = state.player, map = state.world.surface;
  if (p.map !== 'surface') return { ok: false, reason: '畑は地上に作ろう' };
  if (!(p.tools.hoe > 0)) return { ok: false, reason: '作業台で石の鍬を作ろう' };
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return { ok: false, reason: 'ここは耕せない' };
  if (!near(state, x, y, P.buildRange)) return { ok: false, reason: '遠すぎる' };
  if (!isTillableTile(map, x, y)) return { ok: false, reason: 'この地面は耕せない' };
  if (farmAt(state, 'surface', x, y)) return { ok: false, reason: 'もう耕してある', existing: true };
  if (objectAt(state, 'surface', x, y) || floorAt(state, 'surface', x, y)) return { ok: false, reason: '設備をどけてから耕そう' };
  const n = nodeAt(map, x, y);
  if (n && state.nodes && !(state.nodes.get(n.key) && state.nodes.get(n.key).respawnAt != null)) return { ok: false, reason: '先に草や石を採集しよう' };
  if (state.farmland.length >= BALANCE.save.maxFarm) return { ok: false, reason: '畑が多すぎる' };
  return { ok: true, reason: '' };
}

export function till(state, x, y) {
  const chk = canTill(state, x, y);
  if (!chk.ok) return chk;
  addFarmRecord(state, 'surface', x, y);
  const c = cellCenter(x, y);
  state.progress.stats.tilled = (state.progress.stats.tilled || 0) + 1;
  state.events.push({ type: 'place', x: c.x, y: c.y, structure: 'farm' });
  notice(state, '地面を耕した。灯麦の種か苔芋を植えよう', 'good');
  return { ok: true };
}

export function canPlant(state, kind, x, y, api) {
  const def = CROPS[kind], p = state.player;
  if (!def) return { ok: false, reason: '植えるものを選ぼう' };
  if (p.map !== 'surface' || !farmAt(state, 'surface', x, y)) return { ok: false, reason: '先に鍬で耕そう' };
  if (!near(state, x, y, P.buildRange)) return { ok: false, reason: '遠すぎる' };
  if (cropAt(state, 'surface', x, y)) return { ok: false, reason: 'すでに育っている' };
  if (api.countItem(state, def.seed) < 1) return { ok: false, reason: `${ITEMS[def.seed].name}が必要` };
  return { ok: true, reason: '' };
}

export function plant(state, kind, x, y, api) {
  const chk = canPlant(state, kind, x, y, api);
  if (!chk.ok) return chk;
  api.removeItem(state, CROPS[kind].seed, 1);
  addCropRecord(state, { map: 'surface', x, y, kind, growth: 0, lastClock: now(state) });
  state.progress.stats.planted = (state.progress.stats.planted || 0) + 1;
  const c = cellCenter(x, y);
  state.events.push({ type: 'plant', x: c.x, y: c.y });
  notice(state, `${CROPS[kind].name}を植えた`, 'good');
  return { ok: true };
}

function deliver(state, items, map, x, y, api) {
  for (const { item, n } of items) {
    const left = api.addItem(state, item, n);
    if (left > 0) api.spawnGround(state, map, x, y, item, left);
  }
}

// 収穫。種を持っていれば同じ作物を植え直す
export function harvest(state, crop, api) {
  if (!crop || state.cropIndex[crop.map].get(crop.y * state.world.maps[crop.map].w + crop.x) !== crop) return { ok: false, reason: 'ここには作物がない' };
  if (!cropRipe(crop)) return { ok: false, reason: 'まだ育っている' };
  const c = cellCenter(crop.x, crop.y);
  if (crop.map !== state.player.map || !near(state, crop.x, crop.y, P.reach + 16)) return { ok: false, reason: '畑に近づこう' };
  const def = CROPS[crop.kind];
  deliver(state, def.harvest, crop.map, c.x, c.y, api);
  removeCropRecord(state, crop);
  state.progress.stats.harvested = (state.progress.stats.harvested || 0) + 1;
  let replanted = false;
  if (api.countItem(state, def.seed) >= 1) {
    api.removeItem(state, def.seed, 1);
    addCropRecord(state, { map: crop.map, x: crop.x, y: crop.y, kind: crop.kind, growth: 0, lastClock: now(state) });
    replanted = true;
  }
  state.events.push({ type: 'harvest', x: c.x, y: c.y });
  notice(state, replanted ? `${def.name}を収穫して植え直した` : `${def.name}を収穫した`, 'good');
  return { ok: true, replanted };
}

// 畑を取り壊す。育成中なら種、成熟済みなら収穫物を返す。
export function removeFarm(state, x, y, api) {
  const f = farmAt(state, 'surface', x, y);
  if (!f) return { ok: false, reason: '取り壊すものがない' };
  if (!near(state, x, y, P.buildRange)) return { ok: false, reason: '遠すぎる' };
  const crop = cropAt(state, 'surface', x, y);
  if (crop) {
    const def = CROPS[crop.kind];
    deliver(state, cropRipe(crop) ? def.harvest : [{ item: def.seed, n: 1 }], 'surface', state.player.x, state.player.y, api);
    removeCropRecord(state, crop);
  }
  removeFarmRecord(state, f);
  const c = cellCenter(x, y);
  state.events.push({ type: 'remove', x: c.x, y: c.y, structure: 'farm' });
  return { ok: true };
}

// 作物の成長。clock の経過に比例するので、睡眠でスキップした時間も反映される
function updateCrops(state) {
  const time = now(state);
  if (!state.crops.length) return;
  const lamps = state.structures.filter((s) => s.map === 'surface' && LAMPS.has(s.type));
  for (const crop of state.crops) {
    const def = CROPS[crop.kind];
    if (!def) continue;
    const elapsed = Math.max(0, time - (crop.lastClock ?? time));
    crop.lastClock = time;
    if (cropRipe(crop)) continue;
    const range = BALANCE.crops.lightRange;
    const lit = lamps.some((s) => Math.abs(s.x - crop.x) <= range && Math.abs(s.y - crop.y) <= range && Math.hypot(s.x - crop.x, s.y - crop.y) <= range);
    const before = cropStage(crop);
    crop.growth = Math.min(cropRipeTime(crop), crop.growth + elapsed * (lit ? BALANCE.crops.lightBoost : 1));
    if (cropStage(crop) !== before) state.rev++;
  }
}

/* ------------------------------------------------------------------ 安全圏 */
export function safeRadius(state) { return state.progress.lights.forge ? BALANCE.safe.radiusAfterForge : BALANCE.safe.radius; }

export function inSafeZone(state, map, x, y, extra = 0) {
  const c = state.world.surface.landmarks.camp;
  return map === 'surface' && Math.hypot(x - (c.x * TILE + 16), y - (c.y * TILE + 16)) < (safeRadius(state) + extra) * TILE;
}

/* ------------------------------------------------------------------ 家判定 */
// ベッドごとに部屋を調べる。壁・扉・地形・資源が境界。床は物体と別の層なので、家具の下の床も数える。
function scanRoom(state, map, bed, visited) {
  const W = map.w;
  const startKey = bed.y * W + bed.x;
  const seen = new Set([startKey]);
  const queue = [[bed.x, bed.y]];
  const cells = [], doors = new Map(), lights = [];
  let leaks = false, allFloor = true, overflow = false;
  for (let q = 0; q < queue.length; q++) {
    const [x, y] = queue[q];
    if (cells.length >= 65) { overflow = true; break; }
    cells.push([x, y]);
    visited.add(y * W + x);
    const floor = floorAt(state, 'surface', x, y);
    if (!floor || floor.type !== 'floor_wood') allFloor = false;
    const obj = objectAt(state, 'surface', x, y);
    if (obj && HOUSE_LIGHTS.has(obj.type)) lights.push(obj.id);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= map.h) { leaks = true; continue; }
      const ni = ny * W + nx;
      if (seen.has(ni)) continue;
      const o = objectAt(state, 'surface', nx, ny);
      const kind = o ? STRUCTURES[o.type].kind : null;
      if (kind === 'wall') continue;
      if (kind === 'door') { doors.set(o.id, o); continue; }
      if (kind === 'fence') { leaks = true; continue; }
      const t = getTile(map, nx, ny);
      if (t === T.CLIFF || t === T.DEEP) continue;
      seen.add(ni);
      queue.push([nx, ny]);
    }
  }
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const enclosed = !overflow && !leaks;
  const large = cells.length >= 9 && cells.length <= 64 && maxX - minX >= 2 && maxY - minY >= 2;
  const valid = enclosed && allFloor && large && doors.size > 0 && lights.length > 0;
  const c = cellCenter((minX + maxX) / 2, (minY + maxY) / 2);
  const reasons = [];
  if (!enclosed) reasons.push(overflow ? '壁と扉で囲む（室内は64マス以下）' : '壁か扉で隙間なく囲む（柵は壁にならない）');
  if (!allFloor) reasons.push('室内すべてに木の床を敷く');
  if (enclosed && !large) reasons.push('室内を3×3以上・64マス以下にする');
  if (!doors.size) reasons.push('扉をつける');
  if (!lights.length) reasons.push('室内に燭台か灯籠を置く');
  return {
    id: `house:${minX},${minY}`, map: 'surface', cells: overflow ? cells.slice(0, 64) : cells, bed: bed.id,
    doors: [...doors.keys()], lights, minX, maxX, minY, maxY, x: c.x, y: c.y, valid, reasons,
    safe: inSafeZone(state, 'surface', c.x, c.y), cellSet: seen,
    doorPoints: [...doors.values()].map((d) => cellCenter(d.x, d.y)),
  };
}

export function evaluateHouses(state) {
  const map = state.world.surface, visited = new Set(), houses = [];
  for (const bed of state.structures) {
    if (bed.type !== 'bed' || bed.map !== 'surface' || visited.has(bed.y * map.w + bed.x)) continue;
    houses.push(scanRoom(state, map, bed, visited));
  }
  state.houses = houses;
  state.houseRev = state.structRev;
  return houses;
}

export function houseStatus(state) {
  return { valid: state.houses.filter((h) => h.valid).length, total: state.houses.length, houses: state.houses };
}

/* ------------------------------------------------------------------ 睡眠 */
export function sleep(state, bed, api) {
  evaluateHouses(state);
  const house = state.houses.find((h) => h.valid && h.bed === bed.id);
  if (!house) return { ok: false, reason: '壁・扉・3×3の床・灯りを備えた家で休もう' };
  const tod = now(state) % DAY;
  if (tod < BALANCE.day.sleepFrom) return { ok: false, reason: '夕方から眠れる。今はもう少し探索しよう' };
  const old = now(state);
  state.time.clock += DAY - tod + BALANCE.day.sleepTo;
  state.time.day = 1 + Math.floor(now(state) / DAY);
  const p = state.player;
  p.spawn = { map: bed.map, x: house.x, y: house.y };
  p.hp = P.hpMax;
  p.satiety = Math.max(0, p.satiety - BALANCE.hunger.sleepCost);
  updateCrops(state);
  updateResidents(state, now(state) - old, api);
  if (api.onSleep) api.onSleep(state);
  state.rev++;
  state.events.push({ type: 'sleep' }, { type: 'save' });
  notice(state, '朝まで休んだ。ここが復活地点になった', 'good');
  return { ok: true };
}

/* ------------------------------------------------------------------ 住人 */
const tileOf = (map, x, y) => Math.floor(y / TILE) * map.w + Math.floor(x / TILE);

function waitingSpot(state, index) {
  const camp = state.world.surface.landmarks.camp;
  return cellCenter(camp.x - 1 + index, camp.y + 2 + (index % 2) * 0.6);
}

function stepToward(res, dest, dt) {
  const dx = dest.x - res.x, dy = dest.y - res.y, d = Math.hypot(dx, dy);
  res.moving = d > 0.5;
  if (!res.moving) return;
  const s = Math.min(d, dt * BALANCE.npc.speed);
  res.x += dx / d * s; res.y += dy / d * s;
  res.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

// 住人は安全圏の外へ出さない
function clampToSafe(state, res) {
  const c = state.world.surface.landmarks.camp, cx = c.x * TILE + 16, cy = c.y * TILE + 16;
  const max = safeRadius(state) * TILE - 12;
  const d = Math.hypot(res.x - cx, res.y - cy);
  if (d > max) { res.x = cx + (res.x - cx) / d * max; res.y = cy + (res.y - cy) / d * max; }
}

function updateResidents(state, dt, api) {
  const map = state.world.surface;
  const eligible = state.houses.filter((h) => h.valid && h.safe);
  const used = new Set(), residents = [];
  NPC_IDS.forEach((id, index) => {
    const def = NPCS[id];
    let record = state.progress.npcs[id];
    const available = eligible.length >= def.houses && (!def.plots || state.farmland.length >= def.plots) && (!def.needLight || state.progress.lights[def.needLight]);
    if (!record) {
      if (!available) return;
      record = state.progress.npcs[id] = { arrivingAt: now(state) + NPCS.arriveDelay, joined: false, basket: {}, lastProduced: now(state), house: null };
    }
    if (!record.joined) {
      if (!available) { delete state.progress.npcs[id]; return; }
      if (now(state) < record.arrivingAt) return;
      record.joined = true; record.lastProduced = now(state);
      notice(state, `${def.name}がやって来た。話しかけてみよう`, 'good');
      state.events.push({ type: 'arrival', id }, { type: 'save' });
      state.rev++;
    }
    const house = eligible.find((h) => h.id === record.house && !used.has(h.id)) || eligible.find((h) => !used.has(h.id)) || null;
    record.house = house ? house.id : null;
    if (house) used.add(house.id);
    const prev = state.npcs.find((n) => n.id === id);
    const spot = waitingSpot(state, index);
    const res = {
      id, name: def.name, sprite: def.sprite, tint: def.tint, map: 'surface', x: prev ? prev.x : spot.x, y: prev ? prev.y : spot.y,
      dir: prev ? prev.dir : 'down', moving: false, house: record.house, basket: record.basket, active: !!house, viaDone: prev ? prev.viaDone : false,
    };
    if (!house) {
      // 家がなければ焚き火のそばで待ち、生産は止める
      record.lastProduced = now(state);
      stepToward(res, spot, dt);
      res.viaDone = false;
    } else {
      let dest;
      if (now(state) % DAY >= BALANCE.day.night[0]) {
        const bed = state.structures.find((s) => s.id === house.bed);
        dest = bed ? cellCenter(bed.x, bed.y) : { x: house.x, y: house.y };
        res.sleeping = true;
      } else {
        const a = now(state) * 0.065 + def.houses * 2;
        dest = { x: house.x + Math.sin(a) * 14, y: house.y + Math.cos(a) * 8 };
      }
      const inside = house.cellSet.has(tileOf(map, res.x, res.y));
      if (inside) res.viaDone = true;
      if (!inside && !res.viaDone && house.doorPoints.length) {
        const door = house.doorPoints.reduce((b, d) => (Math.hypot(d.x - res.x, d.y - res.y) < Math.hypot(b.x - res.x, b.y - res.y) ? d : b));
        if (Math.hypot(door.x - res.x, door.y - res.y) > 6) dest = door; else res.viaDone = true;
      }
      stepToward(res, dest, dt);
      produce(state, id, def, record, res);
    }
    clampToSafe(state, res);
    residents.push(res);
  });
  state.npcs = residents;
}

// 生産は住居が有効な間だけ進む
function produce(state, id, def, record) {
  const camp = state.world.surface.landmarks.camp;
  const elapsed = Math.max(0, now(state) - record.lastProduced);
  if (id === 'farmer') {
    if (elapsed < def.every) return;
    record.lastProduced = now(state);
    const total = Object.values(record.basket).reduce((a, b) => a + b, 0);
    if (total >= def.cap) return;
    const r = safeRadius(state);
    const crop = state.crops.find((c) => cropRipe(c) && Math.hypot(c.x - camp.x, c.y - camp.y) < r);
    if (!crop) return;
    const cdef = CROPS[crop.kind];
    for (const drop of cdef.harvest) {
      const n = drop.n - (drop.item === cdef.seed ? 1 : 0);
      record.basket[drop.item] = Math.min(def.cap, (record.basket[drop.item] || 0) + Math.max(0, n));
    }
    crop.growth = 0; crop.lastClock = now(state);
    state.rev++;
  } else if (def.produce) {
    const every = Array.isArray(def.produce) ? def.every : def.produce.every || def.every;
    const count = Math.min(20, Math.floor(elapsed / every));
    if (!count) return;
    record.lastProduced += count * every;
    for (const p of [].concat(def.produce)) record.basket[p.item] = Math.min(p.cap, (record.basket[p.item] || 0) + (p.n || 1) * count);
    state.rev++;
  }
}

export function collectResident(state, id, api) {
  const res = state.npcs.find((n) => n.id === id), record = state.progress.npcs[id];
  if (!res || !record) return { ok: false, reason: 'まだ来ていない' };
  if (state.player.map !== 'surface' || Math.hypot(res.x - state.player.x, res.y - state.player.y) > P.stationRange + 16) return { ok: false, reason: '住人に近づこう' };
  const got = [];
  for (const [item, count] of Object.entries(record.basket)) {
    if (!(count > 0) || !ITEMS[item]) continue;
    const left = api.addItem(state, item, count);
    record.basket[item] = left;
    if (count - left > 0) got.push(`${ITEMS[item].name}×${count - left}`);
  }
  if (got.length) notice(state, `${res.name}から ${got.join('、')} を受け取った`, 'good');
  else notice(state, res.active ? '「暮らしの支度を続けています。しばらくしたらまた来てね」' : '「家が整うまで、ここで待っています」');
  state.rev++;
  return { ok: true, items: got };
}

/* ------------------------------------------------------------------ 炉の灯 */
export function forgeProblem(state, api) {
  if (state.progress.lights.forge) return null;
  evaluateHouses(state);
  if (!state.houses.some((h) => h.valid && h.safe)) return '安全圏に、壁・扉・3×3の床・ベッド・灯りを備えた家を1軒作ろう';
  for (const { item, n } of LIGHTS.forge.offer) {
    const have = api.countItem(state, item);
    if (have < n) return `${ITEMS[item].name} ${have}/${n}。制作で用意しよう`;
  }
  return null;
}

export function restoreForge(state, api) {
  if (state.progress.lights.forge) return { ok: true, already: true };
  const problem = forgeProblem(state, api);
  if (problem) return { ok: false, reason: problem };
  for (const { item, n } of LIGHTS.forge.offer) api.removeItem(state, item, n);
  state.progress.lights.forge = true;
  state.rev++;
  state.events.push({ type: 'light', id: 'forge' }, { type: 'save' });
  notice(state, '炉の灯を取り戻した。拠点の安全圏が広がった', 'good');
  return { ok: true };
}

/* ------------------------------------------------------------------ 生活目標 */
const hasItem = (state, id) => state.player.equip.weapon === id || state.player.equip.armor === id || state.player.bag.some((s) => s && s.id === id);

export function lifeGoals(state) {
  const structs = state.structures, stats = state.progress.stats;
  const count = (type) => structs.reduce((n, s) => n + (s.type === type ? 1 : 0), 0);
  const tools = state.player.tools;
  const goals = [
    { id: 'houses', text: '家を4軒建てる', value: state.houses.filter((h) => h.valid).length, target: 4 },
    { id: 'lanterns', text: '灯籠を8基置く', value: count('lantern_stone'), target: 8 },
    { id: 'farms', text: '畑を12区画耕す', value: state.farmland.length, target: 12 },
    { id: 'foods', text: '料理を6種類作る', value: Object.keys(stats.foods || {}).length, target: 6 },
    { id: 'residents', text: '住人3人を迎える', value: Object.values(state.progress.npcs).filter((n) => n && n.joined).length, target: 3 },
    { id: 'roads', text: '石畳を60マス敷く', value: count('path_stone'), target: 60 },
    {
      id: 'iron', text: '翠鉄の道具と武具を揃える',
      value: (tools.axe >= 3 ? 1 : 0) + (tools.pick >= 3 ? 1 : 0) + (hasItem(state, 'sword_iron') ? 1 : 0) + (hasItem(state, 'armor_iron') ? 1 : 0), target: 4,
    },
    { id: 'rematch', text: '両方のボスを再び鎮める', value: (stats.rematchVine ? 1 : 0) + (stats.rematchAsh ? 1 : 0), target: 2 },
  ];
  for (const g of goals) {
    g.done = !!state.progress.goals[g.id] || g.value >= g.target;
    if (state.progress.goals[g.id]) g.value = g.target;
    g.value = Math.min(g.value, g.target);
  }
  return goals;
}

// 達成は一度きりで保存される(家が壊れても取り消さない)。全8項目で「苔灯の噴水」を贈る
export function updateGoals(state, api) {
  const goals = lifeGoals(state);
  for (const g of goals) {
    if (g.done && !state.progress.goals[g.id]) {
      state.progress.goals[g.id] = true;
      state.events.push({ type: 'goal', id: g.id });
      notice(state, `暮らしの目標を達成：${g.text}`, 'good');
      state.rev++;
    }
  }
  if (!state.progress.fountain && goals.every((g) => g.done)) {
    state.progress.fountain = true;
    const left = api.addItem(state, 'moss_fountain', 1);
    if (left > 0) api.spawnGround(state, state.player.map, state.player.x, state.player.y, 'moss_fountain', left);
    state.events.push({ type: 'save' });
    notice(state, '暮らしの目標をすべて達成した。「苔灯の噴水」を贈られた。好きな場所に置こう', 'good');
  }
  return goals;
}

/* ------------------------------------------------------------------ ステップ */
export function stepSettlement(state, dt, api) {
  if (!state.crops || !state.farmland) initializeSettlement(state);
  state.timers.crops += dt;
  if (state.timers.crops >= 1) { state.timers.crops = 0; updateCrops(state); }
  state.timers.housing -= dt;
  if (state.timers.housing <= 0 || state.houseRev !== state.structRev) {
    state.timers.housing = 0.5;
    evaluateHouses(state);
  }
  updateResidents(state, dt, api);
}

// 読み込み直後などに、作物の時刻基準を現在の clock へ揃える
export function syncCropClock(state) {
  for (const c of state.crops) if (!(c.lastClock <= now(state))) c.lastClock = now(state);
}
