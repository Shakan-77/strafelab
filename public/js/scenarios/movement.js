import * as THREE from 'three';
import { Scenario, PREAIM_DEG, fmtBias } from './base.js';
import { Bot, Orb } from '../game/targets.js';
import { MOVE } from '../game/player.js';
import { BotGun, PLAYER_HP } from '../game/botfire.js';
import { floor, backdrop, strafeLane, props } from './layouts.js';
import { mean, pct, fmtMs } from '../util.js';

// ============================================================ Counter-Strafe Drill
export class CounterStrafe extends Scenario {
  constructor(...a) {
    super(...a);
    this.feedback = 'movement';
    this.window = this.d({ easy: 1.6, medium: 1.15, hard: 0.85 });
    this.dist = this.d({ easy: [12, 16], medium: [14, 22], hard: [18, 28] });
    this.target = null;
    this.next = 0;
    this.spawned = 0;
    this.kills = 0;
    this.hsKills = 0;
    this.timeouts = 0;
    this.movingShots = 0;
    this.ttks = [];
    this.stops = [];
    this.firstShots = 0;
    this.firstAccurate = 0;
    this.lastHint = -10;
  }

  build(w) {
    floor(w);
    strafeLane(w, 7);
    backdrop(w, -40);
    props(w, -40);
  }

  begin() {
    this.next = 0.6;
  }

  update() {
    const p = this.player;
    if (!this.target) {
      if (this.elapsed >= this.next) {
        if (p.hspeed() >= 0.8 * p.runSpeed) this.spawnTarget();
        else if (this.elapsed - this.lastHint > 3) {
          this.lastHint = this.elapsed;
          this.hudApi.banner(`Strafe ${this.game.keyName('left')} / ${this.game.keyName('right')} at full speed to draw a peek`, 'info', 1.4);
        }
      }
    } else if (this.target.alive && this.elapsed - this.target.spawnedAt > this.window) {
      this.target.despawn();
      this.target = null;
      this.timeouts += 1;
      this.hudApi.banner('TOO SLOW', 'bad', 0.8);
      this.next = this.elapsed + this.rng.float(0.5, 1.1);
    }
  }

  spawnTarget() {
    const z = -this.rng.float(this.dist);
    const x = this.rng.float(-7, 7);
    this.target = new Bot(this.game, { origin: new THREE.Vector3(x, 0, z), behavior: 'static', rng: this.rng.fork() });
    this.target.spawnedAt = this.elapsed;
    this.spawned += 1;
    this.firstShotDone = false;
  }

  onShot(s) {
    this.countShot(s);
    const t = this.target;
    if (t && !this.firstShotDone) {
      this.firstShotDone = true;
      this.firstShots += 1;
      if (s.accurate) this.firstAccurate += 1;
    }
    if (!s.accurate) {
      this.movingShots += 1;
      this.points -= 15;
    }
    if (s.killed && s.target === t) {
      const ttk = this.elapsed - t.spawnedAt;
      this.ttks.push(ttk);
      this.kills += 1;
      const head = s.zone === 'head';
      if (head) this.hsKills += 1;
      this.points += 100 + Math.max(0, (this.window - ttk) / this.window) * 100 + (head ? 50 : 0);
      this.target = null;
      this.next = this.elapsed + this.rng.float(0.4, 1.0);
    }
  }

  onPlayerEvent(type, d) {
    if (type !== 'stop') return;
    this.stops.push(d);
    if (this.game.settings.showFeedback && this.game.state === 'running') {
      this.hudApi.banner(`${d.counter ? 'COUNTER-STRAFE' : 'RELEASE STOP'} · ${fmtMs(d.duration)}`, d.counter ? 'good' : 'warn', 0.7);
    }
  }

  stopStats() {
    const c = this.stops.filter((s) => s.counter);
    return { avg: mean(this.stops.map((s) => s.duration)), counterPct: pct(c.length, this.stops.length), counterAvg: mean(c.map((s) => s.duration)) };
  }

