import { el, timeAgo } from './util.js';
import { InputProbe } from './inputprobe.js';

const SAMPLE_S = 8;
const IDLE_ABORT_S = 20;
const STORE_KEY = 'strafelab.check.v1';
const STRIP_H = 64;
const TRAIL = 48;

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');

function browserName() {
  const brands = navigator.userAgentData?.brands || [];
  const b = brands.find((x) => /Chrome|Edge|Opera|Brave/i.test(x.brand) && !/Not/i.test(x.brand)) || brands.find((x) => !/Not/i.test(x.brand));
  if (b) return `${b.brand} ${b.version}`;
  const m = navigator.userAgent.match(/(Edg|Chrome|Firefox|Safari)\/(\d+)/);
  return m ? `${m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2]}` : 'Unknown browser';
}

/**
 * Turn a probe summary into report rows. Each row: [label, value, status, note].
 * status: good | warn | bad | info
 */
export function assess(s, ctx) {
  const rows = [];
  const tips = [];

  if (ctx.captureMode === 'raw') rows.push(['Mouse capture', 'Raw input', 'good', 'Windows pointer speed and acceleration are bypassed.']);
  else if (ctx.rawWanted) {
    rows.push(['Mouse capture', 'System input', 'warn', 'This browser refused raw input, so Windows pointer settings still apply.']);
    tips.push('Use desktop Chrome or Edge for raw input. In Windows, turn off "Enhance pointer precision" so system input isn\'t accelerated.');
  } else {
    rows.push(['Mouse capture', 'System input', 'warn', 'Raw input is off in Settings > Mouse.']);
    tips.push('Turn on raw input in Settings > Mouse so your sensitivity matches Valorant (which reads raw input).');
  }

  if (s.pollingHz == null) {
    rows.push(['Polling rate', s.rawSeen ? 'Too little movement' : 'Not measurable', 'info', s.rawSeen ? 'Move the mouse continuously for longer.' : 'This browser doesn\'t expose raw pointer updates.']);
  } else if (s.pollingHz >= 4000) {
    rows.push(['Polling rate', `~${s.pollingHz} Hz`, 'warn', 'Browsers often struggle above 2000 Hz.']);
    tips.push(`Your mouse polls at about ${s.pollingHz} Hz. If aim stutters or sticks, set it to 1000 Hz in the mouse software and run this check again.`);
  } else if (s.pollingHz <= 250) {
    rows.push(['Polling rate', `~${s.pollingHz} Hz`, 'warn', 'Low polling makes aim move in visible steps.']);
    tips.push('Set your mouse to 1000 Hz polling in its software.');
  } else rows.push(['Polling rate', `~${s.pollingHz} Hz`, 'good', '']);

  rows.push(['Mouse events delivered', `${fmt(s.moveRateHz)} /s`, 'info', `${s.moves} events in ${fmt(s.seconds, 1)} s. Browsers usually batch them to one per frame.`]);

  if (s.stalls) {
    const confirmed = s.rawSeen;
    rows.push(['Input stalls', `${s.stalls} · longest ${fmt(s.longestStallMs)} ms`, 'bad',
      confirmed ? 'Your mouse kept reporting but the game\'s mouse events stopped. This is the "sticking" feeling.' : 'Long gaps in fast mouse motion.']);
    tips.push('Input stalls: close other tabs and apps that use the GPU (video, Discord streaming), turn on hardware acceleration in the browser, and try 1000 Hz polling. If stalls only happen in fullscreen or only windowed, tell us which.');
  } else rows.push(['Input stalls', 'None', 'good', 'Mouse events kept arriving while you moved.']);

  if (s.spikes) {
    rows.push(['Movement spikes', `${s.spikes} · largest ${s.biggestSpike} counts`, 'bad', 'Single huge jumps in mouse movement make the view snap.']);
    tips.push('Movement spikes are a known browser pointer-capture problem. Update the browser, and toggle raw input in Settings > Mouse to see which mode avoids them.');
  } else rows.push(['Movement spikes', 'None', 'good', '']);

  if (s.fractionalPct > 5) {
    rows.push(['Movement values', 'Scaled', 'warn', `${fmt(s.fractionalPct)}% of events arrived as fractions, so something is rescaling your mouse.`]);
    tips.push('Mouse values are being rescaled, usually by Windows display scaling with raw input off. Turn on raw input so 1 count = 1 count, like in Valorant.');
  } else rows.push(['Movement values', 'Whole counts', 'good', '']);

  const hz = Math.round(s.refreshHz);
  if (hz && hz < 100) {
    rows.push(['Frame rate', `${hz} FPS`, 'warn', 'The browser is drawing at 60 Hz or below.']);
    tips.push('The browser is running at 60 FPS. Make sure the browser window is on your high refresh monitor and that the monitor is set to its full refresh rate in Windows display settings.');
  } else rows.push(['Frame rate', `${hz} FPS`, hz ? 'good' : 'info', 'Median during the test. In drills, turn on Settings > Gameplay > Show FPS to see the 3D frame rate.']);

  const pacingBad = s.longestFrameMs > 100 || s.hitchPct > 3;
  const pacingWarn = s.longestFrameMs > 40 || s.hitchPct > 1;
  rows.push(['Frame pacing', `${s.hitches} hitches · longest ${fmt(s.longestFrameMs)} ms`, pacingBad ? 'bad' : pacingWarn ? 'warn' : 'good',
    `A hitch is a frame over twice the normal time. ${fmt(s.hitchPct, 1)}% of frames.`]);
  if (pacingBad || pacingWarn) tips.push('Frame hitches: close background tabs, check that hardware acceleration is on, and lower Settings > Audio & video > Render scale if drills also stutter.');

  const delayBad = s.p95DelayMs > 20;
  const delayWarn = s.p95DelayMs > 8;
  rows.push(['Event delay', `${fmt(s.avgDelayMs, 1)} ms avg · ${fmt(s.p95DelayMs, 1)} ms p95`, delayBad ? 'bad' : delayWarn ? 'warn' : 'good',
    'Time from the browser receiving a mouse event to StrafeLab handling it.']);
  if (delayBad || delayWarn) tips.push('Mouse events wait before StrafeLab can handle them, which means the page is busy. Extensions that inject into every page (ad blockers, overlays) can cause this; try a profile without them.');

  const worst = rows.some((r) => r[2] === 'bad') ? 'bad' : rows.some((r) => r[2] === 'warn') ? 'warn' : 'good';
  return { rows, tips, verdict: worst };
}

