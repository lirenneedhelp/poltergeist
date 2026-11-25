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
