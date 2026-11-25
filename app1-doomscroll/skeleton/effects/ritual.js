// Ritual_Effect: a full-page Candle Path puzzle in an open shadow root.
//
// The host is the last child of <html>, has no light-DOM children, and every
// visual lives in its shadow root. Nodes are made with createElement /
// createElementNS, all text is set with textContent, and nothing is loaded:
// candles, wax, flame and smoke are CSS gradients keyed on data attributes.
//
// Input: every path change goes through tryMove (pointer drag, arrow keys) or
// the Reset and Hint buttons, and ends in update(). A path that checkPath
// accepts calls complete(): with motion the ghost fades for 1200 ms and a
// one-shot timer then reports env.onAction('exorcised'); under Reduced_Motion
// the action is reported in the completing handler. With `sound: true` the
// first time candle N lights plays one generated Web Audio chime. undo clears
// the ending timer and animation and closes the chime's audio context, so an
// undone ritual never reports the action and leaves no audio running.

import { clamp01, teardown, handleState, LIVE, numberIn } from './util.js';
import { generateBoard, checkPath } from '../ritual/candle-path.js';

export const description =
  'A full-page candle puzzle: draw one path through every square, passing the numbered candles in order. ' +
  'Finishing it reports the "exorcised" action; blocks interaction once intensity reaches blockAt.';

const DEFAULTS = {
  heading: 'Light the candles to banish the ghost',
  // `<N>` becomes the live Board's candle count; only the default is substituted (5.11).
  instructions:
    'Draw one path through every square, passing the candles in order. ' +
    'Candle <N> must be your last square. Drag back to undo.',
  sound: false,
  maxOpacity: 0.96,
  blockAt: 1,
};
const MAX_HEADING = 200;
const MAX_INSTRUCTIONS = 300;
const VEIL_MAX = 0.85;
const VEIL_FADE = 'opacity 300ms linear';
const SVG_NS = 'http://www.w3.org/2000/svg';
const Z_INDEX = '2147483647'; // same top layer as Block and Tombstone

// Every background colour inside the host keeps red, green and blue at 64 or below.
const BG_CARD = '#16121c';
const BG_CELL = '#221c2a';
const BG_CELL_ON_PATH = '#3a2f40';

const HOST_CSS =
  'all:initial;position:fixed;top:0;right:0;bottom:0;left:0;z-index:' + Z_INDEX + ';' +
  'display:flex;align-items:center;justify-content:center;background:rgba(8,6,12,0.9);' +
  'opacity:0;pointer-events:none;';

// Static stylesheet: no url(), @import, @font-face, @keyframes, animation or transition.
const STYLE = `
.veil{position:absolute;top:0;right:0;bottom:0;left:0;pointer-events:none;
  background-image:radial-gradient(ellipse at 30% 30%, rgba(52,52,58,0.9), transparent 60%),
    radial-gradient(ellipse at 70% 75%, rgba(40,40,46,0.9), transparent 65%);
  background-color:rgba(24,24,28,0.6);}
.card{position:relative;box-sizing:border-box;max-width:min(36rem,94vw);max-height:96vh;overflow:auto;
  padding:24px 28px;border-radius:12px;color:#ece3d0;text-align:center;
  font:400 16px/1.4 system-ui,sans-serif;box-shadow:0 0 0 1px #3a2f40;}
.heading{margin:0 0 8px;font:600 26px/1.25 Georgia,serif;overflow-wrap:anywhere;}
.instructions{margin:0 0 16px;font:400 16px/1.4 system-ui,sans-serif;overflow-wrap:anywhere;}
.stage{position:relative;display:inline-block;}
.board{display:flex;flex-direction:column;touch-action:none;outline:none;user-select:none;}
.board:focus-visible{box-shadow:0 0 0 3px #ffb347;}
.row{display:flex;}
.cell{box-sizing:border-box;width:48px;height:48px;display:flex;align-items:flex-start;justify-content:flex-start;
  padding:2px 5px;font:600 12px/1 system-ui,sans-serif;color:#ece3d0;box-shadow:inset 0 0 0 1px #0c0a10;
  cursor:pointer;}
.cell[data-candle]{background-repeat:no-repeat;
  background-image:linear-gradient(180deg,#f1e8d2,#d6c9ab),
    radial-gradient(ellipse at center,rgba(150,150,158,0.55),rgba(150,150,158,0) 70%);
  background-size:14px 20px,10px 16px;background-position:center 78%,center 22%;}
.cell[data-candle][data-lit="true"]{
  background-image:linear-gradient(180deg,#f1e8d2,#d6c9ab),
    radial-gradient(ellipse at center 70%,#fff2b0 0,#ffb347 35%,#ff7a1a 55%,rgba(255,122,26,0) 72%);
  background-size:14px 20px,12px 18px;background-position:center 78%,center 18%;}
.cell[data-end]{box-shadow:inset 0 0 0 2px #ffb347;}
.trail{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;}
.trail polyline{fill:none;stroke:#ffb347;stroke-opacity:0.7;stroke-width:0.14;stroke-linecap:round;stroke-linejoin:round;}
.ghost{position:absolute;top:50%;left:50%;width:120px;height:140px;margin:-70px 0 0 -60px;pointer-events:none;}
.ghost path{fill:#ece3d0;fill-opacity:0.85;}
.status{margin:14px 0 10px;font:600 16px/1.3 system-ui,sans-serif;}
.controls{display:flex;gap:10px;justify-content:center;}
.controls button{font:600 15px system-ui,sans-serif;padding:8px 18px;border:0;border-radius:6px;
  background:#3a2f40;color:#ece3d0;cursor:pointer;}
.controls button:focus-visible{outline:3px solid #ffb347;outline-offset:2px;}
`;

