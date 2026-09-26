// The game simulation. Pure logic: no three.js. The renderer observes entity lists and
// drains `events` every frame.

import { Grid, Terrain, Zone as GridZone, W, H, idx, inBounds, N } from './grid';
import { buildMap, type MapInfo, cellHeight } from './map';
import { STRUCTURES, M, levelCost, totalCost, SPELLS, type StructureDef, type StructureId } from './data/structures';
import { RESEARCH, type ResearchId } from './data/research';
import { RUNNERS, DIFFICULTIES, buildWave, roundBaseHp, bountyFor, roundBonus, MAX_ROUND, type Difficulty, type RunnerTypeId, type WaveDef } from './data/runners';
import { Environment, WEATHER } from './env';
import type { GameEvent, Link, Projectile, Resource, Runner, Structure, Whelp, Zone } from './types';
import { towerStep, castSpell, fireProjectile } from './combat';

export const STEP = 1 / 30;
export const POWER_TICK = 0.25;

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Phase = 'build' | 'wave';

export interface PlaceCheck { ok: boolean; reason?: string; cells: number[] }

export class Game {
  grid = new Grid();
  map: MapInfo;
  env: Environment;
  rng: () => number;
  difficulty: Difficulty;

  structures: Structure[] = [];
  structById = new Map<number, Structure>();
  runners: Runner[] = [];
  runnerById = new Map<number, Runner>();
  projectiles: Projectile[] = [];
  whelps: Whelp[] = [];
  zones: Zone[] = [];
  links: Link[] = [];
  events: GameEvent[] = [];

  gold: number;
  lives: number;
  maxLives: number;
  round = 0;
  phase: Phase = 'build';
  buildTimer = Infinity;
  wave: WaveDef | null = null;
  spawnQueue: RunnerTypeId[] = [];
  spawnTimer = 0;
  spawnedThisWave = 0;
  waveTotal = 0;
  outcome: 'playing' | 'won' | 'lost' = 'playing';
  endless = false;
  time = 0;
  speed = 1;
  paused = false;
  autoLink = true;

  researched = new Set<ResearchId>();
  researching: { id: ResearchId; remaining: number } | null = null;

  legRemain: number[] = [];
  stats = { kills: 0, leaks: 0, goldEarned: 0, built: 0, damageBy: {} as Record<string, number>, spellsCast: 0, overheats: 0 };

  private nextId = 1;
  private acc = 0;
  private powerAcc = 0;
  private grassAcc = 0;

  constructor(difficulty: Difficulty = 'normal', seed = Date.now()) {
    this.difficulty = difficulty;
    this.rng = mulberry32(seed);
    this.env = new Environment(this.rng);
    this.map = buildMap(this.grid);
    const d = DIFFICULTIES[difficulty];
    this.gold = d.gold;
    this.lives = this.maxLives = d.lives;
    this.recomputeLegs();
  }

  id() { return this.nextId++; }
  emit(e: GameEvent) { this.events.push(e); }

  // ------------------------------------------------------------------ stats helpers
  maxLevel(def: StructureDef): number {
    if (def.id === 'wall') return this.researched.has('masonry') ? 3 : 1;
    if (def.maxLevel === 1) return 1;
    const eng = this.researched.has('master_engineering') ? 6 : this.researched.has('engineering') ? 4 : 2;
    return Math.min(def.maxLevel, eng);
  }
  isUnlocked(def: StructureDef) { return !def.requires || this.researched.has(def.requires); }
  levelMult(s: Structure) { return M(s.level); }

  energyCap(s: Structure) {
    const e = s.def.energy;
    if (!e) return 0;
    return e.cap * (e.relayGrowth ? Math.pow(e.relayGrowth, s.level - 1) : M(s.level));
  }
  energyTransfer(s: Structure) {
    const e = s.def.energy;
    if (!e) return 0;
    const base = e.transfer * (e.relayGrowth ? Math.pow(e.relayGrowth, s.level - 1) : M(s.level));
    return base * (this.researched.has('superconductors') ? 1.5 : 1);
  }
  /** Towers with a spell can store mana once Arcane Studies is known. */
  acceptsMana(s: Structure) {
    if (s.def.mana) return true;
    return !!s.def.spell && this.researched.has('arcane');
  }
  manaCap(s: Structure) {
    const m = s.def.mana;
    if (s.def.id === 'hero_tower') return 2000 + 500 * (s.heroLevel - 1);
    if (m) return m.cap * (m.relayGrowth ? Math.pow(m.relayGrowth, s.level - 1) : M(s.level));
    if (this.acceptsMana(s)) return 120 * M(s.level);
    return 0;
  }
  manaTransfer(s: Structure) {
    const m = s.def.mana;
    let base = 0;
    if (m) base = m.transfer * (m.relayGrowth ? Math.pow(m.relayGrowth, s.level - 1) : M(s.level));
    else if (this.acceptsMana(s)) base = 12 * M(s.level);
    return base * (this.researched.has('superconductors') ? 1.5 : 1);
  }
  cap(s: Structure, k: Resource) { return k === 'energy' ? this.energyCap(s) : this.manaCap(s); }
  transfer(s: Structure, k: Resource) { return k === 'energy' ? this.energyTransfer(s) : this.manaTransfer(s); }
  linkRange(s: Structure) {
    return (s.def.linkRange ?? 0) + (s.def.id === 'pylon' || s.def.id === 'ley_obelisk' ? 0.5 * (s.level - 1) : 0) +
      (this.researched.has('superconductors') ? 2 : 0);
  }
  range(s: Structure) {
    const a = s.def.attack;
    if (!a) return s.def.id === 'clock_tower' ? 3.2 + 0.2 * (s.level - 1) : 0;
    let r = a.range * this.env.w.range;
    if (s.onPlateau) r *= 1.15;
    if (s.def.id === 'hero_tower') r += 0.4 * (s.heroLevel - 1);
    return r;
  }
  canOvercharge(s: Structure) { return this.researched.has('capacitors') && !!s.def.attack && !!s.def.energy && s.def.attack.consumption > 0; }
  hasSpell(s: Structure) {
    if (!s.def.spell) return false;
    if (s.def.id === 'hero_tower') return true;
    return this.researched.has('spellweaving');
  }
  spellCost(s: Structure) {
    const sp = SPELLS[s.def.spell!];
    const lvl = s.def.id === 'hero_tower' ? s.heroLevel : s.level;
    return Math.round(sp.mana * (1 + 0.5 * (lvl - 1)) * (this.researched.has('leymastery') ? 0.75 : 1));
  }

