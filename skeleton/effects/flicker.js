import { clamp01, teardown } from './util.js';

export const description = 'Page brightness stutters. With prefers-reduced-motion it becomes a static dim instead.';

const DEFAULTS = { maxDepth: 0.6, periodMs: 1400 };
const Z_INDEX = '2147483646';

export function apply(env, params = {}, intensity, handle) {
  const p = { ...DEFAULTS, ...params };
  const i = clamp01(intensity);
  const peak = +(p.maxDepth * i).toFixed(4);
  if (!handle || handle.dead) {
    const doc = env.document;
    const root = doc.documentElement;
    const el = doc.createElement('div');
    el.setAttribute('data-poltergeist', 'flicker');
    const s = el.style;
    s.position = 'fixed';
    s.top = '0';
    s.right = '0';
    s.bottom = '0';
    s.left = '0';
    s.background = '#000';
    s.pointerEvents = 'none';
    s.zIndex = Z_INDEX;
    const style = doc.createElement('style');
    style.setAttribute('data-poltergeist', 'flicker');
    root.appendChild(style);
    root.appendChild(el);
    handle = { env, el, style, dead: false, fading: false, timer: null };
  }
  const { el, style } = handle;
  if (env.reducedMotion) {
    // Static alternative: no animation, steady dim.
    style.textContent = '@keyframes pg-flicker{from{opacity:0}to{opacity:0}}';
    el.style.animation = 'none';
    el.style.opacity = String(+(peak * 0.5).toFixed(4));
  } else {
    style.textContent =
      `@keyframes pg-flicker{0%,100%{opacity:0}6%{opacity:${peak}}9%{opacity:0}` +
      `50%{opacity:${+(peak * 0.6).toFixed(4)}}53%{opacity:0}82%{opacity:${peak}}84%{opacity:0}}`;
    el.style.opacity = '0';
    el.style.animation = `pg-flicker ${p.periodMs}ms steps(1, end) infinite`;
  }
  return handle;
}

export function undo(handle) {
  // Flicker has no meaningful fade; always removes synchronously.
  teardown(handle, 0, () => {}, () => {
    handle.el.remove();
    handle.style.remove();
  });
}
