// Shared package checks for app validators. Build/test-time only; nothing here ships in an extension.
// Moved verbatim from scripts/validate-doomscroll-package.mjs.
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Comment stripping good enough for the plain ES modules in this package. */
export function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

const EDGE_RE = /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?(['"])([^'"\n]+)\1/g;

export function extractStaticSpecifiers(src) {
  const out = [];
  const code = stripJsComments(src);
  for (const m of code.matchAll(EDGE_RE)) out.push(m[2]);
  return out;
}

/**
 * Walk static import/export-from edges from entry. `files` is Map<posixRelPath, string source>.
 * Returns { reachable:Set<string>, errors:string[] }.
 */
export function resolveGraph(files, entry) {
  const errors = [];
  const reachable = new Set();
  const queue = [entry];
  if (!files.has(entry)) return { reachable, errors: [`${entry}: missing entry module`] };
  while (queue.length) {
    const file = queue.shift();
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const spec of extractStaticSpecifiers(files.get(file))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('//')) { errors.push(`${file}: remote import "${spec}"`); continue; }
      if (spec.startsWith('/')) { errors.push(`${file}: absolute import "${spec}"`); continue; }
      if (!spec.startsWith('./') && !spec.startsWith('../')) { errors.push(`${file}: bare import "${spec}"`); continue; }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (target === '..' || target.startsWith('../')) { errors.push(`${file}: import "${spec}" escapes the extension root`); continue; }
      if (!files.has(target)) { errors.push(`${file}: missing import "${spec}" (${target})`); continue; }
      queue.push(target);
    }
  }
  return { reachable, errors };
}

function globToRegExp(glob) {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`);
}

/** Expand WAR resource declarations against the list of package files. */
export function expandWar(manifest, allFiles) {
  const out = new Set();
  const war = Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : [];
  for (const entry of war) {
    for (const res of Array.isArray(entry?.resources) ? entry.resources : []) {
      const clean = String(res).replace(/^\//, '');
      if (clean.includes('*')) {
        const re = globToRegExp(clean);
        for (const f of allFiles) if (re.test(f)) out.add(f);
      } else out.add(clean);
    }
  }
  return out;
}

const REMOTE = String.raw`(?:https?:)?\/\/`;
const JS_CONSTRUCTS = [
  ['remote executable URL', new RegExp(String.raw`(?:\bimport\s*\(|\bimportScripts\s*\(|\bfrom\s|\bimport\s)\s*['"\x60]${REMOTE}`)],
  ['remote executable URL', new RegExp(String.raw`\bnew\s+(?:Shared)?Worker\s*\(\s*['"\x60]${REMOTE}`)],
  ['eval', /\beval\s*\(/],
  ['new Function', /\bnew\s+Function\b/],
  ['string-valued timer', /\b(?:setTimeout|setInterval)\s*\(\s*['"`]/],
];
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const TAG_RE = /<[a-zA-Z][^>]*>/g;

export function scanSource(relPath, src) {
  const found = [];
  const add = (c) => found.push(`${relPath}: ${c}`);
  const isHtml = /\.html?$/i.test(relPath);
  if (!isHtml) {
    const code = stripJsComments(src);
    const seen = new Set();
    for (const [name, re] of JS_CONSTRUCTS) if (re.test(code) && !seen.has(name)) { seen.add(name); add(name); }
    return found;
  }
  for (const m of src.matchAll(SCRIPT_RE)) {
    const srcAttr = /\ssrc\s*=\s*["']?\s*((?:https?:)?\/\/)/i.test(m[1]);
    if (srcAttr) add('remote executable URL');
    if (m[2].trim()) add('inline script body');
  }
  for (const m of src.matchAll(TAG_RE)) {
    if (/\son[a-z]+\s*=/i.test(m[0])) { add('inline event-handler attribute'); break; }
  }
  if (/\s(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i.test(src)) add('javascript: URL');
  return found;
}

/** Recursively list files under root. Returns Map<posixRelPath, absPath>. */
export async function walk(root) {
  const out = new Map();
  async function rec(dir, prefix) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await rec(path.join(dir, e.name), rel);
      else if (e.isFile()) out.set(rel, path.join(dir, e.name));
    }
  }
  await rec(root, '');
  return out;
}
