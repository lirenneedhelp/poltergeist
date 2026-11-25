# Implementation Plan: Haunt Kit

## Overview

The plan follows the part order of the design: the Kiro authoring workflow first, then the Candle Path ritual (the showcase), then the Doomscroll finale and packaging, the Scaffolder, the Playground and the README guides. Code is plain JavaScript (ES modules) as in the existing skeleton. Every test is an example-based Vitest or Playwright test that loops over fixed, hard-coded lists where a statement must hold for many inputs. No property-based testing library is used, and tests sit inside the implementation tasks they verify. Test comments use `// Haunt Kit invariant <N>: <title>` to point to the numbered invariants in the design's Correctness Properties section.

Graveyard is touched in two places only: the two `web_accessible_resources` strings (task 7.2) and the `scripts.pretest` expectation in its package test (task 9.1). No task depends on the content of Graveyard's `content.js`, `background.js`, popup files or validator internals, because the graveyard-groups spec changes them first.

## Tasks

- [x] 1. App_Registry file and Rules_Hook
  - [x] 1.1 Move the App_Registry to `scripts/app-registry.json` and load it in the Skeleton_Sync
    - Create `scripts/app-registry.json` with the `doomscroll` and `graveyard` entries, one entry per line, as in design section 1.3
    - In `scripts/sync-skeleton.mjs` add `REGISTRY_PATH` and `loadRegistry(file)` (shape checks on key, `dir`, `label`, `validator`, `buildScript`; throws naming the file and the bad field) and keep exporting a deep-frozen `APPS = loadRegistry()`
    - Make `runValidator` call `validatePackage(repoRoot, { key, ...APPS[key] })`; leave `parseArgs`, `check`, `build`, messages and exit codes unchanged so `sync.test.js` keeps passing
    - Set `vitest.config.js` `include` to `['skeleton/test/**/*.test.js', 'app*/test/**/*.test.js', 'test/**/*.test.js']`
    - _Requirements: 3.3, 3.7, 13.1, 13.3, 16.5_

  - [x] 1.2 Implement the Rules_Hook
    - Create `scripts/rules-hook.mjs` exporting `findRulesPath(event)`, `appForRulesPath(filePath, { repoRoot, apps })` and `run({ filePath, repoRoot, apps, check })`, with the CLI flow of design section 1.4 (path from `argv[2]`, else from STDIN event JSON, resolved against `cwd`)
    - Map only `<dir>/rules.json` directly inside a registered `dir`; print the "nothing to check" line and exit 0 otherwise; run exactly that app's Package_Check in-process and exit with its code; write nothing
    - Create `.kiro/hooks/check-rules-on-save.json` (`v1`, one `PostFileSave` hook, matcher `(?:^|[\\/])rules\.json$`, command `node scripts/rules-hook.mjs`, timeout 120)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 1.3 Write `test/rules-hook.test.js`
    - Example-based checks (invariant 16): `app1-doomscroll/rules.json`, `app1-doomscroll\rules.json`, `./app1-doomscroll/rules.json` and the absolute form map to `doomscroll`; `app2-tab-graveyard/rules.json` maps to `graveyard`; `demo-site/presets/doomscroll.json`, `app1-doomscroll/skeleton/rules.json`, root `rules.json` and a path outside the repository map to no app; an event JSON carrying a path is handled the same way
    - Check the hook file's trigger, command action and matcher (matches `rules.json` with both separators, rejects `myrules.json` and `rules.json.bak`)
    - Check the exit code is non-zero when the mapped check fails and 0 otherwise, that the saved file's bytes are unchanged, and that an entry added to a temporary repository's registry is found with no hook edit
    - _Requirements: 3.2, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 2. Steering doc, Effect_Hook and README seed
  - [x] 2.1 Write the Steering_Doc `.kiro/steering/haunt-authoring.md`
    - Front matter `inclusion: fileMatch` and `fileMatchPattern: ["skeleton/effects/**", "skeleton/ritual/**", "**/rules.json"]`
    - Sections "Effect contract" (items a to j), "Meter rules" (items a to d, meters with units, `timeAway` and `timeOnSite` resettable), "Ritual contract" (items a to f) and "Adding an effect" (the six numbered steps), each rule one list item, worded as in Requirement 1
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Create the Effect_Hook and document both hooks
    - Create `.kiro/hooks/new-effect.json` (`v1`, one `PostFileCreate` hook with an `agent` action) with the matcher and the fixed prompt from design section 1.2, including the stop instruction for files that export no `apply`
    - Add `## new-effect.json` and `## check-rules-on-save.json` sections to `.kiro/hooks/README.md`: file names, accepted and excluded paths, the `poltergeist` folder-name convention, and that the Effect_Hook fires only on file-create events Kiro emits
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.3 Create the README seed
    - Create `README.md` with a short introduction and an `## Effects` section listing each effect registered in `skeleton/effects/index.js` as ``- `<name>`: <description>``, with text equal to its `description` export
    - _Requirements: 15.5_

  - [x] 2.4 Write `test/authoring.test.js`
    - Steering doc (invariant 21, steering part): front matter patterns equal Requirement 1.1; the meter names under "Meter rules" equal the schema's meter set; the resettable names equal the names for which `meters.reset` returns true (task 4.1 runs in an earlier wave)
    - Effect_Hook (invariant 15): trigger `PostFileCreate`, action type `agent`, matcher contains no lookaround, matches `skeleton/effects/<name>.js` with `/` and `\`, `./`-prefixed and absolute Windows and POSIX paths; rejects one example each for `skeleton/test/`, `skeleton/ritual/`, `app1-doomscroll/skeleton/effects/`, `demo-site/skeleton/effects/`, a subfolder of `skeleton/effects/` and a non-`.js` file; prompt lists the five steps in order and contains the stop sentence
    - Hooks README has both sections
    - _Requirements: 1.6, 2.6, 2.5_

  - [x] 2.5 Write `test/docs.test.js` with the effect-list check
    - Assert the README `## Effects` lines map every registered effect name to its `description` export and list no unregistered effect
    - _Requirements: 15.5_

