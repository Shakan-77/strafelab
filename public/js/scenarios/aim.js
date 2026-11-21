import * as THREE from 'three';
import { Scenario, dirFromAngles } from './base.js';
import { Bot, Orb } from '../game/targets.js';
import { floor, backdrop, props, pillarRing } from './layouts.js';
import { mean, pct, fmtMs, angleDiff, clamp, DEG } from '../util.js';

// ============================================================ Strafing Bots (rifle taps)
export class StrafeBots extends Scenario {
  constructor(...a) {
    super(...a);
    this.count = this.d({ easy: 2, medium: 3, hard: 3 });
    this.dist = this.d({ easy: [10, 16], medium: [12, 24], hard: [16, 30] });
    this.strafe = this.d({ easy: [0.45, 0.9], medium: [0.22, 0.6], hard: [0.12, 0.45] });
    this.crouchChance = this.d({ easy: 0, medium: 0.06, hard: 0.18 });
    this.pauseChance = this.d({ easy: 0.25, medium: 0.18, hard: 0.12 });
    this.bots = [];
    this.queue = [];
    this.kills = 0;
    this.hsKills = 0;
    this.headHits = 0;
    this.ttks = [];
    this.damageDealt = 0;
  }

  build(w) {
    floor(w);
    backdrop(w, -42);
    props(w, -42);
    w.box([-50, 0, 6], [50, 4, 7], { mat: 'wall' });
  }

  spawn() {
    return { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  }

  begin() {
    for (let i = 0; i < this.count; i++) this.spawnBot();
  }

  spawnBot() {
    const half = this.rng.float(2, 3.5);
    const bot = new Bot(this.game, {
      origin: new THREE.Vector3(this.rng.float(-9, 9), 0, -this.rng.float(this.dist)),
      axis: new THREE.Vector3(1, 0, 0),
      min: -half,
      max: half,
      s: this.rng.float(-half, half),
      behavior: 'adad',
      strafe: this.strafe,
      crouchChance: this.crouchChance,
      pauseChance: this.pauseChance,
      rng: this.rng.fork(),
    });
    bot.spawnedAt = this.elapsed;
    this.bots.push(bot);
  }

  update() {
    this.queue = this.queue.filter((t) => {
      if (this.elapsed >= t) {
        this.spawnBot();
        return false;
      }
      return true;
    });
  }

  onShot(s) {
    this.countShot(s);
    if (!s.hit) {
      this.points -= 5;
      return;
    }
    if (!this.bots.includes(s.target)) return;
    this.damageDealt += Math.min(s.damage, 150);
    if (s.zone === 'head') this.headHits += 1;
    if (s.killed) {
      const head = s.zone === 'head';
      this.kills += 1;
      if (head) this.hsKills += 1;
      this.points += 100 + (head ? 50 : 0);
      this.ttks.push(this.elapsed - s.target.spawnedAt);
      this.bots = this.bots.filter((b) => b !== s.target);
      this.queue.push(this.elapsed + 0.35);
    }
  }

  hud() {
    return [
      ['Kills', this.kills],
      ['Headshots', `${pct(this.headHits, this.hits)}%`],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
    ];
  }

  stats() {
    return [
      ['Kills', this.kills],
      ['Headshot kills', `${pct(this.hsKills, this.kills)}%`],
      ['Headshot hits', `${pct(this.headHits, this.hits)}%`],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ['Avg time to kill', this.ttks.length ? fmtMs(mean(this.ttks)) : '-'],
      ['Damage dealt', Math.round(this.damageDealt)],
      ['Shots fired', this.shots],
    ];
  }
}

// ============================================================ Angle-based single-target base
class FlickBase extends Scenario {
  constructor(...a) {
    super(...a);
    this.allowMove = false;
    this.allowJump = false;
    this.D = 12;
    this.tYaw = 0;
    this.tPitch = 0;
    this.orb = null;
    this.times = [];
    this.misses = 0;
    this.streak = 0;
    this.bestStreak = 0;
  }

