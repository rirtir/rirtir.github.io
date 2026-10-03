// SYNESTHESIA — 組み込み曲の楽譜（すべてオリジナル。波形はブラウザ内で生成）
// compose(c) は Composer c に音を並べ、同時に譜面候補 c.mark(t, pos, imp, dur) を出力する。
//   pos : 低い音 0 → 高い音 1（レーンの並びに使う）
//   imp : 重要度（高いほど易しい難易度にも残る）
//   dur : 長い音ならホールド候補の長さ(秒)
const pp = (m, lo, hi) => (m - lo) / (hi - lo);

// ======================================================================
// 1. NEON DAWN — 126 BPM シンセウェイヴ / A minor
// ======================================================================
const neonDawn = {
  id: 'neon-dawn', title: 'NEON DAWN', sub: 'ネオンの夜明け', genre: 'SYNTHWAVE',
  bpm: 126, bars: 56, seed: 11, verb: 0.6, delay: 0.5,
  pal: { lanes: ['#ff3d9a', '#ff9d3d', '#3de8ff', '#8a6bff'], a: '#1b0a46', b: '#ff2d95', c: '#ffb347', hue: 0.88 },
  mix: { kick: 1.0, bass: 0.7, pad: 0.34, arp: 0.34, lead: 0.42, clap: 1.0, snare: 1.0, hat: 0.4 },
  compose(c) {
    const P = { Am: [57, 60, 64], F: [57, 60, 65], C: [55, 60, 64], G: [55, 59, 62], Em: [55, 59, 64] };
    const R = { Am: 33, F: 29, C: 36, G: 31, Em: 28 };
    const main = ['Am', 'F', 'C', 'G'], brk = ['F', 'G', 'Am', 'Em'];
    const sec = (b) => b < 4 ? 'intro' : b < 12 ? 'verse' : b < 16 ? 'build' : b < 32 ? 'chorus' : b < 36 ? 'break' : b < 40 ? 'build2' : b < 52 ? 'chorus2' : 'outro';
    const HOOK = [
      [[0, 76, 3], [3, 76, 1], [4, 81, 4], [10, 79, 2], [12, 76, 4]],
      [[0, 77, 3], [3, 77, 1], [4, 81, 4], [10, 84, 2], [12, 81, 4]],
      [[0, 79, 3], [3, 79, 1], [4, 84, 4], [10, 83, 2], [12, 79, 4]],
      [[0, 83, 4], [4, 81, 2], [6, 79, 2], [8, 74, 8]],
    ];
    const ARP = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 4];
    for (let b = 0; b < 56; b++) {
      const s = sec(b);
      const ch = (s === 'break' || s === 'build2') ? brk[b % 4] : main[b % 4];
      const tn = P[ch], root = R[ch];
      const bt = c.t(b, 0), bs = c.barSec;
      const full = s === 'chorus' || s === 'chorus2';
      const drums = s === 'verse' || s === 'build' || full || (s === 'intro' && b >= 2) || (s === 'build2' && b >= 38);

      // --- パッド ---
      const padV = s === 'intro' ? 0.6 + b * 0.1 : s === 'outro' ? 0.9 - (b - 52) * 0.2 : 1;
      c.pad(bt, tn.concat(full ? [tn[0] - 12] : []), bs * 1.03, padV, { a: 0.3 });

      // --- アルペジオ ---
      if (s !== 'break' && !(s === 'outro' && b >= 54)) {
        const at = [tn[0] + 12, tn[1] + 12, tn[2] + 12, tn[0] + 24, tn[1] + 24];
        const av = s === 'intro' ? 0.35 + b * 0.15 : s === 'outro' ? 0.8 - (b - 52) * 0.25 : full ? 0.85 : 0.75;
        for (let k = 0; k < 16; k++) {
          const m = at[ARP[k]], t = c.t(b, k);
          c.pluck(t, m, 0.17, av * (k % 4 === 0 ? 1 : 0.8), { c0: 3800 + (full ? 1500 : 0) });
          if (s !== 'intro' && s !== 'outro') {
            if (k % 4 === 0) c.mark(t, pp(m, 66, 88), 0.3, 0);
            else if (k % 4 === 2) c.mark(t, pp(m, 66, 88), 0.19, 0);
          }
        }
      }

      // --- ドラム ---
      if (drums) {
        const soft = s === 'intro' || (s === 'build2' && b < 38);
        c.pat('x...x...x...x...', (k, v) => {
          if (s === 'build' && b === 15) return;
          if (s === 'build2' && b === 39 && k >= 8) return;
          c.kick(c.t(b, k), 0.95 * (soft ? 0.8 : 1)); c.mark(c.t(b, k), 0.07, 0.95, 0);
        });
        if (s === 'verse' || full || (s === 'build' && b < 14)) {
          c.pat('....x.......x...', (k) => { c.clap(c.t(b, k), 0.9); c.mark(c.t(b, k), 0.42, 0.88, 0); });
        }
        c.pat('..o...o...o...o.', (k, v) => { c.hat(c.t(b, k), 0.8, true); if (s !== 'intro') c.mark(c.t(b, k), 0.9, full ? 0.5 : 0.36, 0); });
        if (s !== 'intro') c.pat('x.x.x.x.x.x.x.x.', (k, v) => c.hat(c.t(b, k), 0.35, false));
        if (full) c.pat('.x.xx.x..x.xx.x.', (k) => c.shaker(c.t(b, k), 0.5));
        if ((s === 'build' && b >= 14) || (s === 'build2' && b >= 38)) {
          // スネアロール
          const n = (b % 2 === 1) ? 16 : 8;
          for (let k = 0; k < n; k++) {
            const t = bt + (k / n) * bs;
            c.snare(t, 0.35 + 0.55 * ((b === 15 || b === 39 ? 1 : 0.5) * k / n));
            if (n === 16 ? (k % 2 === 0) : true) c.mark(t, 0.45, 0.5 + 0.2 * k / n, 0);
          }
        }
        if (full && b % 8 === 0) c.crash(bt, 0.8);
      }
      // 小さなフィル
      if (s === 'chorus2' && (b === 43 || b === 47 || b === 51)) {
        [48, 46, 43, 41].forEach((m, i) => { const t = c.t(b, 12 + i); c.tom(t, m, 0.9); c.mark(t, 0.3 + i * 0.06, 0.55, 0); });
      }

      // --- ベース ---
      if (s === 'verse' || s === 'build' || full || (s === 'build2' && b >= 38)) {
        for (let k = 0; k < 16; k += 2) {
          if (s === 'build' && b === 15 && k >= 8) break;
          const m = root + ((k === 6 || k === 14) ? 12 : 0);
          const t = c.t(b, k);
          c.sub(t, m, c.step * 1.7, 0.95, { cut: full ? 700 : 520 });
          if (full || s === 'verse') c.mark(t, pp(m, 28, 52) * 0.4 + 0.1, k % 8 === 0 ? 0.62 : 0.36, 0);
        }
      } else if (s === 'break' || s === 'intro' || s === 'outro') {
        if (s !== 'intro' || b >= 2) c.sub(bt, root, bs * 0.98, s === 'outro' ? 0.6 - (b - 52) * 0.1 : 0.7, { saw: 0.15 });
      }

      // --- スタブ ---
      if (full) {
        for (const k of [0, 6, 10]) c.stab(c.t(b, k), tn.map(m => m + 12), c.step * 2.2, 0.9, { c1: 1100 });
      }

      // --- リード ---
      if (full) {
        const ph = HOOK[b % 4];
        const octUp = (s === 'chorus2' && b >= 44 && b % 8 >= 4) ? 12 : 0;
        const dbl = s === 'chorus2' || b >= 24;
        for (const [k, m0, len] of ph) {
          const m = m0 + octUp, t = c.t(b, k), d = len * c.step * 0.94;
          c.lead(t, m, d, 0.85);
          if (dbl) c.lead(t, m - 12, d, 0.4, { ch: 'lead', vib: false });
          const strong = k % 4 === 0;
          c.mark(t, pp(m0, 72, 86), len >= 8 ? 0.85 : strong ? 0.78 : k === 3 ? 0.42 : 0.58, len >= 7 ? len * c.step * 0.94 : 0);
        }
      } else if (s === 'break') {
        const seq = [[0, 2, 16], [0, 4, 16]];
        const m = [76, 77, 81, 79][b % 4] + (b % 4 === 2 ? 0 : 0);
        c.lead(bt, m, bs * 0.95, 0.7, { cut: 2600 });
        c.mark(bt, pp(m, 72, 86), 0.9, bs * 0.95);
        // 鍵盤で和音を刻む
        [0, 4, 8, 12].forEach((k, i) => {
          const mm = tn[i % 3] + 12 + (i === 3 ? 12 : 0), t = c.t(b, k);
          c.keys(t, mm, c.step * 3.5, 0.55);
          c.mark(t, pp(mm, 66, 86), 0.32, 0);
        });
        void seq;
      } else if (s === 'verse') {
        // 鈴の旋律
        [[0, tn[2] + 12], [6, tn[1] + 12], [10, tn[2] + 12]].forEach(([k, m], i) => {
          const t = c.t(b, k); c.bell(t, m + (b % 4 === 3 && i === 2 ? 3 : 0), 0.9, 0.7);
          c.mark(t, pp(m, 66, 80), i === 0 ? 0.66 : 0.45, 0);
        });
      }

      // --- ライザー・インパクト ---
      if ((s === 'build' && b === 12) || (s === 'build2' && b === 36)) c.riser(bt, bs * 4, 0.9);
      if (b === 16 || b === 40) c.impact(bt, 0.9);
      if (b === 52) c.impact(bt, 0.5);
    }
  },
};