- [x] 3. Candle Path generator
  - [x] 3.1 Implement `skeleton/ritual/candle-path.js`
    - Pure module with no imports, no DOM and no `chrome.*`; export `generateBoard({ size, candles, random })` and `checkPath(board, path)`
    - Option resolution (size 3 to 7 else 5; candles 2 to min(9, size²) against the resolved size else 5; `random` a function else `Math.random`; clamped `randomInt`)
    - Serpentine start plus `30 × size²` backbite moves; candle 1 on `solution[0]`, candle N on the last cell, middle candles on distinct sorted indices; fresh cell copies; never mutate options
    - `checkPath` returns true only for a full, repeat-free, Adjacent path meeting candles 1..N in order, with explicit end checks; never throws or mutates
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.10, 4.11_

  - [x] 3.2 Write `skeleton/test/candle-path.test.js`
    - Five-line mulberry32 PRNG and fixed `SEEDS = [1, 2, 3, 7, 42, 99, 1234, 2024, 31337, 65535]`
    - Invariant 1: for each seed and each size 3 to 7, and each listed invalid option, the Board has the resolved size and candle count, a valid `solution`, candles in `solution` order, `checkPath(board, board.solution)` true, and an unmodified options object
    - Invariant 2: same seed gives deep-equal Boards; at least two different `solution` orders at size 5
    - Invariant 3: `checkPath` false for empty path, skipped cell, repeated cell, non-Adjacent step, wrong first cell, wrong last cell, candles out of order, a non-array and bad cell coordinates; no throw; inputs unchanged
    - _Requirements: 4.8, 4.9, 4.11_

- [x] 4. Make `timeOnSite` resettable
  - [x] 4.1 Extend `meters.reset` in `skeleton/meters.js`
    - Accept `timeOnSite` (set to 0, return true); keep `timeAway` as is; return false and change nothing for `scrollDistance`, `timeSinceActive` and unknown names
    - _Requirements: 10.8, 16.8_

  - [x] 4.2 Update `skeleton/test/meters.test.js`
    - Edit only the assertion in "reset of any other meter changes nothing and returns false": remove `'timeOnSite'` from the names that must return false
    - Add examples (invariant 13): `reset('timeOnSite')` returns true and `values().timeOnSite` is 0; `scrollDistance`, `timeSinceActive`, `bogus` and `undefined` return false with `values()` deep-equal to before
    - _Requirements: 10.8, 16.2, 16.8_

