// SYNESTHESIA — アプリ本体（画面遷移・入力・描画ループ）
import { Renderer, LANE_X } from './renderer.js';
import { AudioEngine } from './audio.js';
import { Game, WIN, JUDGE_NAME } from './game.js';
import { analyzeAsync, sampleArr, NB } from './analyze.js';
import { buildChart, gridChart, DIFFS } from './chart.js';
import { SONGS } from './songs.js';
import { makeDemo } from './demo.js';
import { hsl, hashStr, store, save, fmtTime, esc, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const rgbHex = (c) => '#' + c.map(v => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- 設定
const DEFAULTS = {
  speed: 6, offset: 0, music: 85, sfx: 55, bloom: 100, cam: 100, quality: 'auto', hitSnd: true, fast: true,
  keys: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
};
const rawSettings = store('settings', {});
const settings = Object.assign({}, DEFAULTS, rawSettings && typeof rawSettings === 'object' ? rawSettings : {});
{
  const num = (v, d, lo, hi) => (v !== null && v !== '' && Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  settings.speed = num(settings.speed, 6, 1, 12); settings.offset = num(settings.offset, 0, -200, 200);
  settings.music = num(settings.music, 85, 0, 100); settings.sfx = num(settings.sfx, 55, 0, 100);
  settings.bloom = num(settings.bloom, 100, 0, 150); settings.cam = num(settings.cam, 100, 0, 100);
  if (!['auto', '1', '0.75', '0.55'].includes(String(settings.quality))) settings.quality = 'auto';
  if (!Array.isArray(settings.keys) || settings.keys.length !== 4 || settings.keys.some(k => typeof k !== 'string') || new Set(settings.keys).size !== 4 || settings.keys.includes('Escape')) settings.keys = DEFAULTS.keys.slice();
  settings.hitSnd = settings.hitSnd !== false && settings.hitSnd !== 'false'; settings.fast = settings.fast !== false && settings.fast !== 'false';
}
if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches && store('settings', null) == null) settings.cam = 30;
const saveSettings = () => save('settings', settings);
const speedOf = () => 10 + settings.speed * 2.2;

// ---------------------------------------------------------------- 初期化
let renderer, audio;
try {
  renderer = new Renderer($('gl'));
} catch (e) {
  $('fatal').classList.remove('hidden');
  $('fatal').innerHTML = 'このゲームにはWebGL2（浮動小数点テクスチャ対応）が必要です。<br>ブラウザやGPUの設定をご確認ください。<br><small>' + esc(e.message) + '</small>';
  throw e;
}
audio = new AudioEngine();
audio.setVolumes(settings.music / 100, settings.sfx / 100); audio.sfxOn = settings.hitSnd;
document.querySelectorAll('.wordmark span').forEach((s, i) => s.style.setProperty('--i', i));

const demo = makeDemo();

// ---------------------------------------------------------------- 曲ライブラリ
const lib = SONGS.map(def => ({ kind: 'builtin', def, key: def.id, status: 'idle', data: null, charts: [null, null, null, null] }));
let cur = null, curDiff = 1, scene = 'title';
let worker = null; const wPending = new Map(); let workerFailed = false;

function renderInWorker(id) {
  return new Promise((resolve, reject) => {
    const fallback = async () => {
      try {
        const m = await import('./synth.js');
        const song = SONGS.find(s => s.id === id);
        await new Promise(r => setTimeout(r, 30));
        resolve(m.renderSongSync(song));
      } catch (e) { reject(e); }
    };
    if (workerFailed || !window.Worker) return fallback();
    try {
      if (!worker) {
        worker = new Worker('./js/synth.worker.js', { type: 'module' });
        worker.onmessage = (ev) => {
          const d = ev.data, p = wPending.get(d.id); if (!p) return;
          wPending.delete(d.id);
          if (d.error) p.fallback(); else p.resolve(d);
        };
        worker.onerror = () => { workerFailed = true; for (const [, p] of wPending) p.fallback(); wPending.clear(); };
      }
      wPending.set(id, { resolve, fallback });
      worker.postMessage({ id });
    } catch (e) { workerFailed = true; fallback(); }
  });
}

function mixMono(l, r) {
  const m = new Float32Array(l.length);
  for (let i = 0; i < m.length; i++) { const v = (l[i] + r[i]) * 0.5; m[i] = Number.isFinite(v) ? v : 0; }
  return m;
}

async function loadBuiltin(e) {
  if (e.data) return e.data;
  if (e.promise) return e.promise;
  e.status = 'loading'; refreshCard(e);
  e.promise = (async () => {
    const r = await renderInWorker(e.def.id);
    const buffer = audio.makeBuffer(r.left, r.right, r.sr);
    const an = await analyzeAsync(mixMono(r.left, r.right), r.sr);
    // 組み込み曲は楽譜から拍が正確に分かるので、解析結果ではなく既知のグリッドを使う
    { const spb = 60 / e.def.bpm, nb = Math.ceil(r.dur / spb) + 1;
      an.beats = Float32Array.from({ length: nb }, (_, k) => k * spb); an.bpm = e.def.bpm; an.downPhase = 0; an.sig = e.def.sig || 4; }
    e.data = { title: e.def.title, sub: e.def.sub, genre: e.def.genre, bpm: e.def.bpm, buffer, an, cands: r.cands, dur: r.dur, pal: e.def.pal, seed: hashStr(e.def.id) };
    e.status = 'ready'; refreshCard(e);
    return e.data;
  })().catch(err => { console.error(err); e.status = 'error'; e.promise = null; refreshCard(e); toast('曲の生成に失敗しました'); throw err; });
  return e.promise;
}

function paletteFromAnalysis(an) {
  const c = an.color;
  const base = ((0.93 - c.centroid * 1.7 + (an.bpm - 120) / 600) % 1 + 1) % 1;
  const lanes = [0, 0.11, 0.5, 0.62].map(o => rgbHex(hsl(base + o, 0.82, 0.6)));
  return { lanes, a: rgbHex(hsl(base + 0.66, 0.6, 0.12)), b: rgbHex(hsl(base + 0.02, 0.85, 0.55)), c: rgbHex(hsl(base + 0.11, 0.9, 0.68)) };
}

let loadingFile = false;
async function loadFile(file) {
  if (scene === 'play' || scene === 'pause') { toast('プレイ中は曲を追加できません'); return; }
  if (loadingFile) { toast('読み込み中です'); return; }
  loadingFile = true;
  try { await loadFileInner(file); } finally { loadingFile = false; }
}
async function loadFileInner(file) {
  audio.ensure();
  showLoading('曲を読み込んでいます…', 0.02, file.name);
  try {
    const ab = await file.arrayBuffer();
    let buf;
    try { buf = await audio.decode(ab); } catch (err) { hideLoading(); toast('この形式は読み込めませんでした（mp3 / wav / m4a / ogg を試してください）'); return; }
    if (buf.duration < 10) { hideLoading(); toast('曲が短すぎます（10秒以上）'); return; }
    if (buf.duration > 10 * 60) { hideLoading(); toast('曲が長すぎます（10分まで）'); return; }
    showLoading('音を解析しています…', 0.1, file.name);
    const l = buf.getChannelData(0), r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
    const mono = mixMono(l, r);
    let en = 0; for (let i = 0; i < mono.length; i += 7) en += mono[i] * mono[i];
    if (Math.sqrt(en / (mono.length / 7)) < 0.0008) { hideLoading(); toast('ほぼ無音のため、譜面を自動生成できません'); return; }
    const an = await analyzeAsync(mono, buf.sampleRate, (p) => showLoading('音を解析しています…', 0.1 + p * 0.88, file.name));
    const name = file.name.replace(/\.[^.]+$/, '');
    const e = { kind: 'custom', key: 'u:' + name + ':' + Math.round(buf.duration) + ':' + file.size, status: 'ready', charts: [null, null, null, null], promise: null };
    e.data = { title: name, sub: 'あなたの曲', genre: 'YOUR TRACK', bpm: Math.round(an.bpm), buffer: buf, an, cands: an.cands, dur: buf.duration, pal: paletteFromAnalysis(an), seed: hashStr(name) };
    // 同名があれば置き換え
    const ix = lib.findIndex(x => x.key === e.key); if (ix >= 0) lib.splice(ix, 1);
    lib.push(e);
    { const cs = lib.filter(x => x.kind === 'custom'); while (cs.length > 3) { const old = cs.shift(); lib.splice(lib.indexOf(old), 1); if (cur === old) cur = lib[0]; } }
    hideLoading();
    buildList();
    if (scene === 'title') gotoScene('select');
    if (scene === 'select') selectEntry(e);
    toast('「' + name + '」を解析しました（' + Math.round(an.bpm) + ' BPM）');
  } catch (err) {
    console.error(err); hideLoading(); toast('読み込みに失敗しました');
  }
}

function chartOf(e, di) {
  if (e.charts[di]) return e.charts[di];
  const d = e.data;
  let cands = d.cands;
  // 組み込み曲の高難易度は、楽譜由来の候補に「実際の音から検出したオンセット」を足して密度を稼ぐ
  if (e.kind === 'builtin' && di >= 2) {
    const base = d.cands.map(c => c.t).sort((a, b) => a - b);
    const near = (t) => { let lo = 0, hi = base.length; while (lo < hi) { const m = (lo + hi) >> 1; if (base[m] < t) lo = m + 1; else hi = m; } return (lo < base.length && base[lo] - t < 0.05) || (lo > 0 && t - base[lo - 1] < 0.05); };
    const extra = d.an.cands.filter(c => !near(c.t)).map(c => ({ t: c.t, pos: c.pos, imp: c.imp * 0.55, dur: 0, g: c.g }));
    cands = d.cands.concat(extra);
  }
  let ch = buildChart(cands, d.dur, di, d.seed);
  if (ch.stats.count < Math.max(16, d.dur * 0.15)) ch = gridChart(d.an.beats, d.dur, di, d.seed);
  e.charts[di] = ch;
  return e.charts[di];
}

// ---------------------------------------------------------------- ベスト
const bestKey = (e, di) => 'best.' + e.key + '.' + di;
const getBest = (e, di) => store(bestKey(e, di), null);

// ---------------------------------------------------------------- UI ヘルパ
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3600);
}
function showLoading(title, p, sub) {
  $('loading').classList.remove('hidden'); $('loadTitle').textContent = title; $('loadBar').style.width = (p * 100).toFixed(0) + '%'; $('loadSub').textContent = sub || '';
}
function hideLoading() { $('loading').classList.add('hidden'); }
function setPalVars(p) {
  const r = document.documentElement.style;
  r.setProperty('--c1', p.lanes[0]); r.setProperty('--c2', p.lanes[1]); r.setProperty('--c3', p.lanes[2]); r.setProperty('--c4', p.lanes[3]);
  r.setProperty('--acc', p.lanes[2]);
  renderer.setPalette(p);
}
const DEFAULT_PAL = { lanes: ['#ff3d9a', '#ff9d3d', '#3de8ff', '#8a6bff'], a: '#1b0a46', b: '#ff2d95', c: '#ffb347' };

