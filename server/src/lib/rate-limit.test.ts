import { describe, expect, it } from 'vitest';
import { rateLimitKey } from './rate-limit.js';

describe('rateLimitKey', () => {
  it('uses the verified account id for authenticated requests', () => {
    expect(rateLimitKey({ id: 'user-1' }, '10.0.0.1')).toBe('user:user-1');
    expect(rateLimitKey({ id: 'user-2' }, '10.0.0.1')).toBe('user:user-2');
  });

  it('uses the source IP when authentication did not populate a user', () => {
    expect(rateLimitKey(undefined, '10.0.0.1')).toBe('10.0.0.1');
    expect(rateLimitKey({ id: '' }, '10.0.0.1')).toBe('10.0.0.1');
  });
});
