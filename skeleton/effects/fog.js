import { clamp01, teardown } from './util.js';

export const description = 'Page blurs and loses colour; both scale with intensity.';

const DEFAULTS = { maxBlur: 6, maxGrayscale: 1 };

export function apply(env, params = {}, intensity, handle) {
  const p = { ...DEFAULTS, ...params };
  const i = clamp01(intensity);
  if (!handle || handle.dead) {
    const el = env.document.documentElement;
    handle = { env, el, prev: { filter: el.style.filter, transition: el.style.transition }, dead: false, fading: false, timer: null };
  }
  handle.el.style.filter = `blur(${(p.maxBlur * i).toFixed(2)}px) grayscale(${(p.maxGrayscale * i).toFixed(3)})`;
  return handle;
}

export function undo(handle, { durationMs = 0 } = {}) {
  teardown(
    handle,
    durationMs,
    () => {
      handle.el.style.transition = `filter ${durationMs}ms linear`;
      handle.el.style.filter = 'blur(0px) grayscale(0)';
    },
    () => {
      handle.el.style.filter = handle.prev.filter;
      handle.el.style.transition = handle.prev.transition;
    },
  );
}
