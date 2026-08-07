'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const DEFAULT_SCOPE = 'https://beficent.github.io/surriculum/';

function fakeResponse(label, ok = true) {
  return {
    label,
    ok,
    clone() {
      return { label: label + ':clone', ok };
    },
  };
}

function createWorker(options = {}) {
  const handlers = {};
  const records = {
    addAll: [],
    claimed: 0,
    deleted: [],
    fetches: [],
    matches: [],
    opened: [],
    puts: [],
    skipWaiting: 0,
  };
  const scope = options.scope || DEFAULT_SCOPE;

  const cacheFor = (name) => ({
    addAll(assets) {
      records.addAll.push({ name, assets: Array.from(assets) });
      if (options.addAllImpl) return options.addAllImpl(name, assets);
      return Promise.resolve();
    },
    match(request, matchOptions) {
      records.matches.push({ name, request, options: matchOptions });
      if (options.matchImpl) return options.matchImpl(name, request, matchOptions);
      return Promise.resolve(undefined);
    },
    put(request, response) {
      records.puts.push({ name, request, response });
      if (options.putImpl) return options.putImpl(name, request, response);
      return Promise.resolve();
    },
  });

  const caches = {
    delete(name) {
      records.deleted.push(name);
      if (options.deleteImpl) return options.deleteImpl(name);
      return Promise.resolve(true);
    },
    keys() {
      return Promise.resolve(options.cacheKeys || []);
    },
    open(name) {
      records.opened.push(name);
      return Promise.resolve(cacheFor(name));
    },
  };

  const self = {
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    clients: {
      claim() {
        records.claimed += 1;
        if (options.claimImpl) return options.claimImpl();
        return Promise.resolve();
      },
    },
    location: {
      origin: new URL(scope).origin,
      search: options.search !== undefined ? options.search : '?v=3.1-test-data',
    },
    registration: { scope },
    skipWaiting() {
      records.skipWaiting += 1;
      if (options.skipWaitingImpl) return options.skipWaitingImpl();
      return Promise.resolve();
    },
  };

  const fetchImpl = (request, init) => {
    records.fetches.push({ request, init });
    if (options.fetchImpl) return options.fetchImpl(request, init);
    if (options.networkError) return Promise.reject(options.networkError);
    return Promise.resolve(options.networkResponse || fakeResponse('network'));
  };

  const sandbox = {
    Map,
    Response,
    URL,
    URLSearchParams,
    Promise,
    Set,
    caches,
    console,
    fetch: fetchImpl,
    self,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    SW_SRC + `\n;globalThis.__SW = {
      APP_SHELL_PATHS,
      ASSETS,
      CACHE_NAME,
      CACHE_PREFIX,
      PDFJS_ASSETS,
      PDFJS_CACHE_NAME,
      PDFJS_PATHS,
      RUNTIME_CACHE_NAME,
      isAppShellRequest,
      isPdfJsRequest,
      isRequestWithinScope
    };`,
    sandbox,
    { filename: 'sw.js' },
  );

  return { exports: sandbox.__SW, handlers, records, scope };
}

function dispatch(worker, type, fields = {}) {
  let lifetime;
  let response;
  const event = {
    ...fields,
    respondWith(value) {
      response = Promise.resolve(value);
    },
    waitUntil(value) {
      lifetime = Promise.resolve(value);
    },
  };
  worker.handlers[type](event);
  return {
    event,
    get lifetime() { return lifetime; },
    get response() { return response; },
  };
}

test('cache name derives from the registration version', () => {
  assert.equal(
    createWorker({ search: '?v=3.1-2026-07-18' }).exports.CACHE_NAME,
    'surriculum-3.1-2026-07-18',
  );
  assert.equal(
    createWorker({ search: '?v=' + encodeURIComponent('3.2-2026-08-01') }).exports.CACHE_NAME,
    'surriculum-3.2-2026-08-01',
  );
  assert.equal(createWorker({ search: '' }).exports.CACHE_NAME, 'surriculum-cache-v4');
});

