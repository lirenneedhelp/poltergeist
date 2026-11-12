import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateRule, validateRules, METERS, EFFECT_TYPES, UNDO_MODES } from '../validator.js';
import { matchUrl } from '../match.js';
import { builtinEffects } from '../effects/index.js';

const good = () => ({
  id: 'feed-rot',
  match: ['*://*.twitter.com/*'],
  trigger: { meter: 'timeOnSite', threshold: 60, rampTo: 600 },
  effect: { type: 'rot', params: { maxFraction: 0.4 } },
  undo: { mode: 'fade', durationMs: 800 },
});

describe('validator', () => {
  it('accepts a good rule, as array or {rules}', () => {
    expect(validateRule(good())).toEqual([]);
    expect(validateRules([good()]).valid).toBe(true);
    expect(validateRules({ rules: [good()] }).valid).toBe(true);
  });

  it.each([
    ['missing undo', (r) => delete r.undo, 'undo'],
    ['bad meter', (r) => (r.trigger.meter = 'mood'), 'trigger.meter'],
    ['negative threshold', (r) => (r.trigger.threshold = -1), 'threshold'],
    ['rampTo <= threshold', (r) => (r.trigger.rampTo = 60), 'rampTo'],
    ['bad effect', (r) => (r.effect.type = 'explode'), 'effect.type'],
    ['bad pattern', (r) => (r.match = ['twitter.com']), 'match[0]'],
    ['empty match', (r) => (r.match = []), 'match'],
    ['bad id', (r) => (r.id = 'Bad Id'), 'id'],
    ['unknown key', (r) => (r.extra = 1), 'extra'],
    ['bad duration', (r) => (r.undo.durationMs = 99999), 'durationMs'],
  ])('rejects: %s', (_n, mutate, fragment) => {
    const r = good();
    mutate(r);
    const errors = validateRule(r);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain(fragment);
  });

  it('rejects duplicate ids and non-rule documents', () => {
    expect(validateRules([good(), good()]).errors.join()).toContain('duplicate');
    expect(validateRules('nope').valid).toBe(false);
  });
});

describe('schema stays in sync', () => {
  const schema = JSON.parse(readFileSync(new URL('../rule-schema.json', import.meta.url), 'utf8'));
  const props = schema.definitions.rule.properties;
  it('enums match validator constants and effect registry', () => {
    expect(props.trigger.properties.meter.enum).toEqual(METERS);
    expect(props.effect.properties.type.enum).toEqual(EFFECT_TYPES);
    expect(props.undo.properties.mode.enum).toEqual(UNDO_MODES);
    expect(Object.keys(builtinEffects).sort()).toEqual([...EFFECT_TYPES].sort());
  });
});

describe('matchUrl', () => {
  it('handles wildcard hosts, schemes, and paths', () => {
    expect(matchUrl(['*://*.example.com/*'], 'https://www.example.com/a?b=1')).toBe(true);
    expect(matchUrl(['*://*.example.com/*'], 'https://example.com/')).toBe(true);
    expect(matchUrl(['*://*.example.com/*'], 'https://notexample.com/')).toBe(false);
    expect(matchUrl(['https://example.com/feed*'], 'http://example.com/feed')).toBe(false);
    expect(matchUrl(['https://example.com/feed*'], 'https://example.com/feed/1')).toBe(true);
    expect(matchUrl(['<all_urls>'], 'https://a.b/')).toBe(true);
    expect(matchUrl(['<all_urls>'], 'chrome://settings')).toBe(false);
  });
});
