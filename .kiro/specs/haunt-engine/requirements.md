# Requirements Document

## Introduction

The Haunt Engine is the framework in `skeleton/` that evaluates declarative rules against the user's behaviour on a page and applies reversible visual "haunting" effects. It is composed of a Rule_Validator, a URL_Matcher, a Meter_Set, an Engine, an Effect_Registry with four built-in effects (fog, flicker, rot, block), and a `startPoltergeist` entry point.

This document has two parts:

- **Part A (Requirements 1 to 8) documents EXISTING, already-implemented behaviour.** Each requirement is tagged `EXISTING` in its heading and is derived from the code in `skeleton/` and its tests. The tasks phase marks tasks for these requirements as complete (`[x]`).
- **Part B (Requirements 9 to 14) specifies NEW work for six known issues.** Each requirement is tagged `NEW` in its heading and is not yet implemented. The tasks phase leaves tasks for these requirements unchecked (`[ ]`).

Requirement 10 supersedes the `documentElement` filter, opacity and animation mechanism that Requirement 6 criteria 1 to 7 describe for the Fog_Effect and Flicker_Effect, and the `body` placement of the Block_Overlay in Requirement 6 criterion 13. Those Requirement 6 criteria remain EXISTING and describe the current implementation until Requirement 10 is implemented.

Requirement 12 supersedes the synchronous behaviour that Requirement 8 criteria 2 and 3 and Requirement 7 criteria 7 and 8 describe for the Entry_Point: once Requirement 12 is implemented, `startPoltergeist` returns a Promise, invalid rules cause that Promise to reject instead of a synchronous throw, `stop` returns a Promise, and `pagehide` issues a best-effort final write. Those criteria remain EXISTING and describe the current synchronous implementation until then. Requirement 8 criterion 1 and Requirement 11 criterion 6 (validation, with the supplied `effects` registry, before anything is created) continue to hold.

Verification modes: a criterion is either jsdom-verified (structural: DOM shape, attributes, inline styles, timers, verified by jsdom tests) or browser-verified (marked BROWSER-VERIFIED: needs real layout and computed styles, verified in real Chrome with a Playwright test or Playwright MCP, because jsdom performs neither). Criteria are jsdom-verified unless marked otherwise.

Ordering note: the tasks for Requirements 9, 10, 11 and 13 MUST be ordered before the tasks for Requirement 12, because the first app (`app1-doomscroll`) depends on them. The tasks phase MUST reflect this ordering.

No code is changed by this spec phase.

## Glossary

- **Engine**: The component created by `createEngine` that evaluates rules on each tick and applies or undoes effects.
- **Rule**: A JSON object with `id`, `match`, `trigger`, `effect`, `undo`, and optional `description` and `enabled`.
- **Rule_Validator**: The component in `validator.js` that checks rules and rule files (`validateRule`, `validateRules`).
- **Rule_Schema**: The JSON Schema file `rule-schema.json` that the Rule_Validator mirrors.
- **URL_Matcher**: The component in `match.js` (`compilePattern`, `isValidPattern`, `matchUrl`) that evaluates Chrome match patterns.
- **Meter_Set**: The component created by `createMeters` that tracks `timeOnSite`, `scrollDistance`, and `timeSinceActive`.
- **timeOnSite**: Seconds spent visible on a matched URL.
- **scrollDistance**: Cumulative absolute pixels scrolled.
- **timeSinceActive**: Seconds since the tab was last visible; 0 while visible.
- **Trigger**: The rule's `meter`, `threshold`, and optional `rampTo`.
- **Intensity**: A number from 0 to 1 computed from a meter value and a Trigger.
- **Effect**: A module exporting `description`, `apply(env, params, intensity, handle?)`, and `undo(handle, { durationMs }?)`.
- **Effect_Registry**: An object mapping effect type names to Effects. `builtinEffects` holds fog, flicker, rot, and block.
- **Handle**: The object returned by an Effect's `apply`, used for later updates and undo.
- **Env**: The object passed to Effects: `window`, `document`, `reducedMotion`, `setTimeout`, `clearTimeout` (plus `setInterval` and `clearInterval` from `startPoltergeist`).
- **Tick**: One evaluation pass of the Engine.
- **Fade**: An undo that transitions the visual effect over `durationMs` milliseconds before restoring the page.
- **Fog_Effect**, **Flicker_Effect**, **Rot_Effect**, **Block_Effect**: The four built-in Effects.
- **Block_Overlay**: The `div[data-poltergeist="block"]` element created by the Block_Effect.
- **Fog_Overlay**: The fixed, non-interactive `div[data-poltergeist="fog"]` element, a child of `documentElement`, created by the Fog_Effect after Requirement 10; it applies `backdrop-filter` blur and grayscale.
- **Flicker_Overlay**: The fixed, non-interactive `div[data-poltergeist="flicker"]` element, a child of `documentElement`, created by the Flicker_Effect after Requirement 10; it is a black layer with animated opacity.
- **Entry_Point**: The `startPoltergeist` function in `index.js`. It is synchronous today (Requirement 8) and becomes asynchronous, returning a Promise, once Requirement 12 is built.
- **Meter_Store**: The new component that persists per-site meter values through an injected Storage_Adapter, writing deltas since its baseline.
- **Storage_Adapter**: An injected object with async `get(key)` (resolves to the stored value or `undefined`) and async `set(key, value)` (resolves once written). The host supplies it: an adapter over `chrome.storage.local` in extensions, over `localStorage` in the demo site.
- **Baseline**: The `timeOnSite` and `scrollDistance` values at the Meter_Store's last successful write, used to compute the delta for the next write.
- **Scroll_Container**: Any scrollable element in the document, including elements inside the page body, other than the window itself.
- **Detached_Node**: A text node no longer contained in the document.

