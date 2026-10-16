import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const SOURCES = Object.freeze([
  { slug: 'marvel', id: 'in0000248', kind: 'interest', label: 'Marvel' },
  { slug: 'star-wars', id: 'in0000243', kind: 'interest', label: 'Star Wars' },
  { slug: 'dc', id: 'in0000244', kind: 'interest', label: 'DC' },
  { slug: 'vince-gilligan', id: 'nm0319213', kind: 'name', label: 'Vince Gilligan' },
  { slug: 'justin-roiland', id: 'nm1551598', kind: 'name', label: 'Justin Roiland' },
].map((source) => Object.freeze({
  ...source,
  url: `https://www.imdb.com/${source.kind === 'interest' ? 'interest' : 'name'}/${source.id}/`,
})));

function integer(value, fallback, name, min, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return number;
}

export function loadConfig(env = process.env) {
  const port = integer(env.PORT, 3000, 'PORT', 1, 65535);
  const origin = new URL(env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
      origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL must be an HTTPS origin (HTTP is allowed for localhost).');
  }
  const token = env.CALENDAR_TOKEN || '';
  if (!local && !token) throw new Error('CALENDAR_TOKEN is required for a nonlocal deployment.');
  if (token && !/^[A-Za-z0-9_+\/=\-]{24,256}$/.test(token)) {
    throw new Error('CALENDAR_TOKEN must contain 24–256 URL-safe or base64 characters.');
  }
  const eventTimeMode = env.EVENT_TIME_MODE || 'date';
  if (!['date', 'utc'].includes(eventTimeMode)) throw new Error('EVENT_TIME_MODE must be date or utc.');
  const prefix = token ? `/${encodeURIComponent(token)}` : '';
  return Object.freeze({
    port,
    origin: origin.origin,
    prefix,
    baseUrl: `${origin.origin}${prefix}`,
    dataDir: resolve(env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url))),
    eventTimeMode,
    refreshIntervalMs: integer(env.REFRESH_INTERVAL_HOURS, 24, 'REFRESH_INTERVAL_HOURS', 1, 168) * 3_600_000,
    retryIntervalMs: integer(env.REFRESH_RETRY_MINUTES, 30, 'REFRESH_RETRY_MINUTES', 5, 1440) * 60_000,
    sources: SOURCES,
  });
}
