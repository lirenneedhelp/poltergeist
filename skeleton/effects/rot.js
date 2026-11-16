import { clamp01, teardown } from './util.js';

export const description = 'Characters in visible text decay into glyphs of dust; more of them as intensity grows.';

const DEFAULTS = { maxFraction: 0.5, glyphs: '░▒·_ ' };
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE']);

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

export function apply(env, params = {}, intensity, handle) {
  const p = { ...DEFAULTS, ...params };
  const glyphs = Array.from(p.glyphs);
  const fraction = p.maxFraction * clamp01(intensity);
  const doc = env.document;
  if (!handle || handle.dead) {
    handle = { env, nodes: new Map(), serial: 0, dead: false, fading: false, timer: null };
  } else {
    // Drop entries for nodes the page removed; never touch their data.
    for (const node of Array.from(handle.nodes.keys())) {
      if (node.isConnected === false) handle.nodes.delete(node);
    }
  }
  if (!doc.body) return handle;

  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName) || parent.isContentEditable) return 2; // REJECT
      return node.data.trim() ? 1 : 3; // ACCEPT : SKIP
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let entry = handle.nodes.get(node);
    // If the page rewrote the node since we touched it, treat the new text as the original.
    if (!entry || node.data !== entry.out) {
      entry = { orig: node.data, out: node.data, serial: entry ? entry.serial : handle.serial++ };
      handle.nodes.set(node, entry);
    }
    const out = rotText(entry.orig, entry.serial, fraction, glyphs);
    if (out !== node.data) node.data = out;
    entry.out = out;
  }
  return handle;
}

export function undo(handle) {
  // Rot has no fade; restores instantly.
  teardown(handle, 0, () => {}, () => {
    for (const [node, entry] of handle.nodes) {
      if (node.data === entry.out) node.data = entry.orig;
    }
    handle.nodes.clear();
  });
}
