import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { promises as fs, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as sync from '../../scripts/sync-skeleton.mjs';
import * as wrapper from '../../scripts/sync-doomscroll-skeleton.mjs';

const { REPO_ROOT, APPS } = sync;
const SCRIPTS = path.join(REPO_ROOT, 'scripts');

const temps = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (temps.length) await fs.rm(temps.pop(), { recursive: true, force: true });
});

let logs;
beforeEach(() => {
  logs = { out: [], err: [] };
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { logs.err.push(a.join(' ')); });
});

const tempDir = async (prefix) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(root);
  return root;
};

/** Temp repo with root skeleton production files and each listed app's manifest, rules, and mirror. */
async function makeRepo(appKeys = Object.keys(APPS), { withScripts = false } = {}) {
  const root = await tempDir('poltergeist-sync-');
  const noTests = (src) => !path.relative(path.join(REPO_ROOT, 'skeleton'), src).split(path.sep).includes('test');
  await fs.cp(path.join(REPO_ROOT, 'skeleton'), path.join(root, 'skeleton'), { recursive: true, filter: noTests });
  for (const key of appKeys) {
    const { dir } = APPS[key];
    await fs.cp(path.join(REPO_ROOT, dir, 'skeleton'), path.join(root, dir, 'skeleton'), { recursive: true });
    for (const f of ['manifest.json', 'rules.json']) await fs.copyFile(path.join(REPO_ROOT, dir, f), path.join(root, dir, f));
  }
  if (withScripts) {
    await fs.copyFile(path.join(REPO_ROOT, 'package.json'), path.join(root, 'package.json'));
    await fs.cp(SCRIPTS, path.join(root, 'scripts'), { recursive: true });
  }
  return root;
}

const put = async (root, rel, data) => {
  const p = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
};

async function snapshot(root) {
  const out = {};
  async function rec(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await rec(p);
      else out[path.relative(root, p)] = [(await fs.readFile(p)).toString('base64'), (await fs.stat(p)).mtimeMs];
    }
  }
  if (existsSync(root)) await rec(root);
  return out;
}

/** Independent reading of the admitted files (everything except a top-level test/ directory). */
async function admitted(dir) {
  const out = new Map();
  async function rec(abs, rel) {
    let entries;
    try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && e.name === 'test' && e.isDirectory()) continue;
      if (e.isDirectory()) await rec(path.join(abs, e.name), r);
      else out.set(r, await fs.readFile(path.join(abs, e.name)));
    }
  }
  await rec(dir, '');
  return out;
}
const sameMaps = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.has(k) && v.equals(b.get(k)));

describe('app registry', () => {
  it('registers doomscroll and graveyard with their dirs, labels, build scripts, and validators', async () => {
    expect(Object.keys(APPS)).toEqual(['doomscroll', 'graveyard']);
    expect(APPS.doomscroll).toMatchObject({ dir: 'app1-doomscroll', label: 'Doomscroll', buildScript: 'build:doomscroll' });
    expect(APPS.graveyard).toMatchObject({ dir: 'app2-tab-graveyard', label: 'Tab Graveyard', buildScript: 'build:graveyard' });
    expect(Object.isFrozen(APPS) && Object.isFrozen(APPS.graveyard)).toBe(true);
    for (const { validator } of Object.values(APPS)) {
      const mod = await import(pathToFileURL(path.join(SCRIPTS, validator)).href);
      expect(typeof mod.validatePackage).toBe('function');
    }
  });

  it('wires the package.json scripts to the registry', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts).toMatchObject({
      'build:doomscroll': 'node scripts/sync-skeleton.mjs --app doomscroll',
      'check:doomscroll': 'node scripts/sync-skeleton.mjs --check --app doomscroll',
      'build:graveyard': 'node scripts/sync-skeleton.mjs --app graveyard',
      'check:graveyard': 'node scripts/sync-skeleton.mjs --check --app graveyard',
      'build:skeletons': 'node scripts/sync-skeleton.mjs',
      'check:skeletons': 'node scripts/sync-skeleton.mjs --check',
    });
  });

  it('parses --check and repeated --app, defaults to every app, and rejects unknown arguments', () => {
    expect(sync.parseArgs([])).toEqual({ checkOnly: false, apps: ['doomscroll', 'graveyard'] });
    expect(sync.parseArgs(['--check'])).toEqual({ checkOnly: true, apps: ['doomscroll', 'graveyard'] });
    expect(sync.parseArgs(['--app', 'graveyard', '--check', '--app', 'graveyard'])).toEqual({ checkOnly: true, apps: ['graveyard'] });
    expect(sync.parseArgs(['--app', 'nope']).error).toMatch(/Unknown argument\(s\): --app nope/);
    expect(sync.parseArgs(['--app']).error).toMatch(/--app/);
    expect(sync.parseArgs(['--watch']).error).toMatch(/--watch/);
  });

  it('rejects unknown app keys, including inherited property names', async () => {
    for (const key of ['nope', 'constructor', '__proto__', 'toString']) {
      await expect(sync.check(REPO_ROOT, key)).rejects.toThrow(/Unknown app/);
      await expect(sync.build(REPO_ROOT, key)).rejects.toThrow(/Unknown app/);
    }
  });

  it('returns exit code 2 for bad arguments without touching files', async () => {
    const root = await makeRepo();
    const before = await snapshot(root);
    expect(await sync.main(['--bogus'], root)).toBe(2);
    expect(logs.err.join('\n')).toMatch(/Unknown argument\(s\): --bogus/);
    expect(await snapshot(root)).toEqual(before);
  });

  it('finds both real mirrors in sync', async () => {
    for (const key of Object.keys(APPS)) expect((await sync.check(REPO_ROOT, key)).diagnostics, key).toEqual([]);
  });
});

