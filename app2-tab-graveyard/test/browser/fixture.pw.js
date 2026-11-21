// Smoke checks for the Tab Graveyard unpacked-extension fixture, including the
// activation behaviour the return-flow suites rely on (see the header of
// extension-fixture.js). The timed flows build on these fixtures in their own suites.
import {
  test, expect, FIXTURE, FIXTURE_URLS, ARTIFACT_SELECTOR, fixtureTitle,
} from './extension-fixture.js';

const visibility = (page) => page.evaluate(() => document.visibilityState);

test('loads the committed extension and serves every fixture URL from the local page', async ({
  serviceWorker, extensionId, openFixture, tabIdOf, readRecord, diagnostics,
}) => {
  // Extension id comes from the MV3 module worker URL.
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  expect(serviceWorker.url()).toBe(`chrome-extension://${extensionId}/background.js`);

  const ids = new Set();
  for (const url of FIXTURE_URLS) {
    const page = await openFixture(url);
    // The fixture URL is preserved while its document comes from fixtures/page.html.
    expect(page.url()).toBe(url);
    expect(await page.title()).toBe(fixtureTitle(url));
    const paragraphs = await page.evaluate(() => window.graveyardFixture.paragraphs());
    expect(paragraphs.length).toBeGreaterThanOrEqual(5);
    for (const p of paragraphs.slice(1)) expect(p.text.length).toBeGreaterThan(200);

    // The page loads nothing beyond its own document (extension modules are the content script's).
    const external = await page.evaluate(() => performance.getEntriesByType('resource')
      .map((e) => e.name).filter((n) => !n.startsWith('chrome-extension://')));
    expect(external).toEqual([]);

    // The content script reached the worker: the Tab_Record carries sender.url and the page title.
    const tabId = await tabIdOf(page);
    ids.add(tabId);
    expect(await readRecord(tabId)).toMatchObject({ url, title: fixtureTitle(url) });

    // Normal mode starts clean.
    expect(await page.locator(ARTIFACT_SELECTOR).count()).toBe(0);
  }
  expect(ids.size).toBe(FIXTURE_URLS.length);

  diagnostics.expectClean();
});

test('aborts unexpected network access', async ({ openFixture, diagnostics }) => {
  const page = await openFixture(FIXTURE.a);
  const outcome = await page.evaluate(() =>
    fetch('https://unexpected.example.org/tracker.js').then(() => 'loaded', () => 'blocked'));
  expect(outcome).toBe('blocked');
  expect(diagnostics.blockedRequests).toEqual(['https://unexpected.example.org/tracker.js']);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.namespaced).toEqual([]);
});

test('a backgrounded fixture tab is hidden and the worker sees tabs.onActivated', async ({
  serviceWorker, openFixture, tabIdOf, readRecord, activate, sendControl, diagnostics,
}) => {
  // Test-only observer of the real event, beside the production listener.
  await serviceWorker.evaluate(() => {
    globalThis.probeActivations = [];
    chrome.tabs.onActivated.addListener((info) => globalThis.probeActivations.push(info.tabId));
  });
  const activations = () => serviceWorker.evaluate(() => globalThis.probeActivations.slice());

  const a = await openFixture(FIXTURE.a);
  const tabA = await tabIdOf(a);
  expect(await visibility(a)).toBe('visible');

  // Opening B in front backgrounds A in the same window.
  const b = await openFixture(FIXTURE.b);
  const tabB = await tabIdOf(b);
  const windows = await serviceWorker.evaluate(async (ids) => Promise.all(ids.map(async (id) => (await chrome.tabs.get(id)).windowId)), [tabA, tabB]);
  expect(windows[0]).toBe(windows[1]);
  expect(await visibility(b)).toBe('visible');
  await expect.poll(() => visibility(a)).toBe('hidden');
  expect(await a.evaluate(() => window.graveyardFixture.visibilityLog())).toEqual(['visible', 'hidden']);
  expect(await activations()).toContain(tabB);
  // The production onActivated handler started A's Absence (the tabs.get guard saw A inactive).
  await expect.poll(async () => typeof (await readRecord(tabA))?.leftAt).toBe('number');

  // activate(A) brings A back: A visible, B hidden, A's Absence completed, B's started.
  expect(await activate(a)).toBe(tabA);
  expect(await visibility(a)).toBe('visible');
  await expect.poll(() => visibility(b)).toBe('hidden');
  expect((await activations()).at(-1)).toBe(tabA);
  const recordA = await readRecord(tabA);
  expect(recordA.leftAt).toBeNull();
  expect(recordA.normal.heldMs).toBeGreaterThan(0);
  expect(typeof (await readRecord(tabB)).leftAt).toBe('number');

  // A control message goes through a background extension page and changes no activation.
  const before = (await activations()).length;
  const state = await sendControl({ type: 'graveyard:popup-state', tabId: tabA });
  expect(state).toMatchObject({ ok: true, demoMode: false, current: { known: true, stage: 'alive' } });
  expect(await visibility(a)).toBe('visible');
  expect((await activations()).length).toBe(before);
  expect((await readRecord(tabA)).leftAt).toBeNull();

  diagnostics.expectClean();
});