- [x] 5. Ritual effect, created through the Effect_Hook
  - [x] 5.1 Create `skeleton/effects/ritual.js` as a new file in Kiro so the Effect_Hook fires
    - Create the file with Kiro's file-create tool (not from a terminal or git), so the `PostFileCreate` Effect_Hook runs; record in `KIRO_FILES.md` that the hook prompt ran and what it changed, or that it did not fire and the five steps were done by hand
    - First version: `description`, param resolution table of design section 2.2, `apply` (intensity clamp, opacity `round3(maxOpacity × i)`, `pointer-events` by `blockAt`, one-time focus of the Board, heading and instructions update on a live handle), the Ritual_Host with open shadow root and zero light-DOM children, the static stylesheet, Ritual_Veil, Board grid, trail, status line with `aria-live="polite"`, Reset and Hint buttons, and `render` (candle `data-lit` and `aria-label`, status text per design section 2.5, veil opacity `round3(0.85 × (S − Filled_Count) / (S − 1))`; the squares-based status and veil are the playtest amendment, implemented in task 13.1)
    - `undo` through `util.js` `teardown` with `begin` and `finish` per design section 2.8 (instant for 0, absent or invalid durations; linear fade with motion; instant opacity 0 under Reduced_Motion; repeat calls per `teardown`), removing every listener and the host
    - Use only `createElement`/`createElementNS` and `textContent`; no resource loads, no nodes under `head` or `body`, background channels at most 64, no "zip" anywhere
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.3, 6.10, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 5.2 Hook-driven step 1 and 2: register the effect and document its params
    - Add `import * as ritual from './ritual.js'` and `ritual` to `builtinEffects` in `skeleton/effects/index.js`
    - Add `definitions["params-ritual"]` to `skeleton/rule-schema.json` with a `description` for the effect and, for `heading`, `instructions`, `size`, `candles`, `sound`, `maxOpacity` and `blockAt`, the type, range keywords, `default` and a `description` stating default and range in words; keep `effect.properties.type` equal to `{ "type": "string" }`
    - _Requirements: 5.1, 11.3_

  - [x] 5.3 Hook-driven step 3: restoration and reduced-motion tests
    - In `skeleton/test/restoration.test.js`, edit only "has exactly the five built-in effects": expected keys become `[...NAMES, 'tombstone', 'ritual']` and the title says "six"
    - Add a `ritual` describe block: apply-then-undo with Reduced_Motion false, Reduced_Motion true, and `undo` with `durationMs` 300; each asserts the Restored_State and that no `div[data-poltergeist="ritual"]` remains
    - Add a reduced-motion test: no `animate()` call, no inline `animation` or `transition`, no `@keyframes` in the shadow stylesheet, computed `animation-name` `none`
    - _Requirements: 7.8, 9.7, 16.2_

  - [x] 5.4 Hook-driven steps 4 and 5: rebuild copies and update the README
    - Run `npm run build:skeletons` so every Generated_Skeleton gets `skeleton/effects/ritual.js` and `skeleton/ritual/candle-path.js`; never edit a Generated_Skeleton by hand
    - The app Package_Validators will report the two new modules missing from `web_accessible_resources`; this is expected and fixed in task 7.2, so do not edit any manifest here
    - Add the `ritual` line to the README `## Effects` list with text equal to its `description` export
    - _Requirements: 11.1, 15.5_

  - [x] 5.5 Implement path drawing in `ritual.js`
    - Input guard on every handler (`isTrusted === true` and handle LIVE); handlers exposed on `handle.on` for tests
    - `tryMove` with retract, the candle-N-lit rule, grid, adjacency, on-path and next-candle checks; `update` recomputes Lit_Count and renders before the handler returns
    - Pointer drag from the Path_End only (primary button, pointer capture release, `pointerover` moves, `pointerup`/`pointercancel` on `env.window`); arrow keys on the focused Board with `preventDefault` and `stopPropagation` on every arrow key and no other key; Reset and Hint per design section 2.4
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.11, 6.12, 6.13, 6.14_

  - [x] 5.6 Implement completion and the Banishing_Ending in `ritual.js`
    - `complete` when `checkPath` is true after a move or Hint: status `N of N candles · S of S squares` (playtest amendment, task 13.1), no further path changes
    - Motion allowed: ghost SVG fade with `animate` when available and a one-shot 1200 ms timer that sets `exorcised` and calls `fireExorcised` last; Reduced_Motion: set `exorcised` and call `fireExorcised` in the same handler with no animation
    - `fireExorcised` logs `[poltergeist] ritual …` with `console.error` when `env.onAction` is missing or throws, keeping the Board shown; at most one action per handle; `begin` and `finish` clear the ending timer and cancel the animation so undo during the ending makes no action; no `chrome.*`, `window.close`, `location` or `beforeunload`/`unload`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x] 5.7 Implement the optional Web Audio chime in `ritual.js`
    - `startChime` once per handle when candle N first lights and `sound === true`; `chimed` set first; generated oscillator sound stopping at most 1 s after start; errors and a missing API logged with `[poltergeist]` without blocking completion
    - `stopChime` in `begin` and `finish` stops the oscillator and closes the context before `undo` returns, swallowing failures
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 5.8 Write `skeleton/test/ritual.test.js`
    - jsdom tests with `makeEnv`, `installAnimateSpy` and fake timers; trusted input through `handle.on.*` with `{ isTrusted: true }` objects
    - Invariant 4 (apply opacity, pointer-events and param defaults over fixed lists; live-handle stability with different `size` and `candles`); invariant 5 (move acceptance over scripted states and targets, keyboard and drag agree); invariant 6 (render matches path for N in 2, 5, 9); invariant 7 (Reset and Hint; Hint completes after `size² − 1` activations); invariant 8 (exactly one `exorcised` at 1200 ms, none at 1199 ms, same-handler under Reduced_Motion, none after undo at 0, 600 or 1199 ms); invariant 9 (untrusted `pointerdown`, `pointermove`, `pointerover`, `keydown` arrows, Space and Enter, and `click` on a Cell, the Board, Reset and Hint change nothing); invariant 11 (no motion under Reduced_Motion); invariant 12 (stubbed `AudioContext`: one context for `sound` true, none for false or `"true"`, completion still fires when the constructor throws, `undo` closes the context)
    - Source scans of `ritual.js` for `innerHTML`, `url(`, `chrome.`, `window.close`, `location`, `beforeunload` and audio file extensions; DOM checks for the light-DOM-free host, colour limits and no "zip"
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.8_

  - [x] 5.9 Extend the Restoration_Suite for the ending and duration cases
    - In `skeleton/test/restoration.test.js` add `undo` 600 ms into the 1200 ms Banishing_Ending (Restored_State, no ritual host, no Exorcised_Action after advancing 2000 ms more), durations 0, absent, −5, `NaN` and `Infinity`, the host still present 1 ms before a positive duration ends, a second `undo` as a no-op, and `sound` true with a stubbed audio context closed before `undo` returns (invariant 10)
    - _Requirements: 8.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 5.10 Write `skeleton/test/ritual-compat.test.js`
    - `startPoltergeist` with a registry without `ritual` and rules without `ritual` starts and applies and undoes as before
    - Rules that use `ritual` with such a registry throw `Invalid Poltergeist rules:` with `rules[<i>].effect.type: must be one of [fog, flicker, rot, block, tombstone]`, with no meter listeners and no effect DOM created
    - _Requirements: 16.6, 16.7_

  - [x] 5.11 Hold_Ritual decision point and final rebuild
    - Run `npx vitest --run skeleton/test`. If any test for Requirements 5 to 8 still fails, replace the Board part of `ritual.js` with the Hold_Ritual of design section 2.11 (three candles, one hold button, chained one-shot 1000 ms timers, release unlights all, completion at 3000 ms), keep every other part, adapt the Board-specific tests to the Hold_Ritual, and record the decision and its reason in `KIRO_FILES.md` and in `design.md`
    - If every test passes, write no Hold_Ritual code
    - Run `npm run build:skeletons` so every Generated_Skeleton matches the final `ritual.js`
    - _Requirements: 9.9, 9.10, 9.11, 11.1_

