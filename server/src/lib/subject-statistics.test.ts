import { describe, expect, it } from 'vitest';
import {
  buildSubjectStatistics,
  calculateSubjectDistribution,
  type ClassSubjectAssignment,
  type RawEvaluation,
  type RawEvaluationItem,
  type RawPupil,
  type RawTeacher,
} from './subject-statistics.js';

describe('buildSubjectStatistics pure helper', () => {
  const pupilAnna: RawPupil = {
    id: 1,
    fullName: 'Anna Muster',
    classId: 10,
    className: '3a',
    grade: 3,
  };

  const teacherMiller: RawTeacher = {
    id: 101,
    fullName: 'Maria Miller',
    shortName: 'MIL',
  };

  const teacherSmith: RawTeacher = {
    id: 102,
    fullName: 'John Smith',
    shortName: 'SMI',
  };

  const teachersById = new Map<number, RawTeacher>([
    [101, teacherMiller],
    [102, teacherSmith],
  ]);

  it('assigned D/M with no evaluation emits D and M as pending (null rank, totalRated 0)', () => {
    const subjectsByClass = new Map<number, ClassSubjectAssignment[]>([
      [
        10,
        [
          { subjectCode: 'D', subjectName: 'Deutsch' },
          { subjectCode: 'M', subjectName: 'Mathematik' },
        ],
      ],
    ]);

    const result = buildSubjectStatistics(
      [pupilAnna],
      subjectsByClass,
      [],
      new Map(),
      teachersById,
      { viewerRole: 'teacher', viewerTeacherId: 101 },
    );

    expect(result).toHaveLength(1);
    const anna = result[0];
    expect(anna.subjectResults).toHaveLength(2);

    const dResult = anna.subjectResults.find((s) => s.subjectCode === 'D');
    expect(dResult).toBeDefined();
    expect(dResult?.subjectName).toBe('Deutsch');
    expect(dResult?.calculatedRank).toBeNull();
    expect(dResult?.positiveCount).toBe(0);
    expect(dResult?.totalRated).toBe(0);
    expect(dResult?.teacherVote).toBeNull();
    expect(dResult?.items).toEqual([]);

    const mResult = anna.subjectResults.find((s) => s.subjectCode === 'M');
    expect(mResult).toBeDefined();
    expect(mResult?.calculatedRank).toBeNull();
    expect(mResult?.totalRated).toBe(0);
  });

  it('evaluation subject with no current class assignment is retained in subjectResults', () => {
    const subjectsByClass = new Map<number, ClassSubjectAssignment[]>([
      [10, [{ subjectCode: 'D', subjectName: 'Deutsch' }]],
    ]);

    const evalPh: RawEvaluation = {
      id: 'eval-ph',
      pupilId: 1,
      classId: 10,
      subjectCode: 'PH',
      teacherId: 102,
      proposedStatus: 'Geselle',
      updatedAt: '2026-10-01T10:00:00Z',
    };

    const itemsByEval = new Map<string, RawEvaluationItem[]>([
      [
        'eval-ph',
        Array.from({ length: 8 }, (_, i) => ({
          id: `item-ph-${i}`,
          evaluationId: 'eval-ph',
          criterionId: 'crit-1',
          itemKey: `ph_${i + 1}`,
          rating: 'smile',
          version: 1,
          updatedByTeacherId: 102,
          updatedAt: '2026-10-01T10:00:00Z',
        })),
      ],
    ]);

    const result = buildSubjectStatistics(
      [pupilAnna],
      subjectsByClass,
      [evalPh],
      itemsByEval,
      teachersById,
      {},
    );

    const anna = result[0];
    const codes = anna.subjectResults.map((s) => s.subjectCode);
    expect(codes).toContain('D');
    expect(codes).toContain('PH');

    const ph = anna.subjectResults.find((s) => s.subjectCode === 'PH')!;
    expect(ph.subjectName).toBe('Physik');
    expect(ph.positiveCount).toBe(8);
    expect(ph.totalRated).toBe(8);
    expect(ph.calculatedRank).toBe('Geselle');
  });

  it('legacy alias SD and canonical D collapse into single canonical D subject result', () => {
    const subjectsByClass = new Map<number, ClassSubjectAssignment[]>([
      [10, [{ subjectCode: 'SD', subjectName: 'Deutsch' }]],
    ]);

    const evalD: RawEvaluation = {
      id: 'eval-d',
      pupilId: 1,
      classId: 10,
      subjectCode: 'D',
      teacherId: 101,
      updatedAt: '2026-10-01T10:00:00Z',
    };

    const itemsByEval = new Map<string, RawEvaluationItem[]>([
      [
        'eval-d',
        [
          {
            id: 'it-1',
            evaluationId: 'eval-d',
            criterionId: 'crit-1',
            itemKey: 'item_1',
            rating: 'smile',
            version: 1,
            updatedByTeacherId: 101,
            updatedAt: '2026-10-01T10:00:00Z',
          },
        ],
      ],
    ]);

    const result = buildSubjectStatistics(
      [pupilAnna],
      subjectsByClass,
      [evalD],
      itemsByEval,
      teachersById,
      {},
    );

    const anna = result[0];
    const dResults = anna.subjectResults.filter((s) => s.subjectCode === 'D');
    expect(dResults).toHaveLength(1);
    expect(anna.subjectResults.filter((s) => s.subjectCode === 'SD')).toHaveLength(0);
  });

  it('does not merge ratings across different subjects into one calculated rank', () => {
    // 10 positive items in D and 8 in M
    // Should NOT combine to 18 (Meister), but remain D: Geselle and M: Geselle
    const subjectsByClass = new Map<number, ClassSubjectAssignment[]>([
      [
        10,
        [
          { subjectCode: 'D', subjectName: 'Deutsch' },
          { subjectCode: 'M', subjectName: 'Mathematik' },
        ],
      ],
    ]);

    const evalD: RawEvaluation = {
      id: 'eval-d',
      pupilId: 1,
      classId: 10,
      subjectCode: 'D',
      teacherId: 101,
      updatedAt: '2026-10-01T10:00:00Z',
    };
    const evalM: RawEvaluation = {
      id: 'eval-m',
      pupilId: 1,
      classId: 10,
      subjectCode: 'M',
      teacherId: 102,
      updatedAt: '2026-10-01T10:00:00Z',
    };

    const itemsByEval = new Map<string, RawEvaluationItem[]>([
      [
        'eval-d',
        Array.from({ length: 10 }, (_, i) => ({
          id: `it-d-${i}`,
          evaluationId: 'eval-d',
          criterionId: 'c1',
          itemKey: `crit_${i + 1}`,
          rating: 'smile',
          version: 1,
          updatedByTeacherId: 101,
          updatedAt: '2026-10-01T10:00:00Z',
        })),
      ],
      [
        'eval-m',
        Array.from({ length: 8 }, (_, i) => ({
          id: `it-m-${i}`,
          evaluationId: 'eval-m',
          criterionId: 'c1',
          itemKey: `crit_${i + 1}`,
          rating: 'smile',
          version: 1,
          updatedByTeacherId: 102,
          updatedAt: '2026-10-01T10:00:00Z',
        })),
      ],
    ]);

    const result = buildSubjectStatistics(
      [pupilAnna],
      subjectsByClass,
      [evalD, evalM],
      itemsByEval,
      teachersById,
      {},
    );

    const anna = result[0];
    const d = anna.subjectResults.find((s) => s.subjectCode === 'D')!;
    const m = anna.subjectResults.find((s) => s.subjectCode === 'M')!;

    expect(d.positiveCount).toBe(10);
    expect(d.calculatedRank).toBe('Geselle');

    expect(m.positiveCount).toBe(8);
    expect(m.calculatedRank).toBe('Geselle');
  });

  it('reconciles duplicate item keys within canonical subject by newest updatedAt, not positive wins', () => {
    // Two evaluations resolving to D (e.g. legacy SD and D, or duplicate evaluations)
    // Older item (10:00) is 'smile' (positive)
    // Newer item (11:00) is 'struggle' (negative)
    // Newest MUST win: struggle wins, positiveCount should be 0, not 1!
    const subjectsByClass = new Map<number, ClassSubjectAssignment[]>([
      [10, [{ subjectCode: 'D', subjectName: 'Deutsch' }]],
    ]);

    const evalOld: RawEvaluation = {
      id: 'eval-old',
      pupilId: 1,
      classId: 10,
      subjectCode: 'SD',
      teacherId: 101,
      updatedAt: '2026-10-01T10:00:00Z',
    };
    const evalNew: RawEvaluation = {
      id: 'eval-new',
      pupilId: 1,
      classId: 10,
      subjectCode: 'D',
      teacherId: 101,
      updatedAt: '2026-10-01T11:00:00Z',
    };

    const itemsByEval = new Map<string, RawEvaluationItem[]>([
      [
        'eval-old',
        [
          {
            id: 'it-old',
            evaluationId: 'eval-old',
            criterionId: 'c1',
            itemKey: 'item_1',
            rating: 'smile',
            version: 1,
            updatedByTeacherId: 101,
            updatedAt: '2026-10-01T10:00:00Z',
          },
        ],
      ],
      [
        'eval-new',
        [
          {
            id: 'it-new',
            evaluationId: 'eval-new',
            criterionId: 'c1',
            itemKey: 'item_1',
            rating: 'struggle',
            version: 2,
            updatedByTeacherId: 101,
            updatedAt: '2026-10-01T11:00:00Z',
          },
        ],
      ],
    ]);

    const result = buildSubjectStatistics(
      [pupilAnna],
      subjectsByClass,
      [evalOld, evalNew],
      itemsByEval,
      teachersById,
      {},
    );

    const d = result[0].subjectResults.find((s) => s.subjectCode === 'D')!;
    expect(d.positiveCount).toBe(0);
    expect(d.totalRated).toBe(1);
    expect(d.calculatedRank).toBe('Lehrling');
  });

  it('evaluation with 0 rated items has calculatedRank null (pending), not Lehrling', () => {
    const subjectsByClass = new Map<number, ClassSubjectAssignment[]>([
      [10, [{ subjectCode: 'D', subjectName: 'Deutsch' }]],
    ]);

    const evalD: RawEvaluation = {
      id: 'eval-d',
      pupilId: 1,
      classId: 10,
      subjectCode: 'D',
      teacherId: 101,
      updatedAt: '2026-10-01T10:00:00Z',
    };

    // Item with rating 'n.b.' which is unrated
    const itemsByEval = new Map<string, RawEvaluationItem[]>([
      [
        'eval-d',
        [
          {
            id: 'it-nb',
            evaluationId: 'eval-d',
            criterionId: 'c1',
            itemKey: 'item_1',
            rating: 'n.b.',
            version: 1,
            updatedByTeacherId: 101,
            updatedAt: '2026-10-01T10:00:00Z',
          },
        ],
      ],
    ]);

    const result = buildSubjectStatistics(
      [pupilAnna],
      subjectsByClass,
      [evalD],
      itemsByEval,
      teachersById,
      {},
    );

    const d = result[0].subjectResults.find((s) => s.subjectCode === 'D')!;
    expect(d.totalRated).toBe(0);
    expect(d.calculatedRank).toBeNull();
  });

  it('withholds foreign comments when showForeignComments is false for a teacher', () => {
    const subjectsByClass = new Map<number, ClassSubjectAssignment[]>([
      [10, [{ subjectCode: 'D', subjectName: 'Deutsch' }]],
    ]);

    const evalD: RawEvaluation = {
      id: 'eval-d',
      pupilId: 1,
      classId: 10,
      subjectCode: 'D',
      teacherId: 102, // John Smith authored this
      comment: 'Sehr unruhig',
      nextStep: 'Konzentration ueben',
      updatedAt: '2026-10-01T10:00:00Z',
    };

    // Viewer is Maria Miller (teacherId 101)
    const result = buildSubjectStatistics(
      [pupilAnna],
      subjectsByClass,
      [evalD],
      new Map(),
      teachersById,
      {
        showForeignComments: false,
        viewerRole: 'teacher',
        viewerTeacherId: 101,
      },
    );

    const vote = result[0].subjectResults[0].teacherVote;
    expect(vote).toBeDefined();
    expect(vote?.notesWithheld).toBe(true);
    expect(vote?.comment).toBeNull();
    expect(vote?.nextStep).toBeNull();
  });

  it('keeps conference decision separate and does not overwrite subjectResults', () => {
    const subjectsByClass = new Map<number, ClassSubjectAssignment[]>([
      [10, [{ subjectCode: 'D', subjectName: 'Deutsch' }]],
    ]);

    const evalD: RawEvaluation = {
      id: 'eval-d',
      pupilId: 1,
      classId: 10,
      subjectCode: 'D',
      teacherId: 101,
      updatedAt: '2026-10-01T10:00:00Z',
    };

    // D has 2 positive items -> Lehrling
    const itemsByEval = new Map<string, RawEvaluationItem[]>([
      [
        'eval-d',
        Array.from({ length: 2 }, (_, i) => ({
          id: `it-${i}`,
          evaluationId: 'eval-d',
          criterionId: 'c1',
          itemKey: `it_${i + 1}`,
          rating: 'smile',
          version: 1,
          updatedByTeacherId: 101,
          updatedAt: '2026-10-01T10:00:00Z',
        })),
      ],
    ]);

    // Conference confirms Meister with override reason
    const result = buildSubjectStatistics(
      [pupilAnna],
      subjectsByClass,
      [evalD],
      itemsByEval,
      teachersById,
      {
        confirmedRanks: [
          { pupilId: 1, rank: 'Meister', overrideReason: 'Pädagogischer Beschluss' },
        ],
      },
    );

    const anna = result[0];
    expect(anna.conferenceDecision).toEqual({
      rank: 'Meister',
      isConfirmed: true,
      overrideReason: 'Pädagogischer Beschluss',
    });
    // D subject result is still Lehrling, NOT overwritten by conference decision!
    const d = anna.subjectResults.find((s) => s.subjectCode === 'D')!;
    expect(d.calculatedRank).toBe('Lehrling');
  });
});