test('all precache URLs stay inside the nested GitHub Pages scope', () => {
  const worker = createWorker();
  const assets = Array.from(worker.exports.ASSETS);
  const pdfJsAssets = Array.from(worker.exports.PDFJS_ASSETS);

  assert.ok(assets.length > 30);
  assert.ok(assets.every(url => url.startsWith(DEFAULT_SCOPE)));
  assert.ok(assets.includes(DEFAULT_SCOPE));
  assert.ok(assets.includes(DEFAULT_SCOPE + 'index.html'));
  assert.ok(assets.includes(DEFAULT_SCOPE + 'scripts/course_requisites.js'));
  assert.ok(!assets.includes('https://beficent.github.io/index.html'));
  assert.deepEqual(pdfJsAssets, [
    DEFAULT_SCOPE + 'assets/vendor/pdfjs-6.2.108/pdf.min.mjs',
    DEFAULT_SCOPE + 'assets/vendor/pdfjs-6.2.108/pdf.worker.min.mjs',
  ]);
  assert.ok(pdfJsAssets.every(url => url.startsWith(DEFAULT_SCOPE)));
});

test('the app shell covers every local page resource and planner image', () => {
  const shellPaths = new Set(Array.from(createWorker().exports.APP_SHELL_PATHS));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const localPageResources = Array.from(
    html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi),
    match => match[1],
  ).filter(ref => !/^(?:https?:|data:|#)/i.test(ref));

  const referencedAssetSources = [
    fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'scripts', 'click.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'scripts', 'mouse_and_drag.js'), 'utf8'),
  ].join('\n');
  const referencedAssets = Array.from(
    referencedAssetSources.matchAll(/(?:\.\/)?(assets\/[A-Za-z0-9._/-]+)/g),
    match => match[1],
  );
  const manifestIcons = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'),
  ).icons.map(icon => icon.src);

  for (const ref of new Set([...localPageResources, ...referencedAssets, ...manifestIcons])) {
    assert.ok(shellPaths.has(ref), `missing app-shell resource: ${ref}`);
  }

  for (const bootstrap of [
    'courses/terms.jsonl',
    'requirements/minors.jsonl',
    'requirements/minors/terms.jsonl',
  ]) {
    assert.ok(shellPaths.has(bootstrap), `missing bootstrap data: ${bootstrap}`);
  }
  assert.ok(
    !shellPaths.has('requirements/default.jsonl'),
    'the removed synthetic requirements file must not make installation fail',
  );
  assert.ok(shellPaths.has('scripts/pdf_transcript_reader.js'));
  assert.deepEqual(Array.from(createWorker().exports.PDFJS_PATHS), [
    'assets/vendor/pdfjs-6.2.108/pdf.min.mjs',
    'assets/vendor/pdfjs-6.2.108/pdf.worker.min.mjs',
  ]);
});

test('install reuses a complete PDF.js pair across shell rotations', async () => {
  let finishShell;
  const worker = createWorker({
    matchImpl: (name, request) => Promise.resolve(
      name === 'surriculum-pdfjs-6.2.108'
      && String(request).includes('/assets/vendor/pdfjs-6.2.108/')
        ? fakeResponse('cached-pdfjs')
        : undefined,
    ),
    addAllImpl: (name) => (
      name === 'surriculum-3.1-test-data'
        ? new Promise(resolve => { finishShell = resolve; })
        : Promise.resolve()
    ),
  });
  const install = dispatch(worker, 'install');

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.records.skipWaiting, 0);
  assert.deepEqual(worker.records.addAll.map(entry => entry.name), [worker.exports.CACHE_NAME]);
  assert.equal(worker.records.deleted.includes(worker.exports.PDFJS_CACHE_NAME), false);
  assert.deepEqual(
    worker.records.matches
      .filter(entry => entry.name === worker.exports.PDFJS_CACHE_NAME)
      .map(entry => String(entry.request)),
    Array.from(worker.exports.PDFJS_ASSETS),
  );

  finishShell();
  await install.lifetime;
  assert.equal(worker.records.skipWaiting, 1);
});

