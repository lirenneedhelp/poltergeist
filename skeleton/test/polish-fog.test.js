// @vitest-environment jsdom
// haunt-polish Requirement 4: Fog tint, gradient noise texture, and Drift.
// Example-based only (Requirement 9.1). Motion is observed through the animate spy (Requirement 9.8).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fog from '../effects/fog.js';
import { installAnimateSpy, makeEnv, isPlaying, isStill } from './polish-helpers.js';

const PAGE = '<head><title>t</title></head><body><h1>Headline text</h1><p>Some paragraph of text here.</p></body>';
const DRIFT = { duration: 20000, iterations: Infinity };

const snap = () => ({
  html: document.documentElement.outerHTML,
  htmlStyle: document.documentElement.getAttribute('style'),
  bodyStyle: document.body ? document.body.getAttribute('style') : null,
});

const overlays = () => document.documentElement.querySelectorAll(':scope > [data-poltergeist="fog"]');
const bd = (el) => el.style.backdropFilter || el.style.webkitBackdropFilter;
const op = (el) => Number(el.style.opacity);

/** Split a CSS list at top-level commas (commas inside parentheses stay). */
function topLevelItems(value) {
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      items.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

/** A fake MediaQueryList for '(prefers-reduced-motion: reduce)' that records its listeners. */
function fakeMotionQuery() {
  const listeners = new Set();
  const mql = {
    media: '(prefers-reduced-motion: reduce)',
    matches: false,
    addEventListener: vi.fn((type, fn) => {
      if (type === 'change') listeners.add(fn);
    }),
    removeEventListener: vi.fn((type, fn) => {
      if (type === 'change') listeners.delete(fn);
    }),
  };
  return {
    mql,
    listeners,
    fire(matches) {
      mql.matches = matches;
      for (const fn of [...listeners]) fn({ matches, media: mql.media });
    },
  };
}

let spy;
let created;
const fg = (...args) => {
  const h = fog.apply(...args);
  if (!created.includes(h)) created.push(h);
  return h;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = PAGE;
  document.documentElement.removeAttribute('style');
  spy = installAnimateSpy();
  created = [];
});
afterEach(() => {
  for (const h of created) fog.undo(h, { durationMs: 0 });
  spy.restore();
  vi.useRealTimers();
});

describe('fog: tint (4.1, 5.4)', () => {
  it('uses the default green-grey tint at 0.22 x intensity', () => {
    const e = makeEnv();
    const h = fg(e, {}, 0.5);
    expect(h.tintEl).not.toBeNull();
    expect(h.tintEl.parentNode).toBe(h.el);
    expect(h.tintEl.style.backgroundColor).toBe('rgb(158, 178, 164)');
    expect(op(h.tintEl)).toBe(0.11);
    fg(e, {}, 1, h);
    expect(op(h.tintEl)).toBe(0.22);
    fg(e, {}, 0, h);
    expect(h.tintEl.style.opacity).toBe('0');
  });

  it('is fully transparent at intensity 0 on creation', () => {
    const h = fg(makeEnv(), {}, 0);
    expect(h.tintEl.style.opacity).toBe('0');
  });

  it('uses a tint override', () => {
    const h = fg(makeEnv(), { tint: 'rgb(120, 140, 200)' }, 1);
    expect(h.tintEl.style.backgroundColor).toBe('rgb(120, 140, 200)');
    expect(op(h.tintEl)).toBe(0.22);
  });

  it('renders no tint layer for tint ""', () => {
    const h = fg(makeEnv(), { tint: '' }, 1);
    expect(h.tintEl).toBeNull();
    expect(h.el.children).toHaveLength(1);
    expect(h.el.firstElementChild).toBe(h.noiseEl);
  });

  it('keeps the tint layer below the noise layer', () => {
    const h = fg(makeEnv(), {}, 1);
    expect([...h.el.children]).toEqual([h.tintEl, h.noiseEl]);
  });
});