function gotoScene(name) {
  scene = name;
  $('pause').classList.add('hidden'); $('count').classList.add('hidden'); $('count').dataset.n = '';
  for (const id of ['title', 'select', 'result']) $(id).classList.toggle('hidden', id !== name);
  $('hud').classList.toggle('hidden', name !== 'play' && name !== 'pause');
  if (name === 'title') { audio.previewStop(); setBackground(null); setPalVars(DEFAULT_PAL); }
  if (name === 'select') { if (cur) setBackgroundFor(cur); }
}

// ---------------------------------------------------------------- 曲リスト
function buildList() {
  const L = $('songList'); L.innerHTML = '';
  const add = document.createElement('button');
  add.className = 'song-card add'; add.innerHTML = '<div class="t">＋ 自分の曲を読み込む</div><div class="s">mp3 / wav / m4a / ogg ・ ドラッグ＆ドロップでもOK</div>';
  add.onclick = () => { audio.ensure(); audio.ui('tap'); $('file').click(); };
  L.appendChild(add);
  lib.forEach((e, i) => {
    const b = document.createElement('button');
    b.className = 'song-card'; b.dataset.i = i;
    const pal = e.kind === 'builtin' ? e.def.pal : e.data.pal;
    b.style.setProperty('--k1', pal.lanes[0]); b.style.setProperty('--k2', pal.lanes[3]);
    const title = e.kind === 'builtin' ? e.def.title : e.data.title;
    const sub = e.kind === 'builtin' ? e.def.sub : 'あなたの曲';
    const genre = e.kind === 'builtin' ? e.def.genre : 'YOUR TRACK';
    const bpm = e.kind === 'builtin' ? e.def.bpm : e.data.bpm;
    b.innerHTML = `<div class="g">${esc(genre)}</div><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div><div class="m"><span>${bpm} BPM</span><span class="rk"></span></div><span class="st"></span>`;
    b.onclick = () => { audio.ensure(); audio.ui('tap'); selectEntry(e); };
    e.el = b;
    L.appendChild(b);
    refreshCard(e);
  });
}
function bestRank(e) {
  const order = 'SABCD'; let best = null;
  for (let d = 0; d < 4; d++) { const b = getBest(e, d); if (b && (best == null || order.indexOf(b.rank) < order.indexOf(best))) best = b.rank; }
  return best;
}
function refreshCard(e) {
  if (!e.el) return;
  e.el.classList.toggle('sel', e === cur);
  const st = e.el.querySelector('.st');
  st.className = 'st' + (e.status === 'loading' ? ' busy' : '');
  st.textContent = e.status === 'loading' ? '生成中' : e.status === 'error' ? '失敗' : '';
  e.el.querySelector('.rk').textContent = bestRank(e) || '';
}

