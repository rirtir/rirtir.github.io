// 残り火の深庭 — EMBERVEIL / 起動・入力・固定ステップ・App
// 描画・音・UIの不具合でループ全体が止まらないよう、各担当の呼び出しは safe() で包む。

const STEP = 1 / 60;
const MAX_STEPS = 5;
const SLOT_COUNT = 3;
const HEARTBEAT_MS = 2000;
const AUTOSAVE_SEC = 60;
const LOCK_TTL_MS = 8000;
const NS = 'emberveil.v1';
const PREFS_KEY = `${NS}.ui`;
const MAX_IMPORT_CHARS = 3000000;
const LOAD_TIMEOUT_MS = 15000;
const AUTOSAVE_EVENTS = new Set(['sleep', 'bossDefeated', 'gateOpen', 'coreRestore']);
const SEED_WORDS = ['MOSS', 'GLOW', 'EMBER', 'PRISM', 'DEEP', 'LUMEN', 'ASH', 'FERN'];

const SAVE_REASONS = {
  boss: 'ボス戦中は保存できません',
  dead: '倒れている間は保存できません',
  ending: 'エンディング中は保存できません',
  title: 'ゲームが始まっていません',
  readonly: 'このタブは閲覧のみのため保存できません',
};

const $ = (id) => document.getElementById(id);
const safe = (fn, label = '') => {
  try { return fn(); } catch (e) { console.error(label || 'safe', e); return undefined; }
};
const clampInt = (v, lo, hi, d) => {
  v = Math.round(Number(v));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};
const osReduceMotion = () => !!safe(() => matchMedia('(prefers-reduced-motion: reduce)').matches);

const settingDefaults = () => ({
  soundOn: true, volume: 7, reduceMotion: osReduceMotion(), screenShake: true, difficulty: 'standard',
  autoTool: true, showDamageNumbers: true, highContrastTelegraph: false, objectiveArrow: true,
  uiScale: 100, touchControls: 'auto',
});

// ---------- キー割り当て（event.code） ----------
const GAME_KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'primary', KeyJ: 'primary',
  KeyE: 'interact', KeyK: 'interact', Enter: 'interact', NumpadEnter: 'interact',
  KeyL: 'dodge', ShiftLeft: 'dodge', ShiftRight: 'dodge',
  KeyR: 'remove', KeyQ: 'quickHeal', KeyZ: 'hotPrev', KeyX: 'hotNext',
};
for (let i = 1; i <= 8; i++) { GAME_KEYS[`Digit${i}`] = `hot${i}`; GAME_KEYS[`Numpad${i}`] = `hot${i}`; }
const GAME_MENU_KEYS = { Tab: 'inventory', KeyI: 'inventory', KeyC: 'craft', KeyM: 'map', KeyG: 'codex', KeyP: 'pause', Escape: 'pause' };
const MENU_KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', KeyJ: 'confirm',
  Escape: 'back', Backspace: 'back', KeyQ: 'tabPrev', PageUp: 'tabPrev', KeyE: 'tabNext', PageDown: 'tabNext',
  KeyI: 'inventory', KeyC: 'craft', KeyM: 'map', KeyG: 'codex', KeyP: 'pause',
};
const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'tabPrev', 'tabNext']);
const HELD_ACTIONS = ['primary', 'interact', 'dodge', 'remove'];

// 入力欄にフォーカスがあるときは、ブラウザ本来のキー操作を優先する
function nativeKey(el, code) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = (el.type || 'text').toLowerCase();
  if (type === 'range') return ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(code);
  if (type === 'radio') return code.startsWith('Arrow');
  return !['checkbox', 'button', 'submit', 'reset', 'file', 'image'].includes(type);
}

// ---------- Input ----------
class Input {
  constructor(game) {
    this.game = game;
    this.renderer = null;
    this.ui = null;
    this.device = 'keyboard';
    this.keys = new Set();
    this.sources = {};
    for (const a of HELD_ACTIONS) this.sources[a] = new Set();
    this.stick = { x: 0, y: 0 };
    this.pointers = new Map(); // pointerId -> { kind, ... }
    this.lastWheel = 0;
    this.state = { moveX: 0, moveY: 0, held: { primary: false, interact: false, dodge: false, remove: false }, pressed: new Set(), pointer: null };
    this.attach();
  }

  attach() { this.game.input = this.state; }

  setDevice(d) { this.device = d; }

  setHeld(action, on, source = 'api') {
    const set = this.sources[action];
    if (!set) return;
    if (on) set.add(source); else set.delete(source);
    this.state.held[action] = set.size > 0;
  }

  // 押した瞬間（そのステップで1回だけ）
  pulse(action) {
    this.state.pressed.add(action);
  }

