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