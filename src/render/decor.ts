// Set dressing, modelled here and textured with diffui art (decor_atlas.png: bushes, fern,
// stump top, banners, butterflies; bark and ruin_stone PBR sets):
// - bushes, berry shrubs and ferns along the forest edge (crossed alpha cards, wind sway)
// - fallen logs and stumps on the forest floor (bark cylinders with growth-ring caps, mossy tops)
// - ruined columns, fallen drums and a broken wall at a few spots in the border
// - banners flapping on poles at every checkpoint
// - butterflies flitting over the meadow by day
// Only non-buildable ground is decorated (tree/rock cells, the border), so nothing hides a tower.

import * as THREE from 'three';
import { W, H, inBounds, idx, Terrain as T, type Grid } from '../game/grid';
import type { MapInfo } from '../game/map';
import type { TerrainView } from './terrain';
import type { Assets } from './assets';

function rand(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** GLSL: remap a quad's uv into cell `c` of the 4x2 decor atlas (row 0 at the top). */
const ATLAS_UV = (c: string) => `vec2((mod(${c}, 4.0) + uv.x) * 0.25, 1.0 - (floor(${c} / 4.0) + 1.0 - uv.y) * 0.5)`;

export class Decor {
  group = new THREE.Group();
  private u = { uTime: { value: 0 }, uWind: { value: 1 } };
  private banners: { mesh: THREE.Object3D; cell: number }[] = [];
  private flies: { mesh: THREE.InstancedMesh; st: { x: number; z: number; y: number; hx: number; hz: number; ph: number; sp: number }[] } | null = null;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private s = new THREE.Vector3();

  constructor(private grid: Grid, map: MapInfo, private terrain: TerrainView, assets: Assets, treeSpots: { x: number; z: number }[]) {
    const r = rand(5150);
    const atlasUrl = assets.ui('decor_atlas');
    const atlas = atlasUrl ? assets.texture(atlasUrl, true, false) : null;
    if (atlas) atlas.anisotropy = 4;
    const hAt = (x: number, z: number) => terrain.heightAt(x, z);
    const keepClear = [map.spawn, { x: map.castle.x + map.castle.w / 2, z: map.castle.z + map.castle.h / 2 }];
    const allowed = (x: number, z: number) => {
      const cx = Math.floor(x), cz = Math.floor(z);
      if (terrain.terrainAt(cx, cz) === T.Water) return false;
      if (keepClear.some((k) => Math.hypot(k.x - x, k.z - z) < 4.5)) return false;
      if (inBounds(cx, cz)) { const t = grid.terrain[idx(cx, cz)]; return t === T.Tree || t === T.Rock; }
      if (z > H + 0.5 && z < H + 3.5) return false;      // keep the near (camera-side) edge clean
      return true;
    };
    // spatial hash of the trees (2-unit cells) for density queries
    const hash = new Map<string, { x: number; z: number }[]>();
    for (const t of treeSpots) { const k = `${Math.floor(t.x / 2)},${Math.floor(t.z / 2)}`; let l = hash.get(k); if (!l) hash.set(k, l = []); l.push(t); }
    const treesNear = (x: number, z: number, rad: number) => {
      let n = 0;
      const c0 = Math.floor((x - rad) / 2), c1 = Math.floor((x + rad) / 2), d0 = Math.floor((z - rad) / 2), d1 = Math.floor((z + rad) / 2);
      for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) for (const t of hash.get(`${cx},${cz}`) ?? []) if (Math.hypot(t.x - x, t.z - z) < rad) n++;
      return n;
    };
    const near = (x: number, z: number, max: number) => treesNear(x, z, max) > 0;

    // ---------------- bushes, berry shrubs, ferns: three crossed cards
    if (atlas) {
      const bushes: { x: number; z: number; s: number; rot: number; cell: number }[] = [];
      for (let z = -16; z < H + 16; z += 1.1) for (let x = -16; x < W + 16; x += 1.1) {
        const jx = x + (r() - 0.5) * 0.9, jz = z + (r() - 0.5) * 0.9;
        if (!allowed(jx, jz)) continue;
        // the forest edge: a few trees close by, open ground on the other side (not under the canopy)
        const dense = treesNear(jx, jz, 2.4);
        const clearingRim = RUIN_SITES.some((c) => Math.abs(Math.hypot(c.x - jx, c.z - jz) - RUIN_CLEARING) < 0.9);
        const edge = (dense >= 1 && dense <= 4 && !near(jx, jz, 0.6)) || clearingRim;
        if (r() > (edge ? 0.45 : 0.02)) continue;
        const f = r();
        bushes.push({ x: jx, z: jz, s: 0.7 + r() * 0.8, rot: r() * Math.PI, cell: f < 0.45 ? 0 : f < 0.7 ? 1 : 2 });
      }
      const card = new THREE.PlaneGeometry(1, 1); card.translate(0, 0.5, 0);
      const cards = [0, 1, 2].map((i) => card.clone().rotateY((i * Math.PI) / 3));
      const geo = mergeGeos(cards);
      geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(bushes.map((b) => b.cell)), 1));
      const patch = (sh: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }, depth = false) => {
        sh.uniforms.uTime = this.u.uTime; sh.uniforms.uWind = this.u.uWind;
        sh.vertexShader = 'uniform float uTime, uWind; attribute float aCell;\n' + sh.vertexShader
          .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = ${ATLAS_UV('aCell')};\n#endif`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float ph = uTime * 1.2 + ip.x * 0.37 + ip.z * 0.23;
            transformed.x += sin(ph) * 0.05 * position.y * position.y * uWind;
            transformed.z += cos(ph * 0.8) * 0.035 * position.y * position.y * uWind;`)
          + (depth ? '' : '');
      };
      const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
      mat.onBeforeCompile = (sh) => {
        patch(sh);
        // lit like the ground they grow from, so the back faces aren't black
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
      };
      mat.customProgramCacheKey = () => 'decor-bush';
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
      depth.onBeforeCompile = (sh) => patch(sh, true);
      depth.customProgramCacheKey = () => 'decor-bush-depth';
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, bushes.length));
      mesh.customDepthMaterial = depth;
      bushes.forEach((b, i) => {
        this.q.setFromAxisAngle(UP, b.rot);
        const sc = b.cell === 2 ? b.s * 0.9 : b.s;
        this.m4.compose(this.v.set(b.x, hAt(b.x, b.z) - 0.05, b.z), this.q, this.s.set(sc, sc * (b.cell === 2 ? 0.8 : 0.85), sc));
        mesh.setMatrixAt(i, this.m4);
      });
      mesh.count = bushes.length;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }

    // ---------------- bark: logs and stumps (sides) + growth-ring caps
    const tex = assets.manifest.textures as Record<string, Record<string, string> | undefined>;
    const bark = tex.bark;
    const barkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    if (bark?.color) { barkMat.map = assets.texture(bark.color, true); barkMat.map.repeat.set(2, 1); }
    if (bark?.normal) { barkMat.normalMap = assets.texture(bark.normal, false); barkMat.normalMap.repeat.set(2, 1); barkMat.normalScale.set(1.2, 1.2); }
    if (bark?.roughness) { barkMat.roughnessMap = assets.texture(bark.roughness, false); barkMat.roughnessMap.repeat.set(2, 1); }
    // moss creeps over whatever faces the sky
    barkMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUp = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vUp;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.36, 0.1), smoothstep(0.6, 0.95, vUp) * 0.55);');
    };
    barkMat.customProgramCacheKey = () => 'decor-bark';
    const capMat = new THREE.MeshStandardMaterial({ map: atlas ?? undefined, roughness: 0.85, alphaTest: 0.3 });
    capMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = ${ATLAS_UV('3.0')};\n#endif`);
    };
    capMat.customProgramCacheKey = () => 'decor-cap';

    const logs: THREE.Matrix4[] = [], stumps: THREE.Matrix4[] = [];
    for (const t of treeSpots) {
      if (r() > 0.22) continue;
      const a = r() * Math.PI * 2, d = 0.8 + r() * 1.4;
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (!allowed(x, z) || treesNear(x, z, 2.4) > 4 || near(x, z, 0.5)) continue;   // visible, not under the canopy
      if (r() < 0.45) {
        const rad = 0.19 + r() * 0.12, len = 1.2 + r() * 1.3, yaw = r() * Math.PI * 2;
        // follow the slope along the log
        const hx = Math.cos(yaw) * len * 0.5, hz = -Math.sin(yaw) * len * 0.5;
        const h0 = hAt(x - hx, z - hz), h1 = hAt(x + hx, z + hz);
        this.e.set(0, yaw, Math.atan2(h1 - h0, len));
        this.q.setFromEuler(this.e);
        logs.push(new THREE.Matrix4().compose(new THREE.Vector3(x, (h0 + h1) / 2 + rad * 0.55, z), this.q.clone(), new THREE.Vector3(len, rad, rad)));
      } else {
        const rad = 0.16 + r() * 0.16, h = 0.14 + r() * 0.24;
        this.q.setFromAxisAngle(UP, r() * Math.PI * 2);
        stumps.push(new THREE.Matrix4().compose(new THREE.Vector3(x, hAt(x, z) - 0.03, z), this.q.clone(), new THREE.Vector3(rad, h, rad)));
      }
    }
    const logGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1).rotateZ(Math.PI / 2);
    const stumpGeo = new THREE.CylinderGeometry(0.9, 1.15, 1, 12, 1).translate(0, 0.5, 0);
    for (const [geo, list] of [[logGeo, logs], [stumpGeo, stumps]] as const) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geo, [barkMat, capMat, capMat], list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }

    // ---------------- ruins in the border
    const stone = tex.ruin_stone;
    // weathered grey stone (the sandstone texture, cooled down), blocks at a believable size
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xa9a8a2, roughness: 0.92 });
    for (const [key, slot, srgb] of [['color', 'map', true], ['normal', 'normalMap', false], ['roughness', 'roughnessMap', false]] as const) {
      const url = stone?.[key];
      if (!url) continue;
      const t = assets.texture(url, srgb).clone();
      t.repeat.set(2, 1.4);
      t.needsUpdate = true;
      (stoneMat as unknown as Record<string, THREE.Texture>)[slot] = t;
    }
    // mostly desaturated: old grey stone with a hint of the sandstone warmth
    stoneMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))), diffuseColor.rgb, 0.3);');
    };
    stoneMat.customProgramCacheKey = () => 'decor-stone';
    for (const site of RUIN_SITES) if (allowed(site.x, site.z)) this.group.add(this.ruin(site.x, site.z, r, stoneMat, hAt));

    // ---------------- banners at the checkpoints
    if (atlas) {
      const pole = new THREE.CylinderGeometry(0.035, 0.045, 2.7, 6).translate(0, 1.35, 0);
      const bar = new THREE.CylinderGeometry(0.025, 0.025, 0.82, 5).rotateZ(Math.PI / 2).translate(0.36, 2.6, 0);
      const wood = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.7, metalness: 0.1 });
      const flagGeo = new THREE.PlaneGeometry(0.7, 1.55, 6, 12).translate(0.36, 2.6 - 0.8, 0);
      map.checkpoints.forEach((cp, i) => {
        for (const [dx, dz] of [[2.9, -0.9], [-0.9, 2.9]]) {
          const x = cp.x + dx, z = cp.z + dz;
          const cell = (i + (dx > 0 ? 0 : 1)) % 2 ? 5 : 4;
          const flagMat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
          const ph = r() * 6.28;
          const wave = (sh: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }) => {
            sh.uniforms.uTime = this.u.uTime; sh.uniforms.uWind = this.u.uWind;
            sh.vertexShader = 'uniform float uTime, uWind;\n' + sh.vertexShader
              .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = ${ATLAS_UV(cell.toFixed(1))};\n#endif`)
              .replace('#include <begin_vertex>', `#include <begin_vertex>
                // cloth: pinned along the top bar, ripples travel down and away from the pole
                float hang = clamp((2.6 - position.y) / 1.55, 0.0, 1.0);
                float from = clamp((position.x - 0.01) / 0.7, 0.0, 1.0);
                float amp = (0.018 + 0.035 * uWind) * (0.25 + 0.75 * hang) * (0.4 + 0.6 * from);
                transformed.z += sin(uTime * 2.6 + ${ph.toFixed(2)} - position.y * 2.4 - position.x * 3.0) * amp;
                transformed.x += sin(uTime * 1.9 + ${ph.toFixed(2)} - position.y * 1.6) * 0.012 * hang * uWind;`);
          };
          flagMat.onBeforeCompile = wave;
          flagMat.customProgramCacheKey = () => `decor-flag-${cell}-${ph.toFixed(2)}`;
          const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
          depth.onBeforeCompile = wave;
          depth.customProgramCacheKey = () => `decor-flag-depth-${cell}-${ph.toFixed(2)}`;
          const g = new THREE.Group();
          const pm = new THREE.Mesh(pole, wood), bm = new THREE.Mesh(bar, wood), fm = new THREE.Mesh(flagGeo, flagMat);
          fm.customDepthMaterial = depth;
          for (const m of [pm, bm, fm]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
          g.position.set(x, hAt(x, z) - 0.05, z);
          // face the flag toward the camera side (south) with a little variety
          g.rotation.y = (dx > 0 ? -0.35 : 0.35) + (r() - 0.5) * 0.3;
          this.group.add(g);
          this.banners.push({ mesh: g, cell: inBounds(Math.floor(x), Math.floor(z)) ? idx(Math.floor(x), Math.floor(z)) : -1 });
        }
      });
    }

    // ---------------- butterflies (two hinged wing quads, flap in the shader)
    if (atlas) {
      const N = 28;
      const wing = new THREE.PlaneGeometry(0.5, 1, 1, 1).rotateX(-Math.PI / 2);
      const left = wing.clone().translate(-0.25, 0, 0), right = wing.clone().translate(0.25, 0, 0);
      // each wing shows its own half of the sprite
      for (const [gq, u0] of [[left, 0], [right, 0.5]] as const) {
        const uv = gq.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.5);
      }
      const geo = mergeGeos([left, right]);
      const cells = new Float32Array(N), ph = new Float32Array(N);
      for (let i = 0; i < N; i++) { cells[i] = r() < 0.6 ? 6 : 7; ph[i] = r() * 6.28; }
      geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
      const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.u.uTime;
        sh.vertexShader = 'uniform float uTime; attribute float aCell; attribute float aPhase;\n' + sh.vertexShader
          .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = ${ATLAS_UV('aCell')};\n#endif`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            // wings hinge on the body (x = 0) and beat in bursts
            float beat = sin(uTime * 17.0 + aPhase) * 0.5 + 0.5;
            float ang = mix(0.15, 1.25, beat);
            float sx = sign(position.x), ax = abs(position.x);
            transformed.x = sx * ax * cos(ang);
            transformed.y = ax * sin(ang);`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
      };
      mat.customProgramCacheKey = () => 'decor-butterfly';
      const mesh = new THREE.InstancedMesh(geo, mat, N);
      mesh.frustumCulled = false;
      const st = Array.from({ length: N }, () => {
        let hx = 0, hz = 0;
        for (let k = 0; k < 20; k++) { hx = -4 + r() * (W + 8); hz = -4 + r() * (H + 8); if (terrain.terrainAt(Math.floor(hx), Math.floor(hz)) !== T.Water) break; }
        return { x: hx, z: hz, y: 0.8, hx, hz, ph: r() * 100, sp: 0.6 + r() * 0.6 };
      });
      this.flies = { mesh, st };
      this.group.add(mesh);
    }
  }

  /** A small ruin: broken columns in a rough arc, fallen drums, a crumbled wall and loose blocks. */
  private ruin(x: number, z: number, r: () => number, mat: THREE.Material, hAt: (x: number, z: number) => number) {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, px: number, pz: number, rot: THREE.Euler, lift = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, hAt(px, pz) + lift, pz);
      m.rotation.copy(rot);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    };
    const n = 3 + Math.floor(r() * 3), a0 = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 1.3, d = 1.8 + r() * 0.6;
      const h = 0.7 + r() * 1.9;
      add(brokenColumn(0.26, h, r), x + Math.cos(a) * d, z + Math.sin(a) * d, new THREE.Euler((r() - 0.5) * 0.08, r() * 6.28, (r() - 0.5) * 0.08), -0.08);
    }
    for (let i = 0; i < 2 + Math.floor(r() * 2); i++) {
      const px = x + (r() - 0.5) * 3, pz = z + (r() - 0.5) * 3;
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.5 + r() * 0.5, 12).rotateZ(Math.PI / 2), px, pz, new THREE.Euler(0, r() * 6.28, 0), 0.18);
    }
    const wall = crumbledWall(2.6, 0.85, 0.42, r);
    add(wall, x + (r() - 0.5), z + (r() - 0.5), new THREE.Euler(0, r() * 6.28, 0), -0.1);
    for (let i = 0; i < 5; i++) {
      const s = 0.18 + r() * 0.22;
      add(new THREE.BoxGeometry(s * 1.6, s, s), x + (r() - 0.5) * 4.5, z + (r() - 0.5) * 4.5, new THREE.Euler((r() - 0.5) * 0.6, r() * 6.28, (r() - 0.5) * 0.6), s * 0.3);
    }
    return g;
  }

  update(time: number, wind: number, nightness: number, dt: number) {
    this.u.uTime.value = time;
    this.u.uWind.value += (wind - this.u.uWind.value) * 0.02;
    // banners step aside for anything built on their spot
    for (const b of this.banners) b.mesh.visible = b.cell < 0 || this.grid.occupant[b.cell] < 0;
    // butterflies: wandering loops around a home spot, gone at night and in the rain
    const f = this.flies;
    if (!f) return;
    f.mesh.visible = nightness < 0.4 && wind < 1.5;
    if (!f.mesh.visible) return;
    f.st.forEach((b, i) => {
      b.ph += dt * b.sp;
      const t = b.ph;
      const tx = b.hx + Math.sin(t * 0.7) * 2.2 + Math.sin(t * 1.9) * 0.6;
      const tz = b.hz + Math.cos(t * 0.53) * 2.2 + Math.cos(t * 2.3) * 0.5;
      const dx = tx - b.x, dz = tz - b.z;
      b.x = tx; b.z = tz;
      b.y = this.terrain.heightAt(b.x, b.z) + 0.55 + Math.sin(t * 3.1) * 0.25 + Math.sin(t * 7.3) * 0.08;
      this.e.set(0, Math.atan2(dx, dz), 0);
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v.set(b.x, b.y, b.z), this.q, this.s.setScalar(0.42));
      f.mesh.setMatrixAt(i, this.m4);
    });
    f.mesh.instanceMatrix.needsUpdate = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Clearings in the border forest for the ruins (Props leaves these spots free of trees). */
export const RUIN_SITES = [{ x: -6.5, z: H * 0.32 }, { x: W * 0.42, z: -6.5 }, { x: W + 6.5, z: H * 0.62 }];
export const RUIN_CLEARING = 4.6;

/** A column with a jagged, broken top. */
function brokenColumn(radius: number, height: number, r: () => number) {
  const g = new THREE.CylinderGeometry(radius * 0.92, radius, height, 12, 4).translate(0, height / 2, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const cut = Array.from({ length: 13 }, () => (r() - 0.3) * radius * 1.6);
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < height - 1e-3) continue;
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = Math.round(((a + Math.PI) / (Math.PI * 2)) * 12);
    p.setY(i, height - Math.max(0, cut[k]));
  }
  g.computeVertexNormals();
  return g;
}

/** A low wall whose top is knocked into ragged steps. */
function crumbledWall(len: number, height: number, depth: number, r: () => number) {
  const g = new THREE.BoxGeometry(len, height, depth, 8, 2, 1).translate(0, height / 2, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const drop = Array.from({ length: 9 }, () => r() * height * 0.7);
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < height - 1e-3) continue;
    const k = Math.round(((p.getX(i) + len / 2) / len) * 8);
    p.setY(i, height - drop[k]);
  }
  g.computeVertexNormals();
  return g;
}

function mergeGeos(list: THREE.BufferGeometry[]) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const arrs = list.map((x) => x.getAttribute(name).array as Float32Array);
    const out = new Float32Array(arrs.reduce((a, b) => a + b.length, 0));
    let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
    g.setAttribute(name, new THREE.BufferAttribute(out, list[0].getAttribute(name).itemSize));
  }
  const ix: number[] = [];
  let base = 0;
  for (const x of list) { for (const i of x.getIndex()!.array) ix.push(i + base); base += x.getAttribute('position').count; }
  g.setIndex(ix);
  return g;
}
