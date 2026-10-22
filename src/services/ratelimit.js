/**
 * Token bucket: `capacity` is the allowed burst, `refillPerSec` the sustained rate.
 * Unlike a fixed window it recovers smoothly: a client that bursts and gets 429s can
 * make a normal request again a fraction of a second later. Memory is bounded (LRU).
 */
export function createTokenBucket({ capacity, refillPerSec, now = Date.now, maxKeys = 50_000 }) {
  const buckets = new Map();
  return {
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (b) {
        b.tokens = Math.min(capacity, b.tokens + ((t - b.last) / 1000) * refillPerSec);
        b.last = t;
        buckets.delete(key); // re-insert => most recently used
      } else {
        b = { tokens: capacity, last: t };
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
      }
      buckets.set(key, b);
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
      }
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / refillPerSec)) };
    },
    size: () => buckets.size,
  };
}
