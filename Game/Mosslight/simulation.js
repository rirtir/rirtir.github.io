// 苔灯の境 / MOSSLIGHT — 状態と全システムの統合
// 依存: data.js, world.js, layers.js, settlement.js, combat.js, progression.js, save.js(いずれも循環importなし)。
// 出来事(音・演出・UI)は state.events に積み、main.js が取り出して配る。
//
// step(state, dt, input) の input:
//   moveX, moveY   -1..1 の移動入力
//   aim            {x,y} マウスの世界座標(なければnull) / aimActive: マウスで狙っているか
//   act, actPressed  行動ボタン(E/Space/左クリック)の押下中・押した瞬間
//   cancelPressed  右クリック等(建築モード・ホットバー選択の解除)
//   dodgePressed   回避
//   removePressed  取り壊し(X)
//   rotatePressed  回転(R)
//   slot           0..7 ホットバー番号キー(なければ-1/undefined)  wheel: -1/0/1
import {
  BALANCE, TILE, TERRAIN_INFO, ITEMS, RECIPE_BY_ID, STATIONS, NODES, STRUCTURES, CAMP_LAYOUT, CROPS, WALL, WALL_NODE,
} from './data.js';
import {
  getTile, nodeAt, solidRadius, canPlace, findWalkableNear, mulberry32, openWallTile, resetWorldTerrain, isBuildTerrain,
} from './world.js';
import {
  createIndexes, objectAt, floorAt, structureAt, farmAt, addStructureRecord, removeStructureRecord,
  addFarmRecord, addCropRecord,
} from './layers.js';
import * as settlement from './settlement.js';
import * as combat from './combat.js';
import * as progression from './progression.js';
import { validateSave as validateSaveData, migrateSave, encodeBits, decodeBits, SAVE_VERSION, SAVE_FORMAT, summarizeSave } from './save.js';

const P = BALANCE.player;
const EMPTY = Object.freeze({});

export { structureAt, objectAt, floorAt, migrateSave, summarizeSave };
export { damageEnemy } from './combat.js';

export const TOOL_ITEMS = {
  axe: ['', 'axe_stone', 'axe_copper', 'axe_iron'],
  pick: ['', 'pick_stone', 'pick_copper', 'pick_iron'],
  hoe: ['', 'hoe_stone'],
};
const TOOL_JP = { axe: '斧', pick: 'ツルハシ', hoe: '鍬' };
const PLANT_MODES = { plant_wheat: 'wheat', plant_potato: 'moss_potato' };

/* ------------------------------------------------------------------ 補助 */
function emit(state, ...events) {
  for (const event of events) {
    if (state.events.length >= 400) break;
    state.events.push(event);
  }
}
function msg(state, text, tone = 'info') { emit(state, { type: 'msg', text, tone }); }
export function curMap(state) { return state.world.maps[state.player.map]; }
function dirFromVec(x, y, prev) {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (prev === 'left' || prev === 'right') { if (ax > ay * 0.6) return x > 0 ? 'right' : 'left'; }
  else if (prev === 'up' || prev === 'down') { if (ay > ax * 0.6) return y > 0 ? 'down' : 'up'; }
  return ax > ay ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
}
export function timeOfDay(state) { return state.time.clock % BALANCE.day.length; }
export function setClock(state, seconds) {
  const len = BALANCE.day.length;
  state.time.clock = Math.floor(state.time.clock / len) * len + (((seconds % len) + len) % len);
  state.time.day = 1 + Math.floor(state.time.clock / len);
  for (const c of state.crops) c.lastClock = state.time.clock; // デバッグの時刻合わせで作物を急成長させない
  state.rev++;
}
const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/* ------------------------------------------------------------------ 状態 */
function newPlayer(world) {
  const sp = world.surface.landmarks.spawn, camp = world.surface.landmarks.camp;
  return {
    map: 'surface', x: sp.x * TILE + 16, y: sp.y * TILE + 16, vx: 0, vy: 0,
    dir: 'down', fx: 0, fy: 1,
    hp: P.hpMax, satiety: BALANCE.hunger.max,
    tools: { axe: 0, pick: 0, hoe: 0 },
    equip: { weapon: null, armor: null, trinket: null },
    hotbar: new Array(BALANCE.items.hotbarSlots).fill(null), sel: -1, buildMode: null,
    bag: new Array(BALANCE.items.bagSlots).fill(null),
    spawn: { map: 'surface', x: camp.x * TILE + 16, y: camp.y * TILE + 16 + 40 },
    buffs: [],
    action: null, roll: null, rollCd: 0, invuln: 0,
    walkT: 0, moving: false, hungerT: 0, regenT: 0, starveT: 0, useCd: 0, retryT: 0, stepT: 0, placeT: 0,
  };
}

export function createState(world, save = null) {
  resetWorldTerrain(world);
  const camp = world.surface.landmarks.camp;
  const state = {
    world, rev: 1,
    rng: mulberry32((world.seed ^ 0x9E3779B9) >>> 0),
    time: { clock: BALANCE.startClock, day: 1 },
    playTime: 0,
    player: newPlayer(world),
    nodes: new Map(), depleted: new Set(), hitNodes: new Set(), wallHp: new Map(),
    structures: [], doors: [], structRev: 0, houseRev: -1, nextStructId: 1,
    ...createIndexes(),
    containers: {}, groundItems: [], nextItemId: 1,
    crops: [], farmland: [], houses: [], npcs: [],
    enemies: [], dormant: [], projectiles: [], telegraphs: [], boss: null, deathBag: null,
    explored: { surface: new Uint8Array(world.surface.w * world.surface.h), underground: new Uint8Array(world.underground.w * world.underground.h) },
    mined: { underground: new Uint8Array(world.underground.w * world.underground.h) },
    progress: progression.defaultProgress(),
    focus: null, preview: null, events: [], timers: { respawn: 0, goals: 0, explore: 0 }, lastTile: null,
  };
  settlement.initializeSettlement(state);
  combat.initCombat(state);

  let loaded = null;
  if (save) {
    const v = validateSaveData(save);
    if (v.ok) { loaded = v.save; state.loadWarnings = v.warnings; } else { state.loadErrors = v.errors; msg(state, `セーブを読み込めなかったので、はじめから始めます（${v.errors[0]}）`, 'warn'); }
  }
  if (loaded) {
    applySave(state, loaded);
    for (const w of (state.loadWarnings || []).slice(0, 3)) msg(state, w, 'warn');
  } else {
    addStructure(state, 'campfire', 'surface', camp.x, camp.y, 0, { fixed: true });
    const c = CAMP_LAYOUT.chest;
    const chest = addStructure(state, 'chest_wood', 'surface', camp.x + c.at[0], camp.y + c.at[1], 0);
    const box = state.containers[chest.id];
    c.items.forEach((it, i) => { box[i] = { id: it.id, n: it.n }; });
  }
  progression.syncGates(state);
  settlement.evaluateHouses(state);
  if (loaded) settlement.stepSettlement(state, 0, API);
  revealAround(state);
  return state;
}

/* ------------------------------------------------------------------ 構造物 */
function addStructure(state, type, mapId, x, y, rot = 0, extra = {}) {
  const rec = { id: state.nextStructId, type, map: mapId, x, y, rot, ...extra };
  const added = addStructureRecord(state, rec);
  if (!added) return null;
  state.nextStructId++;
  return added;
}

function structSolid(state, s) {
  const def = STRUCTURES[s.type];
  if (!def.solid) return null;
  if (s.type === 'door_wood' && s.open) return null;
  return def.solid;
}

export function place(state, type, x, y, rot = 0) {
  const def = STRUCTURES[type];
  const p = state.player;
  if (!def || !def.item) return { ok: false, reason: '置けないもの' };
  const map = curMap(state);
  const chk = canPlace(state, type, map, x, y);
  if (!chk.ok) { msg(state, chk.reason, 'warn'); return chk; }
  if (countItem(state, def.item) < 1) return { ok: false, reason: '持っていない' };
  const s = addStructure(state, type, p.map, x, y, rot);
  if (!s) return { ok: false, reason: 'すでに置かれている' };
  removeItem(state, def.item, 1);
  state.progress.built[type] = 1;
  emit(state, { type: 'place', x: x * TILE + 16, y: y * TILE + 16, structure: type });
  return { ok: true, structure: s };
}

