// @vitest-environment jsdom
// Rot effect: detached-node pruning and conditional restore (Requirements 13.1-13.6, 6.11, 6.12).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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


// ---------------------------------------------------------------------------
// Observer work: roots, throttling, restoration (Requirements 4.1-4.20, 7.2).
// Property 4: Rot observer work is bounded and reversible.
// ---------------------------------------------------------------------------
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const tick = async (ms) => { await flush(); await vi.advanceTimersByTimeAsync(ms); };
const GLYPH = { maxFraction: 1, glyphs: '#' };
const rotted = (s) => s.replace(/\S/g, '#');

// Records every TreeWalker root and every node offered to the filter.
function instrument() {
  const roots = [];
  const visited = [];
  const orig = document.createTreeWalker.bind(document);
  const spy = vi.spyOn(document, 'createTreeWalker').mockImplementation((root, what, filter) => {
    roots.push(root);
    const wrapped = { acceptNode: (n) => { visited.push(n); return filter.acceptNode(n); } };
    return orig(root, what, wrapped);
  });
  return { roots, visited, spy, reset() { roots.length = 0; visited.length = 0; } };
}
const addP = (id, text, parent = document.body) => {
  const p = document.createElement('p');
  p.id = id;
  p.textContent = text;
  parent.appendChild(p);
  return p;
};

