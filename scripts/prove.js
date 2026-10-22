// Boots a throwaway server and replays the six acceptance probes over real HTTP, printing a
// transcript you can paste into EVIDENCE.md.   Usage: npm run prove
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  env: { ...process.env, PORT: String(PORT), PUBLIC_BASE_URL: BASE, DATABASE_PATH: path.join(dir, 'p.db'), GEO_MODE: 'mock',
         ENABLE_FAULT_INJECTION: 'true', TRUST_PROXY: 'true', JOB_POLL_MS: '200', JOB_BACKOFF_BASE_MS: '200', JOB_MAX_ATTEMPTS: '3' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let ipN = 0;
const freshIp = () => `192.0.2.${++ipN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = (title) => console.log(`\n=== ${title} ===`);

async function req(method, p, { body, headers = {}, ip = freshIp(), key, raw, show = [] } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}), 'x-forwarded-for': ip, ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* not json */ }
  const hdrs = show.map((k) => `${k}: ${res.headers.get(k)}`).join(' | ');
  console.log(`$ ${method} ${p}${body !== undefined && !raw ? '  ' + JSON.stringify(body).slice(0, 110) : ''}\n  -> ${res.status}${hdrs ? '  [' + hdrs + ']' : ''}  ${text.slice(0, 150)}`);
  return { res, json, status: res.status };
}

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch { await sleep(100); } }

  const reg = (await req('POST', '/api/auth/register', { body: { email: 'prove@example.com' } })).json;
  const key = reg.apiKey;
  const fields = [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }];
  const w = (await req('POST', '/api/widgets', { key, body: { type: 'signup', title: 'Prove', fields } })).json;
  const good = { widgetId: w.id, data: { name: 'Ada', email: 'ada@example.com' } };
  console.log('\nEmbed snippet:', w.snippet);

  h('PROBE 1: cross-origin POST (Origin: http://localhost:5500) -> stored, 2xx, visible via dashboard');
  await req('OPTIONS', '/submissions', { headers: { origin: 'http://localhost:5500', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,idempotency-key' }, show: ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'] });
  const sub = await req('POST', '/submissions', { body: good, headers: { origin: 'http://localhost:5500' }, show: ['access-control-allow-origin'] });
  await req('GET', `/api/submissions/${sub.json.id}`, { key });

  h('PROBE 2: malformed + oversized payloads -> clean 4xx JSON, never 500');
  await req('POST', '/submissions', { body: '{"widgetId": ', raw: true });
  await req('POST', '/submissions', { body: { widgetId: w.id, data: { name: 'A', email: 'nope' } } });
  await req('POST', '/submissions', { body: { widgetId: w.id, data: { name: 'x'.repeat(20000), email: 'a@b.co' } } });

  h('PROBE 3: burst from one IP -> 429s, then a normal request still succeeds');
  const burstIp = '203.0.113.50';
  const codes = [];
  for (let i = 0; i < 30; i++) codes.push((await fetch(BASE + '/submissions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': burstIp }, body: JSON.stringify(good) })).status);
  console.log('30 rapid requests from one IP -> statuses:', codes.join(' '));
  await req('POST', '/submissions', { body: good, ip: burstIp, show: ['retry-after'] });
  await req('POST', '/submissions', { body: good, ip: '198.51.100.77' });
  await sleep(1200);
  console.log('(after 1.2s refill) same attacker IP:');
  await req('POST', '/submissions', { body: good, ip: burstIp });

  h('PROBE 4: geo fallback chain');
  const geoOf = async (id) => (await fetch(`${BASE}/api/submissions/${id}`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.json())).geo;
  await req('POST', '/debug/faults', { body: { reset: true } });
  let s = await req('POST', '/submissions', { body: good });
  console.log('  geo of that row (both providers up):', JSON.stringify(await geoOf(s.json.id)));
  await req('POST', '/debug/faults', { body: { geoA: true } });
  s = await req('POST', '/submissions', { body: good });
  console.log('  geo with provider A DOWN:', JSON.stringify(await geoOf(s.json.id)));
  await req('POST', '/debug/faults', { body: { geoB: true } });
  s = await req('POST', '/submissions', { body: good });
  console.log('  geo with A and B DOWN:', JSON.stringify(await geoOf(s.json.id)), '(row stored anyway)');

  h('PROBE 5: email side effect forced to throw -> submission still succeeds');
  await sleep(800); // let earlier probes' email jobs drain so the counts below are only from this probe
  await req('POST', '/debug/faults', { body: { reset: true, email: true } });
  s = await req('POST', '/submissions', { body: good });
  await req('GET', `/api/submissions/${s.json.id}`, { key });
  await sleep(1800);
  await req('GET', '/debug/faults');
  console.log('  (jobs retried with backoff, then marked failed; see ALERT line in the server log below)');
  await req('POST', '/debug/faults', { body: { reset: true } });

  h('PROBE 6: honeypot filled like a bot -> silently dropped');
  await req('POST', '/submissions', { body: { ...good, hp: 'http://buy-pills.example' } });
  const stats = (await req('GET', `/api/stats?widgetId=${w.id}`, { key })).json;
  console.log('  stats.spamBlocked =', stats.spamBlocked);

  h('Dashboard stats (aggregations)');
  await req('GET', '/api/stats', { key });

  h('Server log excerpt (secrets redacted, ALERT for dead jobs)');
  const lines = serverLog.split('\n');
  const pick = (re, n) => lines.filter((l) => re.test(l)).slice(0, n);
  console.log([...pick(/ALERT/, 2), ...pick(/job failed, will retry/, 1), ...pick(/geo provider failed/, 2), ...pick(/all geo providers failed/, 1), ...pick(/spam dropped/, 1)].join('\n'));
} finally {
  server.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
}