  spawn() {
    return { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  }

  placeOrb(r) {
    const eye = this.spawnEye();
    const pos = eye.add(dirFromAngles(this.tYaw, this.tPitch).multiplyScalar(this.D));
    this.orb = new Orb(this.game, pos, r);
    this.orb.spawnedAt = this.elapsed;
    if (this.spawnCue) {
      // positional ping from the target so you can hear which way (and if it's behind you)
      const behind = Math.abs(angleDiff(this.tYaw, this.game.yaw)) > Math.PI / 2;
      this.game.audio.spawnCue(pos, behind);
      this.lastCue = { pos: pos.clone(), behind };
    }
  }

  onShot(s) {
    this.countShot(s);
    if (s.hit && s.target === this.orb) {
      const t = this.elapsed - this.orb.spawnedAt;
      this.times.push(t);
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.onHit(t);
      this.next();
    } else {
      this.misses += 1;
      this.streak = 0;
      this.points -= 20;
    }
  }
}

// ============================================================ Micro Adjust
export class Micro extends FlickBase {
  constructor(...a) {
    super(...a);
    this.r = this.d({ easy: 0.2, medium: 0.14, hard: 0.1 });
    this.off = this.d({ easy: [2, 6], medium: [1.5, 5], hard: [1, 4] });
    this.offsets = [];
  }

  build(w) {
    floor(w, -40, 40, -40, 10);
    w.box([-40, 0, -18], [40, 14, -17], { mat: 'wall' });
    props(w, -16);
  }

  begin() {
    this.next();
  }

  next() {
    const a = this.rng.float(this.off) * DEG;
    const th = this.rng.float(0, Math.PI * 2);
    let y = this.tYaw + a * Math.cos(th);
    let p = this.tPitch + a * Math.sin(th);
    if (Math.abs(y) > 28 * DEG) y = this.tYaw - a * Math.cos(th);
    if (p > 10 * DEG || p < -6 * DEG) p = this.tPitch - a * Math.sin(th);
    this.tYaw = clamp(y, -30 * DEG, 30 * DEG);
    this.tPitch = clamp(p, -7 * DEG, 11 * DEG);
    this.offsets.push(a / DEG);
    this.placeOrb(this.r);
  }

  onHit(t) {
    this.points += 100 + Math.max(0, (0.6 - t) / 0.6) * 50;
  }

  hud() {
    return [
      ['Hits', this.hits],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ['Streak', this.streak],
    ];
  }

  stats() {
    return [
      ['Hits', this.hits],
      ['Misses', this.misses],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ['Avg time per target', this.times.length ? fmtMs(mean(this.times)) : '-'],
      ['Best streak', this.bestStreak],
      ['Avg adjustment', `${mean(this.offsets).toFixed(1)}°`],
    ];
  }
}

// ============================================================ Macro Flicks
export class Macro extends FlickBase {
  constructor(...a) {
    super(...a);
    this.r = this.d({ easy: 0.32, medium: 0.25, hard: 0.18 });
    this.range = this.d({ easy: [30, 70], medium: [45, 110], hard: [60, 150] });
    this.overs = 0;
    this.unders = 0;
    this.cleans = 0;
    this.flick = null;
    this.lastYaw = 0;
    this.spawnCue = true; // 360° drill: every spawn pings from the target's direction
  }

  build(w) {
    floor(w, -40, 40, -40, 40);
    pillarRing(w, 22, 18);
  }

  begin() {
    this.next();
  }

  next() {
    const mag = this.rng.float(this.range) * DEG * this.rng.sign();
    this.tYaw = angleDiff(this.tYaw + mag, 0);
    this.tPitch = this.rng.float(-8, 14) * DEG;
    this.placeOrb(this.r);
    const e0 = angleDiff(this.tYaw, this.game.yaw);
    this.flick = { sign: Math.sign(e0) || 1, start: Math.abs(e0), over: false, under: false, slowT: 0 };
    this.lastYaw = this.game.yaw;
  }

