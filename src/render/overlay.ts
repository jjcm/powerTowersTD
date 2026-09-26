import * as THREE from 'three';
import type { Game } from '../game/sim';
import type { Structure } from '../game/types';
import { STRUCTURES, type StructureId } from '../game/data/structures';
import type { Assets } from './assets';
import { dashTexture, ringTexture } from './textures';

const GOOD = new THREE.Color(0x5aff7a), BAD = new THREE.Color(0xff4a3a);

export class Overlay {
  group = new THREE.Group();
  private ghostPool: { obj: THREE.Object3D; id: string; mats: THREE.MeshBasicMaterial[] }[] = [];
  private cells: THREE.InstancedMesh;
  private rangeRing: THREE.Mesh;
  private linkRing: THREE.Mesh;
  private selRing: THREE.Mesh;
  private hoverRing: THREE.Mesh;
  private path: THREE.Mesh;
  private pathMat: THREE.MeshBasicMaterial;
  private pathShade: THREE.Mesh;
  private pathKey = '';
  private linkLine: THREE.Mesh;
  private targetRings: THREE.Mesh[] = [];
  private time = 0;

  constructor(private game: Game, private assets: Assets, private heightAt: (x: number, z: number) => number) {
    const cellGeo = new THREE.PlaneGeometry(0.94, 0.94);
    cellGeo.rotateX(-Math.PI / 2);
    this.cells = new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }), 512);
    this.cells.count = 0;
    this.cells.renderOrder = 3;
    this.cells.frustumCulled = false;
    this.rangeRing = this.ring(0xffffff, 0.5);
    this.linkRing = this.ring(0x6ac8ff, 0.45);
    this.selRing = this.ring(0xffd24a, 0.9);
    this.hoverRing = this.ring(0xffffff, 0.35);
    // The route is a UI overlay: drawn over grass and buildings (no depth test) with a dark
    // underlay so it reads on bright meadow as well as on dirt.
    this.pathMat = new THREE.MeshBasicMaterial({ map: dashTexture(), color: 0xd9cda2, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.path = new THREE.Mesh(new THREE.BufferGeometry(), this.pathMat);
    this.path.renderOrder = 38;           // above effects, under the cloud deck and health bars
    this.path.frustumCulled = false;
    this.pathShade = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    this.pathShade.renderOrder = 37;
    this.pathShade.frustumCulled = false;
    this.path.add(this.pathShade);
    const linkDash = dashTexture().clone(); linkDash.needsUpdate = true;
    this.linkLine = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: linkDash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.linkLine.frustumCulled = false;
    this.group.add(this.cells, this.rangeRing, this.linkRing, this.selRing, this.hoverRing, this.path, this.linkLine);
  }

  private ring(color: number, opacity: number) {
    // drawn on top: on rolling ground a flat ring would dip under the terrain in places
    const m = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.renderOrder = 4;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 0.08, depthWrite: false }));
    m.add(fill);
    return m;
  }

  private showRing(m: THREE.Mesh, x: number, z: number, y: number, r: number) {
    m.visible = r > 0;
    m.position.set(x, y + 0.08, z);
    m.scale.setScalar(r);
  }

  clear() {
    for (const g of this.ghostPool) g.obj.visible = false;
    this.cells.count = 0;
    this.rangeRing.visible = false;
    this.linkRing.visible = false;
    this.hoverRing.visible = false;
    this.linkLine.visible = false;
    for (const r of this.targetRings) r.visible = false;
  }

  private ghost(i: number, id: StructureId) {
    let g = this.ghostPool[i];
    if (!g || g.id !== id) {
      if (g) this.group.remove(g.obj);
      const { object } = this.assets.instantiate(STRUCTURES[id].model);
      const mats: THREE.MeshBasicMaterial[] = [];
      object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        const mat = new THREE.MeshBasicMaterial({ map: src.map ?? null, transparent: true, opacity: 0.55, depthWrite: false, color: GOOD });
        m.material = mat; mats.push(mat);
        m.castShadow = false;
      });
      g = { obj: object, id, mats };
      this.ghostPool[i] = g;
      this.group.add(object);
    }
    return g;
  }

  /** Placement preview for one or many cells. */
  showPlacement(id: StructureId, spots: { x: number; z: number; ok: boolean }[], range: number) {
    const def = STRUCTURES[id];
    const m4 = new THREE.Matrix4();
    let nc = 0;
    spots.forEach((s, i) => {
      const g = this.ghost(i, id);
      g.obj.visible = true;
      const cx = s.x + def.size / 2, cz = s.z + def.size / 2;
      const y = this.heightAt(cx, cz);
      g.obj.position.set(cx, y, cz);
      for (const m of g.mats) { m.color.copy(s.ok ? GOOD : BAD); m.opacity = 0.5 + Math.sin(this.time * 6) * 0.08; }
      for (let dz = 0; dz < def.size; dz++) for (let dx = 0; dx < def.size; dx++) {
        if (nc >= 512) break;
        m4.makeTranslation(s.x + dx + 0.5, this.heightAt(s.x + dx + 0.5, s.z + dz + 0.5) + 0.06, s.z + dz + 0.5);
        this.cells.setMatrixAt(nc, m4);
        this.cells.setColorAt(nc, s.ok ? GOOD : BAD);
        nc++;
      }
    });
    for (let i = spots.length; i < this.ghostPool.length; i++) if (this.ghostPool[i]) this.ghostPool[i].obj.visible = false;
    this.cells.count = nc;
    this.cells.instanceMatrix.needsUpdate = true;
    if (this.cells.instanceColor) this.cells.instanceColor.needsUpdate = true;
    const last = spots[spots.length - 1];
    if (last && range > 0) {
      const cx = last.x + def.size / 2, cz = last.z + def.size / 2;
      this.showRing(this.rangeRing, cx, cz, this.heightAt(cx, cz), range);
    } else this.rangeRing.visible = false;
    if (last && def.source && def.linkRange) {
      const cx = last.x + def.size / 2, cz = last.z + def.size / 2;
      this.showRing(this.linkRing, cx, cz, this.heightAt(cx, cz), def.linkRange);
    } else this.linkRing.visible = false;
  }

  showSelection(s: Structure | null) {
    if (!s) { this.selRing.visible = false; this.rangeRing.visible = false; return; }
    this.showRing(this.selRing, s.cx, s.cz, this.heightAt(s.cx, s.cz), s.def.size * 0.72);
    const r = this.game.range(s);
    if (r > 0) this.showRing(this.rangeRing, s.cx, s.cz, this.heightAt(s.cx, s.cz), r);
    if (s.def.source) this.showRing(this.linkRing, s.cx, s.cz, this.heightAt(s.cx, s.cz), this.game.linkRange(s));
  }

  private runnerRing: THREE.Mesh | null = null;
  showRunnerSelection(x: number, y: number, z: number, scale: number) {
    if (!this.runnerRing) { this.runnerRing = this.ring(0xff5a4a, 0.9); this.group.add(this.runnerRing); }
    if (scale <= 0) { this.runnerRing.visible = false; return; }
    this.showRing(this.runnerRing, x, z, y - 0.06, 0.35 + scale * 0.3);
  }

  showHover(s: Structure | null) {
    if (!s) { this.hoverRing.visible = false; return; }
    this.showRing(this.hoverRing, s.cx, s.cz, this.heightAt(s.cx, s.cz), s.def.size * 0.72);
  }

  /** Link targeting: highlight valid targets and draw a line to the hovered one. */
  showLinkTargets(from: Structure, hover: Structure | null, mode: 'connect' | 'disconnect', a: THREE.Vector3, b: THREE.Vector3 | null) {
    const g = this.game;
    const candidates = mode === 'connect'
      ? g.structures.filter((o) => g.canLink(from, o).ok || g.canLink(o, from).ok)
      : [...from.links.map((l) => l.to), ...from.inLinks.map((l) => l.from)];
    candidates.forEach((o, i) => {
      let r = this.targetRings[i];
      if (!r) { r = this.ring(0x6ac8ff, 0.8); this.targetRings[i] = r; this.group.add(r); }
      (r.material as THREE.MeshBasicMaterial).color.set(mode === 'connect' ? (from.def.source === 'mana' ? 0xd07aff : 0x6ac8ff) : 0xff6a4a);
      this.showRing(r, o.cx, o.cz, this.heightAt(o.cx, o.cz), o.def.size * 0.6 + Math.sin(this.time * 5) * 0.05);
    });
    for (let i = candidates.length; i < this.targetRings.length; i++) this.targetRings[i].visible = false;
    this.showRing(this.linkRing, from.cx, from.cz, this.heightAt(from.cx, from.cz), g.linkRange(from));
    if (b) {
      const ok = hover ? (mode === 'connect' ? g.canLink(from, hover).ok || g.canLink(hover, from).ok : from.links.some((l) => l.to === hover) || from.inLinks.some((l) => l.from === hover)) : false;
      this.ribbon(this.linkLine, [a, b], 0.18);
      const mat = this.linkLine.material as THREE.MeshBasicMaterial;
      mat.color.copy(ok ? (mode === 'connect' ? new THREE.Color(0x8fdcff) : new THREE.Color(0xff6a4a)) : BAD);
      mat.opacity = 0.9;
      this.linkLine.visible = true;
    } else this.linkLine.visible = false;
  }

  /** Dashed route runners will take. Recomputed when the grid changes (or with a ghost). */
  updatePath(extraBlocked?: number[]) {
    const g = this.game;
    const key = `${g.grid.version}|${extraBlocked?.join(',') ?? ''}`;
    if (key === this.pathKey) return;
    this.pathKey = key;
    let pts: { x: number; z: number }[];
    if (extraBlocked?.length) {
      const fields = g.grid.computeFields(extraBlocked);
      pts = g.grid.legsConnected(fields) ? g.grid.routeFrom(fields, g.grid.spawnCell, 0, new Set(extraBlocked)) : [];
      g.grid.recomputeBlocked();
    } else pts = g.grid.routeFrom(g.grid.fields);
    const smooth = chaikin(pts, 2);
    const v3 = smooth.map((p) => new THREE.Vector3(p.x, this.heightAt(p.x, p.z) + 0.1, p.z));
    this.flatRibbon(this.path, v3, 0.3);
    this.flatRibbon(this.pathShade, v3, 0.5);
  }

  setPathVisible(v: boolean, preview = false) {
    this.path.visible = v;
    // kept below the bloom threshold so the route never glows at night
    this.pathMat.color.set(preview ? 0x86d894 : 0xd9cda2);
    this.pathMat.opacity = preview ? 0.95 : 0.85;
  }

  update(dt: number) {
    this.time += dt;
    const map = this.pathMat.map!;
    map.offset.x -= dt * 1.2;
    const ll = (this.linkLine.material as THREE.MeshBasicMaterial).map!;
    ll.offset.x -= dt * 2;
  }

  private flatRibbon(mesh: THREE.Mesh, pts: THREE.Vector3[], width: number) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * width / 2, nz = dx / l * width / 2;
      if (i > 0) acc += p.distanceTo(pts[i - 1]);
      pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz);
      uv.push(acc * 1.2, 0, acc * 1.2, 1);
      if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }

  private ribbon(mesh: THREE.Mesh, ends: THREE.Vector3[], width: number) {
    const [a, b] = ends;
    const pts: THREE.Vector3[] = [];
    const arc = 0.3 + a.distanceTo(b) * 0.06;
    for (let i = 0; i <= 20; i++) { const t = i / 20; const p = a.clone().lerp(b, t); p.y += arc * 4 * t * (1 - t); pts.push(p); }
    // camera-agnostic: build a vertical-ish ribbon (good enough from the RTS angle)
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i) acc += p.distanceTo(pts[i - 1]);
      const d = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
      const side = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(width / 2);
      pos.push(p.x + side.x, p.y + width / 2, p.z + side.z, p.x - side.x, p.y - width / 2, p.z - side.z);
      uv.push(acc * 2, 0, acc * 2, 1);
      if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }
}

function chaikin(pts: { x: number; z: number }[], iters: number) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    if (p.length < 3) return p;
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

export { ringTexture };
