// @vitest-environment jsdom
// Doomscroll finale: the ritual's Exorcised_Action resets timeOnSite on the
// current instance only (Requirement 10, design part 3.2).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { validateRules, builtinEffects, startPoltergeist } from '../../skeleton/index.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SOURCE = read('../content.js');
const NORMAL = JSON.parse(read('../rules.json'));
const MANIFEST = JSON.parse(read('../manifest.json'));
const HOSTS = ['https://www.youtube.com/*', 'https://x.com/*', 'https://www.instagram.com/*'];
const RULE_IDS = ['doomscroll-fog', 'doomscroll-flicker', 'doomscroll-rot', 'doomscroll-block', 'doomscroll-ritual'];
const plain = (v) => JSON.parse(JSON.stringify(v));

/** Evaluate content.js as a classic script in a VM context (no chrome, so the bootstrap is inert). */
function loadContent() {
  const sandbox = { structuredClone, console };
  vm.runInNewContext(SOURCE, sandbox, { filename: 'content.js' });
  return sandbox;
}

/**
 * Controller harness: real rule validation, a recording startPoltergeist whose
 * instances record meters.reset, engine.tick and stop, and keep their onAction.
 */
function makeHarness() {
  const { doomscrollCreateController } = loadContent();
  const log = { starts: [], calls: [], reports: [] };
  const api = {
    validateRules,
    builtinEffects,
    resetImpl: () => true,
    startPoltergeist({ rules, initialMeters, onAction }) {
      const ghost = {
        rules: plain(rules),
        onAction,
        meters: {
          values: () => ({ timeOnSite: initialMeters.timeOnSite + 10, scrollDistance: initialMeters.scrollDistance + 5, timeSinceActive: 0 }),
          reset: (name) => {
            log.calls.push({ ghost, call: 'reset', name });
            return api.resetImpl(name);
          },
        },
        engine: { tick: () => { log.calls.push({ ghost, call: 'tick' }); } },
        stop: () => { log.calls.push({ ghost, call: 'stop' }); },
      };
      log.starts.push(ghost);
      return ghost;
    },
  };
  const controller = doomscrollCreateController({
    loadPackage: async () => ({ api, normalProfile: NORMAL }),
    report: (kind, message) => log.reports.push({ kind, message }),
  });
  const callsOn = (ghost) => log.calls.filter((c) => c.ghost === ghost).map(({ call, name }) => (name ? `${call}:${name}` : call));
  return { controller, api, log, callsOn };
}

describe('Doomscroll onAction wiring (10.3, 10.4, 10.11, 10.12)', () => {
  // Haunt Kit invariant 14: Doomscroll resets only the current instance, only for exorcised
  it.each(['resurrect', '', undefined, 'EXORCISED', 'exorcised '])('ignores the action name %j', async (name) => {
    const { controller, log } = makeHarness();
    await controller.applyInitialState({ paused: false, demoMode: false });
    const ghost = log.starts[0];
    expect(typeof ghost.onAction).toBe('function');
    expect(() => ghost.onAction(name)).not.toThrow();
    await controller.whenIdle();
    expect(log.calls).toEqual([]);
    expect(log.starts).toHaveLength(1);
    expect(log.reports).toEqual([]);
    expect(controller.getState().ghost).toBe(ghost);
  });

  // Haunt Kit invariant 14: Doomscroll resets only the current instance, only for exorcised
  it.each([false, true])('exorcised on the current instance (demoMode %s) resets once and ticks once', async (demoMode) => {
    const { controller, log, callsOn } = makeHarness();
    await controller.applyInitialState({ paused: false, demoMode });
    const ghost = log.starts[0];
    ghost.onAction('exorcised');
    await controller.whenIdle();
    expect(callsOn(ghost)).toEqual(['reset:timeOnSite', 'tick']);
    expect(log.starts).toHaveLength(1); // no new start
    expect(controller.getState()).toMatchObject({ ghost, mode: demoMode ? 'demo' : 'normal', faulted: false });
    expect(log.reports).toEqual([]);
  });

  // Haunt Kit invariant 14: Doomscroll resets only the current instance, only for exorcised
  it.each([
    ['pause and resume', async (c) => { await c.setPaused(true); await c.setPaused(false); }],
    ['a Demo_Mode toggle', async (c) => { await c.setDemoMode(true); }],
    ['a motion restart', async (c) => { await c.motionChanged(); }],
  ])('exorcised from an instance replaced by %s resets nothing', async (_label, replace) => {
    const { controller, log } = makeHarness();
    await controller.applyInitialState({ paused: false, demoMode: false });
    const old = log.starts[0];
    await replace(controller);
    const current = controller.getState().ghost;
    expect(current).not.toBe(old);
    const before = log.calls.length;
    const startsBefore = log.starts.length;
    old.onAction('exorcised');
    await controller.whenIdle();
    expect(log.calls.slice(before)).toEqual([]);
    expect(log.calls.some((c) => c.call === 'reset')).toBe(false);
    expect(log.starts).toHaveLength(startsBefore);
    expect(controller.getState().ghost).toBe(current);
  });

  // Haunt Kit invariant 14: Doomscroll resets only the current instance, only for exorcised
  it('exorcised after dispose resets nothing', async () => {
    const { controller, log } = makeHarness();
    await controller.applyInitialState({ paused: false, demoMode: false });
    const ghost = log.starts[0];
    controller.dispose();
    ghost.onAction('exorcised');
    await controller.whenIdle();
    expect(log.calls).toEqual([]);
  });

  // Haunt Kit invariant 14: Doomscroll resets only the current instance, only for exorcised
  it.each([
    ['returns false', () => false],
    ['throws', () => { throw new Error('reset boom'); }],
  ])('a reset that %s is reported once under reset, throws nothing and keeps the instance', async (_label, impl) => {
    const { controller, api, log, callsOn } = makeHarness();
    await controller.applyInitialState({ paused: false, demoMode: false });
    const ghost = log.starts[0];
    api.resetImpl = impl;
    expect(() => ghost.onAction('exorcised')).not.toThrow();
    expect(() => ghost.onAction('exorcised')).not.toThrow();
    await controller.whenIdle();
    expect(callsOn(ghost)).toEqual(['reset:timeOnSite', 'reset:timeOnSite']); // no tick, no stop
    expect(log.reports.map((r) => r.kind)).toEqual(['reset']);
    expect(log.starts).toHaveLength(1);
    expect(controller.getState()).toMatchObject({ ghost, faulted: false });
  });
});

