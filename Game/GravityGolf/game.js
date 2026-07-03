/* ============================================================
   グラビティゴルフ — ゲーム本体
   （描画・入力・進行・演出・サウンド）
   ============================================================ */
(() => {
"use strict";

const C = GGP.C;

/* ================= DOM ================= */
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const $ = id => document.getElementById(id);
const el = {
  hud: $("hud"), hudHole: $("hudHole"), hudName: $("hudName"),
  hudStrokes: $("hudStrokes"), hudPar: $("hudPar"), hudBest: $("hudBest"),
  btnBack: $("btnBack"), btnRetry: $("btnRetry"), btnRecall: $("btnRecall"),
  btnGuide: $("btnGuide"), btnSound: $("btnSound"),
  banner: $("banner"), hint: $("hint"), toast: $("toast"),
  screenTitle: $("screenTitle"), screenCourse: $("screenCourse"),
  screenHoles: $("screenHoles"),
  btnStart: $("btnStart"), titleStars: $("titleStars"),
  courseList: $("courseList"), holesTitle: $("holesTitle"), holeGrid: $("holeGrid"),
  btnTitleBack: $("btnTitleBack"), btnCourseBack: $("btnCourseBack"),
  overlayClear: $("overlayClear"), clearScore: $("clearScore"),
  clearStars: $("clearStars"), clearDetail: $("clearDetail"), clearBest: $("clearBest"),
  btnClearRetry: $("btnClearRetry"), btnClearList: $("btnClearList"),
  btnClearNext: $("btnClearNext")
};

/* ================= セーブ ================= */
const SAVE_KEY = "gravityGolf_v1";
let save = { best: {}, sound: true, guide: true };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s && typeof s === "object") save = Object.assign(save, s);
} catch (e) { /* 壊れたセーブは初期化 */ }
function store() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

function starsOf(id, par) {
  const b = save.best[id];
  if (!b) return 0;
  return b <= par ? 3 : (b <= par + 2 ? 2 : 1);
}
function courseStars(c) {
  let n = 0;
  for (let i = 0; i < 9; i++) { const lv = GG_LEVELS[c * 9 + i]; n += starsOf(lv.id, lv.par); }
  return n;
}
function totalStars() {
  let n = 0;
  for (const lv of GG_LEVELS) n += starsOf(lv.id, lv.par);
  return n;
}
function courseUnlocked(c) { return c === 0 || !!save.best[GG_LEVELS[c * 9 - 1].id]; }
function holeUnlocked(i) {
  return (i % 9 === 0) ? courseUnlocked(Math.floor(i / 9)) : !!save.best[GG_LEVELS[i - 1].id];
}

/* ================= サウンド（WebAudio合成） ================= */
const AU = {
  ctx: null, master: null, amb: null,
  ensure() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = save.sound ? 0.5 : 0;
    this.master.connect(this.ctx.destination);
    this.startAmbient();
  },
  setMuted(m) { if (this.master) this.master.gain.value = m ? 0 : 0.5; },
  tone(f0, f1, dur, type, vol, delay) {
    if (!this.ctx || !save.sound) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, freq, q, delay) {
    if (!this.ctx || !save.sound) return;
    const t = this.ctx.currentTime + (delay || 0);
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q || 1;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  },
  click()  { this.tone(640, 480, 0.07, "square", 0.06); },
  launch(p){ this.noise(0.25, 0.5, 500 + 900 * p, 0.8); this.tone(120, 55, 0.22, "sine", 0.25); },
  bounce(v){ const s = Math.min(v / 700, 1); this.noise(0.08, 0.25 * s + 0.05, 900, 1.5); this.tone(160 + 80 * s, 70, 0.12, "triangle", 0.18 * s + 0.04); },
  land()   { this.noise(0.1, 0.12, 400, 1); this.tone(110, 70, 0.15, "sine", 0.12); },
  boost()  { this.tone(320, 980, 0.2, "sawtooth", 0.12); this.tone(640, 1960, 0.2, "sine", 0.08, 0.02); },
  warp()   { this.tone(760, 180, 0.12, "sine", 0.16); this.tone(180, 900, 0.16, "sine", 0.16, 0.1); },
  burn()   { this.noise(0.5, 0.45, 300, 0.6); this.tone(220, 45, 0.5, "sawtooth", 0.14); },
  fall()   { this.tone(500, 60, 0.55, "sine", 0.2); },
  ob()     { this.tone(300, 200, 0.15, "triangle", 0.1); },
  goal()   {
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => this.tone(f, f, 0.32, "triangle", 0.16, i * 0.09));
    this.tone(2093, 1568, 0.5, "sine", 0.05, 0.4);
  },
  star(k)  { this.tone(880 + k * 220, 880 + k * 220, 0.2, "triangle", 0.14); },
  startAmbient() {
    if (!this.ctx || this.amb) return;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    const o1 = this.ctx.createOscillator(); o1.type = "sine"; o1.frequency.value = 55;
    const o2 = this.ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = 82.7;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = this.ctx.createGain(); lg.gain.value = 0.025;
    lfo.connect(lg); lg.connect(g.gain);
    o1.connect(g); o2.connect(g); g.connect(this.master);
    o1.start(); o2.start(); lfo.start();
    this.amb = g;
  }
};

