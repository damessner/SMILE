/**
 * Token-bucket limiter for inbound WebSocket messages.
 *
 * The HTTP rate limiter only sees requests; WebSocket frames bypass it entirely.
 * Each socket gets one bucket: it starts full (`burst` tokens), refills continuously
 * at `refillPerSecond`, and every inbound message consumes one token. An empty bucket
 * means the message is dropped (and, after repeated violations, the socket is closed
 * by the caller — see `live-sync.ts`).
 *
 * `nowMs` is injectable so tests can advance time deterministically instead of
 * sleeping.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly refillPerSecond: number,
    private readonly burst: number,
    nowMs: number = Date.now(),
  ) {
    this.tokens = burst;
    this.lastRefillMs = nowMs;
  }

  /** Consume one token if available. Returns false when the bucket is empty. */
  tryConsume(nowMs: number = Date.now()): boolean {
    const elapsedMs = Math.max(0, nowMs - this.lastRefillMs);
    if (elapsedMs > 0) {
      this.tokens = Math.min(this.burst, this.tokens + (elapsedMs / 1000) * this.refillPerSecond);
      this.lastRefillMs = nowMs;
    }

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}
