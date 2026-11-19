// Activity_Tracker tests: Chrome APIs are mocked with in-memory storage, an injected
// clock, and Tab objects wrapped in a Proxy that records any read of url, pendingUrl,
// title, or favIconUrl. Every test fails if the worker reads one of those properties.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { stripJsComments } from '../../scripts/package-checks.mjs';
import {
  MESSAGE, TAB_KEY_PREFIX, WINDOW_KEY_PREFIX, PROFILE_KEY, DEMO_KEY, BURIED_KEY,
  MAX_BURIED, MAX_BURY_IDS, MAX_TITLE_LENGTH, MAX_URL_LENGTH,
  tabKey, windowKey, truncateTitle, createBackground, registerBackground,
} from '../background.js';

const RULES = JSON.parse(readFileSync(new URL('../rules.json', import.meta.url), 'utf8'));
const SOURCE = readFileSync(new URL('../background.js', import.meta.url), 'utf8');

const EXT_ID = 'graveyard-ext';
const BASE = `chrome-extension://${EXT_ID}/`;
const popupSender = { id: EXT_ID, url: `${BASE}popup.html` };
const FORBIDDEN = ['url', 'pendingUrl', 'title', 'favIconUrl'];
const SECRET = 'SECRET-TAB-PROPERTY';
const S = 1000;
const H = 3600 * S;
const DAY = 24 * H;
const T0 = 1_800_000_000_000;
const WIN = 10;

const urlOf = (id) => `https://site${id}.test/page`;

function makeArea(log, name) {
  const data = {};
  return {
    data,
    failSet: false, // boolean or predicate on the object being written
    async get(key) {
      if (key === null) return structuredClone(data);
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj) {
      const fail = typeof this.failSet === 'function' ? this.failSet(obj) : this.failSet;
      if (fail) throw new Error('quota');
      log.push(`${name}.set:${Object.keys(obj).join(',')}`);
      Object.assign(data, structuredClone(obj));
    },
    async remove(keys) {
      log.push(`${name}.remove`);
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

/** A Chrome API mock covering exactly what background.js uses. */
function setup({ rules = RULES } = {}) {
  const log = [];
  const forbiddenReads = [];
  const open = new Map(); // id -> { id, windowId, active, incognito }
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => { (listeners[name] ??= []).push(fn); } });
  let clock = T0;
  let nextTabId = 1000;
  let nextEntry = 0;
  const removeFails = new Set();
  const removeSnapshots = [];

  const makeTab = (props) => new Proxy(
    { ...props, url: SECRET, pendingUrl: SECRET, title: SECRET, favIconUrl: SECRET },
    {
      get(target, key, receiver) {
        if (FORBIDDEN.includes(key)) forbiddenReads.push(key);
        return Reflect.get(target, key, receiver);
      },
    },
  );

  const chromeApi = {
    storage: { session: makeArea(log, 'session'), local: makeArea(log, 'local') },
    tabs: {
      query: vi.fn(async () => [...open.values()].map(makeTab)),
      get: vi.fn(async (id) => {
        if (!open.has(id)) throw new Error(`No tab with id: ${id}`);
        return makeTab(open.get(id));
      }),
      remove: vi.fn(async (id) => {
        removeSnapshots.push({ id, buried: structuredClone(chromeApi.storage.local.data[BURIED_KEY]) });
        if (removeFails.has(id)) throw new Error('cannot close');
        log.push(`tabs.remove:${id}`);
        open.delete(id);
      }),
      create: vi.fn(async ({ active }) => {
        if (chromeApi.tabs.failCreate) throw new Error('cannot create');
        log.push('tabs.create');
        const id = nextTabId++;
        open.set(id, { id, windowId: WIN, active: active === true, incognito: false });
        return makeTab(open.get(id));
      }),
      failCreate: false,
      sendMessage: vi.fn(async () => { log.push('tabs.sendMessage'); return { ok: true }; }),
      onActivated: event('activated'),
      onReplaced: event('replaced'),
      onRemoved: event('removed'),
    },
    windows: { onRemoved: event('windowRemoved') },
    runtime: {
      id: EXT_ID,
      getURL: (p = '') => `${BASE}${p}`,
      onMessage: event('message'),
      onInstalled: event('installed'),
      onStartup: event('startup'),
    },
  };

  const fetchState = { fail: false, calls: [] };
  const options = {
    now: () => clock,
    fetch: async (url) => {
      fetchState.calls.push(url);
      if (fetchState.fail) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => structuredClone(rules) };
    },
    randomId: () => `entry-${nextEntry++}`,
  };

  const env = {
    chromeApi, log, open, listeners, forbiddenReads, removeFails, removeSnapshots, fetchState, options,
    bg: createBackground(chromeApi, options),
    get now() { return clock; },
    advance(ms) { clock += ms; },
    session: chromeApi.storage.session.data,
    local: chromeApi.storage.local.data,
    rec: (id) => chromeApi.storage.session.data[tabKey(id)],
    restart() { env.bg = createBackground(chromeApi, options); return env.bg; },
    addTab(id, { windowId = WIN, active = false, incognito = false } = {}) {
      open.set(id, { id, windowId, active, incognito });
    },
    sender(id, overrides = {}) {
      const props = open.get(id) ?? { id, windowId: WIN, active: false, incognito: false };
      return { id: EXT_ID, frameId: 0, url: urlOf(id), tab: makeTab(props), ...overrides };
    },
    send: (message, sender) => env.bg.handleMessage(message, sender),
    content(id, title = `Page ${id}`, overrides = {}) {
      return env.bg.handleMessage({ type: MESSAGE.CONTENT_STATE, title }, env.sender(id, overrides));
    },
    report(id, heldSeconds, epoch = 0, title = `Page ${id}`) {
      return env.bg.handleMessage({ type: MESSAGE.REPORT, title, heldSeconds, epoch }, env.sender(id));
    },
    popup: (message) => env.bg.handleMessage(message, popupSender),
    /** Make `id` the active tab of its window (mock state) and fire onActivated. */
    async activate(id) {
      const windowId = open.get(id).windowId;
      for (const t of open.values()) if (t.windowId === windowId) t.active = t.id === id;
      await env.bg.handleActivated({ tabId: id, windowId });
    },
    /** An open, inactive, reported tab that has been away for `ms`. */
    async awayTab(id, ms, title) {
      env.addTab(id);
      await env.content(id, title);
      env.advance(ms);
    },
  };
  return env;
}