describe('observer-driven rot', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('explicit apply walks the whole body and supersedes pending observer work (4.1, 4.17)', async () => {
    const h = rot.apply(env(), GLYPH, 1);
    expect(textOf('a').data).toBe(rotted('alpha beta'));
    addP('n', 'fresh text');
    await flush();
    expect(h.observerTimer).not.toBeNull();
    const ins = instrument();
    rot.apply(env(), GLYPH, 1, h);
    expect(ins.roots).toEqual([document.body]);
    expect(h.observerTimer).toBeNull();
    expect(h.pendingRoots.size).toBe(0);
    expect(textOf('n').data).toBe(rotted('fresh text'));
    ins.reset();
    await tick(1000);
    expect(ins.roots).toEqual([]);
  });

  it('runs exactly one pass at 250 ms with the latest params (4.3, 4.6, 4.10, 4.11)', async () => {
    const h = rot.apply(env(), { maxFraction: 1, glyphs: '#' }, 1);
    rot.apply(env(), { maxFraction: 1, glyphs: '@' }, 1, h);
    const ins = instrument();
    const p = addP('n', 'fresh text');
    await flush();
    await vi.advanceTimersByTimeAsync(249);
    expect(ins.roots).toEqual([]);
    expect(p.firstChild.data).toBe('fresh text');
    await vi.advanceTimersByTimeAsync(1);
    expect(ins.roots).toEqual([p]);
    expect(p.firstChild.data).toBe('@@@@@ @@@@');
  });

  it('batches several deliveries into one pass over distinct roots (4.4, 4.6, 4.9)', async () => {
    rot.apply(env(), GLYPH, 1);
    const ins = instrument();
    const p1 = addP('n1', 'one one');
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    const p2 = addP('n2', 'two two');
    await flush();
    const inner = document.createElement('span');
    inner.textContent = 'inner text';
    p2.appendChild(inner); // descendant of an already-queued root
    await flush();
    await vi.advanceTimersByTimeAsync(149);
    expect(ins.roots).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ins.roots.sort((x, y) => x.id.localeCompare(y.id))).toEqual([p1, p2]);
    expect(inner.firstChild.data).toBe(rotted('inner text'));
    expect(p1.firstChild.data).toBe(rotted('one one'));
  });

  it('handles duplicate roots, removed roots, and detached pruning (4.4, 4.8, 4.9)', async () => {
    const h = rot.apply(env(), GLYPH, 1);
    const old = textOf('a');
    const gone = addP('gone', 'short lived');
    const kept = addP('kept', 'stays here');
    document.body.appendChild(kept); // move: duplicate added record for same root
    document.getElementById('b').remove(); // removal -> prune
    await flush();
    gone.remove(); // added then removed before processing
    await flush();
    const ins = instrument();
    await vi.advanceTimersByTimeAsync(250);
    expect(ins.roots).toEqual([kept]);
    expect(gone.firstChild.data).toBe('short lived');
    expect(h.nodes.size).toBe(2 + 1); // a, c, kept; b pruned
    expect(h.nodes.has(old)).toBe(true);
  });

  it('processes an added or replaced body (4.8)', async () => {
    const h = rot.apply(env(), GLYPH, 1);
    const nb = document.createElement('body');
    nb.innerHTML = '<p id="x">new body text</p>';
    document.documentElement.replaceChild(nb, document.body);
    await flush();
    const ins = instrument();
    await vi.advanceTimersByTimeAsync(250);
    expect(ins.roots).toEqual([nb]);
    expect(textOf('x').data).toBe(rotted('new body text'));
    expect(h.nodes.size).toBe(1); // old body nodes pruned
  });

  it('visits only the appended subtree, never the sentinel (4.8)', async () => {
    rot.apply(env(), GLYPH, 1);
    const sentinel = textOf('a');
    const ins = instrument();
    const p = addP('n', 'appended words');
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(ins.roots).toEqual([p]);
    expect(ins.roots).not.toContain(document.body);
    expect(ins.visited).not.toContain(sentinel);
    expect(ins.visited).toEqual([p.firstChild]);
  });

  it('adopts a changed text node directly without any traversal (4.5, 4.12)', async () => {
    const h = rot.apply(env(), GLYPH, 1);
    const a = textOf('a');
    const ins = instrument();
    a.data = 'page rewrite';
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(ins.roots).toEqual([]);
    expect(ins.visited).toEqual([]);
    expect(h.nodes.get(a).orig).toBe('page rewrite');
    expect(a.data).toBe(rotted('page rewrite'));
  });

  it('reuses one observer across applies (4.2, 4.15)', () => {
    const Real = window.MutationObserver;
    let count = 0;
    window.MutationObserver = class extends Real { constructor(cb) { super(cb); count++; } };
    try {
      const h = rot.apply(env(), GLYPH, 0.5);
      const first = h.observer;
      rot.apply(env(), GLYPH, 1, h);
      rot.apply(env(), GLYPH, 0.2, h);
      expect(h.observer).toBe(first);
      expect(count).toBe(1);
    } finally {
      window.MutationObserver = Real;
    }
  });

  it('settles Rot-owned mutations without a feedback loop (4.16)', async () => {
    const h = rot.apply(env(), GLYPH, 1);
    await tick(1000);
    expect(h.observerTimer).toBeNull();
    const p = addP('n', 'fresh text');
    await flush();
    await vi.advanceTimersByTimeAsync(250); // pass writes the text
    expect(p.firstChild.data).toBe(rotted('fresh text'));
    await flush();
    expect(h.observerTimer).toBeNull(); // own write ignored
    const ins = instrument();
    await vi.advanceTimersByTimeAsync(5000);
    expect(ins.roots).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('schedules at most one observer pass per 250 ms under continuous traffic (4.7)', async () => {
    const scheduled = [];
    const e = { ...env(), setTimeout: (fn, ms) => { scheduled.push(Date.now()); return setTimeout(fn, ms); } };
    const t0 = Date.now();
    rot.apply(e, GLYPH, 1);
    const texts = [];
    for (let t = 0; t < 1000; t += 50) {
      texts.push(addP('p' + t, 'traffic ' + t).firstChild);
      await tick(50);
    }
    await tick(250);
    // 20 appends over 1000 ms: one timer per 250 ms window, none sooner
    expect(scheduled.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < scheduled.length; i++) expect(scheduled[i] - scheduled[i - 1]).toBeGreaterThanOrEqual(250);
    expect(scheduled[0] - t0).toBeLessThan(250);
    for (const n of texts) expect(n.data).toMatch(/^#+ #+$/);
  });
  it('preserves skip rules for observer passes (4.13)', async () => {
    rot.apply(env(), GLYPH, 1);
    const wrap = document.createElement('div');
    wrap.innerHTML = '<script>var x = 1;</script><style>b{}</style><code>code text</code><textarea>ta text</textarea><div contenteditable="true">edit me</div>   <i>ok text</i>';
    document.body.appendChild(wrap);
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(wrap.querySelector('script').textContent).toBe('var x = 1;');
    expect(wrap.querySelector('code').textContent).toBe('code text');
    expect(wrap.querySelector('textarea').textContent).toBe('ta text');
    expect(wrap.querySelector('i').textContent).toBe(rotted('ok text'));
  });
});

describe('undo restores and cancels observer work', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('cancels timer, restores initial and appended text exactly, and stays inert (4.18, 4.19)', async () => {
    const h = rot.apply(env(), GLYPH, 1);
    const p = addP('n', 'appended text');
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(p.firstChild.data).toBe(rotted('appended text'));
    const q = addP('q', 'pending text');
    await flush();
    expect(h.observerTimer).not.toBeNull();
    const disconnect = vi.spyOn(h.observer, 'disconnect');
    const ins = instrument();
    rot.undo(h);
    expect(disconnect).toHaveBeenCalled();
    expect(h.observerTimer).toBeNull();
    expect(h.pendingRoots.size).toBe(0);
    expect(h.nodes.size).toBe(0);
    expect(textOf('a').data).toBe('alpha beta');
    expect(textOf('b').data).toBe('gamma delta');
    expect(textOf('c').data).toBe('epsilon zeta');
    expect(p.firstChild.data).toBe('appended text');
    expect(vi.getTimerCount()).toBe(0);
    // untouched afterwards
    const late = addP('late', 'late text');
    textOf('a').data = 'rewritten';
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(late.firstChild.data).toBe('late text');
    expect(q.firstChild.data).toBe('pending text');
    expect(textOf('a').data).toBe('rewritten');
    expect(ins.roots).toEqual([]);
    expect(() => rot.undo(h)).not.toThrow();
    expect(textOf('b').data).toBe('gamma delta');
  });

  it('preserves later page rewrites on undo (4.18)', async () => {
    const h = rot.apply(env(), GLYPH, 1);
    const p = addP('n', 'appended text');
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    p.firstChild.data = 'page says hi';
    rot.undo(h);
    expect(p.firstChild.data).toBe('page says hi');
    expect(textOf('a').data).toBe('alpha beta');
  });

  it('a queued observer callback after undo is a no-op (4.19)', async () => {
    const h = rot.apply(env(), GLYPH, 1);
    const p = addP('n', 'appended text');
    // records are queued but not yet delivered; undo disconnects
    rot.undo(h);
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.firstChild.data).toBe('appended text');
    expect(h.nodes.size).toBe(0);
  });
});

describe('observer fallbacks (4.20)', () => {
  it('works without MutationObserver', () => {
    const w = { document };
    const h = rot.apply({ ...env(), window: w }, GLYPH, 1);
    expect(h.observer).toBeNull();
    expect(textOf('a').data).toBe(rotted('alpha beta'));
    expect(() => rot.undo(h)).not.toThrow();
    expect(textOf('a').data).toBe('alpha beta');
  });

  it('works without documentElement', () => {
    const fakeDoc = { documentElement: null, body: document.body, createTreeWalker: (...a) => document.createTreeWalker(...a) };
    const h = rot.apply({ ...env(), document: fakeDoc }, GLYPH, 1);
    expect(h.observer).toBeNull();
    expect(textOf('b').data).toBe(rotted('gamma delta'));
    expect(() => rot.undo(h)).not.toThrow();
    expect(textOf('b').data).toBe('gamma delta');
  });

  it('keeps the exported effect contract', () => {
    expect(Object.keys(rot).sort()).toEqual(['apply', 'description', 'undo']);
  });
});
