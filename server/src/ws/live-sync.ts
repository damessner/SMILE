import { and, desc, eq } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import {
  evaluationItems,
  evaluations,
  observationRounds,
  teachingAssignments,
} from '../db/schema.js';
import { config } from '../config.js';
import { getClassAccess, findPupilInClass, type AuthUser } from '../lib/guards.js';
import { isValidRating, invalidateRubricCache, loadRubricIndex, resolveCriterionId } from '../lib/rubric.js';
import { normalizeSubject } from '../utils/subject.js';

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

interface ClientConnection {
  ws: WsLike;
  /** Verified identity. Never populated from client input. */
  user: AuthUser;
  teacherName: string;
  roomIds: Set<number>;
}

const classRooms = new Map<number, Set<ClientConnection>>();
const allClients = new Set<ClientConnection>();

function sendTo(client: ClientConnection, message: unknown): void {
  if (client.ws.readyState !== WS_OPEN) return;
  try {
    client.ws.send(JSON.stringify(message));
  } catch (err) {
    // A dead socket must not take down the broadcast loop for the whole room.
    console.error('WebSocket send failed:', err);
  }
}

export function broadcastToClass(
  classId: number,
  message: unknown,
  excludeClient?: WsLike,
): void {
  const room = classRooms.get(classId);
  if (!room) return;
  for (const client of room) {
    if (client.ws === excludeClient) continue;
    sendTo(client, message);
  }
}

// ---------------------------------------------------------------------------
// Round resolution
// ---------------------------------------------------------------------------

async function getActiveRound() {
  const [round] = await db
    .select()
    .from(observationRounds)
    .orderBy(desc(observationRounds.createdAt))
    .limit(1);
  return round ?? null;
}

/** Pick the single unlocked round, deterministically. */
async function getUnlockedRound() {
  const [round] = await db
    .select()
    .from(observationRounds)
    .where(eq(observationRounds.isLocked, false))
    .orderBy(desc(observationRounds.createdAt))
    .limit(1);
  return round ?? null;
}

// ---------------------------------------------------------------------------
// Connection handling
// ---------------------------------------------------------------------------

function leaveRoom(client: ClientConnection, classId: number): void {
  const room = classRooms.get(classId);
  if (!room) return;
  room.delete(client);
  client.roomIds.delete(classId);
  if (room.size === 0) classRooms.delete(classId);
  else broadcastToClass(classId, { type: 'USER_LEFT', teacherName: client.teacherName });
}

