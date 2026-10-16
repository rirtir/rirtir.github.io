// アニメ調トゥーンシェーダー（MeshToonMaterial を onBeforeCompile で差し替え）
// - 2段ランプ + 色付きの影 + リムライト + 画面幅一定の輪郭（反転ハル）
// - 体は「毛色の塗り分け」と「目・眉・口」をシェーダー内で描く（形が変わっても表面に追従する）
import * as THREE from 'three';

// 全マテリアルで共有するライティング用ユニフォーム
export const LIGHT = {
  uT1: { value: 0.47 },          // 明暗の境目
  uT2: { value: 0.2 },           // 深い影の境目
  uSoft: { value: 0.03 },        // 境目のやわらかさ
  uShadeMul: { value: new THREE.Color(0.66, 0.6, 0.8) },  // 影色（乗算）
  uDeepMul: { value: 0.82 },
  uKeyCol: { value: new THREE.Color(1.0, 0.97, 0.93) },
  uFillDir: { value: new THREE.Vector3(0.7, 0.1, 0.7).normalize() },  // ビュー空間
  uFillCol: { value: new THREE.Color(0.55, 0.62, 0.85) },
  uFillStr: { value: 0.12 },
  uRimCol: { value: new THREE.Color(0.85, 0.9, 1.0) },
  uRimStr: { value: 0.35 },
  uRimDir: { value: new THREE.Vector2(-0.6, 0.8).normalize() },
  uShadowStr: { value: 0.85 },
  uOutlinePx: { value: 1.6 },
  uOutlineMul: { value: new THREE.Color(0.36, 0.28, 0.32) },
  uViewport: { value: new THREE.Vector2(1280, 720) },
  uHeadC: { value: new THREE.Vector3(0, 1.7, 0) },  // 顔の球面法線用（ワールド）
  uFaceSoft: { value: 0.45 },
  uFurJag: { value: 0.0 },       // 影の境目を毛並み風にギザギザに
  uTime: { value: 0 },
};

// 体専用ユニフォーム（毛色・模様・目・口）
export function makeBodyUniforms() {
  const C = (h) => ({ value: new THREE.Color(h) });
  const V3 = () => ({ value: new THREE.Vector3() });
  const V4 = (a, b, c, d) => ({ value: new THREE.Vector4(a, b, c, d) });
  return {
    uColMain: C('#c98a52'), uColSub: C('#f4e6d4'), uColAccent: C('#4a3426'), uColPad: C('#4b3a3c'),
    uColPattern: C('#3b2a22'),
    uMark: V4(0.6, 0.5, 1.0, 1.0),    // x: 腹の幅(角度) y: マズル色の範囲 z: 手の先の色(armT) w: 足先(legT)
    uMark2: V4(0, 0.5, 0.5, 0),       // x: 模様種類 y: 模様の大きさ z: 模様の量 w: 境界ギザギザ
    uMark3: V4(0, 0, 0, 0),           // x: 目の周り y: 背中 z: 頬の白 w: 額の模様
    // 目
    uEyeC: V3(), uEyeR: V3(), uEyeU: V3(), uEyeN: V3(),
    uEyeA: V4(0.021, 0.8, 0.12, 0.0),  // x: 半幅 y: 縦横比 z: つり/たれ w: 左右位置
    uEyeB: V4(0.7, 0.45, 0.0, 0.0),   // x: 上まぶたの丸み y: 下まぶた z: (未使用) w: 上下位置
    uIris: V4(0.62, 0.42, 0.0, 0.0),  // x: 瞳の大きさ y: 瞳孔 z: 瞳孔の形 w: 瞳の上下
    uIrisTop: C('#2d6a3a'), uIrisBot: C('#b8e05a'), uSclera: C('#fbfaf6'), uLid: C('#2a1c1a'),
    uEyeC2: V4(1.0, 1.0, 0.0, 0.0),   // x: まぶた線の太さ y: ハイライト z: まつげ w: 白目の暗さ
    uBlink: { value: 0 }, uGaze: { value: new THREE.Vector2(0, 0) },
    uBrow: V4(1, 0.0, 0.0, 1.0),      // x: 種類 y: 上下 z: 角度 w: 太さ
    uBrowCol: C('#3a2a22'),
    // 口
    uMzRoot: V3(), uMzF: V3(), uMzU: V3(), uMzLen: { value: 0.15 },
    uMouthA: V4(-0.034, 0.32, 0.0, 1.6), // x: 口の高さ y: 口角の位置 z: 口角上げ w: 線の太さ(px)
    uMouthB: V4(0.0, 0.016, 1.0, 0.3),   // x: 牙の長さ y: 牙の位置 z: 鼻下の線 w: ω
    uMouthC: V4(0.0, 0.0, 0.0, 0.0),     // x: 口の開き
    uMouthCol: C('#2a1818'),
    uCav: V4(0.35, 0, 0.6, 0.3), uTorso: V4(1.285, 1.085, 0.074, 0),
    uFurLen: { value: 0.5 }, uFurDens: { value: 1.0 }, uClothV: V4(0, 1, 0.3, 0),
  };
}

