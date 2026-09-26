import * as THREE from 'three';
import type { Game } from '../game/sim';
import type { Structure, Runner } from '../game/types';
import type { RunnerViews } from '../render/runners';
import { STRUCTURES, type BuildTab, type StructureId } from '../game/data/structures';
import { W, H, inBounds, idx } from '../game/grid';
import type { World } from '../render/world';
import type { StructureViews } from '../render/structures';
import type { Overlay } from '../render/overlay';
import type { TerrainView } from '../render/terrain';

export type Mode =
  | { kind: 'idle' }
  | { kind: 'build'; id: StructureId }
  | { kind: 'link'; op: 'connect' | 'disconnect'; from: Structure };


/** The bits of a mouse/pointer event the click logic needs (touch taps synthesize one). */
interface PointerLike { clientX: number; clientY: number; button: number; shiftKey: boolean; target: EventTarget | null; preventDefault?(): void }
export class Controller {
  mode: Mode = { kind: 'idle' };
  selected: Structure | null = null;
  selectedRunner: Runner | null = null;
  hoverRunner: Runner | null = null;
  rv: RunnerViews | null = null;
  hover: Structure | null = null;
  hoverCell: { x: number; z: number } | null = null;
  hoverPoint = new THREE.Vector3();
  tab: BuildTab = 'maze';
  drag: { x: number; z: number } | null = null;
  keys = new Set<string>();
  mouse = new THREE.Vector2(-10, -10);
  mouseIn = false;
  edgeScroll = true;
  private middle: { x: number; y: number } | null = null;
  private rotating: { x: number; moved: boolean } | null = null;
  /** Keep the runners' route drawn during waves (Tab); Alt shows it while held. */
  showRoute = false;
  onRouteToggle: (on: boolean) => void = () => {};
  private hits: THREE.Intersection[] = [];
  /** Last touch activity: the browser's emulated mouse events after a tap are ignored. */
  private lastTouch = -1e9;
  /** True once the player has used touch (drives the on-screen Cancel button, no edge scroll). */
  touchUsed = false;
  private pickKey = '';
  private pickCache: Structure | null = null;
  private abort = new AbortController();
  private ray = new THREE.Raycaster();
  private dirty = true;
  onHotkey: (key: string) => boolean = () => false;
  onToggleResearch: () => void = () => {};
  onMenu: () => void = () => {};
  onMessage: (text: string, kind?: string) => void = () => {};
  lastPlaceCheck: { ok: boolean; reason?: string } | null = null;
  private previewKey = '';
  private preview: { x: number; z: number; ok: boolean; reason?: string }[] = [];
  private previewBlocked: number[] = [];

