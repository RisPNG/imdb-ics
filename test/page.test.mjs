import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { renderPage } from '../src/page.mjs';
import { SOURCES } from '../src/config.mjs';
import profiles from '../src/profiles.json' with { type: 'json' };
import images from '../src/profile-images.json' with { type: 'json' };

const baseUrl = 'https://calendar.example';
const feed = {
  slug: 'marvel', kind: 'interest', label: 'Marvel', url: 'https://www.imdb.com/interest/in0000248/',
  subscriptionUrl: `${baseUrl}/calendars/marvel.ics`, webcalUrl: 'webcal://calendar.example/calendars/marvel.ics',
  count: 2, status: 'ready', updatedAt: '2026-10-16T08:00:00Z', omitted: 1,
};

test('renders subscription links and complete dates before the deferred enhancement loads', () => {
  const $ = load(renderPage({ baseUrl, feeds: [{ ...feed, slug: 'all', kind: undefined, label: 'All releases', url: null,
    subscriptionUrl: `${baseUrl}/calendars/all.ics`, webcalUrl: 'webcal://calendar.example/calendars/all.ics',
    dateRange: { start: '2024-01-01', end: '2029-12-31' } }, feed],
    upcoming: [{ title: 'A release', date: '2026-12-18', sources: ['Marvel'] }], updatedAt: feed.updatedAt }));
  assert.equal($(`a[href="${feed.webcalUrl}"]`).length, 1);
  const address = $(`input[value="${feed.subscriptionUrl}"]`);
  assert.equal(address.length, 1);
  assert(address.is('[readonly]'));
  for (const date of ['2024-01-01', '2029-12-31', '2026-12-18']) {
    assert($(`time[datetime="${date}"]`).text().trim());
  }
  assert.equal($('link[rel="canonical"]').attr('href'), `${baseUrl}/`);
  assert.equal($('script[src="/enhance.js"][defer]').length, 1);
});

test('keeps every address visible and every source reachable through ordinary page links', () => {
  const feeds = [{ slug: 'all', kind: undefined, label: 'All releases', url: null }, ...SOURCES].map((source) => ({
    ...feed, ...source,
    subscriptionUrl: `${baseUrl}/calendars/${source.slug}.ics`,
    webcalUrl: `webcal://calendar.example/calendars/${source.slug}.ics`,
  }));
  const $ = load(renderPage({ baseUrl, feeds }));
  const addressIds = new Set();
  for (const item of feeds) {
    const input = $(`input[value="${item.subscriptionUrl}"]`);
    assert.equal(input.length, 1, item.label);
    assert(input.is('[type="url"][readonly]:not([hidden])'));
    assert.equal(input.parents('[hidden], details:not([open])').length, 0, item.label);
    const id = input.attr('id');
    assert(id);
    assert(!addressIds.has(id), `${item.label} has a unique copy target.`);
    addressIds.add(id);
    const label = $(`label[for="${id}"]`);
    assert.equal(label.length, 1);
    assert(label.text().includes(item.label));
    assert.equal($(`button[data-copy="${id}"]`).length, 1);
    assert.equal($(`a[href="${item.webcalUrl}"]`).length, 1, item.label);
  }
  for (const source of SOURCES) {
    const path = `/${source.kind === 'name' ? 'people' : 'interests'}/${source.slug}/`;
    const links = $(`a[href="${path}"]`);
    assert(links.length, source.label);
    assert(links.text().includes(source.label));
  }
});

test('source pages use their own title, canonical URL, local image, and single visible subscription', () => {
  const feeds = [{ slug: 'all', kind: undefined, label: 'All releases', url: null }, ...SOURCES].map((source) => ({
    ...feed, ...source,
    subscriptionUrl: `${baseUrl}/calendars/${source.slug}.ics`,
    webcalUrl: `webcal://calendar.example/calendars/${source.slug}.ics`,
  }));
  for (const source of [SOURCES[0], SOURCES.at(-1)]) {
    const path = `/${source.kind === 'name' ? 'people' : 'interests'}/${source.slug}/`;
    const $ = load(renderPage({ baseUrl, feeds, sourceSlug: source.slug }));
    assert($('title').text().includes(source.label));
    assert.equal($('link[rel="canonical"]').attr('href'), `${baseUrl}${path}`);
    assert.equal($('h1').text(), source.label);
    assert.equal($('input[type="url"]').length, 1);
    assert.equal($('input[type="url"]').val(), `${baseUrl}/calendars/${source.slug}.ics`);
    const image = images[source.slug];
    const portrait = $(`img[src="${image.path}"]`);
    assert.equal(portrait.length, 1);
    assert.equal(portrait.attr('alt'), image.alt);
    assert.equal(portrait.attr('width'), String(image.width));
    assert.equal(portrait.attr('height'), String(image.height));
    assert($(`a[href="${source.url}"]`).length);
    for (const reference of profiles[source.slug].references) {
      assert($(`a[href="${reference.url}"]`).text().includes(reference.label));
    }
    assert.equal($('[role="status"]').length, 1);
    for (const item of SOURCES) {
      assert($(`a[href="/${item.kind === 'name' ? 'people' : 'interests'}/${item.slug}/"]`).length, item.label);
    }
  }
});

