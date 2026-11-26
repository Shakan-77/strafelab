import { uid } from './util.js';

const KEY = 'strafelab.settings.v1';
const CID_KEY = 'strafelab.cid';

/** Valorant yaw: 0.07 degrees per mouse count at sensitivity 1. */
export const VALORANT_YAW = 0.07;

export const XH_COLORS = ['#ffffff', '#00ff00', '#7fff00', '#dfff00', '#ffff00', '#00ffff', '#ff00ff', '#ff0000'];
export const XH_COLOR_NAMES = ['White', 'Green', 'Yellow Green', 'Green Yellow', 'Yellow', 'Cyan', 'Pink', 'Red', 'Custom'];

/** Valorant's in-game defaults, as best known: used when a code omits a field. */
export const XH_VALORANT_DEFAULT = {
  color: 0,
  custom: '#ffffff',
  outlines: 1,
  outlineThickness: 1,
  outlineOpacity: 0.5,
  dot: 0,
  dotThickness: 2,
  dotOpacity: 1,
  inner: { show: 1, thickness: 2, length: 6, vlength: 6, separate: 0, offset: 3, opacity: 0.8 },
  outer: { show: 1, thickness: 2, length: 2, vlength: 2, separate: 0, offset: 10, opacity: 0.35 },
};

export const DEFAULT_XH_CODE = '0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0';

// ---------------------------------------------------------------- controls
/**
 * Rebindable actions. type 'hold' = active while held, 'press' = fires once per press.
 * wheel: the mouse wheel may be bound to it. modes: supports hold/toggle.
 */
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', type: 'hold' },
  { id: 'back', label: 'Move backward', type: 'hold' },
  { id: 'left', label: 'Strafe left', type: 'hold' },
  { id: 'right', label: 'Strafe right', type: 'hold' },
  { id: 'walk', label: 'Walk', type: 'hold', modes: [['hold', 'Hold'], ['toggle', 'Toggle']] },
  { id: 'crouch', label: 'Crouch', type: 'hold', modes: [['hold', 'Hold'], ['toggle', 'Toggle']] },
  { id: 'jump', label: 'Jump', type: 'press', wheel: true },
  { id: 'fire', label: 'Fire', type: 'hold', wheel: true },
  { id: 'scope', label: 'Scope / zoom', type: 'press', wheel: true, modes: [['toggle', 'Toggle (cycles zoom)'], ['hold', 'Hold']] },
  { id: 'reload', label: 'Reload', type: 'press', wheel: true },
  { id: 'primary', label: 'Primary weapon', type: 'press', wheel: true },
  { id: 'melee', label: 'Knife (run faster)', type: 'press', wheel: true },
  { id: 'board', label: 'Party scoreboard', type: 'hold' },
];

export const DEFAULT_BINDS = {
  forward: ['KeyW', null],
  back: ['KeyS', null],
  left: ['KeyA', null],
  right: ['KeyD', null],
  walk: ['ShiftLeft', null],
  crouch: ['ControlLeft', 'KeyC'],
  jump: ['Space', null],
  fire: ['Mouse0', null],
  scope: ['Mouse2', null],
  reload: ['KeyR', null],
  primary: ['Digit1', null],
  melee: ['Digit3', null],
  board: ['Tab', null],
};

export const DEFAULT_MODES = { walk: 'hold', crouch: 'hold', scope: 'toggle' };

/** Keys that can never be bound: Esc pauses; Backspace/Delete clear a slot in the editor. */
export const RESERVED_KEYS = new Set(['Escape', 'Backspace', 'Delete']);

const KEY_NAMES = {
  Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', MetaLeft: 'L-Win', MetaRight: 'R-Win', Tab: 'Tab', CapsLock: 'Caps Lock',
  Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  Mouse0: 'Left Mouse', Mouse1: 'Middle Mouse', Mouse2: 'Right Mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  WheelUp: 'Wheel Up', WheelDown: 'Wheel Down',
};

export function keyLabel(code) {
  if (!code) return '-';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Mouse')) return `Mouse ${Number(code.slice(5)) + 1}`;
  return code;
}

