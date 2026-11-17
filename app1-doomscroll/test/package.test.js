import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  HOSTS, EXPECTED_RULES, validatePackage, validateManifestDocument, validateRulesDocument,
  resolveGraph, extractStaticSpecifiers, scanSource,
} from '../../scripts/validate-doomscroll-package.mjs';
import { compareFileMaps, REPO_ROOT } from '../../scripts/sync-doomscroll-skeleton.mjs';

const APP = path.join(REPO_ROOT, 'app1-doomscroll');
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

const temps = [];
afterEach(async () => {
  while (temps.length) await fs.rm(temps.pop(), { recursive: true, force: true });
});

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doomscroll-pkg-'));
  temps.push(root);
  const noTests = (src) => !path.relative(path.join(REPO_ROOT, 'skeleton'), src).split(path.sep).includes('test');
  await fs.cp(path.join(REPO_ROOT, 'skeleton'), path.join(root, 'skeleton'), { recursive: true, filter: noTests });
  await fs.cp(path.join(APP, 'skeleton'), path.join(root, 'app1-doomscroll', 'skeleton'), { recursive: true });
  for (const f of ['manifest.json', 'rules.json']) await fs.copyFile(path.join(APP, f), path.join(root, 'app1-doomscroll', f));
  return root;
}
const put = async (root, rel, text) => {
  const p = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text);
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

