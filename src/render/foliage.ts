// GPU foliage: 3D grass-blade clumps, flat forest litter (leaves, twigs, pebbles, clover) and
// upright flowers/mushrooms. Everything samples the terrain height field and the battle-damage
// map in the vertex shader, so grass is flattened along trampled routes, burns away where fire
// lands, vanishes in craters and under buildings, and frosts over in blizzards.

import * as THREE from 'three';
import { Grid, W, H, idx, inBounds, Terrain as T } from '../game/grid';
import type { Assets } from './assets';
import { fbm, TERRAIN_SIZE, type TerrainView } from './terrain';
import type { GroundDamage } from './damage';

const { TW, TH, RES, BORDER } = TERRAIN_SIZE;
const EXTENT = 9; // foliage beyond the play area

function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/** Shared GLSL: ground height, damage and occupancy lookups for a world xz. */
const FOLIAGE_COMMON = /* glsl */`
  uniform sampler2D tHeight, tDamage, tOcc, tSplat2;
  uniform vec2 uHeightSize, uPlay, uTerrainSize;
  uniform float uBorder, uRes, uTime, uWind;
  float groundY(vec2 p) {
    vec2 h = ((p + uBorder) * uRes + 0.5) / uHeightSize;
    return textureLod(tHeight, h, 0.0).r;
  }
  vec4 dmgAt(vec2 p) {
    vec2 d = p / uPlay;
    if (d.x <= 0.0 || d.y <= 0.0 || d.x >= 1.0 || d.y >= 1.0) return vec4(0.0, 0.0, 0.0, 0.5);
    return textureLod(tDamage, d, 0.0);
  }
  float occAt(vec2 p) {
    vec2 d = p / uPlay;
    if (d.x <= 0.0 || d.y <= 0.0 || d.x >= 1.0 || d.y >= 1.0) return 0.0;
    return textureLod(tOcc, d, 0.0).r;
  }
  float grassyAt(vec2 p) { return textureLod(tSplat2, (p + uBorder) / uTerrainSize, 0.0).a; }
  float craterDepth(vec4 dm) { return dm.b * 0.26 + dm.r * 0.035; }
`;

export class Foliage {
  group = new THREE.Group();
  private uniforms: Record<string, THREE.IUniform>;

  constructor(grid: Grid, terrain: TerrainView, damage: GroundDamage, assets: Assets) {
    this.uniforms = {
      tHeight: { value: terrain.heightTex }, tDamage: { value: damage.tex }, tOcc: { value: terrain.occ }, tSplat2: { value: terrain.splat2 },
      uHeightSize: { value: new THREE.Vector2(terrain.vw, terrain.vh) }, uPlay: { value: new THREE.Vector2(W, H) },
      uTerrainSize: { value: new THREE.Vector2(TW, TH) }, uBorder: { value: BORDER }, uRes: { value: RES },
      uTime: { value: 0 }, uWind: { value: 1 },
    };
    this.group.add(this.makeGrass(grid, terrain));
    const flat = assets.ui('clutter_flat'), up = assets.ui('clutter_upright');
    if (flat) this.group.add(this.makeLitter(grid, terrain, assets.texture(flat, true, false)));
    if (up) this.group.add(this.makeFlowers(grid, terrain, assets.texture(up, true, false)));
  }

