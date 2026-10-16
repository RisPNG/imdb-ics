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
  return `${feed.count.toLocaleString('en')} dated ${feed.count === 1 ? 'title' : 'titles'}`;
}

function renderFeed(feed, index, baseUrl, featured) {
  const subscriptionUrl = safeUrl(feed.subscriptionUrl, baseUrl);
  const webcalUrl = safeUrl(feed.webcalUrl, baseUrl, ['webcal:']);
  const sourceUrl = safeUrl(feed.url, baseUrl);
  const inputId = `subscription-${index}`;
  const updated = updateTime(feed.updatedAt);
  const omitted = Number.isSafeInteger(feed.omitted) && feed.omitted > 0
    ? `<span>${feed.omitted.toLocaleString('en')} without complete dates</span>` : '';
  return `<article class="feed${featured ? ' featured' : ''}">
    <div class="feed-main">
      <div>${featured ? '<p class="eyebrow">One link. Every source.</p>' : ''}<h3>${escape(feed.label)}</h3>
        <p class="feed-meta"><span class="state${feed.status === 'ready' ? '' : ' waiting'}">${escape(feedState(feed))}</span>${sourceUrl ? `<a href="${escape(sourceUrl)}" rel="noreferrer">View on IMDb <span aria-hidden="true">↗</span></a>` : ''}</p>
      </div>
      ${webcalUrl || subscriptionUrl ? `<a class="subscribe${featured ? ' primary' : ''}" href="${escape(webcalUrl || subscriptionUrl)}">${featured ? 'Subscribe to all' : 'Subscribe'} <span aria-hidden="true">↗</span><span class="sr-only"> to ${escape(feed.label)}</span></a>` : '<p class="unavailable">Subscription unavailable</p>'}
    </div>
    ${subscriptionUrl ? `<div class="feed-url"><label for="${inputId}">Subscription URL<span class="sr-only"> for ${escape(feed.label)}</span></label><div class="copy-row"><input id="${inputId}" type="url" value="${escape(subscriptionUrl)}" readonly spellcheck="false" autocomplete="off"><button type="button" data-copy="${inputId}" aria-label="Copy subscription URL for ${escape(feed.label)}" hidden>Copy link</button></div><span class="copy-status" role="status" aria-live="polite"></span></div>` : ''}
    ${updated || omitted ? `<p class="feed-detail">${updated ? `<span>Updated ${updated}</span>` : ''}${omitted}</p>` : ''}
  </article>`;
}

function renderUpcoming(upcoming) {
  const rows = upcoming.flatMap((item) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date ?? '')) return [];
    const date = validDate(`${item.date}T00:00:00Z`);
    if (!date || date.toISOString().slice(0, 10) !== item.date) return [];
    return [`<tr><th scope="row">${escape(item.title)}</th><td><time datetime="${escape(item.date)}">${escape(dateFormatter.format(date))}</time></td></tr>`];
  }).join('');
  return rows ? `<div class="release-table"><table><caption class="sr-only">Upcoming titles and release dates</caption><thead><tr><th scope="col">Title</th><th scope="col">Release date</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty"><p>No upcoming releases to show yet.</p><p>Titles appear here when a complete release date is available.</p></div>';
}

/** Render a complete, usable page without requiring client-side JavaScript. */
export function renderPage({ baseUrl, feeds = [], upcoming = [], updatedAt = null, stale = false, refreshing = false, eventTimeMode = 'date' }) {
  const featuredIndex = feeds.findIndex((feed) => ['all', 'combined'].includes(feed.slug));
  const updated = updateTime(updatedAt);
  const canonical = safeUrl(baseUrl, baseUrl);
  const eventDescription = eventTimeMode === 'date'
    ? 'Titles become all-day events on their release dates, so they stay on the same calendar date in every time zone.'
    : 'Titles become events at midnight UTC on their release dates. Your calendar converts them to your local time. This is a date marker, not the actual release time.';
  const status = stale ? 'Showing saved release dates. A source update is currently unavailable.'
    : !updated ? 'Waiting for the first source update. Subscription links are ready below.'
    : refreshing ? 'Checking sources for updated release dates.' : 'Checked daily. Updates follow your calendar app’s refresh schedule.';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="Subscribe to release dates from your IMDb interests and filmmakers. One calendar, automatically updated.">
  <meta name="robots" content="noindex, nofollow">
  <title>Release Calendar</title>
  ${canonical ? `<link rel="canonical" href="${escape(canonical)}">` : ''}
  <link rel="stylesheet" href="/style.css">
  <script src="/enhance.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header wrap"><a class="wordmark" href="#main">Release Calendar</a><nav aria-label="Main"><a href="#calendars">Calendars</a><a href="#how-it-works">How it works</a></nav></header>
  <main id="main" class="wrap">
    <section class="hero" aria-labelledby="hero-title">
      <p class="eyebrow">A little less keeping track.</p>
      <h1 id="hero-title">New releases.<br>Already on your calendar.</h1>
      <p class="intro">The titles you follow, with a date to look forward to. Subscribe once and let upcoming releases find their place in your calendar.</p>
      <p class="site-status">${escape(status)}</p>
      ${updated ? `<p class="last-check">Last successful update ${updated}</p>` : ''}
    </section>
    <section id="calendars" class="section calendars" aria-labelledby="calendars-title">
      <div class="section-heading"><div><p class="eyebrow">Make room for what’s next</p><h2 id="calendars-title">Your calendars</h2></div><p>Follow everything, or just your favorites.</p></div>
      ${featuredIndex >= 0 ? renderFeed(feeds[featuredIndex], featuredIndex, baseUrl, true) : ''}
      <div class="feed-list">${feeds.map((feed, index) => index === featuredIndex ? '' : renderFeed(feed, index, baseUrl, false)).join('')}</div>
      <p class="calendar-help">Use <strong>Subscribe</strong> to open your calendar app, or copy a URL and add it as a calendar subscription. Importing a downloaded file only saves a snapshot.</p>
    </section>
    <section id="upcoming" class="section" aria-labelledby="upcoming-title">
      <div class="section-heading"><div><p class="eyebrow">On the horizon</p><h2 id="upcoming-title">Upcoming releases</h2></div><p>Dates as listed by IMDb.</p></div>
      ${renderUpcoming(upcoming)}
    </section>
    <section id="how-it-works" class="section about" aria-labelledby="about-title">
      <div><p class="eyebrow">Set it once</p><h2 id="about-title">A calendar that<br>keeps up.</h2></div>
      <div class="about-copy"><h3>Subscribe, then carry on.</h3><p>Add a subscription URL in Apple Calendar, Google Calendar, Outlook, or another app that supports internet calendars. ${eventDescription}</p><h3>Dates can change. Your calendar can too.</h3><p>Sources are checked daily. Your calendar app decides when to fetch the latest feed, so changes may take time to appear. Titles without a complete date stay out of the calendar until one is available.</p><h3>Just titles and dates.</h3><p>Release dates come from IMDb and may vary by country. TV titles use their title-level release date. No account is needed here. The page uses no analytics or tracking cookies.</p></div>
    </section>
  </main>
  <footer class="site-footer wrap"><a class="wordmark" href="#main">Release Calendar</a><p>Information from <a href="https://www.imdb.com/" rel="noreferrer">IMDb</a>. An independent project.</p><a href="#main">Back to top ↑</a></footer>
</body>
</html>`.replace(/[\t ]+$/gm, '');
}