  hud() {
    const st = this.stopStats();
    return [
      ['Kills', `${this.kills} / ${this.spawned}`],
      ['Moving shots', this.movingShots, this.movingShots ? 'bad' : ''],
      ['Avg stop', this.stops.length ? fmtMs(st.avg) : '-'],
      ['Counter-strafes', `${st.counterPct}%`],
    ];
  }

  stats() {
    const st = this.stopStats();
    return [
      ['Kills', `${this.kills} / ${this.spawned}`],
      ['Headshot kills', `${pct(this.hsKills, this.kills)}%`],
      ['Avg time to kill', this.ttks.length ? fmtMs(mean(this.ttks)) : '-'],
      ['First shot accurate', `${pct(this.firstAccurate, this.firstShots)}%`],
      ['Moving shots', this.movingShots],
      ['Avg stop time', this.stops.length ? fmtMs(st.avg) : '-'],
      ['Counter-strafe stops', `${st.counterPct}%`],
      ['Avg counter-strafe', st.counterAvg ? fmtMs(st.counterAvg) : '-'],
      ['Timed out', this.timeouts],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
    ];
  }
}

// ============================================================ ADAD Strafe Shooting
export class StrafeShoot extends Scenario {
  constructor(...a) {
    super(...a);
    this.feedback = 'movement';
    this.r = this.d({ easy: 0.22, medium: 0.16, hard: 0.12 });
    this.count = this.d({ easy: 3, medium: 3, hard: 2 });
    this.orbs = [];
    this.respawnAt = [];
    this.side = 0;
    this.reversals = 0;
    this.revTimes = [];
    this.lastRev = null;
    this.lastActive = -10;
    this.lastWarn = -10;
    this.peakHits = 0;
    this.peakShots = 0;
    this.luckyHits = 0;
    this.idleShots = 0;
    this.speeds = [];
  }

  build(w) {
    floor(w);
    strafeLane(w, 7);
    backdrop(w, -30);
    props(w, -30);
  }

  begin() {
    for (let i = 0; i < this.count; i++) this.spawnOrb();
    this.lastActive = 0;
  }

  spawnOrb() {
    const pos = new THREE.Vector3(this.rng.float(-6.5, 6.5), this.rng.float(1.3, 1.8), -this.rng.float(10, 18));
    this.orbs.push(new Orb(this.game, pos, this.r));
  }

  update() {
    const p = this.player;
    const yaw = this.game.yaw;
    const lat = p.vel.x * Math.cos(yaw) - p.vel.z * Math.sin(yaw);
    if (lat > 1.5 && this.side !== 1) {
      if (this.side === -1) this.reversal();
      this.side = 1;
    } else if (lat < -1.5 && this.side !== -1) {
      if (this.side === 1) this.reversal();
      this.side = -1;
    }
    if (p.hspeed() > 0.5 * p.runSpeed) this.lastActive = this.elapsed;
    this.strafing = this.elapsed - this.lastActive < 0.75;
    if (!this.strafing && this.elapsed - this.lastWarn > 1.5) {
      this.lastWarn = this.elapsed;
      this.hudApi.banner(`KEEP STRAFING (${this.game.keyName('left')} / ${this.game.keyName('right')})`, 'warn', 1.0);
    }
    this.respawnAt = this.respawnAt.filter((t) => {
      if (this.elapsed >= t) {
        this.spawnOrb();
        return false;
      }
      return true;
    });
  }

  reversal() {
    this.reversals += 1;
    if (this.lastRev != null) this.revTimes.push(this.elapsed - this.lastRev);
    this.lastRev = this.elapsed;
  }

  onShot(s) {
    this.countShot(s);
    const peak = s.accurate && this.strafing;
    if (peak) this.peakShots += 1;
    if (!this.strafing) this.idleShots += 1;
    this.speeds.push(s.speed);
    if (s.hit && this.orbs.includes(s.target)) {
      if (peak) {
        this.points += 100;
        this.peakHits += 1;
      } else if (s.accurate) {
        this.points += 25;
      } else {
        this.points += 10;
        this.luckyHits += 1;
      }
      this.orbs = this.orbs.filter((o) => o !== s.target);
      this.respawnAt.push(this.elapsed + 0.15);
    } else if (!s.accurate) {
      this.points -= 10;
    }
  }

