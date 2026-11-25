// Scaffolder: creates a new haunt app that reuses the root skeleton.
//   node scripts/new-haunt.mjs <name> [--hosts <pattern,...>] [--root <dir>]
// Every input is checked before anything is written. After the app folder exists, any failure deletes
// that folder and restores scripts/app-registry.json and package.json byte-for-byte.
// Node built-ins only; nothing here ships in an extension.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveGraph } from './package-checks.mjs';
import { isAllowedHost, MAX_HOSTS } from './validate-app-package.mjs';
import { isExcluded, listFiles, loadRegistry } from './sync-skeleton.mjs';

export { isAllowedHost };

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPTS_DIR, '..');
const TEMPLATE_DIR = path.join(SCRIPTS_DIR, 'templates', 'haunt');

export const NAME_RE = /^[a-z][a-z0-9-]{1,29}$/;
export const DEFAULT_HOSTS = Object.freeze(['https://example.com/*']);
const APP_DIR_RE = /^app(\d+)-/;
const LEFTOVER_PLACEHOLDER_RE = /__[A-Z][A-Z0-9_]*__/;
const CHILD_TIMEOUT_MS = 5 * 60 * 1000;
const USAGE = 'usage: node scripts/new-haunt.mjs <name> [--hosts <pattern,...>] [--root <dir>]';

/** Template files in write order: [template path relative to TEMPLATE_DIR, output path relative to the app]. */
const TEMPLATES = Object.freeze([
  ['content.js.tpl', 'content.js'],
  ['background.js.tpl', 'background.js'],
  ['popup.html.tpl', 'popup.html'],
  ['popup.js.tpl', 'popup.js'],
  ['popup.css.tpl', 'popup.css'],
  ['test/package.test.js.tpl', 'test/package.test.js'],
  ['test/background.test.js.tpl', 'test/background.test.js'],
]);

/** Files the --root directory must contain. */
const ROOT_FILES = Object.freeze(['scripts/app-registry.json', 'scripts/sync-skeleton.mjs', 'package.json']);

/** Split a --hosts value into its patterns, or return { error } naming the bad input. */
function parseHosts(value) {
  const hosts = value.split(',').map((h) => h.trim());
  if (value.trim() === '' || hosts.some((h) => h === '')) {
    return { error: `--hosts must be 1 to ${MAX_HOSTS} comma-separated, non-empty match patterns (got "${value}")` };
  }
  if (hosts.length > MAX_HOSTS) return { error: `--hosts accepts at most ${MAX_HOSTS} patterns (got ${hosts.length})` };
  const bad = hosts.filter((h) => !isAllowedHost(h));
  if (bad.length) {
    return { error: `--hosts has invalid pattern(s) ${bad.map((h) => `"${h}"`).join(', ')}: each must be a Chrome match pattern with scheme http, https or *` };
  }
  return { hosts };
}

/**
 * Parse CLI arguments (process.argv.slice(2)). Checks only what needs no file system:
 * the Haunt_Name pattern and the --hosts patterns. Returns { name, hosts, root } or { error }.
 */
export function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    const m = /^--(hosts|root)(?:=(.*))?$/s.exec(a);
    if (m) {
      const flag = m[1];
      let value = m[2];
      if (value === undefined) {
        if (i + 1 >= args.length) return { error: `--${flag} needs a value. ${USAGE}` };
        value = String(args[++i]);
      }
      if (Object.hasOwn(flags, flag)) return { error: `--${flag} was given more than once` };
      flags[flag] = value;
    } else if (a.startsWith('--')) {
      return { error: `unknown option ${a}. ${USAGE}` };
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) return { error: `a haunt name is required. ${USAGE}` };
  if (positional.length > 1) return { error: `expected one haunt name, got ${positional.map((p) => `"${p}"`).join(' ')}. ${USAGE}` };
  const name = positional[0];
  if (!NAME_RE.test(name)) return { error: `haunt name "${name}" must match ${NAME_RE}` };

  let hosts = [...DEFAULT_HOSTS];
  if (Object.hasOwn(flags, 'hosts')) {
    const parsed = parseHosts(flags.hosts);
    if (parsed.error) return { error: parsed.error };
    hosts = parsed.hosts;
  }
  if (Object.hasOwn(flags, 'root') && flags.root.trim() === '') return { error: '--root must not be empty' };
  const root = path.resolve(Object.hasOwn(flags, 'root') ? flags.root : DEFAULT_ROOT);
  return { name, hosts, root };
}

