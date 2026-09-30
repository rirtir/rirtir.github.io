// 洞窟の岩・砂のマテリアル。MeshStandardMaterial をベースに、
// 三平面マッピング（triplanar）・濡れ・水中の光の減衰とコースティクス・頂点AO・自前の太陽影を差し込む。
import * as THREE from 'three';

// 共有ユニフォーム（全マテリアル・パスで共有する）
export const shared = {
  uTime: { value: 0 },
  uWaterY: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, -1, 0) },
  uAbsorb: { value: new THREE.Vector3(0.34, 0.058, 0.022) },
  uHole: { value: new THREE.Vector3(4.2, 12, -1) },
  uCausticGain: { value: 1.0 },
  uWaterFill: { value: 1.0 },
  tSunDepth: { value: null },
  uSunVP: { value: new THREE.Matrix4() },
  uSunInfo: { value: new THREE.Vector4(240, 1 / 2048, 0, 0) },
};

export const CAUSTICS_GLSL = /* glsl */ `
float caustics(vec2 uv, float t) {
  const float TAU = 6.28318530718;
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.0055;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
float causticsMix(vec2 xz, float t) {
  float a = caustics(xz * 0.13, t * 0.5);
  float b = caustics(xz * 0.083 + 3.7, t * 0.37 + 5.0);
  return clamp(0.55 * a + 0.55 * b, 0.0, 4.0);
}
`;

const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

// 太陽の影・水中減衰・コースティクス（世界座標から）
export const SUN_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWaterY;
uniform vec3 uSunDir;
uniform vec3 uAbsorb;
uniform vec3 uHole;
uniform float uCausticGain;
uniform float uWaterFill;
uniform sampler2D tSunDepth;
uniform mat4 uSunVP;
uniform vec4 uSunInfo;
${CAUSTICS_GLSL}

float sunShadow(vec3 wp, vec3 n) {
  vec3 p = wp + n * 0.07 - uSunDir * 0.05;
  vec4 lp = uSunVP * vec4(p, 1.0);
  vec3 ndc = lp.xyz / lp.w;
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float z = ndc.z * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  float bias = 0.05 / uSunInfo.x;
  float a = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float ca = cos(a), sa = sin(a);
  float sum = 0.0;
  const int N = 8;
  for (int i = 0; i < N; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(N)) * 1.6;
    float t = fi * 2.399963;
    vec2 o = vec2(cos(t), sin(t)) * r;
    o = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca) * uSunInfo.y;
    float d = textureLod(tSunDepth, uv + o, 0.0).r;
    sum += step(z - bias, d);
  }
  return sum / float(N);
}

// 水面で反射した光が壁・天井に作る揺らめき
float bounceFlicker(vec3 wp, vec3 lightPosView, vec3 geomPosView) {
  vec3 lp = (inverse(viewMatrix) * vec4(lightPosView, 1.0)).xyz;
  vec3 d = normalize(wp - lp);
  vec2 uv = d.xz / max(d.y + 0.35, 0.25);
  float c = causticsMix(uv * 7.5, uTime * 0.9);
  float far = smoothstep(2.0, 14.0, wp.y - uWaterY);
  return mix(0.15 + 2.0 * c, 0.75, far * 0.6);
}

vec3 sunModulation(vec3 wp) {
  float depth = uWaterY - wp.y;
  if (depth <= 0.0) return vec3(1.0);
  float s = depth / max(0.25, -uSunDir.y);
  vec2 ps = wp.xz - uSunDir.xz * s;
  vec3 att = exp(-uAbsorb * s * 0.9);
  float c = causticsMix(ps, uTime);
  float cs = smoothstep(0.0, 0.35, depth) * (1.0 - 0.75 * smoothstep(3.0, 16.0, depth));
  float k = mix(1.0, 0.25 + 1.55 * c, cs * uCausticGain);
  return att * k;
}
`;

// 任意の MeshStandardMaterial に「世界座標の varying」と「自前の太陽影」を差し込む
export function injectSun(shader, { needFrag = true } = {}) {
  Object.assign(shader.uniforms, shared);
  if (!shader.vertexShader.includes('vWPos')) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;`)
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
vec4 wp4_ = vec4(transformed, 1.0);
vec3 wn3_ = objectNormal;
#ifdef USE_INSTANCING
wp4_ = instanceMatrix * wp4_;
wn3_ = mat3(instanceMatrix) * wn3_;
#endif
vWPos = (modelMatrix * wp4_).xyz;
vWN = normalize(mat3(modelMatrix) * wn3_);`
      );
  }
  if (needFrag) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;\n${SUN_GLSL}`)
      .replace('#include <lights_fragment_begin>', patchLights(THREE.ShaderChunk.lights_fragment_begin));
  }
}

function patchLights(chunk) {
  // 太陽（DirectionalLight）にだけ、影・水中減衰・コースティクスを乗せる
  return chunk.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= sunModulation( vWPos ) * sunShadow( vWPos, normalize( vWN ) );'
  );
}

