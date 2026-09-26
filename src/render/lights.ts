// Dynamic light pool. Power arcs, bolts, projectiles, impacts, spells and fires all *request*
// light every frame; the pool hands a fixed set of PointLights (fixed so shaders never
// recompile) to the most important requests near the camera focus. One extra light casts
// real-time cube shadows and follows the brightest shadow-worthy source (a crackling power
// arc or a storm strike), so towers and runners throw flickering shadows across the grass.

import * as THREE from 'three';

export interface LightReq {
  x: number; y: number; z: number;
  color: THREE.Color;
  intensity: number;
  distance: number;
  shadow?: boolean;
}

interface Flash extends LightReq { t: number; dur: number }

const tmp = new THREE.Vector3();

export class LightPool {
  group = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  private shadowLight: THREE.PointLight;
  private reqs: LightReq[] = [];
  private flashes: Flash[] = [];
  private shadowSmooth = new THREE.Vector3();
  private shadowOn = 0;
  private shadowT = 0;
  shadowsEnabled = true;

  constructor(count = 14) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
    this.shadowLight = new THREE.PointLight(0x9fd0ff, 0, 10, 2);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(512, 512);
    this.shadowLight.shadow.camera.near = 0.15;
    this.shadowLight.shadow.camera.far = 14;
    this.shadowLight.shadow.bias = -0.004;
    this.shadowLight.shadow.normalBias = 0.04;
    this.shadowLight.shadow.radius = 2;
    this.shadowLight.shadow.autoUpdate = false;
    // the cube shadow map must exist before the first lit draw, or its samplerCubeShadow falls
    // back to a 2D texture unit and every lit material fails with INVALID_OPERATION
    this.shadowLight.shadow.needsUpdate = true;
    this.group.add(this.shadowLight);
  }

  request(r: LightReq) { if (r.intensity > 0.05) this.reqs.push(r); }

  /** A short-lived light (impacts, lightning, spell bursts). */
  flash(x: number, y: number, z: number, color: number | THREE.Color, intensity: number, distance: number, dur: number, shadow = false) {
    this.flashes.push({ x, y, z, color: color instanceof THREE.Color ? color : new THREE.Color(color), intensity, distance, dur, t: 0, shadow });
  }

  update(dt: number, focus: THREE.Vector3) {
    for (const f of this.flashes) {
      f.t += dt;
      const u = f.t / f.dur;
      if (u < 1) this.reqs.push({ ...f, intensity: f.intensity * (1 - u) * (1 - u) });
    }
    this.flashes = this.flashes.filter((f) => f.t < f.dur);

    const score = (r: LightReq) => {
      const d = Math.hypot(r.x - focus.x, r.z - focus.z);
      return r.intensity * (r.distance * 0.25 + 1) / (1 + (d / 22) * (d / 22));
    };
    this.reqs.sort((a, b) => score(b) - score(a));

    // shadow light: brightest shadow-worthy request near the focus
    const sh = this.shadowsEnabled ? this.reqs.find((r) => r.shadow && Math.hypot(r.x - focus.x, r.z - focus.z) < 30) : undefined;
    if (sh) {
      tmp.set(sh.x, sh.y, sh.z);
      if (this.shadowOn < 0.01) this.shadowSmooth.copy(tmp); else this.shadowSmooth.lerp(tmp, Math.min(1, dt * 20));
      this.shadowOn = Math.min(1, this.shadowOn + dt * 6);
      this.shadowLight.position.copy(this.shadowSmooth);
      this.shadowLight.color.copy(sh.color);
      this.shadowLight.intensity = sh.intensity * 1.2 * this.shadowOn;
      this.shadowLight.distance = sh.distance * 1.3;
      this.shadowLight.shadow.camera.far = Math.max(4, sh.distance * 1.3);
      // six cube faces are expensive: refresh at ~30 Hz (arcs re-jitter every 45-90 ms anyway)
      this.shadowT -= dt;
      if (this.shadowT <= 0) { this.shadowT = 1 / 30; this.shadowLight.shadow.needsUpdate = true; }
    } else {
      this.shadowOn = Math.max(0, this.shadowOn - dt * 4);
      this.shadowLight.intensity *= this.shadowOn;
      this.shadowT -= dt;
      if (this.shadowOn > 0 && this.shadowT <= 0) { this.shadowT = 1 / 30; this.shadowLight.shadow.needsUpdate = true; }
    }

    let i = 0;
    for (const r of this.reqs) {
      if (i >= this.lights.length) break;
      if (r === sh) continue;
      const l = this.lights[i++];
      l.position.set(r.x, r.y, r.z);
      l.color.copy(r.color);
      l.intensity = r.intensity;
      l.distance = r.distance;
    }
    for (; i < this.lights.length; i++) this.lights[i].intensity = 0;
    this.reqs.length = 0;
  }
}
