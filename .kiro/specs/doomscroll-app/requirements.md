# Requirements Document

## Introduction

Doomscroll App is the first Poltergeist application: a Chrome Manifest V3 extension rooted at `app1-doomscroll/` that progressively haunts supported social feeds during a visible browsing session. It packages the existing ES-module graph from `skeleton/` behind a classic content-script loader, applies declarative Fog, Flicker, Rot, and Block rules, and offers a small popup for per-tab pause and global demo mode.

Every requirement in this document is `NEW`; `app1-doomscroll/` is empty at the start of this spec. The root `skeleton/` remains the single authored source of truth. Implementation may change only `skeleton/effects/rot.js` within production skeleton code, plus its tests, to make Rot process text inserted after the effect reaches a stable intensity. `skeleton/engine.js` and every other production file under `skeleton/` remain unchanged.

The implementation uses deterministic build/check scripts to generate `app1-doomscroll/skeleton/` from the root `skeleton/`. The generated directory is committed to Git so a fresh clone is immediately loadable as an unpacked extension. A read-only byte-for-byte check runs in the normal `npm test` path. A Kiro PostFileSave hook refreshes the copy after Kiro saves production skeleton files, but the hook is only a convenience; the scripts and drift check remain authoritative.

Persisted behaviour meters, including Haunt Engine Requirement 12, are out of scope. The extension may persist the global demo preference and session-scoped per-tab pause flags; neither is a behaviour meter. Tab Graveyard, `demo-site/`, site-specific feed selectors, remote code, store publication, and extension signing are also out of scope.

Verification modes: criteria are statically or Vitest-verified unless prefixed `(BROWSER-VERIFIED)`. Browser-verified criteria run through Playwright in an unpacked Manifest V3 extension context against a local deterministic feed fixture. Playwright's supported extension runner is its bundled Chromium channel, which exercises the Chrome extension platform.

No implementation code is changed by this spec phase.

## Glossary

- **Approved_Host_Set**: Exactly `https://www.youtube.com/*`, `https://x.com/*`, and `https://www.instagram.com/*`.
- **Authored_App**: The version-controlled files directly under `app1-doomscroll/`, excluding the Generated_Skeleton.
- **Generated_Skeleton**: The committed `app1-doomscroll/skeleton/` copy produced from the root `skeleton/` by the Doomscroll_Build; it is generated but version-controlled so a fresh clone is loadable.
- **Doomscroll_Build**: The deterministic Node build command that refreshes the Generated_Skeleton and validates the package.
- **Doomscroll_Check**: The read-only command that fails when the Generated_Skeleton or package metadata has drifted.
- **Kiro_Build_Hook**: The committed PostFileSave hook under `.kiro/hooks/` that runs the Doomscroll_Build after Kiro saves a production skeleton file; it is convenience automation, not the drift guarantee.
- **Classic_Loader**: The non-module `content.js` file declared by `manifest.json`, which uses dynamic `import()` to load packaged ES modules.
- **Rule_Profile**: A validated rules document passed to `startPoltergeist` for one Engine instance.
- **Normal_Profile**: The unchanged rules parsed from `rules.json`.
- **Demo_Profile**: A deep clone of the Normal_Profile whose trigger times are divided by 60.
- **Normal_Snapshot**: The in-memory `timeOnSite` and `scrollDistance` captured when a normal Engine instance stops.
- **Demo_Snapshot**: The equivalent in-memory values for a demo Engine instance.
- **Runtime_Controller**: App-owned content-script logic that owns profile selection, snapshots, pause state, and at most one running Poltergeist instance per document.
- **Pause_State**: A Boolean associated with one Chrome tab for the current browser session.
- **Demo_Mode**: A global Boolean preference selecting the Demo_Profile on every supported, unpaused tab.
- **Rot_Observer**: The one `MutationObserver` owned by a live Rot handle.
- **Mutation_Root**: An added node/subtree from a `childList` record or the exact text node from a `characterData` record, provided it remains within the document body when processed.
- **Observer_Refresh**: One throttled Rot pass over the queued Mutation_Roots plus detached-entry pruning; it never walks the whole body.
- **External_Mutation**: Added, removed, or page-rewritten text that was not merely Rot writing the handle's already-computed output.
- **Package_Validator**: The build/check logic that validates JSON, rules, manifest scope, permissions, imports, and web-accessible-resource coverage.
- **Fixture_Feed**: Local deterministic HTML used by Playwright while the page retains a URL in the Approved_Host_Set.

