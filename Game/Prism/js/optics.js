// PRISM — 光学エンジン（DOM非依存）
// 座標系: 盤面 W×H ユニット、y は下向き、角度は x 軸から時計回り（ラジアン）。
// 光は NB 個の波長ビンで追跡し、プリズムで本当に分散する。

export const W = 16;
export const H = 9;
export const TRAY_Y = 7.85; // これより下は「ストック置き場」

export const NB = 32;
export const LMIN = 400;
export const LMAX = 700;
export const LAM = new Float32Array(NB);
for (let i = 0; i < NB; i++) LAM[i] = LMIN + (i + 0.5) * (LMAX - LMIN) / NB;

// ---- 波長 → 線形RGB（Wyman 近似）。全ビン平均が (1,1,1) になるよう正規化 ----
function gk(l, mu, s1, s2) {
  const t = (l - mu) / (l < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
export function wavelengthRGB(l) {
  const x = 1.056 * gk(l, 599.8, 37.9, 31.0) + 0.362 * gk(l, 442.0, 16.0, 26.7) - 0.065 * gk(l, 501.1, 20.4, 26.2);
  const y = 0.821 * gk(l, 568.8, 46.9, 40.5) + 0.286 * gk(l, 530.9, 16.3, 31.1);
  const z = 1.217 * gk(l, 437.0, 11.8, 36.0) + 0.681 * gk(l, 459.0, 26.0, 13.8);
  return [
    Math.max(0, 3.2406 * x - 1.5372 * y - 0.4986 * z),
    Math.max(0, -0.9689 * x + 1.8758 * y + 0.0415 * z),
    Math.max(0, 0.0557 * x - 0.2040 * y + 1.0570 * z),
  ];
}
export const BIN_RGB = (() => {
  const c = [];
  const m = [0, 0, 0];
  for (let i = 0; i < NB; i++) {
    const v = wavelengthRGB(LAM[i]);
    c.push(v);
    for (let k = 0; k < 3; k++) m[k] += v[k] / NB;
  }
  // 青の下端・赤の上端は暗いので少し持ち上げる
  for (let i = 0; i < NB; i++) {
    for (let k = 0; k < 3; k++) c[i][k] /= m[k];
    const e = Math.min(i, NB - 1 - i);
    const lift = e < 3 ? 1 + (3 - e) * 0.25 : 1;
    for (let k = 0; k < 3; k++) c[i][k] *= lift;
  }
  return c;
})();
export function nmRGB(nm) {
  const f = (nm - LMIN) / (LMAX - LMIN) * NB - 0.5;
  const i0 = Math.max(0, Math.min(NB - 1, Math.floor(f)));
  const i1 = Math.min(NB - 1, i0 + 1);
  const t = Math.max(0, Math.min(1, f - i0));
  return [0, 1, 2].map(k => BIN_RGB[i0][k] * (1 - t) + BIN_RGB[i1][k] * t);
}
// 表示用：単色 [0..1] に正規化した色（UI用）
export function nmCss(nm, lum = 1) {
  const c = nmRGB(nm);
  const m = Math.max(c[0], c[1], c[2], 1e-6);
  const g = (v) => Math.round(255 * Math.pow(Math.min(1, v / m) * lum, 1 / 1.6));
  return `rgb(${g(c[0])},${g(c[1])},${g(c[2])})`;
}

// ---- スペクトル（エネルギー合計=1） ----
export function spectrumOf(spec) {
  const w = new Float32Array(NB);
  if (spec === 'white' || spec == null) {
    w.fill(1 / NB);
  } else if (typeof spec === 'number') {
    let s = 0;
    for (let i = 0; i < NB; i++) {
      const d = (LAM[i] - spec) / 9;
      w[i] = Math.exp(-0.5 * d * d);
      if (w[i] < 0.04) w[i] = 0;
      s += w[i];
    }
    for (let i = 0; i < NB; i++) w[i] /= s;
  } else if (Array.isArray(spec)) {
    let s = 0;
    for (let i = 0; i < NB; i++) { if (LAM[i] >= spec[0] && LAM[i] <= spec[1]) { w[i] = 1; s++; } }
    if (s === 0) w.fill(1 / NB); else for (let i = 0; i < NB; i++) w[i] /= s;
  }
  return w;
}

// ---- 要素の定義 ----
export const TYPES = {
  laser: { mv: false, rt: false, r: 0.32 },
  mirror: { mv: true, rt: true, len: 1.7 },
  splitter: { mv: true, rt: true, len: 1.7, ratio: 0.5 },
  filter: { mv: true, rt: true, len: 1.5, lo: 400, hi: 700 },
  prism: { mv: true, rt: true, r: 0.7, n: 1.55, disp: 0.32 },
  slab: { mv: true, rt: true, w: 1.5, h: 0.62, n: 1.55, disp: 0.2 },
  ball: { mv: true, rt: true, r: 0.62, n: 1.6, disp: 0.2 },
  wall: { mv: false, rt: false, w: 1.2, h: 1.2 },
  target: { mv: false, rt: false, r: 0.42, lo: 400, hi: 700, minE: 0.5, tol: 0.04 },
  well: { mv: true, rt: false, r: 0.4, k: 0.3, R: 5.5 },
};
export const MOVABLE_TYPES = ['mirror', 'splitter', 'filter', 'prism', 'slab', 'ball', 'well'];

let _uid = 1;
export function makeElement(type, props = {}) {
  const d = TYPES[type];
  const el = Object.assign({ type, id: _uid++, x: 0, y: 0, a: 0, mv: d.mv, rt: d.rt }, d, props);
  if (props.fixed) { el.mv = false; el.rt = false; }
  if (props.pivot) { el.mv = false; el.rt = true; }
  return el;
}

// ---- 形状（ワールド座標） ----
const SEG = 0, POLY = 1, CIRC = 2;

function rot(x, y, c, s) { return [x * c - y * s, x * s + y * c]; }

function shapeOf(el) {
  const c = Math.cos(el.a), s = Math.sin(el.a);
  switch (el.type) {
    case 'mirror': case 'splitter': case 'filter': {
      const hx = c * el.len / 2, hy = s * el.len / 2;
      const x0 = el.x - hx, y0 = el.y - hy, x1 = el.x + hx, y1 = el.y + hy;
      return { kind: SEG, el, x0, y0, ex: x1 - x0, ey: y1 - y0, nx: -(y1 - y0) / el.len, ny: (x1 - x0) / el.len };
    }
    case 'prism': {
      const r = el.r;
      const loc = [[0, -r], [r * Math.cos(Math.PI / 6), r * 0.5], [-r * Math.cos(Math.PI / 6), r * 0.5]];
      return polyShape(el, loc, c, s);
    }
    case 'slab': case 'wall': {
      const hw = el.w / 2, hh = el.h / 2;
      return polyShape(el, [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], c, s);
    }
    case 'ball': case 'target': case 'laser':
      return { kind: CIRC, el, cx: el.x, cy: el.y, r: el.r };
  }
  return null;
}
function polyShape(el, loc, c, s) {
  const n = loc.length;
  const vx = new Float64Array(n), vy = new Float64Array(n), nx = new Float64Array(n), ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y] = rot(loc[i][0], loc[i][1], c, s);
    vx[i] = el.x + x; vy[i] = el.y + y;
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = vx[j] - vx[i], ey = vy[j] - vy[i];
    const l = Math.hypot(ex, ey);
    let px = ey / l, py = -ex / l;
    // 外向きにそろえる
    if (px * (vx[i] - el.x) + py * (vy[i] - el.y) < 0) { px = -px; py = -py; }
    nx[i] = px; ny[i] = py;
  }
  return { kind: POLY, el, n, vx, vy, nx, ny };
}