## Requirements

### Requirement 1: Rule validation - EXISTING
**User Story:** As a rule author, I want rules checked before they run, so that malformed rules are reported with clear messages instead of failing silently.

#### Acceptance Criteria

1. WHEN a rule object is passed to the Rule_Validator, THE Rule_Validator SHALL return an empty error list if the rule satisfies the Rule_Schema.
2. WHEN a rules document is an array or an object with a `rules` array, THE Rule_Validator SHALL validate each rule in the list and report errors for every invalid rule rather than stopping at the first.
3. IF a rules document is neither an array nor an object with a `rules` array, THEN THE Rule_Validator SHALL return `valid: false`, an empty rule list, and the error "rules file: must be an array or an object with a \"rules\" array".
4. IF a rule is not an object (including null, an array, or a primitive), THEN THE Rule_Validator SHALL return the error "must be an object" for that rule and skip validation of its remaining fields.
5. IF a rule or any of its `trigger`, `effect`, `undo` or file-level objects contains a property outside the allowed set, THEN THE Rule_Validator SHALL report one "unknown property" error per unknown property, each naming that property.
6. IF a rule `id` is missing, is not a string, or does not match `^[a-z0-9][a-z0-9_-]*$`, THEN THE Rule_Validator SHALL report an error for `id`.
7. IF `match` is missing, is not an array, is an empty array, or contains a string that is not a valid match pattern, THEN THE Rule_Validator SHALL report an error for `match`, and for each invalid entry the error SHALL name the zero-based index of that entry.
8. IF `trigger.meter` is missing or is not one of `timeOnSite`, `scrollDistance`, `timeSinceActive`, THEN THE Rule_Validator SHALL report an error for `trigger.meter`.
9. IF `trigger.threshold` is missing or is not a finite number greater than or equal to 0, THEN THE Rule_Validator SHALL report an error for `trigger.threshold`.
10. IF `trigger.rampTo` is present and is not a finite number, or is not greater than 0, or is not greater than `trigger.threshold`, THEN THE Rule_Validator SHALL report an error for `trigger.rampTo`.
11. IF `effect.type` is missing or is not one of `fog`, `flicker`, `rot`, `block`, THEN THE Rule_Validator SHALL report an error for `effect.type`.
12. IF `effect.params` is present and is not a plain object (including null or an array), THEN THE Rule_Validator SHALL report an error for `effect.params`.
13. IF `undo.mode` is not `instant` or `fade`, or `undo.durationMs` is present and is not an integer from 0 to 10000 inclusive, THEN THE Rule_Validator SHALL report an error naming the offending field.
14. IF `description` is present and not a string, or `enabled` is present and not a boolean, THEN THE Rule_Validator SHALL report an error naming the offending field.
15. IF two or more rules in one document share an `id`, THEN THE Rule_Validator SHALL report a "duplicate id" error naming the shared `id` for each rule after the first occurrence.
16. WHEN validation of a rules document completes, THE Rule_Validator SHALL return `valid: true` with the full rule list if the error list is empty, and `valid: false` with an empty rule list otherwise.
17. THE Rule_Validator SHALL keep the enums for meters, effect types and undo modes equal to those in the Rule_Schema, as verified by an automated test that fails if any enum value differs or is missing.

### Requirement 2: URL matching - EXISTING
**User Story:** As a rule author, I want rules to apply only to chosen sites, so that hauntings are scoped to the sites I name.

#### Acceptance Criteria

1. WHEN a pattern is exactly `<all_urls>`, THE URL_Matcher SHALL match URLs whose scheme is http, https, file or ftp, regardless of host, path or search string, and SHALL NOT match URLs with any other scheme.
2. WHEN a pattern has the form `scheme://host/path`, THE URL_Matcher SHALL accept the schemes `*`, `http`, `https`, `file` and `ftp`, and SHALL match a URL only if the scheme, host and path components all match.
3. WHEN a pattern scheme is `*`, THE URL_Matcher SHALL match only http and https URLs.
4. WHEN a pattern host is `*.example.com`, THE URL_Matcher SHALL match `example.com` and any of its subdomains, and SHALL NOT match `notexample.com`.
5. WHEN a pattern host is `*`, THE URL_Matcher SHALL match any host, including an empty host.
6. WHEN a pattern path contains `*`, THE URL_Matcher SHALL treat each `*` as matching any sequence of zero or more characters, compared against the URL pathname concatenated with its search string and excluding the fragment. The comparison SHALL be case-sensitive and SHALL cover the entire string.
7. THE URL_Matcher SHALL compare hosts case-insensitively.
8. IF a pattern is not a string, lacks a path beginning with `/`, uses a scheme outside the supported list, or has a host that is empty or contains `*` anywhere other than as the whole host or a leading `*.`, THEN THE URL_Matcher SHALL treat the pattern as invalid, SHALL never match it, and SHALL continue evaluating any remaining patterns without throwing an error.
9. IF the URL cannot be parsed, THEN THE URL_Matcher SHALL return false without throwing an error.
10. WHEN the same pattern string is evaluated more than once, THE URL_Matcher SHALL reuse its previously compiled form, so that the validity result and match results are identical on every evaluation.
11. WHEN a list of patterns is evaluated against a URL, THE URL_Matcher SHALL return true if at least one valid pattern matches, and SHALL return false if the list is empty or no valid pattern matches.

### Requirement 3: Behaviour meters - EXISTING
**User Story:** As a rule author, I want meters that measure how the user behaves on a page, so that rules can trigger on time, scrolling, and absence.

