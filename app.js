import {
  W,
  H,
  TICK_MS,
  PLAYER_COLORS,
  createRound,
  stepRound,
  pushInput,
  encodeWorld,
  decodeState,
  eliminateActor
} from './sim.js';
import { ArenaRenderer, sideLabel } from './render.js';

const APP_KEY = 'pk_T8xAPJjv8dicMROlW1U3uIBUscIudu3aFvD3';
const ROOM_PREFIX = 'serpent-void-';
const MAX_ACTORS = 8;
const MAX_BOTS = 4;
const COUNTDOWN_MS = 3200;
const OVER_MS = 9000;
const BOT_NAMES = ['BOT BYTE', 'BOT PIXEL', 'BOT GLITCH', 'BOT NOVA', 'BOT HEX', 'BOT ZERO'];
const KEY_DIRS = new Map([
  ['ArrowUp', 0],
  ['KeyW', 0],
  ['w', 0],
  ['ArrowRight', 1],
  ['KeyD', 1],
  ['d', 1],
  ['ArrowDown', 2],
  ['KeyS', 2],
  ['s', 2],
  ['ArrowLeft', 3],
  ['KeyA', 3],
  ['a', 3]
]);

const $ = (id) => document.getElementById(id);
const dom = {
  canvas: $('arena'),
  hostChip: $('host-chip'),
  connChip: $('conn-chip'),
  roundHud: $('round-hud'),
  hudAlive: $('hud-alive'),
  hudTime: $('hud-time'),
  hudVoid: $('hud-void'),
  qrBtn: $('qr-btn'),
  shareBtn: $('share-btn'),
  soundBtn: $('sound-btn'),
  sbAlive: $('sb-alive'),
  boardList: $('board-list'),
  sbTime: $('sb-time'),
  sbVoid: $('sb-void'),
  sbJoin: $('sb-join'),
  sbQrBtn: $('sb-qr-btn'),
  sbQr: $('sb-qr'),
  sbJoinCode: $('sb-join-code'),
  spectate: $('spectate'),
  spectateText: $('spectate-text'),
  countdown: $('countdown'),
  countNum: $('count-num'),
  overlay: $('overlay'),
  ovConnect: $('ov-connect'),
  ovLobby: $('ov-lobby'),
  ovDisplay: $('ov-display'),
  ovOver: $('ov-over'),
  connectMsg: $('connect-msg'),
  connectCode: $('connect-code'),
  retryBtn: $('retry-btn'),
  lobbyQrBtn: $('lobby-qr-btn'),
  lobbyQrShow: $('lobby-qr-show'),
  lobbyQr: $('lobby-qr'),
  lobbyUrl: $('lobby-url'),
  lobbyCode: $('lobby-code'),
  nameInput: $('name-input'),
  readyBtn: $('ready-btn'),
  modeBtn: $('mode-btn'),
  modeNote: $('mode-note'),
  roster: $('roster'),
  rosterCount: $('roster-count'),
  hostControls: $('host-controls'),
  addBotBtn: $('add-bot-btn'),
  startBtn: $('start-btn'),
  lobbyHint: $('lobby-hint'),
  overEyebrow: $('over-eyebrow'),
  overTitle: $('over-title'),
  overSub: $('over-sub'),
  standings: $('standings'),
  rematchBtn: $('rematch-btn'),
  overModeBtn: $('over-mode-btn'),
  overStartBtn: $('over-start-btn'),
  overCount: $('over-count'),
  displayQr: $('display-qr'),
  displayCode: $('display-code'),
  displayCopy: $('display-copy'),
  displayUrl: $('display-url'),
  displayCount: $('display-count'),
  displayRoster: $('display-roster'),
  displayControls: $('display-controls'),
  displayBotBtn: $('display-bot-btn'),
  displayStartBtn: $('display-start-btn'),
  displayModeBtn: $('display-mode-btn'),
  displayHint: $('display-hint'),
  qrModal: $('qr-modal'),
  qrClose: $('qr-close'),
  qrModalCanvas: $('qr-modal-canvas'),
  qrModalCode: $('qr-modal-code'),
  qrModalUrl: $('qr-modal-url'),
  qrCopy: $('qr-copy'),
  toast: $('toast'),
  dpad: $('dpad')
};

const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;

function sanitizeName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14)
    .trim();
}

function defaultName(id) {
  return `SERPENT-${String(Math.abs(Number(id) || 0) % 1000).padStart(3, '0')}`;
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function compareEpoch(a, b) {
  if (!b) return 1;
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] - b[1];
}

function validEpoch(epoch, from) {
  return (
    Array.isArray(epoch) &&
    epoch.length === 2 &&
    Number.isInteger(epoch[0]) &&
    Number.isInteger(epoch[1]) &&
    epoch[1] === from
  );
}

function readRoomCode() {
  const raw = (location.hash || '')
    .replace(/^#\/?/, '')
    .trim()
    .toUpperCase();
  if (/^[A-Z0-9_-]{4,24}$/.test(raw)) return raw;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  history.replaceState(null, '', `#${code}`);
  return code;
}

class Sound {
  constructor() {
    this.enabled = localStorage.getItem('sv-sound') !== 'off';
    this.ctx = null;
  }

  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  blip(freq, dur = 0.08, type = 'sine', gain = 0.035, slide = 0) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const vol = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(30, freq), t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(vol).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    } catch {
      /* no sound is never fatal */
    }
  }

  eat(gold = false) {
    if (gold) {
      this.blip(620, 0.1, 'triangle', 0.05, 200);
      setTimeout(() => this.blip(1020, 0.12, 'triangle', 0.04, 140), 60);
    } else {
      this.blip(500 + Math.random() * 90, 0.07, 'triangle', 0.032, 120);
    }
  }

  power() {
    this.blip(300, 0.12, 'sawtooth', 0.028, 380);
    setTimeout(() => this.blip(760, 0.14, 'triangle', 0.04, 320), 70);
  }

  die() {
    this.blip(170, 0.45, 'sawtooth', 0.05, -120);
    setTimeout(() => this.blip(75, 0.38, 'square', 0.028, -30), 90);
  }

  count(high = false) {
    this.blip(high ? 880 : 440, 0.085, 'square', 0.022, high ? 240 : 0);
  }

  start() {
    this.blip(330, 0.12, 'triangle', 0.04, 220);
    setTimeout(() => this.blip(660, 0.14, 'triangle', 0.045, 220), 100);
    setTimeout(() => this.blip(990, 0.18, 'triangle', 0.045, 180), 200);
  }

  win() {
    [523, 659, 784, 1046].forEach((freq, i) =>
      setTimeout(() => this.blip(freq, 0.17, 'triangle', 0.038), i * 95)
    );
  }

  lose() {
    this.blip(230, 0.28, 'sine', 0.035, -70);
    setTimeout(() => this.blip(150, 0.4, 'sine', 0.03, -40), 140);
  }

  voidTick() {
    this.blip(95, 0.28, 'sine', 0.035, -32);
  }
}

const app = {
  room: null,
  sdkText: null,
  joined: false,
  myId: null,
  roomCode: '',
  myName: '',
  hostId: null,
  epoch: null,
  amHost: false,
  phase: 'connect',
  prevPhase: 'connect',
  state: null,
  roster: new Map(),
  rosterOrder: [],
  lastDir: null,
  inputSeq: 0,
  lastHostAt: 0,
  joinedAt: 0,
  hostLostAt: 0,
  electionTimer: 0,
  lastHelloAt: 0,
  lastBoardAt: 0,
  boardSig: '',
  lastCountdownSec: null,
  error: false,
  errorMessage: '',
  sound: new Sound(),
  toastTimer: 0,
  toastHideTimer: 0,
  nameTimer: 0,
  touch: isTouch()
};

const host = {
  phase: 'lobby',
  epoch: [0, 0],
  players: new Map(),
  sim: null,
  countdownEnd: 0,
  overEnd: 0,
  phaseSince: 0,
  lastBeat: 0,
  lastRoster: 0,
  strictReady: true,
  removals: new Map(),
  botId: -1,
  stateWarned: false
};

const renderer = new ArenaRenderer(dom.canvas, {
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
});

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.remove('hidden');
  requestAnimationFrame(() => dom.toast.classList.add('show'));
  clearTimeout(app.toastTimer);
  clearTimeout(app.toastHideTimer);
  app.toastTimer = setTimeout(() => {
    dom.toast.classList.remove('show');
    app.toastHideTimer = setTimeout(() => dom.toast.classList.add('hidden'), 220);
  }, 2800);
}

