import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { isCompleteDate, reconcileEvents, renderCalendar } from '../src/calendar.mjs';

const firstRefresh = '2026-10-16T04:00:00.000Z';
const secondRefresh = '2026-10-17T04:00:00.000Z';
const title = { id: 'tt1234', title: 'A Release', date: '2026-12-18' };
const reconcile = (before, titles, now = firstRefresh) => reconcileEvents(before, titles, { now });
const unfold = (calendar) => calendar.replace(/\r\n[ \t]/g, '');
const series = { id: 'tt9253284', title: 'Andor', date: '2022-09-21', type: 'tvSeries' };
const episode = (id, number, date, name = `Episode ${number}`) => ({
  id, title: name, date, type: 'tvEpisode',
  series: { id: series.id, title: series.title, date: series.date, season: 2, episode: number },
});

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

test('groups single and batch releases under the series title without duplicating the premiere', () => {
  const premiere = episode('tt9419264', 1, series.date, 'Kassa');
  premiere.series.season = 1;
  const first = episode('tt20258964', 1, '2025-04-22', 'One Year Later');
  const second = episode('tt20603288', 2, '2025-04-22', 'Sagrona Teema');
  const third = episode('tt20603292', 3, '2025-04-22', 'Harvest');
  const fourth = episode('tt20603294', 4, '2025-04-29', 'Ever Been to Ghorman?');
  const undated = episode('tt20603298', 5, null);
  const before = reconcile({}, [series, first]);
  const events = reconcile(before, [{ ...series, episodes: [third, premiere, first, undated, fourth, second] }, second], secondRefresh);
  const active = Object.values(events).filter((event) => event.status === 'CONFIRMED');
  assert.equal(active.length, 3);
  assert.ok(active.every((event) => event.title === 'Andor' && event.titleId === series.id));
  assert.equal(events[series.id].createdAt, firstRefresh);
  assert.equal(events[series.id].sequence, 1);
  assert.equal(events[series.id].description, 'S01E01: Kassa');
  assert.equal(events['tt9253284-2025-04-22'].description, 'S02E01: One Year Later\nS02E02: Sagrona Teema\nS02E03: Harvest');
  assert.deepEqual(events['tt9253284-2025-04-22'].episodeIds, [first.id, second.id, third.id]);
  assert.equal(events['tt9253284-2025-04-29'].description, 'S02E04: Ever Been to Ghorman?');
  assert.ok(!active.some((event) => event.episodeIds.includes(undated.id)));
  const ics = unfold(renderCalendar({ events }));
  assert.equal(ics.match(/SUMMARY:Andor\r\n/g).length, 3);
  assert.match(ics, /DESCRIPTION:S02E01: One Year Later\\nS02E02: Sagrona Teema\\nS02E03: Harvest\r\n/);
  assert.equal(ics.match(/URL:https:\/\/www.imdb.com\/title\/tt9253284\/\r\n/g).length, 3);
  assert.doesNotMatch(ics, /RRULE:/);
  assert.deepEqual(reconcile(events, [{ ...series, episodes: [premiere, second, fourth, first, third, undated] }, first], '2026-10-18T00:00:00Z'), events);
});

test('episode-only sources group dates without expanding the parent series or fabricating numbering', () => {
  const numbered = episode('tt20258964', 1, '2025-04-22', 'One Year Later');
  const unknown = episode('tt20603288', null, '2025-04-22', 'Sagrona Teema');
  unknown.series.season = null;
  const events = reconcile({}, [unknown, numbered]);
  assert.deepEqual(Object.keys(events), ['tt9253284-2025-04-22']);
  assert.equal(events['tt9253284-2025-04-22'].description, 'S02E01: One Year Later\nSagrona Teema');
  const withoutSeason = { ...unknown, series: { ...unknown.series, episode: 2 } };
  const withoutEpisode = { ...unknown, series: { ...unknown.series, season: 2 } };
  assert.match(Object.values(reconcile({}, [withoutSeason]))[0].description, /^Episode 2: /);
  assert.match(Object.values(reconcile({}, [withoutEpisode]))[0].description, /^Season 2: /);
});

