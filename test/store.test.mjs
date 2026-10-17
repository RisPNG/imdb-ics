import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { CalendarStore } from '../src/store.mjs';
import { loadConfig } from '../src/config.mjs';
import { renderCalendar } from '../src/calendar.mjs';

const quiet = { info() {}, warn() {} };
const source = (slug) => ({ slug, kind: 'interest', id: slug === 'one' ? 'in0000248' : 'in0000243', label: slug, url: 'https://www.imdb.com/' });
const title = { id: 'tt1234567', title: 'A release', date: '2026-11-19' };
const result = (titles) => ({ titles, total: titles.length, omitted: titles.filter((item) => item.date === null).length, warnings: [] });

async function setup(t, loader, { env = {}, ...options } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'release-calendar-store-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const config = { ...loadConfig({ DATA_DIR: dataDir, ...env }), sources: [source('one'), source('two')] };
  const store = new CalendarStore(config, { loader, logger: quiet, ...options });
  await store.initialize();
  t.after(() => store.stop());
  return { store, config, dataDir };
}

test('combined feed waits for every first snapshot and failed refresh preserves existing data', async (t) => {
  let broken = true;
  const { store } = await setup(t, async (item) => {
    if (item.slug === 'two' && broken) throw new Error('HTTP 429');
    return result([title]);
  });
  assert.equal(store.feed('all'), null);
  await store.refresh();
  assert.equal(store.feed('all'), null);
  assert.equal(store.feed('one').events[title.id].status, 'CONFIRMED');
  broken = false;
  await store.refresh();
  assert.equal(Object.keys(store.feed('all').events).length, 1, 'overlapping sources must deduplicate');
  broken = true;
  await store.refresh();
  assert.equal(store.feed('two').stale, true);
  assert.equal(store.feed('all').events[title.id].status, 'CONFIRMED');
  assert.equal(store.feed('all').stale, true);
});

test('adding a source keeps the saved combined feed available until the new source completes its first snapshot', async (t) => {
  let clock = new Date('2026-10-14T00:00:00Z');
  const removedTitle = { id: 'tt2345678', title: 'A removed release', date: '2026-11-21' };
  let titles = [title, removedTitle];
  const { store, config } = await setup(t, async () => result(titles), { clock: () => clock });
  await store.refresh();
  clock = new Date('2026-10-15T00:00:00Z');
  titles = [{ ...title, date: '2026-11-20' }];
  await store.refresh();
  const previous = structuredClone(store.feed('all'));
  const bytes = renderCalendar({ name: previous.label, description: previous.description, events: previous.events });
  assert.equal(previous.events[title.id].sequence, 1);
  assert.equal(previous.events[removedTitle.id].status, 'CANCELLED');

  const newTitle = { id: 'tt3456789', title: 'A newly included release', date: '2026-11-22' };
  let broken = true;
  const expanded = new CalendarStore({ ...config, sources: [...config.sources,
    { slug: 'three', id: 'nm0000138', kind: 'name', label: 'three', url: 'https://www.imdb.com/name/nm0000138/' },
  ] }, {
    logger: quiet, clock: () => clock, loader: async (item) => {
      if (item.slug !== 'three') return result(titles);
      if (broken) throw new Error('HTTP 429');
      return result([...titles, newTitle]);
    },
  });
  t.after(() => expanded.stop());
  await expanded.initialize();
  const pending = expanded.pageData().feeds.find((feed) => feed.slug === 'three');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.count, null);
  assert.equal(pending.updatedAt, null);
  assert.equal(expanded.feed('three'), null);
  assert.equal(expanded.feed('all').stale, true);
  assert.equal(renderCalendar({ name: previous.label, description: previous.description, events: expanded.feed('all').events }), bytes);

  clock = new Date('2026-10-16T00:00:00Z');
  await expanded.refresh();
  assert.equal(expanded.feed('three'), null);
  assert.equal(expanded.pageData().feeds.find((feed) => feed.slug === 'three').status, 'error');
  assert.equal(expanded.pageData().feeds.find((feed) => feed.slug === 'all').status, 'stale');
  assert.deepEqual(expanded.feed('all').events, previous.events);
  assert.equal(renderCalendar({ name: previous.label, description: previous.description, events: expanded.feed('all').events }), bytes);

  clock = new Date('2026-10-17T00:00:00Z');
  titles = [{ ...title, date: '2026-11-23' }];
  await expanded.refresh();
  const refreshed = structuredClone(expanded.feed('all').events);
  assert.equal(expanded.feed('all').stale, true);
  assert.equal(refreshed[title.id].date, '2026-11-23');
  assert.equal(refreshed[title.id].sequence, previous.events[title.id].sequence + 1);
  assert.equal(refreshed[title.id].createdAt, previous.events[title.id].createdAt);
  assert.equal(refreshed[title.id].modifiedAt, clock.toISOString());
  assert.deepEqual(refreshed[removedTitle.id], previous.events[removedTitle.id]);

  clock = new Date('2026-10-18T00:00:00Z');
  broken = false;
  await expanded.refresh();
  assert.equal(expanded.feed('all').stale, false);
  assert.equal(expanded.feed('three').stale, false);
  assert.deepEqual(expanded.feed('all').events[title.id], refreshed[title.id]);
  assert.deepEqual(expanded.feed('all').events[removedTitle.id], previous.events[removedTitle.id]);
  assert.equal(expanded.feed('all').events[newTitle.id].status, 'CONFIRMED');
  assert.equal(expanded.feed('all').events[newTitle.id].sequence, 0);
  assert.equal(expanded.pageData().feeds.find((feed) => feed.slug === 'three').count, 2);
});

