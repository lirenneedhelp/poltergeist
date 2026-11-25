// @vitest-environment jsdom
// Haunt Playground (Requirement 14): createPlayground in jsdom with the real skeleton behind a
// recording API and a fake fetch, static scans of the hand-written demo-site/ files, and the
// local server's path containment and method checks. Every "for any" is a fixed list.
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as skeleton from '../skeleton/index.js';
import { createPlayground, clampSpeed, scaleRules, RITUAL_DONE_MESSAGE } from '../demo-site/playground-core.js';
import { startServer, resolveRequestPath, DEMO_SITE } from '../scripts/serve-playground.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(REPO, 'demo-site');
const INDEX_HTML = readFileSync(path.join(SITE, 'index.html'), 'utf8');
const BODY_HTML = INDEX_HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
const PRESET_TEXT = {
  './presets/doomscroll.json': readFileSync(path.join(SITE, 'presets', 'doomscroll.json'), 'utf8'),
  './presets/graveyard.json': readFileSync(path.join(SITE, 'presets', 'graveyard.json'), 'utf8'),
};
const GRAVEYARD_NOTE =
  'The Tab Graveyard preset decays only while this tab is hidden. Switch to another tab, then come back. At 3600× the tombstone appears after about 24 seconds away.';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Independent expectation of the rules passed to startPoltergeist (Requirements 14.6, 14.7). */
function expectedScaled(doc, speed) {
  const out = clone(doc);
  const list = Array.isArray(out) ? out : out.rules;
  for (const r of list) {
    r.match = ['<all_urls>'];
    if (typeof r.trigger.threshold === 'number') r.trigger.threshold /= speed;
    if (typeof r.trigger.rampTo === 'number') r.trigger.rampTo /= speed;
  }
  return out;
}

// A valid hand-written list: one Fog rule that fires at once. Its match names another site, so it
// only applies in jsdom because the Playground rewrites every match to <all_urls>.
const HAND_DOC = [
  {
    id: 'hand-fog',
    match: ['https://nowhere.invalid/*'],
    trigger: { meter: 'timeOnSite', threshold: 0, rampTo: 30 },
    effect: { type: 'fog', params: { maxBlur: 3 } },
    undo: { mode: 'fade', durationMs: 400 },
  },
];
const HAND_TEXT = JSON.stringify(HAND_DOC, null, 2);
const BAD_JSON_TEXT = '{ "rules": [ { "id": "oops", } ] }';
const BAD_RULES_DOC = {
  rules: [{ id: 'Bad Id', match: [], trigger: { meter: 'nope', threshold: -1 }, effect: { type: 'zap' }, undo: { mode: 'later' } }],
};
const BAD_RULES_TEXT = JSON.stringify(BAD_RULES_DOC);
const SPEEDS = [1, 60, 600, 3600];

/** The real skeleton, with every startPoltergeist call and every stop recorded. */
function recordingApi() {
  const starts = [];
  const api = {
    validateRules: skeleton.validateRules,
    builtinEffects: skeleton.builtinEffects,
    startPoltergeist(opts) {
      const ghost = skeleton.startPoltergeist(opts);
      const entry = { rules: clone(opts.rules), ghost, stopped: 0 };
      const realStop = ghost.stop;
      ghost.stop = () => { entry.stopped += 1; realStop(); };
      starts.push(entry);
      return ghost;
    },
  };
  return { api, starts };
}

/** Fake fetch serving the committed presets; `fail` maps a URL to 'reject' or an HTTP status. */
function fakeFetch(fail = {}) {
  const calls = [];
  const fetch = (url) => {
    calls.push(url);
    if (fail[url] === 'reject') return Promise.reject(new TypeError('network down'));
    if (typeof fail[url] === 'number') return Promise.resolve({ ok: false, status: fail[url], text: async () => '' });
    const text = PRESET_TEXT[url];
    if (text === undefined) return Promise.resolve({ ok: false, status: 404, text: async () => '' });
    return Promise.resolve({ ok: true, status: 200, text: async () => text });
  };
  return { fetch, calls };
}

const $ = (sel) => document.querySelector(sel);
const errorLines = () => [...document.querySelectorAll('#errors li')].map((li) => li.textContent);
const hauntNodes = () => document.querySelectorAll('[data-poltergeist]');

let pg;
let rec;
let net;

function boot(fail) {
  rec = recordingApi();
  net = fakeFetch(fail);
  pg = createPlayground({ document, window, api: rec.api, fetch: net.fetch });
  return pg;
}

