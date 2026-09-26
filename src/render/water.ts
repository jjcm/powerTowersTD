// Lit PBR water. Built on MeshStandardMaterial so it reflects the sky environment, the sun and
// every dynamic light (power arcs and fires shimmer across the pond at night).
// - Depth from the terrain height field drives absorption: clear turquoise over the sandy
//   shelves, teal, then deep blue in the middle.
// - Premultiplied output keeps reflections at full strength even where the water is clear.
// - Three normal layers (slow swell + two crossing ripples, one flow-warped), rain rings, and
//   foam bands that roll in toward the shore.

import * as THREE from 'three';
import { WATER_LEVEL } from '../game/map';
import { TERRAIN_SIZE, type TerrainView } from './terrain';
import type { Assets } from './assets';

const { TW, TH, BORDER, RES } = TERRAIN_SIZE;

export class WaterView {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;

  constructor(terrain: TerrainView, assets: Assets) {
    const geo = new THREE.PlaneGeometry(TW, TH, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(TW / 2 - BORDER, WATER_LEVEL, TH / 2 - BORDER);
    const nUrl = assets.manifest.textures.water?.normal;
    const normal = nUrl ? assets.texture(nUrl, false) : new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.needsUpdate = true;
    this.uniforms = {
      tWaterN: { value: normal },
      tHeight: { value: terrain.heightTex },
      uHeightSize: { value: new THREE.Vector2(terrain.vw, terrain.vh) },
      uRes: { value: RES },
      uBorder: { value: BORDER },
      uTime: { value: 0 },
      // body colours are low albedo on purpose: water scatters little light, it mostly transmits and reflects
      uDeep: { value: new THREE.Color(0x06284f) },
      uMid: { value: new THREE.Color(0x0c5a73) },
      uShallow: { value: new THREE.Color(0x1f7d78) },
      uRain: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0.0, transparent: true, depthWrite: false, envMapIntensity: 1.2, premultipliedAlpha: true });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos;
          uniform sampler2D tWaterN, tHeight;
          uniform vec2 uHeightSize; uniform float uRes, uBorder, uTime, uRain;
          uniform vec3 uDeep, uMid, uShallow;
          float wDepth; float wFoam; vec3 wN;
          float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float wnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(wh(i), wh(i + vec2(1, 0)), u.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), u.x), u.y); }`)
        .replace('#include <map_fragment>', /* glsl */`
          vec2 huv = ((vWPos.xz + uBorder) * uRes + 0.5) / uHeightSize;
          float ground = texture(tHeight, huv).r;
          wDepth = ${WATER_LEVEL.toFixed(3)} - ground;
          if (wDepth < -0.04) discard;
          vec2 uvS = vWPos.xz * 0.045 + vec2(uTime * 0.006, -uTime * 0.004);
          vec3 nS = texture(tWaterN, uvS).xyz * 2.0 - 1.0;
          vec2 uv1 = vWPos.xz * 0.11 + vec2(uTime * 0.017, uTime * 0.011) + nS.xy * 0.06;
          vec2 uv2 = vWPos.xz * 0.27 + vec2(-uTime * 0.013, uTime * 0.021);
          vec3 n1 = texture(tWaterN, uv1).xyz * 2.0 - 1.0;
          vec3 n2 = texture(tWaterN, uv2).xyz * 2.0 - 1.0;
          wN = normalize(vec3(nS.x * 0.6 + n1.x + n2.x * 0.7, 2.8 - uRain * 1.2, -(nS.y * 0.6 + n1.y + n2.y * 0.7)));
          // rain ripples
          vec2 cell = floor(vWPos.xz * 1.5);
          float rnd = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float ph = fract(uTime * 0.9 + rnd);
          float rr = length(fract(vWPos.xz * 1.5) - 0.5) * 2.0;
          float ring = uRain * (1.0 - ph) * smoothstep(0.08, 0.0, abs(rr - ph));
          wN = normalize(wN + vec3(ring * 0.7, 0.0, ring * 0.7));
          float dd = max(wDepth, 0.0);
          vec3 wcol = mix(uShallow, uMid, smoothstep(0.0, 0.3, dd));
          wcol = mix(wcol, uDeep, smoothstep(0.3, 0.8, dd));
          // lapping foam: bands rolling in toward the shore, broken up by noise
          float shoreT = clamp(wDepth / 0.2, 0.0, 1.0);
          float brk = wnoise(vWPos.xz * 2.2 + vec2(uTime * 0.15, -uTime * 0.1));
          float lapWave = sin(shoreT * 14.0 - uTime * 1.7 + brk * 3.0);
          float lap = smoothstep(0.82, 1.0, lapWave) * (1.0 - shoreT) * smoothstep(0.35, 0.65, brk);
          float edge = smoothstep(0.045, 0.0, wDepth) * (0.6 + 0.4 * brk);
          wFoam = clamp(edge + lap * 0.7, 0.0, 1.0);
          wcol = mix(wcol, vec3(0.92, 0.97, 1.0), wFoam * 0.8);
          diffuseColor.rgb = wcol;
          // absorption: clear over the shelves, opaque in the deep
          float absorb = 1.0 - exp(-dd * 3.2);
          diffuseColor.a = clamp(max(absorb, 0.1) + wFoam * 0.6, 0.0, 0.97) * smoothstep(-0.04, 0.02, wDepth);`)
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.05, 0.5, wFoam) + uRain * 0.08;')
        // premultiplied: the body colour fades with alpha, reflections don't
        .replace('#include <opaque_fragment>', 'gl_FragColor = vec4((outgoingLight - totalSpecular) * diffuseColor.a + totalSpecular * smoothstep(-0.04, 0.02, wDepth), diffuseColor.a);')
        .replace('#include <premultiplied_alpha_fragment>', '');
    };
    mat.customProgramCacheKey = () => 'water-pbr-2';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'water';
  }
}
