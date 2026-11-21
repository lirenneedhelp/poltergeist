# Implementation Plan: Tab Graveyard App

## Overview

This plan adds three generic pieces to the root skeleton (the `timeAway` meter, the `tombstone` effect, and two optional env hooks), generalises the Doomscroll packaging scripts, and builds `app2-tab-graveyard/` on top. The service worker is the source of truth for tab absences; the page shows decay seeded from it.

Constraints for every task:

- `skeleton/` is the single authored source. Never edit a generated mirror; edit the root, run `npm run build:skeletons`, and commit both.
- Existing test files are not edited. New skeleton cases go into new `describe` blocks appended to existing files, or into new files. Sole exception: the built-in effect registry assertion in `skeleton/test/restoration.test.js` adds `tombstone`.
- Doomscroll's behaviour must not change. Its only authored change is one web-accessible-resource line in `app1-doomscroll/manifest.json`.
- `storage` is the only permission. No `host_permissions`. Never read `url`, `pendingUrl`, `title`, or `favIconUrl` from a `Tab`.
- `tabs.remove` is called only while handling `graveyard:bury`.
- No site-specific selectors, no animation, no watch modes. Run `npm test` in full before marking a task done, not only the new files.

## Tasks

- [x] 1. Add the generic skeleton pieces
  - [x] 1.1 Add the `timeAway` meter in `skeleton/meters.js`
    - Add `heldAway` and `awayStartedAt`, the creation seeding rules for `initial.timeAway` and `initial.timeAwayCurrent`, start/end on the existing visibility listener, missed-event correction in `update()`, and `timeAway` in `values()` measured to `lastTick`.
    - Add `reset(name)`: for `timeAway`, zero the held value, restart any Absence in progress, and return true; return false for any other name.
    - Sanitise seeds (missing, negative, non-finite, or non-number → 0). Add no Chrome API reference.
    - Add `timeAway` to `METERS` in `skeleton/validator.js` and to the meter enum in `skeleton/rule-schema.json`; mention it in the schema description.
    - Leave `timeOnSite`, `scrollDistance`, `timeSinceActive`, and `dispose()` behaviour unchanged.
    - _Requirements: 3.1–3.12_

  - [x] 1.2 Append `timeAway` tests to `skeleton/test/meters.test.js`
    - Use the existing `fakeEnv` helper. Cover: hold while visible, max of absences, a shorter later Absence not lowering the value, hidden-at-creation and visible-at-creation seeding, bad seeds, `reset` while visible and while hidden, `reset('timeOnSite')` returning false, missed visibility events, and dispose.
    - Add a fast-check reference-model test over random hide/show/advance/update/reset sequences (`numRuns: 100`).
    - **Property 1: `timeAway` matches a reference model**
    - **Validates: Requirements 3.2–3.10, 10.2**

  - [x] 1.3 Add `skeleton/effects/tombstone.js`, register it, and add env hooks
    - Implement `{ apply, undo, description }` as designed: a host on `documentElement` with an open shadow root, inline styles, heading, message, and native button; opacity from intensity; pointer blocking at `blockAt`.
    - Implement the `{title}` and `{duration}` placeholders with the fallbacks, truncation, and wording rules in Requirement 4.4–4.5, using `textContent` only.
    - Re-render on every apply and on `env.setTimeout(…, 0)` after the document becomes visible. Call `env.onAction(action)` only for trusted clicks, inside try/catch.
    - Undo through the shared `teardown`, removing both listeners and any pending render timer.
    - Register `tombstone` in `skeleton/effects/index.js`.
    - In `skeleton/index.js`, accept `onAction` and add `env.readMeter(name)` and `env.onAction(name)`; keep the return contract.
    - Do not change `engine.js`, `match.js`, or the other effects.
    - _Requirements: 4.1–4.12_

  - [x] 1.4 Add tombstone and env-hook tests
    - New `skeleton/test/tombstone.test.js` (jsdom): shadow-root markup and the data attribute; placeholder output for each duration band and for singular forms; a title containing `<img src=x onerror=…>` rendered as text; a scripted `click()` (untrusted) never calls `onAction`; re-render after a visibility change; fade and instant undo; byte-for-byte restoration of `documentElement.outerHTML`; Rot applied alongside never changes tombstone text.
    - Append to `skeleton/test/index.test.js`: `readMeter` returns live meter values; `env.onAction` forwards to the callback and contains a thrown error; omitting the callback is a no-op.
    - jsdom cannot create trusted events, so the trusted-click path is verified by the real click in task 7.3.
    - Run the full `npm test` and confirm every existing skeleton and Doomscroll test passes unchanged.
    - **Validates: Requirements 4.1–4.11, 3.13, 10.3**

