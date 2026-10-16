# Release Calendar

A small, self-hosted website that turns IMDb interests and filmographies into calendar subscriptions. There is one feed per source and one combined feed that removes duplicate IMDb title IDs.

The page uses semantic HTML, a stylesheet under 6 KiB, system fonts, and optional clipboard JavaScript under 2 KiB. The Node service has no runtime package dependencies. Development uses `html-validate` to check the generated HTML.

## Calendars

| Calendar | IMDb source | Feed filename |
| --- | --- | --- |
| All releases | All five sources, deduplicated | `all.ics` |
| Marvel | [in0000248](https://www.imdb.com/interest/in0000248/) | `marvel.ics` |
| Star Wars | [in0000243](https://www.imdb.com/interest/in0000243/) | `star-wars.ics` |
| DC | [in0000244](https://www.imdb.com/interest/in0000244/) | `dc.ics` |
| Vince Gilligan | [nm0319213](https://www.imdb.com/name/nm0319213/) | `vince-gilligan.ics` |
| Justin Roiland | [nm1551598](https://www.imdb.com/name/nm1551598/) | `justin-roiland.ics` |

The supplied Justin Roiland URL appeared twice; it is configured once. Edit `SOURCES` in `src/config.mjs` to add or change sources.

Each source includes all titles directly returned by its IMDb interest or credit search. This can include movies, television series, individual credited episodes, shorts, and other title types. A series is **not** automatically expanded into every episode, and a person's credits can include more than writing or directing. This preserves the requested broad source selection rather than applying an unrequested role or title-type filter.

## Run locally

Use the toolchain pinned in `mise.toml`:

```sh
mise trust
mise install
mise exec -- npm ci
mise exec -- npm run check
mise exec -- npm test
mise exec -- npm start
```

Open [localhost:3000](http://localhost:3000/). The first refresh starts in the background. A feed returns a retryable HTTP 503 until its first complete source snapshot is available; it never substitutes a fake empty calendar. After that, cached calendars are available immediately on restart.

For local configuration, copy `.env.example` to `.env` and run `mise exec -- npm run dev`. This reads the file and restarts the service when source files change. `npm start` uses the process environment supplied by the host. Environment files and cached data are ignored by Git.

## Deploy on Render

1. Create your GitHub repository with the contents of this directory at the repository root, including `package-lock.json` and `render.yaml`.
2. In Render, create a **Blueprint**, connect that repository, and apply `render.yaml`.
3. The Blueprint requests a **paid Starter web service and a 1 GB persistent disk**. Review Render's displayed price before provisioning. The disk preserves event revisions and cancellation history across deploys; the continuously running service performs its own daily refreshes.
4. In Render's Shell for the service, run `npm run url`. It prints the private dashboard URL, including the generated token in its URL-encoded form. Keep that URL and the `CALENDAR_TOKEN` environment value private and stable.
5. Open that URL and copy the subscription links from the dashboard. The root `/` deliberately returns 404 when private access is configured.

Render sets `RENDER_EXTERNAL_URL`; the service uses that value to produce absolute feed URLs. For a custom domain, set `PUBLIC_BASE_URL` to its HTTPS origin, such as `https://calendar.example.com`. Keep the token unchanged. Moving to a new hostname changes subscription URLs; existing subscriptions need the new address or a maintained redirect from the old host.

The Blueprint pins Node 24, validates the HTML and asset budgets, runs the tests, and removes development dependencies before starting the service. No additional cron job is needed. Run one service instance against one disk; this project is intentionally a single-process service.

Free or sleeping services do not guarantee a refresh every 24 hours, and ephemeral storage loses event history on redeploy. Removing the persistent disk is therefore a reliability trade-off, not an equivalent deployment.

### Manual Render service

If you create a Web Service without the Blueprint, use these settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Node version | `NODE_VERSION=24.21.0` |
| Build command | `npm ci --include=dev && npm run check && npm test && npm prune --omit=dev` |
| Start command | `npm start` |
| Health check | `/healthz` |
| Disk mount | `/var/data` |
| Data directory | `DATA_DIR=/var/data/release-calendar` |
| Private token | `CALENDAR_TOKEN`, a permanent random URL-safe or base64 string of at least 24 characters |

A nonlocal deployment refuses to start without a token. The dashboard and feeds use a secret path; possession of a full URL grants access. The service URL-encodes the token so Render-generated base64 values remain one path component. `npm run url` prints the correct private URL; do not add it to a startup script or publish its output. This is link-based privacy rather than individual user accounts. Avoid sharing screenshots containing your production URLs, and preserve the token in your deployment's environment. Rotating it invalidates existing subscriptions. Never put it in a commit.

## Add a subscription

Use a feed URL as a **subscription**, rather than downloading and importing a file:

- **Google Calendar:** on the desktop website, open Other calendars → Add other calendars → From URL, then paste the HTTPS URL.
- **Apple Calendar:** choose New Calendar Subscription and paste the URL. The dashboard's `webcal:` link can open a registered calendar app directly.
- **Outlook:** open Add calendar → Subscribe from web, then paste the HTTPS URL.

The service checks sources every 24 hours by default. Your calendar provider chooses its own polling interval; its displayed events can lag behind the service's updates. Refresh hints in the feed are advisory.

Keep the hostname and token stable for a permanent address. For example, the combined feed is:

```text
https://YOUR-SERVICE.onrender.com/URL_ENCODED_TOKEN/calendars/all.ics
```

## Dates and timezones

By default, each release is an **all-day event** on IMDb's returned release date. The event contains the title and a link to its IMDb page. It uses an iCalendar date rather than a timestamp, so timezone conversion cannot move the release onto another day.

For example, a release dated 19 November appears as an all-day event on 19 November in Kuala Lumpur, Los Angeles, and elsewhere. The feed uses `DTSTART;VALUE=DATE:20261119` and an exclusive end of `DTEND;VALUE=DATE:20261120`. It does not invent a release time.

Dates come from IMDb's default `releaseDate` field. This is not a request for Malaysian release dates, and an all-day event does not establish which country's release date the source represents. Titles with only a year or month stay out of the feed until a complete valid date exists. A TV series uses its series release date; a directly matched episode uses that episode's date.

`EVENT_TIME_MODE=date` is the default in the service, local environment example, and Render Blueprint. The optional `EVENT_TIME_MODE=utc` setting creates midnight UTC markers that calendar apps convert to local time; those can appear on the previous date in western timezones. Switching modes preserves UIDs and advances event revision numbers, so existing events can update without changing subscription URLs. Update timestamps and HTTP headers continue to use UTC.

## Refresh and persistence

The service fetches one source at a time and follows every pagination cursor. The number of HTTP calls depends on each source's size. Requests have response-size and time bounds; there is no attempt to bypass an access challenge or blocked response.

Only a successful, complete source refresh replaces that source's saved titles. If a page fails, the last good snapshot remains available and the dashboard labels it as saved data. Failed sources retry after 30 minutes by default. The combined feed is available only after all five sources have at least one complete snapshot, and retains saved data from any temporarily unavailable source.

Events use stable IMDb-based UIDs, persistent creation/modification times and revision numbers. Date changes update the same event. Removed titles or dates withdrawn by the source produce cancellation records, which are retained so slow subscribers can remove old events. Unchanged refreshes produce the same feed bytes and ETag. JSON snapshots are written to a temporary file and renamed atomically.

Back up `DATA_DIR/snapshot.json` along with the deployment environment. The snapshot contains source data and event history, never the calendar token. Avoid deleting it to force a refresh: doing so resets revision history.

`mise exec -- npm run refresh` performs one refresh and exits. Use this **with the web service stopped**, for an initial fetch or maintenance; running it alongside the server would create two competing writers. A nonzero exit means at least one source failed or the cache could not be saved. Normal operation uses the in-process scheduler.

`GET /healthz` checks whether the HTTP process is alive. `GET /readyz` returns 503 until every source has a usable snapshot. Readiness does not assert that upstream data is fresh; the private dashboard shows update times and saved-data states. Both endpoints omit feed data and private URLs.

## IMDb access limitation

This implementation uses **IMDb's website GraphQL endpoint**, not IMDb's licensed AWS Data Exchange API. Live tests retrieved the requested interests, credited titles, and release dates. However, the responses also included an entitlement value of `DENY` and a notice restricting public, commercial, or non-private use. The service records these notices in its refresh logs and saved source warnings. Returned data is not evidence of a licensed entitlement.

There is no verified supported quota or availability guarantee for this endpoint. It can change or stop working. A private URL does not establish permission to use the upstream data. Review [IMDb's data-use guidance](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX) before deployment; obtain appropriate supported access for any use that requires it. The licensed API's [schema is available to subscribers](https://data.imdb.com/documentation/api-documentation/key-concepts/); support for these exact filters in that separate product has not been verified.

The upstream boundary is confined to `src/imdb.mjs`, so a supported provider can replace it without changing the calendar, cache, or UI modules.

## Architecture and checks

| File | Responsibility |
| --- | --- |
| `src/config.mjs` | Source selection, URLs, environment validation |
| `src/imdb.mjs` | Bounded, paginated upstream reads and complete-date validation |
| `src/calendar.mjs` | Stable event history and RFC 5545 serialization |
| `src/store.mjs` | Daily scheduling, retries, deduplication, atomic persistence |
| `src/page.mjs` | One small shared HTML layout with escaped source data |
| `src/server.mjs` | Private HTTP routes, cached feeds, ETags, response headers |
| `public/` | Compact CSS and optional clipboard enhancement |
| `scripts/check.mjs` | HTML validation, JavaScript syntax, source uniqueness, byte budgets |
| `test/` | Calendar, pagination, cache recovery, private routes and HTTP behavior |

The research informs the design rather than supplying copied code: [Susam's site](https://github.com/susam/susam.net) for separating source data, layout and validation; [Seirdy's site](https://github.com/Seirdy/seirdy.one) for explicit accessibility constraints; and [Kessler's portfolio](https://github.com/nickessler2004/Engineering-Portfolio-Website) for straightforward layout primitives. There is no generic theme, CSS framework, custom publishing language, or speculative layout containment. Asset budgets measure transfer size; they are not a claim of independently benchmarked browser performance.

The UI remains usable without JavaScript, includes keyboard focus and skip navigation, follows light/dark system preferences, and has print and narrow-screen styles. Response headers use a scoped Content Security Policy without a blanket `sandbox` directive.

### Reference documentation

- [Render Blueprints](https://render.com/docs/blueprint-spec) and [persistent disks](https://render.com/docs/disks)
- [iCalendar event semantics](https://www.rfc-editor.org/rfc/rfc5545#section-3.6.1) and [refresh interval](https://www.rfc-editor.org/rfc/rfc7986#section-5.7)
- [Google Calendar subscription instructions](https://support.google.com/calendar/answer/37100?hl=en)
- [Outlook import versus subscription](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web)
