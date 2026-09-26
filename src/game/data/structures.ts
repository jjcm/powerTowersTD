// Structure definitions. Numbers are derived from Strilanc's Power Towers v1.31
// (gold x10, WC3 ranges / 80 = cells). In the original almost every stat scales with
// M(L) = 2^L - 1 while the upgrade to level L costs base * 2^(L-1), so damage / power per
// gold stays constant and upgrading is about density. We keep that.

import type { ResearchId } from './research';

export type StructureId =
  | 'wall' | 'pylon' | 'furnace' | 'water_wheel' | 'solar_panel' | 'capacitor'
  | 'mana_well' | 'ley_obelisk' | 'graveyard'
  | 'ballista' | 'cannon' | 'tesla_coil' | 'demon_tower' | 'lich_tower' | 'chemical_tower'
  | 'pyro_trap' | 'dark_tower' | 'vine_trap' | 'tsunami_tower' | 'clock_tower' | 'holy_tower'
  | 'swarm_tower' | 'hero_tower';

export type SpellId =
  | 'thunderstorm' | 'blizzard' | 'meteor' | 'plague' | 'curse' | 'consecrate' | 'whirlpool' | 'overgrowth'
  | 'stormbolt';

export type BuildTab = 'maze' | 'towers1' | 'towers2' | 'arcane';

export interface ResourceSpec {
  cap: number;          // storage at L1
  transfer: number;     // max send / receive per second at L1
  production?: number;  // generated per second at L1 (before environment multipliers)
  relayGrowth?: number; // relays scale cap/transfer by this^(L-1) instead of M(L)
}

export interface AttackSpec {
  damage: number;            // per hit at L1 (x M(L))
  cooldown: number;          // seconds between attacks (unpowered)
  poweredCooldown?: number;  // cooldown while powered (default: cooldown / 1.0)
  range: number;             // cells, measured from structure center
  consumption: number;       // energy / second at L1 while attacking powered (x M(L))
  projectile: ProjectileKind;
  projectileSpeed?: number;  // cells / s
  splash?: number;           // radius; damage falls off 100/50/25%
  hitsAir?: boolean;
}

export type ProjectileKind = 'bolt' | 'cannonball' | 'fireball' | 'frost' | 'acid' | 'shadow' | 'water' | 'light' | 'spark' | 'thorn' | 'arcane' | 'ember';

export interface StructureDef {
  id: StructureId;
  name: string;
  model: string;
  /** A grander model shown from UPGRADE_LOOK_LEVEL on. */
  upgradeModel?: string;
  size: 1 | 2;
  cost: number;
  maxLevel: number;
  tab: BuildTab;
  requires?: ResearchId;
  desc: string;
  powered?: string;           // description of the powered effect
  placement?: 'land' | 'water';
  energy?: ResourceSpec;
  mana?: ResourceSpec;
  /** Can create outgoing links of this resource type. */
  source?: 'energy' | 'mana';
  linkRange?: number;
  maxLinks?: number;
  attack?: AttackSpec;
  spell?: SpellId;
  unique?: boolean;
  /** Tint used for procedural fallback art and UI accents. */
  color: number;
}

export const M = (level: number) => Math.pow(2, level) - 1;
/** Gold to upgrade from level-1 to level (level >= 2), or to build (level 1). */
export const levelCost = (def: StructureDef, level: number) => def.cost * Math.pow(2, level - 1);
/** Total gold invested in a structure at a given level. */
export const totalCost = (def: StructureDef, level: number) => def.cost * M(level);

