import { describe, expect, it } from 'vitest';
import {
  VALID_RATINGS,
  buildRubricIndex,
  isValidRating,
  resolveCriterionId,
  validateBatchItems,
  type BatchValidation,
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

/** The rejection message, asserting the batch was in fact rejected. */
function rejectionMessage(result: BatchValidation): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected the batch to be rejected');
  return result.error;
}

describe('validateBatchItems', () => {
  /** Two criteria, three keys — the shape the real raster has. */
  const index = buildRubricIndex([
    { id: 'crit-1', items: [{ key: 'org_1' }, { key: 'org_2' }] },
    { id: 'crit-2', items: [{ key: 'koop_1' }] },
  ]);

  it('accepts a valid item and derives the criterion server-side', () => {
    const result = validateBatchItems([{ itemKey: 'koop_1', rating: '+', version: 0 }], index, 200);

    expect(result).toEqual({
      ok: true,
      items: [{ itemKey: 'koop_1', rating: '+', criterionId: 'crit-2', version: 0 }],
    });
  });

  it('preserves a valid expected item version for optimistic HTTP fallback writes', () => {
    const result = validateBatchItems(
      [{ itemKey: 'org_1', rating: '+', version: 7 }],
      index,
      200,
    );

    expect(result).toEqual({
      ok: true,
      items: [{ itemKey: 'org_1', rating: '+', criterionId: 'crit-1', version: 7 }],
    });
    expect(validateBatchItems([{ itemKey: 'org_1', rating: '+', version: 1.5 }], index, 200).ok)
      .toBe(false);
    expect(validateBatchItems([{ itemKey: 'org_1', rating: '+', version: -1 }], index, 200).ok)
      .toBe(false);
  });

  it('rejects an item with no optimistic-concurrency version', () => {
    const result = validateBatchItems([{ itemKey: 'org_1', rating: '+' }], index, 200);

    expect(rejectionMessage(result)).toBe('Ungültige Bewertungsversion.');
  });

  it('rejects an item key the rubric never defined', () => {
    const result = validateBatchItems([{ itemKey: 'x1', rating: '+', version: 0 }], index, 200);

    expect(rejectionMessage(result)).toContain('Unbekanntes Beobachtungsmerkmal');
  });

  it('rejects a rating outside the allowlist', () => {
    const result = validateBatchItems([{ itemKey: 'org_1', rating: 'excellent', version: 0 }], index, 200);

    expect(rejectionMessage(result)).toContain('Unbekanntes Beobachtungsmerkmal');
  });

  /**
   * The forgery this validator exists to stop: 200 invented keys, every one rated
   * '++'. Before the fix each became a row and `summarizeRatings` counted 200
   * positive ratings, which is an automatic Meister.
   */
  it('rejects a batch of 200 fabricated keys rated ++ without validating any of them', () => {
    const forged = Array.from({ length: 200 }, (_, i) => ({
      itemKey: `x${i + 1}`,
      rating: '++',
      version: 0,
      criterionId: 'crit-1',
    }));

    const result = validateBatchItems(forged, index, 200);

    // Nothing partial: an all-or-nothing rejection, not the valid items with the
    // forged ones dropped, which would still hide a forgery attempt in the logs.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the batch to be rejected');
    expect(result).not.toHaveProperty('items');
  });

  it('ignores a criterionId supplied on the input and re-derives it', () => {
    const result = validateBatchItems(
      // A client claiming org_1 belongs to a different criterion must not win.
      [{ itemKey: 'org_1', rating: '++', version: 0, criterionId: 'crit-2' }],
      index,
      200,
    );

    expect(result).toEqual({
      ok: true,
      items: [{ itemKey: 'org_1', rating: '++', criterionId: 'crit-1', version: 0 }],
    });
    expect(resolveCriterionId(index, 'org_1')).toBe('crit-1');
  });

  it('rejects a body that is not an array', () => {
    expect(validateBatchItems({ itemKey: 'org_1', rating: '+' }, index, 200).ok).toBe(false);
    expect(validateBatchItems('org_1', index, 200).ok).toBe(false);
    expect(validateBatchItems(null, index, 200).ok).toBe(false);
    expect(validateBatchItems(undefined, index, 200).ok).toBe(false);
  });

  it('rejects an empty array', () => {
    expect(validateBatchItems([], index, 200).ok).toBe(false);
  });

  it('accepts exactly maxItems and rejects maxItems + 1', () => {
    const three = [
      { itemKey: 'org_1', rating: '+', version: 0 },
      { itemKey: 'org_2', rating: '-', version: 0 },
      { itemKey: 'koop_1', rating: 'o', version: 0 },
    ];

    expect(validateBatchItems(three, index, three.length)).toEqual({
      ok: true,
      items: [
        { itemKey: 'org_1', rating: '+', criterionId: 'crit-1', version: 0 },
        { itemKey: 'org_2', rating: '-', criterionId: 'crit-1', version: 0 },
        { itemKey: 'koop_1', rating: 'o', criterionId: 'crit-2', version: 0 },
      ],
    });

    const four = [...three, { itemKey: 'org_1', rating: 'n.b.', version: 0 }];
    expect(validateBatchItems(four, index, three.length).ok).toBe(false);
  });

  it('rejects a batch of only valid items that exceeds maxItems', () => {
    // Guards the cap itself: the forgery above would also be caught by the cap if
    // the rubric lookup were removed, and this pins that the cap is real.
    const repeat = Array.from({ length: 4 }, () => ({ itemKey: 'org_1', rating: '+', version: 0 }));

    expect(validateBatchItems(repeat, index, 3).ok).toBe(false);
    expect(validateBatchItems(repeat, index, 4).ok).toBe(true);
  });

  /**
   * The empty key is rejected by an explicit check here, not by the absence of ''
   * from the rubric. The WebSocket path screens a falsy itemKey in its own guard;
   * this path must not depend on that guard, nor on rubric data never containing
   * a blank key.
   */
  it('rejects an empty itemKey even if the rubric were to map one', () => {
    const withBlankKey = buildRubricIndex([{ id: 'crit-1', items: [{ key: '' }] }]);
    expect(resolveCriterionId(withBlankKey, '')).toBe('crit-1');

    const result = validateBatchItems([{ itemKey: '', rating: '+', version: 0 }], withBlankKey, 200);

    expect(rejectionMessage(result)).toContain('Unbekanntes Beobachtungsmerkmal');
  });

  it('rejects items whose key is missing or not a string', () => {
    expect(validateBatchItems([{ rating: '+' }], index, 200).ok).toBe(false);
    expect(validateBatchItems([{ itemKey: 42, rating: '+' }], index, 200).ok).toBe(false);
    expect(validateBatchItems([null], index, 200).ok).toBe(false);
  });

  it('rejects a non-string rating rather than coercing it', () => {
    expect(validateBatchItems([{ itemKey: 'org_1', rating: 1, version: 0 }], index, 200).ok).toBe(false);
    expect(validateBatchItems([{ itemKey: 'org_1', rating: null, version: 0 }], index, 200).ok).toBe(false);
  });

  it('accepts the empty rating, which clears a cell', () => {
    const result = validateBatchItems([{ itemKey: 'org_1', rating: '', version: 0 }], index, 200);

    expect(result).toEqual({
      ok: true,
      items: [{ itemKey: 'org_1', rating: '', criterionId: 'crit-1', version: 0 }],
    });
  });
});
