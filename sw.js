/* Clubs service worker: lets the game open with no connection.
   Network first, so a normal visit always gets the newest files; the saved copy is only used when offline.
   Bump CACHE when you want to clear old saved files. */
const CACHE = 'clubs-v1';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/rules.js', 'js/names.js', 'js/settings.js', 'js/sound.js', 'js/ai.js', 'js/engine.js', 'js/ui.js', 'js/game.js', 'js/pwa.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'favicon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
