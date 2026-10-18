// 暮らしの活動 — 釣り・住人の依頼・図鑑・装備効果と携帯灯・新ノードの補充。
// 依存: data.js, world.js, layers.js のみ(simulation/combat/settlement/save/progression を import しない)。
// simulation.js が bindActivities(services) で バッグ操作とメッセージの道具を渡し、各APIを再exportする。
//   services: { countItem, addItem, removeItem, spawnGround, emit, msg }
// 契約・状態の形は .review/v6/CORE_IMPLEMENTATION.md を参照。
import {
  BALANCE, TILE, TERRAIN_INFO, ITEMS, NODES, FISH, FISH_TIME_RANGES, ROD_STATS, BAIT_STATS, REQUESTS, JOURNAL, SPAWN_RULES, SPAWN_POLICY, NPCS,
} from './data.js';
import {
  mulberry32, nodeAt, inBounds, isWaterTile, addContentNode, resetContentNodes, contentSpotOk, contentReach,
} from './world.js';
import { objectAt, floorAt, farmAt, cropAt } from './layers.js';

const P = BALANCE.player;
const DAY = BALANCE.day.length;
const FORBID = new Set(['__proto__', 'constructor', 'prototype']);
const JOURNAL_KINDS = ['fish', 'forage', 'dish', 'crop'];
const STAGES = ['start', 'furnace', 'moss', 'seal'];
const STAGE_LABEL = { start: 'いつでも', furnace: '炉の灯を取り戻すと', moss: '苔の灯を取り戻すと', seal: '封印が開くと' };
const CAST_RANGE = 4;          // 竿を投げられる距離(タイル)
const MOVE_CANCEL = 0.6 * TILE; // 原点からこれ以上動くと取消
const CAVE_BASE_LIGHT = Object.freeze({ radius: 1.5, color: '#bcd4ea', intensity: 0.3, flicker: 0 });
const NO_LIGHT = Object.freeze({ radius: 0, color: '#ffd27a', intensity: 0, flicker: 0 });

let svc = null;
export function bindActivities(services) { svc = services; }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(v)));
const emit = (state, e) => { if (svc) svc.emit(state, e); else state.events.push(e); };
const msg = (state, text, tone = 'info') => emit(state, { type: 'msg', text, tone });

// 文字列つきの種(uint32)。世界の種とキーから決まる。生成RNGや state.rng には触れない
export function hashSeed(seed, key) {
  let h = ((seed | 0) ^ 0x9E3779B9) >>> 0;
  const s = String(key);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297A2D39) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}

/* ------------------------------------------------------------------ progress の既定値と検証 */
export function defaultContentProgress() {
  return { requests: {}, journal: { fish: {}, forage: {}, dish: {}, crop: {} }, fishing: { casts: 0, catches: 0 } };
}

