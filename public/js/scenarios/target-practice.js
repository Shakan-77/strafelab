import * as THREE from 'three';
import { Scenario } from './base.js';
import { Bot, Orb } from '../game/targets.js';
import { backdrop, floor } from './layouts.js';
import { fmtMs, median, pct } from '../util.js';

class StationaryPractice extends Scenario {
  constructor(...args) {
    super(...args);
    this.allowMove = false;
    this.allowJump = false;
  }

  build(world) {
    floor(world, -24, 24, -30, 5);
    backdrop(world, -28, -24, 24, 9);
  }
}

// Rapid tap drills reuse the same meshes and materials for the entire run.
class TapOrb extends Orb {
  damage() {
    if (!this.alive) return false;
    this.alive = false;
    return true;
  }

  relocate(pos) {
    this.alive = true;
    this.spawnedAt = this.firstSeen = this.game.scenarioTime();
    this.position.copy(pos);
    this.mesh.updateMatrixWorld();
    this.mat.emissiveIntensity = 1;
  }
}

class TapPractice extends StationaryPractice {
  constructor(...args) {
    super(...args);
    this.targets = new Map();
    this.streak = 0;
    this.bestStreak = 0;
  }

  placeOrb(slot, pos, radius, orb, lifetime = Infinity) {
    if (orb) orb.relocate(pos);
    else orb = new TapOrb(this.game, pos, radius);
    this.targets.set(orb, { slot, expiresAt: this.elapsed + lifetime });
  }

  onShot(shot) {
    this.countShot(shot);
    const target = this.targets.get(shot.target);
    if (!shot.killed || !target) {
      this.points -= 25;
      this.streak = 0;
      return;
    }
    this.points += 100;
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.spawnOrb(target.slot, shot.target);
  }

  hud() {
    return [['Hits', this.hits], ['Accuracy', `${pct(this.hits, this.shots)}%`], ['Streak', this.streak]];
  }

  stats() {
    const minutes = Math.min(this.elapsed, this.meta.duration) / 60;
    return [['Hits', this.hits], ['Accuracy', `${pct(this.hits, this.shots)}%`],
      ['Hits per minute', minutes > 0 ? (this.hits / minutes).toFixed(1) : '0.0'], ['Best streak', this.bestStreak],
      ['Misses', this.shots - this.hits]];
  }
}

const GRID_COLUMNS = 5;
const GRID_ROWS = 3;
const GRID_CELL_W = 1.65;
const GRID_CELL_H = 1.1;
const GRID_BOTTOM = 0.4;
const GRID_LEFT = -GRID_COLUMNS * GRID_CELL_W / 2;
const GRID_TOP = GRID_BOTTOM + GRID_ROWS * GRID_CELL_H;
const GRID_RIGHT = -GRID_LEFT;
const GRID_CELLS = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, i) => i);

export class GridTaps extends TapPractice {
  build(world) {
    super.build(world);
    world.box([GRID_LEFT, GRID_BOTTOM, -13.4], [GRID_RIGHT, GRID_TOP, -13.2], { mat: 'dark' });
    const line = { mat: 'pillarA', collide: false, block: false };
    for (let col = 0; col <= GRID_COLUMNS; col += 1) {
      const x = GRID_LEFT + col * GRID_CELL_W;
      world.box([x - 0.012, GRID_BOTTOM, -13.2], [x + 0.012, GRID_TOP, -13.18], line);
    }
    for (let row = 0; row <= GRID_ROWS; row += 1) {
      const y = GRID_BOTTOM + row * GRID_CELL_H;
      world.box([GRID_LEFT, y - 0.012, -13.2], [GRID_RIGHT, y + 0.012, -13.18], line);
    }
  }

  begin() {
    for (let i = 0; i < 4; i += 1) this.spawnOrb();
  }

  spawnOrb(previous, orb) {
    const occupied = new Set(Array.from(this.targets.values(), (target) => target.slot));
    const slot = this.rng.pick(GRID_CELLS.filter((cell) => cell !== previous && !occupied.has(cell)));
    const x = GRID_LEFT + (slot % GRID_COLUMNS + 0.5) * GRID_CELL_W;
    const y = GRID_BOTTOM + (Math.floor(slot / GRID_COLUMNS) + 0.5) * GRID_CELL_H;
    const radius = this.d({ easy: 0.41, medium: 0.31, hard: 0.22 });
    this.placeOrb(slot, new THREE.Vector3(x, y, -12.9), radius, orb);
  }
}

const SWITCH_LANES = [-0.49, -0.17, 0.17, 0.49];

export class MultiTargetSwitch extends TapPractice {
  constructor(...args) {
    super(...args);
    this.expired = 0;
    this.laneRngs = SWITCH_LANES.map(() => this.rng.fork());
  }

  begin() {
    SWITCH_LANES.forEach((_, lane) => this.spawnOrb(lane));
  }

  spawnOrb(lane, orb) {
    const rng = this.laneRngs[lane];
    const depth = rng.float(this.d({ easy: [8, 14], medium: [7, 19], hard: [7, 23] }));
    const x = depth * (SWITCH_LANES[lane] + rng.float(-0.035, 0.035));
    const y = rng.float(0.85, 3.15);
    const radius = this.d({ easy: 0.48, medium: 0.37, hard: 0.29 });
    const lifetime = rng.float(this.d({ easy: [3, 4.5], medium: [2.1, 3.6], hard: [1.4, 2.65] }));
    this.placeOrb(lane, new THREE.Vector3(x, y, -depth), radius, orb, lifetime);
  }

