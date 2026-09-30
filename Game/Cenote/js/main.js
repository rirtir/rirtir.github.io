import * as THREE from 'three';
import { WORLD, caveF } from './sdf.js';
import { makeCaveMaterial, shared } from './caveMaterial.js';
import { buildStalactites } from './stalactites.js';
import { FlyControls } from './controls.js';
import { Pipeline } from './pipeline.js';
import { makeSky } from './sky.js';
import { buildProps } from './props.js';
import { Particles, Drips } from './particles.js';
import { FishSchool } from './fish.js';
import { CaveAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
const audio = new CaveAudio();
let particles = null, drips = null, school = null;

const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: DEBUG });
} catch (e) {
  $('err').classList.remove('hidden');
  $('err').innerHTML = 'WebGL2 に対応したブラウザで開いてください。<br>（Chrome / Edge / Firefox / Safari の最新版を推奨）';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = params.has('dynshadow');
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
const controls = new FlyControls(camera, canvas);
let pipeline = null;
const world = {};
const quality = { scale: 1, max: 1, mode: 'auto' };

function setProgress(p, text) {
  $('loadfill').style.width = `${Math.round(p * 100)}%`;
  if (text) $('loadtext').textContent = text;
}

// ---------------- テクスチャ ----------------
async function loadTextures() {
  const loader = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const names = ['rockA', 'rockB', 'rockC', 'sand'];
  const out = {};
  const jobs = [];
  for (const n of names) {
    for (const k of ['a', 'n']) {
      jobs.push(
        loader.loadAsync(`./assets/tex/${n}_${k}.jpg`).then((t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = aniso;
          t.colorSpace = k === 'a' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          out[`${n}_${k}`] = t;
        })
      );
    }
  }
  await Promise.all(jobs);
  return out;
}

// ---------------- 洞窟の生成（Worker） ----------------
function generateCave() {
  return new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(new URL('./cave.worker.js', import.meta.url), { type: 'module' });
    } catch (e) { reject(e); return; }
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') setProgress(0.15 + d.p * 0.6);
      else if (d.type === 'done') { w.terminate(); resolve(d); }
    };
    w.onerror = (e) => reject(new Error(e.message || 'worker error'));
    w.postMessage({ cell: params.has('lo') || MOBILE ? 0.4 : 0.32 });
  });
}

