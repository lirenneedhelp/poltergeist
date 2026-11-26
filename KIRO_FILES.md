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

## 2026-11-17: doomscroll-app Tasks 4.1–4.3
**What happened:** a service worker stores pause per tab and demo mode
globally; a minimal popup shows this tab's status with Pause and Demo
toggles; 38 new tests (22 service worker, 16 popup).
**What I checked:** Kiro only ran the two new test files, so I ran the full
`npm test` myself before committing.
**Evidence:** commits 524a1b6, 86281bc, f99a23a; tests 230 → [your count].

## 2026-11-17: Kiro save hook check
**Kiro feature:** agent hooks
**What happened:** Kiro's task wrote the hook file by hand. Kiro's Agent Hooks
panel recognised it: listed, enabled, File Saved trigger, Run Command.
**What I caught:** saving `skeleton/match.js` did not rebuild the app's copy.
Running `npm run build:doomscroll` by hand worked, so the command is fine and
the problem is the trigger or the path pattern.
**Status:** [still investigating / fixed by …]. The drift check in `npm test`
still catches a stale copy, so nothing ships broken in the meantime.

## 2026-11-17: doomscroll-app Task 5 and first real-Chrome run
**Kiro feature:** spec tasks; Opus 5.5 at High effort for the runtime
controller (5.1)
**What happened:** the content script loads the skeleton, runs one haunting
per tab, and switches between normal and demo timing (thresholds ÷ 60).
**What I caught:** every unit test passed, but on YouTube the extension did
nothing. Chrome's error log showed "Unsafe attempt to load URL
chrome-extension://<random id>/skeleton/index.js … Domains, protocols and
ports must match." The spec required `use_dynamic_url: true` as extra
protection against site fingerprinting, and Chrome then blocks the content
script from importing those files. Only a real browser enforces this, so no
unit test could catch it.
**What I changed:** had Kiro update requirement 1.7, the design, the task, the
manifest, the validator and its tests to `use_dynamic_url: false`. The exact
site list and the small exposed file list remain the protection.
**Result:** in demo mode on YouTube, fog → flicker → rot → block all ran, and
the block message appeared in about 25 seconds.
**Next:** the block screen works but looks plain (dim overlay, small text);
it's the payoff shot of the demo, so a visual polish pass is planned.
**Evidence:** commits 3cc5fea, f8c8389, 9146b52, 72d76f9; tests 268 → 303
(task 5.3 added 33, the fix added 2). Break-it checks: dividing by 30 failed
11 tests; removing the generation check failed 2; skipping stop() before a
restart failed 9. Screenshots: Chrome error log, block screen.

## 2026-11-17: Kiro save hook check
**Kiro feature:** agent hooks (File Saved trigger, Run Command action)
**What happened:** task 3.3 had Kiro write the hook file by hand. Kiro's
Agent Hooks panel recognised it: listed, shown as enabled, File Saved
trigger, `npm run build:doomscroll` as the command.
**What I caught:** saving `skeleton/match.js` in Kiro did not rebuild the
app's copy. Running `npm run build:doomscroll` by hand worked, so the
command was fine and the problem was the hook not firing.
**What I tried:**
- Re-saved the hook through the Agent Hooks panel. Kiro rewrote the file in
  its own format and added `"enabled": true`, which the hand-written file
  lacked. It still didn't fire.
- Replaced the command with a debug command that writes the hook's stdin
  payload to a file, and cleared the path pattern so every save matched. No
  file appeared, so the hook isn't running at all; the path pattern isn't
  the cause.
- A save test left the app copy stale, and `npm test` stopped immediately
  with "Doomscroll skeleton mirror is out of sync: changed: match.js".
**Status:** the hook doesn't fire in my Kiro. The design already treated it
as a convenience only: the build script writes the copy, and the drift
check in `npm test` guarantees it's current. I now run
`npm run build:doomscroll` by hand after skeleton edits.
**Lesson:** a hook that shows as enabled in the panel isn't proof it runs;
test it with a real save and check the result.
**Evidence:** hook file `.kiro/hooks/build-doomscroll-on-skeleton-save.json`;
drift check output (screenshot); `npm test` back to 303 passing after
restoring the test edit.

