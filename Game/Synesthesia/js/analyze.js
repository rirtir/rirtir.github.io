// SYNESTHESIA — 音声解析
// 任意の音声（モノラルPCM）から、スペクトル・オンセット・テンポ/拍・盛り上がりを求める。
// ジェネレータ形式にして、呼び出し側が時間を区切って実行できるようにしてある（UIを固まらせない）。
import { FFT } from './fft.js';
import { clamp } from './util.js';

export const NB = 48;                 // 表示用の対数バンド数
export const GROUPS = 4;              // オンセット検出のバンド群（キック/低中域/中域/高域）
const GROUP_EDGES = [150, 600, 3000]; // Hz
const F_LO = 30;
// STFTの窓の中心が実際の時間より遅れて見える分を補正する（実測で調整）
export const ONSET_COMP = 0.0;

export function* analyzeGen(mono, sr, opts = {}) {
  const dur = mono.length / sr;
  const win = sr >= 40000 ? 1024 : 512;
  const hop = Math.max(1, Math.round(sr / 100));
  const fps = sr / hop;
  const nFrames = Math.max(8, Math.floor((mono.length - win) / hop) + 1);
  const fft = new FFT(win);
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win);
  const re = new Float32Array(win), im = new Float32Array(win);
  const nBin = win / 2;
  const mag2 = new Float32Array(nBin + 1);
  const binHz = sr / win;

  // バンド→ビン対応
  const fHi = Math.min(16000, sr * 0.46);
  const bandLo = new Float32Array(NB), bandHi = new Float32Array(NB), bandC = new Float32Array(NB);
  const bandGroup = new Uint8Array(NB);
  for (let b = 0; b < NB; b++) {
    const f0 = F_LO * Math.pow(fHi / F_LO, b / NB), f1 = F_LO * Math.pow(fHi / F_LO, (b + 1) / NB);
    bandLo[b] = f0 / binHz; bandHi[b] = f1 / binHz; bandC[b] = Math.sqrt(f0 * f1);
    bandGroup[b] = bandC[b] < GROUP_EDGES[0] ? 0 : bandC[b] < GROUP_EDGES[1] ? 1 : bandC[b] < GROUP_EDGES[2] ? 2 : 3;
  }
  const normK = 1 / Math.pow(win / 4, 2); // 満振幅サイン波 ≒ 1

  // 入力レベルの正規化（小音量の曲でも感度を保つ。最大 +40dB）
  let G = 1;
  { let e = 0, n = 0; for (let i = 0; i < mono.length; i += 5) { e += mono[i] * mono[i]; n++; }
    const rms = Math.sqrt(e / Math.max(1, n)); if (rms > 1e-5) G = Math.min(100, 0.1 / rms); }
  const L = new Float32Array(nFrames * NB);   // 0..1 (-75dB..-10dB)
  const rms = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    const o = i * hop;
    let e = 0;
    for (let k = 0; k < win; k++) { const v = (mono[o + k] || 0) * G; re[k] = v * hann[k]; im[k] = 0; e += v * v; }
    rms[i] = Math.sqrt(e / win);
    fft.transform(re, im);
    for (let k = 0; k <= nBin; k++) mag2[k] = (re[k] * re[k] + im[k] * im[k]) * normK;
    for (let b = 0; b < NB; b++) {
      const lo = bandLo[b], hi = bandHi[b];
      let p;
      if (hi - lo < 1) {
        const c = (lo + hi) / 2, k0 = Math.floor(c), fr = c - k0;
        p = mag2[Math.min(nBin, k0)] * (1 - fr) + mag2[Math.min(nBin, k0 + 1)] * fr;
      } else {
        let s = 0, w = 0;
        const k0 = Math.floor(lo), k1 = Math.min(nBin, Math.ceil(hi));
        for (let k = k0; k <= k1; k++) {
          const a = Math.max(lo, k), bb = Math.min(hi, k + 1);
          const ww = bb - a; if (ww <= 0) continue;
          s += mag2[k] * ww; w += ww;
        }
        p = w > 0 ? s / w : 0;
      }
      const db = 10 * Math.log10(p + 1e-10);
      L[i * NB + b] = clamp((db + 75) / 65);
    }
    if ((i & 127) === 0) yield i / nFrames * 0.7;
  }

  // ---- バンド群ごとのフラックス（SuperFlux風：前フレーム近傍の最大と比較） ----
  const flux = [];
  for (let g = 0; g < GROUPS; g++) flux.push(new Float32Array(nFrames));
  const gCount = new Float32Array(GROUPS);
  for (let b = 0; b < NB; b++) gCount[bandGroup[b]]++;
  const fluxBand = new Float32Array(NB); // 一時
  for (let i = 1; i < nFrames; i++) {
    for (let b = 0; b < NB; b++) {
      const pb = (i - 1) * NB;
      let m = L[pb + b];
      if (b > 0 && L[pb + b - 1] > m) m = L[pb + b - 1];
      if (b < NB - 1 && L[pb + b + 1] > m) m = L[pb + b + 1];
      const d = L[i * NB + b] - m;
      if (d > 0) flux[bandGroup[b]][i] += d / gCount[bandGroup[b]];
    }
  }
  yield 0.72;

  // ---- ピーク抽出 ----
  const cands = [];
  const peaksByGroup = [];
  for (let g = 0; g < GROUPS; g++) {
    const f = flux[g];
    // 局所平均
    const W = 35;
    const loc = new Float32Array(nFrames);
    let acc = 0;
    for (let i = 0; i < Math.min(nFrames, W); i++) acc += f[i];
    for (let i = 0; i < nFrames; i++) {
      const add = i + W < nFrames ? f[i + W] : 0, sub = i - W - 1 >= 0 ? f[i - W - 1] : 0;
      acc += add - sub;
      const n = Math.min(nFrames - 1, i + W) - Math.max(0, i - W) + 1;
      loc[i] = acc / n;
    }
    const pk = [];
    let last = -100;
    for (let i = 2; i < nFrames - 2; i++) {
      const v = f[i];
      if (v < 0.004) continue;
      if (v < f[i - 1] || v < f[i + 1] || v < f[i - 2] || v < f[i + 2]) continue;
      if (v <= loc[i] * 1.5 + 0.006) continue;
      if (i - last < 6) {
        // 近すぎる場合、強い方を残す
        const lp = pk[pk.length - 1];
        if (v > lp.v) { pk.pop(); } else continue;
      }
      last = i;
      // 放物線補間
      const a = f[i - 1], b = f[i], c = f[i + 1];
      const den = a - 2 * b + c;
      const fr = den < 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0;
      pk.push({ i, fr, v: v - loc[i] * 1.2 });
    }
    // 強度正規化（上位の値で割る）
    const vs = pk.map(p => p.v).sort((x, y) => x - y);
    const ref = vs.length ? vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.9))] : 1;
    peaksByGroup.push({ pk, ref: ref || 1 });
    yield 0.72 + 0.04 * (g + 1);
  }

  // ---- 全体のオンセット包絡（テンポ推定用） ----
  const env = new Float32Array(nFrames);
  const GW = [1.1, 1.0, 1.0, 0.55];
  for (let i = 0; i < nFrames; i++) { let s = 0; for (let g = 0; g < GROUPS; g++) s += flux[g][i] * GW[g]; env[i] = s; }
  // 平滑 + 局所平均除去
  const envS = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let s = 0, n = 0;
    for (let k = -1; k <= 1; k++) { const j = i + k; if (j >= 0 && j < nFrames) { s += env[j] * (k === 0 ? 2 : 1); n += (k === 0 ? 2 : 1); } }
    envS[i] = s / n;
  }
  const envZ = new Float32Array(nFrames);
  {
    const W = 50; let acc = 0;
    for (let i = 0; i < Math.min(nFrames, W); i++) acc += envS[i];
    for (let i = 0; i < nFrames; i++) {
      const add = i + W < nFrames ? envS[i + W] : 0, sub = i - W - 1 >= 0 ? envS[i - W - 1] : 0;
      acc += add - sub;
      const n = Math.min(nFrames - 1, i + W) - Math.max(0, i - W) + 1;
      envZ[i] = Math.max(0, envS[i] - acc / n);
    }
  }
  yield 0.78;

  // ---- テンポ推定（自己相関＋オクターブ補正） ----
  const lagMin = Math.round(fps * 0.28), lagMax = Math.round(fps * 1.05);
  const nAcf = lagMax * 4 + 2;
  const acf = new Float32Array(nAcf);
  const useN = Math.min(nFrames, Math.floor(fps * 240)); // 解析は最大4分で十分
  const start0 = Math.max(0, Math.floor((nFrames - useN) / 2));
  for (let l = 1; l < nAcf; l++) {
    let s = 0;
    const end = start0 + useN - l;
    for (let i = start0; i < end; i++) s += envZ[i] * envZ[i + l];
    acf[l] = s / Math.max(1, end - start0);
    if ((l & 63) === 0) yield 0.78 + 0.05 * l / nAcf;
  }
  let bestLag = lagMin, bestScore = -1;
  const scoreAt = (l) => {
    const bpm = 60 * fps / l;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.8, 2));
    return (acf[l] + 0.5 * (acf[l * 2] || 0) + 0.25 * (acf[l * 4] || 0) + 0.35 * (acf[Math.round(l * 1.5)] || 0)) * (0.35 + prior);
  };
  for (let l = lagMin; l <= lagMax; l++) { const s = scoreAt(l); if (s > bestScore) { bestScore = s; bestLag = l; } }
  // 放物線補間
  let period = bestLag;
  {
    const a = scoreAt(bestLag - 1), b = scoreAt(bestLag), c = scoreAt(bestLag + 1);
    const den = a - 2 * b + c;
    if (den < 0) period = bestLag + clamp(0.5 * (a - c) / den, -0.5, 0.5);
  }
  // ---- 拍検出用のオンセット包絡 envP ----
  // (1) 帯域群ごとに p95 で正規化した dB フラックス（4群を等重み）
  // (2) 低域(<150Hz)の「線形振幅」フラックス: dB 圧縮だと裏拍のハイハット/アルペジオに埋もれるキックを強調
  // (3) 低域の「音量の山」(キックの胴鳴り): 立ち上がりではなくレベルを見るので、裏拍のベース/オープンハットに引っ張られない
  const envP = new Float32Array(nFrames);
  const addNorm = (src, w, afterRemove = false) => {
    // 局所平均(±0.5秒)を引く → p95 で正規化 → envP に加算
    const W = 50; let acc = 0;
    for (let i = 0; i < Math.min(nFrames, W); i++) acc += src[i];
    const tmp = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      const add = i + W < nFrames ? src[i + W] : 0, sub = i - W - 1 >= 0 ? src[i - W - 1] : 0;
      acc += add - sub;
      const n = Math.min(nFrames - 1, i + W) - Math.max(0, i - W) + 1;
      tmp[i] = Math.max(0, src[i] - acc / n);
    }
    const srt = Float32Array.from(afterRemove ? tmp : src).sort();
    const sc = Math.max(1e-9, srt[Math.min(nFrames - 1, Math.floor(nFrames * 0.95))], 0.15 * srt[Math.min(nFrames - 1, Math.floor(nFrames * 0.995))]);
    for (let i = 0; i < nFrames; i++) envP[i] += w * tmp[i] / sc;
  };
  for (let g = 0; g < GROUPS; g++) addNorm(flux[g], 1);
  {
    const amp = (i, b) => Math.pow(10, (L[i * NB + b] * 65 - 75) / 20);
    const lin = new Float32Array(nFrames), lv = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      let s = 0, d = 0;
      for (let b = 0; b < NB; b++) {
        const g = bandGroup[b]; if (g > 1) continue;
        const a = amp(i, b); if (g === 0) s += a;
        if (i > 0) { const df = a - amp(i - 1, b); if (df > 0) d += df * (g === 0 ? 1 : 0.5); }
      }
      lin[i] = d; lv[i] = s;
    }
    addNorm(lin, 4);
    // 音量の山は立ち上がりの約30ms後に頂点が来るので 3 フレーム前へずらす
    const sh = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) sh[i] = lv[Math.min(nFrames - 1, i + 3)];
    addNorm(sh, 8, true);
  }
  { const t = Float32Array.from(envP); for (let i = 1; i < nFrames - 1; i++) envP[i] = (t[i - 1] + 2 * t[i] + t[i + 1]) / 4; }
  const interp = (arr, x) => {
    const i = Math.floor(x), f = x - i;
    if (i < 0 || i + 1 >= arr.length) return 0;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  };
  const combScore = (P, ph) => {
    let s = 0, n = 0;
    for (let x = ph; x < nFrames - 2; x += P) { s += interp(envP, x); n++; }
    return n ? s / n : 0;
  };
  // 周期の微調整(±1.5%)と大域位相
  let bestP = period, bestPh = 0, bestC = -1;
  for (let k = -6; k <= 6; k++) {
    const P = period * (1 + k * 0.0025);
    for (let ph = 0; ph < P; ph += 0.5) {
      const c = combScore(P, ph);
      if (c > bestC) { bestC = c; bestP = P; bestPh = ph; }
    }
    yield 0.83 + 0.03 * (k + 6) / 12;
  }
  period = bestP;
  const silent = !(bestScore > 1e-9);
  if (silent) period = fps * 0.5; // 120BPM
  // テンポの確からしさ: 包絡の正規化自己相関（無音・ノイズで ~0、ドラム入りで 0.3 以上）
  let pulse = 0;
  { const l0 = Math.round(period); let a0 = 0; for (let i = start0; i < start0 + useN; i++) a0 += envZ[i] * envZ[i];
    a0 /= Math.max(1, useN); pulse = a0 > 1e-12 ? clamp(Math.max(acf[l0], acf[l0 - 1] || 0, acf[l0 + 1] || 0) / a0, 0, 1) : 0; }

  // ---- 拍の追従: 動的計画法（Ellis 2007 風）----
  // 各拍の間隔 d がテンポ period からずれるほど log² で罰則。PLL と違い暴走・ドリフトせず、±30%程度のテンポ変化にも追従できる
  const LAM = 120;   // envP の尺度が正規化されるので、p95 の下限とセットで調整
  const dMin = Math.max(2, Math.round(period * 0.7)), dMax = Math.round(period * 1.45);
  const pen = new Float32Array(dMax + 2);
  for (let d = dMin; d <= dMax; d++) { const r = Math.log(d / period); pen[d] = LAM * r * r; }
  const cs = new Float32Array(nFrames), bl = new Int32Array(nFrames).fill(-1);
  for (let t = 0; t < nFrames; t++) {
    let best = 0, arg = -1;
    for (let d = dMin; d <= dMax; d++) {
      const p = t - d; if (p < 0) break;
      const s = cs[p] - pen[d];
      if (s > best) { best = s; arg = p; }
    }
    cs[t] = envP[t] + best; bl[t] = arg;
    if ((t & 2047) === 0) yield 0.86 + 0.02 * t / nFrames;
  }
  let tEnd = 0;
  for (let t = Math.max(0, nFrames - dMax - 1); t < nFrames; t++) if (cs[t] > cs[tEnd]) tEnd = t;
  const chain = [];
  for (let t = tEnd; t >= 0; t = bl[t]) { chain.push(t); if (bl[t] < 0) break; }
  chain.reverse();
  const beats = [];
  for (const x of chain) {
    const a = envP[Math.max(0, x - 1)], b = envP[x], c = envP[Math.min(nFrames - 1, x + 1)];
    const den = a - 2 * b + c;
    beats.push(x + (den < 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0));
  }
  if (!beats.length) beats.push(bestPh);
  // 先頭・末尾を period で延長
  { let t = beats[0] - period; const pre = []; while (t > 0) { pre.unshift(t); t -= period; } beats.unshift(...pre);
    t = beats[beats.length - 1] + period; while (t < nFrames) { beats.push(t); t += period; } }
  var beatConf = silent ? 0 : pulse;
  const frameToSec = (x) => (x * hop + win / 2) / sr - ONSET_COMP;
  const beatSec = Float32Array.from(beats.map(frameToSec));
  const bpm = 60 * fps / period;   // 拍間隔の平均ではなく、微調整した周期から（PLL 暴走の影響を受けない）
  yield 0.88;

  // 小節の頭（拍位置を4つのうちどれにするか）
  let downPhase = 0;
  {
    const sums = [0, 0, 0, 0];
    for (let k = 0; k < beats.length; k++) {
      const x = Math.round(beats[k]);
      if (x < 0 || x >= nFrames) continue;
      sums[k & 3] += flux[0][x] * 1.5 + flux[0][Math.min(nFrames - 1, x + 1)] + flux[1][x] * 0.4 + rms[x] * 0.2;
    }
    let bm = -1; for (let k = 0; k < 4; k++) if (sums[k] > bm) { bm = sums[k]; downPhase = k; }
  }

  // ---- 持続エネルギー（ホールド検出・可視化用） ----
  const E = [];
  for (let g = 0; g < GROUPS; g++) E.push(new Float32Array(nFrames));
  for (let i = 0; i < nFrames; i++) {
    for (let b = 0; b < NB; b++) {
      const db = L[i * NB + b] * 65 - 75;
      E[bandGroup[b]][i] += Math.pow(10, db / 20);
    }
  }
  for (let g = 0; g < GROUPS; g++) { // 5フレーム平滑
    const src = E[g], dst = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      let s = 0, n = 0;
      for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < nFrames) { s += src[j]; n++; } }
      dst[i] = s / n;
    }
    E[g] = dst;
  }
  yield 0.9;

  // ---- 拍との位置関係ボーナスの準備 ----
  const beatFrames = beats.slice();
  const nearBeat = (x) => {
    // x: フレーム。最寄りの拍・半拍・1/4拍との距離(フレーム)を返す
    let lo = 0, hi = beatFrames.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (beatFrames[m] < x) lo = m + 1; else hi = m; }
    const i1 = lo, i0 = Math.max(0, lo - 1);
    const b0 = beatFrames[i0], b1 = beatFrames[Math.min(beatFrames.length - 1, i1)];
    const P = Math.max(1, b1 - b0 || period);
    const ph = clamp((x - b0) / P, 0, 1);
    const dBeat = Math.min(ph, 1 - ph) * P;
    const dHalf = Math.abs(ph - 0.5) * P;
    const dQ = Math.min(Math.abs(ph - 0.25), Math.abs(ph - 0.75)) * P;
    return { dBeat, dHalf, dQ, P };
  };

  // ---- 候補ノーツ生成 ----
  const gRange = [];
  for (let g = 0; g < GROUPS; g++) {
    let a = NB, b = 0;
    for (let k = 0; k < NB; k++) if (bandGroup[k] === g) { a = Math.min(a, k); b = Math.max(b, k); }
    gRange.push([a, b]);
  }
  for (let g = 0; g < GROUPS; g++) {
    const { pk, ref } = peaksByGroup[g];
    for (const p of pk) {
      const i = p.i;
      // フラックス重心 → 位置
      let sw = 0, sp = 0;
      for (let b = 0; b < NB; b++) {
        if (bandGroup[b] !== g) continue;
        const pb = (i - 1) * NB;
        let m = L[pb + b];
        if (b > 0 && L[pb + b - 1] > m) m = L[pb + b - 1];
        if (b < NB - 1 && L[pb + b + 1] > m) m = L[pb + b + 1];
        const d = Math.max(0, L[i * NB + b] - m);
        sw += d; sp += d * b;
      }
      const cen = sw > 1e-6 ? sp / sw : (gRange[g][0] + gRange[g][1]) / 2;
      const pos = cen / (NB - 1);
      let imp = clamp(p.v / ref, 0, 1.4);
      imp = Math.pow(clamp(imp / 1.1, 0, 1), 0.8);
      const nb = nearBeat(i + p.fr);
      const tol = nb.P * 0.09;
      if (nb.dBeat < tol) imp *= 1.18; else if (nb.dHalf < tol) imp *= 1.08; else if (nb.dQ < tol) imp *= 1.0; else imp *= 0.86;
      // キックは土台
      if (g === 0) imp *= 1.1;
      imp = clamp(imp, 0, 1);
      // ホールド判定
      let hold = 0;
      if (g <= 2) {
        const Eg = E[g];
        let peak = 0;
        for (let k = 0; k <= 5; k++) peak = Math.max(peak, Eg[Math.min(nFrames - 1, i + k)]);
        if (peak > 0) {
          let j = i + 6;
          const maxJ = Math.min(nFrames - 1, i + Math.round(fps * 4));
          let nextOn = nFrames;
          // 次の同群オンセット
          for (const q of pk) if (q.i > i + 8) { nextOn = q.i; break; }
          const thr = peak * 0.62;
          while (j < maxJ && j < nextOn - 3 && Eg[j] > thr) j++;
          const d = (j - i) / fps;
          if (d >= 0.45 && Eg[Math.min(nFrames - 1, i + 30)] > peak * 0.7) hold = d;
        }
      }
      cands.push({ t: frameToSec(i + p.fr), pos, imp, g, dur: hold });
    }
  }
  cands.sort((a, b) => a.t - b.t);
  // サイドチェインで低域の立ち上がりが遅れるキックを、直前に現れた他帯域のオンセットへ寄せる
  for (const c of cands) if (c.g === 0) {
    let best = null;
    for (const q of cands) if (q.g !== 0 && q.t > c.t - 0.045 && q.t < c.t - 0.008 && (!best || Math.abs(q.t - (c.t - 0.02)) < Math.abs(best.t - (c.t - 0.02)))) best = q;
    if (best) c.t = best.t;
  }
  cands.sort((a, b) => a.t - b.t);
  yield 0.94;

  // ---- 可視化用の平滑エンベロープ・盛り上がり・ドロップ ----
  const lowE = new Float32Array(nFrames), midE = new Float32Array(nFrames), highE = new Float32Array(nFrames), allE = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let lo = 0, mi = 0, hi = 0, nl = 0, nm = 0, nh = 0, al = 0;
    for (let b = 0; b < NB; b++) {
      const v = L[i * NB + b];
      al += v;
      if (bandC[b] < 200) { lo += v; nl++; } else if (bandC[b] < 2500) { mi += v; nm++; } else { hi += v; nh++; }
    }
    lowE[i] = lo / Math.max(1, nl); midE[i] = mi / Math.max(1, nm); highE[i] = hi / Math.max(1, nh); allE[i] = al / NB;
  }
  const pct = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
  const norm01 = (arr) => { const lo = pct(arr, 0.05), hi = pct(arr, 0.98); const k = 1 / Math.max(1e-4, hi - lo); for (let i = 0; i < arr.length; i++) arr[i] = clamp((arr[i] - lo) * k); };
  norm01(lowE); yield 0.955; norm01(midE); yield 0.957; norm01(highE); yield 0.959; norm01(allE);
  // 1秒平均の強度カーブ
  const inten = new Float32Array(nFrames);
  {
    const W = Math.round(fps * 0.8);
    let acc = 0;
    for (let i = 0; i < Math.min(nFrames, W); i++) acc += allE[i];
    for (let i = 0; i < nFrames; i++) {
      const add = i + W < nFrames ? allE[i + W] : 0, sub = i - W - 1 >= 0 ? allE[i - W - 1] : 0;
      acc += add - sub;
      const n = Math.min(nFrames - 1, i + W) - Math.max(0, i - W) + 1;
      inten[i] = acc / n;
    }
  }
  // ドロップ（直前より直後が大きく盛り上がる地点）
  const drops = [];
  {
    const W = Math.round(fps * 1.0);
    const ip = pct(inten, 0.75);
    let lastDrop = -1e9;
    for (let i = W; i < nFrames - W; i++) {
      let a = 0, b = 0;
      for (let k = 1; k <= W; k += 4) { a += lowE[i - k] * 0.5 + allE[i - k] * 0.5; b += lowE[i + k] * 0.5 + allE[i + k] * 0.5; }
      if (b > a * 1.5 + 0.5 && inten[Math.min(nFrames - 1, i + W)] > ip && (i - lastDrop) > fps * 7) {
        // 近傍で最も立ち上がりが急な位置に合わせる
        drops.push(frameToSec(i)); lastDrop = i;
      }
    }
  }
  yield 0.97;

  // ---- 表示用スペクトル（Uint8）と曲の色味 ----
  const spec = new Uint8Array(nFrames * NB);
  {
    // 帯域ごとの上位値で正規化し、低域が大きすぎる傾きを補正
    const bandRef = new Float32Array(NB);
    const tmp = new Float32Array(nFrames);
    for (let b = 0; b < NB; b++) {
      for (let i = 0; i < nFrames; i++) tmp[i] = L[i * NB + b];
      bandRef[b] = pct(tmp, 0.97);
      if ((b & 3) === 3) yield 0.97 + 0.02 * b / NB;
    }
    for (let i = 0; i < nFrames; i++) for (let b = 0; b < NB; b++) {
      const v = (L[i * NB + b] - 0.15) / Math.max(0.25, bandRef[b] - 0.15);
      spec[i * NB + b] = Math.round(clamp(v) * 255);
    }
  }
  let cenSum = 0, cenW = 0, hiShare = 0, loShare = 0;
  for (let i = 0; i < nFrames; i += 3) {
    let sa = 0, sp = 0;
    for (let b = 0; b < NB; b++) { const a = Math.pow(10, (L[i * NB + b] * 65 - 75) / 20); sa += a; sp += a * b / (NB - 1); }
    if (sa > 1e-6) { const w = Math.min(1, sa * 2); cenSum += (sp / sa) * w; cenW += w; }
  }
  const centroid = cenW ? cenSum / cenW : 0.4;
  for (let i = 0; i < nFrames; i += 3) { hiShare += highE[i]; loShare += lowE[i]; }
  const nSub = Math.ceil(nFrames / 3);
  yield 1;

  return {
    sr, dur, fps, hop, win, nFrames,
    centerOff: win / (2 * hop),   // フレームindex = t*fps - centerOff
    spec, low: lowE, mid: midE, high: highE, all: allE, inten,
    bpm, beatConf, beats: beatSec, downPhase,
    cands, drops,
    color: { centroid, hi: hiShare / nSub, lo: loShare / nSub, bpm },
  };
}