// ---------------- シーン構築 ----------------
async function init() {
  setProgress(0.02, '洞窟を掘っています…');
  const [tex, cave] = await Promise.all([loadTextures(), generateCave()]);
  setProgress(0.8, '光を仕込んでいます…');
  if (DEBUG) console.log('cave gen ms', cave.ms, 'verts', cave.mesh.vertexCount);

  shared.uSunDir.value.set(...WORLD.sunDir);
  shared.uWaterY.value = WORLD.waterY;

  const mat = makeCaveMaterial(tex);

  // 洞窟メッシュ
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(cave.mesh.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(cave.mesh.normal, 3));
  g.setAttribute('aAO', new THREE.BufferAttribute(cave.mesh.ao, 1, true));
  g.setIndex(new THREE.BufferAttribute(cave.mesh.index, 1));
  g.computeBoundingSphere();
  const caveMesh = new THREE.Mesh(g, mat);
  caveMesh.castShadow = true;
  caveMesh.receiveShadow = true;
  caveMesh.layers.enable(1);
  scene.add(caveMesh);

  // 鍾乳石
  const stal = new THREE.Mesh(buildStalactites(cave.stalactites), mat);
  stal.castShadow = true;
  stal.receiveShadow = true;
  stal.layers.enable(1);
  scene.add(stal);

  // ---- 岩・倒木・植物・根 ----
  setProgress(0.84, '岩と植物を並べています…');
  const props = await buildProps({ scene, onProgress: (p) => setProgress(0.84 + p * 0.12) });
  scene.add(props);
  world.props = props;

  // ---- 光 ----
  const sunDir = shared.uSunDir.value;
  const sun = new THREE.DirectionalLight(0xfff0dc, 12.0);
  const center = new THREE.Vector3(-13, 0, -20);
  sun.position.copy(center).addScaledVector(sunDir, -130);
  sun.target.position.copy(center);
  sun.castShadow = false; // 影は自前（pipeline の太陽深度マップ）で処理する
  scene.add(sun, sun.target);

  // 天窓の空光（空から差し込む青白い拡散光）
  const sky = new THREE.SpotLight(0xb4d0ff, 190, 0, 1.3, 0.85, 2);
  sky.position.set(3.8, 10.5, -1.0);
  sky.target.position.set(-2, -6, 2);
  sky.castShadow = true;
  sky.shadow.mapSize.set(2048, 2048);
  sky.shadow.camera.near = 1; sky.shadow.camera.far = 90;
  sky.shadow.bias = -0.0004; sky.shadow.normalBias = 0.06; sky.shadow.radius = 5;
  scene.add(sky, sky.target);
  if (params.has('nosky')) sky.visible = false;
  if (params.has('nosun')) sun.visible = false;

  // 光の当たった島・水面からの反射光（暖かい白〜ターコイズ）
  const bounce = new THREE.SpotLight(0xd9fff0, 55, 0, 1.45, 0.9, 2);
  bounce.position.set(1.2, 0.6, 2.0);
  bounce.target.position.set(1.2, 12, 2.0);
  bounce.castShadow = true;
  bounce.shadow.mapSize.set(2048, 2048);
  bounce.shadow.camera.near = 0.5; bounce.shadow.camera.far = 60;
  bounce.shadow.bias = -0.0004; bounce.shadow.normalBias = 0.06; bounce.shadow.radius = 5;
  scene.add(bounce, bounce.target);
  if (params.has('nobounce')) bounce.visible = false;

  // 第二の部屋の天窓
  const sky2 = new THREE.SpotLight(0xb4d0ff, 120, 0, 1.3, 0.85, 2);
  sky2.position.set(-38.2, 7.5, -49.0);
  sky2.target.position.set(-40, -4, -47);
  sky2.castShadow = true;
  sky2.shadow.mapSize.set(1024, 1024);
  sky2.shadow.camera.near = 1; sky2.shadow.camera.far = 60;
  sky2.shadow.bias = -0.0004; sky2.shadow.normalBias = 0.06; sky2.shadow.radius = 5;
  scene.add(sky2, sky2.target);
  const bounce2 = new THREE.SpotLight(0xd9fff0, 40, 0, 1.45, 0.9, 2);
  bounce2.position.set(-40.0, 0.6, -47.3);
  bounce2.target.position.set(-40.0, 10, -47.3);
  bounce2.castShadow = true;
  bounce2.shadow.mapSize.set(1024, 1024);
  bounce2.shadow.camera.near = 0.5; bounce2.shadow.camera.far = 40;
  bounce2.shadow.bias = -0.0004; bounce2.shadow.normalBias = 0.06; bounce2.shadow.radius = 5;
  scene.add(bounce2, bounce2.target);

  // 環境光（洞窟内のごく弱い間接光）
  const env = buildEnvironment(renderer);
  scene.environment = env;
  scene.environmentIntensity = params.has('noenv') ? 0 : 0.35;

  // 空
  const skyMesh = makeSky(sunDir.clone().negate());
  scene.add(skyMesh);
  world.sky = skyMesh;
  world.bounce = bounce;
  world.sun = sun;
  world.center = center;

  // 影（スポットライト）は一度だけ描画する（静的）
  renderer.shadowMap.needsUpdate = true;
  camera.position.set(0, 3, 0);
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);

  // ---- ポストプロセスのパイプライン ----
  const px = renderer.getPixelRatio();
  const area = window.innerWidth * window.innerHeight * px * px;
  const autoScale = Math.min(1, Math.sqrt(3.2e6 / area));
  quality.max = MOBILE ? Math.min(0.75, autoScale) : autoScale;
  quality.scale = parseFloat(params.get('scale') || String(quality.max));
  pipeline = new Pipeline(renderer, scene, camera, {
    waterY: WORLD.waterY,
    sunDir,
    sunCenter: center.clone(),
    sunHalf: 58,
    scale: quality.scale,
    bloom: parseFloat(params.get('bloom') || '0.09'),
    exposureBias: parseFloat(params.get('exp') || '1'),
    dof: params.has('dof') ? true : !MOBILE && !params.has('nodof'),
    volumeSteps: MOBILE ? 24 : 40,
    tone: params.get('tone') || 'aces',
    key: parseFloat(params.get('key') || '0.12'),
    maxExp: parseFloat(params.get('maxexp') || '22'),
  });
  pipeline.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());

  // ---- 粒子・水滴・魚 ----
  particles = new Particles(MOBILE ? 1600 : 3400);
  scene.add(particles.points);
  drips = new Drips(cave.stalactites, WORLD.waterY, (x, z, v) => {
    pipeline.addRipple(x, z, 0.8 + Math.random() * 0.4);
    const dx = x - camera.position.x, dz = z - camera.position.z;
    const d = Math.hypot(dx, dz);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const pan = d > 0.1 ? (dx * right.x + dz * right.z) / d : 0;
    audio.drip(pan * 0.8, Math.min(1, 1.6 / (1 + d / 5)));
  });
  scene.add(drips.points);
  school = new FishSchool(new THREE.Vector3(-4.2, -2, 3.0), MOBILE ? 36 : 70);
  school.init(caveF);
  scene.add(school.mesh);

  // ---- カメラ ----
  onResize();
  const s = WORLD.start;
  controls.pos.set(...s.pos);
  controls.lookAt(...s.look);
  const cp = params.get('cam');
  if (cp) {
    const v = cp.split(',').map(Number);
    controls.setPose(v[0], v[1], v[2], THREE.MathUtils.degToRad(v[3] || 0), THREE.MathUtils.degToRad(v[4] || 0));
  }

  setTimeOfDay(0.5);
  setProgress(1, '準備ができました');
  window.__cenote = { scene, camera, renderer, controls, shared, THREE, sun, sky, quality, audio, setTOD: (t) => setTimeOfDay(t), get pipeline() { return pipeline; } };
  return { tex };
}

