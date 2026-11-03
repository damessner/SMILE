import { describe, expect, it } from 'vitest';
import {
  findItemForSubjects,
  hasSubmittedForSubject,
  isPupilFullySubmitted,
  isSubjectMatch,
  itemVersionForSubject,
  scoreSubject,
  type AssessmentRank,
} from './pupilItems';
import type { Evaluation } from '../types';

interface TestItem {
  itemKey: string;
  rating: string;
  version: number;
}

interface TestEvaluation {
  subjectCode: string;
  isSubmitted: boolean;
  items: TestItem[];
}

interface SubmittedFlag {
  subjectCode: string;
  isSubmitted: boolean;
}

// A pupil rated in two subjects. The item keys overlap because every subject
// uses the same 18-item rubric - only the owning evaluation differs.
const twoSubjectPupil: TestEvaluation[] = [
  {
    subjectCode: 'D',
    isSubmitted: false,
    items: [
      { itemKey: 'org_1', rating: 'crown', version: 7 },
      { itemKey: 'org_9', rating: 'smile', version: 3 },
    ],
  },
  {
    subjectCode: 'M',
    isSubmitted: false,
    items: [{ itemKey: 'org_1', rating: 'smile', version: 1 }],
  },
];

describe('isSubjectMatch', () => {
  it('matches the legacy WebUntis abbreviations', () => {
    expect(isSubjectMatch('SD', 'D')).toBe(true);
    expect(isSubjectMatch('BFUD', 'D')).toBe(true);
    expect(isSubjectMatch('SE', 'E')).toBe(true);
    expect(isSubjectMatch('SM', 'M')).toBe(true);
  });

  it('matches full subject names from the server alias table', () => {
    expect(isSubjectMatch('deutsch', 'D')).toBe(true);
    expect(isSubjectMatch('Deutsch', 'D')).toBe(true);
    expect(isSubjectMatch('smile_deutsch', 'D')).toBe(true);
    expect(isSubjectMatch('smile deutsch', 'D')).toBe(true);
    expect(isSubjectMatch('Mathematik', 'M')).toBe(true);
    expect(isSubjectMatch('Technik und Design', 'TUD')).toBe(true);
    expect(isSubjectMatch('txw', 'TUD')).toBe(true);
    expect(isSubjectMatch('Förderunterricht Mathematik', 'BFUM')).toBe(true);
  });

  it('is case-, whitespace- and separator-insensitive', () => {
    expect(isSubjectMatch(' sd ', 'D')).toBe(true);
    expect(isSubjectMatch('SMILE-DEUTSCH', 'D')).toBe(true);
    expect(isSubjectMatch('deutsch', 'D')).toBe(true);
  });

  it('does not match different subjects', () => {
    expect(isSubjectMatch('BO', 'D')).toBe(false);
    expect(isSubjectMatch('SM', 'E')).toBe(false);
    expect(isSubjectMatch('BO', 'd')).toBe(false);
  });

  it('resolves through the canonical code, so codes sharing a prefix stay apart', () => {
    // DAZ is Deutsch als Zweitsprache and must not collapse into D.
    expect(isSubjectMatch('DAZ', 'D')).toBe(false);
    expect(isSubjectMatch('DAZ', 'BFUD')).toBe(false);
    expect(isSubjectMatch('D', 'DAZ')).toBe(false);
  });

  it('still matches identical codes and treats empty codes as no match', () => {
    expect(isSubjectMatch('D', 'D')).toBe(true);
    expect(isSubjectMatch('M', 'M')).toBe(true);
    expect(isSubjectMatch('', 'D')).toBe(false);
    expect(isSubjectMatch('D', '')).toBe(false);
  });

  it('does not let an inherited object property stand in for an unknown subject', () => {
    // 'constructor' is the one Object.prototype key that survives
    // normalization. The alias lookup is guarded with Object.hasOwn so it
    // cannot resolve to the inherited Function.
    expect(isSubjectMatch('constructor', 'constructor')).toBe(true);
    expect(isSubjectMatch('CONSTRUCTOR', 'constructor')).toBe(true);
    expect(isSubjectMatch('constructor', 'D')).toBe(false);
  });
});