- [x] 6. Checkpoint - Ensure the skeleton and authoring tests pass
  - Run `npx vitest --run skeleton/test test/authoring.test.js test/rules-hook.test.js test/docs.test.js`. The full `npm test` package checks pass only after task 7.2 adds the two resource strings. Ensure all tests pass, ask the user if questions arise.

- [x] 7. Doomscroll finale and packaging
  - [x] 7.1 Add the fifth Doomscroll rule and extend its Package_Validator
    - Append `doomscroll-ritual` to `app1-doomscroll/rules.json` exactly as in design section 3.1, leaving the four existing rules byte-identical and in order
    - Add the fifth `EXPECTED_RULES` entry in `scripts/validate-doomscroll-package.mjs` and the `trigger must be timeOnSite 1500 with no rampTo` message when `rampTo` is undefined
    - _Requirements: 10.1, 10.2, 10.9_

  - [x] 7.2 Add the two resource strings to both manifests
    - Add `skeleton/effects/ritual.js` and `skeleton/ritual/candle-path.js` to `web_accessible_resources[0].resources` in `app1-doomscroll/manifest.json` and `app2-tab-graveyard/manifest.json`; change nothing else in either manifest and leave the rest of Graveyard's list as it is
    - _Requirements: 10.7, 11.2, 16.4_

  - [x] 7.3 Wire `onAction` in `app1-doomscroll/content.js`
    - In `doomscrollCreateController`, pass `onAction: (name) => handleAction(entry, name)` to `startPoltergeist` and store `entry` as `state.current`
    - `handleAction` ignores names other than `exorcised` and stale or disposed instances, calls `entry.ghost.meters.reset('timeOnSite')`, reports a false or throwing reset with `reportOnce` under the `[poltergeist:doomscroll]` prefix, then calls `entry.ghost.engine.tick()` with its own guarded report; no `stop`, no new instance, no other meter touched
    - _Requirements: 10.3, 10.4, 10.5, 10.6, 10.7, 10.11, 10.12_

  - [x] 7.4 Edit the named Doomscroll test assertions
    - `app1-doomscroll/test/package.test.js` "has the exact rules (ids, order, meters, params, message, undo)": undo list gains a fifth `{ mode: 'fade', durationMs: 600 }`
    - `app1-doomscroll/test/content.test.js` "produces the 2-5 / 5-10 / 10-15 / 20-25 second demo stages that validate": expected stages gain `[25, undefined]` and the title gains "/ 25"
    - `app1-doomscroll/test/content.boot.test.js` "demo values are exactly normal/60 and the normal profile is untouched, including nested data": threshold list becomes `[2, 5, 10, 20, 25]` and a missing `rampTo` maps to `undefined`
    - Change nothing else in these files
    - _Requirements: 16.1, 16.2_

  - [x] 7.5 Write `app1-doomscroll/test/finale.test.js`
    - Controller harness recording `onAction`, `reset` and `tick` (invariant 14): an unknown action name, `exorcised` on the current instance (one reset, one tick, no stop or restart), `exorcised` from an instance replaced by pause, Demo_Mode toggle or motion restart, after dispose, and a reset that returns false or throws
    - Real skeleton in jsdom with the Doomscroll rules (match `<all_urls>`, seeded at `timeOnSite` 1500) and a wrapped registry recording each `undo` duration: Fog 400, Block and ritual 600, Flicker and Rot instant; Fog returns after `timeOnSite` restarts from 0; a later pause and resume continues from the reset value
    - Demo profile check that the ritual threshold is 25; scan that the content script adds no `beforeunload` and sends no tab-closing, reloading or navigating message; manifest permissions unchanged
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.11, 10.12, 10.13_

  - [x] 7.6 Write `test/packaging.test.js`
    - Temporary repository copies (whole app folders without `test/`)
    - Invariant 17: after `build:skeletons` each app's Generated_Skeleton equals the Skeleton byte for byte with no `skeleton/test/` file; one changed line in a copied `skeleton/effects/ritual.js`, a missing `skeleton/ritual/candle-path.js` and an extra file each make `check:skeletons` exit non-zero and name the file
    - Invariant 18 (Doomscroll and Graveyard parts): Doomscroll validator errors for a missing fifth rule, each changed field of the fifth rule, and each new module removed from `web_accessible_resources`; Graveyard validator error naming `skeleton/effects/ritual.js` when it is removed; both `ok` on unmutated copies
    - Schema check that `params-ritual` documents every param with default and range and `effect.properties.type` stays `{ "type": "string" }`
    - _Requirements: 10.9, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 7.7 Write `app1-doomscroll/test/browser/finale.pw.js`
    - In the doomscroll-extension Playwright project with Demo_Mode on: wait for the Ritual_Host after Block blocks pointers, make trusted Hint clicks until the status reads `5 of 5 candles · 25 of 25 squares` (playtest amendment, task 13.4), expect no `[data-poltergeist]` element within 2 s of the last click and the Fog element back within 5 s
    - _Requirements: 10.10_

