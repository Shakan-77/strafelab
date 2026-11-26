import * as THREE from 'three';
import { Scenario } from './base.js';
import { Bot } from '../game/targets.js';
import { BotGun, PLAYER_HP } from '../game/botfire.js';
import { floor, backdrop } from './layouts.js';
import { mean, median, pct, fmtMs } from '../util.js';

const PANEL = { wait: '#1e2638', go: '#22e07a', decoy: '#2f6bff', done: '#16301f', early: '#4a1a22' };

// ============================================================ Reaction Time
export class Reaction extends Scenario {
  constructor(...a) {
    super(...a);
    this.allowMove = false;
    this.allowJump = false;
    this.trials = 12;
    this.decoyChance = this.d({ easy: 0, medium: 0, hard: 0.25 });
    this.times = [];
    this.falseStarts = 0;
    this.decoyErrors = 0;
    this.decoys = 0;
    this.state = 'idle';
  }

  build(w) {
    floor(w, -20, 20, -20, 10);
    this.mat = new THREE.MeshBasicMaterial({ color: PANEL.wait });
    w.box([-4.8, 0.2, -7.2], [4.8, 3.4, -7], { material: this.mat, ownMaterial: true });
    w.box([-5.2, 0, -7.6], [5.2, 3.8, -7.2], { mat: 'dark' });
  }

  spawn() {
    return { pos: [0, 0, 0], yaw: 0, pitch: 4 * Math.PI / 180 };
  }

  setPanel(c) {
    this.mat.color.set(c);
  }

  begin() {
    this.hudApi.banner(this.decoyChance ? 'Click on GREEN. Never on BLUE.' : 'Click the instant it turns GREEN', 'info', 2);
    this.wait();
  }

  wait() {
    this.state = 'wait';
    this.setPanel(PANEL.wait);
    this.goAt = this.elapsed + this.rng.float(1.2, 3.2);
  }

  update() {
    if (this.state === 'wait' && this.elapsed >= this.goAt) {
      if (this.decoyChance && this.rng.chance(this.decoyChance)) {
        this.state = 'decoy';
        this.decoys += 1;
        this.setPanel(PANEL.decoy);
        this.decoyUntil = this.elapsed + 0.9;
      } else {
        this.state = 'go-pending';
        this.setPanel(PANEL.go);
      }
    } else if (this.state === 'decoy' && this.elapsed >= this.decoyUntil) {
      this.wait();
    } else if (this.state === 'result' && this.elapsed >= this.resultUntil) {
      if (this.times.length >= this.trials) this.finished = true;
      else this.wait();
    }
  }

  /** The panel colour is on screen once the frame that changed it has rendered. */
  postRender(t) {
    if (this.state === 'go-pending') {
      this.state = 'go';
      this.goTime = t;
    }
  }

  onFireInput(ts) {
    switch (this.state) {
      case 'wait':
      case 'go-pending':
        this.falseStarts += 1;
        this.hudApi.banner('TOO EARLY', 'bad', 0.8);
        this.game.audio.bad();
        this.setPanel(PANEL.early);
        this.goAt = this.elapsed + this.rng.float(1.2, 3.2);
        this.state = 'wait';
        setTimeout(() => this.state === 'wait' && this.setPanel(PANEL.wait), 250);
        break;
      case 'decoy':
        this.decoyErrors += 1;
        this.hudApi.banner("DECOY: don't shoot blue", 'bad', 0.9);
        this.game.audio.bad();
        this.wait();
        break;
      case 'go': {
        const rt = Math.max(0, ts - this.goTime);
        this.times.push(rt);
        this.state = 'result';
        this.resultUntil = this.elapsed + 0.8;
        this.setPanel(PANEL.done);
        this.hudApi.banner(`${Math.round(rt)} ms`, rt < 220 ? 'good' : 'info', 0.8);
        this.game.audio.good();
        break;
      }
      default:
        break;
    }
    return true;
  }

  score() {
    if (!this.times.length) return 5000;
    return Math.round(mean(this.times) + 25 * (this.falseStarts + this.decoyErrors));
  }

  liveDisplay() {
    return this.times.length ? `${this.score()} ms` : '-';
  }

