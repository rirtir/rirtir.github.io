// セーブデータの検証・正規化・ビット列(base64)変換。依存: data.js のみ。
// validateSave は原データを書き換えず、throwせず、{ok, save, errors, warnings, droppedItems} を返す。
//   errors   : 読み込めない理由(1つでもあれば ok:false)
//   warnings : 正規化して読み込める問題(未知idの除去、範囲への丸めなど)
import { BALANCE, TILE, ITEMS, STRUCTURES, CROPS, layerOf } from './data.js';

export const SAVE_VERSION = 1;
export const SAVE_FORMAT = 'mosslight-save';
export const MIGRATIONS = {}; // MIGRATIONS[v](save) → v+1

const FORBID = new Set(['__proto__', 'constructor', 'prototype']);
const MAPS = ['surface', 'underground'];
export const GOAL_IDS = ['houses', 'lanterns', 'farms', 'foods', 'residents', 'roads', 'iron', 'rematch'];
const NPC_IDS = ['cook', 'farmer', 'builder'];
const MAX_NODES_VISITED = 2_000_000;

const mapSize = (id) => BALANCE.mapSize[id];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------------------------ ビット列 <-> base64 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DECODE = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

export function encodeBits(flags) {
  const bytes = new Uint8Array(Math.ceil(flags.length / 8));
  for (let i = 0; i < flags.length; i++) if (flags[i]) bytes[i >> 3] |= 1 << (i & 7);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return out;
}

// 長さ(ビット数)が合わない・不正な文字を含む場合は null
export function decodeBits(str, length) {
  if (typeof str !== 'string') return null;
  const nBytes = Math.ceil(length / 8);
  if (str.length !== Math.ceil(nBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return null;
  const bytes = new Uint8Array(Math.ceil(nBytes / 3) * 3);
  for (let i = 0, o = 0; i < str.length; i += 4, o += 3) {
    const c = [0, 1, 2, 3].map((k) => (str[i + k] === '=' ? 0 : DECODE[str[i + k]]));
    const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
    bytes[o] = (n >> 16) & 255; bytes[o + 1] = (n >> 8) & 255; bytes[o + 2] = n & 255;
  }
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return out;
}

/* ------------------------------------------------------------------ 複製(危険なキーを除く) */
function safeClone(v, ctx, depth = 0) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'object') return null;
  if (depth > 16) throw new Error('データの入れ子が深すぎます');
  if (++ctx.count > MAX_NODES_VISITED) throw new Error('データが大きすぎます');
  if (Array.isArray(v)) {
    if (v.length > 500000) throw new Error('配列が大きすぎます');
    return v.map((x) => safeClone(x, ctx, depth + 1));
  }
  const out = {};
  for (const k of Object.keys(v)) {
    if (FORBID.has(k)) { ctx.dangerous++; continue; }
    out[k] = safeClone(v[k], ctx, depth + 1);
  }
  return out;
}

export function migrateSave(obj) {
  let v = obj && obj.version;
  while (Number.isInteger(v) && v < SAVE_VERSION && MIGRATIONS[v]) { obj = MIGRATIONS[v](obj); v = obj.version; }
  return obj;
}

/* ------------------------------------------------------------------ 検証の部品 */
class Check {
  constructor() { this.errors = []; this.warnings = []; this.dropped = 0; this.unknown = new Set(); }
  err(t) { if (!this.errors.includes(t)) this.errors.push(t); }
  warn(t) { if (!this.warnings.includes(t)) this.warnings.push(t); }
  drop(id) { this.dropped++; if (typeof id === 'string') this.unknown.add(id.slice(0, 30)); }
  // 数値フィールド。null/未指定は既定値、文字列などの型違いは errors
  num(v, path, lo, hi, def, int = false) {
    if (v === undefined || v === null) return def;
    if (typeof v !== 'number') { this.err(`${path} が数値ではありません`); return def; }
    let n = Math.max(lo, Math.min(hi, v));
    if (int) n = Math.floor(n);
    if (n !== v) this.warn(`${path} を範囲内に丸めました`);
    return n;
  }
  bool(v, path, def = false) {
    if (v === undefined || v === null) return def;
    if (typeof v !== 'boolean') { this.err(`${path} が真偽値ではありません`); return def; }
    return v;
  }
}

