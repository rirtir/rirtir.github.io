// ケモノキャラクリ: エントリーポイント
import * as THREE from 'three';
import { createStage } from './stage.js';
import { loadBodyData } from './body.js';
import { LIGHT } from './toon.js';
import { Character } from './character.js';
import { buildUI } from './ui.js';
import { DEFAULT_STATE } from './schema.js';
import { LinePass } from './lines.js';

const canvas = document.getElementById('view');
const stage = createStage(canvas);
const { renderer, scene, camera, controls } = stage;
const linePass = new LinePass(renderer);
stage.onResize = (w, h) => linePass.setSize(w, h);

const loading = document.getElementById('loading');
const data = await loadBodyData('./assets/');
const chara = new Character(data, scene);
window.__chara = chara;
window.__THREE = THREE;
window.__stage = stage;

// ---- 見た目の一覧（サムネイル）: 1フレームに1枚ずつ、その選択肢を当てた姿を小さく撮る
const THUMB = 160;
const thumbRT = new THREE.WebGLRenderTarget(THUMB, THUMB, { samples: 4 });
thumbRT.texture.colorSpace = THREE.SRGBColorSpace;
const thumbCam = new THREE.PerspectiveCamera(24, 1, 0.05, 30);
thumbCam.layers.enable(1);
const thumbQueue = [];
const thumbBuf = new Uint8Array(THUMB * THUMB * 4);
const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = thumbCanvas.height = THUMB;
function requestThumb(state, framing) {
  return new Promise((resolve) => thumbQueue.push({ state, framing, resolve }));
}
function processThumb(t) {
  const job = thumbQueue.shift();
  if (!job) return;
  const orig = chara.state;
  chara.apply(job.state);
  chara.update(0, t, null);
  const s = chara.scale, yaw = chara.root.rotation.y;
  const hc = chara.headCenterWorld();
  const fr = job.framing;
  let tgt, dist, az;
  if (fr === 'face') { tgt = hc.clone().add(new THREE.Vector3(0, -0.01, 0.02)); dist = 0.85 * s; az = 0.55; }
  else if (fr === 'eye') { tgt = hc.clone().add(new THREE.Vector3(0.0, -0.02 * s, 0.09 * s)); dist = 0.36 * s; az = 0.3; }
  else if (fr === 'back') { tgt = new THREE.Vector3(0, 0.72 * s, -0.22 * s); dist = 2.5 * s; az = Math.PI - 1.35; }
  else if (fr === 'upper') { tgt = new THREE.Vector3(0, 1.32 * s, 0); dist = 1.9 * s; az = 0.35; }
  else { tgt = new THREE.Vector3(0, 0.92 * s, 0); dist = 4.3 * s; az = 0.3; }
  const a = yaw + az;
  thumbCam.position.set(tgt.x + Math.sin(a) * dist, tgt.y + 0.04 * dist, tgt.z + Math.cos(a) * dist);
  thumbCam.lookAt(tgt);
  stage.updateLight(tgt);
  const vp = LIGHT.uViewport.value.clone();
  LIGHT.uViewport.value.set(THUMB * 2.2, THUMB * 2.2);
  LIGHT.uHeadC.value.copy(hc);
  renderer.setRenderTarget(thumbRT);
  renderer.clear();
  renderer.render(stage.bgScene, stage.bgCam);
  renderer.render(scene, thumbCam);
  renderer.readRenderTargetPixels(thumbRT, 0, 0, THUMB, THUMB, thumbBuf);
  renderer.setRenderTarget(null);
  LIGHT.uViewport.value.copy(vp);
  const ctx = thumbCanvas.getContext('2d');
  const img = ctx.createImageData(THUMB, THUMB);
  for (let y = 0; y < THUMB; y++) img.data.set(thumbBuf.subarray((THUMB - 1 - y) * THUMB * 4, (THUMB - y) * THUMB * 4), y * THUMB * 4);
  ctx.putImageData(img, 0, 0);
  job.resolve(thumbCanvas.toDataURL('image/jpeg', 0.85));
  chara.apply(orig);
  chara.update(0, t, camera);
}

const ui = buildUI({ chara, stage, camera, controls, renderer, requestThumb });
window.__ui = ui;
ui.load();
loading.classList.add('done');

window.addEventListener('resize', () => stage.resize());
new ResizeObserver(() => stage.resize()).observe(canvas);
stage.resize();

// 顔の3面プレビュー用カメラ
const faceCams = [0, 1, 2].map(() => { const c = new THREE.PerspectiveCamera(20, 1, 0.05, 20); c.layers.enable(1); return c; });

const clock = new THREE.Timer();
let frame = 0;
function loop() {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsed();
  LIGHT.uTime.value = t;
  stage.bgU.uTime.value = t;
  if (thumbQueue.length) processThumb(t);
  ui.updateCamera(dt);
  controls.update();
  chara.update(dt, t, camera);
  stage.updateLight(chara.focusPoint());
  LIGHT.uHeadC.value.copy(chara.headCenterWorld());

  renderer.setScissorTest(false);
  linePass.u.uStr.value = ui.state.lineStr ?? 0.8;
  if (linePass.u.uStr.value > 0.001) {
    linePass.render(scene, camera, () => renderer.render(stage.bgScene, stage.bgCam));
  } else {
    renderer.clear();
    renderer.render(stage.bgScene, stage.bgCam);
    renderer.render(scene, camera);
  }

  // 3面プレビュー
  if (ui.state.faceViews && !document.body.classList.contains('ui-hidden')) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const narrow = window.innerWidth < 760;
    const sz = narrow ? Math.round(Math.min(84, h * 0.22)) : Math.round(Math.min(150, Math.max(90, h * 0.17)));
    const head = chara.headCenterWorld();
    const yaw = chara.root.rotation.y;
    const angles = [0.0, 0.75, 1.5708];
    const left = ui.faceViewLeft();
    renderer.setScissorTest(true);
    faceCams.forEach((fc, i) => {
      const a = yaw + angles[i];
      const d = (i === 2 ? 1.15 : 0.98) * chara.scale;
      const fwd = (i === 2 ? 0.07 : 0.035) * chara.scale;
      const tx = head.x + Math.sin(yaw) * fwd, tz = head.z + Math.cos(yaw) * fwd;
      fc.position.set(tx + Math.sin(a) * d, head.y + 0.02 * chara.scale, tz + Math.cos(a) * d);
      fc.lookAt(tx, head.y - 0.012 * chara.scale, tz);
      fc.aspect = 1; fc.updateProjectionMatrix();
      const x = narrow ? w - sz - 8 : left, y = h - sz * (i + 1) - 8 * i - (narrow ? 44 : 68);
      renderer.setViewport(x, y, sz, sz);
      renderer.setScissor(x, y, sz, sz);
      renderer.clear();
      renderer.render(stage.bgScene, stage.bgCam);
      if (ui.state.faceViewExpr && i > 0) chara.exprUniforms(i === 1 ? 2 : 4);
      renderer.render(scene, fc);
      chara.restoreExpr();
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }
  frame++;
  if (frame === 3) window.__ready = true;
  requestAnimationFrame(loop);
}
loop();
