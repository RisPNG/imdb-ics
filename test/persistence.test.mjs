import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, truncate, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync, createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CalendarStore } from '../src/store.mjs';
import { loadConfig } from '../src/config.mjs';
import { reconcileEvents, renderCalendar } from '../src/calendar.mjs';

const quiet = { info() {}, warn() {} };
const source = { slug: 'one', id: 'nm0319213', kind: 'name', label: 'One' };
const createdAt = '2026-10-01T00:00:00.000Z';
const event = { id: 'tt1234567', title: 'A release', date: '2026-11-19',
  createdAt, modifiedAt: createdAt, sequence: 4, status: 'CONFIRMED' };
const legacySnapshot = { version: 1, eventTimeMode: 'date', sources: {
  one: { titles: [{ id: event.id, title: event.title, date: event.date }],
    events: { [event.id]: event }, total: 1, omitted: 0, warnings: [],
    lastSuccessAt: createdAt, lastAttemptAt: createdAt, error: null },
}, combined: { events: { [event.id]: event }, updatedAt: createdAt } };

async function setup(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'release-calendar-persistence-test-'));
  assert.equal(dirname(dataDir), resolve(tmpdir()));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const config = { ...loadConfig({ DATA_DIR: dataDir }), sources: [source] };
  return { dataDir, config };
}

