import { describe, expect, it } from 'vitest';
import {
  findItemForSubjects,
  hasSubmittedForSubject,
  isSubjectMatch,
  itemVersionForSubject,
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

  it('returns 1 when the subject has no evaluation for that item', () => {
    // The server inserts at version 1 and ignores expectedVersion on that path,
    // so 1 is the safe default. It must not be another subject's version.
    expect(itemVersionForSubject(versions, 'M', 'org_9')).toBe(1);
    expect(itemVersionForSubject(versions, 'BO', 'org_1')).toBe(1);
    expect(itemVersionForSubject([], 'M', 'org_1')).toBe(1);
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