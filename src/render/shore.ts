// Pond life: lily pads floating on the water and clumps of reeds and cattails along the
// waterline. Lily pads use the diffui decal atlas (water_decals.png, 2x2); reeds are modelled
// here (curved tapered blades + cattail heads). Both are single instanced draws, animated on the
// GPU (bobbing pads, reeds swaying in the wind), and reeds duck out of the way of buildings.

import * as THREE from 'three';
import { W, H } from '../game/grid';
import { WATER_LEVEL } from '../game/map';
import type { TerrainView } from './terrain';
import type { Assets } from './assets';

function rand(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** A clump of reeds: `n` curved tapered blades fanning out, plus two cattails. */
function reedClump(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const r = rand(77);
  const green = new THREE.Color(0x3f7a2a), tip = new THREE.Color(0xb9b46a), stalk = new THREE.Color(0x5a7a34), head = new THREE.Color(0x4a2c17);
  const strip = (ang: number, lean: number, h: number, w: number, c0: THREE.Color, c1: THREE.Color, segs = 4) => {
    const base = pos.length / 3;
    const dx = Math.sin(ang), dz = Math.cos(ang), px = Math.cos(ang), pz = -Math.sin(ang);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const out = lean * t * t;                       // curves outward toward the tip
      const hw = w * (1 - t * 0.92);
      const x = dx * out, z = dz * out, y = h * t;
      pos.push(x - px * hw, y, z - pz * hw, x + px * hw, y, z + pz * hw);
      const c = c0.clone().lerp(c1, t * t);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < segs) { const k = base + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  };
  const n = 9;
  for (let i = 0; i < n; i++) strip((i / n) * Math.PI * 2 + r() * 0.6, 0.12 + r() * 0.3, 0.75 + r() * 0.55, 0.035, green, tip);
  // cattails: a stalk and a fat brown head near the top
  for (let i = 0; i < 2; i++) {
    const a = r() * Math.PI * 2, h = 1.1 + r() * 0.35, lean = 0.08 + r() * 0.08;
    strip(a, lean, h, 0.012, stalk, stalk, 3);
    const hx = Math.sin(a) * lean, hz = Math.cos(a) * lean;
    const cyl = new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6, 1);
    cyl.translate(hx * 0.9, h - 0.17, hz * 0.9);
    const p = cyl.getAttribute('position') as THREE.BufferAttribute, ci = cyl.getIndex()!;
    const base = pos.length / 3;
    for (let k = 0; k < p.count; k++) { pos.push(p.getX(k), p.getY(k), p.getZ(k)); col.push(head.r, head.g, head.b); }
    for (let k = 0; k < ci.count; k++) idx.push(base + ci.getX(k));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class ShoreLife {
  group = new THREE.Group();
  private uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

  constructor(terrain: TerrainView, assets: Assets) {
    const r = rand(9127);
    const depthAt = (x: number, z: number) => WATER_LEVEL - terrain.heightAt(x, z);

    // ---------------- lily pads: clusters on the open water
    const pads: { x: number; z: number; s: number; rot: number; cell: number }[] = [];
    const seeds: { x: number; z: number }[] = [];
    for (let z = -18; z < H + 18; z += 0.9) for (let x = -18; x < W + 18; x += 0.9) {
      const d = depthAt(x, z);
      if (d > 0.16 && d < 0.72 && r() < 0.06) seeds.push({ x, z });
    }
    for (const c of seeds) {
      const n = 3 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 1.3;
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr, s = 0.45 + r() * 0.5;
        if (depthAt(x, z) < 0.1) continue;
        if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < (p.s + s) * 0.42)) continue;
        const f = r();
        pads.push({ x, z, s, rot: r() * Math.PI * 2, cell: f < 0.12 ? 1 : f < 0.2 ? 3 : f < 0.45 ? 2 : 0 });
      }
    }
    const padGeo = new THREE.PlaneGeometry(1, 1);
    padGeo.rotateX(-Math.PI / 2);
    const cells = new Float32Array(pads.length), phases = new Float32Array(pads.length);
    pads.forEach((p, i) => { cells[i] = p.cell; phases[i] = r() * 6.28; });
    padGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
    padGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    const atlasUrl = assets.ui('water_decals');
    const padMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.8 });
    if (atlasUrl) { const t = assets.texture(atlasUrl, true); t.anisotropy = 4; padMat.map = t; }
    padMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.vertexShader = 'uniform float uTime; attribute float aCell; attribute float aPhase;\n' + sh.vertexShader
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          #ifdef USE_MAP
            vMapUv = (uv + vec2(mod(aCell, 2.0), 1.0 - floor(aCell / 2.0))) * 0.5;
          #endif`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // bob on the swell and turn a little in the breeze
          float bob = sin(uTime * 0.9 + aPhase) * 0.012;
          float sp = sin(uTime * 0.23 + aPhase * 1.7) * 0.08;
          transformed.xz = mat2(cos(sp), -sin(sp), sin(sp), cos(sp)) * transformed.xz;
          transformed.y += bob + transformed.x * sin(uTime * 0.7 + aPhase) * 0.03;`);
    };
    const padMesh = new THREE.InstancedMesh(padGeo, padMat, Math.max(1, pads.length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    pads.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      m4.compose(p3.set(p.x, WATER_LEVEL + 0.012 + i * 0.0004, p.z), q, sc.set(p.s, 1, p.s));
      padMesh.setMatrixAt(i, m4);
    });
    padMesh.count = pads.length;
    padMesh.receiveShadow = true;
    padMesh.renderOrder = 3;          // after the water surface
    this.group.add(padMesh);

    // ---------------- reeds along the waterline (the shallow shelf just inside the shore)
    const reeds: { x: number; z: number; s: number; rot: number }[] = [];
    for (let z = -18; z < H + 18; z += 0.55) for (let x = -18; x < W + 18; x += 0.55) {
      const jx = x + (r() - 0.5) * 0.5, jz = z + (r() - 0.5) * 0.5;
      const d = depthAt(jx, jz);
      if (d < -0.02 || d > 0.14) continue;
      // clumps come in stands, with gaps between them
      const stand = Math.sin(jx * 0.9 + Math.sin(jz * 0.7) * 2.0) * 0.5 + 0.5;
      if (r() > 0.35 + stand * 0.6) continue;
      reeds.push({ x: jx, z: jz, s: 0.7 + r() * 0.6, rot: r() * Math.PI * 2 });
    }
    const reedGeo = reedClump();
    const rph = new Float32Array(reeds.length);
    reeds.forEach((_, i) => { rph[i] = r() * 6.28; });
    reedGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(rph, 1));
    const reedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    reedMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.uniforms.uWind = this.uniforms.uWind;
      sh.uniforms.tOcc = { value: terrain.occ };
      sh.uniforms.uPlay = { value: new THREE.Vector2(W, H) };
      sh.vertexShader = 'uniform float uTime, uWind; uniform sampler2D tOcc; uniform vec2 uPlay; attribute float aPhase;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 ip = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            // buildings (e.g. a water wheel) push the reeds flat
            vec2 ouv = ip.xz / uPlay;
            float occ = (ouv.x > 0.0 && ouv.y > 0.0 && ouv.x < 1.0 && ouv.y < 1.0) ? textureLod(tOcc, ouv, 0.0).r : 0.0;
            transformed.y *= 1.0 - smoothstep(0.2, 0.6, occ);
            float t = transformed.y;
            float ph = uTime * 1.3 + aPhase + ip.x * 0.2;
            float gust = sin(uTime * 0.37 + ip.x * 0.05 + ip.z * 0.03) * 0.5 + 0.5;
            transformed.x += (sin(ph) * 0.05 + gust * 0.07) * t * t * uWind;
            transformed.z += cos(ph * 0.8) * 0.035 * t * t * uWind;
          }`);
    };
    const reedMesh = new THREE.InstancedMesh(reedGeo, reedMat, Math.max(1, reeds.length));
    reeds.forEach((rd, i) => {
      q.setFromAxisAngle(up, rd.rot);
      m4.compose(p3.set(rd.x, terrain.heightAt(rd.x, rd.z) - 0.04, rd.z), q, sc.setScalar(rd.s));
      reedMesh.setMatrixAt(i, m4);
    });
    reedMesh.count = reeds.length;
    reedMesh.castShadow = true;
    reedMesh.receiveShadow = true;
    this.group.add(reedMesh);
    console.info(`shore: ${pads.length} lily pads, ${reeds.length} reed clumps`);
  }

  update(time: number, wind: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uWind.value += (wind - this.uniforms.uWind.value) * 0.02;
  }
}
