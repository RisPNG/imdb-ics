import { loadConfig } from '../src/config.mjs';
import { CalendarStore } from '../src/store.mjs';

const config = loadConfig();
const store = new CalendarStore(config);
await store.initialize();
await store.refresh();
const failed = config.sources.filter((source) => store.sourceState(source).status !== 'ready');
if (failed.length || store.persistenceError) {
  console.error(`Refresh incomplete${failed.length ? `: ${failed.map((source) => source.slug).join(', ')}` : ''}. Saved calendars were preserved.`);
  process.exitCode = 1;
} else {
  console.info('All five sources refreshed and the snapshot was saved.');
}
