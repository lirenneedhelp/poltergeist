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

// --- Requirement 9: scroll tracking in inner containers ---

function containerEnv() {
  const docListeners = []; // { type, fn, capture }
  const winListeners = [];
  const scrollingElement = { scrollTop: 0 };
  const documentElement = { scrollTop: 0 };
  const win = {
    scrollY: 0,
    addEventListener: (type, fn) => winListeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const i = winListeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) winListeners.splice(i, 1);
    },
  };
  const doc = {
    visibilityState: 'visible',
    scrollingElement,
    documentElement,
    addEventListener: (type, fn, opts) =>
      docListeners.push({ type, fn, capture: typeof opts === 'object' ? !!opts?.capture : !!opts }),
    removeEventListener: (type, fn, opts) => {
      const capture = typeof opts === 'object' ? !!opts?.capture : !!opts;
      const i = docListeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (i >= 0) docListeners.splice(i, 1);
    },
  };
  const fire = (target) => {
    for (const l of [...docListeners]) if (l.type === 'scroll' && l.capture) l.fn({ target });
  };
  const fireWindow = () => winListeners.filter((l) => l.type === 'scroll').forEach((l) => l.fn());
  return { win, doc, docListeners, winListeners, scrollingElement, documentElement, fire, fireWindow };
}

describe('meters: inner container scroll tracking', () => {
  const make = () => {
    const e = containerEnv();
    const m = createMeters({ window: e.win, document: e.doc, now: () => 0 });
    return { e, m };
  };

  it('registers a capture-phase scroll listener on the document and removes it with the same flag', () => {
    const { e, m } = make();
    const captured = e.docListeners.filter((l) => l.type === 'scroll');
    expect(captured).toHaveLength(1);
    expect(captured[0].capture).toBe(true);
    m.dispose();
    expect(e.docListeners.filter((l) => l.type === 'scroll')).toHaveLength(0);
  });

  it('adds 0 for the first event of a container and tracks later deltas', () => {
    const { e, m } = make();
    const pane = { scrollTop: 500 };
    e.fire(pane);
    expect(m.values().scrollDistance).toBe(0);
    pane.scrollTop = 620;
    e.fire(pane);
    pane.scrollTop = 600;
    e.fire(pane);
    expect(m.values().scrollDistance).toBe(140);
  });

  it('tracks each container independently', () => {
    const { e, m } = make();
    const a = { scrollTop: 0 };
    const b = { scrollTop: 1000 };
    e.fire(a); e.fire(b);
    a.scrollTop = 30; e.fire(a);
    b.scrollTop = 960; e.fire(b);
    a.scrollTop = 50; e.fire(a);
    expect(m.values().scrollDistance).toBe(30 + 40 + 20);
  });

  it('adds 0 when a container event reports an unchanged position', () => {
    const { e, m } = make();
    const pane = { scrollTop: 200 };
    e.fire(pane);
    e.fire(pane);
    e.fire(pane);
    expect(m.values().scrollDistance).toBe(0);
  });

  it('sums viewport and container distances', () => {
    const { e, m } = make();
    const pane = { scrollTop: 0 };
    e.fire(pane);
    pane.scrollTop = 100; e.fire(pane);
    e.win.scrollY = 250; e.fireWindow();
    expect(m.values().scrollDistance).toBe(350);
  });

  it('treats document, scrollingElement and documentElement as one viewport position', () => {
    const { e, m } = make();
    e.win.scrollY = 100; e.fire(e.doc);
    expect(m.values().scrollDistance).toBe(100);
    e.win.scrollY = 160; e.fire(e.scrollingElement);
    expect(m.values().scrollDistance).toBe(160);
    e.win.scrollY = 200; e.fire(e.documentElement);
    expect(m.values().scrollDistance).toBe(200);
    // same position seen through another alias adds nothing
    e.fire(e.doc);
    e.fireWindow();
    expect(m.values().scrollDistance).toBe(200);
  });

  it('ignores unrecognized targets without throwing', () => {
    const { e, m } = make();
    expect(() => {
      e.fire(null);
      e.fire(undefined);
      e.fire({});
      e.fire({ scrollTop: 'x' });
      e.fire({ scrollTop: NaN });
    }).not.toThrow();
    expect(m.values().scrollDistance).toBe(0);
  });

  it('does not change scrollDistance after dispose', () => {
    const { e, m } = make();
    const pane = { scrollTop: 0 };
    e.fire(pane);
    pane.scrollTop = 80; e.fire(pane);
    m.dispose();
    pane.scrollTop = 400; e.fire(pane);
    e.win.scrollY = 900; e.fire(e.doc); e.fireWindow();
    expect(m.values().scrollDistance).toBe(80);
  });
});
