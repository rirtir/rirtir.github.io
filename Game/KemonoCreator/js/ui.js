// UI（スキーマから自動生成）・保存・カメラ
import * as THREE from 'three';
import { CATEGORIES, ITEMS, DEFAULT_STATE, PRESETS } from './schema.js';

const PALETTE = [
  '#f6f2ea', '#e9e2d6', '#d9c3a3', '#c98a52', '#e07a2e', '#d38a43', '#b5652e', '#8b5a34',
  '#6b4a34', '#4a3426', '#2c2a32', '#1f1a1c', '#7d7f86', '#5a6070', '#9a9590', '#b39a74',
  '#e58a2a', '#d4a25c', '#c8423b', '#3d5a80', '#2d6a3a', '#7a3b8a', '#f3c6c4', '#9fd8e8',
];
const STORE = 'kemono-creator-v1';
const QUICK = {
  eyes: { label: '目の形タイプ', items: [
    ['ふつう', { eyeAspect: 0.78, eyeTilt: 0.14, eyeUpper: 0.7, eyeLower: 0.45, irisSize: 0.4, eyeSize: 0.021 }],
    ['つり目', { eyeAspect: 0.6, eyeTilt: 0.42, eyeUpper: 0.55, eyeLower: 0.35, irisSize: 0.38, eyeSize: 0.022 }],
    ['たれ目', { eyeAspect: 0.75, eyeTilt: -0.3, eyeUpper: 0.9, eyeLower: 0.4, irisSize: 0.43, eyeSize: 0.021 }],
    ['まんまる', { eyeAspect: 1.05, eyeTilt: 0.0, eyeUpper: 1.2, eyeLower: 0.85, irisSize: 0.52, eyeSize: 0.02 }],
    ['細目', { eyeAspect: 0.4, eyeTilt: 0.15, eyeUpper: 0.5, eyeLower: 0.25, irisSize: 0.33, eyeSize: 0.023 }],
    ['鋭い', { eyeAspect: 0.5, eyeTilt: 0.5, eyeUpper: 0.35, eyeLower: 0.55, irisSize: 0.31, pupilType: 1, eyeSize: 0.023 }],
    ['縦長の瞳', { eyeAspect: 0.7, eyeTilt: 0.2, irisSize: 0.4, irisTall: 0.8, eyeSize: 0.021 }],
    ['黒目がち', { eyeAspect: 0.85, eyeTilt: 0.08, irisSize: 0.62, pupilSize: 0.5, eyeSize: 0.019 }],
  ] },
  muzzle: { label: 'マズルのタイプ', items: [
    ['犬', { muzLen: 0.05, muzW: 0, muzH: 0, muzTaper: 0.1, muzDrop: 0, stop: -0.1, padSize: 0, jawLen: 0, bridge: 0 }],
    ['狼', { muzLen: 0.2, muzW: -0.1, muzH: -0.05, muzTaper: 0.25, muzDrop: 0, stop: -0.17, padSize: -0.2, jawLen: 0.1, bridge: 0.2 }],
    ['狐', { muzLen: 0.25, muzW: -0.4, muzH: -0.35, muzTaper: 0.7, muzDrop: 0.1, stop: -0.35, padSize: -0.4, jawLen: 0, bridge: -0.2 }],
    ['猫', { muzLen: -0.85, muzW: 0.1, muzH: -0.25, muzTaper: -0.2, muzDrop: 0, stop: 0.05, padSize: 0.7, jawLen: -0.4, bridge: -0.3 }],
    ['獅子・虎', { muzLen: -0.4, muzW: 0.45, muzH: 0.25, muzTaper: -0.1, muzDrop: 0.1, stop: 0.0, padSize: 0.8, jawLen: 0, bridge: 0.3 }],
    ['熊', { muzLen: -0.2, muzW: 0.5, muzH: 0.35, muzTaper: -0.4, muzDrop: 0.15, stop: 0.2, padSize: 0.2, jawLen: 0.1, bridge: 0 }],
    ['ドーベル', { muzLen: 0.35, muzW: -0.3, muzH: -0.1, muzTaper: 0.35, muzDrop: -0.1, stop: 0.0, padSize: -0.3, jawLen: 0.2, bridge: 0.4 }],
  ] },
};
const BODY_KEYS = ['muscle', 'fat', 'belly', 'flank', 'bulk', 'traps', 'shoulderW', 'chest', 'pecs', 'waist', 'torsoLen', 'neckThick', 'neckLen', 'armLen', 'armThick', 'handSize', 'hipW', 'glutes', 'legLen', 'legThick', 'calf', 'footSize', 'height'];
const BODY_TYPES = [
  ['細身', { _w: 0.55, muscle: 0.1, fat: -0.7, shoulderW: -0.3, chest: -0.4, waist: -0.4, armThick: -0.5, legThick: -0.5, neckThick: -0.4, bulk: -0.6, legLen: 0.3, height: 0.98 }],
  ['標準', { _w: 0.75, muscle: 0.35 }],
  ['筋肉質', { _w: 0.9, muscle: 0.75, shoulderW: 0.4, chest: 0.4, pecs: 0.3, armThick: 0.3, neckThick: 0.3, waist: -0.3, calf: 0.3, height: 1.02 }],
  ['ガチムチ', { _w: 1.1, muscle: 1, bulk: 0.8, shoulderW: 0.7, chest: 0.9, pecs: 0.8, traps: 1, armThick: 0.6, legThick: 0.5, neckThick: 1, neckLen: -0.4, waist: 0.2, calf: 0.5, handSize: 0.4, height: 1.05 }],
  ['ぽっちゃり', { _w: 1.05, muscle: 0.15, fat: 0.55, belly: 0.5, flank: 0.6, waist: 0.4, hipW: 0.3, glutes: 0.3, neckLen: -0.3 }],
  ['肥満', { _w: 1.3, muscle: 0.1, fat: 1, belly: 1, flank: 1, waist: 0.8, hipW: 0.6, glutes: 0.5, neckLen: -0.7, bulk: 0.4 }],
  ['巨漢', { _w: 1.25, muscle: 0.8, fat: 0.55, belly: 0.4, bulk: 1, shoulderW: 1, chest: 1, traps: 0.8, armThick: 0.8, legThick: 0.8, neckThick: 1, neckLen: -0.6, handSize: 0.6, footSize: 0.5, height: 1.12 }],
];
const CAM_FOR = { preset: 'full', body: 'full', head: 'face', muzzle: 'face', eyes: 'eyes', mouth: 'face', ears: 'face', hair: 'face', fur: 'upper', tail: 'back', color: 'full', outfit: 'full', pose: 'full', view: 'full' };

