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
 * Shared teardown with optional fade. `begin` starts the visual fade,
 * `finish` restores the page. Both run at most once.
 */
export function teardown(handle, durationMs, begin, finish) {
  if (!handle || handle.dead) return;
  if (handle.timer) {
    handle.env.clearTimeout(handle.timer);
    handle.timer = null;
  }
  if (durationMs > 0 && !handle.fading) {
    handle.fading = true;
    begin();
    handle.timer = handle.env.setTimeout(() => {
      handle.timer = null;
      handle.dead = true;
      finish();
    }, durationMs);
    return;
  }
  handle.dead = true;
  finish();
}
