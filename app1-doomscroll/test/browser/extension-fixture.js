// Playwright fixtures for the Doomscroll unpacked-extension suite.
//
// - Runs the read-only drift check once per worker. It never runs the build, so
//   a stale or incomplete committed package fails instead of being repaired.
// - Launches the committed app1-doomscroll/ in a fresh persistent Chromium
//   context with only that extension loaded, and derives the extension id from
//   its MV3 service worker.
// - Routes approved fixture URLs to the local feed HTML, lets extension
//   resources through, and aborts every other network request.
// - Collects page errors, service-worker errors, console errors, Doomscroll
//   diagnostics, and blocked requests.
// - Closes the context and deletes the temporary profile on pass or failure,
//   retrying the delete because Windows can hold profile files briefly.
//
// This file is not a test (it does not end in .pw.js); suites import `test`
// and `expect` from here.
import { test as base, expect, chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, '..', '..');
export const REPO_ROOT = path.resolve(APP_ROOT, '..');
const FEED_HTML_PATH = path.join(APP_ROOT, 'test', 'fixtures', 'feed.html');

export const LOG_PREFIX = '[poltergeist:doomscroll]';
/** Approved-host URL served from the local fixture; the production manifest matches it. */
export const FEED_URL = 'https://www.youtube.com/doomscroll-fixture';
/** Unmatched-origin URL served from the same fixture; the manifest must not inject here. */
export const UNMATCHED_URL = 'https://www.example.com/doomscroll-fixture';
/** Every URL the router fulfills with the fixture feed. */
export const FIXTURE_URLS = Object.freeze([FEED_URL, UNMATCHED_URL]);
/** Selector for any artifact created by a skeleton effect. */
export const ARTIFACT_SELECTOR = '[data-poltergeist]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read-only drift + package check. Throws with the checker's output on failure. */
export function runDoomscrollCheck() {
  const script = path.join(REPO_ROOT, 'scripts', 'sync-doomscroll-skeleton.mjs');
  const result = spawnSync(process.execPath, [script, '--check'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `check:doomscroll failed (exit ${result.status}); run "npm run build:doomscroll" and commit the result.\n` +
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

/** Strip query and hash so routing compares only origin + path. */
function baseUrl(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

function createDiagnostics() {
  const diagnostics = {
    /** Uncaught exceptions from pages (`pageerror` / `weberror`). */
    pageErrors: [],
    /** Console errors and uncaught failures reported by the service worker. */
    workerErrors: [],
    /** Console messages carrying the Doomscroll namespace, from any page or worker. */
    namespaced: [],
    /** Other console errors from pages. */
    consoleErrors: [],
    /** Requests the router aborted because they were not expected. */
    blockedRequests: [],

    /** Fails the test if anything unexpected was captured. */
    expectClean() {
      expect.soft(diagnostics.pageErrors, 'page errors').toEqual([]);
      expect.soft(diagnostics.workerErrors, 'service-worker errors').toEqual([]);
      expect.soft(diagnostics.namespaced, 'Doomscroll diagnostics').toEqual([]);
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
  doomscrollCheck: [async ({}, use) => {
    await use(runDoomscrollCheck());
  }, { scope: 'worker', auto: true }],

  diagnostics: async ({}, use) => {
    await use(createDiagnostics());
  },

  // A fresh persistent context per test with only the committed extension loaded.
  context: async ({ headless, viewport, diagnostics, doomscrollCheck }, use) => {
    void doomscrollCheck;
    const feedHtml = await fs.readFile(FEED_HTML_PATH, 'utf8');
    const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doomscroll-pw-'));
    let context;
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chromium',
        headless,
        viewport,
        args: [
          `--disable-extensions-except=${APP_ROOT}`,
          `--load-extension=${APP_ROOT}`,
        ],
      });

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
          return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: feedHtml });
        }
        diagnostics.blockedRequests.push(url);
        return route.abort('blockedbyclient');
      });

      await use(context);
    } finally {
      if (context) {
        try {
          await context.close();
        } catch {
          // Closing an already-crashed browser must not hide the original failure.
        }
      }
      await removeDirWithRetry(profileDir);
    }
  },

  // The extension's MV3 service worker (the module worker background.js).
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers().filter((w) => w.url().startsWith('chrome-extension://'));
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', {
        predicate: (w) => w.url().startsWith('chrome-extension://'),
      });
    }
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const { protocol, host } = new URL(serviceWorker.url());
    if (protocol !== 'chrome-extension:' || !host) throw new Error(`unexpected worker URL ${serviceWorker.url()}`);
    await use(host);
  },

  /** Open a new tab on a fixture URL (default: the approved feed) and wait for load. */
  openFeed: async ({ context }, use) => {
    await use(async (url = FEED_URL) => {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.doomscrollFixture));
      return page;
    });
  },

  /** Resolve a page's tab id through extension APIs (host permission covers fixture URLs). */
  tabIdOf: async ({ serviceWorker }, use) => {
    await use(async (page) => {
      const ids = await serviceWorker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ url });
        return tabs.map((t) => t.id);
      }, baseUrl(page.url()));
      if (ids.length !== 1) throw new Error(`expected one tab for ${page.url()}, found ${ids.length}`);
      return ids[0];
    });
  },

  /** Ping a page's top-frame content script from the worker. Resolves null when nothing answers. */
  pingContent: async ({ serviceWorker, tabIdOf }, use) => {
    await use(async (page) => {
      const tabId = await tabIdOf(page);
      return serviceWorker.evaluate(async (id) => {
        try {
          return (await chrome.tabs.sendMessage(id, { type: 'doomscroll:ping' }, { frameId: 0 })) ?? null;
        } catch {
          return null;
        }
      }, tabId);
    });
  },

  /**
   * Send a production protocol message from an extension-origin control page
   * (popup.html opened as a tab). Pass `foreground` to return that page to the
   * front afterwards so its visible-time meter keeps running.
   */
  sendControl: async ({ context, extensionId }, use) => {
    let control;
    await use(async (message, { foreground } = {}) => {
      if (!control || control.isClosed()) {
        control = await context.newPage();
        await control.goto(`chrome-extension://${extensionId}/popup.html`);
      }
      const reply = await control.evaluate((m) => chrome.runtime.sendMessage(m), message);
      if (foreground) await foreground.bringToFront();
      return reply;
    });
  },
});

export { expect };
