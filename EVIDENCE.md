# EVIDENCE

One proof per Requirements checkbox (brief, Section 6). Everything below was produced by running the code in this
repo: `npm test` (17 tests, all passing) and `npm run prove` (real HTTP against a booted server, transcript at the
bottom). Re-run both yourself; they are deterministic (mock geo, fake clock in tests).

| # | Requirement | Proof |
|---|---|---|
| 1 | Authenticated CRUD; no/invalid auth rejected | test *"admin API rejects missing/invalid auth with 401"*, *"widget CRUD works..."*; transcript: register + create widget |
| 2 | Tenant isolation | test *"tenant isolation: bob cannot read, edit, delete or list alice's widget or submissions"* (404 on every cross-tenant access; empty lists) |
| 3 | Embed snippet per widget | test *"widget CRUD ... returns the embed snippet"*; transcript line `Embed snippet: <script src=".../widget.js?id=..." async></script>` |
| 4 | Config endpoint: small payload + cache headers | test *"config endpoint: small payload, cache headers, ETag 304..."* (`Cache-Control: public, max-age=60`, `ETag`, 304 on revalidate) |
| 5 | Versioned bundle | test *"widget script is a content-hashed immutable bundle..."* (`/widget.js` -> 302 -> `/widget.<hash>.js`, `max-age=31536000, immutable`) |
| 6 | Widget renders from a different origin | `demo/customer-site/index.html` on :5500 loads the script from :3000 (see **Manual check** below) |
| 7 | CORS + preflight | tests *"CORS preflight..."*, *"error responses (4xx) still carry CORS headers"*; PROBE 1 transcript (OPTIONS -> 204 + Allow-* headers) |
| 8 | Malformed/oversized -> 4xx JSON, never 500 | test *"malformed / invalid / oversized payloads give clean 4xx JSON, never 500"* (12 cases); PROBE 2 transcript (400 / 400 / 413) |
| 9 | Valid submission stored, linked to widget + tenant | test *"valid cross-origin submission is stored, enriched, and visible in the dashboard"*; PROBE 1 transcript |
| 10 | Rate limit -> 429, API keeps serving | tests *"burst from one IP..."*, *"per-widget limit..."*; PROBE 3: `201 x10` then `429 x20`, other IP `201`, same IP `201` after 1.2 s |
| 11 | >= 1 spam control blocks spam | tests *"honeypot..."*, *"heuristic: link-stuffed..."*; PROBE 6 (`202`, nothing stored, `spamBlocked = 1`) |
| 12 | Geo fallback: A down -> B enriches | test *"geo: A down -> B enriches..."*; PROBE 4 (`provider: mock-B`) |
| 13 | All providers down -> still succeeds without geo | same test; PROBE 4 (`201`, `geo: null`) |
| 14 | Failing email/webhook doesn't block the submission | test *"failing email never affects the submission..."*; PROBE 5 (`201`, row readable, jobs retried then `ALERT`) |
| 15 | README + required files | `README.md`, `capstone.yaml`, `EVIDENCE.md`, `BUILDLOG.md`, `.env.example`, `docs/DESIGN.md` present |

Shared requirements: layered architecture (`src/http` -> `src/services` -> `src/db`) · boundary validation (zod) ·
background job (outbox worker with retries + ALERT) · migrations + indexes + tenant-scoped queries ·
idempotency (test *"Idempotency-Key: a retried submission is stored exactly once"*) · secrets in env only, keys hashed,
logger redacts.

## Manual check: widget in a real browser — NOT yet done
The widget script (`public/widget.js`) passes `node --check` and its network contract is exercised by the tests
above, but it was **not** rendered in a real browser while building this. Do this once and paste a screenshot or
note here:
1. `docker compose up --build`
2. open http://localhost:5500, confirm the form renders, submit it, open http://localhost:3000/dashboard
   (key `demo_key_local_only`) and confirm the row appears; check DevTools > Network shows the `OPTIONS` preflight.

