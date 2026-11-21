// Shared helpers for effects.
//
// Effect contract (see .kiro/steering/structure.md):
//   export const description
//   export function apply(env, params, intensity, handle?) -> handle
//       Called when a rule first triggers (no handle) and again whenever intensity
//       changes (with the previous handle). Must be idempotent per handle.
//   export function undo(handle, { durationMs }?)
//       Must fully restore the page. Idempotent. durationMs > 0 requests a fade-out
//       (effects that cannot fade just undo instantly). undo(handle, {durationMs: 0})
//       on a handle that is mid-fade finishes it immediately.
//
// env = { window, document, reducedMotion, setTimeout, clearTimeout }

export const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * Handle lifecycle states, derived from the `dead` and `fading` flags that
 * effects initialise on their Handles (dead: false, fading: false, timer: null).
 */
export const LIVE = 'live';
export const FADING = 'fading';
export const DEAD = 'dead';

export function handleState(handle) {
  if (handle.dead) return DEAD;
  return handle.fading ? FADING : LIVE;
}

/**
 * Shared teardown with optional fade. `begin` starts the visual fade,
 * `finish` restores the page.
 *
 * Live -> Fading -> Dead. `finish` runs at most once per Handle.
 *  - missing or dead Handle: no-op.
 *  - durationMs > 0 on Live: begin(), schedule finish after durationMs.
 *  - durationMs > 0 on Fading: no-op, the original timer is kept.
 *  - durationMs <= 0 (or invalid): cancel any pending timer and finish now.
 */
export function teardown(handle, durationMs, begin, finish) {
  if (!handle) return;
  const state = handleState(handle);
  if (state === DEAD) return;

  if (durationMs > 0) {
    if (state === FADING) return;
    handle.fading = true;
    begin();
    handle.timer = handle.env.setTimeout(() => {
      handle.timer = null;
      if (handle.dead) return;
      handle.dead = true;
      finish();
    }, durationMs);
    return;
  }

  if (handle.timer) {
    handle.env.clearTimeout(handle.timer);
    handle.timer = null;
  }
  handle.dead = true;
  finish();
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** Duration_Formatter, moved verbatim from tombstone.js. Non-finite input gives 'a while'. */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'a while';
  const s = Math.max(0, seconds);
  if (s < 60) return plural(Math.floor(s), 'second');
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 48 * 3600) return plural(Math.floor(s / 3600), 'hour');
  return plural(Math.floor(s / 86400), 'day');
}

/** Replace each {key} in order; split/join so "$&" stays literal. Moved verbatim from tombstone.js. */
export const fill = (template, values) =>
  Object.entries(values).reduce((s, [key, v]) => s.split(`{${key}}`).join(v), String(template));

/** v if it is a finite number in [min, max], otherwise fallback. */
export const numberIn = (v, min, max, fallback) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;

/** Duration_Text for one {duration} (haunt-polish Requirement 1.2 to 1.5). */
export function durationText(env, meter, params) {
  const raw = typeof env.readMeter === 'function' ? env.readMeter(meter) : undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'a while';
  const k = params.durationScale;
  const scaled = raw * (typeof k === 'number' && Number.isFinite(k) && k > 0 ? k : 1);
  if (!Number.isFinite(scaled)) return 'a while';
  const suffix = typeof params.durationSuffix === 'string' ? params.durationSuffix : '';
  return formatDuration(scaled) + suffix;
}
