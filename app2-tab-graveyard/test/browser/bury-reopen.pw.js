// Bury, Empty graveyard, and Reopen from the popup (graveyard-groups Requirements
// 11.8 and 11.9), in Demo_Mode (Tombstone at 24 s).
//
// Both tests start the same way, each on a fresh profile. A and B are left in the
// background for 26 s while C is in front. popup.html is then opened as an
// ordinary foreground tab (so real Playwright clicks reach it); that briefly
// backgrounds C, which stays far below every dead threshold. The Graveyard must
// list exactly A and B and nothing may close before the click.
//
// `Bury all` moves A and B into the window's Graveyard_Group (titled `Graveyard`,
// grey, collapsed) without closing them: the tab count holds, no Buried_Entry is
// saved, and C and the popup tab stay outside every tab group. `Empty graveyard`
// then saves A and B as Buried_Entries and closes them; `Reopen` on A opens a new
// tab at A's saved URL and removes only A's entry. (The save-before-close order is
// verified in the Unit_Suite.)
//
// Group state is read in the worker with the fixture's `tabInfo`, `groupInfo`, and
// `recordedGroupId` helpers. These run in the default new headless mode: Chromium
// reports group title, colour, and collapsed state there, so no test here runs
// headed. Tab counts come from `chrome.tabs.query({})` in the worker, which needs
// no permission for ids. Closed tabs are confirmed both by Playwright (page
// closed) and by `chrome.tabs.get` rejecting in the worker.
import {
  test, expect, FIXTURE, fixtureTitle,
} from './extension-fixture.js';

// 2 s past the demo Tombstone threshold, measured from the moment B (the later of A and B) leaves.
const LONG_AWAY_MS = 26_000;
const TOMBSTONE_S = 24;
const WAIT_MS = 10_000;
const BURIED_KEY = 'graveyard.buried';
const NO_GROUP = -1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The steps and evidence of Requirement 11.8: A and B dead with C in front, the
 * popup opened as a foreground tab, and a real click on `Bury all (2)` that moves
 * A and B into the Graveyard_Group and closes nothing.
 */
async function buryDeadPair({
  context, serviceWorker, extensionId, openFixture, activate, sendControl, readRecord,
  tabInfo, groupInfo, recordedGroupId,
}) {
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
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
  await popup.bringToFront();
  await expect(popup.locator('#main')).toHaveAttribute('aria-busy', 'false', { timeout: WAIT_MS });
  await expect.poll(tabCount).toBe(countBeforePopup + 1);
  const popupTabId = await popup.evaluate(() => chrome.tabs.getCurrent().then((t) => t.id));

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
  await expect(popup.locator('#empty')).toBeHidden();

  // Listing closes and groups nothing: the count holds and every tab is open and ungrouped.
  await sleep(1_000);
  const countBeforeClick = await tabCount();
  for (const id of [tabA, tabB, tabC, popupTabId]) {
    expect((await tabInfo(id))?.groupId, `tab ${id} open and ungrouped before Bury`).toBe(NO_GROUP);
  }
  expect([a.isClosed(), b.isClosed(), c.isClosed()]).toEqual([false, false, false]);

  // A real Playwright click on Bury all.
  const buryButton = popup.getByRole('button', { name: 'Bury all (2)' });
  await expect(buryButton).toBeEnabled();
  await buryButton.click();

  // Within 10 s, A and B share one group id, which is the one recorded for the window.
  const { windowId } = await tabInfo(tabC);
  await expect.poll(async () => {
    const [infoA, infoB, recorded] = await Promise.all([tabInfo(tabA), tabInfo(tabB), recordedGroupId(windowId)]);
    return infoA !== null && infoB !== null && infoA.groupId !== NO_GROUP
      && infoA.groupId === infoB.groupId && infoA.groupId === recorded;
  }, { timeout: WAIT_MS, intervals: [100] }).toBe(true);
  const groupId = await recordedGroupId(windowId);
  expect(await groupInfo(groupId)).toEqual({ title: 'Graveyard', color: 'grey', collapsed: true, windowId });

  // C and the popup tab stay outside every group; nothing closed; nothing was saved.
  expect((await tabInfo(tabC)).groupId).toBe(NO_GROUP);
  expect((await tabInfo(popupTabId)).groupId).toBe(NO_GROUP);
  expect(await tabCount()).toBe(countBeforeClick);
  for (const id of [tabA, tabB, tabC]) expect(await tabOpen(id), `tab ${id} open after Bury`).toBe(true);
  expect([a.isClosed(), b.isClosed(), c.isClosed()]).toEqual([false, false, false]);
  expect(await storedBuried()).toEqual([]);

  // The popup offers Empty graveyard for the two moved tabs.
  await expect(popup.getByRole('button', { name: 'Bury all (0)' })).toBeDisabled({ timeout: WAIT_MS });
  await expect(popup.getByRole('button', { name: 'Empty graveyard (2)' })).toBeVisible({ timeout: WAIT_MS });
  await expect(popup.locator('#dead-list > li')).toHaveCount(0);
  await expect(popup.locator('#buried-empty')).toBeVisible();
  await expect(popup.locator('#notice')).toBeHidden();

  return { a, b, c, tabA, tabB, tabC, popup, titleA, titleB, tabCount, tabOpen, storedBuried };
}

