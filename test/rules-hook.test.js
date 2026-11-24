// Rules_Hook tests: path mapping, hook file shape, exit codes and registry pickup (Requirement 3).
// Example-based only. Temporary repositories live in os.tmpdir(); the real repository is never written.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRulesPath, appForRulesPath, run } from '../scripts/rules-hook.mjs';
import { APPS } from '../scripts/sync-skeleton.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_FILE = path.join(REPO_ROOT, '.kiro', 'hooks', 'check-rules-on-save.json');
const OPTS = { repoRoot: REPO_ROOT, apps: APPS };

// Haunt Kit invariant 16: The Rules_Hook runs exactly the owning app's check
describe('Rules_Hook path mapping', () => {
  const CASES = [
    ['app1-doomscroll/rules.json', 'doomscroll'],
    ['app1-doomscroll\\rules.json', 'doomscroll'],
    ['./app1-doomscroll/rules.json', 'doomscroll'],
    [path.join(REPO_ROOT, 'app1-doomscroll', 'rules.json'), 'doomscroll'],
    ['app2-tab-graveyard/rules.json', 'graveyard'],
    [path.join(REPO_ROOT, 'app2-tab-graveyard', 'rules.json'), 'graveyard'],
    ['demo-site/presets/doomscroll.json', null],
    ['app1-doomscroll/skeleton/rules.json', null],
    ['app1-doomscroll\\skeleton\\rules.json', null],
    ['rules.json', null],
    [path.join(REPO_ROOT, 'rules.json'), null],
    ['../app1-doomscroll/rules.json', null],
    [path.resolve(REPO_ROOT, '..', 'elsewhere', 'app1-doomscroll', 'rules.json'), null],
    ['app1-doomscroll/myrules.json', null],
    ['', null],
  ];

  for (const [filePath, expected] of CASES) {
    it(`maps ${JSON.stringify(filePath)} to ${expected ?? 'no app'}`, () => {
      expect(appForRulesPath(filePath, OPTS)).toBe(expected);
    });
  }

  it('handles a path carried in an event JSON the same way', () => {
    for (const [filePath, expected] of CASES.filter(([p]) => p.split(/[\\/]/).pop() === 'rules.json')) {
      const event = { hookEvent: 'PostFileSave', cwd: REPO_ROOT, data: { files: [{ filePath }] } };
      const found = findRulesPath(event);
      expect(found).toBe(filePath);
      expect(appForRulesPath(found, OPTS)).toBe(expected);
    }
  });

  it('findRulesPath returns null when no rules.json path is present', () => {
    expect(findRulesPath({ filePath: 'app1-doomscroll/manifest.json', cwd: REPO_ROOT })).toBeNull();
    expect(findRulesPath(null)).toBeNull();
    expect(findRulesPath('rules.json.bak')).toBeNull();
  });
});

describe('Rules_Hook file', () => {
  const doc = JSON.parse(readFileSync(HOOK_FILE, 'utf8'));
  const [hook] = doc.hooks;

  it('declares one PostFileSave hook with a command action running the script', () => {
    expect(doc.version).toBe('v1');
    expect(doc.hooks).toHaveLength(1);
    expect(hook.trigger).toBe('PostFileSave');
    expect(hook.action.type).toBe('command');
    expect(hook.action.command).toBe('node scripts/rules-hook.mjs');
  });

  it('matches rules.json with either separator and rejects other names', () => {
    const re = new RegExp(hook.matcher);
    for (const p of ['rules.json', 'app1-doomscroll/rules.json', 'app1-doomscroll\\rules.json',
      'C:\\Users\\me\\poltergeist\\app1-doomscroll\\rules.json', '/home/me/poltergeist/app1-doomscroll/rules.json']) {
      expect(re.test(p), p).toBe(true);
    }
    for (const p of ['myrules.json', 'app1-doomscroll/myrules.json', 'rules.json.bak', 'app1-doomscroll/rules.json.bak',
      'app1-doomscroll/rules.jsonx', 'demo-site/presets/doomscroll.json']) {
      expect(re.test(p), p).toBe(false);
    }
  });
});

