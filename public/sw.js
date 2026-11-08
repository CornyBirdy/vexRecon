// Offline support: keeps a copy of the app itself so it opens with no signal.
// Data (/api) is never cached here – the app keeps its own copy and an outbox of unsent changes.
const CACHE = 'scout-v3';
const SHELL = ['/', '/index.html', '/tokens.css', '/app.css', '/app.js', '/logo.svg', '/logo-light.svg', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    // fonts never change: cache first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // app files: try the network (so updates arrive), but fall back to the saved copy after 3s or when offline
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const fallback = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('/index.html'));
    const timer = setTimeout(() => fallback().then((hit) => { if (hit && !done) { done = true; resolve(hit); } }), 3000);
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      clearTimeout(timer); if (!done) { done = true; resolve(res); }
    }).catch(() => { clearTimeout(timer); if (!done) fallback().then((hit) => { done = true; resolve(hit || Response.error()); }); });
  }));
});
