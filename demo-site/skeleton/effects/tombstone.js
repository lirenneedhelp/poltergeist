import { clamp01, teardown, handleState, LIVE, fill, durationText, numberIn } from './util.js';

export { formatDuration } from './util.js';

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
  weathered: true,
  mark: 'R.I.P.',
  riseInMs: 800,
};

/** Resolve the haunt-polish visual params; any value outside its valid set uses the default. */
function resolve(params) {
  const p = { ...DEFAULTS, ...params };
  if (typeof p.weathered !== 'boolean') p.weathered = DEFAULTS.weathered;
  if (typeof p.mark !== 'string') p.mark = DEFAULTS.mark;
  p.riseInMs = numberIn(p.riseInMs, 0, 10000, DEFAULTS.riseInMs);
  return p;
}

const Z_INDEX = '2147483647'; // same top layer as Block
const MAX_TITLE = 120;
const ELLIPSIS = '\u2026';

const HOST_CSS =
  'all:initial;position:fixed;inset:0;z-index:' + Z_INDEX + ';display:flex;align-items:center;' +
  'justify-content:center;background:rgba(12,12,14,0.92);opacity:0;pointer-events:none;';
// Fixed px font sizes everywhere inside the shadow root (haunt-polish Requirement 3.5).
const CARD_BASE =
  'box-sizing:border-box;position:relative;overflow:hidden;max-width:min(32rem,90vw);padding:3rem 2.5rem 2rem;' +
  'border-radius:45% 45% 0.5rem 0.5rem / 25% 25% 0.5rem 0.5rem;color:#ece9e4;' +
  'font:400 16px/1.4 system-ui,sans-serif;text-align:center;';
const CARD_FLAT = CARD_BASE + 'background:#3a3a3f;border:2px solid #55555c;'; // pre-polish colour, border, corners
// Stone texture: every background image is a gradient, so nothing is loaded.
const STONE_IMAGE = [
  'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.08) 0 1px, transparent 2px)',
  'radial-gradient(circle at 70% 65%, rgba(0,0,0,0.22) 0 1.5px, transparent 2.5px)',
  'radial-gradient(ellipse at 20% 85%, rgba(0,0,0,0.28), transparent 55%)',
  'radial-gradient(ellipse at 80% 10%, rgba(255,255,255,0.10), transparent 50%)',
  'linear-gradient(170deg, #5a5a61 0%, #46464c 60%, #3b3b41 100%)',
].join(', ');
// Chipped section: a 34 x 26 px chip off the bottom-right corner and a 9 px notch in the left edge.
const CHIP_CLIP =
  'polygon(0 0, 100% 0, 100% calc(100% - 26px), calc(100% - 34px) 100%, 0 100%, ' +
  '0 calc(62% + 16px), 9px calc(62% + 7px), 0 62%)';
const CARD_STONE = CARD_BASE +
  'background-color:#4b4b51;background-image:' + STONE_IMAGE + ';' +
  'background-size:7px 7px, 11px 11px, 100% 100%, 100% 100%, 100% 100%;' +
  'border:2px solid #6c6c73;text-shadow:0 1px 0 rgba(0,0,0,0.55);clip-path:' + CHIP_CLIP + ';';
// Crack from the card's top edge; the card's overflow:hidden clips it to the arch.
const CRACK_CSS =
  'position:absolute;top:0;left:60%;width:34px;height:86px;' +
  'background-image:linear-gradient(180deg, rgba(14,14,16,0.95), rgba(14,14,16,0.35));' +
  'clip-path:polygon(44% 0, 60% 0, 52% 24%, 76% 44%, 54% 68%, 64% 100%, 56% 100%, 42% 70%, 62% 45%, 38% 25%);';
const MARK_CSS = 'margin:0 0 12px;font:600 22px/1 Georgia,serif;letter-spacing:6px;color:#d9d5cd;';
const HEADING_CSS = 'margin:0 0 0.75rem;font:600 30px/1.25 system-ui,sans-serif;overflow-wrap:anywhere;';
const MESSAGE_CSS = 'margin:0 0 1.5rem;font:400 20px/1.4 system-ui,sans-serif;';
const BUTTON_CSS =
  'font:600 17px system-ui,sans-serif;padding:0.6rem 1.4rem;border:0;border-radius:0.4rem;' +
  'background:#ece9e4;color:#1b1b1d;cursor:pointer;text-shadow:none;';
