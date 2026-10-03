// SYNESTHESIA — 組み込み曲のシンセ（自前DSPで曲全体を Float32Array に直接レンダリング）
// 音源ファイルは一切使わない。楽譜（コード進行・パターン）から波形を作り、
// 同じ楽譜から「譜面の候補（mark）」も出力する。Worker でも本スレッドでも動く。
import { MIDI, mulberry32, clamp } from './util.js';

const TAU = Math.PI * 2;

// --- ステートバリアブルフィルタ（変調しても安定なTPT型） ---
class SVF {
  constructor(sr) { this.sr = sr; this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 1; this.lp = 0; this.bp = 0; this.hp = 0; }
  set(fc, q) {
    fc = Math.min(Math.max(fc, 10), this.sr * 0.45);
    const g = Math.tan(Math.PI * fc / this.sr);
    const k = 1 / q; this.k = k;
    const a1 = 1 / (1 + g * (g + k));
    this.a1 = a1; this.a2 = g * a1; this.a3 = g * this.a2;
  }
  tick(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1 * this.k; this.hp = x - this.k * v1 - v2;
    return v2;
  }
}

// --- エンベロープ: Attack(線形) → 指数減衰 → サステイン → Release(指数) ---
class Env {
  constructor(sr, peak, a, dtc, sus, dur, rel) {
    this.peak = peak;
    this.aS = Math.max(1, Math.round(a * sr));
    this.dd = Math.exp(-1 / (Math.max(0.003, dtc) * sr));
    this.sus = sus;
    this.offS = Math.round(dur * sr);
    this.rd = Math.exp(-1 / (Math.max(0.003, rel / 3) * sr));
    this.n = 0; this.lvl = 0;
    this.len = this.offS + Math.round(rel * 2.4 * sr) + 8;
  }
  next() {
    const n = this.n++;
    if (n < this.offS) {
      if (this.lvl < 1 && n < this.aS) this.lvl += 1 / this.aS;
      else this.lvl = this.sus + (this.lvl - this.sus) * this.dd;
    } else this.lvl *= this.rd;
    return this.peak * this.lvl;
  }
}

