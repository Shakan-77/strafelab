import * as THREE from 'three';
import { clamp, lerp } from '../util.js';
import { MOVE } from './player.js';

export const ENEMY_COLORS = { red: '#ff4d5e', yellow: '#f2e33b', purple: '#c65bff' };

const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
};

// Same acceleration and braking as the player, so bots start, stop and reverse like real people.
const ACC = MOVE.accel;
const brakeStep = (speed, dt, extra = 0) => Math.max(0, speed - (MOVE.brakeFriction * speed + MOVE.brakeDecel + extra) * dt);
/** Distance to stop from speed v under dv/dt = -(F·v + B). */
const stopDistance = (v) => {
  const F = MOVE.brakeFriction;
  const B = MOVE.brakeDecel + MOVE.counterExtra;
  return v / F - (B / (F * F)) * Math.log(1 + (F * v) / B);
};

// Tagging: VALORANT slows anyone hit by a bullet by 72.5% (patch 3.0). Riot hasn't published
// the duration; 0.5 s easing back to full speed is an estimate (it matches the published
// shotgun long-range tag curve).
const TAG_SLOW = 0.725;
const TAG_TIME = 0.5;

// Hitbox dimensions (metres)
const HEAD_R = 0.125;
const BODY = { w: 0.5, h: 0.6, d: 0.3 };
const LEG = { w: 0.18, d: 0.24, hStand: 0.86, hCrouch: 0.55 };

function enemyMaterials(colorHex) {
  const color = new THREE.Color(colorHex);
  const body = new THREE.MeshLambertMaterial({ color, emissive: color.clone().multiplyScalar(0.28) });
  const head = new THREE.MeshLambertMaterial({ color: color.clone().lerp(new THREE.Color('#ffffff'), 0.25), emissive: color.clone().multiplyScalar(0.4) });
  const legs = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.7), emissive: color.clone().multiplyScalar(0.15) });
  return { body, head, legs };
}

/**
 * Humanoid bot that moves along a straight lane (origin + axis * s).
 * behaviours: static | adad | cross | peek | jiggle
 */
export class Bot {
  constructor(game, o) {
    this.game = game;
    this.o = o;
    this.rng = o.rng;
    this.hp = o.hp ?? 150;
    this.maxHp = this.hp;
    this.alive = true;
    this.kind = o.kind || o.behavior || 'static';
    this.origin = o.origin.clone();
    this.axis = (o.axis || new THREE.Vector3(1, 0, 0)).clone().normalize();
    this.s = o.s ?? 0;
    this.prevS = this.s;
    this.v = 0;
    this.min = o.min ?? -3;
    this.max = o.max ?? 3;
    this.speed = o.speed ?? 5.4;
    this.behavior = o.behavior || 'static';
    this.wish = 0;
    this.timer = 0;
    this.lastDir = 0;
    this.crouch = o.crouched ? 1 : 0;
    this.crouchTarget = this.crouch;
    this.prevCrouch = this.crouch;
    this.state = 'init';
    this.escaped = false;
    this.spawnedAt = game.scenarioTime();
    this.firstSeen = null;
    this.deathT = -1;
    this.flashT = 0;
    this.tagT = 0;

    this.mats = enemyMaterials(game.enemyColor());
    this.group = new THREE.Group();
    this.head = new THREE.Mesh(GEO.sphere, this.mats.head);
    this.head.scale.setScalar(HEAD_R);
    this.body = new THREE.Mesh(GEO.box, this.mats.body);
    this.legL = new THREE.Mesh(GEO.box, this.mats.legs);
    this.legR = new THREE.Mesh(GEO.box, this.mats.legs);
    this.head.userData.hit = { target: this, zone: 'head' };
    this.body.userData.hit = { target: this, zone: 'body' };
    this.legL.userData.hit = { target: this, zone: 'legs' };
    this.legR.userData.hit = { target: this, zone: 'legs' };
    this.hitMeshes = [this.head, this.body, this.legL, this.legR];
    this.group.add(this.head, this.body, this.legL, this.legR);
    game.scene.add(this.group);
    this.pose();
    this.frame(1);
    game.addTarget(this);
  }

  pose() {
    const c = this.crouch;
    const legH = lerp(LEG.hStand, LEG.hCrouch, c);
    for (const [leg, x] of [[this.legL, -0.11], [this.legR, 0.11]]) {
      leg.scale.set(LEG.w, legH, LEG.d);
      leg.position.set(x, legH / 2, 0);
    }
    this.body.scale.set(BODY.w, BODY.h, BODY.d);
    this.body.position.set(0, legH + BODY.h / 2, 0);
    this.headY = legH + BODY.h + HEAD_R + 0.01;
    this.head.position.set(0, this.headY, 0);
  }

  worldPos(out = new THREE.Vector3(), s = this.s) {
    return out.copy(this.axis).multiplyScalar(s).add(this.origin);
  }

