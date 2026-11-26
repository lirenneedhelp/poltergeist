// Scaffolder tests (Requirements 12 and 13): all-or-nothing runs, Generic_Validator mutations, and the
// generated popup.js and content.js run against mocks. Example-based only.
// Every run generates into a temporary repository copy (os.tmpdir()) with --root. The copy gets a
// node_modules directory junction so the generated starter tests can run with the real Vitest.
// The real repository is snapshotted (size, mtime, hash) before the first test and compared by the last one.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  promises as fsp, cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { main as newHauntMain } from '../scripts/new-haunt.mjs';
import { validatePackage } from '../scripts/validate-app-package.mjs';
import * as skeleton from '../skeleton/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'new-haunt.mjs');
const TIMEOUT = 120_000;
const DEFAULT_HOSTS = ['https://example.com/*'];
const THREE_HOSTS = ['https://*.example.org/*', 'http://localhost/*', '*://news.example.net/feed/*'];
const SNAPSHOT_SKIP = new Set(['node_modules', '.git', 'test-results']);

/**
 * Every file and folder under root as rel -> description, skipping node_modules/, .git/, test-results/
 * and links. Files carry size and SHA-256, plus mtime when asked.
 */
function snapshot(root, { mtime = false } = {}) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SNAPSHOT_SKIP.has(e.name) || e.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { out[`${rel}/`] = 'dir'; walk(abs, rel); continue; }
      if (!e.isFile()) continue;
      const st = statSync(abs);
      const hash = createHash('sha256').update(readFileSync(abs)).digest('hex');
      out[rel] = mtime ? `${st.size}:${st.mtimeMs}:${hash}` : `${st.size}:${hash}`;
    }
  };
  walk(root, '');
  return out;
}

const REAL_BEFORE = snapshot(REPO_ROOT, { mtime: true });

const tempRoots = [];
const copyFilter = (src) => !SNAPSHOT_SKIP.has(path.basename(src));

/** A temporary repository copy: scripts/, skeleton/, package.json, optionally the two app folders. */
function makeRoot({ apps = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'new-haunt-'));
  tempRoots.push(root);
  const parts = ['scripts', 'skeleton', 'package.json', ...(apps ? ['app1-doomscroll', 'app2-tab-graveyard'] : [])];
  for (const part of parts) cpSync(path.join(REPO_ROOT, part), path.join(root, part), { recursive: true, filter: copyFilter });
  // Minimal config for the generated starter tests; the cache stays inside the copy.
  writeFileSync(path.join(root, 'vitest.config.js'),
    "export default { cacheDir: '.vite-cache', test: { include: ['app*/test/**/*.test.js'], exclude: ['**/*.pw.js', '**/node_modules/**'] } };\n");
  symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  return root;
}

afterAll(() => {
  for (const root of tempRoots) {
    const link = path.join(root, 'node_modules');
    try { if (lstatSync(link).isSymbolicLink()) unlinkSync(link); } catch { /* already gone */ }
    rmSync(root, { recursive: true, force: true });
  }
});

/** Environment for child processes without the outer Vitest's worker variables. */
const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^VITEST/i.test(k)));

function newHaunt(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: TIMEOUT, env: childEnv() });
}

function packageCheck(root, name) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-skeleton.mjs'), '--check', '--app', name], {
    cwd: root, encoding: 'utf8', timeout: TIMEOUT, env: childEnv(),
  });
}

function starterTests(root, dir) {
  return spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), '--run', `${dir}/test/`], {
    cwd: root, encoding: 'utf8', timeout: TIMEOUT, env: childEnv(),
  });
}

const readText = (root, rel) => readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const lines = (text) => text.split(/\r?\n/);

