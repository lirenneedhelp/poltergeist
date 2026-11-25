// Meters measure the user's behaviour on the page.
//   timeOnSite      seconds spent visible on a matched site
//   scrollDistance  cumulative pixels scrolled (up or down)
//   timeSinceActive seconds since this tab was last visible (0 while visible)
//   timeAway        seconds of the longest absence (page hidden) since the last reset;
//                   while hidden, raised by the absence in progress. Never decreases while visible.

/** Seed sanitiser: missing, negative, non-finite, or non-number values become 0. */
const nonNegative = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * @param {object} opts
 * @param {Window} opts.window
 * @param {Document} opts.document
 * @param {() => number} [opts.now] ms clock (injectable for tests)
 * @param {Partial<Record<string, number>>} [opts.initial] seed values (e.g. restored from storage).
 *   timeAway seeds the held absence; timeAwayCurrent is the elapsed part of an absence already in progress.
 */
export function createMeters({ window, document, now = () => performance.now(), initial = {} } = {}) {
  const isVisible = () => document.visibilityState !== 'hidden';
  const scrollY = () => window.scrollY ?? 0;
  let timeOnSite = initial.timeOnSite ?? 0; // seconds
  let scrollDistance = initial.scrollDistance ?? 0; // px
  let lastTick = now();
  let lastActiveAt = lastTick;
  let lastWindowScrollY = scrollY();
  const containerTops = new WeakMap(); // element -> last seen scrollTop

  // timeAway state: held absence in seconds, and the start (ms, meter clock) of the absence in progress.
  let heldAway;
  let awayStartedAt;
  {
    const seedHeld = nonNegative(initial.timeAway);
    const seedCurrent = nonNegative(initial.timeAwayCurrent);
    if (isVisible()) {
      heldAway = Math.max(seedHeld, seedCurrent);
      awayStartedAt = null;
    } else {
      heldAway = seedHeld;
      awayStartedAt = lastTick - seedCurrent * 1000;
    }
  }
  const startAway = (t) => {
    if (awayStartedAt === null) awayStartedAt = t;
  };
  const endAway = (t) => {
    if (awayStartedAt === null) return;
    heldAway = Math.max(heldAway, Math.max(0, t - awayStartedAt) / 1000);
    awayStartedAt = null;
  };

  const syncViewport = () => {
    const y = scrollY();
    scrollDistance += Math.abs(y - lastWindowScrollY);
    lastWindowScrollY = y;
  };
  const isViewport = (t) =>
    t === document || t === window || t === document.scrollingElement || t === document.documentElement;

  const onScroll = () => syncViewport();
  const onCaptureScroll = (event) => {
    const target = event && event.target;
    if (!target) return;
    if (isViewport(target)) return syncViewport();
    const top = target.scrollTop;
    if (typeof top !== 'number' || Number.isNaN(top)) return;
    if (containerTops.has(target)) scrollDistance += Math.abs(top - containerTops.get(target));
    containerTops.set(target, top);
  };
  const onVisibility = () => {
    const t = now();
    if (isVisible()) {
      lastActiveAt = t;
      endAway(t);
    } else {
      startAway(t);
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onCaptureScroll, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  return {
    /** Advance time-based meters. Pass matched=false to pause timeOnSite (page not on a matched URL). */
    update(matched = true) {
      const t = now();
      const dt = Math.max(0, t - lastTick);
      lastTick = t;
      if (isVisible()) {
        lastActiveAt = t;
        if (matched) timeOnSite += dt / 1000;
        endAway(t); // corrects a missed "visible" event
      } else {
        startAway(t); // corrects a missed "hidden" event
      }
    },
    values() {
      return {
        timeOnSite,
        scrollDistance,
        timeSinceActive: isVisible() ? 0 : Math.max(0, (lastTick - lastActiveAt) / 1000),
        timeAway: awayStartedAt === null
          ? heldAway
          : Math.max(heldAway, Math.max(0, lastTick - awayStartedAt) / 1000),
      };
    },
    /**
     * Reset a resettable meter and return true. Resettable meters:
     *   timeOnSite  accumulated seconds go back to 0 and count up again from there.
     *   timeAway    held absence goes back to 0; an absence in progress restarts from now.
     * Returns false and changes nothing for any other name (scrollDistance,
     * timeSinceActive, unknown names, undefined).
     */
    reset(name) {
      if (name === 'timeOnSite') {
        timeOnSite = 0;
        return true;
      }
      if (name !== 'timeAway') return false;
      heldAway = 0;
      if (awayStartedAt !== null) awayStartedAt = now();
      return true;
    },
    dispose() {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onCaptureScroll, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
