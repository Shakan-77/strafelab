import * as THREE from 'three';
import { Scenario, dirFromAngles } from './base.js';
import { Bot } from '../game/targets.js';
import { BotGun, PLAYER_HP } from '../game/botfire.js';
import { floor } from './layouts.js';
import { mean, pct, fmtMs } from '../util.js';

const DEG = Math.PI / 180;
const WALL_H = 3.6;
const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();

/**
 * Pre-aim Route: clear a fixed route of corners where enemies hold common angles (tight corners,
 * deep angles, heads over boxes, a raised platform). Which angles are held changes every run.
 * The clock stops when the last enemy dies. Each enemy shoots back after its reaction time
 * (shared bot model), and dying costs 5 s and sends you back to the last cleared corner.
 * The drill teaches walking the route with your crosshair already where the next head appears.
 */
export class PreAimRoute extends Scenario {
  constructor(...a) {
    super(...a);
    this.feedback = 'movement';
    this.gun = new BotGun(this.game, this.rng.fork(), this.diff);
    this.reaction = this.gun.reaction;
    this.count = this.d({ easy: 4, medium: 6, hard: 8 });
    this.hp = PLAYER_HP;
    this.bots = [];
    this.kills = 0;
    this.headKills = 0;
    this.deaths = 0;
    this.damageTaken = 0;
    this.penalty = 0;
    this.finishTime = null;
    this.clearTimes = [];
  }

  build(w) {
    floor(w, -20, 30, -70, 6);
    const wall = (x0, z0, x1, z1, h = WALL_H) => w.box([x0, 0, z0], [x1, h, z1], { mat: 'wall' });
    const cover = (x0, z0, x1, z1, h, y = 0) => w.box([x0, y, z0], [x1, y + h, z1], { mat: 'cover' });
    // corridor 1 (spawn) runs -Z into room 1
    wall(-3, 2, 3, 2.5);
    wall(-3, -18, -2.5, 2.5);
    wall(2.5, -18, 3, 2.5);
    // room 1: x -12..12, z -30..-18, exit door at x 7..10 in the back wall
    wall(-12.5, -18.5, -2.5, -18);
    wall(2.5, -18.5, 12.5, -18);
    wall(-12.5, -30.5, -12, -18);
    wall(12, -30.5, 12.5, -18);
    wall(-12.5, -30.5, 7, -30);
    wall(10, -30.5, 12.5, -30);
    cover(-9, -24, -7, -22, 1.2); // crate: left
    cover(-5.5, -28, -2.5, -26, WALL_H); // pillar: deep
    // corridor 2: x 7..10 from room 1 down to the site
    wall(6.5, -46, 7, -30.5);
    wall(10, -46, 10.5, -30.5);
    // site: x -6..22, z -64..-46, entered through the corridor at x 7..10
    wall(-6.5, -46.5, 7, -46);
    wall(10, -46.5, 22.5, -46);
    wall(-6.5, -64.5, -6, -46);
    wall(22, -64.5, 22.5, -46);
    wall(-6.5, -64.5, 22.5, -64);
    cover(0, -52, 2, -50, WALL_H); // pillar inside the site, left of the entrance
    cover(4, -58, 8, -55, 1.4); // head-height box
    cover(12, -63.5, 18, -58, 1.5); // raised platform
    cover(12, -58, 13.5, -56.5, 0.75); // step up to the platform
    // head-height guide strip on corner edges you clear
    for (const [x, z] of [[-2.5, -18], [2.5, -18], [7, -30], [10, -30], [7, -46], [10, -46]]) {
      w.box([x - 0.03, 1.52, z - 0.03], [x + 0.03, 1.62, z + 0.03], { mat: 'accent', collide: false, block: false });
    }
  }

