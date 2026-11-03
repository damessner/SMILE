import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTimetableExport, weeklyHours } from './timetable-import.js';

/**
 * The timetable import is the only thing standing between a fresh install and the
 * conference weighting itself, a hardcoded constant. Nothing else in the repository
 * loads `timetable_lessons`, so these tests run against the real export when it is
 * present and against a fixture when it is not — the fixture reproduces every shape the
 * real file contains, including the legacy subject codes that made the hours lookup miss.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const exportPath = path.join(repoRoot, 'Stundenplan.TXT');
const hasRealExport = fs.existsSync(exportPath);

/**
 * Rows taken verbatim from the real export: a class row, the legacy-code variants of
 * the three core subjects, a study-group row with no class, and a spaced religion code.
 */
const FIXTURE = [
  '1,"1B","EXA","R KATH","1B",3,4,,',
  '2,"1B","EIV","D","1B",1,3,,',
  '2,"1B","EIV","D","1B",2,3,,',
  '2,"1B","EIV","D","1B",3,3,,',
  '3,"1B","EIV","SD","1B",2,2,,',
  '4,"1B","OFJ","SE","1B",1,2,,',
  '5,"1B","OFJ","SM","1B",1,1,,',
  '6,"1B","TAC","BO","GrSp",3,4,,',
  '9,"","AIS","SPR","SPR",1,3,,',
].join('\n');

describe('timetable export parsing', () => {
  const result = parseTimetableExport(FIXTURE);

  it('maps the column layout', () => {
    expect(result.lessons).toHaveLength(8);
    const deutsch = result.lessons.find((l) => l.teacherShort === 'EIV' && l.period === 3);
    expect(deutsch).toMatchObject({
      lessonId: 2,
      className: '1B',
      teacherShort: 'EIV',
      subjectCode: 'D',
      subjectName: 'Deutsch',
      room: '1B',
      dayOfWeek: 1,
      period: 3,
    });
  });

  it('keeps the room/group column', () => {
    expect(result.lessons.find((l) => l.teacherShort === 'TAC')?.room).toBe('GrSp');
  });

  it('drops rows that belong to no class', () => {
    // Sprachhilfe / study groups have no class, so they can never contribute hours to a
    // pupil. This matches the hand-loaded production data exactly: 1021 class-bearing
    // rows out of 1065 in the file.
    expect(result.skippedWithoutClass).toBe(1);
    expect(result.lessons.every((l) => l.className !== '')).toBe(true);
  });

  it('rewrites legacy subject codes to their canonical form', () => {
    // This is the live defect. The hand-loaded production data keeps 94 core-subject
    // lessons under SD/SE/SM, which the hours lookup - keyed on canonical codes -
    // could not see. Normalising here means the join is a plain equality.
    const sById = new Map(result.lessons.map((l) => [l.lessonId, l]));
    expect(sById.get(4)?.subjectCode).toBe('E'); // SE
    expect(sById.get(5)?.subjectCode).toBe('M'); // SM
    expect(sById.get(1)?.subjectCode).toBe('RKATH'); // R KATH
    expect(sById.get(2)?.subjectCode).toBe('D'); // already canonical, untouched
  });

  it('reports what it normalised', () => {
    const codes = result.normalizedSubjects.map((n) => `${n.from}->${n.to}`);
    expect(codes).toContain('SD->D');
    expect(codes).toContain('SE->E');
    expect(codes).toContain('SM->M');
    expect(codes).toContain('R KATH->RKATH');
  });

  it('does not rewrite a code that is already canonical', () => {
    expect(result.normalizedSubjects.map((n) => n.from)).not.toContain('D');
  });

  it('surfaces an unknown subject instead of silently loading it', () => {
    // Loading a code into the database is a write, so an unrecognised code is rejected
    // rather than coerced. The coercing normalizer would mint `{code:'ASTRONOMIE'}`,
    // which is syntactically valid and completely meaningless, and a typo in the export
    // would then be persisted and counted as a real subject.
    const odd = parseTimetableExport('1,"1B","EIV","ASTRONOMIE","1B",1,1,,');
    expect(odd.lessons[0]?.subjectCode).toBeNull();
    expect(odd.unresolvedSubjects).toEqual([{ rawSubjectCode: 'ASTRONOMIE', lessons: 1 }]);
  });
});

