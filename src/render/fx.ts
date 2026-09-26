// All transient visuals: particles, lightning ribbons (power links, tesla chains, storm strikes),
// projectiles, novas, spell zones, whelps and weather.

import * as THREE from 'three';
import type { Game } from '../game/sim';
import type { GameEvent, Link, Projectile } from '../game/types';
import type { Assets } from './assets';
import { glowTexture, ringTexture, sigilTexture, smokeTexture, softTexture, swirlTexture } from './textures';
import type { StructureViews } from './structures';
import type { RunnerViews } from './runners';
import type { World } from './world';
import type { TerrainView } from './terrain';
import type { LightPool } from './lights';
import type { GroundDamage } from './damage';

// ------------------------------------------------------------------ particles
interface PEmit {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  color: THREE.Color | number; size: number; life: number;
  gravity?: number; grow?: number; drag?: number; alpha?: number; spin?: number;
}

class ParticleSystem {
  points: THREE.Points;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private vel: Float32Array; private life: Float32Array; private maxLife: Float32Array; private grav: Float32Array; private grow: Float32Array; private drag: Float32Array; private a0: Float32Array; private s0: Float32Array;
  n = 0;
  uniforms = { uScale: { value: 600 }, tMap: { value: null as THREE.Texture | null } };

  constructor(private max: number, tex: THREE.Texture, additive: boolean) {
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grav = new Float32Array(max);
    this.grow = new Float32Array(max); this.drag = new Float32Array(max); this.a0 = new Float32Array(max); this.s0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms.tMap.value = tex;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
          vColor = color; vAlpha = alpha;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(tMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(e: PEmit) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const c = typeof e.color === 'number' ? tmpC.set(e.color) : e.color;
    this.pos[i * 3] = e.x; this.pos[i * 3 + 1] = e.y; this.pos[i * 3 + 2] = e.z;
    this.vel[i * 3] = e.vx ?? 0; this.vel[i * 3 + 1] = e.vy ?? 0; this.vel[i * 3 + 2] = e.vz ?? 0;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.size[i] = e.size; this.s0[i] = e.size;
    this.alpha[i] = e.alpha ?? 1; this.a0[i] = e.alpha ?? 1;
    this.life[i] = 0; this.maxLife[i] = e.life;
    this.grav[i] = e.gravity ?? 0; this.grow[i] = e.grow ?? 0; this.drag[i] = e.drag ?? 0;
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this.kill(i); continue; }
      const t = this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] * (1 + this.grow[i] * t);
      this.alpha[i] = this.a0[i] * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      i++;
    }
    const geo = this.points.geometry;
    for (const k of ['position', 'color', 'size', 'alpha']) (geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, this.n);
  }

  private kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    for (const [arr, w] of [[this.pos, 3], [this.col, 3], [this.vel, 3]] as [Float32Array, number][]) for (let k = 0; k < w; k++) arr[i * w + k] = arr[j * w + k];
    for (const arr of [this.size, this.alpha, this.life, this.maxLife, this.grav, this.grow, this.drag, this.a0, this.s0]) arr[i] = arr[j];
  }
}
const tmpC = new THREE.Color();

// ------------------------------------------------------------------ ribbons (lightning, beams)
interface Ribbon { pts: THREE.Vector3[]; width: number; color: THREE.Color; intensity: number; life: number; max: number; fade: boolean }

class RibbonBatch {
  mesh: THREE.Mesh;
  private posA: Float32Array; private colA: Float32Array; private uvA: Float32Array;
  private idxA: Uint32Array;
  private maxV: number;

