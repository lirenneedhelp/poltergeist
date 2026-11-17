# Implementation Plan: Doomscroll App

## Overview

This plan creates the first Poltergeist app under `app1-doomscroll/` using Chrome Manifest V3 and plain JavaScript. The app dynamically imports the generated package copy of the existing root skeleton, applies four validated rules, and adds only the host integration needed for pause and demo controls.

All tasks are new and remain unchecked. The only permitted production change under `skeleton/` is `skeleton/effects/rot.js`; `skeleton/engine.js` and every other production skeleton file remain unchanged. `skeleton/test/rot.test.js` may be extended for the Rot fix.

Workspace constraints that apply to every task:

- `skeleton/` is the single authored source of truth. `app1-doomscroll/skeleton/` is generated, committed, never edited directly, and checked before Vitest.
- Effects apply to the whole page and use no YouTube-, X-, Instagram-, feed-, post-, or timeline-specific selector.
- Every started effect and observer must have a complete undo path.
- Flicker must retain the skeleton's static `prefers-reduced-motion` behavior.
- Both Normal and Demo rule documents must pass the root Rule Validator.
- Persisted behavior meters, Tab Graveyard, and `demo-site/` are out of scope.
- Long-running watch modes are not used. The normal `npm test` command runs `check:doomscroll` before Vitest, and the Kiro save hook is convenience automation only.

## Tasks

- [x] 1. Add the authored Manifest V3 package and rules
  - [x] 1.1 Create `app1-doomscroll/manifest.json` with exact scope
    - Declare Manifest V3 metadata, `background.js` as a module service worker, `popup.html` as the action popup, and classic `content.js` at `document_idle` in the top frame only.
    - Set `permissions` to exactly `storage` and `host_permissions` to exactly `https://www.youtube.com/*`, `https://x.com/*`, and `https://www.instagram.com/*`.
    - Use that exact host set for content-script and web-accessible-resource matches. Expose `rules.json` plus the complete static module graph rooted at `skeleton/index.js`, set `use_dynamic_url: false`, and expose no popup, worker, test, fixture, or build file. Real Chrome requires `false`: dynamic-id resource URLs were blocked when the YouTube content script imported the skeleton and fetched the rules.
    - Include no inline or remote executable code and request no `tabs`, `activeTab`, or `scripting` permission.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10_

  - [x] 1.2 Create the validated Normal Profile in `app1-doomscroll/rules.json`
    - Add exactly `doomscroll-fog`, `doomscroll-flicker`, `doomscroll-rot`, and `doomscroll-block`, in that order, all enabled, all using `timeOnSite`, and all matching the exact approved host set.
    - Set Fog to 120→300 seconds with `{ maxBlur: 5, maxGrayscale: 0.8 }` and 400 ms fade undo.
    - Set Flicker to 300→600 seconds with `{ maxDepth: 0.22, periodMs: 1600 }` and instant undo.
    - Set Rot to 600→900 seconds with `{ maxFraction: 0.55, glyphs: "░▒·_ " }` and instant undo.
    - Set Block to 1200→1500 seconds with `{ maxOpacity: 0.96, blockAt: 0.8, message: "You have scrolled long enough. Close this tab and take a break." }` and 600 ms fade undo.
    - Validate the document against the root Rule Validator and preserve the aligned full-intensity/start boundaries.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

