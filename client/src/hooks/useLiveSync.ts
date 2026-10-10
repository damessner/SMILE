import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { User } from '../types';
import { batchUpdateItems, SESSION_EXPIRED_EVENT } from '../services/api';

export interface SoftLock {
  pupilId: number;
  itemKey: string;
  subjectCode: string;
  teacherName: string;
  teacherShort?: string;
}

export interface ConflictEvent {
  pupilId: number;
  itemKey: string;
  subjectCode?: string;
  currentRating: string;
  currentVersion: number;
  updatedBy: string;
  message: string;
}

interface PendingRatingWrite {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const RATING_ACK_TIMEOUT_MS = 15_000;
const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;
let mutationSequence = 0;

function settleRatingWrite(
  pendingWrites: Map<string, PendingRatingWrite>,
  clientMutationId: unknown,
  error?: Error,
): void {
  if (typeof clientMutationId !== 'string') return;
  const pending = pendingWrites.get(clientMutationId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingWrites.delete(clientMutationId);
  if (error) pending.reject(error);
  else pending.resolve();
}

function rejectPendingRatingWrites(pendingWrites: Map<string, PendingRatingWrite>, message: string): void {
  for (const [clientMutationId] of pendingWrites) {
    settleRatingWrite(pendingWrites, clientMutationId, new Error(message));
  }
}

/**
 * Everything the socket knows about one subscribed class: the conference lock
 * and the caller's write permission. Keeping the two together means a verdict
 * can never leak from one class to another — the older scalar `canRate` did.
 */
export interface ClassSyncState {
  isLocked: boolean;
  canRate: boolean | null;
}

export function useLiveSync(
  classId: number | number[] | null,
  user: User | null,
  onRatingUpdated?: (data: any) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRatingWritesRef = useRef(new Map<string, PendingRatingWrite>());
  const [isConnected, setIsConnected] = useState(false);
  const [softLocks, setSoftLocks] = useState<Map<string, SoftLock>>(new Map());
  const [conflict, setConflict] = useState<ConflictEvent | null>(null);
  const [classSyncState, setSyncState] = useState<Map<number, ClassSyncState>>(new Map());
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const classIds = Array.isArray(classId)
    ? classId.filter((id): id is number => typeof id === 'number' && id > 0)
    : typeof classId === 'number' && classId > 0
      ? [classId]
      : [];
  const primaryClassId = classIds[0] ?? null;
  const classIdKey = classIds.join(',');

  const isLockedByConference = primaryClassId != null ? (classSyncState.get(primaryClassId)?.isLocked ?? false) : false;

  // Derived per-subscription: each class keeps its own verdict, and the selected
  // class reads only its own entry. A late SYNCED for a room the teacher reads
  // but may not rate in can no longer turn the observation grid read-only.
  const classRoundLocks = useMemo(
    () => new Map(Array.from(classSyncState, ([cid, state]) => [cid, state.isLocked] as const)),
    [classSyncState],
  );
  const canRate = primaryClassId != null ? (classSyncState.get(primaryClassId)?.canRate ?? null) : null;

  // Merge a patch into one class's entry. Used by the message handlers and by the
  // class loader, which seeds the roster's verdict before the first SYNCED so a
  // locked class never shows a writable grid for one round trip.
  const setClassSyncState = useCallback((classId: number, patch: Partial<ClassSyncState>) => {
    setSyncState((prev) => {
      const next = new Map(prev);
      const current = next.get(classId) ?? { isLocked: false, canRate: null };
      next.set(classId, { ...current, ...patch });
      return next;
    });
  }, []);

  useEffect(() => {
    setConnectionError(null);
    setSoftLocks(new Map());
    setSyncState(new Map());
    if (classIds.length === 0 || !user) return;

    // Do not open a socket while the account still needs a password change: the server
    // rejects those handshakes with close code 1008.
    if (user.mustChangePassword) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let disposed = false;
    let retries = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSocket: WebSocket | null = null;
    let connect: () => void;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      if (retries >= RECONNECT_DELAYS_MS.length) {
        setConnectionError('Live-Verbindung konnte nicht wiederhergestellt werden.');
        return;
      }
      const delay = RECONNECT_DELAYS_MS[retries++];
      setConnectionError('Verbindung unterbrochen. Erneuter Verbindungsversuch…');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const handleDisconnect = (socket: WebSocket, code: number, reason: string) => {
      if (disposed || activeSocket !== socket) return;
      activeSocket = null;
      wsRef.current = null;
      setIsConnected(false);
      // The lock state deliberately survives the disconnect — it fails closed and
      // SYNCED re-syncs on reopen — but the permission is forgotten: after a
      // reconnect the caller is read-only until the server says otherwise.
      setSyncState((prev) => {
        const next = new Map(prev);
        for (const [cid, state] of next) next.set(cid, { ...state, canRate: null });
        return next;
      });
      setSoftLocks(new Map());
      rejectPendingRatingWrites(pendingRatingWritesRef.current, 'Live-Verbindung unterbrochen.');

      if (code === 1008) {
        setConnectionError(reason || 'Live-Verbindung abgelehnt. Bitte melden Sie sich erneut an.');
        if (['session expired', 'unauthenticated', 'password change required'].includes(reason)) {
          window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        }
        return;
      }
      scheduleReconnect();
    };

    connect = () => {
      if (disposed) return;
      try {
        // Cookie auth remains same-origin; user identity is never sent in the
        // subscription message and every reconnect resubscribes to this class.
        const ws = new WebSocket(wsUrl);
        activeSocket = ws;
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          for (const cid of classIds) {
            ws.send(JSON.stringify({ type: 'SUBSCRIBE_CLASS', payload: { classId: cid } }));
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            switch (msg.type) {
              case 'CELL_LOCKED': {
                if (typeof msg.subjectCode !== 'string') break;
                const key = `${msg.subjectCode}|${msg.pupilId}|${msg.itemKey}`;
                setSoftLocks((prev) => {
                  const next = new Map(prev);
                  next.set(key, {
                    pupilId: msg.pupilId,
                    itemKey: msg.itemKey,
                    subjectCode: msg.subjectCode,
                    teacherName: msg.teacherName,
                  });
                  return next;
                });
                break;
              }

              case 'CELL_UNLOCKED': {
                if (typeof msg.subjectCode !== 'string') break;
                const key = `${msg.subjectCode}|${msg.pupilId}|${msg.itemKey}`;
                setSoftLocks((prev) => {
                  const next = new Map(prev);
                  next.delete(key);
                  return next;
                });
                break;
              }

              case 'RATING_UPDATED': {
                onRatingUpdated?.(msg);
                if (typeof msg.subjectCode === 'string') {
                  const key = `${msg.subjectCode}|${msg.pupilId}|${msg.itemKey}`;
                  setSoftLocks((prev) => {
                    const next = new Map(prev);
                    next.delete(key);
                    return next;
                  });
                }
                break;
              }

              case 'RATING_ACK': {
                settleRatingWrite(pendingRatingWritesRef.current, msg.clientMutationId);
                break;
              }

              case 'CONFLICT': {
                settleRatingWrite(
                  pendingRatingWritesRef.current,
                  msg.clientMutationId,
                  new Error(msg.message || 'Die Bewertung wurde zwischenzeitlich geändert.'),
                );
                setConflict({
                  pupilId: msg.pupilId,
                  itemKey: msg.itemKey,
                  subjectCode: msg.subjectCode,
                  currentRating: msg.currentRating,
                  currentVersion: msg.currentVersion,
                  updatedBy: msg.updatedBy,
                  message: msg.message,
                });
                const reconcilesOneCell =
                  typeof msg.currentRating === 'string' && typeof msg.currentVersion === 'number';
                if (msg.evaluationId && reconcilesOneCell && typeof msg.subjectCode === 'string') {
                  onRatingUpdated?.({
                    type: 'RATING_UPDATED',
                    evaluationId: msg.evaluationId,
                    pupilId: msg.pupilId,
                    itemKey: msg.itemKey,
                    rating: msg.currentRating,
                    version: msg.currentVersion,
                    updatedBy: msg.updatedBy,
                    updatedAt: msg.updatedAt,
                    subjectCode: msg.subjectCode,
                  });
                } else if (typeof msg.classId === 'number' && typeof msg.subjectCode === 'string') {
                  // No evaluation row survived the conflict, so there is nothing to patch
                  // cell-by-cell — the local copy of this pupil's evaluation is stale in
                  // unknown ways. Reload the class instead of leaving the wrong values up.
                  onRatingUpdated?.({
                    type: 'BATCH_ITEMS_UPDATED',
                    classId: msg.classId,
                    pupilId: msg.pupilId,
                    subjectCode: msg.subjectCode,
                  });
                }
                break;
              }

              case 'VOTING_LOCK_CHANGED': {
                if (typeof msg.classId === 'number') {
                  // The server broadcasts the *effective* lock state (round OR
                  // class), which is exactly what this entry stores.
                  setClassSyncState(msg.classId, {
                    isLocked: Boolean(msg.isLocked),
                  });
                }
                break;
              }

              // Server confirms the room and the caller's write permission.
              case 'SYNCED': {
                if (typeof msg.classId === 'number') {
                  setClassSyncState(msg.classId, {
                    isLocked: Boolean(msg.isLockedByConference),
                    canRate: typeof msg.canRate === 'boolean' ? msg.canRate : null,
                  });
                }
                setConnectionError(null);
                retries = 0;
                break;
              }

              case 'CARD_ISSUED':
              case 'CARD_REVOKED':
              case 'BATCH_ITEMS_UPDATED':
              case 'BATCH_DEFAULTS_APPLIED':
              case 'PUPIL_RANKING_SUBMITTED':
              case 'PUPIL_RANKING_REOPENED':
              case 'STATUS_UPDATED':
              case 'TIMEOUT_ISSUED':
              case 'TIMEOUT_RESOLVED':
              case 'FINAL_RANK_CONFIRMED':
              case 'FINAL_RANK_REVOKED': {
                onRatingUpdated?.(msg);
                break;
              }

              case 'ERROR': {
                settleRatingWrite(
                  pendingRatingWritesRef.current,
                  msg.clientMutationId,
                  new Error(msg.message || 'Die Bewertung konnte nicht gespeichert werden.'),
                );
                if (typeof msg.clientMutationId !== 'string') {
                  setConnectionError(msg.message || 'Live-Sync-Anfrage konnte nicht verarbeitet werden.');
                  if (msg.code === 'PASSWORD_CHANGE_REQUIRED') {
                    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
                    ws.close(1008, 'password change required');
                  }
                }
                console.warn('Live sync error:', msg.message);
                break;
              }

              default:
                console.warn('Unknown live sync message type:', (msg as any)?.type);
                break;
            }
          } catch (e) {
            console.error('Failed to parse WebSocket message', e);
          }
        };

        ws.onclose = (ev) => handleDisconnect(ws, ev.code, ev.reason || '');
        ws.onerror = () => {
          setConnectionError('Fehler in der Live-Verbindung.');
          try {
            ws.close();
          } catch {
            handleDisconnect(ws, 1006, 'network error');
          }
        };
      } catch {
        setIsConnected(false);
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const socket = activeSocket;
      activeSocket = null;
      wsRef.current = null;
      if (socket) socket.close(1000, 'unmount');
      rejectPendingRatingWrites(pendingRatingWritesRef.current, 'Live-Verbindung beendet.');
    };
  }, [classIdKey, user?.id, user?.mustChangePassword, onRatingUpdated]);

  const sendFocus = useCallback(
    (pupilId: number, itemKey: string, subjectCode: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && primaryClassId) {
        wsRef.current.send(
          JSON.stringify({ type: 'CELL_FOCUS', payload: { classId: primaryClassId, pupilId, itemKey, subjectCode } })
        );
      }
    },
    [primaryClassId]
  );

  const sendBlur = useCallback(
    (pupilId: number, itemKey: string, subjectCode: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && primaryClassId) {
        wsRef.current.send(
          JSON.stringify({ type: 'CELL_BLUR', payload: { classId: primaryClassId, pupilId, itemKey, subjectCode } })
        );
      }
    },
    [primaryClassId]
  );

