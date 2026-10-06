// 敵4種・ボス2種・攻撃予兆・弾・被弾・死亡と資源袋。依存: data.js, world.js, settlement.js, layers.js。
// simulation.js が bindCombat(services) で移動・アイテム操作・ボス撃破の通知先を渡す(循環importを避ける)。
//
// 描画向けの状態(座標・長さ・幅はすべてpx、角度はラジアン)
//   state.enemies[]    {id,type,name,sprite,map,x,y,hp,maxHp,def,radius,boss?,phase?,telegraph(0..1|null),state,dir,fx,fy,hitT,stunned?,engaged?}
//   state.telegraphs[] {kind:'circle'|'ring'|'line'|'cone',map,x,y,x2?,y2?,radius?,inner?,width?,angle?,arc?,remaining,duration,color,owner}
//   state.projectiles[] {map,x,y,vx,vy,radius,color,life,dmg,owner}
//   state.boss         交戦中のボス(state.enemies の要素)またはnull
//   state.deathBag     {map,x,y,items:[{id,n}]} またはnull
import { BALANCE, TILE, TERRAIN_INFO, TERRAIN as T, ENEMIES, BOSSES, ITEMS } from './data.js';
import { getTile, nodeAt, solidRadius, findWalkableNear } from './world.js';
import { inSafeZone, safeRadius } from './settlement.js';

const P = BALANCE.player;
const C = BALANCE.combat;
const DAY = BALANCE.day.length;
const BOSS_COLOR = { vine: '#8be07a', ash: '#ff7a45' };
const FORBID = new Set(['__proto__', 'constructor', 'prototype']);

let svc = null;
export function bindCombat(services) { svc = services; }

const rand = (state) => state.rng();
const unit = (dx, dy) => { const d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d]; };
function dirName(dx, dy) { return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); }
const isNight = (state) => { const t = state.time.clock % DAY; return t >= BALANCE.day.night[0] || t < 20; };

export function initCombat(state) {
  state.enemies ||= []; state.dormant ||= []; state.projectiles ||= []; state.telegraphs ||= [];
  state.boss = null; state.deathBag ||= null; state.hitStop ||= 0;
  state.nextEnemyId ||= 1;
  state.timers.spawn = C.spawnEvery; // 最初のステップですぐ出現判定
}

/* ------------------------------------------------------------------ 共通 */
// 衝突を考慮した移動。8px刻みで壁抜けを防ぐ。実際に動いた距離を返す
function move(state, e, dx, dy) {
  const map = state.world.maps[e.map];
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const bx = e.x, by = e.y;
    svc.moveEntity(state, map, e, dx / n, dy / n, e.radius);
    moved += Math.hypot(e.x - bx, e.y - by);
  }
  return moved;
}

// 敵は安全圏へ入らない。入っていたら外周へ押し戻す
function keepOutOfSafe(state, e) {
  if (e.map !== 'surface' || !inSafeZone(state, 'surface', e.x, e.y)) return false;
  const c = state.world.surface.landmarks.camp, cx = c.x * TILE + 16, cy = c.y * TILE + 16;
  const [ux, uy] = unit(e.x - cx, e.y - cy);
  const r = safeRadius(state) * TILE + 2;
  e.x = cx + ux * r; e.y = cy + uy * r;
  svc.moveEntity(state, state.world.surface, e, 0, 0, e.radius);
  return true;
}

function playerDefense(p) {
  let def = 0;
  if (p.equip.armor && ITEMS[p.equip.armor]) def += ITEMS[p.equip.armor].armor.def;
  if (p.equip.trinket && ITEMS[p.equip.trinket] && ITEMS[p.equip.trinket].trinket.def) def += ITEMS[p.equip.trinket].trinket.def;
  return def;
}

function segmentDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/* ------------------------------------------------------------------ プレイヤーの被弾と死亡 */
// 回避の無敵・被弾後の無敵・安全圏の中では傷つかない。戻り値は実際に当たったか
export function damagePlayer(state, dmg, sx, sy) {
  const p = state.player;
  if (p.invuln > 0 || p.roll && p.roll.t < P.rollInvuln) return false;
  if (inSafeZone(state, p.map, p.x, p.y)) return false;
  const real = Math.max(1, Math.round(dmg - playerDefense(p)));
  p.hp -= real;
  p.invuln = P.invuln;
  p.action = null;
  const [ux, uy] = unit(p.x - sx, p.y - sy);
  const map = state.world.maps[p.map];
  const n = 3;
  for (let i = 0; i < n; i++) svc.moveEntity(state, map, p, ux * P.knock * TILE / n, uy * P.knock * TILE / n, P.radius);
  state.rev++;
  svc.emit(state, { type: 'hurt', x: p.x, y: p.y, dmg: real });
  if (p.hp <= 0) playerDeath(state);
  return true;
}

