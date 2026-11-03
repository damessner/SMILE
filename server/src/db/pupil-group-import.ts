import { normalizeKnownSubject } from '../utils/subject.js';

export interface RawPupilGroupEntry {
  name?: string;
  classId: number;
  className?: string;
  subjects: Record<
    string,
    {
      teachers?: number[];
      groups?: string[];
    }
  >;
}

export type RawPupilGroupMapping = Record<string, RawPupilGroupEntry>;

export interface ParsedPupilSubjectTeacher {
  pupilId: number;
  classId: number;
  subjectCode: string;
  teacherId: number;
  groupName: string | null;
}

export interface ParsePupilGroupResult {
  records: ParsedPupilSubjectTeacher[];
  totalRawSubjectTeacherPairs: number;
  deduplicatedCount: number;
  unmappedSubjects: string[];
}

/**
 * Parses WebUntis pupil-group mapping export into canonical `pupil_subject_teachers` records.
 *
 * Subject codes are strictly normalized with `normalizeKnownSubject()` adhering to Invariant 1.
 * Rows with duplicate (pupilId, canonicalSubjectCode, teacherId) are unified, preserving group names.
 */
export function parsePupilGroupMappings(
  data: RawPupilGroupMapping | string
): ParsePupilGroupResult {
  const raw: RawPupilGroupMapping = typeof data === 'string' ? JSON.parse(data) : data;

  const recordsMap = new Map<string, ParsedPupilSubjectTeacher>();
  let totalRawPairs = 0;
  const unmappedSubjectsSet = new Set<string>();

  for (const [pupilIdStr, p] of Object.entries(raw)) {
    const pupilId = Number(pupilIdStr);
    if (!Number.isInteger(pupilId) || pupilId <= 0) continue;

    const classId = Number(p.classId);
    if (!Number.isInteger(classId) || classId <= 0) continue;

    if (!p.subjects || typeof p.subjects !== 'object') continue;

    for (const [rawSub, sData] of Object.entries(p.subjects)) {
      const norm = normalizeKnownSubject(rawSub);
      if (!norm) {
        unmappedSubjectsSet.add(rawSub);
        continue;
      }

      const teachers = Array.isArray(sData.teachers) ? sData.teachers : [];
      const groups = Array.isArray(sData.groups) ? sData.groups.filter(Boolean) : [];
      const primaryGroup = groups.length > 0 ? groups.join(', ') : null;

      for (const tId of teachers) {
        const teacherId = Number(tId);
        if (!Number.isInteger(teacherId) || teacherId <= 0) continue;

        totalRawPairs++;
        const key = `${pupilId}:${norm.code}:${teacherId}`;

        const existing = recordsMap.get(key);
        if (existing) {
          // If existing has no group name, update it with primaryGroup
          if (!existing.groupName && primaryGroup) {
            existing.groupName = primaryGroup;
          } else if (existing.groupName && primaryGroup && !existing.groupName.includes(primaryGroup)) {
            existing.groupName = `${existing.groupName}, ${primaryGroup}`;
          }
        } else {
          recordsMap.set(key, {
            pupilId,
            classId,
            subjectCode: norm.code,
            teacherId,
            groupName: primaryGroup,
          });
        }
      }
    }
  }

  const records = Array.from(recordsMap.values());

  return {
    records,
    totalRawSubjectTeacherPairs: totalRawPairs,
    deduplicatedCount: records.length,
    unmappedSubjects: Array.from(unmappedSubjectsSet),
  };
}
