import * as THREE from 'three';
import { Game } from './game/game.js';
import { SKINS, skinOf, buildRifle, skinSwatch } from './game/skins.js';
import { Net } from './net.js';
import { AudioFX } from './audio.js';
import { WEAPONS } from './game/weapons.js';
import { GUIDE, NUMBERS } from './guide.js';
import { el, fmtScore, mean, timeAgo } from './util.js';
import {
  loadSettings, saveSettings, clientId, edpi, cmPer360, parseCrosshairCode, crosshairToCode,
  crosshairFromSettings, drawCrosshair, XH_COLOR_NAMES, DEFAULT_XH_CODE,
  ACTIONS, DEFAULT_BINDS, DEFAULT_MODES, normalizeBinds, keyLabel,
} from './settings.js';

const DEBUG = new URLSearchParams(location.search).has('debug');
const HISTORY_KEY = 'strafelab.history.v1';
const HISTORY_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const S = {
  meta: null,
  byId: {},
  settings: loadSettings(),
  cid: clientId(),
  category: 'All',
  selected: 'counter-strafe',
  difficulty: 'medium',
  party: null,
  chat: [],
  live: {},
  partyRun: null,
  partyResults: null,
  lb: new Map(),
  lbScenario: 'counter-strafe',
  lbDiff: 'medium',
  lbFilter: 'global',
  results: null,
};

let game;
let net;
let audio;
const $ = (id) => document.getElementById(id);
/** replaceChildren that skips null/false entries (DOM would render them as text). */
const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

// ------------------------------------------------------------------ history / PBs
function loadHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    return history && typeof history === 'object' && !Array.isArray(history) ? history : {};
  } catch {
    return {};
  }
}

function historyRuns(history, key) {
  const list = history[key];
  return Array.isArray(list) ? list.filter((entry) => Number.isFinite(entry?.score)) : [];
}

function pushHistory(key, entry) {
  const h = loadHistory();
  h[key] = [...historyRuns(h, key), entry].slice(-60);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* storage full or blocked */
  }
}

const better = (meta, a, b) => (meta.order === 'asc' ? a < b : a > b);

function bestRun(meta, list) {
  let best = null;
  for (const e of list) if (!best || better(meta, e.score, best.score)) best = e;
  return best;
}

function personalBest(meta, diff, history = loadHistory()) {
  return bestRun(meta, historyRuns(history, `${meta.id}:${diff}`));
}

const statsObj = (stats) => Object.fromEntries((stats || []).slice(0, 16).map(([k, v]) => [k, String(v)]));

