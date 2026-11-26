import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  APP_DIR, WEB_SCOPE, EXPECTED_RULES, FORBIDDEN_MANIFEST_KEYS,
  validatePackage, validateManifestDocument, validateRulesDocument,
} from '../../scripts/validate-graveyard-package.mjs';
import { REPO_ROOT } from '../../scripts/sync-skeleton.mjs';

const APP = path.join(REPO_ROOT, APP_DIR);
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const PERMISSION_ERROR = 'manifest.json: permissions must be exactly ["storage", "tabGroups"]';

const temps = [];
afterEach(async () => {
  while (temps.length) await fs.rm(temps.pop(), { recursive: true, force: true });
});

/** Temp repo with root skeleton production files and the graveyard package (manifest, rules, mirror). */
async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graveyard-pkg-'));
  temps.push(root);
  const noTests = (src) => !path.relative(path.join(REPO_ROOT, 'skeleton'), src).split(path.sep).includes('test');
  await fs.cp(path.join(REPO_ROOT, 'skeleton'), path.join(root, 'skeleton'), { recursive: true, filter: noTests });
  await fs.cp(path.join(APP, 'skeleton'), path.join(root, APP_DIR, 'skeleton'), { recursive: true });
  for (const f of ['manifest.json', 'rules.json']) await fs.copyFile(path.join(APP, f), path.join(root, APP_DIR, f));
  return root;
}
const put = async (root, rel, text) => {
  const p = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text);
};
const editJson = async (root, name, fn) => {
  const p = path.join(root, APP_DIR, name);
  const doc = await readJson(p);
  fn(doc);
  await fs.writeFile(p, JSON.stringify(doc, null, 2));
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
  await rec(root);
  return out;
}

