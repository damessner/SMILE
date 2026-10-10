import { describe, expect, it } from 'vitest';
import { buildSubjectEvidence } from './subject-evidence.js';

/**
 * One evidence row per canonical subject.
 *
 * The conference summary used to map every evaluation row of a pupil into its own
 * entry, so a pupil carrying the legacy alias `SD` beside `D` — or two co-teachers
 * in the same core subject — produced two bars for one subject, and the client
 * rendered them side by side under the same name. The client already resolves a
 * subject through its alias table, so the server must agree or the summary
 * contradicts the grid a teacher is looking at.
 */
describe('buildSubjectEvidence', () => {
  const row = (subjectCode: string, positiveCount: number, totalRated = 4, teacherShort = 'KV', updatedAt?: string) => ({
    subjectCode,
    positiveCount,
    totalRated,
    teacherShort,
    updatedAt,
  });

  it('keeps one entry per canonical subject', () => {
    const evidence = buildSubjectEvidence([
      row('D', 3, 4, 'KV'),
      row('SD', 5, 4, 'MED'),
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.subjectCode).toBe('D');
  });

  it('resolves duplicates to the newest updated_at', () => {
    const evidence = buildSubjectEvidence([
      row('D', 2, 4, 'KV', '2026-01-01T00:00:00.000Z'),
      row('SD', 5, 4, 'MED', '2026-03-01T00:00:00.000Z'),
    ]);

    // The older row loses even though it carries the lower positive count: the
    // winner is chosen by recency, never by rating value.
    expect(evidence[0]!.positiveCount).toBe(5);
    expect(evidence[0]!.teacherShort).toBe('MED');
  });

  it('keeps the first row when timestamps tie', () => {
    const evidence = buildSubjectEvidence([
      row('D', 2, 4, 'KV', '2026-03-01T00:00:00.000Z'),
      row('SD', 5, 4, 'MED', '2026-03-01T00:00:00.000Z'),
    ]);

    expect(evidence[0]!.positiveCount).toBe(2);
    expect(evidence[0]!.teacherShort).toBe('KV');
  });

  it('keeps distinct subjects apart', () => {
    const evidence = buildSubjectEvidence([row('D', 3), row('M', 2), row('E', 1)]);

    expect(evidence.map((e) => e.subjectCode)).toEqual(['D', 'M', 'E']);
    expect(evidence.map((e) => e.positiveCount)).toEqual([3, 2, 1]);
  });

  it('preserves the arrival order of the surviving subjects', () => {
    const evidence = buildSubjectEvidence([row('M', 2), row('D', 3)]);

    expect(evidence.map((e) => e.subjectCode)).toEqual(['M', 'D']);
  });

  it('reports the subject name of the surviving row', () => {
    const evidence = buildSubjectEvidence([row('D', 3)]);

    expect(evidence[0]!.subjectName).toBeTruthy();
    expect(evidence[0]!.subjectName).not.toBe('D');
  });

  it('returns nothing for an empty pupil', () => {
    expect(buildSubjectEvidence([])).toEqual([]);
  });
});
