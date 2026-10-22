import crypto from 'node:crypto';
import { AppError } from '../errors.js';
import { isUniqueViolation, tx } from '../db/index.js';
import { buildDataSchema, submissionEnvelope, zodDetails } from './validation.js';
import { detectSpam } from './spam.js';

/**
 * Order of defences, cheapest first:
 *   (HTTP layer: per-IP bucket + body size limit + content-type)  ->
 *   envelope validation -> widget lookup (404) -> per-widget bucket (429) ->
 *   per-widget field validation (400) -> spam (silent drop) -> idempotency replay ->
 *   geo enrichment (never throws) -> store + enqueue jobs in ONE transaction.
 */
export function createSubmissionService({ db, repos, geo, widgetLimiter, config, now, log }) {
  const ipHash = (ip) => crypto.createHash('sha256').update(`${config.ipSalt}:${ip}`).digest('hex').slice(0, 32);

  async function submit({ body, ip, origin, idempotencyKey }) {
    const env = submissionEnvelope.safeParse(body);
    if (!env.success) throw new AppError(400, 'invalid_payload', 'Request body is invalid', { details: zodDetails(env.error) });
    const { widgetId, data, hp } = env.data;

    const widget = repos.widgets.findById(widgetId);
    if (!widget || !widget.active) throw new AppError(404, 'widget_not_found', 'Widget not found');

    const rl = widgetLimiter.take(widgetId);
    if (!rl.ok) throw new AppError(429, 'rate_limited', 'This widget is receiving too many submissions, retry shortly', { headers: { 'Retry-After': String(rl.retryAfterSec) } });

    const parsed = buildDataSchema(widget.fields).safeParse(data);
    if (!parsed.success) throw new AppError(400, 'validation_failed', 'One or more fields are invalid', { details: zodDetails(parsed.error).map((d) => ({ ...d, path: `data.${d.path}` })) });

    const spamReason = detectSpam({ hp, data: parsed.data });
    if (spamReason) {
      repos.blocked.insert({ widgetId, tenantId: widget.tenantId, reason: spamReason, createdAt: new Date(now()).toISOString() });
      log.info('spam dropped', { widgetId, reason: spamReason });
      return { dropped: true };
    }

    if (idempotencyKey) {
      const existing = repos.submissions.findByIdempotencyKey(widgetId, idempotencyKey);
      if (existing) return { id: existing.id, replay: true };
    }

    const enriched = await geo.enrich(ip); // null when every provider is down

    const id = crypto.randomUUID();
    const createdAt = new Date(now()).toISOString();
    try {
      tx(db, () => {
        repos.submissions.insert({
          id, widgetId, tenantId: widget.tenantId, data: parsed.data, ipHash: ip ? ipHash(ip) : null,
          origin: origin ? origin.slice(0, 200) : null, geo: enriched, idempotencyKey: idempotencyKey ?? null, createdAt,
        });
        // Outbox: the side effects are recorded atomically with the row but executed later by the worker.
        for (const type of ['email_visitor', 'email_owner']) {
          repos.jobs.insert({ type, payload: { submissionId: id }, runAt: now(), createdAt });
        }
      });
    } catch (err) {
      if (idempotencyKey && isUniqueViolation(err)) {
        const winner = repos.submissions.findByIdempotencyKey(widgetId, idempotencyKey); // lost a race with a retry
        if (winner) return { id: winner.id, replay: true };
      }
      throw err;
    }
    return { id, replay: false };
  }

  return { submit };
}