let env;
let errorSpy;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  env = setup();
});
afterEach(() => {
  // Requirement 1.6: no test may observe a read of a protected Tab property.
  expect(env.forbiddenReads).toEqual([]);
  errorSpy.mockRestore();
});

describe('storage keys and registration', () => {
  it('uses one namespaced key per tab and per window', () => {
    expect(tabKey(7)).toBe('graveyard.tab.7');
    expect(windowKey(3)).toBe('graveyard.window.3');
    expect(PROFILE_KEY).toBe('graveyard.profile');
    expect(DEMO_KEY).toBe('graveyard.demoMode');
    expect(BURIED_KEY).toBe('graveyard.buried');
  });

  it('registers every listener synchronously', () => {
    registerBackground(env.chromeApi, env.options);
    for (const name of ['message', 'installed', 'startup', 'activated', 'replaced', 'removed', 'windowRemoved']) {
      expect(env.listeners[name]).toHaveLength(1);
    }
    // onMessage answers asynchronously, MV3 style.
    const sendResponse = vi.fn();
    expect(env.listeners.message[0]({ type: 'nope' }, popupSender, sendResponse)).toBe(true);
  });
});

describe('tabs.onActivated', () => {
  beforeEach(async () => {
    env.addTab(1, { active: true });
    env.addTab(2);
    await env.bg.seedTabs();
  });

  it('starts an Absence for the previous tab and ends the activated tab\'s Absence', async () => {
    expect(env.session[windowKey(WIN)]).toBe(1);
    expect(env.rec(2).leftAt).toBe(T0);
    env.advance(5 * S);
    await env.activate(2);
    expect(env.session[windowKey(WIN)]).toBe(2);
    expect(env.rec(1)).toMatchObject({ url: null, leftAt: T0 + 5 * S, since: T0 + 5 * S });
    expect(env.rec(2)).toMatchObject({ leftAt: null, normal: { heldMs: 5 * S }, demo: { heldMs: 5 * S, epoch: 0 } });
  });

  it('keeps the longest Absence when a later Absence is shorter', async () => {
    env.advance(10 * S);
    await env.activate(2); // tab 2 held 10 s, tab 1 leaves
    env.advance(S);
    await env.activate(1); // tab 2 leaves, tab 1 held 1 s
    env.advance(2 * S);
    await env.activate(2);
    expect(env.rec(2).normal.heldMs).toBe(10 * S);
    expect(env.rec(1).normal.heldMs).toBe(S);
  });

  it('creates a stub record (url null) for a previous tab that has none', async () => {
    delete env.session[tabKey(1)];
    env.advance(S);
    await env.activate(2);
    expect(env.rec(1)).toEqual({
      url: null, title: '', since: T0 + S, leftAt: T0 + S,
      normal: { heldMs: 0 }, demo: { heldMs: 0, epoch: 0 },
    });
  });

  it('does not restart an Absence already in progress', async () => {
    env.session[tabKey(1)] = { ...env.rec(2) }; // leftAt = T0
    env.advance(S);
    await env.activate(2);
    expect(env.rec(1).leftAt).toBe(T0);
  });

  it('skips a previous tab that moved to another window and is active there', async () => {
    env.open.get(1).windowId = 11; // moved and active in window 11
    env.open.get(1).active = true;
    delete env.session[tabKey(1)];
    await env.bg.handleActivated({ tabId: 2, windowId: WIN });
    expect(env.rec(1)).toBeUndefined();
  });

  it('skips a previous tab that no longer exists', async () => {
    env.open.delete(1);
    delete env.session[tabKey(1)];
    env.open.get(2).active = true;
    await env.bg.handleActivated({ tabId: 2, windowId: WIN });
    expect(env.rec(1)).toBeUndefined();
    expect(env.session[windowKey(WIN)]).toBe(2);
  });

  it('ignores malformed activation info', async () => {
    const before = structuredClone(env.session);
    await env.bg.handleActivated({ tabId: -1, windowId: WIN });
    await env.bg.handleActivated({ tabId: 2, windowId: -1 });
    await env.bg.handleActivated(undefined);
    expect(env.session).toEqual(before);
  });
});