const knownItem = (id) => typeof id === 'string' && Object.hasOwn(ITEMS, id);
const knownStruct = (id) => typeof id === 'string' && Object.hasOwn(STRUCTURES, id);
const knownCrop = (id) => typeof id === 'string' && Object.hasOwn(CROPS, id);

function validMap(c, v, path) {
  if (typeof v !== 'string') { c.err(`${path} のマップ指定が不正です`); return null; }
  return MAPS.includes(v) ? v : null;
}

function normItems(c, list, path, { onlyMaterial = false, max = 400 } = {}) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) { c.err(`${path} が配列ではありません`); return []; }
  if (list.length > max) { c.err(`${path} の件数が多すぎます`); return []; }
  const out = [];
  for (const s of list) {
    if (!isObj(s) || !knownItem(s.id) || typeof s.n !== 'number') { c.drop(isObj(s) ? s.id : null); continue; }
    if (onlyMaterial && ITEMS[s.id].cat !== 'material') { c.warn(`${path} に素材以外が含まれていたので取り除きました`); continue; }
    if (!Number.isFinite(s.n) || s.n < 1) { c.warn(`${path} の不正な個数を取り除きました`); continue; }
    const n = Math.floor(s.n);
    out.push({ id: s.id, n: Math.min(n, BALANCE.death.bagCap) });
  }
  return out;
}

// バッグは 30枠×99個。超過分は鍵アイテムを優先して残し、残りを取り除く
function fitBag(c, items) {
  const totals = new Map();
  for (const s of items) totals.set(s.id, (totals.get(s.id) || 0) + s.n);
  const ids = [...totals.keys()].sort((a, b) => (ITEMS[b].key ? 1 : 0) - (ITEMS[a].key ? 1 : 0));
  const out = [];
  let slots = BALANCE.items.bagSlots;
  for (const id of ids) {
    const stack = ITEMS[id].stack || BALANCE.items.stack;
    const room = slots * stack;
    const n = Math.min(totals.get(id), room);
    if (n < totals.get(id)) c.warn('バッグの上限を超えた分を取り除きました');
    if (n > 0) { out.push({ id, n }); slots -= Math.ceil(n / stack); }
  }
  return out;
}

