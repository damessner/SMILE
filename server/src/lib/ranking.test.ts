import { describe, expect, it } from 'vitest';
import {
  calculateRank,
  demote,
  isCountedRating,
  isPositiveRating,
  isRank,
  rankFromScore,
  summarizeRatings,
} from './ranking.js';

/**
 * These tests cover the rank calculation, which is the one piece of business logic
 * whose correctness the whole conference process depends on. It was previously
 * duplicated in two route files with hardcoded 14/8 thresholds and no test at all.
 */
describe('rating classification', () => {
  it('counts the positive ratings', () => {
    for (const r of ['crown', 'smile', '++', '+']) {
      expect(isPositiveRating(r)).toBe(true);
    }
  });

  it('does not count neutral, negative or non-response as positive', () => {
    for (const r of ['-', 'o', 'strain', 'struggle', 'sad', 'restart', 'newstart', 'n.b.', '', null, undefined]) {
      expect(isPositiveRating(r)).toBe(false);
    }
  });

  it('treats n.b. and blanks as not rated', () => {
    expect(isCountedRating('n.b.')).toBe(false);
    expect(isCountedRating('')).toBe(false);
    expect(isCountedRating('  ')).toBe(false);
    expect(isCountedRating(null)).toBe(false);
    expect(isCountedRating('+')).toBe(true);
  });
});

describe('rankFromScore', () => {
  it('promotes to Meister at the threshold', () => {
    expect(rankFromScore(14)).toBe('Meister');
    expect(rankFromScore(18)).toBe('Meister');
  });

  it('promotes to Geselle at the threshold', () => {
    expect(rankFromScore(8)).toBe('Geselle');
    expect(rankFromScore(13)).toBe('Geselle');
  });

  it('stays Lehrling below the Geselle threshold', () => {
    expect(rankFromScore(0)).toBe('Lehrling');
    expect(rankFromScore(7)).toBe('Lehrling');
  });
});

describe('demote', () => {
  it('steps down one rank and never below Lehrling', () => {
    expect(demote('Meister')).toBe('Geselle');
    expect(demote('Geselle')).toBe('Lehrling');
    expect(demote('Lehrling')).toBe('Lehrling');
  });
});

describe('calculateRank', () => {
  it('applies a one-step demotion for an active red card', () => {
    expect(calculateRank(16, true)).toEqual({
      baseRank: 'Meister',
      finalRank: 'Geselle',
      hasRedCardDemotion: true,
    });
  });

  it('leaves Lehrling unchanged when a red card is active', () => {
    expect(calculateRank(2, true)).toEqual({
      baseRank: 'Lehrling',
      finalRank: 'Lehrling',
      hasRedCardDemotion: false,
    });
  });

  it('is unchanged without a red card', () => {
    expect(calculateRank(16, false)).toEqual({
      baseRank: 'Meister',
      finalRank: 'Meister',
      hasRedCardDemotion: false,
    });
  });
});

describe('summarizeRatings', () => {
  const item = (rating: string) => ({ rating });

  it('counts positives and rated items across evaluations', () => {
    const result = summarizeRatings([
      {
        evaluationId: 'a',
        items: [item('+'), item('++'), item('-'), item('n.b.')],
      },
      { evaluationId: 'b', items: [item('smile'), item('o')] },
    ]);

    expect(result.positiveCount).toBe(3);
    // First evaluation: '+', '++', '-' rated; 'n.b.' excluded -> 3.
    // Second: 'smile', 'o' -> 2. Total 5.
    expect(result.totalRated).toBe(5);
    expect(result.evaluationCount).toBe(2);
  });

  it('handles a pupil with no evaluations', () => {
    const result = summarizeRatings([]);
    expect(result.positiveCount).toBe(0);
    expect(result.totalRated).toBe(0);
    expect(result.evaluationCount).toBe(0);
  });

  it('ignores evaluations with no rated items for the threshold score', () => {
    const result = summarizeRatings([
      { evaluationId: 'empty', items: [item('n.b.')] },
      { evaluationId: 'full', items: [item('+')] },
    ]);
    expect(result.evaluationCount).toBe(2);
    expect(result.positiveCount).toBe(1);
  });
});

describe('isRank', () => {
  it('accepts the three valid ranks', () => {
    expect(isRank('Lehrling')).toBe(true);
    expect(isRank('Geselle')).toBe(true);
    expect(isRank('Meister')).toBe(true);
  });

  it('rejects anything else, including injection-shaped strings', () => {
    expect(isRank('meister')).toBe(false);
    expect(isRank('')).toBe(false);
    expect(isRank(null)).toBe(false);
    expect(isRank("Meister'; DROP TABLE pupils; --")).toBe(false);
  });
});