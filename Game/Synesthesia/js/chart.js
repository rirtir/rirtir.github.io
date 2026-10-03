// SYNESTHESIA — 譜面生成
// 候補ノーツ {t, pos(0..1: 低→高), imp(0..1: 重要度), dur(>0:ホールド候補), g} から難易度別の譜面を作る。
// 組み込み曲（楽譜由来）にも、ユーザー曲（解析由来）にも同じ処理を使う。
import { mulberry32, clamp } from './util.js';

export const LANES = 4;
export const DIFFS = [
  { id: 0, name: 'EASY',   jp: 'やさしい',   col: '#6ee7b7', impMin: 0.58, minGap: 0.30,  cap: 2,  holds: true,  holdMin: 0.9,  maxHolds: 1, chords: false, maxFing: 1 },
  { id: 1, name: 'NORMAL', jp: 'ふつう',     col: '#7cc4ff', impMin: 0.42, minGap: 0.19,  cap: 3.6,  holds: true,  holdMin: 0.7,  maxHolds: 1, chords: true,  maxFing: 2, chordRate: 0.12 },
  { id: 2, name: 'HARD',   jp: 'むずかしい', col: '#ffb86b', impMin: 0.26, minGap: 0.125, cap: 5.5,  holds: true,  holdMin: 0.5,  maxHolds: 2, chords: true,  maxFing: 2, chordRate: 0.25 },
  { id: 3, name: 'EXPERT', jp: 'エキスパート', col: '#ff6b9a', impMin: 0.16, minGap: 0.085, cap: 8, holds: true,  holdMin: 0.4,  maxHolds: 2, chords: true,  maxFing: 3, chordRate: 0.4 },
];

const SAME = 0.022; // 同時とみなす幅(秒)

export function buildChart(cands, dur, di, seed = 1, inten = null) {
  const D = DIFFS[di];
  const rng = mulberry32(seed * 7919 + di * 104729 + 13);
  const lead = 1.2, tail = 0.4;
  let notes = [];
  // 候補が少ない曲でも、最低限の密度（難易度ごと）になるまで閾値を下げる
  const minCount = Math.max(20, dur * [0.9, 1.6, 2.4, 3.2][di]);
  for (const scale of [1, 0.88, 0.75, 0.62, 0.5, 0.38, 0.25, 0.12]) {
    notes = select(cands, dur, D, D.impMin * scale, lead, tail, inten);
    if (notes.length >= minCount) break;
  }
  assignLanes(notes, D, di, rng);
  // 統計
  const n = notes.length;
  let holds = 0; const lanes = [0, 0, 0, 0];
  for (const x of notes) { if (x.dur > 0) holds++; lanes[x.lane]++; }
  const span = Math.max(1, dur - lead - tail);
  const avg = n / span;
  // 1秒窓の最大密度
  let peak = 0, j = 0;
  for (let i = 0; i < n; i++) { while (notes[i].t - notes[j].t > 1) j++; peak = Math.max(peak, i - j + 1); }
  const level = clamp(Math.round(avg * 1.0 + peak * 0.4), 1, 15);
  return { notes, stats: { count: n, holds, lanes, nps: avg, peak, level } };
}

// 解析で十分な候補が取れない曲（無音・環境音など）用：拍に沿って置くだけの譜面
export function gridChart(beats, dur, di, seed = 1) {
  const rng = mulberry32(seed * 31 + di), step = [2, 1, 1, 1][di], sub = [1, 1, 2, 2][di], notes = [];
  let prev = -1;
  const period = beats && beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
  const bs = beats && beats.length > 1 ? Array.from(beats) : Array.from({ length: Math.floor(dur / 0.5) + 2 }, (_, i) => i * 0.5);
  for (let i = 0; i + 1 < bs.length; i += step) for (let s = 0; s < sub; s++) {
    const t = bs[i] + (bs[i + 1] - bs[i]) * s / sub;
    if (t < 1.2 || t > dur - 0.4) continue;
    let lane = Math.floor(rng() * 4); if (lane === prev) lane = (lane + 1 + Math.floor(rng() * 3)) % 4;
    prev = lane;
    notes.push({ t, pos: rng(), imp: 1, dur: 0, lane });
  }
  void period;
  return { notes, stats: { count: notes.length, holds: 0, lanes: [0, 0, 0, 0], nps: notes.length / Math.max(1, dur), peak: 0, level: 1 + di } };
}

