import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
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

// --- Tab Graveyard Requirement 3: timeAway meter ---

describe('meters: timeAway', () => {
  const make = (initial, { hidden = false } = {}) => {
    const e = fakeEnv();
    if (hidden) e.doc.visibilityState = 'hidden';
    const m = createMeters({ window: e.win, document: e.doc, now: e.now, initial });
    return { e, m };
  };
  const away = (m) => m.values().timeAway;

  it('starts at 0 and appears alongside the existing meters', () => {
    const { m } = make();
    expect(Object.keys(m.values()).sort()).toEqual(
      ['scrollDistance', 'timeAway', 'timeOnSite', 'timeSinceActive'],
    );
    expect(away(m)).toBe(0);
  });

  it('grows during an absence and holds the completed absence while visible', () => {
    const { e, m } = make();
    e.setVisible(false);
    e.advance(30000); m.update();
    expect(away(m)).toBeCloseTo(30);
    e.setVisible(true); m.update();
    expect(away(m)).toBeCloseTo(30);
    e.advance(60000); m.update();
    expect(away(m)).toBeCloseTo(30);
  });

  it('measures the absence in progress to the last update', () => {
    const { e, m } = make();
    e.setVisible(false);
    e.advance(10000); m.update();
    e.advance(50000); // no update yet
    expect(away(m)).toBeCloseTo(10);
  });

  it('takes the maximum of separate absences', () => {
    const { e, m } = make();
    e.setVisible(false); e.advance(10000); e.setVisible(true); m.update();
    expect(away(m)).toBeCloseTo(10);
    e.setVisible(false); e.advance(40000); e.setVisible(true); m.update();
    expect(away(m)).toBeCloseTo(40);
  });

  it('does not lower the value for a shorter later absence', () => {
    const { e, m } = make();
    e.setVisible(false); e.advance(40000); e.setVisible(true); m.update();
    e.setVisible(false); e.advance(5000); m.update();
    expect(away(m)).toBeCloseTo(40);
    e.setVisible(true); m.update();
    expect(away(m)).toBeCloseTo(40);
  });

  it('hidden at creation: treats the absence as started timeAwayCurrent seconds earlier', () => {
    const { e, m } = make({ timeAway: 20, timeAwayCurrent: 10 }, { hidden: true });
    expect(away(m)).toBeCloseTo(20);
    e.advance(15000); m.update();
    expect(away(m)).toBeCloseTo(25);
    e.setVisible(true); m.update();
    expect(away(m)).toBeCloseTo(25);
  });

  it('hidden at creation: a larger current seed shows at once', () => {
    const { m } = make({ timeAway: 5, timeAwayCurrent: 90 }, { hidden: true });
    expect(away(m)).toBeCloseTo(90);
  });

  it('visible at creation: holds the larger seed and has no absence in progress', () => {
    const { e, m } = make({ timeAway: 20, timeAwayCurrent: 50 });
    expect(away(m)).toBeCloseTo(50);
    e.advance(30000); m.update();
    expect(away(m)).toBeCloseTo(50);
    // a new absence starts from zero, not from the seed
    e.setVisible(false); e.advance(10000); m.update();
    expect(away(m)).toBeCloseTo(50);
    e.advance(50000); m.update();
    expect(away(m)).toBeCloseTo(60);
  });

  it('treats missing, negative, non-finite, and non-number seeds as 0', () => {
    const bad = [undefined, null, -5, -Infinity, Infinity, NaN, '30', {}, true];
    for (const v of bad) {
      const visible = make({ timeAway: v, timeAwayCurrent: v });
      expect(away(visible.m)).toBe(0);
      const hidden = make({ timeAway: v, timeAwayCurrent: v }, { hidden: true });
      expect(away(hidden.m)).toBe(0);
      // the absence in progress starts at creation
      hidden.e.advance(3000); hidden.m.update();
      expect(away(hidden.m)).toBeCloseTo(3);
    }
    expect(away(make().m)).toBe(0);
    expect(away(make(undefined).m)).toBe(0);
  });

  it('reset while visible zeroes the held value and returns true', () => {
    const { e, m } = make({ timeAway: 100 });
    expect(m.reset('timeAway')).toBe(true);
    expect(away(m)).toBe(0);
    e.advance(20000); m.update();
    expect(away(m)).toBe(0);
  });

  it('reset while hidden restarts the absence in progress at the current time', () => {
    const { e, m } = make();
    e.setVisible(false); e.advance(30000); m.update();
    expect(away(m)).toBeCloseTo(30);
    expect(m.reset('timeAway')).toBe(true);
    expect(away(m)).toBe(0);
    e.advance(5000); m.update();
    expect(away(m)).toBeCloseTo(5);
    e.setVisible(true); m.update();
    expect(away(m)).toBeCloseTo(5);
  });

  it('reset of any other meter changes nothing and returns false', () => {
    const { e, m } = make({ timeOnSite: 12, scrollDistance: 300 });
    e.setVisible(false); e.advance(8000); m.update();
    const before = m.values();
    for (const name of ['scrollDistance', 'timeSinceActive', 'bogus', undefined]) {
      expect(m.reset(name)).toBe(false);
    }
    expect(m.values()).toEqual(before);
  });

  it('update() starts an absence when a "hidden" event was missed', () => {
    const { e, m } = make();
    e.doc.visibilityState = 'hidden'; // no event fired
    e.advance(5000); m.update(); // absence starts at this tick
    expect(away(m)).toBe(0);
    e.advance(10000); m.update();
    expect(away(m)).toBeCloseTo(10);
  });

  it('update() completes an absence when a "visible" event was missed', () => {
    const { e, m } = make();
    e.setVisible(false); e.advance(10000); m.update();
    e.doc.visibilityState = 'visible'; // no event fired
    e.advance(3000); m.update(); // absence completes at this tick
    expect(away(m)).toBeCloseTo(13);
    e.advance(30000); m.update();
    expect(away(m)).toBeCloseTo(13);
  });

  it('reuses one visibility listener and removes it on dispose', () => {
    const e = fakeEnv();
    const added = [];
    const add = e.doc.addEventListener;
    e.doc.addEventListener = (t, f, o) => { added.push(t); add(t, f, o); };
    const m = createMeters({ window: e.win, document: e.doc, now: e.now });
    expect(added.filter((t) => t === 'visibilitychange')).toHaveLength(1);
    e.setVisible(false); e.advance(4000); m.update();
    m.dispose();
    expect(e.docL.visibilitychange).toBeUndefined();
  });
});

