// 鍾乳石のジオメトリ（世界座標のまま1つに統合）
import * as THREE from 'three';
import { noise3 } from './sdf.js';

export function buildStalactites(list) {
  const RS = 12; // 周方向
  const LS = 14; // 長さ方向
  const pos = [];
  const ao = [];
  const idx = [];
  let base = 0;
  for (const s of list) {
    const len = s.yTop - s.yTip;
    const bend = (s.seed - 0.5) * 0.25;
    for (let li = 0; li <= LS; li++) {
      const t = li / LS;
      const y = s.yTop - t * len;
      // 先細り＋こぶ
      const tt = Math.max(0, (0.30 - t) / 0.30);
      const flare = 1 + 2.4 * tt * tt;
      const taper = Math.pow(1 - t, 0.9) * flare;
      const bump = 1 + 0.22 * noise3(s.x * 3.1 + t * 5.0, s.z * 3.1, t * 4.0 + s.seed * 9.0);
      const r0 = Math.max(0.012, s.r * taper * bump * (li === LS ? 0.05 : 1));
      const cx = s.x + bend * t * t * len * 0.35;
      const cz = s.z - bend * t * t * len * 0.2;
      for (let ri = 0; ri < RS; ri++) {
        const a = (ri / RS) * Math.PI * 2;
        const rr = r0 * (1 + 0.18 * noise3(Math.cos(a) * 1.7 + s.seed * 13.0, t * 6.0, Math.sin(a) * 1.7));
        pos.push(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
        ao.push(Math.min(1, 0.55 + 0.6 * t));
      }
    }
    for (let li = 0; li < LS; li++) {
      for (let ri = 0; ri < RS; ri++) {
        const a = base + li * RS + ri;
        const b = base + li * RS + ((ri + 1) % RS);
        const c = base + (li + 1) * RS + ri;
        const d = base + (li + 1) * RS + ((ri + 1) % RS);
        idx.push(a, c, b, b, c, d);
      }
    }
    base += (LS + 1) * RS;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