// ---- 衝突判定用ポリゴン（やや太らせた外形） ----
export function footprint(el) {
  const c = Math.cos(el.a), s = Math.sin(el.a);
  const P = (pts) => pts.map(([x, y]) => { const [rx, ry] = rot(x, y, c, s); return [el.x + rx, el.y + ry]; });
  switch (el.type) {
    case 'mirror': case 'splitter': case 'filter': {
      const hl = el.len / 2, t = 0.07;
      return P([[-hl, -t], [hl, -t], [hl, t], [-hl, t]]);
    }
    case 'prism': { const r = el.r; return P([[0, -r], [r * 0.866, r * 0.5], [-r * 0.866, r * 0.5]]); }
    case 'slab': case 'wall': { const hw = el.w / 2, hh = el.h / 2; return P([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]); }
    default: {
      const r = el.r, out = [];
      for (let i = 0; i < 16; i++) { const t = i / 16 * Math.PI * 2; out.push([el.x + r * Math.cos(t), el.y + r * Math.sin(t)]); }
      return out;
    }
  }
}
export function polysOverlap(A, B, margin = 0.04) {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      let nx = poly[j][1] - poly[i][1], ny = -(poly[j][0] - poly[i][0]);
      const l = Math.hypot(nx, ny); if (l < 1e-9) continue; nx /= l; ny /= l;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of A) { const d = p[0] * nx + p[1] * ny; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const p of B) { const d = p[0] * nx + p[1] * ny; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      if (a1 + margin <= b0 || b1 + margin <= a0) return false;
    }
  }
  return true;
}
export function boundsOk(poly, pad = 0.03) {
  for (const p of poly) if (p[0] < pad || p[0] > W - pad || p[1] < pad || p[1] > H - pad) return false;
  return true;
}
// 要素 el を（配置候補）他の要素や盤面外とぶつけずに置けるか
export function placementOk(el, els) {
  const fp = footprint(el);
  if (el.type !== 'wall' && !boundsOk(fp)) return false;
  for (const o of els) {
    if (o === el) continue;
    if (polysOverlap(fp, footprint(o))) return false;
  }
  return true;
}
// 点と要素の距離（選択用）
export function distToElement(el, px, py) {
  switch (el.type) {
    case 'mirror': case 'splitter': case 'filter': {
      const c = Math.cos(el.a), s = Math.sin(el.a);
      const dx = px - el.x, dy = py - el.y;
      const u = Math.max(-el.len / 2, Math.min(el.len / 2, dx * c + dy * s));
      return Math.hypot(dx - u * c, dy - u * s);
    }
    case 'prism': case 'slab': case 'wall': {
      const f = footprint(el);
      let inside = true, md = Infinity;
      for (let i = 0; i < f.length; i++) {
        const j = (i + 1) % f.length;
        const ex = f[j][0] - f[i][0], ey = f[j][1] - f[i][1];
        const cr = ex * (py - f[i][1]) - ey * (px - f[i][0]);
        if (cr < 0) inside = false;
        const l2 = ex * ex + ey * ey;
        const t = Math.max(0, Math.min(1, ((px - f[i][0]) * ex + (py - f[i][1]) * ey) / l2));
        md = Math.min(md, Math.hypot(px - f[i][0] - t * ex, py - f[i][1] - t * ey));
      }
      // 頂点順序が反時計/時計どちらでも内外判定できるように
      let inside2 = true;
      for (let i = 0; i < f.length; i++) {
        const j = (i + 1) % f.length;
        const ex = f[j][0] - f[i][0], ey = f[j][1] - f[i][1];
        const cr = ex * (py - f[i][1]) - ey * (px - f[i][0]);
        if (cr > 0) inside2 = false;
      }
      return (inside || inside2) ? 0 : md;
    }
    default:
      return Math.max(0, Math.hypot(px - el.x, py - el.y) - el.r);
  }
}