- [x] 2. Fix Rot for text added at stable intensity
  - [x] 2.1 Add full-body explicit passes and throttled mutation-root passes in `skeleton/effects/rot.js`
    - Factor shared text-node processing, subtree walking, and detached-node pruning without changing skip rules, deterministic hashing, rewrite adoption, serial assignment, conditional restoration, or public exports.
    - Keep every explicit `apply` as an immediate full-body pass. Store the latest clamped fraction/glyph array first, then cancel and clear any observer work superseded by that pass.
    - Add one observer, a separate observer timer, a Set of pending roots, and a pending-prune flag to each live Handle. Observe `documentElement` with `{ subtree: true, childList: true, characterData: true }` when available.
    - Queue only each `childList.addedNode` and each externally changed `characterData` text target. Use removals only to request detached-entry pruning. Ignore Rot-owned character records whose text already equals tracked output.
    - On the first relevant delivery, arm one 250 ms timer. Merge later records into that pending batch without adding a timer; when it fires, de-duplicate overlapping roots and process only in-body queued roots, never `document.body` as a fallback.
    - Process text roots directly and added element/document-fragment roots with a TreeWalker rooted at that subtree. Permit the body as a root only when the body itself was an added node.
    - Reuse the observer across explicit applies, use the latest Handle params at flush time, and retain explicit-pass behavior when observation is unavailable.
    - On undo, disconnect the observer and cancel/clear the observer timer and queue before conditional text restoration. Guard callbacks/timers after death and preserve idempotent undo.
    - Do not modify `skeleton/engine.js` or any other production skeleton file.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17, 4.18, 4.19, 4.20, 4.21_

  - [x] 2.2 Extend `skeleton/test/rot.test.js` for root scope, throttling, and restoration
    - Verify an explicit apply immediately walks the whole body and a later explicit apply cancels a pending observer timer/queue because its full pass supersedes that work.
    - With fake timers and actual jsdom mutation delivery, append eligible text at stable intensity 1; assert no observer pass at 249 ms, exactly one pass at 250 ms, and use of the latest explicit intensity/glyph params.
    - Deliver several callbacks inside one window and require one pass over all distinct roots. Cover duplicate/ancestor roots, removed roots, detached pruning, an added/replaced body, and direct adoption of one changed text node.
    - Instrument TreeWalker roots and/or text-node visits: after initial apply, append one subtree beside an unchanged sentinel and require every observer traversal root to be the appended subtree, never the body fallback, with the sentinel never visited. Add a changed-text case that visits only that exact text node.
    - Test observer identity across repeated apply calls, settlement of Rot-owned mutations without a feedback loop, and scheduling of no more than one observer pass per 250 ms during continuous traffic.
    - Test disconnect/timer cancellation before restore, exact restoration of initial and appended text, conditional preservation of later page rewrites, repeat undo, queued callback no-op, and untouched mutations after undo.
    - Test no-MutationObserver and no-documentElement fallbacks without changing the exported effect contract.
    - **Property 4: Rot observer work is bounded and reversible**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.15, 4.16, 4.17, 4.18, 4.19, 4.20, 7.2**