export const STRUCTURES: Record<StructureId, StructureDef> = {
  // ------------------------------------------------------------------ maze
  wall: {
    id: 'wall', name: 'Wall', model: 'wall_post', size: 1, cost: 10, maxLevel: 3, tab: 'maze', color: 0x6b7a99,
    desc: 'Cheap stone wall. Runners must path around it. Drag to build a line.',
    powered: 'Masonry research unlocks spiked walls that shred adjacent runners.',
  },
  pylon: {
    id: 'pylon', name: 'Pylon', model: 'pylon', size: 1, cost: 30, maxLevel: 6, tab: 'maze', color: 0x49a6ff,
    desc: 'Relays power from generators to towers. Also blocks the path like a wall.',
    energy: { cap: 300, transfer: 30, relayGrowth: 3 }, source: 'energy', linkRange: 6.5, maxLinks: 6,
  },
  furnace: {
    id: 'furnace', name: 'Furnace', model: 'furnace', size: 2, cost: 50, maxLevel: 6, tab: 'maze', color: 0xff8a3c,
    desc: 'Burns nearby grass for power. Scorched grass regrows slowly (faster in rain, but rain dampens the fire).',
    energy: { cap: 250, transfer: 12, production: 8 }, source: 'energy', linkRange: 5.5, maxLinks: 4,
  },
  water_wheel: {
    id: 'water_wheel', name: 'Water Wheel', model: 'water_wheel', size: 2, cost: 100, maxLevel: 6, tab: 'maze', color: 0x3fb3ff,
    desc: 'Reliable power from moving water. Must be built on the water\'s edge. Rain and storms speed it up.',
    placement: 'water', energy: { cap: 300, transfer: 24, production: 16 }, source: 'energy', linkRange: 5.5, maxLinks: 4,
  },
  solar_panel: {
    id: 'solar_panel', name: 'Solar Array', model: 'solar_panel', size: 2, cost: 120, maxLevel: 6, tab: 'maze', color: 0xffd34d,
    requires: 'photovoltaics',
    desc: 'Strong output in full daylight, nothing at night. Clouds and rain cut output.',
    energy: { cap: 300, transfer: 40, production: 26 }, source: 'energy', linkRange: 5.5, maxLinks: 4,
  },
  capacitor: {
    id: 'capacitor', name: 'Capacitor Bank', model: 'capacitor', size: 2, cost: 150, maxLevel: 6, tab: 'maze', color: 0x5fd0ff,
    requires: 'capacitors',
    desc: 'Huge energy storage. Bank solar power during the day and spend it at night.',
    energy: { cap: 2500, transfer: 60 }, source: 'energy', linkRange: 6, maxLinks: 6,
  },

  // ------------------------------------------------------------------ towers I
  ballista: {
    id: 'ballista', name: 'Ballista', model: 'ballista', upgradeModel: 'ballista_2', size: 2, cost: 60, maxLevel: 6, tab: 'towers1', color: 0xc9a46a,
    desc: 'Dependable bolt thrower. Works without power.',
    powered: 'Powered: attack speed +60%.',
    energy: { cap: 40, transfer: 10 },
    attack: { damage: 16, cooldown: 1.0, poweredCooldown: 0.625, range: 6.5, consumption: 3, projectile: 'bolt', projectileSpeed: 22 },
  },
  cannon: {
    id: 'cannon', name: 'Rock Launcher', model: 'cannon', size: 2, cost: 100, maxLevel: 6, tab: 'towers1', color: 0x8d8d8d,
    desc: 'Long range artillery with splash. Fires at a crawl when unpowered.',
    powered: 'Powered: fires 4x as fast.',
    energy: { cap: 50, transfer: 10 },
    attack: { damage: 30, cooldown: 3.0, poweredCooldown: 0.75, range: 11, consumption: 4, projectile: 'cannonball', projectileSpeed: 12, splash: 1.8 },
  },
  tesla_coil: {
    id: 'tesla_coil', name: 'Tesla Coil', model: 'tesla_coil', upgradeModel: 'tesla_coil_2', size: 2, cost: 100, maxLevel: 6, tab: 'towers1', color: 0x57c7ff,
    desc: 'An energy hog that is next to useless unpowered, devastating when fed.',
    powered: 'Powered: chain lightning arcs between multiple runners, halving damage each jump.',
    energy: { cap: 160, transfer: 40 }, spell: 'thunderstorm',
    attack: { damage: 3, cooldown: 1.0, range: 6, consumption: 12, projectile: 'spark' },
  },
  demon_tower: {
    id: 'demon_tower', name: 'Demon Tower', model: 'demon_tower', size: 2, cost: 200, maxLevel: 6, tab: 'towers1', color: 0xff5a2a,
    requires: 'pyrotechnics', spell: 'meteor',
    desc: 'Hurls hellfire bolts.',
    powered: 'Powered: ignites its bolts for heavy bonus fire damage and a lingering burn.',
    energy: { cap: 120, transfer: 40 },
    attack: { damage: 36, cooldown: 0.75, range: 7, consumption: 12, projectile: 'fireball', projectileSpeed: 16 },
  },
  lich_tower: {
    id: 'lich_tower', name: 'Lich Tower', model: 'lich_tower', size: 2, cost: 150, maxLevel: 6, tab: 'towers1', color: 0x9fe6ff,
    requires: 'cryomancy', spell: 'blizzard',
    desc: 'Launches frost bolts.',
    powered: 'Powered: every bolt bursts into a frost nova that slows runners.',
    energy: { cap: 90, transfer: 30 },
    attack: { damage: 30, cooldown: 1.2, range: 7, consumption: 10, projectile: 'frost', projectileSpeed: 14 },
  },
  chemical_tower: {
    id: 'chemical_tower', name: 'Chemical Tower', model: 'chemical_tower', size: 2, cost: 200, maxLevel: 6, tab: 'towers1', color: 0x7dff4a,
    requires: 'alchemy', spell: 'plague',
    desc: 'Rapid-fire acid spitter.',
    powered: 'Powered: lobs a vat of acid every 3s for big impact and poison damage over time.',
    energy: { cap: 150, transfer: 28 },
    attack: { damage: 20, cooldown: 0.4, range: 7, consumption: 9, projectile: 'acid', projectileSpeed: 15 },
  },

  // ------------------------------------------------------------------ towers II
  pyro_trap: {
    id: 'pyro_trap', name: 'Pyro Trap', model: 'pyro_trap', size: 2, cost: 250, maxLevel: 6, tab: 'towers2', color: 0xff7a1a,
    requires: 'pyrotechnics',
    desc: 'Barely scratches runners on its own.',
    powered: 'Powered: every 9s summons a pillar of fire dealing huge area damage and a burn.',
    energy: { cap: 200, transfer: 25 },
    attack: { damage: 2, cooldown: 1.0, range: 3.5, consumption: 9, projectile: 'ember', projectileSpeed: 14 },
  },
  dark_tower: {
    id: 'dark_tower', name: 'Dark Tower', model: 'dark_tower', size: 2, cost: 300, maxLevel: 6, tab: 'towers2', color: 0xa05cff,
    requires: 'necromancy', spell: 'curse',
    desc: 'Weak damage, but spreads despair.',
    powered: 'Powered: Despair makes runners in an area take +30% damage from everything.',
    energy: { cap: 90, transfer: 30 },
    attack: { damage: 26, cooldown: 0.6, range: 5.5, consumption: 10, projectile: 'shadow', projectileSpeed: 15 },
  },
  vine_trap: {
    id: 'vine_trap', name: 'Vine Trap', model: 'vine_trap', size: 2, cost: 150, maxLevel: 6, tab: 'towers2', color: 0x4bd24b,
    requires: 'herbalism', spell: 'overgrowth',
    desc: 'Lashes runners that walk right past it. Build it hugging your maze.',
    powered: 'Powered: periodically entangles runners in place.',
    energy: { cap: 90, transfer: 15 },
    attack: { damage: 90, cooldown: 1.0, range: 2.1, consumption: 6, projectile: 'thorn' },
  },
  tsunami_tower: {
    id: 'tsunami_tower', name: 'Tsunami Tower', model: 'tsunami_tower', size: 2, cost: 200, maxLevel: 6, tab: 'towers2', color: 0x2fa8ff,
    requires: 'hydraulics', spell: 'whirlpool',
    desc: 'Short ranged water jets.',
    powered: 'Powered: water bursts knock runners back along their path and daze them.',
    energy: { cap: 300, transfer: 40 },
    attack: { damage: 20, cooldown: 0.5, range: 3.75, consumption: 12, projectile: 'water', projectileSpeed: 16 },
  },
  clock_tower: {
    id: 'clock_tower', name: 'Clock Tower', model: 'clock_tower', size: 2, cost: 200, maxLevel: 6, tab: 'towers2', color: 0xffe08a,
    requires: 'chronomancy',
    desc: 'Distorts time around it. Deals no damage.',
    powered: 'Powered: nearby towers attack faster (and consume more power).',
    energy: { cap: 40, transfer: 40 },
  },
  holy_tower: {
    id: 'holy_tower', name: 'Holy Tower', model: 'holy_tower', size: 2, cost: 150, maxLevel: 6, tab: 'towers2', color: 0xfff1a8,
    requires: 'divinity', spell: 'consecrate',
    desc: 'Smites runners with light.',
    powered: 'Powered: fires a piercing wave of light that damages everything in a line.',
    energy: { cap: 80, transfer: 15 },
    attack: { damage: 23, cooldown: 1.0, range: 6.25, consumption: 6, projectile: 'light', projectileSpeed: 24 },
  },

  // ------------------------------------------------------------------ arcane
  mana_well: {
    id: 'mana_well', name: 'Mana Well', model: 'mana_well', size: 2, cost: 200, maxLevel: 6, tab: 'arcane', color: 0xb05cff,
    requires: 'arcane',
    desc: 'Draws mana from the earth. Doubled near ley crystals, +50% at night.',
    mana: { cap: 400, transfer: 14, production: 4 }, source: 'mana', linkRange: 6, maxLinks: 4,
  },
  ley_obelisk: {
    id: 'ley_obelisk', name: 'Ley Obelisk', model: 'ley_obelisk', size: 1, cost: 60, maxLevel: 6, tab: 'arcane', color: 0xc77dff,
    requires: 'arcane',
    desc: 'Relays mana to spell-casting towers. Blocks the path.',
    mana: { cap: 200, transfer: 15, relayGrowth: 3 }, source: 'mana', linkRange: 7, maxLinks: 6,
  },
  graveyard: {
    id: 'graveyard', name: 'Graveyard', model: 'graveyard', size: 2, cost: 150, maxLevel: 6, tab: 'arcane', color: 0x66ff99,
    requires: 'necromancy',
    desc: 'Harvests souls of runners that die nearby as mana. Idles at a trickle otherwise.',
    mana: { cap: 1500, transfer: 15, production: 0.8 }, source: 'mana', linkRange: 6, maxLinks: 4,
  },
  swarm_tower: {
    id: 'swarm_tower', name: 'Dragon Roost', model: 'swarm_tower', size: 2, cost: 300, maxLevel: 6, tab: 'arcane', color: 0xff4d4d,
    requires: 'dragonkin',
    desc: 'Heavy long-range dragonfire.',
    powered: 'Powered: hatches dragon whelps that hunt runners for a while.',
    energy: { cap: 300, transfer: 30 },
    attack: { damage: 108, cooldown: 2.0, range: 9, consumption: 10, projectile: 'fireball', projectileSpeed: 13 },
  },
  hero_tower: {
    id: 'hero_tower', name: 'Archmage Tower', model: 'hero_tower', size: 2, cost: 1500, maxLevel: 1, tab: 'arcane', color: 0x6fa8ff,
    requires: 'heroism', unique: true, spell: 'stormbolt',
    desc: 'A hero. Gains experience from kills in range and grows stronger, up to level 6. Runs on mana, not power.',
    mana: { cap: 2000, transfer: 60 },
    attack: { damage: 180, cooldown: 1.4, range: 9, consumption: 0, projectile: 'arcane', projectileSpeed: 20 },
  },
};