export function buildUI({ chara, stage, camera, controls, renderer }) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const rail = $('#rail'), panel = $('#panel-body'), title = $('#panel-title');
  const ui = { state: structuredClone(DEFAULT_STATE) };
  let cur = 'preset';
  const undo = [], redo = [];
  let pendingUndo = null;
  const controlsById = {};

  function commit(push = true) {
    ui.state = { ...ui.state };
    if (push) {
      if (!pendingUndo) pendingUndo = JSON.stringify(ui.state);
    }
    chara.apply(ui.state);
    stage.setTheme(ui.state.theme === 1 ? 'night' : 'light');
    document.body.classList.toggle('night', ui.state.theme === 1);
    chara.apply(ui.state);
    stage.lightRig.azimuth = ui.state.lightAz;
    stage.lightRig.elevation = ui.state.lightEl;
    save();
  }
  function endEdit() {
    if (pendingUndo) {
      if (pendingUndo !== JSON.stringify(ui.state)) { undo.push(pendingUndo); if (undo.length > 80) undo.shift(); redo.length = 0; }
      pendingUndo = null;
    }
  }
  window.addEventListener('pointerup', endEdit);
  window.addEventListener('keyup', endEdit);
  let saveT = 0;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(ui.state)); } catch (e) { /* 保存できない環境 */ } }, 300);
  }
  function setState(s, pushUndo = true) {
    if (pushUndo) { undo.push(JSON.stringify(ui.state)); redo.length = 0; }
    ui.state = { ...structuredClone(DEFAULT_STATE), ...s };
    refresh();
    commit(false);
  }

  // ---------------------------------------------------------------- カテゴリ
  for (const c of CATEGORIES) {
    const b = el('button', 'rail-btn');
    b.dataset.cat = c.id;
    b.innerHTML = `<span class="rail-ic">${c.icon}</span><span class="rail-lb">${c.label}</span>`;
    b.onclick = () => select(c.id);
    rail.appendChild(b);
  }
  function select(id) {
    cur = id;
    rail.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('on', b.dataset.cat === id));
    render();
    setCam(CAM_FOR[id] || 'full');
  }

  // ---------------------------------------------------------------- コントロール
  function render() {
    const c = CATEGORIES.find(x => x.id === cur);
    title.textContent = c.label;
    $('#panel-count').textContent = `${CATEGORIES.indexOf(c) + 1}/${CATEGORIES.length}`;
    panel.innerHTML = '';
    for (const k of Object.keys(controlsById)) delete controlsById[k];
    if (cur === 'preset') return renderPresets();
    if (QUICK[cur]) {
      const q = QUICK[cur];
      const sec = el('section', 'grp');
      sec.appendChild(el('h3', null, q.label));
      const row = el('div', 'chips');
      for (const [name, vals] of q.items) {
        const b = el('button', 'chip', name);
        b.onclick = () => setState({ ...structuredClone(ui.state), ...vals });
        row.appendChild(b);
      }
      sec.appendChild(row);
      panel.appendChild(sec);
    }
    if (cur === 'body') {
      const sec = el('section', 'grp');
      sec.appendChild(el('h3', null, '体型タイプ'));
      const row = el('div', 'body-types');
      for (const [name, vals] of BODY_TYPES) {
        const b = el('button', 'btype');
        b.innerHTML = `<span class="bt-ic" style="--w:${vals._w}"></span><span>${name}</span>`;
        b.onclick = () => {
          const s = structuredClone(ui.state);
          for (const k of BODY_KEYS) s[k] = DEFAULT_STATE[k];
          for (const [k, v] of Object.entries(vals)) if (k[0] !== '_') s[k] = v;
          setState(s);
        };
        row.appendChild(b);
      }
      sec.appendChild(row);
      panel.appendChild(sec);
    }
    for (const g of c.groups) {
      const sec = el('section', 'grp');
      sec.appendChild(el('h3', null, g.label));
      for (const it of g.items) sec.appendChild(control(it));
      panel.appendChild(sec);
    }
  }

  function renderPresets() {
    const sec = el('section', 'grp');
    sec.appendChild(el('h3', null, '種族プリセット'));
    const grid = el('div', 'preset-grid');
    PRESETS.forEach((p) => {
      const b = el('button', 'preset');
      b.innerHTML = `<span class="pz" style="background:linear-gradient(135deg, ${p.swatch[0]} 0 55%, ${p.swatch[1]} 55% 100%)"></span><span class="pn">${p.name}</span>`;
      b.onclick = () => setState({ ...p.s, theme: ui.state.theme, faceViews: ui.state.faceViews, outlineW: ui.state.outlineW, anime: ui.state.anime });
      grid.appendChild(b);
    });
    sec.appendChild(grid);
    panel.appendChild(sec);
    const sec2 = el('section', 'grp');
    sec2.appendChild(el('h3', null, 'ランダム'));
    const row = el('div', 'btn-row');
    const r1 = el('button', 'wide', 'すべてランダム'); r1.onclick = () => randomize(false);
    const r2 = el('button', 'wide', '色だけランダム'); r2.onclick = () => randomize(true);
    row.append(r1, r2);
    sec2.appendChild(row);
    sec2.appendChild(el('p', 'hint', '左のカテゴリから、体型・顔・マズル・目・耳・毛並み・尻尾・毛色などを細かく調整できます。スライダーの名前をダブルクリックすると初期値に戻ります。'));
    panel.appendChild(sec2);
  }

  function control(it) {
    const row = el('div', 'ctl ctl-' + it.type);
    const lab = el('label', 'ctl-lb', it.label);
    lab.title = 'ダブルクリックで初期値に戻す';
    lab.ondblclick = () => { begin(); ui.state[it.id] = structuredClone(it.def); refreshOne(it.id); commit(); endEdit(); };
    row.appendChild(lab);
    const begin = () => { if (!pendingUndo) pendingUndo = JSON.stringify(ui.state); };
    if (it.type === 'range') {
      const wrap = el('div', 'rng');
      const inp = el('input');
      inp.type = 'range'; inp.min = it.min; inp.max = it.max; inp.step = it.step;
      inp.value = ui.state[it.id];
      const val = el('span', 'val');
      const fmt = (v) => {
        const t = (v - it.min) / (it.max - it.min);
        return Math.round(t * 100);
      };
      const paint = () => {
        const t = (inp.value - it.min) / (it.max - it.min) * 100;
        inp.style.setProperty('--p', t + '%');
        val.textContent = fmt(+inp.value);
      };
      inp.oninput = () => { begin(); ui.state[it.id] = +inp.value; paint(); commit(); };
      paint();
      wrap.append(inp, val);
      row.appendChild(wrap);
      controlsById[it.id] = () => { inp.value = ui.state[it.id]; paint(); };
    } else if (it.type === 'select') {
      const chips = el('div', 'chips');
      it.options.forEach((o, i) => {
        const b = el('button', 'chip', o);
        b.onclick = () => { begin(); ui.state[it.id] = i; paintC(); commit(); endEdit(); };
        chips.appendChild(b);
      });
      const paintC = () => [...chips.children].forEach((b, i) => b.classList.toggle('on', ui.state[it.id] === i));
      paintC();
      row.appendChild(chips);
      controlsById[it.id] = paintC;
    } else if (it.type === 'toggle') {
      const b = el('button', 'tog');
      const paintT = () => { b.classList.toggle('on', !!ui.state[it.id]); b.textContent = ui.state[it.id] ? 'ON' : 'OFF'; };
      b.onclick = () => { begin(); ui.state[it.id] = !ui.state[it.id]; paintT(); commit(); endEdit(); };
      paintT();
      row.appendChild(b);
      controlsById[it.id] = paintT;
    } else if (it.type === 'color') {
      const box = el('div', 'colbox');
      const sw = el('div', 'swatches');
      PALETTE.forEach(h => {
        const s = el('button', 'sw');
        s.style.background = h; s.title = h;
        s.onclick = () => { begin(); ui.state[it.id] = h; paintCol(); commit(); endEdit(); };
        sw.appendChild(s);
      });
      const pick = el('input'); pick.type = 'color';
      const hex = el('input', 'hex'); hex.type = 'text'; hex.maxLength = 7; hex.spellcheck = false;
      pick.oninput = () => { begin(); ui.state[it.id] = pick.value; paintCol(); commit(); };
      hex.onchange = () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { begin(); ui.state[it.id] = hex.value.toLowerCase(); paintCol(); commit(); endEdit(); } };
      const paintCol = () => {
        pick.value = ui.state[it.id]; hex.value = ui.state[it.id];
        [...sw.children].forEach(s => s.classList.toggle('on', s.title.toLowerCase() === ui.state[it.id].toLowerCase()));
      };
      paintCol();
      const line = el('div', 'colline');
      line.append(pick, hex);
      box.append(line, sw);
      row.appendChild(box);
      controlsById[it.id] = paintCol;
    }
    return row;
  }
  const lookBtn = $('#btn-look');
  const paintLook = () => lookBtn.classList.toggle('on', !!ui.state.lookCam);
  lookBtn.onclick = () => { if (!pendingUndo) pendingUndo = JSON.stringify(ui.state); ui.state.lookCam = !ui.state.lookCam; paintLook(); refreshOne('lookCam'); commit(); endEdit(); };
  function refreshOne(id) { controlsById[id] && controlsById[id](); if (id === 'lookCam') paintLook(); }
  function refresh() { for (const id of Object.keys(controlsById)) refreshOne(id); paintLook(); }

  // ---------------------------------------------------------------- ランダム
  function randomize(colorOnly) {
    const base = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    const s = colorOnly ? structuredClone(ui.state) : { ...structuredClone(DEFAULT_STATE), ...structuredClone(base.s) };
    const hueShift = (h, amt) => { const c = new THREE.Color(h); const hsl = {}; c.getHSL(hsl); c.setHSL((hsl.h + (Math.random() - 0.5) * amt + 1) % 1, Math.min(1, Math.max(0, hsl.s + (Math.random() - 0.5) * 0.3)), Math.min(0.95, Math.max(0.06, hsl.l + (Math.random() - 0.5) * 0.25))); return '#' + c.getHexString(); };
    if (!colorOnly) {
      for (const it of Object.values(ITEMS)) {
        if (it.type !== 'range') continue;
        if (['outlineW', 'anime', 'shadeHue', 'shadeDark', 'rim', 'faceSoft', 'lightAz', 'lightEl', 'height', 'mouthOpen', 'mouthW', 'lidW'].includes(it.id)) continue;
        const span = it.max - it.min;
        s[it.id] = Math.min(it.max, Math.max(it.min, s[it.id] + (Math.random() - 0.5) * span * 0.35));
      }
      s.height = 0.92 + Math.random() * 0.16;
    }
    for (const id of ['furMain', 'furSub', 'furAccent', 'patternColor', 'hairColor', 'tailTipColor', 'earTipColor']) s[id] = hueShift(s[id], colorOnly ? 0.5 : 0.12);
    const iris = Math.random();
    const ic = new THREE.Color().setHSL(iris, 0.7, 0.55), it2 = new THREE.Color().setHSL(iris, 0.6, 0.22);
    s.irisBot = '#' + ic.getHexString(); s.irisTop = '#' + it2.getHexString();
    if (!colorOnly) {
      s.top = [0, 0, 1, 2, 3, 4, 4][Math.floor(Math.random() * 7)];
      s.bottom = Math.floor(Math.random() * 3);
      s.pantStripe = Math.random() < 0.35;
      s.scarf = Math.random() < 0.25;
      s.bracelet = Math.random() < 0.25;
    }
    const cloth = ['#3d5a80', '#2e3440', '#7a2e2e', '#2f5d50', '#5a4a7a', '#c8c2b6', '#1f1f24', '#8a6a3a', '#3a6ea5', '#a8452f'];
    const pick = () => cloth[Math.floor(Math.random() * cloth.length)];
    s.topColor = pick(); s.bottomColor = pick(); s.scarfColor = pick();
    s.trimColor = ['#d9b45a', '#f2efe6', '#c8423b', '#1f1f24', '#7fb8d8'][Math.floor(Math.random() * 5)];
    for (const k of ['theme', 'faceViews', 'outlineW', 'anime', 'shadeHue', 'shadeDark', 'rim', 'faceSoft', 'lightAz', 'lightEl']) s[k] = ui.state[k];
    setState(s);
  }

  // ---------------------------------------------------------------- 上のボタン
  $('#btn-undo').onclick = () => { if (!undo.length) return; redo.push(JSON.stringify(ui.state)); setState(JSON.parse(undo.pop()), false); };
  $('#btn-redo').onclick = () => { if (!redo.length) return; undo.push(JSON.stringify(ui.state)); setState(JSON.parse(redo.pop()), false); };
  $('#btn-random').onclick = () => randomize(false);
  $('#btn-reset').onclick = () => { if (confirm('すべての項目を初期値に戻しますか？')) setState(structuredClone(DEFAULT_STATE)); };
  $('#btn-shot').onclick = () => {
    const a = document.createElement('a');
    a.download = `kemono-${Date.now()}.png`;
    a.href = renderer.domElement.toDataURL('image/png');
    a.click();
  };
  const dlg = $('#code-dlg'), ta = $('#code-text');
  $('#btn-code').onclick = () => {
    const diff = {};
    for (const [k, v] of Object.entries(ui.state)) if (JSON.stringify(v) !== JSON.stringify(DEFAULT_STATE[k])) diff[k] = typeof v === 'number' ? Math.round(v * 10000) / 10000 : v;
    ta.value = 'KC1:' + btoa(unescape(encodeURIComponent(JSON.stringify(diff))));
    $('#code-msg').textContent = 'このコードをコピーして保存・共有できます。別のコードを貼り付けて「読み込む」も可能です。';
    dlg.showModal();
    ta.select();
  };
  $('#code-copy').onclick = async () => { try { await navigator.clipboard.writeText(ta.value); $('#code-msg').textContent = 'コピーしました。'; } catch (e) { ta.select(); document.execCommand('copy'); } };
  $('#code-url').onclick = async () => {
    const url = location.origin + location.pathname + '?c=' + encodeURIComponent(ta.value.trim());
    try { await navigator.clipboard.writeText(url); $('#code-msg').textContent = '共有用のURLをコピーしました。'; } catch (e) { ta.value = url; ta.select(); }
  };
  $('#code-load').onclick = () => {
    try {
      const t = ta.value.trim().replace(/^KC1:/, '');
      const d = JSON.parse(decodeURIComponent(escape(atob(t))));
      setState({ ...structuredClone(DEFAULT_STATE), ...d });
      dlg.close();
    } catch (e) { $('#code-msg').textContent = 'コードを読み込めませんでした。'; }
  };
  $('#code-close').onclick = () => dlg.close();
  $('#btn-panel').onclick = () => document.body.classList.toggle('panel-hidden');

  // ---------------------------------------------------------------- カメラ
  const camGoal = { target: new THREE.Vector3(0, 1, 0), dist: 4.6, active: false, t: 0 };
  function camTarget(kind) {
    const s = chara.scale || 1;
    const hc = chara.headCenterWorld();
    const t = new THREE.Vector3();
    if (kind === 'full') t.set(0, 0.95 * s, 0);
    else if (kind === 'upper') t.set(0, 1.38 * s, 0);
    else if (kind === 'face') t.copy(hc).add(new THREE.Vector3(0, -0.02, 0.03));
    else if (kind === 'eyes') t.copy(hc).add(new THREE.Vector3(0, 0.0, 0.05));
    else t.set(0, 1.0 * s, 0);
    return t;
  }
  function setCam(kind) {
    const s = chara.scale || 1;
    camGoal.kind = kind;
    camGoal.dist = { full: 4.9, upper: 2.3, face: 1.05, eyes: 0.72, back: 3.0 }[kind] * s * Math.max(1, (kind === 'full' || kind === 'back' ? 0.62 : 0.95) / Math.min(camera.aspect, 1.0));
    camGoal.yaw = kind === 'eyes' ? 0.0 : (kind === 'back' ? 2.4 : null);
    camGoal.active = true; camGoal.t = 0;
    document.querySelectorAll('.cam-btn').forEach(b => b.classList.toggle('on', b.dataset.cam === kind));
  }
  document.querySelectorAll('.cam-btn').forEach(b => b.onclick = () => setCam(b.dataset.cam));
  controls.addEventListener('start', () => { camGoal.active = false; });
  ui.updateCamera = (dt) => {
    if (!camGoal.active) return;
    camGoal.t += dt;
    const k = 1 - Math.exp(-dt * 6);
    camGoal.target.copy(camTarget(camGoal.kind));
    controls.target.lerp(camGoal.target, k);
    const off = camera.position.clone().sub(controls.target);
    let len = off.length();
    len += (camGoal.dist - len) * k;
    if (camGoal.yaw !== null && camGoal.yaw !== undefined) {
      const ry = chara.root.rotation.y;
      let cy = Math.atan2(off.x, off.z), gy = camGoal.yaw + ry;
      let d = ((gy - cy + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      cy += d * k;
      const h = Math.hypot(off.x, off.z);
      off.x = Math.sin(cy) * h; off.z = Math.cos(cy) * h;
    }
    // 仰角は水平寄りに
    const el = Math.atan2(off.y, Math.hypot(off.x, off.z));
    const goalEl = 0.05;
    const nel = el + (goalEl - el) * k;
    const hz = Math.cos(nel), hy = Math.sin(nel);
    const dir = new THREE.Vector3(off.x, 0, off.z).normalize();
    camera.position.copy(controls.target).add(new THREE.Vector3(dir.x * hz * len, hy * len, dir.z * hz * len));
    if (camGoal.t > 2.5) camGoal.active = false;
  };
  ui.faceViewLeft = () => {
    const r = rail.getBoundingClientRect();
    return Math.round(window.innerWidth < 760 ? 10 : r.right + 14);
  };
  ui.setCam = setCam;
  ui.select = select;

  ui.load = () => {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { s = null; }
    const q = new URLSearchParams(location.search).get('c');
    if (q) { try { s = JSON.parse(decodeURIComponent(escape(atob(q.replace(/^KC1:/, ''))))); } catch (e) { /* 無視 */ } }
    ui.state = { ...structuredClone(DEFAULT_STATE), ...(s || PRESETS[0].s) };
    if (!s && window.innerWidth < 760) ui.state.faceViews = false;
    commit(false);
    paintLook();
    select('preset');
  };
  // キーボード
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'h' || e.key === 'H') { document.body.classList.toggle('ui-hidden'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('#btn-redo') : $('#btn-undo')).click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); $('#btn-redo').click(); }
  });
  return ui;
}
