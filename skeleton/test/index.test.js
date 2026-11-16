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
