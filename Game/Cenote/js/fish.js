// 光の柱の中を泳ぐ小魚の群れ（インスタンス描画・CPU で軽くフロッキング）
import * as THREE from 'three';
import { injectSun, WATER_FILL_GLSL } from './caveMaterial.js';

function fishGeometry() {
  // 胴体：つぶした楕円体＋尾びれ
  const body = new THREE.SphereGeometry(0.5, 12, 8);
  body.scale(1.0, 0.34, 0.2);
  body.translate(0.05, 0, 0);
  const tail = new THREE.BufferGeometry();
  const t = new Float32Array([
    -0.42, 0, 0, -0.85, 0.24, 0, -0.85, -0.24, 0,
    -0.42, 0, 0, -0.85, -0.24, 0, -0.85, 0.24, 0,
  ]);
  tail.setAttribute('position', new THREE.BufferAttribute(t, 3));
  tail.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1]), 3));
  tail.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(12), 2));
  const merged = new THREE.BufferGeometry();
  const bp = body.attributes.position, bn = body.attributes.normal, bu = body.attributes.uv;
  const pos = [], nor = [], uv = [];
  const bi = body.index;
  for (let i = 0; i < bi.count; i++) {
    const k = bi.getX(i);
    pos.push(bp.getX(k), bp.getY(k), bp.getZ(k));
    nor.push(bn.getX(k), bn.getY(k), bn.getZ(k));
    uv.push(bu.getX(k), bu.getY(k));
  }
  for (let i = 0; i < 6; i++) {
    pos.push(t[i * 3], t[i * 3 + 1], t[i * 3 + 2]);
    nor.push(0, 0, i < 3 ? 1 : -1);
    uv.push(0, 0);
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return merged;
}

export class FishSchool {
  constructor(center, count = 70) {
    this.count = count;
    this.center = center.clone();
    const geo = fishGeometry();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.75, 0.82, 0.88), metalness: 0.65, roughness: 0.32, side: THREE.DoubleSide,
    });
    mat.customProgramCacheKey = () => 'fish';
    mat.onBeforeCompile = (shader) => {
      injectSun(shader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  float ph_ = float(gl_InstanceID) * 1.73;
  float k_ = clamp(-transformed.x, 0.0, 1.0);
  transformed.z += sin(uTime * 11.0 + ph_ - transformed.x * 7.0) * 0.16 * k_ * k_;
}`
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${WATER_FILL_GLSL}
totalEmissiveRadiance += vec3(0.03, 0.05, 0.06);`
      );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.fish = [];
    for (let i = 0; i < count; i++) {
      this.fish.push({
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        a: Math.random() * 6.28,
        r: 3 + Math.random() * 3.5,
        y: -1.2 - Math.random() * 3.2,
        w: 0.4 + Math.random() * 0.25,
        off: Math.random() * 6.28,
        s: 0.13 + Math.random() * 0.08,
      });
    }
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.sc = new THREE.Vector3();
    this.t = 0;
  }
  update(dt, caveF) {
    this.t += dt;
    const t = this.t;
    // 群れの中心はゆっくり島の周りを回る
    const cx = this.center.x + Math.cos(t * 0.09) * 6.0;
    const cz = this.center.z + Math.sin(t * 0.11) * 5.0;
    const up = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < this.count; i++) {
      const f = this.fish[i];
      const ang = t * f.w + f.off;
      const tx = cx + Math.cos(ang) * f.r * 0.7 + Math.cos(t * 0.4 + f.off * 3) * 0.8;
      const tz = cz + Math.sin(ang) * f.r * 0.7 + Math.sin(t * 0.5 + f.off * 2) * 0.8;
      const ty = f.y + Math.sin(t * 0.3 + f.off) * 0.5;
      const tgt = new THREE.Vector3(tx, ty, tz);
      // 目標へ加速
      const acc = tgt.sub(f.p).multiplyScalar(1.6);
      f.v.addScaledVector(acc, dt).multiplyScalar(1 - Math.min(1, dt * 0.6));
      const sp = f.v.length();
      const maxSp = 1.8;
      if (sp > maxSp) f.v.multiplyScalar(maxSp / sp);
      f.p.addScaledVector(f.v, dt);
      // 壁・床を避ける
      if (caveF(f.p.x, f.p.y, f.p.z) > -0.5) f.p.y += 0.06;
      if (f.p.y > -0.25) f.p.y = -0.25;
      const dir = f.v.lengthSq() > 1e-4 ? f.v.clone().normalize() : up;
      this.q.setFromUnitVectors(up, dir);
      this.sc.setScalar(f.s * 1.7);
      this.m4.compose(f.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  init(caveF) {
    for (const f of this.fish) {
      f.p.set(this.center.x + Math.cos(f.off) * f.r * 0.7, f.y, this.center.z + Math.sin(f.off) * f.r * 0.7);
    }
  }
}
