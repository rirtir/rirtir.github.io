// ポストプロセス用の GLSL（合成・ボリューメトリック・ブルーム・トーンマップなど）

export const COMMON = /* glsl */ `
#define PI 3.14159265359
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0;
}
`;

// ---------------- ボリューメトリックライト ----------------
export const VOLUME_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tDepth;
uniform sampler2D tSunDepth;
uniform mat4 invViewProj;
uniform mat4 lightViewProj;
uniform vec3 camPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAbsorb;
uniform float uWaterY;
uniform float uTime;
uniform float uMaxDist;
uniform float uDensityAir;
uniform float uDensityWater;
uniform float uMieG;
uniform float uFrame;

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

void main() {
  float depth = texture2D(tDepth, vUv).r;
  vec4 wp = invViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 P = wp.xyz / wp.w;
  vec3 rd = P - camPos;
  float dist = min(length(rd), uMaxDist);
  rd = normalize(rd);

  float jitter = fract(bayer4(gl_FragCoord.xy) + uFrame * 0.61803398875);
  const int N = STEPS;
  float ds = dist / float(N);
  vec3 acc = vec3(0.0);
  vec3 Tv = vec3(1.0);
  float cosT = dot(uSunDir, -rd);
  float phaseAir = mix(hg(cosT, uMieG), 0.25 / PI, 0.5);
  float phaseWater = mix(hg(cosT, 0.72), 0.25 / PI, 0.3);

  for (int i = 0; i < N; i++) {
    float t = (float(i) + jitter) * ds;
    vec3 x = camPos + rd * t;
    vec4 lp = lightViewProj * vec4(x, 1.0);
    vec3 ndc = lp.xyz / lp.w;
    vec2 suv = ndc.xy * 0.5 + 0.5;
    float lit = 1.0;
    if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
      float stored = texture2D(tSunDepth, suv).r;
      lit = step(ndc.z * 0.5 + 0.5 - 0.0004, stored);
    }
    bool wet = x.y < uWaterY;
    vec3 sunT = vec3(1.0);
    float dens;
    float ph;
    if (wet) {
      float dep = uWaterY - x.y;
      float s = dep / max(0.25, -uSunDir.y);
      sunT = exp(-uAbsorb * s);
      dens = uDensityWater * (0.75 + 0.5 * vnoise3(x * 0.35 + vec3(0.0, uTime * 0.05, 0.0)));
      ph = phaseWater;
      Tv *= exp(-uAbsorb * ds);
    } else {
      // 空気中：水面付近と天窓付近に霧が溜まる
      float n = vnoise3(x * 0.16 + vec3(uTime * 0.02, uTime * 0.03, 0.0));
      float h = exp(-max(0.0, x.y - uWaterY) * 0.06);
      dens = uDensityAir * (0.3 + 1.0 * n) * (0.45 + 0.9 * h) * (1.0 + 1.6 * exp(-max(0.0, x.y - uWaterY) * 0.55));
      ph = phaseAir;
    }
    acc += Tv * uSunColor * sunT * (lit * ph * dens * ds);
  }
  gl_FragColor = vec4(acc, 1.0);
}
`;

// ---------------- 合成（水面・水中の減衰・霧・ボリューム） ----------------
export const COMPOSE_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tRefl;
uniform sampler2D tVol;
uniform samplerCube tAbove;   // 水中から見上げたときの「水上の世界」
uniform mat4 invViewProj;
uniform mat4 viewProj;
uniform mat4 reflViewProj;
uniform vec3 camPos;
uniform float uWaterY;
uniform float uTime;
uniform vec3 uAbsorb;
uniform vec3 uWaterAmbient;
uniform vec3 uAirAmbient;
uniform float uAirDensity;
uniform vec3 uSunDir;
uniform vec4 uRipples[8];    // x, z, 開始時刻, 強さ
uniform float uHasAbove;

vec3 worldFromDepth(vec2 uv, float depth) {
  vec4 p = invViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

// 水面の法線（穏やかなうねり＋波紋）
vec3 waveNormal(vec2 p, float t, float dist) {
  vec2 g = vec2(0.0);
  const int NW = 6;
  vec2 dirs[6] = vec2[6](vec2(1.0, 0.2), vec2(-0.6, 0.8), vec2(0.3, -0.95), vec2(-0.9, -0.3), vec2(0.7, 0.7), vec2(-0.2, 0.98));
  float ks[6] = float[6](1.7, 2.9, 4.6, 7.3, 11.0, 17.0);
  float as[6] = float[6](0.030, 0.020, 0.012, 0.0075, 0.0045, 0.0028);
  float ws[6] = float[6](0.9, 1.15, 1.4, 1.7, 2.1, 2.6);
  for (int i = 0; i < NW; i++) {
    vec2 d = normalize(dirs[i]);
    float k = ks[i];
    float ph = dot(d, p) * k + t * ws[i] + float(i) * 1.7;
    g += d * (as[i] * k * cos(ph));
  }
  // 遠方は細かい波を減衰（ちらつき防止）
  float far = smoothstep(30.0, 90.0, dist);
  g *= mix(1.0, 0.35, far);
  // 波紋
  for (int i = 0; i < 8; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    float age = t - r.z;
    if (age < 0.0 || age > 7.0) continue;
    vec2 dp = p - r.xy;
    float rad = length(dp);
    float front = age * 0.55;
    float x = rad - front;
    float env = exp(-x * x * 14.0) * exp(-age * 0.55) * r.w;
    float ring = sin(x * 26.0);
    vec2 dir = dp / max(rad, 1e-3);
    g += dir * (ring * env * 0.35 / (1.0 + rad * 0.8));
  }
  return normalize(vec3(-g.x, 1.0, -g.y));
}

float fresnel(float cosT, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(cosT, 0.0, 1.0), 5.0);
}

// C→P の区間に空気・水の減衰を適用
vec3 applyMedium(vec3 col, vec3 C, vec3 P) {
  float cy = C.y - uWaterY, py = P.y - uWaterY;
  float L = length(P - C);
  float lw = 0.0;
  if (cy < 0.0 && py < 0.0) lw = L;
  else if (cy >= 0.0 && py >= 0.0) lw = 0.0;
  else {
    float t = cy / (cy - py);
    lw = (cy < 0.0) ? L * t : L * (1.0 - t);
  }
  float la = L - lw;
  // 空気（うっすら霧）
  float Ta = exp(-uAirDensity * la);
  col = col * Ta + uAirAmbient * (1.0 - Ta);
  // 水
  if (lw > 0.0) {
    vec3 T = exp(-uAbsorb * lw);
    float ymid = min(0.0, 0.5 * (min(C.y, uWaterY) + min(P.y, uWaterY)) - uWaterY);
    float light = exp(0.055 * ymid);
    col = col * T + uWaterAmbient * light * (vec3(1.0) - T);
  }
  return col;
}

vec3 reflSample(vec3 W, vec3 N) {
  vec4 rp = reflViewProj * vec4(W, 1.0);
  vec2 uv = rp.xy / rp.w * 0.5 + 0.5;
  uv += N.xz * 0.06;
  uv = clamp(uv, 0.002, 0.998);
  return texture2D(tRefl, uv).rgb;
}

void main() {
  float depth = texture2D(tDepth, vUv).r;
  vec3 P = worldFromDepth(vUv, depth);
  vec3 C = camPos;
  vec3 rd = normalize(P - C);
  float tS = length(P - C);
  vec3 sceneCol = texture2D(tColor, vUv).rgb;

  vec3 col;
  float outT = tS;
  float tW = (uWaterY - C.y) / rd.y;
  bool hitsWater = (tW > 0.0) && (tW < tS - 0.002) && abs(rd.y) > 1e-5;

  if (!hitsWater) {
    col = applyMedium(sceneCol, C, P);
  } else {
    vec3 W = C + rd * tW;
    outT = tW;
    vec3 N = waveNormal(W.xz, uTime, tW);
    if (C.y > uWaterY) {
      // ---- 水上から水面を見る ----
      float cosI = clamp(dot(N, -rd), 0.0, 1.0);
      float F = fresnel(cosI, 0.02);
      // 屈折：屈折した光線が水中で奥へ進む先を画面へ投影
      vec3 rr = refract(rd, N, 1.0 / 1.333);
      float under = max(tS - tW, 0.0);
      vec3 Q = W + rr * under;
      vec4 qp = viewProj * vec4(Q, 1.0);
      vec2 uvR = qp.xy / qp.w * 0.5 + 0.5;
      float dR = texture2D(tDepth, uvR).r;
      vec3 PR = worldFromDepth(uvR, dR);
      bool ok = uvR.x > 0.001 && uvR.x < 0.999 && uvR.y > 0.001 && uvR.y < 0.999 && length(PR - C) > tW + 0.02;
      vec3 refrCol;
      if (ok) {
        refrCol = applyMedium(texture2D(tColor, uvR).rgb, W, PR);
        refrCol = applyMedium(refrCol, C, W);
      } else {
        refrCol = applyMedium(applyMedium(sceneCol, W, P), C, W);
      }
      vec3 reflCol = reflSample(W, N);
      reflCol = applyMedium(reflCol, C, W);
      col = mix(refrCol, reflCol, F);
    } else {
      // ---- 水中から水面を見上げる（スネルの窓＋全反射） ----
      vec3 Nd = -N;
      float eta = 1.333;
      vec3 rr = refract(rd, Nd, eta);
      float cosI = clamp(dot(Nd, -rd), 0.0, 1.0);
      bool tir = dot(rr, rr) < 1e-6;
      float F = tir ? 1.0 : fresnel(cosI, 0.02);
      // 水面越しの空気側の世界
      vec3 aboveCol = vec3(0.0);
      if (!tir && uHasAbove > 0.5) {
        vec3 o = normalize(rr);
        aboveCol = textureCube(tAbove, o).rgb;
      }
      vec3 reflCol = reflSample(W, N);
      vec3 s = mix(aboveCol, reflCol, F);
      col = applyMedium(s, C, W);
    }
  }

  col += texture2D(tVol, vUv).rgb;
  gl_FragColor = vec4(col, outT);
}
`;

