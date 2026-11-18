import { clamp01, teardown, handleState, LIVE } from './util.js';

export const description =
  'A full-page tombstone naming the page and how long it was left, with one action button; ' +
  'blocks interaction once intensity reaches blockAt.';

const DEFAULTS = {
  heading: 'Here lies {title}',
  message: 'Abandoned for {duration}.',
  actionLabel: 'Resurrect',
  action: 'resurrect',
  durationMeter: 'timeAway',
  maxOpacity: 0.96,
  blockAt: 1,
};

const Z_INDEX = '2147483647'; // same top layer as Block
const MAX_TITLE = 120;
const ELLIPSIS = '\u2026';

const HOST_CSS =
  'all:initial;position:fixed;inset:0;z-index:' + Z_INDEX + ';display:flex;align-items:center;' +
  'justify-content:center;background:rgba(12,12,14,0.92);opacity:0;pointer-events:none;';
const CARD_CSS =
  'box-sizing:border-box;max-width:min(32rem,90vw);padding:3rem 2.5rem 2rem;' +
  'border-radius:45% 45% 0.5rem 0.5rem / 25% 25% 0.5rem 0.5rem;background:#3a3a3f;' +
  'border:2px solid #55555c;color:#ece9e4;font:400 1rem/1.4 system-ui,sans-serif;text-align:center;';
const HEADING_CSS = 'margin:0 0 0.75rem;font:600 1.6rem/1.25 system-ui,sans-serif;overflow-wrap:anywhere;';
const MESSAGE_CSS = 'margin:0 0 1.5rem;font:400 1.1rem/1.4 system-ui,sans-serif;';
const BUTTON_CSS =
  'font:600 1rem system-ui,sans-serif;padding:0.6rem 1.4rem;border:0;border-radius:0.4rem;' +
  'background:#ece9e4;color:#1b1b1d;cursor:pointer;';

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** Format seconds per Requirement 4.5; non-finite input gives 'a while'. */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'a while';
  const s = Math.max(0, seconds);
  if (s < 60) return plural(Math.floor(s), 'second');
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 48 * 3600) return plural(Math.floor(s / 3600), 'hour');
  return plural(Math.floor(s / 86400), 'day');
}

/** Trimmed title, then hostname, then 'this page'; at most 120 characters. */
export function formatTitle(title, hostname) {
  const pick = [title, hostname].map((v) => (typeof v === 'string' ? v.trim() : '')).find(Boolean) ?? 'this page';
  const chars = Array.from(pick); // do not split surrogate pairs
  return chars.length > MAX_TITLE ? chars.slice(0, MAX_TITLE - 1).join('').trimEnd() + ELLIPSIS : pick;
}

// split/join, not String.replace: a page title containing "$&" must stay literal.
const fill = (template, values) =>
  Object.entries(values).reduce((s, [key, v]) => s.split(`{${key}}`).join(v), String(template));

function render(handle) {
  const { env, params } = handle;
  const doc = env.document;
  const read = typeof env.readMeter === 'function' ? env.readMeter(params.durationMeter) : undefined;
  const values = {
    title: formatTitle(doc.title, env.window?.location?.hostname),
    duration: formatDuration(read),
  };
  handle.headingEl.textContent = fill(params.heading, values);
  handle.messageEl.textContent = fill(params.message, values);
  handle.button.textContent = String(params.actionLabel);
}

function clearRenderTimer(handle) {
  if (handle.renderTimer !== null) {
    handle.env.clearTimeout(handle.renderTimer);
    handle.renderTimer = null;
  }
}

function removeListeners(handle) {
  handle.env.document.removeEventListener('visibilitychange', handle.onVisible);
  handle.button.removeEventListener('click', handle.onClick);
}

function create(env) {
  const doc = env.document;
  const host = doc.createElement('div');
  host.setAttribute('data-poltergeist', 'tombstone');
  host.style.cssText = HOST_CSS;
  const root = host.attachShadow({ mode: 'open' });

  const card = doc.createElement('div');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'poltergeist-tombstone-heading');
  card.style.cssText = CARD_CSS;
  const headingEl = doc.createElement('h1');
  headingEl.id = 'poltergeist-tombstone-heading';
  headingEl.style.cssText = HEADING_CSS;
  const messageEl = doc.createElement('p');
  messageEl.style.cssText = MESSAGE_CSS;
  const button = doc.createElement('button');
  button.type = 'button';
  button.style.cssText = BUTTON_CSS;
  card.append(headingEl, messageEl, button);
  root.appendChild(card);

  const handle = {
    env, host, root, headingEl, messageEl, button,
    params: { ...DEFAULTS },
    onClick: null, onVisible: null, renderTimer: null,
    dead: false, fading: false, timer: null,
  };

  handle.onClick = (event) => {
    if (!event || event.isTrusted !== true || handleState(handle) !== LIVE) return;
    const onAction = handle.env.onAction;
    if (typeof onAction !== 'function') return;
    try {
      onAction(String(handle.params.action));
    } catch (err) {
      console.error('[poltergeist] tombstone action:', err);
    }
  };
  // The meter's visibility listener was registered first, so by the next timer
  // turn the held value already includes the Absence that just ended.
  handle.onVisible = () => {
    if (doc.visibilityState !== 'visible' || handleState(handle) !== LIVE) return;
    clearRenderTimer(handle);
    handle.renderTimer = env.setTimeout(() => {
      handle.renderTimer = null;
      if (handleState(handle) === LIVE) render(handle);
    }, 0);
  };
  doc.addEventListener('visibilitychange', handle.onVisible);
  button.addEventListener('click', handle.onClick);
  doc.documentElement.appendChild(host);
  return handle;
}

export function apply(env, params = {}, intensity, handle) {
  const i = clamp01(intensity);
  if (!handle || handle.dead) handle = create(env);
  if (handleState(handle) !== LIVE) return handle;
  const p = { ...DEFAULTS, ...params };
  handle.params = p;
  handle.host.style.opacity = String((p.maxOpacity * i).toFixed(3));
  handle.host.style.pointerEvents = i >= p.blockAt ? 'auto' : 'none';
  render(handle);
  return handle;
}

export function undo(handle, { durationMs = 0 } = {}) {
  teardown(
    handle,
    durationMs,
    () => {
      removeListeners(handle);
      clearRenderTimer(handle);
      const s = handle.host.style;
      s.pointerEvents = 'none';
      s.transition = `opacity ${durationMs}ms linear`;
      s.opacity = '0';
    },
    () => {
      removeListeners(handle);
      clearRenderTimer(handle);
      handle.host.remove();
    },
  );
}