/** Scaffold into root and check the registry, package.json, files and Package_Check of the result. */
function expectSuccessfulRun(root, name, hosts, expectedDir) {
  const registryBefore = readText(root, 'scripts/app-registry.json');
  const pkgBefore = JSON.parse(readText(root, 'package.json'));
  const args = [name, '--root', root];
  if (hosts !== DEFAULT_HOSTS) args.push('--hosts', hosts.join(','));

  const res = newHaunt(args);
  expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
  const target = path.join(root, expectedDir);
  expect(res.stdout).toContain(target);
  expect(statSync(target).isDirectory()).toBe(true);
  for (const f of ['manifest.json', 'rules.json', 'content.js', 'background.js', 'popup.html', 'popup.js', 'popup.css',
    'skeleton/index.js', 'test/package.test.js', 'test/background.test.js']) {
    expect(existsSync(path.join(target, ...f.split('/'))), f).toBe(true);
  }

  // One appended registry entry; every existing entry line is byte-identical except the added comma.
  const registryAfter = readText(root, 'scripts/app-registry.json');
  const before = lines(registryBefore);
  const after = lines(registryAfter);
  const lastEntry = before.findLastIndex((l) => l.trim().startsWith('"'));
  expect(after).toHaveLength(before.length + 1);
  before.forEach((line, i) => {
    if (i < lastEntry) expect(after[i]).toBe(line);
    else if (i === lastEntry) expect(after[i]).toBe(`${line},`);
    else expect(after[i + 1]).toBe(line);
  });
  const entry = { dir: expectedDir, label: name, validator: './validate-app-package.mjs', buildScript: `build:${name}` };
  expect(JSON.parse(registryAfter)).toEqual({ ...JSON.parse(registryBefore), [name]: entry });

  // Two npm scripts added at the end of scripts; every other field unchanged.
  const pkgAfter = JSON.parse(readText(root, 'package.json'));
  expect(pkgAfter).toEqual({
    ...pkgBefore,
    scripts: {
      ...pkgBefore.scripts,
      [`build:${name}`]: `node scripts/sync-skeleton.mjs --app ${name}`,
      [`check:${name}`]: `node scripts/sync-skeleton.mjs --check --app ${name}`,
    },
  });
  expect(Object.keys(pkgAfter.scripts).slice(-2)).toEqual([`build:${name}`, `check:${name}`]);

  const manifest = JSON.parse(readText(root, `${expectedDir}/manifest.json`));
  expect(manifest.host_permissions).toEqual(hosts);
  expect(manifest.content_scripts[0].matches).toEqual(hosts);
  const rules = JSON.parse(readText(root, `${expectedDir}/rules.json`));
  expect(rules.rules.map((r) => r.id)).toEqual([`${name}-fog`, `${name}-rot`]);
  for (const r of rules.rules) expect(r.match).toEqual(hosts);

  const check = packageCheck(root, name);
  expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0);
}

function expectStarterTestsPass(root, dir) {
  const run = starterTests(root, dir);
  const out = `${run.stdout}\n${run.stderr}`;
  expect(run.status, out).toBe(0);
  expect(out).toMatch(/Test Files\s+2 passed/);
}

// Haunt Kit invariant 19: The Scaffolder is all-or-nothing
describe('Scaffolder successful runs', () => {
  let withApps;
  let withoutApps;
  beforeAll(() => {
    withApps = makeRoot({ apps: true });
    withoutApps = makeRoot({ apps: false });
  });

  it('default hosts, root with app1 and app2: creates app3-moth', () => {
    expectSuccessfulRun(withApps, 'moth', DEFAULT_HOSTS, 'app3-moth');
  }, TIMEOUT);

  it('three custom hosts, root with app1 to app3: creates app4-lantern', () => {
    expectSuccessfulRun(withApps, 'lantern', THREE_HOSTS, 'app4-lantern');
  }, TIMEOUT);

  it('three custom hosts, root without app folders: creates app1-wisp', () => {
    expectSuccessfulRun(withoutApps, 'wisp', THREE_HOSTS, 'app1-wisp');
  }, TIMEOUT);

  it('default hosts, root without app folders apart from app1-wisp: creates app2-shade', () => {
    expectSuccessfulRun(withoutApps, 'shade', DEFAULT_HOSTS, 'app2-shade');
  }, TIMEOUT);

  for (const [label, dir] of [['app3-moth', 'app3-moth'], ['app4-lantern', 'app4-lantern']]) {
    it(`the starter tests of ${label} pass without edits`, () => expectStarterTestsPass(withApps, dir), TIMEOUT);
  }
  for (const dir of ['app1-wisp', 'app2-shade']) {
    it(`the starter tests of ${dir} pass without edits`, () => expectStarterTestsPass(withoutApps, dir), TIMEOUT);
  }
});