## Requirements

### Requirement 1: Manifest V3 package and narrow host scope - NEW
**User Story:** As a user, I want Doomscroll App to run only on the named social sites with minimal privileges, so that installing it does not grant unrelated browsing access.

#### Acceptance Criteria

1. THE Authored_App SHALL contain `manifest.json`, `rules.json`, `content.js`, `background.js`, `popup.html`, `popup.js`, and `popup.css`.
2. THE manifest SHALL declare `manifest_version` equal to 3, an extension name and version, an action whose `default_popup` is `popup.html`, and a module service worker whose script is `background.js`.
3. THE manifest `host_permissions` SHALL equal the Approved_Host_Set with no wildcard scheme, wildcard host, subdomain wildcard, legacy Twitter host, mobile host, localhost origin, or `<all_urls>` entry.
4. THE manifest SHALL statically register only `content.js` as a content script, with `matches` equal to the Approved_Host_Set, `run_at` equal to `document_idle`, `all_frames` equal to false, and the default isolated execution world.
5. THE manifest `permissions` SHALL contain only `storage`; it SHALL NOT request `tabs`, `activeTab`, `scripting`, `unlimitedStorage`, or any unrelated permission.
6. THE manifest SHALL expose `rules.json` and every JavaScript module reachable through a relative static import from `skeleton/index.js` as web-accessible resources, and the corresponding `matches` SHALL equal the Approved_Host_Set.
7. THE manifest SHALL set `use_dynamic_url` to true for the web-accessible-resource group and SHALL NOT expose popup, service-worker, test, fixture, or build-script files.
8. THE extension SHALL package all executable code locally and SHALL NOT use remote scripts, remote module imports, `eval`, `new Function`, string-valued timer callbacks, or inline JavaScript in extension HTML.
9. THE Package_Validator SHALL require the host-permission set, content-script match set, web-accessible-resource match set, and every rule match set to equal the Approved_Host_Set without broader or missing entries.
10. WHEN a top-level document has a URL outside the Approved_Host_Set, THE Classic_Loader SHALL not be injected by the manifest.
11. THE extension integration SHALL operate on the whole document through the skeleton effects and SHALL NOT query for or depend on site-specific feed, post, timeline, or navigation selectors.

### Requirement 2: Progressive normal and demo rule profiles - NEW
**User Story:** As a student who loses time to social feeds, I want the page to become gradually less comfortable before it blocks interaction, so that I receive escalating feedback rather than an immediate lockout.

#### Acceptance Criteria

