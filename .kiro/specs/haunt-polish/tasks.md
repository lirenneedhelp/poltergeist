# Implementation Plan: Haunt Polish

## Overview

A one-day visual pass in plain JavaScript (ES modules), following the design's "Implementation plan outline": six implementation tasks and one final check. Tasks 1 to 4 change the root `skeleton/effects/` (util, Block, Tombstone, Fog) and add their Vitest example-based tests in the same task. Task 5 wires the apps and packaging, task 6 amends the earlier app specs, and task 7 runs the final check and the manual Screenshot_Checklist.

Constraints for every task:

- Edit only the root `skeleton/` and never a generated copy (`app1-doomscroll/skeleton/`, `app2-tab-graveyard/skeleton/`).
- Run `npm run build:skeletons` before `npm test`, because the save hook rebuilds only Doomscroll's copy and `pretest` fails on a stale Graveyard mirror.
- Add no property-based tests: no `fast-check` import and no `fc.assert` call.
- Edit no existing test except the three listed in Requirement 9 criterion 3 (`skeleton/test/tombstone.test.js` one case, `return-resurrect.pw.js`, `discard-reload.pw.js`).
- Never set a style or attribute on `html` or `body`, and add nothing under `head` or `body`.
- Every new animation (Fade_In, Rise_In, Drift) is skipped when `env.reducedMotion` is true.
- Run `npm test` in full before marking a task done.

## Tasks

- [x] 1. Shared duration helpers and Tombstone duration params
  - [x] 1.1 Move and add helpers in `skeleton/effects/util.js` and use them in `skeleton/effects/tombstone.js`
    - Move `formatDuration` and `fill` verbatim from `tombstone.js` into `util.js`; add `numberIn` and `durationText(env, meter, params)` exactly as in the design
    - `durationText`: `a while` with no suffix when `readMeter` is missing, returns a non-finite value, or the scaled value overflows; scale 1 unless `durationScale` is a finite number above 0; empty suffix unless `durationSuffix` is a string; scale applied before flooring
    - In `tombstone.js`, replace the local functions with `export { formatDuration } from './util.js'` and import `fill`/`durationText`; `render` fills `{duration}` with `durationText(env, params.durationMeter, params)`, keeping `{...DEFAULTS, ...params}` resolution and `{title}`-before-`{duration}` order
    - Default text must stay byte-identical when both duration params are absent
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 5.6_
  - [x] 1.2 Add `skeleton/test/polish-helpers.js` and the Tombstone half of `skeleton/test/polish-duration.test.js`
    - `polish-helpers.js` (not a `*.test.js` file): `installAnimateSpy()` via `Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: vi.fn(...) })` returning `{ calls, on(el), restore() }`; `makeEnv(overrides)`; `isPlaying(spy, el, { duration, iterations })` and `isStill(spy, el)` per Requirement 9.8
    - Tests: `tombstone.formatDuration === util.formatDuration` and the existing pinned table; `33 hours (demo time)` at scale 3600, meter 33; `2 days (demo time)` at meter 48; `a while` with no suffix when `readMeter` is missing or returns `NaN`; scale 1 for `durationScale` 0, -1, `"60"`; empty suffix for `durationSuffix` 5 and `null`; suffix `" {title}"` stays literal; re-apply and re-render after `visibilitychange` use the latest params and meter
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.8, 1.10, 9.1_

