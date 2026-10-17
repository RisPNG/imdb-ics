import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSource, ImdbError } from '../src/imdb.mjs';

const marvel = { id: 'in0000248', kind: 'interest', label: 'Marvel' };
const person = { id: 'nm0319213', kind: 'name', label: 'Vince Gilligan' };
const title = (id, text, date = { year: 2026, month: 12, day: 18 }, type = 'movie', series) => ({
  node: { title: { id, titleText: { text }, releaseDate: date, titleType: { id: type }, ...(series ? { series } : {}) } },
});
const page = (edges, total = edges.length, hasNextPage = false, endCursor = null, extensions) => ({
  data: { advancedTitleSearch: { total, edges, pageInfo: { hasNextPage, endCursor } } },
  ...(extensions ? { extensions } : {}),
});
const json = (payload) => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
const episode = (id, text, season, number, date = { year: 2025, month: 4, day: 22 }) => ({
  node: { id, titleText: { text }, releaseDate: date, series: { episodeNumber: { seasonNumber: season, episodeNumber: number } } },
});
const episodesPage = (edges, total = edges.length, hasNextPage = false, endCursor = null, extensions) => ({
  data: { title: { episodes: { episodes: { total, edges, pageInfo: { hasNextPage, endCursor } } } } },
  ...(extensions ? { extensions } : {}),
});

test('collects every page, follows opaque cursors, and deduplicates overlapping titles', async () => {
  const requests = [];
  const first = title('tt21357150', 'Avengers: Doomsday');
  const responses = [
    page([first, title('tt4154796', 'Avengers: Endgame', { year: 2019, month: 4, day: 26 })], 3, true, 'opaque "cursor" \\ value'),
    page([first, title('tt22084616', 'Spider-Man: Brand New Day', null)], 3),
  ];
  const result = await fetchSource(marvel, {
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options });
      return json(responses.shift());
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://api.graphql.imdb.com/');
  assert.equal(requests[0].headers['x-imdb-client-name'], 'imdb-web-next');
  assert.match(JSON.parse(requests[0].body).query, /allInterestIds: \["in0000248"\]/);
  assert.ok(JSON.parse(requests[1].body).query.includes(`after: ${JSON.stringify('opaque "cursor" \\ value')}`));
  assert.equal(result.total, 3);
  assert.equal(result.omitted, 1);
  assert.deepEqual(result.titles, [
    { id: 'tt21357150', title: 'Avengers: Doomsday', date: '2026-12-18', type: 'movie' },
    { id: 'tt4154796', title: 'Avengers: Endgame', date: '2019-04-26', type: 'movie' },
    { id: 'tt22084616', title: 'Spider-Man: Brand New Day', date: null, type: 'movie' },
  ]);
});

test('uses directly credited titles for a person', async () => {
  let query;
  const result = await fetchSource(person, {
    fetchImpl: async (_url, options) => {
      query = JSON.parse(options.body).query;
      return json(page([title('tt0903747', 'Breaking Bad', { year: 2008, month: 1, day: 20 })]));
    },
  });
  assert.match(query, /titleCreditsConstraint: \{anyCredits: \[\{nameId: "nm0319213"\}\]\}/);
  assert.equal(result.titles[0].date, '2008-01-20');
});

