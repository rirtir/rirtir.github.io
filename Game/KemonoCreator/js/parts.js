// 手続き生成のパーツ（耳・毛の房・尻尾・鼻・ヒゲ）
import * as THREE from 'three';

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 頂点・色・インデックスをためていく小さなビルダー
export class GeoBuilder {
  constructor() { this.pos = []; this.col = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  v(p, c) { this.pos.push(p.x, p.y, p.z); this.col.push(c.r, c.g, c.b); return this.n - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// 毛の房: 平たく先細りの曲がった円錐
// o: { p, d, up(厚み方向の目安), len, w, t, bend(Vector3, 長さに対する曲がり), sharp, c0, c1, tipAmt, segs, sides, sink }
export function addTuft(B, o) {
  const segs = o.segs || 7, sides = o.sides || 6;
  const len = o.len, sharp = o.sharp ?? 0.6;
  const k = 0.55 + sharp * 1.0;
  const pts = [], tans = [];
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const p = o.p.clone().addScaledVector(o.d, len * s - (o.sink ?? 0.006));
    if (o.bend) p.addScaledVector(o.bend, len * s * s);
    pts.push(p);
  }
  for (let i = 0; i <= segs; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(segs, i + 1)];
    tans.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  const c = new THREE.Color();
  const ring0 = B.n;
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const T = tans[i];
    const A = _a.copy(o.up).addScaledVector(T, -o.up.dot(T)).normalize();
    const Bv = _b.crossVectors(T, A).normalize();
    const prof = Math.pow(1 - s, k) * (0.72 + 0.5 * smooth(0, 0.35, s)) * (1 - 0.15 * s);
    const rw = o.w * prof, rt = o.t * prof;
    c.copy(o.c0).lerp(o.c1, smooth(1 - (o.tipAmt ?? 0) - 0.08, 1 - (o.tipAmt ?? 0) + 0.04, s));
    c.multiplyScalar(0.86 + 0.14 * smooth(0, 0.4, s));
    if (i === segs) {
      B.v(pts[i], c);
      continue;
    }
    for (let j = 0; j < sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      _v.copy(pts[i]).addScaledVector(Bv, Math.cos(th) * rw).addScaledVector(A, Math.sin(th) * rt);
      B.v(_v, c);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = ring0 + i * sides + j, b = ring0 + i * sides + (j + 1) % sides;
      const c2 = a + sides, d = b + sides;
      B.tri(a, d, b); B.tri(a, c2, d);
    }
  }
  const tip = ring0 + segs * sides, last = ring0 + (segs - 1) * sides;
  for (let j = 0; j < sides; j++) B.tri(last + (j + 1) % sides, last + j, tip);
  // 根元のふた
  const cen = B.v(pts[0], c.copy(o.c0).multiplyScalar(0.86));
  for (let j = 0; j < sides; j++) B.tri(ring0 + j, ring0 + (j + 1) % sides, cen);
}

// ---------------------------------------------------------------- 耳
export const EAR_TYPES = [
  { W: 0.033, H: 0.078, round: 0.12, cup: 0.55, fold: 0, a: 0.6, b: -0.05 },   // とがり耳
  { W: 0.042, H: 0.105, round: 0.08, cup: 0.6, fold: 0, a: 0.66, b: -0.02 },   // 大きいとがり耳
  { W: 0.038, H: 0.062, round: 0.22, cup: 0.55, fold: 0, a: 0.66, b: -0.08 },  // 猫耳
  { W: 0.034, H: 0.044, round: 1.0, cup: 0.45, fold: 0, a: 0.78, b: -0.05 },   // 丸耳
  { W: 0.038, H: 0.09, round: 0.65, cup: 0.25, fold: 1, a: 1.0, b: 0.05 },     // 垂れ耳
  { W: 0.03, H: 0.165, round: 0.72, cup: 0.6, fold: 0, a: 0.4, b: -0.12 },     // うさぎ耳
];

export function buildEar(st, cols) {
  const T = EAR_TYPES[st.earType] || EAR_TYPES[0];
  const W = T.W * st.earSize * st.earW, H = T.H * st.earSize * st.earH;
  const r = Math.min(1, Math.max(0, T.round + (st.earRound - 0.25)));
  const cup = (T.cup * 0.5 + st.earCup * 0.6);
  const fold = Math.min(1, T.fold + st.earFold);
  const B = new GeoBuilder();
  const nv = 20, nu = 10;
  const ring = 2 * nu;
  const cMain = cols.main, cIn = cols.inner, cTip = cols.tip;
  const c = new THREE.Color();
  const foldStart = 0.25;
  const p = new THREE.Vector3();
  for (let i = 0; i <= nv; i++) {
    const v = i / nv;
    const pointy = Math.pow(1 - v, 0.85) * (1 + 0.42 * Math.sin(Math.PI * v));
    const roundP = Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.38) / 0.62, 2))) / 0.79;
    let hw = W * ((1 - r) * pointy + r * roundP);
    if (i === nv) hw = 0;
    for (let j = 0; j < ring; j++) {
      let u, front;
      if (j <= nu) { u = -1 + 2 * j / nu; front = true; } else { u = 1 - 2 * (j - nu) / nu; front = false; }
      const g = Math.sin(Math.min(v * 1.4, 1) * Math.PI / 2) * (1 - 0.55 * v);
      const zf = -cup * W * 0.9 * (1 - u * u) * g;
      const zb = zf * 0.35 - W * 0.38 * Math.sqrt(Math.max(0, 1 - u * u)) * Math.pow(1 - v, 0.5) - 0.002 * (1 - v);
      p.set(u * hw, v * H, front ? zf : zb);
      // 先の垂れ（前下へ折れる）
      if (fold > 0 && v > foldStart) {
        const ang = fold * 2.3 * smooth(foldStart, 1.0, v) * (v - foldStart) / (1 - foldStart) * 1.6;
        const py = foldStart * H;
        const y = p.y - py, z = p.z;
        p.y = py + y * Math.cos(ang) - z * Math.sin(ang);
        p.z = y * Math.sin(ang) + z * Math.cos(ang);
      }
      // 色
      c.copy(cMain);
      if (front) {
        const inner = smooth(0.92, 0.62, Math.abs(u)) * smooth(0.95, 0.72, v) * smooth(0.0, 0.08, v);
        c.lerp(cIn, inner);
      }
      if (st.earTipAmt > 0.001) {
        const jagv = 0.04 * Math.abs(((u * 2.5 + 10) % 1) - 0.5);
        c.lerp(cTip, smooth(1 - st.earTipAmt - 0.02, 1 - st.earTipAmt + 0.02, v + jagv));
      }
      B.v(p, c);
    }
  }
  for (let i = 0; i < nv; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j, b = i * ring + (j + 1) % ring, c2 = a + ring, d = b + ring;
      B.tri(a, c2, d); B.tri(a, d, b);
    }
  }
  // 耳の中の毛
  if (st.earFluff > 0.01) {
    const n = 4;
    for (let k = 0; k < n; k++) {
      const u = (k / (n - 1) - 0.5) * 1.0;
      const v0 = 0.08 + 0.04 * Math.abs(u);
      const hw0 = W * 0.9;
      const base = new THREE.Vector3(u * hw0 * 0.8, v0 * H, -cup * W * 0.5);
      const d = new THREE.Vector3(u * 0.55, 1.0, 0.45).normalize();
      addTuft(B, {
        p: base, d, up: new THREE.Vector3(0, 0, 1), len: H * (0.35 + 0.3 * st.earFluff) * (1 - Math.abs(u) * 0.4), w: W * 0.28, t: W * 0.12,
        bend: new THREE.Vector3(u * 0.2, -0.1, 0.25), sharp: 0.8, c0: cols.fluff, c1: cols.fluff, segs: 5, sides: 5, sink: 0,
      });
    }
  }
  const g = B.build();
  return { geometry: g, H, W };
}