describe('startup seeding', () => {
  it('records active tabs per window and stubs only unrecorded inactive tabs', async () => {
    env.addTab(1, { active: true });
    env.addTab(2);
    env.addTab(3);
    env.addTab(4, { windowId: 12, active: true });
    env.addTab(5, { incognito: true });
    env.session[tabKey(3)] = { url: urlOf(3), title: 'kept', since: 1, leftAt: 2, normal: { heldMs: 9 }, demo: { heldMs: 0, epoch: 0 } };
    await env.bg.seedTabs();
    expect(env.session[windowKey(WIN)]).toBe(1);
    expect(env.session[windowKey(12)]).toBe(4);
    expect(env.rec(1)).toBeUndefined();
    expect(env.rec(2)).toMatchObject({ url: null, leftAt: T0 });
    expect(env.rec(3).title).toBe('kept');
    expect(env.rec(5)).toBeUndefined();
  });

  it('logs and survives a failing tabs.query', async () => {
    env.chromeApi.tabs.query.mockRejectedValueOnce(new Error('boom'));
    await expect(env.bg.seedTabs()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('tabs.onReplaced, onRemoved, windows.onRemoved', () => {
  beforeEach(async () => {
    env.addTab(1, { active: true });
    env.addTab(2);
    await env.content(2, 'Two');
    await env.bg.seedTabs();
  });

  it('moves the record and window entry to the replacement id (discard)', async () => {
    env.session[tabKey(1)] = { ...env.rec(2), title: 'One' };
    const history = env.rec(1);
    await env.bg.handleReplaced(50, 1);
    expect(env.rec(1)).toBeUndefined();
    expect(env.rec(50)).toEqual(history);
    expect(env.session[windowKey(WIN)]).toBe(50);
  });

  it('keeps the newer URL and title when the replacement page already reported', async () => {
    env.addTab(60);
    await env.content(60, 'Reloaded');
    const history = env.rec(2);
    await env.bg.handleReplaced(60, 2);
    expect(env.rec(60)).toEqual({ ...history, url: urlOf(60), title: 'Reloaded' });
    expect(env.rec(2)).toBeUndefined();
  });

  it('deletes only the removed tab\'s record and its window entry', async () => {
    env.session[windowKey(11)] = 2;
    await env.bg.handleRemoved(1, { windowId: WIN });
    expect(env.session[windowKey(WIN)]).toBeUndefined();
    expect(env.rec(2)).toBeDefined();
    expect(env.session[windowKey(11)]).toBe(2);
    await env.bg.handleRemoved(2, {});
    expect(env.rec(2)).toBeUndefined();
    expect(env.session[windowKey(11)]).toBeUndefined();
  });

  it('keeps a window entry that points to another tab', async () => {
    await env.bg.handleRemoved(2, { windowId: WIN });
    expect(env.session[windowKey(WIN)]).toBe(1);
  });

  it('deletes the window entry on windows.onRemoved', async () => {
    await env.bg.handleWindowRemoved(WIN);
    expect(env.session[windowKey(WIN)]).toBeUndefined();
    expect(env.rec(2)).toBeDefined();
  });
});

describe('content messages', () => {
  it('creates a record from sender.url and the title, with an Absence when inactive', async () => {
    env.addTab(3);
    const reply = await env.bg.handleMessage(
      { type: MESSAGE.CONTENT_STATE, title: 'Notes', url: 'https://evil.test/', tabId: 99 }, env.sender(3),
    );
    expect(reply).toEqual({ ok: true, demoMode: false, timeScale: 1, epoch: 0, heldSeconds: 0, currentSeconds: 0 });
    expect(env.rec(3)).toEqual({
      url: urlOf(3), title: 'Notes', since: T0, leftAt: T0, normal: { heldMs: 0 }, demo: { heldMs: 0, epoch: 0 },
    });
    expect(env.rec(99)).toBeUndefined();
    env.advance(7 * S);
    expect((await env.content(3)).currentSeconds).toBe(7);
  });

  it('creates no Absence for an active sender', async () => {
    env.addTab(3, { active: true });
    await env.content(3);
    expect(env.rec(3).leftAt).toBeNull();
  });

  it('truncates titles to 300 code units without splitting a surrogate pair', async () => {
    env.addTab(3);
    await env.content(3, 'x'.repeat(400));
    expect(env.rec(3).title).toHaveLength(MAX_TITLE_LENGTH);
    expect(truncateTitle(`${'a'.repeat(299)}😀`)).toBe('a'.repeat(299));
  });

  it('rejects senders that are not this extension\'s top-frame http(s) content scripts', async () => {
    env.addTab(3);
    env.addTab(4, { incognito: true });
    const bad = [
      env.sender(3, { id: 'other' }),
      env.sender(3, { frameId: 1 }),
      env.sender(3, { url: 'file:///etc/passwd' }),
      env.sender(3, { url: `${BASE}popup.html` }),
      env.sender(3, { tab: undefined }),
      { ...env.sender(3), tab: { id: -1, active: true } },
      env.sender(4),
      popupSender,
    ];
    for (const sender of bad) {
      for (const type of [MESSAGE.CONTENT_STATE, MESSAGE.REPORT, MESSAGE.RESURRECT]) {
        const res = await env.bg.handleMessage({ type, title: 't', heldSeconds: 1, epoch: 0 }, sender);
        expect(res.ok).toBe(false);
      }
    }
    expect(env.session).toEqual({});
  });

  it('rejects malformed payloads', async () => {
    env.addTab(3);
    expect((await env.send({ type: MESSAGE.CONTENT_STATE, title: 5 }, env.sender(3))).ok).toBe(false);
    for (const bad of [{ title: 1, heldSeconds: 1, epoch: 0 }, { title: 't', heldSeconds: -1, epoch: 0 },
      { title: 't', heldSeconds: Infinity, epoch: 0 }, { title: 't', heldSeconds: 1, epoch: 1.5 }]) {
      expect((await env.send({ type: MESSAGE.REPORT, ...bad }, env.sender(3))).ok).toBe(false);
    }
    expect(env.session).toEqual({});
  });

  it('caps a report at the time since the record was created', async () => {
    env.addTab(3, { active: true });
    await env.content(3);
    env.advance(10 * S);
    expect(await env.report(3, 100, 0, 'Renamed')).toEqual({ ok: true, applied: true });
    expect(env.rec(3)).toMatchObject({ title: 'Renamed', normal: { heldMs: 10 * S }, demo: { heldMs: 0 } });
    await env.report(3, 4);
    expect(env.rec(3).normal.heldMs).toBe(10 * S); // a smaller report never lowers it
  });

  it('ignores a report from another epoch entirely', async () => {
    env.addTab(3, { active: true });
    await env.content(3, 'Original');
    env.advance(10 * S);
    const before = env.rec(3);
    expect(await env.report(3, 5, 1, 'Other')).toEqual({ ok: true, applied: false });
    expect(env.rec(3)).toEqual(before);
  });

  it('resurrect resets both Registers and restarts an Absence only when inactive', async () => {
    env.addTab(3);
    await env.content(3);
    env.advance(DAY);
    env.open.get(3).active = true;
    await env.activate(3);
    expect(env.rec(3).normal.heldMs).toBe(DAY);
    env.advance(S);
    expect(await env.send({ type: MESSAGE.RESURRECT }, env.sender(3))).toEqual({ ok: true });
    expect(env.rec(3)).toMatchObject({ since: env.now, leftAt: null, normal: { heldMs: 0 }, demo: { heldMs: 0, epoch: 0 } });
    env.open.get(3).active = false;
    await env.send({ type: MESSAGE.RESURRECT }, env.sender(3));
    expect(env.rec(3).leftAt).toBe(env.now);
  });
});

describe('demo epochs', () => {
  const setDemo = (enabled, sender = popupSender) => env.send({ type: MESSAGE.SET_DEMO, enabled }, sender);

  it('bumps the epoch before the flag and never touches normal Registers', async () => {
    await env.awayTab(2, H);
    env.addTab(1, { active: true });
    await env.content(1);
    const normalBefore = env.rec(2).normal;
    env.log.length = 0;
    expect(await setDemo(true)).toEqual({ ok: true, demoMode: true });
    expect(env.log).toEqual([`session.set:${PROFILE_KEY}`, `local.set:${DEMO_KEY}`]);
    expect(env.session[PROFILE_KEY]).toEqual({ epoch: 1, startedAt: env.now });
    expect(env.local[DEMO_KEY]).toBe(true);
    expect(env.rec(2).normal).toEqual(normalBefore);
  });

  it('writes nothing when the value does not change', async () => {
    expect(await setDemo(false)).toEqual({ ok: true, demoMode: false });
    expect(env.log).toEqual([]);
  });

  it('rejects non-Boolean values and non-extension senders', async () => {
    env.addTab(1);
    expect((await setDemo('yes')).ok).toBe(false);
    expect((await setDemo(true, env.sender(1))).ok).toBe(false);
    expect(env.local[DEMO_KEY]).toBeUndefined();
  });

  it('reports a failed save', async () => {
    env.chromeApi.storage.local.failSet = true;
    expect(await setDemo(true)).toEqual({ ok: false, error: 'could not save demo mode' });
  });

  it('measures a demo Absence from the epoch start, not from when the tab was left', async () => {
    await env.awayTab(2, 10 * H, 'Old tab');
    await setDemo(true);
    let state = await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 2 });
    expect(state.current).toEqual({ known: true, stage: 'alive', awaySeconds: 0 });
    expect(state.dead).toEqual([]);
    env.advance(3 * S);
    const reply = await env.content(2);
    expect(reply).toMatchObject({ demoMode: true, timeScale: 3600, epoch: 1, heldSeconds: 0, currentSeconds: 3 });
    state = await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 2 });
    expect(state.current.stage).toBe('fogged');
    env.advance(21 * S);
    state = await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 2 });
    expect(state.current).toEqual({ known: true, stage: 'dead', awaySeconds: 24 });
    expect(state.dead.map((d) => d.tabId)).toEqual([2]);
  });

  it('counts a demo Register from an earlier epoch as 0', async () => {
    env.addTab(1, { active: true });
    await env.bg.seedTabs();
    await setDemo(true);
    await env.awayTab(2, 30 * S);
    await env.activate(2);
    expect(env.rec(2).demo).toEqual({ heldMs: 30 * S, epoch: 1 });
    await setDemo(false);
    await setDemo(true); // epoch 3
    const reply = await env.content(2);
    expect(reply).toMatchObject({ epoch: 3, heldSeconds: 0, currentSeconds: 0 });
    // Normal Register still holds the real Absence.
    expect(env.rec(2).normal.heldMs).toBe(30 * S);
  });

  it('caps a demo report at the time since the epoch started', async () => {
    env.addTab(3, { active: true });
    await env.content(3);
    env.advance(H);
    await setDemo(true);
    env.advance(5 * S);
    await env.report(3, 1000, 1);
    expect(env.rec(3).demo).toEqual({ heldMs: 5 * S, epoch: 1 });
    expect(env.rec(3).normal.heldMs).toBe(0);
  });
});