1. THE `rules.json` document SHALL satisfy `skeleton/rule-schema.json` and SHALL pass `validateRules` with `builtinEffects` without errors.
2. THE Normal_Profile SHALL contain exactly four enabled rules in this order: `doomscroll-fog`, `doomscroll-flicker`, `doomscroll-rot`, and `doomscroll-block`.
3. EACH Normal_Profile rule SHALL match exactly the Approved_Host_Set and SHALL use the `timeOnSite` meter, so progression counts visible matched browsing time and has one deterministic ordering across all supported sites.
4. THE `doomscroll-fog` rule SHALL start at 120 seconds, ramp to full intensity at 300 seconds, use effect type `fog` with `maxBlur` 5 and `maxGrayscale` 0.8, and use fade undo with a duration of 400 milliseconds.
5. THE `doomscroll-flicker` rule SHALL start at 300 seconds, ramp to full intensity at 600 seconds, use effect type `flicker` with `maxDepth` 0.22 and `periodMs` 1600, and use instant undo.
6. WHEN the Flicker_Effect is applied or re-created while the user's `prefers-reduced-motion` preference is active, THE Flicker_Effect SHALL use the skeleton's static reduced-motion rendering and SHALL NOT animate.
7. THE `doomscroll-rot` rule SHALL start at 600 seconds, ramp to full intensity at 900 seconds, use effect type `rot` with `maxFraction` 0.55 and nonempty glyph string `░▒·_ `, and use instant undo.
8. THE `doomscroll-block` rule SHALL start at 1200 seconds, ramp to full intensity at 1500 seconds, use effect type `block` with `maxOpacity` 0.96, `blockAt` 0.8, and the exact message `You have scrolled long enough. Close this tab and take a break.`, and use fade undo with a duration of 600 milliseconds.
9. BEFORE 120 seconds of Normal_Profile matched visible time, THE extension SHALL apply none of the four effects.
10. THE Normal_Profile trigger configuration SHALL place every next stage at or after the preceding stage's `rampTo`; the Rot `rampTo` SHALL precede the Block threshold, and Block SHALL not intercept pointer input until its own applied intensity reaches `blockAt`.
11. WHEN Demo_Mode changes from off to on, THE Runtime_Controller SHALL create the Demo_Profile by deep-cloning the unchanged Normal_Profile and dividing every trigger `threshold` and `rampTo` by exactly 60.
12. THE resulting Demo_Profile stages SHALL be Fog from 2 to 5 seconds, Flicker from 5 to 10 seconds, Rot from 10 to 15 seconds, and Block from 20 to 25 seconds, with pointer blocking beginning at 24 seconds.
13. THE Runtime_Controller SHALL validate the Demo_Profile before starting it and SHALL treat validation failure as a startup failure that leaves the page clean.
14. CREATING or running the Demo_Profile SHALL NOT mutate the parsed Normal_Profile or `rules.json` data.
15. WHEN Demo_Mode changes from off to on, THE first Demo_Profile run in that document SHALL start with zero `timeOnSite` and zero `scrollDistance`, so a recording shows the complete shortened escalation.
16. THE production rule thresholds SHALL NOT be shortened merely because the extension is unpacked, under Playwright, or on a fixture; only Demo_Mode selects shortened thresholds.

### Requirement 3: Classic loader and reversible runtime lifecycle - NEW
**User Story:** As an extension developer, I want a small Manifest V3-compatible bootstrap around the shared skeleton, so that the app uses the single engine source without duplicating it or leaving page damage after ordinary state changes.

#### Acceptance Criteria

1. THE Classic_Loader SHALL be a classic content script with no static `import` or `export` declaration and SHALL start its asynchronous work from a contained async function.
2. WHEN the Classic_Loader initializes on an approved page, THE Classic_Loader SHALL resolve `skeleton/index.js` with `chrome.runtime.getURL`, load it with dynamic `import()`, resolve `rules.json` with `chrome.runtime.getURL`, fetch and parse the rules, and pass the parsed document to `startPoltergeist`.
3. AFTER asynchronous package loading and validation complete for the current desired state, THE Classic_Loader SHALL call the current synchronous `startPoltergeist` API and retain its returned `{ engine, meters, stop }` object without changing the skeleton Entry_Point contract.
4. THE Runtime_Controller SHALL own no more than one live Poltergeist instance in one document at any time.
5. BEFORE switching profile or entering Pause_State, THE Runtime_Controller SHALL capture the active profile's meter snapshot and call that instance's synchronous `stop`, causing every active effect and Rot_Observer to undo.
6. WHEN a normal instance stops for an in-document pause or profile switch, THE Runtime_Controller SHALL retain only its `timeOnSite` and `scrollDistance` in the Normal_Snapshot and SHALL use those values as `initialMeters` when normal mode resumes.
7. WHEN a demo instance stops for an in-document pause, THE Runtime_Controller SHALL retain only its corresponding values in the Demo_Snapshot and SHALL use them when that same enabled demo session resumes.
8. WHEN Demo_Mode changes from on to off, THE Runtime_Controller SHALL discard the Demo_Snapshot and resume the Normal_Profile from the Normal_Snapshot without adding demo meter values to normal progress.
9. ON every actual Demo_Mode transition, including a transition while paused, THE Runtime_Controller SHALL reset the Demo_Snapshot to zeros, so an off-to-on transition always starts a new demo sequence and an on-to-off transition retains no demo progress.
10. THE Runtime_Controller SHALL serialize state reconciliations and use a generation token around asynchronous import/fetch work, so rapid pause and demo changes cannot leave two Engines or two Rot_Observers active.
11. IF desired state changes while package loading is pending, THEN THE Runtime_Controller SHALL check the generation before calling the synchronous Entry_Point and SHALL skip the obsolete start rather than creating an instance for stale state.
12. IF an owned instance's `stop` throws, THEN THE Runtime_Controller SHALL retain that instance reference, enter a faulted state, report one namespaced diagnostic, and SHALL NOT start a replacement that could overlap it.
13. IF import, fetch, JSON parsing, or app-level rule validation fails before `startPoltergeist` is called, THEN THE Runtime_Controller SHALL report one namespaced diagnostic and leave the page without an app-started Poltergeist instance.
14. IF the synchronous `startPoltergeist` call throws before returning an instance, THEN THE Runtime_Controller SHALL report the failure, enter a faulted state, and SHALL NOT attempt an automatic second start; the app SHALL NOT claim cleanup ownership for an instance the API did not return.
15. WHEN `pagehide` occurs after the Entry_Point returned an instance, THE existing skeleton lifecycle SHALL stop that instance and undo its active effects; app-owned callbacks SHALL perform no later reconciliation for that document.
16. WHEN the reduced-motion media query changes while an instance is active, THE Runtime_Controller SHALL capture its profile snapshot, stop it, and recreate the same profile so Flicker reads the current preference; while paused, it SHALL defer creation until resume.
17. THE app SHALL NOT add behaviour-meter storage, a Storage_Adapter, cross-tab meter accumulation, daily reset, or changes to the skeleton Entry_Point as part of this feature.

