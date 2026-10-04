// 残り火の深庭 — EMBERVEIL / UI（HUD・メニュー・タッチ操作・地図）
// simの状態は書き換えない。必ず game.* / app.* を通す（例外は game.setPaused だけ）。
// 外枠のDOMは index.html / style.css が持つ。ここでは hidden・data-*・中身だけを操作する。

const $ = (id) => document.getElementById(id);
const safe = (fn, label = '') => {
  try { return fn(); } catch (e) { console.error(label || 'ui', e); return undefined; }
};

const TAB_SCREENS = ['inventory', 'craft', 'map', 'codex'];
const OWN_REASONS = ['menu', 'map', 'chest', 'dialog'];
const BIOME_JA = ['境界', '苔庭', '結晶洞', '灼熱遺跡'];
const TIER_JA = { 1: '石', 2: '銅', 3: '結晶', 4: '灼鋼' };

const SCREENS = {
  pause: { panel: 'pause', ja: 'メニュー', en: 'PAUSE', size: 'sm', reason: 'menu' },
  newgame: { panel: 'newgame', ja: '新しい旅', en: 'NEW JOURNEY', size: 'md', reason: 'menu' },
  saves: { panel: 'saves', ja: '記録の管理', en: 'SAVE SLOTS', size: 'md', reason: 'menu' },
  settings: { panel: 'settings', ja: '設定', en: 'SETTINGS', size: 'md', reason: 'menu' },
  help: { panel: 'help', ja: '遊び方', en: 'HOW TO PLAY', size: 'md', reason: 'menu' },
  credits: { panel: 'credits', ja: 'クレジット', en: 'CREDITS', size: 'md', reason: 'menu' },
  inventory: { panel: 'inventory', ja: '持ち物', en: 'INVENTORY', size: 'lg', reason: 'menu', tabs: true },
  craft: { panel: 'craft', ja: '作る', en: 'CRAFTING', size: 'lg', reason: 'menu', tabs: true },
  map: { panel: 'map', ja: '地図', en: 'MAP', size: 'lg', reason: 'map', tabs: true },
  codex: { panel: 'codex', ja: '記録', en: 'CODEX', size: 'lg', reason: 'menu', tabs: true },
  chest: { panel: 'chest', ja: '収納箱', en: 'CHEST', size: 'lg', reason: 'chest' },
  end: { panel: 'end', ja: '', en: '', size: 'sm', reason: 'dialog' },
  confirm: { panel: 'confirm', ja: '確認', en: 'CONFIRM', size: 'sm', reason: 'dialog' },
  seed: { panel: 'seed', ja: '植えるものを選ぶ', en: 'CHOOSE A SEED', size: 'sm', reason: 'dialog' },
  import: { panel: 'import', ja: 'JSONを読み込む', en: 'IMPORT', size: 'md', reason: 'menu' },
  export: { panel: 'export', ja: 'JSONを書き出す', en: 'EXPORT', size: 'md', reason: 'menu' },
};

const VERB_KEY = { attack: 'primary', mine: 'primary', chop: 'primary', gather: 'primary', place: 'primary', fish: 'primary', remove: 'remove' };
const KEY_LABEL = { primary: 'J', interact: 'E', remove: 'R' };
const TOUCH_LABEL = { primary: '使う', interact: '調べる', remove: '撤去' };
const TYPE_JA = {
  material: '素材', seed: '種', crop: '作物', food: '食料', potion: '薬', fish: '魚', pick: 'ツルハシ',
  axe: '斧', sword: '剣', armor: '防具', rod: '釣竿', place: '設置物',
};
const CATEGORY_JA = {
  station: '設備', tool: '道具', light: '灯り', food: '料理', build: '建材', decor: '装飾', armor: '防具', smelt: '精錬',
};
const CODEX_GROUP_JA = { item: '素材・道具', enemy: '生き物', fish: '魚', boss: '守護者', biome: '土地' };
const MARKER_JA = {
  player: '現在地', hub: '灯の祠', bed: 'ベッド', satchel: '遺灰袋', altar: '守護者の祭壇', gate: '封印門', objective: '目標', chest: '収納箱',
};
const MARKER_COLOR = {
  player: '#fff0c2', hub: '#f7b54a', bed: '#2fb3a6', satchel: '#e58fb5', altar: '#b48ce0', gate: '#ff7a3a', objective: '#6ff0d2', chest: '#c8a050',
};
// game が返す reason は日本語の文のことが多い。コードで返るものだけここで言い換える
const REASON_JA = {
  station: '近くに作業場所がありません', material: '材料が足りません', locked: 'まだ作れません',
};

// 保存できない理由
const SAVE_REASON_JA = {
  boss: 'ボス戦中は保存できません', dead: '倒れている間は保存できません', ending: 'エンディング中は保存できません',
  title: 'ゲームが始まっていません', readonly: 'このタブは閲覧のみのため保存できません',
};

