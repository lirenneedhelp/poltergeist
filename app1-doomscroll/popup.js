// Doomscroll App popup. Talks only to the service worker through the enumerated
// protocol in background.js. It reads the active tab's id and nothing else from
// the tab (no url, title, pendingUrl, or favIconUrl).

// Kept in sync with MESSAGE in background.js. Importing background.js here would
// register a second set of worker listeners inside the popup page.
export const POPUP_MESSAGE = Object.freeze({
  POPUP_STATE: 'doomscroll:popup-state',
  SET_PAUSED: 'doomscroll:set-paused',
  SET_DEMO: 'doomscroll:set-demo',
});

export const TEXT = Object.freeze({
  loading: 'Checking this tab…',
  active: 'Active on this tab (normal timing).',
  demo: 'Active on this tab (demo timing).',
  paused: 'Paused on this tab.',
  unsupported: 'Not available on this tab.',
  error: 'Could not reach Poltergeist. Close and reopen this popup.',
  saveFailed: 'Could not save that change. Try again.',
  undelivered: 'Saved, but this tab is not responding. It applies when the page reloads.',
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTabId = (v) => Number.isInteger(v) && v >= 0;

/**
 * Build the popup controller around injected Chrome and DOM objects so it can
 * be exercised in tests. Nothing runs until init() is called.
 */
export function createPopup({ chrome: chromeApi, document: doc }) {
  const el = {
    status: doc.getElementById('status'),
    statusText: doc.getElementById('status-text'),
    notice: doc.getElementById('notice'),
    pause: doc.getElementById('pause'),
    demo: doc.getElementById('demo'),
  };

  // Last values confirmed by the worker; the controls roll back to these.
  const state = {
    phase: 'loading', // 'loading' | 'ready' | 'error'
    tabId: null,
    supported: false,
    paused: false,
    demoMode: false,
    // Requested value while a command is in flight, otherwise null.
    pending: { pause: null, demo: null },
    notice: null, // null | { kind: 'error' | 'unavailable', text }
  };

  async function send(message) {
    try {
      const reply = await chromeApi.runtime.sendMessage(message);
      return isObject(reply) ? reply : { ok: false, error: 'no response' };
    } catch {
      return { ok: false, error: 'no response' };
    }
  }

  function statusKey() {
    if (state.phase !== 'ready') return state.phase;
    if (!state.supported) return 'unsupported';
    if (state.paused) return 'paused';
    return state.demoMode ? 'demo' : 'active';
  }

  function render() {
    const key = statusKey();
    el.status.dataset.state = key;
    el.statusText.textContent = TEXT[key];

    if (state.notice) {
      el.notice.hidden = false;
      el.notice.dataset.kind = state.notice.kind;
      el.notice.textContent = state.notice.text;
    } else {
      el.notice.hidden = true;
      delete el.notice.dataset.kind;
      el.notice.textContent = '';
    }

    const ready = state.phase === 'ready';
    const pausePending = state.pending.pause !== null;
    const demoPending = state.pending.demo !== null;
    el.pause.checked = pausePending ? state.pending.pause : state.paused;
    el.demo.checked = demoPending ? state.pending.demo : state.demoMode;
    // Only pause depends on this tab's content script; demo is global.
    el.pause.disabled = !ready || !state.supported || pausePending;
    el.demo.disabled = !ready || demoPending;
    el.pause.setAttribute('aria-busy', String(pausePending));
    el.demo.setAttribute('aria-busy', String(demoPending));
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

  async function load() {
    state.phase = 'loading';
    render();
    const tabId = await activeTabId();
    if (tabId === null) {
      state.phase = 'error';
      render();
      return;
    }
    const reply = await send({ type: POPUP_MESSAGE.POPUP_STATE, tabId });
    if (reply.ok !== true || typeof reply.paused !== 'boolean' || typeof reply.demoMode !== 'boolean') {
      state.phase = 'error';
      render();
      return;
    }
    Object.assign(state, {
      phase: 'ready',
      tabId,
      supported: reply.supported === true,
      paused: reply.paused,
      demoMode: reply.demoMode,
    });
    render();
  }

  async function changePaused(paused) {
    if (state.phase !== 'ready' || !state.supported || state.pending.pause !== null) { render(); return; }
    if (typeof paused !== 'boolean' || paused === state.paused) { render(); return; }
    state.pending.pause = paused;
    state.notice = null;
    render();

    const reply = await send({ type: POPUP_MESSAGE.SET_PAUSED, tabId: state.tabId, paused });
    state.pending.pause = null;
    if (reply.ok === true && reply.paused === paused) {
      state.paused = paused;
      if (reply.delivered === false) state.notice = { kind: 'unavailable', text: TEXT.undelivered };
    } else {
      state.notice = { kind: 'error', text: TEXT.saveFailed }; // roll back to confirmed
    }
    render();
  }

  async function changeDemo(enabled) {
    if (state.phase !== 'ready' || state.pending.demo !== null) { render(); return; }
    if (typeof enabled !== 'boolean' || enabled === state.demoMode) { render(); return; }
    state.pending.demo = enabled;
    state.notice = null;
    render();

    const reply = await send({ type: POPUP_MESSAGE.SET_DEMO, enabled });
    state.pending.demo = null;
    if (reply.ok === true && reply.demoMode === enabled) state.demoMode = enabled;
    else state.notice = { kind: 'error', text: TEXT.saveFailed };
    render();
  }

  function onPauseChange() { return changePaused(el.pause.checked); }
  function onDemoChange() { return changeDemo(el.demo.checked); }

  function init() {
    el.pause.addEventListener('change', onPauseChange);
    el.demo.addEventListener('change', onDemoChange);
    doc.getElementById('controls')?.addEventListener('submit', (event) => event.preventDefault());
    return load();
  }

  return { init, load, changePaused, changeDemo, render, state };
}

// Guarded bootstrap: runs only on the real extension page, not when imported by tests.
if (globalThis.chrome?.runtime?.id && globalThis.chrome?.tabs?.query && typeof document !== 'undefined') {
  const start = () => { void createPopup({ chrome: globalThis.chrome, document }).init(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
