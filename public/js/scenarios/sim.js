import * as THREE from 'three';
import { Scenario } from './base.js';
import { Bot } from '../game/targets.js';
import { BotGun, PLAYER_HP } from '../game/botfire.js';
import { floor, backdrop } from './layouts.js';
import { mean, pct, fmtMs } from '../util.js';

const PILLAR_HALF = 1.7; // cover is 3.4 m wide

/**
 * Peek Duels: enemies hold angles hidden behind your cover. Swing out, find them, stop and kill
 * them before they react and out-trade you. 10 rounds. Enemy fire uses the shared bot model:
 * a reaction time, then rifle taps whose hit chance drops while you're moving or airborne,
 * dealing real damage to your 150 HP.
 */
export class PeekDuel extends Scenario {
  constructor(...a) {
    super(...a);
    this.feedback = 'movement';
    this.rounds = 10;
    this.gun = new BotGun(this.game, this.rng.fork(), this.diff);
    this.reaction = this.gun.reaction;
    this.perRound = this.d({ easy: 1, medium: 1, hard: 2 });
    this.round = 0;
    this.won = 0;
    this.lost = 0;
    this.bots = [];
    this.phase = 'pre';
    this.nextAt = 0;
    this.hp = PLAYER_HP;
    this.damageTaken = 0;
    this.exposures = [];
    this.peekTimes = [];
    this.accurateShots = 0;
    this.headKills = 0;
    this.kills = 0;
  }

  build(w) {
    floor(w, -40, 40, -60, 10);
    // player booth
    w.box([-6.4, 0, 2.8], [6.4, 3, 3.2], { mat: 'wall' });
    w.box([-6.4, 0, -2.6], [-6, 3, 3.2], { mat: 'wall' });
    w.box([6, 0, -2.6], [6.4, 3, 3.2], { mat: 'wall' });
    // cover you peek from
    this.pillar = w.box([-PILLAR_HALF, 0, -2.6], [PILLAR_HALF, 3.4, -1.4], { mat: 'cover' });
    backdrop(w, -34, -40, 40, 8);
    // side props outside the duel zone
    for (const [x, z] of [[-20, -14], [20, -16], [-26, -26], [26, -28]]) w.box([x - 1.2, 0, z - 1.2], [x + 1.2, 2.2, z + 1.2], { mat: 'cover' });
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
    this.hp = PLAYER_HP;
    const sp = this.spawn();
    this.game.respawn(sp.pos, 0, 0);
    this.game.freeze(0.6);
    const eye = new THREE.Vector3(sp.pos[0], sp.pos[1] + 1.62, sp.pos[2]);
    for (let i = 0; i < this.perRound; i++) {
      let placed = null;
      for (let tries = 0; tries < 60 && !placed; tries++) {
        const d = this.rng.float(9, 24);
        const x = this.rng.float(-0.62, 0.62) * (d + 0.8);
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
        b.nextShot = this.elapsed + this.gun.interval;
        const shot = this.gun.shoot(b.headWorld());
        if (shot.hit) {
          this.hp -= shot.damage;
          this.damageTaken += shot.damage;
          this.hudApi.flash('hit', 0.25);
          if (this.hp <= 0) {
            this.loseRound(b.exposure, shot.zone);
            return;
          }
        }
      }
    }
    this.hudApi.exposed(maxExp > 0, maxExp);
  }

  loseRound(exp, zone) {
    this.lost += 1;
    this.phase = 'post';
    this.nextAt = this.elapsed + 1.4;
    this.hudApi.flash('death', 0.8);
    this.hudApi.banner(`KILLED${zone === 'head' ? ' (HEADSHOT)' : ''} · exposed ${fmtMs(exp)}`, 'bad', 1.3);
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
      this.points += 100 + Math.max(0, 1 - worst / this.reaction) * 100 + (this.hp === PLAYER_HP ? 25 : 0);
      this.phase = 'post';
      this.nextAt = this.elapsed + 1.0;
      this.hudApi.banner(this.hp === PLAYER_HP ? 'ROUND WON · UNTOUCHED' : `ROUND WON · ${this.hp} HP left`, 'good', 0.9);
      this.game.audio.good();
    }
  }

  hud() {
    return [
      ['Round', `${Math.min(this.round, this.rounds)} / ${this.rounds}`],
      ['HP', this.hp, this.hp < PLAYER_HP ? 'bad' : ''],
      ['Won / lost', `${this.won} / ${this.lost}`],
      ['Enemy reaction', fmtMs(this.reaction)],
    ];
  }

  stats() {
    return [
      ['Rounds won', `${this.won} / ${this.won + this.lost}`],
      ['Avg exposure per kill', this.exposures.length ? fmtMs(mean(this.exposures)) : '-'],
      ['Avg peek-to-kill', this.peekTimes.length ? fmtMs(mean(this.peekTimes)) : '-'],
      ['Damage taken', this.damageTaken],
      ['Accurate (stopped) shots', `${pct(this.accurateShots, this.shots)}%`],
      ['Headshot kills', `${pct(this.headKills, this.kills)}%`],
      ['Accuracy', `${pct(this.hits, this.shots)}%`],
    ];
  }
}