describe('fog: noise texture (4.2)', () => {
  it('shows the default noise at 0.3 x intensity, made only from gradients', () => {
    const e = makeEnv();
    const h = fg(e, {}, 0.5);
    expect(h.noiseEl).not.toBeNull();
    expect(h.noiseEl.parentNode).toBe(h.el);
    expect(op(h.noiseEl)).toBe(0.15);
    const image = h.noiseEl.style.backgroundImage;
    expect(image).not.toBe('');
    expect(image).not.toMatch(/url\(/i);
    const items = topLevelItems(image);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toMatch(/^(?:repeating-)?(?:linear|radial|conic)-gradient\(.*\)$/);
    fg(e, {}, 1, h);
    expect(op(h.noiseEl)).toBe(0.3);
  });

  it('uses a noise override of 0.5', () => {
    const h = fg(makeEnv(), { noise: 0.5 }, 1);
    expect(op(h.noiseEl)).toBe(0.5);
  });

  it('renders no noise layer for noise 0', () => {
    const h = fg(makeEnv(), { noise: 0 }, 1);
    expect(h.noiseEl).toBeNull();
    expect([...h.el.children]).toEqual([h.tintEl]);
    expect(spy.calls).toHaveLength(0);
  });

  it('renders only the backdrop-filter for tint "" and noise 0 (4.7)', () => {
    const h = fg(makeEnv(), { tint: '', noise: 0 }, 1);
    expect(h.el.childNodes).toHaveLength(0);
    expect(h.el.style.background).toBe('');
    expect(h.el.style.backgroundColor).toBe('');
    expect(h.el.style.backgroundImage).toBe('');
    expect(bd(h.el)).toBe('blur(6px) grayscale(1)');
    expect(spy.calls).toHaveLength(0);
    expect(document.head.children).toHaveLength(1);
  });
});

describe('fog: Drift (4.3, 4.4, 4.5, 9.7)', () => {
  it('plays on the noise layer for 20000 ms with infinite iterations by default', () => {
    const h = fg(makeEnv(), {}, 1);
    expect(isPlaying(spy, h.noiseEl, DRIFT)).toBe(true);
    const [anim] = spy.on(h.noiseEl);
    expect(anim.options.easing).toBe('linear');
    expect(anim.keyframes[0].transform).toBe('translate(0px, 0px)');
    expect(anim.keyframes.at(-1).transform).toBe('translate(240px, 240px)');
    expect(spy.calls).toHaveLength(1);
    expect(spy.on(h.el)).toHaveLength(0);
    expect(spy.on(h.tintEl)).toHaveLength(0);
  });

  it('uses a driftMs override of 5000', () => {
    const h = fg(makeEnv(), { driftMs: 5000 }, 1);
    expect(isPlaying(spy, h.noiseEl, { duration: 5000, iterations: Infinity })).toBe(true);
  });

  it('keeps the texture fixed for driftMs 0', () => {
    const h = fg(makeEnv(), { driftMs: 0 }, 1);
    expect(h.noiseEl).not.toBeNull();
    expect(isStill(spy, h.noiseEl)).toBe(true);
    expect(h.drift).toBeNull();
  });

  it('falls back to 20000 for driftMs 500', () => {
    const h = fg(makeEnv(), { driftMs: 500 }, 1);
    expect(isPlaying(spy, h.noiseEl, DRIFT)).toBe(true);
  });

  it('does not play when reducedMotion is true', () => {
    const h = fg(makeEnv({ reducedMotion: true }), {}, 1);
    expect(h.noiseEl).not.toBeNull();
    expect(isStill(spy, h.noiseEl)).toBe(true);
    expect(spy.calls).toHaveLength(0);
  });

  it('re-apply with reducedMotion true cancels it, and without starts it again', () => {
    const h = fg(makeEnv(), {}, 1);
    const [first] = spy.calls;
    fg(makeEnv({ reducedMotion: true }), {}, 1, h);
    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(first.playState).toBe('idle');
    expect(h.drift).toBeNull();
    expect(spy.calls).toHaveLength(1);
    fg(makeEnv(), {}, 1, h);
    expect(spy.calls).toHaveLength(2);
    expect(spy.calls[1].target).toBe(h.noiseEl);
    expect(spy.calls[1].options).toMatchObject(DRIFT);
    expect(h.drift).toBe(spy.calls[1]);
  });

  it('re-apply while running makes no new call and leaves the cycle alone', () => {
    const e = makeEnv();
    const h = fg(e, {}, 0.3);
    const [first] = spy.calls;
    fg(e, {}, 0.6, h);
    fg(e, {}, 1, h);
    expect(spy.calls).toHaveLength(1);
    expect(first.cancel).not.toHaveBeenCalled();
    expect(first.finish).not.toHaveBeenCalled();
    expect(h.drift).toBe(first);
  });

  it('stops on a reduced-motion change event, and undo removes the listener (D7)', () => {
    const q = fakeMotionQuery();
    let rm = false;
    const win = { matchMedia: vi.fn(() => q.mql) };
    const e = makeEnv({ window: win });
    Object.defineProperty(e, 'reducedMotion', { configurable: true, enumerable: true, get: () => rm });
    const h = fg(e, {}, 1);
    expect(win.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(q.listeners.size).toBe(1);
    const [first] = spy.calls;
    rm = true;
    q.fire(true);
    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(h.drift).toBeNull();
    rm = false;
    q.fire(false);
    expect(spy.calls).toHaveLength(2);
    expect(h.drift).toBe(spy.calls[1]);
    fog.undo(h, { durationMs: 0 });
    expect(q.listeners.size).toBe(0);
    expect(q.mql.removeEventListener).toHaveBeenCalledTimes(1);
    expect(spy.calls[1].playState).toBe('idle');
    q.fire(false);
    expect(spy.calls).toHaveLength(2);
  });
});

describe('fog: re-apply and overlay contract (4.6, 4.10, 4.11, 4.12)', () => {
  it('keeps one overlay and the same layers on re-apply', () => {
    const e = makeEnv();
    const h = fg(e, {}, 0.2);
    const { el, tintEl, noiseEl } = h;
    const h2 = fg(e, {}, 0.8, h);
    expect(h2).toBe(h);
    expect(overlays()).toHaveLength(1);
    expect(h.el).toBe(el);
    expect(h.tintEl).toBe(tintEl);
    expect(h.noiseEl).toBe(noiseEl);
    expect(h.el.children).toHaveLength(2);
    expect(op(h.tintEl)).toBe(0.176);
    expect(op(h.noiseEl)).toBe(0.24);
  });

  it('keeps the backdrop-filter string unchanged', () => {
    const h = fg(makeEnv(), { maxBlur: 5, maxGrayscale: 0.8 }, 0.5);
    expect(bd(h.el)).toBe('blur(2.5px) grayscale(0.4)');
    const d = fg(makeEnv(), {}, 1 / 3);
    expect(bd(d.el)).toBe('blur(2px) grayscale(0.333)');
  });

  it('keeps the overlay contract and pointer-events none on every layer', () => {
    const h = fg(makeEnv(), {}, 1);
    expect(h.el.parentNode).toBe(document.documentElement);
    expect(h.el.style.position).toBe('fixed');
    expect(h.el.style.zIndex).toBe('2147483645');
    expect(h.el.style.pointerEvents).toBe('none');
    for (const layer of [h.tintEl, h.noiseEl]) {
      expect(layer.style.pointerEvents).toBe('none');
      expect(layer.hasAttribute('data-poltergeist')).toBe(false);
    }
    expect(document.documentElement.querySelectorAll('[data-poltergeist]')).toHaveLength(1);
  });
});

describe('fog: undo (4.8, 4.9)', () => {
  it('fade undo fades both layers with opacity 500ms linear and removes the overlay after 500 ms', () => {
    const before = snap();
    const h = fg(makeEnv(), {}, 1);
    const [drift] = spy.calls;
    fog.undo(h, { durationMs: 500 });
    for (const layer of [h.tintEl, h.noiseEl]) {
      expect(layer.style.transition).toBe('opacity 500ms linear');
      expect(layer.style.opacity).toBe('0');
    }
    expect(h.el.style.transition).toContain('backdrop-filter 500ms linear');
    expect(bd(h.el)).toBe('blur(0px) grayscale(0)');
    vi.advanceTimersByTime(499);
    expect(overlays()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(overlays()).toHaveLength(0);
    expect(drift.playState).toBe('idle');
    expect(snap()).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('instant undo stops the Drift and removes every layer before returning', () => {
    const before = snap();
    const h = fg(makeEnv(), {}, 1);
    const [drift] = spy.calls;
    fog.undo(h, { durationMs: 0 });
    expect(drift.cancel).toHaveBeenCalledTimes(1);
    expect(overlays()).toHaveLength(0);
    expect(h.tintEl.isConnected).toBe(false);
    expect(h.noiseEl.isConnected).toBe(false);
    expect(snap()).toEqual(before);
    expect(() => fog.undo(h, { durationMs: 0 })).not.toThrow();
    expect(snap()).toEqual(before);
  });

  it('instant undo during a fade-out finishes at once', () => {
    const before = snap();
    const h = fg(makeEnv(), {}, 1);
    fog.undo(h, { durationMs: 500 });
    vi.advanceTimersByTime(200);
    fog.undo(h, { durationMs: 0 });
    expect(overlays()).toHaveLength(0);
    expect(snap()).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
