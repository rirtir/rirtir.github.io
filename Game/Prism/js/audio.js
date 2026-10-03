// PRISM — 生成型サウンド（音源ファイルなし）
import { LMIN, LMAX } from './optics.js';

const PENT = [0, 2, 4, 7, 9]; // メジャーペンタトニック
function noteFreq(deg, base = 196) { // deg: 0.. (ペンタ階段)
  const oct = Math.floor(deg / 5), k = ((deg % 5) + 5) % 5;
  return base * Math.pow(2, (PENT[k] + oct * 12) / 12);
}
// 波長 → 音階（赤=低、紫=高）
export function nmToDegree(nm) {
  const t = 1 - Math.max(0, Math.min(1, (nm - LMIN) / (LMAX - LMIN)));
  return Math.round(t * 12) + 2;
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.vol = 0.8;
    this._amb = 0;
    this._hum = null;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? this.vol : 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.musicOn ? 0.55 : 0; this.music.connect(this.master);
    // リバーブ（生成したインパルス応答）
    this.rev = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1); }
    }
    this.rev.buffer = ir;
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.55;
    this.rev.connect(this.revGain); this.revGain.connect(this.master);
    this._startHum();
    this._ambLoop();
  }
  setEnabled(v) { this.enabled = v; if (this.master) this.master.gain.setTargetAtTime(v ? this.vol : 0, this.ctx.currentTime, 0.05); }
  setMusic(v) { this.musicOn = v; if (this.music) this.music.gain.setTargetAtTime(v ? 0.55 : 0, this.ctx.currentTime, 0.4); }

  _env(g, t, a, d, peak) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  // ベル音（非整数倍音）
  bell(freq, when = 0, vol = 0.2, decay = 1.8, bus = null) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const out = ctx.createGain(); out.gain.value = 1;
    out.connect(bus || this.sfx); out.connect(this.rev);
    const parts = [[1, 1], [2.01, 0.45], [2.76, 0.3], [5.4, 0.12], [8.93, 0.05]];
    for (const [m, a] of parts) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
      const g = ctx.createGain();
      this._env(g, t, 0.004, decay / (1 + m * 0.35), vol * a);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + decay + 0.1);
    }
  }
  chime(nm, when = 0, vol = 0.18) { this.bell(noteFreq(nmToDegree(nm), 261.6), when, vol, 2.2); }

  tick(pitch = 1, vol = 0.05) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(900 * pitch, t); o.frequency.exponentialRampToValueAtTime(380 * pitch, t + 0.05);
    const g = ctx.createGain(); this._env(g, t, 0.002, 0.06, vol);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.1);
  }
  grab() { this.tick(1.3, 0.07); }
  drop() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(95, t + 0.12);
    const g = ctx.createGain(); this._env(g, t, 0.003, 0.16, 0.18);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.25);
    this.tick(0.8, 0.05);
  }
  rotate(a) { this.tick(0.9 + ((a * 57.3 / 5) % 6) * 0.04, 0.035); }
  deny() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(150, t); o.frequency.setValueAtTime(120, t + 0.07);
    const g = ctx.createGain(); this._env(g, t, 0.004, 0.14, 0.05);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.2);
  }
  ui() { this.tick(1.6, 0.05); }
  hint() { this.bell(noteFreq(9, 261.6), 0, 0.1, 1.2); this.bell(noteFreq(11, 261.6), 0.09, 0.08, 1.2); }
  charge(k) { // 受光器が点灯
    this.bell(noteFreq(4 + k * 2, 261.6), 0, 0.09, 1.0);
  }
  win(nmList = []) {
    if (!this.ctx) return;
    const base = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
    base.forEach((d, i) => this.bell(noteFreq(d, 261.6), i * 0.085, 0.13, 2.6));
    this.bell(noteFreq(0, 130.8), 0, 0.2, 3.5);
    this.bell(noteFreq(7, 130.8), 0.1, 0.12, 3.5);
    nmList.forEach((nm, i) => this.chime(nm, 0.9 + i * 0.12, 0.1));
    // 上昇するシンセスウェル
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + 1.1);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(5000, t + 1.1);
    const g = ctx.createGain(); this._env(g, t, 0.9, 1.4, 0.06);
    o.connect(f); f.connect(g); g.connect(this.sfx); g.connect(this.rev); o.start(t); o.stop(t + 2.6);
  }
  // 光線のハム音（点灯中のレーザー数・総エネルギーに応じて）
  _startHum() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 2;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth'; o3.type = 'sine';
    o1.frequency.value = 55; o2.frequency.value = 55.4; o3.frequency.value = 110;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(f.frequency);
    o1.connect(f); o2.connect(f); o3.connect(f); f.connect(g); g.connect(this.music);
    o1.start(); o2.start(); o3.start(); lfo.start();
    this._hum = { g, f, o1, o2, o3 };
  }
  setHum(level, tone = 0) { // level 0..1, tone 0..1
    if (!this._hum || !this.ctx) return;
    if (this._hl != null && Math.abs(level - this._hl) < 0.03 && Math.abs(tone - this._ht) < 0.03) return;
    this._hl = level; this._ht = tone;
    const t = this.ctx.currentTime;
    this._hum.g.gain.setTargetAtTime(0.06 * level, t, 0.3);
    this._hum.f.frequency.setTargetAtTime(380 + 900 * tone, t, 0.4);
  }
  // 環境音（ゆっくりと和音が流れる）
  _ambLoop() {
    const ctx = this.ctx;
    const chords = [[0, 4, 7], [-3, 2, 4], [-5, 0, 2], [-2, 2, 5]];
    const play = () => {
      if (!this.ctx) return;
      if (this.musicOn && this.enabled && !document.hidden) {
        const ch = chords[this._amb++ % chords.length];
        const t = ctx.currentTime;
        ch.forEach((d, i) => {
          const o = ctx.createOscillator(); o.type = 'triangle';
          o.frequency.value = noteFreq(d + 5, 130.8) * (1 + (Math.random() - 0.5) * 0.002);
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + Math.random() * 600;
          const g = ctx.createGain(); this._env(g, t + i * 0.4, 3.2, 5.5, 0.085);
          o.connect(f); f.connect(g); g.connect(this.music); g.connect(this.rev);
          o.start(t + i * 0.4); o.stop(t + i * 0.4 + 9.5);
        });
        // たまにきらめき
        if (Math.random() < 0.7) this.bell(noteFreq(7 + Math.floor(Math.random() * 7), 261.6), 2 + Math.random() * 3, 0.05, 3.2, this.music);
      }
      setTimeout(play, 7000);
    };
    play();
  }
}