describe('Playground page and controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = BODY_HTML;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    if (pg) {
      const trial = pg.state().trial;
      if (trial) skeleton.builtinEffects.ritual.undo(trial, { durationMs: 0 });
      pg.stop();
    }
    pg = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders a feed of at least 20 posts and shows the speed as 1×', () => {
    boot();
    expect(document.querySelectorAll('#feed article').length).toBeGreaterThanOrEqual(20);
    expect($('#speed-value').textContent).toBe('1×');
  });

  it('has a 1× to 3600× integer speed slider starting at 1× (Requirement 14.7)', () => {
    const speed = $('#speed');
    expect(speed.getAttribute('type')).toBe('range');
    expect(speed.getAttribute('min')).toBe('1');
    expect(speed.getAttribute('step')).toBe('1');
    expect(speed.getAttribute('value')).toBe('1');
    expect(speed.getAttribute('max')).toBe('3600');
  });

  it('clampSpeed keeps 1 to 3600 and clamps outside values', () => {
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(600)).toBe(600);
    expect(clampSpeed(3600)).toBe(3600);
    expect(clampSpeed(3601)).toBe(3600);
    expect(clampSpeed(0)).toBe(1);
    expect(clampSpeed('60')).toBe(60);
    expect(clampSpeed('x')).toBe(1);
  });

  it('shows the exact Tab Graveyard note next to its preset button (Requirement 14.8)', () => {
    const note = $('#preset-graveyard').closest('section').querySelector('p.note');
    expect(note.textContent).toBe(GRAVEYARD_NOTE);
  });

  it('updates the speed text on input and restarts on change from the last accepted rules', () => {
    boot();
    $('#rules').value = HAND_TEXT;
    $('#apply').click();
    expect(rec.starts).toHaveLength(1);

    // Editor text that was never applied must not be used by the restart.
    $('#rules').value = BAD_RULES_TEXT;
    $('#speed').value = '60';
    $('#speed').dispatchEvent(new window.Event('input'));
    expect($('#speed-value').textContent).toBe('60×');
    expect(rec.starts).toHaveLength(1);
    $('#speed').dispatchEvent(new window.Event('change'));
    expect(rec.starts).toHaveLength(2);
    expect(rec.starts[0].stopped).toBe(1);
    expect(rec.starts[1].rules).toEqual(expectedScaled(HAND_DOC, 60));
    expect($('#rules').value).toBe(BAD_RULES_TEXT);
  });

  // Haunt Kit invariant 20: Playground Apply is all-or-nothing and scales correctly
  const VALID = [
    ['the Doomscroll preset', PRESET_TEXT['./presets/doomscroll.json']],
    ['the Tab Graveyard preset', PRESET_TEXT['./presets/graveyard.json']],
    ['a hand-written list', HAND_TEXT],
  ];
  for (const speed of SPEEDS) {
    for (const [name, text] of VALID) {
      it(`Apply of ${name} at ${speed}× stops the old haunt and starts the scaled rules`, () => {
        boot();
        pg.setSpeed(speed);
        // A running haunt with a visible effect, and a stale error line.
        $('#rules').value = HAND_TEXT;
        $('#apply').click();
        expect(document.querySelector('[data-poltergeist="fog"]')).not.toBeNull();
        $('#rules').value = BAD_JSON_TEXT;
        $('#apply').click();
        expect(errorLines()).toHaveLength(1);

        $('#rules').value = text;
        $('#apply').click();
        expect(errorLines()).toEqual([]);
        expect(rec.starts).toHaveLength(2);
        expect(rec.starts[0].stopped).toBe(1);
        const doc = JSON.parse(text);
        expect(rec.starts[1].rules).toEqual(expectedScaled(doc, speed));
        expect(scaleRules(doc, speed)).toEqual(expectedScaled(doc, speed));
        expect(skeleton.validateRules(rec.starts[1].rules, skeleton.builtinEffects).valid).toBe(true);
        expect($('#rules').value).toBe(text);
        if (text !== HAND_TEXT) {
          // Both presets start above 0, so the old fog is gone and nothing new has applied yet.
          expect(hauntNodes()).toHaveLength(0);
        }
        expect(pg.state().lastAccepted).toEqual(doc);
      });
    }

    const INVALID = [
      ['invalid JSON', BAD_JSON_TEXT, () => {
        const lines = errorLines();
        expect(lines).toHaveLength(1);
        expect(lines[0].startsWith('JSON: ')).toBe(true);
      }],
      ['rules that fail validateRules', BAD_RULES_TEXT, () => {
        const { errors } = skeleton.validateRules(BAD_RULES_DOC, skeleton.builtinEffects);
        expect(errors.length).toBeGreaterThan(1);
        expect(errorLines()).toEqual(errors);
      }],
    ];
    for (const [name, text, checkErrors] of INVALID) {
      it(`Apply of ${name} at ${speed}× shows the errors and changes nothing`, () => {
        boot();
        pg.setSpeed(speed);
        $('#rules').value = HAND_TEXT;
        $('#apply').click();
        const before = document.querySelector('[data-poltergeist="fog"]');
        expect(before).not.toBeNull();

        $('#rules').value = text;
        $('#apply').click();
        checkErrors();
        expect(rec.starts).toHaveLength(1);
        expect(rec.starts[0].stopped).toBe(0);
        expect(pg.state().ghost).toBe(rec.starts[0].ghost);
        expect(document.querySelector('[data-poltergeist="fog"]')).toBe(before);
        expect($('#rules').value).toBe(text);
        expect(pg.state().lastAccepted).toEqual(HAND_DOC);

        // The next successful apply clears the list.
        $('#rules').value = HAND_TEXT;
        $('#apply').click();
        expect(errorLines()).toEqual([]);
        expect(rec.starts).toHaveLength(2);
      });
    }
  }

  it('a speed change restarts from the last accepted rules at each listed speed', () => {
    boot();
    $('#rules').value = PRESET_TEXT['./presets/doomscroll.json'];
    $('#apply').click();
    const accepted = JSON.parse(PRESET_TEXT['./presets/doomscroll.json']);
    for (const speed of SPEEDS) {
      pg.setSpeed(speed);
      expect($('#speed-value').textContent).toBe(`${speed}×`);
      expect(rec.starts.at(-1).rules).toEqual(expectedScaled(accepted, speed));
    }
    expect(rec.starts.slice(0, -1).every((s) => s.stopped === 1)).toBe(true);
  });

  it('a speed change before any accepted rules starts nothing', () => {
    boot();
    pg.setSpeed(600);
    expect(rec.starts).toHaveLength(0);
  });

  it('the Doomscroll preset button loads the preset into the editor and applies it', async () => {
    boot();
    $('#preset-doomscroll').click();
    await vi.waitFor(() => expect(rec.starts).toHaveLength(1));
    expect(net.calls).toEqual(['./presets/doomscroll.json']);
    expect($('#rules').value).toBe(PRESET_TEXT['./presets/doomscroll.json']);
    expect(rec.starts[0].rules).toEqual(expectedScaled(JSON.parse(PRESET_TEXT['./presets/doomscroll.json']), 1));
  });

  it('the Tab Graveyard preset applies through loadPreset', async () => {
    boot();
    expect(await pg.loadPreset('graveyard')).toBe(true);
    expect($('#rules').value).toBe(PRESET_TEXT['./presets/graveyard.json']);
    expect(rec.starts).toHaveLength(1);
  });

  const FAILURES = [
    ['doomscroll', 'Doomscroll', 'reject'],
    ['doomscroll', 'Doomscroll', 404],
    ['graveyard', 'Tab Graveyard', 'reject'],
    ['graveyard', 'Tab Graveyard', 500],
  ];
  for (const [key, label, mode] of FAILURES) {
    it(`a ${key} preset load failure (${mode}) names the preset and changes nothing (Requirement 14.12)`, async () => {
      boot({ [`./presets/${key}.json`]: mode });
      $('#rules').value = HAND_TEXT;
      $('#apply').click();
      const fog = document.querySelector('[data-poltergeist="fog"]');
      expect(await pg.loadPreset(key)).toBe(false);
      expect(errorLines()).toEqual([`Could not load the ${label} preset.`]);
      expect($('#rules').value).toBe(HAND_TEXT);
      expect(rec.starts).toHaveLength(1);
      expect(rec.starts[0].stopped).toBe(0);
      expect(document.querySelector('[data-poltergeist="fog"]')).toBe(fog);
    });
  }

  it('Stop haunt undoes every effect', () => {
    boot();
    $('#rules').value = HAND_TEXT;
    $('#apply').click();
    expect(hauntNodes().length).toBeGreaterThan(0);
    $('#stop').click();
    expect(hauntNodes()).toHaveLength(0);
    expect(pg.state().ghost).toBeNull();
  });

  it('"Try the ritual" shows the ritual, then undoes it and says so once it is finished', () => {
    boot();
    $('#try-ritual').click();
    const handle = pg.state().trial;
    expect(handle).toBeTruthy();
    expect(document.querySelectorAll('[data-poltergeist="ritual"]')).toHaveLength(1);
    expect(pg.tryRitual()).toBe(handle); // a second click reuses the live ritual
    expect($('#ritual-status').textContent).toBe('');

    // Hint completes the ritual after size² - 1 trusted activations.
    for (let k = 1; k < handle.board.size ** 2; k++) handle.on.hint({ isTrusted: true });
    expect(handle.complete).toBe(true);
    vi.advanceTimersByTime(1200); // Banishing_Ending, then the Exorcised_Action
    expect($('#ritual-status').textContent).toBe(RITUAL_DONE_MESSAGE);
    expect(pg.state().trial).toBeNull();
    vi.advanceTimersByTime(600); // the ritual's undo fade
    expect(document.querySelectorAll('[data-poltergeist="ritual"]')).toHaveLength(0);
  });
});

