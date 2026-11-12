import { describe, it, expect } from 'vitest';
import { createMeters } from '../meters.js';

function fakeEnv() {
  const winL = {};
  const docL = {};
  const win = {
    scrollY: 0,
    addEventListener: (t, f) => (winL[t] = f),
    removeEventListener: (t) => delete winL[t],
  };
  const doc = {
    visibilityState: 'visible',
    addEventListener: (t, f) => (docL[t] = f),
    removeEventListener: (t) => delete docL[t],
  };
  let t = 0;
  return {
    win, doc, winL, docL,
    advance: (ms) => (t += ms),
    now: () => t,
    scrollTo(y) { win.scrollY = y; winL.scroll(); },
    setVisible(v) { doc.visibilityState = v ? 'visible' : 'hidden'; docL.visibilitychange(); },
  };
}

describe('meters', () => {
  it('accumulates timeOnSite in seconds while visible and matched', () => {
    const e = fakeEnv();
    const m = createMeters({ window: e.win, document: e.doc, now: e.now });
    e.advance(2500); m.update(true);
    expect(m.values().timeOnSite).toBeCloseTo(2.5);
    e.advance(1000); m.update(false);
    expect(m.values().timeOnSite).toBeCloseTo(2.5);
  });

  it('does not count timeOnSite while hidden', () => {
    const e = fakeEnv();
    const m = createMeters({ window: e.win, document: e.doc, now: e.now });
    e.setVisible(false);
    e.advance(5000); m.update(true);
    expect(m.values().timeOnSite).toBe(0);
  });

  it('sums absolute scroll distance in both directions', () => {
    const e = fakeEnv();
    const m = createMeters({ window: e.win, document: e.doc, now: e.now });
    e.scrollTo(300); e.scrollTo(100); e.scrollTo(150);
    expect(m.values().scrollDistance).toBe(550);
  });

  it('timeSinceActive grows while hidden and resets on return', () => {
    const e = fakeEnv();
    const m = createMeters({ window: e.win, document: e.doc, now: e.now });
    e.advance(1000); m.update();
    e.setVisible(false);
    e.advance(30000); m.update();
    expect(m.values().timeSinceActive).toBeCloseTo(30);
    e.setVisible(true); m.update();
    expect(m.values().timeSinceActive).toBe(0);
  });

  it('seeds from initial values and removes listeners on dispose', () => {
    const e = fakeEnv();
    const m = createMeters({ window: e.win, document: e.doc, now: e.now, initial: { timeOnSite: 60, scrollDistance: 900 } });
    expect(m.values()).toMatchObject({ timeOnSite: 60, scrollDistance: 900 });
    m.dispose();
    expect(e.winL.scroll).toBeUndefined();
    expect(e.docL.visibilitychange).toBeUndefined();
  });
});
