const dateFormatter = new Intl.DateTimeFormat('en', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});
const updateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
});

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function safeUrl(value, baseUrl, protocols = ['http:', 'https:']) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, baseUrl);
    return protocols.includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function validDate(value) {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function updateTime(value) {
  const date = validDate(value);
  return date ? `<time datetime="${escape(date.toISOString())}">${escape(updateFormatter.format(date))} UTC</time>` : null;
}

function feedState(feed) {
  if (feed.status === 'pending') return 'Awaiting first update';
  if (feed.status === 'error') return 'Update unavailable';
  if (feed.status === 'stale') return 'Using saved dates';
  if (!Number.isSafeInteger(feed.count) || feed.count < 0) return 'Dates unavailable';
  return `${feed.count.toLocaleString('en')} ${feed.count === 1 ? 'release' : 'releases'}`;
}

function renderFeed(feed, index, baseUrl, featured = false) {
  const subscriptionUrl = safeUrl(feed.subscriptionUrl, baseUrl);
  const webcalUrl = safeUrl(feed.webcalUrl, baseUrl, ['webcal:']);
  const sourceUrl = safeUrl(feed.url, baseUrl);
  const inputId = `subscription-${index}`;
  const updated = updateTime(feed.updatedAt);
  const state = escape(feedState(feed));
  const action = webcalUrl || subscriptionUrl
    ? `<a class="subscription-action" href="${escape(webcalUrl || subscriptionUrl)}">${featured ? 'Subscribe to all<span class="sr-only"> calendars</span>' : `Subscribe<span class="sr-only"> to ${escape(feed.label)}</span>`}<span aria-hidden="true">↗</span></a>`
    : '<p class="unavailable">Subscription unavailable</p>';
  const address = subscriptionUrl ? `<details class="subscription-link">
    <summary>Calendar address</summary>
    <div class="address-row"><label for="${inputId}">Subscription URL<span class="sr-only"> for ${escape(feed.label)}</span></label><input id="${inputId}" type="url" value="${escape(subscriptionUrl)}" readonly spellcheck="false" autocomplete="off"></div>
  </details>` : '';
  const source = sourceUrl
    ? `<a class="source-link" href="${escape(sourceUrl)}" rel="noreferrer">View on IMDb<span class="sr-only">: ${escape(feed.label)}</span><span aria-hidden="true">↗</span></a>` : '';
  const omitted = Number.isSafeInteger(feed.omitted) && feed.omitted > 0
    ? `<span>${feed.omitted.toLocaleString('en')} without complete dates</span>` : '';
  const detail = updated || omitted
    ? `<p class="feed-detail">${updated ? `<span>Updated ${updated}</span>` : ''}${omitted}</p>` : '';

  if (featured) return `<article class="featured-card" aria-labelledby="featured-title">
    <p class="eyebrow">The complete picture</p>
    <h2 class="featured-title" id="featured-title">All releases</h2>
    <p class="featured-copy">Every source, together in one calendar. A single subscription for everything you follow.</p>
    <p class="feed-state">${state}</p>
    ${action}
    ${address}
    ${detail}
  </article>`;

  if (feed.kind === 'name') return `<details class="person-calendar">
    <summary><span class="person-name">${escape(feed.label)}</span><span class="person-state">${state}</span><span class="disclosure" aria-hidden="true">›</span></summary>
    <div class="person-body">${action}${source}${address}${detail}</div>
  </details>`;

  return `<article class="interest-card">
    <h3>${escape(feed.label)}</h3>
    <p class="feed-state">${state}</p>
    ${action}
    ${source}
    ${address}
    ${detail}
  </article>`;
}

function renderUpcoming(upcoming) {
  const rows = upcoming.flatMap((item) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date ?? '')) return [];
    const date = validDate(`${item.date}T00:00:00Z`);
    if (!date || date.toISOString().slice(0, 10) !== item.date) return [];
    const titleId = item.titleId ?? item.id;
    const titleUrl = /^tt\d+$/.test(titleId ?? '') ? `https://www.imdb.com/title/${titleId}/` : null;
    const sources = (item.sources ?? []).map((source) => escape(source)).join(' · ');
    const count = item.episodeIds?.length;
    const episodes = item.description ? `<details class="episode-notes"><summary>${count ? `${count} ${count === 1 ? 'episode' : 'episodes'}` : 'Episode details'}</summary><p>${escape(item.description)}</p></details>` : '';
    return [`<tr><td class="release-date"><time datetime="${escape(item.date)}">${escape(dateFormatter.format(date))}</time></td><td class="release-title">${titleUrl ? `<a href="${titleUrl}" rel="noreferrer">${escape(item.title)}</a>` : escape(item.title)}${sources ? `<p class="release-meta">${sources}</p>` : ''}${episodes}</td></tr>`];
  }).join('');
  return rows ? `<div class="release-table"><table><caption class="sr-only">Upcoming titles and release dates</caption><thead><tr><th scope="col">Release date</th><th scope="col">Title</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty"><p>No upcoming releases to show yet.</p><p>New dates will appear here after a source update.</p></div>';
}

/** Render a complete, usable page without requiring client-side JavaScript. */
export function renderPage({ baseUrl, feeds = [], upcoming = [], updatedAt = null, stale = false, refreshing = false, eventTimeMode = 'date' }) {
  const featuredIndex = feeds.findIndex((feed) => ['all', 'combined'].includes(feed.slug));
  const indexed = feeds.map((feed, index) => ({ feed, index })).filter(({ index }) => index !== featuredIndex);
  const interests = indexed.filter(({ feed }) => feed.kind !== 'name');
  const people = indexed.filter(({ feed }) => feed.kind === 'name')
    .sort((left, right) => left.feed.label.localeCompare(right.feed.label, 'en'));
  const updated = updateTime(updatedAt);
  const canonical = safeUrl(baseUrl, baseUrl);
  const eventDescription = eventTimeMode === 'date'
    ? 'Releases are all-day events that stay on the same calendar date in every time zone.'
    : 'Releases are marked at midnight UTC. Your calendar converts them to local time. This is a date marker, not the actual release time.';
  const status = stale ? 'Showing saved release dates. A source update is currently unavailable.'
    : !updated ? 'Waiting for the first source update. Subscription links are ready below.'
    : refreshing ? 'Checking sources for updated release dates.' : 'Checked daily. Refreshed by your calendar app.';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="Film premieres, new episodes, and the people behind them. Subscribe to IMDb release dates in your calendar.">
  <title>Release Calendar</title>
  ${canonical ? `<link rel="canonical" href="${escape(canonical)}">` : ''}
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header wrap">
    <a class="wordmark" href="#main">Release Calendar<span aria-hidden="true">.</span></a>
    <nav aria-label="Primary"><a href="#upcoming">Releases</a><a href="#calendars">Calendars</a><a href="#how-it-works">About</a></nav>
  </header>
  <main id="main" class="wrap" tabindex="-1">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">A date worth keeping</p>
        <h1 id="hero-title">Next on<br>your calendar.</h1>
        <p class="intro">Film premieres, new episodes, and the people behind them. Follow the things you love. Leave the dates to your calendar.</p>
        <p class="site-status">${escape(status)}</p>
        ${updated ? `<p class="last-check">Last successful update ${updated}</p>` : ''}
      </div>
      ${featuredIndex >= 0 ? renderFeed(feeds[featuredIndex], featuredIndex, baseUrl, true) : ''}
    </section>
    <section id="upcoming" class="section" aria-labelledby="upcoming-title">
      <div class="section-heading"><div><p class="eyebrow">The release list</p><h2 id="upcoming-title">On the horizon</h2></div><p>Dates as listed by IMDb.</p></div>
      ${renderUpcoming(upcoming)}
    </section>
    <section id="calendars" class="section" aria-labelledby="calendars-title">
      <div class="section-heading"><div><p class="eyebrow">Choose what to follow</p><h2 id="calendars-title">Your calendars</h2></div><p>Follow an interest${people.length ? ', or find a person below' : ''}.</p></div>
      <div class="interest-grid">${interests.map(({ feed, index }) => renderFeed(feed, index, baseUrl)).join('')}</div>
      <p class="calendar-help">Use <strong>Subscribe</strong> to open your calendar app. To add a calendar by URL, open <strong>Calendar address</strong> and copy the subscription link. Choose a subscription rather than importing a file to receive future updates.</p>
    </section>
    ${people.length ? `<section id="people" class="section" aria-labelledby="people-title">
      <div class="section-heading"><div><p class="eyebrow">The people behind it</p><h2 id="people-title">Familiar names.<br>New things to see.</h2></div><p>${people.length.toLocaleString('en')} people, from A to Z.</p></div>
      <div class="people-grid">${people.map(({ feed, index }) => renderFeed(feed, index, baseUrl)).join('')}</div>
    </section>` : ''}
    <section id="how-it-works" class="section" aria-labelledby="about-title">
      <div class="section-heading"><div><p class="eyebrow">Set it once</p><h2 id="about-title">A little less keeping track.</h2></div></div>
      <div class="about-grid">
        <article><h3>Subscribe, then carry on.</h3><p>Add a calendar in Apple Calendar, Google Calendar, Outlook, or another app that supports calendar subscriptions. ${eventDescription}</p></article>
        <article><h3>One day. One release.</h3><p>Episodes released together share an event under the series name, with episode numbers and titles in its description. Marvel, Star Wars, and DC include every confirmed episode date. People calendars include only their directly credited titles and episodes.</p></article>
        <article><h3>Dates can change.</h3><p>Sources are checked daily. Your calendar app decides when to fetch updates, so changes may take time to appear. Dates come from IMDb and can vary by country. Releases without a complete date appear once one is available.</p></article>
      </div>
    </section>
  </main>
  <footer class="site-footer wrap"><a class="wordmark" href="#main">Release Calendar<span aria-hidden="true">.</span></a><p>Dates from <a href="https://www.imdb.com/" rel="noreferrer">IMDb</a>. Made for your calendar.</p><a href="#main">Back to top ↑</a></footer>
</body>
</html>`.replace(/[\t ]+$/gm, '');
}