- [ ] 8. Scaffolder generation
  - [ ] 8.1 Implement the Generic_Validator `scripts/validate-app-package.mjs`
    - `validatePackage(repoRoot, app)` with the manifest, `rules.json` and code checks of design section 4.4, using `resolveGraph`, `expandWar` and `scanSource`; one error line per failed rule starting with the app-relative path; the missing-`dir` error; never writes
    - _Requirements: 12.5, 12.6, 12.10, 13.4_

  - [ ] 8.2 Write the Generated_App templates in `scripts/templates/haunt/`
    - `content.js.tpl` (classic script, `hauntCreateDemoProfile`, message listener with sender check, `content-state` read with safe defaults, `getURL` loading, pause stop and restart from 0, Demo_Mode read at load, no DOM selectors)
    - `background.js.tpl` (`createBackground(chromeApi)`, keys prefixed with the Haunt_Name in `storage.session` and `storage.local`, extension-page sender checks, safe defaults on storage errors)
    - `popup.html.tpl`, `popup.js.tpl`, `popup.css.tpl` (Pause and Demo toggles, status line, `textContent` only, no inline script)
    - `test/package.test.js.tpl` and `test/background.test.js.tpl` starter tests per design section 4.3
    - _Requirements: 12.4, 12.7, 12.8, 12.9, 12.10, 12.11, 12.14_

  - [ ] 8.3 Implement the Scaffolder `scripts/new-haunt.mjs`
    - Export `parseArgs`, `isAllowedHost`, `nextAppNumber`, `renderTemplate`, `scaffold` and `main`; all input checks before any write (name pattern, `--root` contents, 1 to 20 `--hosts` with scheme `http`, `https` or `*`, no existing registry key or `build:<name>`/`check:<name>` script, no existing target folder)
    - Build `manifest.json` and `rules.json` from data (reachable modules via `resolveGraph`; Fog and Rot starter rules on `timeOnSite`), render the templates, append the registry entry as one line, add `build:<name>` and `check:<name>` to `package.json`, then run the build and Package_Check in a child process
    - Snapshot registry and `package.json` bytes first; on any failure after the folder exists, delete only the planned folder, restore both files byte-for-byte, print `new-haunt: <step> failed: <reason>` (naming the file for write failures) and exit 1; print the created folder and exit 0 on success
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.12, 12.13, 13.1, 13.2, 13.5_