  update(dt: number, wind: number) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uWind.value += (wind - this.uniforms.uWind.value) * Math.min(1, dt);
  }

  /** Is this spot meadow (not water, sand, cobble, rock...)? */
  private meadow(grid: Grid, terrain: TerrainView, x: number, z: number) {
    const cx = Math.floor(x), cz = Math.floor(z);
    const t = terrain.terrainAt(cx, cz);
    if (t === T.Water || t === T.Sand || t === T.Cobble || t === T.Rock || t === T.Crystal) return false;
    if (inBounds(cx, cz)) {
      // stay off shorelines
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (inBounds(cx + dx, cz + dz) && grid.terrain[idx(cx + dx, cz + dz)] === T.Water) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- grass blades
  private makeGrass(grid: Grid, terrain: TerrainView) {
    const r = rng(7);
    // one clump = 7 curved blades, 3 segments each
    const pos: number[] = [], tAttr: number[] = [], nrm: number[] = [], idxs: number[] = [];
    const BLADES = 7, SEG = 3;
    for (let b = 0; b < BLADES; b++) {
      const a = r() * Math.PI * 2, off = Math.sqrt(r()) * 0.16;
      const bx = Math.cos(a) * off, bz = Math.sin(a) * off;
      const face = r() * Math.PI;
      const lean = 0.15 + r() * 0.35, leanDir = r() * Math.PI * 2;
      const h = 0.55 + r() * 0.5, wdt = 0.03 + r() * 0.025;
      const fx = Math.cos(face), fz = Math.sin(face);
      const base = pos.length / 3;
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG;
        const bend = lean * t * t;
        const cx = bx + Math.cos(leanDir) * bend, cz = bz + Math.sin(leanDir) * bend;
        const y = h * t * (1 - lean * 0.25 * t);
        const w = wdt * (1 - t * 0.92);
        pos.push(cx - fx * w, y, cz - fz * w, cx + fx * w, y, cz + fz * w);
        tAttr.push(t, t);
        const nx = -fz, nz = fx;
        nrm.push(nx * 0.35, 1, nz * 0.35, nx * 0.35, 1, nz * 0.35);
      }
      for (let s = 0; s < SEG; s++) {
        const k = base + s * 2;
        idxs.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(tAttr, 1));
    geo.setIndex(idxs);

    const mats: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let z = -EXTENT; z < H + EXTENT; z++) for (let x = -EXTENT; x < W + EXTENT; x++) {
      const patch = fbm(x * 0.13 + 3.7, z * 0.13 - 1.2);
      const n = Math.round(2 + patch * 5);
      for (let k = 0; k < n; k++) {
        const px = x + r(), pz = z + r();
        if (!this.meadow(grid, terrain, px, pz)) continue;
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        const s = (0.32 + r() * 0.3) * (0.7 + patch * 0.7);
        m4.compose(p.set(px, 0, pz), q, sc.set(s, s, s));
        mats.push(m4.clone());
      }
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
    const U = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          ${FOLIAGE_COMMON}
          attribute float aT;
          varying vec3 vGrassCol;
          float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          float isc = length(instanceMatrix[0].xyz);
          vec4 dm = dmgAt(ip);
          float grassy = grassyAt(ip);
          float occ = occAt(ip);
          float trample = dm.r;
          // grow: burnt, cratered, built-over and paved ground has no grass
          float grow = grassy * (1.0 - smoothstep(0.05, 0.35, dm.g)) * (1.0 - smoothstep(0.04, 0.25, dm.b)) * (1.0 - smoothstep(0.2, 0.6, occ));
          // trampled grass is pressed flat before it disappears into dirt
          float flat_ = smoothstep(0.08, 0.5, trample);
          grow *= 1.0 - smoothstep(0.45, 0.75, trample);
          float t = aT;
          transformed.y *= grow * (1.0 - flat_ * 0.72);
          transformed.xz += normalize(transformed.xz + vec2(0.001)) * flat_ * t * 0.25;
          // wind
          float ph = uTime * 1.7 + ip.x * 0.31 + ip.y * 0.23;
          float gust = sin(uTime * 0.37 + ip.x * 0.05) * 0.5 + 0.5;
          transformed.x += (sin(ph) * 0.06 + gust * 0.05) * t * t * uWind * grow;
          transformed.z += cos(ph * 0.8) * 0.04 * t * t * uWind * grow;
          // sit on the (possibly cratered) ground
          transformed.y += (groundY(ip) - craterDepth(dm)) / isc;
          // colour: dark roots -> sunlit tips, with patchy variation
          float v = gh(floor(ip * 2.0));
          vec3 root = vec3(0.05, 0.16, 0.025);
          vec3 tip = mix(vec3(0.22, 0.52, 0.07), vec3(0.36, 0.6, 0.1), v);
          vGrassCol = mix(root, tip, t);
          vGrassCol = mix(vGrassCol, vec3(0.62, 0.6, 0.3) * (0.5 + 0.5 * t), flat_ * 0.8);
          float frost = clamp((0.5 - dm.a) * 2.0, 0.0, 1.0);
          vGrassCol = mix(vGrassCol, vec3(0.85, 0.93, 1.0), frost * t);
          vGrassCol *= 1.0 - smoothstep(0.0, 0.3, dm.g) * 0.7;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;')
        .replace('#include <map_fragment>', 'diffuseColor.rgb = vGrassCol;')
        // blades are lit like the ground they grow from (no dark back faces)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
    };
    mat.customProgramCacheKey = () => 'grass-blades';
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'grass';
    return mesh;
  }

  // ---------------------------------------------------------------- flat litter
  private makeLitter(grid: Grid, terrain: TerrainView, atlas: THREE.Texture) {
    const r = rng(11);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const cells: number[] = [], mats: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let z = -EXTENT; z < H + EXTENT; z++) for (let x = -EXTENT; x < W + EXTENT; x++) {
      const inside = inBounds(x, z);
      const forest = fbm(x * 0.075 + 7, z * 0.075 - 3);
      const border = inside ? 0 : Math.min(1, Math.hypot(Math.max(-x, x - W, 0), Math.max(-z, z - H, 0)) / 3);
      const t = inside ? grid.terrain[idx(x, z)] : T.Grass;
      const treeish = t === T.Tree ? 1 : 0;
      const n = Math.floor((0.6 + forest * 2.2 + border * 3 + treeish * 3) * (0.6 + r() * 0.8));
      for (let k = 0; k < n; k++) {
        const px = x + r(), pz = z + r();
        const ct = terrain.terrainAt(Math.floor(px), Math.floor(pz));
        if (ct === T.Water || ct === T.Cobble) continue;
        // leaves (0-2) mostly, twigs (3), pebbles (4, also on dirt/sand), clover (5)
        let a = Math.floor(r() * 3);
        const roll = r();
        if (roll < 0.1) a = 3; else if (roll < 0.2 || ct === T.Sand || ct === T.Dirt) a = 4; else if (roll < 0.32) a = 5;
        if (ct === T.Sand && a !== 4) continue;
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        const s = a === 5 ? 0.45 + r() * 0.3 : a === 4 ? 0.22 + r() * 0.18 : 0.2 + r() * 0.16;
        m4.compose(p.set(px, 0, pz), q, sc.set(s, 1, s));
        mats.push(m4.clone());
        cells.push(a);
      }
    }
    return this.atlasMesh(geo, atlas, mats, cells, true);
  }

  // ---------------------------------------------------------------- upright flowers
  private makeFlowers(grid: Grid, terrain: TerrainView, atlas: THREE.Texture) {
    const r = rng(23);
    const a = new THREE.PlaneGeometry(1, 1); a.translate(0, 0.5, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const geo = mergeGeos([a, b]);
    const cells: number[] = [], mats: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let z = -EXTENT; z < H + EXTENT; z++) for (let x = -EXTENT; x < W + EXTENT; x++) {
      const bloom = fbm(x * 0.19 - 5, z * 0.19 + 9);
      const inside = inBounds(x, z);
      const t = inside ? grid.terrain[idx(x, z)] : T.Grass;
      const n = Math.floor((bloom > 0.55 ? 1.6 : 0.25) * (0.5 + r()) + (t === T.Tree ? 1.5 : 0));
      for (let k = 0; k < n; k++) {
        const px = x + r(), pz = z + r();
        if (!this.meadow(grid, terrain, px, pz)) continue;
        // 0 mushrooms, 1 daisies, 2 bluebells, 3 poppies, 4 tuft, 5 flower clump, 6 fern
        let c: number;
        const roll = r();
        if (t === T.Tree || (!inside && roll < 0.3)) c = roll < 0.35 ? 0 : 6;
        else c = roll < 0.25 ? 1 : roll < 0.45 ? 2 : roll < 0.6 ? 3 : roll < 0.8 ? 5 : roll < 0.9 ? 4 : 6;
        q.setFromAxisAngle(up, r() * Math.PI);
        const s = (c === 0 ? 0.28 : c === 6 ? 0.55 : c === 4 ? 0.42 : 0.38) * (0.7 + r() * 0.6);
        m4.compose(p.set(px, 0, pz), q, sc.set(s, s, s));
        mats.push(m4.clone());
        cells.push(c);
      }
    }
    return this.atlasMesh(geo, atlas, mats, cells, false);
  }

  private atlasMesh(geo: THREE.BufferGeometry, atlas: THREE.Texture, mats: THREE.Matrix4[], cells: number[], flat: boolean) {
    geo = geo.clone();
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 1));
    const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide, roughness: flat ? 0.85 : 0.7 });
    const U = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          ${FOLIAGE_COMMON}
          attribute float aCell;
          varying float vFade; varying float vScorch; varying float vFrost;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          #ifdef USE_MAP
            float cc = mod(aCell, 4.0), cr = floor(aCell / 4.0);
            // 4x2 atlas, row 0 at the top of the image (texture is flipY)
            vMapUv = vec2((cc + uv.x) * 0.25, 1.0 - (cr + 1.0 - uv.y) * 0.5);
          #endif`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          float isc = length(instanceMatrix[0].xyz);
          vec4 dm = dmgAt(ip);
          float occ = occAt(ip);
          vScorch = smoothstep(0.05, 0.3, dm.g);
          vFrost = clamp((0.5 - dm.a) * 2.0, 0.0, 1.0);
          float keep = (1.0 - smoothstep(0.35, 0.7, dm.g)) * (1.0 - smoothstep(0.05, 0.3, dm.b)) * (1.0 - smoothstep(0.2, 0.6, occ))
            * (1.0 - smoothstep(${flat ? '0.55, 0.9' : '0.2, 0.55'}, dm.r));
          vFade = keep;
          transformed *= keep;
          ${flat ? '' : `
          float ph = uTime * 1.5 + ip.x * 0.4 + ip.y * 0.3;
          transformed.x += sin(ph) * 0.06 * position.y * uWind;`}
          transformed.y += (groundY(ip) - craterDepth(dm)) / ${flat ? '1.0' : 'isc'} + ${flat ? '0.012' : '0.0'};`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade; varying float vScorch; varying float vFrost;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= 1.0 - vScorch * 0.8;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.93, 1.0), vFrost * 0.6);`)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
    };
    mat.customProgramCacheKey = () => (flat ? 'litter' : 'flowers');
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = flat ? 'litter' : 'flowers';
    return mesh;
  }
}

function mergeGeos(list: THREE.BufferGeometry[]) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const arrs = list.map((x) => x.getAttribute(name).array as Float32Array);
    const out = new Float32Array(arrs.reduce((a, b) => a + b.length, 0));
    let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
    g.setAttribute(name, new THREE.BufferAttribute(out, list[0].getAttribute(name).itemSize));
  }
  const idx: number[] = [];
  let base = 0;
  for (const x of list) { for (const i of x.getIndex()!.array) idx.push(i + base); base += x.getAttribute('position').count; }
  g.setIndex(idx);
  return g;
}
