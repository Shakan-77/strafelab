/**
 * AimPro movement model on branch `latest-version` (formerly `outside-values-test`). Its jump, air steering and landing drive the default physics; ?physics=aimpro runs it in full.
 *
 * Source of the numbers: the AimPro (aimpro.world) web client, as mirrored in the GitHub repo
 * XDL0-0/miaozhun-offline (upstream/aimpro-2026-11-05/client/aim-kernels/kernel-aimlab-42-*.js,
 * player movement config `LA`). That client has no license, and the mirror redistributes it without
 * permission. The repository owner chose to publish these values on `latest-version` knowing that.
 * They are AimPro's own tuning of Valorant, not Riot data. Only the numbers were taken; the step
 * functions below are StrafeLab's own implementation of the model they describe. See CONTEXT.md and PLAN.md.
 */
export const AIMPRO = {
  // base values at knife speed (6.75 m/s); everything scales by weaponRun / 6.75
  base: { accel: 36.75, friction: 4.75, frictionMin: 9, braking: 30, maxSpeed: 6.75 },
  // per-stance multipliers on the base values
  stance: {
    run: { accel: 1, friction: 1, frictionMin: 1, braking: 1, maxSpeed: 1 },
    walk: { accel: 0.55, friction: 0.9, frictionMin: 1.45, braking: 0.55, maxSpeed: 0.6 },
    crouch: { accel: 0.5, friction: 1.55, frictionMin: 1.55, braking: 1, maxSpeed: 0.35 },
    air: { accel: 4, friction: 0, frictionMin: 0, braking: 0, maxSpeed: 1.1 },
  },
  aboveMaxDecay: 13, // m/s² bleed when above the stance's max speed
  jump: {
    maxHeight: 1.15, // m
    airTime: 0.675, // s, launch to landing on flat ground
    crouchHop: 0.975, // launch multiplier when fully crouched
    speedLimit: 0.75, // Quake-style air wish-speed cap (m/s)
    airControl: 0.45, // fraction of air accel available
    airBoostMult: 2, // more control when almost stationary...
    airBoostThreshold: 0.25, // ...below this speed (m/s)
    counterSteerStartDeg: 150, // input this far from your path counts as counter-steer...
    counterSteerMult: 0.5, // ...and gets half the accel
    angleThresholdDeg: 45, // W+A/D at more than this angle from your path: sideways part only
  },
  landSlow: {
    duration: 0.5, // s after landing
    minFall: 0.05, // m of fall before it applies
    // speed multiplier over normalised time (0..1 of duration)
    curve: [[0, 1], [0.03, 1], [0.1, 0.5], [0.5, 0.5], [1, 1]],
  },
};

const J = AIMPRO.jump;
export const AIMPRO_LAUNCH = (2 * J.maxHeight) / (J.airTime / 2); // ≈ 6.81 m/s
export const AIMPRO_GRAVITY = (2 * J.maxHeight) / ((J.airTime / 2) ** 2); // ≈ 20.19 m/s²

/** Effective stance values for a weapon speed scale `k` (= weapon run speed / 6.75). */
function stanceValues(name, k) {
  const b = AIMPRO.base;
  const s = AIMPRO.stance[name];
  const accel = b.accel * s.accel * k;
  const friction = b.friction * s.friction;
  const limit = friction > 0 ? Math.min(b.maxSpeed * s.maxSpeed, (b.accel * s.accel) / friction) : b.maxSpeed * s.maxSpeed;
  return {
    accel,
    friction,
    frictionMin: b.frictionMin * s.frictionMin * k,
    braking: b.braking * s.braking * k,
    max: limit * k,
  };
}

/** Bleed speed above `max` by up to aboveMaxDecay·dt. Returns the scaled [vx, vz]. */
function decayAbove(vx, vz, max, dt) {
  const sp = Math.hypot(vx, vz);
  const over = sp - max;
  if (over <= 0) return [vx, vz];
  const to = Math.max(0, sp - Math.min(AIMPRO.aboveMaxDecay * dt, over));
  return [(vx * to) / sp, (vz * to) / sp];
}

/**
 * Ground step. Friction always acts (proportional to speed, with a floor), braking is added when
 * no key is held, then input accelerates you along the wish direction.
 */
export function aimproGround(vx, vz, wx, wz, hasInput, stance, k, dt, speedMult = 1) {
  const st = stanceValues(stance, k);
  const sp = Math.hypot(vx, vz);
  const drop = Math.max(st.friction * sp, st.frictionMin) + (hasInput ? 0 : st.braking);
  const left = Math.max(0, sp - drop * dt);
  if (sp > 1e-9) {
    vx = (vx / sp) * left;
    vz = (vz / sp) * left;
  } else {
    vx = 0;
    vz = 0;
  }
  if (hasInput) {
    vx += wx * st.accel * dt;
    vz += wz * st.accel * dt;
  }
  return decayAbove(vx, vz, st.max * speedMult, dt);
}

/**
 * Air step: Quake-style acceleration capped so speed along your keys can't exceed speedLimit,
 * with half accel when pushing against your path. `fwd` and `side` are the raw key axes.
 */
export function aimproAir(vx, vz, wx, wz, hasInput, fwd, side, k, dt) {
  const st = stanceValues('air', k);
  if (hasInput) {
    const sp = Math.hypot(vx, vz);
    let control = J.airControl;
    if (sp < J.airBoostThreshold) control = Math.min(1, J.airBoostMult * control);
    let add = st.accel * control * dt;
    const ux = sp > 1e-6 ? vx / sp : 0;
    const uz = sp > 1e-6 ? vz / sp : 0;
    const cos = Math.max(-1, Math.min(1, wx * ux + wz * uz));
    const ang = (Math.acos(cos) * 180) / Math.PI;
    if (ang >= J.counterSteerStartDeg) add *= J.counterSteerMult;
    if (Math.abs(fwd) > 0.15 && Math.abs(side) > 0.15 && sp > J.speedLimit && ang > J.angleThresholdDeg && ang < 90) {
      // diagonal keys while moving: keep only the part across your path
      wx -= ux * cos;
      wz -= uz * cos;
      const l = Math.hypot(wx, wz);
      if (l > 1e-4) {
        wx /= l;
        wz /= l;
      }
    }
    const along = vx * wx + vz * wz;
    if (along + add > J.speedLimit) add = Math.max(J.speedLimit - along, 0);
    vx += wx * add;
    vz += wz * add;
  }
  return decayAbove(vx, vz, st.max, dt);
}

/** Speed multiplier `t` seconds after a landing that fell `fall` metres. */
export function aimproLandSlow(t, fall, fullFall = J.maxHeight) {
  const L = AIMPRO.landSlow;
  if (fall <= L.minFall || t < 0 || t >= L.duration) return 1;
  const intensity = Math.min(1, fall / fullFall);
  const u = t / L.duration;
  const c = L.curve;
  let m = 1;
  for (let i = 1; i < c.length; i++) {
    if (u <= c[i][0]) {
      const [u0, v0] = c[i - 1];
      const [u1, v1] = c[i];
      m = v0 + ((v1 - v0) * (u - u0)) / Math.max(1e-9, u1 - u0);
      break;
    }
  }
  return 1 + (m - 1) * intensity;
}
