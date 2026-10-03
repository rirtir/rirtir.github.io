// SYNESTHESIA — WebGL2 レンダラー（HDR + ブルーム）
import * as S from './shaders.js';
import { hsl, mulberry32 } from './util.js';
import { NB, sampleSpec } from './analyze.js';

const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const lin = (c) => c.map(v => Math.pow(v, 2.2));

// ---- 小さな行列ライブラリ（列優先） ----
function perspective(fovy, asp, n, f) {
  const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
  return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]);
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function lookAt(eye, tgt, up) {
  const f = norm3(sub3(tgt, eye)), r = norm3(cross(f, up)), u = cross(r, f);
  const m = new Float32Array([
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2], 1,
  ]);
  return { m, f, r, u };
}

export const LANE_X = [-1.5, -0.5, 0.5, 1.5];
const TILE_W = 0.86, TILE_L = 0.46;
export const VIEW_LEN = 52;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 が使えません');
    this.gl = gl;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float'); gl.getExtension('OES_texture_float_linear'); this.targets = {}; this._initGL(); this._makeTargets(); this.lost = false; });
    this.extF = gl.getExtension('EXT_color_buffer_float');
    this.extH = gl.getExtension('EXT_color_buffer_half_float');
    if (!this.extF && !this.extH) throw new Error('浮動小数点レンダーターゲットが使えません');
    gl.getExtension('OES_texture_float_linear');
    this.time = 0;
    this.glow = 1; this.exposure = .92; this.ca = .45; this.quality = 1;
    this.camMotion = 1;
    this.setPalette({ lanes: ['#ff3d9a', '#ff9d3d', '#3de8ff', '#8a6bff'], a: '#1b0a46', b: '#ff2d95', c: '#ffb347' });
    this._initGL();
    this._initParticles();
    this.spec = new Float32Array(NB);
    this.cssW = 0; this.cssH = 0;
    this.flash = 0; this.punch = 0; this.fade = 1;
    this.sway = 0;
  }

  setPalette(p) {
    this.pal = p;
    this.laneCol = p.lanes.map(h => lin(hexToRgb(h)));
    this.colA = lin(hexToRgb(p.a)); this.colB = lin(hexToRgb(p.b)); this.colC = lin(hexToRgb(p.c));
  }

  _prog(vs, fs, attrs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(log, src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
        throw new Error('shader compile: ' + log);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    if (attrs) attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const nm = info.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  _attr(loc, size, stride, off) {
    const gl = this.gl;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    gl.vertexAttribDivisor(loc, 1);
  }

  _initGL() {
    const gl = this.gl;
    this.vaoEmpty = gl.createVertexArray();
    const SL = ['aA', 'aB', 'aC'];
    this.progs = {
      sky: this._prog(S.FS_VERT, S.SKY_FS),
      tap: this._prog(S.SLAB_VS, S.TAP_FS, SL),
      hold: this._prog(S.SLAB_VS, S.HOLD_FS, SL),
      line: this._prog(S.SLAB_VS, S.LINE_FS, SL),
      ring: this._prog(S.SLAB_VS, S.RING_FS, SL),
      floor: this._prog(S.SLAB_VS, S.FLOOR_FS, SL),
      bill: this._prog(S.BILL_VS, S.BILL_FS, ['aP', 'aS', 'aC']),
      down: this._prog(S.FS_VERT, S.DOWN_FS),
      up: this._prog(S.FS_VERT, S.UP_FS),
      compose: this._prog(S.FS_VERT, S.COMPOSE_FS),
    };
    const mkBuf = (floats) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, floats * 4, gl.DYNAMIC_DRAW); return b; };
    const mkVao = (buf) => {
      const v = gl.createVertexArray(); gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      this._attr(0, 4, 48, 0); this._attr(1, 4, 48, 16); this._attr(2, 4, 48, 32);
      return v;
    };
    // スラブ系（種類ごとにバッファ）
    this.slab = {};
    for (const [k, n] of [['tap', 400], ['hold', 160], ['line', 200], ['ring', 80], ['floor', 4]]) {
      const buf = mkBuf(n * 12);
      this.slab[k] = { buf, vao: mkVao(buf), data: new Float32Array(n * 12), n: 0, max: n };
    }
    this.billMax = 5200;
    this.billBuf = mkBuf(this.billMax * 12);
    this.billData = new Float32Array(this.billMax * 12);
    this.billN = 0;
    this.vaoBill = mkVao(this.billBuf);
    gl.bindVertexArray(null);
    this.targets = {};
  }

  _initParticles() {
    // 火花
    this.maxSpark = 700;
    this.sp = { x: new Float32Array(this.maxSpark), y: new Float32Array(this.maxSpark), z: new Float32Array(this.maxSpark), vx: new Float32Array(this.maxSpark), vy: new Float32Array(this.maxSpark), vz: new Float32Array(this.maxSpark), life: new Float32Array(this.maxSpark), max: new Float32Array(this.maxSpark), r: new Float32Array(this.maxSpark), g: new Float32Array(this.maxSpark), b: new Float32Array(this.maxSpark), size: new Float32Array(this.maxSpark), n: 0 };
    // 塵
    const rng = mulberry32(5);
    this.nDust = 320;
    this.dust = new Float32Array(this.nDust * 5);
    for (let i = 0; i < this.nDust; i++) {
      this.dust[i * 5] = (rng() - .5) * 16;
      this.dust[i * 5 + 1] = rng() * 7;
      this.dust[i * 5 + 2] = -rng() * 56 + 4;
      this.dust[i * 5 + 3] = .04 + rng() * .1;
      this.dust[i * 5 + 4] = rng();
    }
    this.rng = rng;
  }

  burst(x, z, col, n, power = 1) {
    const s = this.sp;
    for (let k = 0; k < n; k++) {
      if (s.n >= this.maxSpark) return;
      const i = s.n++;
      const a = this.rng() * Math.PI * 2, e = this.rng();
      const sp = (1.5 + this.rng() * 4.5) * power;
      s.x[i] = x + (this.rng() - .5) * .5; s.y[i] = .08; s.z[i] = z;
      s.vx[i] = Math.cos(a) * sp * .5 * (.4 + e); s.vy[i] = (1.5 + this.rng() * 4.5) * power * (.5 + e * .6); s.vz[i] = Math.sin(a) * sp * .55 - 1.2;
      s.life[i] = s.max[i] = .35 + this.rng() * .6;
      const w = this.rng() * .5;
      s.r[i] = col[0] * (1 - w) + w; s.g[i] = col[1] * (1 - w) + w; s.b[i] = col[2] * (1 - w) + w;
      s.size[i] = .05 + this.rng() * .09;
    }
  }

  // ---- リサイズ ----
  resize(cssW, cssH, dpr, quality = 1) {
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr; this.quality = quality;
    const r = Math.max(0.3, Math.min(dpr, 2) * quality);
    let w = Math.max(2, Math.floor(cssW * r)), h = Math.max(2, Math.floor(cssH * r));
    const maxPx = 3.6e6;
    if (w * h > maxPx) { const k = Math.sqrt(maxPx / (w * h)); w = Math.floor(w * k); h = Math.floor(h * k); }
    this.canvas.width = w; this.canvas.height = h;
    this.w = w; this.h = h;
    this._makeTargets();
  }

  _tex(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fbo: f, w, h };
  }
  _freeRT(r) { if (!r) return; this.gl.deleteTexture(r.tex); this.gl.deleteFramebuffer(r.fbo); }
  _makeTargets() {
    const T = this.targets;
    this._freeRT(T.scene);
    (T.down || []).forEach(r => this._freeRT(r));
    T.scene = this._tex(this.w, this.h);
    T.down = [];
    let w = this.w, h = this.h;
    for (let i = 0; i < 6; i++) {
      w = Math.max(2, Math.floor(w / 2)); h = Math.max(2, Math.floor(h / 2));
      T.down.push(this._tex(w, h));
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  _bindTex(unit, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  _fs() { this.gl.bindVertexArray(this.vaoEmpty); this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }

  // ---- カメラ ----
  _camera(s) {
    const asp = this.w / this.h;
    const portrait = asp < 1;
    // 縦長では引いて高くする
    const k = portrait ? Math.min(1.9, 1 + (1 / asp - 1) * .55) : 1;
    const sway = this.camMotion * (Math.sin(this.time * .31) * .16 + s.bend[0] * 14);
    const punch = this.punch * this.camMotion;
    const C = this.camCfg || (this.camCfg = { ey: 3.2, ez: 5.4, ty: .8, tz: -9, fov: 50, hill: .0018 });
    const eye = [sway * .6, C.ey * k + punch * .05, C.ez * k + (portrait ? 0.8 * (k - 1) : 0)];
    const tgt = [sway * .15 + s.bend[0] * 6, C.ty, C.tz];
    const roll = this.camMotion * (Math.sin(this.time * .21) * .012 - s.bend[0] * 9 + (this.shakeX || 0) * .01);
    const up = [Math.sin(roll), Math.cos(roll), 0];
    const la = lookAt(eye, tgt, up);
    const vfov = (portrait ? C.fov + 8 : C.fov) * Math.PI / 180 * (1 - punch * .012);
    const P = perspective(vfov, asp, .1, 200);
    const SHIFT = portrait ? .10 : (this.cssH < 500 ? .1 : .15);
    P[9] = -SHIFT;   // レンズシフト: 判定線を持ち上げて空を見せる
    this.shift = SHIFT;
    this.cam = { eye, vp: mul(P, la.m), r: la.r, u: la.u, f: la.f, tanY: Math.tan(vfov / 2), tanX: Math.tan(vfov / 2) * asp };
  }

  // 画面座標(0..1, 左上原点)をハイウェイ手前のレーンに変換するために、判定線のレーン中心の画面位置を返す
  project(x, y, z) {
    const c = this.cam; if (!c) return [.5, .5];
    const bend = this.bend || [0, 0];
    const d = Math.max(0, -z);
    const px = x + bend[0] * d * d, py = y + bend[1] * d * d;
    const m = c.vp;
    const cx = m[0] * px + m[4] * py + m[8] * z + m[12];
    const cy = m[1] * px + m[5] * py + m[9] * z + m[13];
    const cw = m[3] * px + m[7] * py + m[11] * z + m[15];
    return [(cx / cw) * .5 + .5, 1 - ((cy / cw) * .5 + .5)];
  }

  _u(p, mirror = 0, mul = 1, lift = 0) {
    const gl = this.gl, u = p.u, c = this.cam;
    gl.useProgram(p.p);
    if (u.uVP) gl.uniformMatrix4fv(u.uVP, false, c.vp);
    if (u.uEye) gl.uniform3fv(u.uEye, c.eye);
    if (u.uBend) gl.uniform2fv(u.uBend, this.bend);
    if (u.uMirror) gl.uniform1f(u.uMirror, mirror);
    if (u.uTime) gl.uniform1f(u.uTime, this.time);
    if (u.uRes) gl.uniform2f(u.uRes, this.w, this.h);
    if (u.uMul) gl.uniform1f(u.uMul, mul);
    if (u.uLift) gl.uniform1f(u.uLift, lift);
    if (u.uRight) gl.uniform3fv(u.uRight, c.r);
    if (u.uUp) gl.uniform3fv(u.uUp, c.u);
  }
  _scene(p) {
    const gl = this.gl, u = p.u, a = this.aud;
    if (u.uColA) gl.uniform3fv(u.uColA, this.colA);
    if (u.uColB) gl.uniform3fv(u.uColB, this.colB);
    if (u.uColC) gl.uniform3fv(u.uColC, this.colC);
    if (u.uAud) gl.uniform4f(u.uAud, a[0], a[1], a[2], a[3]);
    if (u.uFlash) gl.uniform1f(u.uFlash, this.flash);
    if (u.uBeat) gl.uniform1f(u.uBeat, this.beatPulse || 0);
    if (u.uInten) gl.uniform1f(u.uInten, this.inten || 0);
  }

  _upload(k) {
    const gl = this.gl, s = this.slab[k];
    gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data, 0, s.n * 12);
  }
  _drawSlab(k, mirror, mul, lift) {
    const gl = this.gl, s = this.slab[k];
    if (!s.n) return;
    const p = this.progs[k];
    this._u(p, mirror, mul, lift);
    this._scene(p);
    gl.bindVertexArray(s.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * (S.SEGMENTS + 1), s.n);
  }
  _pushSlab(k, cx, zN, zF, w, type, p1, p2, p3, r, g, b, a) {
    const s = this.slab[k];
    if (s.n >= s.max) return;
    const o = s.n++ * 12, d = s.data;
    d[o] = cx; d[o + 1] = zN; d[o + 2] = zF; d[o + 3] = w;
    d[o + 4] = type; d[o + 5] = p1; d[o + 6] = p2; d[o + 7] = p3;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
  }
  _pushBill(x, y, z, type, w, h, p1, p2, r, g, b, a) {
    if (this.billN >= this.billMax) return;
    const o = this.billN++ * 12, d = this.billData;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = type;
    d[o + 4] = w; d[o + 5] = h; d[o + 6] = p1; d[o + 7] = p2;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
  }

  // ---- 描画 ----
  // s: { t, dt, time, speed, notes, i0, beats, downPhase, laneGlow[4], an(解析), aud[4], flash, punch, inten, bend[2], rings[], glows[], fade, hudHit }
  render(s) {
    if (this.lost) return;
    const gl = this.gl;
    const T = this.targets;
    this.time = s.time;
    this.bend = s.bend ? [s.bend[0], s.bend[1] + ((this.camCfg && this.camCfg.hill) || 0)] : [0, 0];
    this.aud = s.aud || [0, 0, 0, 0];
    this.flash = s.flash || 0; this.punch = s.punch || 0; this.inten = s.inten || 0;
    this.beatPulse = s.beatPulse || 0;
    this._camera(s);
    const dt = Math.min(0.05, s.dt || 0.016);
    const speed = s.speed;
    const t = s.t;
    const zOf = (tt) => -(tt - t) * speed;

    // ===== インスタンスの組み立て =====
    for (const k in this.slab) this.slab[k].n = 0;
    this.billN = 0;
    const lc = this.laneCol, cA = this.colA, cB = this.colB, cC = this.colC;

    // 床（1枚）
    this._pushSlab('floor', 0, 6, -(VIEW_LEN + 14), 4.0, 0, 0, 0, 0, 1, 1, 1, 1);
    // 拍の線
    const beats = s.beats;
    if (beats && beats.length) {
      let lo = 0, hi = beats.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (beats[m] < t - 0.15) lo = m + 1; else hi = m; }
      for (let i = lo; i < beats.length; i++) {
        const z = zOf(beats[i]);
        if (z < -VIEW_LEN - 4) break;
        const sg = (s.an && s.an.sig) || 4;
        const isBar = (((i - (s.downPhase || 0)) % sg) + sg) % sg === 0;
        const a = isBar ? .85 : .32;
        this._pushSlab('line', 0, z + .09, z - .09, 4.0, 0, 0, 0, 0, cB[0] * a, cB[1] * a, cB[2] * a, 1);
      }
    }
    // 判定線とレシーバ
    {
      const bp = 1 + this.beatPulse * .6;
      this._pushSlab('line', 0, .2, -.2, 4.08, 0, 0, 0, 0, cC[0] * 1.5 * bp, cC[1] * 1.5 * bp, cC[2] * 1.5 * bp, 1);
      for (let l = 0; l < 4; l++) {
        const g = s.laneGlow[l];
        this._pushSlab('tap', LANE_X[l], .25, -.25, TILE_W + .04, 3, g, 0, 0, lc[l][0], lc[l][1], lc[l][2], 1);
      }
    }
    // ノーツ（遠い順に描くため、可視のものを集めて逆順に積む）
    const vis = this._vis || (this._vis = []);
    vis.length = 0;
    const notes = s.notes;
    for (let i = s.i0; i < notes.length; i++) {
      const n = notes[i];
      const z = zOf(n.t);
      if (z < -VIEW_LEN - 4) break;
      vis.push(n);
    }
    for (let j = vis.length - 1; j >= 0; j--) {
      const n = vis[j];
      const z = zOf(n.t);
      const c = lc[n.lane];
      const near = Math.max(0, 1 - Math.abs(z) / 6);
      if (n.dur > 0) {
        if (n.state === 3) continue;
        const zt = zOf(n.t + n.dur);
        if (zt > 2.5) continue;
        const held = n.state === 2;
        const zh = held ? 0 : z;
        const act = held ? 1 : (n.state >= 4 ? 2 : 0);
        this._pushSlab('hold', LANE_X[n.lane], Math.min(zh, 3), Math.max(zt, -VIEW_LEN - 8), TILE_W * .62, act, 0, 0, 0, c[0], c[1], c[2], 1);
        if (!held) {
          if (z < 3.2 && n.state === 0) this._pushBill(LANE_X[n.lane], 0, z, 2, .42, 1.5, 0, 0, c[0], c[1], c[2], .24);
          if (z < 3.2) this._pushSlab('tap', LANE_X[n.lane], z + TILE_L / 2, z - TILE_L / 2, TILE_W, n.state >= 4 ? 1 : 2, near + this.beatPulse * .3, 0, 0, c[0], c[1], c[2], 1);
        } else {
          this._pushSlab('tap', LANE_X[n.lane], TILE_L / 2, -TILE_L / 2, TILE_W, 2, 1.2, 0, 0, c[0], c[1], c[2], 1);
        }
        // 終端のキャップ
        if (zt > -VIEW_LEN) this._pushSlab('tap', LANE_X[n.lane], zt + .1, zt - .1, TILE_W * .62, n.state >= 4 ? 1 : 2, 0, 0, 0, c[0], c[1], c[2], .9);
      } else {
        if (n.state !== 0 && n.state !== 4) continue;
        if (z > 3.2) continue;
        if (n.state === 0) this._pushBill(LANE_X[n.lane], 0, z, 2, .42, 1.5, 0, 0, c[0], c[1], c[2], .24);
        const hl = TILE_L / 2 * (1 + Math.max(0, -z) * .05);
        this._pushSlab('tap', LANE_X[n.lane], z + hl, z - hl, TILE_W, n.state === 4 ? 1 : 0, near + this.beatPulse * .3, 0, 0, c[0], c[1], c[2], 1);
      }
    }
    // リング（判定時の波紋）
    for (const r of s.rings) {
      const k = r.age / r.dur; if (k >= 1) continue;
      const sz = (.6 + k * .55) * (r.big ? 1.15 : 1);
      this._pushSlab('ring', LANE_X[r.lane], sz / 2, -sz / 2, sz, 0, k, 0, 0, r.col[0], r.col[1], r.col[2], 1);
    }

    // ビルボード: スペクトルの柱
    const an = s.an;
    if (an) {
      const rows = 36, spacing = 1.5;
      const frac = ((t * speed) % spacing + spacing) % spacing;
      const sp = this.spec;
      const aud1 = s.aud;
      for (let r = 0; r < rows; r++) {
        const z = -(r + frac) * spacing + .4;
        const tt = t + (-z) / speed;
        sampleSpec(an, tt, sp);
        for (let side = -1; side <= 1; side += 2) {
          for (let k = 0; k < 12; k++) {
            let v = 0; for (let q = 0; q < 4; q++) v += sp[k * 4 + q]; v /= 4;
            const vv = Math.max(0, v - .28) / .72, sh = Math.pow(vv, 1.7);
            const h = .06 + sh * (1.9 + k * .2) * (1 - (s.hush || 0) * .7);
            const x = side * (2.8 + k * .72);
            const m = k / 11;
            const ca = m < .5 ? lc[2] : lc[0], cb2 = m < .5 ? lc[0] : lc[3], mm = m < .5 ? m * 2 : (m - .5) * 2;
            const cr = ca[0] * (1 - mm) + cb2[0] * mm, cg = ca[1] * (1 - mm) + cb2[1] * mm, cb = ca[2] * (1 - mm) + cb2[2] * mm;
            const br = (.06 + sh * 1.15) * (1 - m * .3);
            if (sh > .015) this._pushBill(x, 0, z, 1, .3, h, 0, 0, cr * br, cg * br, cb * br, 1);
          }
        }
      }
      void aud1;
    }
    // レーンの光柱
    for (let l = 0; l < 4; l++) {
      const g = s.laneGlow[l];
      if (g > .02) this._pushBill(LANE_X[l], 0, 0, 2, .95, 3.4, 0, 0, lc[l][0], lc[l][1], lc[l][2], g);
    }
    // 判定のフラッシュ
    for (const gl2 of s.glows) {
      const k = gl2.age / gl2.dur; if (k >= 1) continue;
      this._pushBill(LANE_X[gl2.lane], .15, 0, 0, 1.3 * (1 + k * .5) * gl2.size, 1.3 * (1 + k * .5) * gl2.size, 0, 0, gl2.col[0], gl2.col[1], gl2.col[2], (1 - k) * (1 - k) * .42);
    }
    // 塵
    {
      const d = this.dust, spd = speed * .3;
      const col = cC;
      for (let i = 0; i < this.nDust; i++) {
        const o = i * 5;
        d[o + 2] += (spd * (.6 + d[o + 3] * 4)) * dt;
        d[o + 1] += Math.sin(this.time * .5 + d[o + 4] * 20) * .08 * dt;
        if (d[o + 2] > 4.5) { d[o + 2] = -VIEW_LEN - 4; d[o] = (this.rng() - .5) * 16; d[o + 1] = this.rng() * 7; }
        const tw = .5 + .5 * Math.sin(this.time * 2 + d[o + 4] * 50);
        const a = .1 + .25 * tw + s.aud[2] * .3;
        const m = d[o + 4];
        this._pushBill(d[o], d[o + 1], d[o + 2], 0, d[o + 3] * 1.4 + .05, d[o + 3] * 1.4 + .05, 0, 0, cB[0] * (1 - m) + col[0] * m, cB[1] * (1 - m) + col[1] * m, cB[2] * (1 - m) + col[2] * m, a);
      }
    }
    // 火花
    {
      const p = this.sp;
      let w = 0;
      for (let i = 0; i < p.n; i++) {
        p.life[i] -= dt;
        if (p.life[i] <= 0) continue;
        p.vy[i] -= 11 * dt; p.vx[i] *= (1 - 1.4 * dt); p.vz[i] *= (1 - 1.4 * dt);
        p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
        if (p.y[i] < 0.02) { p.y[i] = .02; p.vy[i] *= -.35; }
        if (w !== i) { for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'max', 'r', 'g', 'b', 'size']) p[k][w] = p[k][i]; }
        const a = Math.pow(p.life[w] / p.max[w], 1.3);
        this._pushBill(p.x[w], p.y[w], p.z[w], 3, p.size[w] * (.6 + a), p.size[w] * (.6 + a), 0, 0, p.r[w] * 2.4, p.g[w] * 2.4, p.b[w] * 2.4, a);
        w++;
      }
      p.n = w;
    }

    // アップロード
    for (const k in this.slab) this._upload(k);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.billBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.billData, 0, this.billN * 12);

    // ===== シーンパス =====
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    {
      const p = this.progs.sky; this._u(p); this._scene(p);
      gl.uniform3fv(p.u.uCamR, this.cam.r); gl.uniform3fv(p.u.uCamU, this.cam.u); gl.uniform3fv(p.u.uCamF, this.cam.f);
      gl.uniform2f(p.u.uTan, this.cam.tanX, this.cam.tanY);
      gl.uniform1f(p.u.uShift, this.shift);
      this._fs();
    }
    // 映り込み（床の下に反転して描く）
    gl.enable(gl.BLEND);
    const MIR = .3;
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this._drawSlab('hold', 1, MIR, .02);
    this._drawSlab('tap', 1, MIR, .04);
    gl.blendFunc(gl.ONE, gl.ONE);
    this._drawBill(1, MIR);
    // 床
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    {
      const p = this.progs.floor; this._u(p, 0, 1, 0); this._scene(p);
      const lg = s.laneGlow;
      gl.uniform4f(p.u.uLaneGlow, lg[0], lg[1], lg[2], lg[3]);
      const flat = new Float32Array(12); for (let i = 0; i < 4; i++) { flat[i * 3] = lc[i][0]; flat[i * 3 + 1] = lc[i][1]; flat[i * 3 + 2] = lc[i][2]; }
      gl.uniform3fv(p.u.uLaneCol, flat);
      gl.uniform1f(p.u.uScroll, t * speed);
      gl.bindVertexArray(this.slab.floor.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * (S.SEGMENTS + 1), 1);
    }
    // 本体
    gl.blendFunc(gl.ONE, gl.ONE);
    this._drawSlab('line', 0, 1, .012);
    this._drawSlab('ring', 0, 1, .03);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this._drawSlab('hold', 0, 1, .02);
    this._drawSlab('tap', 0, 1, .04);
    gl.blendFunc(gl.ONE, gl.ONE);
    this._drawBill(0, 1);
    gl.disable(gl.BLEND);

    // ===== ブルーム =====
    let src = T.scene;
    const down = T.down;
    this._u(this.progs.down);
    for (let i = 0; i < down.length; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, down[i].fbo);
      gl.viewport(0, 0, down[i].w, down[i].h);
      this._bindTex(0, src.tex);
      gl.uniform1i(this.progs.down.u.uTex, 0);
      gl.uniform2f(this.progs.down.u.uTexel, 1 / src.w, 1 / src.h);
      gl.uniform1f(this.progs.down.u.uFirst, i === 0 ? 1 : 0);
      this._fs();
      src = down[i];
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    this._u(this.progs.up);
    const wts = [0.34, 0.32, 0.3, 0.28, 0.26];
    for (let i = down.length - 1; i > 0; i--) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, down[i - 1].fbo);
      gl.viewport(0, 0, down[i - 1].w, down[i - 1].h);
      this._bindTex(0, down[i].tex);
      gl.uniform1i(this.progs.up.u.uTex, 0);
      gl.uniform2f(this.progs.up.u.uTexel, 1 / down[i].w, 1 / down[i].h);
      gl.uniform1f(this.progs.up.u.uW, wts[i - 1] * 0.95);
      this._fs();
    }
    gl.disable(gl.BLEND);

    // ===== 合成 =====
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    {
      const P = this.progs.compose; this._u(P);
      this._bindTex(0, T.scene.tex); gl.uniform1i(P.u.uScene, 0);
      this._bindTex(1, down[0].tex); gl.uniform1i(P.u.uBloom, 1);
      gl.uniform1f(P.u.uBloomK, this.glow * .42);
      gl.uniform1f(P.u.uExposure, this.exposure);
      gl.uniform1f(P.u.uFlash, this.flash);
      gl.uniform1f(P.u.uPunch, this.punch * this.camMotion);
      gl.uniform1f(P.u.uCA, this.ca);
      gl.uniform3f(P.u.uTint, 1, 1, 1);
      gl.uniform1f(P.u.uVig, .55);
      gl.uniform1f(P.u.uFade, s.fade != null ? s.fade : 1);
      gl.uniform3fv(P.u.uAccent, cB);
      this._fs();
    }
  }

  _drawBill(mirror, mul) {
    const gl = this.gl;
    if (!this.billN) return;
    const p = this.progs.bill;
    this._u(p, mirror, mul, 0);
    if (p.u.uMul) gl.uniform1f(p.u.uMul, mul);
    gl.bindVertexArray(this.vaoBill);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.billN);
  }
}
