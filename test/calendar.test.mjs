import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { isCompleteDate, reconcileEvents, renderCalendar } from '../src/calendar.mjs';

const firstRefresh = '2026-10-16T04:00:00.000Z';
const secondRefresh = '2026-10-17T04:00:00.000Z';
const title = { id: 'tt1234', title: 'A Release', date: '2026-12-18' };
const reconcile = (before, titles, now = firstRefresh) => reconcileEvents(before, titles, { now });
const unfold = (calendar) => calendar.replace(/\r\n[ \t]/g, '');

test('only complete, real dates become events; invalid saved events are ignored', () => {
  for (const date of ['2024-02-29', '2000-02-29', '2026-12-31']) assert.equal(isCompleteDate(date), true);
  for (const date of [null, '2026', '2026-12', '2026-2-01', '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-01-00', '0000-01-01', '9999-12-31', '2026-10-16\r\nSTATUS:CANCELLED']) {
    assert.equal(isCompleteDate(date), false, String(date));
    assert.deepEqual(reconcile({}, [{ ...title, date }]), {});
  }
  assert.deepEqual(reconcile({ tt1234: { ...title, modifiedAt: 'bad' } }, []), {});
  assert.deepEqual(reconcile({}, [{ ...title, id: 'bad\r\nBEGIN:VEVENT' }]), {});
  assert.throws(() => reconcileEvents({}, [], { now: 'bad' }), /valid date/);
});

test('identical refreshes keep event timestamps, sequence and serialized bytes unchanged', () => {
  const before = reconcile({}, [title]);
  const after = reconcile(before, [title], secondRefresh);
  assert.deepEqual(after, before);
  assert.equal(after.tt1234.sequence, 0);
  assert.equal(after.tt1234.createdAt, firstRefresh);
  assert.equal(renderCalendar({ events: before }), renderCalendar({ events: after }));
  assert.match(renderCalendar({ events: after }), /DTSTAMP:20261016T040000Z\r\n/);
});

test('reschedules, renames, cancellation and reappearance keep a stable UID and advance sequence', () => {
  const initial = reconcile({}, [title]);
  const rescheduled = reconcile(initial, [{ ...title, date: '2027-01-01' }], secondRefresh);
  const renamed = reconcile(rescheduled, [{ ...title, title: 'A New Title', date: '2027-01-01' }], '2026-10-18T04:00:00Z');
  const cancelled = reconcile(renamed, [], '2026-10-19T04:00:00Z');
  const stillCancelled = reconcile(cancelled, [{ ...title, date: null }], '2026-10-20T04:00:00Z');
  const returned = reconcile(stillCancelled, [title], '2026-10-21T04:00:00Z');
  assert.equal(rescheduled.tt1234.sequence, 1);
  assert.equal(renamed.tt1234.sequence, 2);
  assert.equal(cancelled.tt1234.sequence, 3);
  assert.equal(cancelled.tt1234.status, 'CANCELLED');
  assert.equal(cancelled.tt1234.date, '2027-01-01');
  assert.equal(cancelled.tt1234.title, 'A New Title');
  assert.deepEqual(stillCancelled, cancelled);
  assert.equal(returned.tt1234.sequence, 4);
  assert.equal(returned.tt1234.status, 'CONFIRMED');
  assert.equal(returned.tt1234.createdAt, firstRefresh);
  for (const state of [initial, rescheduled, renamed, cancelled, returned]) {
    assert.match(renderCalendar({ events: state }), /UID:tt1234@release-calendar\r\n/);
  }
  assert.match(renderCalendar({ events: cancelled }), /STATUS:CANCELLED\r\n/);
  assert.equal(initial.tt1234.sequence, 0, 'previous state must not be mutated');
});

test('an unknown or invalid date cancels a prior event without inventing a replacement date', () => {
  const before = reconcile({}, [title]);
  for (const date of [null, '2027', '2027-02-30']) {
    const after = reconcile(before, [{ ...title, date }], secondRefresh);
    assert.equal(after.tt1234.status, 'CANCELLED');
    assert.equal(after.tt1234.date, title.date);
    assert.equal(after.tt1234.sequence, 1);
  }
});

test('cancellation tombstones survive later refreshes so slow subscribers can remove events', () => {
  const initial = reconcile({}, [title]);
  const cancelled = reconcile(initial, [], secondRefresh);
  assert.deepEqual(reconcile(cancelled, [], '2027-10-17T04:00:00Z'), cancelled);
});

test('duplicate titles and input order produce the same membership and calendar', () => {
  const entries = [
    { ...title, date: null },
    { ...title, title: 'Z Title', date: '2027-02-01' },
    { ...title, title: 'B Title' },
    { ...title, title: 'A Title' },
    { id: 'tt1111', title: 'Another', date: '2025-01-01' },
  ];
  const normal = reconcile({}, entries);
  const reversed = reconcile({}, entries.toReversed());
  assert.deepEqual(normal, reversed);
  assert.equal(normal.tt1234.title, 'A Title');
  assert.equal(normal.tt1234.date, title.date);
  assert.equal(Object.keys(normal).length, 2);
  assert.equal(renderCalendar({ events: normal }), renderCalendar({ events: Object.values(reversed).toReversed() }));
});

