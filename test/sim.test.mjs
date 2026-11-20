import test from 'node:test';
import assert from 'node:assert/strict';
import {
  W,
  H,
  TICK_MS,
  MAX_BODY,
  cellIndex,
  cellX,
  cellY,
  createRound,
  stepRound,
  pushInput,
  packBody,
  unpackBody,
  encodeWorld,
  decodeState,
  opposite
} from '../sim.js';

function setupDuel(seed = 42) {
  const sim = createRound(
    [
      { id: 1, color: 0 },
      { id: 2, color: 1 }
    ],
    0,
    seed
  );
  const [a, b] = sim.actors;
  sim.foods.clear();
  sim.powerups.clear();
  a.body = [10, 9, 8, 7, 6].map((x) => cellIndex(x, 10));
  a.dir = 1;
  a.pending = [];
  a.growth = 0;
  a.score = 0;
  a.alive = true;
  b.body = [30, 29, 28, 27, 26].map((x) => cellIndex(x, 20));
  b.dir = 1;
  b.pending = [];
  b.growth = 0;
  b.score = 0;
  b.alive = true;
  return { sim, a, b };
}

test('body packing round-trips a bent snake', () => {
  const cells = [
    cellIndex(10, 10),
    cellIndex(9, 10),
    cellIndex(9, 11),
    cellIndex(9, 12),
    cellIndex(10, 12),
    cellIndex(11, 12),
    cellIndex(11, 13)
  ];
  const packed = packBody(cells);
  assert.ok(packed.length < cells.length * 2);
  assert.deepEqual(unpackBody(packed, cells.length), cells);
});

test('food is eaten, score rises and the snake grows', () => {
  const { sim, a, b } = setupDuel();
  sim.foods.set(cellIndex(11, 10), 'f');
  stepRound(sim, TICK_MS);
  assert.equal(a.alive, true);
  assert.equal(a.score, 1);
  assert.equal(a.body.length, 6);
  assert.equal(a.body[0], cellIndex(11, 10));
  assert.equal(b.body[0], cellIndex(31, 20));
  assert.equal(sim.ended, false);
});

test('golden food is worth five and growth is doubled by frenzy', () => {
  const { sim, a } = setupDuel();
  sim.foods.set(cellIndex(11, 10), 'g');
  a.frenzyTicks = 30;
  stepRound(sim, TICK_MS);
  assert.equal(a.score, 10);
  assert.equal(a.body.length, 6);
  assert.equal(a.growth, 4);
});

test('a wall is lethal and leaves one winner', () => {
  const { sim, a, b } = setupDuel();
  a.body = [39, 38, 37, 36, 35].map((x) => cellIndex(x, 10));
  a.dir = 1;
  stepRound(sim, TICK_MS);
  assert.equal(a.alive, false);
  assert.equal(b.alive, true);
  assert.equal(sim.ended, true);
  assert.equal(sim.winnerId, 2);
});

test('two snakes reaching the same cell die together', () => {
  const { sim, a, b } = setupDuel();
  a.body = [10, 9, 8, 7, 6].map((x) => cellIndex(x, 10));
  a.dir = 1;
  b.body = [12, 13, 14, 15, 16].map((x) => cellIndex(x, 10));
  b.dir = 3;
  stepRound(sim, TICK_MS);
  assert.equal(a.alive, false);
  assert.equal(b.alive, false);
  assert.equal(sim.ended, true);
  assert.equal(sim.reason, 'wipe');
});

test('ghost snakes pass through bodies and heads', () => {
  const { sim, a, b } = setupDuel();
  a.body = [10, 9, 8, 7, 6].map((x) => cellIndex(x, 10));
  a.dir = 1;
  a.ghostTicks = 30;
  b.body = [12, 13, 14, 15, 16].map((x) => cellIndex(x, 10));
  b.dir = 3;
  stepRound(sim, TICK_MS);
  assert.equal(a.alive, true);
  assert.equal(b.alive, false);
});

test('the void shrinks the arena and consumes snakes on the edge', () => {
  const { sim, a, b } = setupDuel();
  a.body = [10, 11, 12, 13, 14].map((y) => cellIndex(39, y));
  a.dir = 0;
  b.body = [30, 29, 28, 27, 26].map((x) => cellIndex(x, 20));
  b.dir = 1;
  sim.shrinkSide = 0;
  sim.shrinkAt = 50;
  stepRound(sim, 100);
  assert.equal(sim.bounds.x1, W - 2);
  assert.equal(a.alive, false);
  assert.equal(b.alive, true);
  assert.equal(sim.ended, true);
});

