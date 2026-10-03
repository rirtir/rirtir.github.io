// PRISM — 起動・画面遷移・進捗
import { Renderer } from './renderer.js';
import { Game } from './game.js';
import { Sfx } from './audio.js';
import * as O from './optics.js';
import { CHAPTERS } from './levels.js';
import { DEMO } from './demo.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'prism.save.v1';

// ---------- 進捗 ----------
const save = (() => {
  let d = { cleared: {}, sound: true, music: true, endless: { best: 0, seed: 0 }, daily: {} };
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && typeof s === 'object') d = Object.assign(d, s); } catch (e) { /* 無視 */ }
  if (!d.cleared || typeof d.cleared !== 'object') d.cleared = {};
  if (!d.daily || typeof d.daily !== 'object') d.daily = {};
  return d;
})();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 無視 */ } }

let renderer, game, audio;
const app = { capH: 0, qmode: 'auto', shot: false, screen: 'title', meta: null, quality: 1, lastDt: [], mx: null, my: null, mxs: 0.5, mys: 0.5 };
window.__app = app; window.__DEMO = DEMO;

function toast(msg, ms = 1800) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- 起動 ----------
function boot() {
  const cv = $('gl');
  try {
    renderer = new Renderer(cv);
  } catch (e) {
    $('bootMsg').textContent = 'このブラウザでは WebGL2（浮動小数点テクスチャ）が使えないため、PRISM を起動できません。';
    console.error(e); return;
  }
  audio = new Sfx();
  audio.enabled = save.sound; audio.musicOn = save.music;
  game = new Game(renderer, $('ov'), audio);
  game.onToast = toast;
  game.onWin = onWin;
  game.onEarlyWin = (info) => { app._winNote = commitWin(info); app._winCommitted = true; };
  game.onChange = refreshHud;
  game.onSelect = (el) => { if (window.__editorSelect) window.__editorSelect(el); };
  window.__game = game; window.__renderer = renderer;

  bindUi();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => { app.mx = e.clientX / window.innerWidth; app.my = e.clientY / window.innerHeight; });
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  buildChapters();
  showTitle();
  window.__ready = true;
  requestAnimationFrame(loop);
  setTimeout(() => $('boot').classList.add('gone'), 400);
  // 共有リンクからの起動
  const loadHash = () => { if (location.hash.startsWith('#L=')) import('./share.js').then(m => m.loadFromHash(startCustom, () => toast('共有リンクを読み込めませんでした'))); };
  setTimeout(loadHash, 100);
  window.addEventListener('hashchange', loadHash);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const small = w < 760;
  const playing = app.screen === 'play';
  renderer.rotated = h > w * 1.1;
  const capB = app.capH ? app.capH + 24 : 0;
  renderer.art = playing && !!app.meta && app.meta.kind === 'zen';
  renderer.setMargins(renderer.art ? { l: 10, r: 10, t: 10, b: 10 } : playing && app.editor && !small ? { l: 262, r: 14, t: 14, b: 14 } : playing ? { l: small ? 6 : 14, r: small ? 6 : 14, t: small ? 52 : 66, b: Math.max(small ? 54 : 58, capB) } : { l: 0, r: 0, t: 0, b: 0 });
  renderer.resize(w, h, dpr, app.quality);
  game.resizeOverlay(w, h, Math.min(dpr, 2));
}

// ---------- ループ ----------
let last = performance.now();
let perfAcc = 0, perfN = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (document.hidden) { loop._t = null; perfAcc = 0; perfN = 0; return; }
  if (app.screen === 'title' || app.screen === 'select') animateDemo(dt);
  if (app.zenMod && app.meta && app.meta.kind === 'zen' && app.screen === 'play') app.zenMod.zenUpdate(game, dt);
  game.update(dt);
  game.render(dt);
  if (app.shot) { app.shot = false; renderer.canvas.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'prism-' + Date.now() + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png'); toast('画像を保存しました'); }
  hudTick();
  // 動的解像度
  perfAcc += (now - (loop._t || now)); perfN++; loop._t = now;
  if (perfN >= 90) {
    const avg = perfAcc / perfN; perfAcc = 0; perfN = 0;
    loop._win = (loop._win || 0) + 1;
    if (app.qmode === 'auto' && loop._win > 3 && !document.hidden) {
      if (avg > 26 && app.quality > 0.5) { app.badQ = app.quality; app.quality = Math.max(0.5, app.quality - 0.15); resize(); }
      else if (avg < 19 && app.quality < 1 && app.quality + 0.1 < (app.badQ || 2)) { app.quality = Math.min(1, app.quality + 0.1); resize(); }
    }
  }
}

