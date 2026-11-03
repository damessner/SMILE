import { PERIOD_TIMES } from './period-times.js';

export interface RetroactiveOccurrence {
  occurredAt: Date;
  periodEnd: Date;
  period: number;
}

export type RetroactiveResolution =
  | { ok: true; occurrence: RetroactiveOccurrence }
  | { ok: false; error: string };

/**
 * Resolve a date + school period into the original lesson window.
 *
 * The server runs in Europe/Vienna, so local Date construction matches the bell
 * schedule. The entry must be in the past and within the configured lookback;
 * weekends and unknown periods are rejected rather than silently invented.
 */
export function resolveRetroactiveOccurrence(
  date: string,
  period: number,
  now: Date,
  maxDays: number,
): RetroactiveResolution {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'Bitte ein gültiges Datum im Format JJJJ-MM-TT angeben.' };
  }
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) {
    return { ok: false, error: 'Bitte ein gültiges Datum angeben.' };
  }

  const periodInfo = PERIOD_TIMES.find((entry) => entry.period === period);
  if (!periodInfo) {
    return { ok: false, error: 'Bitte eine gültige Schulstunde (1–10) auswählen.' };
  }

  const occurredAt = new Date(
    year,
    month - 1,
    day,
    Math.floor(periodInfo.startMin / 60),
    periodInfo.startMin % 60,
    0,
    0,
  );
  const periodEnd = new Date(
    year,
    month - 1,
    day,
    Math.floor(periodInfo.endMin / 60),
    periodInfo.endMin % 60,
    0,
    0,
  );

  // Reject rolled-over dates such as 2026-02-31.
  if (
    occurredAt.getFullYear() !== year ||
    occurredAt.getMonth() !== month - 1 ||
    occurredAt.getDate() !== day
  ) {
    return { ok: false, error: 'Bitte ein gültiges Datum angeben.' };
  }

  const weekday = occurredAt.getDay();
  if (weekday === 0 || weekday === 6) {
    return { ok: false, error: 'Time-Outs können nur für Schultage nachgetragen werden.' };
  }

  if (periodEnd > now) {
    return { ok: false, error: 'Diese Stunde liegt noch in der Zukunft. Bitte eine vergangene Stunde wählen.' };
  }

  const earliest = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);
  if (occurredAt < earliest) {
    return {
      ok: false,
      error: `Time-Outs können nur für die letzten ${maxDays} Tage nachgetragen werden.`,
    };
  }

  return { ok: true, occurrence: { occurredAt, periodEnd, period } };
}
