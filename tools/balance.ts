// Headless balance bot: plays the real simulation with a simple greedy strategy.
//   npx tsx tools/balance.ts [difficulty] [rounds] [seed]
// A mediocre bot should die somewhere in the late 20s on Normal; players should do better.

import { Game, STEP } from '../src/game/sim';
import { STRUCTURES, M, type StructureId } from '../src/game/data/structures';
import { W, H, idx, inBounds, Terrain } from '../src/game/grid';
import type { Difficulty } from '../src/game/data/runners';
import { roundBaseHp, buildWave } from '../src/game/data/runners';
import type { ResearchId } from '../src/game/data/research';

const diff = (process.argv[2] ?? 'normal') as Difficulty;
const maxRounds = Number(process.argv[3] ?? 30);
const seed = Number(process.argv[4] ?? 7);
function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
Math.random = mulberry32(seed * 7919);
const g = new Game(diff, seed);
const log = (...a: unknown[]) => console.log(...a);

function route(): number[] {
  return g.grid.routeFrom(g.grid.fields).map((p) => idx(Math.floor(p.x), Math.floor(p.z)));
}

function lengthWith(extra: number[]) {
  const f = g.grid.computeFields(extra);
  if (!g.grid.legsConnected(f)) return -1;
  let total = f[0][g.grid.spawnCell];
  for (let k = 1; k < f.length; k++) total += Math.min(...g.grid.targets[k - 1].map((c) => f[k][c]));
  return total;
}

/** Greedy maze: try short wall segments near the route, keep the best gain per gold. */
function buildMaze(budget: number) {
  let spent = 0;
  while (spent + 30 <= budget) {
    const base = g.pathLength();
    const r = route();
    const cand = new Set<number>();
    for (const c of r) {
      const x = c % W, z = Math.floor(c / W);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (inBounds(x + dx, z + dz)) cand.add(idx(x + dx, z + dz));
    }
    let best: number[] | null = null, bestScore = 0;
    const cands = [...cand].filter((c) => g.grid.isWalkable(c) && g.grid.zone[c] === 0 && g.grid.isBuildableTerrain(c));
    // sample for speed
    for (let i = 0; i < 70 && cands.length; i++) {
      const c = cands[Math.floor(Math.random() * cands.length)];
      const x = c % W, z = Math.floor(c / W);
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const len = 3 + Math.floor(Math.random() * 10);
        const cells: number[] = [];
        for (let k = 0; k < len; k++) {
          const cx = x + dx * k, cz = z + dz * k;
          if (!inBounds(cx, cz)) break;
          const ci = idx(cx, cz);
          if (!g.grid.isWalkable(ci) || g.grid.zone[ci] !== 0 || !g.grid.isBuildableTerrain(ci)) break;
          cells.push(ci);
        }
        if (cells.length < 2) continue;
        const L = lengthWith(cells);
        if (L < 0) continue;
        const score = (L - base) / cells.length;
        if (score > bestScore) { bestScore = score; best = cells; }
      }
    }
    if (!best || bestScore < 0.25) break;
    for (const c of best) if (g.place('wall', c % W, Math.floor(c / W))) spent += 10;
  }
  return spent;
}

/** Best 2x2 spot next to the route for a tower with the given range. */
function towerSpot(id: StructureId): { x: number; z: number } | null {
  const def = STRUCTURES[id];
  const range = def.attack?.range ?? 3;
  const r = route();
  const rs = r.map((c) => ({ x: (c % W) + 0.5, z: Math.floor(c / W) + 0.5 }));
  let best: { x: number; z: number } | null = null, bs = 0;
  const base = g.pathLength();
  for (let i = 0; i < 160; i++) {
    const p = rs[Math.floor(Math.random() * rs.length)];
    const x = Math.floor(p.x + (Math.random() - 0.5) * 6), z = Math.floor(p.z + (Math.random() - 0.5) * 6);
    const chk = g.canPlace(id, x, z);
    if (!chk.ok) continue;
    const cx = x + 1, cz = z + 1;
    const plateau = g.grid.terrain[idx(x, z)] === Terrain.Plateau;
    const rr = range * (plateau ? 1.15 : 1);
    let cover = 0;
    for (const q of rs) if (Math.hypot(q.x - cx, q.z - cz) <= rr) cover++;
    const L = lengthWith(chk.cells.filter((c) => g.grid.isWalkable(c)));
    const score = cover + (L - base) * 0.5;
    if (score > bs) { bs = score; best = { x, z }; }
  }
  return best;
}

