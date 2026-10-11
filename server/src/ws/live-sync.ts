import { and, eq } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import {
  evaluationItems,
  evaluations,
  teachingAssignments,
} from '../db/schema.js';
import { config } from '../config.js';
import { getPersistedUserSessionState } from '../lib/session.js';
import { safeErrorLogFields } from '../lib/log-safety.js';
import { getClassAccess, findPupilInClass, canRateSubject, hasPersistedTeacherActor, MAX_POSTGRES_INTEGER, parsePositiveInt, LW_CLASS_ID, type AuthUser } from '../lib/guards.js';
import { isValidRating, invalidateRubricCache, loadRubricIndex, resolveCriterionId } from '../lib/rubric.js';
import { normalizeKnownSubject, normalizeSubject } from '../utils/subject.js';
import { getClassRoundLockState, isClassRoundLocked } from '../lib/class-round-lock.js';
import { getLatestRound } from '../lib/rounds.js';

/** Minimal shape we rely on; `ws` satisfies this. */
interface WsLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping?(): void;
  terminate?(): void;
  on(event: string, cb: (...args: any[]) => void): void;
}

/** RFC 6455: OPEN === 1. Hardcoded so we never depend on a global WebSocket class. */
const WS_OPEN = 1;

/** RFC 6455 close codes. */
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_TOO_BIG = 1009;

const MAX_MESSAGE_BYTES = 64 * 1024;
const SUBSCRIBE_PAYLOAD_KEYS = ['classId'] as const;
const FOCUS_PAYLOAD_KEYS = ['classId', 'pupilId', 'itemKey', 'subjectCode'] as const;
const UPDATE_RATING_PAYLOAD_KEYS = [
  'classId', 'pupilId', 'subjectCode', 'itemKey', 'rating', 'expectedVersion', 'criterionId', 'clientMutationId',
] as const;

function isClientMutationId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

function sendRatingError(
  client: ClientConnection,
  clientMutationId: string | undefined,
  message: string,
  code?: string,
): void {
  sendTo(client, {
    type: 'ERROR',
    message,
    ...(code ? { code } : {}),
    ...(clientMutationId ? { clientMutationId } : {}),
  });
}

function acknowledgeRatingWrite(client: ClientConnection, clientMutationId: string | undefined): void {
  if (clientMutationId) sendTo(client, { type: 'RATING_ACK', clientMutationId });
}

function hasOnlyKeys(payload: unknown, allowedKeys: readonly string[]): payload is Record<string, unknown> {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      Object.keys(payload).every((key) => allowedKeys.includes(key)),
  );
}

interface ClientConnection {
  ws: WsLike;
  /** Verified identity. Never populated from client input. */
  user: AuthUser;
  teacherName: string;
  roomIds: Set<number>;
}

interface ActiveSoftLock {
  classId: number;
  subjectCode: string;
  pupilId: number;
  itemKey: string;
  owner: ClientConnection;
  lockedAt: number;
  timeout: ReturnType<typeof setTimeout>;
}

const classRooms = new Map<number, Set<ClientConnection>>();
const allClients = new Set<ClientConnection>();
const activeSoftLocks = new Map<string, ActiveSoftLock>();

function softLockKey(classId: number, subjectCode: string, pupilId: number, itemKey: string): string {
  return `${classId}|${subjectCode}|${pupilId}|${itemKey}`;
}

function sendTo(client: ClientConnection, message: unknown): void {
  if (client.ws.readyState !== WS_OPEN) return;
  try {
    client.ws.send(JSON.stringify(message));
  } catch (err) {
    // A dead socket must not take down the broadcast loop for the whole room.
    console.error('WebSocket send failed:', safeErrorLogFields(err));
  }
}

export function broadcastToClass(
  classId: number,
  message: unknown,
  excludeClient?: WsLike,
): Promise<void> {
  const room = classRooms.get(classId);
  if (!room) return Promise.resolve();
  return Promise.all(Array.from(room).map(async (client) => {
    if (client.ws === excludeClient || client.ws.readyState !== WS_OPEN || !(await ensureLiveSession(client))) return;
    sendTo(client, message);
  })).then(() => undefined);
}

