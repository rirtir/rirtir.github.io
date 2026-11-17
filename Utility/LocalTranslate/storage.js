import { MODEL, MODEL_URL } from './core.js';

async function directory() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MODEL.directory, { create: true });
}
export async function savedModel() {
  const dir = await directory();
  try {
    const file = await (await dir.getFileHandle(MODEL.filename)).getFile();
    if (file.size !== MODEL.bytes) return null;
    const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return String.fromCharCode(...magic) === 'GGUF' ? file : null;
  } catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}
export async function removeModel() {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(MODEL.directory, { recursive: true }); }
  catch (error) { if (error.name !== 'NotFoundError') throw error; }
}
export async function downloadModel(signal, progress) {
  const dir = await directory();
  const handle = await dir.getFileHandle(MODEL.filename, { create: true });
  const writer = await handle.createWritable();
  let reader;
  try {
    const response = await fetch(MODEL_URL, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) throw new Error(`モデルの取得に失敗しました（HTTP ${response.status}）。通信を確認して再試行してください。`);
    reader = response.body.getReader();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      signal.throwIfAborted();
      received += value.byteLength;
      if (received > MODEL.bytes) throw new Error('モデルのサイズが配布仕様と一致しません。');
      await writer.write(value);
      progress(received, MODEL.bytes);
    }
    signal.throwIfAborted();
    if (received !== MODEL.bytes) throw new Error('ダウンロードが途中で終了しました。再試行してください。');
    await writer.close();
    const file = await savedModel();
    if (!file) throw new Error('取得したファイルをモデルとして確認できませんでした。');
    return file;
  } catch (error) {
    await reader?.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    await dir.removeEntry(MODEL.filename).catch(() => {});
    throw error;
  } finally { reader?.releaseLock(); }
}
export async function modelLock(callback) {
  if (!navigator.locks) return callback();
  return navigator.locks.request('pocket-translate-model', { ifAvailable: true }, lock => {
    if (!lock) throw new Error('別のタブでモデルを操作しています。その操作が終わってから再試行してください。');
    return callback();
  });
}
