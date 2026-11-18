// @vitest-environment jsdom
// startPoltergeist validates rules against the supplied effects registry (Requirement 11.6).
import { describe, it, expect } from 'vitest';
import { startPoltergeist } from '../index.js';

const rule = (type) => ({
  rules: [
    {
      id: 'r1',
      match: ['*://*/*'],
      trigger: { meter: 'timeOnSite', threshold: 1000 },
      effect: { type },
      undo: { mode: 'instant' },
    },
  ],
});

describe('startPoltergeist effects registry validation (11.6)', () => {
  it('accepts a custom effect type present in the supplied registry', () => {
    const effects = { custom: { apply: () => ({}), undo: () => {}, description: 'x' } };
    const ghost = startPoltergeist({ rules: rule('custom'), window, document, effects });
    expect(ghost.engine).toBeDefined();
    ghost.stop();
  });

  it('throws invalid-rules for a builtin type absent from the supplied registry', () => {
    const effects = { custom: { apply: () => ({}), undo: () => {}, description: 'x' } };
    expect(() => startPoltergeist({ rules: rule('fog'), window, document, effects })).toThrow(
      /Invalid Poltergeist rules/,
    );
  });
});

// ---------------------------------------------------------------------------
// Effect environment hooks: readMeter and onAction (Requirements 4.11, 10.3).
// ---------------------------------------------------------------------------
import { vi } from 'vitest';

describe('startPoltergeist env hooks (4.11)', () => {
  const probeRules = {
    rules: [
      {
        id: 'probe',
        match: ['*://*/*'],
        trigger: { meter: 'timeAway', threshold: 0 },
        effect: { type: 'probe' },
        undo: { mode: 'instant' },
      },
    ],
  };
  // A probe effect that records the env it is applied with.
  const start = (opts = {}) => {
    let env;
    const effects = { probe: { apply: (e) => ((env = e), {}), undo: () => {}, description: 'probe' } };
    const ghost = startPoltergeist({ rules: probeRules, window, document, effects, ...opts });
    return { ghost, env };
  };

  it('readMeter returns live meter values', () => {
    const { ghost, env } = start({ initialMeters: { timeAway: 93600 } });
    try {
      expect(typeof env.readMeter).toBe('function');
      expect(env.readMeter('timeAway')).toBe(93600);
      expect(env.readMeter('timeAway')).toBe(ghost.meters.values().timeAway);
      expect(env.readMeter('scrollDistance')).toBe(ghost.meters.values().scrollDistance);
      ghost.meters.reset('timeAway');
      expect(env.readMeter('timeAway')).toBe(0);
      expect(env.readMeter('noSuchMeter')).toBeUndefined();
    } finally {
      ghost.stop();
    }
  });

  it('onAction forwards the action name to the callback', () => {
    const seen = [];
    const { ghost, env } = start({ onAction: (name) => seen.push(name) });
    try {
      env.onAction('resurrect');
      expect(seen).toEqual(['resurrect']);
    } finally {
      ghost.stop();
    }
  });

  it('onAction contains an error thrown by the callback', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ghost, env } = start({ onAction: () => { throw new Error('boom'); } });
    try {
      expect(() => env.onAction('resurrect')).not.toThrow();
      expect(err).toHaveBeenCalledTimes(1);
    } finally {
      err.mockRestore();
      ghost.stop();
    }
  });

  it('onAction is a no-op when no callback was given', () => {
    const { ghost, env } = start();
    try {
      expect(typeof env.onAction).toBe('function');
      expect(() => env.onAction('resurrect')).not.toThrow();
      expect(env.onAction('resurrect')).toBeUndefined();
    } finally {
      ghost.stop();
    }
  });

  it('keeps the {engine, meters, stop} return contract', () => {
    const { ghost } = start({ onAction: () => {} });
    expect(Object.keys(ghost).sort()).toEqual(['engine', 'meters', 'stop']);
    ghost.stop();
  });

  it('the tombstone reads timeAway through the env when started from rules', () => {
    const rules = {
      rules: [
        {
          id: 'grave',
          match: ['*://*/*'],
          trigger: { meter: 'timeAway', threshold: 86400 },
          effect: { type: 'tombstone' },
          undo: { mode: 'instant' },
        },
      ],
    };
    const ghost = startPoltergeist({ rules, window, document, initialMeters: { timeAway: 93600 } });
    try {
      const host = document.querySelector('[data-poltergeist="tombstone"]');
      expect(host).not.toBeNull();
      expect(host.shadowRoot.querySelector('p').textContent).toBe('Abandoned for 26 hours.');
    } finally {
      ghost.stop();
    }
    expect(document.querySelector('[data-poltergeist="tombstone"]')).toBeNull();
  });
});
