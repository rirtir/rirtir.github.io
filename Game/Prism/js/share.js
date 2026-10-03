// PRISM — 自作ステージの共有（URLのハッシュに埋め込む）
import { toDef } from './gen.js';

const b64 = {
  enc(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); },
};
const R = (v) => Math.round(v * 1000) / 1000;

// 定義 → 文字列（圧縮せず JSON を短縮して格納）
export function encodeDef(def) {
  const els = def.elements.map(e => {
    const o = {};
    for (const k of Object.keys(e)) {
      if (k === 'start') o.s = e.start.a;
      else o[k] = typeof e[k] === 'number' ? R(e[k]) : e[k];
    }
    return o;
  });
  return b64.enc(JSON.stringify({ n: def.name || '', e: els }));
}
export function decodeDef(str) {
  const j = JSON.parse(b64.dec(str));
  const elements = j.e.map(o => {
    const e = Object.assign({}, o);
    if (e.s != null) { e.start = { a: e.s }; delete e.s; }
    return e;
  });
  // 最低限の検証
  const okTypes = ['laser', 'mirror', 'splitter', 'filter', 'prism', 'slab', 'ball', 'wall', 'target', 'well'];
  const num = (v, lo, hi, d) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const clean = [];
  for (const e of elements) {
    if (!okTypes.includes(e.type)) continue;
    const o = { type: e.type, x: num(e.x, 0, 16, 8), y: num(e.y, 0, 9, 4), a: num(e.a, -720, 720, 0) };
    for (const k of ['len', 'r', 'w', 'h', 'n', 'disp', 'ratio', 'k', 'R', 'minE', 'tol', 'lo', 'hi']) if (e[k] != null) o[k] = num(e[k], k === 'k' ? -1.5 : 0, k === 'lo' || k === 'hi' ? 700 : 8, 1);
    if (o.lo != null && o.hi != null && o.lo >= o.hi) { o.lo = 400; o.hi = 700; }
    if (e.type === 'laser') o.spec = (e.spec === 'white' || e.spec == null) ? 'white' : (Array.isArray(e.spec) ? [num(e.spec[0], 400, 700, 400), num(e.spec[1], 400, 700, 700)] : num(e.spec, 400, 700, 650));
    if (e.fixed) o.fixed = true;
    if (e.pivot) o.pivot = true;
    if (e.start && e.start.a != null) o.start = { a: num(e.start.a, -720, 720, 0) };
    clean.push(o);
    if (clean.length >= 80) break;
  }
  return { name: j.n || '自作ステージ', elements: clean };
}
export function shareUrl(def) {
  return location.origin + location.pathname + '#L=' + encodeDef(def);
}
export function loadFromHash(startCustom, onError) {
  try {
    const def = decodeDef(location.hash.slice(3));
    if (!def.elements.some(e => e.type === 'laser') || !def.elements.some(e => e.type === 'target')) throw new Error('empty');
    startCustom(def, { label: 'SHARE', name: def.name });
  } catch (e) { console.warn('共有リンクの読み込みに失敗', e); if (onError) onError(); }
}
export { toDef };
