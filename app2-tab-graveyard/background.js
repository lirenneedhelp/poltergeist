// Tab Graveyard service worker (Manifest V3 module worker): the Activity_Tracker.
// It is the source of truth for when each tab was left and for its Registers.
// Open-tab records live only in chrome.storage.session; chrome.storage.local holds
// only the demo flag and the buried list. The worker never reads url, pendingUrl,
// title, or favIconUrl from a Tab object: the URL comes from MessageSender.url and
// the title from the content script's payload. It does not import the skeleton.
// Tabs are closed only while handling graveyard:empty from an extension page, after
// their Buried_Entries are saved; graveyard:bury only moves tabs into the Graveyard
// group, and no timer, event, or content message closes a tab.
// Each window has at most one Graveyard_Group, identified by the group id the worker
// recorded when it created the group, never by its title. A group the user made is
// never changed, and a group title is read only while its id is the recorded one.

export const MESSAGE = Object.freeze({
  CONTENT_STATE: 'graveyard:content-state', // content -> worker
  REPORT: 'graveyard:report', //               content -> worker
  RESURRECT: 'graveyard:resurrect', //         content -> worker
  POPUP_STATE: 'graveyard:popup-state', //     popup -> worker
  RESURRECT_TAB: 'graveyard:resurrect-tab', // popup -> worker
  BURY: 'graveyard:bury', //                   popup -> worker
  EMPTY: 'graveyard:empty', //                 popup -> worker
  REOPEN: 'graveyard:reopen', //               popup -> worker
  SET_DEMO: 'graveyard:set-demo', //           popup -> worker
  SET_AUTO_BURY: 'graveyard:set-auto-bury', // popup -> worker
  APPLY_RESET: 'graveyard:apply-reset', //     worker -> content
  REFRESH: 'graveyard:refresh', //             worker -> content (rejected when the worker receives it)
});

export const TAB_KEY_PREFIX = 'graveyard.tab.'; //            session: Tab_Record
export const WINDOW_KEY_PREFIX = 'graveyard.window.'; //      session: active tab id of a window
export const PROFILE_KEY = 'graveyard.profile'; //            session: { epoch, startedAt }
export const GROUP_KEY_PREFIX = 'graveyard.group.'; //        session: Graveyard_Group id of a window
export const EXEMPT_KEY_PREFIX = 'graveyard.exempt.'; //      session: true while saved as exempt
export const ATTEMPT_KEY_PREFIX = 'graveyard.buryAttempt.'; // session: true once Auto_Bury has had its attempt
export const DEMO_KEY = 'graveyard.demoMode'; //              local: Boolean
export const AUTO_BURY_KEY = 'graveyard.autoBury'; //         local: Boolean
export const BURIED_KEY = 'graveyard.buried'; //              local: Buried_Entry[], newest first

export const GRAVEYARD_TITLE = 'Graveyard';
export const GRAVEYARD_COLOR = 'grey';
/** chrome.tabGroups.TAB_GROUP_ID_NONE: the tab is in no group. */
export const NO_GROUP = -1;
/** Largest tabIds array a graveyard:empty message may carry. MAX_BURIED also caps the tabs one call selects. */
export const MAX_EMPTY_IDS = 500;

/** One hour of normal timing per second of demo timing. */
export const DEMO_TIME_SCALE = 3600;
export const MAX_TITLE_LENGTH = 300;
export const MAX_URL_LENGTH = 2048;
/** Buried_Entries kept; the oldest are dropped beyond this. */
export const MAX_BURIED = 200;
/** Largest tabIds array a graveyard:bury message may carry. */
export const MAX_BURY_IDS = 500;
const MAX_ENTRY_ID_LENGTH = 128;

/** Rule ids in rules.json whose trigger thresholds mark the start of each Stage. */
export const RULE_IDS = Object.freeze({ fog: 'graveyard-fog', rot: 'graveyard-rot', dead: 'graveyard-tombstone' });

/** Profile used when none is stored: epoch 0, and demo absences count from their own start. */
export const DEFAULT_PROFILE = Object.freeze({ epoch: 0, startedAt: 0 });

const LOG_PREFIX = '[poltergeist:graveyard]';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const nonNegative = (v) => (isFiniteNumber(v) && v > 0 ? v : 0);
const fail = (error) => ({ ok: false, error });

/** Replace any `scheme://...` text, as content.js does, so no URL reaches a diagnostic. */
const redactUrls = (text) => String(text).replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '<url>');

/**
 * Diagnostics carry only a fixed description and an error message with URLs removed,
 * never titles, group titles, URLs, or records.
 */
function logFailure(kind, err) {
  const detail = typeof err?.message === 'string' ? redactUrls(err.message) : 'unknown error';
  console.error(LOG_PREFIX, `${kind} failed:`, detail);
}

