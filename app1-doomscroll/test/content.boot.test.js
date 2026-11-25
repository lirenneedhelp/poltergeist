import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as skeleton from '../../skeleton/index.js';

const RAW = readFileSync(fileURLToPath(new URL('../content.js', import.meta.url)), 'utf8');
// The loader's only dynamic import() is routed to a fake module boundary in the sandbox.
const SOURCE = RAW.replace(/\bimport\(/g, '__fakeImport(');
const NORMAL = JSON.parse(readFileSync(fileURLToPath(new URL('../rules.json', import.meta.url)), 'utf8'));
const EXT_ID = 'ext-id';
const flush = async (n = 30) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

/**
 * Run the classic loader in a VM with fake chrome / fetch / window and a fake
 * dynamic-import boundary. Returns handles to drive listeners.
 */
async function boot({
  initial = { ok: true, paused: false, demoMode: false },
  sendMessage,
  fetchImpl,
  importImpl,
  noChrome = false,
  ghostOverrides = {},
} = {}) {
  const urls = { imports: [], fetches: [] };
  const log = { starts: [], stops: [], order: [], errors: [] };
  const listeners = { message: [], storage: [], pagehide: [], motion: [] };
  const api = {
    validateRules: skeleton.validateRules,
    builtinEffects: skeleton.builtinEffects,
    startPoltergeist(opts) {
      if (api.failStart) throw new Error('start boom');
      log.order.push('start');
      const ghost = {
        opts,
        meters: { values: () => ({ timeOnSite: 7, scrollDistance: 3 }) },
        stop() {
          if (api.failStop) throw new Error('stop boom');
          log.order.push('stop');
          log.stops.push(ghost);
        },
        ...ghostOverrides,
      };
      log.starts.push(ghost);
      return ghost;
    },
  };
  const chrome = {
    runtime: {
      id: EXT_ID,
      getURL: (p) => `chrome-extension://${EXT_ID}/${p}`,
      sendMessage: sendMessage || (async () => initial),
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    storage: { onChanged: { addListener: (fn) => listeners.storage.push(fn) } },
  };
  const sandbox = {
    console: { error: (...a) => log.errors.push(a.join(' ')) },
    structuredClone,
    chrome: noChrome ? undefined : chrome,
    fetch: async (url) => {
      urls.fetches.push(url);
      if (fetchImpl) return fetchImpl(url);
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(NORMAL)) };
    },
    addEventListener: (t, fn) => listeners[t === 'pagehide' ? 'pagehide' : 'other']?.push(fn),
    matchMedia: () => ({ addEventListener: (_t, fn) => listeners.motion.push(fn) }),
  };
  sandbox.window = sandbox;
  sandbox.__fakeImport = async (spec) => {
    urls.imports.push(spec);
    if (importImpl) return importImpl(spec);
    return api;
  };
  chrome.runtime.sendMessage = sendMessage
    ? (msg) => sendMessage(msg, listeners)
    : async () => initial;
  vm.runInNewContext(SOURCE, sandbox, { filename: 'content.js' });
  await flush();
  const send = (message, sender = { id: EXT_ID }) => {
    let response;
    for (const fn of listeners.message) fn(message, sender, (r) => { response = r; });
    return response;
  };
  return { api, log, urls, listeners, send, sandbox };
}

