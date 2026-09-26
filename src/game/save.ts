// Save & resume: a run is snapshotted at the start of every build phase (and every so often
// while building), so a refresh or a closed tab resumes where you left off. Mid-wave state
// (runners, projectiles) isn't saved: a resumed game restarts at the last build phase.

import { Game } from './sim';
import type { Difficulty } from './data/runners';
import type { StructureId } from './data/structures';
import type { ResearchId } from './data/research';
import type { Weather } from './env';

export const SAVE_KEY = 'powertowers.save.v1';

interface SavedStructure {
  id: number; def: StructureId; x: number; z: number; level: number; energy: number; mana: number;
  overcharge: boolean; autocast: boolean; heroLevel: number; xp: number; kills: number; damage: number; builtRound: number;
}

export interface SaveData {
  v: 1; at: number; difficulty: Difficulty;
  round: number; gold: number; lives: number; maxLives: number; endless: boolean; time: number; buildTimer: number | null;
  researched: ResearchId[]; researching: { id: ResearchId; remaining: number } | null;
  stats: Game['stats'];
  env: { time: number; weather: Weather; next: Weather; weatherT: number; prevWeather: Weather };
  structures: SavedStructure[];
  links: { from: number; to: number }[];
}

export function snapshot(g: Game): SaveData {
  return {
    v: 1, at: Date.now(), difficulty: g.difficulty,
    round: g.round, gold: g.gold, lives: g.lives, maxLives: g.maxLives, endless: g.endless, time: g.time,
    buildTimer: isFinite(g.buildTimer) ? g.buildTimer : null,
    researched: [...g.researched], researching: g.researching ? { ...g.researching } : null,
    stats: JSON.parse(JSON.stringify(g.stats)),
    env: { time: g.env.time, weather: g.env.weather, next: g.env.next, weatherT: g.env.weatherT, prevWeather: g.env.prevWeather },
    structures: g.structures.map((s) => ({
      id: s.id, def: s.def.id as StructureId, x: s.x, z: s.z, level: s.level, energy: s.energy, mana: s.mana,
      overcharge: s.overcharge, autocast: s.autocast, heroLevel: s.heroLevel, xp: s.xp, kills: s.kills, damage: s.damage, builtRound: s.builtRound,
    })),
    links: g.links.map((l) => ({ from: l.from.id, to: l.to.id })),
  };
}

export function restore(d: SaveData): Game {
  const g = new Game(d.difficulty);
  Object.assign(g, { round: d.round, gold: d.gold, lives: d.lives, maxLives: d.maxLives, endless: d.endless, time: d.time });
  g.buildTimer = d.buildTimer ?? Infinity;
  g.researched = new Set(d.researched);
  g.researching = d.researching;
  g.stats = d.stats;
  Object.assign(g.env, d.env, { weatherBlend: 1 });
  const ids = new Map<number, ReturnType<Game['restoreStructure']>>();
  for (const s of d.structures) {
    const n = g.restoreStructure(s.def, s.x, s.z);
    Object.assign(n, { level: s.level, energy: s.energy, mana: s.mana, overcharge: s.overcharge, autocast: s.autocast, heroLevel: s.heroLevel, xp: s.xp, kills: s.kills, damage: s.damage, builtRound: s.builtRound, builtDuringBuild: false });
    ids.set(s.id, n);
  }
  for (const l of d.links) {
    const a = ids.get(l.from), b = ids.get(l.to);
    if (a && b) g.link(a, b);
  }
  g.finishRestore();
  return g;
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d.v === 1 ? d : null;
  } catch { return null; }
}

export function writeSave(g: Game) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot(g))); } catch { /* storage full or blocked */ }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
