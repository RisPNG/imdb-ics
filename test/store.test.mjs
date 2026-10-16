import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const saved = JSON.parse(await readFile(join(dataDir, 'snapshot.json'), 'utf8'));
  saved.sources.one.events[title.id] = null;
  await writeFile(join(dataDir, 'snapshot.json'), JSON.stringify(saved));
  const restored = new CalendarStore({ ...config, eventTimeMode: 'date' }, { logger: quiet });
  await restored.initialize();
  assert.equal(restored.feed('all'), null);
  assert.doesNotThrow(() => restored.pageData());
});

test('existing UTC snapshots migrate to default all-day events once while preserving UIDs and token privacy', async (t) => {
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
  const text = await readFile(join(dataDir, 'snapshot.json'), 'utf8');
  assert(!text.includes('CALENDAR_TOKEN'));
});
