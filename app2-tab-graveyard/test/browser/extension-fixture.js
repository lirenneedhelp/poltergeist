// Playwright fixtures for the Tab Graveyard unpacked-extension suite.
//
// - Runs the read-only `check:graveyard` once per worker. It never runs the build,
//   so a stale or incomplete committed package fails instead of being repaired.
// - Launches Playwright's bundled Chromium (new headless mode unless the project
//   runs headed) on a fresh temporary profile with only the committed
//   app2-tab-graveyard/ loaded, and uses that profile's persistent default
//   context. The extension id comes from its MV3 service worker.
// - Routes the three fixture URLs to the local fixtures/page.html, lets extension
//   resources through, and aborts every other network request.
// - Collects page errors, service-worker console errors, `[poltergeist:graveyard]`
//   diagnostics from any page or worker, other page console errors, and blocked
//   requests.
// - Closes the browser and deletes the temporary profile on pass or failure,
//   retrying the delete because Windows can hold profile files briefly.
//
// Activation (task 7.2, verified by fixture.pw.js). The decay depends on real
// tab switches: the page must report `document.visibilityState === 'hidden'`
// while another tab is in front, and the worker must receive `tabs.onActivated`.
// - With `chromium.launchPersistentContext` (Doomscroll's launch), every page
//   stays 'visible' after another tab comes to the front. This holds in headless
//   and headed runs, and for both `page.bringToFront()` and
//   `chrome.tabs.update(id, {active: true})`. The worker does receive
//   `tabs.onActivated`. The cause is Playwright's per-page focus emulation
//   (`Emulation.setFocusEmulationEnabled`), which keeps each page rendered as if
//   it were in front. So neither switching to `chrome.tabs.update` nor running
//   headed makes background pages hidden.
// - Fix: this fixture starts the bundled Chromium itself with a fresh
//   `--user-data-dir` and attaches with `chromium.connectOverCDP(endpoint,
//   { noDefaults: true })`. `noDefaults` is a documented option that leaves the
//   default (persistent) context without Playwright's overrides, including focus
//   emulation. Background tabs then report 'hidden', the worker sees
//   `tabs.onActivated`, and `page.bringToFront()` activates a tab for real.
// - `activate(page)` uses `page.bringToFront()`. It then waits until the tab is
//   active, the worker has recorded it as its window's active tab (so the
//   onActivated job has finished), and the page reports 'visible'. Pages opened
//   with context.newPage() are tabs in the same window, so opening one
//   backgrounds the tab that was in front.
// - Side effects of `noDefaults`: no viewport emulation (the window size is set
//   with --window-size), no default font or media emulation, and the browser's
//   own download behaviour. None of these matter for this suite.
// - Hidden pages are really hidden, so they get no animation frames: read them
//   with page.evaluate / expect.poll, not rAF-polling waits, until activated.
//
// Control messages: `sendControl` sends production protocol messages from
// popup.html, which the worker accepts as an extension-page sender. The control
// page is opened by the worker as a background tab (`active: false`), so opening
// it never activates a tab and never starts or ends an Absence.
//
// Tab ids: the manifest grants no `tabs` or host permission, so tabs.query cannot
// match by URL. `tabIdOf(page)` finds the Tab_Record whose `url` (taken by the
// worker from MessageSender.url) equals the page URL, which also proves that the
// content script reached the worker.
//
// This file is not a test (it does not end in .pw.js); suites import `test` and
// `expect` from here.
import { test as base, expect, chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, '..', '..');
export const REPO_ROOT = path.resolve(APP_ROOT, '..');
const PAGE_HTML_PATH = path.join(APP_ROOT, 'test', 'fixtures', 'page.html');

export const LOG_PREFIX = '[poltergeist:graveyard]';
/** The fixture URLs; the router serves fixtures/page.html at each, and the Web_Scope matches them. */
export const FIXTURE = Object.freeze({
  a: 'https://graveyard-a.test/page',
  b: 'https://graveyard-b.test/page',
  c: 'https://graveyard-c.test/page',
});
export const FIXTURE_URLS = Object.freeze(Object.values(FIXTURE));
/** Selector for any artifact created by a skeleton effect. */
export const ARTIFACT_SELECTOR = '[data-poltergeist]';
/** Storage keys written by background.js. */
export const TAB_KEY_PREFIX = 'graveyard.tab.';
export const WINDOW_KEY_PREFIX = 'graveyard.window.';
export const GROUP_KEY_PREFIX = 'graveyard.group.';