describe('content.js bootstrap boundaries', () => {
  it('does nothing without a chrome runtime', async () => {
    const h = await boot({ noChrome: true });
    expect(h.urls.imports).toEqual([]);
    expect(h.listeners.message).toHaveLength(0);
  });

  it('registers listeners before the initial state request and loads dynamic runtime URLs', async () => {
    const sent = [];
    const h2 = await boot({
      sendMessage: async (msg, l) => {
        sent.push({ msg, counts: [l.message.length, l.storage.length, l.pagehide.length, l.motion.length] });
        return { ok: true, paused: false, demoMode: false };
      },
    });
    expect(h2.listeners.message).toHaveLength(1);
    expect(h2.listeners.storage).toHaveLength(1);
    expect(h2.listeners.pagehide).toHaveLength(1);
    expect(h2.urls.imports).toEqual([`chrome-extension://${EXT_ID}/skeleton/index.js`]);
    expect(h2.urls.fetches).toEqual([`chrome-extension://${EXT_ID}/rules.json`]);
    expect(sent).toEqual([{ msg: { type: 'doomscroll:content-state' }, counts: [1, 1, 1, 1] }]);
    expect(h2.log.starts).toHaveLength(1);
    expect(h2.log.starts[0].opts.rules.rules[0].trigger.threshold).toBe(120);
  });

  it('answers doomscroll:ping and rejects foreign senders and unknown messages', async () => {
    const h = await boot();
    expect(h.send({ type: 'doomscroll:ping' })).toEqual({ ok: true });
    expect(h.send({ type: 'doomscroll:ping' }, { id: 'other' })).toBeUndefined();
    expect(h.send({ type: 'nope' })).toBeUndefined();
    expect(h.send(null)).toBeUndefined();
  });

  it('applies doomscroll:apply-paused and validates the Boolean', async () => {
    const h = await boot();
    expect(h.log.starts).toHaveLength(1);
    expect(h.send({ type: 'doomscroll:apply-paused', paused: 'yes' })).toMatchObject({ ok: false });
    expect(h.send({ type: 'doomscroll:apply-paused', paused: true })).toEqual({ ok: true });
    await flush();
    expect(h.log.stops).toHaveLength(1);
    h.send({ type: 'doomscroll:apply-paused', paused: false });
    await flush();
    expect(h.log.starts).toHaveLength(2);
    expect(h.log.order).toEqual(['start', 'stop', 'start']);
  });

  it('reacts to doomscroll.demoMode storage changes only in local area', async () => {
    const h = await boot();
    const [onChanged] = h.listeners.storage;
    onChanged({ 'doomscroll.demoMode': { newValue: true } }, 'sync');
    onChanged({ other: { newValue: true } }, 'local');
    onChanged({ 'doomscroll.demoMode': { newValue: 'junk' } }, 'local');
    await flush();
    expect(h.log.starts).toHaveLength(1);
    onChanged({ 'doomscroll.demoMode': { newValue: true } }, 'local');
    await flush();
    expect(h.log.starts).toHaveLength(2);
    expect(h.log.starts[1].opts.rules.rules[0].trigger.threshold).toBe(2);
    expect(h.log.starts[1].opts.initialMeters).toEqual({ timeOnSite: 0, scrollDistance: 0 });
    onChanged({ 'doomscroll.demoMode': {} }, 'local'); // removed key = default off
    await flush();
    expect(h.log.starts[2].opts.rules.rules[0].trigger.threshold).toBe(120);
    expect(h.log.order).toEqual(['start', 'stop', 'start', 'stop', 'start']);
  });

  it('restarts on a reduced-motion change', async () => {
    const h = await boot();
    h.listeners.motion[0]();
    await flush();
    expect(h.log.order).toEqual(['start', 'stop', 'start']);
  });

  it('stops reconciling after pagehide', async () => {
    const h = await boot();
    h.listeners.pagehide[0]();
    h.send({ type: 'doomscroll:apply-paused', paused: true });
    await flush();
    expect(h.log.stops).toHaveLength(0);
    expect(h.log.starts).toHaveLength(1);
  });

  it('a live event racing the initial response wins per field', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const h = await boot({ sendMessage: async () => { await gate; return { ok: true, paused: false, demoMode: false }; } });
    expect(h.log.starts).toHaveLength(0);
    h.send({ type: 'doomscroll:apply-paused', paused: true });
    h.listeners.storage[0]({ 'doomscroll.demoMode': { newValue: true } }, 'local');
    release();
    await flush();
    expect(h.log.starts).toHaveLength(0); // paused wins; stale initial paused:false ignored
    h.send({ type: 'doomscroll:apply-paused', paused: false });
    await flush();
    expect(h.log.starts).toHaveLength(1);
    expect(h.log.starts[0].opts.rules.rules[0].trigger.threshold).toBe(2); // demo true from live event
  });

  it('starts nothing and stays clean when the initial state is unavailable', async () => {
    for (const sendMessage of [async () => ({ ok: false }), async () => { throw new Error('no worker'); }, async () => undefined]) {
      const h = await boot({ sendMessage });
      expect(h.log.starts).toHaveLength(0);
      expect(h.log.errors).toHaveLength(1);
    }
  });

  it('reports once and starts nothing on a non-success rules response', async () => {
    const h = await boot({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
    expect(h.log.starts).toHaveLength(0);
    expect(h.log.errors).toHaveLength(1);
    expect(h.log.errors[0]).toContain('could not load');
    expect(h.urls.fetches).toHaveLength(1); // cached failure, no retry loop
    h.send({ type: 'doomscroll:apply-paused', paused: true });
    h.send({ type: 'doomscroll:apply-paused', paused: false });
    await flush();
    expect(h.urls.fetches).toHaveLength(1);
    expect(h.log.errors).toHaveLength(1);
  });

  it('reports once and starts nothing on bad JSON', async () => {
    const h = await boot({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }) });
    expect(h.log.starts).toHaveLength(0);
    expect(h.log.errors).toHaveLength(1);
  });

  it('reports a validation failure before any start', async () => {
    const bad = { rules: [{ id: 'x', trigger: { meter: 'timeOnSite', threshold: -1 } }] };
    const h = await boot({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => bad }) });
    expect(h.log.starts).toHaveLength(0);
    expect(h.log.errors).toHaveLength(1);
    expect(h.log.errors[0]).toContain('invalid');
  });

  it('handles an import failure cleanly', async () => {
    const h = await boot({ importImpl: () => { throw new Error('import boom'); } });
    expect(h.log.starts).toHaveLength(0);
    expect(h.log.errors).toHaveLength(1);
  });

  it('contains a start failure and halts without retry', async () => {
    const h = await boot({ importImpl: () => { const a = {}; return a; } });
    expect(h.log.starts).toHaveLength(0); // module lacking the API is a clean failure
    const h2 = await boot();
    h2.api.failStart = true;
    h2.send({ type: 'doomscroll:apply-paused', paused: true });
    await flush();
    h2.send({ type: 'doomscroll:apply-paused', paused: false });
    await flush();
    h2.listeners.storage[0]({ 'doomscroll.demoMode': { newValue: true } }, 'local');
    await flush();
    expect(h2.log.starts).toHaveLength(1);
    expect(h2.log.errors).toHaveLength(1);
    expect(h2.log.errors[0]).toContain('starting the haunt failed');
  });

  it('routes the single dynamic import through the runtime URL', () => {
    expect(RAW.match(/\bimport\(/g)).toHaveLength(1);
    expect(RAW).toContain("import(chromeApi.runtime.getURL('skeleton/index.js'))");
  });

  it('never calls startPoltergeist for a stale generation and stops before starting under rapid toggles', async () => {
    let releaseFetch;
    const fetchGate = new Promise((r) => { releaseFetch = r; });
    const h = await boot({
      fetchImpl: async () => { await fetchGate; return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(NORMAL)) }; },
    });
    const onChanged = h.listeners.storage[0];
    // Deferred package load is in flight; rapid events make the pending start obsolete.
    for (let i = 0; i < 6; i += 1) {
      h.send({ type: 'doomscroll:apply-paused', paused: i % 2 === 0 });
      onChanged({ 'doomscroll.demoMode': { newValue: i % 2 === 1 } }, 'local');
    }
    expect(h.log.starts).toHaveLength(0); // nothing synchronous while loading
    releaseFetch();
    await flush();
    // Final desired: paused=false (i=5), demo=true → exactly one demo instance.
    expect(h.log.starts).toHaveLength(1);
    expect(h.log.starts[0].opts.rules.rules[0].trigger.threshold).toBe(2);
    h.send({ type: 'doomscroll:apply-paused', paused: true });
    await flush();
    h.send({ type: 'doomscroll:apply-paused', paused: false });
    onChanged({ 'doomscroll.demoMode': { newValue: false } }, 'local');
    await flush();
    expect(h.log.order).toEqual(['start', 'stop', 'start']);
    expect(h.log.starts.filter((g) => !h.log.stops.includes(g))).toHaveLength(1);
  });

  it('keeps ownership and starts no replacement when stop throws', async () => {
    const h = await boot();
    h.api.failStop = true;
    h.send({ type: 'doomscroll:apply-paused', paused: true });
    await flush();
    h.send({ type: 'doomscroll:apply-paused', paused: false });
    h.listeners.storage[0]({ 'doomscroll.demoMode': { newValue: true } }, 'local');
    await flush();
    expect(h.log.starts).toHaveLength(1);
    expect(h.log.errors[0]).toContain('stopping the haunt failed');
    expect(h.log.errors).toHaveLength(1);
  });
});

