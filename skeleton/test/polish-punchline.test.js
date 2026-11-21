// @vitest-environment jsdom
// haunt-polish Requirement 2.15 (amended: fog-visibility): the Block second line is the punchline.
// Example-based only (Requirement 9.1, 9.9).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as block from '../effects/block.js';
import { installAnimateSpy, makeEnv } from './polish-helpers.js';

const PAGE = '<head><title>t</title></head><body><p>Feed</p></body>';
const PARAMS = {
  message: 'You have scrolled long enough. Close this tab and take a break.',
  detail: 'You lost {duration} to this feed.',
};

let spy;
let handles;
const bk = (...args) => {
  const h = block.apply(...args);
  if (!handles.includes(h)) handles.push(h);
  return h;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = PAGE;
  spy = installAnimateSpy();
  handles = [];
});
afterEach(() => {
  for (const h of handles) block.undo(h, { durationMs: 0 });
  spy.restore();
  vi.useRealTimers();
});

describe('block: punchline second line (2.15)', () => {
  it('renders the detail at 24 px, weight 600, white, against a 40 px message', () => {
    const h = bk(makeEnv({ readMeter: () => 20 }), PARAMS, 1);
    const detail = h.detailEl;
    expect(detail).not.toBeNull();
    expect(detail.tagName).toBe('P');
    expect(detail.textContent).toBe('You lost 20 seconds to this feed.');
    const messagePx = parseFloat(h.messageEl.style.fontSize);
    const detailPx = parseFloat(detail.style.fontSize);
    expect(messagePx).toBe(40);
    expect(detail.style.fontSize).toBe('24px');
    expect(detailPx).toBeGreaterThanOrEqual(messagePx / 2);
    expect(detail.style.fontWeight).toBe('600');
    expect(detail.style.color).toBe('rgb(255, 255, 255)');
    expect(detail.style.opacity).toBe('');
  });

  it('is animated only by the Fade_In, which ends at opacity 1', () => {
    const h = bk(makeEnv(), PARAMS, 1);
    const onDetail = spy.on(h.detailEl);
    expect(onDetail).toHaveLength(1);
    expect(onDetail[0].options).toMatchObject({ duration: 1500, iterations: 1 });
    expect(onDetail[0].keyframes.at(-1)).toEqual({ opacity: 1 });
    bk(makeEnv(), PARAMS, 1, h);
    expect(spy.on(h.detailEl)).toHaveLength(1);
    expect(h.detailEl.style.opacity).toBe('');
  });

  it('is not animated under reduced motion and stays at full strength', () => {
    const h = bk(makeEnv({ reducedMotion: true }), PARAMS, 1);
    expect(spy.on(h.detailEl)).toHaveLength(0);
    expect(h.detailEl.style.opacity).toBe('');
    expect(h.detailEl.style.fontWeight).toBe('600');
  });
});
