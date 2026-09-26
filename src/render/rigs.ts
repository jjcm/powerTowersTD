// Mechanical rigs for the aiming towers. The Meshy models are single meshes, so at load time
// we split their triangles into parts (static base, turret, bow limbs, bolt, winch crank /
// carriage, barrel) using geometric rules found by profiling the models
// (tools/inspect_split.mjs), then animate the parts: the turret tracks targets; the ballista's
// modelled bowstring is replaced by a live one, so on release the string snaps straight and the
// limbs whip forward and quiver, then the winch hauls it back and a fresh bolt is lowered into
// the groove; the cannon's barrel elevates, recoils and runs back out.

import * as THREE from 'three';
import type { Structure } from '../game/types';

type PartName = 'base' | 'turret' | 'limbL' | 'limbR' | 'bolt' | 'crank' | 'barrel' | 'string';

interface PartGeo { name: PartName; geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4 }

interface RigTemplate {
  kind: 'ballista' | 'cannon';
  parts: PartGeo[];
  turretPivot: THREE.Vector3;
  limbPivotL?: THREE.Vector3;
  limbPivotR?: THREE.Vector3;
  crankPivot?: THREE.Vector3;
  stringTipL?: THREE.Vector3; // where the bowstring meets each limb tip (template space)
  stringTipR?: THREE.Vector3;
  nock?: THREE.Vector3;       // string centre at rest (as modelled)
  drawLen?: number;           // how far the winch pulls the string back
  barrelPivot?: THREE.Vector3;
  barrelAxis?: THREE.Vector3;
  muzzle: THREE.Vector3;      // template space
  forwardYaw: number;         // yaw that points the model's forward along +z
  height: number;
}

const cache = new Map<string, RigTemplate | null>();

/** Triangles of every mesh in a template, in template space. */
function collect(template: THREE.Object3D) {
  template.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
  const meshes: { mesh: THREE.Mesh; M: THREE.Matrix4; cent: Float32Array; index: ArrayLike<number> }[] = [];
  const v = new THREE.Vector3();
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const M = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = mesh.geometry.index ? mesh.geometry.index.array : Array.from({ length: pos.count }, (_, i) => i);
    const tri = index.length / 3;
    const cent = new Float32Array(tri * 3);
    for (let t = 0; t < tri; t++) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, index[t * 3 + k]).applyMatrix4(M);
        cx += v.x; cy += v.y; cz += v.z;
      }
      cent[t * 3] = cx / 3; cent[t * 3 + 1] = cy / 3; cent[t * 3 + 2] = cz / 3;
    }
    meshes.push({ mesh, M, cent, index });
  });
  return meshes;
}