- [x] 2. Generalise packaging without changing Doomscroll's contract
  - [x] 2.1 Extract shared package checks
    - Move `stripJsComments`, `extractStaticSpecifiers`, `resolveGraph`, `expandWar`, `scanSource`, and the file walker verbatim into `scripts/package-checks.mjs`.
    - Make `scripts/validate-doomscroll-package.mjs` import them and re-export every name its tests import. Its validation logic and messages must not change.
    - _Requirements: 9.7_

  - [x] 2.2 Add `scripts/sync-skeleton.mjs` and the Doomscroll wrapper
    - Implement the `APPS` registry, `check(repoRoot, appKey)`, `build(repoRoot, appKey)` with the per-app target guard, the shared copy policy, and the CLI `[--check] [--app <key>]...` (all apps when `--app` is omitted; unknown arguments exit 2).
    - Run each processed app's validator through a dynamic import after a build or a passing check; exit 1 on any drift or validation error; print messages from each app's `label` and `buildScript`.
    - Rewrite `scripts/sync-doomscroll-skeleton.mjs` as a thin wrapper that keeps its exports (`REPO_ROOT`, `isExcluded`, `listFiles`, `compareFileMaps`, `formatDiagnostics`, `check`, `build`), its `--check` CLI, and its exact messages.
    - Update `package.json`: point `build:doomscroll` and `check:doomscroll` to `sync-skeleton.mjs --app doomscroll`; add `build:graveyard`, `check:graveyard`, `build:skeletons`, `check:skeletons`, and `"pretest": "npm run check:graveyard"`. Leave `test` exactly as it is.
    - Until task 3.2 creates the app, `check:graveyard` will fail; do this task and 3.1–3.2 in one sitting, or temporarily leave `pretest` out until 3.2 and note it.
    - _Requirements: 9.1–9.6_

  - [x] 2.3 Expose the tombstone module in Doomscroll and rebuild its mirror
    - Add `skeleton/effects/tombstone.js` to the web-accessible resources in `app1-doomscroll/manifest.json`. Change nothing else in Doomscroll's authored files.
    - Run `npm run build:doomscroll` and commit the regenerated `app1-doomscroll/skeleton/`.
    - Run `npm run check:doomscroll`, the full Vitest suite, and the Doomscroll Playwright project; all must pass unchanged.
    - _Requirements: 9.10, 10.10_

- [x] 3. Add the Tab Graveyard package
  - [x] 3.1 Create `app2-tab-graveyard/manifest.json` and `rules.json`
    - Manifest per Requirement 1: MV3, `permissions: ["storage"]`, no `host_permissions`, `incognito: "not_allowed"`, module worker, popup, one classic top-frame `content.js` at `document_idle` on the Web_Scope, and one web-accessible-resource entry for `rules.json` plus the reachable skeleton graph with `use_dynamic_url: false`.
    - Rules exactly as in the design's data model (fog 1800→7200, rot 14400→43200, tombstone 86400).
    - _Requirements: 1.1–1.5, 2.1–2.5_

  - [x] 3.2 Add the Graveyard_Validator, build the mirror, and add packaging tests
    - Implement `scripts/validate-graveyard-package.mjs` with the shared checks and graveyard constants (`WEB_SCOPE`, `EXPECTED_RULES`).
    - Run `npm run build:graveyard` and commit `app2-tab-graveyard/skeleton/`; confirm Git does not ignore it.
    - Add `app2-tab-graveyard/test/**/*.test.js` to `vitest.config.js`.
    - Add `app2-tab-graveyard/test/package.test.js`: real-package success; aggregated failures for an extra permission, a `host_permissions` key, a broadened match, a missing or extra web-accessible resource, a leaked test file, changed rules, and prohibited code; and a temp-repo run of `npm run check:graveyard` that passes, then fails on an added `tabs` permission without writing files.
    - Add `app2-tab-graveyard/test/sync.test.js`: registry keys and dirs, `--app` and all-apps modes, the target guard, the read-only check, a Doomscroll-only temp repo where `check:doomscroll` passes, and the wrapper's exports and message text.
    - **Property 6: Generated mirrors are exact for both apps**
    - **Validates: Requirements 1.3–1.7, 2.1, 9.1–9.9, 10.1, 10.6**

