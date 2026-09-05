import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = path.join(projectRoot, 'demo', 'test-fixtures', 'conversations.json');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const port = Number(process.env.CHATDECK_DEMO_PORT || 4173);

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function safeProjectPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.replace(/^\/+/, '') || 'demo/playwright/test-page.html');
  const candidate = path.resolve(projectRoot, decoded);
  if (candidate !== projectRoot && !candidate.startsWith(`${projectRoot}${path.sep}`)) return null;
  return candidate;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/api/auth/session') {
    sendJson(res, 200, { accessToken: 'chatdeck-demo-token' });
    return;
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/backend-api/conversations') {
    const offset = Math.max(0, Number(requestUrl.searchParams.get('offset') || 0));
    const limit = Math.max(1, Math.min(100, Number(requestUrl.searchParams.get('limit') || 24)));
    sendJson(res, 200, {
      items: fixture.items.slice(offset, offset + limit),
      total: fixture.items.length,
    });
    return;
  }

  const detailMatch = pathname.match(/^\/backend-api\/conversation\/([^/]+)$/);
  if (detailMatch && req.method === 'GET') {
    const id = decodeURIComponent(detailMatch[1]);
    const detail = fixture.details[id];
    if (!detail) {
      sendJson(res, 404, { error: 'demo conversation not found' });
      return;
    }
    sendJson(res, 200, detail);
    return;
  }

  if (detailMatch && req.method === 'PATCH') {
    sendJson(res, 200, { ok: true, demo: true });
    return;
  }

  const filePath = safeProjectPath(pathname);
  if (!filePath) {
    sendJson(res, 403, { error: 'path outside demo project' });
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    const type = mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (error) {
    sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: 'demo asset unavailable' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`ChatDeck isolated demo server: http://127.0.0.1:${port}/demo/playwright/test-page.html`);
  console.log(`Synthetic conversations: ${fixture.items.length}; real ChatGPT endpoints are not contacted.`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
