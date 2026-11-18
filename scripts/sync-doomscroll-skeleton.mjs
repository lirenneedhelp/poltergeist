// Synchronizes root skeleton/ production files into app1-doomscroll/skeleton/.
//   node scripts/sync-doomscroll-skeleton.mjs          build (replace generated mirror)
//   node scripts/sync-doomscroll-skeleton.mjs --check  read-only drift check
// Thin wrapper over scripts/sync-skeleton.mjs, kept for its exports, CLI, and messages.
// Node built-ins only; nothing here ships in the extension.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sync from './sync-skeleton.mjs';

export { REPO_ROOT, isExcluded, listFiles, compareFileMaps, formatDiagnostics } from './sync-skeleton.mjs';

export function check(repoRoot = sync.REPO_ROOT) {
  return sync.check(repoRoot, 'doomscroll');
}

export function build(repoRoot = sync.REPO_ROOT) {
  return sync.build(repoRoot, 'doomscroll');
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}`);
    return 2;
  }
  return sync.main([...(args.includes('--check') ? ['--check'] : []), '--app', 'doomscroll']);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
