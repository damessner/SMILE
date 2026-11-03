import { describe, expect, it } from 'vitest';

import { scoreSubject, type AssessmentRank } from './pupilItems';

/**
 * The rank a subject's raster computes is a threshold comparison, and the
 * thresholds are the server's configuration (`server/src/config.ts`), not a
 * constant baked into this file. Before the config was delivered to the client
 * these numbers were hardcoded here, so a deployment that raised
 * RANK_THRESHOLD_MEISTER left every screen reading Meister while the server
 * still stored Lehrling.
 *
 * Every case below therefore passes the thresholds explicitly and expects the
 * rank to follow them.
 */
describe('scoreSubject derives the rank from the configured thresholds', () => {
  const DEFAULTS = { meister: 14, geselle: 8 } as const;

  /** N of the first N items rated positive, the rest unrated. */
  function itemsWith(positives: number, total = 18) {
    return Array.from({ length: total }, (_, i) => ({
      itemKey: `k${i + 1}`,
      rating: i < positives ? 'smile' : 'struggle',
      updatedAt: '2026-10-07T06:00:00.000Z',
    }));
  }

  function evaluation(items: Array<{ itemKey: string; rating: string; updatedAt: string }>) {
    return { id: 'eval-1', subjectCode: 'D', items };
  }

  const RUBRIC = Array.from({ length: 18 }, (_, i) => `k${i + 1}`);

  it('reaches Meister at the configured meister threshold', () => {
    expect(scoreSubject([evaluation(itemsWith(14))], 'D', RUBRIC, DEFAULTS).rank).toBe<AssessmentRank | null>('Meister');
  });

  it('stays Geselle directly below the configured meister threshold', () => {
    expect(scoreSubject([evaluation(itemsWith(13))], 'D', RUBRIC, DEFAULTS).rank).toBe('Geselle');
  });

  it('reaches Geselle at the configured geselle threshold', () => {
    expect(scoreSubject([evaluation(itemsWith(8))], 'D', RUBRIC, DEFAULTS).rank).toBe('Geselle');
  });

  it('drops to Lehrling directly below the configured geselle threshold', () => {
    expect(scoreSubject([evaluation(itemsWith(7))], 'D', RUBRIC, DEFAULTS).rank).toBe('Lehrling');
  });

  it('follows a raised threshold instead of the shipped defaults', () => {
    // 16 positives is Meister under the defaults but must not be when the
    // deployment configured 20: the screen has to agree with the server.
    const raised = { meister: 20, geselle: 12 };
    expect(scoreSubject([evaluation(itemsWith(16))], 'D', RUBRIC, raised).rank).toBe('Geselle');
  });

  it('follows a lowered threshold when the deployment configured one', () => {
    const lowered = { meister: 10, geselle: 5 };
    expect(scoreSubject([evaluation(itemsWith(10))], 'D', RUBRIC, lowered).rank).toBe('Meister');
    expect(scoreSubject([evaluation(itemsWith(5))], 'D', RUBRIC, lowered).rank).toBe('Geselle');
    expect(scoreSubject([evaluation(itemsWith(4))], 'D', RUBRIC, lowered).rank).toBe('Lehrling');
  });

  it('still reports no rank for a subject with nothing rated', () => {
    expect(scoreSubject([evaluation([])], 'D', RUBRIC, DEFAULTS).rank).toBeNull();
  });

  it('keeps the shipped defaults when a caller passes no thresholds', () => {
    // Existing callers (and the roster tests) must not have to know about the
    // config yet, so the parameter is optional and defaults to the documented
    // values.
    expect(scoreSubject([evaluation(itemsWith(14))], 'D', RUBRIC).rank).toBe('Meister');
    expect(scoreSubject([evaluation(itemsWith(8))], 'D', RUBRIC).rank).toBe('Geselle');
    expect(scoreSubject([evaluation(itemsWith(7))], 'D', RUBRIC).rank).toBe('Lehrling');
  });
});