const NOISE = /* glsl */`
float kc_hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float kc_noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(kc_hash(i+vec3(0,0,0)),kc_hash(i+vec3(1,0,0)),f.x),mix(kc_hash(i+vec3(0,1,0)),kc_hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(kc_hash(i+vec3(0,0,1)),kc_hash(i+vec3(1,0,1)),f.x),mix(kc_hash(i+vec3(0,1,1)),kc_hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float kc_aa(float d){ float w = fwidth(d); return 1.0 - smoothstep(-w, w, d); }   // d<0 が内側
`;

const LIGHT_PARS = /* glsl */`
uniform float uT1, uT2, uSoft, uDeepMul, uFillStr, uRimStr, uShadowStr, uFaceSoft, uFurJag, uTime;
uniform vec3 uShadeMul, uKeyCol, uFillDir, uFillCol, uRimCol, uOutlineMul;
uniform vec2 uRimDir;
float kcNdl = 0.5; float kcShadow = 1.0; vec3 kcL = vec3(0,0,1);
varying vec3 vViewPosition;
struct ToonMaterial { vec3 diffuseColor; };
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  kcL = directLight.direction;
  kcShadow = directLight.color.r;
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
vec3 kcToon(vec3 albedo, vec3 N, vec3 V, float faceSoft, float jag) {
  float ndl = dot(N, kcL) * 0.5 + 0.5;
  float sh = mix(1.0, kcShadow, uShadowStr);
  float s = uSoft + faceSoft * 0.06;
  float lit = smoothstep(uT1 - s, uT1 + s, ndl + jag) * smoothstep(0.35, 0.65, sh);
  float deep = smoothstep(uT2 - s, uT2 + s, ndl + jag * 0.5);
  vec3 shade = albedo * uShadeMul * mix(uDeepMul, 1.0, max(deep, faceSoft));
  vec3 col = mix(shade, albedo * uKeyCol, lit);
  col += albedo * uFillCol * uFillStr * max(dot(N, uFillDir), 0.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float rim = smoothstep(0.5, 0.75, pow(1.0 - ndv, 2.2)) * smoothstep(-0.1, 0.5, dot(normalize(N.xy + 1e-5), uRimDir));
  col += uRimCol * rim * uRimStr * (0.35 + 0.65 * lit);
  return col;
}
`;

