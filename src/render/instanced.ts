import * as THREE from 'three';

/**
 * Turns a (possibly multi-mesh) model template into one InstancedMesh per sub-mesh so that
 * hundreds of walls / trees / rocks cost a handful of draw calls.
 */
export class InstancedModel {
  group = new THREE.Group();
  private parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  private tmp = new THREE.Matrix4();
  count = 0;

  private cull: boolean;
  constructor(template: THREE.Object3D, public capacity: number, opts: { castShadow?: boolean; receiveShadow?: boolean; wind?: boolean; cull?: boolean } = {}) {
    this.cull = !!opts.cull;
    template.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(template.matrixWorld).invert();
    template.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const local = new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld);
      let material = m.material as THREE.Material;
      if (opts.wind) material = windMaterial(material as THREE.MeshStandardMaterial);
      const im = new THREE.InstancedMesh(m.geometry, material, capacity);
      im.castShadow = opts.castShadow ?? true;
      im.receiveShadow = opts.receiveShadow ?? true;
      im.count = 0;
      im.frustumCulled = false;
      this.parts.push({ mesh: im, local });
      this.group.add(im);
    });
  }

  setCount(n: number) {
    this.count = Math.min(n, this.capacity);
    for (const p of this.parts) { p.mesh.count = this.count; p.mesh.instanceMatrix.needsUpdate = true; }
  }

  setMatrix(i: number, m: THREE.Matrix4) {
    for (const p of this.parts) {
      this.tmp.multiplyMatrices(m, p.local);
      p.mesh.setMatrixAt(i, this.tmp);
    }
  }

  setColor(i: number, c: THREE.Color) {
    for (const p of this.parts) p.mesh.setColorAt(i, c);
  }

  commit() {
    for (const p of this.parts) {
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      p.mesh.boundingSphere = null;
      p.mesh.computeBoundingSphere();
      // with a real bounding sphere the instances can be culled per view (incl. shadow passes)
      p.mesh.frustumCulled = this.cull && this.count > 0;
    }
  }
}

const windUniform = { value: 0 };
export function setWindTime(t: number) { windUniform.value = t; }

function windMaterial(src: THREE.MeshStandardMaterial): THREE.Material {
  const m = src.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float sway = max(position.y, 0.0);
        float ph = uWind * 1.3 + ip.x * 0.37 + ip.z * 0.23;
        transformed.x += sin(ph) * 0.035 * sway;
        transformed.z += cos(ph * 0.8) * 0.025 * sway;
      `);
  };
  m.customProgramCacheKey = () => 'wind';
  return m;
}

/**
 * A copy of `template` whose meshes share the original vertex buffers but draw a simplified
 * index list (meshoptimizer), for distant level-of-detail.
 */
export function simplifiedTemplate(template: THREE.Object3D, ratio: number, simplify: Simplify): THREE.Object3D {
  const lod = template.clone();
  lod.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const idx = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    const p = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { p[i * 3] = pos.getX(i); p[i * 3 + 1] = pos.getY(i); p[i * 3 + 2] = pos.getZ(i); }
    const target = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
    const [out] = simplify(idx, p, 3, target, 0.08, ['Permissive']);
    const ng = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(g.attributes)) ng.setAttribute(k, a);
    ng.setIndex(new THREE.BufferAttribute(out, 1));
    ng.boundingSphere = g.boundingSphere;
    ng.boundingBox = g.boundingBox;
    m.geometry = ng;
  });
  return lod;
}
export type Simplify = (indices: Uint32Array, positions: Float32Array, stride: number, target: number, error: number, flags?: ('LockBorder' | 'Sparse' | 'ErrorAbsolute' | 'Prune' | 'Regularize' | 'Permissive' | 'RegularizeLight')[]) => [Uint32Array, number];

/**
 * Instanced models split into spatial chunks so the camera and shadow passes can cull them.
 * With a `lod` template each chunk also gets a cheap twin, swapped in by camera distance.
 */
export class ChunkedInstances {
  group = new THREE.Group();
  private chunks = new Map<string, { model: InstancedModel; lod?: InstancedModel; n: number; cx: number; cz: number }>();
  constructor(private template: THREE.Object3D, private chunkSize: number, private perChunk: number,
    private opts: { castShadow?: boolean; receiveShadow?: boolean; wind?: boolean; lod?: THREE.Object3D; lodDistance?: number } = {}) {}

  begin() { for (const c of this.chunks.values()) c.n = 0; }

  add(x: number, z: number, m: THREE.Matrix4, color?: THREE.Color) {
    const kx = Math.floor(x / this.chunkSize), kz = Math.floor(z / this.chunkSize);
    const key = `${kx},${kz}`;
    let c = this.chunks.get(key);
    if (!c) {
      const o = { ...this.opts, cull: true };
      c = { model: new InstancedModel(this.template, this.perChunk, o), n: 0, cx: (kx + 0.5) * this.chunkSize, cz: (kz + 0.5) * this.chunkSize };
      if (this.opts.lod) { c.lod = new InstancedModel(this.opts.lod, this.perChunk, o); c.lod.group.visible = false; this.group.add(c.lod.group); }
      this.chunks.set(key, c);
      this.group.add(c.model.group);
    }
    if (c.n >= this.perChunk) return;
    c.model.setMatrix(c.n, m);
    c.lod?.setMatrix(c.n, m);
    if (color) { c.model.setColor(c.n, color); c.lod?.setColor(c.n, color); }
    c.n++;
  }

  end() {
    for (const c of this.chunks.values()) { c.model.setCount(c.n); c.model.commit(); c.lod?.setCount(c.n); c.lod?.commit(); }
  }

  /** Chunk centres, for per-chunk decisions (e.g. which chunks cast shadows). */
  eachChunk(fn: (cx: number, cz: number, groups: THREE.Group[]) => void) {
    for (const c of this.chunks.values()) fn(c.cx, c.cz, c.lod ? [c.model.group, c.lod.group] : [c.model.group]);
  }

  /** Swap chunks to their LOD twin beyond `lodDistance` from the camera. */
  updateLod(camera: THREE.Vector3) {
    const d2 = (this.opts.lodDistance ?? 30) ** 2;
    for (const c of this.chunks.values()) {
      if (!c.lod) continue;
      const far = (c.cx - camera.x) ** 2 + (c.cz - camera.z) ** 2 + camera.y * camera.y * 0.5 > d2;
      c.model.group.visible = !far;
      c.lod.group.visible = far;
    }
  }
}