- [ ] 9. Scaffolder wiring and tests
  - [ ] 9.1 Wire `npm test` and the `new-haunt` script
    - In `package.json` set `"pretest": "npm run check:skeletons"` and add `"new-haunt": "node scripts/new-haunt.mjs"`; keep `"test"` and every existing script name unchanged
    - In `app2-tab-graveyard/test/package.test.js` "runs check:graveyard from pretest and leaves the test script unchanged", change only the `scripts.pretest` expectation to `npm run check:skeletons`; leave the `scripts.test` expectation and the rest of the file unchanged
    - _Requirements: 13.3, 16.2, 16.5_

  - [ ] 9.2 Write `test/scaffolder.test.js`
    - Temporary repository copies with a `node_modules` junction, `--root`, `spawnSync`, about 120 s timeout; real-repository snapshot (size, mtime, hash; excluding `node_modules/`, `.git/`, `test-results/`) equal before and after
    - Invariant 19: successful runs with default hosts and three custom hosts, with and without existing `app<N>-*` folders, give `app<N>-<name>`, one appended registry entry with existing entries byte-identical, the two npm scripts, a passing Package_Check and passing starter tests; failing runs (invalid name, existing registry key, existing target folder, 0 or 21 hosts, `<all_urls>`, missing root, a failure forced after the first file write) exit non-zero and leave the root byte-identical
    - Invariant 18 (Generic part): each manifest field of Requirement 12.5, a `match` differing from the hosts, a removed Fog or Rot rule, `eval` in `background.js`, an inline script in `popup.html` and `querySelector` in `content.js` each produce an error naming the file
    - jsdom run of the generated `popup.js` with a `chrome` mock and VM run of the generated `content.js` (pause stop and restart, Demo_Mode division, storage failure defaults)
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14, 13.1, 13.2, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [ ] 9.3 Run the manual Chrome check for a Generated_App and record it
    - Generate an app with `--root` into a temporary copy, load it unpacked in Chrome, turn Demo_Mode on, open a page matching its hosts and check that Fog appears within 7 s; record the date, Chrome version and result in `KIRO_FILES.md`
    - _Requirements: 13.9_