## `npm test`
```
ok 1 - admin API rejects missing/invalid auth with 401
ok 2 - widget CRUD works and returns the embed snippet
ok 3 - tenant isolation: bob cannot read, edit, delete or list alice's widget or submissions
ok 4 - config endpoint: small payload, cache headers, ETag 304, no tenant leakage
ok 5 - widget script is a content-hashed immutable bundle; /widget.js redirects to it
ok 6 - CORS preflight (OPTIONS) is answered with the right headers
ok 7 - error responses (4xx) still carry CORS headers so the browser can read them
ok 8 - malformed / invalid / oversized payloads give clean 4xx JSON, never 500
ok 9 - valid cross-origin submission is stored, enriched, and visible in the dashboard
ok 10 - Idempotency-Key: a retried submission is stored exactly once
ok 11 - burst from one IP -> 429s with Retry-After; other IPs unaffected; recovers after refill
ok 12 - per-widget limit protects one widget from a distributed flood
ok 13 - honeypot: a bot-filled hidden field is silently dropped and counted
ok 14 - heuristic: link-stuffed messages are dropped
ok 15 - geo: A down -> B enriches; both down -> stored without geo
ok 16 - failing email never affects the submission; worker retries then raises an alert
ok 17 - unknown routes return a JSON 404
# tests 17
# pass 17
# fail 0
```