## 2026-11-17: doomscroll-app Task 6 (browser tests)
**Kiro feature:** spec tasks; High effort for 6.2–6.3
**What happened:** Playwright now loads the real unpacked extension in
Chromium, serves a local feed page at a youtube.com address, and checks:
fog → flicker → rot → block in order within the demo timeline; a post
added after rot peaks still rots; pause restores every string exactly;
resume restarts one sequence; an unapproved site gets nothing.
**What I checked:** Kiro reported "9 tests pass" from a subagent without
running the suite itself, so I ran `npm run test:browser` twice myself:
9/9 both times, no flakiness.
**Evidence:** commits 8010b45 (6.1), c7cbc61 (6.2), 51802d5 (6.3),
63c0ef5 (6.4). Commit messages for 6.2 and 6.3 describe the next task's
content; the file lists are correct. Break-it checks: ignoring pause failed
1 test; disabling rot's observer failed 1; changing the block message
failed 4.

**Update (2026-11-19):** the hook does fire, on saves made by Kiro's agent.
During tab-graveyard-app task 1.1 it ran once per skeleton file Kiro saved
(5 runs). My earlier manual editor saves never triggered it, so my test
method was wrong, not the hook. Overlapping runs during a task are harmless;
I still run the build and `npm test` at the end, and the drift check stays
the guarantee.

## 2026-11-19: tab-graveyard-app Tasks 1.1–1.2
**Kiro feature:** spec tasks; Opus 5.5 High for the meter (1.1); the save
hook rebuilt Doomscroll's skeleton copy automatically as Kiro edited
**What happened:** new `timeAway` meter holds the longest absence while the
user looks at the tab, so returning doesn't erase the decay; Resurrect
resets it.
**Evidence:** commits e40b4a8, ed05bc3; tests 303 → 319; Doomscroll browser
tests still pass. Break-it checks: dropping to 0 on return failed 8 tests;
holding the latest instead of the longest absence failed 2; not restarting
on reset failed 2; no missed-event correction failed 1.

## 2026-11-19: tab-graveyard-app Tasks 1.3–1.4
**Kiro feature:** spec tasks; Opus 5.5 High for the tombstone (1.3)
**What happened:** new `tombstone` effect: a full-page "Here lies {title},
abandoned for {duration}" card with a Resurrect button, in a shadow root so
page styles can't reach it. Effects can now read meters and report button
actions to the app.
**What Kiro caught:** the spec both required registering the new effect and
forbade editing the test that pins the effect list to four. Kiro stopped and
asked; I approved a one-line test edit and the exception was written into
the requirements.
**Evidence:** commits 18cba8f, 8966bc9; 363 tests pass (3 Doomscroll
package failures expected until task 2.3). Break-it checks: accepting
script clicks, rendering the title as HTML, a wrong hours/days cutoff,
leaking listeners on undo, and an escaping callback error each failed at
least one test.

## 2026-11-19: tab-graveyard-app Tasks 2.1–2.3
**What happened:** shared package checks moved into one module; one sync
script now builds either app's skeleton copy; Doomscroll's manifest exposes
the new tombstone module.
**Evidence:** commits 4ad6d39, 4fef407, 2b766a4, 9e11fe8; 366 tests pass;
Doomscroll browser tests still pass. Old Doomscroll build/check commands
behave identically (rebuild is a no-op; extra permission and a stale file
both still fail the check).

## 2026-11-19: tab-graveyard-app Task 3 (App 2 package)
**What happened:** App 2's manifest, rules, package validator, generated
skeleton copy and packaging tests. `npm test` now checks both apps'
packages before running Vitest.
**Evidence:** commits 61376bc, 2952827, 77b0839; tests 366 → 400. Break-it
checks: adding `tabs`, adding host_permissions, an <all_urls> match,
use_dynamic_url true, a changed threshold, and a stale skeleton copy were
all rejected by `check:graveyard`.

## 2026-11-20: tab-graveyard-app Task 5 (content script)
**What happened:** each page loads the skeleton, gets its abandonment time
from the service worker (so a discarded-and-reloaded tab keeps its decay),
and wires the tombstone's Resurrect button through the worker.
**Evidence:** commits 41238ae, 74311b2; tests 462 → 495. Break-it checks:
clearing decay without worker confirmation, dropping the generation check,
not resetting the meter on Resurrect, and ignoring the worker's stored
absence on load each failed 1–6 tests. Gap found: double-clicking Resurrect
isn't guarded in the page (harmless; the worker reset is idempotent).

## 2026-11-21: tab-graveyard-app Task 6 (popup)
**Kiro feature:** spec tasks; Opus 5.5 High for the popup (6.1)
**What happened:** popup shows this tab's stage and away time, a Bury all
button for dead tabs, the buried list with Reopen, and the demo toggle.
**What I caught:** Kiro's subagent added four partial-result notices the
spec didn't ask for (e.g. "some tabs couldn't be closed"). I checked that the
service worker really sends those fields, kept the notices, had them tested,
and updated requirement 7 to match. Kiro's tests also showed "1 day" can
never appear (hours run to 48), so I fixed the example in requirement 4.5.
**Evidence:** commit dfcb1d4 (6.1 and 6.2 together); tests 495 → 564.
Break-it checks: titles as HTML, no double-click guard, hiding the
undelivered and rules-missing notices, and Bury enabled with no dead tabs
each failed 1–3 tests.

