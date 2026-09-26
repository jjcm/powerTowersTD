// Lit PBR water. Built on MeshStandardMaterial so it reflects the sky environment, the sun and
// every dynamic light (power arcs and fires shimmer across the pond at night). Depth-based colour
// comes from the terrain height field; scrolling normals, rain ripples and shoreline foam are
// injected into the standard shader.

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
      uDeep: { value: new THREE.Color(0x05275a) },
      uShallow: { value: new THREE.Color(0x157fb5) },
      uRain: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0.0, transparent: true, depthWrite: false, envMapIntensity: 1.15 });
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
          uniform vec3 uDeep, uShallow;
          float wDepth; float wFoam; vec3 wN;`)
        .replace('#include <map_fragment>', /* glsl */`
          vec2 huv = ((vWPos.xz + uBorder) * uRes + 0.5) / uHeightSize;
          float ground = texture(tHeight, huv).r;
          wDepth = ${WATER_LEVEL.toFixed(3)} - ground;
          if (wDepth < -0.04) discard;
          vec2 uv1 = vWPos.xz * 0.11 + vec2(uTime * 0.017, uTime * 0.011);
          vec2 uv2 = vWPos.xz * 0.23 + vec2(-uTime * 0.012, uTime * 0.019);
          vec3 n1 = texture(tWaterN, uv1).xyz * 2.0 - 1.0;
          vec3 n2 = texture(tWaterN, uv2).xyz * 2.0 - 1.0;
          wN = normalize(vec3(n1.x + n2.x, 2.6 - uRain * 1.2, -(n1.y + n2.y)));
          // rain ripples
          vec2 cell = floor(vWPos.xz * 1.5);
          float rnd = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float ph = fract(uTime * 0.9 + rnd);
          float rr = length(fract(vWPos.xz * 1.5) - 0.5) * 2.0;
          float ring = uRain * (1.0 - ph) * smoothstep(0.08, 0.0, abs(rr - ph));
          wN = normalize(wN + vec3(ring * 0.7, 0.0, ring * 0.7));
          float dd = clamp(wDepth / 0.45, 0.0, 1.0);
          vec3 wcol = mix(uShallow, uDeep, dd);
          wFoam = smoothstep(0.13, 0.0, wDepth) * (0.55 + 0.45 * sin(uTime * 2.0 + vWPos.x * 3.0 + vWPos.z * 2.0));
          wcol = mix(wcol, vec3(0.9, 0.96, 1.0), wFoam * 0.65);
          diffuseColor.rgb = wcol;
          diffuseColor.a = clamp(0.8 + dd * 0.18, 0.0, 0.97) * smoothstep(-0.04, 0.03, wDepth);`)
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.05, 0.5, wFoam) + uRain * 0.08;');
    };
    mat.customProgramCacheKey = () => 'water-pbr';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'water';
  }
}