function build(kind: 'ballista' | 'cannon', template: THREE.Object3D): RigTemplate | null {
  const meshes = collect(template);
  if (!meshes.length) return null;
  let minY = Infinity, maxY = -Infinity;
  for (const m of meshes) for (let i = 1; i < m.cent.length; i += 3) { minY = Math.min(minY, m.cent[i]); maxY = Math.max(maxY, m.cent[i]); }
  const H = maxY - minY;
  const yr = (y: number) => (y - minY) / H;
  // tower axis from the middle of the stone body
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const m of meshes) for (let i = 0; i < m.cent.length; i += 3) {
    const y = yr(m.cent[i + 1]);
    if (y > 0.3 && y < 0.45) { x0 = Math.min(x0, m.cent[i]); x1 = Math.max(x1, m.cent[i]); z0 = Math.min(z0, m.cent[i + 2]); z1 = Math.max(z1, m.cent[i + 2]); }
  }
  const ax = (x0 + x1) / 2, az = (z0 + z1) / 2;
  const split = kind === 'ballista' ? 0.7 : 0.52;
  const turretPivot = new THREE.Vector3(ax, minY + split * H, az);

  // cannon barrel axis: centre of the muzzle face -> cascabel knob at the rear
  let bc = new THREE.Vector3(), bd = new THREE.Vector3(1, 0, 0), blen = 0;
  if (kind === 'cannon') {
    const top: THREE.Vector3[] = [];
    for (const m of meshes) for (let i = 0; i < m.cent.length; i += 3) if (yr(m.cent[i + 1]) > split + 0.05) top.push(new THREE.Vector3(m.cent[i], m.cent[i + 1], m.cent[i + 2]));
    const minDx = Math.min(...top.map((p) => (p.x - ax) / H));
    const cen = (ps: THREE.Vector3[]) => ps.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(Math.max(1, ps.length));
    const muzzle = cen(top.filter((p) => (p.x - ax) / H < minDx + 0.05));
    const breech = cen(top.filter((p) => yr(p.y) > 0.6 && (p.x - ax) / H > 0.24));
    bc = breech;
    bd = muzzle.clone().sub(breech);
    blen = bd.length();
    bd.normalize();
  }

  // the bolt sits a little off the tower axis: centre it on what sticks out past the bow
  let boltX = 0;
  if (kind === 'ballista') {
    let sx = 0, n = 0;
    for (const m of meshes) for (let i = 0; i < m.cent.length; i += 3) {
      const dx = (m.cent[i] - ax) / H, dz = (m.cent[i + 2] - az) / H;
      if (yr(m.cent[i + 1]) > 0.84 && dz > 0.33 && Math.abs(dx) < 0.1) { sx += dx; n++; }
    }
    boltX = n ? sx / n : 0;
  }

  // bowstring: the model is strung at rest, so the string is the back-most straight line across
  // each limb. Fit it per side from the back-most point in narrow dx bins (ignoring the winch).
  const strLine: { a: number; b: number; tip: number }[] = [];
  const inCrank = (dx: number, dz: number, r: number) => dx > 0.09 && dz < -0.12 && dz > -0.3 && r > 0.78;
  if (kind === 'ballista') {
    for (const side of [-1, 1]) {
      let tip = 0;
      const bins = new Map<number, number>();
      for (const m of meshes) for (let i = 0; i < m.cent.length; i += 3) {
        const r = yr(m.cent[i + 1]), dx = (m.cent[i] - ax) / H, dz = (m.cent[i + 2] - az) / H, u = dx * side;
        if (r < 0.78 || u < 0.13 || inCrank(dx, dz, r)) continue;
        tip = Math.max(tip, u);
        const k = Math.floor(u / 0.02);
        bins.set(k, Math.min(bins.get(k) ?? Infinity, dz));
      }
      // least squares over the bins, skipping the tip where limb and string merge
      let n = 0, su = 0, sz = 0, suu = 0, suz = 0;
      for (const [k, z] of bins) { const u = (k + 0.5) * 0.02; if (u > tip - 0.04) continue; n++; su += u; sz += z; suu += u * u; suz += u * z; }
      const b = n > 2 ? (n * suz - su * sz) / Math.max(1e-6, n * suu - su * su) : 0;
      strLine.push({ a: n ? (sz - b * su) / n : 0, b, tip });
    }
  }

  const classify = (x: number, y: number, z: number): PartName => {
    const r = yr(y);
    if (r < split) return 'base';
    const dx = (x - ax) / H, dz = (z - az) / H;
    if (kind === 'ballista') {
      if (inCrank(dx, dz, r)) return 'crank';
      const u = Math.abs(dx), L = strLine[dx < 0 ? 0 : 1];
      if (L && r > 0.78 && u > 0.06 && u < L.tip - 0.02) {
        const lz = L.a + L.b * u;
        if (u < 0.13 ? dz > lz - 0.012 && dz < lz + 0.02 : dz > lz - 0.03 && dz < lz + 0.035) return 'string';
      }
      if (Math.abs(dx) > 0.13 && r > 0.78) return dx < 0 ? 'limbL' : 'limbR';
      const bx = Math.abs(dx - boltX);
      if (r > 0.84 && ((bx < 0.035 && dz > 0.05) || (bx < 0.07 && dz > 0.36))) return 'bolt'; // shaft + broad head
      return 'turret';
    }
    const vx = x - bc.x, vy = y - bc.y, vz = z - bc.z;
    const t = vx * bd.x + vy * bd.y + vz * bd.z;
    const d = Math.hypot(vx - bd.x * t, vy - bd.y * t, vz - bd.z * t) / H;
    if (d < 0.13 && t / H > -0.1 && t < blen + 0.08 * H) return 'barrel';
    return 'turret';
  };

  const parts: PartGeo[] = [];
  const pts: Partial<Record<PartName, THREE.Vector3[]>> = {};
  for (const m of meshes) {
    const lists = new Map<PartName, number[]>();
    const tri = m.cent.length / 3;
    for (let t = 0; t < tri; t++) {
      const x = m.cent[t * 3], y = m.cent[t * 3 + 1], z = m.cent[t * 3 + 2];
      const part = classify(x, y, z);
      let l = lists.get(part);
      if (!l) { l = []; lists.set(part, l); }
      l.push(m.index[t * 3], m.index[t * 3 + 1], m.index[t * 3 + 2]);
      (pts[part] ??= []).push(new THREE.Vector3(x, y, z));
    }
    for (const [name, list] of lists) {
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(m.mesh.geometry.attributes)) g.setAttribute(k, a);
      g.setIndex(list);
      g.boundingSphere = m.mesh.geometry.boundingSphere?.clone() ?? null;
      if (!g.boundingSphere) g.computeBoundingSphere();
      parts.push({ name, geometry: g, material: m.mesh.material, matrix: m.M });
    }
  }
  const cen = (ps: THREE.Vector3[] | undefined, f: (p: THREE.Vector3) => boolean = () => true) => {
    const sel = (ps ?? []).filter(f);
    return sel.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(Math.max(1, sel.length));
  };
  const rig: RigTemplate = { kind, parts, turretPivot, muzzle: new THREE.Vector3(), forwardYaw: 0, height: H };
  if (kind === 'ballista') {
    // limbs flex around their roots near the centre of the bow
    rig.limbPivotL = cen(pts.limbL, (p) => (p.x - ax) / H > -0.17);
    rig.limbPivotR = cen(pts.limbR, (p) => (p.x - ax) / H < 0.17);
    rig.crankPivot = cen(pts.crank);
    const str = pts.string ?? [];
    if (str.length > 20 && strLine.length === 2) {
      const at = (side: number) => {
        const L = strLine[side < 0 ? 0 : 1], u = L.tip - 0.02;
        const near = str.filter((p) => ((p.x - ax) / H) * side > L.tip - 0.1);
        const y = near.length ? near.reduce((a, p) => a + p.y, 0) / near.length : turretPivot.y;
        return new THREE.Vector3(ax + side * u * H, y, az + (L.a + L.b * u) * H);
      };
      rig.stringTipL = at(-1);
      rig.stringTipR = at(1);
      const mid = str.filter((p) => Math.abs((p.x - ax) / H) < 0.2);
      const my = mid.length ? mid.reduce((a, p) => a + p.y, 0) / mid.length : (rig.stringTipL.y + rig.stringTipR.y) / 2;
      rig.nock = new THREE.Vector3(ax + boltX * H, my, az + ((strLine[0].a + strLine[1].a) / 2) * H);
      rig.drawLen = 0.2 * H;
    }
    const bolt = pts.bolt ?? [];
    const tip = bolt.reduce((a, p) => (p.z > a.z ? p : a), new THREE.Vector3(ax, turretPivot.y, az));
    rig.muzzle.copy(tip);
    rig.forwardYaw = 0; // forward is +z
  } else {
    // trunnions: where the barrel axis passes over the tower axis
    const t = (ax - bc.x) / (bd.x || 1e-3);
    rig.barrelPivot = bc.clone().addScaledVector(bd, THREE.MathUtils.clamp(t, 0, blen));
    rig.barrelAxis = bd.clone();
    rig.muzzle.copy(bc).addScaledVector(bd, blen);
    rig.forwardYaw = Math.PI / 2; // forward is -x
  }
  const counts = Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, v?.length ?? 0]));
  console.info(`rig ${kind}`, counts);
  return rig;
}