// 戻り値 {value:{requests,journal,fishing}, problems:n}。未知id・型違いは捨てて既定値。throwしない
export function validateContentProgress(raw) {
  const out = defaultContentProgress();
  let problems = 0;
  const src = isObj(raw) ? raw : {};
  if (raw !== undefined && raw !== null && !isObj(raw)) problems++;
  if (src.requests !== undefined) {
    if (!isObj(src.requests)) problems++;
    else {
      for (const id of Object.keys(src.requests).slice(0, 200)) {
        if (FORBID.has(id) || !Object.hasOwn(REQUESTS, id)) { problems++; continue; }
        if (src.requests[id] === true || src.requests[id] === 1) out.requests[id] = 1;
        else if (src.requests[id]) problems++;
      }
    }
  }
  if (src.journal !== undefined) {
    if (!isObj(src.journal)) problems++;
    else {
      for (const kind of JOURNAL_KINDS) {
        const part = src.journal[kind];
        if (part === undefined) continue;
        if (!isObj(part)) { problems++; continue; }
        for (const id of Object.keys(part).slice(0, 200)) {
          if (FORBID.has(id) || !Object.hasOwn(JOURNAL[kind], id)) { problems++; continue; }
          const v = part[id];
          if (kind === 'fish') {
            if (!isObj(v) || typeof v.n !== 'number' || !isFinite(v.n)) { problems++; continue; }
            const n = clampInt(v.n, 0, 1e6);
            if (n < 1) continue;
            out.journal.fish[id] = { n, max: typeof v.max === 'number' && isFinite(v.max) ? clampInt(v.max, 0, 999) : 0 };
          } else {
            if (typeof v !== 'number' || !isFinite(v)) { problems++; continue; }
            const n = clampInt(v, 0, 1e6);
            if (n >= 1) out.journal[kind][id] = n;
          }
        }
      }
    }
  }
  if (src.fishing !== undefined) {
    if (!isObj(src.fishing)) problems++;
    else {
      for (const k of ['casts', 'catches']) {
        const v = src.fishing[k];
        if (v === undefined) continue;
        if (typeof v !== 'number' || !isFinite(v)) { problems++; continue; }
        out.fishing[k] = clampInt(v, 0, 1e6);
      }
    }
  }
  return { value: out, problems };
}

function content(state) {
  const pr = state.progress;
  if (!isObj(pr.requests)) pr.requests = {};
  if (!isObj(pr.journal)) pr.journal = {};
  for (const k of JOURNAL_KINDS) if (!isObj(pr.journal[k])) pr.journal[k] = {};
  if (!isObj(pr.fishing)) pr.fishing = { casts: 0, catches: 0 };
  return pr;
}

/* ------------------------------------------------------------------ 図鑑 */
// kind: fish / forage / dish / crop。id は JOURNAL[kind] のキー。n は「実際に得た数量」。未知は無視。初めてなら true
export function recordSeen(state, kind, id, n = 1, size = 0) {
  if (!JOURNAL_KINDS.includes(kind) || typeof id !== 'string' || !Object.hasOwn(JOURNAL[kind], id)) return false;
  if (!(n >= 1)) return false;
  const pr = content(state), add = clampInt(n, 1, 1e6);
  const book = pr.journal[kind];
  let first = false;
  if (kind === 'fish') {
    const cur = book[id] || (first = true, book[id] = { n: 0, max: 0 });
    cur.n = Math.min(1e6, cur.n + add);
    cur.max = Math.max(cur.max, clampInt(size || 0, 0, 999));
  } else {
    if (!book[id]) first = true;
    book[id] = Math.min(1e6, (book[id] || 0) + add);
  }
  state.rev++;
  if (first) {
    emit(state, { type: 'journal', kind, id, name: JOURNAL[kind][id].name });
    msg(state, `図鑑に登録：${JOURNAL[kind][id].name}`, 'good');
  }
  return first;
}

export function journalCount(state, kind) {
  const book = content(state).journal[kind] || {};
  return Object.keys(JOURNAL[kind] || {}).filter((id) => (kind === 'fish' ? book[id] && book[id].n >= 1 : book[id] >= 1)).length;
}

const JOURNAL_TITLE = { fish: '魚', forage: '採集', dish: '料理', crop: '作物' };
// [{kind,title,total,seen,entries:[{id,name,item,icon,seen,n,max}]}] を kind の順(fish,forage,dish,crop)で返す
export function getJournalEntries(state) {
  const pr = content(state);
  return JOURNAL_KINDS.map((kind) => {
    const book = pr.journal[kind];
    const entries = Object.entries(JOURNAL[kind]).map(([id, d]) => {
      const rec = book[id];
      const n = kind === 'fish' ? (rec ? rec.n : 0) : (rec || 0);
      return {
        id, name: d.name, item: d.item, icon: ITEMS[d.item] ? ITEMS[d.item].icon : null, seen: n >= 1, n,
        ...(kind === 'fish' ? { max: rec ? rec.max : 0 } : {}),
      };
    });
    return { kind, title: JOURNAL_TITLE[kind], total: entries.length, seen: entries.filter((e) => e.seen).length, entries };
  });
}