function selectEntry(e) {
  cur = e;
  lib.forEach(refreshCard);
  const pal = e.kind === 'builtin' ? e.def.pal : e.data.pal;
  setPalVars(pal);
  audio.previewStop();
  const title = e.kind === 'builtin' ? e.def.title : e.data.title;
  $('dTitle').textContent = title;
  $('dGenre').textContent = e.kind === 'builtin' ? e.def.genre : 'YOUR TRACK';
  $('dSub').textContent = e.kind === 'builtin' ? e.def.sub : 'あなたの曲';
  $('dBpm').textContent = (e.kind === 'builtin' ? e.def.bpm : e.data.bpm) + ' BPM';
  $('dLen').textContent = e.data ? fmtTime(e.data.dur) : '--:--';
  $('dNotes').textContent = '';
  $('diffs').innerHTML = '';
  $('bStart').disabled = !e.data;
  $('dBest').textContent = '';
  drawWave(e);
  if (e.el) e.el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  setBackground(null);
  if (e.data) onEntryReady(e);
  else if (e.kind === 'builtin') {
    $('dStatus').textContent = '曲を生成しています…';
    loadBuiltin(e).then(() => { if (cur === e) onEntryReady(e); }).catch(() => { $('dStatus').textContent = '生成に失敗しました'; });
  }
}

function onEntryReady(e) {
  const d = e.data;
  $('dStatus').textContent = '';
  $('dLen').textContent = fmtTime(d.dur);
  $('bStart').disabled = false;
  buildDiffs();
  drawWave(e);
  setBackgroundFor(e);
}

function buildDiffs() {
  const e = cur; if (!e || !e.data) return;
  const D = $('diffs'); D.innerHTML = '';
  DIFFS.forEach((df, di) => {
    const ch = chartOf(e, di);
    const b = document.createElement('button');
    b.className = 'diff' + (di === curDiff ? ' sel' : '');
    b.style.setProperty('--dc', df.col);
    const best = getBest(e, di);
    b.innerHTML = `<div class="n">${df.name}</div><div class="l">${ch.stats.level}</div><div class="c">${ch.stats.count} notes</div>${best ? `<div class="r">${best.rank}</div>` : ''}`;
    b.onclick = () => { audio.ensure(); audio.ui('tap'); curDiff = di; buildDiffs(); setBackgroundFor(e); };
    D.appendChild(b);
  });
  const ch = chartOf(e, curDiff);
  $('dNotes').textContent = ch.stats.count + ' NOTES' + (ch.stats.holds ? ' (HOLD ' + ch.stats.holds + ')' : '');
  const best = getBest(e, curDiff);
  $('dBest').innerHTML = best ? `BEST <b>${best.score.toLocaleString()}</b> ・ ${best.rank} ・ MAX COMBO ${best.combo}${best.badge ? ' ・ ' + best.badge : ''}` : 'まだ記録がありません';
  $('dBest').style.color = '';
}

function drawWave(e) {
  const c = $('dWave'), g = c.getContext('2d');
  const W = c.width = c.clientWidth * (window.devicePixelRatio || 1) || 640, H = c.height = c.clientHeight * (window.devicePixelRatio || 1) || 120;
  g.clearRect(0, 0, W, H);
  if (!e.data) { g.fillStyle = 'rgba(255,255,255,.08)'; for (let x = 0; x < W; x += 6) g.fillRect(x, H / 2 - 2, 3, 4); return; }
  const an = e.data.an, pal = e.data.pal;
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, pal.lanes[0]); grd.addColorStop(0.5, pal.lanes[2]); grd.addColorStop(1, pal.lanes[3]);
  g.fillStyle = grd;
  const n = Math.floor(W / 4);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * an.dur;
    const lo = sampleArr(an, an.low, t), al = sampleArr(an, an.all, t);
    const h = Math.max(2, (al * .75 + lo * .25) * H * .9);
    g.globalAlpha = .9;
    g.fillRect(i * 4, (H - h) / 2, 2.6, h);
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- 背景（デモ・プレビュー）
let bg = null;           // {an, kicks, game, clock:{mode, from, len, t0}, pal}
function makeBg(an, notes, kicks, clock) {
  const chart = { notes };
  const g = new Game(chart, { auto: true, onEvent: onGameEvent });
  g.seek(clock.from);
  return { an, kicks, game: g, clock, kp: 0, bp: 0, dp: 0, lastT: clock.from };
}
function setBackground(b) { bg = b; }
function demoBg() {
  const kicks = demo.kicks;
  return makeBg(demo.an, demo.chart.notes, kicks, { mode: 'free', from: 0, len: demo.dur, t0: performance.now() });
}
function previewWindow(an, len = 18) {
  // 盛り上がりの大きい区間を探す（曲の前半〜中盤）
  const step = Math.round(an.fps * 2), L = Math.round(an.fps * len);
  let best = 0, bi = Math.round(an.fps * 4);
  const maxI = Math.max(0, an.nFrames - L - Math.round(an.fps * 6));
  for (let i = Math.round(an.fps * 3); i < maxI; i += step) {
    let s = 0; for (let k = 0; k < L; k += 10) s += an.inten[i + k];
    if (s > best) { best = s; bi = i; }
  }
  return Math.max(0, bi / an.fps - 0.5);
}
function kicksOf(cands) { return cands.filter(c => c.pos < .2 && c.imp > .45).map(c => c.t).sort((a, b) => a - b); }
let bgToken = 0;
function setBackgroundFor(e, silent = false) {
  if (!e || !e.data) { setBackground(demoBg()); return; }
  const d = e.data, ch = chartOf(e, curDiff);
  const len = Math.min(18, d.dur - 1);
  const from = Math.max(0, Math.min(previewWindow(d.an, len), d.dur - len - 0.1));
  const clock = { mode: silent ? 'free' : 'audio', from, len, t0: performance.now(), ctx0: 0 };
  bg = makeBg(d.an, ch.notes, kicksOf(d.cands), clock);
  bg.pal = d.pal;
  if (!silent && audio.ctx) { audio.previewStart(d.buffer, from, len); clock.ctx0 = audio.ctx.currentTime + 0.02; }
  bgToken++;
}

// ---------------------------------------------------------------- プレイ
let game = null, chart = null, playEntry = null, playDiff = 1, playOpts = { auto: false, surv: false };
let countFrom = -Infinity, pausedT = 0, resultShown = false, counting = false, playToken = 0;
let hudScore = '', hudAcc = '', hudCombo = -1;

