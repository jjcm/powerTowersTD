import * as THREE from 'three';
import type { Game } from '../game/sim';
import type { Runner } from '../game/types';
import type { Assets } from './assets';

interface View {
  r: Runner;
  group: THREE.Group;
  model: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
  walk?: THREE.AnimationAction;
  run?: THREE.AnimationAction;
  dead?: THREE.AnimationAction;
  current?: THREE.AnimationAction;
  mats: THREE.MeshStandardMaterial[];
  baseEmissive: THREE.Color[];
  shield?: THREE.Mesh;
  roots?: THREE.Mesh;
  dying: number;       // seconds since death, -1 alive
  leaked: boolean;
  x: number; z: number; y: number;
  height: number;
  bob: number;
}

export class RunnerViews {
  group = new THREE.Group();
  views = new Map<number, View>();
  private shieldGeo = new THREE.SphereGeometry(1, 20, 14);
  private rootGeo = new THREE.TorusGeometry(0.32, 0.06, 6, 14);

  constructor(private game: Game, private assets: Assets, private heightAt: (x: number, z: number) => number) {}

  private create(r: Runner): View {
    const group = new THREE.Group();
    const { object, clips, rigged } = this.assets.instantiate(r.type.model);
    const height = r.type.scale * 1.2;
    object.scale.multiplyScalar(height);
    group.add(object);
    // unique materials for hit flashes / status tints
    const mats: THREE.MeshStandardMaterial[] = [];
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const cloned = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => (x as THREE.MeshStandardMaterial).clone());
      m.material = Array.isArray(m.material) ? cloned : cloned[0];
      mats.push(...cloned);
    });
    const v: View = { r, group, model: object, mats, baseEmissive: mats.map((m) => m.emissive?.clone() ?? new THREE.Color()), dying: -1, leaked: false, x: r.x, z: r.z, y: 0, height, bob: Math.random() * 10 };
    if (rigged && clips.length) {
      v.mixer = new THREE.AnimationMixer(object);
      const find = (re: RegExp) => clips.find((c) => re.test(c.name));
      const walk = find(/walk/i) ?? clips[0];
      const run = find(/run/i);
      const dead = find(/dead|dying|death/i);
      v.walk = v.mixer.clipAction(walk);
      if (run) v.run = v.mixer.clipAction(run);
      if (dead) { v.dead = v.mixer.clipAction(dead); v.dead.setLoop(THREE.LoopOnce, 1); v.dead.clampWhenFinished = true; }
      const useRun = r.type.speed >= 3.0 && v.run;
      v.current = useRun ? v.run! : v.walk;
      v.current.play();
      v.current.time = Math.random() * v.current.getClip().duration;
    }
    if (r.type.shield) {
      v.shield = new THREE.Mesh(this.shieldGeo, new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
      v.shield.scale.set(height * 0.55, height * 0.65, height * 0.55);
      v.shield.position.y = height * 0.5;
      group.add(v.shield);
    }
    v.roots = new THREE.Mesh(this.rootGeo, new THREE.MeshStandardMaterial({ color: 0x2f7a2a, roughness: 0.8 }));
    v.roots.rotation.x = Math.PI / 2;
    v.roots.visible = false;
    group.add(v.roots);
    group.position.set(r.x, this.heightAt(r.x, r.z), r.z);
    this.group.add(group);
    return v;
  }

  onDeath(id: number) {
    const v = this.views.get(id);
    if (v && v.dying < 0) {
      v.dying = 0;
      if (v.dead && v.mixer) {
        v.current?.fadeOut(0.15);
        v.dead.reset().fadeIn(0.1).play();
      }
    }
  }
  onLeak(id: number) {
    const v = this.views.get(id);
    if (v) { v.leaked = true; v.dying = 0; }
  }

  update(dt: number) {
    const g = this.game;
    for (const r of g.runners) if (r.alive && !this.views.has(r.id)) this.views.set(r.id, this.create(r));
    const white = new THREE.Color(1, 1, 1);
    for (const [id, v] of this.views) {
      const r = v.r;
      if (v.dying >= 0 || !r.alive) {
        if (v.dying < 0) v.dying = 0; // died without an event (cleanup)
        v.dying += dt;
        v.mixer?.update(dt);
        if (v.leaked) {
          const s = Math.max(0, 1 - v.dying * 3);
          v.group.scale.setScalar(s);
          if (s <= 0) { this.group.remove(v.group); this.views.delete(id); }
          continue;
        }
        if (!v.dead) {
          // procedural topple
          v.model.rotation.x = Math.min(Math.PI / 2, v.dying * 5);
        }
        if (v.dying > 1.6) v.group.position.y -= dt * 0.6;
        const fade = Math.max(0, 1 - Math.max(0, v.dying - 1.6) / 1.2);
        for (const m of v.mats) { m.transparent = true; m.opacity = fade; }
        if (v.shield) v.shield.visible = false;
        if (v.roots) v.roots.visible = false;
        if (fade <= 0) { this.group.remove(v.group); this.views.delete(id); }
        continue;
      }
      // smooth position toward sim
      const k = 1 - Math.exp(-dt * 18);
      v.x += (r.x - v.x) * k; v.z += (r.z - v.z) * k;
      const ground = this.heightAt(v.x, v.z);
      v.bob += dt;
      const fly = r.type.flying ? 0.55 + Math.sin(v.bob * 3) * 0.12 : 0;
      v.group.position.set(v.x, ground + fly, v.z);
      v.group.rotation.y = r.heading;
      if (!v.mixer) {
        // procedural gait for unrigged creatures
        const sp = r.moving ? 1 : 0.2;
        v.model.rotation.z = Math.sin(v.bob * 9 * sp) * 0.08 * sp;
        v.model.position.y = Math.abs(Math.sin(v.bob * 9 * sp)) * 0.06 * sp;
        if (r.type.flying) v.model.rotation.x = 0.25 + Math.sin(v.bob * 2) * 0.05;
      } else {
        const speed = r.type.speed * r.speedMul;
        const want = speed > 3.0 && v.run ? v.run : v.walk!;
        if (want !== v.current) { v.current?.fadeOut(0.2); want.reset().fadeIn(0.2).play(); v.current = want; }
        const nominal = want === v.run ? 3.6 : 1.6;
        v.current!.timeScale = r.moving ? Math.max(0.3, (speed / nominal) * (1.15 / v.height) * 1.1) : 0.05;
        v.mixer.update(dt);
      }
      if (r.knock > 0) v.model.rotation.x = -r.knock * 1.2; else if (v.mixer) v.model.rotation.x = 0;
      // status tints
      const frozen = r.slowT > 0 && r.slowAmt > 0.3;
      const cursed = r.curseT > 0 || r.vulnT > 0;
      const hit = r.hitFlash;
      v.mats.forEach((m, i) => {
        if (!m.emissive) return;
        m.emissive.copy(v.baseEmissive[i]);
        if (frozen) m.emissive.lerp(new THREE.Color(0x2a6cd8), 0.28);
        if (cursed) m.emissive.lerp(new THREE.Color(0x7a2aff), 0.35);
        if (r.burnT > 0) m.emissive.lerp(new THREE.Color(0xff5a1a), 0.25 + Math.sin(v.bob * 20) * 0.1);
        if (r.poisonT > 0) m.emissive.lerp(new THREE.Color(0x4aff3a), 0.2);
        if (hit > 0) m.emissive.lerp(white, hit * 0.3);
      });
      if (v.shield) {
        v.shield.visible = r.shield > 1;
        (v.shield.material as THREE.MeshBasicMaterial).opacity = 0.08 + (r.shield / Math.max(1, r.shieldMax)) * 0.2 + (hit > 0.5 ? 0.2 : 0);
      }
      if (v.roots) { v.roots.visible = r.rootT > 0; v.roots.position.y = 0.15; v.roots.rotation.z += dt * 2; }
    }
  }

  /** Head position for bars / text. */
  headY(r: Runner) {
    return (r.type.flying ? 0.6 : 0) + r.type.scale * 1.2 + 0.35;
  }
  viewPos(id: number) { const v = this.views.get(id); return v ? v.group.position : undefined; }
}