#### Acceptance Criteria

1. WHEN `update(true)` is called while the document visibility state is not `hidden`, THE Meter_Set SHALL add the elapsed seconds (milliseconds from the clock divided by 1000, fractional values retained) since the previous `update` call, or since creation if there was no previous call, to `timeOnSite`.
2. WHEN `update(false)` is called, THE Meter_Set SHALL leave `timeOnSite` unchanged and SHALL still advance the previous-update reference time to the current clock value.
3. WHILE the document visibility state is `hidden`, THE Meter_Set SHALL leave `timeOnSite` unchanged when `update` is called, regardless of the argument passed.
4. WHEN a window `scroll` event fires, THE Meter_Set SHALL add the absolute difference in pixels between the current and previous `window.scrollY` to `scrollDistance`, counting upward and downward scrolls equally, and SHALL treat an undefined `window.scrollY` as 0.
5. WHILE the document visibility state is not `hidden`, THE Meter_Set SHALL report `timeSinceActive` as 0.
6. WHILE the document visibility state is `hidden`, THE Meter_Set SHALL report `timeSinceActive` as the seconds between the last time the document was active (last visible `update` call or visibility change to visible) and the most recent `update` call, with a minimum value of 0.
7. WHEN the document visibility state changes to a value other than `hidden`, THE Meter_Set SHALL record the current clock value as the last active time.
8. WHERE `initial` values are supplied, THE Meter_Set SHALL seed `timeOnSite` (seconds) and `scrollDistance` (pixels) from them, defaulting each omitted value to 0.
9. WHERE a `now` clock function returning milliseconds is supplied, THE Meter_Set SHALL use it in place of `performance.now` for all time measurements.
10. WHEN `dispose` is called, THE Meter_Set SHALL remove its scroll and visibilitychange listeners, and scroll events or visibility changes occurring afterward SHALL NOT change any meter value.
11. IF the clock value at an `update` call is lower than at the previous `update` call, THEN THE Meter_Set SHALL treat the elapsed time as 0 seconds and leave `timeOnSite` unchanged.

### Requirement 4: Engine evaluation and intensity ramping - EXISTING
**User Story:** As a rule author, I want effects to grow gradually as the user's behaviour crosses a threshold, so that the haunt escalates smoothly.

#### Acceptance Criteria

1. IF a Trigger has no `rampTo`, or its `rampTo` is less than or equal to `threshold`, THEN THE Engine SHALL compute an Intensity of 1.
2. IF a Trigger has a `rampTo` greater than `threshold`, THEN THE Engine SHALL compute Intensity as `(value - threshold) / (rampTo - threshold)`, clamped to the range 0.01 to 1 inclusive (values below 0.01 yield 0.01, values above 1 yield 1).
3. WHEN a Tick runs, THE Engine SHALL read the current URL through `getUrl` exactly once, so that single-page-app navigation is honoured.
4. WHEN a Tick runs, THE Engine SHALL call `meters.update` exactly once with true if at least one enabled rule matches the URL, and false otherwise.
5. WHEN a Tick runs and a rule is enabled, matches the URL, has a meter value greater than or equal to its `threshold`, and has no active state, THE Engine SHALL call the Effect's `apply` once with the rule params (or an empty object if none) and the computed Intensity, and SHALL include the rule id in the `applied` array.
6. WHILE a rule is active, WHEN a Tick computes an Intensity differing from the last applied Intensity by 0.01 or more, THE Engine SHALL call `apply` once with the existing Handle, record the new Intensity as the last applied Intensity, and include the rule id in the `updated` array.
7. WHILE a rule is active, WHEN a Tick computes an Intensity differing from the last applied Intensity by less than 0.01, THE Engine SHALL not call `apply` and SHALL not include the rule id in `updated`.
8. WHILE a rule has `enabled: false`, THE Engine SHALL not evaluate it, SHALL not call `apply` for it, and SHALL not include it in `applied` or `updated`.
9. IF a rule references an effect type absent from the Effect_Registry, THEN THE Engine SHALL skip that rule without throwing, without calling `onError`, and SHALL continue evaluating the remaining rules.
10. IF an Effect's `apply` or `undo` throws, THEN THE Engine SHALL call `onError` once with the error and the rule, continue evaluating the remaining rules in the same Tick, and complete the Tick without throwing.
11. IF `apply` returns `undefined`, THEN THE Engine SHALL not record the rule as active, SHALL not include it in `applied`, and SHALL not include its id in `activeRuleIds()`.
12. WHEN a Tick completes, THE Engine SHALL return an object containing the arrays `applied`, `updated` and `undone`, each holding rule ids and each being an empty array when no rules fall in that category.
13. THE Engine SHALL expose `activeRuleIds()` returning an array of the ids of all rules currently recorded as active, or an empty array when none are active.

### Requirement 5: Effect undo with fade - EXISTING
**User Story:** As a user, I want the haunt to lift when I change my behaviour, so that the page returns to normal, optionally fading out.

#### Acceptance Criteria

