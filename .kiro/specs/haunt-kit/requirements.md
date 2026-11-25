# Requirements Document

## Introduction

Haunt Kit turns the Poltergeist skeleton into a template that other developers can use to build their own habit-breaking Chrome extensions. Doomscroll and Tab Graveyard already reuse the skeleton. This spec makes a third haunt quick to build and adds one interactive ritual, Candle Path, as the showcase.

The work is ordered so that the showcase is finished before the rest:

1. Kiro authoring workflow: a steering doc and two agent hooks (Requirements 1 to 3).
2. The `ritual` effect, Candle Path, created through the new effect hook, and Doomscroll's new finale (Requirements 4 to 11).
3. The `new-haunt` scaffolder (Requirements 12 and 13).
4. The Haunt Playground in `demo-site/` (Requirement 14).
5. README sections (Requirement 15).

Requirement 16 covers compatibility with everything that already exists. The task list must have about 14 tasks at most, with the authoring workflow first and the ritual second.

Decisions recorded in this document:

1. **Doomscroll is the only app whose behaviour changes.** Its finale gains the ritual (Requirement 10). Tab Graveyard's behaviour does not change. Its manifest gains the new skeleton modules in `web_accessible_resources` only because its Package_Validator requires the exposed list to equal the modules reachable from `skeleton/index.js` (Requirement 11).
2. **`timeOnSite` becomes resettable.** Today `meters.reset` accepts only `timeAway`. Doomscroll needs to set `timeOnSite` back to 0 so that the engine's normal tick undoes every rule with that rule's own undo mode, which is what "fades all effects" means here. `engine.stop()` undoes with duration 0, so restarting the instance would remove effects instantly and is rejected. `scrollDistance` and `timeSinceActive` stay non-resettable.
3. **Allowed edits to existing tests.** Every existing unit and browser test keeps passing. The only edits allowed are to assertions that pin a list this spec deliberately extends: the built-in effect registry (`restoration.test.js` "has exactly the five built-in effects"), the meters that `reset` rejects (`meters.test.js`, which lists `timeOnSite`), Doomscroll's exact rule list and undo list (`app1-doomscroll/test/package.test.js`), either app's exposed file list, the registered app list and the `npm test` script. Edits are also allowed to assertions that pin the ritual's default instructions, status text or veil opacity, which the Candle Path playtest amendment changes: `skeleton/test/ritual.test.js`, `test/packaging.test.js` (the `params-ritual` instructions default) and `app1-doomscroll/test/browser/finale.pw.js` (the start and done status). The design must name each edited test and the reason.
4. **The ritual draws its own fog.** Effects do not know about each other, so the ritual cannot thin the Fog_Effect's overlay. The ritual draws a Ritual_Veil inside its own overlay and thins that veil as squares fill.
5. **The Candle Path generator lives outside `skeleton/effects/`.** It is not an effect, so the Effect_Hook must not fire for it. It lives at `skeleton/ritual/candle-path.js`.
6. **Playground copies.** GitHub Pages publishes `demo-site/` on its own, so `demo-site/` cannot import the root `skeleton/`. The Skeleton_Sync writes a committed copy to `demo-site/skeleton/` and the rule presets to `demo-site/presets/`, and the drift check in `npm test` covers both.
7. **Fallback.** If Candle Path does not meet Requirements 5 to 8 by the end of its task, the Hold_Ritual ships instead under the same contract (Requirement 9), and the decision is recorded.

Change markers: `AUTHORING` changes `.kiro/`; `SKELETON` changes shared code under `skeleton/`; `APP` changes app code; `PACKAGING` changes rules, validators, manifests, scripts or generated copies; `SITE` changes `demo-site/`; `DOCS` changes documentation; `TEST` covers verification.

Verification: Vitest example-based unit tests, the existing restoration and browser suites, new Playwright tests for the Doomscroll finale and the Playground, and a manual load of a generated app in Chrome. This spec adds no property-based tests. Where a criterion says "for each of a fixed list of seeds", the test loops over a hard-coded list of example seeds.

Out of scope: changes to the behaviour of Tab Graveyard, Fog, Flicker, Rot, Block or Tombstone; changes to `engine.js` or `match.js`; rituals other than Candle Path and the Hold_Ritual fallback; publishing the Playground (the page is only made ready for GitHub Pages); Chrome Web Store packaging.

## Glossary