test('snapshot restart preserves event bytes and revisions; removal cancels only after every source removes title', async (t) => {
  let clock = new Date('2026-10-16T00:00:00Z');
  let data = { one: [title], two: [title] };
  const { store, config } = await setup(t, async (item) => result(data[item.slug]), { clock: () => clock });
  await store.refresh();
  const original = renderCalendar({ events: store.feed('all').events, eventTimeMode: 'utc' });
  const restored = new CalendarStore(config, { logger: quiet, clock: () => clock });
  await restored.initialize();
  assert.equal(renderCalendar({ events: restored.feed('all').events, eventTimeMode: 'utc' }), original);
  clock = new Date('2026-10-17T00:00:00Z');
  data = { one: [], two: [{ ...title, date: '2026-11-20' }] };
  await store.refresh();
  assert.equal(store.feed('one').events[title.id].status, 'CANCELLED');
  assert.equal(store.feed('all').events[title.id].status, 'CONFIRMED');
  assert.equal(store.feed('all').events[title.id].sequence, 1);
  assert.equal(store.feed('all').events[title.id].date, '2026-11-20');
  data.two = [];
  await store.refresh();
  assert.equal(store.feed('all').events[title.id].status, 'CANCELLED');
  assert.equal(store.feed('all').events[title.id].sequence, 2);
});

test('simultaneous refresh calls share one job and fresh saved data is not refetched', async (t) => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { store } = await setup(t, async () => { calls++; await gate; return result([title]); });
  const first = store.refresh();
  const second = store.refresh();
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  await store.refresh({ force: false });
  assert.equal(calls, 2);
});

test('combined omission counts deduplicate undated titles and prefer an available complete date', async (t) => {
  const unknown = { id: 'tt2345678', title: 'An undated title', date: null };
  const { store } = await setup(t, async (item) => result([
    { ...title, date: item.slug === 'one' ? null : title.date }, unknown,
  ]));
  await store.refresh();
  const combined = store.pageData().feeds.find((feed) => feed.slug === 'all');
  assert.equal(combined.count, 1);
  assert.equal(combined.omitted, 1);
});

