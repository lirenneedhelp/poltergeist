// Static, read-only server for the Haunt Playground in demo-site/.
// Chrome refuses ES module scripts on file:// pages, so the Playground needs an HTTP origin.
// Binds 127.0.0.1, answers GET and HEAD only, serves files inside the root only, never lists
// directories. Node built-ins only; nothing here ships in an extension.
import { createServer } from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEMO_SITE = path.resolve(SCRIPTS_DIR, '..', 'demo-site');

export const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const FALLBACK_TYPE = 'application/octet-stream';

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Maps a request URL to a file path inside root, or null when the path is malformed,
 * escapes root, or does not name a regular file.
 */
export async function resolveRequestPath(root, requestUrl) {
  const rawPath = String(requestUrl || '/').split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const target = path.resolve(root, relative);
  if (!isInside(root, target)) return null;
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) return null;
    // Symlinks must not lead outside root either.
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
    if (!isInside(realRoot, realTarget)) return null;
  } catch {
    return null;
  }
  return target;
}

function sendStatus(res, status, extraHeaders = {}) {
  const body = `${status}\n`;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

/** Static, read-only server for demo-site/. Binds 127.0.0.1. GET and HEAD only. */
export function startServer({ root = DEMO_SITE, port = 8080, host = '127.0.0.1' } = {}) {
  const resolvedRoot = path.resolve(root);
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendStatus(res, 405, { Allow: 'GET, HEAD' });
      return;
    }
    const file = await resolveRequestPath(resolvedRoot, req.url);
    if (!file) {
      sendStatus(res, 404);
      return;
    }
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      sendStatus(res, 404);
      return;
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] || FALLBACK_TYPE,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      const url = `http://${host}:${address.port}/`;
      const close = () => new Promise((done, fail) => {
        server.close((err) => (err ? fail(err) : done()));
        server.closeAllConnections?.();
      });
      resolve({ url, close });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(
    ({ url }) => { console.log(`Haunt Playground: ${url} (Ctrl+C to stop)`); },
    (e) => { console.error(e.message || e); process.exitCode = 1; },
  );
}
