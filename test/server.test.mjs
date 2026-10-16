import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { text } from 'node:stream/consumers';
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
  assert.equal((await fetch(`${origin}/`)).status, 200);
  const pending = await fetch(`${origin}/calendars/all.ics`);
  assert.equal(pending.status, 503);
  assert.equal(pending.headers.get('retry-after'), '60');
  assert.equal((await fetch(`${origin}/readyz`)).status, 503);
  await store.refresh();
  const response = await fetch(`${origin}/calendars/all.ics`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/calendar/);
  assert.equal(response.headers.get('x-calendar-stale'), 'false');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
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

test('public homepage exposes all six subscriptions at the request origin', async (t) => {
  const { store, origin } = await runningApp(t, { PUBLIC_BASE_URL: 'https://calendar.example' });
  await store.refresh();
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  const subscriptionUrl = origin.replace(/^http:/, 'https:');
  for (const slug of ['all', 'marvel', 'star-wars', 'dc', 'vince-gilligan', 'justin-roiland']) {
    assert(html.includes(`value="${subscriptionUrl}/calendars/${slug}.ics"`));
    assert(html.includes(`href="${origin.replace(/^http:/, 'webcal:')}/calendars/${slug}.ics"`));
    const response = await fetch(`${origin}/calendars/${slug}.ics`);
    assert.equal(response.status, 200, slug);
    assert.match(response.headers.get('content-type'), /^text\/calendar/);
  }
  assert(!html.includes('calendar.example'));
  assert.doesNotMatch(html, /noindex|nofollow/);
  assert.equal(page.headers.get('x-robots-tag'), null);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal(page.headers.get('cache-control'), 'no-store');
  for (const path of ['/healthz', '/readyz', '/style.css', '/enhance.js']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
  }
  assert.equal(await (await fetch(`${origin}/robots.txt`)).text(), 'User-agent: *\nAllow: /\n');
  for (const path of ['/missing/', '/calendars/unknown.ics']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
  const denied = await fetch(`${origin}/`, { method: 'POST' });
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('allow'), 'GET, HEAD');
});

test('subscription links follow custom and Render hosts without changing the configured URL', async (t) => {
  const { store, origin, config } = await runningApp(t, { RENDER_EXTERNAL_URL: 'https://imdb-ics.onrender.com' });
  for (const ready of [false, true]) {
    if (ready) await store.refresh();
    for (const host of ['imdbics.rispeng.com', 'imdb-ics.onrender.com', 'imdbics.rispeng.com']) {
      const page = await new Promise((resolve, reject) => get(`${origin}/`, {
        headers: { Host: host, 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'unrelated.example' },
      }, resolve).on('error', reject));
      assert.equal(page.statusCode, 200);
      const html = await text(page);
      assert(html.includes(`rel="canonical" href="https://${host}/"`));
      for (const slug of ['all', 'marvel', 'star-wars', 'dc', 'vince-gilligan', 'justin-roiland']) {
        assert(html.includes(`value="https://${host}/calendars/${slug}.ics"`));
        assert(html.includes(`href="webcal://${host}/calendars/${slug}.ics"`));
      }
      assert(!html.includes('unrelated.example'));
      assert.equal(page.headers['cache-control'], 'no-store');
    }
  }
  assert.equal(config.baseUrl, 'https://imdb-ics.onrender.com');
  assert.equal(store.pageData().baseUrl, config.baseUrl);
});

test('subscription origins preserve request ports and the proxy protocol', async (t) => {
  const { origin } = await runningApp(t);
  for (const [headers, expected] of [
    [{}, origin],
    [{ Host: 'localhost:8080' }, 'http://localhost:8080'],
    [{ Host: '[::1]:8080' }, 'http://[::1]:8080'],
    [{ Host: 'imdbics.rispeng.com', 'X-Forwarded-Proto': 'https, http' }, 'https://imdbics.rispeng.com'],
    [{ Host: 'imdbics.rispeng.com', 'X-Forwarded-Proto': 'javascript' }, 'http://imdbics.rispeng.com'],
  ]) {
    const page = await new Promise((resolve, reject) => get(`${origin}/`, { headers }, resolve).on('error', reject));
    assert.equal(page.statusCode, 200);
    const html = await text(page);
    assert(html.includes(`rel="canonical" href="${expected}/"`));
    assert(html.includes(`value="${expected}/calendars/all.ics"`));
    assert(html.includes(`href="${expected.replace(/^https?:/, 'webcal:')}/calendars/all.ics"`));
  }
});

test('public routes work even when an old Render token is still set', async (t) => {
  const token = 'abcdefghijklmnopqrstuvwx+/==';
  const { store, origin } = await runningApp(t, { CALENDAR_TOKEN: token, RENDER_EXTERNAL_URL: 'https://release-calendar.onrender.com' });
  await store.refresh();
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(html.includes(`${origin.replace(/^http:/, 'https:')}/calendars/all.ics`));
  assert(!html.includes(encodeURIComponent(token)));
  assert.equal((await fetch(`${origin}/calendars/all.ics`)).status, 200);
  assert.equal((await fetch(`${origin}/${encodeURIComponent(token)}/`)).status, 404);
});
