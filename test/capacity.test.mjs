import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { SOURCES } from '../src/config.mjs';

const execFile = promisify(execFileCallback);

test(`${SOURCES.length} sources preserve full history through policy-driven mass cancellations, streamed HTTP, and restart under the production memory limits`, async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'release-calendar-capacity-test-'));
  const historicalSources = 111;
  const sharedTitles = 487;
  const uniqueTitles = 550;
  const retainedUniqueTitles = uniqueTitles / 2;
  const historicalEvents = sharedTitles + historicalSources * uniqueTitles + 4;
  const expectedEvents = historicalEvents + (SOURCES.length - historicalSources) * 50;
  const expectedCancelled = (historicalSources - 3) * (uniqueTitles - retainedUniqueTitles) + 1;
  const expectedConfirmed = expectedEvents - expectedCancelled;
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const code = `
    import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { get } from 'node:http';
    import { createReadStream } from 'node:fs';
    import { stat } from 'node:fs/promises';
    import { join } from 'node:path';
    import { createGunzip } from 'node:zlib';
    import { setImmediate } from 'node:timers/promises';
    import { CalendarStore } from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
    import { loadConfig } from ${JSON.stringify(new URL('../src/config.mjs', import.meta.url).href)};
    import { createApp } from ${JSON.stringify(new URL('../src/server.mjs', import.meta.url).href)};
    import { calendarChunks } from ${JSON.stringify(new URL('../src/calendar.mjs', import.meta.url).href)};
    import { PEOPLE_EXCLUDED_INTEREST_IDS } from ${JSON.stringify(new URL('../src/imdb.mjs', import.meta.url).href)};
    const dataDir = ${JSON.stringify(dataDir)};
    const sources = Array.from({ length: ${SOURCES.length} }, (_, index) => ({ slug: 'source-' + String.fromCharCode(97 + Math.floor(index / 26), 97 + index % 26),
      id: (index < 3 ? 'in' : 'nm') + (1000000 + index), kind: index < 3 ? 'interest' : 'name', label: (index < 3 ? 'Interest ' : 'Person ') + index }));
    let clock = new Date('2026-10-20T00:00:00.000Z');
    const config = { ...loadConfig({ DATA_DIR: dataDir }), sources };
    const warnings = [];
    const logger = { info() {}, warn(message) { warnings.push(message); } };
    const parent = { id: 'tt9000000000', title: 'A series', date: '2026-11-20', type: 'tvSeries' };
    const episodes = [1, 2, 3, 4].map((number) => ({ id: 'tt' + (9000000000 + number), title: 'Chapter ' + number,
      date: number === 1 ? parent.date : number < 4 ? '2026-11-27' : '2026-12-04', type: 'tvEpisode',
      series: { id: parent.id, title: parent.title, date: parent.date, season: 1, episode: number } }));
    const withdrawn = { id: 'tt9999999000', titleId: 'tt9999999000', title: 'A withdrawn release', date: '2025-01-01',
      description: '', episodeDescription: '', episodeIds: [], createdAt: clock.toISOString(), modifiedAt: clock.toISOString(), sequence: 7, status: 'CANCELLED' };
    const outsideWindow = [
      { id: 'tt9999998000', title: 'A historical release', date: '2023-12-31', type: 'movie' },
      { id: 'tt9999998001', title: 'A later release', date: '2030-01-01', type: 'movie' },
    ];
    const started = performance.now();
    const phase = process.argv[1];
    if (phase === 'seed') {
      const store = new CalendarStore({ ...config, sources: sources.slice(0, ${historicalSources}) }, { clock: () => clock, logger,
        loader: async (source) => {
          const person = sources.indexOf(source);
          const titles = Array.from({ length: ${sharedTitles + uniqueTitles} }, (_, index) => ({
            id: 'tt' + (1000000 + (index < ${sharedTitles} ? index : ${sharedTitles} + person * ${uniqueTitles} + index - ${sharedTitles})),
            title: 'A credited release ' + index + ': An unexpected journey through the city', date: index < ${sharedTitles} ? '2026-11-19' : '2024-11-19', type: 'movie' }));
          if (person < 3) titles.push({ ...parent, episodes });
          else if (person < 7) titles.push(episodes[person - 3]);
          if (person === 0) titles.push(...outsideWindow);
          return { titles, total: titles.length, warnings: [] };
        } });
      await store.initialize();
      await store.refresh();
      for (const saved of Object.values(store.snapshot.sources)) delete saved.excludedInterestIds;
      for (const events of [store.snapshot.combined.events, ...Object.values(store.snapshot.sources).map((saved) => saved.events)]) {
        for (const event of Object.values(events)) {
          if (event.status !== 'CONFIRMED') continue;
          const url = 'https://www.imdb.com/title/' + event.titleId + '/';
          assert(event.description === url || event.description.startsWith(url + '\\n\\n'));
          event.description = event.description === url ? '' : event.description.slice(url.length + 2);
        }
      }
      store.snapshot.combined.events[withdrawn.id] = withdrawn;
      await store.persist();
      assert.equal(store.persistenceError, null);
      let rawBytes = 0;
      for await (const chunk of createReadStream(join(dataDir, 'snapshot.json.gz')).pipe(createGunzip())) rawBytes += chunk.length;
      assert(rawBytes > 64 * 1024 * 1024);
      assert.equal(Object.keys(store.feed('all').events).length, ${historicalEvents - 1});
      assert.equal(Object.keys(store.snapshot.combined.events).length, ${historicalEvents + 2});
      for (const title of outsideWindow) {
        assert.equal(store.feed('all').events[title.id], undefined);
        assert.equal(store.feed(sources[0].slug).events[title.id].status, 'CONFIRMED');
      }
      assert.deepEqual(warnings, []);
      console.log(JSON.stringify({ phase, rawBytes, compressedBytes: (await stat(join(dataDir, 'snapshot.json.gz'))).size, count: Object.keys(store.feed('all').events).length, rssMiB: Math.ceil(process.resourceUsage().maxRSS / 1024), elapsedMs: Math.round(performance.now() - started) }));
      process.exit(0);
    }
    if (phase === 'restart') {
      clock = new Date('2026-10-20T01:00:00.000Z');
      const store = new CalendarStore(config, { clock: () => clock, logger });
      await store.initialize();
      assert.equal(Object.keys(store.feed('all').events).length, ${expectedConfirmed});
      assert.equal(Object.keys(store.snapshot.combined.events).length, ${expectedEvents + 2});
      for (const title of outsideWindow) {
        assert.equal(store.feed('all').events[title.id], undefined);
        assert.equal(store.snapshot.combined.events[title.id].status, 'CONFIRMED');
        assert.equal(store.snapshot.combined.events[title.id].date, title.date);
        assert.equal(store.snapshot.combined.events[title.id].sequence, 1);
        assert.equal(store.feed(sources[0].slug).events[title.id].status, 'CONFIRMED');
      }
      assert.equal(store.feed('all').events[withdrawn.id], undefined);
      assert.deepEqual(store.snapshot.combined.events[withdrawn.id], withdrawn);
      assert.equal(store.feed('all').events.tt1000000.sequence, 3);
      assert.equal(Object.values(store.feed('all').events).filter((event) => event.status === 'CONFIRMED').length, ${expectedConfirmed});
      assert.equal(Object.values(store.feed('all').events).filter((event) => event.status === 'CANCELLED').length, 0);
      assert.equal(Object.values(store.snapshot.combined.events).filter((event) => event.status === 'CANCELLED').length, ${expectedCancelled});
      for (const source of sources) {
        if (source.kind === 'name') assert.deepEqual(store.snapshot.sources[source.slug].excludedInterestIds, PEOPLE_EXCLUDED_INTEREST_IDS);
        assert.equal(store.sourceState(source).status, 'ready');
        assert(Object.values(store.feed(source.slug).events).every((event) => event.status === 'CONFIRMED'));
        assert(Object.values(store.feed(source.slug).events).every((event) => event.description.split('\\n')[0] === 'https://www.imdb.com/title/' + event.titleId + '/'));
      }
      const hash = createHash('sha256');
      for (const chunk of calendarChunks({ name: store.feed('all').label, description: store.feed('all').description, events: store.feed('all').events })) hash.update(chunk);
      const archiveHash = createHash('sha256');
      for (const chunk of calendarChunks({ name: 'Full release archive', events: store.snapshot.combined.events })) archiveHash.update(chunk);
      assert.deepEqual(warnings, []);
      console.log(JSON.stringify({ phase, hash: hash.digest('hex'), archiveHash: archiveHash.digest('hex'), rssMiB: Math.ceil(process.resourceUsage().maxRSS / 1024), elapsedMs: Math.round(performance.now() - started) }));
      process.exit(0);
    }
    let failed = true;
    const attempts = [];
    const app = await createApp(config, { clock: () => clock, logger, loader: async (source) => {
      await setImmediate();
      attempts.push(source.slug);
      if (failed && source === sources[3]) throw new Error('A temporary upstream failure.');
      const previous = app.store.snapshot.sources[source.slug];
      const titles = previous ? structuredClone(previous.titles.filter((title) => source.kind !== 'name' || title.series
        || (Number(title.id.slice(2)) >= ${1000000 + sharedTitles}
          && (Number(title.id.slice(2)) - ${1000000 + sharedTitles}) % ${uniqueTitles} < ${retainedUniqueTitles}))) : Array.from({ length: 50 }, (_, index) => ({
        id: 'tt' + (8000000000 + sources.indexOf(source) * 50 + index), title: 'A newly followed credit ' + index, date: '2026-11-21', type: 'movie' }));
      return { titles, total: titles.length, warnings: [] };
    } });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + app.server.address().port;
    const request = (path, options = {}, paused) => new Promise((resolve, reject) => {
      const requestedAt = performance.now();
      get(origin + path, options, (response) => {
        const headersMs = Math.round(performance.now() - requestedAt);
        const hash = createHash('sha256');
        let bytes = 0;
        let wireBytes = 0;
        response.on('data', (chunk) => { wireBytes += chunk.length; });
        const body = response.headers['content-encoding'] === 'gzip' ? response.pipe(createGunzip()) : response;
        body.on('data', (chunk) => { bytes += chunk.length; hash.update(chunk); });
        if (paused) body.once('data', () => { body.pause(); paused(() => body.resume()); });
        body.on('end', () => resolve({ status: response.statusCode, bytes, wireBytes, hash: hash.digest('hex'), headers: response.headers, headersMs, elapsedMs: Math.round(performance.now() - requestedAt) }));
        body.on('error', reject);
        response.on('error', reject);
      }).on('error', reject);
    });
    let resume;
    let resumeGzip;
    try {
      const historicalIds = Object.keys(app.store.snapshot.combined.events);
      const excludedId = 'tt${1000000 + sharedTitles + 3 * uniqueTitles + retainedUniqueTitles}';
      const formerlyCredited = app.store.feed('all').events[excludedId];
      assert.equal(formerlyCredited.status, 'CONFIRMED');
      assert.equal(app.store.sourceState(sources[3]).status, 'stale');
      assert.equal(app.store.snapshot.sources[sources[3].slug].excludedInterestIds, undefined);
      let coldFinished = false;
      const cold = request('/calendars/all.ics').then((response) => { coldFinished = true; return response; });
      const coldHead = request('/calendars/all.ics', { method: 'HEAD' });
      const healthy = await request('/healthz');
      assert.equal(healthy.status, 200);
      assert.equal(coldFinished, false, 'Health checks must remain responsive during cold calendar generation.');
      const first = await cold;
      assert.equal((await coldHead).headers.etag, first.headers.etag);
      assert.equal(first.status, 200);
      assert.equal(first.headers['x-calendar-stale'], 'true');
      assert.equal(first.headers.etag, '"' + first.hash + '"');
      assert.equal(Number(first.headers['content-length']), first.bytes);
      let received;
      const receiving = new Promise((resolve) => { received = resolve; });
      const slow = request('/calendars/all.ics', {}, (continueReading) => { resume = continueReading; received(); });
      await receiving;
      let receivedGzip;
      const receivingGzip = new Promise((resolve) => { receivedGzip = resolve; });
      const slowGzip = request('/calendars/all.ics', { headers: { 'Accept-Encoding': 'gzip' } }, (continueReading) => { resumeGzip = continueReading; receivedGzip(); });
      await receivingGzip;
      const refreshing = app.store.refresh({ force: false });
      const head = await request('/calendars/all.ics', { method: 'HEAD' });
      assert.equal(head.bytes, 0);
      assert.equal(head.headers.etag, first.headers.etag);
      assert.equal(Number(head.headers['content-length']), first.bytes);
      const conditional = await request('/calendars/all.ics', { headers: { 'If-None-Match': 'W/' + first.headers.etag } });
      assert.equal(conditional.status, 304);
      assert.equal(conditional.bytes, 0);
      assert.equal((await request('/')).status, 200);
      await refreshing;
      resume();
      resumeGzip();
      const old = await slow;
      const oldGzip = await slowGzip;
      assert.equal(old.hash, first.hash);
      assert.equal(oldGzip.headers['content-encoding'], 'gzip');
      assert.equal(oldGzip.headers.etag, 'W/"' + first.hash + '-gzip"');
      assert.equal(oldGzip.headers['content-length'], undefined);
      assert.equal(oldGzip.hash, first.hash);
      assert.equal(oldGzip.bytes, first.bytes);
      assert(oldGzip.wireBytes < first.bytes / 4);
      assert.equal(app.store.persistenceError, null);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /A temporary upstream failure/);
      assert.equal(attempts.length, sources.length - 3);
      assert(sources.slice(0, 3).every((source) => !attempts.includes(source.slug)));
      assert.equal(app.store.feed('all').events[excludedId].status, 'CONFIRMED');
      assert.equal(app.store.snapshot.sources[sources[3].slug].excludedInterestIds, undefined);
      assert.deepEqual(app.store.feed('all').events.tt1000000.sourceLabels.people, ['Person 3']);
      assert.equal(Object.values(app.store.feed('all').events).filter((event) => event.status === 'CANCELLED').length, 0);
      assert.equal(Object.values(app.store.snapshot.combined.events).filter((event) => event.status === 'CANCELLED').length, ${expectedCancelled - (uniqueTitles - retainedUniqueTitles)});
      assert.equal(app.store.feed('all').events[withdrawn.id], undefined);
      assert.deepEqual(app.store.snapshot.combined.events[withdrawn.id], withdrawn);
      assert.equal(Object.keys(app.store.feed('all').events).length, ${expectedConfirmed + uniqueTitles - retainedUniqueTitles});
      const batch = app.store.feed('all').events['tt9000000000-2026-11-27'];
      assert(batch.description.startsWith('https://www.imdb.com/title/tt9000000000/\\n\\n'));
      assert.match(batch.description, /Interests: Interest 0, Interest 1, Interest 2/);
      assert.match(batch.description, /People: Person 4, Person 5/);
      assert.match(batch.description, /S01E02: Chapter 2\\nS01E03: Chapter 3/);
      failed = false;
      clock = new Date('2026-10-20T00:31:00.000Z');
      await app.store.refresh({ force: false });
      assert.equal(app.store.persistenceError, null);
      assert.equal(attempts.length, sources.length - 2);
      assert.equal(attempts.at(-1), sources[3].slug);
      const events = app.store.feed('all').events;
      const archive = app.store.snapshot.combined.events;
      assert(historicalIds.every((id) => archive[id]), 'Filtering must retain every historical UID in the archive.');
      assert.equal(Object.keys(archive).length, ${expectedEvents + 2});
      assert.deepEqual(app.store.feed('all').dateRange, { start: '2024-01-01', end: '2029-12-31' });
      for (const title of outsideWindow) {
        assert.equal(events[title.id], undefined);
        assert.equal(archive[title.id].status, 'CONFIRMED');
        assert.equal(archive[title.id].date, title.date);
        assert.equal(archive[title.id].sequence, 1);
        assert.equal(app.store.feed(sources[0].slug).events[title.id].status, 'CONFIRMED');
      }
      assert.equal(events[excludedId], undefined);
      assert.equal(app.store.feed(sources[3].slug).events[excludedId], undefined);
      assert.equal(archive[excludedId].status, 'CANCELLED');
      assert.equal(archive[excludedId].createdAt, formerlyCredited.createdAt);
      assert.equal(archive[excludedId].sequence, formerlyCredited.sequence + 1);
      assert.equal(app.store.snapshot.sources[sources[3].slug].events[excludedId].status, 'CANCELLED');
      assert.equal(events.tt1000000.status, 'CONFIRMED');
      assert.deepEqual(events.tt1000000.sourceLabels, { interests: ['Interest 0', 'Interest 1', 'Interest 2'], people: [] });
      assert.equal(events.tt1000000.description, 'https://www.imdb.com/title/tt1000000/\\n\\nInterests: Interest 0, Interest 1, Interest 2');
      assert(Object.values(events).every((event) => event.description.startsWith('https://www.imdb.com/title/' + event.titleId + '/\\n\\n')));
      assert.equal(app.store.feed('all').stale, false);
      for (const source of sources) {
        if (source.kind === 'name') assert.deepEqual(app.store.snapshot.sources[source.slug].excludedInterestIds, PEOPLE_EXCLUDED_INTEREST_IDS);
        else assert.equal(app.store.snapshot.sources[source.slug].excludedInterestIds, undefined);
      }
      const confirmed = Object.values(events).filter((event) => event.status === 'CONFIRMED').length;
      const cancelled = Object.values(events).filter((event) => event.status === 'CANCELLED').length;
      const archivedCancelled = Object.values(archive).filter((event) => event.status === 'CANCELLED').length;
      assert.equal(confirmed, ${expectedConfirmed});
      assert.equal(cancelled, 0);
      assert.equal(archivedCancelled, ${expectedCancelled});
      let rawBytes = 0;
      for await (const chunk of createReadStream(join(dataDir, 'snapshot.json.gz')).pipe(createGunzip())) rawBytes += chunk.length;
      const compressedBytes = (await stat(join(dataDir, 'snapshot.json.gz'))).size;
      assert(compressedBytes < 16 * 1024 * 1024);
      let final;
      for (let index = 0; index < 3; index++) {
        final = await request('/calendars/all.ics');
        assert.equal(final.headers.etag, '"' + final.hash + '"');
        assert.equal(Number(final.headers['content-length']), final.bytes);
      }
      assert.notEqual(final.hash, first.hash);
      const gzip = await request('/calendars/all.ics', { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(gzip.status, 200);
      assert.equal(gzip.headers['content-encoding'], 'gzip');
      assert.equal(gzip.headers.vary, 'Accept-Encoding');
      assert.equal(gzip.headers.etag, 'W/"' + final.hash + '-gzip"');
      assert.equal(gzip.hash, final.hash);
      assert.equal(gzip.bytes, final.bytes);
      assert(gzip.wireBytes < final.bytes / 4);
      const individual = app.store.feed(sources[0].slug);
      const individualHash = createHash('sha256');
      for (const chunk of calendarChunks({ name: individual.label, description: individual.description, events: individual.events })) individualHash.update(chunk);
      const individualIdentity = await request('/calendars/' + sources[0].slug + '.ics');
      const individualGzip = await request('/calendars/' + sources[0].slug + '.ics', { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(individualIdentity.hash, individualHash.digest('hex'));
      assert.equal(individualGzip.hash, individualIdentity.hash);
      assert.equal(individualGzip.bytes, individualIdentity.bytes);
      assert.equal(individualGzip.headers['content-encoding'], 'gzip');
      const archiveHash = createHash('sha256');
      for (const chunk of calendarChunks({ name: 'Full release archive', events: archive })) archiveHash.update(chunk);
      const current = await request('/calendars/all.ics', { headers: { 'If-None-Match': first.headers.etag, 'If-Modified-Since': 'Wed, 01 Jan 2099 00:00:00 GMT' } });
      assert.equal(current.status, 200);
      assert.equal(current.hash, final.hash);
      await new Promise((resolve, reject) => {
        get(origin + '/calendars/all.ics', { headers: { 'Accept-Encoding': 'gzip' } }, (response) => {
          assert.equal(response.headers['content-encoding'], 'gzip');
          response.on('error', () => {});
          response.once('data', () => { response.destroy(); resolve(); });
        }).on('error', reject);
      });
      assert.equal((await request('/healthz')).status, 200);
      assert.equal((await request('/readyz')).status, 200);
      assert.equal(warnings.length, 1);
      console.log(JSON.stringify({ phase, hash: final.hash, archiveHash: archiveHash.digest('hex'), bytes: final.bytes, gzipBytes: gzip.wireBytes, identityMs: final.elapsedMs, gzipHeadersMs: gzip.headersMs, gzipMs: gzip.elapsedMs, rawBytes, compressedBytes, count: Object.keys(events).length, archivedCount: Object.keys(archive).length, archivedCancelled, confirmed, cancelled, coldHeadersMs: first.headersMs, warmHeadMs: head.headersMs, healthMs: healthy.headersMs, rssMiB: Math.ceil(process.resourceUsage().maxRSS / 1024), elapsedMs: Math.round(performance.now() - started) }));
    } finally { resume?.(); resumeGzip?.(); await app.close(); }
  `;
  const results = [];
  for (const phase of ['seed', 'http', 'restart']) {
    const { stdout } = await execFile(process.execPath, ['--max-old-space-size=192', '--input-type=module', '--eval', code, phase], { timeout: 120_000 });
    const result = JSON.parse(stdout);
    assert(result.rssMiB < 512, `${phase} used ${result.rssMiB} MiB RSS.`);
    results.push(result);
  }
  assert.equal(results[1].hash, results[2].hash, 'Restart must preserve all calendar bytes and revisions.');
  assert.equal(results[1].archiveHash, results[2].archiveHash, 'Restart must preserve every archived event, including releases outside the published range.');
  t.diagnostic(`${SOURCES.length} sources, ${results[1].archivedCount} archived events (${results[1].archivedCancelled} cancelled), ${results[1].count} published events (${results[1].confirmed} confirmed, ${results[1].cancelled} cancelled), ${results[0].rawBytes} raw seed bytes, ${results[1].rawBytes} raw refreshed bytes (${(results[1].rawBytes / 1024 / 1024).toFixed(1)} MiB), ${results[1].compressedBytes} snapshot gzip bytes, and ${(results[1].bytes / 1024 / 1024).toFixed(1)} MiB calendar (${results[1].gzipBytes} wire gzip bytes): peak ${Math.max(...results.map((result) => result.rssMiB))} MiB RSS; cold headers ${results[1].coldHeadersMs} ms, warm HEAD ${results[1].warmHeadMs} ms, concurrent health ${results[1].healthMs} ms; full identity ${results[1].identityMs} ms, gzip headers ${results[1].gzipHeadersMs} ms, full gzip ${results[1].gzipMs} ms; ${results.reduce((sum, result) => sum + result.elapsedMs, 0)} ms across seed, HTTP refresh, and restart.`);
});
