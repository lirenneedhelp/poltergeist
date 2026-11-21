// Bury and Reopen from the popup (Requirements 7.15, 10.9), in Demo_Mode
// (Tombstone at 24 s).
//
// A and B are left in the background for 26 s while C is in front. popup.html is
// then opened as an ordinary foreground tab (so real Playwright clicks reach it);
// that briefly backgrounds C, which stays far below every dead threshold. The
// Graveyard must list exactly A and B and nothing may close before the click.
// `Bury all` closes exactly A and B and lists them as Buried_Entries; `Reopen` on
// A opens a new tab at A's saved URL and removes only A's entry.
//
// Tab counts come from `chrome.tabs.query({})` in the worker, which needs no
// permission for ids. Closed tabs are confirmed both by Playwright (page closed)
// and by `chrome.tabs.get` rejecting in the worker.
import {
  test, expect, FIXTURE, fixtureTitle,
} from './extension-fixture.js';

// 2 s past the demo Tombstone threshold, measured from the moment B (the later of A and B) leaves.
const LONG_AWAY_MS = 26_000;
const TOMBSTONE_S = 24;
const WAIT_MS = 10_000;
const BURIED_KEY = 'graveyard.buried';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Bury all closes exactly the dead tabs, and Reopen restores one at its saved URL', async ({
  context, serviceWorker, extensionId, openFixture, activate, tabIdOf, sendControl, readRecord, diagnostics,
}) => {
  test.setTimeout(90_000);
  const titleA = fixtureTitle(FIXTURE.a);
  const titleB = fixtureTitle(FIXTURE.b);

  const tabCount = () => serviceWorker.evaluate(async () => (await chrome.tabs.query({})).length);
  const tabOpen = (id) => serviceWorker.evaluate((tabId) => chrome.tabs.get(tabId).then(() => true, () => false), id);
  const storedBuried = () => serviceWorker.evaluate(async (key) => (await chrome.storage.local.get(key))[key] ?? [], BURIED_KEY);

  // Demo_Mode goes on while A is in front, so A's and B's demo absences start only when they leave.
  const a = await openFixture(FIXTURE.a);
  const tabA = await activate(a);
  expect(await sendControl({ type: 'graveyard:set-demo', enabled: true })).toEqual({ ok: true, demoMode: true });

  const b = await openFixture(FIXTURE.b);
  const tabB = await activate(b);
  await expect.poll(() => a.evaluate(() => document.visibilityState)).toBe('hidden');

  // C comes to the front and stays there; B's Absence starts now, A's started earlier.
  const left = Date.now();
  const c = await openFixture(FIXTURE.c);
  const tabC = await activate(c);
  await expect.poll(() => b.evaluate(() => document.visibilityState)).toBe('hidden');
  await expect.poll(async () => typeof (await readRecord(tabA))?.leftAt).toBe('number');
  await expect.poll(async () => typeof (await readRecord(tabB))?.leftAt).toBe('number');
  expect((await readRecord(tabC)).leftAt).toBeNull();
  await sleep(Math.max(0, LONG_AWAY_MS - (Date.now() - left)));
  test.info().annotations.push({ type: 'absence of B', description: `${Date.now() - left} ms` });

  // Open the popup as a page in front of C.
  const countBeforePopup = await tabCount();
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const popup = await context.newPage();
  await popup.goto(popupUrl, { waitUntil: 'load' });
  await popup.bringToFront();
  await expect(popup.locator('#main')).toHaveAttribute('aria-busy', 'false', { timeout: WAIT_MS });
  await expect.poll(tabCount).toBe(countBeforePopup + 1);
  const countListed = await tabCount();

  // The Graveyard lists exactly A and B, each abandoned at least the Tombstone threshold.
  const deadRows = popup.locator('#dead-list > li');
  await expect(deadRows).toHaveCount(2);
  const listed = await deadRows.evaluateAll((rows) => rows.map((row) => ({
    tabId: Number(row.dataset.tabId),
    title: row.querySelector('.row-title')?.textContent,
    host: row.querySelector('.row-host')?.textContent,
  })));
  expect(listed.map((r) => r.tabId).sort((x, y) => x - y)).toEqual([tabA, tabB].sort((x, y) => x - y));
  expect(listed).toEqual(expect.arrayContaining([
    { tabId: tabA, title: titleA, host: new URL(FIXTURE.a).host },
    { tabId: tabB, title: titleB, host: new URL(FIXTURE.b).host },
  ]));
  const state = await sendControl({ type: 'graveyard:popup-state', tabId: tabC });
  expect(state.ok).toBe(true);
  expect(state.dead.map((d) => d.tabId).sort((x, y) => x - y)).toEqual([tabA, tabB].sort((x, y) => x - y));
  for (const row of state.dead) expect(row.awaySeconds).toBeGreaterThanOrEqual(TOMBSTONE_S);
  expect(state.buried).toEqual([]);
  await expect(popup.locator('#buried-empty')).toBeVisible();

  // Listing closes nothing: the count holds and A, B, and C are all still open.
  await sleep(1_000);
  expect(await tabCount()).toBe(countListed);
  for (const id of [tabA, tabB, tabC]) expect(await tabOpen(id), `tab ${id} open before Bury`).toBe(true);
  expect([a.isClosed(), b.isClosed(), c.isClosed()]).toEqual([false, false, false]);

  // A real Playwright click on Bury all.
  const buryButton = popup.getByRole('button', { name: 'Bury all (2)' });
  await expect(buryButton).toBeEnabled();
  await buryButton.click();

  // Exactly A and B close; C stays open.
  await expect.poll(() => a.isClosed() && b.isClosed(), { timeout: WAIT_MS, intervals: [100] }).toBe(true);
  expect(await tabOpen(tabA)).toBe(false);
  expect(await tabOpen(tabB)).toBe(false);
  expect(await tabOpen(tabC)).toBe(true);
  expect(c.isClosed()).toBe(false);
  await expect.poll(tabCount).toBe(countListed - 2);
  const countAfterBury = await tabCount();

  // Two Buried_Entries, in storage and in the popup; the Graveyard is empty.
  const entries = await storedBuried();
  expect(entries).toHaveLength(2);
  expect(entries.map((e) => e.url).sort()).toEqual([FIXTURE.a, FIXTURE.b].sort());
  for (const entry of entries) expect(entry.awaySeconds).toBeGreaterThanOrEqual(TOMBSTONE_S);
  const reopenButtons = popup.locator('#buried-list button[data-entry-id]');
  await expect(reopenButtons).toHaveCount(2, { timeout: WAIT_MS });
  await expect(popup.getByRole('button', { name: `Reopen ${titleA}` })).toBeVisible();
  await expect(popup.getByRole('button', { name: `Reopen ${titleB}` })).toBeVisible();
  await expect(popup.locator('#dead-list > li')).toHaveCount(0);
  await expect(popup.getByRole('button', { name: 'Bury all (0)' })).toBeDisabled();
  await expect(popup.locator('#notice')).toBeHidden();

  // A real Playwright click on Reopen for A.
  const pagesBefore = new Set(context.pages());
  await popup.getByRole('button', { name: `Reopen ${titleA}` }).click();

  // A new tab opens at A's saved URL and loads the fixture with the content script.
  let reopened = null;
  await expect.poll(() => {
    reopened = context.pages().find((p) => !pagesBefore.has(p) && p.url() === FIXTURE.a) ?? null;
    return reopened !== null;
  }, { timeout: WAIT_MS, intervals: [100] }).toBe(true);
  await reopened.waitForLoadState('load');
  expect(await reopened.title()).toBe(titleA);
  const reopenedId = await tabIdOf(reopened);
  expect(reopenedId).not.toBe(tabA);
  expect(await tabOpen(reopenedId)).toBe(true);
  await expect.poll(tabCount).toBe(countAfterBury + 1);

  // A's entry disappears; B's stays. The popup is now behind the new tab, so read it without rAF waits.
  await expect.poll(() => popup.evaluate(() =>
    Array.from(document.querySelectorAll('#buried-list button[data-entry-id]'), (btn) => btn.getAttribute('aria-label'))),
  { timeout: WAIT_MS, intervals: [100] }).toEqual([`Reopen ${titleB}`]);
  const remaining = await storedBuried();
  expect(remaining.map((e) => e.url)).toEqual([FIXTURE.b]);
  expect(c.isClosed()).toBe(false);

  diagnostics.expectClean();
});
