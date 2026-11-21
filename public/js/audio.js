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

  /** Keep the WebAudio listener on the camera so positional sounds come from the right place. */
  setListener(pos, fwd, up) {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setValueAtTime(pos.x, t);
      L.positionY.setValueAtTime(pos.y, t);
      L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fwd.x, t);
      L.forwardY.setValueAtTime(fwd.y, t);
      L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(up.x, t);
      L.upY.setValueAtTime(up.y, t);
      L.upZ.setValueAtTime(up.z, t);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /**
   * Target-spawn cue played from the target's position (HRTF), so you can hear which way to
   * flick, even behind you. Sounds from behind are slightly muffled to help front/back.
   */
  spawnCue(pos, behind = false) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 8;
    panner.rolloffFactor = 0.5;
    if (panner.positionX) {
      panner.positionX.setValueAtTime(pos.x, t);
      panner.positionY.setValueAtTime(pos.y, t);
      panner.positionZ.setValueAtTime(pos.z, t);
    } else {
      panner.setPosition(pos.x, pos.y, pos.z);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = behind ? 2200 : 12000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    g.connect(filter).connect(panner).connect(this.master);
    for (const [type, f0, f1] of [['triangle', 1500, 1100], ['sine', 750, 560]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.22);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.28);
    }
    // short noise transient gives the ear a sharp onset to localise
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(ng).connect(filter);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.05);
  }

  /** Skin kill sounds (the "first kill" sound of each original skin). Returns false if unknown. */
  skinKill(id) {
    const ctx = this.ensure();
    if (!ctx || !this.hitSounds) return true;
    const t = ctx.currentTime;
    const env = (node, peak, attack, decay, delay = 0) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(peak, t + delay + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + attack + decay);
      node.connect(g).connect(this.master);
      return g;
    };
    const osc = (type, f0, f1, dur, delay = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + delay);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
      o.start(t + delay);
      o.stop(t + delay + dur + 0.05);
      return o;
    };
    const noise = (dur, delay = 0) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.start(t + delay, Math.random() * 0.5);
      s.stop(t + delay + dur + 0.05);
      return s;
    };
    switch (id) {
      case 'pulse': {
        // digital ascend: three quick square blips over a rising sweep
        [660, 990, 1320].forEach((f, i) => env(osc('square', f, null, 0.06, i * 0.055), 0.06, 0.004, 0.07, i * 0.055));
        env(osc('sine', 400, 2400, 0.26), 0.08, 0.01, 0.26);
        return true;
      }
      case 'verdant': {
        // bloom chime: two soft bells, a leafy rustle and a wooden knock
        env(osc('sine', 1318.5, null, 0.8), 0.12, 0.012, 0.75);
        env(osc('sine', 1975.5, null, 0.8, 0.07), 0.09, 0.012, 0.7, 0.07);
        const rustle = ctx.createBiquadFilter();
        rustle.type = 'bandpass';
        rustle.frequency.value = 3200;
        rustle.Q.value = 1.2;
        noise(0.18).connect(rustle);
        env(rustle, 0.12, 0.01, 0.16);
        env(osc('triangle', 190, 120, 0.09), 0.18, 0.003, 0.09);
        return true;
      }
      case 'gilt': {
        // gilded bell: FM synthesis with a decaying modulation index, plus a high partial
        const carrier = osc('sine', 880, null, 1.1);
        const mod = osc('sine', 880 * 1.4, null, 1.1);
        const idx = ctx.createGain();
        idx.gain.setValueAtTime(900, t);
        idx.gain.exponentialRampToValueAtTime(20, t + 1.0);
        mod.connect(idx).connect(carrier.frequency);
        env(carrier, 0.14, 0.004, 1.05);
        env(osc('sine', 2640, null, 0.6), 0.04, 0.004, 0.55);
        return true;
      }
      case 'wraith': {
        // spectral whisper: swelling noise swept through a resonant band, over a low detuned drone
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 6;
        bp.frequency.setValueAtTime(400, t);
        bp.frequency.exponentialRampToValueAtTime(2500, t + 0.3);
        bp.frequency.exponentialRampToValueAtTime(600, t + 0.65);
        noise(0.7).connect(bp);
        env(bp, 0.5, 0.25, 0.4);
        env(osc('sawtooth', 110, 82, 0.7), 0.05, 0.12, 0.55);
        env(osc('sawtooth', 113, 84, 0.7), 0.05, 0.12, 0.55);
        return true;
      }
      default:
        return false;
    }
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