// ---------- タイトルのデモ ----------
function animateDemo(dt) {
  if (!game.demo) return;
  const t = game.time;
  const prism = game.els.find(e => e.type === 'prism');
  app.mxs += ((app.mx != null ? app.mx : 0.5) - app.mxs) * Math.min(1, dt * 3);
  app.mys += ((app.my != null ? app.my : 0.5) - app.mys) * Math.min(1, dt * 3);
  if (prism) { prism.a = (DEMO.prismA + Math.sin(t * 0.35) * 4 + (app.mxs - 0.5) * 16) * Math.PI / 180; prism.y = 7.0 + (app.mys - 0.5) * 0.8; }
  game.dirty = true;
}
function showTitle() {
  if (app.zenMod) app.zenMod.stopZen();
  app.screen = 'title'; lastChapter = -1; $('chapterCard').classList.add('hidden');
  game.demo = true; game.editor = false; game.sandbox = false; game.paused = false;
  game.startLevel(DEMO.level, {});
  game.demo = true;
  O.applySolution(game.els);
  game.intro = 0;
  show('title'); $('hud').classList.add('hidden'); $('caption').classList.add('hidden'); app.capH = 0; $('editor').classList.add('hidden'); $('zenExit').classList.add('hidden'); $('nudge').classList.add('hidden');
  resize();
}
function show(name) {
  for (const id of ['title', 'select', 'clear', 'pause']) $(id).classList.toggle('hidden', id !== name);
  if (name === 'title') {
    $('mSound').textContent = save.sound ? '♪ 音あり' : '♪ 音なし';
    const any = Object.keys(save.cleared).length > 0;
    const [ci, li] = firstUnclearedCampaign();
    const all = CHAPTERS.every((ch, i) => ch.levels.every((_, j) => save.cleared[levelId(i, j)]));
    $('mPlay').querySelector('span').textContent = all ? 'もう一度あそぶ  1-1' : any ? `つづきから  ${levelId(ci, li)}` : 'はじめる';
  }
}

// ---------- HUD ----------
let chipSig = '';
function setupChips() {
  const box = $('chips'); box.innerHTML = '';
  for (const t of game.els.filter(e => e.type === 'target')) {
    const d = document.createElement('div'); d.className = 'chip'; d.dataset.id = t.id;
    const c = O.nmRGB((t.lo + t.hi) / 2); const m = Math.max(c[0], c[1], c[2], 1e-3);
    if (t.hi - t.lo > 250) d.classList.add('full');
    d.style.setProperty('--c', `rgb(${Math.round(255 * Math.pow(c[0] / m, 0.6))},${Math.round(255 * Math.pow(c[1] / m, 0.6))},${Math.round(255 * Math.pow(c[2] / m, 0.6))})`);
    box.appendChild(d);
  }
  chipSig = '';
}
function hudTick() {
  if (app.screen !== 'play') return;
  let sig = '';
  for (const chip of $('chips').children) {
    const st = game.charge.get(+chip.dataset.id);
    const s = !st ? 0 : st.charge >= 1 ? 2 : st.fill > 0.3 ? 1 : 0;
    sig += s;
  }
  if (sig !== chipSig) {
    chipSig = sig;
    [...$('chips').children].forEach((chip, i) => { chip.classList.toggle('on', sig[i] === '2'); chip.classList.toggle('part', sig[i] === '1'); });
  }
}
function refreshHud() {
  $('stMoves').textContent = game.moves;
  $('bUndo').disabled = !game.hist.length;
  $('bRedo').disabled = !game.future.length;
}