test('migrates legacy JSON with IMDb links and source attribution once while preserving event identity and history', async (t) => {
  const { dataDir, config } = await setup(t);
  await writeFile(join(dataDir, 'snapshot.json'), JSON.stringify(legacySnapshot));
  const changedAt = '2026-10-20T00:00:00.000Z';
  const store = new CalendarStore(config, { logger: quiet, clock: () => new Date(changedAt),
    loader: () => assert.fail('Startup must use the saved snapshot.') });
  await store.initialize();
  const migratedSource = { ...event, episodeDescription: '',
    description: 'https://www.imdb.com/title/tt1234567/', sequence: event.sequence + 1, modifiedAt: changedAt };
  assert.deepEqual(store.feed('one').events[event.id], migratedSource);
  assert.equal(store.feed('all').events[event.id].sequence, event.sequence + 1);
  assert.equal(store.feed('all').events[event.id].createdAt, event.createdAt);
  assert.equal(store.feed('all').events[event.id].description, 'https://www.imdb.com/title/tt1234567/\n\nPeople: One');
  const attributed = renderCalendar({ events: store.feed('all').events });
  assert.equal(store.persistenceError, null);
  await assert.rejects(stat(join(dataDir, 'snapshot.json')), { code: 'ENOENT' });
  const saved = JSON.parse(gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz'))));
  assert.equal(saved.version, 2);
  assert.equal(saved.combined.events[event.id].sequence, event.sequence + 1);
  assert.deepEqual(saved.sources.one.events[event.id], migratedSource);
  const restored = new CalendarStore(config, { logger: quiet });
  await restored.initialize();
  assert.equal(renderCalendar({ events: restored.feed('all').events }), attributed);
  assert.deepEqual(restored.snapshot, saved, 'restarting does not revise descriptions or timestamps again');
});

test('prefers the compressed snapshot over an older legacy file', async (t) => {
  const { dataDir, config } = await setup(t);
  await writeFile(join(dataDir, 'snapshot.json'), JSON.stringify(legacySnapshot));
  const newer = structuredClone(legacySnapshot);
  newer.combined.events[event.id].sequence = 5;
  await writeFile(join(dataDir, 'snapshot.json.gz'), gzipSync(JSON.stringify(newer)));
  const store = new CalendarStore(config, { logger: quiet });
  await store.initialize();
  assert.equal(store.feed('all').events[event.id].sequence, 6);
});

test('existing compressed episode snapshots gain attribution before any refresh and persist it across later restarts', async (t) => {
  const { dataDir, config } = await setup(t);
  const parent = { id: 'tt2345678', title: 'A series', date: '2026-11-19' };
  const episode = { id: 'tt3456789', title: 'A chapter', date: '2026-11-26',
    series: { id: parent.id, title: parent.title, date: parent.date, season: 1, episode: 1 } };
  const titles = [{ id: event.id, title: event.title, date: event.date }, parent, episode];
  const events = reconcileEvents({}, titles, { now: createdAt });
  for (const event of Object.values(events)) {
    event.description = event.episodeDescription;
    delete event.episodeDescription;
  }
  const removed = { ...event, id: 'tt4567890', sequence: 7, status: 'CANCELLED' };
  events[removed.id] = removed;
  const snapshot = { version: 2, eventTimeMode: config.eventTimeMode, sources: {
    one: { titles, events, total: titles.length, omitted: 0, warnings: [], lastSuccessAt: createdAt, lastAttemptAt: createdAt, error: null },
  }, combined: { events, updatedAt: createdAt } };
  await writeFile(join(dataDir, 'snapshot.json.gz'), gzipSync(JSON.stringify(snapshot)));
  const changedAt = '2026-10-19T00:00:00.000Z';
  const store = new CalendarStore(config, { logger: quiet, clock: () => new Date(changedAt), loader: () => assert.fail('Startup must use the saved snapshot.') });
  await store.initialize();
  const migrated = store.feed('all').events;
  assert.equal(migrated[event.id].sequence, events[event.id].sequence + 1);
  assert.equal(migrated[event.id].createdAt, events[event.id].createdAt);
  assert.equal(migrated[event.id].modifiedAt, changedAt);
  assert.equal(migrated[`${parent.id}-${episode.date}`].description, 'https://www.imdb.com/title/tt2345678/\n\nPeople: One\n\nS01E01: A chapter');
  assert.equal(migrated[`${parent.id}-${episode.date}`].episodeDescription, 'S01E01: A chapter');
  assert.equal(migrated[removed.id], undefined);
  assert.equal(store.feed('one').events[removed.id], undefined);
  assert.equal(store.snapshot.combined.events[removed.id].sequence, 7);
  assert.equal(store.snapshot.combined.events[removed.id].status, 'CANCELLED');
  assert.deepEqual(store.snapshot.combined.events[removed.id], { ...removed,
    titleId: removed.id, description: '', episodeDescription: '', episodeIds: [] });
  assert.deepEqual(store.snapshot.sources.one.events[removed.id], removed);
  for (const [id, previous] of Object.entries(events)) {
    if (previous.status !== 'CONFIRMED') continue;
    const updated = store.feed('one').events[id];
    assert.deepEqual(updated, { ...previous, episodeDescription: previous.description,
      description: [`https://www.imdb.com/title/${previous.titleId}/`, previous.description].filter(Boolean).join('\n\n'),
      sequence: previous.sequence + 1, modifiedAt: changedAt });
  }
  const persisted = JSON.parse(gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz'))));
  assert.deepEqual(persisted.combined.events, store.snapshot.combined.events);
  assert.deepEqual(persisted.sources.one.events, store.snapshot.sources.one.events);
  const bytes = renderCalendar({ events: migrated });
  const sourceBytes = renderCalendar({ events: store.feed('one').events });
  const restored = new CalendarStore(config, { logger: quiet, clock: () => new Date('2026-10-19T01:00:00Z') });
  await restored.initialize();
  assert.equal(renderCalendar({ events: restored.feed('all').events }), bytes);
  assert.equal(renderCalendar({ events: restored.feed('one').events }), sourceBytes);
  assert.equal(restored.feed('all').events[event.id].sequence, migrated[event.id].sequence);
});

test('already attributed compressed snapshots add IMDb links once without changing grouped releases or cancellation history', async (t) => {
  const { dataDir, config } = await setup(t);
  config.sources.unshift({ slug: 'marvel', id: 'in0000248', kind: 'interest', label: 'Marvel' });
  const parent = { id: 'tt2345678', title: 'A series', date: '2026-11-19' };
  const episodes = [1, 2].map((number) => ({ id: `tt${3456789 + number}`, title: `Chapter ${number}`, date: '2026-11-26',
    series: { id: parent.id, title: parent.title, date: parent.date, season: 1, episode: number } }));
  const titles = [parent, ...episodes];
  const memberships = config.sources.map((source) => ({ ...source, titles }));
  const sourceEvents = reconcileEvents({}, titles, { now: createdAt });
  const combinedEvents = reconcileEvents({}, titles, { now: createdAt, sources: memberships });
  for (const events of [sourceEvents, combinedEvents]) {
    for (const event of Object.values(events)) {
      event.description = event.description.replace(/^https:\/\/www\.imdb\.com\/title\/tt\d+\/(?:\n\n)?/, '');
      event.sequence = 2;
    }
  }
  const removed = { ...event, id: 'tt4567890', titleId: 'tt4567890', description: 'A retired release',
    episodeDescription: 'A retired release', episodeIds: [], sequence: 7, status: 'CANCELLED' };
  sourceEvents[removed.id] = removed;
  combinedEvents[removed.id] = removed;
  const savedSource = { titles, events: sourceEvents, total: titles.length, omitted: 0, warnings: [],
    lastSuccessAt: createdAt, lastAttemptAt: createdAt, error: null };
  const snapshot = { version: 2, eventTimeMode: config.eventTimeMode,
    sources: { marvel: savedSource, one: savedSource }, combined: { events: combinedEvents, updatedAt: createdAt } };
  await writeFile(join(dataDir, 'snapshot.json.gz'), gzipSync(JSON.stringify(snapshot)));
  const changedAt = '2026-10-20T00:00:00.000Z';
  const store = new CalendarStore(config, { logger: quiet, clock: () => new Date(changedAt),
    loader: () => assert.fail('Description migration must not request IMDb.') });
  await store.initialize();
  const groupId = `${parent.id}-${episodes[0].date}`;
  for (const [slug, previous] of [['marvel', sourceEvents], ['one', sourceEvents], ['all', combinedEvents]]) {
    const feed = store.feed(slug);
    assert.deepEqual(Object.keys(feed.events), [parent.id, groupId]);
    for (const migrated of Object.values(feed.events)) {
      assert.deepEqual(migrated, { ...previous[migrated.id],
        description: [`https://www.imdb.com/title/${migrated.titleId}/`, previous[migrated.id].description].filter(Boolean).join('\n\n'),
        sequence: 3, modifiedAt: changedAt });
    }
  }
  assert.equal(store.feed('all').events[groupId].description, 'https://www.imdb.com/title/tt2345678/\n\nInterests: Marvel\nPeople: One\n\nS01E01: Chapter 1\nS01E02: Chapter 2');
  assert.deepEqual(store.snapshot.combined.events[removed.id], removed);
  assert.deepEqual(store.snapshot.sources.one.events[removed.id], removed);
  const persisted = JSON.parse(gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz'))));
  assert.deepEqual(persisted, store.snapshot);
  const restored = new CalendarStore(config, { logger: quiet, clock: () => new Date('2026-10-20T01:00:00Z') });
  await restored.initialize();
  assert.deepEqual(restored.snapshot, persisted, 'restart preserves the migrated descriptions and sequence values');
});

test('source-only startup persists IMDb links without regrouping saved episode UIDs before a complete combined snapshot', async (t) => {
  const { dataDir, config } = await setup(t);
  config.sources.push({ slug: 'pending', id: 'nm1551598', kind: 'name', label: 'Pending' });
  const episode = { ...event, id: 'tt2345678', description: 'S01E02: A chapter' };
  const snapshot = structuredClone(legacySnapshot);
  snapshot.sources.one.titles = [{ id: episode.id, title: episode.title, date: episode.date,
    series: { id: 'tt3456789', title: 'A series', date: '2026-11-12', season: 1, episode: 2 } }];
  snapshot.sources.one.events = { [episode.id]: episode };
  snapshot.combined = null;
  await writeFile(join(dataDir, 'snapshot.json.gz'), gzipSync(JSON.stringify(snapshot)));
  const changedAt = '2026-10-20T00:00:00.000Z';
  const store = new CalendarStore(config, { logger: quiet, clock: () => new Date(changedAt),
    loader: () => assert.fail('Startup must keep the saved source membership.') });
  await store.initialize();
  assert.equal(store.feed('all'), null);
  assert.equal(store.feed('pending'), null);
  assert.deepEqual(store.feed('one').events, { [episode.id]: { ...episode,
    episodeDescription: episode.description, description: 'https://www.imdb.com/title/tt2345678/\n\nS01E02: A chapter',
    sequence: episode.sequence + 1, modifiedAt: changedAt } });
  const persisted = JSON.parse(gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz'))));
  assert.deepEqual(persisted, store.snapshot, 'a source migration is saved even when the combined feed does not yet exist');
  const restored = new CalendarStore(config, { logger: quiet, clock: () => new Date('2026-10-20T01:00:00Z') });
  await restored.initialize();
  assert.deepEqual(restored.snapshot, persisted);
});

test('streamed snapshots preserve Unicode, quoted text, backslashes, newlines, and cancellation history byte-for-byte', async (t) => {
  const { dataDir, config } = await setup(t);
  config.sources = [{ ...source, label: "Renée O'Connor" }];
  const parent = { id: 'tt2345678', title: 'Café "Stories" \\ Paths', date: '2026-11-19' };
  const chapter = { id: 'tt3456789', title: 'The "long" path \\ home\n終わり', date: parent.date,
    series: { id: parent.id, title: parent.title, date: parent.date, season: 1, episode: 1 } };
  const store = new CalendarStore(config, { clock: () => new Date(createdAt), logger: quiet,
    loader: async () => ({ titles: [parent, chapter], total: 2, warnings: [] }) });
  await store.initialize();
  await store.refresh();
  const cancelled = { ...store.feed('all').events[parent.id], id: 'tt4567890', titleId: 'tt4567890', sequence: 7, status: 'CANCELLED' };
  store.snapshot.combined.events = { ...store.snapshot.combined.events, [cancelled.id]: cancelled };
  await store.persist();
  assert.equal(store.persistenceError, null);
  const expected = structuredClone(store.snapshot);
  const calendar = renderCalendar({ events: store.feed('all').events });
  assert.equal(store.feed('all').events[cancelled.id], undefined);
  assert.equal(store.feed('all').events[parent.id].description, `https://www.imdb.com/title/tt2345678/\n\nPeople: Renée O'Connor\n\nS01E01: ${chapter.title}`);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz')))), expected);
  const restored = new CalendarStore(config, { clock: () => new Date(createdAt), logger: quiet });
  await restored.initialize();
  assert.deepEqual(restored.snapshot, expected);
  assert.equal(renderCalendar({ events: restored.feed('all').events }), calendar);
});

for (const [name, bytes] of [
  ['malformed', Buffer.from('not gzip')],
  ['truncated', gzipSync(JSON.stringify(legacySnapshot)).subarray(0, -4)],
]) {
  test(`rejects a ${name} compressed snapshot without falling back to older JSON`, async (t) => {
    const { dataDir, config } = await setup(t);
    const warnings = [];
    await writeFile(join(dataDir, 'snapshot.json'), JSON.stringify(legacySnapshot));
    await writeFile(join(dataDir, 'snapshot.json.gz'), bytes);
    const store = new CalendarStore(config, { logger: { ...quiet, warn(message) { warnings.push(message); } } });
    await store.initialize();
    assert.equal(store.feed('all'), null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /could not be loaded/);
  });
}

for (const [filename, limit] of [['snapshot.json.gz', 16 * 1024 * 1024], ['snapshot.json', 96 * 1024 * 1024]]) {
  test(`rejects ${filename} above its file-size bound before reading its contents`, async (t) => {
    const { dataDir, config } = await setup(t);
    const warnings = [];
    const path = join(dataDir, filename);
    await writeFile(path, '');
    await truncate(path, limit + 1);
    const store = new CalendarStore(config, { logger: { ...quiet, warn(message) { warnings.push(message); } } });
    await store.initialize();
    assert.equal(store.feed('all'), null);
    assert.match(warnings[0], /exceeds.*limit/);
  });
}

test('bounds decompression of a small gzip file whose expanded contents exceed 96 MiB', async (t) => {
  const { dataDir, config } = await setup(t);
  const warnings = [];
  const block = Buffer.alloc(1024 * 1024, 32);
  await pipeline(Readable.from([...Array(96).fill(block), Buffer.from(' ')]), createGzip(),
    createWriteStream(join(dataDir, 'snapshot.json.gz')));
  assert((await stat(join(dataDir, 'snapshot.json.gz'))).size < 1024 * 1024);
  const store = new CalendarStore(config, { logger: { ...quiet, warn(message) { warnings.push(message); } } });
  await store.initialize();
  assert.equal(store.feed('all'), null);
  assert.match(warnings[0], /could not be loaded.*larger than/i);
});

test('an oversized raw snapshot preserves the last saved file and removes temporary output', async (t) => {
  const { dataDir, config } = await setup(t);
  const store = new CalendarStore(config, { logger: quiet });
  store.snapshot = structuredClone(legacySnapshot);
  await store.persist();
  const original = await readFile(join(dataDir, 'snapshot.json.gz'));
  store.snapshot.padding = Array(96 * 16).fill('x'.repeat(64 * 1024));
  await store.persist();
  delete store.snapshot.padding;
  assert.match(store.persistenceError, /96 MiB/);
  assert.deepEqual(await readFile(join(dataDir, 'snapshot.json.gz')), original);
  assert.deepEqual(await readdir(dataDir), ['snapshot.json.gz']);
});
test('an oversized compressed snapshot preserves the last saved file', async (t) => {
  const { dataDir, config } = await setup(t);
  const store = new CalendarStore(config, { logger: quiet });
  store.snapshot = structuredClone(legacySnapshot);
  await store.persist();
  const original = await readFile(join(dataDir, 'snapshot.json.gz'));
  store.snapshot.padding = randomBytes(17 * 1024 * 1024).toString('base64');
  await store.persist();
  delete store.snapshot.padding;
  assert.match(store.persistenceError, /16 MiB compressed/);
  assert.deepEqual(await readFile(join(dataDir, 'snapshot.json.gz')), original);
  assert.deepEqual(await readdir(dataDir), ['snapshot.json.gz']);
});