test('input queues refuse reversals and cap at two turns', () => {
  const { a } = setupDuel();
  assert.equal(pushInput(a, opposite(a.dir)), false);
  assert.equal(pushInput(a, 0), true);
  assert.equal(pushInput(a, 3), true);
  assert.equal(pushInput(a, 2), true);
  assert.deepEqual(a.pending, [3, 2]);
});

test('state encoding round-trips and fits one datagram with eight full snakes', () => {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, color: i }));
  const sim = createRound(players, 0, 99);
  for (let i = 0; i < sim.actors.length; i++) {
    const actor = sim.actors[i];
    actor.body = Array.from({ length: MAX_BODY }, (_, k) => cellIndex(MAX_BODY - 1 - k, i));
    actor.dir = 1;
  }
  sim.foods.clear();
  sim.powerups.clear();
  sim.foods.set(cellIndex(11, 11), 'f');
  sim.foods.set(cellIndex(12, 12), 'g');
  sim.powerups.set(cellIndex(13, 13), 'p');
  sim.powerups.set(cellIndex(14, 14), 'q');
  sim.tick = 777;

  const world = encodeWorld(sim, 1000);
  const message = JSON.stringify({ t: 's', e: [4, 1], f: 'r', n: 0, ...world });
  assert.ok(new TextEncoder().encode(message).length < 1052);

  const decoded = decodeState(message);
  assert.ok(decoded);
  assert.deepEqual(decoded.epoch, [4, 1]);
  assert.equal(decoded.phase, 'round');
  assert.equal(decoded.tick, 777);
  assert.equal(decoded.actors.length, 8);
  assert.equal(decoded.pickups.length, 4);
  for (let i = 0; i < sim.actors.length; i++) {
    assert.deepEqual(decoded.actors[i].body, sim.actors[i].body);
    assert.equal(decoded.actors[i].alive, true);
  }
  assert.deepEqual(decoded.bounds, { x0: 0, y0: 0, x1: W - 1, y1: H - 1 });
  assert.deepEqual(decoded.shrink, { side: sim.shrinkSide, ms: sim.shrinkAt - 1000 });
});

test('decoder rejects malformed state', () => {
  assert.equal(decodeState('not json'), null);
  assert.equal(decodeState('{"t":"x"}'), null);
  assert.equal(decodeState('{"t":"s","e":[1,2],"f":"?"}'), null);
  const weird = decodeState('{"t":"s","e":[1,2],"f":"r","b":[9,9,2,2],"a":[[1,2,999,1,999,"zz"]],"o":"x"}');
  assert.ok(weird);
  assert.deepEqual(weird.actors, []);
  assert.deepEqual(weird.pickups, []);
  assert.deepEqual(weird.bounds, { x0: 0, y0: 0, x1: W - 1, y1: H - 1 });
});

test('spawns leave every snake a safe opening', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const players = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, color: i }));
    const sim = createRound(players, 0, seed);
    stepRound(sim, TICK_MS);
    assert.equal(
      sim.actors.filter((actor) => !actor.alive).length,
      0,
      `a snake died on the first tick with seed ${seed}`
    );
  }
});

test('four bots play a full round without leaving the arena', () => {
  const sim = createRound(
    [
      { id: -1, color: 0, bot: true },
      { id: -2, color: 1, bot: true },
      { id: -3, color: 2, bot: true },
      { id: -4, color: 3, bot: true }
    ],
    0,
    2024
  );
  let now = 0;
  let steps = 0;
  while (!sim.ended && steps < 1300) {
    now += TICK_MS;
    steps++;
    stepRound(sim, now);
    for (const actor of sim.actors) {
      if (!actor.alive) continue;
      for (const cell of actor.body) {
        assert.ok(cellX(cell) >= 0 && cellX(cell) < W);
        assert.ok(cellY(cell) >= 0 && cellY(cell) < H);
      }
      assert.ok(actor.body.length <= MAX_BODY);
    }
  }
  assert.equal(sim.ended, true);
  assert.notEqual(sim.winnerId, 0);
});
