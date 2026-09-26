import * as THREE from 'three';
import type { Game } from '../game/sim';
import type { Structure } from '../game/types';
import type { Assets } from './assets';
import { ChunkedInstances } from './instanced';
import type { LightPool } from './lights';
import type { TerrainView } from './terrain';
import { glowTexture } from './textures';
import { rigTemplate, TurretRig, partTemplate, PartRig, PART_RIGS } from './rigs';

interface View {
  rig?: TurretRig;
  part?: PartRig;
  status?: THREE.Sprite;
  statusKey?: string;
  s: Structure;
  group: HTMLGroup;
  model: THREE.Object3D;
  glow: THREE.Sprite;
  glowY: number;
  born: number;
  level: number;
  height: number;
  pulse: number;
}
type HTMLGroup = THREE.Group;

const ROTATES = new Set(['ballista', 'cannon']);

export class StructureViews {
  group = new THREE.Group();
  views = new Map<number, View>();
  /** World sun direction (solar panels track it). */
  sunDir = new THREE.Vector3(0, 1, 0);
  private posts: ChunkedInstances;
  private spans: ChunkedInstances;
  private heightAt: (x: number, z: number) => number;
  private spikes: THREE.InstancedMesh;
  private wallsDirty = true;
  private time = 0;

  constructor(private game: Game, private assets: Assets, private terrain: TerrainView) {
    this.heightAt = (x, z) => terrain.heightAt(x, z);
    this.posts = new ChunkedInstances(assets.get('wall_post').root, 8, 64);
    this.spans = new ChunkedInstances(assets.get('wall_span').root, 8, 200);
    const spikeGeo = new THREE.ConeGeometry(0.07, 0.38, 5);
    spikeGeo.translate(0, 0.19, 0);
    this.spikes = new THREE.InstancedMesh(spikeGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.35 }), 2048 * 8);
    this.spikes.count = 0;
    this.spikes.castShadow = true;
    this.spikes.frustumCulled = false;
    this.group.add(this.posts.group, this.spans.group, this.spikes);
  }

  markWallsDirty() { this.wallsDirty = true; }

  add(s: Structure) {
    if (s.def.id === 'wall') { this.wallsDirty = true; this.views.set(s.id, this.makeWallView(s)); return; }
    const group = new THREE.Group();
    let object: THREE.Object3D;
    let rig: TurretRig | undefined;
    const tpl = this.assets.get(s.def.model);
    const rt = ROTATES.has(s.def.id) ? rigTemplate(s.def.id as 'ballista' | 'cannon', tpl.root, tpl.procedural) : null;
    let part: PartRig | undefined;
    const pt = rt ? null : partTemplate(s.def.id, tpl.root, tpl.procedural);
    if (rt) { rig = new TurretRig(rt, s.aim); object = rig.root; }
    else if (pt) { part = new PartRig(pt, PART_RIGS[s.def.id]); object = part.root; }
    else object = this.assets.instantiate(s.def.model).object;
    group.add(object);
    group.position.set(s.cx, this.terrain.footprintBase(s.x, s.z, s.def.size) + this.baseOffset(s), s.cz);
    if (!ROTATES.has(s.def.id)) object.rotation.y = s.def.id === 'water_wheel' ? this.waterYaw(s) : 0;
    else if (!rig) object.rotation.y = s.aim;
    const height = this.assets.get(s.def.model).height;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: s.def.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    const glowY = height * (s.def.id === 'pyro_trap' ? 0.8 : 0.82);
    glow.position.y = glowY;
    glow.scale.setScalar(s.def.size === 1 ? 1.2 : 1.8);
    group.add(glow);
    this.group.add(group);
    this.views.set(s.id, { s, group, model: object, glow, glowY, born: this.time, level: s.level, height, pulse: 0, rig, part });
    if (s.def.size === 1) this.wallsDirty = true; // pylons/obelisks connect to walls
  }

  private makeWallView(s: Structure): View {
    const g = new THREE.Group();
    return { s, group: g, model: g, glow: new THREE.Sprite(), glowY: 0, born: this.time, level: s.level, height: 1.3, pulse: 0 };
  }

  private baseOffset(s: Structure) {
    // sit models slightly into the ground so bases don't float on uneven terrain
    return -0.04;
  }

  private waterYaw(s: Structure) {
    // face the wheel toward the water
    const g = this.game.grid;
    let wx = 0, wz = 0;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
      const i = (s.z + dz) * 64 + (s.x + dx);
      if (g.terrain[i] === 3) { wx += dx - 0.5; wz += dz - 0.5; }
    }
    return Math.atan2(wx, wz);
  }

  remove(id: number) {
    const v = this.views.get(id);
    if (!v) return;
    if (v.s.def.id === 'wall' || v.s.def.size === 1) this.wallsDirty = true;
    this.group.remove(v.group);
    this.views.delete(id);
  }

  upgraded(id: number) {
    const v = this.views.get(id);
    if (v) v.pulse = 1;
    if (v?.s.def.id === 'wall') this.wallsDirty = true;
  }

  sync() {
    const g = this.game;
    for (const s of g.structures) if (!this.views.has(s.id)) this.add(s);
    for (const id of [...this.views.keys()]) if (!g.structById.has(id)) this.remove(id);
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    for (const v of this.views.values()) {
      const s = v.s;
      if (s.def.id === 'wall') continue;
      // build rise + upgrade pulse
      const age = t - v.born;
      const rise = Math.min(1, age / 0.35);
      const e = Math.max(0.04, 1 - Math.pow(1 - rise, 3));
      v.pulse = Math.max(0, v.pulse - dt * 2.5);
      const lvlScale = 1 + 0.035 * (s.level - 1) + (s.def.id === 'hero_tower' ? 0.04 * (s.heroLevel - 1) : 0);
      const sc = lvlScale * (0.6 + 0.4 * e) * (1 + Math.sin(v.pulse * Math.PI) * 0.12);
      v.model.scale.set(sc, sc * e, sc);
      if (v.rig) {
        const a = s.def.attack!;
        const tgt = this.game.runnerById.get(s.targetId);
        const dist = tgt ? Math.hypot(tgt.x - s.cx, tgt.z - s.cz) : this.game.range(s) * 0.6;
        const cd = (s.poweredGlow > 0.2 ? a.poweredCooldown ?? a.cooldown : a.cooldown) / Math.max(1, this.game.speed);
        v.rig.update(dt, s, this.game.time, this.game.range(s), dist, cd);
      } else if (v.part) {
        v.part.update(dt, s, this.game.time, this.sunDir);
      } else if (ROTATES.has(s.def.id)) {
        // fallback art: rotate the whole model
        let diff = s.aim - v.model.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        v.model.rotation.y += diff * Math.min(1, dt * 8);
      }
      // glow: powered pulse + stored energy
      const cap = this.game.energyCap(s) || this.game.manaCap(s);
      const fill = cap ? (s.energy + s.mana) / cap : 0;
      let op = 0.08 + Math.min(1, fill) * 0.25 + s.poweredGlow * 0.6;
      if (s.def.source) op = 0.1 + Math.min(1, s.producing / 8 + fill * 0.3) * 0.3;   // generators hum, they don't blaze
      if (s.overheated > 0) op = 0.8 + Math.sin(t * 20) * 0.2;
      if (s.disabled > 0) op = Math.random() < 0.3 ? 0.9 : 0.05;
      // the link-point glow is kept soft; overcharged towers get the full blaze
      else if (!s.overcharge && s.overheated <= 0) op *= 0.7;
      const mat = v.glow.material as THREE.SpriteMaterial;
      mat.opacity += (op - mat.opacity) * Math.min(1, dt * 10);
      mat.color.set(s.overheated > 0 ? 0xff5a1a : s.disabled > 0 ? 0x9fe8ff : s.def.color);
      if (s.overcharge && s.overheated <= 0) mat.color.lerp(new THREE.Color(0xff7a3a), Math.min(1, s.heat / 100));
      v.glow.position.y = v.glowY * sc + Math.sin(t * 2 + s.id) * 0.05;
      const gs = (s.def.size === 1 ? 1.1 : 1.7) * (1 + s.poweredGlow * 0.4);
      v.glow.scale.setScalar(gs);
    }
    if (this.wallsDirty) this.rebuildWalls();
    this.statusT -= dt;
    if (this.statusT <= 0) { this.statusT = 0.4; this.updateStatus(); }
    for (const v of this.views.values()) if (v.status) v.status.position.y = v.glowY / 0.82 + 0.95 + Math.sin(t * 3) * 0.06;
  }

  private statusT = 0;
  /** Floating warnings like the original's "No Power" text. */
  private updateStatus() {
    const g = this.game;
    for (const v of this.views.values()) {
      const s = v.s;
      if (s.def.id === 'wall') continue;
      let key = '';
      const L = (s.def.attack?.consumption ?? (s.def.id === 'clock_tower' ? 12 : 0));
      if (s.disabled > 0) key = 'emp';
      else if (s.overheated > 0) key = 'hot';
      else if (L > 0 && s.def.energy && s.inLinks.every((l) => l.kind !== 'energy') && s.energy < 1) key = 'nopower';
      else if (L > 0 && s.def.energy && s.energy < 1 && g.phase === 'wave' && s.flowIn < 0.5) key = 'lowpower';
      else if (s.def.source && !s.links.length && (s.def.energy?.production || s.def.mana?.production)) key = 'notarget';
      if (key === v.statusKey) continue;
      v.statusKey = key;
      if (v.status) { v.group.remove(v.status); v.status = undefined; }
      if (!key) continue;
      const tex = statusTexture(key);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sp.renderOrder = 60;
      sp.scale.set(1.5, 0.375, 1);
      v.status = sp;
      v.group.add(sp);
    }
  }

  private rebuildWalls() {
    this.wallsDirty = false;
    const g = this.game;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    let nk = 0;
    const isWallLike = (x: number, z: number) => {
      const s = g.structureAt(x, z);
      return !!s && (s.def.id === 'wall' || s.def.id === 'pylon' || s.def.id === 'ley_obelisk');
    };
    const walls = g.structures.filter((s) => s.def.id === 'wall');
    const spikeM = new THREE.Matrix4();
    this.posts.begin(); this.spans.begin();
    for (const s of walls) {
      const y = this.heightAt(s.cx, s.cz) - 0.05;
      m4.compose(p.set(s.cx, y, s.cz), q.identity(), sc.set(1, 1, 1));
      this.posts.add(s.cx, s.cz, m4);
      const conn = (dx: number, dz: number) => isWallLike(s.x + dx, s.z + dz);
      const addSpan = (dx: number, dz: number) => {
        const len = Math.hypot(dx, dz);
        const my = Math.min(y, this.heightAt(s.cx + dx, s.cz + dz) - 0.05);
        q.setFromAxisAngle(up, Math.atan2(-dz, dx));
        m4.compose(p.set(s.cx + dx / 2, my, s.cz + dz / 2), q, sc.set(len * 0.84, 1.95, 1.7));
        this.spans.add(s.cx, s.cz, m4);
      };
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        if (!conn(dx, dz)) continue;
        const o = g.structureAt(s.x + dx, s.z + dz)!;
        // each wall-wall span once; wall-relay spans always from the wall side
        if (o.def.id === 'wall' && (dx < 0 || dz < 0)) continue;
        addSpan(dx, dz);
      }
      for (const [dx, dz] of [[1, 1], [1, -1]] as const) {
        if (conn(dx, dz) && !conn(dx, 0) && !conn(0, dz) && g.structureAt(s.x + dx, s.z + dz)?.def.id === 'wall') addSpan(dx, dz);
      }
      if (s.level > 1) {
        const n = s.level === 2 ? 4 : 8;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + 0.4;
          const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2));
          spikeM.compose(p.set(s.cx + Math.sin(a) * 0.32, y + 0.45 + (k % 2) * 0.35, s.cz + Math.cos(a) * 0.32), tilt, sc.set(1, 1, 1));
          this.spikes.setMatrixAt(nk++, spikeM);
        }
      }
    }
    this.posts.end(); this.spans.end();
    this.spikes.count = nk;
    this.spikes.instanceMatrix.needsUpdate = true;
  }

  /** Powered towers and running generators light up their surroundings. */
  requestLights(lights: LightPool, nightness: number) {
    const c = new THREE.Color();
    for (const v of this.views.values()) {
      const s = v.s;
      if (s.def.id === 'wall') continue;
      let k = 0;
      if (s.def.source) k = Math.min(1, s.producing / 10) * 0.6;
      else if (s.def.attack || s.def.id === 'clock_tower') k = s.poweredGlow;
      if (s.overheated > 0) k = 1;
      if (k < 0.08) continue;
      c.set(s.overheated > 0 ? 0xff5a1a : s.def.color);
      const hot = s.overcharge || s.overheated > 0 ? 1 : 0.7;
      lights.request({ x: s.cx, y: v.group.position.y + v.glowY, z: s.cz, color: c.clone(), intensity: (2.5 + k * 7) * (0.6 + nightness * 0.8) * hot, distance: 4.5 });
    }
  }

  /** Where shots leave the tower (the rig's muzzle, or the top of the model). */
  muzzle(s: Structure, out = new THREE.Vector3()) {
    const v = this.views.get(s.id);
    if (v?.rig) { v.group.updateMatrixWorld(true); return v.rig.muzzle(out); }
    return this.anchor(s, out);
  }

  /** Top point for links / effects. */
  anchor(s: Structure, out = new THREE.Vector3()) {
    const v = this.views.get(s.id);
    const h = v ? v.height : 1.5;
    const k = s.def.id === 'wall' ? 1 : s.def.id === 'pyro_trap' ? 0.9 : 0.85;
    const base = v && s.def.id !== 'wall' ? v.group.position.y : this.heightAt(s.cx, s.cz);
    return out.set(s.cx, base + h * k, s.cz);
  }
}

const statusCache = new Map<string, THREE.Texture>();
function statusTexture(key: string) {
  if (statusCache.has(key)) return statusCache.get(key)!;
  const label: Record<string, [string, string]> = {
    nopower: ['⚡ No Power', '#ff5a4a'], lowpower: ['⚡ Low Power', '#ffb04a'], notarget: ['No Target', '#ffb04a'],
    emp: ['EMP', '#8fdcff'], hot: ['Overheated', '#ff7a3a'],
  };
  const [text, color] = label[key];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d')!;
  x.font = 'bold 34px "Alegreya Sans", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 7; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(text, 128, 34);
  x.fillStyle = color; x.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  statusCache.set(key, t);
  return t;
}
