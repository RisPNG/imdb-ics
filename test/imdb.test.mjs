import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSource, ImdbError } from '../src/imdb.mjs';

const marvel = { id: 'in0000248', kind: 'interest', label: 'Marvel' };
const person = { id: 'nm0319213', kind: 'name', label: 'Vince Gilligan' };
const title = (id, text, date = { year: 2026, month: 12, day: 18 }) => ({
  node: { title: { id, titleText: { text }, releaseDate: date } },
});
const page = (edges, total = edges.length, hasNextPage = false, endCursor = null, extensions) => ({
  data: { advancedTitleSearch: { total, edges, pageInfo: { hasNextPage, endCursor } } },
  ...(extensions ? { extensions } : {}),
});
const json = (payload) => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });

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
    { id: 'tt21357150', title: 'Avengers: Doomsday', date: '2026-12-18' },
    { id: 'tt4154796', title: 'Avengers: Endgame', date: '2019-04-26' },
    { id: 'tt22084616', title: 'Spider-Man: Brand New Day', date: null },
  ]);
});

test('uses directly credited titles for a person, without guessing an episode expansion', async () => {
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