/* ================= 画面サイズ・座標変換 ================= */
let scale = 1, ox = 0, oy = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.floor(innerWidth * dpr);
  cv.height = Math.floor(innerHeight * dpr);
  scale = Math.min(innerWidth / C.W, innerHeight / C.H) * 0.97;
  ox = (innerWidth - C.W * scale) / 2;
  oy = (innerHeight - C.H * scale) / 2;
}
addEventListener("resize", resize);
resize();
function toWorld(cx, cy) { return { x: (cx - ox) / scale, y: (cy - oy) / scale }; }

/* ================= 背景（星空・星雲） ================= */
const bgStars = [];
{
  let s = 12345;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 210; i++) {
    bgStars.push({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 1.4, tw: rnd() * 6.28, l: rnd() });
  }
}
function drawBackground(time, tint) {
  const w = innerWidth, h = innerHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#070a18"); g.addColorStop(0.6, "#05070f"); g.addColorStop(1, "#080614");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // 星雲
  ctx.globalAlpha = 0.14;
  let neb = ctx.createRadialGradient(w * 0.75, h * 0.28, 0, w * 0.75, h * 0.28, w * 0.4);
  neb.addColorStop(0, tint); neb.addColorStop(1, "transparent");
  ctx.fillStyle = neb; ctx.fillRect(0, 0, w, h);
  neb = ctx.createRadialGradient(w * 0.15, h * 0.8, 0, w * 0.15, h * 0.8, w * 0.35);
  neb.addColorStop(0, "#31418a"); neb.addColorStop(1, "transparent");
  ctx.fillStyle = neb; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  // 星（ゆっくり流れ＋またたき）
  for (const st of bgStars) {
    const drift = (time * (2 + st.l * 6)) / w;
    const x = ((st.x + drift * 0.01) % 1) * w;
    const y = st.y * h;
    const a = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(time * (0.6 + st.l) + st.tw));
    ctx.globalAlpha = a * (0.4 + st.l * 0.6);
    ctx.fillStyle = "#cfe0ff";
    ctx.beginPath(); ctx.arc(x, y, st.r, 0, 6.29); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ================= 惑星スプライト ================= */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PALETTES = [
  { base: "#3fbf9f", dark: "#20705c", light: "#a5f5dc" },
  { base: "#d9a066", dark: "#8a5a2e", light: "#ffdcae" },
  { base: "#5b8dd9", dark: "#33518f", light: "#b5d4ff" },
  { base: "#d97b9c", dark: "#8f4562", light: "#ffc3d8" },
  { base: "#8fbf5f", dark: "#557a32", light: "#d5f5ae" },
  { base: "#9a86d9", dark: "#5c4c8f", light: "#d8ccff" }
];
const spriteCache = new Map();
function planetSprite(b) {
  const key = b.t + "_" + b.r + "_" + (b.seed || 0);
  if (spriteCache.has(key)) return spriteCache.get(key);
  const SS = 2, r = b.r * SS, pad = b.r * 0.5 * SS;
  const size = Math.ceil((r + pad) * 2);
  const oc = document.createElement("canvas");
  oc.width = oc.height = size;
  const c = oc.getContext("2d");
  const cx = size / 2, cy = size / 2;
  const rnd = mulberry((b.seed || 0) * 7919 + 13);
  const pal = b.t === "r"
    ? { base: "#a970e8", dark: "#5c3a90", light: "#e2c8ff" }
    : PALETTES[(b.seed || 0) % PALETTES.length];
  // 大気の光
  let g = c.createRadialGradient(cx, cy, r * 0.8, cx, cy, r + pad);
  g.addColorStop(0, pal.base + "55"); g.addColorStop(1, "transparent");
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  // 本体
  g = c.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, pal.light); g.addColorStop(0.5, pal.base); g.addColorStop(1, pal.dark);
  c.fillStyle = g;
  c.beginPath(); c.arc(cx, cy, r, 0, 6.29); c.fill();
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, 6.29); c.clip();
  if (b.t === "r") {
    // リペラー: 同心の波紋模様
    c.strokeStyle = "rgba(230, 205, 255, 0.35)"; c.lineWidth = r * 0.06;
    for (let i = 1; i <= 3; i++) {
      c.beginPath(); c.arc(cx, cy, r * i / 3.4, 0, 6.29); c.stroke();
    }
  } else if ((b.seed || 0) % 3 === 0) {
    // 縞模様
    c.fillStyle = "rgba(0,0,30,0.16)";
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const yy = cy - r + rnd() * r * 2, hh = r * (0.12 + rnd() * 0.15);
      c.fillRect(cx - r, yy, r * 2, hh);
    }
  } else {
    // クレーター
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, dd = rnd() * r * 0.72;
      const px = cx + Math.cos(a) * dd, py = cy + Math.sin(a) * dd;
      const cr = r * (0.08 + rnd() * 0.14);
      c.fillStyle = "rgba(0,0,30,0.22)";
      c.beginPath(); c.arc(px, py, cr, 0, 6.29); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.14)"; c.lineWidth = cr * 0.25;
      c.beginPath(); c.arc(px, py, cr, -2.5, -0.6); c.stroke();
    }
  }
  // 夜側の影
  g = c.createRadialGradient(cx + r * 0.55, cy + r * 0.55, r * 0.2, cx + r * 0.3, cy + r * 0.3, r * 1.25);
  g.addColorStop(0, "transparent"); g.addColorStop(1, "rgba(2,4,16,0.5)");
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  c.restore();
  const sp = { canvas: oc, half: size / 2 / SS };
  spriteCache.set(key, sp);
  return sp;
}
function sunSprite(b) {
  const key = "s_" + b.r;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const SS = 2, r = b.r * SS, pad = b.r * 0.9 * SS;
  const size = Math.ceil((r + pad) * 2);
  const oc = document.createElement("canvas");
  oc.width = oc.height = size;
  const c = oc.getContext("2d");
  const cx = size / 2;
  const g = c.createRadialGradient(cx, cx, 0, cx, cx, r + pad);
  g.addColorStop(0, "#fff8e0"); g.addColorStop(0.32, "#ffd75e");
  g.addColorStop(0.52, "#ff8c3a"); g.addColorStop(0.72, "rgba(255,90,40,0.25)");
  g.addColorStop(1, "transparent");
  c.fillStyle = g; c.beginPath(); c.arc(cx, cx, r + pad, 0, 6.29); c.fill();
  const sp = { canvas: oc, half: size / 2 / SS };
  spriteCache.set(key, sp);
  return sp;
}