export function rigTemplate(kind: 'ballista' | 'cannon', template: THREE.Object3D, procedural: boolean): RigTemplate | null {
  if (procedural) return null;
  if (!cache.has(kind)) cache.set(kind, build(kind, template));
  return cache.get(kind)!;
}

// ------------------------------------------------------------------ instances
class Spring {
  v = 0;
  constructor(public x = 0, public k = 120, public d = 14) {}
  step(target: number, dt: number) {
    // sub-step so stiff springs stay stable on long frames
    const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (target - this.x) * this.k - this.v * this.d;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  }
}

const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const DRAW_ANGLE = 0.34;            // limb swing (rad) between rest and fully drawn
const Y_AXIS = new THREE.Vector3(0, 1, 0);
let stringGeo: THREE.CylinderGeometry | null = null;
let stringMat: THREE.MeshStandardMaterial | null = null;

export class TurretRig {
  root = new THREE.Group();
  private turret = new THREE.Group();
  private recoil = new THREE.Group();
  private limbL?: THREE.Group; private limbR?: THREE.Group; private crank?: THREE.Group; private bolt?: THREE.Group;
  private strings: THREE.Mesh[] = [];
  private barrelPivot?: THREE.Group; private barrelSlide?: THREE.Group;
  private yaw = 0;
  private lastFire = -1;
  private sinceFire = 99;
  private draw = new Spring(1, 900, 16);      // ballista: 1 = string wound back, 0 = at rest (as modelled)
  private kickZ = new Spring(0, 160, 13);     // turret slide
  private kickP = new Spring(0, 180, 10);     // turret pitch
  private slide = new Spring(0, 90, 11);      // cannon barrel run-out
  private pitch = new Spring(0, 40, 10);      // cannon elevation
  private idlePhase = Math.random() * 10;
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3(); private tmpN = new THREE.Vector3();

