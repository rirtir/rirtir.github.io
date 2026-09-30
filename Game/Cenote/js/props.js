// 岩・倒木・植物・根 など、洞窟を「生きた場所」にする小物の配置
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, caveF, caveGrad, noise3 } from './sdf.js';
import { shared, injectSun, WATER_FILL_GLSL } from './caveMaterial.js';

const loader = new GLTFLoader();
const rand = (() => {
  let s = 987654321;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
})();
const R = (a, b) => a + (b - a) * rand();

function extractParts(scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      parts.push({ geometry: g, material: o.material.clone() });
    }
  });
  return parts;
}

// 世界座標（vWPos）ベースの太陽影・水中減衰を岩や植物にも適用する
function patchProp(mat, opt = {}) {
  mat.customProgramCacheKey = () => `prop-${opt.kind || 'x'}`;
  mat.onBeforeCompile = (shader) => {
    injectSun(shader);
    if (opt.sway) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float hgt = max(0.0, transformed.y);
  vec3 wpos_ = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float w_ = sin(uTime * 1.25 + wpos_.x * 0.9 + wpos_.z * 0.6) + 0.5 * sin(uTime * 2.3 + wpos_.z * 1.7);
  transformed.x += w_ * 0.028 * hgt;
  transformed.z += cos(uTime * 1.1 + wpos_.x * 0.7) * 0.02 * hgt;
}`
      );
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;');
    }
    let frag = shader.fragmentShader;
    if (opt.tint) {
      frag = frag.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float l_ = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(vec3(l_), diffuseColor.rgb, ${opt.desat.toFixed(3)}) * vec3(${opt.tint.map((v) => v.toFixed(3)).join(',')});
  // 水際の濡れ・藻
  float wd_ = vWPos.y - uWaterY;
  diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 1.2, wd_));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.6, 0.3), smoothstep(-0.8, -0.1, wd_) * smoothstep(0.7, 0.0, wd_) * 0.5);
}`
      );
    }
    if (opt.leaf) {
      frag = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  // 葉の透過光（逆光で緑に透ける）
  vec3 nW_ = normalize(vWN) * (gl_FrontFacing ? 1.0 : -1.0);
  float tr_ = max(0.0, dot(nW_, uSunDir));
  float sh_ = sunShadow(vWPos, nW_);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.95, 0.7) * tr_ * sh_ * 3.2 * vec3(0.55, 1.0, 0.35);
}`
      );
    }
    frag = frag.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${WATER_FILL_GLSL}`);
    shader.fragmentShader = frag;
  };
}

function instanced(parts, matrices, { cast = true, receive = true, cull = false } = {}) {
  const grp = new THREE.Group();
  for (const p of parts) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = cull;
    im.castShadow = cast;
    im.receiveShadow = receive;
    if (cast) im.layers.enable(1);
    grp.add(im);
  }
  return grp;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function compose(pos, yaw, scale, tiltDir = null, tiltAmt = 0) {
  _q.setFromAxisAngle(_up, yaw);
  if (tiltDir && tiltAmt > 0) {
    // tiltDir 方向へ up を傾ける
    const t = new THREE.Vector3().copy(_up).lerp(tiltDir, tiltAmt).normalize();
    _q2.setFromUnitVectors(_up, t);
    _q.premultiply(_q2);
  }
  _s.setScalar(scale);
  return new THREE.Matrix4().compose(pos, _q.clone(), _s.clone());
}

// 洞窟の床（岩）へ真上から落とした点
export function dropToFloor(x, z, yStart = 3.5) {
  let y = yStart;
  if (caveF(x, y, z) > 0) return null;
  for (let i = 0; i < 260; i++) {
    const f = caveF(x, y, z);
    if (f > -0.02) break;
    y -= Math.max(0.05, -f * 0.7);
    if (y < -28) return null;
  }
  const g = caveGrad(x, y, z, 0.15, [0, 0, 0]);
  return { pos: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(-g[0], -g[1], -g[2]) };
}

function makeContactShadows(items) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)');
  gr.addColorStop(0.45, 'rgba(0,0,0,0.42)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  im.renderOrder = 1;
  return im;
}