1. WHEN an active rule's meter value drops below its `threshold`, or its URL stops matching, THE Engine SHALL remove the rule from the active set, call the Effect's `undo` exactly once with the rule's Handle, and include the rule's id in the `undone` list of that evaluation result.
2. WHEN a rule's `undo.mode` is `instant`, THE Engine SHALL call `undo` with `durationMs` 0.
3. WHEN a rule's `undo.mode` is `fade`, THE Engine SHALL call `undo` with the rule's `durationMs`, using 400 when `durationMs` is omitted.
4. WHILE an undo with `durationMs` greater than 0 is in progress, THE Engine SHALL track the Handle as fading until the finish step has run.
5. WHEN a rule re-triggers while its previous Handle is fading, THE Engine SHALL call `undo` with `durationMs` 0 on the old Handle, and only after that call returns, apply the new Handle.
6. WHEN an active rule is removed from the rule list or is no longer enabled, THE Engine SHALL call `undo` with `durationMs` 0 and include the rule's id in the `undone` list.
7. THE shared `teardown` helper SHALL run its finish step at most once per Handle, regardless of how many times `teardown` is called on it.
8. WHEN `teardown` is called with `durationMs` greater than 0 on a Handle that is not fading, THE teardown helper SHALL start the fade step, mark the Handle as fading, and schedule the finish step to run `durationMs` milliseconds later.
9. WHEN `teardown` is called with `durationMs` 0 on a fading Handle, THE teardown helper SHALL clear the pending timer and run the finish step immediately.
10. IF `teardown` is called with `durationMs` greater than 0 on a Handle that is already fading, THEN THE teardown helper SHALL leave the pending timer unchanged and not start a second fade.
11. IF `teardown` is called on a missing or dead Handle, THEN THE teardown helper SHALL do nothing and throw no error.

### Requirement 6: Built-in effects - EXISTING
**User Story:** As a rule author, I want four distinct effects, so that I can choose how a site is haunted.

#### Acceptance Criteria

1. WHEN the Fog_Effect applies, THE Fog_Effect SHALL set the `filter` of `documentElement` to a blur of `maxBlur * intensity` pixels (default 6) and a grayscale of `maxGrayscale * intensity` (default 1), where Intensity is a number from 0 to 1 inclusive.
2. WHEN the Fog_Effect creates a Handle, THE Fog_Effect SHALL record the previous inline `filter` and `transition` values of `documentElement`, recording an empty string for any value that was not set.
3. WHEN the Fog_Effect undoes with `durationMs` greater than 0, THE Fog_Effect SHALL transition the filter to zero blur and zero grayscale over `durationMs` milliseconds, then restore the recorded values.
4. WHEN the Fog_Effect undoes with `durationMs` equal to 0, THE Fog_Effect SHALL restore the recorded `filter` and `transition` values immediately, without a transition.
5. WHEN the Flicker_Effect applies while `env.reducedMotion` is false, THE Flicker_Effect SHALL inject a `<style data-poltergeist="flicker">` with a `pg-flicker` keyframes rule whose dip depth is `maxDepth * intensity` (default 0.6) and set an infinite animation on `documentElement` with a period of `periodMs` milliseconds (default 1400).
6. WHILE `env.reducedMotion` is true, THE Flicker_Effect SHALL apply a static opacity of `1 - depth * 0.5` to `documentElement`, where depth is `maxDepth * intensity`, and SHALL NOT set any animation.
7. WHEN the Flicker_Effect undoes, THE Flicker_Effect SHALL restore the recorded `animation` and `opacity` values and remove its style element within the same call, ignoring any requested `durationMs` fade.
8. WHEN the Rot_Effect applies, THE Rot_Effect SHALL replace a fraction of non-whitespace characters, equal to `maxFraction * intensity` (default 0.5), with characters drawn from `glyphs` (default `░▒·_ `) in visible text nodes under `document.body`.
9. THE Rot_Effect SHALL choose rotted characters with a deterministic hash of node serial and character index, so that the same inputs always produce the same output and the set of rotted characters at a lower Intensity is a subset of the set at a higher Intensity.
10. THE Rot_Effect SHALL skip text inside `SCRIPT`, `STYLE`, `NOSCRIPT`, `TEXTAREA`, `INPUT`, `CODE` and content-editable elements, and SHALL skip whitespace-only nodes.
11. WHEN the page rewrites a text node that Rot_Effect changed, THE Rot_Effect SHALL treat the new text as the original for that node.
12. WHEN the Rot_Effect undoes, THE Rot_Effect SHALL, within the same call, restore the original text of each node whose current data still equals the rotted output, leave unchanged any node whose current data differs from the rotted output, and clear its node map.
13. WHEN the Block_Effect applies, THE Block_Effect SHALL create a fixed-position, full-viewport `div[data-poltergeist="block"]` with `role="status"` and `z-index` 2147483647, appended to `body`, or to `documentElement` if `body` is absent.
14. WHEN the Block_Effect applies, THE Block_Effect SHALL set the overlay opacity to `maxOpacity * intensity` (default 0.92) and set its text to `message` (default empty string).
15. WHEN the Block_Effect applies with Intensity at least `blockAt` (default 1), THE Block_Effect SHALL set `pointer-events` to `auto` on the overlay.
16. WHEN the Block_Effect applies with Intensity less than `blockAt`, THE Block_Effect SHALL set `pointer-events` to `none` on the overlay.
17. WHEN the Block_Effect undoes with `durationMs` greater than 0, THE Block_Effect SHALL set `pointer-events` to `none`, fade opacity to 0 over `durationMs` milliseconds, then remove the overlay.
18. WHEN the Block_Effect undoes with `durationMs` equal to 0, THE Block_Effect SHALL remove the overlay within the same call.
19. THE Effect_Registry `builtinEffects` SHALL contain exactly four entries, named `fog`, `flicker`, `rot` and `block`.
20. WHEN `apply` is called with a Handle that is not dead, each built-in Effect SHALL update that Handle, leaving the count of page artifacts (style elements, overlay elements, and rotted-node records) unchanged.

### Requirement 7: Stop and cleanup - EXISTING
**User Story:** As a user, I want the engine to leave no haunt behind when it stops, so that navigating away or disabling it restores the page.

#### Acceptance Criteria

