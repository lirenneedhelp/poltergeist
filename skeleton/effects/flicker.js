import { clamp01, teardown } from './util.js';

export const description = 'Page brightness stutters. With prefers-reduced-motion it becomes a static dim instead.';

const DEFAULTS = { maxDepth: 0.6, periodMs: 1400 };

export function apply(env, params = {}, intensity, handle) {
  const p = { ...DEFAULTS, ...params };
  const depth = p.maxDepth * clamp01(intensity);
  if (!handle || handle.dead) {
    const doc = env.document;
    const el = doc.documentElement;
    const style = doc.createElement('style');
    style.setAttribute('data-poltergeist', 'flicker');
    (doc.head || el).appendChild(style);
    handle = { env, el, style, prev: { animation: el.style.animation, opacity: el.style.opacity }, dead: false, fading: false, timer: null };
  }
  const { el, style, prev } = handle;
  if (env.reducedMotion) {
    // Static alternative: no animation, just a steady dim.
    style.textContent = '';
    el.style.animation = prev.animation;
    el.style.opacity = String((1 - depth * 0.5).toFixed(3));
  } else {
    const lo = (1 - depth).toFixed(3);
    const mid = (1 - depth * 0.6).toFixed(3);
    style.textContent =
      `@keyframes pg-flicker{0%,100%{opacity:1}6%{opacity:${lo}}9%{opacity:1}48%{opacity:1}` +
      `50%{opacity:${mid}}53%{opacity:1}80%{opacity:1}82%{opacity:${lo}}84%{opacity:1}}`;
    el.style.opacity = prev.opacity;
    el.style.animation = `pg-flicker ${p.periodMs}ms steps(1, end) infinite`;
  }
  return handle;
}

export function undo(handle) {
  // Flicker has no meaningful fade; always restores instantly.
  teardown(handle, 0, () => {}, () => {
    handle.el.style.animation = handle.prev.animation;
    handle.el.style.opacity = handle.prev.opacity;
    handle.style.remove();
  });
}
