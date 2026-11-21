// @vitest-environment jsdom
// haunt-polish Requirement 1: demo-scalable duration text.
// Example-based only (Requirement 9.1). The Block half is added by task 2.2.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as tombstone from '../effects/tombstone.js';
import * as util from '../effects/util.js';
import { makeEnv } from './polish-helpers.js';

const PAGE = '<head><title>Lecture 4 notes</title></head><body><h1>Headline text</h1><p>Some paragraph of text here.</p></body>';
const DEMO_SUFFIX = ' (demo time)';
const H = 3600;

let visibility = 'visible';
function setVisibility(state) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = PAGE;
  document.documentElement.removeAttribute('style');
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  delete document.visibilityState;
  vi.useRealTimers();
});

describe('formatDuration (1.6)', () => {
  it('tombstone.formatDuration is the shared util implementation', () => {
    expect(tombstone.formatDuration).toBe(util.formatDuration);
  });

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
    [86400, '24 hours'],
    [86400 * 1.5, '36 hours'],
    [86400 * 3 - 1, '2 days'],
    [86400 * 3, '3 days'],
  ])('matches the pinned table: %s -> "%s"', (seconds, words) => {
    expect(tombstone.formatDuration(seconds)).toBe(words);
  });

  it.each([[NaN], [Infinity], [-Infinity], [undefined], [null], ['93600']])('non-finite input %s gives "a while"', (v) => {
    expect(tombstone.formatDuration(v)).toBe('a while');
  });
});

describe('tombstone: duration params (1.3 to 1.5, 1.8, 1.10)', () => {
  let meterValue;
  let created;
  const env = (overrides = {}) =>
    makeEnv({ readMeter: (name) => (name === 'timeAway' ? meterValue : undefined), ...overrides });
  const ts = (...args) => {
    const h = tombstone.apply(...args);
    created.push(h);
    return h;
  };
  const demo = { durationScale: H, durationSuffix: DEMO_SUFFIX };

  beforeEach(() => {
    meterValue = 33;
    created = [];
  });
  afterEach(() => {
    for (const h of created) tombstone.undo(h, { durationMs: 0 });
  });

  it('shows "33 hours (demo time)" for 33 seconds at scale 3600', () => {
    const h = ts(env(), demo, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for 33 hours (demo time).');
  });

  it('shows "2 days (demo time)" for 48 seconds at scale 3600', () => {
    meterValue = 48;
    const h = ts(env(), demo, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for 2 days (demo time).');
  });

  it('shows "a while" with no suffix when readMeter is missing', () => {
    const e = env();
    delete e.readMeter;
    const h = ts(e, demo, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for a while.');
  });

  it('shows "a while" with no suffix when readMeter returns NaN', () => {
    meterValue = NaN;
    const h = ts(env(), demo, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for a while.');
  });

  it.each([[0], [-1], ['60']])('uses scale 1 for durationScale %s', (durationScale) => {
    meterValue = 120;
    const h = ts(env(), { durationScale, durationSuffix: DEMO_SUFFIX }, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for 2 minutes (demo time).');
  });

  it.each([[5], [null]])('uses an empty suffix for durationSuffix %s', (durationSuffix) => {
    const h = ts(env(), { durationScale: H, durationSuffix }, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for 33 hours.');
  });

  it('takes the suffix literally, so a {title} inside it is not replaced', () => {
    const h = ts(env(), { durationScale: H, durationSuffix: ' {title}' }, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for 33 hours {title}.');
    expect(h.headingEl.textContent).toBe('Here lies Lecture 4 notes');
  });

  it('re-apply uses the latest params and meter value', () => {
    const e = env();
    const h = ts(e, demo, 1);
    expect(h.messageEl.textContent).toBe('Abandoned for 33 hours (demo time).');
    meterValue = 40;
    ts(e, { durationScale: 60, durationSuffix: ' (sim)' }, 1, h);
    expect(h.messageEl.textContent).toBe('Abandoned for 40 minutes (sim).');
    ts(e, {}, 1, h);
    expect(h.messageEl.textContent).toBe('Abandoned for 40 seconds.');
  });

  it('re-render after visibilitychange uses the latest params and meter value', () => {
    const e = env();
    const h = ts(e, {}, 1);
    ts(e, demo, 1, h);
    setVisibility('hidden');
    meterValue = 50;
    setVisibility('visible');
    expect(h.messageEl.textContent).toBe('Abandoned for 33 hours (demo time).');
    vi.advanceTimersByTime(0);
    expect(h.messageEl.textContent).toBe('Abandoned for 2 days (demo time).');
  });
});