  hud() {
    return [
      ['Peak hits', this.peakHits],
      ['Peak timing', `${pct(this.peakShots, this.shots)}%`],
      ['Strafes', this.reversals],
      ['Status', this.strafing ? 'STRAFING' : 'IDLE', this.strafing ? 'good' : 'bad'],
    ];
  }

  stats() {
    return [
      ['Peak-timed hits', this.peakHits],
      ['Shots at strafe peak', `${pct(this.peakShots, this.shots)}%`],
      ['Lucky moving hits', this.luckyHits],
      ['Shots while idle', this.idleShots],
      ['Avg speed at shot', `${mean(this.speeds).toFixed(2)} m/s`],
      ['Direction changes', this.reversals],
      ['Avg strafe length', this.revTimes.length ? fmtMs(mean(this.revTimes)) : '-'],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
    ];
  }
}

// ============================================================ Course builder
/**
 * Lays out platforms relative to a cursor: origin = centre of the edge you jump from,
 * heading h (0 = -Z, 1 = +X, 2 = +Z, 3 = -X). Local x' = right, local z' negative = forward.
 */
class Course {
  constructor(world) {
    this.w = world;
    this.ox = 0;
    this.oz = 0;
    this.oy = 0;
    this.h = 0;
    this.checkpoints = [];
    this.minTop = 0;
  }

  pt(lx, lz) {
    const { ox, oz } = this;
    switch (this.h & 3) {
      case 0: return [ox + lx, oz + lz];
      case 1: return [ox - lz, oz + lx];
      case 2: return [ox - lx, oz - lz];
      default: return [ox + lz, oz - lx];
    }
  }

  rect(lx0, lz0, lx1, lz1) {
    const [ax, az] = this.pt(lx0, lz0);
    const [bx, bz] = this.pt(lx1, lz1);
    return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
  }

  box(lx0, lz0, lx1, lz1, y0, y1, mat) {
    const [x0, z0, x1, z1] = this.rect(lx0, lz0, lx1, lz1);
    return this.w.box([x0, y0, z0], [x1, y1, z1], { mat });
  }

  plat(lx0, lz0, lx1, lz1, top, mat = 'platform') {
    this.minTop = Math.min(this.minTop, top);
    return this.box(lx0, lz0, lx1, lz1, top - 0.8, top, mat);
  }

  yaw() {
    return -(this.h & 3) * (Math.PI / 2);
  }

  /** Straight jump: gap g then a platform of length len, width wid, height change dy, lateral offset xo. */
  gap(g, len, wid, dy = 0, xo = 0) {
    const top = this.oy + dy;
    this.plat(xo - wid / 2, -g - len, xo + wid / 2, -g, top);
    this.last = { lx0: xo - wid / 2, lz0: -g - len, lx1: xo + wid / 2, lz1: -g, top, h: this.h, ox: this.ox, oz: this.oz };
    [this.ox, this.oz] = this.pt(xo, -g - len);
    this.oy = top;
  }

  /**
   * Curve jump: runway, then a tall wall blocks the straight line; the landing is beside and behind it.
   * Only reachable by curving mid-air (strafe toward the turn while sweeping the mouse).
   */
  curve(dir, { gp, bx, drop, runway = 6 }) {
    const m = (a, b) => (dir > 0 ? [a, b] : [-b, -a]);
    const top = this.oy;
    (this.curves ||= []).push({ ox: this.ox, oz: this.oz, h: this.h, top, dir, gp, runway, bx, drop });
    const [ax0, ax1] = m(-1.1, 0.5);
    this.plat(ax0, -gp - runway, ax1, -gp, top);
    const base = gp + runway;
    const [wx0, wx1] = m(0.9, 7.5);
    this.box(wx0, -(base + 2.5), wx1, -(base + 0.3), top - 3, top + 4.5, 'cover');
    const [bx0, bx1] = m(bx, bx + 3.4);
    const btop = top - drop;
    this.plat(bx0, -(base + 7.5), bx1, -(base + 2.6), btop);
    // guide stripe showing the curve direction on the runway
    const [sx0, sx1] = m(0.15, 0.45);
    const [gx0, gz0, gx1, gz1] = this.rect(sx0, -gp - runway + 0.2, sx1, -gp - 0.2);
    this.w.box([gx0, top, gz0], [gx1, top + 0.02, gz1], { mat: 'warm', collide: false, block: false });
    this.last = null;
    const edge = dir > 0 ? bx + 3.4 : -(bx + 3.4);
    [this.ox, this.oz] = this.pt(edge, -(base + 5.05));
    this.h = (this.h + dir + 4) & 3;
    this.oy = btop;
  }

