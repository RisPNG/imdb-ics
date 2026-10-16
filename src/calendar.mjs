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

function validEvent(event) {
  return event && TITLE_ID.test(event.id) && typeof event.title === 'string'
    && event.title.trim() && isCompleteDate(event.date) && STATUSES.has(event.status)
    && Number.isSafeInteger(event.sequence) && event.sequence >= 0
    && timestamp(event.createdAt) && timestamp(event.modifiedAt);
}

function savedEvents(previousEvents) {
  return Object.fromEntries(Object.values(previousEvents ?? {})
    .filter(validEvent)
    .map(({ id, title, date, createdAt, modifiedAt, sequence, status }) => [id, {
      id, title, date, createdAt, modifiedAt, sequence, status,
    }]));
}

/**
 * Reconcile only a successful, fully paginated membership snapshot. A failed
 * upstream refresh must keep the previous state, rather than cancel its events.
 * Cancellation records deliberately remain in state so clients can remove them.
 */
export function reconcileEvents(previousEvents, titles, { now = new Date() } = {}) {
  const changedAt = timestamp(now);
  if (!changedAt) throw new TypeError('now must be a valid date');
  const previous = savedEvents(previousEvents);
  const current = new Map();

  // Prefer a complete date if repeated sources disagree. Then choose the earliest
  // date and lexical title; neither API pagination nor source order changes state.
  for (const title of titles ?? []) {
    if (!title || !TITLE_ID.test(title.id) || typeof title.title !== 'string' || !title.title.trim()) continue;
    const candidate = { id: title.id, title: title.title.trim(), date: isCompleteDate(title.date) ? title.date : null };
    const existing = current.get(candidate.id);
    const candidateKey = `${candidate.date ?? '~~~~'}\0${candidate.title}`;
    const existingKey = existing && `${existing.date ?? '~~~~'}\0${existing.title}`;
    if (!existing || compareText(candidateKey, existingKey) < 0) current.set(candidate.id, candidate);
  }

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
    } else if (before.title !== title.title || before.date !== title.date || before.status !== 'CONFIRMED') {
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

/** Render deterministic UTF-8 iCalendar; refresh time does not alter event state. */
export function renderCalendar({ name = 'Release Calendar', description, events = {}, eventTimeMode = 'date' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Release Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:P1D',
  ];
  if (description) lines.push(`X-WR-CALDESC:${escapeText(description)}`);

  const ordered = Object.values(events ?? {}).filter(validEvent).sort((left, right) =>
    compareText(left.date, right.date) || compareText(left.id, right.id));
  for (const event of ordered) {
    // A UTC-midnight marker is a display preference, not an asserted release time.
    // RFC 5545 §3.6.1: DATE-TIME without DTEND/DURATION has zero duration.
    const start = event.date.replaceAll('-', '');
    const dates = eventTimeMode === 'utc'
      ? [`DTSTART:${start}T000000Z`]
      : [`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${nextDay(event.date)}`];
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@release-calendar`,
      `DTSTAMP:${calendarTimestamp(event.modifiedAt)}`,
      `CREATED:${calendarTimestamp(event.createdAt)}`,
      `LAST-MODIFIED:${calendarTimestamp(event.modifiedAt)}`,
      `SEQUENCE:${event.sequence}`,
      `STATUS:${event.status}`,
      ...dates,
      `SUMMARY:${escapeText(event.title)}`,
      `URL:https://www.imdb.com/title/${event.id}/`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
