import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pupils, schoolClasses, teachingAssignments, teachers } from '../db/schema.js';
import { normalizeSubject, type NormalizedSubject } from '../utils/subject.js';

export type Role = 'admin' | 'head_teacher' | 'teacher' | 'pupil';

/** Shape of a verified JWT payload. Identity always originates here, never from a request body. */
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  teacherId?: number;
  pupilId?: number;
  mustChangePassword?: boolean;
}

/** The minimal identity projection that authorization helpers need. */
export type Identity = Pick<AuthUser, 'role' | 'teacherId'>;

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
    requireRole: (...roles: Role[]) => preHandlerHookHandler;
    rateLimitLoginMax: number;
    rateLimitLoginWindowSeconds: number;
  }
}

/** Headmaster short names that carry school-wide authority. */
export const HEADMASTER_SHORTNAMES = new Set(['SLC', 'MED']);

/**
 * Returns the authenticated user, or `undefined`. Only ever call this from a handler
 * that already ran `fastify.authenticate` (directly or via a route-level guard).
 */
export function requireAuth(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw new Error('requireAuth() called on an unauthenticated route — add fastify.authenticate to preHandler.');
  }
  return request.authUser;
}

// ---------------------------------------------------------------------------
// Teacher lookup with a short-lived cache (avoids re-querying on every guard call)
// ---------------------------------------------------------------------------

interface TeacherRow {
  id: number;
  shortName: string;
  fullName: string;
  active: boolean;
}

const teacherCache = new Map<number, { row: TeacherRow | null; expiresAt: number }>();
const TEACHER_CACHE_TTL_MS = 30_000;

export async function getTeacher(teacherId: number): Promise<TeacherRow | null> {
  const cached = teacherCache.get(teacherId);
  if (cached && cached.expiresAt > Date.now()) return cached.row;

  const [row] = await db.select().from(teachers).where(eq(teachers.id, teacherId)).limit(1);
  const result = row ?? null;
  teacherCache.set(teacherId, { row: result, expiresAt: Date.now() + TEACHER_CACHE_TTL_MS });
  return result;
}

export function invalidateTeacherCache(): void {
  teacherCache.clear();
}

export function isHeadmasterUser(user: Identity, teacher?: TeacherRow | null): boolean {
  if (user.role === 'admin') return true;
  const row = teacher ?? undefined;
  return !!row && HEADMASTER_SHORTNAMES.has(row.shortName.trim().toUpperCase());
}

// ---------------------------------------------------------------------------
// Homeroom (Klassenvorstand) matching
// ---------------------------------------------------------------------------

/**
 * Does a `school_classes.head_teacher_*` field refer to this teacher?
 *
 * The WebUntis export stores several shapes, e.g. "Alfred Zimmermann (ZIA)",
 * "ZIA", "Alfred Zimmermann", "Alfred Zimmermann (ZIA) / Maria Meier (MED)".
 *
 * This deliberately does *not* use a bare substring test. The previous implementation
 * used `field.includes(shortName)`, which granted homeroom authority to any teacher
 * whose short name happened to be a substring of an unrelated name.
 */