/* ================= パーティクル ================= */
let particles = [];
function spawn(n, fn) { for (let i = 0; i < n; i++) particles.push(fn(i)); }
function burst(x, y, color, n, speed, life, size) {
  spawn(n, () => {
    const a = Math.random() * 6.28, v = speed * (0.3 + Math.random() * 0.7);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
             life: life * (0.5 + Math.random() * 0.5), max: life,
             size: size * (0.5 + Math.random() * 0.8), color, drag: 0.985 };
  });
}
function implode(x, y, color, n, radius, life) {
  spawn(n, () => {
    const a = Math.random() * 6.28, d = radius * (0.5 + Math.random() * 0.5);
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    return { x: px, y: py, vx: (x - px) / life * 1.4, vy: (y - py) / life * 1.4,
             life, max: life, size: 2 + Math.random() * 2.5, color, drag: 1 };
  });
}
function ringWave(x, y, color, r0, r1, life, width) {
  particles.push({ x, y, ring: true, r0, r1, w: width || 3, life, max: life, color });
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    if (!p.ring) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= p.drag; p.vy *= p.drag;
    }
  }
}
function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    const a = Math.max(p.life / p.max, 0);
    if (p.ring) {
      const t = 1 - p.life / p.max;
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = p.color; ctx.lineWidth = p.w * a;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * t, 0, 6.29); ctx.stroke();
    } else {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, 6.29); ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ================= ゲーム状態 ================= */
let mode = "title";          // title | course | holes | play
let curCourse = 0;
const play = {
  idx: 0, level: null, st: null,
  trail: [], shake: 0, flash: 0, flashColor: "255,80,80",
  aim: null,                 // {sx,sy,cx,cy} ワールド座標
  clearTimer: -1, deadTimer: -1, goalAnim: -1,
  goalFrom: null, idle: 0, acc: 0, cleared: false
};
let globalTime = 0;
let hintTimer = null, toastTimer = null, bannerTimer = null;

/* ================= 画面遷移 ================= */
function show(elm) { elm.classList.remove("hidden"); }
function hide(elm) { elm.classList.add("hidden"); }
function switchScreen(m) {
  mode = m;
  hide(el.screenTitle); hide(el.screenCourse); hide(el.screenHoles);
  hide(el.hud); hide(el.overlayClear); hide(el.hint); hide(el.banner);
  if (m === "title") { show(el.screenTitle); el.titleStars.innerHTML = `<span class="ic ic-star"></span> ${totalStars()} / ${GG_LEVELS.length * 3}`; }
  if (m === "course") { buildCourseList(); show(el.screenCourse); }
  if (m === "holes") { buildHoleGrid(); show(el.screenHoles); }
  if (m === "play") show(el.hud);
}

function buildCourseList() {
  el.courseList.innerHTML = "";
  GG_COURSES.forEach((cs, i) => {
    const btn = document.createElement("button");
    btn.className = "course-card" + (courseUnlocked(i) ? "" : " locked");
    btn.innerHTML =
      `<div class="cinfo"><span class="cnum">${cs.sub}</span>` +
      `<span class="cname">${cs.name}</span></div>` +
      `<span class="cstars"><span class="ic ic-star"></span>${courseStars(i)}/27</span>`;
    btn.addEventListener("click", () => {
      if (!courseUnlocked(i)) { showToast("前のコースの 9番ホールをクリアで解放", "info"); return; }
      AU.click(); curCourse = i; switchScreen("holes");
    });
    el.courseList.appendChild(btn);
  });
}

function buildHoleGrid() {
  const cs = GG_COURSES[curCourse];
  el.holesTitle.innerHTML = `<small>${cs.sub}</small>${cs.name}`;
  el.holeGrid.innerHTML = "";
  for (let h = 0; h < 9; h++) {
    const i = curCourse * 9 + h;
    const lv = GG_LEVELS[i];
    const st = starsOf(lv.id, lv.par);
    const unlocked = holeUnlocked(i);
    const btn = document.createElement("button");
    btn.className = "hole-cell" + (unlocked ? "" : " locked");
    let starsHtml = "";
    for (let k = 0; k < 3; k++) starsHtml += `<span class="ic ic-star${k < st ? "" : " off"}"></span>`;
    btn.innerHTML =
      `<span class="hnum">${lv.id}</span><span class="hname">${lv.name}</span>` +
      `<span class="hstars">${starsHtml}</span>`;
    btn.addEventListener("click", () => {
      if (!unlocked) { showToast("前のホールをクリアで解放", "info"); return; }
      AU.click(); startLevel(i);
    });
    el.holeGrid.appendChild(btn);
  }
}

