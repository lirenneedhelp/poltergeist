import { defineConfig } from '@playwright/test';

// Browser tests use the installed Chrome (no bundled browser download).
export default defineConfig({
  testDir: 'skeleton/test/browser',
  testMatch: '**/*.pw.js',
  use: {
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
  },
});
