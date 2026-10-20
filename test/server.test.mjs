import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { createHash } from 'node:crypto';
import { buffer, text } from 'node:stream/consumers';
import { gunzipSync } from 'node:zlib';
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
  const response = await fetch(`${origin}/calendars/all.ics`, { headers: { 'Accept-Encoding': 'identity' } });
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
  const conditional = await fetch(`${origin}/calendars/all.ics`, { headers: { 'Accept-Encoding': 'identity', 'If-None-Match': `W/${etag}` } });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), '');
  const head = await fetch(`${origin}/calendars/all.ics`, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(head.headers.get('etag'), etag);
  assert.equal(await head.text(), '');
  await store.refresh();
  assert.equal((await fetch(`${origin}/calendars/all.ics`, { headers: { 'Accept-Encoding': 'identity' } })).headers.get('etag'), etag, 'unchanged daily refresh is byte-identical');
  assert.equal((await fetch(`${origin}/readyz`)).status, 200);
});

test('calendar gzip transfers decode to the identity bytes and keep variant-aware HEAD and conditional responses', async (t) => {
  const { store, origin } = await runningApp(t);
  await store.refresh();
  const url = `${origin}/calendars/all.ics`;
  const identity = await new Promise((resolve, reject) => get(url, resolve).on('error', reject));
  const original = await buffer(identity);
  const etag = `"${createHash('sha256').update(original).digest('hex')}"`;
  assert.equal(identity.statusCode, 200);
  assert.equal(identity.headers.etag, etag);
  assert.equal(identity.headers['content-encoding'], undefined);
  assert.equal(identity.headers['content-length'], String(original.length));
  assert.equal(identity.headers.vary, 'Accept-Encoding');

  const gzip = await new Promise((resolve, reject) => get(url, {
    headers: { 'Accept-Encoding': 'gzip, deflate, br', 'If-None-Match': etag },
  }, resolve).on('error', reject));
  const compressed = await buffer(gzip);
  const gzipTag = `W/${etag.slice(0, -1)}-gzip"`;
  assert.equal(gzip.statusCode, 200, 'An old identity validator does not skip the first compressed transfer.');
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal(gzip.headers['content-length'], undefined);
  assert.equal(gzip.headers['transfer-encoding'], 'chunked');
  assert.equal(gzip.headers.vary, 'Accept-Encoding');
  assert.equal(gzip.headers.etag, gzipTag);
  assert(compressed.length < original.length);
  assert.deepEqual(gunzipSync(compressed), original);

  const head = await fetch(url, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('etag'), gzipTag);
  assert.equal(head.headers.get('content-encoding'), 'gzip');
  assert.equal(head.headers.get('content-length'), null);
  assert.equal(head.headers.get('vary'), 'Accept-Encoding');
  assert.equal(await head.text(), '');

  for (const [method, condition] of [
    ['GET', { 'If-None-Match': gzipTag }],
    ['HEAD', { 'If-None-Match': `"old", ${gzipTag.slice(2)}` }],
    ['GET', { 'If-None-Match': '*' }],
    ['GET', { 'If-Modified-Since': gzip.headers['last-modified'] }],
  ]) {
    const response = await fetch(url, { method, headers: { 'Accept-Encoding': 'gzip', ...condition } });
    assert.equal(response.status, 304);
    assert.equal(response.headers.get('etag'), gzipTag);
    assert.equal(response.headers.get('vary'), 'Accept-Encoding');
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(response.headers.get('content-length'), null);
    assert.equal(await response.text(), '');
  }
  const precedence = await fetch(url, { headers: {
    'Accept-Encoding': 'gzip', 'If-None-Match': '"old"', 'If-Modified-Since': 'Fri, 01 Jan 2100 00:00:00 GMT',
  } });
  assert.equal(precedence.status, 200);
  assert.equal(await precedence.text(), original.toString());
  const switched = await fetch(url, { headers: { 'Accept-Encoding': 'identity', 'If-None-Match': gzipTag } });
  assert.equal(switched.status, 200);
  assert.equal(switched.headers.get('etag'), etag);
  assert.equal(await switched.text(), original.toString());
});