test('premiere episodes have the same UID in series, episode-only, and combined feeds', () => {
  const first = episode('tt9419264', 1, series.date, 'Kassa');
  first.series.season = 1;
  const direct = reconcile({}, [first]);
  const expanded = reconcile({}, [{ ...series, episodes: [first] }]);
  const combined = reconcile({}, [{ ...series, episodes: [first] }, first]);
  assert.deepEqual(direct, expanded);
  assert.deepEqual(expanded, combined);
  assert.deepEqual(Object.keys(direct), [series.id]);
  assert.match(renderCalendar({ events: direct }), /UID:tt9253284@release-calendar\r\n/);
});

test('episode-only sources with different saved parent dates cannot merge separate release days', () => {
  const first = episode('tt9419264', 1, series.date, 'Kassa');
  const second = episode('tt13847542', 4, '2022-09-28', 'Aldhani');
  second.series.date = second.date;
  const events = reconcile({}, [second, first]);
  assert.deepEqual(Object.keys(events), [series.id, `${series.id}-2022-09-28`]);
  assert.deepEqual(events[series.id].episodeIds, [first.id]);
  assert.deepEqual(events[`${series.id}-2022-09-28`].episodeIds, [second.id]);
  assert.deepEqual(reconcile({}, [first, second]), events);
});

test('episode title, numbering, and membership changes revise descriptions and unchanged snapshots remain stable', () => {
  const first = episode('tt20258964', 1, '2025-04-22', 'One Year Later');
  const second = episode('tt20603288', 2, '2025-04-22', 'Sagrona Teema');
  const groupId = 'tt9253284-2025-04-22';
  const initial = reconcile({}, [{ ...series, episodes: [first] }]);
  const renamed = reconcile(initial, [{ ...series, episodes: [{ ...first, title: 'Updated title' }] }], secondRefresh);
  assert.equal(renamed[groupId].sequence, 1);
  assert.equal(renamed[groupId].date, initial[groupId].date);
  assert.equal(renamed[groupId].modifiedAt, secondRefresh);
  assert.equal(renamed[groupId].createdAt, firstRefresh);
  assert.notEqual(renderCalendar({ events: initial }), renderCalendar({ events: renamed }));
  const renumbered = reconcile(renamed, [{ ...series, episodes: [{ ...first, title: 'Updated title', series: { ...first.series, episode: 3 } }] }], secondRefresh);
  assert.equal(renumbered[groupId].sequence, 2);
  assert.equal(renumbered[groupId].description, 'S02E03: Updated title');
  const added = reconcile(renumbered, [{ ...series, episodes: [first, second] }], secondRefresh);
  assert.equal(added[groupId].sequence, 3);
  const replaced = reconcile(added, [{ ...series, episodes: [{ ...first, id: 'tt29999999' }, second] }], secondRefresh);
  assert.equal(replaced[groupId].description, added[groupId].description);
  assert.equal(replaced[groupId].sequence, 4, 'membership changes still revise identical displayed text');
  assert.equal(replaced[series.id].sequence, 0, 'unrelated premiere does not change');
});