/* ------------------------------------------------------------------ 装備の効果・光 */
function buffSum(state, id) {
  let v = 0;
  for (const b of state.player.buffs) if (b.id === id && b.until > state.time.clock) v += b.v;
  return v;
}

// 実際の装備スロット(防具・装飾)と、期限内のbuffだけから合算する。持っているだけでは効かない
//   speed(加算) def(加算) regen(10秒あたりHP) fishWindow(加算秒) fishBite/satietyRate(倍率) light(装備の灯 or null) lightBonus(buffの半径加算)
export function getEquipStats(state) {
  const eq = state.player.equip;
  const s = { speed: 0, def: 0, regen: 0, fishWindow: 0, fishBite: 1, satietyRate: 1, light: null, lightBonus: 0 };
  for (const slot of ['armor', 'trinket']) {
    const id = eq[slot], def = id ? ITEMS[id] : null, e = def && def[slot];
    if (!e) continue;
    if (typeof e.speed === 'number') s.speed += e.speed;
    if (typeof e.def === 'number') s.def += e.def;
    if (typeof e.regen === 'number') s.regen += e.regen;
    if (typeof e.fishWindow === 'number') s.fishWindow += e.fishWindow;
    if (typeof e.fishBite === 'number') s.fishBite *= e.fishBite;
    if (typeof e.satietyRate === 'number') s.satietyRate *= e.satietyRate;
    if (isObj(e.light) && e.light.radius > 0 && (!s.light || e.light.radius > s.light.radius)) {
      s.light = { radius: e.light.radius, color: e.light.color, intensity: e.light.intensity, flicker: e.light.flicker };
    }
  }
  s.speed += buffSum(state, 'speed');
  s.def += buffSum(state, 'def');
  s.regen += buffSum(state, 'regen');
  s.fishWindow += buffSum(state, 'fishWindow');
  s.fishBite *= Math.max(0.1, 1 + buffSum(state, 'fishBite'));
  s.satietyRate *= Math.max(0.1, 1 + buffSum(state, 'satietyRate'));
  s.lightBonus = buffSum(state, 'light');
  return s;
}

// {radius(タイル),color,intensity,flicker}。無装備の地上は radius 0、地下は視認救済 1.5。装備の灯が大きければそちら(max)。buffのlightは半径に加算
export function getPlayerLight(state) {
  const base = state.player.map === 'underground' ? CAVE_BASE_LIGHT : NO_LIGHT;
  const st = getEquipStats(state);
  const src = st.light && st.light.radius > base.radius ? st.light : base;
  const out = { radius: src.radius, color: src.color, intensity: src.intensity, flicker: src.flicker };
  if (out.radius > 0 && st.lightBonus) out.radius = Math.max(0, out.radius + st.lightBonus);
  return out;
}

/* ------------------------------------------------------------------ 釣り */
export function fishTimeSlot(tod) {
  const t = ((tod % DAY) + DAY) % DAY;
  for (const [slot, ranges] of Object.entries(FISH_TIME_RANGES)) for (const [a, b] of ranges) if (t >= a && t < b) return slot;
  return 'day';
}

const caveFish = () => Object.values(FISH).some((f) => f.regions.includes('cave'));

// 水のマスの区分。地下の水=cave(割り当てる魚が無ければ表はdeepで引く)、陸地がChebyshev距離2以内=shore、それ以外=deep
export function fishRegion(map, cx, cy) {
  if (map.id === 'underground') return 'cave';
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy;
      if (inBounds(map, x, y) && !isWaterTile(map, x, y)) return 'shore';
    }
  }
  return 'deep';
}