- [x] 2. Block finale
  - [x] 2.1 Rebuild `skeleton/effects/block.js` with a shadow root, ghost, detail line, and Fade_In
    - Resolve new params without mutating `params`: `figure` (`ghost`/`none`, default `ghost`, read at creation), `detail` (string, default `''`), `durationMeter` (string, default `timeOnSite`), `fadeInMs` (`numberIn` 0 to 10000, default 1500, read at creation), `durationScale`, `durationSuffix`
    - Keep the host contract: `div[data-poltergeist="block"][role="status"]`, existing `cssText`, light DOM holds exactly one text node equal to `message`, opacity `maxOpacity × intensity` to 3 decimals, `pointer-events` by `blockAt`
    - Open shadow root with the stage (flex column, gap 24px, max-width 960px): ghost `svg[aria-hidden="true"]` built only through one `createElementNS('http://www.w3.org/2000/svg', tag)` helper with the design's path and ellipses, then a `div` with a `<slot>` at `700 40px`, then a `p` at `400 24px` only when `detail` is non-empty, filled via `fill` + `durationText`; no shadow element sets `pointer-events`
    - `startFade` on creation (after `syncDetail`): `animate([{opacity:0},{opacity:1}], { easing:'ease-out', iterations:1, duration: fadeInMs })` on figure, message, and detail when `animate` exists, skipped when `env.reducedMotion` is true or `fadeInMs` is 0; re-apply never replays; re-apply with reduced motion calls `finish()` on each and clears the list
    - `undo` finish step cancels every `handle.fade` entry before removing the host; existing begin step and `teardown` timing unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.11, 7.11_
  - [x] 2.2 Add `skeleton/test/polish-block.test.js` and the Block half of `skeleton/test/polish-duration.test.js`
    - Block tests: open shadow root, no light-DOM child elements, `textContent === message` with `{duration}` left literal; one `aria-hidden` `svg` before the message by default and none for `figure: 'none'`; no `p` by default, one `p` after the message with filled text for a set `detail`; `durationMeter` default `timeOnSite` and override `scrollDistance`; message font size at least 36px, detail 24px; re-apply keeps the same overlay, figure, and `p`, updates text, and does not replay; Fade_In on figure, message, and detail with duration 1500 and 1 iteration, override 400, none with reduced motion, none with `fadeInMs` 0; re-apply with reduced motion calls `finish()`; overlay opacity and `pointer-events` unchanged during the Fade_In; undo during the Fade_In cancels it and restores the snapshot, instantly and after `durationMs`
    - Duration tests for Block: `20 minutes (demo time)` at meter 20 and `30 seconds (demo time)` at meter 0.5 with scale 60; the same `a while`, invalid-scale, and invalid-suffix cases as task 1.2; latest params and meter on re-apply
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.9, 1.10, 2.1 to 2.9, 2.11, 2.13, 2.14, 5.11, 9.1, 9.7, 9.8_

- [x] 3. Tombstone finale
  - [x] 3.1 Add the stone card, mark, and Rise_In in `skeleton/effects/tombstone.js`
    - New params after `{...DEFAULTS, ...params}`: `weathered` (boolean, default `true`, read at creation), `mark` (string, default `R.I.P.`, every apply), `riseInMs` (`numberIn` 0 to 10000, default 800)
    - Shadow tree per design: card `div[role="dialog"]` with `CARD_STONE` (gradient-only `background-image`, `CHIP_CLIP` `clip-path`, plus an empty `aria-hidden` crack `div` with `CRACK_CSS`) or `CARD_FLAT` (pre-polish `#3a3a3f` background, `2px solid #55555c` border, old radius); host keeps `HOST_CSS` and no light-DOM children
    - `syncMark`: mark `div[aria-hidden="true"]` with `MARK_CSS` before the `h1`, literal `textContent`, removed when `mark` is `''`; fixed px fonts for mark, heading, message, and button
    - Rise_In: on creation, skip when reduced motion or `riseInMs` is 0; start `card.animate(RISE_KEYFRAMES, { ...RISE_TIMING, duration: riseInMs })` when visible, else set `risePending`; the existing `onVisible` listener starts a pending Rise_In once (re-checking reduced motion) before its existing re-render timer; re-apply with reduced motion calls `endRise` (`finish()`, clear pending); `apply` schedules no timer; host `transition` and `animation` stay empty
    - `undo`: begin step clears `risePending`; finish step calls `handle.rise?.cancel()`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.11_
  - [x] 3.2 Rewrite one case in `skeleton/test/tombstone.test.js` and add `skeleton/test/polish-tombstone.test.js`
    - Replace "shows no animation and schedules no timers when applied" in place with the design's "plays the Rise_In only when motion is allowed and schedules no timers when applied"; change nothing else in that file
    - New tests: `weathered` default gives gradient-only `background-image`, a `clip-path`, and a crack with no child nodes; `weathered: false` gives `rgb(58, 58, 63)`, the old border and radius, no gradient, no `clip-path`, no crack; `mark` default `R.I.P.` in a `div` before the `h1`, `Ci-gît {title}` stays literal, `''` removes an earlier mark, non-string gives the default; exactly one `h1`, `p`, and `button`, and no other element except the mark has a text-node child; fixed px font sizes; Rise_In duration 800 and 1 iteration, override 300, none with reduced motion, none with 0; created while hidden starts nothing until the first `visible` event, then exactly once; re-apply with reduced motion while pending or running ends it; undo while running or pending cancels it, no later start, snapshot restored; `vi.getTimerCount()` is 0 after each `apply`
    - _Requirements: 3.1 to 3.13, 5.11, 9.1, 9.3, 9.7, 9.8_

