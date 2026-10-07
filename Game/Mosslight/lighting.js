// 苔灯の境 / MOSSLIGHT — WebGL2 照明合成
// renderer.js が描いた native 解像度の color / normal / height と、タイル遮蔽テクスチャを受け取り、
// 1枚のquadの fragment shader で太陽・月・半球の空・局所光・投影影を合成して GL canvas を返す。依存なし(静的ES module)。
// 注意: 画面だけの 2.5D 近似。高さ・光源の高さは画像から推定した値で、完全な3D形状ではない。
// 色はsRGB→linearにして照明し、最後にsRGBへ戻す。
//
// 光の式(sky.js と同じ): out = albedo·gain·(sky·(0.7+0.3·Nz) + sun·max(0,N·Ls)·S_sun + moon·max(0,N·Lm)·S_moon + local) + spec + albedo·emis·1.5
//   sun/moon の向きは毎フレーム u.sunDir/u.moonDir で受け取る(固定の太陽は旧 render() 呼び出しで u.sunDir が無い時だけ)。
//   影: u.shadow があれば、物の height を足元の行で傾けて描いた「影バッファ」から求める(S = 1 − strength·smoothstep(th, 2.7th, Hc − hr))。
//       無い時(旧呼び出し)は従来どおり太陽方向の height ray。局所光は u.ptShadow の最大 MAX_PT 灯が足元中心の影アトラス(光源から遠ざかる向きへ傾けた遮る物の高さ)を持ち、他は height ray と壁遮蔽。

const MAX_LIGHTS = 8;
export const MAX_PT = 3;      // 影を持てる局所光の数(アトラスのセル数)
export const PT_HALF = 128;   // 灯の足元を中心とする影の窓の半径(native px)。これより外では影を薄めて消す
const TILE = 32;
// 旧呼び出し(u.sunDir なし)の既定の太陽方向(x右+, y画面上+, z手前+)
const LEGACY_SUN = (() => { const v = [-0.5, 0.5, 0.7], l = Math.hypot(...v); return v.map((c) => c / l); })();
export const LIGHT_GAIN = 2.8; // 局所光の強さ。23:00 に焚き火から1タイルの地面が ≥110、4タイルで ≥30(sRGB)になる値(sky.js の板 ≈ 6 に対して)
const DEBUG = { off: 0, normal: 1, height: 2, shadow: 3, light: 4, sun: 5, sky: 6, albedo: 7, irradiance: 8 };

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
#define PT_HALF ${PT_HALF}.0
precision highp int;
precision highp sampler2D;
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform sampler2D uHeight;
uniform sampler2D uOcc;     // R=固体(壁・閉扉) G=屋内(タイル単位)
uniform sampler2D uShadow;  // 太陽/月の影バッファ(R=遮る物の高さ/64。足元の行で傾けて描いたもの)
uniform sampler2D uShadow2; // 局所光の影アトラス(灯ごとに PT_CELL 四方のセルを横に並べる。R=遮る物の高さ/64)
uniform vec2 uRes;
uniform vec2 uCam;
uniform ivec4 uOccRect;     // 遮蔽テクスチャの左上タイルと幅・高さ
uniform vec3 uSunDir;
uniform vec3 uSunColor;     // linear の放射輝度(法線入射)
uniform float uSun;         // 0..1 太陽が出ている強さ。夜は厳密に 0
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uSky;          // 半球の環境光(linear)
uniform int uSteps;
uniform int uLightCount;
uniform int uDebug;
uniform float uLightScale;  // 局所光の倍率(昼は小さく、夜は1)
uniform float uGain;        // 1=旧資産の gain(焼き込み光の補正)を使う / 0=常に1.0。移行期間だけの切替
uniform int uShadowOn;      // 0=太陽の height ray(旧) / 1=影バッファ
uniform vec2 uShadowVec;    // 高さ1pxあたりの影の画面上の変位
uniform float uShadowStr;
uniform float uShadowTh;    // 影の閾値(高さpx)。影バッファが半解像度なら大きくする
uniform int uShadowKind;    // 0=太陽の影 1=月の影
uniform vec4 uPtS[${MAX_PT}];   // 影を持つ灯(スロット別): 足元の x,y(native px) / 光源の実高さpx / 強さ
uniform int uPtSlot[${MAX_LIGHTS}];  // 灯の番号 -> スロット(影なしは -1)
uniform vec4 uPtAtlas;      // アトラスの幅・高さ(texel) / セルの texel 数 / native px あたりの texel 数
uniform float uPtTh;        // 局所光の影の閾値(高さpx)
uniform vec4 uLightPos[${MAX_LIGHTS}];  // native px の x,y / 半径px / 光源の高さpx(physical なら x,y は足元の地面位置)
uniform float uLightPhys[${MAX_LIGHTS}]; // 1=physical(src 付き: 足元+実高さ) / 0=旧式(画面上の中心+14+0.12r の高さ)
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
// gs/lp.xy は同じ平面の位置。physical の灯では地面座標(受ける面は g、光源は足元)で、rayの高さ分だけ画面上へ戻した位置の height を読む(screen y = 地面y − 高さ)。
// 旧式の灯(physical=false)は pp→lp.xy の画面上の直線をそのまま読む
float lightRay(vec2 gs, vec4 lp, float hPx, bool phys, ivec2 res) {
  vec2 d = lp.xy - gs;
  float dist = length(d), n = float(uSteps), occl = 0.0;
  for (int k = 1; k <= 8; k++) {
    if (k > uSteps) break;
    float t = float(k) / (n + 1.0);
    if (dist * t < 3.0 || dist * (1.0 - t) < 4.0) continue;
    float rayH0 = hPx + (lp.w - hPx) * t;
    ivec2 q = ivec2(floor(gs + d * t - vec2(0.0, phys ? rayH0 : 0.0)));
    if (q.x < 0 || q.y < 0 || q.x >= res.x || q.y >= res.y) continue;
    float rayH = hPx + (lp.w - hPx) * t;
    occl = max(occl, smoothstep(2.0, 5.0, texelFetch(uHeight, q, 0).r * 64.0 - rayH));
  }
  return 1.0 - 0.85 * occl;
}

