// Shared helpers for the haunt-polish tests. Not a *.test.js file, so Vitest does not run it,
// and it lives under skeleton/test/, which the Skeleton_Sync never copies into the apps.
import { vi } from 'vitest';

/**
 * Install a vi.fn() as Element.prototype.animate. jsdom has no Web Animations API,
 * so vi.spyOn cannot be used. Each call records a fake Animation and returns it.
 * Returns { calls, on(el), restore() }.
 */
export function installAnimateSpy() {
  const previous = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  const calls = [];
  const fn = vi.fn(function animate(keyframes, options) {
    const anim = {
      target: this,
      keyframes,
      options,
      playState: 'running',
      cancel: vi.fn(() => {
        anim.playState = 'idle';
      }),
      finish: vi.fn(() => {
        anim.playState = 'finished';
      }),
    };
    calls.push(anim);
    return anim;
  });
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: fn });
  return {
    calls,
    fn,
    on: (el) => calls.filter((c) => c.target === el),
    restore() {
      if (previous) Object.defineProperty(Element.prototype, 'animate', previous);
      else delete Element.prototype.animate;
    },
  };
}

/** A jsdom env for effects, with no meter values unless overridden. */
export const makeEnv = (overrides = {}) => ({
  window,
  document,
  reducedMotion: false,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  readMeter: () => undefined,
  ...overrides,
});

/**
 * Requirement 9.8: a motion is playing when the effect called animate() on el exactly once
 * with the given duration and iteration count.
 */
export function isPlaying(spy, el, { duration, iterations }) {
  const onEl = spy.on(el);
  return (
    onEl.length === 1 &&
    onEl[0].options?.duration === duration &&
    onEl[0].options?.iterations === iterations
  );
}

/** Requirement 9.8: a motion is still when el has no animate() call and no CSS animation. */
export function isStill(spy, el) {
  const animation = el?.style?.animation ?? '';
  return spy.on(el).length === 0 && (animation === '' || animation === 'none');
}
