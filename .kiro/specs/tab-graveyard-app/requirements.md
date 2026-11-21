# Requirements Document

## Introduction

Tab Graveyard is the second Poltergeist application: a Chrome Manifest V3 extension rooted at `app2-tab-graveyard/`. Doomscroll haunts too much attention; Tab Graveyard haunts neglect. When the user returns to a tab after being away, the page shows decay that matches how long the tab was abandoned: Fog, then Rot, then a Tombstone overlay that names the page and how long it was abandoned. The decay stays until the user resurrects the tab. The popup lists dead tabs as a graveyard, can bury them (close them and save their title and URL), and can reopen any buried tab.

The app uses the root `skeleton/` through a committed generated mirror, as Doomscroll does. Three generic, Chrome-free additions are made to the skeleton: a `timeAway` meter, a `tombstone` effect, and two optional host hooks on `startPoltergeist` (`readMeter` and `onAction`) that let an effect show a meter value and report a user action. Doomscroll's behaviour and its existing tests must stay unchanged. The only Doomscroll file that changes is its `manifest.json`, which must expose the new `tombstone.js` module because it becomes part of the skeleton's static import graph; its generated mirror is rebuilt.

Change markers: `NEW` is new code; `SKELETON` changes shared code under `skeleton/`; `PACKAGING` changes the build scripts shared with Doomscroll.

Verification modes: criteria are statically or Vitest-verified unless prefixed `(BROWSER-VERIFIED)`. Browser-verified criteria run through Playwright with the unpacked extension loaded in Playwright's bundled Chromium, as in the Doomscroll suite.

Out of scope: syncing across devices, tab grouping, site-specific behaviour, persisting tab records across a browser restart, pausing the haunt, and any change under `demo-site/`.

## Glossary

- **Web_Scope**: exactly the two match patterns `http://*/*` and `https://*/*`.
- **Absence**: a continuous period during which a tab is not the active tab of its window (as tracked by the service worker) or its document is hidden (as seen by the page).
- **Held_Absence**: the longest completed Absence of a tab since its last reset, in seconds.
- **Away_Time**: the value that drives decay: the Held_Absence while the tab is in use, or the larger of the Held_Absence and the current Absence while the tab is away.
- **Time_Away_Meter**: the new skeleton meter `timeAway`, which reports Away_Time from page visibility, without Chrome APIs.
- **Tombstone_Effect**: the new skeleton effect `tombstone`: a full-page overlay with an epitaph and one action button.
- **Activity_Tracker**: the service-worker logic that records, per tab, when each Absence started and the Held_Absence. It is the source of truth.
- **Tab_Record**: the Activity_Tracker's per-tab entry in `chrome.storage.session`.
- **Register**: the pair (Held_Absence, profile epoch) kept in a Tab_Record for one profile. Each Tab_Record has a normal Register and a demo Register.
- **Stage**: one of `alive`, `fogged`, `rotting`, `dead`, derived from Away_Time and the active profile's rule thresholds.
- **Dead_Tab**: an open, recorded, non-incognito tab whose Away_Time is at or above the Tombstone threshold of the active profile.
- **Buried_Entry**: a saved record `{id, title, url, buriedAt, awaySeconds}` of a tab closed by Bury.
- **Graveyard**: the popup view that lists Dead_Tabs and Buried_Entries.
- **Normal_Profile**: the rules parsed from `app2-tab-graveyard/rules.json`.
- **Demo_Profile**: a deep clone of the Normal_Profile whose trigger `threshold` and `rampTo` are divided by the Demo_Time_Scale.
- **Demo_Time_Scale**: exactly 3600 (one hour of normal timing per second of demo timing).
- **Profile_Epoch**: a counter the Activity_Tracker increments on every actual Demo_Mode transition.
- **Demo_Mode**: a global Boolean preference stored in `chrome.storage.local`.
- **Runtime_Controller**: the content-script logic that owns at most one live Poltergeist instance per document.
- **Resurrect**: the user action that resets one tab's Registers to zero and clears its decay.
- **Bury**: the user action that saves Buried_Entries for the listed Dead_Tabs and then closes them.
- **Skeleton_Sync**: the generalised Node script `scripts/sync-skeleton.mjs` that builds or checks the generated skeleton mirror of each registered app.
- **Generated_Skeleton**: the committed `app2-tab-graveyard/skeleton/` copy of the root skeleton's production files.
- **Graveyard_Validator**: the build/test-time package validator for `app2-tab-graveyard/`.

