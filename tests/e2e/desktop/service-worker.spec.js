'use strict';

const { test, expect } = require('../fixtures');

const PAGES_URL = 'http://127.0.0.1:8001/surriculum/';
const PDFJS_CACHE_NAME = 'surriculum-pdfjs-6.2.108';
const OLD_PDFJS_CACHE_NAME = 'surriculum-pdfjs-5.7.284';
const PDFJS_URLS = [
  PAGES_URL + 'assets/vendor/pdfjs-6.2.108/pdf.min.mjs',
  PAGES_URL + 'assets/vendor/pdfjs-6.2.108/pdf.worker.min.mjs',
];

test('service worker is subpath-safe, preserves storage, and restores a warmed plan offline', async ({
  page,
  context,
}) => {
  const pagesOrigin = new URL(PAGES_URL).origin;
  const [
    rootResponse,
    rootCatalogResponse,
    metadataResponse,
    metadataHeadResponse,
    encodedMetadataResponse,
    encodedMetadataHeadResponse,
  ] = await Promise.all([
    page.request.get(pagesOrigin + '/'),
    page.request.get(pagesOrigin + '/courses/202401/BIO.jsonl'),
    page.request.get(PAGES_URL + '.git/config'),
    page.request.fetch(PAGES_URL + '.git/config', { method: 'HEAD' }),
    page.request.get(PAGES_URL + '%252egit/config'),
    page.request.fetch(PAGES_URL + '%252egit/config', { method: 'HEAD' }),
  ]);
  expect(rootResponse.status()).toBe(404);
  expect(rootCatalogResponse.status()).toBe(404);
  expect(metadataResponse.status()).toBe(404);
  expect(metadataHeadResponse.status()).toBe(404);
  expect(encodedMetadataResponse.status()).toBe(404);
  expect(encodedMetadataHeadResponse.status()).toBe(404);

  // Seed same-origin state before the app registers its worker. Activation may
  // remove old SUrriculum Cache Storage entries, but must preserve both another
  // application's cache and all localStorage-backed planner data.
  await page.goto(PAGES_URL + 'manifest.json');
  await page.evaluate(async (baseUrl) => {
    localStorage.setItem('surriculum.sw-test-sentinel', 'keep');
    const otherCache = await caches.open('other-pages-app-v1');
    await otherCache.put(baseUrl + 'other-app-sentinel', new Response('keep'));
    const oldPdfJsCache = await caches.open('surriculum-pdfjs-5.7.284');
    await oldPdfJsCache.put(baseUrl + 'assets/vendor/pdfjs-5.7.284/pdf.min.mjs', new Response('old'));
  }, PAGES_URL);

  await page.goto(PAGES_URL, { waitUntil: 'domcontentloaded' });
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return {
      scope: ready.scope,
      scriptURL: ready.active && ready.active.scriptURL,
    };
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  expect(registration.scope).toBe(PAGES_URL);
  const scriptUrl = new URL(registration.scriptURL);
  expect(scriptUrl.pathname).toBe('/surriculum/sw.js');
  expect(scriptUrl.searchParams.get('v')).toBeTruthy();

  const installed = await page.evaluate(async (baseUrl) => {
    const names = await caches.keys();
    const shellName = names.find(name => (
      name.startsWith('surriculum-')
      && name !== 'surriculum-runtime-v1'
      && !name.startsWith('surriculum-pdfjs-')
    ));
    const shellUrls = shellName
      ? (await (await caches.open(shellName)).keys()).map(request => request.url)
      : [];
    const pdfJsUrls = (
      await (await caches.open('surriculum-pdfjs-6.2.108')).keys()
    ).map(request => request.url);
    return {
      names,
      shellName,
      shellUrls,
      pdfJsUrls,
      sentinel: localStorage.getItem('surriculum.sw-test-sentinel'),
      allScoped: shellUrls.every(url => url.startsWith(baseUrl)),
      pdfJsAllScoped: pdfJsUrls.every(url => url.startsWith(baseUrl)),
    };
  }, PAGES_URL);

  expect(installed.shellName).toBeTruthy();
  expect(installed.shellName).not.toBe(PDFJS_CACHE_NAME);
  expect(installed.allScoped).toBe(true);
  expect(installed.pdfJsAllScoped).toBe(true);
  expect(installed.shellUrls).toContain(PAGES_URL + 'index.html');
  expect(installed.shellUrls).toContain(PAGES_URL + 'scripts/course_requisites.js');
  expect(installed.shellUrls).toContain(PAGES_URL + 'scripts/pdf_transcript_reader.js');
  expect(installed.shellUrls.filter(url => PDFJS_URLS.includes(url))).toEqual([]);
  expect(installed.pdfJsUrls).toEqual(PDFJS_URLS);
  expect(installed.names).toContain(PDFJS_CACHE_NAME);
  expect(installed.names).not.toContain(OLD_PDFJS_CACHE_NAME);
  expect(installed.names).toContain('other-pages-app-v1');
  expect(installed.sentinel).toBe('keep');

  // Save a non-default, graded plan through the production import/storage API.
  // The next navigation must render it and warm its exact BIO catalog and
  // requirements rather than merely restoring a generic application shell.
  await page.evaluate(() => {
    window.planStorage.importPlanObject({
      type: 'surriculum_plan',
      version: 1,
      plan: {
        name: 'Offline BIO plan',
        state: {
          major: 'BIO',
          entryTerm: 'Fall 2024-2025',
          curriculum: [['BIO301']],
          grades: [['A']],
          dates: ['Fall 2024-2025'],
        },
      },
    }, { activate: true });
  });

  await page.goto(PAGES_URL + '?warm-runtime=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    Boolean(window.curriculum)
    && window.curriculum.major === 'BIO'
    && window.curriculum.semesters?.some(semester => (
      semester.courses?.some(course => course.code === 'BIO301')
    ))
  ));
  await expect(page.locator('.course_code').filter({ hasText: 'BIO301' })).toHaveCount(1);
  await expect.poll(async () => page.evaluate(async () => {
    const names = await caches.keys();
    return Object.fromEntries(await Promise.all(names.map(async name => {
      const cache = await caches.open(name);
      return [name, (await cache.keys()).map(request => request.url)];
    })));
  })).toMatchObject({
    'surriculum-runtime-v1': expect.arrayContaining([
      expect.stringMatching(/\/courses\/202401\/BIO\.jsonl$/),
      expect.stringMatching(/\/requirements\/202401\.jsonl$/),
    ]),
  });
  const runtimeUrls = await page.evaluate(async () => (
    await (await caches.open('surriculum-runtime-v1')).keys()
  ).map(request => request.url));
  expect(runtimeUrls.filter(url => PDFJS_URLS.includes(url))).toEqual([]);

  const onlineVersion = await page.evaluate(() => window.APP_VERSION);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.locator('.header-title')).toContainText(`SUrriculum v${onlineVersion}`);
  await expect(page.locator('.change_major')).toHaveValue('BIO');
  await expect(page.locator('.course_code').filter({ hasText: 'BIO301' })).toHaveCount(1);
  expect(await page.evaluate(() => ({
    appVersion: window.APP_VERSION,
    course: window.curriculum.semesters?.[0]?.courses?.[0]?.code,
    grade: window.curriculum.semesters?.[0]?.courses?.[0]?.grade,
    major: window.curriculum.major,
    planStorageReady: typeof window.planStorage?.getItem === 'function',
    requirementTotal: window.getRequirementRecord?.('BIO', '202401')?.total,
    sentinel: localStorage.getItem('surriculum.sw-test-sentinel'),
  }))).toEqual({
    appVersion: onlineVersion,
    course: 'BIO301',
    grade: 'A',
    major: 'BIO',
    planStorageReady: true,
    requirementTotal: 127,
    sentinel: 'keep',
  });
  expect(await page.evaluate(async () => {
    const names = await caches.keys();
    const pdfJsCache = await caches.open('surriculum-pdfjs-6.2.108');
    return {
      names,
      pdfJsUrls: (await pdfJsCache.keys()).map(request => request.url),
    };
  })).toEqual({
    names: expect.arrayContaining([PDFJS_CACHE_NAME]),
    pdfJsUrls: PDFJS_URLS,
  });
});

test('upgrading from a legacy worker warms runtime data on the first visit', async ({ page }) => {
  await page.goto(PAGES_URL + 'manifest.json');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('legacy-sw.js?v=legacy-test', { scope: './' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => (
    navigator.serviceWorker.controller?.scriptURL.includes('/legacy-sw.js?v=legacy-test')
  ));

  await page.goto(PAGES_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    navigator.serviceWorker.controller
    && navigator.serviceWorker.controller.scriptURL.includes('/sw.js?v=')
  ));

  await expect.poll(async () => page.evaluate(async () => {
    const runtime = await caches.open('surriculum-runtime-v1');
    const urls = (await runtime.keys()).map(request => request.url);
    return {
      catalog: urls.some(url => /\/courses\/\d{6}\/CS\.jsonl$/.test(url)),
      requirements: urls.some(url => /\/requirements\/\d{6}\.jsonl$/.test(url)),
    };
  })).toEqual({ catalog: true, requirements: true });
});
