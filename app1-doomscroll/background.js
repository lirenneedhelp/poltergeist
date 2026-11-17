// Doomscroll App service worker (Manifest V3 module worker).
// Owns control state only: one session-scoped pause key per tab and one global
// demo Boolean. Stored values never contain URLs, page text, history, or meters.

export const MESSAGE = Object.freeze({
  CONTENT_STATE: 'doomscroll:content-state', // content -> worker
  POPUP_STATE: 'doomscroll:popup-state', //     popup -> worker
  SET_PAUSED: 'doomscroll:set-paused', //       popup/extension page -> worker
  SET_DEMO: 'doomscroll:set-demo', //           popup -> worker
  APPLY_PAUSED: 'doomscroll:apply-paused', //   worker -> content
  PING: 'doomscroll:ping', //                   worker -> content
});

export const PAUSE_KEY_PREFIX = 'doomscroll.pausedTab.';
export const DEMO_KEY = 'doomscroll.demoMode';
const LOG_PREFIX = '[poltergeist:doomscroll]';

/** Session-storage key for one tab's pause flag. */
export function pauseKey(tabId) {
  return `${PAUSE_KEY_PREFIX}${tabId}`;
}

/** Tab ids are non-negative integers; chrome.tabs.TAB_ID_NONE (-1) is not a tab. */
export function isTabId(value) {
  return Number.isInteger(value) && value >= 0;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (error) => ({ ok: false, error });

/**
 * Build the message dispatcher around an injected Chrome API object so it can be
 * tested with mocks. Nothing is registered here; see registerBackground.
 */
export function createBackground(chromeApi) {
  const session = chromeApi.storage.session;
  const local = chromeApi.storage.local;
  const tabs = chromeApi.tabs;
  const runtime = chromeApi.runtime;

  async function readPaused(tabId) {
    const key = pauseKey(tabId);
    const record = await session.get(key);
    // Only an exact `true` counts; missing or malformed values mean unpaused.
    return isObject(record) && record[key] === true;
  }

  async function readDemo() {
    const record = await local.get(DEMO_KEY);
    const value = isObject(record) ? record[DEMO_KEY] : undefined;
    return typeof value === 'boolean' ? value : false;
  }

  /** Send a message to a tab's top-frame content script; resolves undefined if no receiver. */
  async function sendToTab(tabId, message) {
    try {
      return await tabs.sendMessage(tabId, message, { frameId: 0 });
    } catch {
      return undefined;
    }
  }

  /** True for this extension's own pages (popup, control page), false for content scripts. */
  function isExtensionPage(sender) {
    if (!isObject(sender) || sender.id !== runtime.id) return false;
    const base = runtime.getURL('');
    return typeof sender.url === 'string' && sender.url.startsWith(base);
  }

  async function contentState(sender) {
    // Derive the tab from the sender; any payload tab id is ignored.
    const tabId = sender?.tab?.id;
    if (!isObject(sender) || sender.id !== runtime.id || !isTabId(tabId)) {
      return fail('content-state requires a content-script sender');
    }
    const [paused, demoMode] = await Promise.all([readPaused(tabId), readDemo()]);
    return { ok: true, paused, demoMode };
  }

  async function popupState(message, sender) {
    if (!isExtensionPage(sender)) return fail('popup-state requires an extension page sender');
    if (!isTabId(message.tabId)) return fail('tabId must be a non-negative integer');
    const [paused, demoMode, pong] = await Promise.all([
      readPaused(message.tabId),
      readDemo(),
      sendToTab(message.tabId, { type: MESSAGE.PING }),
    ]);
    return { ok: true, supported: isObject(pong) && pong.ok === true, paused, demoMode };
  }

  async function setPaused(message, sender) {
    if (!isExtensionPage(sender)) return fail('set-paused requires an extension page sender');
    const { tabId, paused } = message;
    if (!isTabId(tabId)) return fail('tabId must be a non-negative integer');
    if (typeof paused !== 'boolean') return fail('paused must be a Boolean');

    // Commit first; an independent key per tab avoids shared read/modify/write races.
    const key = pauseKey(tabId);
    try {
      if (paused) await session.set({ [key]: true });
      else await session.remove(key);
    } catch {
      return fail('could not save pause state');
    }

    const reply = await sendToTab(tabId, { type: MESSAGE.APPLY_PAUSED, paused });
    return { ok: true, paused, delivered: isObject(reply) && reply.ok === true };
  }

  async function setDemo(message, sender) {
    if (!isExtensionPage(sender)) return fail('set-demo requires an extension page sender');
    if (typeof message.enabled !== 'boolean') return fail('enabled must be a Boolean');
    try {
      await local.set({ [DEMO_KEY]: message.enabled });
    } catch {
      return fail('could not save demo mode');
    }
    // Content scripts converge through chrome.storage.onChanged.
    return { ok: true, demoMode: message.enabled };
  }

  /** Dispatch one message. Always resolves to {ok:true,...} or {ok:false,error}. */
  async function handleMessage(message, sender) {
    if (!isObject(message) || typeof message.type !== 'string') return fail('malformed message');
    try {
      switch (message.type) {
        case MESSAGE.CONTENT_STATE: return await contentState(sender);
        case MESSAGE.POPUP_STATE: return await popupState(message, sender);
        case MESSAGE.SET_PAUSED: return await setPaused(message, sender);
        case MESSAGE.SET_DEMO: return await setDemo(message, sender);
        case MESSAGE.APPLY_PAUSED:
        case MESSAGE.PING:
          return fail(`${message.type} is handled by content scripts`);
        default:
          return fail('unknown message type');
      }
    } catch (err) {
      console.error(LOG_PREFIX, `${message.type} failed:`, err?.message ?? String(err));
      return fail('internal error');
    }
  }

  /** Remove only the closed tab's pause key. */
  async function handleTabRemoved(tabId) {
    if (!isTabId(tabId)) return;
    try {
      await session.remove(pauseKey(tabId));
    } catch (err) {
      console.error(LOG_PREFIX, 'could not clear pause state:', err?.message ?? String(err));
    }
  }

  /** runtime.onMessage listener: returns true and responds asynchronously (MV3 pattern). */
  function onMessage(message, sender, sendResponse) {
    handleMessage(message, sender).then(sendResponse, () => sendResponse(fail('internal error')));
    return true;
  }

  return { handleMessage, handleTabRemoved, onMessage, readPaused, readDemo };
}

/** Register the worker listeners on a Chrome API object; returns the dispatcher. */
export function registerBackground(chromeApi) {
  const background = createBackground(chromeApi);
  chromeApi.runtime.onMessage.addListener(background.onMessage);
  chromeApi.tabs.onRemoved.addListener((tabId) => { void background.handleTabRemoved(tabId); });
  return background;
}

// Listeners must be registered synchronously at top level so a restarted
// worker receives the event that woke it.
if (globalThis.chrome?.runtime?.onMessage && globalThis.chrome?.tabs?.onRemoved) {
  registerBackground(globalThis.chrome);
}
