// Decay survives a discard (Requirements 5.6, 6.6, 10.9), in Demo_Mode
// (Tombstone at 24 s).
//
// Path used: real discard. The test calls `chrome.tabs.discard` from the
// extension's service worker while A is in the background, and requires the
// returned Tab, and `tabs.get` on its id, to report `discarded: true`. It never
// falls back to a background reload. Discard is test-only driving. The app
// itself never calls it, and the manifest keeps `permissions: ["storage", "tabGroups"]`
// because `tabs.discard` needs no permission.
//
// Discarding destroys A's renderer, so every bit of in-page state (the meter, the
// Poltergeist instance, the main-world marker this test sets) is lost. Chrome
// may give the discarded tab a new id, reported through `tabs.onReplaced`
// (Playwright's bundled Chromium kept the id in every run so far; the test
// records which case ran as a `discard` annotation and handles both). The
// test takes the id from the Tab that `discard` returns, activates that tab with
// `chrome.tabs.update(id, {active: true})` (the old Playwright page object may
// already be closed), and then finds the reloaded document by its URL among the
// open pages, not through the old page object. The Tombstone it shows can only
// come from the Activity_Tracker's stored record, seeded through
// `graveyard:content-state`.
import {
  test, expect, FIXTURE, WINDOW_KEY_PREFIX, fixtureTitle,
} from './extension-fixture.js';

// 2 s past the demo Tombstone threshold. Demo_Mode shows the duration in demo time: each second away reads as one hour.
const LONG_AWAY_MS = 26_000;
const TOMBSTONE_S = 24;
const WAIT_MS = 10_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The open page showing `url` whose document was loaded after the discard (no marker). */
async function findReloadedPage(context, url) {
  for (const page of context.pages()) {
    if (page.isClosed() || page.url() !== url) continue;
    const fresh = await page.evaluate(() => Boolean(window.graveyardFixture) && window.graveyardDiscardMarker === undefined)
      .catch(() => false); // a page torn down by the discard can fail to evaluate
    if (fresh) return page;
  }
  return null;
}

test('a discarded tab shows the Tombstone for its full absence after it reloads', async ({
  context, serviceWorker, openFixture, activate, tabIdOf, sendControl, readRecord, diagnostics,
}) => {
  test.setTimeout(90_000);
  const titleA = fixtureTitle(FIXTURE.a);

  const a = await openFixture(FIXTURE.a);
  const tabA = await activate(a);
  expect(await sendControl({ type: 'graveyard:set-demo', enabled: true })).toEqual({ ok: true, demoMode: true });

  // In-page state that a discard must wipe out.
  await a.evaluate(() => { window.graveyardDiscardMarker = 'before discard'; });

  // Leave A: B comes to the front, A is hidden, the worker starts A's Absence.
  const left = Date.now();
  const b = await openFixture(FIXTURE.b);
  await activate(b);
  await expect.poll(() => a.evaluate(() => document.visibilityState)).toBe('hidden');
  await expect.poll(async () => typeof (await readRecord(tabA))?.leftAt).toBe('number');
  await sleep(Math.max(0, LONG_AWAY_MS - (Date.now() - left)));

  // Discard A from the worker and confirm Chrome reports it discarded.
  const discarded = await serviceWorker.evaluate(async (id) => {
    const tab = await chrome.tabs.discard(id);
    return tab ? { id: tab.id, discarded: tab.discarded, active: tab.active } : null;
  }, tabA);
  expect(discarded, 'chrome.tabs.discard returned a Tab').not.toBeNull();
  expect(discarded).toMatchObject({ discarded: true, active: false });
  const discardedId = discarded.id;
  expect(await serviceWorker.evaluate(async (id) => (await chrome.tabs.get(id)).discarded, discardedId)).toBe(true);
  test.info().annotations.push({
    type: 'discard',
    description: discardedId === tabA ? `tab id kept (${tabA})` : `tab id replaced ${tabA} -> ${discardedId}`,
  });

  // The Activity_Tracker's record follows the tab (moved by onReplaced if the id changed), Absence still open.
  await expect.poll(async () => (await readRecord(discardedId))?.url, { timeout: WAIT_MS }).toBe(FIXTURE.a);
  expect(typeof (await readRecord(discardedId)).leftAt).toBe('number');
  if (discardedId !== tabA) expect(await readRecord(tabA)).toBeNull();

  // Return to A. Activating a discarded tab reloads it.
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }).then(() => undefined), discardedId);
  const awayMs = Date.now() - left;
  test.info().annotations.push({ type: 'absence', description: `${awayMs} ms` });

  let reloaded = null;
  await expect.poll(async () => {
    reloaded = await findReloadedPage(context, FIXTURE.a);
    return reloaded !== null;
  }, { timeout: WAIT_MS, intervals: [100] }).toBe(true);
  await expect.poll(() => reloaded.evaluate(() => document.visibilityState), { timeout: WAIT_MS }).toBe('visible');
  // A fresh document: no marker, and its visibility history starts in the foreground.
  expect(await reloaded.evaluate(() => window.graveyardDiscardMarker)).toBeUndefined();
  expect((await reloaded.evaluate(() => window.graveyardFixture.visibilityLog()))[0]).toBe('visible');
  expect(await reloaded.title()).toBe(titleA);

  // The worker processed the activation for A's current id, and the reloaded page reports from that id.
  const finalId = await tabIdOf(reloaded);
  await expect.poll(() => serviceWorker.evaluate(async ({ id, prefix }) => {
    const tab = await chrome.tabs.get(id);
    const key = `${prefix}${tab.windowId}`;
    return { active: tab.active, discarded: tab.discarded, recorded: (await chrome.storage.session.get(key))[key] === id };
  }, { id: finalId, prefix: WINDOW_KEY_PREFIX }), { timeout: WAIT_MS }).toEqual({ active: true, discarded: false, recorded: true });

  // The Tombstone appears for the full Away_Time, although all in-page state was lost.
  const tombstone = reloaded.locator('[data-poltergeist="tombstone"]');
  await expect(tombstone).toHaveCount(1, { timeout: WAIT_MS });
  await expect(tombstone.locator('h1')).toHaveText(`Here lies ${titleA}`);
  const message = tombstone.locator('p');
  await expect(message).toHaveText(/^Abandoned for \d+ (?:hours|days) \(demo time\)\.$/);
  const [, shownCount, shownUnit] = (await message.textContent())
    .match(/^Abandoned for (\d+) (hours|days) \(demo time\)\.$/);
  const upper = Math.ceil((Date.now() - left) / 1000) + 1;
  if (shownUnit === 'hours') {
    expect(Number(shownCount)).toBeGreaterThanOrEqual(TOMBSTONE_S);
    expect(Number(shownCount)).toBeLessThanOrEqual(upper);
  } else {
    expect(upper, 'days only once the absence reaches 48 s').toBeGreaterThanOrEqual(48);
    expect(Number(shownCount)).toBeGreaterThanOrEqual(2);
    expect(Number(shownCount)).toBeLessThanOrEqual(Math.floor(upper / 24));
  }

  const record = await readRecord(finalId);
  expect(record).toMatchObject({ url: FIXTURE.a, title: titleA, leftAt: null });
  expect(record.demo.heldMs).toBeGreaterThanOrEqual(TOMBSTONE_S * 1000);
  const state = await sendControl({ type: 'graveyard:popup-state', tabId: finalId });
  expect(state).toMatchObject({ ok: true, demoMode: true, current: { known: true, stage: 'dead' } });

  diagnostics.expectClean();
});