// 抽選表: [{id, weight}]。bait は餌アイテムid(または null)。竿の段階・時間帯・餌で絞る
export function fishTable(region, slot, rod, bait) {
  const r = region === 'cave' && !caveFish() ? 'deep' : region;
  const rows = [];
  for (const [id, f] of Object.entries(FISH)) {
    if (!f.regions.includes(r) || !f.time.includes(slot) || f.minRod > rod) continue;
    if (f.bait && f.bait !== bait) continue;
    rows.push({ id, weight: f.weight });
  }
  return rows;
}

function pickBait(state, slot, casts) {
  const options = Object.keys(ITEMS).filter((id) => {
    const b = ITEMS[id].bait;
    return b && BAIT_STATS[b] && svc.countItem(state, id) > 0 && (!BAIT_STATS[b].times || BAIT_STATS[b].times.includes(slot));
  }).sort();
  return options.length ? options[casts % options.length] : null; // 複数持つときは投げるたびに交互(夜は虫餌と光る餌の魚の両方へ届く)
}

function selectedRod(state) {
  const p = state.player, id = p.sel >= 0 ? p.hotbar[p.sel] : null;
  const def = id ? ITEMS[id] : null;
  return def && def.rod && svc.countItem(state, id) > 0 ? { id, tier: def.rod } : null;
}

const cellOf = (c) => (Array.isArray(c) ? { x: c[0], y: c[1] } : c);

// aimCell: {x,y}(タイル座標)。成功 {ok:true, fishing}、失敗 {ok:false, reason}。失敗でも何も消費しない
export function startCast(state, aimCell) {
  const p = state.player, fail = (reason) => { msg(state, reason, 'warn'); return { ok: false, reason }; };
  const c = cellOf(aimCell);
  if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y)) return { ok: false, reason: '狙う場所がない' };
  if (state.fishing) return { ok: false, reason: 'すでに釣り中' };
  const rod = selectedRod(state);
  if (!rod) return fail('ホットバーで釣り竿を選ぼう');
  if (p.action || p.roll) return { ok: false, reason: 'ほかの行動中' };
  const map = state.world.maps[p.map];
  if (isWaterTile(map, Math.floor(p.x / TILE), Math.floor(p.y / TILE))) return fail('水の上では釣れない');
  if (!isWaterTile(map, c.x, c.y)) return fail('水面を狙おう');
  if (Math.hypot(c.x * TILE + 16 - p.x, c.y * TILE + 16 - p.y) > CAST_RANGE * TILE) return fail('遠すぎる。水辺に近づこう');
  const pr = content(state);
  const seedKey = pr.fishing.casts;
  const rng = mulberry32(hashSeed(state.world.seed, `fish:${seedKey}`));
  const slot = fishTimeSlot(state.time.clock);
  const bait = pickBait(state, slot, seedKey);
  const baitKind = bait ? ITEMS[bait].bait : null;
  const st = getEquipStats(state);
  const mult = Math.max(0.25, (ROD_STATS[rod.tier] ? ROD_STATS[rod.tier].biteMul : 1) * (baitKind ? BAIT_STATS[baitKind].biteMul : 1) * st.fishBite);
  pr.fishing.casts = Math.min(1e6, pr.fishing.casts + 1);
  const f = {
    id: pr.fishing.casts, phase: 'wait', ox: p.x, oy: p.y, cx: c.x, cy: c.y, layer: p.map, rod: rod.tier, rodItem: rod.id, bait,
    t: 0, biteAt: (4 + rng() * 5) * mult, window: 0, fish: null, size: 0, fresh: true,
  };
  Object.defineProperty(f, 'rng', { value: rng, enumerable: false });
  state.fishing = f;
  p.action = { type: 'fish', t: 0 };
  const dx = c.x * TILE + 16 - p.x, dy = c.y * TILE + 16 - p.y, d = Math.hypot(dx, dy);
  if (d > 0.5) { p.fx = dx / d; p.fy = dy / d; p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); }
  state.rev++;
  emit(state, { type: 'cast', x: c.x * TILE + 16, y: c.y * TILE + 16, id: f.id });
  return { ok: true, fishing: f };
}

