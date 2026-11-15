# Implementation Plan: Haunt Engine

## Overview

The design uses plain JavaScript (ES modules), matching the existing `skeleton/` code, so no language selection is needed. Requirements 1-8 describe behavior already implemented in `skeleton/`; their tasks are marked complete. Requirements 9-14 are new work.

Delivery order follows the design's hard constraint: Requirements 9, 10, 11 and 13 and their focused tests (including the Requirement 14 restoration tests) come before Requirement 12 (`storage-adapter.js`, `meter-store.js`, async `index.js`), because `app1-doomscroll` depends on those foundations.

Workspace rules that apply to every task:

- `skeleton/` is the single source of truth. Apps import it and never fork it.
- Effects live in `skeleton/effects/<name>.js` and export `{apply, undo, description}`.
- Effects operate on the whole page and never use site-specific selectors. Every effect has a working undo.
- Reduced motion swaps flicker for a static effect.
- Production files under `skeleton/` (excluding `skeleton/test/`) never contain the case-sensitive token `chrome.`.

## Tasks

- [x] 1. Set up test tooling
  - [x] 1.1 Add dev dependencies and test configuration
    - Add `jsdom`, `fast-check` and `@playwright/test` to `devDependencies` in `package.json`, keeping the existing `vitest` entry.
    - Add a root `vitest.config.js` that includes `skeleton/test/**/*.test.js` and excludes `**/*.pw.js`. Suites that need a DOM select jsdom with a per-file `// @vitest-environment jsdom` annotation.
    - Add a root `playwright.config.js` that matches `skeleton/test/browser/**/*.pw.js`, uses the installed Chrome channel and a fixed viewport.
    - Add a `test:browser` script (`playwright test`) and keep `test` as `vitest --run`.
    - Document that every property test runs at least 100 cases (`numRuns: 100`) and carries a comment of the form `// Feature: haunt-engine, Property N: <title>`.
    - _Requirements: 10.13, 10.14, 14.1_

- [x] 2. Existing baseline (Requirements 1-8, already implemented in `skeleton/`)
  - [x] 2.1 Rule validator and schema (`validator.js`, `rule-schema.json`)
    - Path-aware `validateRule`, `validateRules`, error aggregation, unknown-property, duplicate-id and result-invariant behavior, and the schema-sync test.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17_
  - [x] 2.2 URL matcher (`match.js`)
    - `compilePattern`, `isValidPattern` and `matchUrl` with compile caching.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_
  - [x] 2.3 Meter set (`meters.js`) time and window-scroll behavior
    - `timeOnSite`, `timeSinceActive`, window scroll distance, `initial` seeding, injectable clock and `dispose`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_
  - [x] 2.4 Engine (`engine.js`)
    - Intensity ramp, Tick semantics, apply/update/undo bookkeeping, fade tracking, error isolation, `start`/`stop`/restart and `activeRuleIds`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9_
  - [x] 2.5 Teardown helper (`effects/util.js`)
    - Shared teardown helper with finish-at-most-once semantics.
    - _Requirements: 5.7, 5.8, 5.9, 5.10, 5.11_
  - [x] 2.6 Built-in effects and registry (`effects/*.js`)
    - Current Fog, Flicker, Rot and Block implementations plus `builtinEffects`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 6.17, 6.18, 6.19, 6.20_
  - [x] 2.7 Entry point (`index.js`)
    - Synchronous `startPoltergeist` and its re-exports.
    - _Requirements: 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [x] 3. Scroll tracking in inner containers (Requirement 9)
  - [x] 3.1 Add capture-phase container scroll tracking to `skeleton/meters.js`
    - Register a document `scroll` listener with `{ capture: true, passive: true }` alongside the window listener.
    - Keep `lastWindowScrollY`, initialized at creation. Add a `WeakMap` of per-element `scrollTop` baselines.
    - Normalize targets. `document`, `document.scrollingElement` and the element representing the viewport use the shared viewport position. Other elements with a numeric `scrollTop` use their own entry. Unrecognized targets are ignored without throwing.
    - An element's first event records its baseline and adds 0. Equal positions add 0. Viewport and container distances sum into `scrollDistance`.
    - `dispose()` removes the document listener with the same callback and `capture: true`, and removes the window and visibility listeners.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 3.4_
  - [x] 3.2 Extend `skeleton/test/meters.test.js` for inner containers
    - Capture registration and removal with the same flag, target normalization, first-event baseline, independent containers, viewport plus container sums, same-position events, and no change after `dispose`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_
  - [ ]* 3.3 Write property test for scroll distance
    - Create `skeleton/test/properties/meters-scroll.property.test.js`.
    - **Property 5: Scroll distance is the summed path length per target**
    - **Validates: Requirements 3.4, 9.1, 9.3, 9.4, 9.6, 9.7**

