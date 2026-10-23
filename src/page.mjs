import profiles from './profiles.json' with { type: 'json' };
import images from './profile-images.json' with { type: 'json' };

const siteName = "Ris' IMDb ICalendar";
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});
const updateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC', hourCycle: 'h23',
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
  return `${feed.count.toLocaleString('en-GB')} ${feed.count === 1 ? 'release' : 'releases'}`;
}

function renderSubscription(feed, index, baseUrl) {
  const subscriptionUrl = safeUrl(feed.subscriptionUrl, baseUrl);
  const webcalUrl = safeUrl(feed.webcalUrl, baseUrl, ['webcal:']);
  const sourceUrl = safeUrl(feed.url, baseUrl);
  const inputId = `subscription-${index}`;
  const updated = updateTime(feed.updatedAt);
  const rangeStart = validDate(feed.dateRange?.start);
  const rangeEnd = validDate(feed.dateRange?.end);
  const omitted = Number.isSafeInteger(feed.omitted) && feed.omitted > 0
    ? `<span>${feed.omitted.toLocaleString('en-GB')} TBA</span>` : '';
  return `<div class="subscription">
    <p class="feed-state"><span>${escape(feedState(feed))}</span>${omitted}</p>
    ${rangeStart && rangeEnd ? `<p class="feed-detail">Includes <time datetime="${escape(feed.dateRange.start)}">${escape(dateFormatter.format(rangeStart))}</time> through <time datetime="${escape(feed.dateRange.end)}">${escape(dateFormatter.format(rangeEnd))}</time>. Rolls forward each year.</p>` : ''}
    <div class="subscription-actions">${webcalUrl || subscriptionUrl
    ? `<a class="subscribe" href="${escape(webcalUrl || subscriptionUrl)}">Subscribe<span class="sr-only"> to ${escape(feed.label)}</span></a>`
    : '<p class="unavailable">Subscription unavailable</p>'}${sourceUrl ? `<a class="source-link" href="${escape(sourceUrl)}" rel="noreferrer">View on IMDb<span class="sr-only">: ${escape(feed.label)}</span></a>` : ''}</div>
    ${subscriptionUrl ? `<div class="address-row"><label for="${inputId}">Calendar address<span class="sr-only"> for ${escape(feed.label)}</span></label><div class="address-controls"><input id="${inputId}" type="url" value="${escape(subscriptionUrl)}" readonly spellcheck="false" autocomplete="off"><button type="button" class="copy-link" data-copy="${inputId}" hidden>Copy link<span class="sr-only"> for ${escape(feed.label)}</span></button></div></div>` : ''}
    ${updated ? `<p class="feed-detail">Updated ${updated}</p>` : ''}
  </div>`;
}

function renderSourceCard(feed, index, baseUrl) {
  const path = `/${feed.kind === 'name' ? 'people' : 'interests'}/${feed.slug}/`;
  const image = images[feed.slug];
  const profile = profiles[feed.slug];
  return `<article class="calendar-card ${feed.kind === 'name' ? 'person-card' : 'interest-card'}">
    <a class="profile-link" href="${escape(path)}">${image ? `<img src="${escape(image.path)}" alt="" width="${image.width}" height="${image.height}" loading="lazy" decoding="async">` : ''}<div><h3>${escape(feed.label)}</h3>${profile ? `<p>${profile.roles.map(escape).join(', ')}</p>` : ''}<span class="profile-prompt">View profile</span></div></a>
    ${renderSubscription(feed, index, baseUrl)}
  </article>`;
}

