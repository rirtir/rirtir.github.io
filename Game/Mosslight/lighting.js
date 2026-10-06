// 苔灯の境 / MOSSLIGHT — WebGL2 照明合成
// renderer.js が描いた native 解像度の color / normal / height と、タイル遮蔽テクスチャを受け取り、
// 1枚のquadの fragment shader で太陽・局所光・影を合成して GL canvas を返す。依存なし(静的ES module)。
// 注意: 画面だけの 2.5D 近似。高さ・光源の高さは画像から推定した値で、完全な3D形状ではない。
// 色はsRGB→linearにして照明し、最後にsRGBへ戻す。

const MAX_LIGHTS = 8;
const TILE = 32;
// 固定の太陽方向(x右+, y画面上+, z手前+)。昼は常にこの向きで、全物体の影が同じ側へ落ちる
const SUN = (() => { const v = [-0.5, 0.5, 0.7], l = Math.hypot(...v); return v.map((c) => c / l); })();
const LIGHT_GAIN = 2.2; // 局所光の強さ(ランタン・焚き火が夜の sky 0.06 に対して読める程度)
const DEBUG = { off: 0, normal: 1, height: 2, shadow: 3, light: 4 };

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform sampler2D uHeight;
uniform sampler2D uOcc;     // R=固体(壁・閉扉) G=屋内(タイル単位)
uniform vec2 uRes;
uniform vec2 uCam;
uniform ivec4 uOccRect;     // 遮蔽テクスチャの左上タイルと幅・高さ
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSun;
uniform vec3 uSky;
uniform int uSteps;
uniform int uLightCount;
uniform int uDebug;
uniform vec4 uLightPos[${MAX_LIGHTS}];  // native px の x,y / 半径px / 光源の高さpx
uniform vec3 uLightCol[${MAX_LIGHTS}];  // linear色 × 強さ
out vec4 outColor;

const float TILE = ${TILE}.0;
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

vec2 occAt(ivec2 t) {
  t -= uOccRect.xy;
  if (t.x < 0 || t.y < 0 || t.x >= uOccRect.z || t.y >= uOccRect.w) return vec2(0.0);
  return texelFetch(uOcc, t, 0).rg;
}

// 光源とpixelの間のタイルを uSteps 回サンプルし、固体があれば遮る(壁越しに漏れない)。自身と光源のタイルは無視する
float lightVis(vec2 wp, vec2 wl) {
  ivec2 tp = ivec2(floor(wp / TILE)), tl = ivec2(floor(wl / TILE));
  float n = float(uSteps);
  for (int k = 1; k <= 8; k++) {
    if (k > uSteps) break;
    ivec2 tq = ivec2(floor(mix(wp, wl, float(k) / (n + 1.0)) / TILE));
    if (tq == tp || tq == tl) continue;
    if (occAt(tq).r > 0.5) return 0.0;
  }
  return 1.0;
}

// 局所光のheight ray影: pixel→光源へ線形上昇するrayより高い物があれば減光(最小0.15の間接を残す)。
// pixel/光源の近傍はself-acne回避で飛ばし、画面外sampleは無視する。壁の完全遮蔽は lightVis が担当
float lightRay(vec2 pp, vec4 lp, float hPx, ivec2 res) {
  vec2 d = lp.xy - pp;
  float dist = length(d), n = float(uSteps), occl = 0.0;
  for (int k = 1; k <= 8; k++) {
    if (k > uSteps) break;
    float t = float(k) / (n + 1.0);
    if (dist * t < 3.0 || dist * (1.0 - t) < 4.0) continue;
    ivec2 q = ivec2(floor(pp + d * t));
    if (q.x < 0 || q.y < 0 || q.x >= res.x || q.y >= res.y) continue;
    float rayH = hPx + (lp.w - hPx) * t;
    occl = max(occl, smoothstep(2.0, 5.0, texelFetch(uHeight, q, 0).r * 64.0 - rayH));
  }
  return 1.0 - 0.85 * occl;
}