  update(dt) {
    const f = this.flick;
    if (!f || !this.orb?.alive || dt <= 0) return;
    const angR = Math.atan(this.r / this.D);
    const e = angleDiff(this.tYaw, this.game.yaw) * f.sign;
    if (e < -angR * 1.15) f.over = true;
    const vel = Math.abs(angleDiff(this.game.yaw, this.lastYaw)) / dt;
    this.lastYaw = this.game.yaw;
    const progressed = f.start - e > f.start * 0.3;
    if (!f.over && progressed && e > angR * 1.5 && vel < 20 * DEG) {
      f.slowT += dt;
      if (f.slowT > 0.06) f.under = true;
    } else {
      f.slowT = 0;
    }
  }

  onHit(t) {
    const f = this.flick;
    if (f.over) this.overs += 1;
    else if (f.under) this.unders += 1;
    else this.cleans += 1;
    this.hudApi.feedback(f.over ? 'OVERSHOOT' : f.under ? 'UNDERSHOOT' : 'CLEAN FLICK', f.over || f.under ? 'warn' : 'good', 0.5);
    this.points += 100 + Math.max(0, (0.9 - t) / 0.9) * 100;
  }

  hud() {
    const n = this.hits || 1;
    return [
      ['Hits', this.hits],
      ['Clean', `${pct(this.cleans, n)}%`, 'good'],
      ['Overshoot', `${pct(this.overs, n)}%`],
      ['Undershoot', `${pct(this.unders, n)}%`],
    ];
  }

  stats() {
    const n = this.hits;
    let verdict = 'Balanced';
    if (n >= 5 && this.overs > this.unders * 1.6 && this.overs / n > 0.3) verdict = 'Mostly overshooting: relax your grip or try a slightly lower sens';
    else if (n >= 5 && this.unders > this.overs * 1.6 && this.unders / n > 0.3) verdict = 'Mostly undershooting: commit to the flick';
    return [
      ['Hits', n],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ['Avg flick time', this.times.length ? fmtMs(mean(this.times)) : '-'],
      ['Clean flicks', `${pct(this.cleans, n)}%`],
      ['Overshoots', `${pct(this.overs, n)}%`],
      ['Undershoots', `${pct(this.unders, n)}%`],
      ['Read', verdict],
    ];
  }
}

// ============================================================ Sniper: strafing targets
export class Sniper extends Scenario {
  constructor(...a) {
    super(...a);
    this.feedback = 'movement';
    this.maxActive = this.d({ easy: 1, medium: 1, hard: 2 });
    this.types = this.d({ easy: ['adad', 'adad', 'cross'], medium: ['adad', 'adad', 'cross'], hard: ['adad', 'cross', 'cross'] });
    this.strafe = this.d({ easy: [0.5, 1.0], medium: [0.25, 0.7], hard: [0.15, 0.5] });
    this.crossStop = this.d({ easy: 0.6, medium: 0.3, hard: 0.1 });
    this.bots = [];
    this.next = 0;
    this.kills = 0;
    this.killsByType = { adad: 0, cross: 0 };
    this.escapes = 0;
    this.legHits = 0;
    this.unscoped = 0;
    this.moving = 0;
    this.ttks = [];
  }

  build(w) {
    floor(w, -30, 30, -80, 8);
    // far wall with two doorway gaps; crossers sprint behind it
    w.box([-30, 0, -45], [-9, 3.6, -44], { mat: 'cover' });
    w.box([-5, 0, -45], [4, 3.6, -44], { mat: 'cover' });
    w.box([8, 0, -45], [30, 3.6, -44], { mat: 'cover' });
    w.box([-30, 0, -53], [30, 8, -52], { mat: 'wall' });
    // mid-field low cover for depth
    for (const [x, z] of [[-13, -27], [12, -31], [-4, -36], [18, -22]]) w.box([x - 1, 0, z - 1], [x + 1, 0.9, z + 1], { mat: 'cover' });
    w.box([-30, 0, -80], [-29, 6, 8], { mat: 'wall' });
    w.box([29, 0, -80], [30, 6, 8], { mat: 'wall' });
    w.box([-30, 0, 6], [30, 4, 7], { mat: 'wall' });
  }