// ---------------- 輝度（対数）縮小 ----------------
export const LOGLUM_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tColor;
void main() {
  // 画面中央を重視して 6x6 サンプル
  vec3 s = vec3(0.0);
  float ws = 0.0;
  for (int y = 0; y < 6; y++) for (int x = 0; x < 6; x++) {
    vec2 o = (vec2(float(x), float(y)) + 0.5) / 6.0;
    vec2 uv = (vUv + (o - 0.5) / 64.0 * vec2(1.0, 1.0));
    vec3 c = texture2D(tColor, uv).rgb;
    float l = log(max(luma(min(c, vec3(60.0))), 1e-4));
    s += vec3(l);
    ws += 1.0;
  }
  float lg = s.x / ws;
  // 中央重み
  vec2 d = vUv - 0.5;
  float w = exp(-dot(d, d) * 7.0);
  gl_FragColor = vec4(lg * w, w, 0.0, 1.0);
}
`;

export const ADAPT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tLum;    // ミップ最下段に平均が入る
uniform sampler2D tPrev;
uniform float dt;
uniform float uKey;
uniform float uMinExp;
uniform float uMaxExp;
uniform float uSpeedUp;
uniform float uSpeedDown;
uniform float uInit;
void main() {
  vec4 a = textureLod(tLum, vec2(0.5), 20.0);
  float avgLog = a.x / max(a.y, 1e-4);
  float target = clamp(uKey / exp(avgLog), uMinExp, uMaxExp);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (uInit > 0.5) prev = target;
  // 暗くなる（露出↑）は遅く、明るくなる（露出↓）は速く
  float sp = target < prev ? uSpeedDown : uSpeedUp;
  float e = prev + (target - prev) * (1.0 - exp(-dt * sp));
  gl_FragColor = vec4(e, 0.0, 0.0, 1.0);
}
`;