## Requirements

### Requirement 1: Manifest V3 package and permission scope - NEW
**User Story:** As a user, I want Tab Graveyard to work on every web page while asking for as little as possible, so that installing it grants only what the feature needs.

#### Acceptance Criteria

1. THE app SHALL contain `manifest.json`, `rules.json`, `content.js`, `background.js`, `popup.html`, `popup.js`, `popup.css`, and the Generated_Skeleton under `app2-tab-graveyard/`.
2. THE manifest SHALL declare `manifest_version` 3, a name and version, a module service worker `background.js`, an action whose `default_popup` is `popup.html`, and `"incognito": "not_allowed"`.
3. THE manifest `permissions` SHALL be exactly `["storage"]`, and THE manifest SHALL NOT declare `host_permissions`, `optional_permissions`, `optional_host_permissions`, `externally_connectable`, `content_security_policy`, or `sandbox`.
4. THE manifest SHALL statically register exactly one classic content script `content.js` with `matches` equal to the Web_Scope, `run_at` `document_idle`, `all_frames` false, and the default isolated world.
5. THE manifest SHALL expose, as one web-accessible-resource entry with `matches` equal to the Web_Scope and `use_dynamic_url` false, exactly `rules.json` plus every module reachable by relative static import from `skeleton/index.js`, and nothing else.
6. THE extension SHALL use only Chrome APIs that need no permission other than `storage`: `tabs.query`, `tabs.get`, `tabs.remove`, `tabs.create`, `tabs.sendMessage`, the `tabs.onActivated`, `tabs.onRemoved`, and `tabs.onReplaced` events, `windows.onRemoved`, `runtime` messaging, and `storage`. IT SHALL NOT read the `url`, `pendingUrl`, `title`, or `favIconUrl` properties of a `Tab` object.
7. THE extension SHALL package all executable code locally and SHALL NOT use remote code, `eval`, `new Function`, string-valued timers, inline scripts, or inline event-handler attributes.
8. THE app SHALL apply effects to the whole page through skeleton effects only and SHALL NOT query or depend on site-specific selectors.

### Requirement 2: Normal and demo decay profiles - NEW
**User Story:** As a student with dozens of forgotten tabs, I want decay that grows with how long I left a tab, so that neglect becomes visible without anything being closed for me.

#### Acceptance Criteria

1. THE `rules.json` document SHALL pass `validateRules` with `builtinEffects` and SHALL contain exactly three enabled rules in this order: `graveyard-fog`, `graveyard-rot`, `graveyard-tombstone`.
2. EVERY rule SHALL match exactly the Web_Scope and SHALL use the `timeAway` meter.
3. THE `graveyard-fog` rule SHALL start at 1800 seconds (30 minutes), reach full intensity at 7200 seconds (2 hours), use effect `fog` with `maxBlur` 4 and `maxGrayscale` 0.8, and fade out over 400 milliseconds.
4. THE `graveyard-rot` rule SHALL start at 14400 seconds (4 hours), reach full intensity at 43200 seconds (12 hours), use effect `rot` with `maxFraction` 0.45 and glyphs `▓▒░█`, and undo instantly. (amended by haunt-polish)

   Reason (haunt-polish): The old light glyphs `░▒·_ ` were hard to see at video resolution.

5. THE `graveyard-tombstone` rule SHALL start at 86400 seconds (24 hours) with no `rampTo`, use effect `tombstone` with heading `Here lies {title}`, message `Abandoned for {duration}.`, action label `Resurrect`, action `resurrect`, duration meter `timeAway`, and `maxOpacity` 0.96, and fade out over 600 milliseconds.

   Note (haunt-polish): haunt-polish Requirement 7 adds `tint`, `noise`, and `driftMs` to `graveyard-fog`, and `weathered`, `mark`, and `riseInMs` to `graveyard-tombstone`. The exact values are in haunt-polish `design.md`. The params listed in criteria 3 to 5 stay as stated, apart from the glyphs amended in criterion 4.

