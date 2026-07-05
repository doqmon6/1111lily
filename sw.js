// App Shell 快取 + 離線。策略:network-first,離線時回退快取。
// 注意:新增需離線可用的靜態檔時,請同步更新 ASSETS 並提高 CACHE 版本。
const CACHE = 'market-sales-v12';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/logic.js',
  './js/db.js',
  './js/firebase.js',
  './js/auth.js',
  './js/ui/dom.js',
  './js/ui/products.js',
  './js/ui/sale.js',
  './js/ui/sale-editor.js',
  './js/ui/outing.js',
  './js/ui/online.js',
  './js/ui/exporter.js',
  './js/ui/history.js',
  './js/mirror.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Firebase SDK(gstatic,URL 帶版本、內容不可變):cache-first,
  // 首次上線載入時寫入快取,之後離線也能載入模組、App 才能離線啟動。
  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
