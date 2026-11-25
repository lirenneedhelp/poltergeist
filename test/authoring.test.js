// @vitest-environment jsdom
// Kiro authoring workflow tests: the Steering_Doc, the Effect_Hook and the hooks README
// (Requirements 1.6, 2.5, 2.6). Example-based only; every path list is fixed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMeters } from '../skeleton/meters.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(path.join(REPO_ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const STEERING = read('.kiro', 'steering', 'haunt-authoring.md');
const SCHEMA = JSON.parse(read('skeleton', 'rule-schema.json'));
const HOOK_DOC = JSON.parse(read('.kiro', 'hooks', 'new-effect.json'));
const HOOKS_README = read('.kiro', 'hooks', 'README.md');

// Front matter: the text between the first two `---` lines (design 1.1).
function frontMatter(doc) {
  const lines = doc.split('\n');
  const first = lines.indexOf('---');
  const second = lines.indexOf('---', first + 1);
  if (first < 0 || second < 0) return null;
  const fields = {};
  for (const line of lines.slice(first + 1, second)) {
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

// A section: the list items between its `##` heading and the next `##` (design 1.1).
function section(doc, heading) {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return null;
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    const m = /^(?:-|\d+\.)\s+(.*)$/.exec(line);
    if (m) items.push({ marker: line.split(/\s/)[0], text: m[1] });
  }
  return items;
}

const backticked = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// The meter enum in the schema: every `meter` property declared with an enum.
function schemaMeters(node, found = new Set()) {
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'meter' && value && Array.isArray(value.enum)) value.enum.forEach((m) => found.add(m));
      schemaMeters(value, found);
    }
  }
  return found;
}

const METERS = schemaMeters(SCHEMA);
const sorted = (iter) => [...iter].sort();

describe('Steering_Doc', () => {
  it('has fileMatch front matter with exactly the three patterns', () => {
    const fm = frontMatter(STEERING);
    expect(fm).not.toBeNull();
    expect(fm.inclusion).toBe('fileMatch');
    expect(JSON.parse(fm.fileMatchPattern)).toEqual(['skeleton/effects/**', 'skeleton/ritual/**', '**/rules.json']);
  });

  it('has the four required sections, and "Adding an effect" has six numbered steps', () => {
    for (const heading of ['Effect contract', 'Meter rules', 'Ritual contract', 'Adding an effect']) {
      expect(section(STEERING, heading), heading).not.toBeNull();
    }
    const steps = section(STEERING, 'Adding an effect');
    expect(steps.map((s) => s.marker)).toEqual(['1.', '2.', '3.', '4.', '5.', '6.']);
  });

  // Haunt Kit invariant 21: The docs agree with the code (steering part)
  it('lists exactly the schema meter names under "Meter rules"', () => {
    expect(METERS.size).toBeGreaterThan(0);
    const [first] = section(STEERING, 'Meter rules');
    expect(sorted(new Set(backticked(first.text)))).toEqual(sorted(METERS));
  });

  // Haunt Kit invariant 21: The docs agree with the code (steering part)
  it('lists exactly the meters that meters.reset accepts as resettable', () => {
    const third = section(STEERING, 'Meter rules')[2];
    const listed = new Set(backticked(third.text).filter((n) => METERS.has(n)));
    const accepted = new Set();
    for (const name of METERS) {
      const meters = createMeters({ window, document, now: () => 0 });
      try {
        if (meters.reset(name) === true) accepted.add(name);
      } finally {
        meters.dispose();
      }
    }
    expect(accepted.size).toBeGreaterThan(0);
    expect(sorted(listed)).toEqual(sorted(accepted));
  });
});

describe('Effect_Hook file', () => {
  const [hook] = HOOK_DOC.hooks;

  it('declares one PostFileCreate hook with an agent action', () => {
    expect(HOOK_DOC.version).toBe('v1');
    expect(HOOK_DOC.hooks).toHaveLength(1);
    expect(hook.trigger).toBe('PostFileCreate');
    expect(hook.action.type).toBe('agent');
  });

  // Haunt Kit invariant 15: The Effect_Hook matcher selects exactly root effect files
  describe('matcher', () => {
    const MATCHES = [
      'skeleton/effects/ritual.js',
      'skeleton\\effects\\ritual.js',
      './skeleton/effects/ritual.js',
      '.\\skeleton\\effects\\ritual.js',
      'C:\\Users\\me\\poltergeist\\skeleton\\effects\\x.js',
      'C:/Users/me/poltergeist/skeleton/effects/x.js',
      '/home/me/poltergeist/skeleton/effects/x.js',
    ];
    const NON_MATCHES = [
      'skeleton/test/ritual.js',
      'skeleton/ritual/candle-path.js',
      'skeleton\\ritual\\candle-path.js',
      'app1-doomscroll/skeleton/effects/ritual.js',
      'app2-tab-graveyard\\skeleton\\effects\\ritual.js',
      'demo-site/skeleton/effects/ritual.js',
      'C:\\Users\\me\\poltergeist\\app1-doomscroll\\skeleton\\effects\\x.js',
      '/home/me/poltergeist/demo-site/skeleton/effects/x.js',
      'skeleton/effects/sub/x.js',
      'skeleton/effects/x.ts',
      'skeleton/effects/x.json',
    ];

    it('uses no lookaround', () => {
      for (const token of ['(?=', '(?!', '(?<=', '(?<!']) expect(hook.matcher).not.toContain(token);
    });

    for (const p of MATCHES) {
      it(`matches ${JSON.stringify(p)}`, () => expect(new RegExp(hook.matcher).test(p)).toBe(true));
    }
    for (const p of NON_MATCHES) {
      it(`rejects ${JSON.stringify(p)}`, () => expect(new RegExp(hook.matcher).test(p)).toBe(false));
    }
  });

  it('prompt lists the five wiring steps in order', () => {
    const prompt = hook.action.prompt;
    const markers = [
      '1. Register the effect in skeleton/effects/index.js',
      '2. Document the effect',
      'skeleton/rule-schema.json',
      '3. Add a restoration test',
      '4. Run npm run build:skeletons',
      '5. Add the effect to the effect list in README.md',
    ];
    let last = -1;
    for (const marker of markers) {
      const at = prompt.indexOf(marker, last + 1);
      expect(at, marker).toBeGreaterThan(last);
      last = at;
    }
  });

  it('prompt tells Kiro to stop for a file that exports no apply', () => {
    const prompt = hook.action.prompt;
    expect(prompt).toContain('skeleton/effects/<name>.js');
    expect(prompt).toContain('If it does not export a function named apply');
    expect(prompt).toContain('stop now and do not create, edit or delete any file');
  });
});

describe('hooks README', () => {
  const sectionText = (heading) => {
    const start = HOOKS_README.indexOf(`\n## ${heading}\n`);
    if (start < 0) return null;
    const next = HOOKS_README.indexOf('\n## ', start + 1);
    return HOOKS_README.slice(start, next < 0 ? undefined : next);
  };

  it('has new-effect.json and check-rules-on-save.json sections', () => {
    expect(sectionText('new-effect.json')).not.toBeNull();
    expect(sectionText('check-rules-on-save.json')).not.toBeNull();
  });

  it('says the Effect_Hook fires only on file-create events Kiro emits', () => {
    expect(sectionText('new-effect.json').replace(/\s+/g, ' ')).toContain('fires only on file-create events Kiro emits');
  });
});
