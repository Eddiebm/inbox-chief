/**
 * Small in-memory failure limiter with lockout.
 *
 * Used to stop short-code guessing on the voice-provisioning handoff: eight
 * characters from a 32-symbol alphabet is strong, but a code that redeems
 * straight into a session must not be guessable at network speed.
 *
 * Serverless instances are not shared, so this is a per-instance speed bump
 * rather than a global counter. That is still enough to make an online guessing
 * run impractical, and it needs no schema change to ship today.
 */

type Bucket = {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
};

export type RateLimiterOptions = {
  /** Failures allowed inside the window before lockout. */
  maxFailures: number;
  /** Sliding window for counting failures, in milliseconds. */
  windowMs: number;
  /** How long a locked key stays locked, in milliseconds. */
  lockoutMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export type RateLimitCheck =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export class FailureRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly options: Required<RateLimiterOptions>;

  constructor(options: RateLimiterOptions) {
    this.options = { now: () => Date.now(), ...options };
  }

  check(key: string): RateLimitCheck {
    const bucket = this.buckets.get(key);
    if (!bucket) return { allowed: true };
    const now = this.options.now();

    if (bucket.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((bucket.lockedUntil - now) / 1000),
      };
    }
    if (now - bucket.firstFailureAt > this.options.windowMs) {
      this.buckets.delete(key);
    }
    return { allowed: true };
  }

  recordFailure(key: string): RateLimitCheck {
    const now = this.options.now();
    const existing = this.buckets.get(key);
    const bucket =
      existing && now - existing.firstFailureAt <= this.options.windowMs
        ? existing
        : { failures: 0, firstFailureAt: now, lockedUntil: 0 };

    bucket.failures += 1;
    if (bucket.failures >= this.options.maxFailures) {
      bucket.lockedUntil = now + this.options.lockoutMs;
    }
    this.buckets.set(key, bucket);
    return this.check(key);
  }

  recordSuccess(key: string): void {
    this.buckets.delete(key);
  }

  reset(): void {
    this.buckets.clear();
  }
}

/** Best-effort client address from proxy headers, for keying the limiter. */
export function clientKeyFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}
