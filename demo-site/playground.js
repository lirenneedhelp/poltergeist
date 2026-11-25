// Boot only: wire the Playground page to the generated skeleton copy.
import * as api from './skeleton/index.js';
import { createPlayground } from './playground-core.js';

function boot() {
  createPlayground({ document, window, api, fetch: (url) => window.fetch(url) });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