- [x] 10. Haunt Playground
  - [x] 10.1 Add the Playground sync target to `scripts/sync-skeleton.mjs`
    - Add `SITE`, `checkSite(repoRoot)` and `buildSite(repoRoot)` per design section 5.1; `main` processes the site after the apps when no `--app` is given; keep `parseArgs` and the per-app build lines unchanged
    - Run `npm run build:skeletons` to write `demo-site/skeleton/` and `demo-site/presets/doomscroll.json` and `graveyard.json`
    - _Requirements: 11.1, 11.4, 14.2_

  - [x] 10.2 Build the Playground page
    - `demo-site/index.html` (header, `main#feed`, `aside#panel[popover="manual"]` with preset buttons and the Graveyard note, speed slider and output, rules editor, Apply, Stop, error list, "Try the ritual" and its status), `playground.css`, `playground.js` (boot only) and `playground-core.js` (`scaleRules`, `renderFeed`, `createPlayground`) per design sections 5.2 and 5.3
    - Relative paths inside `demo-site/` only, no inline scripts, no remote code, no `eval`, all runtime text via `textContent`
    - _Requirements: 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.12_

  - [x] 10.3 Add the local server and the Playwright project
    - Create `scripts/serve-playground.mjs` (`startServer`, 127.0.0.1, GET and HEAD only, path containment, no listing, small content-type map) and add `"playground": "node scripts/serve-playground.mjs"` to `package.json`
    - Add the `playground` project to `playwright.config.js` with `testDir: 'test/browser'`
    - _Requirements: 14.1, 14.11_

  - [x] 10.4 Write `test/playground.test.js` and extend the packaging drift checks
    - jsdom tests of `createPlayground` with a recording API and a fake `fetch` (invariant 20): each preset, a valid hand-written list, invalid JSON and invalid rules at speeds 1, 60, 600 and 3600; `#speed` has `max` `3600` and `clampSpeed` keeps 3600 and clamps 3601 to 3600; the Graveyard note's text equals the exact sentence of Requirement 14.8; Apply all-or-nothing, error lines and clearing, `match` set to `['<all_urls>']`, editor text unchanged, speed restart from the last accepted rules, preset load failure naming the preset, "Try the ritual" undo and completion message
    - Scans of `demo-site/` HTML and JS outside `skeleton/` for inline scripts, remote URLs, `eval` and `innerHTML`; server path containment and method checks
    - In `test/packaging.test.js` add the Playground targets to invariant 17: `demo-site/skeleton/` equals the Skeleton, each Preset equals its app's `rules.json`, and a changed preset or Playground copy makes `check:skeletons` fail and name the file
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.12_

  - [x] 10.5 Write `test/browser/playground.pw.js`
    - Start the server on port 0, open the Playground, block and record other-origin requests, check at least 20 posts and page height above the window, check that `#speed` has the `max` attribute `3600`, set speed 600 and see `600×`, click the Doomscroll preset and expect `[data-poltergeist="fog"]` within 10 s, with no page errors and no other-origin requests
    - _Requirements: 14.3, 14.7, 14.11_

  - [x] 10.6 Raise the speed maximum to 3600× and update the Graveyard note
    - In `demo-site/index.html` change `#speed` to `max="3600"` and replace the `p.note` text with `The Tab Graveyard preset decays only while this tab is hidden. Switch to another tab, then come back. At 3600× the tombstone appears after about 24 seconds away.`
    - In `demo-site/playground-core.js` set `MAX_SPEED` to 3600 and update the `clampSpeed` and `setSpeed` comments from 600 to 3600 (leave `RITUAL_UNDO_MS = 600`, which is a fade duration); nothing else in the speed logic changes
    - Runs before tasks 10.4 and 10.5, whose descriptions already include the 3600 checks; if either test file already exists when this task runs, update it the same way (speed list gains 3600, `max` is `3600`, exact note text)
    - `demo-site/index.html` and `playground-core.js` are not Generated_Skeleton or Preset files, so no generated copy changes; run `npm run check:skeletons` to confirm it still passes and do not edit `demo-site/skeleton/` or `demo-site/presets/` by hand
    - _Requirements: 14.7, 14.8_