- [x] 4. Fog tint, noise, and Drift
  - [x] 4.1 Add tint, noise, and Drift to `skeleton/effects/fog.js`
    - New params: `tint` (default `#9eb2a4`; non-string falls back to the default), `noise` (`numberIn` 0 to 1, default 0.3), `driftMs` (0 or 1000 to 600000, default 20000); constants `TINT_MAX_OPACITY = 0.22`, `DRIFT_PX = 240`
    - `acceptedTint`: reject `\ ; { }` and `var( env( attr( url(` (any case) before the detached-element `style.color` probe; set an accepted colour only as `tintEl.style.backgroundColor`
    - Overlay keeps every existing inline style and `backdrop-filter` string, adds `overflow: hidden`; unmarked tint layer (prepended, inset 0, opacity 0.22 × i) and noise layer (top/left -240px, `NOISE_IMAGE` gradients with tile sizes dividing 240, opacity `noise × i`); both `pointer-events: none`; neither carries `data-poltergeist`; `tint ''` with `noise 0` leaves no child nodes
    - `syncDrift` on every apply: start `noiseEl.animate(DRIFT_KEYFRAMES, { easing:'linear', iterations: Infinity, duration: driftMs })` when wanted and not running, `cancel()` when unwanted, leave a running one alone; `watchMotion` adds a `change` listener on `env.window?.matchMedia?.('(prefers-reduced-motion: reduce)')` or returns a no-op
    - `undo`: begin step fades both layer opacities with `opacity <d>ms linear` alongside the existing overlay fade; finish step calls `unwatch()`, cancels the Drift, and removes the overlay with its layers
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.10, 5.12_
  - [x] 4.2 Add `skeleton/test/polish-fog.test.js`
    - Tint default `rgb(158, 178, 164)` at opacity 0.22 × i (0 at intensity 0), override `rgb(120, 140, 200)`, `''` gives no tint layer; noise default 0.3 × i with gradient-only `background-image`, override 0.5, 0 gives no layer; `tint ''` with `noise 0` leaves no child nodes and no background; Drift default duration 20000, `Infinity` iterations, keyframes ending at `translate(240px, 240px)`, override 5000, 0 gives none, 500 falls back to 20000; reduced motion gives none; re-apply with reduced motion cancels, re-apply without starts again, re-apply while running makes no new call; a fake `matchMedia` `change` to reduce stops the Drift, and undo removes the listener; re-apply keeps one overlay and the same layers; `backdrop-filter` string unchanged; fade undo puts `opacity 500ms linear` on both layers; every layer has `pointer-events: none`
    - _Requirements: 4.1 to 4.12, 9.1, 9.7, 9.8_
  - [x] 4.3 Add the cross-effect `skeleton/test/polish-safety.test.js`
    - Source scan of `fog.js`, `block.js`, `tombstone.js`: no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `DOMParser`, `createContextualFragment`, `document.write`, `url(`, `image-set(`, `@import`, `@font-face`; the SVG namespace appears only as `createElementNS('http://www.w3.org/2000/svg'`
    - DOM scan after apply (light and shadow): no `img`, `image`, `[href]`, `[src]`, and no `url(` in any `style` attribute; no change to `head`, `body`, `adoptedStyleSheets`, or `html`/`body` attributes
    - Every invalid value in the Requirement 5.6 table, including `null`, renders like the default; hostile `tint` values (`red;background:url(https://example.com/x.png)`, `var(--x)`, `u\\rl(x)`, `{}`) give no tint layer and no error
    - Env with only `document` and `reducedMotion`, both values: Fog and Block apply and instant undo raise no error, Block detail shows `a while`, snapshot restored
    - "Undo cancels every animation and restores the snapshot" for all three effects with the animate spy installed
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.10, 7.11, 9.1_