export const tabKey = (tabId) => `${TAB_KEY_PREFIX}${tabId}`;
export const windowKey = (windowId) => `${WINDOW_KEY_PREFIX}${windowId}`;
export const groupKey = (windowId) => `${GROUP_KEY_PREFIX}${windowId}`;
export const exemptKey = (tabId) => `${EXEMPT_KEY_PREFIX}${tabId}`;
export const attemptKey = (tabId) => `${ATTEMPT_KEY_PREFIX}${tabId}`;

/** Tab ids are non-negative integers; chrome.tabs.TAB_ID_NONE (-1) is not a tab. */
export function isTabId(value) {
  return Number.isInteger(value) && value >= 0;
}

/** Window ids are non-negative integers; chrome.windows.WINDOW_ID_NONE (-1) is not a window. */
export function isWindowId(value) {
  return Number.isInteger(value) && value >= 0;
}

/** Tab group ids are non-negative integers; NO_GROUP (-1) is not a group. */
export function isGroupId(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * The only place a Tab object is read (Requirement 9.3): id, windowId, active,
 * incognito, pinned, audible, and groupId. Returns null when `tab` is not a tab.
 * A missing or non-Boolean pinned or audible counts as false.
 */
export function tabView(tab) {
  if (!isObject(tab) || !isTabId(tab.id)) return null;
  const windowId = tab.windowId;
  const groupId = tab.groupId;
  return {
    id: tab.id,
    windowId: isWindowId(windowId) ? windowId : -1,
    active: tab.active !== false,
    incognito: tab.incognito === true,
    exempt: tab.pinned === true || tab.audible === true,
    groupId: isGroupId(groupId) ? groupId : NO_GROUP,
  };
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

/**
 * Saveable_Tab rule: a record can be saved only when a content script reported its URL
 * and the URL fits in a Buried_Entry. Truncating a URL would make Reopen open a different
 * page, so a longer URL keeps its tab out of the Graveyard instead.
 */
export function isSaveable(record) {
  return isObject(record) && typeof record.url === 'string' && record.url.length <= MAX_URL_LENGTH;
}

/** Coerce one stored Buried_Entry, or null when it is not one. The URL protocol is checked by Reopen. */
export function normalizeBuriedEntry(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '' || raw.id.length > MAX_ENTRY_ID_LENGTH) return null;
  if (typeof raw.url !== 'string' || raw.url === '' || raw.url.length > MAX_URL_LENGTH) return null;
  if (!isFiniteNumber(raw.buriedAt)) return null;
  return { id: raw.id, title: truncateTitle(raw.title), url: raw.url, buriedAt: raw.buriedAt, awaySeconds: nonNegative(raw.awaySeconds) };
}

/** Coerce the stored buried list: malformed entries are dropped and at most MAX_BURIED kept. */
export function normalizeBuried(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeBuriedEntry).filter((e) => e !== null).slice(0, MAX_BURIED);
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

/** Recorded Graveyard_Group ids in a full session snapshot: Map windowId -> groupId. */
export function graveyardIds(stored) {
  const out = new Map();
  for (const [key, value] of Object.entries(isObject(stored) ? stored : {})) {
    if (!key.startsWith(GROUP_KEY_PREFIX)) continue;
    const suffix = key.slice(GROUP_KEY_PREFIX.length);
    const windowId = Number(suffix);
    if (!isWindowId(windowId) || String(windowId) !== suffix || !isGroupId(value)) continue;
    out.set(windowId, value);
  }
  return out;
}

/** Graveyard_Tab: the tab's group is the recorded Graveyard_Group of the tab's own window. */
export function isGraveyardTab(view, groups) {
  return isObject(view) && view.groupId !== NO_GROUP && groups.get(view.windowId) === view.groupId;
}

/**
 * Dead_Tab: an open, non-exempt Saveable_Tab whose Away_Time at t is at or above the
 * Tombstone threshold. `thresholds` are the active profile's (null means no Stage).
 */
export function isDead(view, record, { demoMode, profile, thresholds, t }) {
  if (!isObject(view) || view.exempt || !isSaveable(record)) return false;
  return stage(awayMs(record, modeOf(demoMode), profile, t) / 1000, thresholds) === 'dead';
}

/** Buryable_Tab: a Dead_Tab in no tab group. */
export function isBuryableTab(view, record, context) {
  return isDead(view, record, context) && view.groupId === NO_GROUP;
}

/** Closable_Tab: a non-exempt Saveable_Tab inside its window's Graveyard_Group, whatever its Stage. */
export function isClosableTab(view, record, groups) {
  return isObject(view) && !view.exempt && isSaveable(record) && isGraveyardTab(view, groups);
}

/**
 * Build the tracker around an injected Chrome API object so it can be tested with
 * mocks. Nothing is registered here; see registerBackground.
 *   now:      clock in epoch ms (default Date.now)
 *   fetch:    fetch used for the packaged rules.json (default globalThis.fetch)
 *   randomId: id source for Buried_Entries (default crypto.randomUUID)
 */
export function createBackground(chromeApi, {
  now = () => Date.now(),
  fetch: fetchFn = (url) => globalThis.fetch(url),
  randomId = () => globalThis.crypto.randomUUID(),
} = {}) {
  const session = chromeApi.storage.session;
  const local = chromeApi.storage.local;
  const tabs = chromeApi.tabs;
  const tabGroups = chromeApi.tabGroups;
  const runtime = chromeApi.runtime;

  /** Tab ids owed a graveyard:refresh, sent after the current job and its Recount. */
  const refreshQueue = new Set();

  /** Recount: count the Dead_Tabs and update the Badge (Requirement 7). Not active yet. */
  async function recountSafely() {}

  /** Send the owed graveyard:refresh messages without awaiting them, so a slow page cannot stall the queue. */
  function flushRefreshes() {
    for (const tabId of refreshQueue) void sendToTab(tabId, { type: MESSAGE.REFRESH });
    refreshQueue.clear();
  }

  // Every read-modify-write of storage runs through this one chain. A failed job
  // rejects its own Promise but never breaks the chain for later jobs. Each link runs
  // the job, then the Recount when `recount` asks for it ('always' for event jobs,
  // 'ok' for message jobs that reply ok:true), then the refresh flush. The next job
  // starts only after all three have finished.
  let queue = Promise.resolve();
  function enqueue(job, { recount = 'never' } = {}) {
    const run = queue.then(async () => {
      let result;
      let failed = false;
      let error;
      try {
        result = await job();
      } catch (err) {
        failed = true;
        error = err;
      }
      if (recount === 'always' || (recount === 'ok' && !failed && result?.ok === true)) await recountSafely();
      flushRefreshes();
      if (failed) throw error;
      return result;
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Queue an event job; failures are logged and never reach the event dispatcher. */
  function guarded(kind, job) {
    return enqueue(job, { recount: 'always' }).catch((err) => logFailure(kind, err));
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

  /** Normal_Profile thresholds in seconds, or null (with one diagnostic) when rules.json is unusable. */
  async function readBaseThresholds() {
    try {
      return await loadThresholds();
    } catch (err) {
      logFailure('rules.json load', err);
      return null;
    }
  }

  /** Active-profile thresholds in seconds, or null (with one diagnostic) when rules.json is unusable. */
  async function readThresholds(demoMode) {
    const base = await readBaseThresholds();
    return base ? scaleThresholds(base, demoMode) : null;
  }

  async function readBuried() {
    return normalizeBuried(await readKey(local, BURIED_KEY));
  }

  /** Tab_Records in a full session snapshot, keyed by tab id. */
  function recordsIn(stored) {
    const out = new Map();
    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(TAB_KEY_PREFIX)) continue;
      const suffix = key.slice(TAB_KEY_PREFIX.length);
      const tabId = Number(suffix);
      if (!isTabId(tabId) || String(tabId) !== suffix) continue;
      const record = normalizeRecord(value);
      if (record) out.set(tabId, record);
    }
    return out;
  }

  /** Away_Time (whole seconds) and Stage of a record now. Stage is null without thresholds. */
  function assess(record, demoMode, profile, thresholds, t) {
    const ms = awayMs(record, modeOf(demoMode), profile, t);
    return { awaySeconds: Math.floor(ms / 1000), stage: stage(ms / 1000, thresholds) };
  }

  /** Open non-incognito tabs as a Map from tab id to tabView. Throws when tabs.query fails. */
  async function openTabs() {
    const all = await tabs.query({});
    const out = new Map();
    for (const tab of Array.isArray(all) ? all : []) {
      const view = tabView(tab);
      if (view && !view.incognito) out.set(view.id, view);
    }
    return out;
  }

  /** The tabView of an open non-incognito tab, or null when it cannot be read. */
  async function openTabView(tabId) {
    let tab;
    try {
      tab = await tabs.get(tabId);
    } catch {
      return null;
    }
    const view = tabView(tab);
    return view && !view.incognito ? view : null;
  }

  /** The tab's `active` flag when it is open and not incognito, otherwise null. */
  async function openTabActive(tabId) {
    const view = await openTabView(tabId);
    return view ? view.active : null;
  }

  /** Send a message to a tab's top-frame content script; resolves undefined when no receiver answers. */
  async function sendToTab(tabId, message) {
    try {
      return await tabs.sendMessage(tabId, message, { frameId: 0 });
    } catch {
      return undefined;
    }
  }

  /** True for this extension's own pages (popup, control page), false for content scripts and other senders. */
  function isExtensionPage(sender) {
    if (!isObject(sender) || sender.id !== runtime.id) return false;
    const base = runtime.getURL('');
    return typeof sender.url === 'string' && sender.url.startsWith(base);
  }

  /**
   * Accept only this extension's own top-frame content scripts on http/https pages.
   * Returns { tabId, url, active, view } or null. The Tab object is read only through tabView.
   */
  function contentSender(sender) {
    if (!isObject(sender) || sender.id !== runtime.id || sender.frameId !== 0) return null;
    const view = tabView(sender.tab);
    if (!view || view.incognito) return null;
    if (!isWebUrl(sender.url)) return null;
    return { tabId: view.id, url: sender.url, active: view.active, view };
  }

  /**
   * The recorded Graveyard_Group of a window when it still exists in that window and is
   * titled exactly GRAVEYARD_TITLE; otherwise the record is deleted and null returned
   * (Requirement 2.9). The window is checked before the title, so a title is read only
   * while the id is the one recorded for the group's window (9.4).
   */
  async function usableGroup(windowId) {
    const id = await readKey(session, groupKey(windowId));
    if (!isGroupId(id)) {
      if (id !== undefined) await session.remove(groupKey(windowId));
      return null;
    }
    let group;
    try {
      group = await tabGroups.get(id);
    } catch {
      group = null;
    }
    if (!isObject(group) || group.windowId !== windowId || group.title !== GRAVEYARD_TITLE) {
      await session.remove(groupKey(windowId));
      return null;
    }
    return id;
  }

  /**
   * After a failed tabs.group call: a tab now in the window's recorded Graveyard_Group
   * counts as moved, any other tab (including one that cannot be read) as not moved.
   */
  async function settle(windowId, tabIds) {
    const recorded = await readKey(session, groupKey(windowId));
    const moved = [];
    const notMoved = [];
    for (const tabId of tabIds) {
      let view = null;
      try {
        view = tabView(await tabs.get(tabId));
      } catch (err) {
        logFailure('tabs.get', err);
      }
      const inGraveyard = view !== null && isGroupId(recorded) && view.windowId === windowId && view.groupId === recorded;
      (inGraveyard ? moved : notMoved).push(tabId);
    }
    return { moved, notMoved };
  }

  /**
   * Move tabIds (all of one window, all in no group) into that window's Graveyard_Group,
   * reusing the recorded group or creating one. `collapse` is 'always' for Bury (3.4) and
   * 'unless-active' for Auto_Bury (8.13), which keeps a reused group expanded while it
   * holds the window's active tab `activeTabId` (looked up in `views`). Never touches a
   * group the user made. Returns { moved, notMoved }.
   */
  async function moveIntoGraveyard(windowId, tabIds, { collapse = 'always', activeTabId = null, views = null } = {}) {
    if (tabIds.length === 0) return { moved: [], notMoved: [] };
    const style = { title: GRAVEYARD_TITLE, color: GRAVEYARD_COLOR };
    const reused = await usableGroup(windowId);
    if (reused !== null) {
      try {
        await tabs.group({ groupId: reused, tabIds });
      } catch (err) {
        logFailure('tabs.group', err);
        return settle(windowId, tabIds);
      }
      const keepOpen = collapse === 'unless-active' && views?.get(activeTabId)?.groupId === reused;
      try {
        await tabGroups.update(reused, keepOpen ? style : { ...style, collapsed: true });
      } catch (err) {
        // The tabs are in the Graveyard_Group, so they count as moved (3.7).
        logFailure('tabGroups.update', err);
      }
      return { moved: [...tabIds], notMoved: [] };
    }
    let created;
    try {
      created = await tabs.group({ tabIds, createProperties: { windowId } });
    } catch (err) {
      logFailure('tabs.group', err);
      return settle(windowId, tabIds);
    }
    try {
      if (!isGroupId(created)) throw new Error('tabs.group returned no group id');
      // Recorded before styling, so the creation-time onUpdated event does not Release it (2.5).
      await session.set({ [groupKey(windowId)]: created });
      // A new group never holds the active tab here, so it is always collapsed (2.3).
      await tabGroups.update(created, { ...style, collapsed: true });
    } catch (err) {
      // Requirement 2.13: forget the group, leave it as Chrome made it, move nothing else.
      logFailure('graveyard group setup', err);
      try {
        await session.remove(groupKey(windowId));
      } catch (removeErr) {
        logFailure('group record delete', removeErr);
      }
      return { moved: [], notMoved: [...tabIds] };
    }
    return { moved: [...tabIds], notMoved: [] };
  }

  /**
   * Resurrect, after its Reset is saved: delete the tab's Auto_Bury attempt and, when the
   * tab is in its window's recorded Graveyard_Group now, take it out with one tabs.ungroup
   * call (5.1). A tab in no group or in a user group is left alone (5.2). Failures are
   * logged once and never change the Resurrect's outcome (5.3). This is the only place
   * the extension ungroups a tab (5.6).
   */
  async function afterResurrect(tabId) {
    try {
      // Only an existing attempt is deleted, so a Resurrect without one writes nothing extra.
      if ((await readKey(session, attemptKey(tabId))) !== undefined) await session.remove(attemptKey(tabId));
    } catch (err) {
      logFailure('bury attempt delete', err);
    }
    await ungroupIfGraveyard(tabId);
  }

  /** One tabs.ungroup call when the tab is a Graveyard_Tab now; otherwise no call. */
  async function ungroupIfGraveyard(tabId) {
    // A tab that can no longer be read is closed, so there is nothing to ungroup.
    const view = await openTabView(tabId);
    if (!view || view.groupId === NO_GROUP) return;
    let recorded;
    try {
      recorded = await readKey(session, groupKey(view.windowId));
    } catch (err) {
      logFailure('group record read', err);
      return;
    }
    if (!isGroupId(recorded) || view.groupId !== recorded) return;
    try {
      await tabs.ungroup(view.id);
    } catch (err) {
      // The Reset stays saved and the group stays recorded; no second attempt (5.3).
      logFailure('tabs.ungroup', err);
    }
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
    }, { recount: 'ok' });
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
    }, { recount: 'ok' });
  }

  async function resurrect(message, sender) {
    const from = contentSender(sender);
    if (!from) return fail('resurrect requires a top-frame content-script sender');
    return enqueue(async () => {
      const t = now();
      const profile = await readProfile();
      const base = { ...(await ensureRecord(from, profile, t)), url: from.url };
      await writeRecord(from.tabId, resetRecord(base, profile, t, from.active));
      // After the Reset is saved and before the reply lets the page clear its decay.
      await afterResurrect(from.tabId);
      return { ok: true };
    }, { recount: 'ok' });
  }

  /**
   * Everything the popup shows. Read-only. `rulesLoaded` is false when rules.json is
   * unusable; then no Stage is known and the Graveyard lists no Dead_Tabs. `dead` holds
   * only Buryable_Tabs (3.13); `closable` holds the Closable_Tab ids in the same order,
   * whatever their Stage and also without rules (4.1). When tabs.query fails, group
   * membership is unknown, so both lists are empty (one diagnostic).
   */
  async function popupState(message, sender) {
    if (!isExtensionPage(sender)) return fail('popup-state requires an extension page sender');
    if (!isTabId(message.tabId)) return fail('tabId must be a non-negative integer');
    const base = await readBaseThresholds();
    return enqueue(async () => {
      const t = now();
      const [demoMode, profile, stored, buried, views] = await Promise.all([
        readDemo(), readProfile(), readAllSession(), readBuried(),
        openTabs().catch((err) => {
          logFailure('tabs.query', err);
          return null;
        }),
      ]);
      const thresholds = base ? scaleThresholds(base, demoMode) : null;
      const records = recordsIn(stored);
      const groups = graveyardIds(stored);

      const own = records.get(message.tabId);
      const current = own?.url
        ? { known: true, ...assess(own, demoMode, profile, thresholds, t) }
        : { known: false, stage: null, awaySeconds: 0 };

      const dead = [];
      const closable = [];
      for (const [tabId, record] of records) {
        const view = views?.get(tabId);
        if (!view || view.exempt || !isSaveable(record)) continue;
        const { awaySeconds, stage: s } = assess(record, demoMode, profile, thresholds, t);
        if (isGraveyardTab(view, groups)) closable.push({ tabId, awaySeconds });
        else if (s === 'dead' && view.groupId === NO_GROUP) dead.push({ tabId, title: record.title, url: record.url, awaySeconds });
        // A Dead_Tab in a user-made group is neither listed nor closable (decision 12).
      }
      const byAway = (a, b) => b.awaySeconds - a.awaySeconds || a.tabId - b.tabId;
      dead.sort(byAway);
      closable.sort(byAway);

      return { ok: true, demoMode, rulesLoaded: base !== null, current, dead, closable: closable.map((c) => c.tabId), buried };
    }, { recount: 'ok' });
  }

  /** Popup Resurrect: reset the tab's Registers, then tell its page to clear the decay. */
  async function resurrectTab(message, sender) {
    if (!isExtensionPage(sender)) return fail('resurrect-tab requires an extension page sender');
    const { tabId } = message;
    if (!isTabId(tabId)) return fail('tabId must be a non-negative integer');
    const committed = await enqueue(async () => {
      const record = await readRecord(tabId);
      if (!record) return fail('unknown tab');
      const active = await openTabActive(tabId);
      if (active === null) return fail('tab is not open');
      const t = now();
      const profile = await readProfile();
      await writeRecord(tabId, resetRecord(record, profile, t, active));
      // After the Reset is saved and before graveyard:apply-reset is sent.
      await afterResurrect(tabId);
      return { ok: true };
    }, { recount: 'ok' });
    if (!committed.ok) return committed;
    // Sent after the commit and outside the queue: a discarded tab has no receiver,
    // and its reload seeds 0 from the reset record.
    const reply = await sendToTab(tabId, { type: MESSAGE.APPLY_RESET });
    return { ok: true, delivered: isObject(reply) && reply.ok === true };
  }

  /**
   * Switch Demo_Mode. Only an actual transition writes anything. The new Profile_Epoch
   * is saved before the flag: if the flag write then fails, the extra epoch only zeroes
   * the demo Registers, whereas a flag saved without a new epoch would turn demo on with
   * demo Registers that already hold real absences. Normal Registers are never touched.
   * Content scripts converge through chrome.storage.onChanged on the flag; their
   * content-state requests queue behind this job, so they see both writes.
   */
  async function setDemo(message, sender) {
    if (!isExtensionPage(sender)) return fail('set-demo requires an extension page sender');
    const { enabled } = message;
    if (typeof enabled !== 'boolean') return fail('enabled must be a Boolean');
    return enqueue(async () => {
      if ((await readDemo()) === enabled) return { ok: true, demoMode: enabled };
      const t = now();
      const profile = await readProfile();
      try {
        await session.set({ [PROFILE_KEY]: { epoch: profile.epoch + 1, startedAt: t } });
        await local.set({ [DEMO_KEY]: enabled });
      } catch (err) {
        logFailure('demo mode save', err);
        return fail('could not save demo mode');
      }
      return { ok: true, demoMode: enabled };
    }, { recount: 'ok' });
  }

  /**
   * Bury: move every distinct requested tab that is a Buryable_Tab now into the
   * Graveyard_Group of its own window, collapsed (3.3, 3.4). Closes no tab, changes no
   * Register, and saves no Buried_Entry (3.5). Dead_Tabs in any tab group stay where they
   * are and appear in neither reply array (decision 12). Each moved tab gets its Auto_Bury
   * attempt (8.6). Nothing moves when rules.json is unusable (3.8).
   */
  async function bury(message, sender) {
    if (!isExtensionPage(sender)) return fail('bury requires an extension page sender');
    const { tabIds } = message;
    if (!Array.isArray(tabIds) || tabIds.length > MAX_BURY_IDS || !tabIds.every(isTabId)) {
      return fail(`tabIds must be an array of at most ${MAX_BURY_IDS} tab ids`);
    }
    const base = await readBaseThresholds();
    if (!base) return fail('rules unavailable');
    return enqueue(async () => {
      const t = now();
      const [demoMode, profile, stored, views] = await Promise.all([readDemo(), readProfile(), readAllSession(), openTabs()]);
      const context = { demoMode, profile, thresholds: scaleThresholds(base, demoMode), t };
      const records = recordsIn(stored);

      // Qualify against the newest view and group the tabs by their own window.
      const byWindow = new Map();
      for (const tabId of new Set(tabIds)) {
        const view = views.get(tabId);
        if (!isBuryableTab(view, records.get(tabId), context)) continue;
        if (!byWindow.has(view.windowId)) byWindow.set(view.windowId, []);
        byWindow.get(view.windowId).push(tabId);
      }

      const moved = [];
      const notMoved = [];
      for (const [windowId, ids] of byWindow) {
        if (!isWindowId(windowId)) {
          notMoved.push(...ids);
          continue;
        }
        try {
          const result = await moveIntoGraveyard(windowId, ids, { collapse: 'always', views });
          moved.push(...result.moved);
          notMoved.push(...result.notMoved);
        } catch (err) {
          // A storage failure before any move: this window's tabs stay put; other windows continue.
          logFailure('graveyard move', err);
          notMoved.push(...ids);
        }
      }

      if (moved.length > 0) {
        try {
          await session.set(Object.fromEntries(moved.map((tabId) => [attemptKey(tabId), true])));
        } catch (err) {
          // The tabs are in the group; a missing attempt only lets Auto_Bury see them again.
          logFailure('bury attempt save', err);
        }
      }
      return { ok: true, moved, notMoved };
    }, { recount: 'ok' });
  }

  /**
   * Empty graveyard: select the requested tabs that are Closable_Tabs now, in request
   * order, ignoring repeats, at most MAX_BURIED (4.4). Their Buried_Entries are saved
   * before any tab closes (4.5); nothing closes when the save fails (4.6). Stage is not
   * needed, so this works without rules.json (4.11). This is the only handler that
   * closes tabs (4.9).
   */
  async function emptyGraveyard(message, sender) {
    if (!isExtensionPage(sender)) return fail('empty requires an extension page sender');
    const { tabIds } = message;
    if (!Array.isArray(tabIds) || tabIds.length > MAX_EMPTY_IDS || !tabIds.every(isTabId)) {
      return fail(`tabIds must be an array of at most ${MAX_EMPTY_IDS} tab ids`);
    }
    return enqueue(async () => {
      const t = now();
      const [demoMode, profile, stored, existing, views] = await Promise.all([
        readDemo(), readProfile(), readAllSession(), readBuried(), openTabs(),
      ]);
      const records = recordsIn(stored);
      const groups = graveyardIds(stored);

      const selected = [];
      for (const tabId of new Set(tabIds)) {
        if (selected.length >= MAX_BURIED) break;
        const record = records.get(tabId);
        if (!isClosableTab(views.get(tabId), record, groups)) continue;
        const awaySeconds = Math.floor(awayMs(record, modeOf(demoMode), profile, t) / 1000);
        selected.push({ tabId, entry: { id: randomId(), title: record.title, url: record.url, buriedAt: t, awaySeconds } });
      }
      if (selected.length === 0) return { ok: true, buried: [], notClosed: [] };

      try {
        await local.set({ [BURIED_KEY]: [...selected.map((s) => s.entry), ...existing].slice(0, MAX_BURIED) });
      } catch (err) {
        logFailure('buried list save', err);
        return fail('could not save buried tabs');
      }

      // The only place the extension closes tabs: after the entries are saved, one call per tab.
      // A tab that fails to close keeps its entry and is reported in notClosed.
      const results = await Promise.allSettled(selected.map(async ({ tabId }) => tabs.remove(tabId)));
      const buried = [];
      const notClosed = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          buried.push(selected[i].tabId);
        } else {
          notClosed.push(selected[i].tabId);
          logFailure('tab close', r.reason);
        }
      });
      return { ok: true, buried, notClosed };
    }, { recount: 'ok' });
  }

  /** Reopen a Buried_Entry in a new active tab; the entry is removed only after the tab exists. */
  async function reopen(message, sender) {
    if (!isExtensionPage(sender)) return fail('reopen requires an extension page sender');
    const { entryId } = message;
    if (typeof entryId !== 'string' || entryId === '' || entryId.length > MAX_ENTRY_ID_LENGTH) {
      return fail('entryId must be a non-empty string');
    }
    return enqueue(async () => {
      const buried = await readBuried();
      const entry = buried.find((e) => e.id === entryId);
      if (!entry) return fail('unknown entry');
      if (!isWebUrl(entry.url)) return fail('unsupported url');
      try {
        await tabs.create({ url: entry.url, active: true });
      } catch (err) {
        logFailure('tabs.create', err);
        return fail('could not open tab');
      }
      try {
        await local.set({ [BURIED_KEY]: buried.filter((e) => e.id !== entryId) });
      } catch (err) {
        // The tab is open; the entry stays listed and the popup can show it again.
        logFailure('buried list save', err);
        return { ok: true, entryRemoved: false };
      }
      return { ok: true, entryRemoved: true };
    }, { recount: 'ok' });
  }

  // Worker-handled message types. A type without a handler is rejected with no side effects.
  const handlers = new Map([
    [MESSAGE.CONTENT_STATE, contentState],
    [MESSAGE.REPORT, report],
    [MESSAGE.RESURRECT, resurrect],
    [MESSAGE.POPUP_STATE, popupState],
    [MESSAGE.RESURRECT_TAB, resurrectTab],
    [MESSAGE.SET_DEMO, setDemo],
    [MESSAGE.BURY, bury],
    [MESSAGE.EMPTY, emptyGraveyard],
    [MESSAGE.REOPEN, reopen],
  ]);

  /** Dispatch one message. Always resolves to {ok:true,...} or {ok:false,error}. */
  async function handleMessage(message, sender) {
    if (!isObject(message) || typeof message.type !== 'string') return fail('malformed message');
    const handler = handlers.get(message.type);
    if (!handler) {
      // Worker -> content messages are rejected with no side effects (Requirement 1.9).
      const forContent = message.type === MESSAGE.APPLY_RESET || message.type === MESSAGE.REFRESH;
      return fail(forContent ? `${message.type} is handled by content scripts` : 'unknown message type');
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
    const view = await openTabView(tabId);
    if (!view || view.active) return null;
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
      const [profile, stored, views] = await Promise.all([readProfile(), readAllSession(), openTabs()]);
      const writes = {};
      for (const view of views.values()) {
        if (view.active) {
          if (isWindowId(view.windowId)) writes[windowKey(view.windowId)] = view.id;
        } else if (!normalizeRecord(stored[tabKey(view.id)])) {
          writes[tabKey(view.id)] = createRecord({ t, away: true, profile });
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

  /**
   * tabs.onRemoved: delete only that tab's record and any window entry pointing to it.
   * No Buried_Entry is saved, also when the closed tab was a Graveyard_Tab (2.11):
   * only graveyard:empty adds to the Buried_List.
   */
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

  /** windows.onRemoved: delete the window entry and the window's Graveyard_Group record (2.8). */
  function handleWindowRemoved(windowId) {
    if (!isWindowId(windowId)) return Promise.resolve();
    return guarded('windows.onRemoved', () => session.remove([windowKey(windowId), groupKey(windowId)]));
  }

  /**
   * tabs.onUpdated: only a change of pinned, audible, or groupId makes a job. The keys
   * are checked with Object.hasOwn, which reads no values; other changes (loading
   * status and the like) are dropped before the queue and cause no Recount. A groupId
   * change writes nothing: the move is never undone and the Tab_Record is kept (2.10);
   * the Recount after the job sees the new membership.
   */
  function handleUpdated(tabId, changeInfo) {
    if (!isTabId(tabId) || !isObject(changeInfo)) return Promise.resolve();
    const relevant = Object.hasOwn(changeInfo, 'pinned') || Object.hasOwn(changeInfo, 'audible') || Object.hasOwn(changeInfo, 'groupId');
    if (!relevant) return Promise.resolve();
    return guarded('tabs.onUpdated', async () => {});
  }

  /**
   * tabGroups.onUpdated: reads only the event group's id and windowId. When the id is
   * still recorded for that window once the job runs, the current title is read with
   * tabGroups.get; a title other than exactly GRAVEYARD_TITLE, or a group now in another
   * window, Releases the group (2.4). Colour and collapsed changes keep it, and no
   * tabGroups.update is made (2.6). A failed get keeps the record (2.12).
   */
  function handleGroupUpdated(group) {
    const groupId = isObject(group) ? group.id : undefined;
    const windowId = isObject(group) ? group.windowId : undefined;
    if (!isGroupId(groupId) || !isWindowId(windowId)) return Promise.resolve();
    return guarded('tabGroups.onUpdated', async () => {
      if ((await readKey(session, groupKey(windowId))) !== groupId) return;
      let current;
      try {
        current = await tabGroups.get(groupId);
      } catch (err) {
        logFailure('tabGroups.get', err);
        return;
      }
      // windowId first, so the title is read only while the id is recorded for the group's window (9.4).
      if (!isObject(current) || current.windowId !== windowId || current.title !== GRAVEYARD_TITLE) {
        await session.remove(groupKey(windowId));
      }
    });
  }

  /** tabGroups.onRemoved: delete every Graveyard_Group record holding the group's id (2.7). Reads only the id. */
  function handleGroupRemoved(group) {
    const groupId = isObject(group) ? group.id : undefined;
    if (!isGroupId(groupId)) return Promise.resolve();
    return guarded('tabGroups.onRemoved', async () => {
      const stored = await readAllSession();
      const keys = Object.keys(stored).filter((key) => key.startsWith(GROUP_KEY_PREFIX) && stored[key] === groupId);
      if (keys.length > 0) await session.remove(keys);
    });
  }

  return {
    enqueue,
    handleMessage,
    onMessage,
    handleActivated,
    handleReplaced,
    handleRemoved,
    handleWindowRemoved,
    handleUpdated,
    handleGroupUpdated,
    handleGroupRemoved,
    seedTabs,
    readRecord,
    readProfile,
    readDemo,
    readBuried,
    loadThresholds,
    readThresholds,
  };
}

/** Register the worker listeners on a Chrome API object; returns the tracker. */
export function registerBackground(chromeApi, options) {
  const background = createBackground(chromeApi, options);
  const { runtime, tabs, windows, tabGroups } = chromeApi;
  runtime.onMessage.addListener(background.onMessage);
  runtime.onInstalled.addListener(() => { void background.seedTabs(); });
  runtime.onStartup.addListener(() => { void background.seedTabs(); });
  tabs.onActivated.addListener((activeInfo) => { void background.handleActivated(activeInfo); });
  tabs.onReplaced.addListener((addedTabId, removedTabId) => { void background.handleReplaced(addedTabId, removedTabId); });
  tabs.onRemoved.addListener((tabId, removeInfo) => { void background.handleRemoved(tabId, removeInfo); });
  windows.onRemoved.addListener((windowId) => { void background.handleWindowRemoved(windowId); });
  tabs.onUpdated.addListener((tabId, changeInfo) => { void background.handleUpdated(tabId, changeInfo); });
  tabGroups.onUpdated.addListener((group) => { void background.handleGroupUpdated(group); });
  tabGroups.onRemoved.addListener((group) => { void background.handleGroupRemoved(group); });
  return background;
}

// Listeners must be registered synchronously at top level so a restarted
// worker receives the event that woke it.
if (globalThis.chrome?.runtime?.onMessage && globalThis.chrome?.tabs?.onActivated && globalThis.chrome?.windows?.onRemoved) {
  registerBackground(globalThis.chrome);
}
