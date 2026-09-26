// Persistent battle damage painted into the ground. 4 texels per cell over the play area.
//   R trample  : footsteps and blasts press grass flat -> dirt -> churned mud
//   G scorch   : fire, lightning, furnaces
//   B crater   : explosions dent the terrain (vertex displacement + normal bend)
//   A temp     : 0.5 neutral, >0.5 glowing embers, <0.5 frost (decays back to neutral)
// The terrain, grass and clutter shaders all sample this texture, so a Tesla-blasted meadow
// slowly turns into a battlefield.

import * as THREE from 'three';
import { Grid, W, H, Terrain } from '../game/grid';

export const DMG_RES = 4;
const DW = W * DMG_RES, DH = H * DMG_RES;

export interface Stamp { trample?: number; scorch?: number; crater?: number; heat?: number; frost?: number }

export class GroundDamage {
  trample = new Float32Array(DW * DH);
  scorch = new Float32Array(DW * DH);
  crater = new Float32Array(DW * DH);
  temp = new Float32Array(DW * DH);
  private data = new Uint8Array(DW * DH * 4);
  tex: THREE.DataTexture;
  private dirty = true;
  private uploadT = 0;
  private decayT = 0;

  constructor(private grid: Grid) {
    this.tex = new THREE.DataTexture(this.data, DW, DH, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
  }

  /** Radial stamp with a soft edge. Amounts are added (saturating at 1). */
  stamp(x: number, z: number, r: number, s: Stamp) {
    const cx = x * DMG_RES, cz = z * DMG_RES, rr = Math.max(0.5, r * DMG_RES);
    const x0 = Math.max(0, Math.floor(cx - rr)), x1 = Math.min(DW - 1, Math.ceil(cx + rr));
    const z0 = Math.max(0, Math.floor(cz - rr)), z1 = Math.min(DH - 1, Math.ceil(cz + rr));
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / rr;
      if (d >= 1) continue;
      const f = 1 - d * d * (3 - 2 * d); // smooth falloff
      const k = j * DW + i;
      if (s.trample) this.trample[k] = Math.min(1, this.trample[k] + s.trample * f);
      if (s.scorch) this.scorch[k] = Math.min(1, this.scorch[k] + s.scorch * f);
      if (s.crater) this.crater[k] = Math.min(1, this.crater[k] + s.crater * f);
      if (s.heat) this.temp[k] = Math.min(1, this.temp[k] + s.heat * f);
      if (s.frost) this.temp[k] = Math.max(-1, this.temp[k] - s.frost * f);
    }
    this.dirty = true;
  }

  /** Stamp along a segment (beams). */
  line(x1: number, z1: number, x2: number, z2: number, r: number, s: Stamp) {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / Math.max(0.25, r)));
    for (let i = 0; i <= n; i++) this.stamp(x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n, r, s);
  }

  update(dt: number) {
    this.decayT += dt;
    if (this.decayT >= 0.25) {
      const t = this.decayT;
      this.decayT = 0;
      // temperature relaxes quickly; scars heal very slowly (grass creeps back)
      const tr = Math.min(1, t * 0.18);
      const heal = t * 0.0012, scorchHeal = t * 0.0035, craterHeal = t * 0.0004;
      for (let k = 0; k < DW * DH; k++) {
        const tp = this.temp[k];
        if (tp !== 0) { const n = tp - tp * tr; this.temp[k] = Math.abs(n) < 0.01 ? 0 : n; }
        if (this.trample[k] > 0) this.trample[k] = Math.max(0, this.trample[k] - heal);
        if (this.scorch[k] > 0) this.scorch[k] = Math.max(0, this.scorch[k] - scorchHeal);
        if (this.crater[k] > 0) this.crater[k] = Math.max(0, this.crater[k] - craterHeal);
      }
      this.dirty = true;
    }
    this.uploadT -= dt;
    if (this.dirty && this.uploadT <= 0) this.upload();
  }

  private upload() {
    this.uploadT = 0.08;
    this.dirty = false;
    const g = this.grid, d = this.data;
    // per-cell furnace burn, bilinearly interpolated so it doesn't show as blocks
    const burnCell = (cx: number, cz: number) => {
      cx = Math.max(0, Math.min(W - 1, cx)); cz = Math.max(0, Math.min(H - 1, cz));
      const c = cz * W + cx;
      return g.terrain[c] === Terrain.Grass ? Math.max(0, 1 - g.grass[c] * 1.25) : 0;
    };
    for (let j = 0; j < DH; j++) for (let i = 0; i < DW; i++) {
      const k = j * DW + i;
      const fx = (i + 0.5) / DMG_RES - 0.5, fz = (j + 0.5) / DMG_RES - 0.5;
      const x0 = Math.floor(fx), z0 = Math.floor(fz), u = fx - x0, v = fz - z0;
      const burnt = burnCell(x0, z0) * (1 - u) * (1 - v) + burnCell(x0 + 1, z0) * u * (1 - v) + burnCell(x0, z0 + 1) * (1 - u) * v + burnCell(x0 + 1, z0 + 1) * u * v;
      d[k * 4] = this.trample[k] * 255;
      d[k * 4 + 1] = Math.max(this.scorch[k], burnt) * 255;
      d[k * 4 + 2] = this.crater[k] * 255;
      d[k * 4 + 3] = (0.5 + this.temp[k] * 0.5) * 255;
    }
    this.tex.needsUpdate = true;
  }
}