// ======================================================================
// 2. GLASS GARDEN — 84 BPM ローファイ / C major
// ======================================================================
const glassGarden = {
  id: 'glass-garden', title: 'GLASS GARDEN', sub: 'ガラスの庭', genre: 'LO-FI CHILL',
  bpm: 84, bars: 36, seed: 22, swing: 0.16, swing8: 0.3, verb: 0.75, delay: 0.55, tail: 4,
  pal: { lanes: ['#6bffd0', '#b6ff6b', '#ffe38a', '#ff9ec9'], a: '#0a2b30', b: '#3fd6b5', c: '#ffd9a0', hue: 0.46 },
  mix: { kick: 0.95, snare: 0.8, hat: 0.34, bass: 0.78, keys: 0.5, bell: 0.34, noise: 0.045 },
  compose(c) {
    const V = { C: [52, 55, 59, 62], Am: [52, 55, 57, 60], Dm: [50, 53, 57, 60], G: [50, 53, 55, 59] };
    const Rt = { C: 36, Am: 33, Dm: 38, G: 31 };
    const pr = ['C', 'Am', 'Dm', 'G'];
    const MEL = [
      [[0, 79, 6], [6, 76, 2], [8, 74, 4], [12, 76, 4]],
      [[0, 72, 6], [6, 76, 2], [8, 81, 8]],
      [[0, 77, 6], [6, 74, 2], [8, 72, 4], [12, 74, 4]],
      [[0, 79, 8], [8, 83, 4], [12, 81, 4]],
    ];
    const sec = (b) => b < 4 ? 'intro' : b < 12 ? 'A' : b < 20 ? 'B' : b < 28 ? 'C' : b < 32 ? 'D' : 'outro';
    c.hiss(0, c.dur, 0.5);
    c.crackle(0, c.dur, 22, 0.9);
    for (let b = 0; b < 36; b++) {
      const s = sec(b), ch = pr[b % 4], vo = V[ch], root = Rt[ch];
      const drums = (s === 'A' || s === 'B' || s === 'C') || (s === 'intro' && b >= 3);
      const bt = c.t(b, 0), bs = c.barSec;
      // ---- 鍵盤（コンピング）----
      const kv = s === 'outro' ? 0.7 - (b - 32) * 0.15 : 0.85;
      vo.forEach((m, i) => c.keys(c.t(b, 0) + i * 0.012, m, c.step * 5.5, kv * 0.8, { pan: (i - 1.5) * 0.18, idx: 1.4 }));
      if (s !== 'intro' && s !== 'D' && s !== 'outro') {
        vo.forEach((m, i) => c.keys(c.t(b, 6) + i * 0.01, m, c.step * 2, kv * 0.6, { pan: (i - 1.5) * 0.18, idx: 1.4 }));
        vo.forEach((m, i) => c.keys(c.t(b, 10) + i * 0.01, m + (i === 3 ? 0 : 0), c.step * 3.5, kv * 0.55, { pan: (i - 1.5) * 0.18, idx: 1.4 }));
        c.mark(c.t(b, 6), 0.55, 0.36, 0); c.mark(c.t(b, 10), 0.5, 0.3, 0);
      }
      // ---- パッド（B以降）----
      if (s === 'B' || s === 'C' || s === 'D') c.pad(bt, vo.map(m => m + 12), bs * 1.02, 0.55, { a: 0.8, c1: 1800 });
      // ---- ベース ----
      if (s !== 'intro' || b >= 2) {
        const dR = drums || s === 'D' || s === 'outro';
        if (dR) {
          c.sub(c.t(b, 0), root, c.step * 5.5, 0.85, { saw: 0.2, cut: 420 }); c.mark(c.t(b, 0), 0.15, 0.62, 0);
          c.sub(c.t(b, 8), root + (b % 2 ? 7 : 0), c.step * 4.5, 0.75, { saw: 0.2, cut: 420 }); c.mark(c.t(b, 8), 0.2, 0.45, 0);
          if (s === 'C') { c.sub(c.t(b, 14), root + 12, c.step * 1.6, 0.6, { saw: 0.2, cut: 420 }); c.mark(c.t(b, 14), 0.25, 0.3, 0); }
        }
      }
      // ---- ドラム ----
      if (drums) {
        c.pat('x.....x..x......', (k) => { c.kick(c.t(b, k), 0.85, { f0: 130, f1: 44, tc: 0.13, depth: 0.25, rel: 0.2 }); c.mark(c.t(b, k), 0.07, k === 0 ? 0.95 : 0.52, 0); });
        c.pat('....X.......X...', (k) => { c.snare(c.t(b, k), 0.6, { f: 1500, tc: 0.075 }); c.mark(c.t(b, k), 0.42, 0.9, 0); });
        c.pat('x.x.x.x.x.x.x.x.', (k, v) => { c.hat(c.t(b, k), 0.55 * (k % 4 === 0 ? 1 : 0.7), false, { f: 6500 }); if (s !== 'A') c.mark(c.t(b, k), 0.9, k % 4 === 0 ? 0.4 : 0.27, 0); });
        if (s === 'C') c.pat('..............o.', (k) => c.hat(c.t(b, k), 0.7, true, { f: 6500 }));
      }
      // ---- 旋律 ----
      if (s === 'B' || s === 'C' || s === 'D') {
        const ph = MEL[b % 4];
        for (const [k, m0, len] of ph) {
          const t = c.t(b, k), d = len * c.step * 0.95;
          if (s === 'B') c.bell(t, m0, 1.2, 0.8);
          else c.keys(t, m0, d + 0.3, 0.8, { ch: 'bell', idx: 1.0, tc: 0.7 });
          if (s === 'C') c.bell(t, m0 + 12, 1.0, 0.35);
          c.mark(t, pp(m0, 72, 84), len >= 8 ? 0.86 : k === 0 ? 0.8 : 0.58, len >= 8 ? d : 0);
        }
      }
      if (s === 'A' && b >= 8) {
        // ささやくようなメロディ
        [[0, vo[3] + 12], [10, vo[2] + 12]].forEach(([k, m]) => { const t = c.t(b, k); c.bell(t, m, 1.0, 0.55); c.mark(t, pp(m, 70, 84), 0.62, 0); });
      }
      if (s === 'outro' && b === 32) c.bell(bt, 84, 3, 0.7);
    }
  },
};

