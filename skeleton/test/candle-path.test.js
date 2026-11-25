import { describe, it, expect } from 'vitest';
import { generateBoard, checkPath } from '../ritual/candle-path.js';

// Small seeded PRNG so every run checks the same boards (no property-based library).
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

const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 2024, 31337, 65535];
const SIZES = [3, 4, 5, 6, 7];

const key = (c) => `${c.row},${c.col}`;
const adjacent = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

/** Asserts the full Board invariant for the expected resolved size and candle count. */
function expectValidBoard(board, size, candles) {
  expect(board.size).toBe(size);
  expect(board.candles).toHaveLength(candles);

  const { solution } = board;
  expect(solution).toHaveLength(size * size);
  const seen = new Set();
  solution.forEach((cell, k) => {
    expect(Number.isInteger(cell.row) && cell.row >= 0 && cell.row < size).toBe(true);
    expect(Number.isInteger(cell.col) && cell.col >= 0 && cell.col < size).toBe(true);
    seen.add(key(cell));
    if (k > 0) expect(adjacent(solution[k - 1], cell)).toBe(true);
  });
  expect(seen.size).toBe(size * size);

  const index = new Map(solution.map((c, k) => [key(c), k]));
  const positions = board.candles.map((candle, k) => {
    expect(candle.number).toBe(k + 1);
    expect(index.has(key(candle.cell))).toBe(true);
    return index.get(key(candle.cell));
  });
  expect(new Set(positions).size).toBe(candles);
  expect(positions[0]).toBe(0);
  expect(positions[candles - 1]).toBe(size * size - 1);
  for (let k = 1; k < positions.length; k += 1) expect(positions[k]).toBeGreaterThan(positions[k - 1]);

  expect(checkPath(board, board.solution)).toBe(true);
}

/** Calls generateBoard with a frozen options object and checks it is unchanged afterwards. */
function generateUnmodified(options) {
  const before = { ...options };
  const board = generateBoard(Object.freeze(options));
  expect(options).toEqual(before);
  return board;
}

describe('generateBoard', () => {
  // Haunt Kit invariant 1: Generated boards are valid and solvable
  it('builds a valid, solvable board for every seed, size and valid candle count', () => {
    for (const seed of SEEDS) {
      for (const size of SIZES) {
        const maxCandles = Math.min(9, size * size);
        for (let candles = 2; candles <= maxCandles; candles += 1) {
          const board = generateUnmodified({ size, candles, random: mulberry32(seed) });
          expectValidBoard(board, size, candles);
        }
      }
    }
  });

  it('uses size 5 and 5 candles when options are absent', () => {
    expectValidBoard(generateBoard(), 5, 5);
    expectValidBoard(generateBoard({}), 5, 5);
    expectValidBoard(generateBoard({ random: mulberry32(1) }), 5, 5);
  });

  it('falls back to the default for each invalid size', () => {
    for (const size of [2, 8, 4.5, '5', NaN, null]) {
      for (const seed of SEEDS) {
        expectValidBoard(generateUnmodified({ size, candles: 3, random: mulberry32(seed) }), 5, 3);
      }
    }
  });

  it('checks candles against the resolved size', () => {
    // size 2 resolves to 5, where 9 candles is valid.
    expectValidBoard(generateUnmodified({ size: 2, candles: 9, random: mulberry32(7) }), 5, 9);
    // 9 candles is the maximum at size 3 (3 x 3 = 9).
    expectValidBoard(generateUnmodified({ size: 3, candles: 9, random: mulberry32(7) }), 3, 9);
  });

  it('falls back to 5 candles for each invalid candle count', () => {
    for (const candles of [1, 10, 26, '3']) {
      for (const size of SIZES) {
        for (const seed of SEEDS) {
          expectValidBoard(generateUnmodified({ size, candles, random: mulberry32(seed) }), size, 5);
        }
      }
    }
  });

  it('uses the built-in random source when random is absent or not a function', () => {
    for (const random of [undefined, 42, 'x']) {
      for (const size of SIZES) {
        expectValidBoard(generateUnmodified({ size, candles: 4, random }), size, 4);
      }
    }
  });

  it('never throws for a random that returns values outside [0, 1)', () => {
    for (const value of [1, 2, -1, NaN, Infinity, 'x', undefined]) {
      expectValidBoard(generateBoard({ size: 4, candles: 3, random: () => value }), 4, 3);
    }
  });

  // Haunt Kit invariant 2: Generation is determined by the random sequence
  it('returns deep-equal boards for the same random sequence', () => {
    for (const seed of SEEDS) {
      for (const size of SIZES) {
        const a = generateBoard({ size, candles: 5, random: mulberry32(seed) });
        const b = generateBoard({ size, candles: 5, random: mulberry32(seed) });
        expect(a).toEqual(b);
      }
    }
  });

  it('yields at least two different solution orders at size 5 across the seeds', () => {
    const orders = new Set(
      SEEDS.map((seed) => JSON.stringify(generateBoard({ size: 5, random: mulberry32(seed) }).solution)),
    );
    expect(orders.size).toBeGreaterThanOrEqual(2);
  });

  it('returns fresh cell objects for candles', () => {
    const board = generateBoard({ size: 4, random: mulberry32(3) });
    expect(board.candles[0].cell).not.toBe(board.solution[0]);
    expect(board.candles[0].cell).toEqual(board.solution[0]);
  });
});

