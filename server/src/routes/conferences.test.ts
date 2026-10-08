import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClassAccess, Identity } from '../lib/guards.js';

/** Minimal ClassAccess with only the fields the summary gate reads. */
function access(overrides: Partial<ClassAccess> = {}): ClassAccess {
  return {
    classId: 2,
    exists: true,
    isAdmin: false,
    isHeadmaster: false,
    isKv: false,
    teaches: false,
    isCoreTeacher: false,
    subjects: [],
    canRead: false,
    canRecord: false,
    canRate: false,
    canManagePupils: false,
    canRunConference: false,
    ...overrides,
  };
}

/**
 * The conference summary carries every pupil in the class, every behaviour card with
 * its note, every teacher's free-text `comment`/`nextStep`, and every final rank.
 * The gate must therefore rest on `canRead` alone.
 */
describe('conference summary authorization', () => {
  it('refuses a teacher who is not responsible for the class', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    // A teacher who teaches 1B, asking about 2C. They have a teacherId — which is
    // exactly what defeated the previous `!access.canRead && !user.teacherId` guard.
    const user: Identity = { role: 'teacher', teacherId: 7 };
    expect(canReadConferenceSummary(user, access({ classId: 3 }))).toBe(false);
  });

  it('refuses a homeroom head of a different class', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(canReadConferenceSummary({ role: 'head_teacher', teacherId: 9 }, access())).toBe(false);
  });

  it('refuses a pupil-role account even if a teacherId is present', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(canReadConferenceSummary({ role: 'pupil', teacherId: 7 }, access())).toBe(false);
  });

  it('allows a teacher assigned to that class', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(canReadConferenceSummary({ role: 'teacher', teacherId: 7 }, access({ canRead: true }))).toBe(true);
  });

  it('allows the homeroom head of that class', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(
      canReadConferenceSummary({ role: 'head_teacher', teacherId: 9 }, access({ canRead: true, isKv: true })),
    ).toBe(true);
  });

  it('allows school leadership and the administrator', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(
      canReadConferenceSummary({ role: 'head_teacher', teacherId: 1 }, access({ canRead: true, isHeadmaster: true })),
    ).toBe(true);
    expect(canReadConferenceSummary({ role: 'admin' }, access({ canRead: true, isAdmin: true }))).toBe(true);
  });

  it('does not widen when the class does not exist', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    // `exists` is checked by the route before this gate; the gate must not read as
    // "permitted" merely because a caller can read *some* class.
    expect(canReadConferenceSummary({ role: 'teacher', teacherId: 7 }, access({ exists: false }))).toBe(false);
  });
});

describe('conference decision metadata', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.resetModules();
  });

  it('uses the actual recording instant separately from the planned meeting date', async () => {
    process.env.SMILE_ENV_FILE = 'no-such-env-file-for-conference-date-tests';
    process.env.OFFICIAL_CONFERENCE_DATE = '2099-11-03T21:59:00.000Z';
    vi.resetModules();
    const { createConferenceConfirmationMetadata } = await import('./conferences.js');
    const recordedAt = new Date('2026-10-07T14:00:00.000Z');

    const metadata = createConferenceConfirmationMetadata(recordedAt);

    expect(metadata.confirmedAt).toEqual(recordedAt);
    expect(metadata.overrideReason).toBe('Beschluss der Klassenkonferenz vom 2099-11-03');
  });
});

/**
 * The rank a pupil is shown is what the school records and prints, so these two
 * decisions are pinned as pure functions rather than only through the route, which
 * cannot be exercised without a database.
 */
describe('hours-weighted suggestion', () => {
  it('returns the strict leader', async () => {
    const { hoursWeightedSuggestion } = await import('./conferences.js');
    expect(hoursWeightedSuggestion(0, 8, 0)).toBe('Geselle');
    expect(hoursWeightedSuggestion(0, 0, 8)).toBe('Meister');
    expect(hoursWeightedSuggestion(8, 0, 0)).toBe('Lehrling');
    expect(hoursWeightedSuggestion(0, 6, 2)).toBe('Geselle');
  });

  it('returns null for a deadlocked three-way split instead of the top rank', async () => {
    const { hoursWeightedSuggestion } = await import('./conferences.js');
    // The regression: the old test was `hoursMeister >= hoursGeselle && >=
    // hoursLehrling`, so 1-1-1 produced MEISTER and a deadlocked conference recorded
    // the pupil at the top of the scale.
    expect(hoursWeightedSuggestion(1, 1, 1)).toBeNull();
  });

  it('returns null for a two-way tie', async () => {
    const { hoursWeightedSuggestion } = await import('./conferences.js');
    expect(hoursWeightedSuggestion(0, 4, 4)).toBeNull();
    expect(hoursWeightedSuggestion(4, 4, 0)).toBeNull();
  });

  it('returns null when nobody has voted', async () => {
    const { hoursWeightedSuggestion } = await import('./conferences.js');
    expect(hoursWeightedSuggestion(0, 0, 0)).toBeNull();
  });
});

describe('presented rank', () => {
  it('shows nothing when the conference has not decided', async () => {
    const { presentRank } = await import('./conferences.js');
    // Never back-filled with a computed value: an undecided pupil must look undecided.
    expect(presentRank(null, 'Geselle', false).presentedRank).toBeNull();
    expect(presentRank(undefined, null, false).presentedRank).toBeNull();
  });

  it('shows the recorded decision when there is one', async () => {
    const { presentRank } = await import('./conferences.js');
    expect(presentRank('Meister', 'Geselle', false).presentedRank).toBe('Meister');
  });

  it('demotes the confirmed rank when a red card is active', async () => {
    const { presentRank } = await import('./conferences.js');
    // The regression: the demotion used to be applied only to the computed threshold
    // rank, so a pupil confirmed as Meister kept Meister despite an active red card -
    // contradicting README.md, which states a red card causes an immediate demotion.
    expect(presentRank('Meister', 'Meister', true).presentedRank).toBe('Geselle');
    expect(presentRank('Geselle', 'Geselle', true).presentedRank).toBe('Lehrling');
  });

  it('never demotes below Lehrling', async () => {
    const { presentRank } = await import('./conferences.js');
    expect(presentRank('Lehrling', 'Lehrling', true).presentedRank).toBe('Lehrling');
  });

  it('reports the demotion so the screen can explain it', async () => {
    const { presentRank } = await import('./conferences.js');
    expect(presentRank('Meister', 'Meister', true).hasRedCardDemotion).toBe(true);
    expect(presentRank('Meister', 'Meister', false).hasRedCardDemotion).toBe(false);
    expect(presentRank(null, null, true).hasRedCardDemotion).toBe(false);
  });
});