// 取り壊し: 資源は100%戻る(バッグが満杯なら足元へ落とす)。物体を先に、なければ床、なければ畑
export function remove(state, x, y) {
  const mapId = state.player.map;
  const s = objectAt(state, mapId, x, y) || floorAt(state, mapId, x, y);
  if (!s) {
    if (farmAt(state, mapId, x, y)) {
      const r = settlement.removeFarm(state, x, y, API);
      if (!r.ok) msg(state, r.reason, 'warn');
      return r;
    }
    return { ok: false, reason: '取り壊すものがない' };
  }
  const def = STRUCTURES[s.type];
  if (!def.item || def.fixed || s.fixed) { msg(state, 'これは取り壊せない', 'warn'); return { ok: false, reason: 'fixed' }; }
  const p = state.player;
  if (Math.hypot(p.x - (x * TILE + 16), p.y - (y * TILE + 16)) > P.buildRange) { msg(state, '遠すぎる', 'warn'); return { ok: false, reason: 'far' }; }
  const box = state.containers[s.id];
  if (box && box.some(Boolean)) { msg(state, '中身を空にしてから取り壊そう', 'warn'); return { ok: false, reason: 'notEmpty' }; }
  removeStructureRecord(state, s);
  const left = addItem(state, def.item, 1, { silent: false });
  if (left > 0) spawnGround(state, p.map, p.x, p.y, def.item, left, { delay: 1 });
  emit(state, { type: 'remove', x: x * TILE + 16, y: y * TILE + 16, structure: s.type });
  return { ok: true };
}

/* ------------------------------------------------------------------ バッグ・装備・ホットバー */
export function countItem(state, id) {
  let n = 0;
  for (const s of state.player.bag) if (s && s.id === id) n += s.n;
  return n;
}

export function canFit(state, id, n = 1) {
  const def = ITEMS[id];
  if (!def) return false;
  const max = def.stack || BALANCE.items.stack;
  let room = 0;
  for (const s of state.player.bag) {
    if (!s) room += max; else if (s.id === id) room += max - s.n;
    if (room >= n) return true;
  }
  return room >= n;
}

function autoHotbar(state, id) {
  const def = ITEMS[id];
  if (!def || !(def.eat || def.place)) return;
  const hb = state.player.hotbar;
  if (hb.includes(id)) return;
  const i = hb.indexOf(null);
  if (i >= 0) hb[i] = id;
}

// 戻り値は入りきらなかった個数
export function addItem(state, id, n = 1, opts = EMPTY) {
  const def = ITEMS[id];
  if (!def || n <= 0) return n;
  const bag = state.player.bag, max = def.stack || BALANCE.items.stack;
  let left = n;
  for (const s of bag) {
    if (left <= 0) break;
    if (s && s.id === id && s.n < max) { const t = Math.min(max - s.n, left); s.n += t; left -= t; }
  }
  for (let i = 0; i < bag.length && left > 0; i++) {
    if (!bag[i]) { const t = Math.min(max, left); bag[i] = { id, n: t }; left -= t; }
  }
  const added = n - left;
  if (added > 0) {
    state.rev++;
    state.progress.seen[id] = 1;
    autoHotbar(state, id);
    if (!opts.silent) emit(state, { type: 'gain', item: id, n: added });
  }
  return left;
}

export function removeItem(state, id, n = 1) {
  if (countItem(state, id) < n) return false;
  const bag = state.player.bag;
  let left = n;
  for (let i = bag.length - 1; i >= 0 && left > 0; i--) {
    const s = bag[i];
    if (!s || s.id !== id) continue;
    const t = Math.min(s.n, left);
    s.n -= t; left -= t;
    if (s.n <= 0) bag[i] = null;
  }
  if (countItem(state, id) === 0) {
    const hb = state.player.hotbar;
    for (let i = 0; i < hb.length; i++) if (hb[i] === id) hb[i] = null;
  }
  state.rev++;
  return true;
}

export function swapBag(state, a, b) {
  const bag = state.player.bag;
  if (a === b || a < 0 || b < 0 || a >= bag.length || b >= bag.length) return;
  const A = bag[a], B = bag[b];
  if (A && B && A.id === B.id) {
    const max = ITEMS[A.id].stack;
    const t = Math.min(max - B.n, A.n);
    B.n += t; A.n -= t;
    if (A.n <= 0) bag[a] = null;
  } else { bag[a] = B; bag[b] = A; }
  state.rev++;
}

export function equipFromBag(state, slot) {
  const p = state.player;
  const s = p.bag[slot];
  if (!s) return { ok: false };
  const def = ITEMS[s.id];
  if (!def.equip) { msg(state, '装備できない', 'warn'); return { ok: false }; }
  const cur = p.equip[def.equip];
  s.n -= 1;
  if (s.n <= 0) p.bag[slot] = null;
  if (cur) {
    if (addItem(state, cur, 1, { silent: true }) > 0) {
      // 戻せない場合は元に戻す
      p.bag[slot] = p.bag[slot] ? p.bag[slot] : { id: s.id, n: 0 };
      p.bag[slot].n += 1;
      msg(state, 'バッグがいっぱい', 'warn');
      return { ok: false };
    }
  }
  p.equip[def.equip] = s.id;
  state.rev++;
  emit(state, { type: 'equip', item: s.id });
  return { ok: true };
}

export function unequip(state, slotName) {
  const p = state.player;
  const id = p.equip[slotName];
  if (!id) return { ok: false };
  if (addItem(state, id, 1, { silent: true }) > 0) { msg(state, 'バッグがいっぱい', 'warn'); return { ok: false }; }
  p.equip[slotName] = null;
  state.rev++;
  return { ok: true };
}

export function assignHotbar(state, index, itemId) {
  const p = state.player;
  if (index < 0 || index >= p.hotbar.length) return false;
  if (itemId) {
    const def = ITEMS[itemId];
    if (!def || !(def.eat || def.place)) { msg(state, 'ホットバーには食べ物と設置物を入れられる', 'warn'); return false; }
    for (let i = 0; i < p.hotbar.length; i++) if (p.hotbar[i] === itemId) p.hotbar[i] = null;
  }
  p.hotbar[index] = itemId || null;
  state.rev++;
  return true;
}

export function dropItem(state, slot, n = Infinity) {
  const p = state.player;
  const s = p.bag[slot];
  if (!s) return false;
  if (ITEMS[s.id].key) { msg(state, '大切なものは捨てられない', 'warn'); return false; }
  const t = Math.min(n, s.n);
  s.n -= t;
  if (s.n <= 0) p.bag[slot] = null;
  if (countItem(state, s.id) === 0) for (let i = 0; i < p.hotbar.length; i++) if (p.hotbar[i] === s.id) p.hotbar[i] = null;
  spawnGround(state, p.map, p.x + p.fx * 28, p.y + p.fy * 28, s.id, t, { delay: 2.5 });
  state.rev++;
  return true;
}

// 箱とバッグの間で、スロットの中身を丸ごと移す。from: 'bag' | 'box'
export function transfer(state, containerId, from, slot) {
  const box = state.containers[containerId];
  const bag = state.player.bag;
  if (!box) return false;
  if (from === 'bag') {
    const s = bag[slot];
    if (!s) return false;
    const max = ITEMS[s.id].stack;
    for (let i = 0; i < box.length && s.n > 0; i++) {
      if (box[i] && box[i].id === s.id && box[i].n < max) { const t = Math.min(max - box[i].n, s.n); box[i].n += t; s.n -= t; }
    }
    for (let i = 0; i < box.length && s.n > 0; i++) {
      if (!box[i]) { const t = Math.min(max, s.n); box[i] = { id: s.id, n: t }; s.n -= t; }
    }
    if (s.n <= 0) bag[slot] = null;
    if (countItem(state, s.id) === 0) for (let i = 0; i < state.player.hotbar.length; i++) if (state.player.hotbar[i] === s.id) state.player.hotbar[i] = null;
    state.rev++;
    return true;
  }
  const s = box[slot];
  if (!s) return false;
  const left = addItem(state, s.id, s.n, { silent: true });
  if (left === s.n) { msg(state, 'バッグがいっぱい', 'warn'); return false; }
  if (left > 0) s.n = left; else box[slot] = null;
  state.rev++;
  return true;
}

/* ------------------------------------------------------------------ 制作 */
export function nearbyStations(state) {
  const set = new Set(['hand']);
  const p = state.player;
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  const idx = state.structIndex[p.map], m = curMap(state);
  const r = Math.ceil(P.stationRange / TILE) + 1;
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const s = idx.get(y * m.w + x);
      if (!s) continue;
      if (Math.hypot(p.x - (x * TILE + 16), p.y - (y * TILE + 16)) > P.stationRange + 16) continue;
      for (const k of STRUCTURES[s.type].provides || []) set.add(k);
    }
  }
  return set;
}

export function recipeStatus(state, recipe, stations = nearbyStations(state)) {
  const have = {};
  let canMake = true, seenAny = false;
  for (const [id, need] of Object.entries(recipe.inputs)) {
    have[id] = countItem(state, id);
    if (have[id] < need) canMake = false;
    if (state.progress.seen[id]) seenAny = true;
  }
  const out = ITEMS[recipe.out];
  const owned = !!(out.tool && state.player.tools[out.tool] >= out.tier);
  return {
    have, canMake, owned,
    atStation: recipe.stations.some((s) => stations.has(s)),
    known: seenAny || canMake || !!state.progress.seen[recipe.out],
  };
}

