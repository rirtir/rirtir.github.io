(function () {
  'use strict';

  /* ================================================================
   * 定数
   * ============================================================== */
  const KEY = 'starsprout.v1';
  const BAK_KEY = KEY + '.bak';
  const OWNER_KEY = KEY + '.owner';
  const VER = 1;

  const STAGES = [0, 30, 300, 1500, 6000];
  const STAGE_NAMES = ['種', '芽', '若葉', 'つぼみ', '星の花'];
  const STAGE_POEMS = [
    'まだ眠る小さな種。ひとしずくの水を、夜がそっと待っています。',
    '土のなかから、ちいさな芽がひとつ。星明かりを確かめています。',
    '葉がひらき、温室に夜風が通りはじめました。',
    'つぼみの奥で、星のかけらがゆっくり灯ります。',
    '星の花が咲きました。夜の庭が、やさしく明るくなります。'
  ];
  const HARVEST_BASE = 6000;

  const MAX_LV = 100;
  const CAP = 1e15;            // しずく・累積の上限
  const MAX_STARS = 9999;
  const MAX_TAPS = 1e12;
  const MAX_TIME = 8.64e15;    // Date の最大値

  const ONLINE_MAX_MS = 1000;                 // これ以下の差分は通常進行（100%）
  const OFFLINE_MAX_MS = 8 * 3600 * 1000;     // オフライン上限 8時間
  const OFFLINE_RATE = 0.5;                   // オフライン効率 50%
  const OFFLINE_NOTICE_MS = 30 * 1000;        // この長さ以上で帰還ダイアログを出す

  const TICK_MS = 200;
  const SAVE_INTERVAL_MS = 5000;
  const SAVE_SOON_MS = 800;
  const HEARTBEAT_MS = 2000;
  const OWNER_STALE_MS = 7000;
  const DROPS_LIVE_MS = 10000;

  const ITEMS = [
    { id: 'w', name: '露のじょうろ', icon: 'i-can', base: 10, growth: 1.45 },
    { id: 'l', name: '月光ランプ', icon: 'i-lamp', base: 25, growth: 1.40 },
    { id: 'p', name: '星砂の鉢', icon: 'i-pot', base: 300, growth: 2.0 }
  ];

  const ACHS = [
    { id: 'first', name: '初しずく', desc: 'しずくを1回集める', test: (s) => s.tapCount >= 1 },
    { id: 'tap100', name: '100タップ', desc: '合計100回タップする', test: (s) => s.tapCount >= 100 },
    { id: 'lamp5', name: 'ランプLv5', desc: '月光ランプをLv5にする', test: (s) => s.lv.l >= 5 },
    { id: 'pot', name: '鉢を購入', desc: '星砂の鉢を購入する', test: (s) => s.lv.p >= 1 },
    { id: 'bud', name: 'つぼみ到達', desc: 'つぼみの段階まで育てる', test: (s) => stageOf(s.total) >= 3 },
    { id: 'star1', name: '初めての星', desc: 'はじめて星を収穫する', test: (s) => s.stars >= 1 },
    { id: 'star5', name: '星5個', desc: '星を5個集める', test: (s) => s.stars >= 5 },
    { id: 'offline', name: 'オフライン帰還', desc: '30秒以上の留守のあいだに集まったしずくを受け取る', test: null }
  ];
  const ACH_IDS = ACHS.map((a) => a.id);

  /* ================================================================
   * 計算
   * ============================================================== */
  function price(item, n) { return Math.floor(item.base * Math.pow(item.growth, n)); }
  function mult(s) { return (1 + 0.25 * s.lv.p) * (1 + 0.1 * s.stars); }
  function tapGain(s) { return (1 + s.lv.w) * mult(s); }
  function perSec(s) { return (0.5 + 1.0 * s.lv.l) * mult(s); }

  function stageOf(total) {
    let st = 0;
    for (let i = 0; i < STAGES.length; i++) if (total >= STAGES[i]) st = i;
    return st;
  }

  // 獲得数 = 1 + floor(log2(累積 / 6000))。浮動小数の誤差を避けるため倍々で判定する
  function harvestGain(total) {
    if (!(total >= HARVEST_BASE)) return 0;
    let g = 1;
    let t = HARVEST_BASE * 2;
    while (total >= t) { g++; t *= 2; }
    return g;
  }

  // 設備を1段階上げたときの状態（効果の「→」表示用）
  function withLv(s, id) {
    const lv = { w: s.lv.w, l: s.lv.l, p: s.lv.p };
    lv[id] = Math.min(MAX_LV, lv[id] + 1);
    return { lv: lv, stars: s.stars };
  }

  /* ================================================================
   * 表示用フォーマット（桁が増えても崩れない短い表記）
   * ============================================================== */
  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa'];

  function compact(n) {
    let exp = Math.floor(Math.log10(n) / 3);
    if (exp > 5) return n.toExponential(2).replace('e+', 'e');
    let v = n / Math.pow(1000, exp);
    let str = v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0);
    if (parseFloat(str) >= 1000) {
      exp++;
      if (exp > 5) return n.toExponential(2).replace('e+', 'e');
      v /= 1000;
      str = v.toFixed(2);
    }
    return str + SUFFIX[exp];
  }

  function fmtInt(n) {
    if (!(n > 0) || !isFinite(n)) return '0';
    n = Math.floor(n);
    return n < 1e6 ? n.toLocaleString('en-US') : compact(n);
  }

  function fmtRate(n) {
    if (!(n > 0) || !isFinite(n)) return '0';
    if (n < 1000) return String(parseFloat(n.toFixed(n < 100 ? 2 : 1)));
    return fmtInt(n);
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return h + '時間' + m + '分';
    if (m > 0) return m + '分' + s + '秒';
    return s + '秒';
  }

  /* ================================================================
   * 状態と保存データの検証
   * ============================================================== */
  function defaultState() {
    return {
      ver: VER,
      drops: 0,
      total: 0,
      lv: { w: 0, l: 0, p: 0 },
      stars: 0,
      ach: [],
      tapCount: 0,
      lastSeen: Date.now(),
      settings: { reduce: null }
    };
  }

  function isNum(v, max) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= max; }
  function isInt(v, max) { return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max; }

  // 正しければ正規化した状態、不正なら null
  function validate(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (o.ver !== VER) return null;
    if (!isNum(o.drops, CAP) || !isNum(o.total, CAP)) return null;
    const lv = o.lv;
    if (!lv || typeof lv !== 'object') return null;
    if (!isInt(lv.w, MAX_LV) || !isInt(lv.l, MAX_LV) || !isInt(lv.p, MAX_LV)) return null;
    if (!isInt(o.stars, MAX_STARS) || !isInt(o.tapCount, MAX_TAPS)) return null;
    if (!isNum(o.lastSeen, MAX_TIME)) return null;
    if (!Array.isArray(o.ach) || o.ach.length > 64) return null;
    const ach = [];
    for (let i = 0; i < o.ach.length; i++) {
      if (typeof o.ach[i] !== 'string') return null;
      if (ACH_IDS.indexOf(o.ach[i]) >= 0 && ach.indexOf(o.ach[i]) < 0) ach.push(o.ach[i]);
    }
    let reduce = null;
    if (o.settings && typeof o.settings === 'object' && typeof o.settings.reduce === 'boolean') {
      reduce = o.settings.reduce;
    }
    return {
      ver: VER,
      drops: o.drops,
      total: o.total,
      lv: { w: lv.w, l: lv.l, p: lv.p },
      stars: o.stars,
      ach: ach,
      tapCount: o.tapCount,
      lastSeen: o.lastSeen,
      settings: { reduce: reduce }
    };
  }

  function serialize() {
    return JSON.stringify({
      ver: VER,
      drops: state.drops,
      total: state.total,
      lv: { w: state.lv.w, l: state.lv.l, p: state.lv.p },
      stars: state.stars,
      ach: state.ach,
      tapCount: state.tapCount,
      lastSeen: state.lastSeen,
      settings: { reduce: state.settings.reduce }
    });
  }

  /* ================================================================
   * グローバルな実行時状態
   * ============================================================== */
  const $ = (id) => document.getElementById(id);
  const E = {};
  const mono = () => (window.performance && performance.now ? performance.now() : Date.now());

  let state = null;
  let store = null;            // localStorage（使えなければ null）
  let saveError = false;
  let role = 'owner';          // 'owner' = 進行・保存する / 'secondary' = 停止中
  let curStage = -1;
  let lastSave = 0;
  let lastDropsLive = 0;
  let lastDropsText = '';
  let saveTimer = 0;
  let confirmCb = null;
  let activeTab = null;
  const tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);

  /* ================================================================
   * 時間の進行（唯一の経路）
   *   state.lastSeen = 「ここまで計上済み」の時刻。
   *   通常進行・非表示からの復帰・リロードはすべて settle() を通るので二重計上されない。
   * ============================================================== */
  function addDrops(g) {
    if (!(g > 0) || !isFinite(g)) return;
    state.drops = Math.min(CAP, state.drops + g);
    state.total = Math.min(CAP, state.total + g);
  }

  function settle(now) {
    const el = now - state.lastSeen;
    if (isNaN(el) || el < 0) {          // 時計の巻き戻し：加算せず基準だけ更新
      state.lastSeen = now;
      return null;
    }
    if (el === 0) return null;
    const rate = perSec(state);
    if (el <= ONLINE_MAX_MS) {
      addDrops(rate * el / 1000);
      state.lastSeen = now;
      return null;
    }
    const capped = Math.min(el, OFFLINE_MAX_MS);
    const gain = rate * (capped / 1000) * OFFLINE_RATE;
    addDrops(gain);
    state.lastSeen = now;
    return { gain: gain, seconds: capped / 1000, capped: el > OFFLINE_MAX_MS };
  }

  function step(now) {
    if (role !== 'owner') return null;
    const r = settle(now);
    if (r) onOffline(r);
    afterChange(false);
    return r;
  }

  /* ================================================================
   * 保存・読み込み・複数タブ
   * ============================================================== */
  function getStore() {
    try {
      const s = window.localStorage;
      const k = '__ssg_test__';
      s.setItem(k, '1');
      s.removeItem(k);
      return s;
    } catch (e) {
      return null;
    }
  }

  function readStored() {
    let raw = null;
    try { raw = store.getItem(KEY); } catch (e) { return { status: 'error' }; }
    if (raw === null) return { status: 'none' };
    try {
      const s = validate(JSON.parse(raw));
      if (s) return { status: 'ok', state: s };
    } catch (e) { /* 壊れたJSON */ }
    return { status: 'corrupt', raw: raw };
  }

  function backupCorrupt(raw) {
    let ok = false;
    try { store.setItem(BAK_KEY, raw); ok = true; } catch (e) { ok = false; }
    notify(ok
      ? '保存データが壊れていたため、最初から始めました。元のデータは「' + BAK_KEY + '」に退避しています。'
      : '保存データが壊れていたため、最初から始めました。元のデータは退避できませんでした。');
  }

  // 所有タブとして読み込む。より新しい保存があれば採用する
  function loadOwned() {
    const res = readStored();
    if (res.status === 'ok') {
      if (!state || res.state.lastSeen > state.lastSeen) {
        state = res.state;
        return true;
      }
      return false;
    }
    if (res.status === 'corrupt') backupCorrupt(res.raw);
    if (!state) state = defaultState();
    return false;
  }

  function readOwner() {
    try {
      const v = store.getItem(OWNER_KEY);
      if (!v) return null;
      const o = JSON.parse(v);
      if (o && typeof o.id === 'string' && typeof o.t === 'number' && isFinite(o.t)) return o;
    } catch (e) { /* 無視 */ }
    return null;
  }
  function writeOwner() {
    try { store.setItem(OWNER_KEY, JSON.stringify({ id: tabId, t: Date.now() })); } catch (e) { /* 無視 */ }
  }
  function releaseOwner() {
    try {
      const o = readOwner();
      if (o && o.id === tabId) store.removeItem(OWNER_KEY);
    } catch (e) { /* 無視 */ }
  }
  function otherFresh(o) {
    return !!o && o.id !== tabId && Math.abs(Date.now() - o.t) < OWNER_STALE_MS;
  }

  // 保存の直前に所有権を確認する。他のタブが持っていれば保存せず停止側に回る
  function verifyOwner() {
    if (!store) return true;
    if (otherFresh(readOwner())) { demote(); return false; }
    return true;
  }

  function save() {
    lastSave = mono();
    if (!store || role !== 'owner') return false;
    if (!verifyOwner()) return false;
    try {
      store.setItem(KEY, serialize());
      if (saveError) { saveError = false; renderBadge(); }
      return true;
    } catch (e) {
      if (!saveError) {
        saveError = true;
        notify('保存に失敗しました（容量不足など）。このまま遊べますが、進み具合は保存されません。');
        renderBadge();
      }
      return false;
    }
  }

  // タップなど高頻度の操作用：まとめて保存
  function saveSoon() {
    if (saveTimer || !store) return;
    saveTimer = setTimeout(function () { saveTimer = 0; save(); }, SAVE_SOON_MS);
  }

  function demote() {
    if (role === 'secondary') return;
    role = 'secondary';
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    [E.dlgConfirm, E.dlgOffline].forEach(function (d) { if (d.open) d.close(); });
    renderRole();
    renderBadge();
  }

  function takeOver() {
    if (store) {
      loadOwned();
      writeOwner();
    }
    role = 'owner';
    syncStage(true);
    renderAch();
    renderRole();
    step(Date.now());
    render();
    save();
    E.collect.focus();
  }

  function pauseTab() {
    if (role !== 'owner') return;
    step(Date.now());
    save();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    if (store) releaseOwner();
  }

  function resumeTab() {
    if (!store) {
      step(Date.now());
      render();
      return;
    }
    if (role === 'secondary') {
      // 相手が既にいなければそのまま引き継ぐ
      if (!otherFresh(readOwner())) takeOver();
      return;
    }
    if (otherFresh(readOwner())) { demote(); return; }
    if (loadOwned()) { syncStage(true); renderAch(); }
    writeOwner();
    step(Date.now());
    render();
    save();
  }

  function onStorage(e) {
    if (!store || e.storageArea !== store) return;
    if (role === 'owner') {
      if (e.key === OWNER_KEY || e.key === KEY) verifyOwner();
    } else if (e.key === KEY && e.newValue) {
      // 停止中のタブは最新の保存内容を表示だけ追従する
      try {
        const s = validate(JSON.parse(e.newValue));
        if (s) { state = s; syncStage(true); renderAch(); render(); }
      } catch (err) { /* 無視 */ }
    }
  }

  /* ================================================================
   * 通知・読み上げ
   * ============================================================== */
  let liveQueue = [];
  let liveTimer = 0;
  let liveFlip = false;

  function announce(msg) {
    liveQueue.push(msg);
    if (liveTimer) return;
    liveTimer = setTimeout(function () {
      liveTimer = 0;
      liveFlip = !liveFlip;
      E.liveMain.textContent = liveQueue.join('。') + (liveFlip ? '' : '​');
      liveQueue = [];
    }, 150);
  }

  function toast(msg) {
    while (E.toasts.childElementCount >= 3) E.toasts.removeChild(E.toasts.firstChild);
    const t = document.createElement('p');
    t.className = 'toast';
    t.textContent = msg;
    E.toasts.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4200);
  }

  function notify(msg) {
    const exist = E.notices.querySelectorAll('.notice-text');
    for (let i = 0; i < exist.length; i++) if (exist[i].textContent === msg) return;
    const box = document.createElement('div');
    box.className = 'notice';
    box.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg><p class="notice-text"></p>' +
      '<button type="button" class="notice-close" aria-label="お知らせを閉じる">閉じる</button>';
    box.querySelector('.notice-text').textContent = msg;
    box.querySelector('.notice-close').addEventListener('click', function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    });
    E.notices.appendChild(box);
  }

  function maybeAnnounceDrops() {
    const t = mono();
    if (t < lastDropsLive) lastDropsLive = t;
    if (t - lastDropsLive < DROPS_LIVE_MS) return;
    const text = 'しずく ' + fmtInt(state.drops) + '、毎秒 ' + fmtRate(perSec(state));
    if (text === lastDropsText) return;
    lastDropsLive = t;
    lastDropsText = text;
    E.liveDrops.textContent = text;
  }

  /* ================================================================
   * 実績
   * ============================================================== */
  function unlock(id) {
    if (state.ach.indexOf(id) >= 0) return;
    state.ach.push(id);
    const a = ACHS[ACH_IDS.indexOf(id)];
    announce('実績解除、' + a.name);
    toast('実績解除　' + a.name);
    renderAch();
    saveSoon();
  }

  function checkAch() {
    for (let i = 0; i < ACHS.length; i++) {
      const a = ACHS[i];
      if (a.test && state.ach.indexOf(a.id) < 0 && a.test(state)) unlock(a.id);
    }
  }

  /* ================================================================
   * ダイアログ
   * ============================================================== */
  let supportsDialog = false;

  function openDialog(dlg, opener, focusEl) {
    dlg._opener = opener || document.activeElement;
    dlg.returnValue = '';
    dlg.showModal();
    if (focusEl) focusEl.focus();
  }

  function restoreFocus(dlg) {
    const op = dlg._opener;
    dlg._opener = null;
    if (op && op.isConnected && typeof op.focus === 'function' && !op.closest('[inert]')) op.focus();
    else if (E.collect && !E.collect.closest('[inert]')) E.collect.focus();
  }

  function trapTab(dlg, e) {
    if (e.key !== 'Tab') return;
    const f = Array.prototype.slice.call(dlg.querySelectorAll('button:not([disabled])'));
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function confirmDialog(opts, onOk) {
    if (!supportsDialog) {
      if (window.confirm(opts.body)) onOk();
      return;
    }
    E.dcTitle.textContent = opts.title;
    E.dcBody.textContent = opts.body;
    E.dcOk.textContent = opts.okLabel;
    E.dcOk.classList.toggle('btn-danger', !!opts.danger);
    E.dcOk.classList.toggle('btn-primary', !opts.danger);
    confirmCb = onOk;
    openDialog(E.dlgConfirm, document.activeElement, E.dcCancel);
  }

  function onOffline(r) {
    if (r.seconds * 1000 < OFFLINE_NOTICE_MS || r.gain <= 0) return;
    unlock('offline');
    const msg = fmtDuration(r.seconds) + 'のあいだ留守にしていました。しずくを ' + fmtInt(r.gain) +
      ' 集めてくれました（効率50%' + (r.capped ? '・上限8時間' : '') + '）。';
    if (!supportsDialog) { toast(msg); return; }
    if (E.dlgOffline.open) return;
    E.doBody.textContent = msg;
    openDialog(E.dlgOffline, document.activeElement, E.doOk);
  }

  /* ================================================================
   * 操作
   * ============================================================== */
  function reduced() {
    if (state.settings.reduce !== null) return state.settings.reduce;
    return !!(E.mq && E.mq.matches);
  }

  function applyMotion() {
    document.documentElement.setAttribute('data-motion', reduced() ? 'reduce' : 'full');
    E.motionSw.setAttribute('aria-checked', reduced() ? 'true' : 'false');
  }

  function spawnFx(g) {
    if (reduced() || E.fx.childElementCount > 16) return;
    const plus = document.createElement('b');
    plus.className = 'fx-plus';
    plus.textContent = '+' + fmtRate(g);
    plus.style.left = (40 + Math.random() * 20) + '%';
    E.fx.appendChild(plus);
    setTimeout(function () { if (plus.parentNode) plus.parentNode.removeChild(plus); }, 1000);
    for (let i = 0; i < 5; i++) {
      const sp = document.createElement('i');
      sp.className = 'fx-spark';
      const ang = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 50;
      sp.style.setProperty('--dx', Math.round(Math.cos(ang) * dist) + 'px');
      sp.style.setProperty('--dy', Math.round(Math.sin(ang) * dist - 20) + 'px');
      sp.style.left = (44 + Math.random() * 12) + '%';
      E.fx.appendChild(sp);
      setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 800);
    }
  }

  function tap() {
    if (role !== 'owner') return;
    step(Date.now());
    const g = tapGain(state);
    addDrops(g);
    state.tapCount = Math.min(MAX_TAPS, state.tapCount + 1);
    afterChange(false);
    render();
    spawnFx(g);
    saveSoon();
  }

  function buy(id) {
    if (role !== 'owner') return;
    step(Date.now());
    const item = ITEMS.filter(function (it) { return it.id === id; })[0];
    if (!item) return;
    const n = state.lv[id];
    if (n >= MAX_LV) { announce(item.name + 'は最大レベルです'); return; }
    const cost = price(item, n);
    if (state.drops < cost) { announce('しずくが足りません'); return; }
    state.drops = Math.max(0, state.drops - cost);
    state.lv[id] = n + 1;
    announce(item.name + ' Lv' + (n + 1) + 'になりました');
    afterChange(false);
    render();
    save();
  }

  function askHarvest() {
    if (role !== 'owner') return;
    step(Date.now());
    const g = harvestGain(state.total);
    if (g <= 0) {
      announce('星の花が咲くと収穫できます');
      return;
    }
    confirmDialog({
      title: '星を収穫しますか？',
      body: '星を ' + g + ' 個受け取ります。しずく・設備・累積はリセットされ、星と実績は残ります。' +
        '星1つにつき全体が10%増えます。',
      okLabel: '収穫する',
      danger: false
    }, doHarvest);
  }

  function doHarvest() {
    if (role !== 'owner') return;
    step(Date.now());
    const g = harvestGain(state.total);
    if (g <= 0) return;
    state.stars = Math.min(MAX_STARS, state.stars + g);
    state.drops = 0;
    state.total = 0;
    state.lv = { w: 0, l: 0, p: 0 };
    state.lastSeen = Date.now();
    announce('星を' + g + '個収穫しました。新しい庭が始まります');
    toast('星を ' + g + ' 個収穫しました');
    afterChange(false);
    render();
    save();
  }

  function askReset() {
    confirmDialog({
      title: 'データを初期化しますか？',
      body: 'しずく・設備・星・実績など、すべての進み具合が消えます。この操作は元に戻せません。',
      okLabel: '初期化する',
      danger: true
    }, doReset);
  }

  function doReset() {
    if (role !== 'owner') return;
    const keep = state.settings;
    state = defaultState();
    state.settings = keep;
    syncStage(true);
    renderAch();
    render();
    save();
    announce('初期化しました');
    toast('初期化しました');
  }

  /* ================================================================
   * 描画
   * ============================================================== */
  function setText(el, v) {
    if (el._t !== v) { el.textContent = v; el._t = v; }
  }
  function setAttr(el, name, v) {
    v = String(v);
    if (!el._a) el._a = {};
    if (el._a[name] !== v) { el.setAttribute(name, v); el._a[name] = v; }
  }

  function afterChange(silent) {
    syncStage(silent);
    if (role === 'owner') checkAch();
  }

  function syncStage(silent) {
    const st = stageOf(state.total);
    if (st === curStage) return;
    const prev = curStage;
    curStage = st;
    E.plant.src = 'assets/stage-' + st + '.svg';
    E.plant.alt = '第' + (st + 1) + '段階「' + STAGE_NAMES[st] + '」の星の植物';
    setText(E.stageName, STAGE_NAMES[st]);
    setText(E.stagePoem, STAGE_POEMS[st]);
    setText(E.stageChip, 'STAGE ' + (st + 1) + ' / 5');
    if (!silent && prev >= 0 && st > prev) {
      announce('「' + STAGE_NAMES[st] + '」の段階になりました。' + STAGE_POEMS[st]);
      E.plant.classList.remove('pop');
      void E.plant.offsetWidth;
      E.plant.classList.add('pop');
    }
  }

  function renderBadge() {
    let text = '自動保存';
    let st = 'ok';
    let desc = '自動保存が有効です。操作したときと5秒ごとに保存します。';
    if (role === 'secondary') {
      text = '保存停止中';
      st = 'warn';
      desc = '他のタブで開かれているため、このタブは保存を停止しています。';
    } else if (!store) {
      text = '保存不可';
      st = 'error';
      desc = 'このブラウザでは保存できません。遊べますが、閉じると進み具合は消えます。';
    } else if (saveError) {
      text = '保存失敗';
      st = 'error';
      desc = '保存に失敗しました。このまま遊べますが、進み具合は保存されません。';
    }
    setText(E.badgeSaveText, text);
    setAttr(E.badgeSave, 'data-state', st);
    setText(E.saveStatus, desc);
  }

  function renderRole() {
    const sec = role === 'secondary';
    E.banner.hidden = !sec;
    E.app.toggleAttribute('inert', sec);
    document.body.classList.toggle('is-secondary', sec);
    if (sec) E.takeover.focus();
    renderBadge();
  }

  function renderAch() {
    let n = 0;
    ACHS.forEach(function (a, i) {
      const li = E.achItems[i];
      const got = state.ach.indexOf(a.id) >= 0;
      if (got) n++;
      setAttr(li, 'data-got', got ? 'true' : 'false');
      setText(li.querySelector('.ach-state'), got ? '解除済み' : '未解除');
    });
    setText(E.achCount, n + '/' + ACHS.length);
  }

  function render() {
    const s = state;
    const rate = perSec(s);
    const m = mult(s);
    const dropsText = fmtInt(s.drops);
    const rateText = fmtRate(rate);

    setText(E.drops, dropsText);
    setText(E.hudDrops, dropsText);
    setText(E.rate, rateText);
    setText(E.hudRate, rateText);
    setText(E.mult, '×' + m.toFixed(2));
    setText(E.stars, fmtInt(s.stars) + (s.stars > 0 ? '（+' + fmtInt(s.stars * 10) + '%）' : ''));
    setText(E.tapGain, '+' + fmtRate(tapGain(s)) + ' / タップ');

    // 成長：現在の段階 → 次の段階の進み具合
    const st = curStage < 0 ? stageOf(s.total) : curStage;
    let frac = 1;
    let valueText = '星の花が咲いています';
    let note = '星の花が満開です。星を収穫できます';
    if (st < 4) {
      const lo = STAGES[st];
      const hi = STAGES[st + 1];
      frac = Math.min(1, Math.max(0, (s.total - lo) / (hi - lo)));
      const pct = Math.floor(frac * 100);
      valueText = STAGE_NAMES[st] + 'から' + STAGE_NAMES[st + 1] + 'へ ' + pct + '%';
      note = '次の「' + STAGE_NAMES[st + 1] + '」まで あと ' + fmtInt(Math.max(1, Math.ceil(hi - s.total)));
    }
    const pctNow = Math.floor(frac * 100);
    setAttr(E.bar, 'aria-valuenow', pctNow);
    setAttr(E.bar, 'aria-valuetext', valueText);
    const fill = 'scaleX(' + frac.toFixed(4) + ')';
    if (E.barFill._t !== fill) { E.barFill.style.transform = fill; E.barFill._t = fill; }
    setText(E.growNote, note);
    for (let i = 0; i < E.trackNodes.length; i++) {
      setAttr(E.trackNodes[i], 'data-state', i < st ? 'done' : i === st ? 'current' : 'future');
    }

    // 設備
    ITEMS.forEach(function (it) {
      const n = s.lv[it.id];
      const maxed = n >= MAX_LV;
      const cost = maxed ? 0 : price(it, n);
      const afford = !maxed && s.drops >= cost;
      const el = it.el;
      setText(el.lv, 'Lv ' + n);
      setText(el.price, maxed ? '最大' : fmtInt(cost));
      setText(el.state, maxed ? '最大レベル' : afford ? '購入できます' : 'あと ' + fmtInt(Math.max(1, Math.ceil(cost - s.drops))));
      setAttr(el.btn, 'data-afford', afford ? 'true' : 'false');
      setAttr(el.btn, 'aria-disabled', afford ? 'false' : 'true');
      setAttr(el.btn, 'aria-label', it.name + ' Lv' + n + '、' + (maxed ? '最大レベル' : '価格' + fmtInt(cost)));
      let eff;
      const nx = withLv(s, it.id);
      if (it.id === 'w') eff = '1タップ +' + fmtRate(tapGain(s)) + (maxed ? '' : ' → +' + fmtRate(tapGain(nx)));
      else if (it.id === 'l') eff = '毎秒 +' + fmtRate(rate) + (maxed ? '' : ' → +' + fmtRate(perSec(nx)));
      else eff = '全体 ×' + m.toFixed(2) + (maxed ? '' : ' → ×' + mult(nx).toFixed(2));
      setText(el.eff, eff);
    });

    // 星の収穫
    const g = harvestGain(s.total);
    const ready = g > 0;
    setAttr(E.harvest, 'data-ready', ready ? 'true' : 'false');
    setAttr(E.btnHarvest, 'aria-disabled', ready ? 'false' : 'true');
    setText(E.harvestLabel, ready ? '星を収穫する（+' + g + '）' : '星を収穫する');
    if (ready) {
      const next = HARVEST_BASE * Math.pow(2, g);
      setText(E.harvestText, '星の花が満開です。いま収穫すると星を ' + g + ' 個受け取れます。累積があと ' +
        fmtInt(Math.max(1, Math.ceil(next - s.total))) + ' 増えると ' + (g + 1) + ' 個になります。');
    } else {
      setText(E.harvestText, '星の花が咲くと収穫できます。あと ' + fmtInt(Math.max(1, Math.ceil(HARVEST_BASE - s.total))) + ' 育てましょう。');
    }
    E.stageReady.hidden = !ready;
  }

  /* ================================================================
   * タブ（実績・遊び方・設定）
   * ============================================================== */
  function isDesktop() { return E.mqDesk.matches; }

  function setTab(id) {
    activeTab = id;
    E.tabs.forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.tab === id ? 'true' : 'false');
    });
    E.panelEls.forEach(function (p) { p.hidden = p.dataset.panel !== id; });
    E.panels.hidden = id === null;
  }

  function setRoving(target) {
    const cur = target || E.tabs.filter(function (t) { return t.dataset.tab === activeTab; })[0] || E.tabs[0];
    E.tabs.forEach(function (t) { t.tabIndex = t === cur ? 0 : -1; });
  }

  function closeSheet() {
    if (isDesktop() || !activeTab) return;
    const t = E.tabs.filter(function (x) { return x.dataset.tab === activeTab; })[0];
    setTab(null);
    setRoving(t);
    if (t) t.focus();
  }

  /* ================================================================
   * 初期化
   * ============================================================== */
  function buildShop() {
    ITEMS.forEach(function (it) {
      const li = document.createElement('li');
      li.innerHTML =
        '<button type="button" class="shop-item" data-id="' + it.id + '" aria-describedby="eff-' + it.id + '">' +
          '<span class="shop-icon" aria-hidden="true"><svg class="ico"><use href="#' + it.icon + '"/></svg></span>' +
          '<span class="shop-name">' + it.name + '</span>' +
          '<span class="shop-lv"></span>' +
          '<span class="shop-eff" id="eff-' + it.id + '"></span>' +
          '<span class="shop-foot">' +
            '<span class="shop-price"><svg class="ico" aria-hidden="true"><use href="#i-drop"/></svg><span class="shop-price-num"></span></span>' +
            '<span class="shop-state"></span>' +
          '</span>' +
        '</button>';
      E.shop.appendChild(li);
      it.el = {
        btn: li.querySelector('.shop-item'),
        lv: li.querySelector('.shop-lv'),
        eff: li.querySelector('.shop-eff'),
        price: li.querySelector('.shop-price-num'),
        state: li.querySelector('.shop-state')
      };
    });
  }

  function buildAch() {
    E.achItems = ACHS.map(function (a) {
      const li = document.createElement('li');
      li.className = 'ach';
      li.setAttribute('data-got', 'false');
      li.innerHTML =
        '<span class="ach-mark" aria-hidden="true"><svg class="ico"><use href="#i-star"/></svg></span>' +
        '<span class="ach-body"><span class="ach-name"></span><span class="ach-desc"></span></span>' +
        '<span class="ach-state">未解除</span>';
      li.querySelector('.ach-name').textContent = a.name;
      li.querySelector('.ach-desc').textContent = a.desc;
      E.ach.appendChild(li);
      return li;
    });
  }

  function cacheEls() {
    ['drops', 'rate', 'mult', 'stars', 'hud-drops', 'hud-rate', 'tap-gain', 'btn-collect', 'plant', 'plant-wrap',
      'fx', 'stage-chip', 'stage-name', 'stage-poem', 'stage-ready', 'bar', 'bar-fill', 'grow-note', 'shop',
      'harvest', 'harvest-text', 'btn-harvest', 'harvest-label', 'notices', 'toasts', 'live-main', 'live-drops',
      'tab-banner', 'btn-takeover', 'app', 'panels', 'panels-close', 'ach-list', 'ach-count', 'motion-sw',
      'save-status-text', 'btn-reset', 'badge-save', 'badge-save-text', 'dlg-confirm', 'dc-title', 'dc-body',
      'dc-cancel', 'dc-ok', 'dlg-offline', 'do-body', 'do-ok', 'tabbar'
    ].forEach(function (id) {
      // id を camelCase のキーにして保持する
      const key = id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
      E[key] = $(id);
    });
    // 別名
    E.collect = E.btnCollect;
    E.takeover = E.btnTakeover;
    E.banner = E.tabBanner;
    E.ach = E.achList;
    E.saveStatus = E.saveStatusText;
    E.trackNodes = Array.prototype.slice.call(document.querySelectorAll('#track .track-node'));
    E.tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    E.panelEls = Array.prototype.slice.call(document.querySelectorAll('[role="tabpanel"]'));
    E.mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    E.mqDesk = window.matchMedia ? window.matchMedia('(min-width: 900px)') : { matches: true, addEventListener: function () {} };
  }

  function bindEvents() {
    E.collect.addEventListener('click', tap);
    // 植物をタッチして集めてもよい（キーボード操作は上のボタンで可能）
    E.plantWrap.addEventListener('click', tap);

    E.shop.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-id]');
      if (b) buy(b.getAttribute('data-id'));
    });

    E.btnHarvest.addEventListener('click', askHarvest);
    E.btnReset.addEventListener('click', askReset);
    E.btnTakeover.addEventListener('click', takeOver);

    E.motionSw.addEventListener('click', function () {
      state.settings.reduce = !reduced();
      applyMotion();
      save();
    });
    const onMq = function () { if (state.settings.reduce === null) applyMotion(); };
    if (E.mq) {
      if (E.mq.addEventListener) E.mq.addEventListener('change', onMq);
      else if (E.mq.addListener) E.mq.addListener(onMq);
    }

    // タブ
    E.tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        const id = t.dataset.tab;
        if (activeTab === id && !isDesktop()) setTab(null);
        else setTab(id);
        setRoving(t);
      });
    });
    E.tabbar.addEventListener('keydown', function (e) {
      const i = E.tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % E.tabs.length;
      else if (e.key === 'ArrowLeft') n = (i + E.tabs.length - 1) % E.tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = E.tabs.length - 1;
      if (n < 0) return;
      e.preventDefault();
      E.tabs[n].focus();
      setRoving(E.tabs[n]);
    });
    E.panelsClose.addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) closeSheet();
    });
    const onDesk = function () {
      if (isDesktop()) { if (activeTab === null) setTab('how'); }
      else setTab(null);
      setRoving();
    };
    if (E.mqDesk.addEventListener) E.mqDesk.addEventListener('change', onDesk);
    else if (E.mqDesk.addListener) E.mqDesk.addListener(onDesk);

    // ダイアログ
    [E.dlgConfirm, E.dlgOffline].forEach(function (d) {
      d.addEventListener('keydown', function (e) { trapTab(d, e); });
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    });
    E.dcCancel.addEventListener('click', function () { E.dlgConfirm.close(); });
    E.dcOk.addEventListener('click', function () {
      E.dlgConfirm.returnValue = 'ok';
      E.dlgConfirm.close();
    });
    E.dlgConfirm.addEventListener('close', function () {
      const cb = E.dlgConfirm.returnValue === 'ok' ? confirmCb : null;
      confirmCb = null;
      if (cb) cb();
      restoreFocus(E.dlgConfirm);
    });
    E.doOk.addEventListener('click', function () { E.dlgOffline.close(); });
    E.dlgOffline.addEventListener('close', function () { restoreFocus(E.dlgOffline); });

    // 可視状態・終了・複数タブ
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseTab();
      else resumeTab();
    });
    window.addEventListener('pagehide', pauseTab);
    window.addEventListener('pageshow', function (e) { if (e.persisted) resumeTab(); });
    window.addEventListener('storage', onStorage);
  }

  function tick() {
    if (document.hidden || role !== 'owner') return;
    step(Date.now());
    render();
    if (mono() - lastSave >= SAVE_INTERVAL_MS || mono() < lastSave) save();
    maybeAnnounceDrops();
  }

  function heartbeat() {
    if (!store || role !== 'owner' || document.hidden) return;
    if (verifyOwner()) writeOwner();
  }

  function init() {
    cacheEls();
    buildShop();
    buildAch();
    supportsDialog = typeof HTMLDialogElement === 'function' && typeof E.dlgConfirm.showModal === 'function';

    store = getStore();
    if (!store) {
      role = 'owner';
      state = defaultState();
    } else if (otherFresh(readOwner())) {
      // 既に別のタブが進行中：このタブは表示のみで、保存も進行もしない
      role = 'secondary';
      const res = readStored();
      state = res.status === 'ok' ? res.state : defaultState();
    } else {
      role = 'owner';
      writeOwner();
      loadOwned();
    }

    if (!store) notify('このブラウザでは保存機能が使えません。遊べますが、ページを閉じると進み具合は消えます。');

    // 画像の先読み（すべてローカル）
    for (let i = 0; i < STAGES.length; i++) { const im = new Image(); im.src = 'assets/stage-' + i + '.svg'; }

    applyMotion();
    syncStage(true);
    renderAch();
    renderRole();
    render();

    bindEvents();
    setTab(isDesktop() ? 'how' : null);
    setRoving();

    lastDropsLive = mono();
    if (role === 'owner') {
      step(Date.now());   // オフライン進行（上限8時間・効率50%）
      render();
      save();
    }

    setInterval(tick, TICK_MS);
    setInterval(heartbeat, HEARTBEAT_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
