// ケモノキャラクリ: エントリーポイント
import * as THREE from 'three';
import { createStage } from './stage.js';
import { loadBodyData } from './body.js';
import { LIGHT } from './toon.js';
import { Character } from './character.js';
import { buildUI } from './ui.js';
import { DEFAULT_STATE } from './schema.js';

const canvas = document.getElementById('view');
const stage = createStage(canvas);
const { renderer, scene, camera, controls } = stage;

const loading = document.getElementById('loading');
const data = await loadBodyData('./assets/');
const chara = new Character(data, scene);
window.__chara = chara;
window.__THREE = THREE;
window.__stage = stage;

const ui = buildUI({ chara, stage, camera, controls, renderer });
window.__ui = ui;
ui.load();
loading.classList.add('done');

window.addEventListener('resize', () => stage.resize());
new ResizeObserver(() => stage.resize()).observe(canvas);
stage.resize();

// 顔の3面プレビュー用カメラ
const faceCams = [0, 1, 2].map(() => new THREE.PerspectiveCamera(20, 1, 0.05, 20));

const clock = new THREE.Timer();
let frame = 0;
function loop() {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsed();
  LIGHT.uTime.value = t;
  stage.bgU.uTime.value = t;
  ui.updateCamera(dt);
  controls.update();
  chara.update(dt, t, camera);
  stage.updateLight(chara.focusPoint());
  LIGHT.uHeadC.value.copy(chara.headCenterWorld());

  renderer.setScissorTest(false);
  renderer.clear();
  renderer.render(stage.bgScene, stage.bgCam);
  renderer.render(scene, camera);

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