6. THE Runtime_Controller SHALL build the Demo_Profile by deep-cloning the Normal_Profile and dividing every trigger `threshold` and `rampTo` by the Demo_Time_Scale, giving Fog from 0.5 to 2 seconds, Rot from 4 to 12 seconds, and the Tombstone at 24 seconds. Building it SHALL NOT mutate the Normal_Profile.
7. THE Runtime_Controller SHALL validate the selected profile before starting it and SHALL treat a validation failure as a startup failure that leaves the page clean.
8. THE app SHALL NOT use the `flicker` effect. THE app's only animations and transitions SHALL be the fade-out on undo, the Fog Drift, and the Tombstone Rise_In defined in the haunt-polish spec. WHILE the user's `prefers-reduced-motion` preference is `reduce`, THE app's only animation or transition SHALL be the fade-out on undo. WHILE Demo_Mode is on, THE Tombstone SHALL fill `{duration}` with the Away_Time multiplied by the Demo_Time_Scale and followed by ` (demo time)`, as defined in haunt-polish Requirements 1 and 6 (for example `Abandoned for 33 hours (demo time).` after 33 seconds away). WHILE Demo_Mode is off, THE Tombstone `{duration}` text SHALL be the same as before haunt-polish. (amended by haunt-polish)

   Reason (haunt-polish): The 3-minute demo video must show the Graveyard finale clearly, and a tombstone that appears in a single frame is easy to miss on camera. `prefers-reduced-motion` remains the safeguard, so users who ask for reduced motion see no new motion. Demo_Mode durations are labelled `(demo time)` so that viewers see realistic durations and know they are simulated.

9. THE production thresholds SHALL NOT change because the extension is unpacked, under Playwright, or on a fixture; only Demo_Mode selects the Demo_Profile.

### Requirement 3: Time-away meter - SKELETON
**User Story:** As a skeleton maintainer, I want a generic meter for how long a page was left, so that any app can drive effects from neglect without Chrome APIs in the skeleton.

#### Acceptance Criteria

1. THE meter set SHALL add a `timeAway` value, in seconds, to the result of `values()`, alongside the unchanged `timeOnSite`, `scrollDistance`, and `timeSinceActive`.
2. WHEN the document becomes hidden and no Absence is in progress, THE Time_Away_Meter SHALL start an Absence at that time.
3. WHILE an Absence is in progress, `timeAway` SHALL equal the larger of the Held_Absence and the elapsed Absence measured to the last `update()`.
4. WHEN the document becomes visible during an Absence, THE Time_Away_Meter SHALL set the Held_Absence to the larger of the Held_Absence and the completed Absence, and end the Absence.
5. WHILE the document is visible, `timeAway` SHALL equal the Held_Absence and SHALL NOT decrease.
6. WHEN `update()` observes a visibility state that contradicts the meter's Absence state because an event was missed, THE Time_Away_Meter SHALL start or complete the Absence at that tick.
7. THE meter set SHALL accept seeds `initial.timeAway` (Held_Absence) and `initial.timeAwayCurrent` (elapsed part of an Absence already in progress). IF the document is hidden at creation, THEN the Absence SHALL be treated as having started `timeAwayCurrent` seconds earlier. IF the document is visible at creation, THEN the Held_Absence SHALL be the larger of the two seeds and no Absence SHALL be in progress.
8. THE meter set SHALL treat a missing, negative, non-finite, or non-number seed as 0.
9. THE meter set SHALL expose `reset(name)`. FOR `timeAway`, it SHALL set the Held_Absence to 0, restart any Absence in progress at the current time, and return true. FOR every other name, it SHALL change nothing and return false.
10. THE Time_Away_Meter SHALL reuse the existing visibility listener and SHALL be removed by the existing `dispose()`.
11. THE meter module SHALL contain no reference to `chrome` or `browser` extension APIs.
12. THE rule schema and the validator meter list SHALL both include `timeAway`, and the existing schema/validator consistency test SHALL keep passing.
13. THE existing meter, engine, effect, restoration, validator, and index tests SHALL pass unchanged. The only permitted edit to an existing test is adding `tombstone` to the built-in effect registry assertion in `skeleton/test/restoration.test.js`.

