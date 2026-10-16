import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.mjs';
import { loadConfig } from '../src/config.mjs';

async function runningApp(t, env = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'release-calendar-server-test-'));
  const config = loadConfig({ DATA_DIR: dataDir, ...env });
  const app = await createApp(config, { logger: { info() {}, warn() {} }, loader: async () => ({
    titles: [{ id: 'tt1234567', title: 'A title, with punctuation', date: '2026-11-19' }], total: 1, omitted: 0, warnings: [],
  }) });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { ...app, config, origin };
}

test('cold feeds return retryable 503, then cached all-day calendars support ETags and HEAD', async (t) => {
  const { store, origin } = await runningApp(t);
  const pending = await fetch(`${origin}/calendars/all.ics`);
  assert.equal(pending.status, 503);
  assert.equal(pending.headers.get('retry-after'), '60');
  assert.equal((await fetch(`${origin}/readyz`)).status, 503);
  await store.refresh();
  const response = await fetch(`${origin}/calendars/all.ics`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/calendar/);
  assert.equal(response.headers.get('x-calendar-stale'), 'false');
  const body = await response.text();
  assert.equal(body.match(/BEGIN:VEVENT/g).length, 1);
  assert.match(body, /DTSTART;VALUE=DATE:20261119\r\n/);
  assert.match(body, /DTEND;VALUE=DATE:20261120\r\n/);
  assert(!body.includes('DTSTART:20261119T000000Z'), 'release dates do not become midnight timestamps');
  assert.match(body, /SUMMARY:A title\\, with punctuation/);
  const etag = response.headers.get('etag');
  const conditional = await fetch(`${origin}/calendars/all.ics`, { headers: { 'If-None-Match': `W/${etag}` } });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), '');
  const head = await fetch(`${origin}/calendars/all.ics`, { method: 'HEAD' });
  assert.equal(head.headers.get('etag'), etag);
  assert.equal(await head.text(), '');
  await store.refresh();
  assert.equal((await fetch(`${origin}/calendars/all.ics`)).headers.get('etag'), etag, 'unchanged daily refresh is byte-identical');
  assert.equal((await fetch(`${origin}/readyz`)).status, 200);
});

test('private dashboard and feeds stay behind token paths; assets and health expose no token', async (t) => {
  const token = 'private-test-key-that-stays-secret';
  const { store, origin } = await runningApp(t, { CALENDAR_TOKEN: token, PUBLIC_BASE_URL: 'https://calendar.example' });
  await store.refresh();
  for (const path of ['/', '/calendars/all.ics', '/wrong-key/', `/${token}-extra/`, `/${token}/calendars/unknown.ics`]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    assert(!(await response.text()).includes(token));
  }
  const page = await fetch(`${origin}/${token}/`, { headers: { Host: 'attacker.example' } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(html.includes(`https://calendar.example/${token}/calendars/all.ics`));
  assert(!html.includes('attacker.example'));
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${origin}/${token}/calendars/marvel.ics`)).status, 200);
  for (const path of ['/healthz', '/robots.txt', '/style.css', '/enhance.js']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    assert(!(await response.text()).includes(token));
  }
  const denied = await fetch(`${origin}/${token}/`, { method: 'POST' });
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('allow'), 'GET, HEAD');
});

test('Render base64 secrets work through encoded dashboard and feed URLs', async (t) => {
  const token = 'abcdefghijklmnopqrstuvwx+/==';
  const { store, origin, config } = await runningApp(t, { CALENDAR_TOKEN: token });
  await store.refresh();
  assert.equal((await fetch(`${origin}${config.prefix}/`)).status, 200);
  assert.equal((await fetch(`${origin}${config.prefix}/calendars/all.ics`)).status, 200);
});