// 控えめなBlinn-Phong。roughnessが低いほど鋭く強く、高い(草土木 .8)とほぼ0。cap で白飛びを防ぐ
float specTerm(vec3 N, vec3 L, float rough) {
  float gloss = 1.0 - clamp(rough, 0.0, 1.0);
  float g2 = gloss * gloss;
  float nh = max(0.0, dot(N, normalize(L + vec3(0.0, 0.0, 1.0))));
  return min(pow(nh, mix(8.0, 80.0, g2)) * g2 * gloss * 0.35, 0.3);
}

void main() {
  ivec2 res = ivec2(uRes);
  ivec2 ip = ivec2(int(gl_FragCoord.x), res.y - 1 - int(gl_FragCoord.y));
  vec4 c = texelFetch(uColor, ip, 0);
  vec4 n4 = texelFetch(uNormal, ip, 0);
  vec4 h4 = texelFetch(uHeight, ip, 0);

  vec2 nxy = (n4.rg * 255.0 - 128.0) / 127.0;
  float nl = length(nxy);
  if (nl > 1.0) nxy /= nl;
  vec3 N = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  float emis = n4.b;
  float hPx = h4.r * 64.0;
  float gain = clamp(h4.b * 255.0 / 128.0, 0.8, 1.25);

  vec2 pp = vec2(ip) + 0.5;
  vec2 wp = pp + uCam;
  float indoor = occAt(ivec2(floor(wp / TILE))).g;

  // 昼の太陽: height buffer を太陽側へ走査し、より高い物があれば影
  float shadow = 1.0;
  float sun = uSun * (1.0 - indoor);
  if (sun > 0.0) {
    vec2 sd = normalize(vec2(uSunDir.x, -uSunDir.y));
    float slope = uSunDir.z / length(uSunDir.xy);
    float stepScale = 8.0 / float(uSteps);
    float occl = 0.0;
    for (int i = 1; i <= 8; i++) {
      if (i > uSteps) break;
      float s = (float(i * i) * 0.9 + 1.0) * stepScale;
      ivec2 q = ip + ivec2(floor(sd * s + 0.5));
      if (q.x < 0 || q.y < 0 || q.x >= res.x || q.y >= res.y) continue;
      float hq = texelFetch(uHeight, q, 0).r * 64.0;
      occl = max(occl, smoothstep(0.5, 3.0, hq - (hPx + s * slope)));
    }
    shadow = 1.0 - 0.85 * occl;
  }
  vec3 sunTerm = uSunColor * sun * max(0.0, dot(N, uSunDir)) * shadow;
  vec3 sky = uSky * mix(1.0, 0.6, indoor);
  float rough = h4.g;
  vec3 spec = uSunColor * sun * shadow * specTerm(N, uSunDir, rough) * step(0.0, dot(N, uSunDir));

  // 局所光: 距離減衰 × 法線との向き × タイル遮蔽 × height ray影
  vec3 loc = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec4 lp = uLightPos[i];
    vec2 d = lp.xy - pp;
    float dist = length(d);
    if (dist >= lp.z) continue;
    float att = 1.0 - dist / lp.z;
    att *= att;
    vec3 Lv = normalize(vec3(d.x, -d.y, lp.w - hPx));
    float nd = max(0.0, dot(N, Lv));
    if (nd <= 0.0) continue;
    float vis = lightVis(wp, lp.xy + uCam);
    if (vis <= 0.0) continue;
    vis *= lightRay(pp, lp, hPx, res);
    loc += uLightCol[i] * att * nd * vis;
    spec += uLightCol[i] * att * vis * specTerm(N, Lv, rough);
  }

  vec3 albedo = toLin(c.rgb);
  vec3 lit = albedo * gain * (sky + sunTerm + loc) + min(spec, vec3(0.4)) + albedo * emis * 1.5;
  vec3 outc = toSrgb(lit);
  if (uDebug == 1) outc = vec3(nxy * 0.5 + 0.5, N.z);
  else if (uDebug == 2) outc = vec3(hPx / 64.0, h4.g, gain - 0.8);
  else if (uDebug == 3) outc = vec3(shadow);
  else if (uDebug == 4) outc = toSrgb(loc);
  outColor = vec4(outc, 1.0);
}`;

const lin = (v) => Math.pow(v / 255, 2.2);

export function createLighting(opts = {}) {
  const maxLights = Math.max(1, Math.min(MAX_LIGHTS, opts.maxLights | 0 || MAX_LIGHTS));
  const defaultSteps = Math.max(1, Math.min(8, opts.steps | 0 || 8));
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
  if (!gl) return null;

  const stats = {
    lights: 0, culled: 0, steps: defaultSteps, w: 0, h: 0, ms: { upload: 0, gl: 0 },
    glErrors: 0, errorCount: 0, lastError: 0, contextLost: false, sunStrength: 0,
    heightShadow: false, roughness: false, // shader が実際にコンパイル・リンクできた時だけ true
  };
  let prog = null, loc = null, vao = null, texs = null, occTex = null, W = 0, H = 0;
  let lost = false, ready = false, frame = 0;
  const lightPos = new Float32Array(MAX_LIGHTS * 4), lightCol = new Float32Array(MAX_LIGHTS * 3);

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`shader compile: ${log}`);
    }
    return s;
  }

  function newTex(w, h, storage) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (storage) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function freeSizeResources() {
    if (texs) for (const t of texs) gl.deleteTexture(t);
    texs = null; W = 0; H = 0;
  }

  function build() {
    try {
      const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
      prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`program link: ${gl.getProgramInfoLog(prog)}`);
      loc = {};
      for (const n of ['uColor', 'uNormal', 'uHeight', 'uOcc', 'uRes', 'uCam', 'uOccRect', 'uSunDir', 'uSunColor', 'uSun', 'uSky', 'uSteps', 'uLightCount', 'uDebug']) loc[n] = gl.getUniformLocation(prog, n);
      loc.uLightPos = gl.getUniformLocation(prog, 'uLightPos[0]');
      loc.uLightCol = gl.getUniformLocation(prog, 'uLightCol[0]');
      vao = gl.createVertexArray();
      occTex = newTex(1, 1, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      ready = true;
      stats.heightShadow = true; stats.roughness = true;
    } catch (err) {
      ready = false;
      stats.heightShadow = false; stats.roughness = false;
      console.warn('[Mosslight] WebGL2照明を初期化できません。2D照明で続行します。', err.message);
    }
    return ready;
  }

  function resize(w, h) {
    if (w === W && h === H) return;
    freeSizeResources();
    canvas.width = w; canvas.height = h;
    texs = [newTex(w, h, true), newTex(w, h, true), newTex(w, h, true)];
    W = w; H = h;
    stats.w = w; stats.h = h;
  }

  // 寄与の大きい順に maxLights まで。画面外の灯は除く。値は native px と linear色へ変換する
  function packLights(lights, u) {
    const cand = [], tile = u.tile || TILE;
    for (const L of lights || []) {
      if (!(L.power > 0)) continue;
      const fl = u.calm ? 1 : 1 + (Math.sin(u.t * 9 + L.id * 1.7) * 0.03 + Math.sin(u.t * 23 + L.id) * 0.02) * L.flicker;
      const r = L.r * tile * fl, x = L.x - u.camX, y = L.y - u.camY;
      if (r <= 0 || x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
      const k = LIGHT_GAIN * L.power * (L.noGlow ? 0.7 : 1) * fl;
      const col = [lin(L.color[0]) * k, lin(L.color[1]) * k, lin(L.color[2]) * k];
      cand.push({ x, y, r, z: 14 + r * 0.12, col, score: (col[0] * 0.3 + col[1] * 0.6 + col[2] * 0.1) * r * r });
    }
    cand.sort((a, b) => b.score - a.score);
    const n = Math.min(maxLights, cand.length);
    for (let i = 0; i < n; i++) {
      const c = cand[i];
      lightPos.set([c.x, c.y, c.r, c.z], i * 4);
      lightCol.set(c.col, i * 3);
    }
    stats.lights = n; stats.culled = cand.length - n;
    return n;
  }

  // color/normal/height は同寸のcanvas。occ={x0,y0,w,h,data(RG8)}。成功時はGL canvas、使えない時はnull
  function render(color, normal, height, occ, u) {
    if (lost || !ready || gl.isContextLost()) return null;
    const t0 = performance.now();
    const w = color.width, h = color.height;
    if (w !== W || h !== H) resize(w, h);
    const sources = [color, normal, height];
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, texs[i]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sources[i]);
    }
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, occTex);
    if (occ && occ.w > 0 && occ.h > 0) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, occ.w, occ.h, 0, gl.RG, gl.UNSIGNED_BYTE, occ.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 1, 1, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array(2));
    const t1 = performance.now();

    const steps = Math.max(1, Math.min(8, u.steps | 0 || defaultSteps));
    const n = packLights(u.lights, u);
    stats.steps = steps; stats.sunStrength = u.sunStrength;
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform1i(loc.uColor, 0); gl.uniform1i(loc.uNormal, 1); gl.uniform1i(loc.uHeight, 2); gl.uniform1i(loc.uOcc, 3);
    gl.uniform2f(loc.uRes, w, h);
    gl.uniform2f(loc.uCam, u.camX, u.camY);
    gl.uniform4i(loc.uOccRect, occ ? occ.x0 : 0, occ ? occ.y0 : 0, occ ? occ.w : 0, occ ? occ.h : 0);
    gl.uniform3f(loc.uSunDir, SUN[0], SUN[1], SUN[2]);
    gl.uniform3fv(loc.uSunColor, u.sunColor);
    gl.uniform1f(loc.uSun, u.sunStrength);
    gl.uniform3fv(loc.uSky, u.skyColor);
    gl.uniform1i(loc.uSteps, steps);
    gl.uniform1i(loc.uLightCount, n);
    gl.uniform1i(loc.uDebug, DEBUG[u.debug] || 0);
    gl.uniform4fv(loc.uLightPos, lightPos);
    gl.uniform3fv(loc.uLightCol, lightCol);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const t2 = performance.now();

    // getError は同期を伴うので通常は60frameごと。debug表示中は毎frame
    frame++;
    if ((u.debug && u.debug !== 'off') || frame % 60 === 0) {
      let e, guard = 0;
      while ((e = gl.getError()) !== gl.NO_ERROR && guard++ < 8) {
        if (e === gl.CONTEXT_LOST_WEBGL) break;
        stats.errorCount++; stats.lastError = e;
      }
      stats.glErrors = stats.errorCount;
    }
    stats.ms.upload = t1 - t0; stats.ms.gl = t2 - t1;
    return canvas;
  }

  function onLost(ev) {
    ev.preventDefault();
    lost = true; ready = false; stats.contextLost = true;
  }
  function onRestored() {
    // リソースは失われているので作り直す。サイズ依存のテクスチャは次の render で再生成する
    texs = null; W = 0; H = 0;
    lost = false; stats.contextLost = false;
    build();
  }
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  function dispose() {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    if (!gl.isContextLost()) {
      freeSizeResources();
      if (occTex) gl.deleteTexture(occTex);
      if (prog) gl.deleteProgram(prog);
      if (vao) gl.deleteVertexArray(vao);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    ready = false;
  }

  if (!build()) { dispose(); return null; }
  return { render, resize, dispose, stats, isLost: () => lost || !ready, canvas };
}