  constructor(maxVerts = 40000) {
    this.maxV = maxVerts;
    this.posA = new Float32Array(maxVerts * 3); this.colA = new Float32Array(maxVerts * 4); this.uvA = new Float32Array(maxVerts * 2);
    this.idxA = new Uint32Array(maxVerts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.posA, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colA, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uvA, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(this.idxA, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'attribute vec4 color; varying vec4 vColor; varying vec2 vUv; void main(){ vColor = color; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        varying vec4 vColor; varying vec2 vUv;
        void main(){
          float x = clamp(abs(vUv.y * 2.0 - 1.0), 0.0, 1.0);
          float core = pow(1.0 - x, 3.0);
          float halo = pow(1.0 - x, 1.2) * 0.35;
          vec3 c = vColor.rgb * (halo + core * 1.2) + vec3(core * core * core) * vColor.a * 0.3;
          gl_FragColor = vec4(c * vColor.a, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  build(ribbons: Ribbon[], cam: THREE.Camera) {
    let v = 0, ix = 0;
    const camPos = cam.position;
    const dir = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3();
    for (const r of ribbons) {
      const n = r.pts.length;
      if (n < 2 || v + n * 2 >= this.maxV) continue;
      const a = r.fade ? Math.max(0, 1 - r.life / r.max) : 1;
      const I = r.intensity * a;
      const base = v;
      for (let i = 0; i < n; i++) {
        const p = r.pts[i];
        const p0 = r.pts[Math.max(0, i - 1)], p1 = r.pts[Math.min(n - 1, i + 1)];
        dir.subVectors(p1, p0).normalize();
        toCam.subVectors(camPos, p).normalize();
        side.crossVectors(dir, toCam).normalize().multiplyScalar(r.width * 0.5);
        for (let s = 0; s < 2; s++) {
          const sign = s ? 1 : -1;
          this.posA[v * 3] = p.x + side.x * sign; this.posA[v * 3 + 1] = p.y + side.y * sign; this.posA[v * 3 + 2] = p.z + side.z * sign;
          this.colA[v * 4] = r.color.r * I; this.colA[v * 4 + 1] = r.color.g * I; this.colA[v * 4 + 2] = r.color.b * I; this.colA[v * 4 + 3] = Math.min(1, I);
          this.uvA[v * 2] = i / (n - 1); this.uvA[v * 2 + 1] = s;
          v++;
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const k = base + i * 2;
        this.idxA[ix++] = k; this.idxA[ix++] = k + 1; this.idxA[ix++] = k + 2;
        this.idxA[ix++] = k + 1; this.idxA[ix++] = k + 3; this.idxA[ix++] = k + 2;
      }
    }
    const geo = this.mesh.geometry;
    for (const k of ['position', 'color', 'uv']) (geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    geo.index!.needsUpdate = true;
    geo.setDrawRange(0, ix);
  }
}

function jagged(a: THREE.Vector3, b: THREE.Vector3, rough: number, depth: number, arc = 0): THREE.Vector3[] {
  let pts = [a.clone(), b.clone()];
  const len = a.distanceTo(b);
  let amp = len * rough;
  for (let d = 0; d < depth; d++) {
    const next: THREE.Vector3[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const m = pts[i].clone().add(pts[i + 1]).multiplyScalar(0.5);
      m.x += (Math.random() - 0.5) * amp; m.y += (Math.random() - 0.5) * amp; m.z += (Math.random() - 0.5) * amp;
      next.push(m, pts[i + 1]);
    }
    pts = next;
    amp *= 0.55;
  }
  if (arc) {
    const n = pts.length - 1;
    pts.forEach((p, i) => { const t = i / n; p.y += arc * 4 * t * (1 - t); });
  }
  return pts;
}

function smoothArc(a: THREE.Vector3, b: THREE.Vector3, arc: number, n: number, wobble: number, phase: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const d = new THREE.Vector3().subVectors(b, a);
  const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y += arc * 4 * t * (1 - t);
    const w = Math.sin(t * Math.PI * 3 + phase) * wobble * Math.sin(t * Math.PI);
    p.addScaledVector(side, w);
    p.y += Math.cos(t * Math.PI * 2 + phase * 1.3) * wobble * 0.5 * Math.sin(t * Math.PI);
    pts.push(p);
  }
  return pts;
}

// ------------------------------------------------------------------ main effects class
const COLORS = {
  energy: new THREE.Color(0.3, 0.62, 1.8),
  mana: new THREE.Color(1.0, 0.35, 1.6),
  leech: new THREE.Color(1.6, 0.3, 0.2),
  tesla: new THREE.Color(0.6, 0.9, 2.0),
  holy: new THREE.Color(2.0, 1.6, 0.6),
  vine: new THREE.Color(0.3, 1.2, 0.3),
  drain: new THREE.Color(1.1, 0.3, 1.6),
  strike: new THREE.Color(1.2, 1.4, 2.4),
};

const LINK_LIGHT = new THREE.Color(0.45, 0.72, 1.0);
const ARC_CORE = new THREE.Color(1.3, 1.5, 1.8);
const MANA_LIGHT = new THREE.Color(0.8, 0.35, 1.0);

const PROJ: Record<string, { color: number; size: number; trail?: number; core?: number }> = {
  fireball: { color: 0xff6a1a, size: 1.1, trail: 0xff7a2a },
  frost: { color: 0x7fdcff, size: 0.9, trail: 0xbff0ff },
  acid: { color: 0x7dff3a, size: 0.7, trail: 0x5aff2a },
  shadow: { color: 0xa64dff, size: 0.8, trail: 0x6a2acc },
  water: { color: 0x3aa8ff, size: 0.7, trail: 0x9fdcff },
  light: { color: 0xfff08a, size: 0.8, trail: 0xffe08a },
  spark: { color: 0x7fd4ff, size: 0.55, trail: 0x9fe8ff },
  arcane: { color: 0x8a7aff, size: 1.3, trail: 0xb89aff },
  ember: { color: 0xff8a2a, size: 0.5, trail: 0xff6a1a },
  thorn: { color: 0x6aff4a, size: 0.4 },
};

interface ZoneView { obj: THREE.Object3D; kind: string }
interface Nova { mesh: THREE.Mesh; t: number; dur: number; r: number }
interface Tween { sprite: THREE.Sprite; from: THREE.Vector3; to: () => THREE.Vector3 | null; t: number; dur: number; kind: string }
interface WhelpView { obj: THREE.Object3D; wing: number }

export class Effects {
  group = new THREE.Group();
  add: ParticleSystem;
  norm: ParticleSystem;
  private ribbons = new RibbonBatch();
  private transient: Ribbon[] = [];
  private linkCache = new Map<number, { pts: THREE.Vector3[]; t: number }>();
  private projViews = new Map<number, THREE.Object3D>();
  private projOffset = new Map<number, { off: THREE.Vector3; age: number }>();
  private zoneViews = new Map<number, ZoneView>();
  private novas: Nova[] = [];
  private tweens: Tween[] = [];
  private whelpViews = new Map<number, WhelpView>();
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainN = 5000;
  rainAmount = 0;
  private arcPools: { x: number; z: number; len: number; yaw: number; k: number }[] = [];
  private poolMesh: THREE.InstancedMesh;
  selectedId = -1;
  time = 0;
  emitters: { pos: THREE.Vector3; kind: 'fire' | 'portal' | 'mana' | 'crystal'; rate: number; acc: number }[] = [];

  constructor(private game: Game, private world: World, private assets: Assets, private sv: StructureViews, private rv: RunnerViews,
    private terrain: TerrainView, private lights: LightPool, private damage: GroundDamage) {
    this.add = new ParticleSystem(6000, softTexture(), true);
    this.norm = new ParticleSystem(3000, smokeTexture(), false);
    this.group.add(this.add.points, this.norm.points, this.ribbons.mesh);
    // rain
    this.rainPos = new Float32Array(this.rainN * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaac4e6, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    for (let i = 0; i < this.rainN; i++) this.resetDrop(i, true);
    this.group.add(this.rain);
    // soft blue light pools cast on the ground beneath power arcs
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.rotateX(-Math.PI / 2);
    this.poolMesh = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x3f8cff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }), 256);
    this.poolMesh.count = 0;
    this.poolMesh.frustumCulled = false;
    this.poolMesh.renderOrder = 2;
    this.group.add(this.poolMesh);
  }

  setViewportScale(h: number, fov: number) {
    const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.add.uniforms.uScale.value = s;
    this.norm.uniforms.uScale.value = s;
  }

  // ---------------------------------------------------------------- events
  /** Gameplay heights assume flat ground; visuals sit on the rolling terrain. */
  private gy(x: number, z: number) { return this.terrain.heightAt(x, z) - this.terrain.gameplayBase(x, z); }
  private gh(x: number, z: number) { return this.terrain.heightAt(x, z); }

  handle(e: GameEvent) {
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const L = this.lights, D = this.damage;
    switch (e.type) {
      case 'hit': this.impact(e.kind, e.x, (e.y ?? 0.6) + this.gy(e.x, e.z), e.z, !!e.powered, e.r ?? 0); break;
      case 'chain': {
        const pts = e.points.map((p) => P(p.x, p.y + this.gy(p.x, p.z), p.z));
        for (let i = 0; i < pts.length - 1; i++) {
          this.transient.push({ pts: jagged(pts[i], pts[i + 1], 0.22, 4), width: e.powered ? 0.28 : 0.12, color: COLORS.tesla, intensity: e.powered ? 1.5 : 0.8, life: 0, max: 0.22, fade: true });
          if (e.powered) this.transient.push({ pts: jagged(pts[i], pts[i + 1], 0.3, 4), width: 0.1, color: COLORS.tesla, intensity: 1, life: 0, max: 0.14, fade: true });
          this.burst(pts[i + 1], 0x9fe8ff, 6, 3, 0.25, 0.4, this.add);
          const h = pts[i + 1];
          L.flash(h.x, h.y + 0.3, h.z, 0x7fc8ff, e.powered ? 16 : 6, 4.5, 0.18);
          if (e.powered) D.stamp(h.x, h.z, 0.35, { scorch: 0.06, heat: 0.25 });
        }
        if (e.powered) L.flash(pts[0].x, pts[0].y, pts[0].z, 0x8fd0ff, 22, 7, 0.16, true);
        break;
      }
      case 'nova': this.nova(e.x, e.z, e.r, e.kind); break;
      case 'beam': {
        const y1 = e.y1 ?? 2;
        if (e.kind === 'holy') {
          const a = P(e.x1, y1 + this.gy(e.x1, e.z1), e.z1), b = P(e.x2, 0.7 + this.gh(e.x2, e.z2), e.z2);
          this.transient.push({ pts: [a, a.clone().lerp(b, 0.5), b], width: 0.7, color: COLORS.holy, intensity: 1.4, life: 0, max: 0.35, fade: true });
          for (let i = 0; i < 16; i++) { const p = a.clone().lerp(b, Math.random()); this.add.emit({ x: p.x, y: p.y, z: p.z, vy: 0.8, color: 0xffe89a, size: 0.35, life: 0.6 }); }
          const m = a.clone().lerp(b, 0.5);
          L.flash(m.x, m.y + 0.5, m.z, 0xffd87a, 18, 8, 0.3);
          D.line(e.x1, e.z1, e.x2, e.z2, 0.3, { scorch: 0.03, heat: 0.15 });
        } else if (e.kind === 'vine') {
          const a = P(e.x1, y1 + this.gy(e.x1, e.z1), e.z1), b = P(e.x2, 0.5 + this.gh(e.x2, e.z2), e.z2);
          this.transient.push({ pts: smoothArc(a, b, 0.6, 10, 0.25, Math.random() * 6), width: 0.16, color: COLORS.vine, intensity: 0.9, life: 0, max: 0.25, fade: true });
        } else {
          const a = P(e.x1, 0.9 + this.gh(e.x1, e.z1), e.z1), b = P(e.x2, 2 + this.gh(e.x2, e.z2), e.z2);
          this.transient.push({ pts: jagged(a, b, 0.15, 4), width: 0.14, color: COLORS.drain, intensity: 1.2, life: 0, max: 0.3, fade: true });
          L.flash(a.x, a.y, a.z, 0xb04dff, 6, 4, 0.25);
        }
        break;
      }
      case 'strike': {
        const top = P(e.x + (Math.random() - 0.5) * 6, 26, e.z + (Math.random() - 0.5) * 6);
        const bot = P(e.x, e.y + this.gy(e.x, e.z), e.z);
        const main = jagged(top, bot, 0.12, 6);
        this.transient.push({ pts: main, width: 0.45, color: COLORS.strike, intensity: 2.2, life: 0, max: 0.4, fade: true });
        for (let b = 0; b < 3; b++) {
          const from = main[Math.floor(main.length * (0.2 + Math.random() * 0.5))];
          const to = from.clone().add(P((Math.random() - 0.5) * 6, -3 - Math.random() * 4, (Math.random() - 0.5) * 6));
          this.transient.push({ pts: jagged(from, to, 0.2, 4), width: 0.18, color: COLORS.strike, intensity: 1.4, life: 0, max: 0.3, fade: true });
        }
        this.burst(bot, 0xbfe8ff, 24, 6, 0.35, 0.6, this.add);
        this.world.flash = 1;
        L.flash(bot.x, bot.y + 2.5, bot.z, 0xc8e4ff, 160, 22, 0.45, true);
        if (e.y < 1.5) D.stamp(e.x, e.z, 1.1, { scorch: 0.7, crater: 0.25, heat: 0.9 });
        break;
      }
      case 'spell': this.spellCast(e.spell, e.x, e.z, e.r); break;
      case 'soul': {
        const s = this.game.structById.get(e.toId);
        if (!s) break;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6aff9a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        sprite.scale.setScalar(0.7);
        this.group.add(sprite);
        const target = s;
        this.tweens.push({ sprite, from: P(e.x, 0.8 + this.gh(e.x, e.z), e.z), to: () => (this.game.structById.has(target.id) ? this.sv.anchor(target) : null), t: 0, dur: 1.1, kind: 'soul' });
        break;
      }
      case 'emp': break;
      case 'death': {
        const p = P(e.x, 0.6 + this.gh(e.x, e.z), e.z);
        this.burst(p, 0x6a8a3a, 10, 2.5, 0.25, 0.7, this.norm, 6);
        this.burst(p, 0xffd24a, 6, 2, 0.18, 0.6, this.add, 4);
        // a few pale wisps drift up from the body
        for (let i = 0; i < 3; i++) this.add.emit({ x: e.x + (Math.random() - 0.5) * 0.4, y: p.y + Math.random() * 0.3, z: e.z + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.3, vy: 0.9 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.3, color: 0xcfe8ff, size: 0.45 + Math.random() * 0.25, life: 1.1 + Math.random() * 0.5, drag: 0.6 });
        D.stamp(e.x, e.z, 0.55, { trample: 0.14 });
        break;
      }
      case 'leak': {
        const gp = this.game.map.castle;
        this.nova(gp.gateX + 0.5, gp.gateZ + 1, 2, 'emp');
        break;
      }
      case 'build': {
        const s = this.game.structById.get(e.structureId);
        if (!s) break;
        const by = this.gh(s.cx, s.cz);
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          this.norm.emit({ x: s.cx + Math.cos(a) * s.def.size * 0.5, y: by + 0.2, z: s.cz + Math.sin(a) * s.def.size * 0.5, vx: Math.cos(a) * 1.2, vy: 0.4, vz: Math.sin(a) * 1.2, color: 0xb59c7a, size: 0.9, life: 0.9, grow: 1.5, drag: 2, alpha: 0.6 });
        }
        // construction churns up the ground around the footprint
        D.stamp(s.cx, s.cz, s.def.size * 0.95, { trample: 0.22 });
        break;
      }
      case 'sell': {
        const by = this.gh(e.x, e.z);
        for (let i = 0; i < 20; i++) this.add.emit({ x: e.x + (Math.random() - 0.5) * e.size, y: by + 0.3, z: e.z + (Math.random() - 0.5) * e.size, vy: 1.5 + Math.random() * 2, color: 0xffd24a, size: 0.3, life: 0.9, gravity: 2 });
        D.stamp(e.x, e.z, e.size * 0.75, { trample: 0.45 });
        break;
      }
      case 'upgrade': {
        const s = this.game.structById.get(e.structureId);
        if (!s) break;
        const by = this.gh(s.cx, s.cz);
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2, r = s.def.size * 0.55;
          this.add.emit({ x: s.cx + Math.cos(a) * r, y: by + Math.random() * 0.5, z: s.cz + Math.sin(a) * r, vy: 2 + Math.random() * 2.5, color: 0xffd86a, size: 0.35, life: 1.1, drag: 0.5 });
        }
        L.flash(s.cx, by + 1.5, s.cz, 0xffd86a, 14, 6, 0.8);
        break;
      }
      case 'sound': {
        if (e.x === undefined || e.z === undefined) break;
        const s = this.structureNear(e.x, e.z);
        if (!s) break;
        const a = this.sv.anchor(s);
        if (e.name === 'cannon') {
          const dir = new THREE.Vector3(Math.sin(s.aim), 0.35, Math.cos(s.aim)).normalize();
          const m = this.sv.muzzle(s);
          for (let i = 0; i < 10; i++) this.norm.emit({ x: m.x, y: m.y, z: m.z, vx: dir.x * (1 + Math.random() * 2) + (Math.random() - 0.5), vy: 0.5 + Math.random() * 0.6, vz: dir.z * (1 + Math.random() * 2) + (Math.random() - 0.5), color: 0x8a8580, size: 0.7, life: 1.3, grow: 2.2, drag: 2, alpha: 0.55 });
          this.burst(m, 0xffc070, 8, 3, 0.35, 0.15, this.add);
          this.lights.flash(m.x, m.y, m.z, 0xffb060, 24, 6, 0.12);
        } else if (e.name === 'bolt') {
          const m = this.sv.muzzle(s);
          for (let i = 0; i < 5; i++) this.norm.emit({ x: m.x, y: m.y, z: m.z, vx: (Math.random() - 0.5) * 0.8, vy: 0.3, vz: (Math.random() - 0.5) * 0.8, color: 0xb8a888, size: 0.3, life: 0.5, grow: 1.2, drag: 3, alpha: 0.4 });
        } else if (e.name === 'fire') {
          this.burst(a, 0xff7a2a, 5, 1.5, 0.35, 0.3, this.add);
          this.lights.flash(a.x, a.y, a.z, 0xff7a2a, 8, 4, 0.15);
        } else if (e.name === 'frost') {
          this.burst(a, 0xcff4ff, 6, 1.2, 0.25, 0.4, this.add);
        } else if (e.name === 'arcane') {
          this.burst(a.clone().add(new THREE.Vector3(0, 1, 0)), 0x9a8aff, 8, 1.8, 0.3, 0.4, this.add);
          this.lights.flash(a.x, a.y + 1, a.z, 0x8a7aff, 12, 5, 0.2);
        }
        break;
      }
      case 'overheat': {
        const s = this.game.structById.get(e.structureId);
        if (s) { const a = this.sv.anchor(s); this.burst(a, 0xff7a2a, 30, 4, 0.4, 0.7, this.add); L.flash(a.x, a.y, a.z, 0xff6a1a, 20, 6, 0.6); }
        break;
      }
    }
  }

  private structureNear(x: number, z: number) {
    const s = this.game.structureAt(Math.floor(x), Math.floor(z));
    return s && s.def.id !== 'wall' ? s : undefined;
  }

  private burst(p: THREE.Vector3, color: number, n: number, speed: number, size: number, life: number, sys: ParticleSystem, grav = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      sys.emit({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * Math.cos(b) * v, vy: Math.abs(Math.sin(b)) * v, vz: Math.sin(a) * Math.cos(b) * v, color, size: size * (0.6 + Math.random() * 0.8), life: life * (0.6 + Math.random() * 0.6), gravity: grav, drag: 1.5 });
    }
  }

  private impact(kind: string, x: number, y: number, z: number, powered: boolean, r: number) {
    const ground = this.gh(x, z);
    const p = new THREE.Vector3(x, Math.max(ground + 0.3, y), z);
    const L = this.lights, D = this.damage;
    switch (kind) {
      case 'cannonball':
        p.setY(ground + 0.3);
        this.burst(p, 0xffb35a, 18, 5, 0.5, 0.35, this.add);
        this.burst(p, 0x8a7a66, 16, 2.5, 1.1, 1.2, this.norm);
        this.burst(p, 0x5a4a3a, 10, 5, 0.18, 0.8, this.norm, 9);
        this.nova(x, z, Math.max(1, r), 'dust');
        this.world.shake = Math.min(1, this.world.shake + 0.25);
        L.flash(x, ground + 0.8, z, 0xffa04a, 30, 7, 0.25);
        D.stamp(x, z, 0.8, { crater: 0.32, scorch: 0.12, heat: 0.4 });
        D.stamp(x, z, 1.4, { trample: 0.22 });
        break;
      case 'fireball': case 'ember':
        this.burst(p, 0xff7a2a, powered ? 20 : 10, 3, powered ? 0.6 : 0.4, 0.45, this.add);
        if (powered) this.burst(p, 0x5a4a44, 6, 1, 0.8, 0.9, this.norm);
        L.flash(x, p.y + 0.3, z, 0xff7a2a, powered ? 20 : 10, 5, 0.25);
        D.stamp(x, z, powered ? 0.65 : 0.45, { scorch: powered ? 0.22 : 0.1, heat: powered ? 0.7 : 0.4 });
        break;
      case 'frost':
        this.burst(p, 0xbff0ff, 12, 3, 0.35, 0.5, this.add, 3);
        L.flash(x, p.y + 0.3, z, 0x9fe0ff, 8, 4, 0.25);
        D.stamp(x, z, 0.6, { frost: 0.35 });
        break;
      case 'acid':
        this.burst(p, 0x7dff3a, powered ? 26 : 8, 3, powered ? 0.45 : 0.3, 0.6, this.add, 5);
        if (powered) this.nova(x, z, r || 1.3, 'acid');
        L.flash(x, p.y + 0.3, z, 0x7dff3a, powered ? 14 : 5, 4, 0.3);
        D.stamp(x, z, powered ? 1.2 : 0.4, { scorch: powered ? 0.18 : 0.05 });
        break;
      case 'shadow': this.burst(p, 0xa64dff, 10, 2, 0.4, 0.5, this.add); L.flash(x, p.y, z, 0xa64dff, 6, 3.5, 0.25); break;
      case 'water':
        this.burst(p, 0x9fdcff, 10, 3, 0.3, 0.5, this.add, 6);
        D.stamp(x, z, 0.5, { trample: 0.04 });
        break;
      case 'light': this.burst(p, 0xfff08a, 10, 2.5, 0.35, 0.4, this.add); L.flash(x, p.y + 0.3, z, 0xffe08a, 10, 4.5, 0.25); break;
      case 'arcane': this.burst(p, 0x9a8aff, 16, 3.5, 0.45, 0.5, this.add); L.flash(x, p.y + 0.3, z, 0x9a8aff, 16, 5, 0.3); D.stamp(x, z, 0.5, { scorch: 0.05 }); break;
      case 'spark': this.burst(p, 0x9fe8ff, 10, 3, 0.3, 0.3, this.add); L.flash(x, p.y + 0.2, z, 0x9fe8ff, 12, 4.5, 0.2, true); break;
      case 'bolt':
        // the bolt strikes: bright chips flying, grit kicked up, a quick glint
        this.burst(p, 0xfff0c8, powered ? 10 : 6, 5, 0.1, 0.18, this.add, 9);
        this.burst(p, 0xd8c8a0, 6, 2, 0.16, 0.35, this.norm, 5);
        L.flash(x, p.y + 0.1, z, 0xffe0b0, powered ? 6 : 3.5, 2.5, 0.1);
        D.stamp(x, z, 0.3, { trample: 0.04 });
        break;
    }
  }

  private nova(x: number, z: number, r: number, kind: string) {
    const colors: Record<string, number> = { frost: 0x8fe0ff, water: 0x3aa8ff, despair: 0xa64dff, entangle: 0x5aff4a, clock: 0xffd86a, emp: 0x7fd4ff, fire: 0xff6a1a, holy: 0xffe08a, arcane: 0x9a8aff, dust: 0xc8b090, acid: 0x7dff3a };
    const color = colors[kind] ?? 0xffffff;
    const mat = new THREE.MeshBasicMaterial({ map: ringTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: kind === 'clock' ? 0.35 : 0.9 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    const gy = this.gh(x, z);
    mesh.position.set(x, gy + 0.12, z);
    this.group.add(mesh);
    this.novas.push({ mesh, t: 0, dur: kind === 'clock' ? 0.8 : 0.45, r });
    const n = Math.min(40, Math.round(r * 12));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sys = kind === 'dust' ? this.norm : this.add;
      if (kind === 'clock') continue;
      sys.emit({ x: x + Math.cos(a) * r * 0.3, y: gy + 0.3, z: z + Math.sin(a) * r * 0.3, vx: Math.cos(a) * r * 2.2, vy: kind === 'fire' ? 2.5 : 0.5, vz: Math.sin(a) * r * 2.2, color, size: kind === 'fire' ? 0.8 : 0.4, life: 0.5, drag: 3 });
    }
    const L = this.lights, D = this.damage;
    const lightI: Record<string, number> = { frost: 16, water: 10, despair: 10, entangle: 8, emp: 16, fire: 45, holy: 20, arcane: 18, acid: 10 };
    if (lightI[kind]) L.flash(x, gy + 1, z, color, lightI[kind], r * 2.5 + 3, kind === 'fire' ? 0.7 : 0.4, kind === 'fire' || kind === 'emp');
    if (kind === 'frost') D.stamp(x, z, r, { frost: 0.7 });
    if (kind === 'water') D.stamp(x, z, r, { trample: 0.05 });
    if (kind === 'fire') {
      D.stamp(x, z, r, { scorch: 0.55, heat: 1 });
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
        this.add.emit({ x: x + Math.cos(a) * rr, y: gy + 0.2, z: z + Math.sin(a) * rr, vy: 3 + Math.random() * 4, color: i % 3 ? 0xff6a1a : 0xffc04a, size: 0.9, life: 0.7, drag: 1 });
      }
      this.world.shake = Math.min(1, this.world.shake + 0.3);
    }
    if (kind === 'entangle') {
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
        this.add.emit({ x: x + Math.cos(a) * rr, y: gy + 0.1, z: z + Math.sin(a) * rr, vy: 1.5, color: 0x4aff3a, size: 0.4, life: 0.6 });
      }
    }
  }