describe('build and check modes', () => {
  it('builds every app when --app is omitted', async () => {
    const root = await makeRepo();
    for (const { dir } of Object.values(APPS)) await fs.rm(path.join(root, dir, 'skeleton'), { recursive: true });
    expect(await sync.main([], root)).toBe(0);
    for (const key of Object.keys(APPS)) expect((await sync.check(root, key)).ok, key).toBe(true);
    expect(logs.out.filter((l) => /^Synchronized \d+ file\(s\) into .*\/skeleton\/; the package is valid\.$/.test(l))).toHaveLength(2);
  });

  it('builds only the selected app with --app', async () => {
    const root = await makeRepo();
    for (const { dir } of Object.values(APPS)) await fs.rm(path.join(root, dir, 'skeleton'), { recursive: true });
    expect(await sync.main(['--app', 'graveyard'], root)).toBe(0);
    expect((await sync.check(root, 'graveyard')).ok).toBe(true);
    expect(existsSync(path.join(root, 'app1-doomscroll', 'skeleton'))).toBe(false);
  });

  it('writes only inside <appDir>/skeleton and removes stale files there', async () => {
    const root = await makeRepo();
    await put(root, 'app2-tab-graveyard/skeleton/stale.js', 'old');
    await put(root, 'app2-tab-graveyard/skeleton/test/leaked.test.js', 'old');
    await put(root, 'app2-tab-graveyard/sentinel.txt', 'keep');
    await put(root, 'app1-doomscroll/skeleton/stale.js', 'other app');
    const outside = (snap) => Object.fromEntries(Object.entries(snap).filter(([k]) => !k.startsWith(path.join('app2-tab-graveyard', 'skeleton'))));
    const before = outside(await snapshot(root));

    const written = await sync.build(root, 'graveyard');
    const again = await sync.build(root, 'graveyard');
    expect(again).toEqual(written);
    expect(existsSync(path.join(root, 'app2-tab-graveyard', 'skeleton', 'stale.js'))).toBe(false);
    expect(existsSync(path.join(root, 'app2-tab-graveyard', 'skeleton', 'test'))).toBe(false);
    expect(outside(await snapshot(root))).toEqual(before);
    expect(sameMaps(await admitted(path.join(root, 'skeleton')), await admitted(path.join(root, 'app2-tab-graveyard', 'skeleton')))).toBe(true);
  });

  it('--check reports drift per app with its own message and writes nothing', async () => {
    const root = await makeRepo();
    await fs.appendFile(path.join(root, 'app2-tab-graveyard', 'skeleton', 'engine.js'), ' ');
    const before = await snapshot(root);
    expect(await sync.main(['--check'], root)).toBe(1);
    expect(logs.out).toContain('Doomscroll skeleton mirror is in sync and the package is valid.');
    expect(logs.err).toContain('Tab Graveyard skeleton mirror is out of sync (run: npm run build:graveyard):');
    expect(logs.err).toContain('  changed: engine.js');
    expect(await snapshot(root)).toEqual(before);
  });

  it('--check fails when a validator fails even though the mirror is in sync', async () => {
    const root = await makeRepo();
    const mp = path.join(root, 'app2-tab-graveyard', 'manifest.json');
    const m = JSON.parse(await fs.readFile(mp, 'utf8'));
    m.permissions.push('tabs');
    await fs.writeFile(mp, JSON.stringify(m));
    expect(await sync.main(['--check', '--app', 'graveyard'], root)).toBe(1);
    expect(logs.err).toContain('Tab Graveyard package validation failed:');
    expect(logs.err).toContain('  manifest.json: permissions must be exactly ["storage"]');
  });
});

