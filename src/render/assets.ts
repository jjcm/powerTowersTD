// Loads the generated asset manifest (Meshy GLBs, diffui textures/icons) and hands out
// normalized model instances. Anything missing falls back to procedural art so the game is
// always playable while assets are still generating.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface Manifest {
  models: Record<string, { url: string; rigged: boolean; kind: string }>;
  textures: Record<string, { color: string; normal?: string; roughness?: string }>;
  icons: Record<string, string>;
  portraits: Record<string, string>;
  ui: Record<string, string>;
}

export interface ModelTemplate {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
  rigged: boolean;
  /** Height after normalization (world units). */
  height: number;
  procedural: boolean;
}

/** Target visual heights (world units, 1 unit = 1 cell) and footprint fit. */
const FIT: Record<string, { height: number; footprint: number; yaw?: number }> = {
  wall_post: { height: 1.35, footprint: 0.78 },
  wall_span: { height: 1.2, footprint: 1.25 },
  pylon: { height: 2.5, footprint: 0.95 },
  ley_obelisk: { height: 2.4, footprint: 0.9 },
  furnace: { height: 2.2, footprint: 1.95 },
  water_wheel: { height: 2.3, footprint: 2.05 },
  solar_panel: { height: 1.9, footprint: 1.95 },
  capacitor: { height: 2.4, footprint: 1.9 },
  mana_well: { height: 1.9, footprint: 1.95 },
  graveyard: { height: 1.8, footprint: 2.0 },
  ballista: { height: 2.3, footprint: 1.9 },
  cannon: { height: 2.2, footprint: 1.9 },
  tesla_coil: { height: 3.7, footprint: 1.8 },
  demon_tower: { height: 3.2, footprint: 1.9 },
  lich_tower: { height: 3.5, footprint: 1.9 },
  chemical_tower: { height: 2.9, footprint: 1.95 },
  pyro_trap: { height: 0.9, footprint: 1.95 },
  dark_tower: { height: 3.5, footprint: 1.85 },
  vine_trap: { height: 2.2, footprint: 1.95 },
  tsunami_tower: { height: 3.1, footprint: 1.9 },
  clock_tower: { height: 3.3, footprint: 1.85 },
  holy_tower: { height: 3.7, footprint: 1.85 },
  swarm_tower: { height: 3.0, footprint: 1.95 },
  hero_tower: { height: 4.4, footprint: 1.95 },
  castle_gate: { height: 6.6, footprint: 8.2 },
  spawn_portal: { height: 4.0, footprint: 4.2 },
  pine_tree: { height: 3.2, footprint: 2.2 },
  fir_tree: { height: 3.8, footprint: 2.0 },
  rock_cluster: { height: 1.0, footprint: 1.8 },
  cliff_rock: { height: 1.7, footprint: 1.25 },
  brazier: { height: 1.3, footprint: 0.6 },
  ley_crystal: { height: 2.4, footprint: 2.2 },
  whelp: { height: 0.9, footprint: 1.4 },
};

export class Assets {
  manifest: Manifest = { models: {}, textures: {}, icons: {}, portraits: {}, ui: {} };
  private loader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();
  private templates = new Map<string, ModelTemplate>();
  private pending = new Map<string, Promise<ModelTemplate>>();
  maxAnisotropy = 8;