  // 画面座標 → タイル座標（renderer.screenToWorld）。次のステップで game が読む
  setPointer(clientX, clientY) {
    const w = this.renderer && safe(() => this.renderer.screenToWorld(clientX, clientY));
    if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.y)) return false;
    this.state.pointer = { x: w.x, y: w.y, tx: Math.floor(w.x), ty: Math.floor(w.y) };
    return true;
  }

  // pressed はステップ終了時にだけ消す（低fpsでも取りこぼさない）
  endStep() {
    this.state.pressed.clear();
    this.state.pointer = null;
  }

  // メニュー・ポーズ・非表示のあいだは、押下状態を残さない
  clearAll() {
    const st = this.state;
    const busy = this.keys.size || this.pointers.size || this.stick.x || this.stick.y || st.pressed.size || st.pointer || st.moveX || st.moveY
      || HELD_ACTIONS.some((a) => this.sources[a].size);
    if (!busy) return; // 毎フレーム呼ばれるので、何も残っていなければ何もしない
    this.keys.clear();
    for (const a of HELD_ACTIONS) { this.sources[a].clear(); this.state.held[a] = false; }
    this.stick.x = 0; this.stick.y = 0;
    this.pointers.clear();
    this.setKnob(0, 0);
    this.touchRoot?.querySelectorAll('[data-pressed]').forEach((b) => b.removeAttribute('data-pressed'));
    this.state.moveX = 0; this.state.moveY = 0;
    this.endStep();
  }

  canPlay() {
    const g = this.game;
    return g.mode === 'playing' && !g.paused && !(this.ui && this.ui.isCapturingInput());
  }

  recomputeMove() {
    let x = 0; let y = 0;
    for (const c of this.keys) {
      const a = GAME_KEYS[c];
      if (a === 'left') x--; else if (a === 'right') x++; else if (a === 'up') y--; else if (a === 'down') y++;
    }
    x += this.stick.x; y += this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.state.moveX = x; this.state.moveY = y;
  }

  // マウスやタッチを押し続けたとき、近い対象には繰り返し主行動を入れる
  tick(dt) {
    for (const rec of this.pointers.values()) {
      if (rec.kind !== 'canvas') continue;
      rec.timer -= dt;
      if (rec.timer > 0) continue;
      rec.timer = 0.25;
      if (!this.canPlay()) continue;
      const w = safe(() => this.renderer.screenToWorld(rec.x, rec.y));
      const p = this.game.player;
      if (!w || !p || Math.hypot(w.x - p.x, w.y - p.y) > 2.2) continue;
      this.state.pointer = { x: w.x, y: w.y, tx: Math.floor(w.x), ty: Math.floor(w.y) };
    }
  }

  // ----- キーボード -----
  bindWindow(ui) {
    this.ui = ui;
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.clearAll());
    window.addEventListener('pointercancel', (e) => this.releasePointer(e.pointerId));
    window.addEventListener('pointerup', (e) => this.releasePointer(e.pointerId));
  }

  onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (code !== 'Escape' && nativeKey(e.target, code)) return;
    this.setDevice('keyboard');
    const ui = this.ui;
    if (ui && ui.isCapturingInput()) {
      const action = MENU_KEYS[code];
      if (!action) return;
      if (e.repeat && !REPEATABLE.has(action)) { e.preventDefault(); return; }
      if (safe(() => ui.onAction(action, e), 'ui.onAction')) e.preventDefault();
      return;
    }
    const menu = GAME_MENU_KEYS[code];
    if (menu) {
      e.preventDefault();
      if (!e.repeat && ui) safe(() => ui.onAction(menu, e), 'ui.onAction');
      return;
    }
    const act = GAME_KEYS[code];
    if (!act) return;
    e.preventDefault(); // Space/Enter がフォーカス中のボタンを押さないように
    if (HELD_ACTIONS.includes(act)) {
      if (!e.repeat) { this.pulse(act); this.setHeld(act, true, `key:${code}`); }
    } else if (act === 'quickHeal' || act.startsWith('hot')) {
      if (!e.repeat) this.pulse(act);
    } else if (!this.keys.has(code)) {
      this.keys.add(code);
      this.recomputeMove();
    }
  }

  onKeyUp(e) {
    const code = e.code;
    const act = GAME_KEYS[code];
    if (act) {
      if (HELD_ACTIONS.includes(act)) this.setHeld(act, false, `key:${code}`);
      else if (this.keys.delete(code)) this.recomputeMove();
    }
    // ゲーム操作中のSpace/Enterで、フォーカス中のボタンを起動させない
    if ((code === 'Space' || code === 'Enter') && e.target?.tagName === 'BUTTON' && !(this.ui && this.ui.isCapturingInput())) e.preventDefault();
  }

  // ----- キャンバス（マウス・タッチ） -----
  bindCanvas(canvas) {
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', (e) => this.onCanvasDown(e));
    canvas.addEventListener('pointermove', (e) => {
      const rec = this.pointers.get(e.pointerId);
      if (rec && rec.kind === 'canvas') { rec.x = e.clientX; rec.y = e.clientY; }
    });
    canvas.addEventListener('pointercancel', (e) => this.releasePointer(e.pointerId));
    canvas.addEventListener('lostpointercapture', (e) => this.releasePointer(e.pointerId));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (!this.canPlay()) return;
      e.preventDefault();
      const now = performance.now();
      if (now - this.lastWheel < 80) return;
      this.lastWheel = now;
      this.pulse(e.deltaY > 0 ? 'hotNext' : 'hotPrev');
    }, { passive: false });
  }

  onCanvasDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.setDevice(e.pointerType === 'touch' ? 'touch' : 'mouse');
    safe(() => this.canvas.focus({ preventScroll: true }));
    if (!this.canPlay()) return;
    e.preventDefault();
    safe(() => this.canvas.setPointerCapture(e.pointerId));
    this.pointers.set(e.pointerId, { kind: 'canvas', x: e.clientX, y: e.clientY, timer: 0.3 });
    this.setPointer(e.clientX, e.clientY);
  }

  // ----- タッチ操作（スティックとボタン） -----
  bindTouch(root) {
    this.touchRoot = root;
    const stick = $('touch-stick');
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    if (stick) {
      stick.addEventListener('pointerdown', (e) => {
        this.setDevice('touch');
        if (!this.canPlay()) return;
        e.preventDefault();
        safe(() => stick.setPointerCapture(e.pointerId));
        this.pointers.set(e.pointerId, { kind: 'stick' });
        this.updateStick(e);
      });
      stick.addEventListener('pointermove', (e) => {
        if (this.pointers.get(e.pointerId)?.kind === 'stick') this.updateStick(e);
      });
    }
    root.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest?.('[data-input]');
      if (!btn || !root.contains(btn)) return;
      this.setDevice('touch');
      if (!this.canPlay()) return;
      e.preventDefault();
      const act = btn.dataset.input;
      safe(() => btn.setPointerCapture(e.pointerId));
      this.pointers.set(e.pointerId, { kind: 'button', act, el: btn });
      btn.dataset.pressed = 'true';
      this.pulse(act);
      if (this.sources[act]) this.setHeld(act, true, `touch:${e.pointerId}`);
    });
    root.addEventListener('pointercancel', (e) => this.releasePointer(e.pointerId));
    root.addEventListener('lostpointercapture', (e) => this.releasePointer(e.pointerId));
  }

  updateStick(e) {
    const stick = $('touch-stick');
    const rect = stick.getBoundingClientRect();
    const r = rect.width / 2;
    let dx = (e.clientX - (rect.left + r)) / r;
    let dy = (e.clientY - (rect.top + r)) / r;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const mag = Math.min(1, len);
    this.setKnob(dx * rect.width * 0.29, dy * rect.width * 0.29);
    // 中心付近は遊び（デッドゾーン）にして、外側へ向かって 0〜1 に伸ばす
    if (mag < 0.2) { this.stick.x = 0; this.stick.y = 0; } else {
      const scale = (mag - 0.2) / 0.8;
      const norm = Math.hypot(dx, dy) || 1;
      this.stick.x = (dx / norm) * scale;
      this.stick.y = (dy / norm) * scale;
    }
    this.recomputeMove();
  }

  setKnob(px, py) {
    const knob = $('touch-stick-knob');
    if (!knob) return;
    knob.style.setProperty('--dx', `${Math.round(px)}px`);
    knob.style.setProperty('--dy', `${Math.round(py)}px`);
  }

  releasePointer(id) {
    const rec = this.pointers.get(id);
    if (!rec) return;
    this.pointers.delete(id);
    if (rec.kind === 'stick') {
      this.stick.x = 0; this.stick.y = 0;
      this.setKnob(0, 0);
      this.recomputeMove();
    } else if (rec.kind === 'button') {
      rec.el.removeAttribute('data-pressed');
      if (this.sources[rec.act]) this.setHeld(rec.act, false, `touch:${id}`);
    }
  }
}

