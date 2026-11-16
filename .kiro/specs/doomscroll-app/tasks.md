# Implementation Plan: Doomscroll App

## Overview

This plan creates the first Poltergeist app under `app1-doomscroll/` using Chrome Manifest V3 and plain JavaScript. The app dynamically imports the generated package copy of the existing root skeleton, applies four validated rules, and adds only the host integration needed for pause and demo controls.

All tasks are new and remain unchecked. The only permitted production change under `skeleton/` is `skeleton/effects/rot.js`; `skeleton/engine.js` and every other production skeleton file remain unchanged. `skeleton/test/rot.test.js` may be extended for the Rot fix.

Workspace constraints that apply to every task:

- `skeleton/` is the single authored source of truth. `app1-doomscroll/skeleton/` is generated, ignored, and never edited directly.
- Effects apply to the whole page and use no YouTube-, X-, Instagram-, feed-, post-, or timeline-specific selector.
- Every started effect and observer must have a complete undo path.
- Flicker must retain the skeleton's static `prefers-reduced-motion` behavior.
- Both Normal and Demo rule documents must pass the root Rule Validator.
- Persisted behavior meters, Tab Graveyard, and `demo-site/` are out of scope.
- Long-running watch modes are not used; Vitest runs with `--run` through the existing `npm test` script.

## Tasks

- [ ] 1. Add the authored Manifest V3 package and rules
  - [ ] 1.1 Create `app1-doomscroll/manifest.json` with exact scope
    - Declare Manifest V3 metadata, `background.js` as a module service worker, `popup.html` as the action popup, and classic `content.js` at `document_idle` in the top frame only.
    - Set `permissions` to exactly `storage` and `host_permissions` to exactly `https://www.youtube.com/*`, `https://x.com/*`, and `https://www.instagram.com/*`.
    - Use that exact host set for content-script and web-accessible-resource matches. Expose `rules.json` plus the complete static module graph rooted at `skeleton/index.js`, set `use_dynamic_url: true`, and expose no popup, worker, test, fixture, or build file.
    - Include no inline or remote executable code and request no `tabs`, `activeTab`, or `scripting` permission.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10_

  - [ ] 1.2 Create the validated Normal Profile in `app1-doomscroll/rules.json`
    - Add exactly `doomscroll-fog`, `doomscroll-flicker`, `doomscroll-rot`, and `doomscroll-block`, in that order, all enabled, all using `timeOnSite`, and all matching the exact approved host set.
    - Set Fog to 120→300 seconds with `{ maxBlur: 5, maxGrayscale: 0.8 }` and 400 ms fade undo.
    - Set Flicker to 300→600 seconds with `{ maxDepth: 0.22, periodMs: 1600 }` and instant undo.
    - Set Rot to 600→900 seconds with `{ maxFraction: 0.55, glyphs: "░▒·_ " }` and instant undo.
    - Set Block to 1200→1500 seconds with `{ maxOpacity: 0.96, blockAt: 0.8, message: "You have scrolled long enough. Close this tab and take a break." }` and 600 ms fade undo.
    - Validate the document against the root Rule Validator and preserve the aligned full-intensity/start boundaries.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

- [ ] 2. Fix Rot for text added at stable intensity
  - [ ] 2.1 Add a Handle-owned refresh and MutationObserver in `skeleton/effects/rot.js`
    - Factor the current detached-node prune and whole-body TreeWalker pass into a private refresh function without changing skip rules, deterministic hashing, rewrite adoption, serial assignment, or conditional restoration.
    - Add private Handle fields for one observer and the latest clamped fraction/glyph array. Update those fields before every explicit refresh.
    - After the initial pass, observe `documentElement` with `{ subtree: true, childList: true, characterData: true }` when observation is available. Retry observer creation on a later `apply` if `documentElement` was initially absent.
    - For each observer delivery, refresh at most once when there is an addition/removal or an untracked/page-rewritten character-data target. Ignore Rot's own character records when current data already equals the tracked output.
    - Reuse one observer on repeated apply, prune removals during refresh, and keep explicit-pass behavior when observation is unavailable.
    - Disconnect before teardown restoration, guard callbacks after death, clear the observer reference and node map, and preserve idempotent undo.
    - Do not modify `skeleton/engine.js` or any other production skeleton file.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15_

  - [ ] 2.2 Extend `skeleton/test/rot.test.js` for observer behavior and restoration
    - Test eligible text appended after an explicit intensity-1 apply and await actual jsdom MutationObserver delivery without manually reapplying Rot.
    - Test a tracked text-node rewrite, a newly inserted/replaced body, latest intensity and glyph params after an explicit update, and observer identity across repeated apply calls.
    - Test one refresh per mutation delivery, settlement of Rot's own mutations without an unbounded callback loop, and pruning after subtree removal.
    - Test disconnect-before-restore, exact restoration of initial and appended text, conditional preservation of later page rewrites, repeat undo, queued callback no-op, and untouched mutations after undo.
    - Test the no-MutationObserver and no-documentElement fallbacks without changing the exported effect contract.
    - **Property 4: Rot refresh and undo form a reversible mutation lifecycle**
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.5, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14**

