// @vitest-environment jsdom
// haunt-polish Requirements 6 and 9.2: demo-time durations in the Doomscroll Demo_Profile.
// Example-based only (Requirement 9.1).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { validateRules, builtinEffects } from '../../skeleton/index.js';
import * as block from '../../skeleton/effects/block.js';

// jsdom replaces the global URL, so file paths are built from the repo root (as in the popup tests).
const APP_DIR = path.join(process.cwd(), 'app1-doomscroll');
const SOURCE = readFileSync(path.join(APP_DIR, 'content.js'), 'utf8');
const NORMAL = JSON.parse(readFileSync(path.join(APP_DIR, 'rules.json'), 'utf8'));
const SCALE = 60;
const DEMO_SUFFIX = ' (demo time)';
const DURATION_RULE = 'doomscroll-block';

/** Evaluate content.js as a classic script in an isolated VM context (no chrome → boot is inert). */
function loadContent() {
  const sandbox = { structuredClone, console };
  vm.runInNewContext(SOURCE, sandbox, { filename: 'content.js' });
  return sandbox;
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const isDurationRule = (r) => typeof r?.effect?.params?.durationMeter === 'string';
const buildDemo = (doc) => loadContent().doomscrollCreateDemoProfile(doc);

describe('doomscrollCreateDemoProfile demo-time durations', () => {
  it('gives the Duration_Rule durationScale 60 and the Demo_Suffix', () => {
    const demo = plain(buildDemo(NORMAL));
    const rule = demo.rules.find((r) => r.id === DURATION_RULE);
    expect(rule.effect.params.durationScale).toBe(SCALE);
    expect(rule.effect.params.durationSuffix).toBe(DEMO_SUFFIX);
  });

  it('leaves every other rule and param equal to the Normal_Profile apart from divided trigger times', () => {
    const before = plain(NORMAL);
    const demo = plain(buildDemo(NORMAL));
    expect(demo.rules).toHaveLength(before.rules.length);
    demo.rules.forEach((d, i) => {
      const n = before.rules[i];
      const { trigger: dt, effect: de, ...dRest } = d;
      const { trigger: nt, effect: ne, ...nRest } = n;
      expect(dRest).toEqual(nRest);
      expect(dt).toEqual({ ...nt, threshold: nt.threshold / SCALE, ...(nt.rampTo === undefined ? {} : { rampTo: nt.rampTo / SCALE }) });
      expect(de.type).toBe(ne.type);
      const { durationScale, durationSuffix, ...params } = de.params;
      expect(params).toEqual(ne.params);
      if (n.id !== DURATION_RULE) {
        expect(durationScale).toBeUndefined();
        expect(durationSuffix).toBeUndefined();
      }
    });
  });

  it('leaves the Normal_Profile deep-equal to a copy taken before the call, even after demo params change', () => {
    const before = plain(NORMAL);
    const demo = buildDemo(NORMAL);
    expect(NORMAL).toEqual(before);
    const params = demo.rules.find((r) => r.id === DURATION_RULE).effect.params;
    params.durationScale = 1;
    params.durationSuffix = ' (edited)';
    params.detail = 'edited';
    demo.rules[0].effect.params.maxBlur = 999;
    expect(NORMAL).toEqual(before);
  });

  it('adds neither param to a Block rule without a string durationMeter', () => {
    const base = plain(NORMAL.rules.find((r) => r.id === DURATION_RULE));
    const noMeter = plain(base);
    noMeter.id = 'no-meter';
    delete noMeter.effect.params.durationMeter;
    const numericMeter = plain(base);
    numericMeter.id = 'numeric-meter';
    numericMeter.effect.params.durationMeter = 5;
    const demo = plain(buildDemo({ rules: [noMeter, numericMeter] }));
    for (const rule of demo.rules) {
      expect(rule.effect.params).not.toHaveProperty('durationScale');
      expect(rule.effect.params).not.toHaveProperty('durationSuffix');
    }
    expect(demo.rules[0].effect.params).toEqual(noMeter.effect.params);
    expect(demo.rules[1].effect.params).toEqual(numericMeter.effect.params);
  });

  it('skips malformed rules without throwing and still returns the Demo_Profile', () => {
    const malformed = [
      null,
      'rule',
      5,
      { id: 'no-effect' },
      { id: 'null-effect', effect: null },
      { id: 'string-effect', effect: 'block' },
      { id: 'no-params', effect: { type: 'block' } },
      { id: 'null-params', effect: { type: 'block', params: null } },
      { id: 'array-params', effect: { type: 'block', params: [{ durationMeter: 'timeOnSite' }] } },
      { id: 'string-params', effect: { type: 'block', params: 'durationMeter' } },
      { id: 'null-meter', effect: { type: 'block', params: { durationMeter: null } } },
    ];
    const input = { rules: malformed };
    const before = plain(input);
    let demo;
    expect(() => { demo = buildDemo(input); }).not.toThrow();
    expect(plain(demo)).toEqual(before);
    expect(plain(input)).toEqual(before);
  });

  it('builds a Demo_Profile that validateRules reports valid with no errors', () => {
    const result = validateRules(buildDemo(NORMAL), builtinEffects);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('keeps the Normal_Profile free of duration params, with exactly one Duration_Rule', () => {
    for (const rule of NORMAL.rules) {
      expect(rule.effect.params).not.toHaveProperty('durationScale');
      expect(rule.effect.params).not.toHaveProperty('durationSuffix');
    }
    const durationRules = NORMAL.rules.filter(isDurationRule);
    expect(durationRules.map((r) => r.id)).toEqual([DURATION_RULE]);
    expect(durationRules[0].effect.params.durationMeter).toBe('timeOnSite');
  });
});

describe('Demo_Mode Block text end to end', () => {
  let handle;
  afterEach(() => {
    if (handle) block.undo(handle, { durationMs: 0 });
    handle = undefined;
  });

  it('shows "You lost 20 minutes (demo time) to this feed." at timeOnSite 20', () => {
    const demo = buildDemo(NORMAL);
    const { params } = demo.rules.find((r) => r.id === DURATION_RULE).effect;
    const env = {
      window,
      document,
      reducedMotion: true,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      readMeter: (name) => (name === 'timeOnSite' ? 20 : undefined),
    };
    handle = block.apply(env, params, 1);
    const detail = handle.el.shadowRoot.querySelectorAll('p');
    expect(detail).toHaveLength(1);
    expect(detail[0].textContent).toBe('You lost 20 minutes (demo time) to this feed.');
    expect(handle.el.textContent).toBe(params.message);
  });
});
