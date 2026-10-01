import { useEffect, useRef, useState, useCallback } from 'react';
import { User } from '../types';

export interface SoftLock {
  pupilId: number;
  itemKey: string;
  teacherName: string;
  teacherShort?: string;
}

export interface ConflictEvent {
  pupilId: number;
  itemKey: string;
  currentRating: string;
  currentVersion: number;
  updatedBy: string;
  message: string;
}

export function useLiveSync(
  classId: number | null,
  user: User | null,
  onRatingUpdated?: (data: any) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [softLocks, setSoftLocks] = useState<Map<string, SoftLock>>(new Map());
  const [conflict, setConflict] = useState<ConflictEvent | null>(null);
  const [isLockedByConference, setIsLockedByConference] = useState(false);

  useEffect(() => {
    if (!classId || !user) return;

    // Do not open a socket while the account still needs a password change: the server
    // rejects those handshakes with close code 1008.
    if (user.mustChangePassword) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    // Authentication happens via the httpOnly session cookie, which the browser
    // attaches to same-origin WebSocket handshakes automatically. The identity is
    // derived server-side; the payload below carries only the room to join.
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ type: 'SUBSCRIBE_CLASS', payload: { classId } }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'CELL_LOCKED': {
            const key = `${msg.pupilId}_${msg.itemKey}`;
            setSoftLocks((prev) => {
              const next = new Map(prev);
              next.set(key, {
                pupilId: msg.pupilId,
                itemKey: msg.itemKey,
                teacherName: msg.teacherName,
              });
              return next;
            });
            break;
          }

          case 'CELL_UNLOCKED': {
            const key = `${msg.pupilId}_${msg.itemKey}`;
            setSoftLocks((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
            break;
          }

          case 'RATING_UPDATED': {
            onRatingUpdated?.(msg);
            const key = `${msg.pupilId}_${msg.itemKey}`;
            setSoftLocks((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
            break;
          }

          case 'CONFLICT': {
            setConflict({
              pupilId: msg.pupilId,
              itemKey: msg.itemKey,
              currentRating: msg.currentRating,
              currentVersion: msg.currentVersion,
              updatedBy: msg.updatedBy,
              message: msg.message,
            });
            break;
          }

          case 'VOTING_LOCK_CHANGED': {
            setIsLockedByConference(!!msg.isLocked);
            break;
          }

          // Server confirms the room and the caller's write permission.
          case 'SYNCED': {
            setIsLockedByConference(!!msg.isLockedByConference);
            break;
          }

          case 'ERROR': {
            console.warn('Live sync error:', msg.message);
            break;
          }

          default:
            break;
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message', e);
      }
    };

    ws.onclose = (ev) => {
      setIsConnected(false);
      if (ev.code === 1008) {
        console.error('Live sync rejected:', ev.reason);
      }
    };

    ws.onerror = () => setIsConnected(false);

    return () => {
      ws.close(1000, 'unmount');
    };
  }, [classId, user?.id, user?.mustChangePassword]);

  const sendFocus = useCallback(
    (pupilId: number, itemKey: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && classId) {
        wsRef.current.send(
          JSON.stringify({ type: 'CELL_FOCUS', payload: { classId, pupilId, itemKey } })
        );
      }
    },
    [classId]
  );

  const sendBlur = useCallback(
    (pupilId: number, itemKey: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && classId) {
        wsRef.current.send(
          JSON.stringify({ type: 'CELL_BLUR', payload: { classId, pupilId, itemKey } })
        );
      }
    },
    [classId]
  );

  const sendRating = useCallback(
    (
      pupilId: number,
      criterionId: string,
      itemKey: string,
      rating: string,
      expectedVersion: number,
      subjectCode: string = 'SD'
    ) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && classId) {
        wsRef.current.send(
          JSON.stringify({
            type: 'UPDATE_RATING',
            payload: {
              classId,
              pupilId,
              criterionId,
              itemKey,
              rating,
              expectedVersion,
              subjectCode,
            },
          })
        );
      }
    },
    [classId]
  );

  return {
    isConnected,
    softLocks,
    conflict,
    clearConflict: () => setConflict(null),
    isLockedByConference,
    sendFocus,
    sendBlur,
    sendRating,
  };
}