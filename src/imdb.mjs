const ENDPOINT = 'https://api.graphql.imdb.com/';
const PAGE_SIZE = 100;
const MAX_TITLES = 50_000;
const MAX_PAGES = 1_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 20_000;
const OPERATION_TIMEOUT_MS = 120_000;
export const TITLE_EXCLUSIONS = Object.freeze({
  interestIds: Object.freeze(['in0000105', 'in0000104', 'in0000211', 'in0000127', 'in0000060']),
  officialSite: 'youtube',
});

export class ImdbError extends Error {
  constructor(message, { code = 'UPSTREAM_ERROR', status, cause } = {}) {
    super(message, { cause });
    this.name = 'ImdbError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function queryFor(source, cursor) {
  const after = cursor === null ? '' : `, after: ${JSON.stringify(cursor)}`;
  const filter = source.kind === 'interest'
    ? `interestConstraint: {allInterestIds: ["${source.id}"], excludeInterestIds: ${JSON.stringify(TITLE_EXCLUSIONS.interestIds)}}`
    : `${source.kind === 'name' ? `titleCreditsConstraint: {anyCredits: [{nameId: "${source.id}"}]}` : `episodicConstraint: {anySeriesIds: ["${source.id}"]}`}, interestConstraint: {excludeInterestIds: ${JSON.stringify(TITLE_EXCLUSIONS.interestIds)}}`;
  return `query ${source.kind === 'series' ? 'CalendarEpisodes' : 'CalendarSource'} {
    advancedTitleSearch(first: ${PAGE_SIZE}${after}, constraints: {${filter}}) {
      total
      pageInfo { hasNextPage endCursor }
      edges { node { title { ...CalendarTitle titleType { id } series { series { ...CalendarTitle } episodeNumber { seasonNumber episodeNumber } } } } }
    }
  }
  fragment CalendarTitle on Title {
    id titleText { text } releaseDate { year month day }
    interests(first: 100) { total pageInfo { hasNextPage } edges { node { id } } }
    externalLinks(first: 100, filter: {categories: ["official"]}) { total pageInfo { hasNextPage } edges { node { url label } } }
  }`;
}

// A year or month alone must never become a fabricated calendar day.
function completeDate(value) {
  if (!value || typeof value !== 'object') return null;
  const { year, month, day } = value;
  if (![year, month, day].every(Number.isInteger)) return null;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function readJson(response, signal) {
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ImdbError('IMDb response exceeds the 2 MiB page limit.', { code: 'RESPONSE_TOO_LARGE' });
  }
  const type = response.headers.get('content-type');
  if (type && !/^application\/(?:json|graphql-response\+json)(?:;|$)/i.test(type)) {
    await response.body?.cancel();
    throw new ImdbError('IMDb returned a non-JSON response; no challenge bypass was attempted.', { code: 'INVALID_RESPONSE' });
  }
  if (!response.body) throw new ImdbError('IMDb returned an empty response.', { code: 'INVALID_RESPONSE' });
  const reader = response.body.getReader();
  const abortRead = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abortRead, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ImdbError('IMDb response exceeds the 2 MiB page limit.', { code: 'RESPONSE_TOO_LARGE' });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ImdbError || signal.aborted) throw error;
    throw new ImdbError('IMDb returned unreadable JSON.', { code: 'INVALID_RESPONSE', cause: error });
  } finally {
    signal.removeEventListener('abort', abortRead);
    reader.releaseLock();
  }
}

function recordWarnings(extensions, warnings) {
  if (!extensions || typeof extensions !== 'object') return;
  const fields = extensions.entitlements?.fields;
  if (fields && Object.values(fields).includes('DENY')) {
    warnings.add('IMDb returned entitlement DENY alongside data. This website endpoint is unsupported and does not establish licensed API access.');
  }
  if (typeof extensions.disclaimer === 'string' && extensions.disclaimer.trim()) {
    warnings.add(`IMDb usage notice: ${extensions.disclaimer.trim().slice(0, 2_000)}`);
  }
}

function invalid(message) {
  throw new ImdbError(`IMDb returned an incomplete or inconsistent result: ${message}`, { code: 'INCOMPLETE_RESULT' });
}