const CANCEL_TEXT = {
  act: '早すぎた。まだ食いついていない', miss: '逃げられてしまった…', moved: '動いたので糸を巻き上げた', switch: '竿をしまった',
  water: '水面から離れた', nobait: '餌がなくなった', full: 'バッグがいっぱいで釣り上げられなかった', manual: '糸を巻き上げた',
};
// 何も消費しない。reason: act / miss / moved / dodge / damage / modal / mapchange / switch / water / nobait / full / manual / interrupted
export function cancelFishing(state, reason = 'manual') {
  const f = state.fishing;
  if (!f) return false;
  state.fishing = null;
  const p = state.player;
  if (p.action && p.action.type === 'fish') p.action = null;
  p.useCd = Math.max(p.useCd || 0, 0.25);
  state.rev++;
  emit(state, { type: 'fishCancel', reason, id: f.id });
  if (CANCEL_TEXT[reason]) msg(state, CANCEL_TEXT[reason], reason === 'full' || reason === 'nobait' ? 'warn' : 'info');
  return true;
}

// 仮想のバッグで「removes を引いたあとに adds が全量入るか」を検査する(コピーのみ。実バッグは触らない)
export function bagFits(state, removes, adds) {
  const bag = state.player.bag.map((s) => (s ? { id: s.id, n: s.n } : null));
  for (const [id, n] of removes) {
    let left = n;
    for (let i = bag.length - 1; i >= 0 && left > 0; i--) {
      const s = bag[i];
      if (!s || s.id !== id) continue;
      const t = Math.min(s.n, left);
      s.n -= t; left -= t;
      if (s.n <= 0) bag[i] = null;
    }
    if (left > 0) return false;
  }
  for (const [id, n] of adds) {
    const def = ITEMS[id];
    if (!def) return false;
    const max = def.stack || BALANCE.items.stack;
    let left = n;
    for (const s of bag) if (left > 0 && s && s.id === id && s.n < max) { const t = Math.min(max - s.n, left); s.n += t; left -= t; }
    for (let i = 0; i < bag.length && left > 0; i++) if (!bag[i]) { const t = Math.min(max, left); bag[i] = { id, n: t }; left -= t; }
    if (left > 0) return false;
  }
  return true;
}

function startBite(state, f) {
  const p = state.player, map = state.world.maps[f.layer];
  const slot = fishTimeSlot(state.time.clock);
  const rows = fishTable(fishRegion(map, f.cx, f.cy), slot, f.rod, f.bait);
  const list = rows.length ? rows : fishTable(fishRegion(map, f.cx, f.cy), slot, 1, null); // 満たす魚がなければ餌なし・竿1の表
  const total = list.reduce((a, r) => a + r.weight, 0);
  let roll = f.rng() * total, pick = list[list.length - 1];
  for (const r of list) { roll -= r.weight; if (roll < 0) { pick = r; break; } }
  const def = FISH[pick.id];
  f.fish = pick.id;
  f.size = Math.round(def.sizeMin + f.rng() * (def.sizeMax - def.sizeMin));
  const st = getEquipStats(state);
  f.window = Math.max(0.3, (ROD_STATS[f.rod] ? ROD_STATS[f.rod].window : 0.8) + st.fishWindow);
  f.phase = 'bite';
  f.biteStart = f.t;
  state.rev++;
  emit(state, { type: 'fishBite', x: f.cx * TILE + 16, y: f.cy * TILE + 16, id: f.id, px: p.x, py: p.y });
}

