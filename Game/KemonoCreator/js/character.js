// キャラクター全体（体・服・パーツ・ポーズ・表情・待機モーション）
import * as THREE from 'three';
import { Body } from './body.js';
import { makeToon, makeBodyUniforms, LIGHT } from './toon.js';
import { GeoBuilder, addTuft, buildEar, buildNose, Tail, EAR_TYPES } from './parts.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const col = (h) => new THREE.Color(h);

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// 服（体を法線方向に少しふくらませた殻。範囲はシェーダーで切り抜く）
const SHELL_PARS = /* glsl */`
uniform vec4 uTop; uniform vec4 uBot; uniform vec3 uTopCol, uBotCol, uBeltCol, uTrimCol; uniform vec4 uArmA, uArmD;
vec3 kcCloth() {
  vec3 p = vPos;
  float head = vMaskA.g, armT = vMaskB.x, legT = vMaskB.y;
  float waist = 1.005;
  if (head > 0.35) discard;
  // 下（裾は高さで水平に切る）
  float hemY = uBot.x < 0.5 ? 0.665 : (uBot.x < 1.5 ? 0.47 : 0.105);
  bool inBot = p.y < waist && armT < 0.001 && p.y > hemY && vMaskA.a < 0.5;
  if (inBot) {
    vec3 c = uBotCol;
    float hem = smoothstep(hemY + 0.022, hemY + 0.012, p.y);
    c *= 1.0 - 0.18 * hem;
    if (uBot.y > 0.5 && p.y > waist - 0.042) {
      c = uBeltCol;
      if (abs(p.x) < 0.024 && p.z > 0.0) c = vec3(0.86, 0.72, 0.36);
    }
    c *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.004, abs(p.x))) * step(0.0, p.z);
    // 横のライン
    if (uBot.z > 0.5 && p.y < waist - 0.045) {
      float side = atan(p.z, abs(p.x) - 0.05);
      float st = 1.0 - smoothstep(0.1, 0.13, abs(side + 0.05));
      c = mix(c, uTrimCol, st * step(0.06, abs(p.x)));
    }
    return c;
  }
  // 上
  if (uTop.x < 0.5) discard;
  float sLen = uTop.x < 1.5 ? -1.0 : (uTop.x < 2.5 ? 0.24 : 0.97);
  bool jacket = uTop.x > 3.5;
  vec3 pa = vec3(abs(p.x), p.y, p.z);
  float at = armT > 0.0 ? dot(pa - uArmA.xyz, uArmD.xyz) / uArmA.w : 0.0;
  bool sleeveOK = sLen < 0.0 ? (armT < 0.001 && abs(p.x) < 0.175) : (at < sLen);
  float frontV = max(0.0, 1.0 - abs(p.x) / 0.11) * step(0.0, p.z);
  float neckY = 1.475 - 0.02 * step(0.0, p.z) - uTop.y * 0.16 * frontV + (jacket ? 0.03 : 0.0) + 0.1 * smoothstep(0.07, 0.17, abs(p.x));
  // ジャケット: 前を開ける（上ほど広く）
  float openW = 0.035 + 0.075 * smoothstep(1.05, 1.45, p.y) * (0.4 + uTop.y);
  if (jacket && p.z > 0.0 && abs(p.x) < openW && armT < 0.001) discard;
  if (p.y > waist - 0.06 && p.y < neckY && sleeveOK && legT < 0.001 && vMaskA.a < 0.5) {
    vec3 c = uTopCol;
    float e = smoothstep(neckY - 0.022, neckY - 0.01, p.y);
    if (jacket) {
      // 前立てと襟の縁取り
      float edge = 1.0 - smoothstep(0.012, 0.018, abs(p.x) - openW);
      if (p.z > 0.0 && armT < 0.001) c = mix(c, uTrimCol, edge);
      if (p.y > neckY - 0.03) c = uTrimCol;
      if (armT > 0.0 && at > 0.9) c = uTrimCol;
      e = 0.0;
    }
    if (sLen > 0.0 && armT > 0.0) e = max(e, smoothstep(sLen - 0.05, sLen - 0.025, at));
    if (sLen < 0.0) e = max(e, smoothstep(0.155, 0.17, abs(p.x)) * step(1.3, p.y));
    c *= 1.0 - 0.2 * e;
    return c;
  }
  discard;
  return vec3(0.0);
}
`;

// パーツの作り直しが不要な項目
const NON_PART = /^(lineStr|muscleLine|faceViewExpr|eye|iris|pupil|highlight|sclera|lid|lashes|brow|mouth|smile|omega|philtrum|fang|pattern|backMark|foreheadMark|jag|furJag|furFringe|furDens|topColor|trimColor|topNeck|pantStripe|bottom|belt|pose|idle|lookCam|expr|blink|theme|faceViews|turntable|outlineW|anime|shade|rim|faceSoft|light|padColor|muzzleCover|height|whiskerDots)/;

