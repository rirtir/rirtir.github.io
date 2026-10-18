// 同じセーブを開いた別タブの古い進行で、最新の進行を上書きしない。
export function createSessionGuard({ storage, onLost = () => {} } = {}) {
  const key = 'mosslight.session.v1';
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  let active = false, storageAvailable = true, notified = false;
  if (!storage) {
    try { storage = globalThis.localStorage; }
    catch { storageAvailable = false; }
  }

  function owner() {
    if (!storageAvailable) return token;
    try { return storage.getItem(key); }
    catch { storageAvailable = false; return token; }
  }
  function check() {
    if (!active) return false;
    if (owner() === token) return true;
    active = false;
    if (!notified) { notified = true; onLost(); }
    return false;
  }
  function claim() {
    notified = false;
    try { storage.setItem(key, token); storageAvailable = true; }
    catch { storageAvailable = false; }
    active = true;
    return check();
  }
  function release() {
    if (active && storageAvailable && owner() === token) {
      try { storage.removeItem(key); } catch { /* 保存不可環境は通常の保存エラーで通知 */ }
    }
    active = false;
  }
  function storageChanged(event) {
    if (event.key === key || event.key === null) check();
  }
  globalThis.addEventListener?.('storage', storageChanged);
  return {
    claim, check, release,
    destroy() { release(); globalThis.removeEventListener?.('storage', storageChanged); },
  };
}
