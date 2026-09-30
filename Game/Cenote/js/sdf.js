// 洞窟の形状を表す符号付き距離関数（SDF）。負 = 空洞（空気・水）、正 = 岩。
// メッシュ生成（Worker）と、カメラの衝突判定（メインスレッド）で共有する。

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a, b, k) => -smin(-a, -b, k);

// ---------- ノイズ（Perlin） ----------
const P = new Uint8Array(512);
(function initPerm() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 20260930;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();

function grad(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export function noise3(x, y, z) {
  let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  X &= 255; Y &= 255; Z &= 255;
  const u = x * x * x * (x * (x * 6 - 15) + 10);
  const v = y * y * y * (y * (y * 6 - 15) + 10);
  const w = z * z * z * (z * (z * 6 - 15) + 10);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
  const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  const g000 = grad(P[AA], x, y, z), g100 = grad(P[BA], x - 1, y, z);
  const g010 = grad(P[AB], x, y - 1, z), g110 = grad(P[BB], x - 1, y - 1, z);
  const g001 = grad(P[AA + 1], x, y, z - 1), g101 = grad(P[BA + 1], x - 1, y, z - 1);
  const g011 = grad(P[AB + 1], x, y - 1, z - 1), g111 = grad(P[BB + 1], x - 1, y - 1, z - 1);
  const x00 = g000 + u * (g100 - g000), x10 = g010 + u * (g110 - g010);
  const x01 = g001 + u * (g101 - g001), x11 = g011 + u * (g111 - g011);
  const y0 = x00 + v * (x10 - x00), y1 = x01 + v * (x11 - x01);
  return y0 + w * (y1 - y0);
}

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7 + 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- ワールド定数 ----------
export const WORLD = {
  waterY: 0,
  bounds: { min: [-56, -27, -64], max: [34, 19, 28] },
  // 太陽光の進行方向（正規化）。ほぼ真上から差し込む
  sunDir: (() => {
    const v = [-0.215, -0.955, 0.2];
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
  })(),
  // 天窓（メイン）の軸位置
  shaft1: { x: 4.0, z: -1.0, y0: 6.5 },
  // 天窓（第二の部屋）
  shaft2: { x: -38.2, z: -49.0, y0: 4.5 },
  // 初期カメラ
  start: { pos: [-8.5, 1.3, 9.0], look: [1.2, 6.0, 1.5] },
};

// ---------- 形状部品 ----------
function ell(x, y, z, cx, cy, cz, rx, ryT, rz, ryB) {
  const px = x - cx, py = y - cy, pz = z - cz;
  const ry = py > 0 ? ryT : ryB;
  const ax = px / rx, ay = py / ry, az = pz / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = px / (rx * rx), by = py / (ry * ry), bz = pz / (rz * rz);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  if (k1 < 1e-9) return -Math.min(rx, ryT, rz);
  return (k0 * (k0 - 1)) / k1;
}

function sdSeg(x, y, z, ax, ay, az, bx, by, bz) {
  const pax = x - ax, pay = y - ay, paz = z - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 第二の部屋へ続く水路（水面下〜水面上にまたがる通路）
const PASSAGE = [
  [-16.0, 0.6, -8.0, 3.6],
  [-23.0, 0.9, -17.0, 3.0],
  [-27.5, 1.1, -28.0, 3.3],
  [-33.5, 0.8, -38.0, 2.8],
  [-38.0, 1.2, -46.0, 3.6],
];

// 竪穴（天窓）の形
function shaftDist(x, y, z, s, rBase, rNeck, rTop, yNeck0, yNeck1, yFlare0, yFlare1) {
  const wob = 0.08 * Math.sin(y * 0.7) + 0.06 * Math.sin(y * 1.9 + 1.0);
  const cx = s.x + wob * 3.0 + (y - s.y0) * 0.02;
  const cz = s.z + wob * 2.0;
  const r =
    rBase +
    (rNeck - rBase) * smoothstep(yNeck0, yNeck1, y) +
    (rTop - rNeck) * smoothstep(yFlare0, yFlare1, y);
  const d = Math.hypot(x - cx, z - cz) - r;
  return Math.max(d, s.y0 - y);
}

// 島・砂州などの「岩が盛り上がる」部品（岩側への加算）
// 高さ場（頂点から下は岩）。(y - h) を距離の近似として使う
function hf(x, y, z, cx, cz, rx, rz, top, drop, pw) {
  const ax = (x - cx) / rx, az = (z - cz) / rz;
  const rho = Math.sqrt(ax * ax + az * az);
  const h = top - drop * Math.pow(rho, pw);
  return (y - h) * 0.5;
}

function solidFeatures(x, y, z, f) {
  // ビームが当たる浅瀬の島（頂上がわずかに水面から出る）
  const m1 = hf(x, y, z, 1.2, 2.0, 9.5, 8.5, 0.42, 7.5, 2.6);
  // 東側の砂浜
  const m2 = hf(x, y, z, 20.5, -3.5, 14.0, 12.5, 0.45, 12.0, 2.0);
  // 南のなだらかな棚（水没）
  const m3 = hf(x, y, z, -9.0, 13.0, 8.0, 7.0, -1.3, 10.0, 2.0);
  // 第二の部屋の小さな砂州
  const m4 = hf(x, y, z, -40.0, -47.3, 6.0, 5.5, 0.32, 6.0, 2.4);
  let g = smax(f, -m1, 2.2);
  g = smax(g, -m4, 2.0);
  g = smax(g, -m2, 2.5);
  g = smax(g, -m3, 2.0);
  return g;
}

// 大まかな形（ノイズなし）。負 = 空洞
export function coreF(x0, y, z0) {
  // 全体をゆるくねじって左右対称を崩す
  const x = x0 + 2.8 * noise3(x0 * 0.045, y * 0.06, z0 * 0.045 + 3.0);
  const z = z0 + 2.8 * noise3(x0 * 0.045 + 9.0, y * 0.06, z0 * 0.045);
  // 大広間：複数の楕円体の滑らかな和
  let hall = ell(x, y, z, -2.0, 1.5, 0.0, 22.0, 10.0, 17.0, 17.0);
  hall = smin(hall, ell(x, y, z, 15.0, 2.0, -7.0, 11.0, 7.0, 10.0, 12.0), 5.0);
  hall = smin(hall, ell(x, y, z, -8.0, 1.0, 15.0, 9.0, 6.0, 8.0, 8.0), 5.0);
  hall = smin(hall, ell(x, y, z, -19.0, 0.0, 3.0, 8.5, 7.0, 9.0, 22.0), 5.0);

  // 通路
  let pass = 1e9;
  for (let i = 0; i < PASSAGE.length - 1; i++) {
    const a = PASSAGE[i], b = PASSAGE[i + 1];
    const t = 0.5;
    const r = (a[3] + b[3]) * t;
    // 線分ごとに半径を補間するため近似的に距離を測る
    const dseg = sdSeg(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2]);
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    const hh = clamp((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz), 0, 1);
    const rr = a[3] + (b[3] - a[3]) * hh;
    pass = smin(pass, dseg - rr, 2.0);
  }
  // 第二の部屋
  const room2 = ell(x, y, z, -39.0, 1.6, -50.0, 10.5, 7.5, 9.5, 9.0);

  let f = smin(hall, pass, 3.0);
  f = smin(f, room2, 3.5);

  // 天窓
  const s1 = shaftDist(x, y, z, WORLD.shaft1, 4.2, 3.0, 4.6, 8.0, 11.0, 13.0, 17.0);
  const s2 = shaftDist(x, y, z, WORLD.shaft2, 2.6, 1.7, 2.8, 6.5, 9.0, 11.5, 15.5);
  f = smin(f, s1, 1.6);
  f = smin(f, s2, 1.4);

  f = solidFeatures(x, y, z, f);
  return f;
}

// 岩の細部（ノイズ・地層）。近距離でのみ評価
function detail(x, y, z, d) {
  // 大きなうねり〜細かな凹凸
  let n = 1.7 * noise3(x * 0.06, y * 0.08, z * 0.06);
  // 尾根状のしわ（鋭い凹凸）
  const rg = 1 - Math.abs(noise3(x * 0.13 + 4.2, y * 0.22, z * 0.13 - 1.3)) * 2;
  n += 0.85 * rg * rg - 0.3;
  n += 0.75 * noise3(x * 0.16 + 11.3, y * 0.2, z * 0.16 - 5.1);
  n += 0.42 * noise3(x * 0.34 - 3.7, y * 0.42, z * 0.34 + 8.2);
  n += 0.18 * noise3(x * 0.85 + 7.7, y * 0.95, z * 0.85 - 2.2);
  // 水平な地層（層ごとに浸食されやすさが違う。控えめに）
  const t = (y + 1.7 * noise3(x * 0.05, y * 0.04, z * 0.05)) / 1.9;
  const li = Math.floor(t);
  const fr = t - li;
  const amp = 0.02 + 0.1 * hash1(li);
  const prof = fr < 0.72 ? fr / 0.72 : (1 - fr) / 0.28;
  n += amp * (prof - 0.5);
  // 水際の削れ（ノッチ）
  const nb = (y + 0.15) / 0.55;
  n -= 0.95 * Math.exp(-nb * nb);
  return n;
}

export function caveF(x, y, z) {
  const d = coreF(x, y, z);
  const ad = d < 0 ? -d : d;
  if (ad > 3.8) return d;
  // 遠いほど細部を消し、SDFを連続に保つ（穴・膜の原因になる不連続を避ける）
  const w = 1 - smoothstep(2.6, 3.8, ad);
  return d + detail(x, y, z, d) * w;
}

// 勾配（外向き＝岩側へ向かう方向）
export function caveGrad(x, y, z, e, out) {
  const gx = caveF(x + e, y, z) - caveF(x - e, y, z);
  const gy = caveF(x, y + e, z) - caveF(x, y - e, z);
  const gz = caveF(x, y, z + e) - caveF(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
  return out;
}

// ---------- 鍾乳石の配置（決定的） ----------
export function placeStalactites() {
  const list = [];
  const CELL = 2.6;
  const [minx, , minz] = WORLD.bounds.min;
  const [maxx, , maxz] = WORLD.bounds.max;
  const s1 = WORLD.shaft1;
  for (let cx = Math.floor(minx / CELL); cx < Math.ceil(maxx / CELL); cx++) {
    for (let cz = Math.floor(minz / CELL); cz < Math.ceil(maxz / CELL); cz++) {
      const r0 = hash2(cx, cz);
      if (r0 < 0.62) continue;
      const x = (cx + 0.15 + 0.7 * hash2(cx + 3.1, cz - 1.7)) * CELL;
      const z = (cz + 0.15 + 0.7 * hash2(cx - 8.3, cz + 2.9)) * CELL;
      // 天窓の真下には置かない（光を遮らない）
      if (Math.hypot(x - (s1.x - 2.0), z - (s1.z + 1.6)) < 6.5) continue;
      // 天井を探す：上から下へ、岩→空洞の境界
      let prev = caveF(x, 18, z);
      let ceil = null;
      for (let y = 17.75; y > 1.5; y -= 0.25) {
        const v = caveF(x, y, z);
        if (prev > 0 && v <= 0) { ceil = y + 0.25 * (prev / (prev - v)); break; }
        prev = v;
      }
      if (ceil === null || ceil < 3.5 || ceil > 13.5) continue;
      // 真下が水面より上（=空気中）かつ、その位置で天井が水平に近いこと
      const g = caveGrad(x, ceil - 0.3, z, 0.3, [0, 0, 0]);
      if (g[1] < 0.78) continue; // 天井が斜めすぎる場所は避ける（gは岩側=上向き）
      const len = 0.9 + 3.2 * Math.pow(hash2(cx * 1.7, cz * 2.3), 1.6);
      const rad = 0.22 + 0.36 * hash2(cx - 2.2, cz + 5.5) + len * 0.07;
      // 先端まわりに十分な空間があること（壁にめり込む鍾乳石を避ける）
      const rClear = rad + 0.9;
      let clear = caveF(x, ceil - len, z) < -rClear && caveF(x, ceil - len * 0.5, z) < -rClear;
      for (let k = 0; k < 4 && clear; k++) {
        const ax = Math.cos(k * 1.5708) * rClear, az = Math.sin(k * 1.5708) * rClear;
        if (caveF(x + ax, ceil - len * 0.6, z + az) > -0.2) clear = false;
      }
      if (!clear) continue;
      list.push({ x, z, yTop: ceil + 2.2, yTip: ceil - len, r: rad, seed: hash2(cx, cz + 11) });
    }
  }
  return list;
}
