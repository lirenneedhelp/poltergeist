// @vitest-environment jsdom
// Tombstone effect (Requirements 4.1-4.10, 10.3).
// The trusted-click path cannot be produced in jsdom (scripted events have isTrusted false);
// a real click in the graveyard Playwright suite covers it (task 7.3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as tombstone from '../effects/tombstone.js';
import { builtinEffects } from '../effects/index.js';

const PAGE = '<head><title>Lecture 4 notes</title></head><body><h1>Headline text</h1><p>Some paragraph of text here.</p></body>';

let meterValue;
let actions;
const makeEnv = (overrides = {}) => ({
  window,
  document,
  reducedMotion: false,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  readMeter: (name) => (name === 'timeAway' ? meterValue : undefined),
  onAction: (name) => actions.push(name),
  ...overrides,
});

// Every handle is undone after each test so no listener leaks onto the shared document.
let created = [];
const ts = (...args) => {
  const h = tombstone.apply(...args);
  created.push(h);
  return h;
};

const snap = () => document.documentElement.outerHTML;
const hostEl = () => document.querySelector('[data-poltergeist="tombstone"]');
const texts = (h) => ({ heading: h.headingEl.textContent, message: h.messageEl.textContent });

let visibility = 'visible';
function setVisibility(state) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = PAGE;
  document.documentElement.removeAttribute('style');
  meterValue = 93600;
  actions = [];
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  for (const h of created) tombstone.undo(h, { durationMs: 0 });
  created = [];
  delete document.visibilityState;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('tombstone: module and registry (4.1)', () => {
  it('exports the effect contract and is registered as tombstone', () => {
    expect(typeof tombstone.apply).toBe('function');
    expect(typeof tombstone.undo).toBe('function');
    expect(typeof tombstone.description).toBe('string');
    expect(builtinEffects.tombstone.apply).toBe(tombstone.apply);
    expect(builtinEffects.tombstone.undo).toBe(tombstone.undo);
  });
});

describe('tombstone: markup (4.2, 4.3, 4.10)', () => {
  it('appends one host on documentElement with an open shadow root holding heading, message, and button', () => {
    const h = ts(makeEnv(), {}, 1);
    const host = hostEl();
    expect(host).not.toBeNull();
    expect(host.parentNode).toBe(document.documentElement);
    expect(document.querySelectorAll('[data-poltergeist="tombstone"]')).toHaveLength(1);
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot.mode).toBe('open');
    expect(host.childNodes).toHaveLength(0); // nothing in the light DOM
    expect(document.querySelector('button')).toBeNull();
    const root = host.shadowRoot;
    expect(root.querySelector('h1')).toBe(h.headingEl);
    expect(root.querySelector('p')).toBe(h.messageEl);
    const buttons = root.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].type).toBe('button');
    expect(buttons[0].textContent).toBe('Resurrect');
  });

  it('reuses the live handle and host on later applies', () => {
    const env = makeEnv();
    const h = ts(env, {}, 0.3);
    const again = ts(env, {}, 0.8, h);
    expect(again).toBe(h);
    expect(document.querySelectorAll('[data-poltergeist="tombstone"]')).toHaveLength(1);
  });

  it('uses fixed full-viewport positioning at the top z-index, opacity from intensity, and blocks at blockAt', () => {
    const env = makeEnv();
    const h = ts(env, { maxOpacity: 0.96 }, 0.5);
    const s = hostEl().style;
    expect(s.position).toBe('fixed');
    expect(s.zIndex).toBe('2147483647');
    expect(Number(s.opacity)).toBeCloseTo(0.48, 3);
    expect(s.pointerEvents).toBe('none');
    ts(env, { maxOpacity: 0.96 }, 1, h);
    expect(Number(s.opacity)).toBeCloseTo(0.96, 3);
    expect(s.pointerEvents).toBe('auto');
    ts(env, { maxOpacity: 0.96, blockAt: 0.4 }, 0.5, h);
    expect(s.pointerEvents).toBe('auto');
  });

  it('plays the Rise_In only when motion is allowed and schedules no timers when applied', () => {
    const calls = [];
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: vi.fn(function animate(keyframes, options) {
        const anim = { target: this, keyframes, options, cancel: vi.fn(), finish: vi.fn() };
        calls.push(anim);
        return anim;
      }),
    });
    try {
      for (const [params, reducedMotion, plays] of [[{}, false, true], [{}, true, false], [{ riseInMs: 0 }, false, false]]) {
        calls.length = 0;
        const h = ts(makeEnv({ reducedMotion }), params, 1);
        expect(hostEl().style.transition).toBe('');
        expect(hostEl().style.animation).toBe('');
        expect(['', 'none']).toContain(h.card.style.animation);
        const onCard = calls.filter((c) => c.target === h.card);
        if (plays) {
          expect(onCard).toHaveLength(1);
          expect(onCard[0].options).toMatchObject({ duration: 800, iterations: 1 });
        } else {
          expect(onCard).toHaveLength(0);
        }
        expect(calls.filter((c) => c.target === hostEl())).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
        tombstone.undo(h, { durationMs: 0 });
      }
    } finally {
      delete Element.prototype.animate;
    }
  });
});