// 水中では周囲から回り込む光でぼんやり明るい（散乱光）
export const WATER_FILL_GLSL = /* glsl */ `
{
  float wdepth = uWaterY - vWPos.y;
  if (wdepth > 0.0) {
    float k = smoothstep(0.0, 0.6, wdepth) * exp(-wdepth * 0.045);
    totalEmissiveRadiance += diffuseColor.rgb * vec3(0.012, 0.16, 0.19) * k * uWaterFill * 0.8;
  }
  // 洞窟内の微弱な散乱光（影の部分が完全な黒い穴にならないように）
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.0052, 0.0058, 0.0068);
}
`;

export function makeCaveMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.FrontSide,
  });
  mat.customProgramCacheKey = () => 'cave-v2';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tA_a = { value: tex.rockA_a };
    shader.uniforms.tA_n = { value: tex.rockA_n };
    shader.uniforms.tB_a = { value: tex.rockB_a };
    shader.uniforms.tB_n = { value: tex.rockB_n };
    shader.uniforms.tC_a = { value: tex.rockC_a };
    shader.uniforms.tC_n = { value: tex.rockC_n };
    shader.uniforms.tS_a = { value: tex.sand_a };
    shader.uniforms.tS_n = { value: tex.sand_n };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aAO;\nvarying float vAO;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\nvAO = aAO;`);

    injectSun(shader);

    const fragPre = /* glsl */ `
varying float vAO;
uniform sampler2D tA_a, tA_n, tB_a, tB_n, tC_a, tC_n, tS_a, tS_n;
${NOISE_GLSL}

const float uNormStr = 1.15;
struct TP { vec3 alb; vec3 nrm; float rough; };

