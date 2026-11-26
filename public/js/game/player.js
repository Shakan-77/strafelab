import * as THREE from 'three';
import { clamp } from '../util.js';
import { AIMPRO, AIMPRO_GRAVITY, AIMPRO_LAUNCH, aimproAir, aimproGround, aimproLandSlow } from './physics-aimpro.js';

/**
 * Which movement model to run (?physics=...):
 * - 'strafelab' (default): StrafeLab's ground movement and silent-jump rules, with AimPro's jump,
 *   air steering and landing slow-down (physics-aimpro.js). The user compared both in play and found
 *   AimPro's jumping and air steering closer to Valorant.
 * - 'classic': StrafeLab's previous air model (camera-follow steering, mid-air reversal), for comparison.
 * - 'aimpro': AimPro's full model, ground included, for comparison.
 * Only the default is ranked.
 */
export const PHYSICS = (() => {
  try {
    const p = new URLSearchParams(globalThis.location?.search || '').get('physics');
    return p === 'aimpro' || p === 'classic' ? p : 'strafelab';
  } catch {
    return 'strafelab';
  }
})();

/**
 * Movement tuned to feel like Valorant (metres and seconds):
 * - run 5.4 m/s with a rifle (6.75 with knife) [official wiki]; walk 56%, crouch 45% [estimates]
 * - acceleration: ~0.26 s from standstill to run speed (Unreal default; estimate)
 * - estimated braking: releasing the key crosses the rifle's 27.5% deadzone in ~106 ms and
 *   comes to rest in ~160 ms. Pressing the opposite key crosses it in ~78 ms (10 ticks), matching
 *   Range footage of a Radiant player with 0.00° movement error 83 ms after the opposite key.
 *   Unreal-style braking: dv/dt = -(brakeFriction·v + brakeDecel)
 * - jump, air and landing (default since branch outside-values-test, from AimPro's model in
 *   physics-aimpro.js), retuned by playtest: apex ~1.0 m over ~0.675 s (AimPro: 1.15 m); Quake-style air control where you steer with a
 *   strafe key plus the mouse (W alone barely bends your path), speed along your keys capped at
 *   0.75 m/s, half accel when pushing against your path; a speed dip for 0.5 s after landing
 *   (60% of AimPro's: down to ~75% speed after a full jump).
 *   ?physics=classic restores StrafeLab's previous air model (camera-follow steering, mid-air
 *   reversal that carries you ~0.5 m behind take-off), below in the `classic` branch of step().
 * - crouch-jump: crouching in the air (or jumping while crouched) tucks your legs up, so your
 *   feet clear ledges a normal jump can't (~1.2 m instead of ~1.0 m)
 * - one "quiet speed" (just above walking speed): faster than it, footsteps start
 * - silent jump: the take-off is silent whenever Walk or Crouch is held (at any speed); otherwise heard
 * - silent landing: landing makes noise if you hit the ground hard (fell more than ~0.3 m from
 *   the top of your arc) or faster than the quiet speed. A crouch-jump onto a ledge you only just
 *   clear, at walking speed, lands silently, even if you uncrouch before touching down.
 */