/* ------------------------------------------------------------------ 本体 */
function validatePlayer(c, raw) {
  const pl = {};
  if (!isObj(raw)) { c.err('player がありません'); return pl; }
  pl.map = raw.map === undefined ? 'surface' : validMap(c, raw.map, 'player.map');
  if (!pl.map) { c.warn('プレイヤーのマップが不明なので地上へ移しました'); pl.map = 'surface'; }
  const [mw, mh] = mapSize(pl.map);
  pl.x = c.num(raw.x, 'player.x', 0, mw * TILE, null);
  pl.y = c.num(raw.y, 'player.y', 0, mh * TILE, null);
  pl.hp = c.num(raw.hp, 'player.hp', 1, BALANCE.player.hpMax, BALANCE.player.hpMax);
  pl.satiety = c.num(raw.satiety, 'player.satiety', 0, BALANCE.hunger.max, BALANCE.hunger.max);
  const t = isObj(raw.tools) ? raw.tools : {};
  if (raw.tools !== undefined && !isObj(raw.tools)) c.err('player.tools の形式が不正です');
  pl.tools = { axe: c.num(t.axe, 'tools.axe', 0, 3, 0, true), pick: c.num(t.pick, 'tools.pick', 0, 3, 0, true), hoe: c.num(t.hoe, 'tools.hoe', 0, 1, 0, true) };
  const eq = isObj(raw.equip) ? raw.equip : {};
  if (raw.equip !== undefined && !isObj(raw.equip)) c.err('player.equip の形式が不正です');
  pl.equip = { weapon: null, armor: null, trinket: null };
  for (const slot of ['weapon', 'armor', 'trinket']) {
    const id = eq[slot];
    if (id === undefined || id === null) continue;
    if (typeof id !== 'string') { c.err(`装備欄 ${slot} の形式が不正です`); continue; }
    if (!knownItem(id)) { c.drop(id); continue; }
    if (ITEMS[id].equip !== slot) { c.err(`装備欄 ${slot} に種類の違うアイテム ${id} があります`); continue; }
    pl.equip[slot] = id;
  }
  pl.bag = fitBag(c, normItems(c, raw.bag, 'player.bag'));
  pl.hotbar = [];
  if (raw.hotbar !== undefined && raw.hotbar !== null && !Array.isArray(raw.hotbar)) c.err('player.hotbar が配列ではありません');
  else if (Array.isArray(raw.hotbar)) {
    if (raw.hotbar.length > 64) c.err('player.hotbar の件数が多すぎます');
    for (const id of raw.hotbar.slice(0, BALANCE.items.hotbarSlots)) {
      if (id === null || id === undefined) { pl.hotbar.push(null); continue; }
      if (!knownItem(id)) { if (typeof id === 'string') c.drop(id); pl.hotbar.push(null); continue; }
      pl.hotbar.push(ITEMS[id].eat || ITEMS[id].place ? id : null);
    }
  }
  pl.spawn = null;
  if (isObj(raw.spawn)) {
    const sm = validMap(c, raw.spawn.map, 'player.spawn.map');
    if (sm) {
      const [sw, sh] = mapSize(sm);
      const sx = c.num(raw.spawn.x, 'spawn.x', 0, sw * TILE, null), sy = c.num(raw.spawn.y, 'spawn.y', 0, sh * TILE, null);
      if (sx !== null && sy !== null) pl.spawn = { map: sm, x: sx, y: sy };
    }
  }
  pl.buffs = [];
  if (Array.isArray(raw.buffs)) {
    for (const b of raw.buffs.slice(0, 12)) {
      if (isObj(b) && typeof b.id === 'string' && b.id.length <= 24 && typeof b.until === 'number' && typeof b.v === 'number') pl.buffs.push({ id: b.id, v: b.v, until: b.until });
    }
  }
  return pl;
}

function validateStructures(c, raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { c.err('world.structures が配列ではありません'); return []; }
  if (raw.length > BALANCE.save.maxStructures) { c.err(`構造物が多すぎます（${raw.length}件）`); return []; }
  const out = [], ids = new Set(), tiles = new Set();
  for (const s of raw) {
    if (!isObj(s)) { c.drop(null); continue; }
    if (!knownStruct(s.type)) { c.drop(s.type); continue; }
    const map = validMap(c, s.map, '構造物');
    if (!map) { c.warn('マップが不明な構造物を取り除きました'); continue; }
    const [w, h] = mapSize(map);
    if (!Number.isInteger(s.x) || !Number.isInteger(s.y) || s.x < 0 || s.y < 0 || s.x >= w || s.y >= h) {
      c.warn('座標が不正な構造物を取り除きました'); continue;
    }
    if (!Number.isInteger(s.id) || s.id < 1) { c.err('構造物のidが不正です'); continue; }
    if (ids.has(s.id)) { c.err(`構造物のid ${s.id} が重複しています`); continue; }
    ids.add(s.id);
    const tk = `${layerOf(s.type)}:${map}:${s.x},${s.y}`;
    if (tiles.has(tk)) { c.err(`同じ場所に同じ層の構造物が重複しています（${map} ${s.x},${s.y}）`); continue; }
    tiles.add(tk);
    out.push({ id: s.id, type: s.type, map, x: s.x, y: s.y, rot: c.num(s.rot, 'structure.rot', 0, 3, 0, true), fixed: s.fixed === true });
  }
  return out;
}