- [ ] 3. Add deterministic skeleton synchronization and package validation
  - [ ] 3.1 Implement `scripts/sync-doomscroll-skeleton.mjs` and package commands
    - Add synchronize mode and a read-only `--check` mode, resolving paths from the repository root and guarding that the generated target is exactly `app1-doomscroll/skeleton` before replacing it.
    - Copy all source files under root `skeleton/` except `skeleton/test/**`, in sorted relative-path order and without byte or line-ending rewrites. Remove stale generated files only inside the guarded generated target.
    - In check mode, compare the complete relative file sets and bytes, aggregate missing/extra/changed diagnostics, and perform no writes or timestamp changes.
    - Add `build:doomscroll` and `check:doomscroll` scripts to `package.json`; add only `/app1-doomscroll/skeleton/` to `.gitignore` for this generated output.
    - Export or isolate testable comparison helpers without adding runtime dependencies to the extension.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.9, 6.10_

  - [ ] 3.2 Add Package Validator checks and tests
    - Parse both JSON files and run root `validateRules` with `builtinEffects`; assert exact rule ids/order, meter values, params, messages, and undo settings.
    - Assert Manifest V3, exact permissions, exact host sets, one classic top-frame content script, popup, module worker, and local-only executable resources.
    - Resolve every relative static `import` and `export ... from` edge from generated `skeleton/index.js`; reject bare, absolute, remote, missing, or extension-root-escaping imports.
    - Expand WAR declarations and require exactly the reachable JavaScript graph plus `rules.json`; reject generated test files and broader resources or origins.
    - Scan app-owned JavaScript and HTML for remote executable URLs, `eval`, `new Function`, string-valued timers, inline script bodies, and inline event-handler attributes; report the path and construct.
    - Add package tests for success and aggregated failures using temporary directories, including stale, missing, extra, and byte-changed skeleton files and each prohibited code form.
    - **Property 1: Scope-bearing lists are exactly equal**
    - **Property 5: Generated skeleton identity is exact**
    - **Validates: Requirements 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 1.11, 2.1, 6.5, 6.6, 6.7, 6.8**

- [ ] 4. Implement extension control state and popup
  - [ ] 4.1 Implement the module service worker in `app1-doomscroll/background.js`
    - Define only the enumerated messages `doomscroll:content-state`, `doomscroll:popup-state`, `doomscroll:set-paused`, `doomscroll:set-demo`, `doomscroll:apply-paused`, and `doomscroll:ping`.
    - Store each true pause state in its own namespaced `chrome.storage.session` key ending in the tab id; treat missing/non-true values as unpaused and remove only that key on `tabs.onRemoved`.
    - For content-state requests, derive the tab id from `sender.tab.id` and ignore any payload id. For popup requests, validate an integer tab id and determine support through a content ping without reading URL/title fields.
    - Store one namespaced Boolean demo preference in `chrome.storage.local`, default malformed/absent values to false, and use structured `{ok:true}` / `{ok:false,error}` responses.
    - On pause changes, commit storage before notifying the tab. Return `{ok:true, paused, delivered:false}` when commit succeeds but the receiver is absent; return `{ok:false}` and send nothing when commit fails. Independent keys must keep simultaneous changes in different tabs isolated.
    - Return an asynchronous response in the Manifest V3-compatible listener pattern and reject unknown or malformed messages without side effects.
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.11, 5.12, 5.14, 5.15, 5.16_

  - [ ] 4.2 Implement the minimal popup
    - Create `popup.html` with a heading, live status region, labelled `Pause on this tab` and `Demo mode on supported tabs` controls, and external `popup.js`/`popup.css` only.
    - Query the active tab id without reading sensitive tab properties, request confirmed status from the worker, and render active, paused, demo, unsupported, loading, and error states.
    - Disable only pause when content ping says unsupported. Keep demo available globally.
    - Send validated pause/demo commands and prevent duplicate in-flight changes. Roll a control back only when `ok` is false; when pause is committed with `delivered:false`, keep the confirmed value and show an unavailable notice.
    - Add restrained static styling with visible focus, disabled, and status states; add no animation.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.10, 5.11, 5.14, 5.15_

  - [ ] 4.3 Add service-worker and popup Vitest coverage
    - Mock only the Chrome APIs used by each file and reset listeners/storage between tests.
    - Cover sender-derived ids, exact independent storage keys, malformed values, write-before-notify ordering, simultaneous per-tab isolation, tab removal, service-worker restart reads, demo defaults/updates, unknown messages, failed commits, and committed-but-undelivered results.
    - Cover accessible popup markup, active-tab lookup, supported/unsupported display, pause disablement, globally available demo, successful updates, duplicate-click suppression, failed-commit rollback, and committed unavailable rendering.
    - Assert that stored values contain no URL, text, history, or meter fields.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.11, 5.14, 5.15, 5.16, 7.3_

