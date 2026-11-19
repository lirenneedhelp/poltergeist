// Tab Graveyard service worker (Manifest V3 module worker): the Activity_Tracker.
// It is the source of truth for when each tab was left and for its Registers.
// Open-tab records live only in chrome.storage.session; chrome.storage.local holds
// only the demo flag and the buried list. The worker never reads url, pendingUrl,
// title, or favIconUrl from a Tab object: the URL comes from MessageSender.url and
// the title from the content script's payload. It does not import the skeleton.

export const MESSAGE = Object.freeze({
  CONTENT_STATE: 'graveyard:content-state', // content -> worker
  REPORT: 'graveyard:report', //               content -> worker
  RESURRECT: 'graveyard:resurrect', //         content -> worker
  POPUP_STATE: 'graveyard:popup-state', //     popup -> worker
  RESURRECT_TAB: 'graveyard:resurrect-tab', // popup -> worker
  BURY: 'graveyard:bury', //                   popup -> worker
  REOPEN: 'graveyard:reopen', //               popup -> worker
  SET_DEMO: 'graveyard:set-demo', //           popup -> worker
  APPLY_RESET: 'graveyard:apply-reset', //     worker -> content
});

export const TAB_KEY_PREFIX = 'graveyard.tab.'; //       session: Tab_Record
export const WINDOW_KEY_PREFIX = 'graveyard.window.'; // session: active tab id of a window
export const PROFILE_KEY = 'graveyard.profile'; //       session: { epoch, startedAt }
export const DEMO_KEY = 'graveyard.demoMode'; //         local: Boolean

/** One hour of normal timing per second of demo timing. */
export const DEMO_TIME_SCALE = 3600;
export const MAX_TITLE_LENGTH = 300;

/** Rule ids in rules.json whose trigger thresholds mark the start of each Stage. */
export const RULE_IDS = Object.freeze({ fog: 'graveyard-fog', rot: 'graveyard-rot', dead: 'graveyard-tombstone' });

/** Profile used when none is stored: epoch 0, and demo absences count from their own start. */
export const DEFAULT_PROFILE = Object.freeze({ epoch: 0, startedAt: 0 });

const LOG_PREFIX = '[poltergeist:graveyard]';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const nonNegative = (v) => (isFiniteNumber(v) && v > 0 ? v : 0);
const fail = (error) => ({ ok: false, error });

/** Diagnostics carry only a fixed description and an error message, never titles, URLs, or records. */
function logFailure(kind, err) {
  const detail = typeof err?.message === 'string' ? err.message : 'unknown error';
  console.error(LOG_PREFIX, `${kind} failed:`, detail);
}

export const tabKey = (tabId) => `${TAB_KEY_PREFIX}${tabId}`;
export const windowKey = (windowId) => `${WINDOW_KEY_PREFIX}${windowId}`;

/** Tab ids are non-negative integers; chrome.tabs.TAB_ID_NONE (-1) is not a tab. */
export function isTabId(value) {
  return Number.isInteger(value) && value >= 0;
}

/** Window ids are non-negative integers; chrome.windows.WINDOW_ID_NONE (-1) is not a window. */
export function isWindowId(value) {
  return Number.isInteger(value) && value >= 0;
}

