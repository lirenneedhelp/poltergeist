import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { builtinEffects } from '../skeleton/effects/index.js';

const README_PATH = fileURLToPath(new URL('../README.md', import.meta.url));
const readme = readFileSync(README_PATH, 'utf8');

/** Lines of the `## Effects` section, up to the next `##` heading or end of file. */
function effectsSection(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '## Effects');
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Parses ``- `<name>`: <description>`` list lines into [name, description] pairs. */
function effectEntries(sectionLines) {
  const entries = [];
  for (const line of sectionLines) {
    const m = /^- `([^`]+)`: (.*)$/.exec(line.trim());
    if (m) entries.push([m[1], m[2].trim()]);
  }
  return entries;
}

describe('README effect list (Requirement 15.5)', () => {
  const section = effectsSection(readme);
  const entries = section ? effectEntries(section) : [];
  const registered = Object.keys(builtinEffects);

  it('has an "## Effects" section with list entries', () => {
    expect(section).not.toBeNull();
    expect(entries.length).toBeGreaterThan(0);
  });

  // Haunt Kit invariant 21: The docs agree with the code
  it('lists every registered effect exactly once with its description export', () => {
    for (const name of registered) {
      const matches = entries.filter(([n]) => n === name);
      expect(matches, `README entries for "${name}"`).toHaveLength(1);
      expect(matches[0][1], `README description for "${name}"`).toBe(
        builtinEffects[name].description,
      );
    }
  });

  // Haunt Kit invariant 21: The docs agree with the code
  it('lists no unregistered effect', () => {
    const unregistered = entries.map(([n]) => n).filter((n) => !registered.includes(n));
    expect(unregistered).toEqual([]);
  });
});

const STEERING_PATH = fileURLToPath(
  new URL('../.kiro/steering/haunt-authoring.md', import.meta.url),
);
const steering = readFileSync(STEERING_PATH, 'utf8');

/** Lines between the exact level-2 heading and the next `## ` heading (or end of file). */
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Fenced code blocks in the given lines: [{ lang, lines, startIndex }]. */
function codeBlocks(lines) {
  const blocks = [];
  let open = null;
  lines.forEach((line, i) => {
    const m = /^\s*```(\w*)\s*$/.exec(line);
    if (!m) {
      if (open) open.lines.push(line);
      return;
    }
    if (open) {
      blocks.push(open);
      open = null;
    } else {
      open = { lang: m[1], lines: [], startIndex: i };
    }
  });
  return blocks;
}

/** Top-level `- ` bullet texts outside code blocks, with their line index. */
function bullets(lines) {
  const out = [];
  let inCode = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      return;
    }
    if (!inCode && /^- /.test(line)) out.push({ text: line.slice(2).trim(), index: i });
  });
  return out;
}

/** Numbered steps (`1. ...`) with the lines that belong to each step. */
function numberedSteps(lines) {
  const steps = [];
  let inCode = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const m = !inCode && /^(\d+)\. (.*)$/.exec(line);
    if (m) {
      steps.push({ number: Number(m[1]), lines: [line] });
    } else if (steps.length) {
      steps[steps.length - 1].lines.push(line);
    }
  }
  return steps;
}

describe('README "Build your own haunt in 10 minutes" (Requirement 15.1)', () => {
  const lines = section(readme, 'Build your own haunt in 10 minutes');
  const steps = lines ? numberedSteps(lines) : [];
  const stepText = (i) => (steps[i] ? steps[i].lines.join('\n') : '');
  const stepCode = (i) =>
    steps[i] ? codeBlocks(steps[i].lines).map((b) => b.lines.join('\n').trim()) : [];

  it('has the exact level-2 heading', () => {
    expect(lines).not.toBeNull();
  });

  it('has five numbered steps, numbered 1 to 5 in order', () => {
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('step (a) runs the scaffolder with the `--` separator in a code block', () => {
    expect(stepCode(0)).toContain('npm run new-haunt <name> -- --hosts <pattern,...>');
  });

  it('step (b) edits the generated app\'s rules.json', () => {
    expect(stepText(1)).toMatch(/rules\.json/);
    expect(stepCode(1).join('\n')).toMatch(/app<N>-<name>\/rules\.json/);
  });

  it('step (c) runs npm test in a code block', () => {
    expect(stepCode(2)).toContain('npm test');
  });

  it('step (d) loads the folder through chrome://extensions with Developer mode and "Load unpacked"', () => {
    const text = stepText(3);
    expect(text).toMatch(/Developer mode/);
    expect(text).toMatch(/"Load unpacked"/);
    expect(text).toMatch(/app<N>-<name>/);
    expect(stepCode(3)).toContain('chrome://extensions');
  });

  it('step (e) opens the Playground and tries the rules, with the command in a code block', () => {
    expect(stepText(4)).toMatch(/Playground/);
    expect(stepText(4)).toMatch(/rules/);
    expect(stepCode(4)).toContain('npm run playground');
  });
});

describe('README "Write your own ritual" (Requirements 15.2 to 15.4)', () => {
  const lines = section(readme, 'Write your own ritual');
  const blocks = lines ? codeBlocks(lines) : [];
  const jsBlocks = blocks.filter((b) => b.lang === 'js' || b.lang === 'javascript');
  const codeStart = jsBlocks.length ? jsBlocks[0].startIndex : Infinity;
  const allBullets = lines ? bullets(lines) : [];
  const contractBullets = allBullets.filter((b) => b.index < codeStart).map((b) => b.text);
  const suggestionBullets = allBullets.filter((b) => b.index > codeStart).map((b) => b.text);
  const steeringContract = (section(steering, 'Ritual contract') ?? [])
    .filter((l) => /^- /.test(l))
    .map((l) => l.slice(2).trim());

  it('has the exact level-2 heading', () => {
    expect(lines).not.toBeNull();
  });

  // Haunt Kit invariant 21: The docs agree with the code
  it('lists the steering doc\'s Ritual contract items as separate bullets', () => {
    expect(steeringContract.length).toBeGreaterThan(0);
    expect(contractBullets).toEqual(steeringContract);
  });

  it('states that the ritual only makes the Exorcised_Action and the app decides what follows', () => {
    const text = lines.join('\n');
    expect(text).toMatch(/The ritual only makes the Exorcised_Action\./);
    expect(text).toMatch(/The app decides what happens after `exorcised`/);
  });

  describe('ritual code block (Requirement 15.3)', () => {
    const code = jsBlocks.length ? jsBlocks[0].lines.join('\n') : '';

    it('has exactly one JavaScript code block of at most 40 lines', () => {
      expect(jsBlocks).toHaveLength(1);
      expect(jsBlocks[0].lines.length).toBeLessThanOrEqual(40);
    });

    it('exports apply, undo and description', () => {
      for (const name of ['apply', 'undo', 'description']) {
        expect(code, `export ${name}`).toMatch(
          new RegExp(`export\\s+(?:const|let|function)\\s+${name}\\b`),
        );
      }
    });

    it('returns early from its handler when the event is not trusted', () => {
      expect(code).toMatch(/if\s*\(\s*!\s*\w+\.isTrusted\s*\)\s*return\b/);
    });

    it("calls env.onAction('exorcised') exactly once", () => {
      expect(code.match(/env\.onAction\(\s*'exorcised'\s*\)/g) ?? []).toHaveLength(1);
    });

    it('uses no innerHTML and no chrome.* API', () => {
      expect(code).not.toMatch(/innerHTML/);
      expect(code).not.toMatch(/\bchrome\./);
    });
  });

  it('suggests a typed vow, a breathing timer and a riddle, one sentence each (Requirement 15.4)', () => {
    expect(suggestionBullets.length).toBeGreaterThanOrEqual(3);
    for (const name of ['Typed vow', 'Breathing timer', 'Riddle']) {
      const entry = suggestionBullets.find((t) => t.startsWith(`${name}:`));
      expect(entry, `suggestion "${name}"`).toBeDefined();
      const sentence = entry.slice(name.length + 1).trim();
      expect(sentence, `one sentence for "${name}"`).toMatch(/^[^.!?]+[.!?]$/);
    }
  });
});