// ---------- ステージ ----------
function levelId(ci, li) { return `${CHAPTERS[ci].id}-${li + 1}`; }
function startLevel(def, meta) {
  app.meta = meta; app.screen = 'play';
  game.demo = false; game.editor = false; game.sandbox = false; game.paused = false; app.editor = false;
  game.onSelect = updateNudge; game.onChange = refreshHud;
  game.startLevel(def, meta);
  show(null); $('hud').classList.toggle('hidden', !!meta.noHud); $('editor').classList.add('hidden');
  $('pBack').classList.toggle('hidden', !meta.backFn);
  $('lvNo').textContent = meta.label || ''; $('lvName').textContent = def.name || '';
  $('lvNo').style.color = meta.kind === 'campaign' ? accCss(CHAPTERS[meta.ci].nm, CHAPTERS[meta.ci]) : '';
  $('bHint').style.display = meta.noHint ? 'none' : '';
  setupChips(); refreshHud();
  $('zenExit').classList.toggle('hidden', meta.kind !== 'zen');
  $('bHelp').style.display = def.text ? '' : 'none';
  updateNudge(null);
  showCaption(def.text);
}
function showCaption(text) {
  const cap = $('caption');
  clearTimeout(startLevel._t);
  if (text) {
    cap.textContent = text; cap.classList.remove('hidden', 'fade');
    app.capH = cap.offsetHeight;
    startLevel._t = setTimeout(() => { cap.classList.add('fade'); app.capH = 0; resize(); }, window.innerHeight < 520 ? 7000 : 14000);
  } else { cap.classList.add('hidden'); app.capH = 0; }
  resize();
}
// タッチ端末向けの微調整パッド
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
function updateNudge(el) {
  const show = coarse && el && app.screen === 'play' && !app.editor && (el.mv || el.rt);
  $('nudge').classList.toggle('hidden', !show);
  if (show) { const btns = $('nudge').children; for (const b of btns) b.style.visibility = ((b.dataset.k === 'ccw' || b.dataset.k === 'cw') ? el.rt : el.mv) ? '' : 'hidden'; }
}
let lastChapter = -1;
function showChapterCard(ci) {
  const ch = CHAPTERS[ci], c = $('chapterCard');
  $('chNo').textContent = 'CHAPTER ' + ch.id; $('chNm').textContent = ch.name; $('chEn').textContent = ch.en;
  c.style.setProperty('--cc', accCss(ch.nm, ch));
  c.classList.remove('hidden'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
  clearTimeout(showChapterCard._t); showChapterCard._t = setTimeout(() => c.classList.add('hidden'), 2700);
}
function startCampaign(ci, li) {
  const ch = CHAPTERS[ci], def = ch.levels[li];
  if (lastChapter !== ci) { showChapterCard(ci); lastChapter = ci; }
  startLevel(def, { kind: 'campaign', ci, li, id: levelId(ci, li), label: levelId(ci, li), name: def.name });
  audio.init();
}
function startCustom(def, meta = {}) {
  startLevel(def, Object.assign({ kind: 'custom', label: '自作', name: def.name || '自作ステージ' }, meta));
}
window.__start = { startCampaign, startCustom, startLevel };

function nextOf(meta) {
  if (meta.kind !== 'campaign') return null;
  let { ci, li } = meta;
  if (li + 1 < CHAPTERS[ci].levels.length) return [ci, li + 1];
  if (ci + 1 < CHAPTERS.length) return [ci + 1, 0];
  return null;
}
function firstUnclearedCampaign() {
  for (let ci = 0; ci < CHAPTERS.length; ci++) for (let li = 0; li < CHAPTERS[ci].levels.length; li++) if (!save.cleared[levelId(ci, li)]) return [ci, li];
  return [0, 0];
}

function fmtTime(s) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0'); }
// 勝利の記録（演出の開始時に1回だけ。タブを閉じても進捗が残る）
function commitWin(info) {
  const meta = app.meta || {};
  let note = '';
  if (meta.kind === 'campaign') {
    const prev = save.cleared[meta.id];
    const rec = { moves: info.moves, time: Math.round(info.time), hints: info.hints };
    if (!prev) note = '初クリア！';
    else if (info.moves < prev.moves) note = '手数の自己ベスト更新！';
    if (info.hints === 0 && (!prev || prev.hints > 0)) note = (note ? note + ' ' : '') + '★ ノーヒントクリア';
    if (!prev || info.moves < prev.moves || (info.hints === 0 && prev.hints > 0)) {
      save.cleared[meta.id] = prev ? { moves: Math.min(prev.moves, rec.moves), time: Math.min(prev.time, rec.time), hints: Math.min(prev.hints, rec.hints) } : rec;
      persist();
    }
  }
  if (meta.onWin) note = meta.onWin(info) || note;
  return note;
}
function onWin(info) {
  const meta = app.meta || {};
  game.paused = false;
  let note = app._winCommitted ? app._winNote : commitWin(info);
  app._winCommitted = false;
  if (meta.kind === 'campaign' && !nextOf(meta)) note = (note ? note + '　' : '') + '全ステージクリア！おめでとう！';
  $('clearName').textContent = (meta.label ? meta.label + '  ' : '') + (meta.name || '');
  const bestRec = meta.kind === 'campaign' ? save.cleared[meta.id] : null;
  $('clMoves').nextElementSibling.textContent = bestRec ? `手数（ベスト ${bestRec.moves}）` : '手数';
  $('clMoves').textContent = info.moves; $('clTime').textContent = fmtTime(info.time); $('clHints').textContent = info.hints;
  $('clearNote').textContent = note;
  const nxt = meta.nextFn ? true : !!nextOf(meta);
  $('clNext').style.display = nxt ? '' : 'none';
  $('clMenu').querySelector('span').textContent = meta.backFn ? 'エディタに戻る' : 'ステージ選択';
  $('clNext').querySelector('span').textContent = meta.nextLabel || (nxt ? '次のステージ' : '');
  show('clear');
  $('hud').classList.add('hidden');
}

// ---------- ステージ選択 ----------
function cssNm(nm, lum = 1) { return O.nmCss(nm, lum); }
function accCss(nm, ch) {
  if (ch && ch.css) return ch.css;
  const c = O.nmRGB(nm); const m = Math.max(c[0], c[1], c[2], 1e-6);
  const g = (v) => Math.round(255 * Math.min(1, Math.pow(v / m, 1 / 1.6) * 0.62 + 0.38));
  return `rgb(${g(c[0])},${g(c[1])},${g(c[2])})`;
}
function buildChapters() {
  const box = $('chapters'); box.innerHTML = '';
  let total = 0, done = 0;
  CHAPTERS.forEach((ch, ci) => {
    const sec = document.createElement('div'); sec.className = 'chap';
    sec.style.setProperty('--cc', accCss(ch.nm, ch));
    const cd = ch.levels.filter((_, li) => save.cleared[levelId(ci, li)]).length;
    sec.innerHTML = `<h3>${ch.id}. ${ch.name} <small>${ch.en}</small><small class="cnt">${cd} / ${ch.levels.length}</small></h3><p>${ch.blurb}</p><div class="tiles"></div>`;
    const tiles = sec.querySelector('.tiles');
    ch.levels.forEach((lv, li) => {
      const id = levelId(ci, li); total++;
      const b = document.createElement('button'); b.className = 'tile'; b.textContent = li + 1; b.title = `${id} ${lv.name}`;
      const c = save.cleared[id];
      if (c) { b.classList.add('done'); done++; if (c.hints === 0) b.classList.add('nohint'); }
      if (!c && firstUnclearedCampaign().join() === [ci, li].join()) b.classList.add('cur');
      b.onclick = () => { audio.init(); audio.ui(); startCampaign(ci, li); };
      tiles.appendChild(b);
    });
    box.appendChild(sec);
  });
  $('selProg').textContent = `${done} / ${total} クリア`;
}

// ---------- UI バインド ----------
function bindUi() {
  const click = (id, fn) => $(id).addEventListener('click', () => { audio.init(); fn(); });
  click('mPlay', () => { audio.ui(); const [ci, li] = firstUnclearedCampaign(); startCampaign(ci, li); });
  click('mSelect', () => { audio.ui(); buildChapters(); show('select'); app.screen = 'select'; });
  click('selBack', () => { audio.ui(); showTitle(); });
  click('mSound', () => { save.sound = !save.sound; audio.setEnabled(save.sound); persist(); $('mSound').textContent = save.sound ? '♪ 音あり' : '♪ 音なし'; });
  click('mFull', toggleFull);
  click('mEndless', () => import('./modes.js').then(m => m.startEndless({ startLevel, save, persist, toast, audio })));
  click('mDaily', () => import('./modes.js').then(m => m.startDaily({ startLevel, save, persist, toast, audio })));
  click('mZen', () => import('./modes.js').then(m => { app.zenMod = m; m.startZen({ startLevel, game, app, toast }); }));
  click('mEditor', () => import('./editor.js').then(m => m.openEditor({ game, audio, toast, show, app, $, resize, startCustom, exit: showTitle })));

  click('bMenu', openPause);
  click('bHelp', () => showCaption((game.def && game.def.text) || ''));
  click('zenExit', () => { if (app.zenMod) app.zenMod.stopZen(); showTitle(); });
  $('nudge').addEventListener('click', (e) => {
    const k = e.target.dataset && e.target.dataset.k; if (!k) return; audio.init();
    const el = game.byId(game.sel); if (!el) return;
    if (k === 'l') game.nudge(-0.25, 0); else if (k === 'r') game.nudge(0.25, 0); else if (k === 'u') game.nudge(0, -0.25); else if (k === 'd') game.nudge(0, 0.25);
    else if (k === 'ccw') game.rotateBy(el, -2.5 * Math.PI / 180); else if (k === 'cw') game.rotateBy(el, 2.5 * Math.PI / 180);
  });
  click('bUndo', () => game.undo());
  click('bRedo', () => game.redo());
  click('bHint', () => game.hint());
  click('bReset', () => { game.reset(); setupChips(); refreshHud(); });

  click('pResume', closePause);
  click('pReset', () => { closePause(); game.reset(); setupChips(); refreshHud(); });
  click('pSelect', () => { game.paused = false; buildChapters(); show('select'); app.screen = 'select'; $('hud').classList.add('hidden'); $('caption').classList.add('hidden'); app.capH = 0; $('zenExit').classList.add('hidden'); $('nudge').classList.add('hidden'); showDemoBehind(); });
  click('pTitle', () => { game.paused = false; showTitle(); });
  click('pBack', () => { game.paused = false; if (app.meta && app.meta.backFn) app.meta.backFn(); });
  click('pSound', () => { save.sound = !save.sound; audio.setEnabled(save.sound); persist(); syncPause(); });
  click('pMusic', () => { save.music = !save.music; audio.setMusic(save.music); persist(); syncPause(); });
  click('pFull', toggleFull);
  click('pShot', () => { closePause(); setTimeout(() => { app.shot = true; }, 80); });
  click('pQual', () => {
    const order = ['auto', 'high', 'mid', 'low']; app.qmode = order[(order.indexOf(app.qmode) + 1) % 4];
    app.quality = { auto: 1, high: 1, mid: 0.75, low: 0.5 }[app.qmode]; app.badQ = 0; resize(); syncPause();
  });

  click('clRetry', () => { show(null); $('hud').classList.remove('hidden'); game.reset(); setupChips(); refreshHud(); });
  click('clMenu', () => { if (app.meta && app.meta.backFn) { app.meta.backFn(); return; } buildChapters(); show('select'); app.screen = 'select'; showDemoBehind(); });
  click('clNext', () => {
    const meta = app.meta || {};
    if (meta.nextFn) { meta.nextFn(); return; }
    const n = nextOf(meta); if (n) startCampaign(n[0], n[1]);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (app.editor) { game.select(null); return; }
      if (app.screen === 'play' && !$('clear').classList.contains('hidden')) return;
      if (app.screen === 'play' && app.meta && app.meta.kind === 'zen') { if (app.zenMod) app.zenMod.stopZen(); showTitle(); }
      else if (app.screen === 'play') { game.paused ? closePause() : openPause(); }
      else if (app.screen === 'select') showTitle();
    }
  });
}
function showDemoBehind() {
  // 選択画面の背景にタイトルのデモを流す
  game.demo = true; game.startLevel(DEMO.level, {}); game.demo = true; O.applySolution(game.els); resize();
}
function openPause() {
  if (app.screen !== 'play') return;
  game.paused = true; syncPause(); show('pause');
}
function closePause() { game.paused = false; show(null); }
function syncPause() {
  $('pSound').classList.toggle('on', save.sound); $('pMusic').classList.toggle('on', save.music);
  $('pSound').querySelector('span').textContent = save.sound ? '効果音 ON' : '効果音 OFF';
  $('pMusic').querySelector('span').textContent = save.music ? '環境音 ON' : '環境音 OFF';
  $('pQual').querySelector('span').textContent = '画質: ' + { auto: '自動', high: '高', mid: '中', low: '低' }[app.qmode];
}
function toggleFull() {
  const d = document;
  if (!d.fullscreenElement) (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen || (() => {})).call(d.documentElement);
  else (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
}

boot();
