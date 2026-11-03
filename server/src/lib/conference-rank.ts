import { normalizeSubject } from '../utils/subject.js';
import type { Rank } from './ranking.js';

/**
 * Hours-weighted pupil rank used by the conference.
 *
 * These helpers live outside `routes/conferences.ts` because the notification
 * path also needs the pupil-level rank. Ranks are a property of the pupil, not
 * of a single subject: the conference suggestion is the strict leader of the
 * submitted teacher votes, weighted by the lessons those teachers teach.
 */

/**
 * Hours-weighted suggestion from the three accumulated weight buckets.
 *
 * A suggestion requires a **single strict leader**. A tie or a three-way split
 * returns null, which the screen renders as "keine Mehrheit" so the chair
 * decides rather than inheriting an answer. The previous implementation
 * resolved ties upward, so a 1-1-1 split produced Meister.
 */
export function hoursWeightedSuggestion(
  hoursLehrling: number,
  hoursGeselle: number,
  hoursMeister: number,
): Rank | null {
  const buckets = [
    { rank: 'Lehrling' as const, hours: hoursLehrling },
    { rank: 'Geselle' as const, hours: hoursGeselle },
    { rank: 'Meister' as const, hours: hoursMeister },
  ];
  const top = Math.max(hoursLehrling, hoursGeselle, hoursMeister);
  if (top <= 0) return null;
  const leaders = buckets.filter((b) => b.hours === top);
  return leaders.length === 1 ? leaders[0]!.rank : null;
}

/** The rank to present for a pupil, after the red-card demotion. */
export interface ConferenceTeacherVote {
  teacherId: number | null;
  teacherShort: string;
  teacherName: string;
  subjectCode: string;
  proposedStatus: string | null;
  isSubmitted: boolean;
  submittedAt: Date | null;
  positiveCount: number;
  totalRated: number;
  hours: number;
  weight: number;
  isTeamTeaching: boolean;
  nextStep?: string | null;
  comment?: string | null;
}

export interface SubmittedTeacherVoteSummary {
  teacherVotes: ConferenceTeacherVote[];
  submittedTeachers: number;
  voteCounts: Record<Rank, number>;
  hours: Record<Rank, number> & { total: number };
  suggestedRankByHours: Rank | null;
}

/**
 * Only submitted evaluations are ballots. Keep withdrawn proposals in the
 * teacher detail as pending, but exclude them from participation and all rank
 * counts/weights. Team-teaching weight is based on submitted teachers only.
 */
export function summarizeSubmittedTeacherVotes(
  teacherVotes: ConferenceTeacherVote[],
): SubmittedTeacherVoteSummary {
  const submitted = teacherVotes.filter((vote) => vote.isSubmitted);
  const submittedCoreTeacherCounts: Record<string, number> = { D: 0, M: 0, E: 0 };
  for (const vote of submitted) {
    const subject = normalizeSubject(vote.subjectCode);
    if (subject.isCoreSmile && subject.code in submittedCoreTeacherCounts) {
      submittedCoreTeacherCounts[subject.code] = (submittedCoreTeacherCounts[subject.code] ?? 0) + 1;
    }
  }

  let hoursLehrling = 0;
  let hoursGeselle = 0;
  let hoursMeister = 0;
  const teacherVotesWithSubmittedWeights = teacherVotes.map((vote) => {
    if (!vote.isSubmitted) {
      return { ...vote, proposedStatus: null, nextStep: null, comment: null };
    }

    const normalized = normalizeSubject(vote.subjectCode);
    const weight = normalized.isCoreSmile && submittedCoreTeacherCounts[normalized.code] === 1
      ? vote.hours * 2
      : vote.hours;
    if (vote.proposedStatus === 'Lehrling') hoursLehrling += weight;
    else if (vote.proposedStatus === 'Geselle') hoursGeselle += weight;
    else if (vote.proposedStatus === 'Meister') hoursMeister += weight;
    return { ...vote, weight };
  });

  return {
    teacherVotes: teacherVotesWithSubmittedWeights,
    submittedTeachers: new Set(submitted.map((vote) => vote.teacherId)).size,
    voteCounts: {
      Lehrling: submitted.filter((vote) => vote.proposedStatus === 'Lehrling').length,
      Geselle: submitted.filter((vote) => vote.proposedStatus === 'Geselle').length,
      Meister: submitted.filter((vote) => vote.proposedStatus === 'Meister').length,
    },
    hours: {
      Lehrling: hoursLehrling,
      Geselle: hoursGeselle,
      Meister: hoursMeister,
      total: hoursLehrling + hoursGeselle + hoursMeister,
    },
    suggestedRankByHours: hoursWeightedSuggestion(hoursLehrling, hoursGeselle, hoursMeister),
  };
}