/** Fill in missing actions with defaults and sanitise saved binds. */
export function normalizeBinds(saved) {
  const out = {};
  for (const a of ACTIONS) {
    const src = saved && Array.isArray(saved[a.id]) ? saved[a.id] : DEFAULT_BINDS[a.id];
    out[a.id] = [0, 1].map((i) => (typeof src[i] === 'string' && src[i] && !RESERVED_KEYS.has(src[i]) ? src[i] : null));
  }
  return out;
}

export const DEFAULTS = {
  name: '',
  sens: 0.4,
  dpi: 800,
  adsMult: 1.0,
  scopedMult: 1.0,
  rawInput: true,
  crosshairCode: DEFAULT_XH_CODE,
  enemyColor: 'red',
  binds: DEFAULT_BINDS,
  modes: DEFAULT_MODES,
  fullscreenPlay: true,
  rifleSkin: 'standard',
  weaponChoice: {}, // drill id → weapon picked before starting
  showSpeed: true,
  showFeedback: true,
  showFps: true,
  showViewmodel: true,
  volume: 0.6,
  hitSounds: true,
  footsteps: true,
  renderScale: 1,
};

export function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    s = {};
  }
  const out = { ...DEFAULTS, ...s };
  if (s.adsMult == null) out.adsMult = out.scopedMult; // ADS previously shared the scoped multiplier
  for (const key of ['sens', 'dpi', 'adsMult', 'scopedMult']) {
    const value = Number(out[key]);
    out[key] = Number.isFinite(value) && value > 0 ? value : DEFAULTS[key];
  }
  out.binds = normalizeBinds(s.binds);
  out.modes = { ...DEFAULT_MODES, ...(s.modes || {}) };
  // migrate the old "jump on mouse wheel" checkbox into a real bind
  if (s.scrollJump && !s.binds && !out.binds.jump[1]) out.binds.jump[1] = 'WheelDown';
  delete out.scrollJump;
  if (!out.name) out.name = `Player${Math.floor(1000 + Math.random() * 9000)}`;
  return out;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

export function clientId() {
  try {
    let id = localStorage.getItem(CID_KEY);
    if (!id) {
      id = uid();
      localStorage.setItem(CID_KEY, id);
    }
    return id;
  } catch {
    return uid();
  }
}

export const edpi = (s) => Math.round(s.sens * s.dpi);
export const cmPer360 = (s) => (360 / (VALORANT_YAW * s.sens) / s.dpi) * 2.54;

// ---------------------------------------------------------------- crosshair codes
const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, d) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * Parse the primary crosshair from a Valorant profile code ("0;P;c;5;h;0;...").
 * Best-effort: covers colour, outlines, centre dot, inner and outer lines.
 */
export function parseCrosshairCode(code) {
  const xh = clone(XH_VALORANT_DEFAULT);
  const parts = String(code || '').trim().split(';').map((p) => p.trim());
  if (!parts[0]) throw new Error('Empty code');
  let i = parts.indexOf('P');
  if (i < 0) {
    if (parts.length <= 1 && parts[0] === '0') return xh;
    throw new Error("No primary crosshair section ('P') in code");
  }
  const sections = new Set(['P', 'A', 'S']);
  for (i += 1; i + 1 < parts.length; i += 2) {
    const k = parts[i];
    const v = parts[i + 1];
    if (sections.has(k)) break;
    const line = k[0] === '0' ? xh.inner : k[0] === '1' ? xh.outer : null;
    const sub = line ? k.slice(1) : k;
    if (line) {
      if (sub === 'b') line.show = num(v, 1) ? 1 : 0;
      else if (sub === 't') line.thickness = num(v, line.thickness);
      else if (sub === 'l') line.length = num(v, line.length);
      else if (sub === 'v') line.vlength = num(v, line.vlength);
      else if (sub === 'g') line.separate = num(v, 0) ? 1 : 0;
      else if (sub === 'o') line.offset = num(v, line.offset);
      else if (sub === 'a') line.opacity = num(v, line.opacity);
      continue;
    }
    switch (k) {
      case 'c': xh.color = Math.max(0, Math.min(8, Math.round(num(v, 0)))); break;
      case 'u': if (/^[0-9a-f]{6}/i.test(v)) xh.custom = `#${v.slice(0, 6)}`; break;
      case 'h': xh.outlines = num(v, 1) ? 1 : 0; break;
      case 't': xh.outlineThickness = num(v, 1); break;
      case 'o': xh.outlineOpacity = num(v, 0.5); break;
      case 'd': xh.dot = num(v, 0) ? 1 : 0; break;
      case 'z': xh.dotThickness = num(v, 2); break;
      case 'a': xh.dotOpacity = num(v, 1); break;
      default: break; // fade/firing-error/etc. are not simulated
    }
  }
  return xh;
}

