export const W = 40;
export const H = 28;
export const TICK_MS = 100;
export const MIN_BODY = 5;
export const MAX_BODY = 36;
export const ROUND_MAX_MS = 120000;

export const PLAYER_COLORS = [
  '#5df2ff',
  '#ff5d8f',
  '#b8ff5d',
  '#ffd25d',
  '#b28dff',
  '#ff8a3d',
  '#5dffc0',
  '#ff5df2'
];

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const cellX = (cell) => cell % W;
export const cellY = (cell) => (cell / W) | 0;
export const cellIndex = (x, y) => y * W + x;
export const opposite = (dir) => (dir + 2) & 3;

function insideBounds(bounds, cell) {
  const x = cellX(cell);
  const y = cellY(cell);
  return x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function packCell(cell) {
  return B64[(cell >> 6) & 63] + B64[cell & 63];
}

function unpackCell(str, offset = 0) {
  const hi = B64.indexOf(str[offset]);
  const lo = B64.indexOf(str[offset + 1]);
  if (hi < 0 || lo < 0) return -1;
  const cell = (hi << 6) | lo;
  return cell >= 0 && cell < W * H ? cell : -1;
}

export function packBody(cells) {
  if (!Array.isArray(cells) || cells.length === 0) return 'AA';
  let out = packCell(cells[0]);
  let bits = '';
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1];
    const b = cells[i];
    const dx = cellX(b) - cellX(a);
    const dy = cellY(b) - cellY(a);
    let dir = -1;
    if (dx === 1 && dy === 0) dir = 1;
    else if (dx === -1 && dy === 0) dir = 3;
    else if (dx === 0 && dy === 1) dir = 2;
    else if (dx === 0 && dy === -1) dir = 0;
    if (dir < 0) return out;
    bits += dir.toString(2).padStart(2, '0');
  }
  while (bits.length % 6 !== 0) bits += '00';
  for (let i = 0; i < bits.length; i += 6) {
    out += B64[parseInt(bits.slice(i, i + 6), 2)];
  }
  return out;
}

export function unpackBody(str, length) {
  if (typeof str !== 'string' || str.length < 2) return [];
  if (!Number.isInteger(length) || length < 1) return [];
  const head = unpackCell(str, 0);
  if (head < 0) return [];
  const cells = [head];
  for (let i = 0; i < length - 1; i++) {
    const charAt = 2 + Math.floor(i / 3);
    if (charAt >= str.length) break;
    const packed = B64.indexOf(str[charAt]);
    if (packed < 0) break;
    const dir = (packed >> (4 - (i % 3) * 2)) & 3;
    const prev = cells[cells.length - 1];
    const x = cellX(prev) + DX[dir];
    const y = cellY(prev) + DY[dir];
    if (x < 0 || x >= W || y < 0 || y >= H) break;
    cells.push(cellIndex(x, y));
  }
  return cells;
}

function blockedCells(sim) {
  const blocked = new Set();
  for (const actor of sim.actors) {
    if (!actor.alive) continue;
    for (const cell of actor.body) blocked.add(cell);
  }
  for (const cell of sim.foods.keys()) blocked.add(cell);
  for (const cell of sim.powerups.keys()) blocked.add(cell);
  return blocked;
}

function pickFreeCell(sim, blocked) {
  const b = sim.bounds;
  const width = b.x1 - b.x0 + 1;
  const height = b.y1 - b.y0 + 1;
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = b.x0 + Math.floor(sim.random() * width);
    const y = b.y0 + Math.floor(sim.random() * height);
    const cell = cellIndex(x, y);
    if (!blocked.has(cell)) return cell;
  }
  const start = Math.floor(sim.random() * W * H);
  for (let i = 0; i < W * H; i++) {
    const cell = (start + i) % (W * H);
    const x = cellX(cell);
    const y = cellY(cell);
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && !blocked.has(cell)) {
      return cell;
    }
  }
  return -1;
}

