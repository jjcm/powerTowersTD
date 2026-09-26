export type RunnerTypeId =
  | 'grunt' | 'scout' | 'brute' | 'skeleton' | 'troll' | 'wraith' | 'sapper' | 'leech' | 'warlord';

export interface RunnerType {
  id: RunnerTypeId;
  name: string;
  model: string;
  hp: number;          // multiplier on the round's base hp
  speed: number;       // cells / s
  armor: number;       // WC3-style: reduction = 0.06a / (1 + 0.06a)
  bounty: number;      // multiplier
  lives: number;
  scale: number;       // visual height in cells
  flying?: boolean;    // hovers (visual only; still follows the maze)
  shield?: number;     // fraction of max hp as regenerating shield
  regen?: number;      // fraction of max hp per second
  drain?: boolean;     // feedback: drains energy from towers that hit it
  saboteur?: boolean;  // throws EMP charges at generators / relays
  leech?: boolean;     // siphons power from links it passes under
  boss?: boolean;
  desc: string;
}

export const RUNNERS: Record<RunnerTypeId, RunnerType> = {
  grunt: { id: 'grunt', name: 'Orc Grunt', model: 'orc_grunt', hp: 1, speed: 2.6, armor: 0, bounty: 1, lives: 1, scale: 0.95, desc: 'Standard runner.' },
  scout: { id: 'scout', name: 'Goblin Scout', model: 'goblin_scout', hp: 0.65, speed: 3.7, armor: 0, bounty: 1, lives: 1, scale: 0.7, desc: 'Fast and fragile.' },
  brute: { id: 'brute', name: 'Ogre Brute', model: 'ogre_brute', hp: 1.5, speed: 2.1, armor: 3, bounty: 1.5, lives: 1, scale: 1.25, shield: 0.4,
    desc: 'Armored, with a shield that regenerates if it avoids damage for 3 seconds.' },
  skeleton: { id: 'skeleton', name: 'Skeleton', model: 'skeleton_warrior', hp: 0.9, speed: 2.8, armor: 1, bounty: 1, lives: 1, scale: 0.95,
    desc: 'Undead. Immune to poison. Graveyards harvest double souls from them.' },
  troll: { id: 'troll', name: 'Troll Berserker', model: 'troll_berserker', hp: 1.2, speed: 3.0, armor: 0, bounty: 1.2, lives: 1, scale: 1.05, regen: 0.005,
    desc: 'Regenerates 0.5% health per second after 2 seconds without taking a hit. Punishes gaps in your defense.' },
  wraith: { id: 'wraith', name: 'Wraith', model: 'wraith', hp: 0.9, speed: 2.8, armor: 0, bounty: 1.2, lives: 1, scale: 1.0, flying: true, drain: true,
    desc: 'Feedback: every hit drains energy from the tower that struck it.' },
  sapper: { id: 'sapper', name: 'Goblin Sapper', model: 'goblin_sapper', hp: 0.85, speed: 2.7, armor: 1, bounty: 1.3, lives: 1, scale: 0.75, saboteur: true,
    desc: 'Hurls EMP charges at nearby generators and relays, knocking them offline.' },
  leech: { id: 'leech', name: 'Power Leech', model: 'power_leech', hp: 0.8, speed: 2.5, armor: 2, bounty: 1.3, lives: 1, scale: 0.6, leech: true,
    desc: 'Siphons energy from any power link it passes beneath, healing itself.' },
  warlord: { id: 'warlord', name: 'Orc Warlord', model: 'orc_warlord', hp: 10, speed: 1.9, armor: 4, bounty: 12, lives: 5, scale: 1.6, boss: true,
    desc: 'Boss. Enormous health, costs 5 lives if it gets through, and rallies nearby runners (+20% speed).' },
};

export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';

export const DIFFICULTIES: Record<Difficulty, { name: string; coef: [number, number, number, number]; lives: number; gold: number; desc: string }> = {
  // Polynomials from the original map (Noob / Rookie / Hotshot / Veteran), scaled for single-player wave sizes.
  easy: { name: 'Squire', coef: [20, 8, 12, 0], lives: 30, gold: 500, desc: 'Forgiving. Learn the power grid.' },
  normal: { name: 'Knight', coef: [20, 10, 25, 0], lives: 20, gold: 400, desc: 'The intended experience.' },
  hard: { name: 'Warlord', coef: [15, 0, 35, 0], lives: 15, gold: 350, desc: 'The original Rookie curve. Maze well or die.' },
  brutal: { name: 'Doom', coef: [50, 21, 28, 1], lives: 10, gold: 300, desc: 'Cubic health growth, like Hotshot in the original.' },
};

export const MAX_ROUND = 30;
const HP_SCALE = 0.36;

export function roundBaseHp(round: number, difficulty: Difficulty): number {
  const [a, b, c, d] = DIFFICULTIES[difficulty].coef;
  let hp = a + b * round + c * round * round + d * round * round * round;
  if (round > MAX_ROUND) hp *= Math.pow(1.1, round - MAX_ROUND);
  hp *= HP_SCALE;
  // gentle on-ramp: early rounds are softer while players learn mazing and power
  hp *= 0.55 + 0.45 * Math.min(1, round / 12);
  return Math.max(20, Math.round(hp / 5) * 5);
}