/**
 * Revalidate long-lived sockets against the durable account state. In-memory
 * closeUserWebSockets handles resets on this worker; this check covers sockets
 * owned by other workers, both when they send and before they receive broadcasts.
 */
async function ensureLiveSession(client: ClientConnection, clientMutationId?: string): Promise<boolean> {
  let state: { sessionVersion: number; mustChangePassword: boolean } | null;
  try {
    state = await getPersistedUserSessionState(client.user.id);
  } catch {
    state = null;
  }

  const passwordChangeRequired = Boolean(client.user.mustChangePassword || state?.mustChangePassword);
  const sessionRevoked = !state || client.user.sessionVersion !== state.sessionVersion;
  if (!passwordChangeRequired && !sessionRevoked) return true;

  const reason = passwordChangeRequired ? 'password change required' : 'session expired';
  sendTo(client, {
    type: 'ERROR',
    message: passwordChangeRequired
      ? 'Bitte setzen Sie zuerst ein neues Passwort.'
      : 'Die Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.',
    ...(passwordChangeRequired ? { code: 'PASSWORD_CHANGE_REQUIRED' } : {}),
    ...(clientMutationId ? { clientMutationId } : {}),
  });
  client.ws.close(CLOSE_POLICY_VIOLATION, reason);
  removeClient(client);
  return false;
}

// ---------------------------------------------------------------------------
// Round resolution
// ---------------------------------------------------------------------------

// Round resolution now lives in ../lib/rounds.js so the conference, evaluation
// and live-sync paths agree on which round is "the latest one".
const getActiveRound = getLatestRound;

// ---------------------------------------------------------------------------
// Connection handling
// ---------------------------------------------------------------------------

function leaveRoom(client: ClientConnection, classId: number): void {
  const room = classRooms.get(classId);
  if (!room) return;
  releaseClientLocks(client, classId);
  room.delete(client);
  client.roomIds.delete(classId);
  if (room.size === 0) classRooms.delete(classId);
}

function releaseSoftLock(key: string, expected?: ActiveSoftLock): void {
  const lock = activeSoftLocks.get(key);
  if (!lock || (expected && lock !== expected)) return;
  clearTimeout(lock.timeout);
  activeSoftLocks.delete(key);
  broadcastToClass(
    lock.classId,
    {
      type: 'CELL_UNLOCKED',
      classId: lock.classId,
      pupilId: lock.pupilId,
      itemKey: lock.itemKey,
      subjectCode: lock.subjectCode,
    },
    lock.owner.ws,
  );
}

function releaseClientLocks(client: ClientConnection, classId?: number): void {
  for (const [key, lock] of activeSoftLocks) {
    if (lock.owner === client && (classId === undefined || lock.classId === classId)) {
      releaseSoftLock(key, lock);
    }
  }
}

function removeClient(client: ClientConnection): void {
  for (const classId of Array.from(client.roomIds)) leaveRoom(client, classId);
  allClients.delete(client);
}

