// Timed haunt in Demo_Mode (all thresholds are 1/60 of normal) plus the Rot
// stable-plateau regression. Evidence is semantic: effect data attributes and
// text comparisons, never screenshots or exact applied fractions.
import { test, expect, ARTIFACT_SELECTOR } from './extension-fixture.js';

const BLOCK_MESSAGE = 'You have scrolled long enough. Close this tab and take a break.';
const SAMPLE_MS = 100;
// Demo timings: fog 2-5s, flicker 5-10s, rot 10-15s, block 20-25s (blockAt 0.8 => 24s).
const ROT_RAMP_TO_S = 15;
const BLOCK_POINT_S = 24;
const OBSERVER_WINDOW_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One atomic snapshot of the semantic page state. */
function snapshot(page, originals) {
  return page.evaluate((orig) => {
    const kinds = new Set(
      Array.from(document.querySelectorAll('[data-poltergeist]'), (el) => el.getAttribute('data-poltergeist')),
    );
    const block = document.querySelector('[data-poltergeist="block"]');
    let blockMessage = null;
    let blocking = false;
    if (block) {
      blockMessage = block.textContent;
      const rect = block.getBoundingClientRect();
      const top = document.elementFromPoint(rect.width / 2, rect.height / 2);
      blocking = getComputedStyle(block).pointerEvents === 'auto' && top === block;
    }
    const posts = window.doomscrollFixture.posts();
    const rotChanged = posts.some((p) => orig[p.id] !== undefined && orig[p.id] !== p.body);
    return {
      fog: kinds.has('fog'),
      flicker: kinds.has('flicker'),
      block: kinds.has('block'),
      rot: rotChanged,
      blockMessage,
      blocking,
    };
  }, originals);
}

test('demo haunt escalates in order and Rot reaches text appended on the plateau', async ({
  openFeed, pingContent, sendControl, tabIdOf, diagnostics,
}) => {
  test.setTimeout(90_000);
  const feed = await openFeed();
  await expect.poll(() => pingContent(feed), { timeout: 10_000 }).toEqual({ ok: true });

  // Normal mode starts clean.
  const tabId = await tabIdOf(feed);
  const initial = await sendControl({ type: 'doomscroll:popup-state', tabId }, { foreground: feed });
  expect(initial).toEqual({ ok: true, supported: true, paused: false, demoMode: false });
  expect(await feed.locator(ARTIFACT_SELECTOR).count()).toBe(0);
  const originalPosts = await feed.evaluate(() => window.doomscrollFixture.posts());
  const originals = Object.fromEntries(originalPosts.map((p) => [p.id, p.body]));
  expect(await snapshot(feed, originals)).toMatchObject({ fog: false, flicker: false, rot: false, block: false });

  // Enable Demo_Mode through the production protocol; keep the feed visible.
  const reply = await sendControl({ type: 'doomscroll:set-demo', enabled: true }, { foreground: feed });
  expect(reply).toMatchObject({ ok: true });
  const startedAt = Date.now();

  // Poll until the Block overlay blocks pointers (the 24 s demo point).
  const samples = [];
  let blockedAtMs = null;
  while (Date.now() - startedAt < 45_000) {
    const s = await snapshot(feed, originals);
    s.t = Date.now() - startedAt;
    samples.push(s);
    if (s.blocking) {
      blockedAtMs = s.t;
      break;
    }
    await sleep(SAMPLE_MS);
  }
  expect(blockedAtMs, 'pointer-blocking Block overlay appeared').not.toBeNull();

  const first = (key) => samples.findIndex((s) => s[key]);
  const iFog = first('fog');
  const iFlicker = first('flicker');
  const iRot = first('rot');
  const iBlock = first('block');
  for (const [name, i] of [['fog', iFog], ['flicker', iFlicker], ['rot', iRot], ['block', iBlock]]) {
    expect(i, `${name} appeared`).toBeGreaterThanOrEqual(0);
  }
  expect(iFog).toBeLessThan(iFlicker);
  expect(iFlicker).toBeLessThan(iRot);
  expect(iRot).toBeLessThan(iBlock);

  // No later artifact at each earlier-stage checkpoint.
  expect(samples[iFog]).toMatchObject({ flicker: false, rot: false, block: false });
  expect(samples[iFlicker]).toMatchObject({ fog: true, rot: false, block: false });
  expect(samples[iRot]).toMatchObject({ fog: true, flicker: true, block: false });

  // Pointer blocking arrives near 24 s of demo time, with the exact message.
  const last = samples.at(-1);
  expect(last.blockMessage).toBe(BLOCK_MESSAGE);
  expect(last.blocking).toBe(true);
  expect(blockedAtMs / 1000).toBeGreaterThanOrEqual(BLOCK_POINT_S - 2);
  expect(blockedAtMs / 1000).toBeLessThan(BLOCK_POINT_S + 12);

  // Elapsed demo time is past the Rot rampTo, so Rot sits on its stable plateau.
  expect((Date.now() - startedAt) / 1000).toBeGreaterThan(ROT_RAMP_TO_S);

  // Append a long saved post with no explicit Rot call; the observer must rot it.
  const id = await feed.evaluate(() => window.doomscrollFixture.appendPost({ id: 'plateau-post' }));
  const savedBody = await feed.evaluate((pid) => document.getElementById(pid).querySelector('p').textContent, id);
  expect(savedBody.length).toBeGreaterThan(150);
  // Not synchronously changed: the observer is throttled.
  await sleep(OBSERVER_WINDOW_MS / 5);
  await expect
    .poll(
      () => feed.evaluate((pid) => document.getElementById(pid).querySelector('p').textContent, id),
      { timeout: 5_000, intervals: [100] },
    )
    .not.toBe(savedBody);

  diagnostics.expectClean();
});
