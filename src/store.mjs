import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isCompleteDate, reconcileEvents } from './calendar.mjs';
import { fetchSource } from './imdb.mjs';

function emptySnapshot() {
  return { version: 1, eventTimeMode: null, sources: {}, combined: null };
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validEvents(events) {
  return events && typeof events === 'object' && !Array.isArray(events) &&
    Object.entries(events).every(([id, event]) => event && /^tt\d+$/.test(id) && event.id === id &&
      typeof event.title === 'string' && event.title.trim() && isCompleteDate(event.date) &&
      ['CONFIRMED', 'CANCELLED'].includes(event.status) && Number.isSafeInteger(event.sequence) &&
      event.sequence >= 0 && validTime(event.createdAt) && validTime(event.modifiedAt));
}

function validateSnapshot(value, sources) {
  if (!value || value.version !== 1 || !value.sources || typeof value.sources !== 'object') return false;
  for (const source of sources) {
    const saved = value.sources[source.slug];
    if (!saved) continue;
    if (!Array.isArray(saved.titles) || !validEvents(saved.events) ||
        (saved.lastSuccessAt !== null && !validTime(saved.lastSuccessAt)) ||
        (saved.lastAttemptAt !== null && !validTime(saved.lastAttemptAt)) ||
        !saved.titles.every((title) => title && /^tt\d+$/.test(title.id) &&
          typeof title.title === 'string' && (title.date === null || typeof title.date === 'string'))) return false;
  }
  if (value.combined && (!validEvents(value.combined.events) ||
      !validTime(value.combined.updatedAt))) return false;
  return true;
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
      const path = join(this.config.dataDir, 'snapshot.json');
      if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error('Saved snapshot exceeds 16 MiB.');
      const text = await readFile(path, 'utf8');
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Saved snapshot exceeds 16 MiB.');
      const saved = JSON.parse(text);
      if (!validateSnapshot(saved, this.config.sources)) throw new Error('Saved snapshot has an invalid format.');
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
      const ready = this.config.sources.every((source) => this.sourceState(source).saved?.lastSuccessAt);
      if (!ready || !this.snapshot.combined) return null;
      const stale = this.config.sources.some((source) => this.sourceState(source).status !== 'ready');
      return { label: 'All releases', description: 'Releases from all five IMDb sources, without duplicate titles.',
        events: this.snapshot.combined.events, updatedAt: this.snapshot.combined.updatedAt, stale };
    }
    const source = this.config.sources.find((candidate) => candidate.slug === slug);
    if (!source) return undefined;
    const state = this.sourceState(source);
    if (!state.saved?.lastSuccessAt) return null;
    return { label: source.label, description: `Release dates for titles matched by ${source.label} on IMDb.`,
      events: state.saved.events, updatedAt: state.saved.lastSuccessAt, stale: state.status === 'stale' };
  }

  pageData(baseUrl = this.config.baseUrl) {
    const individual = this.config.sources.map((source) => {
      const { status, saved } = this.sourceState(source);
      return { ...source, status, count: saved?.lastSuccessAt ? Object.values(saved.events).filter((event) => event.status === 'CONFIRMED').length : null,
        updatedAt: saved?.lastSuccessAt || null, omitted: saved?.omitted || 0 };
    });
    const combined = this.feed('all');
    const undatedIds = new Set(this.config.sources.flatMap((source) =>
      (this.snapshot.sources[source.slug]?.titles || []).filter((title) => !title.date).map((title) => title.id)));
    if (combined) for (const event of Object.values(combined.events)) {
      if (event.status === 'CONFIRMED') undatedIds.delete(event.id);
    }
    const all = { slug: 'all', label: 'All releases', url: null, status: combined ? (combined.stale ? 'stale' : 'ready') : (individual.some((feed) => feed.status === 'error') ? 'error' : 'pending'),
      count: combined ? Object.values(combined.events).filter((event) => event.status === 'CONFIRMED').length : null,
      updatedAt: combined?.updatedAt || null, omitted: undatedIds.size };
    const feeds = [all, ...individual].map((feed) => {
      const subscriptionUrl = `${baseUrl}/calendars/${feed.slug}.ics`;
      return { ...feed, subscriptionUrl, webcalUrl: subscriptionUrl.replace(/^https?:/, 'webcal:') };
    });
    const today = this.clock().toISOString().slice(0, 10);
    const upcoming = combined ? Object.values(combined.events)
      .filter((event) => event.status === 'CONFIRMED' && event.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
      .slice(0, 12).map((event) => ({ ...event, sources: this.config.sources
        .filter((source) => this.snapshot.sources[source.slug]?.events[event.id]?.status === 'CONFIRMED')
        .map((source) => source.label) })) : [];
    const updatedAt = individual.every((feed) => feed.updatedAt)
      ? individual.map((feed) => feed.updatedAt).sort()[0] : null;
    return { baseUrl, feeds, upcoming, updatedAt, stale: !!combined?.stale,
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
    for (const source of this.config.sources) {
      if (signal.aborted) break;
      const previous = this.snapshot.sources[source.slug];
      const now = this.clock().toISOString();
      const interval = previous?.error ? this.config.retryIntervalMs : this.config.refreshIntervalMs;
      const checkedAt = previous?.error ? previous.lastAttemptAt : previous?.lastSuccessAt;
      if (!force && checkedAt && this.clock().getTime() - Date.parse(checkedAt) < interval) continue;
      try {
        const result = await this.loader(source, { signal });
        if (signal.aborted) break;
        if (!result || !Array.isArray(result.titles)) throw new Error('Source did not return a title snapshot.');
        this.snapshot.sources[source.slug] = { titles: result.titles,
          events: reconcileEvents(previous?.events || {}, result.titles, { now }),
          total: result.total, omitted: result.omitted, warnings: result.warnings || [],
          lastSuccessAt: now, lastAttemptAt: now, error: null };
        refreshed = true;
        this.logger.info(`Refreshed ${source.slug}: ${result.titles.length} titles, ${result.omitted} without a complete date.`);
        for (const warning of result.warnings || []) this.logger.warn(`${source.slug}: ${warning}`);
      } catch (error) {
        if (signal.aborted) break;
        this.snapshot.sources[source.slug] = { titles: previous?.titles || [], events: previous?.events || {},
          total: previous?.total || 0, omitted: previous?.omitted || 0, warnings: previous?.warnings || [],
          lastSuccessAt: previous?.lastSuccessAt || null, lastAttemptAt: now, error: errorMessage(error) };
        this.logger.warn(`Refresh failed for ${source.slug}: ${errorMessage(error)}`);
      }
    }
    if ((refreshed || !this.snapshot.combined) && this.config.sources.every((source) => this.snapshot.sources[source.slug]?.lastSuccessAt)) {
      const titles = this.config.sources.flatMap((source) => this.snapshot.sources[source.slug].titles);
      this.snapshot.combined = { events: reconcileEvents(this.snapshot.combined?.events || {}, titles, { now: this.clock().toISOString() }),
        updatedAt: this.clock().toISOString() };
    }
    await this.persist();
  }

  async persist() {
    const temporary = join(this.config.dataDir, `.snapshot-${randomUUID()}.tmp`);
    try {
      await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
      await writeFile(temporary, `${JSON.stringify(this.snapshot)}\n`, { mode: 0o600 });
      await rename(temporary, join(this.config.dataDir, 'snapshot.json'));
      this.persistenceError = null;
    } catch (error) {
      this.persistenceError = errorMessage(error);
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
