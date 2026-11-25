---
inclusion: fileMatch
fileMatchPattern: ["skeleton/effects/**", "skeleton/ritual/**", "**/rules.json"]
---

# Haunt authoring

Rules for writing effects, rituals and rules files in the Poltergeist skeleton.

## Effect contract

- An effect lives in `skeleton/effects/<name>.js` and exports `apply(env, params, intensity, handle)`, `undo(handle, { durationMs })` and a string `description`.
- `undo` reaches the Restored_State synchronously when `durationMs` is 0 and no later than `durationMs` milliseconds after the call otherwise. The Restored_State is `documentElement.outerHTML` and the `style` attributes of `html` and `body` exactly equal to their values before the first `apply`.
- A second `undo` on the same handle changes nothing and throws nothing.
- Every visual is inside elements the effect created that are direct children of `documentElement`.
- The effect sets no style or attribute on `html` or `body` and adds no node under `head` or `body`.
- The effect calls no `chrome.*` API.
- While Reduced_Motion (`env.reducedMotion`) is true the effect starts no CSS animation, CSS transition, `requestAnimationFrame` loop or repeating timer.
- Every param has a default, and a param of the wrong type or outside the range documented in `skeleton/rule-schema.json` (see `definitions.params-<name>`) uses the default.
- All text is set with `textContent`, never with `innerHTML` or any other HTML parsing.
- The effect loads no resource (no network request, image, font, script or stylesheet URL).

## Meter rules

- Meters: `timeOnSite` (seconds), `scrollDistance` (pixels), `timeSinceActive` (seconds), `timeAway` (seconds).
- Effects read meters only through `env.readMeter`.
- Only app code resets meters, only through `meters.reset`, and only `timeAway` and `timeOnSite` are resettable.
- Rules escalate through `threshold` and `rampTo`, and in each app the rule with the lowest `threshold` never uses the `block` or `tombstone` effect.

## Ritual contract

- A ritual is an effect that follows every Effect contract rule.
- The ritual ignores every event that is not a Trusted_Event (an event whose `isTrusted` is `true`).
- On completion the ritual plays its ending and then makes the Exorcised_Action (`env.onAction('exorcised')`) exactly once.
- While Reduced_Motion is true the ritual skips its ending and makes the Exorcised_Action in the same task as the completing input.
- The ritual closes no tab, calls no navigation API, registers no `beforeunload` handler, and does not read or depend on what the app does after the Exorcised_Action.
- `undo` removes every element, event listener, timer and audio node the ritual created.

## Adding an effect

1. Create `skeleton/effects/<name>.js` under the Effect contract.
2. Register the effect in `skeleton/effects/index.js`.
3. Document the effect and its params in `skeleton/rule-schema.json`.
4. Add restoration and reduced-motion tests to the Restoration_Suite (`skeleton/test/restoration.test.js`).
5. Run `npm run build:skeletons`.
6. Update the README.