function buildEnvironment(renderer) {
  const es = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        // 洞窟の天井・壁：暖かい灰色、下方：水の青緑
        vec3 wall = vec3(0.10, 0.088, 0.076);
        vec3 water = vec3(0.03, 0.05, 0.055);
        vec3 c = mix(water, wall, smoothstep(-0.35, 0.15, d.y));
        // 天窓の空
        vec3 hole = normalize(vec3(0.15, 0.95, 0.0));
        c += vec3(0.5, 0.62, 0.8) * 0.5 * smoothstep(0.75, 1.0, dot(d, hole));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  es.add(new THREE.Mesh(geo, m));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(es, 0.0);
  pm.dispose();
  return rt.texture;
}

// ---------------- リサイズ ----------------
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w >= h ? 58 : 58 + (1 - w / h) * 45;
  camera.updateProjectionMatrix();
  if (pipeline) pipeline.setSize(w, h, renderer.getPixelRatio());
}
window.addEventListener('resize', onResize);


// ---------------- 時刻（太陽の動き） ----------------
const TOD = { t: 0.5, auto: false };
const _S = new THREE.Vector3();
function setTimeOfDay(t) {
  TOD.t = t;
  const e = THREE.MathUtils.degToRad(52 + 21 * Math.sin(Math.PI * t));
  const phi = THREE.MathUtils.degToRad(-130 + 175 * t);
  _S.set(Math.cos(phi) * Math.cos(e), Math.sin(e), Math.sin(phi) * Math.cos(e));
  shared.uSunDir.value.copy(_S).negate();
  if (world.sun) {
    world.sun.position.copy(world.center).addScaledVector(_S, 130);
    world.sun.target.position.copy(world.center);
    const warm = THREE.MathUtils.smoothstep(Math.sin(e), 0.78, 0.96);
    const col = new THREE.Color().setRGB(1.0, 0.8 + 0.15 * warm, 0.58 + 0.28 * warm);
    world.sun.color.copy(col);
    world.sun.intensity = 12 * (0.78 + 0.22 * Math.sin(e));
    if (world.sky) world.sky.material.uniforms.uToSun.value.copy(_S);
    if (pipeline) pipeline.setSun(new THREE.Vector3(col.r, col.g, col.b));
  }
  // 表示用の時刻（9:30〜14:30 くらい）
  const hours = 12 + (t - 0.5) * 6.6;
  const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
  $('todlabel').textContent = `${hh}:${String(mm).padStart(2, '0')}`;
  $('tod').value = t;
}
$('tod').addEventListener('input', (e) => setTimeOfDay(parseFloat(e.target.value)));
$('todauto').addEventListener('click', () => toggleAuto());
function toggleAuto() {
  TOD.auto = !TOD.auto;
  $('todauto').textContent = TOD.auto ? '❚❚' : '▶';
  toast(TOD.auto ? '時間が流れています' : '時間を止めました', 1400);
}

