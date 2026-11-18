// Synchronizes root skeleton/ production files into each registered app's skeleton/ mirror.
//   node scripts/sync-skeleton.mjs                        build every registered app's mirror
//   node scripts/sync-skeleton.mjs --check                read-only drift check for every app
//   node scripts/sync-skeleton.mjs [--check] --app <key>  limit to one or more apps (repeatable)
// After a build or a passing check, each processed app's package validator runs.
// Node built-ins only; nothing here ships in an extension.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Registered apps. `validator` is resolved relative to this script and must export validatePackage(repoRoot). */
export const APPS = Object.freeze({
  doomscroll: Object.freeze({ dir: 'app1-doomscroll', label: 'Doomscroll', validator: './validate-doomscroll-package.mjs', buildScript: 'build:doomscroll' }),
  graveyard: Object.freeze({ dir: 'app2-tab-graveyard', label: 'Tab Graveyard', validator: './validate-graveyard-package.mjs', buildScript: 'build:graveyard' }),
});

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

/** Dynamic import keeps validators off the static graph (they import the sync modules) and loads only processed apps. */
async function runValidator(repoRoot, appKey) {
  const { label, validator } = appOf(appKey);
  let ok;
  let errors;
  try {
    const { validatePackage } = await import(validator);
    ({ ok, errors } = await validatePackage(repoRoot));
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
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