export function craft(state, id, times = 1) {
  const r = RECIPE_BY_ID[id];
  const p = state.player;
  if (!r) return { ok: false, reason: 'レシピがない' };
  const out = ITEMS[r.out];
  if (out.tool) times = 1;
  times = Math.max(1, Math.min(99, times | 0));
  const stations = nearbyStations(state);
  const st = recipeStatus(state, r, stations);
  const fail = (reason) => { msg(state, reason, 'warn'); return { ok: false, reason }; };
  if (!st.atStation) return fail(`${r.stations.map((s) => STATIONS[s].name).join('か')}の近くで作ろう`);
  if (st.owned) return fail('すでに持っている');
  for (const [item, need] of Object.entries(r.inputs)) {
    if (st.have[item] < need * times) return fail(`${ITEMS[item].name}が足りない`);
  }
  const total = r.n * times;
  if (!out.tool) {
    const reserved = p.bag.map(s => s ? { ...s } : null);
    for (const [item, need] of Object.entries(r.inputs)) {
      let remaining = need * times;
      for (let i = 0; i < reserved.length && remaining > 0; i++) {
        const slot = reserved[i];
        if (!slot || slot.id !== item) continue;
        const used = Math.min(slot.n, remaining);
        remaining -= used; slot.n -= used;
        if (slot.n === 0) reserved[i] = null;
      }
    }
    if (!canFit({ player: { bag: reserved } }, r.out, total)) return fail('バッグがいっぱい');
  }
  for (const [item, need] of Object.entries(r.inputs)) removeItem(state, item, need * times);
  if (out.tool) {
    p.tools[out.tool] = Math.max(p.tools[out.tool], out.tier);
    state.progress.seen[r.out] = 1;
    state.rev++;
  } else {
    addItem(state, r.out, total, { silent: true });
    if (out.equip && !p.equip[out.equip]) {
      const slot = p.bag.findIndex((s) => s && s.id === r.out);
      if (slot >= 0) equipFromBag(state, slot);
    }
  }
  if (out.cat === 'food' && r.station !== 'hand') state.progress.stats.foods[r.out] = 1;
  state.progress.stats.crafted += total;
  emit(state, { type: 'craft', id: r.out, n: total });
  msg(state, out.tool ? `${out.name}を作った（自動で使われる）` : `${out.name}${total > 1 ? ` ×${total}` : ''}を作った`, 'good');
  if (r.out === 'workbench') hint(state, 'place', 'ホットバーの作業台を選び、地面をクリック（Eキー）で置こう');
  return { ok: true, count: total };
}

/* ------------------------------------------------------------------ 食べる・ホットバー */
export function eat(state, itemId) {
  const p = state.player;
  const def = ITEMS[itemId];
  if (!def || !def.eat) return { ok: false };
  if (countItem(state, itemId) < 1) return { ok: false };
  if (p.action) return { ok: false };
  if (def.eat.satiety > 0 && p.satiety >= BALANCE.hunger.max && p.hp >= P.hpMax && !def.eat.buff) {
    msg(state, 'いまは満腹だ'); return { ok: false };
  }
  p.action = { type: 'eat', item: itemId, t: 0, dur: BALANCE.hunger.eatTime };
  return { ok: true };
}

export function useHotbar(state, i) {
  const p = state.player;
  if (i < 0 || i >= p.hotbar.length) return;
  const id = p.hotbar[i];
  p.buildMode = null;
  if (!id) { p.sel = p.sel === i ? -1 : i; return; }
  const def = ITEMS[id];
  if (def.eat) { p.sel = i; eat(state, id); return; }
  if (def.place) { p.sel = p.sel === i ? -1 : i; return; }
  p.sel = i;
}

// いま選ばれている設置の種類(建築モード優先、なければホットバーの設置物)。特殊: farm / plant_* / demolish
function placingType(state) {
  const p = state.player;
  if (p.buildMode) {
    const t = p.buildMode.type;
    if (STRUCTURES[t] && countItem(state, STRUCTURES[t].item) < 1) { p.buildMode = null; return null; }
    return t;
  }
  const id = p.sel >= 0 ? p.hotbar[p.sel] : null;
  const def = id ? ITEMS[id] : null;
  return def && def.place && countItem(state, id) > 0 ? def.place : null;
}

/* ------------------------------------------------------------------ 建築モード・畑 */
// type: アイテムの構造物type / 'farm' / 'plant_wheat' / 'plant_potato' / 'demolish' / null(解除)
export function selectBuild(state, type = null, rot = 0) {
  const p = state.player;
  if (!type) { p.buildMode = null; p.sel = -1; state.preview = null; return { ok: true }; }
  let problem = null;
  if (type === 'farm') { if (!(p.tools.hoe > 0)) problem = '作業台で石の鍬を作ろう'; }
  else if (PLANT_MODES[type]) { if (countItem(state, CROPS[PLANT_MODES[type]].seed) < 1) problem = `${ITEMS[CROPS[PLANT_MODES[type]].seed].name}が必要`; }
  else if (type !== 'demolish') {
    const def = STRUCTURES[type];
    if (!def || !def.item) problem = '置けないもの';
    else if (countItem(state, def.item) < 1) problem = `${ITEMS[def.item].name}を持っていない`;
  }
  if (problem) { msg(state, problem, 'warn'); return { ok: false, reason: problem }; }
  p.buildMode = { type, rot: rot & 3 };
  p.sel = -1;
  return { ok: true };
}

// プレビューと実行に同じ判定を使う
export function canBuild(state, type, x, y) {
  const p = state.player;
  if (type === 'farm') return settlement.canTill(state, x, y);
  if (PLANT_MODES[type]) return settlement.canPlant(state, PLANT_MODES[type], x, y, API);
  if (type === 'demolish') {
    if (!objectAt(state, p.map, x, y) && !floorAt(state, p.map, x, y) && !farmAt(state, p.map, x, y)) return { ok: false, reason: 'ここには何もない' };
    if (Math.hypot(p.x - (x * TILE + 16), p.y - (y * TILE + 16)) > P.buildRange) return { ok: false, reason: '遠すぎる' };
    const s = objectAt(state, p.map, x, y) || floorAt(state, p.map, x, y);
    if (s && (STRUCTURES[s.type].fixed || s.fixed)) return { ok: false, reason: 'これは取り壊せない' };
    return { ok: true, reason: '' };
  }
  const def = STRUCTURES[type];
  if (!def || !def.item) return { ok: false, reason: '置けないもの' };
  const chk = canPlace(state, type, curMap(state), x, y);
  if (!chk.ok) return chk;
  if (countItem(state, def.item) < 1) return { ok: false, reason: `${ITEMS[def.item].name}を持っていない` };
  return { ok: true, reason: '' };
}

export function till(state, x, y) {
  const r = settlement.till(state, x, y);
  if (!r.ok && r.reason) msg(state, r.reason, 'warn');
  return r;
}

export function plant(state, kind, x, y) {
  const r = settlement.plant(state, kind, x, y, API);
  if (!r.ok && r.reason) msg(state, r.reason, 'warn');
  return r;
}

export function harvest(state, crop) {
  const r = settlement.harvest(state, crop, API);
  if (!r.ok && r.reason) msg(state, r.reason, 'warn');
  return r;
}

export function collectResident(state, id) { return settlement.collectResident(state, id, API); }
export function restoreLight(state, id) {
  const r = progression.restoreLight(state, id);
  if (!r.ok && r.reason) msg(state, r.reason, 'warn');
  return r;
}
export function bossRematch(state, id) {
  const r = progression.bossRematch(state, id);
  if (!r.ok && r.reason) msg(state, r.reason, 'warn');
  return r;
}
export function getHouseStatus(state) { return settlement.houseStatus(state); }
export function getLifeGoals(state) { return settlement.lifeGoals(state); }
export function getJournal(state) { return progression.getJournal(state); }
export function getObjective(state) { return progression.getObjective(state); }
export function collectDeathBag(state) { return combat.collectDeathBag(state); }
export function inSafeZone(state, x, y, extra = 0) { return settlement.inSafeZone(state, state.player.map, x, y, extra); }

/* ------------------------------------------------------------------ 地面のアイテム */
export function spawnGround(state, mapId, x, y, item, n, opts = EMPTY) {
  const r = state.rng;
  const a = r() * Math.PI * 2, sp = 36 + r() * 46;
  state.groundItems.push({
    id: state.nextItemId++, map: mapId, item, n, x, y: y + 2, z: 2, vz: 150 + r() * 70,
    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, age: -(opts.delay || 0), bounced: false,
  });
}

function pickupGround(state, g) {
  const left = addItem(state, g.item, g.n);
  if (left >= g.n) return false;
  if (left > 0) g.n = left;
  else {
    const i = state.groundItems.indexOf(g);
    if (i >= 0) state.groundItems.splice(i, 1);
  }
  emit(state, { type: 'pickup', x: g.x, y: g.y, item: g.item });
  return true;
}