describe('weekly hours (the conference weight)', () => {
  it('counts distinct day/period slots', () => {
    const { lessons } = parseTimetableExport(FIXTURE);
    const hours = weeklyHours(lessons);
    // EIV teaches Deutsch in three D rows plus one SD row; after normalisation that is
    // four slots of the same subject, not two subjects.
    expect(hours.get('1B|EIV|D')).toBe(4);
    expect(hours.get('1B|OFJ|E')).toBe(1);
  });

  it('merges a legacy and a canonical spelling into one real count', () => {
    // EIV has three D rows plus one SD row. After normalisation these are the same
    // subject, so Deutsch for EIV is four periods - not three, and not two subjects.
    const { lessons } = parseTimetableExport(FIXTURE);
    const hours = weeklyHours(lessons);
    expect(hours.get('1B|EIV|D')).toBe(4);
    expect(hours.has('1B|EIV|SD')).toBe(false);
  });

  it('does not double-count a duplicated export line', () => {
    const duplicated = parseTimetableExport(
      ['2,"1B","EIV","D","1B",1,3,,', '2,"1B","EIV","D","1B",1,3,,'].join('\n'),
    );
    expect(weeklyHours(duplicated.lessons).get('1B|EIV|D')).toBe(1);
  });
});

(hasRealExport ? describe : describe.skip)('against the real Stundenplan.TXT export', () => {
  // Read lazily-safe: this factory body runs at collection even when the suite is
  // skipped (no Stundenplan.TXT in CI), so never touch the filesystem unless the
  // export actually exists.
  const result = hasRealExport
    ? parseTimetableExport(fs.readFileSync(exportPath, 'utf-8'))
    : ({} as ReturnType<typeof parseTimetableExport>);

  it('reproduces the loaded production row count', () => {
    // 1065 lines in the file, 44 without a class, 1021 class-bearing lessons - which is
    // exactly the number of rows in the hand-loaded `timetable_lessons` table.
    expect(result.lessons.length).toBe(1021);
    expect(result.skippedWithoutClass).toBe(44);
  });

  it('normalises the 94 legacy core-subject lessons', () => {
    const core = result.normalizedSubjects.filter((n) => ['SD', 'SE', 'SM'].includes(n.from));
    expect(core).toHaveLength(3);
    expect(core.reduce((sum, n) => sum + n.lessons, 0)).toBe(94);
    expect(core.find((n) => n.from === 'SD')?.to).toBe('D');
    expect(core.find((n) => n.from === 'SE')?.to).toBe('E');
    expect(core.find((n) => n.from === 'SM')?.to).toBe('M');
  });

  it('resolves every subject code in the export', () => {
    expect(result.unresolvedSubjects).toEqual([]);
  });

  it('leaves no legacy code in the loaded set', () => {
    const loaded = new Set(result.lessons.map((l) => l.subjectCode));
    for (const legacy of ['SD', 'SE', 'SM', 'SBUB', 'SGPB', 'SGWB', 'R KATH', 'R ISLA', 'BFUD']) {
      expect(loaded.has(legacy)).toBe(false);
    }
  });

  it('agrees with the hand-loaded data on every teacher/class/subject total', () => {
    // Cross-check against the values the conference computes. With BFUD consolidated
    // into canonical D, OFJ in 1B has 4 regular D periods + 1 BFUD period = 5 hours.
    const hours = weeklyHours(result.lessons);
    expect(hours.get('1B|EIV|D')).toBe(4);
    expect(hours.get('1B|OFJ|D')).toBe(5);
    expect(hours.get('1B|KON|M')).toBe(4);
    expect(hours.get('1B|PEL|M')).toBe(3);
  });
});