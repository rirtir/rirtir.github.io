// SDF → 三角形メッシュ（Surface Nets）。Worker 内で動かす。
// 粗いグリッドで表面の近傍ブロックだけを特定し、そこだけ細かく評価する。

import { caveF, coreF, WORLD } from './sdf.js';

export function generateCave(opts = {}, onProgress = () => {}) {
  const h = opts.cell || 0.32;
  const B = 8; // 粗いブロックの一辺（細かいセル数）
  const { min, max } = WORLD.bounds;
  const nx = Math.ceil((max[0] - min[0]) / h);
  const ny = Math.ceil((max[1] - min[1]) / h);
  const nz = Math.ceil((max[2] - min[2]) / h);
  const bx = Math.ceil(nx / B) + 1, by = Math.ceil(ny / B) + 1, bz = Math.ceil(nz / B) + 1;

  // --- 粗いグリッド ---
  const coarse = new Float32Array(bx * by * bz);
  for (let k = 0; k < bz; k++)
    for (let j = 0; j < by; j++)
      for (let i = 0; i < bx; i++)
        coarse[(k * by + j) * bx + i] = coreF(min[0] + i * B * h, min[1] + j * B * h, min[2] + k * B * h);

  const TH = 6.4;
  const act0 = new Uint8Array(bx * by * bz);
  for (let k = 0; k < bz - 1; k++)
    for (let j = 0; j < by - 1; j++)
      for (let i = 0; i < bx - 1; i++) {
        let m = 1e9;
        for (let c = 0; c < 8; c++) {
          const v = Math.abs(coarse[((k + (c >> 2)) * by + j + ((c >> 1) & 1)) * bx + i + (c & 1)]);
          if (v < m) m = v;
        }
        if (m < TH) act0[(k * by + j) * bx + i] = 1;
      }
  // 隣接ブロックへ膨張
  const act = new Uint8Array(bx * by * bz);
  for (let k = 0; k < bz; k++)
    for (let j = 0; j < by; j++)
      for (let i = 0; i < bx; i++) {
        let a = 0;
        for (let dk = -1; dk <= 1 && !a; dk++)
          for (let dj = -1; dj <= 1 && !a; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj, kk = k + dk;
              if (ii < 0 || jj < 0 || kk < 0 || ii >= bx || jj >= by || kk >= bz) continue;
              if (act0[(kk * by + jj) * bx + ii]) { a = 1; break; }
            }
        act[(k * by + j) * bx + i] = a;
      }

  const sw = nx + 1, sh = ny + 1;
  let s0 = new Float32Array(sw * sh), s1 = new Float32Array(sw * sh);
  const fillSlab = (s, k) => {
    const bk = Math.min(bz - 1, (k / B) | 0);
    const z = min[2] + k * h;
    for (let j = 0; j < sh; j++) {
      const bj = Math.min(by - 1, (j / B) | 0);
      const y = min[1] + j * h;
      for (let i = 0; i < sw; i++) {
        const bi = Math.min(bx - 1, (i / B) | 0);
        const bidx = (bk * by + bj) * bx + bi;
        if (act[bidx]) s[j * sw + i] = caveF(min[0] + i * h, y, z);
        else s[j * sw + i] = coarse[bidx] > 0 ? 50 : -50;
      }
    }
  };

  const pos = [];
  const idx = [];
  let prevLayer = new Int32Array(nx * ny).fill(-1);
  let curLayer = new Int32Array(nx * ny).fill(-1);
  const cornerOff = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], // x方向
    [0, 2], [1, 3], [4, 6], [5, 7], // y方向
    [0, 4], [1, 5], [2, 6], [3, 7], // z方向
  ];
  const v = new Float32Array(8);

  // 向きは位相だけで決める（辺を挟む2点のどちらが空洞側か）。射影後の座標には依存しない。
  const pushQuad = (a, b, c, d, flip) => {
    if (flip) { idx.push(a, d, c, a, c, b); } else { idx.push(a, b, c, a, c, d); }
  };
  const quad = (a, b, c, d, axis, startAir) => {
    // 既定の巻き方向: x辺=+x, y辺=-y, z辺=+z の法線。空洞(負)側を向けたい。
    const flip = axis === 1 ? !startAir : startAir;
    pushQuad(a, b, c, d, flip);
  };

  fillSlab(s0, 0);
  for (let k = 0; k < nz; k++) {
    fillSlab(s1, k + 1);
    curLayer.fill(-1);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const b0 = j * sw + i;
        v[0] = s0[b0]; v[1] = s0[b0 + 1]; v[2] = s0[b0 + sw]; v[3] = s0[b0 + sw + 1];
        v[4] = s1[b0]; v[5] = s1[b0 + 1]; v[6] = s1[b0 + sw]; v[7] = s1[b0 + sw + 1];
        let mask = 0;
        for (let c = 0; c < 8; c++) if (v[c] < 0) mask |= 1 << c;
        if (mask === 0 || mask === 255) continue;
        // 辺の交点を平均
        let px = 0, py = 0, pz = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const a = edges[e][0], b = edges[e][1];
          const va = v[a], vb = v[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          px += cornerOff[a][0] + t * (cornerOff[b][0] - cornerOff[a][0]);
          py += cornerOff[a][1] + t * (cornerOff[b][1] - cornerOff[a][1]);
          pz += cornerOff[a][2] + t * (cornerOff[b][2] - cornerOff[a][2]);
          cnt++;
        }
        const vi = pos.length / 3;
        pos.push(
          min[0] + (i + px / cnt) * h,
          min[1] + (j + py / cnt) * h,
          min[2] + (k + pz / cnt) * h
        );
        curLayer[j * nx + i] = vi;

        // 四角形の生成（この頂点の "下側" の3辺）
        // x辺：(i,j,k)-(i+1,j,k) をまたぐ
        if (j > 0 && k > 0 && (v[0] < 0) !== (v[1] < 0)) {
          const a = curLayer[j * nx + i], b = curLayer[(j - 1) * nx + i];
          const c = prevLayer[(j - 1) * nx + i], d = prevLayer[j * nx + i];
          if (b >= 0 && c >= 0 && d >= 0) quad(a, b, c, d, 0, v[0] < 0);
        }
        // y辺
        if (i > 0 && k > 0 && (v[0] < 0) !== (v[2] < 0)) {
          const a = curLayer[j * nx + i], b = curLayer[j * nx + i - 1];
          const c = prevLayer[j * nx + i - 1], d = prevLayer[j * nx + i];
          if (b >= 0 && c >= 0 && d >= 0) quad(a, b, c, d, 1, v[0] < 0);
        }
        // z辺
        if (i > 0 && j > 0 && (v[0] < 0) !== (v[4] < 0)) {
          const a = curLayer[j * nx + i], b = curLayer[j * nx + i - 1];
          const c = curLayer[(j - 1) * nx + i - 1], d = curLayer[(j - 1) * nx + i];
          if (b >= 0 && c >= 0 && d >= 0) quad(a, b, c, d, 2, v[0] < 0);
        }
      }
    }
    const t = s0; s0 = s1; s1 = t;
    const l = prevLayer; prevLayer = curLayer; curLayer = l;
    if ((k & 15) === 0) onProgress(0.55 * (k / nz));
  }

  // --- 頂点の後処理：表面へ射影、法線、AO ---
  const nv = pos.length / 3;
  const P = new Float32Array(pos);
  const N = new Float32Array(nv * 3);
  const AO = new Uint8Array(nv);
  const GM = new Float32Array(nv);
  const g = [0, 0, 0];
  let _gm = 1;
  const grad = (x, y, z, e, out) => {
    const gx = caveF(x + e, y, z) - caveF(x - e, y, z);
    const gy = caveF(x, y + e, z) - caveF(x, y - e, z);
    const gz = caveF(x, y, z + e) - caveF(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    _gm = l / (2 * e);
    out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
  };
  const aoD = [0.14, 0.35, 0.8, 1.6, 3.2];
  const aoW = [0.32, 0.26, 0.2, 0.13, 0.09];
  for (let n = 0; n < nv; n++) {
    let x = P[n * 3], y = P[n * 3 + 1], z = P[n * 3 + 2];
    // ニュートン射影（勾配の大きさで割って、実際の距離に換算して動かす）
    for (let it = 0; it < 4; it++) {
      const f = caveF(x, y, z);
      if (Math.abs(f) < 0.004) break;
      const e = 0.1;
      const gx = caveF(x + e, y, z) - caveF(x - e, y, z);
      const gy = caveF(x, y + e, z) - caveF(x, y - e, z);
      const gz = caveF(x, y, z + e) - caveF(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) / (2 * e) || 1;
      let st = f / Math.max(gl, 0.25);
      const lim = h * 0.55;
      st = st > lim ? lim : st < -lim ? -lim : st;
      const inv = 1 / (gl * 2 * e);
      x -= gx * inv * st; y -= gy * inv * st; z -= gz * inv * st;
    }
    grad(x, y, z, 0.1, g);
    GM[n] = _gm;
    P[n * 3] = x; P[n * 3 + 1] = y; P[n * 3 + 2] = z;
    // 法線：空洞側を向く（勾配の逆）
    N[n * 3] = -g[0]; N[n * 3 + 1] = -g[1]; N[n * 3 + 2] = -g[2];
    // AO：法線方向に空洞を進み、表面までの距離が短いほど遮蔽が大きい
    let occ = 0;
    for (let q = 0; q < 5; q++) {
      const d = aoD[q];
      const f = caveF(x - g[0] * d, y - g[1] * d, z - g[2] * d);
      // 空洞内ならば -f が最寄り表面までの距離
      const open = Math.max(0, Math.min(d, -f));
      occ += aoW[q] * (1 - open / d);
    }
    AO[n] = Math.max(0, Math.min(255, Math.round((1 - occ) * 255)));
    if ((n & 4095) === 0) onProgress(0.55 + 0.45 * (n / nv));
  }

  // メッシュ自身の面法線（面積加重）から頂点法線を作る。SDFの勾配が小さくて信頼できない場所ではこちらを使う。
  const NM = new Float32Array(nv * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2];
    const e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { NM[v * 3] += fx; NM[v * 3 + 1] += fy; NM[v * 3 + 2] += fz; }
  }
  let fixedN = 0;
  for (let n = 0; n < nv; n++) {
    const l = Math.hypot(NM[n * 3], NM[n * 3 + 1], NM[n * 3 + 2]);
    if (l < 1e-12) continue;
    const mx = NM[n * 3] / l, my = NM[n * 3 + 1] / l, mz = NM[n * 3 + 2] / l;
    // SDF 由来の法線と、メッシュ法線が大きく食い違う（勾配が不安定な）場所はメッシュ法線を採用
    const dot = N[n * 3] * mx + N[n * 3 + 1] * my + N[n * 3 + 2] * mz;
    if (GM[n] < 0.55 || dot < 0.2) {
      N[n * 3] = mx; N[n * 3 + 1] = my; N[n * 3 + 2] = mz; fixedN++;
    }
  }
  return {
    position: P,
    normal: N,
    ao: AO,
    index: nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
    vertexCount: nv,
    fixedN,
  };
}
