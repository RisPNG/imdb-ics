import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/page.mjs';

const baseUrl = 'https://calendar.example';
const feed = {
  slug: 'marvel', label: 'Marvel', url: 'https://www.imdb.com/interest/in0000248/',
  subscriptionUrl: `${baseUrl}/calendars/marvel.ics`, webcalUrl: 'webcal://calendar.example/calendars/marvel.ics',
  count: 2, status: 'ready', updatedAt: '2026-10-16T08:00:00Z', omitted: 1,
};

test('renders usable subscription links and complete dates without JavaScript', () => {
  const html = renderPage({ baseUrl, feeds: [{ ...feed, slug: 'all', label: 'All releases', url: null }, feed],
    upcoming: [{ title: 'A release', date: '2026-12-18', sources: ['Marvel'] }], updatedAt: feed.updatedAt });
  assert.match(html, /href="webcal:\/\/calendar\.example\/calendars\/marvel\.ics"/);
  assert.match(html, /value="https:\/\/calendar\.example\/calendars\/marvel\.ics" readonly/);
  assert.match(html, /<time datetime="2026-12-18">Dec 18, 2026<\/time>/);
  assert.match(html, /2 dated titles/);
  assert.match(html, /1 without complete dates/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.equal((html.match(/id="subscription-\d+"/g) || []).length, 2);
  assert.doesNotMatch(html, /onclick=|<style|<script(?! src=)/);
});

test('escapes source data in text and attribute contexts and rejects active URLs', () => {
  const attack = '"><img src=x onerror=alert(1)>';
  const html = renderPage({ baseUrl, feeds: [{ ...feed, label: attack, subscriptionUrl: 'javascript:alert(1)',
    webcalUrl: 'javascript:alert(2)', url: 'data:text/html,hi' }],
    upcoming: [{ title: attack, date: '2026-12-18' }] });
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|href="javascript:|href="data:|value="javascript:/);
  assert.match(html, /Subscription unavailable/);
});

test('shows pending and saved-data states without inventing an update date', () => {
  const pending = renderPage({ baseUrl, feeds: [{ ...feed, status: 'pending', count: null, updatedAt: null }] });
  assert.match(pending, /Awaiting first update/);
  assert.match(pending, /Waiting for the first source update/);
  assert.doesNotMatch(pending, /Last successful update|1970|0 dated titles/);
  const stale = renderPage({ baseUrl, feeds: [{ ...feed, status: 'stale' }], stale: true, updatedAt: feed.updatedAt });
  assert.match(stale, /Showing saved release dates/);
  assert.match(stale, /Using saved dates/);
  assert.match(stale, /Last successful update/);
});

test('omits incomplete and impossible release dates', () => {
  const html = renderPage({ baseUrl, upcoming: [
    { title: 'Incomplete', date: '2026-12' }, { title: 'Impossible', date: '2026-02-30' },
  ] });
  assert.match(html, /No upcoming releases to show yet/);
  assert.doesNotMatch(html, /<th scope="row">/);
});

test('preserves a private dashboard base URL and describes the chosen event time', () => {
  const html = renderPage({ baseUrl: `${baseUrl}/private-token/`, feeds: [feed] });
  assert.match(html, /rel="canonical" href="https:\/\/calendar\.example\/private-token\/"/);
  assert.doesNotMatch(html, /href="\/"/);
  assert.match(html, /all-day events/);
  assert.match(html, /same calendar date in every time zone/);
  assert.doesNotMatch(html, /midnight UTC/);
  const utc = renderPage({ baseUrl, eventTimeMode: 'utc' });
  assert.match(utc, /midnight UTC/);
  assert.match(utc, /not the actual release time/);
});
