// Hand-written validator mirroring rule-schema.json.
// (No Ajv: it compiles schemas with new Function(), which MV3's CSP forbids.)
// A test keeps the enums below in sync with the schema file.

import { isValidPattern } from './match.js';
import { builtinEffects } from './effects/index.js';

export const METERS = ['timeOnSite', 'scrollDistance', 'timeSinceActive'];
export const EFFECT_TYPES = Object.freeze(Object.keys(builtinEffects));
export const UNDO_MODES = ['instant', 'fade'];

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function checkKeys(obj, allowed, path, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(`${path}: unknown property "${k}"`);
  }
}

/**
 * Validate one rule. Returns an array of error strings (empty = valid).
 * Overloads: validateRule(rule, path?, effects?) and validateRule(rule, effects).
 */
export function validateRule(rule, path = 'rule', effects = builtinEffects) {
  if (typeof path !== 'string') {
    // validateRule(rule, effectsRegistry)
    effects = path;
    path = 'rule';
  }
  const allowedTypes = effects !== null && typeof effects === 'object' ? Object.keys(effects) : [];
  const errors = [];
  if (!isObj(rule)) return [`${path}: must be an object`];
  checkKeys(rule, ['id', 'description', 'enabled', 'match', 'trigger', 'effect', 'undo'], path, errors);

  if (typeof rule.id !== 'string' || !ID_RE.test(rule.id)) {
    errors.push(`${path}.id: required, lowercase letters/digits/-/_ only`);
  }
  if (rule.description !== undefined && typeof rule.description !== 'string') {
    errors.push(`${path}.description: must be a string`);
  }
  if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
    errors.push(`${path}.enabled: must be a boolean`);
  }

  if (!Array.isArray(rule.match) || rule.match.length === 0) {
    errors.push(`${path}.match: required, non-empty array of match patterns`);
  } else {
    rule.match.forEach((p, i) => {
      if (!isValidPattern(p)) errors.push(`${path}.match[${i}]: invalid match pattern ${JSON.stringify(p)}`);
    });
  }

  const t = rule.trigger;
  if (!isObj(t)) {
    errors.push(`${path}.trigger: required object`);
  } else {
    checkKeys(t, ['meter', 'threshold', 'rampTo'], `${path}.trigger`, errors);
    if (!METERS.includes(t.meter)) errors.push(`${path}.trigger.meter: must be one of ${METERS.join(', ')}`);
    if (!isNum(t.threshold) || t.threshold < 0) errors.push(`${path}.trigger.threshold: required number >= 0`);
    if (t.rampTo !== undefined) {
      if (!isNum(t.rampTo) || t.rampTo <= 0) errors.push(`${path}.trigger.rampTo: must be a number > 0`);
      else if (isNum(t.threshold) && t.rampTo <= t.threshold) {
        errors.push(`${path}.trigger.rampTo: must be greater than threshold`);
      }
    }
  }

  const e = rule.effect;
  if (!isObj(e)) {
    errors.push(`${path}.effect: required object`);
  } else {
    checkKeys(e, ['type', 'params'], `${path}.effect`, errors);
    if (typeof e.type !== 'string' || !allowedTypes.includes(e.type)) {
      errors.push(`${path}.effect.type: must be one of [${allowedTypes.join(', ')}]`);
    }
    if (e.params !== undefined && !isObj(e.params)) errors.push(`${path}.effect.params: must be an object`);
  }

  const u = rule.undo;
  if (!isObj(u)) {
    errors.push(`${path}.undo: required object`);
  } else {
    checkKeys(u, ['mode', 'durationMs'], `${path}.undo`, errors);
    if (!UNDO_MODES.includes(u.mode)) errors.push(`${path}.undo.mode: must be one of ${UNDO_MODES.join(', ')}`);
    if (u.durationMs !== undefined && (!Number.isInteger(u.durationMs) || u.durationMs < 0 || u.durationMs > 10000)) {
      errors.push(`${path}.undo.durationMs: must be an integer 0..10000`);
    }
  }
  return errors;
}

/** Validate a rules file (array or {rules: [...]}). Returns {valid, errors, rules}. */
export function validateRules(doc, effects = builtinEffects) {
  const errors = [];
  let list;
  if (Array.isArray(doc)) list = doc;
  else if (isObj(doc) && Array.isArray(doc.rules)) {
    list = doc.rules;
    checkKeys(doc, ['rules'], 'rules file', errors);
  } else {
    return { valid: false, errors: ['rules file: must be an array or an object with a "rules" array'], rules: [] };
  }
  const seen = new Set();
  list.forEach((r, i) => {
    errors.push(...validateRule(r, `rules[${i}]`, effects));
    if (isObj(r) && typeof r.id === 'string') {
      if (seen.has(r.id)) errors.push(`rules[${i}].id: duplicate id "${r.id}"`);
      seen.add(r.id);
    }
  });
  return { valid: errors.length === 0, errors, rules: errors.length === 0 ? list : [] };
}