export interface WaveGroup { type: RunnerTypeId; count: number }
export interface WaveDef { round: number; groups: WaveGroup[]; interval: number; name?: string; modifiers: string[] }

function count(round: number) { return 16 + round; }

// Hand-authored progression for the first 30 rounds; endless mode mixes everything.
const SCRIPT: Record<number, [string, [RunnerTypeId, number][]]> = {
  1: ['First Blood', [['grunt', 1]]],
  2: ['', [['grunt', 1]]],
  3: ['', [['grunt', 0.7], ['skeleton', 0.3]]],
  4: ['', [['grunt', 0.6], ['skeleton', 0.4]]],
  5: ['Speed Round', [['scout', 1]]],
  6: ['', [['grunt', 0.5], ['skeleton', 0.3], ['troll', 0.2]]],
  7: ['Trolls', [['troll', 0.7], ['grunt', 0.3]]],
  8: ['Saboteurs', [['grunt', 0.6], ['sapper', 0.4]]],
  9: ['', [['skeleton', 0.5], ['troll', 0.3], ['sapper', 0.2]]],
  10: ['Feedback · Warlord', [['wraith', 0.7], ['grunt', 0.3], ['warlord', 0]]],
  11: ['', [['grunt', 0.4], ['troll', 0.3], ['scout', 0.3]]],
  12: ['Leeches', [['leech', 0.6], ['grunt', 0.4]]],
  13: ['', [['skeleton', 0.4], ['sapper', 0.3], ['wraith', 0.3]]],
  14: ['', [['troll', 0.5], ['leech', 0.25], ['scout', 0.25]]],
  15: ['Speed · Feedback', [['scout', 0.6], ['wraith', 0.4]]],
  16: ['Brutes', [['brute', 0.6], ['grunt', 0.4]]],
  17: ['', [['brute', 0.3], ['sapper', 0.3], ['leech', 0.4]]],
  18: ['', [['troll', 0.4], ['skeleton', 0.3], ['wraith', 0.3]]],
  19: ['', [['brute', 0.4], ['scout', 0.3], ['sapper', 0.3]]],
  20: ['Shield · Warlord', [['brute', 0.8], ['grunt', 0.2], ['warlord', 0]]],
  21: ['', [['leech', 0.35], ['wraith', 0.35], ['troll', 0.3]]],
  22: ['', [['brute', 0.4], ['skeleton', 0.3], ['sapper', 0.3]]],
  23: ['', [['scout', 0.4], ['troll', 0.3], ['leech', 0.3]]],
  24: ['', [['brute', 0.35], ['wraith', 0.35], ['sapper', 0.3]]],
  25: ['Speed · Shield', [['scout', 0.5], ['brute', 0.5]]],
  26: ['', [['troll', 0.3], ['brute', 0.3], ['leech', 0.2], ['sapper', 0.2]]],
  27: ['', [['wraith', 0.4], ['skeleton', 0.3], ['scout', 0.3]]],
  28: ['', [['brute', 0.4], ['troll', 0.3], ['leech', 0.3]]],
  29: ['', [['sapper', 0.3], ['wraith', 0.3], ['brute', 0.4]]],
  30: ['The Horde · Warlords', [['brute', 0.25], ['scout', 0.25], ['wraith', 0.25], ['troll', 0.25], ['warlord', 0]]],
};

export function buildWave(round: number, rng: () => number): WaveDef {
  const n = count(round);
  let name = '';
  let mix: [RunnerTypeId, number][];
  if (SCRIPT[round]) {
    [name, mix] = SCRIPT[round];
  } else {
    const pool: RunnerTypeId[] = ['grunt', 'scout', 'brute', 'skeleton', 'troll', 'wraith', 'sapper', 'leech'];
    const picks = new Set<RunnerTypeId>();
    while (picks.size < 3) picks.add(pool[Math.floor(rng() * pool.length)]);
    mix = [...picks].map((t) => [t, 1 / 3] as [RunnerTypeId, number]);
    if (round % 5 === 0) mix.push(['warlord', 0]);
    name = round % 10 === 0 ? 'Endless · Warlords' : 'Endless';
  }
  const groups: WaveGroup[] = [];
  let remaining = n;
  mix.forEach(([type, frac], i) => {
    if (type === 'warlord') return;
    const c = i === mix.length - 1 || mix.slice(i + 1).every(([t]) => t === 'warlord') ? remaining : Math.round(n * frac);
    remaining -= c;
    if (c > 0) groups.push({ type, count: c });
  });
  const bosses = mix.some(([t]) => t === 'warlord') ? (round >= 30 ? 3 : round >= 20 ? 2 : 1) : 0;
  if (bosses) groups.push({ type: 'warlord', count: bosses });
  const modifiers: string[] = [];
  return { round, groups, interval: Math.max(0.35, 1.15 - round * 0.02), name, modifiers };
}

export const bountyFor = (round: number, type: RunnerType) => Math.max(1, Math.round((5 + 0.8 * round) * type.bounty));
export const roundBonus = (round: number) => 60 + 12 * round;
