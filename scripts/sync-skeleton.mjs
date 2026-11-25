// Synchronizes root skeleton/ production files into each registered app's skeleton/ mirror.
//   node scripts/sync-skeleton.mjs                        build every registered app's mirror
//   node scripts/sync-skeleton.mjs --check                read-only drift check for every app
//   node scripts/sync-skeleton.mjs [--check] --app <key>  limit to one or more apps (repeatable)
// After a build or a passing check, each processed app's package validator runs.
// Without --app, the Playground (demo-site/skeleton/ and demo-site/presets/) is also built or checked.
// Node built-ins only; nothing here ships in an extension.
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');
export const REGISTRY_PATH = path.join(SCRIPTS_DIR, 'app-registry.json');

const KEY_RE = /^[a-z][a-z0-9-]{1,29}$/;
const DIR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VALIDATOR_RE = /^\.\/[a-z0-9-]+\.mjs$/;
const ENTRY_FIELDS = ['dir', 'label', 'validator', 'buildScript'];

/**
 * Read, shape-check and deep-freeze the App_Registry. Throws naming the file and the bad key or field.
 * `validator` is resolved relative to this script and must export validatePackage(repoRoot, app).
 */
export function loadRegistry(file = REGISTRY_PATH) {
  const fail = (what) => { throw new Error(`Invalid app registry ${file}: ${what}`); };
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read app registry ${file}: ${e.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) fail('top level must be an object');
  const apps = {};
  for (const [key, entry] of Object.entries(data)) {
    if (!KEY_RE.test(key)) fail(`key "${key}" must match ${KEY_RE}`);
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail(`${key} must be an object`);
    const { dir, label, validator, buildScript } = entry;
    if (typeof dir !== 'string' || !DIR_RE.test(dir)) fail(`${key}.dir must be one path segment matching ${DIR_RE}`);
    if (typeof label !== 'string' || label.trim() === '') fail(`${key}.label must be a non-empty string`);
    if (typeof validator !== 'string' || !VALIDATOR_RE.test(validator)) fail(`${key}.validator must match ${VALIDATOR_RE}`);
    if (buildScript !== `build:${key}`) fail(`${key}.buildScript must be "build:${key}"`);
    apps[key] = Object.freeze(Object.fromEntries(ENTRY_FIELDS.map((f) => [f, entry[f]])));
  }
  return Object.freeze(apps);
}

/** Registered apps, read from scripts/app-registry.json at import. */
export const APPS = loadRegistry();

function appOf(appKey) {
  if (typeof appKey !== 'string' || !Object.hasOwn(APPS, appKey)) throw new Error(`Unknown app: ${appKey}`);
  return APPS[appKey];
}

/** Only the first relative segment `test` is excluded (skeleton/test/**). */
export function isExcluded(relPath) {
  return relPath.split('/')[0] === 'test';
}

/** Sorted, forward-slash relative paths of every admitted file under root. Missing root => []. */
export async function listFiles(root) {
  const out = [];
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT' && dir === root) return;
      throw e;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isExcluded(rel)) continue;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  }
  await walk(root, '');
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Pure set/bytes comparison. Each side is Map<relPath, Buffer>. */
export function compareFileMaps(source, target) {
  const missing = [];
  const extra = [];
  const changed = [];
  for (const [rel, buf] of source) {
    if (!target.has(rel)) missing.push(rel);
    else if (!buf.equals(target.get(rel))) changed.push(rel);
  }
  for (const rel of target.keys()) if (!source.has(rel)) extra.push(rel);
  missing.sort();
  extra.sort();
  changed.sort();
  return { missing, extra, changed, ok: !missing.length && !extra.length && !changed.length };
}

export function formatDiagnostics({ missing, extra, changed }) {
  const lines = [];
  for (const p of missing) lines.push(`missing: ${p}`);
  for (const p of extra) lines.push(`extra:   ${p}`);
  for (const p of changed) lines.push(`changed: ${p}`);
  return lines;
}

async function readMap(root) {
  const map = new Map();
  for (const rel of await listFiles(root)) map.set(rel, await fs.readFile(path.join(root, ...rel.split('/'))));
  return map;
}

function resolvePaths(repoRoot, appKey) {
  const { dir } = appOf(appKey);
  const root = path.resolve(repoRoot);
  return {
    root,
    source: path.join(root, 'skeleton'),
    target: path.join(root, dir, 'skeleton'),
    expectedRel: `${dir}/skeleton`,
  };
}

