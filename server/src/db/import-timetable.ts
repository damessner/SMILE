import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inArray } from 'drizzle-orm';
import { closePool, db } from './index.js';
import { schoolClasses, teachers, timetableLessons } from './schema.js';
import { parseTimetableExport } from './timetable-import.js';
import { safeErrorLogFields } from '../lib/log-safety.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the WebUntis timetable export into `timetable_lessons`.
 *
 *   npm run timetable:import --workspace=server -- [path/to/Stundenplan.TXT]
 *
 * Defaults to the repository's `Stundenplan.TXT`. See `timetable-import.ts` for why this
 * exists at all and for the column layout.
 *
 * The table is replaced wholesale inside one transaction, so the import is idempotent:
 * running it twice yields the same rows. A partial load is not possible.
 *
 * Refuses to write anything it cannot resolve. A teacher or class in the export that is
 * missing from the database is an error, not a silent skip — silently dropping a
 * teacher would leave their lessons uncounted and quietly hand their vote an invented
 * weight, which is precisely the failure this import is meant to eliminate.
 */
async function main() {
  const argPath = process.argv[2];
  const csvPath = argPath
    ? path.resolve(argPath)
    : path.resolve(__dirname, '../../../Stundenplan.TXT');

  if (!fs.existsSync(csvPath)) {
    console.error(`Timetable export not found: ${csvPath}`);
    console.error('Pass the path explicitly: npm run timetable:import --workspace=server -- <file>');
    process.exit(1);
  }

  const csv = fs.readFileSync(csvPath, 'utf-8');
  const { lessons, skippedWithoutClass, unresolvedSubjects, normalizedSubjects } =
    parseTimetableExport(csv);

  console.log(`--- SMILE Timetable Import ---`);
  console.log(`Source      : ${csvPath}`);
  console.log(`Lessons     : ${lessons.length}`);
  console.log(`No class    : ${skippedWithoutClass} skipped (Sprachhilfe / study groups)`);

  if (normalizedSubjects.length > 0) {
    console.log(`Normalized  : ${normalizedSubjects.length} legacy subject code(s) rewritten`);
    for (const n of normalizedSubjects) {
      console.log(`             ${n.from} -> ${n.to} (${n.lessons} lessons)`);
    }
  }
  if (unresolvedSubjects.length > 0) {
    console.warn(`Unresolved  : ${unresolvedSubjects.length} subject code(s) are not in the canonical table`);
    for (const u of unresolvedSubjects) {
      console.warn(`             ${u.rawSubjectCode} (${u.lessons} lessons) - will NOT be loaded`);
    }
  }

  // Resolve class and teacher names to ids.
  const classNames = [...new Set(lessons.map((l) => l.className))];
  const teacherShorts = [...new Set(lessons.map((l) => l.teacherShort))];

  const classRows = await db
    .select({ id: schoolClasses.id, name: schoolClasses.name })
    .from(schoolClasses)
    .where(inArray(schoolClasses.name, classNames));
  const classByName = new Map(classRows.map((c) => [c.name.trim().toUpperCase(), c.id]));

  const teacherRows = await db
    .select({ id: teachers.id, shortName: teachers.shortName, active: teachers.active })
    .from(teachers);
  const teacherByShort = new Map(
    teacherRows.map((t) => [t.shortName.trim().toUpperCase(), t]),
  );

  const missingClasses = classNames.filter((n) => !classByName.has(n.trim().toUpperCase()));
  const missingTeachers = teacherShorts.filter((n) => !teacherByShort.has(n.trim().toUpperCase()));

  if (missingClasses.length > 0 || missingTeachers.length > 0) {
    if (missingClasses.length > 0) {
      console.error(`\nClasses in the export that are not in the database: ${missingClasses.join(', ')}`);
    }
    if (missingTeachers.length > 0) {
      console.error(`Teachers in the export that are not in the database: ${missingTeachers.join(', ')}`);
    }
    console.error('\nNothing was written. Run the seed first, or add these records, then retry.');
    process.exit(1);
  }

  const rows = lessons
    .filter((l): l is typeof l & { subjectCode: string } => l.subjectCode !== null)
    .map((l) => {
      const teacher = teacherByShort.get(l.teacherShort.trim().toUpperCase())!;
      return {
        lessonId: l.lessonId,
        classId: classByName.get(l.className.trim().toUpperCase())!,
        className: l.className,
        teacherId: teacher.id,
        teacherShort: teacher.shortName,
        subjectCode: l.subjectCode,
        subjectName: l.subjectName ?? l.subjectCode,
        room: l.room,
        dayOfWeek: l.dayOfWeek,
        period: l.period,
      };
    });

  await db.transaction(async (tx) => {
    // Wholesale replace. Partial updates would leave orphaned rows from a previous
    // export behind and quietly keep them in the hours count.
    await tx.delete(timetableLessons);
    // Chunked: 1021 rows is fine in one statement, but a school twice this size with a
    // larger class list would exceed PostgreSQL's bind-parameter ceiling.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(timetableLessons).values(rows.slice(i, i + CHUNK));
    }
  });

  const byTeacher = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.subjectCode}|${r.teacherShort}`;
    byTeacher.set(key, (byTeacher.get(key) ?? 0) + 1);
  }

  console.log(`\nWritten     : ${rows.length} lessons`);
  console.log(`Classes     : ${classRows.length}`);
  console.log(`Teachers    : ${teacherRows.length} known, ${teacherShorts.length} referenced`);
  console.log(`Subjects    : ${new Set(rows.map((r) => r.subjectCode)).size} canonical codes`);
  console.log('\nThe conference hours lookup now resolves against canonical codes.');
  console.log('--- done ---');
}

/** Exported so a test can assert the query shape without a database. */
export async function clearTimetable(): Promise<void> {
  await db.delete(timetableLessons);
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (invokedDirectly) {
  main()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Timetable import failed:', safeErrorLogFields(err));
      process.exit(1);
    });
}