function startPlay(e, di, opts = {}) {
  if (!e || !e.data) return;
  playToken++;
  clearKeyState();
  audio.ensure(); audio.previewStop();
  playEntry = e; playDiff = di; playOpts = { auto: !!opts.auto, surv: !!opts.surv };
  chart = chartOf(e, di);
  const d = e.data;
  setPalVars(d.pal);
  game = new Game(chart, { auto: playOpts.auto, noFail: !playOpts.surv, offset: settings.offset, onEvent: onGameEvent });
  fx.rings.length = 0; fx.glows.length = 0;
  fx.laneGlow.fill(0); fx.punch = 0; fx.flash = 0;
  resultShown = false;
  gotoScene('play');
  $('hTitle').textContent = d.title;
  const df = DIFFS[di];
  $('hDiff').textContent = df.name + (playOpts.auto ? ' ・ AUTO' : '') + (playOpts.surv ? ' ・ SURVIVAL' : '');
  $('hDiff').style.setProperty('--dcol', df.col); $('hud').style.setProperty('--dcol', df.col);
  $('autoTag').classList.toggle('hidden', !playOpts.auto);
  $('hScore').textContent = '0000000'; $('hAcc').textContent = '100.00%';
  hudScore = ''; hudAcc = ''; hudCombo = -1;
  $('combo').classList.remove('on');
  $('gauge').classList.toggle('hidden', !playOpts.surv);
  countFrom = 0;
  audio.start(d.buffer, 0, 2.2);
  state.beatPtr = 0; state.kickPtr = 0; state.dropPtr = 0;
  state.paused = false;
}

function pauseGame() {
  if (scene !== 'play' || resultShown || (game && game.failed)) return;
  { const raw = audio.pause(); pausedT = (countFrom > 0 && raw < countFrom) ? countFrom : raw; }
  scene = 'pause';
  $('pause').classList.remove('hidden');
  audio.previewStop();
  // 押しっぱなしをリセット
  game.suspendHolds();
  clearKeyState();
}
function resumeGame() {
  if (scene !== 'pause') return;
  $('pause').classList.add('hidden');
  scene = 'play';
  countFrom = pausedT;
  audio.start(playEntry.data.buffer, Math.max(0, pausedT), 2.0);
}
function quitToSelect() {
  playToken++;
  clearKeyState();
  audio.stop();
  $('pause').classList.add('hidden');
  game = null;
  gotoScene('select');
  if (cur) onEntryReady(cur);
}

function finishPlay(failed) {
  if (resultShown) return;
  resultShown = true;
  const tok = playToken;
  const g = game;
  audio.stop();
  const acc = g.accuracy, score = g.displayScore, rank = failed ? 'D' : g.rank();
  const badge = failed ? 'FAILED' : playOpts.auto ? 'AUTO PLAY' : g.badge();
  const prev = getBest(playEntry, playDiff);
  let isNew = false;
  if (!playOpts.auto && !failed && g.counts[0] + g.counts[1] + g.counts[2] > 0 && (!prev || score > prev.score)) { save(bestKey(playEntry, playDiff), { score, rank, combo: g.maxCombo, badge, acc }); isNew = true; }
  setTimeout(() => {
    if (tok !== playToken) return;
    gotoScene('result');
    $('rTitle').textContent = playEntry.data.title;
    const df = DIFFS[playDiff];
    $('rDiff').textContent = df.name + (playOpts.auto ? ' ・ AUTO' : '') + (playOpts.surv ? ' ・ SURVIVAL' : '');
    $('result').style.setProperty('--dcol', df.col);
    const rk = $('rRank'); rk.textContent = rank; rk.classList.remove('pop'); void rk.offsetWidth; rk.classList.add('pop');
    $('rBadge').textContent = badge;
    $('rScore').textContent = score.toLocaleString();
    $('rNew').textContent = playOpts.auto ? 'AUTO（記録なし）' : isNew ? 'NEW RECORD!' : '';
    $('rP').textContent = g.counts[0]; $('rG').textContent = g.counts[1]; $('rGd').textContent = g.counts[2]; $('rM').textContent = g.counts[3];
    $('rC').textContent = g.maxCombo; $('rA').textContent = (acc * 100).toFixed(2) + '%';
    $('rFS').textContent = g.early + ' / ' + g.late; $('rB').textContent = g.breaks;
    drawPortrait(playEntry, g, rank);
    audio.fanfare(rank);
    fx.flash = 1;
    setBackgroundFor(playEntry, true);
    if (cur !== playEntry) { /* 選択を同期 */ cur = playEntry; }
  }, failed ? 400 : 700);
}

// ---------------------------------------------------------------- リザルトの「音の肖像」
function drawPortrait(e, g, rank) {
  const c = $('portrait'), x = c.getContext('2d');
  const S = c.width = c.height = 720, R = S / 2;
  const d = e.data, an = d.an, pal = d.pal;
  x.clearRect(0, 0, S, S);
  const bgG = x.createRadialGradient(R, R, 20, R, R, R);
  bgG.addColorStop(0, '#0b0d22'); bgG.addColorStop(1, '#03040c');
  x.fillStyle = bgG; x.beginPath(); x.arc(R, R, R, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = 'lighter';
  const n = 540, r0 = R * .30;
  const cols = [pal.lanes[0], pal.lanes[2], pal.lanes[3]];
  const arrs = [an.low, an.mid, an.high];
  x.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    x.strokeStyle = cols[k]; x.lineWidth = 3.4; x.globalAlpha = .75;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * d.dur;
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const v = sampleArr(an, arrs[k], t);
      const inner = r0 + k * R * .14, len = 4 + v * R * .12;
      x.beginPath(); x.moveTo(R + Math.cos(a) * inner, R + Math.sin(a) * inner); x.lineTo(R + Math.cos(a) * (inner + len), R + Math.sin(a) * (inner + len)); x.stroke();
    }
  }
  // 打鍵
  x.globalAlpha = 1;
  const jc = ['#ffffff', '#ffd978', '#8cf0a8', '#ff5577'];
  for (const lg of g.log) {
    const a = (lg.t / d.dur) * Math.PI * 2 - Math.PI / 2;
    const rr = R * .84 + (lg.j === 3 ? 0 : clamp(lg.d / 150, -1, 1) * R * .035);
    x.fillStyle = jc[lg.j]; x.globalAlpha = lg.j === 3 ? .95 : lg.j === 0 ? .55 : .85;
    const s = lg.j === 3 ? 3.4 : 2.2;
    x.beginPath(); x.arc(R + Math.cos(a) * rr, R + Math.sin(a) * rr, s, 0, Math.PI * 2); x.fill();
  }
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  // 中央
  x.textAlign = 'center'; x.fillStyle = '#fff';
  x.font = '700 ' + Math.round(R * .34) + 'px Unbounded, sans-serif';
  x.shadowColor = pal.lanes[2]; x.shadowBlur = 30;
  x.fillText(rank, R, R + R * .08);
  x.shadowBlur = 0;
  x.font = '500 ' + Math.round(R * .055) + 'px Unbounded, sans-serif';
  x.fillStyle = 'rgba(255,255,255,.75)';
  x.fillText(g.displayScore.toLocaleString(), R, R + R * .2);
  x.font = '300 ' + Math.round(R * .036) + 'px Unbounded, sans-serif';
  x.fillStyle = 'rgba(255,255,255,.5)';
  x.fillText(d.title.length > 26 ? d.title.slice(0, 25) + '…' : d.title, R, R + R * .28);
  x.fillText('SYNESTHESIA ・ ' + DIFFS[playDiff].name, R, R + R * .335);
}