export function handleWebSocketConnection(ws: WsLike, user: AuthUser, teacherName: string): void {
  const client: ClientConnection = { ws, user, teacherName, roomIds: new Set() };
  allClients.add(client);

  ws.on('message', async (raw: any) => {
    try {
      if (typeof raw?.length === 'number' && raw.length > MAX_MESSAGE_BYTES) {
        ws.close(CLOSE_TOO_BIG, 'message too large');
        return;
      }

      const data = JSON.parse(raw.toString());
      if (!data || typeof data.type !== 'string') return;

      switch (data.type) {
        case 'SUBSCRIBE_CLASS':
          await onSubscribe(client, data.payload ?? {});
          break;
        case 'UNSUBSCRIBE_CLASS':
          await onUnsubscribe(client, data.payload ?? {});
          break;
        case 'CELL_FOCUS':
          onCellFocus(client, data.payload ?? {});
          break;
        case 'CELL_BLUR':
          onCellBlur(client, data.payload ?? {});
          break;
        case 'UPDATE_RATING':
          await onUpdateRating(client, data.payload ?? {});
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      sendTo(client, { type: 'ERROR', message: 'Nachricht konnte nicht verarbeitet werden.' });
    }
  });

  ws.on('close', () => {
    for (const classId of Array.from(client.roomIds)) leaveRoom(client, classId);
    allClients.delete(client);
  });

  ws.on('error', () => {
    for (const classId of Array.from(client.roomIds)) leaveRoom(client, classId);
    allClients.delete(client);
  });
}

async function onSubscribe(client: ClientConnection, payload: any): Promise<void> {
  const classId = Number.parseInt(payload?.classId, 10);
  if (!Number.isFinite(classId) || classId <= 0) {
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
    sendTo(client, {
      type: 'ERROR',
      message: 'Zugriff verweigert: Sie sind in dieser Klasse nicht eingeteilt.',
    });
    ws_disconnect(client);
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

  broadcastToClass(classId, { type: 'USER_JOINED', teacherName: client.teacherName, classId });

  // Send the authoritative round so the client can show lock state immediately.
  const round = await getActiveRound();
  sendTo(client, {
    type: 'SYNCED',
    classId,
    isLockedByConference: !!round?.isLocked,
    canRate: access.canRate,
  });
}

async function onUnsubscribe(client: ClientConnection, payload: any): Promise<void> {
  const classId = Number.parseInt(payload?.classId, 10);
  if (Number.isFinite(classId) && client.roomIds.has(classId)) leaveRoom(client, classId);
}

function ws_disconnect(client: ClientConnection): void {
  client.ws.close(CLOSE_POLICY_VIOLATION, 'not authorised');
}

function onCellFocus(client: ClientConnection, payload: any): void {
  const classId = Number.parseInt(payload?.classId, 10);
  const pupilId = Number.parseInt(payload?.pupilId, 10);
  const itemKey = typeof payload?.itemKey === 'string' ? payload.itemKey : null;
  if (!client.roomIds.has(classId) || !Number.isFinite(pupilId) || !itemKey) return;

  broadcastToClass(
    classId,
    {
      type: 'CELL_LOCKED',
      pupilId,
      itemKey,
      // Identity comes from the token-derived name, never from the message.
      teacherName: client.teacherName,
      lockedAt: Date.now(),
    },
    client.ws,
  );
}

function onCellBlur(client: ClientConnection, payload: any): void {
  const classId = Number.parseInt(payload?.classId, 10);
  const pupilId = Number.parseInt(payload?.pupilId, 10);
  const itemKey = typeof payload?.itemKey === 'string' ? payload.itemKey : null;
  if (!client.roomIds.has(classId) || !Number.isFinite(pupilId) || !itemKey) return;

  broadcastToClass(classId, { type: 'CELL_UNLOCKED', pupilId, itemKey }, client.ws);
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
  const classId = Number.parseInt(payload?.classId, 10);
  const pupilId = Number.parseInt(payload?.pupilId, 10);
  const itemKey = typeof payload?.itemKey === 'string' ? payload.itemKey : null;
  const rating = typeof payload?.rating === 'string' ? payload.rating : null;
  const expectedVersion = Number.isFinite(Number(payload?.expectedVersion))
    ? Number(payload.expectedVersion)
    : 1;
  const subjectCode = typeof payload?.subjectCode === 'string' && payload.subjectCode
    ? normalizeSubject(payload.subjectCode).code
    : 'D';

  if (!Number.isFinite(classId) || !Number.isFinite(pupilId) || !itemKey || rating === null) {
    sendTo(client, { type: 'ERROR', message: 'Unvollständige Bewertung.' });
    return;
  }

  if (!client.roomIds.has(classId)) {
    sendTo(client, { type: 'ERROR', message: 'Sie haben diese Klasse nicht geöffnet.' });
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

  const access = await getClassAccess(client.user, classId);
  if (!access.canRate) {
    sendTo(client, {
      type: 'ERROR',
      message: 'Zugriff verweigert: Sie sind für diese Klasse nicht als Lehrkraft eingeteilt.',
    });
    return;
  }

  const round = await getUnlockedRound();
  if (!round) {
    sendTo(client, { type: 'ERROR', message: 'Es ist kein offener Bewertungszeitraum.' });
    return;
  }

  if (new Date() > config.submissionDeadline) {
    sendTo(client, { type: 'ERROR', message: 'Die Abgabefrist ist abgelaufen.' });
    return;
  }

  const pupil = await findPupilInClass(pupilId, classId);
  if (!pupil) {
    sendTo(client, {
      type: 'ERROR',
      message: 'Dieser Schüler gehört nicht zu dieser Klasse.',
    });
    return;
  }

  const rubric = await loadRubricIndex();
  const criterionId = resolveCriterionId(rubric, itemKey);
  if (!criterionId) {
    sendTo(client, { type: 'ERROR', message: 'Unbekanntes Beobachtungsmerkmal.' });
    return;
  }
  if (!isValidRating(rubric, rating)) {
    sendTo(client, { type: 'ERROR', message: 'Unbekannter Bewertungswert.' });
    return;
  }

  // Teacher attribution comes from the token. A pupil-login or admin account has no
  // teacherId; those writes are attributed to 0 and surfaced as "System" in the UI.
  const teacherId = client.user.teacherId ?? null;

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

  if (!evalRecord) {
    try {
      [evalRecord] = await db
        .insert(evaluations)
        .values({
          roundId: round.id,
          pupilId,
          classId,
          subjectCode,
          teacherId: teacherId ?? 0,
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
        sendTo(client, { type: 'ERROR', message: 'Bewertung konnte nicht angelegt werden.' });
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
      sendTo(client, { type: 'ERROR', message: 'Diese Bewertung wurde gerade von einer Kollegin gesetzt.' });
      return;
    }

    broadcastToClass(classId, {
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
      pupilId,
      itemKey,
      currentRating: latest?.rating,
      currentVersion: latest?.version,
      updatedBy: client.teacherName,
    });
    return;
  }

  const updated = updateResult.rows[0];
  broadcastToClass(classId, {
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
        allClients.delete(client);
        continue;
      }
      try {
        client.ws.ping?.();
      } catch {
        client.ws.terminate?.();
        allClients.delete(client);
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

/** Test seam: current room occupancy per class. */
export function getRoomSizes(): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [classId, room] of classRooms) out[classId] = room.size;
  return out;
}

export function resetLiveSyncForTests(): void {
  classRooms.clear();
  allClients.clear();
  invalidateRubricCache();
}