// ---- 屈折率（分散） ----
export function indexAt(el, lam) {
  const k = (550 / lam) * (550 / lam) - 1;
  return el.n + el.disp * k * 0.5;
}

// ---- 光線追跡 ----
const EPS = 1e-5;
const MAX_SEGS = 14000;
const MAX_STEPS = 48;

function nearest(ox, oy, dx, dy, shapes, out) {
  let bt = Infinity, bi = -1, bnx = 0, bny = 0;
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    if (s.kind === SEG) {
      const den = dx * s.ey - dy * s.ex;
      if (den > -1e-12 && den < 1e-12) continue;
      const px = s.x0 - ox, py = s.y0 - oy;
      const t = (px * s.ey - py * s.ex) / den;
      if (t <= EPS || t >= bt) continue;
      const u = (px * dy - py * dx) / den;
      if (u < 0 || u > 1) continue;
      bt = t; bi = i; bnx = s.nx; bny = s.ny;
    } else if (s.kind === POLY) {
      for (let k = 0; k < s.n; k++) {
        const j = k + 1 === s.n ? 0 : k + 1;
        const ex = s.vx[j] - s.vx[k], ey = s.vy[j] - s.vy[k];
        const den = dx * ey - dy * ex;
        if (den > -1e-12 && den < 1e-12) continue;
        const px = s.vx[k] - ox, py = s.vy[k] - oy;
        const t = (px * ey - py * ex) / den;
        if (t <= EPS || t >= bt) continue;
        const u = (px * dy - py * dx) / den;
        if (u < 0 || u > 1) continue;
        bt = t; bi = i; bnx = s.nx[k]; bny = s.ny[k];
      }
    } else {
      const ocx = ox - s.cx, ocy = oy - s.cy;
      const b = ocx * dx + ocy * dy;
      const cc = ocx * ocx + ocy * ocy - s.r * s.r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t = -b - sq;
      if (t <= EPS) t = -b + sq;
      if (t <= EPS || t >= bt) continue;
      bt = t; bi = i;
      const hx = ox + dx * t, hy = oy + dy * t;
      bnx = (hx - s.cx) / s.r; bny = (hy - s.cy) / s.r;
    }
  }
  out.t = bt; out.i = bi; out.nx = bnx; out.ny = bny;
}