// ---------- 小さな道具 ----------
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k === 'style') e.style.cssText = v;
      else if (k[0] === '.') e[k.slice(1)] = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmtPlay = (s) => {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh}時間${String(mm).padStart(2, '0')}分` : `${mm}分`;
};
const fmtClock = (s) => {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
};
const fmtDate = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const COMPASS = ['東', '南東', '南', '南西', '西', '北西', '北', '北東'];
const compass = (dx, dy) => COMPASS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
const setText = (el, v) => { if (el && el._v !== v) { el._v = v; el.textContent = v; } };
const setFill = (el, r) => {
  const v = clamp(Number.isFinite(r) ? r : 0, 0, 1).toFixed(3);
  if (el && el._f !== v) { el._f = v; el.style.setProperty('--fill', v); }
};
const sameRef = (a, b) => !!a && !!b && a.box === b.box && (a.i ?? 0) === (b.i ?? 0);

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])';
const isShown = (e) => !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';

// ui.js内で一意なstyle。style.cssに足りない分だけを .game-app 配下に限定して足す
const DYNAMIC_CSS = `
.game-app { --ui-scale: 1; }
.game-app[data-ui-scale="125"] { --ui-scale: 1.25; }
.game-app[data-ui-scale="150"] { --ui-scale: 1.5; }
.game-app .ui-glyph { display: grid; place-items: center; width: 62%; max-width: 32px; aspect-ratio: 1; border: 1px solid rgba(0,0,0,.55); background: var(--gc, #5a6b66); color: #fff; font: 700 14px/1 var(--font-sans); text-shadow: 0 1px 0 rgba(0,0,0,.7); pointer-events: none; }
.game-app .recipe .ui-glyph { width: 28px; }
.game-app .ingredient .ui-glyph { width: 20px; font-size: 11px; }
.game-app .item-grid[data-cols="8"] { grid-template-columns: repeat(8, minmax(0, 1fr)); }
.game-app .item-cell[data-lifted="true"] { outline: 2px dashed var(--amber-hi); outline-offset: -3px; }
.game-app .item-cell[data-hot="true"] { border-color: var(--line-soft); }
.game-app .equipment-slots { align-items: stretch; }
.game-app .equipment-slots .item-cell { flex: none; width: 56px; height: 56px; }
.game-app .equipment-slots .detail-stats { flex: 1 1 150px; align-content: center; }
.game-app .item-cell .slot-tag { position: absolute; left: 3px; top: 1px; font: 10px/1.3 var(--font-serif); color: var(--ink-faint); pointer-events: none; }
.game-app .detail-en { margin-left: .6em; font: .72em var(--font-serif); letter-spacing: .18em; color: var(--ink-faint); text-transform: uppercase; }
.game-app textarea.input { min-height: 7em; padding: 8px 12px; line-height: 1.5; resize: vertical; font: 12px/1.5 ui-monospace, Consolas, monospace; }
.game-app .toast.is-banner { padding: 10px 28px; border-left-width: 1px; border-top: 2px solid var(--tone); text-align: center; font-size: 15px; letter-spacing: .22em; }
.game-app .toast .toast-actions { display: flex; gap: 6px; margin-top: 6px; justify-content: flex-end; }
.game-app .toast .toast-actions button, .game-app .toast .toast-close { pointer-events: auto; min-height: 28px; padding: 0 10px; border: 1px solid var(--line-soft); border-radius: 2px; font-size: 12px; }
.game-app .toast[data-actions="true"] { pointer-events: auto; }
.game-app .interact-prompt[data-urgent="true"] { border-color: var(--amber-hi); background: rgba(60, 42, 14, .9); }
.game-app .interact-prompt[data-urgent="true"] .interact-key { color: #fff3d6; }
.game-app .notice.is-temp { pointer-events: auto; }
.game-app .end-text .end-ja { display: block; }
.game-app .end-text .end-en { display: block; margin-bottom: .6em; font: .8em var(--font-serif); letter-spacing: .08em; color: var(--ink-faint); }
.game-app .entry-list > li.entry-heading { padding: 4px 2px; border: 0; background: none; font: 13px var(--font-serif); letter-spacing: .22em; color: var(--amber); }
.game-app .entry-list .entry-name { display: flex; align-items: baseline; gap: .6em; font-family: var(--font-serif); color: #fff3d6; }
.game-app .entry-list .entry-desc { color: var(--ink-dim); font-size: .92em; }
.game-app .entry-list .entry-where { color: var(--ink-faint); font-size: .86em; }
.game-app .entry-list li[data-locked="true"] .entry-name { color: var(--ink-faint); }
.game-app .entry-list li[data-current="true"] { border-color: var(--amber-hi); background: rgba(60, 42, 14, .45); }
.game-app .ui-note { color: var(--ink-faint); font-size: 12.5px; }
.game-app .map-legend button { display: inline-flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 8px; width: 100%; border: 1px solid var(--line-faint); border-radius: 2px; text-align: left; }
.game-app .map-legend button:hover { border-color: var(--line); }
.game-app .map-legend i { flex: none; width: 10px; height: 10px; background: var(--mc, #fff); }
.game-app .map-viewport:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.game-app .touch-actions { grid-template-columns: var(--act-sub) var(--act-sub) var(--act-main); grid-template-areas: "heal remove interact" ". dodge act"; }
.game-app #touch-heal { grid-area: heal; }
.game-app #touch-remove { grid-area: remove; }
.game-app #touch-dodge { grid-area: dodge; }
.game-app .confirm-lines { display: grid; gap: 8px; line-height: 1.8; }
.game-app .confirm-lines p { color: var(--ink); }
.game-app .confirm-lines p.dim { color: var(--ink-dim); font-size: .92em; }
.game-app .menu-list.stack { width: 100%; }
.game-app .import-summary { margin: 0; }
.game-app .title-foot[data-degraded="true"] { color: var(--warn); }
.game-app[data-ui-scale="125"], .game-app[data-ui-scale="150"] { font-size: calc(14px * var(--ui-scale)); }
.game-app[data-ui-scale="125"] dialog.modal, .game-app[data-ui-scale="150"] dialog.modal { font-size: calc(14px * var(--ui-scale)); }
.game-app[data-ui-scale="125"] :is(.btn, .modal-tab, .input, .switch-text, .recipe, .ingredient, .chip, .detail-text, .detail-stats, .field-label, .field-help, .panel-note, .group-title, .keylist, .entry-list, .save-slot-name, .end-text) { font-size: calc(13.5px * var(--ui-scale)); }
.game-app[data-ui-scale="150"] :is(.btn, .modal-tab, .input, .switch-text, .recipe, .ingredient, .chip, .detail-text, .detail-stats, .field-label, .field-help, .panel-note, .group-title, .keylist, .entry-list, .save-slot-name, .end-text) { font-size: calc(13.5px * var(--ui-scale)); }
.game-app[data-ui-scale="125"] :is(.hud-stat, .hud-line, .objective-text, .tool-btn, .toast, .interact-prompt, .hotbar-label, .menu-btn-ja, .title-intro, .notice-text), .game-app[data-ui-scale="150"] :is(.hud-stat, .hud-line, .objective-text, .tool-btn, .toast, .interact-prompt, .hotbar-label, .menu-btn-ja, .title-intro, .notice-text) { font-size: calc(12.5px * var(--ui-scale)); }
.game-app[data-ui-scale="125"] :is(.hud-vitals, .hud-objective), .game-app[data-ui-scale="150"] :is(.hud-vitals, .hud-objective) { width: min(100%, calc(212px * var(--ui-scale))); }
`;

export class UI {
  constructor(game, { app, input, renderer, audio, store } = {}) {
    this.game = game;
    this.app = app;
    this.input = input;
    this.renderer = renderer;
    this.audio = audio;
    this.store = store;
    this.data = game.data;
    this.ready = false;
    this.screen = 'boot'; // boot | title | play | error
    this.stack = [];
    this.lastSeq = 0;
    this.worldId = -1;
    this.sel = null;
    this.lift = null;
    this.iconCache = new Map();
    this.toasts = [];
    this.hudT = 0;
    this.miniT = 0;
    this.panelT = 0;
    this.pauseSig = '';
    this.deadT = 0;
    this.deadShown = false;
    this.endingShown = false;
    this.pickups = new Map();
    this.pickupT = 0;
    this.recipeSel = null;
    this.recipeCat = 'all';
    this.onlyReady = false;
    this.recipeRows = new Map();
    this.recipeOrder = '';
    this.codexFilter = 'goals';
    this.mapCursor = { x: 64, y: 64 };
    this.dialogue = null;
    this.lastBack = 0;
    this.seenBiomes = new Set();
    this.lastDeath = null;
    this.saveFailToast = null;
    this.saveIndTimer = 0;
    this.lastMsgAt = new Map();
    this.coarse = !!safe(() => matchMedia('(pointer: coarse)').matches);
  }

  // ---------- 初期化 ----------
  init() {
    if (this.ready) return;
    this.root = $('game-app');
    this.modal = $('modal');
    this.injectStyle();
    this.buildExtras();
    this.bindEvents();
    this.ready = true;
    this.applySettings();
  }

  injectStyle() {
    if ($('ui-dynamic-style')) return;
    const st = document.createElement('style');
    st.id = 'ui-dynamic-style';
    st.textContent = DYNAMIC_CSS;
    document.head.appendChild(st);
  }

  menuButton(id, ja, en, extra = '') {
    return h('button', { id, type: 'button', class: `menu-btn${extra}` },
      h('span', { class: 'menu-btn-ja', text: ja }),
      h('span', { class: 'menu-btn-en', lang: 'en', 'aria-hidden': 'true', text: en }));
  }

  switchRow(id, label) {
    return h('div', { class: 'switch-row' },
      h('label', { class: 'switch', for: id },
        h('span', { class: 'switch-text', text: label }),
        h('input', { id, class: 'switch-input', type: 'checkbox' }),
        h('span', { class: 'switch-track', 'aria-hidden': 'true' })));
  }

  panel(id, children) {
    return h('section', { id: `panel-${id}`, class: 'modal-panel', dataset: { panel: id }, hidden: true }, children);
  }

  // index.htmlに無い部品を、既存のホストの中へ足す
  buildExtras() {
    const body = $('modal-body');

    // タイトル：記録の管理
    const menu = $('title-menu');
    menu.insertBefore(this.menuButton('btn-title-saves', '記録の管理', 'SLOTS'), $('btn-settings'));

    // ポーズ：帰還・書き出し・クレジット
    const list = $('panel-pause').querySelector('.menu-list');
    list.insertBefore(this.menuButton('btn-pause-return', '灯へ帰る', 'RETURN'), $('btn-pause-save'));
    list.insertBefore(this.menuButton('btn-pause-export', '書き出し', 'EXPORT'), $('btn-pause-settings'));
    list.insertBefore(this.menuButton('btn-pause-credits', 'クレジット', 'CREDITS'), $('btn-pause-title'));

    // 新しい旅：キャラクター選択は契約に無いので隠し、難易度とHEARTHを足す
    $('newgame-character').closest('fieldset').hidden = true;
    const slotField = $('newgame-slot').closest('.field');
    slotField.parentNode.insertBefore(h('div', { class: 'field' },
      h('label', { class: 'field-label', for: 'newgame-difficulty', text: '難易度' }),
      h('select', { id: 'newgame-difficulty', class: 'input' },
        h('option', { value: 'standard', text: '標準 — 設計どおりの強さ' }),
        h('option', { value: 'gentle', text: '穏やか — 被ダメージ×0.6・予告が長い・空腹がゆるやか' })),
      h('p', { class: 'field-help', text: '難易度は、あとから設定でいつでも変えられます。' })), slotField);
    $('btn-seed-random').after(h('button', { id: 'btn-seed-hearth', type: 'button', class: 'btn', title: '初回向けのおすすめシード', text: 'HEARTH' }));

    // 設定：全項目
    this.buildSettings();

    // 遊び方・クレジット
    this.buildHelp();
    this.buildCredits();

    // 持ち物：分ける・メッセージ
    $('btn-item-drop').before(h('button', { id: 'btn-item-split', type: 'button', class: 'btn', disabled: true, text: '半分に分ける' }));
    $('btn-item-drop').closest('.panel-actions').after(h('p', { id: 'inventory-message', class: 'panel-note', role: 'status' }));

    // 作る：×5・最大
    $('btn-craft-make').after(
      h('button', { id: 'btn-craft-make5', type: 'button', class: 'btn', disabled: true, text: '×5' }),
      h('button', { id: 'btn-craft-max', type: 'button', class: 'btn', disabled: true, text: '最大' }));

    // 収納：選んだ物を移す・分ける・同じ物
    $('btn-chest-take-all').before(
      h('button', { id: 'btn-chest-move', type: 'button', class: 'btn btn--primary', disabled: true, text: '選んだ物を移す' }),
      h('button', { id: 'btn-chest-split', type: 'button', class: 'btn', disabled: true, text: '半分に分ける' }));
    $('btn-chest-stash-all').after(h('button', { id: 'btn-chest-match', type: 'button', class: 'btn', text: '同じ物を入れる' }));
    $('btn-chest-stash-all').closest('.panel-actions').after(h('p', { id: 'chest-message', class: 'panel-note', role: 'status' }));

    // 地図：キーボード操作できるように
    const vp = $('map-viewport');
    vp.tabIndex = 0;
    vp.setAttribute('role', 'application');
    vp.setAttribute('aria-label', '地図。矢印キーでカーソルを動かすと、近くの印を読み上げます');

    // タッチ操作：撤去・回復を足し、すべてにdata-inputを付ける
    const acts = $('touch-actions');
    $('touch-act').dataset.input = 'primary';
    $('touch-interact').dataset.input = 'interact';
    $('touch-dodge').dataset.input = 'dodge';
    acts.append(
      h('button', { id: 'touch-remove', type: 'button', class: 'touch-btn touch-btn--sub', 'aria-label': '撤去', dataset: { input: 'remove' }, text: '撤去' }),
      h('button', { id: 'touch-heal', type: 'button', class: 'touch-btn touch-btn--sub', 'aria-label': 'すぐ回復', dataset: { input: 'quickHeal' }, text: '回復' }));

    // 追加パネル（確認・種の選択・JSON入出力）
    body.append(
      this.panel('confirm', [
        h('div', { id: 'confirm-lines', class: 'confirm-lines' }),
        h('div', { id: 'confirm-actions', class: 'panel-actions' }),
      ]),
      this.panel('seed', [
        h('p', { id: 'seed-text', class: 'detail-text' }),
        h('div', { id: 'seed-list', class: 'menu-list stack' }),
        h('div', { class: 'panel-actions' }, h('button', { id: 'btn-seed-cancel', type: 'button', class: 'btn', text: 'やめる' })),
      ]),
      this.panel('import', [h('div', { class: 'form-stack' },
        h('div', { class: 'field' },
          h('label', { class: 'field-label', for: 'import-text', text: '書き出したJSONを貼り付ける' }),
          h('textarea', { id: 'import-text', class: 'input', rows: 6, spellcheck: 'false', autocomplete: 'off', placeholder: '{ "format": "emberveil-save", ... }' }),
          h('div', { class: 'panel-actions panel-actions--start' },
            h('button', { id: 'btn-import-pick', type: 'button', class: 'btn', text: 'ファイルを選ぶ' }),
            h('button', { id: 'btn-import-check', type: 'button', class: 'btn btn--primary', text: '検証する' }))),
        h('div', { id: 'import-preview', class: 'detail', hidden: true },
          h('p', { class: 'detail-name', text: '検証に成功しました' }),
          h('dl', { id: 'import-summary', class: 'detail-stats import-summary' })),
        h('div', { id: 'import-slot-field', class: 'field', hidden: true },
          h('label', { class: 'field-label', for: 'import-slot', text: '書き込み先' }),
          h('select', { id: 'import-slot', class: 'input' }),
          h('p', { id: 'import-overwrite', class: 'field-help field-help--warn', role: 'status' })),
        h('p', { id: 'import-message', class: 'panel-note', role: 'status' }),
        h('div', { class: 'panel-actions' },
          h('button', { id: 'btn-import-apply', type: 'button', class: 'btn btn--primary', disabled: true, text: 'このスロットに書き込む' }),
          h('button', { id: 'btn-import-back', type: 'button', class: 'btn', text: '戻る' })))]),
      this.panel('export', [
        h('p', { id: 'export-info', class: 'detail-text' }),
        h('label', { class: 'visually-hidden', for: 'export-text', text: '書き出したJSON' }),
        h('textarea', { id: 'export-text', class: 'input', rows: 8, readonly: true, spellcheck: 'false' }),
        h('div', { class: 'panel-actions panel-actions--start' },
          h('button', { id: 'btn-export-download', type: 'button', class: 'btn btn--primary', text: 'ファイルに保存' }),
          h('button', { id: 'btn-export-select', type: 'button', class: 'btn', text: '全選択' }),
          h('button', { id: 'btn-export-copy', type: 'button', class: 'btn', text: 'コピー' })),
        h('p', { id: 'export-message', class: 'panel-note', role: 'status' }),
        h('div', { class: 'panel-actions' }, h('button', { id: 'btn-export-back', type: 'button', class: 'btn', text: '戻る' })),
      ]));
  }

  buildSettings() {
    const groups = $('panel-settings').querySelectorAll('fieldset.field-group');
    const display = groups[1];
    display.append(h('div', { class: 'field' },
      h('label', { class: 'field-label', for: 'setting-uiscale', text: 'UIの大きさ' }),
      h('select', { id: 'setting-uiscale', class: 'input' },
        h('option', { value: '100', text: '標準（100%）' }),
        h('option', { value: '125', text: '大きめ（125%）' }),
        h('option', { value: '150', text: '大きい（150%）' }))));
    display.append(
      this.switchRow('setting-shake', '画面の揺れ'),
      this.switchRow('setting-damage', 'ダメージ数値を表示'),
      this.switchRow('setting-contrast', '攻撃予告を強調'),
      this.switchRow('setting-arrow', '目標の方向を表示'));
    $('setting-volume').step = '10';
    const play = h('fieldset', { class: 'field-group', id: 'setting-group-play' },
      h('legend', { class: 'group-title', text: 'ゲーム' }),
      h('div', { class: 'field', id: 'setting-difficulty-field' },
        h('label', { class: 'field-label', for: 'setting-difficulty', text: '難易度（いまのセーブに適用）' }),
        h('select', { id: 'setting-difficulty', class: 'input' },
          h('option', { value: 'standard', text: '標準' }),
          h('option', { value: 'gentle', text: '穏やか' }))),
      this.switchRow('setting-autotool', '道具の自動切り替え'));
    groups[2].after(play);
  }

  buildHelp() {
    const keys = [
      ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>矢印</kbd>', '移動'],
      ['<kbd>J</kbd> / <kbd>Space</kbd> / 左クリック', '使う・攻撃・掘る・釣り'],
      ['<kbd>E</kbd> / <kbd>K</kbd> / <kbd>Enter</kbd>', '調べる・開ける・眠る'],
      ['<kbd>L</kbd> / <kbd>Shift</kbd>', '回避'],
      ['<kbd>R</kbd>', '撤去（自分で置いた物）'],
      ['<kbd>Q</kbd>', 'すぐ回復'],
      ['<kbd>1</kbd>〜<kbd>8</kbd> / <kbd>Z</kbd><kbd>X</kbd> / ホイール', 'ホットバー'],
      ['<kbd>I</kbd> / <kbd>Tab</kbd>', '持ち物'],
      ['<kbd>C</kbd>', '作る'],
      ['<kbd>M</kbd>', '地図'],
      ['<kbd>G</kbd>', '記録（目標・図鑑・実績）'],
      ['<kbd>Esc</kbd> / <kbd>P</kbd>', 'メニュー・閉じる'],
      ['メニュー内：矢印 / <kbd>Enter</kbd> / <kbd>Tab</kbd>', '移動・決定・フォーカス'],
      ['メニュー内：<kbd>Q</kbd><kbd>E</kbd> / <kbd>PageUp</kbd><kbd>PageDown</kbd>', 'タブの切り替え'],
    ];
    const dl = $('panel-help').querySelector('.keylist');
    dl.replaceChildren(...keys.map(([k, v]) => {
      const dt = h('dt');
      dt.innerHTML = k;
      return h('div', null, dt, h('dd', { text: v }));
    }));
    const touch = [...$('panel-help').querySelectorAll('h3')].find((e) => e.textContent.includes('タッチ'));
    if (touch && touch.nextElementSibling) {
      touch.nextElementSibling.textContent = '左のスティックで移動、右のボタンで「使う」「調べる」「回避」「撤去」「回復」。画面をタップすると、その場所に向かって使います。下のホットバーをタップして持ち物を切り替えます。';
    }
    $('panel-help').querySelector('.bullets').append(
      h('li', { text: '釣竿を持って水辺に向かって使い、頭上に「！」が出た瞬間にもう一度押す。早すぎるとやり直しです。' }),
      h('li', { text: 'ボス戦では、地面に光る範囲が攻撃の予告です。範囲から離れるか、回避で抜けましょう。ボス戦中は保存できません。' }),
      h('li', { text: '三つの核がそろったら、祠の中心の炉心を調べて捧げます。' }));
  }

  buildCredits() {
    const root = $('panel-credits').querySelector('.prose');
    const lines = this.data.CREDITS || [];
    root.querySelector('.credit-main').after(
      h('ul', { class: 'bullets', id: 'credits-staff', 'aria-label': 'スタッフ' }, lines.filter((l) => !l.title).map((l) => h('li', { text: l.ja }))));
    root.append(
      h('p', { class: 'panel-note' }, h('a', { href: '../../', text: 'サイトへ戻る' })),
      h('div', { id: 'credits-actions', class: 'panel-actions', hidden: true },
        h('button', { id: 'btn-credits-free', type: 'button', class: 'btn btn--primary', text: '自由建築をはじめる' })));
    setText($('credits-version'), `EMBERVEIL v${this.data.VERSION || ''}`);
  }

  // ---------- イベント登録 ----------
  bindEvents() {
    const on = (id, fn, type = 'click') => $(id)?.addEventListener(type, fn);

    // タイトル
    on('btn-new-game', () => this.openScreen('newgame', {}));
    on('btn-continue', () => this.continueLast());
    on('btn-title-saves', () => this.openScreen('saves'));
    on('btn-settings', () => this.openScreen('settings'));
    on('btn-help', () => this.openScreen('help'));
    on('btn-credits', () => this.openScreen('credits'));

    // モーダル共通
    on('modal-close', () => this.handleBack());
    this.modal.addEventListener('cancel', (e) => { e.preventDefault(); this.handleBack(); });
    // closeイベントは非同期。閉じた直後に別の画面を開いた場合（open中）は何もしない
    this.modal.addEventListener('close', () => { if (this.stack.length && !this.modal.open) this.closeAll(true); });
    $('modal-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.modal-tab');
      if (t) this.openScreen(t.dataset.panel);
    });

    // HUD
    on('btn-map', () => this.hudOpen('map'));
    on('btn-inventory', () => this.hudOpen('inventory'));
    on('btn-craft', () => this.hudOpen('craft'));
    on('btn-codex', () => this.hudOpen('codex'));
    on('btn-pause', () => this.hudOpen('pause'));
    $('hotbar-slots').addEventListener('click', (e) => {
      const b = e.target.closest('.hotbar-slot');
      if (b && this.game.mode === 'playing' && !this.game.paused) safe(() => this.game.selectHotbar(Number(b.dataset.slot)));
    });
    on('btn-dialogue-next', () => this.dialogueNext());
    on('btn-dialogue-close', () => this.closeDialogue());

    // 通知
    on('btn-storage-warning-dismiss', () => { this.storageDismissed = true; $('storage-warning').hidden = true; });
    // #btn-take-control は main.js が requestTakeControl() に結びつける

    // 一時停止
    on('btn-resume', () => this.closeAll());
    on('btn-pause-save', () => this.manualSave());
    on('btn-pause-saves', () => this.openScreen('saves'));
    on('btn-pause-settings', () => this.openScreen('settings'));
    on('btn-pause-help', () => this.openScreen('help'));
    on('btn-pause-credits', () => this.openScreen('credits'));
    on('btn-pause-export', () => this.exportCurrentFlow());
    on('btn-pause-return', () => this.doReturn());
    on('btn-pause-title', () => this.quitFlow());

    // 新しい旅
    on('btn-seed-random', () => { $('newgame-seed').value = this.app.randomSeed(); });
    on('btn-seed-hearth', () => { $('newgame-seed').value = 'HEARTH'; });
    on('newgame-slot', () => this.updateOverwriteWarning(), 'change');
    on('newgame-form', (e) => { e.preventDefault(); this.submitNewGame(); }, 'submit');
    on('btn-newgame-cancel', () => this.handleBack());

    // 記録・JSON
    on('btn-export-json', () => this.exportCurrentFlow());
    on('btn-import-json', () => this.openScreen('import'));
    on('save-slots', (e) => this.onSlotClick(e));
    on('import-file', () => this.onImportFile(), 'change');
    on('btn-import-pick', () => $('import-file').click());
    on('btn-import-check', () => this.checkImport());
    on('import-text', () => this.invalidateImport(), 'input');
    on('btn-import-apply', () => this.applyImport());
    on('btn-import-back', () => this.handleBack());
    on('btn-export-download', () => this.exportDownload());
    on('btn-export-select', () => { const t = $('export-text'); t.focus(); t.select(); });
    on('btn-export-copy', () => this.exportCopy());
    on('btn-export-back', () => this.handleBack());
    on('btn-seed-cancel', () => this.handleBack());

    // 設定
    this.bindSettings();

    // 持ち物
    for (const id of ['inventory-grid', 'chest-grid', 'chest-player-grid', 'equipment-slots']) {
      $(id).addEventListener('click', (e) => {
        const c = e.target.closest('.item-cell');
        if (c && c._ref) this.onCellClick(c._ref);
      });
    }
    on('btn-item-use', () => this.itemUse());
    on('btn-item-equip', () => this.itemEquip());
    on('btn-item-assign', () => this.itemAssign());
    on('btn-item-split', () => this.itemSplit('inventory-message'));
    on('btn-item-drop', () => this.itemDrop());

    // 収納
    on('btn-chest-move', () => this.chestMove());
    on('btn-chest-split', () => this.itemSplit('chest-message'));
    on('btn-chest-take-all', () => this.chestBulk('takeAll', 'すべて取りました'));
    on('btn-chest-stash-all', () => this.chestBulk('depositAll', 'バッグの中身を入れました'));
    on('btn-chest-match', () => this.chestBulk('depositMatching', '箱にある種類の物を入れました'));

    // 作る
    on('craft-list', (e) => {
      const b = e.target.closest('.recipe');
      if (b) { this.recipeSel = b.closest('.recipe-row').dataset.id; this.renderCraft(); }
    });
    on('craft-categories', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      if (c.dataset.cat === '__ready') this.onlyReady = !this.onlyReady; else this.recipeCat = c.dataset.cat;
      this.renderCraft(true);
    });
    on('btn-craft-make', () => this.doCraft(1));
    on('btn-craft-make5', () => this.doCraft(5));
    on('btn-craft-max', () => this.doCraft(0));

    // 地図
    $('map-canvas').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      this.setMapCursor(Math.floor(((e.clientX - r.left) / r.width) * 128), Math.floor(((e.clientY - r.top) / r.height) * 128));
    });
    $('map-legend').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.setMapCursor(Number(b.dataset.x), Number(b.dataset.y));
    });

    // 記録
    on('codex-filter', (e) => {
      const c = e.target.closest('.chip');
      if (c) { this.codexFilter = c.dataset.filter; this.renderCodex(); }
    });

    // 終了画面
    on('btn-end-primary', () => this.endPrimary());
    on('btn-end-secondary', () => this.endSecondary());
    on('btn-credits-free', () => this.finishEnding());

    // アプリからの通知
    this.app.on('save', (r) => this.onSaveResult(r));
    this.app.on('lost', () => { this.followMode(0); });
    this.app.on('settings', () => this.applySettings());
  }

  bindSettings() {
    const s = (id, fn, type = 'change') => $(id).addEventListener(type, fn);
    const set = (partial) => this.app.setSettings(partial);
    s('setting-sound', (e) => set({ soundOn: e.target.checked }));
    s('setting-volume', (e) => { $('setting-volume-value').textContent = e.target.value; set({ volume: Math.round(Number(e.target.value) / 10) }); }, 'input');
    s('setting-zoom', (e) => { $('setting-zoom-value').textContent = `×${e.target.value}`; set({ zoom: Number(e.target.value) }); this.onResize(); }, 'input');
    s('setting-reduced-motion', (e) => set({ reducedMotion: e.target.value }));
    s('setting-touch', (e) => set({ touchControls: e.target.value }));
    s('setting-left-hand', (e) => set({ leftHand: e.target.checked }));
    s('setting-uiscale', (e) => set({ uiScale: Number(e.target.value) }));
    s('setting-shake', (e) => set({ screenShake: e.target.checked }));
    s('setting-damage', (e) => set({ showDamageNumbers: e.target.checked }));
    s('setting-contrast', (e) => set({ highContrastTelegraph: e.target.checked }));
    s('setting-arrow', (e) => set({ objectiveArrow: e.target.checked }));
    s('setting-difficulty', (e) => set({ difficulty: e.target.value }));
    s('setting-autotool', (e) => set({ autoTool: e.target.checked }));
    s('btn-settings-reset', () => { this.app.resetSettings(); this.speak('設定を初期値に戻しました'); }, 'click');
  }

  // 設定をDOMへ反映する（設定そのものの出力は app.applyOutputs が行う）
  applySettings() {
    if (!this.ready) return;
    const a = this.app.getAll();
    const r = this.root;
    r.dataset.reducedMotion = a.reduceMotion ? 'on' : 'off';
    r.dataset.hand = a.leftHand ? 'left' : 'right';
    r.dataset.uiScale = String(a.uiScale);
    const set = (id, v) => { const e = $(id); if (e) { if (e.type === 'checkbox') e.checked = !!v; else e.value = String(v); } };
    set('setting-sound', a.soundOn);
    set('setting-volume', a.volume * 10);
    setText($('setting-volume-value'), String(a.volume * 10));
    set('setting-zoom', a.zoom);
    setText($('setting-zoom-value'), `×${a.zoom}`);
    set('setting-reduced-motion', a.reducedMotion);
    set('setting-touch', a.touchControls);
    set('setting-left-hand', a.leftHand);
    set('setting-uiscale', a.uiScale);
    set('setting-shake', a.screenShake);
    set('setting-damage', a.showDamageNumbers);
    set('setting-contrast', a.highContrastTelegraph);
    set('setting-arrow', a.objectiveArrow);
    set('setting-autotool', a.autoTool);
    set('setting-difficulty', this.game.mode !== 'title' && this.game.difficulty ? this.game.difficulty : a.difficulty);
    $('setting-difficulty-field').hidden = this.game.mode === 'title';
    this.updateTouch();
  }

  setDegraded(list) {
    const foot = document.querySelector('.title-foot');
    if (!foot) return;
    const warn = [...new Set(list || [])];
    if (!warn.length) return;
    foot.dataset.degraded = 'true';
    foot.textContent = `一部を読み込めなかったため、簡易表示で動いています（${warn.join('・')}）。`;
  }

  // ---------- 画面の出し入れ ----------
  top() { return this.stack[this.stack.length - 1] || null; }
  hasKind(kind) { return this.stack.some((s) => s.params?.kind === kind); }
  hasScreen(name) { return this.stack.some((s) => s.name === name); }

  showScreen(name, params = {}) {
    const alias = { slots: 'saves', exportView: 'export', lockDialog: 'confirm', dialog: 'confirm' };
    switch (name) {
      case 'boot': return this.showBoot(params);
      case 'error': return this.showError(params);
      case 'title': return this.showTitle();
      case 'hud': return this.closeAll();
      case 'intro': return this.openScreen('end', { kind: 'intro', index: 0, ...params });
      case 'dead': return this.openScreen('end', { kind: 'dead', ...params });
      case 'ending': return this.openScreen('end', { kind: 'ending', ...params });
      case 'readonly': return this.openReadonly();
      default: return this.openScreen(alias[name] || name, params);
    }
  }

  closeScreen() { if (this.stack.length) this.popTop(); }

  showBoot(p = {}) {
    this.screen = 'boot';
    $('loading-screen').hidden = false;
    if (p.text) setText($('loading-text'), p.text);
  }

  showError(p = {}) {
    this.screen = 'error';
    $('loading-screen').hidden = true;
    $('title-screen').hidden = true;
    $('hud').hidden = true;
    if (p.title) setText($('error-title'), p.title);
    if (p.message) setText($('error-message'), p.message);
    setText($('error-detail'), String(p.detail || ''));
    $('error-screen').hidden = false;
    $('btn-error-retry')?.focus();
  }

  canOpen(name) {
    const g = this.game;
    const inGame = ['pause', 'inventory', 'craft', 'map', 'codex', 'chest', 'seed'].includes(name);
    if (inGame && (g.mode === 'title' || !g.world)) return false;
    if (['inventory', 'craft', 'map', 'codex', 'pause'].includes(name) && g.mode !== 'playing') return false;
    if (this.screen === 'boot' || this.screen === 'error') return false;
    return true;
  }

  openScreen(name, params = {}) {
    if (!SCREENS[name] || !this.canOpen(name)) return false;
    const top = this.top();
    if (top && top.name === name && !params.force && !['confirm', 'end'].includes(name)) {
      top.params = { ...top.params, ...params };
    } else if (top && TAB_SCREENS.includes(name) && TAB_SCREENS.includes(top.name)) {
      this.stack[this.stack.length - 1] = { name, params, opener: top.opener };
    } else {
      this.stack.push({ name, params, opener: document.activeElement });
    }
    this.renderTop(true);
    return true;
  }

  popTop() {
    const e = this.stack.pop();
    if (!e) return;
    this.onLeave(e);
    if (this.stack.length) { this.renderTop(false); this.restoreFocus(e.opener, true); } else this.finishClose(e.opener);
  }

  removeScreen(name) { this.removeAt(this.stack.findIndex((s) => s.name === name)); }

  removeAt(i) {
    if (i < 0 || i >= this.stack.length) return;
    if (i === this.stack.length - 1) return this.popTop();
    this.onLeave(this.stack[i]);
    this.stack.splice(i, 1);
    this.syncPause();
  }

  closeAll(fromNative = false) {
    const first = this.stack[0];
    while (this.stack.length) this.onLeave(this.stack.pop());
    this.finishClose(first?.opener, fromNative);
  }

  onLeave(e) {
    if (e.name === 'chest' && this.game.openContainer != null) safe(() => this.game.closeContainer());
    if (['inventory', 'chest'].includes(e.name)) { this.lift = null; }
    if (e.name === 'confirm' && e.params.onDismiss) safe(() => e.params.onDismiss());
  }

  finishClose(opener, fromNative = false) {
    if (!fromNative && this.modal.open) safe(() => this.modal.close());
    this.root.dataset.modal = 'none';
    this.syncPause();
    this.restoreFocus(opener, false);
  }

  restoreFocus(opener, inModal) {
    let t = opener;
    const ok = t && t.isConnected && !t.disabled && t !== document.body && t.getClientRects().length > 0 && (!inModal || this.modal.contains(t));
    if (!ok) {
      t = inModal
        ? (this.focusables($('modal-body'))[0] || this.focusables(this.modal)[0])
        : (this.screen === 'title' ? $('title-menu').querySelector('.menu-btn:not([disabled])') : $('world-canvas'));
    }
    safe(() => t && t.focus({ preventScroll: true }));
  }

  renderTop(focus) {
    const entry = this.top();
    if (!entry) return;
    const def = SCREENS[entry.name];
    const p = entry.params;
    const meta = entry.name === 'end' ? this.endMeta(p) : { ja: p.ja ?? p.title ?? def.ja, en: p.en ?? def.en };
    setText($('modal-title'), meta.ja);
    setText($('modal-eyebrow'), meta.en);
    this.modal.dataset.size = p.size || def.size;
    for (const sec of $('modal-body').querySelectorAll(':scope > .modal-panel')) sec.hidden = sec.dataset.panel !== def.panel;
    $('modal-tabs').hidden = !def.tabs;
    for (const t of $('modal-tabs').querySelectorAll('.modal-tab')) t.setAttribute('aria-selected', String(t.dataset.panel === entry.name));
    $('modal-close').hidden = !!p.locked || (entry.name === 'end' && p.kind !== 'intro');
    this.root.dataset.modal = 'open';
    if (!this.modal.open) {
      try { this.modal.showModal(); } catch { this.modal.setAttribute('open', ''); }
    }
    $('modal-body').scrollTop = 0;
    switch (entry.name) {
      case 'pause': this.renderPause(); break;
      case 'newgame': this.renderNewGame(); break;
      case 'saves': this.renderSaves(); break;
      case 'settings': this.applySettings(); break;
      case 'credits': this.renderCredits(); break;
      case 'inventory': this.renderInventory(); break;
      case 'craft': this.renderCraft(true); break;
      case 'map': this.renderMap(true); break;
      case 'codex': this.renderCodex(); break;
      case 'chest': this.renderChest(); break;
      case 'end': this.renderEnd(); break;
      case 'confirm': this.renderConfirm(); break;
      case 'seed': this.renderSeed(); break;
      case 'import': this.renderImport(); break;
      case 'export': this.renderExport(); break;
      default: break;
    }
    this.syncPause();
    if (focus) this.focusPanel();
  }

  focusPanel() {
    const entry = this.top();
    if (!entry) return;
    const panel = $(`panel-${SCREENS[entry.name].panel}`);
    const pick = (sel) => panel.querySelector(sel);
    let t = null;
    switch (entry.name) {
      case 'inventory': t = pick('.item-cell[aria-selected="true"]') || pick('#inventory-grid .item-cell'); break;
      case 'craft': t = pick('.recipe[aria-pressed="true"]') || pick('.recipe') || pick('.chip'); break;
      case 'map': t = $('map-viewport'); break;
      case 'codex': t = pick('.chip[aria-pressed="true"]'); break;
      case 'newgame': t = $('newgame-seed'); break;
      case 'import': t = $('import-text'); break;
      case 'export': t = $('btn-export-download'); break;
      default: t = pick('[data-autofocus]') || pick('.menu-btn--primary') || pick('.btn--primary:not([disabled])'); break;
    }
    if (!t || !isShown(t) || t.disabled) t = this.focusables(panel)[0] || $('modal-close');
    safe(() => t.focus({ preventScroll: true }));
  }

  // 開いている画面から、pauseReasons を計算して反映する（残さない）
  syncPause() {
    const g = this.game;
    const want = new Set();
    if (g.mode !== 'title') {
      for (const s of this.stack) want.add(SCREENS[s.name].reason);
      if (this.dialogue) want.add('dialog');
    }
    const sig = OWN_REASONS.map((r) => (want.has(r) ? 1 : 0)).join('') + g.mode;
    if (sig === this.pauseSig) return;
    this.pauseSig = sig;
    for (const r of OWN_REASONS) safe(() => g.setPaused(r, want.has(r)));
  }

  isCapturingInput() {
    if (this.stack.length || this.dialogue) return true;
    if (this.screen === 'title' || this.screen === 'error') return true;
    return this.endingAnim();
  }

  endingAnim() {
    const g = this.game;
    return g.mode === 'ending' && !!g.ending && g.ending.phase !== 'text';
  }

  hudOpen(name) {
    if (this.game.mode !== 'playing' || this.game.paused) return;
    const top = this.top();
    if (top && top.name === name) return this.closeAll();
    this.openScreen(name);
  }

  // ---------- キー操作 ----------
  onAction(action, ev) {
    if (!this.ready) return false;
    if (!this.isCapturingInput()) return this.onGameKey(action);
    if (this.dialogue) return this.dialogueAction(action, ev);
    const top = this.top();
    if (!top) {
      if (this.endingAnim()) {
        if (action === 'confirm' || action === 'back') { safe(() => this.game.skipEndingAnim()); this.audio?.play?.('ui_confirm'); }
        return true;
      }
      const root = this.screen === 'error' ? $('error-screen') : $('title-menu');
      return this.navAction(action, ev, root);
    }
    switch (action) {
      case 'back': return this.handleBack();
      case 'pause': if (top.name === 'pause' || TAB_SCREENS.includes(top.name)) this.closeAll(); return true;
      case 'inventory': case 'craft': case 'map': case 'codex': return this.tabKey(action);
      case 'tabPrev': return this.cycleTab(-1);
      case 'tabNext': return this.cycleTab(1);
      case 'up': case 'down': case 'left': case 'right':
        if (top.name === 'map' && document.activeElement === $('map-viewport')) {
          const d = { up: [0, -4], down: [0, 4], left: [-4, 0], right: [4, 0] }[action];
          this.setMapCursor(this.mapCursor.x + d[0], this.mapCursor.y + d[1]);
          return true;
        }
        return this.moveFocus(action, this.modal);
      case 'confirm': return this.confirmKey(ev, this.modal);
      default: return false;
    }
  }

  onGameKey(action) {
    const g = this.game;
    if (g.mode !== 'playing') return false;
    if (action === 'pause') return this.openScreen('pause');
    if (TAB_SCREENS.includes(action)) return this.openScreen(action);
    return false;
  }

  navAction(action, ev, root) {
    switch (action) {
      case 'up': case 'down': case 'left': case 'right': return this.moveFocus(action, root);
      case 'confirm': return this.confirmKey(ev, root);
      case 'back': return true;
      default: return false;
    }
  }

  tabKey(action) {
    const top = this.top();
    if (!TAB_SCREENS.includes(top.name)) return true;
    if (top.name === action) this.closeAll(); else this.openScreen(action);
    return true;
  }

  cycleTab(dir) {
    const top = this.top();
    const i = TAB_SCREENS.indexOf(top.name);
    if (i < 0) return true;
    this.openScreen(TAB_SCREENS[(i + dir + TAB_SCREENS.length) % TAB_SCREENS.length]);
    this.audio?.play?.('ui_tab');
    return true;
  }

  // Enter / Space はブラウザ標準のクリックに任せる。J キーなど標準で押せないものだけ代行する
  confirmKey(ev, root) {
    const a = document.activeElement;
    const native = !!a && (a.tagName === 'BUTTON' || a.tagName === 'SUMMARY' || a.tagName === 'A' || (a.tagName === 'INPUT' && ['checkbox', 'radio'].includes(a.type)));
    const code = ev?.code;
    if (native && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space')) { this.audio?.play?.('ui_confirm'); return false; }
    if (native && root.contains(a)) { a.click(); this.audio?.play?.('ui_confirm'); return true; }
    this.focusFirst(root);
    return true;
  }

  handleBack() {
    const now = performance.now();
    if (now - this.lastBack < 60) return true; // keydown と cancel の二重処理を避ける
    this.lastBack = now;
    const top = this.top();
    if (!top) return true;
    this.audio?.play?.('ui_back');
    switch (top.name) {
      case 'confirm':
        if (!top.params.locked) this.popTop();
        return true;
      case 'end':
        if (top.params.kind === 'intro') this.finishIntro();
        else if (top.params.kind === 'ending-credits') this.popTop();
        return true;
      case 'inventory': case 'chest':
        if (this.lift) { this.lift = null; this.refreshItems(); return true; }
        this.closeAll();
        return true;
      case 'pause': case 'craft': case 'map': case 'codex':
        this.closeAll();
        return true;
      default:
        this.popTop();
        return true;
    }
  }

  focusables(root) {
    return [...root.querySelectorAll(FOCUSABLE)].filter(isShown);
  }

  focusFirst(root) {
    const t = this.focusables(root)[0];
    if (t) t.focus();
  }

  // 矢印キーで、見た目の位置が近い次のコントロールへ（ロービングフォーカス）
  moveFocus(dir, root) {
    const list = this.focusables(root);
    if (!list.length) return true;
    const cur = list.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) { list[0].focus(); return true; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const c of list) {
      if (c === cur) continue;
      const r = c.getBoundingClientRect();
      const dx = r.left + r.width / 2 - ax;
      const dy = r.top + r.height / 2 - ay;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 2) continue;
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best) { best.focus(); this.audio?.play?.('ui_move'); }
    return true;
  }

  // ---------- 通知 ----------
  speak(text) {
    const el = $('sr-live');
    if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = text; }, 30);
  }

  toast(text, kind = 'info', opts = {}) {
    if (!text) return null;
    const tone = { info: 'info', good: 'good', warn: 'warn', danger: 'danger', error: 'danger' }[kind] || 'info';
    const now = performance.now();
    const last = this.lastMsgAt.get(text);
    if (!opts.persist && last && now - last < 1200) return null; // 同じ文言の連続表示を避ける
    if (this.lastMsgAt.size > 200) this.lastMsgAt.clear();
    this.lastMsgAt.set(text, now);
    const hudShown = !$('hud').hidden;
    const actions = opts.actions || [];
    let el;
    if (hudShown) {
      el = h('div', { class: `toast${opts.banner ? ' is-banner' : ''}`, dataset: { tone, actions: actions.length ? 'true' : 'false' } });
      if (opts.title) el.append(h('p', { class: 'toast-title', text: opts.title }));
      el.append(h('p', { text }));
      $('toast-region').append(el);
      while ($('toast-region').children.length > 5) this.dismissToast($('toast-region').firstElementChild, true);
    } else {
      el = h('div', { class: 'notice is-temp', dataset: { tone: tone === 'info' || tone === 'good' ? 'info' : 'warn' }, role: 'status' },
        h('p', { class: 'notice-text', text: opts.title ? `${opts.title} ${text}` : text }));
      $('system-notices').append(el);
    }
    const entry = { el, t: opts.persist ? Infinity : (opts.duration ?? (tone === 'warn' || tone === 'danger' ? 5 : 3.2)), key: opts.key };
    for (const a of actions) {
      const b = h('button', { type: 'button', class: hudShown ? '' : 'btn btn--small', text: a.label, onclick: () => { this.dismissToast(el); safe(a.run); } });
      if (hudShown) { if (!el.querySelector('.toast-actions')) el.append(h('div', { class: 'toast-actions' })); el.querySelector('.toast-actions').append(b); } else el.append(b);
    }
    if (opts.persist) {
      const close = h('button', { type: 'button', class: hudShown ? 'toast-close' : 'btn btn--small', text: '閉じる', onclick: () => this.dismissToast(el) });
      if (hudShown) { if (!el.querySelector('.toast-actions')) el.append(h('div', { class: 'toast-actions' })); el.querySelector('.toast-actions').append(close); } else el.append(close);
      el.dataset.actions = 'true';
    }
    this.toasts.push(entry); // 読み上げは #toast-region（aria-live）と .notice（role=status）に任せる
    return el;
  }

  dismissToast(el, immediate = false) {
    if (!el || !el.isConnected) return;
    this.toasts = this.toasts.filter((t) => t.el !== el);
    if (immediate || this.root.dataset.reducedMotion === 'on') { el.remove(); return; }
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 320);
  }

  dismissToastKey(key) {
    for (const t of [...this.toasts]) if (t.key === key) this.dismissToast(t.el, true);
  }

  tickToasts(dt) {
    for (const t of [...this.toasts]) {
      if (!t.el.isConnected) { this.toasts = this.toasts.filter((x) => x !== t); continue; }
      t.t -= dt;
      if (t.t <= 0) this.dismissToast(t.el);
    }
  }

  onSaveResult(r) {
    if (r.ok) {
      this.saveFailToast && this.dismissToast(this.saveFailToast, true);
      this.saveFailToast = null;
      const ind = $('save-indicator');
      ind.textContent = r.durable === false ? '保存しました（この端末には残りません）' : '保存しました';
      ind.hidden = false;
      clearTimeout(this.saveIndTimer);
      this.saveIndTimer = setTimeout(() => { ind.hidden = true; }, 1600);
      return;
    }
    if (r.reason === 'readonly') return; // 読み取り専用画面が出る
    if (this.saveFailToast && this.saveFailToast.isConnected) return;
    this.saveFailToast = this.toast('保存できませんでした — 書き出しで退避してください', 'danger', {
      persist: true,
      actions: [{ label: '書き出し', run: () => this.exportCurrentFlow() }],
    });
  }

  // ---------- 確認ダイアログ ----------
  // actions: [{label, kind:'primary'|'danger', run}]。押すと先に閉じてから run を呼ぶ
  confirm({ title, en, lines = [], actions = [], cancelLabel = '戻る', kind, locked = false, onCancel, onDismiss, dim = [] }) {
    this.stack.push({ name: 'confirm', params: { ja: title, en: en || 'CONFIRM', lines, dim, actions, cancelLabel, kind, locked, onCancel, onDismiss }, opener: document.activeElement });
    this.renderTop(true);
  }

  renderConfirm() {
    const p = this.top().params;
    $('confirm-lines').replaceChildren(...p.lines.map((l) => h('p', { text: l })), ...(p.dim || []).map((l) => h('p', { class: 'dim', text: l })));
    const box = $('confirm-actions');
    box.replaceChildren();
    for (const a of p.actions) {
      box.append(h('button', {
        type: 'button', class: `btn${a.kind === 'primary' ? ' btn--primary' : a.kind === 'danger' ? ' btn--danger' : ''}`,
        dataset: a.kind === 'primary' ? { autofocus: 'true' } : {},
        onclick: () => { this.popTop(); safe(a.run, 'confirm'); },
        text: a.label,
      }));
    }
    if (!p.locked) {
      box.append(h('button', { type: 'button', class: 'btn', text: p.cancelLabel, onclick: () => { this.popTop(); if (p.onCancel) safe(p.onCancel); } }));
    }
    if (!p.actions.length && p.locked) box.hidden = true; else box.hidden = false;
  }

  // ---------- タイトル ----------
  showTitle() {
    this.closeAll();
    this.screen = 'title';
    this.dialogue = null;
    $('dialogue').hidden = true;
    this.root.dataset.dialogue = 'closed';
    $('loading-screen').hidden = true;
    $('error-screen').hidden = true;
    $('title-screen').hidden = false;
    $('hud').hidden = true;
    this.deadShown = false;
    this.endingShown = false;
    this.refreshTitle();
    this.applySettings();
    const t = $('btn-continue').disabled ? $('btn-new-game') : $('btn-continue');
    safe(() => t.focus({ preventScroll: true }));
  }

  pickContinueSlot(slots) {
    const last = this.app.getLastSlot();
    if (last && slots[last - 1]?.exists) return slots[last - 1];
    const existing = slots.filter((s) => s.exists && !s.corrupt);
    existing.sort((a, b) => String(b.summary?.savedAt || '').localeCompare(String(a.summary?.savedAt || '')));
    return existing[0] || slots.find((s) => s.exists) || null;
  }

  refreshTitle() {
    const slots = this.app.listSlots();
    const pick = this.pickContinueSlot(slots);
    const btn = $('btn-continue');
    btn.disabled = !pick;
    const sum = $('continue-summary');
    if (pick) {
      sum.hidden = false;
      sum.textContent = `スロット${pick.slot} — ${pick.corrupt ? 'データが壊れています' : this.slotSummaryText(pick)}`;
    } else sum.hidden = true;
  }

  slotSummaryText(info) {
    const s = info.summary;
    if (!s) return info.exists ? '内容を読み取れません' : '空き';
    const diff = this.data.DIFFICULTY?.[s.difficulty]?.name || '';
    return `${s.seed} ・ ${diff} ・ ${fmtPlay(s.playTime)} ・ 核 ${s.hearts}/3${s.coreRestored ? ' ・ 炉心再生' : ''}`;
  }

  continueLast() {
    const pick = this.pickContinueSlot(this.app.listSlots());
    if (pick) this.continueFromSlot(pick.slot);
  }

  continueFromSlot(slot, { takeover = false } = {}) {
    const r = this.app.continueSlot(slot, { takeover });
    if (r.ok) return this.afterStart('continue');
    if (r.locked) return this.askTakeover(slot, () => this.continueFromSlot(slot, { takeover: true }));
    return this.failLoad(slot, r);
  }

  askTakeover(slot, run) {
    this.confirm({
      title: 'このセーブは別のタブで開かれています', en: 'OPENED IN ANOTHER TAB', kind: 'lock',
      lines: [`スロット${slot}は、別のタブで使用中です。`],
      dim: ['引き継ぐと、もう一方のタブは閲覧のみになり、保存されなくなります。'],
      actions: [{ label: '引き継ぐ', kind: 'primary', run }],
      cancelLabel: '戻る',
    });
  }

  failLoad(slot, r) {
    const info = this.app.listSlots()[slot - 1];
    const actions = [];
    if (info?.hasBackup) actions.push({ label: 'バックアップから復元', kind: 'primary', run: () => this.restoreFromBackup(slot) });
    this.confirm({
      title: '読み込めませんでした', en: 'LOAD FAILED',
      lines: [r.error || 'データを読み込めませんでした。'],
      dim: [info?.hasBackup ? '直前の保存（バックアップ）から復元できます。壊れたデータは、復元に成功したときだけ置き換わります。' : 'このスロットを開けません。書き出したJSONがあれば、「記録の管理」から読み込めます。'],
      actions, cancelLabel: '戻る',
    });
  }

  restoreFromBackup(slot, takeover = false) {
    const r = this.app.loadBackup(slot, { takeover });
    if (r.ok) {
      this.afterStart('continue');
      this.toast(r.saved ? 'バックアップから復元しました' : 'バックアップから復元しました（保存し直せませんでした）', r.saved ? 'good' : 'warn');
      return;
    }
    if (r.locked) return this.askTakeover(slot, () => this.restoreFromBackup(slot, true));
    this.confirm({ title: '復元できませんでした', en: 'RESTORE FAILED', lines: [r.error || 'バックアップを読み込めませんでした。'], actions: [], cancelLabel: '戻る' });
  }

  afterStart(kind) {
    this.closeAll();
    this.screen = 'play';
    $('title-screen').hidden = true;
    this.deadShown = false;
    this.endingShown = false;
    this.deadT = 0;
    this.sel = null;
    this.lift = null;
    this.lastSeq = this.game.eventSeq || 0;
    this.worldId = this.game.worldId;
    this.applySettings();
    if (kind === 'new') this.showScreen('intro');
    else this.toast('続きから再開しました', 'good');
    this.followMode(0);
  }

  // ---------- 新しい旅 ----------
  renderNewGame() {
    const slots = this.app.listSlots();
    const sel = $('newgame-slot');
    const want = Number(this.top().params.slot) || Number(sel.value) || (slots.find((s) => !s.exists) || slots[0]).slot;
    sel.replaceChildren(...slots.map((s) => h('option', {
      value: s.slot,
      text: `スロット${s.slot} — ${s.corrupt ? '壊れたデータ（上書き）' : s.exists ? `${this.slotSummaryText(s)}（上書き）` : '空き'}`,
    })));
    sel.value = String(want);
    if (!$('newgame-seed').value) $('newgame-seed').value = this.app.randomSeed();
    $('newgame-difficulty').value = this.app.settings.difficulty || 'standard';
    this.updateOverwriteWarning();
  }

  updateOverwriteWarning() {
    const info = this.app.listSlots()[Number($('newgame-slot').value) - 1];
    $('newgame-overwrite-warning').hidden = !(info && (info.exists || info.corrupt));
  }

  submitNewGame() {
    const slot = Number($('newgame-slot').value);
    const seed = this.app.sanitizeSeed($('newgame-seed').value) || this.app.randomSeed();
    const difficulty = $('newgame-difficulty').value;
    const info = this.app.listSlots()[slot - 1];
    const go = (takeover = false) => this.game.mode==='title'?this.startNew(slot, seed, difficulty, takeover):this.withCurrentSaved(()=>this.startNew(slot,seed,difficulty,takeover));
    if (info && (info.exists || info.corrupt)) {
      this.confirm({
        title: 'この記録を上書きしますか？', en: 'OVERWRITE',
        lines: [`スロット${slot}の「${info.corrupt ? '壊れたデータ' : this.slotSummaryText(info)}」は、新しい旅で上書きされます。`],
        dim: info.hasBackup || info.exists ? ['直前の記録は、バックアップとして一度だけ残ります。'] : [],
        actions: [{ label: '上書きして始める', kind: 'danger', run: () => go() }],
        cancelLabel: 'やめる',
      });
    } else go();
  }

  startNew(slot, seed, difficulty, takeover) {
    const r = this.app.newGame(slot, { seed, difficulty, takeover });
    if (r.ok) {
      this.afterStart('new');
      if (r.saved === false) this.toast(`最初の保存に失敗しました：${r.saveError || ''}`, 'warn', { persist: true });
      return;
    }
    if (r.locked) return this.askTakeover(slot, () => this.startNew(slot, seed, difficulty, true));
    this.confirm({ title: '始められませんでした', en: 'START FAILED', lines: [r.error || '新しい旅を始められませんでした。'], actions: [], cancelLabel: '戻る' });
  }

  // ---------- 導入・死亡・エンディング ----------
  endMeta(p) {
    if (p.kind === 'dead') return { ja: '灯が消えた', en: 'YOUR LIGHT FADED' };
    if (p.kind === 'ending' || p.kind === 'ending-credits') return { ja: '炉心、ふたたび', en: 'THE HEARTH REBORN' };
    return { ja: 'はじまり', en: 'PROLOGUE' };
  }

  renderEnd() {
    const p = this.top().params;
    const text = $('end-text');
    const stats = $('end-stats');
    const rec = $('end-recovery');
    text.replaceChildren();
    stats.replaceChildren();
    rec.textContent = '';
    const b1 = $('btn-end-primary');
    const b2 = $('btn-end-secondary');
    b2.hidden = false;
    if (p.kind === 'intro') {
      const intro = this.data.INTRO || [];
      const line = intro[p.index] || intro[0] || { ja: '', en: '' };
      text.append(h('span', { class: 'end-ja', text: line.ja }), h('span', { class: 'end-en', lang: 'en', text: line.en }));
      rec.textContent = `${p.index + 1} / ${intro.length}`;
      b1.textContent = p.index + 1 >= intro.length ? '旅を始める' : '次へ';
      b2.textContent = 'スキップ';
    } else if (p.kind === 'dead') {
      const g = this.game;
      text.append(h('span', { class: 'end-ja', text: 'あなたの灯は、ここで消えた。' }), h('span', { class: 'end-en', lang: 'en', text: 'Your light has gone out here.' }));
      const sat = (safe(() => g.getMapData().markers) || []).find((m) => m.kind === 'satchel');
      rec.textContent = sat
        ? `遺灰袋が (${Math.floor(sat.x)}, ${Math.floor(sat.y)}) に残っています。バッグの中身はそこで回収できます。地図に印が出ます。`
        : 'バッグの中身は遺灰袋として残ります。ホットバーと防具は手元にあります。';
      const cause = this.lastDeath?.cause;
      if (cause && typeof cause === 'string') stats.append(h('div', null, h('dt', { text: '倒れた原因' }), h('dd', { text: this.data.ENEMIES?.[cause]?.name || cause })));
      stats.append(h('div', null, h('dt', { text: '倒れた回数' }), h('dd', { text: String(g.stats?.deaths ?? 0) })));
      b1.textContent = '灯をともし直す';
      b2.textContent = 'タイトルへ戻る';
    } else {
      const lines = this.data.ENDING_TEXT || [];
      text.append(...lines.flatMap((l) => [h('span', { class: 'end-ja', text: l.ja }), h('span', { class: 'end-en', lang: 'en', text: l.en })]));
      const st = safe(() => this.game.getEndingStats()) || {};
      const rows = [['プレイ時間', fmtPlay(st.playTime)], ['倒れた回数', st.deaths ?? 0], ['作った物', st.crafted ?? 0], ['掘った壁', st.mined ?? 0], ['釣った魚', st.fish ?? 0],
        ['難易度', this.data.DIFFICULTY?.[st.difficulty]?.name || st.difficulty || '']];
      for (const [k, v] of rows) stats.append(h('div', null, h('dt', { text: k }), h('dd', { text: String(v) })));
      rec.textContent = 'ここから先は、あなたの庭です。金縁の建材と炉心の模型が使えるようになりました。';
      b1.textContent = 'クレジットへ';
      b2.textContent = '自由建築をはじめる';
    }
  }

  endPrimary() {
    const top = this.top();
    if (!top || top.name !== 'end') return;
    const p = top.params;
    if (p.kind === 'intro') {
      const len = (this.data.INTRO || []).length;
      if (p.index + 1 >= len) this.finishIntro(); else { p.index += 1; this.renderEnd(); this.focusPanel(); }
    } else if (p.kind === 'dead') {
      safe(() => this.game.respawn());
      this.deadShown = true;
      this.closeAll();
      this.toast('灯をともし直した', 'good');
    } else {
      this.openScreen('credits', { fromEnding: true });
    }
  }

  endSecondary() {
    const top = this.top();
    if (!top || top.name !== 'end') return;
    const kind = top.params.kind;
    if (kind === 'intro') this.finishIntro();
    else if (kind === 'dead') this.quitFlow(true);
    else this.finishEnding();
  }

  finishIntro() {
    this.closeAll();
    const hint = this.data.HINTS?.move;
    if (hint) this.toast(hint, 'info', { duration: 7 });
  }

  finishEnding() {
    safe(() => this.game.finishEnding());
    this.closeAll();
    this.endingShown = true;
    this.toast('深庭はあなたの庭になった。自由に築こう。', 'good');
    this.app.autosaveNow();
  }

  renderCredits() {
    const p = this.top().params;
    $('credits-actions').hidden = !p.fromEnding;
    setText($('credits-version'), `EMBERVEIL v${this.data.VERSION || ''}`);
  }

  // ---------- ポーズ ----------
  renderPause() {
    const g = this.game;
    const c = safe(() => g.canSave()) || { ok: false, reason: 'title' };
    $('btn-pause-save').disabled = !c.ok;
    $('btn-pause-export').disabled = !g.world;
    $('btn-pause-return').disabled = g.mode !== 'playing' || !!g.channel;
    setText($('pause-status'), c.ok ? '' : `${SAVE_REASON_JA[c.reason] || 'いまは保存できません'}。`);
  }

  manualSave() {
    const r = this.app.saveNow({ auto: false });
    this.audio?.play?.(r.ok ? 'save' : 'error');
    this.renderPause();
    setText($('pause-status'), r.ok ? (r.durable === false ? '保存しました（この端末のブラウザには残りません。書き出しで退避してください）' : '保存しました') : `${r.error}`);
  }

  doReturn() {
    const r = safe(() => this.game.startReturn()) || { ok: false, reason: '帰還を始められません' };
    if (r.ok) {
      this.closeAll();
      this.toast('灯へ帰る… 動くと中断されます', 'info');
    } else setText($('pause-status'), this.reasonText(r.reason));
  }

  quitFlow(fromDead = false) {
    const g = this.game;
    const c = safe(() => g.canSave()) || { ok: false, reason: 'title' };
    const quit = (save) => { this.app.quitToTitle({ save }); this.showTitle(); };
    if (c.ok) {
      const r = this.app.saveNow({ auto: false });
      if (r.ok&&r.durable!==false) return quit(false);
      this.confirm({
        title: '保存できませんでした', en: 'SAVE FAILED', lines: [r.error || '保存に失敗しました。'],
        dim: ['このまま戻ると、直近の保存から再開になります。先に書き出しで退避できます。'],
        actions: [{ label: '書き出す', kind: 'primary', run: () => this.exportCurrentFlow() }, { label: '保存せず戻る', kind: 'danger', run: () => quit(false) }],
        cancelLabel: 'やめる',
      });
      return;
    }
    this.confirm({
      title: 'タイトルへ戻りますか？', en: 'RETURN TO TITLE',
      lines: [fromDead ? '倒れた状態は保存されません。直近の保存から再開できます。' : `${SAVE_REASON_JA[c.reason] || 'いまは保存できません'}。このまま戻ると、直近の保存から再開になります。`],
      actions: [{ label: 'タイトルへ戻る', kind: 'danger', run: () => quit(false) }],
      cancelLabel: 'やめる',
    });
  }

  reasonText(r) {
    if (!r) return '操作できません';
    return REASON_JA[r] || String(r);
  }

  // ---------- 記録の管理・JSON ----------
  renderSaves() {
    const slots = this.app.listSlots();
    const tpl = $('tpl-save-slot');
    const list = $('save-slots');
    list.replaceChildren(...slots.map((s) => {
      const li = tpl.content.firstElementChild.cloneNode(true);
      li.dataset.slot = String(s.slot);
      li.dataset.current = String(!!s.current);
      li.querySelector('.save-slot-name').textContent = `スロット${s.slot}${s.current ? '（プレイ中）' : ''}`;
      li.querySelector('.save-slot-meta').textContent = s.corrupt ? `データが壊れています${s.hasBackup ? '（バックアップあり）' : ''}`
        : s.exists ? `${this.slotSummaryText(s)}${s.summary?.savedAt ? ` ・ ${fmtDate(s.summary.savedAt)}` : ''}` : '空き';
      li.querySelector('[data-action="load"]').disabled = !s.exists || (s.corrupt && !s.hasBackup);
      li.querySelector('[data-action="load"]').textContent = s.corrupt ? '復元する' : '読み込む';
      li.querySelector('[data-action="load"]').dataset.action = s.corrupt ? 'backup' : 'load';
      li.querySelector('[data-action="delete"]').disabled = !(s.exists || s.hasBackup) || s.current;
      const acts = li.querySelector('.save-slot-actions');
      if (!s.exists) acts.prepend(h('button', { type: 'button', class: 'btn btn--small', dataset: { action: 'new' }, text: 'ここで始める' }));
      if (s.exists && !s.corrupt) acts.prepend(h('button', { type: 'button', class: 'btn btn--small', dataset: { action: 'export' }, text: '書き出し' }));
      if (s.exists && !s.corrupt && s.hasBackup) acts.prepend(h('button', { type: 'button', class: 'btn btn--small', dataset: { action: 'backup' }, text: 'バックアップ復元' }));
      return li;
    }));
    $('btn-export-json').hidden = this.game.mode === 'title';
    setText($('save-message'), this.app.storageAvailable ? '' : 'この環境では保存できません。記録はこのタブを閉じると失われます。「書き出し」で進行を退避してください。');
  }

  onSlotClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const slot = Number(btn.closest('.save-slot').dataset.slot);
    const act = btn.dataset.action;
    if (act === 'load') this.loadFromList(slot);
    else if (act === 'backup') this.backupFromList(slot);
    else if (act === 'new') this.openScreen('newgame', { slot });
    else if (act === 'export') this.exportSlotFlow(slot);
    else if (act === 'delete') this.deleteFlow(slot);
  }

  // プレイ中に別スロットへ移るときは、いまの進行を保存してから読み込む
  withCurrentSaved(then) {
    const g = this.game;
    if (g.mode === 'title') return then();
    const c = safe(() => g.canSave());
    this.confirm({
      title: 'いまのプレイを離れますか？', en: 'LEAVE THIS RUN',
      lines: [c && c.ok ? 'いまの進行を保存してから、別の記録を開きます。' : `${SAVE_REASON_JA[c?.reason] || 'いまは保存できません'}。いまの進行は保存されず、直近の保存から再開になります。`],
      actions: [{ label: '開く', kind: 'primary', run: () => {
        if(c&&c.ok){
          const r=this.app.saveNow({auto:true});
          if(!r.ok||r.durable===false){
            this.confirm({title:'進行を退避してください',en:'KEEP YOUR PROGRESS',
              lines:[r.error||'ブラウザに記録を残せませんでした。'],dim:['書き出しで退避してから、別の記録へ移れます。'],
              actions:[{label:'書き出す',kind:'primary',run:()=>this.exportCurrentFlow()},{label:'保存せず開く',kind:'danger',run:then}],cancelLabel:'やめる'});
            return;
          }
        }
        then();
      } }],
      cancelLabel: 'やめる',
    });
  }

  loadFromList(slot) {
    const go = () => this.continueFromSlot(slot);
    if (this.game.mode !== 'title') this.withCurrentSaved(go); else go();
  }

  backupFromList(slot) {
    this.confirm({
      title: 'バックアップから復元しますか？', en: 'RESTORE BACKUP',
      lines: [`スロット${slot}の内容は、直前のバックアップで置き換わります。`],
      actions: [{ label: '復元する', kind: 'danger', run: () => (this.game.mode === 'title'||this.game.slot===slot ? this.restoreFromBackup(slot) : this.withCurrentSaved(() => this.restoreFromBackup(slot))) }],
      cancelLabel: 'やめる',
    });
  }

  deleteFlow(slot) {
    this.confirm({
      title: 'この記録を消しますか？', en: 'DELETE',
      lines: [`スロット${slot}の記録とバックアップが消えます。元に戻せません。`],
      actions: [{
        label: '消す', kind: 'danger',
        run: () => {
          const r = this.app.deleteSlot(slot);
          this.renderSaves();
          setText($('save-message'), r.ok ? `スロット${slot}を消しました` : r.error || '消せませんでした');
          if (this.screen === 'title') this.refreshTitle();
        },
      }],
      cancelLabel: 'やめる',
    });
  }

  exportCurrentFlow() {
    const text = this.app.exportCurrent();
    if (!text) { this.toast('書き出せるデータがありません', 'warn'); return; }
    this.openScreen('export', { text, filename: this.app.exportFileName(this.game.slot), label: `スロット${this.game.slot || '-'}（いまのプレイ）`, force: true });
  }

  exportSlotFlow(slot) {
    const text = this.app.exportSlot(slot);
    if (!text) { setText($('save-message'), `スロット${slot}は書き出せません`); return; }
    this.openScreen('export', { text, filename: this.app.exportFileName(slot), label: `スロット${slot}（保存済み）`, force: true });
  }

  renderExport() {
    const p = this.top().params;
    $('export-text').value = p.text || '';
    setText($('export-info'), `${p.label} — ${(Math.round(((p.text || '').length / 1024) * 10) / 10).toLocaleString()} KB。ファイルに保存するか、全選択してコピーしてください。`);
    setText($('export-message'), '');
  }

  exportDownload() {
    const p = this.top().params;
    const ok = this.app.downloadText(p.text, p.filename);
    setText($('export-message'), ok ? `${p.filename} を保存しました（ブラウザのダウンロード先を確認してください）` : 'ダウンロードを開始できませんでした。全選択してコピーしてください。');
  }

  async exportCopy() {
    const ta = $('export-text');
    let ok = false;
    try { await navigator.clipboard.writeText(ta.value); ok = true; } catch {
      ta.focus(); ta.select();
      ok = !!safe(() => document.execCommand('copy'));
    }
    setText($('export-message'), ok ? 'クリップボードにコピーしました' : 'コピーできませんでした。全選択して手動でコピーしてください。');
  }

  renderImport() {
    const slots = this.app.listSlots();
    const sel = $('import-slot');
    const prev = sel.value;
    sel.replaceChildren(...slots.map((s) => h('option', { value: s.slot, text: `スロット${s.slot} — ${s.corrupt ? '壊れたデータ' : s.exists ? this.slotSummaryText(s) : '空き'}` })));
    sel.value = prev || String((slots.find((s) => !s.exists) || slots[0]).slot);
    sel.onchange = () => this.updateImportWarning();
    this.updateImportWarning();
  }

  updateImportWarning() {
    const s = this.app.listSlots()[Number($('import-slot').value) - 1];
    setText($('import-overwrite'), s && (s.exists || s.corrupt) ? `スロット${s.slot}の記録は上書きされます（直前の記録はバックアップに残ります）。${s.current ? 'プレイ中のスロットなので、読み込み後すぐにこの内容で再開します。' : ''}` : '');
  }

  invalidateImport() {
    $('import-preview').hidden = true;
    $('import-slot-field').hidden = true;
    $('btn-import-apply').disabled = true;
    setText($('import-message'), '');
  }

  async onImportFile() {
    const f = $('import-file').files?.[0];
    $('import-file').value = '';
    if (!f) return;
    if (f.size > 3000000) { setText($('import-message'), 'ファイルが大きすぎます（3MBまで）'); return; }
    try {
      $('import-text').value = await f.text();
      this.checkImport();
    } catch { setText($('import-message'), 'ファイルを読み込めませんでした'); }
  }

  checkImport() {
    const r = this.app.previewImport($('import-text').value);
    if (!r.ok) {
      this.invalidateImport();
      setText($('import-message'), r.error);
      this.audio?.play?.('error');
      return;
    }
    const s = r.summary;
    $('import-summary').replaceChildren(...[
      ['シード', s.seed], ['難易度', this.data.DIFFICULTY?.[s.difficulty]?.name || s.difficulty], ['プレイ時間', fmtPlay(s.playTime)],
      ['集めた核', `${s.hearts} / 3`], ['炉心', s.coreRestored ? '再生済み' : 'まだ'], ['保存日時', fmtDate(s.savedAt) || '不明'],
    ].map(([k, v]) => h('div', null, h('dt', { text: k }), h('dd', { text: String(v) }))));
    $('import-preview').hidden = false;
    $('import-slot-field').hidden = false;
    $('btn-import-apply').disabled = false;
    setText($('import-message'), '検証に成功しました。書き込み先を選んでください。');
    this.updateImportWarning();
  }

  applyImport() {
    const slot = Number($('import-slot').value);
    const info = this.app.listSlots()[slot - 1];
    const text = $('import-text').value;
    const go = () => {
      const r = this.app.importText(text, slot);
      if (!r.ok) { setText($('import-message'), r.error); this.audio?.play?.('error'); return; }
      this.audio?.play?.('save');
      if (r.replacedCurrent) { this.afterStart('continue'); this.toast('読み込んだ内容で再開しました', 'good'); return; }
      setText($('import-message'), `スロット${slot}に書き込みました`);
      this.invalidateImport();
      $('import-text').value = '';
      if (this.screen === 'title') this.refreshTitle();
    };
    if (info && (info.exists || info.corrupt)) {
      this.confirm({
        title: 'この記録を上書きしますか？', en: 'OVERWRITE',
        lines: [`スロット${slot}の「${info.corrupt ? '壊れたデータ' : this.slotSummaryText(info)}」を、読み込んだ内容で上書きします。`],
        dim: ['直前の記録は、バックアップとして一度だけ残ります。'],
        actions: [{ label: '上書きする', kind: 'danger', run: go }],
        cancelLabel: 'やめる',
      });
    } else go();
  }

  // ---------- 別タブ ----------
  openReadonly() {
    if (this.hasKind('readonly')) return;
    this.confirm({
      title: '別のタブで再開されました', en: 'OPENED ELSEWHERE', kind: 'readonly', locked: true,
      lines: ['このタブでは保存されません。'],
      dim: ['別のタブの進行を守るため、このタブは閲覧のみになりました。このタブで続けるときは、別のタブの最新の保存を読み込み直します。'],
      actions: [{ label: 'このタブで操作する', kind: 'primary', run: () => this.requestTakeControl(true) }, { label: 'タイトルへ', run: () => { this.app.quitToTitle({ save: false }); this.showTitle(); } }],
    });
  }

  requestTakeControl(confirmed = false) {
    const slot = this.game.slot;
    if (!slot) return;
    if (!confirmed) {
      this.confirm({
        title: 'このタブで操作しますか？', en: 'TAKE CONTROL',
        lines: ['別のタブの最新の保存を読み込み直して再開します。このタブで保存していない進行は失われます。'],
        actions: [{ label: '操作する', kind: 'primary', run: () => this.requestTakeControl(true) }],
        cancelLabel: 'やめる',
      });
      return;
    }
    const r = this.app.takeControl();
    if (r.ok) { this.afterStart('continue'); return; }
    this.toast(r.error || '引き継げませんでした', 'warn');
  }

  // ---------- 持ち物 ----------
  itemDef(k) { return this.data.ITEMS?.[k] || null; }
  itemName(k) { return this.itemDef(k)?.name || k; }
  itemColor(k) { return this.itemDef(k)?.mapColor || '#5a6b66'; }

  iconUrl(k) {
    if (this.iconCache.has(k)) return this.iconCache.get(k);
    const u = safe(() => this.renderer?.getItemIconURL?.(k)) || null;
    this.iconCache.set(k, u);
    return u;
  }

  glyph(k, cls = '') {
    return h('span', { class: `ui-glyph ${cls}`.trim(), 'aria-hidden': 'true', style: `--gc:${this.itemColor(k)}`, text: Array.from(this.itemName(k))[0] || '？' });
  }

  slotAt(ref) {
    const p = this.game.player;
    if (!ref) return null;
    if (ref.box === 'inv') return p?.inventory?.[ref.i] || null;
    if (ref.box === 'armor') return p?.armor ? { id: p.armor, n: 1 } : null;
    if (ref.box === 'chest') {
      const o = this.game.world?.objects?.get(this.game.openContainer);
      return o?.items?.[ref.i] || null;
    }
    return null;
  }

  paintCell(cell, slot, label) {
    const key = slot ? `${slot.id}:${slot.n}` : '';
    if (cell._k !== key) {
      cell._k = key;
      const img = cell.querySelector('.slot-icon');
      const cnt = cell.querySelector('.slot-count');
      let g = cell.querySelector('.ui-glyph');
      if (!slot) {
        if (img) { img.hidden = true; img.removeAttribute('src'); }
        if (g) g.hidden = true;
        if (cnt) cnt.hidden = true;
      } else {
        const url = this.iconUrl(slot.id);
        if (url && img) { img.src = url; img.hidden = false; if (g) g.hidden = true; } else {
          if (img) img.hidden = true;
          if (!g) { g = h('span', { class: 'ui-glyph', 'aria-hidden': 'true' }); cell.insertBefore(g, cnt || null); }
          g.hidden = false;
          g.style.setProperty('--gc', this.itemColor(slot.id));
          g.textContent = Array.from(this.itemName(slot.id))[0] || '？';
        }
        if (cnt) { cnt.hidden = !(slot.n > 1); cnt.textContent = String(slot.n); }
      }
    }
    if (label !== undefined && cell._l !== label) { cell._l = label; cell.setAttribute('aria-label', label); }
  }

  cellLabel(slot, base) {
    return slot ? `${base}：${this.itemName(slot.id)} ×${slot.n}` : `${base}：空`;
  }

  // グリッドのセルを必要数そろえる
  ensureCells(grid, count, mk) {
    grid.dataset.cols = '8';
    while (grid.children.length < count) {
      const i = grid.children.length;
      const c = $('tpl-item-cell').content.firstElementChild.cloneNode(true);
      mk(c, i);
      grid.append(c);
    }
  }

  refreshItems() {
    const top = this.top();
    if (top?.name === 'inventory') this.renderInventory();
    else if (top?.name === 'chest') this.renderChest();
  }

  paintGridCell(c, ref, slot, base) {
    this.paintCell(c, slot, this.cellLabel(slot, base));
    c.setAttribute('aria-selected', String(sameRef(this.sel, ref)));
    c.dataset.lifted = String(sameRef(this.lift, ref));
    c.dataset.empty = String(!slot);
  }

  renderInventory() {
    const p = this.game.player;
    if (!p) return;
    const grid = $('inventory-grid');
    this.ensureCells(grid, 32, (c, i) => { c._ref = { box: 'inv', i }; if (i < 8) { c.dataset.hot = 'true'; c.append(h('span', { class: 'slot-tag', 'aria-hidden': 'true', text: String(i + 1) })); } });
    if (!this.sel || (this.sel.box === 'chest')) this.sel = { box: 'inv', i: p.selected || 0 };
    for (let i = 0; i < 32; i++) {
      const c = grid.children[i];
      this.paintGridCell(c, c._ref, p.inventory[i] || null, i < 8 ? `ホットバー${i + 1}` : `バッグ${i - 7}`);
    }
    const used = p.inventory.filter(Boolean).length;
    setText($('inventory-capacity'), `${used} / 32`);
    // 装備欄
    const eq = $('equipment-slots');
    if (!eq._cell) {
      eq._cell = $('tpl-item-cell').content.firstElementChild.cloneNode(true);
      eq._cell._ref = { box: 'armor' };
      eq._cell.append(h('span', { class: 'slot-tag', 'aria-hidden': 'true', text: '防具' }));
      eq._stats = h('dl', { class: 'detail-stats', id: 'equipment-stats' });
      eq.append(eq._cell, eq._stats);
    }
    const arm = p.armor ? { id: p.armor, n: 1 } : null;
    this.paintGridCell(eq._cell, eq._cell._ref, arm, '防具');
    this.renderEquipmentStats(eq._stats);
    this.renderItemDetail();
  }

  // 実際に使う道具と装備の能力をエンジンから取得する。
  renderEquipmentStats(dl) {
    const {attack:atk,miningTier:tier,chopPower:chop,defense:def,heat}=this.game.getEquipmentStats();
    const rows = [['攻撃', atk], ['防御', def], ['採掘ティア', tier ? `${TIER_JA[tier] || tier}（${tier}）` : '素手（0）'], ['伐採力', chop], ['耐熱', heat ? 'あり' : 'なし']];
    const sig = rows.map((r) => r[1]).join('|');
    if (dl._sig === sig) return;
    dl._sig = sig;
    dl.replaceChildren(...rows.map(([k, v]) => h('div', null, h('dt', { text: k }), h('dd', { text: String(v) }))));
  }

  statRows(key) {
    const d = this.itemDef(key);
    const rows = [];
    if (!d) return rows;
    rows.push(['種類', TYPE_JA[d.type] || d.type]);
    if (d.weapon) {
      rows.push(['攻撃', d.weapon.atk], ['振り', `${d.weapon.swing}秒`], ['射程', `${d.weapon.range}マス`], ['スタミナ', d.weapon.stamina]);
      if (d.weapon.pierce) rows.push(['防御貫通', d.weapon.pierce]);
      if (d.weapon.burn) rows.push(['特殊', '燃焼']);
    }
    if (d.tool) rows.push([d.type === 'pick' ? '採掘ティア' : '伐採ティア', `${TIER_JA[d.tool.tier] || d.tool.tier}（${d.tool.tier}）`], ['威力', d.tool.power]);
    if (d.armor) {
      rows.push(['防御', d.armor.def]);
      if (d.armor.heat) rows.push(['特性', d.armor.burnImmune ? '耐熱・燃焼無効' : '耐熱']);
    }
    if (d.food) {
      if (d.food.full) rows.push(['効果', '空腹・体力が全回復']);
      else { if (d.food.hunger) rows.push(['空腹', `+${d.food.hunger}`]); if (d.food.hp) rows.push(['体力', `+${d.food.hp}`]); }
      const buffs = [...(d.food.buff ? [d.food.buff] : []), ...(d.food.buffs || [])];
      for (const b of buffs) rows.push([this.data.BUFFS?.[b.id]?.name || b.id, `${b.t}秒`]);
    }
    if (d.stack > 1) rows.push(['スタック上限', d.stack]);
    return rows;
  }

  renderItemDetail() {
    const slot = this.slotAt(this.sel);
    const d = slot && this.itemDef(slot.id);
    const name = $('inventory-detail-name');
    name.replaceChildren(...(slot ? [this.itemName(slot.id), h('span', { class: 'detail-en', lang: 'en', text: d?.en || '' })] : [this.sel && this.sel.box === 'armor' ? '防具は装備していません' : '空きスロット']));
    if (!this.sel) name.textContent = 'アイテムを選んでください';
    setText($('inventory-detail-text'), slot ? (d?.desc || '') : (this.lift ? '移動先を選んでください' : '選んで、もう一度別の場所を選ぶと移せます。'));
    $('inventory-detail-stats').replaceChildren(...(slot ? [['所持数', slot.n], ...this.statRows(slot.id)] : []).map(([k, v]) => h('div', null, h('dt', { text: k }), h('dd', { text: String(v) }))));
    const use = $('btn-item-use');
    const eq = $('btn-item-equip');
    const asg = $('btn-item-assign');
    const inv = this.sel?.box === 'inv';
    use.disabled = !(slot && d && d.food);
    use.textContent = d?.type === 'potion' ? '使う' : '食べる';
    eq.disabled = !(slot && (this.sel.box === 'armor' || d?.type === 'armor'));
    eq.textContent = this.sel?.box === 'armor' ? '外す' : '装備する';
    asg.disabled = !(slot && inv);
    asg.textContent = inv && this.sel.i < 8 ? '手に持つ' : 'ホットバーへ';
    $('btn-item-split').disabled = !(slot && slot.n > 1);
    $('btn-item-drop').disabled = !slot;
  }

  onCellClick(ref) {
    const slot = this.slotAt(ref);
    const msg = this.top()?.name === 'chest' ? 'chest-message' : 'inventory-message';
    setText($(msg), '');
    if (this.lift) {
      if (sameRef(this.lift, ref)) this.lift = null;
      else {
        const from = this.lift;
        this.lift = null;
        const r = safe(() => this.game.moveItem(from, ref)) || { ok: false };
        if (r.ok) { this.sel = ref; this.audio?.play?.('ui_confirm'); } else { setText($(msg), this.reasonText(r.reason)); this.audio?.play?.('ui_error'); this.sel = ref; }
      }
    } else {
      this.sel = ref;
      if (slot) this.lift = ref;
    }
    this.refreshItems();
  }

  itemUse() {
    const r = safe(() => this.game.useItem(this.sel)) || { ok: false };
    setText($('inventory-message'), r.ok ? '使いました' : this.reasonText(r.reason));
    this.lift = null;
    this.refreshItems();
  }

  itemEquip() {
    const wasArmor = this.sel?.box === 'armor';
    const r = (wasArmor ? safe(() => this.game.unequipArmor()) : safe(() => this.game.useItem(this.sel))) || { ok: false };
    if (r.ok) this.sel = wasArmor ? null : { box: 'armor' };
    setText($('inventory-message'), r.ok ? (wasArmor ? '防具を外しました' : '防具を装備しました') : this.reasonText(r.reason));
    this.lift = null;
    this.refreshItems();
  }

  itemAssign() {
    const p = this.game.player;
    if (!this.sel || this.sel.box !== 'inv') return;
    if (this.sel.i < 8) { safe(() => this.game.selectHotbar(this.sel.i)); setText($('inventory-message'), 'ホットバーで選びました'); return; }
    let to = p.inventory.slice(0, 8).findIndex((s) => !s);
    if (to < 0) to = p.selected || 0; // 空きがなければ、選択中のスロットと入れ替える
    const r = safe(() => this.game.moveItem(this.sel, { box: 'inv', i: to })) || { ok: false };
    if (r.ok) this.sel = { box: 'inv', i: to };
    setText($('inventory-message'), r.ok ? `ホットバー${to + 1}へ移しました` : this.reasonText(r.reason));
    this.lift = null;
    this.refreshItems();
  }

  itemSplit(msgId) {
    const r = safe(() => this.game.splitStack(this.sel)) || { ok: false };
    setText($(msgId), r.ok ? '半分に分けました（空きスロットに入ります）' : this.reasonText(r.reason || '分けられません（空きがないか、1個だけです）'));
    this.lift = null;
    this.refreshItems();
  }

  itemDrop() {
    const slot = this.slotAt(this.sel);
    if (!slot) return;
    const r = safe(() => this.game.dropStack(this.sel)) || { ok: false };
    setText($('inventory-message'), r.ok ? `${this.itemName(slot.id)}を足元に捨てました` : this.reasonText(r.reason));
    this.lift = null;
    this.refreshItems();
  }

  // ---------- 収納箱 ----------
  renderChest() {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    if (g.openContainer == null) return;
    const cg = $('chest-grid');
    const pg = $('chest-player-grid');
    this.ensureCells(cg, 16, (c, i) => { c._ref = { box: 'chest', i }; });
    this.ensureCells(pg, 32, (c, i) => { c._ref = { box: 'inv', i }; if (i < 8) c.dataset.hot = 'true'; });
    if (!this.sel) this.sel = { box: 'inv', i: p.selected || 0 };
    const o = g.world?.objects?.get(g.openContainer);
    const items = o?.items || [];
    for (let i = 0; i < 16; i++) this.paintGridCell(cg.children[i], cg.children[i]._ref, items[i] || null, `箱${i + 1}`);
    for (let i = 0; i < 32; i++) this.paintGridCell(pg.children[i], pg.children[i]._ref, p.inventory[i] || null, i < 8 ? `ホットバー${i + 1}` : `バッグ${i - 7}`);
    setText($('chest-capacity'), `${items.filter(Boolean).length} / 16`);
    const slot = this.slotAt(this.sel);
    $('btn-chest-move').disabled = !slot || this.sel?.box === 'armor';
    $('btn-chest-split').disabled = !(slot && slot.n > 1);
  }

  chestMove() {
    const r = safe(() => this.game.transferStack(this.sel)) || { ok: false };
    setText($('chest-message'), r.ok ? '移しました' : this.reasonText(r.reason || '移せません（空きがありません）'));
    this.lift = null;
    this.refreshItems();
  }

  chestBulk(method, okText) {
    const r = safe(() => this.game[method]()) || { ok: false, moved: 0 };
    setText($('chest-message'), r.moved > 0 ? `${okText}（${r.moved}個）` : '移せる物がありませんでした（空きがないか、対象がありません）');
    this.lift = null;
    this.refreshItems();
  }

  // ---------- 作る ----------
  renderCraft(force = false) {
    const g = this.game;
    const views = safe(() => g.getRecipeView()) || [];
    const near = safe(() => g.stationsNear()) || new Set();
    const stations = this.data.STATIONS || [];
    const nameOf = (id) => stations.find((s) => s.id === id)?.name || '手作業';
    setText($('craft-station'), `作業場所（3.5マス以内）：${stations.filter((s) => s.id).map((s) => `${s.name}${near.has(s.id) ? '○' : '×'}`).join(' ／ ')}`);

    // カテゴリのチップ
    const cats = [...new Set(views.map((v) => v.category).filter(Boolean))];
    const chipSig = `${this.recipeCat}|${this.onlyReady}|${cats.join(',')}`;
    const box = $('craft-categories');
    if (force || box._sig !== chipSig) {
      box._sig = chipSig;
      box.replaceChildren(
        h('button', { type: 'button', class: 'chip', dataset: { cat: 'all' }, 'aria-pressed': String(this.recipeCat === 'all'), text: 'すべて' }),
        ...cats.map((c) => h('button', { type: 'button', class: 'chip', dataset: { cat: c }, 'aria-pressed': String(this.recipeCat === c), text: CATEGORY_JA[c] || c })),
        h('button', { type: 'button', class: 'chip', dataset: { cat: '__ready' }, 'aria-pressed': String(this.onlyReady), text: '作れる物だけ' }));
    }
    const ready = (v) => v.stationOk && v.times > 0;
    const shown = views.filter((v) => (this.recipeCat === 'all' || v.category === this.recipeCat) && (!this.onlyReady || ready(v)));

    // 一覧：順序が変わるときだけ作り直す（フォーカスを保つ）
    const order = shown.map((v) => v.id).join(',');
    const list = $('craft-list');
    if (force || order !== this.recipeOrder) {
      const focusId = document.activeElement?.closest?.('.recipe-row')?.dataset.id;
      this.recipeOrder = order;
      list.replaceChildren(...shown.map((v) => {
        let li = this.recipeRows.get(v.id);
        if (!li) {
          li = $('tpl-recipe').content.firstElementChild.cloneNode(true);
          li.dataset.id = v.id;
          const img = li.querySelector('.recipe-icon');
          const url = this.iconUrl(v.out.key);
          if (url) { img.src = url; img.hidden = false; } else img.replaceWith(this.glyph(v.out.key));
          this.recipeRows.set(v.id, li);
        }
        return li;
      }));
      if (focusId) list.querySelector(`.recipe-row[data-id="${focusId}"] .recipe`)?.focus();
    }
    for (const v of shown) {
      const li = this.recipeRows.get(v.id);
      const b = li.querySelector('.recipe');
      const meta = !v.stationOk ? `${nameOf(v.station)}が必要` : v.times > 0 ? `作れる ×${v.times}` : '材料不足';
      setText(li.querySelector('.recipe-name'), `${v.out.name}${v.out.n > 1 ? ` ×${v.out.n}` : ''}`);
      setText(li.querySelector('.recipe-meta'), meta);
      li.dataset.craftable = String(ready(v));
      b.setAttribute('aria-pressed', String(v.id === this.recipeSel));
    }
    if (!shown.some((v) => v.id === this.recipeSel)) this.recipeSel = shown[0]?.id || null;
    for (const v of shown) this.recipeRows.get(v.id).querySelector('.recipe').setAttribute('aria-pressed', String(v.id === this.recipeSel));
    this.renderRecipeDetail(shown.find((v) => v.id === this.recipeSel), nameOf);
  }

  renderRecipeDetail(v, nameOf) {
    const name = $('craft-detail-name');
    const make = $('btn-craft-make');
    const m5 = $('btn-craft-make5');
    const mx = $('btn-craft-max');
    if (!v) {
      name.textContent = 'レシピがありません';
      setText($('craft-detail-text'), '');
      $('craft-ingredients').replaceChildren();
      make.disabled = true; m5.disabled = true; mx.disabled = true;
      setText($('craft-message'), '');
      return;
    }
    const d = this.itemDef(v.out.key);
    name.replaceChildren(`${v.out.name}${v.out.n > 1 ? ` ×${v.out.n}` : ''}`, h('span', { class: 'detail-en', lang: 'en', text: v.out.en || '' }));
    setText($('craft-detail-text'), `${d?.desc || ''}${d?.desc ? ' ' : ''}必要な場所：${nameOf(v.station)}`);
    $('craft-ingredients').replaceChildren(...v.ingredients.map((ing) => {
      const li = $('tpl-ingredient').content.firstElementChild.cloneNode(true);
      const img = li.querySelector('.ingredient-icon');
      if (ing.key && this.iconUrl(ing.key)) { img.src = this.iconUrl(ing.key); img.hidden = false; } else img.replaceWith(this.glyph(ing.key || 'fish_trout'));
      li.querySelector('.ingredient-name').textContent = ing.name || this.itemName(ing.key);
      li.querySelector('.ingredient-count').textContent = `${ing.have} / ${ing.need}`;
      li.dataset.short = String(ing.have < ing.need);
      return li;
    }));
    const c = safe(() => this.game.canCraft(v.id)) || { ok: false, times: 0, missing: [] };
    const can = !!c.ok && c.times > 0;
    make.disabled = !can; make.textContent = '作る ×1';
    m5.disabled = !(can && c.times >= 5); m5.textContent = '×5';
    mx.disabled = !can; mx.textContent = can ? `最大 ×${c.times}` : '最大';
    let msg = this.craftNote && performance.now() < this.craftNote.until ? this.craftNote.text : '';
    if (!can) {
      if (!v.stationOk) msg = `${nameOf(v.station)}が3.5マス以内にありません。近くへ行ってから作りましょう。`;
      else if (c.missing?.length) msg = `不足：${c.missing.map((m) => `${this.itemDef(m.key) ? this.itemName(m.key) : (m.key === 'fish' ? '魚' : m.key)} あと${Math.max(0, m.need - m.have)}`).join('、')}`;
      else msg = '作れません。';
    }
    setText($('craft-message'), msg);
  }

  doCraft(times) {
    if (!this.recipeSel) return;
    const c = safe(() => this.game.canCraft(this.recipeSel)) || { times: 0 };
    const n = times === 0 ? c.times : Math.min(times, c.times);
    if (n < 1) return;
    const v = (safe(() => this.game.getRecipeView()) || []).find((x) => x.id === this.recipeSel);
    const r = safe(() => this.game.craft(this.recipeSel, n)) || { ok: false };
    this.craftNote = { text: r.ok ? `${v?.out.name || ''} を ${r.made ?? n} 個作りました` : this.reasonText(r.reason), until: performance.now() + 4000 };
    this.renderCraft();
  }

  // ---------- 地図 ----------
  setMapCursor(x, y) {
    this.mapCursor = { x: clamp(Math.floor(x) || 0, 0, 127), y: clamp(Math.floor(y) || 0, 0, 127) };
    this.renderMap(false);
  }

  renderMap(reset) {
    const g = this.game;
    const data = safe(() => g.getMapData());
    if (!data) return;
    if (reset && g.player) this.mapCursor = { x: clamp(Math.floor(g.player.x), 0, 127), y: clamp(Math.floor(g.player.y), 0, 127) };
    const cv = $('map-canvas');
    const ok = typeof this.renderer?.drawMinimap === 'function' && !this.renderer.stub;
    if (ok) safe(() => this.renderer.drawMinimap(cv, true));
    else this.drawFallbackMap(cv, data);
    const ctx = cv.getContext('2d');
    const sc = cv.width / 128;
    ctx.imageSmoothingEnabled = false;
    for (const m of data.markers || []) {
      const x = Math.floor(m.x * sc);
      const y = Math.floor(m.y * sc);
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 3, y - 3, 7, 7);
      ctx.fillStyle = MARKER_COLOR[m.kind] || '#fff';
      ctx.fillRect(x - 2, y - 2, 5, 5);
    }
    const cx = Math.floor(this.mapCursor.x * sc);
    const cy = Math.floor(this.mapCursor.y * sc);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 5.5, cy - 5.5, 12, 12);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(cx - 6.5, cy - 6.5, 14, 14);
    // 凡例と位置の読み上げ
    const markers = data.markers || [];
    const legend = $('map-legend');
    const lsig = markers.map((m) => `${m.kind}${m.x},${m.y}`).join('|');
    if (legend._sig !== lsig) {
      legend._sig = lsig;
      legend.replaceChildren(...markers.map((m) => h('li', null, h('button', { type: 'button', dataset: { x: Math.floor(m.x), y: Math.floor(m.y) } },
        h('i', { style: `--mc:${MARKER_COLOR[m.kind] || '#fff'}` }), `${m.label || MARKER_JA[m.kind] || m.kind}${m.state ? `（${m.state}）` : ''}`))));
    }
    const cur = this.mapCursor;
    const near = markers.map((m) => ({ m, d: Math.hypot(m.x - cur.x, m.y - cur.y) })).filter((o) => o.d <= 4).sort((a, b) => a.d - b.d)[0];
    const biome = BIOME_JA[safe(() => g.world.biomeAt(cur.x, cur.y)) || 0] || '';
    const known = data.explored && data.explored[cur.y * 128 + cur.x];
    setText($('map-position'), `カーソル (${cur.x}, ${cur.y}) ${known ? biome : '未踏の場所'}${near ? ` — ${near.m.label || MARKER_JA[near.m.kind] || near.m.kind}` : ''}`);
  }

  drawFallbackMap(cv, data) {
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, 256, 256);
    const w = this.game.world;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        if (!data.explored[y * 128 + x]) continue;
        ctx.fillStyle = w && w.wallAt(x, y) ? '#3b4a56' : '#2e5a3c';
        ctx.fillRect(x * 2, y * 2, 2, 2);
      }
    }
  }

  // ---------- 記録（目標・図鑑・実績） ----------
  renderCodex() {
    const f = this.codexFilter;
    for (const c of $('codex-filter').querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(c.dataset.filter === f));
    $('goal-list').hidden = f !== 'goals';
    $('codex-entries').hidden = f !== 'codex';
    $('achievement-list').hidden = f !== 'achievements';
    if (f === 'goals') this.renderGoals();
    else if (f === 'codex') this.renderCodexEntries();
    else this.renderAchievements();
  }

  renderGoals() {
    const obj = safe(() => this.game.getObjective()) || { index: 0 };
    const list = this.data.OBJECTIVES || [];
    $('goal-list').replaceChildren(...list.map((o, i) => {
      const done = i < obj.index;
      const cur = i === obj.index;
      const locked = i > obj.index;
      const li = h('li', { dataset: { done: String(done), locked: String(locked), current: String(cur) } },
        h('p', { class: 'entry-name' }, locked ? '？？？' : o.text, !locked ? h('span', { class: 'detail-en', lang: 'en', text: o.en }) : null),
        h('p', { class: 'entry-where', text: done ? '達成' : cur ? 'いまの目標' : '未開放' }));
      return li;
    }));
  }

  renderCodexEntries() {
    const all = safe(() => this.game.getCodex()) || [];
    const cats = this.data.CODEX_CATEGORIES || [];
    const un = all.filter((e) => e.unlocked).length;
    const out = [h('li', { class: 'entry-heading', text: `解放 ${un} / ${all.length}` })];
    const groups = [...new Set(all.map((e) => e.category))];
    for (const gk of groups) {
      const ja = cats.find((c) => c.id === gk)?.name || CODEX_GROUP_JA[gk] || gk;
      out.push(h('li', { class: 'entry-heading', text: ja }));
      for (const e of all.filter((x) => x.category === gk)) {
        out.push(h('li', { dataset: { locked: String(!e.unlocked), done: String(e.unlocked) } },
          h('p', { class: 'entry-name' }, e.unlocked ? e.name : '？？？', e.unlocked ? h('span', { class: 'detail-en', lang: 'en', text: e.en }) : null),
          e.unlocked ? h('p', { class: 'entry-desc', text: e.desc || '' }) : null,
          e.unlocked && e.where ? h('p', { class: 'entry-where', text: `出現場所：${e.where}` }) : null));
      }
    }
    $('codex-entries').replaceChildren(...out);
  }

  renderAchievements() {
    const list = safe(() => this.game.getAchievements()) || [];
    const un = list.filter((a) => a.unlocked).length;
    $('achievement-list').replaceChildren(
      h('li', { class: 'entry-heading', text: `実績 ${un} / ${list.length}` }),
      ...list.map((a) => h('li', { dataset: { done: String(a.unlocked), locked: String(!a.unlocked) } },
        h('p', { class: 'entry-name' }, `${a.unlocked ? '★ ' : '☆ '}${a.name}`, h('span', { class: 'detail-en', lang: 'en', text: a.en })),
        h('p', { class: 'entry-desc', text: a.desc }))));
  }

  // ---------- 種の選択（農業） ----------
  // 空の苗床を調べたとき（interact イベントの seeds：持っている種・光茸のキー）
  openSeedDialog(x, y, keys) {
    const seeds = (keys || []).map((key) => ({ key, n: safe(() => this.game.itemCount(key)) || 0 })).filter((s) => s.n > 0 && this.data.CROPS?.[this.itemDef(s.key)?.plant]);
    if (!seeds.length || this.top()?.name === 'seed') return;
    this.stack.push({ name: 'seed', params: { x, y, seeds }, opener: document.activeElement });
    this.renderTop(true);
  }

  renderSeed() {
    const { x, y, seeds } = this.top().params;
    setText($('seed-text'), '苗床に植えるものを選びます。明るい場所だけで育ちます。');
    $('seed-list').replaceChildren(...seeds.map((s) => {
      const crop = this.data.CROPS[this.itemDef(s.key).plant];
      const b = h('button', {
        type: 'button', class: 'menu-btn',
        onclick: () => {
          const r = safe(() => this.game.plantAt(x, y, s.key)) || { ok: false };
          this.popTop();
          if (r.ok) this.toast(`${this.itemName(s.key)}を植えた`, 'good'); else this.toast(this.reasonText(r.reason) || '植えられません', 'warn');
        },
      },
      h('span', { class: 'menu-btn-ja', text: `${this.itemName(s.key)}（×${s.n}）` }),
      h('span', { class: 'menu-btn-en', lang: 'en', text: `${Math.round(crop.growTime / 60 * 10) / 10} MIN` }));
      return b;
    }));
  }

  // ---------- 調べた対象（game が発行する interact イベント） ----------
  // station: {station} / planter: {x,y,seeds} / core: {ready,hearts} / altar: {boss,defeated}
  onInteract(e) {
    const g = this.game;
    if (g.mode !== 'playing' || this.stack.length || this.dialogue) return;
    switch (e.kind) {
      case 'station': this.openScreen('craft', { station: e.station }); break;
      case 'planter': this.openSeedDialog(Math.floor(e.x), Math.floor(e.y), e.seeds); break;
      case 'core': if (e.ready) this.offerCore(); break;
      case 'altar': this.showAltar(e.boss, e.defeated); break;
      default: break;
    }
  }

  // 三つの核を捧げる前の確認
  offerCore() {
    const g = this.game;
    this.confirm({
      title: '炉心に核を捧げますか？', en: 'OFFER THE EMBERS',
      lines: ['苔の核・晶の核・灼の核を、炉心に捧げます。'],
      dim: ['捧げると炉心が灯り、旅は一つの区切りを迎えます。そのあとも、深庭で自由に築き続けられます。'],
      actions: [{ label: '捧げる', kind: 'primary', run: () => { const r = safe(() => g.offerHearts()) || { ok: false }; if (!r.ok) this.toast(this.reasonText(r.reason), 'warn'); } }],
      cancelLabel: 'まだ',
    });
  }

  showAltar(id, defeated) {
    const b = this.data.BOSSES?.[id];
    if (!b) return;
    this.showDialogue({ speaker: `${b.name} — ${b.en}`, lines: [b.desc, `${b.where}。${defeated ? 'すでに鎮められている。' : '祭壇のまわりに入ると、戦いが始まる。'}`] });
  }

  // ---------- 会話パネル ----------
  showDialogue({ speaker, lines }) {
    if (this.dialogue || !lines?.length) return;
    this.dialogue = { lines, i: 0, opener: document.activeElement };
    setText($('dialogue-speaker'), speaker || '');
    $('dialogue').hidden = false;
    this.root.dataset.dialogue = 'open';
    this.renderDialogue();
    this.syncPause();
    safe(() => $('btn-dialogue-next').focus());
  }

  renderDialogue() {
    const d = this.dialogue;
    setText($('dialogue-text'), d.lines[d.i]);
    setText($('btn-dialogue-next'), d.i + 1 >= d.lines.length ? '閉じる' : '次へ');
  }

  dialogueNext() {
    const d = this.dialogue;
    if (!d) return;
    if (d.i + 1 >= d.lines.length) this.closeDialogue(); else { d.i += 1; this.renderDialogue(); }
  }

  closeDialogue() {
    if (!this.dialogue) return;
    const op = this.dialogue.opener;
    this.dialogue = null;
    $('dialogue').hidden = true;
    this.root.dataset.dialogue = 'closed';
    this.syncPause();
    this.restoreFocus(op, false);
  }

  dialogueAction(action, ev) {
    if (action === 'back') { this.closeDialogue(); return true; }
    if (action === 'confirm') return this.confirmKey(ev, $('dialogue'));
    if (action === 'up' || action === 'down' || action === 'left' || action === 'right') return this.moveFocus(action, $('dialogue'));
    return true;
  }

  // ---------- 毎フレーム ----------
  update(dt) {
    if (!this.ready) return;
    const g = this.game;
    if (this.worldId !== g.worldId) { this.worldId = g.worldId; this.lastSeq = g.eventSeq || 0; this.seenBiomes = new Set(); }
    this.pollEvents();
    this.followMode(dt);
    this.syncPause();
    this.tickToasts(dt);
    this.updateVisibility();
    this.updateNotices();
    this.hudT += dt;
    if (this.hudT >= 0.1) { this.hudT = 0; this.updateHud(); }
    this.miniT += dt;
    if (this.miniT >= 0.25) { this.miniT = 0; this.updateMinimap(); }
    this.panelT += dt;
    if (this.panelT >= 0.25) { this.panelT = 0; this.refreshPanel(); }
    this.flushPickups(dt);
  }

  refreshPanel() {
    const top = this.top();
    if (!top) return;
    switch (top.name) {
      case 'inventory': this.renderInventory(); break;
      case 'chest': this.renderChest(); break;
      case 'craft': this.renderCraft(); break;
      case 'pause': this.renderPause(); break;
      case 'map': this.renderMap(false); break;
      default: break;
    }
  }

  // ゲームの状態（死亡・エンディング・収納・別タブ）に画面を合わせる
  followMode(dt) {
    const g = this.game;
    if (this.screen === 'boot' || this.screen === 'error') return;
    if (g.mode === 'title') { if (this.screen === 'play') this.showTitle(); return; }
    if (this.screen === 'title') { this.screen = 'play'; $('title-screen').hidden = true; }
    // 別タブに引き継がれた
    if (g.readOnly && !this.hasKind('readonly')) this.openReadonly();
    else if (!g.readOnly && this.hasKind('readonly')) this.removeAt(this.stack.findIndex((s) => s.params?.kind === 'readonly'));
    $('session-banner').hidden = !g.readOnly;
    // 死亡：演出のあとに画面を出す
    if (g.mode === 'dead') {
      if (!this.deadShown) {
        this.deadT += dt;
        if (this.deadT >= 1.4 && !this.stack.length) { this.deadShown = true; this.showScreen('dead'); }
      }
    } else { this.deadT = 0; this.deadShown = false; }
    // エンディング
    if (g.mode === 'ending') {
      if (g.ending?.phase === 'text') {
        this.dismissToastKey('skip-ending');
        if (!this.endingShown && !this.hasKind('ending')) { this.endingShown = true; this.showScreen('ending'); }
      } else if (!this.skipToast || !this.skipToast.isConnected) {
        this.skipToast = this.toast('炉心が灯る… Enter / Esc で飛ばせます', 'info', { persist: true, key: 'skip-ending', actions: [{ label: 'スキップ', run: () => safe(() => g.skipEndingAnim()) }], live: false });
      }
    } else { this.endingShown = false; }
    // 収納箱
    if (g.openContainer != null) {
      if (!this.hasScreen('chest') && !this.stack.length && g.mode === 'playing') this.openScreen('chest');
    } else if (this.hasScreen('chest')) this.removeScreen('chest');
  }

  // 保存できない環境の常設の帯（タイトルでも出す）
  updateNotices() {
    const warn = $('storage-warning');
    if (!this.app.storageAvailable && !this._storageText) {
      this._storageText = true;
      setText(warn.querySelector('.notice-text'), 'この環境では保存できません。ポーズメニューの「書き出し」で進行を保存してください。このまま遊べます。');
    }
    const show = !this.app.storageAvailable && !this.storageDismissed && this.screen !== 'boot' && this.screen !== 'error';
    if (warn.hidden === show) warn.hidden = !show;
  }

  updateVisibility() {
    const g = this.game;
    const introOpen = this.stack.some((s) => s.name === 'end' && s.params.kind === 'intro');
    const hud = this.screen === 'play' && g.mode !== 'title' && !introOpen;
    if ($('hud').hidden === hud) $('hud').hidden = !hud;
    this.updateTouch(hud);
  }

  updateTouch(hudShown = !$('hud').hidden) {
    const mode = this.app.settings.touchControls;
    const on = mode === 'on' || (mode === 'auto' && (this.coarse || this.input?.device === 'touch'));
    const v = on ? 'on' : 'off';
    if (this.root.dataset.touch !== v) this.root.dataset.touch = v;
    const show = on && hudShown;
    if ($('touch-controls').hidden === show) $('touch-controls').hidden = !show;
  }

  onResize() {
    this.coarse = !!safe(() => matchMedia('(pointer: coarse)').matches);
    this.updateTouch();
    if (this.top()?.name === 'map') this.renderMap(false);
  }

  // ---------- HUD ----------
  hudKey(kind) {
    const touch = this.input?.device === 'touch';
    return touch ? (TOUCH_LABEL[kind] || '使う') : (KEY_LABEL[kind] || 'J');
  }

  updateHud() {
    const g = this.game;
    if ($('hud').hidden || !g.player) return;
    const hud = safe(() => g.getHUD());
    if (!hud) return;
    const a = this.app.getAll();
    setText($('hud-day'), `経過 ${fmtClock(g.playTime)}`);
    setText($('hud-biome'), hud.biome?.name || '');
    const stat = (id, value, maxValue, low, crit) => {
      const el = $(id);
      const v = Number(value) || 0;
      const max = Number(maxValue) || 0;
      const r = max > 0 ? v / max : 0;
      setFill(el.querySelector('.hud-stat-fill'), r);
      setText(el.querySelector('.hud-stat-value'), `${Math.ceil(v)}/${Math.round(max)}`);
      el.setAttribute('aria-valuenow', String(Math.round(r * 100)));
      const st = r <= crit ? 'critical' : r <= low ? 'low' : '';
      if (st) el.dataset.state = st; else el.removeAttribute('data-state');
    };
    stat('stat-health', hud.hp, hud.maxHp, 0.35, 0.15);
    stat('stat-hunger', hud.hunger, hud.maxHunger, 0.25, 0.1);
    stat('stat-stamina', hud.stamina, hud.maxStamina, hud.exhausted ? 1 : 0.2, hud.exhausted ? 1 : 0.05);
    // 状態効果
    const fx = [];
    for (const b of hud.buffs || []) fx.push(`${b.name || this.data.BUFFS?.[b.id]?.name || b.id} ${Math.ceil(b.t)}s`);
    if (hud.heat) fx.unshift('灼熱！');
    if (hud.exhausted) fx.unshift('息切れ');
    const fxSig = fx.join('|');
    const fxEl = $('hud-effects');
    if (fxEl._sig !== fxSig) { fxEl._sig = fxSig; fxEl.replaceChildren(...fx.map((t) => h('li', { text: t }))); }
    // 目標
    const obj = safe(() => g.getObjective());
    if (obj) {
      setText($('objective-title'), obj.text || '—');
      let sub = obj.en || '';
      const p = g.player;
      if (a.objectiveArrow && obj.target && !obj.final) {
        const dx = obj.target.x - p.x;
        const dy = obj.target.y - p.y;
        sub = `${compass(dx, dy)}へ ${Math.round(Math.hypot(dx, dy))}マス ・ ${sub}`;
      }
      setText($('objective-text'), sub);
      const total = (this.data.OBJECTIVES || []).length - 1;
      const bar = $('objective-progress');
      bar.hidden = false;
      setFill(bar.querySelector('.hud-progress-fill'), total > 0 ? obj.index / total : 0);
      bar.setAttribute('aria-valuenow', String(Math.round((total > 0 ? obj.index / total : 0) * 100)));
    }
    // ボス
    const bb = $('boss-bar');
    if (hud.boss) {
      bb.hidden = false;
      setText($('boss-name'), `${hud.boss.name}${hud.boss.phase >= 2 ? '　第二段階' : ''} — ${hud.boss.en}`);
      setFill($('boss-meter').querySelector('.boss-fill'), hud.boss.maxHp > 0 ? hud.boss.hp / hud.boss.maxHp : 0);
      $('boss-meter').setAttribute('aria-valuenow', String(Math.round((hud.boss.hp / Math.max(1, hud.boss.maxHp)) * 100)));
    } else bb.hidden = true;
    // ホットバー
    const slots = $('hotbar-slots').children;
    for (let i = 0; i < slots.length; i++) {
      const s = hud.hotbar?.[i] || null;
      const el = slots[i];
      this.paintCell(el, s, this.cellLabel(s, `スロット${i + 1}`));
      const sel = String(i === hud.selected);
      if (el.getAttribute('aria-pressed') !== sel) el.setAttribute('aria-pressed', sel);
    }
    const cur = hud.hotbar?.[hud.selected];
    setText($('hotbar-label'), cur ? `${this.itemName(cur.id)}${cur.n > 1 ? ` ×${cur.n}` : ''}` : '素手');
    this.updatePrompt(hud);
  }

  updatePrompt(hud) {
    const box = $('interact-prompt');
    const key = $('interact-key');
    const bar = $('interact-progress');
    let text = '';
    let k = '';
    let progress = null;
    let urgent = false;
    if (hud.channel) {
      text = '灯へ帰る… 動くと中断されます';
      k = '帰還';
      progress = hud.channel.progress;
    } else if (hud.fishing) {
      const ph = hud.fishing.phase;
      k = this.hudKey('primary');
      if (ph === 'bite') { text = '今だ！ 押して引き上げる'; urgent = true; } else if (ph === 'wait') text = '待機中… 「！」が出たら押す（早すぎるとやり直し）';
      else text = '糸を投げている…';
    } else if (hud.prompt) {
      const verb = this.data.ACTIONS?.[hud.prompt.action] || hud.prompt.action;
      k = this.hudKey(VERB_KEY[hud.prompt.action] || 'interact');
      text = `${verb}${hud.prompt.label ? `：${hud.prompt.label}` : ''}`;
    }
    box.hidden = !text;
    if (!text) return;
    setText(key, k);
    setText($('interact-text'), text);
    if (urgent) box.dataset.urgent = 'true'; else box.removeAttribute('data-urgent');
    bar.hidden = progress == null;
    if (progress != null) { setFill(bar.querySelector('.hud-progress-fill'), progress); bar.setAttribute('aria-valuenow', String(Math.round(progress * 100))); }
    if (urgent && this._lastUrgent !== true) this.speak('今だ。押して引き上げる');
    this._lastUrgent = urgent;
  }

  updateMinimap() {
    if ($('hud').hidden || !this.game.world) return;
    if (typeof this.renderer?.drawMinimap === 'function' && !this.renderer.stub) safe(() => this.renderer.drawMinimap($('minimap-canvas'), false));
  }

  // ---------- イベント ----------
  pollEvents() {
    const g = this.game;
    const events = safe(() => g.pollEvents(this.lastSeq)) || [];
    for (const e of events) {
      this.lastSeq = e.seq;
      safe(() => this.onEvent(e), `event:${e.type}`);
    }
  }

  codexName(category, key) {
    const d = this.data;
    const t = { item: d.ITEMS, fish: d.ITEMS, enemy: d.ENEMIES }[category];
    if (t && t[key]) return t[key].name;
    if (category === 'boss') return Object.values(d.BOSSES || {}).find((b) => b.key === key || b.id === key)?.name || key;
    if (category === 'biome') return Object.values(d.BIOMES || {}).find((b) => b.key === key || String(b.id) === String(key))?.name || key;
    return key;
  }

  onEvent(e) {
    const d = this.data;
    switch (e.type) {
      case 'toast': this.toast(e.text, e.kind === 'error' ? 'danger' : e.kind || 'info'); break;
      case 'pickup': this.pickups.set(e.item, (this.pickups.get(e.item) || 0) + (e.n || 1)); this.pickupT = 0.5; break;
      case 'interact': this.onInteract(e); break;
      case 'craft': if (this.top()?.name !== 'craft') this.toast(`${this.itemName(e.item)} ×${e.n || 1} を作った`, 'good'); break;
      case 'buff': this.toast(`${d.BUFFS?.[e.id]?.name || e.id}の効果`, 'good'); break;
      case 'fishBite': this.speak('！ 引き上げる'); break;
      case 'sleep': this.toast('ぐっすり眠った。体力が全回復した', 'good'); break;
      case 'death': this.lastDeath = e; break;
      case 'channelCancel': this.toast('帰還を中断した', 'warn'); break;
      case 'channelDone': this.toast('祠へ帰ってきた', 'good'); break;
      // 撃破・段階変化・封印門・実績のトーストは game が出すので、ここでは出さない
      case 'bossIntro': this.toast(d.BOSSES?.[e.bossId]?.name || '守護者', 'warn', { banner: true, duration: 2.6 }); break;
      case 'bossReset': this.toast('守護者は元の姿に戻った', 'info'); break;
      case 'biomeEnter': {
        const b = d.BIOMES?.[e.biome] || Object.values(d.BIOMES || {}).find((x) => x.key === e.biome);
        if (!b) break;
        const first = e.first && !this.seenBiomes.has(b.id);
        this.seenBiomes.add(b.id);
        this.toast(`${b.name} — ${b.en}`, 'info', first ? { banner: true, duration: 3.6 } : { duration: 2 });
        break;
      }
      case 'objective': {
        const o = d.OBJECTIVES?.[e.index];
        if (o) this.toast(`目標：${o.text}`, 'good');
        break;
      }
      case 'achievement': safe(() => this.store.addGlobalAchievement(e.id)); break; // 全セーブ共通の一覧にも記録
      case 'codex': this.toast(`図鑑：${this.codexName(e.category, e.key)}`, 'info', { duration: 2.4, live: false }); break;
      case 'hint': {
        const t = d.HINTS?.[e.id];
        if (t) this.toast(t, 'info', { duration: 6 });
        break;
      }
      case 'saveFail': this.onSaveResult({ ok: false, error: e.reason, reason: 'write' }); break;
      case 'chestOpen': break;
      default: break;
    }
  }

  // 拾った物は少しまとめて1行で出す
  flushPickups(dt) {
    if (!this.pickups.size) return;
    this.pickupT -= dt;
    if (this.pickupT > 0) return;
    const text = [...this.pickups].map(([k, n]) => `${this.itemName(k)} +${n}`).join(' ・ ');
    this.pickups.clear();
    this.toast(text, 'info', { duration: 2, live: false });
  }
}
