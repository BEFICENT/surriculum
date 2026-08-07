// The cache key is derived from the app + data version passed in the
// registration URL by main.js (for example, sw.js?v=3.1-2026-07-18).
const CACHE_PREFIX = 'surriculum-';

function cacheNameFromSearch(search) {
  var v = null;
  try { v = new URLSearchParams(search || '').get('v'); } catch (_) {}
  return CACHE_PREFIX + (v || 'cache-v4');
}

const CACHE_NAME = cacheNameFromSearch(self.location.search);
// Runtime data is intentionally stable across shell/data-version rotations.
// A student who has already loaded a term can therefore still reopen that
// cached catalog offline after an automatic data refresh installs a new shell.
const RUNTIME_CACHE_NAME = CACHE_PREFIX + 'runtime-v1';

// Resolve every precached URL against the worker's registration scope. On
// GitHub Pages the scope is /surriculum/, not the origin root.
function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

const APP_SHELL_PATHS = [
  '',
  'index.html',
  'styles.css',
  'mobile.css',
  'manifest.json',
  'data/manifest.json',
  'courses/terms.jsonl',
  'requirements/minors.jsonl',
  'requirements/minors/terms.jsonl',
  'main.js',
  'mobile.js',
  'theme.js',
  'scripts/version.js',
  'scripts/plan_manager.js',
  'scripts/helper_functions.js',
  'scripts/course_requisites.js',
  'scripts/scheduler.js',
  'scripts/mouse_and_drag.js',
  'scripts/s_semester.js',
  'scripts/create_semester.js',
  'scripts/click.js',
  'scripts/academic_records_parser.js',
  'scripts/domain/credits.js',
  'scripts/domain/grades.js',
  'scripts/data/catalog.js',
  'cases/flagMessages.js',
  'scripts/s_curriculum.js',
  'scripts/requirements.js',
  'scripts/minor_requirements.js',
  'scripts/graduation_check.js',
  'assets/favicon.ico',
  'assets/favicon-16x16.png',
  'assets/favicon-32x32.png',
  'assets/android-chrome-192x192.png',
  'assets/android-chrome-512x512.png',
  'assets/apple-touch-icon.png',
  'assets/closedb.png',
  'assets/closedw.png',
  'assets/dragb.png',
  'assets/dragw.png',
  'assets/editb.png',
  'assets/editw.png',
  'assets/tickb.png',
  'assets/tickw.png',
  'assets/open.png'
];
const ASSETS = APP_SHELL_PATHS.map(scopeUrl);
const APP_SHELL_URLS = new Set(ASSETS.map(url => {
  const normalized = new URL(url);
  normalized.search = '';
  normalized.hash = '';
  return normalized.href;
}));
const RUNTIME_WARMUPS = new Map();

self.addEventListener('install', event => {
  // A failed shell download must fail the install so the last working worker
  // remains active. Only take over once the complete shell is available.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  // Cache Storage is separate from localStorage, where plans and preferences
  // live. Delete only obsolete SUrriculum caches and never caches owned by
  // another GitHub Pages application on the same origin.
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => (
            key.startsWith(CACHE_PREFIX)
            && key !== CACHE_NAME
            && key !== RUNTIME_CACHE_NAME
          ))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isRequestWithinScope(requestUrl) {
  try {
    const url = new URL(requestUrl);
    const scope = new URL(self.registration.scope);
    return url.origin === scope.origin && url.href.startsWith(scope.href);
  } catch (_) {
    return false;
  }
}

function isAppShellRequest(requestUrl) {
  try {
    const normalized = new URL(requestUrl);
    normalized.search = '';
    normalized.hash = '';
    return APP_SHELL_URLS.has(normalized.href);
  } catch (_) {
    return false;
  }
}

async function matchCachedRequest(request) {
  const shellCache = await caches.open(CACHE_NAME);
  let cached = await shellCache.match(request, { ignoreSearch: true });
  if (!cached && request.mode === 'navigate') {
    cached = await shellCache.match(scopeUrl('index.html'));
  }
  if (cached) return cached;

  const runtimeCache = await caches.open(RUNTIME_CACHE_NAME);
  return runtimeCache.match(request);
}

function normalizedWarmUrls(candidates) {
  const urls = [];
  for (const candidate of candidates) {
    let url;
    try { url = scopeUrl(String(candidate || '')); } catch (_) { continue; }
    if (!candidate || !isRequestWithinScope(url) || isAppShellRequest(url)) continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls.slice(0, 16).sort();
}

function runtimeWarmMarkerUrl(urls) {
  const marker = new URL('.surriculum-runtime-ready', self.registration.scope);
  marker.searchParams.set('cache', CACHE_NAME);
  marker.searchParams.set('urls', urls.join('|'));
  return marker.href;
}

function warmRuntimeUrls(candidates) {
  const urls = normalizedWarmUrls(candidates);
  if (!urls.length) return Promise.resolve();
  const markerUrl = runtimeWarmMarkerUrl(urls);
  if (RUNTIME_WARMUPS.has(markerUrl)) return RUNTIME_WARMUPS.get(markerUrl);

  const warmup = caches.open(RUNTIME_CACHE_NAME).then(async runtimeCache => {
    if (await runtimeCache.match(markerUrl)) return;

    const results = await Promise.all(urls.map(async url => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response || !response.ok) return false;
        await runtimeCache.put(url, response.clone());
        return true;
      } catch (_) {
        return false;
      }
    }));
    if (results.every(Boolean)) {
      await runtimeCache.put(markerUrl, new Response('ready'));
    }
  }).finally(() => {
    RUNTIME_WARMUPS.delete(markerUrl);
  });
  RUNTIME_WARMUPS.set(markerUrl, warmup);
  return warmup;
}

// The app's legacy data loaders use synchronous XHR, which is not a reliable
// way to populate Cache Storage. Once a plan is known, main.js explicitly asks
// the worker to warm only that plan's small set of catalogs and requirements.
self.addEventListener('message', event => {
  const data = event.data;
  if (!data || data.type !== 'CACHE_PLAN_URLS' || !Array.isArray(data.urls)) return;
  event.waitUntil(warmRuntimeUrls(data.urls));
});

// Network-first: updated files always win; fall back to this version's cache
// when offline. Only requests inside this worker's own scope are intercepted or
// cached, so sibling GitHub Pages applications and third-party resources remain
// untouched.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !isRequestWithinScope(event.request.url)) return;

  const networkResponse = fetch(event.request, { cache: 'no-store' });
  const cacheWrite = networkResponse
    .then(response => {
      if (!response || !response.ok) return undefined;
      const copy = response.clone();
      const targetCache = isAppShellRequest(event.request.url)
        ? CACHE_NAME
        : RUNTIME_CACHE_NAME;
      return caches.open(targetCache).then(cache => cache.put(event.request, copy));
    })
    .catch(() => {});

  // Keep the worker alive until an eligible response has been written.
  event.waitUntil(cacheWrite);
  event.respondWith(
    networkResponse.catch(async error => {
      const cached = await matchCachedRequest(event.request);
      if (cached) return cached;
      throw error;
    })
  );
});