- [ ] 4. Overlay-based Fog, Flicker and Block (Requirement 10)
  - [x] 4.1 Formalize teardown lifecycle in `skeleton/effects/util.js`
    - Make the live, fading and dead states explicit. Repeated positive-duration teardown is a no-op that keeps the original timer.
    - Zero-duration teardown cancels a pending fade timer and finishes once.
    - Finish runs at most once, and missing or dead Handles are ignored.
    - _Requirements: 5.7, 5.8, 5.9, 5.10, 5.11_
  - [x] 4.2 Rewrite `skeleton/effects/fog.js` as a fixed sibling overlay
    - Create one `div[data-poltergeist="fog"]` as a direct child of `documentElement`. Use `position: fixed`, `top/right/bottom/left: 0`, `pointer-events: none` and `z-index: 2147483645`.
    - Set `backdrop-filter: blur(B px) grayscale(G)` with `B = maxBlur * i` (default 6) and `G = maxGrayscale * i` (default 1), clamping `i` to [0, 1].
    - Update the same overlay in place on a live Handle. Zero-duration undo removes it immediately. Positive-duration undo transitions to `blur(0px) grayscale(0)` and removes it after `durationMs`.
    - Write no inline style on `documentElement` or `body`. Work when `body` is absent.
    - Keep the exports `{apply, undo, description}`.
    - _Requirements: 10.1, 10.3, 10.4, 10.7, 10.8, 10.9, 10.12, 10.15, 6.20, 5.7, 5.8, 5.9, 5.10_
  - [ ] 4.3 Rewrite `skeleton/effects/flicker.js` as a fixed sibling overlay
    - Create one black `div[data-poltergeist="flicker"]` as a direct child of `documentElement` with the geometry above, `pointer-events: none` and `z-index: 2147483646`. Create one `style[data-poltergeist="flicker"]` with a `pg-flicker` keyframes rule.
    - Without reduced motion: infinite opacity animation with period `periodMs` (default 1400), minimum opacity 0 and peak `maxDepth * i` (default 0.6).
    - With reduced motion (read `env.reducedMotion` on every apply): no animation and static opacity `maxDepth * i * 0.5`.
    - Update in place. Undo removes the overlay and style element synchronously for any duration. Write no root or body inline styles. Work when `body` is absent.
    - _Requirements: 10.2, 10.5, 10.6, 10.7, 10.10, 10.12, 10.15, 6.20_
  - [ ] 4.4 Update `skeleton/effects/block.js` to append to `documentElement`
    - Always append the overlay as a direct child of `documentElement`, whether or not `body` exists.
    - Keep `z-index: 2147483647`, `role="status"`, `opacity = maxOpacity * i`, the message text and threshold-based `pointer-events` (`auto` when `i >= blockAt`, otherwise `none`).
    - Keep fade undo (disable pointer events, fade opacity, then remove) and immediate undo.
    - Write no root or body inline styles.
    - _Requirements: 10.11, 10.12, 10.16, 6.13, 6.14, 6.15, 6.16, 6.17, 6.18_
  - [ ] 4.5 Write jsdom structural tests in `skeleton/test/effects.test.js`
    - Overlay parent, geometry and exact z-index stack (Fog 2147483645 < Flicker 2147483646 < Block 2147483647).
    - Fog and Flicker formulas, Flicker in both reduced-motion modes, update in place with unchanged overlay identity and artifact counts, missing `body`, and unchanged root and body `style` attributes.
    - Teardown helper cases: repeated positive fade is a no-op, zero-duration interrupts a fade, finish runs once, and dead Handles are no-ops.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12, 10.15, 10.16, 5.7, 5.8, 5.9, 5.10, 5.11_
  - [ ]* 4.6 Write property tests for overlay effects and teardown
    - Create `skeleton/test/properties/effects-overlays.property.test.js`, one `fc.assert` per property.
    - **Property 8: Teardown finishes each Handle at most once**
    - **Validates: Requirements 5.7, 5.8, 5.9, 5.10, 5.11**
    - **Property 11: Fog overlay scaling is exact and monotone**
    - **Validates: Requirements 10.3, 10.4**
    - **Property 12: Flicker maps parameters to the selected motion mode**
    - **Validates: Requirements 10.5, 10.6**
    - **Property 13: Block opacity and interaction follow intensity**
    - **Validates: Requirements 6.14, 6.15, 6.16**

