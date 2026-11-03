import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { teachers } from '../db/schema.js';

/**
 * First usable id for an administrator placeholder teacher record.
 *
 * `teachers.id` is the WebUntis personId, so real ids are small and sparse. 9000000 sits
 * in the same reserved block as `pupil_id_seq` and is far above anything a timetable
 * issues, which keeps these rows from ever colliding with a real person.
 */
export const ADMIN_ACTOR_TEACHER_ID_BASE = 9_000_000;

/**
 * Ensure an administrator account has a teacher record to attribute writes to.
 *
 * `evaluations.teacher_id` is NOT NULL REFERENCES teachers(id), and an `admin` account is
 * not a teacher, so before this existed an administrator rating a pupil had no valid id to
 * write. The old code used the sentinel 0 — a legal primary key pointing at a phantom row.
 * Rating writes now fail closed with SYSTEM_ACTOR_NOT_CONFIGURED instead, and this gives
 * them something real to point at.
 *
 * The row is `active: false`, so it stays out of timetables, assignment pickers and staffing
 * lists. It exists to satisfy the foreign key and to record who actually entered a value.
 *
 * Throws rather than guessing if the reserved range is occupied: silently picking a
 * different id could attribute an administrator's ratings to a real colleague.
 */
export async function ensureAdminActorTeacher(username: string): Promise<number> {
  const occupied = await db
    .select({ id: teachers.id })
    .from(teachers)
    .where(sql`${teachers.id} >= ${ADMIN_ACTOR_TEACHER_ID_BASE}`)
    .limit(1);
  if (occupied.length > 0) {
    throw new Error(
      `Teacher ids >= ${ADMIN_ACTOR_TEACHER_ID_BASE} are already in use (id ${occupied[0].id}). ` +
        'Pick a free range before seeding, so administrator writes are not attributed to a colleague.'
    );
  }

  const nextId = await nextReservedTeacherId();
  await db.insert(teachers).values({
    id: nextId,
    shortName: `ADM-${nextId}`,
    fullName: `Administratorkonto ${username}`,
    active: false,
  });
  return nextId;
}

/**
 * Next free id inside the reserved range.
 *
 * Derived with MAX rather than a sequence so it works on a database that was created
 * before this range existed, and so a single administrator is the only realistic caller.
 * The `id >= base` guard keeps the result inside the reserved block instead of spilling
 * into the low personId space where a real teacher could be waiting.
 */
async function nextReservedTeacherId(): Promise<number> {
  const rows = await db
    .select({ nextId: sql<number>`COALESCE(MAX(${teachers.id}), ${ADMIN_ACTOR_TEACHER_ID_BASE - 1}) + 1` })
    .from(teachers)
    .where(sql`${teachers.id} < ${ADMIN_ACTOR_TEACHER_ID_BASE}`);
  const candidate = rows[0]?.nextId ?? ADMIN_ACTOR_TEACHER_ID_BASE;
  return Math.max(candidate, ADMIN_ACTOR_TEACHER_ID_BASE);
}