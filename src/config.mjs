import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const SOURCES = Object.freeze([
  { slug: 'marvel', id: 'in0000248', kind: 'interest', label: 'Marvel' },
  { slug: 'star-wars', id: 'in0000243', kind: 'interest', label: 'Star Wars' },
  { slug: 'dc', id: 'in0000244', kind: 'interest', label: 'DC' },
  { slug: 'vince-gilligan', id: 'nm0319213', kind: 'name', label: 'Vince Gilligan' },
  { slug: 'justin-roiland', id: 'nm1551598', kind: 'name', label: 'Justin Roiland' },
  { slug: 'chiwetel-ejiofor', id: 'nm0252230', kind: 'name', label: 'Chiwetel Ejiofor' },
  { slug: 'kane-parsons', id: 'nm10735410', kind: 'name', label: 'Kane Parsons' },
  { slug: 'donald-glover', id: 'nm2255973', kind: 'name', label: 'Donald Glover' },
  { slug: 'michael-pena', id: 'nm0671567', kind: 'name', label: 'Michael Peña' },
  { slug: 'jake-gyllenhaal', id: 'nm0350453', kind: 'name', label: 'Jake Gyllenhaal' },
  { slug: 'kyle-chandler', id: 'nm0151419', kind: 'name', label: 'Kyle Chandler' },
  { slug: 'leonardo-dicaprio', id: 'nm0000138', kind: 'name', label: 'Leonardo DiCaprio' },
  { slug: 'matt-damon', id: 'nm0000354', kind: 'name', label: 'Matt Damon' },
  { slug: 'michael-mando', id: 'nm3103126', kind: 'name', label: 'Michael Mando' },
  { slug: 'brad-pitt', id: 'nm0000093', kind: 'name', label: 'Brad Pitt' },
  { slug: 'george-lucas', id: 'nm0000184', kind: 'name', label: 'George Lucas' },
  { slug: 'george-clooney', id: 'nm0000123', kind: 'name', label: 'George Clooney' },
  { slug: 'diego-luna', id: 'nm0526019', kind: 'name', label: 'Diego Luna' },
  { slug: 'grant-gustin', id: 'nm2652716', kind: 'name', label: 'Grant Gustin' },
  { slug: 'ryan-gosling', id: 'nm0331516', kind: 'name', label: 'Ryan Gosling' },
  { slug: 'benedict-cumberbatch', id: 'nm1212722', kind: 'name', label: 'Benedict Cumberbatch' },
  { slug: 'robert-pattinson', id: 'nm1500155', kind: 'name', label: 'Robert Pattinson' },
  { slug: 'steven-ogg', id: 'nm1476804', kind: 'name', label: 'Steven Ogg' },
  { slug: 'ned-luke', id: 'nm0902623', kind: 'name', label: 'Ned Luke' },
  { slug: 'michael-cera', id: 'nm0148418', kind: 'name', label: 'Michael Cera' },
  { slug: 'tom-hiddleston', id: 'nm1089991', kind: 'name', label: 'Tom Hiddleston' },
  { slug: 'nicolas-cage', id: 'nm0000115', kind: 'name', label: 'Nicolas Cage' },
  { slug: 'oscar-isaac', id: 'nm1209966', kind: 'name', label: 'Oscar Isaac' },
  { slug: 'steven-yeun', id: 'nm3081796', kind: 'name', label: 'Steven Yeun' },
  { slug: 'andrew-santino', id: 'nm2747668', kind: 'name', label: 'Andrew Santino' },
  { slug: 'bobby-lee', id: 'nm0496899', kind: 'name', label: 'Bobby Lee' },
  { slug: 'john-cena', id: 'nm1078479', kind: 'name', label: 'John Cena' },
  { slug: 'christopher-nolan', id: 'nm0634240', kind: 'name', label: 'Christopher Nolan' },
  { slug: 'joel-mchale', id: 'nm0570364', kind: 'name', label: 'Joel McHale' },
  { slug: 'bob-odenkirk', id: 'nm0644022', kind: 'name', label: 'Bob Odenkirk' },
  { slug: 'aaron-paul', id: 'nm0666739', kind: 'name', label: 'Aaron Paul' },
  { slug: 'bryan-cranston', id: 'nm0186505', kind: 'name', label: 'Bryan Cranston' },
  { slug: 'gabriel-macht', id: 'nm0532683', kind: 'name', label: 'Gabriel Macht' },
  { slug: 'josh-hutcherson', id: 'nm1242688', kind: 'name', label: 'Josh Hutcherson' },
  { slug: 'rick-hoffman', id: 'nm0389069', kind: 'name', label: 'Rick Hoffman' },
  { slug: 'patrick-j-adams', id: 'nm1140666', kind: 'name', label: 'Patrick J. Adams' },
  { slug: 'anya-taylor-joy', id: 'nm5896355', kind: 'name', label: 'Anya Taylor-Joy' },
  { slug: 'sadie-sink', id: 'nm5584750', kind: 'name', label: 'Sadie Sink' },
  { slug: 'giancarlo-esposito', id: 'nm0002064', kind: 'name', label: 'Giancarlo Esposito' },
  { slug: 'jonathan-banks', id: 'nm0052186', kind: 'name', label: 'Jonathan Banks' },
  { slug: 'jesse-plemons', id: 'nm0687146', kind: 'name', label: 'Jesse Plemons' },
  { slug: 'ethan-hawke', id: 'nm0000160', kind: 'name', label: 'Ethan Hawke' },
  { slug: 'mark-hamill', id: 'nm0000434', kind: 'name', label: 'Mark Hamill' },
  { slug: 'samuel-l-jackson', id: 'nm0000168', kind: 'name', label: 'Samuel L. Jackson' },
  { slug: 'taron-egerton', id: 'nm5473782', kind: 'name', label: 'Taron Egerton' },
  { slug: 'matthew-judge', id: 'nm15158872', kind: 'name', label: 'Matthew Judge' },
  { slug: 'kevan-brighting', id: 'nm2623915', kind: 'name', label: 'Kevan Brighting' },
  { slug: 'james-mcavoy', id: 'nm0564215', kind: 'name', label: 'James McAvoy' },
  { slug: 'dan-harmon', id: 'nm1363595', kind: 'name', label: 'Dan Harmon' },
  { slug: 'keanu-reeves', id: 'nm0000206', kind: 'name', label: 'Keanu Reeves' },
  { slug: 'alan-morrison', id: 'nm3290082', kind: 'name', label: 'Alan Morrison' },
  { slug: 'adam-king', id: 'nm5842157', kind: 'name', label: 'Adam King' },
  { slug: 'ben-van-lier', id: 'nm2866114', kind: 'name', label: 'Ben Van Lier' },
  { slug: 'britt-scott-clark', id: 'nm7794173', kind: 'name', label: 'Britt Scott Clark' },
  { slug: 'byron-coll', id: 'nm3750475', kind: 'name', label: 'Byron Coll' },
  { slug: 'hamish-parkinson', id: 'nm3312641', kind: 'name', label: 'Hamish Parkinson' },
  { slug: 'rowan-bettjeman', id: 'nm3394670', kind: 'name', label: 'Rowan Bettjeman' },
  { slug: 'rowan-atkinson', id: 'nm0000100', kind: 'name', label: 'Rowan Atkinson' },
  { slug: 'cooper-tomlinson', id: 'nm7831367', kind: 'name', label: 'Cooper Tomlinson' },
  { slug: 'curry-barker', id: 'nm10533874', kind: 'name', label: 'Curry Barker' },
  { slug: 'jeremy-allen-white', id: 'nm2087739', kind: 'name', label: 'Jeremy Allen White' },
  { slug: 'sam-houser', id: 'nm0396759', kind: 'name', label: 'Sam Houser' },
  { slug: 'mark-fischbach', id: 'nm6179964', kind: 'name', label: 'Mark Fischbach' },
  { slug: 'sean-mcloughlin', id: 'nm7681921', kind: 'name', label: 'Seán McLoughlin' },
  { slug: 'isack-hadjar', id: 'nm15884712', kind: 'name', label: 'Isack Hadjar' },
  { slug: 'felix-kjellberg', id: 'nm5579304', kind: 'name', label: 'Felix Kjellberg' },
  { slug: 'max-verstappen', id: 'nm6722413', kind: 'name', label: 'Max Verstappen' },
].map((source) => Object.freeze({
  ...source,
  url: `https://www.imdb.com/${source.kind === 'interest' ? 'interest' : 'name'}/${source.id}/`,
})));

function integer(value, fallback, name, min, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return number;
}

export function loadConfig(env = process.env) {
  const port = integer(env.PORT, 3000, 'PORT', 1, 65535);
  const origin = new URL(env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
      origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL must be an HTTPS origin (HTTP is allowed for localhost).');
  }
  const eventTimeMode = env.EVENT_TIME_MODE || 'date';
  if (!['date', 'utc'].includes(eventTimeMode)) throw new Error('EVENT_TIME_MODE must be date or utc.');
  return Object.freeze({
    port,
    origin: origin.origin,
    baseUrl: origin.origin,
    dataDir: resolve(env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url))),
    eventTimeMode,
    refreshIntervalMs: integer(env.REFRESH_INTERVAL_HOURS, 24, 'REFRESH_INTERVAL_HOURS', 1, 168) * 3_600_000,
    retryIntervalMs: integer(env.REFRESH_RETRY_MINUTES, 30, 'REFRESH_RETRY_MINUTES', 5, 1440) * 60_000,
    sources: SOURCES,
  });
}
