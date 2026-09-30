// HDR レンダリングパイプライン：
// シーン → ボリューメトリックライト → 水面/水中合成 → 露出 → 被写界深度 → ブルーム → トーンマップ
import * as THREE from 'three';
import { FSPass, makeRT } from './fullscreen.js';
import { shared } from './caveMaterial.js';
import {
  VOLUME_FRAG, COMPOSE_FRAG, LOGLUM_FRAG, ADAPT_FRAG, BLOOM_DOWN_FRAG, BLOOM_UP_FRAG, DOF_FRAG, FINAL_FRAG, TAA_FRAG,
} from './shaders.js';

const BLOOM_LEVELS = 6;

export class Pipeline {
  constructor(renderer, scene, camera, cfg) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.cfg = Object.assign({
      waterY: 0,
      sun: null,               // DirectionalLight（影カメラを流用）
      sunDir: new THREE.Vector3(0, -1, 0),
      sunColor: new THREE.Vector3(1, 0.94, 0.82),
      sunVolume: 3.2,
      absorb: new THREE.Vector3(0.34, 0.058, 0.022),
      volumeSteps: 40,
      scale: 1,
      bloom: 0.08,
      dof: false,
      exposureBias: 1,
      key: 0.16,
      sky: null,
    }, cfg);

    this.time = 0;
    this.fade = 1;
    this.w = 2; this.h = 2;
    this.ripples = [];
    for (let i = 0; i < 8; i++) this.ripples.push(new THREE.Vector4(0, 0, -100, 0));
    this.rippleIdx = 0;
    this.first = true;

    this._makeTargets();
    this._makePasses();
    this._makeSunDepth();
    const half = this.cfg.sunHalf || 58;
    this.sunCam = new THREE.OrthographicCamera(-half, half, half, -half, 20, 260);
    this.sunCam.up.set(0, 0, 1);
    const cen = this.cfg.sunCenter || new THREE.Vector3(0, 0, 0);
    this.sunCam.position.copy(cen).addScaledVector(this.cfg.sunDir, -130);
    this.sunCam.lookAt(cen);
    this.sunCam.updateMatrixWorld();
    this.sunCam.layers.set(1);
    shared.uSunInfo.value.set(260 - 20, 1 / this.sunRT.width, 0, 0);