/** 1 + the largest N over directory names matching app<N>-*, or 1 when there is none. */
export function nextAppNumber(dirNames) {
  let max = 0;
  for (const d of Array.isArray(dirNames) ? dirNames : []) {
    const m = APP_DIR_RE.exec(String(d));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Replace every `__KEY__` placeholder for each KEY in vars (split/join, so no regex escaping is involved). */
export function renderTemplate(text, vars) {
  let out = String(text);
  for (const [key, value] of Object.entries(vars ?? {})) out = out.split(`__${key}__`).join(String(value));
  return out;
}

/** The Generated_App manifest. `reachable` lists the skeleton modules reachable from skeleton/index.js. */
export function buildManifest(name, hosts, reachable) {
  return {
    manifest_version: 3,
    name: `Poltergeist: ${name}`,
    version: '0.1.0',
    permissions: ['storage'],
    host_permissions: [...hosts],
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_popup: 'popup.html' },
    content_scripts: [{ matches: [...hosts], js: ['content.js'], run_at: 'document_idle', all_frames: false }],
    web_accessible_resources: [{ resources: ['rules.json', ...reachable], matches: [...hosts], use_dynamic_url: false }],
  };
}

/** Starter rules: Fog first (lowest threshold, Meter rule d), then Rot, both on timeOnSite. */
export function buildRules(name, hosts) {
  return {
    rules: [
      {
        id: `${name}-fog`,
        enabled: true,
        match: [...hosts],
        trigger: { meter: 'timeOnSite', threshold: 120, rampTo: 300 },
        effect: { type: 'fog', params: { maxBlur: 5, maxGrayscale: 0.8 } },
        undo: { mode: 'fade', durationMs: 400 },
      },
      {
        id: `${name}-rot`,
        enabled: true,
        match: [...hosts],
        trigger: { meter: 'timeOnSite', threshold: 300, rampTo: 600 },
        effect: { type: 'rot', params: { maxFraction: 0.5 } },
        undo: { mode: 'instant' },
      },
    ],
  };
}

/** The registry entry line, exactly as appended. */
export function registryEntryLine(name, dir) {
  return `  "${name}": { "dir": "${dir}", "label": "${name}", "validator": "./validate-app-package.mjs", "buildScript": "build:${name}" }`;
}

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/**
 * Insert the entry before the registry's final "}". Existing entry text stays byte-identical;
 * the separating comma is the only byte added to the previous entry's line.
 */
export function appendRegistryEntry(text, name, dir) {
  const eol = eolOf(text);
  const close = text.lastIndexOf('}');
  if (close < 0) throw new Error('app-registry.json has no closing "}"');
  const head = text.slice(0, close).replace(/\s+$/, '');
  const empty = head.endsWith('{');
  return `${head}${empty ? '' : ','}${eol}${registryEntryLine(name, dir)}${eol}${text.slice(close)}`;
}

/** package.json with build:<name> and check:<name> added at the end of scripts; every other field unchanged. */
export function addNpmScripts(text, name) {
  const pkg = JSON.parse(text);
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package.json must be a JSON object');
  if (pkg.scripts === undefined) pkg.scripts = {};
  if (pkg.scripts === null || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)) throw new Error('package.json scripts must be an object');
  pkg.scripts[`build:${name}`] = `node scripts/sync-skeleton.mjs --app ${name}`;
  pkg.scripts[`check:${name}`] = `node scripts/sync-skeleton.mjs --check --app ${name}`;
  const out = `${JSON.stringify(pkg, null, 2)}\n`;
  return eolOf(text) === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
}

const errMsg = (e) => (e && typeof e.message === 'string' ? e.message : String(e));