  constructor(private tpl: RigTemplate, initialYaw: number) {
    const P = tpl.turretPivot;
    this.turret.position.copy(P);
    this.root.add(this.turret);
    this.turret.add(this.recoil);
    const place = (part: PartGeo, parent: THREE.Object3D, pivotWorld: THREE.Vector3) => {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(new THREE.Matrix4().makeTranslation(-pivotWorld.x, -pivotWorld.y, -pivotWorld.z).multiply(part.matrix));
      mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh);
    };
    const pivotGroup = (at: THREE.Vector3) => { const g = new THREE.Group(); g.position.copy(at).sub(P); this.recoil.add(g); return g; };
    if (tpl.kind === 'ballista') {
      this.limbL = pivotGroup(tpl.limbPivotL!);
      this.limbR = pivotGroup(tpl.limbPivotR!);
      this.crank = pivotGroup(tpl.crankPivot!);
      this.bolt = pivotGroup(P);
      if (tpl.nock) {
        // a live bowstring (the modelled one is hidden): tip -> nock -> tip
        stringGeo ??= new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
        stringMat ??= new THREE.MeshStandardMaterial({ color: 0x3b2e20, roughness: 0.85, metalness: 0 });
        for (let i = 0; i < 2; i++) {
          const m = new THREE.Mesh(stringGeo, stringMat);
          m.castShadow = true;
          this.recoil.add(m);
          this.strings.push(m);
        }
      }
    } else {
      this.barrelPivot = pivotGroup(tpl.barrelPivot!);
      this.barrelSlide = new THREE.Group();
      this.barrelPivot.add(this.barrelSlide);
    }
    for (const part of tpl.parts) {
      switch (part.name) {
        case 'base': {
          const mesh = new THREE.Mesh(part.geometry, part.material);
          mesh.matrixAutoUpdate = false; mesh.matrix.copy(part.matrix);
          mesh.castShadow = true; mesh.receiveShadow = true;
          this.root.add(mesh);
          break;
        }
        case 'turret': place(part, this.recoil, P); break;
        case 'limbL': place(part, this.limbL!, tpl.limbPivotL!); break;
        case 'limbR': place(part, this.limbR!, tpl.limbPivotR!); break;
        case 'crank': place(part, this.crank!, tpl.crankPivot!); break;
        case 'bolt': place(part, this.bolt!, P); break;
        case 'barrel': place(part, this.barrelSlide!, tpl.barrelPivot!); break;
        case 'string': if (!tpl.nock) place(part, this.recoil, P); break;
      }
    }
    this.yaw = initialYaw + tpl.forwardYaw;
    this.turret.rotation.y = this.yaw;
    if (tpl.kind === 'ballista') this.poseBallista(1, 1);
  }

  /** World-space muzzle (bolt tip / cannon mouth). */
  muzzle(out: THREE.Vector3) {
    const t = this.tpl;
    if (t.kind === 'cannon') {
      const local = t.muzzle.clone().sub(t.barrelPivot!);
      return this.barrelSlide!.localToWorld(out.copy(local));
    }
    // the bolt leaves from where it sat, nocked on the drawn string
    out.copy(t.muzzle).sub(t.turretPivot);
    out.z -= t.drawLen ?? 0;
    return this.recoil.localToWorld(out);
  }

  update(dt: number, s: Structure, time: number, range: number, targetDist: number, cooldown: number) {
    const t = this.tpl;
    const fresh = s.lastFire !== this.lastFire;
    if (fresh && this.lastFire !== -1) this.fire();
    this.lastFire = s.lastFire;
    this.sinceFire += dt;

    // aim: track the target while engaged, otherwise idly scan the approach
    const engaged = s.targetId >= 0 || time - s.lastFire < 2.5;
    const want = engaged ? s.aim : s.aim + Math.sin(time * 0.35 + this.idlePhase) * 0.7;
    const cur = this.yaw - t.forwardYaw;
    const diff = wrap(want - cur);
    const maxTurn = (t.kind === 'cannon' ? 2.6 : 4.5) * dt * (engaged ? 1 : 0.35);
    this.yaw += THREE.MathUtils.clamp(diff * Math.min(1, dt * 10), -maxTurn, maxTurn);
    this.turret.rotation.y = this.yaw;

    // recoil springs
    const kz = this.kickZ.step(0, dt), kp = this.kickP.step(0, dt);
    this.recoil.position.set(0, 0, 0);
    this.recoil.rotation.set(0, 0, 0);
    if (t.kind === 'ballista') {
      this.recoil.position.z = -kz;                 // slides back along -forward (+z is forward)
      this.recoil.rotation.x = -kp;                 // nose kicks up
      // cycle: release (string snaps to rest, limbs quiver) -> short pause -> the winch hauls the
      // string back -> a fresh bolt is lowered into the groove, nocked and ready
      const C = Math.max(0.25, cooldown);
      const pause = Math.min(0.1, C * 0.15), pull = Math.max(0.12, C * 0.5), load = Math.max(0.06, C * 0.18);
      const st = this.sinceFire;
      const target = st < pause ? 0 : easeInOut(clamp01((st - pause) / pull));
      const prev = this.draw.x;
      const d = this.draw.step(target, dt);
      if (st >= pause && d > prev) this.crank!.rotation.x -= (d - prev) * Math.PI * 6;   // ratchet: winds one way only
      const lt = clamp01((st - pause - pull) / load);
      this.poseBallista(d, st > 50 ? 1 : st > pause + pull ? lt : 0);
    } else {
      // heavier carriage: slide back along the aim and rock
      this.recoil.position.x = kz;                  // forward is -x
      this.recoil.rotation.z = -kp * 0.6;
      const elev = THREE.MathUtils.clamp((targetDist - 2) / Math.max(1, range - 2), 0, 1);
      const p = this.pitch.step(engaged ? THREE.MathUtils.lerp(0.12, -0.14, elev) : 0.04, dt);
      this.barrelPivot!.rotation.z = p - this.kickP.x * 0.8;
      const sl = this.slide.step(0, dt);
      this.barrelSlide!.position.copy(t.barrelAxis!).multiplyScalar(-sl);
    }
  }

  /** d: 1 = drawn, 0 = rest (may overshoot below 0 on release). load: 0 = no bolt, 1 = bolt seated. */
  private poseBallista(d: number, load: number) {
    const t = this.tpl, P = t.turretPivot, H = t.height;
    const th = d * DRAW_ANGLE;
    this.limbL!.rotation.y = -th;                   // tips swing back (-z) and in
    this.limbR!.rotation.y = th;
    const pull = Math.max(-0.1, d) * (t.drawLen ?? 0);
    const b = this.bolt!;
    b.visible = load > 0;
    b.position.set(0, (1 - easeOut(load)) * 0.09 * H, -pull);
    b.rotation.x = (1 - easeOut(load)) * 0.1;       // lowered in nose-first
    if (!t.nock || this.strings.length < 2) return;
    const tip = (tp: THREE.Vector3, pivot: THREE.Vector3, ang: number, out: THREE.Vector3) =>
      out.copy(tp).sub(pivot).applyAxisAngle(Y_AXIS, ang).add(pivot).sub(P);
    tip(t.stringTipL!, t.limbPivotL!, -th, this.tmpA);
    tip(t.stringTipR!, t.limbPivotR!, th, this.tmpB);
    const n = this.tmpN.copy(t.nock).sub(P);
    n.z -= pull;
    this.segment(this.strings[0], this.tmpA, n);
    this.segment(this.strings[1], n, this.tmpB);
  }

  private segment(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(Y_AXIS, dir.divideScalar(Math.max(1e-6, len)));
    const r = this.tpl.height * 0.0075;
    m.scale.set(r, len, r);
  }

  private fire() {
    this.sinceFire = 0;
    if (this.tpl.kind === 'ballista') {
      this.draw.v -= 6;                     // string lets go: limbs whip forward past rest and quiver
      this.kickZ.v += 1.4 * (this.tpl.height / 2); this.kickP.v += 1.6;
      this.bolt!.visible = false;
    } else {
      this.slide.x = 0.26 * this.tpl.height / 2; this.slide.v = 0;   // barrel slams back...
      this.kickZ.v += 1.8; this.kickP.v += 1.2;
    }
  }
}

