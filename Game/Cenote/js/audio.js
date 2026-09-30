// 洞窟の環境音（すべて WebAudio で合成。音源ファイルなし）
export class CaveAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.underwater = false;
    this.started = false;
    this.nextBird = 5;
    this.nextBubble = 2;
    this.t = 0;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.started = true;
    const sr = ctx.sampleRate;

    // マスター：水中では高域をカット
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.lp.Q.value = 0.4;
    this.lp.connect(this.master);
    this.master.connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 4);

    // 残響（合成インパルス応答）
    const irLen = Math.floor(sr * 4.2);
    const ir = ctx.createBuffer(2, irLen, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lpState = 0;
      for (let i = 0; i < irLen; i++) {
        const t = i / sr;
        const env = Math.pow(1 - i / irLen, 2.6) * Math.exp(-t * 0.9);
        lpState += (Math.random() * 2 - 1 - lpState) * (0.35 - 0.25 * (t / 4.2));
        d[i] = lpState * env * 2.2;
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet);
    this.wet.connect(this.lp);
    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.lp);

    // ノイズバッファ
    const mkNoise = (kind) => {
      const b = ctx.createBuffer(1, sr * 6, sr);
      const d = b.getChannelData(0);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
        else d[i] = w;
      }
      return b;
    };
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 3); return s; };

    // 1. ルームトーン（低いうなり）
    const brown = loop(mkNoise('brown'));
    const f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = 260;
    const g1 = ctx.createGain(); g1.gain.value = 0.4;
    brown.connect(f1); f1.connect(g1); g1.connect(this.dry); g1.connect(this.reverb);

    // 2. 水面のひたひた（振幅がゆっくり揺れる）
    const pink = loop(mkNoise('pink'));
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 850; f2.Q.value = 0.7;
    this.lapGain = ctx.createGain(); this.lapGain.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.035;
    lfo.connect(lfoG); lfoG.connect(this.lapGain.gain); lfo.start();
    pink.connect(f2); f2.connect(this.lapGain); this.lapGain.connect(this.dry); this.lapGain.connect(this.reverb);

    // 3. 天窓から吹き込む風の気配
    const white = loop(mkNoise('white'));
    const f3 = ctx.createBiquadFilter(); f3.type = 'bandpass'; f3.frequency.value = 2400; f3.Q.value = 0.9;
    const g3 = ctx.createGain(); g3.gain.value = 0.006;
    const lfo3 = ctx.createOscillator(); lfo3.frequency.value = 0.07;
    const lfo3g = ctx.createGain(); lfo3g.gain.value = 0.004;
    lfo3.connect(lfo3g); lfo3g.connect(g3.gain); lfo3.start();
    white.connect(f3); f3.connect(g3); g3.connect(this.reverb);

    this.noiseBuf = mkNoise('white');
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.15);
  }

  setUnderwater(u) {
    if (!this.started || u === this.underwater) return;
    this.underwater = u;
    const t = this.ctx.currentTime;
    this.lp.frequency.cancelScheduledValues(t);
    this.lp.frequency.setTargetAtTime(u ? 420 : 20000, t, u ? 0.06 : 0.12);
    this.wet.gain.setTargetAtTime(u ? 0.85 : 0.55, t, 0.2);
    this.splash(0.5);
  }

  // 水滴
  drip(pan = 0, vol = 0.5) {
    if (!this.started || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 900 + Math.random() * 1300;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.35, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.22);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); o.connect(g); g.connect(p); p.connect(this.dry); p.connect(this.reverb); }
    else { o.connect(g); g.connect(this.dry); g.connect(this.reverb); }
    o.start(t); o.stop(t + 0.3);
  }

  splash(vol = 0.5) {
    if (!this.started || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.5); f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    s.connect(f); f.connect(g); g.connect(this.dry); g.connect(this.reverb);
    s.start(t, Math.random() * 4, 0.8);
  }

  bird() {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05;
    const n = 2 + ((Math.random() * 3) | 0);
    const base = 2600 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.13 + Math.random() * 0.05);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.3), t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.11);
      o.connect(g); g.connect(this.reverb);
      const dry = ctx.createGain(); dry.gain.value = 0.25; g.connect(dry); dry.connect(this.dry);
      o.start(t); o.stop(t + 0.15);
    }
  }

  bubble() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    const f0 = 250 + Math.random() * 350;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.2, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
    o.connect(g); g.connect(this.dry); g.connect(this.reverb);
    o.start(t); o.stop(t + 0.2);
  }

  update(dt) {
    if (!this.started) return;
    this.t += dt;
    this.nextBird -= dt;
    if (this.nextBird <= 0 && !this.underwater) {
      this.bird();
      this.nextBird = 6 + Math.random() * 12;
    }
    if (this.underwater) {
      this.nextBubble -= dt;
      if (this.nextBubble <= 0) { this.bubble(); this.nextBubble = 1.2 + Math.random() * 3.5; }
    }
  }
}