// 同期的に最後まで実行（テスト用）
export function analyzeSync(mono, sr) {
  const g = analyzeGen(mono, sr);
  let r;
  while (!(r = g.next()).done);
  return r.value;
}

// 時間を区切って実行する（メインスレッド向け）
export function analyzeAsync(mono, sr, onProgress) {
  return new Promise((resolve, reject) => {
    const g = analyzeGen(mono, sr);
    const step = () => {
      try {
        const t0 = performance.now();
        let r;
        do { r = g.next(); if (!r.done && onProgress) onProgress(r.value); } while (!r.done && performance.now() - t0 < 10);
        if (r.done) resolve(r.value); else setTimeout(step, 0);
      } catch (e) { reject(e); }
    };
    setTimeout(step, 0);
  });
}

// 解析結果から、時刻 t（秒）のスペクトル（NB個, 0..1）を補間して out に書く
export function sampleSpec(an, t, out) {
  const x = t * an.fps - an.centerOff;
  let i0 = Math.floor(x); const f = x - i0;
  const n = an.nFrames;
  const a = Math.min(n - 1, Math.max(0, i0)), b = Math.min(n - 1, Math.max(0, i0 + 1));
  const sp = an.spec;
  for (let k = 0; k < NB; k++) out[k] = (sp[a * NB + k] * (1 - f) + sp[b * NB + k] * f) / 255;
  return out;
}
export function sampleArr(an, arr, t) {
  const x = t * an.fps - an.centerOff;
  const i0 = Math.floor(x), f = x - i0, n = an.nFrames;
  const a = Math.min(n - 1, Math.max(0, i0)), b = Math.min(n - 1, Math.max(0, i0 + 1));
  return arr[a] * (1 - f) + arr[b] * f;
}