export function handleWebSocketConnection(ws: WsLike, user: AuthUser, teacherName: string): void {
  const client: ClientConnection = {
    ws,
    user: { ...user, sessionVersion: user.sessionVersion ?? 0 },
    teacherName,
    roomIds: new Set(),
  };
  allClients.add(client);

  ws.on('message', async (raw: any) => {
    let responseMutationId: string | undefined;
    try {
      if (typeof raw?.length === 'number' && raw.length > MAX_MESSAGE_BYTES) {
        ws.close(CLOSE_TOO_BIG, 'message too large');
        return;
      }

      const data = JSON.parse(raw.toString());
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'UPDATE_RATING' && isClientMutationId(data.payload?.clientMutationId)) {
        responseMutationId = data.payload.clientMutationId;
      }
      if (!(await ensureLiveSession(client, responseMutationId))) return;

      switch (data.type) {
        case 'SUBSCRIBE_CLASS':
          await onSubscribe(client, data.payload ?? {});
          break;
        case 'UNSUBSCRIBE_CLASS':
          await onUnsubscribe(client, data.payload ?? {});
          break;
        case 'CELL_FOCUS':
          await onCellFocus(client, data.payload ?? {});
          break;
        case 'CELL_BLUR':
          await onCellBlur(client, data.payload ?? {});
          break;
        case 'UPDATE_RATING':
          await onUpdateRating(client, data.payload ?? {});
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('WebSocket message error:', safeErrorLogFields(err));
      sendTo(client, {
        type: 'ERROR',
        message: 'Nachricht konnte nicht verarbeitet werden.',
        ...(responseMutationId ? { clientMutationId: responseMutationId } : {}),
      });
    }
  });

  ws.on('close', () => {
    removeClient(client);
  });

  ws.on('error', () => {
    removeClient(client);
  });
}