/** A generator (or pylon) spot near a point that doesn't shorten the maze. */
function nearSpot(id: StructureId, cx: number, cz: number, radius: number): { x: number; z: number } | null {
  const base = g.pathLength();
  let best: { x: number; z: number } | null = null, bs = -Infinity;
  for (let i = 0; i < 120; i++) {
    const x = Math.floor(cx + (Math.random() - 0.5) * radius * 2), z = Math.floor(cz + (Math.random() - 0.5) * radius * 2);
    const chk = g.canPlace(id, x, z);
    if (!chk.ok) continue;
    const L = lengthWith(chk.cells.filter((c) => g.grid.isWalkable(c)));
    if (L < 0) continue;
    let score = L - base - Math.hypot(x - cx, z - cz) * 0.3;
    if (id === 'furnace') { let grass = 0; for (let dz = -2; dz <= 3; dz++) for (let dx = -2; dx <= 3; dx++) if (inBounds(x + dx, z + dz)) grass += g.grid.grass[idx(x + dx, z + dz)]; score += grass * 0.3; }
    if (score > bs) { bs = score; best = { x, z }; }
  }
  return best;
}

function supply() { return g.structures.reduce((a, s) => a + (s.def.id === 'furnace' ? 8 * M(s.level) * 0.6 : s.def.id === 'water_wheel' ? 16 * M(s.level) : s.def.id === 'solar_panel' ? 26 * M(s.level) * 0.45 : 0), 0); }
function demand() { return g.structures.reduce((a, s) => a + (s.def.attack?.consumption ?? (s.def.id === 'clock_tower' ? 20 : 0)) * M(s.level) * 0.6, 0); }

function addPower(nearX: number, nearZ: number) {
  // ensure a pylon nearby, then generators feeding it
  let pylon = g.structures.filter((s) => s.def.id === 'pylon' && s.links.length < 6).sort((a, b) => Math.hypot(a.cx - nearX, a.cz - nearZ) - Math.hypot(b.cx - nearX, b.cz - nearZ))[0];
  if (!pylon || Math.hypot(pylon.cx - nearX, pylon.cz - nearZ) > 5.5) {
    const sp = nearSpot('pylon', nearX, nearZ, 3);
    if (sp) pylon = g.place('pylon', sp.x, sp.z) ?? pylon;
  }
  let guard = 0;
  while (supply() < demand() && guard++ < 6) {
    const water = g.structures.length && g.gold >= 100 ? nearSpot('water_wheel', pylon?.cx ?? nearX, pylon?.cz ?? nearZ, 5) : null;
    const gen: StructureId = water ? 'water_wheel' : 'furnace';
    const sp = water ?? nearSpot('furnace', pylon?.cx ?? nearX, pylon?.cz ?? nearZ, 5);
    if (!sp || g.gold < STRUCTURES[gen].cost) break;
    const s = g.place(gen, sp.x, sp.z);
    if (s && pylon && !s.links.length) g.link(s, pylon);
  }
  // make sure every tower is fed
  for (const t of g.structures) {
    if (!t.def.attack || !t.def.energy || t.inLinks.length) continue;
    const src = g.structures.find((s) => s.def.source === 'energy' && g.canLink(s, t).ok);
    if (src) g.link(src, t);
  }
}

const RESEARCH_PLAN: [number, ResearchId][] = [[2, 'pyrotechnics'], [3, 'engineering'], [5, 'cryomancy'], [8, 'arcane'], [10, 'capacitors'], [13, 'spellweaving'], [16, 'master_engineering'], [20, 'necromancy']];
const TOWER_PLAN = (r: number): StructureId => {
  const opts: StructureId[] = ['ballista', 'tesla_coil', 'cannon'];
  if (g.researched.has('pyrotechnics')) opts.push('demon_tower', 'demon_tower');
  if (g.researched.has('cryomancy')) opts.push('lich_tower');
  return opts[r % opts.length];
};

function packageCost(id: StructureId) {
  const need = (STRUCTURES[id].attack?.consumption ?? 0) * 0.6;
  const gens = Math.ceil(Math.max(0, need - Math.max(0, supply() - demand())) / 4.8);
  return STRUCTURES[id].cost + gens * 50 + 30;
}

