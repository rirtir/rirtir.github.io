// 苔灯の境 / MOSSLIGHT — 空・太陽・月・暗さ(純関数。DOM・描画に依存しない)
// 時計: ui.js の表示と同じ式。hour = (6 + (clock mod 600) / 25) mod 24。1時間 = 25秒、06:00 が tod 0。
// 太陽は 06:00〜18:00 の昼弧(仰角 asin(sin62°·sin(π(h−6)/12)))。18:00〜06:00 の仰角は負で、太陽の寄与は厳密に 0。
// 明るさは「灰色128・水平な地面・影なし・局所光なし」の板(plate)の sRGB 表示値を時刻キーで指定し、
// そこから 空の環境光(sky)・太陽の平行光・月の平行光 を分解して作る。分解しても板の値は定義どおりに戻る。
// 値は linear(sRGB の ^2.2)。lighting.js のシェーダと同じ式で板の値を再計算できる(plateDisplay)。
import { BALANCE } from './data.js';

export const DAY_TICKS = 600;
const RAD = Math.PI / 180;
const SUN_MAX_ELEV = 62 * RAD;     // 昼弧の最大仰角
const SUN_SOUTH_BIAS = 0.35;       // 太陽の方位を画面の南(下)へ少し寄せる。正面の面がいつも少し照らされる
const MOON_ELEV = 35 * RAD;
const MOON_DIR2 = norm2([-0.3, 1]);
const SHADOW_MAX_LEN = 2.5;        // 高さ1pxあたりの影の長さの上限
const ALBEDO_GRAY = Math.pow(128 / 255, 2.2);

