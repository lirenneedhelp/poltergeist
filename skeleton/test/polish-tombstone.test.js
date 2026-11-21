// @vitest-environment jsdom
// haunt-polish Requirement 3: the Tombstone finale (stone card, crack and chip, mark, Rise_In).
// Example-based only (Requirement 9.1). Motion is observed through the animate spy (Requirement 9.8).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as tombstone from '../effects/tombstone.js';
import { installAnimateSpy, makeEnv, isPlaying, isStill } from './polish-helpers.js';

const PAGE = '<head><title>Lecture 4 notes</title></head><body><h1>Headline text</h1><p>Some paragraph of text here.</p></body>';
const RISE = { duration: 800, iterations: 1 };
const OLD_RADIUS = '45% 45% 0.5rem 0.5rem / 25% 25% 0.5rem 0.5rem';

const snap = () => document.documentElement.outerHTML;
const hostEl = () => document.querySelector('[data-poltergeist="tombstone"]');

/** Split a background-image list on top-level commas only. */
function layers(value) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const isGradient = (layer) => /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/.test(layer);

let spy;
let created;
let visibility;
function setVisibility(state) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}
const env = (overrides = {}) => makeEnv({ readMeter: (name) => (name === 'timeAway' ? 93600 : undefined), ...overrides });
const ts = (...args) => {
  const h = tombstone.apply(...args);
  if (!created.includes(h)) created.push(h);
  return h;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = PAGE;
  document.documentElement.removeAttribute('style');
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  spy = installAnimateSpy();
  created = [];
});
afterEach(() => {
  for (const h of created) tombstone.undo(h, { durationMs: 0 });
  spy.restore();
  delete document.visibilityState;
  vi.useRealTimers();
});

