import { AppError } from '../errors.js';

export function createDashboardService({ repos, now }) {
  return {
    list(tenantId, { widgetId, before, limit }) {
      if (widgetId && !repos.widgets.findForTenant(tenantId, widgetId)) throw new AppError(404, 'widget_not_found', 'Widget not found');
      const rows = repos.submissions.list({ tenantId, widgetId, before, limit });
      const items = rows.map(({ seq, tenantId: _t, ...s }) => s);
      return { items, nextCursor: rows.length === limit ? rows[rows.length - 1].seq : null };
    },
    get(tenantId, id) {
      const s = repos.submissions.findForTenant(tenantId, id);
      if (!s) throw new AppError(404, 'submission_not_found', 'Submission not found');
      const { seq, tenantId: _t, ...rest } = s;
      return rest;
    },
    stats(tenantId, { widgetId, days }) {
      if (widgetId && !repos.widgets.findForTenant(tenantId, widgetId)) throw new AppError(404, 'widget_not_found', 'Widget not found');
      return { days, ...repos.stats.summary({ tenantId, widgetId, days, nowMs: now() }) };
    },
  };
}