function addToBag(items, id, n) {
  const cap = BALANCE.death.bagCap;
  const hit = items.find((s) => s.id === id);
  if (hit) hit.n = Math.min(cap, hit.n + n); else items.push({ id, n: Math.min(cap, n) });
}

// 死亡: 素材だけ資源袋へ。装備・鍵アイテム・食料・設置物は保持。袋は常に1つで、旧袋は新袋へ統合
export function playerDeath(state) {
  const p = state.player;
  const items = [];
  for (let i = 0; i < p.bag.length; i++) {
    const s = p.bag[i];
    if (s && ITEMS[s.id] && ITEMS[s.id].cat === 'material') { addToBag(items, s.id, s.n); p.bag[i] = null; }
  }
  const old = state.deathBag;
  if (old && Array.isArray(old.items)) for (const s of old.items) addToBag(items, s.id, s.n);
  const deathAt = { map: p.map, x: p.x, y: p.y };
  state.progress.stats.deaths = (state.progress.stats.deaths || 0) + 1;
  if (items.length) state.deathBag = { map: deathAt.map, x: deathAt.x, y: deathAt.y, items };
  for (const b of state.enemies.concat(state.dormant)) if (b.boss) resetBoss(state, b, true);
  state.projectiles.length = 0;

  const camp = state.world.surface.landmarks.camp;
  let sp = p.spawn && state.world.maps[p.spawn.map] ? p.spawn : { map: 'surface', x: camp.x * TILE + 16, y: camp.y * TILE + 56 };
  if (!Number.isFinite(sp.x) || !Number.isFinite(sp.y)) sp = { map: 'surface', x: camp.x * TILE + 16, y: camp.y * TILE + 56 };
  const prevMap = p.map;
  p.map = sp.map; p.x = sp.x; p.y = sp.y;
  const m = state.world.maps[p.map];
  const spot = findWalkableNear(m, Math.floor(p.x / TILE), Math.floor(p.y / TILE), 10);
  if (spot) { p.x = spot.x * TILE + 16; p.y = spot.y * TILE + 16; }
  svc.moveEntity(state, m, p, 0, 0, P.radius);
  p.hp = BALANCE.death.hp;
  p.satiety = Math.max(p.satiety, BALANCE.death.minSatiety);
  p.invuln = BALANCE.death.invuln;
  p.vx = p.vy = 0; p.action = null; p.roll = null; p.starveT = 0;
  if (prevMap !== p.map) onMapChange(state, p.map);
  state.enemies = state.enemies.filter((e) => e.boss || Math.hypot(e.x - p.x, e.y - p.y) > 12 * TILE);
  state.rev++;
  svc.emit(state, { type: 'death', x: deathAt.x, y: deathAt.y, map: deathAt.map, bag: !!items.length });
  svc.emit(state, { type: 'save' });
  svc.msg(state, items.length ? '力尽きた。素材は資源袋に入った。地図の印から取り戻そう' : '力尽きた。拠点で目を覚ました', 'warn');
}

// 資源袋の回収。入りきらなかった分は袋に残る
export function collectDeathBag(state) {
  const b = state.deathBag, p = state.player;
  if (!b || b.map !== p.map) return 0;
  let got = 0;
  b.items = b.items.filter((s) => {
    const left = svc.addItem(state, s.id, s.n, { silent: true });
    got += s.n - left;
    s.n = left;
    return left > 0;
  });
  if (got > 0) {
    svc.emit(state, { type: 'pickup', x: p.x, y: p.y, item: 'bag' });
    svc.msg(state, b.items.length ? `資源袋から素材を回収した（バッグが満杯で一部は残っている）` : '資源袋の素材をすべて回収した', 'good');
  } else svc.msg(state, 'バッグがいっぱいで回収できない', 'warn');
  if (!b.items.length) state.deathBag = null;
  state.rev++;
  return got;
}

function updateDeathBag(state) {
  const b = state.deathBag, p = state.player;
  if (!b || b.map !== p.map) return;
  if (Math.hypot(b.x - p.x, b.y - p.y) > 28) return;
  if (b.blockedUntil && state.time.clock < b.blockedUntil) return;
  const got = collectDeathBag(state);
  if (!got && state.deathBag) state.deathBag.blockedUntil = state.time.clock + 3; // 満杯のときに毎フレーム通知しない
}

