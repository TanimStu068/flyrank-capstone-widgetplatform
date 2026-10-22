import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { migrate, openDb } from './db/index.js';
import { createRepos } from './db/repos.js';
import { createTokenBucket } from './services/ratelimit.js';
import { createGeoService, mockProviders, realProviders, withFaults } from './services/geo.js';
import { createMailer } from './services/mailer.js';
import { createJobHandlers, createWorker } from './services/jobs.js';
import { createAuthService } from './services/auth.js';
import { createWidgetService } from './services/widgets.js';
import { createSubmissionService } from './services/submissions.js';
import { createDashboardService } from './services/dashboard.js';
import { loadBundle } from './bundle.js';
import { errorHandler, notFoundHandler, publicCors, requestLogger } from './http/middleware.js';
import { adminRouter } from './http/routes/admin.js';
import { publicRouter } from './http/routes/public.js';
import { debugRouter } from './http/routes/debug.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Composition root. Everything environmental (clock, db, geo providers) is injectable for tests. */
export async function createApp(overrides = {}) {
  const config = overrides.config ?? loadConfig();
  const log = overrides.log ?? createLogger();
  const now = overrides.now ?? Date.now;
  const faults = overrides.faults ?? { geoA: false, geoB: false, email: false };

  const db = overrides.db ?? openDb(config.dbPath);
  migrate(db);
  const repos = createRepos(db);

  const rate = config.rate;
  const ipBucket = createTokenBucket({ capacity: rate.ipCapacity, refillPerSec: rate.ipRefillPerSec, now });
  const widgetLimiter = createTokenBucket({ capacity: rate.widgetCapacity, refillPerSec: rate.widgetRefillPerSec, now });
  const registerBucket = createTokenBucket({ capacity: rate.registerCapacity, refillPerSec: rate.registerRefillPerSec, now });

  const mock = config.geo.mode === 'mock';
  const geo = createGeoService({
    providers: withFaults(overrides.geoProviders ?? (mock ? mockProviders() : realProviders()), faults),
    timeoutMs: config.geo.timeoutMs,
    lookupIpOverride: config.geo.lookupIpOverride,
    skipPrivateCheck: mock, // mock providers don't touch the network, so localhost is fine
    log,
  });
  const mailer = overrides.mailer ?? (await createMailer({ smtpUrl: config.smtpUrl, from: config.mailFrom, faults, log }));

  const services = {
    auth: createAuthService({ repos, now }),
    widgets: createWidgetService({ repos, config, now }),
    submissions: createSubmissionService({ db, repos, geo, widgetLimiter, config, now, log }),
    dashboard: createDashboardService({ repos, now }),
  };
  const worker = createWorker({ repos, handlers: createJobHandlers({ repos, mailer }), now, config, log });
  const bundle = loadBundle();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(requestLogger(log, now));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/dashboard', (req, res) => res.sendFile(path.join(ROOT, 'demo', 'dashboard.html')));

  // Public surface (CORS) vs authenticated admin surface (no CORS) are mounted separately.
  app.use(['/widgets', '/submissions', '/widget.js', /^\/widget\.[a-f0-9]{8}\.js$/], publicCors);
  app.use(publicRouter({ services, ipBucket, bodyLimit: config.bodyLimit, bundle }));
  app.use('/api', adminRouter({ services, registerBucket, bodyLimit: config.bodyLimit }));
  if (config.faultInjection) app.use('/debug', debugRouter({ faults, config, jobs: repos.jobs }));

  app.use(notFoundHandler);
  app.use(errorHandler({ log, bodyLimit: config.bodyLimit }));

  return { app, db, repos, services, worker, faults, config, bundle };
}
