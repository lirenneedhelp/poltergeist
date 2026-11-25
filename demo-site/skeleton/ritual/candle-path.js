// Candle Path generator: builds solvable boards and checks player paths.
//
// Pure module: no imports, no DOM, no chrome.* API. The only source of
// randomness is the injected `random` (Math.random when absent).
//
// Board = { size, solution: Cell[], candles: { number, cell: Cell }[] }
// Cell  = { row, col }, integers in 0..size-1.
//
// The solution is a Hamiltonian path built from a serpentine path with random
// "backbite" moves: link the tail to a grid neighbour and reverse the segment
// after it. Every move keeps each cell exactly once and every step Adjacent.

const DEFAULT_SIZE = 5;
const DEFAULT_CANDLES = 5;
const MIN_SIZE = 3;
const MAX_SIZE = 7;
const MIN_CANDLES = 2;
const MAX_CANDLES = 9;
const STEPS_PER_CELL = 30;

// Fixed neighbour order (up, down, left, right) keeps output a function of `random`.
const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function resolveOptions(options) {
  const opts = options !== null && typeof options === 'object' ? options : {};
  const size = intIn(opts.size, MIN_SIZE, MAX_SIZE) ? opts.size : DEFAULT_SIZE;
  const maxCandles = Math.min(MAX_CANDLES, size * size);
  const candles = intIn(opts.candles, MIN_CANDLES, maxCandles) ? opts.candles : DEFAULT_CANDLES;
  const random = typeof opts.random === 'function' ? opts.random : Math.random;
  return { size, candles, random };
}

/** Index in 0..n-1 from one draw; a non-finite or out-of-range draw is clamped. */
function makeRandomInt(random) {
  return (n) => {
    const raw = random();
    const r = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    return Math.min(n - 1, Math.max(0, Math.floor(r * n)));
  };
}

function serpentine(size) {
  const path = [];
  for (let row = 0; row < size; row += 1) {
    for (let i = 0; i < size; i += 1) {
      path.push(row % 2 === 0 ? row * size + i : row * size + (size - 1 - i));
    }
  }
  return path;
}

/** Reverse path[from..to] in place and keep pos (cell key -> index) in step. */
function reverseRange(path, pos, from, to) {
  for (let a = from, b = to; a < b; a += 1, b -= 1) {
    const t = path[a];
    path[a] = path[b];
    path[b] = t;
  }
  for (let k = from; k <= to; k += 1) pos[path[k]] = k;
}

function hamiltonianPath(size, random, randomInt) {
  const n = size * size;
  const path = serpentine(size);
  const pos = new Array(n);
  for (let k = 0; k < n; k += 1) pos[path[k]] = k;

  const steps = STEPS_PER_CELL * n;
  for (let step = 0; step < steps; step += 1) {
    if (random() < 0.5) reverseRange(path, pos, 0, n - 1); // work on either end
    const tail = path[n - 1];
    const row = Math.floor(tail / size);
    const col = tail % size;
    const nbrs = [];
    for (const [dr, dc] of DIRECTIONS) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < size && c >= 0 && c < size) nbrs.push(r * size + c);
    }
    const i = pos[nbrs[randomInt(nbrs.length)]];
    if (i === n - 2) continue; // already linked to the tail
    reverseRange(path, pos, i + 1, n - 1);
  }
  return path;
}

/** Distinct, ascending indices for the N - 2 middle candles, from 1..L-2 (partial Fisher–Yates). */
function middleIndices(length, count, randomInt) {
  const pool = [];
  for (let k = 1; k <= length - 2; k += 1) pool.push(k);
  for (let k = 0; k < count; k += 1) {
    const j = k + randomInt(pool.length - k);
    const t = pool[k];
    pool[k] = pool[j];
    pool[j] = t;
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

/**
 * Build a new Board. Invalid `size` or `candles` use the defaults (size first,
 * candles checked against the resolved size); a missing `random` uses Math.random.
 * Never mutates `options` and never throws for bad options.
 */
export function generateBoard(options) {
  const { size, candles, random } = resolveOptions(options);
  const randomInt = makeRandomInt(random);
  const keys = hamiltonianPath(size, random, randomInt);
  const toCell = (key) => ({ row: Math.floor(key / size), col: key % size });

  const length = keys.length;
  const indices = [0, ...middleIndices(length, candles - 2, randomInt), length - 1];
  return {
    size,
    solution: keys.map(toCell),
    candles: indices.map((index, k) => ({ number: k + 1, cell: toCell(keys[index]) })),
  };
}

const isCell = (cell, size) =>
  cell !== null && typeof cell === 'object' && intIn(cell.row, 0, size - 1) && intIn(cell.col, 0, size - 1);

const adjacent = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

function check(board, path) {
  if (board === null || typeof board !== 'object') return false;
  const { size, candles } = board;
  if (!Number.isInteger(size) || size < 1 || !Array.isArray(candles)) return false;
  if (!Array.isArray(path) || path.length !== size * size) return false;

  const candleAt = new Map();
  for (const candle of candles) {
    if (candle === null || typeof candle !== 'object' || !isCell(candle.cell, size)) return false;
    candleAt.set(candle.cell.row * size + candle.cell.col, candle.number);
  }
  const total = candles.length;

  const seen = new Set();
  const met = [];
  for (let k = 0; k < path.length; k += 1) {
    const cell = path[k];
    if (!isCell(cell, size)) return false;
    const key = cell.row * size + cell.col;
    if (seen.has(key)) return false;
    seen.add(key);
    if (k > 0 && !adjacent(path[k - 1], cell)) return false;
    if (candleAt.has(key)) met.push(candleAt.get(key));
  }

  const first = path[0];
  const last = path[path.length - 1];
  if (candleAt.get(first.row * size + first.col) !== 1) return false;
  if (candleAt.get(last.row * size + last.col) !== total) return false;
  if (met.length !== total) return false;
  return met.every((number, k) => number === k + 1);
}

/**
 * True exactly when `path` visits every Cell of `board` once, each step is
 * Adjacent, it starts on candle 1, ends on candle N and meets candles 1..N in
 * order. Returns false for malformed input; never throws or mutates.
 */
export function checkPath(board, path) {
  try {
    return check(board, path);
  } catch {
    return false;
  }
}