/** Read-only drift check of one app's mirror against root skeleton/. */
export async function check(repoRoot, appKey) {
  const { source, target } = resolvePaths(repoRoot, appKey);
  const result = compareFileMaps(await readMap(source), await readMap(target));
  return { ...result, diagnostics: formatDiagnostics(result) };
}

/** Replace one app's mirror with root skeleton/ production files. Writes only inside <appDir>/skeleton. */
export async function build(repoRoot, appKey) {
  const { root, source, target, expectedRel } = resolvePaths(repoRoot, appKey);
  const rel = path.relative(root, target).replaceAll('\\', '/');
  if (rel !== expectedRel || rel.split('/').length !== 2 || rel.split('/').includes('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to replace unexpected target: ${target}`);
  }
  const files = await readMap(source); // read everything first so a read failure leaves the mirror intact
  await fs.rm(target, { recursive: true, force: true });
  for (const [relPath, buf] of files) {
    const dest = path.join(target, ...relPath.split('/'));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
  }
  return [...files.keys()];
}

/**
 * The Playground sync target. Not an app: it has no registry entry, no validator and no build script of its own.
 * presets maps a file in demo-site/presets/ to the registry key of the app whose rules.json it copies.
 */
export const SITE = Object.freeze({
  dir: 'demo-site', label: 'Playground',
  presets: Object.freeze({ 'doomscroll.json': 'doomscroll', 'graveyard.json': 'graveyard' }),
});

/** Source path of one preset, or { missing } when its app is not registered or has no rules.json. */
function presetSource(root, appKey) {
  const dir = Object.hasOwn(APPS, appKey) ? APPS[appKey].dir : appKey;
  const rel = `${dir}/rules.json`;
  return { rel, file: path.join(root, dir, 'rules.json'), registered: Object.hasOwn(APPS, appKey) };
}

/** Expected site content: Map keyed skeleton/<rel> and presets/<file>, plus the sources that could not be read. */
async function readSiteSource(root) {
  const map = new Map();
  for (const [rel, buf] of await readMap(path.join(root, 'skeleton'))) map.set(`skeleton/${rel}`, buf);
  const missingSources = [];
  for (const [file, appKey] of Object.entries(SITE.presets)) {
    const src = presetSource(root, appKey);
    if (!src.registered) { missingSources.push(src.rel); continue; }
    try {
      map.set(`presets/${file}`, await fs.readFile(src.file));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      missingSources.push(src.rel);
    }
  }
  return { map, missingSources };
}

/** Read-only. Compares skeleton/ production files with demo-site/skeleton/, and each preset with its app's rules.json. */
export async function checkSite(repoRoot) {
  const root = path.resolve(repoRoot);
  const { map: source, missingSources } = await readSiteSource(root);
  const target = new Map();
  for (const [rel, buf] of await readMap(path.join(root, SITE.dir, 'skeleton'))) target.set(`skeleton/${rel}`, buf);
  for (const [rel, buf] of await readMap(path.join(root, SITE.dir, 'presets'))) target.set(`presets/${rel}`, buf);
  // A preset whose source is missing is reported as a missing source, not compared.
  for (const [file, appKey] of Object.entries(SITE.presets)) {
    if (missingSources.includes(presetSource(root, appKey).rel)) target.delete(`presets/${file}`);
  }
  const result = compareFileMaps(source, target);
  const diagnostics = [...missingSources.map((rel) => `missing source: ${rel}`), ...formatDiagnostics(result)];
  return { ...result, ok: result.ok && !missingSources.length, diagnostics };
}

/** Replaces demo-site/skeleton/ and demo-site/presets/ only. Throws before writing when a preset source is missing. */
export async function buildSite(repoRoot) {
  const root = path.resolve(repoRoot);
  const targets = { skeleton: path.join(root, SITE.dir, 'skeleton'), presets: path.join(root, SITE.dir, 'presets') };
  for (const [name, target] of Object.entries(targets)) {
    const rel = path.relative(root, target).replaceAll('\\', '/');
    if (rel !== `${SITE.dir}/${name}` || path.isAbsolute(rel)) throw new Error(`Refusing to replace unexpected target: ${target}`);
  }
  const { map, missingSources } = await readSiteSource(root); // read everything first so a failure leaves the copies intact
  if (missingSources.length) throw new Error(missingSources.map((rel) => `missing source: ${rel}`).join('; '));
  await fs.rm(targets.skeleton, { recursive: true, force: true });
  await fs.rm(targets.presets, { recursive: true, force: true });
  const files = [];
  const presets = [];
  for (const [key, buf] of map) {
    const [kind, ...rest] = key.split('/');
    const dest = path.join(targets[kind], ...rest);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    (kind === 'skeleton' ? files : presets).push(rest.join('/'));
  }
  return { files, presets };
}

async function processSite(repoRoot, checkOnly) {
  const { dir, label } = SITE;
  if (checkOnly) {
    const result = await checkSite(repoRoot);
    if (!result.ok) {
      console.error(`${label} copies are out of sync (run: npm run build:skeletons):`);
      for (const line of result.diagnostics) console.error(`  ${line}`);
      return false;
    }
    console.log(`${label} copies are in sync.`);
    return true;
  }
  let written;
  try {
    written = await buildSite(repoRoot);
  } catch (e) {
    console.error(`${label} copies could not be built: ${e.message}`);
    return false;
  }
  console.log(`Synchronized ${written.files.length} file(s) into ${dir}/skeleton/ and ${written.presets.length} preset(s) into ${dir}/presets/.`);
  return true;
}

/** Dynamic import keeps validators off the static graph (they import the sync modules) and loads only processed apps. */
async function runValidator(repoRoot, appKey) {
  const { label, validator } = appOf(appKey);
  let ok;
  let errors;
  try {
    const { validatePackage } = await import(validator);
    ({ ok, errors } = await validatePackage(repoRoot, { key: appKey, ...APPS[appKey] }));
  } catch (e) {
    ok = false;
    errors = [`cannot run ${validator} (${e.message})`];
  }
  if (ok) return true;
  console.error(`${label} package validation failed:`);
  for (const e of errors) console.error(`  ${e}`);
  return false;
}

/** Parse CLI arguments. Returns { checkOnly, apps } or { error }. */
export function parseArgs(args) {
  const apps = [];
  const unknown = [];
  let checkOnly = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check') checkOnly = true;
    else if (a === '--app' && i + 1 < args.length && Object.hasOwn(APPS, args[i + 1])) {
      if (!apps.includes(args[i + 1])) apps.push(args[i + 1]);
      i++;
    } else if (a === '--app') {
      unknown.push(i + 1 < args.length ? `--app ${args[++i]}` : '--app');
    } else unknown.push(a);
  }
  if (unknown.length) return { error: `Unknown argument(s): ${unknown.join(' ')}` };
  return { checkOnly, apps: apps.length ? apps : Object.keys(APPS) };
}