- [x] 5. Apps and packaging
  - [x] 5.1 Update the Demo_Builders in `app1-doomscroll/content.js` and `app2-tab-graveyard/content.js`
    - Keep each function's shape; trigger division no longer `continue`s; use `DEMO_TIME_SCALE` (60 Doomscroll, 3600 Graveyard) and `DEMO_SUFFIX = ' (demo time)'`
    - Set `durationScale` and `durationSuffix` only when `effect.params` is a non-array object with a string `durationMeter`; skip malformed rules without error; never mutate the input
    - Add the design's one-sentence doc comment to each function
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.9_
  - [x] 5.2 Update both `rules.json` files and both `EXPECTED_RULES`, then regenerate skeletons
    - `app1-doomscroll/rules.json` and `app2-tab-graveyard/rules.json`: replace only `effect.params` with the design's Normal_Profile params in the exact key order (Fog `tint`/`noise`/`driftMs`; Rot glyphs `▓▒░█`; Block `detail`/`durationMeter`/`figure`/`fadeInMs`; Tombstone `weathered`/`mark`/`riseInMs`); `doomscroll-flicker` unchanged; no `durationScale` or `durationSuffix`
    - Replace `EXPECTED_RULES` in `scripts/validate-doomscroll-package.mjs` and `scripts/validate-graveyard-package.mjs` with the design's exact values; change nothing else in either validator, `package-checks.mjs`, or the sync scripts
    - Run `npm run build:skeletons`; confirm no `manifest.json` change is needed because no new module joins the import graph
    - _Requirements: 6.5, 6.10, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.12_
  - [x] 5.3 Add `app1-doomscroll/test/demo-time.test.js` and `app2-tab-graveyard/test/demo-time.test.js`
    - Load `content.js` with `node:vm` as the existing `content.test.js` files do
    - Per app: the Duration_Rule gains `durationScale` (60 or 3600) and `durationSuffix ' (demo time)'`; every other rule and param equals the Normal_Profile apart from divided trigger times; Normal_Profile deep-equals a copy taken before the call and is unchanged after editing demo params; a synthetic Block or Tombstone rule without a string `durationMeter` (Graveyard also with `durationMeter: 5`) gains neither param; malformed rules do not throw; `validateRules(demo, builtinEffects)` is valid with `[]` errors; Normal_Profile has no duration params and exactly one Duration_Rule
    - End to end: Block with the demo params and `readMeter('timeOnSite') = 20` shows `You lost 20 minutes (demo time) to this feed.`; Tombstone with `readMeter('timeAway') = 33` shows `Abandoned for 33 hours (demo time).`
    - _Requirements: 6.1 to 6.10, 9.2_
  - [x] 5.4 Edit the demo Tombstone assertions in `app2-tab-graveyard/test/browser/return-resurrect.pw.js` and `discard-reload.pw.js`
    - Replace the "worded in seconds" comment with "Demo_Mode shows the duration in demo time: each second away reads as one hour."
    - Replace the message assertion with the design's block: hours N between `TOMBSTONE_S` (24) and `upper`; days D between 2 and `floor(upper / 24)` only when `upper` is at least 48; `upper` is `Math.ceil(longAwayMs / 1000) + 1` in `return-resurrect.pw.js` and `Math.ceil((Date.now() - left) / 1000) + 1` in `discard-reload.pw.js`
    - Change no other line in either file
    - _Requirements: 6.7, 9.3_

- [x] 6. Earlier app spec amendments
  - [x] 6.1 Apply the tab-graveyard-app edits from the design's "Earlier app spec edits"
    - `.kiro/specs/tab-graveyard-app/requirements.md`: replace Requirement 2 criterion 4, criterion 8, and Requirement 4 criterion 10 with the exact amended texts and their `Reason (haunt-polish):` notes; add the `Note (haunt-polish):` paragraphs after Requirement 2 criterion 5, Requirement 4 criterion 5, and Requirement 4 criterion 12, indented 3 spaces
    - `.kiro/specs/tab-graveyard-app/design.md`: add the note after Property 4's `**Validates: Requirement 2.6**` line and the note after the `rules.json` JSON block, before "### Schedules", each as a top-level paragraph with one blank line before it
    - `.kiro/specs/tab-graveyard-app/tasks.md`: add the nested bullet (2-space indent) under the "no animation" item in "Constraints for every task"
    - No other text changes
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.11, 8.12, 8.14_
  - [x] 6.2 Apply the doomscroll-app edits from the design's "Earlier app spec edits"
    - `.kiro/specs/doomscroll-app/requirements.md`: replace Requirement 2 criterion 7 with the exact amended text and its `Reason (haunt-polish):` note; add the `Note (haunt-polish):` after Requirement 2 criterion 8
    - `.kiro/specs/doomscroll-app/design.md`: add the note after the `doomscroll-block` row of the "Rule profile" table, before the paragraph beginning "Because `computeIntensity` yields", with one blank line so the table stays intact
    - Leave `.kiro/specs/doomscroll-app/tasks.md` unchanged
    - _Requirements: 8.5, 8.10, 8.11, 8.13, 8.15_

