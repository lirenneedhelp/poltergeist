// @vitest-environment jsdom
// Rot effect: detached-node pruning and conditional restore (Requirements 13.1-13.6, 6.11, 6.12).
import { describe, it, expect, beforeEach } from 'vitest';
import * as rot from '../effects/rot.js';

const env = () => ({
  window,
  document,
  reducedMotion: false,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});
const P = { maxFraction: 1, glyphs: '#' };
const textOf = (id) => document.getElementById(id).firstChild;

beforeEach(() => {
  document.documentElement.innerHTML =
    '<head></head><body><p id="a">alpha beta</p><p id="b">gamma delta</p><p id="c">epsilon zeta</p></body>';
});

describe('detached-node pruning on apply', () => {
  it('prunes only detached entries in a mixed map and leaves retained entries unchanged (13.1, 13.4)', () => {
    const h = rot.apply(env(), P, 0.5);
    const a = textOf('a');
    const b = textOf('b');
    const c = textOf('c');
    expect(h.nodes.size).toBe(3);
    const keptEntryB = { ...h.nodes.get(b) };
    const keptEntryC = { ...h.nodes.get(c) };
    const detachedData = a.data;
    document.getElementById('a').remove();
    expect(a.isConnected).toBe(false);

    const same = rot.apply(env(), P, 0.5, h);
    expect(same).toBe(h);
    expect(h.nodes.has(a)).toBe(false);
    expect(h.nodes.size).toBe(2);
    expect(h.nodes.get(b)).toEqual(keptEntryB);
    expect(h.nodes.get(c)).toEqual(keptEntryC);
    // detached node's data is never touched (13.3)
    expect(a.data).toBe(detachedData);
  });

  it('keeps every entry when all nodes are connected (13.2)', () => {
    const h = rot.apply(env(), P, 0.5);
    const before = new Set(h.nodes.keys());
    rot.apply(env(), P, 0.5, h);
    expect(new Set(h.nodes.keys())).toEqual(before);
  });

  it('holds no detached references after apply, even with all nodes removed (13.1, 13.5)', () => {
    const h = rot.apply(env(), P, 0.5);
    document.body.innerHTML = '';
    rot.apply(env(), P, 0.5, h);
    expect(h.nodes.size).toBe(0);
    for (const n of h.nodes.keys()) expect(n.isConnected).toBe(true);
  });

  it('prunes even when body is absent and returns the live handle (13.6)', () => {
    const h = rot.apply(env(), P, 0.5);
    const a = textOf('a');
    const fakeDoc = { body: null, createTreeWalker: () => { throw new Error('must not walk'); } };
    document.getElementById('a').remove();
    const out = rot.apply({ ...env(), document: fakeDoc }, P, 0.5, h);
    expect(out).toBe(h);
    expect(h.nodes.has(a)).toBe(false);
  });
});

describe('undo', () => {
  it('after removal does not throw and restores connected nodes (13.1, 6.12)', () => {
    const h = rot.apply(env(), P, 1);
    const removed = document.getElementById('a');
    removed.remove();
    expect(textOf('b').data).toMatch(/#/);
    expect(() => rot.undo(h)).not.toThrow();
    expect(textOf('b').data).toBe('gamma delta');
    expect(textOf('c').data).toBe('epsilon zeta');
    expect(h.nodes.size).toBe(0);
  });

  it('restores a node only when its data still equals the rotted output (6.12)', () => {
    const h = rot.apply(env(), P, 1);
    const b = textOf('b');
    b.data = 'page rewrote this';
    rot.undo(h);
    expect(b.data).toBe('page rewrote this');
    expect(textOf('a').data).toBe('alpha beta');
    expect(textOf('c').data).toBe('epsilon zeta');
  });
});

describe('page rewrite adoption (6.11)', () => {
  it('treats rewritten text as the new original', () => {
    const h = rot.apply(env(), P, 1);
    const a = textOf('a');
    a.data = 'fresh words';
    rot.apply(env(), P, 1, h);
    expect(h.nodes.get(a).orig).toBe('fresh words');
    expect(a.data).not.toBe('fresh words');
    rot.undo(h);
    expect(a.data).toBe('fresh words');
  });
});