export function laserSpectrum(el) { return spectrumOf(el.spec); }

export function trace(els) {
  const shapes = [];
  const lasers = [];
  const targets = [];
  for (const el of els) {
    const s = shapeOf(el);
    if (!s) continue;
    shapes.push(s);
    if (el.type === 'laser') lasers.push(el);
    if (el.type === 'target') { targets.push(el); }
  }
  const segs = []; // x0,y0,x1,y1,bin,p
  const segS = []; // 各セグメント始点までの光路長
  const segF = []; // 平らな端のフラグ（曲線ビームのつなぎ目）
  const wells = els.filter(e => e.type === 'well');
  const marks = []; // x,y,r,g,b,kind
  const markS = [];
  let curS = 0; // kind: 0=mirror 1=glass 2=target 3=wall 4=split 5=filter 6=laser
  const hits = new Map();
  for (const t of targets) hits.set(t.id, new Float32Array(NB));
  const stack = [];
  const hit = { t: 0, i: -1, nx: 0, ny: 0 };
  let nseg = 0;
  const pushSeg = (x0, y0, x1, y1, bin, pw, s, fs, fe) => { segs.push(x0, y0, x1, y1, bin, pw); segS.push(s); segF.push(fs + fe * 2); nseg++; };

  // 重力井戸があるときは光線を少しずつ進めて曲げる
  const march = (x, y, dx, dy, b, p, sc) => {
    let ax = x, ay = y, first = true, acc = 0, cx = x, cy = y, d0x = dx, d0y = dy;
    for (let it = 0; it < 1400 && nseg < MAX_SEGS + 2000; it++) {
      let rmin = 1e9;
      for (const w of wells) { const d = Math.hypot(w.x - cx, w.y - cy); if (d < rmin) rmin = d; }
      const h = rmin > 2.5 ? 0.12 : rmin > 1.2 ? 0.07 : 0.035;
      nearest(cx, cy, dx, dy, shapes, hit);
      let tw = Infinity;
      if (dx > 1e-12) tw = Math.min(tw, (W - cx) / dx); else if (dx < -1e-12) tw = Math.min(tw, (0 - cx) / dx);
      if (dy > 1e-12) tw = Math.min(tw, (H - cy) / dy); else if (dy < -1e-12) tw = Math.min(tw, (0 - cy) / dy);
      const th = hit.i >= 0 ? hit.t : Infinity;
      const tH = Math.min(th, tw);
      if (tH <= h) {
        cx += dx * tH; cy += dy * tH;
        const len = Math.hypot(cx - ax, cy - ay);
        if (len > 1e-6) { pushSeg(ax, ay, cx, cy, b, p, sc, first ? 0 : 1, 0); sc += len; }
        return { kind: th <= tw ? 'hit' : 'border', x: cx, y: cy, dx, dy, sc };
      }
      let gx = 0, gy = 0;
      for (const w of wells) {
        const vx = w.x - cx, vy = w.y - cy, r2 = vx * vx + vy * vy + 0.02, r = Math.sqrt(r2);
        if (r > w.R) continue;
        const q = 1 - (r / w.R) * (r / w.R);
        const f = w.k / r2 * q * q;
        gx += vx / r * f; gy += vy / r * f;
      }
      const dt_ = gx * dx + gy * dy;
      let nx_ = dx + (gx - dt_ * dx) * h, ny_ = dy + (gy - dt_ * dy) * h;
      const nl = Math.hypot(nx_, ny_); nx_ /= nl; ny_ /= nl;
      let mx = dx + nx_, my = dy + ny_; const ml = Math.hypot(mx, my); mx /= ml; my /= ml;
      cx += mx * h; cy += my * h; dx = nx_; dy = ny_;
      acc += h;
      for (const w of wells) {
        if (w.k > 0 && Math.hypot(w.x - cx, w.y - cy) < w.r) {
          const len = Math.hypot(cx - ax, cy - ay);
          if (len > 1e-6) { pushSeg(ax, ay, cx, cy, b, p, sc, first ? 0 : 1, 0); sc += len; }
          return { kind: 'absorb', x: cx, y: cy, dx, dy, sc };
        }
      }
      if (cx < -1 || cx > W + 1 || cy < -1 || cy > H + 1) return { kind: 'timeout', x: cx, y: cy, dx, dy, sc };
      if (acc >= 0.3 || dx * d0x + dy * d0y < 0.9988) {
        const len = Math.hypot(cx - ax, cy - ay);
        pushSeg(ax, ay, cx, cy, b, p, sc, first ? 0 : 1, 1); sc += len;
        ax = cx; ay = cy; first = false; acc = 0; d0x = dx; d0y = dy;
      }
    }
    return { kind: 'timeout', x: cx, y: cy, dx, dy, sc };
  };

  const addMark = (x, y, bin, p, kind) => {
    const c = BIN_RGB[bin];
    marks.push(x, y, c[0] * p, c[1] * p, c[2] * p, kind); markS.push(curS);
  };

  for (const L of lasers) {
    const w = laserSpectrum(L);
    const dx = Math.cos(L.a), dy = Math.sin(L.a);
    for (let b = 0; b < NB; b++) {
      if (w[b] <= 0) continue;
      stack.push({ x: L.x + dx * (L.r + 0.002), y: L.y + dy * (L.r + 0.002), dx, dy, p: w[b], p0: w[b], b, depth: 0, s: 0 });
    }
  }

  while (stack.length && nseg < MAX_SEGS) {
    const r = stack.pop();
    let { x, y, dx, dy, p } = r;
    let sc = r.s;
    const b = r.b, lam = LAM[b];
    for (let step = 0; step < MAX_STEPS; step++) {
      let hx, hy;
      if (wells.length) {
        const m = march(x, y, dx, dy, b, p, sc);
        sc = m.sc; curS = sc;
        if (m.kind !== 'hit') { if (m.kind !== 'timeout') addMark(m.x, m.y, b, p, 3); break; }
        x = m.x; y = m.y; dx = m.dx; dy = m.dy; hx = x; hy = y;
      } else {
        nearest(x, y, dx, dy, shapes, hit);
        // 盤面の外壁までの距離
        let tw = Infinity;
        if (dx > 1e-12) tw = Math.min(tw, (W - x) / dx); else if (dx < -1e-12) tw = Math.min(tw, (0 - x) / dx);
        if (dy > 1e-12) tw = Math.min(tw, (H - y) / dy); else if (dy < -1e-12) tw = Math.min(tw, (0 - y) / dy);
        if (hit.i < 0 || tw < hit.t) {
          if (!(tw > 0)) break;
          const ex = x + dx * tw, ey = y + dy * tw;
          pushSeg(x, y, ex, ey, b, p, sc, 0, 0); curS = sc + tw;
          addMark(ex, ey, b, p, 3);
          break;
        }
        const t = hit.t;
        hx = x + dx * t; hy = y + dy * t;
        pushSeg(x, y, hx, hy, b, p, sc, 0, 0); sc += t; curS = sc;
      }
      const s = shapes[hit.i], el = s.el;
      let reflectOnly = false;
      if (el.type === 'mirror') {
        const dn = dx * hit.nx + dy * hit.ny;
        dx -= 2 * dn * hit.nx; dy -= 2 * dn * hit.ny;
        p *= 0.985;
        addMark(hx, hy, b, p, 0);
        x = hx; y = hy; continue;
      }
      if (el.type === 'splitter') {
        const dn = dx * hit.nx + dy * hit.ny;
        const rp = p * el.ratio;
        if (rp >= r.p0 * 0.02 && r.depth < 10) {
          stack.push({ x: hx, y: hy, dx: dx - 2 * dn * hit.nx, dy: dy - 2 * dn * hit.ny, p: rp, p0: r.p0, b, depth: r.depth + 1, s: sc });
        }
        p *= (1 - el.ratio);
        addMark(hx, hy, b, p, 4);
        x = hx; y = hy;
        if (p < r.p0 * 0.02) break;
        continue;
      }
      if (el.type === 'filter') {
        if (lam >= el.lo && lam <= el.hi) { p *= 0.97; x = hx; y = hy; addMark(hx, hy, b, p * 0.3, 5); continue; }
        addMark(hx, hy, b, p * 0.5, 5);
        break;
      }
      if (el.type === 'target') { hits.get(el.id)[b] += p; addMark(hx, hy, b, p, 2); break; }
      if (el.type === 'wall' || el.type === 'laser') { addMark(hx, hy, b, p, 3); break; }
      // ガラス（prism / slab / ball）
      const dn = dx * hit.nx + dy * hit.ny;
      const entering = dn < 0;
      const nn = lam; // placeholder to keep lints quiet
      const nIdx = indexAt(el, lam);
      const n1 = entering ? 1 : nIdx, n2 = entering ? nIdx : 1;
      const sx = entering ? hit.nx : -hit.nx, sy = entering ? hit.ny : -hit.ny; // 入射側へ向く法線
      const cosi = -(dx * sx + dy * sy);
      const eta = n1 / n2;
      const sin2t = eta * eta * (1 - cosi * cosi);
      if (sin2t >= 1) {
        // 全反射
        dx += 2 * cosi * sx; dy += 2 * cosi * sy;
        x = hx; y = hy;
        addMark(hx, hy, b, p * 0.5, 1);
        continue;
      }
      const cost = Math.sqrt(1 - sin2t);
      const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
      const rp_ = (n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi);
      const R = 0.5 * (rs * rs + rp_ * rp_);
      const pr = p * R;
      if (pr >= r.p0 * 0.03 && r.depth < 8) {
        stack.push({ x: hx, y: hy, dx: dx + 2 * cosi * sx, dy: dy + 2 * cosi * sy, p: pr, p0: r.p0, b, depth: r.depth + 1, s: sc });
      }
      const ndx = eta * dx + (eta * cosi - cost) * sx;
      const ndy = eta * dy + (eta * cosi - cost) * sy;
      dx = ndx; dy = ndy;
      p *= (1 - R);
      x = hx; y = hy;
      addMark(hx, hy, b, pr * 2, 1);
      void nn; void reflectOnly;
    }
  }

  const res = [];
  for (const t of targets) {
    const h = hits.get(t.id);
    res.push(evalTarget(t, h));
  }
  return { segs: new Float32Array(segs), segS: new Float32Array(segS), segF: new Float32Array(segF), nseg, marks: new Float32Array(marks), markS: new Float32Array(markS), targets: res };
}

