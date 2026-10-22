import crypto from 'node:crypto';
import { AppError } from '../errors.js';

export const hashApiKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

export function createAuthService({ repos, now }) {
  return {
    /** The raw API key is returned once and never stored; only its SHA-256 is. */
    register(email) {
      if (repos.tenants.findByEmail(email)) throw new AppError(409, 'email_taken', 'That email is already registered');
      const apiKey = `fr_live_${crypto.randomBytes(24).toString('base64url')}`;
      const tenantId = crypto.randomUUID();
      repos.tenants.insert({ id: tenantId, email, apiKeyHash: hashApiKey(apiKey), createdAt: new Date(now()).toISOString() });
      return { tenantId, apiKey };
    },
    authenticate(authorizationHeader) {
      const m = /^Bearer\s+(\S{10,200})$/i.exec(authorizationHeader || '');
      return m ? repos.tenants.findByKeyHash(hashApiKey(m[1])) ?? null : null;
    },
  };
}
