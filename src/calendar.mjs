const TITLE_ID = /^tt\d+$/;
const STATUSES = new Set(['CONFIRMED', 'CANCELLED']);

/** A complete calendar date, with no timezone or inferred month/day. */
export function isCompleteDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value < '0001-01-01' || value >= '9999-12-31') return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timestamp(value) {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() >= 1 && parsed.getUTCFullYear() <= 9999
    ? parsed.toISOString() : null;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isValidEvent(event) {
  const titleId = event?.titleId ?? event?.id;
  return event && TITLE_ID.test(titleId) && (event.id === titleId || event.id === `${titleId}-${event.date}`)
    && (event.description === undefined || typeof event.description === 'string')
    && (event.episodeDescription === undefined || typeof event.episodeDescription === 'string')
    && (event.sourceLabels === undefined || (event.sourceLabels
      && ['interests', 'people'].every((kind) => Array.isArray(event.sourceLabels[kind]) && event.sourceLabels[kind].every((label) => typeof label === 'string'))))
    && (event.episodeIds === undefined || (Array.isArray(event.episodeIds) && event.episodeIds.every((id) => TITLE_ID.test(id))))
    && typeof event.title === 'string'
    && event.title.trim() && isCompleteDate(event.date) && STATUSES.has(event.status)
    && Number.isSafeInteger(event.sequence) && event.sequence >= 0
    && timestamp(event.createdAt) && timestamp(event.modifiedAt);
}

function savedEvents(previousEvents) {
  const events = {};
  for (const event of Object.values(previousEvents ?? {})) {
    if (!isValidEvent(event)) continue;
    const { id, titleId = id, title, date, description = '', episodeDescription = description, sourceLabels, episodeIds = [], createdAt, modifiedAt, sequence, status } = event;
    events[id] = event.titleId !== undefined && event.description !== undefined && event.episodeDescription !== undefined && event.episodeIds !== undefined
      ? event : { id, titleId, title, date, description, episodeDescription, ...(sourceLabels ? { sourceLabels } : {}), episodeIds, createdAt, modifiedAt, sequence, status };
  }
  return events;
}

export function attributeReleases(events, sources) {
  const releases = [...events];
  if (!releases.length) return releases;
  const ids = new Set();
  for (const event of releases) {
    ids.add(event.id);
    for (const id of event.episodeIds ?? []) ids.add(id);
  }
  const memberships = new Map();
  for (const source of sources) {
    for (const title of source.titles ?? []) {
      for (const entry of [title, ...(title?.episodes ?? [])]) {
        if (!ids.has(entry?.id)) continue;
        let labels = memberships.get(entry.id);
        if (!labels) {
          labels = { interests: new Set(), people: new Set() };
          memberships.set(entry.id, labels);
        }
        labels[source.kind === 'interest' ? 'interests' : 'people'].add(source.label);
      }
    }
  }
  return releases.map((event) => {
    const interests = new Set();
    const people = new Set();
    for (const id of new Set([event.id, ...(event.episodeIds ?? [])])) {
      const labels = memberships.get(id);
      for (const label of labels?.interests ?? []) interests.add(label);
      for (const label of labels?.people ?? []) people.add(label);
    }
    const sourceLabels = { interests: [...interests].sort(compareText), people: [...people].sort(compareText) };
    const attribution = [
      sourceLabels.interests.length ? `Interests: ${sourceLabels.interests.join(', ')}` : '',
      sourceLabels.people.length ? `People: ${sourceLabels.people.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const episodeDescription = event.episodeDescription ?? event.description ?? '';
    return { ...event, sourceLabels, episodeDescription, description: [attribution, episodeDescription].filter(Boolean).join('\n\n') };
  });
}

/**
 * Reconcile only a successful, fully paginated membership snapshot. A failed
 * upstream refresh must keep the previous state, rather than cancel its events.
 * Cancellation records deliberately remain in state so clients can remove them.
 */
export function reconcileEvents(previousEvents, titles, { now = new Date(), sources } = {}) {
  const changedAt = timestamp(now);
  if (!changedAt) throw new TypeError('now must be a valid date');
  const previous = savedEvents(previousEvents);
  const records = new Map();

  // Prefer complete dates, then the earliest date and lexical title. Preserve known episode relationships even when another source still has legacy title data, independently of pagination and source order.
  for (const title of titles ?? []) {
    for (const entry of [title, ...(title?.episodes ?? [])]) {
      if (!entry || !TITLE_ID.test(entry.id) || typeof entry.title !== 'string' || !entry.title.trim()) continue;
      const candidate = { id: entry.id, title: entry.title.trim(), date: isCompleteDate(entry.date) ? entry.date : null };
      if (entry.series) candidate.series = entry.series;
      const existing = records.get(candidate.id);
      const candidateKey = `${candidate.date ?? '~~~~'}\0${candidate.title}`;
      const existingKey = existing && `${existing.date ?? '~~~~'}\0${existing.title}`;
      const preferred = !existing || compareText(candidateKey, existingKey) < 0 ? candidate : existing;
      const relationships = [candidate.series, existing?.series].filter(Boolean)
        .sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
      if (relationships.length) preferred.series = relationships[0];
      records.set(candidate.id, preferred);
    }
  }

  const current = new Map();
  const parents = new Map();
  for (const record of records.values()) {
    if (record.series) {
      const candidate = record.series;
      const existing = parents.get(candidate.id);
      const candidateKey = `${candidate.date ?? '~~~~'}\0${candidate.title}`;
      const existingKey = existing && `${existing.date ?? '~~~~'}\0${existing.title}`;
      if (!existing || compareText(candidateKey, existingKey) < 0) parents.set(candidate.id, candidate);
    } else {
      current.set(record.id, {
        id: record.id, titleId: record.id, title: record.title, date: record.date, description: '', episodeDescription: '', episodeIds: [],
      });
    }
  }
  const groups = new Map();
  for (const record of records.values()) {
    if (!record.series || !record.date) continue;
    const selected = records.get(record.series.id);
    const parent = parents.get(record.series.id);
    const premiere = selected?.date ?? parent.date;
    const id = premiere === record.date ? record.series.id : `${record.series.id}-${record.date}`;
    let group = groups.get(id);
    if (!group) {
      group = { id, titleId: record.series.id, title: selected?.title ?? parent.title, date: record.date, episodes: [] };
      groups.set(id, group);
    }
    group.episodes.push(record);
  }
  for (const { episodes, ...group } of groups.values()) {
    episodes.sort((left, right) => (left.series.season ?? Infinity) - (right.series.season ?? Infinity)
      || (left.series.episode ?? Infinity) - (right.series.episode ?? Infinity) || compareText(left.id, right.id));
    const description = episodes.map((episode) => {
      const { season, episode: number } = episode.series;
      const label = season != null && number != null
        ? `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`
        : number != null ? `Episode ${number}` : season != null ? `Season ${season}` : '';
      return `${label ? `${label}: ` : ''}${episode.title}`;
    }).join('\n');
    current.set(group.id, { ...group, description, episodeDescription: description, episodeIds: episodes.map((episode) => episode.id) });
  }
  if (sources) for (const event of attributeReleases(current.values(), sources)) current.set(event.id, event);

  const events = {};
  const ids = [...new Set([...Object.keys(previous), ...current.keys()])].sort(compareText);
  for (const id of ids) {
    const before = previous[id];
    const title = current.get(id);
    if (!title?.date) {
      if (before) events[id] = before.status === 'CANCELLED' ? before : {
        ...before, status: 'CANCELLED', sequence: before.sequence + 1,
        modifiedAt: changedAt,
      };
      continue;
    }

    if (!before) {
      events[id] = { ...title, createdAt: changedAt, modifiedAt: changedAt, sequence: 0, status: 'CONFIRMED' };
    } else if (before.title !== title.title || before.date !== title.date || before.titleId !== title.titleId
        || before.description !== title.description || before.episodeDescription !== title.episodeDescription
        || JSON.stringify(before.sourceLabels ?? {}) !== JSON.stringify(title.sourceLabels ?? {})
        || JSON.stringify(before.episodeIds) !== JSON.stringify(title.episodeIds)
        || before.status !== 'CONFIRMED') {
      events[id] = { ...before, ...title, modifiedAt: changedAt, sequence: before.sequence + 1, status: 'CONFIRMED' };
    } else {
      events[id] = before;
    }
  }
  return events;
}

function escapeText(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// RFC 5545 counts octets, including each continuation space. Iterating code
// points keeps UTF-8 characters intact when inserting CRLF + SPACE folds.
function foldLine(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const chunks = [];
  let chunk = '';
  let size = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (size + bytes > 75) {
      chunks.push(chunk);
      chunk = ' ';
      size = 1;
    }
    chunk += character;
    size += bytes;
  }
  chunks.push(chunk);
  return chunks.join('\r\n');
}

function calendarTimestamp(value) {
  return timestamp(value).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function nextDay(date) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10).replaceAll('-', '');
}

/** Serialize deterministic UTF-8 iCalendar one event at a time. */
export function* calendarChunks({ name = "Ris' IMDb ICalendar", description, events = {}, eventTimeMode = 'date' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//Ris' IMDb ICalendar//EN",
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:P1D',
  ];
  if (description) lines.push(`X-WR-CALDESC:${escapeText(description)}`);
  yield `${lines.map(foldLine).join('\r\n')}\r\n`;

  const ordered = Object.values(events ?? {}).filter(isValidEvent).sort((left, right) =>
    compareText(left.date, right.date) || compareText(left.id, right.id));
  for (const event of ordered) {
    // A UTC-midnight marker is a display preference, not an asserted release time.
    // RFC 5545 §3.6.1: DATE-TIME without DTEND/DURATION has zero duration.
    const start = event.date.replaceAll('-', '');
    const dates = eventTimeMode === 'utc'
      ? [`DTSTART:${start}T000000Z`]
      : [`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${nextDay(event.date)}`];
    const eventLines = [
      'BEGIN:VEVENT',
      `UID:${event.id}@release-calendar`,
      `DTSTAMP:${calendarTimestamp(event.modifiedAt)}`,
      `CREATED:${calendarTimestamp(event.createdAt)}`,
      `LAST-MODIFIED:${calendarTimestamp(event.modifiedAt)}`,
      `SEQUENCE:${event.sequence}`,
      `STATUS:${event.status}`,
      ...dates,
      `SUMMARY:${escapeText(event.title)}`,
      ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
      `URL:https://www.imdb.com/title/${event.titleId ?? event.id}/`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ];
    yield `${eventLines.map(foldLine).join('\r\n')}\r\n`;
  }
  yield 'END:VCALENDAR\r\n';
}

/** Render deterministic UTF-8 iCalendar; refresh time does not alter event state. */
export function renderCalendar(options) {
  return [...calendarChunks(options)].join('');
}