  /** Mark the last straight platform as a checkpoint. */
  checkpoint(scn) {
    const L = this.last;
    if (!L) return;
    const save = { ox: this.ox, oz: this.oz, h: this.h };
    Object.assign(this, { ox: L.ox, oz: L.oz, h: L.h });
    const [x0, z0, x1, z1] = this.rect(L.lx0, L.lz0, L.lx1, L.lz1);
    Object.assign(this, save);
    const z = this.w.zone([x0, L.top, z0], [x1, L.top + 2.5, z1], 'checkpoint', { opacity: 0.18 });
    z.data.spawn = [(x0 + x1) / 2, L.top + 0.05, (z0 + z1) / 2];
    z.data.yaw = -(L.h & 3) * (Math.PI / 2);
    z.data.index = scn.checkpointCount++;
  }

  finish(len = 8, wid = 5, g = 2.5) {
    this.gap(g, len, wid);
    const L = this.last;
    const save = { ox: this.ox, oz: this.oz, h: this.h };
    Object.assign(this, { ox: L.ox, oz: L.oz, h: L.h });
    const [x0, z0, x1, z1] = this.rect(L.lx0, L.lz0 + 0.5, L.lx1, L.lz0 + 3);
    Object.assign(this, save);
    this.w.zone([x0, L.top, z0], [x1, L.top + 3, z1], 'finish', { opacity: 0.3, wall: true });
  }
}

/** Shared time-trial behaviour for the two courses. */
class TimeTrial extends Scenario {
  constructor(...a) {
    super(...a);
    this.ghosts = true;
    this.penalty = 0;
    this.falls = 0;
    this.checkpoint = null;
    this.checkpointCount = 0;
    this.finishTime = null;
  }

  score() {
    const t = this.finishTime ?? this.elapsed;
    return Math.round((t + this.penalty) * 1000);
  }

  results() {
    const r = super.results();
    if (this.finishTime == null) r.dnf = true;
    return r;
  }

  addPenalty(sec, text) {
    this.penalty += sec;
    this.hudApi.banner(`${text} +${sec}s`, 'bad', 1.0);
    this.game.audio.bad();
  }

  onFall() {
    this.falls += 1;
    const cp = this.checkpoint;
    const sp = this.spawn();
    this.game.respawn(cp ? cp.data.spawn : sp.pos, cp ? cp.data.yaw : sp.yaw, 0);
    this.addPenalty(2, 'FELL');
  }

  checkZones() {
    const p = this.player.pos;
    for (const z of this.game.world.zonesAt(p)) {
      if (z.type === 'checkpoint' && (!this.checkpoint || z.data.index > this.checkpoint.data.index)) {
        this.checkpoint = z;
        this.hudApi.banner(`CHECKPOINT ${z.data.index + 1}`, 'good', 0.8);
        this.game.audio.beep(false);
      }
      if (z.type === 'finish') this.tryFinish();
      this.zone?.(z);
    }
  }

  tryFinish() {
    if (this.finishTime != null) return;
    this.finishTime = this.elapsed;
    this.finished = true;
  }

  hud() {
    return [
      ['Penalty', `+${this.penalty.toFixed(0)}s`, this.penalty ? 'bad' : ''],
      ['Falls', this.falls],
      ['Checkpoint', this.checkpoint ? `${this.checkpoint.data.index + 1} / ${this.checkpointCount}` : `0 / ${this.checkpointCount}`],
    ];
  }
}

// ============================================================ Air Strafe Course
export class AirCourse extends TimeTrial {
  constructor(...a) {
    super(...a);
    this.jumps = 0;
  }