const WAIT_MS = 10_000;
const LAUNCH_TIMEOUT_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The title fixtures/page.html sets for a fixture URL (host + path). */
export function fixtureTitle(url) {
  const u = new URL(url);
  return `Graveyard fixture ${u.host}${u.pathname}`;
}

/** Read-only drift + package check (`npm run check:graveyard`). Throws with the checker's output on failure. */
export function runGraveyardCheck() {
  const script = path.join(REPO_ROOT, 'scripts', 'sync-skeleton.mjs');
  const result = spawnSync(process.execPath, [script, '--check', '--app', 'graveyard'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `check:graveyard failed (exit ${result.status}); run "npm run build:graveyard" and commit the result.\n` +
      `${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  return result.stdout;
}

/** Delete a directory, retrying while Windows releases file handles. */
export async function removeDirWithRetry(dir, { attempts = 8, delayMs = 250 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      await sleep(delayMs * (i + 1));
    }
  }
  throw new Error(`could not remove temporary profile ${dir}: ${lastError?.message ?? lastError}`);
}

/**
 * Start the bundled Chromium on `profileDir` with only the app loaded, attach
 * Playwright without default overrides (see the header), and return the
 * profile's default context. `run.child` and `run.browser` are set as soon as
 * they exist so `stopChromium(run)` can clean up after a partial launch.
 */
async function startChromium(run, profileDir, { headless, viewport }) {
  const size = viewport ?? { width: 1280, height: 720 };
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--remote-debugging-port=0', // loopback only; the port is read from DevToolsActivePort
    `--user-data-dir=${profileDir}`,
    `--window-size=${size.width},${size.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    // Keeps component extensions (which also run a background.js worker) out of the profile.
    '--disable-component-extensions-with-background-pages',
    // Window occlusion must not hide pages in headed runs; only tab switches do.
    '--disable-backgrounding-occluded-windows',
    '--password-store=basic',
    '--use-mock-keychain',
    `--disable-extensions-except=${APP_ROOT}`,
    `--load-extension=${APP_ROOT}`,
    'about:blank',
  ];
  const child = spawn(chromium.executablePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  run.child = child;
  let stderr = '';
  let spawnError = null;
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  child.once('error', (error) => { spawnError = error; });

  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let endpoint;
  while (!endpoint) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Chromium exited (${child.exitCode ?? child.signalCode}) before DevTools was ready\n${stderr}`);
    }
    try {
      const [port, wsPath] = (await fs.readFile(portFile, 'utf8')).split(/\r?\n/);
      if (/^\d+$/.test(port) && wsPath?.startsWith('/devtools/browser/')) endpoint = `ws://127.0.0.1:${port}${wsPath}`;
    } catch {
      // Not written yet.
    }
    if (!endpoint) {
      if (Date.now() > deadline) throw new Error(`Chromium did not open DevTools within ${LAUNCH_TIMEOUT_MS} ms\n${stderr}`);
      await sleep(50);
    }
  }
  run.browser = await chromium.connectOverCDP(endpoint, { noDefaults: true, timeout: LAUNCH_TIMEOUT_MS });
  const [context] = run.browser.contexts();
  if (!context) throw new Error('connected Chromium has no default context');
  return context;
}

/** Close Chromium gracefully through CDP, kill it if it does not exit, and wait for the process. */
async function stopChromium(run) {
  if (run.browser) {
    try {
      const cdp = await run.browser.newBrowserCDPSession();
      await Promise.race([cdp.send('Browser.close').catch(() => {}), sleep(5_000)]);
    } catch {
      // Already disconnected or crashed; the process check below still runs.
    }
    await run.browser.close().catch(() => {}); // only drops the CDP connection
  }
  const child = run.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const timedOut = await Promise.race([exited.then(() => false), sleep(10_000).then(() => true)]);
  if (timedOut) {
    child.kill();
    await Promise.race([exited, sleep(5_000)]);
  }
}

/** Strip query and hash so routing compares only origin + path. */
function baseUrl(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

function createDiagnostics() {
  const diagnostics = {
    /** Uncaught exceptions from pages. */
    pageErrors: [],
    /** Console errors reported by the service worker (other than namespaced ones). */
    workerErrors: [],
    /** Console messages carrying the `[poltergeist:graveyard]` namespace, from any page or worker. */
    namespaced: [],
    /** Other console errors from pages. */
    consoleErrors: [],
    /** Requests the router aborted because they were not expected. */
    blockedRequests: [],

    /** Fails the test if anything unexpected was captured. */
    expectClean() {
      expect.soft(diagnostics.pageErrors, 'page errors').toEqual([]);
      expect.soft(diagnostics.workerErrors, 'service-worker errors').toEqual([]);
      expect.soft(diagnostics.namespaced, 'Tab Graveyard diagnostics').toEqual([]);
      expect.soft(diagnostics.consoleErrors, 'page console errors').toEqual([]);
      expect(diagnostics.blockedRequests, 'unexpected network requests').toEqual([]);
    },
  };
  return diagnostics;
}

function attachConsole(diagnostics, source, msg, isWorker) {
  const text = msg.text();
  const entry = `${source}: [${msg.type()}] ${text}`;
  if (text.includes(LOG_PREFIX)) diagnostics.namespaced.push(entry);
  else if (msg.type() === 'error') (isWorker ? diagnostics.workerErrors : diagnostics.consoleErrors).push(entry);
}

function watchWorker(diagnostics, worker) {
  worker.on('console', (msg) => attachConsole(diagnostics, `worker ${worker.url()}`, msg, true));
}

function watchPage(diagnostics, page) {
  page.on('pageerror', (error) => diagnostics.pageErrors.push(`${page.url()}: ${error.message}`));
}

export const test = base.extend({
  // Worker-scoped, automatic: every test in this project depends on a current committed mirror.
  graveyardCheck: [async ({}, use) => {
    await use(runGraveyardCheck());
  }, { scope: 'worker', auto: true }],

  diagnostics: async ({}, use) => {
    await use(createDiagnostics());
  },

  // A fresh persistent profile per test with only the committed extension loaded,
  // attached without Playwright's default overrides (see the header).
  context: async ({ headless, viewport, diagnostics, graveyardCheck }, use) => {
    void graveyardCheck;
    const pageHtml = await fs.readFile(PAGE_HTML_PATH, 'utf8');
    const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graveyard-pw-'));
    const run = { child: null, browser: null };
    try {
      const context = await startChromium(run, profileDir, { headless, viewport });

      context.on('console', (msg) => {
        if (msg.worker()) return; // reported by the worker's own listener
        attachConsole(diagnostics, `page ${msg.page()?.url() ?? '?'}`, msg, false);
      });
      context.on('page', (page) => watchPage(diagnostics, page));
      for (const page of context.pages()) watchPage(diagnostics, page);
      context.on('serviceworker', (worker) => watchWorker(diagnostics, worker));
      for (const worker of context.serviceWorkers()) watchWorker(diagnostics, worker);

      const fixtureUrls = new Set(FIXTURE_URLS);
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (url.startsWith('chrome-extension://') || url.startsWith('data:') || url.startsWith('blob:')) {
          return route.continue();
        }
        if (fixtureUrls.has(baseUrl(url))) {
          return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml });
        }
        diagnostics.blockedRequests.push(url);
        return route.abort('blockedbyclient');
      });

      await use(context);
    } finally {
      // Closing an already-crashed browser must not hide the original failure.
      await stopChromium(run).catch(() => {});
      await removeDirWithRetry(profileDir);
    }
  },

  // The extension's MV3 service worker (the module worker background.js).
  serviceWorker: async ({ context }, use) => {
    const isAppWorker = (w) => w.url().startsWith('chrome-extension://') && w.url().endsWith('/background.js');
    let worker = context.serviceWorkers().find(isAppWorker);
    if (!worker) worker = await context.waitForEvent('serviceworker', { predicate: isAppWorker });
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const { protocol, host } = new URL(serviceWorker.url());
    if (protocol !== 'chrome-extension:' || !host) throw new Error(`unexpected worker URL ${serviceWorker.url()}`);
    await use(host);
  },

  /** The raw stored Tab_Record for a tab id, read from storage.session through the worker, or null. */
  readRecord: async ({ serviceWorker }, use) => {
    await use((tabId) => serviceWorker.evaluate(async (key) => {
      const got = await chrome.storage.session.get(key);
      return got[key] ?? null;
    }, `${TAB_KEY_PREFIX}${tabId}`));
  },

  /**
   * A tab's `{windowId, active, pinned, audible, groupId}` from `chrome.tabs.get`
   * in the worker (`groupId` is -1 outside every group), or null if the tab is gone.
   * Only these fields are returned; no URL or title leaves the worker.
   */
  tabInfo: async ({ serviceWorker }, use) => {
    await use((tabId) => serviceWorker.evaluate(async (id) => {
      try {
        const tab = await chrome.tabs.get(id);
        return { windowId: tab.windowId, active: tab.active, pinned: tab.pinned, audible: Boolean(tab.audible), groupId: tab.groupId };
      } catch {
        return null;
      }
    }, tabId));
  },

  /**
   * A tab group's `{title, color, collapsed, windowId}` from `chrome.tabGroups.get`
   * in the worker (which holds the `tabGroups` permission; test-only read), or null
   * if the group does not exist.
   */
  groupInfo: async ({ serviceWorker }, use) => {
    await use((groupId) => serviceWorker.evaluate(async (id) => {
      try {
        const group = await chrome.tabGroups.get(id);
        return { title: group.title, color: group.color, collapsed: group.collapsed, windowId: group.windowId };
      } catch {
        return null;
      }
    }, groupId));
  },

  /** The Graveyard_Group id the worker has recorded for a window (`graveyard.group.<windowId>`), or null. */
  recordedGroupId: async ({ serviceWorker }, use) => {
    await use((windowId) => serviceWorker.evaluate(async (key) => {
      const got = await chrome.storage.session.get(key);
      return got[key] ?? null;
    }, `${GROUP_KEY_PREFIX}${windowId}`));
  },

  /** The toolbar badge text for all windows, from `chrome.action.getBadgeText({})` in the worker. */
  badgeText: async ({ serviceWorker }, use) => {
    await use(() => serviceWorker.evaluate(() => chrome.action.getBadgeText({})));
  },

  /**
   * A page's tab id: the id of the one Tab_Record whose url equals the page URL.
   * Waits for the content script's first report; fails if no or several records match.
   */
  tabIdOf: async ({ serviceWorker }, use) => {
    await use(async (page) => {
      const url = page.url();
      const deadline = Date.now() + WAIT_MS;
      for (;;) {
        const ids = await serviceWorker.evaluate(async ({ url: wanted, prefix }) => {
          const all = await chrome.storage.session.get(null);
          return Object.entries(all)
            .filter(([key, value]) => key.startsWith(prefix) && value?.url === wanted)
            .map(([key]) => Number(key.slice(prefix.length)));
        }, { url, prefix: TAB_KEY_PREFIX });
        if (ids.length === 1) return ids[0];
        if (ids.length > 1) throw new Error(`expected one Tab_Record for ${url}, found ${ids.length}`);
        if (Date.now() > deadline) throw new Error(`no Tab_Record for ${url} after ${WAIT_MS} ms`);
        await sleep(100);
      }
    });
  },

  /** Open a fixture URL in a new foreground tab, wait for load and for its Tab_Record. */
  openFixture: async ({ context, tabIdOf }, use) => {
    await use(async (url) => {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.graveyardFixture), null, { polling: 100 });
      await tabIdOf(page);
      return page;
    });
  },

  /**
   * Make a page's tab the active tab of its window (see the header for why
   * bringToFront is enough), then wait until the worker has processed the
   * activation and the page reports visible. Resolves to the tab id.
   */
  activate: async ({ serviceWorker, tabIdOf }, use) => {
    await use(async (page) => {
      const tabId = await tabIdOf(page);
      await page.bringToFront();
      await expect.poll(() => serviceWorker.evaluate(async ({ id, prefix }) => {
        const tab = await chrome.tabs.get(id);
        if (!tab.active) return 'tab not active';
        const key = `${prefix}${tab.windowId}`;
        const got = await chrome.storage.session.get(key);
        return got[key] === id ? 'recorded' : 'worker has not recorded the activation';
      }, { id: tabId, prefix: WINDOW_KEY_PREFIX }), { timeout: WAIT_MS, intervals: [50] }).toBe('recorded');
      await expect.poll(() => page.evaluate(() => document.visibilityState), { timeout: WAIT_MS, intervals: [50] }).toBe('visible');
      return tabId;
    });
  },

  /**
   * Send a production protocol message from an extension-origin control page
   * (popup.html), opened once per test as a background tab so it never changes
   * which tab is active. Resolves to the worker's reply.
   */
  sendControl: async ({ context, serviceWorker, extensionId }, use) => {
    const controlUrl = `chrome-extension://${extensionId}/popup.html`;
    let control;
    await use(async (message) => {
      if (!control || control.isClosed()) {
        const before = new Set(context.pages());
        await serviceWorker.evaluate((url) => chrome.tabs.create({ url, active: false }).then(() => undefined), controlUrl);
        const deadline = Date.now() + WAIT_MS;
        for (;;) {
          control = context.pages().find((p) => !before.has(p) && p.url() === controlUrl);
          if (control) break;
          if (Date.now() > deadline) throw new Error(`control page ${controlUrl} did not open`);
          await sleep(50);
        }
        await control.waitForLoadState('load');
      }
      return control.evaluate((m) => chrome.runtime.sendMessage(m), message);
    });
  },
});

export { expect };
