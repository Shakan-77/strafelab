import * as THREE from 'three';
import { RNG } from '../rng.js';

/**
 * Original rifle skins. Every texture is generated procedurally and every kill sound is
 * synthesized (see AudioFX.skinKill), so no game assets are used or shipped.
 */
export const SKINS = [
  {
    id: 'standard',
    name: 'Standard',
    desc: 'Factory finish: gunmetal with a teal stripe.',
    colors: { body: '#232a39', dark: '#151a24', accent: '#1b202c', glow: '#2de2c2' },
    tracer: '#fff2c4',
    anim: () => 1,
  },
  {
    id: 'pulse',
    name: 'Pulse Core',
    desc: 'Carbon weave with circuit traces that pulse brighter on every shot.',
    colors: { body: '#171a22', dark: '#0d0f14', accent: '#ff3ea5', glow: '#22e6ff' },
    pattern: 'circuit',
    bodyGlow: 0.9,
    tracer: '#5ff3ff',
    anim: (t, shot) => 0.75 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4.2)) + 1.3 * shot,
  },
  {
    id: 'verdant',
    name: 'Verdant Bloom',
    desc: 'Weathered stone grown over with emerald vines and brass fittings.',
    colors: { body: '#4a5a46', dark: '#2a3328', accent: '#c9a24a', glow: '#3dff8a' },
    pattern: 'vines',
    bodyGlow: 0.8,
    shiny: 60,
    tracer: '#8dffb0',
    anim: (t, shot) => 0.65 + 0.3 * Math.sin(t * 1.6) + 0.7 * shot,
  },
  {
    id: 'gilt',
    name: 'Bastion Gilt',
    desc: 'Polished ivory plating, gold trim and a sapphire core.',
    colors: { body: '#ece6d6', dark: '#3a3326', accent: '#d6a93a', glow: '#ffcf5a', gem: '#2f6bff' },
    pattern: 'plates',
    gem: true,
    shiny: 120,
    tracer: '#ffe39a',
    anim: (t, shot) => 0.85 + 0.15 * Math.sin(t * 2.1) + 0.9 * shot,
  },
  {
    id: 'wraith',
    name: 'Wraithbound',
    desc: 'Blackened steel wrapped in a restless violet haze.',
    colors: { body: '#120e18', dark: '#08060c', accent: '#6b6f7a', glow: '#a35bff' },
    pattern: 'smoke',
    bodyGlow: 1,
    tracer: '#c99bff',
    // irregular flicker, like a flame that won't settle
    anim: (t, shot) => 0.55 + 0.35 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1.7)) + 0.15 * Math.sin(t * 19) + 1.0 * shot,
  },
];

export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));
export const skinOf = (id) => SKIN_BY_ID[id] || SKINS[0];

// ---------------------------------------------------------------- procedural textures
const texCache = new Map();

function canvasTex(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.userData.canvas = c;
  return t;
}