- [ ] 5. Registry-derived effect types in the validator (Requirement 11)
  - [ ] 5.1 Derive allowed effect types from the supplied registry
    - In `skeleton/validator.js`, add an optional registry parameter to `validateRules(document, effects = builtinEffects)`. Support `validateRule(rule, path = 'rule', effects = builtinEffects)` plus the `validateRule(rule, effectsRegistry)` overload (a string argument is a path, an object is a registry).
    - Accept `effect.type` only when it is a string equal to an own key of the registry. A rejection error names `effect.type` and lists every key in deterministic order, including `[]` for an empty registry. Never mutate the rule or the registry.
    - Export `EFFECT_TYPES` as an immutable snapshot of `Object.keys(builtinEffects)`.
    - In `skeleton/rule-schema.json`, replace the `effect.type` enum with `{ "type": "string" }`.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 1.11_
  - [ ]* 5.2 Extend `skeleton/test/validator.test.js`
    - Custom, default and empty registries. Complete key list in diagnostics. Input immutability. Schema `effect.type` is a string with no enum. `EFFECT_TYPES` equals the `builtinEffects` keys. Meter and undo enums still match the schema.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 1.17_
  - [ ]* 5.3 Write property test for registry validation
    - Create `skeleton/test/properties/validator-registry.property.test.js`.
    - **Property 15: Effect validation is registry membership and is pure**
    - **Validates: Requirements 8.6, 11.1, 11.2, 11.3, 11.4, 11.5**

- [ ] 6. Rot detached-node pruning (Requirement 13)
  - [ ] 6.1 Prune detached nodes in `skeleton/effects/rot.js`
    - On every `apply` with a live Handle, delete every node-map entry whose node has `isConnected === false` before reading `document.body` or walking text. Do not touch any node's `data`.
    - Leave connected entries unchanged. Keep the enumerable `Map` so undo still restores a node only when `node.data === entry.out`, then clears the map.
    - Return the live Handle without walking when `body` is absent.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 6.11, 6.12_
  - [ ]* 6.2 Write Rot tests in `skeleton/test/rot.test.js` (jsdom)
    - Mixed and all-connected maps, no detached references after apply, text unchanged by pruning, retained entries unchanged, undo after removal does not throw and restores connected nodes, page rewrite adoption, and conditional restore.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 6.11, 6.12_
  - [ ]* 6.3 Write property test for Rot pruning
    - Create `skeleton/test/properties/rot-pruning.property.test.js`.
    - **Property 23: Rot pruning is an exact non-mutating partition**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6**

