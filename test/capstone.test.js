import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';

let t, alice, bob, widget;
const good = (id, extra = {}) => ({ widgetId: id, data: { name: 'Ada', email: 'ada@example.com' }, ...extra });

before(async () => {
  t = await startTestApp();
  alice = await t.register('alice@example.com');
  bob = await t.register('bob@example.com');
  widget = await t.createWidget(alice.apiKey);
});
after(() => t.close());

// ---------- widget management + tenant isolation ----------
test('admin API rejects missing/invalid auth with 401', async () => {
  assert.equal((await t.call('/api/widgets')).status, 401);
  assert.equal((await t.call('/api/widgets', { key: 'fr_live_nope_nope_nope' })).status, 401);
});

test('widget CRUD works and returns the embed snippet', async () => {
  assert.equal(widget.snippet, `<script src="http://api.test/widget.js?id=${widget.id}" async></script>`);
  const upd = await (await t.call(`/api/widgets/${widget.id}`, { method: 'PATCH', key: alice.apiKey, body: { title: 'Join us' } })).json();
  assert.equal(upd.title, 'Join us');
  assert.equal(upd.version, 2);
  const bad = await t.call('/api/widgets', { method: 'POST', key: alice.apiKey, body: { type: 'nope', title: '', fields: [] } });
  assert.equal(bad.status, 400);
});

test('tenant isolation: bob cannot read, edit, delete or list alice\'s widget or submissions', async () => {
  const sub = await (await t.call('/submissions', { method: 'POST', body: good(widget.id) })).json();
  assert.equal((await t.call(`/api/widgets/${widget.id}`, { key: bob.apiKey })).status, 404);
  assert.equal((await t.call(`/api/widgets/${widget.id}`, { method: 'PATCH', key: bob.apiKey, body: { title: 'pwn' } })).status, 404);
  assert.equal((await t.call(`/api/widgets/${widget.id}`, { method: 'DELETE', key: bob.apiKey })).status, 404);
  assert.equal((await t.call(`/api/submissions/${sub.id}`, { key: bob.apiKey })).status, 404);
  assert.equal((await t.call(`/api/submissions?widgetId=${widget.id}`, { key: bob.apiKey })).status, 404);
  assert.deepEqual((await (await t.call('/api/widgets', { key: bob.apiKey })).json()).items, []);
  assert.deepEqual((await (await t.call('/api/submissions', { key: bob.apiKey })).json()).items, []);
  assert.equal((await t.call(`/api/widgets/${widget.id}`, { key: alice.apiKey })).status, 200);
});

// ---------- delivery ----------
test('config endpoint: small payload, cache headers, ETag 304, no tenant leakage', async () => {
  const res = await t.call(`/widgets/${widget.id}/config`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /max-age=60/);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const body = await res.json();
  assert.equal(body.tenantId, undefined);
  assert.ok(JSON.stringify(body).length < 2000);
  const again = await t.call(`/widgets/${widget.id}/config`, { headers: { 'if-none-match': res.headers.get('etag'), 'cache-control': 'max-age=0' } });
  assert.equal(again.status, 304);
  assert.equal((await t.call('/widgets/doesnotexist/config')).status, 404);
});

test('widget script is a content-hashed immutable bundle; /widget.js redirects to it', async () => {
  const loader = await fetch(`${t.url}/widget.js?id=${widget.id}`, { redirect: 'manual' });
  assert.equal(loader.status, 302);
  const loc = loader.headers.get('location');
  assert.match(loc, new RegExp(`^/widget\\.${t.bundle.hash}\\.js\\?id=${widget.id}$`));
  assert.match(loader.headers.get('cache-control'), /max-age=300/);
  const js = await fetch(t.url + loc);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('cache-control'), /max-age=31536000, immutable/);
  assert.match(js.headers.get('content-type'), /javascript/);
});

