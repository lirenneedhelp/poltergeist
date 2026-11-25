// @vitest-environment jsdom
// Ritual_Effect (Candle Path) unit tests: Requirements 5.2-5.10, 6.1-6.14, 7.1-7.9, 8.1-8.7, 9.8.
// jsdom cannot make trusted events, so the trusted path calls handle.on.<name>({ isTrusted: true, ... })
// (design decision 5) and the rejection path dispatches real, untrusted DOM events.
// Boards are made deterministic by seeding Math.random (the ritual's generateBoard call passes no
// `random`) with a fixed seed while `apply` creates the handle. Every "for any" is a fixed list.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as ritual from '../effects/ritual.js';
import { builtinEffects } from '../effects/index.js';
import { installAnimateSpy, makeEnv } from './polish-helpers.js';

const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../effects/ritual.js'), 'utf8');
const PAGE = '<head><title>t</title></head><body><h1>Headline text</h1><p>Some paragraph of text here.</p></body>';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let created;
let actions;
let spy;

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = PAGE;
  document.documentElement.removeAttribute('style');
  created = [];
  actions = [];
  spy = installAnimateSpy();
});
afterEach(() => {
  for (const h of created) ritual.undo(h, { durationMs: 0 });
  spy.restore();
  delete window.AudioContext;
  delete window.webkitAudioContext;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Create a ritual handle with a seeded board. Every created handle is undone in afterEach. */
function make(opts = {}) {
  const { params = {}, seed = 1, reduced = false, env: over = {} } = opts;
  // an explicit `intensity: undefined` is passed through, not replaced by the default 1
  const intensity = Object.prototype.hasOwnProperty.call(opts, 'intensity') ? opts.intensity : 1;
  const env = makeEnv({ reducedMotion: reduced, onAction: (name) => actions.push(name), ...over });
  const rnd = vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
  let h;
  try {
    h = ritual.apply(env, params, intensity);
  } finally {
    rnd.mockRestore();
  }
  created.push(h);
  return h;
}

// ---- input helpers (trusted-shaped objects through handle.on.*) ----

const T = (extra = {}) => ({ isTrusted: true, ...extra });
const DIRS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const same = (a, b) => a.row === b.row && a.col === b.col;
const end = (h) => h.path[h.path.length - 1];
const cellEl = (h, c) => h.els.cells[c.row][c.col];
const keyTo = (from, to) =>
  Object.keys(DIRS).find((k) => from.row + DIRS[k][0] === to.row && from.col + DIRS[k][1] === to.col);

function press(h, key) {
  const ev = T({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  h.on.keydown(ev);
  return ev;
}
const stepKey = (h, to) => press(h, keyTo(end(h), to));
const hint = (h) => h.on.hint(T());
const reset = (h) => h.on.reset(T());
const dragStart = (h, cell = end(h), extra = {}) =>
  h.on.pointerdown(T({ button: 0, isPrimary: true, pointerId: 1, target: cellEl(h, cell), ...extra }));
const dragOver = (h, c, pointerId = 1) => h.on.pointerover(T({ pointerId, target: cellEl(h, c) }));
const dragEnd = (h) => h.on.pointerup(T({ pointerId: 1 }));

const view = (h) => ({
  path: h.path.map((c) => ({ ...c })),
  lit: h.lit,
  status: h.els.status.textContent,
  veil: h.els.veil.style.opacity,
});

// ---- independent oracle for the move rule ----

const candleAt = (board, c) => {
  const found = board.candles.find((k) => same(k.cell, c));
  return found ? found.number : 0;
};
const litOf = (board, path) => path.filter((c) => candleAt(board, c)).length;
const inGrid = (board, c) => c.row >= 0 && c.row < board.size && c.col >= 0 && c.col < board.size;
const dist = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
const veilFor = (n, lit) => +((0.85 * (n - lit)) / (n - 1)).toFixed(3);

/** 'retract', 'extend' or null (rejected), from the rule text of Requirements 6.2 to 6.7 and 7.1. */
function oracle(board, path, complete, c) {
  if (complete) return null;
  if (path.length >= 2 && same(c, path[path.length - 2])) return 'retract';
  const lit = litOf(board, path);
  if (lit >= board.candles.length) return null;
  if (!inGrid(board, c) || dist(c, path[path.length - 1]) !== 1) return null;
  if (path.some((p) => same(p, c))) return null;
  const k = candleAt(board, c);
  if (k && k !== lit + 1) return null;
  return 'extend';
}

/** A monotone path from candle 1 to candle N (rows first, then columns), excluding the start. */
function lPath(board) {
  const from = board.candles[0].cell;
  const to = board.candles[board.candles.length - 1].cell;
  const out = [];
  let { row, col } = from;
  while (row !== to.row) {
    row += Math.sign(to.row - row);
    out.push({ row, col });
  }
  while (col !== to.col) {
    col += Math.sign(to.col - col);
    out.push({ row, col });
  }
  return out;
}
const litEarly = (h) => {
  for (const c of lPath(h.board)) stepKey(h, c);
};
const hints = (n) => (h) => {
  for (let k = 0; k < n; k += 1) hint(h);
};
const toCompletion = (h) => {
  while (!h.complete) hint(h);
};

/** Fixed list of every Cell of a board. */
const allCells = (board) => {
  const out = [];
  for (let row = 0; row < board.size; row += 1) for (let col = 0; col < board.size; col += 1) out.push({ row, col });
  return out;
};

/** Fixed target list for a state (Property 5). */
function targets(h) {
  const { board, path } = h;
  const e = end(h);
  const onPath = (c) => path.some((p) => same(p, c));
  const out = [];
  for (const [key, [dr, dc]] of Object.entries(DIRS)) {
    const cell = { row: e.row + dr, col: e.col + dc };
    out.push({ label: `neighbour ${key}${inGrid(board, cell) ? '' : ' (outside grid)'}`, cell, key });
  }
  const far = allCells(board).find((c) => dist(c, e) >= 2 && !onPath(c));
  if (far) out.push({ label: 'non-adjacent cell', cell: far });
  if (path.length >= 3) out.push({ label: 'cell on the path', cell: path[path.length - 3] });
  if (path.length >= 2) out.push({ label: 'previous cell', cell: path[path.length - 2], key: keyTo(e, path[path.length - 2]) });
  const lit = litOf(board, path);
  const wrong = board.candles
    .filter((k) => k.number !== lit + 1 && !onPath(k.cell))
    .sort((a, b) => dist(a.cell, e) - dist(b.cell, e))[0];
  if (wrong) out.push({ label: `wrong candle ${wrong.number}`, cell: wrong.cell, key: keyTo(e, wrong.cell) });
  return out;
}

const SCRIPTS = [
  { name: 'start (5x5, 5 candles)', params: { size: 5, candles: 5 }, seed: 1, run: () => {} },
  { name: 'mid-path (5x5, 5 candles)', params: { size: 5, candles: 5 }, seed: 1, run: hints(6) },
  { name: 'complete (5x5, 5 candles)', params: { size: 5, candles: 5 }, seed: 1, run: toCompletion },
  { name: 'start (3x3, 9 candles)', params: { size: 3, candles: 9 }, seed: 2, run: () => {} },
  { name: 'mid-path (3x3, 9 candles)', params: { size: 3, candles: 9 }, seed: 2, run: hints(3) },
  { name: 'candle N lit early (5x5, 2 candles)', params: { size: 5, candles: 2 }, seed: 3, run: litEarly },
];
const replay = (s) => {
  const h = make({ params: s.params, seed: s.seed });
  s.run(h);
  return h;
};

// ---------------------------------------------------------------------------

describe('overlay DOM (5.2, 5.3, 5.4, 5.9, 5.10)', () => {
  it('is registered as ritual and exports apply, undo and a description', () => {
    expect(builtinEffects.ritual).toBe(ritual);
    expect(typeof ritual.apply).toBe('function');
    expect(typeof ritual.undo).toBe('function');
    expect(typeof ritual.description).toBe('string');
  });

  it('appends one light-DOM-free host with an open shadow root as the last child of <html>', () => {
    const head = document.head.innerHTML;
    const body = document.body.innerHTML;
    const h = make();
    const hosts = document.querySelectorAll('div[data-poltergeist="ritual"]');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toBe(h.host);
    expect(document.documentElement.lastElementChild).toBe(h.host);
    expect(h.host.childNodes).toHaveLength(0);
    expect(h.host.shadowRoot).toBe(h.root);
    expect(h.root.mode).toBe('open');
    const s = h.host.style;
    expect(s.position).toBe('fixed');
    for (const side of ['top', 'right', 'bottom', 'left']) expect(['0', '0px']).toContain(s[side]);
    expect(s.zIndex).toBe('2147483647');
    for (const part of ['veil', 'board', 'reset', 'hint', 'ghost', 'status']) {
      expect(h.root.contains(h.els[part])).toBe(true);
      expect(document.contains(h.els[part])).toBe(false); // not in the light DOM
    }
    expect(document.head.innerHTML).toBe(head);
    expect(document.body.innerHTML).toBe(body);
  });

  it('shows heading, instructions, the size x size grid with candle numbers, Reset, Hint and a polite status', () => {
    const h = make({ params: { size: 6, candles: 7 } });
    expect(h.els.heading.textContent).toBe('Light the candles to banish the ghost');
    expect(h.els.instructions.textContent).toBe('Draw one path through every square, passing the candles in order.');
    const rows = h.els.board.querySelectorAll('[role="row"]');
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row.querySelectorAll('[role="gridcell"]')).toHaveLength(6);
    for (const k of h.board.candles) expect(cellEl(h, k.cell).textContent).toBe(String(k.number));
    const buttons = [...h.root.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Reset', 'Hint']);
    expect(h.els.status.getAttribute('aria-live')).toBe('polite');
    expect(h.els.status.textContent).toBe('1 of 7 candles lit');
    expect(h.els.polyline.getAttribute('points')).toBe(`${end(h).col + 0.5},${end(h).row + 0.5}`);
  });

  it('keeps every background colour at or below 64 per channel', () => {
    const h = make();
    toCompletion(h);
    const parse = (str) => {
      const s = str.trim().toLowerCase();
      let m = s.match(/^#([0-9a-f]{3})$/);
      if (m) return [...m[1]].map((x) => parseInt(x + x, 16));
      m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
      if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
      m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
      if (m) return [m[1], m[2], m[3]].map(Number);
      return null;
    };
    const colours = [];
    const re = /background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi;
    for (const text of [h.els.style.textContent, h.host.getAttribute('style') || '']) {
      for (const m of text.matchAll(re)) colours.push(m[1]);
    }
    for (const node of [h.host, ...h.root.querySelectorAll('*')]) {
      if (node.style && node.style.backgroundColor) colours.push(node.style.backgroundColor);
    }
    expect(colours.length).toBeGreaterThan(5);
    for (const c of colours) {
      const rgb = parse(c);
      expect(rgb, c).not.toBeNull();
      for (const channel of rgb) expect(channel, c).toBeLessThanOrEqual(64);
    }
  });

  it('contains no "zip" in any text, attribute value or class name', () => {
    const h = make();
    toCompletion(h);
    const strings = [h.root.textContent];
    for (const node of [h.host, ...h.root.querySelectorAll('*')]) {
      for (const attr of node.attributes) strings.push(attr.name, attr.value);
    }
    for (const s of strings) expect(s).not.toMatch(/zip/i);
  });
});

describe('source scan of ritual.js (5.10, 7.7, 8.4)', () => {
  // Comment lines and trailing " // ..." comments are stripped; the file's comments name the
  // forbidden APIs in order to say they are not used.
  const code = SRC.split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map((line) => line.replace(/\s\/\/\s.*$/, ''))
    .join('\n');

  it.each([
    ['innerHTML', /innerHTML/],
    ['other HTML parsing', /outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment|document\.write/],
    ['url(', /url\(/i],
    ['@import or @font-face', /@import|@font-face/i],
    ['chrome.', /\bchrome\./],
    ['window.close', /(?:window|self|globalThis|top|parent)\.close\b/],
    ['location', /location/],
    ['beforeunload or unload', /\bunload\b|beforeunload/],
    ['audio files', /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)\b/i],
    ['src or href', /\.src\b|['"]src['"]|href/],
    ['network or script loading', /\bfetch\s*\(|XMLHttpRequest|new Audio\b|import\s*\(/],
  ])('has no %s', (_label, re) => {
    expect(code).not.toMatch(re);
  });

  it('closes only the audio context it created', () => {
    // Every .close() call in the code is on an AudioContext (ctx or audio.ctx).
    const closes = [...code.matchAll(/([\w.]+)\.close\(/g)].map((m) => m[1]);
    expect(closes.length).toBeGreaterThan(0);
    for (const target of closes) expect(['ctx', 'audio.ctx']).toContain(target);
  });
});

// Haunt Kit invariant 4: apply is stable on a live handle and follows the opacity rule
describe('apply: opacity, pointer-events and params (5.2, 5.5, 5.6, 5.7, 6.10)', () => {
  const INTENSITIES = [-1, 0, 0.25, 0.5, 0.999, 1, 2, NaN, 'x', undefined];
  const PAIRS = [
    [undefined, undefined],
    [0.5, 0.5],
    [1, 0],
    [0, 1],
    [0.8, 0.25],
    [-0.1, 1.5],
    ['0.5', null],
    [1.5, -0.1],
    [null, '0.5'],
    [NaN, Infinity],
  ];
  const valid = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : d);

  it('sets opacity to round3(maxOpacity x i) and pointer-events to auto exactly when i >= blockAt', () => {
    for (const [maxOpacity, blockAt] of PAIRS) {
      for (const intensity of INTENSITIES) {
        const params = {};
        if (maxOpacity !== undefined) params.maxOpacity = maxOpacity;
        if (blockAt !== undefined) params.blockAt = blockAt;
        const i = typeof intensity === 'number' && !Number.isNaN(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
        const m = valid(maxOpacity, 0.96);
        const b = valid(blockAt, 1);
        const label = `maxOpacity=${maxOpacity} blockAt=${blockAt} intensity=${intensity}`;
        let h;
        expect(() => {
          h = make({ params, intensity });
        }, label).not.toThrow();
        expect(Number(h.host.style.opacity), label).toBe(+(m * i).toFixed(3));
        expect(h.host.style.pointerEvents, label).toBe(i >= b ? 'auto' : 'none');
        ritual.undo(h, { durationMs: 0 });
      }
    }
  });

  it('a live handle keeps host, Board and Player_Path and updates only opacity, pointer-events and texts', () => {
    const h = make({ params: { size: 3, candles: 2 }, intensity: 0.2 });
    hints(3)(h);
    const host = h.host;
    const board = h.board;
    const boardCopy = structuredClone(board);
    const path = structuredClone(h.path);
    const cellsBefore = h.root.querySelectorAll('[role="gridcell"]').length;
    const again = ritual.apply(h.env, { size: 6, candles: 7, heading: 'New heading', instructions: 'New text', maxOpacity: 0.5 }, 1, h);
    expect(again).toBe(h);
    expect(h.host).toBe(host);
    expect(h.board).toBe(board);
    expect(h.board).toEqual(boardCopy);
    expect(h.path).toEqual(path);
    expect(h.root.querySelectorAll('[role="gridcell"]')).toHaveLength(cellsBefore);
    expect(document.querySelectorAll('div[data-poltergeist="ritual"]')).toHaveLength(1);
    expect(h.host.style.opacity).toBe('0.5');
    expect(h.host.style.pointerEvents).toBe('auto');
    expect(h.els.heading.textContent).toBe('New heading');
    expect(h.els.instructions.textContent).toBe('New text');
  });

  it('focuses the Board the first time pointer-events becomes auto, and never again', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const h = make({ intensity: 0.5 });
    expect(document.activeElement).toBe(outside);
    ritual.apply(h.env, {}, 1, h);
    expect(h.root.activeElement).toBe(h.els.board);
    outside.focus();
    ritual.apply(h.env, {}, 0.5, h);
    ritual.apply(h.env, {}, 1, h);
    expect(document.activeElement).toBe(outside);
    ritual.undo(h, { durationMs: 0 });
    outside.remove();
  });

  it('uses the default for each invalid heading, instructions, size, candles and sound value', () => {
    const cases = [
      ['heading', ['', 'x'.repeat(201), 42, null, ['a']]],
      ['instructions', ['', 'y'.repeat(301), {}, false]],
      ['size', [2, 8, 4.5, '5', NaN, null]],
      ['candles', [1, 10, 26, '3', 2.5, null]],
      ['sound', ['true', 1, null, {}]],
    ];
    for (const [name, values] of cases) {
      for (const value of values) {
        const params = { [name]: value };
        const before = structuredClone(params);
        let h;
        expect(() => {
          h = make({ params });
        }, `${name}=${String(value)}`).not.toThrow();
        expect(params).toEqual(before);
        expect(h.els.heading.textContent).toBe('Light the candles to banish the ghost');
        expect(h.els.instructions.textContent).toBe('Draw one path through every square, passing the candles in order.');
        expect(h.board.size).toBe(5);
        expect(h.board.candles).toHaveLength(5);
        expect(h.sound).toBe(false);
        ritual.undo(h, { durationMs: 0 });
      }
    }
    // candles is checked against the resolved size: 9 is valid at size 3, 10 is not
    expect(make({ params: { size: 3, candles: 9 } }).board.candles).toHaveLength(9);
    expect(make({ params: { size: 3, candles: 10 } }).board.candles).toHaveLength(5);
    // the upper text limits are accepted
    const long = make({ params: { heading: 'h'.repeat(200), instructions: 'i'.repeat(300) } });
    expect(long.els.heading.textContent).toBe('h'.repeat(200));
    expect(long.els.instructions.textContent).toBe('i'.repeat(300));
  });

  it('treats a params value that is not a plain object as {}', () => {
    for (const params of [null, [], 'size', 7]) {
      const h = make({ params });
      expect(h.board.size).toBe(5);
      expect(Number(h.host.style.opacity)).toBe(0.96);
      ritual.undo(h, { durationMs: 0 });
    }
  });
});

// Haunt Kit invariant 5: The move rule accepts exactly the legal moves
describe('move rule (6.2, 6.4 to 6.9, 7.1)', () => {
  it('the candle-N-lit-early script reaches candle N before the path is full', () => {
    const h = replay(SCRIPTS[5]);
    expect(h.lit).toBe(2);
    expect(h.complete).toBe(false);
    expect(h.path.length).toBeLessThan(25);
  });

  it.each(SCRIPTS.map((s) => [s.name, s]))('%s: keyboard and drag accept exactly the legal targets', (_name, s) => {
    const probe = replay(s);
    for (const t of targets(probe)) {
      const expected = oracle(probe.board, probe.path, probe.complete, t.cell);
      const before = view(probe);
      const after =
        expected === 'retract'
          ? before.path.slice(0, -1)
          : expected === 'extend'
            ? [...before.path, { ...t.cell }]
            : before.path;
      const results = [];
      if (inGrid(probe.board, t.cell)) {
        const hd = replay(s);
        dragStart(hd);
        expect(hd.drag, t.label).not.toBeNull();
        expect(() => dragOver(hd, t.cell)).not.toThrow();
        results.push(['drag', hd]);
      }
      if (t.key) {
        const hk = replay(s);
        let ev;
        expect(() => {
          ev = press(hk, t.key);
        }).not.toThrow();
        expect(ev.preventDefault, `${t.label} keyboard`).toHaveBeenCalledTimes(1);
        results.push(['keyboard', hk]);
      }
      for (const [via, h] of results) {
        const label = `${s.name} / ${t.label} / ${via}`;
        expect(h.path, label).toEqual(after);
        if (!expected) expect(view(h), label).toEqual(before);
        else expect(h.lit, label).toBe(litOf(h.board, after));
      }
      if (results.length === 2) expect(results[0][1].path).toEqual(results[1][1].path);
    }
  });

  it('retract is impossible from the single-cell path, and keys outside the grid are rejected', () => {
    const h = make();
    const before = view(h);
    for (const key of Object.keys(DIRS)) {
      press(h, key);
      if (h.path.length > 1) press(h, keyTo(end(h), h.path[0])); // go back after an accepted move
      expect(view(h)).toEqual(before);
    }
  });

  it('calls preventDefault on every arrow key, accepted or not, and on no other key', () => {
    const h = make();
    for (const key of [' ', 'Enter', 'Tab', 'a', 'Escape', 'Home']) {
      const before = view(h);
      const ev = press(h, key);
      expect(ev.preventDefault, key).not.toHaveBeenCalled();
      expect(view(h)).toEqual(before);
    }
  });

  it('drag starts only with the primary button on the Path_End and ends on release or cancel', () => {
    const h = make({ params: { size: 5, candles: 5 } });
    const sol = h.board.solution;
    dragStart(h, sol[3]); // not the Path_End
    expect(h.drag).toBeNull();
    dragStart(h, sol[0], { button: 2 });
    expect(h.drag).toBeNull();
    dragStart(h, sol[0], { isPrimary: false });
    expect(h.drag).toBeNull();
    dragOver(h, sol[1]);
    expect(h.path).toHaveLength(1);

    dragStart(h);
    expect(h.drag).not.toBeNull();
    dragOver(h, sol[1], 2); // another pointer
    expect(h.path).toHaveLength(1);
    dragOver(h, sol[1]);
    dragOver(h, sol[2]);
    expect(h.path).toEqual(sol.slice(0, 3));
    dragEnd(h); // the window-level release, also used for pointercancel
    expect(h.drag).toBeNull();
    dragOver(h, sol[3]);
    expect(h.path).toEqual(sol.slice(0, 3));
  });
});

// Haunt Kit invariant 6: The rendered Board always matches the Player_Path
describe('render follows the Player_Path (5.4, 5.8, 6.1, 6.3)', () => {
  function checkRender(h, label) {
    const { board, path } = h;
    const n = board.candles.length;
    const lit = litOf(board, path);
    expect(h.lit, label).toBe(lit);
    for (const k of board.candles) {
      const on = path.some((c) => same(c, k.cell));
      const el = cellEl(h, k.cell);
      expect(el.getAttribute('data-lit'), label).toBe(on ? 'true' : 'false');
      expect(el.getAttribute('aria-label'), label).toBe(`Candle ${k.number}, ${on ? 'lit' : 'unlit'}`);
    }
    for (const c of allCells(board)) {
      const on = path.some((p) => same(p, c));
      expect(cellEl(h, c).getAttribute('data-on-path'), label).toBe(on ? 'true' : null);
    }
    expect(h.els.status.textContent, label).toBe(`${lit} of ${n} candles lit`);
    expect(Number(h.els.veil.style.opacity), label).toBe(veilFor(n, lit));
  }

  it.each([
    [2, { size: 5, candles: 2 }],
    [5, { size: 5, candles: 5 }],
    [9, { size: 3, candles: 9 }],
  ])('N = %i', (n, params) => {
    const h = make({ params, seed: 7 });
    const sol = h.board.solution;
    expect(h.board.candles).toHaveLength(n);
    expect(h.path).toEqual([h.board.candles[0].cell]);
    expect(h.els.status.textContent).toBe(`1 of ${n} candles lit`);
    expect(h.els.veil.style.opacity).toBe('0.85');
    checkRender(h, 'creation');
    for (let k = 1; k <= 4; k += 1) {
      stepKey(h, sol[k]);
      checkRender(h, `move ${k}`);
    }
    stepKey(h, sol[3]);
    checkRender(h, 'retract');
    reset(h);
    checkRender(h, 'reset');
    for (let k = 1; k <= 3; k += 1) {
      hint(h);
      checkRender(h, `hint ${k}`);
    }
    for (let k = h.path.length; k < sol.length; k += 1) {
      stepKey(h, sol[k]);
      checkRender(h, `move to ${k}`);
    }
    expect(h.complete).toBe(true);
    expect(h.els.status.textContent).toBe(`${n} of ${n} candles lit`);
    expect(h.els.veil.style.opacity).toBe('0');
  });
});

// Haunt Kit invariant 7: Reset and Hint keep the Board and move along the solution
describe('Reset and Hint (6.11, 6.12)', () => {
  /** A legal first move that leaves the solution, on the first seed that has one. */
  function diverged(prefixHints) {
    for (const seed of [1, 2, 3, 7, 42, 99, 1234, 2024, 31337, 65535]) {
      const h = make({ seed });
      hints(prefixHints)(h);
      const next = h.board.solution[h.path.length];
      const alt = Object.keys(DIRS)
        .map((k) => ({ key: k, cell: { row: end(h).row + DIRS[k][0], col: end(h).col + DIRS[k][1] } }))
        .find((t) => !same(t.cell, next) && oracle(h.board, h.path, false, t.cell) === 'extend');
      if (alt) {
        press(h, alt.key);
        return h;
      }
      ritual.undo(h, { durationMs: 0 });
    }
    throw new Error('no seed gives a diverging move');
  }

  it('Reset returns to the candle 1 cell on the same, unchanged Board', () => {
    for (const h of [diverged(0), diverged(5), make({ seed: 42 })]) {
      hints(2)(h);
      const board = h.board;
      const copy = structuredClone(board);
      reset(h);
      expect(h.board).toBe(board);
      expect(h.board).toEqual(copy);
      expect(h.path).toEqual([board.candles[0].cell]);
      expect(h.lit).toBe(1);
    }
  });

  it('Hint replaces the path with the matching solution prefix plus one cell', () => {
    for (const prefix of [0, 5]) {
      const h = diverged(prefix);
      expect(h.path).toHaveLength(prefix + 2);
      expect(same(end(h), h.board.solution[prefix + 1])).toBe(false);
      hint(h);
      expect(h.path).toEqual(h.board.solution.slice(0, prefix + 2));
    }
  });

  it.each([3, 5, 7])('repeated Hint from the start completes after exactly size^2 - 1 activations (size %i)', (size) => {
    const h = make({ params: { size }, seed: size });
    const total = size * size;
    for (let k = 1; k < total; k += 1) {
      expect(h.complete).toBe(false);
      hint(h);
      expect(h.path).toEqual(h.board.solution.slice(0, k + 1));
    }
    expect(h.complete).toBe(true);
    const before = view(h);
    hint(h);
    reset(h);
    expect(view(h)).toEqual(before);
  });
});

// Haunt Kit invariant 8: The Exorcised_Action happens at most once and never after undo
describe('completion and the Exorcised_Action (7.1 to 7.6, 7.9)', () => {
  const ROUTES = {
    keyboard: (h) => {
      for (let k = h.path.length; k < h.board.solution.length; k += 1) stepKey(h, h.board.solution[k]);
    },
    drag: (h) => {
      dragStart(h);
      for (let k = h.path.length; k < h.board.solution.length; k += 1) dragOver(h, h.board.solution[k]);
    },
    hint: toCompletion,
  };
  const CASES = [];
  for (const route of Object.keys(ROUTES)) for (const reduced of [false, true]) CASES.push([route, reduced]);

  it.each(CASES)('route %s, reducedMotion=%s: exactly one exorcised at the right time', (route, reduced) => {
    const h = make({ reduced });
    ROUTES[route](h);
    expect(h.complete).toBe(true);
    expect(h.els.status.textContent).toBe('5 of 5 candles lit');
    if (reduced) {
      expect(actions).toEqual(['exorcised']); // before the completing handler returned
    } else {
      expect(actions).toEqual([]);
      vi.advanceTimersByTime(1199);
      expect(actions).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(actions).toEqual(['exorcised']);
    }
    // re-apply and further trusted input add nothing and change nothing
    const before = view(h);
    ritual.apply(h.env, {}, 1, h);
    hint(h);
    reset(h);
    for (const key of Object.keys(DIRS)) press(h, key);
    dragStart(h);
    dragOver(h, h.board.solution[h.board.solution.length - 2]);
    vi.advanceTimersByTime(5000);
    expect(actions).toEqual(['exorcised']);
    expect(view(h)).toEqual(before);
    expect(document.contains(h.host)).toBe(true);
  });

  const UNDO_CASES = [];
  for (const at of [0, 600, 1199]) for (const durationMs of [0, 300]) UNDO_CASES.push([at, durationMs]);
  it.each(UNDO_CASES)('undo %i ms after completion (durationMs %i) makes no Exorcised_Action', (at, durationMs) => {
    const h = make();
    toCompletion(h);
    vi.advanceTimersByTime(at);
    ritual.undo(h, { durationMs });
    vi.advanceTimersByTime(2000);
    expect(actions).toEqual([]);
    expect(document.querySelectorAll('div[data-poltergeist="ritual"]')).toHaveLength(0);
  });

  it.each([false, true])('a completing input while fading is ignored (reducedMotion=%s)', (reduced) => {
    for (const finishVia of ['hint', 'keyboard']) {
      const h = make({ reduced });
      hints(23)(h);
      ritual.undo(h, { durationMs: 300 });
      if (finishVia === 'hint') hint(h);
      else stepKey(h, h.board.solution[24]);
      expect(h.complete).toBe(false);
      expect(h.path).toHaveLength(24);
      vi.advanceTimersByTime(2000);
      expect(actions).toEqual([]);
    }
  });

  it.each([
    ['missing', { onAction: undefined }],
    ['throwing', { onAction: () => { throw new Error('boom'); } }],
  ])('a %s env.onAction is logged with [poltergeist] and the completed Board stays shown', (_label, over) => {
    for (const reduced of [true, false]) {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const h = make({ reduced, env: over });
      expect(() => toCompletion(h)).not.toThrow();
      expect(() => vi.advanceTimersByTime(1300)).not.toThrow();
      expect(error).toHaveBeenCalled();
      expect(String(error.mock.calls[0][0]).startsWith('[poltergeist]')).toBe(true);
      expect(document.contains(h.host)).toBe(true);
      expect(h.els.status.textContent).toBe('5 of 5 candles lit');
      error.mockRestore();
    }
  });

  it('plays the Banishing_Ending on the ghost over 1200 ms when motion is allowed', () => {
    const h = make();
    toCompletion(h);
    const calls = spy.on(h.els.ghost);
    expect(calls).toHaveLength(1);
    expect(calls[0].options.duration).toBe(1200);
    expect(calls[0].keyframes[0].opacity).toBe(1);
    expect(calls[0].keyframes[calls[0].keyframes.length - 1].opacity).toBe(0);
    expect(h.root.contains(h.els.ghost)).toBe(true);
  });
});

// Haunt Kit invariant 9: Untrusted and post-undo input changes nothing
describe('untrusted and post-undo input (6.13, 6.14, 9.8)', () => {
  const makeEvent = (type, init) => {
    const opts = { bubbles: true, cancelable: true, composed: true, ...init };
    if (type === 'keydown') return new KeyboardEvent(type, opts);
    if (type.startsWith('pointer')) {
      const Ctor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      return new Ctor(type, { button: 0, isPrimary: true, pointerId: 1, ...opts });
    }
    return new MouseEvent(type, opts);
  };
  const EVENTS = [
    ['pointerdown', {}],
    ['pointermove', {}],
    ['pointerover', {}],
    ...['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].map((key) => ['keydown', { key }]),
    ['click', {}],
  ];

  /** Near-complete: one trusted Hint or arrow would finish the ritual. */
  const nearComplete = () => {
    const h = make();
    hints(23)(h);
    return h;
  };

  it.each([false, true])('untrusted events on a Cell, the Board, Reset and Hint change nothing (drag active=%s)', (dragging) => {
    const h = nearComplete();
    if (dragging) dragStart(h);
    const drag = h.drag ? { ...h.drag } : null;
    const before = view(h);
    const focusDoc = document.activeElement;
    const focusRoot = h.root.activeElement;
    const next = h.board.solution[24];
    const targetsList = [cellEl(h, end(h)), cellEl(h, next), h.els.board, h.els.reset, h.els.hint];
    for (const target of targetsList) {
      for (const [type, init] of EVENTS) {
        const ev = makeEvent(type, init);
        expect(ev.isTrusted).toBe(false);
        target.dispatchEvent(ev);
        expect(ev.defaultPrevented, `${type} ${init.key ?? ''}`).toBe(false);
      }
    }
    expect(view(h)).toEqual(before);
    expect(h.drag).toEqual(drag);
    expect(h.complete).toBe(false);
    expect(document.activeElement).toBe(focusDoc);
    expect(h.root.activeElement).toBe(focusRoot);
    vi.advanceTimersByTime(2000);
    expect(actions).toEqual([]);
  });

  it.each(['fading', 'dead'])('trusted-shaped input to a %s handle changes nothing', (state) => {
    const h = nearComplete();
    ritual.undo(h, { durationMs: state === 'fading' ? 300 : 0 });
    const before = view(h);
    hint(h);
    reset(h);
    dragStart(h);
    expect(h.drag).toBeNull();
    for (const key of Object.keys(DIRS)) {
      const ev = press(h, key);
      expect(ev.preventDefault).not.toHaveBeenCalled();
    }
    expect(view(h)).toEqual(before);
    expect(h.complete).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(actions).toEqual([]);
  });
});

// Haunt Kit invariant 11: Reduced_Motion means no motion
describe('reduced motion (7.3, 7.8)', () => {
  it('a whole reduced-motion lifetime starts no animation, transition or repeating timer', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const raf = typeof window.requestAnimationFrame === 'function' ? vi.spyOn(window, 'requestAnimationFrame') : null;
    const h = make({ reduced: true });
    hints(5)(h);
    stepKey(h, h.board.solution[4]); // retract
    reset(h);
    ROUTE_KEYS(h);
    expect(h.complete).toBe(true);
    expect(actions).toEqual(['exorcised']);
    const nodes = [h.host, ...h.root.querySelectorAll('*')];
    const css = h.els.style.textContent;
    ritual.undo(h, { durationMs: 300 });
    for (const node of nodes) {
      expect(node.style.animation || '').toBe('');
      expect(node.style.transition || '').toBe('');
      expect(['none', '']).toContain(getComputedStyle(node).animationName || '');
    }
    expect(h.host.style.opacity).toBe('0');
    expect(css).not.toMatch(/@keyframes|\banimation\b|\btransition\b/i);
    expect(spy.fn).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    if (raf) expect(raf).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(document.contains(h.host)).toBe(false);
  });

  function ROUTE_KEYS(h) {
    for (let k = h.path.length; k < h.board.solution.length; k += 1) stepKey(h, h.board.solution[k]);
  }
});

// Haunt Kit invariant 12: At most one chime, and only when sound is exactly true
describe('sound (8.1 to 8.7)', () => {
  let contexts;
  let ctorCalls;
  function stubAudio({ throws = false } = {}) {
    contexts = [];
    ctorCalls = 0;
    window.AudioContext = function AudioContextStub() {
      ctorCalls += 1;
      if (throws) throw new Error('no audio');
      const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
      const ctx = {
        currentTime: 0,
        destination: {},
        oscillators: [],
        createOscillator: vi.fn(() => {
          const osc = { type: '', frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
          ctx.oscillators.push(osc);
          return osc;
        }),
        createGain: vi.fn(() => ({ gain: param(), connect: vi.fn() })),
        close: vi.fn(() => Promise.resolve()),
      };
      contexts.push(ctx);
      return ctx;
    };
  }
  const relight = (h) => {
    litEarly(h); // candle N lights
    const last = end(h);
    stepKey(h, h.path[h.path.length - 2]); // retract
    stepKey(h, last); // light again
  };

  it.each([
    ['true', true, 1],
    ['false', false, 0],
    ['absent', undefined, 0],
    ['"true"', 'true', 0],
    ['1', 1, 0],
  ])('sound %s: one context only for the boolean true', (_label, sound, expected) => {
    stubAudio();
    const params = { size: 5, candles: 2 };
    if (sound !== undefined) params.sound = sound;
    const h = make({ params, seed: 3 });
    expect(ctorCalls).toBe(0); // nothing before candle N lights
    relight(h);
    expect(h.lit).toBe(2);
    expect(ctorCalls).toBe(expected);
    if (expected) {
      const osc = contexts[0].oscillators[0];
      expect(osc.start).toHaveBeenCalledTimes(1);
      const [[startAt]] = osc.start.mock.calls;
      const [[stopAt]] = osc.stop.mock.calls;
      expect(stopAt - startAt).toBeGreaterThan(0);
      expect(stopAt - startAt).toBeLessThanOrEqual(1);
    }
  });

  it('completion with sound true makes one context and the Exorcised_Action, and undo closes it', () => {
    stubAudio();
    const h = make({ params: { sound: true } });
    toCompletion(h);
    vi.advanceTimersByTime(1200);
    expect(ctorCalls).toBe(1);
    expect(actions).toEqual(['exorcised']);
    const ctx = contexts[0];
    ritual.undo(h, { durationMs: 300 });
    expect(ctx.close).toHaveBeenCalledTimes(1); // before undo returned
    expect(ctx.oscillators[0].stop.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.advanceTimersByTime(300);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['throws', () => stubAudio({ throws: true })],
    ['is missing', () => {}],
  ])('when the AudioContext constructor %s, the error is logged and completion still fires', (_label, setup) => {
    setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const reduced of [true, false]) {
      const h = make({ params: { sound: true }, reduced });
      expect(() => toCompletion(h)).not.toThrow();
      vi.advanceTimersByTime(1200);
      expect(() => ritual.undo(h, { durationMs: 0 })).not.toThrow();
    }
    expect(actions).toEqual(['exorcised', 'exorcised']);
    expect(error).toHaveBeenCalled();
    for (const call of error.mock.calls) expect(String(call[0]).startsWith('[poltergeist]')).toBe(true);
  });
});
