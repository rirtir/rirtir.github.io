// 苔灯の境 / MOSSLIGHT — 地面の合成(DOM非依存の純関数 + canvas への書き出しだけ)
// 目的: 材質ごとの素材(texture)を、世界座標で連続した有機的なマスクで重ねて合成する。
//   - 下の材質は加工しない。上の材質のマスクが立つ画素だけ、その材質の color / normal / height を同じ画素から読む(3枚とも同じマスク)。
//   - マスクは「タイル中心の指示値を世界座標で双線形補間した値 c_m(p)」+「世界座標のノイズ」で決める。c_m はタイルとチャンクを跨いで連続し、
//     タイル境界の格子・階段・のこぎり歯・白い縁線を作らない。境界は丸みを持ち、4材質の鞍点でも穴ができない(最下層の材質は常に残る)。
//   - 画素は「世界座標 + 地形(matAt)+ seed」だけで決まるので、チャンクの分割・カメラ位置・時刻に依存しない(別々に焼いても1回で焼いても同じ)。
//   - 縁の処理は方向を持たない: 上の層の縁の内側1〜2pxに葉先の彩度、外側の下の層を8〜12%暗く(遮蔽)、縁に高さの段差と法線の傾き。
//     縁に周囲より明るい画素は置かない。
//   - 細かな散らし(scatter)は拾える物とは別の、6×6px以下・低コントラストの幾何学的な画素の塊。16pxの世界セルごとに決定的に置く。
//     密度は種類ごとの低周波マスクで塊にし(塊の外はほぼ空)、踏み固めた土(同じ材質に囲まれた土・道)の中心は静かにする。
//   - 草と土の境は、草の葉先を主マスクの外へ数px出し、縁の内側に土をわずかに覗かせ、遮蔽は斑に置く(縁取りの線にしない)。scatter 有効時のみ。
// 水(deepwater/water)は透明(alpha 0)で残す。アニメーションする水は renderer が下に描く。
// 注意: 素材は spec.tex が返す。既定は renderer が tiles の `${材質}${変種}` から作る。将来の 64×64 継ぎ目なし素材(mat_*)は同じ形で差し替える。

export const TILE = 32;
export const CHUNK_TILES = 8;
export const CHUNK_PX = TILE * CHUNK_TILES;
export const CELL = 16; // 散らしの世界セル