/* ================= レベル進行 ================= */
function startLevel(idx) {
  play.idx = idx;
  play.level = GG_LEVELS[idx];
  play.st = GGP.makeState(play.level);
  play.trail = []; particles = [];
  play.shake = 0; play.flash = 0; play.aim = null;
  play.clearTimer = -1; play.deadTimer = -1; play.goalAnim = -1;
  play.idle = 0; play.acc = 0; play.cleared = false;
  curCourse = Math.floor(idx / 9);
  switchScreen("play");
  updateHud();
  // バナー
  el.banner.innerHTML = `<small>HOLE ${play.level.id} ・ PAR ${play.level.par}</small>${play.level.name}`;
  hide(el.banner); void el.banner.offsetWidth;   // アニメ再生し直し
  show(el.banner);
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => hide(el.banner), 2500);
  // ヒント
  clearTimeout(hintTimer);
  if (play.level.hint) {
    el.hint.textContent = play.level.hint;
    show(el.hint);
    hintTimer = setTimeout(() => hide(el.hint), 6000);
  } else hide(el.hint);
}

function updateHud() {
  const lv = play.level;
  el.hudHole.textContent = lv.id;
  el.hudName.textContent = lv.name;
  el.hudStrokes.textContent = play.st.strokes;
  el.hudPar.textContent = lv.par;
  el.hudBest.textContent = save.best[lv.id] || "—";
}

function scoreName(strokes, par) {
  if (strokes === 1) return { text: "ホールインワン！", super: true };
  const d = strokes - par;
  if (d <= -3) return { text: "アルバトロス！！", super: true };
  if (d === -2) return { text: "イーグル！", super: true };
  if (d === -1) return { text: "バーディー！", super: true };
  if (d === 0) return { text: "パー", super: false };
  if (d === 1) return { text: "ボギー", super: false };
  if (d === 2) return { text: "ダブルボギー", super: false };
  return { text: `+${d}`, super: false };
}

function onClear() {
  const lv = play.level, st = play.st;
  const prev = save.best[lv.id];
  const isBest = !prev || st.strokes < prev;
  if (isBest) { save.best[lv.id] = st.strokes; store(); }
  const sc = scoreName(st.strokes, lv.par);
  el.clearScore.textContent = sc.text;
  el.clearScore.classList.toggle("super", sc.super);
  el.clearDetail.textContent = `${st.strokes} 打 ／ パー ${lv.par}`;
  el.clearBest.textContent = isBest ? (prev ? "ベスト更新！" : "") : `ベスト: ${prev} 打`;
  const n = starsOf(lv.id, lv.par);
  const spans = el.clearStars.querySelectorAll(".star");
  spans.forEach((s, i) => {
    s.classList.remove("on"); void s.offsetWidth;
    if (i < n) { s.classList.add("on"); setTimeout(() => AU.star(i), 200 + i * 250); }
  });
  const last = play.idx === GG_LEVELS.length - 1;
  const endOfCourse = play.idx % 9 === 8;
  el.btnClearNext.innerHTML = last ? "コース選択へ"
    : (endOfCourse ? 'つぎのコースへ <span class="ic ic-next"></span>'
                   : 'つぎへ <span class="ic ic-next"></span>');
  updateHud();
  show(el.overlayClear);
}

/* ================= 入力 ================= */
let pointerId = null;
cv.addEventListener("pointerdown", e => {
  AU.ensure();
  if (mode !== "play" || pointerId !== null) return;
  if (!el.overlayClear.classList.contains("hidden")) return;
  if (play.st.mode !== "rest") return;
  pointerId = e.pointerId;
  cv.setPointerCapture(pointerId);
  const w = toWorld(e.clientX, e.clientY);
  play.aim = { sx: w.x, sy: w.y, cx: w.x, cy: w.y };
  play.idle = 0;
});
cv.addEventListener("pointermove", e => {
  if (e.pointerId !== pointerId || !play.aim) return;
  const w = toWorld(e.clientX, e.clientY);
  play.aim.cx = w.x; play.aim.cy = w.y;
});
cv.addEventListener("pointerup", e => {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  const a = play.aim; play.aim = null;
  if (!a || mode !== "play" || play.st.mode !== "rest") return;
  const dx = a.sx - a.cx, dy = a.sy - a.cy;
  const pull = Math.hypot(dx, dy);
  if (pull < 14) return;                       // キャンセル
  const power = Math.min(pull, C.PULL_MAX);
  GGP.launch(play.st, play.level, dx, dy, power * C.PULL_V);
  play.trail = [];
  AU.launch(power / C.PULL_MAX);
  burst(play.st.x, play.st.y, "#9fd8ff", 8, 140, 0.4, 2.5);
  updateHud();
  hide(el.hint);
});
cv.addEventListener("pointercancel", () => { pointerId = null; play.aim = null; });

addEventListener("keydown", e => {
  if (e.repeat) return;
  if (mode === "play") {
    if (e.key === "r" || e.key === "R") { AU.click(); startLevel(play.idx); }
    if (e.key === "Escape") {
      if (!el.overlayClear.classList.contains("hidden")) return;
      AU.click(); switchScreen("holes");
    }
  }
  if (e.key === "m" || e.key === "M") toggleSound();
  if (e.key === "g" || e.key === "G") toggleGuide();
});

