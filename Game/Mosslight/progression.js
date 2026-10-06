// 進行: 3つの灯・結晶・ボス撃破と再戦・封印扉と闘技場の扉・灯皿・帰還の蔓・目標と日誌。
// 依存: data.js, world.js, settlement.js, combat.js, layers.js。simulation.js が bindProgression(services) で道具を渡す。
import { BALANCE, TILE, LIGHTS, ITEMS, NODES, BOSSES, WALL, CAVE_LAYOUT } from './data.js';
import { openWallTile, nodeAt } from './world.js';
import { restoreForge, lifeGoals } from './settlement.js';
import { spawnBoss, bossEntity, resetBoss } from './combat.js';

const P = BALANCE.player;
let svc = null;
export function bindProgression(services) { svc = services; }

const have = (state, id) => svc.countItem(state, id);
const LIGHT_IDS = ['forge', 'moss', 'ancient'];

export function defaultProgress() {
  return {
    lights: { forge: false, moss: false, ancient: false }, crystalsPlaced: 0,
    bosses: { vine: false, ash: false }, braziers: [false, false, false], npcs: {}, goals: {}, cleared: false,
    seen: {}, hints: {}, built: {}, stats: { gathered: 0, crafted: 0, foods: {} }, fountain: false,
  };
}

export function lightCount(state) { return LIGHT_IDS.filter((id) => state.progress.lights[id]).length; }

function ground(state, item, n) {
  const p = state.player;
  svc.spawnGround(state, p.map, p.x, p.y, item, n);
}

/* ------------------------------------------------------------------ 扉と闘技場 */
function killNode(state, node) {
  if (!node) return;
  state.nodes.set(node.key, { hp: 0, respawnAt: Infinity, hitT: 0 });
  state.depleted.add(node);
}

const sealOpen = (state) => state.progress.lights.forge && state.progress.lights.moss;
const gateOpen = (state) => state.progress.braziers.every(Boolean);

// 進行の状態から、封印扉・闘技場の扉・ボスの存在を揃える(読み込み直後にも使う)
export function syncGates(state, announce = false) {
  const u = state.world.underground, lm = u.landmarks, pr = state.progress;
  let changed = false;
  if (sealOpen(state) && u.wallKind[lm.seal.y * u.w + lm.seal.x] === WALL.SEAL) {
    openWallTile(u, lm.seal.x, lm.seal.y);
    killNode(state, nodeAt(u, lm.seal.x, lm.seal.y));
    changed = true;
    if (announce) { svc.emit(state, { type: 'sealOpen' }); svc.msg(state, '二つの灯に応えて、封印扉が開いた。遺跡へ進もう', 'good'); }
  }
  if (gateOpen(state) && u.wallKind[lm.gate.y * u.w + lm.gate.x] === WALL.GATE) {
    for (const [x, y] of CAVE_LAYOUT.arenaGate.tiles) openWallTile(u, x, y);
    killNode(state, nodeAt(u, lm.gate.x, lm.gate.y));
    changed = true;
    if (announce) { svc.emit(state, { type: 'gateOpen' }); svc.msg(state, '三つの灯皿に火が灯り、闘技場の扉が開いた', 'good'); }
  }
  if (pr.crystalsPlaced >= LIGHTS.moss.crystals && !pr.bosses.vine && !bossEntity(state, 'vine')) spawnBoss(state, 'vine');
  if (gateOpen(state) && !pr.bosses.ash && !pr.lights.ancient && !bossEntity(state, 'ash')) spawnBoss(state, 'ash');
  if (changed) state.rev++;
}

/* ------------------------------------------------------------------ 進行物の保険 */
function countKeyAnywhere(state, id) {
  let n = have(state, id);
  for (const g of state.groundItems) if (g.item === id) n += g.n;
  for (const box of Object.values(state.containers)) for (const s of box) if (s && s.id === id) n += s.n;
  return n;
}