function targetFoodCount(sim) {
  return Math.min(30, 12 + sim.actors.filter((a) => a.alive).length * 2);
}

function countType(sim, type) {
  let n = 0;
  for (const t of sim.foods.values()) if (t === type) n++;
  return n;
}

function spawnFood(sim, blocked, golden) {
  const type = golden && countType(sim, 'g') < 2 ? 'g' : 'f';
  const cell = pickFreeCell(sim, blocked);
  if (cell < 0) return false;
  sim.foods.set(cell, type);
  blocked.add(cell);
  return true;
}

function fillFood(sim) {
  const blocked = blockedCells(sim);
  let guard = 0;
  while (sim.foods.size < targetFoodCount(sim) && guard++ < 80) {
    const golden = sim.random() < 0.12;
    if (!spawnFood(sim, blocked, golden)) break;
  }
}

function placeActor(sim, actor, occupied) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const dir = Math.floor(sim.random() * 4);
    const headX = 5 + Math.floor(sim.random() * (W - 10));
    const headY = 5 + Math.floor(sim.random() * (H - 10));
    const cells = [];
    let x = headX;
    let y = headY;
    let ok = true;
    for (let i = 0; i < MIN_BODY; i++) {
      if (x < 0 || x >= W || y < 0 || y >= H) {
        ok = false;
        break;
      }
      const cell = cellIndex(x, y);
      if (occupied.has(cell)) {
        ok = false;
        break;
      }
      cells.push(cell);
      x -= DX[dir];
      y -= DY[dir];
    }
    if (!ok) continue;
    let aheadX = headX + DX[dir];
    let aheadY = headY + DY[dir];
    for (let i = 0; i < 6; i++) {
      if (aheadX < 2 || aheadX >= W - 2 || aheadY < 2 || aheadY >= H - 2) {
        ok = false;
        break;
      }
      if (occupied.has(cellIndex(aheadX, aheadY))) {
        ok = false;
        break;
      }
      aheadX += DX[dir];
      aheadY += DY[dir];
    }
    if (!ok) continue;
    actor.body = cells;
    actor.dir = dir;
    for (const cell of cells) occupied.add(cell);
    let reserveX = headX + DX[dir];
    let reserveY = headY + DY[dir];
    for (let i = 0; i < 6; i++) {
      occupied.add(cellIndex(reserveX, reserveY));
      reserveX += DX[dir];
      reserveY += DY[dir];
    }
    return;
  }
  for (let cell = 0; cell < W * H; cell++) {
    if (occupied.has(cell)) continue;
    const x = cellX(cell);
    const y = cellY(cell);
    actor.body = [cell];
    actor.dir = x < W - 1 ? 1 : y < H - 1 ? 2 : 3;
    occupied.add(cell);
    return;
  }
}

export function createRound(players, now, seed = 1) {
  if (!Array.isArray(players) || players.length === 0) {
    throw new Error('createRound needs at least one player');
  }
  const sim = {
    actors: [],
    foods: new Map(),
    powerups: new Map(),
    bounds: { x0: 0, y0: 0, x1: W - 1, y1: H - 1 },
    tick: 0,
    startAt: now,
    endedAt: 0,
    shrinkAt: now + 12000,
    shrinkSide: 0,
    powerAt: { p: now + 9000, q: now + 13000 },
    ended: false,
    winnerId: 0,
    reason: '',
    random: mulberry32(seed || 1)
  };
  const occupied = new Set();
  for (const player of players) {
    const actor = {
      id: player.id,
      color: ((player.color | 0) % PLAYER_COLORS.length + PLAYER_COLORS.length) % PLAYER_COLORS.length,
      bot: !!player.bot,
      body: [],
      dir: 1,
      pending: [],
      growth: 0,
      score: 0,
      alive: true,
      ghostTicks: 0,
      frenzyTicks: 0
    };
    placeActor(sim, actor, occupied);
    sim.actors.push(actor);
  }
  sim.shrinkSide = Math.floor(sim.random() * 4);
  fillFood(sim);
  return sim;
}