- [ ] 7. Final check
  - [ ] 7.1 Run the automated final check from the repository root, in order, each exiting 0
    - `npm test` (runs `check:graveyard` as `pretest`, then `check:doomscroll`, then `vitest --run`)
    - `npm run build:skeletons`, then `git status --porcelain` lists no modified, deleted, or untracked file under `app1-doomscroll/skeleton/` or `app2-tab-graveyard/skeleton/`
    - `npm run test:browser` (`skeleton-effects`, `doomscroll-extension`, `graveyard-extension`)
    - `git diff --stat <commit before task 1>` shows no change to `skeleton/engine.js`, `skeleton/match.js`, `skeleton/meters.js`, `skeleton/validator.js`, `skeleton/rule-schema.json`, `skeleton/index.js`, `skeleton/effects/index.js`, `skeleton/effects/flicker.js`, `skeleton/effects/rot.js`, either `manifest.json`, `scripts/package-checks.mjs`, the sync scripts, or `.kiro/specs/doomscroll-app/tasks.md`
    - Fix any failure in the task that caused it, then re-run this list from the start
    - _Requirements: 5.9, 7.8, 7.9, 7.10, 8.5, 9.3, 9.4_
  - [ ] 7.2 Take the Screenshot_Checklist by hand in Chrome with Demo_Mode on
    - Mark each item as taken or record the defect seen. Doomscroll times count visible seconds since Demo_Mode was turned on with the page in front; Graveyard times are absences from the tab. A light page has a mostly light background and a dark page a mostly dark one.
    - Doomscroll on an approved host, 3 to 5 s in: Fog with tint and texture, on one light and one dark page
    - Doomscroll, 13 to 19 s in: Rot with the heavier glyphs readable on camera, on one light and one dark page
    - Doomscroll, 25 to 59 s in: the Block finale with the ghost, the large message, and `You lost N minutes (demo time) to this feed.`
    - Doomscroll, with `prefers-reduced-motion: reduce` emulated in DevTools before the Block appears: the Block finale at full opacity at once, with no Fade_In
    - Graveyard on any `http` or `https` page, after an absence of 2 to 3 s: Fog
    - Graveyard, after an absence of 8 to 12 s: Rot
    - Graveyard, after an absence of 24 to 47 s: the Tombstone finale with the stone texture, the cracked edge, the `R.I.P.` mark, the page title, and `Abandoned for N hours (demo time).`
    - Graveyard, same finale: the mark, heading, message, and button text clearly readable against the stone texture at video resolution
    - Graveyard, with `prefers-reduced-motion: reduce` emulated in DevTools on the tab before returning to it: the Tombstone_Card in its final position at full opacity at once, with no Rise_In
    - Graveyard: the page after Resurrect, with no Fog, Rot, or Tombstone left
    - With no DevTools animation slow-down, watch one full Fade_In (1.5 s), one full Rise_In (0.8 s), and one full Drift cycle (20 s); record `none`, or each stutter (a visible jump or pause) or clipping (part of the ghost, message, second line, Tombstone_Card, or noise texture cut off) seen
    - _Requirements: 9.5, 9.6_

## Notes

- No task is optional, and no task adds property-based tests (Requirement 9.1). The design's invariants are checked by the example-based tests named in each task and by the existing suites, including the Restoration_Suite, Doomscroll Property 2, and Graveyard Property 4, which run unedited.
- Tasks 1.2 and 2.2 both write `skeleton/test/polish-duration.test.js`; they run in different waves.
- Several tasks run `npm run build:skeletons`. When tasks in the same wave run in parallel, rebuild once more after the wave before `npm test`.
- Task 7.2 is a manual pass and cannot be automated; record its results in the task when done.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1", "6.1", "6.2"] },
    { "id": 1, "tasks": ["1.2", "2.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.2"] },
    { "id": 3, "tasks": ["3.2", "5.2"] },
    { "id": 4, "tasks": ["4.3", "5.3", "5.4"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["7.2"] }
  ]
}
```
