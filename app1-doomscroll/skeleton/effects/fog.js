import { clamp01, teardown, handleState, LIVE } from './util.js';

export const description = 'Page blurs and loses colour; both scale with intensity.';

const DEFAULTS = { maxBlur: 6, maxGrayscale: 1 };
const Z_INDEX = '2147483645';

const filterFor = (blur, gray) => `blur(${blur}px) grayscale(${gray})`;

export function apply(env, params = {}, intensity, handle) {
  const p = { ...DEFAULTS, ...params };
  const i = clamp01(intensity);
  if (!handle || handle.dead) {
    const doc = env.document;
    const el = doc.createElement('div');
    el.setAttribute('data-poltergeist', 'fog');
    const s = el.style;
    s.position = 'fixed';
    s.top = '0';
    s.right = '0';
    s.bottom = '0';
    s.left = '0';
    s.pointerEvents = 'none';
    s.zIndex = Z_INDEX;
    doc.documentElement.appendChild(el);
    handle = { env, el, dead: false, fading: false, timer: null };
  }
  if (handleState(handle) === LIVE) {
    const value = filterFor(+(p.maxBlur * i).toFixed(2), +(p.maxGrayscale * i).toFixed(3));
    handle.el.style.backdropFilter = value;
    handle.el.style.webkitBackdropFilter = value;
  }
  return handle;
}

export function undo(handle, { durationMs = 0 } = {}) {
  teardown(
    handle,
    durationMs,
    () => {
      const s = handle.el.style;
      s.transition = `backdrop-filter ${durationMs}ms linear, -webkit-backdrop-filter ${durationMs}ms linear`;
      s.backdropFilter = 'blur(0px) grayscale(0)';
      s.webkitBackdropFilter = 'blur(0px) grayscale(0)';
    },
    () => {
      handle.el.remove();
    },
  );
}
