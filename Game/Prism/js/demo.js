// PRISM — タイトル背景のデモ（虹がゆっくり揺れる）
export const DEMO = {
  prismA: 166,
  level: {
    name: 'demo',
    elements: [
      { type: 'laser', x: 1.2, y: 7.0, a: 0, spec: 'white', fixed: true },
      { type: 'prism', x: 4.4, y: 7.0, a: 166, r: 1.0 },
      { type: 'target', x: 14.4, y: 2.2, lo: 610, hi: 700, minE: 0.1, tol: 0.5, fixed: true },
      { type: 'target', x: 14.4, y: 3.4, lo: 500, hi: 570, minE: 0.1, tol: 0.5, fixed: true },
      { type: 'target', x: 14.4, y: 4.6, lo: 420, hi: 480, minE: 0.1, tol: 0.5, fixed: true },
      { type: 'ball', x: 9.6, y: 4.1, r: 0.8 },
      { type: 'mirror', x: 11.6, y: 6.6, a: 125, len: 2.2 },
    ],
  },
};
