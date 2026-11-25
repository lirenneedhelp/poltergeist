// @vitest-environment jsdom
// Startup compatibility with a registry that has no `ritual` (Requirements 16.6, 16.7).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { startPoltergeist, builtinEffects } from '../index.js';

const { ritual: _ritual, ...registryWithoutRitual } = builtinEffects;

const rule = (id, type) => ({
  id,
  match: ['*://*/*'],
  trigger: { meter: 'timeOnSite', threshold: 0 },
  effect: { type },
  undo: { mode: 'instant' },
});

const pageSnapshot = () => ({
  html: document.documentElement.outerHTML,
  htmlStyle: document.documentElement.getAttribute('style'),
  bodyStyle: document.body.getAttribute('style'),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startPoltergeist with a registry without ritual (16.6)', () => {
  it('the registry has the five pre-existing effects only', () => {
    expect(Object.keys(registryWithoutRitual)).toEqual(['fog', 'flicker', 'rot', 'block', 'tombstone']);
  });

  it('starts, applies and undoes rules that do not reference ritual', () => {
    const before = pageSnapshot();
    const rules = { rules: [rule('mist', 'fog'), rule('wall', 'block')] };
    let ghost;
    expect(() => {
      ghost = startPoltergeist({ rules, window, document, effects: registryWithoutRitual });
    }).not.toThrow();
    try {
      expect(ghost.engine.activeRuleIds()).toEqual(['mist', 'wall']);
      expect(document.querySelector('[data-poltergeist="fog"]')).not.toBeNull();
      expect(document.querySelector('[data-poltergeist="block"]')).not.toBeNull();
      expect(document.querySelector('[data-poltergeist="ritual"]')).toBeNull();
    } finally {
      ghost.stop();
    }
    expect(ghost.engine.activeRuleIds()).toEqual([]);
    expect(pageSnapshot()).toEqual(before);
  });

  it('produces the same DOM as the full registry for the same rules', () => {
    const rules = { rules: [rule('mist', 'fog'), rule('wall', 'block')] };
    const withRitual = startPoltergeist({ rules, window, document });
    const fullDom = document.documentElement.outerHTML;
    withRitual.stop();

    const without = startPoltergeist({ rules, window, document, effects: registryWithoutRitual });
    try {
      expect(document.documentElement.outerHTML).toBe(fullDom);
    } finally {
      without.stop();
    }
  });
});

describe('startPoltergeist with ritual rules and a registry without ritual (16.7)', () => {
  it('throws the invalid-rules error with one line per ritual rule, before meters or effects exist', () => {
    const before = pageSnapshot();
    const winAdd = vi.spyOn(window, 'addEventListener');
    const docAdd = vi.spyOn(document, 'addEventListener');
    const applies = [];
    const effects = Object.fromEntries(
      Object.entries(registryWithoutRitual).map(([name, fx]) => [
        name,
        { ...fx, apply: (...args) => (applies.push(name), fx.apply(...args)) },
      ]),
    );
    const rules = { rules: [rule('mist', 'fog'), rule('seance', 'ritual'), rule('seance2', 'ritual')] };

    let error;
    try {
      startPoltergeist({ rules, window, document, effects });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message.startsWith('Invalid Poltergeist rules:')).toBe(true);
    const lines = error.message.split('\n');
    expect(lines).toContain('rules[1].effect.type: must be one of [fog, flicker, rot, block, tombstone]');
    expect(lines).toContain('rules[2].effect.type: must be one of [fog, flicker, rot, block, tombstone]');
    expect(lines.filter((l) => l.includes('effect.type'))).toHaveLength(2);

    expect(winAdd).not.toHaveBeenCalled();
    expect(docAdd).not.toHaveBeenCalled();
    expect(applies).toEqual([]);
    expect(document.querySelector('[data-poltergeist]')).toBeNull();
    expect(pageSnapshot()).toEqual(before);
  });
});