/* ------------------------------------------------------------------ 敵の生成と出現 */
export function makeEnemy(state, type, mapId, x, y, extra = {}) {
  const d = ENEMIES[type];
  return {
    id: state.nextEnemyId++, type, name: d.name, sprite: d.sprite, map: mapId, x, y,
    hp: d.hp, maxHp: d.hp, def: d.def, radius: d.radius, home: { x, y }, state: 'idle', t: 0, dur: 0,
    telegraph: null, tele: null, fx: 0, fy: 1, dir: 'down', cooldown: 0.8 + rand(state), hitT: 0, lock: null, moving: false,
    wanderT: 0, wander: null, stuckT: 0, steer: 0, ...extra,
  };
}

function freeSpot(state, mapId, x, y, r) {
  const m = state.world.maps[mapId];
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 1 || ty < 1 || tx >= m.w - 1 || ty >= m.h - 1) return false;
  const info = TERRAIN_INFO[getTile(m, tx, ty)];
  if (info.solid || info.water) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (TERRAIN_INFO[getTile(m, tx + dx, ty + dy)].solid && Math.hypot(x - (tx + dx) * TILE - 16, y - (ty + dy) * TILE - 16) < r + 20) return false;
      const n = nodeAt(m, tx + dx, ty + dy);
      if (n && svc.nodeAlive(state, n) && solidRadius(n) > 0 && Math.hypot(x - n.px, y - n.py) < solidRadius(n) + r + 4) return false;
    }
  }
  return true;
}

function spawnAllowed(state, type, x, y) {
  const d = ENEMIES[type], m = state.world.maps[d.map];
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (!freeSpot(state, d.map, x, y, d.radius)) return false;
  if (d.map === 'surface') return !inSafeZone(state, 'surface', x, y, 6);
  const i = ty * m.w + tx;
  const t = m.terrain[i];
  if (d.layers) {
    if (t === T.MOSS_FLOOR) return !m.protect[i];
    if (t === T.RUIN) {
      const lm = m.landmarks;
      return state.progress.lights.forge && state.progress.lights.moss && Math.hypot(tx - lm.arena.x, ty - lm.arena.y) > lm.arena.r + 2;
    }
    return false;
  }
  return !m.protect[i];
}

function trySpawn(state, type) {
  const p = state.player, d = ENEMIES[type];
  for (let k = 0; k < 14; k++) {
    const a = rand(state) * Math.PI * 2;
    const dist = (BALANCE.safe.spawnGap[0] + rand(state) * (BALANCE.safe.spawnGap[1] - BALANCE.safe.spawnGap[0])) * TILE;
    const x = p.x + Math.cos(a) * dist, y = p.y + Math.sin(a) * dist;
    if (!spawnAllowed(state, type, x, y)) continue;
    state.enemies.push(makeEnemy(state, type, d.map, x, y));
    return true;
  }
  return false;
}

function updateSpawns(state, dt) {
  state.timers.spawn += dt;
  if (state.timers.spawn < BALANCE.safe.spawnCheck) return;
  state.timers.spawn = 0;
  if (state.enemies.length >= 28) return;
  for (const [type, d] of Object.entries(ENEMIES)) {
    if (d.map !== state.player.map) continue;
    if (d.night && !isNight(state)) continue;
    const have = state.enemies.reduce((n, e) => n + (e.type === type && !e.summoned ? 1 : 0), 0);
    for (let k = have; k < Math.min(d.cap, have + 3); k++) if (!trySpawn(state, type)) break;
  }
}