test('batch splits, merges, withdrawn dates, and returns preserve cancellation history', () => {
  const first = episode('tt20258964', 1, '2025-04-22', 'One Year Later');
  const second = episode('tt20603288', 2, '2025-04-22', 'Sagrona Teema');
  const firstId = 'tt9253284-2025-04-22';
  const nextId = 'tt9253284-2025-04-29';
  const initial = reconcile({}, [{ ...series, episodes: [first, second] }]);
  const split = reconcile(initial, [{ ...series, episodes: [first, { ...second, date: '2025-04-29' }] }], secondRefresh);
  assert.deepEqual(split[firstId].episodeIds, [first.id]);
  assert.deepEqual(split[nextId].episodeIds, [second.id]);
  const merged = reconcile(split, [{ ...series, episodes: [{ ...first, date: '2025-04-29' }, { ...second, date: '2025-04-29' }] }], secondRefresh);
  assert.equal(merged[firstId].status, 'CANCELLED');
  assert.equal(merged[firstId].sequence, 2);
  assert.equal(merged[nextId].status, 'CONFIRMED');
  assert.deepEqual(merged[nextId].episodeIds, [first.id, second.id]);
  assert.equal(merged[nextId].sequence, 1);
  const withdrawn = reconcile(merged, [{ ...series, episodes: [{ ...first, date: null }, { ...second, date: null }] }], secondRefresh);
  assert.equal(withdrawn[nextId].status, 'CANCELLED');
  assert.deepEqual(reconcile(withdrawn, [series], secondRefresh), withdrawn);
  const returned = reconcile(withdrawn, [{ ...series, episodes: [first, second] }], secondRefresh);
  assert.equal(returned[firstId].status, 'CONFIRMED');
  assert.equal(returned[firstId].sequence, 3);
  assert.equal(returned[firstId].createdAt, firstRefresh);
  assert.equal(returned[nextId].status, 'CANCELLED');
  assert.equal(initial[firstId].episodeIds.length, 2, 'previous membership is not mutated');
});

test('legacy standalone episodes are cancelled when grouped and stale metadata cannot create duplicates', () => {
  const first = episode('tt20258964', 1, '2025-04-22', 'One Year Later');
  const legacy = { id: first.id, title: first.title, date: first.date };
  const before = reconcile({}, [legacy]);
  const data = [legacy, { ...series, episodes: [{ ...first, title: 'Updated title', date: '2025-04-29' }] }];
  const after = reconcile(before, data, secondRefresh);
  assert.equal(after[first.id].status, 'CANCELLED');
  assert.equal(after[first.id].createdAt, firstRefresh);
  assert.deepEqual(after['tt9253284-2025-04-22'].episodeIds, [first.id]);
  assert.deepEqual(after, reconcile(before, data.toReversed(), secondRefresh));
});

test('episode descriptions escape and fold punctuation, multiline text, and UTF-8 safely', () => {
  const name = '星🌕é'.repeat(30) + ', semi; slash\\\r\nSTATUS:CANCELLED\u0000';
  const events = reconcile({}, [episode('tt20258964', 1, '2025-04-22', name)]);
  const ics = renderCalendar({ events });
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal(ics.split('\r\n').filter((line) => line === 'STATUS:CANCELLED').length, 0);
  assert.ok(unfold(ics).includes('\\, semi\\; slash\\\\\\nSTATUS:CANCELLED'));
  assert.doesNotMatch(ics, /\u0000|\uFFFD/);
});

test('switching a filmography to credited episodes retires unrelated groups without changing interest releases', () => {
  const credited = episode('tt20258964', 1, '2025-04-22', 'One Year Later');
  const unrelated = episode('tt20603294', 4, '2025-04-29', 'Ever Been to Ghorman?');
  const expanded = { ...series, episodes: [credited, unrelated] };
  const before = reconcile({}, [expanded]);
  const filmography = reconcile(before, [series, credited], secondRefresh);
  assert.equal(filmography[series.id].status, 'CONFIRMED');
  assert.equal(filmography[series.id].sequence, 0);
  assert.deepEqual(filmography['tt9253284-2025-04-22'].episodeIds, [credited.id]);
  assert.equal(filmography['tt9253284-2025-04-29'].status, 'CANCELLED');
  assert.equal(filmography['tt9253284-2025-04-29'].sequence, 1);
  assert.equal(filmography['tt9253284-2025-04-29'].createdAt, firstRefresh);
  const combined = reconcile(before, [expanded, series, credited], secondRefresh);
  assert.deepEqual(combined, before, 'the interest still supplies the complete episode membership');
});

