# Implementation Plan: Graveyard Groups

## Overview

The plan follows the design's "Change sets" table, one top-level task per set, plus a final checkpoint. All code is plain JavaScript (ES modules) in `app2-tab-graveyard/`, with Vitest example-based unit tests shipped alongside the code they cover. `skeleton/`, the Generated_Skeletons, `rules.json`, `web_accessible_resources`, `package.json` scripts, Doomscroll, and `demo-site/` are not touched. The only new permission is `tabGroups`. No property-based test is added; the existing fast-check "Property 3" block is updated inside task 2.

Paths without a directory are under `app2-tab-graveyard/`.

## Tasks

- [x] 1. Manifest, validator, and packaging tests
  - [x] 1.1 Add `tabGroups` to the manifest and the Graveyard_Validator
    - Set `manifest.json` `permissions` to exactly `["storage", "tabGroups"]`; change no other key
    - In `scripts/validate-graveyard-package.mjs`, require `["storage", "tabGroups"]` with the single error `manifest.json: permissions must be exactly ["storage", "tabGroups"]`, and add the `tabGroups` comment directly above the check; leave the forbidden-key loop unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.11_
  - [x] 1.2 Update packaging tests and permission comments
    - `test/package.test.js`: expect `["storage", "tabGroups"]` and the new error text; add validator cases for a missing `tabGroups`, an added `alarms`, a duplicated `tabGroups`, and `["tabGroups", "storage"]`, each reporting only that error; keep the read-only `check:graveyard` failure on an added `tabs`
    - `test/sync.test.js`: expected error text updated
    - Update the permission comment in `test/browser/discard-reload.pw.js` and any other test comment that states the permissions
    - _Requirements: 11.6, 11.7_

- [x] 2. Graveyard groups, Bury, Empty graveyard, and Resurrect ungroup in the worker
  - [x] 2.1 Add worker foundations and group identity in `background.js`
    - New `MESSAGE` types (`EMPTY`, `SET_AUTO_BURY`, `REFRESH`), key prefixes, `GRAVEYARD_TITLE`, `GRAVEYARD_COLOR`, `NO_GROUP`, `MAX_EMPTY_IDS`
    - `tabView` as the only Tab reader, `openTabs()`, rename `isBuryable` to `isSaveable`, classification helpers (`graveyardIds`, `isGraveyardTab`, `isDead`, Buryable, Closable)
    - `enqueue(job, {recount})` with the post-job Recount hook (a no-op until task 3) and the `refreshQueue` flush; event jobs use `recount: 'always'`, message jobs `recount: 'ok'`
    - `usableGroup`, `moveIntoGraveyard`, `settle`; `tabGroups.onUpdated` (title check, Release), `tabGroups.onRemoved`, `windows.onRemoved` record deletion; `tabs.onUpdated` listener dropping events without `pinned`, `audible`, or `groupId` keys
    - Register `tabs.onUpdated`, `tabGroups.onUpdated`, `tabGroups.onRemoved` synchronously with the existing listeners; reject received `graveyard:refresh` like `graveyard:apply-reset`
    - `logFailure` strips URLs from Chrome error messages
    - _Requirements: 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.12, 2.13, 9.3, 9.4, 9.6_
  - [x] 2.2 Rewrite Bury, add Empty graveyard, ungroup on Resurrect, and extend popup-state
    - `bury`: sender and payload checks, `rules unavailable`, move distinct Buryable_Tabs per window with `collapse: 'always'`, write attempt keys, reply `{ok: true, moved, notMoved}`; no close, Register change, or Buried_Entry
    - `emptyGraveyard` (declared between `bury` and `reopen`): checks, select Closable_Tabs in request order up to 200, save Buried_Entries before the only `tabs.remove`, reply `{ok: true, buried, notClosed}`; works without rules
    - `resurrect` and `resurrectTab`: after the saved Reset, delete the attempt key and call `ungroupIfGraveyard` once; failures logged, Resurrect finishes as usual
    - `popupState`: `dead` holds only Buryable_Tabs, `closable` holds Closable_Tab ids in dead-list order (also when `rulesLoaded` is false); empty lists plus one diagnostic when `tabs.query` fails
    - `tabs.onRemoved` of a Graveyard_Tab saves no Buried_Entry
    - _Requirements: 2.11, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.13, 4.1, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.17, 5.1, 5.2, 5.3, 5.4, 5.6, 6.13, 9.1, 9.2, 9.7_
  - [x] 2.3 Update worker unit tests for groups, Bury, Empty, and Resurrect
    - Extend the `background.test.js` mock: Tab `pinned`, `audible`, `groupId`; in-memory `tabs.group`/`tabs.ungroup`; Proxy-based `tabGroups.get` and `tabGroups.onUpdated` objects recording title reads; changeInfo Proxy; `action.setBadgeText` stub; failure switches
    - Rewrite existing bury tests so none expects closing or a Buried_Entry; add Bury, user-group (decision 12), group-identity, Empty, and Resurrect ungroup cases listed in 11.2
    - Rename the fast-check block and its header comment to "Property 3: Nothing closes without Empty graveyard" and update both properties as 11.1 states, keeping 100 runs each
    - Rename the source scan to "closes tabs only from the Empty graveyard handler (source scan)" and bound the single `tabs.remove` inside the `graveyard:empty` handler
    - Privacy tests: no `url`/`pendingUrl`/`title`/`favIconUrl` reads, no title read of a non-recorded group, no group title in storage or diagnostics; allow the new key prefixes and `graveyard.autoBury`; listener-registration test includes the three new listeners
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 3. Recount, toolbar badge, and Auto_Bury
  - [x] 3.1 Implement Recount and Auto_Bury in `background.js`
    - `recount()` and `recountSafely()` wired into `enqueue`: count Dead_Tabs across windows (including grouped ones), record attempts for dead Graveyard_Tabs, run Auto_Bury when on and rules load (candidates: Buryable, not active, no attempt; `collapse: 'unless-active'`; attempt written whatever the outcome), commit writes only on change, then `action.setBadgeText` with no tab id (`''` at 0 or without rules)
    - Recount failures log one diagnostic, leave the badge, and do not change the job's reply
    - `setAutoBury` handler with sender and Boolean checks, `{ok: true, autoBury}` reply, `could not save auto-bury` on write failure; `popupState` adds `autoBury`
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6, 7.8, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.13_
  - [x] 3.2 Add badge and Auto_Bury unit tests
    - Badge text after one trigger of each kind in 7.2, counting dead Graveyard_Tabs and dead tabs in user groups; `''` at 0 and when `rules.json` cannot be read; Recount failure keeps the reply
    - Auto_Bury: default off; once per death; a `graveyard:bury` move counts as the attempt; active-tab skip; no move while off; turning on moves before the reply; collapse left unchanged when the group holds the active tab; user groups untouched
    - _Requirements: 11.2_