// ---------------------------------------------------------------- エフェクト・イベント
const fx = { rings: [], glows: [], laneGlow: [0, 0, 0, 0], punch: 0, flash: 0, beatPulse: 0, aud: [0, 0, 0, 0], bendT: 0, lastT: 0, lastKick: -1, hush: 0, comboB: 0 };
const JCOL = [[.7, .95, 1], [1, .82, .4], [.5, .95, .65]];
const state = { beatPtr: 0, kickPtr: 0, dropPtr: 0, paused: false, i0: 0 };
const jTxt = $('jTxt'), jSub = $('jSub'), jBox = $('judge');
let comboMilestone = 0;

function onGameEvent(type, d) {
  const isPlay = (scene === 'play');
  const lane = d.lane;
  if (type === 'hit') {
    const lc = renderer.laneCol[lane], j = JCOL[d.judge];
    const col = [(lc[0] * 1.2 + j[0]) * .6, (lc[1] * 1.2 + j[1]) * .6, (lc[2] * 1.2 + j[2]) * .6];
    fx.rings.push({ lane, age: 0, dur: .5, col, big: d.judge === 0 });
    fx.glows.push({ lane, age: 0, dur: .28, col, size: d.judge === 0 ? 1.15 : .85 });
    renderer.burst(LANE_X[lane], 0, col, d.judge === 0 ? 26 : d.judge === 1 ? 16 : 9, d.judge === 0 ? 1.1 : .8);
    fx.laneGlow[lane] = 1;
    if (isPlay) {
      audio.hit(lane, d.judge);
      showJudge(d.judge, d.delta);
      if (game && game.combo > 0 && game.combo % 50 === 0) { fx.flash = Math.max(fx.flash, .7); }
    }
  } else if (type === 'autoPress') {
    fx.laneGlow[lane] = 1;
  } else if (type === 'miss') {
    if (isPlay) { audio.miss(); showJudge(3, 0); renderer.shakeX = 1.5; fx.punch = 0; }
  } else if (type === 'holdEnd') {
    if (d.ok) {
      const lc = renderer.laneCol[lane];
      fx.rings.push({ lane, age: 0, dur: .6, col: [lc[0] + .3, lc[1] + .3, lc[2] + .3], big: true });
      renderer.burst(LANE_X[lane], 0, lc, 14, .9);
      if (isPlay) audio.hit(lane, 0);
    } else if (isPlay) { audio.breakSfx(); showJudge(3, 0, 'BREAK'); }
  } else if (type === 'fail') {
    if (isPlay) { toast('共鳴が途絶えました…'); const tok = playToken; setTimeout(() => { if (tok === playToken) finishPlay(true); }, 300); audio.stop(); }
  } else if (type === 'finish') {
    if (isPlay) finishPlay(false);
  }
}

function showJudge(j, delta, label) {
  jTxt.textContent = label || JUDGE_NAME[j];
  jTxt.className = 'j' + j;
  if (j === 3 || !settings.fast || j === 0) { jSub.textContent = ''; }
  else { jSub.textContent = delta < 0 ? 'FAST' : 'SLOW'; jSub.className = delta < 0 ? 'jFast' : 'jSlow'; }
  jBox.classList.remove('show'); void jBox.offsetWidth; jBox.classList.add('show');
}

// ---------------------------------------------------------------- 入力
const keyEls = [...document.querySelectorAll('#keys span')];
function keyLabel(code) { return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Semicolon', ';').replace('Comma', ',').replace('Period', '.').replace('Slash', '/').replace('Space', '␣').replace('Arrow', '').toUpperCase(); }
function refreshKeyLabels() { keyEls.forEach((el, i) => el.textContent = keyLabel(settings.keys[i])); }
refreshKeyLabels();
const evTime = (e) => (e.timeStamp > 1e11 ? performance.now() : e.timeStamp);

let rebinding = -1;
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (loadingFile) return;
  if (rebinding >= 0) {
    e.preventDefault();
    if (e.code === 'Escape') { rebinding = -1; buildKeyRow(); return; }
    { const dup = settings.keys.indexOf(e.code); if (dup >= 0 && dup !== rebinding) settings.keys[dup] = settings.keys[rebinding]; }
    settings.keys[rebinding] = e.code; rebinding = -1; saveSettings(); buildKeyRow(); refreshKeyLabels(); return;
  }
  if (calibActive) { if (e.code === 'Space' || settings.keys.includes(e.code)) { e.preventDefault(); calibTap(evTime(e)); } else if (e.code === 'Escape') closeCalib(); return; }
  if (scene === 'play') {
    if (e.code === 'Escape') { e.preventDefault(); pauseGame(); return; }
    const lane = settings.keys.indexOf(e.code);
    if (lane >= 0) {
      e.preventDefault();
      kickAudio();
      if (!playOpts.auto && audioStarted()) laneDownPress(lane, audio.songAt(evTime(e)));
    }
    return;
  }
  if (isModalOpen()) { if (e.code === 'Escape') closeModals(); return; }
  if (scene === 'pause') { if (e.code === 'Escape') { e.preventDefault(); resumeGame(); } return; }
  if (scene === 'title') { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); $('mPlay').click(); } }
  else if (scene === 'select') {
    if (e.code === 'Escape') $('selBack').click();
    else if (e.code === 'Enter') { e.preventDefault(); $('bStart').click(); }
    else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      const i = lib.indexOf(cur); const n = clamp(i + (e.code === 'ArrowDown' ? 1 : -1), 0, lib.length - 1);
      audio.ui('tap'); selectEntry(lib[n]);
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      curDiff = clamp(curDiff + (e.code === 'ArrowRight' ? 1 : -1), 0, 3); audio.ui('tap');
      if (cur && cur.data) { buildDiffs(); setBackgroundFor(cur); }
    }
  } else if (scene === 'result') {
    if (e.code === 'Enter') $('rRetry').click(); else if (e.code === 'Escape') $('rBack').click();
  }
});
window.addEventListener('keyup', (e) => {
  const lane = settings.keys.indexOf(e.code);
  if (lane < 0) return;
  if (scene === 'play' && !playOpts.auto && game) laneDownRelease(lane, audio.songAt(evTime(e)));
  else keyEls[lane].classList.remove('on');
});
// レーンごとの押下数（複数の指・キーボード併用でも、全部離したときだけ release）
const laneDown = [0, 0, 0, 0];
function laneDownPress(lane, t) { laneDown[lane]++; game.press(lane, t); keyEls[lane].classList.add('on'); fx.laneGlow[lane] = 1; }
function laneDownRelease(lane, t) { if (laneDown[lane] > 0) laneDown[lane]--; if (laneDown[lane] === 0) { game.release(lane, t); keyEls[lane].classList.remove('on'); } }
function clearKeyState() { laneDown.fill(0); ptr.clear(); keyEls.forEach(el => el.classList.remove('on')); }
function kickAudio() { if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume().catch(() => { }); }
function audioStarted() { return audio.playing && game && !counting; }

