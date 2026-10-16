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
for (const [asset, budget] of [['style.css', 6144], ['enhance.js', 2048]]) {
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
for (const status of ['ready', 'pending', 'stale', 'error']) {
  for (const eventTimeMode of ['utc', 'date']) {
    const baseUrl = 'https://calendar.example';
    const feeds = [{ slug: 'all', label: 'All releases', url: null }, ...SOURCES].map((source) => ({
      ...source, status, count: status === 'pending' ? null : 12, omitted: status === 'pending' ? 0 : 1,
      updatedAt: status === 'pending' ? null : '2026-10-16T08:00:00.000Z',
      subscriptionUrl: `${baseUrl}/calendars/${source.slug}.ics`,
      webcalUrl: `webcal://calendar.example/calendars/${source.slug}.ics`,
    }));
    const html = renderPage({ baseUrl, feeds, upcoming: status === 'pending' ? [] : [{ title: 'A title & its release', date: '2026-11-19' }],
      updatedAt: status === 'pending' ? null : '2026-10-16T08:00:00.000Z', stale: status === 'stale', eventTimeMode });
    const report = await validator.validateString(html);
    if (!report.valid) {
      for (const result of report.results) for (const message of result.messages) {
        console.error(`${status}/${eventTimeMode}:${message.line}:${message.column}: ${message.message} (${message.ruleId})`);
      }
      process.exitCode = 1;
    }
    assert(Buffer.byteLength(html) < 32768, 'The subscription page exceeds its 32 KiB HTML budget.');
  }
}
if (!process.exitCode) console.info('JavaScript syntax, source configuration, HTML states, and asset budgets passed.');