function toast(text, kind = 'info') {
  const t = el('div', { class: `toast ${kind}` }, text);
  $('toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

function seg(options, value, onPick, cls = '') {
  return el('div', { class: `seg ${cls}` }, options.map(([v, label]) => el('button', { class: v === value ? 'on' : '', onclick: () => onPick(v) }, label)));
}

// ------------------------------------------------------------------ tabs
function showTab(tab) {
  stopBindListen();
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const t of ['train', 'leaderboard', 'settings', 'guide']) $(`tab-${t}`).hidden = t !== tab;
  if (tab === 'leaderboard') {
    requestLb(S.lbScenario, S.lbDiff, S.lbFilter);
    renderLeaderboard();
  }
  if (tab === 'settings') renderSettings();
}

// ------------------------------------------------------------------ train tab
function renderChips() {
  const cats = ['All', ...S.meta.categories];
  $('cat-chips').replaceChildren(...cats.map((c) => el('button', {
    class: `chip${S.category === c ? ' on' : ''}`,
    onclick: () => {
      S.category = c;
      renderChips();
      renderGrid();
    },
  }, c)));
}

function renderGrid() {
  const list = S.meta.scenarios.filter((m) => S.category === 'All' || m.category === S.category);
  const history = loadHistory();
  $('scenario-grid').replaceChildren(...list.map((m) => {
    const pb = personalBest(m, S.difficulty, history);
    return el('button', {
      class: `scn${S.selected === m.id ? ' on' : ''}`,
      dataset: { cat: m.category },
      onclick: () => {
        S.selected = m.id;
        renderGrid();
        renderDetail();
      },
      ondblclick: () => startSolo(m.id, S.difficulty),
    },
    el('div', { class: 'scn-cat' }, m.category),
    el('h3', {}, m.name),
    el('p', {}, m.short),
    el('div', { class: 'scn-foot' },
      el('span', {}, WEAPONS[m.weapon].name),
      el('span', { class: pb ? 'pb' : 'muted' }, pb ? `PB ${fmtScore(m, pb.score)}` : 'No PB')));
  }));
}

function renderDetail() {
  const m = S.byId[S.selected];
  if (!m) return;
  const w = WEAPONS[m.weapon];
  const pb = personalBest(m, S.difficulty);
  const isLeader = S.party && S.party.leader === net.id;
  const key = `${m.id}:${S.difficulty}:global`;
  const top = S.lb.get(key);
  const length = m.duration ? `${m.duration}s` : m.id === 'reaction' ? '12 trials' : m.id === 'peek-duel' ? '10 rounds' : 'Until finished';
  $('scenario-detail').replaceChildren(
    el('div', { class: 'scn-cat' }, `${m.category} · ${w.name}`),
    el('h2', {}, m.name),
    el('p', { class: 'desc' }, m.desc),
    el('ul', { class: 'tips' }, m.tips.map((t) => el('li', {}, t))),
    el('div', { class: 'kv' }, el('span', {}, 'Difficulty'), seg(S.meta.difficulties.map((d) => [d, DIFF_LABEL[d]]), S.difficulty, (d) => {
      S.difficulty = d;
      renderGrid();
      renderDetail();
      requestLb(m.id, d, 'global', 5);
    })),
    el('div', { class: 'kv' }, el('span', {}, 'Weapon'), el('b', {}, `${w.name}${w.note ? ` · ${w.note}` : ''}`)),
    el('div', { class: 'kv' }, el('span', {}, 'Length'), el('b', {}, length)),
    el('div', { class: 'kv' }, el('span', {}, 'Your best'),
      pb ? el('div', { class: 'detail-progress' }, el('b', { class: 'accent' }, fmtScore(m, pb.score)),
        el('button', { class: 'ghost small', onclick: () => showProgress(m.id, S.difficulty) }, 'View progress')) : el('b', { class: 'muted' }, '-')),
    el('div', { class: 'actions' },
      el('button', { class: 'primary big', onclick: () => startSolo(m.id, S.difficulty) }, 'Play solo'),
      isLeader && S.party.state === 'lobby'
        ? el('button', { class: 'ghost big', onclick: () => net.send({ t: 'party_config', scenario: m.id, difficulty: S.difficulty }) }, 'Set for party')
        : null),
    el('h4', {}, `Top players · ${DIFF_LABEL[S.difficulty]}`),
    !net.online
      ? el('p', { class: 'muted small' }, 'Server offline. Leaderboards need the StrafeLab server.')
      : top && top.length
        ? el('ol', { class: 'mini-lb' }, top.slice(0, 5).map((e) => el('li', { class: e.me ? 'me' : '' }, el('span', {}, e.name), el('b', {}, fmtScore(m, e.score)))))
        : el('p', { class: 'muted small' }, top ? 'No scores yet. Be the first.' : 'Loading…'),
  );
  if (!top && net.online) requestLb(m.id, S.difficulty, 'global', 5);
}

// ------------------------------------------------------------------ leaderboard tab
const lbPending = new Set();
function requestLb(scenario, difficulty, filter = 'global', limit = 50) {
  const k = `${scenario}:${difficulty}:${filter}`;
  if (!net.online || lbPending.has(k)) return;
  lbPending.add(k);
  setTimeout(() => lbPending.delete(k), 1500);
  net.send({ t: 'lb_get', scenario, difficulty, filter, limit });
}

function renderLeaderboard() {
  if (!$('lb-scenario').options.length) {
    for (const m of S.meta.scenarios) $('lb-scenario').append(el('option', { value: m.id }, `${m.category} · ${m.name}`));
    $('lb-scenario').addEventListener('change', (e) => {
      S.lbScenario = e.target.value;
      requestLb(S.lbScenario, S.lbDiff, S.lbFilter);
      renderLeaderboard();
    });
  }
  $('lb-scenario').value = S.lbScenario;
  $('lb-diff').replaceWith(Object.assign(seg(S.meta.difficulties.map((d) => [d, DIFF_LABEL[d]]), S.lbDiff, (d) => {
    S.lbDiff = d;
    requestLb(S.lbScenario, d, S.lbFilter);
    renderLeaderboard();
  }), { id: 'lb-diff' }));
  $('lb-filter').replaceWith(Object.assign(seg([['global', 'Global'], ['party', 'Party']], S.lbFilter, (f) => {
    if (f === 'party' && !S.party) {
      toast('Join a party to see party standings');
      return;
    }
    S.lbFilter = f;
    requestLb(S.lbScenario, S.lbDiff, f);
    renderLeaderboard();
  }), { id: 'lb-filter' }));

  const m = S.byId[S.lbScenario];
  const rows = S.lb.get(`${S.lbScenario}:${S.lbDiff}:${S.lbFilter}`);
  const body = $('lb-rows');
  if (!net.online) {
    body.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'empty' }, 'Server offline. Start it with "python server.py" to use global leaderboards.')));
  } else if (!rows) {
    body.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'empty' }, 'Loading…')));
  } else if (!rows.length) {
    body.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'empty' }, 'No scores yet for this drill and difficulty.')));
  } else {
    body.replaceChildren(...rows.map((e) => el('tr', { class: e.me ? 'me' : '' },
      el('td', { class: 'rank' }, e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : String(e.rank)),
      el('td', {}, e.name),
      el('td', { class: 'score' }, fmtScore(m, e.score)),
      el('td', { class: 'muted small' }, Object.entries(e.stats || {}).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')),
      el('td', { class: 'muted small' }, timeAgo(e.ts)))));
  }
  renderHistory();
}

function showProgress(scenario, difficulty) {
  S.lbScenario = scenario;
  S.lbDiff = difficulty;
  showTab('leaderboard');
  $('lb-history-title').focus();
}