// 重なり順(低→高)。旧 renderer の order と同じ
export const MATERIALS = ['deepwater', 'water', 'cave', 'sand', 'dirt', 'path', 'ruin', 'grass', 'darkgrass', 'moss', 'farmland'];
export const MAT = Object.freeze(Object.fromEntries(MATERIALS.map((m, i) => [m, i])));
export const isWaterMat = (m) => m <= 1;
export function materialIndex(tileName) { return MAT[tileName] != null ? MAT[tileName] : MAT.dirt; }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ 決定的なノイズ */
export function hashf(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hashf(xi, yi, s), b = hashf(xi + 1, yi, s), c = hashf(xi, yi + 1, s), d = hashf(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// マスクの揺らぎ(-0.45..0.45)。2回読む: 長い波と、座標を入れ替えてずらした短い波。細い葉先の揺れを足す。世界座標だけで決まる
export const MASK_AMP = 1.15, BLADE_AMP = 0.22, NOISE_CLAMP = 0.45;
export function maskTerm(wx, wy) {
  const n = 0.6 * vnoise(wx / 20, wy / 20, 701) + 0.4 * vnoise(wy / 9 + 23, wx / 9 + 41, 702);
  const blade = vnoise(wx / 3.1, wy / 2.1, 703);
  return clamp(MASK_AMP * (n - 0.5) + BLADE_AMP * (blade - 0.5), -NOISE_CLAMP, NOISE_CLAMP);
}
// 水際の揺らぎは小さく(歩ける陸へ水が6px以上入り込まない)
export const SHORE_SCALE = 0.375;

/* ------------------------------------------------------------------ 縁の定数 */
const RIM = 0.09;          // 縁の幅(マスク値。1pxあたり約1/32 + ノイズ勾配なので、おおよそ2〜3px)
const AO_BAND = 0.09;      // 下の層を暗くする外側の幅
const AO_MAX = 0.11;       // 暗くする最大の割合(8〜12%)
const RIM_STEP_PX = 1.5;   // 上の層の台の高さ(px)。height の R は px/64×255
const GRASSY = new Set([MAT.grass, MAT.darkgrass, MAT.moss]);
// 縁の装飾(scatter が有効な時だけ): 草の葉先が主マスクの外へ出る幅・縁の内側に土が覗く幅・遮蔽を置く斑のしきい値。どれも世界座標のノイズだけで決まる
const TIP_BAND = 0.07;
const SOIL_BAND = 0.12;
const TIP_LIFT_PX = 0.8;   // 葉先の高さ(px)

const DEBUG_PALETTE = [[20, 40, 110], [40, 80, 150], [60, 66, 80], [214, 190, 120], [140, 100, 60], [180, 150, 90], [110, 110, 130], [80, 150, 70], [40, 100, 50], [70, 170, 150], [100, 70, 50]];

/* ------------------------------------------------------------------ 領域の焼き込み */
// spec: {
//   matAt(tx,ty) -> 材質番号(範囲外は端の値を返す),
//   tex: [材質番号] -> null | {w,h,variantAt(tx,ty)->k,variants:[{c,n,h}]}  c/n/h は w*h*4 の Uint8ClampedArray(RGBA)。null は平坦色(spec.flat[m])
//   flat?: [材質番号] -> [r,g,b],  seed?, scatter?(既定 true), debug?(0=通常 1=材質の色 2=縁を白で表示)
// }
// 戻り値: {x0,y0,w,h,color,normal,height (Uint8ClampedArray RGBA), mat (Uint8Array 勝った材質), rim (Uint8Array 縁0..255), stats}
export function bakeRegion(spec, x0, y0, w, h) {
  const seed = spec.seed == null ? 0x4d4f5353 : spec.seed | 0;
  const debug = spec.debug | 0;
  const gx0 = Math.floor(x0 / TILE) - 2, gy0 = Math.floor(y0 / TILE) - 2;
  const gx1 = Math.floor((x0 + w - 1) / TILE) + 2, gy1 = Math.floor((y0 + h - 1) / TILE) + 2;
  const gw = gx1 - gx0 + 1, gh = gy1 - gy0 + 1;
  const grid = new Uint8Array(gw * gh);
  for (let ty = gy0; ty <= gy1; ty++) for (let tx = gx0; tx <= gx1; tx++) grid[(ty - gy0) * gw + tx - gx0] = spec.matAt(tx, ty);
  const tileMat = (tx, ty) => grid[(ty - gy0) * gw + tx - gx0];

  const color = new Uint8ClampedArray(w * h * 4), normal = new Uint8ClampedArray(w * h * 4), height = new Uint8ClampedArray(w * h * 4);
  const matOut = new Uint8Array(w * h), rimOut = new Uint8Array(w * h);
  const stats = { pixels: w * h, land: 0, rim: 0, mixed: 0, scatter: 0, cells: 0 };

  // resolve の結果(関数呼び出しの戻り値を作らず、共有変数へ書く)
  let rWin = 0, rBase = 0, rMargin = 1, rNear = -1, rNearM = -1, rMixed = false;
  const cosmetic = spec.scatter !== false && debug === 0; // 葉先・覗く土・斑のAO。平坦色の検証(scatter:false)では素の境界だけ
  const cm = [0, 0, 0, 0], cw = [0, 0, 0, 0];

  // 世界座標 (wx,wy) の画素で、どの材質が見えるか。勝者・下地・勝者の縁までの余裕(マスク値-0.5)・負けた上位層の近さ
  function resolve(wx, wy) {
    const u = (wx + 0.5) / TILE - 0.5, v = (wy + 0.5) / TILE - 0.5;
    const ix = Math.floor(u), iy = Math.floor(v);
    const a = tileMat(ix, iy), b = tileMat(ix + 1, iy), c = tileMat(ix, iy + 1), d = tileMat(ix + 1, iy + 1);
    rNear = -1; rNearM = -1; rMargin = 1;
    if (a === b && b === c && c === d) { rWin = a; rBase = a; rMixed = false; return; }
    rMixed = true;
    const fu = smooth01(u - ix), fv = smooth01(v - iy);
    const base = Math.min(a, b, c, d);
    rBase = base; rWin = base;
    const wa = (1 - fu) * (1 - fv), wb = fu * (1 - fv), wc = (1 - fu) * fv, wd = fu * fv;
    // 下地より上の材質の一覧(重複なし)
    let n = 0;
    const add = (m) => { if (m === base) return; for (let k = 0; k < n; k++) if (cm[k] === m) return; cm[n++] = m; };
    add(a); add(b); add(c); add(d);
    for (let i = 1; i < n; i++) { const m = cm[i]; let j = i - 1; while (j >= 0 && cm[j] > m) { cm[j + 1] = cm[j]; j--; } cm[j + 1] = m; }
    const T = maskTerm(wx, wy) * (isWaterMat(base) ? SHORE_SCALE : 1);
    for (let k = 0; k < n; k++) {
      const m = cm[k];
      const cv = (a === m ? wa : 0) + (b === m ? wb : 0) + (c === m ? wc : 0) + (d === m ? wd : 0);
      const val = cv + T - 0.5;
      if (val > 0) { rWin = m; rMargin = val; } // 昇順に見るので、通った中で最も上の層が勝つ
    }
    // 勝者より上の層が負けた近さだけを AO に使う(勝者より下の層は無関係)
    rNear = -1; rNearM = -1;
    for (let k = 0; k < n; k++) {
      const m = cm[k];
      if (m <= rWin) continue;
      const cv = (a === m ? wa : 0) + (b === m ? wb : 0) + (c === m ? wc : 0) + (d === m ? wd : 0);
      const val = cv + T - 0.5;
      if (val > rNear) { rNear = val; rNearM = m; }
    }
    if (rWin === base) rMargin = 1;
  }

  // 勝者のマスク値 - 0.5(勾配用)。resolve と同じ式
  function fieldVal(m, wx, wy, base) {
    const u = (wx + 0.5) / TILE - 0.5, v = (wy + 0.5) / TILE - 0.5;
    const ix = Math.floor(u), iy = Math.floor(v);
    const fu = smooth01(u - ix), fv = smooth01(v - iy);
    const a = tileMat(ix, iy), b = tileMat(ix + 1, iy), c = tileMat(ix, iy + 1), d = tileMat(ix + 1, iy + 1);
    const cv = (a === m ? (1 - fu) * (1 - fv) : 0) + (b === m ? fu * (1 - fv) : 0) + (c === m ? (1 - fu) * fv : 0) + (d === m ? fu * fv : 0);
    return cv + maskTerm(wx, wy) * (isWaterMat(base) ? SHORE_SCALE : 1) - 0.5;
  }

  const texOf = (m) => (spec.tex && spec.tex[m]) || null;
  const flatOf = (m) => (spec.flat && spec.flat[m]) || DEBUG_PALETTE[m] || [90, 90, 90];

  for (let j = 0; j < h; j++) {
    const wy = y0 + j;
    for (let i = 0; i < w; i++) {
      const wx = x0 + i;
      resolve(wx, wy);
      if (rMixed) stats.mixed++;
      const o = (j * w + i) * 4, pi = j * w + i;
      matOut[pi] = rWin;
      if (isWaterMat(rWin)) continue; // 透明のまま(下の水が見える)
      stats.land++;
      // 縁の装飾: 画素の材質(素材の読み元)だけを差し替える。color/normal/height は同じ画素から読むので3枚とも同じ形になる
      let m = rWin, tip = false, soil = false;
      if (cosmetic && rMixed) {
        if (rNearM >= 0 && !GRASSY.has(rWin) && GRASSY.has(rNearM) && rNear > -TIP_BAND && rNear <= 0) {
          // 草の葉先: 主マスクの外へ1〜3px、まばらに出る(縁に近いほど出やすい)
          const nt = 0.8 * vnoise(wx / 2.1, wy / 1.5, 711) + 0.2 * hashf(wx, wy, 714);
          if (nt > 0.52 + 0.4 * (-rNear / TIP_BAND)) { m = rNearM; tip = true; }
        } else if (rWin !== rBase && GRASSY.has(rWin) && rMargin < SOIL_BAND && (rBase === MAT.dirt || rBase === MAT.path || rBase === MAT.sand)) {
          // 縁の内側に土がわずかに覗く(連続した帯にはならない)
          const ns = 0.8 * vnoise(wx / 2.6, wy / 2.6, 712) + 0.2 * hashf(wx, wy, 715);
          if (ns > 0.5 + 0.5 * (rMargin / SOIL_BAND)) { m = rBase; soil = true; }
        }
      }
      let r, g, b, nx, ny, ne, hr, hg, hb;
      const tx = texOf(m);
      if (tx) {
        const vr = tx.variants[tx.variantAt(Math.floor(wx / TILE), Math.floor(wy / TILE))] || tx.variants[0];
        const su = ((wx % tx.w) + tx.w) % tx.w, sv = ((wy % tx.h) + tx.h) % tx.h;
        const k = (sv * tx.w + su) * 4;
        r = vr.c[k]; g = vr.c[k + 1]; b = vr.c[k + 2];
        nx = vr.n[k]; ny = vr.n[k + 1]; ne = vr.n[k + 2];
        hr = vr.h[k]; hg = vr.h[k + 1]; hb = vr.h[k + 2];
      } else {
        const f = flatOf(m);
        r = f[0]; g = f[1]; b = f[2]; nx = 128; ny = 128; ne = 0; hr = 0; hg = 200; hb = 128;
      }
      let rim = 0;
      if (tip) {
        hr = Math.min(255, hr + TIP_LIFT_PX * (255 / 64));
      } else if (soil) {
        r *= 0.95; g *= 0.95; b *= 0.95; // 草の際の土: 接地の暗さ(縁取りではなく、土の画素自体の色)
      } else if (rMixed) {
        if (rWin !== rBase && rMargin < RIM) {
          // 上の層の縁: 方向を持たない処理。台の高さ + 外向きの法線の傾き + 葉先の彩度(明度は上げない)
          rim = 1 - rMargin / RIM;
          const gx = fieldVal(m, wx + 1, wy, rBase) - fieldVal(m, wx - 1, wy, rBase);
          const gy = fieldVal(m, wx, wy + 1, rBase) - fieldVal(m, wx, wy - 1, rBase);
          const gl = Math.hypot(gx, gy);
          if (gl > 1e-6) {
            const s = 0.16 * rim * (0.35 + 0.65 * smooth01((vnoise(wx / 7, wy / 7, 716) - 0.35) / 0.35));
            const ox = -gx / gl, oy = -gy / gl; // 層の内側から外側へ(画面座標 y下)
            const nnx = (nx - 128) / 127 + ox * s, nny = (ny - 128) / 127 - oy * s;
            const nl = Math.hypot(nnx, nny), kk = nl > 0.95 ? 0.95 / nl : 1;
            nx = 128 + nnx * kk * 127; ny = 128 + nny * kk * 127;
          }
          hr = Math.min(255, hr + RIM_STEP_PX * (255 / 64) * smooth01(1 - rim));
          stats.rim++;
        } else if (rNear > -AO_BAND && rNear <= 0) {
          // 下の層が上の層の縁のすぐ外側にある: 遮蔽として暗くする(どの向きでも同じ)
          // 遮蔽は斑に(縁全体を暗い線で囲まない)。装飾が無効なら従来どおり一様
          const patchy = cosmetic ? smooth01((vnoise(wx / 8, wy / 8, 713) - 0.42) / 0.3) : 1;
          const k = 1 - AO_MAX * patchy * smooth01(1 + rNear / AO_BAND);
          r *= k; g *= k; b *= k;
          rim = 0.35;
        }
      }
      if (debug === 1) { const p = DEBUG_PALETTE[m]; r = p[0]; g = p[1]; b = p[2]; }
      else if (debug === 2) { const p = DEBUG_PALETTE[m]; const e = rim > 0 ? 255 : 0; r = e ? 255 : p[0] * 0.5; g = e ? 255 : p[1] * 0.5; b = e ? 255 : p[2] * 0.5; }
      color[o] = r; color[o + 1] = g; color[o + 2] = b; color[o + 3] = 255;
      normal[o] = nx; normal[o + 1] = ny; normal[o + 2] = ne; normal[o + 3] = 255;
      height[o] = hr; height[o + 1] = hg; height[o + 2] = hb; height[o + 3] = 255;
      rimOut[pi] = Math.round(rim * 255);
    }
  }

  if (spec.scatter !== false && debug === 0) scatterPass();

  return { x0, y0, w, h, color, normal, height, mat: matOut, rim: rimOut, stats };

  /* ---------- 散らし ---------- */
  function scatterPass() {
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor((x0 + w - 1) / CELL);
    const cy0 = Math.floor(y0 / CELL), cy1 = Math.floor((y0 + h - 1) / CELL);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        stats.cells++;
        const el = pickElement(cx, cy, seed);
        if (!el) continue;
        // 1つの要素は自分のセル内(アンカー 2..9 + 大きさ 6以下)に収まるので、隣のセルと重ならない
        const ax = cx * CELL + el.ox, ay = cy * CELL + el.oy;
        stats.scatter += stamp(el, ax, ay);
      }
    }
  }

  // セルごとの要素。材質は「アンカーで見える材質」。縁の近くと水・畑には置かない
  function pickElement(cx, cy, sd) {
    const ox = 2 + Math.floor(hashf(cx, cy, sd + 2) * 8), oy = 3 + Math.floor(hashf(cx, cy, sd + 3) * 7);
    const ax = cx * CELL + ox, ay = cy * CELL + oy;
    // 材質の判定(セルの外のアンカーはグリッド外になり得ないが、領域の端のセルは margin 2 タイルの内側)
    resolve(ax, ay);
    const m = rWin;
    if (rMixed && ((rWin !== rBase && rMargin < 0.16) || rNear > -0.16)) return null; // 縁の近く(上の層の縁・下の層が上の層に接する所)には置かない
    // 範囲の反対側の角も同じ材質か
    const win0 = rWin, mixed0 = rMixed;
    if (mixed0) { resolve(ax + 5, ay + 3); if (rWin !== win0) return null; }
    const table = SCATTER[m];
    if (!table) return null;
    // 密度 = 種類ごとの世界座標の低周波マスク(塊の外はほぼ空) × 材質の近傍(踏み固めた土の中心は静か、草は土との境で房が増える)。座標の特別扱いはしない
    const tx = Math.floor(ax / TILE), ty = Math.floor(ay / TILE);
    let same = 0; // 3×3タイルのうち同じ材質の数(領域の外へ2タイルの余白があるので範囲内)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileMat(tx + dx, ty + dy) === m) same++;
    const calm = m === MAT.dirt || m === MAT.path ? 1 - 0.88 * smooth01((same - 4) / 5) : 1;
    const edgeUp = GRASSY.has(m) ? 1 + 0.5 * (1 - same / 9) : 1;
    const q = [];
    let total = 0;
    for (const [kind, p] of table) {
      const v = p * patchMult(kind, ax, ay, sd) * calm * (kind === 'tuft' ? edgeUp : 1);
      q.push(v); total += v;
    }
    const norm = total > 0.8 ? 0.8 / total : 1; // 塊の中でも隣のセルがすべて埋まることはない
    const r = hashf(cx, cy, sd + 4);
    let acc = 0, i = 0;
    for (const [kind] of table) {
      acc += q[i++] * norm;
      if (r < acc) return { kind, m, ox, oy, rnd: hashf(cx, cy, sd + 5), rnd2: hashf(cx, cy, sd + 6), rnd3: hashf(cx, cy, sd + 7) };
    }
    return null;
  }

  // 要素を領域の画素へ重ねる。戻り値: 1(置いた)/0
  function stamp(el, ax, ay) {
    const px = SHAPES[el.kind](el);
    if (!px.length) return 0;
    let placed = 0;
    for (const p of px) {
      const wx = ax + p.dx, wy = ay + p.dy;
      if (wx < x0 || wy < y0 || wx >= x0 + w || wy >= y0 + h) continue;
      const pi = (wy - y0) * w + (wx - x0), o = pi * 4;
      if (color[o + 3] === 0) continue;
      placed = 1;
      let r = color[o], g = color[o + 1], b = color[o + 2];
      if (p.mix) { const t = p.t; r = r + (p.mix[0] - r) * t; g = g + (p.mix[1] - g) * t; b = b + (p.mix[2] - b) * t; }
      if (p.f) { r *= p.f; g *= p.f; b *= p.f; }
      if (p.hue) { r *= p.hue[0]; g *= p.hue[1]; b *= p.hue[2]; }
      color[o] = r; color[o + 1] = g; color[o + 2] = b;
      if (p.h) height[o] = Math.min(255, height[o] + p.h * (255 / 64));
      if (p.nx != null) {
        const nnx = (normal[o] - 128) / 127 + p.nx, nny = (normal[o + 1] - 128) / 127 + p.ny;
        const nl = Math.hypot(nnx, nny), kk = nl > 0.9 ? 0.9 / nl : 1;
        normal[o] = 128 + nnx * kk * 127; normal[o + 1] = 128 + nny * kk * 127;
      }
    }
    return placed;
  }
}