function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
const saw = (ph, dt) => 2 * ph - 1 - blep(ph, dt);
const sqr = (ph, dt) => (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep(ph >= 0.5 ? ph - 0.5 : ph + 0.5, dt);

export class Composer {
  constructor(song, sr = 32000) {
    this.song = song;
    this.sr = sr;
    this.bpm = song.bpm;
    this.sig = song.sig || 4;
    this.spb = 60 / this.bpm;
    this.step = this.spb / 4;
    this.stepsPerBar = this.sig * 4;
    this.barSec = this.stepsPerBar * this.step;
    this.bars = song.bars;
    this.swing = song.swing || 0;
    this.tail = song.tail != null ? song.tail : 3.5;
    this.dur = this.bars * this.barSec + this.tail;
    this.rng = mulberry32(song.seed || 1);
    this.nr = mulberry32((song.seed || 1) * 31 + 7); // ノイズ用
    this.N = Math.ceil(sr * this.dur);
    const N = this.N, F = () => new Float32Array(N);
    // バス
    this.bassB = F();
    this.musL = F(); this.musR = F();
    this.dirL = F(); this.dirR = F();
    this.vrb = F(); this.dly = F();
    this.S1 = new Float32Array(Math.ceil(sr * 16)); this.S2 = new Float32Array(Math.ceil(sr * 16));
    this.marks = [];
    this.duckEv = [];
    const V = song.mix || {};
    const v = (k, d) => (V[k] != null ? V[k] : d);
    // チャンネル: bus, 音量, パン, リバーブ送り, ディレイ送り
    this.chs = {
      kick: { bus: 'dir', vol: v('kick', 1.0) },
      snare: { bus: 'dir', vol: v('snare', 0.8), verb: 0.28 },
      clap: { bus: 'dir', vol: v('clap', 0.7), verb: 0.3 },
      hat: { bus: 'dir', vol: v('hat', 0.32), pan: 0.15 },
      perc: { bus: 'dir', vol: v('perc', 0.5), verb: 0.15, pan: -0.2 },
      bass: { bus: 'bass', vol: v('bass', 0.8) },
      pad: { bus: 'mus', vol: v('pad', 0.32), verb: 0.4 },
      arp: { bus: 'mus', vol: v('arp', 0.28), verb: 0.25, delay: 0.35 },
      stab: { bus: 'mus', vol: v('stab', 0.34), verb: 0.25, delay: 0.2 },
      lead: { bus: 'dir', vol: v('lead', 0.38), verb: 0.34, delay: 0.4 },
      keys: { bus: 'mus', vol: v('keys', 0.42), verb: 0.38, delay: 0.2 },
      bell: { bus: 'dir', vol: v('bell', 0.3), verb: 0.6, delay: 0.5 },
      fx: { bus: 'dir', vol: v('fx', 0.5), verb: 0.4 },
      noise: { bus: 'dir', vol: v('noise', 0.05) },
    };
  }

  // ---------- 時間 ----------
  t(bar, step = 0) {
    const ok = Number.isInteger(step);
    const off = ok && step % 2 ? this.swing : 0, off8 = ok && step % 4 === 2 ? (this.song.swing8 || 0) : 0;
    return (bar * this.stepsPerBar + step + off + off8) * this.step;
  }
  rnd() { return this.rng(); }
  mark(t, pos, imp, dur = 0) { this.marks.push({ t, pos: clamp(pos, 0, 1), imp: clamp(imp, 0, 1), dur, g: 0 }); }

  // ---------- ミックス ----------
  // mono: S1 の [0,len) を ch へ。stereo: S1=L, S2=R
  _mix(chName, t, len, pan = 0, stereo = false) {
    const ch = this.chs[chName];
    const start = Math.round(t * this.sr);
    const N = this.N;
    if (start >= N || start < 0) return;
    const n = Math.min(len, N - start);
    const vol = ch.vol;
    const p = clamp(pan + (ch.pan || 0), -1, 1);
    const th = (p + 1) * Math.PI / 4;
    const gl = Math.cos(th) * vol * 1.4142, gr = Math.sin(th) * vol * 1.4142;
    const S1 = this.S1, S2 = this.S2;
    const vs = ch.verb || 0, ds = ch.delay || 0;
    const vrb = this.vrb, dly = this.dly;
    if (ch.bus === 'bass') {
      const b = this.bassB;
      for (let i = 0; i < n; i++) b[start + i] += S1[i] * vol;
    } else {
      const L = ch.bus === 'mus' ? this.musL : this.dirL, R = ch.bus === 'mus' ? this.musR : this.dirR;
      if (stereo) {
        for (let i = 0; i < n; i++) { L[start + i] += S1[i] * vol; R[start + i] += S2[i] * vol; }
      } else {
        for (let i = 0; i < n; i++) { const x = S1[i]; L[start + i] += x * gl; R[start + i] += x * gr; }
      }
    }
    if (vs) { const k = vs * vol; if (stereo) for (let i = 0; i < n; i++) vrb[start + i] += (S1[i] + S2[i]) * 0.5 * k; else for (let i = 0; i < n; i++) vrb[start + i] += S1[i] * k; }
    if (ds) { const k = ds * vol; if (stereo) for (let i = 0; i < n; i++) dly[start + i] += (S1[i] + S2[i]) * 0.5 * k; else for (let i = 0; i < n; i++) dly[start + i] += S1[i] * k; }
  }

  // ---------- サイドチェイン ----------
  duck(t, depth = 0.6, rel = 0.26) { this.duckEv.push([t, depth, rel, 'a']); }
  duckMus(t, depth = 0.5, rel = 0.24) { this.duckEv.push([t, depth, rel, 'm']); }

  // ---------- ドラム ----------
  kick(t, v = 1, o = {}) {
    const sr = this.sr, S = this.S1;
    const f0 = o.f0 || 165, f1 = o.f1 || 46, tc = o.tc || 0.115, sweep = o.sweep || 0.085;
    const len = Math.round(0.75 * sr);
    let ph = 0, hpz = 0;
    const nr = this.nr;
    const ratio = Math.log(f1 / f0);
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const f = tt < sweep ? f0 * Math.exp(ratio * tt / sweep) : f1;
      ph += f / sr; if (ph > 1) ph -= 1;
      const a = tt < 0.002 ? tt / 0.002 : Math.exp(-(tt - 0.002) / tc);
      let x = Math.sin(TAU * ph) * a;
      x = Math.tanh(x * 1.5) * 0.85;
      // クリック
      const nz = nr() * 2 - 1; hpz += (nz - hpz) * 0.25; const click = (nz - hpz) * Math.exp(-tt / 0.004) * 0.28;
      S[i] = (x + click) * v;
    }
    this._mix('kick', t, len);
    if (o.duck !== false) this.duck(t, o.depth != null ? o.depth : 0.62, o.rel || 0.27);
  }
  snare(t, v = 1, o = {}) {
    const sr = this.sr, S = this.S1, nr = this.nr;
    const tc = o.tc || 0.06, len = Math.round(0.4 * sr);
    const f1 = new SVF(sr), f2 = new SVF(sr);
    f1.set(o.f || 2100, 0.65); f2.set(6000, 0.7);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const nz = nr() * 2 - 1;
      f1.tick(nz); f2.tick(nz);
      const e1 = (tt < 0.002 ? tt / 0.002 : Math.exp(-(tt - 0.002) / tc)) * 0.9;
      const e2 = Math.exp(-tt / (tc * 1.5)) * 0.4;
      const f = tt < 0.07 ? 240 * Math.exp(Math.log(130 / 240) * tt / 0.07) : 130;
      ph += f / sr;
      const tone = Math.sin(TAU * ph) * Math.exp(-tt / 0.04) * 0.55;
      S[i] = (f1.bp * e1 * 1.6 + f2.hp * e2 + tone) * v;
    }
    this._mix('snare', t, len);
  }
  clap(t, v = 1) {
    const sr = this.sr, S = this.S1, nr = this.nr, len = Math.round(0.45 * sr);
    const f = new SVF(sr); f.set(1500, 1.1);
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      f.tick(nr() * 2 - 1);
      let e = 0;
      for (let k = 0; k < 3; k++) { const d = tt - k * 0.011; if (d >= 0) e = Math.max(e, 0.9 * Math.exp(-d / 0.0045) + 0.05); }
      if (tt >= 0.033) e = Math.max(e, 0.8 * Math.exp(-(tt - 0.033) / 0.07));
      S[i] = f.bp * e * 1.5 * v;
    }
    this._mix('clap', t, len);
  }
  hat(t, v = 1, open = false, o = {}) {
    const sr = this.sr, S = this.S1, nr = this.nr;
    const len = Math.round((open ? 0.6 : 0.14) * sr);
    const f = new SVF(sr); f.set(Math.min(o.f || 7200, sr * 0.4), 0.8);
    const tc = open ? (o.tc || 0.11) : (o.tc || 0.02);
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      f.tick(nr() * 2 - 1);
      S[i] = f.hp * (tt < 0.001 ? tt / 0.001 : Math.exp(-(tt - 0.001) / tc)) * v;
    }
    this._hp = -(this._hp || .25);
    this._mix('hat', t, len, this._hp);
  }
  shaker(t, v = 1) {
    const sr = this.sr, S = this.S1, nr = this.nr, len = Math.round(0.25 * sr);
    const f = new SVF(sr); f.set(5200, 1.4);
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      f.tick(nr() * 2 - 1);
      S[i] = f.bp * (tt < 0.018 ? tt / 0.018 : Math.exp(-(tt - 0.018) / 0.025)) * v * 1.4;
    }
    this._mix('hat', t, len);
  }
  tom(t, midi = 50, v = 1) {
    const sr = this.sr, S = this.S1, len = Math.round(0.7 * sr), f = MIDI(midi);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const fr = tt < 0.07 ? f * 1.6 * Math.exp(Math.log(1 / 1.6) * tt / 0.07) : f;
      ph += fr / sr;
      S[i] = Math.sin(TAU * ph) * Math.exp(-tt / 0.11) * v;
    }
    this._mix('perc', t, len);
  }
  rim(t, v = 1) {
    const sr = this.sr, S = this.S1, len = Math.round(0.1 * sr);
    const f = new SVF(sr); f.set(1900, 2.5);
    let p1 = 0, p2 = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      p1 += 1700 / sr; if (p1 > 1) p1 -= 1; p2 += 520 / sr; if (p2 > 1) p2 -= 1;
      f.tick(sqr(p1, 1700 / sr) * 0.5 + Math.sin(TAU * p2) * 0.5);
      S[i] = f.bp * Math.exp(-tt / 0.012) * v * 0.9;
    }
    this._mix('perc', t, len);
  }

  // ---------- ベース ----------
  sub(t, midi, dur, v = 1, o = {}) {
    const sr = this.sr, S = this.S1, f = MIDI(midi), dt = f / sr;
    const env = new Env(sr, v, 0.006, 0.25, 0.85, dur + 0.12, 0.08);
    const len = env.len;
    const sawG = o.saw != null ? o.saw : 0.5, cut = o.cut || 520;
    const flt = new SVF(sr);
    let p1 = 0, p2 = 0, ce = 1.3;
    const cd = Math.exp(-1 / (0.07 * sr));
    for (let i = 0; i < len; i++) {
      if ((i & 15) === 0) flt.set(cut * (1 + ce), o.q || 1.4);
      ce *= cd;
      p1 += dt; if (p1 > 1) p1 -= 1;
      let x = Math.sin(TAU * p1);
      if (sawG > 0) { p2 += dt; if (p2 > 1) p2 -= 1; flt.tick(saw(p2, dt)); x += flt.lp * sawG; }
      S[i] = x * env.next();
    }
    this._mix('bass', t, len);
  }
  reese(t, midi, dur, v = 1, o = {}) {
    const sr = this.sr, S = this.S1, f = MIDI(midi);
    const env = new Env(sr, v * 0.42, 0.01, 0.4, 0.9, dur, 0.12);
    const len = env.len;
    const dets = [-14, -5, 6, 15].map(c => Math.pow(2, c / 1200));
    const ph = [0, 0.25, 0.5, 0.75], ph0 = [0.1, 0.4, 0.7, 0.9];
    let p0 = 0;
    const flt = new SVF(sr), cut = o.cut || 700, q = o.q || 2.5;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      if ((i & 15) === 0) flt.set(cut * (1 + (o.wob ? 0.7 * Math.sin(TAU * o.wob * tt) : 0)), q);
      let x = 0;
      for (let k = 0; k < 4; k++) {
        const d = f * dets[k] / sr;
        ph[k] += d; if (ph[k] > 1) ph[k] -= 1;
        x += saw(ph[k], d);
      }
      p0 += f / sr; if (p0 > 1) p0 -= 1;
      flt.tick(x * 0.5);
      S[i] = (flt.lp + Math.sin(TAU * p0) * 0.8) * env.next();
    }
    void ph0;
    this._mix('bass', t, len);
  }

  // ---------- メロディ系 ----------
  pluck(t, midi, dur, v = 1, o = {}) {
    const sr = this.sr, S = this.S1, f = MIDI(midi);
    const env = new Env(sr, v, 0.003, o.tc || Math.max(0.05, dur * 0.35), o.sus || 0, dur, 0.08);
    const len = env.len;
    const c0 = o.c0 || 4200, c1 = o.c1 || 700, q = o.q || 3.5, ftc = o.ftc || 0.09;
    const flt = new SVF(sr);
    const d1 = f * 0.99596 / sr, d2 = f * 1.00406 / sr, d3 = f * 2 / sr;
    let p1 = 0.1, p2 = 0.6, p3 = 0.3, ce = 1;
    const cd = Math.exp(-1 / (ftc * sr));
    const sq = o.sq !== false;
    for (let i = 0; i < len; i++) {
      if ((i & 15) === 0) flt.set(c1 + (c0 - c1) * ce, q);
      ce *= cd;
      p1 += d1; if (p1 > 1) p1 -= 1; p2 += d2; if (p2 > 1) p2 -= 1;
      let x = saw(p1, d1) + saw(p2, d2);
      if (sq) { p3 += d3; if (p3 > 1) p3 -= 1; x += sqr(p3, d3) * 0.25; }
      flt.tick(x * 0.5);
      S[i] = flt.lp * env.next();
    }
    this._pp = -(this._pp || .4);
    this._mix(o.ch || 'arp', t, len, o.pan != null ? o.pan : this._pp);
  }
  lead(t, midi, dur, v = 1, o = {}) {
    const sr = this.sr, S = this.S1, f = MIDI(midi);
    const env = new Env(sr, v, o.a || 0.012, 0.3, 0.8, dur, o.rel || 0.18);
    const len = env.len;
    const types = o.types || ['sawtooth', 'square'];
    const dets = (o.dets || [-8, 8]).map(c => Math.pow(2, c / 1200));
    const cut = o.cut || 3200, flt = new SVF(sr);
    const vibOn = dur > 0.3 && o.vib !== false, vibD = o.vib || 11;
    const ph = [0.13, 0.57], g = [0.8, 0.5];
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      if ((i & 15) === 0) flt.set(cut * (1 + 0.8 * Math.exp(-tt / 0.12)), o.q || 1.6);
      let vib = 1;
      if (vibOn && tt > 0.1) vib = 1 + (vibD * (1 - Math.exp(-(tt - 0.1) / 0.2)) * Math.sin(TAU * 5.4 * tt)) * 0.000578;
      let x = 0;
      for (let k = 0; k < 2; k++) {
        const d = f * dets[k] * vib / sr;
        ph[k] += d; if (ph[k] > 1) ph[k] -= 1;
        x += (types[k] === 'square' ? sqr(ph[k], d) : saw(ph[k], d)) * g[k];
      }
      flt.tick(x);
      S[i] = flt.lp * env.next();
    }
    void lp;
    this._mix(o.ch || 'lead', t, len);
  }
  // 厚みのあるパッド・弦（L/R別にフィルタ）
  pad(t, midis, dur, v = 1, o = {}) {
    const sr = this.sr, SL = this.S1, SR = this.S2;
    const rel = o.rel || 1.0;
    const env = new Env(sr, v / Math.sqrt(midis.length), o.a || 0.5, 0.5, 0.9, dur, rel);
    const len = Math.min(env.len, SL.length);
    const voices = [];
    midis.forEach((m, i) => {
      for (const dt of [-11, 0, 11]) {
        const fr = MIDI(m) * Math.pow(2, (dt + (this.rng() - 0.5) * 4) / 1200);
        const pan = ((i + (dt > 0 ? 1 : 0)) % 3 - 1) * 0.55;
        const th = (pan + 1) * Math.PI / 4;
        voices.push({ d: fr / sr, ph: this.rng(), l: Math.cos(th), r: Math.sin(th) });
      }
    });
    const fl = new SVF(sr), fr2 = new SVF(sr);
    const c0 = o.c0 || 450, c1 = o.c1 || 2400, rampN = dur * 0.7 * sr;
    for (let i = 0; i < len; i++) {
      if ((i & 15) === 0) { const c = c0 + (c1 - c0) * Math.min(1, i / rampN); fl.set(c, 0.8); fr2.set(c, 0.8); }
      let xl = 0, xr = 0;
      for (let k = 0; k < voices.length; k++) {
        const vo = voices[k];
        vo.ph += vo.d; if (vo.ph > 1) vo.ph -= 1;
        const s = saw(vo.ph, vo.d);
        xl += s * vo.l; xr += s * vo.r;
      }
      fl.tick(xl); fr2.tick(xr);
      const e = env.next();
      SL[i] = fl.lp * e * 0.7; SR[i] = fr2.lp * e * 0.7;
    }
    this._mix('pad', t, len, 0, true);
  }
  stab(t, midis, dur, v = 1, o = {}) {
    const sr = this.sr, SL = this.S1, SR = this.S2;
    const env = new Env(sr, v / Math.sqrt(midis.length), 0.004, o.tc || 0.18, o.sus || 0.25, dur, 0.12);
    const len = env.len;
    const voices = [];
    midis.forEach((m, i) => {
      for (const dt of [-16, -6, 0, 6, 16]) {
        const fr = MIDI(m) * Math.pow(2, dt / 1200);
        const pan = ((dt / 16) * 0.6) * (i % 2 ? -1 : 1);
        const th = (pan + 1) * Math.PI / 4;
        voices.push({ d: fr / sr, ph: this.rng(), l: Math.cos(th), r: Math.sin(th) });
      }
    });
    const fl = new SVF(sr), fr2 = new SVF(sr);
    const c0 = o.c0 || 7000, c1 = o.c1 || 900, ftc = o.ftc || 0.1, q = o.q || 1.2;
    let ce = 1; const cd = Math.exp(-1 / (ftc * sr));
    for (let i = 0; i < len; i++) {
      if ((i & 15) === 0) { const c = c1 + (c0 - c1) * ce; fl.set(c, q); fr2.set(c, q); }
      ce *= cd;
      let xl = 0, xr = 0;
      for (let k = 0; k < voices.length; k++) {
        const vo = voices[k];
        vo.ph += vo.d; if (vo.ph > 1) vo.ph -= 1;
        const s = saw(vo.ph, vo.d);
        xl += s * vo.l; xr += s * vo.r;
      }
      fl.tick(xl); fr2.tick(xr);
      const e = env.next();
      SL[i] = fl.lp * e * 0.6; SR[i] = fr2.lp * e * 0.6;
    }
    this._mix('stab', t, len, 0, true);
  }
  // エレピ（FM）
  keys(t, midi, dur, v = 1, o = {}) {
    const sr = this.sr, S = this.S1, f = MIDI(midi);
    const env = new Env(sr, v, 0.003, o.tc || Math.max(0.15, dur * 0.5), o.sus || 0, dur, 0.3);
    const len = env.len;
    const ratio = o.ratio || 1, beta0 = (o.idx || 1.8) / ratio, mtc = o.mtc || 0.35;
    let pc = 0, pm = 0, pb = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const beta = beta0 * (0.12 + 0.88 * Math.exp(-tt / mtc));
      pm += f * ratio / sr; if (pm > 1) pm -= 1;
      pc += f / sr; if (pc > 1) pc -= 1;
      let x = Math.sin(TAU * pc + beta * Math.sin(TAU * pm));
      if (tt < 0.2) { pb += f * 14 / sr; if (pb > 1) pb -= 1; x += Math.sin(TAU * pb) * 0.05 * Math.exp(-tt / 0.015); }
      S[i] = x * env.next();
    }
    this._mix(o.ch || 'keys', t, len, o.pan || 0);
  }
  bell(t, midi, dur, v = 1, o = {}) {
    const sr = this.sr, S = this.S1, f = MIDI(midi);
    const env = new Env(sr, v, 0.002, o.tc || 0.7, 0, dur, 0.8);
    const len = Math.min(env.len, this.S1.length);
    let pc = 0, pm = 0, p2 = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      pm += f * 3.51 / sr; if (pm > 1) pm -= 1;
      pc += f / sr; if (pc > 1) pc -= 1;
      p2 += f * 2 / sr; if (p2 > 1) p2 -= 1;
      const beta = 0.456 * Math.exp(-tt / 0.35);
      S[i] = (Math.sin(TAU * pc + beta * Math.sin(TAU * pm)) + Math.sin(TAU * p2) * 0.25) * env.next();
    }
    this._mix('bell', t, len, o.pan != null ? o.pan : (this.rng() - 0.5) * 0.6);
  }
  strings(t, midis, dur, v = 1) { this.pad(t, midis, dur, v, { a: 0.35, rel: 0.9, c0: 700, c1: 3200 }); }

  // ---------- FX ----------
  riser(t, dur, v = 1, f0 = 300, f1 = 9000) {
    const sr = this.sr, S = this.S1, nr = this.nr, len = Math.round((dur + 0.1) * sr);
    const bp = new SVF(sr), lp = new SVF(sr);
    let ph = 0;
    const lr = Math.log(f1 / f0);
    for (let i = 0; i < len; i++) {
      const x = Math.min(1, (i / sr) / dur);
      const fq = f0 * Math.exp(lr * x);
      if ((i & 15) === 0) { bp.set(fq, 1.4); lp.set(2500, 0.8); }
      const g = (i / sr) > dur ? 0 : 0.0001 * Math.pow(v / 0.0001, x);
      bp.tick(nr() * 2 - 1);
      ph += (f0 / 3 * Math.exp(Math.log((f1 / 4) / (f0 / 3)) * x)) / sr; if (ph > 1) ph -= 1;
      lp.tick(saw(ph, 0.01));
      S[i] = bp.bp * g * 1.6 + lp.lp * g * 0.25;
    }
    this._mix('fx', t, len);
  }
  impact(t, v = 1) {
    const sr = this.sr, S = this.S1, nr = this.nr, len = Math.round(2.4 * sr);
    let ph = 0;
    const lp = new SVF(sr);
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const f = tt < 1.1 ? 95 * Math.exp(Math.log(28 / 95) * tt / 1.1) : 28;
      ph += f / sr;
      if ((i & 15) === 0) lp.set(tt < 1.6 ? 7000 * Math.exp(Math.log(300 / 7000) * tt / 1.6) : 300, 0.6);
      lp.tick(nr() * 2 - 1);
      S[i] = (Math.sin(TAU * ph) * 0.95 + lp.lp * 0.7) * v * Math.exp(-tt / 0.5);
    }
    this._mix('fx', t, len);
  }
  crash(t, v = 1) {
    const sr = this.sr, S = this.S1, nr = this.nr, len = Math.round(2.5 * sr);
    const hp = new SVF(sr); hp.set(5500, 0.6);
    for (let i = 0; i < len; i++) {
      const tt = i / sr; hp.tick(nr() * 2 - 1);
      S[i] = hp.hp * v * 0.7 * Math.exp(-tt / 0.55);
    }
    this._mix('fx', t, len);
  }
  crackle(t0, t1, rate = 18, v = 1) {
    const sr = this.sr, S = this.S1, nr = this.nr;
    const n = Math.floor((t1 - t0) * rate);
    const len = Math.round(0.008 * sr);
    for (let k = 0; k < n; k++) {
      const t = t0 + this.rng() * (t1 - t0);
      const a = v * (0.15 + this.rng() * 0.6);
      let z = 0;
      for (let i = 0; i < len; i++) { const x = nr() * 2 - 1; const y = x - z; z = x; S[i] = y * a * Math.exp(-i / (0.0015 * sr)); }
      this._mix('noise', t, len);
    }
  }
  hiss(t0, t1, v = 1) {
    const sr = this.sr, nr = this.nr;
    const N = this.N, start = Math.round(t0 * sr), end = Math.min(N, Math.round(t1 * sr));
    const f = new SVF(sr); f.set(4200, 0.35);
    const vol = this.chs.noise.vol * v;
    for (let i = start; i < end; i++) {
      f.tick(nr() * 2 - 1);
      const x = f.bp * vol * 2;
      this.dirL[i] += x; this.dirR[i] += x;
    }
  }

  // ---------- パターン補助 ----------
  pat(str, fn) {
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '.' || ch === ' ') continue;
      fn(i, ch === 'X' ? 1.15 : ch === 'x' ? 1 : ch === 'o' ? 0.62 : ch === 'g' ? 0.35 : 0.8, ch);
    }
  }

  // ---------- マスタリング ----------
  render() {
    const sr = this.sr, N = this.N;
    // サイドチェインのゲイン
    const dB = new Float32Array(N).fill(1), dM = new Float32Array(N).fill(1);
    const evs = this.duckEv.slice().sort((a, b) => a[0] - b[0]);
    for (const [t, depth, rel, kind] of evs) {
      const s0 = Math.round(t * sr), n = Math.round(rel * sr);
      for (let i = 0; i < n && s0 + i < N; i++) {
        const gdb = 1 - depth * (1 - i / n);
        const gdm = 1 - (kind === 'a' ? depth * 0.85 : depth) * (1 - i / n);
        if (kind === 'a' && gdb < dB[s0 + i]) dB[s0 + i] = gdb;
        if (gdm < dM[s0 + i]) dM[s0 + i] = gdm;
      }
    }
    // リバーブ（Freeverb 型）
    const verbAmt = this.song.verb != null ? this.song.verb : 0.55;
    const [rvL, rvR] = freeverb(this.vrb, sr, 0.86, 0.35);
    // ピンポンディレイ
    const delAmt = this.song.delay != null ? this.song.delay : 0.5;
    const [dlL, dlR] = pingpong(this.dly, sr, this.spb * 0.75, 0.38);
    const L = new Float32Array(N), R = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const b = this.bassB[i] * dB[i];
      L[i] = this.dirL[i] + this.musL[i] * dM[i] + b + rvL[i] * verbAmt * 1.2 + dlL[i] * delAmt;
      R[i] = this.dirR[i] + this.musR[i] * dM[i] + b + rvR[i] * verbAmt * 1.2 + dlR[i] * delAmt;
    }
    // コンプレッサ + ソフトクリップ
    let env = 0;
    const att = Math.exp(-1 / (0.005 * sr)), rl = Math.exp(-1 / (0.2 * sr));
    const thr = 0.35, ratio = 3.2;
    for (let i = 0; i < N; i++) {
      const lv = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      env = lv > env ? lv + (env - lv) * att : lv + (env - lv) * rl;
      let g = 1;
      if (env > thr) g = (thr + (env - thr) / ratio) / env;
      L[i] = Math.tanh(L[i] * g * 1.1); R[i] = Math.tanh(R[i] * g * 1.1);
    }
    // 正規化・フェード
    let peak = 0;
    for (let i = 0; i < N; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; }
    const k = peak > 0 ? 0.8 / peak : 1;
    const fade = this.song.fadeOut != null ? this.song.fadeOut : 2.6, fN = Math.floor(sr * fade);
    for (let i = 0; i < N; i++) {
      let g = k;
      if (i < 64) g *= i / 64;
      if (i > N - fN) { const x = (N - i) / fN; g *= x * x * (3 - 2 * x); }
      L[i] *= g; R[i] *= g;
    }
    return { left: L, right: R };
  }
}

