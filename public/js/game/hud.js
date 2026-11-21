import { el } from '../util.js';

const HIT_FLASH = [
  { opacity: 1, transform: 'translate(-50%, -50%) rotate(45deg) scale(0.8)' },
  { opacity: 0, transform: 'translate(-50%, -50%) rotate(45deg) scale(1.15)' },
];

/** DOM heads-up display. Writes are diffed so the DOM is only touched when text changes. */
export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.name = $('hud-scenario');
    this.timer = $('hud-timer');
    this.score = $('hud-score');
    this.statsEl = $('hud-stats');
    this.partyEl = $('hud-party');
    this.bannerEl = $('hud-banner');
    this.feedbackEl = $('hud-feedback');
    this.hitEl = $('hud-hitmarker');
    this.hitAnimation = null;
    this.exposedEl = $('hud-exposed');
    this.speedEl = $('hud-speed');
    this.speedFill = $('hud-speed-fill');
    this.speedMark = $('hud-speed-mark');
    this.speedLabel = $('hud-speed-label');
    this.ammoEl = $('hud-ammo');
    this.ammoCur = $('hud-ammo-cur');
    this.ammoMax = $('hud-ammo-max');
    this.ammoName = $('hud-ammo-name');
    this.reloadHint = $('hud-reload-hint');
    this.reloadBar = $('hud-reload-bar');
    this.reloadFill = $('hud-reload-fill');
    this.boltEl = $('hud-bolt');
    this.boltFill = $('hud-bolt-fill');
    this.fpsEl = $('hud-fps');
    this.vignette = $('hud-vignette');
    this.countdownEl = $('overlay-countdown');
    this.scopeEl = $('scope-overlay');
    this.crosshairEl = $('crosshair');
    this.boardEl = $('hud-board');
    this.cache = new Map();
    this.timers = { banner: 0, feedback: 0, vignette: 0 };
  }

  set(node, text, key = node.id) {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    node.textContent = text;
  }

  reset(meta, difficulty, weapon, opts) {
    this.cache.clear();
    this.set(this.name, `${meta.name} · ${difficulty.toUpperCase()}${opts.party ? ' · PARTY' : ''}`);
    this.set(this.timer, '');
    this.set(this.score, '');
    this.statsEl.replaceChildren();
    this.partyEl.hidden = !opts.party;
    this.partyEl.replaceChildren();
    this.bannerEl.className = '';
    this.feedbackEl.className = '';
    this.hitAnimation?.cancel();
    this.hitEl.className = '';
    this.exposedEl.hidden = true;
    this.vignette.className = '';
    this.scope(false);
    this.speedEl.hidden = !opts.showSpeed;
    this.ammoEl.hidden = !!weapon.noFire;
    this.reloadBar.hidden = true;
    this.boltEl.hidden = true;
    this.fpsEl.hidden = !opts.showFps;
    this.boardEl.hidden = true;
    this.countdownEl.hidden = true;
  }

  stats(lines) {
    const key = lines.map((l) => l.join(':')).join('|');
    if (this.cache.get('stats') === key) return;
    this.cache.set('stats', key);
    this.statsEl.replaceChildren(...lines.map(([k, v, cls]) => el('div', { class: `row ${cls || ''}` }, el('span', {}, k), el('b', {}, v))));
  }

  speed(sp, run, acc, onGround) {
    const frac = Math.min(1, sp / run);
    this.speedFill.style.transform = `scaleX(${frac.toFixed(3)})`;
    const markPct = `${((acc / run) * 100).toFixed(1)}%`;
    if (this.cache.get('mark') !== markPct) {
      this.cache.set('mark', markPct);
      this.speedMark.style.left = markPct;
    }
    const state = !onGround ? 'air' : sp <= acc ? 'ok' : 'moving';
    if (this.cache.get('speedState') !== state) {
      this.cache.set('speedState', state);
      this.speedEl.dataset.state = state;
    }
    this.set(this.speedLabel, `${sp.toFixed(2)} m/s${!onGround ? ' · AIR' : sp <= acc ? ' · ACCURATE' : ''}`, 'speedLabel');
  }

  /**
   * Bottom-right ammo panel: rounds left / magazine, weapon + zoom, reload prompt and progress.
   * a = { cur, max, name, reloadFrac (0..1 while reloading, else -1), key }
   */
  ammo(a) {
    const infinite = !Number.isFinite(a.max);
    this.set(this.ammoCur, infinite ? '∞' : String(a.cur), 'ammoCur');
    this.set(this.ammoMax, infinite ? '' : `/ ${a.max}`, 'ammoMax');
    this.set(this.ammoName, a.name, 'ammoName');
    const reloading = a.reloadFrac >= 0;
    const low = !infinite && !reloading && a.cur <= Math.ceil(a.max * 0.3);
    const state = reloading ? 'reloading' : a.cur === 0 && !infinite ? 'empty' : low ? 'low' : 'ok';
    if (this.cache.get('ammoState') !== state) {
      this.cache.set('ammoState', state);
      this.ammoEl.dataset.state = state;
    }
    let hint = '';
    if (reloading) hint = 'RELOADING';
    else if (!infinite && a.cur < a.max && (low || a.cur === 0)) hint = `[${a.key}] RELOAD`;
    this.set(this.reloadHint, hint, 'reloadHint');
    if (this.reloadBar.hidden === reloading) this.reloadBar.hidden = !reloading;
    if (reloading) this.reloadFill.style.transform = `scaleX(${a.reloadFrac.toFixed(3)})`;
  }

  bolt(frac) {
    const show = frac > 0 && frac < 1;
    if (this.boltEl.hidden === show) this.boltEl.hidden = !show;
    if (show) this.boltFill.style.transform = `scaleX(${frac.toFixed(3)})`;
  }

  fps(n) {
    this.set(this.fpsEl, `${n} FPS`, 'fps');
  }

  banner(text, kind = 'info', dur = 1.2) {
    this.bannerEl.textContent = text;
    this.bannerEl.className = `show ${kind}`;
    this.timers.banner = dur;
  }

  feedback(text, kind = 'info', dur = 0.7) {
    this.feedbackEl.textContent = text;
    this.feedbackEl.className = `show ${kind}`;
    this.timers.feedback = dur;
  }

  hitmarker(kind) {
    this.hitEl.className = kind;
    this.hitAnimation ??= this.hitEl.animate(HIT_FLASH, { duration: 180, easing: 'ease-out' });
    this.hitAnimation.currentTime = 0;
    this.hitAnimation.play();
  }

  flash(kind = 'death', dur = 0.6) {
    this.vignette.className = `show ${kind}`;
    this.timers.vignette = dur;
  }

  exposed(on, t = 0) {
    if (this.exposedEl.hidden === on) this.exposedEl.hidden = !on;
    if (on) this.set(this.exposedEl, `EXPOSED ${t.toFixed(2)}s`, 'exposed');
  }

  countdown(n) {
    if (n == null) {
      this.countdownEl.hidden = true;
      return;
    }
    this.countdownEl.hidden = false;
    this.set(this.countdownEl, String(n), 'countdown');
  }

  scope(on) {
    this.scopeEl.hidden = !on;
    this.crosshairEl.style.visibility = on ? 'hidden' : 'visible';
  }

  party(rows, myId, unit) {
    const key = JSON.stringify(rows);
    if (this.cache.get('party') === key) return;
    this.cache.set('party', key);
    const make = (r, i) =>
      el('div', { class: `prow${r.id === myId ? ' me' : ''}` },
        el('span', { class: 'pos' }, String(i + 1)),
        el('span', { class: 'dot', style: { background: r.color } }),
        el('span', { class: 'pname' }, r.name),
        el('b', {}, r.display ?? '-'));
    this.partyEl.replaceChildren(el('div', { class: 'ptitle' }, `PARTY · ${unit}`), ...rows.map(make));
    this.boardEl.replaceChildren(el('h3', {}, 'Party scoreboard'), ...rows.map(make));
  }

  showBoard(on) {
    if (!this.partyEl.hidden) this.boardEl.hidden = !on;
  }

  tick(dt) {
    for (const k of Object.keys(this.timers)) {
      if (this.timers[k] <= 0) continue;
      this.timers[k] -= dt;
      if (this.timers[k] > 0) continue;
      if (k === 'banner') this.bannerEl.classList.remove('show');
      if (k === 'feedback') this.feedbackEl.classList.remove('show');
      if (k === 'vignette') this.vignette.className = '';
    }
  }
}