  spawn() {
    return { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  }

  /** Angles in route order. `safe` is where you respawn if you die before clearing it. */
  spots() {
    return [
      { pos: [10.6, 0, -19.6], crouch: false, safe: [0, 0, -12, 0] }, // tight right corner out of corridor 1
      { pos: [-10.5, 0, -25.5], crouch: true, safe: [0, 0, -12, 0] }, // behind the left crate
      { pos: [-4, 0, -29.2], crouch: false, safe: [0, 0, -12, 0] }, // deep, behind the pillar
      { pos: [8.5, 0, -45.2], crouch: false, safe: [8.5, 0, -27, 0] }, // long, end of corridor 2
      { pos: [-5, 0, -49], crouch: false, safe: [8.5, 0, -38, 0] }, // site left, past the wall edge
      { pos: [21, 0, -48], crouch: false, safe: [8.5, 0, -38, 0] }, // site right corner
      { pos: [6, 0, -60], crouch: false, safe: [8.5, 0, -38, 0] }, // head over the box
      { pos: [15, 1.5, -61], crouch: false, safe: [8.5, 0, -38, 0] }, // up on the platform
    ];
  }

  begin() {
    const all = this.spots();
    // keep route order, pick which angles are held this run
    const idx = all.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.float(0, i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const chosen = idx.slice(0, this.count).sort((x, y) => x - y);
    for (const i of chosen) {
      const s = all[i];
      const bot = new Bot(this.game, {
        origin: new THREE.Vector3(...s.pos),
        behavior: 'static',
        crouched: s.crouch,
        rng: this.rng.fork(),
      });
      bot.spot = s;
      bot.exposure = 0;
      bot.hidden = 0;
      bot.nextShot = 0;
      bot.seenAt = null;
      this.bots.push(bot);
    }
    this.hudApi.banner(`Clear ${this.bots.length} angles`, 'info', 1.4);
  }

  living() {
    return this.bots.filter((b) => b.alive);
  }

  update(dt) {
    if (this.finishTime != null) return;
    for (const b of this.bots) {
      if (!b.alive) continue;
      if (b.seenAt == null && this.game.botVisible(b)) {
        b.seenAt = this.elapsed;
        this.notePlacement(b);
      }
      const sees = this.game.playerVisibleFrom(b.headWorld());
      if (sees) {
        b.exposure += dt;
        b.hidden = 0;
      } else {
        b.hidden += dt;
        if (b.hidden > 0.35) b.exposure = 0;
      }
      if (sees && b.exposure >= this.reaction && this.elapsed >= b.nextShot) {
        b.nextShot = this.elapsed + this.gun.interval;
        const shot = this.gun.shoot(b.headWorld());
        if (shot.hit) {
          this.hp -= shot.damage;
          this.damageTaken += shot.damage;
          this.hudApi.flash('hit', 0.25);
          if (this.hp <= 0) {
            this.die(shot.zone);
            return;
          }
        }
      }
    }
    this.hudApi.exposed(false);
  }

  die(zone) {
    this.deaths += 1;
    this.penalty += 5;
    this.hp = PLAYER_HP;
    this.hudApi.flash('death', 0.6);
    this.hudApi.banner(`KILLED${zone === 'head' ? ' (HEADSHOT)' : ''} +5s`, 'bad', 1.2);
    this.game.audio.death();
    const next = this.living()[0];
    const [x, y, z, yaw] = next ? next.spot.safe : [0, 0, 0, 0];
    this.game.respawn([x, y, z], yaw, 0);
    this.game.freeze(0.6);
    for (const b of this.living()) {
      b.exposure = 0;
      b.nextShot = 0;
    }
  }

  onShot(s) {
    this.countShot(s);
    const b = s.target;
    if (!s.killed || !this.bots.includes(b)) return;
    this.kills += 1;
    if (s.zone === 'head') this.headKills += 1;
    this.revealPlacements();
    if (b.seenAt != null) this.clearTimes.push(this.elapsed - b.seenAt);
    const left = this.living().length;
    if (!left) {
      this.finishTime = this.elapsed;
      this.finished = true;
      this.hudApi.banner('ROUTE CLEARED', 'good', 1.2);
      this.game.audio.good();
    } else {
      this.hudApi.feedback(`${left} left`, 'good', 0.6);
    }
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

  hud() {
    return [
      ['Time', `${(this.elapsed + this.penalty).toFixed(1)} s`],
      ['Enemies left', `${this.living().length} / ${this.bots.length}`],
      ['HP', Math.max(0, this.hp), this.hp < PLAYER_HP ? 'bad' : ''],
      ['Deaths', this.deaths, this.deaths ? 'bad' : ''],
      this.placementHud(),
    ];
  }

  stats() {
    return [
      ['Enemies cleared', `${this.kills} / ${this.bots.length}`],
      ['Deaths (+5 s each)', this.deaths],
      ['Damage taken', this.damageTaken],
      ['Avg seen-to-kill', this.clearTimes.length ? fmtMs(mean(this.clearTimes)) : '-'],
      ['Headshot kills', `${pct(this.headKills, this.kills)}%`],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ...this.placementStats(),
    ];
  }
}

/**
 * Anti-flash: you hold a gap. A flash is thrown from behind a wall, and an enemy swings right
 * after it pops. Turn away before it pops, then turn back and win the duel. A flash that pops
 * within 60° of where you look (with line of sight) blinds you fully; 60 to 100° partially;
 * further away, or behind cover, not at all. Harder levels pop faster, swing sooner, and mix in
 * fake flashes (no swing) and swings without a flash.
 */
export class AntiFlash extends Scenario {
  constructor(...a) {
    super(...a);
    this.feedback = 'movement';
    this.gun = new BotGun(this.game, this.rng.fork(), this.diff);
    this.reaction = this.gun.reaction;
    this.popTime = this.d({ easy: 0.95, medium: 0.75, hard: 0.6 });
    this.swingDelay = this.d({ easy: [0.55, 0.8], medium: [0.35, 0.6], hard: [0.2, 0.45] });
    this.fakeChance = this.d({ easy: 0, medium: 0.1, hard: 0.2 });
    this.dryChance = this.d({ easy: 0, medium: 0.1, hard: 0.15 });
    this.gap = this.d({ easy: [1.6, 2.6], medium: [1.2, 2.2], hard: [0.9, 1.8] });
    this.hp = PLAYER_HP;
    this.round = null;
    this.next = 1.2;
    this.blind = 0;
    this.blindStrength = 0;
    this.blindTotal = 0;
    this.flashes = 0;
    this.dodged = 0;
    this.partial = 0;
    this.full = 0;
    this.kills = 0;
    this.deaths = 0;
    this.damageTaken = 0;
    this.ttks = [];
    this.overlay = null;
    this.orb = null;
  }

  build(w) {
    floor(w, -40, 40, -40, 10);
    w.box([-20, 0, -13], [-2.5, 3.2, -12], { mat: 'cover' });
    w.box([2.5, 0, -13], [20, 3.2, -12], { mat: 'cover' });
    w.box([-20, 0, -23], [20, 6, -22], { mat: 'wall' });
    w.box([-20, 0, -22], [-19, 6, -13], { mat: 'wall' });
    w.box([19, 0, -22], [20, 6, -13], { mat: 'wall' });
    // your side: back room with a side opening, so there is somewhere to look away to
    w.box([-6, 0, 3], [6, 3, 3.5], { mat: 'wall' });
    w.box([-6, 0, -2], [-5.5, 3, 3.5], { mat: 'wall' });
    w.box([5.5, 0, -2], [6, 3, 3.5], { mat: 'wall' });
    w.box([-2.56, 1.52, -12.05], [-2.5, 1.62, -11.95], { mat: 'accent', collide: false, block: false });
    w.box([2.5, 1.52, -12.05], [2.56, 1.62, -11.95], { mat: 'accent', collide: false, block: false });
  }

  spawn() {
    return { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  }

  begin() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'flashbang';
    document.getElementById('game-root').append(this.overlay);
    this.hudApi.banner('Turn away from flashes, then win the swing', 'info', 1.8);
  }

  dispose() {
    this.overlay?.remove();
    this.overlay = null;
    this.removeOrb();
  }

  removeOrb() {
    if (!this.orb) return;
    this.game.scene.remove(this.orb);
    this.orb.geometry.dispose();
    this.orb.material.dispose();
    this.orb = null;
  }

  startRound() {
    const side = this.rng.chance(0.5) ? 'L' : 'R';
    const sx = side === 'L' ? -1 : 1;
    const dry = this.rng.chance(this.dryChance);
    const fake = !dry && this.rng.chance(this.fakeChance);
    this.round = {
      side,
      sx,
      flash: !dry,
      swing: !fake,
      t0: this.elapsed,
      popAt: dry ? this.elapsed : this.elapsed + this.popTime,
      swingAt: null,
      bot: null,
      popped: dry,
      blindAtPop: 0,
    };
    if (!dry) {
      this.flashes += 1;
      this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: '#f4f7ff' }));
      this.game.scene.add(this.orb);
      this.game.audio.tone(900, 0.12, { type: 'triangle', vol: 0.12, to: 1500 });
    } else {
      this.round.swingAt = this.elapsed + this.rng.float(0.2, 0.6);
    }
    this.hp = PLAYER_HP;
  }

