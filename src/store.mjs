import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzip as gzipCallback, gunzip as gunzipCallback } from 'node:zlib';
import { promisify } from 'node:util';
import { isValidEvent, reconcileEvents } from './calendar.mjs';
import { fetchSource } from './imdb.mjs';

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = 16 * 1024 * 1024;

function emptySnapshot() {
  return { version: 2, eventTimeMode: null, sources: {}, combined: null };
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validEvents(events) {
  return events && typeof events === 'object' && !Array.isArray(events) &&
    Object.entries(events).every(([id, event]) => isValidEvent(event) && event.id === id);
}

function validTitle(title) {
  return title && /^tt\d+$/.test(title.id) && typeof title.title === 'string'
    && (title.date === null || typeof title.date === 'string')
    && (title.series === undefined || (title.series && /^tt\d+$/.test(title.series.id)
      && typeof title.series.title === 'string'
      && (title.series.date === undefined || title.series.date === null || typeof title.series.date === 'string')
      && ['season', 'episode'].every((field) => title.series[field] === null || (Number.isInteger(title.series[field]) && title.series[field] >= 0))))
    && (title.episodes === undefined || (Array.isArray(title.episodes) && title.episodes.every(validTitle)));
}

function validateSnapshot(value, sources) {
  if (!value || ![1, 2].includes(value.version) || !value.sources || typeof value.sources !== 'object') return false;
  for (const source of sources) {
    const saved = value.sources[source.slug];
    if (!saved) continue;
    if (!Array.isArray(saved.titles) || !validEvents(saved.events) ||
        (saved.lastSuccessAt !== null && !validTime(saved.lastSuccessAt)) ||
        (saved.lastAttemptAt !== null && !validTime(saved.lastAttemptAt)) ||
        !saved.titles.every(validTitle)) return false;
  }
  if (value.combined && (!validEvents(value.combined.events) ||
      !validTime(value.combined.updatedAt))) return false;
  return true;
}

function undatedTitleCount(titles, events) {
  const ids = new Set(titles.flatMap((title) => [title, ...(title.episodes ?? [])])
    .filter((title) => !title.date).map((title) => title.id));
  for (const event of Object.values(events)) {
    if (event.status !== 'CONFIRMED') continue;
    ids.delete(event.titleId ?? event.id);
    for (const id of event.episodeIds ?? []) ids.delete(id);
  }
  return ids.size;
}

function errorMessage(error) {
  return error?.name === 'AbortError' ? 'Refresh interrupted.' : String(error?.message || error).slice(0, 300);
}

function bumpMode(events, now) {
  return Object.fromEntries(Object.entries(events).map(([id, event]) => [id, {
    ...event, modifiedAt: now, sequence: event.sequence + 1,
  }]));
}

export class CalendarStore {
  constructor(config, { loader = fetchSource, clock = () => new Date(), logger = console } = {}) {
    this.config = config;
    this.loader = loader;
    this.clock = clock;
    this.logger = logger;
    this.snapshot = emptySnapshot();
    this.refreshing = null;
    this.timer = null;
    this.controller = null;
    this.stopped = true;
    this.persistenceError = null;
  }

  async initialize() {
    try {
      let path = join(this.config.dataDir, 'snapshot.json.gz');
      let compressed = true;
      let size;
      try {
        size = (await stat(path)).size;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        path = join(this.config.dataDir, 'snapshot.json');
        compressed = false;
        size = (await stat(path)).size;
      }
      const limit = compressed ? MAX_COMPRESSED_BYTES : MAX_SNAPSHOT_BYTES;
      if (size > limit) throw new Error(`Saved snapshot exceeds the ${compressed ? '16 MiB compressed' : '64 MiB'} limit.`);
      let bytes = await readFile(path);
      if (bytes.length > limit) throw new Error(`Saved snapshot exceeds the ${compressed ? '16 MiB compressed' : '64 MiB'} limit.`);
      if (compressed) bytes = await gunzip(bytes, { maxOutputLength: MAX_SNAPSHOT_BYTES });
      const saved = JSON.parse(bytes.toString('utf8'));
      if (!validateSnapshot(saved, this.config.sources)) throw new Error('Saved snapshot has an invalid format.');
      saved.version = 2;
      this.snapshot = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger.warn(`Calendar cache could not be loaded: ${errorMessage(error)}`);
    }
    this.applyTimeMode();
  }

  applyTimeMode() {
    if (this.snapshot.eventTimeMode && this.snapshot.eventTimeMode !== this.config.eventTimeMode) {
      const now = this.clock().toISOString();
      for (const saved of Object.values(this.snapshot.sources)) saved.events = bumpMode(saved.events, now);
      if (this.snapshot.combined) this.snapshot.combined.events = bumpMode(this.snapshot.combined.events, now);
    }
    this.snapshot.eventTimeMode = this.config.eventTimeMode;
  }

  sourceState(source) {
    const saved = this.snapshot.sources[source.slug];
    if (!saved?.lastSuccessAt) return { status: saved?.error ? 'error' : 'pending', saved };
    const stale = !!saved.error || this.clock().getTime() - Date.parse(saved.lastSuccessAt) >= this.config.refreshIntervalMs;
    return { status: stale ? 'stale' : 'ready', saved };
  }

  feed(slug) {
    if (slug === 'all') {
      if (!this.snapshot.combined) return null;
      const stale = this.config.sources.some((source) => this.sourceState(source).status !== 'ready');
      return { label: 'All releases', description: 'Releases from all configured IMDb sources, with series episodes grouped by release date.',
        events: this.snapshot.combined.events, updatedAt: this.snapshot.combined.updatedAt, stale };
    }
    const source = this.config.sources.find((candidate) => candidate.slug === slug);
    if (!source) return undefined;
    const state = this.sourceState(source);
    if (!state.saved?.lastSuccessAt) return null;
    return { label: source.label, description: `Release dates for titles matched by ${source.label} on IMDb.`,
      events: state.saved.events, updatedAt: state.saved.lastSuccessAt, stale: state.status === 'stale' };
  }

  pageData(baseUrl = this.config.baseUrl, sourceSlug = 'all') {
    const individual = this.config.sources.map((source) => {
      const { status, saved } = this.sourceState(source);
      return { ...source, status, count: saved?.lastSuccessAt ? Object.values(saved.events).filter((event) => event.status === 'CONFIRMED').length : null,
        updatedAt: saved?.lastSuccessAt || null, omitted: saved?.omitted || 0 };
    });
    const combined = this.feed('all');
    const titles = this.config.sources.flatMap((source) => this.snapshot.sources[source.slug]?.titles || []);
    const all = { slug: 'all', label: 'All releases', url: null, status: combined ? (combined.stale ? 'stale' : 'ready') : (individual.some((feed) => feed.status === 'error') ? 'error' : 'pending'),
      count: combined ? Object.values(combined.events).filter((event) => event.status === 'CONFIRMED').length : null,
      updatedAt: combined?.updatedAt || null, omitted: undatedTitleCount(titles, combined?.events || {}) };
    const feeds = [all, ...individual].map((feed) => {
      const subscriptionUrl = `${baseUrl}/calendars/${feed.slug}.ics`;
      return { ...feed, subscriptionUrl, webcalUrl: subscriptionUrl.replace(/^https?:/, 'webcal:') };
    });
    const today = this.clock().toISOString().slice(0, 10);
    const selected = sourceSlug === 'all' ? combined : this.feed(sourceSlug);
    const upcoming = selected ? Object.values(selected.events)
      .filter((event) => event.status === 'CONFIRMED' && event.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
      .slice(0, 12).map((event) => {
        const ids = new Set([event.id, ...(event.episodeIds ?? [])]);
        return { ...event, sources: this.config.sources
          .filter((source) => Object.values(this.snapshot.sources[source.slug]?.events || {})
            .some((candidate) => candidate.status === 'CONFIRMED'
              && (ids.has(candidate.id) || candidate.episodeIds?.some((id) => ids.has(id)))))
          .map((source) => source.label) };
      }) : [];
    const updatedAt = sourceSlug === 'all' ? (individual.every((feed) => feed.updatedAt)
      ? individual.map((feed) => feed.updatedAt).sort()[0] : null) : selected?.updatedAt || null;
    return { baseUrl, feeds, upcoming, updatedAt, stale: !!selected?.stale, sourceSlug,
      refreshing: !!this.refreshing, eventTimeMode: this.config.eventTimeMode };
  }

  refresh({ force = true } = {}) {
    if (this.refreshing) return this.refreshing;
    this.controller = new AbortController();
    this.refreshing = this.performRefresh(force, this.controller.signal).finally(() => {
      this.refreshing = null;
      this.controller = null;
    });
    return this.refreshing;
  }

  async performRefresh(force, signal) {
    let refreshed = false;
    const seriesCache = new Map();
    for (const source of this.config.sources) {
      if (signal.aborted) break;
      const previous = this.snapshot.sources[source.slug];
      const now = this.clock().toISOString();
      const interval = previous?.error ? this.config.retryIntervalMs : this.config.refreshIntervalMs;
      const checkedAt = previous?.error ? previous.lastAttemptAt : previous?.lastSuccessAt;
      if (!force && checkedAt && this.clock().getTime() - Date.parse(checkedAt) < interval) continue;
      try {
        const result = await this.loader(source, { signal, seriesCache });
        if (signal.aborted) break;
        if (!result || !Array.isArray(result.titles)) throw new Error('Source did not return a title snapshot.');
        const events = reconcileEvents(previous?.events || {}, result.titles, { now });
        const omitted = undatedTitleCount(result.titles, events);
        this.snapshot.sources[source.slug] = { titles: result.titles, events,
          total: result.total, omitted, warnings: result.warnings || [],
          lastSuccessAt: now, lastAttemptAt: now, error: null };
        refreshed = true;
        this.logger.info(`Refreshed ${source.slug}: ${result.titles.length} titles, ${omitted} without a complete date.`);
        for (const warning of result.warnings || []) this.logger.warn(`${source.slug}: ${warning}`);
      } catch (error) {
        if (signal.aborted) break;
        this.snapshot.sources[source.slug] = { titles: previous?.titles || [], events: previous?.events || {},
          total: previous?.total || 0, omitted: previous?.omitted || 0, warnings: previous?.warnings || [],
          lastSuccessAt: previous?.lastSuccessAt || null, lastAttemptAt: now, error: errorMessage(error) };
        this.logger.warn(`Refresh failed for ${source.slug}: ${errorMessage(error)}`);
      }
    }
    if ((refreshed || !this.snapshot.combined)
        && (this.snapshot.combined || this.config.sources.every((source) => this.snapshot.sources[source.slug]?.lastSuccessAt))) {
      const titles = this.config.sources.flatMap((source) => this.snapshot.sources[source.slug]?.titles || []);
      this.snapshot.combined = { events: reconcileEvents(this.snapshot.combined?.events || {}, titles, { now: this.clock().toISOString() }),
        updatedAt: this.clock().toISOString() };
    }
    await this.persist();
  }

  async persist() {
    const temporary = join(this.config.dataDir, `.snapshot-${randomUUID()}.tmp`);
    try {
      const text = JSON.stringify(this.snapshot);
      if (Buffer.byteLength(text) > MAX_SNAPSHOT_BYTES) throw new Error('Calendar snapshot exceeds the 64 MiB limit.');
      const bytes = await gzip(text, { maxOutputLength: MAX_COMPRESSED_BYTES });
      await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, join(this.config.dataDir, 'snapshot.json.gz'));
      this.persistenceError = null;
      await unlink(join(this.config.dataDir, 'snapshot.json')).catch((error) => {
        if (error.code !== 'ENOENT') this.logger.warn(`Legacy calendar cache could not be removed: ${errorMessage(error)}`);
      });
    } catch (error) {
      this.persistenceError = error.code === 'ERR_BUFFER_TOO_LARGE' ? 'Calendar snapshot exceeds the 16 MiB compressed limit.' : errorMessage(error);
      this.logger.warn(`Calendar cache could not be saved: ${this.persistenceError}`);
      await unlink(temporary).catch(() => {});
    }
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.runScheduled();
  }

  async runScheduled() {
    try {
      await this.refresh({ force: false });
    } catch (error) {
      this.logger.warn(`Calendar refresh failed: ${errorMessage(error)}`);
    }
    if (this.stopped) return;
    const now = this.clock().getTime();
    const due = this.config.sources.map((source) => {
      const saved = this.snapshot.sources[source.slug];
      if (!saved) return now + this.config.retryIntervalMs;
      return Date.parse(saved.error ? saved.lastAttemptAt : saved.lastSuccessAt) +
        (saved.error ? this.config.retryIntervalMs : this.config.refreshIntervalMs);
    });
    this.timer = setTimeout(() => this.runScheduled(), Math.max(1_000, Math.min(...due) - now));
    this.timer.unref();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.controller?.abort();
    if (this.refreshing) await this.refreshing;
  }
}