describe('popup-state', () => {
  it('lists open, reported Dead_Tabs, longest away first', async () => {
    await env.awayTab(2, H, 'Two');
    await env.awayTab(3, DAY, 'Three'); // tab 2 now away DAY + H
    env.addTab(4);
    env.session[tabKey(4)] = { url: null, title: '', since: 0, leftAt: 0, normal: { heldMs: 0 }, demo: { heldMs: 0, epoch: 0 } };
    env.session[tabKey(9)] = { url: urlOf(9), title: 'closed', since: 0, leftAt: 0, normal: { heldMs: 0 }, demo: { heldMs: 0, epoch: 0 } };
    const state = await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 3 });
    expect(state).toEqual({
      ok: true, demoMode: false, rulesLoaded: true,
      current: { known: true, stage: 'dead', awaySeconds: 86400 },
      dead: [
        { tabId: 2, title: 'Two', url: urlOf(2), awaySeconds: 90000 },
        { tabId: 3, title: 'Three', url: urlOf(3), awaySeconds: 86400 },
      ],
      buried: [],
    });
  });

  it('reports an unknown tab and the stages between', async () => {
    await env.awayTab(2, 30 * 60 * S);
    expect((await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 2 })).current.stage).toBe('fogged');
    env.advance(4 * H);
    expect((await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 2 })).current.stage).toBe('rotting');
    expect((await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 77 })).current)
      .toEqual({ known: false, stage: null, awaySeconds: 0 });
  });

  it('lists no Dead_Tabs and refuses Bury when rules.json cannot be read, then retries', async () => {
    await env.awayTab(2, 2 * DAY);
    env.fetchState.fail = true;
    const state = await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 2 });
    expect(state).toMatchObject({ ok: true, rulesLoaded: false, current: { stage: null }, dead: [] });
    expect(await env.popup({ type: MESSAGE.BURY, tabIds: [2] })).toEqual({ ok: false, error: 'rules unavailable' });
    expect(env.chromeApi.tabs.remove).not.toHaveBeenCalled();
    env.fetchState.fail = false;
    expect((await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 2 })).dead).toHaveLength(1);
    expect(env.fetchState.calls.every((u) => u === `${BASE}rules.json`)).toBe(true);
  });

  it('rejects content-script senders and bad tab ids', async () => {
    env.addTab(2);
    expect((await env.send({ type: MESSAGE.POPUP_STATE, tabId: 2 }, env.sender(2))).ok).toBe(false);
    expect((await env.send({ type: MESSAGE.POPUP_STATE, tabId: 2 }, { id: EXT_ID, url: 'https://x.test/' })).ok).toBe(false);
    expect((await env.popup({ type: MESSAGE.POPUP_STATE, tabId: '2' })).ok).toBe(false);
  });
});

