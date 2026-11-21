# Requirements Document

## Introduction

Haunt Polish is a one-day, timeboxed visual pass on the shared skeleton effects so that both apps look good in a 3-minute demo video. All visual work happens in the root `skeleton/effects/`, so Doomscroll, Tab Graveyard, and a future Playground get it through the generated skeleton copies.

The pass covers five areas:

- Block (Doomscroll finale): large display type, a ghost figure, a slow fade-in, and an optional second line filled from a meter.
- Tombstone (Graveyard finale): a stone texture, a cracked or weathered edge, an `R.I.P.` mark, and a short rise-in.
- Demo-time durations: Block and Tombstone accept `durationScale` and `durationSuffix`, which only each app's demo profile builder sets.
- Fog: a faint green-grey tint and a slowly drifting noise texture.
- Rot: rotted characters are shown in a faded, discoloured colour.

Decisions recorded in this document:

1. **Existing tests.** Every existing unit and browser test keeps passing. The only test edits are the ones in Requirement 10 criterion 3, because their current assertions describe behaviour that the user asked to change: the Tombstone unit test "shows no animation and schedules no timers when applied" is rewritten for the Rise_In, and in `return-resurrect.pw.js` and `discard-reload.pw.js` the demo Tombstone message assertions, and the comments that say the duration is worded in seconds, change to demo time.
2. **Demo builders select rules by `durationMeter`.** A Demo_Builder adds the duration params only to Duration_Rules, the rules that name the meter they display. Every other rule changes exactly as before, so the existing demo-profile property tests (Doomscroll Property 2, Graveyard Property 4) stay valid without edits. The Graveyard Property 4 test generator gives every param an integer value and so never produces a string `durationMeter`, which means the property still holds for every rule it generates. The Doomscroll Property 2 generator does the same. Both apps' finale rules name `durationMeter` explicitly (Requirement 7 criterion 10).
3. **Earlier specs.** Requirement 9 edits the tab-graveyard-app spec. It replaces Requirement 2 criterion 8 and Requirement 4 criterion 10, each followed by a reason note, and adds notes after Requirement 4 criterion 5, Requirement 4 criterion 12, Property 4 in `design.md`, and the "no animation" item in the "Constraints for every task" list of `tasks.md`. tab-graveyard-app Requirement 4 criterion 12 limited only the skeleton changes made under that spec. This spec deliberately changes the Fog, Rot, Block, and Tombstone visuals and leaves Flicker, `engine.js`, and `match.js` unchanged.

Change markers: `SKELETON` changes shared code under `skeleton/`; `APP` changes app code; `PACKAGING` changes rules, validators, manifests, or generated copies; `DOCS` changes earlier spec documents; `TEST` covers verification.

Verification: Vitest example-based unit tests, the existing restoration and browser suites, and a manual screenshot pass in Chrome. This spec adds no property-based tests.

Out of scope: new effects; any change to Flicker; popup changes (the Graveyard popup keeps showing real durations in Demo_Mode); changes to the engine, meters, validator, rule schema, or `startPoltergeist`; anything under `demo-site/`; the Playground itself; automated screenshot or visual-diff tests.

## Glossary

