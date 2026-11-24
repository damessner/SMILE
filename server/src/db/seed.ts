import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { closePool, db, getPool, runMigrations } from './index.js';
import { ensureAdminActorTeacher } from '../lib/admin-actor.js';
import {
  assessmentRubrics,
  observationRounds,
  pupils,
  rubricCriteria,
  schoolClasses,
  teachingAssignments,
  teachers,
  users,
} from './schema.js';
import { adminBootstrapPassword, config, initialBootstrapPassword } from '../config.js';
import { safeErrorLogFields } from '../lib/log-safety.js';
import { invalidateTeacherCache, kvFieldMatches } from '../lib/guards.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const exportDir = path.resolve(__dirname, '../../../export');

const BCRYPT_ROUNDS = 12;

/**
 * Schema creation lives entirely in the generated Drizzle migrations now.
 *
 * The previous version carried a hand-written copy of the DDL that had silently
 * drifted: it never created `timeout_incidents`, `timeout_escalations` or
 * `timetable_lessons`, and `evaluations` / `final_ranks` were missing the columns the
 * routes actually query. A database bootstrapped by that script threw as soon as the
 * timeout, timetable or conference features were used.
 */
async function migrate() {
  console.log('Running database migrations...');
  await runMigrations();
}

async function seed() {
  console.log('--- SMILE Database Bootstrap & Seed ---');

  await migrate();

  if (!fs.existsSync(exportDir)) {
    throw new Error(`Export directory not found: ${exportDir}`);
  }

  const teachersFile = path.join(exportDir, 'teacher-class-subjects.json');
  const pupilsFile = path.join(exportDir, 'class-pupils.csv');
  for (const f of [teachersFile, pupilsFile]) {
    if (!fs.existsSync(f)) throw new Error(`Required import file missing: ${f}`);
  }

  // 1. Teachers -------------------------------------------------------------
  console.log('Ingesting teachers and teaching assignments...');
  const tcsRaw = fs.readFileSync(teachersFile, 'utf8').replace(/^\uFEFF/, '');
  const tcs = JSON.parse(tcsRaw) as Array<{
    TeacherId: number;
    TeacherShort: string;
    Teacher: string;
    ClassId: number;
    Subjects: string;
  }>;

  const teacherMap = new Map<number, { id: number; shortName: string; fullName: string }>();
  for (const item of tcs) {
    if (!teacherMap.has(item.TeacherId)) {
      teacherMap.set(item.TeacherId, {
        id: item.TeacherId,
        shortName: item.TeacherShort,
        fullName: item.Teacher,
      });
    }
  }

  for (const t of teacherMap.values()) {
    await db
      .insert(teachers)
      .values(t)
      .onConflictDoUpdate({
        target: teachers.id,
        set: { fullName: t.fullName, shortName: t.shortName },
      });
  }
  console.log(`  ${teacherMap.size} teachers.`);

  // 2. Classes and pupils ----------------------------------------------------
  console.log('Ingesting classes and pupils...');
  const csvRaw = fs.readFileSync(pupilsFile, 'utf8').replace(/^\uFEFF/, '');
  const records = parse(csvRaw, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;

  const classMap = new Map<
    number,
    { id: number; name: string; grade: number; head1: string | null; head2: string | null }
  >();
  const pupilList: Array<{ id: number; classId: number; fullName: string }> = [];

  for (const row of records) {
    const classId = Number.parseInt(row.ClassId!, 10);
    if (!Number.isFinite(classId)) continue;

    const className = row.Class!.trim();
    const grade = Number.parseInt(className.charAt(0), 10) || 1;

    if (!classMap.has(classId)) {
      classMap.set(classId, {
        id: classId,
        name: className,
        grade,
        head1: row.Homeroom1?.trim() || null,
        head2: row.Homeroom2?.trim() || null,
      });
    }

    pupilList.push({
      id: Number.parseInt(row.PupilId!, 10),
      classId,
      fullName: row.Pupil!.trim(),
    });
  }

  for (const c of classMap.values()) {
    await db
      .insert(schoolClasses)
      .values({
        id: c.id,
        name: c.name,
        grade: c.grade,
        headTeacher1: c.head1,
        headTeacher2: c.head2,
      })
      .onConflictDoUpdate({
        target: schoolClasses.id,
        set: {
          name: c.name,
          grade: c.grade,
          headTeacher1: c.head1,
          headTeacher2: c.head2,
        },
      });
  }
  console.log(`  ${classMap.size} classes.`);

  for (const p of pupilList) {
    if (!Number.isFinite(p.id)) continue;
    await db
      .insert(pupils)
      .values({ id: p.id, classId: p.classId, fullName: p.fullName })
      .onConflictDoUpdate({
        target: pupils.id,
        set: { fullName: p.fullName, classId: p.classId },
      });
  }
  console.log(`  ${pupilList.length} pupils.`);

  // 3. Teaching assignments --------------------------------------------------
  console.log('Ingesting teaching assignments...');
  await getPool().query('TRUNCATE TABLE teaching_assignments RESTART IDENTITY');
  let assignmentCount = 0;
  for (const item of tcs) {
    if (!classMap.has(item.ClassId)) continue;
    for (const sub of item.Subjects.split(' | ')) {
      const trimmed = sub.trim();
      if (!trimmed) continue;
      await db.insert(teachingAssignments).values({
        teacherId: item.TeacherId,
        classId: item.ClassId,
        subjectCode: trimmed.toUpperCase(),
        subjectName: trimmed,
      });
      assignmentCount++;
    }
  }
  console.log(`  ${assignmentCount} assignments.`);

  // 4. User accounts ---------------------------------------------------------
  //
  // Password policy: the previously published shared default `smile2026` is banned
  // outright, and every new account is flagged must_change_password, so the bootstrap
  // password is a one-time value each account replaces at first login.
  //
  // KNOWN LIMITATION, awaiting an owner decision: every new account below is still
  // hashed from the same INITIAL_USER_PASSWORD. Issuing per-account credentials needs a
  // delivery channel this app does not have (no mail, no keyring), so the seed cannot
  // invent one. Until that exists, a teacher who learns the bootstrap password can sign
  // in as any teacher who has not logged in yet. Tracked in docs/archive/bugfix.md / docs/SECURITY.md.
  console.log('Seeding user accounts...');
  const bootstrapPassword = initialBootstrapPassword();
  const adminPassword = adminBootstrapPassword();

  // Raw homeroom-teacher fields exactly as the WebUntis export stores them
  // ("Alfred Zimmermann (ZIA) / Maria Meier (MED)", ...). Matched per teacher
  // below with kvFieldMatches — never with a substring test.
  const homeroomFields = new Set<string>();
  for (const c of classMap.values()) {
    if (c.head1) homeroomFields.add(c.head1);
    if (c.head2) homeroomFields.add(c.head2);
  }

  let created = 0;
  let kept = 0;

  // Admin
  const [existingAdmin] = await db.select().from(users).where(eq(users.username, 'admin')).limit(1);
  if (existingAdmin) {
    // Never reset an existing admin password: re-running the seed used to revert a
    // rotated credential back to the published default.
    console.log('  admin exists, password untouched.');
    kept++;
  } else {
    await db.insert(users).values({
      username: 'admin',
      passwordHash: await bcrypt.hash(adminPassword ?? bootstrapPassword, BCRYPT_ROUNDS),
      role: 'admin',
      mustChangePassword: true,
      teacherId: await ensureAdminActorTeacher('admin'),
    });
    created++;
    console.log(
      `  admin created${adminPassword ? ' with ADMIN_PASSWORD' : ' with INITIAL_USER_PASSWORD'} (change at first login).`,
    );
  }

  for (const t of teacherMap.values()) {
    const username = t.shortName.toLowerCase();
    // The same matcher the runtime KV check uses (guards.ts kvFieldMatches).
    // The previous substring check promoted any teacher whose short name
    // happened to occur inside an unrelated homeroom field (short name "Z"
    // inside "Karin Ziegler"), seeding a plain teacher as head_teacher.
    const isHead = Array.from(homeroomFields).some((field) => kvFieldMatches(field, t));
    const role = isHead ? 'head_teacher' : 'teacher';

    const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing) {
      // Keep the existing password hash; only keep role/teacher link in sync.
      await db
        .update(users)
        .set({
          role,
          teacherId: t.id,
          // Identity changes must invalidate tokens issued with the old role/link.
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.username, username));
      kept++;
    } else {
      // Bootstrap password (see the limitation noted above), changed at first login.
      await db.insert(users).values({
        username,
        passwordHash: await bcrypt.hash(bootstrapPassword, BCRYPT_ROUNDS),
        role,
        teacherId: t.id,
        mustChangePassword: true,
      });
      created++;
    }
  }
  console.log(`  ${created} accounts created, ${kept} left untouched.`);
  if (created > 0) {
    // Say the one thing an operator must not leave this log without.
    console.warn('  WARNING: all ' + created + ' new accounts share one bootstrap password.');
    console.warn('  Hand each teacher their credential privately and have them change it at first login.');
  }
  console.log(`  New accounts start on the bootstrap password and must change it at first login.`);

  invalidateTeacherCache();

  // 5. Default rubric --------------------------------------------------------
  console.log('Seeding default SMILE rubric...');
  const [existingRubric] = await db
    .select()
    .from(assessmentRubrics)
    .where(eq(assessmentRubrics.isDefault, true))
    .limit(1);

  if (existingRubric) {
    console.log('  default rubric already present, skipped.');
  } else {
    // grade_boundaries is now derived from the same config the ranking code uses,
    // instead of holding inert values (5/3) that no code path ever read.
    const [rubric] = await db
      .insert(assessmentRubrics)
      .values({
        title: 'SMILE Beobachtungsraster 2026/27',
        mode: 'rubric_levels',
        gradeBoundaries: {
          // Kept in sync with RANK_THRESHOLD_* via config.ts (lib/ranking.ts is the
          // single source of truth at runtime).
          meister: { minPositiveItems: config.rankThresholds.meister },
          geselle: { minPositiveItems: config.rankThresholds.geselle },
          itemCount: config.rubricItemCount,
          aggregation: config.rankAggregation,
        },
        isDefault: true,
      })
      .returning();

    const criteriaData = [
      {
        name: 'Arbeitsorganisation',
        position: 1,
        items: [
          { key: 'org_1', label: 'Kennt den Arbeitsauftrag' },
          { key: 'org_2', label: 'Beginnt unaufgefordert mit der Arbeit' },
          { key: 'org_3', label: 'Teilt Material, Aufgaben und Zeit selbstständig ein' },
        ],
      },
      {
        name: 'Fragen & Problemlösen',
        position: 2,
        items: [
          { key: 'prob_1', label: 'Fragt bei Unklarheiten gezielt nach' },
          { key: 'prob_2', label: 'Kann das Problem / die Frage präzise formulieren' },
          { key: 'prob_3', label: 'Probiert rechtzeitig eigene Lösungsansätze aus' },
        ],
      },
      {
        name: 'Arbeitshaltung',
        position: 3,
        items: [
          { key: 'halt_1', label: 'Arbeitet konzentriert und ausdauernd' },
          { key: 'halt_2', label: 'Stört Mitschüler/innen nicht bei der Arbeit' },
          { key: 'halt_3', label: 'Bleibt auch bei schwierigen Aufgaben dran' },
        ],
      },
      {
        name: 'Verantwortung',
        position: 4,
        items: [
          { key: 'ver_1', label: 'Hält vereinbarte Regeln verlässlich ein' },
          { key: 'ver_2', label: 'Steht für eigene Entscheidungen und Arbeitszeit ein' },
          { key: 'ver_3', label: 'Geht mit eingeräumten Freiräumen verantwortungsvoll um' },
        ],
      },
      {
        name: 'Reflexion',
        position: 5,
        items: [
          { key: 'ref_1', label: 'Schätzt die eigene Leistung realistisch ein' },
          { key: 'ref_2', label: 'Erkennt, was gut gelingt und wo Unterstützung nötig ist' },
          { key: 'ref_3', label: 'Benennt sinnvolle nächste Lernschritte' },
        ],
      },
      {
        name: 'Verstehen statt Erledigen',
        position: 6,
        items: [
          { key: 'verst_1', label: 'Überprüft das eigene Verständnis, nicht nur die Vollständigkeit' },
          { key: 'verst_2', label: 'Arbeitet Fehlerursachen konstruktiv auf' },
          { key: 'verst_3', label: 'Setzt auf Qualität vor Quantität' },
        ],
      },
    ];

    for (const c of criteriaData) {
      await db.insert(rubricCriteria).values({
        rubricId: rubric.id,
        name: c.name,
        position: c.position,
        items: c.items,
      });
    }
    console.log('  6 criteria with 18 observation items.');
  }

  // 6. Initial observation round --------------------------------------------
  console.log('Seeding initial observation round...');
  const [existingRound] = await db.select().from(observationRounds).limit(1);
  if (existingRound) {
    console.log('  round already present, skipped.');
  } else {
    await db.insert(observationRounds).values({
      name: 'Herbst / Semester 1 2026/27',
      isLocked: false,
      startsOn: new Date('2026-09-14'),
      endsOn: new Date('2027-02-15'),
    });
    console.log('  created.');
  }

  // Keep the pupil id sequence clear of imported WebUntis ids.
  await getPool().query(
    `SELECT setval('pupil_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM pupils), 9000000))`,
  );

  // 7. Pupil group mappings (if available) ----------------------------------
  const pupilGroupsFile = path.resolve(__dirname, '../../../pupil_group_mappings.json');
  if (fs.existsSync(pupilGroupsFile)) {
    console.log('Seeding pupil group mappings...');
    const { importPupilGroups } = await import('./import-pupil-groups.js');
    await importPupilGroups(pupilGroupsFile);
  }

  console.log('\n=== SMILE Database bootstrap complete ===\n');
}

seed()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', safeErrorLogFields(err));
    await closePool().catch(() => {});
    process.exit(1);
  });

/** Re-exported for tests. */
export { seed, BCRYPT_ROUNDS };
