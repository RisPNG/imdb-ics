import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSource, ImdbError, PEOPLE_EXCLUDED_INTEREST_IDS } from '../src/imdb.mjs';

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
const episode = (id, text, season, number, date = { year: 2025, month: 4, day: 22 }, seriesId = 'tt9253284') =>
  title(id, text, date, 'tvEpisode', { series: { id: seriesId, titleText: { text: 'Parent series' }, releaseDate: null }, episodeNumber: { seasonNumber: season, episodeNumber: number } });

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
  for (const request of requests) assert.doesNotMatch(JSON.parse(request.body).query, /excludeInterestIds/);
  assert.ok(JSON.parse(requests[1].body).query.includes(`after: ${JSON.stringify('opaque "cursor" \\ value')}`));
  assert.equal(result.total, 3);
  assert.equal(result.omitted, 1);
  assert.deepEqual(result.titles, [
    { id: 'tt21357150', title: 'Avengers: Doomsday', date: '2026-12-18', type: 'movie' },
    { id: 'tt4154796', title: 'Avengers: Endgame', date: '2019-04-26', type: 'movie' },
    { id: 'tt22084616', title: 'Spider-Man: Brand New Day', date: null, type: 'movie' },
  ]);
});

test('excludes News and Talk Show interests from every page of directly credited person titles', async () => {
  const queries = [];
  const responses = [
    page([title('tt0903747', 'Breaking Bad', { year: 2008, month: 1, day: 20 }, 'tvSeries')], 3, true, 'filtered next page'),
    page([episode('tt0959621', 'Pilot', 1, 1, { year: 2008, month: 1, day: 20 }, 'tt0903747'), title('tt0000001', 'Upcoming', null)], 3),
  ];
  const result = await fetchSource(person, {
    fetchImpl: async (_url, options) => {
      queries.push(JSON.parse(options.body).query);
      return json(responses.shift());
    },
  });
  assert.deepEqual(PEOPLE_EXCLUDED_INTEREST_IDS, ['in0000211', 'in0000127']);
  assert.equal(Object.isFrozen(PEOPLE_EXCLUDED_INTEREST_IDS), true);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query, /titleCreditsConstraint: \{anyCredits: \[\{nameId: "nm0319213"\}\]\}/);
    assert.match(query, /interestConstraint: \{excludeInterestIds: \["in0000211","in0000127"\]\}/);
    assert.doesNotMatch(query, /episodicConstraint/);
  }
  assert.match(queries[1], /after: "filtered next page"/);
  assert.equal(result.total, 3);
  assert.equal(result.omitted, 1);
  assert.deepEqual(result.titles.map((entry) => entry.id), ['tt0903747', 'tt0959621', 'tt0000001']);
  assert.equal(result.titles[0].date, '2008-01-20');
  assert.equal(Object.hasOwn(result.titles[0], 'episodes'), false);
});

test('accepts a completely excluded person and rejects an incomplete filtered filmography', async () => {
  assert.deepEqual(await fetchSource(person, { fetchImpl: async () => json(page([])) }), { titles: [], total: 0, omitted: 0, warnings: [] });
  await assert.rejects(fetchSource(person, {
    fetchImpl: async () => json(page([title('tt0903747', 'Breaking Bad')], 2)),
  }), (error) => error.code === 'INCOMPLETE_RESULT');
});