function isExcludedTitle(title) {
  for (const field of ['interests', 'externalLinks']) {
    const connection = title[field];
    if (!connection || !Number.isSafeInteger(connection.total) || connection.total < 0
        || connection.pageInfo?.hasNextPage !== false || !Array.isArray(connection.edges)
        || connection.edges.length !== connection.total) {
      invalid(`title ${title.id} is missing complete ${field}.`);
    }
  }
  const interests = title.interests.edges.map((edge) => edge?.node?.id);
  if (interests.some((id) => typeof id !== 'string' || !/^in\d{7}$/.test(id))) invalid(`title ${title.id} has an invalid interest.`);
  const sites = title.externalLinks.edges.map((edge) => {
    const link = edge?.node;
    if (typeof link?.url !== 'string' || (link.label != null && typeof link.label !== 'string')) invalid(`title ${title.id} has an invalid official site.`);
    let url;
    try { url = new URL(link.url); }
    catch { invalid(`title ${title.id} has an invalid official site URL.`); }
    if (!['http:', 'https:'].includes(url.protocol)) invalid(`title ${title.id} has an invalid official site URL.`);
    const host = url.hostname.toLowerCase();
    return { youtube: ['youtube.com', 'youtu.be'].some((domain) => host === domain || host.endsWith(`.${domain}`)),
      main: /\b(?:(?:official|company)\s+(?:web\s*)?site|web\s*site)\b/i.test(link.label ?? ''),
      social: ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com'].some((domain) => host === domain || host.endsWith(`.${domain}`)) };
  });
  return interests.some((id) => TITLE_EXCLUSIONS.interestIds.includes(id))
    || (sites.length > 0 && sites.every((site) => site.youtube))
    || (sites.some((site) => site.youtube && site.main) && !sites.some((site) => !site.youtube && (site.main || !site.social)));
}

async function readTitles(source, { fetchImpl, signal }) {
  const operationSignal = AbortSignal.any([
    AbortSignal.timeout(OPERATION_TIMEOUT_MS),
    ...(signal ? [signal] : []),
  ]);
  operationSignal.throwIfAborted();
  const titles = new Map();
  const excludedIds = new Set();
  const cursors = new Set();
  const warnings = new Set();
  let cursor = null;
  let total;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    operationSignal.throwIfAborted();
    const pageSignal = AbortSignal.any([operationSignal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]);
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-imdb-client-name': 'imdb-web-next',
      },
      redirect: 'error',
      credentials: 'omit',
      body: JSON.stringify({ query: queryFor(source, cursor) }),
      signal: pageSignal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ImdbError(`IMDb request failed with HTTP ${response.status}.`, { code: 'HTTP_ERROR', status: response.status });
    }
    const payload = await readJson(response, pageSignal);
    if (!payload || typeof payload !== 'object') invalid('missing response object.');
    if (payload.errors !== undefined && !Array.isArray(payload.errors)) invalid('malformed GraphQL errors.');
    if (payload.errors?.length) {
      const message = String(payload.errors[0]?.message || 'Unknown GraphQL error').slice(0, 500);
      throw new ImdbError(`IMDb GraphQL error: ${message}`, { code: 'GRAPHQL_ERROR' });
    }
    recordWarnings(payload.extensions, warnings);
    const page = payload.data?.advancedTitleSearch;
    if (!page || !Number.isSafeInteger(page.total) || page.total < 0
        || !Array.isArray(page.edges) || typeof page.pageInfo?.hasNextPage !== 'boolean') {
      invalid(source.kind === 'series' ? `missing episode-search fields for series ${source.id} (${source.title}).` : 'missing title-search fields.');
    }
    if (page.total > MAX_TITLES) invalid(`more than the ${MAX_TITLES} title safety limit.`);
    if (total === undefined) total = page.total;
    if (total !== page.total) invalid('the total changed during pagination; retry the refresh.');

    for (const edge of page.edges) {
      const title = edge?.node?.title;
      if (!title || !/^tt\d{7,10}$/.test(title.id)
          || typeof title.titleText?.text !== 'string' || !title.titleText.text.trim()) {
        invalid('a title is missing its ID or text.');
      }
      const type = title.titleType?.id;
      if (typeof type !== 'string' || !type) invalid(`title ${title.id} is missing its type.`);
      if (source.kind === 'series' && type !== 'tvEpisode') invalid(`episode search for series ${source.id} returned non-episode ${title.id}.`);
      const item = { id: title.id, title: title.titleText.text.trim(), date: completeDate(title.releaseDate), type };
      let excluded = isExcludedTitle(title);
      if (type === 'tvEpisode') {
        const parent = title.series?.series;
        const numbering = title.series?.episodeNumber;
        if (!parent || !/^tt\d{7,10}$/.test(parent.id)
            || typeof parent.titleText?.text !== 'string' || !parent.titleText.text.trim()) {
          invalid(`episode ${title.id} is missing its series.`);
        }
        if (source.kind === 'series' && parent.id !== source.id) invalid(`episode ${title.id} belongs to series ${parent.id} rather than ${source.id}.`);
        if ([numbering?.seasonNumber, numbering?.episodeNumber].some((value) => value != null && (!Number.isSafeInteger(value) || value < 0))) {
          invalid(`episode ${title.id} has invalid numbering.`);
        }
        item.series = { id: parent.id, title: source.kind === 'series' ? source.title : parent.titleText.text.trim(), date: source.kind === 'series' ? source.date : completeDate(parent.releaseDate), season: numbering?.seasonNumber ?? null, episode: numbering?.episodeNumber ?? null };
        excluded = isExcludedTitle(parent) || excluded;
      }
      const previous = titles.get(item.id);
      if (previous && (JSON.stringify(previous) !== JSON.stringify(item) || excludedIds.has(item.id) !== excluded)) {
        invalid(`title ${item.id} changed during pagination; retry the refresh.`);
      }
      titles.set(item.id, item);
      if (excluded) excludedIds.add(item.id);
    }
    if (titles.size > total) invalid('more unique titles than the reported total.');
    if (!page.pageInfo.hasNextPage) {
      if (titles.size !== total) invalid(`expected ${total} unique titles but received ${titles.size}.`);
      const results = [...titles.values()].filter((title) => !excludedIds.has(title.id));
      return { titles: results, total: results.length, omitted: results.filter((title) => title.date === null).length, warnings: [...warnings] };
    }
    const next = page.pageInfo.endCursor;
    if (!page.edges.length || typeof next !== 'string' || !next || next.length > 10_000 || cursors.has(next)) {
      invalid('pagination did not advance.');
    }
    cursors.add(next);
    cursor = next;
  }
  invalid(`more than the ${MAX_PAGES} page safety limit.`);
}