describe('findItemForSubjects', () => {
  it('reads the item from the requested subject, not the first evaluation found', () => {
    const found = findItemForSubjects(twoSubjectPupil, ['M'], 'org_1');
    expect(found).not.toBeNull();
    expect(found?.rating).toBe('smile');
  });

  it('takes the version from the requested subject so optimistic concurrency matches', () => {
    const found = findItemForSubjects(twoSubjectPupil, ['M'], 'org_1');
    expect(found?.version).toBe(1);
  });

  it('returns the first match in codes order', () => {
    expect(findItemForSubjects(twoSubjectPupil, ['M', 'D'], 'org_1')?.rating).toBe('smile');
    expect(findItemForSubjects(twoSubjectPupil, ['D', 'M'], 'org_1')?.rating).toBe('crown');
  });

  it('does not fall back to another subject when the subject has no evaluation', () => {
    // The regression: a teacher viewing Mathematik must see an empty cell for a
    // pupil who has only a Deutsch evaluation. D owns org_1, so the deleted
    // fallback would hand D's rating to M.
    const deutschOnly: TestEvaluation[] = [
      { subjectCode: 'D', isSubmitted: false, items: [{ itemKey: 'org_1', rating: 'crown', version: 7 }] },
    ];
    expect(findItemForSubjects(deutschOnly, ['M'], 'org_1')).toBeNull();
  });

  it('does not borrow a key that only a subject outside the scope holds', () => {
    // M is in scope and owns org_1, but not org_9 - only D does. The deleted
    // fallback returned D's org_9 here, so this fails if that comes back.
    expect(findItemForSubjects(twoSubjectPupil, ['M'], 'org_9')).toBeNull();
  });

  it('walks the codes list when a subject in scope lacks the key', () => {
    // Gesamt mode: M is checked first and misses org_9, then D is checked and
    // hits. The result must be D's item, found by walking codes - not by
    // scanning every evaluation.
    const found = findItemForSubjects(twoSubjectPupil, ['M', 'D'], 'org_9');
    expect(found?.rating).toBe('smile');
    expect(found?.version).toBe(3);
  });

  it('returns null for an empty codes array', () => {
    expect(findItemForSubjects(twoSubjectPupil, [], 'org_1')).toBeNull();
  });

  it('returns null for an empty pupil', () => {
    expect(findItemForSubjects([], ['D', 'M'], 'org_1')).toBeNull();
  });

  it('returns null when the evaluation carries no items', () => {
    const empty: TestEvaluation[] = [{ subjectCode: 'D', isSubmitted: false, items: [] }];
    expect(findItemForSubjects(empty, ['D'], 'org_1')).toBeNull();
  });

  it('returns null when the evaluation has no items array at all', () => {
    const noItems = [{ subjectCode: 'D' }];
    expect(findItemForSubjects(noItems, ['D'], 'org_1')).toBeNull();
  });

  it('resolves the subject through the alias table', () => {
    const legacy: TestEvaluation[] = [
      { subjectCode: 'SM', isSubmitted: false, items: [{ itemKey: 'org_1', rating: 'crown', version: 4 }] },
    ];
    expect(findItemForSubjects(legacy, ['M'], 'org_1')?.rating).toBe('crown');
  });

  it('resolves duplicate alias-equivalent evaluations to the newest item, matching scoreSubject', () => {
    // Legacy alias rows (SD + D) both satisfy the unique key on the literal
    // subject_code string. The displayed cell, the counted rating and the
    // written version must follow the same newest-wins rule as scoreSubject,
    // otherwise the grid shows one rating while the rank counts another.
    const duplicateAlias = [
      {
        subjectCode: 'SD',
        id: 'eval-old',
        items: [{ itemKey: 'item_1', rating: 'crown', updatedAt: '2026-10-01T10:00:00Z', version: 4 }],
      },
      {
        subjectCode: 'D',
        id: 'eval-new',
        items: [{ itemKey: 'item_1', rating: 'struggle', updatedAt: '2026-10-02T10:00:00Z', version: 5 }],
      },
    ];
    expect(findItemForSubjects(duplicateAlias, ['D'], 'item_1')?.rating).toBe('struggle');
    expect(findItemForSubjects(duplicateAlias, ['D'], 'item_1')?.version).toBe(5);

    // Equal timestamps tie-break by lexicographically greater evaluation id,
    // never by rating value - the same rule scoreSubject applies.
    const tieBreak = [
      {
        subjectCode: 'SD',
        id: 'eval-1',
        items: [{ itemKey: 'item_1', rating: 'crown', updatedAt: '2026-10-01T10:00:00Z', version: 4 }],
      },
      {
        subjectCode: 'D',
        id: 'eval-2',
        items: [{ itemKey: 'item_1', rating: 'struggle', updatedAt: '2026-10-01T10:00:00Z', version: 5 }],
      },
    ];
    expect(findItemForSubjects(tieBreak, ['D'], 'item_1')?.rating).toBe('struggle');
  });
});