export const MOVE = {
  tagSlow: 0.725, // patch 3.0
  tagTime: 0.5, // estimate
  tuckLift: 0.25,
  silentLandFall: 0.31, // m: a landing that fell further than this is heard (3.2 m/s impact at g = 16.5)
  // Default physics: AimPro's jump shape and air steering, retuned by the owner's playtest.
  // AimPro's 1.15 m apex felt too high; same 0.675 s air time, so running-jump distance is unchanged.
  jumpApex: 1.0, // m
  jumpAirTime: 0.675, // s
  // AimPro's landing slow-down felt too strong: keep 60% of its dip (50% → 70% speed at worst)
  landSlowScale: 0.6,
  quietMult: 1.08, // × walk speed: above this, footsteps / jumps / landings are heard
  refRunSpeed: 5.4, // accel and braking below are for this run speed (rifle) and scale with the weapon's
  accel: 20.8, // estimated ~0.26 s from standstill to rifle run speed
  brakeFriction: 3.77, // 1/s  } fitted so 5.4 m/s → 25% in ~110 ms, full stop in ~160 ms
  brakeDecel: 24.5, // m/s² }
  // extra m/s² while pressing the opposite key: fitted so a full-speed rifle counter-strafe is
  // accurate after 10 ticks (~78 ms), from Range footage showing accurate shots 83 ms after the press
  counterExtra: 13,
  // m/s² mid-air toward input pointing back the way you jumped: calibrated so a full-speed jump
  // with an immediate 180° reversal lands ~0.5 m behind the take-off point, as in Valorant
  airReverse: 19,
  gravity: 16.5,
  jumpVel: 5.55,
  airAccel: 5,
  // Unreal-style air control: mid-air acceleration toward your keys = ground accel × airControl.
  // Riot doesn't publish Valorant's value. 0.0645 (≈1.34 m/s² sideways, ~14°/s turn at 5.4 m/s)
  // makes a full-speed W jump with D held drift ~0.3 m right: about 1/12 of the 3.6 m jump.
  airControl: 0.0645,
  airFollow: (240 * Math.PI) / 180, // rad/s your path can follow the camera with a key held (estimate)
  minReverseSpeed: 0.7,
  airStartCap: 1.8, // estimated speed available when jumping from rest
  walkMult: 0.56,
  crouchMult: 0.45,
  radius: 0.32,
  standH: 1.8,
  crouchH: 1.3,
  eyeStand: 1.62,
  eyeCrouch: 1.15,
  stepDist: 1.65,
};

const EPS = 1e-4;

/** Integrate dv/dt = -(friction·v + decel) across the tick. */
function brake(speed, dt, decel = MOVE.brakeDecel) {
  const loss = -Math.expm1(-MOVE.brakeFriction * dt);
  return Math.max(0, speed - (speed + decel / MOVE.brakeFriction) * loss);
}

export class Player {
  constructor() {
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.crouched = false;
    this.tucked = false; // crouched mid-air with legs pulled up
    this.airTime = 0;
    this.speedMult = 1; // scoped / ADS movement speed
    this.landPenalty = 0; // seconds of post-landing inaccuracy left
    this.eye = MOVE.eyeStand;
    this.prevEye = this.eye;
    this.runSpeed = 5.4;
    this.accurateSpeed = 1.35;
    this.input = { f: 0, b: 0, l: 0, r: 0, walk: false, crouch: false };
    this.jumpBuffer = 0;
    this.frozen = false;
    this.allowMove = true;
    this.allowJump = true;
    this.takeoffSpeed = 0;
    this.stepAcc = 0;
    this.stop = null;
    this.onEvent = () => {};
    this.model = PHYSICS;
    this.sinceLand = 9;
    this.lastFall = 0;
  }

  /** Jump, air and landing model: AimPro's unless running 'classic'. */
  get airModel() {
    return this.model === 'classic' ? 'strafelab' : 'aimpro';
  }

  /** Ground model: StrafeLab's unless running the full 'aimpro' profile. */
  get groundModel() {
    return this.model === 'aimpro' ? 'aimpro' : 'strafelab';
  }

  get gravity() {
    if (this.model === 'aimpro') return AIMPRO_GRAVITY;
    if (this.airModel === 'aimpro') return (8 * MOVE.jumpApex) / MOVE.jumpAirTime ** 2;
    return MOVE.gravity;
  }

  /** Jump launch speed for the current model (crouched jumps launch slightly lower). */
  launchSpeed() {
    if (this.airModel !== 'aimpro') return MOVE.jumpVel;
    const v = this.model === 'aimpro' ? AIMPRO_LAUNCH : (4 * MOVE.jumpApex) / MOVE.jumpAirTime;
    return v * (this.crouched ? AIMPRO.jump.crouchHop : 1);
  }