test('expands a series with single and batch episode release dates without changing its source counts', async () => {
  const responses = [
    page([title('tt9253284', 'Andor', { year: 2022, month: 9, day: 21 }, 'tvSeries')]),
    episodesPage([
      episode('tt20258964', 'One Year Later', 2, 1),
      episode('tt20603288', 'Sagrona Teema', 2, 2),
      episode('tt20603292', 'Harvest', 2, 3),
      episode('tt15939206', 'Ever Been to Ghorman?', 2, 4, { year: 2025, month: 4, day: 29 }),
      episode('tt15939208', 'Upcoming', 2, 5, { year: 2025, month: 5 }),
    ]),
  ];
  const queries = [];
  const result = await fetchSource(marvel, {
    fetchImpl: async (_url, options) => {
      queries.push(JSON.parse(options.body).query);
      return json(responses.shift());
    },
  });
  assert.match(queries[0], /titleType \{ id \}/);
  assert.match(queries[1], /title\(id: "tt9253284"\)/);
  assert.match(queries[1], /episodes\(first: 100\)/);
  assert.equal(result.total, 1);
  assert.equal(result.omitted, 0);
  assert.deepEqual(result.titles[0], {
    id: 'tt9253284', title: 'Andor', date: '2022-09-21', type: 'tvSeries',
    episodes: [
      { id: 'tt20258964', title: 'One Year Later', date: '2025-04-22', type: 'tvEpisode', series: { id: 'tt9253284', title: 'Andor', date: '2022-09-21', season: 2, episode: 1 } },
      { id: 'tt20603288', title: 'Sagrona Teema', date: '2025-04-22', type: 'tvEpisode', series: { id: 'tt9253284', title: 'Andor', date: '2022-09-21', season: 2, episode: 2 } },
      { id: 'tt20603292', title: 'Harvest', date: '2025-04-22', type: 'tvEpisode', series: { id: 'tt9253284', title: 'Andor', date: '2022-09-21', season: 2, episode: 3 } },
      { id: 'tt15939206', title: 'Ever Been to Ghorman?', date: '2025-04-29', type: 'tvEpisode', series: { id: 'tt9253284', title: 'Andor', date: '2022-09-21', season: 2, episode: 4 } },
      { id: 'tt15939208', title: 'Upcoming', date: null, type: 'tvEpisode', series: { id: 'tt9253284', title: 'Andor', date: '2022-09-21', season: 2, episode: 5 } },
    ],
  });
});

test('paginates miniseries episodes, deduplicates overlaps, and retains nullable numbering', async () => {
  const first = episode('tt10161316', 'Filmed Before a Live Studio Audience', 1, 1, { year: 2021, month: 1, day: 15 });
  const responses = [
    page([title('tt9140560', 'WandaVision', null, 'tvMiniSeries')]),
    episodesPage([first], 3, true, 'opaque episode "cursor"'),
    episodesPage([first, episode('tt10161318', 'Do Not Touch That Dial', 1, 2, { year: 2021, month: 1, day: 15 }), episode('tt10161320', 'Upcoming', null, null, null)], 3),
  ];
  const queries = [];
  const result = await fetchSource(marvel, {
    fetchImpl: async (_url, options) => {
      queries.push(JSON.parse(options.body).query);
      return json(responses.shift());
    },
  });
  assert.equal(queries.length, 3);
  assert.ok(queries[2].includes(`after: ${JSON.stringify('opaque episode "cursor"')}`));
  assert.equal(result.omitted, 1);
  assert.equal(result.titles[0].episodes.length, 3);
  assert.deepEqual(result.titles[0].episodes[2].series, { id: 'tt9140560', title: 'WandaVision', date: null, season: null, episode: null });
  assert.equal(result.titles[0].episodes[2].date, null);
});

