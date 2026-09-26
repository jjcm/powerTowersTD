// Core rules of the simulation, run headless with Node's test runner:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, STEP } from '../src/game/sim';
import { snapshot, restore } from '../src/game/save';
import { W, H, idx } from '../src/game/grid';
import type { StructureId } from '../src/game/data/structures';

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** First spot (scanning from a start cell) where `id` can be placed. */
function spot(g: Game, id: StructureId, x0 = 10, z0 = 10) {
  for (let z = z0; z < H - 2; z++) for (let x = x0; x < W - 2; x++) if (g.canPlace(id, x, z).ok) return { x, z };
  throw new Error(`no spot for ${id}`);
}

test('the maze can never be sealed', () => {
  const g = new Game('normal', 1);
  g.gold = 1e6;
  const r = rng(42);
  let refused = 0;
  for (let i = 0; i < 600; i++) {
    const x = Math.floor(r() * W), z = Math.floor(r() * H);
    const chk = g.canPlace('wall', x, z);
    if (!chk.ok) { if (chk.reason === 'Would block the path') refused++; continue; }
    g.place('wall', x, z);
    assert.ok(g.grid.legsConnected(g.grid.fields), `path sealed after wall ${i} at ${x},${z}`);
  }
  assert.ok(refused > 0, 'expected some placements to be refused for blocking the path');
  assert.ok(isFinite(g.pathLength()));
});

test('building over walls replaces them and credits their value', () => {
  const g = new Game('normal', 2);
  g.gold = 1000;
  const p = spot(g, 'ballista');
  const w1 = g.place('wall', p.x, p.z)!, w2 = g.place('wall', p.x + 1, p.z)!;
  const gold = g.gold;
  const chk = g.canPlace('ballista', p.x, p.z);
  assert.ok(chk.ok);
  assert.equal(chk.credit, 20);
  const b = g.place('ballista', p.x, p.z)!;
  assert.ok(b);
  assert.equal(gold - g.gold, b.def.cost - 20);
  assert.ok(!g.structById.has(w1.id) && !g.structById.has(w2.id));
  assert.equal(g.grid.occupant[idx(p.x, p.z)], b.id);
  assert.equal(g.canPlace('wall', p.x, p.z).reason, 'Occupied', 'walls cannot go on top of towers');
});

test('energy stays within 0..capacity while the grid runs', () => {
  const g = new Game('normal', 3);
  g.gold = 5000;
  const t = spot(g, 'tesla_coil', 20, 20);
  const tower = g.place('tesla_coil', t.x, t.z)!;
  const f = spot(g, 'furnace', t.x - 3, t.z - 3);
  const gen = g.place('furnace', f.x, f.z)!;
  if (!gen.links.length) assert.ok(g.link(gen, tower));
  g.startWave();
  for (let i = 0; i < 30 * 40; i++) {
    g.step(STEP);
    for (const s of g.structures) {
      assert.ok(s.energy >= -1e-6, `${s.def.id} energy went negative (${s.energy})`);
      const cap = g.energyCap(s);
      if (cap > 0) assert.ok(s.energy <= cap + 1e-6, `${s.def.id} energy ${s.energy} over cap ${cap}`);
    }
  }
  assert.ok(g.links.some((l) => l.from === gen && l.to === tower));
});

test('a saved run restores exactly', () => {
  const g = new Game('hard', 4);
  g.gold = 3000;
  const t = spot(g, 'ballista', 22, 18);
  const b = g.place('ballista', t.x, t.z)!;
  const f = spot(g, 'furnace', t.x - 3, t.z - 3);
  const gen = g.place('furnace', f.x, f.z)!;
  if (!gen.links.length) g.link(gen, b);
  b.level = 3; b.kills = 12; b.damage = 3456;
  g.round = 7; g.env.weather = 'fog';
  const g2 = restore(JSON.parse(JSON.stringify(snapshot(g))));
  assert.equal(g2.structures.length, g.structures.length);
  assert.equal(g2.links.length, g.links.length);
  assert.equal(g2.round, 7);
  assert.equal(g2.gold, g.gold);
  assert.equal(g2.env.weather, 'fog');
  const b2 = g2.structures.find((s) => s.def.id === 'ballista')!;
  assert.deepEqual([b2.level, b2.kills, b2.damage, b2.x, b2.z], [3, 12, 3456, b.x, b.z]);
  assert.deepEqual(g2.legRemain, g.legRemain, 'the maze routes identically');
  assert.equal(g2.events.length, 0);
});

test('a short game plays through without errors', () => {
  const g = new Game('easy', 5);
  g.gold = 2000;
  for (let i = 0; i < 4; i++) { const p = spot(g, 'ballista', 12 + i * 8, 14); g.place('ballista', p.x, p.z); }
  for (let round = 1; round <= 3; round++) {
    g.startWave();
    let t = 0;
    while (g.phase === 'wave' && t < 400) { g.step(STEP); t += STEP; }
    assert.equal(g.phase, 'build', `round ${round} never ended`);
  }
  assert.equal(g.round, 3);
  assert.ok(g.stats.kills > 0);
  assert.equal(g.outcome, 'playing');
});