describe('Doomscroll-only repository', () => {
  it('check:doomscroll passes without app2-tab-graveyard', async () => {
    const root = await makeRepo(['doomscroll'], { withScripts: true });
    expect(existsSync(path.join(root, 'app2-tab-graveyard'))).toBe(false);
    const res = spawnSync('npm run check:doomscroll', { cwd: root, shell: true, encoding: 'utf8' });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/Doomscroll skeleton mirror is in sync and the package is valid\./);
  }, 60_000);
});

describe('Doomscroll wrapper', () => {
  it('keeps its exports and defaults check/build to Doomscroll', async () => {
    expect(Object.keys(wrapper).sort()).toEqual(['REPO_ROOT', 'build', 'check', 'compareFileMaps', 'formatDiagnostics', 'isExcluded', 'listFiles']);
    for (const name of ['REPO_ROOT', 'isExcluded', 'listFiles', 'compareFileMaps', 'formatDiagnostics']) expect(wrapper[name]).toBe(sync[name]);
    expect(await wrapper.check()).toEqual(await sync.check(REPO_ROOT, 'doomscroll'));
    const root = await makeRepo();
    await put(root, 'app1-doomscroll/skeleton/stale.js', 'x');
    await wrapper.build(root);
    expect((await sync.check(root, 'doomscroll')).ok).toBe(true);
    expect(existsSync(path.join(root, 'app2-tab-graveyard', 'skeleton', 'index.js'))).toBe(true);
  });

  it('keeps its --check CLI, messages, and exit codes', async () => {
    const root = await makeRepo(['doomscroll'], { withScripts: true });
    const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts', 'sync-doomscroll-skeleton.mjs'), ...args], { cwd: root, encoding: 'utf8' });

    let res = run('--check');
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('Doomscroll skeleton mirror is in sync and the package is valid.');

    await fs.appendFile(path.join(root, 'skeleton', 'engine.js'), '\n// newer\n');
    res = run('--check');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Doomscroll skeleton mirror is out of sync (run: npm run build:doomscroll):');
    expect(res.stderr).toContain('  changed: engine.js');

    res = run('--bogus');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Unknown argument(s): --bogus');

    res = run();
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/Synchronized \d+ file\(s\) into app1-doomscroll\/skeleton\/; the package is valid\./);
  }, 60_000);
});

describe('properties', () => {
  // Feature: tab-graveyard-app, Property 6: Generated mirrors are exact for both apps
  it('Property 6: for each app, check passes iff the mirror has exactly the admitted root files with equal bytes', async () => {
    const root = await tempDir('poltergeist-p6-');
    const names = ['index.js', 'engine.js', 'test.js', 'effects/rot.js', 'effects/test/x.js', 'test/a.test.js', 'test/browser/b.pw.js'];
    const bytes = fc.uint8Array({ maxLength: 6 }).map((a) => Buffer.from(a));
    const mutation = fc.oneof(
      fc.constant({ kind: 'none' }),
      fc.record({ kind: fc.constant('drop'), i: fc.nat() }),
      fc.record({ kind: fc.constant('change'), i: fc.nat(), b: fc.integer({ min: 0, max: 255 }) }),
      fc.record({ kind: fc.constant('add'), name: fc.constantFrom(...names, 'stray.js'), data: bytes }),
    );
    await fc.assert(fc.asyncProperty(
      fc.constantFrom(...Object.keys(APPS)), fc.dictionary(fc.constantFrom(...names), bytes), mutation,
      async (appKey, files, mut) => {
        await fs.rm(path.join(root, 'skeleton'), { recursive: true, force: true });
        const target = path.join(root, APPS[appKey].dir, 'skeleton');
        await fs.rm(target, { recursive: true, force: true });
        const mirror = new Map(Object.entries(files));
        for (const [rel, data] of mirror) await put(root, `skeleton/${rel}`, data);
        const keys = [...mirror.keys()];
        if (mut.kind === 'drop' && keys.length) mirror.delete(keys[mut.i % keys.length]);
        if (mut.kind === 'change' && keys.length) {
          const k = keys[mut.i % keys.length];
          mirror.set(k, Buffer.concat([mirror.get(k), Buffer.from([mut.b])]));
        }
        if (mut.kind === 'add') mirror.set(mut.name, mut.data);
        await fs.mkdir(target, { recursive: true });
        for (const [rel, data] of mirror) await put(root, `${APPS[appKey].dir}/skeleton/${rel}`, data);

        const res = await sync.check(root, appKey);
        const exact = sameMaps(await admitted(path.join(root, 'skeleton')), await admitted(target));
        expect(res.ok).toBe(exact);
      },
    ), { numRuns: 100 });
  }, 120_000);
});
