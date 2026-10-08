/**
 * What the conference screen is allowed to claim about a pupil's votes.
 *
 * The previous screen showed "8 von 9 Stimmen dafür" beside an hours-weighted split that
 * disagreed with it. The headline came from the class roster minus a counter an
 * administrator typed by hand, so a teacher who never opened the app counted as agreeing.
 *
 * Everything here is derived from evaluations that were actually submitted. A teacher who
 * has not voted is not counted as agreeing, not counted as disagreeing, and not hidden:
 * they appear as a missing participant, which is the thing a conference chair needs to
 * chase before a decision is recorded.
 */

export interface VoteStatLike {
  hoursLehrling?: number;
  hoursGeselle?: number;
  hoursMeister?: number;
  totalVotedHours?: number;
  pctLehrling?: number;
  pctGeselle?: number;
  pctMeister?: number;
}

export interface ParticipationLike {
  submittedTeachers: number;
  eligibleTeachers: number;
  teachersMissing: number;
}

export interface ParticipationSummary {
  /** e.g. "6 von 9 Lehrkräften haben abgegeben", or the empty-state label. */
  headline: string;
  /** e.g. "3 haben noch nicht abgegeben" — empty when everyone voted. */
  missing: string;
  /** True when nothing has been submitted yet, so no share may be presented at all. */
  hasNoVotes: boolean;
  /** Hours-weighted split, only meaningful when `hasNoVotes` is false. */
  share: { Lehrling: number; Geselle: number; Meister: number };
  /** Total weighted hours behind the split, or 0 when nothing was submitted. */
  totalVotedHours: number;
}

export function describeParticipation(
  participation: ParticipationLike | undefined,
  voteStats: VoteStatLike | undefined
): ParticipationSummary {
  const submitted = participation?.submittedTeachers ?? 0;
  const eligible = participation?.eligibleTeachers ?? 0;
  // Clamp to the roster size: a payload claiming nine missing teachers in a two-teacher
  // class is either stale or wrong, and echoing it would print a number nobody can act on.
  const reportedMissing = participation?.teachersMissing ?? eligible - submitted;
  const missing = Math.min(Math.max(0, eligible), Math.max(0, reportedMissing));
  const totalVotedHours = voteStats?.totalVotedHours ?? 0;

  return {
    headline:
      submitted > 0
        ? `${submitted} von ${eligible} Lehrkräften haben abgegeben`
        : 'Noch keine Bewertung abgegeben',
    missing: missing > 0 ? `${missing} haben noch nicht abgegeben` : '',
    hasNoVotes: submitted === 0,
    share: {
      Lehrling: voteStats?.pctLehrling ?? 0,
      Geselle: voteStats?.pctGeselle ?? 0,
      Meister: voteStats?.pctMeister ?? 0,
    },
    totalVotedHours,
  };
}