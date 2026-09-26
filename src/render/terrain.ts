// Terrain mesh + material. Heights come from the gameplay grid (plateaus, lakebeds) with
// ±25% noise so the ground rolls, plus hills outside the play area. The material height-blends
// nine full PBR layers (albedo/normal/roughness/height) with parallax, and reads the live
// battle-damage map: grass gets trampled into dirt and mud, fire scorches it, explosions
// crater it, frost rimes it.

import * as THREE from 'three';
import { Grid, Terrain as T, W, H, idx, inBounds, N } from '../game/grid';
import { PLATEAU_HEIGHT, WATER_LEVEL } from '../game/map';
import type { GroundDamage } from './damage';
import type { TerrainArrays } from './terrainTextures';

export const BORDER = 22;
const RES = 4; // vertices per cell
const TW = W + BORDER * 2, TH = H + BORDER * 2;

function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number) {
  return vnoise(x, z) * 0.5 + vnoise(x * 2.03, z * 2.03) * 0.25 + vnoise(x * 4.1, z * 4.1) * 0.125;
}

/** Gentle rolling of the meadow (world units). */
const ROLL = 0.34;

export class TerrainView {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  splat1: THREE.DataTexture;
  splat2: THREE.DataTexture;
  occ: THREE.DataTexture;
  /** Vertex-resolution height field (R32F) shared by grass, clutter and water shaders. */
  heightTex: THREE.DataTexture;
  private heights: Float32Array;
  vw = TW * RES + 1;
  vh = TH * RES + 1;
  private occVersion = -1;
  uniforms = {
    uGridAlpha: { value: 0 },
    uCursor: { value: new THREE.Vector2(-100, -100) },
    uTime: { value: 0 },
    uWetness: { value: 0 },
    uCloud: { value: 0.2 },
    uCover: { value: 0.58 },   // cloud-cover threshold, shared with the cloud deck (atmosphere.ts)
    uSun: { value: 1 },
  };

  constructor(private grid: Grid, arrays: TerrainArrays, damage: GroundDamage) {
    this.deep = this.computeDeepField();
    this.heights = new Float32Array(this.vw * this.vh);
    for (let j = 0; j < this.vh; j++) for (let i = 0; i < this.vw; i++) {
      this.heights[j * this.vw + i] = this.computeHeight(i / RES - BORDER, j / RES - BORDER);
    }
    const geo = new THREE.PlaneGeometry(TW, TH, TW * RES, TH * RES);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + TW / 2 - BORDER, z = pos.getZ(k) + TH / 2 - BORDER;
      const i = Math.round((x + BORDER) * RES), j = Math.round((z + BORDER) * RES);
      pos.setXYZ(k, x, this.heights[j * this.vw + i], z);
    }
    geo.computeVertexNormals();

    this.heightTex = new THREE.DataTexture(this.heights, this.vw, this.vh, THREE.RedFormat, THREE.FloatType);
    this.heightTex.magFilter = THREE.LinearFilter; this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;