### Requirement 4: Rot continuity on infinite feeds - NEW
**User Story:** As a user viewing an infinite feed, I want newly loaded text to decay at the current Rot intensity, so that loading more posts cannot escape a fully developed haunt.

#### Acceptance Criteria

1. WHEN `Rot_Effect.apply` is called explicitly, THE Rot_Effect SHALL update the Handle's latest clamped fraction and glyph sequence and SHALL perform its existing full-body text pass, including detached-entry pruning, before returning.
2. WHEN `Rot_Effect.apply` creates a live Handle, THE Rot_Effect SHALL create at most one Rot_Observer owned by that Handle when `MutationObserver` and `documentElement` are available.
3. THE Rot_Observer SHALL observe `documentElement` with `subtree: true`, `childList: true`, and `characterData: true`, so it covers inserted bodies, appended feed items, and recycled text nodes without a site-specific selector.
4. WHEN a Rot_Observer delivery contains `childList` records, THE Rot_Effect SHALL queue only their added nodes as Mutation_Roots and SHALL note removals for detached-entry pruning; it SHALL NOT queue an ancestor merely because a descendant changed.
5. WHEN a Rot_Observer delivery contains an externally changed `characterData` record, THE Rot_Effect SHALL queue only that record's text node as a Mutation_Root.
6. WHEN the first relevant mutation arrives with no Observer_Refresh scheduled, THE Rot_Effect SHALL schedule one Observer_Refresh for 250 milliseconds later; further relevant deliveries before that timer fires SHALL merge their Mutation_Roots and prune request into the same pending batch without scheduling another refresh.
7. THE Rot_Effect SHALL execute at most one Observer_Refresh in each 250 millisecond observer-throttle window, including during continuous mutation traffic.
8. WHEN an Observer_Refresh executes, THE Rot_Effect SHALL prune detached tracked nodes and process only the queued Mutation_Roots that remain within `document.body`: an added text node directly, descendants of an added subtree, and an externally changed text node directly. THE Observer_Refresh SHALL NOT select `document.body` as a fallback traversal root or visit eligible text outside those roots; it MAY traverse the body only when the body itself is a queued added Mutation_Root.
9. WHEN queued Mutation_Roots overlap, THE Rot_Effect SHALL de-duplicate identical roots and MAY drop a descendant root already covered by a queued ancestor, without processing any text outside the resulting roots.
10. EVERY Observer_Refresh SHALL use the latest fraction and glyph sequence stored by the most recent explicit `apply`.
11. WHILE a Rot rule remains active and the Engine no longer calls `apply` because computed intensity differs from the Handle's last applied intensity by less than 0.01, including on the post-`rampTo` plateau, WHEN a nonempty eligible text node is added beneath the document body, THE next Observer_Refresh SHALL process that text at the Handle's current fraction.
12. WHEN the page rewrites a connected tracked text node, THE next Observer_Refresh SHALL adopt the rewritten value as that node's new original text and SHALL process it at the current fraction.
13. THE Rot_Effect SHALL preserve its existing skip behavior for `SCRIPT`, `STYLE`, `NOSCRIPT`, `TEXTAREA`, `INPUT`, `CODE`, content-editable parents, and whitespace-only text, for both explicit and observer-driven passes.
14. THE Rot_Effect SHALL preserve deterministic character selection, monotonic decay as intensity grows, page-rewrite conflict handling, detached-node pruning, and the public exports `{ apply, undo, description }`.
15. WHEN `apply` is called repeatedly with the same live Handle, THE Rot_Effect SHALL reuse the same Rot_Observer rather than registering another observer.
16. WHEN Rot's own writes produce `characterData` records whose nodes already equal their tracked outputs, THE Rot_Observer SHALL ignore those records, so they neither schedule an Observer_Refresh nor create an unbounded callback loop.
17. WHEN an explicit full-body `apply` occurs while observer work is pending, THE Rot_Effect SHALL cancel the pending observer timer and clear its queued roots after the explicit pass has superseded that work.
18. WHEN `undo` is called on a Rot Handle, THE Rot_Effect SHALL disconnect the Rot_Observer and cancel the pending observer timer before restoring text, SHALL conditionally restore every retained node still equal to Rot's output, and SHALL clear its node map and pending roots.
19. AFTER `undo` completes, queued observer work SHALL be a no-op and subsequently added or rewritten text SHALL remain unchanged by that Handle.
20. IF `MutationObserver` or `documentElement` is unavailable, THEN explicit `apply` SHALL retain its full-body behavior, return a usable Handle, and allow `undo` without throwing.
21. THE implementation of this requirement SHALL modify no production skeleton file except `skeleton/effects/rot.js`; in particular, it SHALL NOT change `skeleton/engine.js`, its 0.01 intensity update threshold, or its Tick frequency.

