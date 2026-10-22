import { AppError } from '../errors.js';

/**
 * CORS for the PUBLIC surface only (config, widget script, submissions). Wildcard origin is
 * correct here: the endpoints are meant to be called from any site, use no cookies/credentials,
 * and are protected by validation + rate limiting instead. The admin API sends no CORS headers.
 * Runs before everything else so even 4xx/429/5xx responses carry the headers (otherwise the
 * browser would hide the real error behind a CORS failure).
 */
export function publicCors(req, res, next) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Retry-After, Idempotent-Replay, ETag',
  });
  if (req.method === 'OPTIONS') {
    res.set({
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
      'Access-Control-Max-Age': '86400',
    });
    return res.status(204).end();
  }
  next();
}

export function requireAuth(authService) {
  return (req, res, next) => {
    const tenant = authService.authenticate(req.get('authorization'));
    if (!tenant) {
      res.set('WWW-Authenticate', 'Bearer');
      throw new AppError(401, 'unauthorized', 'Missing or invalid API key');
    }
    req.tenant = tenant;
    next();
  };
}

export function bucketMiddleware(bucket, { code = 'rate_limited', message = 'Too many requests, slow down' } = {}) {
  return (req, res, next) => {
    const r = bucket.take(req.ip || 'unknown');
    res.set('RateLimit-Remaining', String(r.remaining));
    if (!r.ok) throw new AppError(429, code, message, { headers: { 'Retry-After': String(r.retryAfterSec) } });
    next();
  };
}

/** Express 4 does not catch rejected promises from async handlers; forward them to the error handler. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function requireJson(req, res, next) {
  if (!req.is('application/json')) throw new AppError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  next();
}

export const notFoundHandler = (req, res, next) => next(new AppError(404, 'not_found', `No route for ${req.method} ${req.path}`));

export function errorHandler({ log, bodyLimit }) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof AppError) {
      if (err.headers) res.set(err.headers);
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) } });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'payload_too_large', message: `Request body exceeds the ${bodyLimit} limit` } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
    if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: { code: 'bad_request', message: 'Bad request' } });
    log.error('unhandled error', { method: req.method, path: req.path, error: err.message, stack: err.stack });
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
  };
}

export function requestLogger(log, now = Date.now) {
  return (req, res, next) => {
    const start = now();
    res.on('finish', () => log.info('request', { method: req.method, path: req.path, status: res.statusCode, ms: now() - start }));
    next();
  };
}