- **Skeleton**: the root `skeleton/` directory, the single source of truth for the engine, meters, and effects.
- **Generated_Skeleton**: the committed copies `app1-doomscroll/skeleton/` and `app2-tab-graveyard/skeleton/`, built by the Skeleton_Sync.
- **Skeleton_Sync**: `scripts/sync-skeleton.mjs`, run by `npm run build:skeletons` and `npm run check:skeletons`.
- **Doomscroll**, **Graveyard**: the apps in `app1-doomscroll/` and `app2-tab-graveyard/`. Tab Graveyard is the Graveyard app's product name.
- **Fog_Effect**, **Rot_Effect**, **Block_Effect**, **Tombstone_Effect**, **Flicker_Effect**: the built-in effects in `skeleton/effects/fog.js`, `rot.js`, `block.js`, `tombstone.js`, and `flicker.js`. Each exports `apply`, `undo`, and `description`. In prose, Fog, Rot, Block, Tombstone, and Flicker name the same effects.
- **Live handle**: a handle (the value an effect's `apply` returns) that has not yet been passed to `undo`. A live Block handle, live Fog handle, or live Rot handle is one returned by that effect. The tab-graveyard-app text quoted in Requirement 9 writes "live Handle".
- **Fog_Overlay**: the `div[data-poltergeist="fog"]` element that the Fog_Effect appends to `documentElement`.
- **Block_Overlay**: the `div[data-poltergeist="block"]` element that the Block_Effect appends to `documentElement`. Requirement 2 criterion 11 defines its shadow root.
- **Tombstone_Host**: the `[data-poltergeist="tombstone"]` element that the Tombstone_Effect appends to `documentElement`, with an open shadow root.
- **Tombstone_Card**: the element inside the Tombstone_Host's shadow root that holds the heading, the message, and the button.
- **Duration_Formatter**: the function exported as `formatDuration` from `skeleton/effects/tombstone.js`. It formats seconds as whole seconds below 1 minute, whole minutes below 1 hour, whole hours below 48 hours, and whole days otherwise, with singular and plural units.
- **Duration_Text**: the text that the Block_Effect or the Tombstone_Effect inserts for a `{duration}` placeholder, as defined in Requirement 1.
- **Reduced_Motion**: the value of `env.reducedMotion` at the moment an effect reads it. `startPoltergeist` derives it from the `prefers-reduced-motion: reduce` media query.
- **Fade_In**: the Block_Effect's one-time entrance in which the figure, the message, and the second line go from transparent to opaque.
- **Rise_In**: the Tombstone_Effect's one-time entrance in which the Tombstone_Card moves up into its final position from below while going from transparent to opaque.
- **Entrance_Animation**: the Fade_In or the Rise_In.
- **Drift**: the continuous motion of the Fog_Effect's noise texture.
- **Rotted_Character**: a character in a text node that the Rot_Effect has replaced with a glyph.
- **Text_Range_Styling**: a browser feature that styles ranges of text without changing the DOM. In Chrome this is the CSS Custom Highlight API (`CSS.highlights` and `Highlight`).
- **Normal_Profile**: the rules parsed from an app's `rules.json`.
- **Demo_Builder**: `doomscrollCreateDemoProfile` in `app1-doomscroll/content.js`, which divides trigger `threshold` and `rampTo` by 60, or `graveyardCreateDemoProfile` in `app2-tab-graveyard/content.js`, which divides them by 3600.
- **Demo_Profile**: the deep clone of the Normal_Profile that a Demo_Builder returns.
- **Demo_Mode**: each app's global preference that selects the Demo_Profile.
- **Demo_Suffix**: the string ` (demo time)`, with one leading space.
- **Duration_Rule**: a rule whose `effect.params` contains a string `durationMeter`.
- **Package_Validators**: `scripts/validate-doomscroll-package.mjs` and `scripts/validate-graveyard-package.mjs` (each a Package_Validator), with shared checks in `scripts/package-checks.mjs`.
- **Restoration_Suite**: `skeleton/test/restoration.test.js`, including the test that undoes Fog, Flicker, Rot, and Block in all 24 orders.
- **Screenshot_Checklist**: the list of screenshots to take by hand in Chrome, defined in Requirement 10.
- **Polish_Change**: all code, rule, test, and document edits made under this spec.
- **Away_Time**, **Demo_Time_Scale**, **Handle**: tab-graveyard-app terms, used only in the amended text quoted in Requirement 9. That spec's glossary defines Away_Time (the absence value that drives decay) and Demo_Time_Scale (exactly 3600). A Handle is the value an effect's `apply` returns.

## Requirements

### Requirement 1: Demo-scalable duration text - SKELETON

**User Story:** As the person recording the demo, I want Block and Tombstone durations to read in demo time, so that the video shows "33 hours (demo time)" instead of "33 seconds".

#### Acceptance Criteria

1. THE Block_Effect and THE Tombstone_Effect SHALL each accept two optional params: `durationScale`, a number with default 1, and `durationSuffix`, a string with default `""`.
2. WHEN the Block_Effect fills a `{duration}` placeholder in `detail`, or the Tombstone_Effect fills a `{duration}` placeholder in `heading` or `message`, and `env.readMeter(durationMeter)` returns a finite number, THE effect SHALL insert the Duration_Formatter output for that number multiplied by `durationScale`, followed directly by `durationSuffix` exactly as given, with no trimming and no placeholder substitution inside the suffix. The default `durationMeter` is `timeAway` for the Tombstone_Effect and `timeOnSite` for the Block_Effect.
3. IF `env.readMeter` is not a function, or it returns a value that is not a finite number, or the meter value multiplied by the scale is not a finite number, THEN THE Block_Effect and THE Tombstone_Effect SHALL insert `a while` without `durationSuffix` and SHALL raise no error.
4. IF `durationScale` is not of type number, is `NaN` or infinite, or is 0 or less (a numeric string such as `"60"` counts as invalid), THEN THE Block_Effect and THE Tombstone_Effect SHALL use a scale of 1 and SHALL raise no error.
5. IF `durationSuffix` is not of type string, THEN THE Block_Effect and THE Tombstone_Effect SHALL use an empty suffix and SHALL raise no error.
6. THE Block_Effect and THE Tombstone_Effect SHALL format durations with one shared Duration_Formatter implementation, and `skeleton/effects/tombstone.js` SHALL keep exporting `formatDuration`, which SHALL return the same string as before the Polish_Change for every input, including `a while` for any input that is not a finite number.
7. WHERE `durationScale` and `durationSuffix` are both absent, THE Tombstone_Effect SHALL render the same heading and message text as before the Polish_Change for every meter value, every page title, and every `heading` and `message` template, including when `env.readMeter` is not a function.
8. WHERE `durationScale` is 3600 and `durationSuffix` is the Demo_Suffix, WHEN the Tombstone_Effect fills `{duration}`, THE Tombstone_Effect SHALL insert `33 hours (demo time)` for a meter value of 33 and `2 days (demo time)` for a meter value of 48.
9. WHERE `durationScale` is 60 and `durationSuffix` is the Demo_Suffix, WHEN the Block_Effect fills `{duration}`, THE Block_Effect SHALL insert `20 minutes (demo time)` for a meter value of 20 and `30 seconds (demo time)` for a meter value of 0.5, because the scale is applied before the Duration_Formatter rounds down.
10. WHEN `apply` is called again with a live handle, or the Tombstone_Effect re-renders after the page becomes visible, THE Block_Effect and THE Tombstone_Effect SHALL build the Duration_Text from the current meter value and from the `durationScale` and `durationSuffix` of the most recent `apply` call.

### Requirement 2: Block finale - SKELETON

**User Story:** As a Doomscroll user who has scrolled too long, I want a final screen that is large, unmistakable, and says how much time I lost, so that the break message lands.

#### Acceptance Criteria

1. THE Block_Effect SHALL render `message` at a computed font size of at least 36 CSS pixels, and the computed font sizes of the message and the second line SHALL stay the same for every `html` font size from 8 to 32 CSS pixels.
2. WHERE `figure` is `ghost`, absent, or any value other than `none` (default `ghost`), THE Block_Effect SHALL draw a ghost figure inside exactly one element marked `aria-hidden="true"` in the Block_Overlay's shadow root. The figure SHALL be built only from inline SVG elements or CSS-styled elements, and its bottom edge SHALL be at or above the top edge of the rendered message. The Screenshot_Checklist checks that it reads as a ghost.
3. WHERE `figure` is `none`, THE Block_Effect SHALL draw no figure, and the Block_Overlay's shadow root SHALL contain no element marked `aria-hidden="true"`.
4. WHERE `detail` is a non-empty string, THE Block_Effect SHALL render a second line as the only `p` element in the Block_Overlay's shadow root. Its top edge SHALL be at or below the bottom edge of the rendered message, and its `textContent` SHALL equal `detail` with every `{duration}` replaced by the Duration_Text for the meter named by `durationMeter` (default `timeOnSite`).
5. WHERE `detail` is absent, an empty string, or not a string (default `""`), THE Block_Effect SHALL render no second line, and the Block_Overlay's shadow root SHALL contain no `p` element.
6. WHEN `apply` is called with a live Block handle, THE Block_Effect SHALL update the message and the second line from the current params and the current meter value on the same Block_Overlay before `apply` returns. It SHALL NOT create a second Block_Overlay or figure, and SHALL NOT replay the Fade_In.
7. WHEN the Block_Effect creates the Block_Overlay while Reduced_Motion is false and `fadeInMs` is greater than 0, THE Block_Effect SHALL play the Fade_In once and SHALL schedule no timer for it. During the Fade_In, the figure, the message, and the second line go from their own opacity 0 to their own opacity 1 over `fadeInMs` milliseconds, and they stay at opacity 1 afterwards. `fadeInMs` defaults to 1500, and any value outside its valid set in Requirement 6 criterion 6 is treated as 1500.
8. WHEN the Block_Effect creates the Block_Overlay while Reduced_Motion is true or `fadeInMs` is 0, THE Block_Effect SHALL show the figure, the message, and the second line at their own opacity 1 when `apply` returns, with no animation or transition on them.
9. WHILE the Fade_In runs, THE Block_Overlay SHALL keep its inline opacity equal to `maxOpacity × intensity` and its `pointer-events` set by `blockAt`, as in criterion 10.
10. THE Block_Overlay SHALL keep its existing contract: a `div` with `data-poltergeist="block"` and `role="status"`, a direct child of `documentElement`, fixed with all insets 0 at z-index 2147483647, with computed `filter` and `backdrop-filter` of `none`, inline opacity equal to `maxOpacity × intensity` rounded to 3 decimal places, and `pointer-events` `auto` exactly when intensity is at least `blockAt` and `none` otherwise.
11. THE Block_Overlay SHALL have an open shadow root and no child elements. Its `textContent` SHALL be exactly equal to `message`, with no placeholder in `message` replaced. The figure and the second line SHALL exist only inside that shadow root.
12. WHILE the Block_Overlay's computed `pointer-events` is `auto`, THE Block_Overlay SHALL be the element that `document.elementFromPoint` returns at the viewport centre, including when the figure, the message, or the second line covers that point.
13. WHEN undone, THE Block_Effect SHALL make `documentElement.outerHTML` and the `style` attributes of `html` and `body` equal to their values before the first apply. This SHALL happen within the same call when `durationMs` is 0 or absent, and exactly `durationMs` milliseconds after the call when `durationMs` is greater than 0, as before the Polish_Change.
14. IF `undo` is called while the Fade_In is still running, THEN THE Block_Effect SHALL restore the page with the same result and timing as criterion 13, and SHALL leave no running animation once the page is restored.

### Requirement 3: Tombstone finale - SKELETON

**User Story:** As a Graveyard user returning to a long-abandoned tab, I want the tombstone to look like weathered stone and rise into view, so that the moment is clear on screen.

#### Acceptance Criteria

1. WHERE `weathered` is true (the default, also used for any non-boolean value), THE Tombstone_Effect SHALL draw the Tombstone_Card with a stone texture in which every background image is a CSS gradient, and with at least one crack or chipped section along the card's outline that contains no text characters.
2. WHERE `weathered` is false, THE Tombstone_Effect SHALL draw the Tombstone_Card with the background colour, border, and corner shape used before the Polish_Change, with no gradient and no crack or chipped section; the text and card sizes SHALL follow criterion 5.
3. WHERE `mark` is a non-empty string (default `R.I.P.`, also used for any non-string value), THE Tombstone_Effect SHALL show `mark` as literal text, without `{title}` or `{duration}` replacement, in an element that comes before the `h1` in the Tombstone_Card and renders with its bottom edge at or above the heading's top edge, and SHALL update that text on every `apply`.
4. WHERE `mark` is an empty string, THE Tombstone_Effect SHALL render no mark element, and SHALL remove any mark element that an earlier `apply` rendered.
5. THE Tombstone_Effect SHALL give the mark, heading, message, and button computed font sizes, and the Tombstone_Card a maximum width and padding, that are identical at the same viewport size on a page whose root font size is 10 CSS pixels and on a page whose root font size is 32 CSS pixels.
6. WHILE `document.visibilityState` is `visible`, WHEN `apply` creates the Tombstone_Card with Reduced_Motion false and `riseInMs` greater than 0 (default 800; any value outside its valid set in Requirement 6 criterion 6 is treated as 800), THE Tombstone_Effect SHALL start the Rise_In at once as a single iteration lasting `riseInMs` milliseconds, and SHALL not play it again for that handle on later applies or visibility changes.
7. WHEN `apply` creates the Tombstone_Card with Reduced_Motion true or `riseInMs` equal to 0, THE Tombstone_Effect SHALL show the card at once in its final position with its own opacity at 1, and SHALL start no animation or transition on the card or the Tombstone_Host, whatever the document's visibility.
8. WHILE the Rise_In runs, THE Tombstone_Host SHALL keep its inline `opacity` equal to `maxOpacity × intensity` to 3 decimal places, its inline `pointer-events` at `auto` when intensity is at least `blockAt` and `none` otherwise, and its inline `transition` and `animation` empty, so that the Rise_In moves and fades only the Tombstone_Card.
9. WHEN `apply` runs, THE Tombstone_Effect SHALL request no timeout, interval, or animation frame for the Rise_In or any other new visual, so that the number of pending timers after `apply` equals the number before it.
10. THE Tombstone_Host SHALL have no light-DOM child nodes, and its shadow root SHALL contain exactly one `h1`, one `p`, and one `button`, whose `textContent` SHALL equal the filled heading, the filled message, and `actionLabel`; the mark and the decorations SHALL use other element types placed outside those three elements, and every element other than those three, the mark, and any `style` element SHALL contain no text.
11. THE Tombstone_Effect SHALL keep the behaviour of tab-graveyard-app Requirement 4 criteria 1 to 9, with criterion 5 extended by Requirement 1 of this document, and SHALL follow tab-graveyard-app Requirement 4 criterion 10 as amended by Requirement 9 criterion 2 of this document.
12. WHEN `document.visibilityState` first becomes `visible` after `apply` created the Tombstone_Card while the document was not visible, with Reduced_Motion false and `riseInMs` greater than 0, THE Tombstone_Effect SHALL start the Rise_In as a single iteration lasting `riseInMs` milliseconds, and SHALL start no Rise_In while the document stays not visible.
13. WHEN `undo` is called while the Rise_In is running or waiting for the document to become visible, THE Tombstone_Effect SHALL remove the Tombstone_Host as in tab-graveyard-app Requirement 4 criterion 9, at once when `durationMs` is 0 and after `durationMs` milliseconds otherwise, leaving `documentElement.outerHTML` byte-for-byte as before the first `apply`, with no Rise_In running and no Rise_In started by a later visibility change.
14. WHERE `weathered` is true, THE Tombstone_Effect SHALL keep a WCAG 2 contrast ratio of at least 4.5:1 between the text colour of the mark, heading, and message and each colour of the stone texture behind that text, with semi-transparent colours composited over the card's base colour.

### Requirement 4: Fog tint and drifting texture - SKELETON

**User Story:** As a viewer of the demo, I want fog to look like fog, so that the effect does not read as the screen dimming.

#### Acceptance Criteria

1. WHERE `tint` is a non-empty string (default: the faint green-grey value fixed in the design), THE Fog_Effect SHALL tint the Fog_Overlay with the `tint` colour at an opacity equal to intensity, clamped to 0 to 1, multiplied by the maximum tint opacity fixed in the design, so that the tint is fully transparent at intensity 0 and at that maximum at intensity 1.
2. WHERE `noise` is a number greater than 0 and at most 1 (default: the value fixed in the design), THE Fog_Effect SHALL show on the Fog_Overlay a noise texture made only from CSS gradients, at an opacity of `noise × intensity`, with intensity clamped to 0 to 1.
3. WHERE `noise` is greater than 0, WHILE Reduced_Motion is false and `driftMs` is greater than 0 (default 20000), THE Fog_Effect SHALL move the noise texture in Drift cycles that repeat without end, each lasting `driftMs` milliseconds and ending with the texture in the same visual position as at the cycle's start.
4. WHERE `noise` is greater than 0, WHILE Reduced_Motion is true or `driftMs` is 0, THE Fog_Effect SHALL show the noise texture at a fixed position with no running animation.
5. WHEN `apply` is called with a live Fog handle, THE Fog_Effect SHALL read Reduced_Motion again, start the Drift if Reduced_Motion has become false, stop the Drift if Reduced_Motion has become true, and leave a Drift that is already running uninterrupted, without restarting its cycle.
6. THE Fog_Effect SHALL keep the Fog_Overlay's `backdrop-filter` value `blur(<maxBlur × intensity>px) grayscale(<maxGrayscale × intensity>)`, with defaults `maxBlur` 6 and `maxGrayscale` 1, the blur rounded to 2 decimal places, and the grayscale rounded to 3 decimal places, as before the Polish_Change.
7. WHERE `tint` is an empty string and `noise` is 0, THE Fog_Effect SHALL render only the `backdrop-filter`, as before the Polish_Change: the Fog_Overlay SHALL have no child nodes, no background, and no running animation, and the Fog_Effect SHALL add no other element to the page.
8. WHEN undone with `durationMs` greater than 0, THE Fog_Effect SHALL, starting in the undo call, fade the tint opacity, the noise opacity, the blur, and the grayscale linearly to 0 over the same `durationMs` milliseconds, keep the Fog_Overlay in the page until `durationMs` milliseconds have passed, and then remove the Fog_Overlay.
9. WHEN undone with `durationMs` absent or not greater than 0, including while a fade-out from an earlier undo is still running, THE Fog_Effect SHALL, before the undo call returns, stop the Drift and remove the Fog_Overlay, the tint, the noise texture, and every other element the Fog_Effect added.
10. THE Fog_Overlay SHALL keep its existing contract: exactly one `div[data-poltergeist="fog"]` per live Fog handle, a direct child of `documentElement`, fixed with all insets 0, `pointer-events` `none`, and z-index 2147483645.
11. WHEN `apply` is called with a live Fog handle, THE Fog_Effect SHALL set the tint opacity and the noise opacity for the new intensity on the same Fog_Overlay element and SHALL create no second Fog_Overlay.
12. THE Fog_Effect SHALL let pointer input pass through the tint and the noise texture, so that a hit test at the viewport centre never returns the Fog_Overlay or any of its descendants.

### Requirement 5: Visible rot - SKELETON

**User Story:** As a viewer of the demo, I want rotted text to stand out on camera, so that the decay is visible at video resolution.

#### Acceptance Criteria

1. WHERE `rotColor` is a non-empty string (default: the faded, discoloured value fixed in the design) and Text_Range_Styling is available, THE Rot_Effect SHALL render every Rotted_Character with `rotColor` as its text colour, including when the Rot_Effect runs in an app's content script in Chrome.
2. WHEN an apply or an observer pass finishes, THE Rot_Effect SHALL style exactly the Rotted_Characters in text nodes that are connected to the document and still hold the Rot_Effect's latest written data, using the `rotColor` of the latest apply.
3. THE Rot_Effect SHALL style Rotted_Characters without inserting, removing, or wrapping nodes under `body` and without changing an attribute of any page element.
4. THE Rot_Effect SHALL write the same text node data as before the Polish_Change for the same params, intensity, and page, whatever the value of `rotColor` and whether Text_Range_Styling is available, unavailable, or throws.
5. IF `env.window` has no `CSS.highlights` registry or no `Highlight` constructor, the document has no `documentElement`, or a Text_Range_Styling call throws, THEN THE Rot_Effect SHALL rot text as before the Polish_Change, SHALL leave no `CSS.highlights` entry and no element of its own after that apply or observer pass, and SHALL raise no error.
6. WHERE `rotColor` is an empty string, WHEN an apply finishes, THE Rot_Effect SHALL hold no `CSS.highlights` entry and no element of its own, including when an earlier apply on the same handle used a non-empty `rotColor`.
7. WHEN `undo` is called with a live Rot handle, THE Rot_Effect SHALL, in the same call, delete every `CSS.highlights` entry it added, remove every element it added under `documentElement`, and restore text as before the Polish_Change, and SHALL raise no error if the page has already removed that entry or element.
8. THE `skeleton/effects/rot.js` module SHALL keep exporting exactly `apply`, `undo`, and `description`.
9. WHILE the env has no `MutationObserver` or the document has no `documentElement`, THE Rot_Effect SHALL rot and restore text as before the Polish_Change and SHALL raise no error.
10. THE Rot_Effect SHALL add at most one `CSS.highlights` entry per live handle, under a name that was not in the registry before the Rot_Effect added it, and SHALL never replace, change, or delete a `CSS.highlights` entry that it did not add.

### Requirement 6: Rules shared by all new visuals - SKELETON

**User Story:** As a skeleton maintainer, I want the polish to keep the haunt contract, so that no page is left broken and users who ask for reduced motion get no new motion.

#### Acceptance Criteria

1. THE Polish_Change SHALL place every new visual inside an effect's own elements that are direct children of `documentElement` (the Fog_Overlay, the Block_Overlay, the Tombstone_Host, or a style element that an effect appends there), SHALL add no node under `head` or `body`, SHALL add no stylesheet to `document.adoptedStyleSheets`, and SHALL set no style or attribute on `html` or `body`.
2. THE new visuals SHALL load no resource: the CSS text, attribute values, and style property values that the effects set SHALL contain no `url()`, `image-set()`, `@import`, or `@font-face`, the effects SHALL create no `<img>`, no SVG `<image>`, and no element with an `href` or `src` attribute, and applying any of the four effects SHALL cause no network request.
3. THE Block_Effect, THE Tombstone_Effect, THE Fog_Effect, and THE Rot_Effect SHALL create new elements only with `createElement` or `createElementNS`, SHALL set all text with `textContent`, and SHALL NOT use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `DOMParser`, `createContextualFragment`, or `document.write`.
4. THE Fog_Effect and THE Rot_Effect SHALL accept a non-empty `tint` or `rotColor` string as a colour only if the string contains no `\`, `;`, `{`, or `}`, contains none of `var(`, `env(`, `attr(`, or `url(` in any letter case, and reads back non-empty after being assigned through the CSSOM to the `color` property of the inline style of an element that is not attached to the document. Each effect SHALL then set an accepted colour only through a CSSOM property setter, as the whole value of one colour property (for example `backgroundColor` on a Fog tint layer, or `color` on the `style` of the Rot `::highlight()` rule). It SHALL never write the colour into the text of a style element, into a `cssText` string, or into a larger value such as a gradient.
5. WHEN the Block_Effect or the Tombstone_Effect creates its element while Reduced_Motion is true, or WHEN the Fog_Effect applies while Reduced_Motion is true, THE effect SHALL start no Entrance_Animation and no Drift. Every element that effect created SHALL then have a computed `animation-name` of `none` and no running animation while its handle is live.
6. IF a param introduced by this spec is present with a value outside its valid set below, including `null`, THEN THE effect that reads the param SHALL use the param's default, SHALL raise no error, and SHALL render the rest of the effect as specified. These sets apply wherever Requirements 1 to 5 test a param's value, so `driftMs` 500 uses the default 20000 and `fadeInMs` 20000 uses the default 1500. The valid sets are:
   - `figure`: `ghost` or `none`.
   - `detail`, `mark`, `durationSuffix`, and `durationMeter`: any string.
   - `weathered`: a boolean.
   - `fadeInMs` and `riseInMs`: a finite number from 0 to 10000.
   - `driftMs`: 0, or a finite number from 1000 to 600000.
   - `noise`: a finite number from 0 to 1.
   - `durationScale`: a finite number greater than 0.
   - `tint` and `rotColor`: any string. A non-empty string that fails the check in criterion 4 follows criterion 10 instead of falling back to the default.
7. WHEN an `undo` with `durationMs` 0 returns, or WHEN the finish step of a fade-out has run, THE effect SHALL have removed every element, event listener, timer, animation frame request, running animation, and Text_Range_Styling registration that its new visuals added, so that the Restoration_Suite page snapshot equals the snapshot taken before the first `apply`. A second `undo` on the same handle SHALL change nothing and raise no error.
8. WHEN the Fog_Effect or the Block_Effect is applied and then undone with `durationMs` 0 using an env that contains only `document` and `reducedMotion`, as the skeleton browser suite does, THE effect SHALL raise no error for both values of `reducedMotion`, SHALL insert `a while` for every `{duration}` in the Block `detail`, and SHALL leave the page as it was before `apply`.
9. THE Polish_Change SHALL, under `skeleton/`, change only `fog.js`, `rot.js`, `block.js`, `tombstone.js`, and `util.js` in `skeleton/effects/`, SHALL add only helper modules in `skeleton/effects/` that export no `apply`/`undo`/`description` effect, and SHALL add or change only test files under `skeleton/test/`. `git diff` SHALL show `engine.js`, `match.js`, `meters.js`, `validator.js`, `rule-schema.json`, `index.js`, `effects/index.js`, and `flicker.js` unchanged.
10. IF a non-empty `tint` or `rotColor` string fails the check in criterion 4, THEN THE Fog_Effect or THE Rot_Effect SHALL behave as if that param were an empty string (Requirement 4 criterion 7, Requirement 5 criterion 6), SHALL add no CSS rule or declaration for the value, and SHALL raise no error. For example, `rotColor` `red}body{display:none` and `tint` `red;background:url(https://example.com/x.png)` SHALL leave the computed style of every page element unchanged and SHALL cause no network request.
11. WHEN `apply` is called on a live handle while Reduced_Motion is true, THE Block_Effect and THE Tombstone_Effect SHALL end any running Entrance_Animation at its final state (full opacity, final position) before `apply` returns, and SHALL NOT restart it on a later `apply`.
12. WHILE Reduced_Motion is true, WHEN `undo` is called with `durationMs` greater than 0, THE Block_Effect, THE Tombstone_Effect, and THE Fog_Effect SHALL play the existing fade-out as their only transition. The fade-out SHALL change only opacity and, for the Fog_Overlay, the `backdrop-filter` values, with no change of position, size, or transform, and SHALL finish after `durationMs` milliseconds (0 to 10000, as `validateRules` allows). This applies to both apps; Requirement 9 criterion 1 states the same exemption for Tab Graveyard.

### Requirement 7: Demo-time durations in the demo profiles - APP

**User Story:** As the person recording the demo, I want each app's Demo_Mode to label durations as demo time, so that viewers see realistic durations and know they are simulated.

#### Acceptance Criteria

1. WHEN `graveyardCreateDemoProfile` builds the Demo_Profile, THE Demo_Builder SHALL set `durationScale` to 3600 and `durationSuffix` to the Demo_Suffix in the effect params of every Duration_Rule, replacing any value already present, in addition to dividing trigger `threshold` and `rampTo` by 3600 as before.
2. WHEN `doomscrollCreateDemoProfile` builds the Demo_Profile, THE Demo_Builder SHALL set `durationScale` to 60 and `durationSuffix` to the Demo_Suffix in the effect params of every Duration_Rule, replacing any value already present, in addition to dividing trigger `threshold` and `rampTo` by 60 as before.
3. THE Demo_Builder SHALL output every rule that is not a Duration_Rule, and every property of a Duration_Rule other than `durationScale` and `durationSuffix`, exactly as it did before the Polish_Change, including a Block or Tombstone rule whose params omit `durationMeter` and rely on the effect's default meter, which therefore gets neither `durationScale` nor `durationSuffix`.
4. THE Demo_Builder SHALL leave the Normal_Profile deep-equal to its value before the call, and changing any param of the returned Demo_Profile, including `durationScale` or `durationSuffix`, SHALL leave the Normal_Profile unchanged.
5. THE Normal_Profile of each app SHALL contain no `durationScale` and no `durationSuffix` param in any rule, so that Normal_Profile duration text is the Duration_Formatter output with no suffix, as before the Polish_Change.
6. THE Demo_Profile of each app, built from that app's Normal_Profile, SHALL be reported valid by `validateRules` with `builtinEffects`, with an empty error list.
7. WHILE Demo_Mode is on, WHEN the Graveyard Tombstone_Effect renders with the `timeAway` meter at 33 seconds, THE Tombstone_Effect SHALL show the message text exactly `Abandoned for 33 hours (demo time).`
8. WHILE Demo_Mode is on, WHEN the Doomscroll Block_Overlay renders with the `timeOnSite` meter at 20 seconds, THE Block_Effect SHALL show the second line text exactly `You lost 20 minutes (demo time) to this feed.`
9. IF a rule is `null` or not an object, has no `effect` object, has `effect.params` that is missing, `null`, an array, or any other non-object value, or has a `durationMeter` that is not a string, THEN THE Demo_Builder SHALL treat the rule as not a Duration_Rule, add no param to it, raise no error, and still return the Demo_Profile, leaving any rejection of the rule to `validateRules`.
10. THE Normal_Profile of each app SHALL contain exactly one Duration_Rule, and that rule SHALL name `durationMeter` explicitly: `doomscroll-block` with `timeOnSite` in Doomscroll (Requirement 8 criterion 1) and `graveyard-tombstone` with `timeAway` in Graveyard (kept by Requirement 8 criterion 3), so that no rule that fills `{duration}` relies on the default `durationMeter` of the Block_Effect or the Tombstone_Effect.

### Requirement 8: App rules, validators, and generated skeletons - PACKAGING

**User Story:** As a maintainer, I want both apps to use the new params and still pass their package checks, so that the demo build is the build that ships.

#### Acceptance Criteria

1. THE Doomscroll `rules.json` rule `doomscroll-block` SHALL add `detail` with the value `You lost {duration} to this feed.` and `durationMeter` with the value `timeOnSite` to its `effect.params`, and SHALL keep `maxOpacity` 0.96, `blockAt` 0.8, and `message` `You have scrolled long enough. Close this tab and take a break.`
2. THE `rules.json` of each app SHALL set every new visual param explicitly in `effect.params`, with the values fixed in the design: `tint`, `noise`, and `driftMs` on `doomscroll-fog` and `graveyard-fog`; `rotColor` on `doomscroll-rot` and `graveyard-rot`; `figure` and `fadeInMs` on `doomscroll-block`; and `weathered`, `mark`, and `riseInMs` on `graveyard-tombstone`. `durationScale` and `durationSuffix` SHALL stay absent, as Requirement 7 criterion 5 states.
3. THE `rules.json` of each app SHALL keep the same rules in the same order, with no rule added or removed, and SHALL keep each rule's `id`, `description` (where present), `enabled`, `match`, `trigger`, `undo`, `effect.type`, and every existing `effect.params` key and value as before the Polish_Change.
4. THE Doomscroll `doomscroll-flicker` rule SHALL stay deep-equal to its value before the Polish_Change and SHALL gain no param.
5. THE `EXPECTED_RULES` in each Package_Validator SHALL list, for every rule, the same `effect.params` keys in the same order and with the same values as that app's updated `rules.json`, because the validator compares params as serialized JSON. A missing, extra, or changed param SHALL then make the Package_Validator report its existing error indicating that the rule's effect type or params differ from expected.
6. WHEN `npm run build:skeletons` runs, THE Skeleton_Sync SHALL replace each Generated_Skeleton with byte-identical copies of every file under the root `skeleton/` directory except `skeleton/test/`, including any new helper module, and SHALL exit with code 0 with both Package_Validators reporting no errors.
7. THE `web_accessible_resources` resource list of each app's `manifest.json` SHALL contain exactly `rules.json` plus every module reachable through static `import` and `export ... from` edges from `skeleton/index.js` in that app's Generated_Skeleton, so that a new helper module on that graph is listed and no unreachable or test file is listed.
8. THE Polish_Change SHALL change no `manifest.json` field other than the `web_accessible_resources` resource list, and SHALL change that list only by adding the modules that criterion 7 requires.
9. WHEN `npm run check:skeletons` runs on the committed tree after the Polish_Change, THE Skeleton_Sync SHALL find no missing, extra, or changed file in either Generated_Skeleton, SHALL get no errors from either Package_Validator, and SHALL exit with code 0.
10. THE Polish_Change SHALL change only the `EXPECTED_RULES` values in the Package_Validators, SHALL leave `scripts/package-checks.mjs`, `scripts/sync-skeleton.mjs`, and `scripts/sync-doomscroll-skeleton.mjs` unchanged, and SHALL add no exception, allowlist, or skipped path to any package check.
11. WHERE the Block_Effect or the Tombstone_Effect creates SVG elements, THE effect SHALL use the SVG namespace string `http://www.w3.org/2000/svg` only as the namespace argument of `createElementNS`. The string SHALL never appear as an `import` or `export ... from` specifier, inside a `url()` value, or as an `href`, so that the unchanged import-graph check reports no remote import for it.

### Requirement 9: Amendments to the tab-graveyard-app spec - DOCS

**User Story:** As a maintainer, I want the Graveyard spec to state the new animation rule, so that the specs and the code agree.

#### Acceptance Criteria

1. THE Polish_Change SHALL replace the text of tab-graveyard-app Requirement 2 criterion 8 with the following text, ending with the marker `(amended by haunt-polish)`: "THE app SHALL NOT use the `flicker` effect. THE app's only animations and transitions SHALL be the fade-out on undo, the Fog Drift, and the Tombstone Rise_In defined in the haunt-polish spec. WHILE the user's `prefers-reduced-motion` preference is `reduce`, THE app's only animation or transition SHALL be the fade-out on undo. WHILE Demo_Mode is on, THE Tombstone SHALL fill `{duration}` with the Away_Time multiplied by the Demo_Time_Scale and followed by ` (demo time)`, as defined in haunt-polish Requirements 1 and 7 (for example `Abandoned for 33 hours (demo time).` after 33 seconds away). WHILE Demo_Mode is off, THE Tombstone `{duration}` text SHALL be the same as before haunt-polish."
2. THE Polish_Change SHALL replace the text of tab-graveyard-app Requirement 4 criterion 10 with the following text, ending with the marker `(amended by haunt-polish)`: "WHEN applied without a live Handle while `env.reducedMotion` is false and `riseInMs` is greater than 0, THE Tombstone_Effect SHALL play the Rise_In defined in the haunt-polish spec once. WHEN applied without a live Handle while `env.reducedMotion` is true or `riseInMs` is 0, THE Tombstone_Effect SHALL show no animation. WHEN applied with a live Handle, THE Tombstone_Effect SHALL NOT replay the Rise_In or start any other animation. WHEN applied, THE Tombstone_Effect SHALL schedule no timer."
3. THE Polish_Change SHALL add a note beginning `Reason (haunt-polish):` directly after each criterion replaced under criteria 1 and 2. Each note SHALL say that the 3-minute demo video must show the Graveyard finale clearly, that a tombstone that appears in a single frame is easy to miss on camera, and that `prefers-reduced-motion` remains the safeguard, so users who ask for reduced motion see no new motion. The note after Requirement 2 criterion 8 SHALL also say that Demo_Mode durations are labelled `(demo time)` so that viewers see realistic durations and know they are simulated.
4. THE Polish_Change SHALL add a note beginning `Note (haunt-polish):` directly after tab-graveyard-app Requirement 4 criterion 12, without changing that criterion's text. The note SHALL say that the criterion limited only that spec's own skeleton changes, and that haunt-polish deliberately changes the Fog, Rot, Block, and Tombstone visuals while leaving Flicker, `engine.js`, and `match.js` unchanged.
5. THE Polish_Change SHALL change no other text in the tab-graveyard-app `requirements.md`, `design.md`, or `tasks.md` beyond the replacements and notes listed in the other criteria of this requirement.
6. THE Polish_Change SHALL add a note beginning `Note (haunt-polish):` directly after tab-graveyard-app Requirement 4 criterion 5, without changing that criterion's text. The note SHALL say that haunt-polish Requirement 1 extends the criterion with `durationScale` and `durationSuffix`, that the inserted text is unchanged when both params are absent (as in the Normal_Profile), and that in Demo_Mode the Tombstone shows demo time instead of seconds (for example `33 hours (demo time)` after 33 seconds away).
7. THE Polish_Change SHALL add a note beginning `Note (haunt-polish):` directly after Property 4 in tab-graveyard-app `design.md`. The note SHALL say that the `graveyard-tombstone` rule is a Duration_Rule, so its Demo_Profile copy also gains `durationScale` 3600 and `durationSuffix` set to the Demo_Suffix. It SHALL also say that the property as written holds for every rule without a string `durationMeter`, and that these are the only rules its test generator produces.
8. THE Polish_Change SHALL add a note beginning `Note (haunt-polish):` directly after the "no animation" item in the "Constraints for every task" list of tab-graveyard-app `tasks.md`. The note SHALL say that haunt-polish allows the Fog Drift and the Tombstone Rise_In, and that neither plays while `prefers-reduced-motion` is `reduce`.

### Requirement 10: Verification - TEST

**User Story:** As a maintainer, I want unit evidence for the new params and a checklist for the visual pass, so that the day ends with a demo-ready build and no regressions.

#### Acceptance Criteria

1. THE Polish_Change SHALL add no property-based tests (no new `fast-check` import and no new `fc.assert` call in any test file), and SHALL add Vitest example-based tests that check the behaviour defined in Requirements 1 to 5 for the default and for one valid override of every new param (Block_Effect: `figure`, `detail`, `durationMeter`, `fadeInMs`; Tombstone_Effect: `weathered`, `mark`, `riseInMs`; both Block_Effect and Tombstone_Effect: `durationScale`, `durationSuffix`; Fog_Effect: `tint`, `noise`, `driftMs`; Rot_Effect: `rotColor`), and these Duration_Text cases: `33 hours (demo time)` (Requirement 1 criterion 8), `20 minutes (demo time)` (Requirement 1 criterion 9), and, for both effects, `a while` with no suffix when `env.readMeter` is missing or returns `NaN`, a scale of 1 when `durationScale` is 0, -1, or the string `"60"`, and an empty suffix when `durationSuffix` is not a string.
2. THE Polish_Change SHALL add Vitest example-based tests that call each Demo_Builder on its app's `rules.json` and show that the Duration_Rule (`doomscroll-block` or `graveyard-tombstone`) gains `durationScale` 60 (Doomscroll) or 3600 (Graveyard) and `durationSuffix` equal to the Demo_Suffix, that every other rule and every other param equals the Normal_Profile apart from the divided trigger times, that a Block or Tombstone rule whose params have no string `durationMeter` gains neither param, and that the Normal_Profile deep-equals a copy taken before the call; each app's existing "passes every package check" test SHALL remain the evidence that its Package_Validator returns no errors for the updated `rules.json`.
3. THE existing unit and browser tests SHALL pass with no edits except the ones listed here, including the Restoration_Suite's 24-order test, Doomscroll Property 2, and Graveyard Property 4:
   - In `skeleton/test/tombstone.test.js`, the test "shows no animation and schedules no timers when applied" SHALL be rewritten to check the amended tab-graveyard-app Requirement 4 criterion 10 with the observation rule in criterion 8: a Rise_In when Reduced_Motion is false and `riseInMs` is the default, no animation when Reduced_Motion is true, no animation when `riseInMs` is 0, and `vi.getTimerCount()` equal to 0 after `apply` in all three cases.
   - In `app2-tab-graveyard/test/browser/return-resurrect.pw.js` and `app2-tab-graveyard/test/browser/discard-reload.pw.js`, the demo Tombstone message assertion, and the comments saying the duration is worded in seconds, SHALL change to expect `Abandoned for N hours (demo time).` with N between 24 and ceil(A) + 1 inclusive, where A is the absence in seconds that each test already measures for its upper bound. When ceil(A) + 1 is 48 or more, the assertion SHALL also accept `Abandoned for D days (demo time).` with D between 2 and floor((ceil(A) + 1) / 24) inclusive.
   - No other test file changes. These tests stay as they are, and the new visuals must keep them passing: `app1-doomscroll/test/browser/doomscroll.pw.js` (the Block_Overlay `textContent` equals the rule's `message`, and a hit test at the viewport centre returns the Block_Overlay); `app1-doomscroll/test/browser/pause-resume.pw.js` (at most one light-DOM `[data-poltergeist]` element per effect kind, two for `flicker`, and none after pause); `skeleton/test/browser/effects.pw.js` (the Block_Overlay's computed opacity equals `maxOpacity × intensity` right after `apply`); the unedited assertions of `return-resurrect.pw.js` (after Resurrect, `documentElement.outerHTML` equals its value before the haunt); and the shadow-root lookups of exactly one `h1`, one `p`, and one `button` in `skeleton/test/tombstone.test.js`, `skeleton/test/index.test.js`, and the Graveyard browser tests.
4. WHEN the Polish_Change is complete, THE final check SHALL run these commands from the repository root, in this order, and each SHALL exit with code 0: `npm test`, which runs `check:graveyard` as `pretest`, then `check:doomscroll`, then `vitest --run`; `npm run build:skeletons`, after which `git status --porcelain` SHALL list no modified, deleted, or untracked file in either Generated_Skeleton; and `npm run test:browser`, which runs the `skeleton-effects`, `doomscroll-extension`, and `graveyard-extension` Playwright projects.
5. THE final task SHALL contain the Screenshot_Checklist. The reviewer takes it by hand in Chrome with Demo_Mode on and marks each item as taken or records the defect seen. Doomscroll times count visible seconds since Demo_Mode was turned on with the page in front, and Graveyard times are absences from the tab. A light page has a mostly light background and a dark page a mostly dark one, for example the same site in its light and dark theme.
   - Doomscroll on an approved host, 3 to 5 seconds in: Fog with tint and texture, on one light and one dark page.
   - Doomscroll, 13 to 19 seconds in: Rot with coloured Rotted_Characters, on one light and one dark page.
   - Doomscroll, 25 to 59 seconds in: the Block finale with the ghost, the large message, and the second line `You lost N minutes (demo time) to this feed.`
   - Doomscroll, with `prefers-reduced-motion: reduce` emulated in DevTools before the Block appears: the Block finale at full opacity at once, with no Fade_In.
   - Graveyard on any `http` or `https` page, after an absence of 2 to 3 seconds: Fog.
   - Graveyard, after an absence of 8 to 12 seconds: Rot.
   - Graveyard, after an absence of 24 to 47 seconds: the Tombstone finale with the stone texture, the cracked edge, the `R.I.P.` mark, the page title, and `Abandoned for N hours (demo time).`
   - Graveyard, with `prefers-reduced-motion: reduce` emulated in DevTools on the tab before returning to it: the Tombstone_Card in its final position at full opacity at once, with no Rise_In.
   - Graveyard: the page after Resurrect, with no Fog, Rot, or Tombstone left.
6. THE Screenshot_Checklist SHALL also ask the reviewer to watch, with no DevTools animation slow-down, one full Fade_In (1.5 seconds by default), one full Rise_In (0.8 seconds by default), and one full Drift cycle (20 seconds by default), and to record either `none` or each stutter (a visible jump or pause in the motion) or clipping (part of the ghost, message, second line, Tombstone_Card, or noise texture cut off) seen.
7. THE Polish_Change SHALL add Vitest example-based tests showing that the Fade_In, the Rise_In, and the Drift each play when Reduced_Motion is false and the duration param (`fadeInMs`, `riseInMs`, or `driftMs`) has its default value, do not play when Reduced_Motion is true, do not play when the duration param is 0, and, for the Drift, stop on a re-apply with Reduced_Motion true and start again on a re-apply with Reduced_Motion false.
8. THE Polish_Change's Vitest tests SHALL treat a Fade_In, Rise_In, or Drift as playing exactly when, right after `apply`, the element the design animates for that motion has a CSS `animation` that names a `@keyframes` rule in a style element the effect owns, or the effect has called `animate()` on that element (spied in the test, because jsdom provides no `animate()`), with a duration equal to the duration param in milliseconds and with one iteration for the Fade_In and the Rise_In or infinite iterations for the Drift; and SHALL treat it as not playing exactly when that element's `animation` is empty or `none` and the effect has made no `animate()` call on it, because jsdom runs no animation.
9. THE Polish_Change SHALL add Vitest example-based tests showing that, with a test stub of Text_Range_Styling installed (jsdom provides none), the styled ranges after an apply and after an observer pass cover exactly the Rotted_Characters and an undo leaves no styled range and no element that the Rot_Effect added; that, with no Text_Range_Styling, apply and undo raise no error; and that in both cases the text node data equal the data written with `rotColor` set to an empty string.