/* ================= UIボタン ================= */
function toggleSound() {
  save.sound = !save.sound; store();
  AU.ensure(); AU.setMuted(!save.sound);
  el.btnSound.classList.toggle("off", !save.sound);
  showToast(save.sound ? "サウンド ON" : "サウンド OFF", "info");
}
function toggleGuide() {
  save.guide = !save.guide; store();
  el.btnGuide.classList.toggle("off", !save.guide);
  showToast(save.guide ? "軌道ガイド ON" : "軌道ガイド OFF", "info");
}
el.btnSound.classList.toggle("off", !save.sound);
el.btnGuide.classList.toggle("off", !save.guide);

el.btnStart.addEventListener("click", () => { AU.ensure(); AU.click(); switchScreen("course"); });
el.btnTitleBack.addEventListener("click", () => { AU.click(); switchScreen("title"); });
el.btnCourseBack.addEventListener("click", () => { AU.click(); switchScreen("course"); });
el.btnBack.addEventListener("click", () => { AU.click(); switchScreen("holes"); });
el.btnRetry.addEventListener("click", () => { AU.click(); startLevel(play.idx); });
el.btnSound.addEventListener("click", toggleSound);
el.btnGuide.addEventListener("click", toggleGuide);
el.btnRecall.addEventListener("click", () => {
  if (mode !== "play" || play.st.mode !== "fly") return;
  AU.ob();
  play.st.mode = "dead"; play.st.deadReason = "ob";
  play.deadTimer = 0.3;
  showToast("ボールを回収しました", "info");
});
el.btnClearRetry.addEventListener("click", () => { AU.click(); startLevel(play.idx); });
el.btnClearList.addEventListener("click", () => { AU.click(); switchScreen("holes"); });
el.btnClearNext.addEventListener("click", () => {
  AU.click();
  if (play.idx === GG_LEVELS.length - 1) { switchScreen("course"); return; }
  startLevel(play.idx + 1);
});

function showToast(text, cls) {
  el.toast.textContent = text;
  el.toast.className = cls || "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(el.toast), 2200);
}

/* ================= 物理イベント処理 ================= */
function handleEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case "bounce":
        AU.bounce(ev.speed);
        if (ev.speed > 180) {
          burst(ev.x, ev.y, "#cfe0ff", Math.min(3 + ev.speed / 120 | 0, 10), ev.speed * 0.35, 0.4, 2);
          play.shake = Math.min(play.shake + ev.speed / 300, 7);
        }
        break;
      case "rest":
        AU.land();
        burst(ev.x, ev.y, "#b8c8ff", 6, 90, 0.45, 2);
        break;
      case "boost":
        AU.boost();
        ringWave(ev.x, ev.y, "#ffd166", 10, 60, 0.4, 4);
        burst(ev.x, ev.y, "#ffd166", 10, 200, 0.4, 2.5);
        break;
      case "warp":
        AU.warp();
        ringWave(ev.fx, ev.fy, "#4fd8ff", 24, 4, 0.3, 3);
        ringWave(ev.tx, ev.ty, "#4fd8ff", 4, 30, 0.35, 3);
        play.trail.push({ brk: true });
        break;
      case "goal": {
        play.goalAnim = 0;
        play.goalFrom = { x: play.st.x, y: play.st.y };
        play.clearTimer = 1.15;
        AU.goal();
        const gp = GGP.goalPos(play.level, play.st.t);
        burst(gp.x, gp.y, "#ffd166", 18, 260, 0.9, 3);
        burst(gp.x, gp.y, "#8ff0ff", 14, 180, 1.1, 2.5);
        ringWave(gp.x, gp.y, "#ffd166", 18, 70, 0.7, 4);
        break;
      }
      case "dead":
        if (ev.reason === "burn") {
          AU.burn();
          burst(play.st.x, play.st.y, "#ff9c40", 26, 320, 0.7, 3.5);
          burst(play.st.x, play.st.y, "#ff5a4a", 16, 200, 0.9, 3);
          play.shake = 10; play.flash = 0.4; play.flashColor = "255,110,60";
          play.deadTimer = 0.85;
        } else if (ev.reason === "hole") {
          AU.fall();
          implode(ev.x, ev.y, "#c9a7ff", 24, 90, 0.55);
          play.shake = 6; play.flash = 0.3; play.flashColor = "150,90,255";
          play.deadTimer = 0.85;
        } else {
          // 場外 / タイムアウト
          if (play.deadTimer < 0) {
            AU.ob();
            showToast(play.st.flight > C.TIMEOUT - 1 ? "時間切れ！ボールを回収しました" : "ロスト！打った場所にもどります");
            play.deadTimer = 0.5;
          }
        }
        break;
    }
  }
}

/* ================= 描画 ================= */
function worldTransform() {
  let sx = ox, sy = oy;
  if (play.shake > 0.05 && mode === "play") {
    sx += (Math.random() * 2 - 1) * play.shake;
    sy += (Math.random() * 2 - 1) * play.shake;
  }
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, sx * dpr, sy * dpr);
}

function drawOrbitPath(o) {
  ctx.strokeStyle = "rgba(150,170,255,0.14)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 10]);
  ctx.beginPath(); ctx.arc(o.cx, o.cy, o.R, 0, 6.29); ctx.stroke();
  ctx.setLineDash([]);
}

