// Activity_Tracker tests: Chrome APIs are mocked with in-memory storage, an injected
// clock, and Tab objects wrapped in a Proxy that records any read of url, pendingUrl,
// title, or favIconUrl. Every test fails if the worker reads one of those properties.
// Tab groups live in an in-memory map. Group objects handed to the worker (from
// tabGroups.get and as tabGroups.onUpdated arguments) are Proxies that record a read
// of `title` whenever the group's id is not the recorded Graveyard_Group id of its
// window at the time of the read; every test also fails on such a read.
// Bury moves tabs into the Graveyard group and closes nothing; only Empty graveyard closes tabs.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { stripJsComments } from '../../scripts/package-checks.mjs';
import {
  MESSAGE, TAB_KEY_PREFIX, WINDOW_KEY_PREFIX, PROFILE_KEY, DEMO_KEY, BURIED_KEY,
  GROUP_KEY_PREFIX, EXEMPT_KEY_PREFIX, ATTEMPT_KEY_PREFIX, AUTO_BURY_KEY,
  MAX_BURIED, MAX_BURY_IDS, MAX_EMPTY_IDS, MAX_TITLE_LENGTH, MAX_URL_LENGTH,
  tabKey, windowKey, groupKey, attemptKey, truncateTitle, createBackground, registerBackground,
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
  const titleReads = []; // group ids whose title was read while not the recorded Graveyard_Group
  const open = new Map(); // id -> { id, windowId, active, incognito, pinned, audible, groupId }
  const groups = new Map(); // id -> { id, windowId, title, color, collapsed }
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => { (listeners[name] ??= []).push(fn); } });
  let clock = T0;
  let nextTabId = 1000;
  let nextGroupId = 500;
  let nextEntry = 0;
  const removeFails = new Set();
  const removeSnapshots = [];
  // Failure switches: boolean, or a predicate on the call's arguments.
  const fail = { group: false, ungroup: false, get: false, update: false, badge: false };
  const failing = (name, ...args) => (typeof fail[name] === 'function' ? fail[name](...args) : fail[name] === true);
  const hooks = { onGroupCreated: null, onUpdate: null };

  const makeTab = (props) => new Proxy(
    { ...props, url: SECRET, pendingUrl: SECRET, title: SECRET, favIconUrl: SECRET },
    {
      get(target, key, receiver) {
        if (FORBIDDEN.includes(key)) forbiddenReads.push(key);
        return Reflect.get(target, key, receiver);
      },
    },
  );

  /** A snapshot of a group whose `title` may be read only while it is the recorded Graveyard_Group of its window. */
  const makeGroup = (props) => new Proxy({ ...props }, {
    get(target, key, receiver) {
      if (key === 'title' && chromeApi.storage.session.data[groupKey(target.windowId)] !== target.id) titleReads.push(target.id);
      return Reflect.get(target, key, receiver);
    },
  });

  /** A changeInfo object that records reads of protected properties; Object.hasOwn reads no values. */
  const makeChangeInfo = (props) => new Proxy({ ...props }, {
    get(target, key, receiver) {
      if (FORBIDDEN.includes(key)) forbiddenReads.push(key);
      return Reflect.get(target, key, receiver);
    },
  });

  /** Chrome deletes a group when its last tab leaves it. */
  const pruneGroups = () => {
    for (const id of [...groups.keys()]) if (![...open.values()].some((t) => t.groupId === id)) groups.delete(id);
  };

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
        pruneGroups();
      }),
      create: vi.fn(async ({ active }) => {
        if (chromeApi.tabs.failCreate) throw new Error('cannot create');
        log.push('tabs.create');
        const id = nextTabId++;
        open.set(id, { id, windowId: WIN, active: active === true, incognito: false, pinned: false, audible: false, groupId: -1 });
        return makeTab(open.get(id));
      }),
      failCreate: false,
      group: vi.fn(async ({ tabIds, groupId, createProperties }) => {
        if (failing('group', { tabIds, groupId, createProperties })) throw new Error('cannot group https://secret-url.test/x');
        let id = groupId;
        if (id === undefined) {
          id = nextGroupId++;
          // Chrome starts a new group untitled, with a colour of its own choosing, expanded.
          groups.set(id, { id, windowId: createProperties?.windowId ?? WIN, title: '', color: 'blue', collapsed: false });
        } else if (!groups.has(id)) {
          throw new Error(`No group with id: ${id}`);
        }
        const target = groups.get(id);
        for (const tabId of tabIds) {
          const tab = open.get(tabId);
          if (!tab) throw new Error(`No tab with id: ${tabId}`);
          tab.groupId = id;
          tab.windowId = target.windowId;
        }
        pruneGroups();
        log.push(`tabs.group:${id}`);
        if (groupId === undefined && hooks.onGroupCreated) hooks.onGroupCreated(id);
        return id;
      }),
      ungroup: vi.fn(async (tabIds) => {
        if (failing('ungroup', tabIds)) throw new Error('cannot ungroup');
        for (const tabId of Array.isArray(tabIds) ? tabIds : [tabIds]) {
          const tab = open.get(tabId);
          if (tab) tab.groupId = -1;
        }
        pruneGroups();
        log.push('tabs.ungroup');
      }),
      sendMessage: vi.fn(async () => { log.push('tabs.sendMessage'); return { ok: true }; }),
      onActivated: event('activated'),
      onReplaced: event('replaced'),
      onRemoved: event('removed'),
      onUpdated: event('updated'),
    },
    tabGroups: {
      get: vi.fn(async (id) => {
        if (failing('get', id)) throw new Error('cannot read group');
        if (!groups.has(id)) throw new Error(`No group with id: ${id}`);
        return makeGroup(groups.get(id));
      }),
      update: vi.fn(async (id, props) => {
        hooks.onUpdate?.(id, props);
        if (failing('update', id, props)) throw new Error('cannot update group');
        if (!groups.has(id)) throw new Error(`No group with id: ${id}`);
        Object.assign(groups.get(id), props);
        log.push(`tabGroups.update:${id}`);
        return makeGroup(groups.get(id));
      }),
      onUpdated: event('groupUpdated'),
      onRemoved: event('groupRemoved'),
    },
    action: {
      setBadgeText: vi.fn(async ({ text }) => {
        if (failing('badge', text)) throw new Error('cannot set badge');
        env.badge = text;
      }),
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
    chromeApi, log, open, groups, listeners, forbiddenReads, titleReads, removeFails, removeSnapshots, fetchState, options,
    fail, hooks, badge: undefined,
    bg: createBackground(chromeApi, options),
    get now() { return clock; },
    advance(ms) { clock += ms; },
    session: chromeApi.storage.session.data,
    local: chromeApi.storage.local.data,
    rec: (id) => chromeApi.storage.session.data[tabKey(id)],
    restart() { env.bg = createBackground(chromeApi, options); return env.bg; },
    addTab(id, { windowId = WIN, active = false, incognito = false, pinned = false, audible = false, groupId = -1 } = {}) {
      open.set(id, { id, windowId, active, incognito, pinned, audible, groupId });
    },
    /** A group made outside the worker (by the user), optionally recorded as the window's Graveyard_Group. */
    addGroup({ windowId = WIN, title = '', color = 'blue', collapsed = false, tabIds = [], recorded = false } = {}) {
      const id = nextGroupId++;
      groups.set(id, { id, windowId, title, color, collapsed });
      for (const tabId of tabIds) Object.assign(open.get(tabId), { groupId: id, windowId });
      if (recorded) chromeApi.storage.session.data[groupKey(windowId)] = id;
      return id;
    },
    /** The current group of an open tab, or -1. */
    groupOf: (tabId) => open.get(tabId)?.groupId ?? -1,
    /** The group object Chrome passes to tabGroups.onUpdated / onRemoved. */
    groupEvent: (id) => makeGroup(groups.get(id) ?? { id, windowId: WIN, title: '', color: 'grey', collapsed: false }),
    changeInfo: makeChangeInfo,
    sender(id, overrides = {}) {
      const props = open.get(id) ?? { id, windowId: WIN, active: false, incognito: false, pinned: false, audible: false, groupId: -1 };
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
  // Requirement 9.3: no test may observe a read of a protected Tab property.
  expect(env.forbiddenReads).toEqual([]);
  // Requirement 9.4: no test may observe a title read of a group that is not a recorded Graveyard_Group.
  expect(env.titleReads).toEqual([]);
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
    for (const name of ['message', 'installed', 'startup', 'activated', 'replaced', 'removed', 'windowRemoved',
      'updated', 'groupUpdated', 'groupRemoved']) {
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
      closable: [],
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
    expect(env.chromeApi.tabs.group).not.toHaveBeenCalled();
    expect(env.chromeApi.tabGroups.update).not.toHaveBeenCalled();
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

const bury = (tabIds) => env.popup({ type: MESSAGE.BURY, tabIds });
const empty = (tabIds) => env.popup({ type: MESSAGE.EMPTY, tabIds });
const popupState = (tabId = 1) => env.popup({ type: MESSAGE.POPUP_STATE, tabId });

/** Tab 1 active in WIN; `ids` reported and inactive in WIN, then away for `away`. */
async function deadTabs(ids, away = DAY) {
  if (!env.open.has(1)) {
    env.addTab(1, { active: true });
    await env.content(1, 'Front');
  }
  for (const id of ids) {
    env.addTab(id);
    await env.content(id);
  }
  env.advance(away);
}

/** Dead tabs `ids` moved into WIN's Graveyard_Group with Bury; returns the group id. */
async function graveyard(ids, away = DAY) {
  await deadTabs(ids, away);
  expect(await bury(ids)).toEqual({ ok: true, moved: ids, notMoved: [] });
  return env.session[groupKey(WIN)];
}

describe('bury moves tabs into the Graveyard group', () => {
  it('creates a grey, collapsed Graveyard group in the tabs\' window and closes nothing', async () => {
    await deadTabs([2, 3]);
    const before = { two: env.rec(2), three: env.rec(3) };
    const tabCount = env.open.size;
    let recordedAtUpdate;
    env.hooks.onUpdate = () => { recordedAtUpdate = env.session[groupKey(WIN)]; };
    expect(await bury([2, 3])).toEqual({ ok: true, moved: [2, 3], notMoved: [] });
    const id = env.session[groupKey(WIN)];
    expect(Number.isInteger(id)).toBe(true);
    // The id is recorded before the group is styled (2.5).
    expect(recordedAtUpdate).toBe(id);
    expect(env.chromeApi.tabs.group).toHaveBeenCalledWith({ tabIds: [2, 3], createProperties: { windowId: WIN } });
    expect(env.groups.get(id)).toEqual({ id, windowId: WIN, title: 'Graveyard', color: 'grey', collapsed: true });
    expect([env.groupOf(1), env.groupOf(2), env.groupOf(3)]).toEqual([-1, id, id]);
    expect(env.open.size).toBe(tabCount);
    expect(env.chromeApi.tabs.remove).not.toHaveBeenCalled();
    expect(env.local[BURIED_KEY]).toBeUndefined();
    expect(env.rec(2)).toEqual(before.two);
    expect(env.rec(3)).toEqual(before.three);
    expect(env.session[attemptKey(2)]).toBe(true);
    expect(env.session[attemptKey(3)]).toBe(true);
  });

  it('reuses the window\'s Graveyard group and restores its style after the user recoloured and expanded it', async () => {
    const id = await graveyard([2]);
    Object.assign(env.groups.get(id), { color: 'red', collapsed: false });
    await env.awayTab(3, DAY);
    expect(await bury([3])).toEqual({ ok: true, moved: [3], notMoved: [] });
    expect(env.chromeApi.tabs.group).toHaveBeenLastCalledWith({ groupId: id, tabIds: [3] });
    expect(env.groupOf(3)).toBe(id);
    expect(env.session[groupKey(WIN)]).toBe(id);
    expect(env.groups.get(id)).toMatchObject({ title: 'Graveyard', color: 'grey', collapsed: true });
    expect(env.groups.size).toBe(1);
  });

  it('moves tabs from two windows into their own window\'s group', async () => {
    env.addTab(1, { active: true });
    env.addTab(4, { windowId: 11, active: true });
    env.addTab(2);
    env.addTab(3, { windowId: 11 });
    await env.content(2);
    await env.content(3);
    env.advance(DAY);
    expect(await bury([2, 3])).toEqual({ ok: true, moved: [2, 3], notMoved: [] });
    const a = env.session[groupKey(WIN)];
    const b = env.session[groupKey(11)];
    expect(a).not.toBe(b);
    expect(env.groups.get(a)).toMatchObject({ windowId: WIN, title: 'Graveyard', color: 'grey', collapsed: true });
    expect(env.groups.get(b)).toMatchObject({ windowId: 11, title: 'Graveyard', color: 'grey', collapsed: true });
    expect(env.open.get(2)).toMatchObject({ windowId: WIN, groupId: a });
    expect(env.open.get(3)).toMatchObject({ windowId: 11, groupId: b });
  });

  it('skips tabs that are not dead, already in the Graveyard group, stubs, closed, or repeated', async () => {
    env.addTab(1, { active: true });
    env.addTab(5);
    await env.bg.seedTabs(); // stub record (url null) for 5
    await deadTabs([4, 2, 6]);
    await bury([4]);
    await env.awayTab(3, 0); // fresh
    env.open.delete(6);
    expect(await bury([2, 2, 3, 4, 5, 6, 99])).toEqual({ ok: true, moved: [2], notMoved: [] });
    expect(env.chromeApi.tabs.group).toHaveBeenCalledTimes(2);
    expect(env.groupOf(3)).toBe(-1);
    expect(env.groupOf(5)).toBe(-1);
  });

  it('never lists or moves a tab whose URL is longer than 2048', async () => {
    env.addTab(1, { active: true });
    await env.awayTab(2, 0);
    env.addTab(3);
    await env.content(3, 'Long', { url: `https://long.test/${'x'.repeat(MAX_URL_LENGTH)}` });
    env.advance(DAY);
    expect((await popupState()).dead.map((d) => d.tabId)).toEqual([2]);
    expect(await bury([2, 3])).toEqual({ ok: true, moved: [2], notMoved: [] });
    expect(env.groupOf(3)).toBe(-1);
  });

  it('lists tabs in notMoved when tabs.group fails, and continues with other windows', async () => {
    env.addTab(1, { active: true });
    env.addTab(4, { windowId: 11, active: true });
    env.addTab(2);
    env.addTab(3, { windowId: 11 });
    await env.content(2);
    await env.content(3);
    env.advance(DAY);
    env.fail.group = ({ createProperties }) => createProperties?.windowId === WIN;
    expect(await bury([2, 3])).toEqual({ ok: true, moved: [3], notMoved: [2] });
    expect(env.groupOf(2)).toBe(-1);
    expect(env.session[groupKey(WIN)]).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // Chrome error messages reach diagnostics with URLs removed (9.6).
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('<url>');
    expect(logged).not.toContain('secret-url');
  });

  it('counts tabs as moved when tabGroups.update fails on a reused Graveyard group', async () => {
    const id = await graveyard([2]);
    await env.awayTab(3, DAY);
    env.fail.update = true;
    expect(await bury([3])).toEqual({ ok: true, moved: [3], notMoved: [] });
    expect(env.groupOf(3)).toBe(id);
    expect(env.session[groupKey(WIN)]).toBe(id);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('forgets a new group whose styling fails and lists its tabs in notMoved', async () => {
    await deadTabs([2, 3]);
    env.fail.update = true;
    expect(await bury([2, 3])).toEqual({ ok: true, moved: [], notMoved: [2, 3] });
    expect(env.session[groupKey(WIN)]).toBeUndefined();
    expect(env.chromeApi.tabGroups.update).toHaveBeenCalledTimes(1);
    expect(env.open.has(2) && env.open.has(3)).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // The unrecorded group is now an ordinary group: its tabs are neither listed nor closable.
    env.fail.update = false;
    expect(await popupState()).toMatchObject({ dead: [], closable: [] });
  });

  it('makes no call on a new group whose id cannot be recorded', async () => {
    await deadTabs([2]);
    env.chromeApi.storage.session.failSet = (obj) => groupKey(WIN) in obj;
    expect(await bury([2])).toEqual({ ok: true, moved: [], notMoved: [2] });
    expect(env.chromeApi.tabGroups.update).not.toHaveBeenCalled();
    expect(env.session[groupKey(WIN)]).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('popup-state lists only Buryable_Tabs as dead and the Graveyard tabs as closable', async () => {
    await deadTabs([3]);
    await deadTabs([2]); // tab 3 is now away longer than tab 2
    await bury([2, 3]);
    await env.awayTab(4, DAY);
    const state = await popupState();
    expect(state.dead.map((d) => d.tabId)).toEqual([4]);
    expect(state.closable).toEqual([3, 2]); // longest away first
  });

  it('popup-state lists nothing to bury or close when tabs.query fails', async () => {
    await graveyard([2]);
    await env.awayTab(3, DAY);
    env.chromeApi.tabs.query.mockRejectedValueOnce(new Error('boom'));
    expect(await popupState()).toMatchObject({ ok: true, dead: [], closable: [] });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed requests and non-extension senders', async () => {
    await deadTabs([2]);
    for (const tabIds of [undefined, '2', [2, -1], [2.5], Array.from({ length: MAX_BURY_IDS + 1 }, (_, i) => i)]) {
      expect((await bury(tabIds)).ok).toBe(false);
    }
    expect((await env.send({ type: MESSAGE.BURY, tabIds: [2] }, env.sender(2))).ok).toBe(false);
    expect((await env.send({ type: MESSAGE.BURY, tabIds: [2] }, { id: 'other', url: `${BASE}popup.html` })).ok).toBe(false);
    expect(env.chromeApi.tabs.group).not.toHaveBeenCalled();
    expect(env.chromeApi.tabs.remove).not.toHaveBeenCalled();
  });
});

describe('user tab groups are left alone (decision 12)', () => {
  it('never lists, moves, closes, or restyles tabs in groups the user made, even one titled Graveyard', async () => {
    await deadTabs([2, 3, 4]);
    const work = env.addGroup({ title: 'Work', color: 'red', tabIds: [2] });
    const fake = env.addGroup({ title: 'Graveyard', color: 'grey', collapsed: true, tabIds: [3] });
    const before = structuredClone([...env.groups.values()]);
    const state = await popupState();
    expect(state.dead.map((d) => d.tabId)).toEqual([4]);
    expect(state.closable).toEqual([]);
    expect(await bury([2, 3])).toEqual({ ok: true, moved: [], notMoved: [] });
    expect(await empty([2, 3])).toEqual({ ok: true, buried: [], notClosed: [] });
    expect(env.chromeApi.tabs.group).not.toHaveBeenCalled();
    // A dead tab in no group gets a new Graveyard group, never the user's group titled Graveyard.
    expect(await bury([4])).toEqual({ ok: true, moved: [4], notMoved: [] });
    const id = env.session[groupKey(WIN)];
    expect(id).not.toBe(fake);
    expect(id).not.toBe(work);
    expect([env.groupOf(2), env.groupOf(3)]).toEqual([work, fake]);
    expect([...env.groups.values()].filter((g) => g.id !== id)).toEqual(before);
    for (const [gid] of env.chromeApi.tabGroups.update.mock.calls) expect(gid).toBe(id);
    expect(env.chromeApi.tabs.remove).not.toHaveBeenCalled();
    expect(env.chromeApi.tabs.ungroup).not.toHaveBeenCalled();
  });
});

describe('Graveyard group identity', () => {
  it('releases a renamed group and never takes it back, even when renamed to Graveyard again', async () => {
    const id = await graveyard([2]);
    const record = env.rec(2);
    env.groups.get(id).title = 'Later';
    await env.bg.handleGroupUpdated(env.groupEvent(id));
    expect(env.session[groupKey(WIN)]).toBeUndefined();
    expect(env.groups.get(id)).toMatchObject({ title: 'Later', color: 'grey', collapsed: true });
    expect(env.groupOf(2)).toBe(id);
    expect(env.rec(2)).toEqual(record);
    env.groups.get(id).title = 'Graveyard';
    await env.bg.handleGroupUpdated(env.groupEvent(id));
    await env.awayTab(3, DAY);
    expect(await bury([3])).toEqual({ ok: true, moved: [3], notMoved: [] });
    const next = env.session[groupKey(WIN)];
    expect(next).not.toBe(id);
    expect(env.groupOf(2)).toBe(id);
    expect((await popupState()).closable).toEqual([3]);
  });

  it('keeps the group on a colour or collapsed change and makes no update in response', async () => {
    const id = await graveyard([2]);
    const updates = env.chromeApi.tabGroups.update.mock.calls.length;
    Object.assign(env.groups.get(id), { color: 'pink', collapsed: false });
    await env.bg.handleGroupUpdated(env.groupEvent(id));
    expect(env.session[groupKey(WIN)]).toBe(id);
    expect(env.chromeApi.tabGroups.update).toHaveBeenCalledTimes(updates);
    expect(env.groups.get(id)).toMatchObject({ color: 'pink', collapsed: false });
  });

  it('does not release a group for the untitled update Chrome reports while creating it', async () => {
    await deadTabs([2]);
    let pending;
    env.hooks.onGroupCreated = (id) => { pending = env.bg.handleGroupUpdated(env.groupEvent(id)); };
    await bury([2]);
    await pending;
    const id = env.session[groupKey(WIN)];
    expect(Number.isInteger(id)).toBe(true);
    expect(env.groupOf(2)).toBe(id);
  });

  it('keeps the record when tabGroups.get fails during the title check', async () => {
    const id = await graveyard([2]);
    env.groups.get(id).title = 'Later';
    env.fail.get = true;
    await env.bg.handleGroupUpdated(env.groupEvent(id));
    expect(env.session[groupKey(WIN)]).toBe(id);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores updates for groups that are not recorded, without reading their title', async () => {
    await deadTabs([2]);
    const mine = env.addGroup({ title: 'Mine', tabIds: [2] });
    await env.bg.handleGroupUpdated(env.groupEvent(mine));
    expect(env.chromeApi.tabGroups.get).not.toHaveBeenCalled();
    expect(env.session[groupKey(WIN)]).toBeUndefined();
  });

  it('deletes records on tabGroups.onRemoved and windows.onRemoved, per window', async () => {
    env.addTab(1, { active: true });
    env.addTab(4, { windowId: 11, active: true });
    env.addTab(2);
    env.addTab(3, { windowId: 11 });
    env.addTab(5, { windowId: 12, active: true });
    env.addTab(6, { windowId: 12 });
    for (const id of [2, 3, 6]) await env.content(id);
    env.advance(DAY);
    await bury([2, 3, 6]);
    const a = env.session[groupKey(WIN)];
    await env.bg.handleGroupRemoved(env.groupEvent(a));
    expect(env.session[groupKey(WIN)]).toBeUndefined();
    expect(env.session[groupKey(11)]).toBeDefined();
    await env.bg.handleWindowRemoved(11);
    expect(env.session[groupKey(11)]).toBeUndefined();
    expect(env.session[groupKey(12)]).toBeDefined();
  });

  it('creates a new group when the recorded one no longer exists or is in another window', async () => {
    await deadTabs([2, 3]);
    env.session[groupKey(WIN)] = 999;
    expect(await bury([2])).toEqual({ ok: true, moved: [2], notMoved: [] });
    const first = env.session[groupKey(WIN)];
    expect(first).not.toBe(999);
    expect(env.groupOf(2)).toBe(first);
    // A recorded id whose group is now in window 11 is not used, and its title is not read.
    env.addTab(7, { windowId: 11, active: true });
    const elsewhere = env.addGroup({ windowId: 11, title: 'Graveyard', color: 'grey', tabIds: [7] });
    env.session[groupKey(WIN)] = elsewhere;
    expect(await bury([3])).toEqual({ ok: true, moved: [3], notMoved: [] });
    const second = env.session[groupKey(WIN)];
    expect(second).not.toBe(elsewhere);
    expect(env.groups.get(second)).toMatchObject({ windowId: WIN, title: 'Graveyard' });
    expect(env.groups.get(elsewhere)).toMatchObject({ windowId: 11, title: 'Graveyard', color: 'grey', collapsed: false });
  });

  it('keeps a tab\'s record when the user drags it out of the group, and does not undo the move', async () => {
    const id = await graveyard([2, 3]);
    const record = env.rec(2);
    const calls = env.chromeApi.tabs.group.mock.calls.length;
    env.open.get(2).groupId = -1;
    env.log.length = 0;
    await env.bg.handleUpdated(2, env.changeInfo({ groupId: -1 }));
    expect(env.rec(2)).toEqual(record);
    expect(env.groupOf(2)).toBe(-1);
    expect(env.groupOf(3)).toBe(id);
    expect(env.chromeApi.tabs.group).toHaveBeenCalledTimes(calls);
    expect(env.chromeApi.tabs.ungroup).not.toHaveBeenCalled();
    // Changes other than pinned, audible, or groupId make no job at all.
    await env.bg.handleUpdated(2, env.changeInfo({ status: 'loading' }));
    expect(env.log).toEqual([]);
  });

  it('saves no Buried_Entry when the user closes a Graveyard tab', async () => {
    await graveyard([2]);
    env.open.delete(2);
    await env.bg.handleRemoved(2, { windowId: WIN });
    expect(env.rec(2)).toBeUndefined();
    expect(env.local[BURIED_KEY]).toBeUndefined();
  });
});

describe('empty graveyard', () => {
  it('saves every entry before the first tabs.remove', async () => {
    await graveyard([2, 3]);
    env.log.length = 0;
    expect(await empty([2, 3])).toEqual({ ok: true, buried: [2, 3], notClosed: [] });
    expect(env.log).toEqual([`local.set:${BURIED_KEY}`, 'tabs.remove:2', 'tabs.remove:3']);
    for (const snap of env.removeSnapshots) expect(snap.buried.map((e) => e.url)).toContain(urlOf(snap.id));
    expect(env.local[BURIED_KEY]).toEqual([
      { id: 'entry-0', title: 'Page 2', url: urlOf(2), buriedAt: env.now, awaySeconds: 86400 },
      { id: 'entry-1', title: 'Page 3', url: urlOf(3), buriedAt: env.now, awaySeconds: 86400 },
    ]);
    expect(env.open.has(1)).toBe(true);
  });

  it('closes only requested ids that are Closable_Tabs now, in request order, dead or not', async () => {
    const id = await graveyard([2, 3, 4, 5, 6, 7]);
    env.open.get(3).pinned = true; //                                        exempt
    env.session[tabKey(4)] = { ...env.rec(4), url: null }; //                no saved URL
    env.open.get(5).groupId = -1; //                                         dragged out
    env.open.delete(7); //                                                   closed
    env.addTab(8, { groupId: id }); //                                       alive, dragged in
    await env.content(8);
    env.addTab(9);
    await env.content(9);
    env.addGroup({ title: 'Mine', tabIds: [9] }); //                         user group
    const before = Object.fromEntries([3, 4, 5, 6, 9].map((t) => [t, env.rec(t)]));
    expect(await empty([8, 2, 3, 4, 5, 7, 9, 2, 99])).toEqual({ ok: true, buried: [8, 2], notClosed: [] });
    expect(env.local[BURIED_KEY].map((e) => e.url)).toEqual([urlOf(8), urlOf(2)]);
    for (const t of [3, 4, 5, 6, 9]) {
      expect(env.open.has(t)).toBe(true);
      expect(env.rec(t)).toEqual(before[t]);
    }
    expect([env.groupOf(3), env.groupOf(4), env.groupOf(5), env.groupOf(6)]).toEqual([id, id, -1, id]);
  });

  it('closes nothing when the save fails', async () => {
    const id = await graveyard([2]);
    env.session[tabKey(2)] = { ...env.rec(2), title: 'Secret title' };
    env.chromeApi.storage.local.failSet = true;
    expect(await empty([2])).toEqual({ ok: false, error: 'could not save buried tabs' });
    expect(env.chromeApi.tabs.remove).not.toHaveBeenCalled();
    expect(env.groupOf(2)).toBe(id);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('[poltergeist:graveyard]');
    expect(logged).not.toContain('Secret title');
    expect(logged).not.toContain('site2.test');
  });

  it('keeps the entry and reports notClosed when one tabs.remove fails', async () => {
    await graveyard([2, 3]);
    env.removeFails.add(2);
    expect(await empty([2, 3])).toEqual({ ok: true, buried: [3], notClosed: [2] });
    expect(env.local[BURIED_KEY].map((e) => e.url)).toEqual([urlOf(2), urlOf(3)]);
    expect(env.open.has(2)).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('closes exactly 200 tabs when 201 Closable_Tabs are requested', async () => {
    const ids = Array.from({ length: MAX_BURIED + 1 }, (_, i) => i + 2);
    await graveyard(ids);
    const res = await empty(ids);
    expect(res.buried).toEqual(ids.slice(0, MAX_BURIED));
    expect(res.notClosed).toEqual([]);
    expect(env.chromeApi.tabs.remove).toHaveBeenCalledTimes(MAX_BURIED);
    expect(env.open.has(ids[MAX_BURIED])).toBe(true);
    expect(env.local[BURIED_KEY]).toHaveLength(MAX_BURIED);
  });

  it('keeps at most 200 entries, newest first, with titles cut to 300', async () => {
    const old = Array.from({ length: MAX_BURIED - 1 }, (_, i) => ({ id: `old-${i}`, title: `Old ${i}`, url: `https://old.test/${i}`, buriedAt: i, awaySeconds: 1 }));
    env.local[BURIED_KEY] = old;
    await graveyard([2, 3]);
    await env.content(2, 't'.repeat(500));
    await empty([2, 3]);
    const list = env.local[BURIED_KEY];
    expect(list).toHaveLength(MAX_BURIED);
    expect(list.slice(0, 2).map((e) => e.url)).toEqual([urlOf(2), urlOf(3)]);
    expect(list[0].title).toHaveLength(MAX_TITLE_LENGTH);
    expect(list[MAX_BURIED - 1].id).toBe('old-197'); // old-198 was dropped
  });

  it('works when rules.json cannot be read, and popup-state still lists the closable tabs', async () => {
    await graveyard([2, 3]);
    env.fetchState.fail = true;
    env.restart(); // a fresh worker has no cached rules
    expect(await popupState()).toMatchObject({ ok: true, rulesLoaded: false, dead: [], closable: [2, 3] });
    expect(await empty([2, 3])).toEqual({ ok: true, buried: [2, 3], notClosed: [] });
  });

  it('closes nothing when tabs.query fails', async () => {
    await graveyard([2]);
    env.chromeApi.tabs.query.mockRejectedValueOnce(new Error('boom'));
    expect(await empty([2])).toEqual({ ok: false, error: 'internal error' });
    expect(env.chromeApi.tabs.remove).not.toHaveBeenCalled();
    expect(env.local[BURIED_KEY]).toBeUndefined();
  });

  it('rejects malformed requests and non-extension senders', async () => {
    await graveyard([2]);
    for (const tabIds of [undefined, '2', [2, -1], [2.5], Array.from({ length: MAX_EMPTY_IDS + 1 }, (_, i) => i)]) {
      expect((await empty(tabIds)).ok).toBe(false);
    }
    expect((await env.send({ type: MESSAGE.EMPTY, tabIds: [2] }, env.sender(2))).ok).toBe(false);
    expect((await env.send({ type: MESSAGE.EMPTY, tabIds: [2] }, { id: 'other', url: `${BASE}popup.html` })).ok).toBe(false);
    expect(await empty([])).toEqual({ ok: true, buried: [], notClosed: [] });
    expect(env.chromeApi.tabs.remove).not.toHaveBeenCalled();
    expect(env.local[BURIED_KEY]).toBeUndefined();
  });
});

describe('resurrect ungroups a Graveyard tab', () => {
  it('ungroups after the saved Reset on the content-script path', async () => {
    await graveyard([2]);
    const updates = env.chromeApi.tabGroups.update.mock.calls.length;
    env.log.length = 0;
    expect(await env.send({ type: MESSAGE.RESURRECT }, env.sender(2))).toEqual({ ok: true });
    expect(env.log).toEqual([`session.set:${tabKey(2)}`, 'session.remove', 'tabs.ungroup']);
    expect(env.chromeApi.tabs.ungroup).toHaveBeenCalledTimes(1);
    expect(env.chromeApi.tabs.ungroup).toHaveBeenCalledWith(2);
    expect(env.open.get(2)).toMatchObject({ windowId: WIN, groupId: -1 });
    expect(env.rec(2).normal.heldMs).toBe(0);
    expect(env.session[attemptKey(2)]).toBeUndefined();
    expect(env.chromeApi.tabGroups.update).toHaveBeenCalledTimes(updates);
    expect(env.local[BURIED_KEY]).toBeUndefined();
  });

  it('ungroups before apply-reset on the popup path and moves no other tab', async () => {
    const id = await graveyard([2, 3]);
    env.log.length = 0;
    expect(await env.popup({ type: MESSAGE.RESURRECT_TAB, tabId: 2 })).toEqual({ ok: true, delivered: true });
    expect(env.log).toEqual([`session.set:${tabKey(2)}`, 'session.remove', 'tabs.ungroup', 'tabs.sendMessage']);
    expect(env.groupOf(2)).toBe(-1);
    expect(env.groupOf(3)).toBe(id);
  });

  it('leaves tabs in no group or in a user group where they are', async () => {
    await deadTabs([2, 3]);
    const mine = env.addGroup({ title: 'Graveyard', tabIds: [3] });
    expect(await env.popup({ type: MESSAGE.RESURRECT_TAB, tabId: 2 })).toEqual({ ok: true, delivered: true });
    expect(await env.send({ type: MESSAGE.RESURRECT }, env.sender(3))).toEqual({ ok: true });
    expect(env.chromeApi.tabs.ungroup).not.toHaveBeenCalled();
    expect(env.groupOf(3)).toBe(mine);
  });

  it('finishes the Resurrect when tabs.ungroup fails', async () => {
    const id = await graveyard([2]);
    env.fail.ungroup = true;
    expect(await env.popup({ type: MESSAGE.RESURRECT_TAB, tabId: 2 })).toEqual({ ok: true, delivered: true });
    expect(env.chromeApi.tabs.ungroup).toHaveBeenCalledTimes(1);
    expect(env.rec(2).normal.heldMs).toBe(0);
    expect(env.groupOf(2)).toBe(id);
    expect(env.session[groupKey(WIN)]).toBe(id);
    expect(errorSpy).toHaveBeenCalledTimes(1);
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
    for (const msg of [null, 'x', [], {}, { type: 5 }, { type: 'graveyard:nope' }, { type: MESSAGE.APPLY_RESET }, { type: MESSAGE.REFRESH }]) {
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
    env.addTab(3);
    await env.content(3, 'Three');
    await env.popup({ type: MESSAGE.SET_DEMO, enabled: true });
    env.advance(DAY);
    expect((await env.popup({ type: MESSAGE.BURY, tabIds: [2, 3] })).moved).toEqual([2, 3]);
    expect((await env.popup({ type: MESSAGE.EMPTY, tabIds: [2] })).buried).toEqual([2]);
    const all = JSON.stringify({ s: env.session, l: env.local });
    expect(all).not.toContain('PAGE BODY TEXT');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('Graveyard'); // no group title is stored (9.4)
    const allowed = [TAB_KEY_PREFIX, WINDOW_KEY_PREFIX, GROUP_KEY_PREFIX, EXEMPT_KEY_PREFIX, ATTEMPT_KEY_PREFIX];
    for (const key of Object.keys(env.session)) {
      expect(allowed.some((p) => key.startsWith(p)) || key === PROFILE_KEY).toBe(true);
    }
    expect(env.session[groupKey(WIN)]).toBeDefined();
    for (const key of Object.keys(env.local)) expect([BURIED_KEY, DEMO_KEY, AUTO_BURY_KEY]).toContain(key);
    expect(env.local[BURIED_KEY].map((e) => e.url)).toEqual([urlOf(2)]);
  });

  it('never writes a tab group title to storage or to a diagnostic', async () => {
    env.addTab(1, { active: true });
    for (const id of [2, 3, 4]) { env.addTab(id); await env.content(id); }
    env.advance(DAY);
    await env.popup({ type: MESSAGE.BURY, tabIds: [2] });
    const id = env.session[groupKey(WIN)];
    const mine = env.addGroup({ title: 'SECRET GROUP TITLE', tabIds: [4] });
    await env.bg.handleGroupUpdated(env.groupEvent(mine));
    env.groups.get(id).title = 'SECRET GROUP TITLE';
    env.fail.get = true;
    await env.bg.handleGroupUpdated(env.groupEvent(id)); // failed title check: diagnostic, record kept
    env.fail.get = false;
    await env.bg.handleGroupUpdated(env.groupEvent(id)); // Release
    env.fail.group = true;
    await env.popup({ type: MESSAGE.BURY, tabIds: [3] }); // failed tabs.group: diagnostic
    await env.bg.handleGroupRemoved(env.groupEvent(id));
    expect(errorSpy).toHaveBeenCalledTimes(2);
    const everything = JSON.stringify({ s: env.session, l: env.local, logs: errorSpy.mock.calls });
    expect(everything).not.toContain('SECRET GROUP TITLE');
    expect(everything).not.toContain('Graveyard');
  });

  it('closes tabs only from the Empty graveyard handler (source scan)', () => {
    const code = stripJsComments(SOURCE);
    const calls = [...code.matchAll(/\.remove\s*\(/g)].map((m) => m.index);
    const start = code.indexOf('async function emptyGraveyard(');
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

  it('ungroups tabs only from the Resurrect helper (source scan)', () => {
    const code = stripJsComments(SOURCE);
    const calls = [...code.matchAll(/\btabs\.ungroup\s*\(/g)].map((m) => m.index);
    const start = code.indexOf('async function ungroupIfGraveyard(');
    expect(calls).toHaveLength(1);
    expect(start).toBeGreaterThan(0);
    expect(calls[0]).toBeGreaterThan(start);
    expect(calls[0]).toBeLessThan(code.indexOf('async function ensureRecord('));
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

// Feature: tab-graveyard-app, Property 3: Nothing closes without Empty graveyard
// (renamed by graveyard-groups: graveyard:empty from an extension page is the one message that closes tabs)
// **Validates: Requirements 7.7, 7.8, 7.9, 7.10, 6.13; graveyard-groups Requirements 4.4, 4.5, 4.9, 11.1**
describe('Property 3: Nothing closes without Empty graveyard', () => {
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
    fc.record({ k: fc.constant('popupBury') }),
    fc.record({ k: fc.constant('contentEmpty'), tab: tabId }),
    fc.record({ k: fc.constant('autoBury'), enabled: fc.boolean() }),
    fc.record({ k: fc.constant('unknown') }),
  );

  it('never calls tabs.remove for any sequence without a popup Empty graveyard', async () => {
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
          case 'popupBury': await e.popup({ type: MESSAGE.BURY, tabIds: [1, 2, 3, 4] }); break;
          case 'contentEmpty': await e.send({ type: MESSAGE.EMPTY, tabIds: [1, 2, 3, 4] }, e.sender(a.tab)); break;
          case 'autoBury': await e.popup({ type: MESSAGE.SET_AUTO_BURY, enabled: a.enabled }); break;
          default: await e.popup({ type: 'graveyard:close-all', tabIds: [1, 2, 3, 4] });
        }
      }
      expect(e.chromeApi.tabs.remove).not.toHaveBeenCalled();
      expect(e.forbiddenReads).toEqual([]);
      expect(e.titleReads).toEqual([]);
    }), { numRuns: 100 });
  });

  it('an Empty graveyard closes exactly the requested Closable_Tabs, each saved before it is closed', async () => {
    const tabs = fc.array(
      fc.record({
        awaySec: fc.oneof(fc.integer({ min: 0, max: 200000 }), fc.integer({ min: 86390, max: 86410 })),
        requested: fc.boolean(), open: fc.boolean(), graveyard: fc.boolean(), exempt: fc.boolean(),
      }),
      { minLength: 1, maxLength: 8 },
    );
    await fc.assert(fc.asyncProperty(tabs, async (specs) => {
      const e = setup();
      const T = T0 + 300000 * S;
      // Create each record so that at time T it has been away exactly awaySec (deadness must not matter).
      const order = specs.map((s, i) => ({ ...s, id: i + 1 })).sort((a, b) => b.awaySec - a.awaySec);
      for (const s of order) {
        e.advance(T - s.awaySec * S - e.now);
        e.addTab(s.id);
        await e.content(s.id);
      }
      e.advance(T - e.now);
      // The window's recorded Graveyard_Group holds the graveyard tabs; exempt tabs are pinned.
      e.addGroup({ title: 'Graveyard', color: 'grey', collapsed: true, recorded: true, tabIds: order.filter((s) => s.graveyard).map((s) => s.id) });
      for (const s of order) if (s.exempt) e.open.get(s.id).pinned = true;
      for (const s of order) if (!s.open) e.open.delete(s.id);
      const requested = order.filter((s) => s.requested).map((s) => s.id);
      const res = await e.popup({ type: MESSAGE.EMPTY, tabIds: requested });
      const expected = order.filter((s) => s.requested && s.open && s.graveyard && !s.exempt).map((s) => s.id).sort((a, b) => a - b);
      expect(res.ok).toBe(true);
      expect([...res.buried].sort((a, b) => a - b)).toEqual(expected);
      expect(res.notClosed).toEqual([]);
      expect(e.removeSnapshots.map((r) => r.id).sort((a, b) => a - b)).toEqual(expected);
      for (const snap of e.removeSnapshots) expect(snap.buried.map((x) => x.url)).toContain(urlOf(snap.id));
      expect(e.forbiddenReads).toEqual([]);
      expect(e.titleReads).toEqual([]);
    }), { numRuns: 100 });
  });
});