### Requirement 4: Tombstone effect and host hooks - SKELETON
**User Story:** As a user returning to a long-abandoned tab, I want a tombstone that names the page and says how long I left it, with one button to bring it back, so that the neglect is clear and recovery is one click.

#### Acceptance Criteria

1. THE skeleton SHALL add `skeleton/effects/tombstone.js` exporting `{ apply, undo, description }` and SHALL register it as `tombstone` in `builtinEffects`.
2. WHEN applied without a live Handle, THE Tombstone_Effect SHALL append one host element with `data-poltergeist="tombstone"` to `documentElement`, attach an open shadow root, and render a heading, a message, and one native `<button>` inside that shadow root, so page CSS does not reach them.
3. THE Tombstone_Effect SHALL use fixed full-viewport positioning, the same top z-index as Block, opacity `maxOpacity × intensity`, and SHALL intercept pointer input once intensity reaches `blockAt` (default 1).
4. THE Tombstone_Effect SHALL replace `{title}` with the trimmed `document.title`, falling back to `location.hostname` and then to `this page`, truncated to 120 characters with an ellipsis.
5. THE Tombstone_Effect SHALL replace `{duration}` with the value of the meter named by `durationMeter`, read through `env.readMeter`, formatted as whole seconds below 1 minute, whole minutes below 1 hour, whole hours below 48 hours, and whole days otherwise, with singular and plural forms (for example `1 hour`, `30 hours`, `2 days`). IF `env.readMeter` is missing or returns a non-finite value, THEN it SHALL use `a while`.

   Note (haunt-polish): haunt-polish Requirement 1 extends this criterion with the `durationScale` and `durationSuffix` params. When both params are absent, as in the Normal_Profile, the inserted text is unchanged. In Demo_Mode the Tombstone shows demo time instead of seconds, for example `33 hours (demo time)` after 33 seconds away.

6. THE Tombstone_Effect SHALL set all text with `textContent` and SHALL NOT parse the page title or params as HTML.
7. THE Tombstone_Effect SHALL re-render its text on every `apply` and on the next timer turn after the document becomes visible, so a later and longer Absence updates the duration shown.
8. WHEN the button receives a click whose `isTrusted` is true, THE Tombstone_Effect SHALL call `env.onAction(action)` once; IT SHALL ignore untrusted clicks, and IT SHALL contain any error thrown by `onAction`.
9. WHEN undone, THE Tombstone_Effect SHALL remove its visibility listener and button listener and remove the host element, fading over `durationMs` when it is positive, and SHALL leave the page byte-for-byte as before apply.
10. WHEN applied without a live Handle while `env.reducedMotion` is false and `riseInMs` is greater than 0, THE Tombstone_Effect SHALL play the Rise_In defined in the haunt-polish spec once. WHEN applied without a live Handle while `env.reducedMotion` is true or `riseInMs` is 0, THE Tombstone_Effect SHALL show no animation. WHEN applied with a live Handle, THE Tombstone_Effect SHALL NOT replay the Rise_In or start any other animation. WHEN applied, THE Tombstone_Effect SHALL schedule no timer. (amended by haunt-polish)

   Reason (haunt-polish): The 3-minute demo video must show the Graveyard finale clearly, and a tombstone that appears in a single frame is easy to miss on camera. `prefers-reduced-motion` remains the safeguard, so users who ask for reduced motion see no new motion.

11. `startPoltergeist` SHALL accept an optional `onAction(name)` callback and SHALL add to the effect environment `readMeter(name)`, which returns the current meter value, and `onAction(name)`, which calls the callback inside a try/catch and does nothing when no callback was given.
12. THE skeleton changes in Requirements 3 and 4 SHALL NOT change `skeleton/engine.js`, `skeleton/match.js`, or the behaviour of the `fog`, `flicker`, `rot`, and `block` effects.

   Note (haunt-polish): This criterion limited only the skeleton changes made under this spec. haunt-polish deliberately changes the Fog, Block, and Tombstone effects and the Rot glyphs in both apps' rules, and leaves Flicker, `rot.js`, `engine.js`, and `match.js` unchanged.

