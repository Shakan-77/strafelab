import * as THREE from 'three';
import { Scenario } from './base.js';
import { Bot } from '../game/targets.js';
import { floor, backdrop } from './layouts.js';
import { mean, pct, fmtMs } from '../util.js';

/**
 * Peek Duels: enemies hold angles hidden behind your cover pillar. Swing out, find them,
 * counter-strafe and kill before their reaction timer runs out. 10 rounds.
 */
export class PeekDuel extends Scenario {
  constructor(...a) {
    super(...a);
    this.feedback = 'movement';
    this.rounds = 10;
    this.reaction = this.d({ easy: 0.42, medium: 0.3, hard: 0.22 });
    this.perRound = this.d({ easy: 1, medium: 1, hard: 2 });
    this.hitMoving = this.d({ easy: 0.45, medium: 0.55, hard: 0.65 });
    this.round = 0;
    this.won = 0;
    this.lost = 0;
    this.bots = [];
    this.phase = 'pre';
    this.nextAt = 0;
    this.exposures = [];
    this.peekTimes = [];
    this.accurateShots = 0;
    this.headKills = 0;
    this.kills = 0;
    this.hitRng = this.rng.fork();
  }

  build(w) {
    floor(w, -40, 40, -60, 10);
    // player booth
    w.box([-5.4, 0, 2.8], [5.4, 3, 3.2], { mat: 'wall' });
    w.box([-5.4, 0, -2.4], [-5, 3, 3.2], { mat: 'wall' });
    w.box([5, 0, -2.4], [5.4, 3, 3.2], { mat: 'wall' });
    // cover pillar you peek from
    this.pillar = w.box([-1, 0, -2.4], [1, 3.4, -1.4], { mat: 'cover' });
    backdrop(w, -34, -40, 40, 8);
    // side props outside the duel zone
    for (const [x, z] of [[-18, -14], [18, -16], [-24, -26], [24, -28]]) w.box([x - 1.2, 0, z - 1.2], [x + 1.2, 2.2, z + 1.2], { mat: 'cover' });
  }

  spawn() {
    return { pos: [0, 0, 0.8], yaw: 0, pitch: 0 };
  }

  begin() {
    this.startRound();
  }

  startRound() {
    this.round += 1;
    for (const b of this.bots) if (b.alive) b.despawn();
    this.bots = [];
    const sp = this.spawn();
    this.game.respawn(sp.pos, 0, 0);
    this.game.freeze(0.6);
    const eye = new THREE.Vector3(sp.pos[0], sp.pos[1] + 1.62, sp.pos[2]);
    for (let i = 0; i < this.perRound; i++) {
      let placed = null;
      for (let tries = 0; tries < 60 && !placed; tries++) {
        const d = this.rng.float(9, 24);
        const x = this.rng.float(-0.42, 0.42) * (d + 0.8);
        if (this.bots.some((b) => b.origin.distanceTo(new THREE.Vector3(x, 0, -d)) < 3)) continue;
        const bot = new Bot(this.game, {
          origin: new THREE.Vector3(x, 0, -d),
          behavior: 'static',
          crouched: this.rng.chance(0.25),
          rng: this.rng.fork(),
        });
        if (this.game.canSee(eye, bot.headWorld()) || this.game.canSee(eye, bot.chestWorld())) {
          bot.despawn();
          continue;
        }
        placed = bot;
      }
      if (placed) {
        placed.exposure = 0;
        placed.hidden = 0;
        placed.nextShot = 0;
        this.bots.push(placed);
      }
    }
    this.roundStart = this.elapsed + 0.6;
    this.firstExposed = null;
    this.phase = 'live';
    this.hudApi.banner(`ROUND ${this.round} / ${this.rounds}`, 'info', 0.8);
  }

  update(dt) {
    if (this.phase === 'post') {
      this.hudApi.exposed(false);
      if (this.elapsed >= this.nextAt) {
        if (this.round >= this.rounds) this.finished = true;
        else this.startRound();
      }
      return;
    }
    if (this.phase !== 'live') return;
    const p = this.player;
    let maxExp = 0;
    for (const b of this.bots) {
      if (!b.alive) continue;
      const sees = this.game.playerVisibleFrom(b.headWorld());
      if (sees) {
        b.exposure += dt;
        b.hidden = 0;
        if (this.firstExposed == null) this.firstExposed = this.elapsed;
      } else {
        b.hidden += dt;
        if (b.hidden > 0.35) b.exposure = 0;
      }
      maxExp = Math.max(maxExp, b.exposure);
      if (sees && b.exposure >= this.reaction && this.elapsed >= b.nextShot) {
        this.game.enemyTracer(b.headWorld());
        const moving = p.hspeed() > 0.55 * p.runSpeed || !p.onGround;
        if (this.hitRng.chance(moving ? this.hitMoving : 0.95)) {
          this.loseRound(b.exposure);
          return;
        }
        b.nextShot = this.elapsed + 0.11;
      }
    }
    this.hudApi.exposed(maxExp > 0, maxExp);
  }

  loseRound(exp) {
    this.lost += 1;
    this.phase = 'post';
    this.nextAt = this.elapsed + 1.4;
    this.hudApi.flash('death', 0.8);
    this.hudApi.banner(`KILLED · exposed ${fmtMs(exp)}`, 'bad', 1.3);
    this.game.audio.death();
    this.game.freeze(1.4);
  }

  onShot(s) {
    this.countShot(s);
    if (s.accurate) this.accurateShots += 1;
    if (this.phase !== 'live' || !s.killed || !this.bots.includes(s.target)) return;
    const b = s.target;
    this.kills += 1;
    if (s.zone === 'head') this.headKills += 1;
    this.exposures.push(b.exposure);
    if (this.firstExposed != null) this.peekTimes.push(this.elapsed - this.firstExposed);
    if (this.bots.every((x) => !x.alive)) {
      const worst = Math.max(...this.bots.map((x) => x.exposure));
      this.won += 1;
      this.points += 100 + Math.max(0, 1 - worst / this.reaction) * 100;
      this.phase = 'post';
      this.nextAt = this.elapsed + 1.0;
      this.hudApi.banner('ROUND WON', 'good', 0.9);
      this.game.audio.good();
    }
  }

  hud() {
    return [
      ['Round', `${Math.min(this.round, this.rounds)} / ${this.rounds}`],
      ['Won', this.won, 'good'],
      ['Lost', this.lost, this.lost ? 'bad' : ''],
      ['Enemy reaction', fmtMs(this.reaction)],
    ];
  }

  stats() {
    return [
      ['Rounds won', `${this.won} / ${this.won + this.lost}`],
      ['Avg exposure per kill', this.exposures.length ? fmtMs(mean(this.exposures)) : '-'],
      ['Avg peek-to-kill', this.peekTimes.length ? fmtMs(mean(this.peekTimes)) : '-'],
      ['Accurate (stopped) shots', `${pct(this.accurateShots, this.shots)}%`],
      ['Headshot kills', `${pct(this.headKills, this.kills)}%`],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
    ];
  }
}