- **Skeleton**: the root `skeleton/` directory, the single source of truth for the engine, meters, validator, rule schema and effects.
- **Generated_Skeleton**: a committed copy of the Skeleton's production files (everything except `skeleton/test/`) inside an app folder or `demo-site/`, written by the Skeleton_Sync.
- **Skeleton_Sync**: `scripts/sync-skeleton.mjs`, which builds and drift-checks every Generated_Skeleton and runs each registered app's Package_Validator.
- **App_Registry**: the single list of registered apps that the Skeleton_Sync reads. Today it is the `APPS` object in `scripts/sync-skeleton.mjs`, with the keys `doomscroll` and `graveyard`.
- **Package_Validator**: an app's build-time validator, for example `scripts/validate-doomscroll-package.mjs`, exporting `validatePackage(repoRoot)`.
- **Package_Check**: `npm run check:<appKey>`, which drift-checks one app's Generated_Skeleton and then runs its Package_Validator.
- **Doomscroll**, **Graveyard**: the apps in `app1-doomscroll/` and `app2-tab-graveyard/`.
- **Demo_Mode**: an app's global preference that divides every trigger `threshold` and `rampTo` by 60 (Doomscroll and Generated_Apps).
- **Fog_Effect**, **Block_Effect**, **Tombstone_Effect**: the existing effects in `skeleton/effects/fog.js`, `block.js` and `tombstone.js`.
- **Restoration_Suite**: `skeleton/test/restoration.test.js`.
- **Effect_Contract**: the rules every effect module follows, listed in Requirement 1 criterion 2.
- **Ritual_Contract**: the rules every ritual effect follows, listed in Requirement 1 criterion 4.
- **Steering_Doc**: `.kiro/steering/haunt-authoring.md`.
- **Effect_Hook**: the Kiro agent hook that fires when a file is created directly under `skeleton/effects/`.
- **Rules_Hook**: the Kiro agent hook that fires when an app's `rules.json` is saved.
- **Ritual_Effect**: the effect module `skeleton/effects/ritual.js`, registered as `ritual`.
- **Candle_Path**: the grid puzzle the Ritual_Effect shows: one continuous path through every cell that passes numbered candles in order.
- **Generator**: the pure module `skeleton/ritual/candle-path.js` that builds Candle_Path boards and checks paths.
- **Board**: a Generator result: `size`, the ordered list of solution cells (`solution`), and the candles, each with a number and a cell.
- **Cell**: a grid position `{ row, col }` with 0 ≤ row, col < `size`.
- **Adjacent**: two Cells that differ by exactly 1 in exactly one of row or col.
- **Player_Path**: the ordered list of Cells the user has drawn on the Board.
- **Path_End**: the last Cell of the Player_Path.
- **Lit_Count**: the number of candles on the Player_Path.
- **Filled_Count**: the number of Cells on the Player_Path (the Player_Path's length). S is the number of Cells on the Board, `size`².
- **Ritual_Host**: the `div[data-poltergeist="ritual"]` element the Ritual_Effect appends to `documentElement`, with an open shadow root.
- **Ritual_Veil**: the fog layer inside the Ritual_Host's shadow root, behind the Board, that thins as squares fill.
- **Banishing_Ending**: the short ending the Ritual_Effect plays on completion, in which a ghost figure dissolves.
- **Exorcised_Action**: the call `env.onAction('exorcised')`.
- **Hold_Ritual**: the fallback ritual of Requirement 9, in which the user holds a button to light three candles.
- **Reduced_Motion**: the value of `env.reducedMotion` when an effect reads it, derived by `startPoltergeist` from the `prefers-reduced-motion: reduce` media query.
- **Trusted_Event**: a DOM event whose `isTrusted` is `true`. Events dispatched by page scripts are not Trusted_Events.
- **Restored_State**: `documentElement.outerHTML` and the `style` attributes of `html` and `body` exactly equal to their values before the first `apply`.
- **Scaffolder**: the script run by `npm run new-haunt <name>`.
- **Haunt_Name**: the `<name>` argument of the Scaffolder.
- **Generated_App**: the app folder the Scaffolder creates.
- **Generic_Validator**: the Package_Validator shared by every Generated_App, `scripts/validate-app-package.mjs`.
- **Playground**: the static page `demo-site/index.html` and the files it loads from `demo-site/`.
- **Preset**: a rules file in `demo-site/presets/` copied from an app's `rules.json` by the Skeleton_Sync.
- **README**: the repository's root `README.md`.

## Requirements

### Requirement 1: Haunt authoring steering doc - AUTHORING

**User Story:** As a developer writing a new effect with Kiro, I want the effect, meter and ritual rules in one steering doc, so that Kiro follows them without me repeating them.

#### Acceptance Criteria

1. THE Steering_Doc SHALL exist at `.kiro/steering/haunt-authoring.md` and SHALL begin with front matter that sets `inclusion: fileMatch` and a `fileMatchPattern` matching exactly these paths: any file under `skeleton/effects/`, any file under `skeleton/ritual/`, and any file named `rules.json` in any folder, so that Kiro includes the Steering_Doc only when one of those files is in context and never as an always-included or manual-only doc.
2. THE Steering_Doc SHALL contain a section headed "Effect contract" that states each of these rules as a separate list item: (a) an effect lives in `skeleton/effects/<name>.js` and exports `apply(env, params, intensity, handle)`, `undo(handle, { durationMs })` and a string `description`; (b) `undo` reaches the Restored_State synchronously when `durationMs` is 0 and no later than `durationMs` milliseconds after the call otherwise; (c) a second `undo` on the same handle changes nothing and throws nothing; (d) every visual is inside elements the effect created that are direct children of `documentElement`; (e) the effect sets no style or attribute on `html` or `body` and adds no node under `head` or `body`; (f) the effect calls no `chrome.*` API; (g) while Reduced_Motion is true the effect starts no CSS animation, CSS transition, `requestAnimationFrame` loop or repeating timer; (h) every param has a default, and a param of the wrong type or outside the range documented in `skeleton/rule-schema.json` uses the default; (i) all text is set with `textContent`, never with `innerHTML` or any other HTML parsing; (j) the effect loads no resource (no network request, image, font, script or stylesheet URL).
3. THE Steering_Doc SHALL contain a section headed "Meter rules" that states each of these rules as a separate list item: (a) every meter name defined in `skeleton/rule-schema.json`, each with its unit; (b) effects read meters only through `env.readMeter`; (c) only app code resets meters, only through `meters.reset`, and only `timeAway` and `timeOnSite` are resettable; (d) rules escalate through `threshold` and `rampTo`, and in each app the rule with the lowest `threshold` never uses the `block` or `tombstone` effect.
4. THE Steering_Doc SHALL contain a section headed "Ritual contract" that states each of these rules as a separate list item: (a) a ritual is an effect that follows every Effect_Contract rule; (b) the ritual ignores every event that is not a Trusted_Event; (c) on completion the ritual plays its ending and then makes the Exorcised_Action exactly once; (d) while Reduced_Motion is true the ritual skips its ending and makes the Exorcised_Action in the same task as the completing input; (e) the ritual closes no tab, calls no navigation API, registers no `beforeunload` handler, and does not read or depend on what the app does after the Exorcised_Action; (f) `undo` removes every element, event listener, timer and audio node the ritual created.
5. THE Steering_Doc SHALL contain a section headed "Adding an effect" with a numbered list of these steps in this order: (1) create `skeleton/effects/<name>.js` under the Effect_Contract, (2) register the effect in `skeleton/effects/index.js`, (3) document the effect and its params in `skeleton/rule-schema.json`, (4) add restoration and reduced-motion tests to the Restoration_Suite, (5) run `npm run build:skeletons`, (6) update the README.
6. WHEN `npm test` runs, THE Vitest suite SHALL include an example-based test that reads the Steering_Doc and fails if the front matter patterns differ from criterion 1, if the set of meter names listed under "Meter rules" differs from the set defined in `skeleton/rule-schema.json`, or if the resettable meters it lists differ from the meters `meters.reset` accepts.

### Requirement 2: New-effect hook - AUTHORING

**User Story:** As a developer, I want Kiro to finish the wiring whenever I create an effect file, so that a new effect is never half-registered.

#### Acceptance Criteria

1. THE Effect_Hook SHALL be one JSON file in `.kiro/hooks/`, in the same `version` and `hooks` format as the existing hook files, that declares exactly one hook with a `PostFileCreate` trigger and an action of type `agent`.
2. THE Effect_Hook matcher SHALL match a path that names a file ending in `.js` whose parent directory is the root `skeleton/effects/`, given as `skeleton/effects/<name>.js`, as `./skeleton/effects/<name>.js`, or as an absolute path in which `skeleton` is a direct child of the workspace root, with `/` or `\` separators; and SHALL NOT match files under `skeleton/test/`, files under `skeleton/ritual/`, files under any Generated_Skeleton (for example `app1-doomscroll/skeleton/effects/<name>.js` or `demo-site/skeleton/effects/<name>.js`), files in subfolders of `skeleton/effects/`, or files in `skeleton/effects/` that do not end in `.js`.
3. WHEN the Effect_Hook fires, THE Effect_Hook prompt SHALL refer to the created file as `skeleton/effects/<name>.js`, state that this is the file Kiro just created and that `<name>` is that file's base name, and ask Kiro, following the Steering_Doc, to do these steps in order: register the new effect in `skeleton/effects/index.js` under the file's base name unless that name is already registered; add the effect to `skeleton/rule-schema.json`; add a restoration test to the Restoration_Suite and a reduced-motion test for the effect; rebuild every Generated_Skeleton with `npm run build:skeletons` instead of editing any Generated_Skeleton by hand; and update the README.
4. IF the Effect_Hook fires for a file that exports no `apply` function, including `skeleton/effects/util.js`, THEN THE Effect_Hook prompt SHALL tell Kiro to stop without creating, editing or deleting any file.
5. THE `.kiro/hooks/README.md` SHALL contain a section for the Effect_Hook that names the Effect_Hook file, describes the paths its matcher accepts and excludes per criterion 2, and states that the hook fires only on file-create events Kiro emits, so files created outside Kiro (for example from a terminal, by git, or in another editor) do not trigger it.
6. THE test suite run by `npm test` SHALL include example-based Vitest tests that read the Effect_Hook file, assert its trigger is `PostFileCreate` and its action type is `agent`, assert its matcher matches `skeleton/effects/<name>.js` with `/` separators, the same path with `\` separators, and an absolute path under the workspace root, and assert it does not match one example path for each excluded location in criterion 2.

### Requirement 3: Rules-save hook - AUTHORING

**User Story:** As a developer tuning rules, I want the right package check to run when I save an app's rules, so that a bad rule shows up at once.

#### Acceptance Criteria

1. THE Rules_Hook SHALL be a file in `.kiro/hooks/` with a `PostFileSave` trigger and a command action.
2. THE Rules_Hook matcher SHALL match a saved file whose name is exactly `rules.json`, with `/` or `\` separators and as a repo-relative or absolute path, and SHALL NOT match any other file name.
3. WHEN `rules.json` directly inside a registered app folder is saved, THE Rules_Hook SHALL run that app's Package_Check and only that one, where a registered app folder is the `dir` of an App_Registry entry relative to the repository root, and a `rules.json` in a subfolder of that `dir` is not directly inside it.
4. WHEN the Package_Check run by the Rules_Hook passes, THE Rules_Hook SHALL exit with code 0.
5. IF the Package_Check run by the Rules_Hook fails, THEN THE Rules_Hook SHALL exit with a non-zero code, print the Package_Check errors, and leave the saved `rules.json` unchanged.
6. IF the saved `rules.json` is not directly inside a folder in the App_Registry, THEN THE Rules_Hook SHALL run no Package_Check and SHALL exit with code 0.
7. WHEN the Scaffolder registers a Generated_App in the App_Registry, THE Rules_Hook SHALL run the Generated_App's Package_Check on the next save of the Generated_App's `rules.json` with no edit to the hook file, by reading the App_Registry each time the Rules_Hook runs.
8. THE test suite SHALL check with example-based tests that the Rules_Hook maps `app1-doomscroll/rules.json` and `app1-doomscroll\rules.json` to `doomscroll`, `app2-tab-graveyard/rules.json` to `graveyard`, and `demo-site/presets/doomscroll.json` and `app1-doomscroll/skeleton/rules.json` to no app, and that the Rules_Hook exits non-zero when the mapped app's Package_Check fails.

### Requirement 4: Candle Path generator - SKELETON

**User Story:** As the Ritual_Effect, I want a pure generator of solvable boards, so that every ritual can be finished.

#### Acceptance Criteria

1. THE Generator SHALL be a module at `skeleton/ritual/candle-path.js` that imports only relative modules under `skeleton/`, uses no DOM and no `chrome.*` API, and exports `generateBoard({ size, candles, random })` and `checkPath(board, path)`.
2. WHEN `generateBoard` is called, THE Generator SHALL return a new Board whose `size` and candle count are integers and whose `solution` contains every Cell of the `size` × `size` grid exactly once, with every pair of consecutive Cells Adjacent, and SHALL NOT modify the options object passed to it.
3. WHEN `generateBoard` is called with `candles` N, THE Generator SHALL place exactly N candles numbered 1 to N, each on a different Cell of `solution`, with candle 1 on the first Cell of `solution`, candle N on the last Cell, and candle numbers increasing along `solution`.
4. WHERE `size` and `candles` are absent (`undefined`), THE Generator SHALL use `size` 5 and `candles` 5.
5. IF `size` is not an integer from 3 to 7, or `candles` is not an integer from 2 to the smaller of 9 and `size` × `size`, THEN THE Generator SHALL use the default for that param and SHALL raise no error, resolving `size` first and checking `candles` against the resolved `size`.
6. WHERE `random` is a function returning numbers from 0 (inclusive) to 1 (exclusive), THE Generator SHALL use `random` as its only source of randomness, so that the same `random` sequence returns a deeply equal Board.
7. WHEN `checkPath(board, path)` is called, THE Generator SHALL return true exactly when `path` contains every Cell of the Board once, every pair of consecutive Cells is Adjacent, the first Cell holds candle 1, the last Cell holds candle N, and the candles appear along `path` in number order, and SHALL return false otherwise, without modifying `board` or `path`.
8. THE Generator unit tests SHALL check, for each of a fixed list of seeds and for each `size` from 3 to 7, that `checkPath(board, board.solution)` is true, that the candles are in `solution` order, and that the Board has the requested `size` and candle count, and SHALL check that the fixed seed list yields at least two different `solution` orders for `size` 5.
9. THE Generator unit tests SHALL check that `checkPath` returns false for an empty path, a path that skips a Cell, repeats a Cell, makes a non-Adjacent step, starts on a Cell other than candle 1, ends on a Cell other than candle N, or reaches the candles out of order.
10. IF `random` is absent or is not a function, THEN THE Generator SHALL use the language's built-in random source and SHALL raise no error.
11. IF `path` is not an array, or contains a Cell whose `row` or `col` is not an integer from 0 to `size` − 1, THEN THE Generator `checkPath` SHALL return false and SHALL raise no error.

### Requirement 5: Ritual overlay - SKELETON

**User Story:** As a user who has scrolled too long, I want a full-page candle puzzle in front of the page, so that leaving the feed takes a small deliberate act.

#### Acceptance Criteria

1. THE Ritual_Effect SHALL be created through the Effect_Hook, live at `skeleton/effects/ritual.js`, be registered as `ritual` in `skeleton/effects/index.js`, and export `apply`, `undo` and a string `description`.
2. WHEN `apply` is called without a live handle, THE Ritual_Effect SHALL append exactly one Ritual_Host as the last child of `documentElement`, with inline `position: fixed`, `top`, `right`, `bottom` and `left` all 0, and `z-index` 2147483647, and SHALL build a new Board with the Generator from the `size` and `candles` params.
3. THE Ritual_Host SHALL have zero light-DOM child nodes, and the Board, the Ritual_Veil, the candles, the Reset button, the Hint button and the Banishing_Ending SHALL exist only inside the Ritual_Host's open shadow root.
4. THE Ritual_Effect SHALL show, inside the shadow root, the `heading` text, the `instructions` text, the Board as `size` rows of `size` Cells with each candle's number as the text of its Cell, the Player_Path, a `button` element labelled Reset, a `button` element labelled Hint, and a status line in an element with `aria-live="polite"` whose text follows criteria 12 and 13.
5. THE Ritual_Effect SHALL accept the params `heading`, a string of 1 to 200 characters (default `Light the candles to banish the ghost`); `instructions`, a string of 1 to 300 characters (default `Draw one path through every square, passing the candles in order. Candle <N> must be your last square. Drag back to undo.`, where `<N>` is the Board's candle count, so that a Board with 5 candles shows `Candle 5 must be your last square.`); `size` (default 5); `candles` (default 5); `sound`, a boolean (default false); `maxOpacity`, a number from 0 to 1 (default 0.96); and `blockAt`, a number from 0 to 1 (default 1). THE Ritual_Effect SHALL use the default for each absent param, each value of the wrong type, each value outside these ranges, and each `size` or `candles` value outside the ranges in Requirement 4 criterion 5, and SHALL raise no error.
6. WHEN `apply` is called, THE Ritual_Effect SHALL clamp `intensity` to the range 0 to 1, treating a non-numeric `intensity` as 0, then set the Ritual_Host's inline `opacity` to `maxOpacity × intensity` rounded to 3 decimal places, and set its inline `pointer-events` to `auto` when the clamped intensity is at least `blockAt` and to `none` otherwise.
7. WHEN `apply` is called with a live handle, THE Ritual_Effect SHALL keep the same Ritual_Host element, Board and Player_Path, including when `size` or `candles` differ from the first call, and SHALL update only the opacity, `pointer-events`, heading text and instructions text.
8. WHEN the Ritual_Effect builds the Board or the Player_Path changes, THE Ritual_Effect SHALL, before the handling event returns, set the Ritual_Veil's inline opacity to `0.85 × (S − Filled_Count) / (S − 1)` rounded to 3 decimal places and set the status line text by criteria 12 and 13, so that the veil opacity is 0.85 with 1 square filled and reaches 0 only when the Player_Path covers every Cell, which the move rules of Requirement 6 allow only for a complete ritual.
9. THE Ritual_Effect SHALL draw candles, wax and smoke on a background whose red, green and blue channels are each at most 64 out of 255, and SHALL NOT contain the string `Zip` (case-insensitive) in any text, attribute value or class name inside the Ritual_Host.
10. THE Ritual_Effect SHALL create elements only with `createElement` or `createElementNS`, set all text with `textContent`, load no resource, and add no node under `head` or `body`.
11. WHERE the `instructions` param is a valid string by criterion 5, THE Ritual_Effect SHALL show that string exactly as given, and SHALL replace `<N>` with the Board's candle count only in the default `instructions` text.
12. WHILE candle N is not on the Player_Path, or Filled_Count equals S, THE Ritual_Effect SHALL show the status line text `<Lit_Count> of <N> candles · <Filled_Count> of <S> squares`, with a middle dot (U+00B7) and one space on each side of the dot, for example `3 of 5 candles · 14 of 25 squares`.
13. WHILE candle N is on the Player_Path and Filled_Count is less than S, THE Ritual_Effect SHALL show the status line text `Candle <N> must be last. Back up and fill the empty squares.`, with `<N>` replaced by the Board's candle count, in place of the count text of criterion 12.

### Requirement 6: Drawing the path - SKELETON

**User Story:** As a user, I want to draw the path with the mouse or the arrow keys, so that I can finish the ritual either way.

#### Acceptance Criteria

1. WHEN the Board is created, THE Ritual_Effect SHALL start the Player_Path as the single Cell of candle 1, with Lit_Count 1, Filled_Count 1, the status line `1 of <N> candles · 1 of <S> squares`, and the Ritual_Veil opacity 0.85.
2. WHEN the user moves from the Path_End to a Cell that is inside the grid, Adjacent to the Path_End, not on the Player_Path, and holds either no candle or the candle numbered Lit_Count + 1, THE Ritual_Effect SHALL append that Cell to the Player_Path.
3. WHEN the Player_Path changes by a move, retract, Reset or Hint, THE Ritual_Effect SHALL, before the event handler returns, show every candle on the Player_Path as lit and every other candle as unlit, expose each candle's lit or unlit state to assistive technology, set Lit_Count to the number of candles on the Player_Path and Filled_Count to the length of the Player_Path, and update the status line and the Ritual_Veil opacity from the new Lit_Count and Filled_Count as in Requirement 5 criteria 8, 12 and 13.
4. WHEN the user moves from the Path_End to the Cell immediately before the Path_End on the Player_Path, THE Ritual_Effect SHALL remove the Path_End from the Player_Path and unlight the candle on the removed Cell, if any.
5. IF the Player_Path is the single Cell of candle 1 and the user attempts a retract, THEN THE Ritual_Effect SHALL leave the Player_Path unchanged.
6. IF the user tries to move to a Cell that is outside the grid, is not Adjacent to the Path_End, is already on the Player_Path (other than the retract in criterion 4), or holds a candle other than candle Lit_Count + 1, THEN THE Ritual_Effect SHALL leave the Player_Path, Lit_Count, status line and Ritual_Veil unchanged and SHALL raise no error.
7. WHILE candle N is lit, THE Ritual_Effect SHALL accept only the retract move in criterion 4 and SHALL ignore every other move.
8. WHEN the user presses the primary pointer button on the Path_End and drags over Cells, THE Ritual_Effect SHALL treat each Cell the pointer enters as one move from the current Path_End to that Cell, until the button is released or the pointer is cancelled, including when the release happens outside the Board; a press on any Cell other than the Path_End SHALL start no drag.
9. WHILE the Board has keyboard focus, WHEN the user presses ArrowUp, ArrowDown, ArrowLeft or ArrowRight, THE Ritual_Effect SHALL treat the key as one move from the Path_End to the Cell one row or column in that direction, and SHALL call `preventDefault` on each such arrow key event, even when the move is rejected, and on no other key event.
10. WHEN the Ritual_Host's `pointer-events` changes from `none` to `auto` for the first time in the lifetime of a handle, THE Ritual_Effect SHALL give the Board keyboard focus, and SHALL NOT move focus again on later `apply` calls for that handle.
11. WHEN the user activates the Reset button, THE Ritual_Effect SHALL set the Player_Path back to the single Cell of candle 1 on the same Board, with the same `size`, `solution` and candle positions.
12. WHEN the user activates the Hint button, THE Ritual_Effect SHALL replace the Player_Path with the longest prefix of the Board's `solution` that the Player_Path starts with, plus the next Cell of `solution`; IF that prefix is already the whole `solution`, THEN THE Ritual_Effect SHALL leave the Player_Path unchanged.
13. IF a pointer, keyboard or click event is not a Trusted_Event, THEN THE Ritual_Effect SHALL ignore the event and leave the Player_Path, drag state and focus unchanged, as the Tombstone_Effect does for its button.
14. WHILE the Ritual_Effect handle is fading out after `undo` is called, or is undone, THE Ritual_Effect SHALL ignore every pointer, keyboard and click event.

### Requirement 7: Completion and Banishing_Ending - SKELETON

**User Story:** As a user who finishes the path, I want the ghost to dissolve and the haunt to know I'm done, so that finishing feels like a release.

#### Acceptance Criteria

1. WHEN a move makes the Player_Path contain every Cell of the Board with candle N lit, THE Ritual_Effect SHALL mark the ritual complete, show the status line `<N> of <N> candles · <S> of <S> squares`, and from then on leave the Player_Path unchanged for every pointer move, arrow key, Reset activation and Hint activation.
2. WHEN the ritual becomes complete while Reduced_Motion is false, THE Ritual_Effect SHALL play the Banishing_Ending inside the Ritual_Host's shadow root, in which a ghost figure fades from visible to opacity 0 over 1200 milliseconds, and SHALL make the Exorcised_Action, with the argument `'exorcised'`, no earlier than 1200 milliseconds and no later than 1300 milliseconds after completion.
3. WHEN the ritual becomes complete while Reduced_Motion is true, THE Ritual_Effect SHALL skip the Banishing_Ending, show the final lit Board with no animation, and make the Exorcised_Action before the event handler returns.
4. THE Ritual_Effect SHALL make the Exorcised_Action at most once per handle, including when `apply` is called again with the same handle or further Trusted_Events arrive after completion.
5. IF `undo` is called after completion but before the Exorcised_Action, THEN THE Ritual_Effect SHALL cancel the Banishing_Ending, remove its elements with the rest of the Ritual_Host, and SHALL NOT make the Exorcised_Action, even after 1300 milliseconds have passed.
6. IF `env.onAction` is not a function or throws, THEN THE Ritual_Effect SHALL call `console.error` with a first argument starting with `[poltergeist]`, raise no error from the event handler or timer, and keep the completed Board shown.
7. THE Ritual_Effect SHALL call no `chrome.*` API, call no `window.close`, change no `location`, and register no `beforeunload` or `unload` handler.
8. WHILE Reduced_Motion is true, THE Ritual_Effect SHALL start no animation or transition, and every element the Ritual_Effect created SHALL have a computed `animation-name` of `none`.
9. IF the ritual becomes complete while the handle is fading out, THEN THE Ritual_Effect SHALL ignore the completing input, play no Banishing_Ending and make no Exorcised_Action.

### Requirement 8: Ritual sound - SKELETON

**User Story:** As a developer, I want an optional chime when the last candle lights, so that the ending can be heard without shipping audio files.

#### Acceptance Criteria

1. WHERE `sound` is true, WHEN candle N lights for the first time on a handle, THE Ritual_Effect SHALL create one audio context and play one generated sound through the Web Audio API, scheduled to stop at most 1 second after it starts.
2. WHERE `sound` is true, THE Ritual_Effect SHALL create no audio context before candle N first lights, and SHALL play no further sound on that handle when candle N is retracted and lit again.
3. WHERE `sound` is false, absent, or any value other than the boolean true, THE Ritual_Effect SHALL create no audio context at any point in the handle's lifetime.
4. THE Ritual_Effect SHALL load no audio file and use no `url()`, `src` or `href` for sound.
5. IF the Web Audio API is undefined, or creating the audio context or playing the sound throws, THEN THE Ritual_Effect SHALL log the error with the `[poltergeist]` prefix, raise no error, and still complete the ritual and make the Exorcised_Action as in Requirement 7.
6. WHEN `undo` is called, THE Ritual_Effect SHALL stop any playing sound and close any audio context it created before `undo` returns, for any `durationMs`, and SHALL raise no error if stopping or closing fails.
7. THE Ritual_Effect unit tests SHALL check, with a stubbed audio context constructor, that exactly one context is created when candle N lights with `sound` true, that none is created with `sound` false or `"true"`, that completion still makes the Exorcised_Action when the constructor throws, and that `undo` closes the context.

### Requirement 9: Ritual restoration and fallback - SKELETON, TEST

**User Story:** As a user, I want the ritual to leave the page exactly as it was, so that a haunt never breaks a page.

#### Acceptance Criteria

1. WHEN `undo` is called with `durationMs` 0, absent, or not a finite number of at least 0, THE Ritual_Effect SHALL remove the Ritual_Host and every listener, timer, animation and audio node the Ritual_Effect created, and SHALL reach the Restored_State before the call returns.
2. WHILE Reduced_Motion is false, WHEN `undo` is called with a finite `durationMs` greater than 0, THE Ritual_Effect SHALL keep the Ritual_Host in the document while lowering its opacity to 0 over `durationMs` milliseconds, SHALL ignore every input event from the call onward, and SHALL reach the Restored_State no later than `durationMs` + 50 milliseconds after the call.
3. WHILE Reduced_Motion is true, WHEN `undo` is called with a finite `durationMs` greater than 0, THE Ritual_Effect SHALL set the Ritual_Host's opacity to 0 before the call returns with no animation or transition, SHALL keep the Ritual_Host in the document until `durationMs` milliseconds after the call, SHALL ignore every input event from the call onward, and SHALL reach the Restored_State no later than `durationMs` + 50 milliseconds after the call.
4. WHEN `undo` is called on a handle that has already been undone, THE Ritual_Effect SHALL make no DOM change, raise no error, and make no Exorcised_Action, as the existing effects do.
5. WHEN `undo` is called with a finite `durationMs` greater than 0 on a handle that is fading out, THE Ritual_Effect SHALL make no change to the running fade, raise no error, and make no Exorcised_Action.
6. WHEN `undo` is called with `durationMs` 0, absent, or not a finite number of at least 0 on a handle that is fading out, THE Ritual_Effect SHALL finish the fade and reach the Restored_State before the call returns, as in criterion 1, and SHALL make no Exorcised_Action.
7. THE Restoration_Suite (`skeleton/test/restoration.test.js`) SHALL include the Ritual_Effect in apply-then-undo tests for these cases: Reduced_Motion false; Reduced_Motion true; `undo` called 600 milliseconds into the 1200-millisecond Banishing_Ending; and `undo` with `durationMs` 300. Each test SHALL assert the Restored_State, that no `div[data-poltergeist="ritual"]` remains, and that no Exorcised_Action was made in the Banishing_Ending case.
8. THE unit tests SHALL dispatch untrusted `pointerdown`, `pointermove`, `keydown` (arrow keys, Space and Enter) and `click` events on a Board Cell, the Board, the Reset button and the Hint button, and SHALL check that the Player_Path, the Lit_Count and the status line are unchanged and that no Exorcised_Action is made.
9. IF any unit or Restoration_Suite test for Requirements 5 to 8 still fails when the Candle_Path task is closed, THEN THE Ritual_Effect SHALL instead show the Hold_Ritual: three candles and one hold button inside the Ritual_Host's shadow root, where each candle lights after 1000 milliseconds of continuous hold (pointer held on the button, or Space or Enter held while the button has focus), all lit candles go unlit if the hold is released before the third candle lights, and the ritual completes when the third candle lights, 3000 milliseconds into the hold.
10. WHILE the Hold_Ritual is shown, THE Ritual_Effect SHALL apply the `heading`, `instructions`, `sound`, `maxOpacity` and `blockAt` params, the same Exorcised_Action, the same Banishing_Ending, and the same restoration (criteria 1 to 7), Trusted_Event (criterion 8) and Reduced_Motion (Requirement 7 criterion 8) rules as Candle_Path, and SHALL ignore `size` and `candles`.
11. WHEN the Hold_Ritual ships instead of Candle_Path, THE decision and its reason SHALL be recorded in `KIRO_FILES.md` and in the design document.

### Requirement 10: Doomscroll finale - APP, PACKAGING

**User Story:** As a Doomscroll user, I want the block screen to lead into the ritual and finishing it to give me a fresh start, so that the finale is a pause and not a lock.

#### Acceptance Criteria

1. THE Doomscroll `rules.json` SHALL keep its four existing rules (`doomscroll-fog`, `doomscroll-flicker`, `doomscroll-rot`, `doomscroll-block`) unchanged and in their current order, and SHALL add as the fifth and last rule `doomscroll-ritual` with `enabled` true, the same three `match` hosts as the existing rules, trigger `{ "meter": "timeOnSite", "threshold": 1500 }` with no `rampTo`, effect `ritual` with params `{ "size": 5, "candles": 5, "sound": false }`, and undo `{ "mode": "fade", "durationMs": 600 }`.
2. WHILE Demo_Mode is on, THE Doomscroll demo profile builder SHALL divide the ritual rule's `threshold` by 60 like every other rule, so that the ritual appears at 25 seconds of demo time, no earlier than the Block_Effect blocking pointers (24 seconds, at `blockAt` 0.8) and reaching full intensity (25 seconds).
3. WHEN the Doomscroll content script starts an instance with `startPoltergeist`, THE Doomscroll content script SHALL pass an `onAction` callback, and THE callback SHALL make no state change and raise no error for any action name other than `exorcised`.
4. WHEN the Doomscroll content script receives `exorcised` from the current instance, in normal mode or in Demo_Mode, THE Doomscroll content script SHALL call `meters.reset('timeOnSite')` on that instance, keep the same instance running without calling `stop` or starting a new instance, and leave `scrollDistance` and `timeSinceActive` unchanged.
5. WHEN `timeOnSite` is reset, THE engine SHALL undo each active Doomscroll rule with that rule's own undo mode on its next tick, so that Fog fades over 400 milliseconds, Block and the ritual fade over 600 milliseconds, and Flicker and Rot are removed at once.
6. WHEN `timeOnSite` is reset, THE Doomscroll haunt SHALL start over from `timeOnSite` 0, so that Fog appears again 120 seconds later in normal mode and 2 seconds later in Demo_Mode, and a later pause and resume SHALL resume from the reset value and not from the value before the reset.
7. WHILE the ritual is shown, THE Doomscroll extension SHALL leave the tab closable, SHALL add no `beforeunload` handler, SHALL keep the manifest's `permissions` and `host_permissions` unchanged, and SHALL send no message that closes, reloads or navigates a tab.
8. THE meters module SHALL accept `reset('timeOnSite')`, set `timeOnSite` to 0 and return true, and SHALL return false and leave every meter unchanged for `scrollDistance`, `timeSinceActive` and any unknown name.
9. THE Doomscroll Package_Validator SHALL return an error naming the gap when the fifth rule is missing or differs from criterion 1 in any field, or when `skeleton/ritual/candle-path.js` or `skeleton/effects/ritual.js` is absent from `web_accessible_resources`.
10. THE Doomscroll Playwright suite SHALL include a test that, in Demo_Mode, waits for the Ritual_Host after the Block_Effect blocks pointers, makes trusted Hint clicks until the status line reads `5 of 5 candles · 25 of 25 squares`, checks that no `[data-poltergeist]` element remains within 2 seconds of the last click, and checks that the Fog_Effect's element is present again within 5 seconds of the last click.
11. IF `exorcised` arrives from an instance that is no longer the content script's current instance (after a pause, a Demo_Mode toggle or a disposal), THEN THE Doomscroll content script SHALL ignore the action and reset no meter on any instance.
12. IF `meters.reset('timeOnSite')` returns false or throws, THEN THE Doomscroll content script SHALL log the failure with the `[poltergeist:doomscroll]` prefix, raise no error, and keep the current instance running.
13. THE Doomscroll content script unit tests SHALL check, with example-based cases, criteria 3, 4, 11 and 12: an unknown action name, `exorcised` on the current instance, `exorcised` from a replaced instance, and a reset that returns false.

### Requirement 11: Packaging for both apps - PACKAGING

**User Story:** As a maintainer, I want both apps to ship the new modules through their generated copies, so that the skeleton stays the single source of truth.

#### Acceptance Criteria

1. WHEN `npm run build:skeletons` runs, THE Skeleton_Sync SHALL write `skeleton/effects/ritual.js` and `skeleton/ritual/candle-path.js` into every Generated_Skeleton (Doomscroll, Graveyard and `demo-site/skeleton/`) with content byte-for-byte equal to the Skeleton's files, and SHALL copy no file from `skeleton/test/`.
2. THE Doomscroll and Graveyard manifests SHALL each list in `web_accessible_resources` exactly the files reachable from `skeleton/index.js` plus `rules.json`, a set that includes `skeleton/effects/ritual.js` and `skeleton/ritual/candle-path.js`, and THE Package_Validator of each app SHALL fail and name any file that is missing from or extra in that list.
3. THE `skeleton/rule-schema.json` SHALL document the `ritual` effect and each of its params `heading`, `instructions`, `size`, `candles`, `sound`, `maxOpacity` and `blockAt`, with the default and allowed range from Requirement 5 criterion 5, in a `description` field, where the `instructions` `default` keyword is the default text with the letter N in place of `<N>` (`… Candle N must be your last square. Drag back to undo.`) and its `description` states that N is replaced by the Board's candle count, and SHALL keep `effect.properties.type` equal to `{ "type": "string" }`.
4. WHEN `npm test` runs, THE drift check SHALL compare every Generated_Skeleton with the Skeleton's production files before Vitest starts, and SHALL exit with a non-zero code and name each file that is missing, extra or different in content if any Generated_Skeleton differs.
5. THE Graveyard `rules.json`, `content.js`, `background.js`, `popup.html`, `popup.js` and `popup.css` SHALL NOT be changed by this spec, and THE Graveyard Package_Validator SHALL keep requiring exactly its three existing rules `graveyard-fog`, `graveyard-rot` and `graveyard-tombstone`.
6. THE unit tests SHALL check, as examples, that each app's Package_Validator reports an error naming `skeleton/effects/ritual.js` when that file is removed from the app's `web_accessible_resources`, and that the drift check fails when one line of a Generated_Skeleton's `skeleton/effects/ritual.js` is changed.

### Requirement 12: Scaffolder output - PACKAGING

**User Story:** As a developer starting a third haunt, I want one command that creates a working app, so that I only have to edit rules and hosts.

#### Acceptance Criteria

1. WHEN `npm run new-haunt <name>` runs with a Haunt_Name matching `^[a-z][a-z0-9-]{1,29}$`, THE Scaffolder SHALL create the folder `app<N>-<name>` under the root directory, where N is one more than the largest number among existing `app<number>-*` folders (so the next app is `app3-<name>`), or 1 if no such folder exists, print the created folder path, and exit with code 0.
2. IF the Haunt_Name does not match the pattern, equals an existing App_Registry key, or the target folder exists, or `--hosts` contains a value that is not a valid Chrome match pattern, or `--root` is not an existing directory, THEN THE Scaffolder SHALL print an error message naming the invalid input, exit with a non-zero code, and create no folder and write no file.
3. THE Scaffolder SHALL accept `--hosts <pattern,...>` with 1 to 20 comma-separated Chrome match patterns whose scheme is `http`, `https` or `*`, default `https://example.com/*`, and `--root <dir>`, default the repository root.
4. THE Generated_App SHALL contain `manifest.json`, `rules.json`, `content.js`, `background.js`, `popup.html`, `popup.js`, `popup.css`, a Generated_Skeleton in `skeleton/`, and starter tests in `test/`.
5. THE Generated_App manifest SHALL be Manifest V3 with `permissions` exactly `["storage"]`, `host_permissions` and content script `matches` equal to the hosts, one classic content script `content.js` at `document_idle` with `all_frames` false, a module service worker `background.js`, `popup.html` as the action popup, and one `web_accessible_resources` entry listing `rules.json` and exactly the modules reachable from `skeleton/index.js`, for the hosts, with `use_dynamic_url` false.
6. THE Generated_App `rules.json` SHALL pass `validateRules`, use the hosts as every rule's `match`, and contain a starter Fog rule and a starter Rot rule on `timeOnSite` with `rampTo` greater than `threshold`.
7. THE Generated_App content script SHALL load the Generated_Skeleton and `rules.json` with `chrome.runtime.getURL`, run the rules with `startPoltergeist`, stop the haunt while the tab is paused so that the page is in Restored_State, restart the haunt with time on site counted from 0 when pause is turned off, and divide every `threshold` and `rampTo` by 60 while Demo_Mode is on, reading Demo_Mode at page load.
8. THE Generated_App service worker SHALL store pause per tab in `chrome.storage.session` and Demo_Mode in `chrome.storage.local` under keys prefixed with the Haunt_Name, and SHALL accept control messages only from the Generated_App's own extension pages, ignoring messages from any other sender and leaving stored state unchanged.
9. WHEN the Generated_App popup opens, THE Generated_App popup SHALL show a Pause toggle reflecting the stored pause state of the current tab and a Demo toggle reflecting the stored Demo_Mode, setting all text with `textContent`, and SHALL store a toggle change before the popup closes.
10. THE Generated_App SHALL contain no site-specific DOM selectors, no remote code, no `eval`, no `new Function` and no inline scripts.
11. THE Generated_App starter tests SHALL be Vitest tests that check the package is valid, the rules validate, the demo profile divides thresholds by 60, and the service worker stores and returns pause and Demo_Mode state.
12. WHEN the Scaffolder exits with code 0, THE Generated_App SHALL pass the Generic_Validator and its own starter tests without any edits.
13. IF writing any Generated_App file fails after the folder is created, THEN THE Scaffolder SHALL delete the partly written `app<N>-<name>` folder, print an error message naming the file that failed, and exit with a non-zero code.
14. IF the Generated_App cannot read pause or Demo_Mode from storage, THEN THE Generated_App SHALL treat the tab as not paused and Demo_Mode as off.

### Requirement 13: Scaffolder wiring and tests - PACKAGING, TEST

**User Story:** As a developer, I want the new app covered by the same sync and checks as the existing apps, so that it cannot drift from the skeleton.

#### Acceptance Criteria

1. WHEN the Scaffolder succeeds, THE Scaffolder SHALL add one App_Registry entry keyed by the Haunt_Name with the Generated_App folder as `dir`, the Generic_Validator as `validator` and `build:<name>` as `buildScript`, and SHALL leave every existing App_Registry entry byte-identical.
2. WHEN the Scaffolder succeeds, THE Scaffolder SHALL add to `package.json` the script `build:<name>` running `node scripts/sync-skeleton.mjs --app <name>` and the script `check:<name>` running `node scripts/sync-skeleton.mjs --check --app <name>`, and SHALL leave every other `package.json` field unchanged.
3. WHEN `npm test` runs, THE test run SHALL drift-check and run the Package_Validator of every app in the App_Registry, run the Vitest tests of every app folder matching `app*/test/`, and exit non-zero if any drift check, Package_Validator or test fails.
4. WHEN the Generic_Validator runs on a Generated_App, THE Generic_Validator SHALL check the rules in Requirement 12 criteria 5, 6 and 10 and SHALL return `ok` true with an empty error list if every rule holds, or `ok` false with one error line per failed rule naming the offending file by its path relative to the app folder.
5. IF any Scaffolder step fails after a file was written, including the Generated_Skeleton build or the Generated_App's Package_Check, THEN THE Scaffolder SHALL delete the created app folder, restore `package.json` and the App_Registry file to byte-identical copies of their content before the run, print an error naming the failed step, and exit with a non-zero code.
6. THE Scaffolder tests SHALL generate an app into a temporary copy of the repository with `--root`, then check that the Generated_App's Package_Check exits 0, its starter Vitest tests pass, and no file in the real repository was created, modified or deleted.
7. THE Scaffolder tests SHALL check, with one example each, that an invalid Haunt_Name, a Haunt_Name equal to an existing App_Registry key, and an existing target folder each exit non-zero, create no file or folder, and leave `package.json` and the App_Registry byte-identical.
8. THE Scaffolder tests SHALL check, with one example in a temporary repository copy, that a failure forced after the first file write leaves no app folder and leaves `package.json` and the App_Registry byte-identical.
9. WHEN a Generated_App with no edits is loaded unpacked in Chrome, THE Generated_App SHALL load with no manifest errors and SHALL show the Fog_Effect on a page matching its hosts in Demo_Mode within its Fog rule's `threshold` divided by 60 plus 5 seconds; this is checked by hand once and recorded in `KIRO_FILES.md` with the date, the Chrome version and the result.

### Requirement 14: Haunt Playground - SITE, TEST

**User Story:** As a developer or a judge, I want to try haunts in a web page without installing anything, so that I can see the rules work in seconds.

#### Acceptance Criteria

1. THE Playground SHALL be static files in `demo-site/` with `index.html` as entry, loading only relative paths inside `demo-site/`, so that GitHub Pages can publish the folder as it is.
2. THE Skeleton_Sync SHALL write a Generated_Skeleton to `demo-site/skeleton/` and the Presets `demo-site/presets/doomscroll.json` and `demo-site/presets/graveyard.json` from the apps' `rules.json`, and the drift check in `npm test` SHALL cover these files.
3. THE Playground SHALL show a fake feed of at least 20 posts whose total height exceeds the browser window height, and run `startPoltergeist` from `demo-site/skeleton/index.js` on that page, with no extension and no `chrome.*` API.
4. WHEN the user activates the Apply button of the JSON rules editor and `validateRules` accepts the editor content, THE Playground SHALL first stop any running haunt so that every applied effect is undone and no `[data-poltergeist]` element remains, and then start a new haunt with that content.
5. IF the editor content is not valid JSON or `validateRules` rejects the content when the user activates Apply, THEN THE Playground SHALL show each error as a separate line of text, keep the running haunt and its effects unchanged, keep the editor content unchanged, and clear the error list on the next successful apply.
6. WHEN the Playground starts a haunt, THE Playground SHALL replace every rule's `match` with a pattern that matches the Playground's own URL in the rules passed to `startPoltergeist`, without changing the editor text.
7. THE Playground SHALL have a speed slider with integer steps from 1× to 600×, starting at 1× and showing its current value as text; WHEN the speed changes, THE Playground SHALL restart the haunt from the last rules `validateRules` accepted, with every `threshold` and `rampTo` divided by the speed.
8. THE Playground SHALL have Doomscroll and Tab Graveyard preset buttons that load the matching Preset into the editor and apply the Preset, and SHALL state on the page that the Graveyard Preset decays only while the Playground tab is hidden.
9. WHEN the user activates the "Try the ritual" button, THE Playground SHALL apply the Ritual_Effect at intensity 1, and WHEN the Exorcised_Action is made, THE Playground SHALL undo the Ritual_Effect so that no `[data-poltergeist="ritual"]` element remains and show a visible text message stating that the ritual is complete.
10. THE Playground SHALL set all user-visible text with `textContent` and contain no inline scripts, no remote code and no `eval`.
11. THE Playwright suite SHALL include one test, kept outside `demo-site/`, that serves `demo-site/` locally, loads the Playground, applies the Doomscroll Preset at 600×, and sees `[data-poltergeist="fog"]` appear within 10 seconds of applying the Preset.
12. IF a Preset file fails to load when the user activates a preset button, THEN THE Playground SHALL show an error as text naming the Preset and keep the editor content and the running haunt unchanged.

### Requirement 15: Documentation - DOCS

**User Story:** As a developer new to the kit, I want short guides, so that I can build a haunt and a ritual without reading the source.

#### Acceptance Criteria

1. THE README SHALL contain a level-2 heading with the exact text "Build your own haunt in 10 minutes", followed by numbered steps in this order: (a) running `npm run new-haunt <name> -- --hosts <pattern,...>`, with the `--` separator so that npm passes `--hosts` to the Scaffolder, (b) editing the Generated_App's `rules.json`, (c) running `npm test`, (d) loading the Generated_App folder in Chrome through `chrome://extensions` with Developer mode on and "Load unpacked", and (e) opening the Playground and trying the edited rules there, with every command shown in a code block.
2. THE README SHALL contain a level-2 heading with the exact text "Write your own ritual" whose section lists every rule of the Ritual_Contract from Requirement 1 criterion 4 as a separate bullet, and states that the ritual only makes the Exorcised_Action and the app decides what happens after `exorcised`.
3. THE "Write your own ritual" section SHALL contain one JavaScript code block of at most 40 lines that exports `apply`, `undo` and `description`, returns early from its event handler when the event is not a Trusted_Event, makes the Exorcised_Action exactly once, and uses no `innerHTML` and no `chrome.*` API.
4. THE "Write your own ritual" section SHALL suggest at least three other rituals, including a typed vow, a breathing timer and a riddle, each with one sentence stating what the user does to complete it.
5. THE README SHALL list every effect registered in `skeleton/effects/index.js`, including `ritual`, as one line per effect containing the effect's registered name and text equal to its `description` export, and SHALL list no effect that is not registered.

### Requirement 16: Compatibility - TEST

**User Story:** As a maintainer, I want everything that works today to keep working, so that the kit adds features without regressions.

#### Acceptance Criteria

1. WHEN `npm test` and `npm run test:browser` run on the branch that contains the Haunt Kit change, THE test runs SHALL exit with code 0, with every unit and browser test that existed before the change reporting pass and none skipped or deleted.
2. WHERE an existing test is edited, THE edit SHALL only change an assertion that pins one of the lists, or one of the ritual instructions, status or veil assertions, named in decision 3 of the Introduction, and THE design SHALL name each edited test file, the assertion and the reason.
3. THE files `skeleton/engine.js`, `skeleton/match.js`, `skeleton/effects/fog.js`, `flicker.js`, `rot.js`, `block.js` and `tombstone.js` SHALL be byte-identical to their versions on the base commit, in the Skeleton and in every Generated_Skeleton.
4. THE Graveyard's `rules.json`, `background.js`, `content.js`, `popup.html`, `popup.js`, `popup.css` and its existing browser test files SHALL be byte-identical to the base commit, and THE Graveyard `manifest.json` SHALL differ only by the `web_accessible_resources` entries that Requirement 11 requires.
5. WHEN `build:doomscroll`, `check:doomscroll`, `build:graveyard`, `check:graveyard`, `build:skeletons` or `check:skeletons` runs, THE script SHALL keep its name in `package.json`, exit with code 0 when the Generated_Skeletons are in sync and the Package_Validators pass, and exit with a non-zero code when any Generated_Skeleton has drifted or any Package_Validator fails.
6. WHEN `startPoltergeist` is called with an `effects` registry that does not contain `ritual` and with rules that do not reference `ritual`, THE skeleton SHALL start without throwing and SHALL apply and undo those rules exactly as it did before the Haunt Kit change.
7. IF `startPoltergeist` is called with rules that reference `ritual` and an `effects` registry that does not contain `ritual`, THEN THE skeleton SHALL throw the existing error whose message starts with `Invalid Poltergeist rules:` and contains, for each such rule, the line `rules[<i>].effect.type: must be one of [<registered effect names>]`, before creating the meters or the engine, so that the page is left with no effects applied.
8. WHEN `meters.reset` is called with `scrollDistance` or `timeSinceActive`, THE meters SHALL reject the call exactly as before the Haunt Kit change, as decision 2 of the Introduction requires.
