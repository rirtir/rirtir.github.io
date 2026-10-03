// PRISM — ゲーム本体（状態・入力・演出）
import * as O from './optics.js';
import { FX } from './fx.js';
import { nmRGB } from './optics.js';

const D2R = Math.PI / 180;
const SYM = { well: 1e-6, mirror: 180, splitter: 180, filter: 180, slab: 180, prism: 120, ball: 360 / 1e6, laser: 360, target: 1e6, wall: 180 };

function angDiff(a, b, symDeg) {
  const s = symDeg * D2R;
  if (s < 1e-3) return 0;
  let d = ((a - b) % s + s) % s;
  return Math.min(d, s - d);
}
export function extent(el) {
  switch (el.type) {
    case 'mirror': case 'splitter': case 'filter': return el.len / 2;
    case 'slab': case 'wall': return Math.hypot(el.w, el.h) / 2;
    default: return el.r;
  }
}

export class Game {
  constructor(renderer, overlay, audio) {
    this.R = renderer;
    this.ov = overlay;
    this.octx = overlay.getContext('2d');
    this.audio = audio;
    this.fx = new FX();
    this.els = [];
    this.def = null; this.meta = {};
    this.sel = null; this.hover = null;
    this.tr = null; this.dirty = true;
    this.charge = new Map();
    this.hist = []; this.future = [];
    this.time = 0; this.playTime = 0;
    this.moves = 0; this.hints = 0;
    this.won = false; this.winTimer = 0; this.winT = 0;
    this.editor = false; this.sandbox = false;
    this.ghost = null;
    this.drag = null;
    this.pointers = new Map();
    this.shake = new Map();
    this.snap = true;
    this.paused = false;
    this.intro = 0;
    this.onWin = () => {}; this.onChange = () => {}; this.onSelect = () => {}; this.onToast = () => {};
    this.demo = false; this.t0 = 0;
    this._attach();
  }

  // ===== レベル =====
  startLevel(def, meta = {}) {
    clearTimeout(this._winTO);
    this.def = def; this.meta = meta;
    this.els = O.loadLevel(def);
    this.hist = []; this.future = [];
    this.sel = null; this.hover = null; this.drag = null; this.ghost = null;
    this.moves = 0; this.hints = 0; this.playTime = 0;
    this.won = false; this.winTimer = 0; this.winT = 0;
    this.charge.clear();
    this.dirty = true; this.demo = false;
    this.R.flash = 0; this.R.shock = [0.5, 0.5, 0, 0];
    this.intro = 0; this.t0 = this.time;
    this.fx.n = 0;
    this.onSelect(null);
  }
  setElements(els) { this.els = els; this.dirty = true; this.charge.clear(); this.sel = null; this.onSelect(null); }
  reset() {
    if (!this.def) return;
    this.startLevel(this.def, this.meta);
    this.audio.ui();
  }
  byId(id) { return this.els.find(e => e.id === id); }
  canMove(e) { return this.editor || e.mv; }
  canRot(e) { return this.editor ? !(e.type === 'well' || e.type === 'ball' || e.type === 'target') : e.rt; }

