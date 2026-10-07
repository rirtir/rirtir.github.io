// VISUAL_REWORK3 / RUNTIME_REWORK3 の回帰検証。ブラウザの純JSだけで動く(アセット・DOMのゲーム本体は不要)。
// 1) sky.js の実関数: 19時・23時の太陽0と暗さ、17時の暖色、午前/午後で影の向きが反転すること
// 2) ground.js の実関数: 世界座標の決定的なマスク。独立した分割の bakeRegion が color/normal/height とも同一バイト、旧い白縁が無い
// 3) lighting.js の実GL合成(WebGL2がある時だけ): 板の表示値が skyAt と一致、点光源の向き・鏡像の法線・影アトラスの対応
// 4) 足元の楕円(world.js の nodeFootprint): 反転した木の当たりが反転すること(衝突そのものは gameplay.js)
// WebGL2が無い環境では3)を「SKIP」と明記して通す(合格とは数えない: result.skipped に残る)
import { skyAt, plateDisplay, plateMean, hourOf, DAY_TICKS } from '../sky.js';
import * as Ground from '../ground.js';
import { createLighting, MAX_PT, PT_HALF } from '../lighting.js';
import { createWorld, nodeFootprint } from '../world.js';
import { NODES, FOOTPRINTS, nodeMirrored, baseSprite } from '../data.js';

export function runVisualRework3Tests() {
  const checks = [], skipped = [];
  const check = (name, ok, detail = '') => checks.push({ name: `視覚3: ${name}`, ok: !!ok, detail: String(detail) });
  const skip = (name, why) => { skipped.push(`${name}: ${why}`); checks.push({ name: `視覚3: SKIP ${name}`, ok: true, detail: `未実行(${why})` }); };

  testSky(check);
  testGround(check);
  testLighting(check, skip);
  testFootprints(check);
  return { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks, skipped };
}

/* ------------------------------------------------------------------ 空 */
function testSky(check) {
  // 時計 → 時刻(ui.js と同じ式)。06:00 が tod 0
  check('時計 0 は 06:00、300 は 18:00', hourOf(0) === 6 && Math.abs(hourOf(DAY_TICKS / 2) - 18) < 1e-9);

  for (const h of [19, 23]) {
    const s = skyAt(h);
    check(`${h}時は太陽の放射が厳密に 0`, s.sun.vis === 0 && !s.sun.up && s.sun.color.every((c) => c === 0), JSON.stringify(s.sun));
  }
  const s19 = skyAt(19), s23 = skyAt(23), s12 = skyAt(12), s17 = skyAt(17);
  const mean19 = plateMean(s19), mean23 = plateMean(s23);
  check('23時の板(灰色128・水平・影なし)は平均 10 以下で無彩色に近い', mean23 <= 10 && spread(plateDisplay(s23)) <= 8, JSON.stringify(plateDisplay(s23)));
  check('19時は暗い(板の平均 28 未満)が 23時よりは明るい', mean19 < 28 && mean19 > mean23, `19時=${mean19.toFixed(1)} 23時=${mean23.toFixed(1)}`);
  check('正午は明るく無彩色に近い(平均 120 以上・色の開き 10 以下)', plateMean(s12) >= 120 && spread(plateDisplay(s12)) <= 10, JSON.stringify(plateDisplay(s12)));
  const d17 = plateDisplay(s17);
  check('17時は暖色の夕方(R が B より 30 以上高い)', d17[0] - d17[2] >= 30 && d17[0] > d17[1], JSON.stringify(d17));
  check('17時の太陽の色は低い太陽ほど赤い(R/B ≥ 1.6)', s17.sun.up && s17.sun.color[0] >= 1.6 * s17.sun.color[2], JSON.stringify(s17.sun.color));

  // 午前と午後で影の向きが逆(東の朝日は影を西へ)。正午は低い仰角の朝夕より影が短い
  const am = skyAt(9).shadow, pm = skyAt(15).shadow, noon = s12.shadow, dusk = s17.shadow;
  check('午前(9時)の影は太陽の反対側(画面左 vx<0)、午後(15時)は右(vx>0)', am.caster === 'sun' && pm.caster === 'sun' && am.vec[0] < -0.2 && pm.vec[0] > 0.2, `am=${am.vec} pm=${pm.vec}`);
  check('正午の影は朝夕より短い', Math.hypot(...noon.vec) < Math.hypot(...am.vec) && Math.hypot(...noon.vec) < Math.hypot(...dusk.vec), `noon=${noon.vec} am=${am.vec} dusk=${dusk.vec}`);
  check('昼の太陽の影は強さ 0.3 以上、夜(23時)は太陽の影なし', am.strength >= 0.3 && skyAt(23).shadow.caster !== 'sun', `${am.strength} ${skyAt(23).shadow.caster}`);
  // 時刻が連続的に変わる: 隣り合う15分で影の向きが飛ばない(1 時間ごとに走査)
  let maxJump = 0;
  for (let h = 7; h < 17; h += 0.25) { const a = skyAt(h).shadow.vec, b = skyAt(h + 0.25).shadow.vec; maxJump = Math.max(maxJump, Math.hypot(a[0] - b[0], a[1] - b[1])); }
  check('昼の影の向きは 15 分刻みで 1.0 以上は飛ばない', maxJump < 1.0, maxJump.toFixed(3));
  // 地下は太陽・月とも無し
  const u = skyAt(12, 'underground');
  check('地下は昼でも太陽の影なし・暗い', u.shadow.caster === 'none' && u.sun.vis === 0 && plateMean(u) < 40, plateMean(u));
}
const spread = (d) => Math.max(...d) - Math.min(...d);

