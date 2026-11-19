import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { validateRules, builtinEffects } from '../../skeleton/index.js';

const RAW = readFileSync(fileURLToPath(new URL('../content.js', import.meta.url)), 'utf8');
// The loader's only dynamic import() is routed to a fake module boundary in the sandbox.
const SOURCE = RAW.replace(/\bimport\(/g, '__fakeImport(');
const NORMAL = JSON.parse(readFileSync(fileURLToPath(new URL('../rules.json', import.meta.url)), 'utf8'));
const EXT_ID = 'ext-id';
const PREFIX = '[poltergeist:graveyard]';

const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setImmediate(r));
const timerTurn = () => new Promise((r) => setTimeout(r, 5));
const flush = async (n = 30) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

/** Evaluate content.js as a classic script in an isolated VM context (no chrome → boot is inert). */
function loadContent() {
  const sandbox = { structuredClone, console, setTimeout };
  vm.runInNewContext(RAW, sandbox, { filename: 'content.js' });
  return sandbox;
}

/**
 * Fake skeleton boundary: real rule validation and a recording startPoltergeist.
 * Each ghost's timeAway reads its seed plus 5 until reset.
 */
function makeApi(log) {
  const api = {
    live: 0,
    builtinEffects,
    validateRules: (...a) => (api.failValidate ? { valid: false, errors: ['forced'] } : validateRules(...a)),
    startPoltergeist(opts) {
      if (api.failStart) throw new Error('start boom');
      if (api.live > 0) log.overlaps += 1;
      api.live += 1;
      const ghost = {
        opts,
        rules: plain(opts.rules),
        initialMeters: plain(opts.initialMeters),
        live: true,
        timeAway: opts.initialMeters.timeAway + 5,
        meters: {
          values: () => ({ timeAway: ghost.timeAway }),
          reset: (name) => { log.order.push(`reset:${name}`); ghost.timeAway = 0; return true; },
        },
        engine: { tick: () => log.order.push('tick') },
        stop() {
          if (api.failStop) throw new Error('stop boom');
          if (ghost.live) { ghost.live = false; api.live -= 1; }
          log.order.push('stop');
        },
      };
      log.order.push('start');
      log.starts.push(ghost);
      return ghost;
    },
  };
  return api;
}

/** Fake service worker reply for one content message. */
async function workerReply(w, log, msg) {
  log.sent.push(plain(msg));
  if (msg.type === 'graveyard:content-state') {
    if (w.stateGate) await w.stateGate;
    if (w.failState) throw new Error('no worker at https://secret.example/x');
    return { ok: true, demoMode: w.demoMode, timeScale: w.demoMode ? 3600 : 1, epoch: w.epoch, heldSeconds: w.heldSeconds, currentSeconds: w.currentSeconds };
  }
  if (msg.type === 'graveyard:resurrect') {
    log.order.push('send:resurrect');
    if (w.resurrectGate) await w.resurrectGate;
    if (w.resurrectThrows) throw new Error('worker gone');
    return w.resurrectReply ?? { ok: true };
  }
  if (msg.type === 'graveyard:report') return { ok: true };
  return { ok: false, error: 'unknown' };
}

/** Controller-level harness with fake send, loadPackage, and defer. `delays` are tick counts consumed in turn. */
function makeHarness({ worker = {}, delays = [] } = {}) {
  const { graveyardCreateController } = loadContent();
  const w = { demoMode: false, epoch: 0, heldSeconds: 0, currentSeconds: 0, ...worker };
  const log = { starts: [], sent: [], reports: [], order: [], overlaps: 0, deferred: [] };
  const api = makeApi(log);
  let di = 0;
  const wait = async () => {
    const n = delays.length ? delays[di++ % delays.length] : 0;
    for (let i = 0; i < n; i += 1) await tick();
  };
  const controller = graveyardCreateController({
    loadPackage: async () => {
      await wait();
      if (w.failLoad) throw new Error('fetch failed');
      return { api, normalProfile: NORMAL };
    },
    send: async (msg) => { await wait(); return workerReply(w, log, msg); },
    getTitle: () => w.title ?? 'Lecture 4 notes',
    defer: (fn) => log.deferred.push(fn),
    report: (kind, message) => log.reports.push({ kind, message }),
  });
  const runDeferred = () => { const fns = log.deferred.splice(0); fns.forEach((fn) => fn()); };
  return { controller, api, w, log, runDeferred };
}