export function pushInput(actor, dir) {
  if (!actor || !actor.alive) return false;
  if (!Number.isInteger(dir) || dir < 0 || dir > 3) return false;
  const last = actor.pending.length ? actor.pending[actor.pending.length - 1] : actor.dir;
  if (dir === last || dir === opposite(last)) return false;
  if (actor.pending.length >= 2) actor.pending.shift();
  actor.pending.push(dir);
  return true;
}

function killActor(sim, actor) {
  if (!actor.alive) return;
  actor.alive = false;
  actor.pending.length = 0;
  actor.growth = 0;
  actor.ghostTicks = 0;
  actor.frenzyTicks = 0;
  const blocked = new Set();
  for (const other of sim.actors) {
    if (other === actor || !other.alive) continue;
    for (const cell of other.body) blocked.add(cell);
  }
  for (const cell of sim.foods.keys()) blocked.add(cell);
  for (const cell of sim.powerups.keys()) blocked.add(cell);
  const corpse = actor.body;
  actor.body = [];
  let dropped = 0;
  for (let i = 0; i < corpse.length && dropped < 8; i += 2) {
    const cell = corpse[i];
    if (!insideBounds(sim.bounds, cell) || blocked.has(cell)) continue;
    blocked.add(cell);
    sim.foods.set(cell, 'f');
    dropped++;
  }
}