  // ------------------------------------------------------------------ placement
  structureAt(x: number, z: number): Structure | undefined {
    if (!inBounds(x, z)) return;
    const o = this.grid.occupant[idx(x, z)];
    return o >= 0 ? this.structById.get(o) : undefined;
  }

  canPlace(id: StructureId, x: number, z: number, opts: { ignoreGold?: boolean; extraGold?: number; skipPath?: boolean } = {}): PlaceCheck {
    const def = STRUCTURES[id];
    const cells = this.grid.cellsOf(x, z, def.size);
    if (!cells.length) return { ok: false, reason: 'Out of bounds', cells };
    if (!this.isUnlocked(def)) return { ok: false, reason: `Requires ${RESEARCH[def.requires!].name}`, cells };
    if (def.unique && this.structures.some((s) => s.def.id === id)) return { ok: false, reason: 'Only one allowed', cells };
    if (!opts.ignoreGold && this.gold < def.cost + (opts.extraGold ?? 0)) return { ok: false, reason: 'Not enough gold', cells };
    let water = 0, plateau = 0;
    for (const c of cells) {
      if (this.grid.occupant[c] >= 0) return { ok: false, reason: 'Occupied', cells };
      const t = this.grid.terrain[c];
      if (!this.grid.isBuildableTerrain(c, def.placement === 'water')) return { ok: false, reason: 'Can\'t build here', cells };
      if (t === Terrain.Water) water++;
      if (t === Terrain.Plateau) plateau++;
    }
    if (def.placement === 'water') {
      if (water === 0) return { ok: false, reason: 'Must be built on the water\'s edge', cells };
      if (water === cells.length) return { ok: false, reason: 'Needs a foothold on the shore', cells };
    }
    if (plateau && plateau !== cells.length) return { ok: false, reason: 'Uneven ground', cells };
    // runners standing in the footprint
    const x0 = x - 0.3, z0 = z - 0.3, x1 = x + def.size + 0.3, z1 = z + def.size + 0.3;
    for (const r of this.runners) if (r.alive && r.x > x0 && r.x < x1 && r.z > z0 && r.z < z1) return { ok: false, reason: 'A runner is in the way', cells };
    // path must stay open
    const walkable = cells.filter((c) => this.grid.isWalkable(c));
    if (walkable.length && !opts.skipPath) {
      const fields = this.grid.computeFields(walkable);
      if (!this.grid.legsConnected(fields)) return { ok: false, reason: 'Would block the path', cells };
      for (const r of this.runners) {
        if (!r.alive) continue;
        const ci = idx(Math.floor(r.x), Math.floor(r.z));
        if (!isFinite(fields[Math.min(r.leg, fields.length - 1)][ci])) return { ok: false, reason: 'Would trap a runner', cells };
      }
    }
    return { ok: true, cells };
  }

  place(id: StructureId, x: number, z: number, free = false): Structure | null {
    const chk = this.canPlace(id, x, z, { ignoreGold: free });
    if (!chk.ok) return null;
    const def = STRUCTURES[id];
    if (!free) this.gold -= def.cost;
    const s = this.makeStructure(def, x, z);
    for (const c of chk.cells) this.grid.occupant[c] = s.id;
    this.structures.push(s);
    this.structById.set(s.id, s);
    this.grid.refresh();
    this.recomputeLegs();
    this.stats.built++;
    this.emit({ type: 'build', structureId: s.id });
    this.emit({ type: 'sound', name: 'build', x: s.cx, z: s.cz });
    if (this.autoLink) this.autoConnect(s);
    return s;
  }

  private makeStructure(def: StructureDef, x: number, z: number): Structure {
    const cx = x + def.size / 2, cz = z + def.size / 2;
    const t = this.grid.terrain[idx(x, z)];
    const s: Structure = {
      id: this.id(), def, x, z, cx, cz, y: t === Terrain.Plateau ? cellHeight(Terrain.Plateau) : 0, level: 1,
      onPlateau: t === Terrain.Plateau, energy: 0, mana: 0, links: [], inLinks: [],
      cooldown: 0.3, special: 1, spellCd: 2, autocast: true, overcharge: false, heat: 0, overheated: 0, disabled: 0,
      haste: 0, hasteAmt: 0, targetId: -1, aim: Math.PI * 0.75, poweredGlow: 0, lastFire: -10,
      receivedE: 0, receivedM: 0, snapE: 0, snapM: 0, flowIn: 0, flowOut: 0, manaIn: 0, producing: 0,
      kills: 0, damage: 0, xp: 0, heroLevel: 1, whelps: 0, builtRound: this.round, builtDuringBuild: this.phase === 'build',
    };
    if (def.id === 'furnace') {
      s.grassCells = [];
      for (let dz = -3; dz <= 4; dz++) for (let dx = -3; dx <= 4; dx++) {
        const gx = Math.floor(cx) + dx - 1 + 1, gz = Math.floor(cz) + dz - 1 + 1;
        if (!inBounds(gx, gz)) continue;
        if (Math.hypot(gx + 0.5 - cx, gz + 0.5 - cz) <= 3.2) s.grassCells.push(idx(gx, gz));
      }
    }
    if (def.id === 'mana_well') s.nearLey = this.map.leyCrystals.some((c) => Math.hypot(c.x - cx, c.z - cz) <= 4.5);
    return s;
  }

  /** Place a run of 1x1 structures (wall dragging). Returns how many were placed. */
  placeLine(id: StructureId, cells: { x: number; z: number }[]): number {
    let n = 0;
    for (const c of cells) if (this.place(id, c.x, c.z)) n++;
    return n;
  }

  sellValue(s: Structure) {
    const invested = totalCost(s.def, s.level);
    return Math.floor(invested * (this.phase === 'build' || s.builtDuringBuild && s.builtRound === this.round ? 1 : 0.75));
  }

  sell(s: Structure) {
    if (!this.structById.has(s.id)) return;
    const value = this.sellValue(s);
    this.gold += value;
    for (const l of [...s.links, ...s.inLinks]) this.unlink(l);
    for (let i = 0; i < N; i++) if (this.grid.occupant[i] === s.id) this.grid.occupant[i] = -1;
    this.structures.splice(this.structures.indexOf(s), 1);
    this.structById.delete(s.id);
    this.whelps = this.whelps.filter((w) => w.ownerId !== s.id);
    this.grid.refresh();
    this.recomputeLegs();
    this.emit({ type: 'sell', x: s.cx, z: s.cz, size: s.def.size });
    this.emit({ type: 'text', x: s.cx, z: s.cz, text: `+${value}`, color: '#ffd24a' });
    this.emit({ type: 'sound', name: 'sell', x: s.cx, z: s.cz });
  }