test('combined attribution merges interests and credited people without duplicating releases or episode lists', () => {
  const first = episode('tt20258964', 1, '2025-04-22', 'One Year Later');
  const second = episode('tt20603288', 2, first.date, 'Sagrona Teema');
  const next = episode('tt20603294', 4, '2025-04-29', 'Ever Been to Ghorman?');
  const expanded = { ...series, episodes: [first, second, next] };
  const sources = [
    { kind: 'interest', label: 'Star Wars', titles: [title, expanded] },
    { kind: 'interest', label: 'Marvel', titles: [title, expanded] },
    { kind: 'name', label: 'Vince Gilligan', titles: [title, series, first] },
    { kind: 'name', label: 'Justin Roiland', titles: [title, second, next] },
  ].map((source) => ({ ...source, events: reconcile({}, source.titles) }));
  const events = reconcileEvents({}, sources.flatMap((source) => source.titles), { now: firstRefresh, sources });
  assert.equal(Object.keys(events).length, 4);
  assert.deepEqual(events[title.id].sourceLabels, { interests: ['Marvel', 'Star Wars'], people: ['Justin Roiland', 'Vince Gilligan'] });
  assert.equal(events[title.id].description, 'Interests: Marvel, Star Wars\nPeople: Justin Roiland, Vince Gilligan');
  assert.equal(events[title.id].episodeDescription, '');
  assert.equal(events[series.id].description, 'Interests: Marvel, Star Wars\nPeople: Vince Gilligan');
  const batch = events[`${series.id}-${first.date}`];
  assert.deepEqual(batch.episodeIds, [first.id, second.id]);
  assert.equal(batch.description, 'Interests: Marvel, Star Wars\nPeople: Justin Roiland, Vince Gilligan\n\nS02E01: One Year Later\nS02E02: Sagrona Teema');
  assert.equal(batch.episodeDescription, 'S02E01: One Year Later\nS02E02: Sagrona Teema');
  assert.deepEqual(events[`${series.id}-${next.date}`].sourceLabels.people, ['Justin Roiland']);
  const reversed = sources.toReversed().map((source) => ({ ...source, titles: source.titles.toReversed() }));
  assert.deepEqual(reconcileEvents(events, reversed.flatMap((source) => source.titles), { now: secondRefresh, sources: reversed }), events);
  const ics = unfold(renderCalendar({ events }));
  assert.equal(ics.match(/BEGIN:VEVENT\r\n/g).length, 4);
  assert.equal(ics.match(/UID:tt9253284-2025-04-22@release-calendar\r\n/g).length, 1);
  assert.match(ics, /DESCRIPTION:Interests: Marvel\\, Star Wars\\nPeople: Justin Roiland\\, Vince Gilligan\\n\\nS02E01: One Year Later\\nS02E02: Sagrona Teema\r\n/);
});

test('source attribution follows matched title and episode IDs after selecting their canonical dates', () => {
  const first = episode('tt20258964', 1, '2025-04-22');
  const second = episode('tt20603288', 2, '2025-04-29');
  const changed = { ...first, date: second.date };
  const undated = { ...title, date: null };
  const sources = [
    { kind: 'interest', label: 'Star Wars', titles: [{ ...series, episodes: [first, second] }, title] },
    { kind: 'name', label: 'Earlier credit', titles: [first] },
    { kind: 'name', label: 'Conflicting date', titles: [changed, { ...title, date: '2027-01-01' }] },
    { kind: 'name', label: 'Undated credit', titles: [undated] },
    { kind: 'name', label: 'Series credit', titles: [series] },
  ].map((source) => ({ ...source, events: reconcile({}, source.titles) }));
  const events = reconcileEvents({}, sources.flatMap((source) => source.titles), { now: firstRefresh, sources });
  assert.deepEqual(events[`${series.id}-${first.date}`].sourceLabels.people, ['Conflicting date', 'Earlier credit']);
  assert.deepEqual(events[`${series.id}-${second.date}`].sourceLabels.people, []);
  assert.deepEqual(events[title.id].sourceLabels.people, ['Conflicting date', 'Undated credit']);
  assert.deepEqual(events[series.id].sourceLabels.people, ['Series credit']);
});
