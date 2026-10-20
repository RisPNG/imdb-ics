import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate } from 'node:timers/promises';
import { calendarChunks } from './calendar.mjs';
import { loadConfig } from './config.mjs';
import { renderPage } from './page.mjs';
import { CalendarStore } from './store.mjs';
import images from './profile-images.json' with { type: 'json' };

const assetPaths = new Map([
  ['/style.css', ['../public/style.css', 'text/css; charset=utf-8']],
  ['/enhance.js', ['../public/enhance.js', 'text/javascript; charset=utf-8']],
  ...Object.values(images).map((image) => [image.path, [`../public${image.path}`, image.path.endsWith('.svg') ? 'image/svg+xml' : image.path.endsWith('.png') ? 'image/png' : 'image/jpeg']]),
]);

export async function createApp(config, options = {}) {
  const store = options.store || new CalendarStore(config, options);
  await store.initialize();
  const assets = new Map(await Promise.all([...assetPaths].map(async ([path, [file, type]]) =>
    [path, { body: await readFile(new URL(file, import.meta.url)), type }])));
  const calendars = new WeakMap();

  const handleRequest = async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    if (config.origin.startsWith('https:')) response.setHeader('Strict-Transport-Security', 'max-age=31536000');

    function send(status, body, type = 'text/plain; charset=utf-8', headers = {}) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      response.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length, ...headers });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    }

    if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Method not allowed.\n', undefined, { Allow: 'GET, HEAD' });
    let path;
    try { path = new URL(request.url, 'http://localhost').pathname; }
    catch { return send(400, 'Invalid request URL.\n'); }
    if (path === '/healthz') return send(200, '{"status":"ok"}\n', 'application/json; charset=utf-8');
    if (path === '/readyz') {
      const ready = config.sources.every((source) => store.sourceState(source).saved?.lastSuccessAt);
      return send(ready ? 200 : 503, JSON.stringify({ status: ready ? 'ready' : 'warming' }) + '\n', 'application/json; charset=utf-8');
    }
    if (path === '/robots.txt') return send(200, 'User-agent: *\nAllow: /\n');
    const asset = assets.get(path);
    if (asset) return send(200, asset.body, asset.type, { 'Cache-Control': 'public, max-age=3600' });

    const profileRoute = /^\/(people|interests)\/([a-z-]+)(\/)?$/.exec(path);
    const source = profileRoute && config.sources.find((candidate) => candidate.slug === profileRoute[2]
      && candidate.kind === (profileRoute[1] === 'people' ? 'name' : 'interest'));
    if (profileRoute && !source) return send(404, 'Unknown calendar.\n');
    if (source && !profileRoute[3]) return send(308, '', undefined, { Location: `/${profileRoute[1]}/${source.slug}/` });
    if (path === '/' || source) {
      const baseUrl = new URL(config.baseUrl);
      const protocol = request.headers['x-forwarded-proto']?.split(',')[0].trim();
      if (protocol === 'http' || protocol === 'https') baseUrl.protocol = `${protocol}:`;
      if (request.headers.host) {
        baseUrl.port = '';
        baseUrl.host = request.headers.host;
      }
      return send(200, renderPage(store.pageData(baseUrl.origin, source?.slug || 'all')), 'text/html; charset=utf-8');
    }
    const match = /^\/calendars\/([a-z-]+)\.ics$/.exec(path);
    if (!match) return send(404, 'Not found.\n');
    const feed = store.feed(match[1]);
    if (feed === undefined) return send(404, 'Unknown calendar.\n');
    if (!feed) return send(503, 'This calendar is waiting for its first complete refresh. Please retry shortly.\n', undefined, { 'Retry-After': '60' });
    const calendar = { name: feed.label, description: feed.description, events: feed.events, eventTimeMode: config.eventTimeMode };
    let cached = calendars.get(feed.events);
    if (!cached || cached.name !== feed.label || cached.description !== feed.description) {
      cached = { name: feed.label, description: feed.description, pending: (async () => {
        const hash = createHash('sha256');
        let length = 0;
        let count = 0;
        for (const chunk of calendarChunks(calendar)) {
          hash.update(chunk);
          length += Buffer.byteLength(chunk);
          if (++count % 256 === 0) await setImmediate();
        }
        let modifiedAt = '';
        for (const event of Object.values(feed.events)) if (event.modifiedAt > modifiedAt) modifiedAt = event.modifiedAt;
        return { etag: `"${hash.digest('hex')}"`, length, lastModified: new Date(modifiedAt || feed.updatedAt).toUTCString() };
      })() };
      calendars.set(feed.events, cached);
    }
    const metadata = await cached.pending;
    const { etag, lastModified } = metadata;
    const headers = { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': 'public, max-age=300',
      'X-Calendar-Stale': String(feed.stale), 'Content-Disposition': `inline; filename="${match[1]}.ics"` };
    const condition = request.headers['if-none-match'];
    const matchesTag = condition?.split(',').some((value) => value.trim().replace(/^W\//, '') === etag || value.trim() === '*');
    const matchesTime = !condition && request.headers['if-modified-since'] &&
      Date.parse(request.headers['if-modified-since']) >= Date.parse(lastModified);
    if (matchesTag || matchesTime) {
      response.writeHead(304, headers);
      return response.end();
    }
    response.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Length': metadata.length, ...headers });
    if (request.method === 'HEAD') return response.end();
    await pipeline(Readable.from(calendarChunks(calendar), { objectMode: false }), response);
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' && request.destroyed) return;
      (options.logger || console).warn(`Calendar request failed: ${error.message}`);
      if (response.headersSent) return response.destroy();
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : 'The calendar is temporarily unavailable.\n');
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 50;
  return { server, store, async close() {
    await store.stop();
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}

async function main() {
  const config = loadConfig();
  const app = await createApp(config);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, '0.0.0.0', resolve);
  });
  console.info(`Ris' IMDb ICalendar listening on port ${config.port}.`);
  console.info(`Dashboard: ${config.baseUrl}/`);
  app.store.start();
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    await app.close();
    clearTimeout(deadline);
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Ris' IMDb ICalendar could not start: ${error.message}`);
    process.exitCode = 1;
  });
}
