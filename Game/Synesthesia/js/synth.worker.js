// 曲の生成を別スレッドで行う（UIを止めない）
import { SONGS } from './songs.js';
import { renderSongSync } from './synth.js';

self.onmessage = (e) => {
  const { id } = e.data;
  try {
    const song = SONGS.find(s => s.id === id);
    const r = renderSongSync(song);
    self.postMessage({ id, left: r.left, right: r.right, sr: r.sr, cands: r.cands, dur: r.dur }, [r.left.buffer, r.right.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
