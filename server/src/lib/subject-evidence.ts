/**
 * Per-subject rubric evidence for the conference summary.
 *
 * A pupil's evaluations are not one-per-subject: the legacy alias `SD` sits beside
 * `D` in the table, and a core subject is legitimately rated by both co-teachers.
 * Mapping those rows straight into evidence produced one entry per row, so the
 * conference screen showed duplicate bars for a single subject. This module
 * collapses them to the canonical subject, which is the rule the client already
 * applies through its own alias table.
 */

import { normalizeSubject } from '../utils/subject.js';

export interface SubjectEvidenceInput {
  /** Raw subject code as stored on the evaluation, not necessarily canonical. */
  subjectCode: string;
  positiveCount: number;
  totalRated: number;
  teacherShort: string;
  /** When the evaluation was last written; newest wins for a duplicated subject. */
  updatedAt?: string | Date | null;
}

export interface SubjectEvidenceEntry {
  subjectCode: string;
  subjectName: string;
  positiveCount: number;
  totalRated: number;
  teacherShort: string;
}

/**
 * One evidence entry per canonical subject.
 *
 * The surviving row is the newest by `updatedAt`; equal timestamps keep the row
 * that arrived first, and a missing timestamp sorts oldest. Never the row with
 * the higher or lower positive count — the choice must not be able to bias what
 * the conference reads as evidence.
 */
export function buildSubjectEvidence(rows: SubjectEvidenceInput[]): SubjectEvidenceEntry[] {
  const bySubject = new Map<string, { row: SubjectEvidenceInput; at: number }>();

  for (const row of rows) {
    const subject = normalizeSubject(row.subjectCode);
    const at = row.updatedAt ? new Date(row.updatedAt).getTime() : Number.NEGATIVE_INFINITY;
    const timestamp = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;

    const existing = bySubject.get(subject.code);
    if (!existing) {
      bySubject.set(subject.code, { row, at: timestamp });
      continue;
    }
    if (timestamp > existing.at) {      bySubject.set(subject.code, { row, at: timestamp });
    }
  }

  return [...bySubject.values()].map(({ row }) => ({
    subjectCode: normalizeSubject(row.subjectCode).code,
    subjectName: normalizeSubject(row.subjectCode).name,
    positiveCount: row.positiveCount,
    totalRated: row.totalRated,
    teacherShort: row.teacherShort,
  }));
}
