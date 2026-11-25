// Doomscroll App content script (classic, isolated world, top frame only).
//
// This file must stay a classic script: Chrome loads `content_scripts` as
// classic scripts, so the ES-module skeleton is loaded later with a dynamic
// import of a runtime URL. There are no static module declarations here.
//
// The two top-level function declarations below are visible only inside the
// extension's isolated world (and to tests that evaluate this file in a VM
// context). The page cannot see them. All asynchronous work starts from the
// contained async bootstrap at the bottom of the file.

/**
 * Build the Demo_Profile from the Normal_Profile: a deep clone whose trigger
 * `threshold` and `rampTo` are divided by exactly 60. The input is not mutated.
 * Accepts either `{ rules: [...] }` or a bare rule array, like the validator.
 * Rules whose params name a string `durationMeter` also get `durationScale`
 * and `durationSuffix` so their `{duration}` text reads in demo time.
 */
function doomscrollCreateDemoProfile(normalDocument) {
  const DEMO_TIME_SCALE = 60;
  const DEMO_SUFFIX = ' (demo time)';
  const demo = typeof structuredClone === 'function'
    ? structuredClone(normalDocument)
    : JSON.parse(JSON.stringify(normalDocument));
  const rules = Array.isArray(demo) ? demo : demo && Array.isArray(demo.rules) ? demo.rules : [];
  for (const rule of rules) {
    const trigger = rule && rule.trigger;
    if (trigger && typeof trigger === 'object') {
      if (typeof trigger.threshold === 'number') trigger.threshold /= DEMO_TIME_SCALE;
      if (typeof trigger.rampTo === 'number') trigger.rampTo /= DEMO_TIME_SCALE;
    }
    // Duration_Rule: params name a string durationMeter. Its {duration} reads in demo time.
    const effect = rule && rule.effect;
    const params = effect && typeof effect === 'object' ? effect.params : undefined;
    if (params && typeof params === 'object' && !Array.isArray(params) && typeof params.durationMeter === 'string') {
      params.durationScale = DEMO_TIME_SCALE;
      params.durationSuffix = DEMO_SUFFIX;
    }
  }
  return demo;
}

/**
 * Runtime Controller: owns profile selection, meter snapshots, and at most one
 * live Poltergeist instance for this document.
 *
 * @param {object} deps
 * @param {() => Promise<{ api: { startPoltergeist: Function, validateRules: Function, builtinEffects: object }, normalProfile: object }>} deps.loadPackage
 *   Resolves the dynamically imported skeleton API and the parsed rules.json.
 *   Expected to cache its own Promise so repeated starts do not refetch.
 * @param {(kind: string, message: string, error?: unknown) => void} [deps.report]
 *   Diagnostic sink. Called at most once per failure kind.
 */