test('all-day dates have exclusive next-day ends across leap days, months and years', () => {
  for (const [date, expectedEnd] of [
    ['2024-02-28', '20240229'], ['2024-02-29', '20240301'],
    ['2026-02-28', '20260301'], ['2026-12-31', '20270101'],
  ]) {
    const ics = renderCalendar({ events: reconcile({}, [{ ...title, date }]) });
    assert.match(ics, new RegExp(`DTSTART;VALUE=DATE:${date.replaceAll('-', '')}\\r\\n`));
    assert.match(ics, new RegExp(`DTEND;VALUE=DATE:${expectedEnd}\\r\\n`));
    assert.doesNotMatch(ics, /TZID|VTIMEZONE/);
  }
});

test('date output is independent of the process timezone', () => {
  const moduleUrl = new URL('../src/calendar.mjs', import.meta.url).href;
  const source = `import {reconcileEvents,renderCalendar} from ${JSON.stringify(moduleUrl)}; console.log(renderCalendar({events:reconcileEvents({},[${JSON.stringify(title)}],{now:${JSON.stringify(firstRefresh)}})}));`;
  const outputs = ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC'].map((TZ) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8', env: { ...process.env, TZ }, timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout;
  });
  assert.equal(outputs[0], outputs[1]);
  assert.equal(outputs[1], outputs[2]);
});

test('UTC markers use midnight UTC for local conversion without inventing a duration', () => {
  const events = reconcile({}, [{ ...title, date: '2026-12-31' }]);
  const ics = renderCalendar({ events, eventTimeMode: 'utc' });
  assert.match(ics, /DTSTART:20261231T000000Z\r\n/);
  assert.doesNotMatch(ics, /DTEND|\r\nDURATION[:;]|VALUE=DATE|TZID|VTIMEZONE/);
  assert.match(renderCalendar({ events, eventTimeMode: 'date' }), /DTSTART;VALUE=DATE:20261231\r\n/);
});

test('UTF-8 folding preserves code points, <=75-octet physical lines and CRLF endings', () => {
  const longTitle = '星🌕é'.repeat(60);
  const ics = renderCalendar({ name: '月'.repeat(60), events: reconcile({}, [{ ...title, title: longTitle }]) });
  assert.equal(ics.endsWith('\r\n'), true);
  assert.doesNotMatch(ics.replaceAll('\r\n', ''), /[\r\n]/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.match(ics, /\r\n /);
  assert.ok(unfold(ics).includes(`SUMMARY:${longTitle}\r\n`));
  assert.equal(Buffer.from(ics).toString('utf8'), ics);
  assert.doesNotMatch(ics, /\uFFFD/);
});

test('text escaping prevents line injection while retaining punctuation and line breaks', () => {
  const unsafeTitle = 'One, Two; Three\\Four\r\nBEGIN:VEVENT\nSTATUS:CANCELLED\rEnd\u0000';
  const ics = renderCalendar({
    name: 'My, Calendar;\\\r\nTest', description: 'A\rB\nC',
    events: reconcile({}, [{ ...title, title: unsafeTitle }]),
  });
  assert.equal(ics.split('\r\n').filter((line) => line === 'BEGIN:VEVENT').length, 1);
  const logical = unfold(ics);
  assert.ok(logical.includes('SUMMARY:One\\, Two\\; Three\\\\Four\\nBEGIN:VEVENT\\nSTATUS:CANCELLED\\nEnd\r\n'));
  assert.ok(logical.includes('X-WR-CALNAME:My\\, Calendar\\;\\\\\\nTest\r\n'));
  assert.ok(logical.includes('X-WR-CALDESC:A\\nB\\nC\r\n'));
  assert.equal(ics.includes('\u0000'), false);
});

test('malformed persisted events are omitted without breaking a valid feed', () => {
  const events = reconcile({}, [title]);
  const ics = renderCalendar({ events: {
    ...events, badDate: { ...events.tt1234, id: 'tt2', date: '2026-02-30' },
    badTime: { ...events.tt1234, id: 'tt3', modifiedAt: 'no' },
    badSequence: { ...events.tt1234, id: 'tt4', sequence: -1 },
    badId: { ...events.tt1234, id: 'tt1\r\nSTATUS:CANCELLED' },
    null: null,
  } });
  assert.equal(ics.split('\r\n').filter((line) => line === 'BEGIN:VEVENT').length, 1);
  assert.match(ics, /URL:https:\/\/www.imdb.com\/title\/tt1234\/\r\n/);
  assert.match(renderCalendar(), /^BEGIN:VCALENDAR\r\n/);
});