test('install deletes an incomplete PDF.js cache and atomically rebuilds the exact pair', async () => {
  let finishPdfJs;
  const worker = createWorker({
    matchImpl: (name, request) => Promise.resolve(
      name === 'surriculum-pdfjs-6.2.108'
      && String(request).endsWith('/assets/vendor/pdfjs-6.2.108/pdf.min.mjs')
        ? fakeResponse('cached-main-only')
        : undefined,
    ),
    addAllImpl: (name) => (
      name === 'surriculum-pdfjs-6.2.108'
        ? new Promise(resolve => { finishPdfJs = resolve; })
        : Promise.resolve()
    ),
  });
  const install = dispatch(worker, 'install');

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.records.skipWaiting, 0);
  assert.ok(worker.records.deleted.includes(worker.exports.PDFJS_CACHE_NAME));
  const vendorWrites = worker.records.addAll.filter(entry => (
    entry.name === worker.exports.PDFJS_CACHE_NAME
  ));
  assert.equal(vendorWrites.length, 1);
  assert.deepEqual(vendorWrites[0].assets, Array.from(worker.exports.PDFJS_ASSETS));

  finishPdfJs();
  await install.lifetime;
  assert.equal(worker.records.skipWaiting, 1);
});

test('a failed PDF.js pair rebuild rejects installation and keeps the old worker active', async () => {
  const failure = new Error('precache failed');
  const worker = createWorker({
    addAllImpl: (name) => (
      name === 'surriculum-pdfjs-6.2.108'
        ? Promise.reject(failure)
        : Promise.resolve()
    ),
  });
  const install = dispatch(worker, 'install');

  await assert.rejects(install.lifetime, failure);
  assert.ok(worker.records.deleted.includes(worker.exports.PDFJS_CACHE_NAME));
  assert.equal(worker.records.skipWaiting, 0);
});

test('activation deletes only obsolete SUrriculum caches and preserves runtime data', async () => {
  let finishDeletes;
  const deleteGate = new Promise(resolve => { finishDeletes = resolve; });
  const worker = createWorker({
    cacheKeys: [
      'surriculum-old',
      'surriculum-cache-v4',
      'surriculum-runtime-v1',
      'surriculum-pdfjs-5.7.284',
      'surriculum-pdfjs-6.2.108',
      'other-app-v1',
      'surriculumish-old',
      'surriculum-3.1-test-data',
    ],
    deleteImpl: () => deleteGate,
  });
  const activation = dispatch(worker, 'activate');

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(worker.records.deleted.sort(), [
    'surriculum-cache-v4',
    'surriculum-old',
    'surriculum-pdfjs-5.7.284',
  ]);
  assert.equal(worker.records.claimed, 0);

  finishDeletes(true);
  await activation.lifetime;
  assert.equal(worker.records.claimed, 1);
});

test('plan warmup caches only deduplicated runtime URLs inside the app scope', async () => {
  const worker = createWorker();
  const message = dispatch(worker, 'message', {
    data: {
      type: 'CACHE_PLAN_URLS',
      urls: [
        'requirements/202503.jsonl',
        'requirements/202503.jsonl',
        'courses/202503/CS.jsonl',
        'main.js',
        'scripts/pdf_transcript_reader.js',
        'assets/vendor/pdfjs-6.2.108/pdf.min.mjs',
        'assets/vendor/pdfjs-6.2.108/pdf.worker.min.mjs',
        '../other-app/private.json',
        'https://untrusted.example.test/file.json',
      ],
    },
  });

  await message.lifetime;
  assert.deepEqual(
    worker.records.fetches.map(entry => String(entry.request)).sort(),
    [
      DEFAULT_SCOPE + 'courses/202503/CS.jsonl',
      DEFAULT_SCOPE + 'requirements/202503.jsonl',
    ],
  );
  assert.equal(worker.records.puts.length, 3);
  assert.ok(worker.records.puts.every(entry => entry.name === worker.exports.RUNTIME_CACHE_NAME));
  assert.ok(worker.records.puts.some(entry => (
    String(entry.request).includes('/.surriculum-runtime-ready?')
  )));
});

test('a completed warmup is not downloaded again for the same data version and plan', async () => {
  const worker = createWorker({
    matchImpl: (name, request) => Promise.resolve(
      name === 'surriculum-runtime-v1'
      && String(request).includes('/.surriculum-runtime-ready?')
        ? fakeResponse('ready-marker')
        : undefined,
    ),
  });
  const message = dispatch(worker, 'message', {
    data: {
      type: 'CACHE_PLAN_URLS',
      urls: ['requirements/202503.jsonl', 'courses/202503/CS.jsonl'],
    },
  });

  await message.lifetime;
  assert.equal(worker.records.fetches.length, 0);
  assert.equal(worker.records.puts.length, 0);
});