describe('itemVersionForSubject', () => {
  // Gesamt mode: the grid writes one subject at a time, and each write must
  // carry that subject's own version or the server's
  // `UPDATE ... WHERE version = $4` matches zero rows and reports a CONFLICT.
  const versions: TestEvaluation[] = [
    { subjectCode: 'D', isSubmitted: false, items: [{ itemKey: 'org_1', rating: 'crown', version: 7 }] },
    { subjectCode: 'M', isSubmitted: false, items: [{ itemKey: 'org_1', rating: 'smile', version: 3 }] },
  ];

  it('returns each subject\'s own version for the same item key', () => {
    expect(itemVersionForSubject(versions, 'D', 'org_1')).toBe(7);
    expect(itemVersionForSubject(versions, 'M', 'org_1')).toBe(3);
  });

  it('never borrows a version from another subject', () => {
    // M's row is at 3. Sending D's 7 here would conflict on an untouched cell.
    const mVersion = itemVersionForSubject(versions, 'M', 'org_1');
    expect(mVersion).not.toBe(itemVersionForSubject(versions, 'D', 'org_1'));
  });

  it('returns 0 when the subject has no item row', () => {
    // Zero represents absence, so a concurrent first insert conflicts rather
    // than being treated as an update to a row another writer just created.
    expect(itemVersionForSubject(versions, 'M', 'org_9')).toBe(0);
    expect(itemVersionForSubject(versions, 'BO', 'org_1')).toBe(0);
    expect(itemVersionForSubject([], 'M', 'org_1')).toBe(0);
  });

  it('returns a version of 0 unchanged rather than substituting 1', () => {
    // `||` would turn 0 into 1 and miss the row; 0 is a value that would match it.
    const zeroed: TestEvaluation[] = [
      { subjectCode: 'D', isSubmitted: false, items: [{ itemKey: 'org_1', rating: 'smile', version: 0 }] },
    ];
    expect(itemVersionForSubject(zeroed, 'D', 'org_1')).toBe(0);
  });

  it('resolves the subject through the alias table', () => {
    const legacy: TestEvaluation[] = [
      { subjectCode: 'SM', isSubmitted: false, items: [{ itemKey: 'org_1', rating: 'smile', version: 4 }] },
    ];
    expect(itemVersionForSubject(legacy, 'M', 'org_1')).toBe(4);
  });
});

