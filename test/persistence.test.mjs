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
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { CalendarStore } from '../src/store.mjs';
import { loadConfig } from '../src/config.mjs';
import { renderCalendar } from '../src/calendar.mjs';

const execFile = promisify(execFileCallback);
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

test('migrates legacy JSON to compressed storage without changing event history', async (t) => {
  const { dataDir, config } = await setup(t);
  await writeFile(join(dataDir, 'snapshot.json'), JSON.stringify(legacySnapshot));
  const store = new CalendarStore(config, { logger: quiet });
  await store.initialize();
  const original = renderCalendar({ events: legacySnapshot.combined.events });
  assert.equal(renderCalendar({ events: store.feed('all').events }), original);
  await store.persist();
  assert.equal(store.persistenceError, null);
  await assert.rejects(stat(join(dataDir, 'snapshot.json')), { code: 'ENOENT' });
  const saved = JSON.parse(gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz'))));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.combined.events[event.id], event);
  const restored = new CalendarStore(config, { logger: quiet });
  await restored.initialize();
  assert.equal(renderCalendar({ events: restored.feed('all').events }), original);
});

test('prefers the compressed snapshot over an older legacy file', async (t) => {
  const { dataDir, config } = await setup(t);
  await writeFile(join(dataDir, 'snapshot.json'), JSON.stringify(legacySnapshot));
  const newer = structuredClone(legacySnapshot);
  newer.combined.events[event.id].sequence = 5;
  await writeFile(join(dataDir, 'snapshot.json.gz'), gzipSync(JSON.stringify(newer)));
  const store = new CalendarStore(config, { logger: quiet });
  await store.initialize();
  assert.equal(store.feed('all').events[event.id].sequence, 5);
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

for (const [filename, limit] of [['snapshot.json.gz', 16 * 1024 * 1024], ['snapshot.json', 64 * 1024 * 1024]]) {
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

test('bounds decompression of a small gzip file whose expanded contents exceed 64 MiB', async (t) => {
  const { dataDir, config } = await setup(t);
  const warnings = [];
  const block = Buffer.alloc(1024 * 1024, 32);
  await pipeline(Readable.from([...Array(64).fill(block), Buffer.from(' ')]), createGzip(),
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
  store.snapshot.padding = 'x'.repeat(64 * 1024 * 1024);
  await store.persist();
  delete store.snapshot.padding;
  assert.match(store.persistenceError, /64 MiB/);
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

test('53 overlapping filmographies round-trip more than 16 MiB under the configured Node heap', async (t) => {
  const { dataDir } = await setup(t);
  const code = `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { gunzipSync } from 'node:zlib';
    import { CalendarStore } from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
    import { loadConfig } from ${JSON.stringify(new URL('../src/config.mjs', import.meta.url).href)};
    const dataDir = ${JSON.stringify(dataDir)};
    const sources = Array.from({ length: 53 }, (_, index) => ({ slug: 'person-' + index, id: 'nm' + (1000000 + index), kind: 'name', label: 'Person ' + index }));
    const config = { ...loadConfig({ DATA_DIR: dataDir }), sources };
    const quiet = { info() {}, warn() {} };
    const started = performance.now();
    let store = new CalendarStore(config, { logger: quiet, loader: async (source) => {
      const person = sources.indexOf(source);
      const titles = Array.from({ length: 1500 }, (_, index) => ({ id: 'tt' + (1000000 + (index < 750 ? index : 750 + person * 750 + index - 750)), title: 'A credited release ' + index, date: '2026-11-19', type: 'movie' }));
      return { titles, total: titles.length, omitted: 0, warnings: [] };
    } });
    await store.initialize();
    await store.refresh();
    assert.equal(store.persistenceError, null);
    const sourceEvent = store.feed('person-52').events.tt1039999;
    assert(sourceEvent);
    const count = Object.keys(store.feed('all').events).length;
    const refreshRss = process.memoryUsage().rss;
    store = null;
    globalThis.gc();
    let raw = gunzipSync(await readFile(join(dataDir, 'snapshot.json.gz')));
    const rawBytes = raw.length;
    assert(rawBytes > 16 * 1024 * 1024);
    raw = null;
    globalThis.gc();
    const restored = new CalendarStore(config, { logger: quiet });
    await restored.initialize();
    assert.equal(Object.keys(restored.feed('all').events).length, count);
    assert.equal(Object.keys(restored.feed('person-52').events).length, 1500);
    assert.deepEqual(restored.feed('person-52').events.tt1039999, sourceEvent);
    console.log(JSON.stringify({ rawBytes, count, elapsedMs: Math.round(performance.now() - started), rssMiB: Math.round(Math.max(refreshRss, process.memoryUsage().rss) / 1024 / 1024) }));
  `;
  const { stdout } = await execFile(process.execPath, ['--max-old-space-size=192', '--expose-gc', '--input-type=module', '--eval', code], { timeout: 60_000 });
  const result = JSON.parse(stdout);
  assert(result.rawBytes > 16 * 1024 * 1024);
  assert.equal(result.count, 40_500);
  assert(result.rssMiB < 512, `Scale fixture used ${result.rssMiB} MiB RSS.`);
  t.diagnostic(`53 sources × 1500 credits: ${(result.rawBytes / 1024 / 1024).toFixed(1)} MiB raw, ${result.elapsedMs} ms, ${result.rssMiB} MiB RSS.`);
});