export class Character {
  constructor(data, scene) {
    this.data = data;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.bodyU = makeBodyUniforms();
    this.mats = {
      body: makeToon('body', { bodyUniforms: this.bodyU }),
      bodyO: makeToon('body', { bodyUniforms: this.bodyU, outline: true }),
      part: makeToon('part'),
      partO: makeToon('part', { outline: true }),
      hair: makeToon('hair', {
        colorHook: `col += albedo * 0.28 * smoothstep(0.9, 0.93, dot(N, normalize(kcL + V))) ;`,
      }),
      hairO: makeToon('hair', { outline: true }),
      nose: makeToon('nose', {
        uniforms: { uGloss: { value: 1.0 } },
        fragPars: 'uniform float uGloss;',
        colorHook: `{
          float hl = smoothstep(0.972, 0.98, dot(N, normalize(vec3(-0.38, 0.6, 0.7))));
          float hl2 = smoothstep(0.991, 0.995, dot(N, normalize(vec3(0.32, 0.42, 0.85))));
          col = mix(col, vec3(1.0), clamp((hl * 0.9 + hl2 * 0.6) * uGloss, 0.0, 1.0));
          col = mix(col, albedo * 1.15, 0.25);
        }`,
      }),
      noseO: makeToon('nose', { outline: true }),
      whisker: makeToon('part', { key: 'whisker', colorHook: 'col = mix(col, albedo, 0.6);' }),
    };
    this.shellU = {
      uTop: { value: new THREE.Vector4(0, 0.3, 0, 0) }, uBot: { value: new THREE.Vector4(1, 1, 0, 0) },
      uArmA: { value: new THREE.Vector4() }, uArmD: { value: new THREE.Vector4() },
      uTopCol: { value: col('#3d5a80') }, uTrimCol: { value: col('#d9b45a') }, uBotCol: { value: col('#2e3440') }, uBeltCol: { value: col('#7a5230') },
    };
    {
      const J = data.meta.joints;
      const sh = V(...J['upperarm.L']), el = V(...J['forearm.L']), wr = V(...J['hand.L']);
      const len = sh.distanceTo(el) + el.distanceTo(wr);
      this.shellU.uArmA.value.set(sh.x, sh.y, sh.z, len);
      const d = wr.clone().sub(sh).normalize();
      this.shellU.uArmD.value.set(d.x, d.y, d.z, 0);
    }
    this.mats.shell = makeToon('shell', { uniforms: this.shellU, fragPars: SHELL_PARS, albedoHook: 'albedo = kcCloth();' });
    this.mats.shellO = makeToon('shell', { uniforms: this.shellU, fragPars: SHELL_PARS, albedoHook: 'albedo = kcCloth();', outline: true });
    this.mats.shellO.userData.outlineScale.value = 0.8;

    this.mats.fur = makeToon('body', { bodyUniforms: this.bodyU, furHull: true, side: THREE.BackSide, key: 'fur' });
    this.body = new Body(data, this.mats.body, this.mats.bodyO);
    this.root.add(this.body.mesh);
    // 毛の輪郭（裏面だけ描く、ノイズでふくらませた殻）
    this.furHull = new THREE.SkinnedMesh(this.body.geometry, this.mats.fur);
    this.furHull.frustumCulled = false;
    this.furHull.layers.set(1);
    this.furHull.morphTargetInfluences = this.body.mesh.morphTargetInfluences;
    this.furHull.morphTargetDictionary = this.body.mesh.morphTargetDictionary;
    this.furHull.receiveShadow = true;
    this.body.mesh.add(this.furHull);
    this.furHull.bind(this.body.skeleton, new THREE.Matrix4());
    this.bones = this.body.bones;
    this._makeShell();

    // ボーンごとのパーツ置き場
    this.groups = {};
    for (const name of Object.keys(this.bones)) {
      const g = new THREE.Group();
      g.name = 'parts:' + name;
      this.bones[name].add(g);
      this.groups[name] = g;
    }
    this.parts = [];
    this.tail = new Tail();
    this.tailMesh = null;
    this.state = null;
    this.dirty = { body: true, parts: true };
    this.anim = { blink: 0, nextBlink: 2, look: new THREE.Vector2(), earT: 0, nextEar: 3, expr: {} };
    this.scale = 1;
    this._boneVerts = {};
    this._tmpP = new THREE.Vector3(); this._tmpN = new THREE.Vector3();
  }