- [ ] 7. Restoration and real-browser verification (Requirements 14 and 10.13-10.14)
  - [ ] 7.1 Write jsdom restoration suite `skeleton/test/restoration.test.js`
    - Use `// @vitest-environment jsdom`. Snapshot = `documentElement.outerHTML` plus the `documentElement` and `body` `style` attributes, captured by value.
    - For every built-in effect, apply at 3 or more distinct intensities with the same Handle, then undo with `durationMs: 0` and require snapshot equality. Call undo a second time and require no throw and no change.
    - Fog and Block: fake-timer fade, advance exactly `durationMs`, then require equality. Start a fade, then call `undo(..., { durationMs: 0 })` without advancing timers and require equality.
    - Flicker with reduced motion off and on.
    - Rot scenarios: pre-existing text, every skipped element type, and a page rewrite followed by reapply then undo. Add a companion test where the rewrite is undone without reapply and the page text stays untouched.
    - Combined Fog, Flicker, Rot and Block undone in applied order, reverse order and an interleaved order (all 24 permutations if runtime is small).
    - State in a comment that this suite does not cover Requirement 10.13-10.14.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_
  - [ ]* 7.2 Write property test for built-in ownership invariants
    - Create `skeleton/test/properties/effects-ownership.property.test.js` (jsdom).
    - **Property 14: Built-in updates and cleanup preserve ownership invariants**
    - **Validates: Requirements 6.20, 10.7, 10.10, 10.12, 14.2, 14.3, 14.7**
  - [ ] 7.3 Write real-Chrome checks `skeleton/test/browser/effects.pw.js`
    - Load a deterministic local fixture with representative `position: fixed` elements and the packaged effect modules in a fixed viewport.
    - While Fog, Flicker and Block are all active, assert that the Block overlay's `parentElement` is `documentElement`, its computed `filter` and `backdrop-filter` are `none`, and its computed opacity equals its configured opacity within a narrow tolerance.
    - Assert that the bounding rectangles of the fixed fixture elements are unchanged before and during each effect and all three together.
    - _Requirements: 10.13, 10.14, 14.10_

- [ ] 8. Checkpoint - Foundations complete
  - Ensure all tests pass, ask the user if questions arise. Requirements 9, 10, 11 and 13 and their tests must be complete before Requirement 12 starts.

- [ ] 9. Persisted per-site meters (Requirement 12), core modules
  - [ ] 9.1 Add the Storage Adapter contract `skeleton/storage-adapter.js`
    - Export only JSDoc typedefs for `StorageAdapter` (`get(key)`, `set(key, value)`) and the `MeterRecord`, `MeterSnapshot` and `MeterSeed` shapes. Include no host or product adapter and no global API access.
    - Document that a synchronous throw equals a rejection, and that a rejected `set` means the value was not committed.
    - _Requirements: 12.1, 12.2, 12.3, 12.5_
  - [ ] 9.2 Implement `skeleton/meter-store.js`
    - `createMeterStore({ adapter, siteKey, onError, nowDate, setInterval, clearInterval })` returning `{ load, requestWrite, startPeriodic, stopPeriodic }`.
    - Site key is the lowercased hostname. Storage key is `` `poltergeist:meters:v1:${encodeURIComponent(siteKey)}` ``. The record date is the local `YYYY-MM-DD` built from `getFullYear`, `getMonth() + 1` and `getDate()`, never UTC.
    - `load()` accepts a same-date, fully valid record. It returns zeros for absent or stale records without an error. It returns zeros and reports one error for a malformed record or a failed `get`. It sets the baseline to the loaded seed.
    - `requestWrite` copies the two persisted meters synchronously. It runs one `get`/`set` chain at a time, keeps only the latest pending snapshot, and drains it afterwards.
    - A write treats an absent, malformed or stale stored record as zeros. Per component the delta is `max(captured - baseline, 0)`. It skips `set` when both deltas are 0. After a successful `set`, it advances only the components whose captured value did not move backward. It keeps the baseline unchanged on any failure and reports each failed operation once through a safe reporter that contains callback exceptions.
    - `startPeriodic(readMeters, 5000)` and an idempotent `stopPeriodic`. `timeSinceActive` is never persisted.
    - _Requirements: 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14, 12.15, 12.16, 12.17, 12.18, 12.19, 12.20, 12.21, 12.22, 12.23_
  - [ ]* 9.3 Write `skeleton/test/meter-store.test.js`
    - Key and date derivation (including a local date that differs from the UTC date), record validation, load paths (valid, absent, stale, malformed, `get` failure), delta writes, zero-delta skip, negative-delta handling, failure with baseline retained and later retry, one-at-a-time serialization and coalescing, and the 5000 ms periodic timer under fake timers.
    - A deterministic two-tab lost-update schedule (both read before either writes). It asserts the last-write-wins outcome and does not assert accumulation, so the accepted limitation stays visible.
    - _Requirements: 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14, 12.15, 12.16, 12.17, 12.18, 12.19, 12.20, 12.21, 12.22, 12.23_
  - [ ]* 9.4 Write property tests for keys, records and delta arithmetic
    - Create `skeleton/test/properties/meter-store-records.property.test.js`.
    - **Property 16: Site partition keys and local dates are deterministic**
    - **Validates: Requirements 12.7, 12.8, 12.9**
    - **Property 17: Stored record validation and daily reset are all-or-nothing**
    - **Validates: Requirements 12.13, 12.14, 12.15, 12.17**
    - **Property 18: Delta arithmetic is nonnegative and baseline advancement is success-only**
    - **Validates: Requirements 12.10, 12.16, 12.18, 12.19**
  - [ ]* 9.5 Write property tests for persistence round trip, failure and serialization
    - Create `skeleton/test/properties/meter-store-persistence.property.test.js`.
    - **Property 19: Single-tab persistence round trip preserves totals**
    - **Validates: Requirements 12.34**
    - **Property 20: Serialized two-tab writes accumulate commutatively**
    - **Validates: Requirements 12.35**
    - **Property 21: Failed writes retain the full retry delta**
    - **Validates: Requirements 12.20**
    - **Property 22: One Store serializes and coalesces write requests**
    - **Validates: Requirements 12.21**

