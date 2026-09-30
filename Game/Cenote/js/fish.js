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
      color: new THREE.Color(0.42, 0.5, 0.56), metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide,
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
totalEmissiveRadiance += vec3(0.004, 0.008, 0.01);`
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
        r: 2.4 + Math.random() * 3.2,
        y: -1.2 - Math.random() * 1.8,
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
    this.frame = (this.frame || 0) + 1;
    const t = this.t;
    const g = this._g || (this._g = new THREE.Vector3());
    const pa = this._pa || (this._pa = new THREE.Vector3());
    const tgt = this._tgt || (this._tgt = new THREE.Vector3());
    const X = this._x || (this._x = new THREE.Vector3(1, 0, 0));
    const grad = (p, out) => {
      const e = 0.2;
      out.set(
        caveF(p.x + e, p.y, p.z) - caveF(p.x - e, p.y, p.z),
        caveF(p.x, p.y + e, p.z) - caveF(p.x, p.y - e, p.z),
        caveF(p.x, p.y, p.z + e) - caveF(p.x, p.y, p.z - e)
      ).normalize(); // 岩のほうを向く
      return out;
    };
    // 群れの中心はゆっくり島の周りを回る
    const cx = this.center.x + Math.cos(t * 0.09) * 3.2;
    const cz = this.center.z + Math.sin(t * 0.11) * 3.0;
    for (let i = 0; i < this.count; i++) {
      const f = this.fish[i];
      const ang = t * f.w + f.off;
      let tx = cx + Math.cos(ang) * f.r * 0.7 + Math.cos(t * 0.4 + f.off * 3) * 0.8;
      let tz = cz + Math.sin(ang) * f.r * 0.7 + Math.sin(t * 0.5 + f.off * 2) * 0.8;
      // 床の高さを見て泳ぐ深さを決める（負荷対策：個体ごとに10フレームに1回だけ再計算）
      if (f.fl === undefined || ((this.frame + i) % 10) === 0) {
        let fl = -0.3;
        for (let k = 0; k < 40; k++) { if (caveF(tx, fl, tz) > -0.05) break; fl -= 0.25; }
        f.fl = fl;
      }
      let ty = Math.min(-0.8, Math.max(f.fl + 0.9, f.y + Math.sin(t * 0.3 + f.off) * 0.5));
      // 目標が岩の中・岩すれすれなら、群れの中心の安全な深さへ切り替える
      tgt.set(tx, ty, tz);
      if (caveF(tx, ty, tz) > -0.9) tgt.set(f.safeX ?? cx, f.safeY ?? -1.6, f.safeZ ?? cz);
      else { f.safeX = tx; f.safeY = ty; f.safeZ = tz; }

      // 目標へ向かう加速
      const ax = (tgt.x - f.p.x) * 1.5, ay = (tgt.y - f.p.y) * 1.5, az = (tgt.z - f.p.z) * 1.5;
      f.v.x += ax * dt; f.v.y += ay * dt; f.v.z += az * dt;

      // 先読み：進行方向の少し先が岩なら、岩と反対へ舵を切って減速
      const sp0 = f.v.length();
      if (sp0 > 0.05) {
        pa.copy(f.v).multiplyScalar(0.9 / sp0).add(f.p);
        const fa = caveF(pa.x, pa.y, pa.z);
        if (fa > -0.7) {
          grad(f.p, g);
          const k = Math.min(1, (fa + 0.7) / 0.7);
          f.v.addScaledVector(g, -k * 7.0 * dt);
          f.v.multiplyScalar(1 - k * Math.min(1, dt * 2.5));
        }
      }
      f.v.multiplyScalar(1 - Math.min(1, dt * 0.6));
      const sp = f.v.length();
      const maxSp = 1.7, minSp = 0.45;
      if (sp > maxSp) f.v.multiplyScalar(maxSp / sp);
      else if (sp < minSp && sp > 1e-4) f.v.multiplyScalar(minSp / sp);
      f.p.addScaledVector(f.v, dt);

      // 万一、岩に触れたら押し戻して、壁向きの速度を消す
      const fp = caveF(f.p.x, f.p.y, f.p.z);
      if (fp > -0.3) {
        grad(f.p, g);
        f.p.addScaledVector(g, -(fp + 0.3) - 0.02);
        const vd = f.v.dot(g);
        if (vd > 0) f.v.addScaledVector(g, -vd * 1.2);
      }
      if (f.p.y > -0.3) { f.p.y = -0.3; if (f.v.y > 0) f.v.y = 0; }

      // 向きは滑らかに追従（細かい向きの振動を出さない）
      if (!f.dir) f.dir = new THREE.Vector3(1, 0, 0);
      if (f.v.lengthSq() > 1e-5) {
        this._d = (this._d || new THREE.Vector3()).copy(f.v).normalize();
        f.dir.lerp(this._d, 1 - Math.exp(-dt * 4)).normalize();
      }
      this.q.setFromUnitVectors(X, f.dir);
      this.sc.setScalar(f.s * 1.25);
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
