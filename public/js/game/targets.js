import * as THREE from 'three';
import { clamp, lerp } from '../util.js';
import { MOVE } from './player.js';

export const ENEMY_COLORS = { red: '#ff4d5e', yellow: '#f2e33b', purple: '#c65bff' };

const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
  torso: new THREE.CylinderGeometry(0.5, 0.36, 1, 8).rotateY(Math.PI / 8),
  limb: new THREE.CylinderGeometry(0.5, 0.4, 1, 8).rotateY(Math.PI / 8),
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
const LEG = { hStand: 0.86, hCrouch: 0.55 };
const HEAD_Y = BODY.h + HEAD_R + 0.01;

function enemyMaterials(colorHex) {
  const color = new THREE.Color(colorHex);
  return {
    armor: new THREE.MeshLambertMaterial({ color: '#8f9baa', emissive: color.clone().multiplyScalar(0.11) }),
    shell: new THREE.MeshLambertMaterial({ color: '#c9d2dc', emissive: color.clone().multiplyScalar(0.14) }),
    joints: new THREE.MeshLambertMaterial({ color: '#303949' }),
    light: new THREE.MeshLambertMaterial({ color, emissive: color.clone().multiplyScalar(0.65) }),
  };
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
    this.stride = this.prevStride = 0;
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
    this.hitMeshes = [];
    this.buildModel();
    game.scene.add(this.group);
    this.frame(1);
    game.addTarget(this);
  }

  buildModel() {
    const { armor, shell, joints, light } = this.mats;
    const part = (parent, geometry, material, size, position, zone) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(...size);
      mesh.position.set(...position);
      mesh.userData.hit = { target: this, zone };
      this.hitMeshes.push(mesh);
      parent.add(mesh);
    };
    const upper = this.upper = new THREE.Group();
    this.group.add(upper);
    part(upper, GEO.torso, armor, [BODY.w, BODY.h, BODY.d], [0, BODY.h / 2, 0], 'body');
    part(upper, GEO.box, joints, [0.3, 0.12, 0.22], [0, -0.012, 0], 'body');
    part(upper, GEO.box, shell, [0.32, 0.18, 0.055], [0, 0.415, 0.132], 'body');
    part(upper, GEO.box, light, [0.21, 0.025, 0.024], [0, 0.43, 0.171], 'body');
    part(upper, GEO.limb, joints, [0.108, 0.12, 0.105], [0, 0.62, 0], 'body');
    part(upper, GEO.sphere, shell, [HEAD_R, HEAD_R * 1.1, HEAD_R], [0, HEAD_Y, 0], 'head');
    part(upper, GEO.box, joints, [0.179, 0.075, 0.05], [0, HEAD_Y + 0.018, 0.103], 'head');
    part(upper, GEO.box, light, [0.149, 0.027, 0.023], [0, HEAD_Y + 0.024, 0.132], 'head');

    this.limbs = [-1, 1].map((side) => {
      const arm = new THREE.Group();
      arm.position.set(side * 0.235, 0.48, 0);
      upper.add(arm);
      part(arm, GEO.sphere, shell, [0.09, 0.09, 0.094], [0, 0, 0], 'body');
      part(arm, GEO.box, light, [0.073, 0.024, 0.022], [0, 0.009, 0.091], 'body');
      part(arm, GEO.limb, armor, [0.115, 0.22, 0.13], [0, -0.125, 0], 'body');
      part(arm, GEO.limb, joints, [0.105, 0.22, 0.115], [0, -0.32, 0.03], 'body');
      const leg = new THREE.Group();
      leg.position.x = side * 0.105;
      this.group.add(leg);
      part(leg, GEO.limb, armor, [0.17, 0.43, 0.184], [0, -0.215, 0], 'legs');
      part(leg, GEO.sphere, joints, [0.072, 0.079, 0.082], [0, -0.43, 0.018], 'legs');
      part(leg, GEO.limb, armor, [0.143, 0.365, 0.145], [0, -0.63, 0.006], 'legs');
      part(leg, GEO.box, joints, [0.155, 0.1, 0.218], [0, -0.81, 0.046], 'legs');
      return { arm, leg, side };
    });
  }

  pose(crouch, stride) {
    const legH = lerp(LEG.hStand, LEG.hCrouch, crouch);
    const swing = Math.sin(stride) * Math.min(1, Math.abs(this.v) / this.speed);
    this.upper.position.y = legH;
    for (const { arm, leg, side } of this.limbs) {
      leg.position.y = legH;
      leg.scale.y = legH / LEG.hStand;
      leg.rotation.set(side * swing * 0.22, 0, side * swing * 0.08);
      arm.rotation.set(-side * swing * 0.25 - 0.1 * crouch, 0, side * 0.13);
    }
  }

  worldPos(out = new THREE.Vector3(), s = this.s) {
    return out.copy(this.axis).multiplyScalar(s).add(this.origin);
  }

  headWorld(out = new THREE.Vector3()) {
    this.worldPos(out);
    out.y += lerp(LEG.hStand, LEG.hCrouch, this.crouch) + HEAD_Y;
    return out;
  }

  chestWorld(out = new THREE.Vector3()) {
    this.worldPos(out);
    out.y += lerp(LEG.hStand, LEG.hCrouch, this.crouch) + BODY.h / 2;
    return out;
  }

  // ---------------------------------------------------------------- simulation
  fixedStep(dt) {
    if (!this.alive) return;
    this.prevS = this.s;
    this.prevCrouch = this.crouch;
    this.prevStride = this.stride;
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
    this.stride += Math.abs(this.s - this.prevS) * Math.PI * 2 / 1.8;
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
  frame(alpha, dt = 0) {
    const s = lerp(this.prevS, this.s, alpha);
    this.worldPos(this.group.position, s);
    this.pose(lerp(this.prevCrouch, this.crouch, alpha), lerp(this.prevStride, this.stride, alpha));
    const cam = this.game.camera.position;
    this.group.rotation.y = Math.atan2(cam.x - this.group.position.x, cam.z - this.group.position.z);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.setEmissive(false);
    }
    if (this.deathT >= 0) {
      this.deathT += dt;
      const t = clamp(this.deathT / 0.35, 0, 1);
      this.group.rotation.x = -t * 1.35;
      this.group.position.y -= t * 0.3;
      if (this.deathT > 0.55) this.dispose();
    }
    this.group.updateMatrixWorld(true);
  }

  setEmissive(on) {
    for (const m of Object.values(this.mats)) {
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
    this.mesh.updateMatrixWorld();
    game.addTarget(this);
  }

  get position() {
    return this.mesh.position;
  }

  frame(_, dt) {
    if (this.popT >= 0) {
      this.popT += dt;
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