  private spellCast(spell: string, x: number, z: number, r: number) {
    if (spell === 'meteor') return; // projectile + nova handle it
    const col: Record<string, number> = { thunderstorm: 0x9fdcff, blizzard: 0xbff0ff, plague: 0x7dff3a, curse: 0xa64dff, consecrate: 0xffe08a, whirlpool: 0x3aa8ff, overgrowth: 0x5aff4a, stormbolt: 0x9fdcff };
    this.nova(x, z, Math.max(1, r), spell === 'consecrate' ? 'holy' : spell === 'curse' ? 'despair' : 'arcane');
    const gy = this.gh(x, z);
    for (let i = 0; i < 24; i++) this.add.emit({ x: x + (Math.random() - 0.5), y: gy + 3 + Math.random(), z: z + (Math.random() - 0.5), vy: -2, color: col[spell] ?? 0xffffff, size: 0.5, life: 0.8 });
    this.lights.flash(x, gy + 2, z, col[spell] ?? 0xffffff, 26, 8, 0.6);
  }

  // ---------------------------------------------------------------- per-frame
  update(dt: number) {
    this.time += dt;
    const g = this.game;
    const camera = this.world.camera;

    // continuous emitters
    for (const em of this.emitters) {
      em.acc += dt * em.rate;
      while (em.acc >= 1) {
        em.acc -= 1;
        const p = em.pos;
        if (em.kind === 'fire') {
          this.add.emit({ x: p.x + (Math.random() - 0.5) * 0.2, y: p.y, z: p.z + (Math.random() - 0.5) * 0.2, vy: 1.2 + Math.random(), color: Math.random() < 0.5 ? 0xff7a2a : 0xffb04a, size: 0.55, life: 0.5, grow: -0.6 });
          if (Math.random() < 0.15) this.norm.emit({ x: p.x, y: p.y + 0.5, z: p.z, vy: 0.8, vx: 0.2, color: 0x3a3632, size: 0.6, life: 1.5, grow: 2, alpha: 0.35 });
        } else if (em.kind === 'portal') {
          const a = Math.random() * Math.PI * 2;
          this.add.emit({ x: p.x + Math.cos(a) * 1.3, y: p.y + Math.sin(a) * 1.3, z: p.z + 0.2, vx: -Math.cos(a) * 1.1, vy: -Math.sin(a) * 1.1, color: Math.random() < 0.5 ? 0xff3a1a : 0x7aff3a, size: 0.4, life: 1.0 });
        } else if (em.kind === 'crystal') {
          this.add.emit({ x: p.x + (Math.random() - 0.5) * 1.6, y: p.y + Math.random() * 1.5, z: p.z + (Math.random() - 0.5) * 1.6, vy: 0.5, color: 0xc77dff, size: 0.25, life: 1.4 });
        }
      }
    }

    // fireflies along the forest edge at night
    if (this.world.nightness > 0.3 && this.game.env.weather !== 'rain' && this.game.env.weather !== 'storm') {
      const n = dt * 25 * this.world.nightness;
      for (let i = 0; i < n; i++) {
        const side = Math.floor(Math.random() * 4);
        const t = Math.random();
        const x = side === 0 ? -1.5 - Math.random() * 3 : side === 1 ? 65.5 + Math.random() * 3 : t * 64;
        const z = side === 2 ? -1.5 - Math.random() * 3 : side === 3 ? 49.5 + Math.random() * 3 : t * 48;
        this.add.emit({ x, y: this.gh(x, z) + 0.4 + Math.random() * 1.6, z, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.4, color: 0xd8ff6a, size: 0.14, life: 2.5 + Math.random() * 2 });
      }
    }

    // dust kicked up by runners on worn ground
    for (const r of g.runners) {
      if (!r.alive || !r.moving || r.type.flying) continue;
      if (Math.random() > dt * (r.type.boss ? 6 : 2.5)) continue;
      const k = Math.floor(r.z * 4) * 256 + Math.floor(r.x * 4);
      const worn = this.damage.trample[k] ?? 0;
      if (worn < 0.3) continue;
      const y = this.gh(r.x, r.z);
      this.norm.emit({ x: r.x + (Math.random() - 0.5) * 0.3, y: y + 0.1, z: r.z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.4, vy: 0.3, vz: (Math.random() - 0.5) * 0.4, color: worn > 0.7 ? 0x6a5540 : 0x9a8466, size: 0.45 * (r.type.boss ? 2 : 1), life: 1.1, grow: 1.6, drag: 1.5, alpha: 0.35 });
    }
    // pollen drifting in the sunlight around the view
    if (this.world.nightness < 0.4 && g.env.weather !== 'rain' && g.env.weather !== 'storm' && Math.random() < dt * 12) {
      const c = this.world.target;
      const x = c.x + (Math.random() - 0.5) * 36, z = c.z + (Math.random() - 0.5) * 26;
      this.add.emit({ x, y: this.gh(x, z) + 0.4 + Math.random() * 2.2, z, vx: 0.25 + Math.random() * 0.2, vy: (Math.random() - 0.5) * 0.1, vz: (Math.random() - 0.5) * 0.15, color: 0xfff2b0, size: 0.06, life: 5 + Math.random() * 3, alpha: 0.7 });
    }

    // structure ambience
    for (const s of g.structures) {
      if (s.def.id === 'wall') continue;
      const top = this.sv.anchor(s);
      const by = this.sv.views.get(s.id)?.group.position.y ?? this.gh(s.cx, s.cz);
      if (s.overheated > 0 && Math.random() < dt * 20) this.norm.emit({ x: top.x, y: top.y, z: top.z, vy: 1.5, vx: (Math.random() - 0.5) * 0.4, color: 0x2a2624, size: 0.9, life: 1.6, grow: 2, alpha: 0.7 });
      else if (s.overcharge && s.heat > 50 && Math.random() < dt * s.heat / 20) this.add.emit({ x: top.x, y: top.y, z: top.z, vx: (Math.random() - 0.5) * 2, vy: 1.5, vz: (Math.random() - 0.5) * 2, color: 0xff8a3a, size: 0.2, life: 0.4, gravity: 4 });
      if (s.disabled > 0 && Math.random() < dt * 15) this.add.emit({ x: top.x + (Math.random() - 0.5), y: top.y - Math.random(), z: top.z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 3, vy: 1, vz: (Math.random() - 0.5) * 3, color: 0x9fe8ff, size: 0.2, life: 0.25 });
      if (s.def.id === 'furnace' && s.producing > 0.5 && Math.random() < dt * 4) this.norm.emit({ x: top.x + 0.3, y: top.y + 0.6, z: top.z - 0.3, vy: 1.1, vx: 0.25, color: 0x4a4644, size: 0.7, life: 2.2, grow: 2.2, alpha: 0.45 });
      if (s.def.id === 'furnace' && s.producing > 0.5 && Math.random() < dt * 8) this.add.emit({ x: s.cx + (Math.random() - 0.5) * 0.5, y: by + 0.6, z: s.cz + 0.8, vy: 0.8, color: 0xff8a2a, size: 0.35, life: 0.5 });
      if (s.def.id === 'mana_well' && Math.random() < dt * (2 + s.producing)) this.add.emit({ x: s.cx + (Math.random() - 0.5) * 1.2, y: by + 0.8, z: s.cz + (Math.random() - 0.5) * 1.2, vy: 0.7, color: 0xb05cff, size: 0.3, life: 1.6 });
      if (s.def.id === 'graveyard' && Math.random() < dt * 1.5) this.add.emit({ x: s.cx + (Math.random() - 0.5) * 1.5, y: by + 0.4, z: s.cz + (Math.random() - 0.5) * 1.5, vy: 0.4, color: 0x5aff8a, size: 0.35, life: 2.2 });
      if (s.def.id === 'tesla_coil' && s.energy > 10 && Math.random() < dt * 1.2) {
        const a = top.clone().add(new THREE.Vector3(0, 0.3, 0));
        const b = a.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.4, -Math.random() * 1.2, (Math.random() - 0.5) * 1.4));
        this.transient.push({ pts: jagged(a, b, 0.3, 3), width: 0.08, color: COLORS.tesla, intensity: 1, life: 0, max: 0.12, fade: true });
      }
    }

    // links
    const ribbons: Ribbon[] = [];
    for (const l of g.links) ribbons.push(...this.linkRibbons(l));
    this.updatePools();
    for (const r of this.transient) r.life += dt;
    this.transient = this.transient.filter((r) => r.life < r.max);
    ribbons.push(...this.transient);
    this.ribbons.build(ribbons, camera);

    this.syncProjectiles(dt);
    this.syncZones(dt);
    this.syncWhelps(dt);

    for (const n of this.novas) {
      n.t += dt;
      const u = Math.min(1, n.t / n.dur);
      const e = 1 - Math.pow(1 - u, 2);
      n.mesh.scale.setScalar(Math.max(0.05, n.r * e));
      (n.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.9;
      if (u >= 1) { this.group.remove(n.mesh); n.mesh.geometry.dispose(); (n.mesh.material as THREE.Material).dispose(); }
    }
    this.novas = this.novas.filter((n) => n.t < n.dur);

    for (const tw of this.tweens) {
      tw.t += dt;
      const to = tw.to();
      if (!to) { tw.t = tw.dur; }
      else {
        const u = Math.min(1, tw.t / tw.dur);
        const p = tw.from.clone().lerp(to, u);
        p.y += Math.sin(u * Math.PI) * 2;
        tw.sprite.position.copy(p);
        if (Math.random() < 0.6) this.add.emit({ x: p.x, y: p.y, z: p.z, color: 0x5aff8a, size: 0.25, life: 0.4 });
      }
      if (tw.t >= tw.dur) this.group.remove(tw.sprite);
    }
    this.tweens = this.tweens.filter((t) => t.t < t.dur);

    this.updateRain(dt);
    this.add.update(dt);
    this.norm.update(dt);
  }

  private updatePools() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const night = 0.35 + this.world.nightness * 0.9;
    let n = 0;
    for (const a of this.arcPools) {
      if (n >= 256) break;
      q.setFromAxisAngle(up, a.yaw);
      const w = 2.2 + a.k * 1.5;
      m4.compose(p.set(a.x, this.gh(a.x, a.z) + 0.06, a.z), q, sc.set(w * night, 1, (a.len + w) * night));
      this.poolMesh.setMatrixAt(n, m4);
      this.poolMesh.setColorAt(n, tmpC.setRGB(0.25 * a.k, 0.55 * a.k, 1.0 * a.k));
      n++;
    }
    this.poolMesh.count = n;
    this.poolMesh.instanceMatrix.needsUpdate = true;
    if (this.poolMesh.instanceColor) this.poolMesh.instanceColor.needsUpdate = true;
    this.arcPools.length = 0;
  }

  private linkRibbons(l: Link): Ribbon[] {
    const a = this.sv.anchor(l.from), b = this.sv.anchor(l.to);
    const dist = a.distanceTo(b);
    const flow = l.flow;
    const cap = Math.max(1, this.game.transfer(l.from, l.kind));
    const f = Math.min(1, flow / cap);
    const selected = l.from.id === this.selectedId || l.to.id === this.selectedId;
    const out: Ribbon[] = [];
    const arc = 0.25 + dist * 0.06;
    if (l.kind === 'energy') {
      // connected links always crackle; flowing links flare up with the transfer rate
      const on = flow > 0.1;
      const live = on ? f : 0;
      let c = this.linkCache.get(l.id);
      const period = on ? 0.045 + Math.random() * 0.045 : 0.09 + Math.random() * 0.1;
      if (!c || this.time - c.t > period) {
        c = { pts: jagged(a, b, on ? 0.1 + f * 0.05 : 0.07, 5, arc), t: this.time };
        this.linkCache.set(l.id, c);
      }
      const flick = 0.7 + Math.random() * 0.6;
      const apex = c.pts[Math.floor(c.pts.length / 2)];
      const night = this.world.nightness;
      this.lights.request({ x: apex.x, y: apex.y, z: apex.z, color: LINK_LIGHT, intensity: (6 + live * 22) * flick * (0.7 + night * 0.55), distance: 5.5 + dist * 0.5, shadow: true });
      this.arcPools.push({ x: apex.x, z: apex.z, len: dist, yaw: Math.atan2(b.x - a.x, b.z - a.z), k: (0.35 + live * 0.65) * flick });
      // main bolt + a hot white core + secondary strands
      out.push({ pts: c.pts, width: 0.08 + live * 0.1, color: COLORS.energy, intensity: (0.55 + live * 0.6 + (selected ? 0.2 : 0)) * flick, life: 0, max: 1, fade: false });
      out.push({ pts: c.pts, width: 0.022 + live * 0.018, color: ARC_CORE, intensity: 0.42 + live * 0.4, life: 0, max: 1, fade: false });
      if (Math.random() < 0.35 + live * 0.5) out.push({ pts: jagged(a, b, 0.16, 4, arc), width: 0.03 + live * 0.03, color: COLORS.energy, intensity: 0.45 + live * 0.35, life: 0, max: 1, fade: false });
      // forks licking off the arc
      if (Math.random() < 0.12 + live * 0.35) {
        const from = c.pts[1 + Math.floor(Math.random() * (c.pts.length - 2))];
        const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, -0.3 - Math.random() * 0.9, (Math.random() - 0.5) * 1.2));
        this.transient.push({ pts: jagged(from, to, 0.35, 3), width: 0.035, color: COLORS.energy, intensity: 0.9, life: 0, max: 0.09, fade: true });
      }
      // travelling energy pulses and the odd falling spark
      if (Math.random() < (on ? 0.25 + f : 0.08)) {
        const p = c.pts[Math.floor(Math.random() * c.pts.length)];
        this.add.emit({ x: p.x, y: p.y, z: p.z, color: 0xaff0ff, size: 0.16 + live * 0.22, life: 0.18 });
      }
      if (Math.random() < 0.04 + live * 0.12) {
        const p = c.pts[Math.floor(Math.random() * c.pts.length)];
        this.add.emit({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 1.5, vy: 0.5, vz: (Math.random() - 0.5) * 1.5, color: 0xcff6ff, size: 0.09, life: 0.7, gravity: 6 });
      }
    } else {
      const on = flow > 0.05;
      const pts = smoothArc(a, b, arc, 18, on ? 0.12 : 0.04, this.time * 3 + l.id);
      const apexM = pts[9];
      const mf = on ? f : 0;
      this.lights.request({ x: apexM.x, y: apexM.y, z: apexM.z, color: MANA_LIGHT, intensity: (2.5 + mf * 12) * (0.85 + Math.sin(this.time * 4 + l.id) * 0.15), distance: 4.5 + dist * 0.35 });
      out.push({ pts, width: 0.05 + mf * 0.09, color: COLORS.mana, intensity: 0.3 + mf * 0.6 + (selected ? 0.15 : 0), life: 0, max: 1, fade: false });
      if (on) {
        const u = (this.time * 0.8 + l.id * 0.37) % 1;
        const p = pts[Math.floor(u * (pts.length - 1))];
        this.add.emit({ x: p.x, y: p.y, z: p.z, color: 0xd07aff, size: 0.35, life: 0.25 });
      }
    }
    if (l.leeched > 0) {
      // show the siphon to the nearest leech
      const mid = a.clone().lerp(b, 0.5);
      let best: THREE.Vector3 | null = null, bd = 3;
      for (const r of this.game.runners) {
        if (!r.alive || !r.type.leech) continue;
        const d = Math.hypot(r.x - mid.x, r.z - mid.z);
        if (d < bd) { bd = d; best = new THREE.Vector3(r.x, 0.6 + this.gh(r.x, r.z), r.z); }
      }
      if (best) out.push({ pts: jagged(mid, best, 0.2, 3), width: 0.12, color: COLORS.leech, intensity: 1.2, life: 0, max: 1, fade: false });
    }
    return out;
  }

  private syncProjectiles(dt: number) {
    const live = new Set<number>();
    for (const p of this.game.projectiles) {
      live.add(p.id);
      let v = this.projViews.get(p.id);
      if (!v) {
        v = this.makeProjectile(p);
        this.projViews.set(p.id, v);
        this.group.add(v);
        // shots leave from the rig's muzzle rather than the tower's centre
        const src = this.game.structById.get(p.sourceId);
        if (src && (p.kind === 'bolt' || p.kind === 'cannonball')) {
          const m = this.sv.muzzle(src);
          this.projOffset.set(p.id, { off: m.sub(new THREE.Vector3(p.x, p.y + this.gy(p.x, p.z), p.z)), age: 0 });
        }
      }
      const prev = v.position.clone();
      const fresh = prev.lengthSq() === 0;
      let py = p.y + this.gy(p.x, p.z);
      let px = p.x, pz = p.z;
      const po = this.projOffset.get(p.id);
      if (po) {
        po.age += dt;
        const k = Math.max(0, 1 - po.age / 0.22);
        px += po.off.x * k; py += po.off.y * k; pz += po.off.z * k;
        if (k <= 0) this.projOffset.delete(p.id);
      }
      v.position.set(px, py, pz);
      if (p.kind === 'bolt' || p.kind === 'cannonball') {
        const d = v.position.clone().sub(prev);
        if (d.lengthSq() > 1e-6) v.lookAt(v.position.clone().add(d));
      }
      const spec = PROJ[p.kind];
      if (spec?.trail && !fresh) {
        // interpolate along the segment travelled this frame so trails stay continuous
        const seg = v.position.distanceTo(prev);
        const n = Math.min(6, Math.max(1, Math.ceil(seg / 0.12)));
        for (let k = 0; k < n; k++) {
          const u = k / n;
          this.add.emit({ x: prev.x + (px - prev.x) * u, y: prev.y + (py - prev.y) * u, z: prev.z + (pz - prev.z) * u,
            vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3 + 0.2, vz: (Math.random() - 0.5) * 0.3,
            color: spec.trail, size: spec.size * 0.26, life: 0.28, grow: -0.6 });
        }
      }
      if (p.kind === 'cannonball' && Math.random() < 0.5) this.norm.emit({ x: px, y: py, z: pz, color: 0x9a948c, size: 0.35, life: 0.6, grow: 1.5, alpha: 0.5 });
      if (spec && p.kind !== 'thorn') {
        const meteor = p.sy > 10;
        tmpC.set(spec.color);
        this.lights.request({ x: px, y: py, z: pz, color: tmpC.clone(), intensity: meteor ? 60 : spec.size * (p.powered ? 9 : 5), distance: meteor ? 12 : 3.5 + spec.size * 2, shadow: meteor });
      }
      if (p.kind === 'fireball' && p.sy > 10) for (let i = 0; i < 3; i++) this.add.emit({ x: p.x, y: py, z: p.z, vx: (Math.random() - 0.5), vy: 1, vz: (Math.random() - 0.5), color: i ? 0xff6a1a : 0xffd04a, size: 1.4, life: 0.5 });
    }
    for (const [id, v] of this.projViews) if (!live.has(id)) { this.group.remove(v); this.projViews.delete(id); this.projOffset.delete(id); }
  }

  private makeProjectile(p: Projectile): THREE.Object3D {
    if (p.kind === 'bolt') {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 5), new THREE.MeshStandardMaterial({ color: 0x7a5a36 }));
      shaft.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5), new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 0.8, roughness: 0.3 }));
      tip.rotation.x = Math.PI / 2; tip.position.z = 0.48;
      g.add(shaft, tip);
      return g;
    }
    if (p.kind === 'cannonball') {
      return new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.6, roughness: 0.4 }));
    }
    const spec = PROJ[p.kind] ?? { color: 0xffffff, size: 0.6 };
    const big = p.sy > 10; // meteor
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(spec.color).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(big ? 3 : spec.size * (p.powered ? 1.3 : 1));
    return s;
  }

  private syncZones(dt: number) {
    const live = new Set<number>();
    for (const z of this.game.zones) {
      live.add(z.id);
      let v = this.zoneViews.get(z.id);
      if (!v) {
        const tex = z.kind === 'consecrate' ? sigilTexture() : z.kind === 'whirlpool' ? swirlTexture() : ringTexture();
        const color = { fire: 0xff5a1a, plague: 0x5aff2a, consecrate: 0xffd86a, whirlpool: 0x3aa8ff, blizzard: 0xbff0ff, thunder: 0x7fb0ff }[z.kind];
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(z.x, this.gh(z.x, z.z) + 0.1, z.z);
        m.scale.setScalar(Math.max(0.01, z.r));
        this.group.add(m);
        v = { obj: m, kind: z.kind };
        this.zoneViews.set(z.id, v);
      }
      const life = 1 - z.t / z.dur;
      const mat = (v.obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(1, life * 3) * 0.8;
      v.obj.rotation.z += dt * (z.kind === 'whirlpool' ? 4 : z.kind === 'consecrate' ? 0.4 : 0);
      const rnd = () => { const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * z.r; return [z.x + Math.cos(a) * rr, z.z + Math.sin(a) * rr]; };
      const zg = this.gh(z.x, z.z);
      const zl: Record<string, [number, number]> = { fire: [0xff6a1a, 22], plague: [0x6aff3a, 7], consecrate: [0xffd86a, 16], whirlpool: [0x3aa8ff, 9], blizzard: [0xcff0ff, 12] };
      if (zl[z.kind]) {
        tmpC.set(zl[z.kind][0]);
        this.lights.request({ x: z.x, y: zg + 1.2, z: z.z, color: tmpC.clone(), intensity: zl[z.kind][1] * Math.min(1, life * 3) * (z.kind === 'fire' ? 0.75 + Math.random() * 0.5 : 1), distance: z.r * 2.5 + 3 });
      }
      if (z.kind === 'fire') this.damage.stamp(z.x, z.z, z.r, { scorch: dt * 0.25, heat: dt * 0.8 });
      if (z.kind === 'blizzard') this.damage.stamp(z.x, z.z, z.r, { frost: dt * 0.6 });
      if (z.kind === 'consecrate') this.damage.stamp(z.x, z.z, z.r, { scorch: dt * 0.03 });
      const rate = dt * 60;
      for (let i = 0; i < rate; i++) {
        const [x, zz] = rnd();
        switch (z.kind) {
          case 'fire': this.add.emit({ x, y: zg + 0.1, z: zz, vy: 1.5 + Math.random() * 2, color: Math.random() < 0.6 ? 0xff5a1a : 0xffb04a, size: 0.6, life: 0.6 }); break;
          case 'plague': if (Math.random() < 0.35) this.norm.emit({ x, y: zg + 0.3 + Math.random() * 0.6, z: zz, vy: 0.2, vx: (Math.random() - 0.5) * 0.3, color: 0x5acc2a, size: 1.6, life: 1.6, grow: 0.8, alpha: 0.45 }); break;
          case 'consecrate': if (Math.random() < 0.5) this.add.emit({ x, y: zg + 0.1, z: zz, vy: 1.4, color: 0xffe08a, size: 0.3, life: 1 }); break;
          case 'whirlpool': {
            const a = Math.atan2(zz - z.z, x - z.x) + Math.PI / 2;
            this.add.emit({ x, y: zg + 0.2, z: zz, vx: Math.cos(a) * 3, vz: Math.sin(a) * 3, vy: 0.3, color: 0x6ac8ff, size: 0.35, life: 0.5 });
            break;
          }
          case 'blizzard': this.add.emit({ x: x - 1, y: zg + 5, z: zz - 0.5, vx: 2, vy: -9, vz: 1, color: 0xdff6ff, size: 0.3, life: 0.6 }); break;
          case 'thunder': if (Math.random() < 0.3) this.norm.emit({ x, y: zg + 7 + Math.random(), z: zz, vx: (Math.random() - 0.5) * 0.3, color: 0x2a2e3a, size: 3.5, life: 1.2, alpha: 0.7, grow: 0.3 }); break;
        }
      }
    }
    for (const [id, v] of this.zoneViews) if (!live.has(id)) { this.group.remove(v.obj); this.zoneViews.delete(id); }
  }

  private syncWhelps(dt: number) {
    const live = new Set<number>();
    for (const w of this.game.whelps) {
      live.add(w.id);
      let v = this.whelpViews.get(w.id);
      if (!v) {
        const { object } = this.assets.instantiate('whelp');
        v = { obj: object, wing: Math.random() * 10 };
        this.whelpViews.set(w.id, v);
        this.group.add(object);
        for (let i = 0; i < 16; i++) this.add.emit({ x: w.x, y: w.y, z: w.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, color: 0xff6a2a, size: 0.4, life: 0.5 });
      }
      v.wing += dt;
      v.obj.position.set(w.x, w.y + this.gy(w.x, w.z) + Math.sin(v.wing * 10) * 0.08, w.z);
      v.obj.rotation.y = w.heading;
      v.obj.rotation.z = Math.sin(v.wing * 3) * 0.15;
      const sq = 1 + Math.sin(v.wing * 14) * 0.08;
      v.obj.scale.set(sq, 1 / sq, 1);
    }
    for (const [id, v] of this.whelpViews) if (!live.has(id)) { this.group.remove(v.obj); this.whelpViews.delete(id); }
  }

  private resetDrop(i: number, anywhere: boolean) {
    const c = this.world?.target ?? new THREE.Vector3(32, 0, 24);
    const x = c.x + (Math.random() - 0.5) * 60, z = c.z + (Math.random() - 0.5) * 50;
    const y = anywhere ? Math.random() * 25 : 22 + Math.random() * 4;
    this.rainPos.set([x, y, z, x + 0.12, y + 0.7, z + 0.05], i * 6);
  }

  private updateRain(dt: number) {
    const w = this.game.env.weather;
    const want = w === 'rain' ? 0.6 : w === 'storm' ? 1 : 0;
    this.rainAmount += (want - this.rainAmount) * Math.min(1, dt * 0.3);
    const n = Math.floor(this.rainN * this.rainAmount);
    this.rain.visible = n > 10;
    if (!this.rain.visible) return;
    const vy = 24 * dt;
    for (let i = 0; i < n; i++) {
      const k = i * 6;
      this.rainPos[k + 1] -= vy; this.rainPos[k + 4] -= vy;
      this.rainPos[k] -= vy * 0.15; this.rainPos[k + 3] -= vy * 0.15;
      if (this.rainPos[k + 1] < 0) {
        if (Math.random() < 0.08) this.add.emit({ x: this.rainPos[k], y: this.gh(this.rainPos[k], this.rainPos[k + 2]) + 0.1, z: this.rainPos[k + 2], vy: 1.2, color: 0x6a86aa, size: 0.15, life: 0.2, gravity: 8 });
        this.resetDrop(i, false);
      }
    }
    const geo = this.rain.geometry;
    geo.setDrawRange(0, n * 2);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.25 + this.rainAmount * 0.2;
  }
}
