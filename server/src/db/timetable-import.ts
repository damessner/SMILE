import { parse } from 'csv-parse/sync';
import { normalizeKnownSubject } from '../utils/subject.js';

/**
 * WebUntis timetable export -> `timetable_lessons` rows.
 *
 * Why this module exists: production *has* 1021 timetable rows, but nothing in the
 * repository ever loaded them. No seed, no script, no migration. The data arrived by
 * hand, so a fresh install or a rebuild silently starts with an empty
 * `timetable_lessons` — and the conference then falls through to a hardcoded `4` (core)
 * or `2` (other) for every vote, which is the "Stunden-Vorschlag" computing itself from
 * constants while its percentages still sum to 100% and look healthy.
 *
 * It also fixes a live defect rather than merely reproducing the existing state.
 * The hand-loaded data kept WebUntis' legacy subject codes, including all three core
 * subjects:
 *
 *     subject_code as loaded      lessons
 *     D                             72
 *     SD                            32     <- also Deutsch
 *     E                             79
 *     SE                            31     <- also Englisch
 *     M                             80
 *     SM                            31     <- also Mathe
 *
 * 94 core-subject lessons were therefore invisible to the hours lookup, which keys
 * `evaluations.subject_code` (canonical) against `timetable_lessons.subject_code`
 * (whatever was loaded). `normalizeSubject()` here writes the canonical code at load
 * time, so the join is a plain equality instead of relying on a two-step fallback that
 * happens to miss. This is the root cause named in hardening roadmap C2.
 */

/** Column layout of `Stundenplan.TXT`, verified against the loaded production rows. */
const COL = {
  lessonId: 0,
  className: 1,
  teacherShort: 2,
  subjectCode: 3,
  room: 4,
  dayOfWeek: 5,
  period: 6,
} as const;

export interface ParsedLesson {
  lessonId: number | null;
  className: string;
  teacherShort: string;
  /** Canonical subject code, or null when the export used something unrecognisable. */
  subjectCode: string | null;
  subjectName: string | null;
  rawSubjectCode: string;
  room: string | null;
  dayOfWeek: number;
  period: number;
}

export interface ParseResult {
  lessons: ParsedLesson[];
  /** Rows dropped because they belong to no class (Sprachhilfe, study groups, ...). */
  skippedWithoutClass: number;
  /** Rows whose subject code is not in the canonical alias table. */
  unresolvedSubjects: Array<{ rawSubjectCode: string; lessons: number }>;
  /** Raw codes that were rewritten to a canonical code, with their counts. */
  normalizedSubjects: Array<{ from: string; to: string; lessons: number }>;
}

function toInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Parse the export. Pure: no database, no filesystem, so it is directly testable.
 *
 * A row with no class is dropped. This is not a guess — the hand-loaded production data
 * contains exactly the 1021 class-bearing rows out of 1065 in the file, and the 44
 * dropped rows are all `SPR`/`STB`/`BIBL`/`MM` entries that belong to no class and
 * therefore cannot contribute hours to any pupil.
 */
export function parseTimetableExport(csv: string): ParseResult {
  const rows = parse(csv, { skip_empty_lines: true, relax_column_count: true }) as string[][];

  const lessons: ParsedLesson[] = [];
  const unresolved = new Map<string, number>();
  const normalized = new Map<string, { to: string; count: number }>();
  let skippedWithoutClass = 0;

  for (const row of rows) {
    if (row.length < 7) continue;
    const className = (row[COL.className] ?? '').trim();
    if (!className) {
      skippedWithoutClass++;
      continue;
    }

    const teacherShort = (row[COL.teacherShort] ?? '').trim();
    const rawSubjectCode = (row[COL.subjectCode] ?? '').trim();
    const dayOfWeek = toInt(row[COL.dayOfWeek]);
    const period = toInt(row[COL.period]);

    if (!teacherShort || !rawSubjectCode || dayOfWeek === null || period === null) continue;

    // Loading a code into the database is a *write*, so it uses the strict normalizer
    // and rejects anything outside the canonical table, per Invariant 1. The coercing
    // `normalizeSubject()` would have minted a well-formed but meaningless code here -
    // `normalizeSubject('ASTRONOMIE')` returns `{ code: 'ASTRONOMIE' }` - and a typo in
    // the export would then be persisted and quietly counted as a real subject.
    //
    // Legacy WebUntis spellings still resolve, because they are in the alias table:
    // `SD`->D, `SE`->E, `SM`->M, `SBUB`->BUB, `SGPB`->GPB, `SGWB`->GWB,
    // `R KATH`->RKATH, `R ISLA`->RISLA.
    const subject = normalizeKnownSubject(rawSubjectCode);

    if (!subject) {
      unresolved.set(rawSubjectCode, (unresolved.get(rawSubjectCode) ?? 0) + 1);
    } else if (subject.code !== rawSubjectCode) {
      const entry = normalized.get(rawSubjectCode);
      if (entry) entry.count++;
      else normalized.set(rawSubjectCode, { to: subject.code, count: 1 });
    }

    lessons.push({
      lessonId: toInt(row[COL.lessonId]),
      className,
      teacherShort,
      subjectCode: subject?.code ?? null,
      subjectName: subject?.name ?? null,
      rawSubjectCode,
      room: (row[COL.room] ?? '').trim() || null,
      dayOfWeek,
      period,
    });
  }

  return {
    lessons,
    skippedWithoutClass,
    unresolvedSubjects: [...unresolved.entries()]
      .map(([rawSubjectCode, n]) => ({ rawSubjectCode, lessons: n }))
      .sort((a, b) => b.lessons - a.lessons),
    normalizedSubjects: [...normalized.entries()]
      .map(([from, v]) => ({ from, to: v.to, lessons: v.count }))
      .sort((a, b) => b.lessons - a.lessons),
  };
}

/**
 * Weekly periods for one (teacher, class, subject) — the weight used by the conference.
 *
 * Counts *distinct* (day, period) pairs rather than rows, so a duplicated export line
 * cannot inflate a teacher's hours. Verified against the production data: there are no
 * duplicate (class, teacher, subject, day, period) rows today, so this returns the same
 * numbers as the current `COUNT(*)` query — it just stays correct if a future export
 * contains one.
 */
export function weeklyHours(lessons: ParsedLesson[]): Map<string, number> {
  const slots = new Map<string, Set<string>>();
  for (const lesson of lessons) {
    if (!lesson.subjectCode) continue;
    const key = `${lesson.className}|${lesson.teacherShort}|${lesson.subjectCode}`;
    const slot = slots.get(key) ?? new Set<string>();
    slot.add(`${lesson.dayOfWeek}|${lesson.period}`);
    slots.set(key, slot);
  }
  const hours = new Map<string, number>();
  for (const [key, set] of slots) hours.set(key, set.size);
  return hours;
}