### Requirement 5: Popup pause and demo controls - NEW
**User Story:** As a user, I want to pause haunting in the current tab and enable a short demo globally, so that I can regain control or record the effect without changing production timing.

#### Acceptance Criteria

1. THE popup SHALL present a status region, one control labelled `Pause on this tab`, and one control labelled `Demo mode on supported tabs` in a minimal keyboard-accessible interface.
2. THE popup SHALL load behavior only from external `popup.js` and `popup.css` files and SHALL use native buttons or labelled form controls with visible focus and disabled states.
3. WHEN the popup opens, THE popup SHALL query the active tab, obtain its Pause_State through the service worker, ping its content script, and display whether the current tab is supported, paused, and using normal or demo mode.
4. WHEN no content script responds in the active tab, THE popup SHALL display an unavailable state and disable only the per-tab pause control; the global demo control SHALL remain usable.
5. THE service worker SHALL store each Pause_State in `chrome.storage.session` under its own namespaced key ending in the numeric tab id, and SHALL remove that key when `tabs.onRemoved` fires.
6. THE service worker SHALL derive a content script's tab id from `sender.tab.id` and SHALL NOT trust a content-originated tab id supplied in message data.
7. WHEN the popup changes Pause_State, THE service worker SHALL update that tab's session key before sending the desired state to its content script; if delivery then finds no receiver, the result SHALL distinguish `delivered: false` from a failed storage commit and SHALL NOT affect any other tab.
8. WHEN a supported content script starts or reloads, THE content script SHALL request its Pause_State from the service worker before starting an Engine.
9. WHILE Pause_State is true, THE Runtime_Controller SHALL keep no Engine or Rot_Observer active and SHALL leave the page restored; Pause_State SHALL take precedence over Demo_Mode.
10. WHEN Pause_State changes from true to false, THE Runtime_Controller SHALL start the currently selected profile from that profile's in-memory snapshot.
11. THE extension SHALL store Demo_Mode as one namespaced Boolean in `chrome.storage.local`, defaulting to false when absent or malformed.
12. WHEN Demo_Mode changes, EVERY loaded supported content script SHALL reconcile through `chrome.storage.onChanged`, and a subsequently loaded supported content script SHALL read the latest value before starting.
13. WHEN Demo_Mode changes while a tab is paused, THE Runtime_Controller SHALL record the desired profile but SHALL NOT start it until the tab resumes.
14. THE popup and service worker SHALL use a namespaced, explicitly enumerated message protocol, SHALL reject unknown message types without state changes, and SHALL return structured success or error results.
15. IF a storage commit fails, THEN THE popup SHALL roll back to the last confirmed state and show a concise error; IF storage commits but tab delivery fails, THEN THE popup SHALL display the committed Pause_State with an unavailable notice rather than rolling it back, and no content script SHALL start a second Engine as recovery.
16. THE stored Pause_State and Demo_Mode SHALL contain no browsing history, URL, page text, time meter, scroll meter, or other behaviour-meter data.
17. DURING content-script startup, THE content script SHALL register pause and demo listeners before requesting initial state, track a revision for each field, and SHALL NOT let an older initial response overwrite a newer pause message or storage-change event; it SHALL start no Engine until both fields have a confirmed value.