// Property 1: timeAway matches a reference model.
// **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 10.2**
describe('meters: timeAway reference model (Property 1)', () => {
  const seed = fc.oneof(
    fc.constant(undefined),
    fc.integer({ min: 0, max: 200000 }),
    fc.double({ min: 0, max: 200000, noNaN: true }),
  );
  const op = fc.oneof(
    fc.constant({ kind: 'hide' }),
    fc.constant({ kind: 'show' }),
    fc.constant({ kind: 'silentHide' }), // state flips without an event (missed event)
    fc.constant({ kind: 'silentShow' }),
    fc.constant({ kind: 'update' }),
    fc.constant({ kind: 'reset' }),
    fc.integer({ min: 0, max: 120000 }).map((ms) => ({ kind: 'advance', ms })),
  );

  // Reference model kept as a log: completed absence durations since the last reset,
  // the start of the absence in progress, and the time of the last reset.
  function createModel({ timeAway, timeAwayCurrent, hidden }, t0) {
    const h = timeAway ?? 0;
    const c = timeAwayCurrent ?? 0;
    return {
      t: t0,
      lastTick: t0,
      visible: !hidden,
      seedHeld: hidden ? h : Math.max(h, c),
      completed: [],
      currentStart: hidden ? t0 - c * 1000 : null,
      resetAt: -Infinity,
    };
  }
  const clipStart = (s, start) => Math.max(start, s.resetAt);
  const begin = (s) => { if (s.currentStart === null) s.currentStart = s.t; };
  const complete = (s) => {
    if (s.currentStart === null) return;
    s.completed.push(Math.max(0, s.t - clipStart(s, s.currentStart)) / 1000);
    s.currentStart = null;
  };
  const expected = (s) => Math.max(
    s.seedHeld,
    ...s.completed,
    s.currentStart === null ? 0 : Math.max(0, s.lastTick - clipStart(s, s.currentStart)) / 1000,
  );

  it('values().timeAway equals the model after every update and never decreases between resets', () => {
    fc.assert(
      fc.property(
        fc.record({ timeAway: seed, timeAwayCurrent: seed, hidden: fc.boolean() }),
        fc.array(op, { maxLength: 60 }),
        (seeds, ops) => {
          const e = fakeEnv();
          if (seeds.hidden) e.doc.visibilityState = 'hidden';
          const m = createMeters({
            window: e.win, document: e.doc, now: e.now,
            initial: { timeAway: seeds.timeAway, timeAwayCurrent: seeds.timeAwayCurrent },
          });
          const s = createModel(seeds, e.now());
          let previous = m.values().timeAway;
          expect(previous).toBeCloseTo(expected(s), 6);

          for (const o of ops) {
            switch (o.kind) {
              case 'advance':
                e.advance(o.ms); s.t += o.ms;
                break;
              case 'hide':
                e.setVisible(false); s.visible = false; begin(s);
                break;
              case 'show':
                e.setVisible(true); s.visible = true; complete(s);
                break;
              case 'silentHide':
                e.doc.visibilityState = 'hidden'; s.visible = false;
                break;
              case 'silentShow':
                e.doc.visibilityState = 'visible'; s.visible = true;
                break;
              case 'reset':
                expect(m.reset('timeAway')).toBe(true);
                s.seedHeld = 0; s.completed = []; s.resetAt = s.t;
                previous = 0;
                break;
              case 'update': {
                m.update(); s.lastTick = s.t;
                if (s.visible) complete(s); else begin(s);
                const value = m.values().timeAway;
                expect(value).toBeCloseTo(expected(s), 6);
                expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
                previous = value;
                break;
              }
            }
          }
          m.dispose();
          expect(e.docL.visibilitychange).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Haunt Kit: timeOnSite is resettable ---

describe('meters: reset timeOnSite', () => {
  // Haunt Kit invariant 13: Only timeAway and timeOnSite are resettable
  it('reset("timeOnSite") returns true and sets timeOnSite to 0', () => {
    const e = fakeEnv();
    const m = createMeters({ window: e.win, document: e.doc, now: e.now, initial: { timeOnSite: 12 } });
    e.advance(5000); m.update(true);
    expect(m.values().timeOnSite).toBeCloseTo(17);
    expect(m.reset('timeOnSite')).toBe(true);
    expect(m.values().timeOnSite).toBe(0);
    // counts up again from 0
    e.advance(2000); m.update(true);
    expect(m.values().timeOnSite).toBeCloseTo(2);
  });

  // Haunt Kit invariant 13: Only timeAway and timeOnSite are resettable
  it('reset of scrollDistance, timeSinceActive, unknown names and undefined returns false and changes nothing', () => {
    for (const name of ['scrollDistance', 'timeSinceActive', 'bogus', undefined]) {
      const e = fakeEnv();
      const m = createMeters({ window: e.win, document: e.doc, now: e.now, initial: { timeOnSite: 30, scrollDistance: 400 } });
      e.advance(4000); m.update(true);
      e.scrollTo(250);
      e.setVisible(false); e.advance(6000); m.update(true);
      const before = m.values();
      expect(m.reset(name)).toBe(false);
      expect(m.values()).toEqual(before);
    }
  });
});
