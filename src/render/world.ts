// Scene, camera, lighting, sky and post-processing. Lighting follows the simulation's
// day/night cycle and weather.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Environment } from '../game/env';
import { W, H } from '../game/grid';

export interface Quality { shadows: boolean; bloom: boolean; pixelRatio: number; ao?: boolean; tiltShift?: boolean }

/** Toggles object visibility between composer passes (e.g. keep foliage out of the AO pass). */
class VisibilityPass extends Pass {
  constructor(private list: () => THREE.Object3D[], private show: boolean) { super(); this.needsSwap = false; }
  render() {
    for (const o of this.list()) {
      if (this.show) { if (o.userData.aoHidden) { o.visible = true; o.userData.aoHidden = false; } }
      else if (o.visible) { o.visible = false; o.userData.aoHidden = true; }
    }
  }
}

const lerpC = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);

// Palette keyframes over the day (t = fraction of day)
const KEYS: { t: number; sun: number; sunI: number; sky: number; hor: number; hemiS: number; hemiG: number; hemiI: number; fog: number }[] = [
  { t: 0.0, sun: 0xffa56b, sunI: 1.2, sky: 0x5b77b8, hor: 0xffb98a, hemiS: 0x8fa3d6, hemiG: 0x4a3a2a, hemiI: 0.8, fog: 0xc9a58f },
  { t: 0.08, sun: 0xfff1d6, sunI: 3.4, sky: 0x3f86e0, hor: 0xcfe8ff, hemiS: 0x9dc0f5, hemiG: 0x4a3c24, hemiI: 0.85, fog: 0xa9c9e8 },
  { t: 0.45, sun: 0xfff4de, sunI: 3.5, sky: 0x3a82de, hor: 0xcde6ff, hemiS: 0x9dc0f5, hemiG: 0x4a3c24, hemiI: 0.85, fog: 0xa9c9e8 },
  { t: 0.55, sun: 0xff8f4a, sunI: 1.6, sky: 0x4a5ea6, hor: 0xff9a6a, hemiS: 0x9d8fc6, hemiG: 0x4a3222, hemiI: 0.8, fog: 0xc98f7a },
  { t: 0.62, sun: 0x8fa5ff, sunI: 0.95, sky: 0x0e1b3d, hor: 0x2e4680, hemiS: 0x5f76c0, hemiG: 0x22223a, hemiI: 0.85, fog: 0x22325a },
  { t: 0.94, sun: 0x8fa5ff, sunI: 0.95, sky: 0x0e1b3d, hor: 0x2e4680, hemiS: 0x5f76c0, hemiG: 0x22223a, hemiI: 0.85, fog: 0x22325a },
  { t: 1.0, sun: 0xffa56b, sunI: 1.2, sky: 0x5b77b8, hor: 0xffb98a, hemiS: 0x8fa3d6, hemiG: 0x4a3a2a, hemiI: 0.8, fog: 0xc9a58f },
];

