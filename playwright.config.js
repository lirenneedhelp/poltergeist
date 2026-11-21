import { defineConfig } from '@playwright/test';

// Three projects, each with its own testDir so every suite is listed exactly once.
// - skeleton-effects: direct-effect tests, run on the installed Chrome (unchanged behavior).
// - doomscroll-extension: loads the unpacked extension in a persistent context; uses
//   Playwright's bundled Chromium (channel 'chromium'), since branded Chrome ignores
//   --load-extension.
// - graveyard-extension: same approach for the Tab Graveyard unpacked extension.
export default defineConfig({
  testMatch: '**/*.pw.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'skeleton-effects',
      testDir: 'skeleton/test/browser',
      use: { channel: 'chrome' },
    },
    {
      name: 'doomscroll-extension',
      testDir: 'app1-doomscroll/test/browser',
      use: { channel: 'chromium' },
    },
    {
      name: 'graveyard-extension',
      testDir: 'app2-tab-graveyard/test/browser',
      use: { channel: 'chromium' },
    },
  ],
});
