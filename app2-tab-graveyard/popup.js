// Tab Graveyard popup. Talks only to the service worker through the enumerated
// protocol in background.js. From the Tabs API it reads the active tab's id and
// nothing else (no url, title, pendingUrl, or favIconUrl); every title, URL, and
// duration comes from graveyard:popup-state. Page data is set with textContent
// only, and URLs are shown as their host.

// Kept in sync with MESSAGE in background.js. Importing background.js here would
// register a second set of worker listeners inside the popup page.
export const POPUP_MESSAGE = Object.freeze({
  POPUP_STATE: 'graveyard:popup-state',
  RESURRECT_TAB: 'graveyard:resurrect-tab',
  BURY: 'graveyard:bury',
  REOPEN: 'graveyard:reopen',
  SET_DEMO: 'graveyard:set-demo',
});

export const STAGE_LABEL = Object.freeze({ alive: 'Alive', fogged: 'Fogged', rotting: 'Rotting', dead: 'Dead' });

export const TEXT = Object.freeze({
  loading: 'Checking this tab…',
  unreachable: 'Could not reach Tab Graveyard. Close and reopen this popup.',
  notHaunted: 'Not haunted here',
  unknownStage: 'Unknown',
  noDead: 'No dead tabs.',
  rulesMissing: 'Could not load the decay rules, so no tabs are listed.',
  noBuried: 'Nothing buried yet.',
  untitled: 'Untitled tab',
  resurrectFailed: 'Could not resurrect this tab. Try again.',
  undelivered: 'Reset saved, but this tab is not responding. The decay clears when the page reloads.',
  buryFailed: 'Could not bury those tabs. Try again.',
  reopenFailed: 'Could not reopen that tab. Try again.',
  reopenKept: 'Reopened, but the entry could not be removed from the list.',
  demoFailed: 'Could not change demo mode. Try again.',
});

const FAILURE_TEXT = Object.freeze({
  resurrect: TEXT.resurrectFailed,
  bury: TEXT.buryFailed,
  reopen: TEXT.reopenFailed,
  demo: TEXT.demoFailed,
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isTabId = (v) => Number.isInteger(v) && v >= 0;
const nonNegative = (v) => (isFiniteNumber(v) && v > 0 ? v : 0);

export const buryLabel = (count) => `Bury all (${count})`;
export const notClosedText = (count) =>
  `Could not close ${count} tab${count === 1 ? '' : 's'}. ${count === 1 ? 'It is' : 'They are'} still open.`;

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * Same wording rules as formatDuration in skeleton/effects/tombstone.js (Requirement 4.5).
 * Duplicated because the popup does not load the skeleton; a unit test pins both to the
 * same outputs.
 */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'a while';
  const s = Math.max(0, seconds);
  if (s < 60) return plural(Math.floor(s), 'second');
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 48 * 3600) return plural(Math.floor(s / 3600), 'hour');
  return plural(Math.floor(s / 86400), 'day');
}

