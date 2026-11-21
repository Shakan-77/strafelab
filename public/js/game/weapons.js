import { clamp, lerp } from '../util.js';

/**
 * Weapon profiles from the official VALORANT wiki (wiki.playvalorant.com, Nov 2026).
 * Spread = first-shot spread (+ spray error) + movement penalty + landing penalty, in degrees
 * (radius of the error cone). Movement penalties ramp in once you're above the weapon's
 * deadzone (% of its run speed), just like the game.
 */
export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'Rifle',
    note: '1-tap head (160) · 4 body (40) · RMB = 1.25x ADS',
    auto: true,
    interval: 1 / 9.75,
    mag: 25,
    reload: 2.5,
    dmg: { head: 160, body: 40, legs: 34 },
    runSpeed: 5.4,
    accurateFrac: 0.275, // deadzone 27.5%
    spread: { first: 0.25 },
    pen: { crouch: 0.8, walk: 3, run: 6, air: 10 },
    crouchMult: 0.85,
    firingError: { startShot: 3, perShot: 0.25, max: 0.75, recover: 0.375 }, // spray caps at 1°
    recoil: { startShot: 3, kick: 0.42, max: 6, recover: 14 },
    // aim down sights: 1.25x, 76% move speed, 90% fire rate, 0.157° first shot
    scope: { zooms: [1.25], moveMult: 0.76, fireRateMult: 0.9, firstShot: 0.157, overlay: false, unscopeOnFire: false },
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    note: 'Body/head kill · legs 120 · 0.6 shots/s',
    auto: false,
    interval: 1 / 0.6,
    mag: 5,
    reload: 3.7,
    dmg: { head: 255, body: 150, legs: 120 },
    runSpeed: 5.13,
    accurateFrac: 0.15, // deadzone 15%
    spread: { first: 5 }, // unscoped (hip) first shot
    pen: { crouch: 7.5, walk: 10, run: 15, air: 15 },
    crouchMult: 0.9,
    // 2.5x / 5x, perfect first shot when scoped and still, 72% move speed scoped
    scope: { zooms: [2.5, 5.0], moveMult: 0.72, firstShot: 0, overlay: true, unscopeOnFire: true },
  },
  precision: {
    id: 'precision',
    name: 'Precision',
    note: 'No spread, no recoil: pure aim',
    auto: false,
    interval: 0.06,
    mag: Infinity,
    reload: 0,
    dmg: { head: 999, body: 999, legs: 999 },
    runSpeed: 5.4,
    accurateFrac: 1,
    spread: { first: 0 },
    pen: { crouch: 0, walk: 0, run: 0, air: 0 },
    noLandPenalty: true,
    crouchMult: 1,
  },
  tracking: {
    id: 'tracking',
    name: 'Crosshair only',
    noFire: true,
    runSpeed: 5.4,
    accurateFrac: 1,
    mag: Infinity,
  },
  knife: {
    id: 'knife',
    name: 'Knife',
    note: 'Fastest run speed (6.75 m/s)',
    noFire: true,
    runSpeed: 6.75,
    accurateFrac: 0.275,
    spread: { first: 0 },
    pen: { crouch: 0, walk: 0, run: 0, air: 0 },
    mag: Infinity,
  },
};

/** Every gun gets +7° for 0.225 s after landing (VALORANT patch 1.09). */
export const LAND_PENALTY = { deg: 7, time: 0.225 };

export const accurateSpeed = (w) => w.runSpeed * w.accurateFrac;

/** Movement penalty (degrees) for the player's current state, ramping in above the deadzone. */
export function movementPenalty(w, player) {
  const pen = w.pen;
  if (!player.onGround) return pen.air;
  const s = player.hspeed();
  const acc = accurateSpeed(w);
  if (s <= acc) return 0;
  if (player.crouched) {
    const crouchTop = player.runSpeed * 0.45;
    return lerp(0, pen.crouch, clamp((s - acc) / Math.max(0.01, crouchTop - acc), 0, 1));
  }
  const walk = player.walkSpeed;
  if (s <= walk) return lerp(0, pen.walk, clamp((s - acc) / Math.max(0.01, walk - acc), 0, 1));
  return lerp(pen.walk, pen.run, clamp((s - walk) / Math.max(0.01, w.runSpeed - walk), 0, 1));
}

/** Current error-cone radius (degrees). */
export function computeSpread(w, player, { scoped, firingError }) {
  let first = scoped && w.scope ? w.scope.firstShot : w.spread.first;
  if (player.crouched) first *= w.crouchMult || 1;
  let total = first + firingError + movementPenalty(w, player);
  if (!w.noLandPenalty && player.landPenalty > 0) total += LAND_PENALTY.deg;
  return total;
}