  /** Speed multiplier from the post-landing slow-down. */
  landSlowMult() {
    if (this.airModel !== 'aimpro') return 1;
    const m = aimproLandSlow(this.sinceLand, this.lastFall, this.model === 'aimpro' ? AIMPRO.jump.maxHeight : MOVE.jumpApex);
    return this.model === 'aimpro' ? m : 1 + (m - 1) * MOVE.landSlowScale;
  }

  /** Impact speed above which a landing is heard: a fall of more than silentLandFall at this gravity. */
  get silentLandVy() {
    return Math.sqrt(2 * this.gravity * MOVE.silentLandFall);
  }

  reset(pos, runSpeed, accurateSpeed) {
    this.pos.set(...pos);
    this.prev.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this.crouched = false;
    this.tucked = false;
    this.airTime = 0;
    this.landPenalty = 0;
    this.eye = this.prevEye = MOVE.eyeStand;
    this.runSpeed = runSpeed;
    this.accurateSpeed = accurateSpeed;
    this.jumpBuffer = 0;
    this.takeoffSpeed = 0;
    this.tagT = 0;
    this.takeoffY = undefined;
    this.airYaw = undefined;
    this.uncrouchedMidAir = false;
    this.recordTakeoffDir(0, 0);
    this.stepAcc = 0;
    this.stop = null;
  }

  teleport(pos) {
    this.pos.set(...pos);
    this.prev.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this.jumpBuffer = 0;
    this.landPenalty = 0;
    this.tagT = 0;
    this.takeoffSpeed = 0;
    this.takeoffY = undefined;
    this.airYaw = undefined;
    this.uncrouchedMidAir = false;
    this.recordTakeoffDir(0, 0);
    this.stop = null;
    if (this.tucked) {
      this.tucked = false;
      this.eye = this.prevEye = MOVE.eyeCrouch;
    }
    this.airTime = 0;
  }

  /** Fastest you can move without making footstep noise. */
  get quietSpeed() {
    return this.walkSpeed * MOVE.quietMult;
  }

  /** Would this landing be heard? Hard impact or faster than the quiet speed = loud. */
  isLoudLanding(vy, h) {
    return vy > this.silentLandVy || h > this.quietSpeed;
  }

  /** Would this take-off be heard? Holding Walk or Crouch silences it, whatever your speed. */
  isLoudJump(walkHeld, crouched) {
    return !walkHeld && !crouched;
  }

  /** Free space for a hull of height h with feet at y? */
  fits(world, y, h) {
    for (const c of world.colliders) if (c.enabled && this.overlaps(c, h, this.pos.x, y, this.pos.z)) return false;
    return true;
  }

  /** Crouch in the air: legs come up, so the feet rise while the camera stays put. */
  tuck(world) {
    if (this.tucked) return;
    const lift = MOVE.tuckLift;
    if (!this.fits(world, this.pos.y + lift, MOVE.crouchH)) return; // no headroom: plain crouch
    this.pos.y += lift;
    this.prev.y += lift;
    this.eye -= lift;
    this.prevEye -= lift;
    this.tucked = true;
    this.onEvent('tuck', {});
  }

  /** Release crouch in the air: legs drop back down (onto a surface if one is closer). */
  untuck(world) {
    let y = this.pos.y - MOVE.tuckLift;
    for (const c of world.colliders) {
      if (c.enabled && c.max.y <= this.pos.y + 1e-3 && this.overlaps(c, MOVE.standH, this.pos.x, y, this.pos.z)) y = Math.max(y, c.max.y);
    }
    if (!this.fits(world, y, MOVE.standH)) return false; // ceiling in the way: stay tucked
    const d = this.pos.y - y;
    this.pos.y = y;
    this.prev.y -= d;
    this.eye += d;
    this.prevEye += d;
    this.tucked = false;
    this.crouched = false;
    if (!this.onGround) this.uncrouchedMidAir = true; // crouch-jump released in the air
    return true;
  }

