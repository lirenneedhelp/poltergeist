// Graveyard_Group, exemption, and badge flows in Demo_Mode (Tombstone at 24 s),
// graveyard-groups Requirements 11.10, 11.11, and 11.12. Each test runs on a fresh
// profile (see extension-fixture.js) with a 90 s timeout and ends with
// `diagnostics.expectClean()`.
//
// - "Resurrect ungroups": A dies, is moved into the window's Graveyard_Group with
//   `graveyard:bury` from the control page, and is then activated (Chrome expands the
//   group). A trusted click on the Tombstone's `Resurrect` button must take A out of
//   every tab group, clear the page, and zero both Registers.
// - "Pinned and audible tabs are exempt": A is pinned from the worker while in front;
//   B is made audible while in front by a Web Audio oscillator started from a trusted
//   click (Chrome's autoplay policy needs that user activation). Both are then left
//   for at least 26 s with C in front. Neither may count, be listed, decay, or start
//   an Absence. A sampler reads `pinned` for A and `audible` for B every 1 s from the
//   moment each tab leaves the front until the last assertion.
// - "Badge counts dead tabs": the badge is read with `chrome.action.getBadgeText` in
//   the worker. It must turn to `2` on its own (the content scripts' death watch
//   reports each death while hidden), with no tab switch or control message after B
//   leaves; the control page is opened first for that reason.
//
// Headless: all three tests run in the default new headless mode. The 7.1 probe and
// bury-reopen.pw.js show Chromium reports group title, colour, and collapsed state
// there, and this file's audio steps get `audible: true` headless too (the fixture
// starts Chromium itself, so Playwright's default --mute-audio is absent). If Chrome
// never reports `audible`, the test fails with the AudioContext state; there is no
// skip or fallback.
import {
  test, expect, FIXTURE, ARTIFACT_SELECTOR,
} from './extension-fixture.js';

// background.js EXEMPT_KEY_PREFIX: session key set while a tab is saved as exempt.
const EXEMPT_KEY_PREFIX = 'graveyard.exempt.';

// 2 s past the demo Tombstone threshold.
const LONG_AWAY_MS = 26_000;
const WAIT_MS = 10_000;
const AFTER_MS = 5_000;
const SAMPLE_MS = 250;
const SAMPLER_PERIOD_MS = 1_000;
const MAX_SAMPLE_GAP_MS = 2_000;
const NO_GROUP = -1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const artifactCount = (page) => page.evaluate((sel) => document.querySelectorAll(sel).length, ARTIFACT_SELECTOR);

const registersZero = (record) => record?.normal?.heldMs === 0 && record?.demo?.heldMs === 0;

/**
 * Read `read()` every second until stopped. `stop()` takes one last sample and
 * returns every sample plus the start and stop times, so the caller can check the
 * gaps from start to the first sample and from the last sample to the end.
 */