test('calendar encoding negotiation respects explicit exclusions, quality values, and wildcard preferences', async (t) => {
  const { store, origin } = await runningApp(t);
  await store.refresh();
  for (const [accept, encoding, status = 200] of [
    ['', null], ['identity', null], ['br', null], ['gzip;q=0', null],
    ['gzip', 'gzip'], ['GZIP;Q=1', 'gzip'], ['*', 'gzip'],
    ['gzip;q=0, *;q=1', null], ['*;q=0, gzip;q=0.5', 'gzip'],
    ['gzip;q=0.5, identity;q=0.2', 'gzip'], ['gzip;q=0.2, identity;q=0.5', null],
    ['gzip;q=0, *;q=0, identity;q=1', null], ['*;q=1, identity;q=0', 'gzip'],
    ['gzip;q=0, identity;q=0', null, 406], ['*;q=0', null, 406], ['br, identity;q=0', null, 406],
  ]) {
    const response = await fetch(`${origin}/calendars/all.ics`, { method: 'HEAD', headers: { 'Accept-Encoding': accept } });
    assert.equal(response.status, status, accept);
    assert.equal(response.headers.get('content-encoding'), encoding, accept);
    assert.equal(response.headers.get('vary'), 'Accept-Encoding', accept);
    assert.equal(await response.text(), '');
  }
});