describe('tombstone: placeholders (4.4, 4.5)', () => {
  const H = 3600;
  it.each([
    [0, '0 seconds'],
    [1, '1 second'],
    [59.9, '59 seconds'],
    [60, '1 minute'],
    [119, '1 minute'],
    [3599, '59 minutes'],
    [H, '1 hour'],
    [26 * H, '26 hours'],
    [48 * H - 1, '47 hours'],
    [48 * H, '2 days'],
    [86400 * 30, '30 days'],
  ])('timeAway %s renders "%s"', (seconds, words) => {
    meterValue = seconds;
    const h = ts(makeEnv(), {}, 1);
    expect(texts(h)).toEqual({ heading: 'Here lies Lecture 4 notes', message: `Abandoned for ${words}.` });
  });

  it('formatDuration keeps hours up to 48 hours, then whole days', () => {
    expect(tombstone.formatDuration(86400)).toBe('24 hours');
    expect(tombstone.formatDuration(86400 * 1.5)).toBe('36 hours');
    expect(tombstone.formatDuration(86400 * 3 - 1)).toBe('2 days');
    expect(tombstone.formatDuration(86400 * 3)).toBe('3 days');
  });

  it.each([[NaN], [Infinity], [undefined], ['93600'], [null]])('a non-finite meter value (%s) renders "a while"', (v) => {
    meterValue = v;
    const h = ts(makeEnv(), {}, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for a while.');
  });

  it('renders "a while" when env.readMeter is missing', () => {
    const env = makeEnv();
    delete env.readMeter;
    const h = ts(env, {}, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for a while.');
  });

  it('reads the meter named by durationMeter', () => {
    const env = makeEnv({ readMeter: (name) => (name === 'timeOnSite' ? 120 : 5) });
    const h = ts(env, { durationMeter: 'timeOnSite' }, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for 2 minutes.');
  });

  it('trims the title and falls back to the hostname, then to "this page"', () => {
    document.title = '   Spaced title  ';
    const env = makeEnv({ window: { location: { hostname: 'example.edu' } } });
    let h = ts(env, {}, 1);
    expect(h.headingEl.textContent).toBe('Here lies Spaced title');
    document.title = '   ';
    h = ts(env, {}, 1, h);
    expect(h.headingEl.textContent).toBe('Here lies example.edu');
    // A handle keeps the env it was created with, so use a fresh one for a new hostname.
    const blank = ts(makeEnv({ window: { location: { hostname: '' } } }), {}, 1);
    expect(blank.headingEl.textContent).toBe('Here lies this page');
  });

  it('truncates a long title to 120 characters with an ellipsis', () => {
    document.title = 'x'.repeat(300);
    const h = ts(makeEnv(), { heading: '{title}' }, 1);
    const shown = h.headingEl.textContent;
    expect(Array.from(shown)).toHaveLength(120);
    expect(shown.endsWith('\u2026')).toBe(true);
    document.title = 'y'.repeat(120);
    ts(makeEnv(), { heading: '{title}' }, 1, h);
    expect(h.headingEl.textContent).toBe('y'.repeat(120));
  });

  it('uses custom heading, message, and action label params', () => {
    meterValue = 120;
    const h = ts(makeEnv(), { heading: 'RIP {title}', message: '{duration} ago, {title}', actionLabel: 'Revive' }, 1);
    expect(texts(h)).toEqual({ heading: 'RIP Lecture 4 notes', message: '2 minutes ago, Lecture 4 notes' });
    expect(h.button.textContent).toBe('Revive');
  });
});

describe('tombstone: text safety (4.6)', () => {
  it('renders a title containing markup as literal text', () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    document.title = evil;
    window.__pwned = undefined;
    const h = ts(makeEnv(), {}, 1);
    expect(h.headingEl.textContent).toBe(`Here lies ${evil}`);
    expect(h.root.querySelector('img')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(h.headingEl.innerHTML).toContain('&lt;img');
    expect(window.__pwned).toBeUndefined();
  });

  it('keeps replacement patterns such as $& literal', () => {
    document.title = "Price $& $1 $' $$";
    meterValue = 5;
    const h = ts(makeEnv(), {}, 1);
    expect(h.headingEl.textContent).toBe("Here lies Price $& $1 $' $$");
  });
});

describe('tombstone: actions (4.8)', () => {
  it('ignores a scripted click() and a dispatched untrusted click', () => {
    const h = ts(makeEnv(), {}, 1);
    h.button.click();
    h.button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(actions).toEqual([]);
  });

  it('the click handler forwards a trusted event once and contains a thrown onAction error', () => {
    // jsdom cannot create a trusted event, so the handler is driven with an event-shaped object.
    const h = ts(makeEnv(), { action: 'resurrect' }, 1);
    h.onClick({ isTrusted: true });
    expect(actions).toEqual(['resurrect']);

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwing = ts(makeEnv({ onAction: () => { throw new Error('boom'); } }), {}, 1);
    expect(() => throwing.onClick({ isTrusted: true })).not.toThrow();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('does nothing when env.onAction is missing', () => {
    const env = makeEnv();
    delete env.onAction;
    const h = ts(env, {}, 1);
    expect(() => h.onClick({ isTrusted: true })).not.toThrow();
  });
});

describe('tombstone: re-render (4.7)', () => {
  it('re-renders on every apply', () => {
    const env = makeEnv();
    meterValue = 90000;
    const h = ts(env, {}, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for 25 hours.');
    meterValue = 200000;
    ts(env, {}, 1, h);
    expect(h.messageEl.textContent).toBe('Abandoned for 2 days.');
  });

  it('re-renders on the next timer turn after the document becomes visible', () => {
    meterValue = 90000;
    const h = ts(makeEnv(), {}, 1);
    setVisibility('hidden');
    meterValue = 200000;
    expect(vi.getTimerCount()).toBe(0); // hidden does not schedule a render
    setVisibility('visible');
    expect(h.messageEl.textContent).toBe('Abandoned for 25 hours.');
    vi.advanceTimersByTime(0);
    expect(h.messageEl.textContent).toBe('Abandoned for 2 days.');
  });

  it('coalesces repeated visible events into one pending render', () => {
    ts(makeEnv(), {}, 1);
    setVisibility('visible');
    setVisibility('visible');
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('tombstone: undo and restoration (4.9)', () => {
  it('instant undo removes the host and restores outerHTML byte-for-byte; a second undo is a no-op', () => {
    const before = snap();
    const env = makeEnv();
    let h;
    for (const i of [0.1, 0.55, 1]) h = ts(env, {}, i, h);
    expect(snap()).not.toBe(before);
    tombstone.undo(h, { durationMs: 0 });
    expect(hostEl()).toBeNull();
    expect(snap()).toBe(before);
    expect(() => tombstone.undo(h, { durationMs: 0 })).not.toThrow();
    expect(snap()).toBe(before);
  });

  it('fade undo releases pointers at once, keeps the host until durationMs, then restores exactly', () => {
    const before = snap();
    const h = ts(makeEnv(), {}, 1);
    tombstone.undo(h, { durationMs: 600 });
    const host = hostEl();
    expect(host).not.toBeNull();
    expect(host.style.pointerEvents).toBe('none');
    expect(host.style.opacity).toBe('0');
    expect(host.style.transition).toContain('600ms');
    vi.advanceTimersByTime(599);
    expect(hostEl()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(hostEl()).toBeNull();
    expect(snap()).toBe(before);
  });

  it('an instant undo during a fade finishes it at once', () => {
    const before = snap();
    const h = ts(makeEnv(), {}, 1);
    tombstone.undo(h, { durationMs: 600 });
    tombstone.undo(h, { durationMs: 0 });
    expect(snap()).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes both listeners and any pending render timer', () => {
    const removeDoc = vi.spyOn(document, 'removeEventListener');
    const h = ts(makeEnv(), {}, 1);
    const removeBtn = vi.spyOn(h.button, 'removeEventListener');
    setVisibility('visible'); // schedules a render
    expect(vi.getTimerCount()).toBe(1);
    tombstone.undo(h, { durationMs: 0 });
    expect(vi.getTimerCount()).toBe(0);
    expect(removeDoc).toHaveBeenCalledWith('visibilitychange', h.onVisible);
    expect(removeBtn).toHaveBeenCalledWith('click', h.onClick);
    setVisibility('visible');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('apply after undo creates a fresh host', () => {
    const env = makeEnv();
    const h = ts(env, {}, 1);
    tombstone.undo(h, { durationMs: 0 });
    const h2 = ts(env, {}, 1, h);
    expect(h2).not.toBe(h);
    expect(document.querySelectorAll('[data-poltergeist="tombstone"]')).toHaveLength(1);
    tombstone.undo(h2, { durationMs: 0 });
  });
});

describe('tombstone alongside rot', () => {
  it('rot never changes tombstone text, and undoing both restores the page', async () => {
    const before = snap();
    const env = makeEnv();
    const rot = builtinEffects.rot;
    let r = rot.apply(env, { maxFraction: 1, glyphs: '#' }, 1);
    const t = ts(env, {}, 1);
    const expected = texts(t);
    expect(expected).toEqual({ heading: 'Here lies Lecture 4 notes', message: 'Abandoned for 26 hours.' });
    expect(document.querySelector('h1').textContent).toBe('######## ####');

    r = rot.apply(env, { maxFraction: 1, glyphs: '#' }, 1, r);
    for (let i = 0; i < 4; i++) await Promise.resolve(); // deliver observer records
    await vi.advanceTimersByTimeAsync(1000);
    expect(texts(t)).toEqual(expected);
    expect(t.button.textContent).toBe('Resurrect');

    tombstone.undo(t, { durationMs: 0 });
    rot.undo(r);
    expect(snap()).toBe(before);
  });
});