- [x] 3. Add deterministic skeleton synchronization and package validation
  - [x] 3.1 Implement `scripts/sync-doomscroll-skeleton.mjs`, commit the mirror, and wire package commands
    - Add synchronize mode and a read-only `--check` mode, resolving paths from the repository root and guarding that the generated target is exactly `app1-doomscroll/skeleton` before replacing it.
    - Copy all source files under root `skeleton/` except `skeleton/test/**`, in sorted relative-path order and without byte or line-ending rewrites. Remove stale generated files only inside the guarded generated target.
    - In check mode, compare the complete relative file sets and bytes, aggregate missing/extra/changed diagnostics, and perform no writes or timestamp changes.
    - Add `build:doomscroll` and `check:doomscroll` scripts. Change `npm test` to run `npm run check:doomscroll` before `vitest --run`, with failure short-circuiting Vitest.
    - Run the build to create `app1-doomscroll/skeleton/`, include the generated production files in the delivered Git change, and ensure no `.gitignore` rule matches that directory.
    - Export or isolate testable comparison helpers without adding runtime dependencies to the extension.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.10, 7.1_

  - [x] 3.2 Add Package Validator checks and tests
    - Parse both JSON files and run root `validateRules` with `builtinEffects`; assert exact rule ids/order, meter values, params, messages, and undo settings.
    - Assert Manifest V3, exact permissions, exact host sets, one classic top-frame content script, popup, module worker, and local-only executable resources.
    - Resolve every relative static `import` and `export ... from` edge from generated `skeleton/index.js`; reject bare, absolute, remote, missing, or extension-root-escaping imports.
    - Expand WAR declarations and require exactly the reachable JavaScript graph plus `rules.json`; reject generated test files and broader resources or origins.
    - Scan app-owned JavaScript and HTML for remote executable URLs, `eval`, `new Function`, string-valued timers, inline script bodies, and inline event-handler attributes; report the path and construct.
    - Add package tests for success and aggregated failures using temporary directories, including stale, missing, extra, and byte-changed skeleton files and each prohibited code form.
    - Verify that Git ignore rules do not match `app1-doomscroll/skeleton/` and that a drifted temporary/fixture mirror makes the check fail without writing. Verify the normal test script orders `check:doomscroll` before Vitest with failure short-circuiting.
    - **Property 1: Scope-bearing lists are exactly equal**
    - **Property 5: Generated skeleton identity is exact**
    - **Validates: Requirements 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 1.11, 2.1, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1**

  - [x] 3.3 Add the Kiro PostFileSave convenience hook
    - Use Kiro's hook creation tool/interface, not a manual file write, to create `.kiro/hooks/build-doomscroll-on-skeleton-save.json` with file format version `v1`, trigger `PostFileSave`, command `npm run build:doomscroll`, and a descriptive name.
    - Use an anchored positive cross-platform path matcher for direct files under the root `skeleton/` and descendants under the root `skeleton/effects/`; do not rely on lookahead. Prove that representative relative and absolute `/` and `\\` root-source paths match, while `skeleton/test/**` and `app1-doomscroll/skeleton/**` paths do not.
    - Commit the hook configuration. Document that it runs when Kiro emits the save event, may not cover manual or other-editor saves, and cannot replace the build/check commands or the `npm test` drift failure.
    - Do not duplicate copy logic in the hook; it must invoke the same authoritative build command.
    - _Requirements: 6.10_

  - [x] 3.4 Run the Package Validator from both sync modes and prove `check:doomscroll` fails on an extra permission
    - In the CLI entry of `scripts/sync-doomscroll-skeleton.mjs`, dynamically import `validatePackage` from `./validate-doomscroll-package.mjs`. Do not add a static import, and do not change the exported `check`, `build`, `compareFileMaps`, `listFiles`, `isExcluded`, `formatDiagnostics`, or `REPO_ROOT` contracts.
    - Build mode: after copying, run `validatePackage(REPO_ROOT)`; print every error to stderr and return exit code 1 on any error. Do not roll back the copied mirror.
    - Check mode: keep the drift comparison first. If drift exists, report it and return 1 without running the validator. Otherwise run `validatePackage(REPO_ROOT)`, print every error to stderr, and return 1 on any error. Perform no writes.
    - Print a success line only when both the mirror step and validation pass.
    - In `app1-doomscroll/test/package.test.js`, add a test that builds a temporary repository containing `package.json`, `scripts/`, root `skeleton/` without `skeleton/test/**`, and `app1-doomscroll/` with `manifest.json`, `rules.json`, and the generated `skeleton/`. First run the `check:doomscroll` npm script there and require exit code 0 as a control. Then add one extra permission (for example `tabs`) to the temporary `manifest.json`, run `check:doomscroll` again, and require a nonzero exit, a stderr line naming the `permissions` error, and no file content or mtime changes in the temporary repository. Run the npm script in a way that works on Windows and POSIX. Never modify the real `app1-doomscroll/manifest.json`.
    - Keep the existing `npm test` ordering (`npm run check:doomscroll && vitest --run`) and confirm `npm test` passes against the real package.
    - _Requirements: 6.5, 6.6, 7.1_

