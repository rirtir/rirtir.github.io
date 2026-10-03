// PRISM — エンドレス / デイリー
import { generate } from './gen.js';
import * as O from './optics.js';

function diffFor(n) { return Math.min(10, 1 + Math.floor(n / 2)); }
function fmtDate(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }

export function startEndless(ctx) {
  const { startLevel, save, persist, toast } = ctx;
  if (!save.endless) save.endless = { n: 0, best: 0 };
  const e = save.endless;
  const baseSeed = (Date.now() % 1000003) + 1;
  const run = (n) => {
    const d = diffFor(n);
    let def = null, dd = d;
    for (let k = 0; k < 6 && !def; k++) { def = generate(baseSeed * 31 + n * 17 + k, dd); if (!def) dd = Math.max(1, dd - 1); }
    if (!def) { toast('ステージの生成に失敗しました'); return; }
    def.name = `難度 ${dd}`;
    def.text = n === 0 ? 'エンドレス：クリアするたびに少しずつ難しくなる、無限のステージ。' : '';
    startLevel(def, {
      kind: 'endless', label: `ENDLESS ${n + 1}`, name: def.name,
      onWin: (info) => {
        e.n = n + 1; e.best = Math.max(e.best || 0, e.n); persist();
        return `連続 ${e.n} ステージクリア`;
      },
      nextFn: () => run(n + 1), nextLabel: '次のステージ',
    });
  };
  run(e.n || 0);
}

export function startDaily(ctx) {
  const { startLevel, save, persist, toast } = ctx;
  const now = new Date();
  const key = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const seed = parseInt(key, 10);
  let def = null;
  for (let d = 6; d >= 3 && !def; d--) def = generate(seed, d);
  if (!def) { toast('ステージの生成に失敗しました'); return; }
  def.name = `${fmtDate(now)} のパズル`;
  def.text = '毎日変わるステージ。日付ごとに決まった一問だけのパズルです。';
  if (!save.daily) save.daily = {};
  const done = save.daily[key];
  startLevel(def, {
    kind: 'daily', label: 'DAILY', name: def.name,
    onWin: (info) => {
      const prev = save.daily[key];
      let note = prev ? '' : '今日のデイリー達成！';
      if (!prev || info.moves < prev.moves) save.daily[key] = { moves: info.moves, time: Math.round(info.time), hints: info.hints };
      // 連続日数
      let streak = 0; const d = new Date(now);
      for (let i = 0; i < 400; i++) {
        const k = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        if (save.daily[k]) streak++; else break;
        d.setDate(d.getDate() - 1);
      }
      persist();
      return note + (streak > 1 ? ` ${streak}日連続！` : '');
    },
  });
  if (done) toast('今日のデイリーはクリア済みです（もう一度挑戦できます）');
}

// ---------- ライトアート（動く光の景色を眺めるモード） ----------
const zen = { t: 0, base: [], ph: [], active: false, ctx: null, click: null };
export function startZen(ctx) {
  const { startLevel, game, app } = ctx;
  zen.ctx = ctx; zen.active = true;
  const next = () => {
    let def = null, best = -1;
    const seed = (Date.now() % 100003) * 7 + Math.floor(Math.random() * 1e6);
    for (let k = 0; k < 14; k++) {
      const cand = generate(seed + k, 9 + (k % 2));
      if (!cand) continue;
      // 光がたくさん交わって見栄えのする景色を選ぶ
      const els = O.loadLevel(cand); O.applySolution(els);
      const tr = O.trace(els);
      const score = tr.nseg + 500 * els.filter(e => e.type === 'prism').length + 250 * els.filter(e => e.type === 'target').length;
      if (score > best) { best = score; def = cand; }
    }
    if (!def) def = generate(5, 5);
    def.text = n0 ? 'クリックで新しい景色　／　Esc でもどる' : '';
    n0 = false;
    startLevel(def, { kind: 'zen', label: '', name: 'ライトアート', noHud: true });
    O.applySolution(game.els);
    for (const e of game.els) { e.mv = false; e.rt = false; }
    game.sandbox = true; game.paused = true; game.dirty = true;
    zen.base = game.els.map(e => ({ x: e.x, y: e.y, a: e.a }));
    zen.ph = game.els.map(() => Math.random() * 6.283);
    zen.t = 0;
  };
  let n0 = true;
  zen.next = next;
  if (!zen.click) { zen.click = () => { if (zen.active && app.meta && app.meta.kind === 'zen') zen.next(); }; game.ov.addEventListener('click', zen.click); }
  next();
}
export function stopZen() { zen.active = false; }
export function zenUpdate(game, dt) {
  if (!zen.active) return;
  zen.t += dt;
  const t = zen.t;
  game.els.forEach((e, i) => {
    const b = zen.base[i]; if (!b) return;
    const ph = zen.ph[i];
    if (e.type === 'prism' || e.type === 'mirror' || e.type === 'splitter' || e.type === 'slab') e.a = b.a + Math.sin(t * (0.18 + (i % 5) * 0.05) + ph) * 0.13;
    else if (e.type === 'well') { e.x = b.x + Math.cos(t * 0.3 + ph) * 0.25; e.y = b.y + Math.sin(t * 0.3 + ph) * 0.25; }
    else if (e.type === 'ball') { e.y = b.y + Math.sin(t * 0.25 + ph) * 0.2; }
  });
  game.dirty = true;
  if (t > 48) zen.next();
}