  upgradeCost(s: Structure) { return levelCost(s.def, s.level + 1); }
  canUpgrade(s: Structure): { ok: boolean; reason?: string } {
    if (s.level >= s.def.maxLevel) return { ok: false, reason: 'Max level' };
    if (s.level >= this.maxLevel(s.def)) {
      if (s.def.id === 'wall') return { ok: false, reason: 'Requires Masonry' };
      return { ok: false, reason: s.level < 4 ? 'Requires Advanced Engineering' : 'Requires Master Engineering' };
    }
    if (this.gold < this.upgradeCost(s)) return { ok: false, reason: 'Not enough gold' };
    return { ok: true };
  }
  upgrade(s: Structure) {
    if (!this.canUpgrade(s).ok) return false;
    this.gold -= this.upgradeCost(s);
    s.level++;
    this.emit({ type: 'upgrade', structureId: s.id });
    this.emit({ type: 'sound', name: 'upgrade', x: s.cx, z: s.cz });
    return true;
  }

  // ------------------------------------------------------------------ links
  linkKind(from: Structure): Resource | null { return from.def.source ?? null; }

  canLink(from: Structure, to: Structure): { ok: boolean; reason?: string } {
    const kind = from.def.source;
    if (!kind) return { ok: false, reason: 'Not a power source' };
    if (from === to) return { ok: false, reason: 'Can\'t link to itself' };
    if (from.links.length >= (from.def.maxLinks ?? 0)) return { ok: false, reason: 'No free link slots' };
    if (kind === 'energy' && !to.def.energy) return { ok: false, reason: 'Target doesn\'t use power' };
    if (kind === 'mana' && !this.acceptsMana(to)) return { ok: false, reason: to.def.spell ? 'Requires Arcane Studies' : 'Target doesn\'t use mana' };
    if (kind === 'energy' && to.def.energy?.production && !to.def.attack) return { ok: false, reason: 'Generators don\'t accept power' };
    if (kind === 'mana' && to.def.mana?.production) return { ok: false, reason: 'Mana sources don\'t accept mana' };
    if (from.links.some((l) => l.to === to) || to.links.some((l) => l.to === from)) return { ok: false, reason: 'Already linked' };
    const d = Math.hypot(from.cx - to.cx, from.cz - to.cz);
    if (d > this.linkRange(from) + (to.def.size - 1) * 0.5) return { ok: false, reason: 'Out of link range' };
    return { ok: true };
  }

  link(from: Structure, to: Structure): Link | null {
    if (!this.canLink(from, to).ok) return null;
    const l: Link = { id: this.id(), from, to, kind: from.def.source!, flow: 0, tickFlow: 0, leeched: 0 };
    from.links.push(l);
    to.inLinks.push(l);
    this.links.push(l);
    this.emit({ type: 'sound', name: 'link', x: to.cx, z: to.cz });
    return l;
  }

  unlink(l: Link) {
    l.from.links.splice(l.from.links.indexOf(l), 1);
    l.to.inLinks.splice(l.to.inLinks.indexOf(l), 1);
    const i = this.links.indexOf(l);
    if (i >= 0) this.links.splice(i, 1);
  }

  /** Quality of life: hook new structures into the nearest sensible part of the grid. */
  autoConnect(s: Structure) {
    const dist = (a: Structure, b: Structure) => Math.hypot(a.cx - b.cx, a.cz - b.cz);
    const kinds: Resource[] = [];
    if (s.def.energy && !s.def.source) kinds.push('energy');
    if (this.acceptsMana(s) && !s.def.source) kinds.push('mana');
    for (const kind of kinds) {
      // prefer relays, then generators
      const srcs = this.structures.filter((o) => o.def.source === kind && this.canLink(o, s).ok)
        .sort((a, b) => (isRelay(a) ? 0 : 1) - (isRelay(b) ? 0 : 1) || dist(a, s) - dist(b, s));
      if (srcs[0]) this.link(srcs[0], s);
    }
    if (isRelay(s)) {
      // new relay: adopt nearby generators that have nowhere to send their output
      const gens = this.structures.filter((o) => o !== s && o.def.source === s.def.source && !isRelay(o) && o.links.length === 0 && this.canLink(o, s).ok)
        .sort((a, b) => dist(a, s) - dist(b, s));
      for (const gen of gens.slice(0, 3)) this.link(gen, s);
    }
    if (s.def.source) {
      // new source: feed nearest relay, else nearest unpowered consumer
      const targets = this.structures.filter((o) => o !== s && this.canLink(s, o).ok)
        .sort((a, b) => (isRelay(a) ? 0 : 1) - (isRelay(b) ? 0 : 1) || a.inLinks.length - b.inLinks.length || dist(a, s) - dist(b, s));
      if (targets[0] && !(isRelay(s) && isRelay(targets[0]))) this.link(s, targets[0]);
    }
  }

  // ------------------------------------------------------------------ research
  researchState(id: ResearchId): 'done' | 'active' | 'available' | 'locked' {
    if (this.researched.has(id)) return 'done';
    if (this.researching?.id === id) return 'active';
    const def = RESEARCH[id];
    if (!def.requires.every((r) => this.researched.has(r))) return 'locked';
    if (def.requiresCount) {
      const n = [...this.researched].filter((r) => RESEARCH[r].tier < def.tier).length;
      if (n < def.requiresCount) return 'locked';
    }
    return 'available';
  }
  startResearch(id: ResearchId): boolean {
    if (this.researching || this.researchState(id) !== 'available') return false;
    const def = RESEARCH[id];
    if (this.gold < def.cost) return false;
    this.gold -= def.cost;
    this.researching = { id, remaining: def.time };
    this.emit({ type: 'sound', name: 'research' });
    return true;
  }
  cancelResearch() {
    if (!this.researching) return;
    this.gold += RESEARCH[this.researching.id].cost;
    this.researching = null;
  }