function setConnection(text, bad = false, live = false) {
  dom.connChip.textContent = text;
  dom.connChip.classList.toggle('bad', bad);
  dom.connChip.classList.toggle('live', live && !bad);
}

function updateHostChip() {
  dom.hostChip.textContent = app.amHost ? 'HOST' : app.hostId == null ? 'ELECTING' : 'GUEST';
  dom.hostChip.classList.toggle('is-host', app.amHost);
}

let qrModel = null;
let qrUrl = '';

function inviteUrl() {
  return `${location.origin}${location.pathname}#${app.roomCode}`;
}

function updateRoomCodeUI() {
  dom.connectCode.textContent = app.roomCode;
  dom.lobbyCode.textContent = app.roomCode;
  dom.displayCode.textContent = app.roomCode;
  dom.sbJoinCode.textContent = app.roomCode;
  dom.qrModalCode.textContent = app.roomCode;
}

function buildQRCodes() {
  qrUrl = inviteUrl();
  dom.lobbyUrl.textContent = qrUrl;
  dom.lobbyUrl.title = qrUrl;
  dom.displayUrl.textContent = qrUrl;
  dom.displayUrl.title = qrUrl;
  dom.qrModalUrl.textContent = qrUrl;
  if (!window.qrcode) {
    console.warn('QR generator did not load; showing invite links only.');
    return;
  }
  try {
    const model = window.qrcode(0, 'M');
    model.addData(qrUrl);
    model.make();
    qrModel = model;
  } catch (error) {
    console.warn('Could not build the room QR code', error);
    return;
  }
  for (const canvas of [dom.lobbyQr, dom.sbQr, dom.displayQr, dom.qrModalCanvas]) {
    paintQR(canvas, qrModel);
  }
}

function paintQR(canvas, model) {
  if (!canvas || !model) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const count = model.getModuleCount();
  const margin = 4;
  const module = Math.max(2, Math.floor(720 / (count + margin * 2)));
  const size = module * (count + margin * 2);
  canvas.width = size;
  canvas.height = size;
  ctx.fillStyle = '#f1fdff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#06101e';
  const offset = margin * module;
  for (let row = 0; row < count; row++) {
    let start = -1;
    for (let col = 0; col <= count; col++) {
      const dark = col < count && model.isDark(row, col);
      if (dark && start < 0) start = col;
      else if (!dark && start >= 0) {
        ctx.fillRect(offset + start * module, offset + row * module, (col - start) * module, module);
        start = -1;
      }
    }
  }
}

function openQRModal() {
  if (!qrModel) buildQRCodes();
  setHidden(dom.qrModal, false);
  dom.qrClose.focus?.();
}

function closeQRModal() {
  setHidden(dom.qrModal, true);
}

async function copyInvite() {
  const url = inviteUrl();
  try {
    await navigator.clipboard.writeText(url);
    showToast('INVITE LINK COPIED');
  } catch {
    window.prompt('Copy this invite link:', url);
  }
}

function activePlayers() {
  return [...host.players.values()].filter((player) => player.active);
}

function botCount() {
  let count = 0;
  for (const player of host.players.values()) if (player.bot) count++;
  return count;
}

function usedColors() {
  return new Set([...host.players.values()].map((player) => player.color));
}

function nextColor(preferred) {
  const used = usedColors();
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < PLAYER_COLORS.length && !used.has(preferred)) {
    return preferred;
  }
  for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
  return host.players.size % PLAYER_COLORS.length;
}

function ownEntry() {
  return app.roster.get(app.myId) || null;
}

function findActor(state, id) {
  if (!state || !Array.isArray(state.actors)) return null;
  return state.actors.find((actor) => actor.id === id) || null;
}

/* ------------------------------------------------------------------ */
/* Networking: join, host election, state and roster                   */
/* ------------------------------------------------------------------ */

async function boot() {
  app.roomCode = readRoomCode();
  updateRoomCodeUI();
  buildQRCodes();
  const stored = sanitizeName(localStorage.getItem('sv-name'));
  app.myName = stored || defaultName(100 + Math.floor(Math.random() * 900));
  localStorage.setItem('sv-name', app.myName);
  dom.nameInput.value = app.myName;

  wireUI();
  refreshSoundButton();
  updateHostChip();
  refreshPanels();
  setConnection('LINKING', false, false);

  let sdk;
  try {
    sdk = await import('jsflow-sdk');
  } catch (error) {
    console.error(error);
    showJoinError({
      message: 'The jsflow SDK could not be loaded. Check your connection and reload.'
    });
    return;
  }

  try {
    const room = await sdk.join({
      app: APP_KEY,
      room: ROOM_PREFIX + app.roomCode
    });
    app.room = room;
    app.sdkText = sdk.text;
    app.myId = room.id;
    app.joined = true;
    app.joinedAt = performance.now();
    app.lastHostAt = 0;
    renderer.setMyId(room.id);

    room.on('state', (state) => {
      if (state === 'connected') setConnection('LIVE', false, true);
      else if (state === 'joining') setConnection('WAITING', false, false);
      else if (state === 'away') setConnection('PAUSED', true, false);
      else if (state === 'suspended') {
        setConnection('PAUSED', true, false);
        showToast('ARENA PAUSED · PLAN LIMIT REACHED');
      } else {
        setConnection(String(state).toUpperCase(), true, false);
      }
    });

    room.on('peer', onPeer);

    room.on('message', (from, data) => {
      let raw;
      try {
        raw = app.sdkText(data);
      } catch {
        return;
      }
      if (raw.length > 5000) return;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 's') onRemoteState(from, msg);
      else if (msg.t === 'r') onRemoteRoster(from, msg);
      else if (app.amHost) hostOnMessage(from, msg);
    });

    room.on('error', (error) => {
      console.error('jsflow room error', error);
      showToast('ROOM ERROR · RELOAD TO RECONNECT');
      setConnection('ERROR', true, false);
    });

    room.on('evicted', (info) => {
      const until = info && info.until ? new Date(info.until * 1000).toLocaleTimeString() : '';
      showFatal(`THIS PEER WAS REMOVED${until ? ` UNTIL ${until}` : ''}.`);
      setConnection('EVICTED', true, false);
    });

    room.on('suspended', () => {
      setConnection('PAUSED', true, false);
      showToast('ARENA PAUSED · PLAN LIMIT REACHED');
    });

    setConnection('LINKING', false, false);
    dom.connectMsg.textContent = 'Scanning the grid for a host…';
    scheduleElection(2000);
  } catch (error) {
    console.error(error);
    setConnection('OFFLINE', true, false);
    showJoinError(error);
  }
}

function onPeer(id, up) {
  if (up) {
    if (app.amHost) {
      cancelRemoval(id);
      hostEnsurePeer(id);
      hostSendStateTo(id);
      hostPublishRoster();
    } else if (app.hostId === id) {
      sendHello(true);
    } else if (!app.hostId) {
      scheduleElection(1600);
    }
  } else {
    if (app.amHost) hostPeerDown(id);
    if (!app.amHost && app.hostId === id) hostConnectionLost();
  }
}

function scheduleElection(delay) {
  if (app.amHost || app.hostId != null || !app.joined) return;
  clearTimeout(app.electionTimer);
  app.electionTimer = setTimeout(checkElection, delay);
}

function checkElection() {
  app.electionTimer = 0;
  if (app.amHost || app.hostId != null || !app.joined) return;
  const now = performance.now();
  if (app.lastHostAt > 0 && now - app.lastHostAt < 2400) {
    scheduleElection(1600);
    return;
  }
  const peers = app.room ? app.room.peers() : [];
  if (peers.length === 0) {
    becomeHost(!!app.hostLostAt);
    return;
  }
  const lowest = Math.min(app.myId, ...peers);
  if (app.myId === lowest) {
    becomeHost(!!app.hostLostAt);
    return;
  }
  if (app.hostLostAt && now - app.hostLostAt > 6000) {
    becomeHost(true);
    return;
  }
  if (app.joinedAt && now - app.joinedAt > 9000 && !app.hostLostAt) {
    becomeHost(true);
    return;
  }
  scheduleElection(2600);
}