## 2026-11-21: tab-graveyard-app Task 7 (browser tests)
**Kiro feature:** spec tasks; Opus 5.5 High for the fixture (7.2)
**What Kiro found:** under Playwright's standard extension launch, a
background tab never reports `hidden`, headless or headed, because
Playwright's per-page focus emulation keeps every page "in front". The
spec's two fallbacks wouldn't fix it. Kiro launched Chromium directly and
attached over CDP with `noDefaults`, verified it with a dedicated test, and
documented why in the fixture header.
**What happened:** real-browser tests for: fog on a short absence, the
tombstone after a long one, a real Resurrect click restoring the page
exactly, the tombstone surviving a tab discard, and Bury closing exactly
the dead tabs (the front tab stays) with Reopen restoring one.
**Evidence:** commits 494b2b6, 3d64053, d826606, f709bab, 1d79787; 6/6
browser tests pass twice in a row. Break-it checks: ignoring the worker's
stored absence after a discard and skipping the Resurrect reset each fail a
browser test.

## 2026-11-21: haunt-polish Tasks 4–5 (fog, demo time, app rules)
**What happened:** fog gets a green-grey tint and a drifting CSS noise
texture; demo mode now labels durations as demo time ("Abandoned for 33
hours (demo time)", "You lost 20 minutes (demo time) to this feed");
heavier rot glyphs in both apps.
**Evidence:** commits b5ea75e to 0dde814; tests 651 → 725; 10/10 extension
browser tests pass. Break-it checks: `innerHTML` for the new text lines now
fails 12 tests (task 4.3's scan closed the gap found after task 3); fog
drifting under reduced motion fails 14; a wrong demo scale fails 2.

## 2026-11-23: graveyard-groups Tasks 1–2
**Kiro feature:** spec tasks; Opus 5.5 High for the worker (2.1–2.2)
**What changed:** Bury all now moves dead tabs into a grey, collapsed
"Graveyard" tab group instead of closing them. Empty graveyard saves each
tab to the buried list, then closes it. Resurrect takes a tab out of the
group. Dead tabs in the user's own groups are left where they are.
Tab Graveyard now needs `tabGroups` as well as `storage`.
**Evidence:** commits 2d2e844, a327d57; tests 747 → 779. Break-it checks:
Bury pulling from user groups, Empty closing non-Graveyard tabs, closing
after a failed save, closing before saving, accepting Empty from any
sender, Resurrect not ungrouping, and Bury closing tabs each failed 1–27
tests.

## 2026-11-24: graveyard-groups Tasks 3–4
**What happened:** the toolbar badge counts dead tabs (loose, buried, and in
the user's own groups); optional auto-bury (off by default). Pinned and
audio-playing tabs never decay, and a "death watch" in hidden pages
reports the moment a tab dies, so the badge updates without a visit.
**Checked in Chrome:** badge count, Bury into the Graveyard group, a pinned
tab staying alive.
**Evidence:** commits 90b1d14, 744432e; tests 779 → 810. Break-it checks:
removing either exemption, haunting an exempt page, accepting reports from
exempt tabs, and silencing the death watch each failed 1–7 tests.
**Known limit:** in normal mode Chrome throttles timers in tabs hidden for
more than ~5 minutes, so the badge can lag by up to a minute; demo mode is
unaffected.

## 2026-11-24: graveyard-groups Task 5 (popup)
**What happened:** popup gains Empty graveyard (with a count), an auto-bury
toggle, and demo-time durations that match the tombstone.
**What I caught:** in Chrome, the popup said "Away for 2 minutes" while the
tombstone said "Abandoned for 5 days (demo time)". I asked Kiro to align
them. Kiro pointed out that scaling buried rows by the current demo setting
would mislabel old entries, so only live durations are scaled (Req 3.14).
**Evidence:** commit 2a1332e; tests 810 → 850. Break-it checks: dropping
demo scaling failed 4 tests; a wrong scale failed 3.

## 2026-11-25: haunt-kit Task 5.1 (ritual effect, created through the Effect_Hook)
**Kiro feature:** spec task; `PostFileCreate` agent hook (`.kiro/hooks/new-effect.json`)
**What happened:** Kiro created `skeleton/effects/ritual.js` with its file-create
tool. The Effect_Hook fired once on that create (event `PostFileCreate`,
`file_path` `skeleton\effects\ritual.js`) and its prompt asked for the five
steps: register the effect, document its params in the schema, add
restoration and reduced-motion tests, run `npm run build:skeletons`, and add
the README line. Kiro checked the file exports `apply` and then did all five:
- `skeleton/effects/index.js`: `ritual` registered (task 5.2 content).
- `skeleton/rule-schema.json`: `definitions["params-ritual"]` with type, range,
  default and a description for all seven params; `effect.properties.type`
  unchanged (task 5.2 content).
- `skeleton/test/restoration.test.js`: registry test now expects six effects;
  new ritual apply-then-undo tests (reduced motion off and on, `durationMs`
  300) and a reduced-motion test (task 5.3 content).
- `npm run build:skeletons`: both app copies got `effects/ritual.js`, the
  updated `index.js` and `rule-schema.json`. The command exits 1 because both
  Package_Validators report `skeleton/effects/ritual.js` and
  `skeleton/ritual/candle-path.js` missing from `web_accessible_resources`.
  That is expected until task 7.2; no manifest was edited (task 5.4 content).
- `README.md`: `ritual` line equal to its `description` export (task 5.4 content).
**First version of the ritual:** params, host with open shadow root and no
light-DOM children, static stylesheet, veil, Board grid, trail, status line,
Reset and Hint buttons, render, one-time focus, and undo through `teardown`.
Path drawing, the ending and the chime are stubs for tasks 5.5 to 5.7.
**Evidence:** `npx vitest --run skeleton/test` 414 passed; with the docs,
authoring and rules-hook tests, 472 passed.

## 2026-11-25: haunt-kit Tasks 5.5–5.11 (Candle Path ritual)
**What happened:** the ritual now draws the path (mouse and arrow keys),
lights each candle, thins the fog, plays the ghost's banishing ending and
reports `exorcised`. The full puzzle passed its tests, so the simpler
hold-to-light fallback wasn't needed.
**Evidence:** commits c7b2ea5, 16b45fb, df999c1; tests 926 → 1017. Break-it
checks: accepting fake input, completing on an incomplete path, and the
wrong action name each failed 2–17 tests.

## 2026-11-25: haunt-kit Task 7 (Doomscroll ritual finale) and first playtest
**Kiro feature:** spec tasks; Opus 5.5 High. I accidentally ran all of task 7
in one go, so I checked everything afterwards: full `npm test`, the browser
tests twice, and a hand test in Chrome.
**What happened:** after the block screen, Doomscroll now shows the Candle
Path ritual (at 25 minutes, or 25 seconds in demo mode). Solving it resets
the timer and every effect fades out; the haunting then starts over. It's a
pause, not a lock: the tab can always be closed.
**What I caught (first real playtest):** I lit all 5 candles with 9 squares
still empty and got stuck. The status said "5 of 5 candles lit" and the fog
had cleared, so it looked finished, and nothing told me that the last
candle has to be the final square or that dragging back undoes a step.
All 1017 tests passed; the rules were correct, but a player couldn't tell
what they were.
**What I changed:** asked Kiro to amend the spec and the ritual: instructions
that say the last candle must be last and that dragging back undoes; a
status showing candles and squares; a specific message when the last candle
is lit too early; and the fog following squares filled, so it only clears
when the ritual is really complete.
**Evidence:** commits <task 7>, <fix>; tests 1017 → <count>; browser tests
pass twice; screenshot of the stuck board (docs/kiro-evidence/ritual-stuck.png).

## 2026-11-26: haunt-kit Task 10 (Playground) and GitHub Pages
**What happened:** a no-install Playground page in `demo-site/` runs the
skeleton on a fake feed, with Doomscroll and Tab Graveyard presets, a
speed slider up to 3600× (matching the Graveyard demo time), a rules
editor and the ritual. Deployed to GitHub Pages by a workflow (task 10.7,
added to the spec after I pointed out the hackathon requires a URL).
**Live at:** https://lirenneedhelp.github.io/poltergeist/
**Deploy note:** the first run succeeded; the next two failed in GitHub's
artifact service ("Fetching artifact metadata failed"), including one with
an identical workflow, so the failure was on GitHub's side.

## 2026-11-26: haunt-kit Task 9.3 (generated app in Chrome)
Ran `npm run new-haunt focus-guard -- --hosts "https://www.reddit.com/*"`,
loaded app3-focus-guard unpacked in Chrome <version>, turned Demo mode on,
opened reddit.com: fog appeared after ~<N> s; Pause cleared it. Removed the
generated app afterwards so the repo keeps two apps.