/**
 * InputProbe measures how mouse input and frames reach the page. It never changes aim.
 *
 * The System Check feeds it `pointerrawupdate` events as well, which arrive at the mouse's
 * own polling rate. That lets it tell a real delivery stall (the mouse kept sending, the
 * game's `mousemove` stream went quiet) from the player simply stopping. In a drill only
 * `mousemove` is sampled, so stalls there are a heuristic: a long gap with fast motion on
 * both sides of it.
 */

/** Gaps longer than this mean the mouse stopped, not that input was delayed. */
const MOTION_GAP_MS = 250;
/** A single event this large and 10x its neighbours is a spike, not a flick. */
const SPIKE_MIN = 400;
const SPIKE_RATIO = 10;
/** Raw events needed inside a mousemove gap to call it a confirmed stall. */
const RAW_IN_STALL = 3;

export const POLLING_STEPS = [125, 250, 500, 1000, 2000, 4000, 8000];

class Ring {
  constructor(size) {
    this.a = new Float32Array(size);
    this.n = 0;
    this.i = 0;
  }

  push(v) {
    this.a[this.i] = v;
    this.i = (this.i + 1) % this.a.length;
    if (this.n < this.a.length) this.n += 1;
  }

  /** Sorted copy of the stored values (order of arrival doesn't matter for these stats). */
  sorted() {
    return Array.from(this.a.subarray(0, this.n)).sort((x, y) => x - y);
  }
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)))] : 0);

function nearestPolling(hz) {
  let best = POLLING_STEPS[0];
  for (const s of POLLING_STEPS) if (Math.abs(Math.log(s / hz)) < Math.abs(Math.log(best / hz))) best = s;
  return best;
}

export class InputProbe {
  constructor() {
    this.reset();
  }

  reset() {
    this.lastFrame = null;
    this.frameEma = 0;
    this.frameTimes = new Ring(8192);
    this.frameTotal = 0;
    this.longestFrame = 0;

    this.moves = 0;
    this.fractional = 0;
    this.lastMoveAt = null;
    this.moveGaps = new Ring(8192);
    this.movesThisFrame = 0;
    this.prevMag = 0;
    this.magEma = 0;
    this.spikeCandidate = 0;
    this.spikes = 0;
    this.biggestSpike = 0;
    this.stalls = 0;
    this.longestStall = 0;

    this.delays = new Ring(8192);
    this.maxDelay = 0;

    this.rawSeen = false;
    this.raw = 0;
    this.lastRawAt = null;
    this.rawSinceMove = 0;
    this.rawGaps = new Ring(16384);

    this.clickDelays = [];
  }

  /** Every `mousemove` the game sees. */
  move(e) {
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    if (!dx && !dy) return;
    const t = e.timeStamp;
    const now = performance.now();
    this.moves += 1;
    this.movesThisFrame += 1;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) this.fractional += 1;

    const delay = now - t;
    if (delay >= 0 && delay < 1000) {
      this.delays.push(delay);
      if (delay > this.maxDelay) this.maxDelay = delay;
    }

    const mag = Math.hypot(dx, dy);
    // A spike is one event far bigger than both the event before and the event after it.
    if (this.spikeCandidate && mag * SPIKE_RATIO < this.spikeCandidate) {
      this.spikes += 1;
      this.biggestSpike = Math.max(this.biggestSpike, this.spikeCandidate);
    }

