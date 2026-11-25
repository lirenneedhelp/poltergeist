// Haunt Playground in a real browser (design section 5.5, Requirements 14.3, 14.7, 14.11).
// The page is served by scripts/serve-playground.mjs on a free port; every request to
// another origin is aborted and recorded, so the page must work fully offline.
import { test, expect } from '@playwright/test';
import { startServer } from '../../scripts/serve-playground.mjs';

let server;

test.beforeAll(async () => {
  server = await startServer({ port: 0 });
});

test.afterAll(async () => {
  await server?.close();
});

test('serves the Playground offline and haunts the feed with the Doomscroll preset', async ({ page }) => {
  const origin = new URL(server.url).origin;
  const otherOrigin = [];
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.continue();
    otherOrigin.push(url);
    return route.abort();
  });

  await page.goto(server.url);

  // Requirement 14.3: a long fake feed, taller than the window.
  await expect.poll(() => page.locator('#feed article').count()).toBeGreaterThanOrEqual(20);
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
  expect(tall).toBe(true);

  // Requirement 14.7: the slider goes up to 3600×. Soft, so the remaining checks still run
  // and report on their own if this one fails.
  const speed = page.locator('#speed');
  await expect.soft(speed).toHaveAttribute('max', '3600');
  await speed.fill('600');
  await expect(page.locator('#speed-value')).toHaveText('600×');

  // The fog threshold at 600× is 0.2 s.
  await page.locator('#preset-doomscroll').click();
  await expect(page.locator('[data-poltergeist="fog"]')).toBeAttached({ timeout: 10_000 });

  // Requirement 14.11: no page errors and nothing fetched from another origin.
  expect(pageErrors).toEqual([]);
  expect(otherOrigin).toEqual([]);
});