// 先に fishing=null にしてから容量を判定する(二重catch防止)。入らなければ何も消費せず「満杯」
function hook(state, f) {
  state.fishing = null;
  const p = state.player;
  if (p.action && p.action.type === 'fish') p.action = null;
  p.useCd = Math.max(p.useCd || 0, 0.3);
  const def = FISH[f.fish];
  if (!def || !ITEMS[def.item]) { emit(state, { type: 'fishCancel', reason: 'interrupted', id: f.id }); return false; }
  if (f.bait && svc.countItem(state, f.bait) < 1) { emit(state, { type: 'fishCancel', reason: 'nobait', id: f.id }); msg(state, CANCEL_TEXT.nobait, 'warn'); return false; }
  if (!bagFits(state, f.bait ? [[f.bait, 1]] : [], [[def.item, 1]])) {
    emit(state, { type: 'fishCancel', reason: 'full', id: f.id }); msg(state, CANCEL_TEXT.full, 'warn'); return false;
  }
  if (f.bait) svc.removeItem(state, f.bait, 1);
  svc.addItem(state, def.item, 1, { silent: true });
  const pr = content(state);
  pr.fishing.catches = Math.min(1e6, pr.fishing.catches + 1);
  recordSeen(state, 'fish', f.fish, 1, f.size);
  state.progress.stats.fished = (state.progress.stats.fished || 0) + 1;
  state.rev++;
  emit(state, { type: 'fishCatch', fish: f.fish, item: def.item, size: f.size, id: f.id, x: f.cx * TILE + 16, y: f.cy * TILE + 16 });
  emit(state, { type: 'gain', item: def.item, n: 1 });
  msg(state, `${def.name}を釣った！（${f.size}cm）`, 'good');
  return true;
}

export function updateFishing(state, dt, input) {
  const f = state.fishing;
  if (!f) return;
  const p = state.player;
  if (p.map !== f.layer) return void cancelFishing(state, 'mapchange');
  if (p.roll) return void cancelFishing(state, 'dodge');
  if (!p.action || p.action.type !== 'fish') return void cancelFishing(state, 'interrupted');
  const rod = selectedRod(state);
  if (!rod || rod.id !== f.rodItem) return void cancelFishing(state, 'switch');
  if (Math.hypot(p.x - f.ox, p.y - f.oy) > MOVE_CANCEL) return void cancelFishing(state, 'moved');
  if (!isWaterTile(state.world.maps[f.layer], f.cx, f.cy)) return void cancelFishing(state, 'water');
  f.t += dt;
  // 入力が処理されるステップの時刻で期限を判定する。終端ちょうどは有効。
  if (f.phase === 'bite' && f.t - f.biteStart > f.window + 1e-9) return void cancelFishing(state, 'miss');
  const pressed = !!(input && input.actPressed) && !f.fresh; // 投げた同じ入力では取り消さない
  f.fresh = false;
  if (pressed) {
    if (f.phase === 'bite') { hook(state, f); return; }
    cancelFishing(state, 'act');
    return;
  }
  if (f.phase === 'wait') {
    if (f.t >= f.biteAt) startBite(state, f);
  }
}

/* ------------------------------------------------------------------ 住人の依頼 */
const stageOk = (state, stage) => {
  const L = state.progress.lights;
  if (stage === 'start') return true;
  if (stage === 'furnace') return !!L.forge;
  if (stage === 'moss') return !!L.moss;
  if (stage === 'seal') return !!(L.forge && L.moss);
  return false;
};

function rewardList(def) {
  return Object.entries((def.reward && def.reward.items) || {}).map(([item, n]) => ({ item, name: ITEMS[item] ? ITEMS[item].name : item, icon: ITEMS[item] ? ITEMS[item].icon : null, n }));
}

