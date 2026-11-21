import * as THREE from 'three';

/** World-aligned 2 m grid texture so you can read your own speed off the floor. */
function gridTexture(base, line, faint) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = faint;
  g.lineWidth = 1;
  for (const p of [64, 192]) {
    g.beginPath(); g.moveTo(p + 0.5, 0); g.lineTo(p + 0.5, 256); g.stroke();
    g.beginPath(); g.moveTo(0, p + 0.5); g.lineTo(256, p + 0.5); g.stroke();
  }
  g.strokeStyle = line;
  g.lineWidth = 3;
  for (const p of [1.5, 129.5]) {
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let MATS = null;
export function materials() {
  if (MATS) return MATS;
  MATS = {
    floor: new THREE.MeshLambertMaterial({ map: gridTexture('#161d2b', '#27344d', '#1d2638') }),
    wall: new THREE.MeshLambertMaterial({ map: gridTexture('#232c3e', '#303d57', '#283247') }),
    cover: new THREE.MeshLambertMaterial({ map: gridTexture('#2c2f48', '#3d4266', '#33375280') }),
    platform: new THREE.MeshLambertMaterial({ map: gridTexture('#1c2a3d', '#2b8f83', '#22344a') }),
    accent: new THREE.MeshLambertMaterial({ color: '#2de2c2', emissive: '#0d5f53' }),
    warm: new THREE.MeshLambertMaterial({ color: '#ffb347', emissive: '#5c3a0a' }),
    dark: new THREE.MeshLambertMaterial({ color: '#0e131d' }),
    pillarA: new THREE.MeshLambertMaterial({ color: '#2a3550', emissive: '#0c1222' }),
    pillarB: new THREE.MeshLambertMaterial({ color: '#3b2f55', emissive: '#120c22' }),
  };
  return MATS;
}

const ZONE_COLORS = {
  silent: '#a46bff',
  checkpoint: '#2de2c2',
  finish: '#ffd84d',
  crouch: '#5ad1ff',
  lane: '#2de2c2',
  danger: '#ff5a6a',
};

/** Rewrite BoxGeometry UVs so textures tile in world space (1 texture = 2 m). */
function worldUV(geo, cx, cy, cz) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const y = pos.getY(i) + cy;
    const z = pos.getZ(i) + cz;
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    let u;
    let v;
    if (nx > 0.5) { u = z; v = y; } else if (ny > 0.5) { u = x; v = z; } else { u = x; v = y; }
    uv.setXY(i, u / 2, v / 2);
  }
  uv.needsUpdate = true;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = [];
    this.blockers = [];
    this.zones = [];
    this.onChange = null;
    this.minY = 0;
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry?.dispose();
      if (child.userData.ownMaterial) child.material.dispose();
    }
    this.colliders = [];
    this.blockers = [];
    this.zones = [];
    this.minY = 0;
    this.onChange?.();
  }

  /**
   * Solid axis-aligned box from min to max corner.
   * opts: mat (name) | material (THREE.Material), collide (default true), block bullets/vision (default true)
   */
  box(min, max, opts = {}) {
    const sx = max[0] - min[0];
    const sy = max[1] - min[1];
    const sz = max[2] - min[2];
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    worldUV(geo, cx, cy, cz);
    const material = opts.material || materials()[opts.mat || 'wall'];
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(cx, cy, cz);
    mesh.userData.ownMaterial = !!opts.ownMaterial;
    this.group.add(mesh);
    const handle = { mesh, collider: null, removed: false };
    if (opts.collide !== false) {
      handle.collider = {
        min: new THREE.Vector3(...min),
        max: new THREE.Vector3(...max),
        enabled: true,
      };
      this.colliders.push(handle.collider);
    }
    if (opts.block !== false) {
      mesh.userData.world = true;
      this.blockers.push(mesh);
    }
    this.minY = Math.min(this.minY, min[1]);
    this.onChange?.();
    return handle;
  }

  remove(handle) {
    if (!handle || handle.removed) return;
    handle.removed = true;
    this.group.remove(handle.mesh);
    handle.mesh.geometry.dispose();
    if (handle.collider) {
      handle.collider.enabled = false;
      this.colliders = this.colliders.filter((c) => c !== handle.collider);
    }
    this.blockers = this.blockers.filter((m) => m !== handle.mesh);
    this.onChange?.();
  }

  /** Floor decal + trigger volume. Zones never collide or block bullets. */
  zone(min, max, type, data = {}) {
    const color = ZONE_COLORS[type] || '#ffffff';
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: data.opacity ?? 0.22, depthWrite: false });
    let mesh = null;
    if (data.visible !== false) {
      const h = data.wall ? max[1] - min[1] : 0.02;
      const geo = new THREE.BoxGeometry(max[0] - min[0], h, max[2] - min[2]);
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((min[0] + max[0]) / 2, min[1] + h / 2 + 0.005, (min[2] + max[2]) / 2);
      mesh.userData.ownMaterial = true;
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
    const z = { min: new THREE.Vector3(...min), max: new THREE.Vector3(...max), type, data, mesh, active: true };
    this.zones.push(z);
    return z;
  }

  zonesAt(p) {
    const out = [];
    for (const z of this.zones) {
      if (!z.active) continue;
      if (p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y - 0.05 && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z) out.push(z);
    }
    return out;
  }

  /** Simple decorative column (blocks bullets, collides). */
  pillar(x, z, r, h, mat = 'pillarA') {
    return this.box([x - r, 0, z - r], [x + r, h, z + r], { mat });
  }
}