function renderHistoryChart(m, vals, best) {
  const W = 320;
  const H = 120;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const x = (i) => 8 + (i / (vals.length - 1)) * (W - 16);
  const y = (v) => {
    const t = (v - lo) / (hi - lo);
    return m.order === 'asc' ? 10 + t * (H - 20) : H - 10 - t * (H - 20);
  };
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" role="img" aria-label="Score history from oldest to newest">
    <line x1="8" x2="${W - 8}" y1="${y(best)}" y2="${y(best)}" class="pbline"/>
    <polyline points="${pts}" class="line"/>
    ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" class="${v === best ? 'pb' : ''}"><title>${fmtScore(m, v)}</title></circle>`).join('')}
  </svg>`;
}

function renderHistory() {
  const m = S.byId[S.lbScenario];
  const list = historyRuns(loadHistory(), `${m.id}:${S.lbDiff}`);
  const box = $('lb-history');
  if (!list.length) {
    box.replaceChildren(el('p', { class: 'muted small' }, 'Finish a run on this difficulty to start tracking your progress.'));
    return;
  }

  const best = bestRun(m, list).score;
  const vals = list.map((entry) => entry.score);
  const recent = vals.slice(-5);
  box.innerHTML = vals.length > 1 ? renderHistoryChart(m, vals, best) : '';
  box.append(
    el('div', { class: 'kv' }, el('span', {}, 'Personal best'), el('b', { class: 'accent' }, fmtScore(m, best))),
    el('div', { class: 'kv' }, el('span', {}, 'Runs saved'), el('b', {}, String(list.length))),
  );
  if (recent.length > 1) {
    const average = fmtScore(m, mean(recent));
    box.append(el('div', { class: 'kv' }, el('span', {}, `Last ${recent.length} average`), el('b', {}, average)));
  }
  if (vals.length >= 10) {
    const average = fmtScore(m, mean(vals.slice(-10, -5)));
    box.append(el('div', { class: 'kv' }, el('span', {}, 'Previous 5 average'), el('b', {}, average)));
  }
  box.append(el('h4', {}, 'Recent runs'), el('ol', { class: 'recent-runs' },
    list.slice(-5).reverse().map((entry) => {
      const date = new Date(entry.ts);
      const when = Number.isFinite(entry.ts) && Number.isFinite(date.getTime())
        ? el('time', { class: 'muted small', datetime: date.toISOString() }, HISTORY_DATE.format(date))
        : el('span', { class: 'muted small' }, 'Date unavailable');
      const details = Object.entries(entry.stats || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
      return el('li', {},
        el('div', { class: 'recent-run-top' }, when, el('b', { class: entry.score === best ? 'accent' : '' }, fmtScore(m, entry.score))),
        details ? el('div', { class: 'muted small' }, details) : null);
    })));
}

// ------------------------------------------------------------------ party panel
function renderParty() {
  const p = $('party-panel');
  const head = el('div', { class: 'party-head' }, el('h3', {}, 'Party'), el('span', { class: 'muted small' }, 'Up to 8 players'));
  if (!net.online) {
    p.replaceChildren(head, el('p', { class: 'muted' }, net.status === 'connecting' ? 'Connecting to server…' : 'Server offline.'),
      el('p', { class: 'muted small' }, 'Parties and global leaderboards need the StrafeLab server. Run "python server.py" and open the address it prints. Friends on your network can join with your LAN IP.'));
    return;
  }
  if (!S.party) {
    const code = el('input', { placeholder: 'CODE', maxlength: 5, class: 'code-input', autocomplete: 'off', spellcheck: 'false' });
    const join = () => code.value.trim() && net.send({ t: 'party_join', code: code.value.trim().toUpperCase() });
    code.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    p.replaceChildren(head,
      el('p', { class: 'muted small' }, 'Train together: everyone plays the same seeded drill at the same time, with live scores, ghosts in movement courses and a results table at the end.'),
      el('button', { class: 'primary block', onclick: () => net.send({ t: 'party_create' }) }, 'Create party'),
      el('div', { class: 'join-row' }, code, el('button', { class: 'ghost', onclick: join }, 'Join')));
    return;
  }
  const party = S.party;
  const me = party.members.find((x) => x.id === net.id);
  const isLeader = party.leader === net.id;
  const meta = S.byId[party.scenario];
  const members = el('ul', { class: 'members' }, party.members.map((mem) => el('li', {},
    el('span', { class: 'dot', style: { background: mem.color } }),
    el('span', { class: 'mname' }, mem.name, mem.id === net.id ? el('em', {}, ' (you)') : null),
    mem.id === party.leader ? el('span', { class: 'tag leader', title: 'Party leader' }, 'LEAD') : null,
    party.state === 'running' && mem.inRun ? el('span', { class: 'tag run' }, 'IN RUN') : mem.ready ? el('span', { class: 'tag ready' }, 'READY') : null,
    isLeader && mem.id !== net.id ? el('button', { class: 'icon', title: 'Remove from party', onclick: () => net.send({ t: 'party_kick', id: mem.id }) }, '✕') : null)));

  const chatLog = el('div', { class: 'chat-log' }, S.chat.map((c) => (c.system
    ? el('div', { class: 'sys' }, c.text)
    : el('div', {}, el('b', { style: { color: c.color } }, `${c.name}: `), c.text))));
  const chatInput = el('input', { placeholder: 'Message party…', maxlength: 200 });
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && chatInput.value.trim()) {
      net.send({ t: 'chat', text: chatInput.value.trim() });
      chatInput.value = '';
    }
  });

  const running = party.state === 'running';
  fill(p,
    head,
    el('div', { class: 'party-code' },
      el('span', { class: 'muted small' }, 'Code'),
      el('b', {}, party.code),
      el('button', { class: 'ghost small', onclick: () => navigator.clipboard?.writeText(party.code).then(() => toast('Party code copied')) }, 'Copy'),
      el('button', { class: 'ghost small danger', onclick: () => net.send({ t: 'party_leave' }) }, 'Leave')),
    members,
    el('div', { class: 'party-drill' },
      el('span', { class: 'muted small' }, 'Drill'),
      el('b', {}, `${meta?.name ?? party.scenario} · ${DIFF_LABEL[party.difficulty]}`),
      isLeader && !running ? el('span', { class: 'muted small' }, 'Pick a drill and click "Set for party" to change it.') : null),
    running
      ? el('p', { class: 'running-note' }, S.partyRun ? 'Run in progress' : 'Your party is in a run. You\'ll join the next one.')
      : el('div', { class: 'party-actions' },
        el('button', { class: me?.ready ? 'ghost' : 'ghost', onclick: () => net.send({ t: 'party_ready', ready: !me?.ready }) }, me?.ready ? 'Unready' : 'Ready'),
        isLeader ? el('button', { class: 'primary', onclick: () => net.send({ t: 'party_start' }) }, 'Start run') : el('span', { class: 'muted small' }, 'Waiting for the leader to start')),
    S.partyResults ? partyResultsTable(S.partyResults, true) : null,
    el('div', { class: 'chat' }, chatLog, chatInput),
  );
  chatLog.scrollTop = chatLog.scrollHeight;
}

function partyResultsTable(r, compact = false) {
  const meta = S.byId[r.scenario];
  return el('div', { class: `party-results${compact ? ' compact' : ''}` },
    el('h4', {}, `${r.final ? 'Last run' : 'Results so far'} · ${meta?.name ?? r.scenario}`),
    el('ol', {}, r.results.map((row, i) => el('li', { class: row.id === net.id ? 'me' : '' },
      el('span', { class: 'pos' }, row.status === 'done' ? String(i + 1) : '–'),
      el('span', { class: 'mname' }, row.name),
      el('b', {}, row.status === 'done' ? row.display : row.status === 'playing' ? 'playing…' : 'DNF')))));
}

// ------------------------------------------------------------------ rifle skins
let skinPreview = null;

/** One small WebGL view, reused across re-renders, showing the selected skin on a turning rifle. */
function getSkinPreview() {
  if (skinPreview) return skinPreview;
  const canvas = el('canvas', { class: 'skin-preview', width: 640, height: 260 });
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(640, 260, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#dfe8ff', '#1b2030', 1.4));
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(2, 3, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fb6ff', 1.2);
  rim.position.set(-3, 1, -2);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(26, 640 / 260, 0.01, 20);
  camera.position.set(0, 0.14, 1.75);
  camera.lookAt(0, -0.03, 0);
  const pivot = new THREE.Group();
  pivot.rotation.y = Math.PI / 2; // start side-on
  scene.add(pivot);
  skinPreview = { canvas, renderer, scene, camera, pivot, model: null, id: null, raf: null, last: 0 };
  return skinPreview;
}

function showSkinPreview(id) {
  const pv = getSkinPreview();
  if (pv.id !== id) {
    if (pv.model) {
      pv.pivot.remove(pv.model.group);
      pv.model.dispose();
    }
    pv.model = buildRifle(id);
    pv.model.group.position.z = 0.365; // the rifle spans z +0.16..-0.89: centre it on the pivot
    pv.pivot.add(pv.model.group);
    pv.id = id;
  }
  if (pv.raf) return;
  pv.last = performance.now();
  const tick = (now) => {
    if (!pv.canvas.isConnected || $('tab-settings').hidden) {
      pv.raf = null;
      return;
    }
    const dt = Math.min(0.05, (now - pv.last) / 1000);
    pv.last = now;
    pv.pivot.rotation.y += dt * 0.6;
    pv.model.update(dt);
    pv.renderer.render(pv.scene, pv.camera);
    pv.raf = requestAnimationFrame(tick);
  };
  pv.raf = requestAnimationFrame(tick);
}

function skinsPanel(s, commit) {
  const pv = getSkinPreview();
  const title = el('h4', {});
  const desc = el('p', { class: 'muted small' });
  const grid = el('div', { class: 'skin-grid' });
  const playSound = (id) => {
    audio.ensure();
    if (!audio.skinKill(id)) audio.kill(true);
  };
  const render = () => {
    const skin = skinOf(s.rifleSkin);
    title.textContent = skin.name;
    desc.textContent = skin.desc;
    showSkinPreview(skin.id);
    grid.replaceChildren(...SKINS.map((sk) => {
      const on = sk.id === skin.id;
      return el('div', {
        class: `skin-card${on ? ' on' : ''}`,
        role: 'button',
        tabindex: 0,
        onclick: () => {
          s.rifleSkin = sk.id;
          commit();
          render();
        },
      },
      skinSwatch(sk.id),
      el('b', {}, sk.name),
      el('div', { class: 'skin-actions' },
        el('span', { class: 'tag' + (on ? ' ready' : '') }, on ? 'EQUIPPED' : 'EQUIP'),
        el('button', {
          class: 'ghost small',
          title: 'Play kill sound',
          onclick: (e) => {
            e.stopPropagation();
            playSound(sk.id);
          },
        }, '▶ Kill sound')));
    }));
  };
  render();
  return el('div', { class: 'panel set wide skins' },
    el('h3', {}, 'Rifle skin'),
    el('div', { class: 'skin-top' }, el('div', { class: 'skin-stage' }, pv.canvas), el('div', {}, title, desc,
      el('p', { class: 'muted small' }, 'Original designs. The skin shows on your rifle in every rifle drill, colours your tracers and plays its own sound on each kill.'))),
    grid);
}

// ------------------------------------------------------------------ controls (key binds)
let bindListener = null;
let navBlockUntil = 0;

function stopBindListen() {
  if (bindListener) bindListener.cancel();
  bindListener = null;
}

function controlsPanel(s, commit, check) {
  const panel = el('div', { class: 'panel set wide controls' });

  const assign = (action, slot, code) => {
    if (code) {
      // one job per key: take it away from wherever else it was bound
      for (const other of ACTIONS) {
        for (const i of [0, 1]) {
          if (other.id === action.id && i === slot) continue;
          if (s.binds[other.id][i] === code) {
            s.binds[other.id][i] = null;
            if (other.id !== action.id) toast(`${keyLabel(code)} removed from ${other.label}`);
          }
        }
      }
    }
    s.binds[action.id][slot] = code;
    commit();
    build();
  };

  const listen = (action, slot, btn) => {
    stopBindListen();
    btn.classList.add('listening');
    btn.textContent = 'Press a key…';
    let active = true;
    const finish = () => {
      active = false;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('wheel', onWheel, true);
      setTimeout(() => window.removeEventListener('contextmenu', onCtx, true), 400);
      bindListener = null;
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || !e.code) return;
      finish();
      if (e.code === 'Escape') build();
      else if (e.code === 'Backspace' || e.code === 'Delete') assign(action, slot, null);
      else assign(action, slot, e.code);
    };
    const onMouse = (e) => {
      e.preventDefault();
      e.stopPropagation();
      navBlockUntil = performance.now() + 1500; // keep Mouse 4/5 from navigating back/forward
      finish();
      assign(action, slot, `Mouse${e.button}`);
    };
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.deltaY) return;
      if (!action.wheel) {
        toast('The mouse wheel can only be bound to Jump, Fire, Scope or Reload', 'bad');
        return;
      }
      finish();
      assign(action, slot, e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
    };
    const onCtx = (e) => e.preventDefault();
    // attach after the click that opened the slot, so that click isn't captured as the bind
    setTimeout(() => {
      if (!active) return;
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('wheel', onWheel, { capture: true, passive: false });
      window.addEventListener('contextmenu', onCtx, true);
    }, 0);
    bindListener = {
      cancel: () => {
        finish();
        build();
      },
    };
  };

  const bindButton = (action, slot) => {
    const code = s.binds[action.id][slot];
    const b = el('button', { class: `bind${code ? '' : ' empty'}`, title: 'Click, then press a key or mouse button' }, code ? keyLabel(code) : 'Unbound');
    b.addEventListener('click', (e) => {
      e.preventDefault();
      listen(action, slot, b);
    });
    return b;
  };

  const modeSelect = (action) => {
    const sel = el('select', { 'aria-label': `${action.label} mode` }, action.modes.map(([v, l]) => el('option', { value: v }, l)));
    sel.value = s.modes[action.id];
    sel.addEventListener('change', () => {
      s.modes[action.id] = sel.value;
      commit();
    });
    return sel;
  };

  const reset = () => {
    stopBindListen();
    s.binds = normalizeBinds(DEFAULT_BINDS);
    s.modes = { ...DEFAULT_MODES };
    commit();
    build();
    toast('Controls reset to defaults');
  };

  function build() {
    fill(panel,
      el('div', { class: 'controls-head' }, el('h3', {}, 'Controls'), el('button', { class: 'ghost small', onclick: reset }, 'Reset to defaults')),
      el('p', { class: 'muted small' }, 'Click a slot, then press a key or mouse button (side buttons work too). The mouse wheel can go on Jump, Fire, Scope or Reload. Esc cancels and Backspace clears the slot. A key can only do one job, so binding it here removes it from any other action.'),
      el('div', { class: 'bind-grid' },
        el('div', { class: 'bind-row head' }, el('span', {}, 'Action'), el('span', {}, 'Primary'), el('span', {}, 'Secondary'), el('span', {}, 'Mode')),
        ACTIONS.map((a) => el('div', { class: 'bind-row' },
          el('span', { class: 'bind-label' }, a.label),
          bindButton(a, 0),
          bindButton(a, 1),
          a.modes ? modeSelect(a) : el('span'))),
        el('div', { class: 'bind-row fixed' },
          el('span', { class: 'bind-label' }, 'Pause / free the mouse'),
          el('span', { class: 'bind locked' }, 'Esc'),
          el('span'),
          el('span', { class: 'muted small' }, 'Not rebindable'))),
      check('fullscreenPlay', 'Play in fullscreen and capture all keys (recommended)'),
      el('p', { class: 'muted small' }, 'During a run, browser shortcuts like Ctrl+H, Ctrl+F, Ctrl+D, F5 and the Alt menu are blocked. Chrome only lets a page capture Ctrl+W, Ctrl+T and Ctrl+N in fullscreen, so keep fullscreen on if you crouch with Ctrl. Without it you get a "Leave site?" prompt instead of losing the run. Hold Esc to leave fullscreen.'),
    );
  }

  build();
  return panel;
}

// ------------------------------------------------------------------ settings tab
function renderSettings() {
  stopBindListen();
  const s = S.settings;
  const commit = () => {
    saveSettings(s);
    game.applySettings(s);
    readouts();
  };
  const number = (key, opts = {}) => {
    const i = el('input', { type: 'number', value: s[key], step: opts.step ?? 'any', min: opts.min, max: opts.max });
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (Number.isFinite(v) && v > 0) {
        s[key] = v;
        commit();
      }
    });
    return i;
  };
  const check = (key, label) => {
    const i = el('input', { type: 'checkbox' });
    i.checked = !!s[key];
    i.addEventListener('change', () => {
      s[key] = i.checked;
      commit();
    });
    return el('label', { class: 'check' }, i, el('span', {}, label));
  };
  const select = (key, options) => {
    const i = el('select', {}, options.map(([v, l]) => el('option', { value: v }, l)));
    i.value = String(s[key]);
    i.addEventListener('change', () => {
      s[key] = typeof s[key] === 'number' ? parseFloat(i.value) : i.value;
      commit();
    });
    return i;
  };
  const field = (label, input, hint) => el('label', { class: 'field' }, el('span', {}, label), input, hint ? el('small', {}, hint) : null);

  const edpiOut = el('b', {});
  const cmOut = el('b', {});
  const readouts = () => {
    edpiOut.textContent = String(edpi(s));
    cmOut.textContent = `${cmPer360(s).toFixed(1)} cm`;
  };
  readouts();

  const sens = el('div', { class: 'panel set' },
    el('h3', {}, 'Mouse'),
    el('div', { class: 'two' }, field('Valorant sensitivity', number('sens', { step: 0.001, min: 0.001 })), field('Mouse DPI', number('dpi', { step: 50, min: 50 }))),
    el('div', { class: 'readouts' }, el('div', {}, el('span', {}, 'eDPI'), edpiOut), el('div', {}, el('span', {}, 'cm / 360°'), cmOut)),
    field('ADS sensitivity multiplier', number('adsMult', { step: 0.001, min: 0.001 }), 'Applies to rifle aim down sights.'),
    field('Scoped sensitivity multiplier', number('scopedMult', { step: 0.001, min: 0.001 }), 'Applies to sniper scopes.'),
    check('rawInput', 'Raw input (ignore Windows pointer speed & acceleration)'),
    el('p', { class: 'muted small' }, 'Use your in-game sensitivity and mouse DPI. The cm / 360° readout assumes raw mouse input, available in Chrome and Edge.'),
  );

  // crosshair
  let xh = crosshairFromSettings(s);
  const preview = el('canvas', { class: 'xh-canvas' });
  const previewBox = el('div', { class: 'xh-preview' }, preview);
  const codeInput = el('input', { value: s.crosshairCode, spellcheck: 'false', class: 'mono' });
  const redraw = () => drawCrosshair(preview, xh, (window.innerHeight / 1080) * (window.devicePixelRatio || 1));
  const setXh = () => {
    s.crosshairCode = crosshairToCode(xh);
    codeInput.value = s.crosshairCode;
    commit();
    redraw();
  };
  const xNum = (obj, key, min, max, step) => {
    const i = el('input', { type: 'range', min, max, step, value: obj[key] });
    const out = el('output', {}, String(obj[key]));
    i.addEventListener('input', () => {
      obj[key] = parseFloat(i.value);
      out.textContent = i.value;
      setXh();
    });
    return el('div', { class: 'range' }, i, out);
  };
  const xBool = (obj, key, label) => {
    const i = el('input', { type: 'checkbox' });
    i.checked = !!obj[key];
    i.addEventListener('change', () => {
      obj[key] = i.checked ? 1 : 0;
      setXh();
      buildXhEditor();
    });
    return el('label', { class: 'check' }, i, el('span', {}, label));
  };
  const editor = el('div', { class: 'xh-editor' });
  const buildXhEditor = () => {
    const colorSel = el('select', {}, XH_COLOR_NAMES.map((n, i) => el('option', { value: i }, n)));
    colorSel.value = String(xh.color);
    colorSel.addEventListener('change', () => {
      xh.color = parseInt(colorSel.value, 10);
      setXh();
      buildXhEditor();
    });
    const custom = el('input', { type: 'color', value: xh.custom });
    custom.addEventListener('input', () => {
      xh.custom = custom.value;
      setXh();
    });
    const lineBlock = (title, L) => el('div', { class: 'xh-lines' },
      el('h4', {}, title), xBool(L, 'show', 'Show'),
      L.show ? [field('Opacity', xNum(L, 'opacity', 0, 1, 0.05)), field('Length', xNum(L, 'length', 0, 20, 1)), field('Thickness', xNum(L, 'thickness', 0, 10, 1)), field('Offset', xNum(L, 'offset', 0, 20, 1))] : null);
    fill(editor,
      el('div', { class: 'two' }, field('Color', colorSel), xh.color === 8 ? field('Custom', custom) : el('span')),
      el('div', { class: 'two' }, xBool(xh, 'outlines', 'Outlines'), xBool(xh, 'dot', 'Center dot')),
      xh.outlines ? el('div', { class: 'two' }, field('Outline opacity', xNum(xh, 'outlineOpacity', 0, 1, 0.05)), field('Outline thickness', xNum(xh, 'outlineThickness', 1, 6, 1))) : null,
      xh.dot ? el('div', { class: 'two' }, field('Dot opacity', xNum(xh, 'dotOpacity', 0, 1, 0.05)), field('Dot thickness', xNum(xh, 'dotThickness', 1, 6, 1))) : null,
      el('div', { class: 'two' }, lineBlock('Inner lines', xh.inner), lineBlock('Outer lines', xh.outer)),
    );
  };
  buildXhEditor();
  const importBtn = el('button', { class: 'ghost', onclick: () => {
    try {
      xh = parseCrosshairCode(codeInput.value);
      setXh();
      buildXhEditor();
      toast('Crosshair imported', 'good');
    } catch (e) {
      toast(`Couldn't read that code: ${e.message}`, 'bad');
    }
  } }, 'Import');
  const copyBtn = el('button', { class: 'ghost', onclick: () => navigator.clipboard?.writeText(codeInput.value).then(() => toast('Crosshair code copied')) }, 'Copy');
  const resetBtn = el('button', { class: 'ghost', onclick: () => {
    xh = parseCrosshairCode(DEFAULT_XH_CODE);
    setXh();
    buildXhEditor();
  } }, 'Reset');
  const bgToggle = el('button', { class: 'ghost small', onclick: () => previewBox.classList.toggle('light') }, 'Toggle background');
  const xhPanel = el('div', { class: 'panel set wide' },
    el('h3', {}, 'Crosshair'),
    el('div', { class: 'xh-top' }, el('div', {}, previewBox, bgToggle),
      el('div', { class: 'xh-code' },
        field('Valorant crosshair profile code', codeInput, 'Paste a code from Valorant (Settings > Crosshair > Import) and click Import. Covers colour, outlines, centre dot, inner and outer lines.'),
        el('div', { class: 'btn-row' }, importBtn, copyBtn, resetBtn))),
    editor);
  setTimeout(redraw, 0);

  const gameplay = el('div', { class: 'panel set' },
    el('h3', {}, 'Gameplay'),
    field('Enemy highlight color', select('enemyColor', [['red', 'Red (default)'], ['yellow', 'Yellow (deuteranopia)'], ['purple', 'Purple (tritanopia)']])),
    check('showSpeed', 'Show speed / accuracy meter'),
    check('showFeedback', 'Show shot & stop feedback'),
    check('showViewmodel', 'Show weapon model'),
    check('showFps', 'Show FPS'),
  );

  const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.volume });
  vol.addEventListener('input', () => {
    s.volume = parseFloat(vol.value);
    commit();
  });
  const av = el('div', { class: 'panel set' },
    el('h3', {}, 'Audio & video'),
    field('Master volume', vol),
    check('hitSounds', 'Hit / headshot sounds'),
    check('footsteps', 'Footstep sounds'),
    field('Render scale', select('renderScale', [['1', '100% (sharpest)'], ['0.75', '75%'], ['0.5', '50% (fastest)']]), 'Lower it if your FPS is below your monitor refresh rate.'),
  );

  $('settings-body').replaceChildren(sens, gameplay, skinsPanel(s, commit), controlsPanel(s, commit, check), xhPanel, av);
}

