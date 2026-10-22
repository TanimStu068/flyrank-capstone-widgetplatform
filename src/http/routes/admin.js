import express from 'express';
import { AppError } from '../../errors.js';
import { bucketMiddleware, requireAuth, requireJson } from '../middleware.js';
import { listQuerySchema, registerSchema, statsQuerySchema, widgetCreateSchema, widgetUpdateSchema, zodDetails } from '../../services/validation.js';

const parse = (schema, input) => {
  const r = schema.safeParse(input);
  if (!r.success) throw new AppError(400, 'validation_failed', 'Request is invalid', { details: zodDetails(r.error) });
  return r.data;
};

/** Authenticated owner API: widget CRUD + dashboard. */
export function adminRouter({ services, registerBucket, bodyLimit }) {
  const r = express.Router();
  const json = [requireJson, express.json({ limit: bodyLimit })];

  r.post('/auth/register', bucketMiddleware(registerBucket, { message: 'Too many registrations from this address' }), ...json, (req, res) => {
    const { email } = parse(registerSchema, req.body);
    res.status(201).json({ ...services.auth.register(email), note: 'Store this API key now; it is not shown again.' });
  });

  r.use(requireAuth(services.auth));

  r.post('/widgets', ...json, (req, res) => res.status(201).json(services.widgets.create(req.tenant.id, parse(widgetCreateSchema, req.body))));
  r.get('/widgets', (req, res) => res.json({ items: services.widgets.list(req.tenant.id) }));
  r.get('/widgets/:id', (req, res) => res.json(services.widgets.get(req.tenant.id, req.params.id)));
  r.patch('/widgets/:id', ...json, (req, res) => res.json(services.widgets.update(req.tenant.id, req.params.id, parse(widgetUpdateSchema, req.body))));
  r.delete('/widgets/:id', (req, res) => { services.widgets.remove(req.tenant.id, req.params.id); res.status(204).end(); });
  r.get('/widgets/:id/snippet', (req, res) => {
    const w = services.widgets.get(req.tenant.id, req.params.id);
    res.json({ widgetId: w.id, snippet: w.snippet });
  });

  r.get('/submissions', (req, res) => res.json(services.dashboard.list(req.tenant.id, parse(listQuerySchema, req.query))));
  r.get('/submissions/:id', (req, res) => res.json(services.dashboard.get(req.tenant.id, req.params.id)));
  r.get('/stats', (req, res) => res.json(services.dashboard.stats(req.tenant.id, parse(statsQuerySchema, req.query))));

  return r;
}
