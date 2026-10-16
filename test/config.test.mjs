import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, SOURCES } from '../src/config.mjs';

test('five unique sources and all-day default preserve the requested IDs', () => {
  assert.deepEqual(SOURCES.map((source) => source.id), ['in0000248', 'in0000243', 'in0000244', 'nm0319213', 'nm1551598']);
  assert.equal(loadConfig({}).eventTimeMode, 'date');
  assert.equal(loadConfig({}).refreshIntervalMs, 86400000);
  const token = 'private-test-key-that-stays-secret';
  assert.equal(loadConfig({ RENDER_EXTERNAL_URL: 'https://release-calendar.onrender.com', CALENDAR_TOKEN: token }).baseUrl,
    `https://release-calendar.onrender.com/${token}`);
});

test('public URLs cannot be credentials, paths, query strings, or insecure remote origins', () => {
  for (const value of ['http://example.com', 'https://name:password@example.com', 'https://example.com/path', 'https://example.com/?token=x', 'javascript:alert(1)']) {
    assert.throws(() => loadConfig({ PUBLIC_BASE_URL: value }));
  }
  assert.equal(loadConfig({ PUBLIC_BASE_URL: 'http://127.0.0.1:8080' }).origin, 'http://127.0.0.1:8080');
  assert.throws(() => loadConfig({ PUBLIC_BASE_URL: 'https://calendar.example' }), /CALENDAR_TOKEN is required/);
});

test('bad ports, short tokens, and unsupported time modes fail before starting the service', () => {
  for (const env of [{ PORT: '0' }, { PORT: '3.5' }, { PORT: '70000' }, { CALENDAR_TOKEN: 'short' }, { EVENT_TIME_MODE: 'local' }, { REFRESH_INTERVAL_HOURS: '0' }]) {
    assert.throws(() => loadConfig(env));
  }
});

test('Render-generated base64 secrets are encoded as one safe path segment', () => {
  const token = 'B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk=';
  const config = loadConfig({ PUBLIC_BASE_URL: 'https://calendar.example', CALENDAR_TOKEN: token });
  assert.equal(config.prefix, `/${encodeURIComponent(token)}`);
  const withSlash = loadConfig({ CALENDAR_TOKEN: 'abcdefghijklmnopqrstuvwx+/==' });
  assert.equal(withSlash.prefix.split('/').length, 2);
  assert(withSlash.prefix.endsWith('%2B%2F%3D%3D'));
});
