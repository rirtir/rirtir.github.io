// SYNESTHESIA — ゲーム進行（判定・スコア・ホールド・オート）
import { clamp } from './util.js';

export const WIN = { perfect: 0.05, great: 0.1, good: 0.15 };
const W_SCORE = [1, 0.7, 0.4];   // PERFECT / GREAT / GOOD
export const JUDGE_NAME = ['PERFECT', 'GREAT', 'GOOD', 'MISS'];

// state: 0 待機 / 1 判定済(タップ) / 2 ホールド中 / 3 ホールド成功 / 4 見逃し / 5 ホールド途中離し
export class Game {
  constructor(chart, opts = {}) {
    this.notes = chart.notes.map((n, i) => ({ t: n.t, lane: n.lane, dur: n.dur, id: i, state: 0, judge: -1, hitT: 0, headW: 0, tickAcc: 0 }));
    this.N = this.notes.length;
    this.auto = !!opts.auto;
    this.noFail = opts.noFail !== false;
    this.onEvent = opts.onEvent || (() => { });
    this.offset = (opts.offset || 0) / 1000;   // 入力時刻の補正（正: 遅れ気味の入力を戻す）
    this.i0 = 0;                                // 画面内に残っている最初のノーツ
    this.laneQ = [[], [], [], []];              // レーンごとの未処理ノーツ index
    this.notes.forEach((n, i) => this.laneQ[n.lane].push(i));
    this.qi = [0, 0, 0, 0];
    this.holding = [-1, -1, -1, -1];
    this.pressed = [false, false, false, false];
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.counts = [0, 0, 0, 0];  // P, G, Gd, Miss
    this.early = 0; this.late = 0;
    this.breaks = 0;
    this.gauge = 0.5;
    this.failed = false;
    this.weight = 0;             // 判定の累計重み
    this.log = [];               // {t, d(ms), j, lane}
    this.autoIdx = 0;
    this.finished = false;
    this.lastEnd = this.notes.length ? Math.max(...this.notes.map(n => n.t + n.dur)) : 0;
    this.rng = 12345;
  }

  // t より前のノーツを処理済みにして、そこから始める（背景デモ用）
  seek(t) {
    let i = 0;
    while (i < this.N && this.notes[i].t < t - 0.1) {
      const n = this.notes[i];
      n.state = n.dur > 0 ? 3 : 1;
      i++;
    }
    for (let k = i; k < this.N; k++) { const n = this.notes[k]; n.state = 0; n.judge = -1; }
    this.i0 = i; this.autoIdx = i;
    for (let l = 0; l < 4; l++) {
      const q = this.laneQ[l];
      let qi = 0; while (qi < q.length && q[qi] < i) qi++;
      this.qi[l] = qi; this.holding[l] = -1; this.pressed[l] = false;
    }
    this.finished = false;
  }

  get accuracy() { return this.N ? this.weight / this.N : 1; }
  // 判定済みノーツに対する正答率（プレイ中の表示用）
  get liveAcc() {
    const j = this.counts[0] + this.counts[1] + this.counts[2] + this.counts[3];
    if (!j) return 1;
    let w = this.weight;
    for (let l = 0; l < 4; l++) { const hi = this.holding[l]; if (hi >= 0) w += this.notes[hi].headW * 0.5; }   // 保持中のホールドは満点見込み
    return Math.min(1, w / j);
  }
  get displayScore() { return Math.round(this.N ? 1e6 * this.weight / this.N : 0); }

  _emit(type, data) { this.onEvent(type, data); }

  _judgeNote(n, d, lane) {
    const ad = Math.abs(d);
    const j = ad <= WIN.perfect ? 0 : ad <= WIN.great ? 1 : 2;
    n.judge = j; n.hitT = n.t + d;
    this.counts[j]++;
    const w = W_SCORE[j];
    n.headW = w;
    this.weight += (n.dur > 0 ? w * 0.5 : w);
    this.combo++; if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    if (j === 0) this.gauge = Math.min(1, this.gauge + 0.018); else if (j === 1) this.gauge = Math.min(1, this.gauge + 0.01); else this.gauge = Math.min(1, this.gauge + 0.003);
    if (j > 0) { if (d < 0) this.early++; else this.late++; }
    this.log.push({ t: n.t, d: d * 1000, j, lane });
    this._emit('hit', { note: n, judge: j, delta: d, lane });
  }
  _miss(n) {
    n.state = 4; n.judge = 3;
    this.counts[3]++;
    this.combo = 0;
    this.gauge = Math.max(0, this.gauge - (n.dur > 0 ? 0.07 : 0.055));
    this.log.push({ t: n.t, d: 0, j: 3, lane: n.lane });
    this._emit('miss', { note: n, lane: n.lane });
    if (!this.noFail && this.gauge <= 0 && !this.failed) { this.failed = true; this._emit('fail', {}); }
  }

