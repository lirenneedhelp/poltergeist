// @vitest-environment jsdom
// Structural (jsdom) tests for the overlay effects and the teardown helper.
// Layout and computed-style behavior (Requirements 10.13-10.14) is NOT covered here;
// it is verified in real Chrome by skeleton/test/browser/effects.pw.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fog from '../effects/fog.js';
import * as flicker from '../effects/flicker.js';
import * as block from '../effects/block.js';
import { teardown } from '../effects/util.js';

const makeEnv = (reducedMotion = false) => ({
  window,
  document,
  reducedMotion,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});

const count = (sel) => document.querySelectorAll(sel).length;
const z = (el) => Number(el.style.zIndex);

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = '<head></head><body><p>hi</p></body>';
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('overlay parent, geometry and z-index stack (10.1, 10.2, 10.11, 10.16)', () => {
  it('fog overlay is a fixed, inert direct child of documentElement', () => {
    const h = fog.apply(makeEnv(), {}, 0.5);
    expect(h.el.parentElement).toBe(document.documentElement);
    expect(h.el.tagName).toBe('DIV');
    expect(h.el.getAttribute('data-poltergeist')).toBe('fog');
    const s = h.el.style;
    expect([s.position, s.top, s.right, s.bottom, s.left]).toEqual(['fixed', '0px', '0px', '0px', '0px']);
    expect(s.pointerEvents).toBe('none');
    expect(s.zIndex).toBe('2147483645');
  });

  it('flicker overlay is a fixed, black, inert direct child of documentElement', () => {
    const h = flicker.apply(makeEnv(), {}, 0.5);
    expect(h.el.parentElement).toBe(document.documentElement);
    expect(h.el.getAttribute('data-poltergeist')).toBe('flicker');
    const s = h.el.style;
    expect([s.position, s.top, s.right, s.bottom, s.left]).toEqual(['fixed', '0px', '0px', '0px', '0px']);
    expect(['#000', 'rgb(0, 0, 0)', 'black']).toContain(s.background || s.backgroundColor);
    expect(s.pointerEvents).toBe('none');
    expect(s.zIndex).toBe('2147483646');
    expect(h.style.parentElement).toBe(document.documentElement);
    expect(h.style.tagName).toBe('STYLE');
    expect(h.style.getAttribute('data-poltergeist')).toBe('flicker');
  });

  it('block overlay is a direct child of documentElement, with or without body', () => {
    const h = block.apply(makeEnv(), {}, 0.5);
    expect(h.el.parentElement).toBe(document.documentElement);
    document.body.remove();
    const h2 = block.apply(makeEnv(), {}, 0.5);
    expect(h2.el.parentElement).toBe(document.documentElement);
  });

  it('z-index stack is Fog < Flicker < Block with exact values', () => {
    const env = makeEnv();
    const f = fog.apply(env, {}, 1);
    const k = flicker.apply(env, {}, 1);
    const b = block.apply(env, {}, 1);
    expect([z(f.el), z(k.el), z(b.el)]).toEqual([2147483645, 2147483646, 2147483647]);
    expect(z(f.el)).toBeLessThan(z(k.el));
    expect(z(k.el)).toBeLessThan(z(b.el));
  });
});

describe('fog formulas (10.3, 10.4)', () => {
  const bd = (el) => el.style.backdropFilter || el.style.webkitBackdropFilter;

  it('uses defaults maxBlur 6 and maxGrayscale 1', () => {
    const h = fog.apply(makeEnv(), {}, 0.5);
    expect(bd(h.el)).toBe('blur(3px) grayscale(0.5)');
  });

  it('honors custom params', () => {
    const h = fog.apply(makeEnv(), { maxBlur: 10, maxGrayscale: 0.8 }, 0.5);
    expect(bd(h.el)).toBe('blur(5px) grayscale(0.4)');
  });

  it('is 0 at intensity 0 and non-decreasing in intensity', () => {
    const env = makeEnv();
    const h = fog.apply(env, {}, 0);
    expect(bd(h.el)).toBe('blur(0px) grayscale(0)');
    let prevBlur = 0;
    let prevGray = 0;
    for (const i of [0.25, 0.5, 0.75, 1]) {
      fog.apply(env, {}, i, h);
      const m = /blur\(([\d.]+)px\) grayscale\(([\d.]+)\)/.exec(bd(h.el));
      expect(Number(m[1])).toBeGreaterThanOrEqual(prevBlur);
      expect(Number(m[2])).toBeGreaterThanOrEqual(prevGray);
      prevBlur = Number(m[1]);
      prevGray = Number(m[2]);
    }
    expect(bd(h.el)).toBe('blur(6px) grayscale(1)');
  });
});

