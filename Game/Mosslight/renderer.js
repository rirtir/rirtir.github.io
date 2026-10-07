// 苔灯の境 / MOSSLIGHT — 描画
// 依存: data.js, world.js。ピクセルを保つため、世界は整数倍率(デバイスピクセル単位)で描く。
// 光: WebGL2が使えれば native解像度の color/normal/height を lighting.js で合成する。使えない時は1/4解像度のCanvasを平滑化して重ねる従来の光(lightPass)。
import { BALANCE, TILE, TERRAIN as T, TERRAIN_INFO, NODES, STRUCTURES, ITEMS, CROPS, WALL_NODE, nodeMirrored, baseSprite } from './data.js';
import { hash2, nodeAt, groundDetail, arenaScenery, shoreScenery, nodeFootprint } from './world.js';
import { createLighting, MAX_PT, PT_HALF } from './lighting.js';
import { hourOf, skyAt, curtain2D, plateDisplay } from './sky.js';
import * as Ground from './ground.js';

const P = BALANCE.player;

/* ================================================================== 実行時の切替(VISUAL_REWORK3)。値は getVisualStats().toggles で読め、setVisualToggle で変えられる */
// 旧資産への移行期間だけの切替を含む。「アルベドの焼き込み光を補正した」わけではない: legacyGain は旧資産の gain 値(焼き込み光を弱める)を使うか。
const DEFAULT_TOGGLES = {
  skyModel: true,          // sky.js の時刻モデル(false: 旧 ambientLight の明るさ。GL の sky/sun は旧式)
  projectedShadows: true,  // 太陽・月・局所光(最大 MAX_PT 灯)の地面投影影(影バッファ)
  pointShadows: true,      // projectedShadows のうち局所光(たいまつ・焚き火・腰の灯)の影だけを切る
  groundChunks: true,      // ground.js の有機的マスクで地面を合成(false: 旧タイル+edge。旧 edge の白縁が戻る)
  groundScatter: true,     // 地面の細かな散らし(拾えない)
  mirrorNatural: true,     // 木・岩・茂みなどの決定的な左右反転(法線Nxも反転)
  legacyGain: true,        // 旧資産の gain(B チャンネル)で焼き込み光を弱める。中立なアルベドの資産が入ったら false を試す
  handLight: true,         // 暗い間の主人公の小さな手提げ灯(夜の free な大きな光の代わり)
  footDebug: false,        // 足元の楕円とクリック範囲の重ね表示
  legacyDetailDensity: 0.4, // 旧 details/deco 飾りを描く割合(0..1)。新しい散らしがあるので減らす
};

/* ================================================================== アセット */
const DEFAULT_SHEETS = {
  tiles: { image: 'tiles/atlas.png', atlas: 'tiles/atlas.json', pivot: [0, 0] },
  props: { image: 'props/atlas.png', atlas: 'props/atlas.json', pivot: [48, 80] },
  actors: { image: 'actors/atlas.png', atlas: 'actors/atlas.json', pivot: [16, 40] },
  icons: { image: 'icons/atlas.png', atlas: 'icons/atlas.json', pivot: [12, 12] },
};
const SHEET_SIZE = { tiles: [32, 32, 0, 0], props: [96, 96, 48, 80], actors: [32, 48, 16, 40], icons: [24, 24, 12, 12] };
const PLACEHOLDER_TILE = {
  grass: '#3d5940', darkgrass: '#304936', dirt: '#765937', sand: '#b18b53', cave: '#39434e', moss: '#243932', ruin: '#505c67',
  water: '#335766', deepwater: '#244356', farmland: '#443831', path: '#977142',
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`画像を読み込めません: ${url}`));
    im.src = url;
  });
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 2x2を1ピクセルへ。ブロック内の平均色にもっとも近い不透明ピクセルを選ぶ(線が崩れにくい)
function halve(src) {
  const w = src.width, h = src.height, nw = Math.ceil(w / 2), nh = Math.ceil(h / 2);
  const out = newCanvas(nw, nh);
  const octx = out.getContext('2d');
  try {
    const data = src.getContext('2d').getImageData(0, 0, w, h).data;
    const od = octx.createImageData(nw, nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let cnt = 0, ar = 0, ag = 0, ab = 0;
        const px = [];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = x * 2 + dx, sy = y * 2 + dy;
            if (sx >= w || sy >= h) continue;
            const i = (sy * w + sx) * 4;
            if (data[i + 3] >= 128) { px.push(i); ar += data[i]; ag += data[i + 1]; ab += data[i + 2]; cnt++; }
          }
        }
        if (cnt < 2) continue;
        ar /= cnt; ag /= cnt; ab /= cnt;
        let best = px[0], bd = Infinity;
        for (const i of px) {
          const d = (data[i] - ar) ** 2 + (data[i + 1] - ag) ** 2 + (data[i + 2] - ab) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        const o = (y * nw + x) * 4;
        od.data[o] = data[best]; od.data[o + 1] = data[best + 1]; od.data[o + 2] = data[best + 2]; od.data[o + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
  } catch (e) {
    octx.imageSmoothingEnabled = false;
    octx.drawImage(src, 0, 0, nw, nh);
  }
  return out;
}

function placeholderFrame(sheet, name) {
  const [w, h, px, py] = SHEET_SIZE[sheet] || [32, 32, 0, 0];
  const c = newCanvas(w, h), g = c.getContext('2d');
  const hue = Math.floor(hash2(name.length, name.charCodeAt(0) || 0, 5) * 360);
  if (sheet === 'tiles') {
    const base = name.replace(/\d+$/, '');
    g.fillStyle = PLACEHOLDER_TILE[base] || '#444';
    g.fillRect(0, 0, w, h);
  } else if (sheet === 'props') {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px - 16, py - 3, 32, 6);
    g.fillStyle = `hsl(${hue},35%,38%)`; g.fillRect(px - 14, py - 34, 28, 34);
    g.fillStyle = `hsl(${hue},40%,55%)`; g.fillRect(px - 14, py - 34, 28, 4);
  } else if (sheet === 'actors') {
    g.fillStyle = `hsl(${hue},40%,45%)`; g.fillRect(8, 14, 16, 26); g.fillStyle = '#edbc85'; g.fillRect(10, 6, 12, 10);
  } else {
    g.fillStyle = `hsl(${hue},40%,40%)`; g.fillRect(2, 2, w - 4, h - 4); g.fillStyle = `hsl(${hue},45%,62%)`; g.fillRect(4, 4, w - 8, 4);
  }
  return { img: c, x: 0, y: 0, w, h, px, py, placeholder: true, sheet, name };
}

function modKey(m) {
  return `${m.half ? 'h' : ''}|${m.tint ? m.tint.join(',') : ''}|${m.flip ? 'f' : ''}|${m.rot || 0}|${m.outline || ''}|${m.clayDots ? 'c' : ''}|${m.normalFlipY ? 'ny' : ''}`;
}

// 法線の左右反転: R=255-R(2Dのpixel readが必要。variantごとに1回だけ)。読めなければnullで平坦へ戻す
function flipNormalX(cv) {
  try {
    const g = cv.getContext('2d'), im = g.getImageData(0, 0, cv.width, cv.height), d = im.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]) d[i] = 255 - d[i];
    g.putImageData(im, 0, 0);
    return cv;
  } catch (e) { return null; }
}

// normal/height を持たないframeは、alphaシルエットに合わせた平坦値(normal 128,128,0 / height 0,200,128)を使う。旧bufferを透かさない
function flatLayer(fr, key, rgb) {
  let c = fr[key];
  if (!c) {
    c = newCanvas(fr.w, fr.h);
    const g = c.getContext('2d');
    g.drawImage(fr.img, fr.x, fr.y, fr.w, fr.h, 0, 0, fr.w, fr.h);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = rgb; g.fillRect(0, 0, fr.w, fr.h);
    fr[key] = c;
  }
  return c;
}

function buildVariant(base, m) {
  let w = base.w, h = base.h, px = base.px, py = base.py;
  let cv = newCanvas(w, h);
  cv.getContext('2d').drawImage(base.img, base.x, base.y, w, h, 0, 0, w, h);
  // normal/height: 同じ変形を重ねる。half・rotは対応が崩れるため平坦なフォールバックへ戻す。tint/clayDotsは色だけ
  const layer = (src) => {
    if (!src || m.half || m.rot) return null;
    const c = newCanvas(w, h);
    c.getContext('2d').drawImage(src, base.x, base.y, w, h, 0, 0, w, h);
    return c;
  };
  let ncv = layer(base.nimg), hcv = layer(base.himg);
  // 屋根の手前斜面は奥斜面と逆向き。色や位置を反転せず、面の向きだけを変える。
  if (m.normalFlipY && ncv) {
    const g = ncv.getContext('2d'), im = g.getImageData(0, 0, ncv.width, ncv.height);
    for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 3]) im.data[i + 1] = 255 - im.data[i + 1];
    g.putImageData(im, 0, 0);
  }
  if (m.half) {
    cv = halve(cv);
    w = cv.width; h = cv.height; px = Math.round(px / 2); py = Math.round(py / 2);
  }
  if (m.tint) {
    const g = cv.getContext('2d');
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = m.tint[1];
    g.fillStyle = m.tint[0];
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  if (m.clayDots) {
    const g = cv.getContext('2d');
    const cols = ['#d1aa68', '#b88a4a', '#edcd91'];
    for (let i = 0; i < 6; i++) {
      const dx = Math.floor(w * (0.25 + hash2(i, 3, 91) * 0.5)), dy = Math.floor(h * (0.45 + hash2(i, 4, 92) * 0.4));
      g.fillStyle = cols[i % 3];
      g.fillRect(dx, dy, 2, 1);
    }
  }
  if (m.rot) {
    const o = newCanvas(w, h), g = o.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(w / 2, h / 2); g.rotate((m.rot * Math.PI) / 2);
    g.drawImage(cv, -w / 2, -h / 2);
    cv = o;
  }
  if (m.flip) {
    const mirror = (src) => {
      const o = newCanvas(w, h), g = o.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.translate(w, 0); g.scale(-1, 1);
      g.drawImage(src, 0, 0);
      return o;
    };
    cv = mirror(cv); px = w - px;
    if (ncv) ncv = flipNormalX(mirror(ncv));
    if (hcv) hcv = mirror(hcv); // heightとgainは画素ごとの値なので、位置だけ反転すればよい
  }
  if (m.outline) {
    // 輪郭は元画像の4方向ずらし。normal/heightも同寸・同pivotにし、輪郭は平坦(normalのみ発光=gameplay表示)にする
    const ring = (rgb) => {
      const t = newCanvas(w + 2, h + 2), tg = t.getContext('2d');
      for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) tg.drawImage(cv, dx, dy);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = rgb; tg.fillRect(0, 0, w + 2, h + 2);
      return t;
    };
    const withRing = (src, rgb) => {
      const o = newCanvas(w + 2, h + 2), g = o.getContext('2d');
      g.drawImage(ring(rgb), 0, 0);
      g.drawImage(src, 1, 1);
      return o;
    };
    if (ncv) ncv = withRing(ncv, '#8080cc');
    if (hcv) hcv = withRing(hcv, '#00c880');
    cv = withRing(cv, m.outline); w += 2; h += 2; px += 1; py += 1;
  }
  // メタデータの座標も同じ変形に追従させる(half は半分、flip は左右、outline は +1)
  let meta = base.meta || null;
  if (meta) {
    const tf = ([x, y]) => {
      if (m.half) { x = Math.round(x / 2); y = Math.round(y / 2); }
      if (m.flip) x = (m.half ? Math.ceil(base.w / 2) : base.w) - x;
      if (m.outline) { x += 1; y += 1; }
      return [x, y];
    };
    const g = meta.grip && (Array.isArray(meta.grip[0]) ? meta.grip.map(tf) : tf(meta.grip));
    // feet は旧形式(side→[x,y,marker])と現形式(object: sole/ground は座標、lift は高さ)の両方を扱う
    const tfFoot = (pt) => {
      if (Array.isArray(pt)) return [...tf(pt), ...pt.slice(2)];
      if (!pt || typeof pt !== 'object') return pt;
      const o = { ...pt };
      for (const k of ['sole', 'ground']) if (Array.isArray(o[k])) o[k] = [...tf(o[k]), ...o[k].slice(2)];
      for (const k of ['lift', 'height', 'height_level', 'forward_offset']) if (m.half && Number.isFinite(o[k])) o[k] /= 2;
      if (Array.isArray(o.local)) {
        o.local = o.local.map(v => m.half ? v / 2 : v);
        if (m.flip) o.local[0] = -o.local[0];
      }
      return o;
    };
    const feet = meta.feet && (Array.isArray(meta.feet) || typeof meta.feet !== 'object' ? meta.feet
      : ('sole' in meta.feet || 'ground' in meta.feet) ? tfFoot(meta.feet)
        : Object.fromEntries(Object.entries(meta.feet).map(([side, pt]) => [side, tfFoot(pt)])));
    const walk = m.half && Number.isFinite(meta.walk_distance_per_frame) ? meta.walk_distance_per_frame / 2 : meta.walk_distance_per_frame;
    const lantern = meta.lantern && { ...meta.lantern };
    if (lantern) {
      for (const k of ['anchor', 'origin', 'planned_origin', 'glass_center']) if (lantern[k]) lantern[k] = tf(lantern[k]);
      if (lantern.glass_px) lantern.glass_px = lantern.glass_px.map(tf);
      if (m.half && Number.isFinite(lantern.glass_height)) lantern.glass_height /= 2;
      if (lantern.light_anchor) lantern.light_anchor = [...tf(lantern.light_anchor), lantern.light_anchor[2] * (m.half ? 0.5 : 1)];
    }
    meta = { ...meta, foot: meta.foot && tf(meta.foot), grip: g || null, head: meta.head && tf(meta.head), feet, lantern: meta.lantern === false ? false : lantern };
    if (walk !== undefined) meta.walk_distance_per_frame = walk;
  }
  return { img: cv, x: 0, y: 0, w, h, px, py, nimg: ncv || undefined, himg: hcv || undefined, meta };
}

function createAssets() {
  const a = {
    sheets: {}, failed: [], missing: new Set(), cache: new Map(), manifestLoaded: false,
    frame(sheet, name) { const s = a.sheets[sheet]; return s ? s.frames.get(name) || null : null; },
    has(sheet, name) { return !!a.frame(sheet, name); },
    get(sheet, name, mods) {
      let base = a.frame(sheet, name);
      if (!base) {
        const k = `${sheet}|${name}|ph`;
        base = a.cache.get(k);
        if (!base) { base = placeholderFrame(sheet, name); a.cache.set(k, base); a.missing.add(`${sheet}/${name}`); }
      }
      if (!mods || !Object.keys(mods).length) return base;
      const key = `${sheet}|${name}|${modKey(mods)}`;
      let v = a.cache.get(key);
      if (!v) { v = buildVariant(base, mods); a.cache.set(key, v); }
      return v;
    },
    // DOM用: アイコンの画像URLと切り出し位置
    iconInfo(name) {
      const s = a.sheets.icons;
      const f = s && s.frames.get(name);
      if (!f) return null;
      // 上書きされたフレームは元のアトラスのURL・寸法を使う(対象シートの旧アトラスではない)。MODなどsourceが無い場合だけシートへ戻す
      return { url: f.url || s.url, x: f.x, y: f.y, w: f.w, h: f.h, sheetW: f.sheetW || s.w, sheetH: f.sheetH || s.h };
    },
  };
  return a;
}

async function loadSheet(assets, key, def, base) {
  try {
    const atlasUrl = new URL(def.atlas, base), imgUrl = new URL(def.image, base);
    const [atlas, img] = await Promise.all([
      fetch(atlasUrl).then((r) => { if (!r.ok) throw new Error(`${atlasUrl.pathname} ${r.status}`); return r.json(); }),
      loadImage(imgUrl.href),
    ]);
    // 任意の normal/height(同寸の画像)。宣言されていて読めない/寸法違いなら `${key}:normal` などで記録し、そのレイヤーは平坦値へ戻す
    const layers = {};
    await Promise.all(['normal', 'height'].map(async (kind) => {
      const decl = def[kind];
      if (!decl) return;
      try {
        const im = await loadImage(new URL(typeof decl === 'string' ? decl : decl.image, base).href);
        if (im.naturalWidth !== img.naturalWidth || im.naturalHeight !== img.naturalHeight) throw new Error('元画像と寸法が違います');
        layers[kind] = im;
      } catch (err) {
        assets.failed.push(`${key}:${kind}`);
        console.warn(`[Mosslight] アセット「${key}」の${kind}を読み込めませんでした。平坦値で続行します。`, err.message);
      }
    }));
    const pivot = def.pivot || (atlas.meta && atlas.meta.pivot) || [0, 0];
    const frames = new Map();
    for (const [name, f] of Object.entries(atlas.frames || {})) {
      const r = f.frame || f;
      const pv = f.pivot || pivot;
      // 任意のメタデータ(フレーム → atlas.meta.frameMeta[name] → 無し)。座標はすべてフレーム内のpx(左上原点)。
      //   foot: [x,y] 足元の接地点(既定は pivot)。grip: [x,y] または手の位置の配列(握り位置)。head: [x,y] 頭頂。
      // 寸法・pivot・握り位置・歩幅は差し替えシート側が指定する。
      const fm = (atlas.meta && atlas.meta.frameMeta && atlas.meta.frameMeta[name]) || {};
      const meta = { foot: f.foot || fm.foot || null, grip: f.grip || fm.grip || null, head: f.head || fm.head || null,
        feet: f.feet || fm.feet || null, lantern: f.lantern ?? fm.lantern ?? null,
        walk_distance_per_frame: f.walk_distance_per_frame ?? fm.walk_distance_per_frame ?? null,
        gait_phase: f.gait_phase ?? fm.gait_phase ?? null };
      // url/sheetW/sheetH: フレーム自身の画像情報。overrides で別シートへ接続されてもCSS側が正しい画像を指せる
      frames.set(name, {
        img, x: r.x, y: r.y, w: r.w, h: r.h, px: pv[0], py: pv[1], duration: f.duration || 140, sheet: key, name,
        url: imgUrl.href, sheetW: img.naturalWidth, sheetH: img.naturalHeight, nimg: layers.normal, himg: layers.height,
        meta: Object.values(meta).some(v => v != null) ? meta : null,
      });
    }
    assets.sheets[key] = { key, img, w: img.naturalWidth, h: img.naturalHeight, frames, pivot, url: imgUrl.href };
  } catch (err) {
    assets.failed.push(key);
    console.warn(`[Mosslight] アセット「${key}」を読み込めませんでした。代替表示で続行します。`, err.message);
  }
}