/**
 * Read eligible directly matching titles, including undated titles, and expand interest series into their complete eligible episode lists. Every source uses the same title exclusions, inherited by episodes from their series. Filmographies retain only directly credited episodes.
 * The website GraphQL endpoint is not the licensed AWS IMDb API. Entitlement metadata and usage notices are returned as warnings for the caller to expose.
 * Any failed or inconsistent page rejects the entire source; callers should keep their previous complete snapshot.
 */
export async function fetchSource(source, { fetchImpl = globalThis.fetch, signal, region, seriesCache = new Map() } = {}) {
  if (!source || !['interest', 'name'].includes(source.kind)
      || !(source.kind === 'interest' ? /^in\d{7}$/ : /^nm\d{7,10}$/).test(source.id)) {
    throw new TypeError('A source must contain a valid IMDb interest or name ID and matching kind.');
  }
  if (region !== undefined) throw new TypeError('Region-specific IMDb release dates are not supported; omit region to use the returned default date.');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');
  const result = await readTitles(source, { fetchImpl, signal });
  const warnings = new Set(result.warnings);
  for (const title of result.titles) {
    signal?.throwIfAborted();
    if (source.kind !== 'interest' || !['tvSeries', 'tvMiniSeries'].includes(title.type)) continue;
    let cached = seriesCache.get(title.id);
    if (!cached) {
      const episodes = await readTitles({ kind: 'series', id: title.id, title: title.title, date: title.date }, { fetchImpl, signal });
      signal?.throwIfAborted();
      cached = { episodes: episodes.titles, warnings: episodes.warnings };
      seriesCache.set(title.id, cached);
    }
    title.episodes = cached.episodes;
    for (const warning of cached.warnings) warnings.add(warning);
  }
  result.warnings = [...warnings];
  return result;
}