export function evalTarget(t, h) {
  let inE = 0, outE = 0;
  for (let b = 0; b < NB; b++) {
    if (LAM[b] >= t.lo && LAM[b] <= t.hi) inE += h[b]; else outE += h[b];
  }
  const need = t.minE;
  const ok = inE >= need && outE <= t.tol;
  const fill = Math.min(1, inE / need);
  const bad = Math.min(1, outE / Math.max(t.tol, 1e-3));
  return { id: t.id, el: t, hit: h, inE, outE, ok, fill, bad };
}

export function allSolved(tr) {
  return tr.targets.length > 0 && tr.targets.every(t => t.ok);
}

// ---- レベルの読み込み ----
const DEG = Math.PI / 180;
// 解の姿勢で実際に届く光から、受光器の要求（波長帯・必要量・許容量）を決める
export function fitTarget(t, h, keep = 0.55) {
  let mx = 0;
  for (let b = 0; b < NB; b++) mx = Math.max(mx, h[b]);
  if (mx <= 0) return false;
  let b0 = NB, b1 = -1;
  for (let b = 0; b < NB; b++) if (h[b] >= 0.12 * mx) { if (b < b0) b0 = b; if (b > b1) b1 = b; }
  const step = (LMAX - LMIN) / NB;
  t.lo = Math.max(LMIN, LMIN + b0 * step - 0.5); t.hi = Math.min(LMAX, LMIN + (b1 + 1) * step + 0.5);
  let inE = 0, outE = 0;
  for (let b = 0; b < NB; b++) { if (LAM[b] >= t.lo && LAM[b] <= t.hi) inE += h[b]; else outE += h[b]; }
  t.minE = Math.round(keep * inE * 1000) / 1000;
  t.tol = Math.round((outE + 0.05) * 1000) / 1000;
  return true;
}

