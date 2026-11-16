import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Real-Chrome checks for effect side effects (Requirements 10.13, 10.14, 14.10).
// Modules are served over a virtual http origin because ES modules cannot be
// imported from file:// pages.

const EFFECTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../effects');
const ORIGIN = 'http://poltergeist.test';

const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>fixture</title>
<style>
  html, body { margin: 0; height: 2000px; background: #fff; font: 16px sans-serif; }
  #hdr { position: fixed; top: 0; left: 0; width: 400px; height: 60px; background: #ccd; }
  #side { position: fixed; top: 100px; right: 10px; width: 120px; height: 300px; background: #cdc; }
  #chat { position: fixed; bottom: 20px; left: 30px; width: 200px; height: 80px; background: #dcc; transform: translateX(5px); }
  #modal { position: fixed; top: 50%; left: 50%; width: 240px; height: 140px; margin: -70px 0 0 -120px; background: #eee; }
</style></head>
<body>
  <div id="hdr">header</div><div id="side">side</div><div id="chat">chat</div><div id="modal">modal</div>
  <p>content</p>
</body></html>`;

test.beforeEach(async ({ page }) => {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: FIXTURE });
    }
    if (url.pathname.startsWith('/effects/') && url.pathname.endsWith('.js')) {
      const file = path.join(EFFECTS_DIR, path.basename(url.pathname));
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(file, 'utf8') });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(async () => {
    const [fog, flicker, block] = await Promise.all([
      import('/effects/fog.js'),
      import('/effects/flicker.js'),
      import('/effects/block.js'),
    ]);
    window.__fx = { fog, flicker, block, handles: {} };
    window.__env = { document, reducedMotion: false };
  });
});

const FIXED_IDS = ['hdr', 'side', 'chat', 'modal'];

const rects = (page) =>
  page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const r = document.getElementById(id).getBoundingClientRect();
      out[id] = [r.x, r.y, r.width, r.height];
    }
    return out;
  }, FIXED_IDS);

const start = (page, name, params, intensity) =>
  page.evaluate(
    ([n, p, i]) => {
      const fx = window.__fx;
      fx.handles[n] = fx[n].apply(window.__env, p, i, fx.handles[n]);
    },
    [name, params, intensity],
  );

const stop = (page, name) =>
  page.evaluate((n) => {
    const fx = window.__fx;
    fx[n].undo(fx.handles[n]);
    delete fx.handles[n];
  }, name);

const BLOCK_PARAMS = { maxOpacity: 0.8, blockAt: 1 };
const BLOCK_INTENSITY = 0.5; // configured opacity = 0.4

const COMBOS = [['fog'], ['flicker'], ['block'], ['fog', 'flicker', 'block']];

for (const combo of COMBOS) {
  test(`fixed element rects unchanged with ${combo.join('+')}`, async ({ page }) => {
    const before = await rects(page);
    for (const name of combo) await start(page, name, name === 'block' ? BLOCK_PARAMS : {}, name === 'block' ? BLOCK_INTENSITY : 0.7);
    expect(await rects(page)).toEqual(before);
    for (const name of combo) await stop(page, name);
    expect(await rects(page)).toEqual(before);
  });
}

test('block overlay is a documentElement child with no filter/backdrop-filter and exact opacity', async ({ page }) => {
  await start(page, 'fog', {}, 1);
  await start(page, 'flicker', {}, 1);
  await start(page, 'block', BLOCK_PARAMS, BLOCK_INTENSITY);

  const info = await page.evaluate(() => {
    const el = document.querySelector('[data-poltergeist="block"]');
    const cs = getComputedStyle(el);
    return {
      parentIsRoot: el.parentElement === document.documentElement,
      filter: cs.filter,
      backdrop: cs.backdropFilter,
      opacity: parseFloat(cs.opacity),
    };
  });
  expect(info.parentIsRoot).toBe(true);
  expect(info.filter).toBe('none');
  expect(info.backdrop).toBe('none');
  expect(Math.abs(info.opacity - BLOCK_PARAMS.maxOpacity * BLOCK_INTENSITY)).toBeLessThan(0.01);
});
