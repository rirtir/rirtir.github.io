// PRISM — WebGL2 レンダラー（HDR + ブルーム + ストリーク）
import * as S from './shaders.js';
import { W, H, TRAY_Y, NB, BIN_RGB, nmRGB, LAM } from './optics.js';

const TYPE_ID = { mirror: 0, splitter: 1, filter: 2, prism: 3, slab: 4, ball: 5, wall: 6, laser: 7, target: 8, well: 9 };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 が使えません');
    this.gl = gl;
    this.extF = gl.getExtension('EXT_color_buffer_float');
    this.extH = gl.getExtension('EXT_color_buffer_half_float');
    if (!this.extF && !this.extH) throw new Error('浮動小数点レンダーターゲットが使えません');
    gl.getExtension('OES_texture_float_linear');
    this.hdrFmt = this.extF ? gl.RGBA16F : gl.RGBA16F;
    this.margin = { l: 12, r: 12, t: 64, b: 76 };
    this.rotated = false; this.art = false;
    this.scale = 1;       // 画面ピクセル/ユニット
    this.org = [0, 0];
    this.quality = 1;
    this.dpr = 1;
    this.glow = 1;
    this.flash = 0;
    this.shock = [0.5, 0.5, 0, 0];
    this.exposure = 1.0;
    this.time = 0;
    this._initGL();
    this._initMotes();
    this.cssW = 0; this.cssH = 0;
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
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  _initGL() {
    const gl = this.gl;
    this.vaoEmpty = gl.createVertexArray();
    this.progs = {
      beam: this._prog(S.BEAM_VS, S.BEAM_FS, ['aSeg', 'aCol', 'aEx']),
      spr: this._prog(S.SPR_VS, S.SPR_FS, ['aPos', 'aCol', 'aEx']),
      bg: this._prog(S.FS_VERT, S.BG_FS),
      elem: this._prog(S.ELEM_VS, S.ELEM_FS, ['aA', 'aP', 'aC', 'aS']),
      mote: this._prog(S.MOTE_VS, S.MOTE_FS, ['aM']),
      down: this._prog(S.FS_VERT, S.DOWN_FS),
      up: this._prog(S.FS_VERT, S.UP_FS),
      streak: this._prog(S.FS_VERT, S.STREAK_FS),
      streak2: this._prog(S.FS_VERT, S.STREAK2_FS),
      compose: this._prog(S.FS_VERT, S.COMPOSE_FS),
    };
    // ビームの正規化定数
    const m = [0, 0, 0];
    // BIN_RGB は平均1に正規化済み。シェーダ用には生のRGB平均が必要
    // （optics側と同じ式で再計算）
    this.norm = this._rawNorm();
    // インスタンスバッファ
    const mkBuf = (floats) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, floats * 4, gl.DYNAMIC_DRAW); return b; };
    this.maxBeams = 16000; this.maxSprites = 12000; this.maxElems = 80;
    this.beamBuf = mkBuf(this.maxBeams * 12);
    this.sprBuf = mkBuf(this.maxSprites * 10);
    this.elemBuf = mkBuf(this.maxElems * 16);
    this.beamData = new Float32Array(this.maxBeams * 12);
    this.sprData = new Float32Array(this.maxSprites * 10);
    this.elemData = new Float32Array(this.maxElems * 16);
    // VAOs
    this.vaoBeam = gl.createVertexArray(); gl.bindVertexArray(this.vaoBeam);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf);
    this._attr(0, 4, 48, 0); this._attr(1, 4, 48, 16); this._attr(2, 4, 48, 32);
    this.vaoSpr = gl.createVertexArray(); gl.bindVertexArray(this.vaoSpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sprBuf);
    this._attr(0, 4, 40, 0); this._attr(1, 4, 40, 16); this._attr(2, 2, 40, 32);
    this.vaoElem = gl.createVertexArray(); gl.bindVertexArray(this.vaoElem);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.elemBuf);
    for (let i = 0; i < 4; i++) this._attr(i, 4, 64, i * 16);
    gl.bindVertexArray(null);
    this.targets = {};
  }
  _rawNorm() {
    const f = (l, mu, s1, s2) => { const t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
    const m = [0, 0, 0];
    for (let i = 0; i < NB; i++) {
      const l = LAM[i];
      const x = 1.056 * f(l, 599.8, 37.9, 31.0) + 0.362 * f(l, 442.0, 16.0, 26.7) - 0.065 * f(l, 501.1, 20.4, 26.2);
      const y = 0.821 * f(l, 568.8, 46.9, 40.5) + 0.286 * f(l, 530.9, 16.3, 31.1);
      const z = 1.217 * f(l, 437.0, 11.8, 36.0) + 0.681 * f(l, 459.0, 26.0, 13.8);
      const c = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.2040 * y + 1.0570 * z];
      for (let k = 0; k < 3; k++) m[k] += Math.max(0, c[k]) / NB;
    }
    return m;
  }
  _attr(loc, size, stride, off) {
    const gl = this.gl;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    gl.vertexAttribDivisor(loc, 1);
  }

  _initMotes() {
    const gl = this.gl;
    this.nMotes = 360;
    this.motes = new Float32Array(this.nMotes * 4);
    this.moteVel = new Float32Array(this.nMotes * 2);
    for (let i = 0; i < this.nMotes; i++) {
      this.motes[i * 4] = Math.random() * W;
      this.motes[i * 4 + 1] = Math.random() * H;
      this.motes[i * 4 + 2] = 0.018 + Math.random() * 0.03;
      this.motes[i * 4 + 3] = Math.random();
      this.moteVel[i * 2] = (Math.random() - 0.5) * 0.08;
      this.moteVel[i * 2 + 1] = (Math.random() - 0.5) * 0.08;
    }
    this.moteBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.moteBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.motes.byteLength, gl.DYNAMIC_DRAW);
    this.vaoMote = gl.createVertexArray(); gl.bindVertexArray(this.vaoMote);
    this._attr(0, 4, 16, 0);
    gl.bindVertexArray(null);
  }

  // ---- リサイズ・レイアウト ----
  resize(cssW, cssH, dpr, quality = 1) {
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr; this.quality = quality;
    const r = Math.max(0.35, Math.min(dpr, 2) * quality);
    let w = Math.max(2, Math.floor(cssW * r)), h = Math.max(2, Math.floor(cssH * r));
    const maxPx = 4.2e6;
    if (w * h > maxPx) { const k = Math.sqrt(maxPx / (w * h)); w = Math.floor(w * k); h = Math.floor(h * k); }
    this.pxRatio = w / cssW;
    this.canvas.width = w; this.canvas.height = h;
    this.w = w; this.h = h;
    this._layout();
    this._makeTargets();
  }
  setMargins(m) { this.margin = m; if (this.w) this._layout(); }
  _layout() {
    const m = this.margin, k = this.pxRatio;
    const aw = (this.cssW - m.l - m.r), ah = (this.cssH - m.t - m.b);
    let sc;
    if (this.rotated) {
      sc = Math.max(8, Math.min(aw / H, ah / W));
      this.cssOrg = [m.l + (aw - sc * H) / 2, m.t + (ah - sc * W) / 2 + sc * W];
    } else {
      sc = Math.max(8, Math.min(aw / W, ah / H));
      this.cssOrg = [m.l + (aw - sc * W) / 2, m.t + (ah - sc * H) / 2];
    }
    this.cssScale = sc;
    this.scale = sc * k;
    this.org = [this.cssOrg[0] * k, this.cssOrg[1] * k];
  }
  // CSSピクセル <-> ワールド
  toWorld(cx, cy) {
    const s = this.cssScale;
    if (this.rotated) return [(this.cssOrg[1] - cy) / s, (cx - this.cssOrg[0]) / s];
    return [(cx - this.cssOrg[0]) / s, (cy - this.cssOrg[1]) / s];
  }
  toCss(x, y) {
    const s = this.cssScale;
    if (this.rotated) return [this.cssOrg[0] + y * s, this.cssOrg[1] - x * s];
    return [this.cssOrg[0] + x * s, this.cssOrg[1] + y * s];
  }
  worldToUv(x, y) {
    const [cx, cy] = this.toCss(x, y);
    return [cx / this.cssW, 1 - cy / this.cssH];
  }

  _tex(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.hdrFmt, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
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
    const gl = this.gl;
    const T = this.targets;
    for (const k of ['emit', 'scene', 'streakA', 'streakB']) this._freeRT(T[k]);
    (T.down || []).forEach(r => this._freeRT(r));
    T.emit = this._tex(this.w, this.h);
    T.scene = this._tex(this.w, this.h);
    T.down = [];
    let w = this.w, h = this.h;
    for (let i = 0; i < 7; i++) {
      w = Math.max(2, Math.floor(w / 2)); h = Math.max(2, Math.floor(h / 2));
      T.down.push(this._tex(w, h));
    }
    const sw = Math.max(2, Math.floor(this.w / 4)), sh = Math.max(2, Math.floor(this.h / 4));
    T.streakA = this._tex(sw, sh); T.streakB = this._tex(sw, sh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    void st;
  }

  _u(p) {
    const gl = this.gl;
    gl.useProgram(p.p);
    const u = p.u;
    if (u.uRes) gl.uniform2f(u.uRes, this.w, this.h);
    if (u.uOrg) gl.uniform2f(u.uOrg, this.org[0], this.org[1]);
    if (u.uScale) gl.uniform1f(u.uScale, this.scale);
    if (u.uTime) gl.uniform1f(u.uTime, this.time);
    if (u.uRot) gl.uniformMatrix2fv(u.uRot, false, this.rotated ? [0, -1, 1, 0] : [1, 0, 0, 1]);
  }
  _bindTex(unit, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  _fs() { this.gl.bindVertexArray(this.vaoEmpty); this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }

  // ---- フレーム描画 ----
  // state: { els, trace, hover, charge:Map(id->{fill,bad,charge}), sprites:Float32Array, nSprites, dt }
  render(state) {
    const gl = this.gl;
    const T = this.targets;
    this.time = state.time;
    const dt = state.dt || 0.016;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);

    // ===== 1. 発光パス（ビーム・フレア・スプライト） =====
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.emit.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const tr = state.trace;
    const gain = state.beamGain != null ? state.beamGain : 3.2;
    const sigma = 0.036;
    if (tr && tr.nseg) {
      const n = Math.min(tr.nseg, this.maxBeams);
      const d = this.beamData; const sg = tr.segs;
      for (let i = 0; i < n; i++) {
        const o = i * 12, s = i * 6;
        const b = sg[s + 4] | 0, p = sg[s + 5] * gain;
        const c = BIN_RGB[b];
        d[o] = sg[s]; d[o + 1] = sg[s + 1]; d[o + 2] = sg[s + 2]; d[o + 3] = sg[s + 3];
        d[o + 4] = c[0] * p; d[o + 5] = c[1] * p; d[o + 6] = c[2] * p; d[o + 7] = sigma;
        d[o + 8] = tr.segS[i]; const fl = tr.segF[i]; d[o + 9] = fl & 1; d[o + 10] = (fl >> 1) & 1;
      }
      this._u(this.progs.beam);
      gl.uniform1f(this.progs.beam.u.uHalo, sigma * 9);
      gl.uniform1f(this.progs.beam.u.uReveal, state.reveal != null ? state.reveal : 1e4);
      gl.bindVertexArray(this.vaoBeam);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 12);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    // スプライト: マーク（反射点フレア）+ 外部スプライト
    let ns = 0; const sd = this.sprData;
    const pushSpr = (x, y, size, type, r, g, b, a, rot = 0, par = 0) => {
      if (ns >= this.maxSprites) return;
      const o = ns++ * 10;
      sd[o] = x; sd[o + 1] = y; sd[o + 2] = size; sd[o + 3] = type;
      sd[o + 4] = r; sd[o + 5] = g; sd[o + 6] = b; sd[o + 7] = a; sd[o + 8] = rot; sd[o + 9] = par;
    };
    if (tr && tr.marks) {
      const mk = tr.marks;
      const kindSize = [0.34, 0.22, 0.5, 0.3, 0.3, 0.2, 0.3];
      const kindGain = [3.2, 2.0, 4.0, 2.2, 3.0, 1.6, 2.0];
      for (let i = 0; i < mk.length; i += 6) {
        const kind = mk[i + 5] | 0;
        const rvl = state.reveal != null ? state.reveal : 1e4;
        const g = kindGain[kind] * gain * 0.07 * (1 - Math.min(1, Math.max(0, (tr.markS[i / 6] - rvl + 0.3) / 0.3)));
        if (g <= 0) continue;
        pushSpr(mk[i], mk[i + 1], kindSize[kind], kind === 2 ? 2 : 0, mk[i + 2], mk[i + 3], mk[i + 4], g, 0, 0);
      }
    }
    if (state.sprites) {
      const n = Math.min(state.nSprites, this.maxSprites - ns);
      sd.set(state.sprites.subarray(0, n * 10), ns * 10); ns += n;
    }
    if (ns) {
      this._u(this.progs.spr);
      gl.bindVertexArray(this.vaoSpr);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sprBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sd, 0, ns * 10);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, ns);
    }

    // ===== 2. ブルーム =====
    gl.disable(gl.BLEND);
    let src = T.emit;
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
    const wts = [0.32, 0.3, 0.3, 0.28, 0.24, 0.2];
    for (let i = down.length - 1; i > 0; i--) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, down[i - 1].fbo);
      gl.viewport(0, 0, down[i - 1].w, down[i - 1].h);
      this._bindTex(0, down[i].tex);
      gl.uniform1i(this.progs.up.u.uTex, 0);
      gl.uniform2f(this.progs.up.u.uTexel, 1 / down[i].w, 1 / down[i].h);
      gl.uniform1f(this.progs.up.u.uW, wts[i - 1] * 0.9);
      this._fs();
    }
    gl.disable(gl.BLEND);
    // ストリーク（水平方向）
    {
      const sa = T.streakA, sb = T.streakB;
      const P = this.progs.streak;
      this._u(P);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sa.fbo); gl.viewport(0, 0, sa.w, sa.h);
      this._bindTex(0, down[1].tex); gl.uniform1i(P.u.uTex, 0);
      gl.uniform2f(P.u.uStep, 3 / sa.w, 0); gl.uniform1f(P.u.uThr, 1.4);
      this._fs();
      const P2 = this.progs.streak2;
      this._u(P2);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sb.fbo);
      this._bindTex(0, sa.tex); gl.uniform1i(P2.u.uTex, 0);
      gl.uniform2f(P2.u.uStep, 11 / sa.w, 0); this._fs();
      gl.bindFramebuffer(gl.FRAMEBUFFER, sa.fbo);
      this._bindTex(0, sb.tex);
      gl.uniform2f(P2.u.uStep, 34 / sa.w, 0); this._fs();
    }

    // ===== 3. シーン（背景・要素・塵） =====
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    {
      const P = this.progs.bg; this._u(P);
      this._bindTex(0, down[0].tex); gl.uniform1i(P.u.uBloom, 0);
      gl.uniform2f(P.u.uBoard, W, H);
      gl.uniform1f(P.u.uTray, TRAY_Y);
      gl.uniform1f(P.u.uWinGlow, state.winGlow || 0);
      gl.uniform1f(P.u.uArt, this.art ? 1 : 0);
      {
        const ws = state.els.filter(e => e.type === 'well').slice(0, 6);
        const arr = new Float32Array(24);
        ws.forEach((w, i) => { arr[i * 4] = w.x; arr[i * 4 + 1] = w.y; arr[i * 4 + 2] = w.k; arr[i * 4 + 3] = w.r; });
        gl.uniform4fv(gl.getUniformLocation(P.p, 'uWells'), arr);
        gl.uniform1i(P.u.uNW, ws.length);
      }
      this._fs();
    }
    // 要素
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    {
      const els = state.els; const ed = this.elemData;
      let ne = 0;
      const order = (e) => (e.type === 'wall' ? 0 : e.type === 'target' ? 1 : e.type === 'laser' ? 2 : e.type === 'filter' ? 3 : 4);
      const sorted = els.slice().sort((a, b) => order(a) - order(b));
      for (const e of sorted) {
        if (ne >= this.maxElems) break;
        const o = ne++ * 16;
        const t = TYPE_ID[e.type];
        ed[o] = e.x; ed[o + 1] = e.y; ed[o + 2] = e.a; ed[o + 3] = t;
        let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
        let cr = 0.7, cg = 0.8, cb = 1, cw = 0;
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        switch (e.type) {
          case 'mirror': case 'splitter': p0 = e.len; break;
          case 'filter': {
            p0 = e.len; const c = nmRGB((e.lo + e.hi) / 2); const m = Math.max(c[0], c[1], c[2], 1e-3);
            cr = c[0] / m; cg = c[1] / m; cb = c[2] / m; break;
          }
          case 'prism': p0 = e.r; break;
          case 'slab': case 'wall': p0 = e.w; p1 = e.h; break;
          case 'ball': p0 = e.r; break;
          case 'well': p0 = e.r; p1 = e.k; break;
          case 'laser': {
            p0 = e.r;
            const c = this.laserColor(e); cr = c[0]; cg = c[1]; cb = c[2]; break;
          }
          case 'target': {
            p0 = e.r; p1 = e.lo; p2 = e.hi;
            const c = nmRGB((e.lo + e.hi) / 2); const m = Math.max(c[0], c[1], c[2], 1e-3);
            const full = (e.hi - e.lo) > 250;
            cr = full ? 1 : c[0] / m; cg = full ? 0.95 : c[1] / m; cb = full ? 0.9 : c[2] / m;
            const st = state.charge && state.charge.get(e.id);
            cw = st ? st.fill : 0; s0 = st ? st.bad : 0; s3 = st ? st.charge : 0;
            break;
          }
        }
        s1 = (state.hover === e.id || state.sel === e.id) ? 1 : 0;
        s2 = (!e.mv && !e.rt) ? 1 : 0;
        ed[o + 4] = p0; ed[o + 5] = p1; ed[o + 6] = p2; ed[o + 7] = p3;
        ed[o + 8] = cr; ed[o + 9] = cg; ed[o + 10] = cb; ed[o + 11] = cw;
        ed[o + 12] = s0; ed[o + 13] = s1; ed[o + 14] = s2; ed[o + 15] = s3;
      }
      const P = this.progs.elem; this._u(P);
      gl.uniform3f(P.u.uNorm, this.norm[0], this.norm[1], this.norm[2]);
      gl.bindVertexArray(this.vaoElem);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.elemBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, ed, 0, ne * 16);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, ne);
    }
    // 塵
    {
      const m = this.motes, v = this.moteVel;
      for (let i = 0; i < this.nMotes; i++) {
        m[i * 4] += v[i * 2] * dt; m[i * 4 + 1] += v[i * 2 + 1] * dt;
        if (m[i * 4] < 0) m[i * 4] += W; if (m[i * 4] > W) m[i * 4] -= W;
        if (m[i * 4 + 1] < 0) m[i * 4 + 1] += H; if (m[i * 4 + 1] > H) m[i * 4 + 1] -= H;
      }
      gl.blendFunc(gl.ONE, gl.ONE);
      const P = this.progs.mote; this._u(P);
      this._bindTex(0, T.emit.tex); gl.uniform1i(P.u.uEmit, 0);
      this._bindTex(1, down[0].tex); gl.uniform1i(P.u.uBloom, 1);
      gl.bindVertexArray(this.vaoMote);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.moteBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, m);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nMotes);
    }
    gl.disable(gl.BLEND);

    // ===== 4. 合成 =====
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    {
      const P = this.progs.compose; this._u(P);
      this._bindTex(0, T.scene.tex); gl.uniform1i(P.u.uScene, 0);
      this._bindTex(1, T.emit.tex); gl.uniform1i(P.u.uEmit, 1);
      this._bindTex(2, down[0].tex); gl.uniform1i(P.u.uBloom, 2);
      this._bindTex(3, T.streakA.tex); gl.uniform1i(P.u.uStreak, 3);
      gl.uniform1f(P.u.uBloomK, this.glow * 0.34);
      gl.uniform1f(P.u.uStreakK, this.glow * 0.10);
      gl.uniform1f(P.u.uExposure, this.exposure);
      gl.uniform1f(P.u.uFlash, this.flash);
      gl.uniform4f(P.u.uShock, this.shock[0], this.shock[1], this.shock[2], this.shock[3]);
      gl.uniform1f(P.u.uCA, 1.0);
      this._fs();
    }
  }

  laserColor(e) {
    const spec = e.spec;
    let r = 0, g = 0, b = 0, n = 0;
    if (spec === 'white' || spec == null) return [1, 1, 1];
    const lo = typeof spec === 'number' ? spec - 12 : spec[0];
    const hi = typeof spec === 'number' ? spec + 12 : spec[1];
    for (let i = 0; i < NB; i++) if (LAM[i] >= lo && LAM[i] <= hi) { r += BIN_RGB[i][0]; g += BIN_RGB[i][1]; b += BIN_RGB[i][2]; n++; }
    if (!n) return [1, 1, 1];
    const m = Math.max(r, g, b);
    return [r / m, g / m, b / m];
  }
}