export async function buildProps({ scene, onProgress = () => {} }) {
  const root = new THREE.Group();
  root.name = 'props';
  const base = './assets/models';
  const load = async (n) => (await loader.loadAsync(`${base}/${n}/${n}_1k.gltf`)).scene;

  // ---------- 岩 ----------
  const [boulder, rock09, mossSet, trunk, fern, anth, calath] = await Promise.all([
    load('boulder_01'), load('rock_09'), load('rock_moss_set_01'), load('dead_tree_trunk'),
    load('fern_02'), load('anthurium_botany_01'), load('calathea_orbifolia_01'),
  ]);
  onProgress(0.6);

  const fit = (scene, target) => {
    const b = new THREE.Box3().setFromObject(scene);
    const s = b.getSize(new THREE.Vector3());
    return target / Math.max(s.x, s.y, s.z);
  };
  const rockOpt = { kind: 'rock', tint: [1.08, 1.0, 0.86], desat: 0.32 };

  const rockProtos = [
    { parts: extractParts(boulder), size: 1.0 },
    { parts: extractParts(rock09), size: 1.0 },
  ];
  rockProtos.forEach((r, i) => {
    r.k = fit(i === 0 ? boulder : rock09, 1);
    r.parts.forEach((p) => patchProp(p.material, rockOpt));
  });
  const mossParts = extractParts(mossSet);
  mossParts.forEach((p) => patchProp(p.material, { ...rockOpt, kind: 'rockset', desat: 0.28 }));
  const mossK = fit(mossSet, 1);

  // 岩の配置
  const decals = [];
  const placeRocks = (proto, list) => {
    const mats = [];
    for (const c of list) {
      const d = dropToFloor(c.x, c.z, c.y0 ?? 3.5);
      if (!d) continue;
      const pos = d.pos.clone().addScaledVector(d.normal, -c.sink * c.size * 0.3);
      mats.push(compose(pos, R(0, Math.PI * 2), c.size * proto.k, d.normal, 0.55));
      decals.push(compose(d.pos.clone().addScaledVector(d.normal, 0.05), R(0, 6.28), c.size * 2.8, d.normal, 1.0));
    }
    return mats;
  };

  const boulderList = [];
  const rockList = [];
  const setList = [];
  // 島の周り・浅瀬
  for (let i = 0; i < 26; i++) {
    const a = R(0, Math.PI * 2), r = R(3.2, 9.5);
    const x = 1.2 + Math.cos(a) * r * 1.05, z = 2.0 + Math.sin(a) * r;
    (rand() < 0.5 ? boulderList : rockList).push({ x, z, size: R(0.45, 1.3), sink: 0.7 });
  }
  // 壁際・タルス
  for (let i = 0; i < 60; i++) {
    const a = R(0, Math.PI * 2), rr = R(10, 30);
    const x = -2 + Math.cos(a) * rr * 1.1, z = 0 + Math.sin(a) * rr * 0.85;
    (rand() < 0.6 ? boulderList : rockList).push({ x, z, size: R(0.6, 2.4), sink: 0.5 });
  }
  // 小さな岩の群れ（水際）
  for (let i = 0; i < 30; i++) {
    const a = R(0, Math.PI * 2), r = R(2.6, 6.5);
    setList.push({ x: 1.2 + Math.cos(a) * r, z: 2.0 + Math.sin(a) * r * 0.9, size: R(0.5, 1.1), sink: 0.5 });
  }
  const rocksGroup = new THREE.Group();
  const mb = placeRocks(rockProtos[0], boulderList);
  if (mb.length) rocksGroup.add(instanced(rockProtos[0].parts, mb));
  const mr = placeRocks(rockProtos[1], rockList);
  if (mr.length) rocksGroup.add(instanced(rockProtos[1].parts, mr));
  const ms = [];
  for (const c of setList) {
    const d = dropToFloor(c.x, c.z, 3.5);
    if (!d) continue;
    ms.push(compose(d.pos.clone().addScaledVector(d.normal, -0.05), R(0, 6.28), c.size * mossK * 1.0, d.normal, 0.7));
    decals.push(compose(d.pos.clone().addScaledVector(d.normal, 0.05), R(0, 6.28), c.size * 2.2, d.normal, 1.0));
  }
  if (ms.length) rocksGroup.add(instanced(mossParts, ms));
  root.add(rocksGroup);
  if (decals.length) root.add(makeContactShadows(decals));
  onProgress(0.7);

  // ---------- 沈んだ倒木 ----------
  {
    const parts = extractParts(trunk);
    parts.forEach((p) => patchProp(p.material, { kind: 'trunk', tint: [0.9, 0.85, 0.8], desat: 0.7 }));
    const k = fit(trunk, 7.5);
    const spots = [[-13.5, 7.0, 0.6], [-17.0, 1.5, 2.2], [9.5, -12.0, 5.0]];
    const mats = [];
    for (const [x, z, yaw] of spots) {
      const d = dropToFloor(x, z, 3.0);
      if (!d) continue;
      mats.push(compose(d.pos.clone().addScaledVector(d.normal, 0.15), yaw, k, d.normal, 0.3));
    }
    if (mats.length) root.add(instanced(parts, mats));
  }

  // ---------- 天窓の縁の植物 ----------
  const ferns = new THREE.Group();
  {
    const partsF = extractParts(fern);
    const partsA = extractParts(anth);
    const partsC = extractParts(calath);
    partsF.forEach((p) => patchProp(p.material, { kind: 'fern', sway: true, leaf: true }));
    partsA.forEach((p) => patchProp(p.material, { kind: 'anth', sway: true, leaf: true }));
    partsC.forEach((p) => patchProp(p.material, { kind: 'cal', sway: true, leaf: true }));
    const yTop = WORLD.bounds.max[1] - 0.3;
    const mf = [], ma = [], mc = [];
    const rings = [
      { cx: WORLD.shaft1.x + 0.5, cz: WORLD.shaft1.z, n: 90, r0: 4.4, r1: 9.0, near: 6.0 },
      { cx: WORLD.shaft2.x + 0.3, cz: WORLD.shaft2.z, n: 46, r0: 2.9, r1: 6.5, near: 4.2 },
    ];
    for (const rg of rings) {
      for (let i = 0; i < rg.n; i++) {
        const a = (i / rg.n) * Math.PI * 2 + R(-0.06, 0.06);
        const r = R(rg.r0, rg.r1);
        const pos = new THREE.Vector3(rg.cx + Math.cos(a) * r, yTop + R(-0.2, 0.5), rg.cz + Math.sin(a) * r);
        const inward = new THREE.Vector3(-Math.cos(a), 0.1, -Math.sin(a)).normalize();
        const lean = r < rg.near ? R(0.7, 1.1) : R(0.15, 0.55);
        const m = compose(pos, R(0, 6.28), R(1.5, 3.0), inward, lean);
        const t = rand();
        (t < 0.4 ? mf : t < 0.75 ? ma : mc).push(m);
      }
    }
    if (mf.length) ferns.add(instanced(partsF, mf));
    if (ma.length) ferns.add(instanced(partsA, ma));
    if (mc.length) ferns.add(instanced(partsC, mc));

    // 高い木の樹冠（シルエット用）
    try {
      const pach = await load('pachira_aquatica_01');
      const partsP = extractParts(pach);
      partsP.forEach((p) => patchProp(p.material, { kind: 'pach', sway: true, leaf: true }));
      const mp = [];
      for (const rg of rings) {
        const cnt = rg.n > 60 ? 9 : 5;
        for (let i = 0; i < cnt; i++) {
          const a = (i / cnt) * Math.PI * 2 + R(-0.3, 0.3);
          const r = R(rg.r1 * 0.9, rg.r1 * 1.5);
          const pos = new THREE.Vector3(rg.cx + Math.cos(a) * r, yTop - 0.6, rg.cz + Math.sin(a) * r);
          mp.push(compose(pos, R(0, 6.28), R(3.2, 5.2)));
        }
      }
      ferns.add(instanced(partsP, mp));
    } catch (e) { console.warn('pachira', e); }
  }
  root.add(ferns);
  onProgress(0.85);

  // ---------- 木の根（天窓から垂れ下がる） ----------
  root.add(await buildRoots());
  onProgress(1);
  return root;
}

