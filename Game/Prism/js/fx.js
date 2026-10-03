// PRISM — パーティクル（火花・リング・紙吹雪）
import { BIN_RGB, NB } from './optics.js';

const MAX = 3000;
export class FX {
  constructor() {
    this.n = 0;
    this.p = new Float32Array(MAX * 16); // x,y,vx,vy, life,max, size,size1, type, r,g,b,a, drag, grav, rot
    this.out = new Float32Array(MAX * 10);
  }
  add(o) {
    if (this.n >= MAX) return;
    const i = this.n++ * 16, p = this.p;
    p[i] = o.x; p[i + 1] = o.y; p[i + 2] = o.vx || 0; p[i + 3] = o.vy || 0;
    p[i + 4] = o.life; p[i + 5] = o.life;
    p[i + 6] = o.size; p[i + 7] = o.size1 != null ? o.size1 : o.size;
    p[i + 8] = o.type || 0;
    p[i + 9] = o.r; p[i + 10] = o.g; p[i + 11] = o.b; p[i + 12] = o.a != null ? o.a : 1;
    p[i + 13] = o.drag != null ? o.drag : 0.5; p[i + 14] = o.grav || 0; p[i + 15] = o.rot || 0;
  }
  ring(x, y, s0, s1, life, r, g, b, a = 1) { this.add({ x, y, life, size: s0, size1: s1, type: 1, r, g, b, a, drag: 0 }); }
  spark(x, y, speed, life, r, g, b, size = 0.09, type = 3) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
    this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, size, type, r, g, b, a: 1, drag: 1.6, rot: Math.random() * 3 });
  }
  burstSpectrum(x, y, count, speed, life, gain = 1.0) {
    for (let i = 0; i < count; i++) {
      const c = BIN_RGB[Math.floor(Math.random() * NB)];
      this.spark(x, y, speed, life * (0.6 + Math.random() * 0.6), c[0] * gain, c[1] * gain, c[2] * gain, 0.05 + Math.random() * 0.07, Math.random() < 0.6 ? 3 : 0);
    }
  }
  update(dt) {
    const p = this.p;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 16;
      p[o + 4] -= dt;
      if (p[o + 4] <= 0) continue;
      const drag = Math.exp(-p[o + 13] * dt);
      p[o + 2] *= drag; p[o + 3] = p[o + 3] * drag + p[o + 14] * dt;
      p[o] += p[o + 2] * dt; p[o + 1] += p[o + 3] * dt;
      if (w !== i) p.copyWithin(w * 16, o, o + 16);
      w++;
    }
    this.n = w;
  }
  // スプライト配列へ書き出し
  fill() {
    const p = this.p, out = this.out;
    for (let i = 0; i < this.n; i++) {
      const o = i * 16, q = i * 10;
      const k = 1 - p[o + 4] / p[o + 5];
      const type = p[o + 8];
      const fade = type === 1 ? (1 - k) * (1 - k) : (1 - k);
      out[q] = p[o]; out[q + 1] = p[o + 1];
      out[q + 2] = p[o + 6] + (p[o + 7] - p[o + 6]) * (type === 1 ? 1 - (1 - k) * (1 - k) : k);
      out[q + 3] = type;
      out[q + 4] = p[o + 9]; out[q + 5] = p[o + 10]; out[q + 6] = p[o + 11]; out[q + 7] = p[o + 12] * fade;
      out[q + 8] = p[o + 15]; out[q + 9] = k;
    }
    return this.n;
  }
}