test('Bury all moves without closing', async ({
  context, serviceWorker, extensionId, openFixture, activate, sendControl, readRecord,
  tabInfo, groupInfo, recordedGroupId, diagnostics,
}) => {
  test.setTimeout(90_000);
  await buryDeadPair({
    context, serviceWorker, extensionId, openFixture, activate, sendControl, readRecord,
    tabInfo, groupInfo, recordedGroupId,
  });
  diagnostics.expectClean();
});

test('Empty graveyard closes and saves', async ({
  context, serviceWorker, extensionId, openFixture, activate, tabIdOf, sendControl, readRecord,
  tabInfo, groupInfo, recordedGroupId, diagnostics,
}) => {
  test.setTimeout(90_000);
  const {
    a, b, c, tabA, tabB, tabC, popup, titleA, titleB, tabCount, tabOpen, storedBuried,
  } = await buryDeadPair({
    context, serviceWorker, extensionId, openFixture, activate, sendControl, readRecord,
    tabInfo, groupInfo, recordedGroupId,
  });
  expect((await tabInfo(tabC)).groupId).toBe(NO_GROUP);
  const countBeforeEmpty = await tabCount();

  // A real Playwright click on Empty graveyard.
  await popup.getByRole('button', { name: 'Empty graveyard (2)' }).click();

  // Within 10 s, exactly A and B close; C stays open.
  await expect.poll(() => a.isClosed() && b.isClosed(), { timeout: WAIT_MS, intervals: [100] }).toBe(true);
  expect(await tabOpen(tabA)).toBe(false);
  expect(await tabOpen(tabB)).toBe(false);
  expect(await tabOpen(tabC)).toBe(true);
  expect(c.isClosed()).toBe(false);
  await expect.poll(tabCount).toBe(countBeforeEmpty - 2);
  const countAfterEmpty = await tabCount();

  // Exactly two Buried_Entries, with A's and B's URLs, in storage and in the popup; Empty is hidden.
  await expect.poll(async () => (await storedBuried()).map((e) => e.url).sort(), { timeout: WAIT_MS })
    .toEqual([FIXTURE.a, FIXTURE.b].sort());
  for (const entry of await storedBuried()) expect(entry.awaySeconds).toBeGreaterThanOrEqual(TOMBSTONE_S);
  await expect(popup.locator('#empty')).toBeHidden({ timeout: WAIT_MS });
  await expect(popup.locator('#buried-list button[data-entry-id]')).toHaveCount(2, { timeout: WAIT_MS });
  await expect(popup.getByRole('button', { name: `Reopen ${titleA}` })).toBeVisible();
  await expect(popup.getByRole('button', { name: `Reopen ${titleB}` })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Bury all (0)' })).toBeDisabled();
  await expect(popup.locator('#notice')).toBeHidden();

  // A real Playwright click on Reopen for A.
  const pagesBefore = new Set(context.pages());
  await popup.getByRole('button', { name: `Reopen ${titleA}` }).click();

  // Within 10 s, a new tab opens at A's saved URL and loads the fixture with the content script.
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
  await expect.poll(tabCount).toBe(countAfterEmpty + 1);

  // Only B's entry is left. The popup is now behind the new tab, so read it without rAF waits.
  await expect.poll(() => popup.evaluate(() =>
    Array.from(document.querySelectorAll('#buried-list button[data-entry-id]'), (btn) => btn.getAttribute('aria-label'))),
  { timeout: WAIT_MS, intervals: [100] }).toEqual([`Reopen ${titleB}`]);
  expect((await storedBuried()).map((e) => e.url)).toEqual([FIXTURE.b]);
  expect(c.isClosed()).toBe(false);

  diagnostics.expectClean();
});