// ------------------------------------------------------------------ guide
function renderGuide() {
  $('guide-body').replaceChildren(
    ...GUIDE.map((g) => el('article', { class: 'panel guide' },
      el('h3', {}, g.title),
      el('p', {}, g.body),
      el('ul', {}, g.points.map((p) => el('li', {}, p))),
      el('button', { class: 'ghost small', onclick: () => {
        S.selected = g.drill;
        S.category = 'All';
        showTab('train');
        renderChips();
        renderGrid();
        renderDetail();
      } }, `Open drill: ${S.byId[g.drill].name}`))),
    el('article', { class: 'panel guide wide' },
      el('h3', {}, 'Numbers used'),
      el('table', { class: 'numbers' }, NUMBERS.map(([k, v, src]) => el('tr', {},
        el('th', {}, k),
        el('td', {}, v),
        el('td', { class: `src ${src}` }, src === 'wiki' ? 'Wiki / patch notes' : 'Estimate')))),
      el('p', { class: 'muted small' }, 'The estimates describe how StrafeLab simulates movement and input.')),
    el('article', { class: 'panel guide wide' },
      el('h3', {}, 'Playing with friends'),
      el('ul', {},
        el('li', {}, 'One person runs "python server.py". Everyone on the same network opens the LAN address it prints.'),
        el('li', {}, 'Over the internet, forward the port (default 8787) or use a tunnel, and share that address.'),
        el('li', {}, 'Create a party, share the 5-letter code, pick a drill and press Start run. Everyone gets identical target spawns.'))),
  );
}