// ---------- App（保存・タブロック・設定・ライフサイクル） ----------
class App {
  constructor(parts) {
    Object.assign(this, parts); // game, store, lock, audio, renderer, input, validate, saveSettingsFn
    this.storageAvailable = !!safe(() => this.store.isAvailable());
    this.listeners = {};
    this.settings = parts.settings;
    this.prefs = this.loadPrefs();
    this.settings.reduceMotion = this.resolveReduceMotion();
    this.autoT = 0;
    this.hbT = 0;
    this.pendingSave = false;
    this.pendingT = 0;
    this.evSeq = 0;
    this.worldId = -1;
    this.synced = new Set();
    // 遊んでいるスロットを奪われたときだけ閲覧のみにする
    safe(() => this.lock.onLost((slot) => { if (slot === this.game.slot) this.markLost(); }), 'lock.onLost');
  }

  on(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, payload) { for (const fn of this.listeners[type] || []) safe(() => fn(payload), `app.${type}`); }

  // ----- 設定 -----
  loadPrefs() {
    const d = { zoom: Math.max(1, Math.min(3, Math.round(Number(this.renderer.zoom) || 2))), leftHand: false, reducedMotion: 'auto' };
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        d.zoom = clampInt(raw.zoom, 1, 3, d.zoom);
        d.leftHand = raw.leftHand === true;
        d.reducedMotion = ['auto', 'on', 'off'].includes(raw.reducedMotion) ? raw.reducedMotion : 'auto';
      }
    } catch { /* 保存できない環境では既定値 */ }
    return d;
  }

  savePrefs() { safe(() => localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs))); }

  resolveReduceMotion() {
    if (this.prefs.reducedMotion === 'on') return true;
    if (this.prefs.reducedMotion === 'off') return false;
    return osReduceMotion();
  }

  getAll() { return { ...this.settings, ...this.prefs }; }

  setSettings(partial = {}) {
    const s = this.settings;
    const p = this.prefs;
    for (const [k, v] of Object.entries(partial)) {
      if (k === 'zoom') p.zoom = clampInt(v, 1, 3, p.zoom);
      else if (k === 'leftHand') p.leftHand = v === true;
      else if (k === 'reducedMotion') p.reducedMotion = ['auto', 'on', 'off'].includes(v) ? v : 'auto';
      else if (k in s) s[k] = v;
    }
    s.volume = clampInt(s.volume, 0, 10, 7);
    s.uiScale = [100, 125, 150].includes(Number(s.uiScale)) ? Number(s.uiScale) : 100;
    if (!['auto', 'on', 'off'].includes(s.touchControls)) s.touchControls = 'auto';
    if (!['gentle', 'standard'].includes(s.difficulty)) s.difficulty = 'standard';
    for (const k of ['soundOn', 'screenShake', 'autoTool', 'showDamageNumbers', 'highContrastTelegraph', 'objectiveArrow']) s[k] = !!s[k];
    s.reduceMotion = this.resolveReduceMotion();
    this.applyOutputs();
    safe(() => this.saveSettingsFn(this.store, { ...s }), 'saveSettings');
    this.savePrefs();
    this.emit('settings', this.getAll());
  }

  resetSettings() {
    const d = settingDefaults();
    this.prefs = { zoom: this.prefs.zoom, leftHand: false, reducedMotion: 'auto' };
    // 現在のセーブの難易度は初期値に戻さない
    d.difficulty = this.game.mode === 'title' ? d.difficulty : this.settings.difficulty;
    this.setSettings({ ...d, zoom: 2, leftHand: false, reducedMotion: 'auto' });
  }

  // 設定を game / audio / renderer へ反映する
  applyOutputs() {
    const s = this.settings;
    safe(() => this.game.applySettings({ ...s }), 'game.applySettings');
    safe(() => { this.audio.setEnabled(s.soundOn); this.audio.setVolume?.(s.volume / 10); });
    safe(() => {
      this.renderer.zoom = this.prefs.zoom;
      this.renderer.reducedMotion = s.reduceMotion;
      this.renderer.resize();
    });
  }

  // 新規・読み込み後に、現在のゲームの難易度を設定側へ揃える
  syncAfterLoad() {
    const g = this.game;
    this.input.attach();
    if (typeof g.setReadOnly === 'function') g.setReadOnly(false); else { g.readOnly = false; g.setPaused('readonly', false); }
    if (g.difficulty === 'gentle' || g.difficulty === 'standard') this.settings.difficulty = g.difficulty;
    safe(() => g.applySettings({ ...this.settings }), 'game.applySettings');
    this.autoT = 0;
    this.pendingSave = false;
    this.worldId = g.worldId;
    this.evSeq = g.eventSeq || 0;
    this.input.clearAll();
  }

  // ----- タブロック -----
  heldByOther(slot) {
    if (!this.storageAvailable) return false;
    try {
      const v = JSON.parse(localStorage.getItem(`${NS}.lock.slot${slot}`) || 'null');
      if (!v || typeof v !== 'object') return false;
      if (v.tabId != null && v.tabId === this.lock.tabId) return false;
      const age=Date.now()-v.ts;
      return typeof v.tabId==='string'&&typeof v.ts==='number'&&Number.isFinite(v.ts)&&age>=0&&age<=LOCK_TTL_MS;
    } catch { return false; }
  }

  // 現在のスロットのロックを手放して、別スロットのロックを取る。失敗したら元に戻す
  switchLock(slot, takeover) {
    if (!this.storageAvailable) return { ok: true };
    const prev = this.game.mode !== 'title' ? this.game.slot : null;
    if (prev && prev !== slot) safe(() => this.lock.release());
    let r = null;
    try { r = this.lock.acquire(slot, { takeover }); } catch (e) { r = { ok: false, error: e }; }
    if (!r || !r.ok) {
      if (prev && prev !== slot) safe(() => this.lock.acquire(prev, { takeover: false }));
      return { ok: false, locked: !!(r && r.heldByOther) };
    }
    return { ok: true, prev };
  }

  revertLock(prev, slot) {
    if (!this.storageAvailable) return;
    if (prev && prev !== slot) { safe(() => this.lock.release()); safe(() => this.lock.acquire(prev, { takeover: false })); }
    else if (!prev) safe(() => this.lock.release());
  }

  // シミュレーション進行前・保存前に所有を確認する。失っていれば閲覧のみ + 一時停止
  checkOwner() {
    const g = this.game;
    if (!this.storageAvailable || g.mode === 'title' || !g.slot) return true;
    if (g.readOnly) return false;
    let ok = true;
    try {
      ok = !!this.lock.isOwner(g.slot);
      // 鼓動が遅れて期限だけ切れた場合は、他タブに奪われていなければ更新して続ける
      if (!ok && !this.lock.lost.has(g.slot)) ok = !!this.lock.ensure(g.slot).ok;
    } catch { ok = false; }
    if (!ok) this.markLost();
    return ok;
  }

  markLost() {
    const g = this.game;
    if (g.mode === 'title' || g.readOnly) return;
    if (typeof g.setReadOnly === 'function') g.setReadOnly(true); else { g.readOnly = true; g.setPaused('readonly', true); }
    this.input.clearAll();
    this.emit('lost', { slot: g.slot });
  }

  // このタブへ操作を引き継ぐ。別タブの最新の保存を読み直してから再開する（古い状態で上書きしない）
  takeControl() {
    const slot = this.game.slot;
    if (!slot) return { ok: false, error: 'スロットがありません' };
    return this.continueSlot(slot, { takeover: true });
  }

  // ----- 新規・読み込み -----
  sanitizeSeed(s) {
    return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  }

  randomSeed() {
    const w = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
    return `${w}-${1000 + Math.floor(Math.random() * 9000)}`;
  }

  newGame(slot, { seed, difficulty, takeover = false } = {}) {
    slot = Number(slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) return { ok: false, error: 'スロットが正しくありません' };
    const g = this.game;
    const sw = this.switchLock(slot, takeover);
    if (!sw.ok) return { ok: false, locked: !!sw.locked, error: 'このスロットは別のタブで使用中です' };
    const useSeed = this.sanitizeSeed(seed) || this.randomSeed();
    const diff = difficulty === 'gentle' ? 'gentle' : 'standard';
    try {
      this.settings.difficulty = diff;
      safe(() => g.applySettings({ ...this.settings }), 'game.applySettings');
      g.newGame({ slot, seed: useSeed, difficulty: diff });
    } catch (e) {
      console.error(e);
      this.revertLock(sw.prev, slot);
      return { ok: false, error: `世界を作れませんでした：${e?.message || e}` };
    }
    this.syncAfterLoad();
    this.setLastSlot(slot);
    const saved = this.saveNow({ auto: true });
    this.emit('started', { slot, kind: 'new' });
    return { ok: true, saved: saved.ok, saveError: saved.ok ? null : saved.error };
  }

  // store.read / readBackup は検証済みのセーブを返す
  readValidated(r) {
    if (!r || !r.ok || !r.save) return { ok: false, error: r?.error || 'データを読み込めませんでした', corrupt: !!r?.corrupt };
    return { ok: true, save: r.save };
  }

  loadInto(slot, reader, { takeover = false } = {}) {
    slot = Number(slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) return { ok: false, error: 'スロットが正しくありません' };
    const sw = this.switchLock(slot, takeover);
    if (!sw.ok) return { ok: false, locked: !!sw.locked, error: 'このセーブは別のタブで開かれています' };
    const v = this.readValidated(safe(reader, 'read'));
    if (!v.ok) { this.revertLock(sw.prev, slot); return { ok: false, error: v.error, corrupt: !!v.corrupt }; }
    let lr = null;
    try { lr = this.game.loadFromSave(v.save, slot); } catch (e) { lr = { ok: false, error: e?.message || String(e) }; }
    if (!lr || !lr.ok) { this.revertLock(sw.prev, slot); return { ok: false, error: lr?.error || '読み込めませんでした', corrupt: true }; }
    this.syncAfterLoad();
    this.setLastSlot(slot);
    return { ok: true };
  }

  continueSlot(slot, { takeover = false } = {}) {
    const r = this.loadInto(slot, () => this.store.read(slot), { takeover });
    if (r.ok) this.emit('started', { slot, kind: 'continue' });
    return r;
  }

  loadBackup(slot, { takeover = false } = {}) {
    const r = this.loadInto(slot, () => this.store.readBackup(slot), { takeover });
    if (!r.ok) return r;
    const saved = this.saveNow({ auto: true }); // 復元した内容を本体へ書き戻す
    this.emit('started', { slot, kind: 'backup' });
    return { ok: true, saved: saved.ok, saveError: saved.ok ? null : saved.error };
  }

  getLastSlot() { return safe(() => this.store.getLastSlot()) || null; }

  setLastSlot(slot) { safe(() => this.store.setLastSlot(slot)); }

  // ----- 保存 -----
  saveNow({ auto = false } = {}) {
    const g = this.game;
    const fail = (error, reason) => {
      const result = { ok: false, error, reason, auto, slot: g.slot };
      this.emit('save', result);
      return result;
    };
    const c = g.canSave();
    if (!c.ok) {
      const r = { ok: false, error: SAVE_REASONS[c.reason] || 'いまは保存できません', reason: c.reason, auto, slot: g.slot };
      return r; // 保存できない状況は失敗通知にしない
    }
    const slot = g.slot;
    if (!slot) return fail('保存先のスロットがありません', 'noslot');
    if (!this.checkOwner()) return fail(SAVE_REASONS.readonly, 'readonly');
    let save;
    try { save = g.toSave(); } catch (e) { console.error(e); return fail(`保存データを作れませんでした：${e?.message || e}`, 'toSave'); }
    // store.write が validateSave → ロック確認 → .bak 退避 → 書き込みを行う
    let w;
    try { w = this.store.write(slot, save, this.storageAvailable ? { lock: this.lock } : {}); } catch (e) { w = { ok: false, error: e?.message || String(e) }; }
    if (!w || !w.ok) {
      if (w && w.lost) this.markLost();
      return fail(w?.error ? String(w.error) : '保存できませんでした', w?.lost ? 'readonly' : 'write');
    }
    this.setLastSlot(slot);
    this.autoT = 0;
    this.pendingSave = false;
    for (const id of g.progress?.achievements || []) {
      if (!this.synced.has(id)) { this.synced.add(id); safe(() => this.store.addGlobalAchievement(id)); }
    }
    const result = { ok: true, auto, slot, durable: this.storageAvailable };
    this.emit('save', result);
    return result;
  }

  autosaveNow() {
    const g = this.game;
    if (g.mode === 'title' || !g.world) return null;
    const c = safe(() => g.canSave());
    return c && c.ok ? this.saveNow({ auto: true }) : null;
  }

  // ----- 書き出し・読み込み -----
  exportCurrent() {
    const g = this.game;
    if (g.mode === 'title' || !g.world) return null;
    try { return JSON.stringify(g.toSave()); } catch (e) { console.error(e); return null; }
  }

  exportSlot(slot) { return safe(() => this.store.exportSlot(slot)) || null; }

  exportFileName(slot) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `emberveil-slot${slot || 0}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  }

  downloadText(text, filename) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener'; a.hidden = true;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) { console.error(e); return false; }
  }

  summarize(save) {
    const meta = save.meta || {};
    const hearts = save.progress?.hearts;
    const count = hearts && typeof hearts === 'object' ? Object.values(hearts).filter(Boolean).length : Number(meta.hearts) || 0;
    return {
      seed: String(save.game?.seed ?? meta.seed ?? ''),
      difficulty: save.game?.difficulty ?? meta.difficulty ?? 'standard',
      playTime: Number(save.game?.playTime ?? meta.playTime) || 0,
      hearts: count,
      coreRestored: !!(save.progress?.coreRestored ?? meta.coreRestored),
      savedAt: save.savedAt || null,
    };
  }

  previewImport(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'JSONが空です' };
    if (text.length > MAX_IMPORT_CHARS) return { ok: false, error: 'データが大きすぎます（300万文字まで）' };
    let obj;
    try { obj = JSON.parse(text); } catch { return { ok: false, error: 'JSONとして読めません' }; }
    const v = safe(() => this.validate(obj));
    if (!v || !v.ok) return { ok: false, error: `検証に失敗しました：${v?.errors?.[0] || '形式が違います'}`, errors: v?.errors || [] };
    const save = v.save || obj;
    return { ok: true, summary: this.summarize(save), save };
  }

  importText(text, slot) {
    slot = Number(slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) return { ok: false, error: 'スロットが正しくありません' };
    const pv = this.previewImport(text);
    if (!pv.ok) return pv;
    const g = this.game;
    const same = g.mode !== 'title' && g.slot === slot;
    if (same ? !this.checkOwner() : this.heldByOther(slot)) return { ok: false, locked: true, error: 'このスロットは別のタブで使用中です' };
    let w;
    let acquired=false;
    try {
      if(this.storageAvailable&&!same){const lock=this.lock.acquire(slot);if(!lock.ok)return {ok:false,locked:true,error:'このスロットは別のタブで使用中です'};acquired=true;}
      w = this.store.write(slot, pv.save,this.storageAvailable?{lock:this.lock}:{});
    } catch (e) { w = { ok: false, error: e?.message || String(e) }; }
    finally {if(acquired)this.lock.release(slot);}
    if (!w || !w.ok) return { ok: false, error: w?.error ? String(w.error) : '書き込めませんでした' };
    if (same) { // 遊んでいる最中のスロットなら、メモリ上の状態もそろえる（古い状態で上書きし直さない）
      const lr = safe(() => g.loadFromSave(pv.save, slot));
      if (lr && lr.ok) this.syncAfterLoad();
      return { ok: true, summary: pv.summary, replacedCurrent: !!(lr && lr.ok) };
    }
    return { ok: true, summary: pv.summary, replacedCurrent: false };
  }

  deleteSlot(slot) {
    const g = this.game;
    if (g.mode !== 'title' && g.slot === slot) return { ok: false, error: 'プレイ中のスロットは消せません。タイトルへ戻ってから消してください' };
    if (this.heldByOther(slot)) return { ok: false, error: 'このスロットは別のタブで使用中です' };
    let acquired=false;
    try {
      if(this.storageAvailable){const lock=this.lock.acquire(slot);if(!lock.ok)return {ok:false,locked:true,error:'このスロットは別のタブで使用中です'};acquired=true;}
      const r=this.store.remove(slot);if(!r?.ok)return {ok:false,error:'記録を消せませんでした'};
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    finally {if(acquired)this.lock.release(slot);}
    return { ok: true };
  }

  listSlots() {
    let list = [];
    try { list = this.store.listSlots() || []; } catch { list = []; }
    const g = this.game;
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const slot = i + 1;
      const info = list.find((x) => x && x.slot === slot) || { slot, exists: false };
      return { ...info, slot, current: g.mode !== 'title' && g.slot === slot };
    });
  }

  quitToTitle({ save = true } = {}) {
    const g = this.game;
    let saved = null;
    if (save && g.mode !== 'title' && g.world) saved = this.autosaveNow();
    safe(() => this.lock.release());
    g.readOnly = false;
    g.resetToTitle();
    for (const r of [...(g.pauseReasons || [])]) g.setPaused(r, false);
    if (document.hidden) g.setPaused('hidden', true);
    this.input.clearAll();
    this.input.attach();
    this.pendingSave = false;
    this.emit('title', {});
    return saved;
  }

  // ----- 毎フレーム -----
  heartbeat() {
    const g = this.game;
    if (!this.storageAvailable || g.mode === 'title' || !g.slot || g.readOnly) return;
    safe(() => this.lock.heartbeat());
    this.checkOwner();
  }

  pollEvents() {
    const g = this.game;
    if (g.worldId !== this.worldId) { this.worldId = g.worldId; this.evSeq = g.eventSeq || 0; }
    const events = safe(() => g.pollEvents(this.evSeq)) || [];
    for (const e of events) {
      this.evSeq = e.seq;
      if (AUTOSAVE_EVENTS.has(e.type)) this.pendingSave = true;
    }
  }

  tick(dt) {
    const g = this.game;
    this.pollEvents();
    if (g.mode === 'title' || !g.world) { this.pendingSave = false; return; }
    if (g.isSimRunning() && g.mode === 'playing') {
      this.autoT += dt;
      if (this.autoT >= AUTOSAVE_SEC) this.autosaveOrDefer();
    }
    if (this.pendingSave) {
      this.pendingT += dt;
      if (this.pendingT >= 1) { this.pendingT = 0; this.autosaveOrDefer(true); }
    }
  }

  // ボス戦中などは保存できないので、できる状態になるまで待つ
  autosaveOrDefer(fromPending = false) {
    const c = safe(() => this.game.canSave());
    if (!c) return;
    if (c.ok) { this.saveNow({ auto: true }); return; }
    if (['boss', 'dead', 'ending'].includes(c.reason)) { if (!fromPending) this.autoT = AUTOSAVE_SEC - 5; return; }
    this.pendingSave = false; this.autoT = 0;
  }
}

// ---------- 起動 ----------
const boot$ = { ctx: null, booted: false, retrying: false };

function setLoadingText(text) {
  const el = $('loading-text');
  if (el) el.textContent = text;
}

function showFatal(err, { reloadOnly = false } = {}) {
  console.error(err);
  $('loading-screen')?.setAttribute('hidden', '');
  $('title-screen')?.setAttribute('hidden', '');
  $('hud')?.setAttribute('hidden', '');
  const msg = $('error-message');
  const detail = $('error-detail');
  if (msg) msg.textContent = reloadOnly ? 'ファイルの読み込みに失敗しました。ページを再読み込みしてください。' : '起動中に問題が起きました。もう一度試すか、ページを再読み込みしてください。';
  if (detail) detail.textContent = String(err?.stack || err?.message || err);
  $('error-screen')?.removeAttribute('hidden');
  $('btn-error-retry')?.focus();
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))]);
}

const stubRenderer = () => ({
  zoom: 2, reducedMotion: false, camera: { x: 0, y: 0 }, stub: true,
  async load() {}, resize() {}, render() {}, screenToWorld() { return null; }, drawMinimap() {},
});
const stubAudio = () => ({ enabled: true, async unlock() {}, setEnabled() {}, setVolume() {}, update() {}, play() {}, stub: true });

async function loadModules() {
  const warnings = [];
  const [dataMod, worldMod, uiMod] = await Promise.all([import('./data.js'), import('./world.js'), import('./ui.js')]);
  for (const name of ['Game', 'SaveStore', 'TabLock', 'validateSave', 'loadSettings', 'saveSettings']) {
    if (typeof worldMod[name] !== 'function') throw new Error(`world.js に ${name} がありません`);
  }
  if (!dataMod.DATA) throw new Error('data.js に DATA がありません');
  if (typeof uiMod.UI !== 'function') throw new Error('ui.js に UI がありません');
  let renderMod = null;
  let audioMod = null;
  try { renderMod = await import('./render.js'); } catch (e) { console.error(e); warnings.push('描画'); }
  try { audioMod = await import('./audio.js'); } catch (e) { console.error(e); warnings.push('音'); }
  return { dataMod, worldMod, uiMod, renderMod, audioMod, warnings };
}

async function boot() {
  const canvas = $('world-canvas');
  setLoadingText('庭を目覚めさせています…');
  const mods = boot$.mods ||= await loadModules();
  const { DATA } = mods.dataMod;
  const { Game, SaveStore, TabLock, validateSave, loadSettings, saveSettings } = mods.worldMod;

  const c = boot$.ctx ||= {};
  const warnings = [...mods.warnings];
  c.store ||= new SaveStore();
  if (!c.settings) {
    const loaded = safe(() => loadSettings(c.store), 'loadSettings');
    c.settings = { ...settingDefaults(), ...(loaded && typeof loaded === 'object' ? loaded : {}) };
  }
  c.game ||= new Game(DATA);
  c.lock ||= new TabLock(c.store); // 同じSaveStoreを共有する（キー名前空間をそろえる）
  if (!c.renderer) {
    try {
      c.renderer = mods.renderMod ? new mods.renderMod.Renderer(canvas, c.game) : stubRenderer();
    } catch (e) { console.error(e); warnings.push('描画'); c.renderer = stubRenderer(); }
  }
  if (!c.audio) {
    try { c.audio = mods.audioMod ? new mods.audioMod.AudioEngine() : stubAudio(); } catch (e) { console.error(e); warnings.push('音'); c.audio = stubAudio(); }
  }
  c.input ||= new Input(c.game);
  c.app ||= new App({
    game: c.game, store: c.store, lock: c.lock, audio: c.audio, renderer: c.renderer, input: c.input,
    validate: validateSave, saveSettingsFn: saveSettings, settings: c.settings,
  });
  c.ui ||= new mods.uiMod.UI(c.game, { app: c.app, input: c.input, renderer: c.renderer, audio: c.audio, store: c.store });
  const { game, app, ui, input, renderer, audio, store } = c;

  window.emberveil = { game, app, ui, input, renderer, audio, store };

  if (!c.wired) {
    c.wired = true;
    input.renderer = renderer;
    input.ui = ui;
    ui.init();
    ui.setDegraded(warnings);
    input.bindWindow(ui);
    input.bindCanvas(canvas);
    const touchRoot = $('touch-controls');
    if (touchRoot) input.bindTouch(touchRoot);
    app.applyOutputs();
    ui.applySettings();
    wireLifecycle(c);
  }

  setLoadingText('素材を読み込んでいます…');
  try {
    const r = await withTimeout(Promise.resolve(renderer.load()), LOAD_TIMEOUT_MS);
    if (r === 'timeout') ui.setDegraded([...warnings, '描画（読み込みが長引いたため簡易表示）']);
  } catch (e) {
    console.error(e);
    ui.setDegraded([...warnings, '画像']);
  }
  safe(() => renderer.resize());
  safe(() => ui.onResize());
  ui.showScreen('title');
  if (!c.looping) { c.looping = true; startLoop(c); }
  boot$.booted = true;
}

function wireLifecycle(c) {
  const { game, app, ui, input, renderer, audio } = c;

  const onResize = () => safe(() => { renderer.resize(); ui.onResize(); }, 'resize');
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => { onResize(); setTimeout(onResize, 250); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      input.clearAll();
      if (game.mode !== 'title') {
        if (game.mode === 'playing' && !ui.isCapturingInput()) safe(() => ui.showScreen('pause'));
        app.autosaveNow();
        game.setPaused('hidden', true);
      }
    } else {
      game.setPaused('hidden', false);
      c.last = performance.now(); // 復帰直後に巨大なdtを食べない
      app.heartbeat();
    }
  });
  window.addEventListener('pagehide', (event) => {
    app.autosaveNow();
    if(!event.persisted)safe(() => app.lock.release());
  });
  window.addEventListener('pageshow',(event)=>{
    if(!event.persisted)return;
    input.clearAll();c.last=performance.now();app.checkOwner();app.heartbeat();
  });

  // バックグラウンドでもロックの鼓動を止めない
  setInterval(() => app.heartbeat(), HEARTBEAT_MS);

  // 最初の操作で音を有効にする
  const unlock = () => {
    if (audio.ctx && audio.ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      return;
    }
    Promise.resolve(safe(() => audio.unlock())).then(() => {
      safe(() => { audio.setEnabled(app.settings.soundOn); audio.setVolume?.(app.settings.volume / 10); });
    }).catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  $('btn-take-control')?.addEventListener('click', () => ui.requestTakeControl());
}

function startLoop(c) {
  const { game, app, ui, input, renderer, audio } = c;
  let acc = 0;
  let faults = 0;
  c.last = performance.now();

  const frame = (now) => {
    requestAnimationFrame(frame); // 先に予約して、例外でループが止まらないようにする
    let dt = (now - c.last) / 1000;
    c.last = now;
    if (!(dt >= 0)) dt = 0;
    dt = Math.min(dt, 0.25);

    safe(() => input.tick(dt), 'input.tick');
    safe(() => app.checkOwner(), 'checkOwner');
    if (game.isSimRunning()) {
      acc += dt;
      let n = 0;
      // 途中で一時停止（箱を開く・別タブに奪われる等）したら、その場で止める
      while (acc >= STEP && n < MAX_STEPS && game.isSimRunning()) {
        try { game.update(STEP); faults = 0; } catch (e) {
          console.error('game.update', e);
          if (++faults >= 30) { // 毎ステップ失敗する場合は、いったん止めて知らせる
            faults = 0;
            acc = 0;
            safe(() => ui.showScreen('pause'));
            safe(() => ui.toast('内部エラーが続いたため一時停止しました。保存してタイトルへ戻ることをおすすめします。', 'danger', { persist: true }));
            break;
          }
        }
        input.endStep();
        acc -= STEP;
        n++;
      }
      if (n === MAX_STEPS) acc = 0;
    } else {
      acc = 0;
      input.clearAll();
    }
    safe(() => renderer.render(dt), 'render');
    safe(() => audio.update(game, dt), 'audio');
    safe(() => ui.update(dt), 'ui');
    safe(() => app.tick(dt), 'app.tick');
  };
  requestAnimationFrame(frame);
}

function start() {
  $('btn-error-reload')?.addEventListener('click', () => location.reload());
  $('btn-error-retry')?.addEventListener('click', () => {
    if (boot$.retrying) return;
    if (!boot$.mods) { location.reload(); return; }
    boot$.retrying = true;
    $('error-screen')?.setAttribute('hidden', '');
    $('loading-screen')?.removeAttribute('hidden');
    boot().catch((e) => showFatal(e)).finally(() => { boot$.retrying = false; });
  });
  window.addEventListener('error', (e) => { if (!boot$.booted) showFatal(e.error || e.message); });
  boot().catch((e) => showFatal(e, { reloadOnly: !boot$.mods }));
}

start();
