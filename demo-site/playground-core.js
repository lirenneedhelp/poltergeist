// Haunt Playground logic. Importing this module has no side effects; playground.js
// boots it with the real page, and tests call createPlayground with a recording
// API and a fake fetch.
//
// All user-visible text is set with textContent. Every path is relative and inside
// demo-site/, and nothing here calls a chrome.* API.

export const MIN_SPEED = 1;
export const MAX_SPEED = 3600;

/** Matches the Playground's own URL wherever it is served (localhost, GitHub Pages, tests). */
const PLAYGROUND_MATCH = '<all_urls>';

export const DEFAULT_PRESETS = Object.freeze({
  doomscroll: Object.freeze({ label: 'Doomscroll', url: './presets/doomscroll.json' }),
  graveyard: Object.freeze({ label: 'Tab Graveyard', url: './presets/graveyard.json' }),
});

export const RITUAL_DONE_MESSAGE = 'The ghost is banished. The ritual is complete.';
const RITUAL_UNDO_MS = 600;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** An integer speed from 1 to 3600; anything else becomes 1. */
export function clampSpeed(n) {
  const v = typeof n === 'string' && n.trim() !== '' ? Number(n) : n;
  if (typeof v !== 'number' || !Number.isFinite(v)) return MIN_SPEED;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(v)));
}

/**
 * Deep clone of a rules document (array or { rules }) with every numeric
 * threshold and rampTo divided by speed and every match set to ['<all_urls>'].
 * The input is never modified.
 */
export function scaleRules(doc, speed) {
  const s = clampSpeed(speed);
  const out = clone(doc);
  const list = Array.isArray(out) ? out : isObj(out) && Array.isArray(out.rules) ? out.rules : [];
  for (const rule of list) {
    if (!isObj(rule)) continue;
    rule.match = [PLAYGROUND_MATCH];
    const t = rule.trigger;
    if (!isObj(t)) continue;
    if (typeof t.threshold === 'number') t.threshold /= s;
    if (typeof t.rampTo === 'number') t.rampTo /= s;
  }
  return out;
}

const TOPICS = [
  'cats', 'rain', 'coffee', 'trains', 'moss', 'lanterns', 'owls', 'tea', 'fog', 'ferns',
  'maps', 'clocks', 'piano', 'kites', 'bread', 'stars', 'rivers', 'books', 'snow', 'bees',
];
const WORDS = [
  'quietly', 'nobody', 'expected', 'the', 'feed', 'to', 'keep', 'going', 'another', 'scroll',
  'later', 'still', 'here', 'tiny', 'update', 'about', 'nothing', 'much', 'just', 'one', 'more',
  'video', 'thread', 'photo', 'reply', 'everyone', 'agrees', 'this', 'is', 'fine',
];
const AUTHORS = ['@pale_lantern', '@mossy_owl', '@night_train', '@fernhollow', '@quiet_clock'];

