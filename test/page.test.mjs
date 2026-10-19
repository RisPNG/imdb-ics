import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/page.mjs';
import { SOURCES } from '../src/config.mjs';

const baseUrl = 'https://calendar.example';
const feed = {
  slug: 'marvel', kind: 'interest', label: 'Marvel', url: 'https://www.imdb.com/interest/in0000248/',
  subscriptionUrl: `${baseUrl}/calendars/marvel.ics`, webcalUrl: 'webcal://calendar.example/calendars/marvel.ics',
  count: 2, status: 'ready', updatedAt: '2026-10-16T08:00:00Z', omitted: 1,
};

test('renders visible subscription links, TBA counts, and complete dates without requiring JavaScript', () => {
  const html = renderPage({ baseUrl, feeds: [{ ...feed, slug: 'all', kind: undefined, label: 'All releases', url: null }, feed],
    upcoming: [{ title: 'A release', date: '2026-12-18', sources: ['Marvel'] }], updatedAt: feed.updatedAt });
  assert.match(html, /href="webcal:\/\/calendar\.example\/calendars\/marvel\.ics"/);
  assert.match(html, /value="https:\/\/calendar\.example\/calendars\/marvel\.ics" readonly/);
  assert.match(html, /<time datetime="2026-12-18">[^<]+<\/time>/);
  assert.match(html, /2 releases/);
  assert.match(html, /1 TBA/);
  assert.doesNotMatch(html, /without complete dates|Release Calendar/);
  assert.match(html, /Ris(?:&#39;|&apos;|') IMDb ICalendar/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.equal((html.match(/id="subscription-\d+"/g) || []).length, 2);
  assert.match(html, /<script\b[^>]*src="\/enhance\.js"[^>]*defer[^>]*><\/script>/);
  assert.doesNotMatch(html, /<style\b|<[^>]+\s(?:on\w+|style)\s*=/i);
});

test('keeps every address visible and every source reachable through ordinary page links', () => {
  const feeds = [{ slug: 'all', kind: undefined, label: 'All releases', url: null }, ...SOURCES].map((source) => ({
    ...feed, ...source,
    subscriptionUrl: `${baseUrl}/calendars/${source.slug}.ics`,
    webcalUrl: `webcal://calendar.example/calendars/${source.slug}.ics`,
  }));
  const html = renderPage({ baseUrl, feeds });
  const people = SOURCES.filter((source) => source.kind === 'name');
  const directory = html.slice(html.indexOf('id="people"'));
  const positions = people.map((person) => ({ label: person.label, index: directory.indexOf(`/people/${person.slug}/`) }))
    .sort((a, b) => a.index - b.index);
  assert(positions.every((person) => person.index >= 0));
  assert.deepEqual(positions.map((person) => person.label), people.map((person) => person.label).sort(new Intl.Collator('en').compare));
  for (const match of html.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/g)) {
    assert.doesNotMatch(match[1], /<input\b/, 'Subscription addresses must not be hidden inside a disclosure.');
  }
  for (const match of html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)) {
    assert.doesNotMatch(match[1], /<a\b|<button\b|<input\b/, 'Disclosure summaries must not contain nested controls.');
  }
  for (const [index, item] of feeds.entries()) {
    const input = html.match(new RegExp(`<input\\b[^>]*\\bid="subscription-${index}"[^>]*>`))?.[0];
    assert(input, `${item.label} retains its unique address ID after sorting.`);
    assert(input.includes(`value="${item.subscriptionUrl}" readonly`));
    assert.equal(html.split(`value="${item.subscriptionUrl}"`).length - 1, 1, item.label);
    assert.equal(html.split(`href="${item.webcalUrl}"`).length - 1, 1, item.label);
    assert(html.includes(`<label for="subscription-${index}">`));
    assert.match(html, new RegExp(`<button\\b[^>]*\\bdata-copy="subscription-${index}"[^>]*>`));
  }
  const releasesAt = html.indexOf('id="upcoming"');
  const calendarsAt = html.indexOf('id="calendars"');
  const peopleAt = html.indexOf('id="people"');
  assert(releasesAt > 0 && releasesAt < calendarsAt && calendarsAt < peopleAt);
  const interests = html.slice(calendarsAt, peopleAt);
  for (const source of SOURCES) {
    const path = `/${source.kind === 'name' ? 'people' : 'interests'}/${source.slug}/`;
    assert(html.includes(`href="${path}"`), source.label);
  }
  for (const source of SOURCES.filter((source) => source.kind === 'interest')) assert(interests.includes(`/interests/${source.slug}/`));
  assert.match(html, /<h2\b[^>]*>All releases<\/h2>/);
  assert.match(html, /<main\b[^>]*id="main"[^>]*tabindex="-1"/);
  assert.doesNotMatch(html, /<select\b|onclick=/);
});