test('expands a series with single and batch episode release dates without changing its source counts', async () => {
  const responses = [
    page([title('tt9253284', 'Andor', { year: 2022, month: 9, day: 21 }, 'tvSeries')]),
    page([
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
  assert.match(queries[1], /episodicConstraint: \{anySeriesIds: \["tt9253284"\]\}/);
  assert.match(queries[1], /advancedTitleSearch\(first: 100/);
  for (const query of queries) assert.doesNotMatch(query, /excludeInterestIds/);
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
  const first = episode('tt10161316', 'Filmed Before a Live Studio Audience', 1, 1, { year: 2021, month: 1, day: 15 }, 'tt9140560');
  const responses = [
    page([title('tt9140560', 'WandaVision', null, 'tvMiniSeries')]),
    page([first], 3, true, 'opaque episode "cursor"'),
    page([first, episode('tt10161318', 'Do Not Touch That Dial', 1, 2, { year: 2021, month: 1, day: 15 }, 'tt9140560'), episode('tt10161320', 'Upcoming', null, null, null, 'tt9140560')], 3),
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
  const responses = [page([title('tt9253284', 'Upcoming', null, 'tvSeries')]), page([])];
  const result = await fetchSource(marvel, { fetchImpl: async () => json(responses.shift()) });
  assert.deepEqual(result.titles[0].episodes, []);
});

test('expands DC series through complete episode membership, including Starfire with no listed episodes', async () => {
  const responses = [
    page([title('tt36057368', 'Starfire!', null, 'tvSeries'), title('tt26545992', 'Lanterns', { year: 2026, month: 8, day: 16 }, 'tvSeries')]),
    page([]),
    page([
      episode('tt26546824', 'Pilot', 1, 1, { year: 2026, month: 8, day: 16 }, 'tt26545992'),
      episode('tt32752609', 'Bad Optics', 1, 6, { year: 2026, month: 9, day: 20 }, 'tt26545992'),
      episode('tt32752610', 'The Weenie', 1, 4, { year: 2026, month: 9, day: 6 }, 'tt26545992'),
      episode('tt32752611', 'Lights Out', 1, 5, { year: 2026, month: 9, day: 13 }, 'tt26545992'),
      episode('tt32752612', 'OutKast', 1, 3, { year: 2026, month: 8, day: 30 }, 'tt26545992'),
      episode('tt32752613', 'Trust Fall', 1, 2, { year: 2026, month: 8, day: 23 }, 'tt26545992'),
      episode('tt32752614', "The Jordan Boys' Legacy", 1, 7, { year: 2026, month: 9, day: 27 }, 'tt26545992'),
      episode('tt32752615', 'Dirt and Stars', 1, 8, { year: 2026, month: 10, day: 4 }, 'tt26545992'),
    ]),
  ];
  const queries = [];
  const result = await fetchSource({ id: 'in0000244', kind: 'interest', label: 'DC' }, {
    fetchImpl: async (_url, options) => {
      queries.push(JSON.parse(options.body).query);
      return json(responses.shift());
    },
  });
  assert.match(queries[1], /episodicConstraint: \{anySeriesIds: \["tt36057368"\]\}/);
  assert.match(queries[2], /episodicConstraint: \{anySeriesIds: \["tt26545992"\]\}/);
  assert.equal(result.total, 2);
  assert.equal(result.omitted, 1);
  assert.deepEqual(result.titles[0].episodes, []);
  assert.equal(result.titles[1].episodes.length, 8);
  assert.deepEqual(result.titles[1].episodes[0].series, { id: 'tt26545992', title: 'Lanterns', date: '2026-08-16', season: 1, episode: 1 });
  assert.equal(result.titles[1].episodes.at(-1).date, '2026-10-04');
  assert.equal(responses.length, 0);
});

for (const [name, payload, message] of [
  ['an unavailable episode search', { data: { advancedTitleSearch: null }, extensions: { entitlements: { fields: { 'Query.advancedTitleSearch': 'DENY' } } } }, /missing episode-search fields for series tt36057368 \(Starfire!\)/],
  ['an episode from another series', page([episode('tt26546824', 'Pilot', 1, 1, null, 'tt26545992')]), /episode tt26546824 belongs to series tt26545992 rather than tt36057368/],
  ['a non-episode result', page([title('tt26546824', 'Pilot')]), /episode search for series tt36057368 returned non-episode tt26546824/],
  ['an episode without its parent', page([title('tt26546824', 'Pilot', null, 'tvEpisode')]), /episode tt26546824 is missing its series/],
]) {
  test(`rejects ${name} instead of publishing an empty or unrelated series`, async () => {
    const seriesCache = new Map();
    const responses = [page([title('tt36057368', 'Starfire!', null, 'tvSeries')]), payload];
    await assert.rejects(fetchSource(marvel, { seriesCache, fetchImpl: async () => json(responses.shift()) }), (error) => error.code === 'INCOMPLETE_RESULT' && message.test(error.message));
    assert.equal(seriesCache.size, 0);
  });
}

test('reuses complete series reads across sources and exposes cached IMDb notices', async () => {
  const seriesCache = new Map();
  const queries = [];
  const fetchImpl = async (_url, options) => {
    const query = JSON.parse(options.body).query;
    queries.push(query);
    return json(query.includes('CalendarEpisodes')
      ? page([episode('tt20258964', 'One Year Later', 2, 1)], 1, false, null, { disclaimer: 'Episode usage notice' })
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
      return json(page([]));
    },
  });
  assert.equal(operations.length, 3);
  assert.match(queries[1], /episodicConstraint: \{anySeriesIds: \["tt9253284"\]\}/);
  assert.match(queries[2], /episodicConstraint: \{anySeriesIds: \["tt9140560"\]\}/);
  assert.equal(result.titles.length, 2);
});

test('rejects a source when an episode page fails and retries rather than caching its partial episodes', async () => {
  const seriesCache = new Map();
  const responses = [
    page([title('tt9253284', 'Andor', null, 'tvSeries')]),
    page([episode('tt20258964', 'One Year Later', 2, 1)], 2, true, 'next'),
    new Response('Unavailable', { status: 503 }),
    page([title('tt9253284', 'Andor', null, 'tvSeries')]),
    page([episode('tt20258964', 'One Year Later', 2, 1)]),
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
  ['a repeated episode cursor', [page([episode('tt20258964', 'One Year Later', 2, 1)], 3, true, 'same'), page([episode('tt20603288', 'Sagrona Teema', 2, 2)], 3, true, 'same')]],
  ['an incomplete episode list', [page([episode('tt20258964', 'One Year Later', 2, 1)], 2)]],
  ['a changing episode number', [page([episode('tt20258964', 'One Year Later', 2, 1)], 2, true, 'next'), page([episode('tt20258964', 'One Year Later', 2, 2), episode('tt20603288', 'Sagrona Teema', 2, 2)], 2)]],
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
