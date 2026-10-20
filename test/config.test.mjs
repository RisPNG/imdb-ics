import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, SOURCES } from '../src/config.mjs';

test('119 unique sources and all-day default preserve the requested IDs and existing subscription paths', () => {
  assert.deepEqual(SOURCES.map((source) => source.id), [
    'in0000248', 'in0000243', 'in0000244', 'nm0319213', 'nm1551598',
    'nm0252230', 'nm10735410', 'nm2255973', 'nm0671567', 'nm0350453', 'nm0151419',
    'nm0000138', 'nm0000354', 'nm3103126', 'nm0000093', 'nm0000184', 'nm0000123',
    'nm0526019', 'nm2652716', 'nm0331516', 'nm1212722', 'nm1500155', 'nm1476804',
    'nm0902623', 'nm0148418', 'nm1089991', 'nm0000115', 'nm1209966', 'nm3081796',
    'nm2747668', 'nm0496899', 'nm1078479', 'nm0634240', 'nm0570364', 'nm0644022',
    'nm0666739', 'nm0186505', 'nm0532683', 'nm1242688', 'nm0389069', 'nm1140666',
    'nm5896355', 'nm5584750', 'nm0002064', 'nm0052186', 'nm0687146', 'nm0000160',
    'nm0000434', 'nm0000168', 'nm5473782', 'nm15158872', 'nm2623915', 'nm0564215',
    'nm1363595', 'nm0000206',
    'nm3290082', 'nm5842157', 'nm2866114', 'nm7794173', 'nm3750475', 'nm3312641',
    'nm3394670', 'nm0000100', 'nm7831367', 'nm10533874', 'nm2087739', 'nm0396759',
    'nm6179964', 'nm7681921', 'nm15884712', 'nm5579304', 'nm6722413',
    'nm0000129', 'nm0277213', 'nm0512934', 'nm0000437', 'nm0000553', 'nm1659221',
    'nm0479471', 'nm0000375', 'nm0000652', 'nm1405398', 'nm0251986', 'nm0396558',
    'nm0262635', 'nm0001570', 'nm0586568', 'nm0749263', 'nm1165110', 'nm0079273',
    'nm0000191', 'nm0935541', 'nm0322407', 'nm2002649', 'nm2201555', 'nm1854269',
    'nm0348181', 'nm0290556', 'nm0000502', 'nm0001618', 'nm0000150', 'nm0342029',
    'nm0269463', 'nm0159789', 'nm0740264', 'nm0195439', 'nm0117709', 'nm0219292',
    'nm1030244', 'nm0012948', 'nm0000198',
    'nm16080958', 'nm13961256', 'nm14465059', 'nm5795985', 'nm2096347', 'nm10224401',
    'nm4459961', 'nm0082091',
  ]);
  assert.equal(new Set(SOURCES.map((source) => source.id)).size, 119);
  assert.equal(new Set(SOURCES.map((source) => source.slug)).size, 119);
  assert.deepEqual(SOURCES.slice(0, 5).map((source) => source.slug), ['marvel', 'star-wars', 'dc', 'vince-gilligan', 'justin-roiland']);
  assert(SOURCES.slice(5).every((source) => source.kind === 'name'));
  assert.equal(loadConfig({}).eventTimeMode, 'date');
  assert.equal(loadConfig({}).refreshIntervalMs, 86400000);
  assert.equal(loadConfig({ RENDER_EXTERNAL_URL: 'https://release-calendar.onrender.com' }).baseUrl,
    'https://release-calendar.onrender.com');
});

test('public URLs cannot be credentials, paths, query strings, or insecure remote origins', () => {
  for (const value of ['http://example.com', 'https://name:password@example.com', 'https://example.com/path', 'https://example.com/?token=x', 'javascript:alert(1)']) {
    assert.throws(() => loadConfig({ PUBLIC_BASE_URL: value }));
  }
  assert.equal(loadConfig({ PUBLIC_BASE_URL: 'http://127.0.0.1:8080' }).origin, 'http://127.0.0.1:8080');
  assert.equal(loadConfig({ PUBLIC_BASE_URL: 'https://calendar.example' }).baseUrl, 'https://calendar.example');
});

test('bad ports and unsupported time modes fail before starting the service', () => {
  for (const env of [{ PORT: '0' }, { PORT: '3.5' }, { PORT: '70000' }, { EVENT_TIME_MODE: 'local' }, { REFRESH_INTERVAL_HOURS: '0' }]) {
    assert.throws(() => loadConfig(env));
  }
});

test('a leftover Render token does not change public URLs or prevent startup', () => {
  for (const token of ['old-deployment-token-with-24-characters', 'short', 'abcdefghijklmnopqrstuvwx+/==']) {
    const config = loadConfig({ RENDER_EXTERNAL_URL: 'https://release-calendar.onrender.com', CALENDAR_TOKEN: token });
    assert.equal(config.baseUrl, 'https://release-calendar.onrender.com');
    assert(!Object.hasOwn(config, 'prefix'));
  }
});