function renderUpcoming(upcoming) {
  const rows = upcoming.flatMap((item) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date ?? '')) return [];
    const date = validDate(`${item.date}T00:00:00Z`);
    if (!date || date.toISOString().slice(0, 10) !== item.date) return [];
    const titleId = item.titleId ?? item.id;
    const titleUrl = /^tt\d+$/.test(titleId ?? '') ? `https://www.imdb.com/title/${titleId}/` : null;
    const sources = (item.sources ?? []).map(escape).join(', ');
    const count = item.episodeIds?.length;
    const episodeDescription = item.episodeDescription ?? item.description;
    const episodes = episodeDescription ? `<details class="episode-notes"><summary>${count ? `${count} ${count === 1 ? 'episode' : 'episodes'}` : 'Episode details'}</summary><p>${escape(episodeDescription)}</p></details>` : '';
    return [`<tr><td class="release-date"><time datetime="${escape(item.date)}">${escape(dateFormatter.format(date))}</time></td><td class="release-title">${titleUrl ? `<a href="${titleUrl}" rel="noreferrer">${escape(item.title)}</a>` : escape(item.title)}${sources ? `<p class="release-meta">${sources}</p>` : ''}${episodes}</td></tr>`];
  }).join('');
  return rows ? `<div class="release-table"><table><caption class="sr-only">Upcoming titles and release dates</caption><thead><tr><th scope="col">Release date</th><th scope="col">Title</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty"><p>No upcoming releases to show yet.</p><p>New dates will appear here after a source update.</p></div>';
}

function renderNavigation(feeds, sourceSlug) {
  return `<nav aria-label="Primary"><a href="/"${sourceSlug === 'all' ? ' aria-current="page"' : ''}>Home</a><details class="browse-menu"><summary>Browse calendars</summary><div class="browse-panel">${['interest', 'name'].map((kind) => `<div><p class="browse-heading">${kind === 'name' ? 'People' : 'Interests'}</p><ul>${feeds.filter((feed) => feed.kind === kind).sort((left, right) => left.label.localeCompare(right.label, 'en')).map((feed) => `<li><a href="/${kind === 'name' ? 'people' : 'interests'}/${escape(feed.slug)}/"${sourceSlug === feed.slug ? ' aria-current="page"' : ''}>${escape(feed.label)}</a></li>`).join('')}</ul></div>`).join('')}</div></details><a href="/#how-it-works">About</a></nav>`;
}

/** Render ordinary pages with usable subscriptions before the copy enhancement loads. */
export function renderPage({ baseUrl, feeds = [], upcoming = [], updatedAt = null, stale = false, refreshing = false, eventTimeMode = 'date', sourceSlug = 'all' }) {
  const sourceIndex = feeds.findIndex((feed) => feed.slug === sourceSlug);
  const source = feeds[sourceIndex];
  const profile = sourceSlug !== 'all' ? profiles[sourceSlug] : null;
  const image = sourceSlug !== 'all' ? images[sourceSlug] : null;
  const sourcePath = sourceSlug === 'all' ? '/' : `/${source?.kind === 'name' ? 'people' : 'interests'}/${sourceSlug}/`;
  const canonical = safeUrl(sourcePath, baseUrl);
  const updated = updateTime(updatedAt);
  const interests = feeds.map((feed, index) => ({ feed, index })).filter(({ feed }) => feed.kind === 'interest');
  const people = feeds.map((feed, index) => ({ feed, index })).filter(({ feed }) => feed.kind === 'name')
    .sort((left, right) => left.feed.label.localeCompare(right.feed.label, 'en'));
  const status = stale ? 'Showing saved release dates while sources await an update.'
    : !updated ? 'Waiting for the first source update. Subscription links are ready below.'
    : refreshing ? 'Checking sources for updated release dates.' : 'Sources are checked daily.';
  const title = sourceSlug === 'all' ? siteName : `${source?.label} | ${siteName}`;
  const description = profile?.summary || 'Calendar subscriptions for IMDb film premieres, episode releases, people, and interests.';
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="${escape(description)}">
  <title>${escape(title)}</title>
  ${canonical ? `<link rel="canonical" href="${escape(canonical)}">` : ''}
  <link rel="stylesheet" href="/style.css">
  <script src="/enhance.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header"><div class="header-inner wrap"><a class="wordmark" href="/" aria-label="${escape(siteName)}"><span>Ris' IMDb</span> ICalendar</a>${renderNavigation(feeds, sourceSlug)}</div></header>
  <main id="main" class="wrap" tabindex="-1">
    <p id="copy-status" class="sr-only" role="status" aria-live="polite"></p>
    ${sourceSlug === 'all' ? `<section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><p class="eyebrow">Personal release calendars</p><h1 id="hero-title">IMDb release calendars</h1><p class="intro">Follow film premieres and episode releases from ${interests.length} interests and ${people.length} people. Subscribe once to receive updated dates in your calendar app.</p><p class="site-status">${escape(status)}</p>${updated ? `<p class="last-check">Last successful update ${updated}</p>` : ''}</div>${source ? `<aside class="featured-card" aria-labelledby="featured-title"><h2 id="featured-title">All releases</h2><p>All configured sources in one calendar. Shared releases appear once, with their matching interests and people in the event description.</p>${renderSubscription(source, sourceIndex, baseUrl)}<p class="feed-detail"><a href="#calendar-refresh">Google Calendar showing old information?</a></p></aside>` : ''}</section>` : `<section class="profile-hero" aria-labelledby="profile-title"><p class="breadcrumb"><a href="/">Home</a> / <a href="/#${source?.kind === 'name' ? 'people' : 'calendars'}">${source?.kind === 'name' ? 'People' : 'Interests'}</a> / ${escape(source?.label)}</p><div class="profile-heading"><div><h1 id="profile-title">${escape(source?.label)}</h1>${profile ? `<p class="profile-roles">${profile.roles.map(escape).join(', ')}</p>` : ''}</div><a class="text-link" href="#upcoming">Upcoming releases</a></div><div class="profile-layout">${image ? `<figure class="profile-image${source?.kind === 'interest' ? ' interest-image' : ''}"><img src="${escape(image.path)}" alt="${escape(image.alt)}" width="${image.width}" height="${image.height}" decoding="async">${image.imageUnavailable ? '<figcaption>No portrait is available.</figcaption>' : `<figcaption><a href="${escape(image.sourceUrl)}" rel="noreferrer">Image source${image.credit ? `: ${escape(image.credit)}` : ''}</a></figcaption>`}</figure>` : ''}<div class="profile-biography"><h2>${source?.kind === 'name' ? 'Biography' : 'About'}</h2>${profile ? `<p>${escape(profile.summary)}</p><h3>Known for</h3><ul class="known-for">${profile.knownFor.map((work) => `<li>${escape(work)}</li>`).join('')}</ul><p class="references">Sources: ${profile.references.map((reference) => { const url = safeUrl(reference.url, baseUrl); return url ? `<a href="${escape(url)}" rel="noreferrer">${escape(reference.label)}</a>` : escape(reference.label); }).join(', ')}</p>` : ''}</div><aside class="profile-subscription"><h2>${escape(source?.label)} calendar</h2><p>${source?.kind === 'name' ? 'Directly credited eligible titles and episodes. A series credit alone does not add its other episodes.' : 'Matched eligible titles and every confirmed eligible episode date from matched series.'}</p>${source ? renderSubscription(source, sourceIndex, baseUrl) : ''}<p class="site-status">${escape(status)}</p><p class="feed-detail"><a href="#calendar-refresh">Google Calendar showing old information?</a></p></aside></div></section>`}
    <section id="upcoming" class="section" aria-labelledby="upcoming-title"><div class="section-heading"><h2 id="upcoming-title">Upcoming releases${sourceSlug !== 'all' && source ? `<span> for ${escape(source.label)}</span>` : ''}</h2><p>Dates listed by IMDb.</p></div>${renderUpcoming(upcoming)}</section>
    ${sourceSlug === 'all' ? `<section id="calendars" class="section" aria-labelledby="calendars-title"><div class="section-heading"><h2 id="calendars-title">Interests</h2><p>Open a profile for background and its release list.</p></div><div class="interest-grid">${interests.map(({ feed, index }) => renderSourceCard(feed, index, baseUrl)).join('')}</div></section><section id="people" class="section" aria-labelledby="people-title"><div class="section-heading"><h2 id="people-title">People</h2><p>${people.length} people, listed alphabetically.</p></div><div class="people-grid">${people.map(({ feed, index }) => renderSourceCard(feed, index, baseUrl)).join('')}</div></section>` : ''}
    <section id="how-it-works" class="section" aria-labelledby="about-title"><div class="section-heading"><h2 id="about-title">About these calendars</h2></div><div class="about-grid"><article><h3>Subscribe by link</h3><p>Use Subscribe to open your calendar app, or copy the visible calendar address into its subscription settings. Choose a subscription rather than importing a file to receive future updates. ${eventTimeMode === 'date' ? 'Releases are all-day events that stay on the same calendar date in every time zone.' : 'Releases are marked at midnight UTC. Your calendar converts them to local time. This is a date marker, not the actual release time.'}</p></article><article><h3>Episode dates</h3><p>Each event description starts with its IMDb title link. Episodes released together share an event under the series name, with episode numbers and titles in its description. Marvel, Star Wars, and DC include every confirmed eligible episode date. People calendars include only their directly credited eligible titles and episodes. Every calendar excludes Game Show, Quiz Show, News, Talk Show, and Documentary titles, and titles whose main official site is on YouTube. Episodes from an excluded series are also excluded.</p></article><article><h3>Updates and TBA</h3><p>Sources are checked daily. Your calendar app decides when to fetch updates. IMDb dates can vary by country. TBA counts titles without a complete release date. These join the calendar when a full date is available.</p></article></div>
      <article id="calendar-refresh" class="calendar-help" aria-labelledby="calendar-refresh-title">
        <h3 id="calendar-refresh-title">Google Calendar showing old information?</h3>
        <p>If this website shows newer details than Google Calendar, a fresh subscription can help.</p>
        <ol>
          <li>Copy the calendar address and append <code>?v=1</code>. Choose a different value each time, such as <code>?v=2</code>. If the address already contains <code>?</code>, append <code>&amp;v=2</code> instead.</li>
          <li>Open Google Calendar in a computer browser. Beside <strong>Other calendars</strong>, select <strong>+</strong>, then <strong>From URL</strong>. Paste the modified address and select <strong>Add calendar</strong>.</li>
          <li>Wait for the new calendar to load, then check its dates and descriptions. Once they are correct, uncheck the old calendar to avoid duplicate events. Reapply your preferred color and reminders to the new copy.</li>
        </ol>
        <p>This creates a separate subscription to the same live feed. It does not refresh the existing subscription. Google still decides when future updates arrive. <a href="https://support.google.com/calendar/answer/37100?co=GENIE.Platform%3DDesktop&amp;hl=en" rel="noreferrer">Google Calendar subscription help</a>.</p>
      </article>
    </section>
  </main>
  <footer class="site-footer wrap"><p>${escape(siteName)}</p><p>Release dates from <a href="https://www.imdb.com/" rel="noreferrer">IMDb</a>.</p><a href="#main">Back to top</a></footer>
</body>
</html>`.replace(/[\t ]+$/gm, '');
}