/** The host of a URL (with any port), or '' when it cannot be parsed. Nothing else of the URL is shown. */
export function hostOf(url) {
  if (typeof url !== 'string') return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Trimmed title, then the URL's host, then 'Untitled tab'. */
export function displayTitle(title, url) {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return trimmed || hostOf(url) || TEXT.untitled;
}

/** A Buried_Entry date such as "12 Mar 2026" (locale dependent); '' for an unusable time. */
export function formatBuriedDate(ms, locale) {
  if (!isFiniteNumber(ms)) return '';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function parseDead(row) {
  if (!isObject(row) || !isTabId(row.tabId) || typeof row.url !== 'string') return null;
  return { tabId: row.tabId, title: typeof row.title === 'string' ? row.title : '', url: row.url, awaySeconds: nonNegative(row.awaySeconds) };
}

function parseBuried(row) {
  if (!isObject(row) || typeof row.id !== 'string' || row.id === '' || typeof row.url !== 'string') return null;
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title : '',
    url: row.url,
    buriedAt: isFiniteNumber(row.buriedAt) ? row.buriedAt : null,
    awaySeconds: nonNegative(row.awaySeconds),
  };
}

/** Coerce a graveyard:popup-state reply into the popup's view data, or null when it is unusable. */
export function parseState(reply) {
  if (!isObject(reply) || reply.ok !== true || typeof reply.demoMode !== 'boolean') return null;
  if (!isObject(reply.current) || !Array.isArray(reply.dead) || !Array.isArray(reply.buried)) return null;
  const known = reply.current.known === true;
  const stage = known && Object.hasOwn(STAGE_LABEL, reply.current.stage) ? reply.current.stage : null;
  return {
    demoMode: reply.demoMode,
    rulesLoaded: reply.rulesLoaded !== false,
    current: { known, stage, awaySeconds: known ? nonNegative(reply.current.awaySeconds) : 0 },
    dead: reply.dead.map(parseDead).filter((r) => r !== null),
    buried: reply.buried.map(parseBuried).filter((r) => r !== null),
  };
}

/**
 * Build the popup controller around injected Chrome and DOM objects so it can be
 * exercised in tests. Nothing runs until init() is called.
 *   locale: locale for buried dates (default: the browser's)
 */
export function createPopup({ chrome: chromeApi, document: doc, locale } = {}) {
  const el = {
    main: doc.getElementById('main'),
    notice: doc.getElementById('notice'),
    current: doc.getElementById('current'),
    currentStage: doc.getElementById('current-stage'),
    currentAway: doc.getElementById('current-away'),
    resurrect: doc.getElementById('resurrect'),
    deadEmpty: doc.getElementById('dead-empty'),
    deadList: doc.getElementById('dead-list'),
    bury: doc.getElementById('bury'),
    buriedEmpty: doc.getElementById('buried-empty'),
    buriedList: doc.getElementById('buried-list'),
    demo: doc.getElementById('demo'),
  };

  const state = {
    phase: 'loading', // 'loading' | 'ready' | 'error'
    tabId: null,
    data: null, // last state confirmed by the worker (parseState output); controls roll back to it
    busy: null, // null | 'resurrect' | 'bury' | 'reopen' | 'demo': one command in flight at a time
    pendingDemo: null, // requested Demo_Mode while that command is in flight
    notice: null, // null | { kind: 'error' | 'warning', text }
  };
  let listsFrom; // the data object the lists were last built from

  async function send(message) {
    try {
      const reply = await chromeApi.runtime.sendMessage(message);
      return isObject(reply) ? reply : { ok: false, error: 'no response' };
    } catch {
      return { ok: false, error: 'no response' };
    }
  }

  async function activeTabId() {
    try {
      const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
      const id = Array.isArray(tabs) && isObject(tabs[0]) ? tabs[0].id : undefined;
      return isTabId(id) ? id : null;
    } catch {
      return null;
    }
  }

  async function fetchState(tabId) {
    return parseState(await send({ type: POPUP_MESSAGE.POPUP_STATE, tabId }));
  }

  function textSpan(className, text) {
    const span = doc.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  function rowText(title, url, when) {
    const text = doc.createElement('div');
    text.className = 'row-text';
    const meta = doc.createElement('div');
    meta.className = 'row-meta';
    meta.append(textSpan('row-host', hostOf(url)), textSpan('row-when', when));
    text.append(textSpan('row-title', displayTitle(title, url)), meta);
    return text;
  }

  function deadRow(row) {
    const li = doc.createElement('li');
    li.className = 'row';
    li.dataset.tabId = String(row.tabId);
    li.append(rowText(row.title, row.url, `Abandoned ${formatDuration(row.awaySeconds)}`));
    return li;
  }

  function buriedRow(entry) {
    const li = doc.createElement('li');
    li.className = 'row';
    const date = formatBuriedDate(entry.buriedAt, locale);
    li.append(rowText(entry.title, entry.url, date ? `Buried ${date}` : 'Buried'));
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'reopen';
    button.textContent = 'Reopen';
    button.dataset.entryId = entry.id;
    button.setAttribute('aria-label', `Reopen ${displayTitle(entry.title, entry.url)}`);
    li.append(button);
    return li;
  }

  function renderLists(data) {
    if (data === listsFrom) return;
    listsFrom = data;
    el.deadList.replaceChildren(...(data ? data.dead.map(deadRow) : []));
    el.buriedList.replaceChildren(...(data ? data.buried.map(buriedRow) : []));
  }

  function render() {
    const data = state.phase === 'ready' ? state.data : null;
    const ready = data !== null;
    const busy = state.busy !== null;
    renderLists(data);

    // This tab
    let stageKey = state.phase;
    let stageText = state.phase === 'loading' ? TEXT.loading : TEXT.unreachable;
    let awayText = '';
    if (ready && !data.current.known) {
      stageKey = 'unknown';
      stageText = TEXT.notHaunted;
    } else if (ready) {
      stageKey = data.current.stage ?? 'unknown';
      stageText = STAGE_LABEL[data.current.stage] ?? TEXT.unknownStage;
      awayText = `Away for ${formatDuration(data.current.awaySeconds)}`;
    }
    el.current.dataset.stage = stageKey;
    el.currentStage.textContent = stageText;
    el.currentAway.textContent = awayText;
    el.currentAway.hidden = awayText === '';
    el.resurrect.disabled = !ready || !data.current.known || busy;

    // Graveyard
    const deadCount = ready ? data.dead.length : 0;
    el.deadList.hidden = deadCount === 0;
    el.deadEmpty.hidden = !ready || deadCount > 0;
    el.deadEmpty.textContent = ready && !data.rulesLoaded ? TEXT.rulesMissing : TEXT.noDead;
    el.bury.textContent = buryLabel(deadCount);
    el.bury.disabled = !ready || deadCount === 0 || busy;

    // Buried
    const buriedCount = ready ? data.buried.length : 0;
    el.buriedList.hidden = buriedCount === 0;
    el.buriedEmpty.hidden = !ready || buriedCount > 0;
    for (const button of el.buriedList.querySelectorAll('button[data-entry-id]')) button.disabled = !ready || busy;

    // Demo mode
    el.demo.checked = state.pendingDemo ?? (ready ? data.demoMode : false);
    el.demo.disabled = !ready || busy;

    if (state.notice) {
      el.notice.hidden = false;
      el.notice.dataset.kind = state.notice.kind;
      el.notice.textContent = state.notice.text;
    } else {
      el.notice.hidden = true;
      delete el.notice.dataset.kind;
      el.notice.textContent = '';
    }
    el.main.setAttribute('aria-busy', String(state.phase === 'loading' || busy));
  }

  async function load() {
    state.phase = 'loading';
    state.data = null;
    render();
    const tabId = await activeTabId();
    const data = tabId === null ? null : await fetchState(tabId);
    if (!data) {
      state.phase = 'error';
      render();
      return false;
    }
    Object.assign(state, { phase: 'ready', tabId, data });
    render();
    return true;
  }

  /**
   * Run one command. `accept(reply)` checks a successful reply and returns
   * { notice } or null when the reply is not the expected shape. On failure the
   * popup keeps the last confirmed state and shows a short error; on success it
   * re-requests the state before accepting another command.
   */
  async function command(kind, message, accept) {
    state.busy = kind;
    state.notice = null;
    render();

    const reply = await send(message);
    const outcome = reply.ok === true ? accept(reply) : null;
    if (!outcome) {
      state.busy = null;
      state.pendingDemo = null;
      state.notice = { kind: 'error', text: FAILURE_TEXT[kind] };
      render();
      return false;
    }

    const fresh = await fetchState(state.tabId);
    state.busy = null;
    state.pendingDemo = null;
    if (fresh) {
      state.data = fresh;
      state.notice = outcome.notice;
    } else {
      state.phase = 'error';
      state.data = null;
      state.notice = null;
    }
    render();
    return true;
  }

  const canCommand = () => state.phase === 'ready' && state.data !== null && state.busy === null;

  async function resurrect() {
    if (!canCommand() || !state.data.current.known) { render(); return false; }
    return command('resurrect', { type: POPUP_MESSAGE.RESURRECT_TAB, tabId: state.tabId }, (reply) => ({
      notice: reply.delivered === false ? { kind: 'warning', text: TEXT.undelivered } : null,
    }));
  }

  async function buryAll() {
    if (!canCommand() || state.data.dead.length === 0) { render(); return false; }
    const tabIds = state.data.dead.map((row) => row.tabId);
    return command('bury', { type: POPUP_MESSAGE.BURY, tabIds }, (reply) => {
      if (!Array.isArray(reply.buried) || !Array.isArray(reply.notClosed)) return null;
      const n = reply.notClosed.length;
      return { notice: n > 0 ? { kind: 'warning', text: notClosedText(n) } : null };
    });
  }

  async function reopen(entryId) {
    if (!canCommand() || !state.data.buried.some((entry) => entry.id === entryId)) { render(); return false; }
    return command('reopen', { type: POPUP_MESSAGE.REOPEN, entryId }, (reply) => ({
      notice: reply.entryRemoved === false ? { kind: 'warning', text: TEXT.reopenKept } : null,
    }));
  }

  async function setDemo(enabled) {
    if (!canCommand() || typeof enabled !== 'boolean' || enabled === state.data.demoMode) { render(); return false; }
    state.pendingDemo = enabled;
    return command('demo', { type: POPUP_MESSAGE.SET_DEMO, enabled }, (reply) => (reply.demoMode === enabled ? { notice: null } : null));
  }

  function onBuriedClick(event) {
    const button = event.target?.closest?.('button[data-entry-id]');
    if (!button || !el.buriedList.contains(button)) return undefined;
    return reopen(button.dataset.entryId);
  }

  function init() {
    el.resurrect.addEventListener('click', () => resurrect());
    el.bury.addEventListener('click', () => buryAll());
    el.buriedList.addEventListener('click', onBuriedClick);
    el.demo.addEventListener('change', () => setDemo(el.demo.checked));
    return load();
  }

  return { init, load, render, resurrect, buryAll, reopen, setDemo, state };
}

// Guarded bootstrap: runs only on the real extension page, not when imported by tests.
if (globalThis.chrome?.runtime?.id && globalThis.chrome?.tabs?.query && typeof document !== 'undefined') {
  const start = () => { void createPopup({ chrome: globalThis.chrome, document }).init(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
