import { createEngine, DEFAULT_TICK_MS } from './engine.js';
import { createMeters } from './meters.js';
import { builtinEffects } from './effects/index.js';
import { validateRules } from './validator.js';

export { createEngine, createMeters, builtinEffects, validateRules, DEFAULT_TICK_MS };
export { validateRule } from './validator.js';
export { matchUrl } from './match.js';

/**
 * One-call setup for a content script.
 *   const ghost = startPoltergeist({ rules: await (await fetch(chrome.runtime.getURL('rules.json'))).json() });
 * Throws if the rules are invalid. Returns {engine, meters, stop}.
 * Optional onAction(name) receives actions reported by effects (e.g. the tombstone button).
 */
export function startPoltergeist({
  rules: rulesDoc,
  window: win = globalThis.window,
  document: doc = win.document,
  effects = builtinEffects,
  tickMs = DEFAULT_TICK_MS,
  initialMeters,
  onAction,
} = {}) {
  const { valid, errors, rules } = validateRules(rulesDoc, effects);
  if (!valid) throw new Error(`Invalid Poltergeist rules:\n${errors.join('\n')}`);

  const motionQuery = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let meters; // assigned below; readMeter reads it lazily
  const env = {
    window: win,
    document: doc,
    // Getter so a mid-session OS setting change is picked up by the next apply().
    get reducedMotion() {
      return Boolean(motionQuery?.matches);
    },
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
    clearTimeout: (id) => win.clearTimeout(id),
    setInterval: (fn, ms) => win.setInterval(fn, ms),
    clearInterval: (id) => win.clearInterval(id),
    readMeter: (name) => meters?.values()[name],
    onAction: (name) => {
      if (typeof onAction !== 'function') return;
      try {
        onAction(name);
      } catch (err) {
        console.error('[poltergeist] onAction:', err);
      }
    },
  };

  meters = createMeters({ window: win, document: doc, initial: initialMeters });
  const engine = createEngine({ rules, meters, effects, env, getUrl: () => win.location.href, tickMs });
  const stop = () => {
    engine.stop();
    meters.dispose();
    win.removeEventListener('pagehide', stop);
  };
  win.addEventListener('pagehide', stop); // never leave a haunt behind
  engine.start();
  return { engine, meters, stop };
}