const VERDICT = {
  good: ['ALL CLEAR', 'Your mouse and display reach StrafeLab cleanly.'],
  warn: ['WORTH A LOOK', 'Nothing is broken, but some settings cost accuracy or consistency.'],
  bad: ['PROBLEM FOUND', 'Something is interrupting your input. See the fixes below.'],
};

/** The System check tab: an 8-second captured mouse test with a plain-language report. */
export class SystemCheck {
  constructor(root, getSettings) {
    this.root = root;
    this.getSettings = getSettings;
    this.probe = new InputProbe();
    this.state = 'idle';
    this.raf = null;
    this.trail = [];
    this.strip = [];
    this.onMove = (e) => this.handleMove(e);
    this.onRaw = (e) => {
      if (this.state === 'sampling') this.probe.rawMove(e);
    };
    this.onDown = (e) => {
      if (this.state !== 'sampling') return;
      e.preventDefault();
      this.probe.click(e);
      this.clicks += 1;
    };
    this.onLock = () => this.lockChanged();
    this.loop = this.loop.bind(this);
    this.build();
    this.showStored();
  }

  build() {
    this.startBtn = el('button', { class: 'primary big', onclick: () => this.start() }, 'Start check');
    this.canvas = el('canvas', { class: 'check-canvas' });
    this.padNote = el('div', { class: 'check-pad-note' }, 'Press Start check');
    this.pad = el('div', { class: 'check-pad' }, this.canvas, this.padNote);
    this.live = el('div', { class: 'check-live' });
    this.report = el('div', { class: 'check-report' });
    this.root.replaceChildren(
      el('div', { class: 'panel check-intro' },
        el('h3', {}, 'Mouse and display test'),
        el('p', { class: 'muted' }, 'Measures how your mouse and screen reach StrafeLab in 8 seconds: polling rate, stalls where mouse events stop arriving, sudden movement spikes, frame hitches and event delay. Run it when aim feels sticky, or after changing your mouse, browser or monitor.'),
        el('ol', { class: 'check-steps' },
          el('li', {}, 'Press Start check. Your mouse is captured.'),
          el('li', {}, 'Move in fast circles, flick left and right, and click a few times. The timer starts on your first movement.'),
          el('li', {}, 'Read the result. Esc stops the test early.')),
        el('div', { class: 'btns' }, this.startBtn)),
      el('div', { class: 'panel check-stage' }, this.pad, this.live),
      this.report,
    );
    this.renderLive();
  }

