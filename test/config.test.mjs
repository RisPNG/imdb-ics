import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, SOURCES } from '../src/config.mjs';

test('five unique sources and all-day default preserve the requested IDs', () => {
  assert.deepEqual(SOURCES.map((source) => source.id), ['in0000248', 'in0000243', 'in0000244', 'nm0319213', 'nm1551598']);
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