export const BUILD_TABS: { id: BuildTab; name: string; icon: string; items: StructureId[] }[] = [
  { id: 'maze', name: 'Maze & Power', icon: 'cat_power', items: ['wall', 'pylon', 'furnace', 'water_wheel', 'solar_panel', 'capacitor'] },
  { id: 'towers1', name: 'Towers', icon: 'cat_defense', items: ['ballista', 'cannon', 'tesla_coil', 'demon_tower', 'lich_tower', 'chemical_tower'] },
  { id: 'towers2', name: 'Advanced', icon: 'cat_defense', items: ['pyro_trap', 'dark_tower', 'vine_trap', 'tsunami_tower', 'clock_tower', 'holy_tower'] },
  { id: 'arcane', name: 'Arcane', icon: 'cat_arcane', items: ['mana_well', 'ley_obelisk', 'graveyard', 'swarm_tower', 'hero_tower'] },
];

export interface SpellDef {
  id: SpellId;
  name: string;
  icon: string;
  mana: number;      // at L1; x (1 + 0.5 (L-1))
  cooldown: number;
  radius: number;
  damage: number;    // x M(L)
  desc: string;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  thunderstorm: { id: 'thunderstorm', name: 'Thunderstorm', icon: 'spell_thunderstorm', mana: 60, cooldown: 12, radius: 2.5, damage: 60,
    desc: 'Calls six lightning strikes on the densest pack of runners.' },
  blizzard: { id: 'blizzard', name: 'Blizzard', icon: 'spell_blizzard', mana: 70, cooldown: 14, radius: 2.2, damage: 45,
    desc: 'Four waves of ice shards that damage and heavily slow.' },
  meteor: { id: 'meteor', name: 'Meteor', icon: 'spell_meteor', mana: 90, cooldown: 16, radius: 1.8, damage: 260,
    desc: 'A meteor slams down after a short delay, leaving burning ground.' },
  plague: { id: 'plague', name: 'Plague Cloud', icon: 'spell_plague', mana: 70, cooldown: 15, radius: 2.0, damage: 35,
    desc: 'A lingering toxic cloud that eats through runners for 6 seconds.' },
  curse: { id: 'curse', name: 'Curse of Doom', icon: 'spell_curse', mana: 50, cooldown: 10, radius: 0, damage: 0,
    desc: 'The toughest runner in range takes +60% damage for 6s. Spreads when it dies.' },
  consecrate: { id: 'consecrate', name: 'Consecrate', icon: 'spell_consecrate', mana: 60, cooldown: 12, radius: 2.2, damage: 40,
    desc: 'Sanctifies the ground, burning runners and stripping their shields.' },
  whirlpool: { id: 'whirlpool', name: 'Whirlpool', icon: 'spell_whirlpool', mana: 80, cooldown: 18, radius: 2.5, damage: 20,
    desc: 'Drags runners into a vortex and holds them there.' },
  overgrowth: { id: 'overgrowth', name: 'Overgrowth', icon: 'spell_overgrowth', mana: 70, cooldown: 16, radius: 2.5, damage: 25,
    desc: 'Vines erupt and root every runner in the area.' },
  stormbolt: { id: 'stormbolt', name: 'Storm Bolt', icon: 'spell_stormbolt', mana: 75, cooldown: 8, radius: 0, damage: 400,
    desc: 'Hurls a magical hammer that stuns and deals heavy damage. Scales with hero level.' },
};

export const isTower = (d: StructureDef) => !!d.attack || d.id === 'clock_tower';
export const isGenerator = (d: StructureDef) => !!(d.energy?.production || d.mana?.production);

/** Towers with an upgraded look switch to it at this level (reached after Engineering). */
export const UPGRADE_LOOK_LEVEL = 4;

/** The model a structure shows at its current level. */
export function structureModel(def: StructureDef, level: number) {
  return def.upgradeModel && level >= UPGRADE_LOOK_LEVEL ? def.upgradeModel : def.model;
}
