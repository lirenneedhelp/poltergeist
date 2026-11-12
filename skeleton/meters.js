// Meters measure the user's behaviour on the page.
//   timeOnSite      seconds spent visible on a matched site
//   scrollDistance  cumulative pixels scrolled (up or down)
//   timeSinceActive seconds since this tab was last visible (0 while visible)

/**
 * @param {object} opts
 * @param {Window} opts.window
 * @param {Document} opts.document
 * @param {() => number} [opts.now] ms clock (injectable for tests)
 * @param {Partial<Record<string, number>>} [opts.initial] seed values (e.g. restored from storage)
 */
export function createMeters({ window, document, now = () => performance.now(), initial = {} } = {}) {
  const isVisible = () => document.visibilityState !== 'hidden';
  const scrollY = () => window.scrollY ?? 0;

  let timeOnSite = initial.timeOnSite ?? 0; // seconds
  let scrollDistance = initial.scrollDistance ?? 0; // px
  let lastTick = now();
  let lastActiveAt = lastTick;
  let lastScrollY = scrollY();

  const onScroll = () => {
    const y = scrollY();
    scrollDistance += Math.abs(y - lastScrollY);
    lastScrollY = y;
  };
  const onVisibility = () => {
    if (isVisible()) lastActiveAt = now();
  };

  window.addEventListener('scroll', onScroll, { passive: true });
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
      }
    },
    values() {
      return {
        timeOnSite,
        scrollDistance,
        timeSinceActive: isVisible() ? 0 : Math.max(0, (lastTick - lastActiveAt) / 1000),
      };
    },
    dispose() {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