/* ------------------------------------------------------------------ 地面 */
// 決定的な疑似地形。tx,ty の純関数(Math.random なし)。左側は材質が少なく、右下は4材質が接する
function makeSpec(textured, scatter = true) {
  const M = Ground.MAT;
  const palette = [M.grass, M.dirt, M.path, M.moss, M.sand, M.darkgrass, M.farmland, M.water];
  const matAt = (tx, ty) => {
    const a = Ground.hashf(Math.floor(tx / 3), Math.floor(ty / 3), 11), b = Ground.hashf(tx, ty, 12);
    return palette[Math.floor((a * 0.8 + b * 0.2) * palette.length) % palette.length];
  };
  const flat = [];
  flat[M.grass] = [90, 150, 70]; flat[M.dirt] = [140, 100, 60]; flat[M.path] = [170, 140, 90]; flat[M.moss] = [70, 130, 110];
  flat[M.sand] = [200, 180, 120]; flat[M.darkgrass] = [40, 100, 50]; flat[M.farmland] = [100, 70, 50];
  const spec = { matAt, flat, seed: 1234, scatter };
  if (textured) {
    spec.tex = [];
    for (const m of palette) {
      if (m === M.water) continue;
      const mk = (salt) => {
        const c = new Uint8ClampedArray(8 * 8 * 4), n = new Uint8ClampedArray(8 * 8 * 4), h = new Uint8ClampedArray(8 * 8 * 4);
        for (let i = 0; i < 64; i++) {
          const r = Ground.hashf(i, m, salt);
          c.set([flat[m][0] * (0.9 + 0.2 * r), flat[m][1] * (0.9 + 0.2 * r), flat[m][2] * (0.9 + 0.2 * r), 255], i * 4);
          n.set([110 + Math.floor(r * 36), 128, 0, 255], i * 4);
          h.set([Math.floor(r * 40), 200, 128, 255], i * 4);
        }
        return { c, n, h };
      };
      spec.tex[m] = { w: 8, h: 8, variantAt: (tx, ty) => (tx * 7 + ty * 3) & 1, variants: [mk(1), mk(2)] };
    }
  }
  return spec;
}