### Requirement 6: Generated skeleton synchronization and package checks - NEW
**User Story:** As a maintainer, I want the unpacked app to contain a verified generated copy of the shared skeleton, so that Chrome can load it without creating a second authored engine.

#### Acceptance Criteria

1. THE repository SHALL provide `npm run build:doomscroll` backed by a Node script that copies the root `skeleton/` production tree into the Generated_Skeleton.
2. THE Doomscroll_Build SHALL copy every root skeleton file except `skeleton/test/**`, preserve relative paths and file bytes, and remove stale files from the Generated_Skeleton that are absent under the source copy policy.
3. THE Doomscroll_Build SHALL produce the same Generated_Skeleton bytes and relative file set when run twice against unchanged inputs and SHALL write no timestamps, absolute machine paths, or generated source edits.
4. THE Generated_Skeleton SHALL be committed to Git and SHALL NOT be ignored, so a fresh clone contains a loadable unpacked extension without first running the Doomscroll_Build; it SHALL carry no manually maintained app-specific patch, and all production changes, including the Rot fix, SHALL be made first in the root `skeleton/`.
5. THE repository SHALL provide `npm run check:doomscroll` as a read-only Doomscroll_Check that compares the source and generated relative file sets and bytes and fails on every missing, extra, or changed generated file; the normal `npm test` script SHALL run this check before Vitest, and drift SHALL make `npm test` exit nonzero without repairing the copy.
6. THE Package_Validator SHALL parse `manifest.json` and `rules.json`, require Manifest V3 and the exact permission and match sets from Requirement 1, and run the root Rule_Validator against the Normal_Profile.
7. THE Package_Validator SHALL resolve the relative static JavaScript import graph rooted at generated `skeleton/index.js`, fail if an import escapes the extension root or resolves to a missing file, and require every reachable module plus `rules.json` to be covered by `web_accessible_resources`.
8. THE Package_Validator SHALL fail if a test file is copied into the Generated_Skeleton, if a web-accessible resource is broader than the approved runtime graph, if packaged executable code refers to a remote URL, or if app-owned JavaScript/HTML contains `eval`, `new Function`, string-valued timer code, an inline script body, or an inline event-handler attribute.
9. THE Playwright extension fixture SHALL run the Doomscroll_Check without first running the Doomscroll_Build before loading the committed `app1-doomscroll/` as an unpacked extension, so browser verification proves that a fresh checkout is complete rather than silently repairing drift.
10. THE Doomscroll_Build and Doomscroll_Check SHALL remain the source of truth for synchronization, and THE repository SHALL contain a committed Kiro_Build_Hook under `.kiro/hooks/` that runs `npm run build:doomscroll` when Kiro emits `PostFileSave` for a production file directly under the root `skeleton/` or under the root `skeleton/effects/`, thereby excluding both `skeleton/test/**` and the Generated_Skeleton; THE hook SHALL be documented as convenience automation whose absence or failure cannot make a stale Generated_Skeleton pass `npm test`.