function updateGroundItems(state, dt) {
  const p = state.player;
  const items = state.groundItems;
  for (let i = items.length - 1; i >= 0; i--) {
    const g = items[i];
    g.age += dt;
    if (g.z > 0 || g.vz !== 0) {
      g.vz -= 560 * dt; g.z += g.vz * dt;
      if (g.z <= 0) {
        g.z = 0;
        if (g.vz < -90 && !g.bounced) { g.vz = -g.vz * 0.34; g.bounced = true; } else g.vz = 0;
      }
    }
    if (g.vx || g.vy) {
      const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
      const m = state.world.maps[g.map];
      if (TERRAIN_INFO[getTile(m, Math.floor(nx / TILE), Math.floor(ny / TILE))].solid) { g.vx = 0; g.vy = 0; }
      else { g.x = nx; g.y = ny; }
      const k = Math.exp(-5 * dt);
      g.vx *= k; g.vy *= k;
      if (Math.abs(g.vx) < 2 && Math.abs(g.vy) < 2) { g.vx = 0; g.vy = 0; }
    }
    const def = ITEMS[g.item];
    if (g.age > BALANCE.items.groundLife && !def.key && !def.reward) { items.splice(i, 1); continue; }
    if (g.age > 0.35 && g.map === p.map && g.z <= 1) {
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d <= BALANCE.items.magnet && canFit(state, g.item, 1)) {
        const sp = 150 + (BALANCE.items.magnet - d) * 7;
        const mv = Math.min(d, sp * dt);
        if (d > 0.001) { g.x += (p.x - g.x) / d * mv; g.y += (p.y - g.y) / d * mv; }
        if (Math.hypot(p.x - g.x, p.y - g.y) < BALANCE.items.pickup) pickupGround(state, g);
      }
    }
  }
}

/* ------------------------------------------------------------------ 資源ノードと壁の採掘 */
export function nodeAlive(state, node) {
  const ns = state.nodes.get(node.key);
  return !(ns && ns.respawnAt != null);
}

// 伐採した木に苗を植える。既存の再生時刻を使うので、保存後も苗の消費と成長を保持する。
export function canReplantTree(state, node) {
  const p = state.player, map = state.world.surface;
  if (p.map !== 'surface' || !node || node.type !== 'tree' || nodeAt(map, node.tx, node.ty) !== node) return { ok: false, reason: '地上の切り株に植えよう' };
  if (nodeAlive(state, node)) return { ok: false, reason: 'まだ木が生えている' };
  if (Math.hypot(p.x - node.px, p.y - node.py) > P.reach) return { ok: false, reason: '切り株に近づこう' };
  if (structureAt(state, 'surface', node.tx, node.ty) || farmAt(state, 'surface', node.tx, node.ty)) return { ok: false, reason: '切り株の上の設備や畑をどけよう' };
  const grow = NODES.tree.saplingGrow;
  if (state.nodes.get(node.key).respawnAt - state.time.clock <= grow) return { ok: false, reason: '木はもう育っている。少し離れて待とう' };
  if (countItem(state, 'sapling') < 1) return { ok: false, reason: '苗が必要（木を伐ると手に入る）' };
  return { ok: true };
}

export function replantTree(state, node) {
  const chk = canReplantTree(state, node);
  if (!chk.ok) { msg(state, chk.reason, 'warn'); return chk; }
  removeItem(state, 'sapling', 1);
  state.nodes.get(node.key).respawnAt = state.time.clock + NODES.tree.saplingGrow;
  state.rev++;
  emit(state, { type: 'plant', x: node.px, y: node.py });
  msg(state, '切り株に苗を植えた。60秒ほどしたら、少し離れると木が育つ', 'good');
  return { ok: true };
}

function nodeRadius(state, node) {
  if (nodeAlive(state, node)) return solidRadius(node);
  const d = NODES[node.type];
  return d.depletedSolid ? d.depletedSolid.r : 0;
}

export function toolProblem(p, def) {
  if (!def.tool) return null;
  const tier = p.tools[def.tool] || 0;
  if (tier <= 0) return def.tool === 'axe' ? '斧が必要（石の斧を作ろう）' : `${TOOL_JP[def.tool]}が必要（作ってみよう）`;
  if (def.tool === 'pick' && tier < (def.hardness || 0)) return `${BALANCE.tierNames[def.hardness]}の${TOOL_JP.pick}が必要`;
  return null;
}

function harvestNode(state, node, def) {
  const r = state.rng;
  const mapId = node.key.slice(0, node.key.indexOf(':'));
  for (const d of def.drops || []) {
    if (d.chance != null && r() > d.chance) continue;
    const parts = Math.min(d.n, 3);
    let left = d.n;
    for (let k = 0; k < parts; k++) {
      const t = k === parts - 1 ? left : Math.max(1, Math.floor(d.n / parts));
      left -= t;
      spawnGround(state, mapId, node.px, node.py - 8, d.item, t);
    }
  }
  const ns = state.nodes.get(node.key);
  ns.hp = def.hp;
  ns.respawnAt = def.regen == null ? Infinity : state.time.clock + def.regen;
  state.depleted.add(node);
  state.progress.stats.gathered += 1;
  emit(state, { type: 'deplete', x: node.px, y: node.py, node: node.type, chip: def.chip });
  state.rev++;
}

function hitNode(state, node) {
  const p = state.player, def = NODES[node.type];
  const tier = def.tool ? p.tools[def.tool] : 0;
  const power = def.tool ? BALANCE.power[def.tool][tier] || 0 : 1;
  let ns = state.nodes.get(node.key);
  if (!ns) { ns = { hp: def.hp, respawnAt: null, hitT: 0 }; state.nodes.set(node.key, ns); }
  ns.hp -= power;
  ns.hitT = 0.2;
  state.hitNodes.add(ns);
  emit(state, { type: 'hit', x: node.px, y: node.py - (def.hit ? Math.min(def.hit.h * 0.4, 26) : 8), node: node.type, chip: def.chip, tool: def.tool || null });
  if (ns.hp <= 0) harvestNode(state, node, def);
}

// 地下の壁(土壁・苔岩壁・銅鉱壁・翠鉄鉱壁)。壊すと床になり、採掘済みとして保存される
function wallDef(map, tx, ty) {
  const kind = map.wallKind[ty * map.w + tx];
  return kind >= WALL.DIRT && kind <= WALL.IRON && !map.protect[ty * map.w + tx] ? NODES[WALL_NODE[kind]] : null;
}

function hitWall(state, tx, ty) {
  const p = state.player, map = state.world.underground;
  if (p.map !== 'underground') return false;
  const def = wallDef(map, tx, ty);
  if (!def || toolProblem(p, def)) return false;
  const i = ty * map.w + tx;
  const hp = (state.wallHp.get(i) ?? def.hp) - (BALANCE.power.pick[p.tools.pick] || 0);
  const cx = tx * TILE + 16, cy = ty * TILE + 16;
  emit(state, { type: 'hit', x: cx, y: cy, node: WALL_NODE[map.wallKind[i]], chip: ['#91a0a2', '#6c7b81', '#505c67'], tool: 'pick' });
  if (hp > 0) { state.wallHp.set(i, hp); return true; }
  state.wallHp.delete(i);
  for (const d of def.drops) spawnGround(state, 'underground', cx, cy, d.item, d.n);
  openWallTile(map, tx, ty);
  state.mined.underground[i] = 1;
  state.progress.stats.gathered += 1;
  emit(state, { type: 'deplete', x: cx, y: cy, node: 'wall', chip: ['#91a0a2', '#6c7b81', '#505c67'] });
  state.rev++;
  return true;
}

function updateNodes(state, dt) {
  for (const ns of state.hitNodes) { ns.hitT -= dt; if (ns.hitT <= 0) state.hitNodes.delete(ns); }
  state.timers.respawn += dt;
  if (state.timers.respawn < BALANCE.respawn.check) return;
  state.timers.respawn = 0;
  const p = state.player, clock = state.time.clock;
  for (const node of state.depleted) {
    const ns = state.nodes.get(node.key);
    if (!ns || ns.respawnAt == null) { state.depleted.delete(node); continue; }
    if (clock < ns.respawnAt) continue;
    const mapId = node.key.slice(0, node.key.indexOf(':'));
    if (mapId === p.map && Math.hypot(p.x - node.px, p.y - node.py) < BALANCE.respawn.playerDistance) continue;
    if (structureAt(state, mapId, node.tx, node.ty) || farmAt(state, mapId, node.tx, node.ty)) continue;
    ns.respawnAt = null;
    ns.hp = NODES[node.type].hp;
    state.depleted.delete(node);
    emit(state, { type: 'respawn', x: node.px, y: node.py });
    state.rev++;
  }
}