describe('hasSubmittedForSubject', () => {
  // The helper reads the flag only; full Evaluation objects (which carry items)
  // are exercised below via a variable, matching how the grid calls it.
  const mixed: SubmittedFlag[] = [
    { subjectCode: 'D', isSubmitted: true },
    { subjectCode: 'M', isSubmitted: false },
  ];

  it('reports submission per subject rather than across all subjects', () => {
    expect(hasSubmittedForSubject(mixed, 'M')).toBe(false);
    expect(hasSubmittedForSubject(mixed, 'D')).toBe(true);
  });

  it('is false for an unsubmitted evaluation and for an empty pupil', () => {
    expect(hasSubmittedForSubject([{ subjectCode: 'D', isSubmitted: false }], 'D')).toBe(false);
    expect(hasSubmittedForSubject([], 'D')).toBe(false);
  });

  it('is false for a subject the pupil has no evaluation for', () => {
    expect(hasSubmittedForSubject([{ subjectCode: 'D', isSubmitted: true }], 'M')).toBe(false);
  });

  it('resolves the subject through the alias table', () => {
    expect(hasSubmittedForSubject([{ subjectCode: 'SE', isSubmitted: true }], 'E')).toBe(true);
    expect(hasSubmittedForSubject([{ subjectCode: 'SE', isSubmitted: true }], 'D')).toBe(false);
  });

  it('accepts full evaluation objects, which is how the grid passes them', () => {
    const legacy: TestEvaluation[] = [{ subjectCode: 'SE', isSubmitted: true, items: [] }];
    expect(hasSubmittedForSubject(legacy, 'E')).toBe(true);
    expect(hasSubmittedForSubject(legacy, 'D')).toBe(false);
  });

  it('treats an absent isSubmitted flag as not submitted', () => {
    // Evaluation.isSubmitted is optional in the app's types, so an evaluation
    // can reach this helper without the flag set.
    const noFlag: Array<{ subjectCode: string }> = [{ subjectCode: 'D' }];
    expect(hasSubmittedForSubject(noFlag, 'D')).toBe(false);
    expect(hasSubmittedForSubject([{ subjectCode: 'D' }, { subjectCode: 'M', isSubmitted: true }], 'D')).toBe(
      false
    );
  });

  it('accepts Evaluation[] as-is, which is what the call sites pass', () => {
    const evaluation = {
      id: 'e1',
      roundId: 'r1',
      pupilId: 1,
      classId: 1,
      subjectCode: 'D',
      teacherId: 7,
      isSubmitted: true,
      items: [],
    } satisfies Evaluation;

    expect(hasSubmittedForSubject([evaluation], 'D')).toBe(true);
    expect(hasSubmittedForSubject([{ ...evaluation, isSubmitted: undefined }], 'D')).toBe(false);
  });
});