// Rise_In: the final keyframe equals the card's base style, so finish(), cancel(), and
// "no animation" all show the final state.
const RISE_KEYFRAMES = [
  { opacity: 0, transform: 'translateY(48px)' },
  { opacity: 1, transform: 'translateY(0px)' },
];
const RISE_TIMING = { easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', iterations: 1 }; // duration = riseInMs

/** Trimmed title, then hostname, then 'this page'; at most 120 characters. */
export function formatTitle(title, hostname) {
  const pick = [title, hostname].map((v) => (typeof v === 'string' ? v.trim() : '')).find(Boolean) ?? 'this page';
  const chars = Array.from(pick); // do not split surrogate pairs
  return chars.length > MAX_TITLE ? chars.slice(0, MAX_TITLE - 1).join('').trimEnd() + ELLIPSIS : pick;
}

// fill (util.js) uses split/join, not String.replace: a page title containing "$&" stays literal.
// {title} is filled before {duration}, so a {title} inside durationSuffix stays literal.
function render(handle) {
  const { env, params } = handle;
  const doc = env.document;
  const values = {
    title: formatTitle(doc.title, env.window?.location?.hostname),
    duration: durationText(env, params.durationMeter, params),
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

/** Mark text is literal (no placeholder replacement); '' removes the mark element. */
function syncMark(handle, mark) {
  if (mark === '') {
    if (handle.markEl) {
      handle.markEl.remove();
      handle.markEl = null;
    }
    return;
  }
  if (!handle.markEl) {
    const el = handle.env.document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = MARK_CSS;
    handle.card.insertBefore(el, handle.headingEl);
    handle.markEl = el;
  }
  handle.markEl.textContent = mark;
}

/** Start the Rise_In now if motion is allowed; jsdom and old engines have no animate(). */
function startRise(handle) {
  const ms = handle.params.riseInMs;
  if (handle.env.reducedMotion || !(ms > 0) || handle.rise) return;
  const card = handle.card;
  if (typeof card.animate !== 'function') return;
  handle.rise = card.animate(RISE_KEYFRAMES, { ...RISE_TIMING, duration: ms });
}

/** Called once, on creation: start at once when visible, else wait for the first visible moment. */
function startRiseOrDefer(handle) {
  if (handle.env.reducedMotion || !(handle.params.riseInMs > 0)) return;
  if (handle.env.document.visibilityState === 'visible') startRise(handle);
  else handle.risePending = true;
}

/** Jump a running Rise_In to its final state and drop any pending start; it never restarts. */
function endRise(handle) {
  handle.risePending = false;
  if (handle.rise) {
    handle.rise.finish();
    handle.rise = null;
  }
}

function create(env, p) {
  const doc = env.document;
  const host = doc.createElement('div');
  host.setAttribute('data-poltergeist', 'tombstone');
  host.style.cssText = HOST_CSS;
  const root = host.attachShadow({ mode: 'open' });

  const card = doc.createElement('div');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'poltergeist-tombstone-heading');
  card.style.cssText = p.weathered ? CARD_STONE : CARD_FLAT; // read once, at creation
  const headingEl = doc.createElement('h1');
  headingEl.id = 'poltergeist-tombstone-heading';
  headingEl.style.cssText = HEADING_CSS;
  const messageEl = doc.createElement('p');
  messageEl.style.cssText = MESSAGE_CSS;
  const button = doc.createElement('button');
  button.type = 'button';
  button.style.cssText = BUTTON_CSS;
  card.append(headingEl, messageEl, button);
  let crackEl = null;
  if (p.weathered) {
    crackEl = doc.createElement('div'); // decoration only: no child nodes, no text
    crackEl.setAttribute('aria-hidden', 'true');
    crackEl.style.cssText = CRACK_CSS;
    card.appendChild(crackEl);
  }
  root.appendChild(card);

  const handle = {
    env, host, root, card, headingEl, messageEl, button,
    markEl: null, crackEl,
    rise: null, risePending: false,
    params: p,
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
    if (handle.risePending) {
      // First visible moment after a hidden creation: start the Rise_In once.
      handle.risePending = false;
      startRise(handle); // re-checks reduced motion and riseInMs
    }
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

// apply never schedules a timer (haunt-polish Requirement 3.9): the Rise_In uses animate(),
// and a deferred start rides on the existing visibilitychange listener.
export function apply(env, params = {}, intensity, handle) {
  const i = clamp01(intensity);
  const p = resolve(params);
  const created = !handle || handle.dead;
  if (created) handle = create(env, p);
  if (handleState(handle) !== LIVE) return handle;
  handle.params = p;
  handle.host.style.opacity = String((p.maxOpacity * i).toFixed(3));
  handle.host.style.pointerEvents = i >= p.blockAt ? 'auto' : 'none';
  syncMark(handle, p.mark);
  render(handle);
  if (created) startRiseOrDefer(handle);
  else if (env.reducedMotion) endRise(handle);
  return handle;
}

export function undo(handle, { durationMs = 0 } = {}) {
  teardown(
    handle,
    durationMs,
    () => {
      removeListeners(handle);
      clearRenderTimer(handle);
      handle.risePending = false;
      const s = handle.host.style;
      s.pointerEvents = 'none';
      s.transition = `opacity ${durationMs}ms linear`;
      s.opacity = '0';
    },
    () => {
      removeListeners(handle);
      clearRenderTimer(handle);
      handle.risePending = false;
      if (handle.rise) {
        handle.rise.cancel();
        handle.rise = null;
      }
      handle.host.remove();
    },
  );
}