  build(w) {
    const G = this.d({ easy: [2.2, 2.6, 3.1], medium: [2.6, 3.1, 3.7], hard: [3.0, 3.5, 4.1] });
    const W = this.d({ easy: 3.2, medium: 2.6, hard: 2.0 });
    const L = this.d({ easy: 6, medium: 5, hard: 4 });
    // Simulated from the inside stripe at the runway lip. Hard bends need
    // a faster camera sweep than Easy or Medium.
    const bx = this.d({ easy: 1.5, medium: 1.8, hard: 2.0 });
    const drop = this.d({ easy: 1.8, medium: 1.6, hard: 1.4 });
    const c = new Course(w);
    this.course = c;
    // start platform
    w.box([-2.5, -0.8, -6], [2.5, 0, 4], { mat: 'platform' });
    w.box([-2.5, 0, 4], [2.5, 3, 4.5], { mat: 'wall' });
    c.ox = 0;
    c.oz = -6;
    c.gap(G[0], L, W);
    c.gap(G[1], L, W);
    c.gap(G[0] - 0.4, L, W, 0.5);
    c.checkpoint(this);
    c.curve(1, { gp: G[0], bx, drop });
    c.gap(G[1], L, W);
    c.checkpoint(this);
    c.curve(-1, { gp: G[0], bx, drop });
    c.gap(G[0], 3, 1.7, 0, 1.2);
    c.gap(G[0], 3, 1.7, 0, -2.4);
    c.gap(G[0], 3, 1.7, 0, 2.4);
    c.gap(G[0], L, W, 0, -1.2);
    c.checkpoint(this);
    c.gap(G[2], L + 1, W);
    c.curve(1, { gp: G[0], bx, drop });
    c.gap(G[1], L, W, -0.5);
    c.checkpoint(this);
    c.curve(1, { gp: G[0], bx: bx + 0.1, drop });
    c.finish(8, 5, G[0]);
    this.killY = c.minTop - 7;
    // void floor far below for depth reference
    w.box([-200, c.minTop - 40, -260], [200, c.minTop - 39, 120], { mat: 'floor', collide: false });
  }

  spawn() {
    return { pos: [0, 0.05, 1.5], yaw: 0, pitch: 0 };
  }

  update() {
    this.checkZones();
  }

  onPlayerEvent(type) {
    if (type === 'jump') this.jumps += 1;
  }

  stats() {
    return [
      ['Time', this.finishTime != null ? `${this.finishTime.toFixed(2)}s` : 'DNF'],
      ['Penalties', `+${this.penalty.toFixed(0)}s`],
      ['Falls', this.falls],
      ['Jumps', this.jumps],
    ];
  }
}

// ============================================================ Movement Course (game-like)
export class MoveCourse extends TimeTrial {
  constructor(...a) {
    super(...a);
    this.feedback = 'movement';
    this.noiseFeedback = true;
    this.noise = 0;
    this.traded = 0;
    this.gallery = [];
    this.galleryOn = false;
    this.botExposure = 0;
    this.botHidden = 0;
    this.gun = new BotGun(this.game, this.rng.fork(), this.diff);
    this.reaction = this.gun.reaction;
    this.hp = PLAYER_HP;
  }

