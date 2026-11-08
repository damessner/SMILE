import { config } from '../../config.js';
import { webuntis } from './client.js';

export interface DisciplinarySyncPayload {
  pupilId: number;
  classId: number;
  type: 'yellow' | 'red' | 'timeout';
  note?: string | null;
  occurredAt?: Date;
}

/**
 * Dispatches an automatic WebUntis Klassenbucheintrag asynchronously.
 * Never throws, never blocks the caller or HTTP request.
 */
export function queueWebUntisClassregEvent(payload: DisciplinarySyncPayload): void {
  if (!config.webuntis.autoSyncDisciplinary) {
    return;
  }

  // Execute in background
  setImmediate(async () => {
    try {
      let title = '';
      if (payload.type === 'yellow') {
        title = '[Gelbe Karte]';
      } else if (payload.type === 'red') {
        title = '[Rote Karte - Rangverlust]';
      } else if (payload.type === 'timeout') {
        title = '[Time-Out]';
      }

      const cleanNote = payload.note?.trim();
      const text = cleanNote ? `${title} ${cleanNote}` : `${title} Disziplinarischer Vorfall`;

      const result = await webuntis.createKlassenbuchEntry({
        studentId: payload.pupilId,
        classId: payload.classId,
        date: payload.occurredAt || new Date(),
        categoryId: 2, // 2 = "Verhalten"
        text,
      });

      if (result.success) {
        console.log(`[WebUntis] Klassenbucheintrag erstellt für Schüler ${payload.pupilId} (${payload.type})`);
      } else {
        console.warn(`[WebUntis] Klassenbucheintrag konnte nicht übertragen werden für Schüler ${payload.pupilId}`);
      }
    } catch (err) {
      console.error('[WebUntis] Fehler bei automatischer Synchronisierung:', err instanceof Error ? err.message : err);
    }
  });
}