async function processApp(repoRoot, appKey, checkOnly) {
  const { dir, label, buildScript } = appOf(appKey);
  if (checkOnly) {
    const result = await check(repoRoot, appKey);
    if (!result.ok) {
      console.error(`${label} skeleton mirror is out of sync (run: npm run ${buildScript}):`);
      for (const line of result.diagnostics) console.error(`  ${line}`);
      return false;
    }
    if (!(await runValidator(repoRoot, appKey))) return false;
    console.log(`${label} skeleton mirror is in sync and the package is valid.`);
    return true;
  }
  const written = await build(repoRoot, appKey);
  // A validation failure leaves the freshly copied mirror in place: the copy is correct.
  if (!(await runValidator(repoRoot, appKey))) return false;
  console.log(`Synchronized ${written.length} file(s) into ${dir}/skeleton/; the package is valid.`);
  return true;
}

/** CLI entry. Returns the exit code: 0 ok, 1 drift or validation error, 2 bad arguments. */
export async function main(args = process.argv.slice(2), repoRoot = REPO_ROOT) {
  const parsed = parseArgs(args);
  if (parsed.error) {
    console.error(parsed.error);
    return 2;
  }
  let ok = true;
  for (const appKey of parsed.apps) {
    if (!(await processApp(repoRoot, appKey, parsed.checkOnly))) ok = false;
  }
  // The Playground is processed only when every app is (no --app given).
  if (!args.includes('--app') && !(await processSite(repoRoot, parsed.checkOnly))) ok = false;
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