function doomscrollCreateController({ loadPackage, report = () => {} } = {}) {
  const zeroMeters = () => ({ timeOnSite: 0, scrollDistance: 0 });
  const clone = (value) => (typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)));

  const state = {
    desired: { paused: undefined, demoMode: undefined }, // undefined = not yet confirmed
    revisions: { paused: 0, demoMode: 0 },
    current: null, // { mode: 'normal' | 'demo', ghost, demoEpoch }
    normalSnapshot: zeroMeters(),
    demoSnapshot: zeroMeters(),
    demoEpoch: 0, // bumps on every actual demo Boolean transition
    generation: 0,
    queue: Promise.resolve(),
    restartForMotion: false,
    disposed: false,
    fault: null,
  };
  const reported = new Set();

  function reportOnce(kind, message, error) {
    if (reported.has(kind)) return;
    reported.add(kind);
    try {
      report(kind, message, error);
    } catch {
      // A broken diagnostic sink must not break reconciliation.
    }
  }

  /** Copy only the two seedable meters; timeSinceActive is derived and never carried. */
  function captureMeters(ghost) {
    const values = ghost && ghost.meters && typeof ghost.meters.values === 'function'
      ? ghost.meters.values()
      : {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return { timeOnSite: num(values.timeOnSite), scrollDistance: num(values.scrollDistance) };
  }

  /** 'paused' | 'normal' | 'demo', or undefined while either field is unconfirmed. */
  function desiredMode() {
    const { paused, demoMode } = state.desired;
    if (typeof paused !== 'boolean' || typeof demoMode !== 'boolean') return undefined;
    if (paused) return 'paused';
    return demoMode ? 'demo' : 'normal';
  }

  /** Stop the owned instance. Returns false (and faults) if its stop() threw. */
  function stopCurrent() {
    const cur = state.current;
    if (!cur) return true;
    if (cur.mode === 'normal') {
      state.normalSnapshot = captureMeters(cur.ghost);
    } else if (cur.demoEpoch === state.demoEpoch && state.desired.demoMode === true) {
      // Only an uninterrupted enabled demo session keeps its progress.
      state.demoSnapshot = captureMeters(cur.ghost);
    }
    try {
      cur.ghost.stop();
    } catch (error) {
      // Keep ownership: the instance may still be live, so never start another.
      state.fault = { kind: 'stop', error };
      reportOnce('stop', 'stopping the haunt failed; Doomscroll is halted on this page', error);
      return false;
    }
    state.current = null;
    return true;
  }

  async function reconcile() {
    if (state.disposed || state.fault) return;
    const mode = desiredMode();
    if (mode === undefined) return;

    const restart = state.restartForMotion;
    state.restartForMotion = false;
    const cur = state.current;
    if (cur && cur.mode === mode && !restart && (mode !== 'demo' || cur.demoEpoch === state.demoEpoch)) {
      return; // already running the desired profile
    }
    if (!stopCurrent()) return;
    if (mode === 'paused') return;

    const generation = state.generation;
    let pkg;
    try {
      pkg = await loadPackage();
    } catch (error) {
      reportOnce('load', 'could not load the Poltergeist package', error);
      return;
    }
    // Obsolete work: a newer queued reconciliation owns the next decision.
    if (generation !== state.generation || state.disposed || state.fault || state.current) return;

    const { api, normalProfile } = pkg;
    const rules = mode === 'demo' ? doomscrollCreateDemoProfile(normalProfile) : clone(normalProfile);
    const result = api.validateRules(rules, api.builtinEffects);
    if (!result || !result.valid) {
      const errors = result && Array.isArray(result.errors) ? result.errors.join('; ') : 'unknown error';
      reportOnce(`validate-${mode}`, `${mode} rules are invalid: ${errors}`);
      return;
    }

    const demoEpoch = state.demoEpoch;
    const seed = mode === 'demo' ? state.demoSnapshot : state.normalSnapshot;
    // The entry is created first so the onAction closure can tell whether the
    // instance that fired an action is still the current one.
    const entry = { mode, ghost: null, demoEpoch };
    let ghost;
    try {
      ghost = api.startPoltergeist({
        rules,
        initialMeters: { ...seed },
        onAction: (name) => handleAction(entry, name),
      });
    } catch (error) {
      // No instance was returned, so there is nothing this app can claim to clean up.
      state.fault = { kind: 'start', error };
      reportOnce('start', 'starting the haunt failed; Doomscroll is halted on this page', error);
      return;
    }
    entry.ghost = ghost;
    state.current = entry;
  }

  /**
   * Exorcised_Action from a ritual: reset timeOnSite on the same instance so the
   * engine undoes every rule with its own undo mode. Every other action name,
   * and every stale or disposed instance, is ignored. Never throws.
   */
  function handleAction(entry, name) {
    if (name !== 'exorcised') return;
    if (state.disposed || state.current !== entry || !entry.ghost) return;
    let ok = false;
    try {
      ok = entry.ghost.meters.reset('timeOnSite') === true;
    } catch (error) {
      reportOnce('reset', 'resetting time on site after the ritual failed', error);
      return;
    }
    if (!ok) {
      reportOnce('reset', 'resetting time on site after the ritual failed');
      return;
    }
    try {
      // Apply the reset now instead of up to one tick interval later.
      entry.ghost.engine.tick();
    } catch (error) {
      reportOnce('reset-tick', 'applying the reset failed; it applies on the next tick', error);
    }
  }

  /** Append one reconciliation to the serialized queue. */
  function enqueue() {
    state.generation += 1;
    const run = state.queue.then(reconcile).catch((error) => {
      reportOnce('reconcile', 'unexpected reconciliation failure', error);
    });
    state.queue = run;
    return run;
  }

  /** Apply a desired demo value, resetting demo progress on every actual transition. */
  function assignDemo(value) {
    const previous = state.desired.demoMode;
    if (typeof previous === 'boolean' && previous !== value) {
      state.demoSnapshot = zeroMeters();
      state.demoEpoch += 1;
    }
    state.desired.demoMode = value;
  }

  return {
    /** Live pause event (message from the service worker). */
    setPaused(paused) {
      if (typeof paused !== 'boolean' || state.disposed) return state.queue;
      state.revisions.paused += 1;
      state.desired.paused = paused;
      return enqueue();
    },

    /** Live demo event (storage.onChanged). */
    setDemoMode(demoMode) {
      if (typeof demoMode !== 'boolean' || state.disposed) return state.queue;
      state.revisions.demoMode += 1;
      assignDemo(demoMode);
      return enqueue();
    },

    /** Capture field revisions before requesting the initial state. */
    captureRevisions() {
      return { ...state.revisions };
    },

    /**
     * Merge the initial service-worker response. Each field is assigned only if
     * no live event changed it since `captured`, so newer events always win.
     */
    applyInitialState({ paused, demoMode } = {}, captured = { paused: 0, demoMode: 0 }) {
      if (state.disposed) return state.queue;
      if (typeof paused === 'boolean' && state.revisions.paused === captured.paused) {
        state.desired.paused = paused;
      }
      if (typeof demoMode === 'boolean' && state.revisions.demoMode === captured.demoMode) {
        assignDemo(demoMode);
      }
      return enqueue();
    },

    /** The reduced-motion preference changed; recreate the active profile so Flicker re-reads it. */
    motionChanged() {
      if (state.disposed) return state.queue;
      // While paused (or not yet started) the next start reads the current preference.
      if (desiredMode() === 'paused' || desiredMode() === undefined) return state.queue;
      state.restartForMotion = true;
      return enqueue();
    },

    /**
     * pagehide: stop all later app reconciliation. The skeleton's own pagehide
     * listener stops any returned instance.
     */
    dispose() {
      state.disposed = true;
      state.generation += 1;
    },

    /** Resolves after every reconciliation queued so far has settled. */
    whenIdle() {
      return state.queue;
    },

    /** Read-only view for diagnostics and tests. */
    getState() {
      return {
        desired: { ...state.desired },
        revisions: { ...state.revisions },
        mode: state.current ? state.current.mode : null,
        ghost: state.current ? state.current.ghost : null,
        normalSnapshot: { ...state.normalSnapshot },
        demoSnapshot: { ...state.demoSnapshot },
        generation: state.generation,
        disposed: state.disposed,
        faulted: state.fault !== null,
      };
    },
  };
}

