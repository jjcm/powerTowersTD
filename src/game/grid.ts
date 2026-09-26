// Grid, terrain and pathfinding. Runners must visit checkpoints in order; each leg has its
// own distance field (Dijkstra, 8-connected, no corner cutting). Placement is only allowed if
// every leg stays connected and every live runner can still reach its current target.

export const W = 64;
export const H = 48;
export const N = W * H;

export enum Terrain { Grass, Dirt, Sand, Water, Plateau, Rock, Tree, Crystal, Cobble }
export enum Zone { None, Spawn, Checkpoint, End, Castle }

export const idx = (x: number, z: number) => z * W + x;
export const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H;

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, v: number) {
    const ks = this.keys, vs = this.vals;
    let i = ks.length;
    ks.push(k); vs.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= k) break;
      ks[i] = ks[p]; vs[i] = vs[p]; i = p;
    }
    ks[i] = k; vs[i] = v;
  }
  pop(): number {
    const ks = this.keys, vs = this.vals;
    const top = vs[0];
    const k = ks.pop()!, v = vs.pop()!;
    const n = ks.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && ks[c + 1] < ks[c]) c++;
        if (ks[c] >= k) break;
        ks[i] = ks[c]; vs[i] = vs[c]; i = c;
      }
      ks[i] = k; vs[i] = v;
    }
    return top;
  }
}

export interface CellRect { x: number; z: number; w: number; h: number }

export class Grid {
  terrain = new Uint8Array(N);
  zone = new Uint8Array(N);
  /** Structure id occupying the cell, or -1. */
  occupant = new Int32Array(N).fill(-1);
  grass = new Float32Array(N);
  wear = new Float32Array(N);
  /** Checkpoint index (0-based) for checkpoint cells, 5 for end. */
  zoneIndex = new Int8Array(N).fill(-1);

  /** targets[k] = cells of leg k's goal. Leg 0: spawn -> CP1 ... last leg -> end. */
  targets: number[][] = [];
  spawnCell = 0;
  spawnPos = { x: 0, z: 0 };
  /** Distance fields per leg (Infinity = unreachable). */
  fields: Float32Array[] = [];
  version = 0;

  private blocked = new Uint8Array(N);

  isTerrainWalkable(i: number) {
    const t = this.terrain[i];
    return t === Terrain.Grass || t === Terrain.Dirt || t === Terrain.Sand || t === Terrain.Cobble;
  }
  isWalkable(i: number) { return this.isTerrainWalkable(i) && this.occupant[i] < 0 && this.zone[i] !== Zone.Castle; }
  isBuildableTerrain(i: number, allowWater = false) {
    const t = this.terrain[i];
    if (this.zone[i] !== Zone.None) return false;
    if (t === Terrain.Water) return allowWater;
    return t === Terrain.Grass || t === Terrain.Dirt || t === Terrain.Sand || t === Terrain.Plateau || t === Terrain.Cobble;
  }

  recomputeBlocked() {
    for (let i = 0; i < N; i++) this.blocked[i] = this.isWalkable(i) ? 0 : 1;
  }

  computeFields(extraBlocked?: number[]): Float32Array[] {
    this.recomputeBlocked();
    if (extraBlocked) for (const i of extraBlocked) this.blocked[i] = 1;
    return this.targets.map((t) => this.dijkstra(t, this.blocked));
  }

  refresh() {
    this.fields = this.computeFields();
    this.version++;
  }

  dijkstra(goal: number[], blocked: Uint8Array): Float32Array {
    const dist = new Float32Array(N).fill(Infinity);
    const heap = new MinHeap();
    for (const g of goal) { dist[g] = 0; heap.push(0, g); }
    while (heap.size) {
      const i = heap.pop();
      const d = dist[i];
      const x = i % W, z = (i / W) | 0;
      for (const [dx, dz, c] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!inBounds(nx, nz)) continue;
        const j = nz * W + nx;
        if (blocked[j]) continue;
        if (dx && dz && (blocked[z * W + nx] || blocked[nz * W + x])) continue;
        const nd = d + c;
        if (nd < dist[j]) { dist[j] = nd; heap.push(nd, j); }
      }
    }
    return dist;
  }

  /** Every leg connected: spawn -> CP1 -> ... -> end. */
  legsConnected(fields: Float32Array[]): boolean {
    if (!isFinite(fields[0][this.spawnCell])) return false;
    for (let k = 1; k < fields.length; k++) {
      if (!this.targets[k - 1].some((c) => isFinite(fields[k][c]))) return false;
    }
    return true;
  }

  /** Best neighbour step for a cell along a field (for path following / preview). */
  nextCell(field: Float32Array, i: number, blocked?: (j: number) => boolean): number {
    const x = i % W, z = (i / W) | 0;
    let best = -1, bd = field[i];
    const isB = blocked ?? ((j: number) => !this.isWalkable(j));
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (!inBounds(nx, nz)) continue;
      const j = nz * W + nx;
      if (isB(j)) continue;
      if (dx && dz && (isB(z * W + nx) || isB(nz * W + x))) continue;
      if (field[j] < bd) { bd = field[j]; best = j; }
    }
    return best;
  }

  /** Full route through all legs from spawn, as cell centers (for the path preview). */
  routeFrom(fields: Float32Array[], startCell = this.spawnCell, startLeg = 0, extraBlocked?: Set<number>): { x: number; z: number }[] {
    const pts: { x: number; z: number }[] = [];
    let cell = startCell;
    const isB = (j: number) => !this.isWalkable(j) || !!extraBlocked?.has(j);
    for (let k = startLeg; k < fields.length; k++) {
      const f = fields[k];
      let guard = 0;
      while (f[cell] > 0 && guard++ < N) {
        pts.push({ x: (cell % W) + 0.5, z: ((cell / W) | 0) + 0.5 });
        const n = this.nextCell(f, cell, isB);
        if (n < 0) return pts;
        cell = n;
      }
      pts.push({ x: (cell % W) + 0.5, z: ((cell / W) | 0) + 0.5 });
    }
    return pts;
  }

  /** Line-of-walk test between two points (runner radius r). */
  clearLine(ax: number, az: number, bx: number, bz: number, r = 0.3): boolean {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 0.2);
    const nx = len > 0 ? -dz / len : 0, nz = len > 0 ? dx / len : 0;
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const px = ax + dx * t, pz = az + dz * t;
      for (const o of [-r, 0, r]) {
        const cx = Math.floor(px + nx * o), cz = Math.floor(pz + nz * o);
        if (!inBounds(cx, cz) || !this.isWalkable(cz * W + cx)) return false;
      }
    }
    return true;
  }

  cellsOf(x: number, z: number, size: number): number[] {
    const out: number[] = [];
    for (let dz = 0; dz < size; dz++) for (let dx = 0; dx < size; dx++) {
      if (!inBounds(x + dx, z + dz)) return [];
      out.push(idx(x + dx, z + dz));
    }
    return out;
  }
}
