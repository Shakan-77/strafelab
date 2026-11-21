import * as THREE from 'three';
import { World } from './world.js';
import { Player, MOVE } from './player.js';
import { WEAPONS, computeSpread, accurateSpeed } from './weapons.js';
import { ENEMY_COLORS } from './targets.js';
import { Hud } from './hud.js';
import { Ghosts } from './ghosts.js';
import { buildRifle, skinOf } from './skins.js';
import { RNG } from '../rng.js';
import { SCENARIOS } from '../scenarios/index.js';
import { clamp, DEG, el } from '../util.js';
import { crosshairFromSettings, drawCrosshair, keyLabel, VALORANT_YAW } from '../settings.js';

const TICK = 1 / 128; // Valorant servers run at 128 tick
// Valorant: 103° horizontal FOV at 16:9, Hor+ on other aspect ratios → fixed vertical FOV
const vfovFromHfov = (h) => (2 * Math.atan(Math.tan((h * DEG) / 2) / (16 / 9))) / DEG;
const VFOV = vfovFromHfov(103);
// Keys the game never swallows: fullscreen toggle and devtools.
const PASS_KEYS = new Set(['F11', 'F12']);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export class Game {
  constructor({ canvas, settings, audio, net, debug, onFinish, onQuit }) {
    this.canvas = canvas;
    this.settings = settings;
    this.audio = audio;
    this.net = net;
    this.debug = !!debug;
    this.onFinish = onFinish;
    this.onQuit = onQuit;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c111c');
    this.scene.fog = new THREE.Fog('#0c111c', 70, 190);
    this.camera = new THREE.PerspectiveCamera(VFOV, 16 / 9, 0.03, 600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    // First-person weapon is drawn in its own pass after the world (depth cleared), so it
    // never clips into walls but its parts still hide each other correctly.
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(VFOV, 16 / 9, 0.01, 10);
    this.vmScene.add(this.vmCamera);
    this.vmScene.add(new THREE.HemisphereLight('#c9d6ff', '#1b2030', 1.6));
    const vmSun = new THREE.DirectionalLight('#ffffff', 1.8);
    vmSun.position.set(0.6, 1, 0.4);
    this.vmScene.add(vmSun);
    this.renderer.autoClear = false;
    this.scene.add(new THREE.HemisphereLight('#c9d6ff', '#1b2030', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(25, 50, 15);
    this.scene.add(sun);

    this.world = new World(this.scene);
    this.world.onChange = () => this.rebuildRayList();
    this.player = new Player();
    this.player.onEvent = (t, d) => this.playerEvent(t, d);
    this.entities = new Set();
    this.targetMeshes = [];
    this.rayList = [];
    this.raycaster = new THREE.Raycaster();
    this.visRay = new THREE.Raycaster();
    this.effects = [];
    this.decals = [];
    this.hud = new Hud();
    this.ghosts = new Ghosts(this.scene);
    this.viewmodel = null;

    this.state = 'idle';
    this.yaw = 0;
    this.pitch = 0;
    this.recoil = 0;
    this.zoomIndex = 0;
    this.zoom = 1;
    this.held = new Set(); // codes currently down: 'KeyW', 'Mouse0', ...
    this.toggles = { walk: false, crouch: false };
    this.bindMap = new Map();
    this.modes = {};
    this.firing = false;
    this.locked = false;
    this.frameDt = 1 / 60;
    this.fpsAcc = { t: 0, n: 0 };
    this.netT = { live: 0, pos: 0 };
    this.party = null;

    this.loop = this.loop.bind(this);
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.applySettings(settings);
  }

  // ------------------------------------------------------------------ setup
  applySettings(s) {
    this.settings = s;
    this.audio.configure(s);
    this.xh = crosshairFromSettings(s);
    this.buildBindMap();
    this.drawCrosshair();
    this.resize();
    if (this.viewmodel) this.viewmodel.visible = s.showViewmodel && !this.scopeLens();
    // changing skin mid-session swaps the rifle model straight away
    if (this.viewmodel && this.weapon?.id === 'rifle' && this.skinId !== skinOf(s.rifleSkin).id) this.buildViewmodel();
  }

  drawCrosshair() {
    const scale = (window.innerHeight / 1080) * (window.devicePixelRatio || 1);
    drawCrosshair(document.getElementById('crosshair'), this.xh, scale);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = this.settings?.renderScale ?? 1;
    this.renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * scale));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    this.camera.updateProjectionMatrix();
    if (this.xh) this.drawCrosshair();
  }

  enemyColor() {
    return ENEMY_COLORS[this.settings.enemyColor] || ENEMY_COLORS.red;
  }

  scenarioTime() {
    return this.scenario ? this.scenario.elapsed : 0;
  }

  // ------------------------------------------------------------------ input
  /** True while a run is on screen (including the pause menu), so browser shortcuts are blocked. */
  inGame() {
    return this.state === 'ready' || this.state === 'countdown' || this.state === 'running';
  }

  buildBindMap() {
    this.bindMap = new Map();
    for (const [action, codes] of Object.entries(this.settings.binds || {})) {
      for (const code of codes) {
        if (!code) continue;
        if (!this.bindMap.has(code)) this.bindMap.set(code, []);
        this.bindMap.get(code).push(action);
      }
    }
    this.modes = this.settings.modes || {};
  }

  /** Label of the first key bound to an action (for on-screen hints). */
  keyName(action) {
    const b = this.settings.binds?.[action] || [];
    const code = b[0] || b[1];
    return code ? keyLabel(code) : 'unbound';
  }

  isHeld(action) {
    const b = this.settings.binds?.[action];
    return !!b && b.some((c) => c && this.held.has(c));
  }

  bindInput() {
    // Capture phase on window so the game sees keys before anything else on the page.
    window.addEventListener('keydown', (e) => {
      if (!this.inGame()) return;
      if (e.code === 'Escape') {
        // Esc always pauses. With keyboard lock the browser hands Esc to us instead of unlocking.
        if (this.locked && !this.debug) document.exitPointerLock();
        else if (this.debug && this.locked) {
          this.locked = false;
          this.pause();
        }
        return;
      }
      // Stop browser shortcuts (Ctrl+H, Ctrl+F, Ctrl+D, F5, the Alt menu...) from firing mid-game.
      if (!PASS_KEYS.has(e.code)) e.preventDefault();
      if (!this.locked && !this.debug) return;
      if (e.repeat || this.held.has(e.code)) return;
      this.held.add(e.code);
      this.inputDown(e.code, e.timeStamp);
    }, true);
    window.addEventListener('keyup', (e) => {
      if (this.inGame() && e.code !== 'Escape' && !PASS_KEYS.has(e.code)) e.preventDefault();
      if (this.held.delete(e.code)) this.inputUp(e.code);
    }, true);
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
    document.addEventListener('mousedown', (e) => {
      if (!this.inGame()) return;
      if (e.button !== 0 && e.button !== 2) e.preventDefault(); // no middle-click autoscroll
      if (!this.locked && !this.debug) return;
      if (!this.locked && e.target !== this.canvas) return;
      const code = `Mouse${e.button}`;
      if (this.held.has(code)) return;
      this.held.add(code);
      this.inputDown(code, e.timeStamp);
    }, true);
    document.addEventListener('mouseup', (e) => {
      // side buttons would otherwise navigate the browser back/forward
      if (this.inGame() && (e.button === 3 || e.button === 4)) e.preventDefault();
      const code = `Mouse${e.button}`;
      if (this.held.delete(code)) this.inputUp(code);
    }, true);
    document.addEventListener('mousemove', (e) => {
      if (this.state === 'idle' || this.state === 'finished') return;
      if (this.locked) this.look(e.movementX, e.movementY);
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.inGame()) return;
        e.preventDefault(); // no page scroll, no Ctrl+wheel zoom
        if ((!this.locked && !this.debug) || e.deltaY === 0) return;
        this.inputWheel(e.deltaY < 0 ? 'WheelUp' : 'WheelDown', e.timeStamp);
      },
      { passive: false, capture: true },
    );
    document.addEventListener('contextmenu', (e) => {
      if (this.inGame()) e.preventDefault();
    });
    document.getElementById('overlay-lock').addEventListener('click', () => this.requestLock());
  }

  inputDown(code, ts) {
    for (const a of this.bindMap.get(code) || []) {
      switch (a) {
        case 'jump':
          this.player.queueJump();
          break;
        case 'fire':
          this.firing = true;
          this.trigger(ts);
          break;
        case 'scope':
          if (this.modes.scope === 'hold') this.scopeHold(true);
          else this.cycleScope();
          break;
        case 'reload':
          this.startReload();
          break;
        case 'board':
          this.hud.showBoard(true);
          break;
        case 'walk':
        case 'crouch':
          if (this.modes[a] === 'toggle') this.toggles[a] = !this.toggles[a];
          break;
        default:
          break;
      }
    }
    this.syncInput();
  }

  inputUp(code) {
    for (const a of this.bindMap.get(code) || []) {
      if (a === 'fire' && !this.isHeld('fire')) this.firing = false;
      if (a === 'scope' && this.modes.scope === 'hold' && !this.isHeld('scope')) this.scopeHold(false);
      if (a === 'board' && !this.isHeld('board')) this.hud.showBoard(false);
    }
    this.syncInput();
  }

  /** The wheel has no "release", so each notch is a single press. */
  inputWheel(code, ts) {
    for (const a of this.bindMap.get(code) || []) {
      if (a === 'jump') this.player.queueJump();
      else if (a === 'fire') this.trigger(ts);
      else if (a === 'scope') this.cycleScope();
      else if (a === 'reload') this.startReload();
    }
  }

  releaseAll() {
    this.held.clear();
    this.firing = false;
    this.hud.showBoard(false);
    this.syncInput();
  }

  syncInput() {
    const i = this.player.input;
    i.f = this.isHeld('forward') ? 1 : 0;
    i.b = this.isHeld('back') ? 1 : 0;
    i.l = this.isHeld('left') ? 1 : 0;
    i.r = this.isHeld('right') ? 1 : 0;
    i.walk = this.modes.walk === 'toggle' ? this.toggles.walk : this.isHeld('walk');
    i.crouch = this.modes.crouch === 'toggle' ? this.toggles.crouch : this.isHeld('crouch');
  }

  /** Mouse counts → view angles using Valorant's yaw (0.07°/count × sens). */
  look(dx, dy) {
    let deg = VALORANT_YAW * this.settings.sens;
    if (this.zoom > 1) deg *= this.settings.scopedMult / this.zoom;
    this.yaw -= dx * deg * DEG;
    this.pitch = clamp(this.pitch - dy * deg * DEG, -89 * DEG, 89 * DEG);
  }

  /** Lock the mouse and, if enabled, go fullscreen with keyboard lock. Call from a click. */
  requestLock() {
    if (this.debug && !this.locked) {
      // debug/test mode: run without pointer lock
      this.onLocked();
      return;
    }
    this.lockPointer();
    if (this.settings.fullscreenPlay && !this.fsDeclined && !document.fullscreenElement && document.fullscreenEnabled) this.enterFullscreen();
  }

  lockPointer() {
    const c = this.canvas;
    try {
      const p = this.settings.rawInput ? c.requestPointerLock({ unadjustedMovement: true }) : c.requestPointerLock();
      if (p && p.catch) {
        p.catch(() => {
          try {
            const q = c.requestPointerLock();
            if (q && q.catch) q.catch(() => this.hud.banner('Click again to lock the mouse', 'warn'));
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      c.requestPointerLock();
    }
  }

  /**
   * Fullscreen + Keyboard Lock is the only way a page receives browser-reserved shortcuts
   * (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab...). A short Esc is handed to the page; hold Esc to leave fullscreen.
   */
  async enterFullscreen() {
    try {
      navigator.keyboard?.lock?.().catch(() => {});
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      this.ownFullscreen = true;
    } catch {
      /* not allowed here (embedded frame, or no user gesture) */
    }
  }

  exitFullscreen() {
    try {
      navigator.keyboard?.unlock?.();
    } catch {
      /* ignore */
    }
    if (this.ownFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.ownFullscreen = false;
  }

  /** Pause-menu Fullscreen button. */
  toggleFullscreen() {
    if (document.fullscreenElement) {
      this.fsDeclined = true;
      navigator.keyboard?.unlock?.();
      document.exitFullscreen().catch(() => {});
      this.ownFullscreen = false;
      return;
    }
    this.fsDeclined = false;
    this.enterFullscreen();
    this.lockPointer();
  }

  onFullscreenChange() {
    this.resize();
    if (!document.fullscreenElement) {
      // the player held Esc to leave fullscreen: respect that for the rest of this run
      if (this.inGame() && this.ownFullscreen) this.fsDeclined = true;
      this.ownFullscreen = false;
    }
  }

  onLockChange() {
    const locked = document.pointerLockElement === this.canvas;
    this.locked = locked;
    if (locked) this.onLocked();
    else if (this.state === 'running' || this.state === 'countdown') this.pause();
  }

  onLocked() {
    this.audio.ensure();
    document.getElementById('overlay-lock').hidden = true;
    document.getElementById('overlay-pause').hidden = true;
    this.paused = false;
    if (this.state === 'ready') this.state = 'countdown';
    if (this.debug) this.locked = true;
  }

  pause() {
    this.releaseAll();
    if (this.state === 'idle' || this.state === 'finished') return;
    this.paused = true;
    const p = document.getElementById('overlay-pause');
    p.hidden = false;
    p.querySelector('.pause-note').textContent = this.party
      ? 'Party run in progress, so the timer keeps running.'
      : 'Paused. The timer is stopped.';
    p.querySelector('[data-act="restart"]').hidden = !!this.party;
    this.renderKeyHints();
  }

  /** Pause-menu cheat sheet built from the player's own binds. */
  renderKeyHints() {
    const k = (a) => this.keyName(a);
    const rows = [
      [`${k('forward')} ${k('left')} ${k('back')} ${k('right')}`, 'move'],
      [k('walk'), this.modes.walk === 'toggle' ? 'walk (toggle)' : 'walk'],
      [k('crouch'), this.modes.crouch === 'toggle' ? 'crouch (toggle)' : 'crouch'],
      [k('jump'), 'jump'],
      [k('fire'), 'fire'],
      [k('scope'), this.modes.scope === 'hold' ? 'scope (hold)' : 'scope'],
      [k('reload'), 'reload'],
      [k('board'), 'party board'],
    ];
    document.querySelector('#overlay-pause .keys').replaceChildren(
      ...rows.map(([key, what]) => el('span', {}, el('kbd', {}, key), ` ${what}`)),
      el('span', { class: 'hint' }, 'Rebind in Settings > Controls'),
    );
  }

  resume() {
    this.requestLock();
  }

  // ------------------------------------------------------------------ lifecycle
  /**
   * Load a scenario. opts: { party: {runId}, countdown, seed }
   */
  load(meta, difficulty, seed, opts = {}) {
    this.unload();
    const Cls = SCENARIOS[meta.id];
    if (!Cls) throw new Error(`Unknown scenario ${meta.id}`);
    this.meta = meta;
    this.difficulty = difficulty;
    this.seed = seed;
    this.loadOpts = opts;
    this.party = opts.party || null;
    this.rng = new RNG(seed);
    this.weapon = WEAPONS[meta.weapon];
    this.ammo = this.weapon.mag;
    this.reloadT = 0;
    this.fireCooldown = 0;
    this.timeSinceShot = 99;
    this.shotIndex = 0;
    this.recoil = 0;
    this.setZoom(0);
    this.scenario = new Cls(this, meta, difficulty, this.rng);
    this.scenario.build(this.world);
    const sp = this.scenario.spawn();
    this.player.reset(sp.pos, this.weapon.runSpeed, accurateSpeed(this.weapon));
    this.player.allowMove = this.scenario.allowMove !== false;
    this.player.allowJump = this.scenario.allowJump !== false;
    this.yaw = sp.yaw || 0;
    this.pitch = sp.pitch || 0;
    this.killY = this.scenario.killY ?? this.world.minY - 6;
    this.frozenUntil = 0;
    this.countdown = opts.countdown ?? 3;
    this.lastCount = null;
    this.paused = false;
    this.held.clear();
    this.toggles = { walk: false, crouch: false };
    this.fsDeclined = false;
    this.syncInput();
    this.firing = false;
    this.hud.reset(meta, difficulty, this.weapon, {
      party: !!this.party,
      showSpeed: this.settings.showSpeed && this.scenario.allowMove !== false,
      showFps: this.settings.showFps,
    });
    this.buildViewmodel();
    this.rebuildRayList();
    document.getElementById('overlay-pause').hidden = true;
    const lockEl = document.getElementById('overlay-lock');
    if (this.locked) {
      this.state = 'countdown';
      lockEl.hidden = true;
    } else {
      // party countdown runs regardless; solo waits for the first click
      this.state = this.party ? 'countdown' : 'ready';
      lockEl.hidden = false;
    }
    this.syncCamera(1);
    if (!this.raf) {
      this.lastT = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  unload() {
    this.scenario?.dispose?.();
    for (const e of [...this.entities]) e.dispose?.();
    this.entities.clear();
    this.targetMeshes = [];
    for (const fx of this.effects) fx.dispose();
    this.effects = [];
    for (const d of this.decals) {
      this.scene.remove(d);
      d.material.dispose();
    }
    this.decals = [];
    this.world.clear();
    this.ghosts.clear();
    this.scenario = null;
  }

  restart() {
    if (this.party || !this.meta) return;
    this.load(this.meta, this.difficulty, (Math.random() * 2 ** 31) >>> 0, { countdown: 3 });
    this.requestLock();
  }

  quit() {
    const wasParty = this.party;
    this.stop();
    this.onQuit?.(wasParty);
  }

  stop() {
    this.state = 'idle';
    this.unload();
    if (document.pointerLockElement) document.exitPointerLock();
    this.exitFullscreen();
    this.locked = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  begin() {
    this.state = 'running';
    this.audio.beep(true);
    this.hud.countdown(null);
    this.scenario.begin();
  }

  finish(reason = 'complete') {
    if (this.state !== 'running') return;
    this.state = 'finished';
    this.firing = false;
    const res = this.scenario.results();
    res.reason = reason;
    res.meta = this.meta;
    res.difficulty = this.difficulty;
    res.party = this.party;
    if (document.pointerLockElement) document.exitPointerLock();
    this.locked = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.audio.good();
    this.onFinish?.(res);
  }

  freeze(seconds) {
    this.frozenUntil = this.scenarioTime() + seconds;
  }

  respawn(pos, yaw = null, pitch = null) {
    this.player.teleport(pos);
    if (yaw != null) this.yaw = yaw;
    if (pitch != null) this.pitch = pitch;
  }

  // ------------------------------------------------------------------ entities / rays
  addTarget(t) {
    this.entities.add(t);
    for (const m of t.hitMeshes) this.targetMeshes.push(m);
    this.rebuildRayList();
  }

  removeTarget(t) {
    if (!t.hitMeshes) return;
    const set = new Set(t.hitMeshes);
    const before = this.targetMeshes.length;
    this.targetMeshes = this.targetMeshes.filter((m) => !set.has(m));
    if (before !== this.targetMeshes.length) this.rebuildRayList();
  }

  removeEntity(t) {
    this.removeTarget(t);
    this.entities.delete(t);
  }

  rebuildRayList() {
    this.rayList = [...this.world.blockers, ...this.targetMeshes];
  }

  /** True if nothing in the world blocks the segment a → b. */
  canSee(a, b) {
    _v3.subVectors(b, a);
    const dist = _v3.length();
    if (dist < 1e-3) return true;
    this.visRay.set(a, _v3.multiplyScalar(1 / dist));
    this.visRay.far = dist - 0.02;
    return this.visRay.intersectObjects(this.world.blockers, false).length === 0;
  }

  eyePos(out = new THREE.Vector3()) {
    return out.set(this.player.pos.x, this.player.pos.y + this.player.eye, this.player.pos.z);
  }

  /** Can the player see the bot (head or chest)? */
  botVisible(bot) {
    const eye = this.eyePos(_v1);
    return this.canSee(eye, bot.headWorld(_v2)) || this.canSee(eye, bot.chestWorld(_v2));
  }

  /** Can someone at `from` see the player (eye or chest)? */
  playerVisibleFrom(from) {
    const eye = this.eyePos(_v1);
    if (this.canSee(from, eye)) return true;
    eye.y -= 0.45;
    return this.canSee(from, eye);
  }

  // ------------------------------------------------------------------ weapon
  setZoom(index) {
    const sc = this.weapon?.scope;
    const zooms = sc?.zooms || [];
    this.zoomIndex = index > zooms.length ? 0 : index;
    this.zoom = this.zoomIndex ? zooms[this.zoomIndex - 1] : 1;
    // VALORANT zoom divides the 103° horizontal FOV (2.5x → 41.2°, 5x → 20.6°)
    this.camera.fov = vfovFromHfov(103 / this.zoom);
    this.camera.updateProjectionMatrix();
    const lens = this.scopeLens();
    this.hud.scope(lens);
    if (this.viewmodel) this.viewmodel.visible = this.settings.showViewmodel && !lens;
    this.player.speedMult = this.zoom > 1 ? sc?.moveMult ?? 1 : 1;
  }

  /** Sniper scopes black out the screen; rifle ADS keeps the normal view. */
  scopeLens() {
    return this.zoom > 1 && this.weapon?.scope?.overlay !== false;
  }

  cycleScope() {
    if (!this.weapon.scope || this.state !== 'running') return;
    if (this.fireCooldown > 0 && this.weapon.scope.unscopeOnFire) return; // bolt cycling
    this.setZoom(this.zoomIndex + 1);
  }

  /** Hold-to-scope mode: first zoom level while held, unscoped on release. */
  scopeHold(on) {
    if (!this.weapon?.scope) return;
    if (!on) this.setZoom(0);
    else if (this.state === 'running' && this.zoomIndex === 0 && this.fireCooldown <= 0 && this.reloadT <= 0) this.setZoom(1);
  }

  startReload() {
    const w = this.weapon;
    if (w.noFire || !Number.isFinite(w.mag) || this.reloadT > 0 || this.ammo === w.mag) return;
    this.reloadT = w.reload;
    this.setZoom(0);
  }

  trigger(timeStamp) {
    if (this.state !== 'running' || this.paused) return;
    this.audio.ensure();
    if (this.scenario.onFireInput && this.scenario.onFireInput(timeStamp)) return;
    this.tryFire();
  }

  currentSpread() {
    const w = this.weapon;
    let fe = 0;
    if (w.firingError && this.timeSinceShot < w.firingError.recover && this.shotIndex + 1 >= w.firingError.startShot) {
      fe = Math.min(w.firingError.max, (this.shotIndex + 2 - w.firingError.startShot) * w.firingError.perShot);
    }
    return computeSpread(w, this.player, { scoped: this.zoom > 1, firingError: fe });
  }

  tryFire() {
    const w = this.weapon;
    if (w.noFire || this.fireCooldown > 0 || this.reloadT > 0) return;
    if (this.ammo <= 0) {
      this.startReload();
      return;
    }
    const spreadDeg = this.currentSpread();
    this.fireCooldown = w.interval / (this.zoom > 1 ? w.scope?.fireRateMult ?? 1 : 1);
    this.ammo -= 1;
    this.shotIndex = this.timeSinceShot < (w.firingError?.recover ?? 0.3) ? this.shotIndex + 1 : 1;
    this.timeSinceShot = 0;

    const p = this.player;
    const speed = p.hspeed();
    const yaw = this.yaw;
    const pitch = this.pitch + this.recoil * DEG;
    const cp = Math.cos(pitch);
    const fwd = _v1.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    if (spreadDeg > 0) {
      const right = _v2.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const up = _v3.crossVectors(right, fwd);
      const r = Math.tan(spreadDeg * DEG) * Math.sqrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      fwd.addScaledVector(right, r * Math.cos(th)).addScaledVector(up, r * Math.sin(th)).normalize();
    }
    this.syncCamera(this.lastAlpha ?? 1);
    const origin = this.camera.position.clone();
    this.raycaster.set(origin, fwd);
    this.raycaster.far = 400;
    const hit = this.raycaster.intersectObjects(this.rayList, false)[0];

    const info = {
      time: this.scenarioTime(),
      hit: false,
      zone: null,
      target: null,
      killed: false,
      damage: 0,
      point: hit ? hit.point.clone() : origin.clone().addScaledVector(fwd, 200),
      distance: hit ? hit.distance : Infinity,
      speed,
      onGround: p.onGround,
      accurate: p.onGround && speed <= accurateSpeed(w) && !(p.landPenalty > 0 && !w.noLandPenalty),
      justLanded: p.onGround && p.landPenalty > 0,
      scoped: this.zoom > 1,
      spread: spreadDeg,
      shotIndex: this.shotIndex,
      crouched: p.crouched,
    };
    if (hit && hit.object.userData.hit) {
      const { target, zone } = hit.object.userData.hit;
      info.hit = true;
      info.zone = zone;
      info.target = target;
      info.damage = w.dmg[zone];
      info.killed = target.damage(info.damage, zone);
      this.hud.hitmarker(info.killed ? 'kill' : zone === 'head' ? 'head' : 'body');
      this.audio.hit(zone);
      if (info.killed && !(w.id === 'rifle' && this.audio.skinKill(this.skinId))) this.audio.kill(zone === 'head');
    } else if (hit) {
      this.impact(hit);
    }

    // recoil: first shots are clean, then the view climbs (pull down to control)
    if (w.recoil && this.shotIndex >= w.recoil.startShot) this.recoil = Math.min(w.recoil.max, this.recoil + w.recoil.kick);
    if (w.scope?.unscopeOnFire) this.setZoom(0);
    this.tracer(info.point);
    this.audio.shot(w.id);
    if (this.viewmodel) this.viewmodel.userData.kick = 1;
    this.skinFx?.onShot();

    if (this.scenario.feedback === 'movement' && this.settings.showFeedback) {
      if (!p.onGround) this.hud.feedback('IN AIR: inaccurate', 'bad');
      else if (info.justLanded) this.hud.feedback('JUST LANDED: +7° for 0.225 s', 'bad');
      else if (info.accurate) this.hud.feedback(`STOPPED · ${speed.toFixed(2)} m/s`, 'good');
      else this.hud.feedback(`MOVING · ${speed.toFixed(2)} m/s`, 'bad');
    }
    this.scenario.onShot(info);
    if (this.ammo <= 0) this.startReload();
  }

  tracer(to) {
    const from = this.camera.localToWorld(_v1.set(0.12, -0.1, -0.4)).clone();
    this.line(from, to, this.weapon.id === 'rifle' ? skinOf(this.skinId).tracer : '#fff2c4', 0.06);
  }

  /** Enemy shot tracer from a bot toward the player. */
  enemyTracer(from) {
    const to = this.eyePos(new THREE.Vector3());
    to.y -= 0.2;
    this.line(from.clone(), to, '#ff6b6b', 0.12);
    this.audio.enemyShot();
  }

  line(from, to, color, life) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        mat.opacity = 0.9 * (1 - t / life);
        return t < life;
      },
      dispose: () => {
        this.scene.remove(line);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  impact(hit) {
    if (!hit.face) return;
    const mat = new THREE.MeshBasicMaterial({ color: '#05070b', transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    if (!this.decalGeo) this.decalGeo = new THREE.CircleGeometry(0.035, 8);
    const m = new THREE.Mesh(this.decalGeo, mat);
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    m.position.copy(hit.point).addScaledVector(n, 0.004);
    m.lookAt(_v1.copy(m.position).add(n));
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > 80) {
      const old = this.decals.shift();
      this.scene.remove(old);
      old.material.dispose();
    }
  }

  buildViewmodel() {
    if (this.viewmodel) {
      this.vmCamera.remove(this.viewmodel);
      this.viewmodel.traverse((o) => o.material?.dispose());
    }
    this.skinFx?.dispose();
    this.skinFx = null;
    const g = new THREE.Group();
    const mk = (size, pos, color, emissive = '#000000') => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshLambertMaterial({ color, emissive }));
      m.position.set(...pos);
      m.renderOrder = 900 + g.children.length;
      g.add(m);
    };
    const id = this.weapon.id;
    if (id === 'knife') {
      mk([0.03, 0.05, 0.12], [0, 0, 0], '#1f2533');
      mk([0.012, 0.045, 0.22], [0, 0.005, -0.16], '#c9d3e6', '#2a3140');
    } else if (id === 'sniper') {
      mk([0.06, 0.09, 0.7], [0, 0, -0.3], '#232a39');
      mk([0.025, 0.025, 0.45], [0, 0.02, -0.85], '#151a24');
      mk([0.05, 0.05, 0.26], [0, 0.08, -0.3], '#2de2c2', '#0d5f53');
    } else if (id === 'precision') {
      mk([0.05, 0.07, 0.3], [0, 0, -0.15], '#232a39');
      mk([0.052, 0.012, 0.2], [0, 0.04, -0.15], '#2de2c2', '#0d5f53');
    } else {
      // rifle: skinned model (see skins.js)
      const rifle = buildRifle(this.settings.rifleSkin);
      g.add(rifle.group);
      this.skinFx = rifle;
      this.skinId = rifle.skin.id;
    }
    g.scale.setScalar(0.5);
    g.position.set(0.18, -0.16, -0.27);
    g.userData.base = g.position.clone();
    g.userData.kick = 0;
    g.visible = this.settings.showViewmodel;
    this.vmCamera.add(g);
    this.viewmodel = g;
  }

  // ------------------------------------------------------------------ events
  playerEvent(type, data) {
    if (type === 'step') this.audio.step();
    // drills about sound explain why each jump / landing was (or wasn't) heard
    const explain = this.scenario?.noiseFeedback && this.settings.showFeedback && this.state === 'running';
    if (type === 'jump') {
      if (data.loud) this.audio.jump();
      if (explain) {
        if (!data.loud) this.hud.feedback('SILENT JUMP', 'good', 0.6);
        else this.hud.feedback(`LOUD JUMP · hold ${this.keyName('walk')} or ${this.keyName('crouch')}`, 'bad', 0.8);
      }
    }
    if (type === 'land') {
      if (data.loud) this.audio.land();
      if (explain && data.airTime > 0.1) {
        if (!data.loud) this.hud.feedback(`SILENT LANDING · ${data.fall.toFixed(2)} m fall`, 'good', 0.9);
        else if (data.speed > MOVE.silentLandVy) this.hud.feedback(`LOUD LANDING · fell ${data.fall.toFixed(2)} m`, 'bad', 1.1);
        else this.hud.feedback(`LOUD LANDING · moving ${data.hspeed.toFixed(1)} m/s (walk!)`, 'bad', 1.1);
      }
    }
    this.scenario?.onPlayerEvent?.(type, data);
  }

  // ------------------------------------------------------------------ loop
  loop(now) {
    if (this.state === 'idle' || this.state === 'finished') {
      this.raf = null;
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    this.frameDt = dt;

    this.fpsAcc.t += dt;
    this.fpsAcc.n += 1;
    if (this.fpsAcc.t >= 0.5) {
      this.hud.fps(Math.round(this.fpsAcc.n / this.fpsAcc.t));
      this.fpsAcc.t = 0;
      this.fpsAcc.n = 0;
    }

    const simulate = !this.paused || !!this.party;
    let alpha = 1;
    if (simulate && this.state !== 'ready') {
      if (this.state === 'countdown') this.tickCountdown(dt);
      this.acc = (this.acc || 0) + dt;
      let steps = 0;
      while (this.acc >= TICK && steps < 40) {
        this.fixed(TICK);
        this.acc -= TICK;
        steps += 1;
      }
      if (steps >= 40) this.acc = 0;
      alpha = this.acc / TICK;
      this.frame(dt);
    }
    this.lastAlpha = alpha;
    this.syncCamera(alpha);
    for (const e of this.entities) e.frame?.(alpha);
    this.skinFx?.update(this.frameDt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.viewmodel?.visible) {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
    if (this.audio.ctx) {
      this.camera.getWorldDirection(_v1);
      _v2.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.audio.setListener(this.camera.position, _v1, _v2);
    }
    this.scenario?.postRender?.(performance.now());
  }

  tickCountdown(dt) {
    this.countdown -= dt;
    const n = Math.ceil(this.countdown);
    if (n !== this.lastCount) {
      this.lastCount = n;
      if (n > 0) {
        this.hud.countdown(n);
        this.audio.beep(false);
      }
    }
    if (this.countdown <= 0) this.begin();
  }

  fixed(dt) {
    const p = this.player;
    p.frozen = this.state !== 'running' || this.scenarioTime() < this.frozenUntil || (this.paused && !!this.party);
    p.step(dt, this.yaw, this.world);
    if (this.state === 'running') {
      for (const e of this.entities) e.fixedStep?.(dt);
      this.scenario.fixedUpdate?.(dt);
      if (p.pos.y < this.killY) this.scenario.onFall();
    }
  }

  frame(dt) {
    const w = this.weapon;
    const s = this.scenario;
    if (this.state === 'running') {
      s.elapsed += dt;
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
      this.timeSinceShot += dt;
      if (this.reloadT > 0) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) {
          this.reloadT = 0;
          this.ammo = w.mag;
        }
      }
      if (this.firing && w.auto && !this.paused) this.tryFire();
      // hold-to-scope: re-scope after the bolt or a reload while the key is still held
      if (w.scope && this.modes.scope === 'hold' && this.zoomIndex === 0 && this.fireCooldown <= 0 && this.reloadT <= 0 && !this.paused && this.isHeld('scope')) this.setZoom(1);
      if (w.recoil && this.timeSinceShot > 0.1) this.recoil = Math.max(0, this.recoil - w.recoil.recover * dt);
      s.update(dt);
      const limit = this.meta.duration || this.meta.timeLimit;
      if (s.finished) this.finish('complete');
      else if (limit && s.elapsed >= limit) this.finish(this.meta.duration ? 'complete' : 'timeout');
    }
    // effects
    this.effects = this.effects.filter((fx) => {
      const alive = fx.update(dt);
      if (!alive) fx.dispose();
      return alive;
    });
    this.ghosts.frame(dt);
    this.updateHud(dt);
    this.netSync(dt);
  }

  syncCamera(alpha) {
    const p = this.player;
    const x = p.prev.x + (p.pos.x - p.prev.x) * alpha;
    const y = p.prev.y + (p.pos.y - p.prev.y) * alpha;
    const z = p.prev.z + (p.pos.z - p.prev.z) * alpha;
    const eye = p.prevEye + (p.eye - p.prevEye) * alpha;
    this.camera.position.set(x, y + eye, z);
    this.camera.rotation.set(this.pitch + this.recoil * DEG, this.yaw, 0);
    this.camera.updateMatrixWorld();
    const vm = this.viewmodel;
    if (vm) {
      vm.userData.kick = Math.max(0, vm.userData.kick - this.frameDt * 10);
      const bob = p.onGround ? Math.sin(performance.now() / 110) * Math.min(1, p.hspeed() / 5.4) * 0.006 : 0;
      vm.position.copy(vm.userData.base);
      vm.position.z += vm.userData.kick * 0.05;
      vm.position.y += bob;
    }
  }

  updateHud(dt) {
    const h = this.hud;
    const s = this.scenario;
    const p = this.player;
    h.tick(dt);
    if (!s) return;
    if (this.state === 'running') {
      const limit = this.meta.duration;
      h.set(h.timer, limit ? Math.max(0, limit - s.elapsed).toFixed(1) : s.elapsed.toFixed(2), 'timer');
      h.set(h.score, s.liveDisplay(), 'score');
      h.stats(s.hud());
    }
    if (this.settings.showSpeed && s.allowMove !== false) h.speed(p.hspeed(), p.runSpeed, p.accurateSpeed, p.onGround);
    const w = this.weapon;
    if (!w.noFire) {
      h.ammo({
        cur: this.ammo,
        max: w.mag,
        name: `${w.name.toUpperCase()}${this.zoom > 1 ? ` · ${this.zoom}x` : ''}`,
        reloadFrac: this.reloadT > 0 ? 1 - this.reloadT / w.reload : -1,
        key: this.keyName('reload'),
      });
      if (w.scope?.unscopeOnFire) h.bolt(this.fireCooldown > 0 ? 1 - this.fireCooldown / w.interval : 1);
    }
  }

  netSync(dt) {
    if (!this.party || this.state !== 'running' || !this.net) return;
    this.netT.live += dt;
    this.netT.pos += dt;
    if (this.netT.live >= 0.25) {
      this.netT.live = 0;
      this.net.send({ t: 'live', runId: this.party.runId, score: this.scenario.score(), display: this.scenario.liveDisplay() });
    }
    if (this.scenario.ghosts && this.netT.pos >= 0.066) {
      this.netT.pos = 0;
      const p = this.player.pos;
      this.net.send({ t: 'pos', p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +this.yaw.toFixed(2), this.player.crouched ? 1 : 0] });
    }
  }
}
