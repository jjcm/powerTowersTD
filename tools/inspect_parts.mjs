// Dev helper: profile a model's geometry to find where turret/base/limbs separate.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const id = process.argv[2];
const doc = await io.read(`tools/assets/raw/models/${id}.glb`);
const pts = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const a = p.getAttribute('POSITION').getArray();
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i], y = a[i + 1], z = a[i + 2];
      pts.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]);
    }
  }
}
const min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2, H = max[1] - min[1];
console.log(id, 'verts', pts.length, 'size', max.map((v, k) => (v - min[k]).toFixed(3)).join(' x '));
const S = 20;
for (let s = 0; s < S; s++) {
  const y0 = min[1] + (H * s) / S, y1 = min[1] + (H * (s + 1)) / S;
  const sl = pts.filter((p) => p[1] >= y0 && p[1] < y1);
  if (!sl.length) { console.log(`${(s / S).toFixed(2)} -`); continue; }
  const xs = sl.map((p) => p[0] - cx), zs = sl.map((p) => p[2] - cz);
  const r = Math.max(...sl.map((p) => Math.hypot(p[0] - cx, p[2] - cz)));
  console.log(`${(s / S).toFixed(2)} n=${String(sl.length).padStart(5)} r=${r.toFixed(3)} x[${Math.min(...xs).toFixed(2)},${Math.max(...xs).toFixed(2)}] z[${Math.min(...zs).toFixed(2)},${Math.max(...zs).toFixed(2)}]`);
}
// scatter plots: side (x,y), front (z,y), top (x,z)
const W = 400, pad = 10;
const views = [['side x-y', 0, 1], ['front z-y', 2, 1], ['top x-z', 0, 2]];
const L = Math.max(...[0, 1, 2].map((k) => max[k] - min[k]));
const svgs = views.map(([name, a, b]) => {
  const dots = pts.filter((_, i) => i % 3 === 0).map((p) => {
    const u = pad + ((p[a] - min[a]) / L) * (W - 2 * pad), v = b === 1 ? W - pad - ((p[b] - min[b]) / L) * (W - 2 * pad) : pad + ((p[b] - min[b]) / L) * (W - 2 * pad);
    return `<rect x="${u.toFixed(1)}" y="${v.toFixed(1)}" width="1" height="1" fill="#fff" fill-opacity="0.35"/>`;
  }).join('');
  const grid = Array.from({ length: 11 }, (_, i) => b === 1 ? `<line x1="0" x2="${W}" y1="${W - pad - (i / 10) * (H / L) * (W - 2 * pad)}" y2="${W - pad - (i / 10) * (H / L) * (W - 2 * pad)}" stroke="#f00" stroke-opacity="0.4"/><text x="2" y="${W - pad - (i / 10) * (H / L) * (W - 2 * pad) - 2}" fill="#f88" font-size="10">${(i / 10).toFixed(1)}</text>` : '').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="#223"/>${grid}${dots}<text x="4" y="12" fill="#ff0" font-size="12">${name}</text></svg>`;
});
const bufs = await Promise.all(svgs.map((s) => sharp(Buffer.from(s)).png().toBuffer()));
await sharp({ create: { width: W * 3, height: W, channels: 3, background: '#000' } }).composite(bufs.map((b, i) => ({ input: b, left: i * W, top: 0 }))).png().toFile(`tools/assets/raw/parts_${id}.png`);