  spawn() {
    return { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  }

  begin() {
    this.next = 0.8;
    const key = this.game.keyName('scope');
    this.hudApi.banner(this.game.modes.scope === 'hold' ? `Hold ${key} to scope` : `${key} to scope (2.5x → 5x)`, 'info', 1.6);
  }

  spawnBot() {
    const type = this.rng.pick(this.types);
    let bot;
    if (type === 'cross') {
      const dir = this.rng.sign();
      const gap = this.rng.pick([-7, 6]);
      bot = new Bot(this.game, {
        origin: new THREE.Vector3(0, 0, -48.5),
        axis: new THREE.Vector3(1, 0, 0),
        min: -17,
        max: 17,
        s: dir > 0 ? -17 : 17,
        behavior: 'cross',
        dir,
        stopAt: this.rng.chance(this.crossStop) ? gap + this.rng.float(-0.8, 0.8) : null,
        stopTime: this.rng.float(0.3, 0.7),
        kind: 'cross',
        rng: this.rng.fork(),
      });
    } else {
      const half = this.rng.float(2, 3.5);
      bot = new Bot(this.game, {
        origin: new THREE.Vector3(this.rng.float(-14, 14), 0, -this.rng.float(22, 38)),
        axis: new THREE.Vector3(1, 0, 0),
        min: -half,
        max: half,
        s: this.rng.float(-half, half),
        behavior: 'adad',
        strafe: this.strafe,
        crouchChance: this.d({ easy: 0, medium: 0.05, hard: 0.15 }),
        kind: 'adad',
        rng: this.rng.fork(),
      });
    }
    bot.spawnedAt = this.elapsed;
    this.bots.push(bot);
  }

  update() {
    if (this.bots.length < this.maxActive && this.elapsed >= this.next) {
      this.spawnBot();
      this.next = this.elapsed + this.rng.float(0.5, 1.2);
    }
    for (const b of this.bots) {
      if (b.firstSeen == null && this.game.botVisible(b)) b.firstSeen = this.elapsed;
      if (b.escaped) {
        b.despawn();
        this.escapes += 1;
        this.hudApi.banner('ESCAPED', 'warn', 0.6);
        this.next = this.elapsed + this.rng.float(0.4, 1.0);
      }
    }
    this.bots = this.bots.filter((b) => b.alive);
  }

  onShot(s) {
    this.countShot(s);
    if (!s.scoped) {
      this.unscoped += 1;
      this.points -= 10;
    }
    if (!s.accurate) this.moving += 1;
    if (!s.hit || !this.bots.includes(s.target)) {
      if (!s.hit) this.points -= 10;
      return;
    }
    const b = s.target;
    if (s.killed) {
      const ttk = this.elapsed - (b.firstSeen ?? b.spawnedAt);
      this.ttks.push(ttk);
      this.kills += 1;
      this.killsByType[b.kind] = (this.killsByType[b.kind] || 0) + 1;
      this.points += 100 + Math.max(0, 1 - ttk / 1.5) * 100;
      this.bots = this.bots.filter((x) => x !== b);
      this.next = this.elapsed + this.rng.float(0.4, 1.0);
    } else {
      this.legHits += 1;
      this.points += 20;
    }
  }

  hud() {
    return [
      ['Kills', this.kills],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ['Escaped', this.escapes],
    ];
  }

  stats() {
    return [
      ['Kills', this.kills],
      ['Strafer kills', this.killsByType.adad || 0],
      ['Crosser kills', this.killsByType.cross || 0],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ['Avg time to kill', this.ttks.length ? fmtMs(mean(this.ttks)) : '-'],
      ['Leg hits (no kill)', this.legHits],
      ['Escaped', this.escapes],
      ['Unscoped shots', this.unscoped],
      ['Moving shots', this.moving],
    ];
  }
}