// ------------------------------------------------------------------ simple part rigs
// Other towers get one moving part: everything above a height cut (optionally within a radius
// of the tower axis) is split off and animated: floating crystals bob and spin, water orbs
// swirl, tentacled tops sway, the vine trap's maw snaps, solar panels track the sun.

export type PartMotion = 'float' | 'spin' | 'sway' | 'chomp' | 'track';
export interface PartRigConfig { split: number; motion: PartMotion; maxR?: number; amp?: number; spin?: number }

export const PART_RIGS: Record<string, PartRigConfig> = {
  pylon: { split: 0.8, motion: 'float', amp: 0.05, spin: 0.9 },
  ley_obelisk: { split: 0.74, motion: 'float', amp: 0.06, spin: 0.5 },
  lich_tower: { split: 0.8, motion: 'float', amp: 0.04, spin: 0.6, maxR: 0.25 },
  tesla_coil: { split: 0.84, motion: 'float', amp: 0.025, spin: 0.35, maxR: 0.3 },
  tsunami_tower: { split: 0.66, motion: 'spin', spin: 1.1, maxR: 0.4 },
  dark_tower: { split: 0.6, motion: 'sway', amp: 0.07 },
  swarm_tower: { split: 0.8, motion: 'sway', amp: 0.04 },
  vine_trap: { split: 0.36, motion: 'chomp', amp: 0.06 },
  solar_panel: { split: 0.42, motion: 'track' },
};

