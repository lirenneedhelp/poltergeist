// Return flows and Resurrect in Demo_Mode (all thresholds are 1/3600 of normal:
// Fog 0.5-2 s, Rot 4-12 s, Tombstone at 24 s). Tabs are switched for real (see
// the header of extension-fixture.js), so the page sees 'hidden' while away and
// the worker sees tabs.onActivated. Evidence is semantic: effect data attributes,
// shadow-root text, fixture text, and the stored Tab_Record.
import {
  test, expect, FIXTURE, ARTIFACT_SELECTOR, fixtureTitle,
} from './extension-fixture.js';

// Absences, measured from the moment A leaves the front.
// SHORT_AWAY_MS: past Fog's full intensity (2 s), 21 s short of the Tombstone (24 s).
// STAY_MS: time spent on A after the short return; decay must hold throughout.
// LONG_AWAY_MS: 2 s past the Tombstone threshold, and under 60 s so the
// duration is worded in seconds.
const SHORT_AWAY_MS = 3_000;
const STAY_MS = 5_000;
const LONG_AWAY_MS = 26_000;
const TOMBSTONE_S = 24;
const SAMPLE_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kinds of every Poltergeist artifact on the page, in document order. */
const artifactKinds = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-poltergeist]'), (el) => el.getAttribute('data-poltergeist')));

/** Bring `other` to the front, keep `page` away for `ms` from the switch, then bring `page` back. */
async function leaveFor(page, other, ms, activate) {
  const left = Date.now();
  await activate(other);
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
  await sleep(Math.max(0, ms - (Date.now() - left)));
  await activate(page);
  return Date.now() - left;
}

test('decay appears on return, stays while in use, and a real Resurrect click clears it exactly', async ({
  openFixture, activate, sendControl, readRecord, diagnostics,
}) => {
  test.setTimeout(90_000);
  const titleA = fixtureTitle(FIXTURE.a);

  const a = await openFixture(FIXTURE.a);
  const tabA = await activate(a);
  expect(await a.title()).toBe(titleA);
  expect(await a.locator(ARTIFACT_SELECTOR).count()).toBe(0);
  const original = await a.evaluate(() => ({
    html: document.documentElement.outerHTML,
    paragraphs: window.graveyardFixture.paragraphs(),
  }));

  // Demo_Mode on through the production protocol; the control page opens in the background.
  expect(await sendControl({ type: 'graveyard:set-demo', enabled: true })).toEqual({ ok: true, demoMode: true });
  const demoState = await sendControl({ type: 'graveyard:popup-state', tabId: tabA });
  expect(demoState).toMatchObject({ ok: true, demoMode: true, current: { known: true, stage: 'alive' } });

  // Opening B in front backgrounds A; B is the tab used to leave A from here on.
  const leftShort = Date.now();
  const b = await openFixture(FIXTURE.b);
  await activate(b);
  await expect.poll(() => a.evaluate(() => document.visibilityState)).toBe('hidden');
  await sleep(Math.max(0, SHORT_AWAY_MS - (Date.now() - leftShort)));
  await activate(a);
  const shortAwayMs = Date.now() - leftShort;
  test.info().annotations.push({ type: 'short absence', description: `${shortAwayMs} ms` });

  // Short return: Fog, no Tombstone.
  await expect.poll(() => artifactKinds(a), { timeout: 5_000, intervals: [100] }).toContain('fog');
  expect(await artifactKinds(a)).not.toContain('tombstone');
  const afterShort = await readRecord(tabA);
  expect(afterShort.leftAt).toBeNull();
  expect(afterShort.demo.heldMs).toBeGreaterThanOrEqual(SHORT_AWAY_MS - 500);
  expect(afterShort.demo.heldMs).toBeLessThan(TOMBSTONE_S * 1000);

  // Stay on A: the decay holds for the whole period and never turns into a Tombstone.
  const stayUntil = Date.now() + STAY_MS;
  while (Date.now() < stayUntil) {
    const kinds = await artifactKinds(a);
    expect(kinds, 'Fog stays while A is in use').toContain('fog');
    expect(kinds).not.toContain('tombstone');
    await sleep(SAMPLE_MS);
  }
  expect(await a.evaluate(() => document.visibilityState)).toBe('visible');

  // Long absence: the Tombstone names A and says how long it was left.
  const longAwayMs = await leaveFor(a, b, LONG_AWAY_MS, activate);
  test.info().annotations.push({ type: 'long absence', description: `${longAwayMs} ms` });
  const tombstone = a.locator('[data-poltergeist="tombstone"]');
  await expect(tombstone).toHaveCount(1, { timeout: 5_000 });
  await expect(tombstone.locator('h1')).toHaveText(`Here lies ${titleA}`);
  const message = tombstone.locator('p');
  await expect(message).toHaveText(/^Abandoned for \d+ seconds\.$/);
  const shownSeconds = Number((await message.textContent()).match(/(\d+) seconds/)[1]);
  expect(shownSeconds).toBeGreaterThanOrEqual(TOMBSTONE_S);
  expect(shownSeconds).toBeLessThanOrEqual(Math.ceil(longAwayMs / 1000) + 1);
  expect(await artifactKinds(a)).toContain('fog');
  const beforeResurrect = await readRecord(tabA);
  expect(beforeResurrect.demo.heldMs).toBeGreaterThanOrEqual(TOMBSTONE_S * 1000);

  // A real Playwright click (trusted event) on the button inside the open shadow root.
  await tombstone.getByRole('button', { name: 'Resurrect' }).click();

  // Every artifact goes, after the configured fades, and the page is exactly as before.
  await expect.poll(() => a.locator(ARTIFACT_SELECTOR).count(), { timeout: 5_000, intervals: [100] }).toBe(0);
  const restored = await a.evaluate(() => ({
    html: document.documentElement.outerHTML,
    paragraphs: window.graveyardFixture.paragraphs(),
  }));
  expect(restored.paragraphs).toEqual(original.paragraphs);
  expect(restored.html).toBe(original.html);

  // The worker's Registers are zero, and A is in use with no Absence.
  const record = await readRecord(tabA);
  expect(record).toMatchObject({ url: FIXTURE.a, title: titleA, leftAt: null, normal: { heldMs: 0 }, demo: { heldMs: 0 } });
  expect(record.since).toBeGreaterThan(beforeResurrect.since);
  const state = await sendControl({ type: 'graveyard:popup-state', tabId: tabA });
  expect(state).toMatchObject({ ok: true, demoMode: true, current: { known: true, stage: 'alive', awaySeconds: 0 } });

  // The decay does not come back while A stays in use.
  await sleep(2_000);
  expect(await a.locator(ARTIFACT_SELECTOR).count()).toBe(0);
  expect(await a.evaluate(() => window.graveyardFixture.paragraphs())).toEqual(original.paragraphs);

  diagnostics.expectClean();
});
