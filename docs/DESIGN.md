# Design doc (Phase 1)

**Problem.** Customers need to put a lead-capture form on any website with one `<script>` line, and safely receive
what the public internet sends back. The backend is hit directly by browsers it does not control, so it cannot trust
input, control traffic, or predict origins.

## Request paths (kept separate)
| Actor | Path | Properties |
|---|---|---|
| Owner | `/api/*` | Bearer API key, tenant-scoped, **no CORS** |
| Customer site | `GET /widget.js?id=` -> 302 -> `/widget.<hash>.js`; `GET /widgets/:id/config` | public, cached, CORS `*` |
| Visitor | `POST /submissions` | public, CORS + preflight, validated, rate-limited, spam-filtered |

## Layers
`routes (HTTP)` -> `services (logic)` -> `repos (SQL)`. Routes parse/serialise only; services hold rules and know
nothing about Express; repos are the only place SQL lives and always take `tenantId`.

## Data model (migrations/001_init.sql)
`tenants(api_key_hash)` 1-N `widgets(version, active)` 1-N `submissions(idempotency_key, geo_*)`;
`blocked_events` (dropped spam, for stats); `jobs` (transactional outbox for emails).
Indexes: `(tenant_id, seq DESC)`, `(widget_id, seq DESC)`, `(tenant_id, created_at)`, partial unique
`(widget_id, idempotency_key)`, `(status, run_at)` for the worker.

## Submission pipeline
IP token bucket -> content-type -> body size limit -> envelope validation -> widget lookup (404) -> per-widget bucket
(429) -> per-widget field validation (400) -> spam check (silent 202) -> idempotency replay -> geo chain (never throws)
-> **one transaction**: insert submission + enqueue email jobs -> 201. The worker sends mail later, with retries.

## Decisions
- **Stable loader URL, immutable bundle.** Customers paste `/widget.js?id=...` once; it 302s (5 min cache) to a
  content-hashed file cached for a year. Bug fixes reach customers without them editing their site.
- **Outbox instead of fire-and-forget.** A crash between "stored" and "email sent" can't lose the side effect, and
  an email failure can't touch the HTTP response.
- **Token bucket, not fixed window.** Bursts are allowed, sustained floods get 429, and clients recover smoothly.
- **404 not 403** for another tenant's resources, so existence is never confirmed.
- **API keys stored as SHA-256**, shown once. IPs stored only as salted hashes.

## Explicit non-goals
No form-builder UI, no real CDN/domain/hosting, no per-widget allowed-origin lists, no webhooks (email only),
no multi-instance rate limiting (buckets are in-process memory).