describe('checkPath', () => {
  /** checkPath result, after asserting it neither throws nor changes its inputs. */
  function checkUnmodified(board, path) {
    const boardBefore = structuredClone(board);
    const pathBefore = structuredClone(path);
    let result;
    expect(() => {
      result = checkPath(board, path);
    }).not.toThrow();
    expect(board).toEqual(boardBefore);
    expect(path).toEqual(pathBefore);
    return result;
  }

  // Haunt Kit invariant 3: checkPath accepts exactly the winning paths
  it('rejects each defect in the catalogue on every generated board', () => {
    for (const seed of SEEDS) {
      for (const size of SIZES) {
        const board = generateBoard({ size, candles: 3, random: mulberry32(seed) });
        const sol = board.solution;
        const mid = Math.floor(sol.length / 2);
        expect(checkUnmodified(board, sol)).toBe(true);

        // empty path
        expect(checkUnmodified(board, [])).toBe(false);
        // a skipped cell
        expect(checkUnmodified(board, [...sol.slice(0, mid), ...sol.slice(mid + 1)])).toBe(false);
        // a repeated cell (same length, one cell twice)
        const repeated = sol.map((c) => ({ ...c }));
        repeated[mid] = { ...sol[mid - 1] };
        expect(checkUnmodified(board, repeated)).toBe(false);
        // wrong first and last cell, candles reversed
        expect(checkUnmodified(board, [...sol].reverse())).toBe(false);
        // a non-Adjacent step: swap two cells two apart
        const swapped = sol.map((c) => ({ ...c }));
        [swapped[1], swapped[3]] = [swapped[3], swapped[1]];
        expect(swapped.some((c, k) => k > 0 && !adjacent(swapped[k - 1], c))).toBe(true);
        expect(checkUnmodified(board, swapped)).toBe(false);
        // a non-array
        for (const notArray of [null, undefined, 'path', 42, { length: sol.length }]) {
          expect(checkUnmodified(board, notArray)).toBe(false);
        }
        // bad cell coordinates
        for (const bad of [1.5, -1, size, '0', null]) {
          for (const field of ['row', 'col']) {
            const path = sol.map((c) => ({ ...c }));
            path[mid] = { ...path[mid], [field]: bad };
            expect(checkUnmodified(board, path)).toBe(false);
          }
        }
        // null and non-object entries
        for (const entry of [null, undefined, 7]) {
          const path = sol.map((c) => ({ ...c }));
          path[mid] = entry;
          expect(checkUnmodified(board, path)).toBe(false);
        }
      }
    }
  });

  // Hand-made 3 x 3 boards for defects that need a specific layout.
  const cell = (row, col) => ({ row, col });
  const SERPENTINE = [cell(0, 0), cell(0, 1), cell(0, 2), cell(1, 2), cell(1, 1), cell(1, 0), cell(2, 0), cell(2, 1), cell(2, 2)];
  const COLUMNS = [cell(0, 0), cell(1, 0), cell(2, 0), cell(2, 1), cell(1, 1), cell(0, 1), cell(0, 2), cell(1, 2), cell(2, 2)];
  const twoCandles = {
    size: 3,
    solution: SERPENTINE,
    candles: [
      { number: 1, cell: cell(0, 0) },
      { number: 2, cell: cell(2, 2) },
    ],
  };

  it('rejects a full path that ends on a cell other than candle N', () => {
    const spiral = [cell(0, 0), cell(0, 1), cell(0, 2), cell(1, 2), cell(2, 2), cell(2, 1), cell(2, 0), cell(1, 0), cell(1, 1)];
    expect(checkUnmodified(twoCandles, SERPENTINE)).toBe(true);
    expect(checkUnmodified(twoCandles, spiral)).toBe(false);
  });

  it('rejects a full path that starts on a cell other than candle 1', () => {
    const fromCorner = [cell(2, 0), cell(1, 0), cell(0, 0), cell(0, 1), cell(0, 2), cell(1, 2), cell(1, 1), cell(2, 1), cell(2, 2)];
    expect(checkUnmodified(twoCandles, fromCorner)).toBe(false);
  });

  it('rejects a full path that reaches the candles out of order', () => {
    const fourCandles = {
      size: 3,
      solution: SERPENTINE,
      candles: [
        { number: 1, cell: cell(0, 0) },
        { number: 2, cell: cell(0, 2) },
        { number: 3, cell: cell(2, 0) },
        { number: 4, cell: cell(2, 2) },
      ],
    };
    expect(checkUnmodified(fourCandles, SERPENTINE)).toBe(true);
    // Starts on 1, ends on 4, visits every cell, but meets 3 before 2.
    expect(checkUnmodified(fourCandles, COLUMNS)).toBe(false);
  });

  it('accepts any winning path, not only the stored solution', () => {
    expect(checkUnmodified(twoCandles, COLUMNS)).toBe(true);
  });

  it('returns false for malformed boards without throwing', () => {
    for (const board of [null, undefined, 5, {}, { size: 3 }, { size: 'x', candles: [] }, { size: 3, candles: [null] }]) {
      expect(() => checkPath(board, SERPENTINE)).not.toThrow();
      expect(checkPath(board, SERPENTINE)).toBe(false);
    }
  });
});