interface PartTemplate { base: PartGeo[]; top: PartGeo[]; pivot: THREE.Vector3; height: number }
const partCache = new Map<string, PartTemplate | null>();

function buildPart(template: THREE.Object3D, cfg: PartRigConfig): PartTemplate | null {
  const meshes = collect(template);
  if (!meshes.length) return null;
  let minY = Infinity, maxY = -Infinity;
  for (const m of meshes) for (let i = 1; i < m.cent.length; i += 3) { minY = Math.min(minY, m.cent[i]); maxY = Math.max(maxY, m.cent[i]); }
  const H = maxY - minY;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const m of meshes) for (let i = 0; i < m.cent.length; i += 3) {
    const y = (m.cent[i + 1] - minY) / H;
    if (y > 0.1 && y < 0.35) { x0 = Math.min(x0, m.cent[i]); x1 = Math.max(x1, m.cent[i]); z0 = Math.min(z0, m.cent[i + 2]); z1 = Math.max(z1, m.cent[i + 2]); }
  }
  const ax = (x0 + x1) / 2, az = (z0 + z1) / 2;
  const base: PartGeo[] = [], top: PartGeo[] = [];
  let n = 0;
  for (const m of meshes) {
    const lists: [number[], number[]] = [[], []];
    const tri = m.cent.length / 3;
    for (let t = 0; t < tri; t++) {
      const y = (m.cent[t * 3 + 1] - minY) / H;
      const r = Math.hypot(m.cent[t * 3] - ax, m.cent[t * 3 + 2] - az) / H;
      const isTop = y > cfg.split && r < (cfg.maxR ?? 9);
      lists[isTop ? 1 : 0].push(m.index[t * 3], m.index[t * 3 + 1], m.index[t * 3 + 2]);
      if (isTop) n++;
    }
    lists.forEach((list, k) => {
      if (!list.length) return;
      const g = new THREE.BufferGeometry();
      for (const [key, a] of Object.entries(m.mesh.geometry.attributes)) g.setAttribute(key, a);
      g.setIndex(list);
      g.boundingSphere = m.mesh.geometry.boundingSphere?.clone() ?? null;
      if (!g.boundingSphere) g.computeBoundingSphere();
      (k ? top : base).push({ name: k ? 'turret' : 'base', geometry: g, material: m.mesh.material, matrix: m.M });
    });
  }
  if (!n) return null;
  return { base, top, pivot: new THREE.Vector3(ax, minY + cfg.split * H, az), height: H };
}

