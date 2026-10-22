import { loadConfig } from '../src/config.js';
import { migrate, openDb } from '../src/db/index.js';
import { createRepos } from '../src/db/repos.js';
import { seedDemo } from '../src/seed.js';

const config = loadConfig();
if (!config.demoApiKey) { console.error('Set DEMO_API_KEY in .env first (any local string of 10+ chars).'); process.exit(1); }
const db = openDb(config.dbPath);
migrate(db);
console.log('Seeded:', seedDemo({ repos: createRepos(db), apiKey: config.demoApiKey }));
console.log('Use header:  Authorization: Bearer <DEMO_API_KEY>');