// タッチ・マウス（レーンを直接タップ）
const ptr = new Map();
function laneFromX(px, touch) {
  const W = renderer.cssW;
  const xl = renderer.project(-2, 0, 0)[0] * W, xr = renderer.project(2, 0, 0)[0] * W;
  return clamp(Math.floor((px - xl) / (xr - xl) * 4), 0, 3);
}
const fxBend = () => renderer.bend || [0, 0];
$('gl').addEventListener('pointerdown', onPtrDown);
$('app').addEventListener('pointerdown', (e) => { if (e.target.closest('button,input,select,label,.modal,.card')) return; onPtrDown(e); });
function onPtrDown(e) {
  if (scene === 'play') kickAudio();
  if (scene !== 'play' || playOpts.auto || !audioStarted()) return;
  if (e.clientY < renderer.cssH * 0.22 && e.target.closest && e.target.closest('.hud-top')) return;
  const lane = laneFromX(e.clientX, e.pointerType === 'touch');
  ptr.set(e.pointerId, lane);
  laneDownPress(lane, audio.songAt(evTime(e)));
  e.preventDefault();
}
function onPtrUp(e) {
  if (!ptr.has(e.pointerId)) return;
  const lane = ptr.get(e.pointerId); ptr.delete(e.pointerId);
  if (scene === 'play' && game && !playOpts.auto) laneDownRelease(lane, audio.songAt(evTime(e)));
}
window.addEventListener('pointerup', onPtrUp);
window.addEventListener('pointercancel', onPtrUp);
document.addEventListener('visibilitychange', () => { if (document.hidden && scene === 'play') pauseGame(); });
window.addEventListener('blur', () => { if (scene === 'play') pauseGame(); });
document.addEventListener('contextmenu', (e) => { if (scene === 'play') e.preventDefault(); });

