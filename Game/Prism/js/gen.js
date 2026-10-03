// PRISM — ステージ自動生成（必ず解ける：解の配置を先に作り、そこへ届く光から受光器を決める）
import * as O from './optics.js';

const D = Math.PI / 180;
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r25 = (v) => Math.round(v * 4) / 4;
const r05 = (v) => Math.round(v * 20) / 20;
const rA = (deg) => Math.round(deg / 2.5) * 2.5;
const mod = (a, m) => ((a % m) + m) % m;
const angd = (a, b) => { let d = mod(a - b + 180, 360) - 180; return d; };
const PURE = [650, 598, 532, 492, 455, 420];

function openEnds(tr, lasers) {
  const S = tr.segs, ends = [];
  for (let i = 0; i < tr.nseg; i++) {
    const s = i * 6, x1 = S[s + 2], y1 = S[s + 3];
    if (!(x1 <= 0.01 || x1 >= O.W - 0.01 || y1 <= 0.01 || y1 >= O.H - 0.01)) continue;
    const x0 = S[s], y0 = S[s + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.3) continue;
    ends.push({ x0, y0, x1, y1, len, b: S[s + 4] | 0, p: S[s + 5], ang: Math.atan2(y1 - y0, x1 - x0) / D });
  }
  const groups = [];
  for (const e of ends) {
    let g = groups.find(g => Math.hypot(g.x0 - e.x0, g.y0 - e.y0) < 0.5 && Math.abs(angd(g.ang, e.ang)) < 25);
    if (!g) { g = { x0: e.x0, y0: e.y0, ang: e.ang, items: [], p: 0, len: 0 }; groups.push(g); }
    g.items.push(e); g.p += e.p; g.len = Math.max(g.len, e.len);
  }
  for (const g of groups) {
    g.items.sort((a, b) => a.b - b.b);
    g.rep = g.items[g.items.length >> 1];
    g.fromLaser = lasers.some(L => Math.hypot(L.x - g.x0, L.y - g.y0) < L.r + 0.3);
  }
  return groups.filter(g => g.p > 0.1 && !g.fromLaser);
}

function weighted(rand, items, w) {
  let tot = 0; for (const x of w) tot += x;
  let r = rand() * tot;
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

export function generate(seed, d = 5) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const rand = rng(seed * 7919 + attempt * 104729);
    const res = tryBuild(rand, d);
    if (res) { res.attempt = attempt; return res; }
  }
  return null;
}