const BODY_PARS = /* glsl */`
uniform vec3 uColMain, uColSub, uColAccent, uColPad, uColPattern;
uniform vec4 uMark, uMark2, uMark3;
uniform vec3 uEyeC, uEyeR, uEyeU, uEyeN;
uniform vec4 uEyeA, uEyeB, uIris, uEyeC2, uBrow;
uniform vec3 uIrisTop, uIrisBot, uSclera, uLid, uBrowCol;
uniform float uBlink; uniform vec2 uGaze;
uniform vec3 uMzRoot, uMzF, uMzU; uniform float uMzLen;
uniform vec4 uMouthA, uMouthB, uMouthC; uniform vec3 uMouthCol; uniform vec4 uCav; uniform vec4 uTorso;

// 線: |d| が幅(px)以内なら1
float kcLine(float d, float px){ float w = max(fwidth(d), 1e-6); return 1.0 - smoothstep(px*0.5 - 0.6, px*0.5 + 0.6, abs(d)/w); }

vec3 kcAlbedo(out float isPad) {
  vec3 p = vPos;
  float ax = abs(p.x);
  vec3 col = uColMain;
  // 模様（縞・斑）
  float pat = 0.0;
  float jag = uMark2.w;
  float angT = atan(p.x, p.z + 0.01);
  if (uMark2.x > 0.5 && uMark2.x < 1.5) {          // 縞（体に巻きつく帯）
    float cy = vMaskB.x > 0.001 ? vMaskB.x * 15.0 : (vMaskB.y > 0.001 ? vMaskB.y * 17.0 : p.y * 30.0 + ax * 6.0 * vMaskA.g);
    cy /= uMark2.y;
    float warp = (kc_noise(p * 7.0) - 0.5) * 2.2 + (kc_noise(p * 19.0) - 0.5) * 0.7;
    float band = abs(fract(cy + warp * 0.35) - 0.5) * 2.0;
    float backness = 0.5 - 0.5 * cos(angT);
    float wdt = uMark2.z * 0.5 * (0.25 + 0.75 * backness);
    pat = kc_aa(band - wdt) * step(0.3, kc_noise(p * vec3(13.0, 2.5, 13.0)) + 0.15 * backness);
    pat *= (1.0 - vMaskA.r) * (1.0 - step(0.5, vMaskA.a));
  } else if (uMark2.x > 1.5 && uMark2.x < 2.5) {   // 斑点
    vec3 q = p * 38.0 / uMark2.y;
    float n = kc_noise(q) + 0.35 * kc_noise(q * 2.3);
    pat = smoothstep(1.18 - uMark2.z * 0.5, 1.22 - uMark2.z * 0.5, n);
    pat *= (1.0 - vMaskA.r);
  } else if (uMark2.x > 2.5) {                     // ぶち
    float n = kc_noise(p * 6.0 / uMark2.y) + 0.3 * kc_noise(p * 17.0);
    pat = smoothstep(0.95 - uMark2.z * 0.6, 1.0 - uMark2.z * 0.6, n);
  }
  // 背中
  float zc = -0.01;
  float ang = atan(p.x, p.z - zc);
  float back = uMark3.y * step(0.0, 1.0) * smoothstep(0.0, 0.06, 1.0 - vMaskA.g) * (1.0 - smoothstep(0.0, 0.02, vMaskB.x)) * (1.0 - smoothstep(0.0, 0.02, vMaskB.y));
  float backM = back * step(abs(ang), 3.1416) * smoothstep(3.1416 - uMark3.y * 1.4 - 0.03, 3.1416 - uMark3.y * 1.4 + 0.03, abs(ang) + jag * 0.15 * (abs(fract(p.y * 18.0) - 0.5) - 0.25));
  col = mix(col, uColPattern, max(pat, backM));
  // 腹・胸（体の前面）
  float zig = jag * (abs(fract(p.y * 22.0 + ax * 8.0) - 0.5) - 0.25) * 0.5;
  float front = uMark.x > 0.01 ? kc_aa(abs(ang) + zig - uMark.x) : 0.0;
  front *= step(0.8, p.y) * (1.0 - smoothstep(0.02, 0.1, vMaskB.x)) * (1.0 - step(0.12, vMaskB.y));
  front *= 1.0 - step(0.35, vMaskA.g);
  // 顔: マズル下側・頬・のど（目の下から後ろ下がりの斜めの境目）
  vec3 q = p - uMzRoot;
  float my = dot(q, uMzU);
  float zz = jag * 0.006 * (abs(fract(p.z * 70.0 + ax * 40.0) - 0.5) - 0.25) * 4.0;
  float muzLine = my - mix(-0.045, 0.045, uMark.y) + zz;
  float isMuz = smoothstep(0.32, 0.38, vMaskA.r);
  float isHead = smoothstep(0.32, 0.38, vMaskA.g);
  float muz = isMuz * kc_aa(muzLine);
  float h = (p.y - (uEyeC.y - 0.03 - 0.035 * (1.0 - uMark.y))) + 0.55 * (uEyeC.z - p.z) + zz;
  float cheek = uMark3.z * isHead * kc_aa(h) * step(-0.06, p.z - uEyeC.z + 0.12);
  float throat = isHead * (1.0 - isMuz) * kc_aa(p.y - (uMzRoot.y - 0.055) + zz) * step(-0.03, p.z) * step(0.01, uMark.x);
  float faceW = max(max(muz, cheek), throat);
  col = mix(col, uColSub, clamp(max(front, faceW), 0.0, 1.0));
  // 手先・足先
  float sockA = clamp(1.0 - kc_aa(vMaskB.x + zig * 0.2 - uMark.z), 0.0, 1.0) * step(0.001, vMaskB.x);
  float sockL = clamp(1.0 - kc_aa(vMaskB.y + zig * 0.2 - uMark.w), 0.0, 1.0) * step(0.001, vMaskB.y);
  col = mix(col, uColAccent, max(sockA, sockL));
  // 目の周りのマスク
  if (uMark3.x > 0.01) {
    vec3 pe = p; pe.x = abs(pe.x);
    vec3 d = pe - uEyeC;
    float X = dot(d, uEyeR) / uEyeA.x, Y = dot(d, uEyeU) / uEyeA.x;
    float r = length(vec2(X * 0.55, Y * 0.8)) - (1.0 + uMark3.x * 1.2);
    float m = 1.0 - smoothstep(-0.05, 0.05, r + zig);
    col = mix(col, uColPattern, m * step(-0.03, dot(d, uEyeN)));
  }
  // 額の模様
  if (uMark3.w > 0.01) {
    vec3 d = p - vec3(0.0, uEyeC.y + 0.035, uEyeC.z + 0.005);
    float r = abs(p.x) * 2.2 + max(-(p.y - uEyeC.y - 0.03), 0.0) * 1.2 - (p.y - uEyeC.y - 0.02) * 0.4;
    float m = step(r, 0.02 + 0.04 * uMark3.w) * step(uEyeC.y + 0.0, p.y) * step(0.0, p.z) * vMaskA.g;
    col = mix(col, uColSub, m);
  }
  isPad = smoothstep(0.45, 0.6, vMaskA.b);
  col = mix(col, uColPad, isPad);
  return col;
}

// 目（rgb, 不透明度）。unlit 扱い
vec4 kcEye(vec3 p) {
  bool mir = p.x < 0.0;
  p.x = abs(p.x);
  vec3 d = p - uEyeC;
  if (dot(d, uEyeN) < -0.025 || vMaskA.g < 0.3) return vec4(0.0);
  float W = uEyeA.x;
  float X = (dot(d, uEyeR) - uEyeA.w) / W;
  float Y = (dot(d, uEyeU) - uEyeB.w) / W;
  if (abs(X) > 2.2 || abs(Y) > 2.6) return vec4(0.0);
  float asp = uEyeA.y, tilt = uEyeA.z;
  float bx = sqrt(max(1.0 - X * X, 0.0));
  float yu = asp * pow(bx, uEyeB.x) + tilt * X;
  // 目つき: 上まぶたを下ろして、ふちを平らに（半目）
  yu -= uEyeC2.w * asp * 0.5 * pow(bx, 0.35) * (1.0 - 0.35 * smoothstep(-1.0, 1.0, X));
  float yl = -asp * uEyeB.y * pow(bx, 0.85) + tilt * X * 0.7;
  float yc = mix(mix(yl, yu, 0.3), yu - asp * 0.45, uEyeB.z);
  yl = mix(yl, mix(yl, yu, 0.45), uEyeB.z * 0.0);
  yu = mix(yu, yc, uBlink); yl = mix(yl, yc, uBlink);
  vec4 o = vec4(0.0);
  // 白目
  float inside = (abs(X) < 1.0) ? kc_aa(max(yl - Y, Y - yu)) * kc_aa(abs(X) - 1.0) : 0.0;
  if (uBlink > 0.95) inside = 0.0;
  if (inside > 0.0) {
    vec3 sc = uSclera * mix(1.0, 0.72, smoothstep(yu - 0.5 * asp, yu, Y)) ;
    vec3 col = sc;
    // 瞳
    float r = uIris.x;
    vec2 c = vec2(uGaze.x * (mir ? -1.0 : 1.0) * 0.25, uGaze.y * 0.15 + uIris.w + mix(0.0, -0.2, uBlink));
    vec2 dv = vec2(X - c.x, (Y - c.y) / 1.1);
    float rr = length(dv);
    float iris = kc_aa(rr - r);
    vec3 ic = mix(uIrisBot, uIrisTop, smoothstep(-r * 0.7, r * 0.9, dv.y));
    ic = mix(ic, uIrisTop * 0.55, smoothstep(r * 0.78, r * 0.98, rr));
    // 瞳孔
    float pu = 0.0;
    if (uIris.z < 0.5) pu = kc_aa(rr - r * uIris.y);
    else if (uIris.z < 1.5) { float hw = r * uIris.y * 0.32 * sqrt(max(1.0 - (dv.y / (r * 0.95)) * (dv.y / (r * 0.95)), 0.0)); pu = kc_aa(abs(dv.x) - hw); }
    else if (uIris.z < 2.5) pu = 0.0;
    else { pu = kc_aa(length(vec2(dv.x * 0.6, dv.y * 1.6)) - r * uIris.y * 0.5); }
    ic = mix(ic, uIrisTop * 0.18, pu);
    // 上まぶたの影
    ic *= mix(1.0, 0.6, smoothstep(yu - 0.35 * asp, yu, Y));
    col = mix(col, ic, iris);
    // ハイライト
    float hx = mir ? 1.0 : -1.0;
    float h1 = kc_aa(length(vec2(X - (c.x + hx * 0.32 * r), (Y - (c.y + 0.38 * r)))) - 0.26 * r * uEyeC2.y);
    float h2 = kc_aa(length(vec2(X - (c.x - hx * 0.3 * r), (Y - (c.y - 0.42 * r)))) - 0.11 * r * uEyeC2.y);
    col = mix(col, vec3(1.0), max(h1, h2 * 0.9) * iris * step(0.01, uEyeC2.y));
    o = vec4(col, inside);
  }
  // 上まぶたの線（目尻ほど太く、跳ね上げ）
  float lw = 0.16 * uEyeC2.x;
  float prof = lw * (0.55 + 0.6 * smoothstep(-1.0, 0.8, X));
  float upper = (X > -1.04 && X < 1.0) ? kc_aa(max(-(Y - yu) - lw * 0.25, (Y - yu) - prof)) : 0.0;
  // 目尻の跳ね
  float fx = (X - 0.9) / 0.45;
  float yfl = tilt * X + asp * 0.05 + (X - 0.9) * (0.55 + uEyeC2.z * 0.6) * asp;
  float flick = (fx > 0.0 && fx < 1.0) ? kc_aa(abs(Y - yfl) - prof * 0.9 * (1.0 - fx)) : 0.0;
  // まつげ（上に短く数本）
  float lash = 0.0;
  if (uEyeC2.z > 0.01) {
    for (int i = 0; i < 2; i++) {
      float x0 = 0.45 + float(i) * 0.3;
      float y0 = asp * pow(sqrt(max(1.0 - x0 * x0, 0.0)), uEyeB.x) + tilt * x0;
      vec2 dir = normalize(vec2(0.8, 0.9 + float(i) * 0.4));
      vec2 rel = vec2(X - x0, Y - y0);
      float t = dot(rel, dir);
      float dd = abs(rel.x * dir.y - rel.y * dir.x);
      float len = 0.35 * uEyeC2.z;
      lash = max(lash, (t > 0.0 && t < len) ? kc_aa(dd - lw * 0.55 * (1.0 - t / len)) : 0.0);
    }
  }
  // 下まぶた（目尻側だけ細く）
  float lower = (X > 0.15 && X < 1.0 && uBlink < 0.9) ? kc_aa(abs(Y - yl) - lw * 0.22 * smoothstep(0.15, 0.7, X) * (1.0 - smoothstep(0.85, 1.0, X))) : 0.0;
  float lid = max(max(upper, flick), max(lash, lower));
  o.rgb = mix(o.rgb, uLid, lid);
  o.a = max(o.a, lid);
  // 眉
  if (uBrow.x > 0.5) {
    vec2 bc = vec2(0.05, asp + 0.55 + uBrow.y);
    float a = uBrow.z;
    vec2 rel = vec2(X, Y) - bc;
    rel = mat2(cos(a), -sin(a), sin(a), cos(a)) * rel;
    float m = 0.0;
    if (uBrow.x < 1.5) {       // 線
      float t = clamp(rel.x / 1.1, -1.0, 1.0);
      float yy = -0.12 * t * t;
      float th = 0.13 * uBrow.w * (1.0 - 0.6 * smoothstep(0.0, 1.0, t));
      m = (abs(rel.x) < 1.1) ? kc_aa(abs(rel.y - yy) - th) : 0.0;
    } else if (uBrow.x < 2.5) { // 麻呂眉（点）
      m = kc_aa(length(vec2((rel.x + 0.35) / 0.42, rel.y / 0.28)) - uBrow.w);
    } else {                    // 太い
      float t = clamp(rel.x / 1.15, -1.0, 1.0);
      float th = 0.24 * uBrow.w * (1.0 - 0.5 * smoothstep(0.0, 1.0, t));
      m = (abs(rel.x) < 1.15) ? kc_aa(abs(rel.y + 0.05 * t) - th) : 0.0;
    }
    o.rgb = mix(o.rgb, uBrowCol, m * (1.0 - o.a * step(0.5, lid)));
    o.a = max(o.a, m);
  }
  return o;
}

// 口（マズルの断面線として描く）
vec4 kcMouth(vec3 p) {
  if (vMaskA.r < 0.2) return vec4(0.0);
  vec3 q = p - uMzRoot;
  float s = dot(q, uMzF) / uMzLen;
  float y = dot(q, uMzU);
  float ax = abs(p.x);
  float sc = uMouthA.y;
  float yl = uMouthA.x + uMouthA.z * 0.012 * pow(clamp((sc + 0.3 - s) / 0.3, 0.0, 1.0), 2.0);
  yl += uMouthB.w * 0.006 * exp(-pow(ax / 0.007, 2.0)) * step(0.8, s);
  float d = y - yl;
  float a = 0.0;
  // 開いた口
  float open = uMouthC.x;
  if (open > 0.001) {
    float yb = yl - open * 0.03 * pow(smoothstep(sc, 1.0, s), 0.7);
    float inside = step(sc, s) * step(yb, y) * step(y, yl);
    if (inside > 0.0) {
      vec3 mc = mix(uMouthCol, vec3(0.75, 0.3, 0.32), smoothstep(yb + 0.004, yb, y) * 0.8);
      return vec4(mc, 1.0);
    }
    d = min(abs(d), abs(y - yb));
  }
  float fade = smoothstep(sc - 0.02, sc + 0.06, s);
  a = kcLine(d, uMouthA.w * mix(0.6, 1.0, smoothstep(sc, sc + 0.25, s))) * fade * step(sc - 0.03, s);
  // 鼻下の縦線
  if (uMouthB.z > 0.5) {
    float yn = dot(vec3(0.0, 0.0, 0.0), uMzU);
    a = max(a, kcLine(p.x, uMouthA.w * 0.9) * step(yl, y) * step(y, yl + 0.03) * step(0.75, s));
  }
  vec4 o = vec4(uMouthCol, a);
  // ヒゲの点（上唇の横）
  if (uMouthC.y > 0.5 && ax > 0.01) {
    float dots = 0.0;
    for (int i = 0; i < 3; i++) for (int j = 0; j < 2; j++) {
      vec2 c = vec2(0.6 + float(i) * 0.085 + float(j) * 0.04, uMouthA.x + 0.012 + float(j) * 0.009);
      vec2 d = vec2((s - c.x) * uMzLen, y - c.y);
      dots = max(dots, kc_aa(length(d) - 0.0019));
    }
    o.rgb = mix(o.rgb, uMouthCol, dots * (1.0 - a));
    o.a = max(o.a, dots * 0.85);
  }
  // 牙
  if (uMouthB.x > 0.001) {
    float fx = ax - uMouthB.y;
    float t = (yl - y) / (0.012 * uMouthB.x);
    float w = 0.0045 * (1.0 - t);
    float f = (t > 0.0 && t < 1.0 && s > 0.6) ? kc_aa(abs(fx) - w) : 0.0;
    if (f > 0.0) {
      float edge = kc_aa(abs(fx) - w + 0.0012) ;
      o.rgb = mix(uMouthCol, vec3(0.98, 0.97, 0.94), edge);
      o.a = max(o.a, f);
    }
  }
  return o;
}
`;