/* ------------------------------------------------------------------ 対象選び */
function collect(state, map, tx0, ty0, tx1, ty1) {
  const out = [];
  for (const g of state.groundItems) {
    if (g.map === map.id) out.push({ kind: 'ground', ref: g, x: g.x, y: g.y, prio: 0, rect: [g.x - 14, g.y - 24, g.x + 14, g.y + 8] });
  }
  const b = state.deathBag;
  if (b && b.map === map.id) out.push({ kind: 'bag', ref: b, x: b.x, y: b.y, prio: 0, rect: [b.x - 16, b.y - 26, b.x + 16, b.y + 8] });
  if (map.id === 'surface') {
    for (const n of state.npcs) out.push({ kind: 'npc', ref: n, x: n.x, y: n.y, prio: 1, rect: [n.x - 14, n.y - 44, n.x + 14, n.y + 6], top: n.y - 46 });
  }
  const sidx = state.structIndex[map.id], cidx = state.cropIndex[map.id];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      const i = ty * map.w + tx;
      const s = sidx.get(i);
      if (s && STRUCTURES[s.type].use) {
        out.push({ kind: 'structure', ref: s, x: tx * TILE + 16, y: ty * TILE + 16, prio: 2, rect: [tx * TILE, ty * TILE - 26, tx * TILE + TILE, ty * TILE + TILE] });
      }
      const cr = cidx.get(i);
      if (cr) out.push({ kind: 'crop', ref: cr, x: tx * TILE + 16, y: ty * TILE + 16, prio: 2, rect: [tx * TILE, ty * TILE - 8, tx * TILE + TILE, ty * TILE + TILE] });
      const n = nodeAt(map, tx, ty);
      if (n) {
        const def = NODES[n.type];
        if (n.type === 'tree' && !nodeAlive(state, n) && countItem(state, 'sapling') > 0) {
          out.push({ kind: 'stump', ref: n, x: n.px, y: n.py, prio: 5, rect: [n.px - 16, n.py - 22, n.px + 16, n.py + 6], top: n.py - 22 });
        }
        if (!((def.decor && !n.info) || !nodeAlive(state, n))) {
          const h = def.hit || { w: 28, h: 36 };
          out.push({ kind: 'node', ref: n, x: n.px, y: n.py, prio: 3, rect: [n.px - h.w / 2, n.py - h.h, n.px + h.w / 2, n.py + 6], top: n.py - h.h });
        }
      }
      if (map.id === 'underground' && wallDef(map, tx, ty)) {
        out.push({ kind: 'wall', ref: { tx, ty, wall: map.wallKind[i] }, x: tx * TILE + 16, y: ty * TILE + 16, prio: 3, rect: [tx * TILE, ty * TILE, tx * TILE + TILE, ty * TILE + TILE], top: ty * TILE });
      }
    }
  }
  for (const e of state.enemies) {
    out.push({ kind: 'enemy', ref: e, x: e.x, y: e.y, prio: 4, rect: [e.x - e.radius, e.y - 40, e.x + e.radius, e.y + 6] });
  }
  return out;
}

function describe(state, c, viaMouse) {
  const p = state.player;
  const d = Math.hypot(c.x - p.x, c.y - p.y);
  const key = viaMouse ? 'クリック' : 'E';
  const f = { kind: c.kind, ref: c.ref, x: c.x, y: c.top != null ? c.top : c.y - 30, ax: c.x, ay: c.y, dist: d, key, verb: '', name: '', ok: true, reason: '', mouse: viaMouse };
  if (c.kind === 'stump') {
    const chk = canReplantTree(state, c.ref);
    f.verb = '苗を植える'; f.name = '切り株'; f.ok = chk.ok; f.reason = chk.reason || '';
  }
  else if (c.kind === 'ground') { f.verb = '拾う'; f.name = ITEMS[c.ref.item].name; }
  else if (c.kind === 'bag') { f.verb = '回収する'; f.name = '資源袋'; }
  else if (c.kind === 'npc') { f.verb = '話す'; f.name = c.ref.name; }
  else if (c.kind === 'structure') { const def = STRUCTURES[c.ref.type]; f.verb = def.verb || '使う'; f.name = def.name; }
  else if (c.kind === 'crop') {
    const def = CROPS[c.ref.kind], ripe = settlement.cropRipe(c.ref);
    f.verb = ripe ? '収穫する' : '育成中'; f.name = def.name;
    if (!ripe) { f.ok = false; f.reason = `${def.name}はまだ育っている（${Math.ceil((settlement.cropRipeTime(c.ref) - c.ref.growth))}秒）`; }
  } else if (c.kind === 'node') {
    const def = NODES[c.ref.type];
    f.verb = def.verb || '調べる'; f.name = c.ref.name || def.name;
    const prob = toolProblem(p, def);
    if (prob) { f.ok = false; f.reason = prob; }
  } else if (c.kind === 'wall') {
    const def = NODES[WALL_NODE[c.ref.wall]];
    f.verb = '砕く'; f.name = def.name;
    const prob = toolProblem(p, def);
    if (prob) { f.ok = false; f.reason = prob; }
  } else if (c.kind === 'enemy') { f.verb = '攻撃'; f.name = c.ref.name || ''; }
  if (d > P.reach && f.ok) { f.ok = false; f.reason = '近づこう'; f.far = true; }
  return f;
}

function updateFocus(state, input) {
  const p = state.player, map = curMap(state);
  state.focus = null;
  if (placingType(state)) return;
  if (input.aim && input.aimActive) {
    const mx = input.aim.x, my = input.aim.y;
    const tx = Math.floor(mx / TILE), ty = Math.floor(my / TILE);
    const list = collect(state, map, tx - 2, ty - 1, tx + 2, ty + 4).filter((c) => mx >= c.rect[0] && mx <= c.rect[2] && my >= c.rect[1] && my <= c.rect[3]);
    if (!list.length) return;
    list.sort((a, b) => a.prio - b.prio || b.y - a.y);
    state.focus = describe(state, list[0], true);
    return;
  }
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  let best = null, bestScore = Infinity;
  for (const c of collect(state, map, tx - 3, ty - 3, tx + 3, ty + 3)) {
    const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy);
    if (d > P.reach) continue;
    if (d > 24) {
      const cos = (dx * p.fx + dy * p.fy) / d;
      if (cos < 0.707) continue;
    }
    const score = c.prio * 1000 + d;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  if (best) state.focus = describe(state, best, false);
}

/* ------------------------------------------------------------------ 行動 */
function faceTo(p, x, y) {
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
  if (d < 0.5) return;
  p.fx = dx / d; p.fy = dy / d;
  p.dir = dirFromVec(dx, dy, null);
}

function startSwing(state) {
  const p = state.player;
  p.action = { type: 'swing', t: 0, dur: P.swing, hit: false };
  emit(state, { type: 'swing', x: p.x, y: p.y, dir: p.dir });
}

// 剣の判定。前方100°・1.5タイル
function swingHits(state) {
  const p = state.player;
  const dmg = p.equip.weapon ? ITEMS[p.equip.weapon].weapon.dmg : 2;
  const cos = Math.cos((P.hitCone / 2) * Math.PI / 180);
  for (const e of state.enemies.slice()) {
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
    if (d > P.hitRange * TILE + e.radius) continue;
    if (d > 1 && (dx * p.fx + dy * p.fy) / d < cos) continue;
    combat.damageEnemy(state, e, dmg, dx / (d || 1), dy / (d || 1));
  }
}

function tryAct(state, input) {
  const p = state.player;
  const f = state.focus;
  if (p.useCd > 0) return;
  if (!f) {
    if (input.actPressed) startSwing(state);
    return;
  }
  if (!f.ok) {
    if (input.actPressed || p.retryT <= 0) { msg(state, f.reason, 'warn'); p.retryT = BALANCE.gather.retryDelay; }
    return;
  }
  faceTo(p, f.ax, f.ay);
  if (f.kind === 'stump') {
    if (input.actPressed) { replantTree(state, f.ref); p.useCd = 0.5; }
    return;
  }
  if (f.kind === 'ground') { pickupGround(state, f.ref); return; }
  if (f.kind === 'bag') { combat.collectDeathBag(state); p.useCd = 0.3; return; }
  if (f.kind === 'structure') {
    if (input.actPressed) { useStructure(state, f.ref); p.useCd = 0.3; }
    return;
  }
  if (f.kind === 'npc') {
    if (input.actPressed) { emit(state, { type: 'open', panel: 'npc', id: f.ref.id }); p.useCd = 0.3; }
    return;
  }
  if (f.kind === 'crop') {
    if (input.actPressed || input.act) { harvest(state, f.ref); p.useCd = 0.25; }
    return;
  }
  if (f.kind === 'enemy') { startSwing(state); return; }
  if (f.kind === 'wall') {
    p.action = { type: 'gather', wall: { tx: f.ref.tx, ty: f.ref.ty }, t: 0, dur: BALANCE.gather.toolTime, hit: false, tool: 'pick' };
    return;
  }
  if (f.kind === 'node') {
    const def = NODES[f.ref.type];
    if (def.landmark || def.decor) {
      if (input.actPressed) {
        if (!progression.useNode(state, f.ref)) msg(state, f.ref.info || def.info || '', 'info');
        p.useCd = 0.5;
      }
      return;
    }
    p.action = { type: 'gather', node: f.ref, t: 0, dur: def.tool ? BALANCE.gather.toolTime : BALANCE.gather.bareTime, hit: false, tool: def.tool || null };
  }
}