  showStored() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch {
      saved = null;
    }
    if (saved?.summary) this.renderReport(saved);
  }

  // ---------------------------------------------------------------- capture
  async start() {
    if (this.state !== 'idle') return;
    const settings = this.getSettings();
    this.probe.reset();
    this.trail = [];
    this.strip = [];
    this.clicks = 0;
    this.rawWanted = !!settings.rawInput;
    this.captureMode = 'system';
    this.lastSummary = null;
    this.state = 'arming';
    this.padNote.textContent = 'Move your mouse to start';
    document.addEventListener('pointerlockchange', this.onLock);
    try {
      if (this.rawWanted) {
        try {
          await this.pad.requestPointerLock({ unadjustedMovement: true });
          this.captureMode = 'raw';
        } catch (error) {
          if (error.name !== 'NotSupportedError') throw error;
          await this.pad.requestPointerLock();
        }
      } else {
        await this.pad.requestPointerLock();
      }
    } catch {
      this.abort('Mouse capture failed. Open StrafeLab in desktop Chrome or Edge and try again.');
    }
  }

  lockChanged() {
    const locked = document.pointerLockElement === this.pad;
    if (locked && this.state === 'arming') {
      this.state = 'armed';
      this.armedAt = performance.now();
      document.addEventListener('mousemove', this.onMove, true);
      if ('onpointerrawupdate' in window) document.addEventListener('pointerrawupdate', this.onRaw, true);
      document.addEventListener('mousedown', this.onDown, true);
      this.startBtn.disabled = true;
      this.pad.classList.add('live');
      this.raf = requestAnimationFrame(this.loop);
    } else if (!locked && (this.state === 'armed' || this.state === 'sampling')) {
      this.abort('Stopped early. Press Start check to run it again.');
    }
  }

  handleMove(e) {
    if (this.state === 'armed' && (e.movementX || e.movementY)) {
      this.state = 'sampling';
      this.sampleStart = performance.now();
      this.padNote.textContent = '';
    }
    if (this.state !== 'sampling') return;
    this.probe.move(e);
    const w = this.canvas.clientWidth || 600;
    const h = (this.canvas.clientHeight || 300) - STRIP_H;
    const last = this.trail.at(-1) || { x: w / 2, y: h / 2 };
    const k = 0.35;
    let x = last.x + (e.movementX || 0) * k;
    let y = last.y + (e.movementY || 0) * k;
    const wrapped = x < 0 || x > w || y < 0 || y > h;
    x = ((x % w) + w) % w;
    y = ((y % h) + h) % h;
    this.trail.push({ x, y, wrapped });
    if (this.trail.length > TRAIL) this.trail.shift();
  }

  detach() {
    document.removeEventListener('mousemove', this.onMove, true);
    document.removeEventListener('pointerrawupdate', this.onRaw, true);
    document.removeEventListener('mousedown', this.onDown, true);
    document.removeEventListener('pointerlockchange', this.onLock);
    if (document.pointerLockElement === this.pad) document.exitPointerLock();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.startBtn.disabled = false;
    this.pad.classList.remove('live');
  }

  abort(message) {
    this.state = 'idle';
    this.detach();
    this.padNote.textContent = message;
    this.renderLive();
  }

  finish() {
    this.state = 'idle';
    this.detach();
    this.padNote.textContent = 'Done. Press Start check to run it again.';
    const settings = this.getSettings();
    const result = {
      ts: Date.now(),
      browser: browserName(),
      captureMode: this.captureMode,
      rawWanted: this.rawWanted,
      clicks: this.clicks,
      fullscreen: !!document.fullscreenElement,
      screen: `${screen.width}x${screen.height} @ ${window.devicePixelRatio || 1}x`,
      settings: { sens: settings.sens, dpi: settings.dpi },
      summary: this.probe.summary(),
    };
    this.lastSummary = result.summary;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(result));
    } catch {
      /* storage blocked */
    }
    this.renderReport(result, true);
    this.renderLive();
  }

  // ---------------------------------------------------------------- live view
  loop(now) {
    if (this.state !== 'armed' && this.state !== 'sampling') return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.state === 'armed' && now - this.armedAt > IDLE_ABORT_S * 1000) {
      this.abort('No mouse movement. Press Start check and move the mouse.');
      return;
    }
    if (this.state === 'sampling') {
      const stallsBefore = this.probe.stalls;
      const dt = this.probe.lastFrame != null ? now - this.probe.lastFrame : 0;
      const moves = this.probe.movesThisFrame;
      this.probe.frame(now);
      if (dt) this.strip.push({ dt, moves, stall: this.probe.stalls > stallsBefore });
      if (this.strip.length > 400) this.strip.shift();
      if (now - this.sampleStart >= SAMPLE_S * 1000) {
        this.finish();
        return;
      }
    }
    this.draw();
    if (!this.liveAt || now - this.liveAt > 150) {
      this.liveAt = now;
      this.renderLive(now);
    }
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#2de2c2';
    const warn = css.getPropertyValue('--warn').trim() || '#ffcc4d';
    const bad = css.getPropertyValue('--bad').trim() || '#ff5a6a';

    // trail of recent mouse positions (wraps at the edges)
    g.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      if (b.wrapped) continue;
      g.strokeStyle = accent;
      g.globalAlpha = i / this.trail.length;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.globalAlpha = 1;
    const head = this.trail.at(-1);
    if (head) {
      g.fillStyle = accent;
      g.beginPath();
      g.arc(head.x, head.y, 5, 0, Math.PI * 2);
      g.fill();
    }

    // frame-time strip: one column per frame, taller = slower; red marks a stall
    const top = h - STRIP_H;
    g.fillStyle = '#0a0e17';
    g.fillRect(0, top, w, STRIP_H);
    const col = 3;
    const n = Math.min(this.strip.length, Math.floor(w / col));
    const typical = this.probe.medianFrame || 16.7;
    for (let i = 0; i < n; i++) {
      const f = this.strip[this.strip.length - n + i];
      const hh = Math.min(STRIP_H - 6, (f.dt / 50) * (STRIP_H - 6));
      g.fillStyle = f.stall ? bad : f.dt > Math.max(2 * typical, typical + 8) ? warn : accent;
      g.globalAlpha = f.moves ? 0.85 : 0.35;
      g.fillRect(i * col, h - hh, col - 1, hh);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#8592aa';
    g.font = '11px Inter, system-ui, sans-serif';
    g.fillText('frame time (taller = slower, red = input stall)', 8, top + 13);
  }

  renderLive(now = performance.now()) {
    const s = this.state === 'sampling' || this.state === 'armed' ? this.probe.summary() : this.lastSummary;
    const left = this.state === 'sampling' ? Math.max(0, SAMPLE_S - (now - this.sampleStart) / 1000) : this.state === 'armed' ? SAMPLE_S : null;
    const item = (k, v, cls = '') => el('div', { class: cls }, el('span', {}, k), el('b', {}, v));
    this.live.replaceChildren(
      item('Time left', left == null ? '-' : `${left.toFixed(1)} s`),
      item('Polling', s?.pollingHz ? `~${s.pollingHz} Hz` : '-'),
      item('Events', s?.moveRateHz ? `${Math.round(s.moveRateHz)}/s` : '-'),
      item('FPS', s?.refreshHz ? Math.round(s.refreshHz) : '-'),
      item('Stalls', s ? s.stalls : '-', s?.stalls ? 'bad' : ''),
      item('Spikes', s ? s.spikes : '-', s?.spikes ? 'bad' : ''),
    );
  }

  // ---------------------------------------------------------------- report
  renderReport(result, fresh = false) {
    const { rows, tips, verdict } = assess(result.summary, result);
    const [title, line] = VERDICT[verdict];
    const copyBtn = el('button', { class: 'ghost small', onclick: () => this.copy(result, rows, tips, copyBtn) }, 'Copy report');
    this.report.replaceChildren(el('div', { class: `panel check-result ${verdict}` },
      el('div', { class: 'check-head' },
        el('span', { class: `badge ${verdict === 'good' ? 'good' : verdict === 'bad' ? 'bad' : 'warnb'}` }, title),
        el('p', {}, line),
        el('small', { class: 'muted' }, `${fresh ? 'Just now' : timeAgo(result.ts)} · ${result.browser} · ${result.fullscreen ? 'fullscreen' : 'windowed'}`),
        copyBtn),
      el('div', { class: 'check-rows' }, rows.map(([k, v, status, note]) => el('div', { class: `check-row ${status}` },
        el('i', { 'aria-hidden': 'true' }),
        el('span', {}, k),
        el('b', {}, v),
        note ? el('small', { class: 'muted' }, note) : null))),
      tips.length ? el('div', { class: 'check-tips' }, el('h4', {}, 'What to try'), el('ul', {}, tips.map((t) => el('li', {}, t)))) : null,
    ));
  }

  async copy(result, rows, tips, btn) {
    const lines = [
      `StrafeLab system check · ${new Date(result.ts).toLocaleString()}`,
      `${result.browser} · ${result.screen} · ${result.fullscreen ? 'fullscreen' : 'windowed'} · sens ${result.settings.sens} @ ${result.settings.dpi} DPI`,
      ...rows.map(([k, v, status]) => `${k}: ${v} [${status}]`),
      ...tips.map((t) => `- ${t}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Copy failed';
    }
    setTimeout(() => {
      btn.textContent = 'Copy report';
    }, 1500);
  }
}