1. WHEN `start` is called while the Engine is not running, THE Engine SHALL run one Tick immediately and then one Tick every `tickMs` milliseconds, where `tickMs` defaults to 250 when not provided.
2. IF `start` is called while the Engine is already running, THEN THE Engine SHALL leave the existing interval in place, create no second interval, and run no additional immediate Tick.
3. WHEN `stop` is called while the Engine is running, THE Engine SHALL clear the interval so that no further Tick runs after `stop` returns.
4. WHEN `stop` is called, THE Engine SHALL undo every active Effect with `durationMs` 0, so that the page is restored to its state before the Effect was applied.
5. WHEN `stop` is called, THE Engine SHALL finish every fading Handle immediately, so that no fading Handle remains active and each Effect's changes are undone before `stop` returns.
6. WHEN `stop` is called while the Engine is not running or has already been stopped, THE Engine SHALL return without throwing an error and without changing page state.
7. WHEN the Entry_Point `stop` function is called, THE Entry_Point SHALL stop the Engine, dispose the Meter_Set and remove its `pagehide` listener.
8. WHEN the window fires `pagehide`, THE Entry_Point SHALL run its `stop` function.
9. WHEN `start` is called after `stop` has completed, THE Engine SHALL run one Tick immediately and then one Tick every `tickMs` milliseconds.

### Requirement 8: Entry point setup - EXISTING
**User Story:** As an extension developer, I want one call to start the engine in a content script, so that integration is simple.

#### Acceptance Criteria

1. WHEN `startPoltergeist` is called with a rules document, THE Entry_Point SHALL validate the document with the Rule_Validator before creating any Env, Meter_Set or Engine.
2. IF the rules document is invalid, THEN THE Entry_Point SHALL throw an Error whose message begins "Invalid Poltergeist rules:" followed by the validation errors, and SHALL NOT create or start an Engine.
3. WHEN the rules are valid, THE Entry_Point SHALL create an Env, a Meter_Set, and an Engine, start the Engine, and return an object with exactly the properties `engine`, `meters` and `stop`.
4. WHEN the returned `stop` is called, THE Entry_Point SHALL stop the Engine so that no further ticks run after `stop` returns.
5. THE Entry_Point SHALL expose `env.reducedMotion` as a getter that evaluates the `(prefers-reduced-motion: reduce)` media query on each access and returns a boolean reflecting the current match state.
6. WHERE `effects` is supplied, THE Entry_Point SHALL use it in place of `builtinEffects`, without merging in any `builtinEffects` entries.
7. WHERE `initialMeters` is supplied, THE Entry_Point SHALL seed the Meter_Set with its values so that each supplied meter reads that value immediately after `startPoltergeist` returns.
8. THE Entry_Point SHALL re-export `createEngine`, `createMeters`, `builtinEffects`, `validateRules`, `validateRule`, `matchUrl` and `DEFAULT_TICK_MS`.

### Requirement 9: Scroll tracking in inner containers - NEW
**User Story:** As a rule author, I want scroll distance to include scrolling inside inner containers, so that feed-style pages with scrollable panes still raise the meter.

#### Acceptance Criteria

1. WHEN a `scroll` event fires on any Scroll_Container, THE Meter_Set SHALL add the absolute value of the difference between the container's current `scrollTop` and its previously recorded `scrollTop` to `scrollDistance`, in pixels.
2. THE Meter_Set SHALL register its scroll listener on the document in the capture phase, so that non-bubbling scroll events from Scroll_Containers are received.
3. THE Meter_Set SHALL track the previous scroll position separately for each scroll target, using `scrollTop` for elements and `scrollY` for the window.
4. WHEN a scroll target is seen for the first time, THE Meter_Set SHALL record that target's scroll position at the time of the first event as its baseline and SHALL add 0 to `scrollDistance` for that event.
5. WHEN `dispose` is called, THE Meter_Set SHALL remove the capture-phase scroll listener using the same capture option, so that scroll events fired after `dispose` leave `scrollDistance` unchanged.
6. WHEN both the window and a Scroll_Container scroll, THE Meter_Set SHALL sum the distances of both into `scrollDistance`.
7. WHEN a `scroll` event fires and the target's current scroll position equals its previously recorded position, THE Meter_Set SHALL add 0 to `scrollDistance`.

### Requirement 10: Fog and flicker as overlays below the Block_Overlay - NEW
**User Story:** As a rule author, I want fog and flicker rendered as separate fixed overlays beneath the block overlay, so that the block message stays crisp and opaque and page layout, including fixed-position elements, is unaffected.

#### Acceptance Criteria