export function loadLevel(def) {
  const els = [];
  const trayItems = [];
  for (const d of def.elements) {
    const props = Object.assign({}, d);
    delete props.start; delete props.type;
    if (props.a != null) props.a *= DEG;
    if (props.fixed == null && (d.type === 'laser' || d.type === 'target' || d.type === 'wall')) {
      if (!props.pivot) props.fixed = true;
    }
    const el = makeElement(d.type, props);
    el.sol = { x: el.x, y: el.y, a: el.a };
    if (d.start) {
      if (d.start.x != null) el.x = d.start.x;
      if (d.start.y != null) el.y = d.start.y;
      if (d.start.a != null) el.a = d.start.a * DEG;
    } else if (el.mv) {
      trayItems.push(el);
    }
    els.push(el);
  }
  layoutTray(trayItems);
  if (els.some(e => e.auto)) {
    const saved = els.map(e => ({ x: e.x, y: e.y, a: e.a }));
    applySolution(els);
    const tr = trace(els);
    for (const r of tr.targets) if (r.el.auto) fitTarget(r.el, r.hit, r.el.keep || 0.55);
    els.forEach((e, i) => { e.x = saved[i].x; e.y = saved[i].y; e.a = saved[i].a; });
  }
  return els;
}

export function layoutTray(items) {
  const n = items.length;
  if (!n) return;
  const info = items.map(el => {
    const fp = footprint(Object.assign({}, el, { x: 0, y: 0, a: 0 }));
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of fp) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    return { w: x1 - x0, hh: Math.max(Math.abs(y0), Math.abs(y1)) };
  });
  const x0 = 1.2, x1 = W - 1.2, span = x1 - x0;
  const tot = info.reduce((s, i) => s + i.w, 0);
  let gap = n > 1 ? (span - tot) / (n - 1) : 0;
  gap = Math.max(0.12, Math.min(gap, 1.6));
  const used = tot + gap * (n - 1);
  let cx = W / 2 - used / 2;
  items.forEach((el, i) => {
    el.x = cx + info[i].w / 2; cx += info[i].w + gap;
    el.y = H - 0.06 - info[i].hh - (info[i].hh < 0.5 ? 0.12 : 0);
    el.a = 0;
  });
}

export function cloneElements(els) {
  return els.map(e => Object.assign({}, e, { sol: e.sol ? Object.assign({}, e.sol) : undefined }));
}
export function applySolution(els) {
  for (const e of els) if (e.sol) { e.x = e.sol.x; e.y = e.sol.y; e.a = e.sol.a; }
}
