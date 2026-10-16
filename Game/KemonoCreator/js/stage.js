// 撮影ステージ（背景・床・ライト・カメラ）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { LIGHT } from './toon.js';

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  camera.layers.enable(1);
  camera.position.set(0.0, 1.25, 4.6);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.45;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.screenSpacePanning = true;

  // キーライト（カメラ基準で回す）
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -1.3; sc.right = 1.3; sc.top = 1.3; sc.bottom = -1.3; sc.near = 0.1; sc.far = 10;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 2;
  scene.add(key, key.target);
  const lightRig = { azimuth: -0.55, elevation: 0.62 };

  // 床（影を受ける円）
  const floorGroup = new THREE.Group();
  scene.add(floorGroup);
  const shadowFloor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.ShadowMaterial({ color: 0x3a3060, opacity: 0.28 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = 0.001;
  shadowFloor.receiveShadow = true;
  shadowFloor.layers.set(1);
  floorGroup.add(shadowFloor);

  // 背景（フルスクリーンのグラデーション＋光の粒）
  const bgU = {
    uTop: { value: new THREE.Color('#eef0f3') }, uBot: { value: new THREE.Color('#a9afb8') },
    uAcc: { value: new THREE.Color('#ffffff') }, uMode: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 },
  };
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: bgU, depthWrite: false, depthTest: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uBot, uAcc; uniform float uMode, uTime, uAspect; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 uv = vUv; vec3 c = mix(uBot, uTop, smoothstep(0.0, 1.0, uv.y));
        vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y - 0.42);
        if (uMode < 0.5) {
          // 明るいグレー：中央の光だまり＋細い同心円
          c += vec3(0.07) * exp(-dot(p, p) * 3.0);
          float r = length(p * vec2(1.0, 1.0));
          float ring = smoothstep(0.004, 0.0, abs(fract(r * 3.2 - uTime * 0.02) - 0.5) - 0.497);
          c = mix(c, uAcc, ring * 0.12 * smoothstep(1.2, 0.2, r));
          // 光の粒
          vec2 g = uv * vec2(uAspect, 1.0) * 26.0; vec2 id = floor(g); vec2 f = fract(g) - 0.5;
          float s = h(id); vec2 o = vec2(h(id + 3.1), h(id + 7.7)) - 0.5;
          float tw = 0.5 + 0.5 * sin(uTime * (0.6 + s * 1.5) + s * 30.0);
          float d = length(f - o * 0.6);
          c += vec3(1.0) * smoothstep(0.06, 0.0, d) * step(0.86, s) * tw * 0.35;
        } else {
          // 星空：紫の夜空＋星
          c += vec3(0.25, 0.1, 0.4) * exp(-dot(p - vec2(0.0, -0.2), p - vec2(0.0, -0.2)) * 2.5) * 0.6;
          for (int L = 0; L < 2; L++) {
            float sc2 = 40.0 + float(L) * 50.0;
            vec2 g = uv * vec2(uAspect, 1.0) * sc2; vec2 id = floor(g); vec2 f = fract(g) - 0.5;
            float s = h(id + float(L) * 17.0); vec2 o = vec2(h(id + 1.3), h(id + 9.1)) - 0.5;
            float tw = 0.55 + 0.45 * sin(uTime * (0.8 + s * 2.0) + s * 40.0);
            float d = length(f - o * 0.7);
            c += mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.8, 0.95), s) * smoothstep(0.08 - float(L) * 0.03, 0.0, d) * step(0.9 - float(L) * 0.04, s) * tw;
          }
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  bg.frustumCulled = false;
  const bgScene = new THREE.Scene();
  bgScene.add(bg);
  const bgCam = new THREE.Camera();

  // ステージの円盤（星空テーマ用の光る輪）
  const ringMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uCol: { value: new THREE.Color('#b9a8ff') }, uTime: bgU.uTime, uOn: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform vec3 uCol; uniform float uTime, uOn; varying vec2 vUv;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float disc = smoothstep(1.0, 0.96, r) * 0.18 * (1.0 - r * 0.6);
        float ring = smoothstep(0.012, 0.0, abs(r - 0.97)) * 0.9 + smoothstep(0.008, 0.0, abs(r - 0.82)) * 0.35;
        float a = (disc + ring) * uOn;
        gl_FragColor = vec4(uCol * (0.6 + ring), a);
        #include <colorspace_fragment>
      }`,
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0;
  ring.renderOrder = -1;
  ring.layers.set(1);
  floorGroup.add(ring);

  const themes = {
    light: { top: '#f1f2f5', bot: '#a3a9b3', acc: '#ffffff', mode: 0, ring: 0, shadow: '#3a3060', shade: [0.66, 0.6, 0.8], rim: 0.3, fill: [0.55, 0.62, 0.85], key: [1.0, 0.97, 0.93] },
    night: { top: '#1d1238', bot: '#08081c', acc: '#ffffff', mode: 1, ring: 1, shadow: '#05020f', shade: [0.55, 0.5, 0.78], rim: 0.6, fill: [0.6, 0.5, 0.95], key: [1.0, 0.95, 0.95] },
  };
  function setTheme(name) {
    const t = themes[name] || themes.light;
    bgU.uTop.value.set(t.top); bgU.uBot.value.set(t.bot); bgU.uAcc.value.set(t.acc); bgU.uMode.value = t.mode;
    ringMat.uniforms.uOn.value = t.ring;
    shadowFloor.material.color.set(t.shadow);
    shadowFloor.material.opacity = t.mode ? 0.5 : 0.28;
    LIGHT.uShadeMul.value.setRGB(...t.shade);
    LIGHT.uRimStr.value = t.rim;
    LIGHT.uFillCol.value.setRGB(...t.fill);
    LIGHT.uKeyCol.value.setRGB(...t.key);
  }

  const tmpV = new THREE.Vector3();
  function updateLight(focus) {
    // カメラの向きに対してキーライトを固定（左上前から）
    const camDir = tmpV.subVectors(camera.position, controls.target).setY(0).normalize();
    const az = Math.atan2(camDir.x, camDir.z) + lightRig.azimuth;
    const el = lightRig.elevation;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    key.target.position.copy(focus);
    key.position.copy(focus).addScaledVector(dir, 4);
    key.target.updateMatrixWorld();
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    LIGHT.uViewport.value.set(w * pr, h * pr);
    if (stage.onResize) stage.onResize(w * pr, h * pr);
    bgU.uAspect.value = w / h;
  }

  const stage = { renderer, scene, camera, controls, key, lightRig, bgScene, bgCam, bgU, setTheme, updateLight, resize, floorGroup };
  return stage;
}
