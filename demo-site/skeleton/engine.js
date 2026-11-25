import { matchUrl } from './match.js';

export const DEFAULT_TICK_MS = 250;
const MIN_INTENSITY = 0.01;
const INTENSITY_EPSILON = 0.01; // don't re-apply for changes smaller than this

/** Map a meter value to 0..1 effect intensity for a rule trigger. */
export function computeIntensity(trigger, value) {
  if (trigger.rampTo === undefined || trigger.rampTo <= trigger.threshold) return 1;
  const t = (value - trigger.threshold) / (trigger.rampTo - trigger.threshold);
  return Math.min(1, Math.max(MIN_INTENSITY, t));
}

/**
 * @param {object} opts
 * @param {Array} opts.rules      validated rules (see validator.js)
 * @param {object} opts.meters    from createMeters()
 * @param {object} opts.effects   registry: name -> {apply, undo, description}
 * @param {object} opts.env       passed to effects: {window, document, reducedMotion, setTimeout, clearTimeout}
 * @param {() => string} opts.getUrl current page URL (re-read every tick, so SPA navigation works)
 * @param {number} [opts.tickMs]
 * @param {Function} [opts.onError]
 */
export function createEngine({
  rules,
  meters,
  effects,
  env,
  getUrl,
  tickMs = DEFAULT_TICK_MS,
  onError = (err, rule) => console.error(`[poltergeist] rule "${rule?.id}":`, err),
}) {
  /** ruleId -> {handle, intensity, effect} for rules currently applied */
  const active = new Map();
  /** ruleId -> {handle, effect} for rules mid-fade */
  const fading = new Map();
  let timer = null;

  const safe = (rule, fn) => {
    try {
      return fn();
    } catch (err) {
      onError(err, rule);
      return undefined;
    }
  };

  function finishFade(id) {
    const f = fading.get(id);
    if (!f) return;
    fading.delete(id);
    safe({ id }, () => f.effect.undo(f.handle, { durationMs: 0 }));
  }

  function remove(rule, state) {
    active.delete(rule.id);
    const durationMs = rule.undo.mode === 'fade' ? rule.undo.durationMs ?? 400 : 0;
    safe(rule, () => state.effect.undo(state.handle, { durationMs }));
    if (durationMs > 0) fading.set(rule.id, { handle: state.handle, effect: state.effect });
  }

  /** Run one evaluation pass. Returns what changed (useful for tests/debugging). */
  function tick() {
    const url = getUrl();
    const result = { applied: [], updated: [], undone: [] };
    const live = rules.filter((r) => r.enabled !== false);
    const urlMatched = new Map(live.map((r) => [r.id, matchUrl(r.match, url)]));

    meters.update([...urlMatched.values()].some(Boolean));
    const values = meters.values();

    for (const rule of live) {
      const value = values[rule.trigger.meter];
      const on = urlMatched.get(rule.id) && value >= rule.trigger.threshold;
      const state = active.get(rule.id);

      if (!on) {
        if (state) {
          remove(rule, state);
          result.undone.push(rule.id);
        }
        continue;
      }

      const effect = effects[rule.effect.type];
      if (!effect) continue;
      const intensity = computeIntensity(rule.trigger, value);

      if (!state) {
        finishFade(rule.id); // re-triggered mid-fade: settle the old one first
        const handle = safe(rule, () => effect.apply(env, rule.effect.params ?? {}, intensity));
        if (handle !== undefined) {
          active.set(rule.id, { handle, intensity, effect });
          result.applied.push(rule.id);
        }
      } else if (Math.abs(intensity - state.intensity) >= INTENSITY_EPSILON) {
        const handle = safe(rule, () => effect.apply(env, rule.effect.params ?? {}, intensity, state.handle));
        if (handle !== undefined) {
          state.handle = handle;
          state.intensity = intensity;
          result.updated.push(rule.id);
        }
      }
    }

    // Rules removed from the list (or disabled) while active get undone too.
    for (const [id, state] of [...active]) {
      if (!live.some((r) => r.id === id)) {
        active.delete(id);
        safe({ id }, () => state.effect.undo(state.handle, { durationMs: 0 }));
        result.undone.push(id);
      }
    }
    return result;
  }

  return {
    tick,
    start() {
      if (timer !== null) return;
      tick();
      timer = env.setInterval ? env.setInterval(tick, tickMs) : setInterval(tick, tickMs);
    },
    /** Stop ticking and undo every active effect. Safe to call repeatedly. */
    stop() {
      if (timer !== null) {
        (env.clearInterval ?? clearInterval)(timer);
        timer = null;
      }
      for (const rule of rules) {
        const state = active.get(rule.id);
        if (state) {
          active.delete(rule.id);
          safe(rule, () => state.effect.undo(state.handle, { durationMs: 0 }));
        }
      }
      for (const id of [...fading.keys()]) finishFade(id);
    },
    /** Rule ids currently applied. */
    activeRuleIds: () => [...active.keys()],
  };
}