1. WHEN the Fog_Effect applies and no Fog_Overlay exists for its Handle, THE Fog_Effect SHALL create one `div[data-poltergeist="fog"]` as a direct child of `documentElement`, with `position: fixed`, `top`, `right`, `bottom` and `left` of 0, `pointer-events: none` and `z-index` 2147483645.
2. WHEN the Flicker_Effect applies and no Flicker_Overlay exists for its Handle, THE Flicker_Effect SHALL create one `div[data-poltergeist="flicker"]` as a direct child of `documentElement`, with `position: fixed`, `top`, `right`, `bottom` and `left` of 0, a black background, `pointer-events: none` and `z-index` 2147483646.
3. WHEN the Fog_Effect applies with Intensity `i`, THE Fog_Overlay SHALL have a `backdrop-filter` of `blur(B px) grayscale(G)`, where B equals `maxBlur * i` pixels (default `maxBlur` 6) and G equals `maxGrayscale * i` (default `maxGrayscale` 1).
4. WHEN the Fog_Effect applies at two Intensities `i1 < i2`, THE Fog_Overlay blur radius and grayscale amount at `i2` SHALL each be greater than or equal to those at `i1`, and SHALL both be 0 when `i` is 0.
5. WHEN the Flicker_Effect applies while `env.reducedMotion` is false, THE Flicker_Overlay SHALL run an infinite opacity animation with a period of `periodMs` milliseconds (default 1400), defined by a `pg-flicker` keyframes rule in a `<style data-poltergeist="flicker">` element, whose peak opacity is `maxDepth * intensity` (default `maxDepth` 0.6) and whose minimum opacity is 0.
6. WHILE `env.reducedMotion` is true, THE Flicker_Overlay SHALL have a static `opacity` of `maxDepth * intensity * 0.5` and no `animation`.
7. WHEN `apply` is called with a live Handle, THE Fog_Effect and THE Flicker_Effect SHALL update the existing overlay in place, leaving the count of `div[data-poltergeist="fog"]`, `div[data-poltergeist="flicker"]` and `style[data-poltergeist="flicker"]` elements in the document unchanged and the overlay element identity unchanged.
8. WHEN the Fog_Effect undoes with `durationMs` equal to 0, THE Fog_Effect SHALL remove the Fog_Overlay from the document within the same call.
9. WHEN the Fog_Effect undoes with `durationMs` greater than 0, THE Fog_Effect SHALL transition the Fog_Overlay `backdrop-filter` to `blur(0px) grayscale(0)` over `durationMs` milliseconds, and SHALL remove the Fog_Overlay when `durationMs` milliseconds have elapsed.
10. WHEN the Flicker_Effect undoes with any `durationMs`, THE Flicker_Effect SHALL remove the Flicker_Overlay and its `style[data-poltergeist="flicker"]` element within the same call.
11. WHILE a Fog_Overlay, a Flicker_Overlay and the Block_Overlay all exist, THE Block_Overlay `z-index` (2147483647) SHALL be greater than the `z-index` of the Fog_Overlay and of the Flicker_Overlay.
12. THE Fog_Effect, THE Flicker_Effect and THE Block_Effect SHALL NOT set any inline style property on `documentElement` or on `body`, so that the `style` attribute of each equals its pre-apply value after apply, update and undo.
13. (BROWSER-VERIFIED) WHILE the Fog_Effect, the Flicker_Effect and the Block_Effect are all active, THE Block_Overlay SHALL have a computed `filter` of `none`, a computed `backdrop-filter` of `none`, and a computed `opacity` equal to its own configured opacity, and the Block_Overlay `parentElement` SHALL be `documentElement`.
14. (BROWSER-VERIFIED) WHILE any of the Fog_Effect, the Flicker_Effect or the Block_Effect is active, THE page SHALL keep every `position: fixed` element at the same bounding-client-rect position as before the effect was applied, because the effects set no `filter`, `opacity`, `transform` or `animation` on an ancestor of page content.
15. IF `document.body` is absent when the Fog_Effect or Flicker_Effect applies, THEN THE effect SHALL append its overlay to `documentElement`, return a Handle, and throw no error.
16. THE Block_Effect SHALL append the Block_Overlay as a direct child of `documentElement`, whether or not `body` exists.

Note: Criteria 13 and 14 are BROWSER-VERIFIED. They MUST be verified in real Chrome with a Playwright test or Playwright MCP, because jsdom does not perform layout or compute visual styles (`backdrop-filter`, computed `opacity`, `getBoundingClientRect`). All other criteria of this requirement are structural (jsdom-verified) and are verified with jsdom tests.

### Requirement 11: Registry-derived effect types in the validator - NEW
**User Story:** As an extension developer, I want custom effects to pass validation, so that I can register effects beyond the four built-ins.

#### Acceptance Criteria

1. WHERE an Effect_Registry is passed to `validateRule` or `validateRules`, WHEN a rule's `effect.type` is a string equal to a key of that registry, THE Rule_Validator SHALL accept the `effect.type` and report no `effect.type` error for that rule.
2. WHERE an Effect_Registry is passed, IF `effect.type` is missing, is not a string, or is not a key of that registry, THEN THE Rule_Validator SHALL reject the rule, SHALL report an error that identifies the `effect.type` field and lists every key of that registry, and SHALL leave the input rule and registry unmodified.
3. WHERE no Effect_Registry is passed to `validateRule` or `validateRules`, WHEN a rule's `effect.type` is a string equal to a key of `builtinEffects`, THE Rule_Validator SHALL accept the `effect.type`.
4. WHERE no Effect_Registry is passed, IF `effect.type` is missing, is not a string, or is not a key of `builtinEffects`, THEN THE Rule_Validator SHALL reject the rule and report an error that identifies the `effect.type` field and lists the keys of `builtinEffects`.
5. WHERE an Effect_Registry with zero keys is passed, IF a rule is validated, THEN THE Rule_Validator SHALL reject the rule with an `effect.type` error whose key list is empty.
6. WHEN `startPoltergeist` is called with an `effects` option, THE Entry_Point SHALL pass that same registry object to `validateRules` before any rule is applied.
7. THE Rule_Schema SHALL describe `effect.type` as a string without an enumerated list of values, and THE schema-sync test SHALL fail if the keys of `builtinEffects` differ from the default allowed types used by the Rule_Validator.
8. THE Rule_Validator SHALL export the `EFFECT_TYPES` constant, and its contents SHALL equal the set of `builtinEffects` keys (`fog`, `flicker`, `rot`, `block`).

### Requirement 12: Persisted per-site meters with daily reset via an injected Storage_Adapter - NEW
**User Story:** As a user, I want my meters to survive page reloads and to accumulate across tabs on the same site, so that reloading or opening a second tab cannot reset an ongoing haunt.

