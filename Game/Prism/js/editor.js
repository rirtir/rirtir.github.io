// PRISM — ステージエディタ（配置 → 共有リンク）
import * as O from './optics.js';
import { toDef } from './gen.js';
import { shareUrl } from './share.js';
import { NM } from './levels.js';

const LS_KEY = 'prism.editor.v1';
const NAMES = { laser: 'レーザー', mirror: 'ミラー', splitter: 'ハーフ鏡', filter: 'フィルタ', prism: 'プリズム', slab: 'ガラス板', ball: 'ガラス玉', wall: '壁', target: '受光器', well: '重力井戸', repel: '斥力球' };
const ICON = {
  laser: '<rect x="3" y="9" width="10" height="6" rx="2"/><path d="M13 12h8"/>',
  mirror: '<path d="M5 19 19 5"/>',
  splitter: '<path d="M5 19 19 5" stroke-dasharray="3 3"/>',
  filter: '<path d="M5 19 19 5" stroke-width="3.6"/>',
  prism: '<path d="M12 4 21 19H3z"/>',
  slab: '<rect x="4" y="8" width="16" height="8" rx="1.5"/>',
  ball: '<circle cx="12" cy="12" r="7.5"/>',
  wall: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M4 18 18 6M8 18 20 8M4 12 10 6"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/>',
  well: '<circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8"/>',
  repel: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
};
const COLORS = [['白', 'white'], ['赤', NM.R], ['橙', NM.O], ['黄', NM.Y], ['緑', NM.G], ['青緑', NM.C], ['青', NM.B], ['紫', NM.V]];
const BANDS = [['全色', 400, 700], ['赤', 620, 700], ['橙〜黄', 570, 620], ['緑', 500, 570], ['青', 440, 500], ['紫', 400, 445]];
const SIZE = { mirror: ['len', '長さ', 1, 3.2, 0.1], splitter: ['len', '長さ', 1, 3.2, 0.1], filter: ['len', '長さ', 1, 3.2, 0.1], prism: ['r', '大きさ', 0.5, 1.3, 0.05], ball: ['r', '半径', 0.4, 1.2, 0.05], target: ['r', '半径', 0.25, 0.7, 0.01] };

let ctx = null, timer = null, saveT = 0;

export function editorDef(els, name = '自作ステージ') {
  return { name, elements: toDef(els) };
}

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(editorDef(ctx.game.els).elements)); } catch (e) { /* 無視 */ }
}
function loadSaved() {
  try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && s.length) return { name: '自作', elements: s }; } catch (e) { /* 無視 */ }
  return null;
}
const DEFAULT = () => ({
  name: '自作ステージ',
  elements: [
    { type: 'laser', x: 2, y: 2, a: 0, spec: 'white', fixed: true },
    { type: 'mirror', x: 13, y: 2, a: 45 },
    { type: 'prism', x: 6, y: 6, a: 0 },
    { type: 'target', x: 13, y: 5.5, lo: 400, hi: 700, minE: 0.5, tol: 3, fixed: true },
  ],
});

export function openEditor(c, def = null) {
  ctx = c;
  const { game, $, app, show } = c;
  app.screen = 'play'; app.editor = true;
  show(null);
  $('hud').classList.add('hidden'); $('caption').classList.add('hidden');
  $('editor').classList.remove('hidden');
  game.demo = false; game.editor = true; game.sandbox = true; game.paused = false;
  const d = def || loadSaved() || DEFAULT();
  game.startLevel(d, { kind: 'editor' });
  O.applySolution(game.els);
  game.editor = true; game.sandbox = true; game.def = null;
  for (const e of game.els) e.sol = { x: e.x, y: e.y, a: e.a };
  game.dirty = true;
  buildPalette();
  const edEl = $('editor');
  edEl.classList.toggle('collapsed', window.innerWidth < 760);
  $('editor').querySelector('.ed-title').onclick = () => edEl.classList.toggle('collapsed');
  game.onSelect = onSelect;
  game.onChange = () => { schedule(); };
  onSelect(null);
  c.resize();
  clearInterval(timer);
  timer = setInterval(status, 350);
  window.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (!ctx || !ctx.app.editor) return;
  if (e.key === 'd' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ctx.game.duplicateSelected(); schedule(); }
}
function schedule() { clearTimeout(saveT); saveT = setTimeout(persist, 500); }

function closeEditor() {
  const { game, $, app } = ctx;
  clearInterval(timer); window.removeEventListener('keydown', onKey);
  persist();
  game.editor = false; game.sandbox = false;
  app.editor = false;
  $('editor').classList.add('hidden');
}

