/** All sounds are synthesised with WebAudio, so there are no audio files to ship. */
export class AudioFX {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.hitSounds = true;
    this.footsteps = true;
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  configure(s) {
    this.volume = s.volume;
    this.hitSounds = s.hitSounds;
    this.footsteps = s.footsteps;
    if (this.master) this.master.gain.value = s.volume;
  }

  tone(freq, dur, { type = 'sine', vol = 0.25, delay = 0, to = null } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.3, freq = 1200, type = 'lowpass', q = 0.8, delay = 0 } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  shot(kind) {
    if (kind === 'sniper') {
      this.noise(0.45, { vol: 0.55, freq: 900 });
      this.tone(90, 0.35, { type: 'triangle', vol: 0.5, to: 40 });
    } else if (kind === 'precision') {
      this.noise(0.05, { vol: 0.12, freq: 3000, type: 'bandpass' });
    } else {
      this.noise(0.16, { vol: 0.35, freq: 1800 });
      this.tone(140, 0.1, { type: 'triangle', vol: 0.3, to: 60 });
    }
  }

  hit(zone) {
    if (!this.hitSounds) return;
    if (zone === 'head') this.tone(1650, 0.14, { type: 'sine', vol: 0.22, to: 1400 });
    else this.noise(0.05, { vol: 0.25, freq: 2500, type: 'bandpass', q: 2 });
  }

  kill(head) {
    if (!this.hitSounds) return;
    this.tone(head ? 1320 : 880, 0.09, { type: 'square', vol: 0.08 });
    this.tone(head ? 1760 : 1175, 0.12, { type: 'square', vol: 0.08, delay: 0.07 });
  }

  step() {
    if (!this.footsteps) return;
    this.noise(0.08, { vol: 0.22, freq: 380, q: 1.2 });
  }

  /** Jump take-off: a short shoe scuff, lighter than a landing. */
  jump() {
    if (!this.footsteps) return;
    this.noise(0.07, { vol: 0.2, freq: 700, type: 'bandpass', q: 1.4 });
    this.noise(0.05, { vol: 0.12, freq: 260, delay: 0.01 });
  }

  land() {
    if (!this.footsteps) return;
    this.noise(0.14, { vol: 0.3, freq: 300 });
  }

  beep(high) {
    this.tone(high ? 1046 : 523, high ? 0.25 : 0.12, { type: 'triangle', vol: 0.22 });
  }

  good() {
    this.tone(660, 0.08, { type: 'triangle', vol: 0.15 });
    this.tone(990, 0.12, { type: 'triangle', vol: 0.15, delay: 0.06 });
  }

  bad() {
    this.tone(220, 0.22, { type: 'sawtooth', vol: 0.1, to: 140 });
  }

  enemyShot() {
    this.noise(0.12, { vol: 0.25, freq: 1400, delay: 0 });
  }

  death() {
    this.tone(300, 0.5, { type: 'sawtooth', vol: 0.12, to: 70 });
  }
}