#### Acceptance Criteria

**Storage_Adapter contract and injection**

1. THE Storage_Adapter contract SHALL consist of two functions: `get(key)`, returning a Promise that resolves to the value previously stored under `key` or to `undefined` when no value is stored, and `set(key, value)`, returning a Promise that resolves once `value` has been written under `key`.
2. IF a Storage_Adapter `get` or `set` call rejects or throws, THEN THE Meter_Store SHALL treat that operation as failed.
3. THE Meter_Store SHALL receive its Storage_Adapter by injection and SHALL perform all persistence solely through that Storage_Adapter.
4. THE skeleton SHALL contain no source file under `skeleton/` that references the global `chrome`, as verified by an automated test that scans the full text, including comments, of every `.js` file under `skeleton/` excluding `skeleton/test/` for the token `chrome.` (the lowercase identifier `chrome` followed by a dot). The scan SHALL be case-sensitive, so that text such as "Chrome match pattern" (capital C) in `match.js` does not fail it.
5. THE Storage_Adapter implementations for `chrome.storage.local` and for `localStorage` SHALL be supplied by the host or SHALL reside outside the engine core in `skeleton/`, so that the Meter_Store works with any object satisfying the Storage_Adapter contract.
6. THE usage example in the `index.js` doc comment SHALL be updated to omit any `chrome.runtime` reference and any other `chrome.` reference, showing the asynchronous `startPoltergeist` called with `await`, a host-supplied Storage_Adapter, and rules passed in directly, so that the scan in criterion 4 passes against `index.js` comments as well as code.

**Keys, record and baseline**