// ---------------------------------------------------------------- ボタン類
$('mPlay').onclick = () => { audio.ensure(); audio.ui('ok'); gotoScene('select'); if (!cur) selectEntry(lib[0]); else selectEntry(cur); };
$('mFile').onclick = () => { audio.ensure(); audio.ui('tap'); $('file').click(); };
$('file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f); };
$('mFull').onclick = toggleFull;
if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) $('mFull').classList.add('hidden');
function toggleFull() {
  const d = document;
  if (!d.fullscreenElement && !d.webkitFullscreenElement) (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen || (() => { })).call(d.documentElement);
  else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
}
$('mSettings').onclick = $('selSettings').onclick = $('pSettings').onclick = () => { audio.ensure(); openModal('settings'); };
$('mHelp').onclick = () => { audio.ensure(); openModal('help'); };
$('sClose').onclick = () => closeModals(); $('hClose').onclick = () => closeModals();
$('selBack').onclick = () => { audio.ui('back'); gotoScene('title'); };
$('bStart').onclick = () => { if (!cur || !cur.data) return; audio.ui('ok'); startPlay(cur, curDiff, { auto: $('oAuto').checked, surv: $('oSurv').checked }); };
$('bPause').onclick = () => pauseGame();
$('pResume').onclick = () => resumeGame();
$('pRetry').onclick = () => { $('pause').classList.add('hidden'); audio.stop(); startPlay(playEntry, playDiff, playOpts); };
$('pQuit').onclick = () => quitToSelect();
$('rRetry').onclick = () => startPlay(playEntry, playDiff, playOpts);
$('rBack').onclick = () => { audio.ui('back'); gotoScene('select'); if (cur) onEntryReady(cur); };
$('rSave').onclick = () => {
  const src = $('portrait'), out = document.createElement('canvas');
  out.width = out.height = src.width;
  const x = out.getContext('2d'); x.fillStyle = '#05060f'; x.fillRect(0, 0, out.width, out.height); x.drawImage(src, 0, 0);
  out.toBlob((b) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    const nm = (playEntry.data.title || '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40) || 'song';
    a.download = 'synesthesia-' + nm + '.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
};
function isModalOpen() { return ['settings', 'help', 'calib'].some(id => !$(id).classList.contains('hidden')); }
function openModal(id) { $(id).classList.remove('hidden'); if (id === 'settings') syncSettingsUI(); }
function closeModals() { ['settings', 'help'].forEach(id => $(id).classList.add('hidden')); rebinding = -1; }
// 背景クリックで閉じる
for (const id of ['settings', 'help', 'pause']) $(id).addEventListener('pointerdown', (e) => { if (e.target === $(id) && id !== 'pause') closeModals(); });

// ドラッグ&ドロップ
let dragN = 0;
window.addEventListener('dragenter', (e) => { if (scene === 'play' || scene === 'pause') return; e.preventDefault(); dragN++; $('drop').classList.remove('hidden'); });
window.addEventListener('dragleave', (e) => { dragN = Math.max(0, dragN - 1); if (!dragN) $('drop').classList.add('hidden'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragN = 0; $('drop').classList.add('hidden');
  if (scene === 'play') return;
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

// ---------------------------------------------------------------- 設定UI
function syncSettingsUI() {
  const set = (id, v, txt) => { $(id).value = v; if (txt != null) $('v' + id.slice(1)).textContent = txt; };
  set('sSpeed', settings.speed, settings.speed);
  set('sOffset', settings.offset, (settings.offset > 0 ? '+' : '') + settings.offset + ' ms');
  set('sMusic', settings.music, settings.music + '%');
  set('sSfx', settings.sfx, settings.sfx + '%');
  set('sBloom', settings.bloom, settings.bloom + '%');
  set('sCam', settings.cam, settings.cam + '%');
  $('sQual').value = String(settings.quality);
  $('sHitSnd').checked = settings.hitSnd; $('sFast').checked = settings.fast;
  buildKeyRow();
}
function bindRange(id, key, fmt, after) {
  $(id).oninput = () => { settings[key] = +$(id).value; $('v' + id.slice(1)).textContent = fmt(settings[key]); saveSettings(); if (after) after(); };
}
bindRange('sSpeed', 'speed', v => v);
bindRange('sOffset', 'offset', v => (v > 0 ? '+' : '') + v + ' ms', () => { if (game) game.offset = settings.offset / 1000; });
bindRange('sMusic', 'music', v => v + '%', () => audio.setVolumes(settings.music / 100, settings.sfx / 100));
bindRange('sSfx', 'sfx', v => v + '%', () => audio.setVolumes(settings.music / 100, settings.sfx / 100));
bindRange('sBloom', 'bloom', v => v + '%', applyGfx);
bindRange('sCam', 'cam', v => v + '%', applyGfx);
$('sQual').onchange = () => { settings.quality = $('sQual').value; saveSettings(); resize(true); };
$('sHitSnd').onchange = () => { settings.hitSnd = $('sHitSnd').checked; audio.sfxOn = settings.hitSnd; saveSettings(); };
$('sFast').onchange = () => { settings.fast = $('sFast').checked; saveSettings(); };
function applyGfx() { renderer.glow = settings.bloom / 100; renderer.camMotion = settings.cam / 100; }
applyGfx();
function buildKeyRow() {
  const row = $('keyRow'); row.innerHTML = '';
  settings.keys.forEach((k, i) => {
    const b = document.createElement('button');
    b.textContent = rebinding === i ? '…' : keyLabel(k);
    b.className = rebinding === i ? 'wait' : '';
    b.style.borderBottom = '3px solid ' + (cur && cur.data ? cur.data.pal.lanes[i] : DEFAULT_PAL.lanes[i]);
    b.onclick = () => { rebinding = i; buildKeyRow(); };
    row.appendChild(b);
  });
}

// ---------------------------------------------------------------- 判定タイミングの自動調整
let calibActive = false, calibTimes = [], calibDeltas = [], calibTimer = 0;
$('sCalib').onclick = () => {
  audio.ensure();
  closeModals(); $('calib').classList.remove('hidden');
  calibActive = true; calibDeltas = []; calibTimes = [];
  $('calibDots').innerHTML = '<i></i>'.repeat(12); $('calibVal').textContent = '—';
  const c = audio.ctx, bpm = 100, spb = 60 / bpm;
  const t0 = c.currentTime + 0.6;
  calibNodes = [];
  for (let k = 0; k < 40; k++) {
    const t = t0 + k * spb; calibTimes.push(t);
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = k % 4 === 0 ? 1320 : 990; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.5, t + .002); g.gain.exponentialRampToValueAtTime(.0001, t + .07);
    o.connect(g); g.connect(audio.sfxG); o.start(t); o.stop(t + .1);
    calibNodes.push(o);
  }
};
$('calibClose').onclick = closeCalib;
let calibNodes = [];
function closeCalib() { calibNodes.forEach(o => { try { o.stop(); } catch (e) { /* */ } }); calibNodes = []; calibActive = false; $('calib').classList.add('hidden'); openModal('settings'); }
function heardCtx(perfMs) {
  const c = audio.ctx;
  const ts = c.getOutputTimestamp ? c.getOutputTimestamp() : null;
  if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  return c.currentTime - (c.outputLatency || c.baseLatency || 0) + (perfMs - performance.now()) / 1000;
}
function calibTap(perfMs) {
  const tc = heardCtx(perfMs);
  let best = null, bd = 9;
  for (const t of calibTimes) { const d = tc - t; if (Math.abs(d) < Math.abs(bd)) { bd = d; best = t; } }
  if (best == null || Math.abs(bd) > 0.25) return;
  calibDeltas.push(bd);
  const dots = $('calibDots').children;
  if (calibDeltas.length <= 12) dots[calibDeltas.length - 1].classList.add('on');
  const arr = calibDeltas.slice(-12).sort((a, b) => a - b);
  const med = arr[Math.floor(arr.length / 2)];
  $('calibVal').textContent = (med * 1000 > 0 ? '+' : '') + Math.round(med * 1000) + ' ms';
  if (calibDeltas.length >= 12) {
    settings.offset = clamp(Math.round(med * 1000), -200, 200); saveSettings();
    toast('補正を ' + settings.offset + ' ms に設定しました');
    closeCalib();
  }
}
$('calib').addEventListener('pointerdown', (e) => { if (calibActive && !e.target.closest('button')) calibTap(evTime(e)); });

// ---------------------------------------------------------------- リサイズ・画質
let qScale = 1, frameAvg = 16, qCool = 0;
function resize(force) {
  const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const q = settings.quality === 'auto' ? qScale : +settings.quality;
  renderer.resize(w, h, dpr, q);
}
window.addEventListener('resize', () => resize());
resize();

// ---------------------------------------------------------------- メインループ
let lastNow = performance.now(), wall = 0, demoClock = 0;
const emptyNotes = [];
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastNow) / 1000; lastNow = now;
  if (dt > .25) dt = .25;
  wall += dt;
  // 動的解像度
  if (dt < 0.1) frameAvg += (dt * 1000 - frameAvg) * 0.05;
  qCool -= dt;
  if (settings.quality === 'auto' && qCool <= 0) {
    if (frameAvg > 24 && qScale > .5) { qScale = Math.max(.5, qScale - .1); qCool = 1.5; resize(); }
    else if (frameAvg < 18.5 && qScale < 1) { qScale = Math.min(1, qScale + .05); qCool = 8; resize(); }
  }

  let t = 0, notes = emptyNotes, i0 = 0, an = demo.an, g = null, kicks = demo.kicks, beatsA = demo.an.beats;
  if (scene === 'play' || scene === 'pause') {
    g = game;
    if (scene === 'play') {
      const rawT = audio.tick();
      const cEl = $('count');
      const floorT = countFrom > 0 ? countFrom : -1e9;
      counting = rawT < (countFrom > 0 ? countFrom : 0);
      if (counting) {
        const remain = (countFrom > 0 ? countFrom : 0) - rawT;
        const n = Math.ceil(remain / (countFrom > 0 ? 0.66 : 0.72));
        if (n >= 1 && n <= 3 && cEl.dataset.n !== String(n)) { cEl.dataset.n = n; cEl.textContent = n; cEl.classList.remove('hidden', 'tick'); void cEl.offsetWidth; cEl.classList.add('tick'); }
      } else if (!cEl.classList.contains('hidden')) { cEl.classList.add('hidden'); cEl.dataset.n = ''; }
      t = Math.max(rawT, floorT);
      g.update(t);
      if (audio.ended && !resultShown) { g.finalize(); finishPlay(!!g.failed); }
    } else t = pausedT;
    an = playEntry.data.an; notes = g.notes; i0 = g.i0; kicks = playEntry._kicks || (playEntry._kicks = kicksOf(playEntry.data.cands)); beatsA = an.beats;
  } else {
    // 背景（デモ・プレビュー）
    if (!bg) setBackground(demoBg());
    const c = bg.clock;
    let rel;
    if (c.mode === 'audio' && audio.ctx && audio.ctx.state === 'running' && c.ctx0) {
      rel = audio.ctx.currentTime - c.ctx0;
      if (rel > c.len + 0.1 && scene === 'select' && cur && cur.data) { setBackgroundFor(cur); }
    } else rel = (now - c.t0) / 1000;
    if (c.mode !== 'audio' && rel > c.len) { // ループ
      if (bg.an === demo.an) setBackground(demoBg()); else { c.t0 = now; bg.game.seek(c.from); bg.kp = 0; bg.bp = 0; }
      rel = 0;
    }
    if (bg) {
      t = c.from + Math.max(0, rel);
      bg.game.update(t);
      g = bg.game; notes = g.notes; i0 = g.i0; an = bg.an; kicks = bg.kicks; beatsA = an.beats;
    }
  }

  // ---- 音の特徴量 ----
  const A = fx.aud;
  const k = 1 - Math.exp(-dt * 16);
  A[0] += (sampleArr(an, an.low, t) - A[0]) * k;
  A[1] += (sampleArr(an, an.mid, t) - A[1]) * k;
  A[2] += (sampleArr(an, an.high, t) - A[2]) * k;
  A[3] += (sampleArr(an, an.all, t) - A[3]) * k;
  // 拍・キック・ドロップ
  let beatPulse = 0;
  {
    const b = beatsA; let lo = 0, hi = b.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (b[m] <= t) lo = m + 1; else hi = m; }
    const idx = lo - 1;
    if (idx >= 0) {
      const ph = t - b[idx];
      const sg = an.sig || 4;
      const isBar = (((idx - (an.downPhase || 0)) % sg) + sg) % sg === 0;
      beatPulse = Math.exp(-ph * 6) * (isBar ? 1 : .55);
    }
    // キック
    const kk = kicks; let kl = 0, kh = kk.length;
    while (kl < kh) { const m = (kl + kh) >> 1; if (kk[m] <= t) kl = m + 1; else kh = m; }
    const ki = kl - 1;
    if (ki >= 0 && t - kk[ki] < dt * 1.5 + 0.02 && ki !== fx.lastKick) { fx.punch = 1; fx.lastKick = ki; }
    // ドロップ
    const dr = an.drops || []; for (let q = 0; q < dr.length; q++) { if (dr[q] <= t && dr[q] > fx.lastT - 0 && dr[q] > t - dt * 2) fx.flash = 1; }
  }
  fx.lastT = t;
  fx.punch *= Math.exp(-dt * 9);
  fx.flash *= Math.exp(-dt * 2.4);
  if (renderer.shakeX) renderer.shakeX *= Math.exp(-dt * 9);
  // 地形の曲がり
  let hush = 0;
  { const dr = an.drops || []; for (let q = 0; q < dr.length; q++) { const x = dr[q] - t; if (x > -0.1 && x < 1.6) { hush = Math.max(hush, x < 0 ? 0 : Math.min(1, (1.6 - x) / 1.4)); } } }
  fx.hush += (hush - fx.hush) * (1 - Math.exp(-dt * (hush > fx.hush ? 4 : 14)));
  const comboBoost = g && scene === 'play' ? Math.min(1, g.combo / 120) * .3 : 0;
  fx.comboB += (comboBoost - fx.comboB) * (1 - Math.exp(-dt * 1.5));
  const inten = clamp(sampleArr(an, an.inten, t) * (1 - fx.hush * .5) + fx.comboB);
  const bx = .0032 * Math.sin(t * .16 + 1) * (.25 + inten * .75), by = .00075 * Math.sin(t * .11 + 2) * (.3 + inten);
  fx.bendT += (1 - Math.exp(-dt * 2)) * 0;
  // レーンの光
  for (let l = 0; l < 4; l++) {
    const down = g && g.pressed[l];
    if (down) fx.laneGlow[l] = Math.min(1, fx.laneGlow[l] + dt * 14);
    else fx.laneGlow[l] *= Math.exp(-dt * 7.5);
    if (scene === 'play' && !down && keyEls[l].classList.contains('on') && !ptr.size && playOpts.auto) keyEls[l].classList.remove('on');
  }
  for (const r of fx.rings) r.age += dt; for (const gl2 of fx.glows) gl2.age += dt;
  fx.rings = fx.rings.filter(r => r.age < r.dur); fx.glows = fx.glows.filter(r => r.age < r.dur);

  const st = {
    t, dt, time: wall, speed: speedOf(), notes, i0, beats: an.beats, downPhase: an.downPhase, an,
    laneGlow: fx.laneGlow, aud: A, flash: fx.flash, punch: fx.punch, inten, hush: fx.hush, beatPulse, bend: [bx, by],
    rings: fx.rings, glows: fx.glows, fade: 1,
  };
  if (scene === 'result') { st.speed = 18; }
  renderer.render(st);

  if (scene === 'play' || scene === 'pause') updateHud(g, t);
  // キーラベルの位置
  if (scene === 'play' || scene === 'pause') {
    const W = renderer.cssW, H = renderer.cssH;
    for (let l = 0; l < 4; l++) {
      const p = renderer.project(LANE_X[l], 0, 1.15);
      keyEls[l].style.left = (p[0] * W) + 'px'; keyEls[l].style.top = Math.min(p[1] * H, H - 24) + 'px';
    }
  }
}

function updateHud(g, t) {
  const sc = String(g.displayScore).padStart(7, '0');
  if (sc !== hudScore) { hudScore = sc; $('hScore').textContent = sc; }
  const acc = (g.liveAcc * 100).toFixed(2) + '%';
  if (acc !== hudAcc) { hudAcc = acc; $('hAcc').textContent = acc; }
  if (g.combo !== hudCombo) {
    const n = $('comboN');
    n.textContent = g.combo; $('combo').classList.toggle('on', g.combo >= 2);
    if (g.combo > hudCombo) { n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); }
    hudCombo = g.combo;
  }
  const d = playEntry.data;
  $('prog').firstElementChild.style.width = (clamp(t / d.dur) * 100).toFixed(2) + '%';
  const gg = $('gauge');
  gg.firstElementChild.style.height = (g.gauge * 100).toFixed(0) + '%';
  gg.classList.toggle('low', g.gauge < .25);
}

