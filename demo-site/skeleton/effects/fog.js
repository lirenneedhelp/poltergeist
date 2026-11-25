import { clamp01, teardown, handleState, LIVE, numberIn } from './util.js';

export const description = 'Page blurs and loses colour; both scale with intensity.';

const DEFAULTS = { maxBlur: 6, maxGrayscale: 1 };
const Z_INDEX = '2147483645';

const DEFAULT_TINT = '#9eb2a4'; // mid-tone green-grey
const DEFAULT_NOISE = 0.5;
const DEFAULT_MIST = 0;
const DEFAULT_DRIFT_MS = 20000;
const TINT_MAX_OPACITY = 0.38;
const DRIFT_PX = 240;
const MIST_MAX_OPACITY = 0.6;
const MIST_PX = 1200;
const MIST_PERIOD_FACTOR = 3;

// Every tile size divides DRIFT_PX (240), so one noise Drift cycle ends where it started.
// Each speck ends inside its tile, so no dot is cut at a tile edge.
const NOISE_IMAGE = [
  'radial-gradient(circle at 30% 40%, rgba(255,255,255,0.85) 0 2px, transparent 2.6px)', // 24 px tile
  'radial-gradient(circle at 70% 25%, rgba(0,0,0,0.8) 0 1.8px, transparent 2.4px)', // 20 px tile
  'radial-gradient(circle at 50% 70%, rgba(255,255,255,0.75) 0 1.5px, transparent 2.1px)', // 16 px tile
  'radial-gradient(circle at 20% 80%, rgba(0,0,0,0.75) 0 2.5px, transparent 3.1px)', // 40 px tile
  'radial-gradient(circle at 80% 60%, rgba(255,255,255,0.7) 0 2.2px, transparent 2.8px)', // 48 px tile
  'radial-gradient(ellipse 60% 40% at 30% 40%, rgba(235,242,238,0.45), transparent 70%)', // 240 px tile
  'radial-gradient(ellipse 50% 35% at 75% 70%, rgba(220,232,226,0.35), transparent 70%)', // 240 px tile
].join(', ');
const NOISE_SIZE = '24px 24px, 20px 20px, 16px 16px, 40px 40px, 48px 48px, 240px 240px, 240px 240px';
const DRIFT_KEYFRAMES = [
  { transform: 'translate(0px, 0px)' },
  { transform: `translate(${DRIFT_PX}px, ${DRIFT_PX}px)` },
];
const DRIFT_TIMING = { easing: 'linear', iterations: Infinity }; // duration = driftMs

// One 1200 px wide, full-height tile, repeated along x only. Each radial band fades out
// inside the tile, and the linear band is constant along x, so tile edges show no seam.
const MIST_IMAGE = [
  'radial-gradient(ellipse 30% 28% at 25% 35%, rgba(232,240,236,0.9), transparent 70%)',
  'radial-gradient(ellipse 28% 24% at 70% 62%, rgba(226,236,231,0.85), transparent 70%)',
  'radial-gradient(ellipse 22% 20% at 50% 15%, rgba(238,244,240,0.75), transparent 70%)',
  'linear-gradient(180deg, transparent 0%, rgba(228,236,232,0.5) 42%, rgba(228,236,232,0.5) 58%, transparent 100%)',
].join(', ');
const MIST_SIZE = `${MIST_PX}px 100%`;
const MIST_KEYFRAMES = [
  { transform: 'translate(0px, 0px)' },
  { transform: `translate(${MIST_PX}px, 0px)` },
];
const MIST_TIMING = { easing: 'linear', iterations: Infinity }; // duration = driftMs × 3

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
    // Keep the order tint, noise, mist: a new noise layer goes below an existing mist layer.
    if (handle.mistEl) handle.el.insertBefore(el, handle.mistEl);
    else handle.el.appendChild(el);
    handle.noiseEl = el;
  }
  handle.noiseEl.style.opacity = opacityFor(noise * i);
}

function stopMistDrift(handle) {
  if (handle.mistDrift) handle.mistDrift.cancel();
  handle.mistDrift = null;
}

function syncMist(handle, mist, i) {
  if (!(mist > 0)) {
    stopMistDrift(handle);
    if (handle.mistEl) handle.mistEl.remove();
    handle.mistEl = null;
    return;
  }
  if (!handle.mistEl) {
    const el = layer(handle.env.document);
    const s = el.style;
    s.top = '0';
    s.bottom = '0';
    s.left = `-${MIST_PX}px`;
    s.right = '0';
    s.willChange = 'transform';
    s.backgroundImage = MIST_IMAGE;
    s.backgroundSize = MIST_SIZE;
    s.backgroundRepeat = 'repeat-x';
    handle.el.appendChild(el); // always the last layer, above the noise
    handle.mistEl = el;
  }
  handle.mistEl.style.opacity = opacityFor(mist * MIST_MAX_OPACITY * i);
}

/** True when a Drift part should run on `el`: layer exists, motion allowed, driftMs above 0. */
const driftWanted = (handle, env, el) =>
  !!el && !env.reducedMotion && handle.driftMs > 0 && typeof el.animate === 'function';

/**
 * Start, stop, or keep both Drift parts so each runs exactly when wanted; never restarts
 * a running cycle. The noise part is reconciled first, then the mist part.
 */
function syncDrift(handle, env) {
  const noiseEl = handle.noiseEl;
  if (driftWanted(handle, env, noiseEl)) {
    if (!handle.drift) {
      handle.drift = noiseEl.animate(DRIFT_KEYFRAMES, { ...DRIFT_TIMING, duration: handle.driftMs });
    }
  } else {
    stopDrift(handle);
  }
  const mistEl = handle.mistEl;
  if (driftWanted(handle, env, mistEl)) {
    if (!handle.mistDrift) {
      handle.mistDrift = mistEl.animate(MIST_KEYFRAMES, {
        ...MIST_TIMING,
        duration: handle.driftMs * MIST_PERIOD_FACTOR,
      });
    }
  } else {
    stopMistDrift(handle);
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
    s.overflow = 'hidden'; // the oversized noise and mist layers never add scrollable area
    doc.documentElement.appendChild(el);
    handle = {
      env,
      el,
      dead: false,
      fading: false,
      timer: null,
      tintEl: null,
      noiseEl: null,
      mistEl: null,
      drift: null,
      mistDrift: null,
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
    syncMist(handle, numberIn(p.mist, 0, 1, DEFAULT_MIST), i);
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
      for (const layerEl of [handle.tintEl, handle.noiseEl, handle.mistEl]) {
        if (!layerEl) continue;
        layerEl.style.transition = `opacity ${durationMs}ms linear`;
        layerEl.style.opacity = '0';
      }
    },
    () => {
      handle.unwatch?.();
      stopDrift(handle);
      stopMistDrift(handle);
      handle.el.remove();
    },
  );
}