function drawBody(b, t) {
  const p = GGP.bodyPos(b, t);
  if (b.t === "s") {
    const sp = sunSprite(b);
    const pulse = 1 + 0.035 * Math.sin(t * 5 + (b.seed || 0));
    ctx.save();
    ctx.translate(p.x, p.y); ctx.scale(pulse, pulse);
    ctx.drawImage(sp.canvas, -sp.half, -sp.half, sp.half * 2, sp.half * 2);
    ctx.restore();
    // ちらつく光冠
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.1 + 0.05 * Math.sin(t * 7.3 + (b.seed || 0) * 2);
    ctx.fillStyle = "#ffcf6e";
    ctx.beginPath(); ctx.arc(p.x, p.y, b.r * 1.45, 0, 6.29); ctx.fill();
    ctx.restore();
  } else if (b.t === "b") {
    // ブラックホール
    ctx.save();
    // レンズ光
    let g = ctx.createRadialGradient(p.x, p.y, b.r * 0.3, p.x, p.y, b.r * 3);
    g.addColorStop(0, "rgba(140,100,255,0.32)");
    g.addColorStop(0.5, "rgba(80,60,180,0.12)");
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, b.r * 3, 0, 6.29); ctx.fill();
    // 降着円盤（回転する弧）
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const rr = b.r * (1.15 + i * 0.38);
      const a0 = t * (1.6 - i * 0.4) + i * 2.2;
      ctx.strokeStyle = ["#b48cff", "#7fc8ff", "#e0b8ff"][i];
      ctx.lineWidth = 3 - i * 0.7;
      ctx.globalAlpha = 0.7 - i * 0.18;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, a0, a0 + 3.6 - i * 0.5); ctx.stroke();
    }
    ctx.restore();
    // 中心核
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(p.x, p.y, b.r * C.BH_CORE + 3, 0, 6.29); ctx.fill();
    ctx.strokeStyle = "rgba(200,170,255,0.9)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, b.r * C.BH_CORE + 3, 0, 6.29); ctx.stroke();
  } else {
    const sp = planetSprite(b);
    if (b.spin) {
      // 自転: スプライト自体を回す（クレーターの動きで回転が見える）
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(b.spin * t);
      ctx.drawImage(sp.canvas, -sp.half, -sp.half, sp.half * 2, sp.half * 2);
      ctx.restore();
      // 回転インジケータ（回る破線リング）
      ctx.save();
      ctx.strokeStyle = "rgba(160,220,255,0.4)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 14]);
      ctx.lineDashOffset = -b.spin * t * (b.r + 9);
      ctx.beginPath(); ctx.arc(p.x, p.y, b.r + 9, 0, 6.29); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else {
      ctx.drawImage(sp.canvas, p.x - sp.half, p.y - sp.half, sp.half * 2, sp.half * 2);
    }
    if (b.t === "r") {
      // 反重力の波紋
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const f = ((t * 0.45 + i / 3) % 1);
        ctx.globalAlpha = (1 - f) * 0.4;
        ctx.strokeStyle = "#c9a7ff"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, b.r * (1.05 + f * 0.85), 0, 6.29); ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function drawGoal(level, t) {
  const gp = GGP.goalPos(level, t);
  const gr = level.goal.r !== undefined ? level.goal.r : 18;
  ctx.save();
  // 吸い込み口
  let g = ctx.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, gr * 1.6);
  g.addColorStop(0, "rgba(6,10,26,0.95)");
  g.addColorStop(0.62, "rgba(20,40,70,0.5)");
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(gp.x, gp.y, gr * 1.6, 0, 6.29); ctx.fill();
  // 回転する点線リング
  const pulse = 1 + 0.07 * Math.sin(t * 3.2);
  ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 7]); ctx.lineDashOffset = -t * 26;
  ctx.beginPath(); ctx.arc(gp.x, gp.y, gr * pulse, 0, 6.29); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.25 + 0.12 * Math.sin(t * 3.2);
  ctx.strokeStyle = "#ffe9b0"; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(gp.x, gp.y, gr * pulse, 0, 6.29); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  // 旗
  const fx = gp.x, fy = gp.y;
  ctx.strokeStyle = "#e8ecff"; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - gr - 26); ctx.stroke();
  const wav = Math.sin(t * 4) * 3;
  ctx.fillStyle = "#ff5d7e";
  ctx.beginPath();
  ctx.moveTo(fx, fy - gr - 26);
  ctx.quadraticCurveTo(fx + 13, fy - gr - 24 + wav, fx + 24, fy - gr - 20 + wav);
  ctx.lineTo(fx, fy - gr - 12);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  if (level.goal.orbit) drawOrbitPath(level.goal.orbit);
}

const WORM_COLORS = ["#4fd8ff", "#ff8ad9", "#a0ff8a"];
function drawWormholes(level, t) {
  const worm = level.worm || [];
  worm.forEach((pair, i) => {
    const col = WORM_COLORS[i % WORM_COLORS.length];
    pair.forEach((w, s) => {
      const dir = s === 0 ? 1 : -1;
      ctx.save();
      ctx.translate(w.x, w.y);
      let g = ctx.createRadialGradient(0, 0, 0, 0, 0, C.WORM_R * 1.8);
      g.addColorStop(0, "rgba(5,8,20,0.95)");
      g.addColorStop(0.5, col + "33");
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, C.WORM_R * 1.8, 0, 6.29); ctx.fill();
      ctx.rotate(t * 2 * dir);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = col;
      for (let k = 0; k < 3; k++) {
        ctx.globalAlpha = 0.75 - k * 0.2;
        ctx.lineWidth = 2.4 - k * 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, C.WORM_R * (0.45 + k * 0.3), k * 2.1, k * 2.1 + 3.8);
        ctx.stroke();
      }
      ctx.restore();
    });
  });
}