/** Diffuse (map) and glow (emissiveMap) textures for a skin's body. */
function bodyTextures(skin) {
  if (texCache.has(skin.id)) return texCache.get(skin.id);
  const rng = new RNG(skin.id.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7));
  const col = skin.colors;
  let map = null;
  let glow = null;
  if (skin.pattern === 'circuit') {
    map = canvasTex((g, s) => {
      g.fillStyle = col.body;
      g.fillRect(0, 0, s, s);
      // carbon weave
      for (let y = 0; y < s; y += 8) for (let x = 0; x < s; x += 8) {
        g.fillStyle = (x + y) % 16 ? '#1d2230' : '#12151c';
        g.fillRect(x, y, 8, 8);
      }
    });
    glow = canvasTex((g, s) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      for (let i = 0; i < 9; i++) {
        let x = rng.float(0, s);
        let y = rng.float(0, s);
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          if (rng.chance(0.5)) x += rng.float(-90, 90); else y += rng.float(-90, 90);
          g.lineTo(x, y);
        }
        g.stroke();
        g.fillStyle = '#fff';
        g.fillRect(x - 5, y - 5, 10, 10);
      }
    });
  } else if (skin.pattern === 'vines') {
    map = canvasTex((g, s) => {
      g.fillStyle = col.body;
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = rng.pick(['#3c4a3a', '#556b4f', '#2e3a2c', '#5f6f57', '#46523f']);
        g.globalAlpha = rng.float(0.3, 0.8);
        g.beginPath();
        g.arc(rng.float(0, s), rng.float(0, s), rng.float(4, 22), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    });
    glow = canvasTex((g, s) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#fff';
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        g.lineWidth = rng.float(2, 5);
        g.beginPath();
        let x = rng.float(0, s);
        let y = 0;
        g.moveTo(x, y);
        while (y < s) {
          const nx = x + rng.float(-50, 50);
          const ny = y + rng.float(30, 70);
          g.quadraticCurveTo(x + rng.float(-60, 60), (y + ny) / 2, nx, ny);
          // little leaves
          if (rng.chance(0.6)) {
            g.moveTo(nx, ny);
            g.lineTo(nx + rng.sign() * rng.float(8, 18), ny - rng.float(4, 12));
            g.moveTo(nx, ny);
          }
          x = nx;
          y = ny;
        }
        g.stroke();
      }
    });
  } else if (skin.pattern === 'plates') {
    map = canvasTex((g, s) => {
      g.fillStyle = col.body;
      g.fillRect(0, 0, s, s);
      const grad = g.createLinearGradient(0, 0, s, s);
      grad.addColorStop(0, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(120,100,70,0.15)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#b89440';
      g.lineWidth = 4;
      g.strokeRect(10, 10, s - 20, s - 20);
      g.strokeStyle = 'rgba(60,50,30,0.45)';
      g.lineWidth = 2;
      for (const p of [s * 0.35, s * 0.7]) {
        g.beginPath(); g.moveTo(p, 10); g.lineTo(p, s - 10); g.stroke();
      }
      g.beginPath(); g.moveTo(10, s / 2); g.lineTo(s - 10, s / 2); g.stroke();
    });
  } else if (skin.pattern === 'smoke') {
    map = canvasTex((g, s) => {
      g.fillStyle = col.body;
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 140; i++) {
        const r = rng.float(10, 40);
        const x = rng.float(0, s);
        const y = rng.float(0, s);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(70,40,100,0.35)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
    glow = canvasTex((g, s) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        const r = rng.float(12, 46);
        const x = rng.float(0, s);
        const y = rng.float(0, s);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.8)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
  }
  const out = { map, glow };
  texCache.set(skin.id, out);
  return out;
}

/** Fresh materials for one model instance (textures are shared). */
function materialsFor(skin, overlay) {
  const col = skin.colors;
  const { map, glow } = bodyTextures(skin);
  const base = { depthTest: !overlay, shininess: skin.shiny ?? 30, specular: new THREE.Color(skin.shiny ? '#ffffff' : '#333333') };
  const M = {
    body: new THREE.MeshPhongMaterial({ ...base, color: map ? '#ffffff' : col.body, map }),
    dark: new THREE.MeshPhongMaterial({ ...base, color: col.dark }),
    accent: new THREE.MeshPhongMaterial({ ...base, color: col.accent, shininess: skin.shiny ? 140 : 40, specular: new THREE.Color(skin.shiny ? '#ffffff' : '#555555') }),
    glow: new THREE.MeshPhongMaterial({ ...base, color: col.glow, emissive: col.glow, emissiveIntensity: 1 }),
  };
  if (glow) {
    M.body.emissive = new THREE.Color(col.glow);
    M.body.emissiveMap = glow;
    M.body.emissiveIntensity = skin.bodyGlow ?? 0;
  }
  if (skin.id === 'pulse') M.accent.emissive = new THREE.Color(col.accent).multiplyScalar(0.35);
  if (skin.gem) M.gem = new THREE.MeshPhongMaterial({ ...base, color: col.gem, emissive: col.gem, emissiveIntensity: 1.2, shininess: 200 });
  return M;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);

/**
 * Rifle model with a skin. overlay=true draws on top of the world (first-person viewmodel).
 * Returns { group, skin, update(dt), onShot(), dispose() }.
 */
export function buildRifle(skinId, { overlay = false } = {}) {
  const skin = skinOf(skinId);
  const M = materialsFor(skin, overlay);
  const g = new THREE.Group();
  let order = 0;
  const part = (size, pos, mat, rot) => {
    const m = new THREE.Mesh(BOX, mat);
    m.scale.set(...size);
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (overlay) m.renderOrder = 900 + order++;
    g.add(m);
    return m;
  };
  part([0.055, 0.08, 0.2], [0, -0.012, 0.06], M.body); // stock
  part([0.07, 0.095, 0.36], [0, 0, -0.2], M.body); // receiver
  part([0.04, 0.095, 0.05], [0, -0.085, -0.07], M.dark, [0.35, 0, 0]); // grip
  part([0.046, 0.14, 0.075], [0, -0.108, -0.27], M.accent, [-0.12, 0, 0]); // magazine
  part([0.062, 0.075, 0.24], [0, 0.004, -0.49], M.body); // handguard
  part([0.026, 0.026, 0.26], [0, 0.016, -0.72], M.dark); // barrel
  part([0.034, 0.034, 0.05], [0, 0.016, -0.86], M.accent); // muzzle
  part([0.032, 0.03, 0.09], [0, 0.064, -0.2], M.accent); // sight block
  part([0.074, 0.014, 0.3], [0, 0.026, -0.2], M.glow); // receiver light strip
  part([0.065, 0.012, 0.2], [0, -0.02, -0.49], M.glow); // handguard light strip
  if (skin.gem) part([0.02, 0.03, 0.03], [0.037, -0.005, -0.12], M.gem); // core gem
  const fx = { t: 0, shot: 0 };
  return {
    group: g,
    skin,
    update(dt) {
      fx.t += dt;
      fx.shot = Math.max(0, fx.shot - dt * 5);
      const i = skin.anim(fx.t, fx.shot);
      M.glow.emissiveIntensity = i;
      if (M.body.emissiveMap) M.body.emissiveIntensity = i * (skin.bodyGlow ?? 0);
    },
    onShot() {
      fx.shot = 1;
    },
    dispose() {
      for (const m of Object.values(M)) m.dispose();
    },
  };
}

/** Small 2D swatch of a skin for menus. */
export function skinSwatch(skinId, w = 120, h = 54) {
  const skin = skinOf(skinId);
  const { map, glow } = bodyTextures(skin);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (map) g.drawImage(map.userData.canvas, 0, 0, w, h);
  else {
    g.fillStyle = skin.colors.body;
    g.fillRect(0, 0, w, h);
  }
  if (glow) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.55;
    g.drawImage(glow.userData.canvas, 0, 0, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = skin.colors.glow;
    g.globalAlpha = 0.18;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }
  g.fillStyle = skin.colors.glow;
  g.fillRect(0, h * 0.42, w, 4);
  g.fillStyle = skin.colors.accent;
  g.fillRect(w - 26, h - 16, 18, 10);
  if (skin.gem) {
    g.fillStyle = skin.colors.gem;
    g.fillRect(12, h - 18, 10, 10);
  }
  return c;
}
