import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { CalendarStore } from '../src/store.mjs';
import { loadConfig } from '../src/config.mjs';
import { renderCalendar } from '../src/calendar.mjs';
import { TITLE_EXCLUSIONS } from '../src/imdb.mjs';

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
  const previousArchive = structuredClone(store.snapshot.combined.events);
  const bytes = renderCalendar({ name: previous.label, description: previous.description, events: previous.events });
  assert.equal(previous.events[title.id].sequence, 1);
  assert.equal(previous.events[removedTitle.id], undefined);
  assert.equal(previousArchive[removedTitle.id].status, 'CANCELLED');

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
  assert.equal(expanded.feed('all').events[title.id].sequence, refreshed[title.id].sequence + 1);
  assert.equal(expanded.feed('all').events[title.id].createdAt, refreshed[title.id].createdAt);
  assert.equal(expanded.feed('all').events[title.id].description, 'https://www.imdb.com/title/tt1234567/\n\nInterests: one, two\nPeople: three');
  assert.equal(expanded.feed('all').events[removedTitle.id], undefined);
  assert.deepEqual(expanded.snapshot.combined.events[removedTitle.id], previousArchive[removedTitle.id]);
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
  const createdAt = store.snapshot.combined.events[title.id].createdAt;
  const restored = new CalendarStore(config, { logger: quiet, clock: () => clock });
  await restored.initialize();
  assert.equal(renderCalendar({ events: restored.feed('all').events, eventTimeMode: 'utc' }), original);
  clock = new Date('2026-10-17T00:00:00Z');
  data = { one: [], two: [{ ...title, date: '2026-11-20' }] };
  await store.refresh();
  assert.equal(store.feed('one').events[title.id], undefined);
  assert.equal(store.snapshot.sources.one.events[title.id].status, 'CANCELLED');
  assert.equal(store.feed('all').events[title.id].status, 'CONFIRMED');
  assert.equal(store.feed('all').events[title.id].sequence, 1);
  assert.equal(store.feed('all').events[title.id].date, '2026-11-20');
  data.two = [];
  await store.refresh();
  assert.equal(store.feed('all').events[title.id], undefined);
  assert.equal(store.feed('two').events[title.id], undefined);
  assert.equal(store.snapshot.combined.events[title.id].status, 'CANCELLED');
  assert.equal(store.snapshot.combined.events[title.id].sequence, 2);
  const removed = store.feed('all');
  assert.equal(store.feed('all').events, removed.events, 'an empty publication is cached too');
  assert.equal(store.feed('all').modifiedAt, removed.modifiedAt);
  data.two = [{ ...title, date: '2026-11-20' }];
  clock = new Date('2026-10-18T00:00:00Z');
  await store.refresh();
  const restoredEvent = store.feed('all').events[title.id];
  assert.equal(restoredEvent.id, title.id);
  assert.equal(restoredEvent.status, 'CONFIRMED');
  assert.equal(restoredEvent.sequence, 3);
  assert.equal(restoredEvent.createdAt, createdAt);
  assert(store.feed('all').modifiedAt > removed.modifiedAt);
  assert.equal(store.feed('two').events[title.id], store.snapshot.sources.two.events[title.id]);
});