// UI用の状態。code: ok / done / stage / absent / far / short / full / unknown。ok=true のときだけ納品できる
export function requestStatus(state, id) {
  const def = typeof id === 'string' && Object.hasOwn(REQUESTS, id) ? REQUESTS[id] : null;
  if (!def || !STAGES.includes(def.stage) || !NPCS[def.npc] || !def.needs || !def.reward) {
    return { id, ok: false, code: 'unknown', reason: '知らない依頼', done: false, needs: [], reward: [] };
  }
  const pr = content(state), p = state.player;
  const needs = Object.entries(def.needs).map(([item, need]) => {
    const have = ITEMS[item] ? svc.countItem(state, item) : 0;
    return { item, name: ITEMS[item] ? ITEMS[item].name : item, icon: ITEMS[item] ? ITEMS[item].icon : null, need, have, ok: have >= need };
  });
  const record = state.progress.npcs[def.npc], res = state.npcs.find((n) => n.id === def.npc);
  const npcName = NPCS[def.npc].name;
  const base = {
    id, npc: def.npc, npcName, stage: def.stage, text: def.text, needs, reward: rewardList(def), ok: false, code: 'ok', reason: '',
    done: !!pr.requests[id], available: stageOk(state, def.stage), present: !!(record && record.joined && res),
    near: !!(res && p.map === 'surface' && Math.hypot(res.x - p.x, res.y - p.y) <= P.stationRange + 16),
  };
  const no = (code, reason) => ({ ...base, code, reason });
  if (base.done) return no('done', '達成済み');
  if (!base.available) return no('stage', `${STAGE_LABEL[def.stage]}受けられる`);
  if (!base.present) return no('absent', `${npcName}がまだ来ていない`);
  if (!base.near) return no('far', `${npcName}に近づこう`);
  const lack = needs.find((n) => !n.ok);
  if (lack) return no('short', `${lack.name}が足りない（${lack.have}/${lack.need}）`);
  if (!bagFits(state, Object.entries(def.needs), Object.entries(def.reward.items))) return no('full', 'バッグがいっぱいで報酬を受け取れない');
  return { ...base, ok: true };
}

export function getRequests(state) { return Object.keys(REQUESTS).map((id) => requestStatus(state, id)); }

// 検査はすべて先に行う(stage→未達成→在籍・近傍→所持→報酬が全量入る)。通ったら消費→受取→達成記録。成功後の再納品は不可
export function deliverRequest(state, id) {
  const st = requestStatus(state, id);
  if (!st.ok) {
    if (st.code !== 'unknown') msg(state, st.reason, 'warn');
    return { ok: false, code: st.code, reason: st.reason };
  }
  const def = REQUESTS[id];
  for (const [item, n] of Object.entries(def.needs)) svc.removeItem(state, item, n);
  for (const [item, n] of Object.entries(def.reward.items)) {
    const left = svc.addItem(state, item, n);
    if (left > 0) svc.spawnGround(state, state.player.map, state.player.x, state.player.y, item, left); // 事前検査で入る前提。万一でも失わない
  }
  content(state).requests[id] = 1;
  state.rev++;
  emit(state, { type: 'request', id });
  emit(state, { type: 'save' });
  msg(state, `${st.npcName}の依頼を果たした`, 'good');
  return { ok: true, code: 'ok', reward: st.reward };
}

export function requestsDone(state) { const r = content(state).requests; return Object.keys(REQUESTS).filter((id) => r[id]).length; }

/* ------------------------------------------------------------------ 新ノードの補充 */
export function prepareContentWorld(world) { resetContentNodes(world); }

const NEAR_ROCK = new Set(['rock', 'copper_deposit']);

function nearCondition(m, kind, x, y) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (kind === 'water') { if (inBounds(m, x + dx, y + dy) && isWaterTile(m, x + dx, y + dy)) return true; }
      else if (kind === 'rock') { const n = nodeAt(m, x + dx, y + dy); if (n && NEAR_ROCK.has(n.type)) return true; }
    }
  }
  return false;
}