  /** Flash path: lobbed from behind the wall on its side, over the gap, popping above it. */
  orbPos(t, sx, out) {
    const u = Math.min(1, t);
    const x = sx * (4.2 - 3.6 * u);
    const z = -14.5 + 5.5 * u;
    const y = 1.1 + 1.6 * u + 1.2 * Math.sin(Math.PI * u);
    return out.set(x, y, z);
  }

  pop() {
    const r = this.round;
    r.popped = true;
    const at = this.orbPos(1, r.sx, new THREE.Vector3());
    this.removeOrb();
    this.game.audio.noise(0.35, { vol: 0.35, freq: 3200, type: 'highpass' });
    const eye = this.game.eyePos(_eye);
    const fwd = dirFromAngles(this.game.yaw, this.game.pitch, _v.set(0, 0, 0));
    const to = at.clone().sub(eye);
    const ang = Math.acos(Math.max(-1, Math.min(1, fwd.dot(to.normalize())))) / DEG;
    const los = this.game.canSee(eye, at);
    let strength = 0;
    let dur = 0;
    if (los && ang < 60) {
      strength = 1;
      dur = 1.8;
      this.full += 1;
    } else if (los && ang < 100) {
      strength = 0.75 * (1 - (ang - 60) / 40) + 0.25;
      dur = 0.9;
      this.partial += 1;
    } else {
      this.dodged += 1;
    }
    if (strength > 0) {
      this.blind = dur;
      this.blindDur = dur;
      this.blindStrength = strength;
      this.blindTotal += dur * strength;
      this.hudApi.feedback(strength === 1 ? 'FLASHED' : 'Half flashed', 'bad', 0.8);
    } else {
      this.points += 50;
      this.hudApi.feedback(`Dodged (${Math.round(ang)}° away)`, 'good', 0.8);
    }
    r.blindAtPop = strength;
    if (r.swing) r.swingAt = this.elapsed + this.rng.float(this.swingDelay);
    else r.endAt = this.elapsed + 1.2;
  }