test('series and directly matched episodes share release groups, omission counts, and source attribution', async (t) => {
  const series = { id: 'tt3456789', title: 'A series', date: '2026-11-19', type: 'tvSeries', episodes: [
    { id: 'tt4567890', title: 'The beginning', date: '2026-11-19', type: 'tvEpisode',
      series: { id: 'tt3456789', title: 'A series', season: 1, episode: 1 } },
    { id: 'tt5678901', title: 'Another beginning', date: '2026-11-19', type: 'tvEpisode',
      series: { id: 'tt3456789', title: 'A series', season: 1, episode: 2 } },
    { id: 'tt6789012', title: 'Next week', date: '2026-11-26', type: 'tvEpisode',
      series: { id: 'tt3456789', title: 'A series', season: 1, episode: 3 } },
    { id: 'tt7890123', title: 'To be announced', date: null, type: 'tvEpisode',
      series: { id: 'tt3456789', title: 'A series', season: 1, episode: 4 } },
  ] };
  const caches = [];
  const { store } = await setup(t, async (item, { seriesCache }) => {
    caches.push(seriesCache);
    return result(item.slug === 'one' ? [series] : [series.episodes[0], series.episodes[3]]);
  }, { clock: () => new Date('2026-10-17T00:00:00Z') });
  await store.refresh();
  assert(caches[0] instanceof Map);
  assert.equal(caches[0], caches[1], 'sources share expanded series data during a refresh');
  const events = store.feed('all').events;
  assert.deepEqual(Object.keys(events), [series.id, `${series.id}-2026-11-26`]);
  assert.deepEqual(events[series.id].episodeIds, ['tt4567890', 'tt5678901']);
  assert.equal(events[series.id].description, 'S01E01: The beginning\nS01E02: Another beginning');
  const page = store.pageData();
  assert.deepEqual(page.upcoming.find((event) => event.id === series.id).sources, ['one', 'two']);
  assert.deepEqual(page.upcoming.find((event) => event.date === '2026-11-26').sources, ['one']);
  assert.deepEqual(page.feeds.map(({ slug, count, omitted }) => ({ slug, count, omitted })), [
    { slug: 'all', count: 2, omitted: 1 }, { slug: 'one', count: 2, omitted: 1 }, { slug: 'two', count: 1, omitted: 1 },
  ]);
  await store.refresh();
  assert.equal(caches[2], caches[3]);
  assert.notEqual(caches[0], caches[2], 'expanded series are refreshed again on the next run');
});

