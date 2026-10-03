// SYNESTHESIA — オーディオ再生と効果音
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.src = null;
    this.buffer = null;
    this.startCtx = 0;      // 曲の位置 startPos が ctx.currentTime のどこに対応するか（= 曲0秒の ctx 時刻）
    this.playing = false;
    this.pausePos = 0;
    this.musicVol = 0.9; this.sfxVol = 0.6; this.sfxOn = true;
    this._anchor = { perf: 0, song: 0 };
    this.est = 0;           // 平滑化した曲時刻
    this._lastPerf = 0;
    this.ended = false;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => { }); return this.ctx; }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* iOS: マナーモードでも鳴らす */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 1;
    this.musicG = c.createGain(); this.musicG.gain.value = this.musicVol;
    this.sfxG = c.createGain(); this.sfxG.gain.value = this.sfxVol;
    this.previewG = c.createGain(); this.previewG.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -6; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.12; comp.knee.value = 6;
    this.musicG.connect(this.master); this.sfxG.connect(this.master); this.previewG.connect(this.master);
    this.master.connect(comp); comp.connect(c.destination);
    // 無音ノイズ（ごく短い）用バッファ
    const nb = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    return c;
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (this.ctx) { this.musicG.gain.value = music; this.sfxG.gain.value = sfx; }
  }

  makeBuffer(left, right, sr) {
    this.ensure();
    const b = this.ctx.createBuffer(2, left.length, sr);
    b.copyToChannel(left, 0); b.copyToChannel(right, 1);
    return b;
  }

  async decode(arrayBuffer) {
    this.ensure();
    return await new Promise((res, rej) => {
      const p = this.ctx.decodeAudioData(arrayBuffer, res, rej);
      if (p && p.catch) p.catch(rej);
    });
  }

  // ---- 曲の再生 ----
  start(buffer, pos = 0, delay = 0.12) {
    this.ensure();
    this.stop();
    this.buffer = buffer;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buffer; src.connect(this.musicG);
    const when = c.currentTime + delay;
    src.start(when, Math.max(0, pos));
    this.startCtx = when - pos;
    this.src = src;
    this.playing = true; this.ended = false;
    src.onended = () => { if (this.src === src) { this.ended = true; } };
    this.est = pos - delay;
    this._lastPerf = performance.now();
    this._syncAnchor(true);
    return this;
  }
  stop() {
    if (this.src) { try { this.src.onended = null; this.src.stop(); } catch (e) { /* */ } this.src.disconnect(); this.src = null; }
    this.playing = false;
  }
  pause() {
    if (!this.playing) return this.pausePos;
    this.pausePos = this.raw();
    this.stop();
    return this.pausePos;
  }
  resume() { this.start(this.buffer, Math.max(0, this.pausePos - 0.0), 0.15); }

  // ctx の「いま耳に届いている」時刻（曲の秒）
  raw() {
    const c = this.ctx;
    let ct = c.currentTime;
    if (c.getOutputTimestamp) {
      const ts = c.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) ct = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      else ct = c.currentTime - (c.outputLatency || c.baseLatency || 0);
    } else ct = c.currentTime - (c.outputLatency || c.baseLatency || 0);
    return ct - this.startCtx;
  }
  _syncAnchor(snap) {
    const now = performance.now();
    const r = this.raw();
    if (snap) this.est = r;
    else {
      const dtp = (now - this._lastPerf) / 1000;
      this.est += dtp;
      const err = r - this.est;
      if (Math.abs(err) > 0.08) this.est = r; else this.est += err * 0.12;
    }
    this._lastPerf = now;
    this._anchor.perf = now; this._anchor.song = this.est;
  }
  // 毎フレーム呼ぶ。平滑化した曲時刻を返す
  tick() {
    if (!this.playing) return this.est;
    this._syncAnchor(false);
    return this.est;
  }
  // performance.now() 系の時刻（入力イベントの timeStamp）を曲時刻に変換
  songAt(perfMs) { return this._anchor.song + (perfMs - this._anchor.perf) / 1000; }

  // ---- プレビュー ----
  previewStart(buffer, from, len = 18) {
    this.ensure();
    this.previewStop(0.01);
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = buffer; src.connect(this.previewG);
    const t0 = c.currentTime + 0.02;
    this.previewG.gain.cancelScheduledValues(t0);
    this.previewG.gain.setValueAtTime(0, t0);
    this.previewG.gain.linearRampToValueAtTime(0.7, t0 + 0.8);
    this.previewG.gain.setValueAtTime(0.7, t0 + len - 1.2);
    this.previewG.gain.linearRampToValueAtTime(0, t0 + len);
    src.start(t0, Math.max(0, Math.min(from, buffer.duration - len - 0.1)), len);
    this._pv = src;
    src.onended = () => { if (this._pv === src) this._pv = null; };
  }
  previewStop(fade = 0.25) {
    if (!this._pv) return;
    const c = this.ctx, s = this._pv; this._pv = null;
    const t = c.currentTime;
    this.previewG.gain.cancelScheduledValues(t);
    this.previewG.gain.setValueAtTime(this.previewG.gain.value, t);
    this.previewG.gain.linearRampToValueAtTime(0, t + fade);
    try { s.stop(t + fade + 0.02); } catch (e) { /* */ }
  }

  // ---- 効果音 ----
  tone(freq, dur, vol, type = 'sine', when = 0, slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxG);
    o.start(t); o.stop(t + dur + 0.02);
  }
  hit(lane, judge) {
    if (!this.sfxOn || !this.ctx) return;
    // 判定が良いほど明るく
    const base = [523.25, 587.33, 659.25, 783.99][lane];
    if (judge === 0) { this.tone(base * 2, 0.13, 0.5, 'triangle'); this.tone(base * 4, 0.08, 0.2, 'sine'); }
    else if (judge === 1) { this.tone(base * 2, 0.11, 0.42, 'triangle'); }
    else { this.tone(base, 0.1, 0.35, 'triangle'); }
    // クリック感
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
    const g = c.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(f); f.connect(g); g.connect(this.sfxG); s.start(t, Math.random() * 0.3, 0.04);
  }
  miss() { if (!this.sfxOn || !this.ctx) return; this.tone(110, 0.18, 0.35, 'sine', 0, 0.6); }
  breakSfx() { if (!this.sfxOn || !this.ctx) return; this.tone(160, 0.2, 0.3, 'sawtooth', 0, 0.5); }
  ui(kind = 'tap') {
    if (!this.ctx) return;
    if (kind === 'tap') this.tone(880, 0.07, 0.25, 'sine');
    else if (kind === 'ok') { this.tone(660, 0.09, 0.25, 'sine'); this.tone(990, 0.14, 0.22, 'sine', 0.07); }
    else if (kind === 'back') this.tone(440, 0.09, 0.22, 'sine', 0, 0.8);
  }
  fanfare(rank) {
    if (!this.ctx) return;
    const notes = rank === 'S' ? [523, 659, 784, 1047, 1319] : rank === 'A' ? [523, 659, 784, 1047] : [440, 523, 659];
    notes.forEach((f, i) => this.tone(f, 0.5, 0.22, 'triangle', i * 0.11));
  }
}