describe('demo-site/ static safety (Requirements 14.1, 14.10)', () => {
  /** Hand-written files: everything in demo-site/ outside skeleton/ and presets/. */
  const files = readdirSync(SITE, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(html|js|css)$/.test(e.name))
    .map((e) => e.name);

  it('lists the hand-written Playground files', () => {
    expect(files.sort()).toEqual(['index.html', 'playground-core.js', 'playground.css', 'playground.js']);
  });

  for (const name of files) {
    const text = readFileSync(path.join(SITE, name), 'utf8');
    it(`${name} has no remote URL, eval, new Function or innerHTML`, () => {
      expect(text).not.toMatch(/\b(?:https?|wss?|ftp):\/\//i);
      expect(text).not.toMatch(/(?:src|href)\s*=\s*["']?\/\//i);
      expect(text).not.toMatch(/\beval\s*\(/);
      expect(text).not.toMatch(/\bnew\s+Function\b/);
      expect(text).not.toMatch(/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/);
      expect(text).not.toMatch(/@import/);
    });
  }

  it('index.html has no inline script or handler and only relative paths inside demo-site/', () => {
    for (const m of INDEX_HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(m[1]).toMatch(/\bsrc\s*=/);
      expect(m[2].trim()).toBe('');
    }
    expect(INDEX_HTML).not.toMatch(/\son[a-z]+\s*=/i);
    expect(INDEX_HTML).not.toMatch(/javascript:/i);
    const refs = [...INDEX_HTML.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref, ref).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i);
      expect(path.resolve(SITE, ref).startsWith(SITE + path.sep), ref).toBe(true);
    }
  });

  it('playground.js imports only the generated skeleton copy and the core module', () => {
    const src = readFileSync(path.join(SITE, 'playground.js'), 'utf8');
    const specs = [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
    expect(specs).toEqual(['./playground-core.js', './skeleton/index.js']);
    expect(src).not.toMatch(/\bchrome\./);
  });
});

describe('Playground server (scripts/serve-playground.mjs)', () => {
  let server;
  let port;
  beforeAll(async () => {
    server = await startServer({ port: 0 });
    port = Number(new URL(server.url).port);
  });
  afterAll(() => server.close());

  /** Raw request so the path is sent exactly as written (no client-side normalisation). */
  const request = (method, rawPath) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: rawPath }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });

  it('binds 127.0.0.1 and serves index.html at /', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const res = await request('GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('serves module scripts, styles and presets with their content types', async () => {
    expect((await request('GET', '/playground-core.js')).headers['content-type']).toMatch(/^text\/javascript/);
    expect((await request('GET', '/skeleton/index.js')).headers['content-type']).toMatch(/^text\/javascript/);
    expect((await request('GET', '/playground.css')).headers['content-type']).toMatch(/^text\/css/);
    const preset = await request('GET', '/presets/doomscroll.json');
    expect(preset.headers['content-type']).toMatch(/^application\/json/);
    expect(preset.body).toBe(PRESET_TEXT['./presets/doomscroll.json']);
  });

  it('HEAD answers with headers and no body', async () => {
    const res = await request('HEAD', '/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
  });

  for (const method of ['POST', 'PUT', 'DELETE']) {
    it(`rejects ${method} with 405`, async () => {
      const res = await request(method, '/');
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD');
    });
  }

  const OUTSIDE = ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/..%5cpackage.json', '/skeleton/', '/skeleton', '/missing.html', '/%zz', '/index.html%00'];
  for (const raw of OUTSIDE) {
    it(`answers 404 for ${raw}`, async () => {
      expect((await request('GET', raw)).status).toBe(404);
    });
  }

  it('resolveRequestPath keeps every result inside the root', async () => {
    expect(await resolveRequestPath(DEMO_SITE, '/')).toBe(path.join(DEMO_SITE, 'index.html'));
    expect(await resolveRequestPath(DEMO_SITE, '/presets/graveyard.json?x=1')).toBe(path.join(DEMO_SITE, 'presets', 'graveyard.json'));
    for (const raw of OUTSIDE) expect(await resolveRequestPath(DEMO_SITE, raw), raw).toBeNull();
  });
});