// Haunt Kit invariant 19: The Scaffolder is all-or-nothing
describe('Scaffolder failing runs leave the root byte-identical', () => {
  let root;
  beforeAll(() => { root = makeRoot({ apps: true }); });

  /** Run, expect a non-zero exit and an error containing `mention`, and an unchanged root. */
  function expectFailure(args, mention) {
    const before = snapshot(root);
    const res = newHaunt(args);
    expect(res.status, res.stdout).not.toBe(0);
    expect(res.stderr).toMatch(/^new-haunt: /);
    expect(res.stderr).toContain(mention);
    expect(snapshot(root)).toEqual(before);
    return res;
  }

  it('an invalid Haunt_Name', () => {
    expectFailure(['Bad_Name', '--root', root], 'Bad_Name');
  }, TIMEOUT);

  it('a Haunt_Name equal to an existing App_Registry key', () => {
    expectFailure(['doomscroll', '--root', root], 'doomscroll');
  }, TIMEOUT);

  it('a Haunt_Name whose npm scripts already exist', () => {
    expectFailure(['skeletons', '--root', root], 'build:skeletons');
  }, TIMEOUT);

  it('an existing target folder', () => {
    // A file named like the planned folder: app1 and app2 are the only app folders, so the target is app3-ghoul.
    const blocker = path.join(root, 'app3-ghoul');
    writeFileSync(blocker, 'in the way\n');
    try {
      expectFailure(['ghoul', '--root', root], 'app3-ghoul');
      expect(readFileSync(blocker, 'utf8')).toBe('in the way\n');
    } finally {
      rmSync(blocker, { force: true });
    }
  }, TIMEOUT);

  it('0 hosts', () => {
    expectFailure(['ghoul', '--root', root, '--hosts', ''], '--hosts');
  }, TIMEOUT);

  it('21 hosts', () => {
    const hosts = Array.from({ length: 21 }, (_, i) => `https://h${i}.example.com/*`).join(',');
    expectFailure(['ghoul', '--root', root, '--hosts', hosts], '--hosts');
  }, TIMEOUT);

  it('<all_urls>', () => {
    expectFailure(['ghoul', '--root', root, '--hosts', '<all_urls>'], '<all_urls>');
  }, TIMEOUT);

  it('a missing root', () => {
    const missing = path.join(root, 'no-such-root');
    expectFailure(['ghoul', '--root', missing], missing);
    expect(existsSync(missing)).toBe(false);
  }, TIMEOUT);

  it('a package validator forced to fail after the files were written', () => {
    const validator = path.join(root, 'scripts', 'validate-app-package.mjs');
    const original = readFileSync(validator, 'utf8');
    const forced = original.replace('export async function validatePackage(',
      "export async function validatePackage() { return { ok: false, errors: ['rules.json: forced failure'] }; }\nasync function originalValidatePackage(");
    expect(forced).not.toBe(original);
    writeFileSync(validator, forced);
    try {
      const res = expectFailure(['ghoul', '--root', root], 'forced failure');
      expect(res.stderr).toContain('build skeleton failed');
      expect(existsSync(path.join(root, 'app3-ghoul'))).toBe(false);
    } finally {
      writeFileSync(validator, original);
    }
  }, TIMEOUT);

  it('a write failure after the first file write names the file', async () => {
    const before = snapshot(root);
    const target = path.join(root, 'app3-ghoul');
    const realWrite = fsp.writeFile;
    const written = [];
    const writeSpy = vi.spyOn(fsp, 'writeFile').mockImplementation(async (file, ...rest) => {
      if (String(file) === path.join(target, 'rules.json')) throw new Error('disk full');
      await realWrite.call(fsp, file, ...rest);
      written.push(String(file));
    });
    const errors = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.join(' ')); });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let code;
    try {
      code = await newHauntMain(['ghoul', '--root', root]);
    } finally {
      writeSpy.mockRestore();
      errSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(written).toEqual([path.join(target, 'manifest.json')]);
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('new-haunt: write rules.json failed: disk full');
    expect(existsSync(target)).toBe(false);
    expect(snapshot(root)).toEqual(before);
  }, TIMEOUT);
});

