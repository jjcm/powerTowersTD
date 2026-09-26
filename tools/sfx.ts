// Converts the recorded sound effects referenced by src/sfx.ts from the downloaded Kenney
// packs (tools/assets/raw/sfx/*, CC0) into small mono MP3s in public/assets/sfx/.
// Each file is peak-normalized to -1 dBFS; long sources are trimmed with a short fade.
//   npx tsx tools/sfx.ts

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SFX, SFX_FILES } from '../src/sfx';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'tools/assets/raw/sfx');
const OUT = path.join(ROOT, 'public/assets/sfx');
fs.mkdirSync(OUT, { recursive: true });

const index = new Map<string, string>();
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ogg')) index.set(e.name.slice(0, -4), p);
  }
};
walk(RAW);

const trimOf = (file: string) => Object.values(SFX).find((d) => d.files.includes(file))?.trim;
let bytes = 0;
for (const name of SFX_FILES) {
  const src = index.get(name);
  if (!src) { console.error(`missing ${name} (download the Kenney packs into ${RAW})`); process.exitCode = 1; continue; }
  const det = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${src}" -af volumedetect -f null - 2>&1 | grep max_volume`], { encoding: 'utf8' });
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(det)?.[1] ?? 0);
  const trim = trimOf(name);
  const filters = [`volume=${(-1 - peak).toFixed(2)}dB`];
  if (trim) filters.push(`afade=t=out:st=${(trim - 0.12).toFixed(2)}:d=0.12`);
  const out = path.join(OUT, `${name}.mp3`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, ...(trim ? ['-t', String(trim)] : []), '-af', filters.join(','), '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', out]);
  bytes += fs.statSync(out).size;
}
console.log(`${SFX_FILES.length} sounds -> public/assets/sfx (${(bytes / 1024).toFixed(0)} KB)`);
