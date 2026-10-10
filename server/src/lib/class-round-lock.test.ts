import { describe, expect, it } from 'vitest';
import {
  isClassRoundLocked,
} from './class-round-lock.js';

describe('isClassRoundLocked OR truth table', () => {
  it('returns false when neither global round nor class is locked', () => {
    expect(isClassRoundLocked(false, false)).toBe(false);
  });

  it('returns true when class lock is true, even if global round is false', () => {
    expect(isClassRoundLocked(false, true)).toBe(true);
  });

  it('returns true when global round is locked, even if class lock is false', () => {
    expect(isClassRoundLocked(true, false)).toBe(true);
  });

  it('returns true when both global round and class are locked', () => {
    expect(isClassRoundLocked(true, true)).toBe(true);
  });
});
