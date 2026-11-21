/** Shared geometry builders. Units are metres. The player faces -Z at yaw 0. */

export function floor(w, x0 = -50, x1 = 50, z0 = -100, z1 = 15, y = 0) {
  w.box([x0, y - 1, z0], [x1, y, z1], { mat: 'floor' });
}

export function backdrop(w, z, x0 = -50, x1 = 50, h = 12) {
  w.box([x0, 0, z - 1], [x1, h, z], { mat: 'wall' });
}

/** Strafe lane: low front rail (doesn't block head-level shots), side and back walls. */
export function strafeLane(w, half = 7) {
  w.box([-half - 0.5, 0, -1.8], [half + 0.5, 0.4, -1.5], { mat: 'wall' });
  w.box([-half - 0.5, 0.4, -1.68], [half + 0.5, 0.42, -1.62], { mat: 'accent', collide: false, block: false });
  w.box([-half - 0.5, 0, 1.5], [half + 0.5, 1.2, 1.9], { mat: 'wall' });
  w.box([-half - 0.5, 0, -1.8], [-half, 1.2, 1.9], { mat: 'wall' });
  w.box([half, 0, -1.8], [half + 0.5, 1.2, 1.9], { mat: 'wall' });
  w.zone([-half, 0, -1.5], [half, 2, 1.5], 'lane', { opacity: 0.06 });
}

/** Distant columns and crates so you can judge depth and movement. */
export function props(w, zFar = -40) {
  const spots = [[-22, 0.4], [22, 0.4], [-30, 0.7], [30, 0.7], [-16, 0.95], [16, 0.95]];
  for (const [x, f] of spots) w.pillar(x, zFar * f, 0.8, 6, f > 0.6 ? 'pillarB' : 'pillarA');
}

/** Ring of pillars around the origin for 360° orientation. */
export function pillarRing(w, radius = 22, count = 18) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;
    w.pillar(x, z, 0.6, i % 3 === 0 ? 9 : 6, i % 2 ? 'pillarA' : 'pillarB');
  }
}