describe('tombstone: weathered stone (3.1, 3.2)', () => {
  it('weathered by default: gradient-only background, a clip-path chip, and an empty crack', () => {
    for (const weathered of [undefined, true, 'no', null]) {
      const h = ts(env(), weathered === undefined ? {} : { weathered }, 1);
      const bg = layers(h.card.style.backgroundImage);
      expect(bg.length).toBeGreaterThan(0);
      expect(bg.every(isGradient)).toBe(true);
      expect(h.card.style.clipPath).toMatch(/^polygon\(/);
      expect(h.crackEl).not.toBeNull();
      expect(h.crackEl.parentNode).toBe(h.card);
      expect(h.crackEl.getAttribute('aria-hidden')).toBe('true');
      expect(h.crackEl.childNodes).toHaveLength(0);
      expect(layers(h.crackEl.style.backgroundImage).every(isGradient)).toBe(true);
      tombstone.undo(h, { durationMs: 0 });
    }
  });

  it('weathered false keeps the pre-polish colour, border, and corners with no gradient, clip-path, or crack', () => {
    const h = ts(env(), { weathered: false }, 1);
    const s = h.card.style;
    expect(s.backgroundColor).toBe('rgb(58, 58, 63)');
    expect(s.border).toBe('2px solid rgb(85, 85, 92)');
    expect(s.borderRadius).toBe(OLD_RADIUS);
    expect(['', 'none']).toContain(s.backgroundImage);
    expect(s.clipPath).toBe('');
    expect(h.crackEl).toBeNull();
    expect([...h.card.children]).toEqual([h.markEl, h.headingEl, h.messageEl, h.button]);
  });

  it('reads weathered once, at creation', () => {
    const e = env();
    const h = ts(e, {}, 0.5);
    const crack = h.crackEl;
    ts(e, { weathered: false }, 1, h);
    expect(h.crackEl).toBe(crack);
    expect(h.card.contains(crack)).toBe(true);
    expect(h.card.style.clipPath).not.toBe('');
  });
});

describe('tombstone: mark (3.3, 3.4)', () => {
  it('shows R.I.P. by default in an aria-hidden div before the h1', () => {
    const h = ts(env(), {}, 1);
    expect(h.markEl).not.toBeNull();
    expect(h.markEl.localName).toBe('div');
    expect(h.markEl.getAttribute('aria-hidden')).toBe('true');
    expect(h.markEl.textContent).toBe('R.I.P.');
    expect(h.markEl.nextElementSibling).toBe(h.headingEl);
    const kids = [...h.card.children];
    expect(kids.indexOf(h.markEl)).toBeLessThan(kids.indexOf(h.headingEl));
  });

  it('keeps an override literal and updates it on every apply', () => {
    const e = env();
    const h = ts(e, { mark: 'Ci-gît {title}' }, 1);
    expect(h.markEl.textContent).toBe('Ci-gît {title}');
    ts(e, { mark: '{duration} ✝' }, 1, h);
    expect(h.markEl.textContent).toBe('{duration} ✝');
  });

  it("'' removes a mark an earlier apply rendered", () => {
    const e = env();
    const h = ts(e, {}, 1);
    const mark = h.markEl;
    ts(e, { mark: '' }, 1, h);
    expect(h.markEl).toBeNull();
    expect(h.card.contains(mark)).toBe(false);
    expect(h.card.firstElementChild).toBe(h.headingEl);
    const fresh = ts(env(), { mark: '' }, 1);
    expect(fresh.markEl).toBeNull();
  });

  it.each([[5], [null], [true], [{}]])('a non-string mark (%s) gives the default', (mark) => {
    const h = ts(env(), { mark }, 1);
    expect(h.markEl.textContent).toBe('R.I.P.');
  });
});

describe('tombstone: text structure and fonts (3.5, 3.10)', () => {
  it('has exactly one h1, p, and button, and text only in those and the mark', () => {
    const h = ts(env(), {}, 1);
    expect(hostEl().childNodes).toHaveLength(0);
    const root = h.root;
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelectorAll('p')).toHaveLength(1);
    expect(root.querySelectorAll('button')).toHaveLength(1);
    expect(h.headingEl.textContent).toBe('Here lies Lecture 4 notes');
    expect(h.messageEl.textContent).toBe('Abandoned for 26 hours.');
    expect(h.button.textContent).toBe('Resurrect');
    const allowed = new Set([h.headingEl, h.messageEl, h.button, h.markEl]);
    for (const el of root.querySelectorAll('*')) {
      if (allowed.has(el)) continue;
      const textKids = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE);
      expect(textKids).toHaveLength(0);
    }
  });

  it('uses fixed px font sizes for the card, mark, heading, message, and button', () => {
    for (const weathered of [true, false]) {
      const h = ts(env(), { weathered }, 1);
      for (const el of [h.card, h.markEl, h.headingEl, h.messageEl, h.button]) {
        expect(el.style.fontSize).toMatch(/^\d+(?:\.\d+)?px$/);
      }
      tombstone.undo(h, { durationMs: 0 });
    }
  });
});

