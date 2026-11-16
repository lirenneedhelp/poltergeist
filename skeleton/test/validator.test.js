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
    expect(props.effect.properties.type).toEqual({ type: 'string' });
    expect(props.undo.properties.mode.enum).toEqual(UNDO_MODES);
    expect(Object.keys(builtinEffects).sort()).toEqual([...EFFECT_TYPES].sort());
  });
});

describe('validator effect registry', () => {
  const withType = (type) => {
    const r = good();
    r.effect.type = type;
    return r;
  };
  const custom = { haunt: { apply() {}, undo() {}, description: 'x' }, ghost: {} };

  it('accepts custom registry types and rejects builtin ones not in it', () => {
    expect(validateRule(withType('haunt'), 'rule', custom)).toEqual([]);
    expect(validateRule(withType('haunt'), custom)).toEqual([]);
    expect(validateRule(withType('rot'), custom).join('\n')).toContain('effect.type');
    expect(validateRules([withType('ghost')], custom).valid).toBe(true);
    expect(validateRules([withType('rot')], custom).valid).toBe(false);
  });

  it('defaults to builtin effects', () => {
    for (const t of Object.keys(builtinEffects)) {
      expect(validateRule(withType(t))).toEqual([]);
      expect(validateRules([withType(t)]).valid).toBe(true);
    }
    expect(validateRule(withType('haunt'))).not.toEqual([]);
  });

  it('rejects every type with an empty registry', () => {
    const errors = validateRule(withType('rot'), 'rule', {});
    expect(errors.join('\n')).toContain('effect.type');
    expect(validateRules([good()], {}).valid).toBe(false);
  });

  it('lists the complete key list in diagnostics', () => {
    const msg = validateRule(withType('nope'), 'rule', custom).find((e) => e.includes('effect.type'));
    expect(msg).toContain('haunt');
    expect(msg).toContain('ghost');
    const builtinMsg = validateRule(withType('nope')).find((e) => e.includes('effect.type'));
    for (const k of Object.keys(builtinEffects)) expect(builtinMsg).toContain(k);
  });

  it('does not mutate rule or registry', () => {
    const rule = withType('nope');
    const ruleCopy = JSON.stringify(rule);
    const registry = { a: {}, b: {} };
    const keys = Object.keys(registry);
    validateRule(rule, 'rule', registry);
    validateRules([rule], registry);
    expect(JSON.stringify(rule)).toBe(ruleCopy);
    expect(Object.keys(registry)).toEqual(keys);
  });

  it('EFFECT_TYPES equals builtinEffects keys and schema type is a plain string', () => {
    const schema = JSON.parse(readFileSync(new URL('../rule-schema.json', import.meta.url), 'utf8'));
    const type = schema.definitions.rule.properties.effect.properties.type;
    expect(type).toEqual({ type: 'string' });
    expect(type.enum).toBeUndefined();
    expect([...EFFECT_TYPES]).toEqual(Object.keys(builtinEffects));
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