7. THE Meter_Store SHALL derive the site key from the page's hostname, lowercased, excluding port, path, query, and fragment, so that all pages on the same hostname share one meter record.
8. THE Meter_Store SHALL persist one record per site key, of the form `{ date, timeOnSite, scrollDistance }`, under a Storage_Adapter key that is a deterministic function of the site key.
9. THE Meter_Store SHALL store the local calendar date (in YYYY-MM-DD form, based on the device's local time zone) in the `date` field of every written record.
10. THE Meter_Store SHALL track a baseline, being the `timeOnSite` and `scrollDistance` values at the last successful write (or the values seeded at load if no write has succeeded yet).
11. THE Meter_Store SHALL NOT persist `timeSinceActive`; after a load, `timeSinceActive` SHALL be 0.

**Load**

12. WHEN the Entry_Point starts with a Storage_Adapter, THE Meter_Store SHALL read the record for the current site key through `get`, and SHALL pass its `timeOnSite` and `scrollDistance` as `initialMeters` to the Meter_Set and set the baseline to those values before the Engine's first Tick.
13. WHEN the stored `date` differs from the current local calendar date at load time, THE Meter_Store SHALL discard the stored values and start `timeOnSite` and `scrollDistance` from 0.
14. WHEN no record exists for the site key at load time, THE Meter_Store SHALL start `timeOnSite` and `scrollDistance` from 0.
15. IF the stored record for the site key is malformed (not an object, `date` missing or not a string, or `timeOnSite` or `scrollDistance` not a non-negative finite number), THEN THE Meter_Store SHALL discard the record, start both meters from 0, and report the failure through `onError` exactly once.

**Delta writes**

16. WHEN the Meter_Store performs a write, THE Meter_Store SHALL (a) capture the current `timeOnSite` and `scrollDistance`, (b) read the current stored record through `get`, (c) compute for each of the two meters the delta as the captured value minus the baseline, (d) write through `set` a record whose `date` is the current local calendar date and whose values are the stored values plus the deltas, and (e) only after `set` resolves, advance the baseline to the captured values.
17. IF the stored record read in a write is absent, is malformed, or has a `date` that differs from the current local calendar date at write time, THEN THE Meter_Store SHALL discard the stored values and write the deltas onto 0 (daily reset).
18. IF the delta of a meter is negative, THEN THE Meter_Store SHALL add 0 for that meter instead of the delta and SHALL leave that meter's baseline unchanged.
19. IF both deltas are 0, THEN THE Meter_Store SHALL skip the `set` call and SHALL leave the baseline unchanged.
20. IF a `get` or `set` call fails during a write, THEN THE Meter_Store SHALL leave the baseline unchanged, so that the same delta is included in the next write and no delta is lost or counted twice, and SHALL report the failure through `onError` exactly once for that failed operation.
21. THE Meter_Store SHALL NOT start a write while an earlier write from the same Meter_Store is still in progress, so that one tab never counts the same delta twice.
22. THE Meter_Store read-modify-write SHALL be best-effort and not atomic across tabs, because the Storage_Adapter provides no transaction; the accepted limitation is that two tabs whose writes interleave between `get` and `set` MAY lose one tab's delta for that write.

**Lifecycle**

23. WHILE the Engine is running with a Storage_Adapter, THE Meter_Store SHALL perform a write every 5 seconds (±500 ms).
24. WHEN the explicit `stop` is called or `pagehide` fires, THE Entry_Point SHALL issue a final Meter_Store write, capturing the meter values synchronously before the Engine stops, and SHALL cancel the 5 second write interval.
25. WHEN `pagehide` fires, THE Entry_Point SHALL issue the final write without awaiting its completion (best effort, because `pagehide` handlers cannot await) and SHALL then stop the Engine and dispose the Meter_Set synchronously.
26. WHEN the explicit `stop` returned by `startPoltergeist` is called, THE Entry_Point SHALL return a Promise that resolves after the final write has settled (resolved or failed), and SHALL stop the Engine without waiting for that Promise.
27. WHEN `stop` is called more than once, THE Entry_Point SHALL issue the final write only once.

**Async entry point**

28. THE Entry_Point `startPoltergeist` SHALL be asynchronous and return a Promise.
29. WHEN the meters have been loaded from the Storage_Adapter, THE Promise SHALL resolve to an object with exactly the properties `engine`, `meters` and `stop`, and the Engine's first Tick SHALL run after the load completes and not before.
30. IF the rules document is invalid, THEN THE Promise SHALL reject with an Error whose message begins "Invalid Poltergeist rules:" followed by the validation errors, and THE Entry_Point SHALL NOT read the Storage_Adapter, create an Engine or start one.
31. WHERE no Storage_Adapter is supplied, THE Entry_Point SHALL start the Meter_Set from `initialMeters` (or 0 for each omitted meter) and SHALL perform no persistence.
32. IF the Storage_Adapter `get` rejects or throws during load, THEN THE Entry_Point SHALL still resolve with meters starting from 0 and SHALL report the failure through `onError` exactly once.
33. WHEN `startPoltergeist` is called with an `effects` option, THE Entry_Point SHALL continue to pass that same registry to `validateRules` before any other step (Requirement 11 criterion 6 remains in force).

**Properties**

34. FOR ALL non-negative finite stored values S and non-negative finite deltas D on one tab, loading S on the same local calendar date, adding D to the meters and then writing SHALL produce a stored record equal to S plus D for each of `timeOnSite` and `scrollDistance` (round-trip property for a single tab), and a subsequent load SHALL seed the Meter_Set with those values.
35. FOR ALL non-negative finite deltas D1 and D2 written by two tabs on the same site and the same local calendar date, with their writes not interleaved, the stored record SHALL equal the initial stored values plus D1 plus D2 for each meter (accumulation property).

### Requirement 13: Pruning detached nodes in the Rot_Effect - NEW
**User Story:** As a developer, I want the Rot_Effect to drop references to removed text, so that long-running pages do not leak memory.

#### Acceptance Criteria

1. WHEN the Rot_Effect applies, THE Rot_Effect SHALL remove from its node map every Detached_Node, where a Detached_Node is a text node whose `isConnected` property is false, before processing any other entry in that application.
2. WHEN a Detached_Node is pruned, THE Rot_Effect SHALL leave the node's text data unchanged from its value immediately before pruning.
3. WHEN the Rot_Effect applies after a text node was removed from the document, THE Rot_Effect SHALL contain zero entries referencing that node in its node map upon completion of that application.
4. WHEN a rotted node has been removed from the document and the Rot_Effect later undoes, THE Rot_Effect SHALL complete the undo without throwing an error and SHALL restore the text data of every node that remains connected.
5. WHEN the Rot_Effect applies, THE Rot_Effect SHALL retain, with unchanged entry content, every node map entry whose node has `isConnected` true.
6. IF the node map contains no Detached_Node when the Rot_Effect applies, THEN THE Rot_Effect SHALL complete pruning without error and SHALL leave the node map unchanged by pruning.

### Requirement 14: jsdom restoration tests for every effect - NEW
**User Story:** As a maintainer, I want tests proving each effect fully restores the page, so that regressions in undo are caught.

#### Acceptance Criteria

1. THE test suite SHALL run all effect restoration tests in this requirement in a jsdom environment.
2. FOR EACH built-in Effect, THE test suite SHALL capture a snapshot consisting of the serialized document HTML, the inline `style` attribute of `documentElement` and the inline `style` attribute of `body` before `apply`, and SHALL assert that the snapshot taken after `undo` with `durationMs` 0 is strictly equal to the snapshot taken before `apply`.
3. FOR EACH built-in Effect, THE test suite SHALL call `apply` at least 3 times on the same target with at least 3 distinct intensity values within the range 0 to 1, call `undo` with `durationMs` 0, and assert that the snapshot defined in criterion 2 is strictly equal to the pre-`apply` snapshot.
4. FOR EACH built-in Effect that supports fade (Fog_Effect and Block_Effect), THE test suite SHALL call `undo` with a `durationMs` greater than 0 under fake timers, advance the timers by exactly `durationMs`, and assert that the snapshot defined in criterion 2 is strictly equal to the pre-`apply` snapshot.
5. FOR EACH built-in Effect that supports fade (Fog_Effect and Block_Effect), THE test suite SHALL start a fade `undo` with a `durationMs` greater than 0, call `undo` with `durationMs` 0 before any timers are advanced, and assert that the snapshot defined in criterion 2 is strictly equal to the pre-`apply` snapshot without advancing timers.
6. THE test suite SHALL assert that Flicker_Effect restores the snapshot defined in criterion 2 after `apply` and `undo`, once with reduced-motion disabled and once with reduced-motion enabled.
7. WHEN `undo` is called a second time on the same Handle, THE test suite SHALL assert that the snapshot defined in criterion 2 is unchanged from the snapshot taken after the first `undo` call and that the second call throws no error.
8. THE test suite SHALL assert that Rot_Effect restores the snapshot defined in criterion 2 in each of these three scenarios: the page contains text nodes with pre-existing text, the page contains elements that Rot_Effect is specified to skip, and the page rewrites the content of a text node after `apply` and before `undo`.
9. WHEN multiple Effects are applied together to the same page, THE test suite SHALL assert that the snapshot defined in criterion 2 equals the pre-`apply` snapshot after undoing them in each of the following orders: the order applied, the reverse order, and at least one interleaved order.
10. THE jsdom tests of this requirement SHALL NOT be taken to cover Requirement 10 criteria 13 and 14; those BROWSER-VERIFIED criteria SHALL be covered by a Playwright test (or Playwright MCP run) in real Chrome.
