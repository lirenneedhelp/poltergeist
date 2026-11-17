import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MESSAGE, PAUSE_KEY_PREFIX, DEMO_KEY, pauseKey, createBackground, registerBackground,
} from '../background.js';

const EXT_ID = 'ext-id';
const BASE = `chrome-extension://${EXT_ID}/`;
const popupSender = { id: EXT_ID, url: `${BASE}popup.html` };
const contentSender = (tabId) => ({ id: EXT_ID, tab: { id: tabId }, url: 'https://x.com/home' });

function makeArea(log, name) {
  const data = {};
  return {
    data,
    failSet: false,
    failRemove: false,
    async get(key) { return key in data ? { [key]: data[key] } : {}; },
    async set(obj) {
      if (this.failSet) throw new Error('quota');
      log.push(`${name}.set`);
      Object.assign(data, obj);
    },
    async remove(key) {
      if (this.failRemove) throw new Error('nope');
      log.push(`${name}.remove`);
      delete data[key];
    },
  };
}

function makeChrome() {
  const log = [];
  const listeners = { message: [], removed: [] };
  const chromeApi = {
    log,
    listeners,
    storage: { session: makeArea(log, 'session'), local: makeArea(log, 'local') },
    tabs: {
      sendMessage: vi.fn(async (tabId, msg) => { log.push('sendMessage'); return { ok: true }; }),
      onRemoved: { addListener: (fn) => listeners.removed.push(fn) },
    },
    runtime: {
      id: EXT_ID,
      getURL: (p = '') => `${BASE}${p}`,
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
  };
  return chromeApi;
}

let chromeApi;
let bg;
beforeEach(() => {
  chromeApi = makeChrome();
  bg = createBackground(chromeApi);
});

const setPaused = (tabId, paused, sender = popupSender) =>
  bg.handleMessage({ type: MESSAGE.SET_PAUSED, tabId, paused }, sender);

describe('storage keys and sender-derived ids', () => {
  it('uses the exact namespaced keys', () => {
    expect(PAUSE_KEY_PREFIX).toBe('doomscroll.pausedTab.');
    expect(DEMO_KEY).toBe('doomscroll.demoMode');
    expect(pauseKey(7)).toBe('doomscroll.pausedTab.7');
  });

  it('derives the tab id from sender.tab.id and ignores payload ids', async () => {
    await setPaused(5, true);
    const res = await bg.handleMessage({ type: MESSAGE.CONTENT_STATE, tabId: 99 }, contentSender(5));
    expect(res).toEqual({ ok: true, paused: true, demoMode: false });
    const other = await bg.handleMessage({ type: MESSAGE.CONTENT_STATE, tabId: 5 }, contentSender(6));
    expect(other.paused).toBe(false);
  });

  it('rejects content-state without a tab sender or from another extension', async () => {
    const m = { type: MESSAGE.CONTENT_STATE };
    expect((await bg.handleMessage(m, popupSender)).ok).toBe(false);
    expect((await bg.handleMessage(m, { id: 'other', tab: { id: 1 } })).ok).toBe(false);
    expect((await bg.handleMessage(m, { id: EXT_ID, tab: { id: -1 } })).ok).toBe(false);
  });

  it('rejects set-paused from a content-script sender', async () => {
    const res = await setPaused(1, true, contentSender(1));
    expect(res.ok).toBe(false);
    expect(chromeApi.storage.session.data).toEqual({});
  });
});

describe('pause storage', () => {
  it('stores one independent key per tab and removes it on unpause', async () => {
    await setPaused(1, true);
    await setPaused(2, true);
    expect(chromeApi.storage.session.data).toEqual({
      'doomscroll.pausedTab.1': true,
      'doomscroll.pausedTab.2': true,
    });
    await setPaused(1, false);
    expect(chromeApi.storage.session.data).toEqual({ 'doomscroll.pausedTab.2': true });
  });

  it('treats malformed stored values as unpaused', async () => {
    for (const bad of ['true', 1, null, { a: 1 }, false]) {
      chromeApi.storage.session.data[pauseKey(3)] = bad;
      expect(await bg.readPaused(3)).toBe(false);
    }
  });

  it('commits before notifying the tab', async () => {
    await setPaused(4, true);
    expect(chromeApi.log).toEqual(['session.set', 'sendMessage']);
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      4, { type: MESSAGE.APPLY_PAUSED, paused: true }, { frameId: 0 },
    );
  });

  it('keeps simultaneous per-tab changes isolated', async () => {
    const results = await Promise.all([setPaused(10, true), setPaused(11, true), setPaused(12, true)]);
    expect(results.every((r) => r.ok && r.delivered)).toBe(true);
    await Promise.all([setPaused(10, false), setPaused(12, false)]);
    expect(chromeApi.storage.session.data).toEqual({ [pauseKey(11)]: true });
  });

  it('removes only the closed tab key on tabs.onRemoved', async () => {
    registerBackground(chromeApi);
    await setPaused(1, true);
    await setPaused(2, true);
    chromeApi.listeners.removed[0](1);
    await vi.waitFor(() => expect(chromeApi.storage.session.data).toEqual({ [pauseKey(2)]: true }));
  });

  it('reads persisted state through a fresh worker instance (restart)', async () => {
    await setPaused(8, true);
    await bg.handleMessage({ type: MESSAGE.SET_DEMO, enabled: true }, popupSender);
    const restarted = createBackground(chromeApi);
    expect(await restarted.handleMessage({ type: MESSAGE.CONTENT_STATE }, contentSender(8)))
      .toEqual({ ok: true, paused: true, demoMode: true });
  });

  it('returns a failed commit without notifying any tab', async () => {
    chromeApi.storage.session.failSet = true;
    const res = await setPaused(1, true);
    expect(res.ok).toBe(false);
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('reports committed-but-undelivered distinctly from failure', async () => {
    chromeApi.tabs.sendMessage.mockRejectedValue(new Error('no receiver'));
    const res = await setPaused(1, true);
    expect(res).toEqual({ ok: true, paused: true, delivered: false });
    expect(chromeApi.storage.session.data[pauseKey(1)]).toBe(true);
    chromeApi.tabs.sendMessage.mockResolvedValue(undefined);
    expect((await setPaused(1, false)).delivered).toBe(false);
  });

  it('validates tab id and paused payloads without touching storage', async () => {
    for (const tabId of [-1, 1.5, '1', undefined]) expect((await setPaused(tabId, true)).ok).toBe(false);
    expect((await setPaused(1, 'yes')).ok).toBe(false);
    expect(chromeApi.storage.session.data).toEqual({});
  });
});

describe('demo mode', () => {
  it('defaults to false when absent or malformed', async () => {
    expect(await bg.readDemo()).toBe(false);
    for (const bad of ['true', 1, null, {}]) {
      chromeApi.storage.local.data[DEMO_KEY] = bad;
      expect(await bg.readDemo()).toBe(false);
    }
  });

  it('writes the Boolean to storage.local and reads it back', async () => {
    const res = await bg.handleMessage({ type: MESSAGE.SET_DEMO, enabled: true }, popupSender);
    expect(res).toEqual({ ok: true, demoMode: true });
    expect(chromeApi.storage.local.data).toEqual({ [DEMO_KEY]: true });
    await bg.handleMessage({ type: MESSAGE.SET_DEMO, enabled: false }, popupSender);
    expect(await bg.readDemo()).toBe(false);
  });

  it('rejects non-Boolean values and failed commits', async () => {
    expect((await bg.handleMessage({ type: MESSAGE.SET_DEMO, enabled: 'on' }, popupSender)).ok).toBe(false);
    expect(chromeApi.storage.local.data).toEqual({});
    chromeApi.storage.local.failSet = true;
    expect((await bg.handleMessage({ type: MESSAGE.SET_DEMO, enabled: true }, popupSender)).ok).toBe(false);
  });
});

describe('popup-state', () => {
  it('reports supported when the content script answers the ping', async () => {
    await setPaused(3, true);
    chromeApi.tabs.sendMessage.mockClear();
    const res = await bg.handleMessage({ type: MESSAGE.POPUP_STATE, tabId: 3 }, popupSender);
    expect(res).toEqual({ ok: true, supported: true, paused: true, demoMode: false });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(3, { type: MESSAGE.PING }, { frameId: 0 });
  });

  it('reports unsupported when no receiver exists', async () => {
    chromeApi.tabs.sendMessage.mockRejectedValue(new Error('none'));
    const res = await bg.handleMessage({ type: MESSAGE.POPUP_STATE, tabId: 3 }, popupSender);
    expect(res.supported).toBe(false);
    expect(res.ok).toBe(true);
  });
});

describe('unknown and malformed messages', () => {
  it('rejects them without state changes', async () => {
    for (const m of [null, 'x', [], {}, { type: 5 }, { type: 'doomscroll:nope' },
      { type: MESSAGE.PING }, { type: MESSAGE.APPLY_PAUSED, paused: true }]) {
      const res = await bg.handleMessage(m, popupSender);
      expect(res.ok).toBe(false);
      expect(typeof res.error).toBe('string');
    }
    expect(chromeApi.storage.session.data).toEqual({});
    expect(chromeApi.storage.local.data).toEqual({});
    expect(chromeApi.log).toEqual([]);
  });

  it('onMessage answers asynchronously and keeps the channel open', async () => {
    const sendResponse = vi.fn();
    const keep = bg.onMessage({ type: 'doomscroll:nope' }, popupSender, sendResponse);
    expect(keep).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'unknown message type' }));
  });

  it('turns unexpected storage read errors into a structured error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    chromeApi.storage.local.get = async () => { throw new Error('boom'); };
    const res = await bg.handleMessage({ type: MESSAGE.CONTENT_STATE }, contentSender(1));
    expect(res).toEqual({ ok: false, error: 'internal error' });
    spy.mockRestore();
  });
});

describe('stored values carry no browsing data', () => {
  it('contains only Booleans under the namespaced keys', async () => {
    await setPaused(1, true);
    await bg.handleMessage({ type: MESSAGE.SET_DEMO, enabled: true }, popupSender);
    const all = { ...chromeApi.storage.session.data, ...chromeApi.storage.local.data };
    for (const [k, v] of Object.entries(all)) {
      expect(k).toMatch(/^doomscroll\.(pausedTab\.\d+|demoMode)$/);
      expect(typeof v).toBe('boolean');
    }
    expect(JSON.stringify(all).replace(/doomscroll/g, '')).not.toMatch(/url|http|text|history|meter|timeOnSite|scroll/i);
  });
});