test('source pages use their own title, canonical URL, local image, and single visible subscription', () => {
  const feeds = [{ slug: 'all', kind: undefined, label: 'All releases', url: null }, ...SOURCES].map((source) => ({
    ...feed, ...source,
    subscriptionUrl: `${baseUrl}/calendars/${source.slug}.ics`,
    webcalUrl: `webcal://calendar.example/calendars/${source.slug}.ics`,
  }));
  for (const source of [SOURCES[0], SOURCES.at(-1)]) {
    const path = `/${source.kind === 'name' ? 'people' : 'interests'}/${source.slug}/`;
    const html = renderPage({ baseUrl, feeds, sourceSlug: source.slug });
    assert.match(html, new RegExp(`<title>[^<]*${source.label}[^<]*Ris(?:&#39;|&apos;|') IMDb ICalendar[^<]*<\\/title>`));
    assert(html.includes(`rel="canonical" href="${baseUrl}${path}"`));
    assert.match(html, new RegExp(`<h1\\b[^>]*>${source.label}<\\/h1>`));
    assert.equal((html.match(/<input\b/g) || []).length, 1);
    assert.equal(html.split(`value="${baseUrl}/calendars/${source.slug}.ics"`).length - 1, 1);
    assert.match(html, /<img\b[^>]*src="\/images\/[^".]+\.(?:jpg|svg)"[^>]*>/);
    assert.doesNotMatch(html, /<img\b[^>]*src="https?:/);
    assert(html.includes(`href="${source.url}"`));
    assert(html.includes('role="status"'));
    for (const item of SOURCES) {
      assert(html.includes(`href="/${item.kind === 'name' ? 'people' : 'interests'}/${item.slug}/"`), item.label);
    }
  }
});

test('release rows show complete dates first and expose grouped episode notes and valid IMDb title links', () => {
  const html = renderPage({ baseUrl, upcoming: [
    { id: 'tt3456789-2026-12-18', titleId: 'tt3456789', title: 'A series', date: '2026-12-18',
      sources: ['Marvel', 'Dan Harmon'], episodeIds: ['tt4567890', 'tt5678901'], description: 'S01E01: A beginning\nS01E02: The <next> chapter' },
    { id: 'tt6789012', title: 'A movie', date: '2027-01-02' },
    { id: 'tt7890123/path', title: 'An unlinked title', date: '2027-01-03' },
  ] });
  assert.match(html, /<tr><td\b[^>]*><time datetime="2026-12-18">[^<]+<\/time><\/td><td\b[^>]*>/);
  assert.match(html, /href="https:\/\/www.imdb.com\/title\/tt3456789\/"[^>]*>A series<\/a>/);
  assert.match(html, /href="https:\/\/www.imdb.com\/title\/tt6789012\/"[^>]*>A movie<\/a>/);
  assert.doesNotMatch(html, /href="[^"]*tt3456789-2026|href="[^"]*tt7890123/);
  assert.match(html, /<details\b[^>]*><summary>2 episodes<\/summary><p>S01E01: A beginning\nS01E02: The &lt;next&gt; chapter<\/p><\/details>/);
  assert.match(html, /Marvel(?: ·|,| &amp;| and)? Dan Harmon/);
  assert.match(html, />An unlinked title<\/td>/);
});