describe('resurrect-tab', () => {
  it('commits the reset before sending apply-reset to the top frame', async () => {
    await env.awayTab(2, 2 * DAY);
    env.log.length = 0;
    expect(await env.popup({ type: MESSAGE.RESURRECT_TAB, tabId: 2 })).toEqual({ ok: true, delivered: true });
    expect(env.log).toEqual([`session.set:${tabKey(2)}`, 'tabs.sendMessage']);
    expect(env.chromeApi.tabs.sendMessage).toHaveBeenCalledWith(2, { type: MESSAGE.APPLY_RESET }, { frameId: 0 });
    expect(env.rec(2)).toMatchObject({ since: env.now, leftAt: env.now, normal: { heldMs: 0 } });
  });

  it('reports delivered:false when the tab has no receiver', async () => {
    await env.awayTab(2, 2 * DAY);
    env.chromeApi.tabs.sendMessage.mockRejectedValueOnce(new Error('no receiver'));
    expect(await env.popup({ type: MESSAGE.RESURRECT_TAB, tabId: 2 })).toEqual({ ok: true, delivered: false });
    expect(env.rec(2).normal.heldMs).toBe(0);
  });

  it('fails for an unknown or closed tab without writing', async () => {
    expect(await env.popup({ type: MESSAGE.RESURRECT_TAB, tabId: 5 })).toEqual({ ok: false, error: 'unknown tab' });
    await env.awayTab(2, DAY);
    env.open.delete(2);
    const before = env.rec(2);
    expect(await env.popup({ type: MESSAGE.RESURRECT_TAB, tabId: 2 })).toEqual({ ok: false, error: 'tab is not open' });
    expect(env.rec(2)).toEqual(before);
    expect(env.chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });
});

describe('bury', () => {
  const bury = (tabIds) => env.popup({ type: MESSAGE.BURY, tabIds });

  it('re-checks deadness and closes only requested tabs that are dead now', async () => {
    await env.awayTab(2, H, 'Two');
    await env.awayTab(3, H, 'Three');
    await env.awayTab(4, DAY, 'Four'); // away: 2 DAY+2H, 3 DAY+H, 4 DAY
    await env.awayTab(5, 0, 'Fresh');
    // Tab 3 was resurrected after the popup listed it.
    await env.send({ type: MESSAGE.RESURRECT }, env.sender(3));
    const res = await bury([2, 3, 5, 99]);
    expect(res).toEqual({ ok: true, buried: [2], notClosed: [] });
    expect(env.chromeApi.tabs.remove).toHaveBeenCalledTimes(1);
    expect(env.open.has(4)).toBe(true); // dead but not requested
    expect(env.local[BURIED_KEY]).toEqual([
      { id: 'entry-0', title: 'Two', url: urlOf(2), buriedAt: env.now, awaySeconds: 86400 + 7200 },
    ]);
  });

  it('saves every entry before the first tabs.remove', async () => {
    await env.awayTab(2, H);
    await env.awayTab(3, DAY);
    env.log.length = 0;
    expect((await bury([2, 3])).buried).toEqual([2, 3]);
    expect(env.log).toEqual([`local.set:${BURIED_KEY}`, 'tabs.remove:2', 'tabs.remove:3']);
    for (const snap of env.removeSnapshots) expect(snap.buried.map((e) => e.url)).toContain(urlOf(snap.id));
  });

  it('closes nothing when the save fails', async () => {
    await env.awayTab(2, DAY, 'Secret title');
    env.chromeApi.storage.local.failSet = true;
    expect(await bury([2])).toEqual({ ok: false, error: 'could not save buried tabs' });
    expect(env.chromeApi.tabs.remove).not.toHaveBeenCalled();
    expect(env.open.has(2)).toBe(true);
    // Diagnostics never carry titles or URLs.
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('[poltergeist:graveyard]');
    expect(logged).not.toContain('Secret title');
    expect(logged).not.toContain('site2.test');
  });

  it('keeps the entry and reports notClosed when one tabs.remove fails', async () => {
    await env.awayTab(2, H);
    await env.awayTab(3, DAY);
    env.removeFails.add(2);
    expect(await bury([2, 3])).toEqual({ ok: true, buried: [3], notClosed: [2] });
    expect(env.local[BURIED_KEY].map((e) => e.url)).toEqual([urlOf(2), urlOf(3)]);
    expect(env.open.has(2)).toBe(true);
  });

  it('keeps at most 200 entries, newest first', async () => {
    const old = Array.from({ length: MAX_BURIED - 1 }, (_, i) => ({ id: `old-${i}`, title: `Old ${i}`, url: `https://old.test/${i}`, buriedAt: i, awaySeconds: 1 }));
    env.local[BURIED_KEY] = old;
    await env.awayTab(2, H);
    await env.awayTab(3, DAY);
    await bury([2, 3]);
    const list = env.local[BURIED_KEY];
    expect(list).toHaveLength(MAX_BURIED);
    expect(list.slice(0, 2).map((e) => e.url)).toEqual([urlOf(2), urlOf(3)]);
    expect(list[MAX_BURIED - 1].id).toBe('old-197'); // old-198 was dropped
  });

  it('takes at most 200 tabs per call so every closed tab keeps its entry', async () => {
    const ids = Array.from({ length: MAX_BURIED + 5 }, (_, i) => i + 1);
    for (const id of ids) { env.addTab(id); await env.content(id); }
    env.advance(DAY);
    const res = await bury(ids);
    expect(res.buried).toHaveLength(MAX_BURIED);
    expect(env.local[BURIED_KEY]).toHaveLength(MAX_BURIED);
    const saved = new Set(env.local[BURIED_KEY].map((e) => e.url));
    for (const id of res.buried) expect(saved.has(urlOf(id))).toBe(true);
  });

  it('stores titles truncated to 300 and never buries a URL longer than 2048', async () => {
    await env.awayTab(2, 0, 't'.repeat(500));
    env.addTab(3);
    const longUrl = `https://long.test/${'x'.repeat(MAX_URL_LENGTH)}`;
    await env.content(3, 'Long', { url: longUrl });
    env.advance(DAY);
    expect((await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 2 })).dead.map((d) => d.tabId)).toEqual([2]);
    expect(await bury([2, 3])).toEqual({ ok: true, buried: [2], notClosed: [] });
    expect(env.local[BURIED_KEY][0].title).toHaveLength(MAX_TITLE_LENGTH);
    expect(env.open.has(3)).toBe(true);
  });

  it('never buries a stub without a URL or a tab that is not open', async () => {
    env.addTab(1, { active: true });
    env.addTab(2);
    await env.bg.seedTabs(); // stub for 2
    await env.awayTab(3, 0);
    env.advance(DAY);
    env.open.delete(3);
    expect(await bury([2, 3])).toEqual({ ok: true, buried: [], notClosed: [] });
    expect(env.local[BURIED_KEY]).toBeUndefined();
  });

  it('rejects malformed requests and non-extension senders', async () => {
    await env.awayTab(2, DAY);
    for (const tabIds of [undefined, '2', [2, -1], [2.5], Array.from({ length: MAX_BURY_IDS + 1 }, (_, i) => i)]) {
      expect((await bury(tabIds)).ok).toBe(false);
    }
    expect((await env.send({ type: MESSAGE.BURY, tabIds: [2] }, env.sender(2))).ok).toBe(false);
    expect(env.chromeApi.tabs.remove).not.toHaveBeenCalled();
  });
});

