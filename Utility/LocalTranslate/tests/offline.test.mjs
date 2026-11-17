import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const handlers = {}, stores = new Map(), removed = [];
const swURL = 'https://example.test/Utility/LocalTranslate/sw.js';
const ownCache = 'pocket-translate-shell-v2';
stores.set('other-tool-cache', new Map());
stores.set('pocket-translate-shell-old', new Map());
let claimed = false, message;
const context = vm.createContext({ URL, Request, fetch: async () => 'network', self: {
  location: new URL(swURL),
  addEventListener(type,handler) { handlers[type] = handler; },
  async skipWaiting() {},
  clients: { async claim() { claimed = true; }, async matchAll() { return [{ postMessage(value) { message = value.type; } }]; } },
}, caches: {
  async open(name) {
    if (!stores.has(name)) stores.set(name,new Map());
    const store = stores.get(name);
    return {
      async addAll(files) { for (const file of files) { assert.equal(file.cache, 'reload'); store.set(new URL(file.url,swURL).href, 'cached'); } },
      async match(request) { return store.get(new URL(typeof request === 'string' ? request : request.url,swURL).href); },
    };
  },
  async keys() { return [...stores.keys()]; },
  async delete(key) { removed.push(key); return stores.delete(key); },
} });
vm.runInContext(await readFile(new URL('../sw.js',import.meta.url),'utf8'),context);
async function dispatch(type, extra = {}) {
  let work;
  handlers[type]({ ...extra, waitUntil(promise) { work = promise; } });
  await work;
}
await dispatch('install');
assert(stores.get(ownCache).has(new URL('./vendor/compat.wasm?v=3.13.0',swURL).href));
await dispatch('activate');
assert.equal(claimed,true);
assert.equal(message,'OFFLINE_READY');
assert.deepEqual(removed,['pocket-translate-shell-old']);
assert(stores.has('other-tool-cache'));
function fetchResource(url,method='GET') {
  let response;
  handlers.fetch({ request:{url,method}, respondWith(promise) { response = promise; } });
  return response;
}
assert.equal(await fetchResource('https://example.test/Utility/LocalTranslate/'),'cached');
assert.equal(await fetchResource('https://example.test/Utility/LocalTranslate/vendor/compat.wasm?v=3.13.0'),'cached');
assert.equal(await fetchResource('https://example.test/css/common-style.css'),'cached');
assert.equal(fetchResource('https://huggingface.co/model.gguf'),undefined);
assert.equal(fetchResource('https://example.test/OtherTool/'),undefined);
assert.equal(fetchResource('https://example.test/Utility/LocalTranslate/app.js','POST'),undefined);
let verified = false;
await dispatch('message',{ data:{ type:'CHECK_OFFLINE' }, source:{ postMessage(value) { verified = value.type === 'OFFLINE_READY'; } } });
assert(verified);
export const result = 'オフライン用ファイル配信・保存完了通知・モデル除外・他ツールのキャッシュ保護：成功';