// Haunt Kit invariant 18: Package validators report exactly the broken rule (Generic_Validator part)
describe('Generic_Validator mutations on a Generated_App', () => {
  let root;
  let count = 0;
  beforeAll(() => {
    root = makeRoot({ apps: false });
    const res = newHaunt(['moth', '--root', root]);
    expect(res.status, res.stderr).toBe(0);
  }, TIMEOUT);

  /** Copy app1-moth to a fresh folder, apply the mutation and validate the copy. */
  async function validateMutated(mutate) {
    const dir = `mut${(count += 1)}`;
    cpSync(path.join(root, 'app1-moth'), path.join(root, dir), { recursive: true });
    const file = (rel) => path.join(root, dir, ...rel.split('/'));
    const edit = (rel, fn) => writeFileSync(file(rel), fn(readFileSync(file(rel), 'utf8')));
    const editJson = (rel, fn) => edit(rel, (t) => { const doc = JSON.parse(t); fn(doc); return `${JSON.stringify(doc, null, 2)}\n`; });
    mutate({ edit, editJson });
    return validatePackage(root, { key: 'moth', dir });
  }

  it('passes the unmutated copy', async () => {
    expect(await validateMutated(() => {})).toEqual({ ok: true, errors: [] });
  });

  const MANIFEST = [
    ['manifest_version 2', (m) => { m.manifest_version = 2; }, 'manifest_version'],
    ['empty name', (m) => { m.name = ''; }, 'name is required'],
    ['missing version', (m) => { delete m.version; }, 'version is required'],
    ['extra permission', (m) => { m.permissions.push('tabs'); }, 'permissions'],
    ['host_permissions <all_urls>', (m) => { m.host_permissions = ['<all_urls>']; }, 'host_permissions'],
    ['no host_permissions', (m) => { m.host_permissions = []; }, 'host_permissions'],
    ['classic background', (m) => { delete m.background.type; }, 'background'],
    ['other popup', (m) => { m.action.default_popup = 'other.html'; }, 'default_popup'],
    ['content script matches differ', (m) => { m.content_scripts[0].matches = ['https://other.example/*']; }, 'content_scripts[0].matches'],
    ['content script js', (m) => { m.content_scripts[0].js = ['content.js', 'extra.js']; }, 'content_scripts[0].js'],
    ['content script run_at', (m) => { m.content_scripts[0].run_at = 'document_start'; }, 'document_idle'],
    ['content script all_frames', (m) => { m.content_scripts[0].all_frames = true; }, 'all_frames'],
    ['content script main world', (m) => { m.content_scripts[0].world = 'MAIN'; }, 'classic script'],
    ['two content scripts', (m) => { m.content_scripts.push({ ...m.content_scripts[0] }); }, 'exactly one content script'],
    ['resource matches differ', (m) => { m.web_accessible_resources[0].matches = ['https://other.example/*']; }, 'web_accessible_resources matches'],
    ['dynamic resource URLs', (m) => { m.web_accessible_resources[0].use_dynamic_url = true; }, 'use_dynamic_url'],
    ['missing rules.json resource', (m) => { m.web_accessible_resources[0].resources = m.web_accessible_resources[0].resources.filter((r) => r !== 'rules.json'); }, 'missing rules.json'],
    ['missing skeleton module', (m) => { m.web_accessible_resources[0].resources = m.web_accessible_resources[0].resources.filter((r) => r !== 'skeleton/engine.js'); }, 'missing skeleton/engine.js'],
    ['extra resource', (m) => { m.web_accessible_resources[0].resources.push('popup.js'); }, 'unexpected resource popup.js'],
  ];
  for (const [label, fn, mention] of MANIFEST) {
    it(`manifest.json: ${label}`, async () => {
      const res = await validateMutated(({ editJson }) => editJson('manifest.json', fn));
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.startsWith('manifest.json: ') && e.includes(mention)), res.errors.join('\n')).toBe(true);
    });
  }

  const OTHER = [
    ['rules.json: a match differing from the hosts', ({ editJson }) => editJson('rules.json', (d) => { d.rules[0].match = ['https://other.example/*']; }), 'rules.json: moth-fog: match'],
    ['rules.json: Fog rule removed', ({ editJson }) => editJson('rules.json', (d) => { d.rules = d.rules.filter((r) => r.effect.type !== 'fog'); }), 'rules.json: needs a fog rule'],
    ['rules.json: Rot rule removed', ({ editJson }) => editJson('rules.json', (d) => { d.rules = d.rules.filter((r) => r.effect.type !== 'rot'); }), 'rules.json: needs a rot rule'],
    ['background.js: eval', ({ edit }) => edit('background.js', (t) => `${t}\neval('1');\n`), 'background.js: eval'],
    ['popup.html: inline script', ({ edit }) => edit('popup.html', (t) => t.replace('</body>', '<script>console.log(1)</script>\n</body>')), 'popup.html: inline script'],
    ['content.js: querySelector', ({ edit }) => edit('content.js', (t) => `${t}\ndocument.querySelector('article');\n`), 'content.js: site DOM selectors'],
  ];
  for (const [label, mutate, prefix] of OTHER) {
    it(label, async () => {
      const res = await validateMutated(mutate);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.startsWith(prefix)), res.errors.join('\n')).toBe(true);
    });
  }
});