  headWorld(out = new THREE.Vector3()) {
    this.worldPos(out);
    out.y += this.headY;
    return out;
  }

  chestWorld(out = new THREE.Vector3()) {
    this.worldPos(out);
    out.y += this.body.position.y;
    return out;
  }

  // ---------------------------------------------------------------- simulation
  fixedStep(dt) {
    if (!this.alive) return;
    this.prevS = this.s;
    this.prevCrouch = this.crouch;
    this.think(dt);
    if (this.tagT > 0) this.tagT -= dt;
    const tag = this.tagT > 0 ? 1 - TAG_SLOW * (this.tagT / TAG_TIME) : 1;
    const max = this.speed * (this.crouch > 0.5 ? 0.45 : 1) * tag;
    const w = this.wish;
    if (w !== 0) {
      const along = this.v * w;
      if (along < 0) {
        const slowed = brakeStep(-along, dt, MOVE.counterExtra);
        this.v = w * (slowed > 0 ? -slowed : Math.min(max, ACC * dt * 0.5));
      } else if (along < max) {
        this.v = w * Math.min(max, along + ACC * dt);
      } else {
        this.v = w * Math.max(max, brakeStep(along, dt));
      }
    } else {
      this.v = Math.sign(this.v) * brakeStep(Math.abs(this.v), dt);
    }
    this.s += this.v * dt;
    if (this.s < this.min) {
      this.s = this.min;
      if (this.v < 0) this.v = 0;
    }
    if (this.s > this.max) {
      this.s = this.max;
      if (this.v > 0) this.v = 0;
    }
    this.crouch += clamp(this.crouchTarget - this.crouch, -dt * 7, dt * 7);
  }

  think(dt) {
    const o = this.o;
    switch (this.behavior) {
      case 'adad': {
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.wish !== 0 && this.rng.chance(o.pauseChance ?? 0.15)) {
            this.wish = 0;
            this.timer = this.rng.float(o.pause || [0.12, 0.35]);
          } else {
            let dir = this.lastDir ? -this.lastDir : this.rng.sign();
            if (this.lastDir && this.rng.chance(o.repeatChance ?? 0.15)) dir = this.lastDir;
            if (this.s > this.max - 0.6) dir = -1;
            else if (this.s < this.min + 0.6) dir = 1;
            this.wish = dir;
            this.lastDir = dir;
            this.timer = this.rng.float(o.strafe || [0.25, 0.6]);
          }
          if (o.crouchChance && this.rng.chance(o.crouchChance)) this.crouchTarget = this.crouchTarget ? 0 : 1;
          else if (this.crouchTarget && this.rng.chance(0.5)) this.crouchTarget = 0;
        }
        if (this.wish > 0 && this.s >= this.max - 0.05) this.wish = this.lastDir = -1;
        if (this.wish < 0 && this.s <= this.min + 0.05) this.wish = this.lastDir = 1;
        break;
      }
      case 'cross': {
        // sprint from one end of the lane to the other, optional stop on the way
        const dir = o.dir || 1;
        if (this.state === 'init') {
          this.state = 'run';
          this.wish = dir;
        }
        if (this.state === 'run' && o.stopAt != null && !this.didStop && (dir > 0 ? this.s >= o.stopAt - this.brakeDist() : this.s <= o.stopAt + this.brakeDist())) {
          this.state = 'brake';
          this.didStop = true;
        }
        if (this.state === 'brake') {
          this.wish = this.v * dir > 0.4 ? -dir : 0;
          if (Math.abs(this.v) < 0.4) {
            this.state = 'hold';
            this.wish = 0;
            this.timer = o.stopTime ?? 0.5;
          }
        }
        if (this.state === 'hold') {
          this.timer -= dt;
          if (this.timer <= 0) {
            this.state = 'run';
            this.wish = dir;
          }
        }
        if ((dir > 0 && this.s >= this.max - 0.01) || (dir < 0 && this.s <= this.min + 0.01)) {
          this.escaped = true;
          this.wish = 0;
        }
        break;
      }
      case 'peek': {
        // swing out to stopAt, counter-strafe, hold; scenario may order a retreat
        const dir = o.dir || 1;
        if (this.state === 'init') {
          this.state = 'swing';
          this.wish = dir;
        }
        if (this.state === 'swing' && (dir > 0 ? this.s >= o.stopAt - this.brakeDist() : this.s <= o.stopAt + this.brakeDist())) this.state = 'brake';
        if (this.state === 'brake') {
          this.wish = this.v * dir > 0.4 ? -dir : 0;
          if (Math.abs(this.v) < 0.4) {
            this.state = 'hold';
            this.wish = 0;
            this.holdT = 0;
          }
        }
        if (this.state === 'hold') this.holdT += dt;
        if (this.state === 'retreat') {
          this.wish = -dir;
          if ((dir > 0 && this.s <= this.min + 0.05) || (dir < 0 && this.s >= this.max - 0.05)) this.escaped = true;
        }
        break;
      }
      case 'jiggle': {
        // shoulder-peek past the edge and immediately back
        const dir = o.dir || 1;
        if (this.state === 'init') {
          this.state = 'out';
          this.wish = dir;
        }
        if (this.state === 'out' && (dir > 0 ? this.s >= o.stopAt : this.s <= o.stopAt)) {
          this.state = 'back';
          this.wish = -dir;
        }
        if (this.state === 'back' && ((dir > 0 && this.s <= this.min + 0.05) || (dir < 0 && this.s >= this.max - 0.05))) {
          this.escaped = true;
          this.wish = 0;
        }
        break;
      }
      default:
        this.wish = 0;
    }
  }

  brakeDist() {
    return stopDistance(Math.abs(this.v));
  }

  retreat() {
    if (this.alive) this.state = 'retreat';
  }

  // ---------------------------------------------------------------- render
  frame(alpha) {
    const s = lerp(this.prevS, this.s, alpha);
    this.worldPos(this.group.position, s);
    const c = lerp(this.prevCrouch ?? this.crouch, this.crouch, alpha);
    if (Math.abs(c - this.renderedCrouch) > 1e-3 || this.renderedCrouch === undefined) {
      const keep = this.crouch;
      this.crouch = c;
      this.pose();
      this.crouch = keep;
      this.renderedCrouch = c;
    }
    const cam = this.game.camera.position;
    this.group.rotation.y = Math.atan2(cam.x - this.group.position.x, cam.z - this.group.position.z);
    if (this.flashT > 0) {
      this.flashT -= 1 / 60;
      if (this.flashT <= 0) this.setEmissive(false);
    }
    if (this.deathT >= 0) {
      this.deathT += this.game.frameDt;
      const t = clamp(this.deathT / 0.35, 0, 1);
      this.group.rotation.x = -t * 1.35;
      this.group.position.y -= t * 0.3;
      if (this.deathT > 0.55) this.dispose();
    }
  }

  setEmissive(on) {
    for (const m of [this.mats.body, this.mats.head, this.mats.legs]) {
      if (on) {
        m.userData.saved = m.userData.saved || m.emissive.clone();
        m.emissive.setRGB(1, 1, 1);
      } else if (m.userData.saved) {
        m.emissive.copy(m.userData.saved);
      }
    }
  }

  /** Apply damage. Returns true if this hit killed the bot. */
  damage(dmg) {
    if (!this.alive) return false;
    this.hp -= dmg;
    // tagged: slowed immediately, recovering over TAG_TIME
    this.tagT = TAG_TIME;
    const cap = this.speed * (1 - TAG_SLOW);
    if (Math.abs(this.v) > cap) this.v = Math.sign(this.v) * cap;
    this.setEmissive(true);
    this.flashT = 0.06;
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die() {
    this.alive = false;
    this.deathT = 0;
    this.setEmissive(false);
    this.game.removeTarget(this);
  }

  /** Remove without a death animation (escaped / timed out). */
  despawn() {
    this.alive = false;
    this.game.removeTarget(this);
    this.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.game.removeEntity(this);
    this.game.scene.remove(this.group);
    for (const m of Object.values(this.mats)) m.dispose();
  }
}