// ---------- CORS ----------
test('CORS preflight (OPTIONS) is answered with the right headers', async () => {
  const res = await t.call('/submissions', { method: 'OPTIONS', headers: { origin: 'http://localhost:5500', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,idempotency-key' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
  assert.match(res.headers.get('access-control-allow-headers'), /Idempotency-Key/i);
});

test('error responses (4xx) still carry CORS headers so the browser can read them', async () => {
  const res = await t.call('/submissions', { method: 'POST', body: { nope: 1 }, headers: { origin: 'http://localhost:5500' } });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

// ---------- validation ----------
test('malformed / invalid / oversized payloads give clean 4xx JSON, never 500', async () => {
  const cases = [
    ['malformed JSON', { body: '{"widgetId": ', raw: true, headers: { 'content-type': 'application/json' } }, 400],
    ['array body', { body: '[1,2]', raw: true, headers: { 'content-type': 'application/json' } }, 400],
    ['missing widgetId', { body: { data: {} } }, 400],
    ['unknown widget', { body: good('nope-nope') }, 404],
    ['bad email', { body: { widgetId: widget.id, data: { name: 'A', email: 'not-an-email' } } }, 400],
    ['missing required', { body: { widgetId: widget.id, data: { email: 'a@b.co' } } }, 400],
    ['unknown field', { body: { widgetId: widget.id, data: { name: 'A', email: 'a@b.co', admin: true } } }, 400],
    ['wrong type', { body: { widgetId: widget.id, data: { name: 123, email: 'a@b.co' } } }, 400],
    ['too-long field', { body: { widgetId: widget.id, data: { name: 'x'.repeat(500), email: 'a@b.co' } } }, 400],
    ['bad idempotency key', { body: good(widget.id), headers: { 'idempotency-key': 'bad key!' } }, 400],
    ['oversized body', { body: { widgetId: widget.id, data: { name: 'x'.repeat(20_000), email: 'a@b.co' } } }, 413],
    ['wrong content-type', { body: 'x=1', raw: true, headers: { 'content-type': 'text/plain' } }, 415],
  ];
  for (const [label, opts, status] of cases) {
    const res = await t.call('/submissions', { method: 'POST', ...opts });
    assert.equal(res.status, status, label);
    assert.ok((res.headers.get('content-type') || '').includes('application/json'), `${label}: JSON error body`);
    assert.ok((await res.json()).error.code, `${label}: has error.code`);
  }
});

// ---------- happy path, dashboard, idempotency ----------
test('valid cross-origin submission is stored, enriched, and visible in the dashboard', async () => {
  const res = await t.call('/submissions', { method: 'POST', body: good(widget.id), headers: { origin: 'http://localhost:5500' } });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const row = await (await t.call(`/api/submissions/${id}`, { key: alice.apiKey })).json();
  assert.equal(row.widgetId, widget.id);
  assert.equal(row.origin, 'http://localhost:5500');
  assert.equal(row.geo.provider, 'mock-A');
  const stats = await (await t.call('/api/stats', { key: alice.apiKey })).json();
  assert.ok(stats.total >= 1);
  assert.equal(stats.perWidget[0].id, widget.id);
  assert.equal(stats.geo[0].country, 'Bangladesh');
});

test('Idempotency-Key: a retried submission is stored exactly once', async () => {
  const w = await t.createWidget(alice.apiKey, { title: 'Idem' });
  const hdr = { 'idempotency-key': 'attempt-123' };
  const a = await t.call('/submissions', { method: 'POST', body: good(w.id), headers: hdr });
  const b = await t.call('/submissions', { method: 'POST', body: good(w.id), headers: hdr });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.headers.get('idempotent-replay'), 'true');
  assert.equal((await a.json()).id, (await b.json()).id);
  const list = await (await t.call(`/api/submissions?widgetId=${w.id}`, { key: alice.apiKey })).json();
  assert.equal(list.items.length, 1);
});

// ---------- abuse protection ----------
test('burst from one IP -> 429s with Retry-After; other IPs unaffected; recovers after refill', async () => {
  const w = await t.createWidget(alice.apiKey, { title: 'Burst' });
  const attacker = '203.0.113.7';
  const statuses = [];
  for (let i = 0; i < 25; i++) statuses.push((await t.call('/submissions', { method: 'POST', body: good(w.id), ip: attacker })).status);
  assert.ok(statuses.includes(429), 'some requests were rate limited');
  assert.equal(statuses.slice(0, 10).filter((s) => s === 201).length, 10, 'burst capacity honoured');
  const limited = await t.call('/submissions', { method: 'POST', body: good(w.id), ip: attacker });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.equal(limited.headers.get('access-control-allow-origin'), '*');
  assert.equal((await t.call('/submissions', { method: 'POST', body: good(w.id), ip: '198.51.100.9' })).status, 201, 'legit visitor unaffected');
  t.clock.advance(1500);
  assert.equal((await t.call('/submissions', { method: 'POST', body: good(w.id), ip: attacker })).status, 201, 'attacker recovers after refill');
});

test('per-widget limit protects one widget from a distributed flood', async () => {
  const w = await t.createWidget(alice.apiKey, { title: 'Distributed' });
  let limited = 0;
  for (let i = 0; i < 80; i++) {
    const res = await t.call('/submissions', { method: 'POST', body: good(w.id) }); // a fresh IP every time
    if (res.status === 429) limited++;
  }
  assert.ok(limited > 0, 'widget bucket kicked in');
});

test('honeypot: a bot-filled hidden field is silently dropped and counted', async () => {
  const w = await t.createWidget(alice.apiKey, { title: 'Honeypot' });
  const res = await t.call('/submissions', { method: 'POST', body: good(w.id, { hp: 'http://spam.example' }) });
  assert.equal(res.status, 202);
  assert.equal((await t.call(`/api/submissions?widgetId=${w.id}`, { key: alice.apiKey }).then((r) => r.json())).items.length, 0);
  const stats = await (await t.call(`/api/stats?widgetId=${w.id}`, { key: alice.apiKey })).json();
  assert.equal(stats.spamBlocked, 1);
});

test('heuristic: link-stuffed messages are dropped', async () => {
  const w = await t.createWidget(alice.apiKey, { title: 'Links', fields: [...[{ name: 'msg', label: 'Msg', type: 'textarea', required: true }]] });
  const res = await t.call('/submissions', { method: 'POST', body: { widgetId: w.id, data: { msg: 'http://a.io http://b.io http://c.io buy now' } } });
  assert.equal(res.status, 202);
  assert.equal((await (await t.call(`/api/submissions?widgetId=${w.id}`, { key: alice.apiKey })).json()).items.length, 0);
});

// ---------- enrichment fallback chain ----------
test('geo: A down -> B enriches; both down -> stored without geo', async () => {
  const w = await t.createWidget(alice.apiKey, { title: 'Geo' });
  const submit = async () => (await (await t.call('/submissions', { method: 'POST', body: good(w.id) })).json()).id;
  const geoOf = async (id) => (await (await t.call(`/api/submissions/${id}`, { key: alice.apiKey })).json()).geo;

  t.faults.geoA = true;
  assert.equal((await geoOf(await submit())).provider, 'mock-B');
  t.faults.geoB = true;
  const res = await t.call('/submissions', { method: 'POST', body: good(w.id) });
  assert.equal(res.status, 201, 'still succeeds with every provider down');
  assert.equal(await geoOf((await res.json()).id), null);
  t.faults.geoA = t.faults.geoB = false;
  assert.equal((await geoOf(await submit())).provider, 'mock-A');
});

// ---------- safe side effects ----------
test('failing email never affects the submission; worker retries then raises an alert', async () => {
  const w = await t.createWidget(alice.apiKey, { title: 'Mail' });
  t.faults.email = true;
  const res = await t.call('/submissions', { method: 'POST', body: good(w.id) });
  assert.equal(res.status, 201, 'submission succeeds although email is down');
  const { id } = await res.json();
  assert.equal((await t.call(`/api/submissions/${id}`, { key: alice.apiKey })).status, 200, 'row is stored');

  await t.worker.tick(); // attempt 1 fails -> rescheduled
  assert.ok(t.repos.jobs.counts().pending >= 2);
  t.clock.advance(1_500); await t.worker.tick(); // attempt 2
  t.clock.advance(3_000); await t.worker.tick(); // attempt 3 -> permanently failed
  assert.ok(t.repos.jobs.counts().failed >= 2, 'jobs ended in failed state (alert logged)');

  t.faults.email = false; // service recovers: new submissions are mailed fine
  const ok = await t.call('/submissions', { method: 'POST', body: good(w.id) });
  assert.equal(ok.status, 201);
  t.clock.advance(60_000);
  await t.worker.tick();
  assert.ok(t.repos.jobs.counts().done >= 2);
});

test('unknown routes return a JSON 404', async () => {
  const res = await t.call('/nope');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'not_found');
});