// type: 'body' | 'part' | 'nose' | 'hair'
export function makeToon(type, opts = {}) {
  const outline = !!opts.outline;
  const m = new THREE.MeshToonMaterial({
    color: 0xffffff,
    vertexColors: type !== 'body' && type !== 'shell',
    side: outline ? THREE.BackSide : (opts.side ?? THREE.FrontSide),
  });
  const bodyU = opts.bodyUniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, LIGHT);
    if (bodyU) Object.assign(sh.uniforms, bodyU);
    if (opts.uniforms) Object.assign(sh.uniforms, opts.uniforms);
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    const defs = `#define KC_${type.toUpperCase()}\n${outline ? '#define KC_OUTLINE\n' : ''}${type === 'body' || type === 'shell' ? '#define KC_MASKS\n' : ''}${type === 'body' && (outline || opts.furHull) ? '#define KC_FURDISP\n' : ''}${opts.furHull ? '#define KC_FURHULL\n' : ''}`;
    vs = defs + vs; fs = defs + fs;
    // ---- vertex
    vs = vs.replace('#include <common>', `#include <common>
uniform float uOutlinePx; uniform vec2 uViewport; uniform float uOutlineScale;
varying vec3 vPos; varying vec4 vMaskA; varying vec4 vMaskB; varying vec3 vWPos; varying vec3 vWN;
#ifdef KC_MASKS
attribute vec4 maskA; attribute vec4 maskB;
#endif
#ifdef KC_FURDISP
uniform float uFurLen, uFurDens; uniform vec4 uClothV;
${NOISE.replace(/float kc_aa[^\n]*\n/, '')}
bool kcClothedV(vec3 p, vec4 mA, vec4 mB) {
  float waist = 1.005;
  float hemY = uClothV.y < 0.5 ? 0.665 : (uClothV.y < 1.5 ? 0.47 : 0.105);
  if (p.y < waist + 0.05 && p.y > hemY - 0.025 && mB.x < 0.001 && mA.a < 0.5 && mA.g < 0.35) return true;
  if (uClothV.x > 0.5 && p.y > waist - 0.07 && p.y < 1.5 + 0.1 * smoothstep(0.07, 0.17, abs(p.x)) && mA.g < 0.35 && mB.y < 0.001) {
    if (uClothV.x < 1.5) return mB.x < 0.001 && abs(p.x) < 0.19;
    if (uClothV.x > 3.5 && p.z > 0.0 && abs(p.x) < 0.035 + 0.075 * smoothstep(1.05, 1.45, p.y) * (0.4 + uClothV.z) && mB.x < 0.001) return false;
    return mB.x < (uClothV.x < 2.5 ? 0.3 : 0.86);
  }
  return false;
}
float kcFurDisp(vec3 p, vec4 mA, vec4 mB) {
  if (uFurLen < 0.001) return 0.0;
  float region = (1.0 - smoothstep(0.3, 0.6, mA.a)) * (1.0 - mA.b) * (1.0 - mA.r * 0.9);
  region *= 1.0 - mA.g * smoothstep(0.0, 0.08, p.z) * 0.85;
  if (kcClothedV(p, mA, mB)) region = 0.0;
  float n = kc_noise(p * vec3(30.0, 11.0, 30.0) * uFurDens + vec3(0.0, p.x * 8.0, 0.0));
  float spike = pow(clamp(n * 1.35 - 0.2, 0.0, 1.0), 2.4);
  return uFurLen * 0.016 * spike * region;
}
#endif`);
    vs = vs.replace('#include <skinning_vertex>', `#include <skinning_vertex>
#ifdef KC_FURDISP
{
  float fd = kcFurDisp(position, maskA, maskB);
  transformed += normalize(normalize(objectNormal) + vec3(0.0, -0.55, 0.0)) * fd;
}
#endif`);
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
vPos = position;
#ifdef KC_MASKS
vMaskA = maskA; vMaskB = maskB;
#else
vMaskA = vec4(0.0); vMaskB = vec4(0.0);
#endif
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * objectNormal);
#ifdef KC_OUTLINE
{
  vec4 cn = projectionMatrix * vec4(normalize(transformedNormal), 0.0);
  vec2 dir = cn.xy * uViewport;
  dir = normalize(dir + 1e-6);
  float px = uOutlinePx * uOutlineScale;
  #ifdef KC_MASKS
  px *= mix(1.0, 0.6, maskA.g) * mix(1.0, 0.55, maskA.a);
  #endif
  px *= clamp(2.4 / gl_Position.w, 0.5, 1.25);
  gl_Position.xy += dir * px * 2.0 / uViewport * gl_Position.w;
  gl_Position.z += 0.0012 * gl_Position.w;
}
#endif`);
    // ---- fragment
    fs = fs.replace('#include <common>', `#include <common>
uniform vec3 uHeadC; uniform float uOutlineScale;
varying vec3 vPos; varying vec4 vMaskA; varying vec4 vMaskB; varying vec3 vWPos; varying vec3 vWN;
${NOISE}
${type === 'body' ? BODY_PARS : ''}
${opts.fragPars || ''}`);
    fs = fs.replace('#include <lights_toon_pars_fragment>', LIGHT_PARS);
    fs = fs.replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', `