/* ------------------------------------------------------------------ 散らしの種類と形 */
// 種類ごとの塊のマスク(世界座標・低周波)。塊の外は 0.05倍、中心は 2.2倍程度。種類ごとに別の位置・大きさ
const PATCH_SCALE = { tuft: 34, leaf: 40, pebble: 26, moss: 44, twig: 38, grit: 30 };
const PATCH_SEED = { tuft: 21, leaf: 22, pebble: 23, moss: 24, twig: 25, grit: 26 };
function patchMult(kind, ax, ay, sd) {
  const s = PATCH_SEED[kind];
  const n = 0.65 * vnoise(ax / PATCH_SCALE[kind], ay / PATCH_SCALE[kind], sd + s) + 0.35 * vnoise(ax / 11 + 5, ay / 11 + 9, sd + s + 50);
  return 0.05 + 2.2 * smooth01((n - 0.5) / 0.16);
}
// [種類, セルあたりの基本確率]。実際の確率は上の塊のマスクと材質の近傍で掛け直す
const SCATTER = {
  [MAT.grass]: [['tuft', 0.34], ['leaf', 0.07], ['pebble', 0.04], ['moss', 0.05]],
  [MAT.darkgrass]: [['tuft', 0.30], ['leaf', 0.14], ['moss', 0.12], ['pebble', 0.04]],
  [MAT.moss]: [['moss', 0.28], ['tuft', 0.20], ['pebble', 0.04]],
  [MAT.dirt]: [['pebble', 0.18], ['twig', 0.10], ['leaf', 0.07]],
  [MAT.sand]: [['pebble', 0.08]],
  [MAT.path]: [['grit', 0.07]],
  [MAT.cave]: [['pebble', 0.12]],
  [MAT.ruin]: [['pebble', 0.05]],
};
export const SCATTER_KINDS = ['tuft', 'leaf', 'pebble', 'moss', 'twig', 'grit'];
export const SCATTER_MAX_SIZE = 6;   // 1要素の幅・高さの上限(px)
export const SCATTER_MAX_HEIGHT = 1.8; // 高さの上限(px)
const LEAF_COLORS = [[150, 108, 56], [128, 92, 48], [168, 124, 62]];

