import * as THREE from 'three';
import { fmtScore } from '../util.js';

export class Scenario {
  constructor(game, meta, difficulty, rng) {
    this.game = game;
    this.meta = meta;
    this.diff = difficulty;
    this.rng = rng;
    this.elapsed = 0;
    this.points = 0;
    this.shots = 0;
    this.hits = 0;
    this.finished = false;
    this.allowMove = true;
    this.allowJump = true;
    this.ghosts = false;
    this.feedback = null;
  }

  /** Pick a value by difficulty: this.d({easy, medium, hard}). */
  d(map) {
    return map[this.diff] ?? map.medium;
  }

  get player() {
    return this.game.player;
  }

  get hudApi() {
    return this.game.hud;
  }

  build() {}
  spawn() {
    return { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  }
  begin() {}
  update() {}
  onShot() {}
  onPlayerEvent() {}

  onFall() {
    const sp = this.spawn();
    this.game.respawn(sp.pos, sp.yaw, 0);
  }

  countShot(s) {
    this.shots += 1;
    if (s.hit) this.hits += 1;
  }

  accuracy() {
    return this.shots ? this.hits / this.shots : 0;
  }

  score() {
    return Math.max(0, Math.round(this.points));
  }

  liveDisplay() {
    return fmtScore(this.meta, this.score());
  }

  hud() {
    return [];
  }

  stats() {
    return [];
  }

  results() {
    const score = this.score();
    return { score, display: fmtScore(this.meta, score), stats: this.stats() };
  }

  /** Eye position at the spawn point (for placing targets by angle). */
  spawnEye() {
    const sp = this.spawn();
    return new THREE.Vector3(sp.pos[0], sp.pos[1] + 1.62, sp.pos[2]);
  }
}

/** Direction vector from yaw/pitch (radians), matching the camera convention. */
export function dirFromAngles(yaw, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** Yaw/pitch of a direction vector. */
export function anglesOf(v) {
  const h = Math.hypot(v.x, v.z);
  return { yaw: Math.atan2(-v.x, -v.z), pitch: Math.atan2(v.y, h) };
}