  // ------------------------------------------------------------------ waves
  startWave() {
    if (this.phase !== 'build' || this.outcome !== 'playing') return;
    if (isFinite(this.buildTimer) && this.buildTimer > 1 && this.round > 0) {
      const bonus = Math.floor(this.buildTimer) * 2;
      this.gold += bonus;
      this.stats.goldEarned += bonus;
      this.emit({ type: 'message', text: `Early call bonus +${bonus} gold`, kind: 'good' });
    }
    this.round++;
    this.phase = 'wave';
    this.wave = buildWave(this.round, this.rng);
    const q: RunnerTypeId[] = [];
    const normal = this.wave.groups.filter((g) => g.type !== 'warlord');
    const counts = normal.map((g) => g.count);
    const total = counts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < total; i++) {
      // interleave groups proportionally
      let best = 0, bestRatio = -1;
      normal.forEach((g, gi) => { const r = counts[gi] / g.count; if (r > bestRatio) { bestRatio = r; best = gi; } });
      counts[best]--; q.push(normal[best].type);
    }
    for (const g of this.wave.groups) if (g.type === 'warlord') for (let i = 0; i < g.count; i++) q.splice(Math.floor(q.length * (0.5 + 0.5 * (i + 1) / (g.count + 1))), 0, 'warlord');
    this.spawnQueue = q;
    this.waveTotal = q.length;
    this.spawnedThisWave = 0;
    this.spawnTimer = 0.5;
    this.emit({ type: 'message', text: `Round ${this.round}${this.wave.name ? ' — ' + this.wave.name : ''}`, kind: 'round' });
    this.emit({ type: 'sound', name: 'horn' });
  }

  spawnRunner(typeId: RunnerTypeId) {
    const type = RUNNERS[typeId];
    const hp = roundBaseHp(this.round, this.difficulty) * type.hp;
    const jx = (this.rng() - 0.5) * 1.2, jz = (this.rng() - 0.5) * 1.2;
    const r: Runner = {
      id: this.id(), type, hp, maxHp: hp, shield: type.shield ? hp * type.shield : 0, shieldMax: type.shield ? hp * type.shield : 0,
      shieldDelay: 0, regenDelay: 0, x: this.grid.spawnPos.x + jx, z: this.grid.spawnPos.z + jz, leg: 0, heading: 0, speedMul: 1, moving: true,
      wp: null, wpVersion: -1, repath: 0, crumbs: [], crumbDist: 0, slowAmt: 0, slowT: 0, rootT: 0, stunT: 0,
      vulnAmt: 0, vulnT: 0, curseT: 0, burnDps: 0, burnT: 0, poisonDps: 0, poisonT: 0, sabotageCd: 3 + this.rng() * 3,
      progress: 1e9, alive: true, bounty: bountyFor(this.round, type), lastHitBy: -1, hitFlash: 0, knock: 0,
    };
    this.runners.push(r);
    this.runnerById.set(r.id, r);
    this.spawnedThisWave++;
  }

  recomputeLegs() {
    const g = this.grid;
    const len: number[] = [];
    for (let k = 0; k < g.fields.length; k++) {
      if (k === 0) { len.push(g.fields[0][g.spawnCell]); continue; }
      len.push(Math.min(...g.targets[k - 1].map((c) => g.fields[k][c])));
    }
    this.legRemain = len.map((_, k) => len.slice(k + 1).reduce((a, b) => a + b, 0));
  }
  pathLength() {
    const g = this.grid;
    let total = g.fields[0][g.spawnCell];
    for (let k = 1; k < g.fields.length; k++) total += Math.min(...g.targets[k - 1].map((c) => g.fields[k][c]));
    return total;
  }

  // ------------------------------------------------------------------ main loop
  update(realDt: number) {
    if (this.paused || this.outcome === 'lost') return;
    this.acc += Math.min(realDt, 0.25) * this.speed;
    let steps = 0;
    while (this.acc >= STEP && steps < 12) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 12) this.acc = 0;
  }

  step(dt: number) {
    this.time += dt;
    if (this.env.step(dt)) {
      const w = WEATHER[this.env.weather];
      this.emit({ type: 'message', text: `Weather: ${w.name}. ${w.desc}`, kind: 'info' });
    }

    // research
    if (this.researching) {
      this.researching.remaining -= dt;
      if (this.researching.remaining <= 0) {
        const id = this.researching.id;
        this.researched.add(id);
        this.researching = null;
        this.emit({ type: 'message', text: `Research complete: ${RESEARCH[id].name}`, kind: 'good' });
        this.emit({ type: 'sound', name: 'complete' });
      }
    }

    // phase logic
    if (this.phase === 'build') {
      if (isFinite(this.buildTimer)) {
        this.buildTimer -= dt;
        if (this.buildTimer <= 0) this.startWave();
      }
    } else {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.spawnQueue.length) {
        const t = this.spawnQueue.shift()!;
        this.spawnRunner(t);
        this.spawnTimer = t === 'warlord' ? 2.5 : this.wave!.interval;
      }
      if (!this.spawnQueue.length && !this.runners.some((r) => r.alive)) this.endWave();
    }

    this.stepRunners(dt);
    for (const s of this.structures) towerStep(this, s, dt);
    this.stepProjectiles(dt);
    this.stepWhelps(dt);
    this.stepZones(dt);
    this.stepStorm(dt);

    this.powerAcc += dt;
    if (this.powerAcc >= POWER_TICK) { this.powerAcc -= POWER_TICK; this.powerTick(POWER_TICK); }
    this.grassAcc += dt;
    if (this.grassAcc >= 1) { this.grassAcc -= 1; this.grassTick(1); }

    // cleanup dead runners after their death has been observed
    if (this.runners.length > 0 && this.runners.some((r) => !r.alive)) {
      this.runners = this.runners.filter((r) => r.alive);
    }
  }

  endWave() {
    this.phase = 'build';
    const bonus = roundBonus(this.round);
    this.gold += bonus;
    this.stats.goldEarned += bonus;
    this.emit({ type: 'message', text: `Round ${this.round} cleared! +${bonus} gold`, kind: 'good' });
    this.emit({ type: 'sound', name: 'cleared' });
    if (this.round >= MAX_ROUND && !this.endless) {
      this.outcome = 'won';
      this.buildTimer = Infinity;
      return;
    }
    this.buildTimer = this.round < 3 ? 35 : 25;
  }

  continueEndless() {
    this.endless = true;
    this.outcome = 'playing';
    this.buildTimer = 25;
  }

  // ------------------------------------------------------------------ runners
  private stepRunners(dt: number) {
    const g = this.grid;
    const bosses = this.runners.filter((r) => r.alive && r.type.boss);
    for (const r of this.runners) {
      if (!r.alive) continue;
      // status effects
      r.hitFlash = Math.max(0, r.hitFlash - dt * 4);
      r.knock = Math.max(0, r.knock - dt);
      if (r.slowT > 0) { r.slowT -= dt; if (r.slowT <= 0) r.slowAmt = 0; }
      if (r.rootT > 0) r.rootT -= dt;
      if (r.stunT > 0) r.stunT -= dt;
      if (r.vulnT > 0) { r.vulnT -= dt; if (r.vulnT <= 0) r.vulnAmt = 0; }
      if (r.curseT > 0) r.curseT -= dt;
      if (r.burnT > 0) { r.burnT -= dt; this.damage(r, r.burnDps * dt, -1, 'dot'); if (!r.alive) continue; }
      if (r.poisonT > 0) { r.poisonT -= dt; this.damage(r, r.poisonDps * dt, -1, 'poison'); if (!r.alive) continue; }
      if (r.type.regen) {
        r.regenDelay -= dt;
        if (r.regenDelay <= 0) r.hp = Math.min(r.maxHp, r.hp + r.maxHp * r.type.regen * dt);
      }
      if (r.shieldMax > 0) {
        r.shieldDelay -= dt;
        if (r.shieldDelay <= 0) r.shield = Math.min(r.shieldMax, r.shield + r.shieldMax * 0.3 * dt);
      }
      if (r.type.saboteur) {
        r.sabotageCd -= dt;
        if (r.sabotageCd <= 0) this.sabotage(r);
      }

      // movement
      let speed = r.type.speed * (1 - r.slowAmt);
      if (!r.type.boss && bosses.some((b) => Math.hypot(b.x - r.x, b.z - r.z) < 3.5)) speed *= 1.2;
      if (r.rootT > 0 || r.stunT > 0) speed = 0;
      r.speedMul = speed / r.type.speed;
      r.moving = speed > 0;
      if (speed <= 0) continue;

      const field = g.fields[Math.min(r.leg, g.fields.length - 1)];
      r.repath -= dt;
      if (!r.wp || r.wpVersion !== g.version || r.repath <= 0) this.chooseWaypoint(r, field);
      if (!r.wp) continue;
      let dx = r.wp.x - r.x, dz = r.wp.z - r.z;
      let d = Math.hypot(dx, dz);
      let move = speed * dt;
      if (d < 0.05) { this.chooseWaypoint(r, field); if (!r.wp) continue; dx = r.wp.x - r.x; dz = r.wp.z - r.z; d = Math.hypot(dx, dz); }
      if (d > 0) {
        const m = Math.min(move, d);
        r.x += (dx / d) * m; r.z += (dz / d) * m;
        const target = Math.atan2(dx, dz);
        let diff = target - r.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        r.heading += diff * Math.min(1, dt * 10);
        r.crumbDist += m;
        if (r.crumbDist > 0.4) {
          r.crumbDist = 0;
          r.crumbs.push({ x: r.x, z: r.z, leg: r.leg });
          if (r.crumbs.length > 30) r.crumbs.shift();
          const ci = idx(Math.floor(r.x), Math.floor(r.z));
          if (inBounds(Math.floor(r.x), Math.floor(r.z))) g.wear[ci] = Math.min(1, g.wear[ci] + 0.02);
        }
      }
      // separation
      for (const o of this.runners) {
        if (o === r || !o.alive) continue;
        const ox = r.x - o.x, oz = r.z - o.z;
        const od = ox * ox + oz * oz;
        if (od < 0.16 && od > 1e-6) {
          const f = (0.4 - Math.sqrt(od)) * 0.5;
          const nx = r.x + (ox / Math.sqrt(od)) * f * dt * 8, nz = r.z + (oz / Math.sqrt(od)) * f * dt * 8;
          if (this.walkableAt(nx, nz)) { r.x = nx; r.z = nz; }
        }
      }

      const cx = Math.floor(r.x), cz = Math.floor(r.z);
      if (!inBounds(cx, cz)) continue;
      const ci = idx(cx, cz);
      if (g.zoneIndex[ci] === r.leg || (r.leg === 5 && g.zone[ci] === GridZone.End)) {
        r.leg++;
        r.wp = null;
        if (r.leg >= g.fields.length) { this.leak(r); continue; }
      }
      const f = g.fields[Math.min(r.leg, g.fields.length - 1)];
      r.progress = (isFinite(f[ci]) ? f[ci] : 999) + (this.legRemain[r.leg] ?? 0);
    }
  }

  walkableAt(x: number, z: number) {
    const cx = Math.floor(x), cz = Math.floor(z);
    return inBounds(cx, cz) && this.grid.isWalkable(idx(cx, cz));
  }

  private chooseWaypoint(r: Runner, field: Float32Array) {
    const g = this.grid;
    r.wpVersion = g.version;
    r.repath = 0.5;
    let cx = Math.floor(r.x), cz = Math.floor(r.z);
    let cell = idx(cx, cz);
    if (!inBounds(cx, cz) || !isFinite(field[cell]) || !g.isWalkable(cell)) {
      // pushed somewhere odd: step toward the best walkable neighbour
      let best = -1, bd = Infinity;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (!inBounds(nx, nz)) continue;
        const j = idx(nx, nz);
        if (g.isWalkable(j) && field[j] < bd) { bd = field[j]; best = j; }
      }
      if (best < 0) { r.wp = null; return; }
      r.wp = { x: (best % W) + 0.5, z: Math.floor(best / W) + 0.5 };
      return;
    }
    if (field[cell] === 0) {
      // inside the goal zone: head for its center
      r.wp = { x: cx + 0.5, z: cz + 0.5 };
      return;
    }
    const chain: number[] = [];
    let c = cell;
    for (let i = 0; i < 10; i++) {
      const n = g.nextCell(field, c);
      if (n < 0) break;
      chain.push(n);
      c = n;
      if (field[n] === 0) break;
    }
    if (!chain.length) { r.wp = null; return; }
    let pick = chain[0];
    for (let i = chain.length - 1; i > 0; i--) {
      const px = (chain[i] % W) + 0.5, pz = Math.floor(chain[i] / W) + 0.5;
      if (g.clearLine(r.x, r.z, px, pz, 0.32)) { pick = chain[i]; break; }
    }
    r.wp = { x: (pick % W) + 0.5, z: Math.floor(pick / W) + 0.5 };
  }

  /** Push a runner back along the way it came. */
  knockback(r: Runner, dist: number) {
    let left = dist;
    while (left > 0 && r.crumbs.length) {
      const c = r.crumbs[r.crumbs.length - 1];
      const d = Math.hypot(c.x - r.x, c.z - r.z);
      if (d > left) {
        r.x += ((c.x - r.x) / d) * left; r.z += ((c.z - r.z) / d) * left;
        left = 0;
      } else {
        r.x = c.x; r.z = c.z; r.leg = c.leg; left -= d;
        r.crumbs.pop();
      }
    }
    r.wp = null;
    r.knock = 0.3;
  }

  damage(r: Runner, amount: number, sourceId: number, kind: 'physical' | 'fire' | 'frost' | 'lightning' | 'acid' | 'poison' | 'dot' | 'spell' | 'pure' | 'holy' | 'shadow'): number {
    if (!r.alive || amount <= 0) return 0;
    if (kind === 'poison' && r.type.id === 'skeleton') return 0;
    let mult = 1 + (r.vulnT > 0 ? r.vulnAmt : 0) + (r.curseT > 0 ? 0.6 : 0);
    if (kind !== 'spell' && kind !== 'pure' && kind !== 'dot' && kind !== 'poison') {
      const a = r.type.armor;
      mult *= 1 - (0.06 * a) / (1 + 0.06 * a);
    }
    let dmg = amount * mult;
    const dealt = dmg;
    if (r.shield > 0 && kind !== 'poison') {
      const absorbed = Math.min(r.shield, dmg);
      r.shield -= absorbed; dmg -= absorbed;
    }
    if (r.shieldMax > 0) r.shieldDelay = 3;
    if (kind !== 'dot' && kind !== 'poison') r.regenDelay = 2;
    r.hp -= dmg;
    r.hitFlash = 1;
    if (sourceId >= 0) {
      r.lastHitBy = sourceId;
      const s = this.structById.get(sourceId);
      if (s) {
        s.damage += dealt;
        this.stats.damageBy[s.def.id] = (this.stats.damageBy[s.def.id] ?? 0) + dealt;
        if (r.type.drain && kind !== 'dot' && kind !== 'poison') {
          const drain = 8 * M(s.level);
          if (s.energy > 0 || s.mana > 0) {
            s.energy = Math.max(0, s.energy - drain);
            s.mana = Math.max(0, s.mana - drain * 0.5);
            if (this.rng() < 0.35) this.emit({ type: 'beam', kind: 'drain', x1: r.x, z1: r.z, x2: s.cx, z2: s.cz });
          }
        }
      }
    }
    if (r.hp <= 0) this.kill(r, kind);
    return dealt;
  }

  kill(r: Runner, cause: string) {
    if (!r.alive) return;
    r.alive = false;
    this.runnerById.delete(r.id);
    this.gold += r.bounty;
    this.stats.goldEarned += r.bounty;
    this.stats.kills++;
    this.emit({ type: 'death', runnerId: r.id, x: r.x, z: r.z, cause });
    this.emit({ type: 'text', x: r.x, z: r.z, y: 1.4, text: `+${r.bounty}`, color: '#ffd24a' });
    const killer = this.structById.get(r.lastHitBy);
    if (killer) killer.kills++;
    // souls for graveyards
    for (const s of this.structures) {
      if (s.def.id === 'graveyard' && s.disabled <= 0 && Math.hypot(s.cx - r.x, s.cz - r.z) <= 5.5) {
        const soul = 12 * M(s.level) * (r.type.id === 'skeleton' ? 2 : 1) * (r.type.boss ? 10 : 1) * (this.researched.has('leymastery') ? 1.5 : 1);
        s.mana = Math.min(this.manaCap(s), s.mana + soul);
        this.emit({ type: 'soul', x: r.x, z: r.z, toId: s.id });
      }
      if (s.def.id === 'hero_tower' && Math.hypot(s.cx - r.x, s.cz - r.z) <= this.range(s) + 1) this.heroXp(s, 10 + this.round * 2 + (r.type.boss ? 200 : 0));
    }
    // curse spreads
    if (r.curseT > 0) {
      let best: Runner | undefined, bd = 3.5;
      for (const o of this.runners) if (o.alive && o !== r) { const d = Math.hypot(o.x - r.x, o.z - r.z); if (d < bd) { bd = d; best = o; } }
      if (best) { best.curseT = Math.max(best.curseT, r.curseT + 2); this.emit({ type: 'beam', kind: 'drain', x1: r.x, z1: r.z, x2: best.x, z2: best.z }); }
    }
  }

  heroXp(s: Structure, xp: number) {
    const TH = [0, 300, 800, 1600, 2800, 4500];
    s.xp += xp;
    while (s.heroLevel < 6 && s.xp >= TH[s.heroLevel]) {
      s.heroLevel++;
      this.emit({ type: 'message', text: `Archmage reached level ${s.heroLevel}!`, kind: 'good' });
      this.emit({ type: 'nova', x: s.cx, z: s.cz, r: 2.5, kind: 'arcane' });
      this.emit({ type: 'upgrade', structureId: s.id });
    }
  }

  leak(r: Runner) {
    r.alive = false;
    this.runnerById.delete(r.id);
    this.stats.leaks++;
    const first = this.round <= 1;
    if (!first) this.lives -= r.type.lives;
    this.emit({ type: 'leak', runnerId: r.id });
    this.emit({ type: 'message', text: first ? 'A runner got through! (Leaks are forgiven in round 1)' : `A runner got through! −${r.type.lives} ${r.type.lives > 1 ? 'lives' : 'life'}`, kind: 'warn' });
    this.emit({ type: 'sound', name: 'leak' });
    if (this.lives <= 0) {
      this.lives = 0;
      this.outcome = 'lost';
    }
  }

  private sabotage(r: Runner) {
    let best: Structure | undefined, bd = 4.5;
    for (const s of this.structures) {
      if (!s.def.source || s.disabled > 0) continue;
      const d = Math.hypot(s.cx - r.x, s.cz - r.z);
      if (d < bd) { bd = d; best = s; }
    }
    r.sabotageCd = best ? 7 : 1;
    if (!best) return;
    const target = best;
    fireProjectile(this, {
      kind: 'spark', sx: r.x, sy: 0.9, sz: r.z, tx: target.cx, ty: target.y + 1, tz: target.cz, targetId: -1, speed: 9, damage: 0, sourceId: -1,
      powered: false, splash: 0, arc: 1.5,
      onHit: () => {
        if (!this.structById.has(target.id)) return;
        target.disabled = 5;
        target.energy *= 0.5; target.mana *= 0.5;
        this.emit({ type: 'nova', x: target.cx, z: target.cz, r: 1.4, kind: 'emp' });
        this.emit({ type: 'text', x: target.cx, z: target.cz, y: 2.2, text: 'EMP!', color: '#7fd4ff' });
        this.emit({ type: 'sound', name: 'emp', x: target.cx, z: target.cz });
      },
    });
    this.emit({ type: 'emp', x1: r.x, z1: r.z, x2: target.cx, z2: target.cz, targetId: target.id });
  }

  // ------------------------------------------------------------------ projectiles, whelps, zones
  private stepProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const tgt = p.targetId >= 0 ? this.runnerById.get(p.targetId) : undefined;
      if (tgt && p.arc === 0) { p.tx = tgt.x; p.tz = tgt.z; p.ty = 0.7 * tgt.type.scale + (tgt.type.flying ? 0.6 : 0); }
      if (p.arc > 0) {
        p.t += dt;
        const u = Math.min(1, p.t / p.dur);
        p.x = p.sx + (p.tx - p.sx) * u; p.z = p.sz + (p.tz - p.sz) * u;
        p.y = p.sy + (p.ty - p.sy) * u + p.arc * 4 * u * (1 - u);
        if (u >= 1) { this.projectileHit(p, tgt); continue; }
      } else {
        const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z;
        const d = Math.hypot(dx, dy, dz);
        const m = p.speed * dt;
        if (d <= m + 0.1) { p.x = p.tx; p.y = p.ty; p.z = p.tz; this.projectileHit(p, tgt); continue; }
        p.x += (dx / d) * m; p.y += (dy / d) * m; p.z += (dz / d) * m;
      }
      keep.push(p);
    }
    this.projectiles = keep;
  }

  private projectileHit(p: Projectile, tgt: Runner | undefined) {
    if (p.onHit) p.onHit(p.x, p.z, tgt);
    else if (tgt) this.damage(tgt, p.damage, p.sourceId, 'physical');
    this.emit({ type: 'hit', kind: p.kind, x: p.x, z: p.z, y: p.y, powered: p.powered, r: p.splash });
  }

  splash(x: number, z: number, r: number, dmg: number, sourceId: number, kind: Parameters<Game['damage']>[3], falloff = true, fn?: (r: Runner) => void) {
    for (const u of this.runners) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d > r) continue;
      const f = !falloff ? 1 : d < r * 0.2 ? 1 : d < r * 0.5 ? 0.5 : 0.25;
      this.damage(u, dmg * f, sourceId, kind);
      if (fn && u.alive) fn(u);
    }
  }

  private stepWhelps(dt: number) {
    const keep: Whelp[] = [];
    for (const w of this.whelps) {
      w.life -= dt;
      const owner = this.structById.get(w.ownerId);
      if (w.life <= 0 || !owner) { if (owner) owner.whelps--; this.emit({ type: 'hit', kind: 'fireball', x: w.x, z: w.z, y: w.y }); continue; }
      let tgt = this.runnerById.get(w.targetId);
      if (!tgt || Math.hypot(tgt.x - owner.cx, tgt.z - owner.cz) > 11) {
        tgt = undefined; let bd = 11;
        for (const r of this.runners) if (r.alive) { const d = Math.hypot(r.x - owner.cx, r.z - owner.cz); if (d < bd) { bd = d; tgt = r; } }
        w.targetId = tgt?.id ?? -1;
      }
      const hx = tgt ? tgt.x : owner.cx + Math.cos(this.time + w.id) * 2;
      const hz = tgt ? tgt.z : owner.cz + Math.sin(this.time + w.id) * 2;
      const dx = hx - w.x, dz = hz - w.z;
      const d = Math.hypot(dx, dz);
      const want = tgt ? 2.5 : 0;
      if (d > want) { const m = Math.min(5 * dt, d - want); w.x += (dx / d) * m; w.z += (dz / d) * m; }
      w.heading = Math.atan2(dx, dz);
      w.y = 2.4 + Math.sin(this.time * 3 + w.id) * 0.3;
      w.cooldown -= dt;
      if (tgt && d < 4 && w.cooldown <= 0) {
        w.cooldown = 1.8;
        const target = tgt;
        fireProjectile(this, { kind: 'fireball', sx: w.x, sy: w.y, sz: w.z, tx: target.x, ty: 0.6, tz: target.z, targetId: target.id, speed: 14, damage: w.damage, sourceId: w.ownerId, powered: false, splash: 0, arc: 0,
          onHit: (_x, _z, t) => { if (t) this.damage(t, w.damage, w.ownerId, 'fire'); } });
      }
      keep.push(w);
    }
    this.whelps = keep;
  }

  private stepZones(dt: number) {
    const keep: Zone[] = [];
    for (const z of this.zones) {
      z.t += dt;
      z.tick -= dt;
      if (z.kind === 'whirlpool') {
        for (const r of this.runners) {
          if (!r.alive) continue;
          const dx = z.x - r.x, dz = z.z - r.z, d = Math.hypot(dx, dz);
          if (d > z.r) continue;
          r.rootT = Math.max(r.rootT, 0.15);
          if (d > 0.3) {
            const nx = r.x + (dx / d) * 2.2 * dt, nz = r.z + (dz / d) * 2.2 * dt;
            if (this.walkableAt(nx, nz)) { r.x = nx; r.z = nz; r.wp = null; }
          }
        }
      }
      if (z.tick <= 0) {
        z.tick = z.kind === 'blizzard' ? 0.75 : z.kind === 'thunder' ? 0.5 : 0.25;
        const per = z.kind === 'blizzard' || z.kind === 'thunder' ? 1 : 0.25;
        if (z.kind === 'thunder') {
          const a = this.rng() * Math.PI * 2, rr = Math.sqrt(this.rng()) * z.r;
          const sx = z.x + Math.cos(a) * rr, sz = z.z + Math.sin(a) * rr;
          this.splash(sx, sz, 1.1, z.dps, z.sourceId, 'spell', false);
          this.emit({ type: 'strike', x: sx, z: sz, y: 0 });
        } else if (z.kind === 'blizzard') {
          this.splash(z.x, z.z, z.r, z.dps, z.sourceId, 'spell', false, (r) => { r.slowAmt = Math.max(r.slowAmt, 0.6); r.slowT = Math.max(r.slowT, 3); });
          this.emit({ type: 'nova', x: z.x, z: z.z, r: z.r, kind: 'frost' });
        } else {
          this.splash(z.x, z.z, z.r, z.dps * per, z.sourceId, z.kind === 'fire' ? 'dot' : 'spell', false, (r) => {
            if (z.kind === 'consecrate') r.shield = 0;
          });
        }
      }
      if (z.t < z.dur) keep.push(z);
    }
    this.zones = keep;
  }

  private stepStorm(dt: number) {
    if (this.env.weather !== 'storm') return;
    this.env.strikeT -= dt;
    if (this.env.strikeT > 0) return;
    this.env.strikeT = 5 + this.rng() * 8;
    const rods = this.structures.filter((s) => s.def.id === 'tesla_coil' || s.def.id === 'pylon' || s.def.id === 'capacitor');
    if (rods.length && this.rng() < 0.7) {
      const s = rods[Math.floor(this.rng() * rods.length)];
      const gain = 100 * M(s.level);
      s.energy = Math.min(this.energyCap(s), s.energy + gain);
      this.emit({ type: 'strike', x: s.cx, z: s.cz, y: s.y + 2.5 });
      this.emit({ type: 'text', x: s.cx, z: s.cz, y: 3, text: `⚡+${Math.round(gain)}`, color: '#8fdcff' });
      this.emit({ type: 'sound', name: 'thunder' });
    } else {
      const alive = this.runners.filter((r) => r.alive);
      if (alive.length) {
        const r = alive[Math.floor(this.rng() * alive.length)];
        this.emit({ type: 'strike', x: r.x, z: r.z, y: 0.5, targetId: r.id });
        this.damage(r, r.maxHp * 0.15, -1, 'spell');
      } else {
        this.emit({ type: 'strike', x: 5 + this.rng() * (W - 10), z: 5 + this.rng() * (H - 10), y: 0 });
      }
      this.emit({ type: 'sound', name: 'thunder' });
    }
  }

  // ------------------------------------------------------------------ power network
  private powerTick(dt: number) {
    const env = this.env;
    const ley = this.researched.has('leymastery') ? 1.5 : 1;
    for (const s of this.structures) {
      s.snapE = s.energy; s.snapM = s.mana; s.receivedE = 0; s.receivedM = 0;
      if (s.disabled > 0) { s.producing *= 0.5; continue; }
      let prodE = 0, prodM = 0;
      const L = M(s.level);
      switch (s.def.id) {
        case 'furnace': {
          const cells = s.grassCells!;
          let g = 0; for (const c of cells) g += this.grid.grass[c];
          const frac = cells.length ? g / cells.length : 0;
          prodE = 8 * L * Math.min(1, frac * 1.6) * env.w.furnace;
          // burn grass proportional to output, nearest cells first
          let burn = prodE * dt * 0.008;
          for (const c of cells) { if (burn <= 0) break; const b = Math.min(this.grid.grass[c], burn / 3); this.grid.grass[c] -= b; burn -= b; }
          if (burn > 0) for (const c of cells) { const b = Math.min(this.grid.grass[c], burn); this.grid.grass[c] -= b; burn -= b; if (burn <= 0) break; }
          break;
        }
        case 'water_wheel': prodE = 16 * L * env.w.water; break;
        case 'solar_panel': prodE = 26 * L * env.solarMult; break;
        case 'mana_well': prodM = 4 * L * (s.nearLey ? 2 : 1) * env.nightMana * env.manaMult * ley; break;
        case 'graveyard': prodM = 0.8 * L * env.nightMana * env.manaMult * ley; break;
      }
      if (prodE) s.energy = Math.min(this.energyCap(s), s.energy + prodE * dt);
      if (prodM) s.mana = Math.min(this.manaCap(s), s.mana + prodM * dt);
      s.producing = s.producing * 0.6 + (prodE + prodM) * 0.4;
    }
    for (const l of this.links) { l.tickFlow = 0; l.leeched = 0; }
    for (const s of this.structures) {
      if (s.def.source && s.links.length && s.disabled <= 0) this.push(s, s.def.source, dt);
    }
    // leeches siphon from links passing overhead
    const leeches = this.runners.filter((r) => r.alive && r.type.leech);
    if (leeches.length) {
      for (const l of this.links) {
        if (l.tickFlow <= 0) continue;
        for (const r of leeches) {
          if (segDist(r.x, r.z, l.from.cx, l.from.cz, l.to.cx, l.to.cz) > 1.1) continue;
          const steal = Math.min(l.tickFlow * 0.7, 40 * dt * (1 + this.round / 10));
          if (l.kind === 'energy') l.to.energy = Math.max(0, l.to.energy - steal); else l.to.mana = Math.max(0, l.to.mana - steal);
          l.leeched += steal;
          r.hp = Math.min(r.maxHp, r.hp + steal * 3);
        }
      }
    }
    for (const l of this.links) l.flow = l.flow * 0.5 + (l.tickFlow / dt) * 0.5;
    for (const s of this.structures) {
      const inE = s.inLinks.reduce((a, l) => a + (l.kind === 'energy' ? l.tickFlow : 0), 0) / dt;
      const inM = s.inLinks.reduce((a, l) => a + (l.kind === 'mana' ? l.tickFlow : 0), 0) / dt;
      const out = s.links.reduce((a, l) => a + l.tickFlow, 0) / dt;
      s.flowIn = s.flowIn * 0.7 + inE * 0.3;
      s.manaIn = s.manaIn * 0.7 + inM * 0.3;
      s.flowOut = s.flowOut * 0.7 + out * 0.3;
    }
  }

  private receivable(t: Structure, kind: Resource, dt: number) {
    if (t.disabled > 0) return 0;
    const cur = kind === 'energy' ? t.energy : t.mana;
    const snap = kind === 'energy' ? t.snapE : t.snapM;
    const rec = kind === 'energy' ? t.receivedE : t.receivedM;
    return Math.max(0, Math.min(this.transfer(t, kind) * dt - rec, this.cap(t, kind) - Math.max(cur, snap)));
  }

  private push(s: Structure, kind: Resource, dt: number) {
    const cur = kind === 'energy' ? s.energy : s.mana;
    const snap = kind === 'energy' ? s.snapE : s.snapM;
    let avail = Math.min(this.transfer(s, kind) * dt, snap, cur);
    if (avail <= 0) return;
    const links = s.links.filter((l) => l.kind === kind);
    const rec = links.map((l) => this.receivable(l.to, kind, dt));
    const order = links.map((_, i) => i).sort((a, b) => rec[a] - rec[b]);
    let n = links.length;
    for (const i of order) {
      const l = links[i];
      const de = Math.min(avail / n, rec[i]);
      n--;
      if (de <= 0) continue;
      if (kind === 'energy') { l.to.energy += de; l.to.receivedE += de; s.energy -= de; }
      else { l.to.mana += de; l.to.receivedM += de; s.mana -= de; }
      l.tickFlow += de;
      avail -= de;
    }
  }

  private grassTick(dt: number) {
    const g = this.grid;
    const regrow = 0.0035 * this.env.w.regrow * dt;
    for (let i = 0; i < N; i++) {
      if (g.terrain[i] === Terrain.Grass && g.grass[i] < 1) g.grass[i] = Math.min(1, g.grass[i] + regrow);
      if (g.wear[i] > 0) g.wear[i] = Math.max(0, g.wear[i] - 0.0015 * dt);
    }
    for (const s of this.structures) {
      if (s.disabled > 0) s.disabled = Math.max(0, s.disabled - dt);
    }
  }

  // ------------------------------------------------------------------ spells
  castNow(s: Structure) { return castSpell(this, s, true); }
}

export function isRelay(s: Structure) { return s.def.id === 'pylon' || s.def.id === 'ley_obelisk' || s.def.id === 'capacitor'; }

export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export { W, H, STRUCTURES };