// 各形は {dx,dy,...画素の変更} の配列。色は下の画素からの相対で、輪郭・固定のハイライトは持たない
const SHAPES = {
  tuft(el) {
    // 草の房: 3〜4本の細い葉先。上の画素ほどわずかに黄緑、根元はわずかに暗い。法線は左右対称に丸める(光は焼き込まない)
    const set = el.rnd < 0.5 ? [[-1, 0], [-1, -1], [0, 0], [0, -1], [0, -2], [1, 0], [1, -1]] : [[0, 0], [0, -1], [1, 0], [1, -1], [1, -2], [2, 0]];
    return set.map(([dx, dy]) => ({
      dx, dy, f: dy === 0 ? 0.88 : 1.0, hue: dy < 0 ? [1.03, 1.07, 0.94] : null, h: 0.8 + 0.25 * -dy,
      nx: dx < 0 ? -0.3 : dx > 0 ? 0.3 : 0, ny: 0,
    }));
  },
  leaf(el) {
    const set = el.rnd < 0.5 ? [[0, 0], [1, 0], [1, 1], [2, 1]] : [[0, 0], [1, 0], [2, 0], [1, 1]];
    const col = LEAF_COLORS[Math.floor(el.rnd2 * LEAF_COLORS.length) % LEAF_COLORS.length];
    return set.map(([dx, dy]) => ({ dx, dy, mix: col, t: 0.5, h: 0.5, nx: (el.rnd3 - 0.5) * 0.4, ny: 0 }));
  },
  pebble(el) {
    // 小石: 解析的なドーム(2×2か3×2)。法線はドームから。色は下の色を灰色へ寄せて、明るさは固定しない
    const wide = el.rnd < 0.5;
    const rx = wide ? 1.6 : 1.1, ry = wide ? 1.1 : 1.1, cxx = wide ? 1 : 0.5, cyy = 0.5;
    const out = [], fac = 0.92 + 0.12 * el.rnd2;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < (wide ? 3 : 2); dx++) {
      const ux = (dx - cxx) / rx, uy = (dy - cyy) / ry, rr = ux * ux + uy * uy;
      if (rr > 1.15) continue;
      const hh = Math.min(SCATTER_MAX_HEIGHT, 1.8 * Math.sqrt(Math.max(0, 1.15 - rr)));
      out.push({ dx, dy, mix: [118, 116, 110], t: 0.42, f: fac, h: hh, nx: ux * 0.6, ny: -uy * 0.6 });
    }
    return out;
  },
  moss(el) {
    // 苔の塊: 3x3 内の不規則な5〜6画素
    const out = [];
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const k = hashf(Math.floor(el.rnd * 1e6) + dx, dy, 17);
      if ((dx === 1 && dy === 1) || k < 0.55) out.push({ dx, dy, mix: [66, 118, 78], t: 0.34, h: 0.5, nx: (dx - 1) * 0.12, ny: -(dy - 1) * 0.12 });
    }
    return out;
  },
  twig(el) {
    const slope = el.rnd < 0.5 ? 1 : -1, out = [];
    for (let k = 0; k < 4; k++) out.push({ dx: k, dy: slope > 0 ? Math.floor(k / 2) : 1 - Math.floor(k / 2), mix: [86, 62, 38], t: 0.5, h: 0.6, nx: 0, ny: slope * 0.15 });
    return out;
  },
  grit(el) {
    // 道の砂利: 1〜2画素。ほとんど色を変えない
    const out = [{ dx: 0, dy: 0, mix: [118, 112, 100], t: 0.3, f: 0.96, h: 0.5, nx: 0, ny: 0 }];
    if (el.rnd < 0.5) out.push({ dx: 1, dy: 0, mix: [118, 112, 100], t: 0.3, f: 0.94, h: 0.4, nx: 0, ny: 0 });
    return out;
  },
};