    this.splat1 = new THREE.DataTexture(new Uint8Array(TW * TH * 4), TW, TH, THREE.RGBAFormat);
    this.splat2 = new THREE.DataTexture(new Uint8Array(TW * TH * 4), TW, TH, THREE.RGBAFormat);
    this.occ = new THREE.DataTexture(new Uint8Array(W * H * 4), W, H, THREE.RGBAFormat);
    for (const s of [this.splat1, this.splat2, this.occ]) {
      s.magFilter = THREE.LinearFilter; s.minFilter = THREE.LinearFilter; s.wrapS = s.wrapT = THREE.ClampToEdgeWrapping;
    }
    this.writeStaticSplat();
    this.updateOccupancy();

    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    const u = this.uniforms;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        tColors: { value: arrays.colors }, tData: { value: arrays.data },
        tSplat1: { value: this.splat1 }, tSplat2: { value: this.splat2 }, tDamage: { value: damage.tex }, tOcc: { value: this.occ },
        uTerrainSize: { value: new THREE.Vector2(TW, TH) }, uBorder: { value: BORDER }, uPlay: { value: new THREE.Vector2(W, H) },
        ...u,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vWNormal;
          uniform sampler2D tDamage; uniform vec2 uPlay;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec2 ddv = transformed.xz / uPlay;
          if (ddv.x > 0.0 && ddv.y > 0.0 && ddv.x < 1.0 && ddv.y < 1.0) {
            vec4 dmv = textureLod(tDamage, ddv, 0.0);
            transformed.y -= dmv.b * 0.26 + dmv.r * 0.035;
          }`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          ${TERRAIN_COMMON}`)
        .replace('#include <map_fragment>', TERRAIN_ALBEDO)
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = clamp(terrData.b, 0.25, 1.0);
          roughnessFactor = mix(roughnessFactor, 0.35, uWetness * (1.0 - terrRock * 0.5));
          roughnessFactor = mix(roughnessFactor, 0.28, terrFrost);`)
        .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL)
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= terrCloud;'))
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          ${TERRAIN_EMISSIVE}`);
    };
    this.material.customProgramCacheKey = () => 'terrain-v2';
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
  }

  terrainAt(cx: number, cz: number): T {
    if (inBounds(cx, cz)) return this.grid.terrain[idx(cx, cz)] as T;
    // extend water beyond the map edge where the map touches it
    const kx = Math.max(0, Math.min(W - 1, cx)), kz = Math.max(0, Math.min(H - 1, cz));
    const d = Math.max(kx - cx, cx - kx, kz - cz, cz - kz);
    if (this.grid.terrain[idx(kx, kz)] === T.Water && d < 7 + fbm(cx * 0.3, cz * 0.3) * 4) return T.Water;
    return T.Grass;
  }

  private computeHeight(x: number, z: number): number {
    const eps = 1e-4;
    const xs = [Math.floor(x - eps), Math.floor(x + eps)], zs = [Math.floor(z - eps), Math.floor(z + eps)];
    let plateau = false;
    for (const cz of zs) for (const cx of xs) if (this.terrainAt(cx, cz) === T.Plateau) plateau = true;
    // large rolling swells + medium hillocks + small bumps; ±25% on plateaus
    const swell = fbm(x * 0.075 + 17.3, z * 0.075 - 4.1) * 2 - 1;
    const hillock = fbm(x * 0.19 - 8.2, z * 0.19 + 2.7) * 2 - 1;
    const bump = fbm(x * 0.42, z * 0.42) - 0.5;
    const dx = Math.max(-x, x - W, 0), dz = Math.max(-z, z - H, 0);
    const d = Math.hypot(dx, dz);
    const hills = d > 0 ? THREE.MathUtils.smoothstep(d, 5, 20) * (1.5 + fbm(x * 0.08, z * 0.08) * 5) : 0;
    if (plateau) return PLATEAU_HEIGHT * (1 + 0.25 * swell) + bump * 0.12;
    // organic shorelines: blur the blocky water cells and perturb with noise
    const wet = this.waterness(x, z) + (fbm(x * 0.55 + 3.3, z * 0.55 - 1.9) - 0.5) * 0.2;
    const lake = THREE.MathUtils.smoothstep(wet, 0.32, 0.62);
    const land = (ROLL * swell + 0.16 * hillock) * (1 - THREE.MathUtils.smoothstep(wet, 0.05, 0.35)) + bump * 0.1 + hills;
    // dry land never dips below the water table (or the lake plane would show through)
    const floor = WATER_LEVEL + 0.1, k = 0.12;
    const dry = floor + k * Math.log1p(Math.exp((land - floor) / k)); // smooth max(land, floor)
    // shelved basins: shallow sandy margins sloping down to the deep middle
    const depth = 0.07 + 0.74 * THREE.MathUtils.smoothstep(this.deepAt(x, z), 0.36, 0.92) + bump * 0.12;
    return THREE.MathUtils.lerp(dry, WATER_LEVEL - Math.max(0.04, depth), lake);
  }

  /** How far into open water each cell is: a wide gaussian (sigma ~1.8 cells) of the water mask. */
  private deep: Float32Array;
  private computeDeepField() {
    const w = TW, h = TH, R = 4, s2 = 2 * 1.8 * 1.8;
    const src = new Float32Array(w * h), tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) src[j * w + i] = this.terrainAt(i - BORDER, j - BORDER) === T.Water ? 1 : 0;
    const k = Array.from({ length: 2 * R + 1 }, (_, i) => Math.exp(-((i - R) ** 2) / s2));
    const ks = k.reduce((a, b) => a + b, 0);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let a = 0;
      for (let o = -R; o <= R; o++) a += src[j * w + Math.min(w - 1, Math.max(0, i + o))] * k[o + R];
      tmp[j * w + i] = a / ks;
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let a = 0;
      for (let o = -R; o <= R; o++) a += tmp[Math.min(h - 1, Math.max(0, j + o)) * w + i] * k[o + R];
      out[j * w + i] = a / ks;
    }
    return out;
  }

  /** Bilinear sample of the deep-water field at a world position (cell centres at +0.5). */
  private deepAt(x: number, z: number) {
    const fx = x + BORDER - 0.5, fz = z + BORDER - 0.5;
    const i = Math.max(0, Math.min(TW - 2, Math.floor(fx))), j = Math.max(0, Math.min(TH - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    const d = this.deep, a = d[j * TW + i], b = d[j * TW + i + 1], c = d[(j + 1) * TW + i], e = d[(j + 1) * TW + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  }

  /** 0..1 soft water coverage around a point (gaussian over nearby cells). */
  private waterness(x: number, z: number) {
    let sum = 0, wsum = 0;
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
      const px = cx + ox + 0.5, pz = cz + oz + 0.5;
      const d2 = (px - x) * (px - x) + (pz - z) * (pz - z);
      const w = Math.exp(-d2 / 0.9);
      wsum += w;
      if (this.terrainAt(cx + ox, cz + oz) === T.Water) sum += w;
    }
    return sum / wsum;
  }

  /** Bilinear height lookup in world coordinates (matches the mesh). */
  heightAt(x: number, z: number): number {
    const fx = (x + BORDER) * RES, fz = (z + BORDER) * RES;
    const i = Math.max(0, Math.min(this.vw - 2, Math.floor(fx))), j = Math.max(0, Math.min(this.vh - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    const h = this.heights;
    const a = h[j * this.vw + i], b = h[j * this.vw + i + 1], c = h[(j + 1) * this.vw + i], d = h[(j + 1) * this.vw + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  /** Lowest ground under a footprint (so buildings never float). */
  footprintBase(x0: number, z0: number, size: number) {
    let m = Infinity;
    for (let dz = 0; dz <= size * 2; dz++) for (let dx = 0; dx <= size * 2; dx++) m = Math.min(m, this.heightAt(x0 + dx / 2, z0 + dz / 2));
    return m;
  }

  private writeStaticSplat() {
    const s1 = this.splat1.image.data as Uint8Array, s2 = this.splat2.image.data as Uint8Array;
    for (let tz = 0; tz < TH; tz++) for (let tx = 0; tx < TW; tx++) {
      const cx = tx - BORDER, cz = tz - BORDER;
      const k = (tz * TW + tx) * 4;
      const t = this.terrainAt(cx, cz);
      const inside = inBounds(cx, cz);
      let dirt = 0, crystal = 0, sand = 0, cobble = 0, forest = 0, grassy = 1;
      if (t === T.Dirt) { dirt = 1; grassy = 0.15; }
      if (t === T.Rock) { dirt = 0.5; grassy = 0.3; }
      if (t === T.Crystal) { dirt = 0.7; crystal = 1; grassy = 0.2; }
      if (t === T.Sand || t === T.Water) { sand = 1; grassy = 0; }
      if (t === T.Cobble) { cobble = 1; grassy = 0; }
      if (t === T.Tree) forest = 1;
      if (!inside) {
        const dx = Math.max(-cx - 1, cx - W, 0), dz = Math.max(-cz - 1, cz - H, 0);
        forest = THREE.MathUtils.smoothstep(Math.hypot(dx, dz), 0.5, 4);
        let nearW = false;
        if (t !== T.Water) for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) if (this.terrainAt(cx + ox, cz + oz) === T.Water) nearW = true;
        if (nearW) { sand = 1; grassy = 0; }
      }
      s1[k] = dirt * 255; s1[k + 1] = crystal * 255; s1[k + 2] = sand * 255; s1[k + 3] = 0;
      s2[k] = cobble * 255; s2[k + 1] = 0; s2[k + 2] = forest * 255; s2[k + 3] = grassy * 255;
    }
    this.splat1.needsUpdate = true; this.splat2.needsUpdate = true;
  }

  /** Structures: contact shading on the ground and no grass underneath. */
  updateOccupancy() {
    if (this.occVersion === this.grid.version) return;
    this.occVersion = this.grid.version;
    const o = this.occ.image.data as Uint8Array;
    for (let i = 0; i < N; i++) o[i * 4] = this.grid.occupant[i] >= 0 ? 255 : 0;
    this.occ.needsUpdate = true;
  }

  /** Terrain type at a point for gameplay height offsets. */
  gameplayBase(x: number, z: number) {
    const cx = Math.floor(x), cz = Math.floor(z);
    return inBounds(cx, cz) && this.grid.terrain[idx(cx, cz)] === T.Plateau ? PLATEAU_HEIGHT : 0;
  }
}

export const TERRAIN_SIZE = { TW, TH, RES, BORDER };

// ------------------------------------------------------------------ shader parts
const TERRAIN_COMMON = /* glsl */`
  varying vec3 vWPos; varying vec3 vWNormal;
  uniform highp sampler2DArray tColors;
  uniform highp sampler2DArray tData;
  uniform sampler2D tSplat1, tSplat2, tDamage, tOcc;
  uniform vec2 uTerrainSize; uniform float uBorder; uniform vec2 uPlay;
  uniform float uGridAlpha; uniform vec2 uCursor; uniform float uTime; uniform float uWetness; uniform float uCloud; uniform float uCover; uniform float uSun;
  float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float tnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(th(i),th(i+vec2(1,0)),u.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),u.x), u.y); }
  float tfbm(vec2 p){ return tnoise(p)*0.5 + tnoise(p*2.03+7.1)*0.25 + tnoise(p*4.01-3.3)*0.125 + 0.0625; }
  #define NL 14
  void paintL(inout float w[NL], int k, float a) { for (int i = 0; i < NL; i++) w[i] *= (1.0 - a); w[k] += a; }
  vec4 terrData; vec3 terrAlbedo; float terrRock; float terrFrost; float terrHeat; float terrCloud; vec4 terrDmg; float terrUnder;
`;

const TERRAIN_ALBEDO = /* glsl */`
  vec2 suv = (vWPos.xz + uBorder) / uTerrainSize;
  vec4 sp1 = texture(tSplat1, suv);
  vec4 sp2 = texture(tSplat2, suv);
  vec2 duv = vWPos.xz / uPlay;
  bool inPlay = duv.x > 0.0 && duv.y > 0.0 && duv.x < 1.0 && duv.y < 1.0;
  terrDmg = inPlay ? texture(tDamage, duv) : vec4(0.0, 0.0, 0.0, 0.5);
  float nzL = tfbm(vWPos.xz * 0.075);
  float nzS = tnoise(vWPos.xz * 0.9);

  float w[NL];
  for (int i = 0; i < NL; i++) w[i] = 0.0;
  // the meadow: five grass types woven together by large drifting patches
  w[0] = 1.0;
  float nA = tfbm(vWPos.xz * 0.045 + vec2(11.3, 4.1)), nB = tfbm(vWPos.xz * 0.06 - vec2(4.7, 9.2)), nC = tfbm(vWPos.xz * 0.038 + vec2(27.1, -3.3));
  paintL(w, 9, smoothstep(0.48, 0.64, nA + (nzS - 0.5) * 0.06));                     // lush
  paintL(w, 11, smoothstep(0.6, 0.72, nB + (nzS - 0.5) * 0.06) * 0.7);               // clover
  paintL(w, 13, smoothstep(0.52, 0.66, nC + (nzS - 0.5) * 0.05) * 0.85);             // wildflowers
  float dryN = tfbm(vWPos.xz * 0.05 + vec2(-17.0, 21.0)) + clamp(vWPos.y * 0.12, -0.05, 0.16);
  paintL(w, 10, smoothstep(0.64, 0.78, dryN) * 0.55);                                 // sun-dried, likes high ground
  float forestAmt = clamp(smoothstep(0.4, 0.62, nzL + (nzS - 0.5) * 0.08) + sp2.b, 0.0, 1.0);
  paintL(w, 1, forestAmt);
  paintL(w, 12, clamp(sp2.b, 0.0, 1.0) * smoothstep(0.42, 0.62, nB + (nzS - 0.5) * 0.1) * 0.7);   // moss under the trees
  paintL(w, 3, clamp(sp1.r * 0.95, 0.0, 1.0));
  paintL(w, 6, sp1.b);
  float trample = terrDmg.r;
  paintL(w, 2, smoothstep(0.05, 0.3, trample));
  paintL(w, 3, smoothstep(0.34, 0.6, trample));
  paintL(w, 4, max(smoothstep(0.74, 0.96, trample), smoothstep(0.06, 0.45, terrDmg.b)));
  float scorchN = terrDmg.g + (nzS - 0.5) * 0.3;
  paintL(w, 3, smoothstep(0.05, 0.3, scorchN) * 0.35);
  paintL(w, 7, smoothstep(0.12, 0.5, scorchN) * 0.88);
  paintL(w, 8, smoothstep(0.3, 0.7, sp2.r));
  float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
  terrRock = smoothstep(0.24, 0.5, slope + (nzS - 0.5) * 0.12);
  paintL(w, 5, terrRock);

  // anti-tiling (after iq's "texture repetition" #3): a slowly varying noise picks one of
  // eight random tile offsets; neighbouring offsets cross-fade, so no two stretches of ground
  // repeat even though every layer tiles every 4 units
  float vk = tnoise(vWPos.xz * 0.09 + vec2(3.1, 7.7)) * 8.0;
  float vi = floor(vk), vfr = fract(vk);
  vec2 offA = sin(vec2(3.0, 7.0) * vi) * 7.31;
  vec2 offB = sin(vec2(3.0, 7.0) * (vi + 1.0)) * 7.31;
  float vmix = smoothstep(0.25, 0.75, vfr);

  // height-based blending: rougher layers poke through smoother ones first
  vec2 tuv = vWPos.xz * 0.25;
  vec2 tdx = dFdx(tuv), tdy = dFdy(tuv);
  float hts[NL]; float vmax = -1.0;
  for (int i = 0; i < NL; i++) {
    hts[i] = w[i] > 0.002 ? textureGrad(tData, vec3(tuv + (vmix < 0.5 ? offA : offB), float(i)), tdx, tdy).a : 0.0;
    float v = w[i] > 0.002 ? w[i] + hts[i] * 0.55 : -1.0;
    vmax = max(vmax, v);
  }
  float b[NL]; float bsum = 0.0; float hBlend = 0.0;
  for (int i = 0; i < NL; i++) {
    float v = w[i] > 0.002 ? w[i] + hts[i] * 0.55 : -1.0;
    b[i] = max(v - (vmax - 0.28), 0.0);
    bsum += b[i];
  }
  for (int i = 0; i < NL; i++) { b[i] /= max(bsum, 1e-4); hBlend += b[i] * hts[i]; }

  // parallax offset along the view ray
  vec3 Vw = normalize(cameraPosition - vWPos);
  vec2 pOff = -Vw.xz / max(Vw.y, 0.3) * (hBlend - 0.5) * 0.07;
  vec2 puv = (vWPos.xz + pOff) * 0.25;
  vec3 col = vec3(0.0); terrData = vec4(0.0);
  for (int i = 0; i < NL; i++) {
    if (b[i] > 0.001) {
      float li = float(i);
      vec3 cA = textureGrad(tColors, vec3(puv + offA, li), tdx, tdy).rgb;
      vec4 dA = textureGrad(tData, vec3(puv + offA, li), tdx, tdy);
      if (vmix > 0.001) {
        vec3 cB = textureGrad(tColors, vec3(puv + offB, li), tdx, tdy).rgb;
        vec4 dB = textureGrad(tData, vec3(puv + offB, li), tdx, tdy);
        // bias the seam toward whichever sample is taller, so it follows the texture's shapes
        float m = clamp(vmix + (dB.a - dA.a) * 0.6, 0.0, 1.0);
        cA = mix(cA, cB, m); dA = mix(dA, dB, m);
      }
      col += cA * b[i];
      terrData += dA * b[i];
    }
  }
  // macro variation so the meadow never looks tiled
  float macro = mix(0.84, 1.12, nzL) * mix(0.94, 1.05, nzS);
  float hue = tfbm(vWPos.xz * 0.02 + vec2(40.0, 13.0)) - 0.5;          // warm/cool drift over ~50 units
  col *= mix(vec3(1.0), vec3(macro * (1.0 + hue * 0.12), macro * 1.02, macro * (0.96 - hue * 0.14)), 1.0 - b[5] - b[8]);
  col = mix(col, col * vec3(0.9, 0.72, 1.18) + vec3(0.05, 0.0, 0.1), sp1.g);
  // battle scars
  col *= 1.0 - terrDmg.b * 0.3;
  terrFrost = clamp((0.5 - terrDmg.a) * 2.0, 0.0, 1.0) * 1.3;
  terrFrost = clamp(terrFrost, 0.0, 1.0);
  terrHeat = clamp((terrDmg.a - 0.5) * 2.0, 0.0, 1.0);
  col = mix(col, vec3(0.78, 0.86, 0.94), terrFrost * 0.65);
  col *= mix(1.0, 0.7, uWetness * (1.0 - terrRock * 0.5));
  // contact shading around buildings
  vec2 ouv = duv;
  float occ = 0.0;
  if (inPlay) {
    vec2 px = 1.0 / uPlay;
    occ = texture(tOcc, ouv).r * 0.4 + (texture(tOcc, ouv + vec2(px.x * 0.6, 0.0)).r + texture(tOcc, ouv - vec2(px.x * 0.6, 0.0)).r
      + texture(tOcc, ouv + vec2(0.0, px.y * 0.6)).r + texture(tOcc, ouv - vec2(0.0, px.y * 0.6)).r) * 0.15;
  }
  col *= 1.0 - smoothstep(0.1, 0.7, occ) * 0.32;
  // underwater tint
  terrUnder = smoothstep(${WATER_LEVEL.toFixed(3)} + 0.02, ${WATER_LEVEL.toFixed(3)} - 0.18, vWPos.y);
  col *= mix(vec3(1.0), vec3(0.5, 0.72, 0.82), terrUnder);
  // drifting cloud shadows (applied to the sun in the light loop)
  float cl = tfbm(vWPos.xz * 0.032 + uTime * vec2(0.011, 0.005));
  terrCloud = 1.0 - uCloud * smoothstep(uCover - 0.04, uCover + 0.2, cl) * 0.75;
  terrAlbedo = col;
  diffuseColor.rgb *= col;
`;

const TERRAIN_NORMAL = /* glsl */`
  {
    vec3 Nw = normalize(vWNormal);
    vec3 Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
    vec3 Bw = cross(Nw, Tw);
    vec3 nts = vec3(terrData.xy * 2.0 - 1.0, 1.0);
    nts.xy *= 1.15;
    vec3 nW = normalize(Tw * nts.x + Bw * nts.y + Nw * nts.z);
    // crater rims bend the normal toward the blast center
    vec2 duvN = vWPos.xz / uPlay;
    if (duvN.x > 0.0 && duvN.y > 0.0 && duvN.x < 1.0 && duvN.y < 1.0) {
      vec2 e = vec2(0.35) / uPlay;
      float cxp = texture(tDamage, duvN + vec2(e.x, 0.0)).b, cxm = texture(tDamage, duvN - vec2(e.x, 0.0)).b;
      float czp = texture(tDamage, duvN + vec2(0.0, e.y)).b, czm = texture(tDamage, duvN - vec2(0.0, e.y)).b;
      nW = normalize(nW + vec3(cxp - cxm, 0.0, czp - czm) * 1.8);
    }
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  }
`;

const TERRAIN_EMISSIVE = /* glsl */`
  // smouldering embers where fire has just burnt the ground
  {
    // only the scorched texture's own ember specks glow, flickering, while the ground is hot
    float ember = smoothstep(0.12, 0.35, terrAlbedo.r - terrAlbedo.b * 1.2) * smoothstep(0.25, 0.8, terrDmg.g);
    ember *= smoothstep(0.55, 0.85, tnoise(vWPos.xz * 2.3 + uTime * 0.3));
    totalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * terrHeat * ember * (0.6 + 0.4 * sin(uTime * 6.0 + tnoise(vWPos.xz * 3.0) * 12.0)) * 3.0;
  }
  // lakebed caustics
  if (terrUnder > 0.0) {
    vec2 cp = vWPos.xz * 1.35;
    float c1 = sin(cp.x * 2.1 + sin(cp.y * 1.7 + uTime * 1.1) * 1.6 + uTime * 0.7);
    float c2 = sin(cp.y * 2.3 + sin(cp.x * 1.9 - uTime * 0.9) * 1.6 - uTime * 0.6);
    float caust = pow(clamp(1.0 - abs(c1 + c2) * 0.5, 0.0, 1.0), 7.0);
    // strongest over the sunlit shelves, gone in the deep
    float bedDepth = ${WATER_LEVEL.toFixed(3)} - vWPos.y;
    float shallowK = smoothstep(0.0, 0.06, bedDepth) * (1.0 - smoothstep(0.2, 0.6, bedDepth));
    totalEmissiveRadiance += vec3(0.45, 0.8, 0.85) * caust * shallowK * uSun * 0.2;
  }
  if (uGridAlpha > 0.0) {
    vec2 gf = abs(fract(vWPos.xz) - 0.5);
    float line = smoothstep(0.47, 0.5, max(gf.x, gf.y));
    float fade = 1.0 - smoothstep(3.0, 8.0, distance(vWPos.xz, uCursor));
    bool inside = vWPos.x > 0.0 && vWPos.z > 0.0 && vWPos.x < uPlay.x && vWPos.z < uPlay.y;
    if (inside) totalEmissiveRadiance += vec3(0.55, 0.75, 1.0) * line * fade * uGridAlpha * 0.35;
  }
`;