/** A string of min..max code points, otherwise the fallback. */
const textIn = (v, max, fallback) => {
  if (typeof v !== 'string') return fallback;
  const n = Array.from(v).length;
  return n >= 1 && n <= max ? v : fallback;
};

const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Param resolution (design section 2.2). Never mutates `params`. `size` and
 * `candles` pass through as given; generateBoard owns their ranges.
 */
function resolve(params) {
  const src = isPlainObject(params) ? params : {};
  return {
    heading: textIn(src.heading, MAX_HEADING, DEFAULTS.heading),
    instructions: textIn(src.instructions, MAX_INSTRUCTIONS, null), // null: default, filled in by apply
    size: src.size,
    candles: src.candles,
    sound: src.sound === true,
    maxOpacity: numberIn(src.maxOpacity, 0, 1, DEFAULTS.maxOpacity),
    blockAt: numberIn(src.blockAt, 0, 1, DEFAULTS.blockAt),
  };
}

const round3 = (n) => String(+n.toFixed(3));
const copyCell = (cell) => ({ row: cell.row, col: cell.col });
const sameCell = (a, b) => a.row === b.row && a.col === b.col;

/** Input guard for every handler: trusted and LIVE, else the event is ignored. */
const accepts = (handle, event) =>
  Boolean(event) && event.isTrusted === true && handleState(handle) === LIVE;

function candleAt(handle, cell) {
  const found = handle.board.candles.find((c) => sameCell(c.cell, cell));
  return found ? found.number : 0;
}

/** Lit_Count: the number of candles on the Player_Path. */
function countLit(handle) {
  return handle.path.reduce((n, cell) => n + (candleAt(handle, cell) ? 1 : 0), 0);
}

/** The instructions text: a valid custom string as written, else the default with `<N>` = candle count. */
function instructionsText(handle, p) {
  return p.instructions !== null
    ? p.instructions
    : DEFAULTS.instructions.replace('<N>', String(handle.board.candles.length));
}

/**
 * Status line (5.12, 5.13). While candle N is on the path with squares still
 * empty, the move rule allows only retracts, so the line says how to get out.
 */
function statusText(lit, n, filled, total) {
  if (lit >= n && filled < total) return `Candle ${n} must be last. Back up and fill the empty squares.`;
  return `${lit} of ${n} candles \u00b7 ${filled} of ${total} squares`;
}

/**
 * Set every cell, the trail, the status line and the veil from `path` and
 * `lit`. Filled_Count is path.length and S is size² (design section 2.5).
 */
