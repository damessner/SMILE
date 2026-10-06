import { describe, expect, it } from 'vitest';
import {
  VALID_RATINGS,
  buildRubricIndex,
  isValidRating,
  resolveCriterionId,
} from './rubric.js';

/**
 * The rating values the Beobachtungsraster defines, spelled out here so the test
 * asserts an independent fact instead of echoing whatever the module exports.
 */
const EXPECTED_RATINGS = [
  'crown',
  'smile',
  'strain',
  'struggle',
  'sad',
  'restart',
  'newstart',
  '+',
  '++',
  '-',
  'o',
  'n.b.',
  '',
];

describe('VALID_RATINGS', () => {
  it('contains exactly the 13 ratings the raster defines', () => {
    expect(VALID_RATINGS.size).toBe(13);
    expect([...VALID_RATINGS].sort()).toEqual([...EXPECTED_RATINGS].sort());
  });
});

describe('buildRubricIndex', () => {
  it('yields an empty index when the rubric has no criteria', () => {
    const index = buildRubricIndex([]);

    expect(index.keyToCriterion.size).toBe(0);
    expect(resolveCriterionId(index, 'org_1')).toBeNull();
    expect(resolveCriterionId(index, '')).toBeNull();
  });

  it('maps every item key of a criterion onto that criterion id', () => {
    const index = buildRubricIndex([
      { id: 'crit-1', items: [{ key: 'org_1' }, { key: 'org_2' }] },
      { id: 'crit-2', items: [{ key: 'koop_1' }] },
    ]);

    expect(resolveCriterionId(index, 'org_1')).toBe('crit-1');
    expect(resolveCriterionId(index, 'org_2')).toBe('crit-1');
    expect(resolveCriterionId(index, 'koop_1')).toBe('crit-2');
    expect(index.keyToCriterion.size).toBe(3);
  });

  it('skips a criteria row whose items is not an array instead of throwing', () => {
    const index = buildRubricIndex([
      { id: 'crit-1', items: 'org_1' },
      { id: 'crit-2', items: null },
      { id: 'crit-3', items: [{ key: 'org_3' }] },
    ]);

    expect(resolveCriterionId(index, 'org_3')).toBe('crit-3');
    expect(index.keyToCriterion.size).toBe(1);
  });

  it('skips items that carry no string key', () => {
    const index = buildRubricIndex([
      {
        id: 'crit-1',
        items: [{ desc: 'Arbeitsorganisation' }, { key: 'org_1' }, { key: 42 }, null],
      },
    ]);

    expect(resolveCriterionId(index, 'org_1')).toBe('crit-1');
    expect(index.keyToCriterion.size).toBe(1);
  });
});

describe('resolveCriterionId', () => {
  it('returns null for an attacker-chosen key that the rubric never defined', () => {
    const index = buildRubricIndex([{ id: 'crit-1', items: [{ key: 'org_1' }] }]);

    expect(resolveCriterionId(index, 'x1')).toBeNull();
  });
});

describe('isValidRating', () => {
  const index = buildRubricIndex([{ id: 'crit-1', items: [{ key: 'org_1' }] }]);

  it('accepts each of the 13 valid ratings', () => {
    for (const rating of EXPECTED_RATINGS) {
      expect(isValidRating(index, rating)).toBe(true);
    }
  });

  it('rejects values outside the allowlist', () => {
    expect(isValidRating(index, 'x')).toBe(false);
    expect(isValidRating(index, 'MEISTER')).toBe(false);
    expect(isValidRating(index, 'null')).toBe(false);
  });
});