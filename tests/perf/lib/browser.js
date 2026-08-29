'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');

function firstExisting(paths) {
  return paths.filter(Boolean).map((value) => path.resolve(value)).find((value) => fs.existsSync(value)) || null;
}

function installedBrowserCandidates(id) {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const programs = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
    if (id === 'brave') {
      return [local, ...programs].filter(Boolean).map((root) => path.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
    }
    if (id === 'chrome') {
      return [...programs, local].filter(Boolean).map((root) => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  }
  if (process.platform === 'darwin') {
    if (id === 'brave') return ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'];
    if (id === 'chrome') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }
  if (id === 'brave') {
    return ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave'];
  }
  if (id === 'chrome') {
    return ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'];
  }
  return [];
}

/**
 * Resolve a Chromium-family profile without launching it.
 * Supported ids are `chromium` (Playwright), `chrome`, and `brave`.
 */
function resolveBrowserExecutable(options = {}) {
  const id = String(options.browser || options.id || 'chromium').toLowerCase();
  if (!['chromium', 'chrome', 'brave'].includes(id)) {
    throw new Error(`unsupported performance browser: ${id}`);
  }
  if (options.executablePath) {
    const executablePath = path.resolve(options.executablePath);
    if (!fs.existsSync(executablePath)) throw new Error(`browser executable does not exist: ${executablePath}`);
    return { id, executablePath, source: 'explicit' };
  }
  if (id === 'chromium') {
    return { id, executablePath: chromium.executablePath(), source: 'playwright' };
  }
  const executablePath = firstExisting(installedBrowserCandidates(id));
  if (executablePath) return { id, executablePath, source: 'installed' };
  if (id === 'chrome') return { id, channel: 'chrome', source: 'playwright-channel' };
  throw new Error(`could not find ${id}; pass executablePath explicitly`);
}

function makeCleanProfile(prefix = 'surriculum-perf-profile-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function safelyRemoveOwnedProfile(directory) {
  if (!directory) return;
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('surriculum-perf-profile-')) {
    throw new Error(`refusing to remove an unowned browser profile: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Launch an isolated Chromium/Chrome/Brave context and direct CDP sessions.
 *
 * Options: browser, executablePath, headless, viewport, deviceScaleFactor,
 * userDataDir, cleanProfile (default true), args, serviceWorkers, locale.
 * The returned `close()` owns and deletes only profiles it created itself.
 */
async function launchBrowser(options = {}) {
  const resolved = resolveBrowserExecutable(options);
  const ownsProfile = !options.userDataDir;
  const userDataDir = options.userDataDir
    ? path.resolve(options.userDataDir)
    : makeCleanProfile();
  const launchOptions = {
    headless: options.headless !== false,
    viewport: options.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: options.deviceScaleFactor || 1,
    serviceWorkers: options.serviceWorkers || 'allow',
    locale: options.locale || 'en-US',
    colorScheme: options.colorScheme || 'light',
    reducedMotion: options.reducedMotion || 'no-preference',
    acceptDownloads: false,
    args: [
      '--no-first-run',
      '--disable-default-apps',
      '--disable-component-update',
      '--disable-background-networking',
      ...(options.extensions === true ? [] : ['--disable-extensions']),
      ...(options.args || []),
    ],
  };
  if (resolved.executablePath) launchOptions.executablePath = resolved.executablePath;
  if (resolved.channel) launchOptions.channel = resolved.channel;
  if (options.ignoreHTTPSErrors) launchOptions.ignoreHTTPSErrors = true;
  if (options.proxy) launchOptions.proxy = options.proxy;

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (error) {
    if (ownsProfile) safelyRemoveOwnedProfile(userDataDir);
    throw error;
  }

  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  const browser = context.browser();
  let browserCdp = null;
  if (browser && typeof browser.newBrowserCDPSession === 'function') {
    try {
      browserCdp = await browser.newBrowserCDPSession();
    } catch (_) {
      browserCdp = null;
    }
  }
  let closed = false;
  return {
    id: resolved.id,
    resolved,
    userDataDir,
    context,
    page,
    browser,
    cdp,
    browserCdp,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await context.close();
      } finally {
        if (ownsProfile) safelyRemoveOwnedProfile(userDataDir);
      }
    },
  };
}

module.exports = {
  installedBrowserCandidates,
  launchBrowser,
  resolveBrowserExecutable,
};