describe('real graveyard package', () => {
  it('passes every package check', async () => {
    const res = await validatePackage(REPO_ROOT);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('has exactly the three rules in order on the web scope with the timeAway meter', async () => {
    const doc = await readJson(path.join(APP, 'rules.json'));
    expect(doc.rules.map((r) => r.id)).toEqual(['graveyard-fog', 'graveyard-rot', 'graveyard-tombstone']);
    expect(doc.rules.map((r) => r.id)).toEqual(EXPECTED_RULES.map((r) => r.id));
    for (const r of doc.rules) {
      expect(r.match).toEqual([...WEB_SCOPE]);
      expect(r.trigger.meter).toBe('timeAway');
    }
    expect(doc.rules[2].trigger).toEqual({ meter: 'timeAway', threshold: 86400 });
    expect(validateRulesDocument(doc)).toEqual([]);
  });

  it('is MV3 with storage and tabGroups only, no host permissions, incognito not allowed, one classic top-frame content script', async () => {
    const m = await readJson(path.join(APP, 'manifest.json'));
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(['storage', 'tabGroups']);
    expect(m.incognito).toBe('not_allowed');
    for (const key of FORBIDDEN_MANIFEST_KEYS) expect(m[key], key).toBeUndefined();
    expect(m.content_scripts).toEqual([{ matches: [...WEB_SCOPE], js: ['content.js'], run_at: 'document_idle', all_frames: false }]);
    expect(m.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(m.action.default_popup).toBe('popup.html');
    expect(m.web_accessible_resources).toHaveLength(1);
    expect(m.web_accessible_resources[0]).toMatchObject({ matches: [...WEB_SCOPE], use_dynamic_url: false });
  });

  it('keeps the generated mirror unignored by Git', () => {
    for (const p of [`${APP_DIR}/skeleton`, `${APP_DIR}/skeleton/`, `${APP_DIR}/skeleton/index.js`, `${APP_DIR}/skeleton/effects/tombstone.js`]) {
      let status = 0;
      try { execFileSync('git', ['check-ignore', '-q', p], { cwd: REPO_ROOT, stdio: 'ignore' }); } catch (e) { status = e.status; }
      expect(status, `${p} must not be ignored`).toBe(1);
    }
  });

  it('runs check:graveyard from pretest and leaves the test script unchanged', async () => {
    const pkg = await readJson(path.join(REPO_ROOT, 'package.json'));
    expect(pkg.scripts.pretest).toBe('npm run check:skeletons');
    expect(pkg.scripts['check:graveyard']).toBe('node scripts/sync-skeleton.mjs --check --app graveyard');
    expect(pkg.scripts['build:graveyard']).toBe('node scripts/sync-skeleton.mjs --app graveyard');
    expect(pkg.scripts.test).toBe('npm run check:doomscroll && vitest --run');
  });
});

describe('manifest document checks', () => {
  const base = async () => readJson(path.join(APP, 'manifest.json'));
  const scopeOnly = (m) => validateManifestDocument(m).filter((e) => !/web_accessible_resources (exposes|is missing)/.test(e));

  it.each(FORBIDDEN_MANIFEST_KEYS)('rejects %s', async (key) => {
    const m = await base();
    m[key] = key.endsWith('permissions') ? ['https://*/*'] : {};
    expect(scopeOnly(m)).toEqual([`manifest.json: ${key} is not allowed`]);
  });

  it.each([
    ['a missing tabGroups', ['storage']],
    ['an added alarms', ['storage', 'tabGroups', 'alarms']],
    ['a duplicated tabGroups', ['storage', 'tabGroups', 'tabGroups']],
    ['another order', ['tabGroups', 'storage']],
  ])('reports only the permission error for %s', async (_label, permissions) => {
    const m = await base();
    m.permissions = permissions;
    expect(scopeOnly(m)).toEqual([PERMISSION_ERROR]);
  });

  it('rejects a missing incognito setting, name, and version', async () => {
    const m = await base();
    delete m.incognito; delete m.name; delete m.version;
    expect(scopeOnly(m)).toEqual(expect.arrayContaining([
      'manifest.json: incognito must be "not_allowed"', 'manifest.json: name is required', 'manifest.json: version is required',
    ]));
  });

  it('rejects all frames, a module content script, the main world, and use_dynamic_url true', async () => {
    const m = await base();
    Object.assign(m.content_scripts[0], { all_frames: true, type: 'module', world: 'MAIN' });
    m.web_accessible_resources[0].use_dynamic_url = true;
    expect(scopeOnly(m)).toEqual(expect.arrayContaining([
      'manifest.json: content script must be top frame only (all_frames false)',
      'manifest.json: content script must be classic',
      'manifest.json: content script must use the isolated world',
      'manifest.json: web_accessible_resources must set use_dynamic_url false for content-script import/fetch compatibility',
    ]));
  });
});

describe('temporary package fixtures', () => {
  it('passes for an untouched copy', async () => {
    expect((await validatePackage(await makeRepo())).errors).toEqual([]);
  });

  it('aggregates every failure kind in one run without writing', async () => {
    const root = await makeRepo();
    await editJson(root, 'manifest.json', (m) => {
      m.permissions.push('tabs');
      m.host_permissions = ['https://*/*'];
      m.content_scripts[0].matches.push('<all_urls>');
      const war = m.web_accessible_resources[0];
      war.resources = war.resources.filter((r) => r !== 'skeleton/effects/rot.js');
      war.resources.push('skeleton/rule-schema.json');
    });
    await editJson(root, 'rules.json', (doc) => { doc.rules[2].trigger.threshold = 60; });
    await put(root, `${APP_DIR}/skeleton/test/leaked.test.js`, 'x');
    await put(root, `${APP_DIR}/content.js`, 'eval("1");\nsetTimeout("go()", 5);');
    await put(root, `${APP_DIR}/popup.html`, '<script>x()</script><button onclick="y()">z</button>');
    await put(root, `${APP_DIR}/test/ignored.js`, 'eval("1")');
    const before = await snapshot(root);

    const { ok, errors } = await validatePackage(root);
    expect(ok).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([
      PERMISSION_ERROR,
      'manifest.json: host_permissions is not allowed',
      'manifest.json: content_scripts[0].matches must be exactly the web scope',
      'manifest.json: web_accessible_resources is missing skeleton/effects/rot.js',
      'manifest.json: web_accessible_resources exposes unexpected resource skeleton/rule-schema.json',
      'rules.json: graveyard-tombstone: trigger must be {"meter":"timeAway","threshold":86400}',
      'skeleton/test/leaked.test.js: test file in the generated skeleton',
      'content.js: eval',
      'content.js: string-valued timer',
      'popup.html: inline script body',
      'popup.html: inline event-handler attribute',
    ]));
    expect(errors.some((e) => e.startsWith('test/'))).toBe(false);
    expect(await snapshot(root)).toEqual(before);
  });

  it('flags a broadened rule match, a changed param, and a reordered rule list', async () => {
    const root = await makeRepo();
    await editJson(root, 'rules.json', (doc) => {
      doc.rules[0].match = ['<all_urls>'];
      doc.rules[1].effect.params.maxFraction = 0.9;
    });
    let { errors } = await validatePackage(root);
    expect(errors).toEqual(expect.arrayContaining([
      'rules.json: graveyard-fog: match must be exactly the web scope',
      'rules.json: graveyard-rot: effect type/params differ from expected',
    ]));
    await editJson(root, 'rules.json', (doc) => { doc.rules.reverse(); });
    ({ errors } = await validatePackage(root));
    expect(errors).toContain('rules.json: rule ids/order must be graveyard-fog, graveyard-rot, graveyard-tombstone');
  });

  it('exposes a test file through a WAR glob as an unexpected test resource', async () => {
    const root = await makeRepo();
    await put(root, `${APP_DIR}/skeleton/effects/rot.test.js`, 'x');
    await editJson(root, 'manifest.json', (m) => { m.web_accessible_resources[0].resources.push('skeleton/effects/*'); });
    const { errors } = await validatePackage(root);
    expect(errors).toEqual(expect.arrayContaining([
      'skeleton/effects/rot.test.js: test file in the generated skeleton',
      'manifest.json: web_accessible_resources exposes unexpected resource skeleton/effects/rot.test.js',
      'skeleton mirror: extra:   effects/rot.test.js',
    ]));
  });

  it('reports a stale or missing mirror', async () => {
    const root = await makeRepo();
    await fs.appendFile(path.join(root, 'skeleton', 'meters.js'), '\n// newer\n');
    await fs.rm(path.join(root, APP_DIR, 'skeleton', 'match.js'));
    const { errors } = await validatePackage(root);
    expect(errors).toEqual(expect.arrayContaining(['skeleton mirror: changed: meters.js', 'skeleton mirror: missing: match.js']));
    expect(errors.join('\n')).toMatch(/missing import "\.\/match\.js"/);
  });
});

describe('check:graveyard npm script', () => {
  // One command string with shell: true resolves npm/npm.cmd on Windows and POSIX without user-controlled arguments.
  const runCheck = (cwd) => spawnSync('npm run check:graveyard', { cwd, shell: true, encoding: 'utf8' });

  it('passes on a copy, then fails read-only on an added tabs permission', async () => {
    const root = await makeRepo();
    await fs.copyFile(path.join(REPO_ROOT, 'package.json'), path.join(root, 'package.json'));
    await fs.cp(path.join(REPO_ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });

    const control = runCheck(root);
    expect(control.status, control.stderr).toBe(0);
    expect(control.stdout).toMatch(/Tab Graveyard skeleton mirror is in sync and the package is valid\./);

    await editJson(root, 'manifest.json', (m) => { m.permissions.push('tabs'); });
    const before = await snapshot(root);
    const res = runCheck(root);
    expect(res.status).not.toBe(0);
    expect(res.stderr.split(/\r?\n/).some((l) => l.includes(PERMISSION_ERROR))).toBe(true);
    expect(await snapshot(root)).toEqual(before);
  }, 60_000);
});