// ---------------- 見どころへのジャンプ ----------------
const VIEWS = [
  { name: '光の柱', pos: [-8.5, 1.3, 9.0], look: [1.2, 6.0, 1.5] },
  { name: '水中の窓', pos: [-6.0, -3.5, 5.0], look: [-2.3, 0.7, 2.9] },
  { name: '天窓を見上げる', pos: [1.5, 1.0, 2.0], look: [2.6, 11.0, 1.6] },
  { name: '水路のアーチ', pos: [-30.0, 1.5, -32.0], look: [-27.4, 3.6, -24.7] },
  { name: '奥の部屋', pos: [-34.0, 1.4, -41.0], look: [-40.0, 2.5, -47.0] },
];
(function buildViews() {
  const box = $('views');
  VIEWS.forEach((v, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<b>${i + 1}</b>${v.name}`;
    b.addEventListener('click', () => goView(i));
    box.appendChild(b);
  });
})();
function goView(i) {
  const v = VIEWS[i];
  if (!v) return;
  controls.flyToLook(v.pos, v.look, 2.8);
  toast(v.name, 1600);
}
if (MOBILE) document.body.classList.add('touch');
(function touchButtons() {
  const bind = (id, val) => {
    const el = $(id);
    const on = (e) => { e.preventDefault(); controls.touch.up = val; };
    const off = (e) => { e.preventDefault(); controls.touch.up = 0; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  };
  bind('tbUp', 1);
  bind('tbDown', -1);
})();

// ---------------- HUD ----------------
let hudVisible = true;
let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function takePhoto() {
  if (!pipeline) return;
  const fl = document.createElement('div');
  fl.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:.85;z-index:40;transition:opacity .6s;pointer-events:none';
  document.body.appendChild(fl);
  requestAnimationFrame(() => { fl.style.opacity = '0'; setTimeout(() => fl.remove(), 700); });
  pipeline.render(0, { focus: world.focus });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cenote_${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
  toast('📷 写真を保存しました');
}

window.addEventListener('keydown', (e) => {
  if (!controls.enabled) return;
  if (e.code === 'KeyP') takePhoto();
  else if (e.code === 'KeyH') {
    hudVisible = !hudVisible;
    $('hud').classList.toggle('hidden', !hudVisible);
  } else if (e.code === 'KeyM') {
    audio.setMuted(!audio.muted);
    toast(audio.muted ? '🔇 ミュート' : '🔊 サウンド ON');
  } else if (e.code === 'KeyG') {
    cycleQuality();
  } else if (e.code === 'KeyF' && pipeline) {
    pipeline.cfg.dof = !pipeline.cfg.dof;
    toast(pipeline.cfg.dof ? '被写界深度 ON' : '被写界深度 OFF');
  }
});
function applyScale(ns) {
  quality.scale = ns;
  pipeline.cfg.scale = ns;
  pipeline.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
}
function cycleQuality() {
  const modes = ['auto', 'high', 'low'];
  quality.mode = modes[(modes.indexOf(quality.mode) + 1) % modes.length];
  if (quality.mode === 'high') { applyScale(quality.max); pipeline.cfg.dof = !MOBILE; }
  else if (quality.mode === 'low') { applyScale(Math.max(0.45, quality.max * 0.6)); pipeline.cfg.dof = false; }
  toast(`画質: ${{ auto: '自動', high: '高（固定）', low: '軽量' }[quality.mode]}`, 1600);
}
controls.onSpeed = (v) => toast(`移動速度 ×${v.toFixed(2)}`, 900);

// ---------------- メインループ ----------------
let last = performance.now();
let frames = 0;
let acc = 0, accN = 0, lastAdjust = 0;
let wasUnder = false;
const introT0 = performance.now();
const focusDir = new THREE.Vector3();

const _fd = new THREE.Vector3();
function rayDist(dir) {
  let d = 0.5;
  const p = camera.position;
  for (let i = 0; i < 36; i++) {
    const f = caveF(p.x + dir.x * d, p.y + dir.y * d, p.z + dir.z * d);
    if (f > -0.05) break;
    d += Math.max(0.15, -f * 0.9);
    if (d > 40) break;
  }
  if (dir.y * (WORLD.waterY - p.y) > 0.001) {
    const tw = (WORLD.waterY - p.y) / dir.y;
    if (tw > 0 && tw < d) d = tw;
  }
  return d;
}
function updateFocus(dt) {
  // 画面中央と周辺 4 方向の距離の中央値にピントを合わせる（穴の向こう側などへ飛ばないように）
  camera.getWorldDirection(focusDir);
  const right = new THREE.Vector3().crossVectors(focusDir, camera.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, focusDir).normalize();
  const ds = [rayDist(focusDir)];
  for (const [a, b] of [[0.18, 0], [-0.18, 0], [0, 0.12], [0, -0.12]]) {
    _fd.copy(focusDir).addScaledVector(right, a).addScaledVector(up, b).normalize();
    ds.push(rayDist(_fd));
  }
  ds.sort((x, y) => x - y);
  const d = Math.max(1.2, Math.min(16, ds[2]));
  const cur = world.focus || d;
  world.focus = cur + (d - cur) * (1 - Math.exp(-dt * 2.5));
}

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  shared.uTime.value += dt;

  if (!controls.enabled && !params.has('cam')) {
    // タイトル画面：ゆっくり漂うカメラ
    const t = (now - introT0) / 1000;
    const s = WORLD.start;
    controls.pos.set(s.pos[0] + Math.sin(t * 0.13) * 0.9, s.pos[1] + Math.sin(t * 0.21) * 0.12, s.pos[2] + Math.cos(t * 0.11) * 0.7);
    controls.lookAt(s.look[0] + Math.sin(t * 0.09) * 0.6, s.look[1] + Math.sin(t * 0.17) * 0.4, s.look[2]);
  } else {
    controls.update(dt);
  }
  if (TOD.auto) {
    let nt = TOD.t + dt * 0.012;
    if (nt > 0.88) nt = 0.12;
    setTimeOfDay(nt);
  }
  if (world.sky) world.sky.position.copy(camera.position);
  if (particles) particles.update(camera, renderer.getPixelRatio() * quality.scale * window.innerHeight / 900);
  if (drips) drips.update(dt, camera, caveF);
  if (school) school.update(dt, caveF);
  if (pipeline.cfg.dof) updateFocus(dt);

  // 水面をまたいだときの演出・音
  const under = camera.position.y < WORLD.waterY - 0.02;
  if (under !== wasUnder) {
    wasUnder = under;
    audio.setUnderwater(under);
    if (controls.enabled) toast(under ? '水中へ' : '水面へ', 1200);
    if (pipeline) {
      pipeline.addRipple(camera.position.x, camera.position.z, 2.2);
      setTimeout(() => pipeline && pipeline.addRipple(camera.position.x + 0.3, camera.position.z - 0.2, 1.4), 220);
    }
    if (!under && controls.enabled) world.wet = 1;
  }
  audio.update(dt);

  // HUD：水深
  if (hudVisible && controls.enabled && (frames & 7) === 0) {
    const y = camera.position.y - WORLD.waterY;
    $('depth').textContent = y < 0 ? `水深 ${(-y).toFixed(1)} m` : `水面から +${y.toFixed(1)} m`;
  }

  world.wet = Math.max(0, (world.wet || 0) - dt / 3.2);
  pipeline.render(dt, { focus: world.focus, wet: world.wet });
  frames++;

  // 動的解像度：フレーム時間を見て負荷に追従する
  acc += dt; accN++;
  if (accN >= 45) {
    const avg = (acc / accN) * 1000;
    acc = 0; accN = 0;
    if (now - lastAdjust > 1800 && !params.has('scale') && quality.mode === 'auto') {
      let ns = quality.scale;
      if (avg > 25 && ns > 0.45) ns = Math.max(0.45, ns * 0.86);
      else if (avg < 13.2 && ns < quality.max) ns = Math.min(quality.max, ns * 1.07);
      if (Math.abs(ns - quality.scale) > 0.01) {
        quality.scale = ns;
        pipeline.cfg.scale = ns;
        pipeline.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
        lastAdjust = now;
      }
    }
  }
  if (frames === 3) window.__ready = true;
  requestAnimationFrame(loop);
}

init()
  .then(() => {
    $('loadwrap').classList.add('hidden');
    $('start').classList.remove('hidden');
    requestAnimationFrame(loop);
    if (params.has('skipintro')) {
      $('intro').classList.add('done');
      $('hud').classList.remove('hidden');
      controls.enabled = true;
    }
  })
  .catch((e) => {
    console.error(e);
    $('err').classList.remove('hidden');
    $('err').innerHTML = `読み込みに失敗しました。<br><small>${String(e.message || e)}</small>`;
  });

$('start').addEventListener('click', () => {
  $('intro').classList.add('done');
  $('hud').classList.remove('hidden');
  controls.enabled = true;
  canvas.focus();
  audio.start();
  setTimeout(() => $('help').classList.add('fade'), 14000);
  if (canvas.requestPointerLock && !MOBILE) { try { canvas.requestPointerLock(); } catch (_) { /* noop */ } }
});
document.addEventListener('visibilitychange', () => { if (audio.ctx) (document.hidden ? audio.ctx.suspend() : audio.ctx.resume()); });