// manifest.json を基準にURLを解決する。manifestが無い場合は契約どおりの既定パスを試す
export async function loadAssets(url = 'assets/manifest.json') {
  const base = new URL(url, document.baseURI);
  let manifest = null;
  try {
    const res = await fetch(base);
    if (res.ok) manifest = await res.json();
  } catch (e) { /* 既定パスで続行 */ }
  const assets = createAssets();
  assets.manifestLoaded = !!manifest;
  const defs = manifest && manifest.sheets ? manifest.sheets : DEFAULT_SHEETS;
  // 多数の色・法線・高さ画像を一斉に取得して通信バッファを使い切らない。
  const entries = Object.entries(defs);
  for (let i = 0; i < entries.length; i += 6) {
    await Promise.all(entries.slice(i, i + 6).map(([key, def]) => loadSheet(assets, key, def, base)));
  }
  // 原画を差し替えたシートを既存のアセット名へ接続する。UIとゲームの参照名を維持する。
  for (const [key, def] of Object.entries(defs)) {
    if (!def.overrides || !assets.sheets[key] || !assets.sheets[def.overrides]) continue;
    for (const [name, frame] of assets.sheets[key].frames) assets.sheets[def.overrides].frames.set(name, frame);
  }
  return assets;
}

/* ================================================================== 光・時間 */
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// 旧互換: 環境光(0.35..1)と、夕暮れ・夜明けの暖色度。値は sky.js の時刻モデルから(昼 9〜15時=1、夜=nightLight、地下=caveLight)。
// GL の明るさはこの値ではなく skyAt() の sky/sun/moon で決まる。flies などの演出量だけがこれを使う
export function ambientLight(clock, mapId) {
  const s = skyAt(hourOf(clock), mapId);
  return { amb: s.amb, warm: s.warm };
}

/* ================================================================== レンダラー */
// 手持ち道具: props の tool_<種類>_<素材>_<0..2>(32x32, pivot16,24=握り位置)。tierは1=石,2=銅,3=翠鉄
const TOOL_TIER_NAME = ['', 'stone', 'copper', 'iron'];
const TOOL_KIND = { axe: 'axe', pick: 'pick', hoe: 'pick' };
// 構え・振り・振り切りの握り位置(ヒーロー足元基準)。手の位置に合わせる
const GRIP_POS = {
  right: [[7, -22], [12, -13], [6, -16]], left: [[-8, -22], [-13, -13], [-7, -16]],
  down: [[6, -20], [8, -9], [-2, -13]], up: [[6, -25], [8, -27], [5, -20]],
};
// 洞窟壁: wallKind → 前面フレーム名。採掘できない種類・鉱石は常に前面を描く
const WALL_FACE = { 1: 'cavewall_face', 2: 'cavewall_face', 3: 'copperwall_face', 4: 'ironwall_face', 5: 'ruinwall_face', 6: 'ruinwall_face', 7: 'ruinwall_face' };
const WALL_ALWAYS_FACE = new Set([3, 4, 5, 6, 7]);
// 要求ツルハシ段階(hardness)ごとの印の色と、ひびの色(石=灰 / 銅=橙 / 翠鉄=緑)
const TIER_COLOR = ['#91a0a2', '#b9c3c4', '#e0905a', '#78e0b0'];
const DIR_SET = new Set(['down', 'up', 'left', 'right']);