describe('isPupilFullySubmitted', () => {
  it('is false while any subject in scope is still open', () => {
    // The regression this exists for: the pupil submitted Deutsch, so an
    // unscoped `evaluations.some(e => e.isSubmitted)` reported them as done
    // while their Mathematik evaluation was untouched and the teacher skipped
    // them.
    expect(isPupilFullySubmitted([{ subjectCode: 'D', isSubmitted: true }], ['D', 'M'])).toBe(false);
  });

  it('is true only when every subject in scope is submitted', () => {
    const both: SubmittedFlag[] = [
      { subjectCode: 'D', isSubmitted: true },
      { subjectCode: 'M', isSubmitted: true },
    ];
    expect(isPupilFullySubmitted(both, ['D', 'M'])).toBe(true);
    expect(isPupilFullySubmitted(both, ['M', 'D'])).toBe(true);
  });

  it('is false for an empty code list rather than vacuously true', () => {
    // `codes.every` over nothing is true, which would read as "everything is
    // done" for a teacher with no subjects in scope.
    expect(isPupilFullySubmitted([{ subjectCode: 'D', isSubmitted: true }], [])).toBe(false);
    expect(isPupilFullySubmitted([], [])).toBe(false);
  });

  it('is false when the only evaluation in scope is unsubmitted', () => {
    expect(isPupilFullySubmitted([{ subjectCode: 'D', isSubmitted: false }], ['D'])).toBe(false);
  });

  it('is false when a subject in scope has no evaluation at all', () => {
    expect(isPupilFullySubmitted([], ['D', 'M'])).toBe(false);
    expect(isPupilFullySubmitted([{ subjectCode: 'D', isSubmitted: true }], ['D', 'BO'])).toBe(false);
  });

  it('is not satisfied by a submission outside the scope', () => {
    // Berufsorientierung is submitted, Deutsch is not. Searching every
    // evaluation instead of the codes in scope would return true here.
    const elsewhere: SubmittedFlag[] = [
      { subjectCode: 'D', isSubmitted: false },
      { subjectCode: 'BO', isSubmitted: true },
    ];
    expect(isPupilFullySubmitted(elsewhere, ['D'])).toBe(false);
    expect(isPupilFullySubmitted(elsewhere, ['D', 'BO'])).toBe(false);
    expect(isPupilFullySubmitted(elsewhere, ['BO'])).toBe(true);
  });

  it('resolves every code through the alias table', () => {
    const legacy: SubmittedFlag[] = [
      { subjectCode: 'SD', isSubmitted: true },
      { subjectCode: 'SM', isSubmitted: true },
    ];
    expect(isPupilFullySubmitted(legacy, ['D', 'M'])).toBe(true);
    expect(isPupilFullySubmitted(legacy, ['D', 'E'])).toBe(false);
  });

  it('treats an absent isSubmitted flag as not submitted', () => {
    // Evaluation.isSubmitted is optional, so an evaluation can reach this
    // helper without the flag set.
    expect(isPupilFullySubmitted([{ subjectCode: 'D' }], ['D'])).toBe(false);
    expect(
      isPupilFullySubmitted([{ subjectCode: 'D' }, { subjectCode: 'M', isSubmitted: true }], [
        'D',
        'M',
      ])
    ).toBe(false);
  });

  it('accepts Evaluation[] as-is, which is what the call sites pass', () => {
    const evaluation = {
      id: 'e1',
      roundId: 'r1',
      pupilId: 1,
      classId: 1,
      subjectCode: 'D',
      teacherId: 7,
      isSubmitted: true,
      items: [],
    } satisfies Evaluation;

    expect(isPupilFullySubmitted([evaluation], ['D'])).toBe(true);
    expect(isPupilFullySubmitted([{ ...evaluation, isSubmitted: undefined }], ['D'])).toBe(false);
  });
});

