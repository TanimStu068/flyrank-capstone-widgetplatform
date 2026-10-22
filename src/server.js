import { createApp } from './app.js';
import { seedDemo } from './seed.js';

const { app, repos, worker, config, db } = await createApp();

if (config.seedOnBoot) {
  if (!config.demoApiKey) console.warn('SEED_ON_BOOT is set but DEMO_API_KEY is empty; skipping seed');
  else seedDemo({ repos, apiKey: config.demoApiKey });
}

worker.start();
const server = app.listen(config.port, () => console.log(JSON.stringify({ msg: 'listening', port: config.port, baseUrl: config.baseUrl })));

function shutdown() {
  worker.stop();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