export function createRenderer(canvas, assets) {
  const visCtx = canvas.getContext('2d', { alpha: false });
  let ctx = visCtx; // GL照明中のシーン描画だけ colorCtx へ差し替える
  // GL用のnative解像度シーン: color / normal / height。transformは(1,0,0,1,-camX,-camY)でblitが3枚へ同じ位置に描く
  const colorCv = newCanvas(8, 8), colorCtx = colorCv.getContext('2d', { alpha: false });
  const normalCv = newCanvas(8, 8), nctx = normalCv.getContext('2d', { alpha: false });
  const heightCv = newCanvas(8, 8), hctx = heightCv.getContext('2d', { alpha: false });
  let layered = false;
  const MAX_GL_W = 960, MAX_GL_H = 540;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const LS = {
    mode: 'auto', active: '2d', debug: 'off', reason: 'init', lights: 0, culled: 0, steps: 0, w: 0, h: 0, device: { w: 0, h: 0 },
    ms: { scene: 0, upload: 0, gl: 0, copy: 0 }, glErrors: 0, errorCount: 0, contextLost: false, sunStrength: 0, moonStrength: 0,
    hour: 0, sunDir: [0, 0, 0], sky: null, shadow: { kind: 'none', strength: 0, vec: [0, 0], casters: 0, drawn: 0, skipped: 0, w: 0, h: 0, ms: 0, scale: 1, uploadBytes: 0, projected: false },
    slow: false, slowRuns: 0, samples: [],
  };
  let lighting = null, lightingTried = false, occBuf = null;
  const lightCv = newCanvas(8, 8), lctx = lightCv.getContext('2d');
  const glowCv = newCanvas(8, 8), gctx = glowCv.getContext('2d');
  const vigCv = newCanvas(8, 8);
  const R = {
    scaleSetting: 'auto', scale: 3, devW: 1, devH: 1, viewW: 1, viewH: 1,
    camX: 0, camY: 0, drawCamX: 0, drawCamY: 0, camReady: false, snap: true,
    t: 0, particles: [], flies: [], emberAcc: 0, fade: new WeakMap(), roofFade: new Map(), shadows: new Map(),
    rendered: 0, arenaLift: 0,
  };
  const lights = [];
  const sortList = [];

  /* ---------- VISUAL_REWORK3 の状態 ---------- */
  const TOG = { ...DEFAULT_TOGGLES };
  // 影バッファ(太陽/月 と 局所光1灯)。desktop は native 解像度、coarse(タッチ)は半解像度。canvas は alpha なし(0=遮る物なし)
  const SHADOW_SCALE = coarse ? 0.5 : 1;
  const MAX_CASTERS = 192;
  const shCv = newCanvas(8, 8), shCtx = shCv.getContext('2d', { alpha: false });
  const shpCv = newCanvas(8, 8), shpCtx = shpCv.getContext('2d', { alpha: false });
  // 遮る物の記録: sortList の描画中に drawFrame が height 画像の切り出しを積む。要素は使い回し(フレームごとに確保しない)
  const casters = [];
  let capOn = false, capFoot = 0, capN = 0;
  const SH = { casters: 0, drawn: 0, skipped: 0, w: 0, h: 0, bytes: 0, ms: 0, kind: 'none', point: false, vec: [0, 0], strength: 0 };
  const VS = { sky: null, hour: 0, clock: 0, mapId: 'surface', ground: { chunks: 0, baked: 0, bakeMs: 0, lastBakeMs: 0, pending: 0, fallback: 0, failed: false, scatter: 0, debug: 0 } };
  const GR = { cache: null, tex: null, texKey: '', failed: false, debug: 0, sig: new Map(), provider: null, scatterProvider: null, bakedThisFrame: 0 };
  const MATERIAL_OF_TERRAIN = TERRAIN_INFO.map((i) => Ground.materialIndex(i.tile));

  /* ---------- サイズ・倍率 ---------- */
  function computeScale() {
    const long = Math.max(R.devW, R.devH), short = Math.min(R.devW, R.devH);
    let s = R.scaleSetting === 'auto' ? Math.floor(Math.min(long / (TILE * 20), short / (TILE * 11))) : Number(R.scaleSetting);
    if (!(s >= 1)) s = 1;
    R.scale = Math.min(8, Math.floor(s));
    R.viewW = R.devW / R.scale;
    R.viewH = R.devH / R.scale;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || window.innerWidth, ch = canvas.clientHeight || window.innerHeight;
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    R.devW = w; R.devH = h;
    computeScale();
    const lw = Math.max(2, Math.ceil(w / 4)), lh = Math.max(2, Math.ceil(h / 4));
    for (const c of [lightCv, glowCv, vigCv]) { c.width = lw; c.height = lh; }
    const g = vigCv.getContext('2d');
    const grad = g.createRadialGradient(lw / 2, lh / 2, Math.min(lw, lh) * 0.35, lw / 2, lh / 2, Math.hypot(lw, lh) * 0.55);
    grad.addColorStop(0, 'rgba(4,8,6,0)');
    grad.addColorStop(1, 'rgba(4,8,6,0.36)');
    g.clearRect(0, 0, lw, lh);
    g.fillStyle = grad; g.fillRect(0, 0, lw, lh);
    R.snap = true;
  }

  function setScale(v) { R.scaleSetting = v === 'auto' || !v ? 'auto' : Number(v); computeScale(); R.snap = true; }

  /* ---------- 座標変換(clientX/clientYとやり取りする) ---------- */
  function screenToWorld(px, py) {
    const r = canvas.getBoundingClientRect();
    const kx = canvas.width / (r.width || 1), ky = canvas.height / (r.height || 1);
    return { x: ((px - r.left) * kx) / R.scale + R.drawCamX, y: ((py - r.top) * ky) / R.scale + R.drawCamY };
  }
  function worldToScreen(x, y) {
    const r = canvas.getBoundingClientRect();
    const kx = (r.width || 1) / canvas.width, ky = (r.height || 1) / canvas.height;
    return { x: r.left + (x - R.drawCamX) * R.scale * kx, y: r.top + (y - R.drawCamY) * R.scale * ky };
  }

  /* ---------- 描画ヘルパー ---------- */
  // frameの一部を描く。GL照明中は同じ位置・globalAlphaで normal/height にも描く(無ければ平坦値のシルエット)
  function drawFrame(fr, sx, sy, sw, sh, dx, dy) {
    ctx.drawImage(fr.img, fr.x + sx, fr.y + sy, sw, sh, dx, dy, sw, sh);
    if (!layered) return;
    if (capOn && fr.himg) recordCaster(fr, sx, sy, sw, sh, dx, dy);
    const a = ctx.globalAlpha;
    nctx.globalAlpha = a; hctx.globalAlpha = a;
    if (fr.nimg) nctx.drawImage(fr.nimg, fr.x + sx, fr.y + sy, sw, sh, dx, dy, sw, sh);
    else nctx.drawImage(flatLayer(fr, 'nflat', '#808000'), sx, sy, sw, sh, dx, dy, sw, sh);
    if (fr.himg) hctx.drawImage(fr.himg, fr.x + sx, fr.y + sy, sw, sh, dx, dy, sw, sh);
    else hctx.drawImage(flatLayer(fr, 'hflat', '#00c880'), sx, sy, sw, sh, dx, dy, sw, sh);
  }
  function blit(fr, x, y) { drawFrame(fr, 0, 0, fr.w, fr.h, x, y); }

  function recordCaster(fr, sx, sy, sw, sh, dx, dy) {
    if (capN >= MAX_CASTERS) { SH.skipped++; return; }
    const c = casters[capN] || (casters[capN] = { fr: null, sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, foot: 0 });
    c.fr = fr; c.sx = sx; c.sy = sy; c.sw = sw; c.sh = sh; c.dx = dx; c.dy = dy; c.foot = capFoot;
    capN++;
  }

  // 影を落とす物か。地面の小物・作物・落ちている物・屋根/床は落とさない(接地影の対象と同じ区分)。足元の y(影を傾ける軸)を返す。落とさないなら null
  function casterFoot(it) {
    if (it.kind === 3 || it.kind === 4 || it.kind === 5) return it.y;
    if (it.kind === 1) return STRUCTURES[it.ref.type].layer === 'floor' ? null : it.ref.y * TILE + 28;
    if (it.kind !== 0) return null;
    const n = it.ref, def = NODES[n.type];
    if (def.decor && !n.sprite) return null;
    if (n.type === 'border_pine' || n.type === 'branch' || n.type === 'pebble' || n.type === 'grass') return null;
    if (n.sprite === 'flowers' || n.sprite === 'blueflowers') return null;
    return nodeFootprint(n).y;
  }
  function prop(name, mods) { return assets.get('props', name, mods); }

  // 自然物の変種: `${name}_v1`,`_v2` が実在する時だけhashで選ぶ(左右反転は使わない)。無い名前は要求しない
  const variantNames = new Map();
  function pickVariant(name, a, b, salt) {
    let list = variantNames.get(name);
    if (!list) {
      list = [name];
      for (let i = 1; i < 3; i++) if (assets.has('props', `${name}_v${i}`)) list.push(`${name}_v${i}`);
      variantNames.set(name, list);
    }
    return list.length === 1 ? name : list[Math.floor(hash2(a, b, salt) * list.length)];
  }

  function shadowSprite(rx, ry) {
    const k = `${rx}|${ry}`;
    let c = R.shadows.get(k);
    if (c) return c;
    c = newCanvas(rx * 2 + 1, ry * 2 + 1);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(7,14,12,0.30)';
    for (let y = -ry; y <= ry; y++) {
      const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.5))));
      g.fillRect(rx - hw, ry + y, hw * 2 + 1, 1);
    }
    R.shadows.set(k, c);
    return c;
  }
  function drawShadow(x, y, rx, ry) {
    // 方向のある影は影バッファ(GL)が作る。GL では楕円を接触の遮蔽へ小さくする(二重の影を避ける)
    if (layered && TOG.projectedShadows && TOG.skyModel && !(VS.sky && VS.sky.underground)) { rx = Math.max(2, Math.round(rx * 0.45)); ry = Math.min(ry, 2); }
    // 2D 照明(GL を使わない時): 楕円を太陽/月の影の向きへずらして伸ばす。向き・強さは skyAt の shadow(夜・地下は向きなし)
    const sh = !layered && TOG.projectedShadows && TOG.skyModel && VS.sky && !VS.sky.underground ? VS.sky.shadow : null;
    if (sh && sh.strength > 0.001) {
      const len = Math.min(2.5, Math.hypot(sh.vec[0], sh.vec[1]));
      const reach = Math.min(10, Math.round(ry * 2.4 * len)), k = len > 0 ? reach / len : 0;
      x += sh.vec[0] * k; y += sh.vec[1] * k * 0.5;
      rx += Math.round(reach * 0.5);
    }
    ctx.drawImage(shadowSprite(rx, ry), Math.round(x) - rx, Math.round(y) - ry);
  }

  // 小物: 実行時の縮小(half)は使わず、`${name}_small` があればそれを原寸で描く。無い場合だけ従来の縮小へ戻す
  const SMALL_ALIAS = { log: ['branch_small'], rock: ['pebble_small'], fern: ['grass_small'] };
  function smallProp(name, mods, half) {
    if (!half) return prop(name, mods);
    for (const cand of [`${name}_small`, ...(SMALL_ALIAS[name] || [])]) {
      if (assets.has('props', cand)) {
        const m = { ...mods }; delete m.half;
        return prop(cand, Object.keys(m).length ? m : undefined);
      }
    }
    return prop(name, { ...mods, half: true });
  }

  /* ---------- 地形 ---------- */
  function terrainAt(map, x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return T.CLIFF;
    return map.terrain[y * map.w + x];
  }

  // 地面の変種数: 新groundは6種(`${地形}5`がある時)、旧アトラスは4種
  const variantCount = new Map();
  function variantsOf(base) {
    let n = variantCount.get(base);
    if (n == null) { n = assets.has('tiles', `${base}5`) ? 6 : 4; variantCount.set(base, n); }
    return n;
  }

  // 6種: 横は2ずつ・縦は3ずつ進める並びに、列と行ごとの0/1のずれを足す。
  // 上下左右の隣は必ず別の変種になり(横の差は1〜3、縦の差は2〜4)、どの変種も同じ頻度で出る
  function terrainVariant(name, tx, ty) {
    if (variantsOf(name) !== 6) return (tx & 1) + 2 * (ty & 1);
    const v = 2 * tx + Math.floor(hash2(tx, 0, 213) * 2) + 3 * ty + Math.floor(hash2(0, ty, 214) * 2);
    return ((v % 6) + 6) % 6;
  }

  const isWaterTile = (name) => name === 'water' || name === 'deepwater';
  // dual-gridの縁の名前。砂の下が水なら sand_water、草の下が砂だけなら grass_sand(草→土は grass の段差影)
  function edgeName(material, present) {
    if (material === 'sand' && (present.includes('water') || present.includes('deepwater'))) return 'sand_water';
    if (material === 'grass' && present.includes('sand') && !present.includes('dirt') && !present.includes('path')) return 'grass_sand';
    return material;
  }

  /* ---------- 水の深さ(見た目だけ): 岸の浅瀬帯・泡・最深部 ---------- */
  // 水マスから最も近い陸までの距離(8近傍、陸=0)。地形は変わらないのでマップごとに1回だけ求める
  const shoreDistCache = new WeakMap();
  function shoreDist(map) {
    let d = shoreDistCache.get(map);
    if (d) return d;
    d = new Uint8Array(map.w * map.h).fill(255);
    const q = [];
    for (let i = 0; i < d.length; i++) {
      const t = map.terrain[i];
      if (t !== T.SHALLOW && t !== T.DEEP) { d[i] = 0; q.push(i); }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % map.w, y = (i / map.w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const j = ny * map.w + nx;
        if (d[j] === 255) { d[j] = d[i] + 1; q.push(j); }
      }
    }
    shoreDistCache.set(map, d);
    return d;
  }

  // 岸に接する辺ごとに、A4の浅瀬帯(8〜12px、4px単位で幅が変わる)と、A6の泡(1px・約半分が途切れる)を描く。
  // 3マス以上沖はA1を重ねて最深部にする。辺の座標はマスをまたいで連続するので、隣のマスと帯が繋がる。
  // 砂の縁タイル(edge_sand_water)は後から重なるため、泡は縁の張り出し(最大5px)の外側に置く
  function drawWaterDepth(map, tx0, ty0, tx1, ty1) {
    const dist = shoreDist(map), W = map.w;
    const drift = [0, 1, 2, 1][Math.floor(R.t * 2.2) & 3];
    const water = (x, y) => x >= 0 && y >= 0 && x < W && y < map.h && dist[y * W + x] > 0;
    const shore = (x, y) => x >= 0 && y >= 0 && x < W && y < map.h && dist[y * W + x] === 0;
    for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
      if (!water(tx, ty)) continue;
      const X = tx * TILE, Y = ty * TILE;
      if (dist[ty * W + tx] >= 3) {
        const deepAt = (x, y) => water(x, y) && dist[y * W + x] >= 3;
        const iN = deepAt(tx, ty - 1) ? 0 : 8, iE = deepAt(tx + 1, ty) ? 0 : 8, iS = deepAt(tx, ty + 1) ? 0 : 8, iW = deepAt(tx - 1, ty) ? 0 : 8;
        ctx.globalAlpha = 0.4; ctx.fillStyle = '#0f2236';
        ctx.fillRect(X + iW, Y + iN, TILE - iW - iE, TILE - iN - iS);
        ctx.globalAlpha = 1;
      }
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        if (!shore(tx + dx, ty + dy)) continue;
        const horizontal = dy !== 0;
        for (let s = 0; s < TILE; s += 4) {
          const g = (horizontal ? tx : ty) * 8 + s / 4;
          const w = 8 + Math.floor(hash2(g >> 1, horizontal ? ty * 3 + dy : tx * 3 + dx, 340) * 5);
          const along = (horizontal ? X : Y) + s;
          const across = (d, len) => (d < 0 ? (horizontal ? Y : X) : (horizontal ? Y : X) + TILE - len);
          ctx.globalAlpha = 0.5; ctx.fillStyle = '#2f6476';
          if (horizontal) ctx.fillRect(along, across(dy, w), 4, w); else ctx.fillRect(across(dx, w), along, w, 4);
          // 泡: 8pxごとに3〜5pxだけ点く(約半分)。4コマで±2pxだけ往復し、形は変えない
          ctx.globalAlpha = 1; ctx.fillStyle = '#c8e0d6';
          for (let k = 0; k < 4; k++) {
            const shifted = g * 4 + k - drift, run = Math.floor(shifted / 8), pos = ((shifted % 8) + 8) % 8;
            const start = Math.floor(hash2(run, horizontal ? ty * 3 + dy : tx * 3 + dx, 341) * 4), len = 3 + Math.floor(hash2(run, 8, 342) * 3);
            if (pos < start || pos >= start + len) continue;
            if (horizontal) ctx.fillRect(along + k, dy < 0 ? Y + 7 : Y + TILE - 8, 1, 1); else ctx.fillRect(dx < 0 ? X + 7 : X + TILE - 8, along + k, 1, 1);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 地面: ground.js の有機的マスクでチャンクを焼いて描く ---------- */
  const tileMatAt = (map, tx, ty) => MATERIAL_OF_TERRAIN[map.terrain[Math.max(0, Math.min(map.h - 1, ty)) * map.w + Math.max(0, Math.min(map.w - 1, tx))]];

  // タイル1枚の color/normal/height を RGBA の配列で読む(normal/height が無ければ平坦値)。読めなければ例外(呼び出し側が旧描画へ戻す)
  function readFrame(fr) {
    const w = fr.w, h = fr.h;
    const grab = (src, flat) => {
      const cv = newCanvas(w, h), g = cv.getContext('2d', { willReadFrequently: true });
      if (src) g.drawImage(src, fr.x, fr.y, w, h, 0, 0, w, h);
      else { g.fillStyle = flat; g.fillRect(0, 0, w, h); }
      return g.getImageData(0, 0, w, h).data;
    };
    return { c: grab(fr.img, '#000'), n: grab(fr.nimg, '#808000'), h: grab(fr.himg, '#00c880') };
  }

  // 材質ごとの素材。既定は tiles の `${材質}${変種}`(32×32)。GR.provider(材質名) が {w,h,variants:[{c,n,h}],variantAt} を返せば、そちらを使う
  // (将来の 64×64 継ぎ目なしの mat_* 素材は、この関数を setGroundMaterialProvider で差し込む)。
  function groundTextures() {
    if (GR.tex) return GR.tex;
    if (GR.failed) return null;
    try {
      const tex = [];
      for (let m = 0; m < Ground.MATERIALS.length; m++) {
        const name = Ground.MATERIALS[m];
        if (Ground.isWaterMat(m)) { tex.push(null); continue; }
        const prov = GR.provider ? GR.provider(name, assets) : null;
        if (prov) { tex.push(prov); continue; }
        const count = variantsOf(name), variants = [];
        for (let v = 0; v < count; v++) variants.push(readFrame(assets.get('tiles', `${name}${v}`)));
        const w0 = assets.get('tiles', `${name}0`);
        tex.push({ w: w0.w, h: w0.h, variants, variantAt: (tx, ty) => terrainVariant(name, tx, ty) % variants.length });
      }
      GR.tex = tex;
      return tex;
    } catch (err) {
      GR.failed = true; VS.ground.failed = true;
      console.warn('[Mosslight] 地面の素材を読み出せません。旧タイル描画で続行します。', err && err.message);
      return null;
    }
  }

  function groundSpec(map) {
    return {
      matAt: (tx, ty) => tileMatAt(map, tx, ty), tex: groundTextures(), seed: (BALANCE.seed ^ (map.id === 'underground' ? 0x5555 : 0)) | 0,
      scatter: TOG.groundScatter, debug: GR.debug,
    };
  }

  // チャンク(8×8タイル + 2タイルの縁)の材質の署名。地形が変わった(採掘・リセット)チャンクだけ焼き直す
  function chunkSig(map, cx, cy) {
    let h = 17;
    const x0 = cx * Ground.CHUNK_TILES - 2, y0 = cy * Ground.CHUNK_TILES - 2, n = Ground.CHUNK_TILES + 4;
    for (let ty = y0; ty < y0 + n; ty++) for (let tx = x0; tx < x0 + n; tx++) h = (Math.imul(h, 31) + tileMatAt(map, tx, ty)) | 0;
    return h;
  }

  function bakeGroundChunk(map, cx, cy, key, sig) {
    try {
      const t = performance.now();
      const res = Ground.bakeChunk(groundSpec(map), cx, cy);
      const canvases = Ground.toCanvases(res, newCanvas);
      const ms = performance.now() - t;
      VS.ground.lastBakeMs = ms; VS.ground.bakeMs += ms; VS.ground.baked++; VS.ground.scatter = res.stats.scatter;
      return GR.cache.set(key, { canvases, sig, stats: res.stats });
    } catch (err) {
      GR.failed = true; VS.ground.failed = true;
      console.warn('[Mosslight] 地面チャンクを焼けません。旧タイル描画で続行します。', err && err.message);
      return null;
    }
  }

  // 焼く予算が尽きたチャンクの暫定表示: 材質ごとの下地タイルだけ(縁・散らしなし)
  function drawGroundFallback(map, cx, cy, tx0, ty0, tx1, ty1) {
    const cs = Ground.CHUNK_TILES;
    for (let ty = Math.max(ty0 - 1, cy * cs); ty <= Math.min(ty1 + 1, cy * cs + cs - 1); ty++) {
      for (let tx = Math.max(tx0 - 1, cx * cs); tx <= Math.min(tx1 + 1, cx * cs + cs - 1); tx++) {
        const name = Ground.MATERIALS[tileMatAt(map, tx, ty)];
        if (isWaterTile(name)) continue;
        blit(assets.get('tiles', name + terrainVariant(name, tx, ty)), tx * TILE, ty * TILE);
      }
    }
  }

  function drawGroundChunks(map, tx0, ty0, tx1, ty1) {
    const tex = groundTextures();
    if (!tex) return false;
    const cache = GR.cache || (GR.cache = Ground.createChunkCache(24));
    const G = VS.ground, t0 = performance.now(), cs = Ground.CHUNK_TILES;
    G.fallback = 0;
    // 1. 水の下地(アニメーション)。水そのもの、または8近傍に水のあるタイル。陸の材質はこの上に透明を残して重ねる
    const waterFrame = Math.floor(R.t * 2.2) & 3;
    const wAt = (x, y) => { const nm = Ground.MATERIALS[tileMatAt(map, x, y)]; return isWaterTile(nm) ? nm : null; };
    let anyWater = false;
    for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) {
      for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
        let nm = wAt(tx, ty);
        if (!nm) {
          for (let dy = -1; dy <= 1 && !nm; dy++) for (let dx = -1; dx <= 1 && !nm; dx++) if (dx || dy) nm = wAt(tx + dx, ty + dy) && 'water';
        }
        if (!nm) continue;
        anyWater = true;
        blit(assets.get('tiles', nm + waterFrame), tx * TILE, ty * TILE);
      }
    }
    if (anyWater) drawWaterDepth(map, tx0, ty0, tx1, ty1);
    // 2. 陸のチャンク
    const cxa = Math.max(0, Math.floor((tx0 - 1) / cs)), cxb = Math.min(Math.ceil(map.w / cs) - 1, Math.floor((tx1 + 1) / cs));
    const cya = Math.max(0, Math.floor((ty0 - 1) / cs)), cyb = Math.min(Math.ceil(map.h / cs) - 1, Math.floor((ty1 + 1) / cs));
    let baked = 0;
    const keyOf = (cx, cy) => `${map.id}:${cx},${cy}:${GR.debug}:${TOG.groundScatter ? 1 : 0}`;
    for (let cy = cya; cy <= cyb; cy++) {
      for (let cx = cxa; cx <= cxb; cx++) {
        const key = keyOf(cx, cy), sig = chunkSig(map, cx, cy);
        let e = cache.get(key);
        if (e && e.sig !== sig) e = null;
        if (!e) {
          // 見えているのに未焼きのチャンクは、その場で焼く(材質が後から変わって見えないように)。通常は先読みが済んでいて 0〜2枚。
          // 12枚を超える異常な時だけ、暫定の下地タイルで埋める
          if (baked >= 12) { G.fallback++; drawGroundFallback(map, cx, cy, tx0, ty0, tx1, ty1); continue; }
          e = bakeGroundChunk(map, cx, cy, key, sig);
          if (!e) return false;
          baked++;
        }
        const X = cx * Ground.CHUNK_PX, Y = cy * Ground.CHUNK_PX;
        ctx.drawImage(e.canvases.color, X, Y);
        if (layered) { nctx.drawImage(e.canvases.normal, X, Y); hctx.drawImage(e.canvases.height, X, Y); }
      }
    }
    // 3. 先読み: 今のフレームで焼かなかった時だけ、見えている範囲の周りのチャンクを1つ
    if (!baked && performance.now() - t0 < 4) {
      outer: for (let cy = cya - 1; cy <= cyb + 1; cy++) for (let cx = cxa - 1; cx <= cxb + 1; cx++) {
        if (cx < 0 || cy < 0 || cx >= Math.ceil(map.w / cs) || cy >= Math.ceil(map.h / cs)) continue;
        const key = keyOf(cx, cy);
        if (cache.get(key)) continue;
        bakeGroundChunk(map, cx, cy, key, chunkSig(map, cx, cy));
        break outer;
      }
    }
    G.chunks = cache.size;
    return true;
  }

  function drawTerrain(map, tx0, ty0, tx1, ty1) {
    if (TOG.groundChunks && !GR.failed && drawGroundChunks(map, tx0, ty0, tx1, ty1)) return;
    // 旧描画(TOG.groundChunks=false か、素材を読めない時): 論理地形を四隅として半マスずらして描く。境界の凸角・凹角も同じ規則で接続する。
    // 注意: この経路の edge_* には焼き込みの明るい縁線があり、白い格子に見える。出荷用ではない
    // 先に全マスの下地を敷き、水の深さを重ねてから縁を描く(砂・草の縁の張り出しが帯の上に載る)。
    const order = { deepwater: 0, water: 1, cave: 2, sand: 3, dirt: 4, path: 5, ruin: 6, grass: 7, darkgrass: 8, moss: 9, farmland: 10 };
    const waterFrame = Math.floor(R.t * 2.2) & 3;
    const cells = [];
    for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
      const materials = [[tx-1,ty-1],[tx,ty-1],[tx-1,ty],[tx,ty]].map(([x,y]) => TERRAIN_INFO[terrainAt(map,x,y)].tile);
      const present = [...new Set(materials)].sort((a,b) => (order[a] || 0) - (order[b] || 0));
      const X=tx*TILE-16, Y=ty*TILE-16;
      const base=present[0];
      blit(assets.get('tiles', base + (isWaterTile(base) ? waterFrame : terrainVariant(base, tx, ty))),X,Y);
      cells.push({ tx, ty, X, Y, materials, present });
    }
    drawWaterDepth(map, tx0, ty0, tx1, ty1);
    for (const { tx, ty, X, Y, materials, present } of cells) {
      for (const material of present.slice(1)) {
        const mask=materials.reduce((n,m,i) => n+(m===material ? 1<<i : 0),0);
        const name = [`edge_${edgeName(material, present)}_${mask}`, `edge_${material}_${mask}`].find((n) => assets.has('tiles', n));
        if (name) blit(assets.get('tiles',name),X,Y);
        else {
          // 耕作など建築の地面は別パスで上書きする。
          for(let i=0;i<4;i++) if(mask&(1<<i)) {
            const f=assets.get('tiles',material+(isWaterTile(material) ? waterFrame : terrainVariant(material, tx, ty))), dx=(i&1)*16,dy=(i>>1)*16;
            drawFrame(f,dx,dy,16,16,X+dx,Y+dy);
          }
        }
      }
    }
  }

  /* ---------- 洞窟の壁(地下) ---------- */
  // 範囲外・岩盤も壁として扱い、端で壁の連結が切れないようにする
  function isWallTile(map, x, y) {
    const t = terrainAt(map, x, y);
    return t === T.CAVE_WALL || t === T.BEDROCK || t === T.CLIFF;
  }

  // 採掘の進み具合(0..3段)。wallHp は地下のタイル番号 → 残りHP
  function crackStage(state, map, i, kind) {
    const nodeDef = NODES[WALL_NODE[kind]];
    const hp = state.wallHp && state.wallHp.get(i);
    if (!nodeDef || hp == null) return 0;
    const frac = 1 - hp / nodeDef.hp;
    return frac <= 0 ? 0 : frac < 0.34 ? 1 : frac < 0.67 ? 2 : 3;
  }

  // ひびを手続きで重ねる(段階が進むほど枝が増える)。色は今のツルハシの段階を表す
  function drawCracks(X, Y, tx, ty, stage, color) {
    ctx.fillStyle = '#0c1014';
    const segs = stage * 3;
    for (let k = 0; k < segs; k++) {
      let x = X + 6 + Math.floor(hash2(tx, ty, 120 + k) * 20), y = Y + 6 + Math.floor(hash2(tx, ty, 140 + k) * 18);
      const dx = hash2(tx, ty, 160 + k) > 0.5 ? 1 : -1, len = 3 + Math.floor(hash2(tx, ty, 180 + k) * 4);
      for (let s = 0; s < len; s++) {
        ctx.fillRect(x, y, 1, 1);
        if (s % 2 === 0) { ctx.fillStyle = color; ctx.fillRect(x + dx, y, 1, 1); ctx.fillStyle = '#0c1014'; }
        x += dx; y += (s % 2 === 0 ? 1 : 0);
      }
    }
  }

  function drawCaveWalls(state, map, tx0, ty0, tx1, ty1) {
    const hasNew = assets.has('tiles', 'cavewall_top0');
    const pickTier = state.player.tools.pick || 0;
    for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) {
      for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
        if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
        const i = ty * map.w + tx;
        const t = map.terrain[i];
        if (t !== T.CAVE_WALL && t !== T.BEDROCK) continue;
        const X = tx * TILE, Y = ty * TILE, kind = map.wallKind[i];
        if (!hasNew) { drawLegacyWall(tx, ty, X, Y); continue; }
        const mask = (isWallTile(map, tx, ty - 1) ? 1 : 0) | (isWallTile(map, tx + 1, ty) ? 2 : 0) | (isWallTile(map, tx, ty + 1) ? 4 : 0) | (isWallTile(map, tx - 1, ty) ? 8 : 0);
        blit(assets.get('tiles', `cavewall_top${mask}`), X, Y);
        const southOpen = !(mask & 4);
        const faceBase = WALL_FACE[kind] || 'cavewall_face';
        if (southOpen || WALL_ALWAYS_FACE.has(kind)) {
          const name = `${faceBase}${(tx * 7 + ty * 3 + (hash2(tx, ty, 83) * 4 | 0)) & 3}`;
          // 前面は壁タイルの下端に揃える(32x32なら全面)
          if (assets.has('tiles', name)) { const fr = assets.get('tiles', name); blit(fr, X, Y + TILE - fr.h); }
          else blit(assets.get('tiles', `cavewall_face${(tx + ty) & 3}`), X, Y);
          if (kind === 2) { ctx.globalAlpha = 0.16; ctx.fillStyle = '#4f9a78'; ctx.fillRect(X, Y, TILE, TILE); ctx.globalAlpha = 1; }
          if (southOpen) { ctx.globalAlpha = 0.28; ctx.fillStyle = '#05080b'; ctx.fillRect(X, Y + TILE, TILE, 3); ctx.globalAlpha = 1; }
        }
        // 採掘できる壁だけ: ひびの段階と、必要なツルハシの段階の印
        const def = kind >= 1 && kind <= 4 && !map.protect[i] ? NODES[WALL_NODE[kind]] : null;
        if (!def) continue;
        const stage = crackStage(state, map, i, kind);
        if (stage) drawCracks(X, Y, tx, ty, stage, TIER_COLOR[Math.max(1, pickTier)]);
        if (pickTier < def.hardness && (southOpen || WALL_ALWAYS_FACE.has(kind))) {
          // 今の道具では掘れない: 要求段階の数だけ点を並べる
          for (let k = 0; k < def.hardness; k++) {
            ctx.fillStyle = '#0c1014'; ctx.fillRect(X + 24 - k * 4, Y + TILE - 9, 3, 3);
            ctx.fillStyle = TIER_COLOR[def.hardness]; ctx.fillRect(X + 25 - k * 4, Y + TILE - 8, 1, 1);
          }
        }
      }
    }
  }

  // 新しい壁フレームが未納品の間だけ使う従来の岩の見た目
  function drawLegacyWall(tx, ty, X, Y) {
    ctx.globalAlpha = 0.45; ctx.fillStyle = '#0a1016'; ctx.fillRect(X, Y, TILE, TILE); ctx.globalAlpha = 1;
    const rock = prop(pickVariant('rock', tx, ty, 81));
    blit(rock, X + 16 - rock.px, Y + 30 - rock.py);
  }

  /* ---------- 地表の崖 ---------- */
  // 台地(solidな地形)の南向きの前面。前面は台地タイル自身の上に描くので、通れる地面を覆わず当たり判定とも一致する
  function drawCliffs(map, tx0, ty0, tx1, ty1) {
    const runs = map.cliffFaces;
    if (!runs || !assets.has('tiles', 'cliff_face0')) return;
    for (const run of runs) {
      if (run.y < ty0 - 1 || run.y > ty1 + 1 || run.x1 < tx0 - 1 || run.x0 > tx1 + 1) continue;
      for (let x = Math.max(run.x0, tx0 - 1); x <= Math.min(run.x1, tx1 + 1); x++) {
        const X = x * TILE, Y = run.y * TILE;
        if (terrainAt(map, x, run.y) !== T.CLIFF) continue;
        // 4枚は連続した断面。順序を崩すと岩と草の縁がタイル境界で切れる。
        blit(assets.get('tiles', `cliff_face${(x - run.x0) & 3}`), X, Y);
        // 足元の接地影。南側の地面を暗くするだけで、見た目の壁は足さない
        ctx.globalAlpha = 0.22; ctx.fillStyle = '#07100d'; ctx.fillRect(X, Y + TILE, TILE, 3); ctx.globalAlpha = 1;
        if (x === run.x0 && assets.has('tiles', 'cliff_left')) blit(assets.get('tiles', 'cliff_left'), X, Y);
        if (x === run.x1 && assets.has('tiles', 'cliff_right')) blit(assets.get('tiles', 'cliff_right'), X, Y);
      }
    }
  }

  /* ---------- 地面の細部・闘技場の景色(見た目だけ。当たり判定なし) ---------- */
  // details シートの葉・土の擦れ・葦などを、地形に沿って低密度に置く。無い名前は要求しない(assets.missing を汚さない)
  function drawGroundDetails(state, map, tx0, ty0, tx1, ty1) {
    const sidx = state.structIndex[map.id];
    let plots = null;
    for (const f of state.farmland || []) if (f.map === map.id) (plots ||= new Set()).add(f.y * map.w + f.x);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const d = groundDetail(map, tx, ty);
        if (!d || !assets.has('props', d.name)) continue;
        const i = ty * map.w + tx;
        if ((sidx && sidx.get(i)) || (plots && plots.has(i))) continue;
        const fr = prop(pickVariant(d.name, tx, ty, 305));
        blit(fr, tx * TILE + 16 + d.dx - fr.px, ty * TILE + 24 + d.dy - fr.py);
      }
    }
  }

  function drawSceneryItem(s) {
    if (!assets.has('props', s.name)) return;
    const fr = prop(pickVariant(s.name, s.x, s.y, 313));
    blit(fr, s.x - fr.px, s.y - fr.py);
  }

  // 闘技場の平たい飾りを地面に描く(背の高い物は collectScene でY順に混ぜる)
  function drawArenaFlat(map, tx0, ty0, tx1, ty1) {
    for (const s of [...arenaScenery(map), ...shoreScenery(map)]) {
      if (s.tall) continue;
      const tx = Math.floor(s.x / TILE), ty = Math.floor(s.y / TILE);
      if (tx < tx0 - 2 || tx > tx1 + 2 || ty < ty0 - 2 || ty > ty1 + 2) continue;
      drawSceneryItem({ ...s, y: s.y + 8 });
    }
  }

  function drawDeco(map, tx0, ty0, tx1, ty1) {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * map.w + tx, d = map.deco[i];
        if (!d || map.nodeAt[i] >= 0) continue;
        const ox = 6 + Math.floor(hash2(tx, ty, 62) * 20), oy = 22 + Math.floor(hash2(tx, ty, 63) * 8);
        const x = tx * TILE + ox, y = ty * TILE + oy;
        let fr;
        if (d === 1) fr = prop(pickVariant('flowers', tx, ty, 64));
        else if (d === 2) fr = smallProp('bush', undefined, true);
        else if (d === 3) fr = smallProp('flower', undefined, true);
        else fr = smallProp('fern', { tint: ['#304936', 0.25] }, true);
        const swayPhase = Math.sin(R.t * 1.5 + tx * 0.9 + ty * 0.5);
        const sw = !R.calm && d !== 1 && Math.abs(swayPhase) > 0.6 ? Math.sign(swayPhase) : 0;
        drawSlice(fr, x - fr.px, y - fr.py, Math.max(0, fr.py - 8), sw);
      }
    }
  }

  // 上部だけ水平に揺らす(草花)。split行より上がsw分ずれる
  function drawSlice(fr, x, y, split, sw) {
    if (!sw) { blit(fr, x, y); return; }
    drawFrame(fr, 0, 0, fr.w, split, x + sw, y);
    drawFrame(fr, 0, split, fr.w, fr.h - split, x, y + split);
  }

  /* ---------- 物体 ---------- */
  // 小物指定: 定義の half / scale:0.5 と、ノードのmetadata.half
  function isHalf(def, node) {
    return !!(def.half || def.scale === 0.5 || (node && node.meta && node.meta.half));
  }

  function nodeSpriteMods(def, node) {
    const m = {};
    if (TOG.mirrorNatural && nodeMirrored(node)) m.flip = true;
    if (isHalf(def, node)) m.half = true;
    if (def.tint) m.tint = def.tint;
    if (def.clayDots) m.clayDots = true;
    return m;
  }

  function fadeOf(obj, target, dt) {
    const cache = typeof obj === 'object' && obj !== null ? R.fade : R.roofFade;
    let v = cache.get(obj);
    if (v == null) v = 1;
    v += (target - v) * Math.min(1, dt * 12);
    if (Math.abs(v - target) < 0.01) v = target;
    cache.set(obj, v);
    return v;
  }

  function drawTreeSprite(fr, x, y, alpha) {
    const split = Math.max(0, fr.py - 16);
    if (alpha < 0.99) {
      drawFrame(fr, 0, split, fr.w, fr.h - split, x, y + split);
      ctx.globalAlpha = alpha;
      drawFrame(fr, 0, 0, fr.w, split, x, y);
      ctx.globalAlpha = 1;
    } else blit(fr, x, y);
  }

  function collectScene(state, map, tx0, ty0, tx1, ty1) {
    sortList.length = 0;
    const p = state.player;
    const sidx = state.structIndex[map.id];
    for (let ty = ty0 - 1; ty <= ty1 + 4; ty++) {
      for (let tx = tx0 - 2; tx <= tx1 + 2; tx++) {
        if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
        const ni = map.nodeAt[ty * map.w + tx];
        if (ni >= 0) { const n = map.nodes[ni]; sortList.push({ y: nodeFootprint(n, !nodeAliveR(state, n)).y, kind: 0, ref: n }); }
        const s = sidx.get(ty * map.w + tx);
        if (s) {
          const def = STRUCTURES[s.type];
          if (def.layer !== 'floor') sortList.push({ y: ty * TILE + 28, kind: 1, ref: s });
        }
      }
    }
    for (const g of state.groundItems) {
      if (g.map === map.id) sortList.push({ y: g.y, kind: 2, ref: g });
    }
    for (const e of state.enemies) if (e.map === map.id) sortList.push({ y: e.y, kind: 4, ref: e });
    for (const n of state.npcs || []) if (n.active && n.map === map.id) sortList.push({ y: n.y, kind: 5, ref: n });
    for (const crop of state.crops || []) if (crop.map === map.id) sortList.push({ y: crop.y * TILE + 26, kind: 6, ref: crop });
    if (state.deathBag?.map === map.id) sortList.push({ y: state.deathBag.y, kind: 7, ref: state.deathBag });
    for (const s of arenaScenery(map)) {
      if (!s.tall) continue;
      const sx = s.x / TILE, sy = s.y / TILE;
      if (sx >= tx0 - 3 && sx <= tx1 + 3 && sy >= ty0 - 2 && sy <= ty1 + 5) sortList.push({ y: s.y, kind: 8, ref: s });
    }
    sortList.push({ y: p.y + 0.01, kind: 3, ref: p });
    sortList.sort((a, b) => a.y - b.y);
  }

  function nodeAliveR(state, n) {
    const ns = state.nodes.get(n.key);
    return !(ns && ns.respawnAt != null);
  }

  function drawShadows(state, map) {
    for (const it of sortList) {
      if (it.kind === 0) {
        const n = it.ref, def = NODES[n.type];
        if (def.decor && !n.sprite) continue;
        if (!nodeAliveR(state, n) && n.type !== 'tree') continue;
        if (n.type === 'border_pine') continue;
        if (n.type === 'branch' || n.type === 'pebble') { drawShadow(n.px, n.py, 4, 1); continue; }
        if (n.type === 'grass') { drawShadow(n.px, n.py, 5, 1); continue; }
        if (n.sprite === 'flowers' || n.sprite === 'blueflowers') { drawShadow(n.px, n.py, 3, 1); continue; }
        if (n.type === 'tree') { if (nodeAliveR(state, n)) drawShadow(n.px + 4, n.py + 1, 21, 7); else drawShadow(n.px, n.py - 1, 10, 4); }
        else if (def.landmark) drawShadow(n.px, n.py - 2, 22, 7);
        else if (def.solid) { const f = nodeFootprint(n); drawShadow(f.x, f.y, Math.max(8, f.rx), Math.max(3, f.ry)); }
        else if (n.sprite === 'flowers' || n.sprite === 'log') drawShadow(n.px, n.py - 1, n.sprite === 'log' ? 14 : 9, 3);
        else if (def.scale === 0.5) drawShadow(n.px, n.py - 1, 8, 3);
        else if (def.sprite) drawShadow(n.px, n.py - 1, 13, 4);
        else drawShadow(n.px, n.py - 1, 11, 4);
      } else if (it.kind === 1) {
        const s = it.ref, def = STRUCTURES[s.type];
        if (def.layer === 'floor') continue;
        const cx = s.x * TILE + 16, cy = s.y * TILE + 28;
        if (def.kind === 'wall') continue;
        drawShadow(cx + 1, cy - 1, def.scale === 0.5 ? 8 : 15, def.scale === 0.5 ? 3 : 5);
      } else if (it.kind === 2) {
        const g = it.ref;
        drawShadow(g.x, g.y, 6, 2);
      } else if (it.kind === 3) {
        drawShadow(it.ref.x, it.ref.y - 1, 9, 3);
      } else if (it.kind === 4) {
        drawShadow(it.ref.x, it.ref.y - 1, Math.max(8, (it.ref.radius || 10)), 4);
      } else if (it.kind === 5) {
        drawShadow(it.ref.x, it.ref.y - 1, 9, 3);
      } else if (it.kind === 8) {
        drawShadow(it.ref.x, it.ref.y - 1, 12, 4);
      }
    }
  }

  // noGlow: 暗幕を抜くだけで、加算の色光は足さない(闘技場の照明用。白飛びさせない)
  // src: {x,y,h} 物理的な光源の足元(world px)と足元からの高さ(px)。あれば局所光の地面影を持てる灯になる(無い灯は height ray だけ)
  function addLight(x, y, r, color, flicker, power, id, noGlow, src) {
    lights.push({ x, y, r, color, flicker: flicker || 0, power: power == null ? 1 : power, id: id || 0, noGlow: !!noGlow, src: src || null });
  }

  // 地下のボス闘技場: プレイヤーが近い間、または交戦中に、暗幕を弱めて闘技場全体を照らす。洞窟のほかの場所は暗いまま
  const ARENA_TINT = { moss: [96, 196, 170], ruin: [255, 170, 100] };
  function arenaState(state, map) {
    if (map.id !== 'underground' || !map.landmarks) return null;
    const p = state.player, lm = map.landmarks;
    let best = null;
    for (const [kind, a] of [['moss', lm.mossArena], ['ruin', lm.arena]]) {
      if (!a) continue;
      const d = Math.hypot(p.x / TILE - (a.x + 0.5), p.y / TILE - (a.y + 0.5));
      if (d < a.r + 6 && (!best || d < best.d)) best = { kind, a, d };
    }
    return best;
  }

  function drawNode(state, n, dt, focusRef, ambient) {
    const def = NODES[n.type];
    const p = state.player;
    const ns = state.nodes.get(n.key);
    const alive = !(ns && ns.respawnAt != null);
    let name = n.sprite;
    let litCount = 0;
    if (n.type === 'tower') {
      // 灯が戻るたびに塔の火が点る(工程2以降の状態に対応)
      const lit = state.progress.lights;
      litCount = (lit.forge ? 1 : 0) + (lit.moss ? 1 : 0) + (lit.ancient ? 1 : 0);
      if (litCount >= 3) name = 'beacon_lit';
    }
    if (!alive) {
      if (!def.depletedSprite) return;
      name = def.depletedSprite;
    }
    if (!def.landmark && n.type !== 'tower') name = pickVariant(name, n.tx, n.ty, 64);
    if (def.decor && n.type === 'border_pine') {
      const meta = n.meta && n.meta.canopy ? n.meta : null;
      const depth = meta ? Math.max(0, meta.depth | 0) : 0;
      // 奥の列ほど暗くする。手前(depth0)と固体の森の縁は着色しない
      const fr = prop(name, depth > 0 ? { tint: ['#0a1816', Math.min(0.64, 0.2 + depth * 0.14)] } : undefined);
      const bx = Math.round(n.px) - fr.px, by = Math.round(n.py) - fr.py;
      if (depth > 1) {
        // 奥の列は樹冠だけ描く。地面に接しない幹が宙に浮かないようにする
        const split = Math.max(1, fr.py - 16);
        drawFrame(fr, 0, 0, fr.w, split, bx, by);
      } else blit(fr, bx, by);
      return;
    }
    const mods = alive ? nodeSpriteMods(def, n) : {};
    const highlighted = focusRef === n && alive && !def.canopy;
    if (highlighted) mods.outline = state.focus.ok ? '#ffe9a8' : '#8fa89f';
    const fr = smallProp(name, mods, !!mods.half);
    let x = Math.round(n.px) - fr.px, y = Math.round(n.py) - fr.py;
    if (ns && ns.hitT > 0 && !R.calm) x += Math.round(Math.sin(ns.hitT * 90) * 1.6);

    if (def.landmark && def.backSprite) {
      const back = prop(def.backSprite);
      blit(back, Math.round(n.px) - back.px, Math.round(n.py) - back.py);
    }
    if (def.canopy && alive) {
      const dx = p.x - n.px, dy = n.py - p.y;
      const behind = dy > 2 && dy < 86 && Math.abs(dx) < 34;
      const a = fadeOf(n, behind ? 0.35 : 1, dt);
      drawTreeSprite(fr, x, y, a);
      return;
    }
    if (def.sway && alive && !R.calm) {
      const ph = Math.sin(R.t * 1.6 + n.tx * 0.9 + n.ty * 0.6);
      const sw = Math.abs(ph) > 0.55 ? Math.sign(ph) : 0;
      drawSlice(fr, x, y, Math.max(0, fr.py - 20), sw);
    } else blit(fr, x, y);

    if (alive && def.glow) addLight(n.px, n.py - 10, def.glow.r, def.glow.color, 0.3, 0.55, n.id);
    if (litCount > 0) addLight(n.px, n.py - 40, 3 + litCount, [255, 200, 120], 0.5, 0.7, n.id);
    // 拾えるものが近くで小さく瞬く
    if (alive && def.spark && !R.calm) {
      const d = Math.hypot(p.x - n.px, p.y - n.py);
      if (d < 150 && focusRef !== n) {
        const ph = (R.t * 0.8 + hash2(n.tx, n.ty, 95) * 7) % 3;
        if (ph < 0.28) {
          const sx = Math.round(n.px) + Math.floor(hash2(n.tx, n.ty, 96) * 10) - 5, sy = Math.round(n.py) - 18 - (ph * 14 | 0);
          ctx.fillStyle = '#fff0af';
          ctx.fillRect(sx, sy - 1, 1, 3); ctx.fillRect(sx - 1, sy, 3, 1);
        }
      }
    }
  }

  // 4方向の連結マスク N=1 E=2 S=4 W=8。壁と扉(家の外壁を構成する物)を繋ぐ。preview位置にも使う
  function wallMask(state, mapId, x, y, extra) {
    const idx = state.structIndex[mapId];
    const link = (tx, ty) => {
      if (extra && extra.x === tx && extra.y === ty) return true;
      const o = idx && idx.get(ty * state.world.maps[mapId].w + tx);
      const d = o && STRUCTURES[o.type];
      return !!d && (d.kind === 'wall' || d.kind === 'door');
    };
    return (link(x, y - 1) ? 1 : 0) | (link(x + 1, y) ? 2 : 0) | (link(x, y + 1) ? 4 : 0) | (link(x - 1, y) ? 8 : 0);
  }

  function drawStructure(state, s, focusRef) {
    const def = STRUCTURES[s.type];
    const ax = s.x * TILE + 16, ay = s.y * TILE + 28;
    const mods = {};
    if (isHalf(def, s)) mods.half = true;
    if (def.tint) mods.tint = def.tint;
    const hi = focusRef === s;
    if (hi) mods.outline = state.focus.ok ? '#ffe9a8' : '#8fa89f';
    const visual = { table: 'table', chair: 'chair', pot: 'pot' }[s.type] || def.sprite;
    // 家の南側では、床の上に立つ高さのある正面壁を使う。
    const map = state.world.maps[s.map], idx = state.structIndex[s.map];
    const north = state.floorIndex[s.map] && state.floorIndex[s.map].get((s.y - 1) * map.w + s.x);
    const south = idx && idx.get((s.y + 1) * map.w + s.x);
    const adjacentHome = (state.houses || []).some(h => h.valid && h.map === s.map && h.cells.some(([x,y]) => y === s.y - 1 && Math.abs(x - s.x) <= 1));
    const front = (north || adjacentHome) && (!south || !['wall', 'door'].includes(STRUCTURES[south.type].kind));
    const indoors = (state.houses || []).some(h => h.valid && h.map === s.map && h.cells.some(([x,y]) => x === Math.floor(state.player.x / TILE) && y === Math.floor(state.player.y / TILE)));
    if (front && !indoors && (def.kind === 'wall' || def.kind === 'door') && assets.has('props', 'facade_wall')) {
      const variation = Math.floor(hash2(s.x,s.y,327)*3);
      const name = (def.kind === 'door' ? 'facade_door' : (s.x & 1) ? 'facade_window' : 'facade_wall') + (variation ? `_v${variation}` : '');
      const face = prop(name, hi ? { outline: mods.outline } : undefined);
      ctx.globalAlpha = s.open ? 0.4 : 1;
      blit(face, ax - face.px, ay - face.py);
      ctx.globalAlpha = 1;
      return;
    }
    if (s.type === 'table' || s.type === 'chair') { delete mods.half; delete mods.tint; }
    // 木の壁は隣の壁・扉と繋がる専用タイル(timber_wall0..15)で描く。不足時は従来の壁スプライト
    if (def.kind === 'wall' && assets.has('tiles', 'timber_wall0')) {
      const wm = {};
      if (hi) wm.outline = mods.outline;
      const tile = assets.get('tiles', `timber_wall${wallMask(state, s.map, s.x, s.y)}`, Object.keys(wm).length ? wm : undefined);
      const ox = hi ? 1 : 0;
      blit(tile, s.x * TILE - ox, s.y * TILE - ox);
      return;
    }
    const fr = smallProp(visual, mods, !!mods.half);
    const x = ax - fr.px, y = ay - fr.py;
    if (s.type === 'door_wood' && s.open) ctx.globalAlpha = 0.4;
    blit(fr, x, y);
    ctx.globalAlpha = 1;
    if (def.overlay === 'pot' && visual !== 'pot') {
      ctx.fillStyle = '#39434e'; ctx.fillRect(ax - 9, ay - 12, 18, 2);
      ctx.fillStyle = '#505c67'; ctx.fillRect(ax - 10, ay - 14, 20, 6);
      ctx.fillStyle = '#6c7b81'; ctx.fillRect(ax - 9, ay - 14, 3, 5);
      ctx.fillStyle = '#91a0a2'; ctx.fillRect(ax - 10, ay - 15, 20, 1);
      ctx.fillStyle = '#d3a04b'; ctx.fillRect(ax - 6, ay - 15, 12, 1);
    }
    if (def.light) {
      if (s.type === 'campfire' || s.type === 'pot' || s.type === 'torch') {
        const f = R.calm ? 0 : Math.floor(R.t * 9 + s.id * 3) % 4;
        const tipX = s.type === 'torch' ? ax - 1 : ax - 2;
        const tipY = s.type === 'torch' ? ay - 40 : ay - 24;
        ctx.fillStyle = '#ffe58c'; ctx.fillRect(tipX + (f === 1 ? 1 : 0), tipY - (f & 1), 1, 2);
        ctx.fillStyle = '#ffb954'; ctx.fillRect(tipX + 5 - (f === 2 ? 1 : 0), tipY + 3 - ((f >> 1) & 1), 1, 2);
        emitEmbers(tipX + 1, tipY, s.id);
      }
      const L = def.light;
      // 光源の実高さ: たいまつは先端(ay-40)、焚き火・鍋は炎(ay-24)、灯籠など他は 20px
      const lampH = s.type === 'torch' ? 40 : (s.type === 'campfire' || s.type === 'pot') ? 24 : 20;
      // x,y は 2D fallback が光の中心に使う見える炎の位置。GL は src(足元+実高さ)で拡散・遮蔽・影を同じ光源から求める
      addLight(ax, ay - lampH, L.r, L.color, L.flicker, 1, s.id, false, { x: ax, y: ay, h: lampH });
    }
  }

  function emitEmbers(x, y, id) {
    if (R.calm || Math.random() > 0.045) return;
    R.particles.push({
      x: x + (Math.random() - 0.5) * 6, y, vx: (Math.random() - 0.5) * 8, vy: -(16 + Math.random() * 20), g: -2,
      life: 0, max: 0.9 + Math.random() * 0.7, size: 1, color: Math.random() < 0.5 ? '#ffb954' : '#ffe58c', glow: true, wob: id,
    });
  }

  function heroFrameName(p) {
    let mode = 'idle', n = 0;
    const a = p.action;
    if (p.roll) { mode = 'roll'; n = Math.min(2, Math.floor((p.roll.t / P.rollTime) * 3)); }
    else if (a && (a.type === 'gather' || a.type === 'swing')) { mode = 'attack'; n = Math.min(2, Math.floor((a.t / a.dur) * 3)); }
    else if (p.moving) {
      mode = 'walk';
      const step = assets.get('actors', `hero_${p.dir}_walk0`).meta?.walk_distance_per_frame;
      n = Math.floor(p.walkT / (Number.isFinite(step) && step > 0 ? step : 15)) % 4;
    }
    else n = Math.floor(R.t * 1.3) & 1;
    return `hero_${p.dir}_${mode}${n}`;
  }

  function drawHero(state, focusRef) {
    const p = state.player;
    const name = heroFrameName(p);
    const fr = assets.get('actors', name);
    const hx = Math.round(p.x), hy = Math.round(p.y);
    const a = p.action;
    // 手持ち道具: props の tool_<種類>_<素材>_<構え0..2>。握り位置を手の位置に合わせ、UIアイコンは使わない
    let tool = null, toolPos = null;
    if (a && (a.type === 'gather' || a.type === 'swing')) {
      const n = Math.min(2, Math.floor((a.t / a.dur) * 3));
      let name = null;
      if (a.type === 'gather' && a.tool && TOOL_KIND[a.tool]) {
        const tier = TOOL_TIER_NAME[Math.min(3, p.tools[a.tool] || 0)];
        if (tier) name = `tool_${TOOL_KIND[a.tool]}_${tier}_${n}`;
      } else if (a.type === 'swing') {
        const w = p.equip.weapon;
        name = `tool_sword_${w === 'sword_iron' ? 'iron' : w === 'sword_copper' ? 'copper' : 'stone'}_${n}`;
        if (!w) name = null;
      }
      // 未納品の名前は要求しない。道具が無い間は手の動きだけ見せる
      if (name && assets.has('props', name)) {
        tool = assets.get('props', name, p.dir === 'left' ? { flip: true } : undefined);
        const grip = fr.meta && fr.meta.grip;
        const hand = grip && (Array.isArray(grip[0]) ? grip[n] : grip);
        toolPos = hand ? [hand[0] - fr.px, hand[1] - fr.py] : GRIP_POS[p.dir][n];
      }
    }
    // 振りかぶった道具は頭の奥を通る。顔の前へ斧頭を貼り付けない。
    const toolBehind = p.dir === 'up' || (a && Math.floor((a.t / a.dur) * 3) === 0);
    if (tool && toolBehind) blit(tool, hx + toolPos[0] - tool.px, hy + toolPos[1] - tool.py);
    blit(fr, hx - fr.px, hy - fr.py);
    if (tool && !toolBehind) blit(tool, hx + toolPos[0] - tool.px, hy + toolPos[1] - tool.py);
    const lamp = hipPos(p);
    if (R.hipOn && lamp.legacy) drawHipLantern(lamp);
    void focusRef;
  }

  // 腰の手提げ灯の位置(足元から12px上、体の横)。描画と光源が同じ点を使う
  function hipPos(p) {
    const fr = assets.get('actors', heroFrameName(p));
    const lamp = fr.meta && fr.meta.lantern;
    if (lamp) {
      const c = lamp.glass_center;
      if (!c || lamp.visible === false) return { visible: false, legacy: false };
      const x = Math.round(p.x) - fr.px + c[0], y = Math.round(p.y) - fr.py + c[1];
      const h = Number.isFinite(lamp.glass_height) ? lamp.glass_height : Math.round(p.y) - y;
      return { x, y, h, visible: true, legacy: false };
    }
    return { x: Math.round(p.x) + (p.dir === 'left' ? 5 : -5), y: Math.round(p.y) - 12, h: 12, visible: true, legacy: true };
  }
  // 3×5px の小さな灯: 暗い枠と琥珀のガラス。ガラスだけ法線の B チャンネルで自発光にする(広い範囲は光らせない)
  function drawHipLantern(h) {
    ctx.fillStyle = '#2b2118'; ctx.fillRect(h.x - 1, h.y - 3, 3, 5);
    ctx.fillStyle = '#ffd27a'; ctx.fillRect(h.x, h.y - 2, 1, 3);
    if (!layered) return;
    nctx.fillStyle = '#808000'; nctx.fillRect(h.x - 1, h.y - 3, 3, 5);
    nctx.fillStyle = '#8080a0'; nctx.fillRect(h.x, h.y - 2, 1, 3);
    hctx.fillStyle = '#38c880'; hctx.fillRect(h.x - 1, h.y - 3, 3, 5);
  }

  function drawGroundItem(state, g, focusRef) {
    const def = ITEMS[g.item];
    const mods = focusRef === g ? { outline: '#ffe9a8' } : undefined;
    const fr = assets.get('icons', def.icon, mods);
    const bob = g.z <= 0.5 ? Math.round(Math.sin(R.t * 3 + g.id) * 1.2) : 0;
    const x = Math.round(g.x) - fr.px, y = Math.round(g.y - g.z - 7 + bob) - fr.py;
    blit(fr, x, y);
    if (g.n > 1) {
      ctx.fillStyle = '#1a1a1f'; ctx.fillRect(x + fr.w - 7, y + fr.h - 5, 7, 5);
      ctx.fillStyle = '#ffd98a'; ctx.fillRect(x + fr.w - 6, y + fr.h - 4, 5, 3);
    }
  }

  function drawEnemy(state, e) {
    const key = e.sprite || 'slime';
    const mods = e.hitT > 0 && !R.calm ? { tint: ['#fff0af', 0.6] } : undefined;
    // 姿勢: 0,1=待機/移動(交互) 2=予備動作・攻撃 3=被弾・気絶。通常敵も同じ4枚で、拡大はしない
    let pose;
    if (e.hitT > 0 || e.state === 'stun') pose = 3;
    else if (e.state === 'telegraph' || e.state === 'tele' || e.state === 'tele2' || e.state === 'attack' || e.state === 'charging' || e.telegraph != null) pose = 2;
    else pose = Math.floor(R.t * (e.moving ? 5 : 1.6) + (e.id || 0)) & 1;
    const fr = e.boss ? prop(`${key}_large${pose}`, mods) : assets.get('actors', `${key}${pose}`, mods);
    const lift = key === 'wisp' ? Math.round(Math.sin(R.t * 3 + e.id) * 3) : 0;
    blit(fr, Math.round(e.x) - fr.px, Math.round(e.y) - fr.py - lift);
    if (!e.boss && e.hp < e.maxHp) {
      const x = Math.round(e.x) - 12, y = Math.round(e.y) - 35;
      ctx.fillStyle = '#152624'; ctx.fillRect(x - 1, y - 1, 26, 4);
      ctx.fillStyle = '#d8845d'; ctx.fillRect(x, y, Math.ceil(24 * e.hp / e.maxHp), 2);
    }
    if (e.boss) {
      // 128pxの本体の全身(頭から足元まで)が照明の内側に入るよう、胴の高さを中心に大きく照らす
      const col = e.type === 'ash' ? [255, 160, 90] : [100, 218, 192];
      addLight(e.x, e.y - 56, 5.5, col, 0.05, 0.92, e.id, true);
      addLight(e.x, e.y - 60, 3, col, 0.1, 0.4, e.id + 500);
    } else if (key === 'wisp') addLight(e.x, e.y - 20, 1.5, [100, 218, 192], 0.1, 0.4, e.id);
  }

  function drawResident(state, npc, focusRef) {
    const mods = {};
    if (focusRef === npc) mods.outline = '#ffe9a8';
    // 役割別の方向付き歩行フレーム。向きと歩行は実際の移動(dir/moving)に従う。無い間だけ従来の0..3へ戻す
    const dir = DIR_SET.has(npc.dir) ? npc.dir : 'down';
    const walkName = `npc_${npc.id}_${dir}_walk${npc.moving ? Math.floor(R.t * 6 + npc.id.length) & 3 : 0}`;
    let fr;
    if (assets.has('actors', walkName)) fr = assets.get('actors', walkName, Object.keys(mods).length ? mods : undefined);
    else {
      if (npc.tint) mods.tint = npc.tint;
      const frame = npc.sleeping ? 0 : Math.floor(R.t * 3 + npc.id.length) & 3;
      fr = assets.get('actors', `${npc.sprite}${frame}`, mods);
    }
    blit(fr, Math.round(npc.x) - fr.px, Math.round(npc.y) - fr.py);
    const basket = Array.isArray(npc.basket) ? npc.basket.some(i => i.n > 0) : Object.values(npc.basket || {}).some(n => n > 0);
    if (basket) {
      const icon = assets.get('icons', 'bag', { half: true });
      blit(icon, Math.round(npc.x) - icon.px, Math.round(npc.y) - 44 - icon.py);
    }
  }

  function drawCrop(crop) {
    const def = CROPS[crop.kind];
    const stage = Math.min(3, Math.floor(crop.growth / def.stageTime));
    // 専用の作物フレームがあれば着色しない。無い間だけ共通のcropNを使い、小麦は色味で区別する
    const own = `crop_${crop.kind === 'wheat' ? 'wheat' : 'potato'}${stage}`;
    const fr = assets.has('props', own)
      ? prop(own)
      : prop(`crop${stage}`, crop.kind === 'wheat' ? { tint: ['#d7aa4b', stage >= 2 ? 0.55 : 0.15] } : undefined);
    blit(fr, crop.x * TILE + 16 - fr.px, crop.y * TILE + 28 - fr.py);
  }

  function drawDeathBag(bag) {
    const fr = assets.get('icons', 'bag', { outline: '#fff0af' });
    blit(fr, Math.round(bag.x) - fr.px, Math.round(bag.y) - fr.py - 5);
    addLight(bag.x, bag.y - 6, 1.6, [255, 215, 126], 0, 0.4, 123);
  }

  // 畑の4近傍マスク(N1/E2/S4/W8、1=隣も畑)。set は描画ごとに1回作った区画の集合(y*幅+x)。省略時はその場で作る
  function farmlandSet(state, map) {
    const set = new Set();
    for (const f of state.farmland || []) if (f.map === map.id) set.add(f.y * map.w + f.x);
    return set;
  }
  function farmlandMask(state, mapId, x, y, set) {
    const map = state.world.maps[mapId];
    const plots = set || farmlandSet(state, map);
    const link = (tx, ty) => tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && plots.has(ty * map.w + tx);
    return (link(x, y - 1) ? 1 : 0) | (link(x + 1, y) ? 2 : 0) | (link(x, y + 1) ? 4 : 0) | (link(x - 1, y) ? 8 : 0);
  }

  // 新しい畑シート(farmland_join0..15、pivot=区画の左上からの縁の余白)で動的に重ねる。無いときは従来の farmland0..3
  function drawFarmland(state, map) {
    const plots = farmlandSet(state, map);
    for (const plot of state.farmland || []) {
      if (plot.map !== map.id) continue;
      const join = `farmland_join${farmlandMask(state, map.id, plot.x, plot.y, plots)}`;
      if (assets.has('tiles', join)) {
        const fr = assets.get('tiles', join);
        blit(fr, plot.x * TILE - fr.px, plot.y * TILE - fr.py);
      } else {
        blit(assets.get('tiles', `farmland${hash2(plot.x, plot.y, 7) * 4 | 0}`), plot.x * TILE, plot.y * TILE);
      }
    }
  }

  function drawTelegraphs(state, map) {
    for (const t of state.telegraphs || []) {
      if (t.map !== map.id) continue;
      const progress = Math.max(0, Math.min(1, 1 - t.remaining / (t.duration || 1)));
      ctx.save();
      ctx.fillStyle = t.color || '#ea956c'; ctx.strokeStyle = '#ffdfaa';
      ctx.lineWidth = 1; ctx.globalAlpha = 0.15 + progress * 0.24;
      ctx.beginPath();
      if (t.kind === 'line') {
        const dx = (t.x2 ?? t.x) - t.x, dy = (t.y2 ?? t.y) - t.y;
        const angle = Math.atan2(dy, dx), length = Math.hypot(dx, dy);
        ctx.translate(t.x, t.y); ctx.rotate(angle);
        ctx.rect(0, -(t.width || 12) / 2, length, t.width || 12);
      } else if (t.kind === 'cone') {
        ctx.moveTo(t.x, t.y);
        ctx.arc(t.x, t.y, t.radius || 60, (t.angle || 0) - (t.arc || Math.PI / 2) / 2, (t.angle || 0) + (t.arc || Math.PI / 2) / 2);
        ctx.closePath();
      } else {
        ctx.arc(t.x, t.y, t.radius || 30, 0, Math.PI * 2);
        if (t.kind === 'ring' && t.inner) ctx.arc(t.x, t.y, t.inner, Math.PI * 2, 0, true);
      }
      ctx.fill('evenodd'); ctx.globalAlpha = 0.85; ctx.stroke(); ctx.restore();
    }
  }

  function drawProjectiles(state, map) {
    for (const shot of state.projectiles || []) {
      if (shot.map !== map.id) continue;
      const x = Math.round(shot.x), y = Math.round(shot.y), r = Math.ceil(shot.radius || 3);
      ctx.fillStyle = '#183930'; ctx.fillRect(x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2);
      ctx.fillStyle = shot.color || '#b6f070'; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.fillStyle = '#fff0af'; ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  // 切妻屋根: 棟(東西)を境に、奥(北)の暗い斜面と手前(南)の明るい斜面に分ける。
  // 屋根は覆い範囲を ROOF_LIFT だけ持ち上げて描くので、北縁は高く、手前の軒は壁の途中で止まり、南の壁(扉)の下部が見える。
  // 棟・軒・縁は固定色のピクセル線。テクスチャは既存の roof0..8(縁・角・中央)をそのまま使う。
  // 不整形の家は「列ごとの縦の連なり」で棟の高さを決め、連なりが変わる所に段差の線を引く。
  const FACADE_H = 56; // 屋根は室内の論理範囲を覆う。高さだけを圧縮すると北側の家具と床が外へ露出する。
  function drawRoofs(state, map, dt) {
    const seen = new Set();
    const vx0 = R.drawCamX - 96, vy0 = R.drawCamY - 96, vx1 = R.drawCamX + R.viewW + 96, vy1 = R.drawCamY + R.viewH + 96;
    for (const h of state.houses || []) {
      if (!h.valid) continue;
      seen.add(`roof:${h.id}`);
      if (h.map !== map.id) continue;
      const p = state.player;
      // h.cells(+bounds)は室内。屋根は室内と、その周囲の壁・扉まで覆う
      const sidx = state.structIndex[map.id], key = (x, y) => y * 4096 + x;
      const cover = new Set();
      for (const [cx, cy] of h.cells) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
          if (!dx && !dy) { cover.add(key(x, y)); continue; }
          const o = sidx && sidx.get(y * map.w + x), d = o && STRUCTURES[o.type];
          if (d && (d.kind === 'wall' || d.kind === 'door')) cover.add(key(x, y));
        }
      }
      const inside = cover.has(key(Math.floor(p.x / TILE), Math.floor(p.y / TILE))) || cover.has(key(Math.floor(p.x / TILE), Math.floor((p.y - 10) / TILE)));
      const alpha = fadeOf(`roof:${h.id}`, inside ? 0 : 1, dt);
      // 完全に外れた屋根は描かない。画面外の家も描かない(フェードの状態だけ上で更新済み)
      if (alpha <= 0.002) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const k of cover) {
        const x = k % 4096, y = Math.floor(k / 4096);
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if ((maxX + 1) * TILE < vx0 || minX * TILE > vx1 || (maxY + 1) * TILE < vy0 || (minY - 1) * TILE > vy1) continue;

      // 列xの縦の連なり(その家の覆いが連続する範囲)の上下端
      const runOf = (x, y) => {
        let t = y, b = y;
        while (cover.has(key(x, t - 1))) t--;
        while (cover.has(key(x, b + 1))) b++;
        return [t, b];
      };
      // 軒を正面壁に2px重ね、北の壁と人物の頭まで覆う。原寸の瓦を繰り返し、絵を引き伸ばさない。
      const roofGeom = (x, y) => {
        const [t, b] = runOf(x, y), depth = b - t + 1;
        const bottom = b * TILE + 28 - FACADE_H + 2, top = t * TILE - 12;
        return { t, depth, total: Math.max(16, bottom - top), top };
      };
      // 棟のY(ピクセル)。屋根の上端から4割
      const ridgeOf = (x, y) => { const g = roofGeom(x, y); return g.top + Math.round(g.total * 0.4); };
      const fill = (color, a, x, y, w, hh) => {
        if (w <= 0 || hh <= 0) return;
        ctx.globalAlpha = alpha * a; ctx.fillStyle = color; ctx.fillRect(x, y, w, hh);
      };

      for (const k of cover) {
        const x = k % 4096, y = Math.floor(k / 4096);
        const w = cover.has(key(x - 1, y)), e = cover.has(key(x + 1, y)), n = cover.has(key(x, y - 1)), s = cover.has(key(x, y + 1));
        const column = !w ? 0 : !e ? 2 : 1;
        const row = !n ? 0 : !s ? 2 : 1;
        // 行ごとの範囲を整数で割り振る。深い屋根も瓦の原寸を保って埋める。
        const g = roofGeom(x, y), depth = g.depth, i = y - g.t;
        const X = x * TILE, Y = g.top + Math.floor(i * g.total / depth), YE = g.top + Math.floor((i + 1) * g.total / depth), rh = YE - Y;
        const clipPath = new Path2D();
        for (let py = 0; py < rh; py++) {
          const inset = !n ? Math.floor((rh - 1 - py) / (rh / 8)) : !s ? Math.floor(py / (rh / 8)) : 0;
          const left = !w ? inset : 0, right = !e ? inset : 0;
          clipPath.rect(X + left, Y + py, TILE - left - right, 1);
        }
        const layers = layered ? [ctx, nctx, hctx] : [ctx];
        for (const c of layers) { c.save(); c.clip(clipPath); }
        ctx.globalAlpha = alpha;
        const variation = Math.floor(hash2(x,y,326)*3);
        const tileName = `${rh > 16 ? 'roof_full' : 'roof'}${row * 3 + column}${variation ? `_v${variation}` : ''}`;
        const tile = assets.get('tiles', tileName), frontTile = assets.get('tiles', tileName, { normalFlipY: true });
        const ridge = ridgeOf(x, y);
        for (let py = 0; py < rh;) {
          const chunk = Math.min(tile.h - 8, rh - py);
          const last = py + chunk === rh;
          const sy = !s && last ? tile.h - chunk : !n && py === 0 ? 0 : 8;
          const back = Math.max(0, Math.min(chunk, ridge - (Y + py)));
          if (back) drawFrame(tile, 0, sy, tile.w, back, X, Y + py);
          if (chunk > back) drawFrame(frontTile, 0, sy + back, tile.w, chunk - back, X, Y + py + back);
          py += chunk;
        }

        // 棟は部材の固有色。斜面の明暗とハイライトは動的照明が決める。
        if (ridge >= Y && ridge < YE) {
          fill('#8f5e3a', 1, X, ridge, TILE, 2);
          fill('#4a2f24', 1, X, ridge + 2, TILE, 1);
        }
        // 隣の列と棟の高さが違う所は、段差の線で繋ぐ(L字などの不整形)
        if (e) {
          const r2 = ridgeOf(x + 1, y);
          if (r2 !== ridge) {
            const a = Math.max(Y, Math.min(ridge, r2)), b = Math.min(YE, Math.max(ridge, r2) + 3);
            fill('#2a1a10', 0.85, X + TILE - 1, a, 1, b - a);
          }
        }
        // 北の縁(背面): 暗い線と、すぐ下の縁取り
        if (!n) { fill('#24160d', 1, X, Y, TILE, 1); fill('#7d5a38', 0.7, X, Y + 1, TILE, 1); }
        // 左右の縁(妻側の軒先): 外側が暗く、内側に1pxの明るい縁
        if (!w && n && s) { fill('#24160d', 1, X, Y, 1, rh); fill('#c99d5e', 0.55, X + 1, Y, 1, rh); }
        if (!e && n && s) { fill('#24160d', 1, X + TILE - 1, Y, 1, rh); fill('#c99d5e', 0.55, X + TILE - 2, Y, 1, rh); }
        // 手前の軒: 縁の明るい線、その下の暗い線、壁へ落ちる影(扉・南の壁の下部は見えたまま)
        if (!s) {
          fill('#e6c685', 1, X, YE - 3, TILE, 1);
          fill('#c99d5e', 1, X, YE - 2, TILE, 1);
          fill('#2a1a10', 1, X, YE - 1, TILE, 1);
          fill('#06080a', 0.38, X, YE, TILE, 2);
        }
        for (const c of layers) c.restore();
      }
      ctx.globalAlpha = 1;
    }
    // 取り壊された家・無効になった家の室内フェード用キーを残さない
    for (const k of R.roofFade.keys()) if (typeof k === 'string' && k.startsWith('roof:') && !seen.has(k)) R.roofFade.delete(k);
  }

  function drawFloors(state, map, tx0, ty0, tx1, ty1) {
    for (const s of state.structures) {
      if (s.map !== map.id) continue;
      const def = STRUCTURES[s.type];
      if (def.layer !== 'floor' || s.x < tx0 - 1 || s.x > tx1 + 1 || s.y < ty0 - 1 || s.y > ty1 + 1) continue;
      if (def.tile) blit(assets.get('tiles', def.tile + (hash2(s.x, s.y, 3) * 4 | 0)), s.x * TILE, s.y * TILE);
      else if (s.type === 'floor_wood' && assets.has('tiles', 'timber_floor0')) {
        // 板の継ぎ目が隣のマスと揃うよう、座標の偶奇で決める
        blit(assets.get('tiles', `timber_floor${(s.x & 1) + 2 * (s.y & 1)}`), s.x * TILE, s.y * TILE);
      } else { const fr = prop(def.sprite); blit(fr, s.x * TILE + 16 - fr.px, s.y * TILE + 32 - fr.py); }
    }
  }

  function drawFocusMarker(f) {
    const bob = Math.round(Math.sin(R.t * 5) * 1.5);
    const x = Math.round(f.x), y = Math.round(f.y) - 8 + bob;
    ctx.fillStyle = '#1a1a1f';
    ctx.fillRect(x - 3, y - 1, 7, 1); ctx.fillRect(x - 2, y, 5, 1); ctx.fillRect(x - 1, y + 1, 3, 1); ctx.fillRect(x, y + 2, 1, 1);
    ctx.fillStyle = f.ok ? '#ffd98a' : '#8a9b95';
    ctx.fillRect(x - 2, y - 1, 5, 1); ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y + 1, 1, 1);
  }

  function drawPreview(state) {
    const pv = state.preview;
    if (!pv) return;
    const def = STRUCTURES[pv.type];
    const X = pv.x * TILE, Y = pv.y * TILE;
    const col = pv.ok ? '#6fe08a' : '#f0605a';
    const tint = [col, 0.5];
    if (!def || pv.type === 'farm' || pv.type.startsWith('plant_')) {
      ctx.globalAlpha = 0.5;
      // 新しい畑は隣と繋げず孤立形(join0)でプレビューする。無いときは従来の farmland0。どちらも pivot 分だけ左上へずらす
      const fr = assets.get('tiles', assets.has('tiles', 'farmland_join0') ? 'farmland_join0' : 'farmland0', { tint });
      blit(fr, X - fr.px, Y - fr.py);
      ctx.globalAlpha = 1;
    } else if (def.tile) {
      ctx.globalAlpha = 0.7;
      blit(assets.get('tiles', def.tile + '0', { tint }), X, Y);
      ctx.globalAlpha = 1;
    } else {
      const mods = { tint };
      if (isHalf(def)) mods.half = true;
      ctx.globalAlpha = 0.78;
      if (def.kind === 'wall' && assets.has('tiles', 'timber_wall0')) {
        // 設置後と同じく、隣と繋がる形でプレビューする
        blit(assets.get('tiles', `timber_wall${wallMask(state, state.player.map, pv.x, pv.y, { x: pv.x, y: pv.y })}`, { tint }), X, Y);
      } else {
        const fr = smallProp(def.sprite, mods, !!mods.half);
        const ax = X + 16, ay = pv.y * TILE + (def.layer === 'floor' ? 32 : 28);
        blit(fr, ax - fr.px, ay - fr.py);
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = col; ctx.globalAlpha = 0.85;
    for (let k = 0; k < TILE; k += 4) {
      ctx.fillRect(X + k, Y, 2, 1); ctx.fillRect(X + k + 2, Y + TILE - 1, 2, 1);
      ctx.fillRect(X, Y + k + 2, 1, 2); ctx.fillRect(X + TILE - 1, Y + k, 1, 2);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 粒子 ---------- */
  function handleEvents(events) {
    const add = (o) => { if (R.particles.length < 700) R.particles.push(o); };
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (const ev of events) {
      if (ev.type === 'hit' || ev.type === 'deplete') {
        const cols = ev.chip && ev.chip.length ? ev.chip : ['#b18b53'];
        const big = ev.type === 'deplete';
        const n = big ? 14 : 5;
        for (let i = 0; i < n; i++) {
          add({
            x: ev.x + rnd(-6, 6), y: ev.y + rnd(-6, 6) - (big && ev.node === 'tree' ? 18 : 0), vx: rnd(-48, 48), vy: -rnd(24, big ? 90 : 62), g: 240,
            life: 0, max: rnd(0.4, big ? 0.95 : 0.6), size: big && i % 3 === 0 ? 2 : 1, color: cols[i % cols.length],
          });
        }
      } else if (ev.type === 'step') {
        const col = { grass: '#97ad71', dirt: '#b18b53', sand: '#edcd91', stone: '#91a0a2', water: '#9ecbcc' }[ev.surface] || '#97ad71';
        for (let i = 0; i < 2; i++) add({ x: ev.x + rnd(-3, 3), y: ev.y - 1, vx: rnd(-10, 10), vy: -rnd(6, 16), g: 40, life: 0, max: rnd(0.25, 0.45), size: 1, color: col });
      } else if (ev.type === 'pickup' || ev.type === 'respawn') {
        for (let i = 0; i < 5; i++) add({ x: ev.x + rnd(-5, 5), y: ev.y - 8, vx: rnd(-12, 12), vy: -rnd(14, 34), g: -10, life: 0, max: rnd(0.4, 0.8), size: 1, color: ev.type === 'pickup' ? '#fff0af' : '#91d8af', glow: true });
      } else if (ev.type === 'place' || ev.type === 'remove') {
        for (let i = 0; i < 8; i++) add({ x: ev.x + rnd(-10, 10), y: ev.y + 8, vx: rnd(-26, 26), vy: -rnd(8, 36), g: 90, life: 0, max: rnd(0.3, 0.6), size: 1, color: '#d1aa68' });
      } else if (ev.type === 'roll') {
        for (let i = 0; i < 4; i++) add({ x: ev.x + rnd(-4, 4), y: ev.y - 1, vx: rnd(-14, 14), vy: -rnd(4, 16), g: 20, life: 0, max: 0.4, size: 1, color: '#c0cbbe' });
      } else if (ev.type === 'teleport') R.snap = true;
    }
  }

  function updateParticles(dt) {
    const ps = R.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      q.life += dt;
      if (q.life >= q.max) { ps.splice(i, 1); continue; }
      q.vy += q.g * dt;
      q.x += q.vx * dt + (q.wob ? Math.sin(q.life * 9 + q.wob) * 0.12 : 0);
      q.y += q.vy * dt;
    }
  }

  function drawParticles(glowPass) {
    for (const q of R.particles) {
      if (!!q.glow !== glowPass) continue;
      const a = 1 - q.life / q.max;
      ctx.globalAlpha = a > 0.5 ? 1 : a * 2;
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size);
    }
    ctx.globalAlpha = 1;
  }

  function updateFlies(state, map, amb, dt) {
    const want = !R.calm && map.id === 'surface' && amb < 0.85 ? Math.round((1 - amb) * 16) : 0;
    const fl = R.flies;
    while (fl.length < want) fl.push({ x: 0, y: 0, ph: Math.random() * 6, init: false });
    while (fl.length > want) fl.pop();
    for (const f of fl) {
      if (!f.init || f.x < R.drawCamX - 40 || f.x > R.drawCamX + R.viewW + 40 || f.y < R.drawCamY - 40 || f.y > R.drawCamY + R.viewH + 40) {
        f.x = R.drawCamX + Math.random() * R.viewW; f.y = R.drawCamY + Math.random() * R.viewH; f.init = true;
      }
      f.ph += dt;
      f.x += Math.sin(f.ph * 0.9 + f.y * 0.05) * 6 * dt;
      f.y += Math.cos(f.ph * 0.7 + f.x * 0.04) * 5 * dt;
    }
  }

  function drawFlies(map) {
    if (R.calm) return;
    for (const f of R.flies) {
      const t = terrainAt(map, Math.floor(f.x / TILE), Math.floor(f.y / TILE));
      if (t !== T.GRASS && t !== T.DARKGRASS && t !== T.MOSS) continue;
      const b = Math.sin(f.ph * 2.6);
      if (b < -0.2) continue;
      ctx.globalAlpha = Math.min(1, 0.5 + b * 0.6);
      ctx.fillStyle = '#e8f6a8';
      ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#c4e87a';
      ctx.fillRect(Math.round(f.x) - 1, Math.round(f.y), 3, 1); ctx.fillRect(Math.round(f.x), Math.round(f.y) - 1, 1, 3);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 光 ---------- */
  function lightPass(map, amb, warm, sky) {
    const S = R.scale, k = S / 4;
    const lw = lightCv.width, lh = lightCv.height;
    // sky.js の板の表から暗幕の色と alpha(上限 0.97)。23時は昼の見た目に対してほぼ黒になる。skyModel=false の時だけ旧式(alpha 上限 0.86)
    const cur = TOG.skyModel && sky ? curtain2D(sky) : null;
    if (cur ? cur.alpha > 0.001 : amb < 0.995) {
      const night = [10, 18, 44], dusk = [255, 150, 82];
      const dark = map.id === 'underground' ? [5, 9, 20] : night;
      const col = cur ? cur.color : dark.map((c, i) => Math.round(lerp(c, dusk[i], warm * 0.85)));
      const alpha = (cur ? cur.alpha : Math.min(0.86, (1 - amb) * (map.id === 'underground' ? 0.95 : 0.8))) * (1 - 0.6 * R.arenaLift);
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, lw, lh);
      lctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
      lctx.fillRect(0, 0, lw, lh);
      lctx.globalCompositeOperation = 'destination-out';
      for (const L of lights) {
        const fl = R.calm ? 1 : 1 + (Math.sin(R.t * 9 + L.id * 1.7) * 0.03 + Math.sin(R.t * 23 + L.id) * 0.02) * L.flicker;
        const lx = (L.x - R.drawCamX) * k, ly = (L.y - R.drawCamY) * k, lr = L.r * TILE * k * fl;
        const g = lctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
        const pw = Math.min(1, 0.95 * L.power);
        g.addColorStop(0, `rgba(0,0,0,${pw})`);
        g.addColorStop(0.5, `rgba(0,0,0,${pw * 0.62})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        lctx.fillStyle = g;
        lctx.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
      }
      lctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(lightCv, 0, 0, lw, lh, 0, 0, R.devW, R.devH);
      ctx.imageSmoothingEnabled = false;
    }
    if (lights.length) {
      gctx.clearRect(0, 0, lw, lh);
      gctx.globalCompositeOperation = 'lighter';
      const gi = 0.1 + (1 - amb) * 0.5;
      for (const L of lights) {
        if (L.power <= 0 || L.noGlow) continue;
        const fl = R.calm ? 1 : 1 + (Math.sin(R.t * 11 + L.id * 2.3) * 0.05) * L.flicker;
        const lx = (L.x - R.drawCamX) * k, ly = (L.y - R.drawCamY) * k, lr = L.r * TILE * k * 0.7 * fl;
        const g = gctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
        const c = L.color;
        g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.55 * gi * L.power})`);
        g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        gctx.fillStyle = g;
        gctx.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
      }
      gctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowCv, 0, 0, lw, lh, 0, 0, R.devW, R.devH);
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
    }
    drawVignette();
  }

  function drawVignette() {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(vigCv, 0, 0, vigCv.width, vigCv.height, 0, 0, R.devW, R.devH);
    ctx.imageSmoothingEnabled = false;
  }

  /* ---------- GL照明(lighting.js) ---------- */
  // 使うかどうかをframeの最初に決める。使えない理由は LS.reason に残す
  function pickLighting(nw, nh) {
    LS.w = nw; LS.h = nh; LS.device.w = R.devW; LS.device.h = R.devH;
    if (LS.mode === '2d') { LS.reason = 'mode-2d'; return false; }
    // 縦画面も同じ画素予算で扱う。390x844は720x450とほぼ同じ負荷。
    if (Math.max(nw, nh) > MAX_GL_W || nw * nh > MAX_GL_W * MAX_GL_H) { LS.reason = 'resolution'; return false; }
    if (LS.slow && LS.mode === 'auto') { LS.reason = 'slow'; return false; }
    if (!lighting && !lightingTried) {
      lightingTried = true;
      lighting = createLighting({ maxLights: coarse ? 4 : 8, steps: coarse ? 6 : 8 });
    }
    if (!lighting) { LS.reason = 'unsupported'; return false; }
    LS.contextLost = lighting.isLost();
    if (LS.contextLost) { LS.reason = 'context-lost'; return false; }
    LS.reason = 'gl';
    return true;
  }

  // 遮蔽テクスチャ: R=固体(洞窟壁・崖・壁・閉じた扉) G=屋内(プレイヤーが家の中にいる間だけ、その家の床)。画面の4タイル外まで
  function buildOcc(state, map, tx0, ty0, tx1, ty1) {
    const x0 = Math.max(0, tx0 - 4), y0 = Math.max(0, ty0 - 4), x1 = Math.min(map.w - 1, tx1 + 4), y1 = Math.min(map.h - 1, ty1 + 4);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return null;
    if (!occBuf || occBuf.length !== w * h * 2) occBuf = new Uint8Array(w * h * 2); else occBuf.fill(0);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isWallTile(map, tx, ty)) occBuf[((ty - y0) * w + tx - x0) * 2] = 255;
    for (const s of state.structures) {
      if (s.map !== map.id || s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
      const kind = STRUCTURES[s.type].kind;
      if (kind === 'wall' || (kind === 'door' && !s.open)) occBuf[((s.y - y0) * w + s.x - x0) * 2] = 255;
    }
    const ptx = Math.floor(state.player.x / TILE), pty = Math.floor(state.player.y / TILE);
    for (const hs of state.houses || []) {
      if (!hs.valid || hs.map !== map.id || !hs.cells.some(([x, y]) => x === ptx && y === pty)) continue;
      for (const [x, y] of hs.cells) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) occBuf[((y - y0) * w + x - x0) * 2 + 1] = 255;
    }
    return { x0, y0, w, h, data: occBuf };
  }

  // 投影影バッファ: 記録した遮る物の height 画像を、足元の行を軸に影の向きへ傾けて 'lighten' で重ねる(R=遮る物の高さ/64、0=無し)。
  // 画素 (u,v) の高さ h = 足元y − 画素y。影は (X + vx·h, 足元y + vy·h) に落ちる。vec は native px/高さ1px
  function buildShadowBuffer(nw, nh, camX, camY, vec) {
    const t0 = performance.now(), k = SHADOW_SCALE;
    const w = Math.max(2, Math.ceil(nw * k)), h = Math.max(2, Math.ceil(nh * k));
    if (shCv.width !== w || shCv.height !== h) { shCv.width = w; shCv.height = h; }
    shCtx.setTransform(1, 0, 0, 1, 0, 0);
    shCtx.globalCompositeOperation = 'source-over';
    shCtx.fillStyle = '#000';
    shCtx.fillRect(0, 0, w, h);
    shCtx.globalCompositeOperation = 'lighten';
    shCtx.imageSmoothingEnabled = false;
    const vx = vec[0], vy = Math.abs(vec[1]) < 0.02 ? (vec[1] < 0 ? -0.02 : 0.02) : vec[1];
    let drawn = 0;
    for (let i = 0; i < capN; i++) {
      const c = casters[i];
      const sxs = c.dx - camX, fy = c.foot - camY, b = c.dy - c.foot;
      // 影の長さは高さ64pxで最大 2.5×64=160px。それより外の物は影も画面に届かない
      if (sxs > nw + 160 || sxs + c.sw < -160 || fy < -200 || fy > nh + 200) { SH.skipped++; continue; }
      shCtx.setTransform(k, 0, -vx * k, -vy * k, k * (sxs - vx * b), k * (fy - vy * b));
      shCtx.drawImage(c.fr.himg, c.fr.x + c.sx, c.fr.y + c.sy, c.sw, c.sh, 0, 0, c.sw, c.sh);
      drawn++;
    }
    shCtx.setTransform(1, 0, 0, 1, 0, 0);
    shCtx.globalCompositeOperation = 'source-over';
    SH.casters = capN; SH.drawn = drawn; SH.w = w; SH.h = h; SH.ms = performance.now() - t0;
    return shCv;
  }

  // 局所光(たいまつ・焚き火・腰の灯)の地面影アトラス。灯ごとに足元を中心とする 2·PT_HALF px 四方のセルを横に並べる(上限 MAX_PT 灯、coarse は2灯)。
  // 遮る物の height 画像を、その物の足元が光源の足元から遠ざかる向きへ傾けて 'lighten' で描く(v = (足元−光源の足元)/光源の高さ、長さは1.6まで)。
  // 灯自身の物(足元が10px以内)は落とさない。1灯あたりの描画は PT_MAX_DRAW 件まで、灯の半径+影の最大長の外の物は描かない。canvas は使い回し
  const PT_MAX_DRAW = 64, PT_STRENGTH = 0.8;
  const ptCand = [], ptEntries = [];
  const PT = { lights: 0, drawn: 0, skipped: 0, w: 0, h: 0, ms: 0, bytes: 0 };
  function buildPointShadows(nw, nh, camX, camY) {
    const t0 = performance.now(), s = SHADOW_SCALE, cell = Math.ceil(2 * PT_HALF * s);
    const px = R.camX + R.viewW / 2, py = R.camY + R.viewH / 2;
    ptCand.length = 0; ptEntries.length = 0;
    for (const L of lights) {
      if (!L.src || !(L.power > 0.2)) continue;
      const x = L.src.x - camX, y = L.src.y - camY;
      if (x < -PT_HALF || y < -PT_HALF || x > nw + PT_HALF || y > nh + PT_HALF) continue;
      L.ptKey = L.id === 99 ? -1 : Math.hypot(L.src.x - px, L.src.y - py);
      ptCand.push(L);
    }
    ptCand.sort((a, b) => a.ptKey - b.ptKey);
    const n = Math.min(ptCand.length, coarse ? 2 : MAX_PT);
    PT.lights = n; PT.drawn = 0; PT.skipped = ptCand.length - n;
    if (!n) { PT.w = 0; PT.h = 0; PT.ms = 0; PT.bytes = 0; return null; }
    const w = cell * MAX_PT;
    if (shpCv.width !== w || shpCv.height !== cell) { shpCv.width = w; shpCv.height = cell; }
    shpCtx.setTransform(1, 0, 0, 1, 0, 0);
    shpCtx.globalCompositeOperation = 'source-over';
    shpCtx.fillStyle = '#000';
    shpCtx.fillRect(0, 0, w, cell);
    shpCtx.globalCompositeOperation = 'lighten';
    shpCtx.imageSmoothingEnabled = false;
    for (let j = 0; j < n; j++) {
      const L = ptCand[j], lampH = Math.max(4, L.src.h);
      const fxs = L.src.x - camX, fys = L.src.y - camY, ox = fxs - PT_HALF, oy = fys - PT_HALF, reach = L.r * TILE + 40;
      shpCtx.save();
      shpCtx.setTransform(1, 0, 0, 1, 0, 0);
      shpCtx.beginPath(); shpCtx.rect(j * cell, 0, cell, cell); shpCtx.clip();
      let drawn = 0;
      for (let i = 0; i < capN && drawn < PT_MAX_DRAW; i++) {
        const c = casters[i];
        const sxs = c.dx - camX, fy = c.foot - camY, cxs = sxs + c.sw / 2;
        const dx = cxs - fxs, dy = fy - fys;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) continue;
        if (dx * dx + dy * dy > reach * reach) continue;
        let vx = dx / lampH, vy = dy / lampH;
        const vl = Math.hypot(vx, vy);
        if (vl > 1.6) { vx *= 1.6 / vl; vy *= 1.6 / vl; }
        if (Math.abs(vy) < 0.05) vy = vy < 0 ? -0.05 : 0.05;
        const b = c.dy - c.foot;
        shpCtx.setTransform(s, 0, -vx * s, -vy * s, s * (sxs - ox - vx * b) + j * cell, s * (fy - oy - vy * b));
        shpCtx.drawImage(c.fr.himg, c.fr.x + c.sx, c.fr.y + c.sy, c.sw, c.sh, 0, 0, c.sw, c.sh);
        drawn++;
      }
      shpCtx.restore();
      PT.drawn += drawn;
      ptEntries.push({ light: L, x: fxs, y: fys, h: lampH, strength: PT_STRENGTH });
    }
    shpCtx.setTransform(1, 0, 0, 1, 0, 0);
    shpCtx.globalCompositeOperation = 'source-over';
    PT.w = w; PT.h = cell; PT.bytes = w * cell * 4; PT.ms = performance.now() - t0;
    return { canvas: shpCv, cell, th: coarse ? 3 : 1.5, entries: ptEntries };
  }

  // 明るさ・太陽/月・空はすべて sky.js の skyAt() の値(linear)。GL へ毎フレーム渡す。skyModel=false の時だけ旧式(昼の量から)
  function lightParams(map, amb, warm, camX, camY, sky) {
    const base = { camX, camY, t: R.t, calm: R.calm, tile: TILE, lights, debug: LS.debug, steps: coarse ? 6 : 8, gain: TOG.legacyGain };
    if (!TOG.skyModel) {
      const D = BALANCE.day, under = map.id === 'underground';
      const day = under ? 0 : smooth((amb - D.nightLight) / (1 - D.nightLight));
      const level = (under ? 0.035 : lerp(0.06, 0.55, day)) + R.arenaLift * 0.2;
      const tint = [lerp(0.62, 0.96, day), lerp(0.82, 1, day), lerp(1.25, 1.04, day)].map((c, i) => lerp(c, [1.15, 0.8, 0.6][i], warm * 0.5));
      const sunColor = [1, 0.96, 0.86].map((c, i) => lerp(c, [1, 0.5, 0.22][i], warm));
      return { ...base, sunStrength: 0.6 * day, sunColor, skyColor: tint.map((c) => c * level) };
    }
    const params = {
      ...base,
      sunDir: sky.sun.dir, sunColor: sky.sun.color, sunStrength: sky.sun.up ? sky.sun.vis : 0,
      moonDir: sky.moon.dir, moonColor: sky.moon.up ? sky.moon.color : [0, 0, 0], moonStrength: sky.moon.up ? sky.moon.vis : 0,
      skyColor: sky.sky,
      // 局所光は昼に弱く、夜に1。lighting.js の LIGHT_GAIN は夜(板 ≈ 6)に合わせた値
      lightScale: 1 - 0.8 * sky.dayness,
    };
    const sh = sky.shadow;
    if (TOG.projectedShadows && sh.caster !== 'none' && sh.strength > 0.001 && !sky.underground) {
      params.shadow = {
        canvas: buildShadowBuffer(colorCv.width, colorCv.height, camX, camY, sh.vec), vec: sh.vec, strength: sh.strength,
        kind: sh.caster === 'moon' ? 'moon' : 'sun', th: coarse ? 3 : 1.5,
      };
      SH.kind = params.shadow.kind; SH.vec = sh.vec; SH.strength = sh.strength;
    } else { SH.kind = 'none'; SH.strength = 0; SH.vec = [0, 0]; SH.casters = capN; SH.drawn = 0; SH.w = 0; SH.h = 0; }
    if (TOG.projectedShadows && TOG.pointShadows) {
      const pt = buildPointShadows(colorCv.width, colorCv.height, camX, camY);
      if (pt) params.ptShadow = pt;
    } else { PT.lights = 0; PT.drawn = 0; PT.w = 0; PT.h = 0; PT.ms = 0; PT.bytes = 0; }
    return params;
  }

  // GLで合成して可視canvasへ整数倍のnearestで転写する。失敗時はcolorだけを転写し、呼び出し側が2D照明を重ねる
  function presentGL(state, map, amb, warm, camX, camY, tiles, sky) {
    const nw = colorCv.width, nh = colorCv.height, S = R.scale;
    const t0 = performance.now();
    const params = lightParams(map, amb, warm, camX, camY, sky);
    recordSkyStats(sky, params);
    let out = null;
    try { out = lighting.render(colorCv, normalCv, heightCv, buildOcc(state, map, ...tiles), params); } catch (err) {
      console.warn('[Mosslight] WebGL2照明の描画に失敗しました。2D照明へ戻します。', err);
      lighting.dispose(); lighting = null;
    }
    const t1 = performance.now();
    visCtx.setTransform(1, 0, 0, 1, 0, 0);
    visCtx.imageSmoothingEnabled = false;
    visCtx.drawImage(out || colorCv, 0, 0, nw, nh, 0, 0, nw * S, nh * S);
    const t2 = performance.now();
    if (!out) { LS.reason = 'gl-failed'; return false; }
    const st = lighting.stats;
    LS.lights = st.lights; LS.culled = st.culled; LS.steps = st.steps; LS.sunStrength = st.sunStrength;
    LS.shadow.uploadBytes = st.shadowBytes; LS.shadow.projected = st.shadowKind !== 'none';
    LS.glErrors = LS.errorCount = st.errorCount;
    LS.ms.upload = st.ms.upload; LS.ms.gl = Math.max(0, t1 - t0 - st.ms.upload); LS.ms.copy = t2 - t1;
    // 性能: 60frameの中央値が6ms(upload+gl+copy)を超える窓が3回続いたら、autoでは2Dへ戻す
    LS.samples.push(LS.ms.upload + LS.ms.gl + LS.ms.copy);
    if (LS.samples.length >= 60) {
      LS.samples.sort((a, b) => a - b);
      LS.slowRuns = LS.samples[30] > 6 ? LS.slowRuns + 1 : 0;
      LS.samples.length = 0;
      if (LS.slowRuns >= 3 && LS.mode === 'auto') LS.slow = true;
    }
    return true;
  }

  // getLightingStats の空・時刻・太陽・影。GL でも 2D でも毎フレーム更新する。
  // plateDisplay: 灰色128・水平な地面・影なし・局所光なしの板の sRGB 表示値(sky.js がシェーダと同じ式で再計算)。19時は sunStrength=0、23時は板が ≈ 5〜6
  function recordSkyStats(sky, params) {
    LS.hour = sky.hour;
    LS.sunStrength = params.sunStrength || 0;
    LS.moonStrength = params.moonStrength || 0;
    LS.sunDir = params.sunDir ? [params.sunDir[0], params.sunDir[1], params.sunDir[2]] : [0, 0, 0];
    LS.sky = {
      model: TOG.skyModel, underground: !!sky.underground, phase: sky.mood.phase, dayness: sky.dayness, dark: sky.dark,
      sunUp: sky.sun.up, sunElevDeg: sky.sun.elevDeg, sunVis: sky.sun.vis, moonUp: sky.moon.up, moonVis: sky.moon.vis,
      skyColor: [sky.sky[0], sky.sky[1], sky.sky[2]], plateDisplay: plateDisplay(sky), lightScale: params.lightScale == null ? 1 : params.lightScale,
    };
    LS.shadow.kind = SH.kind; LS.shadow.strength = SH.strength; LS.shadow.vec = [SH.vec[0], SH.vec[1]];
    LS.shadow.casters = SH.casters; LS.shadow.drawn = SH.drawn; LS.shadow.skipped = SH.skipped;
    LS.shadow.w = SH.w; LS.shadow.h = SH.h; LS.shadow.ms = SH.ms; LS.shadow.scale = SHADOW_SCALE;
    // 局所光の地面影の実測(CPU: アトラスを描く時間。GPU は lighting の ms.gl に含まれ、別には測れない)。数値は毎フレームの実測で、固定の目安ではない
    LS.shadow.point = { lights: PT.lights, drawn: PT.drawn, skipped: PT.skipped, w: PT.w, h: PT.h, ms: PT.ms, bytes: PT.bytes, casterCap: MAX_CASTERS, drawCap: PT_MAX_DRAW };
  }

  function setLightingMode(m) {
    if (m !== 'auto' && m !== 'gl' && m !== '2d') return LS.mode;
    LS.mode = m; LS.slow = false; LS.slowRuns = 0; LS.samples.length = 0;
    return m;
  }
  function setLightingDebug(d) {
    LS.debug = ['off', 'normal', 'height', 'shadow', 'light', 'sun', 'sky', 'albedo', 'irradiance'].includes(d) ? d : 'off';
    return LS.debug;
  }
  function getLightingStats() {
    const { slow, slowRuns, samples, ...pub } = LS;
    return {
      ...pub, ms: { ...LS.ms }, device: { ...LS.device }, native: { w: LS.w, h: LS.h },
      sky: LS.sky ? { ...LS.sky } : null, shadow: { ...LS.shadow }, sunDir: LS.sunDir.slice(),
    };
  }
  function getVisualStats() { return { toggles: { ...TOG }, lighting: getLightingStats(), ground: { ...VS.ground } }; }
  function setVisualToggle(k, v) { if (k in TOG) TOG[k] = v; return TOG[k]; }

  /* ---------- カメラ ---------- */
  function updateCamera(state, map, dt, view) {
    const p = state.player;
    let cx, cy;
    if (view && view.cam) { cx = view.cam.x; cy = view.cam.y; }
    else { cx = p.x + p.fx * 14; cy = p.y - 16 + p.fy * 6; }
    const tx = cx - R.viewW / 2, ty = cy - R.viewH / 2;
    if (!R.camReady || R.snap) { R.camX = tx; R.camY = ty; R.camReady = true; R.snap = false; }
    else {
      const k = 1 - Math.exp(-7 * dt);
      R.camX += (tx - R.camX) * k; R.camY += (ty - R.camY) * k;
    }
    const maxX = map.w * TILE - R.viewW, maxY = map.h * TILE - R.viewH;
    R.camX = maxX > 0 ? Math.max(0, Math.min(maxX, R.camX)) : maxX / 2;
    R.camY = maxY > 0 ? Math.max(0, Math.min(maxY, R.camY)) : maxY / 2;
  }

  function snapCamera() { R.snap = true; }

  /* ---------- 1フレーム ---------- */
  // buffer外の表示(配置プレビュー・焦点・粒子)。GL照明時は合成後に等倍×Sで重ね、光の影響を受けない
  function drawOverlays(state, view) {
    ctx.setTransform(R.scale, 0, 0, R.scale, -R.drawCamX * R.scale, -R.drawCamY * R.scale);
    if (state.preview) drawPreview(state);
    if (state.focus && !view.hideFocus) drawFocusMarker(state.focus);
    drawParticles(false);
  }

  function render(state, view = {}) {
    const dt = Math.min(view.dt != null ? view.dt : 1 / 60, 0.1);
    R.t += dt;
    R.calm = !!view.calm;
    const p = state.player;
    const map = state.world.maps[p.map];
    if (!R.devW || R.devW !== canvas.width) resize();
    updateCamera(state, map, dt, view);
    // 空は1フレームに1回。影の向き(2D接地影)・腰の灯の要否・GL/2D の暗さが同じ値を使う(arenaLift は地下の下限だけ)
    const sky = skyAt(hourOf(state.time.clock), map.id, { arenaLift: R.arenaLift });
    // 地上の手提げ灯は、腰に見える灯を描く時だけ光る(見えない光源を作らない)。位置は描いた灯と同じ
    VS.sky = sky;
    const hip = hipPos(state.player);
    const hipOn = map.id !== 'underground' && TOG.handLight && sky.dayness < 0.9 && hip.visible;
    R.hipOn = hipOn;

    const S = R.scale;
    const camX = Math.round(R.camX), camY = Math.round(R.camY);
    R.drawCamX = camX; R.drawCamY = camY;
    const tScene = performance.now();
    const nw = Math.ceil(R.devW / S), nh = Math.ceil(R.devH / S);
    const useGL = pickLighting(nw, nh);
    visCtx.setTransform(1, 0, 0, 1, 0, 0);
    visCtx.imageSmoothingEnabled = false;
    visCtx.globalAlpha = 1; visCtx.globalCompositeOperation = 'source-over';
    if (useGL) {
      // シーンは native 解像度・整数camの等倍で描き、blitが color/normal/height の3枚へ同じ位置に描く
      for (const [c, cvs, fill] of [[colorCtx, colorCv, '#0b100d'], [nctx, normalCv, '#808000'], [hctx, heightCv, '#00c880']]) {
        if (cvs.width !== nw || cvs.height !== nh) { cvs.width = nw; cvs.height = nh; }
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.imageSmoothingEnabled = false;
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
        c.fillStyle = fill;
        c.fillRect(0, 0, nw, nh);
        c.setTransform(1, 0, 0, 1, -camX, -camY);
      }
      ctx = colorCtx; layered = true;
    } else {
      ctx = visCtx; layered = false;
      ctx.fillStyle = '#0b100d';
      ctx.fillRect(0, 0, R.devW, R.devH);
      ctx.setTransform(S, 0, 0, S, -camX * S, -camY * S);
    }

    const vw = Math.ceil(R.devW / S) + 2, vh = Math.ceil(R.devH / S) + 2;
    const tx0 = Math.max(0, Math.floor(camX / TILE)), ty0 = Math.max(0, Math.floor(camY / TILE));
    const tx1 = Math.min(map.w - 1, Math.floor((camX + vw) / TILE)), ty1 = Math.min(map.h - 1, Math.floor((camY + vh) / TILE));
    lights.length = 0;

    drawTerrain(map, tx0, ty0, tx1, ty1);
    if (map.id === 'underground') drawCaveWalls(state, map, tx0, ty0, tx1, ty1);
    else drawCliffs(map, tx0, ty0, tx1, ty1);
    drawFloors(state, map, tx0, ty0, tx1, ty1);
    drawFarmland(state, map);
    drawGroundDetails(state, map, tx0, ty0, tx1, ty1);
    drawArenaFlat(map, tx0, ty0, tx1, ty1);
    drawDeco(map, tx0, ty0, tx1, ty1);
    drawTelegraphs(state, map);

    collectScene(state, map, tx0, ty0, tx1, ty1);
    drawShadows(state, map);
    const focusRef = state.focus ? state.focus.ref : null;
    capN = 0; SH.skipped = 0;
    const capture = useGL && TOG.projectedShadows && TOG.skyModel;
    for (const it of sortList) {
      if (capture) {
        const foot = casterFoot(it);
        capOn = foot != null; capFoot = foot;
      }
      if (it.kind === 0) drawNode(state, it.ref, dt, focusRef, 1);
      else if (it.kind === 1) drawStructure(state, it.ref, focusRef);
      else if (it.kind === 2) drawGroundItem(state, it.ref, focusRef);
      else if (it.kind === 3) drawHero(state, focusRef);
      else if (it.kind === 4) drawEnemy(state, it.ref);
      else if (it.kind === 5) drawResident(state, it.ref, focusRef);
      else if (it.kind === 6) drawCrop(it.ref);
      else if (it.kind === 7) drawDeathBag(it.ref);
      else if (it.kind === 8) drawSceneryItem(it.ref);
    }
    capOn = false;
    // 大きなボスに隠れた時だけ、半透明の輪郭でプレイヤーの位置を保つ。
    const occluded = (state.enemies || []).some(e => e.boss && e.map === p.map && e.hp > 0 &&
      p.y < e.y && p.y > e.y - 108 && Math.abs(p.x-e.x) < 48);
    if (occluded) {
      const fr = assets.get('actors', heroFrameName(p), { outline: '#ffe9a8' });
      ctx.save(); ctx.globalAlpha = .68;
      blit(fr, Math.round(p.x)-fr.px, Math.round(p.y)-fr.py);
      ctx.restore();
    }
    drawProjectiles(state, map);
    drawRoofs(state, map, dt);
    layered = false;
    LS.ms.scene = performance.now() - tScene;

    // 2D照明: 従来どおり、プレビュー・焦点・粒子も暗幕の下に置く
    updateParticles(dt);
    if (!useGL) drawOverlays(state, view);

    // 空: GL の明るさ・太陽・月・影、2D の暗幕、プレイヤーの光の要否、すべてこの1回の skyAt から(arenaLift は地下の下限だけ上げる)
    VS.sky = sky; VS.hour = sky.hour; VS.clock = state.time.clock; VS.mapId = map.id;
    const { amb, warm } = sky;
    // プレイヤー自身の光。地上の夜は半径1.6タイル・power 0.35 の手提げ灯だけ(旧 nightRadius 2 の大きな光は廃止)。地下は従来の caveRadius
    const D = BALANCE.day;
    let pr = 0, ppw = 0.8;
    if (map.id === 'underground') pr = D.caveRadius;
    else if (hipOn) { pr = 1.6; ppw = 0.35; }
    for (const b of p.buffs) if (b.id === 'light' && b.until > state.time.clock && map.id === 'underground') pr += b.v;
    if (pr > 0) {
      // 手提げ灯は見える腰の灯と同じ位置から出す。それ以外(地下の常時光など)は主人公の中心
      const lx = hipOn ? hip.x : p.x, ly = hipOn ? hip.y : p.y - 14;
      addLight(lx, ly, pr, [255, 224, 170], 0, ppw, 99, false, hipOn ? { x: lx, y: ly + hip.h, h: hip.h } : null);
    }
    // 闘技場の安定した照明: 近づくと滑らかに明るくなり、離れると洞窟の暗さへ戻る。ボスが生きている間は離れても保つ
    const arena = arenaState(state, map);
    const fighting = !!state.boss && map.id === 'underground';
    R.arenaLift += ((arena || fighting ? 1 : 0) - R.arenaLift) * Math.min(1, dt * 4);
    if (arena && R.arenaLift > 0.01) {
      const a = arena.a, tint = ARENA_TINT[arena.kind];
      addLight((a.x + 0.5) * TILE, (a.y + 0.5) * TILE - 8, a.r + 2.5, tint, 0, 0.85 * R.arenaLift, 900 + a.x, true);
    }

    updateFlies(state, map, amb, dt);
    // GLで合成できた時は2Dの暗幕・glowを描かない(二重照明の防止)。できなかった時だけ、colorを転写した上に2D照明を重ねる
    let glDone = false;
    if (useGL) {
      ctx = visCtx;
      glDone = presentGL(state, map, amb, warm, camX, camY, [tx0, ty0, tx1, ty1], sky);
      ctx.setTransform(S, 0, 0, S, -camX * S, -camY * S);
      drawOverlays(state, view);
    }
    LS.active = glDone ? 'gl' : '2d';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (glDone) drawVignette();
    else {
      // GL を使わなかった/失敗した時も同じ sky の値を統計に出す(2D でも 19時の sunStrength=0・23時の暗さを検証できる)
      if (!useGL) { SH.kind = 'none'; SH.strength = 0; SH.casters = 0; SH.drawn = 0; recordSkyStats(sky, TOG.skyModel ? { sunStrength: sky.sun.up ? sky.sun.vis : 0, moonStrength: sky.moon.up ? sky.moon.vis : 0, sunDir: sky.sun.dir } : {}); }
      lightPass(map, amb, warm, sky);
    }
    ctx.setTransform(S, 0, 0, S, -camX * S, -camY * S);
    drawFlies(map);
    drawParticles(true);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    R.rendered++;
  }

  return {
    assets, render, resize, setScale, screenToWorld, worldToScreen, handleEvents, snapCamera,
    setLightingMode, setLightingDebug, getLightingStats, getVisualStats, setVisualToggle,
    getScale: () => R.scale,
    getView: () => ({ x: R.drawCamX, y: R.drawCamY, w: R.viewW, h: R.viewH, scale: R.scale }),
    get frames() { return R.rendered; },
  };
}
