// Minimal Chrome match-pattern support: <all_urls> and scheme://host/path with * wildcards.

const cache = new Map();
const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Compile a pattern to {scheme, host, path} matchers, or null if the pattern is invalid. */
export function compilePattern(pattern) {
  if (typeof pattern !== 'string') return null;
  if (cache.has(pattern)) return cache.get(pattern);
  let compiled = null;
  if (pattern === '<all_urls>') {
    compiled = { all: true };
  } else {
    const m = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern);
    if (m) {
      const [, scheme, host, path] = m;
      const hostOk = host === '*' || /^(\*\.)?[^*]+$/.test(host);
      if (hostOk) {
        let hostRe;
        if (host === '*') hostRe = /^.*$/;
        else if (host.startsWith('*.')) hostRe = new RegExp(`^(?:[^/]+\\.)?${escapeRe(host.slice(2))}$`, 'i');
        else hostRe = new RegExp(`^${escapeRe(host)}$`, 'i');
        compiled = {
          scheme,
          hostRe,
          pathRe: new RegExp(`^${escapeRe(path).replace(/\*/g, '.*')}$`),
        };
      }
    }
  }
  cache.set(pattern, compiled);
  return compiled;
}

export function isValidPattern(pattern) {
  return compilePattern(pattern) !== null;
}

/** True if url matches any of the patterns. Bad URLs/patterns never match. */
export function matchUrl(patterns, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const scheme = u.protocol.replace(':', '');
  const target = u.pathname + u.search;
  for (const p of patterns) {
    const c = compilePattern(p);
    if (!c) continue;
    if (c.all) {
      if (['http', 'https', 'file', 'ftp'].includes(scheme)) return true;
      continue;
    }
    const schemeOk = c.scheme === '*' ? scheme === 'http' || scheme === 'https' : c.scheme === scheme;
    if (schemeOk && c.hostRe.test(u.hostname) && c.pathRe.test(target)) return true;
  }
  return false;
}