  spawnSwing() {
    const r = this.round;
    const dir = r.sx < 0 ? 1 : -1; // from the left wall, swing toward +x
    const start = -dir * 6.5;
    const bot = new Bot(this.game, {
      origin: new THREE.Vector3(0, 0, -this.rng.float(15.5, 17.5)),
      axis: new THREE.Vector3(1, 0, 0),
      behavior: 'peek',
      kind: 'swing',
      s: start,
      dir,
      stopAt: this.rng.float(-1.4, 1.4),
      min: dir > 0 ? start : -9,
      max: dir > 0 ? 9 : start,
      rng: this.rng.fork(),
    });
    bot.shotAt = null;
    r.bot = bot;
  }

  endRound() {
    const b = this.round?.bot;
    if (b?.alive) b.despawn();
    this.removeOrb();
    this.round = null;
    this.next = this.elapsed + this.rng.float(this.gap);
  }

  update(dt) {
    if (this.blind > 0) this.blind = Math.max(0, this.blind - dt);
    if (this.overlay) {
      // full white, then fade over the last 0.6 s
      const o = this.blind > 0 ? this.blindStrength * Math.min(1, this.blind / 0.6) : 0;
      this.overlay.style.opacity = o.toFixed(3);
    }
    const r = this.round;
    if (!r) {
      if (this.elapsed >= this.next) this.startRound();
      return;
    }
    if (this.orb) this.orbPos((this.elapsed - r.t0) / this.popTime, r.sx, this.orb.position);
    if (!r.popped && this.elapsed >= r.popAt) this.pop();
    if (r.swingAt != null && !r.bot && this.elapsed >= r.swingAt) this.spawnSwing();
    if (r.endAt != null && !r.bot && this.elapsed >= r.endAt) {
      this.endRound();
      return;
    }
    const b = r.bot;
    if (!b) return;
    if (b.firstSeen == null && this.game.botVisible(b)) {
      b.firstSeen = this.elapsed;
      b.placement = this.notePlacement(b);
    }
    if (b.state === 'hold' && b.firstSeen != null && b.shotAt == null) {
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
            this.hudApi.banner(`YOU DIED${r.blindAtPop ? ' (flashed)' : ''}`, 'bad', 1);
            this.game.audio.death();
            b.shotAt = Infinity;
            b.retreat();
          }
        }
      }
    }
    if (b.escaped) {
      this.revealPlacements();
      this.endRound();
    }
  }

  onShot(s) {
    this.countShot(s);
    const r = this.round;
    if (!s.hit) {
      this.points -= 5;
      return;
    }
    if (!s.killed || !r || s.target !== r.bot) return;
    const b = r.bot;
    this.kills += 1;
    const ttk = b.firstSeen != null ? this.elapsed - b.firstSeen : 0;
    this.ttks.push(ttk);
    this.points += 100 + Math.max(0, (this.reaction - ttk) / this.reaction) * 100 + (s.zone === 'head' ? 25 : 0);
    this.revealPlacements();
    this.hudApi.feedback(fmtMs(ttk), ttk < this.reaction ? 'good' : 'warn', 0.6);
    r.bot = null;
    this.endRound();
  }

  hud() {
    return [
      ['Kills', `${this.kills}`],
      ['Deaths', this.deaths, this.deaths ? 'bad' : ''],
      ['Flashes dodged', this.flashes ? `${this.dodged} / ${this.flashes}` : '-'],
      ['Enemy reaction', fmtMs(this.reaction)],
      this.placementHud(),
    ];
  }

  stats() {
    return [
      ['Kills', this.kills],
      ['Deaths', this.deaths],
      ['Flashes dodged', `${pct(this.dodged, this.flashes)}% (${this.dodged} / ${this.flashes})`],
      ['Fully / half flashed', `${this.full} / ${this.partial}`],
      ['Time blinded', `${this.blindTotal.toFixed(1)} s`],
      ['Avg time to kill', this.ttks.length ? fmtMs(mean(this.ttks)) : '-'],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ...this.placementStats(),
    ];
  }
}