  // 押下（t: 曲時刻[秒]）
  press(lane, tRaw) {
    if (this.finished || !Number.isFinite(tRaw)) return;
    this.pressed[lane] = true;
    const t = tRaw - this.offset;
    const q = this.laneQ[lane];
    let qi = this.qi[lane];
    // 判定窓に入っている最初の未処理ノーツ
    let best = -1, bd = 0;
    for (let k = qi; k < q.length; k++) {
      const n = this.notes[q[k]];
      if (n.state !== 0) continue;
      const d = t - n.t;
      if (d < -WIN.good) break;
      if (d > WIN.good) continue;
      best = q[k]; bd = d; break;
    }
    if (best < 0) { this._emit('empty', { lane }); return; }
    const n = this.notes[best];
    this._judgeNote(n, bd, lane);
    if (n.dur > 0) { n.state = 2; this.holding[lane] = best; n.tickAcc = 0; } else n.state = 1;
  }

  release(lane, tRaw) {
    if (this.finished || !Number.isFinite(tRaw)) return;
    this.pressed[lane] = false;
    const hi = this.holding[lane];
    if (hi < 0) return;
    const n = this.notes[hi];
    const t = tRaw - this.offset;
    this._endHold(n, lane, t);
  }
  _endHold(n, lane, t) {
    const end = n.t + n.dur;
    this.holding[lane] = -1;
    if (t >= end - 0.18) {
      n.state = 3;
      this.weight += n.headW * 0.5;
      this.gauge = Math.min(1, this.gauge + 0.012);
      this._emit('holdEnd', { note: n, lane, ok: true });
    } else {
      n.state = 5; this.breaks++;
      this.combo = 0;
      this.gauge = Math.max(0, this.gauge - 0.035);
      this._emit('holdEnd', { note: n, lane, ok: false });
      if (!this.noFail && this.gauge <= 0 && !this.failed) { this.failed = true; this._emit('fail', {}); }
    }
  }

  // 毎フレーム（t: 曲時刻）
  update(t) {
    // オート
    if (this.auto) {
      while (this.autoIdx < this.N && this.notes[this.autoIdx].t <= t - this.offset) {
        const n = this.notes[this.autoIdx++];
        const jit = ((this.rng = (this.rng * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.02;
        if (n.state === 0) {
          this.pressed[n.lane] = true;
          this._judgeNote(n, jit, n.lane);
          if (n.dur > 0) { n.state = 2; this.holding[n.lane] = n.id; } else { n.state = 1; n.autoRel = n.t + 0.07; }
          this._emit('autoPress', { lane: n.lane });
        }
      }
      for (let l = 0; l < 4; l++) {
        const hi = this.holding[l];
        if (hi >= 0) { const n = this.notes[hi]; if (t >= n.t + n.dur) { this.pressed[l] = false; this._endHold(n, l, n.t + n.dur); } }
        else if (this.pressed[l]) {
          // タップの押下を短く見せる
          let keep = false;
          for (let k = Math.max(0, this.autoIdx - 6); k < this.autoIdx; k++) { const n = this.notes[k]; if (n.lane === l && n.dur === 0 && t < n.autoRel) keep = true; }
          if (!keep) this.pressed[l] = false;
        }
      }
    }
    const tt = t - this.offset;
    // ホールド: 押したまま終端に達したら成功。離れていたら終了処理
    for (let l = 0; l < 4; l++) {
      const hi = this.holding[l];
      if (hi < 0) continue;
      const n = this.notes[hi];
      if (!this.pressed[l]) this._endHold(n, l, tt);
      else if (tt >= n.t + n.dur) this._endHold(n, l, n.t + n.dur);
    }
    // 見逃し判定
    for (let l = 0; l < 4; l++) {
      const q = this.laneQ[l];
      let qi = this.qi[l];
      while (qi < q.length) {
        const n = this.notes[q[qi]];
        if (n.state === 0) {
          if (tt - n.t > WIN.good) { this._miss(n); qi++; continue; }
          break;
        }
        qi++;
      }
      this.qi[l] = qi;
    }
    // 画面外に出たものを i0 から外す
    while (this.i0 < this.N) {
      const n = this.notes[this.i0];
      const endT = n.t + n.dur;
      if (n.state === 0 || n.state === 2) break;
      if (t - endT > 0.9) this.i0++; else break;
    }
    if (!this.finished && t > this.lastEnd + 1.2) { this.finished = true; this._emit('finish', {}); }
  }

  // ポーズ時：押下中のホールドを罰則なしで閉じる
  suspendHolds() {
    for (let l = 0; l < 4; l++) {
      this.pressed[l] = false;
      const hi = this.holding[l];
      if (hi >= 0) { const n = this.notes[hi]; n.state = 3; this.weight += n.headW * 0.5; this.holding[l] = -1; }
    }
  }
  // 曲の終端で未処理のものを確定させる
  finalize() {
    for (let l = 0; l < 4; l++) if (this.holding[l] >= 0) { const n = this.notes[this.holding[l]]; this._endHold(n, l, n.t + n.dur); }
    for (const n of this.notes) if (n.state === 0) this._miss(n);
    this.finished = true;
  }

  rank() {
    const a = this.accuracy;
    return a >= 0.96 ? 'S' : a >= 0.9 ? 'A' : a >= 0.8 ? 'B' : a >= 0.65 ? 'C' : 'D';
  }
  badge() {
    if (this.counts[3] === 0 && this.breaks === 0) return this.counts[1] === 0 && this.counts[2] === 0 ? 'ALL PERFECT' : 'FULL COMBO';
    return '';
  }
}