/* ------------------------------------------------------------------ チャンク */
export function bakeChunk(spec, cx, cy) { return bakeRegion(spec, cx * CHUNK_PX, cy * CHUNK_PX, CHUNK_PX, CHUNK_PX); }

// 結果を canvas 3枚へ(makeCanvas(w,h) は renderer の newCanvas)。water は alpha 0
export function toCanvases(res, makeCanvas) {
  const out = {};
  for (const [key, data] of [['color', res.color], ['normal', res.normal], ['height', res.height]]) {
    const cv = makeCanvas(res.w, res.h);
    cv.getContext('2d').putImageData(new ImageData(data, res.w, res.h), 0, 0);
    out[key] = cv;
  }
  return out;
}

// 最大 max 個の LRU。古い物から捨てる。get/has は使用扱い
export function createChunkCache(max = 24, onEvict = null) {
  const m = new Map();
  return {
    get(k) { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; },
    set(k, v) {
      if (m.has(k)) m.delete(k);
      m.set(k, v);
      while (m.size > max) { const first = m.keys().next().value; const old = m.get(first); m.delete(first); if (onEvict) onEvict(first, old); }
      return v;
    },
    delete(k) { const old = m.get(k); if (old !== undefined && onEvict) onEvict(k, old); return m.delete(k); },
    clear() { if (onEvict) for (const [k, v] of m) onEvict(k, v); m.clear(); },
    keys() { return [...m.keys()]; },
    get size() { return m.size; },
    max,
  };
}
export const CHUNK_BYTES = CHUNK_PX * CHUNK_PX * 4 * 3; // color+normal+height

/* ------------------------------------------------------------------ 検証用 */
// 2つの領域の同じ世界座標の画素が byte 一致か。a,b は bakeRegion の結果
export function regionsEqualAt(a, b, wx, wy) {
  const ia = ((wy - a.y0) * a.w + (wx - a.x0)) * 4, ib = ((wy - b.y0) * b.w + (wx - b.x0)) * 4;
  for (let k = 0; k < 4; k++) if (a.color[ia + k] !== b.color[ib + k] || a.normal[ia + k] !== b.normal[ib + k] || a.height[ia + k] !== b.height[ib + k]) return false;
  return true;
}
export function lumaOf(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
