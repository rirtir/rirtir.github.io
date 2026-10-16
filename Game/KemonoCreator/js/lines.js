// 内側の線（イラストの線画に近づける後処理）
// 面の向きが急に変わる所（眉骨・マズルの角・あごの線）と、奥行きが急に変わる所（毛束の重なり）に線を引く。
// 輪郭線（反転ハル）・床・背景は layer 1 に置いて、この検出からは外す。
import * as THREE from 'three';
import { LIGHT } from './toon.js';

export const OUTLINE_LAYER = 1;

export class LinePass {
  constructor(renderer) {
    this.renderer = renderer;
    this.color = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType });
    this.nd = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    this.nd.depthTexture = new THREE.DepthTexture(4, 4);
    this.nd.depthTexture.type = THREE.UnsignedIntType;
    this.normalMat = new THREE.MeshNormalMaterial({ flatShading: true });
    // 揺れる毛用: 同じ揺れを足した法線マテリアル（線が毛と一緒に動く）
    this.swayMat = new THREE.MeshNormalMaterial();
    this.swayMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uSway: LIGHT.uSway, uWind: LIGHT.uWind, uTime: LIGHT.uTime });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFlex; uniform vec3 uSway; uniform float uWind; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float f = aFlex * aFlex;
  vec3 w = vec3(sin(uTime * 2.3 + position.x * 41.0 + position.y * 23.0), 0.3 * sin(uTime * 1.9 + position.z * 37.0), cos(uTime * 1.7 + position.z * 31.0 + position.x * 13.0));
  transformed += (uSway + w * 0.0018 * uWind) * f;
}`);
    };
    this.u = {
      tColor: { value: this.color.texture }, tN: { value: this.nd.texture }, tD: { value: this.nd.depthTexture },
      uPx: { value: new THREE.Vector2(1, 1) }, uStr: { value: 0.8 }, uWidth: { value: 1.0 },
      uNear: { value: 0.05 }, uFar: { value: 50 }, uCrease: { value: 0.32 },
    };
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.u, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tColor, tN, tD; uniform vec2 uPx; uniform float uStr, uWidth, uNear, uFar, uCrease;
        varying vec2 vUv;
        float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main(){
          vec4 c = texture2D(tColor, vUv);
          float d0 = texture2D(tD, vUv).r;
          float edge = 0.0;
          if (d0 < 0.99999) {
            vec3 n0 = texture2D(tN, vUv).rgb * 2.0 - 1.0;
            float z0 = lin(d0);
            vec2 o = uPx * uWidth;
            vec2 offs[4];
            offs[0] = vec2(o.x, 0.0); offs[1] = vec2(-o.x, 0.0); offs[2] = vec2(0.0, o.y); offs[3] = vec2(0.0, -o.y);
            for (int i = 0; i < 4; i++) {
              vec2 uv = vUv + offs[i];
              float d1 = texture2D(tD, uv).r;
              if (d1 >= 0.99999) continue;           // 外側の輪郭は別の線が担当
              float z1 = lin(d1);
              vec3 n1 = texture2D(tN, uv).rgb * 2.0 - 1.0;
              float crease = 1.0 - dot(n0, n1);
              float dz = (z1 - z0) / z0;              // 手前側だけ線にする（太らない）
              edge = max(edge, smoothstep(uCrease, uCrease * 1.8, crease));
              edge = max(edge, smoothstep(0.012, 0.03, dz));
            }
          }
          vec3 lineCol = c.rgb * vec3(0.42, 0.34, 0.38);
          gl_FragColor = vec4(mix(c.rgb, lineCol, edge * uStr), 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    this.color.setSize(w, h);
    this.nd.setSize(w, h);
    this.u.uPx.value.set(1 / w, 1 / h);
    this.u.uWidth.value = Math.max(1.0, h / 700);
  }

  render(scene, camera, drawBg) {
    const r = this.renderer;
    this.u.uNear.value = camera.near; this.u.uFar.value = camera.far;
    // 1) 色
    r.setRenderTarget(this.color);
    r.clear();
    drawBg();
    r.render(scene, camera);
    // 2) 法線と奥行き（輪郭線・床は除く）
    const mask = camera.layers.mask;
    camera.layers.disable(OUTLINE_LAYER);
    const bg = scene.background;
    // 揺れる毛だけ揺れ付きの法線マテリアルに差し替え、それ以外は一括で上書き
    const swapped = [];
    scene.traverse((o) => {
      if (o.isMesh && o.geometry.attributes.aFlex && o.layers.test(camera.layers)) { swapped.push([o, o.material]); o.material = this.swayMat; }
    });
    scene.overrideMaterial = null;
    const restoreOther = [];
    scene.traverse((o) => {
      if (o.isMesh && !o.geometry.attributes.aFlex && o.layers.test(camera.layers)) { restoreOther.push([o, o.material]); o.material = this.normalMat; }
    });
    r.setRenderTarget(this.nd);
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    r.setClearColor(0x808080, 1);
    r.clear();
    r.render(scene, camera);
    r.setClearColor(cc, ca);
    for (const [o, m] of swapped) o.material = m;
    for (const [o, m] of restoreOther) o.material = m;
    camera.layers.mask = mask;
    scene.background = bg;
    // 3) 合成
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