- [x] 4. Implement the service worker
  - [x] 4.1 Implement the Activity_Tracker in `app2-tab-graveyard/background.js`
    - Follow Doomscroll's shape: `createBackground(chromeApi, { now })`, `registerBackground`, and guarded synchronous top-level registration.
    - Implement the storage keys, the Tab_Record, `awayMs`, `completeAbsence`, and `stage`, plus the serialized `enqueue` queue.
    - Handle `tabs.onActivated` (with the `tabs.get` guard and stub creation), `onInstalled`/`onStartup` seeding, `onReplaced`, `onRemoved`, and `windows.onRemoved`.
    - Fetch and cache `rules.json` thresholds by rule id; apply the 3600 scale in demo mode.
    - Handle `graveyard:content-state`, `graveyard:report` (epoch check and cap), and `graveyard:resurrect` with sender validation (own id, top frame, http/https `sender.url`, integer tab id).
    - _Requirements: 5.1–5.14, 6.2, 6.3, 8.1, 8.4, 8.5_

  - [x] 4.2 Implement the popup protocol, Bury, Reopen, and demo
    - Handle `graveyard:popup-state`, `graveyard:resurrect-tab` (reset, then `apply-reset`, return `delivered`), `graveyard:set-demo` (write the flag, bump the profile epoch), `graveyard:bury`, and `graveyard:reopen`, all requiring an extension-page sender.
    - Bury: validate ids, re-check deadness now, save entries first (cap 200, title ≤ 300, URL ≤ 2048), then remove each tab individually and report `notClosed`. Close nothing if thresholds or the save fail.
    - Reopen: accept only `http:`/`https:` URLs, create the tab, then remove the entry.
    - Reject unknown or malformed messages with `{ok:false}` and no side effects.
    - _Requirements: 5.9, 7.2, 7.5–7.14, 8.2, 8.3_

  - [x] 4.3 Add `app2-tab-graveyard/test/background.test.js`
    - Mock only the Chrome APIs used, with an in-memory `storage` and an injected clock.
    - Cover every tracker event, the moved-tab guard, stub creation, discard replacement, removal cleanup, demo epochs and the demo Register start time, report caps and stale-epoch rejection, a restarted worker reading stored state, and concurrency through the queue.
    - Cover Bury: deadness re-check, save-before-remove ordering, save failure closing nothing, partial `tabs.remove` failure, the cap, and truncation. Cover Reopen with a valid URL, a `javascript:` URL, and a `tabs.create` failure.
    - Add a fast-check order-independence test for Register merging, and a fast-check test that random non-bury sequences never call `tabs.remove`. Add a source scan asserting `tabs.remove` appears only in the Bury handler.
    - Assert that no stored value contains page text and that the worker never reads `Tab.url` or `Tab.title`.
    - **Property 2: Registers merge in any order**
    - **Property 3: Nothing closes without Bury**
    - **Validates: Requirements 5.1–5.14, 7.5–7.14, 8.1–8.5, 10.4**

- [x] 5. Implement the content script
  - [x] 5.1 Implement the loader and Runtime_Controller in `app2-tab-graveyard/content.js`
    - Keep it a classic script with `graveyardCreateDemoProfile`, `graveyardCreateController`, and a contained async bootstrap; cache one package Promise for the import and the rules fetch.
    - Implement serialized `refresh()` with a generation token: request state, build and validate the profile, stop the old instance (fault if `stop` throws), and start with the seeds, `tickMs: 1000`, and `onAction`.
    - Send `graveyard:report` on visibility changes (deferred read after a change to visible). Resurrect: commit to the worker, then `meters.reset('timeAway')` and `engine.tick()`. Handle `graveyard:apply-reset`.
    - Refresh on `graveyard.demoMode` storage changes and on `pageshow` with `persisted`; dispose on `pagehide`.
    - Report one `[poltergeist:graveyard]` diagnostic per failure kind, without titles or URLs.
    - _Requirements: 2.6, 2.7, 6.1–6.3, 6.7–6.13, 8.4, 8.5_

  - [x] 5.2 Add `app2-tab-graveyard/test/content.test.js`
    - Evaluate `content.js` in a VM context with fake Chrome, fetch, and module boundaries, as the Doomscroll tests do.
    - Cover: exact 1/3600 scaling and immutability; seeds passed to `startPoltergeist`; no start before a reply; reports with the right epoch and the deferred held value; Resurrect commit-then-reset and the failure path; apply-reset; demo restarts; rapid triggers with deferred loads leaving one instance; `pagehide`/`pageshow`; stop and start failures; and diagnostics.
    - **Property 4: Demo scaling preserves shape and order**
    - **Property 5: At most one live instance**
    - **Validates: Requirements 2.6, 2.7, 6.1–6.3, 6.7–6.13, 10.5**

- [x] 6. Implement the popup
  - [x] 6.1 Create `popup.html`, `popup.js`, and `popup.css`
    - Sections as designed: This tab (Stage, Away_Time, `Resurrect this tab`), Graveyard (`Bury all (N)`), Buried (`Reopen` per entry), and a `Demo mode` checkbox.
    - Read only the active tab id; get everything else from `graveyard:popup-state`. Render with `textContent` and show hosts only.
    - Guard against duplicate in-flight commands, roll back and show a short error on failure, and re-request state after each successful command.
    - Use external files only; static styling with visible focus and disabled states.
    - _Requirements: 7.1–7.6, 7.13_

  - [x] 6.2 Add `app2-tab-graveyard/test/popup.test.js`
    - Cover the loading, error, unknown-tab, and populated states; the Bury count and disabled state; Bury success and failure; Reopen; Resurrect with `delivered: false`; the demo toggle; the duplicate-click guard; markup in titles shown as text; and a table pinning the popup duration formatter to the tombstone formatter's outputs.
    - **Validates: Requirements 7.1–7.6, 7.13, 10.5**