describe('real package', () => {
  it('passes every package check', async () => {
    const res = await validatePackage(REPO_ROOT);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('has the exact rules (ids, order, meters, params, message, undo)', async () => {
    const doc = await readJson(path.join(APP, 'rules.json'));
    expect(doc.rules.map((r) => r.id)).toEqual(EXPECTED_RULES.map((r) => r.id));
    expect(doc.rules[3].effect.params.message).toBe('You have scrolled long enough. Close this tab and take a break.');
    expect(doc.rules.map((r) => r.undo)).toEqual([
      { mode: 'fade', durationMs: 400 }, { mode: 'instant' }, { mode: 'instant' }, { mode: 'fade', durationMs: 600 },
    ]);
    expect(validateRulesDocument(doc)).toEqual([]);
  });

  it('is Manifest V3 with exact scope, one classic top-frame content script, popup and module worker', async () => {
    const m = await readJson(path.join(APP, 'manifest.json'));
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(['storage']);
    expect(m.host_permissions).toEqual([...HOSTS]);
    expect(m.content_scripts).toHaveLength(1);
    expect(m.content_scripts[0]).toMatchObject({ js: ['content.js'], all_frames: false, run_at: 'document_idle' });
    expect(m.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(m.action.default_popup).toBe('popup.html');
  });

  it('keeps the generated mirror unignored by Git', () => {
    for (const p of ['app1-doomscroll/skeleton', 'app1-doomscroll/skeleton/', 'app1-doomscroll/skeleton/index.js', 'app1-doomscroll/skeleton/effects/rot.js']) {
      let status = 0;
      try { execFileSync('git', ['check-ignore', '-q', p], { cwd: REPO_ROOT, stdio: 'ignore' }); } catch (e) { status = e.status; }
      expect(status, `${p} must not be ignored`).toBe(1);
    }
  });

  it('runs check:doomscroll before vitest with && short-circuiting', async () => {
    const pkg = await readJson(path.join(REPO_ROOT, 'package.json'));
    expect(pkg.scripts['check:doomscroll']).toContain('--check');
    const parts = pkg.scripts.test.split('&&').map((s) => s.trim());
    expect(parts[0]).toBe('npm run check:doomscroll');
    expect(parts[1]).toMatch(/^vitest\b/);
    expect(parts).toHaveLength(2);
  });
});

describe('import graph', () => {
  it('extracts import and export-from specifiers only', () => {
    const src = `import a from './a.js';\nimport {b,\n c} from "./b.js";\nexport { x } from './c.js';\nexport * from './d.js';\nimport './e.js';\nexport const y = 'z';\n// import q from './nope.js'`;
    expect(extractStaticSpecifiers(src)).toEqual(['./a.js', './b.js', './c.js', './d.js', './e.js']);
  });

  it('rejects bare, absolute, remote, missing and escaping imports', () => {
    const files = new Map([
      ['skeleton/index.js', "import 'lodash';\nimport '/abs.js';\nimport 'https://evil.test/x.js';\nimport '//evil.test/x.js';\nimport './gone.js';\nimport '../../outside.js';\nexport * from './ok.js';"],
      ['skeleton/ok.js', 'export const a = 1;'],
    ]);
    const { errors, reachable } = resolveGraph(files, 'skeleton/index.js');
    expect([...reachable].sort()).toEqual(['skeleton/index.js', 'skeleton/ok.js']);
    expect(errors.join('\n')).toMatch(/bare import "lodash"/);
    expect(errors.join('\n')).toMatch(/absolute import "\/abs\.js"/);
    expect(errors.filter((e) => /remote import/.test(e))).toHaveLength(2);
    expect(errors.join('\n')).toMatch(/missing import "\.\/gone\.js"/);
    expect(errors.join('\n')).toMatch(/escapes the extension root/);
  });
});

describe('prohibited code scan', () => {
  const cases = [
    ['a.js', 'eval("1")', 'eval'],
    ['a.js', 'const f = new Function("return 1");', 'new Function'],
    ['a.js', 'setTimeout("go()", 5)', 'string-valued timer'],
    ['a.js', 'window.setInterval(`go()`, 5)', 'string-valued timer'],
    ['a.js', "import('https://evil.test/x.js')", 'remote executable URL'],
    ['a.js', "importScripts('//evil.test/x.js')", 'remote executable URL'],
    ['a.js', "import x from 'http://evil.test/x.js'", 'remote executable URL'],
    ['a.html', '<script src="https://evil.test/x.js"></script>', 'remote executable URL'],
    ['a.html', '<script>alert(1)</script>', 'inline script body'],
    ['a.html', '<button onclick="go()">x</button>', 'inline event-handler attribute'],
  ];
  it.each(cases)('flags %s: %s', (file, src, construct) => {
    expect(scanSource(file, src)).toContain(`${file}: ${construct}`);
  });

  it('accepts local scripts, function timers and comments', () => {
    expect(scanSource('a.html', '<script src="popup.js"></script><p>ok</p>')).toEqual([]);
    expect(scanSource('a.js', '// eval("x")\nsetTimeout(() => {}, 1);\nsetTimeout(fn, 1);')).toEqual([]);
  });

  it('reports path and construct through validatePackage, aggregating all failures', async () => {
    const root = await makeRepo();
    await put(root, 'app1-doomscroll/content.js', 'eval("1");\nnew Function("x");');
    await put(root, 'app1-doomscroll/popup.html', '<script>x()</script><a onclick="y()">z</a>');
    await put(root, 'app1-doomscroll/test/ignored.js', 'eval("1")');
    const { ok, errors } = await validatePackage(root);
    expect(ok).toBe(false);
    expect(errors).toEqual(expect.arrayContaining([
      'content.js: eval', 'content.js: new Function', 'popup.html: inline script body', 'popup.html: inline event-handler attribute',
    ]));
    expect(errors.some((e) => e.startsWith('test/'))).toBe(false);
  });
});

describe('temporary package fixtures', () => {
  it('passes for an untouched copy', async () => {
    expect((await validatePackage(await makeRepo())).errors).toEqual([]);
  });

  it('reports a stale mirror (source changed) without writing', async () => {
    const root = await makeRepo();
    await fs.appendFile(path.join(root, 'skeleton', 'engine.js'), '\n// newer\n');
    const before = await snapshot(root);
    const { errors } = await validatePackage(root);
    expect(errors).toContain('skeleton mirror: changed: engine.js');
    expect(await snapshot(root)).toEqual(before);
  });

  it('reports missing, extra and byte-changed mirror files together', async () => {
    const root = await makeRepo();
    const gen = path.join(root, 'app1-doomscroll', 'skeleton');
    await fs.rm(path.join(gen, 'match.js'));
    await put(root, 'app1-doomscroll/skeleton/stray.js', 'export {};');
    await fs.appendFile(path.join(gen, 'meters.js'), ' ');
    await put(root, 'app1-doomscroll/skeleton/test/leaked.test.js', 'x');
    const { errors } = await validatePackage(root);
    expect(errors).toEqual(expect.arrayContaining([
      'skeleton mirror: missing: match.js',
      'skeleton mirror: extra:   stray.js',
      'skeleton mirror: changed: meters.js',
    ]));
    expect(errors.join('\n')).toMatch(/missing import "\.\/match\.js"/);
  });

  it('rejects a generated test file and broader WAR resources/origins', async () => {
    const root = await makeRepo();
    await put(root, 'app1-doomscroll/skeleton/test/leaked.test.js', 'x');
    const mp = path.join(root, 'app1-doomscroll', 'manifest.json');
    const m = await readJson(mp);
    m.web_accessible_resources[0].resources.push('skeleton/test/leaked.test.js', 'skeleton/effects/*');
    m.web_accessible_resources[0].matches.push('https://evil.test/*');
    await fs.writeFile(mp, JSON.stringify(m));
    const { errors } = await validatePackage(root);
    const text = errors.join('\n');
    expect(text).toMatch(/unexpected resource skeleton\/test\/leaked\.test\.js \(test file\)/);
    expect(text).toMatch(/web_accessible_resources matches must be exactly/);
  });

  it('reports a missing WAR resource and wrong rules aggregated', async () => {
    const root = await makeRepo();
    const mp = path.join(root, 'app1-doomscroll', 'manifest.json');
    const m = await readJson(mp);
    m.web_accessible_resources[0].resources = m.web_accessible_resources[0].resources.filter((r) => r !== 'skeleton/effects/rot.js');
    m.permissions.push('tabs');
    await fs.writeFile(mp, JSON.stringify(m));
    const rp = path.join(root, 'app1-doomscroll', 'rules.json');
    const r = await readJson(rp);
    r.rules[1].effect.params.periodMs = 100;
    await fs.writeFile(rp, JSON.stringify(r));
    const { errors } = await validatePackage(root);
    expect(errors).toEqual(expect.arrayContaining([
      'manifest.json: web_accessible_resources is missing skeleton/effects/rot.js',
      'manifest.json: permissions must be exactly ["storage"]',
      'rules.json: doomscroll-flicker: effect type/params differ from expected',
    ]));
  });
});

describe('properties', () => {
  let manifest; let rules;
  const load = async () => {
    manifest ??= await readJson(path.join(APP, 'manifest.json'));
    rules ??= await readJson(path.join(APP, 'rules.json'));
  };
  const opts = { allFiles: [], reachable: new Set() };
  const scopeErrors = (m) => validateManifestDocument(m, opts).filter((e) => !/web_accessible_resources (exposes|is missing)/.test(e));

  const hostList = fc.array(fc.constantFrom(...HOSTS, 'https://youtube.com/*', 'https://*.x.com/*', 'http://x.com/*', '<all_urls>'), { maxLength: 6 });

  // Feature: doomscroll-app, Property 1: Scope-bearing lists are exactly equal
  it('Property 1: any scope-bearing list that is not exactly the approved hosts is rejected', async () => {
    await load();
    expect(scopeErrors(manifest)).toEqual([]);
    const targets = [
      (m, v) => { m.host_permissions = v; },
      (m, v) => { m.content_scripts[0].matches = v; },
      (m, v) => { m.web_accessible_resources[0].matches = v; },
    ];
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 }), hostList, (i, list) => {
      const m = clone(manifest);
      targets[i](m, list);
      const exact = JSON.stringify(list) === JSON.stringify(HOSTS);
      expect(scopeErrors(m).length === 0).toBe(exact);
    }), { numRuns: 100 });
    fc.assert(fc.property(hostList, (list) => {
      const r = clone(rules);
      r.rules[0].match = list;
      const exact = JSON.stringify(list) === JSON.stringify(HOSTS);
      const errs = validateRulesDocument(r).filter((e) => /match/.test(e));
      expect(errs.length === 0).toBe(exact);
    }), { numRuns: 100 });
  });

  // Feature: doomscroll-app, Property 5: Generated skeleton identity is exact
  it('Property 5: the mirror is accepted iff it has the same file set and bytes', () => {
    const bytes = fc.uint8Array({ maxLength: 8 }).map((a) => Buffer.from(a));
    const names = ['index.js', 'engine.js', 'effects/rot.js', 'effects/util.js'];
    const fileMap = fc.dictionary(fc.constantFrom(...names), bytes);
    fc.assert(fc.property(fileMap, fileMap, (src, tgt) => {
      const res = compareFileMaps(new Map(Object.entries(src)), new Map(Object.entries(tgt)));
      const identical = Object.keys(src).length === Object.keys(tgt).length
        && Object.entries(src).every(([k, v]) => tgt[k] && v.equals(tgt[k]));
      expect(res.ok).toBe(identical);
    }), { numRuns: 100 });
  });
});
