import * as THREE from 'three';
import { fmtScore, mean, pct } from '../util.js';

/** Within this many degrees of the head when an enemy appears counts as pre-aimed. */
export const PREAIM_DEG = 2;
const _head = new THREE.Vector3();

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
    // crosshair placement: aim error at the moment each enemy first came into view
    this.placements = [];
    this.placementsShown = 0;
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

  /** Record where the crosshair was as an enemy came into view. Returns the error. */
  notePlacement(bot) {
    const e = this.game.aimError(bot.headWorld(_head));
    this.placements.push(e);
    return e;
  }

  /**
   * Make recorded placements visible in the HUD. Drills call this once the enemy is dealt
   * with, so the readout never reveals that an enemy has just appeared.
   */
  revealPlacements() {
    this.placementsShown = this.placements.length;
  }

  /** HUD row: running average of revealed placements. */
  placementHud() {
    const shown = this.placements.slice(0, this.placementsShown);
    if (!shown.length) return ['Placement', '-'];
    const avg = mean(shown.map((p) => p.deg));
    return ['Placement', `${avg.toFixed(1)}°`, avg <= PREAIM_DEG ? 'good' : ''];
  }

  /** Results rows for crosshair placement. */
  placementStats() {
    const list = this.placements;
    if (!list.length) return [['Crosshair placement', '-']];
    const bias = mean(list.map((p) => p.vert));
    return [
      ['Crosshair placement', `${mean(list.map((p) => p.deg)).toFixed(1)}° off`],
      [`Pre-aimed (≤${PREAIM_DEG}°)`, `${pct(list.filter((p) => p.deg <= PREAIM_DEG).length, list.length)}%`],
      ['Height bias', fmtBias(bias)],
    ];
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

/** Signed vertical error as words: positive means the head was above the crosshair. */
export function fmtBias(v) {
  if (Math.abs(v) < 0.25) return 'on head level';
  return v > 0 ? `${v.toFixed(1)}° low` : `${(-v).toFixed(1)}° high`;
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