test('concurrent warmup messages share one set of downloads', async () => {
  const responseResolvers = [];
  const worker = createWorker({
    fetchImpl: () => new Promise(resolve => { responseResolvers.push(resolve); }),
  });
  const data = {
    type: 'CACHE_PLAN_URLS',
    urls: ['requirements/202503.jsonl', 'courses/202503/CS.jsonl'],
  };
  const first = dispatch(worker, 'message', { data });
  const second = dispatch(worker, 'message', { data });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.records.fetches.length, 2);
  for (const resolve of responseResolvers) resolve(fakeResponse('warm'));
  await Promise.all([first.lifetime, second.lifetime]);
  assert.equal(worker.records.puts.length, 3);
});

test('an in-scope GET is network-first and retained in the runtime cache', async () => {
  const network = fakeResponse('catalog');
  const worker = createWorker({ networkResponse: network });
  const request = {
    method: 'GET',
    mode: 'cors',
    url: DEFAULT_SCOPE + 'courses/202401/CS.jsonl',
  };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  assert.equal(await fetchEvent.response, network);
  await fetchEvent.lifetime;
  assert.equal(worker.records.fetches[0].init.cache, 'no-store');
  assert.equal(worker.records.puts.length, 1);
  assert.equal(worker.records.puts[0].name, worker.exports.RUNTIME_CACHE_NAME);
  assert.equal(worker.records.puts[0].request, request);
  assert.equal(worker.records.puts[0].response.label, 'catalog:clone');
});

test('app-shell refreshes stay in the versioned shell cache', async () => {
  const worker = createWorker();
  const request = { method: 'GET', mode: 'cors', url: DEFAULT_SCOPE + 'main.js' };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  await fetchEvent.response;
  await fetchEvent.lifetime;
  assert.equal(worker.records.puts[0].name, worker.exports.CACHE_NAME);
});

test('PDF.js requests reuse the immutable dedicated cache without a download', async () => {
  const cachedVendorAsset = fakeResponse('cached-pdfjs');
  const worker = createWorker({
    matchImpl: (name, request) => Promise.resolve(
      name === 'surriculum-pdfjs-6.2.108'
      && String(request && request.url ? request.url : request)
        .includes('/assets/vendor/pdfjs-6.2.108/')
        ? cachedVendorAsset
        : undefined,
    ),
  });
  const request = {
    method: 'GET',
    mode: 'cors',
    url: DEFAULT_SCOPE + worker.exports.PDFJS_PATHS[0],
  };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  assert.equal(await fetchEvent.response, cachedVendorAsset);
  assert.equal(worker.records.fetches.length, 0);
  assert.equal(worker.records.puts.length, 0);
});

test('a missing immutable PDF.js asset is repaired in the dedicated cache', async () => {
  const network = fakeResponse('fresh-pdfjs');
  const worker = createWorker({ networkResponse: network });
  const request = {
    method: 'GET',
    mode: 'cors',
    url: DEFAULT_SCOPE + worker.exports.PDFJS_PATHS[0],
  };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  assert.equal(await fetchEvent.response, network);
  assert.equal(worker.records.fetches.length, 1);
  assert.equal(worker.records.puts.length, 1);
  assert.equal(worker.records.puts[0].name, worker.exports.PDFJS_CACHE_NAME);
});

test('a PDF.js cache-write failure does not discard a valid online response', async () => {
  const network = fakeResponse('fresh-pdfjs');
  const worker = createWorker({
    networkResponse: network,
    putImpl: () => Promise.reject(new Error('quota exceeded')),
  });
  const request = {
    method: 'GET',
    mode: 'cors',
    url: DEFAULT_SCOPE + worker.exports.PDFJS_PATHS[0],
  };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  assert.equal(await fetchEvent.response, network);
  assert.equal(worker.records.fetches.length, 1);
  assert.equal(worker.records.puts.length, 1);
  assert.equal(worker.records.puts[0].name, worker.exports.PDFJS_CACHE_NAME);
});

test('a successful network response survives a cache-write failure', async () => {
  const network = fakeResponse('fresh');
  const worker = createWorker({
    networkResponse: network,
    putImpl: () => Promise.reject(new Error('quota exceeded')),
  });
  const request = { method: 'GET', mode: 'cors', url: DEFAULT_SCOPE + 'main.js' };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  assert.equal(await fetchEvent.response, network);
  await fetchEvent.lifetime;
});