- [ ] 5. Implement the classic loader and Runtime Controller
  - [ ] 5.1 Implement profile transformation and single-instance reconciliation in `app1-doomscroll/content.js`
    - Keep `content.js` a classic script. Use a contained async bootstrap and no static imports or exports.
    - Model desired pause/demo state, `normalSnapshot`, `demoSnapshot`, current instance, a serialized Promise queue, generation token, and disposed flag.
    - Create Demo_Profile from a deep clone by dividing every threshold/ramp by 60, validate it through the dynamically loaded root API, and leave Normal_Profile deeply unchanged.
    - Reset demo meters only for an off-to-on transition; preserve a demo snapshot across pause/resume while demo remains on; discard demo progress when demo turns off; never merge it into normal meters.
    - Before replacing an instance, copy only `timeOnSite` and `scrollDistance`, call `stop` through Promise resolution, and clear ownership. Pause always wins and keeps no Engine active.
    - On stale startup completion, stop the obsolete result immediately. Contain queue errors so later desired-state changes can still reconcile without ever owning two instances.
    - **Property 2: Demo scaling preserves rule shape and order**
    - **Property 3: Runtime reconciliation owns at most one instance**
    - **Validates: Requirements 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 5.9, 5.10, 5.13**

  - [ ] 5.2 Wire packaged startup, messages, and cleanup
    - On initialization, register only the required content-side message and storage listeners, request confirmed content state from the worker, and do not start before that response.
    - Cache one Promise that dynamically imports `chrome.runtime.getURL('skeleton/index.js')` and fetches/parses `chrome.runtime.getURL('rules.json')`; reject non-success responses before parsing.
    - Validate the Normal_Profile and pass the selected untouched document plus in-memory `initialMeters` to `await startPoltergeist`.
    - Handle `doomscroll:ping` without changing state, accept `doomscroll:apply-paused` only from the extension, and reconcile `doomscroll.demoMode` changes from the local storage namespace.
    - Prefix one contained diagnostic per failed operation with `[poltergeist:doomscroll]`, stop any owned partial/obsolete instance, and leave no artifacts after fatal startup failure.
    - Let skeleton pagehide cleanup run and remove app-owned listeners/dispose desired state when the content context ends where an explicit lifecycle event is available.
    - Add no site-specific selector, behavior-meter storage, Storage Adapter, or skeleton Entry Point change.
    - _Requirements: 1.11, 3.1, 3.2, 3.3, 3.4, 3.11, 3.12, 3.13, 3.14, 5.6, 5.8, 5.9, 5.12, 5.13, 5.14, 5.15, 5.16_

  - [ ] 5.3 Add Runtime Controller and loader Vitest coverage
    - Exercise the classic loader in an isolated test context with fake module/fetch/Chrome boundaries; do not add a production app module merely for testing.
    - Verify exact 1/60 profile values, deep immutability, validation before start, normal/demo snapshot separation, zeroed new demo sessions, pause precedence, and profile selection at startup.
    - Generate rapid pause/demo event sequences and deferred starts/stops; require at most one published instance, exactly one stop for replaced/obsolete instances, and continued queue operation after a contained error.
    - Cover dynamic runtime URLs, non-success rules response, bad JSON, validation failure, import/start failure, sync and Promise-returning skeleton APIs, listener messages, storage changes, and clean failure state.
    - _Requirements: 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 7.3_

