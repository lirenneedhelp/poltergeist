import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { validateRules, builtinEffects } from '../../skeleton/index.js';

const SOURCE = readFileSync(fileURLToPath(new URL('../content.js', import.meta.url)), 'utf8');
const NORMAL = JSON.parse(readFileSync(fileURLToPath(new URL('../rules.json', import.meta.url)), 'utf8'));

/** Evaluate content.js as a classic script in an isolated VM context (no chrome → boot is inert). */
function loadContent() {
  const sandbox = { structuredClone, console };
  vm.runInNewContext(SOURCE, sandbox, { filename: 'content.js' });
  return sandbox;
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Fake skeleton boundary: real rule validation, a recording startPoltergeist.
 * Each instance's meters report its seed plus a fixed advance.
 */
function makeHarness({ loadDelay = false } = {}) {
  const { doomscrollCreateController } = loadContent();
  const log = { starts: [], stops: [], overlaps: 0, reports: [] };
  let live = 0;
  const api = {
    validateRules,
    builtinEffects,
    startPoltergeist({ rules, initialMeters }) {
      if (api.failStart) throw new Error('start boom');
      if (live > 0) log.overlaps += 1;
      live += 1;
      const ghost = {
        rules: plain(rules),
        initialMeters: { ...initialMeters },
        live: true,
        meters: { values: () => ({ timeOnSite: initialMeters.timeOnSite + 10, scrollDistance: initialMeters.scrollDistance + 5, timeSinceActive: 99 }) },
        stop() {
          if (api.failStop) throw new Error('stop boom');
          ghost.live = false;
          live -= 1;
          log.stops.push(ghost);
        },
      };
      log.starts.push(ghost);
      return ghost;
    },
  };
  const controller = doomscrollCreateController({
    loadPackage: async () => {
      if (loadDelay) await tick();
      return { api, normalProfile: NORMAL };
    },
    report: (kind, message) => log.reports.push({ kind, message }),
  });
  return { controller, api, log, liveCount: () => live };
}

const fogThreshold = (ghost) => ghost.rules.rules[0].trigger.threshold;

describe('content.js classic loader shape', () => {
  it('has no static import/export declarations and evaluates as a classic script', () => {
    expect(SOURCE).not.toMatch(/^\s*(?:import|export)\s/m);
    const sandbox = loadContent();
    expect(typeof sandbox.doomscrollCreateController).toBe('function');
    expect(typeof sandbox.doomscrollCreateDemoProfile).toBe('function');
  });
});

describe('doomscrollCreateDemoProfile', () => {
  it('produces the 2-5 / 5-10 / 10-15 / 20-25 second demo stages that validate', () => {
    const { doomscrollCreateDemoProfile } = loadContent();
    const before = plain(NORMAL);
    const demo = plain(doomscrollCreateDemoProfile(NORMAL));
    expect(demo.rules.map((r) => [r.trigger.threshold, r.trigger.rampTo])).toEqual([[2, 5], [5, 10], [10, 15], [20, 25]]);
    expect(validateRules(demo, builtinEffects).valid).toBe(true);
    expect(NORMAL).toEqual(before);
  });

  // Feature: doomscroll-app, Property 2: Demo scaling preserves rule shape and order
  // **Validates: Requirements 2.11, 2.12, 2.14**
  it('Property 2: scales only trigger times by 1/60 and leaves the normal profile unchanged', () => {
    const { doomscrollCreateDemoProfile } = loadContent();
    // Rule times in seconds with millisecond resolution (subnormal doubles are not meaningful rule times).
    const time = fc.integer({ min: 0, max: 1e9 }).map((ms) => ms / 1000);
    const rule = fc.record({
      id: fc.string({ minLength: 1, maxLength: 8 }),
      enabled: fc.boolean(),
      match: fc.array(fc.constantFrom('https://x.com/*', 'https://www.youtube.com/*'), { maxLength: 3 }),
      trigger: fc.oneof(
        fc.record({ meter: fc.constant('timeOnSite'), threshold: time, rampTo: time }),
        fc.record({ meter: fc.constant('scrollDistance'), threshold: time }),
      ),
      effect: fc.record({ type: fc.constantFrom('fog', 'rot'), params: fc.dictionary(fc.string({ maxLength: 4 }), fc.integer()) }),
    });
    fc.assert(fc.property(fc.array(rule, { maxLength: 8 }), (rules) => {
      const normal = { rules };
      const before = plain(normal);
      const demo = plain(doomscrollCreateDemoProfile(normal));
      expect(normal).toEqual(before);
      expect(demo.rules).toHaveLength(rules.length);
      demo.rules.forEach((d, i) => {
        const n = before.rules[i];
        const { trigger: dt, ...dRest } = d;
        const { trigger: nt, ...nRest } = n;
        expect(dRest).toEqual(nRest);
        expect(dt.meter).toBe(nt.meter);
        expect(dt.threshold).toBe(nt.threshold / 60);
        if (nt.rampTo === undefined) expect(dt.rampTo).toBeUndefined();
        else expect(dt.rampTo).toBe(nt.rampTo / 60);
      });
      for (let i = 0; i < rules.length; i += 1) {
        for (let j = 0; j < rules.length; j += 1) {
          expect(demo.rules[i].trigger.threshold <= demo.rules[j].trigger.threshold)
            .toBe(before.rules[i].trigger.threshold <= before.rules[j].trigger.threshold);
        }
      }
    }), { numRuns: 100 });
  });
});

describe('doomscrollCreateController', () => {
  it('starts nothing until both fields are confirmed, and pause takes precedence', async () => {
    const { controller, log } = makeHarness();
    await controller.setPaused(false);
    expect(log.starts).toHaveLength(0);
    await controller.setDemoMode(true);
    expect(log.starts).toHaveLength(1);
    expect(fogThreshold(log.starts[0])).toBe(2);
    await controller.setPaused(true);
    expect(controller.getState().mode).toBeNull();
    expect(log.starts[0].live).toBe(false);
  });

  it('lets a newer live event win over an older initial response, per field', async () => {
    const { controller } = makeHarness();
    const captured = controller.captureRevisions();
    controller.setPaused(true); // arrives before the initial response
    await controller.applyInitialState({ paused: false, demoMode: false }, captured);
    expect(controller.getState().desired).toEqual({ paused: true, demoMode: false });
    expect(controller.getState().mode).toBeNull();
  });

  it('keeps normal and demo snapshots separate and resets demo on every transition, even while paused', async () => {
    const { controller, log } = makeHarness();
    await controller.applyInitialState({ paused: false, demoMode: false });
    await controller.setDemoMode(true); // normal stops at 10/5; demo starts from zero
    expect(log.starts[1].initialMeters).toEqual({ timeOnSite: 0, scrollDistance: 0 });
    await controller.setPaused(true); // demo snapshot 10/5
    await controller.setPaused(false);
    expect(log.starts[2].initialMeters).toEqual({ timeOnSite: 10, scrollDistance: 5 });
    await controller.setPaused(true);
    controller.setDemoMode(false);
    await controller.setDemoMode(true); // off→on while paused
    expect(controller.getState().demoSnapshot).toEqual({ timeOnSite: 0, scrollDistance: 0 });
    await controller.setPaused(false);
    expect(log.starts[3].initialMeters).toEqual({ timeOnSite: 0, scrollDistance: 0 });
    await controller.setDemoMode(false); // back to normal from the normal snapshot only
    expect(log.starts[4].initialMeters).toEqual({ timeOnSite: 10, scrollDistance: 5 });
    expect(fogThreshold(log.starts[4])).toBe(120);
    expect(NORMAL.rules[0].trigger.threshold).toBe(120);
  });

  it('restarts a quick demo off→on with fresh meters even though the mode is unchanged', async () => {
    const { controller, log } = makeHarness();
    await controller.applyInitialState({ paused: false, demoMode: true });
    controller.setDemoMode(false);
    await controller.setDemoMode(true);
    const last = log.starts.at(-1);
    expect(last.live).toBe(true);
    expect(log.starts[0].live).toBe(false);
    expect(last.initialMeters).toEqual({ timeOnSite: 0, scrollDistance: 0 });
  });

  it('skips an obsolete start when state changes during package loading', async () => {
    const { controller, log } = makeHarness({ loadDelay: true });
    controller.applyInitialState({ paused: false, demoMode: false });
    await Promise.resolve();
    await Promise.resolve(); // reconciliation is now awaiting the deferred package load
    controller.setPaused(true);
    await controller.whenIdle();
    expect(log.starts).toHaveLength(0);
  });

  it('retains ownership and faults when stop throws, starting no replacement', async () => {
    const { controller, api, log } = makeHarness();
    await controller.applyInitialState({ paused: false, demoMode: false });
    api.failStop = true;
    await controller.setDemoMode(true);
    await controller.setPaused(false);
    const s = controller.getState();
    expect(s.faulted).toBe(true);
    expect(s.ghost).toBe(log.starts[0]);
    expect(log.starts).toHaveLength(1);
    expect(log.reports.map((r) => r.kind)).toEqual(['stop']);
  });

  it('faults without retry when startPoltergeist throws', async () => {
    const { controller, api, log } = makeHarness();
    api.failStart = true;
    await controller.applyInitialState({ paused: false, demoMode: false });
    await controller.setDemoMode(true);
    expect(controller.getState()).toMatchObject({ faulted: true, mode: null });
    expect(log.reports.map((r) => r.kind)).toEqual(['start']);
  });

  it('leaves the page clean and reports once when the package fails to load', async () => {
    const { doomscrollCreateController } = loadContent();
    const reports = [];
    const controller = doomscrollCreateController({
      loadPackage: () => Promise.reject(new Error('fetch failed')),
      report: (kind) => reports.push(kind),
    });
    await controller.applyInitialState({ paused: false, demoMode: false });
    await controller.setDemoMode(true);
    expect(controller.getState()).toMatchObject({ mode: null, faulted: false });
    expect(reports).toEqual(['load']);
  });

  it('restarts the active profile from its snapshot on a motion change and defers while paused', async () => {
    const { controller, log } = makeHarness();
    await controller.applyInitialState({ paused: false, demoMode: true });
    await controller.motionChanged();
    expect(log.starts).toHaveLength(2);
    expect(log.starts[1].initialMeters).toEqual({ timeOnSite: 10, scrollDistance: 5 });
    expect(fogThreshold(log.starts[1])).toBe(2);
    await controller.setPaused(true);
    await controller.motionChanged();
    expect(log.starts).toHaveLength(2);
    expect(controller.getState().mode).toBeNull();
  });

  it('performs no reconciliation after dispose', async () => {
    const { controller, log } = makeHarness({ loadDelay: true });
    controller.applyInitialState({ paused: false, demoMode: false });
    controller.dispose();
    await controller.whenIdle();
    await controller.setDemoMode(true);
    expect(log.starts).toHaveLength(0);
  });

  // Feature: doomscroll-app, Property 3: Runtime reconciliation owns at most one instance
  // **Validates: Requirements 3.4, 3.5, 3.9, 3.10, 3.11, 3.12, 3.16, 5.9, 5.13, 5.17**
  it('Property 3: any event sequence leaves at most one instance, matching the desired profile', async () => {
    const event = fc.record({
      kind: fc.constantFrom('pause', 'demo', 'motion'),
      value: fc.boolean(),
      wait: fc.constantFrom('none', 'tick', 'idle'),
    });
    await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), fc.array(event, { maxLength: 12 }), async (p0, d0, events) => {
      const { controller, log, liveCount } = makeHarness({ loadDelay: true });
      const captured = controller.captureRevisions();
      const pending = controller.applyInitialState({ paused: p0, demoMode: d0 }, captured);
      for (const e of events) {
        if (e.kind === 'pause') controller.setPaused(e.value);
        else if (e.kind === 'demo') controller.setDemoMode(e.value);
        else controller.motionChanged();
        if (e.wait === 'tick') await tick();
        else if (e.wait === 'idle') await controller.whenIdle();
        expect(liveCount()).toBeLessThanOrEqual(1);
      }
      await pending;
      await controller.whenIdle();
      const s = controller.getState();
      expect(log.overlaps).toBe(0);
      expect(s.faulted).toBe(false);
      if (s.desired.paused) {
        expect(liveCount()).toBe(0);
        expect(s.mode).toBeNull();
      } else {
        expect(liveCount()).toBe(1);
        expect(s.mode).toBe(s.desired.demoMode ? 'demo' : 'normal');
        expect(s.ghost.live).toBe(true);
        expect(fogThreshold(s.ghost)).toBe(s.desired.demoMode ? 2 : 120);
      }
    }), { numRuns: 100 });
  });
});