/** Minimal bootstrap run (fake chrome) to observe logging, messages and listeners. */
async function boot(ghostMeters) {
  const raw = SOURCE.replace(/\bimport\(/g, '__fakeImport(');
  const log = { errors: [], sent: [], listenerTypes: [], starts: [] };
  const api = {
    validateRules,
    builtinEffects,
    startPoltergeist(opts) {
      const ghost = { opts, meters: ghostMeters, engine: { tick() {} }, stop() {} };
      log.starts.push(ghost);
      return ghost;
    },
  };
  const sandbox = {
    console: { error: (...a) => log.errors.push(a.join(' ')) },
    structuredClone,
    chrome: {
      runtime: {
        id: 'ext-id',
        getURL: (p) => `chrome-extension://ext-id/${p}`,
        sendMessage: async (msg) => { log.sent.push(msg); return { ok: true, paused: false, demoMode: false }; },
        onMessage: { addListener() {} },
      },
      storage: { onChanged: { addListener() {} } },
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => plain(NORMAL) }),
    addEventListener: (type) => log.listenerTypes.push(type),
    matchMedia: () => ({ addEventListener: (type) => log.listenerTypes.push(`motion:${type}`) }),
    __fakeImport: async () => api,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(raw, sandbox, { filename: 'content.js' });
  for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 0));
  return log;
}

describe('Doomscroll finale through the bootstrap (10.7, 10.12)', () => {
  it('logs a failed reset with the [poltergeist:doomscroll] prefix and sends no tab message', async () => {
    const log = await boot({ values: () => ({ timeOnSite: 0, scrollDistance: 0 }), reset: () => false });
    expect(log.starts).toHaveLength(1);
    expect(() => log.starts[0].opts.onAction('exorcised')).not.toThrow();
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0].startsWith('[poltergeist:doomscroll] ')).toBe(true);
    expect(log.sent).toEqual([{ type: 'doomscroll:content-state' }]);
    expect(log.listenerTypes).not.toContain('beforeunload');
  });
});

