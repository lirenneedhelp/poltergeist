import { defineConfig } from 'vitest/config';

// Property tests (fast-check):
// - every property runs at least 100 cases (`numRuns: 100`);
// - every property test carries a comment: `// Feature: haunt-engine, Property N: <title>`.
// Suites that need a DOM opt in per file with `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    include: ['skeleton/test/**/*.test.js', 'app1-doomscroll/test/**/*.test.js'],
    exclude: ['**/*.pw.js', '**/node_modules/**'],
  },
});
