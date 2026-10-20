# Ris' IMDb ICalendar

A small, self-hosted website that turns IMDb interests and filmographies into public calendar subscriptions. There is one feed per source and one combined feed that removes duplicate releases.

The website uses semantic HTML, a shared stylesheet, system fonts, and a small optional script for copying calendar links. Addresses remain visible and subscriptions work without JavaScript. The Node service uses `stream-json` to read and write large saved snapshots incrementally. Development uses `html-validate` to check the generated HTML.

## Calendars

| Calendar | IMDb source | Feed filename |
| --- | --- | --- |
| All releases | All configured sources, deduplicated | `all.ics` |
| Marvel | [in0000248](https://www.imdb.com/interest/in0000248/) | `marvel.ics` |
| Star Wars | [in0000243](https://www.imdb.com/interest/in0000243/) | `star-wars.ics` |
| DC | [in0000244](https://www.imdb.com/interest/in0000244/) | `dc.ics` |
| Vince Gilligan | [nm0319213](https://www.imdb.com/name/nm0319213/) | `vince-gilligan.ics` |
| Justin Roiland | [nm1551598](https://www.imdb.com/name/nm1551598/) | `justin-roiland.ics` |
| Chiwetel Ejiofor | [nm0252230](https://www.imdb.com/name/nm0252230/) | `chiwetel-ejiofor.ics` |
| Kane Parsons | [nm10735410](https://www.imdb.com/name/nm10735410/) | `kane-parsons.ics` |
| Donald Glover | [nm2255973](https://www.imdb.com/name/nm2255973/) | `donald-glover.ics` |
| Michael Peña | [nm0671567](https://www.imdb.com/name/nm0671567/) | `michael-pena.ics` |
| Jake Gyllenhaal | [nm0350453](https://www.imdb.com/name/nm0350453/) | `jake-gyllenhaal.ics` |
| Kyle Chandler | [nm0151419](https://www.imdb.com/name/nm0151419/) | `kyle-chandler.ics` |
| Leonardo DiCaprio | [nm0000138](https://www.imdb.com/name/nm0000138/) | `leonardo-dicaprio.ics` |
| Matt Damon | [nm0000354](https://www.imdb.com/name/nm0000354/) | `matt-damon.ics` |
| Michael Mando | [nm3103126](https://www.imdb.com/name/nm3103126/) | `michael-mando.ics` |
| Brad Pitt | [nm0000093](https://www.imdb.com/name/nm0000093/) | `brad-pitt.ics` |
| George Lucas | [nm0000184](https://www.imdb.com/name/nm0000184/) | `george-lucas.ics` |
| George Clooney | [nm0000123](https://www.imdb.com/name/nm0000123/) | `george-clooney.ics` |
| Diego Luna | [nm0526019](https://www.imdb.com/name/nm0526019/) | `diego-luna.ics` |
| Grant Gustin | [nm2652716](https://www.imdb.com/name/nm2652716/) | `grant-gustin.ics` |
| Ryan Gosling | [nm0331516](https://www.imdb.com/name/nm0331516/) | `ryan-gosling.ics` |
| Benedict Cumberbatch | [nm1212722](https://www.imdb.com/name/nm1212722/) | `benedict-cumberbatch.ics` |
| Robert Pattinson | [nm1500155](https://www.imdb.com/name/nm1500155/) | `robert-pattinson.ics` |
| Steven Ogg | [nm1476804](https://www.imdb.com/name/nm1476804/) | `steven-ogg.ics` |
| Ned Luke | [nm0902623](https://www.imdb.com/name/nm0902623/) | `ned-luke.ics` |
| Michael Cera | [nm0148418](https://www.imdb.com/name/nm0148418/) | `michael-cera.ics` |
| Tom Hiddleston | [nm1089991](https://www.imdb.com/name/nm1089991/) | `tom-hiddleston.ics` |
| Nicolas Cage | [nm0000115](https://www.imdb.com/name/nm0000115/) | `nicolas-cage.ics` |
| Oscar Isaac | [nm1209966](https://www.imdb.com/name/nm1209966/) | `oscar-isaac.ics` |
| Steven Yeun | [nm3081796](https://www.imdb.com/name/nm3081796/) | `steven-yeun.ics` |
| Andrew Santino | [nm2747668](https://www.imdb.com/name/nm2747668/) | `andrew-santino.ics` |
| Bobby Lee | [nm0496899](https://www.imdb.com/name/nm0496899/) | `bobby-lee.ics` |
| John Cena | [nm1078479](https://www.imdb.com/name/nm1078479/) | `john-cena.ics` |
| Christopher Nolan | [nm0634240](https://www.imdb.com/name/nm0634240/) | `christopher-nolan.ics` |
| Joel McHale | [nm0570364](https://www.imdb.com/name/nm0570364/) | `joel-mchale.ics` |
| Bob Odenkirk | [nm0644022](https://www.imdb.com/name/nm0644022/) | `bob-odenkirk.ics` |
| Aaron Paul | [nm0666739](https://www.imdb.com/name/nm0666739/) | `aaron-paul.ics` |
| Bryan Cranston | [nm0186505](https://www.imdb.com/name/nm0186505/) | `bryan-cranston.ics` |
| Gabriel Macht | [nm0532683](https://www.imdb.com/name/nm0532683/) | `gabriel-macht.ics` |
| Josh Hutcherson | [nm1242688](https://www.imdb.com/name/nm1242688/) | `josh-hutcherson.ics` |
| Rick Hoffman | [nm0389069](https://www.imdb.com/name/nm0389069/) | `rick-hoffman.ics` |
| Patrick J. Adams | [nm1140666](https://www.imdb.com/name/nm1140666/) | `patrick-j-adams.ics` |
| Anya Taylor-Joy | [nm5896355](https://www.imdb.com/name/nm5896355/) | `anya-taylor-joy.ics` |
| Sadie Sink | [nm5584750](https://www.imdb.com/name/nm5584750/) | `sadie-sink.ics` |
| Giancarlo Esposito | [nm0002064](https://www.imdb.com/name/nm0002064/) | `giancarlo-esposito.ics` |
| Jonathan Banks | [nm0052186](https://www.imdb.com/name/nm0052186/) | `jonathan-banks.ics` |
| Jesse Plemons | [nm0687146](https://www.imdb.com/name/nm0687146/) | `jesse-plemons.ics` |
| Ethan Hawke | [nm0000160](https://www.imdb.com/name/nm0000160/) | `ethan-hawke.ics` |
| Mark Hamill | [nm0000434](https://www.imdb.com/name/nm0000434/) | `mark-hamill.ics` |
| Samuel L. Jackson | [nm0000168](https://www.imdb.com/name/nm0000168/) | `samuel-l-jackson.ics` |
| Taron Egerton | [nm5473782](https://www.imdb.com/name/nm5473782/) | `taron-egerton.ics` |
| Matthew Judge | [nm15158872](https://www.imdb.com/name/nm15158872/) | `matthew-judge.ics` |
| Kevan Brighting | [nm2623915](https://www.imdb.com/name/nm2623915/) | `kevan-brighting.ics` |
| James McAvoy | [nm0564215](https://www.imdb.com/name/nm0564215/) | `james-mcavoy.ics` |
| Dan Harmon | [nm1363595](https://www.imdb.com/name/nm1363595/) | `dan-harmon.ics` |
| Keanu Reeves | [nm0000206](https://www.imdb.com/name/nm0000206/) | `keanu-reeves.ics` |
| Alan Morrison | [nm3290082](https://www.imdb.com/name/nm3290082/) | `alan-morrison.ics` |
| Adam King | [nm5842157](https://www.imdb.com/name/nm5842157/) | `adam-king.ics` |
| Ben Van Lier | [nm2866114](https://www.imdb.com/name/nm2866114/) | `ben-van-lier.ics` |
| Britt Scott Clark | [nm7794173](https://www.imdb.com/name/nm7794173/) | `britt-scott-clark.ics` |
| Byron Coll | [nm3750475](https://www.imdb.com/name/nm3750475/) | `byron-coll.ics` |
| Hamish Parkinson | [nm3312641](https://www.imdb.com/name/nm3312641/) | `hamish-parkinson.ics` |
| Rowan Bettjeman | [nm3394670](https://www.imdb.com/name/nm3394670/) | `rowan-bettjeman.ics` |
| Rowan Atkinson | [nm0000100](https://www.imdb.com/name/nm0000100/) | `rowan-atkinson.ics` |
| Cooper Tomlinson | [nm7831367](https://www.imdb.com/name/nm7831367/) | `cooper-tomlinson.ics` |
| Curry Barker | [nm10533874](https://www.imdb.com/name/nm10533874/) | `curry-barker.ics` |
| Jeremy Allen White | [nm2087739](https://www.imdb.com/name/nm2087739/) | `jeremy-allen-white.ics` |
| Sam Houser | [nm0396759](https://www.imdb.com/name/nm0396759/) | `sam-houser.ics` |
| Mark Fischbach | [nm6179964](https://www.imdb.com/name/nm6179964/) | `mark-fischbach.ics` |
| Seán McLoughlin | [nm7681921](https://www.imdb.com/name/nm7681921/) | `sean-mcloughlin.ics` |
| Isack Hadjar | [nm15884712](https://www.imdb.com/name/nm15884712/) | `isack-hadjar.ics` |
| Felix Kjellberg | [nm5579304](https://www.imdb.com/name/nm5579304/) | `felix-kjellberg.ics` |
| Max Verstappen | [nm6722413](https://www.imdb.com/name/nm6722413/) | `max-verstappen.ics` |
| Tom Cruise | [nm0000129](https://www.imdb.com/name/nm0000129/) | `tom-cruise.ics` |
| Nathan Fillion | [nm0277213](https://www.imdb.com/name/nm0277213/) | `nathan-fillion.ics` |
| Hamish Linklater | [nm0512934](https://www.imdb.com/name/nm0512934/) | `hamish-linklater.ics` |
| Woody Harrelson | [nm0000437](https://www.imdb.com/name/nm0000437/) | `woody-harrelson.ics` |
| Liam Neeson | [nm0000553](https://www.imdb.com/name/nm0000553/) | `liam-neeson.ics` |
| Sebastian Stan | [nm1659221](https://www.imdb.com/name/nm1659221/) | `sebastian-stan.ics` |
| Shia LaBeouf | [nm0479471](https://www.imdb.com/name/nm0479471/) | `shia-labeouf.ics` |
| Robert Downey Jr. | [nm0000375](https://www.imdb.com/name/nm0000375/) | `robert-downey-jr.ics` |
| James Spader | [nm0000652](https://www.imdb.com/name/nm0000652/) | `james-spader.ics` |
| Dan Stevens | [nm1405398](https://www.imdb.com/name/nm1405398/) | `dan-stevens.ics` |
| Jesse Eisenberg | [nm0251986](https://www.imdb.com/name/nm0251986/) | `jesse-eisenberg.ics` |
| Nicholas Hoult | [nm0396558](https://www.imdb.com/name/nm0396558/) | `nicholas-hoult.ics` |
| Chris Evans | [nm0262635](https://www.imdb.com/name/nm0262635/) | `chris-evans.ics` |
| Edward Norton | [nm0001570](https://www.imdb.com/name/nm0001570/) | `edward-norton.ics` |
| Mads Mikkelsen | [nm0586568](https://www.imdb.com/name/nm0586568/) | `mads-mikkelsen.ics` |
| Mark Ruffalo | [nm0749263](https://www.imdb.com/name/nm0749263/) | `mark-ruffalo.ics` |
| Chris Hemsworth | [nm1165110](https://www.imdb.com/name/nm1165110/) | `chris-hemsworth.ics` |
| Paul Bettany | [nm0079273](https://www.imdb.com/name/nm0079273/) | `paul-bettany.ics` |
| Ewan McGregor | [nm0000191](https://www.imdb.com/name/nm0000191/) | `ewan-mcgregor.ics` |
| Mary Elizabeth Winstead | [nm0935541](https://www.imdb.com/name/nm0935541/) | `mary-elizabeth-winstead.ics` |
| Brendan Gleeson | [nm0322407](https://www.imdb.com/name/nm0322407/) | `brendan-gleeson.ics` |
| Dave Franco | [nm2002649](https://www.imdb.com/name/nm2002649/) | `dave-franco.ics` |
| Aubrey Plaza | [nm2201555](https://www.imdb.com/name/nm2201555/) | `aubrey-plaza.ics` |
| Diane Morgan | [nm1854269](https://www.imdb.com/name/nm1854269/) | `diane-morgan.ics` |
| James Gunn | [nm0348181](https://www.imdb.com/name/nm0348181/) | `james-gunn.ics` |
| James Franco | [nm0290556](https://www.imdb.com/name/nm0290556/) | `james-franco.ics` |
| Christopher Lloyd | [nm0000502](https://www.imdb.com/name/nm0000502/) | `christopher-lloyd.ics` |
| Joaquin Phoenix | [nm0001618](https://www.imdb.com/name/nm0001618/) | `joaquin-phoenix.ics` |
| Michael J. Fox | [nm0000150](https://www.imdb.com/name/nm0000150/) | `michael-j-fox.ics` |
| Frank Grillo | [nm0342029](https://www.imdb.com/name/nm0342029/) | `frank-grillo.ics` |
| Jon Favreau | [nm0269463](https://www.imdb.com/name/nm0269463/) | `jon-favreau.ics` |
| Hayden Christensen | [nm0159789](https://www.imdb.com/name/nm0159789/) | `hayden-christensen.ics` |
| Michael Rooker | [nm0740264](https://www.imdb.com/name/nm0740264/) | `michael-rooker.ics` |
| James D'Arcy | [nm0195439](https://www.imdb.com/name/nm0195439/) | `james-d-arcy.ics` |
| Daniel Brühl | [nm0117709](https://www.imdb.com/name/nm0117709/) | `daniel-bruhl.ics` |
| David Denman | [nm0219292](https://www.imdb.com/name/nm0219292/) | `david-denman.ics` |
| Chukwudi Iwuji | [nm1030244](https://www.imdb.com/name/nm1030244/) | `chukwudi-iwuji.ics` |
| Steve Agee | [nm0012948](https://www.imdb.com/name/nm0012948/) | `steve-agee.ics` |
| Gary Oldman | [nm0000198](https://www.imdb.com/name/nm0000198/) | `gary-oldman.ics` |
| Dai Fuad | [nm16080958](https://www.imdb.com/name/nm16080958/) | `dai-fuad.ics` |
| Mierul Aiman | [nm13961256](https://www.imdb.com/name/nm13961256/) | `mierul-aiman.ics` |
| Amir Ahnaf | [nm14465059](https://www.imdb.com/name/nm14465059/) | `amir-ahnaf.ics` |
| Zul Ariffin | [nm5795985](https://www.imdb.com/name/nm5795985/) | `zul-ariffin.ics` |
| Aaron Aziz | [nm2096347](https://www.imdb.com/name/nm2096347/) | `aaron-aziz.ics` |
| Syafiq Kyle | [nm10224401](https://www.imdb.com/name/nm10224401/) | `syafiq-kyle.ics` |
| Sharnaaz Ahmad | [nm4459961](https://www.imdb.com/name/nm4459961/) | `sharnaaz-ahmad.ics` |
| Nasir Bilal Khan | [nm0082091](https://www.imdb.com/name/nm0082091/) | `nasir-bilal-khan.ics` |
| Douglas Lim | [nm0510525](https://www.imdb.com/name/nm0510525/) | `douglas-lim.ics` |
| Zizan Razak | [nm3736757](https://www.imdb.com/name/nm3736757/) | `zizan-razak.ics` |
| Lisa Surihani | [nm3603153](https://www.imdb.com/name/nm3603153/) | `lisa-surihani.ics` |
| Sofyank | [nm14943881](https://www.imdb.com/name/nm14943881/) | `sofyank.ics` |
| Shaheizy Sam | [nm3603159](https://www.imdb.com/name/nm3603159/) | `shaheizy-sam.ics` |
| Afdlin Shauki | [nm0789495](https://www.imdb.com/name/nm0789495/) | `afdlin-shauki.ics` |
| Beto Kusyairy | [nm3729894](https://www.imdb.com/name/nm3729894/) | `beto-kusyairy.ics` |
| Diana Danielle | [nm2468471](https://www.imdb.com/name/nm2468471/) | `diana-danielle.ics` |
| Harith Iskander | [nm0411226](https://www.imdb.com/name/nm0411226/) | `harith-iskander.ics` |
| Rahim Razali | [nm0713604](https://www.imdb.com/name/nm0713604/) | `rahim-razali.ics` |
| Eizlan Yusof | [nm0951132](https://www.imdb.com/name/nm0951132/) | `eizlan-yusof.ics` |
| Zamarul Hisham | [nm1935071](https://www.imdb.com/name/nm1935071/) | `zamarul-hisham.ics` |

The configured set contains three interests and 128 people, giving 131 source calendars and one combined calendar, or 132 feeds in total. Edit `SOURCES` in `src/config.mjs` to add or change sources. This is a fixed source list and does not automatically synchronise with an IMDb favourites page.

Each source includes all titles directly returned by its IMDb interest or credit search. This can include movies, television series, individual credited episodes, shorts, and other title types. The Marvel, Star Wars, and DC interest calendars expand matched series into complete episode lists. People calendars exclude titles classified under IMDb's [News](https://www.imdb.com/interest/in0000211/) and [Talk Show](https://www.imdb.com/interest/in0000127/) interests, including credited episodes. They keep other directly credited titles, including series premiere events, and include only episodes directly credited to that person. A series credit alone does not add its other episodes. Credits remain broad across roles and title types. The combined calendar uses these same filtered people memberships, while a title independently matched by an interest remains eligible through that interest.

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

Open [localhost:3000](http://localhost:3000/). The first refresh starts in the background. Each source feed returns a retryable HTTP 503 until its first complete snapshot is available. On a new installation, the combined feed waits until every configured source has a complete snapshot. Cached calendars are available immediately on restart, and an existing combined feed stays available while added sources receive their first snapshots.

For local configuration, copy `.env.example` to `.env` and run `mise exec -- npm run dev`. This reads the file and restarts the service when source files change. `npm start` uses the process environment supplied by the host. Environment files and cached data are ignored by Git.

## Deploy on Render

1. Create your GitHub repository with the contents of this directory at the repository root, including `package-lock.json` and `render.yaml`.
2. In Render, create a **Blueprint**, connect that repository, and apply `render.yaml`. The Blueprint creates a service named **imdb-ics** in **Singapore**.
3. The Blueprint requests a **paid 0.5 CPU / 512 MB web service (`0.5c-512mb`) and a 1 GB persistent disk**. At the displayed rates of $7/month for compute and $0.25/GB/month for the disk, the base cost is about **$7.25/month**, before taxes or any applicable usage charges. Review [Render's current pricing](https://render.com/pricing) before provisioning. The disk preserves event revisions and cancellation history across deploys. The continuously running service performs its own daily refreshes.
4. Open the service's root URL, such as `https://imdb-ics.onrender.com/`, and copy the subscription links from the dashboard. Use the actual URL assigned by Render. The homepage and all calendar feeds are public.

The dashboard uses the hostname the visitor accesses for its subscription URLs, Subscribe buttons, and canonical URL. Opening `https://imdbics.rispeng.com` therefore produces links such as `https://imdbics.rispeng.com/calendars/all.ics`, while the Render hostname produces links on that hostname. The server reads the request's `Host` and the proxy's `X-Forwarded-Proto` header, with the configured URL supplying the default protocol. `PUBLIC_BASE_URL`, Render's `RENDER_EXTERNAL_URL`, and the local URL supply that configured URL in order of precedence. Adding a custom domain in Render does not require setting `PUBLIC_BASE_URL`. Moving to a new hostname changes subscription URLs, so existing subscriptions need the new address or a maintained redirect from the old host.

Render [does not support changing an existing service's region](https://render.com/docs/regions#changing-a-services-region). If `release-calendar` already exists in Oregon, the new `imdb-ics` service in Singapore needs its own disk. Copy `DATA_DIR/snapshot.json.gz` to the new service's disk to preserve event history, and verify the new deployment before removing the old service. A legacy `DATA_DIR/snapshot.json` can also be copied and is accepted when no gzip snapshot exists. Updating this Blueprint does not move the existing service or its saved data.

The Blueprint pins Node 24, validates the HTML and asset budgets, runs the tests, and removes development dependencies before starting the service. No additional cron job is needed. Run one service instance against one disk; this project is intentionally a single-process service.

Resource use depends on the configured sources and their episode counts. Measure refresh memory use and the saved snapshot size with the full source set before choosing production capacity. No database, GitHub Actions workflow, separate scheduler, or GitHub write credential is needed. If an IMDb refresh fails, subscribers continue receiving the last successfully saved dates while the service retries.

Render's attached disks disable zero-downtime deploys, so a deployment can briefly interrupt requests. Calendar data survives the restart on the disk. See [Render's disk limitations](https://render.com/docs/disks#disk-limitations-and-considerations).

Free or sleeping services do not guarantee a refresh every 24 hours, and ephemeral storage loses event history on redeploy. Removing the persistent disk is therefore a reliability trade-off, not an equivalent deployment.

### Manual Render service

If you create a Web Service without the Blueprint, use these settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Service name | `imdb-ics` |
| Region | Singapore |
| Compute plan | `0.5c-512mb` (0.5 CPU, 512 MB RAM) |
| Node version | `NODE_VERSION=24.21.0` |
| Build command | `npm ci --include=dev && npm run check && npm test && npm prune --omit=dev` |
| Start command | `npm start` |
| Health check | `/healthz` |
| Disk mount | `/var/data` |
| Data directory | `DATA_DIR=/var/data/release-calendar` |

## Add a subscription

Use a feed URL as a **subscription**, rather than downloading and importing a file:

- **Google Calendar:** on the desktop website, open Other calendars → Add other calendars → From URL, then paste the HTTPS URL.
- **Apple Calendar:** choose New Calendar Subscription and paste the URL. The dashboard's `webcal:` link can open a registered calendar app directly.
- **Outlook:** open Add calendar → Subscribe from web, then paste the HTTPS URL.

The service checks sources every 24 hours by default. Your calendar provider chooses its own polling interval; its displayed events can lag behind the service's updates. Refresh hints in the feed are advisory.

Keep the hostname stable for a permanent address. For example, the combined feed is:

```text
https://imdb-ics.onrender.com/calendars/all.ics
```

## Dates and timezones

By default, each release is an **all-day event** on IMDb's returned release date. The event contains the title and a link to its IMDb page. It uses an iCalendar date rather than a timestamp, so timezone conversion cannot move the release onto another day.

For example, a release dated 19 November appears as an all-day event on 19 November in Kuala Lumpur, Los Angeles, and elsewhere. The feed uses `DTSTART;VALUE=DATE:20261119` and an exclusive end of `DTEND;VALUE=DATE:20261120`. It does not invent a release time.

Dates come from IMDb's default `releaseDate` field. This is not a request for Malaysian release dates, and an all-day event does not establish which country's release date the source represents. Releases with only a year or month stay out of the feed until a complete valid date exists.

A series keeps its original premiere event. Interest calendars add every confirmed episode release date, while people calendars include only their directly credited episodes. Each release date has one event under the series name, and its description lists the season and episode numbers with episode titles. Episodes released together share one event, whether that is a weekly pair or an entire season. Episodes on the premiere date appear in the original event's description. An episode appears only once when both it and its series match.

The combined calendar also lists the matching interests and people in each event's description. A release shared by several sources remains one event, with each matching source listed once. These source labels appear above the episode list, so grouping a batch of episodes keeps their season numbers, episode numbers, and titles intact. Source labels are matched to the release and its included episodes rather than added to every episode of a series merely because a person has a series credit.

For example, two episodes released on the same day appear under the series name with a description such as:

```text
Interests: Marvel
People: Actor A, Actor B

S01E01: Pilot
S01E02: Second Episode
```

The feed follows IMDb's confirmed dates rather than generating a recurring weekly schedule, so breaks and batch releases use the dates returned by the source. Episodes without a complete date are omitted until one becomes available.

`EVENT_TIME_MODE=date` is the default in the service, local environment example, and Render Blueprint. The optional `EVENT_TIME_MODE=utc` setting creates midnight UTC markers that calendar apps convert to local time; those can appear on the previous date in western timezones. Switching modes preserves UIDs and advances event revision numbers, so existing events can update without changing subscription URLs. Update timestamps and HTTP headers continue to use UTC.

## Refresh and persistence

The service fetches one source at a time and follows every pagination cursor. Interest sources also fetch each matched series' complete episode list through a search constrained to that series, while people sources fetch only directly credited titles and episodes. A complete search with zero results establishes that a series has no listed episodes. A missing or incomplete result fails the refresh rather than being treated as an empty list. The number of HTTP calls depends on each source's size and the episode counts of series expanded by the interests. Requests have response-size and time bounds. There is no attempt to bypass an access challenge or blocked response.

Only a successful, complete source refresh replaces that source's saved titles. If a page fails, the last good snapshot remains available and the dashboard labels it as saved data. Failed sources retry after 30 minutes by default. A new installation creates its first combined snapshot only after every configured source has a complete snapshot. When sources are added to an existing installation, its saved combined feed remains available and is marked as stale while their first snapshots are pending or failing. Successful source updates can join that feed while the remaining sources warm up, and temporarily unavailable sources retain their last saved data.

Saved people snapshots record the interest exclusions used by their search. A cache created under an older filter is marked as saved data and refreshed immediately, even if its usual daily refresh is not due. An unsuccessful migration retains that cache and retries after 30 minutes. A successful filtered refresh cancels previously published appearances through the existing UID and revision rules, and removes their people attribution from independently eligible interest releases. Cancellation records remain in the feed so subscribers can remove old events. Interest snapshots keep their existing refresh schedule and membership.

Events use stable IMDb-based UIDs, persistent creation/modification times, and revision numbers. Title-level date changes update the same event. A series' original premiere UID stays the same when episodes are added to its description. Additional episode groups use the series ID and release date as their identity. Episode title, numbering, or membership changes advance the affected event's revision. Moving an episode to another date updates the relevant groups and cancels any additional group left empty. Removed titles or dates withdrawn by the source produce cancellation records, which are retained so slow subscribers can remove old events. Unchanged refreshes produce the same feed bytes and ETag.

Snapshots are stored as gzip-compressed JSON in `DATA_DIR/snapshot.json.gz`, with limits of 96 MiB uncompressed and 16 MiB compressed. Reading, JSON parsing, serialisation, and compression use bounded streams so a large snapshot does not require additional full-size strings or buffers. Each save writes a temporary file and renames it atomically, then logs the uncompressed and compressed byte counts. A failed save retains the previous file and logs the error. A legacy `DATA_DIR/snapshot.json` is loaded only when the gzip file is absent and is removed after a successful gzip save.

Calendar responses stream one event at a time and respect the client's download speed. Clients that accept gzip receive a compressed stream, while other clients receive the original calendar bytes. Compression does not require a complete feed buffer. Both representations use `Vary: Accept-Encoding`, and conditional requests compare the calendar's content revision. The server caches each event snapshot's uncompressed ETag, content length, and modification time so repeated HEAD and conditional requests do not render the feed again. A changed snapshot gets new metadata. Streaming and compression preserve the decoded feed bytes, event history, and revision rules.

Back up `DATA_DIR/snapshot.json.gz` along with the deployment environment. The snapshot contains source data and event history. Avoid deleting it to force a refresh: doing so resets revision history.

`mise exec -- npm run refresh` performs one refresh and exits. Use this **with the web service stopped**, for an initial fetch or maintenance; running it alongside the server would create two competing writers. A nonzero exit means at least one source failed or the cache could not be saved. Normal operation uses the in-process scheduler.

`GET /healthz` checks whether the HTTP process is alive. `GET /readyz` returns 503 until every configured source has a usable snapshot, including newly added sources even when a saved combined feed is available. Readiness does not assert that upstream data is fresh. The public dashboard shows update times and saved-data states. Both endpoints omit feed data.

## IMDb access limitation

This implementation uses **IMDb's website GraphQL endpoint**, not IMDb's licensed AWS Data Exchange API. Live tests retrieved the requested interests, credited titles, and release dates. However, the responses also included an entitlement value of `DENY` and a notice restricting public, commercial, or non-private use. The service records these notices in its refresh logs and saved source warnings. Returned data is not evidence of a licensed entitlement.

There is no verified supported quota or availability guarantee for this endpoint. It can change or stop working. Review [IMDb's data-use guidance](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX) before deployment and obtain appropriate supported access for any use that requires it. The licensed API's [schema is available to subscribers](https://data.imdb.com/documentation/api-documentation/key-concepts/), but support for these exact filters in that separate product has not been verified.

The upstream boundary is confined to `src/imdb.mjs`, so a supported provider can replace it without changing the calendar, cache, or UI modules.

## Architecture and checks

| File | Responsibility |
| --- | --- |
| `src/config.mjs` | Source selection, URLs, environment validation |
| `src/imdb.mjs` | Bounded, paginated upstream reads and complete-date validation |
| `src/calendar.mjs` | Stable event history and RFC 5545 serialization |
| `src/store.mjs` | Daily scheduling, retries, deduplication, atomic persistence |
| `src/page.mjs` | One small shared HTML layout with escaped source data |
| `src/profiles.json` | Authored biographies, background information, known works, and reference links |
| `src/profile-images.json` | Local image paths, dimensions, and source credits |
| `src/server.mjs` | Public HTTP routes, streamed feeds, cached validators, response headers |
| `public/style.css` | Shared layout, central colour palette, responsive, dark, and print styles |
| `public/enhance.js` | Optional one-click address copying with accessible feedback |
| `public/images/` | Saved portraits and interest images |
| `scripts/check.mjs` | HTML validation, JavaScript syntax, source uniqueness, byte budgets |
| `test/` | Calendar, pagination, cache recovery, public routes, and HTTP behaviour |

The research informs the design rather than supplying copied code: [Susam's site](https://github.com/susam/susam.net) for separating source data, layout, and validation; [Seirdy's site](https://github.com/Seirdy/seirdy.one) for explicit accessibility constraints; and [Kessler's portfolio](https://github.com/nickessler2004/Engineering-Portfolio-Website) for straightforward layout primitives. There is no CSS framework, custom publishing language, or speculative layout containment. Byte budgets constrain generated output and assets; they are not a claim of independently benchmarked browser performance.

The homepage has the combined subscription, three interest calendars, and an alphabetical people directory. Every calendar address is visible beside its copy button. The native Browse calendars menu links to separate `/people/<slug>/` and `/interests/<slug>/` pages. These share the homepage layout and show their own upcoming releases, subscription, biography or background, and known works. A source's releases are selected before the 12-item display limit, so a busy combined feed cannot hide that source's later dates. Existing `.ics` addresses and event UIDs remain unchanged.

The central palette uses IMDb-inspired yellow accents, a dark header, and system light/dark preferences. Keyboard focus, skip navigation, and print and narrow-screen styles remain available. The copy script uses the browser Clipboard API. If it is unavailable, the visible address can be copied manually. A refused clipboard write selects the address and announces the fallback. CSP permits only the required same-origin stylesheet, script, and images, restricts framing and other unneeded resources, and responses include `X-Content-Type-Options: nosniff`.

The 131 images are saved in `public/images/`, with their source URLs and dimensions recorded in `src/profile-images.json`. People use single-person headshots or portraits framed around the head and shoulders. Keep suitable portraits when updating the collection, and replace missing pictures or wider shots selectively. Use an existing source portrait rendition where available. IMDb, official profiles, agency pages, publishers, and Wikimedia Commons provide the saved photos. Commons images retain their photographer and licence credits in the manifest and on the profile page. Pages never request image metadata or remote images at runtime. To replace an image, save the new local asset and update its manifest entry with the source URL, accurate dimensions, and any required credit. `src/profiles.json` contains brief original summaries based on established work, with direct references and no automatic biography updates.

The project check validates all 131 source pages as well as homepage loading, ready, saved-data, and error states in both time modes. It checks local navigation and assets, source coverage, image dimensions, accessible address labels, copy targets, and byte budgets. Tests also cover copying success and failure, source-specific release lists, canonical page redirects, and existing feed behaviour.

The capacity regression uses the configured source count and more than 62,000 events, including shared releases, episode batches, and cancellation history. Its initial snapshot exceeds the previous 64 MiB uncompressed limit. The first filtered refresh cancels thousands of old people-only appearances while preserving every historical UID and independently eligible interest release. It checks repeated HTTP downloads, gzip round trips, HEAD and conditional requests, paused identity and compressed downloads during refresh and persistence, interrupted clients, and a separate-process restart that preserves every calendar byte. Each phase uses the configured 192 MiB heap limit and checks that peak process memory stays below 512 MiB. This fixture covers the current production scale rather than guaranteeing capacity for every possible source collection.

### Reference documentation

- [Render Blueprints](https://render.com/docs/blueprint-spec) and [persistent disks](https://render.com/docs/disks)
- [iCalendar event semantics](https://www.rfc-editor.org/rfc/rfc5545#section-3.6.1) and [refresh interval](https://www.rfc-editor.org/rfc/rfc7986#section-5.7)
- [Google Calendar subscription instructions](https://support.google.com/calendar/answer/37100?hl=en)
- [Outlook import versus subscription](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web)