// ======================================================================
// 3. OVERCLOCK — 172 BPM ドラムンベース / E minor
// ======================================================================
const overclock = {
  id: 'overclock', title: 'OVERCLOCK', sub: '限界突破', genre: 'DRUM & BASS',
  bpm: 172, bars: 64, seed: 33, verb: 0.4, delay: 0.35, tail: 3,
  pal: { lanes: ['#ff3b4a', '#ffc53b', '#3bff9a', '#3bb8ff'], a: '#150508', b: '#ff2a3d', c: '#ff9a2a', hue: 0.99 },
  mix: { kick: 1.0, snare: 0.9, hat: 0.38, bass: 0.78, stab: 0.36, arp: 0.34, lead: 0.4 },
  compose(c) {
    const P = { Em: [52, 55, 59], C: [48, 52, 55], G: [50, 55, 59], D: [50, 54, 57], Bm: [47, 50, 54] };
    const R = { Em: 40, C: 36, G: 43, D: 38, Bm: 35 };
    const main = ['Em', 'C', 'G', 'D'], brk = ['C', 'D', 'Em', 'Bm'];
    const sec = (b) => b < 8 ? 'intro' : b < 12 ? 'build' : b < 28 ? 'drop' : b < 36 ? 'break' : b < 40 ? 'build2' : b < 56 ? 'drop2' : 'outro';
    const LEAD = [ // 2小節ごとの16分モチーフ（ステップ, 音）
      [[0, 83], [3, 83], [6, 79], [8, 76], [11, 79], [14, 83]],
      [[0, 81], [3, 81], [6, 79], [8, 74], [11, 76], [14, 79]],
    ];
    for (let b = 0; b < 64; b++) {
      const s = sec(b);
      const ch = (s === 'break' || s === 'build2') ? brk[b % 4] : main[b % 4];
      const tn = P[ch], root = R[ch];
      const bt = c.t(b, 0), bs = c.barSec;
      const dr = s === 'drop' || s === 'drop2';
      // パッド
      if (s === 'intro' || s === 'break' || s === 'build' || s === 'build2' || s === 'outro') c.pad(bt, tn.concat([tn[0] + 12]), bs * 1.03, s === 'intro' ? 0.5 + b * 0.06 : 0.8, { a: 0.4, c1: 2800 });
      // アルペジオ（イントロ/ブレイク）
      if (s === 'intro' || s === 'break' || s === 'build') {
        for (let k = 0; k < 16; k += 2) {
          const m = tn[(k / 2) % 3] + 24, t = c.t(b, k);
          c.pluck(t, m, 0.12, 0.7, { c0: 5000, c1: 900 });
          if (s !== 'intro' && k % 4 === 0) c.mark(t, pp(m, 70, 88), 0.34, 0);
        }
      }
      // ドラム
      const beat = dr || s === 'build2' || (s === 'build' && b >= 10) || (s === 'intro' && b >= 4);
      if (beat) {
        const ride = s === 'intro' || s === 'build' || s === 'build2';
        const kp = dr ? (b % 4 === 3 ? 'x.........x.x...' : 'x.........x.....') : 'x...x...x...x...';
        c.pat(kp, (k) => { c.kick(c.t(b, k), 1, { f0: 150, f1: 48, tc: 0.095, depth: 0.55, rel: 0.2 }); c.mark(c.t(b, k), 0.07, k % 4 === 0 && k < 11 ? 0.94 : 0.6, 0); });
        if (dr) {
          const sp = b % 4 === 3 ? '....x.......x.x.x' : (b % 2 ? '....x.......x..g' : '....x.......x...');
          c.pat(sp, (k, v, ch2) => { c.snare(c.t(b, k), ch2 === 'g' ? 0.35 : 0.95, { tc: 0.055 }); c.mark(c.t(b, k), 0.42, ch2 === 'g' ? 0.3 : (k === 4 || k === 12 ? 0.9 : 0.5), 0); });
          c.pat('x.x.x.x.x.x.x.x.', (k) => { c.hat(c.t(b, k), 0.6, false, { f: 8000 }); c.mark(c.t(b, k), 0.92, k % 4 === 0 ? 0.36 : 0.24, 0); });
          c.pat('..g...g...g...g.', (k) => c.snare(c.t(b, k), 0.22, { tc: 0.04 }));
          if (b % 4 === 3) c.hat(c.t(b, 15), 0.8, true);
        } else if (!ride) {
          c.pat('....x.......x...', (k) => { c.snare(c.t(b, k), 0.9); c.mark(c.t(b, k), 0.42, 0.88, 0); });
        } else {
          c.pat('x.x.x.x.x.x.x.x.', (k) => c.hat(c.t(b, k), 0.4, false));
          if (s === 'build2' || s === 'build') {
            const n = 16; const lastBar = (b === 11 || b === 39);
            if (lastBar) for (let k = 0; k < n; k++) { const t = bt + (k / n) * bs; c.snare(t, 0.3 + 0.65 * k / n, { tc: 0.04 }); if (k % 2 === 0) c.mark(t, 0.42, 0.55 + 0.3 * k / n, 0); }
          }
        }
      }
      // ベース（リース）
      if (dr) {
        const pat = b % 2 ? [[0, 6], [6, 2], [8, 6], [14, 2]] : [[0, 8], [8, 6], [14, 2]];
        pat.forEach(([k, len], i) => {
          const t = c.t(b, k);
          c.reese(t, root + (k === 14 ? 12 : 0), len * c.step * 0.95, 0.95, { cut: 650 + i * 120, wob: (b % 4 >= 2) ? 5.7 : 0 });
          c.mark(t, 0.2 + 0.08 * (i % 2), k === 0 ? 0.62 : 0.4, 0);
        });
        // スタブ
        [3, 10].forEach((k) => c.stab(c.t(b, k), tn.map(m => m + 12), c.step * 1.6, 0.85, { c1: 1400, q: 1.8 }));
        // リード
        const mot = LEAD[b % 2];
        const up = (s === 'drop2' && b >= 48) ? 12 : 0;
        for (const [k, m0] of mot) {
          const m = m0 + up - (ch === 'C' || ch === 'D' ? 0 : 0), t = c.t(b, k);
          c.lead(t, m, c.step * 1.8, 0.7, { cut: 4200, types: ['sawtooth', 'sawtooth'], vib: false });
          c.mark(t, pp(m0, 72, 86), k === 0 ? 0.74 : (k === 8 ? 0.62 : 0.4), 0);
        }
        if (b % 8 === 0) c.crash(bt, 0.7);
      }
      // ブレイクの長い音（ホールド）
      if (s === 'break') {
        const m = [76, 81, 83, 78][b % 4];
        c.lead(bt, m, bs * 0.96, 0.7, { cut: 2400 });
        c.mark(bt, pp(m, 72, 86), 0.9, bs * 0.96);
        [0, 6, 12].forEach((k, i) => { const mm = tn[i % 3] + 12, t = c.t(b, k); c.keys(t, mm, c.step * 4, 0.55); c.mark(t, pp(mm, 60, 80), 0.3, 0); });
        c.sub(bt, root, bs * 0.98, 0.6, { saw: 0.1 });
      }
      if ((s === 'build' && b === 8) || (s === 'build2' && b === 36)) c.riser(bt, bs * 4, 0.9, 400, 11000);
      if (b === 12 || b === 40) c.impact(bt, 0.95);
      if (b === 56) c.impact(bt, 0.5);
    }
  },
};