describe('reopen', () => {
  const entry = (id, url) => ({ id, title: id, url, buriedAt: 1, awaySeconds: 1 });
  const reopen = (entryId) => env.popup({ type: MESSAGE.REOPEN, entryId });

  it('opens an http(s) entry in a new active tab, then removes the entry', async () => {
    env.local[BURIED_KEY] = [entry('a', 'https://a.test/x'), entry('b', 'http://b.test/')];
    env.log.length = 0;
    expect(await reopen('a')).toEqual({ ok: true, entryRemoved: true });
    expect(env.chromeApi.tabs.create).toHaveBeenCalledWith({ url: 'https://a.test/x', active: true });
    expect(env.log).toEqual(['tabs.create', `local.set:${BURIED_KEY}`]);
    expect(env.local[BURIED_KEY].map((e) => e.id)).toEqual(['b']);
  });

  it('refuses a javascript: URL and keeps the entry', async () => {
    env.local[BURIED_KEY] = [entry('js', 'javascript:alert(1)')];
    expect(await reopen('js')).toEqual({ ok: false, error: 'unsupported url' });
    expect(env.chromeApi.tabs.create).not.toHaveBeenCalled();
    expect(env.local[BURIED_KEY]).toHaveLength(1);
  });

  it('keeps the entry when tabs.create fails', async () => {
    env.local[BURIED_KEY] = [entry('a', 'https://a.test/')];
    env.chromeApi.tabs.failCreate = true;
    expect(await reopen('a')).toEqual({ ok: false, error: 'could not open tab' });
    expect(env.local[BURIED_KEY]).toHaveLength(1);
  });

  it('reports an open tab whose entry could not be removed', async () => {
    env.local[BURIED_KEY] = [entry('a', 'https://a.test/')];
    env.chromeApi.storage.local.failSet = true;
    expect(await reopen('a')).toEqual({ ok: true, entryRemoved: false });
    expect(env.chromeApi.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown and malformed entry ids', async () => {
    expect(await reopen('missing')).toEqual({ ok: false, error: 'unknown entry' });
    expect((await reopen('')).ok).toBe(false);
    expect((await reopen(7)).ok).toBe(false);
    expect(env.chromeApi.tabs.create).not.toHaveBeenCalled();
  });
});

describe('protocol', () => {
  it('rejects unknown and malformed messages without side effects', async () => {
    for (const msg of [null, 'x', [], {}, { type: 5 }, { type: 'graveyard:nope' }, { type: MESSAGE.APPLY_RESET }]) {
      const res = await env.popup(msg);
      expect(res.ok).toBe(false);
      expect(typeof res.error).toBe('string');
    }
    expect(env.log).toEqual([]);
  });

  it('turns a handler failure into {ok:false} without breaking later jobs', async () => {
    env.addTab(2);
    env.chromeApi.storage.session.failSet = true;
    expect(await env.content(2)).toEqual({ ok: false, error: 'internal error' });
    env.chromeApi.storage.session.failSet = false;
    expect((await env.content(2)).ok).toBe(true);
  });
});

describe('worker restart and concurrency', () => {
  it('a restarted worker continues from stored state', async () => {
    env.addTab(1, { active: true });
    await env.bg.seedTabs();
    await env.awayTab(2, 0, 'Two');
    await env.popup({ type: MESSAGE.SET_DEMO, enabled: false });
    env.advance(2 * DAY);
    env.restart();
    await env.activate(2);
    expect(env.rec(2).normal.heldMs).toBe(2 * DAY);
    expect(env.rec(1).leftAt).toBe(env.now);
    const state = await env.popup({ type: MESSAGE.POPUP_STATE, tabId: 2 });
    expect(state.current).toEqual({ known: true, stage: 'dead', awaySeconds: 2 * 86400 });
  });

  it('serializes concurrent updates so none is lost', async () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const id of ids) env.addTab(id);
    await Promise.all(ids.map((id) => env.content(id)));
    expect(ids.every((id) => env.rec(id)?.url === urlOf(id))).toBe(true);
    env.advance(60 * S);
    const held = [17, 3, 42, 8, 29, 1, 35];
    await Promise.all([
      ...held.map((h) => env.report(1, h)),
      env.content(1, 'Concurrent title'),
      env.bg.handleActivated({ tabId: 1, windowId: WIN }),
    ]);
    expect(env.rec(1).normal.heldMs).toBe(60 * S); // the ongoing Absence completed on activation
    await Promise.all(held.map((h) => env.report(2, h)));
    expect(env.rec(2).normal.heldMs).toBe(42 * S);
  });
});