- [ ] 11. README guides
  - [ ] 11.1 Add the two README guides
    - `## Build your own haunt in 10 minutes` with the five numbered steps of Requirement 15.1, each command in a code block, including `npm run new-haunt <name> -- --hosts <pattern,...>` and `npm run playground`
    - `## Write your own ritual` with the six Ritual_Contract bullets using the steering doc's sentences, the statement that the app decides what happens after `exorcised`, one `js` "typed vow" example of at most 40 lines, and suggested rituals (typed vow, breathing timer, riddle) with one sentence each
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [ ] 11.2 Extend `test/docs.test.js`
    - Heading texts and step order of the build guide with the `--` separator; ritual-contract bullets equal the steering doc items (invariant 21, README part); the code block is at most 40 lines, exports `apply`, `undo` and `description`, checks `isTrusted`, calls `env.onAction('exorcised')` once and has no `innerHTML` or `chrome.`; at least the three named ritual suggestions; the effect list still matches the registry
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [ ] 12. Final checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run test:browser`; both exit 0 with no existing test skipped or deleted
  - Run `git diff --exit-code <base> --` on `skeleton/engine.js`, `skeleton/match.js` and `skeleton/effects/{fog,flicker,rot,block,tombstone}.js`, and on Graveyard's `rules.json`, `background.js`, `content.js`, popup files and `test/browser/`; confirm Graveyard's manifest diff is only the two resource strings and the edited assertions are exactly the six named in design section 7
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [x] 13. Candle Path playtest amendment
  - [x] 13.1 Update the ritual's instructions, status and veil
    - In `skeleton/effects/ritual.js`: default `instructions` `Draw one path through every square, passing the candles in order. Candle <N> must be your last square. Drag back to undo.` with `<N>` replaced by the live Board's candle count, only when the param is absent or invalid; a valid custom `instructions` string is shown exactly as written
    - Filled_Count as `path.length` and S as `size²`; status `<Lit_Count> of <N> candles · <Filled_Count> of <S> squares` (U+00B7 with one space each side), or `Candle <N> must be last. Back up and fill the empty squares.` while candle N is on the path and Filled_Count < S; veil opacity `round3(0.85 × (S − Filled_Count) / (S − 1))`; status and veil set before the handler returns on creation and after every accepted move, retract, Reset or Hint, per design section 2.5; the move rule and `checkPath` stay unchanged
    - Keep the README `ritual` line equal to the `description` export; change both identically only if the wording should mention that the last candle is the final square
    - In `skeleton/rule-schema.json` `definitions["params-ritual"].instructions`: `default` becomes the text with the letter N (`… Candle N must be your last square. Drag back to undo.`) and `description` states that N is replaced by the candle count; `minLength` 1 and `maxLength` 300 stay
    - _Requirements: 5.4, 5.5, 5.8, 5.11, 5.12, 5.13, 6.1, 6.3, 7.1, 11.3, 15.5_

  - [x] 13.2 Update the pinned ritual assertions and add the amendment examples
    - In `skeleton/test/ritual.test.js` update the status expectations (creation, `checkRender`, completion, the `onAction` failure case), the `veilFor` helper to `round3(0.85 × (S − Filled_Count) / (S − 1))`, the instructions default expectations and the completion status `N of N candles · S of S squares`
    - Add examples: the stuck message with the real N in the existing "candle N lit early" script; the count text again after backing up until candle N is off the path; a custom `instructions` param shown as written; veil 0.85 at creation, strictly decreasing as squares fill, and 0 only at completion
    - In `test/packaging.test.js` update the `PARAMS.instructions.default` expectation to the schema default with the letter N
    - _Requirements: 5.4, 5.5, 5.8, 5.11, 5.12, 5.13, 6.1, 6.3, 7.1, 11.3, 16.2_

  - [x] 13.3 Rebuild the Generated_Skeletons
    - Run `npm run build:skeletons` so every Generated_Skeleton gets the amended `skeleton/effects/ritual.js` and `skeleton/rule-schema.json`, then confirm `npm run check:skeletons` passes
    - _Requirements: 11.1, 11.4, 16.5_

  - [x] 13.4 Update the finale browser test status strings
    - In `app1-doomscroll/test/browser/finale.pw.js` set the start status to `1 of 5 candles · 1 of 25 squares` and `DONE_STATUS` to `5 of 5 candles · 25 of 25 squares`; change nothing else
    - _Requirements: 10.10, 16.2_

  - [x] 13.5 Checkpoint - Ensure the amendment tests pass
    - Run `npm test` and `npx playwright test --project=doomscroll-extension finale.pw.js`; both pass. Ensure all tests pass, ask the user if questions arise.
    - _Requirements: 5.12, 5.13, 10.10, 16.1_

## Notes

- No property-based tests: every test is example-based and lives inside the implementation task it verifies. Invariant numbers refer to the design's Correctness Properties, which this spec checks with fixed example lists.
- Task 5.1 must create `skeleton/effects/ritual.js` through Kiro so the Effect_Hook fires; tasks 5.2 to 5.4 are the hook's steps in the hook's order.
- Between task 5.4 and task 7.2 the app package checks report the two new modules missing from `web_accessible_resources`. This is expected; the checkpoint in task 6 runs only the skeleton and authoring suites.
- The only existing assertions edited are the six in design section 7, in tasks 4.2, 5.3, 7.4 and 9.1.
- Task 13 is the Candle Path playtest amendment. It edits the ritual assertions in `skeleton/test/ritual.test.js`, `test/packaging.test.js` and `app1-doomscroll/test/browser/finale.pw.js` that decision 3 allows (second table in design section 7), and depends only on completed tasks, so it runs before task 8.
- Task 9.3 is a manual check recorded in `KIRO_FILES.md`; the Playwright and Vitest suites cover everything else.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "3.2", "4.2"] },
    { "id": 2, "tasks": ["1.3", "2.4", "2.5", "5.1"] },
    { "id": 3, "tasks": ["5.2"] },
    { "id": 4, "tasks": ["5.3"] },
    { "id": 5, "tasks": ["5.4"] },
    { "id": 6, "tasks": ["5.5"] },
    { "id": 7, "tasks": ["5.6"] },
    { "id": 8, "tasks": ["5.7"] },
    { "id": 9, "tasks": ["5.8", "5.9", "5.10"] },
    { "id": 10, "tasks": ["5.11"] },
    { "id": 11, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 12, "tasks": ["7.4", "7.5", "7.6"] },
    { "id": 13, "tasks": ["7.7"] },
    { "id": 14, "tasks": ["13.1", "13.4"] },
    { "id": 15, "tasks": ["13.2", "13.3"] },
    { "id": 16, "tasks": ["13.5", "8.1"] },
    { "id": 17, "tasks": ["8.2"] },
    { "id": 18, "tasks": ["8.3"] },
    { "id": 19, "tasks": ["9.1", "10.1"] },
    { "id": 20, "tasks": ["9.2", "10.2"] },
    { "id": 21, "tasks": ["9.3", "10.3"] },
    { "id": 22, "tasks": ["10.6", "11.1"] },
    { "id": 23, "tasks": ["10.4", "10.5", "11.2"] }
  ]
}
```
