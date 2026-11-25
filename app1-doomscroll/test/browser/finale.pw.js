// Doomscroll finale (Requirement 10.10, design section 3.3): in Demo_Mode the
// ritual appears after Block blocks pointers, trusted Hint clicks finish the
// Candle Path, the haunt clears within 2 s of the last click and Fog returns
// within 5 s. Clicks are Playwright's real input, so the page sees isTrusted.
import { test, expect, ARTIFACT_SELECTOR } from './extension-fixture.js';

const RITUAL_SELECTOR = 'div[data-poltergeist="ritual"]';
const FOG_SELECTOR = '[data-poltergeist="fog"]';
const DONE_STATUS = '5 of 5 candles · 25 of 25 squares';
const CLEAR_BUDGET_MS = 2_000;
const FOG_BUDGET_MS = 5_000;
// A 5x5 board needs at most 24 Hint clicks (one cell each after candle 1).
const MAX_HINTS = 30;

/** True when the Block overlay is on top at the viewport centre and takes pointers. */
const blockIsBlocking = (page) => page.evaluate(() => {
  const block = document.querySelector('[data-poltergeist="block"]');
  if (!block) return false;
  const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return getComputedStyle(block).pointerEvents === 'auto' && top === block;
});

/**
 * Records, in page time, every trusted click, the first moment no Poltergeist
 * artifact remains after the latest click, and the first Fog element after that.
 * The page's MutationObserver sees the content script's DOM changes directly,
 * so the timings do not depend on Playwright's polling interval.
 */
const installRecorder = (page) => page.evaluate(({ artifact, fog }) => {
  const rec = { lastClick: null, clearedAt: null, fogAt: null };
  window.__finale = rec;
  window.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    rec.lastClick = performance.now();
    rec.clearedAt = null;
    rec.fogAt = null;
  }, true);
  const check = () => {
    if (rec.lastClick === null) return;
    const now = performance.now();
    if (rec.clearedAt === null) {
      if (!document.querySelector(artifact)) rec.clearedAt = now;
    } else if (rec.fogAt === null && document.querySelector(fog)) {
      rec.fogAt = now;
    }
  };
  new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
}, { artifact: ARTIFACT_SELECTOR, fog: FOG_SELECTOR });

test('trusted Hint clicks finish the ritual, the haunt clears in 2 s and Fog returns in 5 s', async ({
  openFeed, pingContent, sendControl, diagnostics,
}) => {
  test.setTimeout(120_000);
  const feed = await openFeed();
  await expect.poll(() => pingContent(feed), { timeout: 10_000 }).toEqual({ ok: true });
  await installRecorder(feed);

  // Demo_Mode on through the production protocol; keep the feed visible so time accrues.
  expect(await sendControl({ type: 'doomscroll:set-demo', enabled: true }, { foreground: feed }))
    .toMatchObject({ ok: true });

  // Block blocks pointers near 24 s of demo time; the ritual follows at 25 s.
  await expect.poll(() => blockIsBlocking(feed), { timeout: 45_000, intervals: [100] }).toBe(true);
  const ritual = feed.locator(RITUAL_SELECTOR);
  await expect(ritual).toBeAttached({ timeout: 10_000 });
  await expect(ritual).toHaveCSS('pointer-events', 'auto');

  // Playwright's CSS locators pierce the open shadow root.
  const hint = ritual.getByRole('button', { name: 'Hint', exact: true });
  const status = ritual.locator('[aria-live="polite"]');
  await expect(status).toHaveText(/^1 of 5 candles · 1 of 25 squares$/);

  let clicks = 0;
  let text = await status.textContent();
  while (text !== DONE_STATUS) {
    expect(clicks, 'Hint clicks before the board is complete').toBeLessThan(MAX_HINTS);
    await hint.click();
    clicks += 1;
    // Status updates before the click handler returns (Requirement 6.3).
    text = await feed.evaluate((sel) => {
      const host = document.querySelector(sel);
      return host?.shadowRoot?.querySelector('[aria-live="polite"]')?.textContent ?? null;
    }, RITUAL_SELECTOR);
    if (text === null) break; // host already gone; asserted below
  }
  expect(text).toBe(DONE_STATUS);
  expect(clicks).toBeGreaterThan(0);

  // No Poltergeist element within 2 s of the last click (page clock).
  await expect
    .poll(() => feed.evaluate(() => window.__finale.clearedAt !== null), { timeout: CLEAR_BUDGET_MS + 1_000, intervals: [50] })
    .toBe(true);
  const { lastClick, clearedAt } = await feed.evaluate(() => window.__finale);
  expect(clearedAt - lastClick, 'ms from last Hint click to no [data-poltergeist]').toBeLessThanOrEqual(CLEAR_BUDGET_MS);

  // Fog back within 5 s of the last click.
  await expect
    .poll(() => feed.evaluate(() => window.__finale.fogAt !== null), { timeout: FOG_BUDGET_MS + 1_000, intervals: [50] })
    .toBe(true);
  const { fogAt } = await feed.evaluate(() => window.__finale);
  expect(fogAt - lastClick, 'ms from last Hint click to Fog returning').toBeLessThanOrEqual(FOG_BUDGET_MS);
  await expect(feed.locator(FOG_SELECTOR)).toBeAttached();
  await expect(feed.locator(RITUAL_SELECTOR)).toHaveCount(0);

  diagnostics.expectClean();
});