// ------------------------------------------------------------------ game flow
function startGame(meta, diff, seed, opts) {
  $('results').hidden = true;
  $('app').hidden = true;
  $('game-root').hidden = false;
  game.applySettings(S.settings);
  game.load(meta, diff, seed, opts);
  if (!opts.party) game.requestLock();
}

function startSolo(id, diff) {
  if (S.partyRun) {
    toast('Your party run is in progress');
    return;
  }
  audio.ensure();
  startGame(S.byId[id], diff, (Math.random() * 2 ** 31) >>> 0, { countdown: 3 });
}

function backToMenu() {
  game.stop();
  $('game-root').hidden = true;
  $('results').hidden = true;
  $('app').hidden = false;
  S.partyRun = null;
  renderGrid();
  renderDetail();
  renderParty();
  if (!$('tab-leaderboard').hidden) renderHistory();
}

function onFinish(res) {
  const meta = res.meta;
  const key = `${meta.id}:${res.difficulty}`;
  const prev = personalBest(meta, res.difficulty);
  const pb = !res.dnf && (!prev || better(meta, res.score, prev.score));
  if (!res.dnf) pushHistory(key, { score: res.score, ts: Date.now(), stats: statsObj(res.stats?.slice(0, 3)) });
  S.results = { ...res, pb, prev, rank: null };
  if (res.party) {
    net.send({ t: 'run_result', runId: res.party.runId, score: res.score, display: res.display, stats: statsObj(res.stats), dnf: !!res.dnf });
  }
  if (!res.dnf && net.online) {
    net.send({ t: 'score_submit', scenario: meta.id, difficulty: res.difficulty, score: res.score, display: res.display, stats: statsObj(res.stats) });
    S.results.submitting = true;
  }
  S.lb.delete(`${meta.id}:${res.difficulty}:global`);
  renderResults();
  $('results').hidden = false;
}