test('release rows expose complete dates, grouped episode notes, and valid IMDb title links', () => {
  const episodeDescription = 'S01E01: A beginning\nS01E02: The <next> chapter';
  const $ = load(renderPage({ baseUrl, upcoming: [
    { id: 'tt3456789-2026-12-18', titleId: 'tt3456789', title: 'A series', date: '2026-12-18',
      sources: ['Marvel', 'Dan Harmon'], episodeIds: ['tt4567890', 'tt5678901'], description: episodeDescription },
    { id: 'tt6789012', title: 'A movie', date: '2027-01-02' },
    { id: 'tt7890123/path', title: 'An unlinked title', date: '2027-01-03' },
  ] }));
  const series = $('tbody tr').filter(':has(time[datetime="2026-12-18"])');
  assert.equal(series.find('a').attr('href'), 'https://www.imdb.com/title/tt3456789/');
  assert.equal(series.find('a').text(), 'A series');
  assert.equal(series.find('details p').text(), episodeDescription);
  for (const source of ['Marvel', 'Dan Harmon']) assert(series.find('.release-meta').text().includes(source));
  const movie = $('tbody tr').filter(':has(time[datetime="2027-01-02"])');
  assert.equal(movie.find('a').attr('href'), 'https://www.imdb.com/title/tt6789012/');
  assert.equal(movie.find('a').text(), 'A movie');
  const unlinked = $('tbody tr').filter(':has(time[datetime="2027-01-03"])');
  assert(unlinked.text().includes('An unlinked title'));
  assert.equal(unlinked.find('a').length, 0);
});

test('combined source attribution stays visible without becoming episode notes', () => {
  const episodeDescription = 'S01E01: A beginning\nS01E02: The <next> chapter';
  const $ = load(renderPage({ baseUrl, upcoming: [
    { id: 'tt1234567', title: 'A combined movie', date: '2026-12-18',
      sources: ['Edward Norton', 'Mark Ruffalo'], description: 'People: Edward Norton, Mark Ruffalo', episodeDescription: '' },
    { id: 'tt2345678-2026-12-19', titleId: 'tt2345678', title: 'A combined series', date: '2026-12-19',
      sources: ['DC', 'James Gunn'], episodeIds: ['tt3456789', 'tt4567890'],
      description: `${episodeDescription}\n\nPeople: James Gunn\nInterests: DC`, episodeDescription },
  ] }));
  const movie = $('tbody tr').filter(':has(time[datetime="2026-12-18"])');
  const series = $('tbody tr').filter(':has(time[datetime="2026-12-19"])');
  assert.equal(movie.length, 1);
  assert.equal(series.length, 1);
  for (const source of ['Edward Norton', 'Mark Ruffalo']) assert(movie.find('.release-meta').text().includes(source));
  assert.equal(movie.find('details').length, 0);
  for (const source of ['DC', 'James Gunn']) assert(series.find('.release-meta').text().includes(source));
  assert.equal(series.find('details p').text(), episodeDescription);
  assert.equal(series.find('details').length, 1);
});

test('escapes source data in text and attribute contexts and rejects active URLs', () => {
  const attack = '"><img src=x onerror=alert(1)>';
  const $ = load(renderPage({ baseUrl, feeds: [{ ...feed, label: attack, subscriptionUrl: 'javascript:alert(1)',
    webcalUrl: 'javascript:alert(2)', url: 'data:text/html,hi' }],
    upcoming: [{ id: attack, titleId: attack, title: attack, date: '2026-12-18', description: attack, sources: [attack] }] }));
  assert.equal($('.calendar-card h3').text(), attack);
  assert($('tbody tr').text().includes(attack));
  assert.equal($('img[src="x"], [onerror]').length, 0);
  assert.equal($('.subscribe, .source-link, input[type="url"]').length, 0);
  for (const element of $('[href], input[value]').toArray()) {
    const value = $(element).attr('href') ?? $(element).val();
    assert(['http:', 'https:'].includes(new URL(value, baseUrl).protocol));
  }
});

test('renders update times only when a successful update exists', () => {
  for (const status of ['pending', 'error']) {
    const $ = load(renderPage({ baseUrl, feeds: [{ ...feed, status, count: null, updatedAt: null }] }));
    assert.equal($('time[datetime]').length, 0);
    assert($('.site-status').text().trim());
  }
  const $ = load(renderPage({ baseUrl, feeds: [{ ...feed, status: 'stale' }], stale: true, updatedAt: feed.updatedAt }));
  const timestamps = $('time').map((_, element) => $(element).attr('datetime')).get();
  assert(timestamps.length);
  assert(timestamps.every((value) => value === new Date(feed.updatedAt).toISOString()));
});

test('omits incomplete and impossible release dates', () => {
  const $ = load(renderPage({ baseUrl, upcoming: [
    { title: 'Incomplete', date: '2026-12' }, { title: 'Impossible', date: '2026-02-30' },
  ] }));
  assert.equal($('#upcoming tbody tr').length, 0);
  assert.equal($('#upcoming time').length, 0);
  assert(!$('#upcoming').text().includes('Incomplete'));
  assert(!$('#upcoming').text().includes('Impossible'));
});