### Requirement 7: Automated app and browser verification - NEW
**User Story:** As a maintainer, I want automated evidence that the packaged extension escalates and restores correctly on a changing feed, so that packaging or infinite-scroll regressions are caught before release.

#### Acceptance Criteria

1. THE normal `npm test` command SHALL run the read-only Doomscroll_Check first and, only if it passes, SHALL run the existing skeleton suites plus Doomscroll app unit and package tests through Vitest without treating Playwright `.pw.js` files as Vitest tests.
2. THE Rot unit suite SHALL verify appended eligible text at stable intensity 1, page-rewritten tracked text, use of updated intensity and glyph params, observer reuse, root-only traversal, no visit to unchanged text elsewhere in the body, one Observer_Refresh per 250 millisecond window, mutation batching, self-mutation loop termination, detached-node pruning, explicit full-body supersession, conditional restoration, observer/timer cancellation, and no changes after undo.
3. THE app unit tests SHALL verify Normal_Profile validation, exact thresholds and params, Demo_Profile scaling and immutability, Runtime_Controller single-instance transitions, Pause_State precedence, normal/demo snapshot separation, service-worker storage semantics, popup unavailable behavior, and package-scope checks.
4. THE Playwright configuration SHALL preserve the existing skeleton browser suite and SHALL discover the Doomscroll browser suite under `app1-doomscroll/test/browser/`.
5. (BROWSER-VERIFIED) THE Doomscroll suite SHALL launch the committed unpacked extension in a fresh Playwright persistent Chromium context using only that extension's directory and SHALL obtain its extension id from the Manifest V3 service worker.
6. (BROWSER-VERIFIED) THE suite SHALL fulfill an Approved_Host_Set URL from the local Fixture_Feed without external network access, so the production manifest and rules are exercised without adding a localhost permission.
7. (BROWSER-VERIFIED) AFTER the fixture page starts in normal mode and is kept as the foreground tab, WHEN the test enables Demo_Mode through the production service-worker protocol from an extension-origin page, THEN the suite SHALL observe Fog before Flicker, Flicker before Rot, and Rot before the Block message, and SHALL verify that no later-stage artifact appears at an earlier stage checkpoint.
8. (BROWSER-VERIFIED) AFTER Demo_Profile elapsed time has passed the Rot `rampTo` and the Rot Handle is on a stable Engine-update plateau, WHEN a new fixture post with eligible text is appended, THEN the new text SHALL differ from its original after observer delivery without an explicit Rot call.
9. (BROWSER-VERIFIED) WHEN the test sends `doomscroll:set-paused` for the foreground fixture tab through the production service-worker protocol, THEN all overlays SHALL be removed, every retained rotted fixture string SHALL equal its original text, and text appended afterward SHALL remain unchanged.
10. (BROWSER-VERIFIED) WHEN the same protocol resumes the tab while Demo_Mode remains enabled, THEN the Demo_Profile SHALL resume with one Engine and newly added eligible text SHALL become subject to Rot again.
11. (BROWSER-VERIFIED) WHEN another page uses a URL outside the Approved_Host_Set, THEN no Doomscroll content-script response or Poltergeist artifact SHALL appear there.
12. THE browser suite SHALL use deterministic fixture text long enough to make a 0.55 maximum rot fraction observable, SHALL poll for semantic DOM states instead of relying on screenshots, and SHALL close its persistent context and temporary profile on success or failure.
13. THE final verification SHALL first run `npm test` against the committed Generated_Skeleton, then run `npm run build:doomscroll` and prove that the build creates no tracked content diff, then run `npm run check:doomscroll` and `npm run test:browser`; all commands SHALL exit successfully with no unhandled page, service-worker, or extension errors attributable to Doomscroll App.
14. THE implementation SHALL be considered incomplete if only direct skeleton modules are tested; the browser evidence SHALL come from the actual manifest, Classic_Loader, Generated_Skeleton, rules fetch, service worker, and popup/control protocol packaged in `app1-doomscroll/`.