test('combined source attribution stays visible without becoming episode notes', () => {
  const episodeDescription = 'S01E01: A beginning\nS01E02: The <next> chapter';
  const html = renderPage({ baseUrl, upcoming: [
    { id: 'tt1234567', title: 'A combined movie', date: '2026-12-18',
      sources: ['Edward Norton', 'Mark Ruffalo'], description: 'People: Edward Norton, Mark Ruffalo', episodeDescription: '' },
    { id: 'tt2345678-2026-12-19', titleId: 'tt2345678', title: 'A combined series', date: '2026-12-19',
      sources: ['DC', 'James Gunn'], episodeIds: ['tt3456789', 'tt4567890'],
      description: `${episodeDescription}\n\nPeople: James Gunn\nInterests: DC`, episodeDescription },
  ] });
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
  const movie = rows.find((row) => row.includes('A combined movie'));
  const series = rows.find((row) => row.includes('A combined series'));
  assert(movie && series);
  assert.match(movie, /<p class="release-meta">Edward Norton, Mark Ruffalo<\/p>/);
  assert.doesNotMatch(movie, /<details\b|Episode details|People:/);
  assert.match(series, /<p class="release-meta">DC, James Gunn<\/p>/);
  assert.match(series, /<details class="episode-notes"><summary>2 episodes<\/summary><p>S01E01: A beginning\nS01E02: The &lt;next&gt; chapter<\/p><\/details>/);
  assert.doesNotMatch(series, /People:|Interests:/);
  assert.equal((html.match(/class="episode-notes"/g) || []).length, 1);
});

test('escapes source data in text and attribute contexts and rejects active URLs', () => {
  const attack = '"><img src=x onerror=alert(1)>';
  const html = renderPage({ baseUrl, feeds: [{ ...feed, label: attack, subscriptionUrl: 'javascript:alert(1)',
    webcalUrl: 'javascript:alert(2)', url: 'data:text/html,hi' }],
    upcoming: [{ id: attack, titleId: attack, title: attack, date: '2026-12-18', description: attack, sources: [attack] }] });
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x|href="javascript:|href="data:|value="javascript:/);
  assert.match(html, /Subscription unavailable/);
});

test('shows pending and saved-data states without inventing an update date', () => {
  const pending = renderPage({ baseUrl, feeds: [{ ...feed, status: 'pending', count: null, updatedAt: null }] });
  assert.match(pending, /Awaiting first update/);
  assert.match(pending, /Waiting for the first source update/);
  assert.doesNotMatch(pending, /Last successful update|1970|0 releases/);
  const stale = renderPage({ baseUrl, feeds: [{ ...feed, status: 'stale' }], stale: true, updatedAt: feed.updatedAt });
  assert.match(stale, /Showing saved release dates/);
  assert.match(stale, /Using saved dates/);
  assert.match(stale, /Last successful update/);
  const unavailable = renderPage({ baseUrl, feeds: [{ ...feed, status: 'error', count: null, updatedAt: null }] });
  assert.match(unavailable, /Update unavailable/);
  assert.doesNotMatch(unavailable, /Last successful update|1970|0 releases/);
});

test('omits incomplete and impossible release dates', () => {
  const html = renderPage({ baseUrl, upcoming: [
    { title: 'Incomplete', date: '2026-12' }, { title: 'Impossible', date: '2026-02-30' },
  ] });
  assert.match(html, /No upcoming releases to show yet/);
  assert.doesNotMatch(html, /<tbody>|Incomplete|Impossible/);
});

test('uses the public dashboard URL and describes the chosen event time', () => {
  const html = renderPage({ baseUrl, feeds: [feed] });
  assert.match(html, /rel="canonical" href="https:\/\/calendar\.example\/"/);
  assert.doesNotMatch(html, /noindex|nofollow/);
  assert.match(html, /all-day events/);
  assert.match(html, /same calendar date in every time zone/);
  assert.match(html, /Marvel, Star Wars, and DC include every confirmed episode date/);
  assert.match(html, /People calendars include only their directly credited titles and episodes/);
  assert.match(html, /Episodes released together share an event under the series name, with episode numbers and titles in its description/);
  assert.doesNotMatch(html, /midnight UTC/);
  const utc = renderPage({ baseUrl, eventTimeMode: 'utc' });
  assert.match(utc, /midnight UTC/);
  assert.match(utc, /not the actual release time/);
});
