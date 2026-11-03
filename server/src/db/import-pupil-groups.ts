import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inArray } from 'drizzle-orm';
import { closePool, db } from './index.js';
import { pupilSubjectTeachers, pupils, schoolClasses, teachers } from './schema.js';
import { parsePupilGroupMappings } from './pupil-group-import.js';
import { safeErrorLogFields } from '../lib/log-safety.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads WebUntis pupil-group-teacher assignments into `pupil_subject_teachers`.
 *
 *   npm run pupil-groups:import --workspace=smile-server -- [path/to/pupil_group_mappings.json]
 *
 * Defaults to the repository's `pupil_group_mappings.json`.
 *
 * The table is replaced wholesale inside one transaction, ensuring idempotency.
 */
export async function importPupilGroups(filePath?: string) {
  const jsonPath = filePath
    ? path.resolve(filePath)
    : path.resolve(__dirname, '../../../pupil_group_mappings.json');

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Pupil group mapping file not found: ${jsonPath}`);
  }

  const rawJson = fs.readFileSync(jsonPath, 'utf-8');
  const { records, totalRawSubjectTeacherPairs, deduplicatedCount, unmappedSubjects } =
    parsePupilGroupMappings(rawJson);

  console.log(`--- SMILE Pupil Group Mapping Import ---`);
  console.log(`Source      : ${jsonPath}`);
  console.log(`Raw pairs   : ${totalRawSubjectTeacherPairs}`);
  console.log(`Unique rows : ${deduplicatedCount}`);
  if (unmappedSubjects.length > 0) {
    console.warn(`Unmapped    : ${unmappedSubjects.join(', ')}`);
  }

  // Verify foreign key integrity against the database
  const pupilIds = [...new Set(records.map((r) => r.pupilId))];
  const classIds = [...new Set(records.map((r) => r.classId))];
  const teacherIds = [...new Set(records.map((r) => r.teacherId))];

  const dbPupils = await db
    .select({ id: pupils.id })
    .from(pupils)
    .where(inArray(pupils.id, pupilIds));
  const knownPupilIds = new Set(dbPupils.map((p) => p.id));

  const dbClasses = await db
    .select({ id: schoolClasses.id })
    .from(schoolClasses)
    .where(inArray(schoolClasses.id, classIds));
  const knownClassIds = new Set(dbClasses.map((c) => c.id));

  const dbTeachers = await db
    .select({ id: teachers.id })
    .from(teachers)
    .where(inArray(teachers.id, teacherIds));
  const knownTeacherIds = new Set(dbTeachers.map((t) => t.id));

  const validRecords = records.filter(
    (r) =>
      knownPupilIds.has(r.pupilId) &&
      knownClassIds.has(r.classId) &&
      knownTeacherIds.has(r.teacherId)
  );

  const droppedCount = records.length - validRecords.length;
  if (droppedCount > 0) {
    console.warn(`Skipped     : ${droppedCount} rows referencing unknown pupil/class/teacher IDs in DB`);
  }

  await db.transaction(async (tx) => {
    await tx.delete(pupilSubjectTeachers);
    const CHUNK = 500;
    for (let i = 0; i < validRecords.length; i += CHUNK) {
      await tx.insert(pupilSubjectTeachers).values(validRecords.slice(i, i + CHUNK));
    }
  });

  console.log(`Written     : ${validRecords.length} pupil-subject-teacher assignments`);
  console.log(`Pupils      : ${new Set(validRecords.map((r) => r.pupilId)).size} pupils`);
  console.log(`Classes     : ${new Set(validRecords.map((r) => r.classId)).size} classes`);
  console.log(`Teachers    : ${new Set(validRecords.map((r) => r.teacherId)).size} teachers`);
  console.log(`Subjects    : ${new Set(validRecords.map((r) => r.subjectCode)).size} canonical subjects`);
  console.log(`--- done ---`);

  return {
    validCount: validRecords.length,
    droppedCount,
    pupilsCovered: new Set(validRecords.map((r) => r.pupilId)).size,
  };
}

async function main() {
  const argPath = process.argv[2];
  await importPupilGroups(argPath);
}

const invokedDirectly =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === path.resolve(__filename) ||
    import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`);
if (invokedDirectly) {
  main()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Pupil group import failed:', err);
      process.exit(1);
    });
}