- [x] 4. Implement extension control state and popup
  - [x] 4.1 Implement the module service worker in `app1-doomscroll/background.js`
    - Define only the enumerated messages `doomscroll:content-state`, `doomscroll:popup-state`, `doomscroll:set-paused`, `doomscroll:set-demo`, `doomscroll:apply-paused`, and `doomscroll:ping`.
    - Store each true pause state in its own namespaced `chrome.storage.session` key ending in the tab id; treat missing/non-true values as unpaused and remove only that key on `tabs.onRemoved`.
    - For content-state requests, derive the tab id from `sender.tab.id` and ignore any payload id. For popup requests, validate an integer tab id and determine support through a content ping without reading URL/title fields.
    - Store one namespaced Boolean demo preference in `chrome.storage.local`, default malformed/absent values to false, and use structured `{ok:true}` / `{ok:false,error}` responses.
    - On pause changes, commit storage before notifying the tab. Return `{ok:true, paused, delivered:false}` when commit succeeds but the receiver is absent; return `{ok:false}` and send nothing when commit fails. Independent keys must keep simultaneous changes in different tabs isolated.
    - Return an asynchronous response in the Manifest V3-compatible listener pattern and reject unknown or malformed messages without side effects.
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.11, 5.12, 5.14, 5.15, 5.16_

  - [x] 4.2 Implement the minimal popup
    - Create `popup.html` with a heading, live status region, labelled `Pause on this tab` and `Demo mode on supported tabs` controls, and external `popup.js`/`popup.css` only.
    - Query the active tab id without reading sensitive tab properties, request confirmed status from the worker, and render active, paused, demo, unsupported, loading, and error states.
    - Disable only pause when content ping says unsupported. Keep demo available globally.
    - Send validated pause/demo commands and prevent duplicate in-flight changes. Roll a control back only when `ok` is false; when pause is committed with `delivered:false`, keep the confirmed value and show an unavailable notice.
    - Add restrained static styling with visible focus, disabled, and status states; add no animation.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.10, 5.11, 5.14, 5.15_

  - [x] 4.3 Add service-worker and popup Vitest coverage
    - Mock only the Chrome APIs used by each file and reset listeners/storage between tests.
    - Cover sender-derived ids, exact independent storage keys, malformed values, write-before-notify ordering, simultaneous per-tab isolation, tab removal, service-worker restart reads, demo defaults/updates, unknown messages, failed commits, and committed-but-undelivered results.
    - Cover accessible popup markup, active-tab lookup, supported/unsupported display, pause disablement, globally available demo, successful updates, duplicate-click suppression, failed-commit rollback, and committed unavailable rendering.
    - Assert that stored values contain no URL, text, history, or meter fields.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.11, 5.14, 5.15, 5.16, 7.3_

- [x] 5. Implement the classic loader and Runtime Controller
  - [x] 5.1 Implement profile transformation and single-instance reconciliation in `app1-doomscroll/content.js`
    - Keep `content.js` a classic script. Use a contained async bootstrap and no static imports or exports.
    - Model unknown/confirmed desired fields, separate pause/demo revisions, `normalSnapshot`, `demoSnapshot`, current instance, a serialized Promise queue, generation token, reduced-motion restart flag, disposed flag, and fault state.
    - Create Demo_Profile from a deep clone by dividing every threshold/ramp by 60, validate it through the dynamically loaded root API, and leave Normal_Profile deeply unchanged.
    - Reset demo meters on every actual demo Boolean transition, including while paused; preserve a demo snapshot only across pause/resume while demo remains continuously enabled; never merge it into normal meters.
    - Before replacing an instance, copy only `timeOnSite` and `scrollDistance` as required and call the current synchronous `stop`. Clear ownership only after stop returns; if stop throws, retain the reference, report one fault, and start no replacement.
    - Check generation after asynchronous package loading and before the synchronous `startPoltergeist` call, so obsolete state never creates an Engine. If start throws, enter a faulted state and do not retry automatically.
    - Restart the same profile from its snapshot when the reduced-motion media query changes while active; defer that work while paused.
    - **Property 2: Demo scaling preserves rule shape and order**
    - **Property 3: Runtime reconciliation owns at most one instance**
    - **Validates: Requirements 2.6, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.14, 3.16, 5.9, 5.10, 5.13, 5.17**

  - [x] 5.2 Wire packaged startup, revision-safe messages, and cleanup
    - Register the required content-side message, storage, media-query, and pagehide listeners before requesting initial state. Capture separate pause/demo revisions, merge each initial field only if no newer event changed it, and start no Engine until both fields are confirmed.
    - Cache one Promise that dynamically imports `chrome.runtime.getURL('skeleton/index.js')` and fetches/parses `chrome.runtime.getURL('rules.json')`; reject non-success responses before parsing.
    - Validate the Normal_Profile, check the current generation after package loading, and call the current synchronous `startPoltergeist` with the selected untouched document plus in-memory `initialMeters`.
    - Handle `doomscroll:ping` without changing state, accept `doomscroll:apply-paused` through the extension message channel, and reconcile `doomscroll.demoMode` changes from the local storage namespace.
    - Prefix one contained diagnostic per failed operation with `[poltergeist:doomscroll]`. On owned-stop failure retain the instance and fault; on pre-start failure remain clean; on an Entry_Point throw do not claim cleanup of an object that was never returned or retry automatically.
    - On pagehide, mark app state disposed before any queued callback can reconcile and let the skeleton's existing pagehide listener stop its returned instance.
    - Add no site-specific selector, behavior-meter storage, Storage Adapter, or skeleton Entry Point change.
    - _Requirements: 1.11, 3.1, 3.2, 3.3, 3.4, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 5.6, 5.8, 5.9, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17_

  - [x] 5.3 Add Runtime Controller and loader Vitest coverage
    - Exercise the classic loader in an isolated test context with fake module/fetch/Chrome boundaries; do not add a production app module merely for testing.
    - Verify exact 1/60 profile values, deep immutability, validation before start, normal/demo snapshot separation, paused off/on demo resets, pause precedence, and profile selection at startup.
    - Generate rapid pause/demo sequences and deferred package loads; require no synchronous Entry_Point call for stale generations, at most one instance, stop-before-start ordering, and a fault with retained ownership after stop failure.
    - Race live pause/demo events against the initial state response and require newer per-field revisions to win; cover reduced-motion restart and deferral while paused.
    - Cover dynamic runtime URLs, non-success rules response, bad JSON, validation failure, synchronous import/start/stop failure boundaries, listener messages, storage changes, pagehide disposal, and clean pre-start failures.
    - _Requirements: 2.6, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 5.8, 5.9, 5.10, 5.12, 5.13, 5.17, 7.3_