describe('flicker formulas (10.5, 10.6)', () => {
  it('animates with default period and peak opacity when motion is allowed', () => {
    const h = flicker.apply(makeEnv(false), {}, 0.5);
    expect(h.el.style.animation).toContain('pg-flicker');
    expect(h.el.style.animation).toContain('1400ms');
    expect(h.el.style.animation).toContain('infinite');
    const css = h.style.textContent;
    expect(css).toContain('@keyframes pg-flicker');
    expect(css).toContain('opacity:0.3'); // maxDepth 0.6 * 0.5
    expect(css).not.toMatch(/opacity:0\.[4-9]/);
  });

  it('honors custom periodMs and maxDepth', () => {
    const h = flicker.apply(makeEnv(false), { periodMs: 900, maxDepth: 0.4 }, 1);
    expect(h.el.style.animation).toContain('900ms');
    expect(h.style.textContent).toContain('opacity:0.4');
  });

  it('uses a static opacity of maxDepth * i * 0.5 and no animation under reduced motion', () => {
    const h = flicker.apply(makeEnv(true), {}, 0.5);
    expect(h.el.style.animation === '' || h.el.style.animation === 'none').toBe(true);
    expect(Number(h.el.style.opacity)).toBeCloseTo(0.6 * 0.5 * 0.5, 4);
    expect(h.style.textContent).not.toMatch(/opacity:0\.[1-9]/);
  });

  it('reads reducedMotion on every apply', () => {
    const h = flicker.apply(makeEnv(false), {}, 1);
    expect(h.el.style.animation).toContain('pg-flicker');
    flicker.apply(makeEnv(true), {}, 1, h);
    expect(h.el.style.animation === '' || h.el.style.animation === 'none').toBe(true);
    expect(Number(h.el.style.opacity)).toBeCloseTo(0.3, 4);
    flicker.apply(makeEnv(false), {}, 1, h);
    expect(h.el.style.animation).toContain('pg-flicker');
  });
});

describe('update in place (10.7)', () => {
  it('keeps overlay identity and artifact counts for fog and flicker', () => {
    const env = makeEnv();
    const f = fog.apply(env, {}, 0.2);
    const k = flicker.apply(env, {}, 0.2);
    const fogEl = f.el;
    const flickerEl = k.el;
    const styleEl = k.style;
    for (const i of [0.4, 0.8, 1]) {
      expect(fog.apply(env, {}, i, f)).toBe(f);
      expect(flicker.apply(env, {}, i, k)).toBe(k);
      expect(f.el).toBe(fogEl);
      expect(k.el).toBe(flickerEl);
      expect(k.style).toBe(styleEl);
      expect(count('div[data-poltergeist="fog"]')).toBe(1);
      expect(count('div[data-poltergeist="flicker"]')).toBe(1);
      expect(count('style[data-poltergeist="flicker"]')).toBe(1);
    }
  });
});

describe('fog undo (10.8, 10.9)', () => {
  it('removes the overlay synchronously with durationMs 0', () => {
    const h = fog.apply(makeEnv(), {}, 1);
    fog.undo(h, { durationMs: 0 });
    expect(count('div[data-poltergeist="fog"]')).toBe(0);
  });

  it('defaults to immediate removal', () => {
    const h = fog.apply(makeEnv(), {}, 1);
    fog.undo(h);
    expect(count('div[data-poltergeist="fog"]')).toBe(0);
  });

  it('transitions to blur(0px) grayscale(0) and removes after durationMs', () => {
    const h = fog.apply(makeEnv(), {}, 1);
    fog.undo(h, { durationMs: 500 });
    expect(count('div[data-poltergeist="fog"]')).toBe(1);
    expect(h.el.style.transition).toContain('500ms');
    const bd = h.el.style.backdropFilter || h.el.style.webkitBackdropFilter;
    expect(bd).toBe('blur(0px) grayscale(0)');
    vi.advanceTimersByTime(499);
    expect(count('div[data-poltergeist="fog"]')).toBe(1);
    vi.advanceTimersByTime(1);
    expect(count('div[data-poltergeist="fog"]')).toBe(0);
  });
});

describe('flicker undo (10.10)', () => {
  it.each([0, 500])('removes overlay and style synchronously with durationMs %i', (durationMs) => {
    const h = flicker.apply(makeEnv(), {}, 1);
    flicker.undo(h, { durationMs });
    expect(count('div[data-poltergeist="flicker"]')).toBe(0);
    expect(count('style[data-poltergeist="flicker"]')).toBe(0);
  });
});

describe('missing body (10.15, 10.16)', () => {
  beforeEach(() => {
    document.body.remove();
    expect(document.body).toBeNull();
  });

  it('fog and flicker append to documentElement and do not throw', () => {
    const env = makeEnv();
    let f;
    let k;
    expect(() => {
      f = fog.apply(env, {}, 0.5);
      k = flicker.apply(env, {}, 0.5);
    }).not.toThrow();
    expect(f).toBeTruthy();
    expect(k).toBeTruthy();
    expect(f.el.parentElement).toBe(document.documentElement);
    expect(k.el.parentElement).toBe(document.documentElement);
    expect(() => {
      fog.undo(f);
      flicker.undo(k);
    }).not.toThrow();
  });

  it('block still appends to documentElement', () => {
    const h = block.apply(makeEnv(), {}, 1);
    expect(h.el.parentElement).toBe(document.documentElement);
    block.undo(h);
    expect(count('div[data-poltergeist="block"]')).toBe(0);
  });
});

