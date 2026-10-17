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
for (const [asset, budget] of [['style.css', 16 * 1024]]) {
  const bytes = await readFile(new URL(`../public/${asset}`, import.meta.url));
  assert(bytes.length <= budget, `${asset}: ${bytes.length} bytes exceeds ${budget}-byte budget.`);
  console.info(`${asset}: ${bytes.length}/${budget} bytes (${gzipSync(bytes).length} bytes gzip).`);
}
for (const directory of ['src', 'scripts', 'test']) {
  for (const entry of await readdir(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${entry.name}`], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
}
const htmlBudget = 8192 + 1536 * (SOURCES.length + 1);
let largestHtml = '';
for (const status of ['ready', 'pending', 'stale', 'error']) {
  for (const eventTimeMode of ['utc', 'date']) {
    const baseUrl = 'https://calendar.example';
    const feeds = [{ slug: 'all', label: 'All releases', url: null }, ...SOURCES].map((source) => ({
      ...source, status, count: ['pending', 'error'].includes(status) ? null : 12, omitted: ['pending', 'error'].includes(status) ? 0 : 1,
      updatedAt: ['pending', 'error'].includes(status) ? null : '2026-10-16T08:00:00.000Z',
      subscriptionUrl: `${baseUrl}/calendars/${source.slug}.ics`,
      webcalUrl: `webcal://calendar.example/calendars/${source.slug}.ics`,
    }));
    const html = renderPage({ baseUrl, feeds, upcoming: ['pending', 'error'].includes(status) ? [] : [
      { id: 'tt1234567', title: 'A title & its release', date: '2026-11-19', sources: ['Marvel'] },
      { id: 'tt2345678-2026-11-20', titleId: 'tt2345678', title: 'A series', date: '2026-11-20', sources: ['Dan Harmon', 'Justin Roiland'],
        episodeIds: ['tt3456789', 'tt4567890'], description: 'S01E01: A beginning\nS01E02: The <next> chapter' },
    ], updatedAt: ['pending', 'error'].includes(status) ? null : '2026-10-16T08:00:00.000Z', stale: status === 'stale', eventTimeMode });
    assert.equal((html.match(/<h1\b/g) || []).length, 1, 'The page must have one primary heading.');
    assert.equal((html.match(/<main\b/g) || []).length, 1, 'The page must have one main landmark.');
    assert.equal((html.match(/<header\b/g) || []).length, 1, 'The page must have one site header.');
    assert.equal((html.match(/<footer\b/g) || []).length, 1, 'The page must have one site footer.');
    assert.match(html, /<nav\b[^>]*\saria-label="[^"]+"/, 'The primary navigation must have an accessible name.');
    assert.doesNotMatch(html, /<script\b|<style\b|<[^>]+\s(?:on\w+|style)\s*=/i, 'The page must work through HTML and the shared stylesheet.');
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const idSet = new Set(ids);
    assert.equal(ids.length, idSet.size, 'Page IDs must be unique.');
    for (const match of html.matchAll(/\shref="#([^"]+)"/g)) assert(idSet.has(match[1]), `Missing fragment target: ${match[1]}`);
    for (const match of html.matchAll(/\saria-(?:labelledby|describedby)="([^"]+)"/g)) {
      for (const id of match[1].split(/\s+/)) assert(idSet.has(id), `Missing accessible description or label: ${id}`);
    }
    const labeledInputs = [...html.matchAll(/<label\b[^>]*\sfor="([^"]+)"/g)].map((match) => match[1]);
    for (const feed of feeds) {
      assert.equal(html.split(`value="${feed.subscriptionUrl}"`).length - 1, 1, `Expected one subscription address for ${feed.slug}.`);
    }
    for (const match of html.matchAll(/<input\b[^>]*\sid="([^"]+)"/g)) {
      assert(labeledInputs.includes(match[1]), `Missing label for ${match[1]}.`);
    }
    assert.equal(labeledInputs.length, feeds.length, 'Every subscription address must have an associated label.');
    const report = await validator.validateString(html);
    if (!report.valid) {
      for (const result of report.results) for (const message of result.messages) {
        console.error(`${status}/${eventTimeMode}:${message.line}:${message.column}: ${message.message} (${message.ruleId})`);
      }
      process.exitCode = 1;
    }
    assert(Buffer.byteLength(html) < htmlBudget, `The subscription page exceeds its ${htmlBudget / 1024} KiB HTML budget.`);
    if (Buffer.byteLength(html) > Buffer.byteLength(largestHtml)) largestHtml = html;
  }
}
console.info(`subscription page: ${Buffer.byteLength(largestHtml)}/${htmlBudget} bytes (${gzipSync(largestHtml).length} bytes gzip, ${SOURCES.length + 1} feeds).`);
if (!process.exitCode) console.info('JavaScript syntax, source configuration, HTML states, and asset budgets passed.');