// ---------------------------------------------------------------- 鼻
export function buildNose(st, color) {
  const type = st.noseType;
  const g = new THREE.SphereGeometry(1, 40, 28);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.25);
  const W0 = [0.021, 0.013, 0.024, 0.0125, 0.012][type] * st.noseSize * st.noseW;
  const H0 = [0.0135, 0.0095, 0.017, 0.0095, 0.0105][type] * st.noseSize * st.noseH;
  const D0 = [0.016, 0.009, 0.018, 0.008, 0.01][type] * st.noseSize;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const yn = y; // -1..1
    let wx = 1;
    if (type === 0) wx = 0.68 + 0.42 * (yn + 1) / 2 + 0.1 * Math.max(0, yn);       // 犬: 上が広い
    else if (type === 1) wx = 0.45 + 0.75 * (yn + 1) / 2;                         // 猫: 逆三角
    else if (type === 2) wx = 0.85 + 0.2 * (yn + 1) / 2;                          // 熊: 大きな楕円
    else if (type === 3) wx = 0.4 + 0.85 * (yn + 1) / 2;                          // ハート
    x *= wx;
    // ハートの上の切れ込み
    if (type === 3 && y > 0.2) y -= 0.55 * Math.exp(-x * x / 0.05) * (y - 0.2);
    // 下のまん中の溝（犬・熊）
    if ((type === 0 || type === 2) && y < 0) y += 0.18 * Math.exp(-x * x / 0.01) * (-y) * (z > 0 ? 1 : 0);
    // 前面を少し平らに
    if (z > 0) z *= 0.82;
    pos.setXYZ(i, x * W0, y * H0, z * D0);
    // 鼻の穴
    let c = base;
    if (type !== 4) {
      const nx = Math.abs(x) - (type === 1 || type === 3 ? 0.32 : 0.42), ny = y + (type === 1 || type === 3 ? 0.05 : 0.18);
      const ang = 0.6;
      const rx = nx * Math.cos(ang) - ny * Math.sin(ang), ry = nx * Math.sin(ang) + ny * Math.cos(ang);
      const d = Math.sqrt(rx * rx / 0.045 + ry * ry / 0.012);
      if (z > 0.35 && d < 1) c = dark;
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- 尻尾
export const TAIL_TYPES = [
  { len: 0.42, r: 0.05, bush: 1.0, tip: 1, down: 0.9 },    // 狼
  { len: 0.5, r: 0.07, bush: 1.35, tip: 1, down: 0.75 },   // 狐
  { len: 0.62, r: 0.022, bush: 0.0, tip: 0, down: 0.6 },   // 猫
  { len: 0.6, r: 0.02, bush: 0.0, tip: 2, down: 0.75 },    // 獅子（先に房）
  { len: 0.07, r: 0.04, bush: 0.0, tip: 3, down: 0.2 },    // 熊（短い）
  { len: 0.05, r: 0.05, bush: 0.0, tip: 3, down: 0.0 },    // うさぎ（ぽんぽん）
];

export class Tail {
  constructor() {
    this.segs = 40; this.sides = 18;
    this.geometry = null;
  }
  rebuild(st, cols) {
    const T = TAIL_TYPES[st.tailType];
    this.T = T; this.st = st; this.cols = cols;
    if (!T) { this.geometry = null; return null; }
    const segs = this.segs, sides = this.sides;
    const n = segs * sides + 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const idx = [];
    for (let i = 0; i < segs - 1; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides;
      idx.push(a, c, d, a, d, b);
    }
    const s0 = segs * sides, s1 = s0 + 1;
    for (let j = 0; j < sides; j++) {
      idx.push(s0, (j + 1) % sides, j);
      const l = (segs - 1) * sides;
      idx.push(l + j, l + (j + 1) % sides, s1);
    }
    g.setIndex(idx);
    // 色（形が変わっても同じ）
    const col = g.attributes.color.array;
    const c = new THREE.Color();
    for (let i = 0; i < segs; i++) {
      const s = i / (segs - 1);
      for (let j = 0; j < sides; j++) {
        const th = j / sides * Math.PI * 2;
        c.copy(cols.main);
        let tip = st.tailTipAmt;
        if (T.tip === 2) tip = Math.max(tip, 0.16);
        if (tip > 0.001) {
          const jag = 0.03 * Math.abs(((th / Math.PI * 3 + s * 9) % 1) - 0.5);
          c.lerp(T.tip === 2 && st.tailTipAmt < 0.001 ? cols.accent : cols.tip, smooth(1 - tip - 0.02, 1 - tip + 0.02, s + jag));
        }
        c.multiplyScalar(0.88 + 0.12 * smooth(0, 0.2, s));
        col.set([c.r, c.g, c.b], (i * sides + j) * 3);
      }
    }
    col.set([cols.main.r, cols.main.g, cols.main.b], s0 * 3);
    const cl = col.slice(((segs - 1) * sides) * 3, ((segs - 1) * sides) * 3 + 3);
    col.set(cl, s1 * 3);
    this.geometry = g;
    this.update(0, 0);
    return g;
  }
  // 尻尾ローカル（腰の骨基準、根元が原点）で形を作る
  update(t, sway) {
    const g = this.geometry; if (!g) return;
    const T = this.T, st = this.st;
    const segs = this.segs, sides = this.sides;
    const L = T.len * st.tailLen;
    const R = T.r * st.tailThick;
    const fluff = st.tailFluff;
    const pos = g.attributes.position.array;
    // 中心線
    let ang = -0.12 - T.down * 0.55 + st.tailUp * 0.9;     // 後方からの上下角（0 で真後ろ）
    const curl = st.tailCurl * 2.2 * (T.tip === 3 ? 0 : 1);
    const p = new THREE.Vector3(0, 0, 0);
    const pts = [], dirs = [];
    const ds = L / (segs - 1);
    for (let i = 0; i < segs; i++) {
      const s = i / (segs - 1);
      const sw = Math.sin(t * 1.7 - s * 2.2) * sway * 0.45 * s + Math.sin(t * 0.9 + 1.0) * sway * 0.12 + 0.18 * s;
      const a = ang + curl * s * s + (T.tip === 3 ? 0 : 0.35 * s);
      const d = new THREE.Vector3(Math.sin(sw) * Math.cos(a), Math.sin(a), -Math.cos(sw) * Math.cos(a)).normalize();
      pts.push(p.clone()); dirs.push(d);
      p.addScaledVector(d, ds);
    }
    const up = new THREE.Vector3(0, 1, 0);
    let rProf;
    for (let i = 0; i < segs; i++) {
      const s = i / (segs - 1);
      const d = dirs[i];
      const A = _a.copy(up).addScaledVector(d, -up.dot(d));
      if (A.lengthSq() < 1e-6) A.set(0, 0, 1); A.normalize();
      const Bv = _b.crossVectors(d, A).normalize();
      if (T.tip === 3) {
        // 短い・丸い
        rProf = Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, s * 0.98 + 0.02)))) * (1.0 + 0.3 * (st.tailType === 5 ? 1 : 0));
      } else if (T.bush > 0) {
        rProf = (0.45 + 0.75 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.95 + 0.05)), 0.7) * T.bush) * Math.pow(1 - s, 0.35);
        if (s > 0.97) rProf *= 0.3;
      } else {
        rProf = (1 - 0.3 * s) * Math.min(1, (1 - s) * 18 + 0.15);
        if (T.tip === 2) rProf += 1.9 * Math.exp(-Math.pow((s - 0.9) / 0.06, 2));
      }
      const rr = R * Math.max(rProf, 0.02) * (1 + fluff * 0.35 * (T.bush > 0 ? 1 : 0.3));
      for (let j = 0; j < sides; j++) {
        const th = j / sides * Math.PI * 2;
        // ふさふさのギザギザ（先端向きのとげ）
        const f = ((s * 7.0 + 0.35 * Math.sin(th * 3.0 + s * 4.0)) % 1 + 1) % 1;
        const serr = 1 + fluff * (T.bush > 0 || T.tip >= 2 ? 0.26 : 0.05) * (f * f - 0.3) * (T.tip === 2 && s < 0.8 ? 0.1 : 1);
        const lobe = 1 + fluff * 0.06 * Math.sin(th * 5 + s * 3);
        const rad = rr * serr * lobe;
        const k = (i * sides + j) * 3;
        pos[k] = pts[i].x + (Bv.x * Math.cos(th) + A.x * Math.sin(th)) * rad;
        pos[k + 1] = pts[i].y + (Bv.y * Math.cos(th) + A.y * Math.sin(th)) * rad;
        pos[k + 2] = pts[i].z + (Bv.z * Math.cos(th) + A.z * Math.sin(th)) * rad;
      }
    }
    const s0 = segs * sides;
    pos.set([pts[0].x - dirs[0].x * 0.01, pts[0].y - dirs[0].y * 0.01, pts[0].z - dirs[0].z * 0.01], s0 * 3);
    const e = pts[segs - 1].clone().addScaledVector(dirs[segs - 1], R * 0.05);
    pos.set([e.x, e.y, e.z], (s0 + 1) * 3);
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }
}