- [x] 4. Pinned and audible exemptions, page refresh, and death watch
  - [x] 4.1 Implement exemption sync in `background.js`
    - `syncExemption` for entry (Reset, attempt cleared, refresh queued) and exit (Registers 0, `since` = now, fresh Absence when not active, refresh queued)
    - Sync from `sender.tab` in `contentState`, `report`, `resurrect`; from `tabs.get` in `tabs.onActivated`; from `tabs.query` in `seedTabs` and the Recount; from `tabs.onUpdated` when `pinned` or `audible` changes
    - `contentState` replies `exempt` with zero seeds when exempt; `report` replies `{ok: true, applied: false}` for exempt tabs; exempt tabs excluded from lists, badge, and Auto_Bury; exemption never ungroups
    - `tabs.onRemoved` deletes exempt and attempt keys; `tabs.onReplaced` moves them to the added id, then syncs from `tabs.get(added)`
    - _Requirements: 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 6.10, 6.12, 6.13, 6.14, 9.9_
  - [x] 4.2 Implement exemption handling and the death watch in `content.js`
    - `parseState` requires a Boolean `exempt`; a reply without it is a failed state request with one diagnostic; `exempt: true` stops any instance and starts none
    - Accept `graveyard:refresh` from the extension's own id and run the existing serialized, generation-guarded refresh
    - Add `every`, `cancel`, `isHidden` dependencies; death watch armed while hidden, ticking the engine each second and sending one unchanged `graveyard:report` when `timeAway` reaches the active profile's Tombstone threshold; disarmed on visible, stop, dispose, fault, and after its report
    - _Requirements: 5.5, 6.7, 6.9, 6.11, 7.3, 7.7, 9.8_
  - [x] 4.3 Add exemption unit tests in `background.test.js`
    - Reset on becoming pinned and on becoming audible; Registers held at 0; ignored page reports; the `exempt` reply field; `graveyard:refresh` on entry and exit; fresh Absence on exit for an inactive tab; no ungroup on exemption; `tabs.onReplaced` moving exempt and attempt keys; no keys left after `tabs.onRemoved`
    - _Requirements: 11.2, 9.9_
  - [x] 4.4 Add content-script unit tests in `content.test.js`
    - Harness default reply gains `exempt: false`; `exempt: true` starts nothing; refresh stops a running instance on `exempt: true`; refresh starts one instance on `exempt: false` for a dead tab; missing `exempt` fails with one diagnostic
    - Death watch: one report with exactly `type`, `title`, `heldSeconds`, `epoch` at 24 s in Demo_Mode; none while visible; none after stop or dispose; re-arms after apply-reset while hidden
    - _Requirements: 11.5_