  results() {
    const r = super.results();
    if (this.times.length < this.trials) r.dnf = true;
    return r;
  }

  hud() {
    return [
      ['Trial', `${Math.min(this.times.length + 1, this.trials)} / ${this.trials}`],
      ['Last', this.times.length ? `${Math.round(this.times.at(-1))} ms` : '-'],
      ['Average', this.times.length ? `${Math.round(mean(this.times))} ms` : '-'],
      ['False starts', this.falseStarts],
    ];
  }

  stats() {
    const t = this.times;
    return [
      ['Average', t.length ? `${Math.round(mean(t))} ms` : '-'],
      ['Median', t.length ? `${Math.round(median(t))} ms` : '-'],
      ['Best', t.length ? `${Math.round(Math.min(...t))} ms` : '-'],
      ['Worst', t.length ? `${Math.round(Math.max(...t))} ms` : '-'],
      ['False starts', this.falseStarts],
      ['Decoys shot', this.decoys ? `${this.decoyErrors} / ${this.decoys}` : '-'],
    ];
  }
}

// ============================================================ Angle Hold
export class AngleHold extends Scenario {
  constructor(...a) {
    super(...a);
    this.feedback = 'movement';
    // shared bot model: reaction, then rifle taps against your 150 HP
    this.gun = new BotGun(this.game, this.rng.fork(), this.diff);
    this.reaction = this.gun.reaction;
    this.hp = PLAYER_HP;
    this.damageTaken = 0;
    this.sides = this.d({ easy: ['L'], medium: ['L', 'R'], hard: ['L', 'R'] });
    this.types = this.d({ easy: ['swing'], medium: ['swing', 'swing', 'wide'], hard: ['swing', 'swing', 'wide', 'jiggle'] });
    this.delay = this.d({ easy: [1.0, 2.4], medium: [0.8, 2.0], hard: [0.5, 1.6] });
    this.bot = null;
    this.next = 0;
    this.kills = 0;
    this.hsKills = 0;
    this.deaths = 0;
    this.peeks = 0;
    this.ttks = [];
    this.wideKills = 0;
  }

  build(w) {
    floor(w, -40, 40, -40, 10);
    w.box([-20, 0, -13], [-2.5, 3.2, -12], { mat: 'cover' });
    w.box([2.5, 0, -13], [20, 3.2, -12], { mat: 'cover' });
    backdrop(w, -22, -20, 20, 6);
    w.box([-20, 0, -22], [-19, 6, -13], { mat: 'wall' });
    w.box([19, 0, -22], [20, 6, -13], { mat: 'wall' });
    w.box([-6, 0, 3], [6, 3, 3.5], { mat: 'wall' });
    w.box([-6, 0, -2], [-5.5, 3, 3.5], { mat: 'wall' });
    w.box([5.5, 0, -2], [6, 3, 3.5], { mat: 'wall' });
    // head-height guide marks on both wall edges
    w.box([-2.56, 1.52, -12.05], [-2.5, 1.62, -11.95], { mat: 'accent', collide: false, block: false });
    w.box([2.5, 1.52, -12.05], [2.56, 1.62, -11.95], { mat: 'accent', collide: false, block: false });
  }

