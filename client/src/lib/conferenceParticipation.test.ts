import { describe, expect, it } from 'vitest';
import { describeParticipation } from './conferenceParticipation';

describe('describeParticipation', () => {
  it('counts only teachers who actually submitted', () => {
    const summary = describeParticipation(
      { submittedTeachers: 5, eligibleTeachers: 9, teachersMissing: 4 },
      { pctLehrling: 0, pctGeselle: 100, pctMeister: 0, totalVotedHours: 8 }
    );

    // The headline must not be restated as "5 of 9 agree" — 4 people never voted, which is
    // a different fact from disagreeing.
    expect(summary.headline).toBe('5 von 9 Lehrkräften haben abgegeben');
    expect(summary.missing).toBe('4 haben noch nicht abgegeben');
    expect(summary.share.Geselle).toBe(100);
  });

  it('refuses to present a share when nothing was submitted', () => {
    const summary = describeParticipation(
      { submittedTeachers: 0, eligibleTeachers: 9, teachersMissing: 9 },
      undefined
    );

    expect(summary.hasNoVotes).toBe(true);
    expect(summary.headline).toBe('Noch keine Bewertung abgegeben');
    // No percentages may appear, or they would be an invented 0/0.
    expect(summary.totalVotedHours).toBe(0);
  });

  it('drops the missing note once everyone has voted', () => {
    const summary = describeParticipation(
      { submittedTeachers: 9, eligibleTeachers: 9, teachersMissing: 0 },
      { pctLehrling: 50, pctGeselle: 50, pctMeister: 0 }
    );

    expect(summary.missing).toBe('');
    expect(summary.hasNoVotes).toBe(false);
  });

  it('survives a payload with no participation block at all', () => {
    // A client talking to an older server must show "no data" rather than a fabricated tally.
    const summary = describeParticipation(undefined, undefined);
    expect(summary.hasNoVotes).toBe(true);
    expect(summary.headline).toBe('Noch keine Bewertung abgegeben');
  });

  it('never reports more missing teachers than the roster holds', () => {
    const summary = describeParticipation(
      { submittedTeachers: 0, eligibleTeachers: 2, teachersMissing: 9 },
      undefined
    );
    expect(summary.missing).toBe('2 haben noch nicht abgegeben');
  });
});