- [x] 6. Add unpacked-extension browser verification
  - [x] 6.1 Expand Vitest and Playwright discovery without regressing existing suites
    - Update `vitest.config.js` to include `app1-doomscroll/test/**/*.test.js` alongside the existing skeleton tests and continue excluding `.pw.js`.
    - Update `playwright.config.js` so the existing `skeleton/test/browser/**/*.pw.js` suite keeps its current browser behavior and `app1-doomscroll/test/browser/**/*.pw.js` runs once in its extension project.
    - Use Playwright's bundled Chromium channel for the unpacked-extension project, as required by current Playwright extension loading, while retaining the existing direct-effect browser project.
    - Keep a fixed viewport and deterministic timeouts; do not introduce watch mode.
    - _Requirements: 7.1, 7.4, 7.5_

  - [x] 6.2 Create the local feed fixture and persistent extension fixture
    - Add deterministic `app1-doomscroll/test/fixtures/feed.html` with several long, uniquely identified text posts, a fixed element if useful for restoration checks, and a fixture API that appends a post without site-specific production integration.
    - Run the read-only drift check, but do not run the build in browser fixture setup. Launch the committed `app1-doomscroll/` from a fresh persistent Chromium context and derive the extension id from its MV3 service worker, so the test proves a fresh checkout is complete.
    - Route `https://www.youtube.com/doomscroll-fixture` to the local HTML while preserving that approved URL; abort unexpected network access and allow required extension resource requests.
    - Capture page errors, worker errors, and namespaced diagnostics. Close the context and temporary profile in teardown on pass or failure, including Windows-safe cleanup retries.
    - _Requirements: 6.9, 7.5, 7.6, 7.12, 7.13, 7.14_

  - [x] 6.3 Verify the timed haunt and stable-plateau Rot regression in Playwright
    - Start the fixture in normal mode and assert it is initially clean. Open the popup URL only as an extension-origin control page, return the feed page to the foreground, and enable Demo_Mode through the production service-worker message protocol so visible-time metering continues.
    - Poll semantic DOM state and record first appearance. Require Fog before Flicker, Flicker before changed Rot text, Rot before Block, no later artifact at each earlier-stage checkpoint, the exact Block message, and pointer blocking at the 24-second demo point.
    - After elapsed demo time passes the 15-second Rot `rampTo` and the Engine is on its stable update plateau, append a long saved post and require it to change after the throttled observer window without an explicit Rot call.
    - Use text comparisons and effect data attributes rather than screenshots, exact applied fractions, or assertions that every character changes.
    - _Requirements: 2.12, 2.15, 2.16, 4.6, 4.7, 4.8, 4.10, 4.11, 4.16, 7.7, 7.8, 7.12, 7.14_

  - [x] 6.4 Verify pause, resume, restoration, and host exclusion in Playwright
    - Resolve the foreground fixture's tab id through extension APIs and send `doomscroll:set-paused` from the background extension-origin control page. Require all overlays to disappear, every retained original/added fixture string to be restored exactly, and a post appended while paused to remain unchanged.
    - Send the resume command through the same production protocol while Demo_Mode remains enabled. Bring/keep the fixture foreground, require one active sequence, and confirm later eligible appended text is processed again once Rot is active.
    - Open a second page on an unmatched routed origin and require no Doomscroll ping response, imported artifact, or Poltergeist DOM node.
    - Assert no unexpected page, worker, or extension errors and close all contexts in fixture teardown.
    - _Requirements: 1.10, 3.4, 3.5, 4.18, 4.19, 5.3, 5.4, 5.7, 5.9, 5.10, 7.9, 7.10, 7.11, 7.13, 7.14_