function render(handle) {
  const { board, path, lit, els } = handle;
  const n = board.candles.length;
  const filled = path.length;
  const total = board.size * board.size;
  const onPath = new Set(path.map((c) => c.row * board.size + c.col));
  const end = path[path.length - 1];
  for (let row = 0; row < board.size; row += 1) {
    for (let col = 0; col < board.size; col += 1) {
      const el = els.cells[row][col];
      const on = onPath.has(row * board.size + col);
      el.style.backgroundColor = on ? BG_CELL_ON_PATH : BG_CELL;
      if (on) el.setAttribute('data-on-path', 'true');
      else el.removeAttribute('data-on-path');
      if (end && end.row === row && end.col === col) el.setAttribute('data-end', 'true');
      else el.removeAttribute('data-end');
    }
  }
  for (const candle of board.candles) {
    const el = els.cells[candle.cell.row][candle.cell.col];
    const isLit = onPath.has(candle.cell.row * board.size + candle.cell.col);
    el.setAttribute('data-lit', isLit ? 'true' : 'false');
    el.setAttribute('aria-label', `Candle ${candle.number}, ${isLit ? 'lit' : 'unlit'}`);
  }
  els.polyline.setAttribute('points', path.map((c) => `${c.col + 0.5},${c.row + 0.5}`).join(' '));
  els.status.textContent = statusText(lit, n, filled, total);
  // size >= 3, so total >= 9 and the divisor is never 0; 0 only when every square is filled (5.8).
  els.veil.style.opacity = round3((VEIL_MAX * (total - filled)) / (total - 1));
}

/** Recompute Lit_Count and render; every accepted path change ends here. */
function update(handle) {
  handle.lit = countLit(handle);
  render(handle);
  if (handle.sound === true && !handle.chimed && handle.lit === handle.board.candles.length) {
    startChime(handle);
  }
}

// ---- Web Audio chime (design section 2.7) ----

const CHIME_S = 0.9; // the oscillator stops at most 1 s after it starts (8.1)

/**
 * Play one generated chime. Runs once per handle: `chimed` is set first, so a
 * failure or a later re-light never retries (8.2). No audio file is loaded
 * (8.4). Every failure is logged and swallowed so completion proceeds (8.5).
 */
function startChime(handle) {
  handle.chimed = true;
  const win = handle.env.window;
  const AC = win ? win.AudioContext || win.webkitAudioContext : undefined;
  if (typeof AC !== 'function') {
    console.error('[poltergeist] ritual sound: Web Audio API unavailable');
    return;
  }
  let ctx = null;
  try {
    ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.linearRampToValueAtTime(990, t + 0.25);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + CHIME_S);
    osc.connect(gain);
    gain.connect(ctx.destination);
    handle.audio = { ctx, osc }; // set before start so a throwing start is closed by stopChime
    osc.start(t);
    osc.stop(t + CHIME_S);
  } catch (err) {
    console.error('[poltergeist] ritual sound:', err);
    // a context was made but the chime failed: close it now so nothing is left open
    if (handle.audio) stopChime(handle);
    else if (ctx) {
      try {
        const closing = ctx.close();
        if (closing && typeof closing.catch === 'function') closing.catch(() => {});
      } catch {
        // closing is best effort
      }
    }
  }
}

// ---- Completion and Banishing_Ending (design section 2.6) ----