void (async function bootDoomscroll() {
  const chromeApi = globalThis.chrome;
  if (!chromeApi || !chromeApi.runtime || !chromeApi.runtime.id) return;

  const LOG_PREFIX = '[poltergeist:doomscroll]';
  const DEMO_KEY = 'doomscroll.demoMode';
  const MSG = {
    CONTENT_STATE: 'doomscroll:content-state',
    APPLY_PAUSED: 'doomscroll:apply-paused',
    PING: 'doomscroll:ping',
  };
  const win = globalThis.window || globalThis;

  // One cached package Promise: a failure is reported once and never retried in a loop.
  let packagePromise = null;
  function loadPackage() {
    if (!packagePromise) {
      packagePromise = (async () => {
        const [api, response] = await Promise.all([
          import(chromeApi.runtime.getURL('skeleton/index.js')),
          fetch(chromeApi.runtime.getURL('rules.json')),
        ]);
        if (!response || !response.ok) {
          throw new Error(`rules.json request failed (HTTP ${response ? response.status : 'none'})`);
        }
        const normalProfile = await response.json();
        return { api, normalProfile };
      })();
    }
    return packagePromise;
  }

  // One contained diagnostic per failed operation; never logs page content or storage records.
  function report(kind, message, error) {
    try {
      const detail = error && typeof error.message === 'string' ? error.message : undefined;
      if (detail) console.error(LOG_PREFIX, message, detail);
      else console.error(LOG_PREFIX, message);
    } catch {
      // Diagnostics must never throw.
    }
  }

  const controller = doomscrollCreateController({ loadPackage, report });

  // 1. Register every listener before requesting initial state.
  win.addEventListener('pagehide', () => controller.dispose());

  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (sender && sender.id !== undefined && sender.id !== chromeApi.runtime.id) return false;
    if (message.type === MSG.PING) {
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === MSG.APPLY_PAUSED) {
      if (typeof message.paused !== 'boolean') {
        sendResponse({ ok: false, error: 'paused must be a Boolean' });
        return false;
      }
      void controller.setPaused(message.paused);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  if (chromeApi.storage && chromeApi.storage.onChanged) {
    chromeApi.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes || !Object.prototype.hasOwnProperty.call(changes, DEMO_KEY)) return;
      const next = changes[DEMO_KEY] ? changes[DEMO_KEY].newValue : undefined;
      // A removed key means the default (off); non-Boolean junk is ignored.
      if (next === undefined && changes[DEMO_KEY]) void controller.setDemoMode(false);
      else if (typeof next === 'boolean') void controller.setDemoMode(next);
    });
  }

  try {
    const query = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMotion = () => { void controller.motionChanged(); };
    if (query && typeof query.addEventListener === 'function') query.addEventListener('change', onMotion);
    else if (query && typeof query.addListener === 'function') query.addListener(onMotion);
  } catch (error) {
    report('motion', 'could not observe the reduced-motion preference', error);
  }

  // 2. Capture revisions, then request the initial state.
  const captured = controller.captureRevisions();
  let reply;
  try {
    reply = await chromeApi.runtime.sendMessage({ type: MSG.CONTENT_STATE });
  } catch (error) {
    report('state', 'could not read the initial Doomscroll state', error);
    return;
  }
  if (!reply || reply.ok !== true) {
    report('state', 'could not read the initial Doomscroll state');
    return;
  }
  // Merges each field only if no newer event changed it; starts nothing until both are confirmed.
  void controller.applyInitialState({ paused: reply.paused, demoMode: reply.demoMode }, captured);
}());