function useStructure(state, s) {
  const def = STRUCTURES[s.type];
  if (def.use === 'craft') emit(state, { type: 'open', panel: 'craft', station: def.provides[0] });
  else if (def.use === 'container') emit(state, { type: 'open', panel: 'container', id: s.id });
  else if (def.use === 'sleep') {
    const r = settlement.sleep(state, s, API);
    if (!r.ok) msg(state, r.reason, 'warn');
  }
}

// UI・テスト用の入口。target は {kind, ref}
export function interact(state, target) {
  if (!target) return false;
  if (target.kind === 'stump') return replantTree(state, target.ref).ok;
  if (target.kind === 'ground') return pickupGround(state, target.ref);
  if (target.kind === 'bag') return combat.collectDeathBag(state) > 0;
  if (target.kind === 'structure') { useStructure(state, target.ref); return true; }
  if (target.kind === 'npc') { emit(state, { type: 'open', panel: 'npc', id: target.ref.id }); return true; }
  if (target.kind === 'crop') return harvest(state, target.ref).ok;
  if (target.kind === 'wall') {
    const def = NODES[WALL_NODE[target.ref.wall]];
    if (!def) return false;
    const prob = toolProblem(state.player, def);
    if (prob) { msg(state, prob, 'warn'); return false; }
    return hitWall(state, target.ref.tx, target.ref.ty);
  }
  if (target.kind === 'node') {
    const def = NODES[target.ref.type];
    if (def.landmark || def.decor) {
      if (!progression.useNode(state, target.ref)) msg(state, target.ref.info || def.info || '');
      return true;
    }
    const prob = toolProblem(state.player, def);
    if (prob) { msg(state, prob, 'warn'); return false; }
    if (!nodeAlive(state, target.ref)) return false;
    hitNode(state, target.ref);
    return true;
  }
  return false;
}

function finishEat(state, a) {
  const p = state.player, def = ITEMS[a.item];
  if (!removeItem(state, a.item, 1)) return;
  const e = def.eat;
  p.satiety = Math.min(BALANCE.hunger.max, p.satiety + e.satiety);
  p.hp = Math.min(P.hpMax, p.hp + e.hp);
  if (e.buff) {
    const until = state.time.clock + e.buff.time;
    const b = p.buffs.find((x) => x.id === e.buff.id);
    if (b) { b.until = until; b.v = e.buff.v; } else p.buffs.push({ id: e.buff.id, v: e.buff.v, until });
  }
  emit(state, { type: 'eat', item: a.item });
  msg(state, `${def.name}を食べた`, 'good');
}

function updateAction(state, dt, input) {
  const p = state.player;
  const placing = placingType(state);
  if (p.action) {
    const a = p.action;
    a.t += dt;
    if (a.type === 'gather') {
      if (!a.hit && a.t >= a.dur * BALANCE.gather.hitAt) {
        a.hit = true;
        if (a.wall) {
          const cx = a.wall.tx * TILE + 16, cy = a.wall.ty * TILE + 16;
          if (Math.hypot(cx - p.x, cy - p.y) <= P.reach * 1.5 && hitWall(state, a.wall.tx, a.wall.ty)) { /* 命中 */ } else p.action = null;
        } else {
          const n = a.node;
          if (nodeAlive(state, n) && Math.hypot(n.px - p.x, n.py - p.y) <= P.reach * 1.35) hitNode(state, n);
          else p.action = null;
        }
      }
    } else if (a.type === 'swing') {
      if (!a.hit && a.t >= P.hitStart) { a.hit = true; swingHits(state); }
    } else if (a.type === 'eat') {
      if (a.t >= a.dur) { finishEat(state, a); p.action = null; return; }
    }
    if (p.action && a.t >= a.dur) p.action = null;
    return;
  }
  if (p.roll) return;
  if (p.retryT > 0) p.retryT -= dt;
  if (placing) return;
  if (input.actPressed || input.act) tryAct(state, input);
}

/* ------------------------------------------------------------------ 設置・建築モードの入力 */
function targetTile(state, input) {
  const p = state.player;
  if (input.aim && input.aimActive) return [Math.floor(input.aim.x / TILE), Math.floor(input.aim.y / TILE)];
  return [Math.floor((p.x + p.fx * 38) / TILE), Math.floor((p.y + p.fy * 38 - 4) / TILE)];
}

function performBuild(state, type, tx, ty, rot) {
  if (type === 'farm') return till(state, tx, ty);
  if (PLANT_MODES[type]) return plant(state, PLANT_MODES[type], tx, ty);
  if (type === 'demolish') return remove(state, tx, ty);
  return place(state, type, tx, ty, rot);
}

function updatePlacement(state, input, dt) {
  const p = state.player;
  state.preview = null;
  if (input.cancelPressed && (p.sel >= 0 || p.buildMode)) { p.sel = -1; p.buildMode = null; return; }
  const type = placingType(state);
  if (!type) return;
  if (input.rotatePressed && p.buildMode) p.buildMode.rot = (p.buildMode.rot + 1) & 3;
  const rot = p.buildMode ? p.buildMode.rot : 0;
  const [tx, ty] = targetTile(state, input);
  const chk = canBuild(state, type, tx, ty);
  state.preview = { type, x: tx, y: ty, ok: chk.ok, reason: chk.reason || '', rot };
  p.placeT -= dt;
  if (input.removePressed && type !== 'demolish') { remove(state, tx, ty); return; }
  if (!p.action && !p.roll && (input.actPressed || (input.act && p.placeT <= 0))) {
    p.placeT = 0.18;
    if (chk.ok) performBuild(state, type, tx, ty, rot);
    else if (input.actPressed) msg(state, chk.reason, 'warn');
  }
}

function handleHotbarInput(state, input) {
  const p = state.player;
  if (input.slot != null && input.slot >= 0) useHotbar(state, input.slot);
  if (input.wheel) {
    const n = p.hotbar.length;
    p.buildMode = null;
    p.sel = ((p.sel < 0 ? (input.wheel > 0 ? -1 : 0) : p.sel) + input.wheel + n) % n;
  }
  if (input.removePressed && !placingType(state)) {
    const m = curMap(state);
    const [tx, ty] = targetTile(state, input);
    if (m) remove(state, tx, ty);
  }
}

/* ------------------------------------------------------------------ 移動・衝突 */
function pushBox(e, bx, by, bw, bh, r) {
  const cx = Math.max(bx, Math.min(e.x, bx + bw)), cy = Math.max(by, Math.min(e.y, by + bh));
  const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    e.x += dx * k; e.y += dy * k;
  } else {
    const l = e.x - bx, rr = bx + bw - e.x, t = e.y - by, b = by + bh - e.y;
    const m = Math.min(l, rr, t, b);
    if (m === l) e.x = bx - r; else if (m === rr) e.x = bx + bw + r; else if (m === t) e.y = by - r; else e.y = by + bh + r;
  }
  return true;
}

function pushCircle(e, cx, cy, cr, r) {
  const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy), min = cr + r;
  if (d >= min) return false;
  if (d < 1e-6) { e.y += min; return true; }
  const k = (min - d) / d;
  e.x += dx * k; e.y += dy * k;
  return true;
}

