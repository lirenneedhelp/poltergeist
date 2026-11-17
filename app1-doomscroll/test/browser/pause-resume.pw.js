// Pause, resume, exact restoration, and unmatched-host exclusion through the
// production protocol (extension-origin control page -> service worker -> tab).
// Context and profile cleanup happen in the shared fixture teardown.
import { test, expect, ARTIFACT_SELECTOR, UNMATCHED_URL } from './extension-fixture.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bodyOf = (page, id) =>
  page.evaluate((pid) => document.getElementById(pid).querySelector('p').textContent, id);

/** Saved strings (title, body, header) for every post plus the header. */
const strings = (page) => page.evaluate(() => ({
  posts: window.doomscrollFixture.posts(),
  header: window.doomscrollFixture.headerText(),
}));

test('pause restores everything exactly, resume restarts one sequence, unmatched host stays clean', async ({
  openFeed, pingContent, sendControl, tabIdOf, serviceWorker, diagnostics,
}) => {
  test.setTimeout(90_000);
  const feed = await openFeed();
  await expect.poll(() => pingContent(feed), { timeout: 10_000 }).toEqual({ ok: true });
  const tabId = await tabIdOf(feed);

  const original = await strings(feed);
  const savedBodies = Object.fromEntries(original.posts.map((p) => [p.id, p.body]));

  // Demo_Mode on, feed kept visible.
  expect(await sendControl({ type: 'doomscroll:set-demo', enabled: true }, { foreground: feed }))
    .toMatchObject({ ok: true });

  // Wait until Rot is active (some original post changed), then add a post and wait for it to rot.
  await expect
    .poll(async () => (await strings(feed)).posts.some((p) => p.body !== savedBodies[p.id]),
      { timeout: 30_000, intervals: [100] })
    .toBe(true);
  const rotId = await feed.evaluate(() => window.doomscrollFixture.appendPost({ id: 'added-before-pause' }));
  const rotSaved = await bodyOf(feed, rotId);
  savedBodies[rotId] = rotSaved;
  await expect.poll(() => bodyOf(feed, rotId), { timeout: 8_000, intervals: [100] }).not.toBe(rotSaved);
  expect(await feed.locator(ARTIFACT_SELECTOR).count()).toBeGreaterThan(0);

  // Pause through the production protocol; the control page takes the foreground.
  const paused = await sendControl({ type: 'doomscroll:set-paused', tabId, paused: true });
  expect(paused).toEqual({ ok: true, paused: true, delivered: true });

  // All overlays disappear and every retained string is restored exactly.
  await expect(feed.locator(ARTIFACT_SELECTOR)).toHaveCount(0);
  const restored = await strings(feed);
  expect(restored.header).toBe(original.header);
  for (const p of restored.posts) {
    expect(p.body, `body of ${p.id}`).toBe(savedBodies[p.id]);
  }
  for (const p of original.posts) {
    expect(restored.posts.find((r) => r.id === p.id)).toEqual(p);
  }
  expect(restored.posts.map((p) => p.id)).toEqual([...original.posts.map((p) => p.id), rotId]);

  // A post appended while paused stays unchanged.
  const pausedId = await feed.evaluate(() => window.doomscrollFixture.appendPost({ id: 'added-while-paused' }));
  const pausedSaved = await bodyOf(feed, pausedId);
  await sleep(2_500);
  expect(await bodyOf(feed, pausedId)).toBe(pausedSaved);
  expect(await feed.locator(ARTIFACT_SELECTOR).count()).toBe(0);
  expect(await sendControl({ type: 'doomscroll:popup-state', tabId }))
    .toEqual({ ok: true, supported: true, paused: true, demoMode: true });

  // Resume through the same protocol; Demo_Mode is still enabled, keep the feed visible.
  const resumed = await sendControl({ type: 'doomscroll:set-paused', tabId, paused: false }, { foreground: feed });
  expect(resumed).toEqual({ ok: true, paused: false, delivered: true });
  expect(await sendControl({ type: 'doomscroll:popup-state', tabId }, { foreground: feed }))
    .toEqual({ ok: true, supported: true, paused: false, demoMode: true });

  // One active sequence: the haunt returns, with at most one artifact per kind.
  await expect
    .poll(() => feed.locator(ARTIFACT_SELECTOR).count(), { timeout: 20_000, intervals: [100] })
    .toBeGreaterThan(0);
  const kinds = await feed.evaluate(() =>
    Array.from(document.querySelectorAll('[data-poltergeist]'), (el) => el.getAttribute('data-poltergeist')));
  // Flicker owns two nodes (style + overlay); every other kind owns one.
  const counts = {};
  for (const k of kinds) counts[k] = (counts[k] ?? 0) + 1;
  for (const [k, n] of Object.entries(counts)) {
    expect(n, `artifact count for ${k}`).toBeLessThanOrEqual(k === 'flicker' ? 2 : 1);
  }

  // Later eligible appended text is processed again once Rot is active.
  await expect
    .poll(async () => (await strings(feed)).posts.some((p) => savedBodies[p.id] !== undefined && p.body !== savedBodies[p.id]),
      { timeout: 30_000, intervals: [100] })
    .toBe(true);
  const laterId = await feed.evaluate(() => window.doomscrollFixture.appendPost({ id: 'added-after-resume' }));
  const laterSaved = await bodyOf(feed, laterId);
  await expect.poll(() => bodyOf(feed, laterId), { timeout: 8_000, intervals: [100] }).not.toBe(laterSaved);

  // Unmatched routed origin: no content script, no skeleton import, no Poltergeist DOM.
  const other = await openFeed(UNMATCHED_URL);
  await sleep(1_500);
  // No host permission for this origin, so its URL is hidden from tabs.query; find the tab by focus.
  await other.bringToFront();
  const otherTabId = await serviceWorker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
  expect(Number.isInteger(otherTabId)).toBe(true);
  expect(otherTabId).not.toBe(tabId);
  const pong = await serviceWorker.evaluate(async (id) => {
    try { return (await chrome.tabs.sendMessage(id, { type: 'doomscroll:ping' }, { frameId: 0 })) ?? null; } catch { return null; }
  }, otherTabId);
  expect(pong).toBeNull();
  const probe = await other.evaluate(() => ({
    artifacts: document.querySelectorAll('[data-poltergeist]').length,
    marked: Array.from(document.querySelectorAll('*'))
      .filter((el) => Array.from(el.attributes).some((a) => /poltergeist/i.test(a.name) || /poltergeist/i.test(a.value))).length,
    imports: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.startsWith('chrome-extension://')),
  }));
  expect(probe).toEqual({ artifacts: 0, marked: 0, imports: [] });
  const otherState = await sendControl({ type: 'doomscroll:popup-state', tabId: otherTabId });
  expect(otherState).toMatchObject({ ok: true, supported: false });
  expect((await strings(other)).posts).toEqual(original.posts);

  diagnostics.expectClean();
});