describe('Normal_Profile immutability and 1/60 scaling (via loader)', () => {
  it('demo values are exactly normal/60 and the normal profile is untouched, including nested data', async () => {
    const h = await boot({ initial: { ok: true, paused: false, demoMode: true } });
    const demo = h.log.starts[0].opts.rules.rules;
    expect(demo.map((r) => r.trigger.threshold)).toEqual(NORMAL.rules.map((r) => r.trigger.threshold / 60));
    expect(demo.map((r) => r.trigger.rampTo)).toEqual(NORMAL.rules.map((r) => (r.trigger.rampTo === undefined ? undefined : r.trigger.rampTo / 60)));
    expect(demo.map((r) => r.trigger.threshold)).toEqual([2, 5, 10, 20, 25]);
    // Effects params are deep-cloned, not shared.
    demo[0].effect.params.maxBlur = 999;
    const h2 = await boot();
    expect(h2.log.starts[0].opts.rules.rules[0].effect.params.maxBlur).toBe(5);
  });

  it('validates before start: invalid demo rules never reach startPoltergeist', async () => {
    const order = [];
    const h = await boot({
      initial: { ok: true, paused: false, demoMode: false },
      importImpl: () => ({
        validateRules: (...a) => { order.push('validate'); return skeleton.validateRules(...a); },
        builtinEffects: skeleton.builtinEffects,
        startPoltergeist: () => { order.push('start'); return { stop() {}, meters: { values: () => ({}) } }; },
      }),
    });
    expect(order).toEqual(['validate', 'start']);
    expect(h.log.errors).toHaveLength(0);
  });
});
