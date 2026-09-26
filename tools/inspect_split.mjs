// Dev helper: preview a triangle classification for a tower rig (colors = parts).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const id = process.argv[2];
const doc = await io.read(`tools/assets/raw/models/${id}.glb`);
const tris = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const a = p.getAttribute('POSITION').getArray(), ix = p.getIndices().getArray();
    const P = (i) => { const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2]; return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; };
    for (let t = 0; t < ix.length; t += 3) { const A = P(ix[t]), B = P(ix[t + 1]), C = P(ix[t + 2]); tris.push([(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3]); }
  }
}
const min = [0, 1, 2].map((k) => Math.min(...tris.map((p) => p[k]))), max = [0, 1, 2].map((k) => Math.max(...tris.map((p) => p[k])));
const H = max[1] - min[1];
const yr = (p) => (p[1] - min[1]) / H;
const mid = tris.filter((p) => yr(p) > 0.3 && yr(p) < 0.45);
const ax = (Math.min(...mid.map((p) => p[0])) + Math.max(...mid.map((p) => p[0]))) / 2, az = (Math.min(...mid.map((p) => p[2])) + Math.max(...mid.map((p) => p[2]))) / 2;
console.log('axis', ax.toFixed(3), az.toFixed(3), 'H', H.toFixed(3));
const cfg = JSON.parse(process.argv[3] ?? '{}');
// PCA of clearly-barrel points (cannon)
let bc = [0, 0, 0], bd = [1, 0, 0];
if (id.startsWith('cannon')) {
  const cen = (ps) => [0, 1, 2].map((k) => ps.reduce((a, p) => a + p[k], 0) / ps.length);
  const top = tris.filter((p) => yr(p) > cfg.split + 0.05);
  const minDx = Math.min(...top.map((p) => (p[0] - ax) / H));
  const muzzle = cen(top.filter((p) => (p[0] - ax) / H < minDx + cfg.muzzleSlice));
  const breech = cen(top.filter((p) => yr(p) > cfg.breechY && (p[0] - ax) / H > cfg.breechX));
  bc = breech;
  const d = [muzzle[0] - breech[0], muzzle[1] - breech[1], muzzle[2] - breech[2]];
  const l = Math.hypot(...d); bd = d.map((x) => x / l);
  cfg.len = l / H;
  console.log('barrel axis', bd.map((x) => x.toFixed(3)).join(','), 'len', cfg.len.toFixed(3), 'breech', [(breech[0] - ax) / H, yr(breech), (breech[2] - az) / H].map((x) => x.toFixed(3)).join(','));
}
const cls = (p) => {
  const y = yr(p), dx = (p[0] - ax) / H, dz = (p[2] - az) / H;
  if (y < cfg.split) return 0; // base
  if (id.startsWith('ballista')) {
    if (dx > cfg.crankX && dz < cfg.crankZ && dz > cfg.crankZ2 && y > cfg.limbY) return 5; // winch crank
    if (Math.abs(dx) > cfg.limb && y > cfg.limbY) return dx < 0 ? 2 : 3; // limbs
    if (Math.abs(dx) < cfg.boltW && y > cfg.boltY && dz > cfg.boltZ) return 4; // bolt
    return 1;
  } else {
    // barrel: everything within radius of the fitted barrel axis
    const v = [p[0] - bc[0], p[1] - bc[1], p[2] - bc[2]];
    const t = v[0] * bd[0] + v[1] * bd[1] + v[2] * bd[2];
    const d = Math.hypot(v[0] - bd[0] * t, v[1] - bd[1] * t, v[2] - bd[2] * t) / H;
    if (d < cfg.barrelR && t / H > cfg.barrelT0 && t / H < cfg.len + 0.08) return 2;
    return 1;
  }
};
const counts = [0, 0, 0, 0, 0, 0];
const colors = ['#666', '#4af', '#f84', '#fd4', '#f4f', '#4f4'];
const W = 420, pad = 10, L = Math.max(...[0, 1, 2].map((k) => max[k] - min[k]));
const views = [['side x-y (fwd=-x left)', 0, 1], ['front z-y', 2, 1], ['top x-z', 0, 2]];
const c = tris.map(cls); c.forEach((k) => counts[k]++);
console.log('counts base/turret/p2/p3/p4/p5', counts.join(' '));
for (const k of [2, 3, 4, 5]) { const ps = tris.filter((_, i) => c[i] === k).map((p) => [(p[0] - ax) / H, yr(p), (p[2] - az) / H]); if (!ps.length) continue; console.log('part', k, 'dx', Math.min(...ps.map((p) => p[0])).toFixed(3), Math.max(...ps.map((p) => p[0])).toFixed(3), 'y', Math.min(...ps.map((p) => p[1])).toFixed(3), Math.max(...ps.map((p) => p[1])).toFixed(3), 'dz', Math.min(...ps.map((p) => p[2])).toFixed(3), Math.max(...ps.map((p) => p[2])).toFixed(3)); }
{ const ps = tris.filter((_, i) => c[i] === 1).map((p) => [(p[0] - ax) / H, yr(p), (p[2] - az) / H]); console.log('turret dx', Math.min(...ps.map((p) => p[0])).toFixed(3), Math.max(...ps.map((p) => p[0])).toFixed(3), 'dz', Math.min(...ps.map((p) => p[2])).toFixed(3), Math.max(...ps.map((p) => p[2])).toFixed(3)); }
const svgs = views.map(([name, a, b]) => {
  const dots = tris.map((p, i) => {
    if (b === 2 && c[i] === 0) return '';
    const u = pad + ((p[a] - min[a]) / L) * (W - 2 * pad), v = b === 1 ? W - pad - ((p[b] - min[b]) / L) * (W - 2 * pad) : pad + ((p[b] - min[b]) / L) * (W - 2 * pad);
    return i % 2 ? '' : `<rect x="${u.toFixed(1)}" y="${v.toFixed(1)}" width="1.2" height="1.2" fill="${colors[c[i]]}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="#112"/>${dots}<text x="4" y="12" fill="#ff0" font-size="12">${name}</text></svg>`;
});
const bufs = await Promise.all(svgs.map((s) => sharp(Buffer.from(s)).png().toBuffer()));
await sharp({ create: { width: W * 3, height: W, channels: 3, background: '#000' } }).composite(bufs.map((b, i) => ({ input: b, left: i * W, top: 0 }))).png().toFile(`tools/assets/raw/split_${id}.png`);