describe('scoreSubject', () => {
  const RUBRIC_KEYS = Array.from({ length: 18 }, (_, i) => `item_${i + 1}`);

  it('(a) same pupil with D 6 positives and M 16 positives produces independent counts and ranks', () => {
    const evals = [
      {
        id: 'eval-d',
        subjectCode: 'D',
        items: RUBRIC_KEYS.map((k, i) => ({
          itemKey: k,
          rating: i < 6 ? 'smile' : 'struggle',
          updatedAt: '2026-10-01T10:00:00Z',
        })),
      },
      {
        id: 'eval-m',
        subjectCode: 'M',
        items: RUBRIC_KEYS.map((k, i) => ({
          itemKey: k,
          rating: i < 16 ? 'smile' : 'struggle',
          updatedAt: '2026-10-01T10:00:00Z',
        })),
      },
    ];

    const scoreD = scoreSubject(evals, 'D', RUBRIC_KEYS);
    expect(scoreD).toEqual({
      subjectCode: 'D',
      positiveCount: 6,
      totalRated: 18,
      rank: 'Lehrling',
    });

    const scoreM = scoreSubject(evals, 'M', RUBRIC_KEYS);
    expect(scoreM).toEqual({
      subjectCode: 'M',
      positiveCount: 16,
      totalRated: 18,
      rank: 'Meister',
    });
  });

  it('(b) aliases SD and D group together', () => {
    const evals = [
      {
        id: 'eval-sd',
        subjectCode: 'SD',
        items: [
          { itemKey: 'item_1', rating: 'crown', updatedAt: '2026-10-01T10:00:00Z' },
          { itemKey: 'item_2', rating: 'smile', updatedAt: '2026-10-01T10:00:00Z' },
        ],
      },
    ];

    const score = scoreSubject(evals, 'D', RUBRIC_KEYS);
    expect(score.positiveCount).toBe(2);
    expect(score.totalRated).toBe(2);
    expect(score.rank).toBe('Lehrling');
  });

  it('(c) duplicate same-key entries choose newest timestamp even when older is positive', () => {
    const evals = [
      {
        id: 'eval-old',
        subjectCode: 'D',
        items: [
          { itemKey: 'item_1', rating: 'crown', updatedAt: '2026-10-01T10:00:00Z' },
        ],
      },
      {
        id: 'eval-new',
        subjectCode: 'D',
        items: [
          { itemKey: 'item_1', rating: 'struggle', updatedAt: '2026-10-02T10:00:00Z' },
        ],
      },
    ];

    // Newest update is struggle (non-positive), which must overwrite crown
    const score = scoreSubject(evals, 'D', RUBRIC_KEYS);
    expect(score.positiveCount).toBe(0);
    expect(score.totalRated).toBe(1);
    expect(score.rank).toBe('Lehrling');

    // Tie-break equal timestamps by lexicographically greater evaluation id, never rating value
    const tieEvals = [
      {
        id: 'eval-1',
        subjectCode: 'D',
        items: [{ itemKey: 'item_1', rating: 'crown', updatedAt: '2026-10-01T10:00:00Z' }],
      },
      {
        id: 'eval-2',
        subjectCode: 'D',
        items: [{ itemKey: 'item_1', rating: 'struggle', updatedAt: '2026-10-01T10:00:00Z' }],
      },
    ];
    // eval-2 > eval-1 lexicographically, so eval-2 (struggle) wins
    const tieScore = scoreSubject(tieEvals, 'D', RUBRIC_KEYS);
    expect(tieScore.positiveCount).toBe(0);
  });

  it('(d) n.b./empty-only inputs return totalRated: 0, rank: null', () => {
    const evals = [
      {
        id: 'eval-nb',
        subjectCode: 'D',
        items: [
          { itemKey: 'item_1', rating: 'n.b.', updatedAt: '2026-10-01T10:00:00Z' },
          { itemKey: 'item_2', rating: '', updatedAt: '2026-10-01T10:00:00Z' },
        ],
      },
    ];

    const score = scoreSubject(evals, 'D', RUBRIC_KEYS);
    expect(score).toEqual({
      subjectCode: 'D',
      positiveCount: 0,
      totalRated: 0,
      rank: null,
    });
  });

  it('(e) item keys outside the rubric list are ignored and duplicates never exceed 18', () => {
    const evals = [
      {
        id: 'eval-custom',
        subjectCode: 'D',
        items: [
          { itemKey: 'item_1', rating: 'smile', updatedAt: '2026-10-01T10:00:00Z' },
          { itemKey: 'custom_foreign_key', rating: 'crown', updatedAt: '2026-10-01T10:00:00Z' },
        ],
      },
    ];

    const score = scoreSubject(evals, 'D', RUBRIC_KEYS);
    expect(score.positiveCount).toBe(1);
    expect(score.totalRated).toBe(1);
    expect(score.positiveCount).toBeLessThanOrEqual(18);
    expect(score.totalRated).toBeLessThanOrEqual(18);
  });

  it('(f) reports the canonical subject code even when called with an alias', () => {
    // Consumers key rows and React lists by subjectCode; echoing the raw
    // argument ('SD') would render one pupil as two subjects next to 'D'.
    const evals = [
      {
        id: 'eval-sd',
        subjectCode: 'SD',
        items: [{ itemKey: 'item_1', rating: 'smile', updatedAt: '2026-10-01T10:00:00Z' }],
      },
    ];

    expect(scoreSubject(evals, 'SD', RUBRIC_KEYS).subjectCode).toBe('D');
  });
});