function buildPalette() {
  const { game, $ } = ctx;
  const pal = $('palette'); pal.innerHTML = '';
  for (const t of Object.keys(NAMES)) {
    const b = document.createElement('button'); b.className = 'pal';
    b.innerHTML = `<svg viewBox="0 0 24 24">${ICON[t]}</svg><span>${NAMES[t]}</span>`;
    b.onclick = () => {
      const props = {};
      if (t === 'laser') props.spec = 'white';
      if (t === 'repel') props.k = -0.3;
      const el = game.addElement(t === 'repel' ? 'well' : t, props);
      if (!el) return;
      if (t === 'wall') { el.mv = false; el.rt = false; }
      onSelect(el); schedule();
    };
    pal.appendChild(b);
  }
  const $b = (id, fn) => { $(id).onclick = () => { ctx.audio.init(); fn(); }; };
  $b('edClear', () => { if (confirm('配置をすべて消去しますか？')) { game.setElements([]); schedule(); } });
  $b('edExit', () => { closeEditor(); ctx.exit(); });
  $b('edTest', () => test());
  $b('edShot', () => { ctx.app.shot = true; game.sel = null; game.hover = null; });
  $b('edShare', () => share());
}

function currentDef() { return editorDef(ctx.game.els); }

function test() {
  const { game, toast } = ctx;
  const def = currentDef();
  if (!def.elements.some(e => e.type === 'laser') || !def.elements.some(e => e.type === 'target')) { toast('レーザーと受光器が必要です'); return; }
  persist();
  const c = ctx;
  closeEditor();
  const back = () => openEditor(c);
  c.startCustom(def, { label: 'テスト', name: '自作ステージ', backFn: back });
}
async function share() {
  const { game, toast } = ctx;
  const tr = O.trace(game.els);
  if (!tr.targets.length) { toast('受光器を置いてください'); return; }
  if (!O.allSolved(tr)) { toast('すべての受光器が点灯する「解」の状態で共有してください'); return; }
  const url = shareUrl(currentDef());
  try { await navigator.clipboard.writeText(url); toast('共有リンクをコピーしました！', 2600); }
  catch (e) { window.prompt('このリンクをコピーして共有してください', url); }
}

function status() {
  const { game, $ } = ctx;
  const el = $('edStatus');
  if (!game.tr) return;
  const t = game.tr.targets;
  if (!t.length) { el.textContent = '受光器がありません'; el.className = 'ed-status'; return; }
  const ok = t.filter(x => x.ok).length;
  if (ok === t.length) { el.textContent = `✓ 解けています（${ok}/${t.length}）`; el.className = 'ed-status ok'; }
  else { el.textContent = `受光器 ${ok}/${t.length} 点灯`; el.className = 'ed-status'; }
}

