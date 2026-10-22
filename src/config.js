const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

function trustProxy(v) {
  if (v === undefined || v === '' || v === 'false') return false;
  if (v === 'true') return true;
  return /^\d+$/.test(v) ? Number(v) : false;
}

export function loadConfig(env = process.env) {
  const port = int(env.PORT, 3000);
  return {
    port,
    baseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    dbPath: env.DATABASE_PATH || './data/app.db',
    trustProxy: trustProxy(env.TRUST_PROXY),
    ipSalt: env.IP_HASH_SALT || 'dev-only-salt-change-me',
    bodyLimit: env.BODY_LIMIT || '10kb',
    rate: {
      ipCapacity: int(env.RATE_IP_CAPACITY, 10),
      ipRefillPerSec: num(env.RATE_IP_REFILL_PER_SEC, 2),
      widgetCapacity: int(env.RATE_WIDGET_CAPACITY, 60),
      widgetRefillPerSec: num(env.RATE_WIDGET_REFILL_PER_SEC, 5),
      registerCapacity: int(env.RATE_REGISTER_CAPACITY, 5),
      registerRefillPerSec: num(env.RATE_REGISTER_REFILL_PER_SEC, 0.05),
    },
    geo: {
      mode: env.GEO_MODE === 'mock' ? 'mock' : 'real',
      timeoutMs: int(env.GEO_TIMEOUT_MS, 1500),
      lookupIpOverride: env.GEO_LOOKUP_IP_OVERRIDE || '',
    },
    smtpUrl: env.SMTP_URL || '',
    mailFrom: env.MAIL_FROM || 'leads@example.com',
    jobs: {
      pollMs: int(env.JOB_POLL_MS, 1000),
      maxAttempts: int(env.JOB_MAX_ATTEMPTS, 3),
      backoffBaseMs: int(env.JOB_BACKOFF_BASE_MS, 2000),
    },
    faultInjection: bool(env.ENABLE_FAULT_INJECTION),
    faultToken: env.FAULT_INJECTION_TOKEN || '',
    seedOnBoot: bool(env.SEED_ON_BOOT),
    demoApiKey: env.DEMO_API_KEY || '',
  };
}