  build(w) {
    const H = 3.5;
    floor(w, -20, 20, -130, 12);
    // corridor walls (x = ±3) from start to the final room
    w.box([-3.5, 0, -81], [-3, H, 6], { mat: 'wall' });
    w.box([3, 0, -81], [3.5, H, 6], { mat: 'wall' });
    w.box([-3.5, 0, 6], [3.5, H, 6.5], { mat: 'wall' });
    // 1. silent zone, with a ledge only a crouch-jump reaches; walk down the steps after it
    w.zone([-3, 0, -22], [3, 3, -6], 'silent', { opacity: 0.22 });
    const lh = this.d({ easy: 0.98, medium: 1.03, hard: 1.08 });
    w.box([-3, 0, -14], [3, lh, -11], { mat: 'platform' });
    for (let s = 1; s <= 3; s++) w.box([-3, 0, -14 - 0.8 * s], [3, lh * (1 - s / 4), -14 - 0.8 * (s - 1)], { mat: 'cover' });
    // 2. crouch vent
    w.box([-3, 0, -34], [-1.1, H, -26], { mat: 'cover' });
    w.box([1.1, 0, -34], [3, H, -26], { mat: 'cover' });
    w.box([-1.1, 1.45, -34], [1.1, H, -26], { mat: 'cover' });
    w.zone([-1.1, 0, -34], [1.1, 1.4, -26], 'crouch', { opacity: 0.18 });
    // 3. box climb
    w.box([-3, 0, -41.5], [3, 0.65, -39], { mat: 'platform' });
    w.box([-3, 0, -44], [3, 1.3, -41.5], { mat: 'platform' });
    // 4. shooting gallery: targets on the far wall open the gate
    this.gate = w.box([-3, 0, -72.6], [3, H, -72], { mat: 'warm' });
    w.zone([-3, 0, -54], [3, 3, -52], 'trigger', { visible: false });
    // 5. held room: doorway on the right, enemy holding inside
    w.box([-3, 0, -81], [1.2, H, -80], { mat: 'wall' });
    w.box([-6.5, 0, -81], [-3, H, -80], { mat: 'wall' });
    w.box([3, 0, -81], [6.5, H, -80], { mat: 'wall' });
    w.box([-6.5, 0, -104], [-6, H, -80], { mat: 'wall' });
    w.box([6, 0, -104], [6.5, H, -80], { mat: 'wall' });
    w.box([-6.5, 0, -104.5], [6.5, H, -104], { mat: 'wall' });
    w.box([-1, 0, -92], [1, 1.1, -90.5], { mat: 'cover' });
    w.zone([-6, 0, -103.5], [6, 3, -101], 'finish', { opacity: 0.3, wall: true });
    this.killY = -10;
  }

  spawn() {
    return { pos: [0, 0.05, 3], yaw: 0, pitch: 0 };
  }

  begin() {
    this.roomBot = new Bot(this.game, {
      origin: new THREE.Vector3(-4.2, 0, -97),
      behavior: 'static',
      rng: this.rng.fork(),
    });
    this.hudApi.banner(`Walk (${this.game.keyName('walk')}) through the purple zone and crouch-jump the ledge`, 'info', 2.2);
  }

  zone(z) {
    if (z.type === 'trigger' && !this.galleryOn) {
      this.galleryOn = true;
      for (let i = 0; i < 4; i++) {
        const pos = new THREE.Vector3(-2.2 + i * 1.45, this.rng.float(1.2, 2.3), -71.75);
        this.gallery.push(new Orb(this.game, pos, 0.2));
      }
      this.hudApi.banner('Clear the gallery. Stop before you shoot!', 'info', 1.6);
    }
  }

  onPlayerEvent(type, d) {
    const heard = type === 'step' || ((type === 'land' || type === 'jump') && d.loud);
    if (!heard) return;
    if (this.game.world.zonesAt(this.player.pos).some((z) => z.type === 'silent')) {
      this.noise += 1;
      this.addPenalty(1, { step: 'FOOTSTEPS HEARD', jump: 'JUMP HEARD', land: 'LANDING HEARD' }[type]);
    }
  }

  update(dt) {
    this.checkZones();
    const bot = this.roomBot;
    if (bot && bot.alive) {
      if (!this.roomPlacement && this.game.botVisible(bot)) this.roomPlacement = this.notePlacement(bot);
      const sees = this.game.playerVisibleFrom(bot.headWorld());
      if (sees) {
        this.botExposure += dt;
        this.botHidden = 0;
        this.hudApi.exposed(true, this.botExposure);
      } else {
        this.botHidden += dt;
        if (this.botHidden > 0.3) this.botExposure = 0;
        this.hudApi.exposed(false);
      }
      // shared bot model: after its reaction time it fires taps; if they'd have killed you, +2s
      if (sees && this.botExposure >= this.reaction && this.elapsed >= (this.botNextShot || 0)) {
        this.botNextShot = this.elapsed + this.gun.interval;
        const shot = this.gun.shoot(bot.headWorld());
        if (shot.hit) {
          this.hp -= shot.damage;
          this.hudApi.flash('hit', 0.25);
          if (this.hp <= 0) {
            this.hp = PLAYER_HP;
            this.botExposure = 0;
            this.traded += 1;
            this.addPenalty(2, 'TRADED');
          }
        }
      }
    } else {
      this.hudApi.exposed(false);
    }
  }