function freeverb(inp, sr, room, damp) {
  const N = inp.length, sc = sr / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(x => Math.round(x * sc));
  const apT = [556, 441, 341, 225].map(x => Math.round(x * sc));
  const mk = (spread) => {
    const out = new Float32Array(N);
    const cb = combT.map(t => new Float32Array(t + spread)), ci = combT.map(() => 0), cs = combT.map(() => 0);
    const ab = apT.map(t => new Float32Array(t + spread)), ai = apT.map(() => 0);
    const fb = room, d1 = damp, d2 = 1 - damp;
    const pre = Math.round(0.012 * sr), pb = new Float32Array(pre + 1); let pi = 0;
    for (let n = 0; n < N; n++) {
      const x0 = inp[n];
      const x = pb[pi]; pb[pi] = x0; pi = pi + 1 > pre ? 0 : pi + 1;
      const xin = x * 0.02;
      let sum = 0;
      for (let c = 0; c < cb.length; c++) {
        const buf = cb[c], i = ci[c];
        const y = buf[i];
        cs[c] = y * d2 + cs[c] * d1;
        buf[i] = xin + cs[c] * fb;
        ci[c] = i + 1 >= buf.length ? 0 : i + 1;
        sum += y;
      }
      for (let a = 0; a < ab.length; a++) {
        const buf = ab[a], i = ai[a];
        const bo = buf[i];
        buf[i] = sum + bo * 0.5;
        sum = bo - sum;
        ai[a] = i + 1 >= buf.length ? 0 : i + 1;
      }
      out[n] = sum;
    }
    return out;
  };
  return [mk(0), mk(Math.round(41 * sc))];
}

function pingpong(inp, sr, dt, fb) {
  const N = inp.length, D = Math.max(1, Math.round(dt * sr));
  const bl = new Float32Array(D), br = new Float32Array(D);
  const L = new Float32Array(N), R = new Float32Array(N);
  let pos = 0, zl = 0, zr = 0;
  const lpk = 0.45;
  for (let n = 0; n < N; n++) {
    const yl = bl[pos], yr = br[pos];
    L[n] = yl; R[n] = yr;
    zl += (yl - zl) * lpk; zr += (yr - zr) * lpk;
    bl[pos] = inp[n] + zr * fb;
    br[pos] = zl * fb;
    pos = pos + 1 >= D ? 0 : pos + 1;
  }
  return [L, R];
}

// 同期レンダリング（Worker 内・本スレッド両対応）
export function renderSongSync(song, sr = 32000) {
  const c = new Composer(song, sr);
  song.compose(c);
  const { left, right } = c.render();
  return { left, right, sr, cands: c.marks, dur: c.N / sr, bpm: song.bpm };
}