- [x] 7. Final checkpoint - verify the complete Doomscroll App
  - [x] 7.1 Verify committed packaging, drift enforcement, and all automated suites
    - Re-read the manifest, rule file, generated-copy policy, and implementation diff; confirm that no production skeleton file except `skeleton/effects/rot.js` changed and that no out-of-scope feature was added.
    - Confirm `app1-doomscroll/skeleton/` exists in the delivered Git change and is not ignored. Confirm the committed Kiro hook invokes only `npm run build:doomscroll` for current root production skeleton paths and excludes both `skeleton/test/**` and the Generated_Skeleton.
    - Before running any build, run `npm test` against the committed mirror. Require `check:doomscroll` to run before Vitest and all existing skeleton/new app suites to pass; separately exercise a drift fixture and require failure without repair.
    - Run `npm run build:doomscroll`, inspect that it creates no tracked content diff when the mirror was current, then run `npm run check:doomscroll` successfully.
    - Run `npm run test:browser`; its fixture must check but not build before loading the committed unpacked extension. Require both the existing direct-effect suite and Doomscroll extension suite to pass.
    - Confirm unit evidence covers explicit full-body Rot, mutation-root-only observer traversal, no unchanged sibling visit, one pass per 250 ms, pending-timer cancellation, and undo. Confirm browser evidence covers actual manifest injection, runtime-URL import, rules fetch, service worker, control messages, timed escalation, post-ramp appended text, pause, resume, and unmatched-host exclusion.
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.8, 1.9, 2.1, 2.16, 3.12, 3.14, 4.1, 4.6, 4.7, 4.8, 4.17, 4.18, 4.19, 4.21, 5.16, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14_

## Notes

- Every task is required. No optional task is used because the user explicitly requested packaging, controls, the Rot regression fix, drift detection, and unpacked-extension verification.
- `app1-doomscroll/skeleton/` is generated and committed package output, not an app fork. Never patch it directly; edit root `skeleton/`, run `npm run build:doomscroll`, review, and include both changes.
- `npm test` is read-only with respect to the mirror: it runs `check:doomscroll` first and must fail on drift rather than repair it.
- The committed Kiro PostFileSave hook shortens the feedback loop for Kiro-originated root production saves. It invokes the authoritative build command, excludes `skeleton/test/**` and the generated mirror, and is never cited as drift proof.
- Explicit Rot applies remain full-body and immediate. Observer work is limited to queued mutation roots, coalesced to at most one pass per 250 ms, and canceled on explicit supersession or undo.
- The Rot task supersedes only the earlier Haunt Engine choice not to observe DOM churn. The Engine's intensity epsilon and Tick behavior remain untouched.
- Normal and demo progression both use `timeOnSite`; demo changes only timing, not effects, params, message, matching, or reduced-motion behavior.
- `chrome.storage.session` pause state and `chrome.storage.local` demo preference are control state, not persisted behavior meters.
- The Playwright extension project uses bundled Chromium because current Playwright documentation says branded Chrome no longer accepts the required side-load flags. It still exercises the Manifest V3 Chrome-extension runtime.
- Browser waits should use semantic polling with slack around timers. Do not use fixed screenshots as primary evidence and do not require every character to rot.
- All file deletion in the build script must be guarded to the exact generated directory. The read-only check performs no writes.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "4.1", "5.1"] },
    { "id": 1, "tasks": ["2.2", "3.1", "4.2", "5.2"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "4.3", "5.3", "6.1"] },
    { "id": 3, "tasks": ["6.2"] },
    { "id": 4, "tasks": ["6.3"] },
    { "id": 5, "tasks": ["6.4"] },
    { "id": 6, "tasks": ["7.1"] }
  ]
}
```