  constructor() {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  async init() {
    try {
      const r = await fetch(`assets/manifest.json?v=${Date.now()}`);
      if (r.ok) this.manifest = await r.json();
    } catch { /* offline: procedural everything */ }
  }

  icon(id: string) { return this.manifest.icons[id]; }
  portrait(id: string) { return this.manifest.portraits[id]; }
  ui(id: string) { return this.manifest.ui[id]; }
  hasModel(id: string) { return !!this.manifest.models[id]; }

  texture(url: string, srgb = true, repeat = true): THREE.Texture {
    const t = this.texLoader.load(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.maxAnisotropy;
    return t;
  }

  async loadAll(ids: string[], onProgress?: (done: number, total: number) => void) {
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      await this.load(id);
      onProgress?.(++done, ids.length);
    }));
  }

  load(id: string): Promise<ModelTemplate> {
    if (this.templates.has(id)) return Promise.resolve(this.templates.get(id)!);
    if (this.pending.has(id)) return this.pending.get(id)!;
    const p = (async () => {
      const entry = this.manifest.models[id];
      let tpl: ModelTemplate;
      if (entry) {
        try {
          const gltf: GLTF = await this.loader.loadAsync(entry.url);
          tpl = this.normalize(id, gltf.scene, gltf.animations, entry.rigged);
        } catch (e) {
          console.warn('model load failed', id, e);
          tpl = { root: procedural(id), clips: [], rigged: false, height: 1, procedural: true };
        }
      } else {
        tpl = { root: procedural(id), clips: [], rigged: false, height: FIT[id]?.height ?? 1, procedural: true };
      }
      this.templates.set(id, tpl);
      return tpl;
    })();
    this.pending.set(id, p);
    return p;
  }

  get(id: string): ModelTemplate {
    return this.templates.get(id) ?? { root: procedural(id), clips: [], rigged: false, height: FIT[id]?.height ?? 1, procedural: true };
  }

  /** Clone a model ready to add to the scene. */
  instantiate(id: string): { object: THREE.Object3D; clips: THREE.AnimationClip[]; rigged: boolean } {
    const tpl = this.get(id);
    const object = tpl.rigged ? SkeletonUtils.clone(tpl.root) : tpl.root.clone(true);
    return { object, clips: tpl.clips, rigged: tpl.rigged };
  }

  private normalize(id: string, scene: THREE.Object3D, clips: THREE.AnimationClip[], rigged: boolean): ModelTemplate {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene, true);
    const size = box.getSize(new THREE.Vector3());
    const fit = FIT[id];
    let scale = 1;
    if (fit) {
      const byH = fit.height / Math.max(size.y, 1e-3);
      const byF = fit.footprint / Math.max(size.x, size.z, 1e-3);
      scale = Math.min(byH, byF);
    } else if (rigged || id) {
      scale = 1 / Math.max(size.y, 1e-3); // runners: unit height; scaled per type later
    }
    const center = box.getCenter(new THREE.Vector3());
    const wrapper = new THREE.Group();
    wrapper.name = id;
    scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    scene.scale.setScalar(scale);
    if (fit?.yaw) wrapper.rotation.y = fit.yaw;
    wrapper.add(scene);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const sm = mat as THREE.MeshStandardMaterial;
          if (sm.map) sm.map.anisotropy = this.maxAnisotropy;
          // Meshy PBR tends to read a little flat/dark under stylized lighting.
          if (sm.isMeshStandardMaterial) {
            sm.envMapIntensity = 0.7;
            // Meshy's rigging export sets a white emissive with the albedo as emissive map and
            // full metalness without a metalness map, which bleaches characters. Undo that.
            if (sm.emissiveMap && (sm.emissiveMap === sm.map || sm.emissive.getHex() === 0xffffff)) {
              sm.emissiveMap = null;
              sm.emissive.setHex(0x000000);
            }
            if (!sm.metalnessMap) sm.metalness = 0;
            if (!sm.roughnessMap) sm.roughness = 0.78;
            sm.needsUpdate = true;
          }
        }
        if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
      }
    });
    return { root: wrapper, clips, rigged, height: size.y * scale, procedural: false };
  }
}