describe('tombstone: Rise_In (3.6 to 3.9, 3.12)', () => {
  it('plays once on creation with duration 800 and 1 iteration, leaving the host untouched', () => {
    const e = env();
    const h = ts(e, { maxOpacity: 0.96 }, 0.5);
    expect(isPlaying(spy, h.card, RISE)).toBe(true);
    expect(spy.on(h.card)[0].keyframes.at(-1)).toMatchObject({ opacity: 1 });
    expect(spy.on(hostEl())).toHaveLength(0);
    const s = hostEl().style;
    expect(Number(s.opacity)).toBeCloseTo(0.48, 3);
    expect(s.pointerEvents).toBe('none');
    expect(s.transition).toBe('');
    expect(s.animation).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    ts(e, { maxOpacity: 0.96 }, 1, h);
    ts(e, { maxOpacity: 0.96 }, 1, h);
    expect(spy.on(h.card)).toHaveLength(1); // never replays
    expect(Number(s.opacity)).toBeCloseTo(0.96, 3);
    expect(s.transition).toBe('');
    setVisibility('hidden');
    setVisibility('visible');
    expect(spy.on(h.card)).toHaveLength(1);
  });

  it('uses a riseInMs override', () => {
    const h = ts(env(), { riseInMs: 300 }, 1);
    expect(isPlaying(spy, h.card, { duration: 300, iterations: 1 })).toBe(true);
  });

  it('does not play with reducedMotion true or riseInMs 0, visible or hidden', () => {
    for (const state of ['visible', 'hidden']) {
      visibility = state;
      for (const [params, reducedMotion] of [[{}, true], [{ riseInMs: 0 }, false]]) {
        const h = ts(env({ reducedMotion }), params, 1);
        expect(isStill(spy, h.card)).toBe(true);
        expect(spy.calls).toHaveLength(0);
        expect(h.risePending).toBe(false);
        setVisibility('visible');
        expect(spy.calls).toHaveLength(0);
        expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // only the existing re-render timer
        tombstone.undo(h, { durationMs: 0 });
        expect(vi.getTimerCount()).toBe(0);
      }
    }
  });

  it('created while hidden: starts nothing until the first visible event, then exactly once', () => {
    visibility = 'hidden';
    const h = ts(env(), {}, 1);
    expect(isStill(spy, h.card)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('hidden');
    expect(spy.calls).toHaveLength(0);
    setVisibility('visible');
    expect(isPlaying(spy, h.card, RISE)).toBe(true);
    setVisibility('hidden');
    setVisibility('visible');
    expect(spy.on(h.card)).toHaveLength(1);
  });

  it('a pending Rise_In re-checks reducedMotion when the page becomes visible', () => {
    visibility = 'hidden';
    const e = env();
    const h = ts(e, {}, 1);
    e.reducedMotion = true;
    setVisibility('visible');
    expect(isStill(spy, h.card)).toBe(true);
  });

  it('schedules no timer on any apply', () => {
    const e = env();
    let h;
    for (const i of [0.2, 0.6, 1]) {
      h = ts(e, {}, i, h);
      expect(vi.getTimerCount()).toBe(0);
    }
    e.reducedMotion = true;
    ts(e, {}, 1, h);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('tombstone: reduced motion on re-apply (5.11)', () => {
  it('ends a running Rise_In at its final state and never restarts it', () => {
    const e = env();
    const h = ts(e, {}, 1);
    const [rise] = spy.on(h.card);
    e.reducedMotion = true;
    ts(e, {}, 1, h);
    expect(rise.finish).toHaveBeenCalledTimes(1);
    expect(rise.cancel).not.toHaveBeenCalled();
    expect(h.rise).toBeNull();
    e.reducedMotion = false;
    ts(e, {}, 1, h);
    expect(spy.on(h.card)).toHaveLength(1);
  });

  it('drops a pending Rise_In so the first visible event starts nothing', () => {
    visibility = 'hidden';
    const e = env();
    const h = ts(e, {}, 1);
    expect(h.risePending).toBe(true);
    e.reducedMotion = true;
    ts(e, {}, 1, h);
    expect(h.risePending).toBe(false);
    e.reducedMotion = false;
    setVisibility('visible');
    expect(isStill(spy, h.card)).toBe(true);
  });
});

describe('tombstone: undo during the Rise_In (3.13)', () => {
  it.each([[0], [600]])('undo (durationMs %s) while running cancels it and restores the snapshot', (durationMs) => {
    const before = snap();
    const h = ts(env(), {}, 1);
    const [rise] = spy.on(h.card);
    tombstone.undo(h, { durationMs });
    if (durationMs > 0) {
      expect(hostEl()).not.toBeNull();
      expect(rise.cancel).not.toHaveBeenCalled();
      vi.advanceTimersByTime(durationMs);
    }
    expect(rise.cancel).toHaveBeenCalledTimes(1);
    expect(hostEl()).toBeNull();
    expect(snap()).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('visible');
    expect(spy.calls).toHaveLength(1);
  });

  it.each([[0], [600]])('undo (durationMs %s) while pending starts no later Rise_In and restores the snapshot', (durationMs) => {
    const before = snap();
    visibility = 'hidden';
    const h = ts(env(), {}, 1);
    expect(h.risePending).toBe(true);
    tombstone.undo(h, { durationMs });
    setVisibility('visible');
    expect(spy.calls).toHaveLength(0);
    vi.advanceTimersByTime(durationMs);
    setVisibility('visible');
    expect(spy.calls).toHaveLength(0);
    expect(hostEl()).toBeNull();
    expect(snap()).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