function onQuit(wasParty) {
  if (wasParty) net.send({ t: 'run_result', runId: wasParty.runId, dnf: true });
  backToMenu();
}

function renderResults() {
  const r = S.results;
  if (!r) return;
  const meta = r.meta;
  const badges = [];
  if (r.dnf) badges.push(el('span', { class: 'badge bad' }, r.reason === 'timeout' ? 'TIME LIMIT REACHED' : 'NOT COMPLETED'));
  if (r.pb) badges.push(el('span', { class: 'badge good' }, r.prev ? 'NEW PERSONAL BEST' : 'FIRST RUN'));
  else if (r.prev && !r.dnf) badges.push(el('span', { class: 'badge' }, `PB ${fmtScore(meta, r.prev.score)}`));
  if (r.rank) badges.push(el('span', { class: 'badge accent' }, r.improved ? `GLOBAL #${r.rank}` : `YOUR BEST: GLOBAL #${r.rank}`));
  else if (r.submitting) badges.push(el('span', { class: 'badge muted' }, 'Submitting…'));
  const party = r.party
    ? (S.partyResults && S.partyResults.runId === r.party.runId ? partyResultsTable(S.partyResults) : el('p', { class: 'muted' }, 'Waiting for party results…'))
    : null;
  fill($('results-card'),
    el('div', { class: 'res-head' }, el('div', { class: 'scn-cat' }, `${meta.category} · ${DIFF_LABEL[r.difficulty]}${r.party ? ' · Party run' : ''}`), el('h2', {}, meta.name)),
    el('div', { class: 'big-score' }, r.dnf && meta.unit !== 'pts' ? 'DNF' : r.display),
    el('div', { class: 'badges' }, badges),
    el('div', { class: 'stats-grid' }, r.stats.map(([k, v]) => el('div', { class: 'stat' }, el('span', {}, k), el('b', {}, String(v))))),
    party,
    el('div', { class: 'btns' },
      !r.party ? el('button', { class: 'primary', onclick: () => startSolo(meta.id, r.difficulty) }, 'Play again') : null,
      !r.party && !r.dnf ? el('button', { class: 'ghost', onclick: () => {
        backToMenu();
        showProgress(meta.id, r.difficulty);
      } }, 'View progress') : null,
      el('button', { class: r.party ? 'primary' : 'ghost', onclick: backToMenu }, r.party ? 'Back to lobby' : 'Menu')),
  );
}

