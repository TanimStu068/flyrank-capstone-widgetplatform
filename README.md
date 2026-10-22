# flyrank-capstone-widgetplatform

Embeddable widget & lead-capture platform. A customer defines a widget through an authenticated API, pastes **one
`<script>` line** into any website, and the backend safely catches whatever the public internet sends back:
validated, rate-limited, spam-filtered, geo-enriched, stored, and shown on an owner dashboard.

Built for the FlyRank Backend capstone. Node 22 · Express · SQLite (built-in `node:sqlite`) · zod · $0 stack.

## Architecture

```
 Widget Owner ──Bearer key──▶ /api/*  (widgets CRUD · snippet · submissions · stats)      no CORS
                                  │
                                  ▼
 Customer site (any origin)        routes ─▶ services ─▶ repos ─▶ SQLite
   <script src=".../widget.js?id=X">                │
        │  GET /widget.js ──302──▶ /widget.<hash>.js   (immutable, 1y cache)
        │  GET /widgets/X/config                       (max-age=60 + ETag/304)
        ▼
 Visitor ──POST /submissions (CORS + preflight)
        │  1 per-IP token bucket ........ flood?        ─▶ 429 + Retry-After
        │  2 content-type / 10kb limit .. bad/oversize? ─▶ 415 / 413
        │  3 validation (zod, per widget) bad payload?  ─▶ 400 JSON, never 500
        │  4 per-widget token bucket .... flood?        ─▶ 429
        │  5 spam: honeypot + link heuristic ───────────▶ 202, silently dropped
        │  6 idempotency-key replay ────────────────────▶ 200, same id
        │  7 geo: provider A ─(fail)▶ provider B ─(fail)▶ store with no geo
        │  8 ONE TRANSACTION: insert submission + enqueue email jobs ─▶ 201
        ▼
   Worker (background, retries + backoff, ALERT after max attempts) ─▶ email (console / Mailpit)
```

## Run it

**Docker (one command):**
```bash
docker compose up --build
```
| URL | What |
|---|---|
| http://localhost:5500 | demo "customer site" — a **different origin** that embeds the widget |
| http://localhost:3000/dashboard | tiny owner dashboard (paste API key `demo_key_local_only`) |
| http://localhost:8025 | Mailpit inbox with the confirmation emails |

Demo data is seeded on boot (`SEED_ON_BOOT=true`); `docker compose exec app npm run seed` re-runs it.

**Without Docker** (Node >= 22.13):
```bash
npm ci
cp .env.example .env          # set DEMO_API_KEY, GEO_MODE=mock, ENABLE_FAULT_INJECTION=true for the demo
npm run seed && npm start     # API on :3000
npm run site                  # customer site on :5500 (second terminal)
```

## Try it
```bash
KEY=demo_key_local_only
curl -s localhost:3000/api/widgets -H "Authorization: Bearer $KEY"                 # list widgets
curl -s localhost:3000/api/widgets/demo-widget/snippet -H "Authorization: Bearer $KEY"
curl -si localhost:3000/submissions -H 'Origin: http://localhost:5500' -H 'Content-Type: application/json' \
  -d '{"widgetId":"demo-widget","data":{"name":"Ada","email":"ada@example.com"}}'
curl -s localhost:3000/api/stats -H "Authorization: Bearer $KEY"
```
**Prove every requirement against a throwaway server:** `npm run prove` (transcript) and `npm test` (17 tests).

## API

Errors are always JSON: `{"error":{"code","message","details?"}}`.

### Owner API (header `Authorization: Bearer <apiKey>`; 401 otherwise)
| Method & path | Purpose |
|---|---|
| `POST /api/auth/register` `{email}` | create tenant; returns `apiKey` **once** (IP rate-limited) |
| `POST /api/widgets` | create widget `{type, title, description?, buttonText?, fields[], display?, active?}` -> 201 + `snippet` |
| `GET /api/widgets` · `GET/PATCH/DELETE /api/widgets/:id` | CRUD; another tenant's id gives 404 |
| `GET /api/widgets/:id/snippet` | the one-line embed |
| `GET /api/submissions?widgetId=&limit=&before=` | newest first, cursor pagination (`nextCursor`) |
| `GET /api/submissions/:id` | one submission incl. geo + provider |
| `GET /api/stats?widgetId=&days=` | `total`, `overTime`, `perWidget`, `geo`, `spamBlocked` |

### Public API (CORS `*`, no auth)
| Method & path | Purpose |
|---|---|
| `GET /widget.js?id=` | stable loader URL, 302 to the hashed bundle |
| `GET /widget.<hash>.js` | widget script, `Cache-Control: public, max-age=31536000, immutable` |
| `GET /widgets/:id/config` | widget config, `max-age=60`, `ETag`, 304 support, 404 if inactive/missing |
| `POST /submissions` | body `{widgetId, data:{...}, hp?}`; optional `Idempotency-Key` header |

`POST /submissions` results: `201 {ok,id}` stored · `200` idempotent replay · `202` spam dropped · `400` invalid ·
`404` unknown widget · `413` > 10 KB · `415` not JSON · `429` + `Retry-After`.

### Fault injection (only when `ENABLE_FAULT_INJECTION=true`)
`POST /debug/faults {"geoA":true}` / `{"geoB":true}` / `{"email":true}` / `{"reset":true}`; `GET /debug/faults`.
This is how a reviewer proves the fallback chain and the safe side effect. **Never enable in production.**

## Configuration
Every variable is in [`.env.example`](.env.example). Secrets live in `.env` (git-ignored); API keys are stored
hashed, IPs as salted hashes; the logger redacts `authorization`/`apiKey`/`token`/`smtp_url` fields.

## Limitations (honest)
- **SQLite, not Postgres.** The brief allows SQLite; SQL is isolated in `src/db/repos.js`, so moving to Postgres is a
  repo-layer swap. The worker claims jobs with a plain `SELECT`, which is correct for **one** process only; with
  several workers you would use `SELECT ... FOR UPDATE SKIP LOCKED`.
- **Rate-limit buckets live in process memory** — fine for one instance, not shared across replicas (use Redis).
- **`TRUST_PROXY=true` trusts a client-supplied `X-Forwarded-For`** (used for tests/proofs). In production set it to the
  real number of proxy hops, otherwise attackers can dodge per-IP limits.
- Geo lookups run inline on the request path (<= 1.5 s per provider) and are not cached. ip-api.com's free tier is
  HTTP-only, so visitor IPs travel unencrypted to that provider.
- Real geo providers were not exercised in automated tests (mock providers are used so proofs are deterministic).
- The widget UI is deliberately minimal (one form, Shadow DOM, honeypot). Only `signup`-style rendering exists; `cta` /
  `popover` are stored types with the same rendering.
- Stale bundle URLs (older than the current deploy) get the current code with a short cache rather than a 404.

## Layout
```
src/http/        routes + middleware (CORS, auth, errors)      src/services/   rules: validation, spam, geo, jobs, ...
src/db/          connection, migrations runner, repos (SQL)    migrations/     schema as SQL migrations
public/widget.js the embeddable script                         demo/           customer site + dashboard page
scripts/         seed, prove, serve-site                       test/           17 deterministic tests
```