function startSampler(read) {
  const samples = [];
  const startedAt = Date.now();
  let running = true;
  const take = async () => {
    const at = Date.now();
    let value;
    try {
      value = await read();
    } catch (error) {
      value = `error: ${error?.message ?? error}`;
    }
    samples.push({ at, value });
    return at;
  };
  const loop = (async () => {
    while (running) {
      const at = await take();
      await sleep(Math.max(0, SAMPLER_PERIOD_MS - (Date.now() - at)));
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      await take();
      return { startedAt, stoppedAt: Date.now(), samples };
    },
  };
}

/** Every sample is `true`, and no gap (start, samples, stop) exceeds 2 s. */
function expectSamplesTrue(label, { startedAt, stoppedAt, samples }) {
  expect(samples.length, `${label}: samples`).toBeGreaterThan(0);
  const bad = samples.filter((s) => s.value !== true);
  expect(bad, `${label}: every sample true`).toEqual([]);
  const times = [startedAt, ...samples.map((s) => s.at), stoppedAt];
  let maxGap = 0;
  for (let i = 1; i < times.length; i += 1) maxGap = Math.max(maxGap, times[i] - times[i - 1]);
  test.info().annotations.push({ type: `${label} sampler`, description: `${samples.length} samples, max gap ${maxGap} ms` });
  expect(maxGap, `${label}: largest gap between samples`).toBeLessThanOrEqual(MAX_SAMPLE_GAP_MS);
}

/** Sample the artifact count every 250 ms for 5 s; every sample must be 0. */
async function expectNoArtifactsFor(page, label) {
  const until = Date.now() + AFTER_MS;
  let samples = 0;
  while (Date.now() < until) {
    expect(await artifactCount(page), `${label}: no Poltergeist artifact`).toBe(0);
    samples += 1;
    await sleep(SAMPLE_MS);
  }
  expect(samples).toBeGreaterThanOrEqual(10);
}

test('Resurrect ungroups', async ({
  openFixture, activate, sendControl, readRecord, tabInfo, recordedGroupId, diagnostics,
}) => {
  test.setTimeout(90_000);

  const a = await openFixture(FIXTURE.a);
  const tabA = await activate(a);
  expect(await sendControl({ type: 'graveyard:set-demo', enabled: true })).toEqual({ ok: true, demoMode: true });

  // B comes to the front; A's Absence starts now.
  const left = Date.now();
  const b = await openFixture(FIXTURE.b);
  await activate(b);
  await expect.poll(() => a.evaluate(() => document.visibilityState)).toBe('hidden');
  await expect.poll(async () => typeof (await readRecord(tabA))?.leftAt).toBe('number');
  await sleep(Math.max(0, LONG_AWAY_MS - (Date.now() - left)));
  test.info().annotations.push({ type: 'absence of A', description: `${Date.now() - left} ms` });

  // Move A into the Graveyard_Group through the production protocol.
  const { windowId } = await tabInfo(tabA);
  const buried = await sendControl({ type: 'graveyard:bury', tabIds: [tabA] });
  expect(buried).toEqual({ ok: true, moved: [tabA], notMoved: [] });
  const groupId = await recordedGroupId(windowId);
  expect(groupId).not.toBeNull();
  expect((await tabInfo(tabA)).groupId).toBe(groupId);

  // Activate A (Chrome expands the group); its page shows the Tombstone.
  await activate(a);
  const tombstone = a.locator('[data-poltergeist="tombstone"]');
  await expect(tombstone).toHaveCount(1, { timeout: 5_000 });
  const resurrect = tombstone.getByRole('button', { name: 'Resurrect' });
  await expect(resurrect).toBeVisible();

  // Immediately before the click, A is in the group recorded for its window.
  const before = await tabInfo(tabA);
  expect(before.groupId).not.toBe(NO_GROUP);
  expect(before.groupId).toBe(await recordedGroupId(windowId));

  // A trusted (real Playwright) click.
  await resurrect.click();

  // Within 5 s: A open in its window, in no group, no artifact, both Registers at 0.
  await expect.poll(async () => {
    const [info, count, record] = await Promise.all([tabInfo(tabA), artifactCount(a), readRecord(tabA)]);
    return {
      open: info !== null && info.windowId === windowId,
      groupId: info?.groupId,
      artifacts: count,
      registersZero: registersZero(record),
    };
  }, { timeout: 5_000, intervals: [100] }).toEqual({ open: true, groupId: NO_GROUP, artifacts: 0, registersZero: true });
  expect(a.isClosed()).toBe(false);

  diagnostics.expectClean();
});

test('Pinned and audible tabs are exempt', async ({
  serviceWorker, openFixture, activate, sendControl, readRecord, tabInfo, badgeText, diagnostics,
}) => {
  test.setTimeout(90_000);
  const exemptSaved = (tabId) => serviceWorker.evaluate(async (key) =>
    (await chrome.storage.session.get(key))[key] === true, `${EXEMPT_KEY_PREFIX}${tabId}`);

  // A: pinned from the worker while in front.
  const a = await openFixture(FIXTURE.a);
  const tabA = await activate(a);
  expect(await sendControl({ type: 'graveyard:set-demo', enabled: true })).toEqual({ ok: true, demoMode: true });
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { pinned: true }).then(() => undefined), tabA);
  await expect.poll(async () => (await tabInfo(tabA))?.pinned).toBe(true);
  await expect.poll(() => exemptSaved(tabA)).toBe(true);

  // A leaves the front: its sampler starts now.
  const pinnedSampler = startSampler(async () => (await tabInfo(tabA))?.pinned === true);
  const b = await openFixture(FIXTURE.b);
  const tabB = await activate(b);
  await expect.poll(() => a.evaluate(() => document.visibilityState)).toBe('hidden');

  // B: audible while in front. A one-shot click listener starts a quiet 440 Hz
  // oscillator; a trusted click supplies the user activation the autoplay policy needs.
  await b.evaluate(() => {
    window.addEventListener('click', () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.02;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      window.graveyardAudio = ctx;
    }, { once: true });
  });
  await b.mouse.click(20, 20);
  const audibleBy = Date.now() + WAIT_MS;
  while ((await tabInfo(tabB))?.audible !== true) {
    if (Date.now() > audibleBy) {
      const state = await b.evaluate(() => window.graveyardAudio?.state ?? 'not created');
      const mode = test.info().project.use.headless === false ? 'headed' : 'headless';
      throw new Error(`Chrome never reported audible: true for tab B (AudioContext state "${state}", ${mode})`);
    }
    await sleep(200);
  }
  await expect.poll(() => exemptSaved(tabB)).toBe(true);

  // B leaves the front with C in front for at least 26 s.
  const audibleSampler = startSampler(async () => (await tabInfo(tabB))?.audible === true);
  const left = Date.now();
  const c = await openFixture(FIXTURE.c);
  const tabC = await activate(c);
  await expect.poll(() => b.evaluate(() => document.visibilityState)).toBe('hidden');
  await sleep(Math.max(0, LONG_AWAY_MS - (Date.now() - left)));
  test.info().annotations.push({ type: 'absence of B', description: `${Date.now() - left} ms` });

  // Empty badge; neither tab listed; no Absence and both Registers at 0.
  expect(await badgeText()).toBe('');
  const state = await sendControl({ type: 'graveyard:popup-state', tabId: tabC });
  expect(state.ok).toBe(true);
  const listed = [...state.dead.map((d) => d.tabId), ...state.closable];
  expect(listed).not.toContain(tabA);
  expect(listed).not.toContain(tabB);
  for (const [label, id] of [['A', tabA], ['B', tabB]]) {
    const record = await readRecord(id);
    expect(record?.leftAt, `${label}: no Absence in progress`).toBeNull();
    expect(registersZero(record), `${label}: both Registers at 0`).toBe(true);
  }

  // No artifact at any sample during the 5 s after each activation.
  await activate(a);
  await expectNoArtifactsFor(a, 'A');
  await activate(b);
  await expectNoArtifactsFor(b, 'B');

  expect(await badgeText()).toBe('');
  expectSamplesTrue('A pinned', await pinnedSampler.stop());
  expectSamplesTrue('B audible', await audibleSampler.stop());

  diagnostics.expectClean();
});

