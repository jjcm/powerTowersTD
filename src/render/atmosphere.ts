// Ambient atmosphere, all cheap and GPU-animated:
// - a cloud deck that drifts in as you zoom out. It uses the terrain's cloud-shadow noise,
//   shifted along the sun, so every cloud sits over its own shadow.
// - low mist pooling over ponds and hollows at dawn, at night and in fog. Its density comes
//   from the terrain height field, so it never shows a hard edge.
// - fireflies at night and pollen motes catching the sun by day.
// - the odd flock of birds crossing below the clouds, casting little shadows.

import * as THREE from 'three';
import { W, H } from '../game/grid';
import { WATER_LEVEL } from '../game/map';
import type { Weather } from '../game/env';
import { TERRAIN_SIZE, type TerrainView } from './terrain';

const { TW, TH, RES, BORDER } = TERRAIN_SIZE;
export const CLOUD_Y = 20;
const MIST_TOP = 0.04;         // the meadow sits around -0.05: mist collects in hollows and over ponds
const FOG_TOP = 0.65;          // fog weather: banks deep enough to swallow walls

/** Same value noise / fbm as the terrain shader (the cloud deck must match its shadows). */
const NOISE = /* glsl */`
  float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float tnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(th(i),th(i+vec2(1,0)),u.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),u.x), u.y); }
  float tfbm(vec2 p){ return tnoise(p)*0.5 + tnoise(p*2.03+7.1)*0.25 + tnoise(p*4.01-3.3)*0.125 + 0.0625; }
`;

const COVER: Record<Weather, number> = { clear: 0.48, cloudy: 0.42, rain: 0.37, storm: 0.32, fog: 0.5 };
const MIST: Record<Weather, number> = { clear: 0, cloudy: 0, rain: 0.3, storm: 0.2, fog: 0.8 };

