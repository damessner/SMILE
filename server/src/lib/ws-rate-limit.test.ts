import { describe, expect, it } from 'vitest';
import { TokenBucket } from './ws-rate-limit.js';

describe('TokenBucket', () => {
  it('allows exactly `burst` messages immediately after creation', () => {
    const bucket = new TokenBucket(10, 5, 0);
    for (let i = 0; i < 5; i += 1) {
      expect(bucket.tryConsume(0)).toBe(true);
    }
    expect(bucket.tryConsume(0)).toBe(false);
  });

  it('refills proportionally to elapsed time', () => {
    const bucket = new TokenBucket(10, 5, 0);
    for (let i = 0; i < 5; i += 1) bucket.tryConsume(0);

    // 100 ms at 10/s = 1 token.
    expect(bucket.tryConsume(100)).toBe(true);
    expect(bucket.tryConsume(100)).toBe(false);

    // 300 ms more = 3 tokens.
    expect(bucket.tryConsume(400)).toBe(true);
    expect(bucket.tryConsume(400)).toBe(true);
    expect(bucket.tryConsume(400)).toBe(true);
    expect(bucket.tryConsume(400)).toBe(false);
  });

  it('caps refill at the burst size after a long idle period', () => {
    const bucket = new TokenBucket(10, 3, 0);
    for (let i = 0; i < 3; i += 1) bucket.tryConsume(0);

    // A minute of idle time would refill 600 tokens; the cap is 3.
    expect(bucket.tryConsume(60_000)).toBe(true);
    expect(bucket.tryConsume(60_000)).toBe(true);
    expect(bucket.tryConsume(60_000)).toBe(true);
    expect(bucket.tryConsume(60_000)).toBe(false);
  });

  it('treats a backwards clock jump as no elapsed time', () => {
    const bucket = new TokenBucket(10, 1, 1_000);
    expect(bucket.tryConsume(1_000)).toBe(true);
    expect(bucket.tryConsume(500)).toBe(false);
  });
});