// 影バッファの参照。受ける面の地面位置 g = p + (0,hr) から、高さ hr の面で見た影の位置へ v·hr だけずらして読む。
// 遮る物の高さ Hc が受ける面の高さ hr より十分高い時だけ影(自分の幹・樹冠は自分の影で暗くならない)
float casterAt(sampler2D tex, vec2 g, vec2 v, float hr) {
  vec2 q = g + v * hr;
  if (q.x < 0.0 || q.y < 0.0 || q.x >= uRes.x || q.y >= uRes.y) return 0.0;
  float hc = texture(tex, (q + 0.5) / uRes).r * 64.0;
  return smoothstep(uShadowTh, uShadowTh * 2.7, hc - hr);
}

// 局所光の影アトラス。光源の足元を中心とする ±PT_HALF px の窓だけを持つ。受ける面 g から高さ hr の面で見た位置へ vg·hr ずらして読み、
// 窓の縁では影を薄めて切れ目を作らない。vg = 光源の足元から g への向き / 光源の高さ(足元から離れるほど影が長く伸びる)
float ptCaster(int slot, vec2 g, vec2 vg, float hr) {
  vec4 P = uPtS[slot];
  vec2 loc = g + vg * hr - (P.xy - vec2(PT_HALF));
  float edge = 1.0 - smoothstep(PT_HALF * 0.75, PT_HALF, length(loc - vec2(PT_HALF)));
  if (edge <= 0.0 || loc.x < 0.0 || loc.y < 0.0 || loc.x >= 2.0 * PT_HALF || loc.y >= 2.0 * PT_HALF) return 0.0;
  vec2 tp = loc * uPtAtlas.w + vec2(float(slot) * uPtAtlas.z, 0.0);
  float hc = texture(uShadow2, tp / uPtAtlas.xy).r * 64.0;
  return edge * smoothstep(uPtTh, uPtTh * 2.7, hc - hr);
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
  float gain = mix(1.0, clamp(h4.b * 255.0 / 128.0, 0.8, 1.25), uGain);

  vec2 pp = vec2(ip) + 0.5;
  vec2 wp = pp + uCam;
  vec2 g = pp + vec2(0.0, hPx);
  float indoor = occAt(ivec2(floor(wp / TILE))).g;

  // 太陽・月: N·L の向きは毎フレームの sunDir/moonDir。影は影バッファ(新)か height ray(旧)
  float sunOn = uSun * (1.0 - indoor);
  float moonOn = 1.0 - indoor;
  float Ssun = 1.0, Smoon = 1.0, S = 1.0;
  if (uShadowOn == 1) {
    S = 1.0 - uShadowStr * casterAt(uShadow, g, uShadowVec, hPx);
    if (uShadowKind == 0) Ssun = S; else Smoon = S;
  } else if (sunOn > 0.0) {
    vec2 sd = normalize(vec2(uSunDir.x, -uSunDir.y));
    float slope = uSunDir.z / max(0.05, length(uSunDir.xy));
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
    S = 1.0 - 0.85 * occl;
    Ssun = S;
  }
  vec3 sunTerm = uSunColor * sunOn * max(0.0, dot(N, uSunDir)) * Ssun;
  vec3 moonTerm = uMoonColor * moonOn * max(0.0, dot(N, uMoonDir)) * Smoon;
  vec3 skyTerm = uSky * (0.7 + 0.3 * N.z) * mix(1.0, 0.6, indoor);
  float rough = h4.g;
  vec3 spec = uSunColor * sunOn * Ssun * specTerm(N, uSunDir, rough) * step(0.0, dot(N, uSunDir));
  spec += uMoonColor * moonOn * Smoon * specTerm(N, uMoonDir, rough) * 0.5 * step(0.0, dot(N, uMoonDir));

  // 局所光: 距離減衰 × 法線との向き × タイル遮蔽 × height ray影 (× 影を持つ1灯は影バッファ)
  vec3 loc = vec3(0.0), specLoc = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec4 lp = uLightPos[i];
    // physical=1: lp.xy は光源の足元(地面)、lp.w は足元からの実高さ。受ける面は地面位置 g、距離減衰は地面上の水平距離。
    // physical=0(旧式): lp.xy は画面上の光の中心、受ける面は画面画素 pp
    bool phys = uLightPhys[i] > 0.5;
    vec2 gs = phys ? g : pp;
    vec2 d = lp.xy - gs;
    float dist = length(d);
    if (dist >= lp.z) continue;
    float att = 1.0 - dist / lp.z;
    att *= att;
    vec3 L0 = vec3(d.x, -d.y, lp.w - hPx);
    vec3 Lv = L0 / max(length(L0), 1e-3);
    float nd = max(0.0, dot(N, Lv));
    if (nd <= 0.0) continue;
    float vis = lightVis(gs + uCam, lp.xy + uCam);
    if (vis <= 0.0) continue;
    int slot = uPtSlot[i];
    // 地面の物理光は投影影を使う。疎なheight rayを重ねると、細い支柱の影が
    // サンプル間隔ごとの離れた四角へ複製される。高い受光面と未投影の灯はrayを保つ。
    if (slot < 0 || !phys || hPx > 8.0) vis *= lightRay(gs, lp, hPx, phys, res);
    if (slot >= 0) {
      vec4 P = uPtS[slot];
      vec2 vg = (g - P.xy) / max(P.z, 1.0);
      float vl = length(vg);
      if (vl > 1.6) vg *= 1.6 / vl;
      vis *= 1.0 - P.w * ptCaster(slot, g, vg, hPx);
    }
    loc += uLightCol[i] * att * nd * vis;
    specLoc += uLightCol[i] * att * vis * specTerm(N, Lv, rough);
  }
  loc *= uLightScale;
  spec = min(spec + specLoc * uLightScale, vec3(0.4));

  vec3 albedo = toLin(c.rgb);
  vec3 lit = albedo * gain * (skyTerm + sunTerm + moonTerm + loc) + spec + albedo * emis * 1.5;
  vec3 outc = toSrgb(lit);
  if (uDebug == 1) outc = vec3(nxy * 0.5 + 0.5, N.z);
  else if (uDebug == 2) outc = vec3(hPx / 64.0, h4.g, gain - 0.8);
  else if (uDebug == 3) outc = vec3(S);
  else if (uDebug == 4) outc = toSrgb(loc);
  else if (uDebug == 5) outc = toSrgb(sunTerm);
  else if (uDebug == 6) outc = toSrgb(skyTerm + moonTerm);
  else if (uDebug == 7) outc = c.rgb;
  else if (uDebug == 8) outc = toSrgb(skyTerm + sunTerm + moonTerm + loc);
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
    glErrors: 0, errorCount: 0, lastError: 0, contextLost: false, sunStrength: 0, moonStrength: 0,
    heightShadow: false, roughness: false, // shader が実際にコンパイル・リンクできた時だけ true
    projectedShadow: false, sunDir: [0, 0, 0], shadowKind: 'none', shadowW: 0, shadowH: 0, shadowBytes: 0, ptShadow: false, ptShadows: 0,
  };
  let prog = null, loc = null, vao = null, texs = null, occTex = null, W = 0, H = 0;
  let shTex = [null, null], shSize = [[0, 0], [0, 0]], zeroTex = null;
  let lost = false, ready = false, frame = 0;
  const lightPhys = new Float32Array(MAX_LIGHTS);
  const lightPos = new Float32Array(MAX_LIGHTS * 4), lightCol = new Float32Array(MAX_LIGHTS * 3);
  const ptSlot = new Int32Array(MAX_LIGHTS), ptS = new Float32Array(MAX_PT * 4);

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

  function newTex(w, h, storage, filter = gl.NEAREST) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (storage) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function freeSizeResources() {
    if (texs) for (const t of texs) gl.deleteTexture(t);
    texs = null; W = 0; H = 0;
  }
  function freeShadowTex() {
    for (let i = 0; i < 2; i++) { if (shTex[i]) gl.deleteTexture(shTex[i]); shTex[i] = null; shSize[i] = [0, 0]; }
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
      for (const n of ['uColor', 'uNormal', 'uHeight', 'uOcc', 'uShadow', 'uShadow2', 'uRes', 'uCam', 'uOccRect', 'uSunDir', 'uSunColor', 'uSun',
        'uMoonDir', 'uMoonColor', 'uSky', 'uSteps', 'uLightCount', 'uDebug', 'uLightScale', 'uGain', 'uShadowOn', 'uShadowVec', 'uShadowStr',
        'uShadowTh', 'uShadowKind', 'uPtAtlas', 'uPtTh']) loc[n] = gl.getUniformLocation(prog, n);
      loc.uPtS = gl.getUniformLocation(prog, 'uPtS[0]');
      loc.uPtSlot = gl.getUniformLocation(prog, 'uPtSlot[0]');
      loc.uLightPos = gl.getUniformLocation(prog, 'uLightPos[0]');
      loc.uLightPhys = gl.getUniformLocation(prog, 'uLightPhys[0]');
      loc.uLightCol = gl.getUniformLocation(prog, 'uLightCol[0]');
      vao = gl.createVertexArray();
      occTex = newTex(1, 1, false);
      zeroTex = newTex(1, 1, false, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      shTex = [null, null]; shSize = [[0, 0], [0, 0]];
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      ready = true;
      stats.heightShadow = true; stats.roughness = true; stats.projectedShadow = true;
    } catch (err) {
      ready = false;
      stats.heightShadow = false; stats.roughness = false; stats.projectedShadow = false;
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

  // 影バッファ(canvas)を unit 4/5 へ。サイズが変わった時だけ作り直し、それ以外は texSubImage2D。使わない時は 1x1 の 0
  function uploadShadow(i, cv) {
    gl.activeTexture(gl.TEXTURE4 + i);
    if (!cv) { gl.bindTexture(gl.TEXTURE_2D, zeroTex); return 0; }
    const w = cv.width, h = cv.height;
    if (!shTex[i] || shSize[i][0] !== w || shSize[i][1] !== h) {
      if (shTex[i]) gl.deleteTexture(shTex[i]);
      shTex[i] = newTex(w, h, true, gl.LINEAR);
      shSize[i] = [w, h];
    }
    gl.bindTexture(gl.TEXTURE_2D, shTex[i]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    return w * h * 4;
  }

  // 寄与の大きい順に maxLights まで。画面外の灯は除く。値は native px と linear色へ変換する。
  // u.ptShadow.entries[j].light と同じ灯を packed 後の番号へ対応させ、ptSlot[番号] = j にする(切り捨てられた灯は影なし)。影を持つ灯の数を返す
  function packLights(lights, u, usePt) {
    const cand = [], tile = u.tile || TILE, gain = u.lightGain == null ? LIGHT_GAIN : u.lightGain;
    for (const L of lights || []) {
      if (!(L.power > 0)) continue;
      const fl = u.calm ? 1 : 1 + (Math.sin(u.t * 9 + L.id * 1.7) * 0.03 + Math.sin(u.t * 23 + L.id) * 0.02) * L.flicker;
      const r = L.r * tile * fl;
      // physical(src 付き): 足元の地面位置と実高さ。照らす範囲は足元を中心とする地面上の半径 r で、受ける面の高さ(最大 64px)だけ画面の上へ伸びる
      const s = L.src && isFinite(L.src.h) ? L.src : null;
      const x = (s ? s.x : L.x) - u.camX, y = (s ? s.y : L.y) - u.camY;
      if (r <= 0 || x + r < 0 || y + r < 0 || x - r > W || y - r - 64 > H) continue;
      const k = gain * L.power * (L.noGlow ? 0.7 : 1) * fl;
      const col = [lin(L.color[0]) * k, lin(L.color[1]) * k, lin(L.color[2]) * k];
      cand.push({ L, x, y, r, phys: !!s, z: s ? Math.max(1, s.h) : 14 + r * 0.12, col, score: (col[0] * 0.3 + col[1] * 0.6 + col[2] * 0.1) * r * r });
    }
    cand.sort((a, b) => b.score - a.score);
    const n = Math.min(maxLights, cand.length);
    ptSlot.fill(-1);
    const entries = usePt ? u.ptShadow.entries : null;
    let pts = 0;
    for (let i = 0; i < n; i++) {
      const c = cand[i];
      lightPos.set([c.x, c.y, c.r, c.z], i * 4);
      lightCol.set(c.col, i * 3);
      lightPhys[i] = c.phys ? 1 : 0;
      if (entries) {
        const j = entries.findIndex((e) => e.light === c.L);
        if (j >= 0 && j < MAX_PT) {
          ptSlot[i] = j; pts++;
          // physical の灯は拡散光と同じ足元・高さを影にも使う(entries の値とずれても1つの光源に揃う)
          if (c.phys) ptS.set([c.x, c.y, c.z, entries[j].strength], j * 4);
        }
      }
    }
    stats.lights = n; stats.culled = cand.length - n;
    return { n, pts };
  }

  // color/normal/height は同寸のcanvas。occ={x0,y0,w,h,data(RG8)}。成功時はGL canvas、使えない時はnull
  // u: {camX,camY,t,calm,steps,lights,debug,skyColor,sunColor,sunStrength, sunDir?,moonDir?,moonColor?,lightScale?,gain?,lightGain?,
  //   lights[i].src={x,y,h}(足元 world px と足元からの高さ)があれば physical: 拡散・遮蔽・height ray・影が同じ足元/実高さを使う。無ければ旧式(L.x,L.y の画面上の光、z=14+0.12r)
//     shadow?:{canvas,vec,strength,kind,th}, ptShadow?:{canvas,cell,th,entries:[{light,x,y,h,strength}]}}
  //   ptShadow: canvas は entries[j] のセルを x=j·cell に横並べしたアトラス(1セル=2·PT_HALF native px を cell texel で)。x,y は灯の足元(native px)、h は光源の実高さ
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
    const sh = u.shadow && u.shadow.canvas && u.shadow.strength > 0 ? u.shadow : null;
    const pt = u.ptShadow && u.ptShadow.canvas && u.ptShadow.entries && u.ptShadow.entries.length ? u.ptShadow : null;
    const bytes = uploadShadow(0, sh && sh.canvas) + uploadShadow(1, pt && pt.canvas);
    const t1 = performance.now();

    const steps = Math.max(1, Math.min(8, u.steps | 0 || defaultSteps));
    ptS.fill(0);
    if (pt) for (let j = 0; j < Math.min(MAX_PT, pt.entries.length); j++) { const e = pt.entries[j]; ptS.set([e.x, e.y, e.h, e.strength], j * 4); }
    const { n, pts } = packLights(u.lights, u, !!pt);
    stats.steps = steps; stats.sunStrength = u.sunStrength; stats.moonStrength = u.moonStrength || 0;
    const sunDir = u.sunDir || LEGACY_SUN;
    const moonDir = u.moonDir || [0, 0, 1], moonColor = u.moonColor || [0, 0, 0];
    stats.sunDir = [sunDir[0], sunDir[1], sunDir[2]];
    stats.shadowKind = sh ? sh.kind || 'sun' : 'none'; stats.shadowW = sh ? sh.canvas.width : 0; stats.shadowH = sh ? sh.canvas.height : 0;
    stats.shadowBytes = bytes; stats.ptShadow = pts > 0; stats.ptShadows = pts;
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform1i(loc.uColor, 0); gl.uniform1i(loc.uNormal, 1); gl.uniform1i(loc.uHeight, 2); gl.uniform1i(loc.uOcc, 3);
    gl.uniform1i(loc.uShadow, 4); gl.uniform1i(loc.uShadow2, 5);
    gl.uniform2f(loc.uRes, w, h);
    gl.uniform2f(loc.uCam, u.camX, u.camY);
    gl.uniform4i(loc.uOccRect, occ ? occ.x0 : 0, occ ? occ.y0 : 0, occ ? occ.w : 0, occ ? occ.h : 0);
    gl.uniform3f(loc.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
    gl.uniform3fv(loc.uSunColor, u.sunColor);
    gl.uniform1f(loc.uSun, u.sunStrength);
    gl.uniform3f(loc.uMoonDir, moonDir[0], moonDir[1], moonDir[2]);
    gl.uniform3fv(loc.uMoonColor, moonColor);
    gl.uniform3fv(loc.uSky, u.skyColor);
    gl.uniform1i(loc.uSteps, steps);
    gl.uniform1i(loc.uLightCount, n);
    gl.uniform1i(loc.uDebug, DEBUG[u.debug] || 0);
    gl.uniform1f(loc.uLightScale, u.lightScale == null ? 1 : u.lightScale);
    gl.uniform1f(loc.uGain, u.gain === false ? 0 : 1);
    gl.uniform1i(loc.uShadowOn, sh ? 1 : 0);
    gl.uniform2f(loc.uShadowVec, sh ? sh.vec[0] : 0, sh ? sh.vec[1] : 0);
    gl.uniform1f(loc.uShadowStr, sh ? sh.strength : 0);
    gl.uniform1f(loc.uShadowTh, sh && sh.th ? sh.th : 1.5);
    gl.uniform1i(loc.uShadowKind, sh && sh.kind === 'moon' ? 1 : 0);
    gl.uniform4fv(loc.uPtS, ptS);
    gl.uniform1iv(loc.uPtSlot, ptSlot);
    const cell = pt ? pt.cell : 1;
    gl.uniform4f(loc.uPtAtlas, pt ? pt.canvas.width : 1, pt ? pt.canvas.height : 1, cell, cell / (2 * PT_HALF));
    gl.uniform1f(loc.uPtTh, pt && pt.th ? pt.th : 1.5);
    gl.uniform4fv(loc.uLightPos, lightPos);
    gl.uniform1fv(loc.uLightPhys, lightPhys);
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
    texs = null; W = 0; H = 0; shTex = [null, null]; shSize = [[0, 0], [0, 0]];
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
      freeShadowTex();
      if (occTex) gl.deleteTexture(occTex);
      if (zeroTex) gl.deleteTexture(zeroTex);
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