// 鍵アイテムが消えて詰むことがないよう、どこにも無ければ足元に出し直す
export function ensureKeyItems(state) {
  const pr = state.progress;
  if (pr.bosses.vine && !pr.lights.moss && countKeyAnywhere(state, 'moss_wick') < 1) ground(state, 'moss_wick', 1);
  if (pr.bosses.ash && !pr.lights.ancient && countKeyAnywhere(state, 'ancient_wick') < 1) ground(state, 'ancient_wick', 1);
  const need = LIGHTS.moss.crystals - pr.crystalsPlaced;
  if (need > 0) {
    const u = state.world.underground;
    const left = u.nodes.filter((n) => n.type === 'crystal_node' && svc.nodeAlive(state, n)).length;
    const lack = need - countKeyAnywhere(state, 'crystal_moss') - left;
    if (lack > 0) ground(state, 'crystal_moss', lack);
  }
}

/* ------------------------------------------------------------------ 灯の復元 */
function altarPos(state, id) {
  if (id === 'forge') return state.world.surface.landmarks.forgeAltar;
  const lm = state.world.underground.landmarks;
  return id === 'moss' ? lm.mossAltar : lm.lighthouse;
}

function nearAltar(state, id) {
  const p = state.player, a = altarPos(state, id);
  const map = id === 'forge' ? 'surface' : 'underground';
  return p.map === map && Math.hypot(a.x * TILE + 16 - p.x, a.y * TILE + 16 - p.y) <= P.stationRange + 32;
}

export function restoreLight(state, id) {
  const pr = state.progress;
  if (!LIGHT_IDS.includes(id)) return { ok: false, reason: '知らない灯' };
  if (pr.lights[id]) return { ok: true, already: true };
  if (!nearAltar(state, id)) return { ok: false, reason: '祭壇に近づこう' };
  if (id === 'forge') return restoreForge(state, svc);
  if (id === 'moss') return restoreMoss(state);
  return restoreAncient(state);
}

function restoreMoss(state) {
  const pr = state.progress, L = LIGHTS.moss;
  if (pr.crystalsPlaced < L.crystals) {
    const n = Math.min(L.crystals - pr.crystalsPlaced, have(state, 'crystal_moss'));
    if (n < 1) { ensureKeyItems(state); return { ok: false, reason: `光苔結晶 ${pr.crystalsPlaced}/${L.crystals}。洞窟の苔層の小部屋を探そう（銅のツルハシが要る）` }; }
    svc.removeItem(state, 'crystal_moss', n);
    pr.crystalsPlaced += n;
    svc.emit(state, { type: 'crystal', n: pr.crystalsPlaced });
    state.rev++;
    if (pr.crystalsPlaced >= L.crystals) {
      svc.msg(state, '結晶がそろった。祭壇の根が動き出す…ヌシカズラが目を覚ました', 'warn');
      syncGates(state);
      svc.emit(state, { type: 'save' });
    } else svc.msg(state, `光苔結晶を祭壇に置いた（${pr.crystalsPlaced}/${L.crystals}）`, 'good');
    return { ok: true, stage: 'crystals' };
  }
  if (!pr.bosses.vine) return { ok: false, reason: 'ヌシカズラを鎮めよう' };
  if (have(state, 'moss_wick') < 1) { ensureKeyItems(state); return { ok: false, reason: '苔の灯芯が必要（ヌシカズラが落とす。足元にあるかも）' }; }
  svc.removeItem(state, 'moss_wick', 1);
  pr.lights.moss = true;
  svc.emit(state, { type: 'light', id: 'moss' }, { type: 'save' });
  svc.msg(state, '苔の灯を取り戻した。帰還の蔓が祭壇と炉の祭壇をつないだ', 'good');
  syncGates(state, true);
  state.rev++;
  return { ok: true, stage: 'wick' };
}

function restoreAncient(state) {
  const pr = state.progress;
  if (!sealOpen(state)) return { ok: false, reason: '炉の灯と苔の灯、二つを取り戻そう' };
  const lit = pr.braziers.filter(Boolean).length;
  if (lit < LIGHTS.ancient.dishes) return { ok: false, reason: `灯皿に火が足りない ${lit}/${LIGHTS.ancient.dishes}` };
  if (!pr.bosses.ash) return { ok: false, reason: '灰の番人を鎮めよう' };
  if (have(state, 'ancient_wick') < 1) { ensureKeyItems(state); return { ok: false, reason: '古の灯芯が必要（灰の番人が落とす。足元にあるかも）' }; }
  svc.removeItem(state, 'ancient_wick', 1);
  pr.lights.ancient = true; pr.cleared = true;
  svc.emit(state, { type: 'light', id: 'ancient' }, { type: 'ending' }, { type: 'save' });
  svc.msg(state, '古灯が灯った。三つの灯が、境を照らしている', 'good');
  state.rev++;
  return { ok: true, ending: true };
}

