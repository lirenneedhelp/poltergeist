// Tab Graveyard content script (classic, isolated world, top frame only).
//
// This file must stay a classic script: Chrome loads `content_scripts` as
// classic scripts, so the ES-module skeleton is loaded later with a dynamic
// import of a runtime URL. There are no static module declarations here.
//
// The two top-level function declarations below are visible only inside the
// extension's isolated world (and to tests that evaluate this file in a VM
// context). The page cannot see them. All asynchronous work starts from the
// contained async bootstrap at the bottom of the file.
//
// The service worker is the source of truth for how long this tab was left.
// The page asks it for the tab's Registers, seeds the skeleton's timeAway meter
// with them, and reports the meter's Held_Absence back on visibility changes.
// Messages carry only the page title and meter values; the worker takes the URL
// from MessageSender.url. This script never closes, navigates, or reloads its tab.
//
// A pinned or audible tab is exempt: the state reply says so and no instance runs.
// The worker sends graveyard:refresh when that changes. While the page is hidden,
// a death watch sends one ordinary report when timeAway reaches the Tombstone
// threshold, so the worker can update its badge without an alarm.

/**
 * Build the Demo_Profile from the Normal_Profile: a deep clone whose trigger
 * `threshold` and `rampTo` are divided by exactly 3600 (the Demo_Time_Scale).
 * The input is not mutated. Accepts either `{ rules: [...] }` or a bare rule
 * array, like the validator. Rules whose params name a string `durationMeter`
 * also get `durationScale` and `durationSuffix` so their `{duration}` text
 * reads in demo time.
 */
