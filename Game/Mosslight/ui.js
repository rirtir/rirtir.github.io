// 苔灯の境 / MOSSLIGHT — DOM UI(HUD・バッグ・制作・建築・箱・日誌・地図・設定・祭壇/住人/再戦・エンディング・スタート画面・タッチ操作)
// 依存: data.js のみ。状態の操作はすべて api 経由(循環importを避ける)。
//
// api に必要なもの:
//   assets.iconInfo(name)           アイコンのスプライトシート情報
//   getState()                      現在のstate
//   recipeStatus(recipe), nearbyStations(), getObjective()
//   craft(id,n), eat(id), useHotbar(i), swapBag(a,b), equipFromBag(slot), unequip(name)
//   assignHotbar(i,id), dropItem(slot), transfer(containerId, from, slot)
//   worldToScreen(x,y), focusCanvas(), setScale(v), onSettings(settings), audioAvailable(), sfx(name)
//   selectBuild(type,rot)→{ok,reason?}, getBuildState()→{type,rot,active}, getHouseStatus()
//   getJournal(), restoreLight(id), collectResident(id), bossRematch(id), endingContinue()
//   hasSave(), getSaveInfo(), saveNow(), exportSave(), importSave(), restoreBackup(), inGame()
//   startNew(), requestNew(), continueGame(), toTitle()
//   input.{move,act,actPress,dodge,cancel,remove,rotate,confirm,demolish}   仮想スティック/ボタン
import { BALANCE, ITEMS, RECIPES, STATIONS, CATEGORIES, LIGHTS, BOSSES, NPCS, STRUCTURES, CROPS, TILE, TERRAIN, RUIN_TEMPLATE } from './data.js';

const SETTINGS_KEY = 'mosslight.settings';

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'data') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

const TOOL_LABEL = { axe: '斧', pick: 'ツルハシ', hoe: '鍬' };
const STATION_TABS = [
  { id: 'hand', name: '手' },
  { id: 'workbench', name: '作業台' },
  { id: 'furnace', name: '精錬炉' },
  { id: 'pot', name: '鍋・焚き火' },
];

/* ---- 設定は、必要な型だけを受け取る ---- */
const DEFAULT_SETTINGS = { scale: 'auto', large: false, calm: false, hints: true, touch: 'auto', master: 0.65, music: 0.45, sfx: 0.7 };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function sanitizeSettings(o) {
  const s = { ...DEFAULT_SETTINGS };
  if (!o || typeof o !== 'object') return s;
  if (o.scale === 'auto' || o.scale === 2 || o.scale === 3 || o.scale === 4) s.scale = o.scale;
  for (const k of ['large', 'calm', 'hints']) if (typeof o[k] === 'boolean') s[k] = o[k];
  if (o.touch === 'auto' || o.touch === 'on' || o.touch === 'off') s.touch = o.touch;
  for (const k of ['master', 'music', 'sfx']) if (typeof o[k] === 'number' && isFinite(o[k])) s[k] = clamp01(o[k]);
  return s;
}