function drawRings(level, st, t) {
  const rings = level.rings || [];
  rings.forEach((rg, i) => {
    const used = st && st.ringUsed[i] && st.mode === "fly";
    const pulse = used ? 1 : 1 + 0.06 * Math.sin(t * 4 + i * 2);
    ctx.save();
    ctx.translate(rg.x, rg.y);
    ctx.scale(pulse, pulse);
    if (!used) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(0, 0, C.RING_R, 0, 6.29); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = used ? "#5a6488" : "#ffd166";
    ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.arc(0, 0, C.RING_R, 0, 6.29); ctx.stroke();
    ctx.strokeStyle = used ? "#3a4062" : "#fff0c0";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, C.RING_R - 5, 0, 6.29); ctx.stroke();
    ctx.restore();
  });
}

function drawTrail() {
  if (play.trail.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 1; i < play.trail.length; i++) {
    const a = play.trail[i - 1], b = play.trail[i];
    if (a.brk || b.brk) continue;
    const f = i / play.trail.length;
    ctx.globalAlpha = f * 0.5;
    ctx.strokeStyle = "#8fd0ff";
    ctx.lineWidth = 1 + f * 2.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBall(t) {
  const st = play.st;
  let x = st.x, y = st.y, r = C.BALL_R, alpha = 1;
  if (play.goalAnim >= 0) {
    const gp = GGP.goalPos(play.level, st.t);
    const f = Math.min(play.goalAnim / 0.5, 1);
    const e = 1 - Math.pow(1 - f, 3);
    x = play.goalFrom.x + (gp.x - play.goalFrom.x) * e;
    y = play.goalFrom.y + (gp.y - play.goalFrom.y) * e;
    r = C.BALL_R * (1 - e * 0.9);
    alpha = 1 - f * 0.6;
    if (f >= 1) return;
  } else if (st.mode === "dead") return;
  ctx.save();
  ctx.globalAlpha = alpha;
  // 光彩
  ctx.globalCompositeOperation = "lighter";
  let g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
  g.addColorStop(0, "rgba(160,210,255,0.5)"); g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 3, 0, 6.29); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  // 本体
  g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, "#ffffff"); g.addColorStop(0.7, "#dfe8ff"); g.addColorStop(1, "#9fb2e8");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill();
  ctx.restore();
  // 待機中のナッジ（最初のホールのみ）
  if (st.mode === "rest" && play.idx === 0 && st.strokes === 0 && play.idle > 2.5 && !play.aim) {
    const f = (t * 1.2) % 1;
    ctx.save();
    ctx.globalAlpha = (1 - f) * 0.5;
    ctx.strokeStyle = "#8ff0ff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 14 + f * 26, 0, 6.29); ctx.stroke();
    ctx.restore();
  }
}

function drawAim() {
  const a = play.aim;
  if (!a || play.st.mode !== "rest") return;
  const st = play.st;
  const dx = a.sx - a.cx, dy = a.sy - a.cy;
  const pull = Math.hypot(dx, dy);
  if (pull < 4) return;
  const power = Math.min(pull, C.PULL_MAX);
  const frac = power / C.PULL_MAX;
  const ux = dx / pull, uy = dy / pull;
  const valid = pull >= 14;
  const col = frac < 0.5 ? "#6ee7ff" : (frac < 0.85 ? "#ffd166" : "#ff8a5c");

  // 軌道予測
  if (valid && save.guide) {
    const pre = GGP.predict(st, play.level, ux, uy, power * C.PULL_V, 300, 7);
    ctx.save();
    for (let i = 0; i < pre.pts.length; i++) {
      const f = 1 - i / pre.pts.length;
      ctx.globalAlpha = 0.16 + f * 0.55;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(pre.pts[i].x, pre.pts[i].y, 1.6 + f * 2.2, 0, 6.29);
      ctx.fill();
    }
    ctx.globalAlpha = 0.9;
    if (pre.end === "goal") {
      ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(pre.ex, pre.ey, 10, 0, 6.29); ctx.stroke();
    } else if (pre.end === "dead") {
      ctx.strokeStyle = "#ff6b6b"; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pre.ex - 7, pre.ey - 7); ctx.lineTo(pre.ex + 7, pre.ey + 7);
      ctx.moveTo(pre.ex + 7, pre.ey - 7); ctx.lineTo(pre.ex - 7, pre.ey + 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = valid ? 1 : 0.35;
  // 発射方向の矢印
  const len = 30 + frac * 60;
  const hx = st.x + ux * len, hy = st.y + uy * len;
  ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(st.x + ux * 14, st.y + uy * 14); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx + ux * 10, hy + uy * 10);
  ctx.lineTo(hx - uy * 6, hy + ux * 6);
  ctx.lineTo(hx + uy * 6, hy - ux * 6);
  ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
  // ドラッグ起点マーカー（照準風。天体と混同しない淡いUI色・細線）
  ctx.globalAlpha = valid ? 0.9 : 0.5;
  ctx.strokeStyle = "#cfd6f2"; ctx.lineWidth = 1.6;
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(a.sx, a.sy, 13, 0, 6.29); ctx.stroke();
  ctx.setLineDash([]);
  for (let k = 0; k < 4; k++) {              // 十字の目盛り
    const ca = k * Math.PI / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(a.sx + Math.cos(ca) * 16, a.sy + Math.sin(ca) * 16);
    ctx.lineTo(a.sx + Math.cos(ca) * 22, a.sy + Math.sin(ca) * 22);
    ctx.stroke();
  }
  ctx.fillStyle = "#cfd6f2";
  ctx.beginPath(); ctx.arc(a.sx, a.sy, 2.5, 0, 6.29); ctx.fill();
  // 起点から現在の指位置への「糸」（引っぱり具合の実寸表示）
  ctx.globalAlpha = valid ? 0.55 : 0.25;
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "#8b94c2"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(a.cx, a.cy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = col;                       // 指側の端点はパワー色
  ctx.beginPath(); ctx.arc(a.cx, a.cy, 4, 0, 6.29); ctx.fill();
  // 最大パワーの限界円（起点基準）
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = "#8b94c2"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(a.sx, a.sy, C.PULL_MAX, 0, 6.29); ctx.stroke();
  // パワーゲージ
  ctx.globalAlpha = valid ? 0.9 : 0.3;
  ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(st.x, st.y, 22, -2.1, -2.1 + 4.2 * frac); ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "#8b94c2";
  ctx.beginPath(); ctx.arc(st.x, st.y, 22, -2.1, 2.1); ctx.stroke();
  ctx.restore();
}

function drawBoundsFrame() {
  ctx.strokeStyle = "rgba(110, 140, 220, 0.14)";
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 12]);
  ctx.strokeRect(-6, -6, C.W + 12, C.H + 12);
  ctx.setLineDash([]);
}

