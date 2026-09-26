import * as THREE from 'three';

/** Instanced billboard bars (health / shield / energy / mana), always drawn on top. */
export class Bars {
  mesh: THREE.InstancedMesh;
  private aFill: THREE.InstancedBufferAttribute;
  private aFill2: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aCol2: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private n = 0;
  private m = new THREE.Matrix4();
  uniforms = { uViewH: { value: 1000 } };

  constructor(capacity = 1024) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aFill = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aFill2 = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aCol2 = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    geo.setAttribute('aFill', this.aFill);
    geo.setAttribute('aFill2', this.aFill2);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aCol2', this.aCol2);
    geo.setAttribute('aSize', this.aSize);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        uniform float uViewH;
        attribute float aFill; attribute float aFill2; attribute vec3 aCol; attribute vec3 aCol2; attribute vec2 aSize;
        varying vec2 vUv; varying float vFill; varying float vFill2; varying vec3 vCol; varying vec3 vCol2; varying vec2 vSize; varying float vPx;
        void main() {
          vUv = uv; vFill = aFill; vFill2 = aFill2; vCol = aCol; vCol2 = aCol2;
          vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          // world units per screen pixel at this depth; bars never get thinner than 5px
          vPx = max(0.001, -center.z) / (projectionMatrix[1][1] * 0.5 * uViewH);
          vSize = vec2(aSize.x, max(aSize.y, 5.0 * vPx));
          center.xy += position.xy * vSize;
          gl_Position = projectionMatrix * center;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vFill; varying float vFill2; varying vec3 vCol; varying vec3 vCol2; varying vec2 vSize; varying float vPx;
        void main() {
          vec2 px = vUv * vSize;
          float border = vPx;   // a one-pixel outline at any zoom
          if (px.x < border || px.y < border || px.x > vSize.x - border || px.y > vSize.y - border) { gl_FragColor = vec4(0.02, 0.02, 0.03, 0.9); return; }
          float u = (px.x - border) / (vSize.x - 2.0 * border);
          // the empty part is a dim tint of the bar colour, so the full length stays readable
          vec3 c = vCol * 0.2 + 0.025;
          if (u < vFill) c = vCol * (0.85 + 0.4 * vUv.y);
          if (vFill2 > 0.0 && u < vFill2 && vUv.y > 0.45) c = mix(c, vCol2, 0.85);
          gl_FragColor = vec4(c, 0.97);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.count = 0;
  }

  /** Drawing-buffer height, for pixel-exact outlines. */
  setViewportHeight(h: number) { this.uniforms.uViewH.value = h; }

  begin() { this.n = 0; }

  push(x: number, y: number, z: number, w: number, h: number, fill: number, col: THREE.Color, fill2 = 0, col2?: THREE.Color) {
    const i = this.n++;
    if (i >= this.mesh.instanceMatrix.count) return;
    this.m.makeTranslation(x, y, z);
    this.mesh.setMatrixAt(i, this.m);
    this.aFill.setX(i, Math.max(0, Math.min(1, fill)));
    this.aFill2.setX(i, Math.max(0, Math.min(1, fill2)));
    this.aCol.setXYZ(i, col.r, col.g, col.b);
    if (col2) this.aCol2.setXYZ(i, col2.r, col2.g, col2.b);
    this.aSize.setXY(i, w, h);
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of [this.aFill, this.aFill2, this.aCol, this.aCol2, this.aSize]) a.needsUpdate = true;
  }
}