// ---------- 根っこ ----------
async function buildRoots() {
  const tl = new THREE.TextureLoader();
  const load = (n, cs) =>
    tl.loadAsync(`./assets/tex/${n}`).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = cs;
      t.anisotropy = 8;
      return t;
    });
  const [diff, nor, rgh] = await Promise.all([
    load('bark_diff.jpg', THREE.SRGBColorSpace),
    load('bark_nor.jpg', THREE.NoColorSpace),
    load('bark_rough.jpg', THREE.NoColorSpace),
  ]);
  const mat = new THREE.MeshStandardMaterial({
    map: diff, normalMap: nor, roughness: 1.0, metalness: 0, color: new THREE.Color(0.30, 0.235, 0.18), envMapIntensity: 0.3,
  });
  mat.customProgramCacheKey = () => 'roots';
  mat.onBeforeCompile = (shader) => {
    injectSun(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSway;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float sw_ = aSway;
  transformed.x += sin(uTime * 0.7 + transformed.y * 0.35 + position.z) * 0.10 * sw_;
  transformed.z += cos(uTime * 0.6 + transformed.y * 0.3 + position.x) * 0.08 * sw_;
}`
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n${WATER_FILL_GLSL}`
    );
  };

  const group = new THREE.Group();
  const geos = [];

  // 中心線 → 半径が先細りになるチューブ
  const makeTube = (pts, r0, tubeSeg, radial, salt, uvDiv) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, tubeSeg, 1, radial, false);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const len = curve.getLength();
    const sway = new Float32Array(pos.count);
    for (let v = 0; v <= tubeSeg; v++) {
      const t = v / tubeSeg;
      const c = curve.getPointAt(t);
      const rad = r0 * (1.0 - 0.82 * t) * (1 + 0.18 * Math.sin(t * 40 + salt));
      for (let j = 0; j <= radial; j++) {
        const idx = v * (radial + 1) + j;
        const px = pos.getX(idx) - c.x, py = pos.getY(idx) - c.y, pz = pos.getZ(idx) - c.z;
        pos.setXYZ(idx, c.x + px * rad, c.y + py * rad, c.z + pz * rad);
        uv.setXY(idx, (j / radial) * 1.0, (t * len) / uvDiv);
        sway[idx] = t * t;
      }
    }
    geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    geo.computeVertexNormals();
    return geo;
  };

  const shaftList = [
    { s: WORLD.shaft1, n: 16, fine: 130, rim: [2.2, 3.0], y: [13.5, 17.5], reach: [0.45, 1.0] },
    { s: WORLD.shaft2, n: 9, fine: 60, rim: [1.5, 2.1], y: [10.5, 14.5], reach: [0.5, 1.0] },
  ];
  const fineGeos = [];
  for (const sh of shaftList) {
    const s1 = sh.s;
    for (let i = 0; i < sh.n + sh.fine; i++) {
      const isFine = i >= sh.n;
      const a = R(0, Math.PI * 2);
      const rimR = R(sh.rim[0], sh.rim[1]) + (isFine ? R(-0.3, 0.5) : 0);
      const yStart = R(sh.y[0], sh.y[1] + (isFine ? 1.5 : 0));
      const start = new THREE.Vector3(s1.x + 0.35 + Math.cos(a) * rimR, yStart, s1.z + Math.sin(a) * rimR);
      const reach = isFine ? R(0.2, 1.0) : R(sh.reach[0], sh.reach[1]); // どこまで垂れるか（1 で水面付近）
      const yEnd = 1.5 + (yStart - 1.5) * (1 - reach);
      const pts = [];
      const segs = isFine ? 8 : 14;
      const drift = new THREE.Vector3(R(-2.5, 2.5), 0, R(-2.5, 2.5)).multiplyScalar(isFine ? 0.8 : 1);
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const p = start.clone();
        p.y = yStart + (yEnd - yStart) * t;
        p.x -= (Math.cos(a) * rimR * 0.5) * Math.min(1, t * 2.5);
        p.z -= (Math.sin(a) * rimR * 0.5) * Math.min(1, t * 2.5);
        p.addScaledVector(drift, t * t);
        p.x += (isFine ? 0.22 : 0.35) * noise3(t * 3 + i, 0.5, 1.7 * i);
        p.z += (isFine ? 0.22 : 0.35) * noise3(t * 3 + 9, 0.5 + i, 3.1);
        pts.push(p);
      }
      if (isFine) fineGeos.push(makeTube(pts, R(0.012, 0.03), 28, 4, i, 0.25));
      else {
        const r0 = R(0.05, 0.13);
        geos.push(makeTube(pts, r0, 90, 7, i, r0 * 6.0));
      }
    }
  }
  const add = (list) => {
    if (!list.length) return;
    const g = list.length === 1 ? list[0] : mergeGeometries(list);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.layers.enable(1);
    group.add(m);
  };
  add(geos);
  add(fineGeos);
  return group;
}