function buildPhase() {
  const r = g.round + 1;
  for (const [at, id] of RESEARCH_PLAN) if (r >= at && g.researchState(id) === 'available' && !g.researching && g.gold > RESEARCH_COST(id) + 150) g.startResearch(id);
  const reserve = Math.floor(g.gold * (r <= 2 ? 0.35 : r <= 10 ? 0.2 : 0.08));
  let n = 0;
  while (n++ < 12) {
    const spend = g.gold - reserve;
    const up = g.structures.filter((s) => s.def.attack && g.canUpgrade(s).ok).sort((a, b) => a.level - b.level)[0];
    if (r > 8 && up && Math.random() < 0.5 && g.upgradeCost(up) * 1.6 < spend) { g.upgrade(up); addPower(up.cx, up.cz); continue; }
    const plan = [TOWER_PLAN(r + n), 'cannon', 'ballista'] as StructureId[];
    const id = plan.find((p) => spend >= packageCost(p));
    if (!id) break;
    const sp = towerSpot(id);
    if (!sp) break;
    const t = g.place(id, sp.x, sp.z);
    if (!t) continue;
    addPowerFor(id, t.cx, t.cz);
    if (!t.inLinks.length) { const src = g.structures.find((o) => o.def.source === 'energy' && g.canLink(o, t).ok); if (src) g.link(src, t); }
  }
  buildMaze(g.gold);
  for (const s of g.structures) if (g.canOvercharge(s) && s.def.id !== 'ballista') s.overcharge = true;
}

function addPowerFor(id: StructureId, x: number, z: number) {
  const need = (STRUCTURES[id].attack?.consumption ?? 0) * 0.6;
  let pylon = g.structures.filter((s) => s.def.id === 'pylon' && s.links.length < 6).sort((a, b) => Math.hypot(a.cx - x, a.cz - z) - Math.hypot(b.cx - x, b.cz - z))[0];
  if (!pylon || Math.hypot(pylon.cx - x, pylon.cz - z) > 5) {
    const sp = nearSpot('pylon', x, z, 3);
    if (sp) pylon = g.place('pylon', sp.x, sp.z) ?? pylon;
  }
  let guard = 0;
  while (supply() < demand() && guard++ < 8) {
    const sp = nearSpot('furnace', pylon?.cx ?? x, pylon?.cz ?? z, 5);
    if (!sp || g.gold < 50) break;
    const s = g.place('furnace', sp.x, sp.z);
    if (!s) break;
    if (pylon && !s.links.length) g.link(s, pylon);
  }
}

const RESEARCH_COST = (id: ResearchId) => ({ pyrotechnics: 150, engineering: 150, cryomancy: 150, arcane: 400, capacitors: 300, spellweaving: 700, master_engineering: 800, necromancy: 400 } as Record<string, number>)[id] ?? 300;

const leakLog: string[] = [];
const origLeak = g.leak.bind(g);
g.leak = (r) => { leakLog.push(`${r.type.id}(${Math.round(r.hp)}/${Math.round(r.maxHp)} leg${r.leg})`); origLeak(r); };
log(`difficulty=${diff} seed=${seed}`);
log('rnd  lives  gold  structs  path   supply/demand  waveHP  kills leaks  secs');
for (let round = 1; round <= maxRounds && g.outcome === 'playing'; round++) {
  buildPhase();
  const kills0 = g.stats.kills, leaks0 = g.stats.leaks;
  const w = buildWave(round, () => 0.5);
  const hp = w.groups.reduce((a, gr) => a + gr.count * roundBaseHp(round, diff) * (gr.type === 'warlord' ? 10 : 1), 0);
  g.buildTimer = 0.001;
  g.startWave();
  let t = 0;
  while (g.phase === 'wave' && g.outcome !== 'lost' && t < 600) { g.step(STEP); t += STEP; }
  g.events.length = 0;
  if (leakLog.length && process.env.LEAKS) { log('   leaked:', leakLog.join(' ')); }
  leakLog.length = 0;
  log(`${String(round).padStart(3)} ${String(g.lives).padStart(6)} ${String(Math.round(g.gold)).padStart(5)} ${String(g.structures.length).padStart(8)} ${g.pathLength().toFixed(0).padStart(5)}  ${supply().toFixed(0).padStart(6)}/${demand().toFixed(0).padEnd(6)} ${String(Math.round(hp)).padStart(7)} ${String(g.stats.kills - kills0).padStart(5)} ${String(g.stats.leaks - leaks0).padStart(5)} ${t.toFixed(0).padStart(5)}`);
}
log(`outcome=${g.outcome} round=${g.round} researched=${[...g.researched].join(',')}`);
const byType: Record<string, number> = {};
for (const s of g.structures) byType[s.def.id] = (byType[s.def.id] ?? 0) + 1;
log('structures', JSON.stringify(byType));
log('damage', JSON.stringify(Object.fromEntries(Object.entries(g.stats.damageBy).map(([k, v]) => [k, Math.round(v)]))));
