import crypto from 'node:crypto';
import { hashApiKey } from './services/auth.js';

export const DEMO_WIDGET_ID = 'demo-widget';

/** Idempotent demo data: one tenant with a known API key and one widget the demo page embeds. */
export function seedDemo({ repos, apiKey, now = Date.now }) {
  const ts = new Date(now()).toISOString();
  repos.tenants.upsertDemo({ id: crypto.randomUUID(), email: 'demo@example.com', apiKeyHash: hashApiKey(apiKey), createdAt: ts });
  const tenant = repos.tenants.findByEmail('demo@example.com');
  repos.widgets.upsertDemo({
    id: DEMO_WIDGET_ID, tenantId: tenant.id, type: 'signup', title: 'Join our newsletter',
    description: 'Get product updates, no spam.', buttonText: 'Subscribe',
    fields: [
      { name: 'name', label: 'Your name', type: 'text', required: true },
      { name: 'email', label: 'Email address', type: 'email', required: true },
      { name: 'message', label: 'Anything we should know?', type: 'textarea', required: false },
    ],
    display: { position: 'inline', accentColor: '#2563eb' }, now: ts,
  });
  return { tenantId: tenant.id, widgetId: DEMO_WIDGET_ID };
}
