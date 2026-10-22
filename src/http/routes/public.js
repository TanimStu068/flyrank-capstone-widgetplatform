import express from 'express';
import { AppError } from '../../errors.js';
import { bucketMiddleware, requireJson, wrap } from '../middleware.js';

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Public, unauthenticated surface used by embedded widgets on other origins. */
export function publicRouter({ services, ipBucket, bodyLimit, bundle }) {
  const r = express.Router();

  // ---- widget script: stable loader URL -> content-hashed immutable bundle ----
  r.get('/widget.js', (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.set({ 'Cache-Control': 'public, max-age=300', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.redirect(302, `/widget.${bundle.hash}.js${qs}`);
  });
  r.get(/^\/widget\.([a-f0-9]{8})\.js$/, (req, res) => {
    const isCurrent = req.params[0] === bundle.hash;
    res.set({
      'Content-Type': 'application/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // Hash in the URL => content can never change => cache for a year. A stale hash is answered
      // with the current code but only briefly cached, so we never pin wrong content as immutable.
      'Cache-Control': isCurrent ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      ETag: `"${bundle.hash}"`,
    });
    res.send(bundle.source);
  });

  // ---- widget config: small, short-lived cache, revalidated by ETag ----
  r.get('/widgets/:id/config', (req, res) => {
    const cfg = services.widgets.getPublic(req.params.id);
    if (!cfg) {
      res.set('Cache-Control', 'no-store');
      throw new AppError(404, 'widget_not_found', 'Widget not found');
    }
    res.set({
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      ETag: `W/"${cfg.id}-v${cfg.version}"`, // edits bump `version`, so the validator changes with the content
    });
    res.json(cfg); // Express answers 304 itself when If-None-Match matches
  });

  // ---- submission: IP bucket BEFORE parsing so floods are cheap to refuse ----
  r.post('/submissions', bucketMiddleware(ipBucket), requireJson, express.json({ limit: bodyLimit }), wrap(async (req, res) => {
    const key = req.get('idempotency-key');
    if (key !== undefined && !IDEMPOTENCY_KEY_RE.test(key)) throw new AppError(400, 'invalid_idempotency_key', 'Idempotency-Key must be 1-128 chars of [A-Za-z0-9_-]');
    const result = await services.submissions.submit({ body: req.body, ip: req.ip, origin: req.get('origin'), idempotencyKey: key });
    if (result.dropped) return res.status(202).json({ ok: true }); // looks like success to a bot
    if (result.replay) res.set('Idempotent-Replay', 'true');
    res.status(result.replay ? 200 : 201).json({ ok: true, id: result.id });
  }));

  return r;
}
