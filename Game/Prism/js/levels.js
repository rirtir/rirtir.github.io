// PRISM — ステージ定義
// 角度は度、座標はユニット（盤面 16×9。ストック置き場は y>7.85）。
// mv な要素は「解いた姿勢」を x,y,a に書き、開始時は自動でストックに並ぶ。
import { MASTER } from './levels_master.js';
export const NM = { R: 650, O: 598, Y: 575, G: 532, C: 492, B: 455, V: 420 };
const r2 = (v) => Math.round(v * 100) / 100;
const deg = (dx, dy) => Math.atan2(dy, dx) * 180 / Math.PI;
const mod180 = (a) => ((a % 180) + 180) % 180;

const las = (x, y, a, spec = 'white', extra = {}) => ({ type: 'laser', x, y, a, spec, ...extra });
const tgt = (x, y, nm, extra = {}) => ({ type: 'target', x, y, lo: nm - 26, hi: nm + 26, ...extra });
const tgtAuto = (x, y, extra = {}) => ({ type: 'target', x, y, r: 0.36, auto: true, ...extra });
const tgtBand = (x, y, lo, hi, extra = {}) => ({ type: 'target', x, y, lo, hi, ...extra });
const mir = (x, y, a, extra = {}) => ({ type: 'mirror', x, y, a, ...extra });
const spl = (x, y, a, extra = {}) => ({ type: 'splitter', x, y, a, ...extra });
const flt = (x, y, a, lo, hi, extra = {}) => ({ type: 'filter', x, y, a, lo, hi, ...extra });
const pri = (x, y, a, extra = {}) => ({ type: 'prism', x, y, a, ...extra });
const slab = (x, y, a, extra = {}) => ({ type: 'slab', x, y, a, ...extra });
const ball = (x, y, extra = {}) => ({ type: 'ball', x, y, a: 0, ...extra });
const wall = (x, y, w, h, a = 0) => ({ type: 'wall', x, y, w, h, a });
const well = (x, y, k = 0.3, extra = {}) => ({ type: 'well', x, y, a: 0, k, ...extra });