function testGround(check) {
  const X0 = 96, Y0 = 64, W = 216, H = 180;
  for (const [label, spec] of [['平坦色', makeSpec(false, false)], ['素材+散らし', makeSpec(true, true)]]) {
    const whole = Ground.bakeRegion(spec, X0, Y0, W, H);
    // 独立した3通りの分割: 縦2分・タイルと揃わない横4分・1画素幅の細い帯を含む分割。それぞれ別の bakeRegion 呼び出し
    const partitions = [
      [[X0, Y0, 77, H], [X0 + 77, Y0, W - 77, H]],
      [[X0, Y0, W, 37], [X0, Y0 + 37, W, 41], [X0, Y0 + 78, W, 59], [X0, Y0 + 137, W, H - 137]],
      [[X0, Y0, 1, H], [X0 + 1, Y0, W - 1, 5], [X0 + 1, Y0 + 5, W - 1, H - 5]],
    ];
    let bad = 0, first = '';
    partitions.forEach((parts, pi) => {
      for (const [x, y, w, h] of parts) {
        const r = Ground.bakeRegion(spec, x, y, w, h);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          if (!Ground.regionsEqualAt(whole, r, x + i, y + j)) { if (!bad++) first = `分割${pi} (${x + i},${y + j})`; }
        }
        // 水は透明のまま(alpha 0)で、陸は不透明
        for (let k = 0; k < w * h; k++) {
          const water = Ground.isWaterMat(r.mat[k]);
          if (water !== (r.color[k * 4 + 3] === 0)) { bad++; first = first || '水の透明'; break; }
        }
      }
    });
    check(`[${label}] 独立した分割の bakeRegion が color/normal/height とも同一バイト`, bad === 0, `不一致 ${bad} ${first}`);
    const again = Ground.bakeRegion(spec, X0, Y0, W, H);
    check(`[${label}] 同じ領域を再度焼いても同一(時刻・状態に依存しない)`, bufEq(whole.color, again.color) && bufEq(whole.normal, again.normal) && bufEq(whole.height, again.height));
    // 負の座標・チャンク境界をまたぐ領域でも決定的
    const a = Ground.bakeRegion(spec, -40, -40, 90, 90), b1 = Ground.bakeRegion(spec, -40, -40, 33, 90), b2 = Ground.bakeRegion(spec, -7, -40, 57, 90);
    let neg = 0;
    for (let j = 0; j < 90; j++) for (let i = 0; i < 90; i++) {
      const wx = -40 + i, wy = -40 + j;
      if (!Ground.regionsEqualAt(a, wx < -7 ? b1 : b2, wx, wy)) neg++;
    }
    check(`[${label}] 負の世界座標をまたぐ分割も同一`, neg === 0, `不一致 ${neg}`);

    // 旧い白縁が無い: 混合した画素は、関わる材質の平坦色より明るくならない(散らし無しの平坦色で検証)
    if (label === '平坦色') {
      const maxLuma = Math.max(...Object.values(spec.flat).filter(Boolean).map((c) => Ground.lumaOf(...c)));
      let bright = 0, white = 0, mixedPx = 0;
      for (let k = 0; k < W * H; k++) {
        if (whole.color[k * 4 + 3] === 0) continue;
        const l = Ground.lumaOf(whole.color[k * 4], whole.color[k * 4 + 1], whole.color[k * 4 + 2]);
        if (l > maxLuma + 6) bright++;
        if (whole.color[k * 4] > 235 && whole.color[k * 4 + 1] > 235 && whole.color[k * 4 + 2] > 235) white++;
        if (whole.rim[k] > 0) mixedPx++;
      }
      check('縁の画素が存在する(検証が空でない)', whole.stats.mixed > 500 && mixedPx > 100, `mixed=${whole.stats.mixed} rim=${mixedPx}`);
      check('どの画素も最も明るい材質の平坦色を超えない・白に近い画素なし(旧い白縁の回帰)', bright === 0 && white === 0, `明るすぎ ${bright} 白 ${white}`);
    }
  }

  // 縁はタイル格子に沿った直線ではない: 2材質が縦1本で接する地形で、境界のx位置が行ごとにばらつく
  const M = Ground.MAT;
  const split = { matAt: (tx) => (tx < 4 ? M.grass : M.dirt), flat: { [M.grass]: [90, 150, 70], [M.dirt]: [140, 100, 60] }, seed: 7, scatter: false };
  const r = Ground.bakeRegion(split, 64, 64, 128, 128);
  const xs = new Set();
  let holes = 0;
  for (let j = 0; j < 128; j++) {
    let edge = -1;
    for (let i = 0; i < 128; i++) if (r.mat[j * 128 + i] === M.grass) edge = i;
    xs.add(edge);
    // 境界の反対側に孤立した材質(穴)は鞍点以外では作らない: 左端は草、右端は土
    if (r.mat[j * 128] !== M.grass || r.mat[j * 128 + 127] !== M.dirt) holes++;
  }
  check('2材質の境界は行ごとにずれる(直線・階段ではない)', xs.size >= 8, `distinct=${xs.size}`);
  check('境界から離れた画素は必ず元の材質(穴・島を作らない)', holes === 0, holes);
  // 境界の草側は白くならず、下の層は暗くなる側にだけ振れる(平坦色との差の符号)
  let brighter = 0;
  for (let k = 0; k < 128 * 128; k++) {
    if (r.color[k * 4 + 3] === 0) continue;
    const base = r.mat[k] === M.grass ? split.flat[M.grass] : split.flat[M.dirt];
    for (let c = 0; c < 3; c++) if (r.color[k * 4 + c] > base[c] * 1.08 + 1) { brighter++; break; }
  }
  check('平坦色の素材より 8% を超えて明るい画素が境界に無い', brighter === 0, brighter);
}
const bufEq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

