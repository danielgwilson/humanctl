// Zero-dependency static file server for the browser fixture loop.
//
// Replaces `python3 -m http.server`: humanctl is a TypeScript/Node project and
// there is no reason to reach outside that ecosystem to serve static files.
// Runs under any Node the repo supports (node:http + node:fs only, no build,
// no deps), so it works both from the modern Node dev shell and from a
// screenshot-tool runner that may carry an older Node than Vite itself accepts.
//
// Usage: tsx scripts/serve-static.ts --dir <path> --port <n>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = resolve(process.cwd(), arg('dir', '.'));
const port = Number(arg('port', '4173'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    // Contain the path to `dir`: strip the leading slash, normalize, and reject
    // any request that escapes the served directory (../ traversal).
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(dir, rel);
    if (!filePath.startsWith(dir)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    let s = await stat(filePath).catch(() => null);
    if (s?.isDirectory()) {
      filePath = join(filePath, 'index.html');
      s = await stat(filePath).catch(() => null);
    }
    if (!s?.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, () => {
  console.log(`serving ${dir} at http://localhost:${port}`);
});