function lightDish(state, index) {
  const pr = state.progress;
  if (!(pr.lights.forge && pr.lights.moss)) { svc.msg(state, '炉の灯と苔の灯を取り戻して封印を開こう', 'warn'); return; }
  if (pr.braziers[index]) { svc.msg(state, 'この灯皿にはもう火が灯っている'); return; }
  if (have(state, 'moss_oil') < 1) { svc.msg(state, '苔灯油が必要（炉で光苔2・樹脂1から作れる）', 'warn'); return; }
  svc.removeItem(state, 'moss_oil', 1);
  pr.braziers[index] = true;
  svc.emit(state, { type: 'dish', index }, { type: 'save' });
  svc.msg(state, `灯皿に火を灯した（${pr.braziers.filter(Boolean).length}/${LIGHTS.ancient.dishes}）`, 'good');
  state.rev++;
  syncGates(state, true);
}

/* ------------------------------------------------------------------ ボス撃破と再戦 */
// 撃破の報酬は足元に落とす(鍵アイテムは消えず、バッグが満杯でも失わない)
export function onBossDefeated(state, e) {
  const id = e.bossId, def = BOSSES[id], pr = state.progress;
  const first = !pr.bosses[id];
  const rewards = e.rematch ? def.rematch : first ? def.reward : def.rematch;
  pr.bosses[id] = true;
  if (e.rematch) pr.stats[id === 'vine' ? 'rematchVine' : 'rematchAsh'] = true;
  for (const r of rewards) svc.spawnGround(state, e.map, e.x, e.y, r.item, r.n);
  svc.emit(state, { type: 'bossDead', id, rematch: !!e.rematch, x: e.x, y: e.y }, { type: 'save' });
  svc.msg(state, `${def.name}を鎮めた`, 'good');
  if (id === 'vine' && first) svc.msg(state, '苔の灯芯が落ちた。祭壇に置こう。帰還の蔓も開通した', 'good');
  if (id === 'ash' && first) svc.msg(state, '古の灯芯が落ちた。奥の古灯台へ運ぼう', 'good');
  state.rev++;
}

export function bossRematch(state, id) {
  const pr = state.progress, def = BOSSES[id];
  if (!def || id === 'common') return { ok: false, reason: '知らないボス' };
  const light = id === 'vine' ? 'moss' : 'ancient';
  if (!pr.bosses[id] || !pr.lights[light]) return { ok: false, reason: '灯を取り戻してから挑める' };
  if (!nearAltar(state, light)) return { ok: false, reason: '祭壇に近づこう' };
  if (bossEntity(state, id)) return { ok: false, reason: 'すでに待ち構えている' };
  spawnBoss(state, id, { rematch: true });
  svc.msg(state, `${def.name}が再び現れる。闘技場へ進もう`, 'warn');
  state.rev++;
  return { ok: true };
}

/* ------------------------------------------------------------------ 帰還の蔓・階段 */
function useReturnVine(state) {
  const p = state.player;
  if (!state.progress.bosses.vine) { svc.msg(state, '蔓は固く閉じている。ヌシカズラを鎮めれば開くだろう'); return; }
  if (p.map === 'surface') {
    const a = state.world.underground.landmarks.mossAltar;
    svc.teleport(state, 'underground', a.x, a.y - 2);
  } else {
    const a = state.world.surface.landmarks.forgeAltar;
    svc.teleport(state, 'surface', a.x, a.y + 2);
  }
  svc.msg(state, '蔓が体を包み、祭壇から祭壇へと運んだ');
}

function useStairs(state, def) {
  if (def.stairs === 'down') {
    const sp = state.world.underground.landmarks.spawn;
    svc.teleport(state, 'underground', sp.x, sp.y);
    svc.msg(state, '洞窟へ降りた。暗がりでは灯りが頼りになる');
  } else {
    const c = state.world.surface.landmarks.cave;
    svc.teleport(state, 'surface', c.x, c.y + 1);
    svc.msg(state, '地上へ戻った');
  }
}

