import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT } from '../../scripts/sync-doomscroll-skeleton.mjs';

const HOOK_PATH = path.join(REPO_ROOT, '.kiro', 'hooks', 'build-doomscroll-on-skeleton-save.json');
const hookFile = JSON.parse(await fs.readFile(HOOK_PATH, 'utf8'));
const [hook] = hookFile.hooks;
const matcher = new RegExp(hook.matcher);

describe('Kiro PostFileSave hook for the Doomscroll skeleton mirror', () => {
  it('uses the v1 format, PostFileSave, and only the authoritative build command', () => {
    expect(hookFile.version).toBe('v1');
    expect(hookFile.hooks).toHaveLength(1);
    expect(hook.trigger).toBe('PostFileSave');
    expect(hook.name).toMatch(/doomscroll/i);
    expect(hook.action).toEqual({ type: 'command', command: 'npm run build:doomscroll' });
  });

  it('does not rely on lookaround', () => {
    expect(hook.matcher).not.toMatch(/\(\?[=!<]/);
  });

  const abs = ['C:\\Users\\kohli\\Desktop\\poltergeist\\', 'C:/Users/kohli/Desktop/poltergeist/', '/home/dev/poltergeist/'];
  const sources = [
    'skeleton/engine.js', 'skeleton\\engine.js', './skeleton/index.js',
    'skeleton/rule-schema.json', 'skeleton/effects/rot.js', 'skeleton\\effects\\rot.js',
    'skeleton/effects/sub/dir/x.js',
  ];
  const positives = [...sources, ...abs.flatMap((a) => sources.filter((s) => !s.startsWith('./')).map((s) => a + s))];

  it.each(positives)('matches root source path %s', (p) => {
    expect(matcher.test(p)).toBe(true);
  });

  const negatives = [
    'skeleton/test/engine.test.js', 'skeleton\\test\\browser\\effects.pw.js',
    'app1-doomscroll/skeleton/engine.js', 'app1-doomscroll\\skeleton\\effects\\rot.js',
    'C:\\Users\\kohli\\Desktop\\poltergeist\\skeleton\\test\\rot.test.js',
    'C:\\Users\\kohli\\Desktop\\poltergeist\\app1-doomscroll\\skeleton\\engine.js',
    '/home/dev/poltergeist/app1-doomscroll/skeleton/effects/rot.js',
    'C:/Users/kohli/Desktop/poltergeist/skeleton/test/rot.test.js',
    'skeleton', 'skeleton/', 'skeleton/effects/', 'other/skeleton/engine.js', 'skeleton-old/engine.js',
  ];

  it.each(negatives)('does not match %s', (p) => {
    expect(matcher.test(p)).toBe(false);
  });

  it('is not gitignored', () => {
    let ignored = true;
    try {
      execFileSync('git', ['check-ignore', '-q', '.kiro/hooks/build-doomscroll-on-skeleton-save.json'], { cwd: REPO_ROOT, stdio: 'ignore' });
    } catch (e) {
      ignored = e.status === 0;
    }
    expect(ignored).toBe(false);
  });
});