function openSpace(sim, start, blocked, cap) {
  if (blocked.has(start)) return 0;
  const seen = new Set([start]);
  const queue = [start];
  let count = 0;
  while (queue.length && count < cap) {
    const cell = queue.shift();
    count++;
    const x = cellX(cell);
    const y = cellY(cell);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < sim.bounds.x0 || nx > sim.bounds.x1 || ny < sim.bounds.y0 || ny > sim.bounds.y1) continue;
      const next = cellIndex(nx, ny);
      if (seen.has(next) || blocked.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return count;
}

function chooseBotDir(sim, actor) {
  const b = sim.bounds;
  const blocked = new Set();
  for (const other of sim.actors) {
    if (!other.alive) continue;
    for (const cell of other.body) blocked.add(cell);
  }
  const targets = [];
  for (const [cell, type] of sim.foods) targets.push({ cell, type });
  for (const [cell, type] of sim.powerups) targets.push({ cell, type });
  const head = actor.body[0];
  let bestDir = actor.dir;
  let bestValue = -Infinity;
  for (let dir = 0; dir < 4; dir++) {
    if (dir === opposite(actor.dir)) continue;
    const x = cellX(head) + DX[dir];
    const y = cellY(head) + DY[dir];
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
    const cell = cellIndex(x, y);
    if (actor.ghostTicks === 0 && blocked.has(cell)) continue;
    let value = sim.random() * 1.1;
    let closest = Infinity;
    for (const target of targets) {
      let weight = 1;
      if (target.type === 'g') weight = 1.7;
      else if (target.type === 'p') weight = actor.ghostTicks > 0 ? 0.25 : 2.5;
      else if (target.type === 'q') weight = actor.frenzyTicks > 0 ? 0.4 : 2.3;
      const dist = Math.abs(cellX(target.cell) - x) + Math.abs(cellY(target.cell) - y);
      closest = Math.min(closest, dist / weight);
    }
    if (closest !== Infinity) value -= closest * 0.8;
    value += openSpace(sim, cell, blocked, 60) * 0.33;
    for (const other of sim.actors) {
      if (other === actor || !other.alive) continue;
      const otherHead = other.body[0];
      const nextX = cellX(otherHead) + DX[other.dir];
      const nextY = cellY(otherHead) + DY[other.dir];
      if (nextX === x && nextY === y) value -= 7;
      else if (Math.abs(nextX - x) + Math.abs(nextY - y) === 1) value -= 2;
    }
    if (dir === actor.dir) value += 0.5;
    if (value > bestValue) {
      bestValue = value;
      bestDir = dir;
    }
  }
  return bestDir;
}

function applyShrink(sim, now) {
  const b = sim.bounds;
  if (sim.shrinkSide === 0) b.x1--;
  else if (sim.shrinkSide === 1) b.y1--;
  else if (sim.shrinkSide === 2) b.x0++;
  else b.y0++;
  sim.shrinkSide = (sim.shrinkSide + 1) & 3;
  sim.shrinkAt = now + (now - sim.startAt >= 45000 ? 5000 : 8000);
  for (const cell of [...sim.foods.keys()]) {
    if (!insideBounds(b, cell)) sim.foods.delete(cell);
  }
  for (const cell of [...sim.powerups.keys()]) {
    if (!insideBounds(b, cell)) sim.powerups.delete(cell);
  }
  for (const actor of sim.actors) {
    if (!actor.alive) continue;
    if (actor.body.some((cell) => !insideBounds(b, cell))) killActor(sim, actor);
  }
  fillFood(sim);
}

function bestScored(sim) {
  let best = null;
  for (const actor of sim.actors) {
    if (!best) {
      best = actor;
      continue;
    }
    if (actor.score > best.score) best = actor;
    else if (actor.score === best.score && actor.id < best.id) best = actor;
  }
  return best;
}

function checkEnd(sim, now) {
  const alive = sim.actors.filter((actor) => actor.alive);
  let reason = '';
  if (alive.length <= 1) reason = alive.length === 1 ? 'last' : 'wipe';
  else if (now - sim.startAt >= ROUND_MAX_MS) reason = 'time';
  if (!reason) return;
  const winner = alive.length === 1 ? alive[0] : bestScored(sim);
  sim.ended = true;
  sim.endedAt = now;
  sim.winnerId = winner ? winner.id : 0;
  sim.reason = reason;
  for (const actor of sim.actors) actor.pending.length = 0;
}

function maybeSpawnPowerups(sim, now) {
  for (const type of ['p', 'q']) {
    let active = false;
    for (const value of sim.powerups.values()) {
      if (value === type) {
        active = true;
        break;
      }
    }
    if (active || now < sim.powerAt[type]) continue;
    const cell = pickFreeCell(sim, blockedCells(sim));
    if (cell >= 0) sim.powerups.set(cell, type);
    sim.powerAt[type] = cell >= 0 ? now + 9000 + sim.random() * 7000 : now + 2000;
  }
}

export function stepRound(sim, now) {
  if (!sim || sim.ended) return;
  sim.tick++;

  for (const actor of sim.actors) {
    if (!actor.alive) continue;
    if (actor.ghostTicks > 0) actor.ghostTicks--;
    if (actor.frenzyTicks > 0) actor.frenzyTicks--;
  }

  for (const actor of sim.actors) {
    if (actor.alive && actor.bot) pushInput(actor, chooseBotDir(sim, actor));
  }

  for (const actor of sim.actors) {
    if (!actor.alive) continue;
    while (actor.pending.length) {
      const dir = actor.pending.shift();
      if (dir === opposite(actor.dir)) continue;
      actor.dir = dir;
      break;
    }
  }

  const dead = new Set();
  const heads = new Map();
  for (const actor of sim.actors) {
    if (!actor.alive) continue;
    const head = actor.body[0];
    const x = cellX(head) + DX[actor.dir];
    const y = cellY(head) + DY[actor.dir];
    if (x < sim.bounds.x0 || x > sim.bounds.x1 || y < sim.bounds.y0 || y > sim.bounds.y1) {
      dead.add(actor.id);
      continue;
    }
    heads.set(actor.id, cellIndex(x, y));
  }

  const growNow = new Map();
  for (const actor of sim.actors) {
    if (!actor.alive || dead.has(actor.id)) continue;
    const head = heads.get(actor.id);
    const eats = head !== undefined && sim.foods.has(head);
    growNow.set(actor.id, eats || actor.growth > 0);
  }

  const blocked = new Set();
  for (const actor of sim.actors) {
    if (!actor.alive) continue;
    const vacatesTail = !dead.has(actor.id) && !growNow.get(actor.id);
    for (let i = 0; i < actor.body.length; i++) {
      if (vacatesTail && i === actor.body.length - 1) continue;
      blocked.add(actor.body[i]);
    }
  }

  const byCell = new Map();
  for (const actor of sim.actors) {
    if (!actor.alive || dead.has(actor.id)) continue;
    const cell = heads.get(actor.id);
    if (cell === undefined) continue;
    let list = byCell.get(cell);
    if (!list) {
      list = [];
      byCell.set(cell, list);
    }
    list.push(actor);
  }
  for (const list of byCell.values()) {
    if (list.length < 2) continue;
    const solid = list.filter((actor) => actor.ghostTicks === 0);
    if (solid.length === 1) dead.add(solid[0].id);
    else if (solid.length >= 2) for (const actor of solid) dead.add(actor.id);
  }

  for (const actor of sim.actors) {
    if (!actor.alive || dead.has(actor.id) || actor.ghostTicks > 0) continue;
    const cell = heads.get(actor.id);
    if (cell !== undefined && blocked.has(cell)) dead.add(actor.id);
  }

  for (const actor of sim.actors) {
    if (!actor.alive || dead.has(actor.id)) continue;
    const head = heads.get(actor.id);
    if (head === undefined) continue;
    const willGrow = growNow.get(actor.id) && actor.body.length < MAX_BODY;
    actor.body.unshift(head);
    if (willGrow) {
      if (actor.growth > 0) actor.growth--;
    } else {
      actor.body.pop();
    }
    if (actor.body.length > MAX_BODY) actor.body.length = MAX_BODY;
    if (actor.growth > 0 && actor.body.length >= MAX_BODY) actor.growth = 0;

    const multiplier = actor.frenzyTicks > 0 ? 2 : 1;
    const food = sim.foods.get(head);
    if (food === 'f') {
      sim.foods.delete(head);
      actor.score += multiplier;
      actor.growth += 2;
    } else if (food === 'g') {
      sim.foods.delete(head);
      actor.score += 5 * multiplier;
      actor.growth += 4;
    }

    const power = sim.powerups.get(head);
    if (power === 'p') {
      sim.powerups.delete(head);
      actor.ghostTicks = Math.max(actor.ghostTicks, 50);
      actor.score += 2 * multiplier;
      sim.powerAt.p = now + 9000 + sim.random() * 7000;
    } else if (power === 'q') {
      sim.powerups.delete(head);
      actor.frenzyTicks = Math.max(actor.frenzyTicks, 60);
      actor.score += 2 * multiplier;
      sim.powerAt.q = now + 9000 + sim.random() * 7000;
    }
  }

  for (const actor of sim.actors) {
    if (dead.has(actor.id)) killActor(sim, actor);
  }

  fillFood(sim);
  maybeSpawnPowerups(sim, now);

  if (
    now >= sim.shrinkAt &&
    sim.bounds.x1 - sim.bounds.x0 > 7 &&
    sim.bounds.y1 - sim.bounds.y0 > 7
  ) {
    applyShrink(sim, now);
  }

  checkEnd(sim, now);
}

export function eliminateActor(sim, id) {
  if (!sim || sim.ended) return;
  const actor = sim.actors.find((entry) => entry.id === id);
  if (actor) killActor(sim, actor);
}

export function encodeWorld(sim, now) {
  let pickups = '';
  for (const [cell, type] of sim.foods) pickups += type + packCell(cell);
  for (const [cell, type] of sim.powerups) pickups += type + packCell(cell);
  const actors = sim.actors.map((actor) => [
    actor.id,
    actor.color,
    (actor.alive ? 1 : 0) | (actor.ghostTicks > 0 ? 2 : 0) | (actor.frenzyTicks > 0 ? 4 : 0),
    actor.score,
    actor.alive ? actor.body.length : 0,
    actor.alive ? packBody(actor.body) : ''
  ]);
  return {
    k: sim.tick,
    b: [sim.bounds.x0, sim.bounds.y0, sim.bounds.x1, sim.bounds.y1],
    o: pickups,
    a: actors,
    z: [sim.shrinkSide, Math.max(0, Math.round(sim.shrinkAt - now))],
    w: sim.ended ? sim.winnerId : 0,
    r: sim.ended ? sim.reason : ''
  };
}

function decodePickups(packed) {
  const out = [];
  if (typeof packed !== 'string') return out;
  for (let i = 0; i + 2 < packed.length && out.length < 120; i += 3) {
    const type = packed[i];
    if (type !== 'f' && type !== 'g' && type !== 'p' && type !== 'q') continue;
    const cell = unpackCell(packed, i + 1);
    if (cell >= 0) out.push({ cell, type });
  }
  return out;
}

export function decodeState(input) {
  let o;
  try {
    o = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || o.t !== 's') return null;
  if (!Array.isArray(o.e) || o.e.length !== 2) return null;
  const epoch = [o.e[0], o.e[1]];
  if (!Number.isInteger(epoch[0]) || !Number.isInteger(epoch[1])) return null;
  const phases = { l: 'lobby', c: 'countdown', r: 'round', o: 'over' };
  const phase = phases[o.f];
  if (!phase) return null;
  const timer = Number.isFinite(o.n) ? Math.max(0, Math.min(600000, o.n)) : 0;
  const tick = Number.isInteger(o.k) && o.k >= 0 ? Math.min(o.k, 1e9) : 0;

  let bounds = { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  if (Array.isArray(o.b) && o.b.length === 4) {
    const [x0, y0, x1, y1] = o.b;
    if (
      [x0, y0, x1, y1].every(Number.isInteger) &&
      x0 >= 0 &&
      y0 >= 0 &&
      x1 < W &&
      y1 < H &&
      x1 >= x0 &&
      y1 >= y0
    ) {
      bounds = { x0, y0, x1, y1 };
    }
  }

  const pickups = decodePickups(o.o);

  const actors = [];
  if (Array.isArray(o.a)) {
    for (const entry of o.a.slice(0, 16)) {
      if (!Array.isArray(entry) || entry.length !== 6) continue;
      const [id, color, flags, score, length, bodyStr] = entry;
      if (!Number.isInteger(id) || !Number.isInteger(color)) continue;
      if (!Number.isInteger(flags) || !Number.isInteger(score)) continue;
      if (!Number.isInteger(length) || length < 0 || length > MAX_BODY) continue;
      const alive = (flags & 1) === 1;
      actors.push({
        id,
        color: ((color % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length,
        alive,
        ghost: (flags & 2) === 2,
        frenzy: (flags & 4) === 4,
        score: Math.max(0, Math.min(1e9, score)),
        body: alive ? unpackBody(bodyStr, length) : []
      });
    }
  }

  let shrink = null;
  if (Array.isArray(o.z) && o.z.length === 2) {
    const side = o.z[0];
    const ms = o.z[1];
    if (Number.isInteger(side) && side >= 0 && side <= 3 && Number.isFinite(ms)) {
      shrink = { side, ms: Math.max(0, Math.min(600000, ms)) };
    }
  }

  return {
    epoch,
    phase,
    timer,
    tick,
    bounds,
    pickups,
    actors,
    shrink,
    winner: Number.isInteger(o.w) ? o.w : 0,
    reason: typeof o.r === 'string' ? o.r.slice(0, 8) : ''
  };
}