function tryBuild(rand, d) {
  const els = [];
  const mk = (type, props) => { const e = O.makeElement(type, props); e.sol = { x: e.x, y: e.y, a: e.a }; els.push(e); return e; };
  const lasers = [];
  const useWhite = d >= 3 && rand() < 0.35 + d * 0.06;
  const nLas = d >= 6 && rand() < 0.45 ? 2 : (d >= 9 && rand() < 0.3 ? 3 : 1);
  const usedSides = new Set();
  for (let i = 0; i < nLas; i++) {
    let side = Math.floor(rand() * 3); // 0 left,1 top,2 right
    if (usedSides.has(side)) side = (side + 1) % 3;
    usedSides.add(side);
    let x, y, a;
    if (side === 0) { x = 1; y = r25(1 + rand() * 5.5); a = [0, 0, 45, -45][Math.floor(rand() * 4)]; if (y < 2.5 && a === -45) a = 0; if (y > 5 && a === 45) a = 0; }
    else if (side === 1) { x = r25(2 + rand() * 11); y = 0.75; a = [90, 45, 135][Math.floor(rand() * 3)]; }
    else { x = 15; y = r25(1 + rand() * 5.5); a = [180, 180, 135, 225][Math.floor(rand() * 4)]; if (y < 2.5 && a === 225) a = 180; if (y > 5 && a === 135) a = 180; }
    const spec = (useWhite && i === 0) ? 'white' : PURE[Math.floor(rand() * PURE.length)];
    const L = mk('laser', { x, y, a: a * D, spec, fixed: true });
    lasers.push(L);
  }
  const nOps = 1 + Math.floor(d * 0.75) + (rand() < 0.5 ? 1 : 0);
  let mvCount = 0;
  for (let step = 0, fails = 0; step < nOps && fails < 40;) {
    if (mvCount >= 8) break;
    const tr = O.trace(els);
    const groups = openEnds(tr, lasers).filter(g => g.len > 2.3);
    // 最初の一手は必ずレーザーのビーム
    let cand;
    if (!els.some(e => e.type !== 'laser')) {
      cand = lasers.map(L => ({ x0: L.x + Math.cos(L.a) * L.r, y0: L.y + Math.sin(L.a) * L.r, ang: L.a / D, len: rayLen(L), rep: null, items: laserBins(L), p: 1 }));
      cand.forEach(c => { c.rep = { x0: c.x0, y0: c.y0, ang: c.ang, len: c.len, b: 16 }; });
    } else cand = groups;
    if (!cand.length) { fails++; continue; }
    const g = weighted(rand, cand, cand.map(c => Math.min(c.len, 8) * Math.sqrt(c.p)));
    const rep = g.rep;
    const th = rep.ang;
    const t = 1.0 + rand() * Math.max(0.1, Math.min(3.2, rep.len - 2.4));
    const px = rep.x0 + Math.cos(th * D) * t, py = rep.y0 + Math.sin(th * D) * t;
    if (px < 0.8 || px > 15.2 || py < 0.6 || py > 7.3) { fails++; continue; }
    const nb = g.items.length;
    const types = ['mirror'];
    const w = [6];
    if (d >= 2) { types.push('splitter'); w.push(1.5 + d * 0.25); }
    if (d >= 3 && nb >= 24) { types.push('prism'); w.push(3 + d * 0.3); }
    if (d >= 5 && nb >= 8) { types.push('filter'); w.push(1.6); }
    if (d >= 5) { types.push('ball'); w.push(1.1); }
    if (d >= 6) { types.push('slab'); w.push(1.1); }
    if (d >= 7) { types.push('well'); w.push(1.6); }
    const type = weighted(rand, types, w);
    let el;
    if (type === 'mirror') {
      const dl = [45, -45, 90, -90][Math.floor(rand() * 4)];
      el = O.makeElement('mirror', { x: r25(px), y: r25(py), a: rA(mod(th + dl / 2, 180)) * D });
    } else if (type === 'splitter') {
      const dl = rand() < 0.5 ? 90 : -90;
      el = O.makeElement('splitter', { x: r25(px), y: r25(py), a: rA(mod(th + dl / 2, 180)) * D });
    } else if (type === 'prism') {
      const off = rand() < 0.5 ? 20 : 40;
      el = O.makeElement('prism', { x: r25(px), y: r25(py), a: rA(mod(th + off, 120)) * D, r: 0.7 });
    } else if (type === 'slab') {
      const phi = (rand() < 0.5 ? 1 : -1) * [30, 40, 50, 60][Math.floor(rand() * 4)];
      el = O.makeElement('slab', { x: r25(px), y: r25(py), a: rA(mod(th + phi, 180)) * D, w: 2.0, h: 1.0 });
    } else if (type === 'ball') {
      const off = (rand() < 0.5 ? 1 : -1) * (0.2 + rand() * 0.35);
      const nx = -Math.sin(th * D), ny = Math.cos(th * D);
      el = O.makeElement('ball', { x: r25(px + nx * off), y: r25(py + ny * off), r: 0.7 });
    } else if (type === 'well') {
      const bb = (rand() < 0.5 ? 1 : -1) * (0.9 + rand() * 0.8);
      const nx = -Math.sin(th * D), ny = Math.cos(th * D);
      el = O.makeElement('well', { x: r25(px + nx * bb), y: r25(py + ny * bb), k: rand() < 0.3 ? -0.3 : 0.3 });
    } else {
      const bs = g.items.map(i => i.b);
      const i0 = bs[Math.floor(rand() * bs.length)], span = 3 + Math.floor(rand() * 8);
      const step = (O.LMAX - O.LMIN) / O.NB;
      el = O.makeElement('filter', { x: r25(px), y: r25(py), a: rA(mod(th + 90, 180)) * D, lo: O.LMIN + Math.max(0, i0 - span / 2) * step, hi: O.LMIN + Math.min(O.NB, i0 + span / 2 + 1) * step });
    }
    if (!O.placementOk(el, els)) { fails++; continue; }
    // 要素同士が近すぎないように
    if (els.some(o => o !== el && Math.hypot(o.x - el.x, o.y - el.y) < 0.8)) { fails++; continue; }
    els.push(el); el.sol = { x: el.x, y: el.y, a: el.a };
    const tr2 = O.trace(els);
    const g2 = openEnds(tr2, lasers).filter(x => x.len > 1.4);
    const need = type === 'splitter' ? g2.length >= groups.length + 1 : g2.length >= Math.max(1, groups.length);
    if (!need || !g2.length || Math.max(...g2.map(x => x.len)) < 2.2) { els.pop(); fails++; continue; }
    mvCount++; step++;
  }
  if (els.filter(e => e.mv).length < 1) return null;

  // 受光器を決める
  const tr = O.trace(els);
  const groups = openEnds(tr, lasers).filter(g => g.len > 1.8);
  if (!groups.length) return null;
  const maxT = Math.min(6, 1 + Math.floor(d / 1.8) + (nLas > 1 ? 1 : 0));
  groups.sort((a, b) => b.p - a.p);
  const targets = [];
  for (const g of groups) {
    if (targets.length >= maxT) break;
    const fan = g.items.length >= 12 && Math.abs(g.items[0].ang - g.items[g.items.length - 1].ang) > 2.5;
    const picks = fan ? Math.min(maxT - targets.length, 1 + Math.floor(rand() * 2.5)) : 1;
    const chosen = new Set();
    for (let k = 0; k < picks; k++) {
      const item = g.items[Math.floor(rand() * g.items.length)];
      if (fan && [...chosen].some(c => Math.abs(c - item.b) < 7)) continue;
      chosen.add(item.b);
      const s = 1.3 + rand() * Math.max(0.1, item.len - 2.3);
      const tx = r05(item.x0 + Math.cos(item.ang * D) * s), ty = r05(item.y0 + Math.sin(item.ang * D) * s);
      const T = O.makeElement('target', { x: tx, y: ty, r: fan ? 0.36 : 0.4 });
      if (tx < 0.7 || tx > 15.3 || ty < 0.6 || ty > 7.3) continue;
      if (!O.placementOk(T, els)) continue;
      if (els.some(o => o.type === 'target' && Math.hypot(o.x - tx, o.y - ty) < 1.0)) continue;
      els.push(T); T.sol = { x: tx, y: ty, a: 0 };
      targets.push(T);
    }
  }
  if (!targets.length) return null;
  const trF = O.trace(els);
  for (const r of trF.targets) {
    if (!O.fitTarget(r.el, r.hit, 0.55)) { els.splice(els.indexOf(r.el), 1); continue; }
    let inE = 0; for (let b = 0; b < O.NB; b++) if (O.LAM[b] >= r.el.lo && O.LAM[b] <= r.el.hi) inE += r.hit[b];
    if (inE < 0.05) els.splice(els.indexOf(r.el), 1);
  }
  const tgts = els.filter(e => e.type === 'target');
  if (!tgts.length) return null;
  if (!O.allSolved(O.trace(els))) return null;

  // 役に立たない部品は取り除く
  for (const e of els.filter(x => x.mv)) {
    const rest = els.filter(x => x !== e);
    if (O.allSolved(O.trace(rest))) els.splice(els.indexOf(e), 1);
  }
  if (!els.some(e => e.mv)) return null;
  if (!O.allSolved(O.trace(els))) return null;

  // 一部のミラーを固定／回転のみにして難度を調整
  const mvs = els.filter(e => e.mv);
  if (mvs.length > 2) {
    for (const e of mvs) {
      if (e.type !== 'mirror' || mvs.filter(x => x.mv).length <= 2) continue;
      const r = rand();
      if (r < Math.max(0.05, 0.3 - d * 0.03)) { e.mv = false; e.rt = false; e.fixedDeco = true; }
      else if (r < 0.3 && d < 6) { e.mv = false; e.rt = true; e.pivotStart = rA(mod(e.a / D + 25 + rand() * 120, 180)); }
    }
  }
  if (els.filter(e => e.mv || (e.rt && !e.mv)).length < 1) return null;

  // 邪魔な壁（光路から離れた場所）
  const trW = O.trace(els);
  const nWalls = Math.floor(rand() * (1 + d / 3));
  for (let k = 0, tries = 0; k < nWalls && tries < 60; tries++) {
    const w = r25(0.5 + rand() * 1.5), h = r25(0.5 + rand() * 2);
    const x = r25(1.5 + rand() * 13), y = r25(1 + rand() * 6);
    const W_ = O.makeElement('wall', { x, y, w, h, a: 0 });
    if (!O.placementOk(W_, els)) continue;
    // 光路から十分離れている
    let ok = true;
    for (let i = 0; i < trW.nseg && ok; i += 1) {
      const s = i * 6;
      if (distSeg(x, y, trW.segs[s], trW.segs[s + 1], trW.segs[s + 2], trW.segs[s + 3]) < Math.hypot(w, h) / 2 + 0.5) ok = false;
    }
    if (!ok) continue;
    els.push(W_); k++;
  }
  // 開始状態で解けていたら不採用
  const defEls = toDef(els);
  const test = O.loadLevel({ elements: defEls });
  if (O.allSolved(O.trace(test))) return null;
  // 開始配置のストックが重ならない
  for (const e of test) if (!O.placementOk(e, test)) return null;
  return { elements: defEls, nTargets: tgts.length, nPieces: els.filter(e => e.mv).length };
}

