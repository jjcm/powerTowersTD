// Recorded sound effects (Kenney CC0 packs, https://kenney.nl). Each game sound picks a random
// variant; `layer` also plays the synthesized recipe (audio.ts) underneath at that gain, so a
// recorded knock can sit on top of a synthetic string snap or sub boom.
// tools/sfx.ts converts exactly the files listed here into public/assets/sfx/*.mp3.

export interface SfxDef {
  files: string[];
  gain: number;
  rate?: [number, number];   // playback-rate range (pitch variation)
  layer?: number;            // also play the synth recipe at this gain
  trim?: number;             // seconds to keep (long sources get cut with a fade)
}

const seq = (base: string, from: number, to: number, pad = 3) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${base}${String(from + i).padStart(pad, '0')}`);

export const SFX: Record<string, SfxDef> = {
  // towers
  bolt: { files: seq('impactWood_light_', 0, 4), gain: 0.38, rate: [0.85, 1.05], layer: 0.6 },
  cannon: { files: seq('explosionCrunch_', 0, 4), gain: 0.45, rate: [0.68, 0.82], layer: 0.6 },
  fire: { files: seq('thrusterFire_', 0, 2), gain: 0.7, rate: [0.95, 1.25], trim: 0.5 },
  blaze: { files: seq('thrusterFire_', 3, 4), gain: 0.5, rate: [0.7, 0.8], layer: 0.6, trim: 1.1 },
  frost: { files: seq('impactGlass_light_', 0, 4), gain: 0.45, rate: [0.9, 1.15], layer: 0.5 },
  acid: { files: seq('slime_', 0, 1), gain: 0.4, rate: [0.9, 1.25] },
  whip: { files: ['knifeSlice', 'knifeSlice2'], gain: 0.35, rate: [0.9, 1.1] },
  thunder: { files: seq('lowFrequency_explosion_', 0, 1), gain: 0.75, rate: [0.55, 0.7], layer: 0.8 },
  // runners
  death: { files: seq('impactSoft_medium_', 0, 4), gain: 0.25, rate: [0.8, 1.1], layer: 0.4 },
  leak: { files: seq('error_', 1, 3), gain: 0.4, layer: 0.6 },
  // building
  build: { files: seq('impactWood_heavy_', 0, 4), gain: 0.6, rate: [0.8, 1.0], layer: 0.35 },
  sell: { files: ['handleCoins', 'handleCoins2'], gain: 0.5, rate: [0.95, 1.08] },
  upgrade: { files: seq('impactMetal_medium_', 0, 4), gain: 0.45, rate: [0.95, 1.1], layer: 0.55 },
  link: { files: seq('switch_', 1, 4), gain: 0.3, rate: [0.95, 1.1], layer: 0.55 },
  research: { files: seq('select_', 1, 4), gain: 0.35 },
  complete: { files: seq('confirmation_', 1, 4), gain: 0.6, layer: 0.8 },
  // interface
  ui_click: { files: seq('click_', 1, 5), gain: 0.3, rate: [0.95, 1.05] },
  ui_error: { files: seq('error_', 4, 6), gain: 0.3 },
};

/** Every file the game references, for preloading and the conversion script. */
export const SFX_FILES = [...new Set(Object.values(SFX).flatMap((d) => d.files))];