function adoptHost(from, epoch) {
  app.hostId = from;
  app.epoch = epoch;
  app.lastHostAt = performance.now();
  app.hostLostAt = 0;
  clearTimeout(app.electionTimer);
  app.electionTimer = 0;
  updateHostChip();
  if (!app.amHost) sendHello(true);
}

function considerHost(from, epoch) {
  if (!validEpoch(epoch, from)) return false;
  if (app.amHost) {
    if (from === app.myId) return true;
    if (compareEpoch(epoch, host.epoch) > 0) stepDown();
    else return false;
  }
  if (app.hostId == null) {
    adoptHost(from, epoch);
    return true;
  }
  const cmp = compareEpoch(epoch, app.epoch);
  if (cmp > 0) {
    adoptHost(from, epoch);
    return true;
  }
  return from === app.hostId && cmp === 0;
}

function onRemoteState(from, msg) {
  if (!considerHost(from, msg.e)) return;
  const state = decodeState(msg);
  if (!state) return;
  applyState(state, from);
}

function onRemoteRoster(from, msg) {
  if (!considerHost(from, msg.e)) return;
  const data = parseRoster(msg);
  if (!data) return;
  applyRosterData(data);
}

function parseRoster(msg) {
  if (!msg || msg.t !== 'r' || !Array.isArray(msg.p)) return null;
  const map = new Map();
  const order = [];
  for (const entry of msg.p.slice(0, 24)) {
    if (!Array.isArray(entry) || entry.length < 7) continue;
    const [id, name, color, bot, wins, ready, active, spectate] = entry;
    if (!Number.isInteger(id) || !Number.isInteger(color)) continue;
    const safeName = sanitizeName(name) || defaultName(id);
    map.set(id, {
      id,
      name: safeName,
      color: ((color % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length,
      bot: !!bot,
      wins: Number.isFinite(wins) ? Math.max(0, wins | 0) : 0,
      ready: !!ready,
      active: !!active,
      spectate: !!spectate
    });
    order.push(id);
  }
  return { map, order };
}

function sendHello(force = false) {
  if (!app.room || app.amHost || app.hostId == null) return;
  const now = performance.now();
  if (!force && now - app.lastHelloAt < 1200) return;
  app.lastHelloAt = now;
  try {
    void app.room.sendReliable(app.hostId, JSON.stringify({ t: 'h', name: app.myName }));
  } catch {
    /* the next roster or peer-up retries */
  }
  if (app.phase === 'round' && app.lastDir != null) sendInputMsg(app.lastDir);
}

function sendInputMsg(dir, duplicate = true) {
  if (!app.room || app.hostId == null || app.amHost) return;
  const hostId = app.hostId;
  app.inputSeq = (app.inputSeq + 1) % 1000000000;
  const payload = JSON.stringify({ t: 'i', d: dir, q: app.inputSeq });
  try {
    app.room.send(hostId, payload);
  } catch {
    return;
  }
  if (!duplicate) return;
  setTimeout(() => {
    if (!app.room || app.amHost || app.hostId !== hostId) return;
    try {
      app.room.send(hostId, payload);
    } catch {
      /* one copy already left; the heartbeat sends the latest */
    }
  }, 30);
}

function hostConnectionLost() {
  if (app.amHost) return;
  app.hostId = null;
  app.hostLostAt = performance.now();
  app.lastHostAt = 0;
  updateHostChip();
  showToast('HOST CONNECTION LOST · ELECTING');
  scheduleElection(1800);
}

function stepDown() {
  if (!app.amHost) return;
  app.amHost = false;
  app.hostId = null;
  app.epoch = host.epoch;
  app.hostLostAt = performance.now();
  host.sim = null;
  host.players.clear();
  host.phase = 'lobby';
  for (const removal of host.removals.values()) clearTimeout(removal.timer);
  host.removals.clear();
  updateHostChip();
  showToast('NEW HOST ELECTED · ARENA REFORMING');
}

function becomeHost(takeover) {
  if (!app.room || !app.joined || app.amHost) return;
  app.amHost = true;
  app.hostId = app.myId;
  app.hostLostAt = 0;
  app.lastHostAt = performance.now();
  const counter = (app.epoch?.[0] ?? host.epoch[0] ?? 0) + 1;
  host.epoch = [counter, app.myId];
  app.epoch = host.epoch;
  host.phase = 'lobby';
  host.phaseSince = performance.now();
  host.sim = null;
  host.winnerId = 0;
  host.countdownEnd = 0;
  host.overEnd = 0;
  host.lastBeat = 0;
  host.lastRoster = 0;
  host.botId = -1;
  for (const removal of host.removals.values()) clearTimeout(removal.timer);
  host.removals.clear();
  host.players.clear();

  const selfInfo = app.roster.get(app.myId);
  const selfSpectate = !!selfInfo?.spectate;
  host.players.set(app.myId, {
    id: app.myId,
    name: app.myName,
    color: Number.isInteger(selfInfo?.color) ? selfInfo.color : 0,
    bot: false,
    wins: selfInfo?.wins || 0,
    ready: false,
    active: !selfSpectate,
    spectate: selfSpectate,
    lastInputSeq: 0
  });

  let peers = [];
  try {
    peers = app.room.peers().slice().sort((a, b) => a - b);
  } catch {
    peers = [];
  }
  for (const id of peers) {
    if (id === app.myId) continue;
    const info = app.roster.get(id);
    const spectate = !!info?.spectate;
    const active = !spectate && activePlayers().length < MAX_ACTORS;
    host.players.set(id, {
      id,
      name: info?.name || defaultName(id),
      color: nextColor(info?.color),
      bot: false,
      wins: info?.wins || 0,
      ready: false,
      active,
      spectate,
      lastInputSeq: 0
    });
  }
  updateHostChip();
  clearTimeout(app.electionTimer);
  app.electionTimer = 0;
  hostPublishRoster();
  hostPublish(performance.now());
  if (takeover) showToast('YOU ARE HOST · ARENA RESET');
}

/* ------------------------------------------------------------------ */
/* Host simulation and messages                                        */
/* ------------------------------------------------------------------ */

function buildStateObject(now) {
  const base = {
    t: 's',
    e: [host.epoch[0], host.epoch[1]],
    f: 'l',
    n: 0,
    k: 0,
    b: [0, 0, W - 1, H - 1],
    o: '',
    a: [],
    z: null,
    w: 0,
    r: ''
  };
  if (host.phase === 'countdown') {
    base.f = 'c';
    base.n = Math.max(0, host.countdownEnd - now);
  } else if (host.phase === 'round' && host.sim) {
    Object.assign(base, encodeWorld(host.sim, now));
    base.f = 'r';
    base.n = 0;
  } else if (host.phase === 'over' && host.sim) {
    Object.assign(base, encodeWorld(host.sim, now));
    base.f = 'o';
    base.n = Math.max(0, host.overEnd - now);
    base.z = null;
    base.w = host.sim.winnerId || 0;
    base.r = host.sim.reason || '';
  }
  return base;
}

function hostPublish(now = performance.now()) {
  if (!app.amHost) return;
  host.lastBeat = now;
  const object = buildStateObject(now);
  const string = JSON.stringify(object);
  if (string.length > 1040 && !host.stateWarned) {
    host.stateWarned = true;
    console.warn('Serpent Void state exceeded the datagram budget:', string.length);
  }
  try {
    app.room?.broadcast(string);
  } catch {
    /* the next beat retries */
  }
  const decoded = decodeState(object);
  if (decoded) applyState(decoded, app.myId);
}

function hostSendStateTo(peer) {
  if (!app.amHost) return;
  try {
    app.room.send(peer, JSON.stringify(buildStateObject(performance.now())));
  } catch {
    /* heartbeat catches up */
  }
}

function hostRosterData() {
  const map = new Map();
  const order = [];
  for (const player of host.players.values()) {
    map.set(player.id, {
      id: player.id,
      name: player.name,
      color: player.color,
      bot: player.bot,
      wins: player.wins | 0,
      ready: !!player.ready,
      active: !!player.active,
      spectate: !!player.spectate
    });
    order.push(player.id);
  }
  return { map, order };
}

function hostPublishRoster() {
  if (!app.amHost) return;
  const data = hostRosterData();
  const msg = {
    t: 'r',
    e: [host.epoch[0], host.epoch[1]],
    p: data.order.map((id) => {
      const player = data.map.get(id);
      return [
        player.id,
        player.name,
        player.color,
        player.bot ? 1 : 0,
        player.wins,
        player.ready ? 1 : 0,
        player.active ? 1 : 0,
        player.spectate ? 1 : 0
      ];
    })
  };
  const string = JSON.stringify(msg);
  let peers = [];
  try {
    peers = app.room?.peers() || [];
  } catch {
    peers = [];
  }
  for (const peer of peers) {
    try {
      void app.room.sendReliable(peer, string);
    } catch {
      /* the next periodic roster retries */
    }
  }
  applyRosterData(data);
  host.lastRoster = performance.now();
}

function hostOnMessage(from, msg) {
  if (!app.amHost || !msg || typeof msg !== 'object') return;
  if (msg.t === 'h') {
    hostEnsurePeer(from, msg.name);
    const player = host.players.get(from);
    if (player && msg.name) {
      const name = sanitizeName(msg.name);
      if (name && name !== player.name) {
        player.name = name;
        hostPublishRoster();
      }
    }
  } else if (msg.t === 'n') {
    const player = host.players.get(from);
    if (!player) return;
    const name = sanitizeName(msg.name);
    if (name && name !== player.name) {
      player.name = name;
      hostPublishRoster();
    }
  } else if (msg.t === 'ready') {
    if (host.phase !== 'lobby' && host.phase !== 'over') return;
    const player = host.players.get(from);
    if (!player) return;
    player.ready = !!msg.v;
    hostPublishRoster();
  } else if (msg.t === 'spectate') {
    hostSetSpectate(from, !!msg.v);
  } else if (msg.t === 'i') {
    hostOnInput(from, msg.d, msg.q);
  }
}

function hostEnsurePeer(id, name) {
  if (!app.room || id === app.myId) return;
  let player = host.players.get(id);
  if (!player) {
    let active = host.phase === 'lobby' || host.phase === 'over';
    if (active && activePlayers().length >= MAX_ACTORS) {
      const bot = [...host.players.values()].find((entry) => entry.bot && entry.active);
      if (bot) {
        removeBot(bot.id, false);
        active = true;
      } else {
        active = false;
      }
    }
    player = {
      id,
      name: sanitizeName(name) || defaultName(id),
      color: nextColor(),
      bot: false,
      wins: 0,
      ready: false,
      active,
      spectate: false,
      lastInputSeq: 0
    };
    host.players.set(id, player);
    hostPublishRoster();
  } else if (name) {
    const safeName = sanitizeName(name);
    if (safeName && safeName !== player.name) {
      player.name = safeName;
      hostPublishRoster();
    }
  }
  if (!player.active && !player.spectate && host.phase === 'lobby') {
    player.active = activePlayers().length < MAX_ACTORS;
    if (player.active) hostPublishRoster();
  }
}

function hostPeerDown(id) {
  if (!app.amHost) return;
  cancelRemoval(id);
  const timer = setTimeout(() => {
    host.removals.delete(id);
    if (!app.amHost) return;
    const player = host.players.get(id);
    if (!player) return;
    host.players.delete(id);
    if (host.sim) eliminateActor(host.sim, id);
    promoteSpectators();
    hostPublishRoster();
  }, 2500);
  host.removals.set(id, { timer });
}

function cancelRemoval(id) {
  const removal = host.removals.get(id);
  if (!removal) return;
  clearTimeout(removal.timer);
  host.removals.delete(id);
}

function syncDisconnectedActors() {
  if (!host.sim) return;
  let changed = false;
  for (const actor of host.sim.actors) {
    if (!actor.alive) continue;
    if (!host.players.has(actor.id)) {
      eliminateActor(host.sim, actor.id);
      changed = true;
    }
  }
  if (changed) hostPublishRoster();
}

function hostOnInput(id, dir, seq) {
  if (host.phase !== 'round' || !host.sim) return;
  if (!Number.isInteger(dir) || dir < 0 || dir > 3) return;
  const player = host.players.get(id);
  if (player && Number.isInteger(seq) && seq > 0) {
    if (seq <= (player.lastInputSeq || 0)) return;
    player.lastInputSeq = seq;
  }
  const actor = host.sim.actors.find((entry) => entry.id === id);
  if (actor) pushInput(actor, dir);
}

function promoteSpectators() {
  let count = activePlayers().length;
  for (const player of host.players.values()) {
    if (player.active || player.spectate) continue;
    if (count >= MAX_ACTORS) {
      if (player.bot) break;
      const bot = [...host.players.values()].find((entry) => entry.bot && entry.active);
      if (!bot) break;
      host.players.delete(bot.id);
      count--;
    }
    player.active = true;
    count++;
  }
}

function startCountdown(now, strictReady) {
  if (!app.amHost) return;
  if (host.phase !== 'lobby' && host.phase !== 'over') return;
  const players = activePlayers();
  if (players.length < 2) {
    showToast('NEED AT LEAST TWO SERPENTS');
    return;
  }
  if (strictReady && !players.every((player) => player.bot || player.ready)) return;
  host.phase = 'countdown';
  host.strictReady = strictReady;
  host.countdownEnd = now + COUNTDOWN_MS;
  host.phaseSince = now;
  host.lastBeat = 0;
  hostPublish(now);
  hostPublishRoster();
}

function beginRound(now) {
  const players = activePlayers();
  if (players.length < 2) {
    goLobby(now);
    return;
  }
  for (const player of host.players.values()) player.ready = false;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  host.sim = createRound(
    players.map((player) => ({ id: player.id, color: player.color, bot: player.bot })),
    now,
    seed
  );
  host.phase = 'round';
  host.phaseSince = now;
  host.winnerId = 0;
  host.lastBeat = 0;
  hostPublish(now);
  hostPublishRoster();
}

function endRound(now) {
  host.phase = 'over';
  host.phaseSince = now;
  host.overEnd = now + OVER_MS;
  const winnerId = host.sim?.winnerId || 0;
  host.winnerId = winnerId;
  if (winnerId) {
    const player = host.players.get(winnerId);
    if (player) player.wins = Math.max(0, (player.wins | 0) + 1);
  }
  for (const player of host.players.values()) player.ready = false;
  promoteSpectators();
  host.lastBeat = 0;
  hostPublish(now);
  hostPublishRoster();
}

function goLobby(now = performance.now()) {
  if (!app.amHost) return;
  host.phase = 'lobby';
  host.phaseSince = now;
  host.sim = null;
  host.winnerId = 0;
  host.lastBeat = 0;
  promoteSpectators();
  hostPublish(now);
  hostPublishRoster();
}

function maybeAutoStart(now) {
  if (host.phase !== 'lobby' || now - host.phaseSince < 900) return;
  const players = activePlayers();
  if (players.length < 2) return;
  if (!players.some((player) => !player.bot)) return;
  if (!players.every((player) => player.bot || player.ready)) return;
  startCountdown(now, true);
}

function hostTick(now) {
  if (!app.amHost) return;
  if (host.phase === 'lobby') {
    maybeAutoStart(now);
    if (host.phase === 'lobby' && now - host.lastBeat >= 400) hostPublish(now);
  } else if (host.phase === 'countdown') {
    const players = activePlayers();
    const stillReady =
      players.length >= 2 && (!host.strictReady || players.every((player) => player.bot || player.ready));
    if (!stillReady) {
      showToast('COUNTDOWN CANCELLED');
      goLobby(now);
    } else if (now >= host.countdownEnd) {
      beginRound(now);
    } else if (now - host.lastBeat >= 100) {
      hostPublish(now);
    }
  } else if (host.phase === 'round') {
    if (!host.sim) {
      goLobby(now);
      return;
    }
    syncDisconnectedActors();
    stepRound(host.sim, now);
    if (host.sim.ended) endRound(now);
    else hostPublish(now);
  } else if (host.phase === 'over') {
    if (now >= host.overEnd) goLobby(now);
    else if (now - host.lastBeat >= 250) hostPublish(now);
  }
  if (now - host.lastRoster >= 2500) hostPublishRoster();
}

/* ------------------------------------------------------------------ */
/* Host lobby controls                                                 */
/* ------------------------------------------------------------------ */

function toggleReady() {
  const phase = app.state?.phase;
  if (phase !== 'lobby' && phase !== 'over') return;
  const mine = ownEntry();
  const next = !mine?.ready;
  if (app.amHost) {
    const player = host.players.get(app.myId);
    if (!player) return;
    player.ready = next;
    hostPublishRoster();
  } else if (app.hostId != null) {
    try {
      void app.room.sendReliable(app.hostId, JSON.stringify({ t: 'ready', v: next }));
    } catch {
      showToast('COULD NOT REACH THE HOST');
    }
  }
}

function hostSetSpectate(id, spectate) {
  if (!app.amHost) return;
  if (host.phase !== 'lobby' && host.phase !== 'over') return;
  const player = host.players.get(id);
  if (!player || player.bot) return;
  if (spectate) {
    player.spectate = true;
    player.active = false;
    player.ready = false;
  } else {
    player.spectate = false;
    player.ready = false;
    if (!player.active) {
      if (activePlayers().length < MAX_ACTORS) {
        player.active = true;
      } else {
        const bot = [...host.players.values()].find((entry) => entry.bot && entry.active);
        if (bot) {
          host.players.delete(bot.id);
          player.active = true;
        }
      }
    }
  }
  hostPublishRoster();
}

function toggleSpectate() {
  if (app.phase !== 'lobby' && app.phase !== 'over') return;
  const mine = ownEntry();
  if (!mine || app.hostId == null) return;
  const next = !mine.spectate;
  if (app.amHost) {
    hostSetSpectate(app.myId, next);
    if (next) showToast('DISPLAY MODE · SCAN TO JOIN');
  } else {
    try {
      void app.room.sendReliable(app.hostId, JSON.stringify({ t: 'spectate', v: next }));
    } catch {
      showToast('COULD NOT REACH THE HOST');
    }
  }
}

function addBot() {
  if (!app.amHost || host.phase !== 'lobby') return;
  if (activePlayers().length >= MAX_ACTORS) {
    showToast('ARENA FULL · 8 SERPENTS MAX');
    return;
  }
  if (botCount() >= MAX_BOTS) {
    showToast('BOT LIMIT REACHED');
    return;
  }
  let name = null;
  for (const candidate of BOT_NAMES) {
    if (![...host.players.values()].some((player) => player.name === candidate)) {
      name = candidate;
      break;
    }
  }
  const id = host.botId--;
  if (!name) name = `BOT ${Math.abs(id)}`;
  host.players.set(id, {
    id,
    name,
    color: nextColor(),
    bot: true,
    wins: 0,
    ready: true,
    active: true,
    spectate: false,
    lastInputSeq: 0
  });
  hostPublishRoster();
}

function removeBot(id, announce = true) {
  if (!app.amHost) return;
  if (host.phase !== 'lobby') return;
  const player = host.players.get(id);
  if (!player || !player.bot) return;
  host.players.delete(id);
  if (announce) hostPublishRoster();
}

function requestStart(force) {
  if (!app.amHost) return;
  if (host.phase !== 'lobby' && host.phase !== 'over') return;
  startCountdown(performance.now(), !force);
}

function changeName(nextName) {
  const name = sanitizeName(nextName);
  if (!name) return;
  app.myName = name;
  localStorage.setItem('sv-name', name);
  if (app.amHost) {
    const player = host.players.get(app.myId);
    if (player && player.name !== name) {
      player.name = name;
      hostPublishRoster();
    }
  } else if (app.hostId != null) {
    try {
      void app.room.sendReliable(app.hostId, JSON.stringify({ t: 'n', name }));
    } catch {
      /* hello retries with the new name */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Applying state and roster                                           */
/* ------------------------------------------------------------------ */

function applyState(state, from) {
  const prev = app.state;
  const previousPhase = app.prevPhase;
  app.state = state;
  app.phase = state.phase;
  app.prevPhase = state.phase;
  app.lastHostAt = performance.now();
  document.body.classList.toggle('in-round', state.phase === 'round');
  if (!app.amHost && app.hostId == null) adoptHost(from, state.epoch);
  renderer.pushState(state);

  if (previousPhase !== state.phase) {
    refreshPanels();
    updateBoard(true);
    if (state.phase === 'round' && previousPhase !== 'over') showToast('SURVIVE THE VOID');
    if (state.phase === 'over' && previousPhase !== 'over') {
      const winner = state.winner;
      if (winner && winner === app.myId) app.sound.win();
      else if (winner) app.sound.lose();
    }
    if (state.phase === 'countdown') app.lastCountdownSec = null;
  }

  if (state.phase === 'countdown') updateCountdown(state);
  else if (previousPhase === 'countdown' && state.phase === 'round') app.sound.start();
  else app.lastCountdownSec = null;

  if (state.phase === 'over') updateOverCount(state);

  handleOwnEffects(prev, state);
  updateHud(state);
  updateSpectating(state);
  updateReadyButtons();

  const now = performance.now();
  if (now - app.lastBoardAt > 160 || previousPhase !== state.phase) {
    app.lastBoardAt = now;
    updateBoard(previousPhase !== state.phase);
  }
  if (state.phase === 'lobby') {
    if (app.amHost && selfSpectating()) renderDisplay();
    else renderLobby();
  }
  if (state.phase === 'over') renderOver();
  updateModeUI();
  updateSbJoin();
}

function applyRosterData(data) {
  app.roster = data.map;
  app.rosterOrder = data.order;
  renderer.setRoster(app.roster);
  refreshPanels();
  updateBoard(true);
  updateReadyButtons();
  if (!app.amHost && app.hostId != null) {
    const mine = app.roster.get(app.myId);
    if (!mine || mine.name !== app.myName) sendHello();
  }
}

function updateCountdown(state) {
  const seconds = Math.max(1, Math.ceil(state.timer / 1000));
  if (seconds === app.lastCountdownSec) return;
  app.lastCountdownSec = seconds;
  dom.countNum.textContent = String(seconds);
  dom.countNum.style.animation = 'none';
  void dom.countNum.offsetWidth;
  dom.countNum.style.animation = '';
  app.sound.count(seconds <= 1);
}

function handleOwnEffects(prev, state) {
  const before = findActor(prev, app.myId);
  const after = findActor(state, app.myId);
  if (after) {
    if (before && before.alive && !after.alive) {
      app.sound.die();
      showToast('CONSUMED BY THE VOID · SPECTATING');
    }
    const delta = (after.score || 0) - (before?.score || 0);
    if (delta > 0) {
      const newPower = (after.ghost && !before?.ghost) || (after.frenzy && !before?.frenzy);
      if (newPower) app.sound.power();
      else app.sound.eat(delta >= 5);
    }
  }
  if (
    prev &&
    state.phase === 'round' &&
    (prev.bounds.x0 !== state.bounds.x0 ||
      prev.bounds.y0 !== state.bounds.y0 ||
      prev.bounds.x1 !== state.bounds.x1 ||
      prev.bounds.y1 !== state.bounds.y1)
  ) {
    app.sound.voidTick();
  }
}

/* ------------------------------------------------------------------ */
/* Panels, HUD and scoreboard                                          */
/* ------------------------------------------------------------------ */

function setHidden(element, hidden) {
  element.classList.toggle('hidden', hidden);
}

function refreshPanels() {
  const phase = app.state?.phase;
  const connectVisible = app.error || !app.state;
  const displayLobby = !connectVisible && phase === 'lobby' && app.amHost && selfSpectating();
  setHidden(dom.ovConnect, !connectVisible);
  setHidden(dom.ovLobby, connectVisible || phase !== 'lobby' || displayLobby);
  setHidden(dom.ovDisplay, !displayLobby);
  setHidden(dom.ovOver, connectVisible || phase !== 'over');
  const hideOverlay = !connectVisible && (phase === 'round' || phase === 'countdown');
  setHidden(dom.overlay, hideOverlay);
  setHidden(dom.countdown, phase !== 'countdown');
  setHidden(dom.roundHud, phase !== 'round');
  if (connectVisible) {
    dom.connectMsg.textContent = app.error
      ? app.errorMessage
      : 'Scanning the grid for a host…';
    dom.retryBtn.classList.toggle('hidden', !app.error);
  }
  if (phase === 'lobby') {
    if (displayLobby) renderDisplay();
    else renderLobby();
  }
  if (phase === 'over') renderOver();
  updateModeUI();
  updateSbJoin();
}

function showFatal(message) {
  app.error = true;
  app.errorMessage = message;
  app.state = null;
  app.amHost = false;
  document.body.classList.remove('in-round');
  setHidden(dom.spectate, true);
  setHidden(dom.dpad, true);
  refreshPanels();
  updateHostChip();
}

function showJoinError(error) {
  const code = error && error.code ? String(error.code) : '';
  let message = error && error.message ? String(error.message) : 'Could not enter the arena.';
  if (code === 'origin') {
    message =
      'This page origin is not allowed by the app. Serve it from an allowed origin (for example http://localhost:8090) and check its origins in the jsflow dashboard.';
  } else if (code === 'unsupported_browser') {
    message = 'This browser is too old. Use Chrome or Edge 137+, Safari 17+ or Firefox 130+.';
  } else if (code === 'unknown_app') {
    message = 'The jsflow app key was not recognised.';
  } else if (code === 'room_full' || code === 'too_many_rooms') {
    message = 'The arena is full. Try again or share a different room code.';
  } else if (code === 'rate') {
    message = 'Too many joins right now. Wait a moment and retry.';
  } else if (code) {
    message = `${message} (${code})`;
  }
  app.error = true;
  app.errorMessage = message;
  refreshPanels();
  setConnection('OFFLINE', true, false);
}

function updateHud(state) {
  const phase = state.phase;
  const alive = (state.actors || []).filter((actor) => actor.alive).length;
  const active = [...app.roster.values()].filter((player) => player.active).length;
  const ready = [...app.roster.values()].filter((player) => player.active && player.ready).length;
  const time = formatClock((state.tick || 0) * TICK_MS);
  const voidText =
    phase === 'round' && state.shrink
      ? `VOID ${sideLabel(state.shrink.side)} ${formatClock(state.shrink.ms)}`
      : 'VOID —';

  if (phase === 'round' || phase === 'over') {
    dom.sbAlive.textContent = `${alive} ALIVE`;
    dom.hudAlive.textContent = `${alive} ALIVE`;
  } else {
    dom.sbAlive.textContent = `${active}/${MAX_ACTORS} ACTIVE`;
    dom.hudAlive.textContent = `${active} ACTIVE`;
  }
  dom.hudTime.textContent = time;
  dom.hudVoid.textContent = voidText;
  dom.sbTime.textContent =
    phase === 'round' ? time : phase === 'over' ? 'ROUND OVER' : phase === 'countdown' ? 'ARMING' : 'LOBBY';
  dom.sbVoid.textContent =
    phase === 'round' ? voidText : phase === 'over' ? 'RESULTS' : phase === 'countdown' ? 'HOLD' : `${ready} READY`;
  dom.roundHud.classList.toggle('hidden', phase !== 'round');
}

function updateBoard(force = false) {
  const state = app.state;
  if (!state) return;
  const phase = state.phase;
  const signature =
    phase === 'round' || phase === 'over'
      ? phase +
        '|' +
        state.actors
          .map((actor) => `${actor.id}:${actor.alive ? 1 : 0}:${actor.score}`)
          .join(',') +
        '|' +
        app.rosterOrder.join(',')
      : phase + '|' + app.rosterOrder.map((id) => {
          const player = app.roster.get(id);
          return `${id}:${player?.ready ? 1 : 0}:${player?.active ? 1 : 0}:${player?.spectate ? 1 : 0}`;
        }).join(',') +
        '|' +
        app.rosterOrder.join(',');
  if (!force && signature === app.boardSig) return;
  app.boardSig = signature;

  const fragment = document.createDocumentFragment();
  if (phase === 'round' || phase === 'over') {
    const rows = [...state.actors].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return app.rosterOrder.indexOf(a.id) - app.rosterOrder.indexOf(b.id);
    });
    for (const actor of rows) {
      const info = app.roster.get(actor.id);
      const li = document.createElement('li');
      li.className = 'board-row';
      if (actor.id === app.myId) li.classList.add('me');
      if (!actor.alive) li.classList.add('out');
      li.style.setProperty('--c', PLAYER_COLORS[actor.color % PLAYER_COLORS.length]);
      const dot = document.createElement('span');
      dot.className = 'bdot';
      const name = document.createElement('span');
      name.className = 'bname';
      name.textContent = info?.name || defaultName(actor.id);
      if (info?.bot) {
        const tag = document.createElement('span');
        tag.className = 'btag';
        tag.textContent = 'BOT';
        name.appendChild(tag);
      }
      const score = document.createElement('span');
      score.className = 'bscore';
      score.textContent = String(actor.score);
      const wins = document.createElement('span');
      wins.className = 'bwins';
      wins.textContent = info?.wins ? `W${info.wins}` : '';
      li.append(dot, name, score, wins);
      fragment.appendChild(li);
    }
  } else {
    for (const id of app.rosterOrder) {
      const player = app.roster.get(id);
      if (!player) continue;
      const li = document.createElement('li');
      li.className = 'board-row';
      if (id === app.myId) li.classList.add('me');
      li.style.setProperty('--c', PLAYER_COLORS[player.color % PLAYER_COLORS.length]);
      const dot = document.createElement('span');
      dot.className = 'bdot';
      const name = document.createElement('span');
      name.className = 'bname';
      name.textContent = player.name;
      if (player.bot) {
        const tag = document.createElement('span');
        tag.className = 'btag';
        tag.textContent = 'BOT';
        name.appendChild(tag);
      }
      const stateCell = document.createElement('span');
      stateCell.className = 'bscore';
      stateCell.textContent = !player.active ? (player.spectate ? 'WATCH' : 'SPEC') : player.ready ? 'RDY' : '—';
      if (player.ready) stateCell.style.color = 'var(--lime)';
      const wins = document.createElement('span');
      wins.className = 'bwins';
      wins.textContent = player.wins ? `W${player.wins}` : '';
      li.append(dot, name, stateCell, wins);
      fragment.appendChild(li);
    }
  }
  dom.boardList.replaceChildren(fragment);
}

function renderLobby() {
  if (!app.state || app.state.phase !== 'lobby') return;
  const fragment = document.createDocumentFragment();
  for (const id of app.rosterOrder) {
    const player = app.roster.get(id);
    if (!player) continue;
    const li = document.createElement('li');
    if (app.amHost && player.bot && id < 0) li.classList.add('has-remove');
    const dot = document.createElement('span');
    dot.className = 'rdot';
    dot.style.setProperty('--c', PLAYER_COLORS[player.color % PLAYER_COLORS.length]);
    const name = document.createElement('span');
    name.className = 'rname';
    name.textContent = player.name;
    const tags = document.createElement('span');
    tags.className = 'rtags';
    if (id === app.hostId) {
      const tag = document.createElement('span');
      tag.className = 'rtag';
      tag.textContent = 'HOST';
      tags.appendChild(tag);
    }
    if (id === app.myId) {
      const tag = document.createElement('span');
      tag.className = 'rtag';
      tag.style.color = 'var(--cyan)';
      tag.style.borderColor = 'rgba(93,242,255,.3)';
      tag.textContent = 'YOU';
      tags.appendChild(tag);
    }
    if (player.bot) {
      const tag = document.createElement('span');
      tag.className = 'rtag bot';
      tag.textContent = 'BOT';
      tags.appendChild(tag);
    }
    const state = document.createElement('span');
    state.className = 'rstate';
    if (!player.active) {
      state.textContent = player.spectate ? 'WATCHING' : 'SPECTATOR';
      state.classList.add('out');
    } else if (player.ready) {
      state.textContent = 'READY';
      state.classList.add('on');
    } else {
      state.textContent = '—';
    }
    li.append(dot, name, tags, state);
    if (li.classList.contains('has-remove')) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'rremove';
      remove.textContent = '×';
      remove.title = 'Remove bot';
      remove.dataset.botRemove = String(id);
      li.appendChild(remove);
    }
    fragment.appendChild(li);
  }
  dom.roster.replaceChildren(fragment);

  const players = [...app.roster.values()];
  const active = players.filter((player) => player.active);
  const ready = active.filter((player) => player.ready);
  const bots = players.filter((player) => player.bot && player.active);
  dom.rosterCount.textContent = `${active.length}/${MAX_ACTORS} ACTIVE`;

  setHidden(dom.hostControls, !app.amHost);
  dom.addBotBtn.disabled = active.length >= MAX_ACTORS || bots.length >= MAX_BOTS;
  dom.startBtn.disabled = active.length < 2;
  dom.addBotBtn.textContent = bots.length >= MAX_BOTS ? 'BOT LIMIT' : '+ ADD BOT';

  const hostPlayer = app.roster.get(app.hostId);
  const mine = app.roster.get(app.myId);
  if (mine?.spectate && !app.amHost) {
    dom.lobbyHint.textContent = 'You are spectating. Use JOIN AS PLAYER to take a slot next round.';
  } else if (mine && !mine.active && !app.amHost) {
    dom.lobbyHint.textContent = 'Arena full — you will be seated when a slot frees.';
  } else if (app.amHost) {
    if (active.length === 0) dom.lobbyHint.textContent = 'Add bots or share the link. Two serpents start the round.';
    else if (ready.length === active.length && active.length >= 2)
      dom.lobbyHint.textContent = 'All serpents ready — the countdown starts automatically.';
    else dom.lobbyHint.textContent = `Host controls: ready up, add bots, or start now. ${active.length}/8 active.`;
  } else if (!app.hostId) {
    dom.lobbyHint.textContent = 'Waiting for the room to elect a host…';
  } else if (active.length < 2) {
    dom.lobbyHint.textContent = `Waiting for rivals. Host: ${hostPlayer?.name || 'unknown'} · share the link.`;
  } else {
    dom.lobbyHint.textContent = `Host: ${hostPlayer?.name || 'unknown'} · ready up. ${ready.length}/${active.length} ready.`;
  }
  updateReadyButtons();
}

function renderDisplay() {
  if (!app.state || app.state.phase !== 'lobby') return;
  const fragment = document.createDocumentFragment();
  const active = [];
  for (const id of app.rosterOrder) {
    const player = app.roster.get(id);
    if (!player || !player.active) continue;
    active.push(player);
    const li = document.createElement('li');
    li.className = 'display-row';
    const dot = document.createElement('span');
    dot.className = 'ddot';
    dot.style.setProperty('--c', PLAYER_COLORS[player.color % PLAYER_COLORS.length]);
    const name = document.createElement('span');
    name.className = 'dname';
    name.textContent = player.name;
    if (player.bot) {
      const tag = document.createElement('span');
      tag.className = 'btag';
      tag.textContent = 'BOT';
      name.appendChild(tag);
    }
    const state = document.createElement('span');
    state.className = 'dstate';
    state.textContent = player.ready ? 'READY' : 'WAITING';
    if (player.ready) state.classList.add('on');
    li.append(dot, name, state);
    fragment.appendChild(li);
  }
  if (active.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'display-row';
    empty.style.gridTemplateColumns = '1fr';
    const text = document.createElement('span');
    text.className = 'dname';
    text.textContent = 'No serpents yet — the QR code is the door.';
    empty.appendChild(text);
    fragment.appendChild(empty);
  }
  dom.displayRoster.replaceChildren(fragment);
  dom.displayCount.textContent = `${active.length}/${MAX_ACTORS}`;

  const ready = active.filter((player) => player.ready);
  const bots = active.filter((player) => player.bot);
  const humanReady = ready.some((player) => !player.bot);
  setHidden(dom.displayControls, !app.amHost);
  dom.displayBotBtn.disabled = active.length >= MAX_ACTORS || bots.length >= MAX_BOTS;
  dom.displayBotBtn.textContent = bots.length >= MAX_BOTS ? 'BOT LIMIT' : '+ ADD BOT';
  dom.displayStartBtn.disabled = active.length < 2;
  if (!app.amHost) {
    const hostPlayer = app.roster.get(app.hostId);
    dom.displayHint.textContent = `Host: ${hostPlayer?.name || 'unknown'} · waiting for the start.`;
  } else if (active.length < 2) {
    dom.displayHint.textContent = 'Scan the QR — two serpents are needed to open the arena.';
  } else if (!humanReady) {
    dom.displayHint.textContent = 'Scan the QR — waiting for a phone to ready up, or press START.';
  } else if (ready.length === active.length) {
    dom.displayHint.textContent = 'All serpents ready — the arena opens automatically.';
  } else {
    dom.displayHint.textContent = `Ready up on the phones · ${ready.length}/${active.length} ready.`;
  }
  updateModeUI();
}


function renderOver() {
  const state = app.state;
  if (!state || state.phase !== 'over') return;
  const winnerActor = (state.actors || []).find((actor) => actor.id === state.winner) || null;
  const winnerInfo = winnerActor ? app.roster.get(winnerActor.id) : null;
  const winnerColor = winnerActor
    ? PLAYER_COLORS[winnerActor.color % PLAYER_COLORS.length]
    : '#5df2ff';
  dom.overTitle.style.setProperty('--win', winnerColor);

  if (winnerActor) {
    const name = winnerInfo?.name || defaultName(winnerActor.id);
    dom.overTitle.textContent = state.reason === 'time' ? `${name} TAKES IT` : `${name} SURVIVES`;
    dom.overEyebrow.textContent =
      state.reason === 'time'
        ? 'ROUND COMPLETE · TIME'
        : state.reason === 'wipe'
          ? 'ROUND COMPLETE · WIPEOUT'
          : 'ROUND COMPLETE · LAST SERPENT';
    dom.overSub.textContent =
      state.reason === 'time'
        ? `${name} had the highest score when time ran out.`
        : `${name} outlasted the collapsing grid.`;
  } else {
    dom.overTitle.textContent = 'THE VOID WINS';
    dom.overEyebrow.textContent = 'ROUND COMPLETE · WIPEOUT';
    dom.overSub.textContent = 'No serpent made it out of the grid.';
  }

  const rows = [...(state.actors || [])].sort((a, b) => {
    if (a.id === state.winner) return -1;
    if (b.id === state.winner) return 1;
    if (b.score !== a.score) return b.score - a.score;
    return app.rosterOrder.indexOf(a.id) - app.rosterOrder.indexOf(b.id);
  });
  const fragment = document.createDocumentFragment();
  rows.forEach((actor, index) => {
    const info = app.roster.get(actor.id);
    const row = document.createElement('div');
    row.className = 'standing';
    if (actor.id === state.winner) row.classList.add('winner');
    if (actor.id === app.myId) row.classList.add('me');
    row.style.setProperty('--c', PLAYER_COLORS[actor.color % PLAYER_COLORS.length]);
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const dot = document.createElement('span');
    dot.className = 'sdot';
    const name = document.createElement('span');
    name.className = 'sname';
    name.textContent = info?.name || defaultName(actor.id);
    if (info?.bot) {
      const tag = document.createElement('span');
      tag.className = 'btag';
      tag.textContent = 'BOT';
      name.appendChild(tag);
    }
    const points = document.createElement('span');
    points.className = 'spts';
    points.textContent = String(actor.score);
    const wins = document.createElement('span');
    wins.className = 'swins';
    wins.textContent = info?.wins ? `W${info.wins}` : '';
    row.append(rank, dot, name, points, wins);
    fragment.appendChild(row);
  });
  dom.standings.replaceChildren(fragment);
  dom.overStartBtn.classList.toggle('hidden', !app.amHost);
  dom.overStartBtn.disabled = activePlayers().length < 2 && app.amHost;
  updateOverCount(state);
  updateReadyButtons();
}

function updateOverCount(state) {
  dom.overCount.textContent = String(Math.max(0, Math.ceil(state.timer / 1000)));
}

function selfSpectating() {
  return !!ownEntry()?.spectate;
}

function updateReadyButtons() {
  const phase = app.phase;
  const canReady = phase === 'lobby' || phase === 'over';
  const mine = ownEntry();
  const ready = !!mine?.ready;
  const playable = !!mine && mine.active && !mine.spectate;
  dom.readyBtn.textContent = !mine
    ? 'READY UP'
    : mine.spectate
      ? 'SPECTATING'
      : !mine.active
        ? 'WAITING'
        : ready
          ? 'CANCEL READY'
          : 'READY UP';
  dom.readyBtn.classList.toggle('is-ready', ready && playable);
  dom.readyBtn.disabled = !canReady || !playable || app.hostId == null;
  dom.rematchBtn.textContent = !mine
    ? 'READY FOR REMATCH'
    : mine.spectate
      ? 'SPECTATING'
      : !mine.active
        ? 'WAITING'
        : ready
          ? 'CANCEL READY'
          : 'READY FOR REMATCH';
  dom.rematchBtn.classList.toggle('is-ready', ready && playable);
  dom.rematchBtn.disabled = !canReady || !playable;
  updateModeUI();
}

function updateModeUI() {
  const mine = ownEntry();
  const canToggle =
    !!mine && app.hostId != null && (app.phase === 'lobby' || app.phase === 'over');
  const label = mine?.spectate ? 'JOIN AS PLAYER' : app.amHost ? 'DISPLAY MODE' : 'SPECTATE';
  for (const button of [dom.modeBtn, dom.overModeBtn, dom.displayModeBtn]) {
    if (!button) continue;
    button.textContent = label;
    button.disabled = !canToggle;
  }
  let note = 'Watch the arena without taking a player slot.';
  if (!mine) note = 'Waiting for the host…';
  else if (mine.spectate) note = 'You are watching. Join as a player whenever a slot is free.';
  else if (!mine.active) note = 'Arena full — you will join when a slot frees.';
  else if (app.amHost) note = 'Host a big-screen display: show the join QR without taking a player slot.';
  if (dom.modeNote) {
    dom.modeNote.textContent = note;
    dom.modeNote.classList.toggle('is-watching', !!mine?.spectate);
  }
  updateSbJoin();
}

function updateSbJoin() {
  const show =
    app.amHost &&
    selfSpectating() &&
    (app.phase === 'countdown' || app.phase === 'round' || app.phase === 'over');
  setHidden(dom.sbJoin, !show);
}

function updateSpectating(state) {
  let text = '';
  if (state.phase === 'round') {
    const me = findActor(state, app.myId);
    const entry = ownEntry();
    if (!me) {
      if (app.amHost && entry?.spectate) text = 'DISPLAY MODE · WATCHING';
      else if (entry?.spectate) text = 'SPECTATING';
      else if (entry && entry.active === false) text = 'SPECTATING · JOINS NEXT ROUND';
      else text = 'SYNCING WITH HOST';
    } else if (!me.alive) {
      text = 'CONSUMED · SPECTATING';
    }
  }
  setHidden(dom.spectate, !text);
  if (text) dom.spectateText.textContent = text;
  const me = findActor(state, app.myId);
  const showDpad = app.touch && state.phase === 'round' && !!me && me.alive;
  setHidden(dom.dpad, !showDpad);
}

function refreshSoundButton() {
  dom.soundBtn.textContent = app.sound.enabled ? 'SOUND ON' : 'SOUND OFF';
  dom.soundBtn.setAttribute('aria-pressed', String(app.sound.enabled));
}

/* ------------------------------------------------------------------ */
/* Local input                                                         */
/* ------------------------------------------------------------------ */

function tryTurn(dir) {
  if (!Number.isInteger(dir) || dir < 0 || dir > 3) return;
  app.lastDir = dir;
  const state = app.state;
  if (!state || state.phase !== 'round') return;
  const me = findActor(state, app.myId);
  if (!me || !me.alive) return;
  let delivered = false;
  if (app.amHost) {
    hostOnInput(app.myId, dir);
    delivered = true;
  } else if (app.hostId != null) {
    sendInputMsg(dir);
    delivered = true;
  }
  if (delivered) renderer.setLocalIntent(dir);
}

function wireUI() {
  dom.readyBtn.addEventListener('click', toggleReady);
  dom.rematchBtn.addEventListener('click', toggleReady);
  dom.addBotBtn.addEventListener('click', addBot);
  dom.startBtn.addEventListener('click', () => requestStart(true));
  dom.displayStartBtn.addEventListener('click', () => requestStart(true));
  dom.overStartBtn.addEventListener('click', () => requestStart(true));
  dom.displayBotBtn.addEventListener('click', addBot);
  dom.shareBtn.addEventListener('click', copyInvite);
  dom.qrBtn.addEventListener('click', openQRModal);
  dom.lobbyQrBtn.addEventListener('click', openQRModal);
  dom.lobbyQrShow.addEventListener('click', openQRModal);
  dom.sbQrBtn.addEventListener('click', openQRModal);
  dom.displayCopy.addEventListener('click', copyInvite);
  dom.displayCode.addEventListener('click', copyInvite);
  dom.qrCopy.addEventListener('click', copyInvite);
  dom.qrClose.addEventListener('click', closeQRModal);
  dom.qrModal.addEventListener('click', (event) => {
    if (event.target === dom.qrModal) closeQRModal();
  });
  dom.connectCode.addEventListener('click', copyInvite);
  dom.lobbyCode.addEventListener('click', copyInvite);
  dom.retryBtn.addEventListener('click', () => location.reload());
  dom.modeBtn.addEventListener('click', toggleSpectate);
  dom.overModeBtn.addEventListener('click', toggleSpectate);
  dom.displayModeBtn.addEventListener('click', toggleSpectate);

  dom.soundBtn.addEventListener('click', () => {
    app.sound.enabled = !app.sound.enabled;
    localStorage.setItem('sv-sound', app.sound.enabled ? 'on' : 'off');
    refreshSoundButton();
    if (app.sound.enabled) {
      app.sound.unlock();
      app.sound.blip(660, 0.08, 'triangle', 0.03);
    }
  });

  dom.roster.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-bot-remove]');
    if (!button) return;
    const id = Number(button.dataset.botRemove);
    if (Number.isFinite(id)) removeBot(id);
  });

  dom.nameInput.addEventListener('input', () => {
    const name = sanitizeName(dom.nameInput.value);
    if (name) {
      app.myName = name;
      localStorage.setItem('sv-name', name);
    }
    clearTimeout(app.nameTimer);
    app.nameTimer = setTimeout(() => changeName(dom.nameInput.value), 300);
  });
  dom.nameInput.addEventListener('blur', () => {
    const name = sanitizeName(dom.nameInput.value) || app.myName || defaultName(app.myId);
    dom.nameInput.value = name;
    changeName(name);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.qrModal.classList.contains('hidden')) {
      closeQRModal();
      return;
    }
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (event.key === 'Enter') {
        event.preventDefault();
        dom.nameInput.blur();
      }
      return;
    }
    if (tag === 'BUTTON' && event.key === 'Enter') return;
    const dir = KEY_DIRS.get(event.code) ?? KEY_DIRS.get(event.key);
    if (dir !== undefined) {
      event.preventDefault();
      tryTurn(dir);
      return;
    }
    if (event.key === 'Enter' && (app.phase === 'lobby' || app.phase === 'over')) {
      event.preventDefault();
      toggleReady();
    }
  });

  const dpad = dom.dpad;
  dpad.addEventListener('pointerdown', (event) => {
    const button = event.target.closest?.('[data-dir]');
    if (!button) return;
    event.preventDefault();
    tryTurn(Number(button.dataset.dir));
  });

  let touchStart = null;
  dom.canvas.addEventListener('pointerdown', (event) => {
    app.sound.unlock();
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    touchStart = { x: event.clientX, y: event.clientY };
  });
  dom.canvas.addEventListener('pointerup', (event) => {
    if (!touchStart) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
    if (Math.abs(dx) > Math.abs(dy)) tryTurn(dx > 0 ? 1 : 3);
    else tryTurn(dy > 0 ? 2 : 0);
  });
  dom.canvas.addEventListener('pointercancel', () => {
    touchStart = null;
  });

  window.addEventListener('pointerdown', () => app.sound.unlock(), { once: true });
  window.addEventListener('keydown', () => app.sound.unlock(), { once: true });

  setInterval(() => {
    if (!app.joined) return;
    if (!app.amHost && app.hostId != null && performance.now() - app.lastHostAt > 4300) {
      hostConnectionLost();
      return;
    }
    if (app.amHost) hostTick(performance.now());
    else if (!app.hostId) {
      if (!app.electionTimer) scheduleElection(1200);
    }
    if (!app.amHost && app.hostId != null && app.state?.phase === 'round' && app.lastDir != null) {
      const me = findActor(app.state, app.myId);
      if (me && me.alive) sendInputMsg(app.lastDir, false);
    }
  }, TICK_MS);

  setInterval(() => {
    if (app.amHost || app.hostId == null) return;
    const mine = app.roster.get(app.myId);
    if (!mine || mine.name !== app.myName) sendHello();
  }, 3400);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.sound.enabled) app.sound.unlock();
  });
}

if (new URLSearchParams(location.search).has('debug')) {
  window.__serpent = { app, host, renderer };
}

boot().catch((error) => {
  console.error(error);
  showJoinError({ message: error?.message || 'Unexpected failure while opening the arena.' });
});

