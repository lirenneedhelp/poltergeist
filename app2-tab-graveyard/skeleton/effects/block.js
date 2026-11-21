import { clamp01, teardown, fill, numberIn, durationText } from './util.js';

export const description = 'A full-page overlay that darkens with intensity and blocks interaction once intensity reaches blockAt.';

const DEFAULTS = { maxOpacity: 0.92, blockAt: 1, message: '' };
const DEFAULT_FADE_IN_MS = 1500;

const HOST_CSS =
  'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
  'background:#000;color:#fff;font:600 1.5rem system-ui,sans-serif;text-align:center;padding:2rem;' +
  'opacity:0;pointer-events:none;';
const STAGE_CSS = 'display:flex;flex-direction:column;align-items:center;gap:24px;max-width:960px;';
const MESSAGE_CSS = 'font:700 40px/1.25 system-ui,sans-serif;';
const DETAIL_CSS = 'margin:0;font:400 24px/1.4 system-ui,sans-serif;color:#d4d4dc;';
const FADE_KEYFRAMES = [{ opacity: 0 }, { opacity: 1 }];
const FADE_TIMING = { easing: 'ease-out', iterations: 1 }; // duration = fadeInMs

/** Resolve params with defaults and valid-set fallbacks. Never mutates `params`. */
function resolve(params) {
  const p = { ...DEFAULTS, ...(params || {}) };
  return {
    ...p,
    figure: p.figure === 'none' ? 'none' : 'ghost',
    detail: typeof p.detail === 'string' ? p.detail : '',
    durationMeter: typeof p.durationMeter === 'string' ? p.durationMeter : 'timeOnSite',
    fadeInMs: numberIn(p.fadeInMs, 0, 10000, DEFAULT_FADE_IN_MS),
  };
}

const svgEl = (doc, tag, attrs) => {
  const el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
};

function ghost(doc) {
  const svg = svgEl(doc, 'svg', {
    viewBox: '0 0 120 140',
    width: '120',
    height: '140',
    'aria-hidden': 'true',
    style: 'display:block',
  });
  svg.appendChild(svgEl(doc, 'path', {
    d: 'M10 60a50 50 0 0 1 100 0v70q-8.33-10-16.67 0t-16.67 0-16.66 0-16.67 0-16.66 0-16.67 0z',
    fill: '#f2f2f7',
  }));
  svg.appendChild(svgEl(doc, 'ellipse', { cx: '44', cy: '62', rx: '7', ry: '10', fill: '#15151a' }));
  svg.appendChild(svgEl(doc, 'ellipse', { cx: '76', cy: '62', rx: '7', ry: '10', fill: '#15151a' }));
  svg.appendChild(svgEl(doc, 'ellipse', { cx: '60', cy: '92', rx: '8', ry: '10', fill: '#15151a' }));
  return svg;
}

function create(env, p) {
  const doc = env.document;
  const el = doc.createElement('div');
  el.setAttribute('data-poltergeist', 'block');
  el.setAttribute('role', 'status');
  el.style.cssText = HOST_CSS;

  const root = el.attachShadow({ mode: 'open' });
  const stage = doc.createElement('div');
  stage.style.cssText = STAGE_CSS;
  const figureEl = p.figure === 'ghost' ? ghost(doc) : null;
  if (figureEl) stage.appendChild(figureEl);
  const messageEl = doc.createElement('div');
  messageEl.style.cssText = MESSAGE_CSS;
  messageEl.appendChild(doc.createElement('slot'));
  stage.appendChild(messageEl);
  root.appendChild(stage);

  doc.documentElement.appendChild(el);
  return { env, el, stage, figureEl, messageEl, detailEl: null, fade: [], dead: false, fading: false, timer: null };
}

/** Add, update, or remove the second line. Text via fill + durationText. */
function syncDetail(handle, env, p) {
  if (p.detail === '') {
    if (handle.detailEl) {
      handle.detailEl.remove();
      handle.detailEl = null;
    }
    return;
  }
  if (!handle.detailEl) {
    const detailEl = env.document.createElement('p');
    detailEl.style.cssText = DETAIL_CSS;
    handle.stage.appendChild(detailEl);
    handle.detailEl = detailEl;
  }
  handle.detailEl.textContent = fill(p.detail, { duration: durationText(env, p.durationMeter, p) });
}

function startFade(handle, env, fadeInMs) {
  if (env.reducedMotion || fadeInMs === 0) return;
  for (const el of [handle.figureEl, handle.messageEl, handle.detailEl]) {
    if (el && typeof el.animate === 'function') {
      handle.fade.push(el.animate(FADE_KEYFRAMES, { ...FADE_TIMING, duration: fadeInMs }));
    }
  }
}

function endFade(handle) {
  for (const anim of handle.fade) anim.finish();
  handle.fade = [];
}

function cancelFade(handle) {
  for (const anim of handle.fade) anim.cancel();
  handle.fade = [];
}

export function apply(env, params = {}, intensity, handle) {
  const p = resolve(params);
  const i = clamp01(intensity);
  const created = !handle || handle.dead;
  if (created) handle = create(env, p);
  handle.el.textContent = p.message;
  syncDetail(handle, env, p);
  handle.el.style.opacity = String((p.maxOpacity * i).toFixed(3));
  // Only swallow clicks once the overlay is fully "arrived".
  handle.el.style.pointerEvents = i >= p.blockAt ? 'auto' : 'none';
  if (created) startFade(handle, env, p.fadeInMs); // after syncDetail, so the second line fades too
  else if (env.reducedMotion) endFade(handle); // never restarts
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
    () => {
      cancelFade(handle);
      handle.el.remove();
    },
  );
}