function graveyardCreateDemoProfile(normalDocument) {
  const DEMO_TIME_SCALE = 3600;
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
 * Runtime_Controller: owns at most one live Poltergeist instance for this
 * document, started from the service worker's state for this tab.
 *
 * @param {object} deps
 * @param {() => Promise<{ api: { startPoltergeist: Function, validateRules: Function, builtinEffects: object }, normalProfile: object }>} deps.loadPackage
 *   Resolves the dynamically imported skeleton API and the parsed rules.json.
 *   Expected to cache its own Promise so repeated starts do not refetch.
 * @param {(message: object) => Promise<any>} deps.send
 *   Sends one message to the service worker and resolves to its reply.
 * @param {() => string} [deps.getTitle] Current page title.
 * @param {(fn: () => void) => void} [deps.defer] Runs fn on the next timer turn.
 * @param {(kind: string, message: string, error?: unknown) => void} [deps.report]
 *   Diagnostic sink. Called at most once per failure kind.
 * @param {(fn: () => void, ms: number) => unknown} [deps.every] Repeating timer (death watch).
 * @param {(id: unknown) => void} [deps.cancel] Cancels a timer returned by `every`.
 * @param {() => boolean} [deps.isHidden] True while the document is hidden.
 */
function graveyardCreateController({
  loadPackage,
  send,
  getTitle = () => '',
  defer = (fn) => setTimeout(fn, 0),
  report = () => {},
  every = (fn, ms) => setInterval(fn, ms),
  cancel = (id) => clearInterval(id),
  isHidden = () => false,
} = {}) {
  const MESSAGE = Object.freeze({
    CONTENT_STATE: 'graveyard:content-state', // content -> worker
    REPORT: 'graveyard:report', //               content -> worker
    RESURRECT: 'graveyard:resurrect', //         content -> worker
    APPLY_RESET: 'graveyard:apply-reset', //     worker -> content
    REFRESH: 'graveyard:refresh', //             worker -> content
  });
  const RESURRECT_ACTION = 'resurrect';
  const TOMBSTONE_RULE_ID = 'graveyard-tombstone';
  const TICK_MS = 1000;
  const WATCH_MS = 1000;

  const clone = (value) => (typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)));
  const seconds = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

  const state = {
    current: null, // { ghost, epoch, demoMode }
    generation: 0, // bumps on every queued refresh and on dispose
    pending: 0, // refreshes queued or running
    queue: Promise.resolve(),
    disposed: false,
    fault: null,
    resurrecting: false,
    watch: null, // { id, entry } while the death watch is armed
  };
  const reported = new Set();

  function reportOnce(kind, message, error) {
    if (reported.has(kind)) return;
    reported.add(kind);
    try {
      report(kind, message, error);
    } catch {
      // A broken diagnostic sink must not break the controller.
    }
  }

  function readTitle() {
    try {
      const title = getTitle();
      return typeof title === 'string' ? title : '';
    } catch {
      return '';
    }
  }

  /** Send one message; a synchronous throw from the transport becomes a rejection. */
  async function request(message) {
    return send(message);
  }

  /** The seeds and profile of a successful content-state reply, or null when the reply is unusable. */
  function parseState(reply) {
    if (!reply || typeof reply !== 'object' || reply.ok !== true) return null;
    if (typeof reply.demoMode !== 'boolean') return null;
    if (typeof reply.exempt !== 'boolean') return null; // exemption is learned only from this field
    if (!Number.isInteger(reply.epoch) || reply.epoch < 0) return null;
    return {
      exempt: reply.exempt,
      demoMode: reply.demoMode,
      epoch: reply.epoch,
      heldSeconds: seconds(reply.heldSeconds),
      currentSeconds: seconds(reply.currentSeconds),
    };
  }

  /** True while `token` belongs to the newest refresh and the controller may still act. */
  function isLive(token) {
    return token === state.generation && !state.disposed && state.fault === null;
  }

  function hidden() {
    try {
      return isHidden() === true;
    } catch {
      return false;
    }
  }

  /** The Tombstone threshold of the profile an instance started from, or null when it has none. */
  function tombstoneThreshold(rules) {
    const list = Array.isArray(rules) ? rules : rules && Array.isArray(rules.rules) ? rules.rules : [];
    const rule = list.find((r) => r && r.id === TOMBSTONE_RULE_ID);
    const threshold = rule && rule.trigger ? rule.trigger.threshold : undefined;
    return typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : null;
  }

  /** Death watch off. Safe to call when it is not armed. */
  function disarmWatch() {
    const watch = state.watch;
    if (!watch) return;
    state.watch = null;
    try {
      cancel(watch.id);
    } catch {
      // The firing re-checks state.watch, so a failed cancel cannot cause a report.
    }
  }

  /**
   * Death watch on for `entry` (the page is hidden). Each firing ticks the engine so the
   * meter is fresh, and the first value at the Tombstone threshold is sent as one
   * ordinary graveyard:report. No-op when already armed for this entry.
   */
  function armWatch(entry) {
    if (state.current !== entry || state.disposed || state.fault !== null) return;
    if (entry.deadAt === null) return;
    if (state.watch && state.watch.entry === entry) return;
    disarmWatch();
    const watch = { id: null, entry };
    const fire = () => {
      if (state.watch !== watch) return;
      if (state.current !== entry || state.disposed || state.fault !== null) {
        disarmWatch();
        return;
      }
      let value;
      try {
        entry.ghost.engine.tick();
        value = entry.ghost.meters.values().timeAway;
      } catch (error) {
        disarmWatch();
        reportOnce('watch', 'could not read the time-away meter while hidden', error);
        return;
      }
      if (typeof value === 'number' && value >= entry.deadAt) {
        disarmWatch();
        void sendReport(entry, value);
      }
    };
    state.watch = watch;
    try {
      watch.id = every(fire, WATCH_MS);
    } catch (error) {
      state.watch = null;
      reportOnce('watch', 'could not start the hidden-page timer', error);
    }
  }

  /** Stop the owned instance. Returns false (and faults) if its stop() threw. */
  function stopCurrent() {
    disarmWatch();
    const cur = state.current;
    if (!cur) return true;
    try {
      cur.ghost.stop();
    } catch (error) {
      // Keep ownership: the instance may still be live, so never start another.
      state.fault = { kind: 'stop', error };
      reportOnce('stop', 'stopping the haunt failed; Tab Graveyard is halted on this page', error);
      return false;
    }
    state.current = null;
    return true;
  }

  /** A failed refresh leaves the page clean, unless a newer refresh owns the decision. */
  function failClean(token, kind, message, error) {
    reportOnce(kind, message, error);
    if (isLive(token)) stopCurrent();
  }

  async function refreshOnce(token) {
    if (!isLive(token)) return; // a newer refresh is queued behind this one

    let reply;
    try {
      reply = await request({ type: MESSAGE.CONTENT_STATE, title: readTitle() });
    } catch (error) {
      failClean(token, 'state', 'could not read the tab state', error);
      return;
    }
    if (!isLive(token)) return;
    const seeds = parseState(reply);
    if (!seeds) {
      failClean(token, 'state', 'could not read the tab state');
      return;
    }
    if (seeds.exempt) {
      // A pinned or audible tab holds no instance; stop() undoes every effect.
      stopCurrent();
      return;
    }

    let pkg;
    try {
      pkg = await loadPackage();
    } catch (error) {
      failClean(token, 'load', 'could not load the Poltergeist package', error);
      return;
    }
    if (!isLive(token)) return;

    const mode = seeds.demoMode ? 'demo' : 'normal';
    const { api, normalProfile } = pkg;
    const rules = seeds.demoMode ? graveyardCreateDemoProfile(normalProfile) : clone(normalProfile);
    const result = api.validateRules(rules, api.builtinEffects);
    if (!result || result.valid !== true) {
      const errors = result && Array.isArray(result.errors) ? result.errors.join('; ') : 'unknown error';
      failClean(token, `validate-${mode}`, `${mode} rules are invalid: ${errors}`);
      return;
    }

    // Synchronous from here on, so no other trigger can run between stop and start.
    if (!stopCurrent()) return;
    const entry = { ghost: null, epoch: seeds.epoch, demoMode: seeds.demoMode, deadAt: tombstoneThreshold(rules) };
    try {
      entry.ghost = api.startPoltergeist({
        rules,
        initialMeters: { timeAway: seeds.heldSeconds, timeAwayCurrent: seeds.currentSeconds },
        tickMs: TICK_MS,
        onAction: (name) => handleAction(entry, name),
      });
    } catch (error) {
      // No instance was returned, so there is nothing this app can claim to clean up.
      state.fault = { kind: 'start', error };
      reportOnce('start', 'starting the haunt failed; Tab Graveyard is halted on this page', error);
      return;
    }
    state.current = entry;
    if (hidden()) armWatch(entry);
  }

  /** Append one refresh to the serialized queue. Older queued refreshes become no-ops. */
  function enqueue() {
    state.generation += 1;
    const token = state.generation;
    state.pending += 1;
    const run = state.queue
      .then(() => refreshOnce(token))
      .catch((error) => {
        reportOnce('refresh', 'unexpected refresh failure', error);
      })
      .then(() => {
        state.pending -= 1;
      });
    state.queue = run;
    return run;
  }

  /**
   * Clear the decay after the worker reset this tab's Registers. Returns false
   * when the controller is halted or the reset failed.
   */
  function applyCommittedReset() {
    if (state.disposed || state.fault !== null) return false;
    const cur = state.current;
    if (cur) {
      try {
        cur.ghost.meters.reset('timeAway');
        cur.ghost.engine.tick(); // undo the effects now, with their configured fades
      } catch (error) {
        reportOnce('reset', 'clearing the decay failed', error);
        return false;
      }
      // The tab can die again while still hidden, so watch for the next death.
      if (hidden()) armWatch(cur);
    }
    // A refresh still in flight may carry seeds read before the reset; replace it.
    if (state.pending > 0) enqueue();
    return true;
  }

  /**
   * onAction callback of one instance. Resurrect commits to the worker first;
   * only a confirmed reply clears the decay. Resolves when handling is done.
   */
  function handleAction(entry, name) {
    if (name !== RESURRECT_ACTION) return Promise.resolve();
    if (state.current !== entry || state.disposed || state.fault !== null || state.resurrecting) {
      return Promise.resolve();
    }
    state.resurrecting = true;
    return request({ type: MESSAGE.RESURRECT })
      .then((reply) => {
        if (reply && reply.ok === true) applyCommittedReset();
        else reportOnce('resurrect', 'the service worker did not confirm Resurrect; the decay stays');
      }, (error) => {
        reportOnce('resurrect', 'could not reach the service worker to Resurrect; the decay stays', error);
      })
      .then(() => {
        state.resurrecting = false;
      });
  }

  function sendReport(entry, heldSeconds) {
    return request({ type: MESSAGE.REPORT, title: readTitle(), heldSeconds: seconds(heldSeconds), epoch: entry.epoch })
      .then((reply) => {
        if (!reply || reply.ok !== true) reportOnce('report', 'the service worker rejected a visibility report');
      }, (error) => {
        reportOnce('report', 'could not send a visibility report', error);
      });
  }

  return {
    /** Request fresh state and restart the haunt (boot and Demo_Mode changes). */
    refresh() {
      if (state.disposed) return state.queue;
      return enqueue();
    },

    /** pageshow with persisted true: the page left the back/forward cache. */
    revive() {
      state.disposed = false;
      return enqueue();
    },

    /**
     * pagehide: stop all later app reconciliation. The skeleton's own pagehide
     * listener stops the instance; the reference is kept so a revive stops it
     * again (a no-op) before starting a replacement.
     */
    dispose() {
      state.disposed = true;
      state.generation += 1;
      disarmWatch();
    },

    /**
     * visibilitychange. This listener is registered before the meter's, so after a
     * change to visible the Held_Absence is read on the next timer turn, once the
     * meter has completed the Absence. A change to hidden reports 0 and arms the
     * death watch; a change to visible disarms it.
     */
    visibilityChanged(visible) {
      if (visible) disarmWatch();
      const entry = state.current;
      if (!entry || state.disposed || state.fault !== null) return;
      if (!visible) {
        void sendReport(entry, 0);
        armWatch(entry);
        return;
      }
      defer(() => {
        if (state.current !== entry || state.disposed || state.fault !== null) return;
        let held;
        try {
          held = entry.ghost.meters.values().timeAway;
        } catch (error) {
          reportOnce('report', 'could not read the time-away meter', error);
          return;
        }
        void sendReport(entry, held);
      });
    },

    /** Handle one message from the service worker; returns the reply to send. */
    handleWorkerMessage(message) {
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        return { ok: false, error: 'malformed message' };
      }
      if (message.type === MESSAGE.REFRESH) {
        // The worker saved an exemption change; re-read state through the serialized queue.
        if (state.disposed || state.fault !== null) return { ok: false, error: 'the haunt is halted on this page' };
        void enqueue();
        return { ok: true };
      }
      if (message.type !== MESSAGE.APPLY_RESET) return { ok: false, error: 'unknown message type' };
      return applyCommittedReset() ? { ok: true } : { ok: false, error: 'the haunt is halted on this page' };
    },

    /** Resolves after every refresh queued so far has settled. */
    whenIdle() {
      return state.queue;
    },

    /** Read-only view for diagnostics and tests. */
    getState() {
      const cur = state.current;
      return {
        ghost: cur ? cur.ghost : null,
        epoch: cur ? cur.epoch : null,
        demoMode: cur ? cur.demoMode : null,
        generation: state.generation,
        pending: state.pending,
        disposed: state.disposed,
        faulted: state.fault !== null,
        watching: state.watch !== null,
      };
    },
  };
}

