import type { StructureId } from './structures';

export type ResearchId =
  | 'engineering' | 'photovoltaics' | 'pyrotechnics' | 'cryomancy' | 'alchemy' | 'masonry'
  | 'arcane' | 'capacitors' | 'hydraulics' | 'herbalism' | 'necromancy' | 'chronomancy'
  | 'spellweaving' | 'master_engineering' | 'divinity' | 'dragonkin' | 'heroism'
  | 'leymastery' | 'superconductors';

export interface ResearchDef {
  id: ResearchId;
  name: string;
  tier: 1 | 2 | 3 | 4;
  cost: number;
  time: number;        // seconds of game time
  requires: ResearchId[];
  /** Additionally require this many completed researches from lower tiers. */
  requiresCount?: number;
  icon: string;
  desc: string;
  unlocks?: StructureId[];
  col: number;         // column in the tech tree view
}

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  // ---- tier 1
  engineering: { id: 'engineering', name: 'Advanced Engineering', tier: 1, cost: 150, time: 20, requires: [], icon: 'res_engineering', col: 0,
    desc: 'Structures can be upgraded to level 4 (from 2).' },
  masonry: { id: 'masonry', name: 'Masonry', tier: 1, cost: 100, time: 15, requires: [], icon: 'res_masonry', col: 1,
    desc: 'Walls can be upgraded with iron spikes that damage runners walking alongside.' },
  photovoltaics: { id: 'photovoltaics', name: 'Photovoltaics', tier: 1, cost: 150, time: 20, requires: [], icon: 'res_solar', col: 2,
    desc: 'Unlocks the Solar Array.', unlocks: ['solar_panel'] },
  pyrotechnics: { id: 'pyrotechnics', name: 'Pyrotechnics', tier: 1, cost: 150, time: 20, requires: [], icon: 'res_pyro', col: 3,
    desc: 'Unlocks the Demon Tower and Pyro Trap.', unlocks: ['demon_tower', 'pyro_trap'] },
  cryomancy: { id: 'cryomancy', name: 'Cryomancy', tier: 1, cost: 150, time: 20, requires: [], icon: 'res_cryo', col: 4,
    desc: 'Unlocks the Lich Tower.', unlocks: ['lich_tower'] },
  alchemy: { id: 'alchemy', name: 'Alchemy', tier: 1, cost: 150, time: 20, requires: [], icon: 'res_alchemy', col: 5,
    desc: 'Unlocks the Chemical Tower.', unlocks: ['chemical_tower'] },

  // ---- tier 2
  capacitors: { id: 'capacitors', name: 'Capacitors', tier: 2, cost: 300, time: 30, requires: ['photovoltaics'], icon: 'res_capacitors', col: 2,
    desc: 'Unlocks the Capacitor Bank and Overcharge: push combat towers past their rating for +50% damage and +30% speed at the cost of heat and double power.',
    unlocks: ['capacitor'] },
  arcane: { id: 'arcane', name: 'Arcane Studies', tier: 2, cost: 400, time: 40, requires: [], requiresCount: 2, icon: 'res_arcane', col: 3,
    desc: 'Discover mana, a second energy network. Unlocks the Mana Well and Ley Obelisk.', unlocks: ['mana_well', 'ley_obelisk'] },
  hydraulics: { id: 'hydraulics', name: 'Hydraulics', tier: 2, cost: 300, time: 30, requires: [], requiresCount: 2, icon: 'res_hydraulics', col: 0,
    desc: 'Unlocks the Tsunami Tower.', unlocks: ['tsunami_tower'] },
  herbalism: { id: 'herbalism', name: 'Herbalism', tier: 2, cost: 300, time: 30, requires: [], requiresCount: 2, icon: 'res_herbalism', col: 1,
    desc: 'Unlocks the Vine Trap.', unlocks: ['vine_trap'] },
  necromancy: { id: 'necromancy', name: 'Necromancy', tier: 2, cost: 400, time: 35, requires: ['arcane'], icon: 'res_necromancy', col: 4,
    desc: 'Unlocks the Graveyard (souls become mana) and the Dark Tower.', unlocks: ['graveyard', 'dark_tower'] },
  chronomancy: { id: 'chronomancy', name: 'Chronomancy', tier: 2, cost: 400, time: 35, requires: ['arcane'], icon: 'res_chrono', col: 5,
    desc: 'Unlocks the Clock Tower.', unlocks: ['clock_tower'] },

  // ---- tier 3
  master_engineering: { id: 'master_engineering', name: 'Master Engineering', tier: 3, cost: 800, time: 50, requires: ['engineering'], requiresCount: 4, icon: 'res_master_engineering', col: 0,
    desc: 'Structures can be upgraded to level 6.' },
  dragonkin: { id: 'dragonkin', name: 'Dragonkin', tier: 3, cost: 700, time: 45, requires: ['pyrotechnics'], requiresCount: 4, icon: 'res_dragonkin', col: 1,
    desc: 'Unlocks the Dragon Roost.', unlocks: ['swarm_tower'] },
  spellweaving: { id: 'spellweaving', name: 'Spellweaving', tier: 3, cost: 700, time: 45, requires: ['arcane'], requiresCount: 4, icon: 'res_spellweaving', col: 3,
    desc: 'Mana-linked towers learn to cast spells: Thunderstorm, Blizzard, Meteor, Plague Cloud, Curse, Consecrate, Whirlpool and Overgrowth.' },
  divinity: { id: 'divinity', name: 'Divinity', tier: 3, cost: 600, time: 40, requires: ['arcane'], requiresCount: 4, icon: 'res_divinity', col: 4,
    desc: 'Unlocks the Holy Tower.', unlocks: ['holy_tower'] },
  heroism: { id: 'heroism', name: 'Heroism', tier: 3, cost: 900, time: 50, requires: ['spellweaving'], icon: 'res_heroism', col: 5,
    desc: 'Unlocks the Archmage Tower, a unique hero that levels up.', unlocks: ['hero_tower'] },

  // ---- tier 4
  superconductors: { id: 'superconductors', name: 'Superconductors', tier: 4, cost: 1200, time: 60, requires: ['capacitors', 'master_engineering'], icon: 'res_superconductors', col: 1,
    desc: 'All transfer rates +50%, link range +2, overcharge heat -30%.' },
  leymastery: { id: 'leymastery', name: 'Ley Mastery', tier: 4, cost: 1200, time: 60, requires: ['spellweaving'], requiresCount: 8, icon: 'res_leymastery', col: 4,
    desc: 'Mana generation +50%, spells cost 25% less and deal 25% more damage.' },
};

export const RESEARCH_ORDER = Object.values(RESEARCH).sort((a, b) => a.tier - b.tier || a.col - b.col);
