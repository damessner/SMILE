import { describe, expect, it } from 'vitest';
import { canRateSubject, getGlobalAccess, hasPersistedTeacherActor, kvFieldMatches, parseIdParam, parsePositiveInt, safeTeacherId, type ClassAccess } from './guards.js';

/**
 * Homeroom matching is a security boundary: it decides who may edit a class roster and
 * who may confirm conference ranks. The previous implementation used
 * `field.includes(shortName)`, which granted that authority whenever a teacher's short
 * name happened to be a substring of an unrelated name.
 */
describe('kvFieldMatches', () => {
  const zia = { shortName: 'ZIA', fullName: 'Alfred Zimmermann' };

  it('matches the whole field holding just the short name', () => {
    expect(kvFieldMatches('ZIA', zia)).toBe(true);
    expect(kvFieldMatches('zia', zia)).toBe(true);
  });

  it('matches the whole field holding the full name', () => {
    expect(kvFieldMatches('Alfred Zimmermann', zia)).toBe(true);
  });

  it('matches the parenthesised short code form used by the export', () => {
    expect(kvFieldMatches('Alfred Zimmermann (ZIA)', zia)).toBe(true);
    expect(kvFieldMatches('Alfred Zimmermann (zia)', zia)).toBe(true);
  });

  it('matches when the short code trails the name without parentheses', () => {
    expect(kvFieldMatches('Alfred Zimmermann ZIA', zia)).toBe(true);
  });

  it('matches one teacher out of several in a combined field', () => {
    expect(kvFieldMatches('Alfred Zimmermann (ZIA) / Maria Meier (MED)', zia)).toBe(true);
    expect(kvFieldMatches('Anna Auer / Alfred Zimmermann (ZIA)', zia)).toBe(true);
  });

  // The regression that motivated this module.
  it('does NOT match on an incidental substring', () => {
    const z = { shortName: 'Z', fullName: 'Zoe Ziegler' };
    expect(kvFieldMatches('Karin Ziegler', z)).toBe(false);
    expect(kvFieldMatches('Alfred Zimmermann', z)).toBe(false);
  });

  it('does not match a different teacher', () => {
    expect(kvFieldMatches('Maria Meier (MED)', zia)).toBe(false);
    expect(kvFieldMatches('Bernhard Roth', zia)).toBe(false);
  });

  it('handles empty and null fields', () => {
    expect(kvFieldMatches(null, zia)).toBe(false);
    expect(kvFieldMatches(undefined, zia)).toBe(false);
    expect(kvFieldMatches('', zia)).toBe(false);
    expect(kvFieldMatches('   ', zia)).toBe(false);
  });
});

describe('parseIdParam', () => {
  it('accepts positive integers', () => {
    expect(parseIdParam('42')).toBe(42);
    expect(parseIdParam('7')).toBe(7);
  });

  // NaN previously reached parameterised SQL via /timetable/teacher/:teacherId.
  it('rejects non-numeric input instead of forwarding NaN', () => {
    expect(parseIdParam('abc')).toBeNull();
    expect(parseIdParam('')).toBeNull();
    expect(parseIdParam('1 OR 1=1')).toBeNull();
  });

  it('rejects zero and negative values', () => {
    expect(parseIdParam('0')).toBeNull();
    expect(parseIdParam('-5')).toBeNull();
  });

  it('rejects trailing garbage rather than taking the leading integer', () => {
    // parseInt('12abc') === 12, which silently accepted a malformed segment.
    expect(parseIdParam('12abc')).toBeNull();
    expect(parseIdParam('12 13')).toBeNull();
    expect(parseIdParam(' 12')).toBeNull();
  });

  it('rejects unsafe integers', () => {
    expect(parseIdParam('99999999999999999999')).toBeNull();
    // PostgreSQL `integer` identifiers are signed 32-bit values even when a
    // larger request value is still safe to represent in JavaScript.
    expect(parseIdParam('2147483648')).toBeNull();
  });
});

describe('parsePositiveInt', () => {
  it('accepts numbers and valid string integers', () => {
    expect(parsePositiveInt(42)).toBe(42);
    expect(parsePositiveInt('42')).toBe(42);
    expect(parsePositiveInt(1)).toBe(1);
    expect(parsePositiveInt('1')).toBe(1);
  });

  it('rejects floats, zeroes, negatives and non-digit strings', () => {
    expect(parsePositiveInt(0)).toBeNull();
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt(-10)).toBeNull();
    expect(parsePositiveInt('-10')).toBeNull();
    expect(parsePositiveInt(3.14)).toBeNull();
    expect(parsePositiveInt('3.14')).toBeNull();
    expect(parsePositiveInt('1junk')).toBeNull();
    expect(parsePositiveInt(null)).toBeNull();
    expect(parsePositiveInt(undefined)).toBeNull();
    expect(parsePositiveInt({})).toBeNull();
    expect(parsePositiveInt(2147483648)).toBeNull();
  });
});