function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const smoothstep = (a, b, x) => smooth((x - a) / (b - a));
const lin = (v) => Math.pow(clamp(v / 255), 2.2);
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/* ------------------------------------------------------------------ 時計 */
export function hourOf(clock) {
  const t = ((clock % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  return (6 + t / 25) % 24;
}

// 時刻の区分(BALANCE.day と同じ表)。敵の出現・睡眠・BGM が同じ窓を使う
export function phaseOf(clock) {
  const D = BALANCE.day, t = ((clock % D.length) + D.length) % D.length;
  if (t < D.dawn[1]) return 'dawn';
  if (t < D.day[1]) return 'day';
  if (t < D.dusk[1]) return 'dusk';
  if (t < D.night[1]) return 'night';
  return 'predawn';
}
export function isNightClock(clock) {
  const D = BALANCE.day, t = ((clock % D.length) + D.length) % D.length;
  return t >= D.night[0] && t < D.night[1];
}
export function canSleepClock(clock) {
  const D = BALANCE.day, t = ((clock % D.length) + D.length) % D.length;
  return t >= D.sleepFrom;
}

/* ------------------------------------------------------------------ 板の目標値(sRGB表示値) */
// [時, [R,G,B]]  灰色128のアルベド・N=(0,0,1)・影なしの板が、その時刻に画面へ出る値。間は表示値の線形補間
export const PLATE_KEYS = [
  [0, [5, 6, 9]], [4, [5, 6, 9]], [5, [7, 8, 12]], [5.5, [18, 15, 27]], [6, [38, 34, 46]], [6.5, [84, 66, 56]],
  [7, [104, 92, 84]], [8, [124, 118, 112]], [9, [134, 134, 132]], [12, [138, 138, 136]], [15, [136, 134, 128]],
  [16, [124, 118, 108]], [17, [126, 92, 60]], [17.5, [96, 66, 46]], [18, [60, 40, 32]], [18.5, [24, 24, 36]],
  [19, [14, 15, 24]], [20, [8, 9, 15]], [21, [6, 7, 10]], [22, [5, 6, 9]], [24, [5, 6, 9]],
];

export function plateTarget(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < PLATE_KEYS.length - 2 && h > PLATE_KEYS[i + 1][0]) i++;
  const [h0, a] = PLATE_KEYS[i], [h1, b] = PLATE_KEYS[i + 1];
  const t = clamp((h - h0) / (h1 - h0));
  return [0, 1, 2].map((k) => lerp(a[k], b[k], t));
}

const toPlateLin = (disp) => disp.map((d) => lin(d) / ALBEDO_GRAY);
const NOON_LUM = lum(toPlateLin(plateTarget(12)));

/* ------------------------------------------------------------------ 太陽・月の向きと色 */
export function sunElevation(hour) {
  const s = SUN_MAX_ELEV === 0 ? 0 : Math.sin(Math.PI * (hour - 6) / 12) * Math.sin(SUN_MAX_ELEV);
  return Math.asin(clamp(s, -1, 1));
}

// 画面座標(x右・y下=南)での「太陽へ向かう」水平方向。06時=東、12時=南、18時=西。南へ少し寄せる
export function sunAzimuth2(hour) {
  const phi = Math.PI * (12 - hour) / 12;
  return norm2([Math.sin(phi), Math.cos(phi) + SUN_SOUTH_BIAS]);
}

const SUN_CHROMA = [ // [仰角deg, 色相の比]  低い太陽ほど赤い
  [0, [1, 0.30, 0.10]], [4, [1, 0.38, 0.14]], [9, [1, 0.55, 0.28]], [18, [1, 0.80, 0.58]], [35, [1, 0.94, 0.82]], [60, [1, 0.97, 0.90]],
];
function sunChroma(elevDeg) {
  if (elevDeg <= SUN_CHROMA[0][0]) return SUN_CHROMA[0][1].slice();
  for (let i = 1; i < SUN_CHROMA.length; i++) {
    if (elevDeg <= SUN_CHROMA[i][0]) {
      const [e0, a] = SUN_CHROMA[i - 1], [e1, b] = SUN_CHROMA[i];
      const t = (elevDeg - e0) / (e1 - e0);
      return [0, 1, 2].map((k) => lerp(a[k], b[k], t));
    }
  }
  return SUN_CHROMA[SUN_CHROMA.length - 1][1].slice();
}
const MOON_CHROMA = [0.55, 0.68, 1.0];

// 月の出ている強さ。19:30〜21:00 に上がり、03:30〜04:30 に下がる
export function moonEnvelope(hour) {
  const h = hour < 12 ? hour + 24 : hour; // 12..36
  return smoothstep(19.5, 21, h) * (1 - smoothstep(27.5, 28.5, h));
}

/* ------------------------------------------------------------------ 空の状態 */
// 戻り値(linear): sun.{dir,color,vis,elevDeg} 月 moon.{dir,color,vis} 空 sky(半球の環境光) 板 plate
// shadow.{vec,strength,caster}: 影を落とす光は太陽(vis>0)か月のどちらか1つ。vec は高さ1pxあたりの画面上の影の変位
// amb/warm: 旧 ambientLight 互換(0.35..1 と暖色度)。mood: 区分と暗さ・暖色の説明(描画には使わない)
export function skyAt(hour, mapId = 'surface', opt = {}) {
  const D = BALANCE.day;
  hour = ((hour % 24) + 24) % 24;
  if (mapId === 'underground') {
    const lift = opt.arenaLift || 0;
    const level = 0.035 + lift * 0.2;
    const sky = [0.62, 0.82, 1.25].map((c) => c * level);
    return {
      hour, mapId, underground: true,
      sun: { dir: [0, 0, 1], color: [0, 0, 0], vis: 0, elevDeg: -90, up: false },
      moon: { dir: [0, 0, 1], color: [0, 0, 0], vis: 0, up: false },
      sky, plate: sky.slice(), shadow: { vec: [0, 0], strength: 0, caster: 'none' },
      amb: D.caveLight, warm: 0, dark: 1, dayness: 0,
      mood: { phase: 'cave', warm: 0, night: 1 },
    };
  }
  const plateDisp = plateTarget(hour);
  const P = toPlateLin(plateDisp);
  const lumP = lum(P);

  // 太陽
  const e = sunElevation(hour), eDeg = e / RAD, sinE = Math.sin(e);
  const vis = smoothstep(0, 5, eDeg);
  const az = sunAzimuth2(hour);
  const sunDir = [Math.cos(e) * az[0], -Math.cos(e) * az[1], sinE];
  const chroma = sunChroma(Math.max(0, eDeg));
  const frac = lerp(0.42, 0.62, smoothstep(5, 30, eDeg)) * (vis > 0 ? 1 : 0);
  const cl = lum(chroma);
  const sinEff = Math.max(sinE, 0.06);
  const sunPart = [0, 1, 2].map((k) => Math.min(frac * vis * lumP * chroma[k] / cl, 0.8 * P[k]));
  const sunColor = vis > 0 ? sunPart.map((c) => c / (vis * sinEff)) : [0, 0, 0];

  // 月
  const mEnv = moonEnvelope(hour);
  const mAz = MOON_DIR2;
  const moonDir = [Math.cos(MOON_ELEV) * mAz[0], -Math.cos(MOON_ELEV) * mAz[1], Math.sin(MOON_ELEV)];
  const mcl = lum(MOON_CHROMA);
  const moonPart = [0, 1, 2].map((k) => Math.min(0.6 * mEnv * lumP * MOON_CHROMA[k] / mcl, 0.8 * (P[k] - sunPart[k])));
  const moonColor = mEnv > 0 ? moonPart.map((c) => c / Math.sin(MOON_ELEV)) : [0, 0, 0];

  // 半球の環境光は残り。板(N上向き)で sky + sun·sinE·vis + moon·sin(35°) = plate
  // sun.color は vis·max(sinE,0.06) で割ってあるので、板への実寄与は sunColor·sinE·vis(sinE<0.06 では sunPart より小さい)
  const sky = [0, 1, 2].map((k) => Math.max(0, P[k] - sunColor[k] * sinE * vis - moonPart[k]));

  // 影: 太陽が出ている間は太陽、それ以外は月
  const sunUp = vis > 0.02, moonUp = mEnv > 0.02;
  let shadow = { vec: [0, 0], strength: 0, caster: 'none' };
  if (sunUp) {
    const d = az, t = Math.tan(Math.max(eDeg, 9) * RAD);
    let vx = -d[0] / t, vy = -d[1] / t;
    const l = Math.hypot(vx, vy);
    if (l > SHADOW_MAX_LEN) { vx *= SHADOW_MAX_LEN / l; vy *= SHADOW_MAX_LEN / l; }
    shadow = { vec: [vx, vy], strength: 0.75 * vis * (0.4 + 0.6 * smoothstep(4, 14, eDeg)), caster: 'sun' };
  } else if (moonUp) {
    const t = Math.tan(MOON_ELEV);
    shadow = { vec: [-mAz[0] / t, -mAz[1] / t], strength: 0.45 * mEnv, caster: 'moon' };
  }

  // 旧互換: 0.35(夜)..1(昼)。9〜15時で 1。warm は朝夕の赤み
  const dayness = clamp(lumP / (NOON_LUM * 0.85));
  const amb = D.nightLight + (1 - D.nightLight) * dayness;
  const warm = clamp(((P[0] - P[2]) / Math.max(1e-6, P[0] + P[2])) * 1.4) * smoothstep(0.004, 0.08, lumP);
  const dark = 1 - clamp(lumP / 0.06);
  const phase = eDeg > 8 ? 'day' : eDeg > -1 ? (hour < 12 ? 'sunrise' : 'sunset') : lumP > 0.02 ? 'twilight' : 'night';
  return {
    hour, mapId, underground: false,
    sun: { dir: sunDir, color: sunColor, vis, elevDeg: eDeg, up: sunUp },
    moon: { dir: moonDir, color: moonColor, vis: mEnv, up: moonUp },
    sky, plate: P, plateDisplay: plateDisp, shadow, amb, warm, dark, dayness,
    mood: { phase, warm, night: dark },
  };
}

/* ------------------------------------------------------------------ 検証用: シェーダと同じ式の再計算(影・局所光なし) */
const toSrgb8 = (v) => Math.round(255 * Math.pow(clamp(v), 1 / 2.2));
// 半球の空 sky·(0.7+0.3·Nz) + sun·max(0,N·Ls)·vis + moon·max(0,N·Lm)·moonVis。albedoSrgb は 0..255 の3値
export function shadeDisplay(sky, albedoSrgb, N = [0, 0, 1], opt = {}) {
  const a = albedoSrgb.map(lin);
  const dotL = (L) => Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
  const sunS = opt.sunShadow == null ? 1 : opt.sunShadow;
  const hemi = 0.7 + 0.3 * N[2];
  return [0, 1, 2].map((k) => toSrgb8(a[k] * (
    sky.sky[k] * hemi + sky.sun.color[k] * dotL(sky.sun.dir) * sky.sun.vis * sunS + sky.moon.color[k] * dotL(sky.moon.dir)
  )));
}
export function plateDisplay(sky) { return shadeDisplay(sky, [128, 128, 128]); }
export function plateMean(sky) { const d = plateDisplay(sky); return (d[0] + d[1] + d[2]) / 3; }

/* ------------------------------------------------------------------ 2D fallback: 暗幕の色と alpha */
// 2D 照明は「元の絵(昼の見た目)」に暗幕を重ねる。昼の板に対する各色の比で、alpha ≤ 0.97
export function curtain2D(sky) {
  if (sky.underground) return { color: [5, 9, 20], alpha: 0.9 };
  const now = sky.plateDisplay, noon = plateTarget(12);
  const ratio = [0, 1, 2].map((k) => clamp(now[k] / noon[k], 0, 1));
  const mean = (ratio[0] + ratio[1] + ratio[2]) / 3;
  const alpha = Math.min(0.97, 1 - mean);
  if (alpha <= 0.001) return { color: [0, 0, 0], alpha: 0 };
  const base = 110;
  const color = ratio.map((r) => Math.max(0, Math.min(255, Math.round(base * (r - (1 - alpha)) / alpha))));
  return { color, alpha };
}