function partyRows() {
  const run = S.partyRun;
  const meta = S.byId[run.scenario];
  const members = (S.party?.members || []).filter((m) => m.inRun);
  const rows = members.map((m) => {
    const mine = m.id === net.id;
    const live = mine && game.scenario ? { score: game.scenario.score(), display: game.scenario.liveDisplay() } : S.live[m.id];
    return { id: m.id, name: m.name, color: m.color, score: live?.score ?? null, display: live?.display ?? '-' };
  });
  rows.sort((a, b) => (a.score == null ? 1 : b.score == null ? -1 : meta.order === 'asc' ? a.score - b.score : b.score - a.score));
  return rows;
}

// ------------------------------------------------------------------ networking
function wireNet() {
  net.on('status', () => {
    const st = $('net-status');
    st.className = `net ${net.status}`;
    st.textContent = net.status === 'online' ? `online${net.latency != null ? ` · ${net.latency} ms` : ''}` : net.status;
    if (net.status === 'online') {
      S.lb.clear();
      renderDetail();
      if (!$('tab-leaderboard').hidden) {
        requestLb(S.lbScenario, S.lbDiff, S.lbFilter);
        renderLeaderboard();
      }
    }
    renderParty();
  });
  net.on('latency', (ms) => {
    if (net.status === 'online') $('net-status').textContent = `online · ${ms} ms`;
  });
  net.on('error', (m) => toast(m.text, 'bad'));
  net.on('party', (m) => {
    const before = S.party;
    S.party = m.party;
    if (!m.party) {
      S.chat = [];
      S.partyResults = null;
      if (S.lbFilter === 'party') S.lbFilter = 'global';
      if (before && !m.disconnected) toast('You left the party');
    } else if (!before) {
      toast(`Joined party ${m.party.code}`, 'good');
    }
    renderParty();
    renderDetail();
  });
  net.on('chat', (m) => {
    S.chat.push(m);
    S.chat = S.chat.slice(-60);
    renderParty();
  });
  net.on('run_start', (m) => {
    const meta = S.byId[m.scenario];
    if (!meta) return;
    if (game.state !== 'idle' && !S.partyRun) toast('Party run starting: your solo run was stopped');
    S.partyRun = { runId: m.runId, scenario: m.scenario, difficulty: m.difficulty };
    S.live = {};
    S.partyResults = null;
    audio.ensure();
    startGame(meta, m.difficulty, m.seed, { party: { runId: m.runId }, countdown: m.countdown });
  });
  net.on('live', (m) => {
    S.live[m.id] = m;
  });
  net.on('pos', (m) => {
    if (!S.partyRun || !game.scenario?.ghosts) return;
    const mem = S.party?.members.find((x) => x.id === m.id);
    game.ghosts.update(m.id, m.p, mem?.name ?? 'Player', mem?.color ?? '#ffffff');
  });
  net.on('run_results', (m) => {
    S.partyResults = m;
    if (S.results?.party && S.results.party.runId === m.runId) renderResults();
    if (m.final) {
      S.partyRun = null;
      game.ghosts.clear();
    }
    renderParty();
  });
  net.on('lb', (m) => {
    S.lb.set(`${m.scenario}:${m.difficulty}:${m.filter}`, m.entries);
    renderDetail();
    if (!$('tab-leaderboard').hidden) renderLeaderboard();
  });
  net.on('lb_submitted', (m) => {
    if (!S.results) return;
    S.results.submitting = false;
    if (m.rejected) toast('Score was outside the accepted range and was not submitted', 'bad');
    else {
      S.results.rank = m.rank;
      S.results.improved = m.improved;
    }
    if (m.entries) S.lb.set(`${m.scenario}:${m.difficulty}:global`, m.entries);
    renderResults();
  });
  net.connect(() => ({ t: 'hello', name: S.settings.name, cid: S.cid }));

  setInterval(() => {
    if (S.partyRun && game.scenario && game.state !== 'idle') game.hud.party(partyRows(), net.id, S.byId[S.partyRun.scenario].unit === 'pts' ? 'SCORE' : 'TIME');
  }, 250);
}