function validateContainers(c, raw, structures) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) { c.err('world.containers の形式が不正です'); return out; }
  const byId = new Map(structures.map((s) => [String(s.id), s]));
  for (const [k, slots] of Object.entries(raw)) {
    const s = byId.get(k);
    if (!s || !STRUCTURES[s.type].container) { c.warn('対応する箱のない収納データを取り除きました'); continue; }
    if (!Array.isArray(slots)) { c.err(`箱 ${k} の中身が配列ではありません`); continue; }
    const size = STRUCTURES[s.type].container;
    if (slots.length > size) { c.err(`箱 ${k} の枠数が多すぎます`); continue; }
    const row = new Array(size).fill(null);
    slots.forEach((it, i) => {
      if (it === null || it === undefined) return;
      if (!isObj(it) || !knownItem(it.id) || typeof it.n !== 'number') { c.drop(isObj(it) ? it.id : null); return; }
      if (!Number.isFinite(it.n) || it.n < 1) { c.warn(`箱 ${k} の不正な個数を取り除きました`); return; }
      const stack = ITEMS[it.id].stack || BALANCE.items.stack;
      row[i] = { id: it.id, n: Math.max(1, Math.min(stack, Math.floor(it.n))) };
    });
    out[k] = row;
  }
  return out;
}

function validateNodes(c, raw) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) { c.err('world.nodes の形式が不正です'); return out; }
  const keys = Object.keys(raw);
  if (keys.length > BALANCE.save.maxNodes) { c.err('資源ノードの状態が多すぎます'); return out; }
  for (const k of keys) {
    const m = /^(surface|underground):(\d{1,3}),(\d{1,3})$/.exec(k);
    const v = raw[k];
    if (!m || !isObj(v)) { c.warn('不正な資源ノードの状態を取り除きました'); continue; }
    const [w, h] = mapSize(m[1]);
    if (+m[2] >= w || +m[3] >= h) { c.warn('マップ外の資源ノードの状態を取り除きました'); continue; }
    if (v.perm === true) out[k] = { perm: true, respawnAt: null };
    else if (typeof v.respawnAt === 'number') out[k] = { perm: false, respawnAt: Math.max(0, Math.min(1e12, v.respawnAt)) };
    else c.warn('不正な資源ノードの状態を取り除きました');
  }
  return out;
}

