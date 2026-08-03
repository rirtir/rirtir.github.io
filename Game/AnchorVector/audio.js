const TAU = Math.PI * 2;

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.musicFilter = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.mode = 'hangar';
    this.flow = 0;
    this.enabled = true;
    this.volumes = { master: 0.75, music: 0.42, sfx: 0.78 };
    this.step = 0;
    this.nextStepAt = 0;
    this.timer = 0;
    this.activeNodes = new Set();
    this.boundVisibility = () => this.handleVisibility();
  }

  async unlock() {
    if (!this.context) this.createContext();
    if (!this.context) return false;
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.timer) {
      this.nextStepAt = this.context.currentTime + 0.05;
      this.timer = window.setInterval(() => this.scheduleMusic(), 80);
    }
    return this.context.state === 'running';
  }

  createContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass({ latencyHint: 'interactive' });
    const ctx = this.context;
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicFilter = ctx.createBiquadFilter();
    this.compressor = ctx.createDynamicsCompressor();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 11000;
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 14;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;
    this.musicBus.connect(this.musicFilter).connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(this.compressor).connect(ctx.destination);
    this.noiseBuffer = this.makeNoiseBuffer(1.5);
    this.applyVolumes(true);
    document.addEventListener('visibilitychange', this.boundVisibility);
  }

  makeNoiseBuffer(seconds) {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.86 + white * 0.14;
      data[i] = last * 0.72;
    }
    return buffer;
  }

  applyVolumes(immediate = false) {
    if (!this.context) return;
    const t = this.context.currentTime;
    const method = immediate ? 'setValueAtTime' : 'linearRampToValueAtTime';
    this.master.gain.cancelScheduledValues(t);
    this.musicBus.gain.cancelScheduledValues(t);
    this.sfxBus.gain.cancelScheduledValues(t);
    if (immediate) {
      this.master.gain.setValueAtTime(this.enabled ? this.volumes.master : 0, t);
      this.musicBus.gain.setValueAtTime(this.volumes.music, t);
      this.sfxBus.gain.setValueAtTime(this.volumes.sfx, t);
    } else {
      this.master.gain[method](this.enabled ? this.volumes.master : 0, t + 0.08);
      this.musicBus.gain[method](this.volumes.music, t + 0.08);
      this.sfxBus.gain[method](this.volumes.sfx, t + 0.08);
    }
  }

  setVolume(channel, value) {
    if (!(channel in this.volumes)) return;
    this.volumes[channel] = Math.max(0, Math.min(1, Number(value) || 0));
    this.applyVolumes();
  }

  setEnabled(enabled) {
    const wasEnabled = this.enabled;
    this.enabled = Boolean(enabled);
    if (!wasEnabled && this.enabled && this.context) this.nextStepAt = this.context.currentTime + 0.05;
    this.applyVolumes();
  }

  setMode(mode) {
    if (!['hangar', 'combat', 'boss', 'ending'].includes(mode)) return;
    this.mode = mode;
  }

  setFlow(value) {
    this.flow = Math.max(0, Math.min(100, value || 0));
  }

  setPlanning(active) {
    if (!this.context) return;
    const t = this.context.currentTime;
    this.musicFilter.frequency.cancelScheduledValues(t);
    this.musicFilter.frequency.linearRampToValueAtTime(active ? 950 : 11000, t + (active ? 0.12 : 0.28));
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.linearRampToValueAtTime(this.volumes.music * (active ? 0.72 : 1), t + 0.14);
  }

  scheduleMusic() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.enabled) {
      this.nextStepAt = ctx.currentTime + 0.05;
      return;
    }
    const bpm = this.mode === 'boss' ? 108 : this.mode === 'combat' ? 92 : this.mode === 'ending' ? 72 : 78;
    const stepDuration = 60 / bpm / 4;
    while (this.nextStepAt < ctx.currentTime + 0.35) {
      this.scheduleStep(this.step, this.nextStepAt, stepDuration);
      this.step = (this.step + 1) % 64;
      this.nextStepAt += stepDuration;
    }
  }

  scheduleStep(step, time, stepDuration) {
    const scale = this.mode === 'boss' ? [38, 41, 43, 45, 48] : this.mode === 'ending' ? [45, 48, 52, 55, 57] : [40, 43, 45, 47, 50];
    const barStep = step % 16;
    const root = this.mode === 'hangar' ? scale[(Math.floor(step / 16) + 1) % 3] : scale[Math.floor(step / 16) % 4];

    if (barStep === 0 || (this.mode !== 'hangar' && barStep === 8)) {
      this.tone(midi(root - 12), time, stepDuration * 5.6, 0.055, 'sine', this.musicBus, -0.002);
      this.tone(midi(root), time, stepDuration * 1.8, 0.035, 'triangle', this.musicBus, -0.01);
    }

    if (this.mode !== 'hangar' && [0, 3, 6, 10, 12].includes(barStep)) {
      const note = scale[(step + barStep) % scale.length] + (barStep % 2 ? 12 : 0);
      this.fmTone(midi(note), time, stepDuration * 1.25, 0.024 + this.flow / 8000);
    }

    if (this.flow >= 25 && barStep % 2 === 0) this.noiseTick(time, 0.018, 6400, 0.018);
    if (this.flow >= 50 && [2, 7, 11, 14].includes(barStep)) {
      const note = scale[(barStep + Math.floor(step / 16)) % scale.length] + 12;
      this.tone(midi(note), time, stepDuration * 0.7, 0.017, 'sine', this.musicBus, 0.03);
    }
    if (this.flow >= 75 && barStep % 2 === 1) this.noiseTick(time, 0.012, 9800, 0.012);
    if (this.mode === 'boss' && [0, 4, 8, 12].includes(barStep)) this.kick(time, 0.06);
  }

  tone(frequency, time, duration, volume, wave = 'sine', destination = this.sfxBus, detune = 0) {
    if (!this.context || !destination) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.detune.setValueAtTime(detune * 100, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain).connect(destination);
    this.track(oscillator, gain, time, duration);
  }

  fmTone(frequency, time, duration, volume) {
    const ctx = this.context;
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const gain = ctx.createGain();
    carrier.type = 'sine';
    modulator.type = 'sine';
    carrier.frequency.value = frequency;
    modulator.frequency.value = frequency * 2.01;
    modGain.gain.value = frequency * 0.45;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    modulator.connect(modGain).connect(carrier.frequency);
    carrier.connect(gain).connect(this.musicBus);
    carrier.start(time);
    modulator.start(time);
    carrier.stop(time + duration + 0.03);
    modulator.stop(time + duration + 0.03);
  }

  noiseTick(time, duration, frequency, volume, destination = this.musicBus) {
    if (!this.context || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(time, Math.random() * 0.8, duration + 0.01);
  }

  kick(time, volume) {
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.setValueAtTime(92, time);
    oscillator.frequency.exponentialRampToValueAtTime(38, time + 0.13);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    oscillator.connect(gain).connect(this.musicBus);
    this.track(oscillator, gain, time, 0.18);
  }

  track(source, gain, time, duration) {
    this.activeNodes.add(source);
    source.onended = () => {
      this.activeNodes.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(time);
    source.stop(time + duration + 0.04);
  }

  sfx(name, intensity = 1) {
    if (!this.context || this.context.state !== 'running' || !this.enabled) return;
    const now = this.context.currentTime;
    const level = Math.max(0.25, Math.min(1.5, intensity));
    switch (name) {
      case 'confirm':
        this.tone(520, now, 0.08, 0.055 * level, 'sine');
        this.tone(780, now + 0.045, 0.11, 0.045 * level, 'sine');
        break;
      case 'cancel':
        this.tone(350, now, 0.12, 0.045 * level, 'triangle');
        break;
      case 'warning':
        this.tone(160, now, 0.09, 0.07 * level, 'square');
        this.tone(160, now + 0.13, 0.09, 0.06 * level, 'square');
        break;
      case 'snap':
        this.tone(940, now, 0.045, 0.035 * level, 'sine');
        break;
      case 'route':
        this.noiseTick(now, 0.13, 2200, 0.06 * level, this.sfxBus);
        this.tone(180, now, 0.18, 0.06 * level, 'sawtooth', this.sfxBus, 0.02);
        break;
      case 'slash':
        this.noiseTick(now, 0.11, 1500, 0.12 * level, this.sfxBus);
        this.pitchDrop(now, 720, 210, 0.13, 0.075 * level);
        break;
      case 'critical':
        this.noiseTick(now, 0.16, 2400, 0.16 * level, this.sfxBus);
        this.pitchDrop(now, 1100, 260, 0.18, 0.11 * level);
        this.tone(1320, now + 0.04, 0.12, 0.06 * level, 'sine');
        break;
      case 'hit':
        this.noiseTick(now, 0.24, 330, 0.18 * level, this.sfxBus);
        this.pitchDrop(now, 150, 48, 0.26, 0.13 * level);
        break;
      case 'break':
        [860, 610, 430].forEach((frequency, i) => this.tone(frequency, now + i * 0.035, 0.14, 0.052 * level, 'triangle'));
        this.noiseTick(now, 0.18, 1900, 0.1 * level, this.sfxBus);
        break;
      case 'seal':
        [220, 330, 440, 660].forEach((frequency, i) => this.tone(frequency, now + i * 0.035, 0.3, 0.045 * level, 'sine'));
        break;
      case 'overtrace':
        this.pitchRise(now, 95, 1240, 0.5, 0.14 * level);
        this.noiseTick(now + 0.2, 0.32, 1300, 0.13 * level, this.sfxBus);
        break;
      case 'victory':
        [330, 440, 554, 660].forEach((frequency, i) => this.tone(frequency, now + i * 0.12, 0.55, 0.07, 'sine'));
        break;
      case 'defeat':
        [300, 230, 160].forEach((frequency, i) => this.tone(frequency, now + i * 0.16, 0.45, 0.07, 'triangle'));
        break;
      case 'unlock':
        [520, 650, 780, 1040].forEach((frequency, i) => this.tone(frequency, now + i * 0.065, 0.36, 0.05, 'sine'));
        break;
      default:
        this.tone(440, now, 0.06, 0.03, 'sine');
    }
  }

  pitchDrop(time, start, end, duration, volume) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(start, time);
    oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain).connect(this.sfxBus);
    this.track(oscillator, gain, time, duration);
  }

  pitchRise(time, start, end, duration, volume) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(start, time);
    oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + duration * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain).connect(this.sfxBus);
    this.track(oscillator, gain, time, duration);
  }

  async handleVisibility() {
    if (!this.context) return;
    if (document.hidden && this.context.state === 'running') await this.context.suspend();
  }

  async resume() {
    if (this.context && this.context.state === 'suspended' && !document.hidden) {
      await this.context.resume();
      this.nextStepAt = this.context.currentTime + 0.05;
    }
  }

  destroy() {
    window.clearInterval(this.timer);
    this.timer = 0;
    document.removeEventListener('visibilitychange', this.boundVisibility);
    for (const node of this.activeNodes) {
      try { node.stop(); } catch (_) { /* already stopped */ }
    }
    this.activeNodes.clear();
    if (this.context) this.context.close();
    this.context = null;
  }
}

function midi(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

export default AudioEngine;