vec3 outgoingLight;
{
  vec3 albedo = diffuseColor.rgb;
  float isPad = 0.0;
#ifdef KC_BODY
  albedo = kcAlbedo(isPad);
#endif
  ${opts.albedoHook || ''}
#ifdef KC_OUTLINE
  outgoingLight = albedo * uOutlineMul;
#else
  vec3 N = normal;
  float faceSoft = 0.0;
#ifdef KC_BODY
  faceSoft = clamp(vMaskA.g - vMaskA.r * 0.75, 0.0, 1.0);
  vec3 sphereN = normalize((viewMatrix * vec4(normalize(vWPos - uHeadC), 0.0)).xyz);
  N = normalize(mix(N, sphereN, faceSoft * uFaceSoft));
#endif
  vec3 V = normalize(vViewPosition);
#ifdef KC_FURHULL
  N = normalize(N - V * dot(N, V) + V * 0.15);
#endif
  float jag = 0.0;
  if (uFurJag > 0.001) {
    float n1 = kc_noise(vPos * vec3(60.0, 22.0, 60.0));
    jag = (n1 - 0.5) * 0.16 * uFurJag;
  }
  vec3 col = kcToon(albedo, N, V, faceSoft, jag);
#ifdef KC_BODY
#ifndef KC_FURHULL
  // 筋肉の溝の線（くぼみ具合から）
  {
    float cav = mix(vMaskB.z, vMaskB.w, uCav.x) * (1.0 - 0.85 * uCav.y);
    float region = (1.0 - smoothstep(0.3, 0.5, vMaskA.g)) * (1.0 - smoothstep(0.3, 0.6, vMaskA.a)) * (1.0 - step(0.5, vMaskA.b));
    float ln = smoothstep(uCav.w, uCav.w + 0.12, cav) * region * uCav.z * 0.6;
    // 線で描く筋肉（胸筋の下縁・腹筋）。筋肉が多いほど濃く、肉づきで薄く
    vec3 p = vPos; float ax = abs(p.x);
    float k = uCav.z * smoothstep(0.05, 0.5, uCav.x) * (1.0 - smoothstep(0.1, 0.7, uCav.y)) * region * step(0.0, p.z);
    if (k > 0.001) {
      float px = 1.3 + 0.6 * uCav.x;
      // 胸筋の下縁（楕円の下側）
      float ex = (ax - uTorso.z) / 0.088;
      float pb = uTorso.x + 0.068 - 0.062 * sqrt(max(1.0 - ex * ex, 0.0)) - 0.012 * ex;
      float pec = kcLine(p.y - pb, px) * smoothstep(0.012, 0.03, ax) * (1.0 - smoothstep(0.13, 0.155, ax));
      // 腹筋: 中央線と横の区切り
      float sy = uTorso.y;
      float mid = kcLine(p.x, px * 0.8) * step(sy - 0.075, p.y) * step(p.y, uTorso.x + 0.0) * (1.0 - smoothstep(sy + 0.06, sy + 0.12, p.y) * 0.0);
      float h1 = kcLine(p.y - (sy + 0.05 + 0.006 * ax / 0.05), px * 0.85) * (1.0 - smoothstep(0.035, 0.052, ax));
      float h2 = kcLine(p.y - (sy - 0.012 + 0.006 * ax / 0.05), px * 0.85) * (1.0 - smoothstep(0.035, 0.05, ax));
      float sideL = kcLine(ax - 0.062 - 0.012 * (sy - p.y) / 0.08, px * 0.85) * step(sy - 0.07, p.y) * step(p.y, sy + 0.09);
      float abl = max(max(h1, h2), max(mid * smoothstep(0.0, 0.3, uCav.x), sideL)) * smoothstep(0.25, 0.7, uCav.x);
      ln = max(ln, max(pec, abl) * k);
    }
    col = mix(col, col * uShadeMul * 0.62, clamp(ln, 0.0, 1.0));
  }
  // パッドは少しつや
  col += isPad * pow(max(dot(N, normalize(kcL + V)), 0.0), 40.0) * 0.15;
  vec4 eye = kcEye(vPos);
  float litE = 0.88 + 0.12 * smoothstep(0.3, 0.6, dot(N, kcL) * 0.5 + 0.5);
  col = mix(col, eye.rgb * litE * uKeyCol, eye.a);
  vec4 mo = kcMouth(vPos);
  col = mix(col, mo.rgb, mo.a);
#endif
#endif
  ${opts.colorHook || ''}
  outgoingLight = col;
#endif
}`);
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
    m.userData.shader = sh;
  };
  m.userData.outlineScale = { value: opts.outlineScale ?? 1.0 };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => { sh.uniforms.uOutlineScale = m.userData.outlineScale; prev(sh); };
  m.customProgramCacheKey = () => `kc-${type}-${outline}-${opts.key || ''}`;
  return m;
}
