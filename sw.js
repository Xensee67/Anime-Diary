/* Anime Diary — Service Worker v1 */
const SHELL_CACHE = 'anime-diary-shell-v1';
const API_CACHE = 'anime-diary-api-v1';
const IMG_CACHE = 'anime-diary-img-v1';
const IMG_CACHE_LIMIT = 200;

const SHELL_URLS = ['./', './index.html'];

/* Install: precache shell */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

/* Activate: cleanup old caches */
self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, API_CACHE, IMG_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Fetch: route by request type */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // External APIs → network-first with cache fallback
  if (url.hostname === 'shikimori.one' || url.hostname === 'api.jikan.moe') {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }

  // Posters/images → cache-first
  if (req.destination === 'image' || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstWithLimit(req, IMG_CACHE, IMG_CACHE_LIMIT));
    return;
  }

  // CDN (fonts, tailwind) → cache-first
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdn.tailwindcss.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // Same-origin app shell → stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
  }
});

/* ---- strategies ---- */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return offlineResponse();
  }
}

async function cacheFirstWithLimit(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request, { mode: 'no-cors' });
    if (response) {
      cache.put(request, response.clone());
      // Trim cache if over limit
      const keys = await cache.keys();
      if (keys.length > limit) {
        const toDelete = keys.slice(0, keys.length - limit);
        await Promise.all(toDelete.map((k) => cache.delete(k)));
      }
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise || offlineResponse();
}

function offlineResponse() {
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8"><title>Offline</title>' +
    '<style>body{background:#0c0a1a;color:#f5f0ff;font-family:system-ui;display:flex;' +
    'align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column}' +
    'h1{font-size:42px;background:linear-gradient(135deg,#ff6ec7,#a78bfa);-webkit-background-clip:text;' +
    '-webkit-text-fill-color:transparent}p{color:#b8a8e0}</style></head><body>' +
    '<h1>📴 Offline</h1><p>Нет подключения. Данные дневника доступны.</p>' +
    '<a href="./" style="color:#ff6ec7;margin-top:16px;">Попробовать снова</a></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}