describe('Generated popup.js and content.js', () => {
  const EXT_ID = 'ext-id';
  const BASE = `chrome-extension://${EXT_ID}/`;
  const flush = async (n = 30) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };
  let appDir;
  let background;
  let popup;
  let NORMAL;

  beforeAll(async () => {
    const root = makeRoot({ apps: false });
    const res = newHaunt(['moth', '--root', root]);
    expect(res.status, res.stderr).toBe(0);
    appDir = path.join(root, 'app1-moth');
    NORMAL = JSON.parse(readFileSync(path.join(appDir, 'rules.json'), 'utf8'));
    background = await import(pathToFileURL(path.join(appDir, 'background.js')).href);
    popup = await import(pathToFileURL(path.join(appDir, 'popup.js')).href);
  }, TIMEOUT);

  function makeArea(initial = {}) {
    const data = { ...initial };
    return {
      data,
      async get(key) { return key in data ? { [key]: data[key] } : {}; },
      async set(obj) { Object.assign(data, obj); },
      async remove(key) { delete data[key]; },
    };
  }

  /** chrome mock for the popup page; messages go to the generated worker with an extension-page sender. */
  function popupChrome({ session = {}, local = {} } = {}) {
    const toTabs = [];
    const chromeApi = {
      toTabs,
      storage: { session: makeArea(session), local: makeArea(local) },
      tabs: {
        async query(q) { expect(q).toEqual({ active: true, currentWindow: true }); return [{ id: 7 }]; },
        async sendMessage(tabId, message, options) { toTabs.push({ tabId, message, options }); return { ok: true }; },
      },
      runtime: { id: EXT_ID, getURL: (p = '') => `${BASE}${p}` },
    };
    const bg = background.createBackground(chromeApi);
    chromeApi.runtime.sendMessage = (message) => bg.handleMessage(message, { id: EXT_ID, url: `${BASE}popup.html` });
    return chromeApi;
  }

  function popupDom() {
    const dom = new JSDOM(readFileSync(path.join(appDir, 'popup.html'), 'utf8'));
    return dom.window.document;
  }

  it('popup.html has the module script, no inline script and a polite status line', () => {
    const doc = popupDom();
    const scripts = [...doc.querySelectorAll('script')];
    expect(scripts.map((s) => [s.getAttribute('type'), s.getAttribute('src'), s.textContent.trim()])).toEqual([['module', 'popup.js', '']]);
    expect(doc.getElementById('status').getAttribute('aria-live')).toBe('polite');
    expect(doc.querySelector('label[for="pause"]').textContent).toContain('Pause on this tab');
    expect(doc.querySelector('label[for="demo"]').textContent).toContain('Demo mode');
  });

  it('popup.js shows the stored state and stores each toggle change', async () => {
    const chromeApi = popupChrome({ session: { 'moth.pausedTab.7': true } });
    const doc = popupDom();
    const ui = popup.createPopup({ chrome: chromeApi, document: doc });
    await ui.init();
    const pause = doc.getElementById('pause');
    const demo = doc.getElementById('demo');
    const status = doc.getElementById('status');
    expect([pause.checked, pause.disabled, demo.checked, demo.disabled]).toEqual([true, false, false, false]);
    expect(status.textContent).toBe(popup.TEXT.paused);

    pause.checked = false;
    pause.dispatchEvent(new doc.defaultView.Event('change'));
    await flush();
    expect(chromeApi.storage.session.data).toEqual({});
    expect(chromeApi.toTabs).toEqual([{ tabId: 7, message: { type: 'moth:apply-paused', paused: false }, options: { frameId: 0 } }]);
    expect(status.textContent).toBe(popup.TEXT.active);

    demo.checked = true;
    demo.dispatchEvent(new doc.defaultView.Event('change'));
    await flush();
    expect(chromeApi.storage.local.data).toEqual({ 'moth.demoMode': true });
    expect(status.textContent).toBe(popup.TEXT.demo);
    expect(readFileSync(path.join(appDir, 'popup.js'), 'utf8')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  it('popup.js shows an error and disables both toggles when the worker cannot be reached', async () => {
    const chromeApi = popupChrome();
    chromeApi.runtime.sendMessage = async () => { throw new Error('no worker'); };
    const doc = popupDom();
    await popup.createPopup({ chrome: chromeApi, document: doc }).init();
    expect(doc.getElementById('status').textContent).toBe(popup.TEXT.error);
    expect(doc.getElementById('pause').disabled).toBe(true);
    expect(doc.getElementById('demo').disabled).toBe(true);
  });

  /** Run the generated content.js in a VM with a chrome mock and a fake dynamic-import boundary. */
  async function bootContent({ sendMessage }) {
    const source = readFileSync(path.join(appDir, 'content.js'), 'utf8').replace(/\bimport\(/g, '__fakeImport(');
    const listeners = [];
    const log = { starts: [], stops: 0, imports: [], fetches: [], errors: [] };
    const api = {
      validateRules: skeleton.validateRules,
      builtinEffects: skeleton.builtinEffects,
      startPoltergeist(opts) {
        log.starts.push(JSON.parse(JSON.stringify(opts)));
        return { stop() { log.stops += 1; } };
      },
    };
    const sandbox = {
      console: { error: (...a) => log.errors.push(a.join(' ')) },
      structuredClone,
      chrome: {
        runtime: {
          id: EXT_ID,
          getURL: (p) => `${BASE}${p}`,
          sendMessage,
          onMessage: { addListener: (fn) => listeners.push(fn) },
        },
      },
      fetch: async (url) => { log.fetches.push(url); return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(NORMAL)) }; },
      __fakeImport: async (spec) => { log.imports.push(spec); return api; },
    };
    vm.runInNewContext(source, sandbox, { filename: 'content.js' });
    await flush();
    const send = (message, sender = { id: EXT_ID }) => {
      let reply;
      for (const fn of listeners) fn(message, sender, (r) => { reply = r; });
      return reply;
    };
    return { log, listeners, send };
  }

  const thresholds = (doc) => doc.rules.map((r) => [r.trigger.threshold, r.trigger.rampTo]);

  it('content.js runs the rules with Demo_Mode division, stops while paused and restarts from 0', async () => {
    const h = await bootContent({ sendMessage: async (msg) => {
      expect(msg).toEqual({ type: 'moth:content-state' });
      return { ok: true, paused: false, demoMode: true };
    } });
    expect(h.listeners).toHaveLength(1);
    expect(h.log.imports).toEqual([`${BASE}skeleton/index.js`]);
    expect(h.log.fetches).toEqual([`${BASE}rules.json`]);
    expect(h.log.starts).toHaveLength(1);
    expect(thresholds(h.log.starts[0].rules)).toEqual(thresholds(NORMAL).map(([t, r]) => [t / 60, r / 60]));
    expect(h.log.starts[0]).not.toHaveProperty('initialMeters');

    // A message from another extension is ignored.
    h.send({ type: 'moth:apply-paused', paused: true }, { id: 'other-extension' });
    expect(h.log.stops).toBe(0);

    expect(h.send({ type: 'moth:apply-paused', paused: true })).toEqual({ ok: true });
    expect(h.log.stops).toBe(1);
    expect(h.log.starts).toHaveLength(1);

    expect(h.send({ type: 'moth:apply-paused', paused: false })).toEqual({ ok: true });
    expect(h.log.starts).toHaveLength(2);
    expect(h.log.starts[1]).not.toHaveProperty('initialMeters');
    expect(h.log.starts[1].rules).toEqual(h.log.starts[0].rules);
    expect(h.log.errors).toEqual([]);
  });

  it('content.js starts nothing while the tab is paused at load', async () => {
    const h = await bootContent({ sendMessage: async () => ({ ok: true, paused: true, demoMode: false }) });
    expect(h.log.starts).toHaveLength(0);
    h.send({ type: 'moth:apply-paused', paused: false });
    expect(h.log.starts).toHaveLength(1);
    expect(thresholds(h.log.starts[0].rules)).toEqual(thresholds(NORMAL));
  });

  it('content.js treats storage failures, an unreachable worker and a malformed reply as not paused with normal timing', async () => {
    // Real generated worker whose storage reads throw.
    const chromeApi = {
      storage: {
        session: { async get() { throw new Error('session unavailable'); } },
        local: { async get() { throw new Error('local unavailable'); } },
      },
      runtime: { id: EXT_ID, getURL: (p = '') => `${BASE}${p}` },
    };
    const bg = background.createBackground(chromeApi);
    const viaWorker = await bootContent({ sendMessage: (msg) => bg.handleMessage(msg, { id: EXT_ID, tab: { id: 3 } }) });
    const unreachable = await bootContent({ sendMessage: async () => { throw new Error('Could not establish connection'); } });
    const malformed = await bootContent({ sendMessage: async () => ({ paused: true, demoMode: true }) });
    for (const h of [viaWorker, unreachable, malformed]) {
      expect(h.log.starts).toHaveLength(1);
      expect(thresholds(h.log.starts[0].rules)).toEqual(thresholds(NORMAL));
    }
    expect(unreachable.log.errors).toHaveLength(1);
    expect(unreachable.log.errors[0]).toContain('[poltergeist:moth]');
  });
});

// Requirement 13.6: nothing in the real repository was created, modified or deleted. Runs last.
describe('real repository', () => {
  it('is unchanged by every run in this file', () => {
    expect(snapshot(REPO_ROOT, { mtime: true })).toEqual(REAL_BEFORE);
  });
});