describe('Rules_Hook exit codes (in-process)', () => {
  const quiet = () => {};
  const silence = () => {
    const log = console.log;
    const error = console.error;
    console.log = quiet;
    console.error = quiet;
    return () => { console.log = log; console.error = error; };
  };

  it('runs exactly the mapped check and returns its exit code', async () => {
    const restore = silence();
    try {
      for (const [code, expected] of [[0, 0], [1, 1], [2, 2]]) {
        const calls = [];
        const exit = await run({ filePath: 'app2-tab-graveyard/rules.json', ...OPTS, check: async (k) => { calls.push(k); return code; } });
        expect(calls).toEqual(['graveyard']);
        expect(exit).toBe(expected);
      }
    } finally { restore(); }
  });

  it('returns non-zero when the check throws or returns a non-integer', async () => {
    const restore = silence();
    try {
      expect(await run({ filePath: 'app1-doomscroll/rules.json', ...OPTS, check: async () => { throw new Error('boom'); } })).not.toBe(0);
      expect(await run({ filePath: 'app1-doomscroll/rules.json', ...OPTS, check: async () => undefined })).not.toBe(0);
    } finally { restore(); }
  });

  it('runs no check and returns 0 for a path outside every registered app', async () => {
    const restore = silence();
    try {
      for (const filePath of ['demo-site/presets/doomscroll.json', 'app1-doomscroll/skeleton/rules.json', 'rules.json', undefined]) {
        const calls = [];
        expect(await run({ filePath, ...OPTS, check: async (k) => { calls.push(k); return 1; } })).toBe(0);
        expect(calls).toEqual([]);
      }
    } finally { restore(); }
  });
});

// Temporary repository: real sync-skeleton.mjs and rules-hook.mjs, a tiny skeleton, and a registry
// entry added only in the copy. The entry's validator passes or fails depending on a flag file.
describe('Rules_Hook CLI in a temporary repository', () => {
  let tmp;
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); tmp = undefined; });

  function makeRepo() {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'rules-hook-'));
    mkdirSync(path.join(tmp, 'scripts'));
    for (const f of ['sync-skeleton.mjs', 'rules-hook.mjs']) {
      copyFileSync(path.join(REPO_ROOT, 'scripts', f), path.join(tmp, 'scripts', f));
    }
    writeFileSync(path.join(tmp, 'scripts', 'app-registry.json'),
      '{\n  "spooky": { "dir": "app3-spooky", "label": "Spooky", "validator": "./validate-spooky-package.mjs", "buildScript": "build:spooky" }\n}\n');
    writeFileSync(path.join(tmp, 'scripts', 'validate-spooky-package.mjs'), [
      "import { existsSync } from 'node:fs';",
      "import path from 'node:path';",
      'export async function validatePackage(repoRoot, app) {',
      "  if (existsSync(path.join(repoRoot, app.dir, 'FAIL'))) return { ok: false, errors: ['rules.json: forced failure'] };",
      '  return { ok: true, errors: [] };',
      '}',
      '',
    ].join('\n'));
    for (const dir of ['skeleton', path.join('app3-spooky', 'skeleton')]) {
      mkdirSync(path.join(tmp, dir), { recursive: true });
      writeFileSync(path.join(tmp, dir, 'index.js'), 'export const x = 1;\n');
    }
    const rulesPath = path.join(tmp, 'app3-spooky', 'rules.json');
    writeFileSync(rulesPath, '[\n  { "id": "spooky-fog" }\n]\n');
    return rulesPath;
  }

  function hook(input, args = []) {
    return spawnSync(process.execPath, [path.join(tmp, 'scripts', 'rules-hook.mjs'), ...args], {
      cwd: tmp, input, encoding: 'utf8', timeout: 30000,
    });
  }

  it('finds a newly registered app with no hook edit and exits 0 when its check passes', () => {
    const rulesPath = makeRepo();
    const before = readFileSync(rulesPath);
    const res = hook(JSON.stringify({ cwd: tmp, filePath: 'app3-spooky/rules.json' }));
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('running check:spooky');
    expect(readFileSync(rulesPath).equals(before)).toBe(true);
  });

  it('exits non-zero, prints the check errors and leaves rules.json unchanged when the check fails', () => {
    const rulesPath = makeRepo();
    writeFileSync(path.join(tmp, 'app3-spooky', 'FAIL'), '');
    const before = readFileSync(rulesPath);
    const res = hook(JSON.stringify({ cwd: tmp, filePath: rulesPath }));
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('rules.json: forced failure');
    expect(readFileSync(rulesPath).equals(before)).toBe(true);
  });

  it('exits non-zero when the mapped app has drifted, given the path as an argument', () => {
    const rulesPath = makeRepo();
    writeFileSync(path.join(tmp, 'app3-spooky', 'skeleton', 'index.js'), 'export const x = 2;\n');
    const before = readFileSync(rulesPath);
    const res = hook('', ['app3-spooky\\rules.json']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('changed: index.js');
    expect(readFileSync(rulesPath).equals(before)).toBe(true);
  });

  it('exits 0 and runs no check for a rules.json outside every registered app folder', () => {
    makeRepo();
    writeFileSync(path.join(tmp, 'app3-spooky', 'FAIL'), '');
    for (const p of ['rules.json', 'app3-spooky/skeleton/rules.json', 'other/rules.json']) {
      const res = hook(JSON.stringify({ cwd: tmp, filePath: p }));
      expect(res.status, p).toBe(0);
      expect(res.stdout).toContain('nothing to check');
    }
  });

  it('exits 0 when STDIN is not JSON', () => {
    makeRepo();
    const res = hook('not json');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('nothing to check');
  });
});