export function kvFieldMatches(
  field: string | null | undefined,
  teacher: { shortName: string; fullName: string },
): boolean {
  const raw = field?.trim();
  if (!raw) return false;

  const short = teacher.shortName.trim().toUpperCase();
  const full = teacher.fullName.trim().toUpperCase();
  if (!short && !full) return false;

  // Whole-field match, e.g. "ZIA" or "Alfred Zimmermann".
  const whole = raw.toUpperCase();
  if (whole === short || whole === full) return true;

  // Explicit short codes in parentheses: "Alfred Zimmermann (ZIA)".
  const parenCodes = [...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.trim().toUpperCase());
  if (short && parenCodes.includes(short)) return true;

  // Several teachers in one field, separated by /, ; or |.
  const parts = raw.split(/[/;,|]/).map((p) => p.trim().toUpperCase()).filter(Boolean);
  if (parts.some((p) => p === short || p === full)) return true;

  // "Alfred Zimmermann ZIA" — trailing token is the short code.
  const tokens = raw.split(/\s+/).map((t) => t.toUpperCase());
  if (short && tokens[tokens.length - 1] === short) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Class access matrix
// ---------------------------------------------------------------------------

export interface ClassAccess {
  classId: number;
  exists: boolean;
  isAdmin: boolean;
  isHeadmaster: boolean;
  isKv: boolean;
  teaches: boolean;
  isCoreTeacher: boolean;
  subjects: NormalizedSubject[];

  /** Read the pupil roster, their cards and their observation data. */
  canRead: boolean;
  /** Issue behaviour cards and send a pupil to Time-Out. */
  canRecord: boolean;
  /** Write Beobachtungsraster ratings (core subjects only). */
  canRate: boolean;
  /** Add / edit / archive pupils. */
  canManagePupils: boolean;
  /** Lock voting and confirm conference ranks. */
  canRunConference: boolean;
}

/** Class ids a user may act in, for endpoints that operate across classes. */
export interface GlobalAccess {
  isAdmin: boolean;
  isHeadmaster: boolean;
  teacherId?: number;
  /** null = unrestricted (admin/headmaster); otherwise the explicit allowlist. */
  classIds: number[] | null;
}

export async function getGlobalAccess(user: Identity): Promise<GlobalAccess> {
  const teacher = user.teacherId ? await getTeacher(user.teacherId) : null;
  const isAdmin = user.role === 'admin';
  const isHeadmaster = isHeadmasterUser(user, teacher);

  if (isAdmin || isHeadmaster || !user.teacherId) {
    return { isAdmin, isHeadmaster, teacherId: user.teacherId, classIds: null };
  }

  const assignments = await db
    .select({ classId: teachingAssignments.classId })
    .from(teachingAssignments)
    .where(eq(teachingAssignments.teacherId, user.teacherId));

  const classIds = Array.from(new Set(assignments.map((a) => a.classId)));

  // Homeroom heads may act in their own class even without a teaching assignment row.
  const allClasses = await db.select().from(schoolClasses);
  for (const cls of allClasses) {
    if (
      teacher &&
      (kvFieldMatches(cls.headTeacher1, teacher) || kvFieldMatches(cls.headTeacher2, teacher))
    ) {
      classIds.push(cls.id);
    }
  }

  return {
    isAdmin,
    isHeadmaster,
    teacherId: user.teacherId,
    classIds: Array.from(new Set(classIds)),
  };
}

/** May this user act on data belonging to `classId`? Used to scope cross-class endpoints. */
export async function canAccessClass(user: Identity, classId: number): Promise<boolean> {
  const access = await getGlobalAccess(user);
  if (access.classIds === null) return true;
  return access.classIds.includes(classId);
}

/**
 * Resolve everything a handler needs to make an authorization decision for one class,
 * in a fixed number of queries. Prefer this over ad-hoc checks so the rules stay in one place.
 */
export async function getClassAccess(user: AuthUser, classId: number): Promise<ClassAccess> {
  const base: ClassAccess = {
    classId,
    exists: false,
    isAdmin: false,
    isHeadmaster: false,
    isKv: false,
    teaches: false,
    isCoreTeacher: false,
    subjects: [],
    canRead: false,
    canRecord: false,
    canRate: false,
    canManagePupils: false,
    canRunConference: false,
  };

  const [cls] = await db.select().from(schoolClasses).where(eq(schoolClasses.id, classId)).limit(1);
  if (!cls) return base;

  base.exists = true;
  base.isAdmin = user.role === 'admin';
  if (base.isAdmin) {
    return { ...base, isHeadmaster: true, canRead: true, canRecord: true, canRate: true, canManagePupils: true, canRunConference: true };
  }

  const teacher = user.teacherId ? await getTeacher(user.teacherId) : null;
  base.isHeadmaster = isHeadmasterUser(user, teacher);
  if (teacher) {
    base.isKv =
      kvFieldMatches(cls.headTeacher1, teacher) || kvFieldMatches(cls.headTeacher2, teacher);
  }

  if (user.teacherId) {
    const assignments = await db
      .select({ subjectName: teachingAssignments.subjectName })
      .from(teachingAssignments)
      .where(
        and(
          eq(teachingAssignments.teacherId, user.teacherId),
          eq(teachingAssignments.classId, classId),
        ),
      );
    base.teaches = assignments.length > 0;
    base.subjects = Array.from(
      new Map(assignments.map((a) => {
        const n = normalizeSubject(a.subjectName);
        return [n.code, n];
      })).values(),
    );
    base.isCoreTeacher = base.subjects.some((s) => s.isCoreSmile);
  }

  // Headmasters see and may rate every class; homeroom heads and assigned teachers
  // are scoped to the classes they are actually responsible for.
  if (base.isHeadmaster) {
    return { ...base, canRead: true, canRecord: true, canRate: true, canRunConference: true };
  }
  if (user.role === 'pupil') return base; // pupil logins are not wired up yet

  const isResponsible = base.teaches || base.isKv;
  return {
    ...base,
    canRead: isResponsible,
    canRecord: isResponsible,
    canRate: base.isCoreTeacher,
    canManagePupils: base.isKv,
    /*
      Conference mode is reserved for the Schulleitung (SLC, MED) by school decision.

      Homeroom heads previously received this via `canRunConference: base.isKv`, which
      let them lock voting and confirm formal ranks for their class. Hiding the button
      alone would not have stopped that — the endpoints would still have accepted the
      call — so the restriction is enforced here as well as in the UI.
    */
    canRunConference: false,
  };
}

// ---------------------------------------------------------------------------
// Pupil / class consistency
// ---------------------------------------------------------------------------

export interface PupilLookup {
  id: number;
  classId: number;
  fullName: string;
  isArchived: boolean;
}

/**
 * Fetch a pupil and assert it actually belongs to `classId`.
 *
 * Every write endpoint accepts `pupilId` and `classId` from the request body. Without
 * this check a caller can file a card against a pupil of one class while crediting
 * another, which silently corrupts the per-class rank aggregations.
 */
export async function findPupilInClass(
  pupilId: number,
  classId: number,
): Promise<PupilLookup | undefined> {
  const [row] = await db
    .select({
      id: pupils.id,
      classId: pupils.classId,
      fullName: pupils.fullName,
      isArchived: pupils.isArchived,
    })
    .from(pupils)
    .where(and(eq(pupils.id, pupilId), eq(pupils.classId, classId)))
    .limit(1);
  return row;
}

export async function getPupil(pupilId: number): Promise<PupilLookup | undefined> {
  const [row] = await db
    .select({
      id: pupils.id,
      classId: pupils.classId,
      fullName: pupils.fullName,
      isArchived: pupils.isArchived,
    })
    .from(pupils)
    .where(eq(pupils.id, pupilId))
    .limit(1);
  return row;
}

/** Class ids of the given pupils that are visible to this user, for list endpoints. */
export async function visibleClassIds(user: Identity): Promise<number[] | null> {
  const access = await getGlobalAccess(user);
  return access.classIds;
}

// ---------------------------------------------------------------------------
// Route-level guard factories
// ---------------------------------------------------------------------------

/** The canonical `authenticate` preHandler. Populates `request.authUser`. */
export function buildAuthenticate(jwtVerify: (request: FastifyRequest) => Promise<unknown>): preHandlerHookHandler {
  const handler: preHandlerHookHandler = async function authenticate(request, reply) {
    try {
      const payload = (await jwtVerify(request)) as AuthUser;
      request.authUser = {
        id: String(payload.id),
        username: payload.username,
        role: payload.role,
        teacherId: payload.teacherId,
        pupilId: payload.pupilId,
        mustChangePassword: payload.mustChangePassword,
      };
    } catch {
      await reply.status(401).send({ error: 'Nicht authentifiziert' });
    }
  };
  return handler;
}

/**
 * Builds a role gate. Runs authentication first so `request.authUser` is guaranteed
 * to be populated when the role check happens.
 */
export function buildRequireRole(
  jwtVerify: (request: FastifyRequest) => Promise<unknown>,
): (...roles: Role[]) => preHandlerHookHandler {
  return (...roles: Role[]) => {
    const handler: preHandlerHookHandler = async function requireRole(request, reply) {
      // Authenticate inline rather than composing handlers, so there is one code path
      // that can populate `request.authUser`.
      try {
        const payload = (await jwtVerify(request)) as AuthUser;
        request.authUser = {
          id: String(payload.id),
          username: payload.username,
          role: payload.role,
          teacherId: payload.teacherId,
          pupilId: payload.pupilId,
          mustChangePassword: payload.mustChangePassword,
        };
      } catch {
        await reply.status(401).send({ error: 'Nicht authentifiziert' });
        return;
      }
      if (!request.authUser || !roles.includes(request.authUser.role)) {
        await reply.status(403).send({
          error: 'Für diese Aktion fehlt Ihnen die Berechtigung.',
        });
      }
    };
    return handler;
  };
}

// ---------------------------------------------------------------------------
// Reply helpers — consistent status codes and German messages
// ---------------------------------------------------------------------------

/**
 * Re-exported from session.ts so route modules have a single import for the
 * authorization surface.
 */
export { assertPasswordCurrent } from './session.js';

/** True when the rank string is one of the three valid ranks. */
export { isRank } from './ranking.js';

export async function forbid(reply: FastifyReply, message?: string): Promise<FastifyReply> {
  return reply.status(403).send({ error: message ?? 'Für diese Aktion fehlt Ihnen die Berechtigung.' });
}

export async function notFound(reply: FastifyReply, message = 'Datensatz nicht gefunden'): Promise<FastifyReply> {
  return reply.status(404).send({ error: message });
}

export async function badRequest(reply: FastifyReply, message: string): Promise<FastifyReply> {
  return reply.status(400).send({ error: message });
}

/** Strict positive-integer route param: digits only, no sign, whitespace or trailing text. */
const POSITIVE_INT = /^[1-9][0-9]{0,14}$/;

/**
 * Parse a positive integer route param.
 *
 * Strict rather than `parseInt`: `parseInt('1 OR 1=1')` returns 1, so a malformed or
 * injected-looking segment would previously have been silently accepted as a valid id
 * and forwarded to the database. Rejecting anything that is not entirely digits turns
 * that class of input into a clean 400.
 */
export function parseIdParam(value: string, _fieldName?: string): number | null {
  if (typeof value !== 'string' || !POSITIVE_INT.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}