async function exists(p) {
  try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

/** Run `node <root>/scripts/sync-skeleton.mjs ...args` in a child process (no shell). Resolves { code, output }. */
function runSync(root, args) {
  return new Promise((resolve) => {
    const chunks = [];
    let child;
    try {
      child = spawn(process.execPath, [path.join(root, 'scripts', 'sync-skeleton.mjs'), ...args], {
        cwd: root, shell: false, windowsHide: true, timeout: CHILD_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: 1, output: errMsg(e) });
      return;
    }
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    child.on('error', (e) => chunks.push(Buffer.from(errMsg(e))));
    child.on('close', (code, signal) => {
      const output = Buffer.concat(chunks).toString('utf8').trim();
      resolve({ code: code ?? 1, output: signal ? `${output}${output ? '\n' : ''}killed by ${signal}` : output });
    });
  });
}

/** Every check that needs the file system, run before any write. Returns the plan or { error }. */
async function plan({ name, hosts, root }) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return { error: `haunt name "${name}" must match ${NAME_RE}` };
  if (!Array.isArray(hosts) || hosts.length < 1 || hosts.length > MAX_HOSTS) {
    return { error: `--hosts must have 1 to ${MAX_HOSTS} patterns` };
  }
  const bad = hosts.filter((h) => typeof h !== 'string' || !isAllowedHost(h));
  if (bad.length) return { error: `--hosts has invalid pattern(s) ${bad.map((h) => `"${h}"`).join(', ')}: each must be a Chrome match pattern with scheme http, https or *` };

  if (typeof root !== 'string' || root === '') return { error: '--root is required' };
  root = path.resolve(root);
  let stat;
  try { stat = await fs.stat(root); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) return { error: `--root ${root} is not an existing directory` };
  for (const rel of ROOT_FILES) {
    let s;
    try { s = await fs.stat(path.join(root, rel)); } catch { s = null; }
    if (!s || !s.isFile()) return { error: `--root ${root} does not contain ${rel}` };
  }

  const registryPath = path.join(root, 'scripts', 'app-registry.json');
  const pkgPath = path.join(root, 'package.json');
  let registry;
  try { registry = loadRegistry(registryPath); } catch (e) { return { error: errMsg(e) }; }
  if (Object.hasOwn(registry, name)) return { error: `haunt name "${name}" is already an app registry key in ${registryPath}` };

  const snapshot = { registry: await fs.readFile(registryPath), pkg: await fs.readFile(pkgPath) };
  let pkg;
  try { pkg = JSON.parse(snapshot.pkg.toString('utf8')); } catch (e) { return { error: `cannot parse ${pkgPath} (${errMsg(e)})` }; }
  const scripts = pkg && typeof pkg === 'object' && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  for (const s of [`build:${name}`, `check:${name}`]) {
    if (Object.hasOwn(scripts, s)) return { error: `haunt name "${name}" clashes with the existing npm script "${s}" in ${pkgPath}` };
  }

  const dirNames = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const dir = `app${nextAppNumber(dirNames)}-${name}`;
  const target = path.join(root, dir);
  if (await exists(target)) return { error: `target folder ${target} already exists` };

  // Modules reachable from the root skeleton's index.js (production files only).
  const skeletonRoot = path.join(root, 'skeleton');
  const sources = new Map();
  try {
    for (const rel of await listFiles(skeletonRoot)) {
      if (!isExcluded(rel) && rel.endsWith('.js')) sources.set(`skeleton/${rel}`, await fs.readFile(path.join(skeletonRoot, ...rel.split('/')), 'utf8'));
    }
  } catch (e) {
    return { error: `cannot read ${skeletonRoot} (${errMsg(e)})` };
  }
  const graph = resolveGraph(sources, 'skeleton/index.js');
  if (graph.errors.length) return { error: `cannot resolve the skeleton modules under ${skeletonRoot}: ${graph.errors.join('; ')}` };

  const vars = { HAUNT_NAME: name, APP_DIR: dir };
  const files = [
    ['manifest.json', `${JSON.stringify(buildManifest(name, hosts, [...graph.reachable]), null, 2)}\n`],
    ['rules.json', `${JSON.stringify(buildRules(name, hosts), null, 2)}\n`],
  ];
  for (const [tpl, out] of TEMPLATES) {
    const file = path.join(TEMPLATE_DIR, ...tpl.split('/'));
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch (e) { return { error: `cannot read template ${file} (${errMsg(e)})` }; }
    const rendered = renderTemplate(text, vars);
    const left = LEFTOVER_PLACEHOLDER_RE.exec(rendered);
    if (left) return { error: `template ${file} has an unknown placeholder ${left[0]}` };
    files.push([out, rendered]);
  }

  let registryText;
  let pkgText;
  try {
    registryText = appendRegistryEntry(snapshot.registry.toString('utf8'), name, dir);
    pkgText = addNpmScripts(snapshot.pkg.toString('utf8'), name);
  } catch (e) {
    return { error: errMsg(e) };
  }
  return { root, dir, target, registryPath, pkgPath, snapshot, files, registryText, pkgText };
}