- [ ] 5. Popup changes
  - [ ] 5.1 Update `popup.html`, `popup.css`, and `popup.js`
    - Add the `#empty` button (with the `danger` style moved from Bury) and the `Auto-bury dead tabs` checkbox; static `.actions` row and stacked `.footer`, no animation
    - `parseState` reads `autoBury` and `closable`; render `Empty graveyard (M)` only for confirmed M > 0, disabled while busy; `No dead tabs outside tab groups.` text
    - `buryAll` requires `moved` and `notMoved` arrays and shows the not-moved warning; `emptyGraveyard` sends the first 500 closable ids and handles warnings and rollback; `setAutoBury` mirrors `setDemo`
    - The popup calls no `tabGroups`, `tabs.group`, `tabs.ungroup`, or `action` API and reads only the active tab's `id`
    - _Requirements: 1.10, 3.1, 3.2, 3.10, 3.11, 3.12, 4.2, 4.3, 4.13, 4.14, 4.15, 4.16, 8.1, 8.3, 8.12, 9.5, 9.6_
  - [ ] 5.2 Update `popup.test.js`
    - `popupState()` helper gains `autoBury: false, closable: []`; Bury with `moved`/`notMoved` (N = 1, 2, rollback on a missing array); Empty hidden at M = 0, shown at M ≥ 1, ids sent, disabled in flight, warnings, rollback; Auto-bury checked from state, message sent, rollback text; `No dead tabs outside tab groups.`; source scan for forbidden APIs
    - _Requirements: 11.5, 1.10_

- [ ] 6. Prior spec documents
  - [ ] 6.1 Amend `.kiro/specs/tab-graveyard-app/requirements.md`
    - Replace each item listed in 10.1 in place, ending with `(amended by graveyard-groups)` and a `Reason (graveyard-groups):` paragraph
    - Add each `Note (graveyard-groups):` paragraph listed in 10.2
    - Keep every number, Glossary term, and haunt-polish text unchanged
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6_
  - [ ] 6.2 Add notes to `.kiro/specs/tab-graveyard-app/design.md`
    - Add the three `Note (graveyard-groups):` paragraphs listed in 10.3; leave the Prior_Spec `tasks.md` unchanged
    - _Requirements: 10.3, 10.4, 10.6_

- [ ] 7. Browser tests
  - [ ] 7.1 Add fixture helpers and check headless risks first
    - In `test/browser/extension-fixture.js`, add worker-evaluated helpers `tabInfo`, `groupInfo`, `recordedGroupId`, `badgeText`
    - Before writing the other browser tests, run a short probe in the fixture's Chromium that groups two tabs and reads title, colour, and collapsed state, and makes one tab audible with a trusted click and a Web Audio oscillator; if headless does not report `audible` or group state, switch the affected test to `test.use({ headless: false })` and record the reason in its header comment
    - _Requirements: 11.8, 11.10, 11.11, 11.12_
  - [ ] 7.2 Update `test/browser/bury-reopen.pw.js`
    - Replace the old Bury test with "Bury all moves without closing" and add "Empty graveyard closes and saves", both with real Playwright clicks and the evidence of 11.8 and 11.9; update comments describing `Bury all`
    - _Requirements: 11.7, 11.8, 11.9_
  - [ ] 7.3 Add `test/browser/graveyard-groups.pw.js`
    - "Resurrect ungroups", "Pinned and audible tabs are exempt" (with the audio steps and the 1 s `pinned`/`audible` sampler), and "Badge counts dead tabs", each on a fresh profile with a 90 s timeout and `diagnostics.expectClean()`
    - _Requirements: 11.10, 11.11, 11.12_

- [ ] 8. Final checkpoint
  - Run `npm test`, `npm run build:skeletons` (same `git status --porcelain` before and after), and `npm run test:browser`; each must exit 0 with no skipped test, and no Doomscroll or skeleton test file may change
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 11.13_

## Notes

- Unit-test sub-tasks are not marked optional, because Requirement 11 makes them part of the deliverable and the user asked for tests to ship with their code.
- No property-based test task exists. The only fast-check change is the Property 3 rename and update in task 2.3.
- Tasks 2 to 4 all edit `background.js` and `background.test.js`, so they run in sequence.
- Each task references requirement criteria for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.2", "5.1", "6.1", "6.2"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.4", "5.2"] },
    { "id": 2, "tasks": ["2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.3"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3"] }
  ]
}
```