/** Spherical target (head-sized by default). Dies in one hit. */
export class Orb {
  constructor(game, pos, radius, o = {}) {
    this.game = game;
    this.alive = true;
    this.radius = radius;
    this.kind = 'orb';
    this.spawnedAt = game.scenarioTime();
    this.firstSeen = this.spawnedAt;
    const color = new THREE.Color(o.color || game.enemyColor());
    this.mat = new THREE.MeshLambertMaterial({ color, emissive: color.clone().multiplyScalar(0.45) });
    this.mesh = new THREE.Mesh(GEO.sphere, this.mat);
    this.mesh.scale.setScalar(radius);
    this.mesh.position.copy(pos);
    this.mesh.userData.hit = { target: this, zone: 'head' };
    this.hitMeshes = [this.mesh];
    this.popT = -1;
    game.scene.add(this.mesh);
    game.addTarget(this);
  }

  get position() {
    return this.mesh.position;
  }

  frame() {
    if (this.popT >= 0) {
      this.popT += this.game.frameDt;
      const t = this.popT / 0.12;
      this.mesh.scale.setScalar(this.radius * (1 + t * 0.8));
      this.mat.opacity = Math.max(0, 1 - t);
      if (t >= 1) this.dispose();
    }
  }

  damage() {
    if (!this.alive) return false;
    this.alive = false;
    this.game.removeTarget(this);
    this.mat.transparent = true;
    this.mat.emissive.setRGB(1, 1, 1);
    this.popT = 0;
    return true;
  }

  despawn() {
    this.alive = false;
    this.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.game.removeEntity(this);
    this.game.scene.remove(this.mesh);
    this.mat.dispose();
  }
}
