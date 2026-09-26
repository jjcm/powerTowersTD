import * as THREE from 'three';
import { Grid, Terrain as T, W, H, idx, inBounds } from '../game/grid';
import type { MapInfo } from '../game/map';
import type { Assets } from './assets';
import { ChunkedInstances } from './instanced';
import type { LightPool } from './lights';
import { BORDER, fbm, type TerrainView } from './terrain';

function rand(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export class Props {
  group = new THREE.Group();
  checkpointMarkers: THREE.Object3D[] = [];
  crystals: THREE.Object3D[] = [];
  portal!: THREE.Object3D;
  castle!: THREE.Object3D;
  flames: THREE.Vector3[] = [];
  /** Tree positions (fireflies gather along the tree line). */
  treeSpots: { x: number; z: number; sc: number }[] = [];   // positions that emit fire particles (braziers, castle torches)
  portalCenter = new THREE.Vector3();
  gatePos = new THREE.Vector3();
  private runeMats: THREE.MeshBasicMaterial[] = [];
  /** Light sources handed to the dynamic light pool every frame. */
  lightSources: { pos: THREE.Vector3; color: THREE.Color; intensity: number; distance: number; flicker: number }[] = [];

  constructor(grid: Grid, map: MapInfo, terrain: TerrainView, assets: Assets) {
    const r = rand(4242);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    // ---------------- trees: dense forest outside the map + clumps inside
    const treeSpots = this.treeSpots;
    for (let z = -BORDER + 1; z < H + BORDER - 1; z += 1.25) for (let x = -BORDER + 1; x < W + BORDER - 1; x += 1.25) {
      const jx = x + (r() - 0.5) * 1.1, jz = z + (r() - 0.5) * 1.1;
      const cx = Math.floor(jx), cz = Math.floor(jz);
      if (inBounds(cx, cz)) {
        if (grid.terrain[idx(cx, cz)] !== T.Tree) continue;
      } else {
        const dx = Math.max(-jx, jx - W, 0), dz = Math.max(-jz, jz - H, 0);
        const d = Math.hypot(dx, dz);
        if (terrain.terrainAt(cx, cz) === T.Water) continue;
        const dens = THREE.MathUtils.smoothstep(d, 0.3, 3) * (0.55 + fbm(jx * 0.15, jz * 0.15) * 0.9);
        if (r() > dens || d > BORDER - 2) continue;
        // keep a view corridor open near the camera side (south)
        if (jz > H + 1.5 && d < 5 && r() < 0.6) continue;
      }
      treeSpots.push({ x: jx, z: jz, sc: 0.75 + r() * 0.55 });
    }
    const pine = new ChunkedInstances(assets.get('pine_tree').root, 12, 200, { wind: true });
    const fir = new ChunkedInstances(assets.get('fir_tree').root, 12, 200, { wind: true });
    pine.begin(); fir.begin();
    const tint = new THREE.Color();
    for (const t of treeSpots) {
      const y = terrain.heightAt(t.x, t.z);
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      s.setScalar(t.sc);
      p.set(t.x, y - 0.05, t.z);
      m4.compose(p, q, s);
      tint.setHSL(0.28 + (r() - 0.5) * 0.06, 0.35 + r() * 0.2, 0.42 + r() * 0.16);
      const c = new THREE.Color(1, 1, 1).lerp(tint, 0.35);
      (r() < 0.6 ? pine : fir).add(t.x, t.z, m4, c);
    }
    pine.end(); fir.end();
    this.group.add(pine.group, fir.group);

    // ---------------- rocks
    const rockCells: number[] = [];
    for (let i = 0; i < W * H; i++) if (grid.terrain[i] === T.Rock) rockCells.push(i);
    const extraRocks: { x: number; z: number }[] = [];
    for (let k = 0; k < 70; k++) {
      const x = -BORDER + r() * (W + BORDER * 2), z = -BORDER + r() * (H + BORDER * 2);
      if (inBounds(Math.floor(x), Math.floor(z))) continue;
      if (terrain.terrainAt(Math.floor(x), Math.floor(z)) === T.Water) continue;
      extraRocks.push({ x, z });
    }
    const rocks = new ChunkedInstances(assets.get('rock_cluster').root, 12, 64);
    rocks.begin();
    for (const i of rockCells) {
      const x = (i % W) + 0.5, z = Math.floor(i / W) + 0.5;
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      s.setScalar(0.85 + r() * 0.35);
      m4.compose(p.set(x, terrain.heightAt(x, z) - 0.05, z), q, s);
      rocks.add(x, z, m4);
    }
    for (const e of extraRocks) {
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      s.setScalar(0.8 + r() * 1.4);
      m4.compose(p.set(e.x, terrain.heightAt(e.x, e.z) - 0.1, e.z), q, s);
      rocks.add(e.x, e.z, m4);
    }
    rocks.end();
    this.group.add(rocks.group);

    // ---------------- plateau cliffs
    const edges: { x: number; z: number; yaw: number }[] = [];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (grid.terrain[idx(x, z)] !== T.Plateau) continue;
      const n = (dx: number, dz: number) => inBounds(x + dx, z + dz) && grid.terrain[idx(x + dx, z + dz)] === T.Plateau;
      if (!n(0, 1)) edges.push({ x: x + 0.5, z: z + 1.02, yaw: 0 });
      if (!n(0, -1)) edges.push({ x: x + 0.5, z: z - 0.02, yaw: Math.PI });
      if (!n(1, 0)) edges.push({ x: x + 1.02, z: z + 0.5, yaw: Math.PI / 2 });
      if (!n(-1, 0)) edges.push({ x: x - 0.02, z: z + 0.5, yaw: -Math.PI / 2 });
    }
    const cliffTpl = assets.get('cliff_rock').root;
    const cb = new THREE.Box3().setFromObject(cliffTpl).getSize(new THREE.Vector3());
    const long = Math.max(cb.x, cb.z), thin = Math.min(cb.x, cb.z);
    const alongX = cb.x >= cb.z;
    const cliffs = new ChunkedInstances(cliffTpl, 12, 128);
    cliffs.begin();
    const talus = new ChunkedInstances(assets.get('rock_cluster').root, 12, 128);
    talus.begin();
    edges.forEach((e, ei) => {
      q.setFromAxisAngle(up, e.yaw + (alongX ? 0 : Math.PI / 2) + (r() - 0.5) * 0.4);
      // plateau tops vary ±25%: size each rock face to the local drop
      const ox = Math.sin(e.yaw), oz = Math.cos(e.yaw);
      const top = terrain.heightAt(e.x - ox * 0.3, e.z - oz * 0.3);
      const bottom = terrain.heightAt(e.x + ox * 0.9, e.z + oz * 0.9);
      const drop = Math.max(0.6, top - bottom + 0.35);
      const sx = (1.15 + r() * 0.35) / long, sy = (drop / cb.y) * (0.95 + r() * 0.25), sz = (0.7 + r() * 0.35) / thin;
      s.set(alongX ? sx : sz, sy, alongX ? sz : sx);
      // push the rock face outward (jittered) so it hides the slope and the edge isn't ruler-straight
      const push = 0.14 + r() * 0.24, slide = (r() - 0.5) * 0.3;
      m4.compose(p.set(e.x + ox * push + oz * slide, bottom - 0.2, e.z + oz * push - ox * slide), q, s);
      cliffs.add(e.x, e.z, m4);
      // fallen boulders at the foot of the cliff
      if (r() < 0.55) {
        const d = 0.55 + r() * 0.5, side = (r() - 0.5) * 0.9;
        const bx = e.x + ox * d + oz * side, bz = e.z + oz * d - ox * side;
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        s.setScalar(0.35 + r() * 0.35);
        m4.compose(p.set(bx, terrain.heightAt(bx, bz) - 0.08, bz), q, s);
        talus.add(bx, bz, m4);
      }
      // round off convex corners with a bigger boulder
      const cxn = Math.floor(e.x - ox * 0.5), czn = Math.floor(e.z - oz * 0.5);
      const isP = (dx: number, dz: number) => inBounds(cxn + dx, czn + dz) && grid.terrain[idx(cxn + dx, czn + dz)] === T.Plateau;
      const side1 = isP(Math.round(oz), Math.round(-ox)), side2 = isP(Math.round(-oz), Math.round(ox));
      if ((!side1 || !side2) && ei % 2 === 0) {
        const sgn = !side1 ? 1 : -1;
        const bx = e.x + oz * 0.5 * sgn + ox * 0.35, bz = e.z - ox * 0.5 * sgn + oz * 0.35;
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        s.set(0.7 + r() * 0.3, 0.9 + r() * 0.5, 0.7 + r() * 0.3);
        m4.compose(p.set(bx, terrain.heightAt(bx, bz) - 0.15, bz), q, s);
        talus.add(bx, bz, m4);
      }
    });
    cliffs.end();
    talus.end();
    this.group.add(talus.group);
    this.group.add(cliffs.group);

    // ---------------- ley crystals
    for (const c of map.leyCrystals) {
      const { object } = assets.instantiate('ley_crystal');
      object.position.set(c.x, terrain.heightAt(c.x, c.z) - 0.1, c.z);
      object.rotation.y = r() * Math.PI * 2;
      this.lightSources.push({ pos: object.position.clone().add(new THREE.Vector3(0, 1.6, 0)), color: new THREE.Color(0xb45cff), intensity: 9, distance: 8, flicker: 0.15 });
      this.crystals.push(object);
      this.group.add(object);
    }

    // ---------------- spawn portal
    {
      const { object } = assets.instantiate('spawn_portal');
      object.position.set(map.spawn.x - 1.6, terrain.heightAt(map.spawn.x - 1.6, map.spawn.z - 1.4) - 0.05, map.spawn.z - 1.4);
      object.rotation.y = Math.PI * 0.2;
      this.portal = object;
      this.portalCenter.set(map.spawn.x, 1.8, map.spawn.z);
      this.lightSources.push({ pos: new THREE.Vector3(map.spawn.x - 0.8, object.position.y + 2, map.spawn.z - 0.6), color: new THREE.Color(0xff3a1a), intensity: 22, distance: 11, flicker: 0.25 });
      this.group.add(object);
    }

    // ---------------- castle
    {
      const c = map.castle;
      const { object } = assets.instantiate('castle_gate');
      object.position.set(c.x + c.w / 2 + 0.6, terrain.footprintBase(c.x, c.z, c.w) - 0.05, c.z + c.h / 2);
      object.rotation.y = -Math.PI / 2; // gate faces west, toward the runners
      this.castle = object;
      this.gatePos.set(c.gateX + 0.5, 0, c.gateZ + 1);
      this.group.add(object);
      for (const dz of [-2.2, 2.2]) {
        const bx = c.gateX - 1.2, bz = c.gateZ + 1 + dz;
        this.addBrazier(assets, bx, bz, terrain);
      }
    }

    // ---------------- checkpoints: glowing rune circles with braziers
    const runeUrl = assets.ui('checkpoint_rune');
    const runeTex = runeUrl ? assets.texture(runeUrl, true, false) : null;
    map.checkpoints.forEach((cp, i) => {
      const mat = new THREE.MeshBasicMaterial({
        map: runeTex, color: runeTex ? 0xffffff : 0x3aa0ff, transparent: true, depthWrite: false, opacity: 0.95,
        blending: THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.35, 40), mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(cp.x + 1, terrain.heightAt(cp.x + 1, cp.z + 1) + 0.03, cp.z + 1);
      disc.renderOrder = 1;
      this.runeMats.push(mat);
      this.group.add(disc);
      this.lightSources.push({ pos: new THREE.Vector3(cp.x + 1, disc.position.y + 1.1, cp.z + 1), color: new THREE.Color(0x4aa8ff), intensity: 6, distance: 5.5, flicker: 0.1 });
      const label = numberSprite(String(i + 1));
      label.position.set(cp.x + 1, disc.position.y + 2.2, cp.z + 1);
      this.checkpointMarkers.push(label);
      this.group.add(label);
      this.addBrazier(assets, cp.x - 0.9, cp.z - 0.9, terrain);
      this.addBrazier(assets, cp.x + 2.9, cp.z + 2.9, terrain);
    });
  }

  private addBrazier(assets: Assets, x: number, z: number, terrain: TerrainView) {
    const { object } = assets.instantiate('brazier');
    const y = terrain.heightAt(x, z);
    object.position.set(x, y, z);
    this.group.add(object);
    const tpl = assets.get('brazier');
    const top = new THREE.Vector3(x, y + tpl.height * 0.98, z);
    this.flames.push(top);
    this.lightSources.push({ pos: top.clone().add(new THREE.Vector3(0, 0.35, 0)), color: new THREE.Color(0xff8a2a), intensity: 7, distance: 6.5, flicker: 0.35 });
  }

  private baseY: number[] = [];
  update(t: number, lights: LightPool, nightness: number) {
    this.checkpointMarkers.forEach((m, i) => { this.baseY[i] ??= m.position.y; m.position.y = this.baseY[i] + Math.sin(t * 2 + i) * 0.12; });
    for (const mat of this.runeMats) mat.color.setScalar(0.85 + Math.sin(t * 2.2) * 0.15);
    // fires read much stronger at night
    const boost = 0.55 + nightness * 0.9;
    this.lightSources.forEach((l, i) => {
      const f = 1 + (Math.sin(t * 9.1 + i * 3.1) * 0.5 + Math.sin(t * 13.7 + i) * 0.5) * l.flicker;
      lights.request({ x: l.pos.x, y: l.pos.y, z: l.pos.z, color: l.color, intensity: l.intensity * f * boost, distance: l.distance });
    });
  }
}

function numberSprite(text: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 60);
  grd.addColorStop(0, 'rgba(40,120,255,0.55)'); grd.addColorStop(1, 'rgba(40,120,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.font = 'bold 76px Cinzel, Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#0a1a33'; g.strokeText(text, 64, 70);
  g.fillStyle = '#ffe28a'; g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set(1.1, 1.1, 1);
  return sp;
}
