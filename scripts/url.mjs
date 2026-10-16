import { loadConfig } from '../src/config.mjs';

// Run interactively to retrieve the private dashboard URL. Do not add this to
// the server startup command or commit its output: the URL grants feed access.
console.info(`${loadConfig().baseUrl}/`);
