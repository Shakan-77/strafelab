import { el } from '../util.js';

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
    this.exposedEl = $('hud-exposed');
    this.speedEl = $('hud-speed');
    this.speedFill = $('hud-speed-fill');
    this.speedMark = $('hud-speed-mark');
    this.speedLabel = $('hud-speed-label');
    this.weaponEl = $('hud-weapon');
    this.boltEl = $('hud-bolt');
    this.boltFill = $('hud-bolt-fill');
    this.fpsEl = $('hud-fps');
    this.vignette = $('hud-vignette');
    this.countdownEl = $('overlay-countdown');
    this.scopeEl = $('scope-overlay');
    this.crosshairEl = $('crosshair');
    this.boardEl = $('hud-board');
    this.cache = new Map();
    this.timers = { banner: 0, feedback: 0, hit: 0, vignette: 0 };
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
    this.exposedEl.hidden = true;
    this.vignette.className = '';
    this.scope(false);
    this.speedEl.hidden = !opts.showSpeed;
    this.weaponEl.hidden = weapon.noFire;
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

  weapon(text) {
    this.set(this.weaponEl, text, 'weapon');
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
    this.hitEl.className = '';
    void this.hitEl.offsetWidth; // restart animation
    this.hitEl.className = `show ${kind}`;
    this.timers.hit = 0.18;
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
      if (k === 'hit') this.hitEl.className = '';
      if (k === 'vignette') this.vignette.className = '';
    }
  }
}