## `npm run prove` transcript
```
$ POST /api/auth/register  {"email":"prove@example.com"}
  -> 201  {"tenantId":"86eb5659-c7c3-42db-a841-ac7f64fe9a27","apiKey":"fr_live_9eh-t-x1_41_0-HXw3ls2KMJj5czA6Kp","note":"Store this API key now; it is not shown
$ POST /api/widgets  {"type":"signup","title":"Prove","fields":[{"name":"name","label":"Name","type":"text","required":true},{"name
  -> 201  {"id":"fahkRqtduh","type":"signup","title":"Prove","description":"","buttonText":"Submit","fields":[{"name":"name","label":"Name","type":"text","requi

Embed snippet: <script src="http://localhost:3199/widget.js?id=fahkRqtduh" async></script>

=== PROBE 1: cross-origin POST (Origin: http://localhost:5500) -> stored, 2xx, visible via dashboard ===
$ OPTIONS /submissions
  -> 204  [access-control-allow-origin: * | access-control-allow-methods: GET, POST, OPTIONS | access-control-allow-headers: Content-Type, Idempotency-Key]  
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"}}
  -> 201  [access-control-allow-origin: *]  {"ok":true,"id":"d3f67256-3485-4c17-9f6d-95c69e925c06"}
$ GET /api/submissions/d3f67256-3485-4c17-9f6d-95c69e925c06
  -> 200  {"id":"d3f67256-3485-4c17-9f6d-95c69e925c06","widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"},"origin":"http://localhost:5500",

=== PROBE 2: malformed + oversized payloads -> clean 4xx JSON, never 500 ===
$ POST /submissions
  -> 400  {"error":{"code":"invalid_json","message":"Request body is not valid JSON"}}
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"A","email":"nope"}}
  -> 400  {"error":{"code":"validation_failed","message":"One or more fields are invalid","details":[{"path":"data.email","message":"Invalid email"}]}}
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  -> 413  {"error":{"code":"payload_too_large","message":"Request body exceeds the 10kb limit"}}

=== PROBE 3: burst from one IP -> 429s, then a normal request still succeeds ===
30 rapid requests from one IP -> statuses: 201 201 201 201 201 201 201 201 201 201 429 429 429 429 429 429 429 429 429 429 429 429 429 429 429 429 429 429 429 429
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"}}
  -> 429  [retry-after: 1]  {"error":{"code":"rate_limited","message":"Too many requests, slow down"}}
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"}}
  -> 201  {"ok":true,"id":"f9669107-044c-4609-ac7d-bf158b3b4b94"}
(after 1.2s refill) same attacker IP:
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"}}
  -> 201  {"ok":true,"id":"d81995e4-2bb3-493b-9064-f7739422f946"}

=== PROBE 4: geo fallback chain ===
$ POST /debug/faults  {"reset":true}
  -> 200  {"faults":{"geoA":false,"geoB":false,"email":false}}
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"}}
  -> 201  {"ok":true,"id":"074786a3-51a7-4c7b-b673-8371bd34f318"}
  geo of that row (both providers up): {"country":"Bangladesh","countryCode":"BD","region":"Chattogram","city":"Chattogram","provider":"mock-A"}
$ POST /debug/faults  {"geoA":true}
  -> 200  {"faults":{"geoA":true,"geoB":false,"email":false}}
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"}}
  -> 201  {"ok":true,"id":"06d4c8f4-2787-49f3-8549-ce7d3b22cae6"}
  geo with provider A DOWN: {"country":"India","countryCode":"IN","region":"West Bengal","city":"Kolkata","provider":"mock-B"}
$ POST /debug/faults  {"geoB":true}
  -> 200  {"faults":{"geoA":true,"geoB":true,"email":false}}
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"}}
  -> 201  {"ok":true,"id":"c23916aa-af95-4741-912f-d9613ac7ceb0"}
  geo with A and B DOWN: null (row stored anyway)

=== PROBE 5: email side effect forced to throw -> submission still succeeds ===
$ POST /debug/faults  {"reset":true,"email":true}
  -> 200  {"faults":{"geoA":false,"geoB":false,"email":true}}
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"}}
  -> 201  {"ok":true,"id":"f6a72859-9d62-407b-a729-e8ba635aeb51"}
$ GET /api/submissions/f6a72859-9d62-407b-a729-e8ba635aeb51
  -> 200  {"id":"f6a72859-9d62-407b-a729-e8ba635aeb51","widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"},"origin":null,"geo":{"country":"B
$ GET /debug/faults
  -> 200  {"faults":{"geoA":false,"geoB":false,"email":true},"jobs":{"done":32,"failed":2}}
  (jobs retried with backoff, then marked failed; see ALERT line in the server log below)
$ POST /debug/faults  {"reset":true}
  -> 200  {"faults":{"geoA":false,"geoB":false,"email":false}}

=== PROBE 6: honeypot filled like a bot -> silently dropped ===
$ POST /submissions  {"widgetId":"fahkRqtduh","data":{"name":"Ada","email":"ada@example.com"},"hp":"http://buy-pills.example"}
  -> 202  {"ok":true}
$ GET /api/stats?widgetId=fahkRqtduh
  -> 200  {"days":30,"since":"2026-09-22T05:43:45.613Z","total":17,"overTime":[{"date":"2026-10-22","count":17}],"geo":[{"country":"Bangladesh","count":15},{"co
  stats.spamBlocked = 1

=== Dashboard stats (aggregations) ===
$ GET /api/stats
  -> 200  {"days":30,"since":"2026-09-22T05:43:45.619Z","total":17,"overTime":[{"date":"2026-10-22","count":17}],"geo":[{"country":"Bangladesh","count":15},{"co

=== Server log excerpt (secrets redacted, ALERT for dead jobs) ===
{"ts":"2026-10-22T05:43:44.462Z","level":"error","msg":"ALERT: job permanently failed","jobId":33,"type":"email_visitor","attempts":3,"error":"mail transport down (fault injected)"}
{"ts":"2026-10-22T05:43:44.463Z","level":"error","msg":"ALERT: job permanently failed","jobId":34,"type":"email_owner","attempts":3,"error":"mail transport down (fault injected)"}
{"ts":"2026-10-22T05:43:43.859Z","level":"warn","msg":"job failed, will retry","jobId":33,"type":"email_visitor","attempts":1,"error":"mail transport down (fault injected)"}
{"ts":"2026-10-22T05:43:42.960Z","level":"warn","msg":"geo provider failed, trying next","provider":"mock-A","error":"mock-A is down (fault injected)"}
{"ts":"2026-10-22T05:43:42.973Z","level":"warn","msg":"geo provider failed, trying next","provider":"mock-A","error":"mock-A is down (fault injected)"}
{"ts":"2026-10-22T05:43:42.973Z","level":"warn","msg":"all geo providers failed; storing submission without geo"}
{"ts":"2026-10-22T05:43:45.608Z","level":"info","msg":"spam dropped","widgetId":"fahkRqtduh","reason":"honeypot"}
```