const fmtPlay = (sec) => {
  const m = Math.floor((sec || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`;
};
const fmtDate = (ms) => {
  if (!ms) return '不明';
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 地図の色(地形idごと)
const MAP_COLORS = (() => {
  const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const c = [];
  c[0] = '#10140f';
  c[TERRAIN.GRASS] = '#4f7a3a'; c[TERRAIN.DARKGRASS] = '#38573a'; c[TERRAIN.DIRT] = '#8a6a3f'; c[TERRAIN.PATH] = '#bfa56c';
  c[TERRAIN.SAND] = '#d4c28a'; c[TERRAIN.SHALLOW] = '#4f95a8'; c[TERRAIN.DEEP] = '#1f4a6a'; c[TERRAIN.MOSS] = '#2f6b4f';
  c[TERRAIN.ROCKY] = '#7b8486'; c[TERRAIN.CLIFF] = '#233a29'; c[TERRAIN.FARM] = '#6a4b2e'; c[TERRAIN.CAVE_FLOOR] = '#6a6470';
  c[TERRAIN.CAVE_WALL] = '#2a2730'; c[TERRAIN.MOSS_FLOOR] = '#3f8a6a'; c[TERRAIN.RUIN] = '#a79b80'; c[TERRAIN.BEDROCK] = '#18161c';
  return c.map((v) => (v ? hex(v) : [16, 20, 15]));
})();
const MARKS = {
  base: { glyph: '◆', color: '#ffd98a', label: '拠点（野営地・塔）' },
  entrance: { glyph: '▲', color: '#7fe0e8', label: '入口・階段' },
  altar: { glyph: '★', color: '#e0b4ff', label: '祭壇・灯台' },
  crystal: { glyph: '◇', color: '#a6ecff', label: '光苔結晶' },
  bag: { glyph: '■', color: '#ff8a70', label: '資源袋' },
  you: { glyph: '●', color: '#ffffff', label: '現在地' },
};

export function createUI(root, api) {
  const app = root.closest('#app') || root.parentElement;
  const ui = {};
  let current = null;          // {name, d, modal, dialog}
  let layer = null;            // 確認/お知らせの重ね表示
  let ending = null;           // エンディング表示
  let titleEl = null;
  let lastRev = -1;
  let lastSel = -2;
  let lastObjKey = '';
  let lastObjAt = 0;
  let lastStationSig = '';
  let lastTick = 0;
  let hintTimer = 0;
  let touchSeen = false;
  let flashTimer = 0;
  const last = { hp: -1, food: -1, tod: -1, day: -1, boss: '', build: '' };
  const toasts = [];
  let settings = { ...DEFAULT_SETTINGS };

  /* ---------------------------------------------------------------- 設定 */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) settings = sanitizeSettings(JSON.parse(raw));
    } catch (e) { settings = { ...DEFAULT_SETTINGS }; }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { toast('設定を保存できませんでした', 'warn'); }
  }
  const coarse = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const touchOn = () => settings.touch === 'on' || (settings.touch === 'auto' && (touchSeen || coarse()));
  function applySettings() {
    app.classList.toggle('large', !!settings.large);
    app.classList.toggle('calm', !!settings.calm);
    app.classList.toggle('touch', touchOn());
    api.setScale(settings.scale);
    if (api.onSettings) api.onSettings({ ...settings });
  }
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !touchSeen) { touchSeen = true; app.classList.toggle('touch', touchOn()); }
  }, { capture: true });

  /* ---------------------------------------------------------------- 部品 */
  function iconEl(name) {
    const info = api.assets && api.assets.iconInfo ? api.assets.iconInfo(name) : null;
    if (!info) return h('span', { class: 'icon fallback', 'aria-hidden': 'true', text: String(name || '?').slice(0, 1).toUpperCase() });
    const e = h('span', { class: 'icon', 'aria-hidden': 'true' });
    e.style.backgroundImage = `url("${info.url}")`;
    e.style.backgroundSize = `calc(${info.sheetW}px * var(--u)) calc(${info.sheetH}px * var(--u))`;
    e.style.backgroundPosition = `calc(${-info.x}px * var(--u)) calc(${-info.y}px * var(--u))`;
    return e;
  }
  const itemIcon = (id) => iconEl(ITEMS[id] ? ITEMS[id].icon : 'bag');
  const countOf = (state, id) => { let n = 0; for (const s of state.player.bag) if (s && s.id === id) n += s.n; return n; };
  const itemName = (id) => (ITEMS[id] ? ITEMS[id].name : id);

  /* ---------------------------------------------------------------- HUD */
  const hpFill = h('i'), hpNum = h('span');
  const foodFill = h('i'), foodNum = h('span');
  const hpBar = h('div', { class: 'bar hp', role: 'img', 'aria-label': '体力' }, hpFill, hpNum);
  const foodBar = h('div', { class: 'bar food', role: 'img', 'aria-label': '満腹' }, foodFill, foodNum);
  const clockHand = h('div', { class: 'hand' });
  const clockText = h('div', { class: 'clock-text' });
  const clock = h('div', { class: 'clock', role: 'img', 'aria-label': '時刻' }, clockHand, clockText);
  const objText = h('div', { class: 'otext' });
  const objNeed = h('div', { class: 'need' });
  const objective = h('div', { class: 'objective' }, h('b', { text: '次の一手' }), objText, objNeed);

  const mkMenuBtn = (label, key, icon, name) => h('button', {
    class: 'mbtn', type: 'button', tabindex: '-1', title: `${label}（${key}）`, 'aria-label': `${label}（${key}）`,
    onclick: () => { open(name); },
  }, icon ? iconEl(icon) : h('span', { class: 'glyph', 'aria-hidden': 'true', text: '☰' }), h('kbd', { text: key }));
  const menuBtns = h('div', { class: 'menu-btns' },
    mkMenuBtn('バッグ', 'Tab', 'bag', 'bag'),
    mkMenuBtn('制作', 'C', 'hammer', 'craft'),
    mkMenuBtn('建築', 'B', 'house', 'build'),
    mkMenuBtn('マップ', 'M', 'map', 'map'),
    mkMenuBtn('日誌', 'J', 'journal', 'journal'),
    mkMenuBtn('メニュー', 'Esc', null, 'menu'));

  const hintEl = h('div', { class: 'hint', role: 'status' });
  const slotEls = [];
  const hotbar = h('div', { class: 'hotbar', role: 'toolbar', 'aria-label': 'ホットバー' });
  for (let i = 0; i < BALANCE.items.hotbarSlots; i++) {
    const b = h('button', {
      class: 'hslot empty', type: 'button', tabindex: '-1', 'aria-label': `ホットバー${i + 1}`,
      onclick: () => { api.useHotbar(i); api.focusCanvas(); },
    });
    slotEls.push(b);
    hotbar.append(b);
  }
  const toastBox = h('div', { class: 'hud-bl', 'aria-live': 'polite' });
  const label = h('div', { class: 'target-label', hidden: true });
  const bossName = h('span'), bossFill = h('i');
  const bossBar = h('div', { class: 'boss-bar', hidden: true, role: 'img' }, bossName, h('div', { class: 'bar boss' }, bossFill));
  const hud = h('div', { class: 'hud' },
    h('div', { class: 'hud-tl' }, hpBar, foodBar, clock),
    bossBar,
    h('div', { class: 'hud-tr' }, h('div', { class: 'clock-row' }, objective), menuBtns),
    h('div', { class: 'hud-bc' }, hintEl, hotbar),
    toastBox);

  // 建築中の案内と操作ボタン(タッチにも使う)
  const buildLabel = h('div', { class: 'build-label', role: 'status' });
  const bbtn = (text, title, fn, cls = '') => h('button', {
    class: `btn bb ${cls}`, type: 'button', tabindex: '-1', title, text,
    onpointerdown: (e) => e.preventDefault(),
    onclick: () => { fn(); },
  });
  const buildBar = h('div', { class: 'buildbar', hidden: true },
    buildLabel,
    h('div', { class: 'bb-row' },
      bbtn('置く', '設置・確定', () => api.input.confirm(), 'primary'),
      bbtn('回転 R', '回転', () => api.input.rotate()),
      bbtn('壊す X', '取り壊し', () => api.input.demolish()),
      bbtn('解除', '建築をやめる（右クリック / Esc）', () => api.input.cancel())));

  const saveIcon = h('div', { class: 'save-flash', 'aria-hidden': 'true' }, iconEl('journal'), h('span', { text: '保存' }));

  /* ---- タッチ操作 ---- */
  const JOY_R = 46, DEAD = 0.2;
  const knob = h('div', { class: 'joy-knob' });
  const joy = h('div', { class: 'joy', 'aria-hidden': 'true' }, h('div', { class: 'joy-base' }), knob);
  let joyId = null, joyCx = 0, joyCy = 0;
  function joyUpdate(e) {
    const dx = e.clientX - joyCx, dy = e.clientY - joyCy;
    const len = Math.hypot(dx, dy);
    const k = Math.min(1, len / JOY_R);
    const nx = len > 1e-3 ? dx / len : 0, ny = len > 1e-3 ? dy / len : 0;
    const mag = k < DEAD ? 0 : (k - DEAD) / (1 - DEAD);
    api.input.move(nx * mag, ny * mag);
    knob.style.transform = `translate(${(nx * k * JOY_R).toFixed(1)}px, ${(ny * k * JOY_R).toFixed(1)}px)`;
  }
  function joyReset() {
    if (joyId == null && !knob.style.transform) return;
    joyId = null; knob.style.transform = '';
    api.input.move(0, 0);
  }
  joy.addEventListener('pointerdown', (e) => {
    if (joyId != null) return;
    e.preventDefault();
    joyId = e.pointerId;
    try { joy.setPointerCapture(e.pointerId); } catch (err) { /* キャプチャできなくても動く */ }
    const r = joy.getBoundingClientRect();
    joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2;
    joyUpdate(e);
  });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) { e.preventDefault(); joyUpdate(e); } });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    joy.addEventListener(t, (e) => { if (e.pointerId === joyId) joyReset(); });
  }

  const holdBtn = (text, cls, down, up) => {
    let pid = null;
    const b = h('button', { class: `tbtn-r ${cls}`, type: 'button', tabindex: '-1', 'aria-label': text }, text);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pid != null) return;
      pid = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      b.classList.add('down'); down();
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      b.addEventListener(t, (e) => { if (e.pointerId === pid) { pid = null; b.classList.remove('down'); if (up) up(); } });
    }
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  };
  const actBtn = holdBtn('行動', 'act', () => { api.input.actPress(); api.input.act(true); }, () => api.input.act(false));
  const dodgeBtn = holdBtn('回避', 'dodge', () => api.input.dodge());
  const touchLayer = h('div', { class: 'touch-layer', hidden: true }, joy, h('div', { class: 'tbtns' }, dodgeBtn, actBtn));

  root.append(hud, buildBar, touchLayer, saveIcon, label);

  function refreshHotbar(state) {
    const p = state.player;
    slotEls.forEach((b, i) => {
      const id = p.hotbar[i];
      b.replaceChildren();
      b.classList.toggle('empty', !id);
      b.classList.toggle('sel', p.sel === i);
      b.append(h('span', { class: 'no', text: String(i + 1) }));
      if (id) {
        b.append(itemIcon(id));
        const n = countOf(state, id);
        b.append(h('span', { class: 'cnt', text: String(n) }));
        b.title = ITEMS[id].name;
        b.setAttribute('aria-label', `ホットバー${i + 1} ${ITEMS[id].name} ${n}個`);
      } else { b.title = ''; b.setAttribute('aria-label', `ホットバー${i + 1} 空き`); }
    });
  }

  function refreshObjective() {
    const o = api.getObjective();
    const text = forInput(o.text);
    const key = text + '|' + o.items.map((x) => `${x.id}${x.have}/${x.need}`).join(',');
    if (key === lastObjKey) return;
    lastObjKey = key;
    objText.textContent = text;
    objNeed.replaceChildren(...o.items.map((x) => h('span', { class: x.have >= x.need ? 'ok' : 'lack' }, `${itemName(x.id)} ${Math.min(x.have, 99)}/${x.need}`)));
  }

  const BUILD_NAMES = { farm: '畑を耕す', plant_wheat: '灯麦の種を植える', plant_potato: '苔芋を植える', demolish: '取り壊し' };
  function refreshBuildBar(state, paused) {
    const bs = api.getBuildState();
    const on = !paused && !titleEl && bs.active;
    buildBar.hidden = !on;
    app.classList.toggle('building', on);
    if (!on) { last.build = ''; return; }
    const pv = state.preview;
    const name = BUILD_NAMES[bs.type] || (STRUCTURES[bs.type] ? STRUCTURES[bs.type].name : '建築');
    const ok = !pv || pv.ok !== false;
    const key = `${name}|${ok}|${pv ? pv.reason : ''}|${bs.rot}`;
    if (key === last.build) return;
    last.build = key;
    buildLabel.classList.toggle('bad', !ok);
    buildLabel.replaceChildren(h('b', { text: name }), '　', ok ? '置けます' : `置けません：${pv.reason || ''}`, bs.rot ? `　向き ${['上', '右', '下', '左'][bs.rot]}` : '');
  }

  function updateHud(state, paused) {
    const p = state.player;
    const hp = Math.round(p.hp), food = Math.round(p.satiety);
    if (hp !== last.hp) {
      last.hp = hp; hpFill.style.width = `${Math.max(0, Math.min(100, hp / BALANCE.player.hpMax * 100))}%`;
      hpNum.textContent = `HP ${hp}`; hpBar.classList.toggle('low', hp <= 30);
    }
    if (food !== last.food) {
      last.food = food; foodFill.style.width = `${Math.max(0, Math.min(100, food / BALANCE.hunger.max * 100))}%`;
      foodNum.textContent = `満腹 ${food}`;
    }
    const len = BALANCE.day.length;
    const tod = Math.floor(state.time.clock % len);
    if (tod !== last.tod || state.time.day !== last.day) {
      last.tod = tod; last.day = state.time.day;
      clockHand.style.left = `${(tod / len * 100).toFixed(1)}%`;
      const hour = (6 + tod / len * 24) % 24;
      const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60 / 10) * 10;
      clockText.textContent = `${state.time.day}日目 ${hh}:${String(mm).padStart(2, '0')}`;
    }
    if (state.rev !== lastRev || p.sel !== lastSel) { refreshHotbar(state); }
    const now = performance.now();
    if (now - lastObjAt > 250 || state.rev !== lastRev) { lastObjAt = now; refreshObjective(); }

    const b = state.boss;
    if (b && b.hp > 0) {
      const key = `${b.name}|${Math.ceil(b.hp)}`;
      if (key !== last.boss) {
        last.boss = key;
        bossName.textContent = b.name || 'ボス';
        bossFill.style.width = `${Math.max(0, Math.min(100, b.hp / (b.maxHp || b.hp) * 100))}%`;
        bossBar.setAttribute('aria-label', `${b.name || 'ボス'} 残り${Math.ceil(b.hp)}`);
      }
      bossBar.hidden = false;
    } else { bossBar.hidden = true; last.boss = ''; }
    // 交戦中は右上の目標を隠し、ボス体力バーと重ならないようにする(配置はCSSの .boss-fight)
    app.classList.toggle('boss-fight', !bossBar.hidden);

    refreshBuildBar(state, paused);

    const f = state.focus;
    if (!f || paused || state.preview) { label.hidden = true; return; }
    const pos = api.worldToScreen(f.x, f.y - 6);
    const txt = f.ok ? `${f.verb}${f.name ? `　${f.name}` : ''}` : f.reason;
    const key = `${f.key}|${txt}|${f.ok}`;
    if (label.dataset.k !== key) {
      label.dataset.k = key;
      label.classList.toggle('bad', !f.ok);
      label.replaceChildren(f.ok ? h('kbd', { text: f.key }) : '', ' ', txt);
    }
    label.hidden = false;
    const width = label.offsetWidth, height = label.offsetHeight;
    const player = api.worldToScreen(state.player.x, state.player.y);
    const head = api.worldToScreen(state.player.x, state.player.y - 42);
    if (pos.x + width / 2 > player.x - 22 && pos.x - width / 2 < player.x + 22 &&
        pos.y > head.y && pos.y - height < player.y + 8) pos.y = head.y - 8;
    label.style.left = `${Math.round(Math.max(width / 2 + 8, Math.min(app.clientWidth - width / 2 - 8, pos.x)))}px`;
    label.style.top = `${Math.round(Math.max(height + 8, pos.y))}px`;
  }

  /* ---------------------------------------------------------------- 通知・保存表示 */
  function toast(text, tone = 'info', opts = {}) {
    const now = performance.now();
    if (opts.key) {
      const ex = toasts.find((t) => t.key === opts.key && now - t.born < 2200);
      if (ex) {
        ex.n += opts.n || 1;
        ex.textEl.textContent = ex.label(ex.n);
        ex.born = now;
        schedule(ex);
        return;
      }
    }
    const textEl = h('span', { text });
    const el = h('div', { class: `toast ${tone}` }, opts.icon ? itemIcon(opts.icon) : '', textEl);
    const t = { el, textEl, key: opts.key, n: opts.n || 1, label: opts.label || (() => text), born: now, t1: 0, t2: 0 };
    toasts.push(t);
    toastBox.prepend(el);
    while (toasts.length > 3) remove(toasts[0]);
    schedule(t);
  }
  function schedule(t) {
    clearTimeout(t.t1); clearTimeout(t.t2);
    t.el.classList.remove('out');
    t.t1 = setTimeout(() => t.el.classList.add('out'), 3000);
    t.t2 = setTimeout(() => remove(t), 3500);
  }
  function remove(t) {
    clearTimeout(t.t1); clearTimeout(t.t2);
    t.el.remove();
    const i = toasts.indexOf(t);
    if (i >= 0) toasts.splice(i, 1);
  }
  // タッチ操作中は、キーボード前提の文言をスティック・ボタンの説明へ置き換える
  const TOUCH_TEXT = [
    [/WASD \/ 矢印キーで歩けます/, '左下のスティックで歩けます'],
    [/E か左クリックで拾おう/, '「行動」ボタンで拾おう'],
    [/地面をクリック（Eキー）で置こう/, '場所をタップして「置く」で置こう'],
    [/Shift で回避/, '「回避」ボタンで回避'],
    [/^C で制作画面を開き/, 'メニューの制作画面を開き'],
    [/^C で制作画面。/, 'メニューから制作画面を開こう。'],
  ];
  function forInput(text) {
    if (!app.classList.contains('touch')) return text;
    return TOUCH_TEXT.reduce((t, [re, to]) => t.replace(re, to), text);
  }
  function showHint(text) {
    hintEl.textContent = forInput(text);
    hintEl.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hintEl.classList.remove('show'), 7000);
  }
  function showSaveError(text) {
    let bar = root.querySelector('.save-error');
    if (!bar) {
      bar = h('div', { class: 'save-error', role: 'alert' },
        h('span', { class: 'msg' }),
        h('button', { class: 'btn sm', type: 'button', text: '書き出す', onclick: () => api.exportSave() }),
        h('button', { class: 'btn sm', type: 'button', text: 'もう一度保存', onclick: () => api.saveNow() }));
      root.append(bar);
    }
    bar.querySelector('.msg').textContent = text || '保存に失敗しました。書き出しを推奨します';
    app.classList.add('save-failed');
    app.style.setProperty('--sebar', `${bar.offsetHeight}px`);
  }
  function clearSaveError() {
    const bar = root.querySelector('.save-error');
    if (bar) bar.remove();
    app.classList.remove('save-failed');
    app.style.removeProperty('--sebar');
  }
  function flashSave() {
    saveIcon.classList.remove('on');
    void saveIcon.offsetWidth;
    saveIcon.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => saveIcon.classList.remove('on'), 800);
  }

  function handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'gain') {
        const def = ITEMS[ev.item];
        if (def) toast(`${def.name} ×${ev.n}`, 'info', { key: `gain:${ev.item}`, n: ev.n, icon: ev.item, label: (n) => `${def.name} ×${n}` });
      } else if (ev.type === 'msg') toast(ev.text, ev.tone || 'info');
      else if (ev.type === 'hint') { if (settings.hints) showHint(ev.text); }
      else if (ev.type === 'open') open(ev.panel, ev);
      else if (ev.type === 'ending') showEnding();
      else if (ev.type === 'light') toast(`${LIGHTS[ev.id] ? LIGHTS[ev.id].name : '灯'}が戻った`, 'good');
      else if (ev.type === 'bossStart') toast(`${BOSSES[ev.id] ? BOSSES[ev.id].name : 'ボス'}が目を覚ました`, 'warn');
      else if (ev.type === 'bossDead') toast(`${BOSSES[ev.id] ? BOSSES[ev.id].name : 'ボス'}を鎮めた`, 'good');
      else if (ev.type === 'death') toast('倒れた。素材は資源袋に残っている（マップで場所を確認できる）', 'warn');
    }
  }

  /* ---------------------------------------------------------------- ダイアログ基盤 */
  function focusables(root_) {
    return [...root_.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), canvas[tabindex="0"], [tabindex="0"]')].filter((e) => !e.hidden && e.offsetParent !== null);
  }
  function trapTab(modal, dialog) {
    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const list = focusables(dialog);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], lastEl = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && (document.activeElement === lastEl || !dialog.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    });
  }

  function open(name, payload) {
    const builder = DIALOGS[name];
    if (!builder || ending || layer || (titleEl && name !== 'settings' && name !== 'controls')) return;
    if (current) close(false);
    joyReset();
    const d = builder(payload || {});
    const closeBtn = h('button', { class: 'x', type: 'button', 'aria-label': '閉じる', text: '✕', onclick: () => close() });
    const dialog = h('section', { class: `dialog d-${name}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': d.title },
      h('header', {}, h('h2', { text: d.title }), closeBtn),
      h('div', { class: 'body' }, d.node),
      d.foot ? h('div', { class: 'foot', text: d.foot }) : null);
    const modal = h('div', { class: 'modal-back' }, dialog);
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
    trapTab(modal, dialog);
    root.append(modal);
    current = { name, d, modal, dialog };
    d.refresh(api.getState(), true);
    lastRev = api.getState().rev;
    label.hidden = true;
    api.sfx('ui');
    const target = (d.focusFirst && d.focusFirst()) || focusables(dialog.querySelector('.body'))[0] || closeBtn;
    target.focus();
  }

  function close(refocus = true) {
    if (!current) return;
    current.modal.remove();
    current = null;
    if (!refocus) return;
    const first = titleEl && titleEl.querySelector('button:not(:disabled)');
    if (first) first.focus(); else api.focusCanvas();
  }

  function toggle(name) {
    if (current && current.name === name) { close(); return true; }
    if (current) return false;
    open(name);
    return true;
  }

  // 確認・お知らせ。別のダイアログの上に重ね、結果をPromiseで返す
  function showLayer({ title, lines = [], actions }) {
    if (layer) finishLayer(layer.cancelValue);
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      joyReset();
      const cancel = actions.find((a) => a.cancel);
      const btns = actions.map((a) => h('button', {
        class: `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`, type: 'button', text: a.label,
        onclick: () => finishLayer(a.value),
      }));
      const dialog = h('section', { class: 'dialog d-layer', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
        h('header', {}, h('h2', { text: title })),
        h('div', { class: 'body' }, h('div', { class: 'layer-text' }, lines.map((l) => (l === '' ? h('div', { class: 'gap' }) : h('p', { text: l }))))),
        h('div', { class: 'layer-btns' }, btns));
      const modal = h('div', { class: 'modal-back layer' }, dialog);
      trapTab(modal, dialog);
      root.append(modal);
      layer = { modal, resolve, cancelValue: cancel ? cancel.value : null, prevFocus };
      label.hidden = true;
      // 取り返しのつかない操作は、やめる側に最初のフォーカスを置く
      const safe = actions.findIndex((a) => a.cancel);
      const dangerous = actions.some((a) => a.danger);
      (btns[dangerous && safe >= 0 ? safe : actions.findIndex((a) => a.primary) >= 0 ? actions.findIndex((a) => a.primary) : 0]).focus();
    });
  }
  function finishLayer(value) {
    if (!layer) return;
    const l = layer;
    layer = null;
    l.modal.remove();
    l.resolve(value);
    const back = l.prevFocus;
    if (back && document.contains(back) && back !== document.body) back.focus();
    else if (current) { const t = focusables(current.dialog)[0]; if (t) t.focus(); }
    else if (titleEl) { const t = titleEl.querySelector('button:not(:disabled)'); if (t) t.focus(); }
    else api.focusCanvas();
  }
  ui.confirm = (o) => showLayer({
    title: o.title, lines: o.lines,
    actions: [
      { label: o.cancelLabel || 'やめる', value: false, cancel: true },
      { label: o.okLabel || 'OK', value: true, primary: !o.danger, danger: !!o.danger },
    ],
  }).then((v) => v === true);
  ui.alert = (o) => showLayer({
    title: o.title, lines: o.lines,
    actions: o.actions || [{ label: '閉じる', value: 'close', primary: true, cancel: true }],
  });

  /* ---------------------------------------------------------------- バッグ */
  function buildBag() {
    let sel = 0;
    let carry = null;
    const bagSlots = [];
    const grid = h('div', { class: 'bag-grid', role: 'grid', 'aria-label': 'バッグ' });
    const detail = h('div', { class: 'detail', 'aria-live': 'polite' });
    const equipBox = h('div', {});
    const toolsBox = h('div', { class: 'tools-row' });
    const statBox = h('div', {});

    for (let i = 0; i < BALANCE.items.bagSlots; i++) {
      const b = h('button', { class: 'slot', type: 'button', tabindex: i === 0 ? '0' : '-1', data: { i: String(i) } });
      b.addEventListener('click', () => {
        if (carry != null) { api.swapBag(carry, i); carry = null; }
        sel = i;
        d.refresh(api.getState());
      });
      b.addEventListener('keydown', (e) => {
        const cols = 6;
        let n = null;
        if (e.key === 'ArrowRight') n = i + 1; else if (e.key === 'ArrowLeft') n = i - 1;
        else if (e.key === 'ArrowDown') n = i + cols; else if (e.key === 'ArrowUp') n = i - cols;
        if (n != null) {
          e.preventDefault();
          if (n >= 0 && n < bagSlots.length) { sel = n; d.refresh(api.getState()); bagSlots[n].focus(); }
        }
      });
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      b.addEventListener('dragover', (e) => { e.preventDefault(); b.classList.add('drop-over'); });
      b.addEventListener('dragleave', () => b.classList.remove('drop-over'));
      b.addEventListener('drop', (e) => {
        e.preventDefault(); b.classList.remove('drop-over');
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (Number.isInteger(from)) { api.swapBag(from, i); sel = i; d.refresh(api.getState()); }
      });
      bagSlots.push(b);
      grid.append(b);
    }

    const EQUIP = [['weapon', '武器'], ['armor', '防具'], ['trinket', '装飾']];

    const d = {
      title: 'バッグ',
      foot: '矢印キーで選択 / Enterで決定 / ドラッグで入れ替え / Escで閉じる',
      node: h('div', { class: 'bag-layout' }, grid,
        h('div', { class: 'side' },
          h('div', {}, h('h3', { text: '装備' }), equipBox, statBox),
          h('div', {}, h('h3', { text: '道具（自動で使われます）' }), toolsBox),
          h('div', {}, h('h3', { text: '詳細' }), detail))),
      focusFirst: () => bagSlots[sel],
      refresh(state) {
        const p = state.player;
        bagSlots.forEach((b, i) => {
          const s = p.bag[i];
          b.replaceChildren();
          b.draggable = !!s;
          b.classList.toggle('sel', i === sel);
          b.classList.toggle('carry', i === carry);
          b.tabIndex = i === sel ? 0 : -1;
          if (s) {
            const def = ITEMS[s.id];
            b.append(itemIcon(s.id));
            if (s.n > 1) b.append(h('span', { class: 'cnt', text: String(s.n) }));
            b.title = def.name;
            b.setAttribute('aria-label', `${def.name} ${s.n}個`);
          } else { b.title = ''; b.setAttribute('aria-label', `空きスロット${i + 1}`); }
        });
        equipBox.replaceChildren(...EQUIP.map(([k, jp]) => {
          const id = p.equip[k];
          const btn = h('button', {
            class: 'slot', type: 'button', title: id ? `${ITEMS[id].name}（クリックで外す）` : `${jp}なし`,
            'aria-label': id ? `${jp} ${ITEMS[id].name}。クリックで外す` : `${jp}なし`,
            onclick: () => { if (id) { api.unequip(k); d.refresh(api.getState()); } },
          }, id ? itemIcon(id) : '');
          return h('div', { class: 'equip-row' }, btn, h('span', { class: 'lbl', text: jp }), h('span', { class: 'val', text: id ? ITEMS[id].name : '—' }));
        }));
        const wdmg = p.equip.weapon ? ITEMS[p.equip.weapon].weapon.dmg : 2;
        let def = 0;
        if (p.equip.armor) def += ITEMS[p.equip.armor].armor.def;
        if (p.equip.trinket && ITEMS[p.equip.trinket].trinket.def) def += ITEMS[p.equip.trinket].trinket.def;
        statBox.replaceChildren(h('div', { class: 'stat' }, h('span', { text: '攻撃力' }), h('span', { text: String(wdmg) })), h('div', { class: 'stat' }, h('span', { text: '被ダメージ軽減' }), h('span', { text: `−${def}` })));
        toolsBox.replaceChildren(...['axe', 'pick', 'hoe'].map((k) => {
          const tier = p.tools[k];
          const it = Object.values(ITEMS).find((x) => x.tool === k && x.tier === tier);
          return h('span', { class: `tool-chip${tier ? '' : ' none'}` }, it ? itemIcon(it.id) : '', it ? it.name : `${TOOL_LABEL[k]}なし`);
        }));
        // 詳細
        const s = p.bag[sel];
        if (!s) {
          detail.replaceChildren(h('div', { class: 'ds', text: carry != null ? '移動先のスロットを選んでください' : '空きスロット' }));
          return;
        }
        const idef = ITEMS[s.id];
        const acts = h('div', { class: 'acts' });
        if (idef.eat) acts.append(h('button', { class: 'btn sm', type: 'button', text: '食べる', onclick: () => { api.eat(s.id); close(); } }));
        if (idef.equip) acts.append(h('button', { class: 'btn sm', type: 'button', text: '装備する', onclick: () => { api.equipFromBag(sel); d.refresh(api.getState()); } }));
        if (idef.eat || idef.place) {
          acts.append(h('button', {
            class: 'btn sm', type: 'button', text: 'ホットバーへ',
            onclick: () => {
              const st = api.getState();
              const hb = st.player.hotbar;
              let idx = hb.indexOf(s.id);
              if (idx < 0) idx = hb.indexOf(null);
              if (idx < 0) idx = st.player.sel >= 0 ? st.player.sel : hb.length - 1;
              api.assignHotbar(idx, s.id);
              toast(`ホットバー${idx + 1}に入れた`, 'info');
              d.refresh(api.getState());
            },
          }));
        }
        acts.append(h('button', { class: 'btn sm', type: 'button', text: '移動', onclick: () => { carry = sel; d.refresh(api.getState()); } }));
        if (!idef.key) acts.append(h('button', { class: 'btn sm', type: 'button', text: '捨てる', onclick: () => { api.dropItem(sel); d.refresh(api.getState()); } }));
        detail.replaceChildren(
          h('div', { class: 'nm', text: `${idef.name}${s.n > 1 ? ` ×${s.n}` : ''}` }),
          h('div', { class: 'ds', text: `${CATEGORIES[idef.cat] || ''}　${idef.desc || ''}` }),
          acts);
      },
    };
    return d;
  }

  /* ---------------------------------------------------------------- 制作 */
  function buildCraft(payload) {
    const stationToTab = (s) => (s === 'campfire' ? 'pot' : s);
    let tab = null;
    let selId = null;
    let times = 1;
    let sig = '';
    const chips = h('div', { class: 'station-chips' });
    const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    const list = h('div', { class: 'recipe-list', role: 'listbox', 'aria-label': 'レシピ' });
    const right = h('div', { class: 'craft-right', 'aria-live': 'polite' });

    const tabHere = (stations, id) => (id === 'pot' ? stations.has('pot') || stations.has('campfire') : stations.has(id));

    function recipesOf(tabId) {
      return RECIPES.filter((r) => r.station === tabId);
    }

    const d = {
      title: '制作',
      foot: '設備から3タイル以内で作れます / ↑↓で選択 / Escで閉じる',
      node: h('div', { class: 'craft-layout' }, h('div', { class: 'craft-left' }, chips, tabsEl, list), right),
      focusFirst: () => list.querySelector('[aria-selected="true"]') || list.querySelector('button'),
      refresh(state, force) {
        const stations = api.nearbyStations();
        const stSig = STATION_TABS.map((t) => (tabHere(stations, t.id) ? 1 : 0)).join('');
        if (tab == null) {
          tab = payload && payload.station ? stationToTab(payload.station) : (stations.has('workbench') ? 'workbench' : 'hand');
          if (!STATION_TABS.some((t) => t.id === tab)) tab = 'hand';
        }
        const rs = recipesOf(tab);
        if (!selId || !rs.some((r) => r.id === selId)) selId = rs[0] ? rs[0].id : null;
        const newSig = `${tab}|${selId}|${times}|${state.rev}|${stSig}`;
        if (!force && newSig === sig) return;
        sig = newSig;
        const activeKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
        const scroll = list.scrollTop;

        chips.replaceChildren(h('span', { text: '近くの設備:' }),
          ...STATION_TABS.filter((t) => tabHere(stations, t.id)).map((t) => h('span', { class: 'chip on', text: t.name })));
        tabsEl.replaceChildren(...STATION_TABS.map((t) => {
          const near = tabHere(stations, t.id);
          const dot = near && t.id !== 'hand' ? h('span', { class: 'dot', title: '近くにあります' }) : null;
          return h('button', {
            class: 'tab', type: 'button', role: 'tab', 'aria-selected': t.id === tab ? 'true' : 'false', data: { fk: `tab-${t.id}` },
            onclick: () => { tab = t.id; selId = null; d.refresh(api.getState()); },
          }, t.name, dot);
        }));

        const rows = rs.map((r) => {
          const st = api.recipeStatus(r, stations);
          const def = ITEMS[r.out];
          const known = st.known;
          const cls = ['rrow'];
          if (!known) cls.push('locked'); else if (!st.atStation || st.owned) cls.push('dim');
          return h('button', {
            class: cls.join(' '), type: 'button', role: 'option', 'aria-selected': r.id === selId ? 'true' : 'false', data: { fk: `r-${r.id}`, id: r.id },
            tabindex: r.id === selId ? '0' : '-1',
            onclick: () => { selId = r.id; d.refresh(api.getState()); },
            onkeydown: (e) => {
              const i = rs.findIndex((x) => x.id === r.id);
              let n = null;
              if (e.key === 'ArrowDown') n = i + 1; else if (e.key === 'ArrowUp') n = i - 1;
              if (n != null && n >= 0 && n < rs.length) {
                e.preventDefault(); selId = rs[n].id; d.refresh(api.getState());
                const el = list.querySelector(`[data-fk="r-${rs[n].id}"]`); if (el) el.focus();
              }
            },
          }, known ? itemIcon(r.out) : iconEl('bag'),
          h('span', { class: 'nm', text: known ? def.name + (r.n > 1 ? ` ×${r.n}` : '') : '？？？' }),
          known && st.owned ? h('span', { class: 'ok', text: '所持' }) : (known && st.canMake && st.atStation ? h('span', { class: 'ok', text: '作れる' }) : ''));
        });
        list.replaceChildren(...rows);
        list.scrollTop = scroll;

        // 詳細
        const r = rs.find((x) => x.id === selId);
        if (!r) { right.replaceChildren(h('div', { class: 'note', text: 'レシピがありません' })); return; }
        const st = api.recipeStatus(r, stations);
        const def = ITEMS[r.out];
        if (!st.known) {
          right.replaceChildren(h('div', { class: 'craft-head' }, iconEl('bag'), h('span', { class: 'nm', text: '？？？' })),
            h('div', { class: 'note', text: '材料をまだ見つけていない。集めるうちに作り方がわかる。' }));
        } else {
          const need = st.atStation ? '' : `${r.stations.map((s) => STATIONS[s].name).join('か')}の近くで作れます`;
          const mats = Object.entries(r.inputs).map(([id, n]) => {
            const have = st.have[id];
            const lack = have < n * (def.tool ? 1 : times);
            return h('div', { class: `mat${lack ? ' lack' : ''}` }, itemIcon(id), h('span', { class: 'nm', text: ITEMS[id].name }), h('span', { class: 'n', text: `${have} / ${n * (def.tool ? 1 : times)}` }));
          });
          const canNow = st.atStation && !st.owned && Object.entries(r.inputs).every(([id, n]) => st.have[id] >= n * (def.tool ? 1 : times));
          const btn = (n) => h('button', {
            class: `btn${n === times ? ' primary' : ''}`, type: 'button', text: `×${n}を作る`, data: { fk: `make-${n}` },
            disabled: !canNow || st.owned || (!!def.tool && n > 1),
            onclick: () => { times = n; api.craft(r.id, n); d.refresh(api.getState(), true); },
          });
          right.replaceChildren(
            h('div', { class: 'craft-head' }, itemIcon(r.out), h('div', {}, h('div', { class: 'nm', text: def.name + (r.n > 1 ? ` ×${r.n}` : '') }), h('div', { class: 'note', text: def.desc || '' }))),
            h('div', { class: 'mats' }, mats),
            h('div', { class: `note${need || st.owned ? ' warn' : ''}`, text: st.owned ? 'すでに持っている（自動で使われます）' : need || (canNow ? '材料はそろっています' : '材料が足りません') }),
            h('div', { class: 'craft-btns' }, btn(1), btn(5)));
        }
        if (activeKey) {
          const el = dialogEl().querySelector(`[data-fk="${activeKey}"]`);
          if (el && el !== document.activeElement) el.focus();
        }
      },
    };
    return d;
  }

  function dialogEl() { return current ? current.dialog : document.body; }

  /* ---------------------------------------------------------------- 建築 */
  const BUILD_TABS = [
    { id: 'floor', name: '床・道', ids: ['floor_wood', 'path_stone'] },
    { id: 'wall', name: '壁・扉・柵', ids: ['wall_wood', 'door_wood', 'fence_wood'] },
    { id: 'furniture', name: '家具', ids: ['bed', 'chest_wood', 'table', 'chair', 'workbench', 'furnace', 'pot'] },
    { id: 'light', name: '灯', ids: ['torch', 'candlestick', 'lantern_stone'] },
    { id: 'farm', name: '畑', farm: true },
  ];
  const HOUSE_RULES = [
    '壁と扉だけで囲まれた室内（柵は壁になりません）',
    '室内は3×3以上64マス以下で、すべて床',
    'ベッド1つ、扉1つ以上、燭台か灯籠1つを含む',
  ];
  const ROT_NAMES = ['上', '右', '下', '左'];

  function buildBuild() {
    let tab = 'floor';
    let note = '';
    const tabsEl = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '建築の種類' });
    const grid = h('div', { class: 'bgrid' });
    const guide = h('div', { class: 'farm-guide' });
    const noteEl = h('div', { class: 'note warn', role: 'alert' });
    const tools = h('div', { class: 'bb-tools' });
    const houseBox = h('div', { class: 'house-box' });

    const entriesOf = (state, t) => {
      if (t.farm) {
        const p = state.player;
        const seeds = countOf(state, 'wheat_seed'), potatoes = countOf(state, 'moss_potato');
        return [
          { type: 'farm', name: '畑を耕す', icon: 'pickaxe', ok: p.tools.hoe > 0, lack: '石の鍬が必要です（作業台のそばでCから制作）', desc: '地面を耕して畑にします' },
          { type: 'plant_wheat', name: '灯麦の種を植える', icon: ITEMS.wheat_seed.icon, count: seeds, ok: seeds > 0, lack: '灯麦の種がありません（草を刈ると手に入ります）', desc: '耕した畑に植えます' },
          { type: 'plant_potato', name: '苔芋を植える', icon: ITEMS.moss_potato.icon, count: potatoes, ok: potatoes > 0, lack: '苔芋がありません（野生の苔芋を掘りましょう）', desc: '耕した畑に植えます' },
        ];
      }
      return t.ids.map((id) => {
        const n = countOf(state, id);
        return { type: id, name: ITEMS[id].name, icon: ITEMS[id].icon, count: n, ok: n > 0, lack: `${ITEMS[id].name}を持っていません（Cで制作）`, desc: ITEMS[id].desc };
      });
    };

    function hintFor(type) {
      const touch = app.classList.contains('touch');
      if (type === 'demolish') return touch ? '壊したい物をタップして「置く」で取り壊し' : '壊したい物をクリック。右クリック / Escで解除';
      if (type === 'farm') return touch ? '耕したい場所をタップして「置く」' : '地面をクリックして耕す。右クリック / Escで解除';
      if (type.startsWith('plant_')) return touch ? '耕した畑をタップして「置く」で植える' : '耕した畑をクリックして植える。右クリック / Escで解除';
      return touch ? '場所をタップして「置く」で設置。回転や解除は下のボタン' : 'クリックで設置 / R 回転 / X 取り壊し / 右クリックで解除';
    }

    function choose(e) {
      note = '';
      if (!e.ok) { note = e.lack; api.sfx('error'); d.refresh(api.getState(), true); focusKey(`b-${e.type}`); return; }
      const r = api.selectBuild(e.type);
      if (r && r.ok === false) { note = r.reason || '選べませんでした'; api.sfx('error'); d.refresh(api.getState(), true); focusKey(`b-${e.type}`); return; }
      close();
      showHint(hintFor(e.type));
    }
    function focusKey(k) {
      const el = dialogEl().querySelector(`[data-fk="${k}"]`);
      if (el) el.focus();
    }

    const d = {
      title: '建築',
      foot: '選ぶとゲームに戻り、緑のプレビューが置ける場所です / Escで閉じる',
      node: h('div', { class: 'build-layout' }, tabsEl, noteEl, grid, guide, tools, houseBox),
      focusFirst: () => tabsEl.querySelector('[aria-selected="true"]'),
      refresh(state) {
        const activeKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
        const bs = api.getBuildState();
        tabsEl.replaceChildren(...BUILD_TABS.map((t) => h('button', {
          class: 'tab', type: 'button', role: 'tab', 'aria-selected': t.id === tab ? 'true' : 'false', tabindex: t.id === tab ? '0' : '-1', data: { fk: `bt-${t.id}` },
          onclick: () => { tab = t.id; note = ''; d.refresh(api.getState()); focusKey(`bt-${t.id}`); },
          onkeydown: (ev) => {
            const i = BUILD_TABS.findIndex((x) => x.id === tab);
            let n = null;
            if (ev.key === 'ArrowRight') n = (i + 1) % BUILD_TABS.length; else if (ev.key === 'ArrowLeft') n = (i - 1 + BUILD_TABS.length) % BUILD_TABS.length;
            if (n != null) { ev.preventDefault(); tab = BUILD_TABS[n].id; note = ''; d.refresh(api.getState()); focusKey(`bt-${tab}`); }
          },
        }, t.name)));
        const t = BUILD_TABS.find((x) => x.id === tab);
        noteEl.textContent = note;
        grid.replaceChildren(...entriesOf(state, t).map((e) => h('button', {
          class: `bcard${e.ok ? '' : ' lack'}${bs.type === e.type ? ' sel' : ''}`, type: 'button', data: { fk: `b-${e.type}` },
          'aria-label': `${e.name}${e.count != null ? `、${e.count}個` : ''}${e.ok ? '' : `。${e.lack}`}`,
          onclick: () => choose(e),
        }, iconEl(e.icon),
        h('span', { class: 'bn' }, h('span', { class: 'nm', text: e.name }), h('span', { class: 'ds', text: e.ok ? e.desc : e.lack })),
        e.count != null ? h('span', { class: 'bc', text: `×${e.count}` }) : '')));

        // 畑の流れ
        if (t.farm) {
          const farms = (state.farmland || []).length;
          const crops = state.crops || [];
          const ripe = crops.filter((c) => CROPS[c.kind] && c.growth >= CROPS[c.kind].stages * CROPS[c.kind].stageTime).length;
          const step = (done, text) => h('li', { class: done ? 'done' : '' }, h('span', { class: 'mark', text: done ? '✔' : '・' }), text);
          guide.replaceChildren(h('h3', { text: '畑の流れ' }), h('ol', {},
            step(farms > 0, `① 鍬で耕す（耕した畑 ${farms}区画）`),
            step(crops.length > 0, `② 灯麦の種か苔芋を植える（育成中 ${crops.length}本）`),
            step(false, `③ 熟した作物に近づいて、素手で収穫する（熟した作物 ${ripe}本）`)),
          h('div', { class: 'ds', text: '畑は地上でだけ育ちます。燭台・灯籠・たいまつの近くでは成長が早くなります。' }));
          guide.hidden = false;
        } else { guide.replaceChildren(); guide.hidden = true; }

        tools.replaceChildren(
          h('button', { class: `btn${bs.type === 'demolish' ? ' primary' : ''}`, type: 'button', text: '取り壊し（X）', data: { fk: 'b-demolish' }, onclick: () => choose({ type: 'demolish', ok: true }) }),
          h('button', { class: 'btn', type: 'button', text: `回転（R）：向き ${ROT_NAMES[bs.rot || 0]}`, data: { fk: 'b-rotate' }, onclick: () => { api.input.rotate(); d.refresh(api.getState()); focusKey('b-rotate'); } }),
          h('button', { class: 'btn', type: 'button', text: '建築をやめる', data: { fk: 'b-cancel' }, onclick: () => { api.input.cancel(); d.refresh(api.getState()); } }));

        // 家の成立状況
        const hs = api.getHouseStatus();
        houseBox.replaceChildren(
          h('h3', { text: `家の状況　${hs.valid} / ${hs.total} 軒が成立` }),
          hs.total === 0
            ? h('div', { class: 'ds', text: 'まだ家になりそうな囲いがありません。下の条件を満たすと、屋根が自動でかかります。' })
            : h('ul', { class: 'house-list' }, (hs.houses || []).map((x, i) => h('li', { class: x.valid ? 'done' : 'bad' },
              h('span', { class: 'mark', text: x.valid ? '✔' : '✖' }),
              h('span', { text: `家${i + 1}：${x.valid ? '成立' : `不成立 — ${(x.reasons && x.reasons.length ? x.reasons : ['条件を満たしていません']).join('、')}`}` })))),
          h('div', { class: 'ds', text: '成立の条件' }),
          h('ul', { class: 'rules' }, HOUSE_RULES.map((r) => h('li', { text: r }))));

        if (activeKey) {
          const el = dialogEl().querySelector(`[data-fk="${activeKey}"]`);
          if (el && el !== document.activeElement) el.focus();
        }
      },
    };
    return d;
  }

  /* ---------------------------------------------------------------- 箱 */
  function buildContainer(payload) {
    const id = payload.id;
    const boxGrid = h('div', { class: 'box-grid' });
    const bagGrid = h('div', { class: 'box-grid' });
    const d = {
      title: '木の箱',
      foot: 'クリックで中身を移します / Escで閉じる',
      node: h('div', { class: 'box-layout' }, h('div', {}, h('h3', { text: '箱' }), boxGrid), h('div', {}, h('h3', { text: 'バッグ' }), bagGrid)),
      focusFirst: () => boxGrid.querySelector('button') || bagGrid.querySelector('button'),
      refresh(state) {
        const box = state.containers[id] || [];
        const mk = (s, from, i) => {
          const b = h('button', {
            class: 'slot', type: 'button', onclick: () => { if (s) { api.transfer(id, from, i); d.refresh(api.getState()); } },
            'aria-label': s ? `${ITEMS[s.id].name} ${s.n}個` : '空き',
          }, s ? itemIcon(s.id) : '', s && s.n > 1 ? h('span', { class: 'cnt', text: String(s.n) }) : '');
          if (s) b.title = ITEMS[s.id].name;
          return b;
        };
        boxGrid.replaceChildren(...box.map((s, i) => mk(s, 'box', i)));
        bagGrid.replaceChildren(...state.player.bag.map((s, i) => mk(s, 'bag', i)));
      },
    };
    return d;
  }

  /* ---------------------------------------------------------------- 日誌 */
  function buildJournal() {
    const body = h('div', { class: 'journal' });
    const reqRow = (r) => h('li', { class: r.done ? 'done' : '' },
      h('span', { class: 'mark', text: r.done ? '✔' : '・' }),
      h('span', { class: 'rt', text: r.text }),
      r.target != null ? h('span', { class: 'rn', text: `${Math.min(r.current == null ? 0 : r.current, r.target)} / ${r.target}` }) : '');
    return {
      title: '日誌',
      foot: 'Escで閉じる',
      node: body,
      focusFirst: () => null,
      refresh() {
        const j = api.getJournal();
        const o = j.objective || { text: '', items: [] };
        const cleared = !!api.getState().progress.cleared;
        const lightsDone = j.lights.filter((l) => l.done).length;
        body.replaceChildren(
          h('div', { class: 'now' }, h('div', { class: 'ds', text: '次の目的' }), h('div', { text: o.text }),
            o.items && o.items.length ? h('div', { class: 'ds', text: o.items.map((x) => `${itemName(x.id)} ${x.have}/${x.n != null ? x.n : x.need}`).join('　') }) : ''),
          h('div', {}, h('h3', { text: `三つの灯　${lightsDone} / 3` }),
            h('div', { class: 'lights' }, j.lights.map((l) => h('section', { class: `light${l.done ? ' done' : ''}` },
              h('h4', {}, h('span', { class: 'mark', text: l.done ? '✔' : '○' }), l.name, l.done ? h('small', { text: '　復元済み' }) : ''),
              h('ul', {}, (l.requirements || []).map(reqRow)))))),
          h('div', { class: cleared ? '' : 'locked' }, h('h3', { text: '暮らしの目標' }),
            cleared ? '' : h('div', { class: 'ds', text: '三つの灯をすべて戻すと、自由な暮らしの目標が始まります。' }),
            h('ul', { class: 'goals' }, (j.goals || []).map((g) => {
              const done = g.value >= g.target;
              return h('li', { class: done ? 'done' : '' },
                h('span', { class: 'mark', text: done ? '✔' : '・' }), h('span', { class: 'rt', text: g.text }),
                h('span', { class: 'rn', text: `${Math.min(g.value, g.target)} / ${g.target}` }));
            }))),
          j.story ? h('div', { class: 'ds story', text: j.story }) : '');
      },
    };
  }

  /* ---------------------------------------------------------------- 祭壇・住人・再戦 */
  const ALTAR_NAMES = { forge: '炉の祭壇', moss: '苔の祭壇', ancient: '古灯台' };

  function buildAltar(payload) {
    const id = payload.id;
    const result = h('div', { class: 'note', role: 'alert' });
    const reqBox = h('ul', { class: 'reqs' });
    const intro = h('div', { class: 'ds' });
    const actions = h('div', { class: 'layer-btns left' });
    const d = {
      title: ALTAR_NAMES[id] || '祭壇',
      foot: 'Escで閉じる',
      node: h('div', { class: 'altar' }, intro, reqBox, result, actions),
      focusFirst: () => actions.querySelector('button:not(:disabled)'),
      refresh() {
        const j = api.getJournal();
        const l = j.lights.find((x) => x.id === id);
        const name = LIGHTS[id] ? LIGHTS[id].name : '灯';
        const done = !!(l && l.done);
        intro.textContent = done ? `${name}はもう戻っています。` : `${name}を戻すための供物と条件です。そろっていれば、祭壇に捧げられます。`;
        reqBox.replaceChildren(...((l && l.requirements) || []).map((r) => h('li', { class: r.done ? 'done' : '' },
          h('span', { class: 'mark', text: r.done ? '✔' : '✖' }), h('span', { class: 'rt', text: r.text }),
          r.target != null ? h('span', { class: 'rn', text: `${Math.min(r.current == null ? 0 : r.current, r.target)} / ${r.target}` }) : '')));
        actions.replaceChildren(
          h('button', {
            class: 'btn primary', type: 'button', text: done ? '復元済み' : '捧げて灯を戻す', disabled: done, data: { fk: 'altar-go' },
            onclick: () => {
              const r = api.restoreLight(id);
              if (r && r.ok) { toast(`${name}を戻した`, 'good'); close(); return; }
              result.classList.add('warn');
              result.textContent = (r && r.reason) || 'まだ条件がそろっていません';
              api.sfx('error');
            },
          }),
          h('button', { class: 'btn', type: 'button', text: '閉じる', onclick: () => close() }));
      },
    };
    return d;
  }

  const NPC_JOBS = {
    cook: '焚き火の前で、焼き芋をときどき作ってくれます。',
    farmer: '熟した畑の作物を収穫して、同じ作物を植え直してくれます。',
    builder: '木材と石を少しずつ集めて、籠にためてくれます。',
  };
  function basketList(b) {
    if (!b) return [];
    if (Array.isArray(b)) return b.map((x) => ({ id: x.id || x.item, n: x.n })).filter((x) => x.id && x.n > 0);
    return Object.entries(b).map(([id, n]) => ({ id, n: Number(n) || 0 })).filter((x) => x.n > 0);
  }
  function buildNpc(payload) {
    const id = payload.id;
    const head = h('div', { class: 'craft-head' });
    const job = h('div', { class: 'ds' });
    const status = h('div', { class: 'note' });
    const basket = h('div', { class: 'mats' });
    const result = h('div', { class: 'note', role: 'alert' });
    const actions = h('div', { class: 'layer-btns left' });
    const d = {
      title: '住人',
      foot: 'Escで閉じる',
      node: h('div', { class: 'altar' }, head, job, status, h('h3', { text: '籠の中身' }), basket, result, actions),
      focusFirst: () => actions.querySelector('button:not(:disabled)'),
      refresh(state) {
        const npc = (state.npcs || []).find((n) => n.id === id);
        const name = npc ? npc.name : (NPCS[id] ? NPCS[id].name : '住人');
        head.replaceChildren(iconEl('house'), h('div', { class: 'nm', text: name }));
        job.textContent = NPC_JOBS[id] || '拠点で暮らしを手伝ってくれます。';
        status.classList.toggle('warn', !!npc && npc.active === false);
        status.textContent = !npc ? '' : npc.active === false ? '家が成立していないため、いまは休んでいます。' : npc.sleeping ? 'ぐっすり眠っています。' : '元気に働いています。';
        const items = basketList(npc && npc.basket);
        basket.replaceChildren(...(items.length
          ? items.map((x) => h('div', { class: 'mat' }, itemIcon(x.id), h('span', { class: 'nm', text: itemName(x.id) }), h('span', { class: 'n', text: `×${x.n}` })))
          : [h('div', { class: 'ds', text: 'いまは空っぽです。' })]));
        actions.replaceChildren(
          h('button', {
            class: 'btn primary', type: 'button', text: '受け取る', disabled: !items.length, data: { fk: 'npc-go' },
            onclick: () => {
              const r = api.collectResident(id);
              if (r && r.ok) { toast('籠の中身を受け取った', 'good'); d.refresh(api.getState()); return; }
              result.classList.add('warn');
              result.textContent = (r && r.reason) || '受け取れませんでした';
              api.sfx('error');
            },
          }),
          h('button', { class: 'btn', type: 'button', text: '閉じる', onclick: () => close() }));
      },
    };
    return d;
  }

  function buildRematch(payload) {
    const id = payload.id;
    const def = BOSSES[id];
    const result = h('div', { class: 'note', role: 'alert' });
    return {
      title: def ? `${def.name}と再戦` : '再戦',
      foot: 'Escで閉じる',
      node: h('div', { class: 'altar' },
        h('p', { text: def ? `${def.name}がふたたび目を覚まします。` : 'ボスがふたたび目を覚まします。' }),
        h('div', { class: 'ds', text: '倒れても装備や大切なものは失いません。素材は資源袋に入ります。' }),
        h('h3', { text: '再戦の報酬' }),
        h('div', { class: 'mats' }, ((def && def.rematch) || []).map((x) => h('div', { class: 'mat' }, itemIcon(x.item), h('span', { class: 'nm', text: itemName(x.item) }), h('span', { class: 'n', text: `×${x.n}` })))),
        result,
        h('div', { class: 'layer-btns left' },
          h('button', {
            class: 'btn primary', type: 'button', text: '再戦する', data: { fk: 'rematch-go' },
            onclick: () => {
              const r = api.bossRematch(id);
              if (r && r.ok) { close(); return; }
              result.classList.add('warn');
              result.textContent = (r && r.reason) || '再戦できませんでした';
              api.sfx('error');
            },
          }),
          h('button', { class: 'btn', type: 'button', text: 'やめる', onclick: () => close() }))),
      focusFirst: () => null,
      refresh() {},
    };
  }

  /* ---------------------------------------------------------------- 地図 */
  function buildMap() {
    const st0 = api.getState();
    let mapId = st0.player.map;
    let zoom = 5, cx = st0.player.x / TILE, cy = st0.player.y / TILE;
    const cvs = h('canvas', { class: 'map-canvas', tabindex: '0', 'aria-label': '探索済みの地図。矢印キーで移動、プラスとマイナスで拡大縮小、ゼロで現在地' });
    const wrap = h('div', { class: 'map-wrap' }, cvs);
    const off = document.createElement('canvas');
    const coord = h('span', { class: 'coord' });
    let dirty = true;
    let lastPaint = 0;

    const mapOf = (state) => state.world.maps[mapId];
    function explored(state, x, y) {
      const m = mapOf(state);
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
      const ex = state.explored && state.explored[mapId];
      if (ex) return ex[y * m.w + x] === 1;
      // 探索記録がまだ無いときは、現在地の周りだけ見せる
      const p = state.player;
      return p.map === mapId && Math.hypot(x - p.x / TILE, y - p.y / TILE) <= 10;
    }
    function paintBase(state) {
      const m = mapOf(state);
      if (off.width !== m.w || off.height !== m.h) { off.width = m.w; off.height = m.h; }
      const octx = off.getContext('2d');
      const img = octx.createImageData(m.w, m.h);
      const dd = img.data;
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const i = y * m.w + x, o = i * 4;
          const c = explored(state, x, y) ? (MAP_COLORS[m.terrain[i]] || MAP_COLORS[0]) : [9, 13, 11];
          dd[o] = c[0]; dd[o + 1] = c[1]; dd[o + 2] = c[2]; dd[o + 3] = 255;
        }
      }
      for (const s of state.structures || []) {
        if (s.map !== mapId || !explored(state, s.x, s.y)) continue;
        const o = (s.y * m.w + s.x) * 4;
        const wall = s.type.startsWith('wall') || s.type.startsWith('door');
        const c = wall ? [150, 108, 62] : STRUCTURES[s.type] && STRUCTURES[s.type].layer === 'floor' ? [190, 160, 104] : [226, 200, 120];
        dd[o] = c[0]; dd[o + 1] = c[1]; dd[o + 2] = c[2];
      }
      octx.putImageData(img, 0, 0);
    }
    function collectMarks(state) {
      const m = mapOf(state), lm = m.landmarks || {};
      const out = [];
      const add = (kind, p, needSeen = true) => { if (p && (!needSeen || explored(state, Math.floor(p.x), Math.floor(p.y)))) out.push({ kind, x: p.x + 0.5, y: p.y + 0.5 }); };
      if (mapId === 'surface') {
        add('base', lm.camp, false); add('base', lm.tower); add('entrance', lm.cave); add('altar', lm.forgeAltar);
      } else {
        add('entrance', lm.stairs); add('altar', lm.mossAltar);
        add('altar', { x: RUIN_TEMPLATE.beacon[0], y: RUIN_TEMPLATE.beacon[1] });
      }
      for (const n of m.nodes || []) {
        if (!/crystal/i.test(n.type)) continue;
        const nx = n.x != null ? n.x : Math.floor(n.px / TILE), ny = n.y != null ? n.y : Math.floor(n.py / TILE);
        add('crystal', { x: nx, y: ny });
      }
      const bag = state.deathBag;
      if (bag && bag.map === mapId) out.push({ kind: 'bag', x: bag.x / TILE, y: bag.y / TILE });
      const p = state.player;
      if (p.map === mapId) out.push({ kind: 'you', x: p.x / TILE, y: p.y / TILE });
      return out;
    }
    function clampView(m, W, H) {
      const fit = Math.min(W / m.w, H / m.h);
      zoom = Math.max(fit, Math.min(24, zoom));
      const hw = W / 2 / zoom, hh = H / 2 / zoom;
      cx = m.w <= hw * 2 ? m.w / 2 : Math.max(hw, Math.min(m.w - hw, cx));
      cy = m.h <= hh * 2 ? m.h / 2 : Math.max(hh, Math.min(m.h - hh, cy));
    }
    function draw() {
      const state = api.getState();
      const W = wrap.clientWidth, H = wrap.clientHeight;
      if (!W || !H) return;
      if (cvs.width !== W || cvs.height !== H) { cvs.width = W; cvs.height = H; }
      const m = mapOf(state);
      const ctx = cvs.getContext('2d');
      clampView(m, W, H);
      ctx.fillStyle = '#070b09';
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, W / 2 - cx * zoom, H / 2 - cy * zoom, m.w * zoom, m.h * zoom);
      const size = Math.max(11, Math.min(18, zoom * 1.8));
      ctx.font = `bold ${size}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,10,0.95)';
      for (const mk of collectMarks(state)) {
        const sx = W / 2 + (mk.x - cx) * zoom, sy = H / 2 + (mk.y - cy) * zoom;
        if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
        const def = MARKS[mk.kind];
        ctx.strokeText(def.glyph, sx, sy); ctx.fillStyle = def.color; ctx.fillText(def.glyph, sx, sy);
      }
      const p = state.player;
      coord.textContent = p.map === mapId ? `現在地 ${Math.floor(p.x / TILE)}, ${Math.floor(p.y / TILE)}` : `${p.map === 'surface' ? '地上' : '地下'}にいます`;
    }
    function centerOnYou() {
      const p = api.getState().player;
      if (p.map !== mapId) return;
      cx = p.x / TILE; cy = p.y / TILE; draw();
    }
    function zoomAt(f, mx, my) {
      const W = cvs.width, H = cvs.height;
      const tx = cx + (mx - W / 2) / zoom, ty = cy + (my - H / 2) / zoom;
      zoom *= f;
      clampView(mapOf(api.getState()), W, H);
      cx = tx - (mx - W / 2) / zoom; cy = ty - (my - H / 2) / zoom;
      draw();
    }
    function switchMap(id) {
      mapId = id; dirty = true;
      const p = api.getState().player;
      const m = mapOf(api.getState());
      cx = p.map === id ? p.x / TILE : m.w / 2; cy = p.map === id ? p.y / TILE : m.h / 2;
      d.refresh(api.getState(), true);
    }

    // ドラッグで移動、2本指で拡大縮小
    const ptrs = new Map();
    let pinch = 0;
    cvs.addEventListener('pointerdown', (e) => {
      cvs.focus({ preventScroll: true });
      try { cvs.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    cvs.addEventListener('pointermove', (e) => {
      const pt = ptrs.get(e.pointerId);
      if (!pt) return;
      const dx = e.clientX - pt.x, dy = e.clientY - pt.y;
      pt.x = e.clientX; pt.y = e.clientY;
      if (ptrs.size === 1) { cx -= dx / zoom; cy -= dy / zoom; draw(); }
      else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const r = cvs.getBoundingClientRect();
        if (pinch > 0 && dist > 0) zoomAt(dist / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        pinch = dist;
      }
    });
    for (const t of ['pointerup', 'pointercancel']) cvs.addEventListener(t, (e) => { ptrs.delete(e.pointerId); pinch = 0; });
    cvs.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cvs.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    cvs.addEventListener('keydown', (e) => {
      const step = 40 / zoom;
      switch (e.key) {
        case 'ArrowLeft': cx -= step; break;
        case 'ArrowRight': cx += step; break;
        case 'ArrowUp': cy -= step; break;
        case 'ArrowDown': cy += step; break;
        case '+': case '=': zoomAt(1.25, cvs.width / 2, cvs.height / 2); e.preventDefault(); return;
        case '-': case '_': zoomAt(0.8, cvs.width / 2, cvs.height / 2); e.preventDefault(); return;
        case '0': case 'Home': centerOnYou(); e.preventDefault(); return;
        default: return;
      }
      e.preventDefault(); draw();
    });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => draw()).observe(wrap);

    const tabsEl = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '地図の階層' });
    const legend = h('ul', { class: 'legend' }, Object.values(MARKS).map((mk) => h('li', {}, h('span', { class: 'lg', style: `color:${mk.color}`, 'aria-hidden': 'true', text: mk.glyph }), mk.label)));
    const zbtn = (text, aria, fn) => h('button', { class: 'btn zb', type: 'button', text, 'aria-label': aria, onclick: fn });

    const d = {
      title: 'マップ',
      foot: 'ドラッグで移動 / ホイールか2本指で拡大縮小 / 矢印・＋・−・0 / Escで閉じる',
      node: h('div', { class: 'map-layout' },
        h('div', { class: 'map-top' }, tabsEl, h('div', { class: 'zoom-btns' },
          zbtn('＋', '拡大', () => zoomAt(1.25, cvs.width / 2, cvs.height / 2)), zbtn('－', '縮小', () => zoomAt(0.8, cvs.width / 2, cvs.height / 2)),
          zbtn('現在地', '現在地へ', () => centerOnYou()), coord)),
        wrap, legend,
        h('div', { class: 'ds', text: '歩いた場所だけが描かれます。暗い部分はまだ行っていない場所です。' })),
      focusFirst: () => tabsEl.querySelector('[aria-selected="true"]'),
      refresh(state) {
        tabsEl.replaceChildren(...[['surface', '地上'], ['underground', '地下']].map(([id, name]) => h('button', {
          class: 'tab', type: 'button', role: 'tab', 'aria-selected': id === mapId ? 'true' : 'false', data: { fk: `mt-${id}` },
          onclick: () => { switchMap(id); const el = tabsEl.querySelector(`[data-fk="mt-${id}"]`); if (el) el.focus(); },
        }, name)));
        paintBase(state); draw(); dirty = false;
      },
      // 歩いて探索が進むので、開いている間は少しずつ描き直す
      tick(state, now) {
        if (!dirty && now - lastPaint < 400) return;
        lastPaint = now; dirty = false;
        paintBase(state); draw();
      },
    };
    setTimeout(() => { draw(); }, 0);
    return d;
  }

  /* ---------------------------------------------------------------- 設定・操作説明・メニュー */
  function buildSettings() {
    const seg = (key, opts) => h('span', { class: 'seg', role: 'group' }, ...opts.map(([val, text]) => h('button', {
      class: 'btn sm', type: 'button', text, 'aria-pressed': String(settings[key] === val), data: { fk: `${key}-${val}` },
      onclick: () => { settings[key] = val; saveSettings(); applySettings(); current && current.d.refresh(api.getState(), true); },
    })));
    const slider = (key, text) => {
      const out = h('output', { text: `${Math.round(settings[key] * 100)}%` });
      const inp = h('input', {
        type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(settings[key] * 100)), 'aria-label': `${text}の音量`,
        oninput: () => { settings[key] = clamp01(Number(inp.value) / 100); out.textContent = `${inp.value}%`; applySettings(); },
        onchange: () => { saveSettings(); api.sfx('ui'); },
      });
      return h('div', { class: 'row' }, h('span', { text }), h('span', { class: 'slide' }, inp, out));
    };
    const node = h('div', { class: 'form' });
    const inGame = () => api.inGame();
    return {
      title: '設定',
      foot: 'Escで閉じる',
      node,
      refresh() {
        const hadFocus = document.activeElement && node.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
        node.replaceChildren(
          h('h3', { text: '音' }),
          slider('master', '全体'), slider('music', '音楽'), slider('sfx', '効果音'),
          api.audioAvailable() ? '' : h('div', { class: 'hint-s', text: 'このブラウザでは音を鳴らせません。音なしでも遊べます。' }),
          h('h3', { text: '表示' }),
          h('div', { class: 'row' }, h('span', { text: '画面倍率' }), seg('scale', [['auto', '自動'], [2, '2'], [3, '3'], [4, '4']])),
          h('div', { class: 'row' }, h('span', { text: '文字サイズ' }), seg('large', [[false, '標準'], [true, '大きめ']])),
          h('div', { class: 'row' }, h('span', { text: '揺れ・点滅を抑える' }), seg('calm', [[false, 'オフ'], [true, 'オン']])),
          h('h3', { text: '操作' }),
          h('div', { class: 'row' }, h('span', { text: '操作のヒント' }), seg('hints', [[true, '表示'], [false, '非表示']])),
          h('div', { class: 'row' }, h('span', { text: 'タッチ操作ボタン' }), seg('touch', [['auto', '自動'], ['on', '常に表示'], ['off', '非表示']])),
          h('div', { class: 'row' }, h('span', { text: '操作説明' }), h('button', { class: 'btn sm', type: 'button', text: '見る', onclick: () => open('controls') })),
          h('h3', { text: 'データ' }),
          inGame() ? h('div', { class: 'data-btns' },
            h('button', { class: 'btn', type: 'button', text: '保存する', onclick: () => api.saveNow() }),
            h('button', { class: 'btn', type: 'button', text: '書き出す', onclick: () => api.exportSave() }),
            h('button', { class: 'btn', type: 'button', text: 'ファイルから読み込む', onclick: () => api.importSave() }),
            h('button', { class: 'btn', type: 'button', text: 'バックアップから戻す', onclick: () => api.restoreBackup() }),
            h('button', { class: 'btn', type: 'button', text: 'タイトルへ戻る', onclick: () => { close(false); api.toTitle(); } }))
            : h('div', { class: 'hint-s', text: '保存・書き出しは、ゲームを始めると使えます。' }));
        if (hadFocus) {
          const el = node.querySelector(`[data-fk="${hadFocus}"]`);
          if (el) el.focus();
        }
      },
    };
  }

  function buildControls() {
    const row = (a, b) => h('tr', {}, h('th', { scope: 'row', text: a }), h('td', { text: b }));
    return {
      title: '操作説明',
      foot: 'Escで閉じる',
      node: h('div', { class: 'controls' },
        h('h3', { text: 'キーボード・マウス' }),
        h('table', {}, h('tbody', {},
          row('移動', 'WASD / 矢印キー'), row('行動（採集・攻撃・調べる）', 'E / Space / 左クリック（押し続けて連続）'), row('回避', 'Shift'),
          row('ホットバー', '1〜8 / ホイール'), row('バッグ / 制作 / 建築', 'Tab・I / C / B'), row('マップ / 日誌', 'M / J'),
          row('建築：取り壊し / 回転 / 解除', 'X / R / 右クリック・Esc'), row('メニュー', 'Esc'))),
        h('h3', { text: 'タッチ' }),
        h('table', {}, h('tbody', {},
          row('移動', '左下のスティック'), row('行動', '右下の「行動」 / 対象をタップ'), row('回避', '右下の「回避」'),
          row('メニュー', '右上のボタン'), row('建築', '場所をタップ →「置く」。回転・取り壊し・解除も下のボタン'))),
        h('h3', { text: '畑の流れ' }),
        h('p', { text: '鍬で耕す → 灯麦の種か苔芋を植える → 熟したら素手で収穫。建築メニューの「畑」から始められます。' })),
      refresh() {},
    };
  }

  function buildMenu() {
    const inGame = api.inGame();
    return {
      title: 'ポーズ',
      node: h('div', { class: 'menu-list' },
        h('button', { class: 'btn primary', type: 'button', text: 'ゲームに戻る', onclick: () => close() }),
        h('button', { class: 'btn', type: 'button', text: 'バッグ', onclick: () => open('bag') }),
        h('button', { class: 'btn', type: 'button', text: '制作', onclick: () => open('craft') }),
        h('button', { class: 'btn', type: 'button', text: '建築', onclick: () => open('build') }),
        h('button', { class: 'btn', type: 'button', text: 'マップ', onclick: () => open('map') }),
        h('button', { class: 'btn', type: 'button', text: '日誌', onclick: () => open('journal') }),
        h('button', { class: 'btn', type: 'button', text: '設定', onclick: () => open('settings') }),
        inGame ? h('button', { class: 'btn', type: 'button', text: '保存する', onclick: () => api.saveNow() }) : '',
        h('button', { class: 'btn', type: 'button', text: '保存してタイトルへ', onclick: () => { close(false); api.toTitle(); } })),
      refresh() {},
    };
  }

  const DIALOGS = {
    bag: buildBag, craft: buildCraft, build: buildBuild, container: buildContainer, journal: buildJournal, map: buildMap,
    altar: buildAltar, npc: buildNpc, rematch: buildRematch, settings: buildSettings, controls: buildControls, menu: buildMenu,
  };

  /* ---------------------------------------------------------------- エンディング */
  function showEnding() {
    if (ending) return;
    if (current) close(false);
    joyReset();
    const st = api.getState();
    const go = h('button', {
      class: 'btn primary big', type: 'button', text: '続ける（自由に暮らす）',
      onclick: () => { endEnding(); },
    });
    const lamps = h('div', { class: 'lamps', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('span', { class: 'lamp', style: `animation-delay:${i * 0.5}s` })));
    const panel = h('section', { class: 'ending-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'エンディング' },
      lamps,
      h('h2', { text: '三つの灯が、戻った' }),
      h('p', {}, '炉の灯、苔の灯、古灯。', h('br'), '境の塔の火皿に、あたたかな光が揺れている。'),
      h('p', {}, '森にも、洞窟にも、遺跡にも、もう暗がりはない。', h('br'), 'ここからは、あなたの暮らしを灯していこう。'),
      h('div', { class: 'ending-stats' }, h('span', { text: `プレイ時間 ${fmtPlay(st.playTime)}` }), h('span', { text: `${st.time.day}日目` })),
      go);
    const back = h('div', { class: 'ending' }, panel);
    trapTab(back, panel);
    root.append(back);
    ending = { el: back, go };
    label.hidden = true;
    go.focus();
  }
  function endEnding() {
    if (!ending) return;
    ending.el.remove();
    ending = null;
    api.endingContinue();
    toast('自由な暮らしが始まった。日誌に暮らしの目標があります', 'good');
    api.focusCanvas();
  }

  /* ---------------------------------------------------------------- スタート画面 */
  function showTitle() {
    hideTitle();
    if (current) close(false);
    const info = api.getSaveInfo();
    const canContinue = !!info && (info.status !== 'none' || info.hasBackup);
    let detail = '';
    if (info && info.status === 'ok') detail = `${fmtDate(info.savedAt)}　灯 ${info.lights}/3　${fmtPlay(info.playTime)}`;
    else if (info && info.status === 'broken') detail = info.hasBackup ? '読み込めません（バックアップあり）' : '読み込めません';
    else if (info) detail = 'バックアップのみ';
    const mk = (text, onclick, opts = {}) => h('button', { class: 'tbtn', type: 'button', disabled: !!opts.disabled, onclick },
      h('span', { class: 'tl', text }), opts.note ? h('small', { text: opts.note }) : '');
    const menu = h('div', { class: 'title-menu', role: 'menu' },
      mk('続きから', () => { api.continueGame(); }, { disabled: !canContinue, note: canContinue ? detail : 'セーブなし' }),
      mk('はじめから', () => { api.requestNew(); }),
      mk('読み込み', () => { api.importSave(); }, { note: 'ファイル' }),
      mk('設定', () => open('settings')));
    menu.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const btns = [...menu.querySelectorAll('button:not(:disabled)')];
      const i = btns.indexOf(document.activeElement);
      const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
      e.preventDefault(); btns[n].focus();
    });
    titleEl = h('div', { class: 'title-screen' },
      h('div', { class: 'title-head' },
        h('div', { class: 'title-sub', text: '消えた灯を探す旅' }),
        h('h1', { class: 'title-logo' }, h('img', { src: 'assets/logo/logo.png', alt: 'MOSSLIGHT', width: '240', height: '56', draggable: 'false' })),
        h('div', { class: 'title-ja', text: '苔灯の境' })),
      h('div', { class: 'title-left' },
        h('p', { class: 'title-intro' },
          '森の奥の野営地に、小さな火がひとつ残っている。', h('br'),
          '消えた三つの灯を、苔むした洞窟と古い遺跡から取り戻そう。', h('br'),
          '拾い、作り、暮らしを整えながら、境へ歩き出す。'),
        menu),
      h('div', { class: 'title-foot' }, h('div', {}, 'WASD 移動　E / クリック 行動'), h('div', {}, 'C 制作　B 建築　M マップ　Esc ポーズ')));
    root.append(titleEl);
    app.classList.remove('building');
    const first = menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }

  function hideTitle() {
    if (!titleEl) return;
    titleEl.remove();
    titleEl = null;
    api.focusCanvas();
  }

  /* ---------------------------------------------------------------- 公開 */
  const isPaused = () => !!current || !!titleEl || !!layer || !!ending;

  ui.update = function update(state) {
    const paused = isPaused();
    if (!titleEl) updateHud(state, paused);
    hud.style.display = titleEl ? 'none' : '';
    // タッチ操作は、ダイアログ・タイトル中は隠してスティックの状態も残さない
    const showTouch = touchOn() && !paused && api.inGame();
    touchLayer.hidden = !showTouch;
    if (!showTouch) joyReset();
    if (current) {
      const stations = api.nearbyStations();
      const sg = [...stations].sort().join(',');
      if (state.rev !== lastRev || sg !== lastStationSig) {
        lastStationSig = sg;
        current.d.refresh(state);
      }
      if (current.d.tick) { const now = performance.now(); if (now - lastTick > 100) { lastTick = now; current.d.tick(state, now); } }
    }
    lastRev = state.rev; lastSel = state.player.sel;
  };
  // 新しいstateに切り替えたとき、表示のキャッシュを捨てる
  ui.reset = function reset() {
    lastRev = -1; lastSel = -2; lastObjKey = ''; lastStationSig = '';
    last.hp = last.food = last.tod = last.day = -1; last.boss = ''; last.build = '';
    for (const t of [...toasts]) remove(t);
    hintEl.classList.remove('show');
    label.hidden = true;
    if (current) close(false);
    if (layer) finishLayer(layer.cancelValue);
    if (ending) { ending.el.remove(); ending = null; }
    joyReset();
  };
  ui.open = open;
  ui.close = close;
  ui.toggle = toggle;
  ui.isPaused = isPaused;
  ui.isTitle = () => !!titleEl;
  ui.isEnding = () => !!ending;
  ui.current = () => (current ? current.name : null);
  ui.toast = toast;
  ui.showHint = showHint;
  ui.showSaveError = showSaveError;
  ui.clearSaveError = clearSaveError;
  ui.flashSave = flashSave;
  ui.handleEvents = handleEvents;
  ui.showTitle = showTitle;
  ui.hideTitle = hideTitle;
  ui.getSettings = () => ({ ...settings });
  ui.onResize = function onResize() {
    const big = window.innerHeight >= 860 && window.innerWidth >= 1200;
    app.classList.toggle('u2', big);
    // ロゴ(240x56)は整数倍(1〜3)。幅と高さに収まる最大の倍率にする
    const logoK = Math.max(1, Math.min(3, Math.floor(window.innerWidth * 0.92 / 240), Math.floor(window.innerHeight * 0.28 / 56)));
    app.style.setProperty('--logo-scale', String(logoK));
    const bar = root.querySelector('.save-error');
    if (bar) app.style.setProperty('--sebar', `${bar.offsetHeight}px`);
  };
  // キー入力の前処理。消費したらtrue
  ui.handleKey = function handleKey(e) {
    if (layer) {
      if (e.key === 'Escape') { e.preventDefault(); finishLayer(layer.cancelValue); }
      return true;
    }
    if (ending) {
      if (e.key === 'Escape') e.preventDefault();
      return true;
    }
    if (titleEl) {
      if (e.key === 'Escape' && current) { e.preventDefault(); close(); return true; }
      return false;
    }
    if (current) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
      const map = { i: 'bag', I: 'bag', c: 'craft', C: 'craft', j: 'journal', J: 'journal', b: 'build', B: 'build', m: 'map', M: 'map' };
      const tgt = map[e.key];
      const typing = e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable]');
      if (tgt && !typing && current.name === tgt) { e.preventDefault(); close(); return true; }
      return false;
    }
    return false;
  };

  loadSettings();
  ui.onResize();
  applySettings();
  return ui;
}