  _makeShell() {
    const d = this.data, n = d.meta.vertexCount;
    const t = 0.0065;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = d.position[i] + d.normal[i] * t;
    const g = new THREE.BufferGeometry();
    const src = this.body.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    for (const k of ['normal', 'skinIndex', 'skinWeight', 'maskA', 'maskB']) g.setAttribute(k, src.attributes[k]);
    g.setIndex(src.index);
    g.morphAttributes.position = d.morphP.map((dp, k) => {
      const dn = d.morphN[k];
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n * 3; i++) a[i] = dp[i] + dn[i] * t;
      return new THREE.BufferAttribute(a, 3);
    });
    g.morphAttributes.normal = src.morphAttributes.normal;
    g.morphTargetsRelative = true;
    g.boundingSphere = src.boundingSphere;
    const mk = (mat) => {
      const m = new THREE.SkinnedMesh(g, mat);
      m.frustumCulled = false;
      m.morphTargetInfluences = this.body.mesh.morphTargetInfluences;
      m.morphTargetDictionary = this.body.mesh.morphTargetDictionary;
      this.body.mesh.add(m);
      m.bind(this.body.skeleton, new THREE.Matrix4());
      return m;
    };
    this.shell = mk(this.mats.shell);
    this.shell.castShadow = true;
    this.shellO = mk(this.mats.shellO);
    this.shell.layers.set(1);
    this.shellO.layers.set(1);
  }

  // ---------------------------------------------------------------- 状態の反映
  apply(st) {
    const prev = this.state;
    st = { ...st };
    this.state = st;
    const sliders = this.data.meta.sliders;
    const bodyKeys = Object.keys(sliders);
    if (!prev || bodyKeys.some(k => prev[k] !== st[k])) this.dirty.body = true;
    if (!prev || Object.keys(st).some(k => prev[k] !== st[k] && !NON_PART.test(k))) this.dirty.parts = true;
    this._applyUniforms();
  }

  _applyUniforms() {
    const st = this.state, U = this.bodyU, meta = this.data.meta;
    U.uColMain.value.set(st.furMain); U.uColSub.value.set(st.furSub); U.uColAccent.value.set(st.furAccent);
    U.uColPad.value.set(st.padColor); U.uColPattern.value.set(st.patternColor);
    U.uMark.value.set(st.bellyW, st.muzzleCover, st.sockArm > 0.001 ? 1.0 - st.sockArm * 0.45 : 2.0, st.sockLeg > 0.001 ? 1.0 - st.sockLeg * 0.5 : 2.0);
    U.uMark2.value.set(st.pattern, st.patternScale, st.patternAmt, st.jag);
    U.uMark3.value.set(st.eyeMask, st.backMark, st.cheekWhite, st.foreheadMark);
    // 目
    const e = meta.eyes.L;
    const c = V(...e.pos), n = V(...e.normal), dir = V(...e.dir);
    const Ne = n.clone().lerp(dir, 0.5).normalize();
    const R = new THREE.Vector3().crossVectors(V(0, 1, 0), Ne).normalize();
    const Up = new THREE.Vector3().crossVectors(Ne, R).normalize();
    U.uEyeC.value.copy(c); U.uEyeR.value.copy(R); U.uEyeU.value.copy(Up); U.uEyeN.value.copy(Ne);
    const ex = this._exprMods();
    U.uEyeA.value.set(st.eyeSize * (ex.size || 1), st.eyeAspect * (ex.aspect || 1), st.eyeTilt + (ex.tilt || 0), st.eyeX);
    U.uEyeB.value.set(st.eyeUpper, st.eyeLower, ex.happy || 0, st.eyeY);
    U.uIris.value.set(st.irisSize * (ex.iris || 1), st.pupilSize, st.pupilType, st.irisY);
    U.uIrisTop.value.set(st.irisTop); U.uIrisBot.value.set(st.irisBot); U.uSclera.value.set(st.sclera); U.uLid.value.set(st.lidColor);
    U.uEyeC2.value.set(st.lidW, st.highlight, st.lashes, 0);
    U.uBrow.value.set(st.browType, st.browY + (ex.browY || 0), st.browAngle + (ex.browA || 0), st.browW);
    U.uBrowCol.value.set(st.browColor);
    // 口
    const J = meta.joints;
    const root = V(...J.muzzleRoot), tip = V(...J.noseTip);
    const F = tip.clone().sub(root);
    U.uMzLen.value = F.length();
    F.normalize();
    U.uMzRoot.value.copy(root); U.uMzF.value.copy(F);
    U.uMzU.value.crossVectors(F, V(1, 0, 0)).normalize();
    U.uMouthA.value.set(st.mouthY, st.mouthCorner, Math.max(-1, Math.min(1.5, st.smile + (ex.smile || 0))), st.mouthW);
    U.uMouthB.value.set(Math.max(st.fang, ex.fang || 0), st.fangX, st.philtrum ? 1 : 0, st.omega);
    U.uMouthC.value.set(Math.min(1, st.mouthOpen + (ex.open || 0)), st.whiskerDots ? 1 : 0, 0, 0);
    U.uCav.value.set(st.muscle, Math.max(st.fat, 0), st.muscleLine, 0.2);
    U.uTorso.value.set(meta.joints.chest[1], meta.joints.spine[1], 0.074, 0);
    U.uFurLen.value = st.furFringe; U.uFurDens.value = st.furDens;
    U.uClothV.value.set(st.top, st.bottom, st.topNeck, 0);
    this.furHull && (this.furHull.visible = st.furFringe > 0.001);
    // 服
    const S = this.shellU;
    S.uTop.value.set(st.top, st.topNeck, 0, 0);
    S.uBot.value.set(st.bottom, st.belt ? 1 : 0, st.pantStripe ? 1 : 0, 0);
    S.uTrimCol.value.set(st.trimColor);
    S.uTopCol.value.set(st.topColor); S.uBotCol.value.set(st.bottomColor); S.uBeltCol.value.set(st.beltColor);
    // 絵づくり
    LIGHT.uOutlinePx.value = st.outlineW;
    LIGHT.uSoft.value = 0.008 + (1 - st.anime) * 0.16;
    const h = st.shadeHue, dk = st.shadeDark;
    const base = 0.86 - dk * 0.36;
    LIGHT.uShadeMul.value.setRGB(base * (1 + 0.04 * -h + 0.06), base * (1 - 0.03 * Math.abs(h)), base * (1 + 0.22 * h));
    LIGHT.uRimStr.value = st.rim * (st.theme === 1 ? 1.2 : 0.7);
    LIGHT.uFaceSoft.value = st.faceSoft;
    LIGHT.uFurJag.value = st.furJag;
    this.mats.nose.userData.shader && (this.mats.nose.userData.shader.uniforms.uGloss.value = st.noseGloss);
    this._noseGloss = st.noseGloss;
  }

  _exprMods() {
    const e = this.state.expr;
    switch (e) {
      case 1: return { smile: 0.7, open: 0.25, happy: 0, aspect: 0.92 };
      case 2: return { smile: 0.9, open: 0.35, happy: 1, closed: 1 };
      case 3: return { smile: -0.8, tilt: 0.12, browA: -0.45, browY: -0.15, lidDown: 0.28, fang: 0.5, open: 0.1 };
      case 4: return { aspect: 1.25, iris: 0.78, open: 0.55, browY: 0.25, smile: -0.2, size: 1.06 };
      case 5: return { lidDown: 0.5, smile: -0.3 };
      case 6: return { closed: 1 };
      default: return {};
    }
  }

  // ---------------------------------------------------------------- 表面の点を探す
  _vertsOf(bones) {
    const key = bones.join(',');
    if (this._boneVerts[key]) return this._boneVerts[key];
    const meta = this.data.meta;
    const ids = bones.map(b => meta.bones.findIndex(x => x.name === b));
    const out = [];
    const si = this.data.skinIndex, sw = this.data.skinWeight;
    for (let i = 0; i < meta.vertexCount; i++) if (ids.includes(si[i * 4]) && sw[i * 4] > 100) out.push(i);
    return (this._boneVerts[key] = out);
  }

  // center から dir の方向で一番外側の頂点 → モーフ後の位置と法線
  pick(bones, center, dir) {
    const P = this.data.position;
    let best = -1, bs = -1e9;
    for (const i of this._vertsOf(bones)) {
      const dx = P[i * 3] - center.x, dy = P[i * 3 + 1] - center.y, dz = P[i * 3 + 2] - center.z;
      const l = Math.hypot(dx, dy, dz) + 1e-9;
      const s = (dx * dir.x + dy * dir.y + dz * dir.z) / l + l * 0.02;
      if (s > bs) { bs = s; best = i; }
    }
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    this.body.vertex(best, p, n);
    return { p, n, i: best };
  }

  // 基準形状の点 target に一番近い頂点
  near(bones, target) {
    const P = this.data.position;
    let best = -1, bd = 1e9;
    for (const i of this._vertsOf(bones)) {
      const d = (P[i * 3] - target.x) ** 2 + (P[i * 3 + 1] - target.y) ** 2 + (P[i * 3 + 2] - target.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    this.body.vertex(best, p, n);
    return { p, n, i: best };
  }

  baseJoint(name) { return V(...this.data.meta.joints[name]); }

  // ---------------------------------------------------------------- パーツ生成
  _clearParts() {
    for (const m of this.parts) {
      m.parent && m.parent.remove(m);
      if (m.userData.ownGeo) m.geometry.dispose();
    }
    this.parts = [];
  }

  _addMesh(boneName, geo, mat, matO, opts = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    m.userData.ownGeo = true;
    this.groups[boneName].add(m);
    this.parts.push(m);
    if (matO) {
      const o = new THREE.Mesh(geo, matO);
      o.layers.set(1);
      m.add(o);
    }
    return m;
  }

  // ボーンの休止位置を原点とするローカル座標へ
  _local(boneName, p) { return p.clone().sub(this.body.joints[boneName]); }

  _rebuildParts() {
    this._clearParts();
    const st = this.state;
    const cMain = col(st.furMain), cSub = col(st.furSub), cAcc = col(st.furAccent);
    const hairC = st.hairUseFur ? cMain.clone() : col(st.hairColor);
    const hairTip = col(st.hairTipColor);
    const J = (n) => this.body.joints[n];
    const hb = ['head'];
    const headC = this.headCenterRest();
    const headCb = this.baseJoint('head').add(V(0, 0.098 * 1.16, -0.02 * 1.16));
    const sharp = st.tuftSharp;
    const tw = st.tuftWide;

    // ---- 耳
    const ET = EAR_TYPES[st.earType] || EAR_TYPES[0];
    const ear = buildEar(st, { main: cMain, inner: col(st.earInner), tip: col(st.earTipColor), fluff: cSub });
    for (const sx of [1, -1]) {
      const a = ET.a + 0.22 * st.earX;
      const el = 0.12 * st.earY;
      const dir = V(sx * Math.sin(a), Math.cos(a) + el, ET.b - 0.1 * st.earY).normalize();
      const s = this.pick(hb, headCb, dir);
      const m = this._addMesh('head', ear.geometry, this.mats.part, this.mats.partO);
      m.userData.ownGeo = sx > 0;
      if (sx < 0) m.scale.x = -1;
      // 向き: 上方向は 法線と真上の中間、開口は前、外/後ろへの傾き
      let q;
      if (ET.hang) {
        // 垂れ耳: 頭の横から下へ垂らし、内側（くぼみ）を頭に向ける
        const down = V(sx * (0.62 + 0.3 * st.earOut), -1, 0.22 - 0.3 * st.earBack).normalize();
        const out = V(-sx * 0.5, 0, -0.87);   // 開口は頭の内側・後ろ向き → 正面からは耳の外側が見える
        const zf = out.clone().addScaledVector(down, -down.dot(out)).normalize();
        const xf = new THREE.Vector3().crossVectors(down, zf).normalize();
        const mtx = new THREE.Matrix4().makeBasis(xf, down, zf);
        q = new THREE.Quaternion().setFromRotationMatrix(mtx);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), 0.4 * st.earTurn));
      } else {
        const up = s.n.clone().lerp(V(0, 1, 0), 0.55).normalize();
        q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), up);
        const ry = (sx > 0 ? -1 : 1) * (0.25 + 0.5 * st.earTurn);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry));
        q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -sx * 0.35 * st.earOut));
        q.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -0.4 * st.earBack));
      }
      m.quaternion.copy(q);
      m.position.copy(this._local('head', s.p.addScaledVector(s.n, -0.003)));
      m.userData.ear = sx;
      m.userData.baseQ = q.clone();
    }

    // ---- 鼻
    const ng = buildNose(st, st.noseColor);
    const nose = this._addMesh('head', ng, this.mats.nose, this.mats.noseO);
    const tipP = this.body.joint('noseTip');
    const root = this.body.joint('muzzleRoot');
    const F = tipP.clone().sub(root).normalize();
    nose.position.copy(this._local('head', tipP.add(V(0, st.noseY, st.noseZ))));
    nose.quaternion.setFromUnitVectors(V(0, 0, 1), F.clone().lerp(V(0, 0, 1), 0.4).normalize());
    this.mats.noseO.userData.outlineScale.value = 0.7;

    // ---- 頭の毛
    const B = new GeoBuilder();
    const R = rng(1234 + st.hairStyle * 17);
    const mess = st.hairMess;
    const tuft = (bones, bone, center, dir, d, len, w, opt = {}) => {
      const s = opt.target ? this.near(bones, opt.target) : this.pick(bones, center, dir);
      const jit = V(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(mess * 0.5 * (opt.mess ?? 1));
      const dd = d.clone().add(jit).normalize();
      const up = opt.up || s.n;
      addTuft(opt.builder || B, {
        p: this._local(bone, s.p), d: dd, up, len: len * (1 + (R() - 0.5) * 0.3 * mess), w, t: w * (opt.flat ?? 0.42),
        bend: opt.bend || V(0, -0.25, 0), sharp: opt.sharp ?? sharp, c0: opt.c0 || hairC, c1: opt.c1 || (st.hairTipAmt > 0 ? hairTip : opt.c0 || hairC),
        tipAmt: opt.tipAmt ?? st.hairTipAmt, segs: opt.segs || 7, sides: 6, sink: opt.sink ?? 0.008,
      });
    };
    // 毛束: 表面に沿って流れ、先だけ持ち上がる平たい房（表面の法線を厚み方向にする）
    let layer = 0;
    const clump = (bones, bone, dirFromCenter, center, flowV, len, w, opt = {}) => {
      const s = opt.target ? this.near(bones, opt.target) : this.pick(bones, center, dirFromCenter);
      const N = s.n.clone();
      const fl = flowV.clone().add(V(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(0.35 * mess * (opt.mess ?? 1)));
      const T = fl.addScaledVector(N, -fl.dot(N)).normalize();
      const lift = opt.lift ?? 0.3;
      const d = T.clone().addScaledVector(N, lift).normalize();
      const p = this._local(bone, s.p).addScaledVector(N, (opt.layer ?? layer) * 0.0012);
      addTuft(opt.builder || B, {
        p, d, up: N, len: len * (1 + (R() - 0.5) * 0.25 * mess), w, t: w * (opt.flat ?? 0.3),
        bend: N.clone().multiplyScalar(opt.curl ?? 0.1).addScaledVector(T, 0.0), sharp: opt.sharp ?? Math.max(0.55, sharp),
        c0: opt.c0 || hairC, c1: opt.c1 || (st.hairTipAmt > 0 ? hairTip : opt.c0 || hairC),
        tipAmt: opt.tipAmt ?? st.hairTipAmt, segs: opt.segs || 8, sides: 8, sink: opt.sink ?? 0.006,
      });
    };
    const HL = st.hairLen, HV = st.hairVol, flow = st.hairFlow;
    const sph = (az, el) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return V(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)); };
    const style = st.hairStyle;
    const backFlow = (az, down = 0.25) => V(Math.sin(az * Math.PI / 180) * 0.35, -down, -1 + flow * 1.2).normalize();
    const hairC2 = hairC.clone().multiplyScalar(0.9);
    // 頭皮を覆う毛束の並び（後ろの列から先に置き、前の列ほど上に重ねる）
    const scalp = (rows, opt = {}) => {
      rows.forEach(([el, n, len, w, lift, azMax], ri) => {
        layer = ri;
        // 低い列は顔の横（こめかみ）を避けて後ろ半分だけ
        const azMin = el < 25 ? 95 : (el < 45 ? 70 : 0);
        const list = [];
        if (azMin > 0) {
          const half = Math.max(1, Math.ceil(n / 2));
          for (let i = 0; i < half; i++) { const a = azMin + (azMax - azMin) * (half === 1 ? 1 : i / (half - 1)); list.push(a, -a); }
          list.push(180);
        } else for (let i = 0; i < n; i++) list.push(n === 1 ? 0 : -azMax + 2 * azMax * (i / (n - 1)));
        for (let i = 0; i < list.length; i++) {
          const az = list[i];
          const alt = i % 2 ? 0.82 : 1.0;
          clump(hb, 'head', sph(az, el), headCb, opt.flowFn ? opt.flowFn(az, el) : backFlow(az), len * HL * alt, w * HV, {
            lift, curl: opt.curl ?? 0.15, c0: ri % 2 ? hairC2 : hairC,
          });
        }
      });
      layer = 0;
    };
    if (style === 1) {          // 短髪（後ろへ流れる）
      scalp([
        [8, 7, 0.06, 0.042, 0.45, 150], [30, 7, 0.065, 0.042, 0.4, 135], [52, 6, 0.065, 0.042, 0.35, 105],
        [70, 5, 0.06, 0.04, 0.32, 70], [82, 3, 0.055, 0.04, 0.3, 40],
      ]);
    } else if (style === 2) {   // 前髪
      scalp([[10, 7, 0.07, 0.044, 0.4, 150], [35, 7, 0.07, 0.044, 0.35, 135], [62, 5, 0.065, 0.042, 0.3, 95]]);
      layer = 4;
      for (const az of [-38, -19, 0, 19, 38]) clump(hb, 'head', sph(az, 64), headCb, V(Math.sin(az * Math.PI / 180) * 0.3, -0.35, 1).normalize(), 0.07 * HL, 0.04 * HV, { lift: 0.12, curl: 0.05 });
      layer = 0;
    } else if (style === 3) {   // オールバック（長く寝た毛）
      scalp([[12, 7, 0.09, 0.046, 0.25, 150], [40, 7, 0.1, 0.046, 0.2, 125], [65, 5, 0.1, 0.044, 0.16, 80], [80, 3, 0.1, 0.044, 0.14, 40]], { curl: 0.2 });
    } else if (style === 4) {   // ワイルド（大きく跳ねる）
      scalp([
        [5, 7, 0.085, 0.05, 0.6, 150], [28, 7, 0.09, 0.05, 0.55, 135], [50, 6, 0.09, 0.05, 0.5, 105],
        [68, 5, 0.085, 0.048, 0.45, 70], [82, 3, 0.08, 0.046, 0.5, 40],
      ], { curl: 0.35 });
      // 前の跳ね毛
      layer = 6;
      for (const az of [-14, 14]) clump(hb, 'head', sph(az, 70), headCb, V(az * 0.01, 0.6, 0.6).normalize(), 0.05 * HL, 0.035 * HV, { lift: 0.5, curl: 0.2 });
      layer = 0;
    } else if (style === 5) {   // モヒカン
      for (let k = 0; k < 7; k++) {
        layer = 7 - k;
        const el = 45 + k * 20;
        const az = el > 90 ? 180 : 0, e2 = el > 90 ? 180 - el : el;
        clump(hb, 'head', sph(az, e2), headCb, V(0, 0.2, -1), 0.08 * HL * (1 - Math.abs(k - 2.5) * 0.06), 0.045 * HV, { lift: 0.75, curl: 0.25, flat: 0.45 });
      }
      layer = 0;
    } else if (style === 6) {   // 長髪
      scalp([[0, 7, 0.17, 0.048, 0.15, 150], [28, 7, 0.16, 0.048, 0.15, 130], [55, 6, 0.13, 0.046, 0.15, 100], [75, 4, 0.11, 0.044, 0.15, 60]],
        { curl: 0.1, flowFn: (az) => V(Math.sin(az * Math.PI / 180) * 0.3, -0.75, -0.65 + flow).normalize() });
    }

    // ---- 頬毛（頬から後ろ下へ流れ、先が外へ張り出す）・たてがみ・あご
    const cheekC = st.cheekWhite > 0.5 ? cSub : cMain;
    const ck = st.cheekFluff;
    if (ck > 0) {
      const rows = ck === 3 ? [[0, 6, 1.0, 0.5], [-12, 5, 0.85, 0.45]] : (ck === 1 ? [[-4, 4, 0.7, 0.35]] : [[-4, 6, 1.0, 0.45]]);
      for (const sx of [1, -1]) rows.forEach(([el0, cnt, k, lift], ri) => {
        for (let i = 0; i < cnt; i++) {
          const t = cnt > 1 ? i / (cnt - 1) : 0.5;
          const az = sx * (72 + 42 * t);
          const el = el0 + 0 - 30 * t;
          const alt = i % 2 ? 0.75 : 1.0;
          clump(hb, 'head', sph(az, el), headCb, V(sx * (0.25 + 0.25 * st.cheekSpread), -0.35 - 0.3 * t, -1).normalize(),
            0.055 * k * alt * st.cheekLen, 0.026 * tw, { lift: lift + 0.2 * st.cheekSpread, curl: 0.12, flat: 0.5, sharp: 0.85, c0: cheekC, c1: cheekC, tipAmt: 0, layer: ri * 3 + (i % 2), mess: 0.4 });
        }
      });
    }
    if (st.mane > 0.01) {
      const maneC = st.hairUseFur ? cMain.clone().multiplyScalar(0.8) : hairC;
      const n = Math.round(10 + st.mane * 8);
      for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) {
        const az = -165 + 330 * (i / (n - 1));
        if (Math.abs(az) < (r === 0 ? 55 : 80)) continue;
        const el = r === 0 ? 30 : -5;
        const d = sph(az, el);
        const out = d.clone().setY(d.y * 0.4 - 0.35).add(V(0, 0, -0.3)).normalize();
        tuft(hb, 'head', headCb, d, out, (0.09 + 0.03 * r) * st.maneLen * (0.6 + 0.4 * st.mane), 0.055 * tw * (0.7 + 0.3 * st.mane), { c0: maneC, c1: maneC, bend: V(0, -0.3, -0.25), mess: 0.8, sink: 0.015 });
      }
    }
    if (st.beard > 0.01) {
      for (const sx of [-1, 0, 1]) {
        const tgt = this.baseJoint('muzzleRoot').add(V(sx * 0.02, -0.06, 0.05));
        tuft(hb, 'head', null, null, V(sx * 0.2, -1, 0.35).normalize(), 0.05 * (0.6 + st.beard), 0.025 * tw, { target: tgt, c0: hairC, c1: hairC, bend: V(0, -0.1, -0.2), sink: 0.01 });
      }
    }
    if (B.n) this._addMesh('head', B.build(), this.mats.hair, this.mats.hairO);

    // ---- ヒゲ
    const wn = st.whiskers;
    if (wn > 0) {
      const WB = new GeoBuilder();
      const wc = col(st.whiskerColor);
      const mr = this.baseJoint('muzzleRoot'), nt = this.baseJoint('noseTip');
      const Fb = nt.clone().sub(mr);
      for (const sx of [1, -1]) for (let k = 0; k <= wn; k++) {
        const tgt = mr.clone().addScaledVector(Fb, 0.72).add(V(sx * 0.03, -0.004 - k * 0.006, 0));
        const s = this.near(hb, tgt);
        const d = V(sx * 0.9, 0.18 - k * 0.12, -0.25).normalize();
        addTuft(WB, { p: this._local('head', s.p), d, up: V(0, 1, 0), len: 0.075 * st.whiskerLen * (1 - k * 0.1), w: 0.0016, t: 0.0016, bend: V(0, -0.25 * st.whiskerCurve, -0.1), sharp: 0.3, c0: wc, c1: wc, segs: 6, sides: 4, sink: 0.002 });
      }
      const wm = this._addMesh('head', WB.build(), this.mats.whisker, null, { shadow: false });
    }

    // ---- 体の毛
    const FB = { neck: new GeoBuilder(), chest: new GeoBuilder(), 'upperarm.L': new GeoBuilder(), 'upperarm.R': new GeoBuilder(), 'forearm.L': new GeoBuilder(), 'forearm.R': new GeoBuilder(), 'shin.L': new GeoBuilder(), 'shin.R': new GeoBuilder() };
    const chestC = st.bellyW > 0.15 ? cSub : cMain;
    if (st.neckRuff > 0.01) {
      const nC = this.baseJoint('neck');
      const n = 12;
      for (let i = 0; i < n; i++) {
        const az = -180 + 360 * (i / n) + 15;
        const a = az * Math.PI / 180;
        const dir = V(Math.sin(a), 0.25, Math.cos(a)).normalize();
        const front = Math.cos(a) > 0.3;
        const c0 = front ? chestC : cMain;
        tuft(['neck'], 'neck', nC.clone().add(V(0, 0.03, 0)), dir, V(Math.sin(a) * 0.6, -0.8, Math.cos(a) * 0.6).normalize(), 0.06 * (0.6 + 0.6 * st.neckRuff), 0.04 * tw, { builder: FB.neck, c0, c1: c0, tipAmt: 0, bend: V(0, -0.1, 0), mess: 0.5, sink: 0.012 });
      }
    }
    const shirt = st.top >= 1 && st.top <= 3;
    if (st.chestFluff > 0.01 && !shirt) {
      const cC = this.baseJoint('chest');
      const pts = [[0, 0.16, 1.0], [0.035, 0.13, 0.95], [-0.035, 0.13, 0.95], [0.0, 0.09, 0.9], [0.06, 0.105, 0.8], [-0.06, 0.105, 0.8]];
      const cnt = Math.round(2 + st.chestFluff * 4);
      for (let k = 0; k < cnt; k++) {
        const [x, y, s] = pts[k];
        const tgt = cC.clone().add(V(x, y, 0.2));
        tuft(['chest'], 'chest', null, null, V(x * 3, -0.75, 0.55).normalize(), 0.06 * s * st.chestLen * (0.7 + 0.5 * st.chestFluff), 0.035 * tw, { target: tgt, builder: FB.chest, c0: chestC, c1: chestC, tipAmt: 0, bend: V(0, -0.3, -0.05), sink: 0.01, mess: 0.5 });
      }
    }
    if (st.backMane > 0.01 && !shirt) {
      for (let k = 0; k < 6; k++) {
        const y = 1.53 - k * 0.06;
        const tgt = V(0, y, -0.2);
        tuft(['chest', 'neck', 'spine'], 'chest', null, null, V(0, 0.3, -1).normalize(), 0.06 * (0.6 + 0.6 * st.backMane) * (1 - k * 0.08), 0.04 * tw, { target: tgt, builder: FB.chest, c0: st.hairUseFur ? cMain : hairC, c1: st.hairUseFur ? cMain : hairC, tipAmt: 0, bend: V(0, -0.5, -0.1), sink: 0.012, mess: 0.4 });
      }
    }
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      if (st.shoulderFluff > 0.01) {
        const sh = this.baseJoint('upperarm.' + side);
        for (let k = 0; k < 3; k++) {
          const tgt = sh.clone().add(V(sx * (0.03 + k * 0.012), 0.06 - k * 0.012, -0.03 + k * 0.03));
          tuft(['upperarm.' + side, 'chest'], 'upperarm.' + side, null, null, V(sx * 0.8, -0.4, -0.3 + k * 0.2).normalize(), 0.05 * (0.6 + 0.6 * st.shoulderFluff), 0.035 * tw, { target: tgt, builder: FB['upperarm.' + side], c0: cMain, c1: cMain, tipAmt: 0, bend: V(0, -0.3, 0), sink: 0.012 });
        }
      }
      const sockArm = st.sockArm > 0.001;
      if (st.elbowTuft > 0.01) {
        const el = this.baseJoint('forearm.' + side);
        const dA = this.baseJoint('hand.' + side).sub(el).normalize();
        for (let k = 0; k < 2; k++) {
          const tgt = el.clone().add(V(0, -0.005, -0.045 + k * 0.012)).addScaledVector(dA, 0.02 + k * 0.02);
          tuft(['forearm.' + side], 'forearm.' + side, null, null, dA.clone().multiplyScalar(0.6).add(V(0, 0, -0.75)).normalize(), 0.045 * (0.6 + 0.6 * st.elbowTuft) * (1 - k * 0.2), 0.03 * tw, { target: tgt, builder: FB['forearm.' + side], c0: cMain, c1: cMain, tipAmt: 0, bend: V(0, -0.2, 0), sink: 0.01, mess: 0.4 });
        }
      }
      if (st.wristTuft > 0.01) {
        const wr = this.baseJoint('hand.' + side), el = this.baseJoint('forearm.' + side);
        const dA = wr.clone().sub(el).normalize();
        for (let k = 0; k < 2; k++) {
          const tgt = wr.clone().addScaledVector(dA, -0.04).add(V(sx * 0.02, 0.02, -0.02 + k * 0.03));
          const c0 = sockArm && st.sockArm > 0.6 ? cAcc : cMain;
          tuft(['forearm.' + side], 'forearm.' + side, null, null, dA.clone().add(V(sx * 0.3, 0.1, -0.2)).normalize(), 0.035 * (0.6 + 0.6 * st.wristTuft), 0.026 * tw, { target: tgt, builder: FB['forearm.' + side], c0, c1: c0, tipAmt: 0, bend: V(0, -0.1, 0), sink: 0.01, mess: 0.4 });
        }
      }
      if (st.ankleTuft > 0.01) {
        const an = this.baseJoint('foot.' + side);
        for (let k = 0; k < 2; k++) {
          const tgt = an.clone().add(V(sx * (0.01 - k * 0.02), 0.05, -0.035));
          const c0 = st.sockLeg > 0.6 ? cAcc : cMain;
          tuft(['shin.' + side], 'shin.' + side, null, null, V(sx * 0.2 * (k ? -1 : 1), -0.55, -0.8).normalize(), 0.04 * (0.6 + 0.6 * st.ankleTuft), 0.028 * tw, { target: tgt, builder: FB['shin.' + side], c0, c1: c0, tipAmt: 0, bend: V(0, -0.3, 0), sink: 0.01, mess: 0.4 });
        }
      }
    }
    for (const [bone, b] of Object.entries(FB)) if (b.n) this._addMesh(bone, b.build(), this.mats.part, this.mats.partO);

    // ---- 尻尾
    const tg = this.tail.rebuild(st, { main: cMain, tip: col(st.tailTipColor), accent: cAcc });
    if (tg) {
      const tm = this._addMesh('hips', tg, this.mats.part, this.mats.partO);
      tm.position.copy(this._local('hips', this.body.joint('tail')));
      this.tailMesh = tm;
    } else this.tailMesh = null;

    // ---- 小物
    if (st.scarf) {
      const SB = new GeoBuilder();
      const sc = col(st.scarfColor);
      const nC = this.baseJoint('neck').add(V(0, 0.035, 0));
      const ring = [];
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2;
        const s = this.pick(['neck', 'chest'], nC, V(Math.sin(a), 0.15, Math.cos(a)).normalize());
        ring.push(this._local('neck', s.p.addScaledVector(s.n, 0.006)));
      }
      const ctr = ring.reduce((a, b) => a.add(b), V(0, 0, 0)).multiplyScalar(1 / ring.length);
      const sides = 8;
      for (let i = 0; i <= 20; i++) {
        const p = ring[i % 20];
        const radial = p.clone().sub(ctr).setY(0).normalize();
        for (let j = 0; j < sides; j++) {
          const th = j / sides * Math.PI * 2;
          const q = p.clone().addScaledVector(radial, (Math.cos(th) + 0.9) * 0.012).add(V(0, Math.sin(th) * 0.022, 0));
          SB.v(q, sc.clone().multiplyScalar(0.92 + 0.08 * Math.sin(i * 1.3)));
        }
      }
      for (let i = 0; i < 20; i++) for (let j = 0; j < sides; j++) {
        const a = i * sides + j, b = i * sides + (j + 1) % sides;
        SB.tri(a, a + sides, b + sides); SB.tri(a, b + sides, b);
      }
      // 結び目から垂れる端
      const front = ring[2].clone();
      addTuft(SB, { p: front, d: V(0.25, -1, 0.35).normalize(), up: V(0, 0, 1), len: 0.13, w: 0.03, t: 0.008, bend: V(0, 0, 0.1), sharp: 0.1, c0: sc, c1: sc, segs: 6, sides: 6, sink: 0 });
      addTuft(SB, { p: front, d: V(0.45, -0.9, 0.3).normalize(), up: V(0, 0, 1), len: 0.1, w: 0.026, t: 0.008, bend: V(0, 0, 0.1), sharp: 0.1, c0: sc.clone().multiplyScalar(0.9), c1: sc, segs: 6, sides: 6, sink: 0 });
      this._addMesh('neck', SB.build(), this.mats.part, this.mats.partO);
    }
    if (st.bracelet) {
      for (const side of ['L', 'R']) {
        const wr = this.body.joint('hand.' + side), el = this.body.joint('forearm.' + side);
        const d = wr.clone().sub(el).normalize();
        const s = this.near(['forearm.' + side], this.baseJoint('hand.' + side).addScaledVector(this.baseJoint('hand.' + side).sub(this.baseJoint('forearm.' + side)).normalize(), -0.035));
        const axisPt = wr.clone().addScaledVector(d, -0.035);
        const r = s.p.distanceTo(axisPt) + 0.004;
        const tg2 = new THREE.TorusGeometry(Math.max(0.02, r), 0.007, 8, 28);
        const cc = col(st.accColor);
        const cArr = new Float32Array(tg2.attributes.position.count * 3);
        for (let i = 0; i < cArr.length; i += 3) { cArr[i] = cc.r; cArr[i + 1] = cc.g; cArr[i + 2] = cc.b; }
        tg2.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
        const m = this._addMesh('forearm.' + side, tg2, this.mats.hair, this.mats.hairO);
        m.position.copy(this._local('forearm.' + side, axisPt));
        m.quaternion.setFromUnitVectors(V(0, 0, 1), d);
      }
    }
  }

  // 3面プレビュー用: 一時的に別の表情のユニフォームにする（restoreExpr で戻す）
  exprUniforms(e) {
    if (!this.state) return;
    this._saved = this._saved || { blink: this.bodyU.uBlink.value, happy: this.bodyU.uEyeB.value.z };
    const save = this.state.expr;
    this.state.expr = e;
    this._applyUniforms();
    const ex = this._exprMods();
    this.bodyU.uBlink.value = Math.max(ex.closed ? 1 : 0, ex.lidDown || 0);
    this.bodyU.uEyeB.value.z = ex.happy || 0;
    this.state.expr = save;
  }
  restoreExpr() {
    if (!this._saved) return;
    this._applyUniforms();
    this.bodyU.uBlink.value = this._saved.blink;
    this.bodyU.uEyeB.value.z = this._saved.happy;
    this._saved = null;
  }

  headCenterRest() {
    return this.body.joint('head').add(V(0, 0.098 * 1.16, -0.02 * 1.16));
  }

  headCenterWorld() {
    const p = this.headCenterRest().sub(this.body.joints.head);
    return this.bones.head.localToWorld(p);
  }

  focusPoint() {
    return new THREE.Vector3(0, 1.0 * this.scale, 0);
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt, t, camera) {
    const st = this.state;
    if (!st) return;
    if (this.dirty.body) {
      const vals = {};
      for (const k of Object.keys(this.data.meta.sliders)) vals[k] = st[k];
      this.body.setSliders(vals);
      this.dirty.body = false;
      this.dirty.parts = true;
    }
    this.scale = st.height;
    this.root.scale.setScalar(st.height);
    this.body.mesh.position.y = this.body.groundOffset;
    if (this.dirty.parts) {
      this._rebuildParts();
      this.dirty.parts = false;
    }
    if (st.turntable) this.root.rotation.y += dt * 0.45;
    this._pose(dt, t, camera);
    if (this.tailMesh) this.tail.update(t, st.idle ? st.tailSway : 0);
    // 表情・まばたき
    const ex = this._exprMods();
    const A = this.anim;
    let blink = 0;
    if (st.blink && !ex.closed) {
      A.nextBlink -= dt;
      if (A.nextBlink < 0) { A.blinkT = 0; A.nextBlink = 2.5 + Math.random() * 3.5; }
      if (A.blinkT !== undefined) {
        A.blinkT += dt;
        const k = A.blinkT / 0.16;
        blink = k < 1 ? Math.sin(k * Math.PI) : 0;
        if (k >= 1) A.blinkT = undefined;
      }
    }
    const lid = Math.max(ex.closed ? 1 : 0, ex.lidDown || 0);
    this.bodyU.uBlink.value = Math.min(1, lid + blink * (1 - lid));
    this.bodyU.uEyeB.value.z = ex.happy || 0;
    if (this.mats.nose.userData.shader) this.mats.nose.userData.shader.uniforms.uGloss.value = this._noseGloss ?? 1;
  }

  _pose(dt, t, camera) {
    const st = this.state;
    const b = this.bones;
    const q = (bone, x, y, z) => bone.quaternion.setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
    for (const bone of Object.values(b)) bone.quaternion.identity();
    const idle = st.idle ? 1 : 0;
    const br = Math.sin(t * 1.7) * idle;
    const sway = Math.sin(t * 0.55) * idle;
    q(b.spine, 0.02 * br, 0.03 * sway, 0.01 * sway);
    q(b.chest, -0.015 * br, 0.0, -0.008 * sway);
    // 腕: Aポーズ(休止)から下げる
    // down: 腕を下げる量, fwd: 前へ振る量, bend: ひじを前へ曲げる, bendZ: ひじを正面の面内で曲げる（+で上/内側へ）
    const armQ = (side, down, fwd, bend, bendZ = 0, twist = 0) => {
      const sx = side === 'L' ? 1 : -1;
      const ua = b['upperarm.' + side], fa = b['forearm.' + side], hd = b['hand.' + side];
      const el = this.body.joints['forearm.' + side], wr = this.body.joints['hand.' + side];
      const qa = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -sx * down);
      const qf = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -fwd);
      ua.quaternion.copy(qf.multiply(qa));
      const d2 = wr.clone().sub(el).normalize();
      const axis = new THREE.Vector3().crossVectors(d2, V(0, 0, 1)).normalize();
      fa.quaternion.setFromAxisAngle(V(0, 0, 1), sx * bendZ).multiply(new THREE.Quaternion().setFromAxisAngle(axis, bend));
      if (twist) hd.quaternion.setFromAxisAngle(d2, twist * sx);
    };
    const pose = st.pose;
    const ib = 0.02 * br;
    if (pose === 0) {        // 自然体
      armQ('L', 0.52 + ib, 0.06, 0.22);
      armQ('R', 0.52 + ib, 0.06, 0.26);
    } else if (pose === 1) { // Aポーズ
      armQ('L', 0.0 + ib, 0.0, 0.0);
      armQ('R', 0.0 + ib, 0.0, 0.0);
    } else if (pose === 2) { // 腰に手
      armQ('L', 0.2 + ib, -0.38, 0.2, -1.62, 0.6);
      armQ('R', 0.2 + ib, -0.38, 0.2, -1.62, 0.6);
    } else if (pose === 3) { // 手を挙げる
      armQ('L', 0.52 + ib, 0.06, 0.22);
      armQ('R', -0.75, 0.25, 0.3, 1.75, 0.8);
    }
    // 脚は少し開く/重心移動
    q(b['thigh.L'], 0, 0, 0.015 + 0.01 * sway);
    q(b['thigh.R'], 0, 0, -0.015 + 0.01 * sway);
    // 頭: カメラを見る
    const A = this.anim;
    let yaw = 0, pitch = 0;
    if (st.lookCam && camera) {
      const hp = this.headCenterWorld();
      const local = this.root.worldToLocal(camera.position.clone());
      const hl = this.root.worldToLocal(hp.clone());
      const d = local.sub(hl);
      yaw = Math.atan2(d.x, d.z);
      pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
      if (Math.abs(yaw) > 1.5) yaw = 0, pitch = 0;
      yaw = THREE.MathUtils.clamp(yaw, -0.7, 0.7);
      pitch = THREE.MathUtils.clamp(pitch, -0.35, 0.3);
    }
    yaw += 0.05 * Math.sin(t * 0.37) * idle;
    pitch += 0.03 * Math.sin(t * 0.5 + 1) * idle;
    const k = 1 - Math.exp(-dt * 5);
    A.look.x += (yaw - A.look.x) * k;
    A.look.y += (pitch - A.look.y) * k;
    q(b.neck, A.look.y * 0.35, A.look.x * 0.35, 0);
    q(b.head, A.look.y * 0.65 + 0.03 * br, A.look.x * 0.65, 0.04 * sway);
    // 視線
    this.bodyU.uGaze.value.set(THREE.MathUtils.clamp((yaw - A.look.x) * 1.5, -1, 1) * 0 + Math.sin(t * 0.23) * 0.15 * idle, 0);
    // 耳のぴくぴく
    A.nextEar -= dt;
    if (A.nextEar < 0) { A.earT = 0; A.earSide = Math.random() < 0.5 ? 1 : -1; A.nextEar = 3 + Math.random() * 5; }
    let tw = 0;
    if (A.earT !== undefined && idle) { A.earT += dt; const kk = A.earT / 0.35; tw = kk < 1 ? Math.sin(kk * Math.PI) : 0; if (kk >= 1) A.earT = undefined; }
    for (const m of this.parts) {
      if (!m.userData.ear) continue;
      const s = m.userData.ear;
      m.quaternion.copy(m.userData.baseQ);
      const amp = (s === A.earSide ? tw : 0) * 0.25 + 0.03 * Math.sin(t * 1.3 + s) * idle;
      m.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -s * amp));
    }
  }
}