  update() {
    for (const [orb, target] of this.targets) {
      const remaining = target.expiresAt - this.elapsed;
      if (remaining > 0) {
        orb.mat.emissiveIntensity = 1 + 1.4 * Math.max(0, 1 - remaining / 0.55);
        continue;
      }
      this.expired += 1;
      this.streak = 0;
      this.points -= 15;
      this.spawnOrb(target.slot, orb);
    }
  }

  hud() {
    return [...super.hud(), ['Expired', this.expired]];
  }

  stats() {
    return [...super.stats(), ['Expired', this.expired]];
  }
}

const CENTER = new THREE.Vector2(0, 0);

// A first tap acquires the target. It keeps moving until a second tap confirms it.
class TransferOrb extends TapOrb {
  damage() {
    this.taps += 1;
    this.mat.emissiveIntensity = 2;
    return this.taps === 2;
  }
}

export class StrafeTransfers extends StationaryPractice {
  begin() {
    this.clears = 0;
    this.acquisitions = [];
    this.confirmations = [];
    this.side = this.rng.sign();
    this.speed = this.d({ easy: 1.5, medium: 2.5, hard: 3.8 });
    this.nextTarget();
  }

  nextTarget() {
    this.side *= -1;
    this.centerX = this.side * this.rng.float(1.6, 4.6);
    this.direction = this.rng.sign();
    const pos = new THREE.Vector3(this.centerX, this.rng.float(1.4, 1.85), -this.rng.float(9, 16));
    if (this.target) this.target.relocate(pos);
    else this.target = new TransferOrb(this.game, pos, this.d({ easy: 0.32, medium: 0.23, hard: 0.17 }));
    this.target.taps = 0;
  }

  update() {
    const phase = (this.elapsed - this.target.spawnedAt) * this.speed;
    // Triangle wave in metres. Constant-speed passes with visible reversals.
    this.target.position.x = this.centerX + this.direction * (1 - Math.abs((phase + 1) % 4 - 2));
    this.target.mesh.updateMatrixWorld();
  }

  onShot(shot) {
    this.countShot(shot);
    if (!shot.hit) {
      this.points -= 10;
    } else if (shot.killed) {
      this.confirmations.push(this.elapsed - this.firstTap);
      this.clears++;
      this.points += 75;
      this.nextTarget();
    } else {
      this.firstTap = this.elapsed;
      this.acquisitions.push(this.elapsed - this.target.spawnedAt);
      this.points += 25;
    }
  }

  hud() {
    return [['Clears', this.clears ?? 0], ['Accuracy', `${pct(this.hits, this.shots)}%`]];
  }

  stats() {
    return [...this.hud(),
      ['Median first tap', this.acquisitions.length ? fmtMs(median(this.acquisitions)) : '—'],
      ['Median follow-up', this.confirmations.length ? fmtMs(median(this.confirmations)) : '—']];
  }
}

export class StrafeTracking extends StationaryPractice {
  constructor(...args) {
    super(...args);
    this.ray = new THREE.Raycaster();
    this.intersections = [];
    this.onTargetTime = 0;
    this.headTime = 0;
    this.holdTime = 0;
    this.bestHold = 0;
    this.onTarget = false;
  }

  begin() {
    this.bot = new Bot(this.game, {
      origin: new THREE.Vector3(0, 0, -this.d({ easy: 12, medium: 15, hard: 17 })),
      min: -4.8,
      max: 4.8,
      behavior: 'adad',
      speed: this.d({ easy: 2.6, medium: 3.9, hard: 5.4 }),
      strafe: this.d({ easy: [0.7, 1.3], medium: [0.45, 1], hard: [0.22, 0.75] }),
      pauseChance: 0.12,
      crouchChance: this.d({ easy: 0, medium: 0.05, hard: 0.12 }),
      rng: this.rng.fork(),
    });
  }

  update(dt) {
    this.onTarget = false;
    if (this.game.paused || !this.game.locked) {
      this.holdTime = 0;
      return;
    }
    this.ray.setFromCamera(CENTER, this.game.camera);
    this.intersections.length = 0;
    const [hit] = this.ray.intersectObjects(this.bot.hitMeshes, false, this.intersections);
    if (!hit) {
      this.holdTime = 0;
      return;
    }
    const step = Math.min(dt, Math.max(0, this.meta.duration - (this.elapsed - dt)));
    this.onTarget = true;
    this.onTargetTime += step;
    this.holdTime += step;
    this.bestHold = Math.max(this.bestHold, this.holdTime);
    if (hit.object.userData.hit.zone === 'head') this.headTime += step;
    this.points = this.onTargetTime * 100;
  }

  stats() {
    return [
      ['Time on target', `${this.onTargetTime.toFixed(2)} s`],
      ['Tracking accuracy', `${pct(this.onTargetTime, Math.min(this.elapsed, this.meta.duration))}%`],
      ['Time on head', `${this.headTime.toFixed(2)} s`],
      ['Longest hold', `${this.bestHold.toFixed(2)} s`],
    ];
  }

  hud() {
    return [['On target', `${pct(this.onTargetTime, Math.min(this.elapsed, this.meta.duration))}%`],
      ['Current hold', `${this.holdTime.toFixed(1)} s`, this.onTarget ? 'good' : ''],
      ['Longest hold', `${this.bestHold.toFixed(2)} s`]];
  }
}