  const sendRating = useCallback(
    (
      pupilId: number,
      criterionId: string,
      itemKey: string,
      rating: string,
      expectedVersion: number,
      subjectCode: string = 'D'
    ): Promise<void> => {
      if (!primaryClassId) return Promise.reject(new Error('Keine Klasse für die Bewertung ausgewählt.'));

      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        const clientMutationId = `${Date.now().toString(36)}-${(++mutationSequence).toString(36)}`;
        return new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            settleRatingWrite(
              pendingRatingWritesRef.current,
              clientMutationId,
              new Error('Der Server hat die Bewertung nicht bestätigt.'),
            );
          }, RATING_ACK_TIMEOUT_MS);
          pendingRatingWritesRef.current.set(clientMutationId, { resolve, reject, timeout });

          try {
            ws.send(
              JSON.stringify({
                type: 'UPDATE_RATING',
                payload: {
                  classId: primaryClassId,
                  pupilId,
                  criterionId,
                  itemKey,
                  rating,
                  expectedVersion,
                  subjectCode,
                  clientMutationId,
                },
              }),
            );
          } catch (error) {
            settleRatingWrite(
              pendingRatingWritesRef.current,
              clientMutationId,
              error instanceof Error ? error : new Error('Bewertung konnte nicht gesendet werden.'),
            );
          }
        });
      }

      return batchUpdateItems(pupilId, primaryClassId, subjectCode, [
        { criterionId, itemKey, rating, version: expectedVersion },
      ]).then((result: any) => {
        const updatedItem = Array.isArray(result?.items)
          ? result.items.find((item: any) => item?.itemKey === itemKey)
          : undefined;
        if (updatedItem) {
          onRatingUpdated?.({
            type: 'RATING_UPDATED',
            evaluationId: updatedItem.evaluationId,
            pupilId,
            classId,
            itemId: updatedItem.id,
            itemKey: updatedItem.itemKey,
            rating: updatedItem.rating,
            version: updatedItem.version,
            updatedAt: updatedItem.updatedAt,
            subjectCode,
          });
        } else {
          // Keep the disconnected client consistent even if a compatible server
          // responds without the newer item representation.
          onRatingUpdated?.({ type: 'BATCH_ITEMS_UPDATED', classId, pupilId, subjectCode });
        }
      }).catch((error: unknown) => {
        const conflict = error as {
          code?: unknown;
          details?: {
            evaluationId?: unknown;
            classId?: unknown;
            pupilId?: unknown;
            itemKey?: unknown;
            subjectCode?: unknown;
            currentRating?: unknown;
            currentVersion?: unknown;
            updatedAt?: unknown;
            updatedBy?: unknown;
          };
        };
        const details = conflict?.details;
        if (conflict?.code === 'CONFLICT' && typeof details?.subjectCode === 'string') {
          const reconcilesOneCell =
            typeof details.currentRating === 'string' &&
            typeof details.currentVersion === 'number';
          if (typeof details.evaluationId === 'string' && reconcilesOneCell) {
            onRatingUpdated?.({
              type: 'RATING_UPDATED',
              evaluationId: details.evaluationId,
              pupilId: details.pupilId,
              itemKey: details.itemKey,
              rating: details.currentRating,
              version: details.currentVersion,
              updatedAt: details.updatedAt,
              updatedBy: details.updatedBy,
              subjectCode: details.subjectCode,
            });
          } else if (typeof details.classId === 'number' && typeof details.pupilId === 'number') {
            // Either the item row vanished or the server reported no current version.
            // Guessing a cell value here would overwrite a colleague's work in the UI
            // only, so the class is reloaded from the server instead.
            onRatingUpdated?.({
              type: 'BATCH_ITEMS_UPDATED',
              classId: details.classId,
              pupilId: details.pupilId,
              subjectCode: details.subjectCode,
            });
          }
        }
        throw error;
      });
    },
    [primaryClassId, onRatingUpdated]
  );

  return {
    isConnected,
    softLocks,
    conflict,
    clearConflict: () => setConflict(null),
    classSyncState,
    classRoundLocks,
    isLockedByConference,
    canRate,
    setClassSyncState,
    connectionError,
    sendFocus,
    sendBlur,
    sendRating,
  };
}