describe('hasPersistedTeacherActor', () => {
  it('accepts a real teacher id', () => {
    expect(hasPersistedTeacherActor(42)).toBe(true);
    expect(hasPersistedTeacherActor(1)).toBe(true);
  });

  it('rejects every value that must not become a foreign key', () => {
    // 0 is a legal primary key, so persisting it would attach the write to a phantom
    // teacher rather than failing the way a missing actor does.
    expect(hasPersistedTeacherActor(0)).toBe(false);
    expect(hasPersistedTeacherActor(null)).toBe(false);
    expect(hasPersistedTeacherActor(undefined)).toBe(false);
    expect(hasPersistedTeacherActor(-3)).toBe(false);
    expect(hasPersistedTeacherActor(3.5)).toBe(false);
    expect(hasPersistedTeacherActor(Number.NaN)).toBe(false);
    expect(hasPersistedTeacherActor(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('safeTeacherId', () => {
  it('passes a usable id through unchanged', () => {
    expect(safeTeacherId(42)).toBe(42);
  });

  it('collapses unusable ids to null instead of writing a sentinel', () => {
    expect(safeTeacherId(0)).toBeNull();
    expect(safeTeacherId(null)).toBeNull();
    expect(safeTeacherId(undefined)).toBeNull();
    expect(safeTeacherId(Number.NaN)).toBeNull();
  });
});

describe('canRateSubject', () => {
  const baseAccess: ClassAccess = {
    classId: 1,
    exists: true,
    isAdmin: false,
    isHeadmaster: false,
    isKv: false,
    teaches: true,
    isCoreTeacher: true,
    subjects: [{ code: 'D', name: 'Deutsch', isCoreSmile: true }],
    canRead: true,
    canRecord: true,
    canRate: true,
    canManagePupils: false,
    canRunConference: false,
  };

  it('allows a teacher to write their assigned subject', () => {
    expect(canRateSubject(baseAccess, 'D')).toBe(true);
    expect(canRateSubject(baseAccess, 'sd')).toBe(true); // known alias normalizes to D
  });

  it('rejects writing a subject that is not assigned to the teacher', () => {
    expect(canRateSubject(baseAccess, 'M')).toBe(false);
    expect(canRateSubject(baseAccess, 'E')).toBe(false);
  });

  it('refuses writes if canRate is false', () => {
    const noRateAccess = { ...baseAccess, canRate: false };
    expect(canRateSubject(noRateAccess, 'D')).toBe(false);
  });

  it('allows administrators and headmasters to write any subject', () => {
    const adminAccess = { ...baseAccess, isAdmin: true, subjects: [] };
    expect(canRateSubject(adminAccess, 'D')).toBe(true);
    expect(canRateSubject(adminAccess, 'M')).toBe(true);

    const headmasterAccess = { ...baseAccess, isHeadmaster: true, subjects: [] };
    expect(canRateSubject(headmasterAccess, 'D')).toBe(true);
    expect(canRateSubject(headmasterAccess, 'M')).toBe(true);
  });

  it('never treats an unknown subject as rateable, even for school leadership', () => {
    const adminAccess = { ...baseAccess, isAdmin: true, subjects: [] };
    const headmasterAccess = { ...baseAccess, isHeadmaster: true, subjects: [] };
    expect(canRateSubject(adminAccess, 'Astronomie')).toBe(false);
    expect(canRateSubject(headmasterAccess, 'constructor')).toBe(false);
  });

  it('limits a KV without a teaching assignment to assigned subjects only', () => {
    const kvWithoutAssignment = {
      ...baseAccess,
      isKv: true,
      teaches: false,
      subjects: [],
    };
    expect(canRateSubject(kvWithoutAssignment, 'D')).toBe(false);

    const kvWithGermanAssignment = {
      ...kvWithoutAssignment,
      subjects: [{ code: 'D', name: 'Deutsch', isCoreSmile: true }],
    };
    expect(canRateSubject(kvWithGermanAssignment, 'SD')).toBe(true);
    expect(canRateSubject(kvWithGermanAssignment, 'M')).toBe(false);
  });
});

describe('getGlobalAccess fail-closed policy (Task 2.1)', () => {
  it('grants unrestricted classIds: null to administrator', async () => {
    const access = await getGlobalAccess({ role: 'admin' });
    expect(access.isAdmin).toBe(true);
    expect(access.classIds).toBeNull();
  });

  it('fails closed for non-admin user without linked teacherId', async () => {
    const access = await getGlobalAccess({ role: 'teacher', teacherId: undefined });
    expect(access.isAdmin).toBe(false);
    expect(access.isHeadmaster).toBe(false);
    expect(access.classIds).toEqual([]);
  });

  it('fails closed for pupil account', async () => {
    const access = await getGlobalAccess({ role: 'pupil' } as any);
    expect(access.isAdmin).toBe(false);
    expect(access.isHeadmaster).toBe(false);
    expect(access.classIds).toEqual([]);
  });
});