### Requirement 5: Service-worker activity tracking - NEW
**User Story:** As a user whose tabs Chrome discards to save memory, I want the extension to remember how long each tab was abandoned even when the page reloads, so that decay is not lost.

#### Acceptance Criteria

1. THE Activity_Tracker SHALL be the source of truth for each tab's Absence start and Registers, and SHALL store each Tab_Record under its own `chrome.storage.session` key ending in the tab id.
2. WHEN `tabs.onActivated` fires for tab B in window W, THE Activity_Tracker SHALL end any Absence of B (raising each valid Register's Held_Absence to the completed Absence) and SHALL start an Absence for the tab previously recorded as active in W, but only if `tabs.get` reports that tab as existing and not active.
3. THE Activity_Tracker SHALL record the active tab of each window under its own `chrome.storage.session` key and SHALL delete it on `windows.onRemoved`.
4. WHEN `runtime.onInstalled` or `runtime.onStartup` fires, THE Activity_Tracker SHALL query all tabs, record each window's active tab, and start an Absence at that time for each inactive tab that has no Tab_Record.
5. WHEN a content script requests its state from a tab with no Tab_Record, THE Activity_Tracker SHALL create one, with an Absence starting now if `sender.tab.active` is false.
6. WHEN `tabs.onReplaced` fires, THE Activity_Tracker SHALL move the Tab_Record and any window entry from the removed tab id to the added tab id.
7. WHEN `tabs.onRemoved` fires, THE Activity_Tracker SHALL delete only that tab's Tab_Record and clear any window entry that points to it.
8. THE demo Register's ongoing Absence SHALL be measured from the later of the Absence start and the start of the current demo epoch; a demo Register from an earlier Profile_Epoch SHALL count as 0.
9. WHEN Demo_Mode changes, THE Activity_Tracker SHALL increment the Profile_Epoch and record the time the new epoch started, and SHALL NOT change any normal Register.
10. WHEN a content script reports a page-observed Held_Absence with the current Profile_Epoch, THE Activity_Tracker SHALL raise the matching Register's Held_Absence to the larger value, capped at the time since the Tab_Record was created or last reset; reports with another epoch SHALL be ignored.
11. THE Activity_Tracker SHALL derive a content script's tab id from `sender.tab.id`, its URL from `sender.url`, and SHALL accept messages only from the extension's own content scripts and pages.
12. THE Activity_Tracker SHALL run every read-modify-write of storage through one serialized queue, so concurrent events cannot lose an update.
13. THE Activity_Tracker SHALL register all event listeners synchronously at the top level of `background.js`, and a restarted worker SHALL continue from the stored state.
14. THE Activity_Tracker SHALL read stage thresholds from the packaged `rules.json` rule ids and SHALL apply the Demo_Time_Scale when Demo_Mode is on. IF `rules.json` cannot be read, THEN it SHALL report no Dead_Tabs and SHALL refuse Bury.

### Requirement 6: Page decay on return and Resurrect - NEW
**User Story:** As a user returning to an abandoned tab, I want the page to show its decay straight away and keep it until I resurrect it, so that leaving a tab has a visible cost.

#### Acceptance Criteria

1. THE content script SHALL be a classic script with no static `import` or `export`, SHALL load the Generated_Skeleton with dynamic `import(chrome.runtime.getURL('skeleton/index.js'))`, and SHALL fetch `rules.json` the same way.
2. WHEN the content script starts, it SHALL register its listeners, send `graveyard:content-state` with the page title, and start no Poltergeist instance until a successful reply arrives.
3. THE Runtime_Controller SHALL start the selected profile with `initialMeters` `{ timeAway: heldSeconds, timeAwayCurrent: currentSeconds }` from the reply, with `tickMs` 1000 and the `onAction` callback, so a reloaded or discarded tab shows the decay the Activity_Tracker recorded.
4. (BROWSER-VERIFIED) WHEN the user returns in Demo_Mode to a tab left for at least 3 seconds, THE page SHALL show Fog and no Tombstone; WHEN the user returns to a tab left for at least 25 seconds, THE page SHALL show the Tombstone naming the page title and a duration.
5. (BROWSER-VERIFIED) WHILE the user stays on a returned tab, THE decay SHALL remain visible and SHALL NOT fade.
6. (BROWSER-VERIFIED) WHEN a tab is reloaded or discarded while away and then activated, THE page SHALL show decay for its full Away_Time even though in-page state was lost.
7. WHEN the document's visibility changes, THE content script SHALL send `graveyard:report` with the current title, the meter's Held_Absence, and the Profile_Epoch it started with.
8. WHEN the Tombstone_Effect reports the `resurrect` action, THE content script SHALL send `graveyard:resurrect`; only after a successful reply SHALL it call `meters.reset('timeAway')` and `engine.tick()`, so the decay clears at once with its configured fades. IF the reply fails, THEN the decay SHALL stay and the content script SHALL report one diagnostic.
9. WHEN the content script receives `graveyard:apply-reset` from the service worker, it SHALL reset `timeAway` and tick the engine the same way.
10. WHEN Demo_Mode changes in `chrome.storage.onChanged`, THE Runtime_Controller SHALL request fresh state, stop the current instance, and start the new profile from the new seeds; requests SHALL be serialized and guarded by a generation token so that no more than one instance is live.
11. WHEN `pagehide` fires, THE Runtime_Controller SHALL let the skeleton stop the instance and SHALL not reconcile again for that page; WHEN `pageshow` fires with `persisted` true, it SHALL request fresh state and start one new instance.
12. IF import, fetch, JSON parsing, validation, or the state request fails, THEN THE content script SHALL report one diagnostic prefixed `[poltergeist:graveyard]` and leave the page clean; IF `stop` throws, THEN it SHALL keep the reference, enter a fault state, and start no replacement.
13. THE content script SHALL never close, navigate, or reload its tab.

### Requirement 7: Graveyard popup, Bury, and reopen - NEW
**User Story:** As a user with many dead tabs, I want to see them in one list, close them all in one click with a record kept, and bring any of them back, so that clearing tabs is safe.

#### Acceptance Criteria

1. THE popup SHALL show the active tab's Stage and Away_Time, a `Resurrect this tab` button, a list of Dead_Tabs, a `Bury all` button, a list of Buried_Entries each with a `Reopen` button, and a `Demo mode` control, using native buttons and labelled controls with visible focus and disabled states.
2. THE popup SHALL obtain every title, URL, and duration from the service worker through `graveyard:popup-state` and SHALL read only the active tab's id from the Tabs API.
3. THE popup SHALL render titles and URLs with `textContent` and SHALL show each URL's host only.
4. WHEN the active tab has no Tab_Record with a URL, THE popup SHALL show `Not haunted here` and disable `Resurrect this tab`.
5. WHEN the user activates `Resurrect this tab`, THE service worker SHALL reset that tab's Registers, then send `graveyard:apply-reset` to the tab, and SHALL return whether delivery succeeded.
6. THE `Bury all` button SHALL show the number of listed Dead_Tabs and SHALL be disabled when there are none.
7. WHEN the user activates `Bury all`, THE popup SHALL send `graveyard:bury` with the listed tab ids, and THE service worker SHALL bury only the ids that are still Dead_Tabs at that moment.
8. WHEN burying, THE service worker SHALL first save one Buried_Entry per tab to `chrome.storage.local`, and SHALL call `tabs.remove` only after the save succeeds. IF the save fails, THEN it SHALL close no tab and return an error.
9. THE service worker SHALL call `tabs.remove` only while handling `graveyard:bury` from an extension page; no timer, event, threshold, or content-script message SHALL close a tab.
10. IF `tabs.remove` fails for a tab, THEN its Buried_Entry SHALL remain and the result SHALL list that tab as not closed.
11. WHEN the user activates `Reopen`, THE service worker SHALL open the entry's URL with `tabs.create` only if its protocol is `http:` or `https:`, and SHALL remove the entry only after the tab is created.
12. THE Buried_Entries list SHALL hold at most 200 entries, newest first, dropping the oldest when full; each title SHALL be at most 300 characters and each URL at most 2048 characters.
13. THE popup SHALL roll back to the last confirmed state and show a short error when a command fails, and SHALL prevent a second click while a command is in flight.
14. THE popup and service worker SHALL use an enumerated, namespaced message protocol, SHALL reject unknown or malformed messages without side effects, and SHALL return `{ok:true, ...}` or `{ok:false, error}`.
15. (BROWSER-VERIFIED) WHEN two fixture tabs have been left for longer than the demo Tombstone threshold and a third tab was recently active, THEN the Graveyard SHALL list exactly the two dead tabs; no tab SHALL close before `Bury all` is clicked; after the click exactly those two SHALL close and appear as Buried_Entries; and `Reopen` SHALL open a tab at the saved URL.
16. WHEN a `graveyard:resurrect-tab` reply is `ok:true` with `delivered` exactly `false`, THE popup SHALL refresh its state and show the warning `Reset saved, but this tab is not responding. The decay clears when the page reloads.`
17. WHEN a `graveyard:bury` reply is `ok:true` with a non-empty `notClosed` array of length N, THE popup SHALL refresh its state and show the warning `Could not close N tab.` followed by `It is still open.` when N is 1, or `Could not close N tabs.` followed by `They are still open.` otherwise; the Buried_Entries for those tabs remain listed (criterion 10). A `graveyard:bury` reply without both a `buried` array and a `notClosed` array SHALL be treated as a failed command (criterion 13).
18. WHEN a `graveyard:reopen` reply is `ok:true` with `entryRemoved` exactly `false`, THE popup SHALL refresh its state and show the warning `Reopened, but the entry could not be removed from the list.`
19. WHEN a `graveyard:popup-state` reply has `rulesLoaded` exactly `false` and no Dead_Tabs are listed, THE popup SHALL show `Could not load the decay rules, so no tabs are listed.` in place of `No dead tabs.`; a missing `rulesLoaded` SHALL be treated as `true`.
20. THE warnings in criteria 16–18 SHALL replace any previous notice, SHALL be cleared when the next command starts, and SHALL NOT be shown if the state refresh after the command fails (the popup shows its unreachable state instead).

### Requirement 8: Stored data and privacy - NEW
**User Story:** As a user, I want the extension to keep only what the graveyard needs, so that my browsing is not recorded beyond that.

#### Acceptance Criteria

1. THE extension SHALL store open-tab data (title, URL, Absence start, Registers) only in `chrome.storage.session`, which Chrome clears when the browser closes.
2. THE extension SHALL store only Demo_Mode and Buried_Entries in `chrome.storage.local`.
3. THE extension SHALL NOT store page text, history beyond the buried tabs, scroll data, or any data from incognito tabs.
4. THE content script SHALL send only the page title and meter values; the URL SHALL come from `sender.url`.
5. Diagnostics SHALL be prefixed `[poltergeist:graveyard]` and SHALL NOT log titles, URLs, or stored records.

### Requirement 9: Shared packaging and drift checks - PACKAGING
**User Story:** As a maintainer, I want one sync script that builds and checks both apps' skeleton mirrors, so that the pattern is not copied for each app.

#### Acceptance Criteria

1. THE repository SHALL provide `scripts/sync-skeleton.mjs` with a registry of apps (`doomscroll` → `app1-doomscroll`, `graveyard` → `app2-tab-graveyard`), a build mode, a read-only `--check` mode, and an `--app <key>` option; without `--app` it SHALL process every registered app.
2. THE Skeleton_Sync SHALL keep the Doomscroll copy policy for every app: copy every root skeleton file except `skeleton/test/**`, preserve bytes and relative paths, remove stale files only inside the guarded target `<appDir>/skeleton`, and produce the same output when run twice.
3. THE Skeleton_Sync SHALL run each processed app's package validator after building or after a passing check, and SHALL exit nonzero if any app has drift or validation errors.
4. `scripts/sync-doomscroll-skeleton.mjs` SHALL remain as a thin wrapper over the Skeleton_Sync with its current exports (`REPO_ROOT`, `isExcluded`, `listFiles`, `compareFileMaps`, `formatDiagnostics`, `check`, `build`), its `--check` CLI, and its current messages, so existing Doomscroll tests and the Doomscroll Playwright fixture work unchanged.
5. THE `package.json` scripts SHALL provide `build:graveyard`, `check:graveyard`, `build:skeletons`, and `check:skeletons`; `build:doomscroll` and `check:doomscroll` SHALL use the Skeleton_Sync with `--app doomscroll`; `check:doomscroll` SHALL still work in a repository copy that has no `app2-tab-graveyard/`.
6. `npm test` SHALL run `check:graveyard` and `check:doomscroll` before Vitest and SHALL exit nonzero without running Vitest if either fails. THE `test` script SHALL stay `npm run check:doomscroll && vitest --run`, and the graveyard check SHALL run from a `pretest` script, so the existing script-order test passes unchanged.
7. THE shared package checks (import-graph resolution, web-accessible-resource expansion, prohibited-code scan, comment stripping) SHALL live in one module under `scripts/` that both app validators import; `scripts/validate-doomscroll-package.mjs` SHALL re-export the helpers its tests import.
8. THE Graveyard_Validator SHALL require the manifest scope of Requirement 1, the exact rules of Requirement 2, a web-accessible-resource set equal to the reachable graph from generated `skeleton/index.js` plus `rules.json`, no test files in the Generated_Skeleton, and no prohibited code in app-owned JavaScript or HTML.
9. THE Generated_Skeleton SHALL be committed and not ignored by Git.
10. THE Doomscroll `manifest.json` SHALL add `skeleton/effects/tombstone.js` to its web-accessible resources, and its Generated_Skeleton SHALL be rebuilt; no other Doomscroll file SHALL change.

### Requirement 10: Automated verification - NEW
**User Story:** As a maintainer, I want unit and real-browser evidence for the new meter, the worker, and the packaged app, so that regressions in either app are caught.

#### Acceptance Criteria

1. `vitest.config.js` SHALL include `app2-tab-graveyard/test/**/*.test.js` and keep excluding `.pw.js` files.
2. THE meter tests SHALL cover the Time_Away_Meter rules of Requirement 3, including a property test over random hide/show/advance/reset sequences that compares `timeAway` with a reference model.
3. THE effect tests SHALL cover tombstone rendering, placeholder text, `textContent` safety for a title containing markup, rejection of untrusted clicks, re-render on visibility, and exact restoration after undo; THE index tests SHALL cover `readMeter` and contained `onAction` errors; THE trusted-click path SHALL be verified by a real click in the browser suite.
4. THE worker tests SHALL cover activation tracking, the `tabs.get` guard, startup seeding, replaced and removed tabs, demo epochs, report capping, serialized updates, worker restart, Bury save-before-close and intersection, close only on `graveyard:bury`, reopen URL validation, the 200-entry cap, and unknown messages.
5. THE content and popup tests SHALL cover seeded startup, reports, Resurrect commit-then-reset, apply-reset, demo restart with a single instance, `pagehide`/`pageshow`, failure paths, and popup rendering, Bury, Reopen, and rollback.
6. THE packaging tests SHALL cover both apps in the Skeleton_Sync, the wrapper's unchanged contract, the Graveyard_Validator's success and failure cases, and a failing `check:graveyard` on an extra permission without writing files.
7. `playwright.config.js` SHALL add a `graveyard-extension` project with `testDir` `app2-tab-graveyard/test/browser` on the bundled Chromium channel, and SHALL keep the existing two projects unchanged.
8. (BROWSER-VERIFIED) THE graveyard suite SHALL run `check:graveyard` without building, load only the committed `app2-tab-graveyard/` in a fresh persistent context, route fixture URLs to local HTML, block other network access, and close the context and profile on pass or failure.
9. (BROWSER-VERIFIED) THE suite SHALL verify the behaviour in Requirements 6.4, 6.5, 6.6, and 7.15, plus a trusted click on `Resurrect` clearing every Poltergeist artifact and restoring the fixture text exactly.
10. THE final check SHALL run `npm test`, `npm run build:skeletons` with no resulting Git diff, and `npm run test:browser`; every existing Doomscroll and skeleton test SHALL pass without modification, except that the built-in effect registry assertion in `skeleton/test/restoration.test.js` adds `tombstone` (the only permitted edit to an existing test).