// ---------------- ブルーム ----------------
export const BLOOM_DOWN_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tColor;
uniform vec2 texel;   // 入力の1テクセル
uniform float uFirst;
vec3 karis(vec3 c) { return c / (1.0 + luma(c) * 0.25); }
void main() {
  vec2 t = texel;
  vec3 a = texture2D(tColor, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(tColor, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(tColor, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(tColor, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(tColor, vUv).rgb;
  vec3 f = texture2D(tColor, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(tColor, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tColor, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(tColor, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(tColor, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(tColor, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(tColor, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tColor, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 r;
  if (uFirst > 0.5) {
    vec3 g0 = karis((a + b + d + e) * 0.25);
    vec3 g1 = karis((b + c + e + f) * 0.25);
    vec3 g2 = karis((d + e + g + h) * 0.25);
    vec3 g3 = karis((e + f + h + i) * 0.25);
    vec3 g4 = karis((j + k + l + m) * 0.25);
    r = g0 * 0.125 + g1 * 0.125 + g2 * 0.125 + g3 * 0.125 + g4 * 0.5;
  } else {
    r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(r, 1.0);
}
`;

export const BLOOM_UP_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tLow;    // 一段小さい（アップサンプル元）
uniform sampler2D tHigh;   // 同じ解像度のダウンサンプル結果
uniform vec2 texel;        // tLow の1テクセル
uniform float uMix;
void main() {
  vec2 t = texel;
  vec3 s = texture2D(tLow, vUv).rgb * 4.0;
  s += texture2D(tLow, vUv + t * vec2(-1.0, 0.0)).rgb * 2.0;
  s += texture2D(tLow, vUv + t * vec2(1.0, 0.0)).rgb * 2.0;
  s += texture2D(tLow, vUv + t * vec2(0.0, -1.0)).rgb * 2.0;
  s += texture2D(tLow, vUv + t * vec2(0.0, 1.0)).rgb * 2.0;
  s += texture2D(tLow, vUv + t * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tLow, vUv + t * vec2(1.0, -1.0)).rgb;
  s += texture2D(tLow, vUv + t * vec2(-1.0, 1.0)).rgb;
  s += texture2D(tLow, vUv + t * vec2(1.0, 1.0)).rgb;
  s /= 16.0;
  gl_FragColor = vec4(texture2D(tHigh, vUv).rgb * (1.0 - uMix * 0.0) + s * uMix, 1.0);
}
`;

// ---------------- 被写界深度 ----------------
export const DOF_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float uFocus;     // ピントの距離(m)
uniform float uAperture;  // ボケの強さ
uniform float uNear;
uniform float uFar;
uniform float uMaxCoC;    // px
float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
float coc(float d) {
  float z = linDepth(d);
  float c = uAperture * abs(z - uFocus) / max(z, 0.1) ;
  return min(c * resolution.y, uMaxCoC);
}
void main() {
  float d0 = texture2D(tDepth, vUv).r;
  float c0 = coc(d0);
  vec3 sum = texture2D(tColor, vUv).rgb;
  float wsum = 1.0;
  const int TAPS = 40;
  float ang = hash12(gl_FragCoord.xy) * 6.2831853;
  float maxR = uMaxCoC;
  for (int i = 0; i < TAPS; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(TAPS)) * maxR;
    float a = fi * 2.399963 + ang;
    vec2 o = vec2(cos(a), sin(a)) * r;
    vec2 uv = vUv + o / resolution;
    float d = texture2D(tDepth, uv).r;
    float cs = coc(d);
    // このサンプルのボケ半径が距離rに届いているか。手前物体は背景に染み出す。
    float reach = max(cs, 0.0);
    float w = smoothstep(r - 1.0, r + 1.0, reach);
    // 背景のサンプルが手前のピントの合った物体に混ざらないよう制限
    if (linDepth(d) > linDepth(d0) + 0.3) w *= smoothstep(r - 1.0, r + 1.0, c0);
    vec3 c = texture2D(tColor, uv).rgb;
    // ハイライトは少し重くしてボケ玉を強調
    float hl = 1.0 + 0.6 * smoothstep(1.5, 12.0, luma(c));
    w *= hl;
    sum += c * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}
`;

// ---------------- 最終合成：ブルーム・露出・トーンマップ・グレーディング ----------------
export const FINAL_FRAG = /* glsl */ `
${COMMON}
#include <tonemapping_pars_fragment>
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tExposure;
uniform float uBloom;
uniform float uTime;
uniform float uFade;
uniform float uGrain;
uniform vec2 resolution;
uniform float uUnderwater;
uniform float uExposureBias;

vec3 acesFit(vec3 x) {
  const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = ACESIn * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(ACESOut * (a / b), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  // ごく弱い色収差（レンズ感）
  float ca = 0.0016 * dot(cc, cc) * 4.0;
  vec3 col;
  col.r = texture2D(tColor, uv - cc * ca).r;
  col.g = texture2D(tColor, uv).g;
  col.b = texture2D(tColor, uv + cc * ca).b;
  vec3 bl = texture2D(tBloom, uv).rgb;
  col += bl * uBloom;
  float ex = texture2D(tExposure, vec2(0.5)).r * uExposureBias;
  col *= ex;
  // グレーディング：影に青緑、ハイライトに暖色
  float l = luma(col);
  col = mix(col, col * vec3(0.90, 1.02, 1.08), smoothstep(0.35, 0.0, l) * 0.6);
  col = mix(col, col * vec3(1.06, 1.0, 0.9), smoothstep(0.4, 1.6, l) * 0.5);
#ifdef TONE_AGX
  vec3 tm = clamp(AgXToneMapping(col * 0.8), 0.0, 1.0);
#else
  vec3 tm = acesFit(col * 0.82);
#endif
  // 彩度をわずかに持ち上げ
  float tl = luma(tm);
  tm = mix(vec3(tl), tm, 1.08);
  // ビネット
  float v = 1.0 - dot(cc, cc) * 0.85;
  tm *= clamp(v, 0.0, 1.0);
  vec3 o = toSRGB(tm);
  // フィルムグレイン
  float g = hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
  o += g * uGrain * (1.0 - tl * 0.6);
  o *= uFade;
  gl_FragColor = vec4(o, 1.0);
}
`;

// ---------------- TAA ----------------
export const TAA_FRAG = /* glsl */ `
${COMMON}
varying vec2 vUv;
uniform sampler2D tCur;     // rgb: 色, a: 可視面までの距離
uniform sampler2D tHist;
uniform mat4 invVpCur;      // ジッターなし
uniform mat4 vpPrev;        // 前フレーム（ジッターなし）
uniform vec3 camPos;
uniform vec2 texel;
uniform float uReset;
uniform float uBlend;

vec3 comp(vec3 c) { return c / (1.0 + luma(c)); }
vec3 uncomp(vec3 c) { return c / max(1.0 - luma(c), 1e-3); }

void main() {
  vec4 cur = texture2D(tCur, vUv);
  vec3 c0 = min(cur.rgb, vec3(1000.0));
  if (uReset > 0.5) { gl_FragColor = vec4(c0, 1.0); return; }

  vec4 f = invVpCur * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(f.xyz / f.w - camPos);
  vec3 wp = camPos + dir * cur.a;
  vec4 pp = vpPrev * vec4(wp, 1.0);
  vec2 puv = pp.xy / pp.w * 0.5 + 0.5;

  // 近傍の色の範囲
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  vec3 mn = vec3(1e9), mx = vec3(-1e9);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 c = comp(min(texture2D(tCur, vUv + vec2(float(x), float(y)) * texel).rgb, vec3(1000.0)));
    m1 += c; m2 += c * c; mn = min(mn, c); mx = max(mx, c);
  }
  m1 /= 9.0; m2 /= 9.0;
  vec3 sd = sqrt(max(m2 - m1 * m1, 0.0));
  vec3 lo = max(mn, m1 - sd * 1.35);
  vec3 hi = min(mx, m1 + sd * 1.35);

  bool inside = puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0;
  vec3 hist = comp(min(texture2D(tHist, clamp(puv, 0.0, 1.0)).rgb, vec3(1000.0)));
  // クリップ（AABBへ）
  vec3 center = 0.5 * (lo + hi);
  vec3 ext = 0.5 * (hi - lo) + 1e-4;
  vec3 v = hist - center;
  vec3 a = abs(v / ext);
  float m = max(a.x, max(a.y, a.z));
  if (m > 1.0) hist = center + v / m;

  float blend = uBlend;
  vec2 mv = (puv - vUv) / texel;
  blend = mix(blend, 0.35, clamp(length(mv) * 0.15, 0.0, 1.0));
  if (!inside) blend = 1.0;
  vec3 res = mix(hist, comp(c0), blend);
  gl_FragColor = vec4(uncomp(res), 1.0);
}
`;
