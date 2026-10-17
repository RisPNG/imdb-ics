import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { HtmlValidate } from 'html-validate';
import { SOURCES } from '../src/config.mjs';
import { renderPage } from '../src/page.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const validator = new HtmlValidate();
assert.equal(SOURCES.length, new Set(SOURCES.map((source) => source.id)).size, 'Source IDs must be unique.');
assert.equal(SOURCES.length, new Set(SOURCES.map((source) => source.slug)).size, 'Source slugs must be unique.');
for (const [asset, budget] of [['style.css', 20 * 1024], ['enhance.js', 3 * 1024]]) {
  const bytes = await readFile(new URL(`../public/${asset}`, import.meta.url));
  assert(bytes.length <= budget, `${asset}: ${bytes.length} bytes exceeds ${budget}-byte budget.`);
  console.info(`${asset}: ${bytes.length}/${budget} bytes (${gzipSync(bytes).length} bytes gzip).`);
}
const profiles = JSON.parse(await readFile(new URL('../src/profiles.json', import.meta.url), 'utf8'));
const images = JSON.parse(await readFile(new URL('../src/profile-images.json', import.meta.url), 'utf8'));
const sourceSlugs = SOURCES.map((source) => source.slug).sort();
assert.deepEqual(Object.keys(profiles).sort(), sourceSlugs, 'Every source must have one profile.');
assert.deepEqual(Object.keys(images).sort(), sourceSlugs, 'Every source must have one local image entry.');
const imagePaths = new Set();
let imageBytes = 0;
for (const source of SOURCES) {
  const profile = profiles[source.slug];
  assert(typeof profile.summary === 'string' && profile.summary.trim().length > 20, `Missing profile summary: ${source.slug}.`);
  for (const field of ['roles', 'knownFor', 'references']) assert(Array.isArray(profile[field]) && profile[field].length, `Missing ${field}: ${source.slug}.`);
  for (const reference of profile.references) {
    assert(typeof reference.label === 'string' && reference.label.trim(), `Missing reference label: ${source.slug}.`);
    assert.equal(new URL(reference.url).protocol, 'https:', `Profile references must use HTTPS: ${source.slug}.`);
  }
  const image = images[source.slug];
  assert.match(image.path, /^\/images\/[a-z-]+\.(?:jpg|svg)$/);
  assert(Number.isInteger(image.width) && image.width > 0, `Missing image width: ${source.slug}.`);
  assert(Number.isInteger(image.height) && image.height > 0, `Missing image height: ${source.slug}.`);
  assert(typeof image.alt === 'string' && image.alt.trim(), `Missing image text alternative: ${source.slug}.`);
  assert.equal(new URL(image.sourceUrl).protocol, 'https:');
  if (image.imageUnavailable) {
    assert.equal(image.imageUrl, null);
    assert(image.path.endsWith('.svg'));
  } else {
    assert.equal(new URL(image.imageUrl).protocol, 'https:');
  }
  const bytes = await readFile(new URL(`../public${image.path}`, import.meta.url));
  assert(bytes.length && bytes.length <= 512 * 1024, `Profile image exceeds its 512 KiB budget: ${image.path}.`);
  if (!imagePaths.has(image.path)) {
    imagePaths.add(image.path);
    imageBytes += bytes.length;
  }
  if (image.path.endsWith('.jpg')) {
    assert.equal(bytes.readUInt16BE(0), 0xffd8, `Invalid JPEG: ${image.path}.`);
    let dimensions;
    for (let offset = 2; offset + 9 < bytes.length;) {
      assert.equal(bytes[offset], 0xff, `Invalid JPEG marker: ${image.path}.`);
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      const length = bytes.readUInt16BE(offset);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        dimensions = { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
        break;
      }
      offset += length;
    }
    assert.deepEqual(dimensions, { width: image.width, height: image.height }, `Incorrect image dimensions: ${image.path}.`);
  }
}
assert(imageBytes <= 12 * 1024 * 1024, 'Local profile images exceed their 12 MiB total budget.');
console.info(`profile images: ${imagePaths.size} local files, ${imageBytes} bytes, ${SOURCES.length} profiles.`);
for (const directory of ['src', 'scripts', 'test']) {
  for (const entry of await readdir(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${entry.name}`], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
}
const clientSyntax = spawnSync(process.execPath, ['--check', 'public/enhance.js'], { cwd: root, encoding: 'utf8' });
assert.equal(clientSyntax.status, 0, clientSyntax.stderr);
const htmlBudget = 150 * 1024;
let largestHtml = '';
async function validatePage(html, label, feeds) {
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `${label}: The page must have one primary heading.`);
  assert.equal((html.match(/<main\b/g) || []).length, 1, `${label}: The page must have one main landmark.`);
  assert.equal((html.match(/<header\b/g) || []).length, 1, `${label}: The page must have one site header.`);
  assert.equal((html.match(/<footer\b/g) || []).length, 1, `${label}: The page must have one site footer.`);
  assert.match(html, /<nav\b[^>]*\saria-label="[^"]+"/, `${label}: The primary navigation must have an accessible name.`);
  assert.doesNotMatch(html, /<style\b|<[^>]+\s(?:on\w+|style)\s*=/i, `${label}: Inline scripts and styles are not allowed.`);
  assert.equal((html.match(/<script\b/g) || []).length, 1, `${label}: Only the copy enhancement script is needed.`);
  assert.match(html, /<script\b[^>]*\bsrc="\/enhance\.js"[^>]*\bdefer[^>]*><\/script>/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const idSet = new Set(ids);
  assert.equal(ids.length, idSet.size, `${label}: Page IDs must be unique.`);
  for (const match of html.matchAll(/\shref="#([^"]+)"/g)) assert(idSet.has(match[1]), `${label}: Missing fragment target: ${match[1]}`);
  for (const match of html.matchAll(/\saria-(?:labelledby|describedby)="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) assert(idSet.has(id), `${label}: Missing accessible description or label: ${id}`);
  }
  const labeledInputs = [...html.matchAll(/<label\b[^>]*\sfor="([^"]+)"/g)].map((match) => match[1]);
  for (const feed of feeds) {
    assert.equal(html.split(`value="${feed.subscriptionUrl}"`).length - 1, 1, `${label}: Expected one address for ${feed.slug}.`);
  }
  for (const match of html.matchAll(/<input\b[^>]*\sid="([^"]+)"/g)) {
    assert(labeledInputs.includes(match[1]), `${label}: Missing label for ${match[1]}.`);
    const button = html.match(new RegExp(`<button\\b[^>]*\\bdata-copy="${match[1]}"[^>]*>`))?.[0];
    assert(button && /\shidden(?:[\s>]|="")/.test(button), `${label}: Copy buttons must be progressively enhanced.`);
  }
  assert.equal(labeledInputs.length, feeds.length, `${label}: Every address must have an associated label.`);
  for (const match of html.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/g)) {
    assert.doesNotMatch(match[1], /<input\b/, `${label}: Addresses must be visible without opening a disclosure.`);
  }
  const sourcePaths = new Set(SOURCES.map((source) => `/${source.kind === 'name' ? 'people' : 'interests'}/${source.slug}/`));
  for (const path of sourcePaths) assert(html.includes(`href="${path}"`), `${label}: Missing source navigation: ${path}.`);
  for (const match of html.matchAll(/\shref="(\/(?:people|interests)\/[^"#?]+)"/g)) {
    assert(sourcePaths.has(match[1]), `${label}: Broken source link: ${match[1]}.`);
  }
  for (const match of html.matchAll(/<(?:img|script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
    if (/^<link\b/.test(match[0]) && !/\brel="stylesheet"/.test(match[0])) continue;
    assert(/^\/(?:style\.css|enhance\.js|images\/[a-z-]+\.(?:jpg|svg))$/.test(match[1]), `${label}: Unexpected external or missing asset: ${match[1]}.`);
    await readFile(new URL(`../public${match[1]}`, import.meta.url));
  }
  const report = await validator.validateString(html);
  if (!report.valid) {
    for (const result of report.results) for (const message of result.messages) {
      console.error(`${label}:${message.line}:${message.column}: ${message.message} (${message.ruleId})`);
    }
    process.exitCode = 1;
  }
  assert(Buffer.byteLength(html) < htmlBudget, `${label}: The page exceeds its ${htmlBudget / 1024} KiB HTML budget.`);
  if (Buffer.byteLength(html) > Buffer.byteLength(largestHtml)) largestHtml = html;
}
for (const status of ['ready', 'pending', 'stale', 'error']) {
  for (const eventTimeMode of ['utc', 'date']) {
    const baseUrl = 'https://calendar.example';
    const feeds = [{ slug: 'all', label: 'All releases', url: null }, ...SOURCES].map((source) => ({
      ...source, status, count: ['pending', 'error'].includes(status) ? null : 12, omitted: ['pending', 'error'].includes(status) ? 0 : 1,
      updatedAt: ['pending', 'error'].includes(status) ? null : '2026-10-16T08:00:00.000Z',
      subscriptionUrl: `${baseUrl}/calendars/${source.slug}.ics`,
      webcalUrl: `webcal://calendar.example/calendars/${source.slug}.ics`,
    }));
    const data = { baseUrl, feeds, upcoming: ['pending', 'error'].includes(status) ? [] : [
      { id: 'tt1234567', title: 'A title & its release', date: '2026-11-19', sources: ['Marvel'] },
      { id: 'tt2345678-2026-11-20', titleId: 'tt2345678', title: 'A series', date: '2026-11-20', sources: ['Dan Harmon', 'Justin Roiland'],
        episodeIds: ['tt3456789', 'tt4567890'], description: 'S01E01: A beginning\nS01E02: The <next> chapter' },
    ], updatedAt: ['pending', 'error'].includes(status) ? null : '2026-10-16T08:00:00.000Z', stale: status === 'stale', eventTimeMode };
    await validatePage(renderPage(data), `home/${status}/${eventTimeMode}`, feeds);
    if (status === 'ready' && eventTimeMode === 'date') {
      for (const source of SOURCES) {
        await validatePage(renderPage({ ...data, sourceSlug: source.slug }), source.slug, feeds.filter((feed) => feed.slug === source.slug));
      }
    }
  }
}
console.info(`subscription page: ${Buffer.byteLength(largestHtml)}/${htmlBudget} bytes (${gzipSync(largestHtml).length} bytes gzip, ${SOURCES.length + 1} feeds).`);
if (!process.exitCode) console.info('JavaScript syntax, source configuration, HTML states, and asset budgets passed.');