function rayLen(L) {
  const dx = Math.cos(L.a), dy = Math.sin(L.a);
  let t = 1e9;
  if (dx > 1e-9) t = Math.min(t, (O.W - L.x) / dx); else if (dx < -1e-9) t = Math.min(t, -L.x / dx);
  if (dy > 1e-9) t = Math.min(t, (O.H - L.y) / dy); else if (dy < -1e-9) t = Math.min(t, -L.y / dy);
  return t - L.r;
}
function laserBins(L) {
  const w = O.laserSpectrum(L); const out = [];
  for (let b = 0; b < O.NB; b++) if (w[b] > 0) out.push({ b });
  return out;
}
function distSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
}

const KEEP = {
  laser: ['spec', 'r'], mirror: ['len'], splitter: ['len', 'ratio'], filter: ['len', 'lo', 'hi'],
  prism: ['r', 'n', 'disp'], slab: ['w', 'h', 'n', 'disp'], ball: ['r', 'n', 'disp'], wall: ['w', 'h'],
  target: ['r', 'lo', 'hi', 'minE', 'tol'], well: ['r', 'k', 'R'],
};
export function toDef(els) {
  return els.map(e => {
    const o = { type: e.type, x: e.x, y: e.y, a: Math.round(e.a / D * 100) / 100 };
    for (const k of KEEP[e.type]) o[k] = e[k];
    if (e.type === 'target' || e.type === 'wall') o.fixed = true;
    else if (!e.mv && !e.rt) o.fixed = true;
    else if (!e.mv && e.rt) { o.pivot = true; o.start = { a: e.pivotStart != null ? e.pivotStart : mod(o.a + 40, 180) }; }
    return o;
  });
}