describe('Doomscroll finale with the real skeleton (10.4, 10.5, 10.6)', () => {
  let stopAll = () => {};
  afterEach(() => {
    stopAll();
    vi.useRealTimers();
    document.querySelectorAll('[data-poltergeist]').forEach((n) => n.remove());
  });

  // Haunt Kit invariant 14: Doomscroll resets only the current instance, only for exorcised
  it('exorcised undoes every rule with its own undo mode, then the haunt starts over from 0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    const undos = [];
    const envs = {};
    const effects = Object.fromEntries(Object.entries(builtinEffects).map(([type, e]) => [type, {
      description: e.description,
      apply: (env, params, intensity, handle) => { envs[type] = env; return e.apply(env, params, intensity, handle); },
      undo: (handle, opts) => { undos.push({ type, durationMs: opts && opts.durationMs }); return e.undo(handle, opts); },
    }]));
    const profile = plain(NORMAL);
    for (const rule of profile.rules) rule.match = ['<all_urls>'];

    const starts = [];
    const ghosts = [];
    const api = {
      validateRules,
      builtinEffects: effects,
      startPoltergeist(opts) {
        starts.push(plain(opts.initialMeters));
        const initialMeters = starts.length === 1 ? { timeOnSite: 1500, scrollDistance: 42 } : opts.initialMeters;
        const ghost = startPoltergeist({ ...opts, initialMeters, effects });
        ghosts.push(ghost);
        return ghost;
      },
    };
    const { doomscrollCreateController } = loadContent();
    const reports = [];
    const controller = doomscrollCreateController({
      loadPackage: async () => ({ api, normalProfile: profile }),
      report: (kind) => reports.push(kind),
    });
    stopAll = () => { for (const g of ghosts) g.stop(); };

    await controller.applyInitialState({ paused: false, demoMode: false });
    const ghost = controller.getState().ghost;
    expect(ghost).toBe(ghosts[0]);
    expect(ghost.engine.activeRuleIds()).toEqual(RULE_IDS);
    expect(typeof envs.ritual.onAction).toBe('function');
    undos.length = 0;

    // The ritual reports completion through the real skeleton env.
    envs.ritual.onAction('exorcised');
    expect(undos).toEqual([
      { type: 'fog', durationMs: 400 },
      { type: 'flicker', durationMs: 0 },
      { type: 'rot', durationMs: 0 },
      { type: 'block', durationMs: 600 },
      { type: 'ritual', durationMs: 600 },
    ]);
    expect(ghost.engine.activeRuleIds()).toEqual([]);
    const after = ghost.meters.values();
    expect(after.timeOnSite).toBe(0);
    expect(after.scrollDistance).toBe(42);
    expect(after.timeSinceActive).toBe(0);
    expect(controller.getState().ghost).toBe(ghost); // same instance keeps running
    expect(ghosts).toHaveLength(1);
    expect(reports).toEqual([]);

    vi.advanceTimersByTime(650);
    expect(document.querySelectorAll('[data-poltergeist]')).toHaveLength(0);

    // Fog returns 120 s after the reset, not before.
    vi.advanceTimersByTime(119_000 - 650);
    ghost.engine.tick();
    expect(ghost.engine.activeRuleIds()).toEqual([]);
    vi.advanceTimersByTime(1_500);
    ghost.engine.tick();
    expect(ghost.engine.activeRuleIds()).toEqual(['doomscroll-fog']);
    const resetValue = ghost.meters.values().timeOnSite;
    expect(resetValue).toBeGreaterThanOrEqual(120);
    expect(resetValue).toBeLessThan(121);

    // A later pause and resume continues from the reset value.
    await controller.setPaused(true);
    await controller.setPaused(false);
    expect(ghosts).toHaveLength(2);
    expect(starts[1].timeOnSite).toBe(resetValue);
    expect(starts[1].scrollDistance).toBe(42);
    expect(ghosts[1].engine.activeRuleIds()).toEqual(['doomscroll-fog']);
  });
});

describe('Doomscroll finale profile and safety (10.2, 10.7)', () => {
  it('the demo ritual threshold is 25, after Block blocks pointers at 24 and reaches full intensity at 25', () => {
    const { doomscrollCreateDemoProfile } = loadContent();
    const demo = plain(doomscrollCreateDemoProfile(NORMAL)).rules;
    const ritual = demo.find((r) => r.id === 'doomscroll-ritual');
    const block = demo.find((r) => r.id === 'doomscroll-block');
    expect(ritual.trigger).toEqual({ meter: 'timeOnSite', threshold: 25 });
    const blockPointersAt = block.trigger.threshold + block.effect.params.blockAt * (block.trigger.rampTo - block.trigger.threshold);
    expect(blockPointersAt).toBe(24);
    expect(block.trigger.rampTo).toBe(25);
    expect(ritual.trigger.threshold).toBeGreaterThanOrEqual(blockPointersAt);
  });

  it('the content script adds no beforeunload and sends no tab-closing, reloading or navigating message', () => {
    expect(SOURCE).not.toMatch(/beforeunload|onbeforeunload/);
    expect(SOURCE).not.toMatch(/chrome(Api)?\.tabs|\.reload\(|location\.(assign|replace|href\s*=)|window\.close|history\.(back|go|push|replace)/);
    const sends = SOURCE.match(/sendMessage\([^)]*\)/g) || [];
    expect(sends).toEqual(['sendMessage({ type: MSG.CONTENT_STATE })']);
    const msgBlock = SOURCE.match(/const MSG = \{[\s\S]*?\};/)[0];
    expect(msgBlock).not.toMatch(/close|reload|navigat/i);
  });

  it('the manifest permissions are unchanged', () => {
    expect(MANIFEST.permissions).toEqual(['storage']);
    expect(MANIFEST.host_permissions).toEqual(HOSTS);
  });
});