// ランドマークのノードを使う。扱ったら true(それ以外は説明文を出す)
export function useNode(state, node) {
  const def = NODES[node.type], pr = state.progress;
  if (def.stairs) { useStairs(state, def); return true; }
  if (def.vine) { useReturnVine(state); return true; }
  if (def.dish) { lightDish(state, node.meta ? node.meta.dish : 0); return true; }
  if (def.seal) {
    svc.msg(state, sealOpen(state) ? '封印は解けた' : `封印された扉。炉の灯と苔の灯、二つが戻れば開く（${[pr.lights.forge, pr.lights.moss].filter(Boolean).length}/2）`);
    return true;
  }
  if (def.gate) { svc.msg(state, gateOpen(state) ? '扉は開いている' : `闘技場への扉。灯皿に火を灯そう（${pr.braziers.filter(Boolean).length}/3）`); return true; }
  if (def.altar) {
    const id = def.altar;
    if (id === 'moss' && pr.lights.moss) svc.emit(state, { type: 'open', panel: 'rematch', id: 'vine' });
    else if (id === 'ancient' && pr.lights.ancient) svc.emit(state, { type: 'open', panel: 'rematch', id: 'ash' });
    else svc.emit(state, { type: 'open', panel: 'altar', id });
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ 目標 */
const need = (state, o) => Object.entries(o).map(([id, n]) => ({ id, n, need: n, have: have(state, id) }));
const enough = (list) => list.every((x) => x.have >= x.n);
const owns = (state, type) => !!state.progress.built[type] || have(state, type) > 0;

function forgeChain(state) {
  const pr = state.progress;
  if (!owns(state, 'furnace')) return { text: '湖岸の粘土を掘って精錬炉を作ろう（作業台のそばで 石12・粘土4）', items: need(state, { stone: 12, clay: 4 }) };
  const bars = have(state, 'copper_bar');
  if (bars < 4) {
    const ore = have(state, 'copper_ore');
    if (ore >= 2) return { text: '精錬炉のそばで銅鉱石を銅インゴットにしよう（銅鉱石2・木材1）', items: need(state, { copper_ore: 2, wood: 1 }) };
    return { text: '洞窟の入口まわりの銅鉱床を石のツルハシで砕き、銅インゴットを4つ用意しよう', items: need(state, { copper_bar: 4 }) };
  }
  if (have(state, 'moss_oil') < 2) return { text: '苔の窪地で光苔を集め、精錬炉で苔灯油を2つ作ろう（光苔2・樹脂1）', items: need(state, { moss_oil: 2, glowmoss: 2, resin: 1 }) };
  if (!owns(state, 'pot')) return { text: '調理鍋を作ろう（作業台のそばで 石8・粘土2）', items: need(state, { stone: 8, clay: 2 }) };
  if (have(state, 'forest_stew') < 1) return { text: '調理鍋で森のシチューを作ろう（苔芋2・キノコ2・ベリー2）', items: need(state, { moss_potato: 2, mushroom: 2, berry: 2 }) };
  if (pr.lights.forge) return null;
  return { text: '炉の祭壇に銅インゴット・苔灯油・森のシチューを捧げよう', items: need(state, { copper_bar: 4, moss_oil: 2, forest_stew: 1 }) };
}

function mossChain(state) {
  const pr = state.progress, p = state.player, L = LIGHTS.moss;
  const stock = have(state, 'crystal_moss');
  if (pr.crystalsPlaced + stock < L.crystals) {
    if (p.tools.pick < 2) return { text: '洞窟の苔層の結晶は苔岩に守られている。銅のツルハシを作ろう（銅インゴット3・木材2）', items: need(state, { copper_bar: 3, wood: 2 }) };
    return { text: `洞窟の苔層で光苔結晶を集めよう（${pr.crystalsPlaced + stock}/${L.crystals}）。青緑に光る小部屋の苔岩を砕く`, items: [] };
  }
  if (pr.crystalsPlaced < L.crystals) return { text: `苔の祭壇に光苔結晶を置こう（${pr.crystalsPlaced}/${L.crystals}）`, items: [] };
  if (!pr.bosses.vine) return { text: '祭壇の闘技場で、ヌシカズラを倒そう。予兆を見て回避を使おう', items: [] };
  if (!pr.lights.moss) return { text: '落ちた苔の灯芯を拾い、苔の祭壇に置こう', items: [] };
  return null;
}

function ancientChain(state) {
  const pr = state.progress, lit = pr.braziers.filter(Boolean).length;
  if (lit < LIGHTS.ancient.dishes) return { text: `遺跡の灯皿に苔灯油を灯そう（${lit}/${LIGHTS.ancient.dishes}）`, items: need(state, { moss_oil: LIGHTS.ancient.dishes - lit }) };
  if (!pr.bosses.ash) return { text: '闘技場で灰の番人を倒そう。突進を壁に当てると隙ができる', items: [] };
  if (!pr.lights.ancient) return { text: '古の灯芯を拾い、奥の古灯台に置こう', items: [] };
  return null;
}

function earlyObjective(state) {
  const p = state.player, pr = state.progress, built = pr.built;
  if (!p.tools.axe) {
    const list = need(state, { branch: 3, stone: 2, fiber: 2 });
    return { text: enough(list) ? 'C で制作画面を開き、石の斧を作ろう' : '枝・石・繊維を拾って石の斧を作ろう', items: list };
  }
  if (!built.workbench && !have(state, 'workbench')) {
    const list = need(state, { wood: 6, stone: 4 });
    if (have(state, 'wood') < 6) return { text: '斧で木を伐って木材を集めよう（作業台に6つ）', items: list };
    if (have(state, 'stone') < 4) return { text: '小石を拾って作業台の石を集めよう', items: list };
    return { text: 'C で作業台を作ろう', items: list };
  }
  if (!built.workbench) return { text: 'ホットバーの作業台を選び、地面に置こう', items: [] };
  if (!p.tools.pick) return { text: '石のツルハシを作って、岩を砕けるようにしよう', items: need(state, { branch: 3, stone: 3, fiber: 2 }) };
  if (!p.tools.hoe) return { text: '作業台のそばで石の鍬を作ろう', items: need(state, { branch: 2, stone: 2, fiber: 2 }) };
  if (!pr.stats.planted) {
    return { text: '建築メニューの「畑」で地面を耕し、苔芋か灯麦の種（野営地の箱にある）を植えよう', items: need(state, { wheat_seed: 1 }) };
  }
  return null;
}

function houseObjective(state) {
  const homes = state.houses.filter((h) => h.valid && h.safe);
  if (homes.length) return null;
  const best = state.houses.find((h) => h.valid && !h.safe);
  if (best) return { text: '家が安全圏の外にある。焚き火の近くに家を建てよう', items: [] };
  const h = state.houses[0];
  if (!h) return { text: '家を建てよう：木の壁・扉・床で3×3以上の部屋を作り、ベッドと灯りを置く', items: need(state, { wood: 12 }) };
  return { text: `家を整えよう：${h.reasons[0] || '壁・扉・床・ベッド・灯りをそろえる'}`, items: [] };
}

function chooseChain(state) {
  const L = state.progress.lights, pr = state.progress;
  if (L.forge && L.moss) return 'ancient';
  if (L.forge) return 'moss';
  if (L.moss) return 'forge';
  const exploring = pr.crystalsPlaced > 0 || have(state, 'crystal_moss') > 0 || state.player.map === 'underground' || pr.bosses.vine;
  return exploring ? 'moss' : 'forge';
}

// 交戦中のボスに合わせた目標。古い序盤の目標より優先する
const BOSS_OBJECTIVE = {
  vine: '苔の闘技場でヌシカズラと交戦中。光る予兆の範囲から離れて回避し、隙を見て攻撃しよう',
  ash: '灰の番人と交戦中。予兆を見て回避し、突進を壁に当てて隙を作ろう',
};

function liveBoss(state) {
  const b = state.boss && state.boss.hp > 0 ? state.boss : null;
  return b || state.enemies.find((e) => e.boss && e.engaged && e.hp > 0) || null;
}

// 灯の復元・結晶集め・ボス討伐のどれかが進んだら、序盤(道具・畑)の案内はもう出さない
function pastEarlyGame(state) {
  const pr = state.progress, L = pr.lights;
  return !!(pr.cleared || L.forge || L.moss || L.ancient || pr.bosses.vine || pr.bosses.ash
    || pr.crystalsPlaced > 0 || have(state, 'crystal_moss') > 0 || state.player.tools.pick >= 2);
}

export function getObjective(state) {
  const boss = liveBoss(state);
  if (boss) return { text: BOSS_OBJECTIVE[boss.type] || `${boss.name || 'ボス'}と交戦中。予兆を見て回避し、隙を見て攻撃しよう`, items: [], boss: true };
  const early = pastEarlyGame(state) ? null : earlyObjective(state);
  if (early) return early;
  const pr = state.progress;
  const chain = pr.cleared || pr.lights.ancient ? 'done' : chooseChain(state);
  if (chain === 'forge') {
    const house = houseObjective(state);
    if (house) return house;
    return forgeChain(state) || { text: '炉の祭壇に捧げよう', items: [] };
  }
  if (chain === 'moss') return mossChain(state) || { text: '苔の祭壇に苔の灯芯を置こう', items: [] };
  if (chain === 'ancient') return ancientChain(state) || { text: '古灯台に古の灯芯を置こう', items: [] };
  const todo = lifeGoals(state).find((g) => !g.done);
  if (todo) return { text: `暮らしの目標：${todo.text}（${todo.value}/${todo.target}）`, items: [] };
  return { text: '三つの灯と暮らしの目標を達成した。ボスの再戦や自由な建築を楽しもう', items: [] };
}

/* ------------------------------------------------------------------ 日誌 */
export function getJournal(state) {
  const pr = state.progress, L = pr.lights;
  const homes = state.houses.filter((h) => h.valid && h.safe).length;
  const req = (text, done, current, target) => (current != null ? { text, done, current, target } : { text, done });
  const offer = LIGHTS.forge.offer.map((o) => req(`${ITEMS[o.item].name}を${o.n}つ`, L.forge || have(state, o.item) >= o.n, L.forge ? o.n : Math.min(have(state, o.item), o.n), o.n));
  const lights = [
    {
      id: 'forge', name: LIGHTS.forge.name, done: L.forge,
      requirements: [req('安全圏に有効な家を1軒', L.forge || homes >= 1, L.forge ? 1 : Math.min(homes, 1), 1), ...offer],
    },
    {
      id: 'moss', name: LIGHTS.moss.name, done: L.moss,
      requirements: [
        req('光苔結晶を祭壇に置く', L.moss || pr.crystalsPlaced >= 3, L.moss ? 3 : pr.crystalsPlaced, 3),
        req('ヌシカズラを鎮める', pr.bosses.vine),
        req('苔の灯芯を祭壇に置く', L.moss),
      ],
    },
    {
      id: 'ancient', name: LIGHTS.ancient.name, done: L.ancient,
      requirements: [
        req('炉の灯と苔の灯で封印扉を開く', L.forge && L.moss, [L.forge, L.moss].filter(Boolean).length, 2),
        req('灯皿に苔灯油を灯す', L.ancient || pr.braziers.every(Boolean), L.ancient ? 3 : pr.braziers.filter(Boolean).length, 3),
        req('灰の番人を鎮める', pr.bosses.ash),
        req('古の灯芯を古灯台に置く', L.ancient),
      ],
    },
  ];
  const obj = getObjective(state);
  const count = lightCount(state);
  const story = pr.cleared
    ? '三つの灯が戻り、境の塔に火が灯った。暮らしを整えながら、ゆっくり過ごそう。'
    : count === 0 ? '森の野営地で暮らしを整え、消えた三つの灯を取り戻そう。'
      : count === 1 ? '一つ目の灯が戻った。境の塔の火皿がほのかに明るい。'
        : '二つの灯が戻り、遺跡の封印が解けた。最後の灯は古い灯台にある。';
  return { objective: obj, lights, goals: lifeGoals(state), story };
}

/* ------------------------------------------------------------------ ステップ */
export function stepProgress(state, dt) {
  state.timers.keys = (state.timers.keys || 0) + dt;
  if (state.timers.keys >= 5) { state.timers.keys = 0; ensureKeyItems(state); }
}

export function resetAllBosses(state) {
  for (const e of state.enemies.concat(state.dormant)) if (e.boss) resetBoss(state, e, true);
}
