import { clamp01, teardown } from './util.js';

export const description = 'A full-page overlay that darkens with intensity and blocks interaction once intensity reaches blockAt.';

const DEFAULTS = { maxOpacity: 0.92, blockAt: 1, message: '' };

export function apply(env, params = {}, intensity, handle) {
  const p = { ...DEFAULTS, ...params };
  const i = clamp01(intensity);
  if (!handle || handle.dead) {
    const doc = env.document;
    const el = doc.createElement('div');
    el.setAttribute('data-poltergeist', 'block');
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
      'background:#000;color:#fff;font:600 1.5rem system-ui,sans-serif;text-align:center;padding:2rem;' +
      'opacity:0;pointer-events:none;';
    (doc.body || doc.documentElement).appendChild(el);
    handle = { env, el, dead: false, fading: false, timer: null };
  }
  handle.el.textContent = p.message;
  handle.el.style.opacity = String((p.maxOpacity * i).toFixed(3));
  // Only swallow clicks once the overlay is fully "arrived".
  handle.el.style.pointerEvents = i >= p.blockAt ? 'auto' : 'none';
  return handle;
}

export function undo(handle, { durationMs = 0 } = {}) {
  teardown(
    handle,
    durationMs,
    () => {
      handle.el.style.pointerEvents = 'none';
      handle.el.style.transition = `opacity ${durationMs}ms linear`;
      handle.el.style.opacity = '0';
    },
    () => handle.el.remove(),
  );
}