/** Build a Valorant-style code from a crosshair object (only non-default fields). */
export function crosshairToCode(xh) {
  const d = XH_VALORANT_DEFAULT;
  const out = ['0', 'P'];
  const add = (k, v, dv) => {
    if (v !== dv) out.push(k, String(+(+v).toFixed(3)));
  };
  add('c', xh.color, d.color);
  if (xh.color === 8) out.push('u', `${xh.custom.replace('#', '').toUpperCase()}FF`);
  add('h', xh.outlines, d.outlines);
  add('t', xh.outlineThickness, d.outlineThickness);
  add('o', xh.outlineOpacity, d.outlineOpacity);
  add('d', xh.dot, d.dot);
  add('z', xh.dotThickness, d.dotThickness);
  add('a', xh.dotOpacity, d.dotOpacity);
  for (const [p, key] of [['0', 'inner'], ['1', 'outer']]) {
    const L = xh[key];
    const D = d[key];
    add(`${p}b`, L.show, D.show);
    add(`${p}t`, L.thickness, D.thickness);
    add(`${p}l`, L.length, D.length);
    add(`${p}g`, L.separate, D.separate);
    if (L.separate) add(`${p}v`, L.vlength, D.vlength);
    add(`${p}o`, L.offset, D.offset);
    add(`${p}a`, L.opacity, D.opacity);
  }
  return out.length === 2 ? '0' : out.join(';');
}

export function crosshairFromSettings(s) {
  try {
    return parseCrosshairCode(s.crosshairCode);
  } catch {
    return parseCrosshairCode(DEFAULT_XH_CODE);
  }
}

/** Draw a crosshair into a canvas. `scale` = device pixels per Valorant (1080p) pixel. */
export function drawCrosshair(canvas, xh, scale) {
  const sizeCss = 220;
  const dpr = window.devicePixelRatio || 1;
  const size = Math.round(sizeCss * dpr) | 1; // odd size → exact centre pixel
  if (canvas.width !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  canvas.style.width = `${size / dpr}px`;
  canvas.style.height = `${size / dpr}px`;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, size, size);
  const c = (size - 1) / 2; // centre pixel index
  const color = xh.color === 8 ? xh.custom : XH_COLORS[xh.color] || '#ffffff';
  const rects = [];
  const px = (v) => Math.max(0, Math.round(v * scale));

  const lines = (L) => {
    if (!L.show || L.opacity <= 0) return;
    const t = Math.max(1, px(L.thickness));
    const len = px(L.length);
    const vlen = px(L.separate ? L.vlength : L.length);
    const off = px(L.offset);
    const half = Math.floor(t / 2);
    const y0 = c - half;
    if (len > 0) {
      rects.push([c + 1 + off, y0, len, t, L.opacity]);
      rects.push([c - off - len, y0, len, t, L.opacity]);
    }
    if (vlen > 0) {
      rects.push([y0, c - off - vlen, t, vlen, L.opacity]);
      rects.push([y0, c + 1 + off, t, vlen, L.opacity]);
    }
  };
  lines(xh.inner);
  lines(xh.outer);
  if (xh.dot && xh.dotOpacity > 0) {
    const d = Math.max(1, px(xh.dotThickness));
    const h = Math.floor(d / 2);
    rects.push([c - h, c - h, d, d, xh.dotOpacity]);
  }
  if (xh.outlines && xh.outlineOpacity > 0) {
    const o = Math.max(1, px(xh.outlineThickness));
    g.fillStyle = '#000';
    for (const [x, y, w, h, a] of rects) {
      g.globalAlpha = xh.outlineOpacity * Math.min(1, a + 0.2);
      g.fillRect(x - o, y - o, w + o * 2, h + o * 2);
    }
  }
  g.fillStyle = color;
  for (const [x, y, w, h, a] of rects) {
    g.globalAlpha = a;
    g.fillRect(x, y, w, h);
  }
  g.globalAlpha = 1;
}