describe('privacy', () => {
  it('stores no page text and only the allowed keys', async () => {
    env.addTab(1, { active: true });
    await env.bg.seedTabs();
    env.addTab(2);
    await env.send({ type: MESSAGE.CONTENT_STATE, title: 'Two', body: 'PAGE BODY TEXT', text: 'PAGE BODY TEXT' }, env.sender(2));
    await env.send({ type: MESSAGE.REPORT, title: 'Two', heldSeconds: 0, epoch: 0, html: 'PAGE BODY TEXT' }, env.sender(2));
    await env.popup({ type: MESSAGE.SET_DEMO, enabled: true });
    env.advance(DAY);
    await env.popup({ type: MESSAGE.BURY, tabIds: [2] });
    const all = JSON.stringify({ s: env.session, l: env.local });
    expect(all).not.toContain('PAGE BODY TEXT');
    expect(all).not.toContain(SECRET);
    for (const key of Object.keys(env.session)) {
      expect(key.startsWith(TAB_KEY_PREFIX) || key.startsWith(WINDOW_KEY_PREFIX) || key === PROFILE_KEY).toBe(true);
    }
    expect(Object.keys(env.local).sort()).toEqual([BURIED_KEY, DEMO_KEY].sort());
  });

  it('closes tabs only from the Bury handler (source scan)', () => {
    const code = stripJsComments(SOURCE);
    const calls = [...code.matchAll(/\.remove\s*\(/g)].map((m) => m.index);
    const start = code.indexOf('async function bury(');
    const end = code.indexOf('async function reopen(');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const tabRemovals = [...code.matchAll(/\btabs\.remove\b/g)].map((m) => m.index);
    expect(tabRemovals).toHaveLength(1);
    expect(tabRemovals[0]).toBeGreaterThan(start);
    expect(tabRemovals[0]).toBeLessThan(end);
    // Every other .remove( call is on session storage.
    for (const i of calls) {
      if (i === tabRemovals[0] + 'tabs'.length) continue;
      expect(code.slice(Math.max(0, i - 'session'.length), i)).toBe('session');
    }
  });

  it('never reads protected Tab properties (source scan)', () => {
    const code = stripJsComments(SOURCE);
    expect(code).not.toMatch(/\btab\??\.(?:url|pendingUrl|title|favIconUrl)\b/);
    expect(code).not.toMatch(/\.(?:pendingUrl|favIconUrl)\b/);
  });
});

// Feature: tab-graveyard-app, Property 2: Registers merge in any order
// **Validates: Requirements 5.2, 5.10, 5.12**
describe('Property 2: Registers merge in any order', () => {
  const SPAN = 1000 * S; // time since the record was created when the ops run

  /** Apply ops to one tab at a fixed clock; returns the final record. */
  async function run(ops) {
    const e = setup();
    e.addTab(1, { active: true });
    await e.bg.seedTabs();
    await e.content(1);
    e.advance(SPAN);
    for (const op of ops) {
      if (op.kind === 'absence') {
        // An Absence that started op.ms ago (injected into storage) completes on activation now.
        e.session[tabKey(1)] = { ...e.rec(1), leftAt: e.now - op.ms };
        await e.bg.handleActivated({ tabId: 1, windowId: WIN });
      } else {
        await e.report(1, op.seconds, op.epoch);
      }
    }
    expect(e.forbiddenReads).toEqual([]);
    return e.rec(1);
  }

  const op = fc.oneof(
    fc.record({ kind: fc.constant('absence'), ms: fc.integer({ min: 0, max: SPAN }) }),
    fc.record({ kind: fc.constant('report'), seconds: fc.integer({ min: 0, max: 2000 }), epoch: fc.constantFrom(0, 0, 0, 1) }),
  );

  it('gives the capped maximum in every delivery order', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(op, { maxLength: 8 }).chain((ops) => fc.tuple(fc.constant(ops), fc.shuffledSubarray(ops, { minLength: ops.length, maxLength: ops.length }))),
      async ([ops, shuffled]) => {
        const a = await run(ops);
        const b = await run(shuffled);
        const absences = ops.filter((o) => o.kind === 'absence').map((o) => o.ms);
        const reports = ops.filter((o) => o.kind === 'report' && o.epoch === 0).map((o) => Math.min(o.seconds * S, SPAN));
        const expected = Math.max(0, ...absences, ...reports);
        expect(a.normal.heldMs).toBe(expected);
        expect(b.normal.heldMs).toBe(expected);
        expect(a.demo).toEqual(b.demo);
        expect(a.demo.heldMs).toBe(Math.max(0, ...absences));
      },
    ), { numRuns: 100 });
  });
});