describe('calculateSubjectDistribution helper', () => {
  it('counts only subject results with totalRated > 0 and does not count unrated/pending subjects', () => {
    const pupil1 = {
      id: 1,
      fullName: 'Pupil 1',
      classId: 10,
      className: '3a',
      grade: 3,
      subjectResults: [
        {
          subjectCode: 'D',
          subjectName: 'Deutsch',
          positiveCount: 15,
          totalRated: 18,
          calculatedRank: 'Meister' as const,
          teacherVote: null,
          items: [],
        },
        {
          subjectCode: 'M',
          subjectName: 'Mathematik',
          positiveCount: 9,
          totalRated: 18,
          calculatedRank: 'Geselle' as const,
          teacherVote: null,
          items: [],
        },
      ],
      conferenceDecision: null,
      isConfirmed: false,
      teacherVotes: [],
    };

    const pupil2 = {
      id: 2,
      fullName: 'Pupil 2',
      classId: 10,
      className: '3a',
      grade: 3,
      subjectResults: [
        {
          subjectCode: 'D',
          subjectName: 'Deutsch',
          positiveCount: 3,
          totalRated: 18,
          calculatedRank: 'Lehrling' as const,
          teacherVote: null,
          items: [],
        },
        {
          // Pending unrated subject: totalRated = 0, calculatedRank = null
          subjectCode: 'M',
          subjectName: 'Mathematik',
          positiveCount: 0,
          totalRated: 0,
          calculatedRank: null,
          teacherVote: null,
          items: [],
        },
      ],
      // Confirmed conference Meister should NOT count in subject distribution
      conferenceDecision: {
        rank: 'Meister' as const,
        isConfirmed: true as const,
        overrideReason: null,
      },
      isConfirmed: true,
      teacherVotes: [],
    };

    const dist = calculateSubjectDistribution([pupil1, pupil2]);
    // Rated subject results: D (Meister), M (Geselle), D (Lehrling) => total 3
    // pupil2's M is unrated => not counted
    // pupil2's conference Meister => not counted in subject distribution
    expect(dist.total).toBe(3);
    expect(dist.meister).toBe(1);
    expect(dist.geselle).toBe(1);
    expect(dist.lehrling).toBe(1);
    expect(dist.percentMeister).toBe(33);
    expect(dist.percentGeselle).toBe(33);
    expect(dist.percentLehrling).toBe(33);
  });
});