// 足元の円(半径r)を、地形・資源・構造物(物体のみ。床は歩ける)から押し出す
function resolveCollisions(state, map, e, r) {
  const x0 = Math.floor((e.x - r) / TILE) - 1, x1 = Math.floor((e.x + r) / TILE) + 1;
  const y0 = Math.floor((e.y - r) / TILE) - 1, y1 = Math.floor((e.y + r) / TILE) + 1;
  const sidx = state.structIndex[map.id];
  for (let it = 0; it < 3; it++) {
    let moved = false;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (TERRAIN_INFO[getTile(map, tx, ty)].solid) { if (pushBox(e, tx * TILE, ty * TILE, TILE, TILE, r)) moved = true; }
        const n = nodeAt(map, tx, ty);
        if (n) {
          const nr = nodeRadius(state, n);
          if (nr > 0 && pushCircle(e, n.px, n.py, nr, r)) moved = true;
        }
        if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h) {
          const s = sidx.get(ty * map.w + tx);
          if (s) {
            const sol = structSolid(state, s);
            if (sol === 'box') {
              const kind = STRUCTURES[s.type].kind;
              const inset = kind ? 0 : 3;
              if (pushBox(e, tx * TILE + inset, ty * TILE + inset, TILE - inset * 2, TILE - inset * 2, r)) moved = true;
            } else if (sol && pushCircle(e, tx * TILE + 16, ty * TILE + 16, sol.r, r)) moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
}

export function moveEntity(state, map, e, dx, dy, r) {
  e.x += dx; e.y += dy;
  resolveCollisions(state, map, e, r);
}

function buffValue(state, id) {
  let v = 0;
  for (const b of state.player.buffs) if (b.id === id && b.until > state.time.clock) v += b.v;
  return v;
}

function updateMovement(state, dt, input) {
  const p = state.player, map = curMap(state);
  let mx = input.moveX || 0, my = input.moveY || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  p.rollCd = Math.max(0, p.rollCd - dt);
  p.invuln = Math.max(0, p.invuln - dt);

  if (!p.roll && input.dodgePressed && p.rollCd <= 0 && !(p.action && p.action.type === 'swing' && p.action.t < 0.25)) {
    let rx = mx, ry = my;
    if (!rx && !ry) { rx = p.fx; ry = p.fy; }
    const l = Math.hypot(rx, ry) || 1;
    p.roll = { t: 0, dx: rx / l, dy: ry / l };
    p.action = null;
    p.rollCd = P.rollCooldown;
    emit(state, { type: 'roll', x: p.x, y: p.y });
  }
  if (p.roll) {
    const r = p.roll;
    r.t += dt;
    const sp = P.rollDist * TILE / P.rollTime;
    p.invuln = Math.max(p.invuln, r.t < P.rollInvuln ? 0.05 : 0);
    moveEntity(state, map, p, r.dx * sp * dt, r.dy * sp * dt, P.radius);
    p.vx = r.dx * sp; p.vy = r.dy * sp; p.moving = true;
    if (r.t >= P.rollTime) p.roll = null;
    return;
  }

  let speed = P.speed * TILE;
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  const tinfo = TERRAIN_INFO[getTile(map, tx, ty)];
  speed *= tinfo.speed;
  const floor = floorAt(state, p.map, tx, ty);
  if (floor && STRUCTURES[floor.type].speed) speed *= STRUCTURES[floor.type].speed;
  if (p.satiety <= 0) speed *= P.hungerMul;
  const tr = p.equip.trinket ? ITEMS[p.equip.trinket].trinket : null;
  speed *= 1 + (tr && tr.speed ? tr.speed : 0) + buffValue(state, 'speed');
  if (p.action) speed *= P.actionMove;

  const moving = len > 0.01;
  if (moving) {
    p.vx = mx * speed; p.vy = my * speed;
    const fl = Math.hypot(mx, my) || 1;
    p.fx = mx / fl; p.fy = my / fl;
    if (!p.action) p.dir = dirFromVec(mx, my, p.dir);
    const bx = p.x, by = p.y;
    moveEntity(state, map, p, p.vx * dt, p.vy * dt, P.radius);
    const moved = Math.hypot(p.x - bx, p.y - by);
    p.walkT += moved;
    p.stepT += moved;
    if (p.stepT > 26) { p.stepT = 0; emit(state, { type: 'step', x: p.x, y: p.y, surface: tinfo.step || 'grass', water: !!tinfo.water }); }
    p.moving = moved > 0.05;
  } else {
    p.vx = 0; p.vy = 0; p.moving = false;
    resolveCollisions(state, map, p, P.radius);
  }
  // 扉は近づくと自動で開く
  for (const s of state.doors) {
    if (s.map !== p.map) { s.open = false; continue; }
    s.open = Math.hypot(p.x - (s.x * TILE + 16), p.y - (s.y * TILE + 16)) < 40;
  }
}

/* ------------------------------------------------------------------ 満腹・回復 */
function updateSurvival(state, dt) {
  const p = state.player, H = BALANCE.hunger;
  p.hungerT += dt;
  while (p.hungerT >= H.interval) { p.hungerT -= H.interval; p.satiety = Math.max(0, p.satiety - 1); state.rev++; }
  if (p.hp < P.hpMax) {
    const every = p.satiety >= 60 ? 2 : p.satiety >= 30 ? 6 : 0;
    if (every) {
      p.regenT += dt;
      if (p.regenT >= every) { p.regenT = 0; p.hp = Math.min(P.hpMax, p.hp + 1); }
    } else p.regenT = 0;
  }
  if (p.satiety <= 0 && p.hp > H.starveFloor) {
    p.starveT += dt;
    if (p.starveT >= H.starveInterval) { p.starveT = 0; p.hp = Math.max(H.starveFloor, p.hp - 1); }
  } else p.starveT = 0;
  if (p.buffs.length) {
    const before = p.buffs.length;
    p.buffs = p.buffs.filter((b) => b.until > state.time.clock);
    if (p.buffs.length !== before) state.rev++;
  }
}

/* ------------------------------------------------------------------ 探索済みの範囲 */
function revealAround(state) {
  const p = state.player, map = curMap(state), R = BALANCE.explore.radius;
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  const arr = state.explored[p.map];
  for (let y = Math.max(0, ty - R); y <= Math.min(map.h - 1, ty + R); y++) {
    for (let x = Math.max(0, tx - R); x <= Math.min(map.w - 1, tx + R); x++) {
      if ((x - tx) * (x - tx) + (y - ty) * (y - ty) <= R * R) arr[y * map.w + x] = 1;
    }
  }
  state.lastTile = `${p.map}:${tx},${ty}`;
}

function updateExplored(state) {
  const p = state.player;
  const key = `${p.map}:${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`;
  if (key !== state.lastTile) revealAround(state);
}

/* ------------------------------------------------------------------ 案内 */
function hint(state, key, text) {
  if (state.progress.hints[key]) return;
  state.progress.hints[key] = 1;
  emit(state, { type: 'hint', key, text });
}

function updateHints(state) {
  const pr = state.progress, p = state.player;
  if (state.playTime < 0.5) hint(state, 'move', 'WASD / 矢印キーで歩けます');
  else if (pr.hints.move && state.playTime > 5 && !pr.stats.gathered && !Object.keys(pr.seen).length) {
    hint(state, 'act', '近くの枝・石・草へ近づき、E か左クリックで拾おう');
  }
  if (!pr.hints.craft && (Object.keys(pr.seen).length >= 2 || pr.stats.gathered > 0) && !p.tools.axe) {
    hint(state, 'craft', 'C で制作画面。枝3・石2・繊維2で石の斧が作れます');
  }
  if (p.map === 'underground') hint(state, 'cave', '洞窟は暗い。たいまつや灯籠を持ち、敵の予兆（光る範囲）を見て Shift で回避しよう');
  if (countItem(state, 'sapling') > 0) hint(state, 'sapling', '苗を持って切り株を調べると、苗を植えて木の再生を早められます');
}

/* ------------------------------------------------------------------ 移動・テレポート(デバッグ/場面転換) */
export function teleport(state, mapId, tx, ty) {
  const m = state.world.maps[mapId];
  if (!m) return false;
  const spot = findWalkableNear(m, Math.round(tx), Math.round(ty), 10);
  if (!spot) return false;
  const p = state.player;
  const changed = p.map !== mapId;
  p.map = mapId; p.x = spot.x * TILE + 16; p.y = spot.y * TILE + 16;
  p.vx = p.vy = 0; p.action = null; p.roll = null;
  moveEntity(state, m, p, 0, 0, P.radius);
  if (changed) combat.onMapChange(state, mapId);
  state.focus = null; state.preview = null;
  revealAround(state);
  emit(state, { type: 'teleport', map: mapId });
  state.rev++;
  return true;
}

/* ------------------------------------------------------------------ サービス(各モジュールへ渡す) */
const API = {
  countItem, addItem, removeItem, spawnGround, nodeAlive, moveEntity, teleport, emit, msg,
  onBossDefeated: (state, e) => progression.onBossDefeated(state, e),
  // 睡眠: 通常の敵は消え、ボスは元の状態へ戻る
  onSleep: (state) => {
    state.enemies = state.enemies.filter((e) => e.boss);
    progression.resetAllBosses(state);
    state.projectiles.length = 0;
    state.timers.spawn = BALANCE.safe.spawnCheck;
  },
};
combat.bindCombat(API);
progression.bindProgression(API);

/* ------------------------------------------------------------------ メインステップ */
export function step(state, dt, input = EMPTY) {
  const p = state.player;
  state.time.clock += dt;
  state.time.day = 1 + Math.floor(state.time.clock / BALANCE.day.length);
  state.playTime += dt;
  if (state.hitStop > 0) { state.hitStop -= dt; return; } // ヒットストップ
  if (p.useCd > 0) p.useCd -= dt;

  handleHotbarInput(state, input);
  updateMovement(state, dt, input);
  updateFocus(state, input);
  updatePlacement(state, input, dt);
  updateAction(state, dt, input);
  updateGroundItems(state, dt);
  updateNodes(state, dt);
  updateSurvival(state, dt);
  settlement.stepSettlement(state, dt, API);
  combat.stepCombat(state, dt);
  progression.stepProgress(state, dt);
  state.timers.goals += dt;
  if (state.timers.goals >= 1) { state.timers.goals = 0; settlement.updateGoals(state, API); }
  updateExplored(state);
  updateHints(state);
}

/* ------------------------------------------------------------------ 保存 */
export function serialize(state) {
  const p = state.player;
  const nodes = {};
  for (const [k, v] of state.nodes) {
    if (v.respawnAt == null) continue;
    nodes[k] = isFinite(v.respawnAt) ? { respawnAt: v.respawnAt } : { perm: true };
  }
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const bag = state.deathBag;
  return {
    format: SAVE_FORMAT, version: SAVE_VERSION, genVersion: state.world.genVersion,
    savedAt: new Date().toISOString(), playTime: state.playTime,
    player: {
      map: p.map, x: p.x, y: p.y, hp: p.hp, satiety: p.satiety,
      tools: { ...p.tools }, equip: { ...p.equip }, hotbar: [...p.hotbar],
      bag: p.bag.filter(Boolean).map((s) => ({ id: s.id, n: s.n })),
      spawn: { ...p.spawn }, buffs: p.buffs.map((b) => ({ id: b.id, v: b.v, until: b.until })),
    },
    world: {
      clock: state.time.clock, day: state.time.day,
      structures: state.structures.map((s) => ({ id: s.id, type: s.type, map: s.map, x: s.x, y: s.y, rot: s.rot || 0, fixed: !!s.fixed })),
      containers: clone(state.containers),
      nodes,
      mined: { underground: encodeBits(state.mined.underground) },
      explored: { surface: encodeBits(state.explored.surface), underground: encodeBits(state.explored.underground) },
      farmland: state.farmland.map((f) => ({ map: f.map, x: f.x, y: f.y })),
      crops: state.crops.map((c) => ({ map: c.map, x: c.x, y: c.y, kind: c.kind, growth: c.growth, lastClock: c.lastClock })),
      groundItems: state.groundItems.map((g) => ({ map: g.map, item: g.item, n: g.n, x: g.x, y: g.y })),
      deathBag: bag ? { map: bag.map, x: bag.x, y: bag.y, items: bag.items.map((s) => ({ id: s.id, n: s.n })) } : null,
    },
    progress: clone(state.progress),
  };
}

export function validateSave(obj) { return validateSaveData(obj); }

function dropNotice(state, count, what) {
  if (count > 0) msg(state, `${what}を ${count} 件取り除きました`, 'warn');
}

// 検証済みの save を状態へ反映する(原データは触らない)
function applySave(state, save) {
  const p = state.player, pl = save.player, w = save.world;
  const world = state.world;
  p.map = pl.map;
  p.hp = pl.hp; p.satiety = pl.satiety;
  p.tools = { ...pl.tools };
  p.equip = { ...pl.equip };
  for (const s of pl.bag) addItem(state, s.id, s.n, { silent: true });
  p.hotbar.fill(null);
  pl.hotbar.slice(0, p.hotbar.length).forEach((id, i) => { p.hotbar[i] = id && countItem(state, id) > 0 ? id : null; });
  p.buffs = pl.buffs.map((b) => ({ ...b }));
  state.time.clock = w.clock;
  state.time.day = 1 + Math.floor(w.clock / BALANCE.day.length);
  state.playTime = save.playTime;
  state.progress = {
    ...progression.defaultProgress(), ...JSON.parse(JSON.stringify(save.progress)),
  };
  state.progress.stats.foods ||= {};

  // 採掘済みの壁
  const u = world.underground;
  const mined = w.mined.underground ? decodeBits(w.mined.underground, u.w * u.h) : null;
  if (mined) {
    for (let i = 0; i < mined.length; i++) {
      if (!mined[i]) continue;
      const k = u.wallKind[i];
      if (k >= WALL.DIRT && k <= WALL.IRON) { openWallTile(u, i % u.w, (i / u.w) | 0); state.mined.underground[i] = 1; }
    }
  }
  // 探索済みの範囲
  for (const id of ['surface', 'underground']) {
    const m = world.maps[id];
    const bits = w.explored[id] ? decodeBits(w.explored[id], m.w * m.h) : null;
    if (bits) state.explored[id].set(bits);
  }

  // 構造物(置けない場所のものは取り除く)
  let maxId = 0, badStruct = 0;
  for (const s of w.structures) {
    const m = world.maps[s.map];
    const ok = s.fixed ? !TERRAIN_INFO[getTile(m, s.x, s.y)].solid : isBuildTerrain(m, s.x, s.y);
    if (!ok) { badStruct++; continue; }
    const rec = { id: s.id, type: s.type, map: s.map, x: s.x, y: s.y, rot: s.rot || 0 };
    if (s.fixed) rec.fixed = true;
    if (!addStructureRecord(state, rec)) { badStruct++; continue; }
    maxId = Math.max(maxId, s.id);
  }
  state.nextStructId = maxId + 1;
  dropNotice(state, badStruct, '置けない場所にあった構造物');
  if (!state.structures.some((s) => s.type === 'campfire')) {
    const camp = world.surface.landmarks.camp;
    addStructure(state, 'campfire', 'surface', camp.x, camp.y, 0, { fixed: true });
  }
  for (const [id, slots] of Object.entries(w.containers)) {
    if (state.structures.some((s) => String(s.id) === id)) state.containers[id] = slots.map((s) => (s ? { id: s.id, n: s.n } : null));
  }
  for (const s of state.structures) {
    const def = STRUCTURES[s.type];
    if (def.container && !state.containers[s.id]) state.containers[s.id] = new Array(def.container).fill(null);
  }

  // 畑と作物
  const surface = world.surface;
  const tillable = (x, y) => settlement.isTillableTile(surface, x, y) && !structureAt(state, 'surface', x, y);
  for (const f of w.farmland) if (tillable(f.x, f.y)) addFarmRecord(state, 'surface', f.x, f.y);
  for (const c of w.crops) {
    if (!farmAt(state, 'surface', c.x, c.y)) { if (tillable(c.x, c.y)) addFarmRecord(state, 'surface', c.x, c.y); else continue; }
    addCropRecord(state, { map: 'surface', x: c.x, y: c.y, kind: c.kind, growth: c.growth, lastClock: Math.min(c.lastClock, state.time.clock) });
  }

  // 資源ノードの状態
  for (const [k, v] of Object.entries(w.nodes)) {
    const [mapId, rest] = k.split(':');
    const m = world.maps[mapId];
    const [tx, ty] = rest.split(',').map(Number);
    const node = m && nodeAt(m, tx, ty);
    if (!node) continue;
    state.nodes.set(k, { hp: NODES[node.type].hp || 1, respawnAt: v.perm ? Infinity : v.respawnAt, hitT: 0 });
    state.depleted.add(node);
  }
  for (const g of w.groundItems) {
    state.groundItems.push({ id: state.nextItemId++, map: g.map, item: g.item, n: g.n, x: g.x, y: g.y, z: 0, vz: 0, vx: 0, vy: 0, age: 0, bounced: true });
  }
  state.deathBag = w.deathBag ? { map: w.deathBag.map, x: w.deathBag.x, y: w.deathBag.y, items: w.deathBag.items.map((s) => ({ id: s.id, n: s.n })) } : null;
  if (save.droppedItems) dropNotice(state, save.droppedItems, '未知のアイテムなど');

  // 復活地点と現在位置: 範囲外・壁の中なら歩ける地点へ
  const camp = world.surface.landmarks.camp;
  const defSpawn = { map: 'surface', x: camp.x * TILE + 16, y: camp.y * TILE + 56 };
  p.spawn = pl.spawn ? { ...pl.spawn } : defSpawn;
  const spawnTile = findWalkableNear(world.maps[p.spawn.map], Math.floor(p.spawn.x / TILE), Math.floor(p.spawn.y / TILE), 0);
  if (!spawnTile) {
    const fixed = findWalkableNear(world.maps[p.spawn.map], Math.floor(p.spawn.x / TILE), Math.floor(p.spawn.y / TILE), 6);
    p.spawn = fixed ? { map: p.spawn.map, x: fixed.x * TILE + 16, y: fixed.y * TILE + 16 } : defSpawn;
  }
  placePlayerSafely(state, pl);
}

function placePlayerSafely(state, pl) {
  const p = state.player;
  const sp = state.world.surface.landmarks.spawn;
  let x = pl.x, y = pl.y;
  if (x == null || y == null) { p.map = 'surface'; x = sp.x * TILE + 16; y = sp.y * TILE + 16; }
  const m = state.world.maps[p.map];
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const blocked = TERRAIN_INFO[getTile(m, tx, ty)].solid;
  if (blocked) {
    const spot = findWalkableNear(m, tx, ty, 12);
    if (spot) { x = spot.x * TILE + 16; y = spot.y * TILE + 16; } else { p.map = state.player.spawn.map; x = p.spawn.x; y = p.spawn.y; }
  }
  p.x = x; p.y = y;
  moveEntity(state, state.world.maps[p.map], p, 0, 0, P.radius);
}