export function partTemplate(id: string, template: THREE.Object3D, procedural: boolean): PartTemplate | null {
  const cfg = PART_RIGS[id];
  if (!cfg || procedural) return null;
  if (!partCache.has(id)) partCache.set(id, buildPart(template, cfg));
  return partCache.get(id)!;
}

export class PartRig {
  root = new THREE.Group();
  private top = new THREE.Group();
  private lastFire = -1;
  private pulse = new Spring(0, 220, 12);
  private phase = Math.random() * 10;
  private aimYaw = Math.random() * 6;

  constructor(private tpl: PartTemplate, private cfg: PartRigConfig, explode = 0) {
    for (const p of tpl.base) {
      const mesh = new THREE.Mesh(p.geometry, p.material);
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(p.matrix);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    this.top.position.copy(tpl.pivot);
    this.top.position.y += explode;
    for (const p of tpl.top) {
      const mesh = new THREE.Mesh(p.geometry, p.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(new THREE.Matrix4().makeTranslation(-tpl.pivot.x, -tpl.pivot.y, -tpl.pivot.z).multiply(p.matrix));
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.top.add(mesh);
    }
    this.root.add(this.top);
  }

  update(dt: number, s: Structure, time: number, sunDir?: THREE.Vector3) {
    if (s.lastFire !== this.lastFire) { if (this.lastFire !== -1) this.pulse.v += 3.5; this.lastFire = s.lastFire; }
    const p = this.pulse.step(0, dt);
    const c = this.cfg, t = time + this.phase, H = this.tpl.height, amp = (c.amp ?? 0.04) * H;
    const top = this.top;
    const y0 = this.tpl.pivot.y;
    switch (c.motion) {
      case 'float':
        top.position.y = y0 + (Math.sin(t * 1.6) * 0.5 + 0.5) * amp + p * 0.04 * H;
        top.rotation.y += dt * (c.spin ?? 0.6) * (1 + p * 3);
        top.scale.setScalar(1 + p * 0.08);
        break;
      case 'spin':
        top.rotation.y += dt * (c.spin ?? 1) * (1 + p * 2);
        top.position.y = y0 + Math.sin(t * 1.2) * 0.01 * H;
        top.scale.setScalar(1 + p * 0.06);
        break;
      case 'sway':
        top.rotation.x = Math.sin(t * 0.9) * (c.amp ?? 0.05) + p * 0.05;
        top.rotation.z = Math.sin(t * 0.7 + 1.3) * (c.amp ?? 0.05);
        break;
      case 'chomp':
        // a hungry plant: idle sway, and a lunge-and-snap when it bites
        top.rotation.x = Math.sin(t * 1.1) * (c.amp ?? 0.05) - p * 0.25;
        top.rotation.z = Math.sin(t * 0.8 + 2) * (c.amp ?? 0.05) * 0.7;
        top.scale.set(1 + p * 0.06, 1 - p * 0.12, 1 + p * 0.06);
        break;
      case 'track': {
        // panels turn toward the sun (slowly), and droop at night
        if (sunDir && sunDir.y > 0.05) this.aimYaw += Math.atan2(Math.sin(Math.atan2(sunDir.x, sunDir.z) - this.aimYaw), Math.cos(Math.atan2(sunDir.x, sunDir.z) - this.aimYaw)) * Math.min(1, dt * 0.4);
        top.rotation.y = this.aimYaw - (this.root.parent?.rotation.y ?? 0);
        top.rotation.x = sunDir ? THREE.MathUtils.lerp(top.rotation.x, sunDir.y > 0.05 ? -(Math.PI / 2 - Math.asin(Math.min(1, sunDir.y))) * 0.35 : 0.25, Math.min(1, dt)) : 0;
        break;
      }
    }
  }
}
