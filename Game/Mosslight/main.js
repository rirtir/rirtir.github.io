// 苔灯の境 / MOSSLIGHT — 起動・ゲームループ・入力の統合・保存I/O・音の接続
// 固定ステップ(1/60秒)を積算して回し、dtは min(実時間, 0.1)。ダイアログ表示中とタブ非表示中は止める。
import { BALANCE, TILE, ITEMS, LIGHTS, RUIN_TEMPLATE, validateData } from './data.js';
import { createWorld, verifyReachability } from './world.js';
import * as sim from './simulation.js';
import { loadAssets, createRenderer } from './renderer.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const STEP = BALANCE.step;

const SAVE_KEY = 'mosslight.save.v1';
const BACKUP_KEY = 'mosslight.save.backup';
const MAX_SAVE_BYTES = 5 * 1024 * 1024;
const AUTOSAVE_SEC = 60;
// これらの出来事の直後は、すぐ保存する
const SAVE_EVENTS = new Set(['save', 'light', 'bossDead', 'death', 'sleep', 'ending']);

const canvas = document.getElementById('game');
const root = document.getElementById('ui-root');
const bootEl = document.getElementById('boot');

let world = null, assets = null, renderer = null, ui = null, state = null, audio = null;
let mode = 'boot';           // 'boot' | 'title' | 'play'

/* ------------------------------------------------------------------ 保存 */
const byteLength = (s) => { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 3; } };
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`);

function storageGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

function saveFailText(e) {
  if (!e) return '原因不明のエラー';
  if (e.userMessage) return e.userMessage;
  if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) return 'ブラウザの保存領域がいっぱいです';
  if (e.name === 'SecurityError') return 'ブラウザが保存を許可していません（プライベートモードなど）';
  return e.message || String(e);
}
function userError(message) { const e = new Error(message); e.userMessage = message; return e; }

function looksLikeSave(raw) {
  if (!raw) return false;
  try { const o = JSON.parse(raw); return !!o && o.format === 'mosslight-save'; } catch (e) { return false; }
}

let lastSaveAt = 0;
function writeSave(reason) {
  if (mode !== 'play' || !state) return false;
  try {
    const data = sim.serialize(state);
    const json = JSON.stringify(data);
    const size = byteLength(json);
    if (size > MAX_SAVE_BYTES) throw userError(`セーブが大きすぎます（${fmtBytes(size)} / 上限5MB）`);
    const chk = sim.validateSave(JSON.parse(json));
    if (!chk.ok) throw userError(`保存データの検証に失敗しました：${(chk.errors || []).join(' / ')}`);
    const prev = storageGet(SAVE_KEY);
    if (prev && prev !== json && looksLikeSave(prev)) {
      try { localStorage.setItem(BACKUP_KEY, prev); } catch (e) { /* バックアップが書けなくても本体の保存は試す */ }
    }
    try {
      localStorage.setItem(SAVE_KEY, json);
    } catch (e) {
      // 容量不足なら、バックアップを手放してもう一度だけ試す。本体の保存データは失敗しても残る
      try { localStorage.removeItem(BACKUP_KEY); localStorage.setItem(SAVE_KEY, json); } catch (e2) { throw e2; }
    }
    lastSaveAt = Date.now();
    ui.clearSaveError();
    ui.flashSave();
    return true;
  } catch (e) {
    console.warn('[Mosslight] 保存に失敗', reason, e);
    ui.showSaveError(`保存に失敗しました。書き出しを推奨します（${saveFailText(e)}）`);
    return false;
  }
}

// 保存データの検証。state を作れるところまで確認し、現在の state には触れない
function parseSave(text) {
  if (typeof text !== 'string' || !text) return { ok: false, errors: ['データが空です'] };
  if (byteLength(text) > MAX_SAVE_BYTES) return { ok: false, errors: [`データが大きすぎます（上限5MB）`] };
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, errors: ['JSONとして読み取れません。ファイルが壊れている可能性があります'] }; }
  let v;
  try { v = sim.validateSave(obj); } catch (e) { return { ok: false, errors: [`検証中にエラーが起きました：${e.message || e}`] }; }
  if (!v || !v.ok) return { ok: false, errors: (v && v.errors && v.errors.length ? v.errors : ['セーブとして認識できません']) };
  let next;
  // 復元は独立した世界で検証する。確認前に現在の採掘・扉を巻き戻さない。
  try { next = sim.createState(createWorld(world ? world.seed : BALANCE.seed), v.save); } catch (e) { return { ok: false, errors: [`データの復元に失敗しました：${e.message || e}`] }; }
  const warnings = [...(v.warnings || [])];
  if (v.save && v.save.droppedItems) warnings.push(`未知のアイテム${v.save.droppedItems}個を取り除きました`);
  return { ok: true, state: next, warnings, info: saveSummary(v.save) };
}

function saveSummary(save) {
  const lights = save && save.progress && save.progress.lights ? Object.values(save.progress.lights).filter(Boolean).length : 0;
  return { savedAt: save && save.savedAt ? Date.parse(save.savedAt) || null : null, lights, playTime: Math.max(0, Number(save && save.playTime) || 0) };
}

function readSlot(key) {
  const raw = storageGet(key);
  if (raw == null) return { ok: false, none: true, errors: ['セーブがありません'] };
  return parseSave(raw);
}

let infoCache = null;
function getSaveInfo() {
  const raw = storageGet(SAVE_KEY);
  const backupRaw = storageGet(BACKUP_KEY);
  if (raw == null && backupRaw == null) return null;
  const key = `${raw ? raw.length : -1}|${raw ? raw.slice(-64) : ''}|${backupRaw ? backupRaw.length : -1}`;
  if (infoCache && infoCache.key === key) return infoCache.value;
  let value;
  const probe = (text) => {
    try {
      const o = JSON.parse(text);
      const v = sim.validateSave(o);
      return v && v.ok ? { ok: true, ...saveSummary(v.save) } : { ok: false };
    } catch (e) { return { ok: false }; }
  };
  const main = raw != null ? probe(raw) : { ok: false };
  const backup = backupRaw != null ? probe(backupRaw) : { ok: false };
  if (main.ok) value = { status: 'ok', ...main, hasBackup: backup.ok };
  else value = { status: raw == null ? 'none' : 'broken', hasBackup: backup.ok, backup: backup.ok ? backup : null };
  infoCache = { key, value };
  return value;
}

function exportSave() {
  if (mode !== 'play' || !state) { ui.toast('ゲームを始めてから書き出せます', 'warn'); return false; }
  try {
    const json = JSON.stringify(sim.serialize(state));
    const size = byteLength(json);
    if (size > MAX_SAVE_BYTES) throw userError(`セーブが大きすぎます（${fmtBytes(size)} / 上限5MB）`);
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = `mosslight-save-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ui.toast(`書き出しました：${name}`, 'good');
    return true;
  } catch (e) {
    ui.alert({ title: '書き出せませんでした', lines: [saveFailText(e)] });
    return false;
  }
}

function pickFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json'; inp.hidden = true;
    inp.addEventListener('change', () => { resolve(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}

const fmtDate = (ms) => {
  if (!ms) return '不明';
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtPlay = (sec) => {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`;
};
const infoLine = (i) => `保存日時 ${fmtDate(i.savedAt)}　灯 ${i.lights}/3　プレイ時間 ${fmtPlay(i.playTime)}`;

function enterPlay(next, warnings) {
  resetInput();
  state = next;
  world = next.world;
  mode = 'play';
  endingActive = false;
  build.type = null;
  ui.reset();
  ui.hideTitle();
  renderer.snapCamera();
  saveClock = 0;
  api.focusCanvas();
  if (warnings && warnings.length) ui.toast(warnings[0], 'warn');
}

async function continueGame() {
  const r = readSlot(SAVE_KEY);
  if (r.ok) { enterPlay(r.state, r.warnings); return true; }
  const b = readSlot(BACKUP_KEY);
  const actions = [];
  if (b.ok) actions.push({ label: 'バックアップから読み込む', value: 'backup', primary: true });
  actions.push({ label: '閉じる', value: 'close', cancel: true });
  const lines = r.none ? ['セーブデータがありません。'] : ['セーブを読み込めませんでした。', ...r.errors.map((x) => `・${x}`), '元のセーブデータは消していません。'];
  if (b.ok) lines.push('', `バックアップが使えます（${infoLine(b.info)}）。`);
  const pick = await ui.alert({ title: '続きから', lines, actions });
  if (pick === 'backup') { enterPlay(b.state, b.warnings); writeSave('backup'); return true; }
  return false;
}

async function restoreBackup() {
  const b = readSlot(BACKUP_KEY);
  if (!b.ok) { ui.alert({ title: 'バックアップ', lines: b.none ? ['バックアップはありません。'] : ['バックアップを読み込めませんでした。', ...b.errors.map((x) => `・${x}`)] }); return false; }
  const ok = await ui.confirm({
    title: 'バックアップから読み込む', lines: [infoLine(b.info), '現在の進行は、このバックアップに置き換わります。'], okLabel: '読み込む', cancelLabel: 'やめる', danger: true,
  });
  if (!ok) return false;
  enterPlay(b.state, b.warnings);
  writeSave('backup');
  return true;
}

async function importSave() {
  const file = await pickFile();
  if (!file) return false;
  if (file.size > MAX_SAVE_BYTES) {
    ui.alert({ title: '読み込めません', lines: [`ファイルが大きすぎます（${fmtBytes(file.size)} / 上限5MB）。`, '現在のデータは変更していません。'] });
    return false;
  }
  let text;
  try { text = await file.text(); } catch (e) {
    ui.alert({ title: '読み込めません', lines: ['ファイルを読み取れませんでした。', '現在のデータは変更していません。'] });
    return false;
  }
  const r = parseSave(text);
  if (!r.ok) {
    ui.alert({ title: '読み込めません', lines: ['このファイルは読み込めませんでした。', ...r.errors.map((x) => `・${x}`), '現在のデータは変更していません。'] });
    return false;
  }
  const overwrite = mode === 'play' || !!storageGet(SAVE_KEY);
  const lines = [`ファイル：${file.name}`, infoLine(r.info)];
  if (r.warnings.length) lines.push(...r.warnings.map((x) => `注意：${x}`));
  lines.push(overwrite ? '現在の進行と保存データは、このデータで置き換わります。' : 'このデータで続きから始めます。');
  const ok = await ui.confirm({ title: 'ファイルから読み込む', lines, okLabel: '読み込む', cancelLabel: 'やめる', danger: overwrite });
  if (!ok) return false;
  enterPlay(r.state, r.warnings);
  writeSave('import');
  return true;
}

async function requestNew() {
  const info = getSaveInfo();
  if (info) {
    const lines = ['新しく始めると、いまのセーブは次の保存で上書きされます。'];
    if (info.status === 'ok') lines.unshift(infoLine(info));
    lines.push('残しておきたい場合は、先に続きから始めて書き出してください。');
    const ok = await ui.confirm({ title: 'はじめから', lines, okLabel: 'はじめから', cancelLabel: 'やめる', danger: true });
    if (!ok) return false;
  }
  startNew();
  return true;
}

function toTitle() {
  if (mode === 'play') writeSave('title');
  enterTitle();
}

/* ------------------------------------------------------------------ 建築の選択(simの公開APIがない間は慎重にfallback) */
const build = { type: null, rot: 0, last: null };

function selectBuild(type, rot = build.rot) {
  if (mode !== 'play' || !state) return { ok: false, reason: 'ゲーム中に使えます' };
  build.rot = ((rot % 4) + 4) % 4;
  let r;
  if (typeof sim.selectBuild === 'function') {
    try { r = sim.selectBuild(state, type, build.rot); } catch (e) { console.warn(e); r = { ok: false, reason: '選択できませんでした' }; }
    if (r && typeof r.ok === 'boolean') { if (!r.ok) return r; } else r = { ok: true };
  } else if (type == null) {
    state.player.sel = -1; r = { ok: true };
  } else if (ITEMS[type] && ITEMS[type].place) {
    if (sim.countItem(state, type) < 1) return { ok: false, reason: 'まだ持っていません。Cで作りましょう' };
    const hb = state.player.hotbar;
    let i = hb.indexOf(type);
    if (i < 0) { i = hb.indexOf(null); if (i < 0) i = hb.length - 1; sim.assignHotbar(state, i, type); }
    sim.useHotbar(state, i);
    r = { ok: true };
  } else {
    return { ok: false, reason: 'この操作はまだ使えません' };
  }
  build.type = type;
  if (type && type !== 'demolish') build.last = type;
  return r;
}

const buildMode = () => {
  const bm = state && state.player ? state.player.buildMode : null;
  return typeof bm === 'string' ? bm : (bm && bm.type) || null;
};
const buildActive = () => !!state && mode === 'play' && !!(state.preview || buildMode());
function buildTypeNow() { return (state && state.preview && state.preview.type) || buildMode() || build.type; }

function rotateBuild() {
  build.rot = (build.rot + 1) % 4;
  input.rotatePressed = true;
  const t = buildTypeNow();
  if (t && typeof sim.selectBuild === 'function') selectBuild(t, build.rot);
}
function toggleDemolish() {
  if (buildTypeNow() === 'demolish') { if (build.last) selectBuild(build.last); else cancelBuild(); return; }
  if (typeof sim.selectBuild === 'function') selectBuild('demolish');
  else input.removePressed = true;
}
function cancelBuild() {
  input.cancelPressed = true;
  if (typeof sim.selectBuild === 'function' && build.type) { try { sim.selectBuild(state, null); } catch (e) { /* 次のstepのcancelで解除される */ } }
  build.type = null;
}

/* ------------------------------------------------------------------ 進行情報(simの公開APIがない間のfallback付き) */
const lightCount = () => Object.values(state.progress.lights).filter(Boolean).length;
const have = (id) => sim.countItem(state, id);

function getHouseStatus() {
  if (typeof sim.getHouseStatus === 'function') { try { return sim.getHouseStatus(state); } catch (e) { console.warn(e); } }
  const hs = Array.isArray(state.houses) ? state.houses : [];
  return { valid: hs.filter((x) => x.valid).length, total: hs.length, houses: hs.map((x) => ({ ...x, reasons: x.reasons || [] })) };
}

const LIFE_GOALS = [
  ['houses', '家を4軒そろえる', 4], ['lanterns', '灯籠を8つ置く', 8], ['farms', '畑を12区画つくる', 12], ['dishes', '料理を6種類つくる', 6],
  ['residents', '住人を3人迎える', 3], ['roads', '道を60マス敷く', 60], ['iron', '翠鉄の装備一式をそろえる', 1], ['rematch', '両方のボスと再戦する', 2],
];
function getLifeGoals() {
  if (typeof sim.getLifeGoals === 'function') { try { return sim.getLifeGoals(state); } catch (e) { console.warn(e); } }
  const g = state.progress.goals || {};
  return LIFE_GOALS.map(([id, text, target]) => ({ id, text, value: Math.min(target, Number(g[id]) || 0), target }));
}

function getJournal() {
  if (typeof sim.getJournal === 'function') { try { return sim.getJournal(state); } catch (e) { console.warn(e); } }
  const pr = state.progress, L = pr.lights;
  const req = (text, current, target) => ({ text, current, target, done: current >= target });
  const flag = (text, done) => ({ text, done: !!done });
  const forge = LIGHTS.forge.offer.map(({ item, n }) => req(`${ITEMS[item].name}を捧げる`, Math.min(have(item), n), n));
  forge.push(req('有効な家を建てる', Math.min(getHouseStatus().valid, 1), 1));
  const moss = [req('光苔結晶を祭壇に置く', pr.crystalsPlaced || 0, LIGHTS.moss.crystals), flag('ヌシカズラを鎮める', pr.bosses.vine), flag('苔の灯芯を祭壇に置く', L.moss)];
  const lit = (pr.braziers || []).filter(Boolean).length;
  const ancient = [flag('炉の灯と苔の灯を復元する', L.forge && L.moss), req('遺跡の灯皿に苔灯油を灯す', lit, LIGHTS.ancient.dishes), flag('灰の番人を倒す', pr.bosses.ash), flag('古の灯芯を古灯台に置く', L.ancient)];
  return {
    objective: sim.getObjective(state),
    lights: [
      { id: 'forge', name: LIGHTS.forge.name, done: !!L.forge, requirements: forge },
      { id: 'moss', name: LIGHTS.moss.name, done: !!L.moss, requirements: moss },
      { id: 'ancient', name: LIGHTS.ancient.name, done: !!L.ancient, requirements: ancient },
    ],
    goals: getLifeGoals(),
    story: '消えた三つの灯を取り戻し、境の塔に火を戻そう。',
  };
}

const missing = () => ({ ok: false, reason: 'この操作はまだ使えません' });
function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return missing();
  try {
    const r = fn(state, ...args);
    return r && typeof r.ok === 'boolean' ? r : { ok: true };
  } catch (e) { console.warn(e); return { ok: false, reason: '処理中にエラーが起きました' }; }
}

/* ------------------------------------------------------------------ 入力 */
const keys = new Set();
const input = {
  moveX: 0, moveY: 0, aim: null, aimActive: false,
  act: false, actPressed: false, cancelPressed: false, dodgePressed: false, removePressed: false, rotatePressed: false, slot: -1, wheel: 0,
};
const pad = { x: 0, y: 0, act: false };   // 仮想スティック/行動ボタン(ui.jsが api.input 経由で更新)
let mouseDown = false;
let aimMode = false;
let aimWorld = null;                      // タッチの狙いは指を置いた世界座標で保持する
let canvasPointer = null;
let clientX = 0, clientY = 0;
let endingActive = false;

const canPlay = () => mode === 'play' && !!ui && !ui.isPaused();
const unit = (v) => Math.max(-1, Math.min(1, Number(v) || 0));

function isTyping(e) {
  const t = e.target;
  return !!(t && t.closest && t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]'));
}

function clearEdges() {
  input.actPressed = false; input.cancelPressed = false; input.dodgePressed = false;
  input.removePressed = false; input.rotatePressed = false; input.slot = -1; input.wheel = 0;
}

function resetInput() {
  keys.clear(); mouseDown = false; aimMode = false; aimWorld = null; canvasPointer = null;
  pad.x = 0; pad.y = 0; pad.act = false;
  input.act = false; input.moveX = 0; input.moveY = 0; input.aim = null; input.aimActive = false;
  clearEdges();
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

window.addEventListener('keydown', (e) => {
  if (mode === 'boot' || !ui) return;
  if (isTyping(e) && e.key !== 'Escape') return;
  // 画面上のボタンにフォーカスがあるとき、Space/Enterはそのボタンの操作にして、ゲームの行動にしない
  const onBtn = e.target && e.target.closest && e.target.closest('#ui-root button');
  if (onBtn && (e.code === 'Space' || e.code === 'Enter')) return;
  if (ui.handleKey(e)) return;
  if (ui.isPaused() || mode !== 'play') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const c = e.code;
  if (MOVE_KEYS.has(c)) { keys.add(c); aimMode = false; aimWorld = null; e.preventDefault(); return; }
  if (c === 'Space' || c === 'KeyE') {
    e.preventDefault();
    keys.add(c); aimMode = false; aimWorld = null;
    if (!e.repeat) input.actPressed = true;
    return;
  }
  if (e.repeat) { if (c === 'Tab') e.preventDefault(); return; }
  if (c === 'ShiftLeft' || c === 'ShiftRight') { input.dodgePressed = true; return; }
  if (/^(Digit|Numpad)[1-8]$/.test(c)) { input.slot = Number(c.slice(-1)) - 1; return; }
  switch (c) {
    case 'Tab': case 'KeyI': e.preventDefault(); ui.open('bag'); break;
    case 'KeyC': ui.open('craft'); break;
    case 'KeyJ': ui.open('journal'); break;
    case 'KeyB': ui.open('build'); break;
    case 'KeyM': ui.open('map'); break;
    case 'KeyR': if (buildActive()) rotateBuild(); break;
    case 'Escape': if (buildActive()) cancelBuild(); else ui.open('menu'); break;
    case 'KeyX': input.removePressed = true; break;
    default: break;
  }
});

window.addEventListener('keyup', (e) => { keys.delete(e.code); });
window.addEventListener('blur', () => { resetInput(); });

canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'play' || ui.isPaused()) return;
  canvas.focus({ preventScroll: true });
  clientX = e.clientX; clientY = e.clientY; aimMode = true;
  const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
  aimWorld = touch ? renderer.screenToWorld(e.clientX, e.clientY) : null;
  if (e.button === 2) { cancelBuild(); return; }
  if (e.button !== 0) return;
  if (canvasPointer != null) return;       // 2本目以降の指は無視(スティックと別の指が主)
  canvasPointer = e.pointerId;
  // タッチの建築は、タップで狙いを動かし、確定ボタンで置く
  if (touch && buildActive()) return;
  mouseDown = true; input.actPressed = true;
});
canvas.addEventListener('pointermove', (e) => {
  clientX = e.clientX; clientY = e.clientY; aimMode = true;
  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    if (e.pointerId === canvasPointer && mode === 'play') aimWorld = renderer.screenToWorld(e.clientX, e.clientY);
  } else aimWorld = null;
});
function releasePointer(e) {
  if (e.pointerId !== canvasPointer) return;
  canvasPointer = null; mouseDown = false;
}
window.addEventListener('pointerup', releasePointer);
window.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mode !== 'play' || ui.isPaused()) return;
  input.wheel = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
}, { passive: false });

function refreshInput() {
  let mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let my = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  if (pad.x || pad.y) {
    mx = pad.x; my = pad.y;
    if (aimWorld && !buildActive()) { aimMode = false; aimWorld = null; }
  }
  input.moveX = mx; input.moveY = my;
  input.act = keys.has('KeyE') || keys.has('Space') || mouseDown || pad.act;
  input.aimActive = aimMode;
  input.aim = aimMode ? (aimWorld || renderer.screenToWorld(clientX, clientY)) : null;
}

/* ------------------------------------------------------------------ 音 */
let audioUnlocked = false;
let lastMusic = null, lastPaused = null;
const sfxAt = {};

function snd(name, opts) {
  if (!audio) return;
  try { audio.play(name, opts); } catch (e) { /* 音が鳴らなくても進行する */ }
}
function sndThrottle(name, ms, opts) {
  const now = performance.now();
  if (now - (sfxAt[name] || 0) < ms) return;
  sfxAt[name] = now;
  snd(name, opts);
}
function unlockAudio() {
  if (!audio || audioUnlocked) return;
  audioUnlocked = true;
  try {
    Promise.resolve(audio.unlock()).then((ok) => { if (!ok) audioUnlocked = false; }).catch(() => { audioUnlocked = false; });
  } catch (e) { audioUnlocked = false; }
}
// 最初のユーザー操作で一度だけ解錠する(新規/続きのボタンもこの操作に含まれる)
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(type, () => { if (!audioUnlocked) unlockAudio(); }, { capture: true });
}

const STONE_NODES = new Set(['rock', 'pebble', 'clay', 'copper_deposit', 'iron_outcrop', 'dirt_wall', 'moss_wall', 'copper_wall', 'iron_wall']);

function eventSound(ev) {
  if (ev.sound) { snd(ev.sound, ev); return; }
  switch (ev.type) {
    case 'hit': case 'deplete':
      if (ev.node === 'tree') sndThrottle('chop', 90, ev);
      else if (STONE_NODES.has(ev.node)) sndThrottle('mine', 90, ev);
      else sndThrottle('collect', 120, ev);
      break;
    case 'pickup': sndThrottle('pickup', 60, ev); break;
    case 'gain': sndThrottle('collect', 160, ev); break;
    case 'craft': snd('craft'); break;
    case 'place': case 'remove': snd('build'); break;
    case 'step': sndThrottle('step', 150, { water: !!ev.water }); break;
    case 'swing': snd('swing'); break;
    case 'enemyHit': snd('hit'); break;
    case 'hurt': case 'playerHit': case 'playerHurt': case 'damage': snd('hurt'); break;
    case 'roll': snd('roll'); break;
    case 'eat': snd('eat'); break;
    case 'harvest': snd('harvest'); break;
    case 'plant': snd('build'); break;
    case 'light': snd('light'); break;
    case 'bossStart': case 'telegraph': snd('warning'); break;
    case 'bossDead': snd('clear'); break;
    case 'death': snd('death'); break;
    case 'ending': snd('victory'); break;
    case 'equip': snd('ui'); break;
    default: break;
  }
}

function musicMode() {
  if (mode !== 'play') return 'day';
  if (ui.isEnding()) return 'ending';
  if (state.boss && state.boss.hp > 0) return 'boss';
  const p = state.player;
  if (p.map === 'underground') {
    const [ox, oy] = RUIN_TEMPLATE.origin, [w, h] = RUIN_TEMPLATE.size;
    const tx = p.x / TILE, ty = p.y / TILE;
    return tx >= ox && tx < ox + w && ty >= oy && ty < oy + h ? 'ruin' : 'cave';
  }
  const tod = sim.timeOfDay(state);
  return tod >= 450 || tod < 20 ? 'night' : 'day';
}

function audioFrame() {
  if (!audio) return;
  try {
    const m = musicMode();
    if (m !== lastMusic) { lastMusic = m; audio.setMusic(m); }
    const paused = document.hidden || (mode === 'play' && ui.isPaused() && ui.current() !== 'settings');
    if (paused !== lastPaused) { lastPaused = paused; audio.setPaused(paused); }
  } catch (e) { /* 無視 */ }
}

function applySettings(s) {
  if (!audio) return;
  try { audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx }); } catch (e) { /* 無視 */ }
}

/* ------------------------------------------------------------------ UIへ渡すAPI */
const api = {
  assets: null,
  getState: () => state,
  recipeStatus: (r, st) => sim.recipeStatus(state, r, st),
  nearbyStations: () => sim.nearbyStations(state),
  getObjective: () => sim.getObjective(state),
  craft: (id, n) => sim.craft(state, id, n),
  eat: (id) => sim.eat(state, id),
  useHotbar: (i) => sim.useHotbar(state, i),
  swapBag: (a, b) => sim.swapBag(state, a, b),
  equipFromBag: (slot) => sim.equipFromBag(state, slot),
  unequip: (name) => sim.unequip(state, name),
  assignHotbar: (i, id) => sim.assignHotbar(state, i, id),
  dropItem: (slot) => sim.dropItem(state, slot),
  transfer: (id, from, slot) => sim.transfer(state, id, from, slot),
  worldToScreen: (x, y) => renderer.worldToScreen(x, y),
  focusCanvas: () => { if (document.activeElement !== canvas) canvas.focus({ preventScroll: true }); },
  setScale: (v) => { if (renderer) renderer.setScale(v); },
  onSettings: applySettings,
  audioAvailable: () => !!(audio && audio.available),
  sfx: (name) => snd(name),
  // 建築
  selectBuild,
  getBuildState: () => ({ type: buildTypeNow(), rot: build.rot, active: buildActive() }),
  getHouseStatus,
  // 進行
  getJournal,
  restoreLight: (id) => safeCall(sim.restoreLight, id),
  collectResident: (id) => safeCall(sim.collectResident, id),
  bossRematch: (id) => safeCall(sim.bossRematch, id),
  endingContinue() {
    if (typeof sim.continueAfterEnding === 'function') { try { sim.continueAfterEnding(state); } catch (e) { console.warn(e); } }
    if (state.progress) state.progress.cleared = true;
    state.rev++;
    endingActive = false;
    writeSave('ending');
  },
  // 保存
  hasSave: () => !!getSaveInfo(),
  getSaveInfo,
  saveNow() { const ok = writeSave('manual'); if (ok) ui.toast('保存しました', 'good'); return ok; },
  exportSave,
  importSave,
  restoreBackup,
  inGame: () => mode === 'play',
  // 場面
  startNew,
  requestNew,
  continueGame,
  toTitle,
  // 操作(仮想スティック・ボタン、PCも同じ入口)
  input: {
    move(x, y) { pad.x = unit(x); pad.y = unit(y); const l = Math.hypot(pad.x, pad.y); if (l > 1) { pad.x /= l; pad.y /= l; } },
    act(down) { pad.act = !!down && canPlay(); },
    actPress() { if (canPlay()) input.actPressed = true; },
    dodge() { if (canPlay()) input.dodgePressed = true; },
    cancel() { if (canPlay()) cancelBuild(); },
    remove() { if (canPlay()) input.removePressed = true; },
    rotate() { if (canPlay()) rotateBuild(); },
    confirm() { if (canPlay()) input.actPressed = true; },
    demolish() { if (canPlay()) toggleDemolish(); },
    hotbar(i) { if (canPlay()) input.slot = i; },
  },
};

/* ------------------------------------------------------------------ 場面 */
function enterTitle() {
  resetInput();
  state = sim.createState(world);
  sim.setClock(state, 418);              // タイトルは夕暮れの野営地
  state.progress.hints.move = 1;
  mode = 'title';
  endingActive = false;
  build.type = null;
  ui.reset();
  renderer.snapCamera();
  ui.showTitle();
}

function startNew() {
  resetInput();
  state = sim.createState(world);
  mode = 'play';
  endingActive = false;
  build.type = null;
  saveClock = 0;
  ui.reset();
  ui.hideTitle();
  api.focusCanvas();
}

function titleCam() {
  const c = world.surface.landmarks.camp;
  const t = performance.now() / 1000;
  const v = renderer.getView();
  return { x: c.x * TILE + 16 + Math.sin(t * 0.13) * 22, y: c.y * TILE + 4 - v.h * 0.1 + Math.cos(t * 0.17) * 8 };
}

/* ------------------------------------------------------------------ ループ */
let lastTime = 0;
let acc = 0;
let saveClock = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (!lastTime) lastTime = now;
  const real = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const running = mode === 'play' && !ui.isPaused() && !document.hidden;
  if (running) {
    acc += real;
    refreshInput();
    let n = 0;
    while (acc >= STEP && n < BALANCE.maxSteps) {
      sim.step(state, STEP, input);
      acc -= STEP; n++;
      if (n === 1) clearEdges();
    }
    if (n >= BALANCE.maxSteps) acc = 0;
    saveClock += real;
    if (build.type && !buildActive() && n > 0) build.type = null;
  } else {
    acc = 0;
    if (mode === 'play') {
      clearEdges();
      pad.x = 0; pad.y = 0; pad.act = false; mouseDown = false;
    }
  }

  let needSave = false;
  if (state.events.length) {
    const evs = state.events;
    state.events = [];
    for (const ev of evs) {
      if (SAVE_EVENTS.has(ev.type)) needSave = true;
      if (ev.type === 'ending') endingActive = true;
      eventSound(ev);
    }
    renderer.handleEvents(evs);
    ui.handleEvents(evs);
  }
  if (mode === 'play' && (needSave || saveClock >= AUTOSAVE_SEC)) { saveClock = 0; writeSave(needSave ? 'event' : 'auto'); }

  renderer.render(state, { dt: real, cam: mode === 'title' ? titleCam() : null, hideFocus: mode !== 'play', calm: ui.getSettings().calm });
  ui.update(state);
  audioFrame();
}

/* ------------------------------------------------------------------ 起動 */
function onResize() {
  if (!renderer) return;
  renderer.resize();
  ui.onResize();
}

async function boot() {
  const v = validateData();
  if (v.ok) console.info('[Mosslight] validateData OK');
  else console.error('[Mosslight] データ検証エラー', v.errors);

  const assetsPromise = loadAssets('assets/manifest.json');
  world = createWorld(BALANCE.seed);
  assets = await assetsPromise;
  api.assets = assets;
  renderer = createRenderer(canvas, assets);
  renderer.resize();
  try { audio = createAudio(); } catch (e) { audio = null; console.warn('[Mosslight] 音を初期化できません', e); }
  ui = createUI(root, api);
  window.addEventListener('resize', onResize);
  if (typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(canvas);
  document.addEventListener('visibilitychange', () => {
    resetInput();
    lastTime = 0; acc = 0;
    if (document.hidden) writeSave('hidden');
    audioFrame();
  });
  window.addEventListener('pagehide', () => { writeSave('pagehide'); });
  window.addEventListener('beforeunload', () => { writeSave('unload'); });

  if (assets.failed.length) console.warn('[Mosslight] 読み込めなかったアセット:', assets.failed.join(', '));
  enterTitle();
  bootEl.classList.add('done');
  requestAnimationFrame(frame);

  if (DEBUG) exposeDebug();
}

// ?debug=1 のときだけ公開。制作・建築の条件はここで無効化しない(通常プレイの判定は常に同じ)
function exposeDebug() {
  const setLights = (spec) => {
    const L = state.progress.lights;
    const ids = Array.isArray(spec) ? spec : Object.keys(spec || {}).filter((k) => spec[k]);
    for (const id of Object.keys(L)) L[id] = ids.includes(id);
    if (L.moss) { state.progress.bosses.vine = true; state.progress.crystalsPlaced = 3; }
    if (L.ancient) { state.progress.bosses.ash = true; state.progress.braziers = [true, true, true]; }
    state.rev++;
    return { ...L };
  };
  window.__mosslight = {
    get state() { return state; },
    get mode() { return mode; },
    get world() { return world; },
    assets,
    renderer,
    ui,
    audio,
    api: { ...sim, ...api },
    sim,
    start: startNew,
    give(item, n = 1) { return n - sim.addItem(state, item, n); },
    teleport(map, x, y) { const ok = sim.teleport(state, map, x, y); if (ok) renderer.snapCamera(); return ok; },
    setTime(seconds) { sim.setClock(state, seconds); },
    setLights,
    verifyReachability: () => verifyReachability(world),
    validateData,
    step(n = 1, inp) { for (let i = 0; i < n; i++) sim.step(state, STEP, inp || {}); },
    save: () => writeSave('debug'),
    saveInfo: getSaveInfo,
    open: (name, payload) => ui.open(name, payload),
    emit: (ev) => { state.events.push(ev); },
  };
}

boot().catch((err) => {
  console.error('[Mosslight] 起動に失敗しました', err);
  bootEl.classList.remove('done');
  bootEl.textContent = `起動に失敗しました: ${err && err.message ? err.message : err}`;
});