/** True only for a parseable http: or https: URL string. */
export function isWebUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Non-strings become ''; long titles are cut to 300 code units without splitting a surrogate pair. */
export function truncateTitle(value) {
  const s = typeof value === 'string' ? value : '';
  if (s.length <= MAX_TITLE_LENGTH) return s;
  const cut = s.slice(0, MAX_TITLE_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** 'demo' when Demo_Mode is on, otherwise 'normal'. */
export const modeOf = (demoMode) => (demoMode === true ? 'demo' : 'normal');

/**
 * A new Tab_Record created or reset at time t. `away` starts an Absence at t.
 * The demo Register is stamped with the current Profile_Epoch.
 */
export function createRecord({ t, away = false, profile = DEFAULT_PROFILE, url = null, title = '' }) {
  return {
    url: isWebUrl(url) ? url : null,
    title: truncateTitle(title),
    since: t,
    leftAt: away ? t : null,
    normal: { heldMs: 0 },
    demo: { heldMs: 0, epoch: profile.epoch },
  };
}

/** Coerce a stored value into a Tab_Record, or null when it is not one. */
export function normalizeRecord(raw) {
  if (!isObject(raw) || !isFiniteNumber(raw.since)) return null;
  const demoEpoch = raw.demo?.epoch;
  return {
    url: isWebUrl(raw.url) ? raw.url : null,
    title: truncateTitle(raw.title),
    since: raw.since,
    leftAt: isFiniteNumber(raw.leftAt) ? raw.leftAt : null,
    normal: { heldMs: nonNegative(raw.normal?.heldMs) },
    // An unreadable epoch never matches, so that Register counts as 0.
    demo: { heldMs: nonNegative(raw.demo?.heldMs), epoch: Number.isInteger(demoEpoch) ? demoEpoch : -1 },
  };
}

/** Coerce a stored profile; anything malformed reads as DEFAULT_PROFILE. */
export function normalizeProfile(raw) {
  if (!isObject(raw) || !Number.isInteger(raw.epoch) || raw.epoch < 0) return DEFAULT_PROFILE;
  if (!isFiniteNumber(raw.startedAt) || raw.startedAt < 0) return DEFAULT_PROFILE;
  return { epoch: raw.epoch, startedAt: raw.startedAt };
}

/** Held_Absence of the Register for `mode`, in ms. A demo Register from another epoch counts as 0. */
export function heldAwayMs(record, mode, profile) {
  if (mode === 'demo') return record.demo.epoch === profile.epoch ? record.demo.heldMs : 0;
  return record.normal.heldMs;
}

/** Elapsed part of the current Absence at t, in ms. Demo absences start no earlier than the epoch. */
export function currentAwayMs(record, mode, profile, t) {
  if (record.leftAt === null) return 0;
  const start = mode === 'demo' ? Math.max(record.leftAt, profile.startedAt) : record.leftAt;
  return Math.max(0, t - start);
}

/** Away_Time at t for `mode`, in ms: the larger of the Held_Absence and the current Absence. */
export function awayMs(record, mode, profile, t) {
  return Math.max(heldAwayMs(record, mode, profile), currentAwayMs(record, mode, profile, t));
}

/**
 * End the current Absence at t, raising both Registers to it. Returns a new record
 * (or the same record when no Absence is in progress). The demo Register is
 * re-stamped with the current epoch.
 */
export function completeAbsence(record, profile, t) {
  if (record.leftAt === null) return record;
  return {
    ...record,
    leftAt: null,
    normal: { heldMs: Math.max(heldAwayMs(record, 'normal', profile), currentAwayMs(record, 'normal', profile, t)) },
    demo: {
      heldMs: Math.max(heldAwayMs(record, 'demo', profile), currentAwayMs(record, 'demo', profile, t)),
      epoch: profile.epoch,
    },
  };
}

/**
 * Resurrect: both Registers to 0 and `since` to t. An active tab has no Absence;
 * an inactive one restarts its Absence at t.
 */
export function resetRecord(record, profile, t, active) {
  return {
    ...record,
    since: t,
    leftAt: active ? null : t,
    normal: { heldMs: 0 },
    demo: { heldMs: 0, epoch: profile.epoch },
  };
}

/**
 * Raise the Register for `mode` to a page-reported Held_Absence, capped at the time
 * since the record was created or reset (for demo, also since the epoch started).
 * Callers must already have checked that the report's epoch is the current one.
 */
export function raiseHeld(record, mode, profile, reportedMs, t) {
  const start = mode === 'demo' ? Math.max(record.since, profile.startedAt) : record.since;
  const value = Math.min(nonNegative(reportedMs), Math.max(0, t - start));
  if (mode === 'demo') {
    return { ...record, demo: { heldMs: Math.max(heldAwayMs(record, 'demo', profile), value), epoch: profile.epoch } };
  }
  return { ...record, normal: { heldMs: Math.max(record.normal.heldMs, value) } };
}

/**
 * Stage for an Away_Time in seconds. Returns null when the thresholds are unavailable
 * or the input is not finite, so a missing rules.json never yields a Dead_Tab.
 * Thresholds are inclusive, as in the engine (`value >= threshold`).
 */
export function stage(seconds, thresholds) {
  if (!isFiniteNumber(seconds) || !isObject(thresholds)) return null;
  const { fog, rot, dead } = thresholds;
  if (![fog, rot, dead].every(isFiniteNumber)) return null;
  if (seconds >= dead) return 'dead';
  if (seconds >= rot) return 'rotting';
  if (seconds >= fog) return 'fogged';
  return 'alive';
}

/** Read the Normal_Profile stage thresholds (seconds) from a parsed rules.json. Throws when unusable. */
export function parseThresholds(doc) {
  const rules = isObject(doc) && Array.isArray(doc.rules) ? doc.rules : [];
  const pick = (id) => {
    const rule = rules.find((r) => isObject(r) && r.id === id);
    const value = isObject(rule?.trigger) ? rule.trigger.threshold : undefined;
    if (!isFiniteNumber(value) || value <= 0) throw new Error(`rules.json has no usable threshold for ${id}`);
    return value;
  };
  const out = { fog: pick(RULE_IDS.fog), rot: pick(RULE_IDS.rot), dead: pick(RULE_IDS.dead) };
  if (!(out.fog <= out.rot && out.rot <= out.dead)) throw new Error('rules.json thresholds are out of order');
  return Object.freeze(out);
}

/** Thresholds for the active profile: divided by DEMO_TIME_SCALE in Demo_Mode. */
export function scaleThresholds(base, demoMode) {
  if (demoMode !== true) return base;
  return Object.freeze({
    fog: base.fog / DEMO_TIME_SCALE,
    rot: base.rot / DEMO_TIME_SCALE,
    dead: base.dead / DEMO_TIME_SCALE,
  });
}

/**
 * Build the tracker around an injected Chrome API object so it can be tested with
 * mocks. Nothing is registered here; see registerBackground.
 *   now:   clock in epoch ms (default Date.now)
 *   fetch: fetch used for the packaged rules.json (default globalThis.fetch)
 */
export function createBackground(chromeApi, { now = () => Date.now(), fetch: fetchFn = (url) => globalThis.fetch(url) } = {}) {
  const session = chromeApi.storage.session;
  const local = chromeApi.storage.local;
  const tabs = chromeApi.tabs;
  const runtime = chromeApi.runtime;

  // Every read-modify-write of storage runs through this one chain. A failed job
  // rejects its own Promise but never breaks the chain for later jobs.
  let queue = Promise.resolve();
  function enqueue(job) {
    const run = queue.then(() => job());
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Queue an event job; failures are logged and never reach the event dispatcher. */
  function guarded(kind, job) {
    return enqueue(job).catch((err) => logFailure(kind, err));
  }

  async function readKey(area, key) {
    const got = await area.get(key);
    return isObject(got) ? got[key] : undefined;
  }

  async function readAllSession() {
    const got = await session.get(null);
    return isObject(got) ? got : {};
  }

  async function readRecord(tabId) {
    return normalizeRecord(await readKey(session, tabKey(tabId)));
  }

  function writeRecord(tabId, record) {
    return session.set({ [tabKey(tabId)]: record });
  }

  async function readProfile() {
    return normalizeProfile(await readKey(session, PROFILE_KEY));
  }

  async function readDemo() {
    // Only an exact `true` counts; missing or malformed values mean off.
    return (await readKey(local, DEMO_KEY)) === true;
  }

  // rules.json is fetched once per worker life. A failed load clears the cache so a later call retries.
  let thresholdsPromise = null;
  async function fetchThresholds() {
    const res = await fetchFn(runtime.getURL('rules.json'));
    if (!res || res.ok !== true) throw new Error(`rules.json request failed (${res?.status})`);
    return parseThresholds(await res.json());
  }
  function loadThresholds() {
    if (!thresholdsPromise) {
      thresholdsPromise = fetchThresholds().catch((err) => {
        thresholdsPromise = null;
        throw err;
      });
    }
    return thresholdsPromise;
  }

  /** Active-profile thresholds in seconds, or null (with one diagnostic) when rules.json is unusable. */
  async function readThresholds(demoMode) {
    try {
      return scaleThresholds(await loadThresholds(), demoMode);
    } catch (err) {
      logFailure('rules.json load', err);
      return null;
    }
  }

  /**
   * Accept only this extension's own top-frame content scripts on http/https pages.
   * Returns { tabId, url, active } or null. The Tab object is read only for id,
   * active, and incognito.
   */
  function contentSender(sender) {
    if (!isObject(sender) || sender.id !== runtime.id || sender.frameId !== 0) return null;
    const tab = sender.tab;
    if (!isObject(tab) || !isTabId(tab.id) || tab.incognito === true) return null;
    if (!isWebUrl(sender.url)) return null;
    return { tabId: tab.id, url: sender.url, active: tab.active !== false };
  }

  /** The sender tab's record, or a new one with an Absence starting at t if the tab is inactive. */
  async function ensureRecord(from, profile, t) {
    return (await readRecord(from.tabId)) ?? createRecord({ t, away: !from.active, profile });
  }

  async function contentState(message, sender) {
    const from = contentSender(sender);
    if (!from) return fail('content-state requires a top-frame content-script sender');
    if (typeof message.title !== 'string') return fail('title must be a string');
    return enqueue(async () => {
      const t = now();
      const [profile, demoMode] = await Promise.all([readProfile(), readDemo()]);
      const record = { ...(await ensureRecord(from, profile, t)), url: from.url, title: truncateTitle(message.title) };
      await writeRecord(from.tabId, record);
      const mode = modeOf(demoMode);
      return {
        ok: true,
        demoMode,
        timeScale: demoMode ? DEMO_TIME_SCALE : 1,
        epoch: profile.epoch,
        heldSeconds: heldAwayMs(record, mode, profile) / 1000,
        currentSeconds: currentAwayMs(record, mode, profile, t) / 1000,
      };
    });
  }

  async function report(message, sender) {
    const from = contentSender(sender);
    if (!from) return fail('report requires a top-frame content-script sender');
    const { title, heldSeconds, epoch } = message;
    if (typeof title !== 'string') return fail('title must be a string');
    if (!isFiniteNumber(heldSeconds) || heldSeconds < 0) return fail('heldSeconds must be a non-negative number');
    if (!Number.isInteger(epoch) || epoch < 0) return fail('epoch must be a non-negative integer');
    return enqueue(async () => {
      const t = now();
      const [profile, demoMode] = await Promise.all([readProfile(), readDemo()]);
      // A report from another epoch belongs to a profile that is no longer running: ignore it entirely.
      if (epoch !== profile.epoch) return { ok: true, applied: false };
      const named = { ...(await ensureRecord(from, profile, t)), url: from.url, title: truncateTitle(title) };
      await writeRecord(from.tabId, raiseHeld(named, modeOf(demoMode), profile, heldSeconds * 1000, t));
      return { ok: true, applied: true };
    });
  }

  async function resurrect(message, sender) {
    const from = contentSender(sender);
    if (!from) return fail('resurrect requires a top-frame content-script sender');
    return enqueue(async () => {
      const t = now();
      const profile = await readProfile();
      const base = { ...(await ensureRecord(from, profile, t)), url: from.url };
      await writeRecord(from.tabId, resetRecord(base, profile, t, from.active));
      return { ok: true };
    });
  }

  // Worker-handled message types. A type without a handler is rejected with no side effects.
  const handlers = new Map([
    [MESSAGE.CONTENT_STATE, contentState],
    [MESSAGE.REPORT, report],
    [MESSAGE.RESURRECT, resurrect],
  ]);

  /** Dispatch one message. Always resolves to {ok:true,...} or {ok:false,error}. */
  async function handleMessage(message, sender) {
    if (!isObject(message) || typeof message.type !== 'string') return fail('malformed message');
    const handler = handlers.get(message.type);
    if (!handler) {
      return fail(message.type === MESSAGE.APPLY_RESET ? `${MESSAGE.APPLY_RESET} is handled by content scripts` : 'unknown message type');
    }
    try {
      return await handler(message, sender);
    } catch (err) {
      logFailure(message.type, err);
      return fail('internal error');
    }
  }

  /** runtime.onMessage listener: returns true and responds asynchronously (MV3 pattern). */
  function onMessage(message, sender, sendResponse) {
    handleMessage(message, sender).then(sendResponse, () => sendResponse(fail('internal error')));
    return true;
  }

  /**
   * The record to write for a tab that was active in its window and is no longer,
   * or null when nothing should change. The tabs.get guard skips tabs that were
   * closed or moved to another window where they are active.
   */
  async function leftTabRecord(tabId, profile, t) {
    let tab;
    try {
      tab = await tabs.get(tabId);
    } catch {
      return null;
    }
    if (!isObject(tab) || tab.active !== false || tab.incognito === true) return null;
    const existing = await readRecord(tabId);
    if (!existing) return createRecord({ t, away: true, profile }); // stub: url null until a content script reports
    return existing.leftAt === null ? { ...existing, leftAt: t } : null;
  }

  /** tabs.onActivated: end the Absence of the activated tab; start one for the window's previous tab. */
  function handleActivated(activeInfo) {
    const tabId = activeInfo?.tabId;
    const windowId = activeInfo?.windowId;
    if (!isTabId(tabId) || !isWindowId(windowId)) return Promise.resolve();
    return guarded('tabs.onActivated', async () => {
      const t = now();
      const profile = await readProfile();
      const winKey = windowKey(windowId);
      const previous = await readKey(session, winKey);
      const writes = { [winKey]: tabId };
      if (isTabId(previous) && previous !== tabId) {
        const left = await leftTabRecord(previous, profile, t);
        if (left) writes[tabKey(previous)] = left;
      }
      const record = await readRecord(tabId);
      if (record && record.leftAt !== null) writes[tabKey(tabId)] = completeAbsence(record, profile, t);
      await session.set(writes);
    });
  }

  /** runtime.onInstalled / onStartup: record active tabs and start an Absence for unrecorded inactive tabs. */
  function seedTabs() {
    return guarded('tab seeding', async () => {
      const t = now();
      const [profile, stored, all] = await Promise.all([readProfile(), readAllSession(), tabs.query({})]);
      const writes = {};
      for (const tab of Array.isArray(all) ? all : []) {
        if (!isObject(tab) || !isTabId(tab.id) || tab.incognito === true) continue;
        if (tab.active === true) {
          if (isWindowId(tab.windowId)) writes[windowKey(tab.windowId)] = tab.id;
        } else if (tab.active === false && !normalizeRecord(stored[tabKey(tab.id)])) {
          writes[tabKey(tab.id)] = createRecord({ t, away: true, profile });
        }
      }
      if (Object.keys(writes).length > 0) await session.set(writes);
    });
  }

  /** Window keys whose stored active tab id equals tabId. */
  function windowKeysFor(stored, tabId) {
    return Object.keys(stored).filter((key) => key.startsWith(WINDOW_KEY_PREFIX) && stored[key] === tabId);
  }

  /** tabs.onReplaced: move the record and any window entry from the removed id to the added id. */
  function handleReplaced(addedTabId, removedTabId) {
    if (!isTabId(addedTabId) || !isTabId(removedTabId) || addedTabId === removedTabId) return Promise.resolve();
    return guarded('tabs.onReplaced', async () => {
      const stored = await readAllSession();
      const writes = {};
      const moved = normalizeRecord(stored[tabKey(removedTabId)]);
      if (moved) {
        // Keep the tab's history; if the new page already reported, keep its newer URL and title.
        const newer = normalizeRecord(stored[tabKey(addedTabId)]);
        writes[tabKey(addedTabId)] = newer?.url ? { ...moved, url: newer.url, title: newer.title } : moved;
      }
      for (const key of windowKeysFor(stored, removedTabId)) writes[key] = addedTabId;
      if (Object.keys(writes).length > 0) await session.set(writes);
      if (moved) await session.remove(tabKey(removedTabId));
    });
  }

  /** tabs.onRemoved: delete only that tab's record and any window entry pointing to it. */
  function handleRemoved(tabId, removeInfo) {
    if (!isTabId(tabId)) return Promise.resolve();
    return guarded('tabs.onRemoved', async () => {
      const keys = [tabKey(tabId)];
      const windowId = removeInfo?.windowId;
      if (isWindowId(windowId)) {
        if ((await readKey(session, windowKey(windowId))) === tabId) keys.push(windowKey(windowId));
      } else {
        keys.push(...windowKeysFor(await readAllSession(), tabId));
      }
      await session.remove(keys);
    });
  }

  /** windows.onRemoved: delete the window entry. */
  function handleWindowRemoved(windowId) {
    if (!isWindowId(windowId)) return Promise.resolve();
    return guarded('windows.onRemoved', () => session.remove(windowKey(windowId)));
  }

  return {
    enqueue,
    handleMessage,
    onMessage,
    handleActivated,
    handleReplaced,
    handleRemoved,
    handleWindowRemoved,
    seedTabs,
    readRecord,
    readProfile,
    readDemo,
    loadThresholds,
    readThresholds,
  };
}

/** Register the worker listeners on a Chrome API object; returns the tracker. */
export function registerBackground(chromeApi, options) {
  const background = createBackground(chromeApi, options);
  const { runtime, tabs, windows } = chromeApi;
  runtime.onMessage.addListener(background.onMessage);
  runtime.onInstalled.addListener(() => { void background.seedTabs(); });
  runtime.onStartup.addListener(() => { void background.seedTabs(); });
  tabs.onActivated.addListener((activeInfo) => { void background.handleActivated(activeInfo); });
  tabs.onReplaced.addListener((addedTabId, removedTabId) => { void background.handleReplaced(addedTabId, removedTabId); });
  tabs.onRemoved.addListener((tabId, removeInfo) => { void background.handleRemoved(tabId, removeInfo); });
  windows.onRemoved.addListener((windowId) => { void background.handleWindowRemoved(windowId); });
  return background;
}

// Listeners must be registered synchronously at top level so a restarted
// worker receives the event that woke it.
if (globalThis.chrome?.runtime?.onMessage && globalThis.chrome?.tabs?.onActivated && globalThis.chrome?.windows?.onRemoved) {
  registerBackground(globalThis.chrome);
}