    let stalled = false;
    if (this.lastMoveAt != null) {
      const gap = t - this.lastMoveAt;
      if (gap > 0 && gap < MOTION_GAP_MS) {
        this.moveGaps.push(gap);
        if (this.isStall(gap, mag)) {
          stalled = true;
          this.stalls += 1;
          if (gap > this.longestStall) this.longestStall = gap;
        }
      }
    }
    // The first event after a stall carries the movement that piled up during it. That is the
    // stall showing, not a separate spike.
    this.spikeCandidate = !stalled && mag > SPIKE_MIN && mag > SPIKE_RATIO * Math.max(1, this.prevMag) ? mag : 0;
    this.lastMoveAt = t;
    this.rawSinceMove = 0;
    if (!this.spikeCandidate) this.magEma = this.magEma ? this.magEma + (mag - this.magEma) * 0.15 : mag;
    this.prevMag = mag;
  }

  isStall(gap, mag) {
    const frame = this.medianFrame || 16.7;
    if (gap < Math.max(2.5 * frame, 20)) return false;
    // With raw events we know the mouse kept reporting during the gap.
    if (this.rawSeen) return this.rawSinceMove >= RAW_IN_STALL;
    // Without them, require typical motion speed on both sides of the gap.
    return this.prevMag >= 0.5 * this.magEma && mag >= 0.5 * this.magEma && this.magEma > 2;
  }

  /** `pointerrawupdate` events, which arrive at the mouse's polling rate. */
  rawMove(e) {
    if (!e.movementX && !e.movementY) return;
    this.rawSeen = true;
    this.raw += 1;
    this.rawSinceMove += 1;
    const t = e.timeStamp;
    if (this.lastRawAt != null) {
      const gap = t - this.lastRawAt;
      if (gap > 0 && gap < 20) this.rawGaps.push(gap);
    }
    this.lastRawAt = t;
  }

  click(e) {
    const delay = performance.now() - e.timeStamp;
    if (delay >= 0 && delay < 1000) this.clickDelays.push(delay);
  }

  /** Call once per animation frame. */
  frame(now) {
    if (this.lastFrame != null) {
      const dt = now - this.lastFrame;
      if (dt > 0 && dt < 1000) {
        this.frameTimes.push(dt);
        this.trackFrame(dt);
        this.frameTotal += dt;
        if (dt > this.longestFrame) this.longestFrame = dt;
      }
    }
    this.lastFrame = now;
    this.lastFrameMoves = this.movesThisFrame;
    this.movesThisFrame = 0;
  }

  /** Typical frame time, kept cheaply for the stall test (outliers clipped, no sorting per frame). */
  get medianFrame() {
    return this.frameEma;
  }

  trackFrame(dt) {
    this.frameEma = this.frameEma ? this.frameEma + (Math.min(dt, 2 * this.frameEma) - this.frameEma) * 0.05 : dt;
  }

  summary() {
    const ft = this.frameTimes.sorted();
    const medFrame = quantile(ft, 0.5);
    const hitchAt = Math.max(2 * medFrame, medFrame + 8);
    const hitches = ft.filter((v) => v > hitchAt).length;
    const gaps = this.moveGaps.sorted();
    const medGap = quantile(gaps, 0.5);
    const raw = this.rawGaps.sorted();
    const medRaw = quantile(raw, 0.5);
    const delays = this.delays.sorted();
    return {
      seconds: this.frameTotal / 1000,
      frames: ft.length,
      refreshHz: medFrame ? 1000 / medFrame : 0,
      p99FrameMs: quantile(ft, 0.99),
      longestFrameMs: this.longestFrame,
      hitches,
      hitchPct: ft.length ? (100 * hitches) / ft.length : 0,
      moves: this.moves,
      moveRateHz: medGap ? 1000 / medGap : 0,
      rawSeen: this.rawSeen,
      pollingHz: medRaw && raw.length > 50 ? nearestPolling(1000 / medRaw) : null,
      stalls: this.stalls,
      longestStallMs: this.longestStall,
      spikes: this.spikes,
      biggestSpike: Math.round(this.biggestSpike),
      fractionalPct: this.moves ? (100 * this.fractional) / this.moves : 0,
      avgDelayMs: delays.length ? delays.reduce((s, v) => s + v, 0) / delays.length : 0,
      p95DelayMs: quantile(delays, 0.95),
      maxDelayMs: this.maxDelay,
      clickDelayMs: this.clickDelays.length ? Math.max(...this.clickDelays) : null,
    };
  }

  /** One-line in-drill readout for the pause menu. */
  line(mode) {
    const s = this.summary();
    if (!s.frames) return 'No frames sampled since capture.';
    const parts = [
      mode,
      `${s.seconds.toFixed(1)} s sampled`,
      `${s.moves} mouse events`,
      `stalls ${s.stalls}${s.stalls ? ` (longest ${Math.round(s.longestStallMs)} ms)` : ''}`,
      `spikes ${s.spikes}`,
      `${Math.round(s.refreshHz)} FPS median`,
      `longest frame ${Math.round(s.longestFrameMs)} ms`,
      `${s.hitches} hitches`,
    ];
    return `${parts.join(' · ')}. Since mouse capture.`;
  }
}