function validateWorld(c, raw, structures) {
  const w = {};
  if (!isObj(raw)) { c.err('world がありません'); return w; }
  w.clock = c.num(raw.clock, 'world.clock', 0, 1e9, BALANCE.startClock);
  w.structures = structures;
  w.containers = validateContainers(c, raw.containers, structures);
  w.nodes = validateNodes(c, raw.nodes);

  w.mined = {};
  if (raw.mined !== undefined && raw.mined !== null) {
    if (!isObj(raw.mined)) c.err('world.mined の形式が不正です');
    else if (raw.mined.underground !== undefined) {
      const [uw, uh] = mapSize('underground');
      if (!decodeBits(raw.mined.underground, uw * uh)) c.err('採掘データが壊れています');
      else w.mined.underground = raw.mined.underground;
    }
  }
  w.explored = {};
  if (isObj(raw.explored)) {
    for (const id of MAPS) {
      if (raw.explored[id] === undefined) continue;
      const [mw, mh] = mapSize(id);
      if (decodeBits(raw.explored[id], mw * mh)) w.explored[id] = raw.explored[id];
      else c.warn('探索済みの範囲のデータが壊れていたので無視しました');
    }
  }

  w.farmland = [];
  if (raw.farmland !== undefined && raw.farmland !== null) {
    if (!Array.isArray(raw.farmland)) c.err('world.farmland が配列ではありません');
    else if (raw.farmland.length > BALANCE.save.maxFarm) c.err('畑の数が多すぎます');
    else {
      const seen = new Set();
      for (const f of raw.farmland) {
        const [mw, mh] = mapSize('surface');
        if (!isObj(f) || f.map !== 'surface' || !Number.isInteger(f.x) || !Number.isInteger(f.y) || f.x < 0 || f.y < 0 || f.x >= mw || f.y >= mh) { c.warn('不正な畑を取り除きました'); continue; }
        const k = f.y * mw + f.x;
        if (seen.has(k)) continue;
        seen.add(k);
        w.farmland.push({ map: 'surface', x: f.x, y: f.y });
      }
    }
  }
  w.crops = [];
  if (raw.crops !== undefined && raw.crops !== null) {
    if (!Array.isArray(raw.crops)) c.err('world.crops が配列ではありません');
    else if (raw.crops.length > BALANCE.save.maxFarm) c.err('作物の数が多すぎます');
    else {
      const seen = new Set();
      for (const o of raw.crops) {
        if (!isObj(o)) { c.drop(null); continue; }
        if (!knownCrop(o.kind)) { c.drop(o.kind); continue; }
        const [mw, mh] = mapSize('surface');
        if (o.map !== 'surface' || !Number.isInteger(o.x) || !Number.isInteger(o.y) || o.x < 0 || o.y < 0 || o.x >= mw || o.y >= mh) { c.warn('不正な作物を取り除きました'); continue; }
        const k = o.y * mw + o.x;
        if (seen.has(k)) continue;
        seen.add(k);
        const d = CROPS[o.kind], ripe = d.stages * d.stageTime;
        w.crops.push({
          map: 'surface', x: o.x, y: o.y, kind: o.kind, growth: c.num(o.growth, 'crop.growth', 0, ripe, 0),
          lastClock: c.num(o.lastClock, 'crop.lastClock', 0, 1e9, w.clock),
        });
      }
    }
  }
  w.groundItems = [];
  if (raw.groundItems !== undefined && raw.groundItems !== null) {
    if (!Array.isArray(raw.groundItems)) c.err('world.groundItems が配列ではありません');
    else if (raw.groundItems.length > BALANCE.save.maxGround) c.err('落ちているアイテムが多すぎます');
    else {
      for (const g of raw.groundItems) {
        if (!isObj(g) || !knownItem(g.item)) { c.drop(isObj(g) ? g.item : null); continue; }
        const map = MAPS.includes(g.map) ? g.map : null;
        if (!map || typeof g.n !== 'number' || typeof g.x !== 'number' || typeof g.y !== 'number') { c.warn('不正な落下物を取り除きました'); continue; }
        if (!Number.isFinite(g.n) || g.n < 1) { c.warn('不正な個数の落下物を取り除きました'); continue; }
        const [gw, gh] = mapSize(map);
        w.groundItems.push({ map, item: g.item, n: Math.max(1, Math.min(BALANCE.items.stack * BALANCE.items.bagSlots, Math.floor(g.n))), x: Math.max(0, Math.min(gw * TILE, g.x)), y: Math.max(0, Math.min(gh * TILE, g.y)) });
      }
    }
  }
  w.deathBag = null;
  if (raw.deathBag !== undefined && raw.deathBag !== null) {
    if (!isObj(raw.deathBag)) c.err('world.deathBag の形式が不正です');
    else {
      const b = raw.deathBag, map = validMap(c, b.map, 'deathBag');
      const items = normItems(c, b.items, 'deathBag.items', { onlyMaterial: true, max: 100 });
      if (map && items.length) {
        const [bw, bh] = mapSize(map);
        const merged = [];
        for (const s of items) { const h = merged.find((x) => x.id === s.id); if (h) h.n = Math.min(BALANCE.death.bagCap, h.n + s.n); else merged.push(s); }
        w.deathBag = { map, x: c.num(b.x, 'deathBag.x', 0, bw * TILE, 0), y: c.num(b.y, 'deathBag.y', 0, bh * TILE, 0), items: merged };
      }
    }
  }
  return w;
}

