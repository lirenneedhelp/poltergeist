# Tests

- `npm test` runs Vitest (`skeleton/test/**/*.test.js`). Use `// @vitest-environment jsdom` at the top of a file that needs a DOM.
- `npm run test:browser` runs Playwright (`skeleton/test/browser/**/*.pw.js`) against installed Chrome.
- Every property test (fast-check) runs at least 100 cases (`numRuns: 100`) and carries a comment of the form
  `// Feature: haunt-engine, Property N: <title>`.