test('retains parent series metadata on directly matched episodes without expanding unrelated episodes', async () => {
  let calls = 0;
  const result = await fetchSource(person, {
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.match(JSON.parse(options.body).query, /series \{ series \{ id titleText \{ text \} releaseDate \{ year month day \} \} episodeNumber/);
      return json(page([
        title('tt0959621', 'Pilot', { year: 2008, month: 1, day: 20 }, 'tvEpisode', { series: { id: 'tt0903747', titleText: { text: 'Breaking Bad' }, releaseDate: { year: 2008, month: 1, day: 20 } }, episodeNumber: { seasonNumber: 1, episodeNumber: 1 } }),
        title('tt1054724', 'Unknown episode', null, 'tvEpisode', { series: { id: 'tt0903747', titleText: { text: 'Breaking Bad' }, releaseDate: { year: 2008, month: 1, day: 20 } }, episodeNumber: null }),
      ]));
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.titles[0], { id: 'tt0959621', title: 'Pilot', date: '2008-01-20', type: 'tvEpisode', series: { id: 'tt0903747', title: 'Breaking Bad', date: '2008-01-20', season: 1, episode: 1 } });
  assert.deepEqual(result.titles[1].series, { id: 'tt0903747', title: 'Breaking Bad', date: '2008-01-20', season: null, episode: null });
});

test('filmographies retain series premieres and only credited episodes even when the full series is cached', async () => {
  const seriesCache = new Map([['tt0903747', { episodes: [
    { id: 'tt1054724', title: "Cat's in the Bag...", date: '2008-01-27', type: 'tvEpisode',
      series: { id: 'tt0903747', title: 'Breaking Bad', date: '2008-01-20', season: 1, episode: 2 } },
  ], warnings: [] }]]);
  let calls = 0;
  const result = await fetchSource(person, {
    seriesCache,
    fetchImpl: async () => {
      calls += 1;
      return json(page([
        title('tt0903747', 'Breaking Bad', { year: 2008, month: 1, day: 20 }, 'tvSeries'),
        title('tt0959621', 'Pilot', { year: 2008, month: 1, day: 20 }, 'tvEpisode', {
          series: { id: 'tt0903747', titleText: { text: 'Breaking Bad' }, releaseDate: { year: 2008, month: 1, day: 20 } },
          episodeNumber: { seasonNumber: 1, episodeNumber: 1 },
        }),
      ]));
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.total, 2);
  assert.equal(result.titles[0].date, '2008-01-20');
  assert.equal(Object.hasOwn(result.titles[0], 'episodes'), false);
  assert.deepEqual(result.titles.map((entry) => entry.id), ['tt0903747', 'tt0959621']);
  assert.deepEqual(result.titles[1].series, { id: 'tt0903747', title: 'Breaking Bad', date: '2008-01-20', season: 1, episode: 1 });
});

test('keeps partial and absent parent series dates null without losing dated episodes', async () => {
  for (const date of [null, { year: 2027 }, { year: 2027, month: 4 }]) {
    const result = await fetchSource(person, {
      fetchImpl: async () => json(page([title('tt0959621', 'Pilot', { year: 2027, month: 4, day: 12 }, 'tvEpisode', {
        series: { id: 'tt0903747', titleText: { text: 'Upcoming series' }, releaseDate: date },
        episodeNumber: { seasonNumber: 1, episodeNumber: 1 },
      })])),
    });
    assert.equal(result.titles[0].date, '2027-04-12');
    assert.equal(result.titles[0].series.date, null);
  }
});

test('accepts a series with no known episodes without inventing a schedule', async () => {
  const responses = [page([title('tt9253284', 'Upcoming', null, 'tvSeries')]), episodesPage([])];
  const result = await fetchSource(marvel, { fetchImpl: async () => json(responses.shift()) });
  assert.deepEqual(result.titles[0].episodes, []);
});

test('reuses complete series reads across sources and exposes cached IMDb notices', async () => {
  const seriesCache = new Map();
  const queries = [];
  const fetchImpl = async (_url, options) => {
    const query = JSON.parse(options.body).query;
    queries.push(query);
    return json(query.includes('CalendarEpisodes')
      ? episodesPage([episode('tt20258964', 'One Year Later', 2, 1)], 1, false, null, { disclaimer: 'Episode usage notice' })
      : page([title('tt9253284', 'Andor', null, 'tvSeries')]));
  };
  const first = await fetchSource(marvel, { fetchImpl, seriesCache });
  const second = await fetchSource({ id: 'in0000243', kind: 'interest' }, { fetchImpl, seriesCache });
  assert.equal(queries.length, 3);
  assert.equal(queries.filter((query) => query.includes('CalendarEpisodes')).length, 1);
  assert.deepEqual(first.titles, second.titles);
  assert.deepEqual(second.warnings, ['IMDb usage notice: Episode usage notice']);
});

test('reads series sequentially with separate operation timeouts after the source search finishes', async (t) => {
  const operations = [];
  t.mock.method(AbortSignal, 'timeout', (duration) => {
    const controller = new AbortController();
    if (duration === 120_000) operations.push(controller);
    return controller.signal;
  });
  const queries = [];
  const result = await fetchSource(marvel, {
    fetchImpl: async (_url, options) => {
      const query = JSON.parse(options.body).query;
      queries.push(query);
      if (queries.length === 1) {
        return json(page([title('tt9253284', 'Andor', null, 'tvSeries'), title('tt9140560', 'WandaVision', null, 'tvMiniSeries')]));
      }
      operations[queries.length - 2].abort(new Error('Previous operation timed out'));
      assert.equal(options.signal.aborted, false);
      return json(episodesPage([]));
    },
  });
  assert.equal(operations.length, 3);
  assert.match(queries[1], /title\(id: "tt9253284"\)/);
  assert.match(queries[2], /title\(id: "tt9140560"\)/);
  assert.equal(result.titles.length, 2);
});

test('rejects a source when an episode page fails and retries rather than caching its partial episodes', async () => {
  const seriesCache = new Map();
  const responses = [
    page([title('tt9253284', 'Andor', null, 'tvSeries')]),
    episodesPage([episode('tt20258964', 'One Year Later', 2, 1)], 2, true, 'next'),
    new Response('Unavailable', { status: 503 }),
    page([title('tt9253284', 'Andor', null, 'tvSeries')]),
    episodesPage([episode('tt20258964', 'One Year Later', 2, 1)]),
  ];
  const fetchImpl = async () => {
    const payload = responses.shift();
    return payload instanceof Response ? payload : json(payload);
  };
  await assert.rejects(fetchSource(marvel, { fetchImpl, seriesCache }), (error) => error.code === 'HTTP_ERROR' && error.status === 503);
  assert.equal(seriesCache.size, 0);
  assert.equal((await fetchSource(marvel, { fetchImpl, seriesCache })).titles[0].episodes.length, 1);
  assert.equal(seriesCache.size, 1);
  assert.equal(responses.length, 0);
});

test('cancels episode expansion and leaves cancelled reads out of the shared cache', async () => {
  const controller = new AbortController();
  const seriesCache = new Map();
  let upstreamSignal;
  let cancelled = false;
  let calls = 0;
  const pending = fetchSource(marvel, {
    signal: controller.signal,
    seriesCache,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) return json(page([title('tt9253284', 'Andor', null, 'tvSeries')]));
      upstreamSignal = options.signal;
      return new Response(new ReadableStream({
        start(stream) { stream.enqueue(new TextEncoder().encode('{')); },
        cancel() { cancelled = true; },
      }));
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('Episode refresh cancelled'));
  await assert.rejects(pending, /Episode refresh cancelled/);
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(seriesCache.size, 0);
});

for (const [name, responses] of [
  ['a repeated episode cursor', [episodesPage([episode('tt20258964', 'One Year Later', 2, 1)], 3, true, 'same'), episodesPage([episode('tt20603288', 'Sagrona Teema', 2, 2)], 3, true, 'same')]],
  ['an incomplete episode list', [episodesPage([episode('tt20258964', 'One Year Later', 2, 1)], 2)]],
  ['a changing episode number', [episodesPage([episode('tt20258964', 'One Year Later', 2, 1)], 2, true, 'next'), episodesPage([episode('tt20258964', 'One Year Later', 2, 2), episode('tt20603288', 'Sagrona Teema', 2, 2)], 2)]],
]) {
  test(`refuses to publish ${name}`, async () => {
    const seriesCache = new Map();
    const payloads = [page([title('tt9253284', 'Andor', null, 'tvSeries')]), ...responses];
    await assert.rejects(fetchSource(marvel, { seriesCache, fetchImpl: async () => json(payloads.shift()) }), (error) => error.code === 'INCOMPLETE_RESULT');
    assert.equal(seriesCache.size, 0);
  });
}

test('keeps missing and impossible dates undated, preserving real Gregorian leap days', async () => {
  const inputs = [
    null,
    { year: 2027 },
    { year: 2027, month: 4 },
    { year: 2027, month: 2, day: 29 },
    { year: 1900, month: 2, day: 29 },
    { year: 2000, month: 2, day: 29 },
    { year: 2028, month: 2, day: 29 },
    { year: 2026, month: 4, day: 31 },
    { year: 2026, month: 13, day: 1 },
    { year: 0, month: 1, day: 1 },
    { year: '2026', month: 1, day: 1 },
    { year: 2026, month: 1, day: 1.5 },
    { year: 2026, month: 1, day: 0 },
    { year: 2026, month: 1, day: 1 },
  ];
  const result = await fetchSource(marvel, {
    fetchImpl: async () => json(page(inputs.map((date, index) => title(`tt${String(index + 1).padStart(7, '0')}`, `Title ${index}`, date)))),
  });
  assert.equal(result.omitted, 11);
  assert.deepEqual(result.titles.filter((entry) => entry.date).map((entry) => entry.date), ['2000-02-29', '2028-02-29', '2026-01-01']);
});

test('exposes entitlement and usage notices without silently treating returned data as licensed', async () => {
  const extensions = {
    entitlements: { fields: { 'Query.advancedTitleSearch': 'DENY' }, inUse: true },
    disclaimer: 'Public, commercial, and/or non-private use is not allowed.',
  };
  const responses = [page([title('tt0000001', 'A')], 2, true, 'next', extensions), page([title('tt0000002', 'B')], 2, false, null, extensions)];
  const result = await fetchSource(marvel, { fetchImpl: async () => json(responses.shift()) });
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /DENY/);
  assert.match(result.warnings[1], /non-private use is not allowed/);
});

test('accepts a genuinely empty source', async () => {
  assert.deepEqual(await fetchSource(marvel, { fetchImpl: async () => json(page([])) }), { titles: [], total: 0, omitted: 0, warnings: [] });
});

test('rejects an entire source if a later page fails instead of returning partial titles', async () => {
  let calls = 0;
  await assert.rejects(fetchSource(marvel, {
    fetchImpl: async () => ++calls === 1
      ? json(page([title('tt0000001', 'First')], 2, true, 'next'))
      : new Response('Too many requests', { status: 429 }),
  }), (error) => error instanceof ImdbError && error.status === 429);
  assert.equal(calls, 2);
});

for (const status of [403, 500]) {
  test(`does not retry or bypass HTTP ${status}`, async () => {
    let calls = 0;
    await assert.rejects(fetchSource(marvel, { fetchImpl: async () => {
      calls += 1;
      return new Response('Unavailable', { status });
    } }), (error) => error.status === status && error.code === 'HTTP_ERROR');
    assert.equal(calls, 1);
  });
}

test('rejects GraphQL errors even when the same response contains data', async () => {
  await assert.rejects(fetchSource(marvel, {
    fetchImpl: async () => json({ ...page([title('tt0000001', 'Partial')]), errors: [{ message: 'A field failed' }] }),
  }), /IMDb GraphQL error: A field failed/);
});

for (const [name, responses] of [
  ['a repeated cursor', [page([title('tt0000001', 'A')], 3, true, 'same'), page([title('tt0000002', 'B')], 3, true, 'same')]],
  ['a missing cursor', [page([title('tt0000001', 'A')], 2, true)]],
  ['an empty advancing page', [page([], 2, true, 'next')]],
  ['a premature last page', [page([title('tt0000001', 'A')], 2)]],
  ['a changing total', [page([title('tt0000001', 'A')], 2, true, 'next'), page([title('tt0000002', 'B')], 3)]],
  ['a missing title', [page([{ node: { title: null } }])]],
  ['a changing duplicate', [page([title('tt0000001', 'A')], 2, true, 'next'), page([title('tt0000001', 'A', null), title('tt0000002', 'B')], 2)]],
  ['a safety-limit breach', [page([], 50_001)]],
]) {
  test(`refuses to publish ${name}`, async () => {
    let calls = 0;
    await assert.rejects(fetchSource(marvel, {
      fetchImpl: async () => json(responses[calls++]),
    }), (error) => error.code === 'INCOMPLETE_RESULT');
    assert.ok(calls <= responses.length);
  });
}

test('rejects challenge HTML and malformed JSON', async () => {
  for (const response of [new Response('<html>Verify you are human</html>', { headers: { 'content-type': 'text/html' } }), new Response('{bad json')]) {
    await assert.rejects(fetchSource(marvel, { fetchImpl: async () => response }), (error) => error.code === 'INVALID_RESPONSE');
  }
});

test('caps both declared and streamed response sizes', async () => {
  const limit = 2 * 1024 * 1024;
  const responses = [
    new Response('{}', { headers: { 'content-length': String(limit + 1) } }),
    new Response(new Uint8Array(limit + 1)),
  ];
  for (const response of responses) {
    await assert.rejects(fetchSource(marvel, { fetchImpl: async () => response }), (error) => error.code === 'RESPONSE_TOO_LARGE');
  }
});

test('honors cancellation before starting a request', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Stopped'));
  await assert.rejects(fetchSource(marvel, { signal: controller.signal, fetchImpl: async () => assert.fail('Unexpected network request') }), /Stopped/);
});

test('passes cancellation into fetch and stops a stalled response body', async () => {
  const controller = new AbortController();
  let upstreamSignal;
  let cancelled = false;
  const pending = fetchSource(marvel, {
    signal: controller.signal,
    fetchImpl: async (_url, options) => {
      upstreamSignal = options.signal;
      return new Response(new ReadableStream({
        start(stream) { stream.enqueue(new TextEncoder().encode('{')); },
        cancel() { cancelled = true; },
      }));
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('Refresh cancelled'));
  await assert.rejects(pending, /Refresh cancelled/);
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, true);
});

test('validates the source and refuses to silently ignore a requested release region', async () => {
  for (const source of [{ ...marvel, id: 'in0000248" }' }, { ...marvel, kind: 'list' }, { ...person, kind: 'interest' }]) {
    await assert.rejects(fetchSource(source), TypeError);
  }
  await assert.rejects(fetchSource(marvel, { region: 'MY' }), /Region-specific/);
});
