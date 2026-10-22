// DATA LAYER: the only place that writes SQL. Every tenant-owned query takes tenantId
// and puts it in the WHERE clause, so isolation is enforced in the query itself.
const iso = (ms) => new Date(ms).toISOString();

export function createRepos(db) {
  const cache = new Map();
  const P = (sql) => {
    if (!cache.has(sql)) cache.set(sql, db.prepare(sql));
    return cache.get(sql);
  };

  const widgetRow = (r) =>
    r && {
      id: r.id,
      tenantId: r.tenant_id,
      type: r.type,
      title: r.title,
      description: r.description,
      buttonText: r.button_text,
      fields: JSON.parse(r.fields),
      display: JSON.parse(r.display),
      active: r.active === 1,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

  const submissionRow = (r) =>
    r && {
      id: r.id,
      widgetId: r.widget_id,
      tenantId: r.tenant_id,
      data: JSON.parse(r.data),
      origin: r.origin,
      geo: r.country ? { country: r.country, countryCode: r.country_code, region: r.region, city: r.city, provider: r.geo_provider } : null,
      createdAt: r.created_at,
      seq: r.seq,
    };

  return {
    tenants: {
      insert: (t) => P('INSERT INTO tenants (id, email, api_key_hash, created_at) VALUES (?,?,?,?)').run(t.id, t.email, t.apiKeyHash, t.createdAt),
      findByEmail: (email) => P('SELECT * FROM tenants WHERE email = ?').get(email),
      findByKeyHash: (h) => P('SELECT id, email FROM tenants WHERE api_key_hash = ?').get(h),
      findById: (id) => P('SELECT id, email FROM tenants WHERE id = ?').get(id),
      upsertDemo: (t) =>
        P(`INSERT INTO tenants (id, email, api_key_hash, created_at) VALUES (?,?,?,?)
           ON CONFLICT(email) DO UPDATE SET api_key_hash = excluded.api_key_hash`).run(t.id, t.email, t.apiKeyHash, t.createdAt),
    },

    widgets: {
      insert: (w) =>
        P(`INSERT INTO widgets (id, tenant_id, type, title, description, button_text, fields, display, active, version, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`).run(w.id, w.tenantId, w.type, w.title, w.description, w.buttonText, JSON.stringify(w.fields), JSON.stringify(w.display), w.active ? 1 : 0, w.now, w.now),
      upsertDemo: (w) =>
        P(`INSERT INTO widgets (id, tenant_id, type, title, description, button_text, fields, display, active, version, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,1,1,?,?) ON CONFLICT(id) DO NOTHING`).run(w.id, w.tenantId, w.type, w.title, w.description, w.buttonText, JSON.stringify(w.fields), JSON.stringify(w.display), w.now, w.now),
      listByTenant: (tenantId) => P('SELECT * FROM widgets WHERE tenant_id = ? ORDER BY created_at DESC, id').all(tenantId).map(widgetRow),
      findForTenant: (tenantId, id) => widgetRow(P('SELECT * FROM widgets WHERE id = ? AND tenant_id = ?').get(id, tenantId)),
      findById: (id) => widgetRow(P('SELECT * FROM widgets WHERE id = ?').get(id)),
      update: (tenantId, id, w) =>
        P(`UPDATE widgets SET type=?, title=?, description=?, button_text=?, fields=?, display=?, active=?, version=version+1, updated_at=?
           WHERE id=? AND tenant_id=?`).run(w.type, w.title, w.description, w.buttonText, JSON.stringify(w.fields), JSON.stringify(w.display), w.active ? 1 : 0, w.now, id, tenantId).changes,
      remove: (tenantId, id) => P('DELETE FROM widgets WHERE id = ? AND tenant_id = ?').run(id, tenantId).changes,
    },

    submissions: {
      insert: (s) =>
        P(`INSERT INTO submissions (id, widget_id, tenant_id, data, ip_hash, origin, country, country_code, region, city, geo_provider, idempotency_key, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.id, s.widgetId, s.tenantId, JSON.stringify(s.data), s.ipHash, s.origin, s.geo?.country ?? null, s.geo?.countryCode ?? null, s.geo?.region ?? null, s.geo?.city ?? null, s.geo?.provider ?? null, s.idempotencyKey, s.createdAt),
      findByIdempotencyKey: (widgetId, key) => P('SELECT id FROM submissions WHERE widget_id = ? AND idempotency_key = ?').get(widgetId, key),
      findInternal: (id) => submissionRow(P('SELECT * FROM submissions WHERE id = ?').get(id)),
      findForTenant: (tenantId, id) => submissionRow(P('SELECT * FROM submissions WHERE id = ? AND tenant_id = ?').get(id, tenantId)),
      list: ({ tenantId, widgetId, before, limit }) => {
        const where = ['tenant_id = ?'];
        const args = [tenantId];
        if (widgetId) { where.push('widget_id = ?'); args.push(widgetId); }
        if (before) { where.push('seq < ?'); args.push(before); }
        return P(`SELECT * FROM submissions WHERE ${where.join(' AND ')} ORDER BY seq DESC LIMIT ?`).all(...args, limit).map(submissionRow);
      },
    },

    blocked: {
      insert: (b) => P('INSERT INTO blocked_events (widget_id, tenant_id, reason, created_at) VALUES (?,?,?,?)').run(b.widgetId, b.tenantId, b.reason, b.createdAt),
    },

    jobs: {
      insert: (j) => P('INSERT INTO jobs (type, payload, run_at, created_at) VALUES (?,?,?,?)').run(j.type, JSON.stringify(j.payload), j.runAt, j.createdAt),
      claimDue: (nowMs, limit) => P("SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY id LIMIT ?").all(nowMs, limit),
      markDone: (id) => P("UPDATE jobs SET status = 'done', last_error = NULL WHERE id = ?").run(id),
      reschedule: (id, attempts, error, runAt) => P('UPDATE jobs SET attempts = ?, last_error = ?, run_at = ? WHERE id = ?').run(attempts, error, runAt, id),
      markFailed: (id, attempts, error) => P("UPDATE jobs SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?").run(attempts, error, id),
      counts: () => Object.fromEntries(P('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all().map((r) => [r.status, r.n])),
    },

    stats: {
      // Aggregations, all tenant-scoped. `days` bounds the window.
      summary: ({ tenantId, widgetId, days, nowMs }) => {
        const since = iso(nowMs - days * 86_400_000);
        const wf = widgetId ? ' AND widget_id = ?' : '';
        const a = widgetId ? [tenantId, since, widgetId] : [tenantId, since];
        return {
          since,
          total: P(`SELECT COUNT(*) AS n FROM submissions WHERE tenant_id = ? AND created_at >= ?${wf}`).get(...a).n,
          overTime: P(`SELECT substr(created_at,1,10) AS date, COUNT(*) AS count FROM submissions WHERE tenant_id = ? AND created_at >= ?${wf} GROUP BY date ORDER BY date`).all(...a),
          geo: P(`SELECT COALESCE(country,'Unknown') AS country, COUNT(*) AS count FROM submissions WHERE tenant_id = ? AND created_at >= ?${wf} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`).all(...a),
          perWidget: P(`SELECT w.id, w.title, COUNT(s.seq) AS count FROM widgets w
                        LEFT JOIN submissions s ON s.widget_id = w.id AND s.created_at >= ?
                        WHERE w.tenant_id = ?${widgetId ? ' AND w.id = ?' : ''} GROUP BY w.id ORDER BY count DESC, w.id`).all(...(widgetId ? [since, tenantId, widgetId] : [since, tenantId])),
          spamBlocked: P(`SELECT COUNT(*) AS n FROM blocked_events WHERE tenant_id = ? AND created_at >= ?${wf}`).get(...a).n,
        };
      },
    },
  };
}