  // ===== 入力 =====
  _attach() {
    const c = this.ov;
    c.addEventListener('pointerdown', e => this._down(e));
    c.addEventListener('pointermove', e => this._move(e));
    c.addEventListener('pointerup', e => this._up(e));
    c.addEventListener('pointercancel', e => this._up(e));
    c.addEventListener('wheel', e => this._wheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this._key(e));
  }
  _world(e) {
    const r = this.ov.getBoundingClientRect();
    return this.R.toWorld(e.clientX - r.left, e.clientY - r.top);
  }
  pick(x, y) {
    const pad = Math.max(0.28, 20 / this.R.cssScale);
    let best = null, bd = 1e9;
    for (const e of this.els) {
      const d = O.distToElement(e, x, y);
      if (d > pad) continue;
      const score = d - (this.canMove(e) ? 0.08 : this.canRot(e) ? 0.04 : 0) - (e === this.byId(this.sel) ? 0.05 : 0);
      if (score < bd) { bd = score; best = e; }
    }
    return best;
  }
  handlePos(e) {
    const R = extent(e) + 0.62;
    return [e.x + Math.cos(e.a - Math.PI / 2) * R, e.y + Math.sin(e.a - Math.PI / 2) * R];
  }
  _down(ev) {
    if (this.paused || this.demo || this.won) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    this.ov.setPointerCapture(ev.pointerId);
    this.audio.init();
    const [x, y] = this._world(ev);
    this.pointers.set(ev.pointerId, { x, y, cx: ev.clientX, cy: ev.clientY });
    const sel = this.byId(this.sel);
    if (this.pointers.size === 2 && sel && this.canRot(sel)) {
      const [p, q] = [...this.pointers.values()];
      if (this.drag && this.drag.kind === 'move') {
        const b = this.drag.before;
        if (Math.abs(b.x - sel.x) > 1e-4 || Math.abs(b.y - sel.y) > 1e-4) this._commit(sel, b);
      }
      this.drag = { kind: 'twist', id: sel.id, a0: sel.a, ang0: Math.atan2(q.y - p.y, q.x - p.x), before: this._pose(sel) };
      return;
    }
    if (this.pointers.size > 1) return;
    if (sel && this.canRot(sel)) {
      const [hx, hy] = this.handlePos(sel);
      if (Math.hypot(x - hx, y - hy) < Math.max(0.42, 26 / this.R.cssScale)) {
        this.drag = { kind: 'rot', id: sel.id, a0: sel.a, ang0: Math.atan2(y - sel.y, x - sel.x), before: this._pose(sel) };
        this.audio.grab();
        return;
      }
    }
    const el = this.pick(x, y);
    if (el && (this.canMove(el) || this.canRot(el))) {
      this.select(el.id);
      if (this.canMove(el)) {
        this.drag = { kind: 'move', id: el.id, dx: el.x - x, dy: el.y - y, before: this._pose(el), moved: false };
      } else {
        this.drag = { kind: 'rot', id: el.id, a0: el.a, ang0: Math.atan2(y - el.y, x - el.x), before: this._pose(el) };
      }
      this.audio.grab();
      this.ghost = null;
    } else if (el) {
      this.audio.deny();
      this.shake.set(el.id, 0.35);
      this.onToast('このパーツは固定されています');
    } else {
      this._tapEmpty = ev.pointerId;
    }
  }
  _pose(e) { return { x: e.x, y: e.y, a: e.a }; }
  _move(ev) {
    const [x, y] = this._world(ev);
    const pt = this.pointers.get(ev.pointerId);
    if (pt) { pt.x = x; pt.y = y; pt.cx = ev.clientX; pt.cy = ev.clientY; }
    if (!this.drag) {
      if (this.paused || this.demo) return;
      const h = this.pick(x, y);
      this.hover = h && (this.canMove(h) || this.canRot(h) || this.editor) ? h.id : null;
      this.ov.style.cursor = h ? (this.canMove(h) ? 'grab' : this.canRot(h) ? 'alias' : 'not-allowed') : 'default';
      const sel = this.byId(this.sel);
      if (sel && this.canRot(sel)) {
        const [hx, hy] = this.handlePos(sel);
        if (Math.hypot(x - hx, y - hy) < Math.max(0.42, 26 / this.R.cssScale)) this.ov.style.cursor = 'grab';
      }
      return;
    }
    const d = this.drag; const el = this.byId(d.id);
    if (!el) return;
    if (d.kind === 'twist') {
      if (this.pointers.size < 2) return;
      const [p, q] = [...this.pointers.values()];
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      this._setAngle(el, d.a0 + (ang - d.ang0), ev.shiftKey);
      return;
    }
    if (d.kind === 'move') {
      let nx = x + d.dx, ny = y + d.dy;
      if (this.snap && !ev.altKey) { nx = Math.round(nx * 4) / 4; ny = Math.round(ny * 4) / 4; }
      this._tryMove(el, nx, ny);
      d.moved = true;
    } else if (d.kind === 'rot') {
      const ang = Math.atan2(y - el.y, x - el.x);
      this._setAngle(el, d.a0 + (ang - d.ang0), ev.shiftKey);
    }
  }
  _setAngle(el, a, fine) {
    const step = (fine ? 1 : 2.5) * D2R;
    let na = Math.round(a / step) * step;
    na = ((na + Math.PI * 4) % (Math.PI * 2));
    if (Math.abs(na - el.a) < 1e-6) return;
    const old = el.a;
    el.a = na;
    if (!O.placementOk(el, this.els)) { el.a = old; return; }
    this.audio.rotate(na);
    this.dirty = true;
  }
  _tryMove(el, nx, ny) {
    const ox = el.x, oy = el.y;
    const ok = (x, y) => { el.x = x; el.y = y; return O.placementOk(el, this.els); };
    if (ok(nx, ny)) { this.dirty = true; return; }
    // 盤面の外へ出ようとしたら端まで寄せる
    {
      const fp = O.footprint(Object.assign({}, el, { x: nx, y: ny }));
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const q of fp) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
      let cx = nx, cy = ny;
      if (x0 < 0.03) cx += 0.03 - x0; if (x1 > O.W - 0.03) cx -= x1 - (O.W - 0.03);
      if (y0 < 0.03) cy += 0.03 - y0; if (y1 > O.H - 0.03) cy -= y1 - (O.H - 0.03);
      if ((cx !== nx || cy !== ny) && ok(cx, cy)) { this.dirty = true; return; }
    }
    // 盤面端にめり込むならスライド
    if (ok(nx, oy)) { this.dirty = true; return; }
    if (ok(ox, ny)) { this.dirty = true; return; }
    el.x = ox; el.y = oy;
  }
  _up(ev) {
    if (this._tapEmpty === ev.pointerId) { this._tapEmpty = null; if (this.pointers.size <= 1 && !this.drag) this.select(null); }
    this.pointers.delete(ev.pointerId);
    if (!this.drag) return;
    if (this.drag.kind === 'twist' && this.pointers.size >= 1) { /* 指が残っている */ }
    const d = this.drag; const el = this.byId(d.id);
    this.drag = null;
    if (!el) return;
    const b = d.before;
    if (Math.abs(b.x - el.x) > 1e-4 || Math.abs(b.y - el.y) > 1e-4 || Math.abs(b.a - el.a) > 1e-4) {
      this._commit(el, b);
      this.audio.drop();
      this.fx.ring(el.x, el.y, 0.2, 0.9 + extent(el) * 0.4, 0.45, 0.35, 0.6, 1.0, 0.5);
    }
  }
  _commit(el, before) {
    this.hist.push({ id: el.id, b: before, a: this._pose(el) });
    if (this.hist.length > 400) this.hist.shift();
    this.future.length = 0;
    this.moves++;
    this.onChange();
  }
  _wheel(ev) {
    if (this.paused || this.demo || this.won) return;
    ev.preventDefault();
    if (!ev.deltaY) return;
    const [x, y] = this._world(ev);
    const h = this.pick(x, y);
    const el = (h && this.canRot(h)) ? h : this.byId(this.sel);
    if (!el || !this.canRot(el)) return;
    const step = (ev.shiftKey ? 2.5 : ev.ctrlKey ? 15 : 5) * D2R * (ev.deltaY > 0 ? 1 : -1);
    this.rotateBy(el, step);
  }
  rotateBy(el, da) {
    const b = this._pose(el);
    const old = el.a;
    el.a = (((el.a + da) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (!O.placementOk(el, this.els)) { el.a = old; this.audio.deny(); return; }
    this.dirty = true;
    this.audio.rotate(el.a);
    // 連続回転はまとめて1手に
    const last = this.hist[this.hist.length - 1];
    const now = performance.now();
    if (last && last.id === el.id && now - (last.t || 0) < 450 && this._wheelMerge) { last.a = this._pose(el); last.t = now; }
    else { this._commit(el, b); this.hist[this.hist.length - 1].t = now; }
    this._wheelMerge = true;
  }
  _key(ev) {
    if (this.paused || this.demo || this.won) return;
    if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
    const el = this.byId(this.sel);
    const k = ev.key;
    if ((ev.ctrlKey || ev.metaKey) && (k === 'z' || k === 'Z')) { ev.preventDefault(); ev.shiftKey ? this.redo() : this.undo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || k === 'Y')) { ev.preventDefault(); this.redo(); return; }
    if (k === 'h' || k === 'H') { this.hint(); return; }
    if (k === 'q' || k === 'Q') { if (el && this.canRot(el)) this.rotateBy(el, -2.5 * D2R); return; }
    if (k === 'e' || k === 'E') { if (el && this.canRot(el)) this.rotateBy(el, 2.5 * D2R); return; }
    if (k === 'Tab') { ev.preventDefault(); this.cycle(ev.shiftKey ? -1 : 1); return; }
    if (this.editor && (k === 'Delete' || k === 'Backspace') && el) { this.deleteSelected(); return; }
    if (el && this.canMove(el) && k.startsWith('Arrow')) {
      ev.preventDefault();
      const s = ev.shiftKey ? 0.05 : 0.25;
      this.nudge(k === 'ArrowRight' ? s : k === 'ArrowLeft' ? -s : 0, k === 'ArrowDown' ? s : k === 'ArrowUp' ? -s : 0);
    }
  }
  // 選択中のパーツを少しだけ動かす（キー・画面上の微調整パッド共通）
  nudge(dx, dy) {
    const el = this.byId(this.sel);
    if (!el || !this.canMove(el) || this.won || this.paused) return;
    const b = this._pose(el);
    const ox = el.x, oy = el.y;
    el.x += dx; el.y += dy;
    if (!O.placementOk(el, this.els)) { el.x = ox; el.y = oy; this.audio.deny(); return; }
    this.dirty = true; this._commit(el, b); this.audio.rotate(el.x);
  }
  cycle(dir) {
    const list = this.els.filter(e => this.canMove(e) || this.canRot(e));
    if (!list.length) return;
    let i = list.findIndex(e => e.id === this.sel);
    i = (i + dir + list.length) % list.length;
    this.select(list[i].id);
  }
  select(id) {
    this.sel = id;
    this._wheelMerge = false;
    this.onSelect(id == null ? null : this.byId(id));
  }
  undo() {
    const h = this.hist.pop();
    if (!h) return;
    const el = this.byId(h.id); if (!el) return;
    el.x = h.b.x; el.y = h.b.y; el.a = h.b.a;
    this.future.push(h); this.moves = Math.max(0, this.moves - 1);
    this.dirty = true; this.audio.ui(); this.onChange();
  }
  redo() {
    const h = this.future.pop();
    if (!h) return;
    const el = this.byId(h.id); if (!el) return;
    el.x = h.a.x; el.y = h.a.y; el.a = h.a.a;
    this.hist.push(h); this.moves++;
    this.dirty = true; this.audio.ui(); this.onChange();
  }

  // ===== エディタ操作 =====
  addElement(type, props = {}) {
    if (this.els.length >= 60) { this.onToast('パーツは60個までです'); return null; }
    const el = O.makeElement(type, props);
    // 空いている場所を探す
    const spots = [];
    for (let r = 0; r < 12; r++) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      spots.push([O.W / 2 + Math.cos(a) * r * 0.55, O.H / 2 - 0.5 + Math.sin(a) * r * 0.4]);
    }
    for (const [x, y] of spots) {
      el.x = Math.round(x * 4) / 4; el.y = Math.round(y * 4) / 4;
      if (O.placementOk(el, this.els)) break;
    }
    el.sol = { x: el.x, y: el.y, a: el.a };
    this.els.push(el); this.dirty = true;
    this.select(el.id);
    this.audio.drop();
    return el;
  }
  deleteSelected() {
    const el = this.byId(this.sel); if (!el) return;
    this.els = this.els.filter(e => e !== el); this.select(null); this.dirty = true; this.audio.ui();
  }
  duplicateSelected() {
    const el = this.byId(this.sel); if (!el) return;
    const props = Object.assign({}, el); delete props.id; delete props.sol;
    const n = this.addElement(el.type, props);
    n.a = el.a; n.sol = { x: n.x, y: n.y, a: n.a };
  }
  touch() { this.dirty = true; }

  // ===== ヒント =====
  hint() {
    if (!this.def || this.won || this.editor || this.demo) return;
    const slots = [];
    const types = [...new Set(this.els.filter(e => e.sol && (e.mv || e.rt)).map(e => e.type))];
    for (const t of types) {
      const group = this.els.filter(e => e.type === t && e.sol && (e.mv || e.rt));
      const used = new Set();
      const open = [];
      for (const g of group) {
        let best = null, bd = 1e9;
        if (!g.mv) { best = g; bd = 0; }   // 回転のみのパーツは、その場にある自分自身が対象
        else for (const c of group) {
          if (used.has(c) || !c.mv) continue;
          const dp = g.mv ? Math.hypot(c.x - g.sol.x, c.y - g.sol.y) : 0;
          const da = angDiff(c.a, g.sol.a, SYM[t]);
          const score = dp + da * 1.5;
          if (score < bd) { bd = score; best = c; }
        }
        if (best) {
          const dp = g.mv ? Math.hypot(best.x - g.sol.x, best.y - g.sol.y) : 0;
          const da = angDiff(best.a, g.sol.a, SYM[t]);
          if (dp < 0.02 && da < 0.3 * D2R) used.add(best);
          else { used.add(best); open.push({ slot: g, cur: best }); }
        }
      }
      slots.push(...open);
    }
    if (!slots.length) { this.onToast(this.tr && O.allSolved(this.tr) ? 'もう解けています' : 'ほぼ合っています。微調整してみよう'); return; }
    // 光源から近い（beam順）ものを先に: 簡易に「現在位置から最も遠い」ものを提示
    slots.sort((a, b) => Math.hypot(b.cur.x - b.slot.sol.x, b.cur.y - b.slot.sol.y) - Math.hypot(a.cur.x - a.slot.sol.x, a.cur.y - a.slot.sol.y));
    const s = slots[0];
    if (!this.ghost || this.ghost.slot !== s.slot) this.hints++;
    this.ghost = { slot: s.slot, cur: s.cur, t: 7 };
    this.audio.hint();
    this.onChange();
  }

  // ===== 更新 =====
  update(dt) {
    this.time += dt;
    this.intro = Math.min(1, this.intro + dt / 1.2);
    if (!this.won && !this.demo && !this.editor && !this.sandbox && !this.paused) this.playTime += dt;
    if (this.dirty) { this.tr = O.trace(this.els); this.dirty = false; }
    const tr = this.tr;
    // 受光器の状態
    let allCharged = tr && tr.targets.length > 0;
    let litCount = 0;
    if (tr) {
      for (const r of tr.targets) {
        let st = this.charge.get(r.id);
        if (!st) { st = { fill: 0, bad: 0, charge: 0, ok: false }; this.charge.set(r.id, st); }
        const k = Math.min(1, dt * 9);
        st.fill += (r.fill - st.fill) * k;
        st.bad += (Math.min(1, r.bad > 0.5 ? r.bad : 0) - st.bad) * k;
        const prev = st.charge;
        if (r.ok) st.charge = Math.min(1, st.charge + dt / 0.55); else st.charge = Math.max(0, st.charge - dt / 0.35);
        if (prev < 1 && st.charge >= 1) {
          const t = r.el;
          const mid = (t.lo + t.hi) / 2;
          this.audio.chime(mid, 0, 0.2);
          const c = nmRGB(mid); const m = Math.max(c[0], c[1], c[2], 1e-3);
          this.fx.ring(t.x, t.y, 0.4, 2.2, 0.9, c[0] / m * 0.35, c[1] / m * 0.35, c[2] / m * 0.35, 0.8);
          this.fx.burstSpectrum(t.x, t.y, 12, 2.2, 0.9, 0.4);
        }
        if (r.ok) litCount++;
        if (st.charge < 1) allCharged = false;
      }
      for (const id of [...this.charge.keys()]) if (!tr.targets.some(r => r.id === id)) this.charge.delete(id);
    }
    if (!this.won && allCharged && !this.editor && !this.sandbox && !this.demo) {
      this.winTimer += dt;
      if (this.winTimer > 0.45) this._win();
    } else if (!this.won) this.winTimer = 0;
    if (this.won) {
      this.winT += dt;
      this.R.flash = Math.max(0, 1 - this.winT * 2.0) * 0.25;
      const sh = this.R.shock; sh[2] = this.winT * 0.9; sh[3] = Math.max(0, 1 - this.winT * 0.7) * 0.5;
    }
    // 光点から火花
    if (tr && tr.marks.length && !this.demo) this._emitSparks(dt);
    this.fx.update(dt);
    // 揺れ
    for (const [k, v] of this.shake) { if (v - dt <= 0) this.shake.delete(k); else this.shake.set(k, v - dt); }
    if (this.ghost) { this.ghost.t -= dt; if (this.ghost.t <= 0) this.ghost = null; }
    // ハム
    if (tr) {
      const lit = Math.min(1, tr.nseg / 60);
      this.audio.setHum(lit * (this.won ? 1.5 : 1), Math.min(1, litCount / 3));
    }
  }
  _emitSparks(dt) {
    const mk = this.tr.marks;
    const n = mk.length / 6;
    const tries = Math.min(6, n);
    for (let i = 0; i < tries; i++) {
      if (Math.random() > dt * 14) continue;
      const k = (Math.random() * n | 0) * 6;
      const kind = mk[k + 5];
      if (kind !== 0 && kind !== 2 && kind !== 3 && kind !== 1) continue;
      const r = mk[k + 2], g = mk[k + 3], b = mk[k + 4];
      const l = Math.max(r, g, b);
      if (l < 0.004) continue;
      const s = 1 / l * (kind === 2 ? 1.3 : 0.9);
      this.fx.spark(mk[k], mk[k + 1], kind === 1 ? 0.6 : 1.4, 0.5 + Math.random() * 0.5, r * s * 1.4, g * s * 1.4, b * s * 1.4, 0.06 + Math.random() * 0.06, Math.random() < 0.5 ? 3 : 0);
    }
  }
  _win() {
    this.won = true; this.winT = 0;
    const ts = this.tr.targets;
    let cx = 0, cy = 0;
    const nms = [];
    for (const r of ts) {
      const t = r.el; cx += t.x; cy += t.y; nms.push((t.lo + t.hi) / 2);
      this.fx.ring(t.x, t.y, 0.5, 4.5, 1.6, 0.14, 0.17, 0.3, 0.8);
      this.fx.ring(t.x, t.y, 0.3, 2.8, 1.2, 0.12, 0.2, 0.34, 0.8);
      this.fx.burstSpectrum(t.x, t.y, 36, 4.5, 1.8, 0.7);
    }
    cx /= ts.length; cy /= ts.length;
    const uv = this.R.worldToUv(cx, cy);
    this.R.shock = [uv[0], uv[1], 0, 1];
    this.audio.win(nms.slice(0, 4));
    this.fx.burstSpectrum(cx, cy, 50, 6, 2.2, 0.8);
    this.onEarlyWin && this.onEarlyWin({ moves: this.moves, time: this.playTime, hints: this.hints });
    clearTimeout(this._winTO);
    this._winTO = setTimeout(() => { if (this.won) this.onWin({ moves: this.moves, time: this.playTime, hints: this.hints }); }, 1500);
  }

  // ===== 描画 =====
  render(dt) {
    const R = this.R;
    const nSprites = this.fx.fill();
    // 導入演出：露出
    R.exposure = (0.55 + 0.45 * easeOut(this.intro));
    const els = this.els;
    const shown = this.drag ? els : els;
    R.render({
      els: shown, trace: this.tr, time: this.time, dt, hover: this.hover, sel: this.sel,
      charge: this.charge, sprites: this.fx.out, nSprites, reveal: this.demo ? 1e4 : (this.time - this.t0) * 26 - 1, winGlow: this.won ? Math.min(1, this.winT) : 0,
    });
    this._drawOverlay();
  }
  resizeOverlay(w, h, dpr) {
    this.ov.width = Math.floor(w * dpr); this.ov.height = Math.floor(h * dpr);
    this.ov.style.width = w + 'px'; this.ov.style.height = h + 'px';
    this.odpr = dpr;
  }
  _poly(ctx, poly) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => { const [cx, cy] = this.R.toCss(x, y); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); });
    ctx.closePath();
  }
  _drawOverlay() {
    const ctx = this.octx, dpr = this.odpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.ov.width / dpr, this.ov.height / dpr);
    if (this.demo || this.paused) return;
    const t = this.time;
    // ヒントの幽霊
    if (this.ghost) {
      const g = this.ghost, s = g.slot, c = g.cur;
      const ghostEl = Object.assign({}, c, { x: s.sol.x, y: s.sol.y, a: s.sol.a });
      const poly = O.footprint(ghostEl);
      ctx.save();
      const al = Math.min(1, g.t / 1.5) * (0.65 + 0.35 * Math.sin(t * 5));
      ctx.setLineDash([7, 6]); ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = `rgba(255,214,120,${al})`; ctx.fillStyle = `rgba(255,214,120,${al * 0.16})`;
      ctx.lineWidth = 2; ctx.shadowColor = 'rgba(255,200,90,.9)'; ctx.shadowBlur = 12;
      this._poly(ctx, poly); ctx.fill(); ctx.stroke();
      if (s.mv && Math.hypot(c.x - s.sol.x, c.y - s.sol.y) > 0.3) {
        const [x0, y0] = this.R.toCss(c.x, c.y), [x1, y1] = this.R.toCss(s.sol.x, s.sol.y);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.globalAlpha = 0.5; ctx.stroke();
      }
      ctx.restore();
    }
    const el = this.byId(this.sel);
    if (el) {
      const poly = O.footprint(el);
      ctx.save();
      ctx.strokeStyle = 'rgba(140,210,255,0.9)'; ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(100,190,255,.9)'; ctx.shadowBlur = 10;
      // 外形を少し膨らませる
      const [cx, cy] = this.R.toCss(el.x, el.y);
      const inflated = poly.map(([x, y]) => { const d = Math.hypot(x - el.x, y - el.y) || 1; const k = (d + 0.11) / d; return [el.x + (x - el.x) * k, el.y + (y - el.y) * k]; });
      ctx.setLineDash([4, 5]); ctx.lineDashOffset = -t * 14;
      this._poly(ctx, inflated); ctx.stroke();
      ctx.setLineDash([]);
      if (this.canRot(el)) {
        const [hx, hy] = this.handlePos(el);
        const [sx, sy] = this.R.toCss(hx, hy);
        ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke(); ctx.globalAlpha = 1;
        const active = this.drag && this.drag.kind === 'rot';
        ctx.beginPath(); ctx.arc(sx, sy, active ? 13 : 11, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(20,40,70,.85)'; ctx.fill();
        ctx.strokeStyle = 'rgba(160,220,255,1)'; ctx.lineWidth = 2; ctx.stroke();
        // 回転矢印
        ctx.beginPath(); ctx.arc(sx, sy, 5, -2.4, 1.0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx + 5 * Math.cos(1.0) + 3, sy + 5 * Math.sin(1.0) - 3); ctx.lineTo(sx + 5 * Math.cos(1.0) - 1, sy + 5 * Math.sin(1.0) + 3); ctx.lineTo(sx + 5 * Math.cos(1.0) + 5, sy + 5 * Math.sin(1.0) + 3); ctx.fillStyle = 'rgba(160,220,255,1)'; ctx.fill();
        if (this.drag && this.drag.kind !== 'move') {
          ctx.shadowBlur = 0;
          ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(190,230,255,.95)';
          let deg = (Math.round(el.a / D2R * 2) / 2) % 360;
          ctx.fillText(deg + '°', cx, cy + (extent(el) + 1.0) * this.R.cssScale);
        }
      }
      ctx.restore();
    }
    // 固定パーツを触ったときの揺れマーカー
    for (const [id, v] of this.shake) {
      const e = this.byId(id); if (!e) continue;
      const [cx, cy] = this.R.toCss(e.x, e.y);
      ctx.save();
      ctx.strokeStyle = `rgba(255,120,110,${Math.min(1, v * 3)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, (extent(e) + 0.2) * this.R.cssScale * (1 + (0.35 - v) * 0.5), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
}
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
