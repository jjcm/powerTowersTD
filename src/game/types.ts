import type { StructureDef, ProjectileKind, SpellId } from './data/structures';
import type { RunnerType } from './data/runners';

export type Resource = 'energy' | 'mana';

export interface Link {
  id: number;
  from: Structure;
  to: Structure;
  kind: Resource;
  /** Smoothed flow in units / second, for visuals and UI. */
  flow: number;
  tickFlow: number;
  /** Amount siphoned by leeches this tick (visual). */
  leeched: number;
}

export interface Structure {
  id: number;
  def: StructureDef;
  x: number; z: number;       // top-left cell
  cx: number; cz: number;     // center (world, cells)
  y: number;                  // ground height
  level: number;
  onPlateau: boolean;
  energy: number; mana: number;
  links: Link[];              // outgoing
  inLinks: Link[];
  // combat
  cooldown: number;
  special: number;            // cooldown for periodic powered abilities
  spellCd: number;
  autocast: boolean;
  overcharge: boolean;
  heat: number;
  overheated: number;
  disabled: number;           // EMP timer
  haste: number; hasteAmt: number;
  targetId: number;
  aim: number;                // facing angle (radians) toward last target
  poweredGlow: number;        // 0..1 visual
  lastFire: number;           // sim time of last attack
  // bookkeeping
  receivedE: number; receivedM: number; snapE: number; snapM: number;
  flowIn: number; flowOut: number;  // smoothed energy flow for UI
  manaIn: number;
  producing: number;          // smoothed production / s
  kills: number; damage: number;
  // generators
  grassCells?: number[];
  nearLey?: boolean;
  // hero
  xp: number; heroLevel: number;
  whelps: number;
  builtRound: number;
  builtDuringBuild: boolean;
}

export interface Crumb { x: number; z: number; leg: number }

export interface Runner {
  id: number;
  type: RunnerType;
  hp: number; maxHp: number;
  shield: number; shieldMax: number; shieldDelay: number;
  regenDelay: number;
  x: number; z: number;
  leg: number;
  heading: number;
  speedMul: number;           // current effective multiplier (for anim)
  moving: boolean;
  wp: { x: number; z: number } | null;
  wpVersion: number;
  repath: number;
  crumbs: Crumb[];
  crumbDist: number;
  slowAmt: number; slowT: number;
  rootT: number; stunT: number;
  vulnAmt: number; vulnT: number;
  curseT: number;
  burnDps: number; burnT: number;
  poisonDps: number; poisonT: number;
  sabotageCd: number;
  progress: number;           // remaining path distance (lower = closer to leaking)
  alive: boolean;
  bounty: number;
  lastHitBy: number;
  hitFlash: number;
  knock: number;              // visual knockback timer
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  tx: number; ty: number; tz: number;
  targetId: number;
  speed: number;
  damage: number;
  sourceId: number;
  powered: boolean;
  splash: number;
  arc: number;                // parabolic arc height
  t: number; dur: number;
  onHit?: (x: number, z: number, target: Runner | undefined) => void;
}

export interface Whelp {
  id: number;
  ownerId: number;
  x: number; y: number; z: number;
  heading: number;
  life: number;
  cooldown: number;
  damage: number;
  targetId: number;
}

export interface Zone {
  id: number;
  kind: 'fire' | 'plague' | 'consecrate' | 'whirlpool' | 'blizzard' | 'thunder';
  x: number; z: number; r: number;
  t: number; dur: number;
  dps: number;
  sourceId: number;
  tick: number;
}

export type GameEvent =
  | { type: 'hit'; kind: string; x: number; z: number; y?: number; powered?: boolean; r?: number }
  | { type: 'chain'; points: { x: number; y: number; z: number }[]; powered: boolean }
  | { type: 'nova'; x: number; z: number; r: number; kind: 'frost' | 'water' | 'despair' | 'entangle' | 'clock' | 'emp' | 'fire' | 'holy' | 'arcane' }
  | { type: 'beam'; kind: 'holy' | 'vine' | 'drain'; x1: number; z1: number; x2: number; z2: number; y1?: number }
  | { type: 'spell'; spell: SpellId; x: number; z: number; r: number; sourceId: number }
  | { type: 'strike'; x: number; z: number; y: number; targetId?: number }
  | { type: 'emp'; x1: number; z1: number; x2: number; z2: number; targetId: number }
  | { type: 'text'; x: number; z: number; y?: number; text: string; color: string; big?: boolean }
  | { type: 'death'; runnerId: number; x: number; z: number; cause: string }
  | { type: 'leak'; runnerId: number }
  | { type: 'overheat'; structureId: number }
  | { type: 'build'; structureId: number }
  | { type: 'sell'; x: number; z: number; size: number }
  | { type: 'upgrade'; structureId: number }
  | { type: 'soul'; x: number; z: number; toId: number }
  | { type: 'message'; text: string; kind?: 'info' | 'warn' | 'good' | 'round' }
  | { type: 'sound'; name: string; x?: number; z?: number; vol?: number };
