# Kiro hooks

## build-doomscroll-on-skeleton-save.json

Runs `npm run build:doomscroll` after Kiro saves a root production skeleton file:
direct files under `skeleton/` and anything under `skeleton/effects/`. It does not
fire for `skeleton/test/**` or the generated `app1-doomscroll/skeleton/**`. The
matcher is a single anchored regex (no lookaround) that accepts relative paths and
absolute paths under a `poltergeist/` checkout directory, with `/` or `\` separators.
If the checkout directory is renamed, update the matcher.

Limits:

- It only runs when Kiro emits the save event. Manual saves, other editors, git
  operations, and external tools may not trigger it.
- It is a convenience. It does not replace `npm run build:doomscroll`,
  `npm run check:doomscroll`, or the drift failure in `npm test`.
- It holds no copy logic. The build script is the single authority.

Matcher coverage is tested in `app1-doomscroll/test/hook.test.js`.

## new-effect.json

File: `.kiro/hooks/new-effect.json` (the Effect_Hook). It is a `PostFileCreate` hook
with an `agent` action. When Kiro creates `skeleton/effects/<name>.js`, the hook
injects a fixed prompt that asks Kiro to follow `.kiro/steering/haunt-authoring.md`
and finish the wiring in order: register the effect in `skeleton/effects/index.js`,
document its params in `skeleton/rule-schema.json`, add restoration and
reduced-motion tests, run `npm run build:skeletons`, and add the effect to the
effect list in `README.md`. If the new file exports no `apply` function (for
example `skeleton/effects/util.js` or another helper), the prompt tells Kiro to
stop without creating, editing or deleting any file.

The matcher is a single anchored regex with no lookaround:
`^(?:.*[\\/]poltergeist[\\/]|\.[\\/])?skeleton[\\/]effects[\\/][^\\/]+\.js$`.

Accepted paths, with `/` or `\` separators:

- `skeleton/effects/<name>.js`
- `./skeleton/effects/<name>.js`
- absolute paths where `skeleton/` is a direct child of a workspace folder named
  `poltergeist`, for example `C:\Users\me\poltergeist\skeleton\effects\<name>.js`

Excluded paths:

- `skeleton/test/**`
- `skeleton/ritual/**` (the Candle Path generator is not an effect)
- every generated skeleton copy, such as `app1-doomscroll/skeleton/effects/*.js`,
  `app2-tab-graveyard/skeleton/effects/*.js` and `demo-site/skeleton/effects/*.js`
- subfolders of `skeleton/effects/`, such as `skeleton/effects/sub/<name>.js`
- files that do not end in `.js`, such as `skeleton/effects/<name>.ts`

Like the Doomscroll hook, the matcher relies on the checkout folder being named
`poltergeist`. If the checkout is renamed, update the matcher.

Limits:

- It fires only on file-create events Kiro emits. Files created outside Kiro, for
  example from a terminal, by git, or in another editor, do not trigger it.
- The prompt is fixed text with no variables, so it tells Kiro to open the file it
  just created and take `<name>` from that file's base name.

## check-rules-on-save.json

File: `.kiro/hooks/check-rules-on-save.json` (the Rules_Hook). It is a
`PostFileSave` hook with a `command` action that runs `node scripts/rules-hook.mjs`
(timeout 120 seconds). The script finds the saved `rules.json` path in the event
JSON on STDIN, looks up the registered app in `scripts/app-registry.json` whose
folder directly contains that file, and runs only that app's Package_Check. It
exits with the check's code. It is read-only and never changes the saved file.

The matcher is `(?:^|[\\/])rules\.json$` (no lookaround).

Accepted paths: any relative or absolute path whose last segment is exactly
`rules.json`, with `/` or `\` separators, for example `app1-doomscroll/rules.json`
or `C:\Users\me\poltergeist\app2-tab-graveyard\rules.json`.

Excluded paths:

- names that only end in `rules.json`, such as `myrules.json`
- names with an extra suffix, such as `rules.json.bak`

A matched path that is not directly inside a registered app folder (for example a
`rules.json` in a subfolder, a generated skeleton, or outside the repository)
prints `rules-hook: <path> is not directly inside a registered app folder; nothing
to check.` and exits 0. Apps added to the registry by the scaffolder are picked up
on the next save with no hook edit. This matcher does not depend on the
`poltergeist` folder name, so a renamed checkout needs no matcher update.

Limits:

- It fires only on save events Kiro emits. Files saved from a terminal, by git, or
  in another editor do not trigger it.
- It is a convenience. It does not replace `npm run check:<key>` or `npm test`.