// ======================================================================
// 4. TIDAL — 140 BPM フューチャーベース / C minor
// ======================================================================
const tidal = {
  id: 'tidal', title: 'TIDAL', sub: '潮の満ちるとき', genre: 'FUTURE BASS',
  bpm: 140, bars: 64, seed: 44, swing: 0.05, verb: 0.65, delay: 0.55, tail: 3.5,
  pal: { lanes: ['#46e6ff', '#5b8dff', '#c97bff', '#ff78d6'], a: '#050f2e', b: '#2b6dff', c: '#a0f2ff', hue: 0.6 },
  mix: { kick: 1.0, snare: 0.9, clap: 0.9, bass: 0.72, stab: 0.46, arp: 0.34, lead: 0.4, pad: 0.34, hat: 0.38 },
  compose(c) {
    const P = { Cm: [60, 63, 67], Ab: [60, 63, 68], Eb: [58, 63, 67], Bb: [58, 62, 65], Fm: [60, 65, 68], G: [59, 62, 67] };
    const R = { Cm: 36, Ab: 32, Eb: 39, Bb: 34, Fm: 29, G: 31 };
    const main = ['Cm', 'Ab', 'Eb', 'Bb'], brk = ['Ab', 'Bb', 'Cm', 'G'];
    const sec = (b) => b < 4 ? 'intro' : b < 12 ? 'verse' : b < 16 ? 'pre' : b < 32 ? 'drop' : b < 40 ? 'break' : b < 44 ? 'pre2' : b < 60 ? 'drop2' : 'outro';
    const HOOK = [
      [[0, 79, 3], [3, 79, 3], [6, 82, 2], [8, 84, 6], [14, 82, 2]],
      [[0, 80, 3], [3, 80, 3], [6, 84, 2], [8, 87, 6], [14, 84, 2]],
      [[0, 82, 3], [3, 82, 3], [6, 86, 2], [8, 87, 4], [12, 86, 2], [14, 82, 2]],
      [[0, 82, 4], [4, 79, 2], [6, 77, 2], [8, 74, 8]],
    ];
    for (let b = 0; b < 64; b++) {
      const s = sec(b);
      const ch = (s === 'break' || s === 'pre2') ? brk[b % 4] : main[b % 4];
      const tn = P[ch], root = R[ch];
      const bt = c.t(b, 0), bs = c.barSec;
      const dr = s === 'drop' || s === 'drop2';
      // パッド
      const padV = s === 'intro' ? 0.5 + b * 0.12 : s === 'outro' ? 0.9 - (b - 60) * 0.2 : 0.9;
      c.pad(bt, tn.concat([tn[0] - 12]), bs * 1.04, padV, { a: 0.5, c1: 2600 });
      // ドロップの和音（シェイクするスーパーソー）
      if (dr) {
        const hits = [[0, 5], [6, 2], [8, 6]];
        hits.forEach(([k, len]) => c.stab(c.t(b, k), tn.concat([tn[0] + 12, tn[2] + 12]), len * c.step * 0.98, 0.95, { c0: 9000, c1: 1800, ftc: 0.22, tc: 0.3, sus: 0.5 }));
        c.duckMus(c.t(b, 0), 0.55, 0.34); c.duckMus(c.t(b, 8), 0.55, 0.34);
      }
      // アルペジオ（バース/プリ）
      if (s === 'verse' || s === 'pre' || s === 'intro' && b >= 2 || s === 'pre2') {
        for (let k = 0; k < 16; k++) {
          if (k % 2) continue;
          const m = [tn[0] + 12, tn[2] + 12, tn[1] + 24, tn[2] + 12][(k / 2) % 4], t = c.t(b, k);
          c.pluck(t, m, 0.2, 0.7, { c0: 3600, c1: 800 });
          if (s !== 'intro') c.mark(t, pp(m, 70, 92), k % 4 === 0 ? 0.32 : 0.2, 0);
        }
      }
      // ドラム（ハーフタイム）
      const beat = dr || s === 'verse' || s === 'pre' || s === 'pre2' && b >= 42;
      if (beat) {
        const kp = dr ? (b % 2 ? 'x.....x...x.....' : 'x.......x.x.....') : 'x.......x.......';
        c.pat(kp, (k) => { c.kick(c.t(b, k), 1, { f0: 160, f1: 44, tc: 0.14, depth: 0.7, rel: 0.3 }); c.mark(c.t(b, k), 0.07, k === 0 ? 0.95 : 0.62, 0); });
        c.pat('........x.......', (k) => { c.snare(c.t(b, k), 1, { tc: 0.07, f: 1900 }); c.clap(c.t(b, k), 0.85); c.mark(c.t(b, k), 0.42, 0.92, 0); });
        if (dr || s === 'verse') {
          c.pat('x.x.x.xxx.x.x.xx', (k, v) => { c.hat(c.t(b, k), 0.5 * (k % 4 === 0 ? 1 : 0.65), false, { f: 7500 }); if (k % 4 === 0 || k === 2 || k === 10) c.mark(c.t(b, k), 0.92, k % 4 === 0 ? 0.36 : 0.26, 0); });
        }
        if (dr) c.pat('..............o.', (k) => c.hat(c.t(b, k), 0.7, true));
      }
      // プリのスネアビルド
      if ((s === 'pre' && b >= 14) || (s === 'pre2' && b >= 42)) {
        const n = b % 2 ? 16 : 8;
        for (let k = 0; k < n; k++) { const t = bt + (k / n) * bs; c.snare(t, 0.3 + 0.6 * ((b === 15 || b === 43) ? k / n : k / n * 0.5), { tc: 0.05 }); if (n === 8 || k % 2 === 0) c.mark(t, 0.42, 0.52 + 0.3 * k / n, 0); }
      }
      // ベース
      if (dr) {
        const pat = b % 2 ? [[0, 6], [6, 2], [8, 4], [12, 4]] : [[0, 6], [6, 2], [8, 8]];
        pat.forEach(([k, len], i) => {
          const t = c.t(b, k);
          c.reese(t, root + (i === 1 ? 12 : 0), len * c.step * 0.96, 1, { cut: 780, wob: len >= 6 ? 4.67 : 0, q: 3 });
          c.mark(t, 0.2 + i * 0.04, k === 0 ? 0.64 : 0.38, 0);
        });
      } else if (s === 'verse' || s === 'pre' || s === 'pre2') {
        c.sub(bt, root, bs * 0.5, 0.8, { saw: 0.2, cut: 400 }); c.mark(bt, 0.15, 0.55, 0);
        c.sub(c.t(b, 8), root, bs * 0.45, 0.7, { saw: 0.2, cut: 400 }); c.mark(c.t(b, 8), 0.2, 0.4, 0);
      }
      // リード（ドロップ）
      if (dr) {
        const ph = HOOK[b % 4];
        const up = (s === 'drop2' && b >= 52) ? 0 : 0;
        for (const [k, m0, len] of ph) {
          const m = m0 + up, t = c.t(b, k), d = len * c.step * 0.95;
          c.lead(t, m - 12, d, 0.75, { cut: 3600, types: ['sawtooth', 'sawtooth'], dets: [-14, 14], vib: 8 });
          c.lead(t, m, d, 0.3, { cut: 5000, types: ['square', 'sawtooth'], vib: false });
          c.mark(t, pp(m0, 74, 88), len >= 8 ? 0.86 : (k === 0 || k === 8) ? 0.76 : 0.52, len >= 7 ? d : 0);
        }
      }
      // ブレイク: 鍵盤とホールド
      if (s === 'break') {
        const m = [75, 77, 79, 74][b % 4] + 12;
        c.lead(bt, m, bs * 0.96, 0.6, { cut: 2600 });
        c.mark(bt, pp(m, 74, 90), 0.9, bs * 0.96);
        [0, 4, 8, 12].forEach((k, i) => { const mm = tn[i % 3] + 12 + (i === 3 ? 12 : 0), t = c.t(b, k); c.keys(t, mm, c.step * 3.5, 0.6); c.mark(t, pp(mm, 66, 90), 0.34, 0); });
        if (b % 2 === 0) c.sub(bt, root, bs * 1.9, 0.6, { saw: 0.1 });
      }
      if ((s === 'pre' && b === 12) || (s === 'pre2' && b === 40) || (s === 'break' && b === 38)) c.riser(bt, bs * (s === 'break' ? 2 : 4), 0.9, 300, 10000);
      if (b === 16 || b === 44) { c.impact(bt, 0.95); c.crash(bt, 0.8); }
      if (b === 32) c.crash(bt, 0.5);
      if (b === 60) c.impact(bt, 0.5);
    }
  },
};

