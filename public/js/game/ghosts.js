import * as THREE from 'three';

/** Translucent party-member ghosts for movement scenarios (no collision, can't be shot). */
export class Ghosts {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
    this.geo = new THREE.CapsuleGeometry(0.3, 1.1, 4, 10);
  }

  label(name, color) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.font = '600 30px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.strokeText(name, 128, 32);
    g.fillStyle = color;
    g.fillText(name, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(1.6, 0.4, 1);
    sprite.position.y = 2.2;
    sprite.renderOrder = 10;
    return sprite;
  }

  update(id, p, name, color) {
    let g = this.map.get(id);
    if (!g) {
      const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, emissive: new THREE.Color(color).multiplyScalar(0.3) });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.position.y = 0.85;
      const group = new THREE.Group();
      group.add(mesh, this.label(name, color));
      this.scene.add(group);
      g = { group, mesh, mat, target: new THREE.Vector3(), seen: 0, first: true };
      this.map.set(id, g);
    }
    g.target.set(p[0], p[1], p[2]);
    g.crouch = p[4] ? 1 : 0;
    g.seen = performance.now();
    if (g.first) {
      g.group.position.copy(g.target);
      g.first = false;
    }
  }

  frame(dt) {
    const now = performance.now();
    for (const [id, g] of this.map) {
      if (now - g.seen > 3000) {
        this.remove(id);
        continue;
      }
      g.group.position.lerp(g.target, Math.min(1, dt * 18));
      g.mesh.scale.y = g.crouch ? 0.72 : 1;
      g.mesh.position.y = g.crouch ? 0.65 : 0.85;
    }
  }

  remove(id) {
    const g = this.map.get(id);
    if (!g) return;
    this.scene.remove(g.group);
    g.mat.dispose();
    g.group.children[1].material.map.dispose();
    g.group.children[1].material.dispose();
    this.map.delete(id);
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }
}