  recordTakeoffDir(vx, vz) {
    const l = Math.hypot(vx, vz);
    this.takeoffDirX = l > 1e-3 ? vx / l : 0;
    this.takeoffDirZ = l > 1e-3 ? vz / l : 0;
  }

  /**
   * Tagging (patch 3.0): getting shot slows you 72.5%, which drops a running rifle user to 27.5%
   * of run speed, exactly the accuracy deadzone (patch 9.10 explains this intent). Riot doesn't
   * publish how long it lasts; 0.5 s easing back is an estimate.
   */
  tag() {
    this.tagT = MOVE.tagTime;
    const cap = this.runSpeed * (1 - MOVE.tagSlow);
    const h = this.hspeed();
    if (h > cap) {
      this.vel.x *= cap / h;
      this.vel.z *= cap / h;
    }
  }

  tagMult() {
    return this.tagT > 0 ? 1 - MOVE.tagSlow * (this.tagT / MOVE.tagTime) : 1;
  }

  hspeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  height() {
    return this.crouched ? MOVE.crouchH : MOVE.standH;
  }

  get walkSpeed() {
    return this.runSpeed * MOVE.walkMult;
  }

  queueJump() {
    this.jumpBuffer = 0.12;
  }

  overlaps(c, h, px = this.pos.x, py = this.pos.y, pz = this.pos.z) {
    const r = MOVE.radius;
    return px - r < c.max.x && px + r > c.min.x && pz - r < c.max.z && pz + r > c.min.z && py < c.max.y && py + h > c.min.y;
  }

  canStand(world) {
    for (const c of world.colliders) if (c.enabled && this.overlaps(c, MOVE.standH)) return false;
    return true;
  }

  step(dt, yaw, world) {
    this.prev.copy(this.pos);
    this.prevEye = this.eye;
    const inp = this.input;
    const locked = this.frozen || !this.allowMove;

    // crouch (in the air this tucks your legs: the crouch-jump)
    const wantCrouch = inp.crouch && !locked;
    if (wantCrouch && !this.crouched) {
      this.crouched = true;
      if (!this.onGround) this.tuck(world);
    } else if (!wantCrouch && this.crouched) {
      if (this.tucked) this.untuck(world);
      else if (this.canStand(world)) {
        this.crouched = false;
        if (!this.onGround) this.uncrouchedMidAir = true;
      }
    }
    const targetEye = this.crouched ? MOVE.eyeCrouch : MOVE.eyeStand;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 16);