function drawOffscreenArrow() {
  const st = play.st;
  if (st.mode !== "fly") return;
  if (st.x >= 0 && st.x <= C.W && st.y >= 0 && st.y <= C.H) return;
  const x = Math.max(24, Math.min(C.W - 24, st.x));
  const y = Math.max(24, Math.min(C.H - 24, st.y));
  const ang = Math.atan2(st.y - y, st.x - x);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#8fd0ff";
  ctx.beginPath();
  ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* タイトル用デコレーション天体 */
const decor = [
  { t: "p", x: 0, y: 0, r: 60, seed: 3, dx: 0.22, dy: 0.3, ph: 0 },
  { t: "p", x: 0, y: 0, r: 34, seed: 7, dx: 0.75, dy: 0.62, ph: 2 },
  { t: "r", x: 0, y: 0, r: 26, seed: 5, dx: 0.86, dy: 0.22, ph: 4 }
];
function drawDecor(t) {
  for (const d of decor) {
    d.x = C.W * d.dx + Math.sin(t * 0.11 + d.ph) * 30;
    d.y = C.H * d.dy + Math.cos(t * 0.09 + d.ph) * 22;
    drawBody(d, t);
  }
  // 周回する月
  const mx = C.W * 0.22 + Math.sin(t * 0.11) * 30 + Math.cos(t * 0.35) * 130;
  const my = C.H * 0.3 + Math.cos(t * 0.09) * 22 + Math.sin(t * 0.35) * 130;
  drawBody({ t: "p", x: mx, y: my, r: 14, seed: 9 }, t);
}

/* ================= メインループ ================= */
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1;                      // タブ復帰対策
  globalTime += dt;

  const tint = GG_COURSES[curCourse] ? GG_COURSES[curCourse].tint : "#3a5fa8";
  drawBackground(globalTime, mode === "play" ? tint : "#31418a");

  if (mode !== "play") {
    worldTransform();
    drawDecor(globalTime);
    updateParticles(dt);
    drawParticles();
    return;
  }

  /* ---- 物理 ---- */
  const st = play.st, lv = play.level;
  play.idle += dt;
  const events = [];
  play.acc += dt;
  const maxSteps = 20;                          // 落ちても発散しない程度
  let steps = 0;
  while (play.acc >= C.DT && steps < maxSteps * C.SUBSTEPS) {
    if (st.mode === "fly" || st.mode === "rest") GGP.step(st, lv, events);
    else st.t += C.DT;                          // ゴール/ミス中も時間は流れる
    play.acc -= C.DT; steps++;
  }
  handleEvents(events);

  // 軌跡
  if (st.mode === "fly") {
    play.trail.push({ x: st.x, y: st.y });
    if (play.trail.length > 80) play.trail.shift();
  }

  // ミス→リスポーン
  if (play.deadTimer >= 0) {
    play.deadTimer -= dt;
    if (play.deadTimer < 0) {
      GGP.respawn(st, lv);
      play.trail = [];
      burst(st.x, st.y, "#8fd0ff", 8, 90, 0.4, 2);
    }
  }
  // クリア
  if (play.goalAnim >= 0) play.goalAnim += dt;
  if (play.clearTimer >= 0 && !play.cleared) {
    play.clearTimer -= dt;
    if (play.clearTimer < 0) { play.cleared = true; onClear(); }
  }

  play.shake *= Math.pow(0.02, dt);
  play.flash = Math.max(play.flash - dt * 1.2, 0);

  // 回収ボタンの表示
  el.btnRecall.classList.toggle("hidden", st.mode !== "fly" || st.flight < 2);

  /* ---- 描画 ---- */
  worldTransform();
  drawBoundsFrame();
  for (const b of lv.bodies) if (b.orbit) drawOrbitPath(b.orbit);
  drawGoal(lv, st.t);
  drawWormholes(lv, st.t);
  drawRings(lv, st, st.t);
  for (const b of lv.bodies) drawBody(b, st.t);
  drawTrail();
  drawBall(globalTime);
  drawAim();
  drawOffscreenArrow();
  updateParticles(dt);
  drawParticles();

  // 被弾フラッシュ
  if (play.flash > 0) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgba(${play.flashColor},${play.flash * 0.5})`;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  }
}

/* ================= 起動 ================= */
switchScreen("title");
requestAnimationFrame(frame);

})();
