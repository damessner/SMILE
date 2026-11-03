import { describe, expect, it } from 'vitest';
import { parsePupilGroupMappings } from './pupil-group-import.js';

describe('parsePupilGroupMappings', () => {
  it('normalizes subject codes to canonical identifiers (Invariant 1)', () => {
    const input = {
      '101': {
        name: 'Max Mustermann',
        classId: 445,
        className: '2F',
        subjects: {
          'DigGB': { teachers: [130], groups: ['DigGB_2F_STA'] },
          'TUD': { teachers: [247], groups: ['TUD_2F_AKU'] },
          'R KATH': { teachers: [265], groups: ['RKATH_2F_LOM'] },
          'ITAL': { teachers: [99], groups: ['ITAL_2F'] },
        },
      },
    };

    const result = parsePupilGroupMappings(input);
    expect(result.unmappedSubjects).toEqual([]);
    expect(result.records).toHaveLength(4);

    const diggb = result.records.find((r) => r.subjectCode === 'DIGGB');
    expect(diggb).toEqual({
      pupilId: 101,
      classId: 445,
      subjectCode: 'DIGGB',
      teacherId: 130,
      groupName: 'DigGB_2F_STA',
    });

    const rkath = result.records.find((r) => r.subjectCode === 'RKATH');
    expect(rkath).toEqual({
      pupilId: 101,
      classId: 445,
      subjectCode: 'RKATH',
      teacherId: 265,
      groupName: 'RKATH_2F_LOM',
    });
  });

  it('deduplicates multiple entries that resolve to the same canonical subject and teacher', () => {
    const input = {
      '102': {
        name: 'Anna Schmidt',
        classId: 445,
        className: '2F',
        subjects: {
          'D': { teachers: [28], groups: ['D_2F'] },
          'SD': { teachers: [28], groups: ['SD_2F'] },
          'BFUD': { teachers: [28], groups: ['BFUD_2F'] },
        },
      },
    };

    const result = parsePupilGroupMappings(input);
    expect(result.totalRawSubjectTeacherPairs).toBe(3);
    expect(result.deduplicatedCount).toBe(1);
    expect(result.records[0]).toEqual({
      pupilId: 102,
      classId: 445,
      subjectCode: 'D',
      teacherId: 28,
      groupName: 'D_2F, SD_2F, BFUD_2F',
    });
  });

  it('handles team teaching with multiple teachers in the same subject', () => {
    const input = {
      '103': {
        name: 'Lukas Gruber',
        classId: 445,
        className: '2F',
        subjects: {
          'E': { teachers: [37, 237], groups: ['E_2F'] },
        },
      },
    };

    const result = parsePupilGroupMappings(input);
    expect(result.records).toHaveLength(2);
    expect(result.records).toEqual(
      expect.arrayContaining([
        { pupilId: 103, classId: 445, subjectCode: 'E', teacherId: 37, groupName: 'E_2F' },
        { pupilId: 103, classId: 445, subjectCode: 'E', teacherId: 237, groupName: 'E_2F' },
      ])
    );
  });

  it('skips unknown subjects and records them in unmappedSubjects', () => {
    const input = {
      '104': {
        name: 'Test Student',
        classId: 445,
        subjects: {
          'UNKNOWN_SUBJECT_XYZ': { teachers: [12], groups: ['XYZ'] },
          'M': { teachers: [50], groups: ['M_2F'] },
        },
      },
    };

    const result = parsePupilGroupMappings(input);
    expect(result.unmappedSubjects).toEqual(['UNKNOWN_SUBJECT_XYZ']);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].subjectCode).toBe('M');
  });

  it('ignores invalid IDs gracefully', () => {
    const input = {
      'invalid-id': {
        classId: 445,
        subjects: { 'M': { teachers: [50] } },
      },
      '105': {
        classId: -1,
        subjects: { 'M': { teachers: [50] } },
      },
      '106': {
        classId: 445,
        subjects: { 'M': { teachers: [-1, 0, null as any] } },
      },
    };

    const result = parsePupilGroupMappings(input as any);
    expect(result.records).toHaveLength(0);
  });
});
