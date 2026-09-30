import { generateCave } from './meshgen.js';
import { placeStalactites } from './sdf.js';

self.onmessage = (e) => {
  const opts = e.data || {};
  const t0 = performance.now();
  const mesh = generateCave(opts, (p) => self.postMessage({ type: 'progress', p }));
  const stalactites = placeStalactites();
  const ms = performance.now() - t0;
  self.postMessage(
    { type: 'done', mesh, stalactites, ms },
    [mesh.position.buffer, mesh.normal.buffer, mesh.ao.buffer, mesh.index.buffer]
  );
};