export interface AtmosFrame {
  dt: number;
  time: number;            // shared shader clock (terrain uTime)
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyColor: THREE.Color;
  fogColor: THREE.Color;
  nightness: number;
  dayTime: number;         // 0..1, 0 = dawn
  weather: Weather; prevWeather: Weather; blend: number;
  wind: number;
  bufferSize: THREE.Vector2;
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export class Atmosphere {
  group = new THREE.Group();
  clouds: THREE.Mesh;
  mist: THREE.Mesh;
  motes: THREE.Points;
  birds: THREE.InstancedMesh;
  /** Cloud-cover threshold shared with the terrain's shadow term. */
  cover = COVER.clear;
  private cu: Record<string, THREE.IUniform>;
  private mu: Record<string, THREE.IUniform>;
  private pu: Record<string, THREE.IUniform>;
  private bu = { uTime: { value: 0 } };
  private flock = { active: false, t: 0, wait: 12 + Math.random() * 20, dur: 1, from: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 4, curve: 0, y: 13 };
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3(); private s = new THREE.Vector3(1, 1, 1); private white = new THREE.Color(1, 1, 1); private mistTint = new THREE.Color(0.86, 0.91, 1.0); private cloudGray = new THREE.Color(0.62, 0.66, 0.74);

  constructor(terrain: TerrainView, treeSpots: { x: number; z: number }[], isWater: (x: number, z: number) => boolean) {
    // ---------------- cloud deck
    this.cu = {
      uTime: { value: 0 }, uCover: { value: this.cover }, uOpacity: { value: 0 }, uY: { value: CLOUD_Y },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() },
      uRes: { value: new THREE.Vector2(1, 1) }, uCam: { value: new THREE.Vector3() },
    };
    const cloudGeo = new THREE.PlaneGeometry(420, 420);
    cloudGeo.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(cloudGeo, new THREE.ShaderMaterial({
      uniforms: this.cu, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vWPos; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        ${NOISE}
        uniform float uTime, uCover, uOpacity, uY; uniform vec3 uSunDir, uLit, uShade, uCam; uniform vec2 uRes;
        varying vec3 vWPos;
        float field(vec2 q){ return tfbm(q * 0.032 + uTime * vec2(0.011, 0.005)); }
        void main(){
          // the shadow of the cloud above q lands at q - sun.xz / sun.y * height
          vec2 q = vWPos.xz - uSunDir.xz / max(uSunDir.y, 0.2) * uY;
          float base = field(q);
          if (base < uCover - 0.075) discard;   // detail can lift it by 0.07 at most: open sky, skip the rest
          float det = tnoise(q * 0.19 + uTime * vec2(0.03, 0.012)) * 0.6 + tnoise(q * 0.47 - uTime * vec2(0.02, 0.04)) * 0.4;
          float f = base + (det - 0.5) * 0.14;
          float d = smoothstep(uCover, uCover + 0.11, f);
          if (d < 0.004) discard;
          // self-shading: the side facing away from the sun is where the cloud keeps going
          vec2 toSun = normalize(uSunDir.xz + vec2(1e-4));
          float fs = field(q + toSun * 2.5) + (det - 0.5) * 0.14;
          float lit = clamp(0.62 + (f - fs) * 6.0, 0.0, 1.0);
          float core = smoothstep(uCover + 0.05, uCover + 0.3, f);
          vec3 col = mix(uShade, uLit, lit) * (1.0 - core * 0.16);
          // keep the middle of the screen readable: the deck parts around what you're looking at
          vec2 sc = gl_FragCoord.xy / uRes - 0.5; sc.x *= uRes.x / uRes.y;
          float clearing = mix(1.0, smoothstep(0.08, 0.5, length(sc)), 0.75);
          float far = 1.0 - smoothstep(110.0, 190.0, distance(vWPos.xz, uCam.xz));
          gl_FragColor = vec4(col, d * uOpacity * clearing * far);
        }`,
    }));
    this.clouds.renderOrder = 40;        // over effects, under health bars and status icons
    this.clouds.frustumCulled = false;
    this.clouds.visible = false;

    // ---------------- ground mist
    this.mu = {
      tHeight: { value: terrain.heightTex }, uHeightSize: { value: new THREE.Vector2(terrain.vw, terrain.vh) },
      uBorder: { value: BORDER }, uRes: { value: RES }, uTime: { value: 0 }, uStrength: { value: 0 },
      uCol: { value: new THREE.Color() }, uCam: { value: new THREE.Vector3() }, uTop: { value: MIST_TOP },
    };
    const mistGeo = new THREE.PlaneGeometry(TW, TH);
    mistGeo.rotateX(-Math.PI / 2);
    mistGeo.translate(TW / 2 - BORDER, 0, TH / 2 - BORDER);
    this.mist = new THREE.Mesh(mistGeo, new THREE.ShaderMaterial({
      uniforms: this.mu, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vWPos; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        ${NOISE}
        uniform sampler2D tHeight; uniform vec2 uHeightSize; uniform float uBorder, uRes, uTime, uStrength, uTop;
        uniform vec3 uCol, uCam; varying vec3 vWPos;
        void main(){
          vec2 h = ((vWPos.xz + uBorder) * uRes + 0.5) / uHeightSize;
          // open water reads as a little shallower so ponds stay blue under the mist
          float g = max(texture2D(tHeight, h).r, ${(WATER_LEVEL + 0.14).toFixed(3)});
          float thick = uTop - g;
          if (thick <= 0.0) discard;
          // path length through the layer grows as the view flattens
          vec3 v = normalize(vWPos - uCam);
          float path = thick / max(0.3, -v.y);
          // drifting banks with clear gaps between them, frayed into wisps
          float bank = smoothstep(0.44, 0.74, tfbm(vWPos.xz * 0.085 + uTime * vec2(0.022, 0.008)));
          float wisp = bank > 0.0 ? 0.45 + 1.1 * tnoise(vWPos.xz * 0.5 - uTime * vec2(0.02, 0.05)) * tnoise(vWPos.xz * 1.3 + uTime * 0.04) : 1.0;
          float dens = uStrength * (bank * 2.6 * wisp + 0.04);
          float a = (1.0 - exp(-path * dens * 1.6)) * 0.6;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uCol, a);
        }`,
    }));
    this.mist.renderOrder = 2.5;         // over the water, under the build grid / route overlay
    this.mist.visible = false;

    // ---------------- fireflies + pollen motes
    const FIRE = 240, MOTE = 320;
    const home = new Float32Array((FIRE + MOTE) * 3), seed = new Float32Array((FIRE + MOTE) * 4), kind = new Float32Array(FIRE + MOTE);
    const near = treeSpots.filter((t) => t.x > -9 && t.x < W + 9 && t.z > -9 && t.z < H + 9);
    for (let i = 0; i < FIRE + MOTE; i++) {
      let x: number, z: number, y: number;
      if (i < FIRE) {
        // fireflies hang around tree edges and pond shores
        const r = Math.random();
        if (r < 0.55 && near.length) { const t = near[(Math.random() * near.length) | 0]; x = t.x + (Math.random() - 0.5) * 3; z = t.z + (Math.random() - 0.5) * 3; }
        else {
          let tries = 0;
          do { x = -6 + Math.random() * (W + 12); z = -6 + Math.random() * (H + 12); tries++; }
          while (tries < 12 && r < 0.85 && !(isWater(x + 1.5, z) || isWater(x - 1.5, z) || isWater(x, z + 1.5) || isWater(x, z - 1.5)));
        }
        y = 0.35 + Math.random() * 1.3;
      } else {
        x = -12 + Math.random() * (W + 24); z = -10 + Math.random() * (H + 20); y = 0.3 + Math.random() * 2.6;
      }
      home.set([x, y, z], i * 3);
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      kind[i] = i < FIRE ? 0 : 1;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(home, 3));
    pg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    pg.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    this.pu = {
      tHeight: this.mu.tHeight, uHeightSize: this.mu.uHeightSize, uBorder: this.mu.uBorder, uRes: this.mu.uRes,
      uTime: { value: 0 }, uNight: { value: 0 }, uDay: { value: 1 }, uScale: { value: 800 }, uDrift: { value: 0 }, uSpan: { value: W + 24 },
      uSun: { value: new THREE.Color() },
    };
    this.motes = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: this.pu, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: /* glsl */`
        uniform sampler2D tHeight; uniform vec2 uHeightSize; uniform float uBorder, uRes;
        uniform float uTime, uNight, uDay, uScale, uDrift, uSpan; uniform vec3 uSun;
        attribute vec4 aSeed; attribute float aKind;
        varying vec3 vCol; varying float vA;
        float groundY(vec2 p){ vec2 h = ((p + uBorder) * uRes + 0.5) / uHeightSize; return textureLod(tHeight, h, 0.0).r; }
        void main(){
          vec3 p = position; float size; float t = uTime; float tau = 6.2832;
          if (aKind < 0.5) {
            // firefly: lazy loops and bobbing, slow blinks
            p.x += sin(t * (0.25 + aSeed.x * 0.2) + aSeed.y * tau) * 0.9 + sin(t * 0.9 + aSeed.z * tau) * 0.2;
            p.z += cos(t * (0.2 + aSeed.y * 0.2) + aSeed.x * tau) * 0.9;
            p.y += sin(t * 0.7 + aSeed.w * tau) * 0.22;
            float blink = smoothstep(0.45, 1.0, sin(t * (0.7 + aSeed.z * 1.1) + aSeed.w * 40.0) * 0.5 + 0.5);
            vA = uNight * (0.12 + 0.88 * blink);
            vCol = mix(vec3(0.7, 1.0, 0.25), vec3(1.0, 0.85, 0.3), aSeed.x) * 5.0;
            size = 0.07 + 0.06 * blink;
          } else {
            // pollen and dust riding the breeze, glinting when they catch the sun
            p.x = mod(position.x + 12.0 + t * (0.18 + aSeed.x * 0.25) * uDrift, uSpan) - 12.0;
            p.z += sin(t * 0.21 + aSeed.y * tau) * 0.9;
            p.y += sin(t * (0.4 + aSeed.z * 0.3) + aSeed.w * tau) * 0.35;
            float glint = 0.35 + 0.65 * pow(sin(t * (1.5 + aSeed.w * 2.0) + aSeed.x * 30.0) * 0.5 + 0.5, 6.0);
            vA = uDay * glint * 0.6;
            vCol = uSun * 1.6;
            size = 0.035 + aSeed.z * 0.02;
          }
          p.y += groundY(p.xz);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = vA < 0.01 ? 0.0 : max(1.5, size * uScale / -mv.z);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vCol * a * a * vA, 1.0);
        }`,
    }));
    this.motes.renderOrder = 5;
    this.motes.frustumCulled = false;

    // ---------------- birds
    const bg = new THREE.BufferGeometry();
    // body, tail fan and two swept wings (broad inner section, tapered outer); the shader flaps by |x|
    const wing = (sx: number) => [
      0.03 * sx, 0, 0.07, 0.17 * sx, 0, 0.06, 0.03 * sx, 0, -0.08,
      0.03 * sx, 0, -0.08, 0.17 * sx, 0, 0.06, 0.17 * sx, 0, -0.07,
      0.17 * sx, 0, 0.06, 0.34 * sx, 0.01, -0.11, 0.17 * sx, 0, -0.07,
    ];
    const P = [
      0, 0, 0.16, 0.035, 0, 0.02, -0.035, 0, 0.02,
      -0.035, 0, 0.02, 0.035, 0, 0.02, 0, 0, -0.12,
      0, 0, -0.1, 0.05, 0, -0.2, -0.05, 0, -0.2,
      ...wing(1), ...wing(-1),
    ];
    bg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const C: number[] = [];
    for (let i = 0; i < P.length / 3; i++) { const tip = Math.abs(P[i * 3]) > 0.25; C.push(...(tip ? [0.1, 0.1, 0.11] : [0.46, 0.44, 0.41])); }
    bg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    bg.computeVertexNormals();
    const N = 11;
    const phase = new Float32Array(N);
    for (let i = 0; i < N; i++) phase[i] = Math.random() * 6.28;
    bg.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const bm = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    bm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.bu.uTime;
      sh.vertexShader = 'uniform float uTime; attribute float aPhase;\n' + sh.vertexShader.replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        {
          // bursts of flapping between glides
          float flap = smoothstep(-0.2, 0.5, sin(uTime * 0.55 + aPhase * 3.0));
          float s = abs(position.x);
          transformed.y += (sin(uTime * 11.0 + aPhase) * 0.9 * flap + 0.12 * (1.0 - flap)) * s * s * 4.0;
        }`);
    };
    this.birds = new THREE.InstancedMesh(bg, bm, N);
    this.birds.castShadow = true;
    this.birds.frustumCulled = false;
    this.birds.visible = false;

    this.group.add(this.clouds, this.mist, this.motes, this.birds);
  }

  /** Objects to keep out of the AO pass. */
  get aoExclude() { return [this.clouds, this.mist, this.motes]; }

  update(f: AtmosFrame) {
    const { dt, time, camera, nightness: night } = f;
    const camY = camera.position.y;
    const wmix = (tab: Record<Weather, number>) => tab[f.prevWeather] + (tab[f.weather] - tab[f.prevWeather]) * f.blend;

    // ---- clouds
    this.cover = wmix(COVER);
    const zoomed = smooth(CLOUD_Y + 10, CLOUD_Y + 26, camY);
    const cu = this.cu;
    cu.uTime.value = time;
    cu.uCover.value = this.cover;
    cu.uOpacity.value = zoomed * (0.92 - night * 0.35) * (f.weather === 'fog' || f.prevWeather === 'fog' ? 0.75 : 1);
    (cu.uSunDir.value as THREE.Vector3).copy(f.sunDir);
    const lit = cu.uLit.value as THREE.Color, shade = cu.uShade.value as THREE.Color;
    const over = 1 - smooth(0.32, 0.58, this.cover);   // 0 = fair weather, 1 = storm deck
    lit.copy(f.sunColor).lerp(this.white, 0.6).multiplyScalar((1.2 - over * 0.4) * (1 - night * 0.8));
    shade.copy(f.skyColor).lerp(this.cloudGray, 0.55).multiplyScalar((0.85 - over * 0.3) * (1 - night * 0.8));
    (cu.uRes.value as THREE.Vector2).copy(f.bufferSize);
    (cu.uCam.value as THREE.Vector3).copy(camera.position);
    this.clouds.position.set(f.target.x, CLOUD_Y, f.target.z);
    this.clouds.visible = cu.uOpacity.value > 0.01;

    // ---- mist: thickest at dawn, lingers through the night, rolls in with fog
    const t = f.dayTime;
    const dawn = Math.max(smooth(0.86, 0.98, t), 1 - smooth(0.02, 0.16, t));
    const strength = Math.max(dawn * 0.75, night * 0.4) + wmix(MIST);
    this.mu.uTime.value = time;
    this.mu.uStrength.value = strength;
    const fogW = (f.prevWeather === 'fog' ? 1 - f.blend : 0) + (f.weather === 'fog' ? f.blend : 0);
    this.mu.uTop.value = MIST_TOP + (FOG_TOP - MIST_TOP) * fogW;
    this.mist.position.y = this.mu.uTop.value;
    const mc = this.mu.uCol.value as THREE.Color;
    mc.copy(f.fogColor).lerp(this.mistTint, 0.6 * (1 - night)).lerp(f.sunColor, 0.12 * (1 - night)).multiplyScalar(1 - night * 0.3);
    (this.mu.uCam.value as THREE.Vector3).copy(camera.position);
    this.mist.visible = strength > 0.02;

    // ---- fireflies / motes
    const pu = this.pu;
    pu.uTime.value = time;
    pu.uNight.value = smooth(0.25, 0.8, night) * (f.weather === 'rain' || f.weather === 'storm' ? 0.35 : 1);
    pu.uDay.value = (1 - night) * (f.weather === 'clear' ? 1 : 0.35);
    pu.uDrift.value = f.wind;
    (pu.uSun.value as THREE.Color).copy(f.sunColor).lerp(new THREE.Color(1, 0.95, 0.8), 0.5);
    pu.uScale.value = f.bufferSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

    // ---- birds
    this.bu.uTime.value = time;
    this.updateFlock(dt, camY, night, f.weather);
  }

  private updateFlock(dt: number, camY: number, night: number, weather: Weather) {
    const fl = this.flock;
    if (!fl.active) {
      fl.wait -= dt;
      this.birds.visible = false;
      if (fl.wait > 0 || night > 0.4 || weather === 'storm' || weather === 'rain') return;
      // cross the battlefield on a gently curving line
      const a = Math.random() * Math.PI * 2;
      fl.dir.set(Math.sin(a), 0, Math.cos(a));
      const c = new THREE.Vector3(W / 2 + (Math.random() - 0.5) * 30, 0, H / 2 + (Math.random() - 0.5) * 22);
      fl.from.copy(c).addScaledVector(fl.dir, -70);
      fl.speed = 3.4 + Math.random() * 1.6;
      fl.dur = 140 / fl.speed;
      fl.curve = (Math.random() - 0.5) * 0.012;
      fl.y = 12 + Math.random() * 3;
      fl.t = 0;
      fl.active = true;
    }
    fl.t += dt;
    if (fl.t > fl.dur) { fl.active = false; fl.wait = 45 + Math.random() * 60; return; }
    // hide them when the camera is down among them
    this.birds.visible = camY > fl.y + 5;
    const yaw0 = Math.atan2(fl.dir.x, fl.dir.z);
    // integrate the curved path analytically: heading turns at a constant rate
    const k = fl.curve * fl.speed, heading = yaw0 + k * fl.t;
    let lx: number, lz: number;
    if (Math.abs(k) < 1e-5) { lx = fl.dir.x * fl.speed * fl.t; lz = fl.dir.z * fl.speed * fl.t; }
    else { lx = (fl.speed / k) * (Math.cos(yaw0) - Math.cos(heading)); lz = (fl.speed / k) * (Math.sin(heading) - Math.sin(yaw0)); }
    const cx = fl.from.x + lx, cz = fl.from.z + lz;
    const fx = Math.sin(heading), fz = Math.cos(heading), rx = fz, rz = -fx;
    for (let i = 0; i < this.birds.count; i++) {
      // loose V: leader in front, the rest trailing on alternate sides
      const row = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
      const wob = Math.sin(fl.t * 0.7 + i * 1.7) * 0.25;
      const back = row * 1.2 + Math.sin(fl.t * 0.5 + i) * 0.2;
      const lat = side * (row * 1.1 + wob);
      this.v.set(cx + rx * lat - fx * back, fl.y + Math.sin(fl.t * 0.9 + i * 2.1) * 0.25 + (i % 3) * 0.18, cz + rz * lat - fz * back);
      this.e.set(Math.sin(fl.t * 1.3 + i) * 0.06, heading, -k * 6 + Math.sin(fl.t + i) * 0.08);
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v, this.q, this.s.setScalar(1.6 + (i % 4) * 0.1));
      this.birds.setMatrixAt(i, this.m4);
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }
}
