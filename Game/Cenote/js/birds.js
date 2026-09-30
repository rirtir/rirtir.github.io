// 天窓の上空を舞い、ときどき光の柱の中へ降りてくるツバメ。
// 実物大（翼開長 約45cm）。羽ばたきは頂点シェーダー、経路は SDF で壁を避ける。
import * as THREE from 'three';
import { injectSun } from './caveMaterial.js';
import { WORLD, caveF } from './sdf.js';

function birdGeometry() {
  const pos = [], nor = [], col = [];
  const DARK = [0.02, 0.028, 0.055];
  const BELLY = [0.42, 0.35, 0.27];
  const WINGUP = [0.025, 0.03, 0.05];
  const WINGDN = [0.09, 0.085, 0.08];
  const push = (p, n, c) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(c[0], c[1], c[2]); };
  const tri = (a, b, c, cu, cd) => {
    push(a, [0, 1, 0], cu); push(b, [0, 1, 0], cu); push(c, [0, 1, 0], cu);
    push(a, [0, -1, 0], cd); push(c, [0, -1, 0], cd); push(b, [0, -1, 0], cd);
  };

  // ---- 胴体：断面が楕円の紡錘形 ----
  const rings = [
    { x: 0.105, ry: 0.004, rz: 0.004 },
    { x: 0.085, ry: 0.014, rz: 0.012 },  // 頭
    { x: 0.05, ry: 0.02, rz: 0.019 },
    { x: 0.0, ry: 0.023, rz: 0.024 },    // 胸
    { x: -0.05, ry: 0.019, rz: 0.019 },
    { x: -0.11, ry: 0.009, rz: 0.009 },
    { x: -0.135, ry: 0.003, rz: 0.003 },
  ];
  const SEG = 8;
  const ringPts = rings.map((r) => {
    const pts = [];
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      pts.push([r.x, Math.sin(a) * r.ry, Math.cos(a) * r.rz]);
    }
    return pts;
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      const a = ringPts[i][j], b = ringPts[i][j2], c = ringPts[i + 1][j], d = ringPts[i + 1][j2];
      const belly = Math.sin(((j + 0.5) / SEG) * Math.PI * 2) < -0.1;
      const cc = belly ? BELLY : DARK;
      const ny = Math.sin(((j + 0.5) / SEG) * Math.PI * 2), nz = Math.cos(((j + 0.5) / SEG) * Math.PI * 2);
      for (const [p, q, r] of [[a, b, c], [b, d, c]]) {
        push(p, [0, ny, nz], cc); push(q, [0, ny, nz], cc); push(r, [0, ny, nz], cc);
        push(p, [0, -ny, -nz], cc); push(r, [0, -ny, -nz], cc); push(q, [0, -ny, -nz], cc);
      }
    }
  }

  // ---- 翼：後退した三日月型。前縁と後縁を結ぶストリップ ----
  const LE = [[0.06, 0.02], [0.085, 0.08], [0.08, 0.15], [0.05, 0.22], [0.0, 0.28], [-0.07, 0.33]];
  const TE = [[-0.075, 0.02], [-0.085, 0.08], [-0.085, 0.15], [-0.08, 0.21], [-0.07, 0.27], [-0.075, 0.32]];
  for (const sd of [1, -1]) {
    for (let i = 0; i < LE.length - 1; i++) {
      const l0 = [LE[i][0], 0, LE[i][1] * sd], l1 = [LE[i + 1][0], 0, LE[i + 1][1] * sd];
      const t0 = [TE[i][0], 0, TE[i][1] * sd], t1 = [TE[i + 1][0], 0, TE[i + 1][1] * sd];
      if (sd > 0) { tri(l0, t0, l1, WINGUP, WINGDN); tri(l1, t0, t1, WINGUP, WINGDN); }
      else { tri(l0, l1, t0, WINGUP, WINGDN); tri(l1, t1, t0, WINGUP, WINGDN); }
    }
  }
  // ---- 尾：燕尾（二股） ----
  tri([-0.11, 0, 0.012], [-0.30, 0, 0.055], [-0.14, 0, 0.0], DARK, BELLY);
  tri([-0.11, 0, -0.012], [-0.14, 0, 0.0], [-0.30, 0, -0.055], DARK, BELLY);
  tri([-0.11, 0, 0.012], [-0.14, 0, 0.0], [-0.11, 0, -0.012], DARK, BELLY);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export class Swallows {
  constructor(count = 3) {
    this.count = count;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide });
    mat.customProgramCacheKey = () => 'swallow2';
    mat.onBeforeCompile = (shader) => {
      injectSun(shader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  float id_ = float(gl_InstanceID);
  float ph_ = id_ * 2.31;
  float s_ = clamp(abs(transformed.z) / 0.33, 0.0, 1.0);
  // 羽ばたき（数回打って滑空、を繰り返す）
  float burst_ = smoothstep(-0.2, 0.3, sin(uTime * 0.8 + ph_));
  float w_ = sin(uTime * 19.0 + ph_);
  float amp_ = mix(0.05, 0.62, burst_);
  transformed.y += w_ * amp_ * s_ * s_ * 0.33;
  // 打ち下ろしで翼が少し前へ、打ち上げで後ろへ
  transformed.x += -w_ * amp_ * s_ * 0.05;
  // 体のうねり
  transformed.y += 0.004 * w_ * amp_ * (1.0 - s_);
}`
        );
    };
    this.mesh = new THREE.InstancedMesh(birdGeometry(), mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.birds = [];
    for (let i = 0; i < count; i++) {
      this.birds.push({
        a: Math.random() * 6.28,
        sp: (5.5 + Math.random() * 2.5) * (i % 2 ? 1 : -1),
        alt: 26 + Math.random() * 9,
        rad: 6 + Math.random() * 6,
        ph: Math.random() * 20,
        state: 'sky',
        timer: 8 + Math.random() * 25,
        u: 0,
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        fwd: new THREE.Vector3(1, 0, 0),
        up: new THREE.Vector3(0, 1, 0),
        init: false,
      });
    }
    this.m = new THREE.Matrix4();
    this.tmp = new THREE.Vector3();
    this.rt = new THREE.Vector3();
    this.sc = new THREE.Vector3(1.05, 1.05, 1.05);
    this.t = 0;
    this.axis = new THREE.Vector3(WORLD.shaft1.x + 0.4, 0, WORLD.shaft1.z);
  }

  update(dt) {
    this.t += dt;
    const ax = this.axis;
    for (let i = 0; i < this.count; i++) {
      const b = this.birds[i];
      b.timer -= dt;
      let r, y;
      if (b.state === 'sky') {
        r = b.rad + Math.sin(this.t * 0.25 + b.ph) * 1.5;
        y = b.alt + Math.sin(this.t * 0.31 + b.ph) * 2.0;
        b.a += (b.sp / Math.max(r, 2)) * dt;
        if (b.timer <= 0) { b.state = 'dive'; b.u = 0; }
      } else {
        // 竪穴へ降りて、光の柱の中を抜けて戻る（半径は小さく、SDFで壁を避ける）
        b.u += dt / 11;
        const k = Math.sin(Math.min(1, b.u) * Math.PI);           // 0→1→0
        const er = THREE.MathUtils.smoothstep(k, 0.0, 0.4);   // まず上空で輪を縮め
        const ey = THREE.MathUtils.smoothstep(k, 0.3, 1.0);   // それから穴の中へ降りる
        r = b.rad * (1 - er) + 1.05 * er;
        y = b.alt * (1 - ey) + 12.5 * ey;
        b.a += (b.sp * 0.6 / Math.max(r, 1.0)) * dt;
        if (b.u >= 1) { b.state = 'sky'; b.timer = 25 + Math.random() * 30; }
      }
      b.pos.set(ax.x + Math.cos(b.a) * r, y, ax.z + Math.sin(b.a) * r);
      // 壁に近づいたら軸のほうへ寄せる（岩にめり込まない）
      for (let it = 0; it < 10 && b.pos.y < WORLD.bounds.max[1] - 0.5 && caveF(b.pos.x, b.pos.y, b.pos.z) > -0.9; it++) {
        b.pos.x += (ax.x - b.pos.x) * 0.12; b.pos.z += (ax.z - b.pos.z) * 0.12;
      }
      if (!b.init) { b.prev.copy(b.pos); b.init = true; }
      // 進行方向（位置の差分）を滑らかに追従
      this.tmp.subVectors(b.pos, b.prev);
      if (this.tmp.lengthSq() > 1e-8 && dt > 0) {
        this.tmp.normalize();
        b.fwd.lerp(this.tmp, 1 - Math.exp(-dt * 6)).normalize();
      }
      b.prev.copy(b.pos);
      // 旋回の内側へ傾ける（バンク）
      const dir = Math.sign(b.sp);
      const bank = 0.55 * dir * (b.state === 'dive' ? 1.4 : 1);
      this.tmp.set(Math.cos(b.a) * bank, 1, Math.sin(b.a) * bank);
      b.up.lerp(this.tmp, 1 - Math.exp(-dt * 4)).normalize();
      this.rt.crossVectors(b.fwd, b.up).normalize();
      b.up.crossVectors(this.rt, b.fwd).normalize();
      this.m.makeBasis(b.fwd, b.up, this.rt);
      this.m.scale(this.sc);
      this.m.setPosition(b.pos);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