    // wish direction from WASD relative to view yaw
    const fx = locked ? 0 : inp.f - inp.b;
    const sx = locked ? 0 : inp.r - inp.l;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    let wx = -sinY * fx + cosY * sx;
    let wz = -cosY * fx - sinY * sx;
    const wl = Math.hypot(wx, wz);
    let wishSpeed = 0;
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
      wishSpeed = this.runSpeed * this.speedMult * this.tagMult() * (this.crouched ? MOVE.crouchMult : inp.walk ? MOVE.walkMult : 1);
    }

    const speedBefore = this.hspeed();
    let vx = this.vel.x;
    let vz = this.vel.z;
    const inputAlignment = vx * wx + vz * wz;

    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.landPenalty > 0) this.landPenalty -= dt;
    if (this.tagT > 0) this.tagT -= dt;
    this.sinceLand += dt;
    if (this.onGround && this.jumpBuffer > 0 && !locked && this.allowJump) {
      this.vel.y = this.launchSpeed();
      this.onGround = false;
      this.jumpBuffer = 0;
      this.uncrouchedMidAir = false;
      this.takeoffSpeed = Math.hypot(vx, vz);
      this.recordTakeoffDir(vx, vz);
      this.takeoffY = this.pos.y;
      this.airYaw = yaw;
      this.onEvent('jump', {
        speed: this.takeoffSpeed,
        crouched: this.crouched,
        walk: !!inp.walk,
        loud: this.isLoudJump(!!inp.walk, this.crouched),
      });
      // jumping while already crouched counts as a crouch-jump too
      if (this.crouched) this.tuck(world);
    }

    // AimPro's model (physics-aimpro.js): weapon speed scales its knife-speed base values
    const k = (this.runSpeed * this.speedMult * this.tagMult()) / AIMPRO.base.maxSpeed;
    // speed dip for half a second after landing (AimPro air model)
    const landSlow = this.landSlowMult();
    if (this.onGround && this.groundModel === 'aimpro') {
      const stance = this.crouched ? 'crouch' : inp.walk ? 'walk' : 'run';
      [vx, vz] = aimproGround(vx, vz, wx, wz, wishSpeed > 0, stance, k, dt, landSlow);
    } else if (!this.onGround && this.airModel === 'aimpro') {
      [vx, vz] = aimproAir(vx, vz, wx, wz, wishSpeed > 0, fx, sx, k, dt);
    } else if (this.onGround) {
      wishSpeed *= landSlow;
      // acceleration and braking scale with the weapon's run speed (knife 1.25x, sniper 0.95x of the
      // rifle), so every weapon reaches full speed and stops in the same time, as in AimPro's model
      const kw = this.runSpeed / MOVE.refRunSpeed;
      const accel = MOVE.accel * kw;
      const decel = MOVE.brakeDecel * kw;
      if (wishSpeed > 0) {
        let along = inputAlignment;
        let px = vx - along * wx;
        let pz = vz - along * wz;
        // velocity that isn't in the new direction brakes on the same curve as a release
        const pl = Math.hypot(px, pz);
        if (pl > 0) {
          const k = brake(pl, dt, decel) / pl;
          px *= k;
          pz *= k;
        }
        if (along < 0) {
          // counter-strafe: brake harder than releasing until you stop, then accelerate
          const cdecel = (MOVE.brakeDecel + MOVE.counterExtra) * kw;
          const stopTime = Math.log1p(-along * MOVE.brakeFriction / cdecel) / MOVE.brakeFriction;
          along = stopTime >= dt ? -brake(-along, dt, cdecel) : Math.min(wishSpeed, accel * (dt - stopTime));
        } else if (along < wishSpeed) {
          along = Math.min(wishSpeed, along + accel * dt);
        } else {
          along = Math.max(wishSpeed, brake(along, dt, decel)); // e.g. switching from run to walk, or knife to rifle
        }
        vx = along * wx + px;
        vz = along * wz + pz;
        // Turn without gaining speed. A lower stance speed still takes time to reach.
        const speed = Math.hypot(vx, vz);
        const cap = Math.max(wishSpeed, brake(speedBefore, dt, decel));
        if (speed > cap) {
          vx *= cap / speed;
          vz *= cap / speed;
        }
      } else if (speedBefore > 0) {
        const k = brake(speedBefore, dt, decel) / speedBefore;
        vx *= k;
        vz *= k;
      }
    } else if (wishSpeed > 0) {
      const sp0 = speedBefore;
      const ux = sp0 > 1e-3 ? vx / sp0 : 0;
      const uz = sp0 > 1e-3 ? vz / sp0 : 0;
      const startingSpeed = Math.min(wishSpeed, MOVE.airStartCap);
      const buildingSpeed = sp0 < startingSpeed;
      // "pressing against your motion" = input opposes velocity while you're still moving roughly
      // the way you face (e.g. S while flying forward); over-turning the mouse is not braking
      const facing = -Math.sin(yaw) * ux - Math.cos(yaw) * uz;
      const opposing = ux * wx + uz * wz < -0.9 && Math.abs(facing) > 0.5;
      // input pointing back the way you're flying (S, W after a flick, or A/D against a sideways
      // jump, as in a jump peek pulled back with the opposite strafe key). Checked against your
      // current path, so a smooth mouse turn with a key held just steers. It keeps pushing back the
      // way you came until you're back up to take-off speed.
      const backToTakeoff = this.takeoffDirX * wx + this.takeoffDirZ * wz < -0.7 && sp0 < this.takeoffSpeed - 0.05;
      const reversing = this.takeoffSpeed > MOVE.minReverseSpeed && (ux * wx + uz * wz < -0.7 || backToTakeoff);
      if (opposing || reversing) {
        // Valorant: a full-speed jump with a 180° turn lands ~0.5 m behind the take-off point, so
        // opposite input brakes and then pushes you back hard (calibrated to that measurement)
        vx += wx * MOVE.airReverse * dt;
        vz += wz * MOVE.airReverse * dt;
      } else {
        // strafe acceleration bends the path toward your view when strafe + mouse turn agree...
        const cur = vx * wx + vz * wz;
        const add = startingSpeed - cur;
        // running jumps steer by camera (below), so only slow jumps build speed from keys here
        if (add > 0 && buildingSpeed) {
          const acc = Math.min(MOVE.airAccel * wishSpeed * dt, add);
          vx += acc * wx;
          vz += acc * wz;
        }
        // ...but, unlike CS, turning keeps your speed exactly (no loss when over-turning, no gain)
        const sp1 = Math.hypot(vx, vz);
        const target = buildingSpeed ? Math.min(sp1, startingSpeed) : sp0;
        if (sp1 > 1e-6) {
          vx *= target / sp1;
          vz *= target / sp1;
        }
        // Unreal-style air control: your path also swings toward the direction your keys point
        // (A/D alone, or W while turning the mouse), at a limited rate and without changing speed.
        const sp2 = Math.hypot(vx, vz);
        if (sp2 > 0.3) {
          let cur = Math.atan2(vz, vx);
          // With any movement key held your path turns with the camera as you move the mouse (up to
          // airFollow), so the camera does the steering. Velocity angle = -90° - yaw, so a yaw
          // change of d turns the path by -d.
          if (this.airYaw !== undefined) {
            let dYaw = yaw - this.airYaw;
            dYaw -= Math.round(dYaw / (Math.PI * 2)) * Math.PI * 2;
            const lim = MOVE.airFollow * dt;
            cur -= Math.max(-lim, Math.min(lim, dYaw));
          }
          // Keys alone (A/D, or W+D without moving the mouse) only nudge the path via air control:
          // a full-speed W jump with D held drifts ~1/12 of the jump length sideways.
          const want = Math.atan2(wz, wx);
          let diff = want - cur;
          diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
          const keyRate = (MOVE.accel * MOVE.airControl) / sp2; // rad/s: slower when moving faster
          cur += Math.sign(diff) * Math.min(Math.abs(diff), keyRate * dt);
          vx = Math.cos(cur) * sp2;
          vz = Math.sin(cur) * sp2;
        }
      }
      const cap = Math.max(this.takeoffSpeed, startingSpeed);
      const sp = Math.hypot(vx, vz);
      if (sp > cap) {
        vx *= cap / sp;
        vz *= cap / sp;
      }
    }
    this.vel.x = vx;
    this.vel.z = vz;
    this.vel.y -= this.gravity * dt;
    if (!this.onGround) this.airYaw = yaw;

    const wasGround = this.onGround;
    const fallSpeed = this.vel.y;
    const hBefore = Math.hypot(this.vel.x, this.vel.z);
    if (!wasGround) this.airTime += dt;
    this.collide(world, dt);
    if (wasGround && !this.onGround) {
      this.takeoffSpeed = this.hspeed();
      this.recordTakeoffDir(this.vel.x, this.vel.z);
      this.takeoffY = this.prev.y; // walked off a ledge
      this.airYaw = yaw;
    }
    if (!wasGround && this.onGround) {
      const vy = Math.max(0, -fallSpeed);
      const wasTucked = this.tucked;
      this.tucked = false; // now simply crouched on the ground
      // Valorant silent jump: crouch-jump, release crouch mid-air, land at walking speed = no sound
      const crouchRelease = !!this.uncrouchedMidAir && hBefore <= this.quietSpeed;
      this.uncrouchedMidAir = false;
      // Valorant: holding Walk or Crouch, a landing that ends higher than where you jumped from
      // (you fell less than you rose) is silent, at any speed
      const ledgeLand = (!!inp.walk || this.crouched) && this.takeoffY !== undefined && this.pos.y > this.takeoffY + 0.02;
      // VALORANT: every gun is +7° inaccurate for 0.225 s after landing (ignore tiny step-offs)
      if (this.airTime > 0.1) this.landPenalty = 0.225;
      this.sinceLand = 0;
      this.lastFall = (vy * vy) / (2 * this.gravity);
      this.onEvent('land', {
        speed: vy,
        hspeed: hBefore,
        fall: (vy * vy) / (2 * this.gravity), // equivalent free-fall height
        airTime: this.airTime,
        tucked: wasTucked,
        crouched: this.crouched,
        crouchRelease,
        ledgeLand,
        loud: !crouchRelease && !ledgeLand && this.isLoudLanding(vy, hBefore),
      });
      this.airTime = 0;
    }

    // footsteps: running on the ground is loud, walking/crouching is silent
    const sp = this.hspeed();
    if (this.onGround && sp > this.quietSpeed) {
      this.stepAcc += sp * dt;
      if (this.stepAcc >= MOVE.stepDist) {
        this.stepAcc = 0;
        this.onEvent('step', { speed: sp });
      }
    } else if (sp < 0.5) {
      this.stepAcc = MOVE.stepDist * 0.6;
    }

    this.trackStop(dt, speedBefore, sp, wishSpeed > 0, inputAlignment);
  }

  /** Measures how long it takes to get from full speed to accurate speed, and how. */
  trackStop(dt, before, now, hasInput, alignment) {
    if (!this.onGround) {
      this.stop = null;
      return;
    }
    const counter = alignment < -0.01;
    if (!this.stop && before >= this.runSpeed * 0.75 && (!hasInput || counter)) {
      this.stop = { t: 0, counter, from: before };
    }
    const s = this.stop;
    if (!s) return;
    s.counter ||= counter;
    if (now <= this.accurateSpeed) {
      const fraction = clamp((before - this.accurateSpeed) / Math.max(before - now, 1e-6), 0, 1);
      this.stop = null;
      this.onEvent('stop', { duration: s.t + dt * fraction, counter: s.counter, from: s.from });
    } else {
      s.t += dt;
      if ((hasInput && alignment > 0.01) || s.t > 1) this.stop = null;
    }
  }

  collide(world, dt) {
    const r = MOVE.radius;
    const h = this.height();
    const cols = world.colliders;
    const p = this.pos;

    p.x += this.vel.x * dt;
    for (const c of cols) {
      if (!c.enabled || !this.overlaps(c, h)) continue;
      if (this.vel.x > 0) p.x = c.min.x - r - EPS;
      else if (this.vel.x < 0) p.x = c.max.x + r + EPS;
      this.vel.x = 0;
    }

    p.z += this.vel.z * dt;
    for (const c of cols) {
      if (!c.enabled || !this.overlaps(c, h)) continue;
      if (this.vel.z > 0) p.z = c.min.z - r - EPS;
      else if (this.vel.z < 0) p.z = c.max.z + r + EPS;
      this.vel.z = 0;
    }

    this.onGround = false;
    p.y += this.vel.y * dt;
    for (const c of cols) {
      if (!c.enabled || !this.overlaps(c, h)) continue;
      if (this.vel.y <= 0) {
        p.y = c.max.y;
        this.onGround = true;
      } else {
        p.y = c.min.y - h - EPS;
      }
      this.vel.y = 0;
    }
  }
}
