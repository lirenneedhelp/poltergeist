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