function validateProgress(c, raw) {
  const pr = {
    lights: { forge: false, moss: false, ancient: false }, crystalsPlaced: 0, bosses: { vine: false, ash: false },
    braziers: [false, false, false], npcs: {}, goals: {}, cleared: false, seen: {}, hints: {}, built: {},
    stats: { gathered: 0, crafted: 0, foods: {} }, fountain: false,
  };
  if (!isObj(raw)) { c.err('progress（進行状況）の構造が壊れています'); return pr; }
  if (raw.lights !== undefined && !isObj(raw.lights)) c.err('progress.lights の形式が不正です');
  const lt = isObj(raw.lights) ? raw.lights : {};
  for (const id of ['forge', 'moss', 'ancient']) pr.lights[id] = c.bool(lt[id], `progress.lights.${id}`);
  pr.crystalsPlaced = c.num(raw.crystalsPlaced, 'progress.crystalsPlaced', 0, 3, 0, true);
  if (raw.bosses !== undefined && !isObj(raw.bosses)) c.err('progress.bosses の形式が不正です');
  const bs = isObj(raw.bosses) ? raw.bosses : {};
  pr.bosses = { vine: c.bool(bs.vine, 'progress.bosses.vine'), ash: c.bool(bs.ash, 'progress.bosses.ash') };
  if (raw.braziers !== undefined && !Array.isArray(raw.braziers)) c.err('progress.braziers が配列ではありません');
  if (Array.isArray(raw.braziers)) pr.braziers = [0, 1, 2].map((i) => c.bool(raw.braziers[i], `progress.braziers[${i}]`));
  pr.cleared = c.bool(raw.cleared, 'progress.cleared');
  pr.fountain = c.bool(raw.fountain, 'progress.fountain');

  if (raw.npcs !== undefined && !isObj(raw.npcs)) c.err('progress.npcs の形式が不正です');
  if (isObj(raw.npcs)) {
    for (const id of NPC_IDS) {
      const r = raw.npcs[id];
      if (r === undefined || r === null) continue;
      if (!isObj(r)) { c.err(`progress.npcs.${id} の形式が不正です`); continue; }
      const basket = {};
      if (isObj(r.basket)) {
        for (const [item, n] of Object.entries(r.basket)) {
          if (FORBID.has(item)) continue;
          if (!knownItem(item) || typeof n !== 'number') { c.drop(item); continue; }
          basket[item] = Math.max(0, Math.min(9999, Math.floor(n)));
        }
      }
      pr.npcs[id] = {
        joined: c.bool(r.joined, `progress.npcs.${id}.joined`), arrivingAt: c.num(r.arrivingAt, 'npc.arrivingAt', 0, 1e9, 0),
        basket, lastProduced: c.num(r.lastProduced, 'npc.lastProduced', 0, 1e9, 0),
        house: typeof r.house === 'string' && r.house.length <= 40 ? r.house : null,
      };
    }
  }
  if (isObj(raw.goals)) for (const id of GOAL_IDS) if (raw.goals[id] === true) pr.goals[id] = true;
  if (isObj(raw.seen)) for (const id of Object.keys(raw.seen)) if (knownItem(id) && raw.seen[id]) pr.seen[id] = 1;
  if (isObj(raw.hints)) {
    for (const k of Object.keys(raw.hints).slice(0, 80)) if (k.length <= 40 && raw.hints[k]) pr.hints[k] = 1;
  }
  if (isObj(raw.built)) for (const k of Object.keys(raw.built)) if (knownStruct(k) && raw.built[k]) pr.built[k] = 1;
  if (raw.stats !== undefined && !isObj(raw.stats)) c.err('progress.stats の形式が不正です');
  const st = isObj(raw.stats) ? raw.stats : {};
  for (const k of ['gathered', 'crafted', 'kills', 'planted', 'tilled', 'harvested', 'deaths']) {
    if (st[k] !== undefined) pr.stats[k] = c.num(st[k], `progress.stats.${k}`, 0, 1e9, 0, true);
  }
  pr.stats.gathered = pr.stats.gathered || 0; pr.stats.crafted = pr.stats.crafted || 0;
  if (isObj(st.foods)) for (const id of Object.keys(st.foods)) if (knownItem(id) && st.foods[id]) pr.stats.foods[id] = 1;
  pr.stats.rematchVine = st.rematchVine === true; pr.stats.rematchAsh = st.rematchAsh === true;

  // 矛盾の補正: 古灯は炉と苔の灯が前提、苔の灯は結晶3個とボス撃破が前提
  if (pr.lights.ancient && !(pr.lights.forge && pr.lights.moss)) { pr.lights.forge = true; pr.lights.moss = true; c.warn('進行状況の矛盾を補正しました'); }
  if (pr.lights.moss && (pr.crystalsPlaced < 3 || !pr.bosses.vine)) { pr.crystalsPlaced = 3; pr.bosses.vine = true; c.warn('進行状況の矛盾を補正しました'); }
  if (pr.lights.ancient && (!pr.bosses.ash || !pr.braziers.every(Boolean))) { pr.bosses.ash = true; pr.braziers = [true, true, true]; c.warn('進行状況の矛盾を補正しました'); }
  if (pr.bosses.ash && !pr.braziers.every(Boolean)) { pr.braziers = [true, true, true]; c.warn('進行状況の矛盾を補正しました'); }
  pr.cleared = pr.lights.ancient;
  return pr;
}

