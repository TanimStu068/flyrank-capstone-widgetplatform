import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

export function fakeClock(start = Date.parse('2026-01-15T12:00:00Z')) {
  const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms; } };
  return c;
}

export const FIELDS = [
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
];

/** Boots a fully isolated app (in-memory DB, mock geo, silent logs, fake clock) on an ephemeral port. */
export async function startTestApp(configPatch = {}) {
  const clock = fakeClock();
  const base = loadConfig({});
  const config = {
    ...base, dbPath: ':memory:', trustProxy: true, baseUrl: 'http://api.test',
    geo: { ...base.geo, mode: 'mock' },
    jobs: { ...base.jobs, backoffBaseMs: 1000, maxAttempts: 3 },
    faultInjection: true,
    ...configPatch,
  };
  const ctx = await createApp({ config, now: clock.now, log: createLogger({ silent: true }) });
  const server = await new Promise((resolve) => { const s = ctx.app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;

  let ipCounter = 0;
  const call = (path, { method = 'GET', key, body, headers = {}, ip, raw } = {}) =>
    fetch(url + path, {
      method,
      headers: {
        ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        'x-forwarded-for': ip ?? `10.9.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`,
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });

  const register = async (email) => (await (await call('/api/auth/register', { method: 'POST', body: { email } })).json());
  const createWidget = async (key, extra = {}) =>
    (await (await call('/api/widgets', { method: 'POST', key, body: { type: 'signup', title: 'Join', fields: FIELDS, ...extra } })).json());

  return { ...ctx, url, clock, call, register, createWidget, close: () => new Promise((r) => { ctx.worker.stop(); server.close(r); ctx.db.close(); }) };
}