/** Delete the planned app folder (guarded) and restore the snapshotted files. Throws the collected errors. */
async function rollback(p, created) {
  const errors = [];
  if (created) {
    const rel = path.relative(p.root, p.target);
    if (rel !== p.dir || rel.includes(path.sep) || !/^app\d+-[a-z][a-z0-9-]{1,29}$/.test(rel)) {
      errors.push(`refusing to delete unexpected folder ${p.target}`);
    } else {
      try { await fs.rm(p.target, { recursive: true, force: true }); } catch (e) { errors.push(`cannot delete ${p.target} (${errMsg(e)})`); }
    }
  }
  for (const [file, bytes] of [[p.registryPath, p.snapshot.registry], [p.pkgPath, p.snapshot.pkg]]) {
    try {
      let current = null;
      try { current = await fs.readFile(file); } catch { current = null; }
      if (!current || !current.equals(bytes)) await fs.writeFile(file, bytes);
    } catch (e) {
      errors.push(`cannot restore ${file} (${errMsg(e)})`);
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
}

/**
 * Create app<N>-<name> under root, register it and build its skeleton.
 * Returns { ok: true, dir, path } or { ok: false, step, error[, rollbackError] }.
 * step is "check input" when nothing was written.
 */
export async function scaffold({ name, hosts = [...DEFAULT_HOSTS], root = DEFAULT_ROOT, log = () => {} } = {}) {
  let p;
  try {
    p = await plan({ name, hosts, root });
  } catch (e) {
    return { ok: false, step: 'check input', error: errMsg(e) };
  }
  if (p.error) return { ok: false, step: 'check input', error: p.error };

  let step = 'create app folder';
  let created = false;
  try {
    await fs.mkdir(p.target); // not recursive: an existing folder fails here and is never deleted
    created = true;
    for (const [rel, text] of p.files) {
      step = `write ${rel}`;
      const dest = path.join(p.target, ...rel.split('/'));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, text);
    }
    step = 'register app';
    await fs.writeFile(p.registryPath, p.registryText);
    step = 'add npm scripts';
    await fs.writeFile(p.pkgPath, p.pkgText);
    for (const [name_, args] of [['build skeleton', ['--app', name]], ['package check', ['--check', '--app', name]]]) {
      step = name_;
      const res = await runSync(p.root, args);
      if (res.code !== 0) throw new Error(`exit code ${res.code}${res.output ? `\n${res.output}` : ''}`);
    }
  } catch (e) {
    const failure = { ok: false, step, error: errMsg(e) };
    try { await rollback(p, created); } catch (re) { failure.rollbackError = errMsg(re); }
    return failure;
  }
  log(`new-haunt: created ${p.target}`);
  return { ok: true, dir: p.dir, path: p.target };
}

/** CLI entry. Returns the exit code: 0 on success, 1 on any failure. */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`new-haunt: ${args.error}`);
    return 1;
  }
  const res = await scaffold({ ...args, log: (line) => console.log(line) });
  if (res.ok) return 0;
  if (res.step === 'check input') console.error(`new-haunt: ${res.error}`);
  else console.error(`new-haunt: ${res.step} failed: ${res.error}`);
  if (res.rollbackError) console.error(`new-haunt: rollback failed: ${res.rollbackError}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`new-haunt: ${errMsg(e)}`); process.exitCode = 1; });
}