function validate(obj, c) {
  if (!isObj(obj)) { c.err('データが読み取れません'); return null; }
  if (obj.format !== SAVE_FORMAT) c.err('苔灯の境のセーブではありません');
  if (!Number.isInteger(obj.version) || obj.version < 1) c.err('セーブのバージョンが不正です');
  else if (obj.version > SAVE_VERSION) c.err(`新しいバージョンのセーブ（v${obj.version}）なので、このゲームでは読み込めません`);
  if (!isObj(obj.player) || !isObj(obj.world)) c.err('必須の項目（player / world）がありません');
  if (!isObj(obj.progress)) c.err('progress（進行状況）の構造が壊れています');
  if (c.errors.length) return null;

  const ctx = { count: 0, dangerous: 0 };
  const clone = safeClone(obj, ctx);
  if (ctx.dangerous) c.warn(`危険なキーを ${ctx.dangerous} 件取り除きました`);
  const save = migrateSave(clone);
  if (!isObj(save)) { c.err('セーブの移行に失敗しました'); return null; }
  if (typeof save.genVersion === 'number' && save.genVersion !== BALANCE.genVersion) c.warn('世界の生成バージョンが異なります。配置が変わっている場合があります');

  const player = validatePlayer(c, save.player);
  const structures = validateStructures(c, save.world.structures);
  const world = validateWorld(c, save.world, structures);
  const progress = validateProgress(c, save.progress);
  return {
    format: SAVE_FORMAT, version: SAVE_VERSION, genVersion: typeof save.genVersion === 'number' ? save.genVersion : BALANCE.genVersion,
    savedAt: typeof save.savedAt === 'string' ? save.savedAt.slice(0, 40) : '', playTime: c.num(save.playTime, 'playTime', 0, 1e9, 0),
    player, world, progress,
  };
}

export function validateSave(obj) {
  const c = new Check();
  let save = null;
  try {
    save = validate(obj, c);
  } catch (e) {
    c.err(`セーブの検証中に問題が起きました（${e && e.message ? e.message : '不明'}）`);
    save = null;
  }
  if (c.errors.length || !save) return { ok: false, save: null, errors: c.errors, warnings: c.warnings, droppedItems: c.dropped, unknownIds: [...c.unknown] };
  save.droppedItems = c.dropped;
  if (c.dropped) c.warn(`未知のアイテムや構造物 ${c.dropped} 件を取り除きました`);
  return { ok: true, save, errors: [], warnings: c.warnings, droppedItems: c.dropped, unknownIds: [...c.unknown] };
}

// タイトル画面の表示用。検証に通らなければ null
export function summarizeSave(obj) {
  const r = validateSave(obj);
  if (!r.ok) return null;
  const L = r.save.progress.lights;
  return { savedAt: r.save.savedAt, playTime: r.save.playTime, lights: ['forge', 'moss', 'ancient'].filter((k) => L[k]).length, cleared: r.save.progress.cleared };
}
