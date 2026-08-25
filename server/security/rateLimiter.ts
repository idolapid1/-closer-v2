export class FixedWindowRateLimiter {
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
