// @vitest-environment jsdom
// haunt-polish Requirement 2: the Block finale (shadow root, ghost, second line, Fade_In).
// Example-based only (Requirement 9.1). Motion is observed through the animate spy (Requirement 9.8).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as block from '../effects/block.js';
import { installAnimateSpy, makeEnv, isPlaying, isStill } from './polish-helpers.js';

const PAGE = '<head><title>t</title></head><body><h1>Headline text</h1><p>Some paragraph of text here.</p></body>';
const MESSAGE = 'You have scrolled long enough. Close this tab and take a break.';
const DETAIL = 'You lost {duration} to this feed.';
const FADE = { duration: 1500, iterations: 1 };

const snap = () => ({
  html: document.documentElement.outerHTML,
  htmlStyle: document.documentElement.getAttribute('style'),
  bodyStyle: document.body ? document.body.getAttribute('style') : null,
});

const hosts = () => document.documentElement.querySelectorAll(':scope > [data-poltergeist="block"]');
const px = (el) => parseFloat(el.style.fontSize);
const motionTargets = (h) => [h.figureEl, h.messageEl, h.detailEl].filter(Boolean);

let spy;
let created;
let meters;
const env = (overrides = {}) => makeEnv({ readMeter: (name) => meters[name], ...overrides });
const bl = (...args) => {
  const h = block.apply(...args);
  if (!created.includes(h)) created.push(h);
  return h;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = PAGE;
  document.documentElement.removeAttribute('style');
  spy = installAnimateSpy();
  created = [];
  meters = { timeOnSite: 1200, scrollDistance: 7200 };
});
afterEach(() => {
  for (const h of created) block.undo(h, { durationMs: 0 });
  spy.restore();
  vi.useRealTimers();
});

describe('block: overlay structure (2.10, 2.11)', () => {
  it('has an open shadow root, no light-DOM elements, and textContent equal to message', () => {
    const message = 'Stop after {duration} please';
    const h = bl(env(), { message, detail: DETAIL }, 1);
    expect(hosts()).toHaveLength(1);
    expect(h.el.shadowRoot).not.toBeNull();
    expect(h.el.shadowRoot.mode).toBe('open');
    expect(h.el.children).toHaveLength(0);
    expect(h.el.childNodes).toHaveLength(1);
    expect(h.el.textContent).toBe(message);
    expect(h.el.getAttribute('role')).toBe('status');
    expect(h.el.parentNode).toBe(document.documentElement);
  });

  it('shows the message through a slot inside the message element', () => {
    const h = bl(env(), { message: MESSAGE }, 1);
    expect(h.messageEl.querySelector('slot')).not.toBeNull();
    expect(h.el.shadowRoot.contains(h.messageEl)).toBe(true);
  });
});