describe('no inline styles on root or body (10.12)', () => {
  it('leaves style attributes unchanged after apply, update and undo', () => {
    document.documentElement.setAttribute('style', 'color: red');
    document.body.setAttribute('style', 'margin: 3px');
    const before = [document.documentElement.getAttribute('style'), document.body.getAttribute('style')];
    const same = () =>
      expect([document.documentElement.getAttribute('style'), document.body.getAttribute('style')]).toEqual(before);

    for (const reduced of [false, true]) {
      const env = makeEnv(reduced);
      const f = fog.apply(env, {}, 0.3);
      const k = flicker.apply(env, {}, 0.3);
      const b = block.apply(env, {}, 0.3);
      same();
      fog.apply(env, {}, 0.9, f);
      flicker.apply(env, {}, 0.9, k);
      block.apply(env, {}, 0.9, b);
      same();
      fog.undo(f, { durationMs: 100 });
      vi.advanceTimersByTime(100);
      flicker.undo(k, { durationMs: 100 });
      block.undo(b, { durationMs: 0 });
      same();
    }
  });

  it('leaves absent style attributes absent', () => {
    const env = makeEnv();
    const handles = [fog.apply(env, {}, 1), flicker.apply(env, {}, 1), block.apply(env, {}, 1)];
    expect(document.documentElement.hasAttribute('style')).toBe(false);
    expect(document.body.hasAttribute('style')).toBe(false);
    fog.undo(handles[0]);
    flicker.undo(handles[1]);
    block.undo(handles[2]);
    expect(document.documentElement.hasAttribute('style')).toBe(false);
    expect(document.body.hasAttribute('style')).toBe(false);
  });
});

describe('teardown helper (5.7-5.11)', () => {
  const makeHandle = () => ({
    env: {
      setTimeout: vi.fn((fn, ms) => setTimeout(fn, ms)),
      clearTimeout: vi.fn((id) => clearTimeout(id)),
    },
    dead: false,
    fading: false,
    timer: null,
  });

  it('positive duration begins the fade and finishes once after the delay', () => {
    const h = makeHandle();
    const begin = vi.fn();
    const finish = vi.fn();
    teardown(h, 300, begin, finish);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(finish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(h.dead).toBe(true);
  });

  it('repeated positive-duration teardown is a no-op and keeps the original timer', () => {
    const h = makeHandle();
    const begin = vi.fn();
    const finish = vi.fn();
    teardown(h, 300, begin, finish);
    const timer = h.timer;
    vi.advanceTimersByTime(100);
    teardown(h, 5000, begin, finish);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(h.timer).toBe(timer);
    expect(h.env.setTimeout).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('zero duration interrupts a pending fade and finishes immediately', () => {
    const h = makeHandle();
    const finish = vi.fn();
    teardown(h, 300, vi.fn(), finish);
    const timer = h.timer;
    teardown(h, 0, vi.fn(), finish);
    expect(h.env.clearTimeout).toHaveBeenCalledWith(timer);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(h.dead).toBe(true);
    expect(h.timer).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('zero duration on a live handle finishes immediately without begin', () => {
    const h = makeHandle();
    const begin = vi.fn();
    const finish = vi.fn();
    teardown(h, 0, begin, finish);
    expect(begin).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('finish runs at most once across mixed calls', () => {
    const h = makeHandle();
    const finish = vi.fn();
    teardown(h, 0, vi.fn(), finish);
    teardown(h, 0, vi.fn(), finish);
    teardown(h, 200, vi.fn(), finish);
    vi.advanceTimersByTime(1000);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('dead and missing handles are no-ops', () => {
    const begin = vi.fn();
    const finish = vi.fn();
    expect(() => teardown(undefined, 100, begin, finish)).not.toThrow();
    expect(() => teardown(null, 0, begin, finish)).not.toThrow();
    const dead = { ...makeHandle(), dead: true };
    teardown(dead, 100, begin, finish);
    teardown(dead, 0, begin, finish);
    expect(begin).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(dead.env.setTimeout).not.toHaveBeenCalled();
  });

  it('effect undo on dead or missing handles does not throw', () => {
    const env = makeEnv();
    for (const fx of [fog, flicker, block]) {
      const h = fx.apply(env, {}, 1);
      fx.undo(h, { durationMs: 0 });
      expect(() => fx.undo(h, { durationMs: 0 })).not.toThrow();
      expect(() => fx.undo(h, { durationMs: 100 })).not.toThrow();
      expect(() => fx.undo(undefined)).not.toThrow();
    }
  });
});