TP triplanar(sampler2D ta, sampler2D tn, vec3 p, vec3 n, vec3 blend, float sc) {
  vec3 sg = vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0);
  vec2 ux = vec2(p.z * sg.x, p.y) * sc;
  vec2 uy = vec2(p.x * sg.y, p.z) * sc;
  vec2 uz = vec2(-p.x * sg.z, p.y) * sc;
  TP r;
  vec3 col = vec3(0.0);
  vec3 tnx = vec3(0.0, 0.0, 1.0), tny = tnx, tnz = tnx;
  float rgh = 0.0;
  if (blend.x > 0.01) {
    col += texture2D(ta, ux, -0.25).rgb * blend.x;
    vec4 t = texture2D(tn, ux, -0.25);
    tnx = vec3((t.xy * 2.0 - 1.0) * uNormStr, 0.0); tnx.z = sqrt(max(0.0, 1.0 - dot(tnx.xy, tnx.xy)));
    rgh += t.b * blend.x;
  }
  if (blend.y > 0.01) {
    col += texture2D(ta, uy, -0.25).rgb * blend.y;
    vec4 t = texture2D(tn, uy, -0.25);
    tny = vec3((t.xy * 2.0 - 1.0) * uNormStr, 0.0); tny.z = sqrt(max(0.0, 1.0 - dot(tny.xy, tny.xy)));
    rgh += t.b * blend.y;
  }
  if (blend.z > 0.01) {
    col += texture2D(ta, uz, -0.25).rgb * blend.z;
    vec4 t = texture2D(tn, uz, -0.25);
    tnz = vec3((t.xy * 2.0 - 1.0) * uNormStr, 0.0); tnz.z = sqrt(max(0.0, 1.0 - dot(tnz.xy, tnz.xy)));
    rgh += t.b * blend.z;
  }
  tnx.x *= sg.x; tny.x *= sg.y; tnz.x *= -sg.z;
  tnx = vec3(tnx.xy + n.zy, abs(tnx.z) * n.x);
  tny = vec3(tny.xy + n.xz, abs(tny.z) * n.y);
  tnz = vec3(tnz.xy + n.xy, abs(tnz.z) * n.z);
  r.nrm = normalize(tnx.zyx * blend.x + tny.xzy * blend.y + tnz.xyz * blend.z);
  r.alb = col;
  r.rough = rgh;
  return r;
}
`;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragPre}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
// ---- 洞窟マテリアル ----
vec3 P = vWPos;
vec3 Ng = normalize(vWN);
vec3 blend = pow(abs(Ng), vec3(5.0)); blend /= (blend.x + blend.y + blend.z);

float q1 = vnoise(P * 0.11 + 3.0);
float q2 = vnoise(P * 0.23 - 7.0);
float upness = Ng.y;
float below = uWaterY - P.y;

// 砂：上向きの面で水位に近い所ほど堆積
float nS = vnoise(P * 0.9);
float wS = smoothstep(0.50 + 0.18 * nS, 0.86, upness) * (1.0 - smoothstep(0.6, 3.2, P.y - uWaterY + 1.5 * nS));

// 岩の種類の混合（明るいクリーム色の石灰岩を主に、暗いしみと暖色の層を混ぜる）
float band = 0.5 + 0.5 * sin(P.y * 1.6 + 4.0 * q1);
float wA = mix(0.42, 1.0, smoothstep(0.42, 0.68, q1 + 0.15 * (q2 - 0.5)));
float wC = smoothstep(0.4, 0.65, q2 + 0.25 * band) * 0.5;
float wB = max(0.0, 1.0 - wA - wC) * 0.6;
float wsum = wA + wB + wC + 1e-4;
wA /= wsum; wB /= wsum; wC /= wsum;

TP rA, rB, rC, rS;
rA.alb = vec3(0.0); rA.nrm = Ng; rA.rough = 0.0;
rB = rA; rC = rA; rS = rA;
if (wA * (1.0 - wS) > 0.01) rA = triplanar(tA_a, tA_n, P, Ng, blend, 0.33);
if (wB * (1.0 - wS) > 0.01) rB = triplanar(tB_a, tB_n, P, Ng, blend, 0.27);
if (wC * (1.0 - wS) > 0.01) rC = triplanar(tC_a, tC_n, P, Ng, blend, 0.30);
if (wS > 0.01) rS = triplanar(tS_a, tS_n, P, Ng, blend, 0.55);

vec3 albRock = rA.alb * wA + rB.alb * wB + rC.alb * wC;
vec3 nrmRock = normalize(rA.nrm * wA + rB.nrm * wB + rC.nrm * wC);
float rghRock = rA.rough * wA + rB.rough * wB + rC.rough * wC;

vec3 albedo = mix(albRock, rS.alb * vec3(1.18, 1.12, 1.0), wS);
vec3 wnrm = normalize(mix(nrmRock, rS.nrm, wS));
float rgh = mix(rghRock, rS.rough, wS);

// 石灰岩らしく明るい暖色へ寄せる
albedo *= vec3(1.22, 0.98, 0.80) * 0.95;

// 縦の汚れ（雨だれ）
float streak = vnoise(vec3(P.x * 2.3, P.y * 0.22, P.z * 2.3));
albedo *= mix(0.72, 1.1, smoothstep(0.25, 0.75, streak));

// 水際：濡れ・藻
float wetDist = P.y - uWaterY;
float wet = 1.0 - smoothstep(0.0, 1.3 + 0.8 * q1, wetDist);
float algae = smoothstep(-0.9, -0.2, wetDist) * (1.0 - smoothstep(0.1, 0.9, wetDist + 0.5 * q2));
albedo = mix(albedo, albedo * vec3(0.30, 0.34, 0.16), algae * 0.65);
albedo *= mix(1.0, 0.52, wet);
// 水中は清潔で明るい
albedo *= mix(1.0, 1.12, smoothstep(0.0, 1.0, below));

// 天窓の近くは苔・植物
float gd = length(P - uHole);
float green = smoothstep(9.0, 2.0, gd) * smoothstep(9.0, 14.0, P.y) * (0.25 + 0.75 * smoothstep(0.4, 0.75, vnoise(P * 0.6)));
albedo = mix(albedo, vec3(0.10, 0.19, 0.04) + 0.04 * albedo, clamp(green, 0.0, 0.7));

// 中周波の凹凸（メッシュでは表せない 5〜60cm のしわ）
{
  vec3 bp = P * 3.1;
  float e = 0.15;
  float b0 = vnoise(bp) * 0.6 + vnoise(bp * 2.3 + 5.0) * 0.4;
  vec3 gb = vec3(
    vnoise(bp + vec3(e,0,0)) * 0.6 + vnoise((bp + vec3(e,0,0)) * 2.3 + 5.0) * 0.4 - b0,
    vnoise(bp + vec3(0,e,0)) * 0.6 + vnoise((bp + vec3(0,e,0)) * 2.3 + 5.0) * 0.4 - b0,
    vnoise(bp + vec3(0,0,e)) * 0.6 + vnoise((bp + vec3(0,0,e)) * 2.3 + 5.0) * 0.4 - b0) / e;
  gb -= Ng * dot(gb, Ng);
  wnrm = normalize(wnrm - gb * 0.22 * (1.0 - wS * 0.7));
  albedo *= 0.88 + 0.24 * b0;
}
diffuseColor.rgb = albedo;
`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
float roughnessFactor = clamp(rgh * 1.0 + 0.12, 0.2, 1.0);
roughnessFactor = mix(roughnessFactor, 0.28, wet * 0.75);
roughnessFactor = mix(roughnessFactor, 0.55, smoothstep(0.0, 1.0, below) * 0.5);
`
      )
      .replace('#include <normal_fragment_maps>', `normal = normalize((viewMatrix * vec4(wnrm, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${WATER_FILL_GLSL}`)
      .replace(
        '#include <aomap_fragment>',
        /* glsl */ `
float ambientOcclusion = 0.3 + 0.7 * pow(vAO, 1.3);
reflectedLight.indirectDiffuse *= ambientOcclusion;
reflectedLight.directDiffuse *= mix(1.0, vAO, 0.25);
#if defined( USE_ENVMAP ) && defined( STANDARD )
float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
#endif
`
      );
  };
  return mat;
}