function select(cands, dur, D, impMin, lead, tail, inten) {
  let chordGroups = 0;
  const list = cands.filter(c => c.imp >= impMin && c.t >= lead && c.t <= dur - tail);
  list.sort((a, b) => b.imp - a.imp || a.t - b.t);
  const B = 0.05, nB = Math.ceil(dur / B) + 8;
  const buckets = new Array(nB);
  const acc = [];
  const bi = (t) => Math.floor(t / B);
  for (const c of list) {
    const b0 = bi(c.t);
    // 近接チェック
    let ok = true, nearSame = 0, partner = null;
    const gb = Math.ceil(D.minGap / B) + 1;
    for (let b = Math.max(0, b0 - gb); b <= b0 + gb && ok; b++) {
      const arr = buckets[b]; if (!arr) continue;
      for (const q of arr) {
        const d = Math.abs(q.t - c.t);
        if (d < SAME) { nearSame++; partner = q; if (!D.chords || nearSame >= 2 || q.paired) ok = false; }
        else if (d < D.minGap) ok = false;
      }
    }
    if (!ok) continue;
    if (nearSame === 1 && D.chordRate != null && (chordGroups + 1) > D.chordRate * (acc.length - chordGroups)) continue;   // 同時押しは全体の chordRate まで
    // 1秒窓の密度上限
    let cnt = 0;
    for (let b = Math.max(0, bi(c.t - 0.5)); b <= bi(c.t + 0.5); b++) { const arr = buckets[b]; if (arr) cnt += arr.length; }
    const capHere = inten ? D.cap * (0.5 + 0.7 * inten(c.t)) : D.cap;   // 曲の盛り上がりに合わせて密度を変える
    if (cnt >= capHere) continue;
    if (nearSame === 1) chordGroups++;
    const maxDur = dur - 0.4 - c.t;
    const note = { t: c.t, pos: c.pos, imp: c.imp, dur: (D.holds && c.dur >= D.holdMin && maxDur >= D.holdMin) ? Math.min(c.dur, maxDur) : 0, lane: 0 };
    if (nearSame === 1 && partner) { note.paired = true; partner.paired = true; }
    (buckets[b0] || (buckets[b0] = [])).push(note);
    acc.push(note);
  }
  acc.sort((a, b) => a.t - b.t || a.pos - b.pos);
  return acc;
}

function assignLanes(notes, D, di, rng) {
  const n = notes.length;
  if (!n) return;
  // 位置を分位に変換して4レーンに均等に散らす
  const sorted = notes.map(x => x.pos).sort((a, b) => a - b);
  const quant = (p) => {
    // 同じ値が並ぶ場合は順位の中央を使う（キックだけが全部0番レーンになるのを防ぐ）
    let lo = 0, hi = sorted.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < p) lo = m + 1; else hi = m; }
    let up = lo; while (up + 1 < sorted.length && sorted[up + 1] <= p) up++;
    return sorted.length > 1 ? (lo + up) / 2 / (sorted.length - 1) : 0.5;
  };
  const busyUntil = [-1, -1, -1, -1];
  const lastT = [-9, -9, -9, -9];
  let prevLane = -1, prevT = -9, prev2Lane = -1;
  const activeHolds = (t) => busyUntil.reduce((a, u) => a + (u > t ? 1 : 0), 0);
  const drop = [];
  const recent = [];   // 直近のレーン使用履歴
  let i = 0;
  while (i < n) {
    // 同時刻グループ
    let j = i + 1;
    while (j < n && notes[j].t - notes[i].t < SAME) j++;
    const grp = notes.slice(i, j);
    const t = notes[i].t;
    const used = [];
    for (const nt of grp) {
      const holding = activeHolds(t);
      let isHold = nt.dur > 0;
      if (isHold && holding >= D.maxHolds) { nt.dur = 0; isHold = false; }
      if (holding + used.length + 1 > D.maxFing) { drop.push(nt); continue; }
      const desired = clamp(quant(nt.pos) * 4 - 0.5, 0, 3);
      let best = -1, bc = 1e9;
      for (let l = 0; l < LANES; l++) {
        if (busyUntil[l] > t - 0.02 || used.includes(l)) continue;
        let used4 = 0; for (let q = Math.max(0, recent.length - 12); q < recent.length; q++) if (recent[q] === l) used4++;
        let c = 2.0 * Math.abs(l - desired) + rng() * (di <= 1 ? 1.1 : 0.6) + used4 * (di <= 1 ? 0.55 : 0.3);
        if (l === prevLane && t - prevT < 0.30) c += di <= 1 ? 3 : 1.0;
        if (l === prevLane && l === prev2Lane && t - prevT < 0.5) c += 1.2;
        if (t - lastT[l] < 0.15) c += 6; if (t - lastT[l] < 0.11) c += 20;
        if (prevLane >= 0 && Math.abs(l - prevLane) >= 3 && t - prevT < (di <= 1 ? 0.34 : di === 2 ? 0.28 : 0.17)) c += di <= 1 ? 3.5 : di === 2 ? 3.2 : 1.6;
        if (c < bc) { bc = c; best = l; }
      }
      if (best < 0) { drop.push(nt); continue; }
      nt.lane = best; used.push(best); recent.push(best);
      lastT[best] = t;
      if (isHold) busyUntil[best] = t + nt.dur + 0.06;
    }
    if (used.length) { prev2Lane = prevLane; prevLane = used[used.length - 1]; prevT = t; }
    i = j;
  }
  if (drop.length) {
    const set = new Set(drop);
    for (let k = notes.length - 1; k >= 0; k--) if (set.has(notes[k])) notes.splice(k, 1);
  }
}
