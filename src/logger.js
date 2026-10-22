const SECRET_KEYS = /^(authorization|api[-_]?key|password|token|secret|smtp[-_]?url)$/i;

function redact(meta = {}) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : v;
  return out;
}

export function createLogger({ silent = false } = {}) {
  const emit = (level, msg, meta) => {
    if (silent) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...redact(meta) });
    (level === 'error' ? console.error : console.log)(line);
  };
  return {
    info: (m, x) => emit('info', m, x),
    warn: (m, x) => emit('warn', m, x),
    error: (m, x) => emit('error', m, x),
  };
}
