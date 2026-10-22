import net from 'node:net';

export function normalizeIp(ip) {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function isPrivateIp(raw) {
  const ip = normalizeIp(raw);
  if (!net.isIP(ip)) return true;
  if (net.isIPv6(ip)) return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

async function getJson(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Provider A: ip-api.com (free tier is HTTP-only, 45 req/min, no key). */
const ipApi = {
  name: 'ip-api.com',
  async lookup(ip, { timeoutMs }) {
    const j = await getJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city`, timeoutMs);
    if (j.status !== 'success') throw new Error(j.message || 'lookup failed');
    return { country: j.country, countryCode: j.countryCode, region: j.regionName, city: j.city };
  },
};

/** Provider B: ipapi.co (free tier ~1000/day, no key). */
const ipapiCo = {
  name: 'ipapi.co',
  async lookup(ip, { timeoutMs }) {
    const j = await getJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, timeoutMs);
    if (j.error) throw new Error(j.reason || 'lookup failed');
    return { country: j.country_name, countryCode: j.country_code, region: j.region, city: j.city };
  },
};

export const realProviders = () => [ipApi, ipapiCo];

/** Deterministic providers whose answers differ, so you can see which one enriched a row. */
export const mockProviders = () => [
  { name: 'mock-A', async lookup() { return { country: 'Bangladesh', countryCode: 'BD', region: 'Chattogram', city: 'Chattogram' }; } },
  { name: 'mock-B', async lookup() { return { country: 'India', countryCode: 'IN', region: 'West Bengal', city: 'Kolkata' }; } },
];

/** Wrap providers so a shared `faults` object can switch them "down" at runtime. */
export function withFaults(providers, faults) {
  const keys = ['geoA', 'geoB'];
  return providers.map((p, i) => ({
    name: p.name,
    lookup: async (ip, opts) => {
      if (faults[keys[i]]) throw new Error(`${p.name} is down (fault injected)`);
      return p.lookup(ip, opts);
    },
  }));
}

const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Fallback chain: A, then B. enrich() NEVER throws: if every provider fails the caller
 * gets null and stores the submission without geo data. Degrade, never fail.
 */
export function createGeoService({ providers, timeoutMs, lookupIpOverride = '', skipPrivateCheck = false, log }) {
  return {
    async enrich(ip) {
      const target = lookupIpOverride || normalizeIp(ip);
      if (!skipPrivateCheck && (!target || isPrivateIp(target))) return null;
      for (const p of providers) {
        try {
          const geo = await withTimeout(p.lookup(target, { timeoutMs }), timeoutMs + 250);
          if (geo?.country) return { ...geo, provider: p.name };
          throw new Error('empty result');
        } catch (err) {
          log.warn('geo provider failed, trying next', { provider: p.name, error: err.message });
        }
      }
      log.warn('all geo providers failed; storing submission without geo');
      return null;
    },
  };
}