function onSelect(el) {
  const { $, game } = ctx;
  const box = $('props'); box.innerHTML = '';
  if (!el) { box.innerHTML = '<div style="opacity:.7;line-height:1.7">パーツをクリックして選択。<br>ドラッグ移動・ハンドル／ホイールで回転。<br>Delete で削除、Ctrl+D で複製。</div>'; return; }
  const row = (label, node) => { const l = document.createElement('label'); l.append(label); l.appendChild(node); box.appendChild(l); return l; };
  const title = document.createElement('div'); title.style.cssText = 'color:var(--ink);font-weight:700;font-size:13px'; title.textContent = el.type === 'well' ? (el.k < 0 ? NAMES.repel : NAMES.well) : NAMES[el.type]; box.appendChild(title);
  const keys = ['len', 'r', 'w', 'h', 'lo', 'hi', 'k', 'ratio', 'disp', 'spec', 'minE', 'tol'];
  let saved = Object.fromEntries(keys.map(k => [k, el[k]]));
  const snap = () => { saved = Object.fromEntries(keys.map(k => [k, el[k]])); };
  const revert = () => { for (const k of keys) el[k] = saved[k]; onSelect(el); };
  const upd = () => { if (!O.placementOk(el, game.els)) { revert(); ctx.toast('そこには置けません'); return; } snap(); game.touch(); schedule(); };
  const mkSel = (opts, cur, fn) => {
    const s = document.createElement('select');
    opts.forEach(([n], i) => { const o = document.createElement('option'); o.textContent = n; o.value = i; s.appendChild(o); });
    s.value = Math.max(0, opts.findIndex(([, v]) => v === cur));
    s.onchange = () => fn(opts[s.value][1]);
    return s;
  };
  const mkRange = (min, max, step, cur, fn) => { const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = cur; r.oninput = () => fn(parseFloat(r.value)); return r; };
  if (el.type !== 'target' && el.type !== 'wall') {
    const mode = el.mv ? 'free' : el.rt ? 'rot' : 'fix';
    row('プレイヤーの操作', mkSel([['自由', 'free'], ['回転のみ', 'rot'], ['固定', 'fix']], mode, v => { el.mv = v === 'free'; el.rt = v !== 'fix'; upd(); }));
  }
  if (el.type === 'laser') {
    const cur = el.spec === 'white' ? 'white' : (COLORS.find(c => c[1] === el.spec) ? el.spec : 'white');
    row('色', mkSel(COLORS, cur, v => { el.spec = v; upd(); }));
  }
  if (el.type === 'filter') {
    let l1, l2;
    l1 = row(`下限 ${el.lo | 0}nm`, mkRange(400, 690, 5, el.lo, v => { el.lo = Math.min(v, el.hi - 10); upd(); l1.firstChild.nodeValue = `下限 ${el.lo | 0}nm`; }));
    l2 = row(`上限 ${el.hi | 0}nm`, mkRange(410, 700, 5, el.hi, v => { el.hi = Math.max(v, el.lo + 10); upd(); l2.firstChild.nodeValue = `上限 ${el.hi | 0}nm`; }));
  }
  if (el.type === 'well') {
    let lk;
    lk = row(`強さ ${el.k.toFixed(2)}`, mkRange(-0.8, 0.8, 0.05, el.k, v => { el.k = v === 0 ? 0.05 : v; upd(); lk.firstChild.nodeValue = `強さ ${el.k.toFixed(2)}`; title.textContent = el.k < 0 ? NAMES.repel : NAMES.well; }));
  }
  if (el.type === 'splitter') row('反射率', mkRange(0.1, 0.9, 0.05, el.ratio, v => { el.ratio = v; upd(); }));
  if (SIZE[el.type]) { const [k, lb, mn, mx, st] = SIZE[el.type]; row(lb, mkRange(mn, mx, st, el[k], v => { el[k] = v; upd(); })); }
  if (el.type === 'slab' || el.type === 'wall') {
    row('幅', mkRange(0.4, 4, 0.1, el.w, v => { el.w = v; upd(); }));
    row('高さ', mkRange(0.3, 6, 0.1, el.h, v => { el.h = v; upd(); }));
  }
  if (el.type === 'prism' || el.type === 'slab' || el.type === 'ball') {
    row('分散', mkRange(0.05, 0.6, 0.01, el.disp, v => { el.disp = v; upd(); }));
  }
  if (el.type === 'target') {
    const cur = BANDS.find(b => Math.abs(b[1] - el.lo) < 1 && Math.abs(b[2] - el.hi) < 1);
    row('受け取る色', mkSel(BANDS.map(b => [b[0], b[0]]).concat([['カスタム', 'custom']]), cur ? cur[0] : 'custom', v => {
      const b = BANDS.find(x => x[0] === v); if (b) { el.lo = b[1]; el.hi = b[2]; upd(); onSelect(el); }
    }));
    let lm, lt;
    lm = row(`必要量 ${el.minE.toFixed(2)}`, mkRange(0.05, 3, 0.05, el.minE, v => { el.minE = v; upd(); lm.firstChild.nodeValue = `必要量 ${el.minE.toFixed(2)}`; }));
    lt = row(`許容 ${el.tol.toFixed(2)}`, mkRange(0, 3, 0.01, el.tol, v => { el.tol = v; upd(); lt.firstChild.nodeValue = `許容 ${el.tol.toFixed(2)}`; }));
    const fit = document.createElement('button'); fit.className = 'btn sm'; fit.innerHTML = '<span>いま届く光に合わせる</span>';
    fit.onclick = () => {
      const r = O.trace(game.els).targets.find(t => t.id === el.id);
      if (r && O.fitTarget(el, r.hit, 0.55)) { upd(); onSelect(el); ctx.toast('受光器の条件を設定しました'); }
      else ctx.toast('この受光器には光が届いていません');
    };
    box.appendChild(fit);
  }
  const prow = document.createElement('div'); prow.className = 'prow';
  const dup = document.createElement('button'); dup.className = 'btn sm'; dup.innerHTML = '<span>複製</span>'; dup.onclick = () => { game.duplicateSelected(); schedule(); };
  const del = document.createElement('button'); del.className = 'btn sm'; del.innerHTML = '<span>削除</span>'; del.onclick = () => { game.deleteSelected(); schedule(); };
  prow.append(dup, del); box.appendChild(prow);
}