function sampleKeys(t: number) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t < t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const u = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
  const s = u * u * (3 - 2 * u);
  const C = (x: number, y: number) => lerpC(new THREE.Color(x), new THREE.Color(y), s);
  return {
    sun: C(a.sun, b.sun), sunI: a.sunI + (b.sunI - a.sunI) * s, sky: C(a.sky, b.sky), hor: C(a.hor, b.hor),
    hemiS: C(a.hemiS, b.hemiS), hemiG: C(a.hemiG, b.hemiG), hemiI: a.hemiI + (b.hemiI - a.hemiI) * s, fog: C(a.fog, b.fog),
  };
}

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  gtao: GTAOPass;
  private aoPasses: Pass[] = [];
  /** Objects kept out of the AO normal/depth pass (GPU-displaced foliage, particles, sky...). */
  aoExclude: THREE.Object3D[] = [];
  aoExcludeFn: () => THREE.Object3D[] = () => this.aoExclude;
  grade: ShaderPass;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
  sky: THREE.Mesh;
  skyUniforms: Record<string, THREE.IUniform>;
  fog: THREE.FogExp2;
  flash = 0;
  sunDir = new THREE.Vector3();
  nightness = 0;
  wetness = 0;

  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envUniforms = {
    uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
  };
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envT = 0;

  // camera rig
  target = new THREE.Vector3(W / 2, 0, H / 2 + 2);
  goal = new THREE.Vector3(W / 2, 0, H / 2 + 2);
  dist = 38; goalDist = 38;
  yaw = 0; goalYaw = 0;
  /** Test-only camera override (set from `__pt.world.debugCam`): fixed eye / look-at / fov. */
  debugCam: { eye: THREE.Vector3Like; look: THREE.Vector3Like; fov?: number } | null = null;
  shake = 0;

  constructor(public canvas: HTMLCanvasElement, public quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.5, 400);
    this.fog = new THREE.FogExp2(0xb7d4ee, 0.006);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xa9ccff, 0x5a4a2e, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -44; sc.right = 44; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 200;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0x9fb6ff, 0.35);
    this.fill.position.set(-30, 40, -20);
    this.scene.add(this.fill);

    // sky dome
    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x3f86e0) }, uHorizon: { value: new THREE.Color(0xcfe8ff) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uNight: { value: 0 }, uTime: { value: 0 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyUniforms,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uHorizon, uSunDir, uSunColor; uniform float uNight, uTime; varying vec3 vDir;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){
          float y = clamp(vDir.y, -0.1, 1.0);
          vec3 c = mix(uHorizon, uTop, pow(max(y, 0.0), 0.55));
          float sd = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          c += uSunColor * (pow(sd, 400.0) * 3.0 + pow(sd, 12.0) * 0.25) * (1.0 - uNight * 0.6);
          vec3 sp = floor(vDir * 180.0);
          float star = step(0.9965, h(sp)) * uNight * smoothstep(0.05, 0.4, y) * (0.6 + 0.4 * sin(uTime * 2.0 + h(sp) * 30.0));
          c += vec3(star);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // environment for PBR reflections (gold trim, crystals, wet ground, water)
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: this.envUniforms,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uHorizon, uGround, uSunDir, uSunColor; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 c = d.y > 0.0 ? mix(uHorizon, uTop, pow(d.y, 0.5)) : mix(uHorizon * 0.6 + uGround * 0.4, uGround, pow(-d.y, 0.35));
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          c += uSunColor * (pow(sd, 90.0) * 6.0 + pow(sd, 6.0) * 0.35);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })));

    // post
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Guard against stray NaN/Inf pixels (half-float overflow, pow() edge cases): bloom would
    // smear a single bad pixel across the whole frame.
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = clamp(c, 0.0, 48.0);
        }`,
    }));
    // ambient occlusion: contact shadows where walls, towers and runners meet the ground
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
    const hide = new VisibilityPass(() => this.aoExcludeFn(), false), show = new VisibilityPass(() => this.aoExcludeFn(), true);
    this.gtao.enabled = hide.enabled = show.enabled = quality.ao !== false;
    this.aoPasses = [hide, this.gtao, show];
    this.composer.addPass(hide);
    this.composer.addPass(this.gtao);
    this.composer.addPass(show);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.55, 0.92);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null }, uSat: { value: 1.12 }, uVignette: { value: 0.32 }, uFlash: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(size.x, size.y) },
        uTilt: { value: quality.tiltShift !== false ? 1 : 0 }, uTiltAmount: { value: 6 }, uTiltBand: { value: 0.16 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uSat, uVignette, uFlash, uTime, uTilt, uTiltAmount, uTiltBand; uniform vec2 uRes; varying vec2 vUv;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          // tilt-shift: a sharp band through the middle, blur growing toward the far (top) edge and a
          // little toward the near edge. One 16-tap disc with a per-pixel spin (the grain hides the dither).
          float ty = vUv.y - 0.5;
          float tt = ty > 0.0 ? smoothstep(uTiltBand, 0.5, ty) : smoothstep(uTiltBand * 1.3, 0.55, -ty) * 0.7;
          float tr = uTilt * uTiltAmount * tt * tt;
          if (tr > 0.5) {
            float spin = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2832;
            vec3 acc = c.rgb;
            for (int i = 0; i < 16; i++) {
              float fi = float(i) + 0.5;
              float a = fi * 2.39996 + spin;
              acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * sqrt(fi / 16.0) * tr / uRes).rgb;
            }
            c.rgb = acc / 17.0;
          }
          float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          c.rgb = mix(vec3(l), c.rgb, uSat);
          // gentle split tone: cool shadows, warm highlights
          c.rgb *= mix(vec3(0.96, 0.99, 1.05), vec3(1.035, 1.0, 0.955), smoothstep(0.08, 0.75, l));
          // fine grain (also dithers banding in the sky, fog and mist gradients)
          c.rgb += (gh(floor(vUv * uRes) + fract(uTime) * 91.7) - 0.5) * 0.014;
          vec2 d = vUv - 0.5;
          c.rgb *= 1.0 - uVignette * dot(d, d) * 1.8;
          c.rgb += vec3(0.75, 0.85, 1.0) * uFlash;
          gl_FragColor = c;
        }`,
    });
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize());
    this.updateCamera(0);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.renderer.getDrawingBufferSize(this.grade.uniforms.uRes.value as THREE.Vector2);
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    this.bloom.enabled = q.bloom;
    for (const p of this.aoPasses) p.enabled = q.ao !== false;
    this.grade.uniforms.uTilt.value = q.tiltShift !== false ? 1 : 0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.resize();
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  }

  /** Clamp and ease the RTS camera. */
  updateCamera(dt: number) {
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -4, W + 4);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, 0, H + 10);
    this.goalDist = THREE.MathUtils.clamp(this.goalDist, 12, 64);
    const k = dt ? 1 - Math.exp(-dt * 9) : 1;
    this.target.lerp(this.goal, k);
    this.dist += (this.goalDist - this.dist) * k;
    this.yaw += (this.goalYaw - this.yaw) * k;
    // closer = flatter angle, like WC3
    const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.mapLinear(this.dist, 12, 64, 44, 60));
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch)).multiplyScalar(this.dist);
    this.camera.position.copy(this.target).add(off);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.target.x, this.target.y + 0.5, this.target.z);
    // stronger miniature look as you zoom out; scaled to the render resolution
    const zoomT = THREE.MathUtils.clamp((this.dist - 12) / 52, 0, 1);
    const px = this.renderer.getPixelRatio() * (window.innerHeight / 1000);
    this.grade.uniforms.uTiltAmount.value = (5 + zoomT * 3.5) * px;
    this.grade.uniforms.uTiltBand.value = 0.17 - zoomT * 0.04;
    const dc = this.debugCam;
    if (dc) { this.camera.position.copy(dc.eye); this.camera.lookAt(dc.look.x, dc.look.y, dc.look.z); }
    const fov = dc?.fov ?? 36;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.sky.position.copy(this.camera.position);
  }

  /** Apply time of day + weather. */
  updateLighting(env: Environment, dt: number) {
    const k = sampleKeys(env.time);
    const w = env.weather;
    const overcast = w === 'cloudy' ? 0.45 : w === 'rain' ? 0.7 : w === 'storm' ? 0.85 : w === 'fog' ? 0.5 : 0;
    const blend = env.weatherBlend;
    const prevOver = env.prevWeather === 'cloudy' ? 0.45 : env.prevWeather === 'rain' ? 0.7 : env.prevWeather === 'storm' ? 0.85 : env.prevWeather === 'fog' ? 0.5 : 0;
    const over = prevOver + (overcast - prevOver) * blend;
    const gray = new THREE.Color(0x8a93a3);

    // sun travels east -> west over the day; the moon takes over at night
    const night = THREE.MathUtils.smoothstep(env.time, 0.55, 0.64) * (1 - THREE.MathUtils.smoothstep(env.time, 0.93, 0.99));
    this.nightness = night;
    const dayT = THREE.MathUtils.clamp(env.time / 0.6, 0, 1);
    const ang = THREE.MathUtils.lerp(0.25, Math.PI - 0.25, dayT);
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang) * 0.85 + 0.25, 0.45).normalize();
    const moonDir = new THREE.Vector3(-0.35, 0.85, 0.4).normalize();
    this.sunDir.copy(sunDir).lerp(moonDir, night).normalize();
    const center = new THREE.Vector3(W / 2, 0, H / 2);
    this.sun.position.copy(center).addScaledVector(this.sunDir, 80);
    this.sun.target.position.copy(center);
    this.sun.color.copy(k.sun).lerp(gray, over * 0.6);
    this.sun.intensity = k.sunI * (1 - over * 0.65) + this.flash * 4;
    this.hemi.color.copy(k.hemiS).lerp(gray, over * 0.5);
    this.hemi.groundColor.copy(k.hemiG);
    this.hemi.intensity = k.hemiI * (1 - over * 0.25) + this.flash * 2.5;
    this.fill.intensity = 0.35 * (1 - night * 0.5);

    const skyTop = k.sky.clone().lerp(new THREE.Color(0x59616e).multiplyScalar(1 - night * 0.8), over * 0.8);
    const skyHor = k.hor.clone().lerp(new THREE.Color(0x9aa3ae).multiplyScalar(1 - night * 0.8), over * 0.8);
    (this.skyUniforms.uTop.value as THREE.Color).copy(skyTop);
    (this.skyUniforms.uHorizon.value as THREE.Color).copy(skyHor);
    (this.skyUniforms.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (this.skyUniforms.uSunColor.value as THREE.Color).copy(k.sun).multiplyScalar(1 - over);
    this.skyUniforms.uNight.value = night * (1 - over * 0.8);
    this.skyUniforms.uTime.value += dt;

    // fog weather keeps the distance haze moderate; the ground-hugging banks (atmosphere.ts) do the rest
    const fogBase = w === 'fog' ? 0.012 : w === 'rain' || w === 'storm' ? 0.011 : 0.0032;
    const prevFog = env.prevWeather === 'fog' ? 0.012 : env.prevWeather === 'rain' || env.prevWeather === 'storm' ? 0.011 : 0.0032;
    this.fog.density = prevFog + (fogBase - prevFog) * blend;
    this.fog.color.copy(k.fog).lerp(skyHor, 0.4).lerp(gray.clone().multiplyScalar(1 - night * 0.75), over * 0.6);

    this.bloom.strength = 0.5 + night * 0.45 + over * 0.1;
    this.bloom.threshold = 0.92 - night * 0.25;
    this.renderer.toneMappingExposure = 1.0 + night * 0.25;
    this.grade.uniforms.uSat.value = 1.2 - over * 0.25;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.grade.uniforms.uFlash.value = this.flash * 0.25;
    this.grade.uniforms.uTime.value += dt;

    // refresh the reflection environment every so often as the sky changes
    this.envT -= dt;
    if (this.envT <= 0) {
      this.envT = 1.5;
      const eu = this.envUniforms;
      eu.uTop.value.copy(skyTop);
      eu.uHorizon.value.copy(skyHor);
      eu.uGround.value.copy(k.hemiG).lerp(new THREE.Color(0x3a5a22), 0.5).multiplyScalar(0.6 * (1 - night * 0.7));
      eu.uSunDir.value.copy(this.sunDir);
      eu.uSunColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity / 3.5);
      const rt = this.pmrem.fromScene(this.envScene, 0.015);
      this.scene.environment = rt.texture;
      this.envRT?.dispose();
      this.envRT = rt;
    }
    this.scene.environmentIntensity = 0.55 - night * 0.25 - over * 0.15;
    this.hemi.intensity *= 0.72;

    const targetWet = w === 'rain' ? 0.6 : w === 'storm' ? 0.85 : 0;
    this.wetness += (targetWet - this.wetness) * Math.min(1, dt * 0.15);
  }

  render() {
    this.composer.render();
  }
}