// 折れ線から「レーザー + 角のミラー + 受光器」を作る
function route(pts, spec, o = {}) {
  const els = [];
  const d0 = deg(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  els.push(o.pivotLaser ? las(pts[0][0], pts[0][1], r2(d0), spec, { pivot: true, start: { a: o.starts[0] } }) : las(pts[0][0], pts[0][1], r2(d0), spec, { fixed: true }));
  for (let i = 1; i < pts.length - 1; i++) {
    const din = deg(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const dout = deg(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const e = mir(pts[i][0], pts[i][1], r2(mod180((din + dout) / 2)));
    if (o.pivot) { e.pivot = true; e.start = { a: o.starts[i] }; }
    els.push(e);
  }
  if (!o.noTarget) {
    const last = pts[pts.length - 1];
    els.push(o.band ? tgtBand(last[0], last[1], o.band[0], o.band[1], o.tx || {}) : tgt(last[0], last[1], typeof spec === 'number' ? spec : 575, o.tx || {}));
  }
  return els;
}

export const CHAPTERS = [
  {
    id: 1, name: '反射', en: 'REFLECT', nm: 650,
    blurb: 'ミラーで光を曲げて、同じ色の受光器まで導こう。',
    levels: [
      { name: 'はじめの一手', text: '下のストックのミラーを光の通り道までドラッグ。ハンドル（かホイール）で回して、同じ色の受光器（リング）に光を当てよう。',
        elements: route([[2, 2.5], [8, 2.5], [8, 6]], NM.R) },
      { name: 'ふたつ曲げる', text: '壁をよけて受光器へ。光の道すじを頭の中でなぞってみよう。ミラーは何枚でも使えます。',
        elements: [...route([[1.5, 1.5], [6, 1.5], [6, 6], [13.5, 6]], NM.R), wall(10.5, 3, 1, 1.6)] },
      { name: '壁の向こう', text: '壁は光を通しません。下をくぐらせよう。',
        elements: [...route([[1.5, 4], [3.5, 4], [3.5, 6.75], [10, 6.75], [10, 3]], NM.R), wall(6.5, 3, 0.8, 6)] },
      { name: 'ジグザグ',
        elements: [...route([[1, 1], [4, 1], [4, 3.25], [8, 3.25], [8, 6], [13.5, 6]], NM.R), wall(6, 1.5, 0.5, 2), wall(10, 3.5, 0.5, 2.2), wall(12, 2.5, 2.5, 0.5)] },
      { name: '斜めの道', text: '45°の鏡で、斜めにも曲げられます。',
        elements: [...route([[1.5, 6.5], [5, 6.5], [8.5, 3], [12, 3], [14.5, 5.5]], NM.R), wall(9, 5.5, 1.5, 0.5), wall(6, 2, 0.5, 2)] },
      { name: 'ふたつの光', text: '赤い光は赤い受光器へ、青い光は青い受光器へ。色が違うと点灯しません。',
        elements: [...route([[1.5, 2], [9, 2], [9, 6.5]], NM.R), ...route([[1.5, 6.5], [5, 6.5], [5, 4], [13.5, 4]], NM.B)] },
      { name: '回すだけ', text: '固定されたミラーは回転だけできます。レーザーも回せるよ。',
        elements: route([[2, 6], [6.5, 6], [6.5, 2.5], [12, 2.5], [12, 6.5]], NM.R, { pivot: true, pivotLaser: true, starts: [20, 90, 0, 135] }) },
      { name: '三原色', text: '3本の光が交差します。それぞれを正しい受光器へ。',
        elements: [...route([[1.5, 1.5], [4, 1.5], [4, 5.25], [14.5, 5.25]], NM.R), ...route([[1.5, 6.5], [7, 6.5], [7, 2.75], [14.5, 2.75]], NM.B), ...route([[1.5, 4], [11, 4], [11, 1], [14.5, 1]], NM.G)] },
      { name: 'ミラーの迷宮',
        elements: [...route([[1, 1], [14.5, 1], [14.5, 3], [1.5, 3], [1.5, 5], [14.5, 5], [14.5, 6.75]], NM.R), wall(6.75, 2, 13.5, 0.3), wall(9.25, 4, 13.5, 0.3)] },
    ],
  },
  {
    id: 2, name: '分光', en: 'SPLIT', nm: 532,
    blurb: 'ハーフミラーは光を半分ずつ、通過と反射に分けます。',
    levels: [
      { name: '半分こ', text: 'ハーフミラー（水色の鏡）は光を二つに分けます。受光器は半分の光でも点灯します。',
        elements: [las(1.5, 4, 0, NM.G, { fixed: true }), spl(5, 4, 45), mir(11, 4, -45), tgt(11, 1.5, NM.G, { minE: 0.4 }), mir(5, 6.5, 45), tgt(11, 6.5, NM.G, { minE: 0.4 })] },
      { name: 'みっつに分ける', text: '分けるたびに光は弱まります。',
        elements: [las(1.5, 4, 0, NM.G, { fixed: true }), spl(4, 4, 45), spl(8, 4, -45), mir(13, 4, 45),
          tgt(4, 6.5, NM.G, { minE: 0.2 }), tgt(8, 1.5, NM.G, { minE: 0.2 }), tgt(13, 6.5, NM.G, { minE: 0.2 })] },
      { name: '束ねる', text: '分けた光を同じ受光器に戻そう。ほぼ全部の光が必要です。',
        elements: [las(1.5, 2, 0, NM.G, { fixed: true }), spl(4, 2, 45), mir(13, 2, 45), mir(4, 6.5, 45), mir(13, 6.5, -45), tgt(13, 4.25, NM.G, { minE: 0.85 }), wall(8.5, 4.25, 3, 0.5)] },
      { name: 'ふたまたの道',
        elements: [las(1.5, 1.5, 0, NM.G, { fixed: true }), spl(6, 1.5, 45), mir(13, 1.5, 45), tgt(13, 4.5, NM.G, { minE: 0.4 }),
          mir(6, 6, 45), tgt(10, 6, NM.G, { minE: 0.4 }), wall(8, 3.5, 0.5, 3.5)] },
      { name: '四つの出口', text: '光は分けるたびに半分になります。',
        elements: [las(1.5, 4, 0, NM.G, { fixed: true }), spl(4, 4, 45), spl(7, 4, -45), spl(10, 4, 45),
          tgt(4, 6.5, NM.G, { minE: 0.1 }), mir(7, 1.5, -45), tgt(12, 1.5, NM.G, { minE: 0.1 }), tgt(10, 6.5, NM.G, { minE: 0.1 }), tgt(13.5, 4, NM.G, { minE: 0.1 })] },
    ],
  },
  {
    id: 3, name: '混色', en: 'MIX', nm: 575,
    blurb: '光は重ねると混ざります。複数の色が同時に届いたときだけ点灯する受光器もあります。',
    levels: [
      { name: '黄色をつくる', text: '赤＋緑＝黄色。この受光器は両方の光が同時に届かないと点灯しません。',
        elements: [...route([[1.5, 2], [13, 2], [13, 4.25]], NM.R, { noTarget: true }), ...route([[1.5, 6.5], [13, 6.5], [13, 4.25]], NM.G, { noTarget: true }),
          tgtBand(13, 4.25, 500, 700, { minE: 1.7, tol: 0.1 }), wall(7, 4.25, 1, 2.4)] },
      { name: '白い光',
        elements: [...route([[1.5, 1.5], [11, 1.5], [11, 4]], NM.R, { noTarget: true }), ...route([[1.5, 6.5], [11, 6.5], [11, 4]], NM.B, { noTarget: true }),
          ...route([[14.5, 5.5], [8.5, 5.5], [8.5, 4], [11, 4]], NM.G, { noTarget: true }), tgtBand(11, 4, 400, 700, { minE: 2.6, tol: 0.2 })] },
      { name: '色を分け合う', text: '緑の光をハーフミラーで二つに分けて、黄色と水色、二つの受光器に届けよう。',
        elements: [las(1.5, 1.5, 0, NM.R, { fixed: true }), las(1.5, 4, 0, NM.G, { fixed: true }), las(1.5, 6.5, 0, NM.B, { fixed: true }),
          mir(13, 1.5, 45), spl(6, 4, -45), mir(6, 2.75, -45), mir(10, 4, 45), mir(10, 5.25, 45), mir(13, 6.5, -45),
          tgtBand(13, 2.75, 500, 700, { minE: 1.3, tol: 0.1 }), tgtBand(13, 5.25, 430, 570, { minE: 1.3, tol: 0.1 })] },
    ],
  },
  {
    id: 4, name: '屈折', en: 'REFRACT', nm: 455,
    blurb: 'プリズムは白い光を虹に分けます。波長ごとに曲がる角度が違うからです。',
    levels: [
      { name: '虹をつくる', text: '白い光はプリズムで虹に分かれます。プリズムを光の通り道に置いて回し、青い光だけを受光器に当てよう（受光器の色は左上のマークでも確認できます）。',
        elements: [las(1.5, 1, 45, 'white', { fixed: true }), pri(5, 4.5, 85), tgtAuto(13.5, 3.9)] },
      { name: '赤と紫', text: '回転だけでなく、位置を動かすと虹の広がり方が変わります。',
        elements: [las(1.5, 1, 45, 'white', { fixed: true }), pri(5, 4.5, 85), tgtAuto(13.5, 3.2), tgtAuto(13.5, 5.6)] },
      { name: '三色分解',
        elements: [las(1.5, 1, 45, 'white', { fixed: true }), pri(5, 4.5, 85), tgtAuto(13.5, 3.5), tgtAuto(13.5, 4.5), tgtAuto(13.5, 5.5)] },
      { name: '虹を曲げる', text: '虹ごと鏡で曲げることもできます。',
        elements: [las(1.5, 1, 45, 'white', { fixed: true }), pri(5, 4.5, 85), mir(9.5, 4.5, -45, { len: 2.4 }), tgtAuto(9.95, 1.4), tgtAuto(8.5, 1.4)] },
      { name: 'プリズムは鏡', text: 'プリズムは角度によって全反射し、鏡のように光を曲げます。',
        elements: [las(1.5, 6.5, 0, NM.R, { fixed: true }), pri(5, 6.5, 75), pri(5.75, 2.5, 15), tgt(13, 2.1, NM.R), wall(9.5, 5.5, 0.6, 2)] },
      { name: '虹をもどす', text: 'もう一つのプリズムで、分かれた虹を白い光に戻そう。',
        elements: [las(1.5, 4, 0, 'white', { fixed: true }), pri(4, 4, 40), pri(6, 2.5, 112.5), tgtAuto(13.5, 2.8, { r: 0.42, keep: 0.6 })] },
      { name: '二段の虹', text: 'プリズムを重ねると、虹はもっと大きく広がります。',
        elements: [las(1.5, 4, 0, 'white', { fixed: true }), pri(4, 4, 40), pri(6, 2.5, 50), tgtAuto(13.5, 6.5), tgtAuto(13.5, 5.2), tgtAuto(13.5, 4.3)] },
    ],
  },
  {
    id: 5, name: 'フィルタ', en: 'FILTER', nm: 598,
    blurb: '色つきガラスは決まった色の光だけを通します。白い光から好きな色を取り出そう。',
    levels: [
      { name: '赤だけ通す', text: 'フィルタ（色のついた細長い板）は、その色の光だけを通して他は吸収します。',
        elements: [las(1.5, 2, 0, 'white', { fixed: true }), flt(5, 2, 90, 610, 700), mir(9, 2, 45), tgtAuto(9, 6, { r: 0.42 })] },
      { name: '二色に分ける',
        elements: [las(1.5, 4, 0, 'white', { fixed: true }), spl(5, 4, 45), flt(5, 5.5, 0, 610, 700), tgtAuto(5, 7, { r: 0.42 }),
          mir(10, 4, -45), flt(10, 2.5, 0, 430, 490), tgtAuto(10, 1, { r: 0.42 })] },
      { name: 'RGB の柱', text: '光を三つに分けて、それぞれの色を取り出そう。',
        elements: [las(1.5, 2, 0, 'white', { fixed: true }), spl(5, 2, 45), spl(9, 2, 45), mir(13, 2, 45),
          flt(5, 4.25, 0, 610, 700), tgtAuto(5, 6.5, { r: 0.42 }), flt(9, 4.25, 0, 500, 570), tgtAuto(9, 6.5, { r: 0.42 }), flt(13, 4.25, 0, 430, 490), tgtAuto(13, 6.5, { r: 0.42 })] },
      { name: '二枚重ねの色', text: 'フィルタを二枚重ねると、両方が通す色だけが残ります。',
        elements: [las(1.5, 4, 0, 'white', { fixed: true }), flt(4.5, 4, 90, 500, 650), flt(8, 4, 90, 400, 560), tgtAuto(12, 4, { r: 0.42 }), wall(10, 2.5, 0.5, 2)] },
      { name: '選んで混ぜる', text: '白い光から赤と緑だけを取り出して、もう一度ひとつに合わせよう。',
        elements: [las(1.5, 4, 0, 'white', { fixed: true }), spl(4, 4, 45), flt(4, 5.25, 0, 610, 700), mir(4, 6.5, 45), mir(11, 6.5, -45),
          flt(7, 4, 90, 500, 570), tgtBand(11, 4, 500, 700, { minE: 0.2, tol: 0.06 }), wall(8, 5.25, 0.6, 1.5)] },
    ],
  },
  {
    id: 6, name: 'ガラス', en: 'GLASS', nm: 492,
    blurb: 'ガラス板は光をずらし、ガラス玉はレンズのように光を集めます。',
    levels: [
      { name: 'ガラス板', text: '斜めにしたガラス板は、光をまっすぐのまま平行にずらします。',
        elements: [las(1.5, 4, 0, NM.G, { fixed: true }), slab(6, 4, 30, { w: 2.4, h: 1.2 }), tgt(13.5, 3.4, NM.G), wall(10.5, 4.25, 0.6, 1.4)] },
      { name: '二枚重ね',
        elements: [las(1.5, 1.5, 0, NM.G, { fixed: true }), slab(4.5, 1.5, -30, { w: 2.4, h: 1.2 }), slab(9, 2.25, -30, { w: 2.4, h: 1.2 }), tgt(13.5, 2.75, NM.G), wall(11.5, 1.8, 0.6, 1.5)] },
      { name: '集光', text: 'ガラス玉は光を一点に集めます。二本の光を同時に受光器へ。',
        elements: [las(1.5, 3.4, 0, NM.G, { fixed: true }), las(1.5, 4.6, 0, NM.G, { fixed: true }), ball(6, 4, { r: 0.9 }), tgtBand(7.6, 4, 500, 570, { minE: 1.5, tol: 0.1 })] },
    ],
  },
  {
    id: 7, name: '集大成', en: 'MASTER', nm: 420,
    blurb: 'すべての道具を使いこなす最終章。ヒントを使いながらじっくり解こう。',
    levels: MASTER.map((m, i) => ({ name: m.name, text: i === 0 ? 'ここからは難問です。H キーでヒントが出ます。' : '', elements: m.elements })),
  },
  {
    id: 8, name: '重力', en: 'GRAVITY', nm: 598, css: 'rgb(255,150,210)',
    blurb: 'ブラックホールは光を引き寄せて曲げ、白い球は光を押しのけます。光の通り道が曲線になる世界。',
    levels: [
      { name: '重力レンズ', text: 'ブラックホール（黒い球）は光を引き寄せます。近づきすぎると吸い込まれるので注意。置いたあとも何度でも動かせます。',
        elements: [las(1.5, 2, 0, NM.R, { fixed: true }), well(7, 3), tgt(11.9, 6.7, NM.R, { r: 0.55 })] },
      { name: '斥力球', text: '白い球は逆に光を押しのけます。壁の上を越えさせよう。',
        elements: [las(1.5, 4.5, 0, NM.R, { fixed: true }), wall(8, 4.5, 0.6, 2), well(3.25, 5.75, -0.3), tgt(12, 2, NM.R, { r: 0.55 })] },
      { name: 'S字カーブ', text: '壁の向こうの受光器へ。曲げて、もう一度曲げる。',
        elements: [las(1.5, 4, 0, NM.R, { fixed: true }), wall(9, 4.5, 0.6, 5), well(3.75, 2.75), well(10.25, 1.75), tgt(13, 4, NM.R, { r: 0.6 })] },
      { name: '重力集光', text: '二本の光を、ブラックホールの重力で一点に集めよう。',
        elements: [las(1.5, 2.5, 0, NM.G, { fixed: true }), las(1.5, 5.5, 0, NM.G, { fixed: true }), well(6, 4), tgtBand(10.5, 4, 500, 570, { r: 0.5, minE: 1.6, tol: 0.1 })] },
      { name: '虹の重力', text: '重力は色によらず光を曲げます。虹ごと曲げて、四つの受光器へ。',
        elements: [las(1.5, 1, 45, 'white', { fixed: true }), pri(5, 4.5, 85), well(10, 2.5), tgtAuto(13.5, 1.9), tgtAuto(13.5, 3), tgtAuto(13.5, 4.4), tgtAuto(13.5, 5.2)] },
    ],
  },
];
