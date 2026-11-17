## 2026-11-16: Task 4.1 Teardown lifecycle
**Kiro feature:** spec task (haunt-engine 4.1, Req 5.10)
**What happened:** Kiro made the effect states explicit (live, fading, dead).
**Bug found:** in the original vibe-coded skeleton, a second fade-out call
cancelled the running fade and removed the effect instantly. Requirement 5.10
said it should be a no-op, so writing the spec exposed it.
**Test coverage:** "repeated positive-duration teardown is a no-op and keeps
the original timer" in effects.test.js (task 4.5, commit f97c0c2).
**Evidence:** commit 30fd149

## 2026-11-16: Tasks 4.2–4.5 Overlay effects
**Kiro feature:** spec tasks (haunt-engine 4.2–4.5, Req 10)
**What happened:** Fog, flicker and block became separate fixed overlays on
<html>, stacked fog < flicker < block. Nothing styles <html> or <body> any more,
so the block message stays readable and fixed navbars don't move.
**What I caught/changed:** jsdom can't render blur or measure layout, so the
visual checks (Req 10.13–10.14) are left for a Playwright test in real Chrome
(task 7.3).
**Evidence:** commits 4b1cb71, 9d39cd7, c05646b, f97c0c2; tests 39 → 67.
Break-it check: changing fog's z-index failed 2 tests.

## 2026-11-16: Task 5 Custom effects in the validator
**Kiro feature:** spec tasks (haunt-engine 5.1–5.2, Req 11)
**What happened:** The validator now accepts any effect in the registry it's
given, instead of a hard-coded list of four.
**What I caught/changed:** the spec put the startPoltergeist fix (Req 11.6) in
task 10.1, which I'd deferred until after App 1, so custom effects would still
have been rejected at startup. I pulled that one-line fix forward into 5.1.
**Evidence:** commits 4b1dfdc, ff21291; tests 67 → 75.
Break-it check: ignoring the registry failed 5 tests.

## 2026-11-16: Task 6 Rot pruning
**Kiro feature:** spec tasks (haunt-engine 6.1–6.2, Req 13)
**What happened:** Rot now drops references to text nodes the page has removed,
so long sessions on infinite feeds don't leak memory. Removed nodes' text is
never touched.
**Evidence:** commits 80505f4, 9c4f2a4; tests 75 → 82.
Break-it check: disabling the pruning line failed 3 tests.

**Found while reviewing (not yet fixed):** the engine only re-applies an effect
when its intensity changes. Once rot reaches full intensity it is never applied
again, so feed posts that load after that point stay clean, and the feed looks
like it is healing as you scroll. Fix in the doomscroll-app spec, likely by
having rot watch for new text with a MutationObserver.

## 2026-11-16: haunt-engine Task 7 Restoration and real-Chrome checks
**Kiro feature:** spec tasks (haunt-engine 7.1, 7.3, Req 10, 14), Playwright
**What happened:** a restoration suite applies every effect, undoes it, and
checks the page is byte-for-byte unchanged, including all four effects undone
in all 24 orders. A real-Chrome Playwright test checks fixed navbars, sidebars
and modals don't move while effects are active.
**Evidence:** commits f15d477, 8dfa32a; tests 82 → 145 unit, 5 browser.
Break-it checks: if fog's undo leaves its overlay, 54 tests fail. Putting a
filter back on <body> (the bug Req 10 was written to avoid) failed the
fixed-element browser tests, because the bottom chat bubble and centred modal moved.
**Checkpoint:** task 8 closed the haunt-engine foundations (commit 3283ae3).

## 2026-11-17: doomscroll-app spec
**Kiro feature:** spec (requirements → design → tasks)
**What happened:** Kiro's first design re-walked the whole page on every DOM
change to fix the rot-on-infinite-feeds bug, and kept the skeleton copy out of
Git.
**What I caught/changed:**
- A full-page walk on every change would stutter on YouTube, which changes
  constantly. Revised to process only added or changed nodes, at most once per
  250 ms.
- An uncommitted skeleton copy means a judge cloning the repo gets a broken
  extension. Revised to commit the copy, with a byte-for-byte drift check that
  runs before every `npm test`.
- Added a Kiro save hook that rebuilds the copy, while keeping the build script
  as the real guarantee.
**Lesson:** the revision run went for about 1.5 hours with Autopilot on. I now
run tasks one at a time with Autopilot off.
**Evidence:** commits c736df0, 29b6567

## 2026-11-17: doomscroll-app Tasks 1–3.1
**Kiro feature:** spec tasks; Opus 5.5 at High effort for the rot observer (2.1)
**What happened:**
- 1.1–1.2: Manifest V3 extension limited to YouTube, X and Instagram, with only
  the `storage` permission; four escalating rules (fog 2 min → block 20 min).
- 2.1–2.2: rot now decays posts that load after it reaches full intensity,
  without re-walking the whole page.
- 3.1: build script copies the skeleton into the app; `npm test` fails on drift.
**Evidence:** commits a0215f2, 5045e22, 76e0f15, 8b5ed39; tests 145 → 162.
Break-it checks: removing the 250 ms throttle failed 7 tests; removing the
"ignore rot's own writes" guard failed 1 test; editing one skeleton file made
`npm test` report `changed: match.js` and stop.

## 2026-11-17: doomscroll-app Tasks 3.2–3.3
**What happened:** a package validator checks the manifest, rules and module
graph; a Kiro save hook rebuilds the skeleton copy.
**What I caught:** the check command didn't actually run the validator, so a
bad manifest could pass `check:doomscroll` (the spec required it to fail).
**Evidence:** commits 2ef2ba6, 9d24d9e; tests 162 → 229. Break-it checks: an
extra `tabs` permission failed 4 tests; a missing web-accessible file failed 2.
**Fixed:** task 3.4 (commit 71eec3c). `check:doomscroll` now runs the
validator and exits with an error on an extra permission.