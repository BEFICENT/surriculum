const CACHE_NAME = 'surriculum-cache-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/mobile.css',
  '/main.js',
  '/mobile.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  // Take over as soon as possible so updates don't wait for every tab to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', event => {
  // Drop any old cache versions (fixes stale/broken assets from earlier builds),
  // then start controlling open pages immediately.
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: updated files always win; fall back to cache when offline.
// Same-origin requests bypass the HTTP cache ('no-store') so an edited file is
// never masked by a stale browser-cached copy; the SW still keeps its own Cache
// Storage copy for offline use.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const sameOrigin = event.request.url.startsWith(self.location.origin);
  const networkFetch = sameOrigin
    ? fetch(event.request, { cache: 'no-store' })
    : fetch(event.request);
  event.respondWith(
    networkFetch
      .then(response => {
        if (response && response.ok && sameOrigin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