- [ ] 10. Async entry point and host integration (Requirement 12)
  - [ ] 10.1 Make `startPoltergeist` asynchronous in `skeleton/index.js`
    - Declare it `async` and validate with the exact supplied `effects` registry before creating any Env, Meter Set, Meter Store, Engine, timer or listener. An invalid document rejects with an Error beginning `Invalid Poltergeist rules:` without reading the adapter. Resolve `window`, `document` and the error handler only after validation.
    - When `storageAdapter` is supplied, create the Meter Store for `location.hostname.toLowerCase()` and `await store.load()` before `createMeters({ initial })` and before `engine.start()`. A load failure reports once and starts from zeros, ignoring `initialMeters`.
    - Without an adapter, seed from `initialMeters` and perform no persistence and no timers.
    - Install the five-second periodic write and a `pagehide` listener. Resolve exactly `{ engine, meters, stop }`, where `stop` returns a Promise.
    - Implement one idempotent private shutdown with a cached promise. Capture `meters.values()` synchronously before `engine.stop()`, cancel the interval and queue one final write. Stop the Engine, dispose the Meter Set and remove the listener synchronously, then resolve after storage settles. `pagehide` runs the same steps without awaiting. Repeated stop or `pagehide` issues the final write only once.
    - Update the usage comment to show awaited startup with an injected adapter and no `chrome.` token. Keep the re-exports.
    - _Requirements: 12.6, 12.12, 12.23, 12.24, 12.25, 12.26, 12.27, 12.28, 12.29, 12.30, 12.31, 12.32, 12.33, 11.6, 8.8_
  - [ ] 10.2 Write `skeleton/test/index.test.js` for async startup and shutdown
    - Use deferred Promises and fake timers. Cover rejection on invalid rules before any adapter call, no Meter Set or first Tick before the load settles, and seeding from a same-date load.
    - Cover missing, stale, malformed and failed-load paths, the no-adapter path, the exact result shape, and the exact `effects` registry reaching validation and the Engine.
    - Cover the 5000 ms periodic write, explicit stop (capture before Engine stop, interval cancelled, effects undone immediately, Promise resolves after storage settles), `pagehide` with storage pending, and idempotent repeated stops.
    - Include a smoke test for the named re-exports.
    - _Requirements: 12.12, 12.23, 12.24, 12.25, 12.26, 12.27, 12.28, 12.29, 12.30, 12.31, 12.32, 12.33, 11.6, 8.8_
  - [ ]* 10.3 Write source-boundary test `skeleton/test/source-boundary.test.js`
    - Recursively scan every `.js` file under `skeleton/` except `skeleton/test/`, including comments, for the case-sensitive literal token `chrome.`. Report every violating path. Confirm that the capitalized `Chrome` prose in `match.js` does not match.
    - _Requirements: 12.4, 12.6_
  - [ ] 10.4 Update the usage comment in `skeleton/index.js`
    - Edit only the usage comment so it shows an awaited `startPoltergeist` call with an injected `storageAdapter`, and contains no `chrome.` token.
    - Host integration for `app1-doomscroll`, `app2-tab-graveyard` and `demo-site` (awaiting the async API, storage adapters, dynamic import of the skeleton, manifests and `web_accessible_resources`) is out of scope here and belongs in their own specs.
    - _Requirements: 12.6, 12.28_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise. Run `npm test` and, separately, `npm run test:browser` for the real-Chrome checks.

