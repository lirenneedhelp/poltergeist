import { clamp01, teardown, handleState, LIVE, numberIn } from './util.js';

export const description = 'Page blurs and loses colour; both scale with intensity.';

const DEFAULTS = { maxBlur: 6, maxGrayscale: 1 };
const Z_INDEX = '2147483645';

const DEFAULT_TINT = '#9eb2a4'; // faint green-grey
const DEFAULT_NOISE = 0.3;
const DEFAULT_DRIFT_MS = 20000;
const TINT_MAX_OPACITY = 0.22;
const DRIFT_PX = 240;

// Every tile size divides DRIFT_PX (240), so one Drift cycle ends where it started.
const NOISE_IMAGE = [
  'radial-gradient(circle at 30% 40%, rgba(255,255,255,0.55) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 70% 20%, rgba(0,0,0,0.45) 0 1px, transparent 1.6px)',
  'radial-gradient(circle at 55% 75%, rgba(255,255,255,0.4) 0 0.8px, transparent 1.4px)',
  'radial-gradient(circle at 15% 85%, rgba(0,0,0,0.35) 0 1.2px, transparent 1.8px)',
  'radial-gradient(ellipse 60% 40% at 30% 40%, rgba(235,242,238,0.45), transparent 70%)',
  'radial-gradient(ellipse 50% 35% at 75% 70%, rgba(220,232,226,0.35), transparent 70%)',
].join(', ');
const NOISE_SIZE = '24px 24px, 30px 30px, 16px 16px, 40px 40px, 240px 240px, 240px 240px';
const DRIFT_KEYFRAMES = [
  { transform: 'translate(0px, 0px)' },
  { transform: `translate(${DRIFT_PX}px, ${DRIFT_PX}px)` },
];
const DRIFT_TIMING = { easing: 'linear', iterations: Infinity }; // duration = driftMs

const filterFor = (blur, gray) => `blur(${blur}px) grayscale(${gray})`;
const opacityFor = (n) => String(+n.toFixed(3));

const driftFor = (v) =>
  v === 0 ? 0 : numberIn(v, 1000, 600000, DEFAULT_DRIFT_MS);

/**
 * The tint if it is a safe single colour value, otherwise ''. A string blocklist
 * runs before the CSSOM probe, because the probe alone accepts values like var(--x).
 */
function acceptedTint(doc, value) {
  const t = typeof value === 'string' ? value : DEFAULT_TINT; // non-string falls back to the default
  if (t === '' || /[\\;{}]/.test(t) || /(?:var|env|attr|url)\(/i.test(t)) return '';
  const probe = doc.createElement('div'); // never attached to the document
  probe.style.color = t;
  return probe.style.color === '' ? '' : t;
}

function layer(doc) {
  const el = doc.createElement('div');
  const s = el.style;
  s.position = 'absolute';
  s.pointerEvents = 'none';
  return el;
}

function syncTint(handle, tint, i) {
  if (!tint) {
    if (handle.tintEl) handle.tintEl.remove();
    handle.tintEl = null;
    return;
  }
  if (!handle.tintEl) {
    const el = layer(handle.env.document);
    const s = el.style;
    s.top = '0';
    s.right = '0';
    s.bottom = '0';
    s.left = '0';
    handle.el.prepend(el); // stays below the noise layer
    handle.tintEl = el;
  }
  handle.tintEl.style.backgroundColor = tint;
  handle.tintEl.style.opacity = opacityFor(TINT_MAX_OPACITY * i);
}

function stopDrift(handle) {
  if (handle.drift) handle.drift.cancel();
  handle.drift = null;
}

function syncNoise(handle, noise, i) {
  if (!(noise > 0)) {
    stopDrift(handle);
    if (handle.noiseEl) handle.noiseEl.remove();
    handle.noiseEl = null;
    return;
  }
  if (!handle.noiseEl) {
    const el = layer(handle.env.document);
    const s = el.style;
    s.top = `-${DRIFT_PX}px`;
    s.left = `-${DRIFT_PX}px`;
    s.right = '0';
    s.bottom = '0';
    s.willChange = 'transform';
    s.backgroundImage = NOISE_IMAGE;
    s.backgroundSize = NOISE_SIZE;
    handle.el.appendChild(el);
    handle.noiseEl = el;
  }
  handle.noiseEl.style.opacity = opacityFor(noise * i);
}

/** Start, stop, or keep the Drift so it runs exactly when wanted; never restarts a running cycle. */
function syncDrift(handle, env) {
  const el = handle.noiseEl;
  const wanted =
    !!el && !env.reducedMotion && handle.driftMs > 0 && typeof el.animate === 'function';
  if (wanted && !handle.drift) {
    handle.drift = el.animate(DRIFT_KEYFRAMES, { ...DRIFT_TIMING, duration: handle.driftMs });
  } else if (!wanted) {
    stopDrift(handle);
  }
}

/** Listen for reduced-motion changes; returns the remover, or a no-op without matchMedia. */
function watchMotion(env, onChange) {
  const mql = env.window?.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (!mql || typeof mql.addEventListener !== 'function') return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

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
    s.overflow = 'hidden'; // the oversized noise layer never adds scrollable area
    doc.documentElement.appendChild(el);
    handle = {
      env,
      el,
      dead: false,
      fading: false,
      timer: null,
      tintEl: null,
      noiseEl: null,
      drift: null,
      driftMs: DEFAULT_DRIFT_MS,
      unwatch: () => {},
    };
    const h = handle;
    h.unwatch = watchMotion(env, () => {
      if (handleState(h) === LIVE) syncDrift(h, h.env);
    });
  }
  if (handleState(handle) === LIVE) {
    const value = filterFor(+(p.maxBlur * i).toFixed(2), +(p.maxGrayscale * i).toFixed(3));
    handle.el.style.backdropFilter = value;
    handle.el.style.webkitBackdropFilter = value;
    syncTint(handle, acceptedTint(env.document, p.tint), i);
    syncNoise(handle, numberIn(p.noise, 0, 1, DEFAULT_NOISE), i);
    handle.driftMs = driftFor(p.driftMs);
    syncDrift(handle, env);
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
      for (const layerEl of [handle.tintEl, handle.noiseEl]) {
        if (!layerEl) continue;
        layerEl.style.transition = `opacity ${durationMs}ms linear`;
        layerEl.style.opacity = '0';
      }
    },
    () => {
      handle.unwatch?.();
      stopDrift(handle);
      handle.el.remove();
    },
  );
}
