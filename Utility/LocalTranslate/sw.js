const CACHE = 'pocket-translate-shell-v2';
const FILES = ['./','./index.html','./style.css','./app.js','./core.js','./storage.js','./manifest.webmanifest','./icon.svg','./vendor/wllama.js?v=3.13.0','./vendor/wllama.wasm?v=3.13.0','./vendor/compat.js?v=3.13.0','./vendor/compat.wasm?v=3.13.0','../../css/common-style.css'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new Request(new URL(file, self.location.href), { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('pocket-translate-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
    for (const client of await self.clients.matchAll()) client.postMessage({ type: 'OFFLINE_READY' });
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'CHECK_OFFLINE') event.waitUntil(caches.open(CACHE).then(async cache => {
    const complete = (await Promise.all(FILES.map(file => cache.match(file)))).every(Boolean);
    if (complete) event.source?.postMessage({ type: 'OFFLINE_READY' });
  }));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const allowed = FILES.map(file => new URL(file, self.location.href).href);
  if (!allowed.includes(url.href)) return;
  // モデルはOPFSだけに保存する。別のツールのキャッシュには触らない。
  event.respondWith(caches.open(CACHE).then(async cache => await cache.match(event.request) || fetch(event.request)));
});
