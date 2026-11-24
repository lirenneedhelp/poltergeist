// Rules_Hook: runs the Package_Check of the registered app whose folder directly contains a saved rules.json.
//   node scripts/rules-hook.mjs <path>     manual run (path relative to the repository root, or absolute)
//   node scripts/rules-hook.mjs < event    Kiro PostFileSave hook: the event JSON arrives on STDIN
// Read-only: the check prints its own errors and nothing is written. Node built-ins only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');

function lastSegment(p) {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1];
}

/** First string value anywhere in the event JSON whose last path segment is "rules.json", or null. */
export function findRulesPath(event) {
  const seen = new Set();
  function visit(value) {
    if (typeof value === 'string') return lastSegment(value) === 'rules.json' ? value : null;
    if (value === null || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const found = visit(child);
      if (found !== null) return found;
    }
    return null;
  }
  return visit(event);
}

/**
 * Registry key whose dir directly contains filePath, or null.
 * Backslashes become "/" first, then the path is resolved against repoRoot and made repo-relative.
 * Matches only "<dir>/rules.json" exactly; paths outside repoRoot return null.
 */
export function appForRulesPath(filePath, { repoRoot = REPO_ROOT, apps } = {}) {
  if (typeof filePath !== 'string' || filePath === '' || !apps || typeof apps !== 'object') return null;
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, filePath.replaceAll('\\', '/'));
  const rel = path.relative(root, abs);
  if (rel === '' || path.isAbsolute(rel)) return null;
  const parts = rel.replaceAll('\\', '/').split('/');
  if (parts.length !== 2 || parts[0] === '..' || parts[1] !== 'rules.json') return null;
  for (const [key, entry] of Object.entries(apps)) {
    if (entry && entry.dir === parts[0]) return key;
  }
  return null;
}

/** Returns the exit code. check(key) defaults to sync-skeleton main(['--check','--app',key], repoRoot). */
export async function run({ filePath, repoRoot = REPO_ROOT, apps, check } = {}) {
  if (typeof filePath !== 'string' || filePath === '') {
    console.log('rules-hook: no rules.json path was given; nothing to check.');
    return 0;
  }
  if (!apps || !check) {
    const sync = await import('./sync-skeleton.mjs');
    apps ??= sync.APPS;
    check ??= (key) => sync.main(['--check', '--app', key], repoRoot);
  }
  const key = appForRulesPath(filePath, { repoRoot, apps });
  if (key === null) {
    console.log(`rules-hook: ${filePath} is not directly inside a registered app folder; nothing to check.`);
    return 0;
  }
  console.log(`rules-hook: running check:${key} for ${apps[key].dir}/rules.json`);
  try {
    const code = await check(key);
    return Number.isInteger(code) ? code : 1;
  } catch (error) {
    console.error(`rules-hook: check:${key} failed to run:`, error);
    return 1;
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** CLI: path from argv[2], else from the STDIN event JSON; relative paths resolve against event.cwd, else the repo root. */
export async function cli(argv = process.argv, repoRoot = REPO_ROOT) {
  let filePath = typeof argv[2] === 'string' && argv[2] !== '' ? argv[2] : null;
  let base = repoRoot;
  if (filePath === null && !process.stdin.isTTY) {
    const text = await readStdin();
    if (text.trim() !== '') {
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        console.log('rules-hook: the hook event on STDIN is not JSON; nothing to check.');
        return 0;
      }
      filePath = findRulesPath(event);
      if (event && typeof event === 'object' && typeof event.cwd === 'string' && event.cwd !== '') base = event.cwd;
    }
  }
  if (filePath !== null) filePath = path.resolve(base, filePath.replaceAll('\\', '/'));
  return run({ filePath: filePath ?? undefined, repoRoot });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