- [ ] 12. Property tests for the existing baseline (optional)
  - [ ]* 12.1 Write property tests for validation and matching
    - Create `skeleton/test/properties/validator-structure.property.test.js` and `skeleton/test/properties/match.property.test.js`.
    - **Property 1: Rule validation agrees with the structural reference model**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16**
    - **Property 2: URL matching agrees with component-wise OR semantics**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.11**
    - **Property 3: Pattern compilation is repeatable and cached**
    - **Validates: Requirements 2.10**
  - [ ]* 12.2 Write property tests for meters, intensity and Engine state
    - Create `skeleton/test/properties/meters-time.property.test.js` and `skeleton/test/properties/engine.property.test.js`.
    - **Property 4: Time meters agree with the visibility state model**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.11**
    - **Property 6: Intensity follows the bounded monotone ramp**
    - **Validates: Requirements 4.1, 4.2**
    - **Property 7: Engine transitions agree with an active-rule state model**
    - **Validates: Requirements 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 5.1, 5.2, 5.3, 5.5, 5.6**
  - [ ]* 12.3 Write property tests for Rot determinism and restoration
    - Create `skeleton/test/properties/rot.property.test.js` (jsdom).
    - **Property 9: Rot is deterministic and monotone by intensity**
    - **Validates: Requirements 6.8, 6.9**
    - **Property 10: Rot adopts rewrites and restores conditionally**
    - **Validates: Requirements 6.11, 6.12**

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Core implementation tasks are never optional. Tasks 4.5, 7.1, 7.3 and 10.2 are required.
- Task 2 documents behavior already implemented, so it is checked. Tasks 3 to 12 are new work. Task 12 (baseline property tests) is optional and runs after the final checkpoint (task 11).
- Host integration for the apps and the demo site (awaiting the async API, storage adapters, dynamic import, `web_accessible_resources`) belongs in their own specs. Task 10.4 only updates the usage comment in `skeleton/index.js`.
- Requirement 12 (tasks 9 and 10) must not start until tasks 3 to 7 are complete. This is the design's hard ordering constraint.
- Tasks 4.5, 6.2, 7.1 and 7.2 need jsdom. Task 7.3 needs real Chrome through Playwright, and jsdom evidence must never be cited for Requirement 10.13-10.14.
- Each property test uses `fc.assert` with `numRuns` of at least 100 and a `// Feature: haunt-engine, Property N: <title>` comment.
- Requirement 12.22 (accepted non-atomic cross-tab interleaving) is covered by a deterministic example test, not an accumulation property.
- Long-running watchers should not be started by agents. Run tests with `vitest --run`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.2", "4.3", "4.4", "5.2", "5.3", "6.2", "6.3"] },
    { "id": 3, "tasks": ["4.5", "4.6", "7.1", "7.2", "7.3"] },
    { "id": 4, "tasks": ["9.1"] },
    { "id": 5, "tasks": ["9.2"] },
    { "id": 6, "tasks": ["9.3", "9.4", "9.5", "10.1"] },
    { "id": 7, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 8, "tasks": ["12.1", "12.2", "12.3"] }
  ]
}
```