const thresholds = (rules) => rules.rules.map((r) => [r.trigger.threshold, r.trigger.rampTo]);

describe('content.js classic loader shape', () => {
  it('has no static import/export and uses one dynamic import of the runtime URL', () => {
    expect(RAW).not.toMatch(/^\s*(?:import|export)\s/m);
    expect(RAW.match(/\bimport\(/g)).toHaveLength(1);
    expect(RAW).toContain("import(chromeApi.runtime.getURL('skeleton/index.js'))");
    expect(RAW).toContain("fetch(chromeApi.runtime.getURL('rules.json'))");
    const sandbox = loadContent();
    expect(typeof sandbox.graveyardCreateController).toBe('function');
    expect(typeof sandbox.graveyardCreateDemoProfile).toBe('function');
  });

  it('contains no code that closes, navigates, or reloads the tab', () => {
    const code = RAW.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/\blocation\b|\.reload\(|window\.close|\.close\(|tabs\.|history\.|\.navigate\(/);
  });
});

describe('graveyardCreateDemoProfile', () => {
  it('divides thresholds by exactly 3600 into the 0.5-2 / 4-12 / 24 s stages and leaves the normal profile unchanged', () => {
    const { graveyardCreateDemoProfile } = loadContent();
    const before = plain(NORMAL);
    const demo = plain(graveyardCreateDemoProfile(NORMAL));
    expect(thresholds(demo)).toEqual([[0.5, 2], [4, 12], [24, undefined]]);
    expect(demo.rules.map((r) => r.trigger.threshold)).toEqual(NORMAL.rules.map((r) => r.trigger.threshold / 3600));
    expect(validateRules(demo, builtinEffects).valid).toBe(true);
    expect(NORMAL).toEqual(before);
  });

  it('deep-clones: mutating the demo profile does not reach the normal one', () => {
    const { graveyardCreateDemoProfile } = loadContent();
    const demo = graveyardCreateDemoProfile(NORMAL);
    demo.rules[0].effect.params.maxBlur = 999;
    demo.rules[2].effect.params.heading = 'x';
    expect(NORMAL.rules[0].effect.params.maxBlur).toBe(4);
    expect(NORMAL.rules[2].effect.params.heading).toBe('Here lies {title}');
  });

  // Feature: tab-graveyard-app, Property 4: Demo scaling preserves shape and order
  // **Validates: Requirements 2.6**
  it('Property 4: scales only trigger times by 1/3600, keeps order, and leaves the normal profile unchanged', () => {
    const { graveyardCreateDemoProfile } = loadContent();
    const time = fc.integer({ min: 0, max: 1e9 }).map((ms) => ms / 1000);
    const rule = fc.record({
      id: fc.string({ minLength: 1, maxLength: 8 }),
      enabled: fc.boolean(),
      match: fc.array(fc.constantFrom('http://*/*', 'https://*/*'), { maxLength: 2 }),
      trigger: fc.oneof(
        fc.record({ meter: fc.constant('timeAway'), threshold: time, rampTo: time }),
        fc.record({ meter: fc.constant('timeAway'), threshold: time }),
      ),
      effect: fc.record({ type: fc.constantFrom('fog', 'rot', 'tombstone'), params: fc.dictionary(fc.string({ maxLength: 4 }), fc.integer()) }),
      undo: fc.option(fc.record({ mode: fc.constant('fade'), durationMs: fc.nat(2000) }), { nil: undefined }),
    }, { requiredKeys: ['id', 'enabled', 'match', 'trigger', 'effect'] });
    fc.assert(fc.property(fc.array(rule, { maxLength: 8 }), (rules) => {
      const normal = { rules };
      const before = plain(normal);
      const demo = plain(graveyardCreateDemoProfile(normal));
      expect(plain(normal)).toEqual(before);
      expect(demo.rules).toHaveLength(before.rules.length);
      demo.rules.forEach((d, i) => {
        const n = before.rules[i];
        const { trigger: dt, ...dRest } = d;
        const { trigger: nt, ...nRest } = n;
        expect(dRest).toEqual(nRest);
        expect(dt.meter).toBe(nt.meter);
        expect(dt.threshold).toBe(nt.threshold / 3600);
        if (nt.rampTo === undefined) expect(dt.rampTo).toBeUndefined();
        else expect(dt.rampTo).toBe(nt.rampTo / 3600);
      });
      for (let i = 0; i < before.rules.length; i += 1) {
        for (let j = 0; j < before.rules.length; j += 1) {
          expect(demo.rules[i].trigger.threshold <= demo.rules[j].trigger.threshold)
            .toBe(before.rules[i].trigger.threshold <= before.rules[j].trigger.threshold);
        }
      }
    }), { numRuns: 100 });
  });
});

describe('graveyardCreateController', () => {
  it('starts nothing before a successful content-state reply', async () => {
    let release;
    const { controller, log } = makeHarness({ worker: { stateGate: new Promise((r) => { release = r; }) } });
    const done = controller.refresh();
    await flush();
    expect(log.sent).toEqual([{ type: 'graveyard:content-state', title: 'Lecture 4 notes' }]);
    expect(log.starts).toHaveLength(0);
    release();
    await done;
    expect(log.starts).toHaveLength(1);
  });

  it('passes the reply seeds, tickMs 1000, and onAction to startPoltergeist with the normal profile', async () => {
    const { controller, log } = makeHarness({ worker: { heldSeconds: 93600, currentSeconds: 12, epoch: 3 } });
    await controller.refresh();
    const [ghost] = log.starts;
    expect(ghost.initialMeters).toEqual({ timeAway: 93600, timeAwayCurrent: 12 });
    expect(ghost.opts.tickMs).toBe(1000);
    expect(typeof ghost.opts.onAction).toBe('function');
    expect(ghost.rules).toEqual(NORMAL);
    expect(ghost.opts.rules).not.toBe(NORMAL);
    expect(controller.getState()).toMatchObject({ epoch: 3, demoMode: false, faulted: false });
  });

  it('sanitises bad seeds to 0 and rejects malformed replies without starting', async () => {
    const h = makeHarness({ worker: { heldSeconds: -4, currentSeconds: Number.NaN } });
    await h.controller.refresh();
    expect(h.log.starts[0].initialMeters).toEqual({ timeAway: 0, timeAwayCurrent: 0 });

    const { graveyardCreateController } = loadContent();
    for (const reply of [{ ok: false }, undefined, { ok: true, demoMode: 'yes', epoch: 0 }, { ok: true, demoMode: false, epoch: -1 }]) {
      const log = { starts: [], order: [], overlaps: 0 };
      const reports = [];
      const api = makeApi(log);
      const c = graveyardCreateController({
        loadPackage: async () => ({ api, normalProfile: NORMAL }),
        send: async () => reply,
        report: (kind) => reports.push(kind),
      });
      await c.refresh();
      expect(log.starts).toHaveLength(0);
      expect(reports).toEqual(['state']);
    }
  });

  it('reports on hidden with heldSeconds 0, and on visible after the deferred read with the started epoch', async () => {
    const { controller, log, w, runDeferred } = makeHarness({ worker: { heldSeconds: 40, epoch: 7 } });
    await controller.refresh();
    w.epoch = 8; // a later epoch on the worker must not change what this instance reports
    controller.visibilityChanged(false);
    await flush();
    expect(log.sent.at(-1)).toEqual({ type: 'graveyard:report', title: 'Lecture 4 notes', heldSeconds: 0, epoch: 7 });
    const count = log.sent.length;
    controller.visibilityChanged(true);
    await flush();
    expect(log.sent).toHaveLength(count); // nothing sent until the deferred turn
    log.starts[0].timeAway = 61; // the meter completes the Absence before the deferred read
    runDeferred();
    await flush();
    expect(log.sent.at(-1)).toEqual({ type: 'graveyard:report', title: 'Lecture 4 notes', heldSeconds: 61, epoch: 7 });
    expect(log.sent.every((m) => !('url' in m))).toBe(true);
  });

  it('Resurrect commits to the worker before resetting the meter and ticking the engine', async () => {
    let release;
    const { controller, log } = makeHarness({ worker: { heldSeconds: 90000, resurrectGate: new Promise((r) => { release = r; }) } });
    await controller.refresh();
    const ghost = log.starts[0];
    log.order.length = 0;
    const done = ghost.opts.onAction('resurrect');
    await flush();
    expect(log.order).toEqual(['send:resurrect']);
    expect(ghost.timeAway).toBe(90005);
    release();
    await done;
    expect(log.order).toEqual(['send:resurrect', 'reset:timeAway', 'tick']);
    expect(ghost.timeAway).toBe(0);
    expect(log.reports).toEqual([]);
  });

  it('ignores other action names', async () => {
    const { controller, log } = makeHarness();
    await controller.refresh();
    await log.starts[0].opts.onAction('other');
    expect(log.sent.filter((m) => m.type === 'graveyard:resurrect')).toHaveLength(0);
  });

  it('keeps the decay and reports once when Resurrect is not confirmed', async () => {
    for (const worker of [{ resurrectReply: { ok: false, error: 'x' } }, { resurrectThrows: true }]) {
      const { controller, log } = makeHarness({ worker: { heldSeconds: 90000, ...worker } });
      await controller.refresh();
      const ghost = log.starts[0];
      await ghost.opts.onAction('resurrect');
      await ghost.opts.onAction('resurrect');
      expect(log.order).not.toContain('reset:timeAway');
      expect(ghost.timeAway).toBe(90005);
      expect(log.reports.map((r) => r.kind)).toEqual(['resurrect']);
    }
  });

  it('handles graveyard:apply-reset by resetting and ticking, and rejects other messages', async () => {
    const { controller, log } = makeHarness({ worker: { heldSeconds: 100 } });
    await controller.refresh();
    log.order.length = 0;
    expect(plain(controller.handleWorkerMessage({ type: 'graveyard:apply-reset' }))).toEqual({ ok: true });
    expect(log.order).toEqual(['reset:timeAway', 'tick']);
    expect(controller.handleWorkerMessage({ type: 'graveyard:other' }).ok).toBe(false);
    expect(controller.handleWorkerMessage(null).ok).toBe(false);
    expect(controller.handleWorkerMessage('x').ok).toBe(false);
    expect(log.order).toEqual(['reset:timeAway', 'tick']);
  });

  it('restarts from fresh state with the demo profile on a demo change, stopping first', async () => {
    const { controller, log, w } = makeHarness({ worker: { heldSeconds: 7200 } });
    await controller.refresh();
    w.demoMode = true;
    w.epoch = 1;
    w.heldSeconds = 3;
    await controller.refresh();
    expect(log.order).toEqual(['start', 'stop', 'start']);
    expect(log.starts[0].live).toBe(false);
    expect(thresholds(log.starts[1].rules)).toEqual([[0.5, 2], [4, 12], [24, undefined]]);
    expect(log.starts[1].initialMeters).toEqual({ timeAway: 3, timeAwayCurrent: 0 });
    expect(controller.getState()).toMatchObject({ demoMode: true, epoch: 1 });
    expect(NORMAL.rules[0].trigger.threshold).toBe(1800);
  });

  it('rapid triggers during deferred loads and replies leave exactly one instance of the newest state', async () => {
    const { controller, log, w, api } = makeHarness({ delays: [3, 1, 2] });
    for (let i = 0; i < 6; i += 1) {
      w.demoMode = i % 2 === 1;
      w.epoch = i;
      controller.refresh();
    }
    expect(log.starts).toHaveLength(0);
    await controller.whenIdle();
    expect(log.overlaps).toBe(0);
    expect(api.live).toBe(1);
    expect(log.starts).toHaveLength(1);
    expect(controller.getState()).toMatchObject({ demoMode: true, epoch: 5, pending: 0 });
  });

  it('pagehide stops reconciling; pageshow (revive) starts one replacement after stopping the old one', async () => {
    const { controller, log } = makeHarness({ delays: [1] });
    await controller.refresh();
    controller.dispose();
    await controller.refresh();
    expect(log.starts).toHaveLength(1);
    expect(controller.handleWorkerMessage({ type: 'graveyard:apply-reset' }).ok).toBe(false);
    controller.visibilityChanged(false);
    await flush();
    expect(log.sent.filter((m) => m.type === 'graveyard:report')).toHaveLength(0);
    await controller.revive();
    expect(log.starts).toHaveLength(2);
    expect(log.order).toEqual(['start', 'stop', 'start']);
    expect(log.overlaps).toBe(0);
  });

  it('a pagehide during a deferred load prevents the pending start', async () => {
    const { controller, log } = makeHarness({ delays: [2] });
    const done = controller.refresh();
    await tick();
    controller.dispose();
    await done;
    expect(log.starts).toHaveLength(0);
  });

  it('keeps the reference and faults when stop throws, starting no replacement', async () => {
    const { controller, api, log, w } = makeHarness();
    await controller.refresh();
    api.failStop = true;
    w.demoMode = true;
    await controller.refresh();
    await controller.refresh();
    expect(log.starts).toHaveLength(1);
    expect(controller.getState()).toMatchObject({ faulted: true });
    expect(controller.getState().ghost).toBe(log.starts[0]);
    expect(log.reports.map((r) => r.kind)).toEqual(['stop']);
    expect(controller.handleWorkerMessage({ type: 'graveyard:apply-reset' }).ok).toBe(false);
  });

  it('faults without retry when startPoltergeist throws', async () => {
    const { controller, api, log } = makeHarness();
    api.failStart = true;
    await controller.refresh();
    await controller.refresh();
    expect(controller.getState()).toMatchObject({ faulted: true, ghost: null });
    expect(log.reports.map((r) => r.kind)).toEqual(['start']);
  });

  it('a validation or load failure leaves the page clean and reports once per kind', async () => {
    const { controller, api, log, w } = makeHarness();
    await controller.refresh();
    api.failValidate = true;
    await controller.refresh();
    await controller.refresh();
    expect(log.starts[0].live).toBe(false);
    expect(controller.getState().ghost).toBeNull();
    api.failValidate = false;
    w.failLoad = true;
    await controller.refresh();
    await controller.refresh();
    expect(log.reports.map((r) => r.kind)).toEqual(['validate-normal', 'load']);
    expect(log.starts).toHaveLength(1);
  });

  // Feature: tab-graveyard-app, Property 5: At most one live instance
  // **Validates: Requirements 6.10, 6.11, 6.12**
  it('Property 5: any trigger sequence with deferred loads and replies leaves at most one live instance', async () => {
    const event = fc.record({
      kind: fc.constantFrom('demo', 'pageshow', 'boot'),
      wait: fc.constantFrom('none', 'tick', 'idle'),
    });
    await fc.assert(fc.asyncProperty(
      fc.array(fc.nat(3), { minLength: 1, maxLength: 5 }),
      fc.array(event, { maxLength: 10 }),
      async (delays, events) => {
        const { controller, log, w, api } = makeHarness({ delays });
        controller.refresh(); // boot
        for (const e of events) {
          if (e.kind === 'demo') {
            w.demoMode = !w.demoMode;
            w.epoch += 1;
            controller.refresh();
          } else if (e.kind === 'pageshow') {
            // pagehide: the skeleton's own listener stops the instance; then the page is restored.
            controller.dispose();
            const cur = controller.getState().ghost;
            if (cur) cur.stop();
            controller.revive();
          } else {
            controller.refresh();
          }
          if (e.wait === 'tick') await tick();
          else if (e.wait === 'idle') await controller.whenIdle();
          expect(api.live).toBeLessThanOrEqual(1);
          expect(log.overlaps).toBe(0);
        }
        await controller.whenIdle();
        const s = controller.getState();
        expect(log.overlaps).toBe(0);
        expect(s.faulted).toBe(false);
        expect(api.live).toBe(1);
        expect(s.ghost.live).toBe(true);
        expect(s.demoMode).toBe(w.demoMode);
        expect(s.epoch).toBe(w.epoch);
        expect(s.ghost.rules.rules[0].trigger.threshold).toBe(w.demoMode ? 0.5 : 1800);
      },
    ), { numRuns: 100 });
  }, 60000);
});

/**
 * Run the classic loader in a VM with fake chrome / fetch / window / document and a
 * fake dynamic-import boundary. Any access to tabs, location changes, or close is recorded.
 */
async function boot({ worker = {}, fetchImpl, importImpl, title = 'Fixture page' } = {}) {
  const w = { demoMode: false, epoch: 0, heldSeconds: 0, currentSeconds: 0, ...worker };
  const log = { starts: [], sent: [], order: [], overlaps: 0, errors: [], imports: [], fetches: [], forbidden: [], countsAtFirstSend: null };
  const listeners = { pagehide: [], pageshow: [], visibilitychange: [], message: [], storage: [] };
  const api = makeApi(log);
  const counts = () => Object.fromEntries(Object.entries(listeners).map(([k, v]) => [k, v.length]));
  const forbid = (name) => () => log.forbidden.push(name);
  const doc = {
    title,
    visibilityState: 'visible',
    addEventListener: (t, fn) => listeners[t]?.push(fn),
  };
  const chrome = {
    runtime: {
      id: EXT_ID,
      getURL: (p) => `chrome-extension://${EXT_ID}/${p}`,
      sendMessage: (msg) => {
        if (!log.countsAtFirstSend) log.countsAtFirstSend = counts();
        return workerReply(w, log, msg);
      },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      reload: forbid('runtime.reload'),
    },
    storage: { onChanged: { addListener: (fn) => listeners.storage.push(fn) } },
  };
  Object.defineProperty(chrome, 'tabs', { get: () => { log.forbidden.push('tabs'); return undefined; } });
  const sandbox = {
    console: { error: (...a) => log.errors.push(a.map(String).join(' ')) },
    structuredClone,
    setTimeout,
    chrome,
    document: doc,
    location: { href: 'https://fixture.test/page', assign: forbid('assign'), replace: forbid('replace'), reload: forbid('reload') },
    history: { back: forbid('back'), go: forbid('go'), pushState: forbid('pushState') },
    close: forbid('close'),
    fetch: async (url) => {
      log.fetches.push(url);
      if (fetchImpl) return fetchImpl(url);
      return { ok: true, status: 200, json: async () => plain(NORMAL) };
    },
    addEventListener: (t, fn) => listeners[t]?.push(fn),
    __fakeImport: async (spec) => {
      log.imports.push(spec);
      if (importImpl) return importImpl(spec);
      return api;
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(SOURCE, sandbox, { filename: 'content.js' });
  await flush();
  const send = (message, sender = { id: EXT_ID }) => {
    let response;
    for (const fn of listeners.message) fn(message, sender, (r) => { response = r; });
    return response;
  };
  const setVisible = async (visible) => {
    doc.visibilityState = visible ? 'visible' : 'hidden';
    listeners.visibilitychange.forEach((fn) => fn());
    await timerTurn(); // the deferred held-value read runs on a real timer turn
    await flush();
  };
  return { api, w, log, listeners, send, doc, setVisible };
}

describe('content.js bootstrap', () => {
  it('registers every listener before requesting state and loads the package from runtime URLs', async () => {
    const h = await boot({ worker: { heldSeconds: 30, currentSeconds: 2 } });
    expect(h.log.countsAtFirstSend).toEqual({ pagehide: 1, pageshow: 1, visibilitychange: 1, message: 1, storage: 1 });
    expect(h.log.sent[0]).toEqual({ type: 'graveyard:content-state', title: 'Fixture page' });
    expect(h.log.imports).toEqual([`chrome-extension://${EXT_ID}/skeleton/index.js`]);
    expect(h.log.fetches).toEqual([`chrome-extension://${EXT_ID}/rules.json`]);
    expect(h.log.starts).toHaveLength(1);
    expect(h.log.starts[0].initialMeters).toEqual({ timeAway: 30, timeAwayCurrent: 2 });
    expect(h.log.starts[0].opts.tickMs).toBe(1000);
    expect(h.log.errors).toEqual([]);
  });

  it('sends reports on visibility changes with the epoch and the deferred held value', async () => {
    const h = await boot({ worker: { heldSeconds: 10, epoch: 2 } });
    await h.setVisible(false);
    expect(h.log.sent.at(-1)).toEqual({ type: 'graveyard:report', title: 'Fixture page', heldSeconds: 0, epoch: 2 });
    h.log.starts[0].timeAway = 44;
    await h.setVisible(true);
    expect(h.log.sent.at(-1)).toEqual({ type: 'graveyard:report', title: 'Fixture page', heldSeconds: 44, epoch: 2 });
  });

  it('answers graveyard:apply-reset from its own extension only', async () => {
    const h = await boot({ worker: { heldSeconds: 100 } });
    h.log.order.length = 0;
    expect(h.send({ type: 'graveyard:apply-reset' }, { id: 'other' })).toBeUndefined();
    expect(h.log.order).toEqual([]);
    expect(plain(h.send({ type: 'graveyard:apply-reset' }))).toEqual({ ok: true });
    expect(h.log.order).toEqual(['reset:timeAway', 'tick']);
    expect(h.send({ type: 'nope' }).ok).toBe(false);
  });

  it('refreshes on graveyard.demoMode changes in the local area only', async () => {
    const h = await boot();
    const [onChanged] = h.listeners.storage;
    onChanged({ 'graveyard.demoMode': { newValue: true } }, 'session');
    onChanged({ other: { newValue: true } }, 'local');
    await flush();
    expect(h.log.starts).toHaveLength(1);
    h.w.demoMode = true;
    h.w.epoch = 1;
    onChanged({ 'graveyard.demoMode': { newValue: true } }, 'local');
    await flush();
    expect(h.log.order).toEqual(['start', 'stop', 'start']);
    expect(h.log.starts[1].rules.rules[2].trigger.threshold).toBe(24);
    expect(h.log.fetches).toHaveLength(1); // cached package Promise
  });

  it('stops reconciling after pagehide and restarts once on a persisted pageshow', async () => {
    const h = await boot();
    h.listeners.pagehide[0]();
    h.listeners.storage[0]({ 'graveyard.demoMode': { newValue: true } }, 'local');
    h.listeners.pageshow[0]({ persisted: false });
    await flush();
    expect(h.log.starts).toHaveLength(1);
    h.listeners.pageshow[0]({ persisted: true });
    await flush();
    expect(h.log.starts).toHaveLength(2);
    expect(h.log.order).toEqual(['start', 'stop', 'start']);
  });

  it('Resurrect through the effect callback resets only after the worker confirms', async () => {
    const h = await boot({ worker: { heldSeconds: 90000 } });
    h.log.order.length = 0;
    await h.log.starts[0].opts.onAction('resurrect');
    expect(h.log.order).toEqual(['send:resurrect', 'reset:timeAway', 'tick']);
  });

  it('never closes, navigates, or reloads its tab and never touches the Tabs API', async () => {
    const h = await boot({ worker: { heldSeconds: 90000 } });
    await h.setVisible(false);
    await h.setVisible(true);
    await h.log.starts[0].opts.onAction('resurrect');
    h.send({ type: 'graveyard:apply-reset' });
    h.listeners.storage[0]({ 'graveyard.demoMode': { newValue: true } }, 'local');
    h.listeners.pagehide[0]();
    h.listeners.pageshow[0]({ persisted: true });
    await flush();
    expect(h.log.forbidden).toEqual([]);
  });
});

describe('content.js diagnostics', () => {
  const clean = (h, title) => {
    for (const line of h.log.errors) {
      expect(line.startsWith(PREFIX)).toBe(true);
      expect(line).not.toContain(title);
      expect(line).not.toMatch(/[a-z-]+:\/\//i);
    }
  };

  it('reports one state diagnostic, even across retries, with no title or URL', async () => {
    const title = 'Secret Title';
    const h = await boot({ title, worker: { failState: true } });
    h.listeners.storage[0]({ 'graveyard.demoMode': { newValue: true } }, 'local');
    await flush();
    expect(h.log.starts).toHaveLength(0);
    expect(h.log.errors).toHaveLength(1);
    clean(h, title);
  });

  it('reports one load diagnostic for an import failure and redacts the URL in the error', async () => {
    const title = 'Secret Title';
    const h = await boot({ title, importImpl: () => { throw new Error(`Failed to fetch module chrome-extension://${EXT_ID}/skeleton/index.js`); } });
    h.listeners.storage[0]({ 'graveyard.demoMode': { newValue: true } }, 'local');
    await flush();
    expect(h.log.starts).toHaveLength(0);
    expect(h.log.errors).toHaveLength(1);
    expect(h.log.errors[0]).toContain('could not load');
    expect(h.log.errors[0]).toContain('<url>');
    clean(h, title);
  });

  it('reports a load diagnostic for a failed rules fetch, bad JSON, or a module without the API', async () => {
    const cases = [
      { fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) },
      { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }) },
      { importImpl: () => ({}) },
    ];
    for (const opts of cases) {
      const h = await boot(opts);
      expect(h.log.starts).toHaveLength(0);
      expect(h.log.errors).toHaveLength(1);
      expect(h.log.errors[0]).toContain('could not load');
      clean(h, 'Fixture page');
    }
  });

  it('reports a validation failure before any start', async () => {
    const bad = { rules: [{ id: 'x', trigger: { meter: 'timeAway', threshold: -1 } }] };
    const h = await boot({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => bad }) });
    expect(h.log.starts).toHaveLength(0);
    expect(h.log.errors).toHaveLength(1);
    expect(h.log.errors[0]).toContain('invalid');
    clean(h, 'Fixture page');
  });

  it('reports start and stop failures once each', async () => {
    const h = await boot();
    h.api.failStop = true;
    h.listeners.storage[0]({ 'graveyard.demoMode': { newValue: true } }, 'local');
    await flush();
    h.listeners.storage[0]({ 'graveyard.demoMode': { newValue: false } }, 'local');
    await flush();
    expect(h.log.starts).toHaveLength(1);
    expect(h.log.errors).toHaveLength(1);
    expect(h.log.errors[0]).toContain('stopping the haunt failed');

    const failing = makeApi({ starts: [], order: [], overlaps: 0 });
    failing.failStart = true;
    const h2 = await boot({ importImpl: () => failing });
    expect(h2.log.errors).toHaveLength(1);
    expect(h2.log.errors[0]).toContain('starting the haunt failed');
    clean(h, 'Fixture page');
    clean(h2, 'Fixture page');
  });
});