// SPAWN_RULES を配列順に。ruleごとに独立RNG(hash(worldSeed,'c1:'+id))で候補を1回だけ固定シャッフルし、
// 世界生成だけで決まる条件を通った候補を count 個まで採る(採ったセルは minGap/後続ruleのために「確保済み」にする)。
// structure/crop/畑/家に重なる採用候補は置かずにskip。穴埋めしないので他のnode keyは動かない。旧生成RNGには触れない
export function augmentContentNodes(state, pendingNodeSave = {}) {
  const world = state.world, stats = { placed: 0, skipped: 0, applied: 0, rules: {} };
  const taken = { surface: new Set(), underground: new Set() };
  const reachBase = BALANCE.safe.radius;
  for (const rule of SPAWN_RULES) {
    const m = world.maps[rule.layer];
    if (!m || !NODES[rule.node]) continue;
    const rng = mulberry32(hashSeed(world.seed, SPAWN_POLICY.seedPrefix + rule.id));
    const ids = new Set(TERRAIN_INFO.map((t, i) => (rule.biome.includes(t.id) ? i : -1)).filter((i) => i >= 0));
    const terrain = m.baseTerrain || m.terrain;
    const near = [], far = [];
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x;
        if (!ids.has(terrain[i])) continue;
        (!rule.near || nearCondition(m, rule.near, x, y) ? near : far).push(i);
      }
    }
    for (const list of [near, far]) for (let k = list.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [list[k], list[j]] = [list[j], list[k]]; }
    const cand = near.concat(far);
    const reach = contentReach(m), sp = m.landmarks.spawn, camp = m.id === 'surface' ? m.landmarks.camp : null, gate = m.landmarks.gate;
    const mine = taken[m.id], gap = Math.max(1, rule.minGap || 1);
    let adopted = 0, tries = 0, skipped = 0, placed = 0;
    for (const i of cand) {
      if (adopted >= rule.count || tries >= SPAWN_POLICY.maxTries) break;
      tries++;
      const x = i % m.w, y = (i / m.w) | 0;
      if (mine.has(i) || !reach[i] || !contentSpotOk(m, rule.node, x, y)) continue;
      if (Math.hypot(x - sp.x, y - sp.y) <= 2) continue;
      if (camp && Math.hypot(x - camp.x, y - camp.y) < reachBase) continue;
      if (gate && Math.hypot(x - gate.x, y - gate.y) <= 2) continue;
      let crowded = false;
      for (let dy = -(gap - 1); dy <= gap - 1 && !crowded; dy++) for (let dx = -(gap - 1); dx <= gap - 1; dx++) if (mine.has((y + dy) * m.w + x + dx)) { crowded = true; break; }
      if (crowded) continue;
      mine.add(i); adopted++;
      if (occupiedByPlayerState(state, m, x, y)) { skipped++; continue; }
      if (addContentNode(m, rule.node, x, y)) placed++;
    }
    stats.placed += placed; stats.skipped += skipped; stats.rules[rule.id] = { adopted, placed, skipped };
  }
  // 保存済みの状態を、補充後に存在するnodeへ適用する。適用できなかったkeyは pending に残る(次の保存でも保持)
  for (const [k, v] of Object.entries(pendingNodeSave)) {
    const mm = /^(surface|underground):(\d+),(\d+)$/.exec(k);
    const m = mm && world.maps[mm[1]], node = m && nodeAt(m, +mm[2], +mm[3]);
    if (!node) continue;
    state.nodes.set(k, { hp: NODES[node.type].hp || 1, respawnAt: v.perm ? Infinity : v.respawnAt, hitT: 0 });
    state.depleted.add(node);
    delete pendingNodeSave[k];
    stats.applied++;
  }
  state.contentStats = stats;
  state.rev++;
  return stats;
}

// プレイヤー由来の状態(構造物・床・畑・作物・家の周り3マス)に重なるか
function occupiedByPlayerState(state, m, x, y) {
  if (objectAt(state, m.id, x, y) || floorAt(state, m.id, x, y) || farmAt(state, m.id, x, y) || cropAt(state, m.id, x, y)) return true;
  if (m.id === 'surface') {
    for (const h of state.houses || []) if (x >= h.minX - 3 && x <= h.maxX + 3 && y >= h.minY - 3 && y <= h.maxY + 3) return true;
  }
  return false;
}
