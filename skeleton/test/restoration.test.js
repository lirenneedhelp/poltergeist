// @vitest-environment jsdom
// Restoration suite (Requirement 14): every built-in effect must leave the page byte-for-byte
// as it found it after undo.
// NOT covered here: Requirement 10.13-10.14 (layout and computed styles). Those need real
// Chrome and are verified by the Playwright test (task 7.3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { builtinEffects } from '../effects/index.js';

const PAGE = `<head><title>t</title></head><body><h1>Headline text</h1><p>Some paragraph of text here.</p></body>`;

const makeEnv = (reducedMotion = false) => ({
  window,
  document,
  reducedMotion,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});

const snap = () => ({
  html: document.documentElement.outerHTML,
  htmlStyle: document.documentElement.getAttribute('style'),
  bodyStyle: document.body ? document.body.getAttribute('style') : null,
});

const INTENSITIES = [0.1, 0.55, 1];
const NAMES = ['fog', 'flicker', 'rot', 'block'];

function setPage(html = PAGE) {
  document.documentElement.innerHTML = html;
  document.documentElement.removeAttribute('style');
}

beforeEach(() => {
  vi.useFakeTimers();
  setPage();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('registry', () => {
  it('has exactly the six built-in effects', () => {
    expect(Object.keys(builtinEffects).sort()).toEqual([...NAMES, 'tombstone', 'ritual'].sort());
  });
});

// Haunt Kit invariant 10: Undo reaches the Restored_State
describe('ritual: apply then undo', () => {
  const ritual = builtinEffects.ritual;
  const hostCount = () => document.querySelectorAll('div[data-poltergeist="ritual"]').length;

  it.each([false, true])('instant undo restores the page (reducedMotion=%s)', (reduced) => {
    const env = makeEnv(reduced);
    const before = snap();
    let h;
    for (const i of INTENSITIES) h = ritual.apply(env, {}, i, h);
    expect(hostCount()).toBe(1);
    ritual.undo(h, { durationMs: 0 });
    expect(snap()).toEqual(before);
    expect(hostCount()).toBe(0);
    expect(() => ritual.undo(h, { durationMs: 0 })).not.toThrow();
    expect(snap()).toEqual(before);
  });

  it('undo with durationMs 300 keeps the host until 300 ms, then restores the page', () => {
    const env = makeEnv();
    const before = snap();
    let h;
    for (const i of INTENSITIES) h = ritual.apply(env, {}, i, h);
    ritual.undo(h, { durationMs: 300 });
    vi.advanceTimersByTime(299);
    expect(hostCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(snap()).toEqual(before);
    expect(hostCount()).toBe(0);
  });
});

// Haunt Kit invariant 10: Undo reaches the Restored_State (ending and duration cases)
describe('ritual: ending and duration cases', () => {
  const ritual = builtinEffects.ritual;
  const hostCount = () => document.querySelectorAll('div[data-poltergeist="ritual"]').length;
  const trusted = { isTrusted: true };

  const start = (reduced = false, params = {}) => {
    const env = { ...makeEnv(reduced), onAction: vi.fn() };
    const before = snap();
    let h;
    for (const i of INTENSITIES) h = ritual.apply(env, params, i, h);
    return { env, before, h };
  };

  // Drive the path to completion through the Hint handler, one cell per call.
  const finish = (h) => {
    const total = h.board.size * h.board.size;
    for (let k = 0; k < total && !h.complete; k += 1) h.on.hint(trusted);
    expect(h.complete).toBe(true);
  };

  // Haunt Kit invariant 10: undo mid-Banishing_Ending restores the page and cancels the action
  it('undo 600 ms into the 1200 ms Banishing_Ending restores the page and makes no Exorcised_Action', () => {
    const { env, before, h } = start(false);
    finish(h);
    vi.advanceTimersByTime(600);
    expect(env.onAction).not.toHaveBeenCalled();
    ritual.undo(h, { durationMs: 0 });
    expect(snap()).toEqual(before);
    expect(hostCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(env.onAction).not.toHaveBeenCalled();
    expect(snap()).toEqual(before);
  });

  // Haunt Kit invariant 10: a zero, absent or non-finite-positive duration is instant
  it.each([
    ['0', { durationMs: 0 }],
    ['absent (no options)', undefined],
    ['absent (empty options)', {}],
    ['-5', { durationMs: -5 }],
    ['NaN', { durationMs: NaN }],
    ['Infinity', { durationMs: Infinity }],
  ])('durationMs %s restores the page before undo returns', (_label, opts) => {
    const { env, before, h } = start(false);
    if (opts === undefined) ritual.undo(h);
    else ritual.undo(h, opts);
    expect(snap()).toEqual(before);
    expect(hostCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(snap()).toEqual(before);
    expect(env.onAction).not.toHaveBeenCalled();
  });

  // Haunt Kit invariant 10: a positive duration keeps the host until it ends
  it.each([false, true])('host stays 1 ms before durationMs 500 ends, then is gone (reducedMotion=%s)', (reduced) => {
    const { before, h } = start(reduced);
    ritual.undo(h, { durationMs: 500 });
    vi.advanceTimersByTime(499);
    expect(hostCount()).toBe(1);
    vi.advanceTimersByTime(51);
    expect(snap()).toEqual(before);
    expect(hostCount()).toBe(0);
  });

  // Haunt Kit invariant 10: undo on a fading handle leaves the fade alone or finishes it
  it('a positive undo while fading changes nothing; an instant undo finishes the fade', () => {
    const { env, before, h } = start(false);
    ritual.undo(h, { durationMs: 500 });
    const fading = snap();
    expect(() => ritual.undo(h, { durationMs: 200 })).not.toThrow();
    expect(snap()).toEqual(fading);
    vi.advanceTimersByTime(499);
    expect(hostCount()).toBe(1);
    ritual.undo(h, { durationMs: 0 });
    expect(snap()).toEqual(before);
    expect(hostCount()).toBe(0);
    expect(env.onAction).not.toHaveBeenCalled();
  });

  // Haunt Kit invariant 10: a second undo is a no-op
  it('a second undo after the ritual is restored makes no DOM change, no error and no action', () => {
    const { env, before, h } = start(false);
    finish(h);
    ritual.undo(h, { durationMs: 0 });
    expect(snap()).toEqual(before);
    expect(() => ritual.undo(h, { durationMs: 0 })).not.toThrow();
    expect(() => ritual.undo(h, { durationMs: 300 })).not.toThrow();
    vi.advanceTimersByTime(2000);
    expect(snap()).toEqual(before);
    expect(hostCount()).toBe(0);
    expect(env.onAction).not.toHaveBeenCalled();
  });

  // Haunt Kit invariant 10: undo closes the chime's audio context before it returns
  describe('sound true', () => {
    let contexts;
    beforeEach(() => {
      contexts = [];
      const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
      window.AudioContext = class {
        constructor() {
          this.currentTime = 0;
          this.destination = {};
          this.close = vi.fn(() => Promise.resolve());
          this.osc = { type: '', frequency: param(), connect() {}, start() {}, stop: vi.fn() };
          contexts.push(this);
        }
        createOscillator() {
          return this.osc;
        }
        createGain() {
          return { gain: param(), connect() {} };
        }
      };
    });
    afterEach(() => {
      delete window.AudioContext;
    });

    it.each([0, 300])('undo with durationMs %s closes the audio context before returning', (d) => {
      const { env, before, h } = start(false, { sound: true });
      finish(h);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].close).not.toHaveBeenCalled();
      ritual.undo(h, { durationMs: d });
      expect(contexts[0].close).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2000);
      expect(snap()).toEqual(before);
      expect(hostCount()).toBe(0);
      expect(env.onAction).not.toHaveBeenCalled();
    });
  });
});

// Haunt Kit invariant 11: Reduced_Motion means no motion
describe('ritual: reduced motion', () => {
  const ritual = builtinEffects.ritual;
  let animate;
  beforeEach(() => {
    animate = vi.fn(() => ({ cancel() {}, finish() {} }));
    Element.prototype.animate = animate;
  });
  afterEach(() => {
    delete Element.prototype.animate;
  });

  it('starts no animation or transition and has no @keyframes', () => {
    const env = makeEnv(true);
    let h;
    for (const i of INTENSITIES) h = ritual.apply(env, {}, i, h);
    const nodes = [h.host, ...h.root.querySelectorAll('*')];
    expect(animate).not.toHaveBeenCalled();
    for (const node of nodes) {
      expect(node.style.animation || '').toBe('');
      expect(node.style.transition || '').toBe('');
      expect(['', 'none']).toContain(getComputedStyle(node).animationName ?? '');
    }
    const css = h.root.querySelector('style').textContent;
    expect(css).not.toMatch(/@keyframes/i);
    expect(css).not.toMatch(/\banimation\b|\btransition\b/i);
    ritual.undo(h, { durationMs: 300 });
    expect(h.host.style.transition || '').toBe('');
    expect(h.host.style.opacity).toBe('0');
    ritual.undo(h, { durationMs: 0 });
    expect(animate).not.toHaveBeenCalled();
  });
});

describe.each(NAMES)('%s: apply at several intensities then instant undo', (name) => {
  for (const reduced of name === 'flicker' ? [false, true] : [false]) {
    const label = name === 'flicker' ? ` (reducedMotion=${reduced})` : '';

    it(`restores the page${label} and a second undo is a no-op`, () => {
      const fx = builtinEffects[name];
      const env = makeEnv(reduced);
      const before = snap();
      let h;
      for (const i of INTENSITIES) h = fx.apply(env, {}, i, h);
      expect(h).toBeDefined();
      expect(snap()).not.toEqual(before);
      fx.undo(h, { durationMs: 0 });
      expect(snap()).toEqual(before);
      const after = snap();
      expect(() => fx.undo(h, { durationMs: 0 })).not.toThrow();
      expect(snap()).toEqual(after);
    });
  }
});

describe.each(['fog', 'block'])('%s: fade undo', (name) => {
  it('restores the page after advancing exactly durationMs', () => {
    const fx = builtinEffects[name];
    const env = makeEnv();
    const before = snap();
    let h;
    for (const i of INTENSITIES) h = fx.apply(env, {}, i, h);
    fx.undo(h, { durationMs: 500 });
    vi.advanceTimersByTime(499);
    expect(snap()).not.toEqual(before);
    vi.advanceTimersByTime(1);
    expect(snap()).toEqual(before);
    const after = snap();
    expect(() => fx.undo(h, { durationMs: 0 })).not.toThrow();
    expect(snap()).toEqual(after);
  });

  it('restores the page when an instant undo interrupts a fade, without advancing timers', () => {
    const fx = builtinEffects[name];
    const env = makeEnv();
    const before = snap();
    let h;
    for (const i of INTENSITIES) h = fx.apply(env, {}, i, h);
    fx.undo(h, { durationMs: 500 });
    fx.undo(h, { durationMs: 0 });
    expect(snap()).toEqual(before);
    vi.advanceTimersByTime(1000);
    expect(snap()).toEqual(before);
  });
});

describe('rot scenarios', () => {
  const rot = builtinEffects.rot;

  it('restores pre-existing text, including text in nested and sibling nodes', () => {
    setPage('<head></head><body>loose text<div>a<b>bold</b>b<i>ital</i></div> <span>x y z</span></body>');
    const before = snap();
    let h;
    for (const i of INTENSITIES) h = rot.apply(makeEnv(), { maxFraction: 1 }, i, h);
    expect(document.body.textContent).not.toBe('loose textaboldbital x y z');
    rot.undo(h, { durationMs: 0 });
    expect(snap()).toEqual(before);
  });

  it('restores a page containing every skipped element type', () => {
    setPage(
      '<head><style>p{color:red}</style></head><body>' +
        '<script>var a = "script text";</script>' +
        '<style>.x{color:blue}</style>' +
        '<noscript>noscript text</noscript>' +
        '<textarea>textarea text</textarea>' +
        '<input value="input text">' +
        '<code>code text</code>' +
        '<div contenteditable="true">editable text</div>' +
        '<p>visible text</p></body>'
    );
    const before = snap();
    let h;
    for (const i of INTENSITIES) h = rot.apply(makeEnv(), { maxFraction: 1 }, i, h);
    rot.undo(h, { durationMs: 0 });
    expect(snap()).toEqual(before);
    rot.undo(h, { durationMs: 0 });
    expect(snap()).toEqual(before);
  });

  it('after a page rewrite and reapply, undo restores the rewritten text', () => {
    const env = makeEnv();
    let h;
    h = rot.apply(env, { maxFraction: 1 }, 0.5, h);
    const p = document.querySelector('p').firstChild;
    p.data = 'Brand new rewritten content';
    h = rot.apply(env, { maxFraction: 1 }, 0.8, h);
    expect(p.data).not.toBe('Brand new rewritten content');
    // Expected page: original page with the rewrite, no rot.
    rot.undo(h, { durationMs: 0 });
    const afterUndo = snap();
    // Un-hauntd reference: same page with the rewrite applied directly.
    setPage();
    document.querySelector('p').firstChild.data = 'Brand new rewritten content';
    const reference = snap();
    // h1 was rotted then restored, so it matches the fresh page; compare against reference.
    expect(afterUndo).toEqual(reference);
  });

  it('after a rewrite with no reapply, undo leaves the rewritten text untouched', () => {
    const env = makeEnv();
    const h = rot.apply(env, { maxFraction: 1 }, 1, undefined);
    const p = document.querySelector('p').firstChild;
    p.data = 'Rewritten by the page';
    rot.undo(h, { durationMs: 0 });
    expect(p.data).toBe('Rewritten by the page');
    expect(document.querySelector('h1').textContent).toBe('Headline text');
  });
});

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((rest) => [x, ...rest])
  );
}

describe('combined effects undone in every order', () => {
  const orders = permutations(NAMES);
  const label = (o) => o.join('>');

  it('has 24 permutations including applied, reverse and an interleaved order', () => {
    expect(orders).toHaveLength(24);
    const labels = orders.map(label);
    expect(labels).toContain('fog>flicker>rot>block');
    expect(labels).toContain('block>rot>flicker>fog');
    expect(labels).toContain('flicker>block>fog>rot');
  });

  describe.each([false, true])('reducedMotion=%s', (reduced) => {
    it.each(orders.map((o) => [label(o), o]))('undo order %s restores the page', (_l, order) => {
      const env = makeEnv(reduced);
      const before = snap();
      const handles = {};
      for (const name of NAMES) {
        for (const i of INTENSITIES) handles[name] = builtinEffects[name].apply(env, {}, i, handles[name]);
      }
      for (const name of order) builtinEffects[name].undo(handles[name], { durationMs: 0 });
      expect(snap()).toEqual(before);
      for (const name of order) expect(() => builtinEffects[name].undo(handles[name], { durationMs: 0 })).not.toThrow();
      expect(snap()).toEqual(before);
    });
  });
});