test('version 1 snapshots retain movie revisions and cancellations while migrating episode UIDs and surviving restart', async (t) => {
  const createdAt = '2026-10-01T00:00:00.000Z';
  let clock = new Date('2026-10-17T00:00:00Z');
  const episode = { id: 'tt4567890', title: 'The beginning', date: '2026-11-19', type: 'tvEpisode',
    series: { id: 'tt3456789', title: 'A series', season: 1, episode: 1 } };
  const series = { id: 'tt3456789', title: 'A series', date: '2026-11-19', type: 'tvSeries', episodes: [episode] };
  const { config, dataDir } = await setup(t, async () => result([]));
  const movie = { ...title, createdAt, modifiedAt: createdAt, sequence: 3, status: 'CONFIRMED' };
  const oldEpisode = { id: episode.id, title: episode.title, date: episode.date,
    createdAt, modifiedAt: createdAt, sequence: 2, status: 'CONFIRMED' };
  const cancellation = { id: 'tt2345678', title: 'A removed title', date: '2026-11-20',
    createdAt, modifiedAt: createdAt, sequence: 7, status: 'CANCELLED' };
  const events = { [movie.id]: movie, [episode.id]: oldEpisode, [cancellation.id]: cancellation };
  const savedSource = { titles: [title, { id: episode.id, title: episode.title, date: episode.date }], events,
    total: 2, omitted: 0, warnings: [], lastSuccessAt: createdAt, lastAttemptAt: createdAt, error: null };
  await writeFile(join(dataDir, 'snapshot.json'), JSON.stringify({ version: 1, eventTimeMode: config.eventTimeMode,
    sources: { one: savedSource, two: savedSource }, combined: { events, updatedAt: createdAt } }));
  const migrated = new CalendarStore(config, {
    logger: quiet, clock: () => clock, loader: async () => result([title, series]),
  });
  t.after(() => migrated.stop());
  await migrated.initialize();
  assert.equal(migrated.snapshot.version, 2);
  assert.equal(renderCalendar({ events: migrated.feed('all').events }), renderCalendar({ events }));
  await migrated.refresh();
  const combined = migrated.feed('all').events;
  assert.equal(combined[episode.id].status, 'CANCELLED');
  assert.equal(combined[episode.id].sequence, 3);
  assert.equal(combined[episode.id].createdAt, createdAt);
  assert.equal(combined[series.id].titleId, series.id);
  assert.equal(combined[series.id].description, 'S01E01: The beginning');
  assert.deepEqual(combined[series.id].episodeIds, [episode.id]);
  assert.equal(combined[movie.id].sequence, 3);
  assert.equal(combined[movie.id].modifiedAt, createdAt);
  assert.equal(combined[cancellation.id].sequence, 7);
  assert.equal(combined[cancellation.id].status, 'CANCELLED');
  const bytes = renderCalendar({ events: combined });
  const restored = new CalendarStore(config, {
    logger: quiet, clock: () => clock, loader: async () => result([title, series]),
  });
  t.after(() => restored.stop());
  await restored.initialize();
  assert.equal(renderCalendar({ events: restored.feed('all').events }), bytes);
  assert.deepEqual(restored.feed('all').events[series.id], combined[series.id]);
  clock = new Date('2026-10-18T00:00:00Z');
  await restored.refresh();
  assert.equal(renderCalendar({ events: restored.feed('all').events }), bytes);
  assert.equal(JSON.parse(gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz')))).version, 2);
});

test('failed episode expansion keeps saved source events while the combined feed retires overlapping legacy episode UIDs', async (t) => {
  const oldEpisode = { id: 'tt4567890', title: 'The beginning', date: '2026-11-19' };
  const series = { id: 'tt3456789', title: 'A series', date: '2026-11-19', type: 'tvSeries', episodes: [
    { ...oldEpisode, type: 'tvEpisode', series: { id: 'tt3456789', title: 'A series', season: 1, episode: 1 } },
  ] };
  let phase = 0;
  let clock = new Date('2026-10-16T00:00:00Z');
  const { store } = await setup(t, async (item) => {
    if (phase === 0) return result([oldEpisode]);
    if (item.slug === 'one' || phase === 2) throw new Error('Episode pagination failed');
    return result([series]);
  }, { clock: () => clock });
  await store.refresh();
  const originalSource = structuredClone(store.feed('one').events);
  phase = 1;
  clock = new Date('2026-10-17T00:00:00Z');
  await store.refresh();
  assert.deepEqual(store.feed('one').events, originalSource);
  assert.equal(store.feed('one').stale, true);
  const combined = store.feed('all').events;
  assert.equal(combined[oldEpisode.id].status, 'CANCELLED');
  assert.equal(combined[oldEpisode.id].sequence, 1);
  assert.equal(combined[series.id].status, 'CONFIRMED');
  assert.deepEqual(combined[series.id].episodeIds, [oldEpisode.id]);
  assert.deepEqual(store.pageData().upcoming.find((event) => event.id === series.id).sources, ['one', 'two']);
  const savedCombined = structuredClone(combined);
  const savedTwo = structuredClone(store.feed('two').events);
  phase = 2;
  clock = new Date('2026-10-18T00:00:00Z');
  await store.refresh();
  assert.deepEqual(store.feed('all').events, savedCombined);
  assert.deepEqual(store.feed('two').events, savedTwo);
  assert.equal(store.feed('all').stale, true);
});

test('an invalid cache cannot serve fabricated empty calendars', async (t) => {
  const { dataDir, config } = await setup(t, async () => result([]));
  await writeFile(join(dataDir, 'snapshot.json'), '{"version":1,"sources":{"one":{"titles":[]}}}');
  const restored = new CalendarStore(config, { logger: quiet });
  await restored.initialize();
  assert.equal(restored.feed('one'), null);
  assert.equal(restored.feed('all'), null);
});

test('null event records are rejected before rendering or time-mode migration can crash', async (t) => {
  const { store, dataDir, config } = await setup(t, async () => result([title]));
  await store.refresh();
  const saved = JSON.parse(gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz'))));
  saved.sources.one.events[title.id] = null;
  await writeFile(join(dataDir, 'snapshot.json.gz'), gzipSync(JSON.stringify(saved)));
  const restored = new CalendarStore({ ...config, eventTimeMode: 'date' }, { logger: quiet });
  await restored.initialize();
  assert.equal(restored.feed('all'), null);
  assert.doesNotThrow(() => restored.pageData());
});

test('existing UTC snapshots migrate to default all-day events once while preserving UIDs', async (t) => {
  const { store, config, dataDir } = await setup(t, async () => result([title]), {
    env: { EVENT_TIME_MODE: 'utc' }, clock: () => new Date('2026-10-16T00:00:00Z'),
  });
  await store.refresh();
  const allDayConfig = { ...config, eventTimeMode: loadConfig({}).eventTimeMode };
  const restored = new CalendarStore(allDayConfig, {
    logger: quiet, clock: () => new Date('2026-10-17T00:00:00Z'),
  });
  await restored.initialize();
  assert.equal(restored.feed('all').events[title.id].sequence, 1);
  assert.equal(restored.feed('all').events[title.id].modifiedAt, '2026-10-17T00:00:00.000Z');
  const ics = renderCalendar({ events: restored.feed('all').events, eventTimeMode: allDayConfig.eventTimeMode });
  assert.match(ics, /UID:tt1234567@release-calendar\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261119\r\n/);
  await restored.persist();
  const secondRestart = new CalendarStore(allDayConfig, { logger: quiet });
  await secondRestart.initialize();
  assert.equal(secondRestart.feed('all').events[title.id].sequence, 1, 'restarting does not repeatedly revise an already migrated event');
});