- [ ] 6. Add unpacked-extension browser verification
  - [ ] 6.1 Expand Vitest and Playwright discovery without regressing existing suites
    - Update `vitest.config.js` to include `app1-doomscroll/test/**/*.test.js` alongside the existing skeleton tests and continue excluding `.pw.js`.
    - Update `playwright.config.js` so the existing `skeleton/test/browser/**/*.pw.js` suite keeps its current browser behavior and `app1-doomscroll/test/browser/**/*.pw.js` runs once in its extension project.
    - Use Playwright's bundled Chromium channel for the unpacked-extension project, as required by current Playwright extension loading, while retaining the existing direct-effect browser project.
    - Keep a fixed viewport and deterministic timeouts; do not introduce watch mode.
    - _Requirements: 7.1, 7.4, 7.5_

  - [ ] 6.2 Create the local feed fixture and persistent extension fixture
    - Add deterministic `app1-doomscroll/test/fixtures/feed.html` with several long, uniquely identified text posts, a fixed element if useful for restoration checks, and a fixture API that appends a post without site-specific production integration.
    - Before browser launch, run build and read-only check. Launch a fresh persistent Chromium context with only `app1-doomscroll/` enabled and derive the extension id from its MV3 service worker.
    - Route `https://www.youtube.com/doomscroll-fixture` to the local HTML while preserving that approved URL; abort unexpected network access and allow required extension resource requests.
    - Capture page errors, worker errors, and namespaced diagnostics. Close the context and temporary profile in teardown on pass or failure, including Windows-safe cleanup retries.
    - _Requirements: 6.9, 7.5, 7.6, 7.12, 7.13, 7.14_

  - [ ] 6.3 Verify the timed haunt and stable-intensity Rot regression in Playwright
    - Start the fixture in normal mode and assert it is initially clean. Enable Demo_Mode through the actual popup after load so the demo clock starts from zero.
    - Poll semantic DOM state and record first appearance. Require Fog before Flicker, Flicker before changed Rot text, Rot before Block, no later artifact at each earlier-stage checkpoint, the exact Block message, and pointer blocking at the 24-second demo point.
    - Wait beyond the 15-second full-Rot point, append a long saved post, and require it to change after observer delivery without an explicit Rot call or intensity change.
    - Use text comparisons and effect data attributes rather than screenshots or assertions that every character changes.
    - _Requirements: 2.12, 2.15, 2.16, 4.4, 4.8, 4.9, 4.10, 7.7, 7.8, 7.12, 7.14_

  - [ ] 6.4 Verify popup pause, resume, restoration, and host exclusion in Playwright
    - Pause the fixture tab through the actual popup. Require all overlays to disappear, every retained original/added fixture string to be restored exactly, and a post appended while paused to remain unchanged.
    - Resume while Demo_Mode remains enabled. Require one active sequence and confirm later eligible appended text is processed again once Rot is active.
    - Open a second page on an unmatched routed origin and require no Doomscroll ping response, imported artifact, or Poltergeist DOM node.
    - Assert no unexpected page, worker, or extension errors and close all contexts in fixture teardown.
    - _Requirements: 1.10, 3.4, 3.5, 4.12, 4.13, 5.3, 5.4, 5.7, 5.9, 5.10, 7.9, 7.10, 7.11, 7.13, 7.14_

- [ ] 7. Final checkpoint - verify the complete Doomscroll App
  - [ ] 7.1 Build, check, and run all automated suites
    - Re-read the manifest, rule file, generated-copy policy, and implementation diff; confirm that no production skeleton file except `skeleton/effects/rot.js` changed and that no out-of-scope feature was added.
    - Run `npm run build:doomscroll`, followed by `npm run check:doomscroll`, and inspect that `app1-doomscroll/skeleton/` is generated and ignored rather than tracked.
    - Run `npm test` and require the existing skeleton and new app suites to pass.
    - Run `npm run test:browser` and require both the existing direct-effect suite and unpacked Doomscroll extension suite to pass.
    - Confirm browser evidence covers actual manifest injection, runtime-URL import, rules fetch, service worker, popup messages, timed escalation, full-intensity appended text, undo on pause, resume, and unmatched-host exclusion.
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.8, 1.9, 2.1, 2.16, 3.12, 3.14, 4.13, 4.15, 5.16, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14_

## Notes

- Every task is required. No optional task is used because the user explicitly requested packaging, controls, the Rot regression fix, drift detection, and unpacked-extension verification.
- `app1-doomscroll/skeleton/` is package output, not an app fork. Never patch it directly; rerun `npm run build:doomscroll` after a root skeleton change.
- The Rot task intentionally supersedes only the earlier Haunt Engine design choice not to observe DOM churn. The Engine's intensity epsilon and tick behavior remain untouched.
- Normal and demo progression both use `timeOnSite`; demo changes only timing, not effects, params, message, matching, or reduced-motion behavior.
- `chrome.storage.session` pause state and `chrome.storage.local` demo preference are control state, not persisted behavior meters.
- The Playwright extension project uses bundled Chromium because current Playwright documentation says branded Chrome no longer accepts the required side-load flags. It still exercises the Manifest V3 Chrome-extension runtime.
- Browser waits should use semantic polling with slack around timers. Do not use fixed screenshots as primary evidence and do not require every character to rot.
- All file deletion in the build script must be guarded to the exact generated directory. The read-only check performs no writes.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1"] },
    { "id": 1, "tasks": ["2.2", "3.2", "4.1", "5.1"] },
    { "id": 2, "tasks": ["4.2", "5.2"] },
    { "id": 3, "tasks": ["4.3", "5.3", "6.1", "6.2"] },
    { "id": 4, "tasks": ["6.3", "6.4"] },
    { "id": 5, "tasks": ["7.1"] }
  ]
}
```
