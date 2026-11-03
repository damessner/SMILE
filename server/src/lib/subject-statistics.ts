import { config } from '../config.js';
import {
  calculateRank,
  isCountedRating,
  isPositiveRating,
  type Rank,
} from './ranking.js';
import { normalizeSubject } from '../utils/subject.js';

export interface RawPupil {
  id: number;
  fullName: string;
  classId: number;
  className: string;
  grade: number;
}

export interface ClassSubjectAssignment {
  subjectCode: string;
  subjectName?: string;
}

export interface RawEvaluation {
  id: string;
  pupilId: number;
  classId: number;
  subjectCode: string;
  teacherId: number;
  proposedStatus?: string | null;
  nextStep?: string | null;
  comment?: string | null;
  updatedAt?: Date | string;
}

export interface RawEvaluationItem {
  id: string;
  evaluationId: string;
  criterionId: string;
  itemKey: string;
  rating: string;
  version: number;
  updatedByTeacherId: number | null;
  updatedAt: Date | string;
}

export interface RawTeacher {
  id: number;
  fullName?: string | null;
  shortName?: string | null;
}

export interface TeacherVote {
  teacherId: number;
  teacherShort: string;
  teacherName: string;
  subjectCode: string;
  subjectName: string;
  isCore: boolean;
  proposedStatus: string | null;
  nextStep: string | null;
  comment: string | null;
  notesWithheld: boolean;
  positiveCount: number;
  totalRated: number;
  updatedAt: Date | string;
}

export interface FormattedPupilItem extends RawEvaluationItem {
  updatedBy: string | null;
}

export interface SubjectResult {
  subjectCode: string;
  subjectName: string;
  positiveCount: number;
  totalRated: number;
  calculatedRank: Rank | null;
  teacherVote: TeacherVote | null;
  items: FormattedPupilItem[];
}

export interface ConferenceDecision {
  rank: Rank;
  isConfirmed: true;
  overrideReason: string | null;
}

export interface PupilStatisticsSummary {
  id: number;
  fullName: string;
  classId: number;
  className: string;
  grade: number;
  subjectResults: SubjectResult[];
  conferenceDecision: ConferenceDecision | null;
  isConfirmed: boolean;
  overrideReason?: string | null;
  teacherVotes: TeacherVote[];
}

export interface BuildSubjectStatisticsOptions {
  showForeignComments?: boolean;
  viewerRole?: string;
  viewerTeacherId?: number | null;
  confirmedRanks?: Array<{ pupilId: number; rank: string; overrideReason?: string | null }>;
}

export interface SubjectDistribution {
  lehrling: number;
  geselle: number;
  meister: number;
  total: number;
  percentLehrling: number;
  percentGeselle: number;
  percentMeister: number;
}

const CORE_SUBJECT_ORDER: Record<string, number> = {
  D: 1,
  M: 2,
  E: 3,
};

function compareSubjects(a: { code: string }, b: { code: string }): number {
  const orderA = CORE_SUBJECT_ORDER[a.code] ?? 100;
  const orderB = CORE_SUBJECT_ORDER[b.code] ?? 100;
  if (orderA !== orderB) return orderA - orderB;
  return a.code.localeCompare(b.code);
}