// Feature: tab-graveyard-app, Property 3: Nothing closes without Bury
// **Validates: Requirements 7.7, 7.8, 7.9, 7.10, 6.13**
describe('Property 3: Nothing closes without Bury', () => {
  const tabId = fc.integer({ min: 1, max: 4 });
  const action = fc.oneof(
    fc.record({ k: fc.constant('advance'), ms: fc.integer({ min: 0, max: 3 * DAY }) }),
    fc.record({ k: fc.constant('activate'), tab: tabId }),
    fc.record({ k: fc.constant('content'), tab: tabId }),
    fc.record({ k: fc.constant('report'), tab: tabId, held: fc.integer({ min: 0, max: 300000 }), epoch: fc.integer({ min: 0, max: 3 }) }),
    fc.record({ k: fc.constant('resurrect'), tab: tabId }),
    fc.record({ k: fc.constant('popupState'), tab: tabId }),
    fc.record({ k: fc.constant('resurrectTab'), tab: tabId }),
    fc.record({ k: fc.constant('demo'), enabled: fc.boolean() }),
    fc.record({ k: fc.constant('reopen'), entry: fc.constantFrom('e0', 'e1', 'e2') }),
    fc.record({ k: fc.constant('removed'), tab: tabId }),
    fc.record({ k: fc.constant('replaced'), tab: tabId }),
    fc.record({ k: fc.constant('seed') }),
    fc.record({ k: fc.constant('contentBury'), tab: tabId }),
    fc.record({ k: fc.constant('unknown') }),
  );

  it('never calls tabs.remove for any sequence without a popup Bury', async () => {
    await fc.assert(fc.asyncProperty(fc.array(action, { maxLength: 25 }), async (actions) => {
      const e = setup();
      e.addTab(1, { active: true });
      for (const id of [2, 3, 4]) e.addTab(id);
      e.local[BURIED_KEY] = ['e0', 'e1', 'e2'].map((id, i) => ({ id, title: id, url: `https://b${i}.test/`, buriedAt: 1, awaySeconds: 1 }));
      await e.bg.seedTabs();
      for (const a of actions) {
        const open = e.open.has(a.tab);
        switch (a.k) {
          case 'advance': e.advance(a.ms); break;
          case 'activate': if (open) await e.activate(a.tab); break;
          case 'content': await e.content(a.tab); break;
          case 'report': await e.report(a.tab, a.held, a.epoch); break;
          case 'resurrect': await e.send({ type: MESSAGE.RESURRECT }, e.sender(a.tab)); break;
          case 'popupState': await e.popup({ type: MESSAGE.POPUP_STATE, tabId: a.tab }); break;
          case 'resurrectTab': await e.popup({ type: MESSAGE.RESURRECT_TAB, tabId: a.tab }); break;
          case 'demo': await e.popup({ type: MESSAGE.SET_DEMO, enabled: a.enabled }); break;
          case 'reopen': await e.popup({ type: MESSAGE.REOPEN, entryId: a.entry }); break;
          case 'removed': e.open.delete(a.tab); await e.bg.handleRemoved(a.tab, { windowId: WIN }); break;
          case 'replaced':
            if (open && !e.open.has(a.tab + 10)) {
              e.open.set(a.tab + 10, { ...e.open.get(a.tab), id: a.tab + 10 });
              e.open.delete(a.tab);
              await e.bg.handleReplaced(a.tab + 10, a.tab);
            }
            break;
          case 'seed': await e.bg.seedTabs(); break;
          case 'contentBury': await e.send({ type: MESSAGE.BURY, tabIds: [1, 2, 3, 4] }, e.sender(a.tab)); break;
          default: await e.popup({ type: 'graveyard:close-all', tabIds: [1, 2, 3, 4] });
        }
      }
      expect(e.chromeApi.tabs.remove).not.toHaveBeenCalled();
      expect(e.forbiddenReads).toEqual([]);
    }), { numRuns: 100 });
  });

  it('a Bury closes only requested Dead_Tabs, each saved before it is closed', async () => {
    const tabs = fc.array(
      fc.record({ awaySec: fc.oneof(fc.integer({ min: 0, max: 200000 }), fc.integer({ min: 86390, max: 86410 })), requested: fc.boolean(), open: fc.boolean() }),
      { minLength: 1, maxLength: 8 },
    );
    await fc.assert(fc.asyncProperty(tabs, async (specs) => {
      const e = setup();
      const T = T0 + 300000 * S;
      // Create each record so that at time T it has been away exactly awaySec.
      const order = specs.map((s, i) => ({ ...s, id: i + 1 })).sort((a, b) => b.awaySec - a.awaySec);
      for (const s of order) {
        e.advance(T - s.awaySec * S - e.now);
        e.addTab(s.id);
        await e.content(s.id);
      }
      e.advance(T - e.now);
      for (const s of order) if (!s.open) e.open.delete(s.id);
      const requested = order.filter((s) => s.requested).map((s) => s.id);
      const res = await e.popup({ type: MESSAGE.BURY, tabIds: requested });
      const expected = order.filter((s) => s.requested && s.open && s.awaySec >= 86400).map((s) => s.id).sort((a, b) => a - b);
      expect(res.ok).toBe(true);
      expect([...res.buried].sort((a, b) => a - b)).toEqual(expected);
      expect(e.removeSnapshots.map((r) => r.id).sort((a, b) => a - b)).toEqual(expected);
      for (const snap of e.removeSnapshots) expect(snap.buried.map((x) => x.url)).toContain(urlOf(snap.id));
      expect(e.forbiddenReads).toEqual([]);
    }), { numRuns: 100 });
  });
});