// ------------------------------------------------------------------ boot
async function init() {
  try {
    const res = await fetch('data/scenarios.json');
    S.meta = await res.json();
  } catch {
    document.body.innerHTML = '<div class="fatal"><h1>StrafeLab</h1><p>Start the server with <code>python server.py</code> and open <code>http://localhost:8787</code>. The game can\'t load when opened as a file.</p></div>';
    return;
  }
  for (const m of S.meta.scenarios) S.byId[m.id] = m;
  saveSettings(S.settings);

  audio = new AudioFX();
  net = new Net();
  game = new Game({ canvas: $('game-canvas'), settings: S.settings, audio, net, debug: DEBUG, onFinish, onQuit });

  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  const name = $('name-input');
  name.value = S.settings.name;
  name.addEventListener('change', () => {
    S.settings.name = name.value.replace(/[^A-Za-z0-9 _\-.]/g, '').slice(0, 16).trim() || S.settings.name;
    name.value = S.settings.name;
    saveSettings(S.settings);
    net.send({ t: 'set_name', name: S.settings.name });
  });

  for (const btn of document.querySelectorAll('#overlay-pause [data-act]')) {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'resume') game.resume();
      if (act === 'restart') game.restart();
      if (act === 'quit') game.quit();
      if (act === 'fullscreen') game.toggleFullscreen();
    });
  }
  // Last line of defence for shortcuts a page can't block outside fullscreen (Ctrl+W, Ctrl+R...):
  // the browser asks before leaving instead of silently dropping the run.
  window.addEventListener('beforeunload', (e) => {
    if (game.inGame()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  // Mouse 4/5 navigate back/forward on release; swallow that right after binding them.
  window.addEventListener('mouseup', (e) => {
    if ((e.button === 3 || e.button === 4) && performance.now() < navBlockUntil) e.preventDefault();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('results').hidden && S.results && !S.results.party) backToMenu();
  });

  renderChips();
  renderGrid();
  renderDetail();
  renderParty();
  renderGuide();
  wireNet();

  if (DEBUG) window.__sl = { game, S, net, startSolo, backToMenu };
}

init();
