// Synchronizes root skeleton/ production files into app1-doomscroll/skeleton/.
//   node scripts/sync-doomscroll-skeleton.mjs          build (replace generated mirror)
//   node scripts/sync-doomscroll-skeleton.mjs --check  read-only drift check
// Node built-ins only; nothing here ships in the extension.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function resolvePaths(repoRoot) {
  const root = path.resolve(repoRoot);
  return {
    root,
    source: path.join(root, 'skeleton'),
    target: path.join(root, 'app1-doomscroll', 'skeleton'),
    expectedTarget: path.join(root, 'app1-doomscroll', 'skeleton'),
  };
}

export async function check(repoRoot = REPO_ROOT) {
  const { source, target } = resolvePaths(repoRoot);
  const result = compareFileMaps(await readMap(source), await readMap(target));
  return { ...result, diagnostics: formatDiagnostics(result) };
}

export async function build(repoRoot = REPO_ROOT) {
  const { root, source, target, expectedTarget } = resolvePaths(repoRoot);
  if (path.resolve(target) !== expectedTarget || path.relative(root, target).replaceAll('\\', '/') !== 'app1-doomscroll/skeleton') {
    throw new Error(`Refusing to replace unexpected target: ${target}`);
  }
  const files = await readMap(source); // read everything first so a read failure leaves the mirror intact
  await fs.rm(target, { recursive: true, force: true });
  for (const [rel, buf] of files) {
    const dest = path.join(target, ...rel.split('/'));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
  }
  return [...files.keys()];
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}`);
    return 2;
  }
  if (args.includes('--check')) {
    const result = await check();
    if (!result.ok) {
      console.error('Doomscroll skeleton mirror is out of sync (run: npm run build:doomscroll):');
      for (const line of result.diagnostics) console.error(`  ${line}`);
      return 1;
    }
    console.log('Doomscroll skeleton mirror is in sync.');
    return 0;
  }
  const written = await build();
  console.log(`Synchronized ${written.length} file(s) into app1-doomscroll/skeleton/.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
