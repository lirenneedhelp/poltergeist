# Poltergeist Kit

**Try it now:** open the live [Playground](https://lirenneedhelp.github.io/poltergeist/) and haunt a sample feed in your browser, with nothing to install.

Poltergeist Kit is a skeleton for Chrome extensions that "haunt" websites to help break bad browsing habits. Nothing is blocked instantly: effects grow with the time you spend, and every effect can be undone, so a haunt never leaves a page permanently broken.

The shared code lives in `skeleton/`. Each app (`app1-doomscroll/`, `app2-tab-graveyard/`) is a `manifest.json`, a `rules.json` and its site matchers on top of that skeleton.

## Effects

- `fog`: Page blurs and loses colour; both scale with intensity.
- `flicker`: Page brightness stutters. With prefers-reduced-motion it becomes a static dim instead.
- `rot`: Characters in visible text decay into glyphs of dust; more of them as intensity grows.
- `block`: A full-page overlay that darkens with intensity and blocks interaction once intensity reaches blockAt.
- `tombstone`: A full-page tombstone naming the page and how long it was left, with one action button; blocks interaction once intensity reaches blockAt.
- `ritual`: A full-page candle puzzle: draw one path through every square, passing the numbered candles in order. Finishing it reports the "exorcised" action; blocks interaction once intensity reaches blockAt.

## Build your own haunt in 10 minutes

1. Create a new app with the scaffolder. Put `--` before `--hosts` so that npm passes the flag to the scaffolder instead of reading it itself.

   ```sh
   npm run new-haunt <name> -- --hosts <pattern,...>
   ```

   Each host must be a full Chrome match pattern with the scheme `http`, `https` or `*`. A bare domain such as `www.reddit.com` is rejected. For example, to haunt Reddit:

   ```sh
   npm run new-haunt focus-guard -- --hosts "https://www.reddit.com/*"
   ```

   The scaffolder creates `app<N>-<name>/` (here `app3-focus-guard/`) with a Fog rule and a Rot rule on `timeOnSite`, then builds and checks the package.

2. Edit the new app's `rules.json` to choose effects, thresholds and params. The rules are validated against `skeleton/rule-schema.json`.

   ```sh
   code app<N>-<name>/rules.json
   ```

3. Run the tests.

   ```sh
   npm test
   ```

4. Load the app in Chrome: open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick the `app<N>-<name>` folder.

   ```text
   chrome://extensions
   ```

5. Open the Playground, paste your rules into the editor and press Apply. The local server is needed because Chrome does not run ES modules from `file://` pages. The [live Playground](https://lirenneedhelp.github.io/poltergeist/) works the same way.

   ```sh
   npm run playground
   ```

## Write your own ritual

A ritual is an effect the user has to complete to banish the haunt. Every ritual follows the Ritual contract:

- A ritual is an effect that follows every Effect contract rule.
- The ritual ignores every event that is not a Trusted_Event (an event whose `isTrusted` is `true`).
- On completion the ritual plays its ending and then makes the Exorcised_Action (`env.onAction('exorcised')`) exactly once.
- While Reduced_Motion is true the ritual skips its ending and makes the Exorcised_Action in the same task as the completing input.
- The ritual closes no tab, calls no navigation API, registers no `beforeunload` handler, and does not read or depend on what the app does after the Exorcised_Action.
- `undo` removes every element, event listener, timer and audio node the ritual created.

The ritual only makes the Exorcised_Action. The app decides what happens after `exorcised`; Doomscroll, for example, resets `timeOnSite` so the haunt starts over.

This "typed vow" ritual has no ending animation, so it reports `exorcised` in the same input event that completes it:

```js
// skeleton/effects/vow.js
export const description = 'A full-page vow: type the sentence exactly to banish the ghost.';
const VOW = 'I will close this tab and do my work.';

export function apply(env, params, intensity, handle) {
  if (handle && !handle.dead) return handle;
  const doc = env.document;
  const host = doc.createElement('div');
  host.setAttribute('data-poltergeist', 'vow');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:grid;'
    + 'place-content:center;gap:12px;background:#111;color:#eee;font:18px sans-serif';
  const prompt = doc.createElement('p');
  prompt.textContent = `Type: ${VOW}`;
  const input = doc.createElement('input');
  host.append(prompt, input);
  doc.documentElement.appendChild(host);
  const h = { env, host, input, dead: false, done: false };
  h.onInput = (event) => {
    if (!event.isTrusted) return;
    if (h.dead || h.done || input.value !== VOW) return;
    h.done = true;
    env.onAction('exorcised');
  };
  input.addEventListener('input', h.onInput);
  return h;
}

export function undo(handle, { durationMs = 0 } = {}) {
  if (!handle || handle.dead) return;
  handle.dead = true;
  handle.input.removeEventListener('input', handle.onInput);
  handle.host.remove();
}
```

Other rituals to try:

- Typed vow: the user types a short promise exactly as shown, as in the example above.
- Breathing timer: the user holds a button down while a circle slowly fills, and lets go only when it is full.
- Riddle: the user types the answer to a short riddle, and a wrong answer shows the riddle again.
