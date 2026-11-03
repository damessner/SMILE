import { getRankVisuals } from '../../lib/conferenceEvidence';
import { itemVersionForSubject, scoreSubject, type AssessmentRank } from '../../lib/pupilItems';
import type { PupilWithData } from '../../types';
import type { BeobachtungsGridProps, GridSubject } from './types';

export async function settleAllWrites(writes: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(writes);
  const failedWrite = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failedWrite) throw failedWrite.reason;
}

export interface RankInfo {
  rank: AssessmentRank | null;
  color: string;
  barColor: string;
  pos: number;
}

// Compute live rank strictly from the configured rubric items for the active/specified subject.
// Rank colours come from the shared helper so the grid, the conference modal and the
// export can never drift into three different triples for one rank.
export function calculateRankFor(
  evaluations: PupilWithData['evaluations'],
  subjectCode: string,
  rubricItemKeys: string[],
): RankInfo {
  const scored = scoreSubject(evaluations, subjectCode, rubricItemKeys);
  const { badgeBg, barColor } = getRankVisuals(scored.rank);
  return { rank: scored.rank, color: badgeBg, barColor, pos: scored.positiveCount };
}

export interface HoursInfo {
  hours: number;
  weight: number;
  isTeamTeaching: boolean;
  label: string;
}

export function getCurrentHoursInfo(
  mySubjects: GridSubject[],
  isAllSubjectsMode: boolean,
  activeSubjectCode: string,
): HoursInfo | null {
  if (!mySubjects || mySubjects.length === 0) return null;
  if (isAllSubjectsMode) {
    const totalHours = mySubjects.reduce((sum, s) => sum + (s.hours || 0), 0);
    const totalWeight = mySubjects.reduce(
      (sum, s) => sum + (s.hours || 0) * (s.isCoreSmile ? 2 : 1),
      0
    );
    if (totalHours === 0) return null;
    return {
      hours: totalHours,
      weight: totalWeight,
      isTeamTeaching: mySubjects.some((s) => s.isCoreSmile),
      label: 'Gesamt (alle deine Fächer)',
    };
  }
  const currentSub = mySubjects.find((s) => s.code === activeSubjectCode) || mySubjects[0];
  if (!currentSub || !currentSub.hours) return null;
  return {
    hours: currentSub.hours,
    weight: currentSub.hours * (currentSub.isCoreSmile ? 2 : 1),
    isTeamTeaching: currentSub.isCoreSmile,
    label: currentSub.name,
  };
}

export interface ItemWrite {
  criterionId: string;
  itemKey: string;
  rating: string;
}

export async function writeItemsForSubjects(
  pupil: PupilWithData,
  items: ItemWrite[],
  subjectCodes: string[],
  onRate: BeobachtungsGridProps['onRate'],
  onBatchUpdate: BeobachtungsGridProps['onBatchUpdate'],
): Promise<void> {
  for (const subCode of subjectCodes) {
    if (onBatchUpdate) {
      const versionedItems = items.map((item) => ({
        ...item,
        version: itemVersionForSubject(pupil.evaluations, subCode, item.itemKey),
      }));
      await onBatchUpdate(pupil.id, versionedItems, subCode);
    } else {
      await settleAllWrites(items.map((it) =>
        Promise.resolve(onRate(
          pupil.id,
          it.criterionId,
          it.itemKey,
          it.rating,
          itemVersionForSubject(pupil.evaluations, subCode, it.itemKey),
          subCode,
        )),
      ));
    }
  }
}
