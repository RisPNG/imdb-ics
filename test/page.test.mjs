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

test('renders usable subscription links and complete dates without JavaScript', () => {
  const html = renderPage({ baseUrl, feeds: [{ ...feed, slug: 'all', kind: undefined, label: 'All releases', url: null }, feed],
    upcoming: [{ title: 'A release', date: '2026-12-18', sources: ['Marvel'] }], updatedAt: feed.updatedAt });
  assert.match(html, /href="webcal:\/\/calendar\.example\/calendars\/marvel\.ics"/);
  assert.match(html, /value="https:\/\/calendar\.example\/calendars\/marvel\.ics" readonly/);
  assert.match(html, /<time datetime="2026-12-18">Dec 18, 2026<\/time>/);
  assert.match(html, /2 releases/);
  assert.match(html, /1 without complete dates/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.equal((html.match(/id="subscription-\d+"/g) || []).length, 2);
  assert.doesNotMatch(html, /<script\b|<style\b|<[^>]+\s(?:on\w+|style)\s*=/i);
});

test('keeps every subscription accessible in native controls while sorting the people directory', () => {
  const feeds = [{ slug: 'all', label: 'All releases', url: null }, ...SOURCES].map((source) => ({
    ...feed, ...source,
    subscriptionUrl: `${baseUrl}/calendars/${source.slug}.ics`,
    webcalUrl: `webcal://calendar.example/calendars/${source.slug}.ics`,
  }));
  const html = renderPage({ baseUrl, feeds });
  const summaries = [...html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)].map((match) => match[1]);
  const people = SOURCES.filter((source) => source.kind === 'name');
  const directory = summaries.map((summary) => summary.replace(/<[^>]*>/g, ''))
    .flatMap((summary) => {
      const person = people.find((source) => summary.startsWith(source.label));
      return person ? [person.label] : [];
    });
  assert.deepEqual(directory, people.map((person) => person.label).sort(new Intl.Collator('en').compare));
  assert.equal(summaries.filter((summary) => summary === 'Calendar address').length, feeds.length);
  assert(summaries.every((summary) => !/<a\b|<button\b|<input\b/.test(summary)), 'Disclosure summaries must not contain nested controls.');
  for (const [index, item] of feeds.entries()) {
    const input = html.match(new RegExp(`<input\\b[^>]*\\bid="subscription-${index}"[^>]*>`))?.[0];
    assert(input, `${item.label} retains its unique address ID after sorting.`);
    assert(input.includes(`value="${item.subscriptionUrl}" readonly`));
    assert.equal(html.split(`value="${item.subscriptionUrl}"`).length - 1, 1, item.label);
    assert.equal(html.split(`href="${item.webcalUrl}"`).length - 1, 1, item.label);
    assert(html.includes(`<label for="subscription-${index}">`));
  }
  const releasesAt = html.indexOf('id="upcoming"');
  const calendarsAt = html.indexOf('id="calendars"');
  const peopleAt = html.indexOf('id="people"');
  assert(releasesAt > 0 && releasesAt < calendarsAt && calendarsAt < peopleAt);
  const interests = html.slice(calendarsAt, peopleAt);
  assert.equal((interests.match(/<h3\b/g) || []).length, 3);
  for (const source of SOURCES.filter((source) => source.kind === 'interest')) assert(interests.includes(`<h3>${source.label}</h3>`));
  assert.match(html, /<h2\b[^>]*>All releases<\/h2>/);
  assert.match(html, /<main\b[^>]*id="main"[^>]*tabindex="-1"/);
  assert.doesNotMatch(html, /<script\b|<button\b|data-copy=/);
});

test('release rows show complete dates first and expose grouped episode notes and valid IMDb title links', () => {
  const html = renderPage({ baseUrl, upcoming: [
    { id: 'tt3456789-2026-12-18', titleId: 'tt3456789', title: 'A series', date: '2026-12-18',
      sources: ['Marvel', 'Dan Harmon'], episodeIds: ['tt4567890', 'tt5678901'], description: 'S01E01: A beginning\nS01E02: The <next> chapter' },
    { id: 'tt6789012', title: 'A movie', date: '2027-01-02' },
    { id: 'tt7890123/path', title: 'An unlinked title', date: '2027-01-03' },
  ] });
  assert.match(html, /<tr><td\b[^>]*><time datetime="2026-12-18">Dec 18, 2026<\/time><\/td><td\b[^>]*>/);
  assert.match(html, /href="https:\/\/www.imdb.com\/title\/tt3456789\/"[^>]*>A series<\/a>/);
  assert.match(html, /href="https:\/\/www.imdb.com\/title\/tt6789012\/"[^>]*>A movie<\/a>/);
  assert.doesNotMatch(html, /href="[^"]*tt3456789-2026|href="[^"]*tt7890123/);
  assert.match(html, /<details\b[^>]*><summary>2 episodes<\/summary><p>S01E01: A beginning\nS01E02: The &lt;next&gt; chapter<\/p><\/details>/);
  assert.match(html, /Marvel · Dan Harmon/);
  assert.match(html, />An unlinked title<\/td>/);
});

test('escapes source data in text and attribute contexts and rejects active URLs', () => {
  const attack = '"><img src=x onerror=alert(1)>';
  const html = renderPage({ baseUrl, feeds: [{ ...feed, label: attack, subscriptionUrl: 'javascript:alert(1)',
    webcalUrl: 'javascript:alert(2)', url: 'data:text/html,hi' }],
    upcoming: [{ id: attack, titleId: attack, title: attack, date: '2026-12-18', description: attack, sources: [attack] }] });
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|href="javascript:|href="data:|value="javascript:/);
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