// ------------------------------------------------------------------ procedural fallbacks
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, emissive = 0, rough = 0.7, metal = 0.1) {
  const k = `${color}-${emissive}-${rough}-${metal}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emissive ? 1.5 : 0, roughness: rough, metalness: metal }));
  return matCache.get(k)!;
}

const STONE = 0x5a6784, GOLD = 0xd4a640;
const TINT: Record<string, number> = {
  pylon: 0x49a6ff, furnace: 0xff8a3c, water_wheel: 0x3fb3ff, solar_panel: 0xffd34d, capacitor: 0x5fd0ff, mana_well: 0xb05cff,
  ley_obelisk: 0xc77dff, graveyard: 0x66ff99, ballista: 0xc9a46a, cannon: 0x6d6d6d, tesla_coil: 0x57c7ff, demon_tower: 0xff5a2a,
  lich_tower: 0x9fe6ff, chemical_tower: 0x7dff4a, pyro_trap: 0xff7a1a, dark_tower: 0xa05cff, vine_trap: 0x4bd24b,
  tsunami_tower: 0x2fa8ff, clock_tower: 0xffe08a, holy_tower: 0xfff1a8, swarm_tower: 0xff4d4d, hero_tower: 0x6fa8ff,
};

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return o;
}

export function procedural(id: string): THREE.Object3D {
  const g = new THREE.Group();
  g.name = id;
  const fit = FIT[id];
  const tint = TINT[id] ?? 0x888888;
  if (id === 'wall_post') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.2, 0.62), mat(STONE));
    m.position.y = 0.6; g.add(m);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 4), mat(GOLD, 0, 0.35, 0.8));
    cap.position.y = 1.35; cap.rotation.y = Math.PI / 4; g.add(cap);
  } else if (id === 'wall_span') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.5), mat(STONE));
    m.position.y = 0.5; g.add(m);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.56), mat(GOLD, 0, 0.35, 0.8));
    top.position.y = 1.03; g.add(top);
  } else if (id.includes('tree')) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.6, 6), mat(0x5a3b22));
    trunk.position.y = 0.3; g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.9 - i * 0.22, 1.1, 7), mat(id === 'fir_tree' ? 0x2f5f45 : 0x2c6b2f));
      c.position.y = 0.9 + i * 0.7; g.add(c);
    }
  } else if (id === 'rock_cluster' || id === 'cliff_rock') {
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + i * 0.1), mat(0x6c7384));
      r.position.set((i - 1) * 0.35, 0.3, (i % 2) * 0.2); g.add(r);
    }
  } else if (id === 'ley_crystal') {
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), mat(0xb05cff, 0x9b3cff, 0.2, 0.1));
      c.scale.set(0.6, 2 + (i % 3) * 0.6, 0.6);
      c.position.set(Math.cos(i * 1.3) * 0.5, 0.7, Math.sin(i * 1.3) * 0.5);
      c.rotation.z = Math.cos(i) * 0.3;
      g.add(c);
    }
  } else if (id === 'castle_gate') {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.5, 6.5), mat(STONE)); wall.position.set(0.5, 1.75, 0); g.add(wall);
    for (const z of [-2.8, 2.8]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 5, 10), mat(STONE)); t.position.set(0, 2.5, z); g.add(t);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.6, 10), mat(0x2d4fa8)); roof.position.set(0, 5.8, z); g.add(roof);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 1.8), mat(0x5a3b22)); door.position.set(-0.8, 1.1, 0); g.add(door);
  } else if (id === 'spawn_portal') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.35, 10, 24), mat(0x2a2230));
    ring.position.y = 1.9; g.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), mat(0x551111, 0xff3311));
    disc.position.y = 1.9; g.add(disc);
  } else if (id === 'brazier') {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 1.0, 8), mat(STONE)); p.position.y = 0.5; g.add(p);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.15, 0.25, 10), mat(GOLD, 0, 0.35, 0.8)); b.position.y = 1.1; g.add(b);
  } else if (['orc_grunt', 'goblin_scout', 'ogre_brute', 'goblin_sapper', 'skeleton_warrior', 'troll_berserker', 'orc_warlord', 'wraith', 'power_leech', 'whelp'].includes(id)) {
    const col: Record<string, number> = { orc_grunt: 0x6aa84f, goblin_scout: 0x9bc53d, ogre_brute: 0x8a6a4a, goblin_sapper: 0x7fb069, skeleton_warrior: 0xe8e2cf, troll_berserker: 0x4f86c6, orc_warlord: 0x3a5f2a, wraith: 0x8e6bd6, power_leech: 0x2b4f7a, whelp: 0xd83a2a };
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.45, 4, 8), mat(col[id] ?? 0x888888));
    body.position.y = 0.55; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat(col[id] ?? 0x888888));
    head.position.y = 1.05; g.add(head);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.05), mat(0x111111, id === 'wraith' ? 0xb05cff : 0));
    eye.position.set(0, 1.08, 0.17); g.add(eye);
    g.scale.setScalar(1 / 1.25);
  } else {
    // generic tower: stone base, colored core
    const size = id === 'pylon' || id === 'ley_obelisk' ? 0.8 : 1.7;
    const h = fit?.height ?? 2.5;
    const base = new THREE.Mesh(new THREE.BoxGeometry(size, 0.35, size), mat(STONE));
    base.position.y = 0.175; g.add(base);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(size + 0.06, 0.08, size + 0.06), mat(GOLD, 0, 0.35, 0.8));
    trim.position.y = 0.38; g.add(trim);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.28, size * 0.38, h * 0.6, 8), mat(STONE));
    body.position.y = 0.35 + h * 0.3; g.add(body);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.25), mat(tint, tint, 0.3, 0.2));
    core.position.y = h * 0.8; g.add(core);
  }
  return shadowed(g);
}
