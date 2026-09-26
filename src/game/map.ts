// The single-player map: one lane modelled on a player quadrant of the original, with
// raised plateaus (buildable, not walkable, +range), ponds for water wheels, grass meadows
// for furnaces, rock outcrops, tree clumps and ley crystals that empower mana wells.

import { Grid, Terrain, Zone, W, H, idx, inBounds } from './grid';

export interface MapInfo {
  checkpoints: { x: number; z: number }[]; // top-left cell of each 2x2 checkpoint
  spawn: { x: number; z: number };         // portal center (world)
  castle: { x: number; z: number; w: number; h: number; gateX: number; gateZ: number };
  leyCrystals: { x: number; z: number }[]; // centers (world)
  plateaus: { x: number; z: number; w: number; h: number }[];
}

export const PLATEAU_HEIGHT = 1.35;
export const WATER_LEVEL = -0.32;

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildMap(grid: Grid): MapInfo {
  const rng = mulberry32(1337);
  const set = (x: number, z: number, t: Terrain) => { if (inBounds(x, z)) grid.terrain[idx(x, z)] = t; };
  const get = (x: number, z: number) => (inBounds(x, z) ? grid.terrain[idx(x, z)] : Terrain.Rock);
  const ellipse = (cx: number, cz: number, rx: number, rz: number, t: Terrain, only?: Terrain) => {
    for (let z = Math.floor(cz - rz - 1); z <= cz + rz + 1; z++)
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz;
        if (dx * dx + dz * dz <= 1 && (only === undefined || get(x, z) === only)) set(x, z, t);
      }
  };
  const rect = (x0: number, z0: number, w: number, h: number, t: Terrain) => {
    for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) set(x, z, t);
  };

  grid.terrain.fill(Terrain.Grass);

  // --- water: a pond west of center, a lake in the north-east corner, a creek along the south-east
  ellipse(18, 24, 4.2, 3.2, Terrain.Water);
  ellipse(40.5, 26.5, 2.6, 2.2, Terrain.Water);
  for (let z = 0; z < 8; z++) for (let x = 56; x < W; x++) if (x - 56 > z - 1) set(x, z, Terrain.Water);
  for (let x = 38; x < W; x++) {
    const depth = 2 + Math.round(Math.sin(x * 0.45) * 0.8 + (x > 55 ? 1 : 0));
    for (let z = H - depth; z < H; z++) set(x, z, Terrain.Water);
  }
  // sandy shores
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (get(x, z) !== Terrain.Grass) continue;
    let nearWater = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (get(x + dx, z + dz) === Terrain.Water && inBounds(x + dx, z + dz)) nearWater = true;
    if (nearWater) set(x, z, Terrain.Sand);
  }

  // --- plateaus (raised ground: build on them, runners can't climb)
  const plateaus = [
    { x: 12, z: 9, w: 6, h: 6 },
    { x: 44, z: 12, w: 6, h: 5 },
    { x: 25, z: 30, w: 5, h: 4 },
    { x: 55, z: 36, w: 5, h: 4 },
  ];
  for (const p of plateaus) rect(p.x, p.z, p.w, p.h, Terrain.Plateau);

  // --- rock outcrops (like the marble L-shapes in the original)
  const rocks: [number, number][] = [
    [30, 19], [31, 19], [30, 20], [10, 30], [11, 30], [22, 41], [23, 41], [23, 42], [38, 6], [39, 6], [38, 7],
    [47, 40], [48, 40], [36, 33], [5, 14], [5, 15], [58, 26], [59, 26], [20, 4], [21, 4], [44, 3], [3, 26],
  ];
  for (const [x, z] of rocks) set(x, z, Terrain.Rock);

  // --- tree clumps inside the play area
  const clumps: [number, number, number][] = [[4, 21, 1.7], [61, 14, 1.8], [2, 44, 2.2], [35, 45, 1.5], [52, 21, 1.2], [28, 1, 1.4], [15, 44, 1.3]];
  for (const [cx, cz, r] of clumps) ellipse(cx, cz, r, r * 0.9, Terrain.Tree, Terrain.Grass);

  // --- ley crystals
  const leyCrystals = [{ x: 33, z: 24 }, { x: 7, z: 33 }, { x: 57, z: 20 }];
  for (const c of leyCrystals) rect(c.x - 1, c.z - 1, 2, 2, Terrain.Crystal);

  // --- dirt patches (no grass for furnaces): around spawn/castle and a few worn areas
  const dirt = (cx: number, cz: number, r: number) => {
    for (let z = Math.floor(cz - r); z <= cz + r; z++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / r;
      if (d < 1 && get(x, z) === Terrain.Grass && rng() > d * d * 0.8) set(x, z, Terrain.Dirt);
    }
  };
  dirt(3.5, 5.5, 5);
  dirt(26, 40, 3);
  dirt(42, 8, 2.5);
  dirt(12, 20, 2);

  // --- zones
  const spawn = { x: 3, z: 5 };
  for (let z = spawn.z - 2; z <= spawn.z + 2; z++) for (let x = spawn.x - 2; x <= spawn.x + 2; x++) {
    if (!inBounds(x, z)) continue;
    grid.zone[idx(x, z)] = Zone.Spawn;
    if (grid.terrain[idx(x, z)] !== Terrain.Water) grid.terrain[idx(x, z)] = Terrain.Dirt;
  }
  grid.spawnCell = idx(spawn.x, spawn.z);
  grid.spawnPos = { x: spawn.x + 0.5, z: spawn.z + 0.5 };

  const checkpoints = [
    { x: 8, z: 40 }, { x: 27, z: 8 }, { x: 34, z: 39 }, { x: 52, z: 9 }, { x: 45, z: 24 },
  ];
  grid.targets = [];
  checkpoints.forEach((c, k) => {
    const cells: number[] = [];
    for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
      const x = c.x + dx, z = c.z + dz;
      if (!inBounds(x, z)) continue;
      const i = idx(x, z);
      if (grid.terrain[i] !== Terrain.Water) grid.terrain[i] = Terrain.Cobble;
      if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) {
        grid.zone[i] = Zone.Checkpoint; grid.zoneIndex[i] = k; cells.push(i);
      }
    }
    grid.targets.push(cells);
  });

  // castle on the east edge; the gate is the final goal
  const castle = { x: 59, z: 28, w: 5, h: 7, gateX: 59, gateZ: 31 };
  const endCells: number[] = [];
  for (let z = castle.z; z < castle.z + castle.h; z++) for (let x = castle.x; x < castle.x + castle.w; x++) {
    const i = idx(x, z);
    grid.terrain[i] = Terrain.Cobble;
    grid.zone[i] = Zone.Castle;
  }
  for (let z = castle.gateZ; z < castle.gateZ + 2; z++) {
    for (let x = castle.gateX - 3; x <= castle.gateX; x++) {
      const i = idx(x, z);
      grid.terrain[i] = Terrain.Cobble;
      if (x === castle.gateX) { grid.zone[i] = Zone.End; grid.zoneIndex[i] = 5; endCells.push(i); }
      else grid.zone[i] = Zone.Checkpoint; // the gate apron is not buildable
    }
  }
  // a cobbled apron in front of the gate, fading into a worn dirt road
  for (let z = castle.gateZ - 1; z < castle.gateZ + 3; z++) for (let x = castle.gateX - 4; x < castle.gateX; x++) {
    if (inBounds(x, z)) grid.terrain[idx(x, z)] = Terrain.Cobble;
  }
  for (let z = castle.gateZ - 1; z < castle.gateZ + 3; z++) for (let x = castle.gateX - 7; x < castle.gateX - 4; x++) {
    if (inBounds(x, z) && grid.terrain[idx(x, z)] === Terrain.Grass && rng() < 0.8 - (castle.gateX - 4 - x) * 0.2) grid.terrain[idx(x, z)] = Terrain.Dirt;
  }
  grid.targets.push(endCells);

  // grass amount for furnaces
  for (let i = 0; i < W * H; i++) grid.grass[i] = grid.terrain[i] === Terrain.Grass ? 1 : 0;

  grid.refresh();
  if (!grid.legsConnected(grid.fields)) console.error('map: legs not connected!');

  return {
    checkpoints,
    spawn: grid.spawnPos,
    castle,
    leyCrystals,
    plateaus,
  };
}

/** Ground height at a cell for gameplay (plateaus). */
export function cellHeight(t: Terrain) {
  return t === Terrain.Plateau ? PLATEAU_HEIGHT : t === Terrain.Water ? WATER_LEVEL - 0.5 : 0;
}
