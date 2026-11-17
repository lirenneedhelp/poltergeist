// Smoke checks for the unpacked-extension fixture. The timed haunt and the
// pause/resume scenarios build on these fixtures in their own suites.
import { test, expect, FEED_URL, ARTIFACT_SELECTOR } from './extension-fixture.js';

test('loads the committed extension and injects into the routed approved feed', async ({
  serviceWorker, extensionId, openFeed, pingContent, sendControl, tabIdOf, diagnostics,
}) => {
  // Extension id comes from the MV3 module worker URL.
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  expect(serviceWorker.url()).toBe(`chrome-extension://${extensionId}/background.js`);

  // The approved URL is preserved while its document comes from the local fixture.
  const feed = await openFeed();
  expect(feed.url()).toBe(FEED_URL);
  const posts = await feed.evaluate(() => window.doomscrollFixture.posts());
  expect(posts.map((p) => p.id)).toEqual(['post-1', 'post-2', 'post-3', 'post-4', 'post-5', 'post-6']);

  // The manifest-declared classic content script answers the production ping.
  await expect.poll(() => pingContent(feed), { timeout: 10_000 }).toEqual({ ok: true });

  // The production popup-state protocol reports a supported, unpaused, normal tab.
  const tabId = await tabIdOf(feed);
  const state = await sendControl({ type: 'doomscroll:popup-state', tabId }, { foreground: feed });
  expect(state).toEqual({ ok: true, supported: true, paused: false, demoMode: false });

  // Normal mode starts clean: no effect artifacts and unchanged text.
  expect(await feed.locator(ARTIFACT_SELECTOR).count()).toBe(0);
  expect(await feed.evaluate(() => window.doomscrollFixture.posts())).toEqual(posts);

  // The fixture API appends deterministic, uniquely identified posts.
  const id = await feed.evaluate(() => window.doomscrollFixture.appendPost());
  expect(id).toBe('appended-7');
  const appended = (await feed.evaluate(() => window.doomscrollFixture.posts())).at(-1);
  expect(appended.id).toBe('appended-7');
  expect(appended.body.length).toBeGreaterThan(150);

  diagnostics.expectClean();
});

test('aborts unexpected network access', async ({ openFeed, diagnostics }) => {
  const feed = await openFeed();
  const outcome = await feed.evaluate(() =>
    fetch('https://unexpected.example.org/tracker.js').then(() => 'loaded', () => 'blocked'));
  expect(outcome).toBe('blocked');
  expect(diagnostics.blockedRequests).toEqual(['https://unexpected.example.org/tracker.js']);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.namespaced).toEqual([]);
});