function sentence(seed, length) {
  const words = [];
  for (let k = 0; k < length; k++) words.push(WORDS[(seed * 7 + k * 13) % WORDS.length]);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

/** Fill `container` with `count` fake posts (deterministic text, textContent only). */
export function renderFeed(document, container, count = 24) {
  const posts = [];
  for (let i = 0; i < count; i++) {
    const article = document.createElement('article');
    article.className = 'post';
    const title = document.createElement('h2');
    title.textContent = `Post ${i + 1}: thoughts on ${TOPICS[i % TOPICS.length]}`;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${AUTHORS[i % AUTHORS.length]} · ${(i % 11) + 1} min ago`;
    const body = document.createElement('p');
    body.textContent = `${sentence(i, 14)} ${sentence(i + 3, 18)} ${sentence(i + 5, 11)}`;
    article.append(title, meta, body);
    posts.push(article);
  }
  container.replaceChildren(...posts);
  return posts;
}

function required(document, id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Haunt Playground: missing #${id}`);
  return el;
}

/**
 * Wire the page. `api` is the skeleton module (startPoltergeist, validateRules,
 * builtinEffects). Returns { apply, stop, loadPreset, setSpeed, tryRitual, state }.
 */
export function createPlayground({ document, window, api, fetch, presets = DEFAULT_PRESETS }) {
  const els = {
    feed: required(document, 'feed'),
    panel: required(document, 'panel'),
    speed: required(document, 'speed'),
    speedValue: required(document, 'speed-value'),
    rules: required(document, 'rules'),
    apply: required(document, 'apply'),
    stop: required(document, 'stop'),
    errors: required(document, 'errors'),
    tryRitual: required(document, 'try-ritual'),
    ritualStatus: required(document, 'ritual-status'),
    presetDoomscroll: required(document, 'preset-doomscroll'),
    presetGraveyard: required(document, 'preset-graveyard'),
  };

  const state = {
    ghost: null, // running startPoltergeist result
    lastAccepted: null, // deep clone of the last document validateRules accepted
    speed: clampSpeed(els.speed.value),
    trial: null, // live "Try the ritual" handle
  };

  const showErrors = (lines) => {
    els.errors.replaceChildren(
      ...lines.map((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        return li;
      }),
    );
  };
  const clearErrors = () => els.errors.replaceChildren();
  const showSpeed = (n) => {
    els.speedValue.textContent = `${n}×`;
  };

  function stop() {
    const ghost = state.ghost;
    state.ghost = null;
    if (ghost) {
      try {
        ghost.stop(); // undoes every effect with duration 0
      } catch (err) {
        console.error('[poltergeist:playground] stop failed:', err);
      }
    }
  }

  /** Haunt actions mirror the apps, so a finished ritual or tombstone never traps the page. */
  function onHauntAction(entry, name) {
    if (state.ghost !== entry.ghost || !entry.ghost) return; // stale instance
    const meter = name === 'exorcised' ? 'timeOnSite' : name === 'resurrect' ? 'timeAway' : null;
    if (!meter) return;
    if (entry.ghost.meters.reset(meter) === true) entry.ghost.engine.tick();
  }

  /** Stop the running haunt and start one from `doc` at the current speed. */
  function start(doc) {
    stop();
    const entry = { ghost: null };
    try {
      entry.ghost = api.startPoltergeist({
        rules: scaleRules(doc, state.speed),
        window,
        document,
        onAction: (name) => onHauntAction(entry, name),
      });
      state.ghost = entry.ghost;
      return true;
    } catch (err) {
      showErrors([`Could not start the haunt: ${err && err.message ? err.message : String(err)}`]);
      return false;
    }
  }

  /** Validate the editor content; start it, or show errors and change nothing. */
  function apply() {
    let doc;
    try {
      doc = JSON.parse(els.rules.value);
    } catch (err) {
      showErrors([`JSON: ${err && err.message ? err.message : String(err)}`]);
      return false;
    }
    const result = api.validateRules(doc, api.builtinEffects);
    if (!result.valid) {
      showErrors(result.errors.length ? result.errors : ['Rules: invalid']);
      return false;
    }
    clearErrors();
    state.lastAccepted = clone(doc);
    return start(state.lastAccepted);
  }

  /** Set the speed (integer 1..3600) and restart from the last accepted rules. */
  function setSpeed(n) {
    const s = clampSpeed(n);
    state.speed = s;
    els.speed.value = String(s);
    showSpeed(s);
    if (state.lastAccepted) return start(state.lastAccepted);
    return true;
  }

  /** Load a preset into the editor and apply it; on a load failure change nothing. */
  async function loadPreset(key) {
    const preset = Object.hasOwn(presets, key) ? presets[key] : null;
    if (!preset) {
      showErrors([`Unknown preset: ${String(key)}`]);
      return false;
    }
    let text;
    try {
      const res = await fetch(preset.url);
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'error'}`);
      text = await res.text();
    } catch (err) {
      console.error(`[poltergeist:playground] preset ${key}:`, err);
      showErrors([`Could not load the ${preset.label} preset.`]);
      return false;
    }
    els.rules.value = text;
    return apply();
  }

  /** Show the ritual at intensity 1; when it is finished, undo it and say so. */
  function tryRitual() {
    if (state.trial) return state.trial;
    const ritual = api.builtinEffects && api.builtinEffects.ritual;
    if (!ritual) {
      els.ritualStatus.textContent = 'The ritual effect is not available.';
      return null;
    }
    const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let handle = null;
    let done = false;
    const env = {
      window,
      document,
      get reducedMotion() {
        return Boolean(motionQuery && motionQuery.matches);
      },
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      readMeter: () => undefined,
      onAction: (name) => {
        if (name !== 'exorcised' || done) return;
        done = true;
        // Safe from inside the ritual's own callback (design decision 6).
        if (handle) ritual.undo(handle, { durationMs: RITUAL_UNDO_MS });
        if (state.trial === handle) state.trial = null;
        els.ritualStatus.textContent = RITUAL_DONE_MESSAGE;
      },
    };
    els.ritualStatus.textContent = '';
    handle = ritual.apply(env, {}, 1);
    state.trial = handle;
    return handle;
  }

  // Wiring.
  renderFeed(document, els.feed);
  showSpeed(state.speed);
  try {
    if (typeof els.panel.showPopover === 'function' && !els.panel.matches(':popover-open')) {
      els.panel.showPopover();
    }
  } catch (err) {
    console.error('[poltergeist:playground] could not show the control panel:', err);
  }

  els.apply.addEventListener('click', () => apply());
  els.stop.addEventListener('click', () => stop());
  els.speed.addEventListener('input', () => showSpeed(clampSpeed(els.speed.value)));
  els.speed.addEventListener('change', () => setSpeed(els.speed.value));
  els.presetDoomscroll.addEventListener('click', () => loadPreset('doomscroll'));
  els.presetGraveyard.addEventListener('click', () => loadPreset('graveyard'));
  els.tryRitual.addEventListener('click', () => tryRitual());

  return {
    apply,
    stop,
    loadPreset,
    setSpeed,
    tryRitual,
    state: () => ({ ...state }),
  };
}