void (async function bootGraveyard() {
  const chromeApi = globalThis.chrome;
  if (!chromeApi || !chromeApi.runtime || !chromeApi.runtime.id) return;

  const LOG_PREFIX = '[poltergeist:graveyard]';
  const DEMO_KEY = 'graveyard.demoMode';
  const win = globalThis.window || globalThis;
  const doc = win.document;

  // Diagnostics carry a fixed description and an error detail with any URL removed.
  // They never log page titles, page URLs, or stored records.
  function report(kind, message, error) {
    try {
      const redact = (text) => String(text).replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '<url>');
      const detail = error && typeof error.message === 'string' ? redact(error.message) : '';
      if (detail) console.error(LOG_PREFIX, redact(message), detail);
      else console.error(LOG_PREFIX, redact(message));
    } catch {
      // Diagnostics must never throw.
    }
  }

  // One cached package Promise: a failure is reported once and never retried in a loop.
  let packagePromise = null;
  function loadPackage() {
    if (!packagePromise) {
      packagePromise = (async () => {
        const [api, response] = await Promise.all([
          import(chromeApi.runtime.getURL('skeleton/index.js')),
          fetch(chromeApi.runtime.getURL('rules.json')),
        ]);
        if (!api || typeof api.startPoltergeist !== 'function' || typeof api.validateRules !== 'function' || !api.builtinEffects) {
          throw new Error('the skeleton module does not expose startPoltergeist, validateRules, and builtinEffects');
        }
        if (!response || !response.ok) {
          throw new Error(`rules.json request failed (HTTP ${response ? response.status : 'none'})`);
        }
        const normalProfile = await response.json();
        return { api, normalProfile };
      })();
    }
    return packagePromise;
  }

  try {
    const controller = graveyardCreateController({
      loadPackage,
      send: (message) => chromeApi.runtime.sendMessage(message),
      getTitle: () => (doc && typeof doc.title === 'string' ? doc.title : ''),
      defer: (fn) => { win.setTimeout(fn, 0); },
      report,
      every: (fn, ms) => win.setInterval(fn, ms),
      cancel: (id) => { win.clearInterval(id); },
      isHidden: () => Boolean(doc) && doc.visibilityState === 'hidden',
    });

    // 1. Register every listener before requesting state.
    win.addEventListener('pagehide', () => controller.dispose());
    win.addEventListener('pageshow', (event) => {
      if (event && event.persisted === true) void controller.revive();
    });

    if (doc && typeof doc.addEventListener === 'function') {
      // Registered before any instance starts, so it runs before the meter's own listener.
      doc.addEventListener('visibilitychange', () => {
        controller.visibilityChanged(doc.visibilityState !== 'hidden');
      });
    }

    chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!sender || sender.id !== chromeApi.runtime.id) return false;
      sendResponse(controller.handleWorkerMessage(message));
      return false;
    });

    if (chromeApi.storage && chromeApi.storage.onChanged) {
      chromeApi.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes || !Object.prototype.hasOwnProperty.call(changes, DEMO_KEY)) return;
        // The worker is the source of truth for the flag and the epoch, so any change refreshes.
        void controller.refresh();
      });
    }

    // 2. Request state; nothing starts until a successful reply arrives.
    await controller.refresh();
  } catch (error) {
    report('boot', 'could not start Tab Graveyard on this page', error);
  }
}());