// 遠く離れた敵・朝になった夜の敵は消して、上限を保つ
function pruneEnemies(state) {
  const p = state.player, day = !isNight(state);
  state.enemies = state.enemies.filter((e) => {
    if (e.boss) return true;
    if (Math.hypot(e.x - p.x, e.y - p.y) > C.despawn * TILE) return false;
    if (e.summoned && !state.boss) return false;
    if (ENEMIES[e.type].night && day && e.state !== 'telegraph' && e.state !== 'attack' && Math.hypot(e.x - p.x, e.y - p.y) > 10 * TILE) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ 敵のAI */
function wander(state, e, dt) {
  e.wanderT -= dt;
  if (e.wanderT <= 0) {
    e.wanderT = 1.5 + rand(state) * 2.5;
    if (rand(state) < 0.55) {
      const a = rand(state) * Math.PI * 2, r = rand(state) * 3 * TILE;
      e.wander = { x: e.home.x + Math.cos(a) * r, y: e.home.y + Math.sin(a) * r };
    } else e.wander = null;
  }
  if (!e.wander) { e.moving = false; return; }
  const dx = e.wander.x - e.x, dy = e.wander.y - e.y, d = Math.hypot(dx, dy);
  if (d < 4) { e.wander = null; e.moving = false; return; }
  const sp = ENEMIES[e.type].speed * TILE * BALANCE.combat.wanderSpeed * dt;
  move(state, e, dx / d * Math.min(sp, d), dy / d * Math.min(sp, d));
  e.fx = dx / d; e.fy = dy / d; e.dir = dirName(dx, dy); e.moving = true;
}

// 目標へ向かう。進めなければ回り込む角度を変える
function chaseToward(state, e, tx, ty, speed, dt) {
  let [ux, uy] = unit(tx - e.x, ty - e.y);
  if (e.steer) { const c = Math.cos(e.steer), s = Math.sin(e.steer); [ux, uy] = [ux * c - uy * s, ux * s + uy * c]; }
  const want = speed * dt;
  const got = move(state, e, ux * want, uy * want);
  e.fx = ux; e.fy = uy; e.dir = dirName(ux, uy); e.moving = got > 0.05;
  if (got < want * 0.25) {
    e.stuckT += dt;
    if (e.stuckT > 0.35) { e.stuckT = 0; e.steer = e.steer ? 0 : (rand(state) < 0.5 ? 1 : -1) * (0.9 + rand(state) * 0.6); }
  } else { e.stuckT = 0; if (e.steer && rand(state) < dt * 1.2) e.steer = 0; }
}

function attackGeometry(e, d, nx, ny) {
  const len = (d.range || 4) * TILE;
  if (d.attack === 'leap') {
    return { kind: 'circle', x: e.x + nx * len, y: e.y + ny * len, radius: e.radius + 18, len };
  }
  return { kind: 'line', x: e.x, y: e.y, x2: e.x + nx * len, y2: e.y + ny * len, width: e.radius * 2 + 6, len };
}

function beginEnemyAttack(state, e, nx, ny) {
  const d = ENEMIES[e.type];
  e.state = 'telegraph'; e.t = 0; e.dur = d.telegraph;
  e.lock = { x: nx, y: ny };
  e.fx = nx; e.fy = ny; e.dir = dirName(nx, ny);
  e.tele = { ...attackGeometry(e, d, nx, ny), color: d.color };
  e.telegraph = 0; e.hitDone = false;
  svc.emit(state, { type: 'telegraph', enemy: e.type, x: e.x, y: e.y, duration: d.telegraph });
}

function updateEnemy(state, e, dt) {
  const d = ENEMIES[e.type], p = state.player;
  e.hitT = Math.max(0, e.hitT - dt);
  e.cooldown -= dt;
  const here = p.map === e.map;
  const dx = p.x - e.x, dy = p.y - e.y, dp = Math.hypot(dx, dy);
  const pSafe = here && inSafeZone(state, p.map, p.x, p.y);
  const homeDist = Math.hypot(e.x - e.home.x, e.y - e.home.y);
  const speed = d.speed * TILE;

  if (e.state === 'idle') {
    if (here && !pSafe && dp <= d.sense * TILE && e.cooldown <= 0) e.state = 'chase';
    else wander(state, e, dt);
  } else if (e.state === 'chase') {
    if (!here || pSafe || dp > d.sense * TILE * 1.8) { e.state = 'idle'; e.cooldown = 1; e.steer = 0; }
    else if (homeDist > C.leash * TILE) e.state = 'return';
    else if (dp <= (d.range || 4) * TILE * 0.85 && e.cooldown <= 0 && !pSafe) { const [nx, ny] = unit(dx, dy); beginEnemyAttack(state, e, nx, ny); }
    else chaseToward(state, e, p.x, p.y, speed, dt);
  } else if (e.state === 'telegraph') {
    e.t += dt;
    e.telegraph = Math.min(1, e.t / e.dur);
    e.moving = false;
    if (e.t >= e.dur) {
      e.state = 'attack'; e.t = 0; e.telegraph = null; e.tele = null; e.travel = 0;
      svc.emit(state, { type: 'enemyAttack', enemy: e.type, x: e.x, y: e.y });
    }
  } else if (e.state === 'attack') {
    const len = (d.range || 4) * TILE, step = len / d.atkDur * dt;
    e.t += dt;
    const moved = move(state, e, e.lock.x * step, e.lock.y * step);
    e.travel += moved; e.moving = true;
    if (!e.hitDone && here && Math.hypot(p.x - e.x, p.y - e.y) <= e.radius + P.radius + 4) {
      if (damagePlayer(state, d.dmg, e.x, e.y)) e.hitDone = true;
    }
    if (e.t >= d.atkDur || moved < step * 0.2 || e.travel >= len) { e.state = 'recover'; e.t = 0; e.moving = false; e.cooldown = C.attackGap; }
  } else if (e.state === 'recover') {
    e.t += dt; e.moving = false;
    if (e.t >= (d.recover || 0.6)) { e.state = here && !pSafe ? 'chase' : 'idle'; e.t = 0; }
  } else if (e.state === 'return') {
    e.telegraph = null;
    chaseToward(state, e, e.home.x, e.home.y, speed * 1.4, dt);
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * dt * 0.5);
    if (Math.hypot(e.x - e.home.x, e.y - e.home.y) < 10) { e.state = 'idle'; e.hp = e.maxHp; e.cooldown = 1.5; e.steer = 0; }
  }
  if (keepOutOfSafe(state, e) && (e.state === 'attack' || e.state === 'telegraph')) { e.state = 'recover'; e.t = 0; e.tele = null; e.telegraph = null; }
}

/* ------------------------------------------------------------------ ボス */
export function bossEntity(state, id) {
  return state.enemies.find((e) => e.boss && e.bossId === id) || state.dormant.find((e) => e.boss && e.bossId === id) || null;
}

export function spawnBoss(state, id, opts = {}) {
  const def = BOSSES[id];
  if (!def || FORBID.has(id)) return null;
  const old = bossEntity(state, id);
  if (old) return old;
  const lm = state.world.underground.landmarks;
  const home = lm.bossSpawn[id];
  const center = id === 'vine' ? lm.mossArena : lm.arena;
  const e = {
    id: state.nextEnemyId++, type: id, bossId: id, boss: true, name: def.name, sprite: def.sprite, map: 'underground',
    x: home.x * TILE + 16, y: home.y * TILE + 16, hp: def.hp, maxHp: def.hp, def: def.def, radius: def.radius, phase: 1,
    engaged: false, state: 'idle', t: 0, dur: 0, telegraph: null, tele: null, fx: 0, fy: 1, dir: 'down', hitT: 0, cooldown: 1.5,
    home: { x: home.x * TILE + 16, y: home.y * TILE + 16 }, arena: { x: center.x * TILE + 16, y: center.y * TILE + 16, r: center.r },
    farT: 0, summonT: 0, stunT: 0, stunned: false, last: null, rematch: !!opts.rematch, moving: false,
  };
  if (e.map === state.player.map) state.enemies.push(e); else state.dormant.push(e);
  return e;
}

function removeSummons(state, bossId) {
  state.enemies = state.enemies.filter((e) => !(e.summoned && e.owner === bossId));
  state.projectiles = state.projectiles.filter((pr) => pr.owner !== bossId);
}

export function resetBoss(state, e, silent = false) {
  const was = e.engaged;
  e.hp = e.maxHp; e.phase = 1; e.engaged = false; e.state = 'idle'; e.t = 0; e.telegraph = null; e.tele = null;
  e.stunT = 0; e.stunned = false; e.farT = 0; e.cooldown = 1.5; e.summonT = 0;
  e.x = e.home.x; e.y = e.home.y;
  removeSummons(state, e.bossId);
  if (was && !silent) {
    svc.emit(state, { type: 'bossReset', id: e.bossId });
    svc.msg(state, `${e.name}は力を取り戻した。いつでも再挑戦できる`);
  }
}

function engageBoss(state, e) {
  if (e.engaged) return;
  e.engaged = true; e.state = 'idle'; e.cooldown = 1.6; e.farT = 0;
  svc.emit(state, { type: 'bossStart', id: e.bossId });
  svc.msg(state, `${e.name}が現れた`, 'warn');
}

function bossAim(e, p) { return unit(p.x - e.x, p.y - e.y); }

function beginBossAttack(state, e, kind) {
  const p = state.player, def = BOSSES[e.bossId].attacks[kind];
  const [nx, ny] = bossAim(e, p);
  e.state = 'tele'; e.attack = kind; e.t = 0; e.dur = def.telegraph; e.telegraph = 0; e.lock = { x: nx, y: ny };
  e.fx = nx; e.fy = ny; e.dir = dirName(nx, ny);
  const color = BOSS_COLOR[e.bossId];
  if (kind === 'lash') {
    const len = def.length * TILE;
    e.tele = { kind: 'line', x: e.x, y: e.y, x2: e.x + nx * len, y2: e.y + ny * len, width: def.width * TILE, color };
  } else if (kind === 'spore') {
    e.tele = { kind: 'circle', x: e.x, y: e.y, radius: e.radius + 34, color };
  } else if (kind === 'sweep') {
    e.tele = { kind: 'cone', x: e.x, y: e.y, radius: def.range * TILE, angle: Math.atan2(ny, nx), arc: def.arc * Math.PI / 180, color };
  } else if (kind === 'ring') {
    e.tele = { kind: 'ring', x: e.x, y: e.y, radius: 4.2 * TILE, inner: 1.8 * TILE, color };
  } else if (kind === 'charge') {
    const len = def.dist * TILE;
    e.tele = { kind: 'line', x: e.x, y: e.y, x2: e.x + nx * len, y2: e.y + ny * len, width: e.radius * 1.4, color };
  }
  svc.emit(state, { type: 'telegraph', enemy: e.bossId, boss: true, attack: kind, x: e.x, y: e.y, duration: def.telegraph });
}

function resolveBossAttack(state, e) {
  const p = state.player, def = BOSSES[e.bossId].attacks[e.attack], here = p.map === e.map;
  svc.emit(state, { type: 'enemyAttack', enemy: e.bossId, boss: true, attack: e.attack, x: e.x, y: e.y });
  if (e.attack === 'lash') {
    const t = e.tele;
    if (here && segmentDist(p.x, p.y, t.x, t.y, t.x2, t.y2) <= t.width / 2 + P.radius) damagePlayer(state, def.dmg, e.x, e.y);
  } else if (e.attack === 'spore') {
    for (let k = 0; k < def.dirs; k++) {
      const a = k / def.dirs * Math.PI * 2 + (e.phase === 2 ? Math.PI / def.dirs : 0);
      state.projectiles.push({
        map: e.map, x: e.x, y: e.y, vx: Math.cos(a) * def.speed * TILE, vy: Math.sin(a) * def.speed * TILE, radius: 8,
        color: '#b6f070', life: C.projectileLife, dmg: def.dmg, owner: e.bossId,
      });
    }
  } else if (e.attack === 'sweep') {
    const t = e.tele, d = Math.hypot(p.x - e.x, p.y - e.y);
    let da = Math.atan2(p.y - e.y, p.x - e.x) - t.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (here && d <= t.radius + P.radius && Math.abs(da) <= t.arc / 2) damagePlayer(state, def.dmg, e.x, e.y);
  } else if (e.attack === 'ring') {
    const t = e.tele, d = Math.hypot(p.x - e.x, p.y - e.y);
    if (here && d <= t.radius && d >= t.inner) damagePlayer(state, def.dmg, e.x, e.y);
    if (e.phase === 2 && !e.second) { e.second = true; e.state = 'tele2'; e.t = 0; e.dur = 0.8; e.telegraph = 0; svc.emit(state, { type: 'telegraph', enemy: e.bossId, boss: true, attack: 'ring', x: e.x, y: e.y, duration: 0.8 }); return; }
    e.second = false;
  } else if (e.attack === 'charge') {
    e.state = 'charging'; e.t = 0; e.travel = 0; e.telegraph = null; e.hitDone = false; return;
  }
  e.state = 'recover'; e.t = 0; e.telegraph = null; e.tele = null; e.dur = 0.7;
}

function pickBossAttack(state, e) {
  const p = state.player, d = Math.hypot(p.x - e.x, p.y - e.y), r = rand(state);
  if (e.bossId === 'vine') {
    const next = e.last === 'lash' || r < 0.4 ? (e.last === 'spore' ? 'lash' : 'spore') : 'lash';
    return next;
  }
  if (d <= 3.4 * TILE) return r < 0.62 ? 'sweep' : 'ring';
  if (d >= 4.5 * TILE && r < 0.55) return 'charge';
  return r < 0.5 ? 'ring' : 'sweep';
}

function summonSlimes(state, e) {
  const sum = BOSSES.vine.phase2.summon;
  const alive = state.enemies.filter((x) => x.summoned && x.owner === e.bossId).length;
  for (let k = 0; k < sum.n && alive + k < sum.max; k++) {
    for (let tries = 0; tries < 12; tries++) {
      const a = rand(state) * Math.PI * 2, r = (2 + rand(state) * 3) * TILE;
      const x = e.arena.x + Math.cos(a) * r, y = e.arena.y + Math.sin(a) * r;
      if (!freeSpot(state, e.map, x, y, ENEMIES.slime.radius)) continue;
      const s = makeEnemy(state, sum.enemy, e.map, x, y, { summoned: true, owner: e.bossId, state: 'chase' });
      state.enemies.push(s);
      svc.emit(state, { type: 'summon', x, y });
      break;
    }
  }
}

function clampToArena(e) {
  const max = Math.max(0, e.arena.r * TILE - e.radius * 0.6);
  const d = Math.hypot(e.x - e.arena.x, e.y - e.arena.y);
  if (d <= max) return false;
  e.x = e.arena.x + (e.x - e.arena.x) / d * max; e.y = e.arena.y + (e.y - e.arena.y) / d * max;
  return true;
}

function updateBoss(state, e, dt) {
  const p = state.player, def = BOSSES[e.bossId];
  e.hitT = Math.max(0, e.hitT - dt);
  const here = p.map === e.map;
  const dArena = here ? Math.hypot(p.x - e.arena.x, p.y - e.arena.y) : Infinity;
  if (!e.engaged) {
    if (here && dArena <= (e.arena.r + C.arenaStart) * TILE) engageBoss(state, e);
    return;
  }
  // 現場から離れたらリセット
  if (dArena > BOSSES.common.resetDistance * TILE) {
    e.farT += dt;
    if (e.farT >= BOSSES.common.resetTime) { resetBoss(state, e); return; }
  } else e.farT = 0;

  if (e.phase === 1 && e.hp <= e.maxHp * (def.phase2 ? def.phase2.hpBelow : 0.5)) {
    e.phase = 2; e.summonT = 0;
    svc.emit(state, { type: 'bossPhase', id: e.bossId });
    svc.msg(state, `${e.name}が荒れ狂った`, 'warn');
  }
  e.stunned = e.stunT > 0;
  if (e.bossId === 'vine' && e.phase === 2) {
    e.summonT -= dt;
    if (e.summonT <= 0) { e.summonT = def.phase2.summon.every; summonSlimes(state, e); }
  }

  if (e.state === 'stun') {
    e.stunT -= dt; e.moving = false;
    if (e.stunT <= 0) { e.stunT = 0; e.stunned = false; e.state = 'idle'; e.cooldown = 0.8; }
  } else if (e.state === 'idle') {
    e.cooldown -= dt;
    if (e.bossId === 'ash' && here) {
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
      if (d > 2.4 * TILE) {
        const sp = 1.7 * TILE * dt, [ux, uy] = unit(dx, dy);
        move(state, e, ux * sp, uy * sp); e.fx = ux; e.fy = uy; e.dir = dirName(ux, uy); e.moving = true;
        clampToArena(e);
      } else e.moving = false;
    }
    if (e.cooldown <= 0 && here) { const kind = pickBossAttack(state, e); e.last = kind; beginBossAttack(state, e, kind); }
  } else if (e.state === 'tele' || e.state === 'tele2') {
    e.t += dt; e.telegraph = Math.min(1, e.t / e.dur); e.moving = false;
    if (e.t >= e.dur) {
      if (e.state === 'tele2') { // 二連の灰炎の輪
        const t = e.tele, d = Math.hypot(p.x - e.x, p.y - e.y);
        if (here && d <= t.radius && d >= t.inner) damagePlayer(state, BOSSES.ash.attacks.ring.dmg, e.x, e.y);
        svc.emit(state, { type: 'enemyAttack', enemy: e.bossId, boss: true, attack: 'ring', x: e.x, y: e.y });
        e.second = false; e.state = 'recover'; e.t = 0; e.dur = 0.8; e.telegraph = null; e.tele = null;
      } else resolveBossAttack(state, e);
    }
  } else if (e.state === 'charging') {
    const a = def.attacks.charge, len = a.dist * TILE, speed = 16 * TILE, step = speed * dt;
    e.t += dt;
    const moved = move(state, e, e.lock.x * step, e.lock.y * step);
    e.travel += moved; e.moving = true;
    const clamped = clampToArena(e);
    if (!e.hitDone && here && Math.hypot(p.x - e.x, p.y - e.y) <= e.radius + P.radius) { if (damagePlayer(state, a.dmg, e.x, e.y)) e.hitDone = true; }
    if (clamped || moved < step * 0.5) { // 壁に当たって気絶
      e.state = 'stun'; e.stunT = a.stun; e.stunned = true; e.tele = null; e.telegraph = null; e.moving = false;
      svc.emit(state, { type: 'bossStun', id: e.bossId, x: e.x, y: e.y });
    } else if (e.travel >= len) { e.state = 'recover'; e.t = 0; e.dur = 0.9; e.tele = null; }
  } else if (e.state === 'recover') {
    e.t += dt; e.moving = false;
    if (e.t >= e.dur) { e.state = 'idle'; e.cooldown = 1.1 + rand(state) * 0.9; e.tele = null; e.telegraph = null; }
  }
}

/* ------------------------------------------------------------------ 弾 */
function updateProjectiles(state, dt) {
  const p = state.player;
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const pr = state.projectiles[i];
    pr.life -= dt;
    pr.x += pr.vx * dt; pr.y += pr.vy * dt;
    const m = state.world.maps[pr.map];
    let dead = pr.life <= 0 || TERRAIN_INFO[getTile(m, Math.floor(pr.x / TILE), Math.floor(pr.y / TILE))].solid;
    if (!dead && p.map === pr.map && Math.hypot(p.x - pr.x, p.y - pr.y) <= pr.radius + P.radius) {
      if (damagePlayer(state, pr.dmg, pr.x - pr.vx, pr.y - pr.vy)) dead = true;
      else if (inSafeZone(state, p.map, p.x, p.y)) dead = true;
    }
    if (dead) state.projectiles.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ 敵へのダメージと撃破 */
export function damageEnemy(state, e, dmg, kx = 0, ky = 0) {
  if (e.hp <= 0) return;
  const mul = e.stunned ? BOSSES.ash.attacks.charge.stunMul : 1;
  const real = Math.max(1, Math.round(dmg * mul) - (e.def || 0));
  e.hp -= real;
  e.hitT = 0.15;
  state.hitStop = P.hitStop;
  if (e.boss) engageBoss(state, e);
  else {
    move(state, e, kx * 16, ky * 16); // 押し戻しも壁を抜けない
    if (e.state === 'idle') { e.state = 'chase'; e.cooldown = 0; }
  }
  svc.emit(state, { type: 'enemyHit', x: e.x, y: e.y, dmg: real, boss: !!e.boss });
  if (e.hp <= 0) killEnemy(state, e);
}

function killEnemy(state, e) {
  const i = state.enemies.indexOf(e);
  if (i >= 0) state.enemies.splice(i, 1);
  e.tele = null; e.telegraph = null;
  svc.emit(state, { type: 'enemyDead', x: e.x, y: e.y, enemy: e.type, boss: !!e.boss });
  state.progress.stats.kills = (state.progress.stats.kills || 0) + 1;
  if (e.boss) {
    removeSummons(state, e.bossId);
    svc.onBossDefeated(state, e);
    return;
  }
  if (e.summoned) return;
  for (const d of ENEMIES[e.type].drop || []) svc.spawnGround(state, e.map, e.x, e.y, d.item, d.n);
}

/* ------------------------------------------------------------------ マップ移動・予兆の組み立て */
// 別のマップへ移るとき: 通常の敵は消え、ボスはリセットされて元のマップで待つ
export function onMapChange(state, newMap) {
  const all = state.enemies.concat(state.dormant);
  for (const e of all) if (e.boss) resetBoss(state, e, false);
  state.enemies = all.filter((e) => e.boss && e.map === newMap);
  state.dormant = all.filter((e) => e.boss && e.map !== newMap);
  state.projectiles.length = 0;
  state.timers.spawn = BALANCE.safe.spawnCheck;
  state.boss = null;
}

function buildTelegraphs(state) {
  const out = [];
  for (const e of state.enemies) {
    if (!e.tele) continue;
    const dur = e.dur || 0.5;
    out.push({ ...e.tele, map: e.map, remaining: Math.max(0, dur - e.t), duration: dur, owner: e.id });
  }
  state.telegraphs = out;
}

/* ------------------------------------------------------------------ ステップ */
export function stepCombat(state, dt) {
  updateSpawns(state, dt);
  pruneEnemies(state);
  for (const e of state.enemies.slice()) {
    if (e.hp <= 0) continue;
    if (e.boss) updateBoss(state, e, dt); else updateEnemy(state, e, dt);
  }
  // ボスが気絶中でもタイマーは進む
  for (const e of state.enemies) if (e.boss && e.stunT > 0 && e.state !== 'stun') e.stunT = Math.max(0, e.stunT - dt);
  updateProjectiles(state, dt);
  updateDeathBag(state);
  state.boss = state.enemies.find((e) => e.boss && e.engaged) || null;
  buildTelegraphs(state);
}