test('non-success network responses are returned without being cached', async () => {
  const network = fakeResponse('not-found', false);
  const worker = createWorker({ networkResponse: network });
  const request = { method: 'GET', mode: 'cors', url: DEFAULT_SCOPE + 'missing.json' };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  assert.equal(await fetchEvent.response, network);
  await fetchEvent.lifetime;
  assert.equal(worker.records.puts.length, 0);
});

test('offline requests fall back to the preserved runtime cache', async () => {
  const failure = new Error('offline');
  const offline = fakeResponse('cached-catalog');
  const worker = createWorker({
    networkError: failure,
    matchImpl: (name) => Promise.resolve(
      name === 'surriculum-runtime-v1' ? offline : undefined,
    ),
  });
  const request = {
    method: 'GET',
    mode: 'cors',
    url: DEFAULT_SCOPE + 'courses/202401/CS.jsonl',
  };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  assert.equal(await fetchEvent.response, offline);
  await fetchEvent.lifetime;
  assert.deepEqual(
    worker.records.matches.map(entry => entry.name),
    [
      worker.exports.CACHE_NAME,
      worker.exports.PDFJS_CACHE_NAME,
      worker.exports.RUNTIME_CACHE_NAME,
    ],
  );
});

test('offline PDF.js requests use the matched vendor cache directly', async () => {
  const cachedVendorAsset = fakeResponse('cached-pdfjs');
  const worker = createWorker({
    networkError: new Error('offline'),
    matchImpl: (name, request) => Promise.resolve(
      name === 'surriculum-pdfjs-6.2.108'
      && String(request && request.url ? request.url : request)
        .endsWith('/assets/vendor/pdfjs-6.2.108/pdf.min.mjs')
        ? cachedVendorAsset
        : undefined,
    ),
  });
  const request = {
    method: 'GET',
    mode: 'cors',
    url: DEFAULT_SCOPE + 'assets/vendor/pdfjs-6.2.108/pdf.min.mjs',
  };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  assert.equal(await fetchEvent.response, cachedVendorAsset);
  await fetchEvent.lifetime;
  assert.deepEqual(
    worker.records.matches.map(entry => entry.name),
    [worker.exports.PDFJS_CACHE_NAME],
  );
});

test('offline navigations fall back to the scoped cached app shell', async () => {
  const offlinePage = fakeResponse('cached-index');
  const worker = createWorker({
    networkError: new Error('offline'),
    matchImpl: (name, request) => Promise.resolve(
      name === 'surriculum-3.1-test-data'
      && request === DEFAULT_SCOPE + 'index.html'
        ? offlinePage
        : undefined,
    ),
  });
  const request = {
    method: 'GET',
    mode: 'navigate',
    url: DEFAULT_SCOPE + 'some/client/path?from=pwa',
  };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  assert.equal(await fetchEvent.response, offlinePage);
  await fetchEvent.lifetime;
});

test('an offline cache miss preserves the original network error', async () => {
  const failure = new Error('offline and uncached');
  const worker = createWorker({ networkError: failure });
  const request = { method: 'GET', mode: 'cors', url: DEFAULT_SCOPE + 'unknown.json' };
  const fetchEvent = dispatch(worker, 'fetch', { request });

  await assert.rejects(fetchEvent.response, failure);
  await fetchEvent.lifetime;
});

test('non-GET, cross-origin, and sibling-app requests are never intercepted', () => {
  const worker = createWorker();
  const requests = [
    { method: 'POST', url: DEFAULT_SCOPE + 'main.js' },
    { method: 'GET', url: 'https://cdn.example.test/library.js' },
    { method: 'GET', url: 'https://beficent.github.io/other-app/main.js' },
    { method: 'GET', url: 'https://beficent.github.io/surriculum-old/main.js' },
    { method: 'GET', url: 'https://beficent.github.io.evil.test/surriculum/main.js' },
  ];

  for (const request of requests) {
    const fetchEvent = dispatch(worker, 'fetch', { request });
    assert.equal(fetchEvent.response, undefined);
    assert.equal(fetchEvent.lifetime, undefined);
  }
  assert.equal(worker.records.fetches.length, 0);
  assert.equal(worker.records.opened.length, 0);
});
