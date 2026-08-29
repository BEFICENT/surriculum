'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function normalizeMount(value = '/') {
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function sendError(response, status, message) {
  const body = `${message}\n`;
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

/** Start a dependency-free local static server and return {url, close()}. */
async function startServer(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const mount = normalizeMount(options.mount || '/');
  const sockets = new Set();
  if (!fs.statSync(root).isDirectory()) throw new Error(`static server root is not a directory: ${root}`);
  const server = http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendError(response, 405, 'Method not allowed');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch (_) {
      sendError(response, 400, 'Bad request');
      return;
    }
    if (pathname === mount.slice(0, -1)) {
      response.writeHead(308, { Location: mount });
      response.end();
      return;
    }
    if (!pathname.startsWith(mount) || pathname.includes('\\') || pathname.includes('\0')) {
      sendError(response, 404, 'Not found');
      return;
    }
    const relative = pathname.slice(mount.length).replace(/^\/+/, '');
    let candidate = path.resolve(root, relative || 'index.html');
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      sendError(response, 404, 'Not found');
      return;
    }
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) candidate = path.join(candidate, 'index.html');
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) throw new Error('not a file');
      const etag = `W/\"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}\"`;
      const headers = {
        'Content-Type': MIME_TYPES[path.extname(candidate).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': options.cacheControl || 'public, max-age=300',
        'Last-Modified': stat.mtime.toUTCString(),
        ETag: etag,
        ...(options.headers || {}),
      };
      const ifNoneMatch = String(request.headers['if-none-match'] || '');
      const ifModifiedSince = Date.parse(String(request.headers['if-modified-since'] || ''));
      if (ifNoneMatch === etag
          || (Number.isFinite(ifModifiedSince) && Math.trunc(stat.mtimeMs / 1000) <= Math.trunc(ifModifiedSince / 1000))) {
        delete headers['Content-Length'];
        response.writeHead(304, headers);
        response.end();
        return;
      }
      response.writeHead(200, headers);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = fs.createReadStream(candidate);
      stream.on('error', () => {
        if (!response.headersSent) sendError(response, 500, 'Read failed');
        else response.destroy();
      });
      stream.pipe(response);
    } catch (_) {
      sendError(response, 404, 'Not found');
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const hostname = options.hostname || '127.0.0.1';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port || 0, hostname, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  let closed = false;
  return {
    root,
    mount,
    port,
    url: `http://${hostname}:${port}${mount}`,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

module.exports = { startServer };