- [x] 7. Add unpacked-extension browser verification
  - [x] 7.1 Add the Playwright project
    - Add a `graveyard-extension` project with `testDir: 'app2-tab-graveyard/test/browser'` and `channel: 'chromium'`; leave the two existing projects unchanged.
    - _Requirements: 10.7_

  - [x] 7.2 Create the fixture page and extension fixture
    - Add `app2-tab-graveyard/test/fixtures/page.html`: a title taken from the URL path or host, several long text paragraphs, and no external resources.
    - Add `test/browser/extension-fixture.js`, modelled on Doomscroll's: run `check:graveyard` without building, launch only `app2-tab-graveyard/` in a fresh persistent context, route the three fixture origins, abort other requests, collect diagnostics, and clean up the profile with Windows-safe retries. Provide helpers: `sendControl` from an extension page, `tabIdOf`, `activate(page)`, and `readRecord(tabId)` through the worker.
    - First, verify that a backgrounded fixture page reports `document.visibilityState === 'hidden'` and that the worker sees `tabs.onActivated`. If headless Chromium does not hide background pages, switch activation to `chrome.tabs.update(id, {active:true})` from the worker, or run this project headed, and record the choice in the fixture header.
    - _Requirements: 10.8_

  - [x] 7.3 Verify the return flows and Resurrect in Playwright
    - With Demo_Mode on: leave A for 3 s and return (Fog, no Tombstone); stay 5 s (Fog remains); leave A for 26 s and return (Tombstone text contains A's title and a duration); click `Resurrect` with a real Playwright click (every `[data-poltergeist]` gone, fixture text equal to the original, worker Registers zero).
    - _Requirements: 6.4, 6.5, 6.8, 10.9_

  - [x] 7.4 Verify decay survives reload or discard
    - Leave A for 26 s, discard it with `chrome.tabs.discard` from the worker and confirm `discarded: true`, then activate it and locate the reloaded page by URL; require the Tombstone. If discard cannot be driven reliably, reload A in the background instead and state which path the test uses.
    - _Requirements: 5.6, 6.6, 10.9_

  - [x] 7.5 Verify Bury and Reopen
    - Open A, B, and C; leave A and B for 26 s with C in front; open `popup.html` as a page. Require the Graveyard to list exactly A and B, and the tab count to be unchanged before the click. Click `Bury all`: A and B close, C stays open, and two Buried_Entries appear. Click `Reopen` on A: a tab opens at A's URL and the entry disappears.
    - Assert no page, worker, or namespaced errors in every test.
    - _Requirements: 7.15, 10.9_

- [ ] 8. Final checkpoint
  - [ ] 8.1 Verify both apps end to end
    - Re-read the diff: under `skeleton/`, only the files in the design's file plan changed; in Doomscroll, only the one manifest line and the regenerated mirror changed; no existing test file was edited.
    - Run `npm test` (pretest graveyard check, Doomscroll check, then Vitest), and confirm the test count went up and nothing failed.
    - Run `npm run build:skeletons` and confirm `git status` shows no content change; run `npm run check:skeletons`.
    - Run `npm run test:browser`; all three projects must pass.
    - Load `app2-tab-graveyard/` in real Chrome, turn on demo mode, and check the full sequence by hand on two real sites, including Bury and Reopen, before recording the video.
    - _Requirements: 9.9, 9.10, 10.10_

## Notes

- Every task is required.
- `timeAway` holds the longest Absence since reset, so a short later trip away never heals a tab and frequent short switches never add up.
- Demo mode has its own per-tab Register that starts when demo is enabled, so turning demo on never makes existing tabs dead.
- The Tombstone sits in an open shadow root: page CSS cannot restyle it, and untrusted clicks are ignored.
- Tab records live in `storage.session` and do not survive a browser restart; this is a known limitation (see the design's Risks).
- No Kiro save hook is added for the graveyard mirror; the drift check in `npm test` is the guarantee.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1", "5.1"] },
    { "id": 4, "tasks": ["4.2", "5.2"] },
    { "id": 5, "tasks": ["4.3", "6.1"] },
    { "id": 6, "tasks": ["6.2", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["7.3", "7.4", "7.5"] },
    { "id": 9, "tasks": ["8.1"] }
  ]
}
```