  tryFinish() {
    if (this.roomBot && this.roomBot.alive) {
      if (this.elapsed - (this.warnT || -9) > 1.5) {
        this.warnT = this.elapsed;
        this.hudApi.banner('Clear the room first', 'warn', 1);
      }
      return;
    }
    super.tryFinish();
  }

  onShot(s) {
    this.countShot(s);
    if (s.killed && s.target === this.roomBot && this.roomPlacement) {
      this.hudApi.banner(`ROOM CLEARED · crosshair ${this.roomPlacement.deg.toFixed(1)}° off on entry`, this.roomPlacement.deg <= PREAIM_DEG ? 'good' : 'warn', 1.4);
    }
    if (s.hit && this.gallery.includes(s.target)) {
      this.gallery = this.gallery.filter((o) => o !== s.target);
      if (!this.gallery.length) {
        this.game.world.remove(this.gate);
        this.hudApi.banner('GATE OPEN', 'good', 1);
        this.game.audio.good();
      }
    }
  }

  stats() {
    return [
      ['Time', this.finishTime != null ? `${this.finishTime.toFixed(2)}s` : 'DNF'],
      ['Penalties', `+${this.penalty.toFixed(0)}s`],
      ['Noises heard', this.noise],
      ['Times traded', this.traded],
      ['Falls', this.falls],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ['Room entry placement', this.roomPlacement ? `${this.roomPlacement.deg.toFixed(1)}° off · ${fmtBias(this.roomPlacement.vert)}` : '-'],
    ];
  }

  hud() {
    return [
      ['Penalty', `+${this.penalty.toFixed(0)}s`, this.penalty ? 'bad' : ''],
      ['Noise', this.noise],
      ['Gallery', this.galleryOn ? `${4 - this.gallery.length} / 4` : '-'],
      ['Traded', this.traded],
    ];
  }
}

// ============================================================ Silent Jumps
/**
 * Six ledges a normal jump can't reach, all inside a sound zone. Walk up holding Walk (so the
 * take-off is silent), crouch-jump onto each ledge so you land near the top of your arc (silent),
 * then walk down the steps (small drops are silent at walking speed). Every footstep, jump or
 * landing that would be heard costs +2s.
 */
export class SilentJumps extends TimeTrial {
  constructor(...a) {
    super(...a);
    this.noiseFeedback = true;
    // above a normal jump (feet apex ~1.0 m), below a crouch-jump (~1.2 m: 0.95 m crouched launch + 0.25 m tuck)
    this.base = this.d({ easy: 1.03, medium: 1.07, hard: 1.11 });
    this.count = 6;
    this.ledgeZ = [];
    this.landings = 0;
    this.silent = 0;
    this.loudHard = 0;
    this.loudFast = 0;
    this.footsteps = 0;
    this.crouchJumps = 0;
    this.jumps = 0;
    this.silentJumps = 0;
    this.loudJumpNoWalk = 0;
  }

  build(w) {
    const W = 2.6;
    const H = 4;
    const vary = [0, 0.03, -0.02, 0.04, 0.01, 0.03];
    let z = -6;
    // stairs down the far side: each step drops at most h / STEPS (≤ 0.23 m), well under the
    // 0.31 m loud-landing fall, so walking down them is always silent
    const STEPS = 5;
    const STEP_D = 0.8;
    for (let i = 0; i < this.count; i++) {
      const h = Math.min(1.15, this.base + vary[i]);
      this.ledgeZ.push(z);
      w.box([-W, 0, z - 3], [W, h, z], { mat: 'platform' });
      for (let s = 1; s < STEPS; s++) w.box([-W, 0, z - 3 - STEP_D * s], [W, h * (1 - s / STEPS), z - 3 - STEP_D * (s - 1)], { mat: 'cover' });
      z -= 3 + STEP_D * (STEPS - 1) + 4.5;
    }
    const end = z - 4;
    floor(w, -20, 20, end - 10, 12);
    w.box([-W - 0.5, 0, end - 1.5], [-W, H, 6.5], { mat: 'wall' });
    w.box([W, 0, end - 1.5], [W + 0.5, H, 6.5], { mat: 'wall' });
    w.box([-W - 0.5, 0, 6], [W + 0.5, H, 6.5], { mat: 'wall' });
    w.box([-W - 0.5, 0, end - 1.5], [W + 0.5, H, end - 1], { mat: 'wall' });
    w.zone([-W, 0, end], [W, 3, -2], 'silent', { opacity: 0.14 });
    w.zone([-W, 0, end], [W, 3, end + 2.5], 'finish', { opacity: 0.3, wall: true });
    this.killY = -10;
  }

