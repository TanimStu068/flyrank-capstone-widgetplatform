import express from 'express';
import { AppError } from '../../errors.js';

/** Fault injection, only mounted when ENABLE_FAULT_INJECTION=true. Lets a reviewer prove degradation. */
export function debugRouter({ faults, config, jobs }) {
  const r = express.Router();
  r.use((req, res, next) => {
    if (config.faultToken && req.get('x-fault-token') !== config.faultToken) throw new AppError(401, 'unauthorized', 'Bad fault token');
    next();
  });
  r.get('/faults', (req, res) => res.json({ faults, jobs: jobs.counts() }));
  r.post('/faults', express.json({ limit: '1kb' }), (req, res) => {
    const body = req.body ?? {};
    if (body.reset) Object.keys(faults).forEach((k) => { faults[k] = false; });
    for (const k of Object.keys(faults)) if (typeof body[k] === 'boolean') faults[k] = body[k];
    res.json({ faults });
  });
  return r;
}