  spawn() {
    return { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  }

  begin() {
    this.next = this.elapsed + 1.0;
    this.hudApi.banner('Hold the gap at head height', 'info', 1.5);
  }

  spawnPeek() {
    const side = this.rng.pick(this.sides);
    const dir = side === 'L' ? 1 : -1;
    const type = this.rng.pick(this.types);
    const z = -this.rng.float(15.5, 17.5);
    const start = -dir * 6.5;
    const o = {
      origin: new THREE.Vector3(0, 0, z),
      axis: new THREE.Vector3(1, 0, 0),
      min: -9,
      max: 9,
      s: start,
      dir,
      kind: type,
      rng: this.rng.fork(),
      crouched: this.diff === 'hard' && this.rng.chance(0.15),
    };
    if (type === 'wide') Object.assign(o, { behavior: 'cross', min: -7, max: 7, s: -dir * 7 });
    else if (type === 'jiggle') Object.assign(o, { behavior: 'jiggle', stopAt: -dir * 2.0, min: dir > 0 ? start : -9, max: dir > 0 ? 9 : start });
    else Object.assign(o, { behavior: 'peek', stopAt: this.rng.float(-1.6, 1.6), min: dir > 0 ? start : -9, max: dir > 0 ? 9 : start });
    this.bot = new Bot(this.game, o);
    this.bot.spawnedAt = this.elapsed;
    this.bot.shotAt = null;
    this.hp = PLAYER_HP; // fresh duel each peek
    this.peeks += 1;
  }

  update() {
    const b = this.bot;
    if (!b) {
      if (this.elapsed >= this.next) this.spawnPeek();
      return;
    }
    if (b.firstSeen == null && this.game.botVisible(b)) {
      b.firstSeen = this.elapsed;
      b.placement = this.notePlacement(b);
    }
    if (b.behavior === 'peek' && b.state === 'hold' && b.firstSeen != null && b.shotAt == null) {
      // once stopped and its reaction time is up, it fires taps for up to 1.2 s, then backs off
      b.shotAt = Math.max(b.firstSeen + this.reaction, this.elapsed + 0.05);
      b.fireUntil = b.shotAt + 1.2;
    }
    if (b.shotAt != null && b.alive && this.elapsed >= b.shotAt) {
      if (this.elapsed >= b.fireUntil) {
        b.shotAt = Infinity;
        b.retreat();
      } else if (this.game.playerVisibleFrom(b.headWorld())) {
        b.shotAt = this.elapsed + this.gun.interval;
        const shot = this.gun.shoot(b.headWorld());
        if (shot.hit) {
          this.hp -= shot.damage;
          this.damageTaken += shot.damage;
          this.hudApi.flash('hit', 0.25);
          if (this.hp <= 0) {
            this.deaths += 1;
            this.points -= 50;
            this.hudApi.flash('death', 0.6);
            this.hudApi.banner(`YOU DIED${shot.zone === 'head' ? ' (HEADSHOT)' : ''}: too slow`, 'bad', 1);
            this.game.audio.death();
            b.shotAt = Infinity;
            b.retreat();
          }
        }
      }
    }
    if (b.escaped) {
      this.revealPlacements();
      b.despawn();
      this.bot = null;
      this.next = this.elapsed + this.rng.float(this.delay);
    }
  }

  onShot(s) {
    this.countShot(s);
    if (!s.hit) {
      this.points -= 5;
      return;
    }
    const b = this.bot;
    if (s.killed && s.target === b) {
      const ttk = this.elapsed - (b.firstSeen ?? b.spawnedAt);
      this.ttks.push(ttk);
      this.kills += 1;
      const head = s.zone === 'head';
      if (head) this.hsKills += 1;
      if (b.kind === 'wide') this.wideKills += 1;
      this.points += 100 + Math.max(0, (this.reaction - ttk) / this.reaction) * 100 + (head ? 25 : 0);
      this.revealPlacements();
      const off = b.placement ? ` · ${b.placement.deg.toFixed(1)}° off` : '';
      this.hudApi.feedback(`${fmtMs(ttk)}${off}`, ttk < this.reaction ? 'good' : 'warn', 0.8);
      this.bot = null;
      this.next = this.elapsed + this.rng.float(this.delay);
    }
  }

  hud() {
    return [
      ['Kills', `${this.kills}`],
      ['HP', Math.max(0, this.hp), this.hp < PLAYER_HP ? 'bad' : ''],
      ['Deaths', this.deaths, this.deaths ? 'bad' : ''],
      ['Avg TTK', this.ttks.length ? fmtMs(mean(this.ttks)) : '-'],
      ['Enemy reaction', fmtMs(this.reaction)],
      this.placementHud(),
    ];
  }

  stats() {
    return [
      ['Kills', this.kills],
      ['Deaths', this.deaths],
      ['Damage taken', this.damageTaken],
      ['Peeks faced', this.peeks],
      ['Avg time to kill', this.ttks.length ? fmtMs(mean(this.ttks)) : '-'],
      ['Fastest kill', this.ttks.length ? fmtMs(Math.min(...this.ttks)) : '-'],
      ['Headshot kills', `${pct(this.hsKills, this.kills)}%`],
      ['Wide-swing kills', this.wideKills],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ...this.placementStats(),
    ];
  }
}
