export interface RateLimiter {
  allow(key: string, nowMs?: number): boolean | Promise<boolean>;
}

export interface DistributedRateLimitStore {
  increment(key: string, windowMs: number, limit: number, nowMs: number): Promise<boolean>;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly maxBuckets = 10_000,
  ) {}

  allow(key: string, nowMs = Date.now()): boolean {
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= nowMs) {
      if (!current && this.buckets.size >= this.maxBuckets) {
        for (const [candidateKey, bucket] of this.buckets) {
          if (bucket.resetAt <= nowMs) this.buckets.delete(candidateKey);
        }
        if (this.buckets.size >= this.maxBuckets) return false;
      }
      this.buckets.set(key, { count: 1, resetAt: nowMs + this.windowMs });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}

export class DistributedRateLimiter implements RateLimiter {
  constructor(
    private readonly store: DistributedRateLimitStore,
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, nowMs = Date.now()): Promise<boolean> {
    return this.store.increment(key, this.windowMs, this.limit, nowMs);
  }
}

/** @deprecated Use InMemoryRateLimiter. Kept for compatibility with the V1 boundary. */
export class FixedWindowRateLimiter extends InMemoryRateLimiter {}