test('disconnecting during a gzip calendar stream leaves later requests healthy', async (t) => {
  const warnings = [];
  const titles = Array.from({ length: 2000 }, (_, index) => ({
    id: `tt${1234567 + index}`, title: `A release ${createHash('sha256').update(String(index)).digest('hex')}`, date: '2026-11-19',
  }));
  const { store, origin } = await runningApp(t, {}, {
    logger: { info() {}, warn(message) { warnings.push(message); } },
    loader: async (source) => ({ titles: source === SOURCES[0] ? titles : [], total: source === SOURCES[0] ? titles.length : 0, omitted: 0, warnings: [] }),
  });
  await store.refresh();
  const interrupted = await new Promise((resolve, reject) => get(`${origin}/calendars/all.ics`, {
    headers: { 'Accept-Encoding': 'gzip' },
  }, (response) => {
    response.once('error', reject);
    response.once('data', () => response.destroy());
    response.once('close', () => resolve(response));
  }).on('error', reject));
  assert.equal(interrupted.headers['content-encoding'], 'gzip');
  assert.equal(interrupted.complete, false);
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  const recovered = await fetch(`${origin}/calendars/all.ics`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(recovered.status, 200);
  const body = await recovered.text();
  assert.equal(body.match(/BEGIN:VEVENT/g).length, titles.length);
  assert(body.endsWith('END:VCALENDAR\r\n'));
  assert.deepEqual(warnings, []);
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
  assert.match(body, /DESCRIPTION:Interests: DC\\, Marvel\\, Star Wars\\nPeople: /);
  assert.match(body, /\\n\\nS01E01: The beginning\\nS01E02: A second\\, unexpected\\; chapter\r\n/);
  assert.match(body, /\\n\\nS01E03: Next week\r\n/);
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
  assert.match(updated, /\\n\\nS01E01: The beginning\\nS01E02: A revised chapter\r\n/);
  assert.equal(store.feed('all').events[series.id].sequence, 1);
  assert.equal(store.feed('all').events[`${series.id}-2026-11-26`].sequence, 0);
});

test('subscribe-all lists matching interests and people once while retaining single, batch, and premiere episode details', async (t) => {
  let clock = new Date('2026-10-19T00:00:00Z');
  const movie = { id: 'tt1234567', title: 'A shared movie', date: '2026-11-18' };
  const parent = { id: 'tt3456789', title: 'A series', date: '2026-11-19', type: 'tvSeries' };
  const premiere = { id: 'tt4567890', title: 'The beginning', date: parent.date, type: 'tvEpisode',
    series: { id: parent.id, title: parent.title, date: parent.date, season: 1, episode: 1 } };
  const first = { ...premiere, id: 'tt5678901', title: 'A second chapter', date: '2026-11-26', series: { ...premiere.series, episode: 2 } };
  const second = { ...first, id: 'tt6789012', title: 'A third chapter', series: { ...premiere.series, episode: 3 } };
  const single = { ...first, id: 'tt7890123', title: 'Next week', date: '2026-12-03', series: { ...premiere.series, episode: 4 } };
  const expanded = { ...parent, episodes: [premiere, first, second, single] };
  const data = {
    marvel: [movie, expanded], 'star-wars': [movie, expanded],
    'vince-gilligan': [movie, parent, premiere, first], 'justin-roiland': [movie, second, single],
  };
  const { store, origin } = await runningApp(t, {}, { clock: () => clock,
    loader: async (source) => ({ titles: data[source.slug] ?? [], total: data[source.slug]?.length ?? 0, omitted: 0, warnings: [] }),
  });
  await store.refresh();
  const response = await fetch(`${origin}/calendars/all.ics`);
  const etag = response.headers.get('etag');
  const calendar = (await response.text()).replace(/\r\n /g, '');
  const events = calendar.split('BEGIN:VEVENT\r\n').slice(1);
  assert.equal(events.length, 4);
  const movieEvent = events.find((event) => event.startsWith(`UID:${movie.id}@`));
  assert.match(movieEvent, /DESCRIPTION:Interests: Marvel\\, Star Wars\\nPeople: Justin Roiland\\, Vince Gilligan\r\n/);
  const premiereEvent = events.find((event) => event.startsWith(`UID:${parent.id}@`));
  assert.match(premiereEvent, /DESCRIPTION:Interests: Marvel\\, Star Wars\\nPeople: Vince Gilligan\\n\\nS01E01: The beginning\r\n/);
  const batchEvent = events.find((event) => event.startsWith(`UID:${parent.id}-${first.date}@`));
  assert.match(batchEvent, /DESCRIPTION:Interests: Marvel\\, Star Wars\\nPeople: Justin Roiland\\, Vince Gilligan\\n\\nS01E02: A second chapter\\nS01E03: A third chapter\r\n/);
  const singleEvent = events.find((event) => event.startsWith(`UID:${parent.id}-${single.date}@`));
  assert.match(singleEvent, /DESCRIPTION:Interests: Marvel\\, Star Wars\\nPeople: Justin Roiland\\n\\nS01E04: Next week\r\n/);
  for (const event of events) {
    const description = event.match(/^DESCRIPTION:(.*)$/m)?.[1];
    for (const label of ['Marvel', 'Star Wars', 'Justin Roiland', 'Vince Gilligan']) {
      assert((description.match(new RegExp(label, 'g')) ?? []).length <= 1);
    }
  }
  await store.refresh();
  assert.equal((await fetch(`${origin}/calendars/all.ics`, { headers: { 'If-None-Match': etag } })).status, 304);
  data['vince-gilligan'] = [];
  clock = new Date('2026-10-20T00:00:00Z');
  await store.refresh();
  const changed = await fetch(`${origin}/calendars/all.ics`, { headers: { 'If-None-Match': etag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get('etag'), etag);
  assert.equal((await changed.text()).match(/BEGIN:VEVENT/g).length, 4);
  assert.equal(store.feed('all').events[movie.id].sequence, 1);
  assert.equal(store.feed('all').events[`${parent.id}-${single.date}`].sequence, 0);
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
  const policy = page.headers.get('content-security-policy');
  for (const directive of ["default-src 'none'", "frame-ancestors 'none'", "script-src 'self'", "img-src 'self'"]) {
    assert(policy.includes(directive), directive);
  }
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert(!policy.includes('unsafe-inline'));
  assert.equal(page.headers.get('cache-control'), 'no-store');
  for (const path of ['/healthz', '/readyz', '/style.css', '/enhance.js']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
  }
  assert.equal(await (await fetch(`${origin}/robots.txt`)).text(), 'User-agent: *\nAllow: /\n');
  for (const path of ['/missing/', '/calendars/unknown.ics', '/profiles.json', '/profile-images.json', '/images/missing.jpg']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
  const denied = await fetch(`${origin}/`, { method: 'POST' });
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('allow'), 'GET, HEAD');
});

test('all source pages have canonical routes, local images, and one source subscription', async (t) => {
  const { origin } = await runningApp(t);
  for (const source of SOURCES) {
    const group = source.kind === 'name' ? 'people' : 'interests';
    const path = `/${group}/${source.slug}/`;
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert(html.includes(`rel="canonical" href="${origin}${path}"`), path);
    assert.equal((html.match(/<input\b[^>]*type="url"/g) || []).length, 1, path);
    assert(html.includes(`value="${origin}/calendars/${source.slug}.ics"`), path);
    const imagePath = html.match(/<img\b[^>]*\bsrc="(\/images\/[^"]+)"/)?.[1];
    assert(imagePath, `Missing local image on ${path}.`);
    const image = await fetch(`${origin}${imagePath}`);
    assert.equal(image.status, 200, imagePath);
    assert.equal(image.headers.get('content-type')?.split(';')[0], imagePath.endsWith('.png') ? 'image/png' : imagePath.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert(Number(image.headers.get('content-length')) > 0);
    const redirect = await fetch(`${origin}${path.slice(0, -1)}`, { redirect: 'manual' });
    assert.equal(redirect.status, 308, path);
    assert.equal(redirect.headers.get('location'), path);
  }
  for (const path of ['/people/marvel/', '/interests/keanu-reeves/', '/people/unknown/', '/interests/unknown/', '/people/', '/interests/', '/images/../src/config.mjs']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
  const head = await fetch(`${origin}/people/keanu-reeves/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert(Number(head.headers.get('content-length')) > 0);
  assert.equal(await head.text(), '');
});

test('source pages select their releases before limiting the combined upcoming list', async (t) => {
  const person = SOURCES.at(-1);
  const interest = SOURCES[0];
  const personTitle = 'A directly credited person release';
  const interestTitle = 'A separate interest release';
  const { store, origin } = await runningApp(t, {}, {
    clock: () => new Date('2026-10-17T00:00:00Z'),
    loader: async (source) => ({
      titles: source.slug === person.slug ? [{ id: 'tt1234567', title: personTitle, date: '2026-12-31' }]
        : source.slug === interest.slug ? Array.from({ length: 13 }, (_, index) => ({
          id: `tt${2345678 + index}`, title: `${interestTitle} ${index + 1}`, date: `2026-11-${String(index + 1).padStart(2, '0')}`,
        })) : [],
      total: 1, omitted: 0, warnings: [],
    }),
  });
  await store.refresh();
  const homepage = await (await fetch(origin)).text();
  assert(!homepage.includes(personTitle), 'The combined list is already filled by earlier interest releases.');
  assert(homepage.includes(interestTitle));
  const personPage = await (await fetch(`${origin}/people/${person.slug}/`)).text();
  assert(personPage.includes(personTitle));
  assert(!personPage.includes(interestTitle));
  const interestPage = await (await fetch(`${origin}/interests/${interest.slug}/`)).text();
  assert(interestPage.includes(interestTitle));
  assert(!interestPage.includes(personTitle));
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
    for (const [path, slug] of [['/', 'all'], ['/people/keanu-reeves/', 'keanu-reeves'], ['/interests/marvel/', 'marvel']]) {
      const page = await new Promise((resolve, reject) => get(`${origin}${path}`, { headers }, resolve).on('error', reject));
      assert.equal(page.statusCode, 200);
      const html = await text(page);
      assert(html.includes(`rel="canonical" href="${expected}${path}"`));
      assert(html.includes(`value="${expected}/calendars/${slug}.ics"`));
      assert(html.includes(`href="${expected.replace(/^https?:/, 'webcal:')}/calendars/${slug}.ics"`));
    }
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