const ENDING_MS = 1200;
const GHOST_FRAMES = [
  { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' },
  { opacity: 0, transform: 'translateY(-32px)', filter: 'blur(6px)' },
];

/**
 * Report the Exorcised_Action. A missing or throwing env.onAction is logged and
 * swallowed, so the completed Board stays shown. Callers set handle.exorcised
 * first and call this as their last statement: the app may undo the ritual
 * from inside the callback (design decision 6).
 */
function fireExorcised(handle) {
  const { env } = handle;
  if (typeof env.onAction !== 'function') {
    console.error('[poltergeist] ritual: env.onAction is not a function');
    return;
  }
  try {
    env.onAction('exorcised');
  } catch (err) {
    console.error('[poltergeist] ritual onAction:', err);
  }
}

/** One-shot ending timer: the timer, not the animation, decides when the action fires. */
function onEndingDone(handle) {
  handle.endingTimer = null;
  if (handleState(handle) !== LIVE || handle.exorcised) return;
  handle.endingAnim = null;
  handle.els.ghost.style.display = 'none';
  handle.exorcised = true;
  fireExorcised(handle);
}

/**
 * Called when a move or Hint leaves a path that checkPath accepts. Reachable
 * only from a LIVE handle (every handler runs the input guard first), so a
 * fading ritual never completes (7.9). From here on tryMove, Reset and Hint
 * change nothing (7.1).
 */
function complete(handle) {
  if (handle.complete || handleState(handle) !== LIVE) return;
  handle.complete = true;
  endDrag(handle);
  render(handle);
  if (handle.env.reducedMotion) {
    // No ending under Reduced_Motion: the action comes in the completing handler (7.3).
    handle.exorcised = true;
    fireExorcised(handle);
    return;
  }
  const ghost = handle.els.ghost;
  ghost.style.display = '';
  if (typeof ghost.animate === 'function') {
    try {
      handle.endingAnim = ghost.animate(GHOST_FRAMES, { duration: ENDING_MS, easing: 'ease-in', fill: 'forwards' });
    } catch {
      handle.endingAnim = null; // the ghost stays shown; the timer still fires the action
    }
  }
  handle.endingTimer = handle.env.setTimeout(() => onEndingDone(handle), ENDING_MS);
}

// ---- Moves (design section 2.4) ----

const ARROWS = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const inGrid = (cell, size) =>
  Number.isInteger(cell.row) && Number.isInteger(cell.col) &&
  cell.row >= 0 && cell.row < size && cell.col >= 0 && cell.col < size;

const adjacent = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

/**
 * One move from the Path_End to `cell`. Returns true when the path changed.
 * A rejected move touches nothing, so status and veil stay as they were.
 */
function tryMove(handle, cell) {
  if (handle.complete || !cell) return false;
  const { board, path } = handle;
  const n = board.candles.length;
  const end = path[path.length - 1];
  // Retract onto the previous cell (6.4); impossible from the single-cell path (6.5).
  if (path.length >= 2 && sameCell(cell, path[path.length - 2])) {
    path.pop();
    update(handle);
    return true;
  }
  if (handle.lit >= n) return false; // only retract while candle N is lit (6.7)
  if (!inGrid(cell, board.size) || !adjacent(cell, end)) return false;
  if (path.some((c) => sameCell(c, cell))) return false;
  const k = candleAt(handle, cell);
  if (k && k !== handle.lit + 1) return false;
  path.push(copyCell(cell));
  update(handle);
  if (path.length === board.size * board.size && checkPath(board, path)) complete(handle);
  return true;
}

/** The Board cell `target` is, or null for anything else (row, gap, board itself). */
function cellOf(handle, target) {
  if (!target || typeof target.getAttribute !== 'function') return null;
  const row = Number(target.getAttribute('data-row'));
  const col = Number(target.getAttribute('data-col'));
  const cells = handle.els.cells;
  if (!Number.isInteger(row) || !Number.isInteger(col) || !cells[row] || cells[row][col] !== target) return null;
  return { row, col };
}

function startDrag(handle, event) {
  endDrag(handle); // a missed release never leaves a second pair of window listeners
  const pointerId = event.pointerId;
  handle.drag = { pointerId };
  // Touch gives the pressed cell implicit capture; release it so later events
  // target the cell under the finger.
  const target = event.target;
  try {
    if (typeof target.hasPointerCapture === 'function' && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  } catch {
    // capture is best effort
  }
  const win = handle.env.window;
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('pointerup', handle.on.pointerup);
    win.addEventListener('pointercancel', handle.on.pointerup);
  }
}

// ---- Teardown helpers (safe no-ops until tasks 5.5 to 5.7 set their state) ----

function endDrag(handle) {
  if (!handle.drag) return;
  handle.drag = null;
  const win = handle.env.window;
  if (win && typeof win.removeEventListener === 'function') {
    win.removeEventListener('pointerup', handle.on.pointerup);
    win.removeEventListener('pointercancel', handle.on.pointerup);
  }
}

function stopEnding(handle) {
  if (handle.endingTimer !== null) {
    handle.env.clearTimeout(handle.endingTimer);
    handle.endingTimer = null;
  }
  if (handle.endingAnim) {
    try {
      handle.endingAnim.cancel();
    } catch {
      // a cancelled or detached animation needs nothing more
    }
    handle.endingAnim = null;
  }
}

function stopChime(handle) {
  const audio = handle.audio;
  if (!audio) return;
  handle.audio = null;
  try {
    audio.osc.stop();
  } catch {
    // already stopped
  }
  try {
    const closing = audio.ctx.close();
    if (closing && typeof closing.catch === 'function') closing.catch(() => {});
  } catch {
    // already closed
  }
}

function removeListeners(handle) {
  const { els, on } = handle;
  els.board.removeEventListener('pointerdown', on.pointerdown);
  els.board.removeEventListener('pointerover', on.pointerover);
  els.board.removeEventListener('keydown', on.keydown);
  els.reset.removeEventListener('click', on.reset);
  els.hint.removeEventListener('click', on.hint);
}

// ---- DOM ----

function el(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function svg(doc, tag, className) {
  const node = doc.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  return node;
}

function buildGhost(doc) {
  const ghost = svg(doc, 'svg', 'ghost');
  ghost.setAttribute('viewBox', '0 0 120 140');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.display = 'none'; // shown only during the Banishing_Ending
  const body = svg(doc, 'path');
  body.setAttribute(
    'd',
    'M60 8C30 8 14 32 14 62v66l12-10 12 10 11-10 11 10 11-10 11 10 12-10 12 10V62C106 32 90 8 60 8z',
  );
  ghost.appendChild(body);
  return ghost;
}

function buildBoard(doc, board, cells) {
  const grid = el(doc, 'div', 'board');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('tabindex', '0');
  grid.setAttribute('aria-label', `Candle path, ${board.size} by ${board.size}`);
  grid.style.backgroundColor = BG_CARD;
  for (let row = 0; row < board.size; row += 1) {
    const rowEl = el(doc, 'div', 'row');
    rowEl.setAttribute('role', 'row');
    cells.push([]);
    for (let col = 0; col < board.size; col += 1) {
      const cell = el(doc, 'div', 'cell');
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('data-row', String(row));
      cell.setAttribute('data-col', String(col));
      cell.style.backgroundColor = BG_CELL;
      rowEl.appendChild(cell);
      cells[row].push(cell);
    }
    grid.appendChild(rowEl);
  }
  for (const candle of board.candles) {
    const cell = cells[candle.cell.row][candle.cell.col];
    cell.setAttribute('data-candle', String(candle.number));
    cell.textContent = String(candle.number);
  }
  return grid;
}

function buildTrail(doc, size) {
  const trail = svg(doc, 'svg', 'trail');
  trail.setAttribute('viewBox', `0 0 ${size} ${size}`);
  trail.setAttribute('preserveAspectRatio', 'none');
  trail.setAttribute('aria-hidden', 'true');
  const polyline = svg(doc, 'polyline');
  trail.appendChild(polyline);
  return { trail, polyline };
}

/** Input handlers, exposed on handle.on for tests. Each runs the guard first. */
function makeHandlers(handle) {
  return {
    // Drag starts only with the primary button on the Path_End (6.8).
    pointerdown: (event) => {
      if (!accepts(handle, event)) return;
      if (event.button !== 0 || event.isPrimary === false) return;
      const cell = cellOf(handle, event.target);
      if (!cell || !sameCell(cell, handle.path[handle.path.length - 1])) return;
      startDrag(handle, event);
    },
    // Each cell the dragging pointer enters is one move; no interpolation.
    pointerover: (event) => {
      if (!accepts(handle, event)) return;
      if (!handle.drag || event.pointerId !== handle.drag.pointerId) return;
      const cell = cellOf(handle, event.target);
      if (cell) tryMove(handle, cell);
    },
    // Registered on env.window for both pointerup and pointercancel.
    pointerup: (event) => {
      if (!accepts(handle, event)) return;
      if (!handle.drag || event.pointerId !== handle.drag.pointerId) return;
      endDrag(handle);
    },
    // Arrow keys on the focused Board (6.9); every other key is left alone.
    keydown: (event) => {
      if (!accepts(handle, event)) return;
      const delta = Object.prototype.hasOwnProperty.call(ARROWS, event.key) ? ARROWS[event.key] : null;
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const end = handle.path[handle.path.length - 1];
      tryMove(handle, { row: end.row + delta[0], col: end.col + delta[1] });
    },
    // Reset (6.11): back to candle 1 on the same Board.
    reset: (event) => {
      if (!accepts(handle, event)) return;
      if (handle.complete) return;
      handle.path = [copyCell(handle.board.candles[0].cell)];
      endDrag(handle);
      update(handle);
    },
    // Hint (6.12): the matching solution prefix plus one more cell.
    hint: (event) => {
      if (!accepts(handle, event)) return;
      if (handle.complete) return;
      const { board, path } = handle;
      const total = board.size * board.size;
      let k = 0;
      while (k < path.length && k < total && sameCell(path[k], board.solution[k])) k += 1;
      k = Math.max(1, k);
      if (k === total) return;
      handle.path = board.solution.slice(0, k + 1).map(copyCell);
      endDrag(handle);
      update(handle);
      if (checkPath(board, handle.path)) complete(handle);
    },
  };
}

function create(env, p) {
  const doc = env.document;
  const board = generateBoard({ size: p.size, candles: p.candles });

  const host = doc.createElement('div');
  host.setAttribute('data-poltergeist', 'ritual');
  host.style.cssText = HOST_CSS;
  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = STYLE;
  const veil = el(doc, 'div', 'veil');
  veil.setAttribute('aria-hidden', 'true');
  if (!env.reducedMotion) veil.style.transition = VEIL_FADE;

  const card = el(doc, 'div', 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'ritual-heading');
  card.style.backgroundColor = BG_CARD;
  const heading = el(doc, 'h1', 'heading');
  heading.id = 'ritual-heading';
  const instructions = el(doc, 'p', 'instructions');

  const stage = el(doc, 'div', 'stage');
  const cells = [];
  const grid = buildBoard(doc, board, cells);
  const { trail, polyline } = buildTrail(doc, board.size);
  const ghost = buildGhost(doc);
  stage.append(grid, trail, ghost);

  const status = el(doc, 'p', 'status');
  status.setAttribute('aria-live', 'polite');
  const controls = el(doc, 'div', 'controls');
  const reset = el(doc, 'button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  const hint = el(doc, 'button');
  hint.type = 'button';
  hint.textContent = 'Hint';
  controls.append(reset, hint);

  card.append(heading, instructions, stage, status, controls);
  root.append(style, veil, card);

  const first = board.candles[0].cell;
  const handle = {
    env, host, root,
    els: { style, veil, card, heading, instructions, board: grid, cells, trail, polyline, ghost, status, reset, hint },
    board,
    path: [copyCell(first)],
    lit: 1,
    complete: false, exorcised: false, chimed: false,
    sound: p.sound, // read at creation only
    focusedOnce: false, prevFocus: null,
    drag: null,
    endingTimer: null, endingAnim: null,
    audio: null,
    on: null,
    dead: false, fading: false, timer: null,
  };
  handle.on = makeHandlers(handle);

  grid.addEventListener('pointerdown', handle.on.pointerdown);
  grid.addEventListener('pointerover', handle.on.pointerover);
  grid.addEventListener('keydown', handle.on.keydown);
  reset.addEventListener('click', handle.on.reset);
  hint.addEventListener('click', handle.on.hint);

  update(handle);
  doc.documentElement.appendChild(host);
  return handle;
}

/** Focus the Board the first time this handle blocks pointers (Requirement 6.10). */
function focusOnce(handle) {
  if (handle.focusedOnce) return;
  handle.focusedOnce = true;
  handle.prevFocus = handle.env.document.activeElement;
  try {
    handle.els.board.focus({ preventScroll: true });
  } catch {
    // focus is best effort
  }
}

export function apply(env, params = {}, intensity, handle) {
  const i = typeof intensity === 'number' && !Number.isNaN(intensity) ? clamp01(intensity) : 0;
  const p = resolve(params);
  if (!handle || handle.dead) handle = create(env, p);
  if (handleState(handle) !== LIVE) return handle;
  const s = handle.host.style;
  s.opacity = round3(p.maxOpacity * i);
  const blocking = i >= p.blockAt;
  s.pointerEvents = blocking ? 'auto' : 'none';
  if (blocking) focusOnce(handle);
  handle.els.heading.textContent = p.heading;
  handle.els.instructions.textContent = instructionsText(handle, p);
  return handle;
}

export function undo(handle, { durationMs } = {}) {
  const d = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  teardown(
    handle,
    d,
    () => {
      endDrag(handle);
      stopEnding(handle);
      stopChime(handle);
      const s = handle.host.style;
      s.pointerEvents = 'none';
      if (!handle.env.reducedMotion) s.transition = `opacity ${d}ms linear`;
      s.opacity = '0';
    },
    () => {
      removeListeners(handle);
      endDrag(handle);
      stopEnding(handle);
      stopChime(handle);
      const { prevFocus } = handle;
      handle.prevFocus = null;
      if (handle.env.document.activeElement === handle.host && prevFocus && prevFocus.isConnected) {
        try {
          prevFocus.focus({ preventScroll: true });
        } catch {
          // focus is best effort
        }
      }
      handle.host.remove();
    },
  );
}
