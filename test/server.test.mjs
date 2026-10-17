import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { text } from 'node:stream/consumers';
import { createApp } from '../src/server.mjs';
import { loadConfig, SOURCES } from '../src/config.mjs';
import { CalendarStore } from '../src/store.mjs';

const feedSlugs = ['all', ...SOURCES.map((source) => source.slug)];

async function runningApp(t, env = {}, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'release-calendar-server-test-'));
  const config = loadConfig({ DATA_DIR: dataDir, ...env });
  const app = await createApp(config, { logger: { info() {}, warn() {} }, loader: async () => ({
    titles: [{ id: 'tt1234567', title: 'A title, with punctuation', date: '2026-11-19' }], total: 1, omitted: 0, warnings: [],
  }), ...options });
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

test('saved combined feeds remain available while new sources warm up and readiness waits for them', async (t) => {
  let failing = true;
  const missing = SOURCES.at(-1);
  const existingTitle = { id: 'tt1234567', title: 'An existing release', date: '2026-11-19' };
  const addedTitle = { id: 'tt2345678', title: 'A newly followed release', date: '2026-11-20' };
  const { store, origin, config } = await runningApp(t, {}, {
    loader: async (source) => {
      if (failing && source.slug === missing.slug) throw new Error('HTTP 503');
      return { titles: [source.slug === SOURCES[1].slug ? addedTitle : existingTitle], total: 1, omitted: 0, warnings: [] };
    },
  });
  const original = new CalendarStore({ ...config, sources: config.sources.slice(0, 1) }, {
    loader: store.loader, logger: { info() {}, warn() {} },
  });
  await original.initialize();
  await original.refresh();
  await store.initialize();

  const saved = await fetch(`${origin}/calendars/all.ics`);
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('x-calendar-stale'), 'true');
  assert.match(await saved.text(), /SUMMARY:An existing release\r\n/);
  assert.equal((await fetch(`${origin}/readyz`)).status, 503);

  await store.refresh();
  const warming = await fetch(`${origin}/calendars/all.ics`);
  assert.equal(warming.status, 200);
  assert.equal(warming.headers.get('x-calendar-stale'), 'true');
  const body = await warming.text();
  assert.match(body, /SUMMARY:An existing release\r\n/);
  assert.match(body, /SUMMARY:A newly followed release\r\n/);
  assert.equal((await fetch(`${origin}/readyz`)).status, 503);
  assert.equal((await fetch(`${origin}/calendars/${missing.slug}.ics`)).status, 503);

  failing = false;
  await store.refresh();
  const ready = await fetch(`${origin}/calendars/all.ics`);
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get('x-calendar-stale'), 'false');
  await ready.text();
  assert.equal((await fetch(`${origin}/readyz`)).status, 200);
  assert.equal((await fetch(`${origin}/calendars/${missing.slug}.ics`)).status, 200);
});

test('episode descriptions retain series titles and links and invalidate cached feeds when an episode title changes', async (t) => {
  let clock = new Date('2026-10-17T00:00:00Z');
  const series = {
    id: 'tt3456789', title: 'A series', date: '2026-11-19', type: 'tvSeries',
    episodes: [
      { id: 'tt4567890', title: 'The beginning', date: '2026-11-19', type: 'tvEpisode',
        series: { id: 'tt3456789', title: 'A series', season: 1, episode: 1 } },
      { id: 'tt5678901', title: 'A second, unexpected; chapter', date: '2026-11-19', type: 'tvEpisode',
        series: { id: 'tt3456789', title: 'A series', season: 1, episode: 2 } },
      { id: 'tt6789012', title: 'Next week', date: '2026-11-26', type: 'tvEpisode',
        series: { id: 'tt3456789', title: 'A series', season: 1, episode: 3 } },
    ],
  };
  const { store, origin } = await runningApp(t, {}, {
    clock: () => clock,
    loader: async () => ({ titles: [series], total: 1, omitted: 0, warnings: [] }),
  });
  await store.refresh();
  const first = await fetch(`${origin}/calendars/all.ics`);
  const etag = first.headers.get('etag');
  const body = (await first.text()).replace(/\r\n /g, '');
  assert.equal(body.match(/BEGIN:VEVENT/g).length, 2);
  assert.equal(body.match(/SUMMARY:A series\r\n/g).length, 2);
  assert.match(body, /UID:tt3456789@release-calendar\r\n/);
  assert.match(body, /UID:tt3456789-2026-11-26@release-calendar\r\n/);
  assert.match(body, /DESCRIPTION:S01E01: The beginning\\nS01E02: A second\\, unexpected\\; chapter\r\n/);
  assert.match(body, /DESCRIPTION:S01E03: Next week\r\n/);
  assert.equal(body.match(/URL:https:\/\/www.imdb.com\/title\/tt3456789\/\r\n/g).length, 2);
  const sourceFeed = await fetch(`${origin}/calendars/marvel.ics`);
  assert.match((await sourceFeed.text()).replace(/\r\n /g, ''), /DESCRIPTION:S01E03: Next week\r\n/);

  clock = new Date('2026-10-18T00:00:00Z');
  await store.refresh();
  const unchanged = await fetch(`${origin}/calendars/all.ics`, { headers: { 'If-None-Match': etag } });
  assert.equal(unchanged.status, 304);
  await unchanged.text();
  series.episodes[1].title = 'A revised chapter';
  clock = new Date('2026-10-19T00:00:00Z');
  await store.refresh();
  const changed = await fetch(`${origin}/calendars/all.ics`, { headers: { 'If-None-Match': etag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get('etag'), etag);
  assert.equal(changed.headers.get('last-modified'), clock.toUTCString());
  const updated = (await changed.text()).replace(/\r\n /g, '');
  assert.match(updated, /DESCRIPTION:S01E01: The beginning\\nS01E02: A revised chapter\r\n/);
  assert.equal(store.feed('all').events[series.id].sequence, 1);
  assert.equal(store.feed('all').events[`${series.id}-2026-11-26`].sequence, 0);
});

test('public homepage exposes every configured subscription at the request origin', async (t) => {
  const { store, origin } = await runningApp(t, { PUBLIC_BASE_URL: 'https://calendar.example' });
  await store.refresh();
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  const subscriptionUrl = origin.replace(/^http:/, 'https:');
  assert.equal((html.match(/<input[^>]*type="url"/g) || []).length, feedSlugs.length);
  for (const slug of feedSlugs) {
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
  for (const path of ['/healthz', '/readyz', '/style.css']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
  }
  assert.equal(await (await fetch(`${origin}/robots.txt`)).text(), 'User-agent: *\nAllow: /\n');
  for (const path of ['/missing/', '/calendars/unknown.ics', '/enhance.js']) {
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
      for (const slug of feedSlugs) {
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
