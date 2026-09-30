// 天窓のまわりを旋回するツバメ（羽ばたきは頂点シェーダー）
import * as THREE from 'three';
import { injectSun } from './caveMaterial.js';
import { WORLD } from './sdf.js';

function birdGeometry() {
  const pos = [], nor = [];
  const tri = (a, b, c) => {
    for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); nor.push(0, 1, 0); }
    for (const v of [a, c, b]) { pos.push(v[0], v[1], v[2]); nor.push(0, -1, 0); }
  };
  // 胴体（細長い菱形）
  const nose = [0.16, 0, 0], tailRoot = [-0.13, 0, 0];
  tri(nose, [0.02, 0.035, 0.03], [0.02, 0.035, -0.03]);
  tri(nose, [0.02, -0.03, 0.03], [0.02, 0.035, 0.03]);
  tri([0.02, 0.035, 0.03], [-0.13, 0, 0.012], [0.02, 0.035, -0.03]);
  tri([0.02, 0.035, -0.03], [-0.13, 0, 0.012], [-0.13, 0, -0.012]);
  // 翼（後退角のついた三角形×左右）
  for (const s of [1, -1]) {
    tri([0.06, 0.0, 0.02 * s], [-0.06, 0.0, 0.02 * s], [-0.09, 0.0, 0.34 * s]);
    tri([0.06, 0.0, 0.02 * s], [-0.09, 0.0, 0.34 * s], [0.02, 0.0, 0.3 * s]);
  }
  // 燕尾
  tri([-0.11, 0, 0.0], [-0.27, 0, 0.055], [-0.19, 0, 0.0]);
  tri([-0.11, 0, 0.0], [-0.19, 0, 0.0], [-0.27, 0, -0.055]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export class Swallows {
  constructor(count = 9) {
    this.count = count;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.035, 0.04, 0.05), roughness: 0.55, metalness: 0.0, side: THREE.DoubleSide,
    });
    mat.customProgramCacheKey = () => 'swallow';
    mat.onBeforeCompile = (shader) => {
      injectSun(shader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  float ph_ = float(gl_InstanceID) * 2.31;
  float span_ = abs(transformed.z);
  transformed.y += sin(uTime * 17.0 + ph_) * span_ * 0.85 * step(0.05, span_);
}`
        );
    };
    this.mesh = new THREE.InstancedMesh(birdGeometry(), mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.layers.enable(1);
    this.birds = [];
    for (let i = 0; i < count; i++) {
      this.birds.push({
        a: Math.random() * 6.28,
        r: 2.0 + Math.random() * 1.8,
        y: 9 + Math.random() * 8,
        sp: (4.2 + Math.random() * 2.0) * (Math.random() < 0.5 ? 1 : -1),
        ph: Math.random() * 20,
        wide: Math.random() < 0.35,
      });
    }
    this.m = new THREE.Matrix4();
    this.fwd = new THREE.Vector3(); this.up = new THREE.Vector3(); this.rt = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    const s = WORLD.shaft1;
    const cx = s.x + 0.4, cz = s.z;
    for (let i = 0; i < this.count; i++) {
      const b = this.birds[i];
      const r = b.r * (b.wide ? 2.4 : 1) + Math.sin(this.t * 0.3 + b.ph) * 0.6;
      b.a += (b.sp / Math.max(r, 1.2)) * dt;
      const y = b.y + Math.sin(this.t * 0.21 + b.ph) * 3.2;
      this.p.set(cx + Math.cos(b.a) * r, y, cz + Math.sin(b.a) * r);
      // 進行方向（円の接線）
      const dir = Math.sign(b.sp);
      this.fwd.set(-Math.sin(b.a) * dir, Math.cos(this.t * 0.21 + b.ph) * 0.12, Math.cos(b.a) * dir).normalize();
      // 内側へバンク
      const bank = 0.5 * dir;
      this.up.set(-Math.cos(b.a) * bank * -1, 1, -Math.sin(b.a) * bank * -1).normalize();
      this.rt.crossVectors(this.fwd, this.up).normalize();
      this.up.crossVectors(this.rt, this.fwd).normalize();
      this.m.makeBasis(this.fwd, this.up, this.rt);
      this.m.setPosition(this.p);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
