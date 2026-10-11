import type { FastifyReply, FastifyRequest, preHandlerHookHandler, preValidationHookHandler } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pupils, schoolClasses, teachingAssignments, teachers, timetableLessons } from '../db/schema.js';
import { normalizeKnownSubject, normalizeSubject, type NormalizedSubject } from '../utils/subject.js';
import { currentPeriod } from './period-times.js';
import { clearSessionCookie, getPersistedUserSessionState, isUserForcedToChangePassword } from './session.js';

export type Role = 'admin' | 'head_teacher' | 'teacher' | 'pupil';

/** Shape of a verified JWT payload. Identity always originates here, never from a request body. */
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  teacherId?: number;
  pupilId?: number;
  mustChangePassword?: boolean;
  sessionVersion?: number;
}

/** The minimal identity projection that authorization helpers need. */
export type Identity = Pick<AuthUser, 'role' | 'teacherId'>;

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
  interface FastifyInstance {
    authenticate: preValidationHookHandler;
    requireRole: (...roles: Role[]) => preValidationHookHandler;
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

/**
* The Lernwerkstatt "class" — a real `school_classes` row (name `LW`, `grade` 0) that is
* filtered out of the normal class lists in `routes/classes.ts` and used instead as the
* WebSocket room of the Lernwerkstatt. Pupils are never members of it; it exists so the
* duty teacher has one place to be sent live updates.
*/
export const LW_CLASS_ID = 999;

/** True for the administrator and the headmasters (SLC, MED). */
export async function isSchoolLeader(user: Identity): Promise<boolean> {
if (user.role === 'admin') return true;
if (!user.teacherId) return false;
return isHeadmasterUser(user, await getTeacher(user.teacherId));
}


/**
* Does this teacher hold the Lernwerkstatt slot in the period that is running right now?
*
* The duty roster is the timetable itself: `timetable_lessons` carries one LW lesson per
* period (class 999), so "who is in the room" is a lookup rather than a separate table that
* could fall out of step with the plan. Outside the bell schedule this is always false —
* reading a roster at 22:00 must not match Monday's period 10.
*/
export async function hasLwDutySlot(teacherId: number, now: Date = new Date()): Promise<boolean> {
const { dayOfWeek, period, isSchoolHours } = currentPeriod(now);
if (!isSchoolHours) return false;
const rows = await db
.select({ teacherId: timetableLessons.teacherId })
.from(timetableLessons)
.where(
and(
eq(timetableLessons.classId, LW_CLASS_ID),
eq(timetableLessons.dayOfWeek, dayOfWeek),
eq(timetableLessons.period, period),
),
)
.limit(1);
return rows[0]?.teacherId === teacherId;
}

export async function getGlobalAccess(user: Identity): Promise<GlobalAccess> {
  const teacher = user.teacherId ? await getTeacher(user.teacherId) : null;
  const isAdmin = user.role === 'admin';
  const isHeadmaster = isHeadmasterUser(user, teacher);

  if (isAdmin || isHeadmaster) {
    return { isAdmin, isHeadmaster, teacherId: user.teacherId, classIds: null };
  }

  // Non-admin accounts without a linked teacher row and pupils receive an empty scope
  if (!user.teacherId || (user as any).role === 'pupil') {
    return { isAdmin: false, isHeadmaster: false, teacherId: user.teacherId, classIds: [] };
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

export async function canAccessClass(user: Identity, classId: number): Promise<boolean> {
  const access = await getGlobalAccess(user);
  if (access.classIds === null) return true;
  return access.classIds.includes(classId);
}

/**
 * Resolve everything a handler needs to make an authorization decision for one class,
 * in a fixed number of queries. Prefer this over ad-hoc checks so the rules stay in one place.
 */
export async function getClassAccess(user: Identity, classId: number): Promise<ClassAccess> {
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
    return { ...base, isHeadmaster: true, isCoreTeacher: true, canRead: true, canRecord: true, canRate: true, canManagePupils: true, canRunConference: true };
  }

  const teacher = user.teacherId ? await getTeacher(user.teacherId) : null;
  base.isHeadmaster = isHeadmasterUser(user, teacher);
  if (teacher) {
    base.isKv =
      kvFieldMatches(cls.headTeacher1, teacher) || kvFieldMatches(cls.headTeacher2, teacher);
  }

  if (user.teacherId) {
    const assignments = await db
      .select({
        subjectName: teachingAssignments.subjectName,
        subjectCode: teachingAssignments.subjectCode,
      })
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
        const n = normalizeSubject(a.subjectCode || a.subjectName);
        return [n.code, n];
      })).values(),
    );
    base.isCoreTeacher = base.subjects.some((s) => s.isCoreSmile);
  }

  // Headmasters see and may rate every class; homeroom heads and assigned teachers
  // are scoped to the classes they are actually responsible for.
  if (base.isHeadmaster) {
    return { ...base, isCoreTeacher: true, canRead: true, canRecord: true, canRate: true, canRunConference: true };
  }
  if (user.role === 'pupil') return base; // pupil logins are not wired up yet

  const isResponsible = base.teaches || base.isKv;
  const isLwDuty =
    classId === LW_CLASS_ID && user.teacherId ? await hasLwDutySlot(user.teacherId) : false;
  return {
    ...base,
    canRead: isResponsible || isLwDuty,
    canRecord: isResponsible,
    canRate: isResponsible,
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

/**
 * Decides whether a caller may submit ratings for a specific subject in a class.
 *
 * Class-level `access.canRate` must be true first.
 * Administrative users and school leadership (headmasters) may rate any subject.
 * Ordinary teachers may only rate subjects assigned to them in that class.
 */
export function canRateSubject(access: ClassAccess, subjectCode: string): boolean {
  if (!access.canRate) return false;
  const knownSubject = normalizeKnownSubject(subjectCode);
  if (!knownSubject) return false;
  if (access.isAdmin || access.isHeadmaster) return true;
  return access.subjects.some((s) => s.code === knownSubject.code);
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

/** The canonical `authenticate` preValidation hook. Populates `request.authUser`. */
export function buildAuthenticate(jwtVerify: (request: FastifyRequest) => Promise<unknown>): preValidationHookHandler {
  const handler: preValidationHookHandler = async function authenticate(request, reply) {
    try {
      const payload = (await jwtVerify(request)) as AuthUser;
      const mustChange = Boolean(payload.mustChangePassword || isUserForcedToChangePassword(String(payload.id)));
      request.authUser = {
        id: String(payload.id),
        username: payload.username,
        role: payload.role,
        teacherId: payload.teacherId,
        pupilId: payload.pupilId,
        mustChangePassword: mustChange,
        sessionVersion: Number.isSafeInteger(payload.sessionVersion) && (payload.sessionVersion ?? 0) >= 0
          ? payload.sessionVersion
          : 0,
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
): (...roles: Role[]) => preValidationHookHandler {
  return (...roles: Role[]) => {
    const handler: preValidationHookHandler = async function requireRole(request, reply) {
      // Authenticate inline rather than composing handlers, so there is one code path
      // that can populate `request.authUser`.
      try {
        const payload = (await jwtVerify(request)) as AuthUser;
        const mustChange = Boolean(payload.mustChangePassword || isUserForcedToChangePassword(String(payload.id)));
        request.authUser = {
          id: String(payload.id),
          username: payload.username,
          role: payload.role,
        teacherId: payload.teacherId,
        pupilId: payload.pupilId,
        mustChangePassword: mustChange,
        sessionVersion: Number.isSafeInteger(payload.sessionVersion) && (payload.sessionVersion ?? 0) >= 0
          ? payload.sessionVersion
          : 0,
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

/**
 * Compare the verified JWT against durable account state after schema validation
 * and before every authenticated handler. A reset-pending account may reach only
 * the password-change endpoint; it must not keep reading pupil data on an old cookie.
 */
export function buildSessionGuard(
  readSessionState: typeof getPersistedUserSessionState = getPersistedUserSessionState,
): preHandlerHookHandler {
  return async function validateSessionVersion(request, reply) {
    const user = request.authUser;
    if (!user) return;

    const state = await readSessionState(user.id);
    if (!state) {
      clearSessionCookie(reply);
      return reply.status(401).send({ error: 'Nicht authentifiziert' });
    }

    const tokenVersion = user.sessionVersion;
    if (!Number.isSafeInteger(tokenVersion) || (tokenVersion as number) < 0) {
      clearSessionCookie(reply);
      return reply.status(401).send({ error: 'Nicht authentifiziert' });
    }

    user.sessionVersion = state.sessionVersion;
    user.mustChangePassword = state.mustChangePassword;

    if (state.mustChangePassword) {
      const pathname = (request.url ?? '').split('?', 1)[0];
      const isPasswordChangeRoute =
        request.method === 'POST' && pathname === '/api/auth/password';
      const isAuthStatusRoute =
        (request.method === 'GET' && (pathname === '/api/auth/me' || pathname === '/api/auth/session')) ||
        (request.method === 'POST' && pathname === '/api/auth/logout');

      if (isPasswordChangeRoute) {
        return;
      }

      if (isAuthStatusRoute) {
        if (tokenVersion !== state.sessionVersion) {
          clearSessionCookie(reply);
          return reply.status(401).send({ error: 'Nicht authentifiziert' });
        }
        return;
      }

      return reply.status(403).send({
        error: 'Bitte setzen Sie zuerst ein neues Passwort.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    if (tokenVersion !== state.sessionVersion) {
      clearSessionCookie(reply);
      return reply.status(401).send({ error: 'Nicht authentifiziert' });
    }
  };
}

// ---------------------------------------------------------------------------
// Reply helpers — consistent status codes and German messages
// ---------------------------------------------------------------------------

/**
 * Re-exported from session.ts so route modules have a single import for the
 * authorization surface.
 */
export {
  assertPasswordCurrent,
  markUserMustChangePassword,
  clearUserMustChangePassword,
  isUserForcedToChangePassword,
} from './session.js';

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
export const MAX_POSTGRES_INTEGER = 2_147_483_647;

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
  if (!Number.isSafeInteger(parsed) || parsed > MAX_POSTGRES_INTEGER) return null;
  return parsed;
}

/**
 * Is this a usable `teacher_id` foreign key?
 *
 * `teacherId` reaches the write paths from the session, and older code substituted
 * `0` for "unknown teacher". Zero is a perfectly valid primary key, so writing it
 * would attach ratings/ownership to a phantom teacher row instead of failing. Every
 * actor check funnels through here so the HTTP route and the WebSocket path agree.
 */
export function hasPersistedTeacherActor(teacherId: number | null | undefined): teacherId is number {
  return typeof teacherId === 'number' && Number.isSafeInteger(teacherId) && teacherId > 0;
}

/**
 * Persistable teacher foreign key.
 *
 * Same rule as `hasPersistedTeacherActor`, but for the nullable columns (audit log
 * `actor_id`, conference `confirmed_by`/`changed_by`) where "no actor" is a legitimate
 * state. A missing, non-integer or non-positive id collapses to `null` instead of
 * persisting a sentinel that points at a phantom teacher row.
 */
export function safeTeacherId(teacherId: number | null | undefined): number | null {
  return hasPersistedTeacherActor(teacherId) ? teacherId : null;
}

/**
 * Strict positive integer parser for numbers or strings.
 * Rejects non-integers, numbers <= 0, and strings with non-digit characters.
 */
export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_POSTGRES_INTEGER ? value : null;
  }
  if (typeof value === 'string') {
    return parseIdParam(value);
  }
  return null;
}