async function onSubscribe(client: ClientConnection, payload: any): Promise<void> {
  if (!hasOnlyKeys(payload, SUBSCRIBE_PAYLOAD_KEYS)) {
    sendTo(client, { type: 'ERROR', message: 'Ungültige Klassenanmeldung.' });
    return;
  }
  const classId = parsePositiveInt(payload?.classId);
  if (!classId) {
    sendTo(client, { type: 'ERROR', message: 'Ungültige Klassen-ID.' });
    return;
  }

  // Authorization is decided from the verified token, not from anything in the payload.
  const access = await getClassAccess(client.user, classId);
  if (!access.exists) {
    sendTo(client, { type: 'ERROR', message: 'Klasse nicht gefunden.' });
    return;
  }
  if (!access.canRead) {
    if (classId !== LW_CLASS_ID) {
      sendTo(client, {
      type: 'ERROR',
      message: 'Zugriff verweigert: Sie sind in dieser Klasse nicht eingeteilt.',
    });
      ws_disconnect(client);
    }
    return;
  }

  if (client.user.mustChangePassword) {
    sendTo(client, {
      type: 'ERROR',
      message: 'Bitte setzen Sie zuerst ein neues Passwort.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    return;
  }

  const room = classRooms.get(classId) ?? new Set<ClientConnection>();
  if (!classRooms.has(classId)) classRooms.set(classId, room);
  if (room.size >= config.wsRoomMaxClients && !room.has(client)) {
    sendTo(client, { type: 'ERROR', message: 'Diese Klasse ist bereits vollständig verbunden.' });
    return;
  }

  room.add(client);
  client.roomIds.add(classId);

  // Send the authoritative round so the client can show lock state immediately.
  const round = await getActiveRound();
  let isLockedByConference = false;
  if (round) {
    const isClassLocked = await getClassRoundLockState(round.id, classId);
    isLockedByConference = isClassRoundLocked(round.isLocked, isClassLocked);
  }
  sendTo(client, {
    type: 'SYNCED',
    classId,
    roundId: round?.id ?? null,
    isLockedByConference,
    canRate: access.canRate,
  });
  for (const lock of activeSoftLocks.values()) {
    if (lock.classId !== classId || lock.owner === client) continue;
    sendTo(client, {
      type: 'CELL_LOCKED',
      classId: lock.classId,
      subjectCode: lock.subjectCode,
      pupilId: lock.pupilId,
      itemKey: lock.itemKey,
      teacherName: lock.owner.teacherName,
      lockedAt: lock.lockedAt,
    });
  }
}

async function onUnsubscribe(client: ClientConnection, payload: any): Promise<void> {
  if (!hasOnlyKeys(payload, SUBSCRIBE_PAYLOAD_KEYS)) {
    sendTo(client, { type: 'ERROR', message: 'Ungültige Klassenabmeldung.' });
    return;
  }
  const classId = parsePositiveInt(payload?.classId);
  if (classId && client.roomIds.has(classId)) leaveRoom(client, classId);
}

function ws_disconnect(client: ClientConnection): void {
  client.ws.close(CLOSE_POLICY_VIOLATION, 'not authorised');
}

async function onCellFocus(client: ClientConnection, payload: any): Promise<void> {
  if (!hasOnlyKeys(payload, FOCUS_PAYLOAD_KEYS)) return;
  const classId = parsePositiveInt(payload?.classId);
  const pupilId = parsePositiveInt(payload?.pupilId);
  const itemKey = typeof payload?.itemKey === 'string' && payload.itemKey.length <= 64 ? payload.itemKey.trim() : null;
  const knownSubject = normalizeKnownSubject(payload?.subjectCode);
  if (!classId || !client.roomIds.has(classId) || !pupilId || !itemKey || !knownSubject) return;

  const access = await getClassAccess(client.user, classId);
  if (!canRateSubject(access, knownSubject.code)) return;

  const key = softLockKey(classId, knownSubject.code, pupilId, itemKey);
  const existing = activeSoftLocks.get(key);
  if (existing) clearTimeout(existing.timeout);
  let lock!: ActiveSoftLock;
  const timeout = setTimeout(() => releaseSoftLock(key, lock), config.wsSoftLockTtlMs);
  lock = {
    classId,
    subjectCode: knownSubject.code,
    pupilId,
    itemKey,
    owner: client,
    lockedAt: Date.now(),
    timeout,
  };
  lock.timeout.unref?.();
  activeSoftLocks.set(key, lock);

  await broadcastToClass(
    classId,
    {
      type: 'CELL_LOCKED',
      classId,
      pupilId,
      itemKey,
      subjectCode: knownSubject.code,
      // Identity comes from the token-derived name, never from the message.
      teacherName: client.teacherName,
      lockedAt: lock.lockedAt,
    },
    client.ws,
  );
}

async function onCellBlur(client: ClientConnection, payload: any): Promise<void> {
  if (!hasOnlyKeys(payload, FOCUS_PAYLOAD_KEYS)) return;
  const classId = parsePositiveInt(payload?.classId);
  const pupilId = parsePositiveInt(payload?.pupilId);
  const itemKey = typeof payload?.itemKey === 'string' && payload.itemKey.length <= 64 ? payload.itemKey.trim() : null;
  const knownSubject = normalizeKnownSubject(payload?.subjectCode);
  if (!classId || !client.roomIds.has(classId) || !pupilId || !itemKey || !knownSubject) return;

  const key = softLockKey(classId, knownSubject.code, pupilId, itemKey);
  const lock = activeSoftLocks.get(key);
  if (lock?.owner === client) releaseSoftLock(key, lock);
}

/**
 * Write one rubric rating.
 *
 * Every decision here is made from `client.user`, which came from a verified JWT:
 *   - `mustChangePassword` blocks writes until the account is rotated
 *   - `getClassAccess().canRate` replaces the previous `if (client.teacherId)` guard,
 *     which could be bypassed by simply omitting or forging `teacherId`
 *   - the pupil must actually belong to the class
 *   - the item key must exist in the active rubric, and the rating must be a known value
 */
async function onUpdateRating(client: ClientConnection, payload: any): Promise<void> {
  const clientMutationId = isClientMutationId(payload?.clientMutationId)
    ? payload.clientMutationId
    : undefined;
  if (payload?.clientMutationId !== undefined && !clientMutationId) {
    sendRatingError(client, undefined, 'Ungültige Bewertungsnachricht.');
    return;
  }
  if (!hasOnlyKeys(payload, UPDATE_RATING_PAYLOAD_KEYS)) {
    sendRatingError(client, clientMutationId, 'Unbekanntes Feld in Bewertung.');
    return;
  }
  if (
    payload.criterionId !== undefined &&
    (typeof payload.criterionId !== 'string' || payload.criterionId.length > 36)
  ) {
    sendRatingError(client, clientMutationId, 'Ungültige Bewertungsnachricht.');
    return;
  }

  const classId = parsePositiveInt(payload?.classId);
  const pupilId = parsePositiveInt(payload?.pupilId);
  const itemKey = typeof payload?.itemKey === 'string' && payload.itemKey.length <= 64 ? payload.itemKey.trim() : null;
  const rating = typeof payload?.rating === 'string' && payload.rating.length <= 16 ? payload.rating.trim() : null;

  if (!classId || !pupilId || !itemKey || rating === null) {
    sendRatingError(client, clientMutationId, 'Unvollständige Bewertung.');
    return;
  }

  const rawVersion = payload.expectedVersion;
  if (
    typeof rawVersion !== 'number' ||
    !Number.isSafeInteger(rawVersion) ||
    rawVersion < 0 ||
    rawVersion > MAX_POSTGRES_INTEGER
  ) {
    sendRatingError(client, clientMutationId, 'Ungültige Bewertungsversion.');
    return;
  }
  const expectedVersion = rawVersion;

  const rawSubject = payload.subjectCode === undefined ? 'D' : payload.subjectCode;
  if (typeof rawSubject !== 'string' || rawSubject.length > 32) {
    sendRatingError(client, clientMutationId, 'Ungültiges Unterrichtsfach.');
    return;
  }
  const knownSubject = normalizeKnownSubject(rawSubject);
  if (!knownSubject) {
    sendRatingError(client, clientMutationId, 'Ungültiges Unterrichtsfach.');
    return;
  }
  const subjectCode = knownSubject.code;

  if (!client.roomIds.has(classId)) {
    sendRatingError(client, clientMutationId, 'Sie haben diese Klasse nicht geöffnet.');
    return;
  }

  const access = await getClassAccess(client.user, classId);
  if (!access.canRate) {
    sendRatingError(client, clientMutationId, 'Zugriff verweigert: Sie sind für diese Klasse nicht als Lehrkraft eingeteilt.');
    return;
  }

  if (!canRateSubject(access, subjectCode)) {
    sendRatingError(client, clientMutationId, 'Zugriff verweigert: Sie sind für dieses Fach in dieser Klasse nicht eingeteilt.');
    return;
  }

  const teacherId = client.user.teacherId;
  if (!hasPersistedTeacherActor(teacherId)) {
    sendRatingError(
      client,
      clientMutationId,
      'Bewertungen sind nicht verfügbar, weil kein Lehrkraftkonto zur Erfassung zugeordnet ist.',
      'SYSTEM_ACTOR_NOT_CONFIGURED',
    );
    return;
  }

  const round = await getActiveRound();
  if (!round || round.isLocked) {
    sendRatingError(client, clientMutationId, 'Es ist kein offener Bewertungszeitraum.');
    return;
  }

  const isClassLocked = await getClassRoundLockState(round.id, classId);
  if (isClassLocked) {
    sendRatingError(
      client,
      clientMutationId,
      'Die Klassenkonferenz ist gesperrt. Bewertungen können nicht mehr geändert werden.',
      'CLASS_CONFERENCE_LOCKED',
    );
    return;
  }

  if (new Date() > config.submissionDeadline) {
    sendRatingError(client, clientMutationId, 'Die Abgabefrist ist abgelaufen.');
    return;
  }

  const pupil = await findPupilInClass(pupilId, classId);
  if (!pupil) {
    sendRatingError(client, clientMutationId, 'Dieser Schüler gehört nicht zu dieser Klasse.');
    return;
  }

  const rubric = await loadRubricIndex();
  const criterionId = resolveCriterionId(rubric, itemKey);
  if (!criterionId) {
    sendRatingError(client, clientMutationId, 'Unbekanntes Beobachtungsmerkmal.');
    return;
  }
  if (!isValidRating(rubric, rating)) {
    sendRatingError(client, clientMutationId, 'Unbekannter Bewertungswert.');
    return;
  }

  // One evaluation per (round, pupil, class, subject). A concurrent insert can hit the
  // unique index, so fall back to re-reading rather than failing the write.
  let [evalRecord] = await db
    .select()
    .from(evaluations)
    .where(
      and(
        eq(evaluations.roundId, round.id),
        eq(evaluations.pupilId, pupilId),
        eq(evaluations.classId, classId),
        eq(evaluations.subjectCode, subjectCode),
      ),
    )
    .limit(1);

  if (!evalRecord && payload.expectedVersion !== undefined && expectedVersion > 0) {
    sendTo(client, {
      type: 'CONFLICT',
      message: 'Konflikt: Die Bewertung wurde seit dem letzten Laden geändert.',
      classId,
      pupilId,
      itemKey,
      subjectCode,
      currentRating: '',
      currentVersion: 0,
      updatedBy: '',
      ...(clientMutationId ? { clientMutationId } : {}),
    });
    return;
  }

  if (!evalRecord) {
    try {
      [evalRecord] = await db
        .insert(evaluations)
        .values({
          roundId: round.id,
          pupilId,
          classId,
          subjectCode,
          teacherId,
        })
        .returning();
    } catch {
      [evalRecord] = await db
        .select()
        .from(evaluations)
        .where(
          and(
            eq(evaluations.roundId, round.id),
            eq(evaluations.pupilId, pupilId),
            eq(evaluations.classId, classId),
            eq(evaluations.subjectCode, subjectCode),
          ),
        )
        .limit(1);
      if (!evalRecord) {
        sendRatingError(client, clientMutationId, 'Bewertung konnte nicht angelegt werden.');
        return;
      }
    }
  }

  const [existingItem] = await db
    .select()
    .from(evaluationItems)
    .where(
      and(
        eq(evaluationItems.evaluationId, evalRecord.id),
        eq(evaluationItems.itemKey, itemKey),
      ),
    )
    .limit(1);

  if (!existingItem && payload.expectedVersion !== undefined && expectedVersion > 0) {
    sendTo(client, {
      type: 'CONFLICT',
      message: 'Konflikt: Die Bewertung wurde seit dem letzten Laden geändert.',
      evaluationId: evalRecord.id,
      classId,
      pupilId,
      itemKey,
      subjectCode,
      currentRating: '',
      currentVersion: 0,
      updatedBy: '',
      ...(clientMutationId ? { clientMutationId } : {}),
    });
    return;
  }

  if (!existingItem) {
    let newItem;
    try {
      [newItem] = await db
        .insert(evaluationItems)
        .values({
          evaluationId: evalRecord.id,
          criterionId,
          itemKey,
          rating,
          version: 1,
          updatedByTeacherId: teacherId,
          updatedAt: new Date(),
        })
        .returning();
    } catch {
      // Both clients read this empty cell as "no row" and both inserted; one lost the race
      // on the unique index. An error message would be a dead end - the winning value is
      // not on the loser's screen anywhere - so answer with the same reconcilable CONFLICT
      // the version race uses and let the client apply the value that actually landed.
      const [winner] = await db
        .select()
        .from(evaluationItems)
        .where(
          and(
            eq(evaluationItems.evaluationId, evalRecord.id),
            eq(evaluationItems.itemKey, itemKey),
          ),
        )
        .limit(1);

      if (winner) {
        sendTo(client, {
          type: 'CONFLICT',
          message: 'Konflikt: Eine Kollegin oder ein Kollege hat diesen Wert gerade gesetzt.',
          evaluationId: evalRecord.id,
          classId,
          pupilId,
          itemKey,
          subjectCode,
          currentRating: winner.rating,
          currentVersion: winner.version,
          updatedAt: winner.updatedAt,
          ...(clientMutationId ? { clientMutationId } : {}),
        });
        return;
      }

      sendRatingError(client, clientMutationId, 'Diese Bewertung wurde gerade von einer Kollegin gesetzt.');
      return;
    }

    releaseSoftLock(softLockKey(classId, subjectCode, pupilId, itemKey));
    acknowledgeRatingWrite(client, clientMutationId);
    await broadcastToClass(classId, {
      type: 'RATING_UPDATED',
      evaluationId: evalRecord.id,
      pupilId,
      itemKey,
      rating: newItem.rating,
      version: newItem.version,
      updatedBy: client.teacherName,
      updatedAt: newItem.updatedAt,
      subjectCode: evalRecord.subjectCode,
    });
    return;
  }

  // Atomic optimistic concurrency control: the version predicate is evaluated by
  // Postgres, so two simultaneous taps cannot both win.
  const updateResult = await getPool().query(
    `UPDATE evaluation_items
       SET rating = $1,
           version = version + 1,
           updated_by_teacher_id = $2,
           updated_at = NOW()
     WHERE id = $3 AND version = $4
     RETURNING *;`,
    [rating, teacherId, existingItem.id, expectedVersion],
  );

  if (updateResult.rowCount === 0) {
    const [latest] = await db
      .select()
      .from(evaluationItems)
      .where(eq(evaluationItems.id, existingItem.id))
      .limit(1);

    sendTo(client, {
      type: 'CONFLICT',
      message: 'Konflikt: Eine Kollegin oder ein Kollege hat diesen Wert gerade geändert.',
      evaluationId: evalRecord.id,
      classId,
      pupilId,
      itemKey,
      subjectCode,
      currentRating: latest?.rating ?? '',
      currentVersion: latest?.version ?? 0,
      updatedAt: latest?.updatedAt ?? null,
      ...(clientMutationId ? { clientMutationId } : {}),
    });
    return;
  }

  const updated = updateResult.rows[0];
  releaseSoftLock(softLockKey(classId, subjectCode, pupilId, itemKey));
  acknowledgeRatingWrite(client, clientMutationId);
  await broadcastToClass(classId, {
    type: 'RATING_UPDATED',
    evaluationId: evalRecord.id,
    pupilId,
    itemKey,
    rating: updated.rating,
    version: updated.version,
    updatedBy: client.teacherName,
    updatedAt: updated.updated_at,
    subjectCode: evalRecord.subjectCode,
  });
}

/**
 * Heartbeat. Drops sockets that vanished without a TCP FIN (tab crash, yanked cable),
 * which previously leaked room entries indefinitely.
 */
export function startWebSocketHeartbeat(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    for (const client of allClients) {
      if (client.ws.readyState !== WS_OPEN) {
        client.ws.terminate?.();
        removeClient(client);
        continue;
      }
      try {
        client.ws.ping?.();
      } catch {
        client.ws.terminate?.();
        removeClient(client);
      }
    }
  }, intervalMs);

  timer.unref?.();
  return timer;
}

