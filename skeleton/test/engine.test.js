import { describe, it, expect, vi } from 'vitest';
import { createEngine, computeIntensity } from '../engine.js';

const rule = (over = {}) => ({
  id: 'r1',
  match: ['*://*.example.com/*'],
  trigger: { meter: 'timeOnSite', threshold: 10, rampTo: 20 },
  effect: { type: 'fake', params: { a: 1 } },
  undo: { mode: 'instant' },
  ...over,
});

function setup(rules, values, url = 'https://www.example.com/feed') {
  const calls = [];
  const effects = {
    fake: {
      apply: vi.fn((env, params, intensity, handle) => {
        calls.push(['apply', intensity, !!handle]);
        return handle ?? { id: 'h' };
      }),
      undo: vi.fn((handle, opts) => calls.push(['undo', opts.durationMs])),
    },
  };
  const state = { values, url, updates: [] };
  const meters = {
    update: (matched) => state.updates.push(matched),
    values: () => state.values,
  };
  const engine = createEngine({ rules, meters, effects, env: {}, getUrl: () => state.url, onError: (e) => { throw e; } });
  return { engine, effects, calls, state };
}

describe('computeIntensity', () => {
  it('ramps between threshold and rampTo and clamps', () => {
    const t = { threshold: 10, rampTo: 20 };
    expect(computeIntensity(t, 15)).toBeCloseTo(0.5);
    expect(computeIntensity(t, 99)).toBe(1);
    expect(computeIntensity(t, 10)).toBeGreaterThan(0);
  });
  it('is 1 without rampTo', () => {
    expect(computeIntensity({ threshold: 5 }, 5)).toBe(1);
  });
});

describe('engine.tick', () => {
  it('does nothing below threshold', () => {
    const { engine, calls } = setup([rule()], { timeOnSite: 5 });
    expect(engine.tick().applied).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('applies once on trigger, then only updates when intensity changes', () => {
    const { engine, calls, state } = setup([rule()], { timeOnSite: 10 });
    expect(engine.tick().applied).toEqual(['r1']);
    expect(engine.tick()).toEqual({ applied: [], updated: [], undone: [] });
    state.values = { timeOnSite: 15 };
    expect(engine.tick().updated).toEqual(['r1']);
    expect(calls.map((c) => c[0])).toEqual(['apply', 'apply']);
    expect(calls[1][2]).toBe(true); // reused handle
  });

  it('undoes when the meter drops below threshold', () => {
    const { engine, state, effects } = setup([rule()], { timeOnSite: 12 });
    engine.tick();
    state.values = { timeOnSite: 0 };
    expect(engine.tick().undone).toEqual(['r1']);
    expect(effects.fake.undo).toHaveBeenCalledOnce();
    expect(engine.activeRuleIds()).toEqual([]);
  });

  it('undoes when the URL stops matching, and pauses timeOnSite', () => {
    const { engine, state } = setup([rule()], { timeOnSite: 12 });
    engine.tick();
    state.url = 'https://other.org/';
    expect(engine.tick().undone).toEqual(['r1']);
    expect(state.updates.at(-1)).toBe(false);
  });

  it('ignores disabled rules', () => {
    const { engine } = setup([rule({ enabled: false })], { timeOnSite: 99 });
    expect(engine.tick().applied).toEqual([]);
  });

  it('uses the fade duration from the rule', () => {
    const { engine, state, calls } = setup([rule({ undo: { mode: 'fade', durationMs: 500 } })], { timeOnSite: 12 });
    engine.tick();
    state.values = { timeOnSite: 0 };
    engine.tick();
    expect(calls.at(-1)).toEqual(['undo', 500]);
  });

  it('finishes a pending fade before re-applying', () => {
    const { engine, state, calls } = setup([rule({ undo: { mode: 'fade', durationMs: 500 } })], { timeOnSite: 12 });
    engine.tick();
    state.values = { timeOnSite: 0 };
    engine.tick();
    state.values = { timeOnSite: 12 };
    engine.tick();
    expect(calls.map((c) => c.slice(0, 2).join(':'))).toEqual(['apply:0.2', 'undo:500', 'undo:0', 'apply:0.2']);
  });

  it('a throwing effect does not break other rules', () => {
    const errors = [];
    const good = { apply: vi.fn(() => ({})), undo: vi.fn() };
    const bad = { apply: () => { throw new Error('boom'); }, undo: vi.fn() };
    const engine = createEngine({
      rules: [rule({ id: 'bad', effect: { type: 'bad' } }), rule({ id: 'good', effect: { type: 'good' } })],
      meters: { update() {}, values: () => ({ timeOnSite: 15 }) },
      effects: { good, bad },
      env: {},
      getUrl: () => 'https://example.com/',
      onError: (e) => errors.push(e.message),
    });
    expect(engine.tick().applied).toEqual(['good']);
    expect(errors).toEqual(['boom']);
  });

  it('stop() undoes everything and halts the interval', () => {
    vi.useFakeTimers();
    try {
      const { engine, effects, state } = setup([rule()], { timeOnSite: 12 });
      engine.start();
      expect(engine.activeRuleIds()).toEqual(['r1']);
      engine.stop();
      expect(effects.fake.undo).toHaveBeenCalledOnce();
      state.values = { timeOnSite: 99 };
      vi.advanceTimersByTime(1000);
      expect(engine.activeRuleIds()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticks every 250ms by default', () => {
    vi.useFakeTimers();
    try {
      const { engine, state } = setup([rule()], { timeOnSite: 0 });
      engine.start(); // immediate tick
      expect(state.updates.length).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(state.updates.length).toBe(5);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
