// 光の柱の中で舞う塵、水中の微粒子（マリンスノー）、水滴
import * as THREE from 'three';
import { shared } from './caveMaterial.js';

const VERT = /* glsl */ `
attribute vec4 aSeed;   // xyz: 箱内の位置(0..1), w: 個体差
uniform vec3 uCam;
uniform vec3 uBox;
uniform float uTime;
uniform float uPx;
uniform float uWaterY;
varying float vLit;
varying float vAlpha;
varying vec3 vTint;
uniform sampler2D tSunDepth;
uniform mat4 uSunVP;
uniform vec4 uSunInfo;
uniform vec3 uAbsorb;
uniform vec3 uSunDir;

void main() {
  float sd = aSeed.w;
  vec3 p = aSeed.xyz * uBox;
  // ゆっくり漂う
  p += vec3(sin(uTime * 0.11 + sd * 40.0), sin(uTime * 0.07 + sd * 71.0) * 0.6 - uTime * 0.02 * (0.3 + sd), cos(uTime * 0.09 + sd * 23.0)) * 1.2;
  // カメラ周りの箱でラップ
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = uCam + rel;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;

  // 太陽が当たっているか
  vec4 lp = uSunVP * vec4(wp, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  vec2 suv = ndc.xy * 0.5 + 0.5;
  float lit = 0.0;
  if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
    float stored = texture2D(tSunDepth, suv).r;
    lit = step(ndc.z * 0.5 + 0.5 - 0.0005, stored);
  }
  bool wet = wp.y < uWaterY;
  vec3 tint = vec3(1.0, 0.96, 0.86);
  float amb = 0.035;
  if (wet) {
    float dep = uWaterY - wp.y;
    float s = dep / max(0.25, -uSunDir.y);
    tint = exp(-uAbsorb * s * 0.9);
    amb = 0.06 * exp(-dep * 0.08);
  }
  vLit = lit;
  vTint = tint;
  float dist = -mv.z;
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + sd * 3.0) + sd * 90.0);
  vAlpha = (lit * 1.0 + amb) * tw * smoothstep(0.3, 1.5, dist) * (1.0 - smoothstep(14.0, 24.0, dist));
  float size = (wet ? 2.4 : 2.0) + sd * 2.6;
  gl_PointSize = clamp(size * uPx / max(dist, 0.5) * 6.0, 1.0, 9.0);
}`;

const FRAG = /* glsl */ `
varying float vLit;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vTint * (2.5 + vLit * 14.0), a * vAlpha);
}`;

export class Particles {
  constructor(count = 3200) {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(46, 30, 46) },
      uTime: shared.uTime,
      uPx: { value: 1 },
      uWaterY: shared.uWaterY,
      tSunDepth: shared.tSunDepth,
      uSunVP: shared.uSunVP,
      uSunInfo: shared.uSunInfo,
      uAbsorb: shared.uAbsorb,
      uSunDir: shared.uSunDir,
    };
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  update(camera, pxScale) {
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uPx.value = pxScale;
  }
}

// 天井から落ちる水滴
export class Drips {
  constructor(list, waterY, onSplash) {
    this.list = list;
    this.waterY = waterY;
    this.onSplash = onSplash;
    this.drops = [];
    this.timer = 1.0;
    const N = 12;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const m = new THREE.PointsMaterial({ size: 0.06, color: 0xcfe9ff, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.N = N;
  }
  update(dt, camera, caveF) {
    this.timer -= dt;
    if (this.timer <= 0 && this.list.length) {
      this.timer = 0.9 + Math.random() * 2.6;
      // カメラに比較的近い鍾乳石を選ぶ
      let best = null;
      for (let k = 0; k < 6; k++) {
        const s = this.list[(Math.random() * this.list.length) | 0];
        if (caveF(s.x, this.waterY - 0.4, s.z) > -0.3) continue; // 真下が水面であること
        const d = Math.hypot(s.x - camera.position.x, s.z - camera.position.z);
        if (!best || d < best.d) best = { s, d };
      }
      if (best && this.drops.length < this.N) {
        this.drops.push({ x: best.s.x, z: best.s.z, y: best.s.yTip + 0.05, v: 0 });
      }
    }
    const pos = this.points.geometry.attributes.position;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.v += 9.8 * dt;
      d.y -= d.v * dt;
      if (d.y <= this.waterY) {
        this.onSplash(d.x, d.z, d.v);
        this.drops.splice(i, 1);
      }
    }
    for (let i = 0; i < this.N; i++) {
      const d = this.drops[i];
      if (d) pos.setXYZ(i, d.x, d.y, d.z);
      else pos.setXYZ(i, 0, -999, 0);
    }
    pos.needsUpdate = true;
  }
}