// ======================================================================
// 5. AURORA WALTZ — 96 BPM 3拍子 / D minor
// ======================================================================
const waltz = {
  id: 'aurora-waltz', title: 'AURORA WALTZ', sub: 'オーロラの輪舞曲', genre: 'CINEMATIC WALTZ',
  bpm: 96, sig: 3, bars: 48, seed: 55, verb: 0.85, delay: 0.4, tail: 3, fadeOut: 2.2,
  pal: { lanes: ['#8fd6ff', '#b9a6ff', '#ff9fdc', '#ffe3a1'], a: '#080e2c', b: '#6b7cff', c: '#ffd0ee', hue: 0.66 },
  mix: { kick: 0.7, hat: 0.3, bass: 0.8, pad: 0.36, keys: 0.55, bell: 0.34, lead: 0.34 },
  compose(c) {
    const V = { Dm: [57, 62, 65], Bb: [58, 62, 65], Gm: [58, 62, 67], A: [57, 61, 64] };
    const Rt = { Dm: 38, Bb: 34, Gm: 43, A: 33 };
    const pr = ['Dm', 'Bb', 'Gm', 'A'];
    const P1 = [
      [[0, 81, 4], [4, 82, 2], [6, 81, 2], [8, 77, 4]],
      [[0, 79, 4], [4, 77, 4], [8, 74, 4]],
      [[0, 77, 6], [6, 79, 2], [8, 82, 4]],
      [[0, 81, 8], [8, 73, 4]],
    ];
    const P2 = [
      [[0, 86, 4], [4, 82, 2], [6, 81, 2], [8, 86, 4]],
      [[0, 82, 4], [4, 79, 4], [8, 77, 4]],
      [[0, 79, 6], [6, 77, 2], [8, 74, 4]],
      [[0, 73, 4], [4, 76, 4], [8, 81, 4]],
    ];
    const sec = (b) => b < 4 ? 'intro' : b < 12 ? 'A' : b < 20 ? 'B' : b < 28 ? 'C' : b < 36 ? 'D' : b < 44 ? 'E' : 'outro';
    for (let b = 0; b < 48; b++) {
      const s = sec(b), ch = pr[b % 4], vo = V[ch], root = Rt[ch];
      const bt = c.t(b, 0), bs = c.barSec;
      const outroV = s === 'outro' ? 0.9 - (b - 44) * 0.2 : 1;
      // 弦と低音
      c.strings(bt, vo.concat([vo[0] - 12]), bs * 1.02, (s === 'intro' ? 0.5 + b * 0.1 : 0.85) * outroV);
      if (s !== 'intro' || b >= 2) {
        c.sub(bt, root, c.step * 5, 0.8 * outroV, { saw: 0.12, cut: 380 });
        c.mark(bt, 0.1, 0.62, 0);
      }
      // ワルツの刻み（2・3拍目）
      if (s === 'A' || s === 'B' || s === 'C' || s === 'E') {
        [4, 8].forEach((k) => {
          const t = c.t(b, k);
          vo.forEach((m, i) => c.keys(t + i * 0.008, m + 12, c.step * 2.5, 0.38 * outroV, { pan: (i - 1) * 0.3, idx: 1.2 }));
          c.mark(t, 0.4, 0.38, 0);
        });
      }
      // イントロ・間奏のアルペジオ
      if (s === 'intro' || s === 'D' || s === 'outro') {
        const arp = [vo[0] + 12, vo[1] + 12, vo[2] + 12, vo[1] + 24, vo[2] + 12, vo[1] + 12];
        for (let k = 0; k < 6; k++) {
          const t = c.t(b, k * 2), m = arp[k];
          c.keys(t, m, c.step * 3, 0.5 * (s === 'intro' ? 0.6 + b * 0.12 : 1) * outroV, { pan: k % 2 ? 0.3 : -0.3, idx: 1.0 });
          if (s !== 'intro') c.mark(t, 0.3 + 0.4 * (k % 3) / 2, k % 2 === 0 ? 0.42 : 0.28, 0);
        }
      }
      // 軽いリズム（B以降）
      if (s === 'B' || s === 'C' || s === 'E') {
        c.kick(bt, 0.55, { f0: 120, f1: 48, tc: 0.12, depth: 0.12, rel: 0.2 }); c.mark(bt, 0.07, 0.55, 0);
        [4, 8].forEach((k) => c.shaker(c.t(b, k), 0.6));
        if (s !== 'B') [2, 6, 10].forEach((k) => c.hat(c.t(b, k), 0.35, false, { f: 8500 }));
      }
      // 旋律
      if (s === 'A' || s === 'B' || s === 'E') {
        const ph = P1[b % 4];
        for (const [k, m, len] of ph) {
          const t = c.t(b, k), d = len * c.step * 0.96;
          c.keys(t, m, d + 0.4, 0.78, { ch: 'keys', idx: 1.5, tc: 0.9, pan: 0.1 });
          if (s !== 'A') c.lead(t, m, d, 0.5, { cut: 2400, vib: 9 });
          c.mark(t, pp(m, 72, 88), len >= 6 ? 0.86 : k === 0 ? 0.8 : 0.55, len >= 6 ? d : 0);
        }
      } else if (s === 'C') {
        const ph = P2[b % 4];
        for (const [k, m, len] of ph) {
          const t = c.t(b, k), d = len * c.step * 0.96;
          c.lead(t, m, d, 0.62, { cut: 3000, vib: 10 });
          c.keys(t, m - 12, d + 0.3, 0.5, { idx: 1.4, tc: 0.8 });
          c.bell(t, m + 12, 1.4, 0.35);
          c.mark(t, pp(m, 72, 88), len >= 6 ? 0.88 : k === 0 ? 0.8 : 0.55, len >= 6 ? d : 0);
        }
      } else if (s === 'D') {
        // 間奏：長い音（ホールド）と鈴
        const m = (b % 8 >= 4 ? [77, 77, 74, 73] : [81, 82, 79, 76])[b % 4];
        c.lead(bt, m, bs * 0.98, 0.5, { cut: 2200, vib: 10 });
        c.mark(bt, pp(m, 72, 88), 0.9, bs * 0.98);
        c.bell(c.t(b, 8), m + 12, 1.6, 0.4); c.mark(c.t(b, 8), 0.85, 0.5, 0);
      } else if (s === 'outro') {
        if (b === 44) c.bell(bt, 86, 3, 0.6);
      }
      if ((s === 'A' && b === 4) || (s === 'E' && b === 36)) c.crash(bt, 0.35);
      if (b === 20 || b === 36) c.impact(bt, 0.5);
    }
  },
};

export const SONGS = [neonDawn, glassGarden, waltz, tidal, overclock];