export function stopWebSocketHeartbeat(timer: NodeJS.Timeout): void {
  clearInterval(timer);
}

export function closeAllWebSockets(code = CLOSE_GOING_AWAY, reason = 'server shutting down'): void {
  for (const lock of activeSoftLocks.values()) clearTimeout(lock.timeout);
  activeSoftLocks.clear();
  for (const client of allClients) {
    try {
      client.ws.close(code, reason);
    } catch {
      client.ws.terminate?.();
    }
  }
  allClients.clear();
  classRooms.clear();
}

/** Immediately terminate this worker's sockets after an administrator password reset. */
export function closeUserWebSockets(userId: string): void {
  for (const client of Array.from(allClients)) {
    if (client.user.id !== userId) continue;
    sendTo(client, {
      type: 'ERROR',
      message: 'Bitte setzen Sie zuerst ein neues Passwort.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    client.ws.close(CLOSE_POLICY_VIOLATION, 'password change required');
    removeClient(client);
  }
}

/** Test seam: current room occupancy per class. */
export function getRoomSizes(): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [classId, room] of classRooms) out[classId] = room.size;
  return out;
}

export function resetLiveSyncForTests(): void {
  for (const lock of activeSoftLocks.values()) clearTimeout(lock.timeout);
  activeSoftLocks.clear();
  classRooms.clear();
  allClients.clear();
  invalidateRubricCache();
}