  constructor(private game: Game, private world: World, private sv: StructureViews, private overlay: Overlay, private terrain: TerrainView) {
    const c = world.canvas;
    const opt = { signal: this.abort.signal };
    const emulated = () => performance.now() - this.lastTouch < 900;
    c.addEventListener('mousemove', (e) => { if (emulated()) return; this.mouse.set(e.clientX, e.clientY); this.mouseIn = true; this.dirty = true; }, opt);
    // middle-drag panning via pointer capture, so the drag keeps working over the HUD
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      this.middle = { x: e.clientX, y: e.clientY };
      try { c.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      c.style.cursor = 'grabbing';
    }, opt);
    window.addEventListener('pointermove', (e) => { if (this.middle) this.panDrag(e); }, opt);
    const endPan = (e: PointerEvent) => {
      if (!this.middle || (e.type === 'pointerup' && e.button !== 1)) return;
      this.middle = null;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    };
    window.addEventListener('pointerup', endPan, opt);
    window.addEventListener('pointercancel', endPan, opt);
    c.addEventListener('lostpointercapture', () => { this.middle = null; }, opt);
    // no browser autoscroll / paste-on-middle-click
    c.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); }, opt);
    c.addEventListener('mouseleave', () => { this.mouseIn = false; }, opt);
    // right-drag orbits the camera (a plain right-click still cancels)
    window.addEventListener('mousemove', (e) => {
      const r = this.rotating;
      if (!r || !(e.buttons & 2)) return;
      const dx = e.clientX - r.x;
      if (!r.moved && Math.abs(dx) < 4) return;
      r.moved = true;
      this.world.goalYaw -= dx * 0.0065;
      this.world.yaw -= dx * 0.0065;
      r.x = e.clientX;
      this.world.canvas.style.cursor = 'ew-resize';
    }, opt);
    window.addEventListener('keyup', (e) => { if (e.key === 'Alt') e.preventDefault(); }, opt);
    c.addEventListener('mousedown', (e) => { if (!emulated()) this.down(e); }, opt);
    window.addEventListener('mouseup', (e) => { if (!emulated()) this.up(e); }, opt);
    this.setupTouch(c, opt);
    c.addEventListener('contextmenu', (e) => e.preventDefault(), opt);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.world.goalDist *= Math.exp(e.deltaY * 0.0012); }, { passive: false, signal: this.abort.signal });
    window.addEventListener('keydown', (e) => this.keydown(e), opt);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), opt);
    window.addEventListener('blur', () => this.keys.clear(), opt);
  }

  dispose() {
    this.abort.abort();
  }

  setMode(m: Mode) {
    this.mode = m;
    this.drag = null;
    this.dirty = true;
    if (m.kind !== 'idle') this.overlay.clear();
  }
  cancel() {
    if (this.mode.kind !== 'idle') { this.setMode({ kind: 'idle' }); return true; }
    if (this.selected) { this.select(null); return true; }
    return false;
  }
  select(s: Structure | null) {
    this.selected = s;
    this.selectedRunner = null;
    this.dirty = true;
  }
  selectRunner(r: Runner | null) {
    this.selectedRunner = r;
    this.selected = null;
  }

  private pickRunner(): Runner | null {
    if (!this.rv) return null;
    let best: Runner | null = null, bd = Infinity;
    const c = new THREE.Vector3(), sphere = new THREE.Sphere();
    for (const r of this.game.runners) {
      if (!r.alive) continue;
      const p = this.rv.viewPos(r.id);
      if (!p) continue;
      const h = r.type.scale * 1.2;
      sphere.set(c.set(p.x, p.y + h * 0.5, p.z), Math.max(0.45, h * 0.5));
      const hit = this.ray.ray.intersectSphere(sphere, c);
      if (hit) { const d = hit.distanceTo(this.ray.ray.origin); if (d < bd) { bd = d; best = r; } }
    }
    return best;
  }

  /** Grab-the-map panning: the ground under the cursor stays under the cursor. */
  private panDrag(e: PointerEvent) {
    const m = this.middle!;
    this.panBy(e.clientX - m.x, e.clientY - m.y);
    m.x = e.clientX; m.y = e.clientY;
  }

  /** Move the camera so the ground follows a pointer that moved (dxPx, dyPx) on screen. */
  private panBy(dxPx: number, dyPx: number) {
    const w = this.world;
    const cam = w.camera;
    const perPx = (w.dist * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / window.innerHeight;
    const pitch = Math.atan2(cam.position.y - w.target.y, Math.hypot(cam.position.x - w.target.x, cam.position.z - w.target.z));
    const dx = dxPx * perPx, dz = (dyPx * perPx) / Math.max(0.3, Math.sin(pitch));
    const cy = Math.cos(w.yaw), sy = Math.sin(w.yaw);
    w.goal.x -= dx * cy + dz * sy;
    w.goal.z -= -dx * sy + dz * cy;
    // move the eased target along too, so the drag feels 1:1 instead of rubber-banded
    w.target.x -= dx * cy + dz * sy;
    w.target.z -= -dx * sy + dz * cy;
  }

  /**
   * Touch: tap = click; one-finger drag pans (in build mode it steers the placement ghost and
   * draws wall lines, and lifting places); two fingers pinch-zoom, twist-rotate and pan together.
   */
  private setupTouch(c: HTMLCanvasElement, opt: AddEventListenerOptions) {
    const touches = new Map<number, { x: number; y: number }>();
    let one: { x: number; y: number; moved: boolean; build: boolean } | null = null;
    let two: { d: number; a: number; mx: number; my: number; dist: number; yaw: number } | null = null;
    const w = this.world;
    const pair = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
    const at = (x: number, y: number) => { this.mouse.set(x, y); this.mouseIn = true; this.refreshHover(); this.dirty = true; };
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      this.lastTouch = performance.now();
      this.touchUsed = true;
      try { c.setPointerCapture(e.pointerId); } catch { /* gone */ }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        at(e.clientX, e.clientY);
        const build = this.mode.kind === 'build';
        one = { x: e.clientX, y: e.clientY, moved: false, build };
        // build mode: the ghost appears under the finger right away; a wall line starts here
        if (build && this.hoverCell) this.drag = { ...this.hoverCell };
      } else if (touches.size === 2) {
        if (one?.build) this.drag = null;   // a second finger means camera, not placement
        one = null;
        const p = pair();
        two = { ...p, dist: w.goalDist, yaw: w.goalYaw };
      }
    }, opt);
    c.addEventListener('pointermove', (e) => {
      const t = touches.get(e.pointerId);
      if (e.pointerType !== 'touch' || !t) return;
      this.lastTouch = performance.now();
      const px = t.x, py = t.y;
      t.x = e.clientX; t.y = e.clientY;
      if (touches.size === 1 && one) {
        if (!one.moved && Math.hypot(t.x - one.x, t.y - one.y) > 10) one.moved = true;
        if (!one.moved) return;
        if (one.build) at(t.x, t.y);
        else this.panBy(t.x - px, t.y - py);
      } else if (touches.size >= 2 && two) {
        const p = pair();
        w.goalDist = THREE.MathUtils.clamp(two.dist * two.d / Math.max(24, p.d), 12, 64);
        w.dist = w.goalDist;
        w.goalYaw = two.yaw - (p.a - two.a);
        w.yaw = w.goalYaw;
        this.panBy(p.mx - two.mx, p.my - two.my);
        two.mx = p.mx; two.my = p.my;
      }
    }, opt);
    const end = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      touches.delete(e.pointerId);
      this.lastTouch = performance.now();
      const ev: PointerLike = { clientX: e.clientX, clientY: e.clientY, button: 0, shiftKey: false, target: c };
      if (one && touches.size === 0 && e.type === 'pointerup') {
        const o = one;
        one = null;
        if (o.build) { at(e.clientX, e.clientY); if (!this.drag && this.hoverCell) this.drag = { ...this.hoverCell }; this.up(ev); }
        else if (!o.moved) { at(o.x, o.y); this.down(ev); this.up(ev); }
      }
      if (touches.size < 2) two = null;
      if (touches.size === 1) one = null;              // lifting one finger of a pinch isn't a tap
      if (touches.size === 0) { this.mouseIn = false; if (this.mode.kind !== 'build') this.drag = null; }
    };
    c.addEventListener('pointerup', end, opt);
    c.addEventListener('pointercancel', end, opt);
  }

  /** Ground point under the mouse (ray marched against terrain heights). */
  private pick(): THREE.Vector3 | null {
    const ndc = new THREE.Vector2((this.mouse.x / window.innerWidth) * 2 - 1, -(this.mouse.y / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.world.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let h = 0, p = new THREE.Vector3();
    for (let i = 0; i < 5; i++) {
      const t = (h - o.y) / d.y;
      if (t < 0) return null;
      p = o.clone().addScaledVector(d, t);
      h = this.terrain.heightAt(p.x, p.z);
    }
    return p;
  }

  private pickStructure(): Structure | null {
    // cached until the ray or the board changes (the exact mesh test below isn't free)
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const key = `${o.x.toFixed(3)},${o.y.toFixed(3)},${o.z.toFixed(3)},${d.x.toFixed(4)},${d.y.toFixed(4)},${d.z.toFixed(4)}|${this.game.grid.version}|${this.game.structures.length}`;
    if (key === this.pickKey) return this.pickCache && this.game.structById.has(this.pickCache.id) ? this.pickCache : null;
    this.pickKey = key;
    this.pickCache = this.pickStructureUncached();
    return this.pickCache;
  }

  private pickStructureUncached(): Structure | null {
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    const cands: { s: Structure; d: number }[] = [];
    for (const s of this.game.structures) {
      const v = this.sv.views.get(s.id);
      const h = s.def.id === 'wall' ? 1.4 : v ? v.height * 0.92 : 2;
      const half = s.def.size / 2 - 0.04;
      box.min.set(s.cx - half, s.y, s.cz - half);
      box.max.set(s.cx + half, s.y + h, s.cz + half);
      if (this.ray.ray.intersectBox(box, hit)) cands.push({ s, d: hit.distanceTo(this.ray.ray.origin) });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    // Bounding boxes are generous around a tower's silhouette, so a tall tower's empty corners
    // would steal clicks from a pylon visible behind it: test the actual meshes, nearest first.
    for (const c of cands.slice(0, 4)) {
      if (c.s.def.id === 'wall') return c.s;
      const v = this.sv.views.get(c.s.id);
      if (!v) return c.s;
      this.hits.length = 0;
      this.ray.intersectObject(v.model, true, this.hits);
      if (this.hits.length) return c.s;
    }
    // nothing solid under the cursor: whatever stands on the ground point, else the nearest box
    const p = this.hoverPoint;
    const cx = Math.floor(p.x), cz = Math.floor(p.z);
    if (inBounds(cx, cz)) {
      const occ = this.game.grid.occupant[idx(cx, cz)];
      const s = occ >= 0 ? this.game.structById.get(occ) : undefined;
      if (s) return s;
    }
    return cands[0].s;
  }

  /** Resolve what's under the cursor right now (also called from input handlers). */
  refreshHover() {
    const p = this.mouseIn ? this.pick() : null;
    this.hover = null;
    this.hoverCell = null;
    if (!p) return;
    this.hoverPoint.copy(p);
    this.hover = this.pickStructure();
    this.hoverRunner = this.mode.kind === 'idle' ? this.pickRunner() : null;
    const def = this.mode.kind === 'build' ? STRUCTURES[this.mode.id] : null;
    const off = def ? def.size / 2 : 0.5;
    const cx = Math.round(p.x - off), cz = Math.round(p.z - off);
    const hx = def?.size === 2 ? cx : Math.floor(p.x), hz = def?.size === 2 ? cz : Math.floor(p.z);
    if (inBounds(hx, hz)) this.hoverCell = { x: hx, z: hz };
  }

  private down(e: PointerLike) {
    this.mouse.set(e.clientX, e.clientY);
    this.mouseIn = true;
    this.refreshHover();
    if (e.button === 1) { e.preventDefault?.(); return; }
    if (e.button === 2) { this.rotating = { x: e.clientX, moved: false }; return; }
    if (e.button !== 0) return;
    const m = this.mode;
    if (m.kind === 'build') {
      if (this.hoverCell) this.drag = { ...this.hoverCell };
      return;
    }
    if (m.kind === 'link') {
      const t = this.hover;
      if (!t) { this.setMode({ kind: 'idle' }); return; }
      this.applyLink(m.op, m.from, t);
      if (!e.shiftKey) this.setMode({ kind: 'idle' });
      return;
    }
    if (this.hoverRunner && (!this.hover || this.ray.ray.origin.distanceTo(this.hoverPoint) > 0)) {
      // runners are small: prefer them when the cursor is right on one
      const rp = this.rv?.viewPos(this.hoverRunner.id);
      const sp = this.hover ? new THREE.Vector3(this.hover.cx, this.hover.y, this.hover.cz) : null;
      if (!sp || !rp || rp.distanceTo(this.ray.ray.origin) < sp.distanceTo(this.ray.ray.origin)) { this.selectRunner(this.hoverRunner); return; }
    }
    this.select(this.hover);
  }

  applyLink(op: 'connect' | 'disconnect', from: Structure, t: Structure) {
    const g = this.game;
    if (op === 'connect') {
      // selected may be the source or the consumer
      const [src, dst] = g.canLink(from, t).ok ? [from, t] : g.canLink(t, from).ok ? [t, from] : from.def.source ? [from, t] : [t, from];
      const chk = g.canLink(src, dst);
      if (chk.ok) g.link(src, dst);
      else this.onMessage(chk.reason ?? 'Can\'t link', 'warn');
    } else {
      const l = from.links.find((x) => x.to === t) ?? from.inLinks.find((x) => x.from === t);
      if (l) g.unlink(l); else this.onMessage('Not linked', 'warn');
    }
  }

  private up(e: PointerLike) {
    if (e.button === 1) return;
    if (e.button === 2) {
      const r = this.rotating;
      this.rotating = null;
      if (r && !r.moved && e.target === this.world.canvas) this.cancel();
      return;
    }
    if (e.button !== 0) return;
    if (e.target === this.world.canvas) { this.mouse.set(e.clientX, e.clientY); this.refreshHover(); }
    const m = this.mode;
    if (m.kind === 'build' && this.drag) {
      const spots = this.buildSpots();
      const def = STRUCTURES[m.id];
      let placed = 0;
      let lastReason = '';
      for (const s of spots) {
        const chk = this.game.canPlace(m.id, s.x, s.z);
        if (chk.ok && this.game.place(m.id, s.x, s.z)) placed++;
        else lastReason = chk.reason ?? '';
      }
      if (!placed && lastReason) this.onMessage(lastReason, 'warn');
      this.drag = null;
      if (placed && def.size === 2 && !e.shiftKey) this.setMode({ kind: 'idle' });
      if (placed && def.unique) this.setMode({ kind: 'idle' });
      this.dirty = true;
    }
  }

  /** Cells for the current placement (single or an L-shaped wall drag). */
  buildSpots(): { x: number; z: number }[] {
    if (this.mode.kind !== 'build' || !this.hoverCell) return [];
    const def = STRUCTURES[this.mode.id];
    const hc = this.hoverCell;
    if (def.size === 2) return [{ x: hc.x, z: hc.z }];
    if (!this.drag) return [{ x: hc.x, z: hc.z }];
    const a = this.drag, b = hc;
    const out: { x: number; z: number }[] = [];
    const run = (from: number, to: number, fn: (v: number) => void) => {
      const s = Math.sign(to - from) || 1;
      for (let v = from; ; v += s) { fn(v); if (v === to) break; }
    };
    // L-shape: the longer leg first, from the drag start
    if (Math.abs(b.x - a.x) >= Math.abs(b.z - a.z)) {
      run(a.x, b.x, (x) => out.push({ x, z: a.z }));
      if (b.z !== a.z) run(a.z + Math.sign(b.z - a.z), b.z, (z) => out.push({ x: b.x, z }));
    } else {
      run(a.z, b.z, (z) => out.push({ x: a.x, z }));
      if (b.x !== a.x) run(a.x + Math.sign(b.x - a.x), b.x, (x) => out.push({ x, z: b.z }));
    }
    return out.slice(0, 120);
  }

  private keydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (k === 'escape') { if (!this.cancel()) this.onMenu(); e.preventDefault(); return; }
    if (e.metaKey || e.ctrlKey) return;
    // Alt (hold) would otherwise focus the browser's menu bar on some platforms
    if (k === 'alt') { e.preventDefault(); return; }
    if (k === 'tab') { e.preventDefault(); if (!e.repeat) this.toggleRoute(); return; }
    if (k === ',' || k === '<') { this.world.goalYaw += Math.PI / 4; return; }
    if (k === '.' || k === '>') { this.world.goalYaw -= Math.PI / 4; return; }
    if (k === 'r' && !this.onHotkey('r')) { this.onToggleResearch(); return; }
    if (this.onHotkey(k)) e.preventDefault();
  }

  toggleRoute(on = !this.showRoute) {
    this.showRoute = on;
    this.onRouteToggle(on);
  }

  update(dt: number) {
    // camera pan
    const w = this.world;
    const speed = w.dist * 1.1 * dt;
    let mx = 0, my = 0;   // screen-space intent: +x right, +y down
    if (this.keys.has('arrowleft')) mx -= 1;
    if (this.keys.has('arrowright')) mx += 1;
    if (this.keys.has('arrowup')) my -= 1;
    if (this.keys.has('arrowdown')) my += 1;
    if (this.edgeScroll && this.mouseIn && document.hasFocus() && !this.rotating && performance.now() - this.lastTouch > 1000) {
      const m = 6;
      if (this.mouse.x <= m) mx -= 1;
      if (this.mouse.x >= window.innerWidth - m) mx += 1;
      if (this.mouse.y <= m) my -= 1;
      if (this.mouse.y >= window.innerHeight - m) my += 1;
    }
    if (mx || my) {
      // screen right = (cos yaw, -sin yaw), screen down = (sin yaw, cos yaw) on the ground
      const cy = Math.cos(w.yaw), sy = Math.sin(w.yaw);
      w.goal.x += (mx * cy + my * sy) * speed;
      w.goal.z += (-mx * sy + my * cy) * speed;
    }

    this.refreshHover();
    this.terrain.uniforms.uGridAlpha.value = this.mode.kind === 'build' ? 1 : 0;
    this.terrain.uniforms.uCursor.value.set(this.hoverPoint.x, this.hoverPoint.z);

    // overlays
    const m = this.mode;
    this.overlay.showSelection(m.kind === 'idle' ? this.selected : m.kind === 'link' ? m.from : null);
    if (m.kind === 'build') {
      const spots = this.buildSpots();
      const def = STRUCTURES[m.id];
      const key = `${m.id}|${JSON.stringify(spots)}|${this.game.grid.version}|${Math.floor(this.game.gold)}|${this.game.runners.length}`;
      if (key !== this.previewKey) {
        this.previewKey = key;
        // validate sequentially with already-previewed cells blocked
        const blocked: number[] = [];
        let goldLeft = this.game.gold;
        this.preview = spots.map((s) => {
          const chk = this.game.canPlace(m.id, s.x, s.z, { ignoreGold: true, skipPath: true });
          const cost = def.cost - (chk.credit ?? 0);   // building over walls credits them
          let ok = chk.ok && goldLeft >= cost;
          let reason = !chk.ok ? chk.reason : goldLeft < cost ? 'Not enough gold' : undefined;
          const cells = chk.ok ? chk.cells.filter((c) => this.game.grid.isWalkable(c)) : [];
          if (ok && cells.length) {
            const f = this.game.grid.computeFields([...blocked, ...cells]);
            if (!this.game.grid.legsConnected(f)) { ok = false; reason = 'Would block the path'; }
          }
          if (ok) { goldLeft -= cost; blocked.push(...cells); }
          return { ...s, ok, reason };
        });
        this.previewBlocked = blocked;
        this.lastPlaceCheck = this.preview.length ? { ok: this.preview.every((r) => r.ok), reason: this.preview.find((r) => !r.ok)?.reason } : null;
      }
      const res = this.preview;
      const plateau = res[0] && this.game.grid.terrain[idx(res[0].x, res[0].z)] === 4;
      this.overlay.showPlacement(m.id, res, def.attack ? def.attack.range * (plateau ? 1.15 : 1) : m.id === 'clock_tower' ? 3.2 : 0);
      this.overlay.updatePath(this.previewBlocked.length ? this.previewBlocked : undefined);
      this.overlay.setPathVisible(true, this.previewBlocked.length > 0);
      this.overlay.showHover(null);
    } else if (m.kind === 'link') {
      const a = this.sv.anchor(m.from);
      const b = this.hover ? this.sv.anchor(this.hover) : this.hoverPoint.clone().setY(this.hoverPoint.y + 1);
      this.overlay.showLinkTargets(m.from, this.hover, m.op, a, b);
      this.overlay.showHover(this.hover);
      this.overlay.setPathVisible(false);
    } else {
      this.overlay.clear();
      this.overlay.showSelection(this.selected);
      this.overlay.showHover(this.hover && this.hover !== this.selected ? this.hover : null);
      this.overlay.updatePath();
      this.overlay.setPathVisible(this.game.phase === 'build' || this.keys.has('alt') || this.showRoute);
    }
    if (this.selected && !this.game.structById.has(this.selected.id)) this.select(null);
    if (this.selectedRunner) {
      const p = this.selectedRunner.alive ? this.rv?.viewPos(this.selectedRunner.id) : null;
      if (!p) this.selectedRunner = null;
      else this.overlay.showRunnerSelection(p.x, p.y, p.z, this.selectedRunner.type.scale);
    } else this.overlay.showRunnerSelection(0, 0, 0, 0);
    if (m.kind === 'link' && !this.game.structById.has(m.from.id)) this.setMode({ kind: 'idle' });
    this.world.canvas.style.cursor = this.middle ? 'grabbing' : this.rotating?.moved ? 'ew-resize' : m.kind === 'link' ? 'crosshair' : m.kind === 'build' ? 'cell' : this.hover || this.hoverRunner ? 'pointer' : 'default';
  }
}

export { W, H };