/* ------------------------------------------------------------------ GL 照明(実際の合成を読み戻す) */
function mkCanvas(w, h, fill) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { alpha: false });
  if (fill) { g.fillStyle = fill; g.fillRect(0, 0, w, h); }
  return cv;
}
function readPx(src, x, y) {
  const cv = mkCanvas(src.width, src.height);
  cv.getContext('2d').drawImage(src, 0, 0);
  return Array.from(cv.getContext('2d').getImageData(x, y, 1, 1).data);
}
const nrm = (nx) => `rgb(${Math.round(128 + nx * 127)},128,0)`;

function testLighting(check, skip) {
  let lighting = null;
  try { lighting = createLighting({ maxLights: 8, steps: 4 }); } catch (e) { lighting = null; }
  if (!lighting) { skip('GL 合成', 'WebGL2 を作れない'); return; }
  try {
    const W = 128, Hh = 128;
    const flatH = () => mkCanvas(W, Hh, '#00c880');
    const base = { camX: 0, camY: 0, t: 0, calm: true, tile: 32, steps: 4, debug: 'off', gain: false, lightScale: 1 };
    const night = { skyColor: [0.0004, 0.0004, 0.0006], sunColor: [0, 0, 0], sunStrength: 0, moonStrength: 0 };

    // (a) 板の表示値: 灰色128・水平・影なし・局所光なしを実際に GL で描き、skyAt が主張する値と一致する
    for (const h of [12, 17, 19, 23]) {
      const sky = skyAt(h);
      const out = lighting.render(mkCanvas(W, Hh, 'rgb(128,128,128)'), mkCanvas(W, Hh, '#808000'), flatH(), null, {
        ...base, lights: [], sunDir: sky.sun.dir, sunColor: sky.sun.color, sunStrength: sky.sun.up ? sky.sun.vis : 0,
        moonDir: sky.moon.dir, moonColor: sky.moon.up ? sky.moon.color : [0, 0, 0], moonStrength: sky.moon.vis, skyColor: sky.sky,
      });
      if (!out) { check(`GL 描画 ${h}時`, false, 'render が null'); continue; }
      const px = readPx(out, 64, 64), want = plateDisplay(sky);
      check(`GL の板 ${h}時 = skyAt の表示値(±4)`, [0, 1, 2].every((k) => Math.abs(px[k] - want[k]) <= 4), `gl=${px.slice(0, 3)} sky=${want}`);
      if (h === 23) check('GL の 23時は ほぼ黒(各チャンネル 10 以下)', px[0] <= 10 && px[1] <= 10 && px[2] <= 10, px.slice(0, 3));
    }

    // (b) 点光源は光の側を照らす。光の右にある床で、光の方(-x)を向く法線 > 反対(+x)を向く法線
    const light = { x: 64, y: 60, r: 2.5, color: [255, 200, 120], flicker: 0, power: 1, id: 1, noGlow: false };
    const shade = (nx, x, y = 80, extra = {}) => {
      const out = lighting.render(mkCanvas(W, Hh, 'rgb(128,128,128)'), mkCanvas(W, Hh, nrm(nx)), flatH(), null, { ...base, ...night, lights: [light], ...extra });
      return out ? readPx(out, x, y) : [0, 0, 0];
    };
    const toward = shade(-0.55, 84), away = shade(+0.55, 84);
    check('点光源: 光に向く法線は背く法線より明るい(右側の床)', toward[0] > away[0] + 15, `向き=${toward[0]} 背き=${away[0]}`);
    // 鏡像: 光の左の +x 法線 == 右の -x 法線(左右対称)
    const mirrored = shade(+0.55, 44);
    check('鏡像の法線: 左右対称に同じ明るさ(±3)', [0, 1, 2].every((k) => Math.abs(mirrored[k] - toward[k]) <= 3), `左=${mirrored.slice(0, 3)} 右=${toward.slice(0, 3)}`);
    const far = shade(-0.55, 4, 124);
    check('光の半径の外は夜の暗さのまま', far[0] <= 12, far.slice(0, 3));

    // (c) 影アトラス: 光源の足元を中心とする窓の座標対応。足元の右 24px に高さ 40px の物の影を描くと、そこだけ暗くなる
    const cell = 256, foot = { x: 64, y: 76 };
    const atlas = mkCanvas(cell * MAX_PT, cell, '#000');
    const ag = atlas.getContext('2d');
    ag.fillStyle = `rgb(${Math.round(40 / 64 * 255)},0,0)`;
    ag.fillRect(PT_HALF + 16, PT_HALF - 4, 14, 16); // 足元 +16..+30 px 右、y -4..+12
    const withPt = { ptShadow: { canvas: atlas, cell, th: 1.5, entries: [{ light, x: foot.x, y: foot.y, h: 16, strength: 0.8 }] } };
    const lit = shade(-0.0, 88, 80), shaded = shade(-0.0, 88, 80, withPt);
    check('局所光の影アトラス: 窓内の影の位置は暗くなる(明るさ 75% 未満)', shaded[0] < lit[0] * 0.75, `影なし=${lit[0]} 影あり=${shaded[0]}`);
    const lit2 = shade(0, 44, 80), shaded2 = shade(0, 44, 80, withPt);
    check('局所光の影アトラス: 影の無い側(光の反対側)は変わらない(±2)', Math.abs(lit2[0] - shaded2[0]) <= 2, `${lit2[0]} → ${shaded2[0]}`);
    check('影を持つ灯の数が stats に出る', lighting.stats.ptShadows === 1 && lighting.stats.ptShadow === true, JSON.stringify({ n: lighting.stats.ptShadows }));
    const farShadow = shade(0, 4, 124, withPt);
    check('影の窓の外・半径の外では影の有無で変わらない', farShadow[0] <= 12, farShadow[0]);

    // (d) physical な灯(src 付き): 足元(64,76)・実高さ h。L.x/L.y は 2D 用の見える位置で、わざと(10,10)にして GL が使わないことを確かめる
    const phys = (h) => ({ ...light, x: 10, y: 10, src: { x: 64, y: 76, h } });
    const physShade = (L, nx, x, y, extra = {}, heightCv = null) => {
      const out = lighting.render(mkCanvas(W, Hh, 'rgb(128,128,128)'), mkCanvas(W, Hh, nrm(nx)), heightCv || flatH(), null, { ...base, ...night, lights: [L], ...extra });
      return out ? readPx(out, x, y)[0] : -1;
    };
    // 地面の受け手: 足元と同じ行の左右は鏡像で同じ(src の足元を使っている証拠)、光に向く法線が明るい
    const gR = physShade(phys(24), -0.55, 84, 76), gL = physShade(phys(24), +0.55, 44, 76);
    check('physical: 地面で足元の左右が鏡像(±3)。L.x/L.y には依らない', Math.abs(gR - gL) <= 3 && gR > 12, `右=${gR} 左=${gL}`);
    const gTo = physShade(phys(24), -0.55, 84, 76), gAway = physShade(phys(24), +0.55, 84, 76);
    check('physical: 地面でも光に向く法線 > 背く法線(向きが一貫)', gTo > gAway + 15, `向き=${gTo} 背き=${gAway}`);
    // 光源の高さ: 半径・地面距離は同じで、平らな地面(法線 +z)は高い光源ほど明るい
    const gLow = physShade(phys(6), 0, 84, 76), gHigh = physShade(phys(40), 0, 84, 76);
    check('physical: 実高さを上げると同じ半径でも平らな地面は明るくなる', gHigh > gLow + 15, `h6=${gLow} h40=${gHigh}`);
    // 高さのある面(高さ 20px の 3x3 パッチ。法線は -x)。光が手前(左)にある時は点灯し、後ろ(右)にある時は暗い
    const patchH = () => { const c = mkCanvas(W, Hh, '#00c880'); const g2 = c.getContext('2d'); g2.fillStyle = 'rgb(80,200,128)'; g2.fillRect(83, 59, 3, 3); return c; };
    const front = (h) => physShade({ ...phys(h) }, -0.55, 84, 60, {}, patchH());
    const behind = physShade({ ...phys(40), src: { x: 104, y: 76, h: 8 } }, -0.55, 84, 60, {}, patchH());
    const fHigh = front(40), fLow = front(8);
    check('physical: 高さのある面は光が手前の時 明るく、後ろの時 暗い', fHigh > behind + 15, `手前=${fHigh} 後ろ=${behind}`);
    check('physical: 光源の実高さを変えると面の照度が変わる(半径同じ)。面より低い光源は暗い', fHigh > fLow + 15, `h40=${fHigh} h8=${fLow}`);
    // 影の登録: entries の x,y,h が光源とずれていても、physical の灯は拡散光と同じ足元・高さで影を引く
    const badEntry = { ptShadow: { canvas: atlas, cell, th: 1.5, entries: [{ light: phys(16), x: 200, y: 200, h: 1, strength: 0.8 }] } };
    const L16 = badEntry.ptShadow.entries[0].light;
    const pl = physShade(L16, 0, 88, 80), ps = physShade(L16, 0, 88, 80, badEntry);
    check('physical: 影は光源の足元に登録される(entries がずれても同じ位置が暗くなる)', ps < pl * 0.75, `影なし=${pl} 影あり=${ps}`);
    // 細い支柱を疎なrayが拾うと、実際の投影影とは別に離れた矩形を作っていた。
    // 投影アトラスが照らされると指定した地面は、その経路だけを使う。
    const thinH = flatH(), thinCtx = thinH.getContext('2d');
    thinCtx.fillStyle = 'rgb(159,200,128)'; thinCtx.fillRect(77, 71, 3, 3);
    const clearPt = { ptShadow: { canvas: mkCanvas(cell * MAX_PT, cell, '#000'), cell, th: 1.5,
      entries: [{ light: L16, x: 64, y: 76, h: 16, strength: 0.8 }] } };
    const cleanGround = physShade(L16, 0, 88, 80, clearPt);
    const groundWithPole = physShade(L16, 0, 88, 80, clearPt, thinH);
    check('physical: 投影影のない地面へrayの複製影を重ねない', Math.abs(cleanGround - groundWithPole) <= 2,
      `平面=${cleanGround} 支柱あり=${groundWithPole}`);
  } finally {
    lighting.dispose();
  }
}