test('combined publication limits dates and omits withdrawn releases while retaining archived history and grouped episode attribution', async (t) => {
  let clock = new Date('2026-10-20T00:00:00Z');
  const boundaries = ['2023-12-31', '2024-01-01', '2029-12-31', '2030-01-01'].map((date, index) => ({
    id: `tt${2000000 + index}`, title: `A boundary release ${date}`, date,
  }));
  const withdrawn = ['2023-06-01', '2026-11-19', '2030-06-01'].map((date, index) => ({
    id: `tt${3000000 + index}`, title: `A withdrawn release ${date}`, date,
  }));
  const series = { id: 'tt4000000', title: 'A series', date: '2023-01-01', type: 'tvSeries', episodes: [1, 2].map((number) => ({
    id: `tt${4000000 + number}`, title: `Chapter ${number}`, date: '2026-11-26', type: 'tvEpisode',
    series: { id: 'tt4000000', title: 'A series', date: '2023-01-01', season: 1, episode: number },
  })) };
  let titles = [...boundaries, ...withdrawn, series];
  const { store, config, dataDir } = await setup(t, async () => result(titles), { clock: () => clock });
  assert.deepEqual(store.pageData().feeds[0].dateRange, { start: '2024-01-01', end: '2029-12-31' });
  await store.refresh();
  titles = [...boundaries, series];
  clock = new Date('2026-10-21T00:00:00Z');
  await store.refresh();
  const archive = store.snapshot.combined.events;
  const publication = store.feed('all');
  const group = `${series.id}-2026-11-26`;
  assert.deepEqual(publication.dateRange, { start: '2024-01-01', end: '2029-12-31' });
  assert.equal(publication.modifiedAt, clock.toISOString());
  assert.equal(publication.updatedAt, clock.toISOString());
  assert(publication.description.includes('2024-01-01 through 2029-12-31'));
  assert.deepEqual(Object.keys(publication.events).sort(), [boundaries[1].id, boundaries[2].id, group].sort());
  assert.equal(publication.events[withdrawn[1].id], undefined);
  assert.equal(archive[withdrawn[1].id].status, 'CANCELLED');
  assert.equal(archive[withdrawn[1].id].sequence, 1);
  for (const [id, event] of Object.entries(publication.events)) assert.equal(event, archive[id], 'publication retains the archived event object and revisions');
  assert.deepEqual(publication.events[group].episodeIds, series.episodes.map((episode) => episode.id));
  assert.equal(publication.events[group].description, 'https://www.imdb.com/title/tt4000000/\n\nInterests: one, two\n\nS01E01: Chapter 1\nS01E02: Chapter 2');
  for (const slug of ['one', 'two']) {
    assert.equal(Object.keys(store.feed(slug).events).length, 6);
    assert.equal(store.feed(slug).events[boundaries[0].id].status, 'CONFIRMED');
    assert.equal(store.feed(slug).events[boundaries[3].id].status, 'CONFIRMED');
    for (const removed of withdrawn) {
      assert.equal(store.feed(slug).events[removed.id], undefined);
      assert.equal(store.snapshot.sources[slug].events[removed.id].status, 'CANCELLED');
    }
    assert.equal(store.feed(slug).dateRange, undefined);
    for (const [id, event] of Object.entries(store.feed(slug).events)) assert.equal(event, store.snapshot.sources[slug].events[id]);
  }
  const page = store.pageData();
  assert.equal(page.feeds[0].count, 3);
  assert.equal(page.feeds[1].count, 6);
  assert.deepEqual(page.feeds[0].dateRange, publication.dateRange);
  assert.deepEqual(page.upcoming.map((event) => event.id), [group, boundaries[2].id]);
  assert(store.pageData(undefined, 'one').upcoming.some((event) => event.id === boundaries[3].id));
  const saved = JSON.parse(gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz'))));
  assert.deepEqual(saved.combined.events, archive);
  assert.equal(saved.combined.events[withdrawn[0].id].status, 'CANCELLED');
  assert.equal(saved.combined.events[withdrawn[2].id].status, 'CANCELLED');
  const restored = new CalendarStore(config, { logger: quiet, clock: () => clock });
  t.after(() => restored.stop());
  await restored.initialize();
  assert.deepEqual(restored.snapshot.combined.events, archive);
  assert.deepEqual(restored.feed('all').events, publication.events);
});

test('combined publication rolls over at UTC January 1 without refreshing or changing archived events', async (t) => {
  let clock = new Date('2026-12-31T23:59:59.999Z');
  let calls = 0;
  const dates = ['2024-01-01', '2024-12-31', '2025-01-01', '2029-12-31', '2030-01-01', '2030-12-31', '2031-01-01'];
  const titles = dates.map((date, index) => ({ id: `tt${5000000 + index}`, title: `A release ${date}`, date }));
  const { store, config, dataDir } = await setup(t, async () => { calls++; return result(titles); }, { clock: () => clock });
  await store.refresh();
  const archive = store.snapshot.combined.events;
  const archivedBytes = JSON.stringify(archive);
  const disk = await readFile(join(dataDir, 'snapshot.json.gz'));
  const previous = store.feed('all');
  const sourceEvents = store.feed('one').events;
  assert.equal(store.feed('all').events, previous.events, 'repeated requests reuse the same publication map');
  assert.equal(store.feed('all').modifiedAt, previous.modifiedAt);
  assert.deepEqual(Object.values(previous.events).map((event) => event.date), dates.slice(0, 4));
  clock = new Date('2027-01-01T00:00:00Z');
  const current = store.feed('all');
  assert.notEqual(current.events, previous.events);
  assert.equal(store.feed('all').events, current.events, 'the new year also has one stable publication map');
  assert.deepEqual(current.dateRange, { start: '2025-01-01', end: '2030-12-31' });
  assert.deepEqual(Object.values(current.events).map((event) => event.date), dates.slice(2, 6));
  assert.equal(current.modifiedAt, clock.toISOString());
  assert.equal(current.updatedAt, previous.updatedAt, 'publication does not pretend that upstream data was refreshed');
  assert.equal(calls, config.sources.length);
  assert.equal(store.snapshot.combined.events, archive);
  assert.equal(JSON.stringify(archive), archivedBytes);
  assert.equal(store.feed('one').events, sourceEvents);
  for (const [id, event] of Object.entries(current.events)) assert.equal(event, archive[id]);
  assert.deepEqual(await readFile(join(dataDir, 'snapshot.json.gz')), disk, 'year rollover does not rewrite or prune persisted history');
  clock = new Date('2027-06-01T00:00:00Z');
  assert.equal(store.feed('all').events, current.events);
  await store.refresh();
  assert.notEqual(store.feed('all').events, current.events, 'a refreshed archive invalidates the publication cache');
  assert.deepEqual(store.feed('all').events, current.events, 'an unchanged refresh preserves every published event value');
});

test('moving a release outside the combined window revises publication metadata while keeping its full source record', async (t) => {
  let clock = new Date('2026-10-20T00:00:00Z');
  let date = '2026-11-19';
  const { store } = await setup(t, async () => result([{ ...title, date }]), { clock: () => clock });
  await store.refresh();
  const first = store.feed('all');
  const original = first.events[title.id];
  date = '2030-01-01';
  clock = new Date('2026-10-21T00:00:00Z');
  await store.refresh();
  const outside = store.feed('all');
  assert.deepEqual(outside.events, {});
  assert.equal(outside.modifiedAt, clock.toISOString());
  assert(outside.modifiedAt > first.modifiedAt);
  assert.equal(store.feed('all').modifiedAt, outside.modifiedAt, 'repeated requests preserve the publication revision');
  assert.equal(store.snapshot.combined.events[title.id].status, 'CONFIRMED');
  assert.equal(store.snapshot.combined.events[title.id].sequence, original.sequence + 1);
  assert.equal(store.snapshot.combined.events[title.id].createdAt, original.createdAt);
  assert.equal(store.snapshot.combined.events[title.id].date, date);
  assert.equal(store.feed('one').events[title.id].date, date);
  date = '2028-11-19';
  clock = new Date('2026-10-22T00:00:00Z');
  await store.refresh();
  assert.equal(store.feed('all').events[title.id], store.snapshot.combined.events[title.id]);
  assert.equal(store.feed('all').events[title.id].sequence, original.sequence + 2);
  assert.equal(store.feed('all').events[title.id].createdAt, original.createdAt);
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
  const historical = { id: 'tt3456789', title: 'An older release', date: '2023-12-31' };
  const { store } = await setup(t, async (item) => result([
    { ...title, date: item.slug === 'one' ? null : title.date }, unknown,
    { ...historical, date: item.slug === 'one' ? null : historical.date },
  ]));
  await store.refresh();
  const combined = store.pageData().feeds.find((feed) => feed.slug === 'all');
  assert.equal(combined.count, 1);
  assert.equal(combined.omitted, 1);
  assert.equal(store.feed('all').events[historical.id], undefined);
  assert.equal(store.snapshot.combined.events[historical.id].date, historical.date, 'a known historical date does not become TBA when outside the published window');
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
  assert.equal(events[series.id].episodeDescription, 'S01E01: The beginning\nS01E02: Another beginning');
  assert.equal(events[series.id].description, 'https://www.imdb.com/title/tt3456789/\n\nInterests: one, two\n\nS01E01: The beginning\nS01E02: Another beginning');
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
  for (const original of [movie, oldEpisode]) {
    assert.deepEqual(migrated.feed('one').events[original.id], { ...original,
      episodeDescription: '', description: `https://www.imdb.com/title/${original.id}/`,
      sequence: original.sequence + 1, modifiedAt: clock.toISOString() });
  }
  assert.equal(migrated.feed('one').events[cancellation.id], undefined);
  assert.equal(migrated.snapshot.sources.one.events[cancellation.id].sequence, 7);
  assert.equal(migrated.feed('all').events[movie.id].sequence, 4);
  assert.equal(migrated.feed('all').events[episode.id].sequence, 3);
  assert.equal(migrated.feed('all').events[movie.id].description, 'https://www.imdb.com/title/tt1234567/\n\nInterests: one, two');
  await migrated.refresh();
  const combined = migrated.snapshot.combined.events;
  assert.equal(combined[episode.id].status, 'CANCELLED');
  assert.equal(combined[episode.id].sequence, 4);
  assert.equal(combined[episode.id].createdAt, createdAt);
  assert.equal(combined[series.id].titleId, series.id);
  assert.equal(combined[series.id].description, 'https://www.imdb.com/title/tt3456789/\n\nInterests: one, two\n\nS01E01: The beginning');
  assert.deepEqual(combined[series.id].episodeIds, [episode.id]);
  assert.equal(combined[movie.id].sequence, 4);
  assert.equal(combined[movie.id].modifiedAt, clock.toISOString());
  assert.equal(combined[cancellation.id].sequence, 7);
  assert.equal(combined[cancellation.id].status, 'CANCELLED');
  assert.equal(migrated.feed('all').events[episode.id], undefined);
  assert.equal(migrated.feed('all').events[cancellation.id], undefined);
  const bytes = renderCalendar({ events: migrated.feed('all').events });
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
  assert.equal(combined[oldEpisode.id], undefined);
  assert.equal(store.snapshot.combined.events[oldEpisode.id].status, 'CANCELLED');
  assert.equal(store.snapshot.combined.events[oldEpisode.id].sequence, 1);
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

test('combined source changes revise the same release once and date changes retain cancellation history', async (t) => {
  let clock = new Date('2026-10-19T00:00:00Z');
  const followed = [
    { slug: 'marvel', kind: 'interest', id: 'in0000248', label: 'Marvel' },
    { slug: 'star-wars', kind: 'interest', id: 'in0000243', label: 'Star Wars' },
    { slug: 'vince', kind: 'name', id: 'nm0319213', label: 'Vince Gilligan' },
    { slug: 'justin', kind: 'name', id: 'nm1551598', label: 'Justin Roiland' },
  ];
  const parent = { id: 'tt3456789', title: 'A series', date: '2026-11-19', type: 'tvSeries' };
  const first = { id: 'tt4567890', title: 'The beginning', date: parent.date, type: 'tvEpisode',
    series: { id: parent.id, title: parent.title, date: parent.date, season: 1, episode: 1 } };
  const second = { ...first, id: 'tt5678901', title: 'A second chapter', date: '2026-11-26', series: { ...first.series, episode: 2 } };
  const third = { ...second, id: 'tt6789012', title: 'A third chapter', series: { ...first.series, episode: 3 } };
  const next = { ...second, id: 'tt7890123', title: 'Next week', date: '2026-12-03', series: { ...first.series, episode: 4 } };
  const expanded = { ...parent, episodes: [first, second, third, next] };
  const data = { marvel: [title, expanded], 'star-wars': [title, expanded], vince: [title, parent, first, second], justin: [title, third, next] };
  const { store, config } = await setup(t, async (source) => result(data[source.slug]), { clock: () => clock });
  config.sources = followed;
  await store.refresh();
  const initial = structuredClone(store.feed('all').events);
  assert.equal(Object.values(initial).filter((event) => event.status === 'CONFIRMED').length, 4);
  assert.deepEqual(initial[`${parent.id}-${next.date}`].sourceLabels.people, ['Justin Roiland']);
  assert.deepEqual(store.pageData().upcoming.find((event) => event.id === `${parent.id}-${next.date}`).sources, ['Marvel', 'Star Wars', 'Justin Roiland']);
  const bytes = renderCalendar({ events: initial });
  clock = new Date('2026-10-20T00:00:00Z');
  await store.refresh();
  assert.equal(renderCalendar({ events: store.feed('all').events }), bytes);

  data.vince = [];
  clock = new Date('2026-10-21T00:00:00Z');
  await store.refresh();
  const removed = structuredClone(store.feed('all').events);
  assert.equal(Object.keys(removed).length, 4);
  for (const id of [title.id, parent.id, `${parent.id}-${second.date}`]) {
    assert.equal(removed[id].sequence, initial[id].sequence + 1);
    assert.equal(removed[id].createdAt, initial[id].createdAt);
    assert(!removed[id].description.includes('Vince Gilligan'));
  }
  assert.deepEqual(removed[`${parent.id}-${next.date}`], initial[`${parent.id}-${next.date}`]);

  next.date = '2026-12-10';
  clock = new Date('2026-10-22T00:00:00Z');
  await store.refresh();
  const moved = store.feed('all').events;
  assert.equal(moved[`${parent.id}-2026-12-03`], undefined);
  assert.equal(store.snapshot.combined.events[`${parent.id}-2026-12-03`].status, 'CANCELLED');
  assert.equal(store.snapshot.combined.events[`${parent.id}-2026-12-03`].sequence, 1);
  assert.equal(moved[`${parent.id}-2026-12-10`].status, 'CONFIRMED');
  assert.deepEqual(moved[`${parent.id}-2026-12-10`].episodeIds, [next.id]);
  assert.equal(moved[`${parent.id}-2026-12-10`].description, 'https://www.imdb.com/title/tt3456789/\n\nInterests: Marvel, Star Wars\nPeople: Justin Roiland\n\nS01E04: Next week');
  const restored = new CalendarStore(config, { logger: quiet, clock: () => clock });
  await restored.initialize();
  assert.equal(renderCalendar({ events: restored.feed('all').events }), renderCalendar({ events: moved }));
});

test('global exclusions migrate legacy memberships, retry failures, and cancel excluded releases while preserving history', async (t) => {
  let clock = new Date('2026-10-20T00:00:00Z');
  const interest = { slug: 'marvel', kind: 'interest', id: 'in0000248', label: 'Marvel' };
  const person = { slug: 'person', kind: 'name', id: 'nm0319213', label: 'A person' };
  const excluded = { id: 'tt2345678', title: 'A person-only news title', date: '2026-11-20' };
  const interestExcluded = { id: 'tt7890123', title: 'An interest-only short film', date: '2026-11-21' };
  const parent = { id: 'tt3456789', title: 'An interest-matched talk show', date: '2026-11-19', type: 'tvSeries' };
  const first = { id: 'tt4567890', title: 'The first conversation', date: '2026-11-26', type: 'tvEpisode',
    series: { id: parent.id, title: parent.title, date: parent.date, season: 1, episode: 1 } };
  const second = { ...first, id: 'tt5678901', title: 'The second conversation', series: { ...first.series, episode: 2 } };
  const shared = { ...parent, episodes: [first, second] };
  let migrating = false;
  let broken = false;
  const calls = [];
  const loader = async (source) => {
    calls.push(source.slug);
    if (broken) throw new Error('HTTP 429');
    if (source.kind === 'interest') return result(migrating ? [] : [shared, interestExcluded]);
    return result(migrating ? [title] : [title, excluded, parent, first, second]);
  };
  const { store, config } = await setup(t, loader, { clock: () => clock });
  config.sources = [interest, person];
  await store.refresh();
  for (const saved of Object.values(store.snapshot.sources)) delete saved.exclusions;
  store.snapshot.sources.person.excludedInterestIds = ['in0000211', 'in0000127'];
  const withdrawn = { id: 'tt6789012', titleId: 'tt6789012', title: 'An earlier removed release', date: '2026-11-18',
    description: '', episodeDescription: '', episodeIds: [], createdAt: clock.toISOString(), modifiedAt: clock.toISOString(), sequence: 7, status: 'CANCELLED' };
  store.snapshot.combined.events[withdrawn.id] = withdrawn;
  await store.persist();
  const previousPerson = structuredClone(store.feed('person').events);
  const previousInterest = structuredClone(store.feed('marvel').events);
  const previousCombined = structuredClone(store.feed('all').events);
  const previousBytes = renderCalendar({ events: previousCombined });
  calls.length = 0;
  migrating = true;
  broken = true;
  clock = new Date('2026-10-20T00:05:00Z');
  const migrated = new CalendarStore(config, { logger: quiet, clock: () => clock, loader });
  t.after(() => migrated.stop());
  await migrated.initialize();
  assert.equal(migrated.feed('person').stale, true, 'a fresh legacy membership still needs the current query policy');
  assert.equal(migrated.feed('marvel').stale, true, 'interests also need the current query policy');
  assert.equal(migrated.feed('all').stale, true);
  assert.equal(renderCalendar({ events: migrated.feed('all').events }), previousBytes);
  await migrated.refresh({ force: false });
  assert.deepEqual(calls, ['marvel', 'person'], 'policy migration immediately refreshes both kinds of fresh memberships');
  assert.equal(migrated.snapshot.sources.marvel.exclusions, undefined);
  assert.equal(migrated.snapshot.sources.person.exclusions, undefined);
  assert.deepEqual(migrated.snapshot.sources.person.excludedInterestIds, ['in0000211', 'in0000127']);
  assert.deepEqual(migrated.feed('person').events, previousPerson);
  assert.deepEqual(migrated.feed('marvel').events, previousInterest);
  assert.deepEqual(migrated.feed('all').events, previousCombined);
  assert.equal(migrated.snapshot.sources.person.lastSuccessAt, '2026-10-20T00:00:00.000Z');
  const failedSnapshot = JSON.parse(gunzipSync(await readFile(join(config.dataDir, 'snapshot.json.gz'))));
  assert.equal(failedSnapshot.sources.marvel.exclusions, undefined);
  assert.equal(failedSnapshot.sources.person.exclusions, undefined);
  assert.deepEqual(failedSnapshot.sources.person.excludedInterestIds, ['in0000211', 'in0000127']);
  clock = new Date('2026-10-20T00:10:00Z');
  broken = false;
  await migrated.refresh({ force: false });
  assert.deepEqual(calls, ['marvel', 'person'], 'a failed policy migration honors the retry interval');
  assert.deepEqual(migrated.feed('all').events, previousCombined);

  clock = new Date('2026-10-20T00:35:00Z');
  await migrated.refresh({ force: false });
  assert.deepEqual(calls, ['marvel', 'person', 'marvel', 'person']);
  for (const source of config.sources) assert.deepEqual(migrated.snapshot.sources[source.slug].exclusions, TITLE_EXCLUSIONS);
  assert.equal(migrated.snapshot.sources.person.excludedInterestIds, undefined);
  assert.equal(migrated.feed('person').stale, false);
  assert.equal(migrated.feed('marvel').stale, false);
  assert.equal(migrated.feed('all').stale, false);
  assert.deepEqual(migrated.snapshot.sources.person.titles, [title]);
  assert.deepEqual(migrated.snapshot.sources.marvel.titles, []);
  assert.deepEqual(migrated.feed('marvel').events, {});
  const combined = migrated.feed('all').events;
  assert.equal(migrated.feed('person').events[excluded.id], undefined);
  assert.equal(combined[excluded.id], undefined);
  assert.equal(combined[interestExcluded.id], undefined);
  for (const [before, after] of [[previousPerson[excluded.id], migrated.snapshot.sources.person.events[excluded.id]],
    [previousInterest[interestExcluded.id], migrated.snapshot.sources.marvel.events[interestExcluded.id]],
    [previousCombined[excluded.id], migrated.snapshot.combined.events[excluded.id]],
    [previousCombined[interestExcluded.id], migrated.snapshot.combined.events[interestExcluded.id]]]) {
    assert.equal(after.id, before.id);
    assert.equal(after.createdAt, before.createdAt);
    assert.equal(after.status, 'CANCELLED');
    assert.equal(after.sequence, before.sequence + 1);
    assert.equal(after.modifiedAt, clock.toISOString());
  }
  const groupId = `${parent.id}-${first.date}`;
  for (const id of [parent.id, groupId]) {
    assert.equal(migrated.feed('person').events[id], undefined);
    assert.equal(migrated.snapshot.sources.person.events[id].status, 'CANCELLED');
    assert.equal(migrated.snapshot.sources.person.events[id].sequence, previousPerson[id].sequence + 1);
    assert.equal(migrated.snapshot.sources.marvel.events[id].status, 'CANCELLED');
    assert.equal(migrated.snapshot.sources.marvel.events[id].sequence, previousInterest[id].sequence + 1);
    assert.equal(combined[id], undefined);
    const archived = migrated.snapshot.combined.events[id];
    assert.equal(archived.status, 'CANCELLED');
    assert.equal(archived.sequence, previousCombined[id].sequence + 1);
    assert.equal(archived.createdAt, previousCombined[id].createdAt);
  }
  assert.deepEqual(migrated.snapshot.combined.events[groupId].episodeIds, [first.id, second.id]);
  assert.deepEqual(migrated.snapshot.combined.events[withdrawn.id], withdrawn);
  assert.deepEqual(combined[title.id], previousCombined[title.id], 'unaffected releases retain every revision field');
  assert.equal(migrated.pageData().upcoming.find((event) => event.id === groupId), undefined);
  assert.deepEqual(migrated.pageData(undefined, 'marvel').upcoming, []);
  const bytes = renderCalendar({ events: combined });
  clock = new Date('2026-10-20T01:35:00Z');
  await migrated.refresh({ force: false });
  assert.deepEqual(calls, ['marvel', 'person', 'marvel', 'person'], 'current policy snapshots keep the ordinary refresh interval');
  assert.equal(renderCalendar({ events: migrated.feed('all').events }), bytes);
  const restored = new CalendarStore(config, { logger: quiet, clock: () => clock, loader });
  t.after(() => restored.stop());
  await restored.initialize();
  for (const source of config.sources) assert.deepEqual(restored.snapshot.sources[source.slug].exclusions, TITLE_EXCLUSIONS);
  assert.equal(restored.snapshot.sources.person.excludedInterestIds, undefined);
  assert.equal(restored.feed('person').stale, false);
  assert.equal(restored.feed('marvel').stale, false);
  assert.deepEqual(restored.snapshot.combined.events[withdrawn.id], withdrawn);
  assert.equal(renderCalendar({ events: restored.feed('all').events }), bytes);
  await restored.refresh({ force: false });
  assert.deepEqual(calls, ['marvel', 'person', 'marvel', 'person']);
  broken = true;
  await restored.refresh();
  for (const source of config.sources) assert.deepEqual(restored.snapshot.sources[source.slug].exclusions, TITLE_EXCLUSIONS, 'later failures retain the policy of the last good data');
  assert.equal(restored.feed('person').stale, true);
  assert.equal(restored.feed('marvel').stale, true);
  assert.equal(renderCalendar({ events: restored.feed('all').events }), bytes);
});