requestAnimationFrame(frame);

// ---------------------------------------------------------------- 起動
buildList();
// 最初の曲は背景でこっそり生成しておく
loadBuiltin(lib[0]).catch(() => { });
// プレイ中は先行生成を待たせる（フレーム落ち防止）
const idle = () => new Promise(res => { const w = () => (scene === 'play' ? setTimeout(w, 1500) : res()); w(); });
setTimeout(() => { lib.slice(1).reduce((p, e) => p.then(idle).then(() => loadBuiltin(e).catch(() => { })), Promise.resolve()); }, 2500);

// デバッグ用フック
window.__syn = {
  get scene() { return scene; }, lib, settings, renderer, audio,
  get game() { return game; }, get bg() { return bg; },
  start(i, di = 1, auto = true) { const e = lib[i]; return loadBuiltin(e).then(() => { cur = e; curDiff = di; startPlay(e, di, { auto }); }); },
  select(i) { return loadBuiltin(lib[i]).then(() => { gotoScene('select'); selectEntry(lib[i]); }); },
  fx, DIFFS, chartOf, loadBuiltin,
  seek(t) { game.seek(t); countFrom = t; audio.start(playEntry.data.buffer, t, 0.1); },
};
const qs = new URLSearchParams(location.search);
if (qs.has('song')) {
  const i = Math.max(0, SONGS.findIndex(s => s.id === qs.get('song')));
  window.__syn.start(i, +(qs.get('diff') || 1), qs.get('auto') !== '0');
}
