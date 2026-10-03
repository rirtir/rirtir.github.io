// SYNESTHESIA — 曲が未選択のときの背景用デモ（合成スペクトル＋譜面）
import { NB } from './analyze.js';
import { buildChart } from './chart.js';
import { mulberry32, clamp } from './util.js';

export function makeDemo() {
  const fps = 100, dur = 16, bpm = 120, spb = 60 / bpm;
  const n = dur * fps;
  const spec = new Uint8Array(n * NB);
  const low = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n), all = new Float32Array(n), inten = new Float32Array(n);
  const rng = mulberry32(77);
  const scale = [0, 3, 5, 7, 10, 12, 15];
  const mel = []; for (let i = 0; i < 64; i++) mel.push(scale[Math.floor(rng() * scale.length)]);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const beat = t / spb, ph = beat - Math.floor(beat);
    const kick = Math.exp(-ph * 5.5);
    const hat = Math.exp(-(((beat + .5) % 1)) * 9);
    const half = Math.floor(beat * 2);
    const mf = (mel[half % 64] + 14) / 30;
    const ph2 = (beat * 2) % 1, mEnv = Math.exp(-ph2 * 3);
    for (let b = 0; b < NB; b++) {
      const x = b / (NB - 1);
      let v = 0;
      v += kick * Math.exp(-Math.pow((x - .08) / .09, 2)) * 1.0;
      v += mEnv * Math.exp(-Math.pow((x - (.25 + mf * .4)) / .07, 2)) * .85;
      v += 0.35 * Math.exp(-Math.pow((x - .4) / .35, 2)) * (.5 + .5 * Math.sin(t * .8 + b * .3));
      v += hat * Math.exp(-Math.pow((x - .85) / .12, 2)) * .7;
      v += (.1 + .08 * Math.sin(t * 2 + b)) * (1 - x * .5);
      spec[i * NB + b] = Math.round(clamp(v * 1.45) * 255);
    }
    low[i] = clamp(kick * .8 + .15); mid[i] = clamp(mEnv * .6 + .2); high[i] = clamp(hat * .6 + .15);
    all[i] = (low[i] + mid[i] + high[i]) / 3; inten[i] = .5;
  }
  const beats = []; for (let b = 0; b < dur / spb + 4; b++) beats.push(b * spb);
  // 合成の譜面候補
  const cands = [];
  for (let b = 0; b < dur / spb; b++) {
    const t = 1 + b * spb; if (t > dur - 0.5) break;
    cands.push({ t, pos: .08, imp: .9, dur: 0, g: 0 });
    if (b % 2 === 1) cands.push({ t, pos: .45, imp: .8, dur: 0, g: 1 });
    cands.push({ t: t + spb / 2, pos: .9, imp: .5, dur: 0, g: 3 });
    const m = mel[b % 64];
    cands.push({ t: t + spb * .25, pos: .3 + m / 40, imp: .6, dur: 0, g: 2 });
    if (b % 8 === 4) cands.push({ t: t + spb * .5, pos: .7, imp: .7, dur: spb * 1.8, g: 2 });
  }
  const chart = buildChart(cands, dur, 1, 3);
  const an = {
    sr: 44100, dur, fps, hop: 441, win: 1024, nFrames: n, centerOff: 0, spec, low, mid, high, all, inten,
    bpm, beatConf: 1, beats: Float32Array.from(beats), downPhase: 0, cands, drops: [], color: { centroid: .3, hi: .4, lo: .5, bpm },
  };
  const kicks = cands.filter(c => c.pos < .2 && c.imp > .45).map(c => c.t).sort((a, b) => a - b);
  return { an, chart, dur, kicks };
}
