import crypto from 'node:crypto';
import { AppError } from '../errors.js';

const notFound = () => new AppError(404, 'widget_not_found', 'Widget not found');

export function createWidgetService({ repos, config, now }) {
  const snippet = (id) => `<script src="${config.baseUrl}/widget.js?id=${id}" async></script>`;
  const view = (w) => ({
    id: w.id, type: w.type, title: w.title, description: w.description, buttonText: w.buttonText,
    fields: w.fields, display: w.display, active: w.active, version: w.version,
    createdAt: w.createdAt, updatedAt: w.updatedAt, snippet: snippet(w.id),
  });

  return {
    create(tenantId, input) {
      const id = crypto.randomBytes(8).toString('base64url').slice(0, 10);
      repos.widgets.insert({ id, tenantId, ...input, now: new Date(now()).toISOString() });
      return view(repos.widgets.findForTenant(tenantId, id));
    },
    list: (tenantId) => repos.widgets.listByTenant(tenantId).map(view),
    get(tenantId, id) {
      const w = repos.widgets.findForTenant(tenantId, id);
      if (!w) throw notFound(); // 404 (not 403): never confirm another tenant's widget exists
      return view(w);
    },
    update(tenantId, id, patch) {
      const current = repos.widgets.findForTenant(tenantId, id);
      if (!current) throw notFound();
      const merged = { ...current, ...patch, now: new Date(now()).toISOString() };
      repos.widgets.update(tenantId, id, merged);
      return view(repos.widgets.findForTenant(tenantId, id));
    },
    remove(tenantId, id) {
      if (!repos.widgets.remove(tenantId, id)) throw notFound();
    },
    /** Public, tenant-less view for the embed. Inactive widgets look like missing ones. */
    getPublic(id) {
      const w = repos.widgets.findById(id);
      if (!w || !w.active) return null;
      return {
        id: w.id, type: w.type, title: w.title, description: w.description, buttonText: w.buttonText,
        fields: w.fields, display: w.display, version: w.version, submitPath: '/submissions',
      };
    },
    snippet,
  };
}