/* ------------------------------------------------------------------ 足元 */
function testFootprints(check) {
  const world = createWorld();
  const nodes = world.surface.nodes.filter((n) => NODES[n.type] && NODES[n.type].solid);
  check('当たりを持つ地上のノードがある', nodes.length > 20, nodes.length);
  let invalid = 0, far = 0;
  for (const n of nodes) {
    const f = nodeFootprint(n);
    if (!(f.rx > 0 && f.ry > 0)) invalid++;
    if (Math.abs(f.x - n.px) > 40 || f.y < n.py - 16 || f.y > n.py + 16) far++;
  }
  check('当たりの楕円は半径が正で、アンカーの近く', invalid === 0 && far === 0, `無効 ${invalid} 遠い ${far}`);
  // 現在の計測表は dx=0 なので、表を一時的に差し替えて「反転した物は足元の中心が逆側へずれる」ことを実データのノードで確かめる
  const mir = nodes.find((n) => n.type === 'tree' && nodeMirrored(n)), unm = nodes.find((n) => n.type === 'tree' && !nodeMirrored(n));
  if (!mir || !unm) { check('反転した木と反転しない木が世界にある', false, `mir=${!!mir} unm=${!!unm}`); return; }
  const key = baseSprite(mir.sprite), keyU = baseSprite(unm.sprite);
  const saved = { a: FOOTPRINTS[key], b: FOOTPRINTS[keyU] };
  try {
    FOOTPRINTS[key] = { dx: 6, dy: 0 }; FOOTPRINTS[keyU] = { dx: 6, dy: 0 };
    const fm = nodeFootprint(mir), fu = nodeFootprint(unm);
    check('反転した木の当たりの中心は逆側(-dx)へ、反転しない木は +dx へずれる', fm.mirrored && !fu.mirrored && fm.x === mir.px - 6 && fu.x === unm.px + 6, `反転 ${fm.x - mir.px} 通常 ${fu.x - unm.px}`);
  } finally {
    if (saved.a) FOOTPRINTS[key] = saved.a; else delete FOOTPRINTS[key];
    if (saved.b) FOOTPRINTS[keyU] = saved.b; else delete FOOTPRINTS[keyU];
  }
}
