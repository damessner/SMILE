import { config } from '../../config.js';
import { enqueueWebUntisOutbox, type ClassregEventKind } from './outbox.js';

export interface DisciplinarySyncPayload {
  pupilId: number;
  classId: number;
  type: ClassregEventKind;
  note?: string | null;
  occurredAt?: Date;
  teacherUserId?: string;
  /**
   * Natural identity of the SMILE record (card id / timeout id). Used as the
   * outbox idempotency key so a retried request cannot enqueue twice.
   */
  sourceId?: string;
}

const TITLES: Record<ClassregEventKind, string> = {
  yellow: '[Gelbe Karte]',
  red: '[Rote Karte - Rangverlust]',
  timeout: '[Time-Out]',
};

const DEFAULT_TEXT: Record<ClassregEventKind, string> = {
  yellow: '[Gelbe Karte] Disziplinarischer Vorfall',
  red: '[Rote Karte - Rangverlust] Disziplinarischer Vorfall',
  timeout: '[Time-Out] Arbeitsauftrag',
};

export function classregText(kind: ClassregEventKind, note?: string | null): string {
  const cleanNote = note?.trim();
  return cleanNote ? `${TITLES[kind]} ${cleanNote}` : DEFAULT_TEXT[kind];
}

function localDateParts(when: Date): { date: string; time: string } {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, '0');
  const d = String(when.getDate()).padStart(2, '0');
  const hh = String(when.getHours()).padStart(2, '0');
  const mm = String(when.getMinutes()).padStart(2, '0');
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
}

function reportEnqueueFailure(err: unknown): void {
  console.error(
    '[WebUntis] Klassenbucheintrag konnte nicht in die Warteschlange gestellt werden:',
    err instanceof Error ? err.message : err,
  );
}

/**
 * Queue a Klassenbucheintrag mirror without blocking the caller.
 *
 * The write is persisted in `webuntis_sync_outbox` and retried by the background
 * worker. The previous `setImmediate` dispatch lost the entry on the first
 * network error and on every restart.
 */
export function queueWebUntisClassregEvent(payload: DisciplinarySyncPayload): void {
  if (!config.webuntis.autoSyncDisciplinary) return;
  if (!payload.teacherUserId) return;

  const when = payload.occurredAt ?? new Date();
  const { date, time } = localDateParts(when);

  void enqueueWebUntisOutbox({
    userId: payload.teacherUserId ?? null,
    kind: 'classreg_upsert',
    idempotencyKey: payload.sourceId ? `classreg:upsert:${payload.sourceId}` : null,
    payload: {
      pupilId: payload.pupilId,
      classId: payload.classId,
      eventKind: payload.type,
      text: classregText(payload.type, payload.note),
      categoryId: 2, // 2 = "Verhalten"
      date,
      time,
      note: payload.note ?? null,
      sourceId: payload.sourceId,
    },
  }).catch(reportEnqueueFailure);
}

/**
 * Queue a correction after a card was revoked.
 *
 * WebUntis exposes no verified delete endpoint for class-register entries, so a
 * compensating entry is the honest option: it names the original entry as
 * withdrawn instead of leaving a false accusation in the official record.
 */
export function queueWebUntisClassregCorrection(payload: DisciplinarySyncPayload): void {
  if (!config.webuntis.autoSyncDisciplinary) return;
  if (!payload.teacherUserId) return;

  const when = payload.occurredAt ?? new Date();
  const { date, time } = localDateParts(when);
  const original = classregText(payload.type, payload.note);

  void enqueueWebUntisOutbox({
    userId: payload.teacherUserId ?? null,
    kind: 'classreg_correction',
    idempotencyKey: payload.sourceId ? `classreg:correction:${payload.sourceId}` : null,
    payload: {
      pupilId: payload.pupilId,
      classId: payload.classId,
      eventKind: payload.type,
      text: `[Korrektur] Der folgende Eintrag wurde in SMILE zurückgezogen: ${original}`,
      categoryId: 2,
      date,
      time,
      note: payload.note ?? null,
      sourceId: payload.sourceId,
    },
  }).catch(reportEnqueueFailure);
}
