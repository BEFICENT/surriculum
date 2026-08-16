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
// PDF.js is large and changes independently from daily course-data refreshes.
// Keep the matched API/worker pair in its own versioned, atomic cache so a data
// refresh neither redownloads it nor risks pairing files from different builds.
const PDFJS_CACHE_NAME = CACHE_PREFIX + 'pdfjs-6.2.108';

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
  'scripts/preferences.js',
  'scripts/plan_manager.js',
  'scripts/helper_functions.js',
  'scripts/course_retakes.js',
  'scripts/course_requisites.js',
  'scripts/course_filters.js',
  'scripts/scheduler.js',
  'scripts/mouse_and_drag.js',
  'scripts/s_semester.js',
  'scripts/create_semester.js',
  'scripts/click.js',
  'scripts/academic_records_parser.js',
  'scripts/pdf_transcript_reader.js',
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
  'assets/open.png',
  'assets/vendor/inter-5.3.0/inter.css',
  'assets/vendor/inter-5.3.0/files/inter-latin-wght-normal.woff2',
  'assets/vendor/inter-5.3.0/files/inter-latin-ext-wght-normal.woff2',
  'assets/vendor/fontawesome-6.4.0/css/fontawesome.min.css',
  'assets/vendor/fontawesome-6.4.0/css/solid.min.css',
  'assets/vendor/fontawesome-6.4.0/webfonts/fa-solid-900.woff2',
  'assets/vendor/fontawesome-6.4.0/webfonts/fa-solid-900.ttf'
];
const PDFJS_PATHS = [
  'assets/vendor/pdfjs-6.2.108/pdf.min.mjs',
  'assets/vendor/pdfjs-6.2.108/pdf.worker.min.mjs'
];
const ASSETS = APP_SHELL_PATHS.map(scopeUrl);
const PDFJS_ASSETS = PDFJS_PATHS.map(scopeUrl);
const APP_SHELL_URLS = new Set(ASSETS.map(url => {
  const normalized = new URL(url);
  normalized.search = '';
  normalized.hash = '';
  return normalized.href;
}));
const PDFJS_URLS = new Set(PDFJS_ASSETS.map(url => {
  const normalized = new URL(url);
  normalized.search = '';
  normalized.hash = '';
  return normalized.href;
}));
const RUNTIME_WARMUPS = new Map();

async function ensurePdfJsAssets() {
  let cache = await caches.open(PDFJS_CACHE_NAME);
  const existing = await Promise.all(
    PDFJS_ASSETS.map(url => cache.match(url, { ignoreSearch: true }))
  );
  if (existing.every(Boolean)) return;

  // A partial pair is unusable: the API and worker must be the same version.
  // Recreate this versioned cache and populate both files through one addAll.
  await caches.delete(PDFJS_CACHE_NAME);
  cache = await caches.open(PDFJS_CACHE_NAME);
  await cache.addAll(PDFJS_ASSETS);
}

self.addEventListener('install', event => {
  // A failed shell download must fail the install so the last working worker
  // remains active. Only take over once the complete shell is available.
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)),
      ensurePdfJsAssets()
    ])
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
            && key !== PDFJS_CACHE_NAME
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

function isPdfJsRequest(requestUrl) {
  try {
    const normalized = new URL(requestUrl);
    normalized.search = '';
    normalized.hash = '';
    return PDFJS_URLS.has(normalized.href);
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

  const pdfJsCache = await caches.open(PDFJS_CACHE_NAME);
  cached = await pdfJsCache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const runtimeCache = await caches.open(RUNTIME_CACHE_NAME);
  return runtimeCache.match(request);
}

function normalizedWarmUrls(candidates) {
  const urls = [];
  for (const candidate of candidates) {
    let url;
    try { url = scopeUrl(String(candidate || '')); } catch (_) { continue; }
    if (!candidate || !isRequestWithinScope(url) || isAppShellRequest(url) || isPdfJsRequest(url)) continue;
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

async function servePdfJsAsset(request) {
  const cache = await caches.open(PDFJS_CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  // Activated workers normally have the complete pair from install. If Cache
  // Storage was manually pruned, repair only the requested immutable asset.
  const response = await fetch(request, { cache: 'no-store' });
  if (response && response.ok) {
    try { await cache.put(request, response.clone()); } catch (_) {}
  }
  return response;
}

// The app's legacy data loaders use synchronous XHR, which is not a reliable
// way to populate Cache Storage. Once a plan is known, main.js explicitly asks
// the worker to warm only that plan's small set of catalogs and requirements.
self.addEventListener('message', event => {
  const data = event.data;
  if (!data || data.type !== 'CACHE_PLAN_URLS' || !Array.isArray(data.urls)) return;
  event.waitUntil(warmRuntimeUrls(data.urls));
});

// Shell/runtime data remains network-first so updated files win, with cached
// offline fallback. The immutable, versioned PDF.js pair is cache-first below.
// Only this worker's scope is intercepted, leaving sibling Pages applications
// and third-party resources untouched.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !isRequestWithinScope(event.request.url)) return;

  // These versioned files are immutable and were installed as a matched pair.
  // Cache-first avoids downloading the 1.8 MB runtime again on every PDF use.
  if (isPdfJsRequest(event.request.url)) {
    event.respondWith(servePdfJsAsset(event.request));
    return;
  }

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
