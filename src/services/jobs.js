/**
 * Background worker over the `jobs` outbox table. Slow/unreliable work (email) runs here,
 * off the request path, with retries + exponential backoff. After maxAttempts the job is
 * marked failed and an ALERT line is logged. A failing job can never affect a submission.
 */
export function createWorker({ repos, handlers, now = Date.now, config, log }) {
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return 0;
    running = true;
    try {
      const due = repos.jobs.claimDue(now(), 10);
      for (const job of due) {
        try {
          const handler = handlers[job.type];
          if (!handler) throw new Error(`no handler for job type ${job.type}`);
          await handler(JSON.parse(job.payload));
          repos.jobs.markDone(job.id);
        } catch (err) {
          const attempts = job.attempts + 1;
          if (attempts >= config.jobs.maxAttempts) {
            repos.jobs.markFailed(job.id, attempts, err.message);
            log.error('ALERT: job permanently failed', { jobId: job.id, type: job.type, attempts, error: err.message });
          } else {
            repos.jobs.reschedule(job.id, attempts, err.message, now() + config.jobs.backoffBaseMs * 2 ** (attempts - 1));
            log.warn('job failed, will retry', { jobId: job.id, type: job.type, attempts, error: err.message });
          }
        }
      }
      return due.length;
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      timer = setInterval(() => tick().catch((e) => log.error('worker tick crashed', { error: e.message })), config.jobs.pollMs);
      timer.unref?.();
    },
    stop() { clearInterval(timer); },
  };
}

/** Handlers: one job per recipient so a retry never re-sends an email that already went out. */
export function createJobHandlers({ repos, mailer }) {
  const load = (submissionId) => {
    const sub = repos.submissions.findInternal(submissionId);
    if (!sub) return null;
    const widget = repos.widgets.findById(sub.widgetId);
    return widget ? { sub, widget } : null;
  };
  const summary = (widget, sub) => Object.entries(sub.data).map(([k, v]) => `${k}: ${v}`).join('\n') || '(no data)';

  return {
    async email_visitor({ submissionId }) {
      const ctx = load(submissionId);
      if (!ctx) return;
      const field = ctx.widget.fields.find((f) => f.type === 'email');
      const to = field && ctx.sub.data[field.name];
      if (!to) return;
      await mailer.send({ to, subject: `Thanks for reaching out: ${ctx.widget.title}`, text: `We received your submission to "${ctx.widget.title}". We'll be in touch.` });
    },
    async email_owner({ submissionId }) {
      const ctx = load(submissionId);
      if (!ctx) return;
      const owner = repos.tenants.findById(ctx.widget.tenantId);
      await mailer.send({ to: owner.email, subject: `New lead on "${ctx.widget.title}"`, text: summary(ctx.widget, ctx.sub) });
    },
  };
}