    this.reflCam = new THREE.PerspectiveCamera();
    this.reflViewProj = new THREE.Matrix4();
    this.viewProj = new THREE.Matrix4();
    this.invViewProj = new THREE.Matrix4();
    this.vpU = new THREE.Matrix4();
    this.invVpU = new THREE.Matrix4();
    this.vpPrev = new THREE.Matrix4();
    this.resetHistory = true;
    this.halton = [];
    for (let i = 1; i <= 16; i++) this.halton.push([this._halton(i, 2) - 0.5, this._halton(i, 3) - 0.5]);
    this.lightViewProj = new THREE.Matrix4();
    this.clipUp = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.cfg.waterY + 0.03);
    this.clipDown = new THREE.Plane(new THREE.Vector3(0, -1, 0), this.cfg.waterY + 0.03);
    this.overrideDepthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.sunDepthDirty = true;
    this.cube = null;
    this.stats = { frame: 0 };
  }

  _halton(i, b) {
    let f = 1, r = 0;
    while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
    return r;
  }

  _makeTargets() {
    const dt = new THREE.DepthTexture(2, 2, this.cfg.depth24 ? THREE.UnsignedIntType : THREE.FloatType);
    dt.format = THREE.DepthFormat;
    this.sceneRT = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: 0,
      depthBuffer: true, depthTexture: this.cfg.nodt ? null : dt, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    if (this.cfg.nores) this.sceneRT.resolveDepthBuffer = false;
    this.reflRT = makeRT(2, 2, { depthBuffer: true });
    this.volRT = makeRT(2, 2);
    this.compRT = makeRT(2, 2);
    this.taaRT = [makeRT(2, 2), makeRT(2, 2)];
    this.taaIdx = 0;
    this.dofRT = makeRT(2, 2);
    this.down = []; this.up = [];
    for (let i = 0; i < BLOOM_LEVELS; i++) { this.down.push(makeRT(2, 2)); this.up.push(makeRT(2, 2)); }
    this.lumRT = makeRT(128, 64, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.adaptRT = [makeRT(1, 1), makeRT(1, 1)];
    this.adaptIdx = 0;
    this.aboveCube = new THREE.WebGLCubeRenderTarget(192, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });
  }

  _makeSunDepth() {
    const S = 2048;
    const dt = new THREE.DepthTexture(S, S, THREE.FloatType);
    dt.format = THREE.DepthFormat;
    this.sunRT = new THREE.WebGLRenderTarget(S, S, {
      type: THREE.UnsignedByteType, depthBuffer: true, depthTexture: dt,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
  }

  _makePasses() {
    const c = this.cfg;
    this.volPass = new FSPass({
      fragmentShader: VOLUME_FRAG,
      defines: { STEPS: c.volumeSteps },
      uniforms: {
        tDepth: { value: null }, tSunDepth: { value: null },
        invViewProj: { value: new THREE.Matrix4() }, lightViewProj: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() }, uSunDir: { value: c.sunDir }, uSunColor: { value: c.sunColor.clone().multiplyScalar(c.sunVolume) },
        uAbsorb: { value: c.absorb }, uWaterY: { value: c.waterY }, uTime: { value: 0 },
        uMaxDist: { value: 70 }, uDensityAir: { value: 0.02 }, uDensityWater: { value: 0.02 }, uMieG: { value: 0.62 }, uFrame: { value: 0 },
      },
    });
    this.composePass = new FSPass({
      fragmentShader: COMPOSE_FRAG,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tRefl: { value: null }, tVol: { value: null }, tAbove: { value: null },
        invViewProj: { value: new THREE.Matrix4() }, viewProj: { value: new THREE.Matrix4() }, reflViewProj: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() }, uWaterY: { value: c.waterY }, uTime: { value: 0 },
        uAbsorb: { value: c.absorb }, uWaterAmbient: { value: new THREE.Vector3(0.002, 0.030, 0.045) },
        uAirAmbient: { value: new THREE.Vector3(0.018, 0.024, 0.028) }, uAirDensity: { value: 0.006 },
        uSunDir: { value: c.sunDir }, uRipples: { value: this.ripples }, uHasAbove: { value: 0 },
      },
    });
    this.taaPass = new FSPass({
      fragmentShader: TAA_FRAG,
      uniforms: {
        tCur: { value: null }, tHist: { value: null }, invVpCur: { value: new THREE.Matrix4() }, vpPrev: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() }, texel: { value: new THREE.Vector2() }, uReset: { value: 1 }, uBlend: { value: 0.12 },
      },
    });
    this.logPass = new FSPass({ fragmentShader: LOGLUM_FRAG, uniforms: { tColor: { value: null } } });
    this.adaptPass = new FSPass({
      fragmentShader: ADAPT_FRAG,
      uniforms: {
        tLum: { value: null }, tPrev: { value: null }, dt: { value: 0.016 }, uKey: { value: c.key },
        uMinExp: { value: 0.35 }, uMaxExp: { value: c.maxExp || 22.0 }, uSpeedUp: { value: 2.2 }, uSpeedDown: { value: 0.9 }, uInit: { value: 1 },
      },
    });
    this.downPass = new FSPass({ fragmentShader: BLOOM_DOWN_FRAG, uniforms: { tColor: { value: null }, texel: { value: new THREE.Vector2() }, uFirst: { value: 0 } } });
    this.upPass = new FSPass({ fragmentShader: BLOOM_UP_FRAG, uniforms: { tLow: { value: null }, tHigh: { value: null }, texel: { value: new THREE.Vector2() }, uMix: { value: 1 } } });
    this.dofPass = new FSPass({
      fragmentShader: DOF_FRAG,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, resolution: { value: new THREE.Vector2() },
        uFocus: { value: 8 }, uAperture: { value: 0.0038 }, uNear: { value: 0.1 }, uFar: { value: 400 }, uMaxCoC: { value: 10 },
      },
    });
    this.finalPass = new FSPass({
      fragmentShader: FINAL_FRAG,
      defines: c.tone === 'agx' ? { TONE_AGX: 1 } : {},
      uniforms: {
        tColor: { value: null }, tBloom: { value: null }, tExposure: { value: null }, uBloom: { value: c.bloom },
        uTime: { value: 0 }, uFade: { value: 1 }, uGrain: { value: 0.022 }, resolution: { value: new THREE.Vector2() },
        uUnderwater: { value: 0 }, uExposureBias: { value: c.exposureBias }, toneMappingExposure: { value: 1 }, uWet: { value: 0 },
      },
    });
  }

  setSize(cssW, cssH, dpr) {
    const s = this.cfg.scale;
    const w = Math.max(2, Math.round(cssW * dpr * s));
    const h = Math.max(2, Math.round(cssH * dpr * s));
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    this.compRT.setSize(w, h);
    this.taaRT[0].setSize(w, h); this.taaRT[1].setSize(w, h);
    this.resetHistory = true;
    this.dofRT.setSize(w, h);
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    this.reflRT.setSize(hw, hh);
    this.volRT.setSize(hw, hh);
    let bw = hw, bh = hh;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.down[i].setSize(Math.max(1, bw), Math.max(1, bh));
      this.up[i].setSize(Math.max(1, bw), Math.max(1, bh));
      bw >>= 1; bh >>= 1;
    }
    this.finalPass.material.uniforms.resolution.value.set(w, h);
    this.dofPass.material.uniforms.resolution.value.set(w, h);
  }

  addRipple(x, z, strength = 1) {
    const r = this.ripples[this.rippleIdx];
    r.set(x, z, this.time, strength);
    this.rippleIdx = (this.rippleIdx + 1) % this.ripples.length;
  }

  // 太陽の向きが変わったとき：影カメラを追従させ、深度を撮り直す
  setSun(sunColor) {
    const cen = this.cfg.sunCenter || new THREE.Vector3(0, 0, 0);
    this.sunCam.position.copy(cen).addScaledVector(this.cfg.sunDir, -130);
    this.sunCam.lookAt(cen);
    this.sunCam.updateMatrixWorld();
    if (sunColor) this.volPass.material.uniforms.uSunColor.value.copy(sunColor).multiplyScalar(this.cfg.sunVolume);
    this.sunDepthDirty = true;
  }

  // 太陽視点の深度（影とボリューメトリックで共用）
  renderSunDepth() {
    const cam = this.sunCam;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.lightViewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    shared.uSunVP.value.copy(this.lightViewProj);
    shared.tSunDepth.value = this.sunRT.depthTexture;
    const r = this.renderer;
    const prevBg = this.scene.background;
    this.scene.background = null;
    this.scene.overrideMaterial = this.overrideDepthMat;
    r.setRenderTarget(this.sunRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(this.scene, cam);
    this.scene.overrideMaterial = null;
    this.scene.background = prevBg;
    this.sunDepthDirty = false;
  }

  _reflectionPass(above) {
    const r = this.renderer, cam = this.camera, rc = this.reflCam;
    const wy = this.cfg.waterY;
    rc.projectionMatrix.copy(cam.projectionMatrix);
    rc.near = cam.near; rc.far = cam.far; rc.fov = cam.fov; rc.aspect = cam.aspect;
    const p = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    rc.position.set(p.x, 2 * wy - p.y, p.z);
    rc.up.set(up.x, -up.y, up.z);
    rc.lookAt(rc.position.x + dir.x, rc.position.y - dir.y, rc.position.z + dir.z);
    rc.updateMatrixWorld();
    rc.updateProjectionMatrix();
    this.reflViewProj.multiplyMatrices(rc.projectionMatrix, rc.matrixWorldInverse);
    r.clippingPlanes = [above ? this.clipUp : this.clipDown];
    r.setRenderTarget(this.reflRT);
    // 水中側の反射（全反射）では空を出さず、水中の暗い青で埋める
    r.setClearColor(above ? 0x000000 : 0x020c10, 1);
    r.clear(true, true, true);
    const sky = this.cfg.sky;
    if (sky) sky.visible = above;
    r.render(this.scene, rc);
    if (sky) sky.visible = true;
    r.clippingPlanes = [];
  }

  // 水中から見上げたときのための、水上の世界（キューブ）
  _renderAbove(camPos) {
    if (!this.aboveCubeCam) {
      this.aboveCubeCam = new THREE.CubeCamera(0.1, 400, this.aboveCube);
      this.aboveCubeCam.layers.set(0);
    }
    const c = this.aboveCubeCam;
    c.position.set(camPos.x, this.cfg.waterY + 0.6, camPos.z);
    this.renderer.clippingPlanes = [this.clipUp];
    c.update(this.renderer, this.scene);
    this.renderer.clippingPlanes = [];
    this.aboveFrame = this.stats.frame;
  }

  render(dt, state) {
    const r = this.renderer, cam = this.camera, c = this.cfg;
    this.time += dt;
    this.stats.frame++;
    cam.updateMatrixWorld();
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this.vpU.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.invVpU.copy(this.vpU).invert();
    const jt = this.halton[this.stats.frame % 16];
    if (c.taa !== false) cam.setViewOffset(this.w, this.h, jt[0], jt[1], this.w, this.h);
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.invViewProj.copy(this.viewProj).invert();
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    const under = camPos.y < c.waterY;

    if (this.sunDepthDirty) this.renderSunDepth();

    // 1. 反射（カメラの上下で反射側を切り替える）
    this._reflectionPass(!under);

    // 2. 水中→見上げ用のキューブ（水中にいるときだけ、数フレームに1回）
    let hasAbove = 0;
    if (under && camPos.y > c.waterY - 14) {
      if (!this.aboveFrame || this.stats.frame - this.aboveFrame > 3) this._renderAbove(camPos);
      hasAbove = 1;
    }

    // 3. シーン本体
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(this.scene, cam);

    // 4. ボリューメトリックライト（1/2解像度）
    const vu = this.volPass.material.uniforms;
    vu.tDepth.value = this.sceneRT.depthTexture;
    vu.tSunDepth.value = this.sunRT.depthTexture;
    vu.invViewProj.value.copy(this.invViewProj);
    vu.lightViewProj.value.copy(this.lightViewProj);
    vu.camPos.value.copy(camPos);
    vu.uTime.value = this.time;
    vu.uFrame.value = this.stats.frame % 16;
    this.volPass.render(r, this.volRT);

    // 5. 合成
    const cu = this.composePass.material.uniforms;
    cu.tColor.value = this.sceneRT.texture;
    cu.tDepth.value = this.sceneRT.depthTexture;
    cu.tRefl.value = this.reflRT.texture;
    cu.tVol.value = this.volRT.texture;
    cu.tAbove.value = this.aboveCube.texture;
    cu.uHasAbove.value = hasAbove;
    cu.invViewProj.value.copy(this.invViewProj);
    cu.viewProj.value.copy(this.viewProj);
    cu.reflViewProj.value.copy(this.reflViewProj);
    cu.camPos.value.copy(camPos);
    cu.uTime.value = this.time;
    this.composePass.render(r, this.compRT);

    // 5b. TAA
    const tu = this.taaPass.material.uniforms;
    const hist = this.taaRT[this.taaIdx], out = this.taaRT[this.taaIdx ^ 1];
    tu.tCur.value = this.compRT.texture;
    tu.tHist.value = hist.texture;
    tu.invVpCur.value.copy(this.invVpU);
    tu.vpPrev.value.copy(this.vpPrev);
    tu.camPos.value.copy(camPos);
    tu.texel.value.set(1 / this.w, 1 / this.h);
    tu.uReset.value = (this.resetHistory || c.taa === false) ? 1 : 0;
    this.taaPass.render(r, out);
    this.taaIdx ^= 1;
    this.resetHistory = false;
    this.vpPrev.copy(this.vpU);
    cam.clearViewOffset();
    cam.updateProjectionMatrix();

    let sceneTex = out.texture;
    if (this.dbg === 'scene') sceneTex = this.sceneRT.texture;
    else if (this.dbg === 'vol') sceneTex = this.volRT.texture;
    else if (this.dbg === 'refl') sceneTex = this.reflRT.texture;

    // 6. 自動露出
    this.logPass.material.uniforms.tColor.value = sceneTex;
    this.logPass.render(r, this.lumRT);
    const au = this.adaptPass.material.uniforms;
    au.tLum.value = this.lumRT.texture;
    au.tPrev.value = this.adaptRT[this.adaptIdx].texture;
    au.dt.value = dt;
    au.uInit.value = this.first ? 1 : 0;
    this.adaptIdx ^= 1;
    this.adaptPass.render(r, this.adaptRT[this.adaptIdx]);
    this.first = false;

    // 7. 被写界深度
    if (c.dof) {
      const du = this.dofPass.material.uniforms;
      du.tColor.value = sceneTex;
      du.tDepth.value = this.sceneRT.depthTexture;
      du.uFocus.value = state && state.focus ? state.focus : 8;
      this.dofPass.render(r, this.dofRT);
      sceneTex = this.dofRT.texture;
    }

    // 8. ブルーム
    const dpu = this.downPass.material.uniforms;
    let src = sceneTex, sw = this.w, sh = this.h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      dpu.tColor.value = src;
      dpu.texel.value.set(1 / sw, 1 / sh);
      dpu.uFirst.value = i === 0 ? 1 : 0;
      this.downPass.render(r, this.down[i]);
      src = this.down[i].texture;
      sw = this.down[i].width; sh = this.down[i].height;
    }
    const upu = this.upPass.material.uniforms;
    let low = this.down[BLOOM_LEVELS - 1].texture;
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      upu.tLow.value = low;
      upu.tHigh.value = this.down[i].texture;
      upu.texel.value.set(1 / this.down[i + 1].width, 1 / this.down[i + 1].height);
      upu.uMix.value = 1.0;
      this.upPass.render(r, this.up[i]);
      low = this.up[i].texture;
    }

    // 9. 最終
    const fu = this.finalPass.material.uniforms;
    fu.tColor.value = sceneTex;
    fu.tBloom.value = low;
    fu.tExposure.value = this.adaptRT[this.adaptIdx].texture;
    fu.uTime.value = this.time;
    fu.uFade.value = this.fade;
    fu.uBloom.value = c.bloom;
    fu.uExposureBias.value = c.exposureBias;
    fu.uUnderwater.value = under ? 1 : 0;
    fu.uWet.value = (state && state.wet) || 0;
    this.finalPass.render(r, null);
  }
}