  spawn() {
    return { pos: [0, 0.05, 3], yaw: 0, pitch: 0 };
  }

  begin() {
    const k = (a) => this.game.keyName(a);
    this.hudApi.banner(`Hold ${k('walk')}, then ${k('jump')} + ${k('crouch')} to crouch-jump each ledge`, 'info', 2.6);
  }

  update() {
    this.checkZones();
  }

  onPlayerEvent(type, d) {
    if (this.game.state !== 'running') return;
    const inZone = this.game.world.zonesAt(this.player.pos).some((z) => z.type === 'silent');
    if (type === 'tuck') this.crouchJumps += 1;
    if (type === 'step' && inZone) {
      this.footsteps += 1;
      this.addPenalty(2, 'FOOTSTEPS HEARD');
    }
    if (type === 'jump') {
      this.jumps += 1;
      if (!d.loud) {
        this.silentJumps += 1;
      } else {
        this.loudJumpNoWalk += 1;
        if (inZone) this.addPenalty(2, 'JUMP HEARD');
      }
    }
    if (type === 'land' && d.airTime > 0.1) {
      this.landings += 1;
      if (!d.loud) {
        this.silent += 1;
      } else {
        if (d.speed > this.player.silentLandVy) this.loudHard += 1;
        else this.loudFast += 1;
        if (inZone) this.addPenalty(2, 'LANDING HEARD');
      }
      // bounced off a ledge face with a plain jump: tell them how to get up (shown after the penalty)
      const face = this.ledgeZ[this.ledgesCleared()];
      if (!d.tucked && this.player.pos.y < 0.05 && face != null && this.player.pos.z - face < 1.5 && this.elapsed - (this.hintT ?? -9) > 2) {
        this.hintT = this.elapsed;
        this.hudApi.banner(`Too high: hold ${this.game.keyName('crouch')} as you jump`, 'warn', 1.6);
      }
    }
  }

  ledgesCleared() {
    const z = this.player.pos.z;
    return this.ledgeZ.filter((f) => z < f - 3).length;
  }

  hud() {
    return [
      ['Ledge', `${Math.min(this.ledgesCleared() + 1, this.count)} / ${this.count}`],
      ['Silent jumps', `${this.silentJumps} / ${this.jumps}`, this.jumps && this.silentJumps === this.jumps ? 'good' : ''],
      ['Silent landings', `${this.silent} / ${this.landings}`, this.landings && this.silent === this.landings ? 'good' : ''],
      ['Penalty', `+${this.penalty.toFixed(0)}s`, this.penalty ? 'bad' : ''],
    ];
  }

  stats() {
    return [
      ['Time', this.finishTime != null ? `${this.finishTime.toFixed(2)}s` : 'DNF'],
      ['Penalties', `+${this.penalty.toFixed(0)}s`],
      ['Silent jumps', `${this.silentJumps} / ${this.jumps} (${pct(this.silentJumps, this.jumps)}%)`],
      ['Loud jumps (no Walk or Crouch)', this.loudJumpNoWalk],
      ['Silent landings', `${this.silent} / ${this.landings} (${pct(this.silent, this.landings)}%)`],
      ['Loud landing: fell too far', this.loudHard],
      ['Loud landing: too fast', this.loudFast],
      ['Running footsteps', this.footsteps],
      ['Crouch-jumps', this.crouchJumps],
      ['Falls', this.falls],
    ];
  }
}
