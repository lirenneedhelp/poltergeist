import { clamp01, teardown } from './util.js';

export const description = 'Characters in visible text decay into glyphs of dust; more of them as intensity grows.';

const DEFAULTS = { maxFraction: 0.5, glyphs: '░▒·_ ' };
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE']);
const TEXT_NODE = 3;
const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT
const ACCEPT = 1;
const REJECT = 2;
const SKIP_NODE = 3;
// Observer-driven passes run at most once per window; explicit applies are never throttled.
const OBSERVER_THROTTLE_MS = 250;
const OBSERVE_OPTIONS = { subtree: true, childList: true, characterData: true };

// Deterministic hash -> [0,1). A character's "rot threshold" never changes, so rot only
// ever grows as intensity rises and doesn't shimmer between ticks.
function hash(a, b) {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function rotText(text, serial, fraction, glyphs) {
  let out = '';
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (/\s/.test(ch)) { out += ch; continue; }
    const r = hash(serial, k);
    out += r < fraction ? glyphs[Math.floor(hash(k, serial) * glyphs.length)] : ch;
  }
  return out;
}

// Same skip rules for explicit and observer-driven passes.
function acceptText(node) {
  const parent = node.parentElement;
  if (!parent || SKIP.has(parent.tagName) || parent.isContentEditable) return REJECT;
  return node.data.trim() ? ACCEPT : SKIP_NODE;
}

// Rot one eligible text node at the Handle's latest fraction/glyphs.
function processText(handle, node) {
  let entry = handle.nodes.get(node);
  // If the page rewrote the node since we touched it, treat the new text as the original.
  if (!entry || node.data !== entry.out) {
    entry = { orig: node.data, out: node.data, serial: entry ? entry.serial : handle.serial++ };
    handle.nodes.set(node, entry);
  }
  const out = rotText(entry.orig, entry.serial, handle.fraction, handle.glyphs);
  if (out !== node.data) node.data = out;
  entry.out = out;
}

// Text roots are processed directly (a TreeWalker never yields its own root);
// any other root has its eligible descendant text walked.
function processSubtree(handle, doc, root) {
  if (root.nodeType === TEXT_NODE) {
    if (acceptText(root) === ACCEPT) processText(handle, root);
    return;
  }
  const walker = doc.createTreeWalker(root, SHOW_TEXT, { acceptNode: acceptText });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) processText(handle, node);
}

// Drop entries for nodes the page removed; never touch their data.
function pruneDetached(handle) {
  for (const node of Array.from(handle.nodes.keys())) {
    if (node.isConnected === false) handle.nodes.delete(node);
  }
}

function clearPendingObserverWork(handle) {
  if (handle.observerTimer !== null) {
    handle.env.clearTimeout(handle.observerTimer);
    handle.observerTimer = null;
  }
  handle.pendingRoots.clear();
  handle.pendingPrune = false;
}

function onMutations(handle, records) {
  if (handle.dead) return;
  let relevant = false;
  for (const record of records) {
    if (record.type === 'childList') {
      for (const node of record.addedNodes) { handle.pendingRoots.add(node); relevant = true; }
      if (record.removedNodes.length) { handle.pendingPrune = true; relevant = true; }
    } else if (record.type === 'characterData') {
      const node = record.target;
      if (node.nodeType !== TEXT_NODE) continue;
      const entry = handle.nodes.get(node);
      // Rot's own write: the node already holds the tracked output.
      if (entry && node.data === entry.out) continue;
      handle.pendingRoots.add(node);
      relevant = true;
    }
  }
  if (relevant && handle.observerTimer === null) {
    handle.observerTimer = handle.env.setTimeout(() => flushObserverRoots(handle), OBSERVER_THROTTLE_MS);
  }
}

function flushObserverRoots(handle) {
  handle.observerTimer = null;
  const queued = Array.from(handle.pendingRoots);
  handle.pendingRoots.clear();
  handle.pendingPrune = false;
  if (handle.dead) return;

  // Pruning does not traverse page text, so it runs on every refresh.
  pruneDetached(handle);
  const doc = handle.observerDoc;
  const body = doc && doc.body;
  if (!body) return;

  // Only roots still inside the body; the body itself appears only if it was added.
  const inBody = new Set(queued.filter((root) => body.contains(root)));
  for (const root of inBody) {
    if (coveredByAncestor(root, inBody)) continue;
    processSubtree(handle, doc, root);
  }
}

function coveredByAncestor(root, roots) {
  for (let p = root.parentNode; p; p = p.parentNode) {
    if (roots.has(p)) return true;
  }
  return false;
}

function ensureObserver(handle, env) {
  if (handle.observer) return;
  const MO = env.window && env.window.MutationObserver;
  const doc = env.document;
  const root = doc && doc.documentElement;
  if (typeof MO !== 'function' || !root) return;
  handle.observer = new MO((records) => onMutations(handle, records));
  handle.observerDoc = doc;
  handle.observer.observe(root, OBSERVE_OPTIONS);
}

export function apply(env, params = {}, intensity, handle) {
  const p = { ...DEFAULTS, ...params };
  const doc = env.document;
  if (!handle || handle.dead) {
    handle = {
      env, nodes: new Map(), serial: 0, dead: false, fading: false, timer: null,
      observer: null, observerDoc: null, observerTimer: null,
      pendingRoots: new Set(), pendingPrune: false,
      fraction: 0, glyphs: [],
    };
  } else {
    pruneDetached(handle);
  }
  handle.fraction = p.maxFraction * clamp01(intensity);
  handle.glyphs = Array.from(p.glyphs);

  if (doc.body) {
    processSubtree(handle, doc, doc.body); // explicit full-body pass
    // The full pass covers everything queued so far, including undelivered records.
    if (handle.observer) handle.observer.takeRecords();
    clearPendingObserverWork(handle);
  }
  ensureObserver(handle, env);
  return handle;
}

export function undo(handle) {
  if (handle && !handle.dead) {
    if (handle.observer) {
      handle.observer.disconnect();
      handle.observer = null;
    }
    clearPendingObserverWork(handle);
  }
  // Rot has no fade; restores instantly.
  teardown(handle, 0, () => {}, () => {
    for (const [node, entry] of handle.nodes) {
      if (node.data === entry.out) node.data = entry.orig;
    }
    handle.nodes.clear();
  });
}