function toTimestamp(date: Date | string | undefined): number {
  if (!date) return 0;
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

/**
 * Builds subject-scoped statistics for pupils.
 * Deduplicates rubric items by newest update within each canonical subject,
 * ensures 0-rated subjects have a null rank, and keeps conference decisions separate.
 */
export function buildSubjectStatistics(
  pupils: RawPupil[],
  subjectsByClass: Map<number, ClassSubjectAssignment[]>,
  evaluations: RawEvaluation[],
  itemsByEvaluationId: Map<string, RawEvaluationItem[]>,
  teachersById: Map<number, RawTeacher>,
  options: BuildSubjectStatisticsOptions = {},
): PupilStatisticsSummary[] {
  const confirmedMap = new Map(
    (options.confirmedRanks ?? []).map((r) => [r.pupilId, r]),
  );

  return pupils.map((pupil) => {
    const pupilEvals = evaluations.filter((e) => e.pupilId === pupil.id);
    const classAssignments = subjectsByClass.get(pupil.classId) ?? [];

    // Canonical subject dictionary for this pupil (assignments + existing evaluations)
    const subjectMap = new Map<string, { code: string; name: string; isCoreSmile: boolean }>();

    for (const ca of classAssignments) {
      const norm = normalizeSubject(ca.subjectCode);
      if (!subjectMap.has(norm.code)) {
        subjectMap.set(norm.code, norm);
      }
    }

    for (const ev of pupilEvals) {
      const norm = normalizeSubject(ev.subjectCode);
      if (!subjectMap.has(norm.code)) {
        subjectMap.set(norm.code, norm);
      }
    }

    const canonicalSubjects = Array.from(subjectMap.values()).sort(compareSubjects);

    const subjectResults: SubjectResult[] = canonicalSubjects.map((subject) => {
      // Find evaluations for this canonical subject
      const matchingEvals = pupilEvals.filter(
        (e) => normalizeSubject(e.subjectCode).code === subject.code,
      );

      if (matchingEvals.length === 0) {
        return {
          subjectCode: subject.code,
          subjectName: subject.name,
          positiveCount: 0,
          totalRated: 0,
          calculatedRank: null,
          teacherVote: null,
          items: [],
        };
      }

      // Sort evaluations newest first
      const sortedEvals = [...matchingEvals].sort(
        (a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt),
      );
      const latestEval = sortedEvals[0];

      // Gather and deduplicate items across matching evaluations by itemKey
      const allItems = matchingEvals.flatMap((e) => itemsByEvaluationId.get(e.id) ?? []);
      const itemsByKey = new Map<string, RawEvaluationItem>();

      for (const item of allItems) {
        const existing = itemsByKey.get(item.itemKey);
        if (!existing) {
          itemsByKey.set(item.itemKey, item);
        } else {
          const itemTime = toTimestamp(item.updatedAt);
          const existingTime = toTimestamp(existing.updatedAt);
          if (itemTime > existingTime) {
            itemsByKey.set(item.itemKey, item);
          } else if (itemTime === existingTime) {
            if (item.version > existing.version) {
              itemsByKey.set(item.itemKey, item);
            } else if (item.version === existing.version && item.id > existing.id) {
              itemsByKey.set(item.itemKey, item);
            }
          }
        }
      }

      const deduplicatedItems = Array.from(itemsByKey.values());

      const formattedItems: FormattedPupilItem[] = deduplicatedItems.map((it) => {
        const updater =
          it.updatedByTeacherId != null ? teachersById.get(it.updatedByTeacherId) : undefined;
        return {
          ...it,
          updatedBy: updater?.fullName || updater?.shortName || null,
        };
      });

      const positiveCount = deduplicatedItems.filter((i) => isPositiveRating(i.rating)).length;
      const totalRated = deduplicatedItems.filter((i) => isCountedRating(i.rating)).length;

      const calculatedRank = totalRated > 0 ? calculateRank(positiveCount, false).finalRank : null;

      // Build teacherVote
      const teacher =
        latestEval.teacherId != null ? teachersById.get(latestEval.teacherId) : undefined;
      const isOwn =
        latestEval.teacherId != null &&
        options.viewerTeacherId != null &&
        latestEval.teacherId === options.viewerTeacherId;

      const showNotes =
        options.showForeignComments !== undefined
          ? options.showForeignComments || isOwn
          : config.statisticsShowForeignComments ||
            isOwn ||
            (options.viewerRole !== undefined && options.viewerRole !== 'teacher');

      const teacherVote: TeacherVote = {
        teacherId: latestEval.teacherId,
        teacherShort: teacher?.shortName || 'LEH',
        teacherName: teacher?.fullName || 'Fachlehrer',
        subjectCode: subject.code,
        subjectName: subject.name,
        isCore: subject.isCoreSmile,
        proposedStatus: latestEval.proposedStatus ?? null,
        nextStep: showNotes ? latestEval.nextStep ?? null : null,
        comment: showNotes ? latestEval.comment ?? null : null,
        notesWithheld: !showNotes,
        positiveCount,
        totalRated,
        updatedAt: latestEval.updatedAt ?? new Date(),
      };

      return {
        subjectCode: subject.code,
        subjectName: subject.name,
        positiveCount,
        totalRated,
        calculatedRank,
        teacherVote,
        items: formattedItems,
      };
    });

    const confirmed = confirmedMap.get(pupil.id);
    const conferenceDecision: ConferenceDecision | null = confirmed
      ? {
          rank: confirmed.rank as Rank,
          isConfirmed: true,
          overrideReason: confirmed.overrideReason ?? null,
        }
      : null;

    const teacherVotes = subjectResults
      .map((sr) => sr.teacherVote)
      .filter((v): v is TeacherVote => v !== null);

    return {
      id: pupil.id,
      fullName: pupil.fullName,
      classId: pupil.classId,
      className: pupil.className,
      grade: pupil.grade,
      subjectResults,
      conferenceDecision,
      isConfirmed: !!confirmed,
      overrideReason: confirmed?.overrideReason ?? null,
      teacherVotes,
    };
  });
}

/**
 * Calculates distribution over rated pupil-subject results (totalRated > 0).
 */
export function calculateSubjectDistribution(
  pupils: PupilStatisticsSummary[],
): SubjectDistribution {
  let lehrling = 0;
  let geselle = 0;
  let meister = 0;

  for (const pupil of pupils) {
    for (const sr of pupil.subjectResults) {
      if (sr.totalRated > 0 && sr.calculatedRank !== null) {
        if (sr.calculatedRank === 'Meister') meister++;
        else if (sr.calculatedRank === 'Geselle') geselle++;
        else if (sr.calculatedRank === 'Lehrling') lehrling++;
      }
    }
  }

  const total = lehrling + geselle + meister;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return {
    lehrling,
    geselle,
    meister,
    total,
    percentLehrling: pct(lehrling),
    percentGeselle: pct(geselle),
    percentMeister: pct(meister),
  };
}