test('Badge counts dead tabs', async ({
  openFixture, activate, sendControl, badgeText, diagnostics,
}) => {
  test.setTimeout(90_000);

  // Demo on, and the control page opened, before any tab leaves.
  const a = await openFixture(FIXTURE.a);
  const tabA = await activate(a);
  expect(await sendControl({ type: 'graveyard:set-demo', enabled: true })).toEqual({ ok: true, demoMode: true });
  expect(await badgeText()).toBe('');

  // A leaves (B in front), then B leaves (C in front). Each time is taken just before
  // the switch, so a measured elapsed time is never shorter than the real one.
  const leftA = Date.now();
  const b = await openFixture(FIXTURE.b);
  await activate(b);
  await expect.poll(() => a.evaluate(() => document.visibilityState)).toBe('hidden');
  const leftB = Date.now();
  const c = await openFixture(FIXTURE.c);
  await activate(c);
  await expect.poll(() => b.evaluate(() => document.visibilityState)).toBe('hidden');

  // A reading after B left and less than 22 s after A left: empty.
  const early = await badgeText();
  const earlyAt = Date.now();
  expect(earlyAt - leftA, 'early reading less than 22 s after A left').toBeLessThan(22_000);
  expect(early).toBe('');

  // No switch, popup command, or control message from here until the badge reads 2.
  let reading = early;
  let readAt = earlyAt;
  while (reading !== '2' && Date.now() - leftB <= 29_000) {
    await sleep(SAMPLE_MS);
    reading = await badgeText();
    readAt = Date.now();
  }
  test.info().annotations.push({ type: 'badge 2 after B left', description: `${readAt - leftB} ms` });
  expect(reading).toBe('2');
  expect(readAt - leftB, 'badge 2 no later than 29 s after B left').toBeLessThanOrEqual(29_000);

  // Resurrect A from an Extension_Page: 1 within 5 s.
  const reply = await sendControl({ type: 'graveyard:resurrect-tab', tabId: tabA });
  expect(reply.ok).toBe(true);
  await expect.poll(badgeText, { timeout: 5_000, intervals: [100] }).toBe('1');

  // Close B: empty within 5 s.
  await b.close();
  await expect.poll(badgeText, { timeout: 5_000, intervals: [100] }).toBe('');
  expect(c.isClosed()).toBe(false);

  diagnostics.expectClean();
});