describe('block: figure (2.2, 2.3)', () => {
  it('draws exactly one aria-hidden svg ghost before the message by default', () => {
    const h = bl(env(), { message: MESSAGE }, 1);
    const hidden = h.el.shadowRoot.querySelectorAll('[aria-hidden="true"]');
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toBe(h.figureEl);
    expect(hidden[0].localName).toBe('svg');
    expect(hidden[0].namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(hidden[0].querySelector('path')).not.toBeNull();
    expect(hidden[0].querySelectorAll('ellipse')).toHaveLength(3);
    const kids = [...h.stage.children];
    expect(kids.indexOf(h.figureEl)).toBeLessThan(kids.indexOf(h.messageEl));
    expect(h.stage.style.flexDirection).toBe('column');
  });

  it('draws no figure for figure "none"', () => {
    const h = bl(env(), { message: MESSAGE, figure: 'none' }, 1);
    expect(h.figureEl).toBeNull();
    expect(h.el.shadowRoot.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(h.el.shadowRoot.querySelector('svg')).toBeNull();
  });
});

describe('block: second line (2.4, 2.5)', () => {
  it('renders no p by default', () => {
    const h = bl(env(), { message: MESSAGE }, 1);
    expect(h.el.shadowRoot.querySelectorAll('p')).toHaveLength(0);
    expect(h.detailEl).toBeNull();
  });

  it('renders one p after the message with the filled detail', () => {
    meters.timeOnSite = 1200;
    const h = bl(env(), { message: MESSAGE, detail: DETAIL }, 1);
    const ps = h.el.shadowRoot.querySelectorAll('p');
    expect(ps).toHaveLength(1);
    expect(ps[0]).toBe(h.detailEl);
    expect(ps[0].textContent).toBe('You lost 20 minutes to this feed.');
    const kids = [...h.stage.children];
    expect(kids.indexOf(h.detailEl)).toBeGreaterThan(kids.indexOf(h.messageEl));
  });

  it('reads timeOnSite by default and the named meter when durationMeter is set', () => {
    const a = bl(env(), { detail: '{duration}' }, 1);
    expect(a.detailEl.textContent).toBe('20 minutes');
    block.undo(a, { durationMs: 0 });
    const b = bl(env(), { detail: '{duration}', durationMeter: 'scrollDistance' }, 1);
    expect(b.detailEl.textContent).toBe('2 hours');
  });
});

describe('block: font sizes (2.1)', () => {
  it('uses fixed px sizes: message at least 36px and detail 24px', () => {
    const h = bl(env(), { message: MESSAGE, detail: DETAIL }, 1);
    expect(h.messageEl.style.fontSize).toMatch(/px$/);
    expect(px(h.messageEl)).toBeGreaterThanOrEqual(36);
    expect(h.detailEl.style.fontSize).toBe('24px');
  });
});

describe('block: re-apply (2.6)', () => {
  it('keeps the same overlay, figure, and p, updates the text, and does not replay', () => {
    const e = env();
    const h = bl(e, { message: MESSAGE, detail: DETAIL }, 0.5);
    const { el, figureEl, detailEl } = h;
    const callsAfterCreate = spy.calls.length;
    meters.timeOnSite = 3600;
    const h2 = bl(e, { message: 'Second message', detail: 'Now {duration}.' }, 1, h);
    expect(h2).toBe(h);
    expect(hosts()).toHaveLength(1);
    expect(h.el).toBe(el);
    expect(h.figureEl).toBe(figureEl);
    expect(h.detailEl).toBe(detailEl);
    expect(h.el.shadowRoot.querySelectorAll('svg')).toHaveLength(1);
    expect(h.el.textContent).toBe('Second message');
    expect(h.detailEl.textContent).toBe('Now 1 hour.');
    expect(spy.calls).toHaveLength(callsAfterCreate);
  });
});

describe('block: Fade_In (2.7, 2.8, 2.9, 5.11, 9.7)', () => {
  it('plays on figure, message, and detail for 1500 ms and 1 iteration by default', () => {
    const h = bl(env(), { message: MESSAGE, detail: DETAIL }, 1);
    expect(motionTargets(h)).toHaveLength(3);
    for (const el of motionTargets(h)) {
      expect(isPlaying(spy, el, FADE)).toBe(true);
      expect(spy.on(el)[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    }
    expect(spy.calls).toHaveLength(3);
  });

  it('uses fadeInMs 400 when set', () => {
    const h = bl(env(), { message: MESSAGE, detail: DETAIL, fadeInMs: 400 }, 1);
    for (const el of motionTargets(h)) expect(isPlaying(spy, el, { duration: 400, iterations: 1 })).toBe(true);
  });

  it('does not play when reducedMotion is true', () => {
    const h = bl(env({ reducedMotion: true }), { message: MESSAGE, detail: DETAIL }, 1);
    for (const el of motionTargets(h)) expect(isStill(spy, el)).toBe(true);
    expect(spy.calls).toHaveLength(0);
  });

  it('does not play when fadeInMs is 0', () => {
    const h = bl(env(), { message: MESSAGE, detail: DETAIL, fadeInMs: 0 }, 1);
    for (const el of motionTargets(h)) expect(isStill(spy, el)).toBe(true);
    expect(spy.calls).toHaveLength(0);
  });

  it('re-apply with reducedMotion true calls finish() on each and never restarts', () => {
    const h = bl(env(), { message: MESSAGE, detail: DETAIL }, 1);
    const anims = [...spy.calls];
    bl(env({ reducedMotion: true }), { message: MESSAGE, detail: DETAIL }, 1, h);
    for (const a of anims) {
      expect(a.finish).toHaveBeenCalledTimes(1);
      expect(a.playState).toBe('finished');
    }
    bl(env(), { message: MESSAGE, detail: DETAIL }, 1, h);
    expect(spy.calls).toHaveLength(anims.length);
  });

  it('keeps the overlay opacity and pointer-events while the Fade_In runs', () => {
    const e = env();
    const h = bl(e, { message: MESSAGE, maxOpacity: 0.96, blockAt: 0.8 }, 0.5);
    expect(spy.on(h.el)).toHaveLength(0);
    expect(Number(h.el.style.opacity)).toBe(0.48);
    expect(h.el.style.pointerEvents).toBe('none');
    bl(e, { message: MESSAGE, maxOpacity: 0.96, blockAt: 0.8 }, 1, h);
    expect(Number(h.el.style.opacity)).toBe(0.96);
    expect(h.el.style.pointerEvents).toBe('auto');
    expect(spy.on(h.el)).toHaveLength(0);
    expect(spy.calls.every((a) => a.playState === 'running')).toBe(true);
  });
});

describe('block: undo during the Fade_In (2.13, 2.14)', () => {
  it('instant undo cancels the Fade_In and restores the snapshot', () => {
    const before = snap();
    const h = bl(env(), { message: MESSAGE, detail: DETAIL }, 1);
    const anims = [...spy.calls];
    expect(anims).toHaveLength(3);
    block.undo(h, { durationMs: 0 });
    for (const a of anims) {
      expect(a.cancel).toHaveBeenCalledTimes(1);
      expect(a.playState).toBe('idle');
    }
    expect(snap()).toEqual(before);
    expect(() => block.undo(h, { durationMs: 0 })).not.toThrow();
    expect(snap()).toEqual(before);
  });

  it('fade undo restores the snapshot exactly durationMs later and then cancels the Fade_In', () => {
    const before = snap();
    const h = bl(env(), { message: MESSAGE, detail: DETAIL }, 1);
    const anims = [...spy.calls];
    block.undo(h, { durationMs: 600 });
    vi.advanceTimersByTime(599);
    expect(snap()).not.toEqual(before);
    vi.advanceTimersByTime(1);
    expect(snap()).toEqual(before);
    for (const a of anims) expect(a.playState).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });
});
