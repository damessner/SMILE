import { describe, expect, it } from 'vitest';
import { resolveRetroactiveOccurrence } from './retroactive-timeout.js';

const now = new Date(2026, 10, 3, 12, 0, 0); // Tuesday, 03.11.2026, 12:00 local

describe('resolveRetroactiveOccurrence', () => {
  it('accepts a past lesson inside the lookback window', () => {
    const result = resolveRetroactiveOccurrence('2026-11-03', 3, now, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.occurrence.period).toBe(3);
    expect(result.occurrence.occurredAt.getHours()).toBe(9);
    expect(result.occurrence.occurredAt.getMinutes()).toBe(45);
    expect(result.occurrence.periodEnd.getHours()).toBe(10);
    expect(result.occurrence.periodEnd.getMinutes()).toBe(35);
  });

  it('rejects a lesson that is still in the future', () => {
    const result = resolveRetroactiveOccurrence('2026-11-03', 6, now, 7);
    expect(result).toEqual({
      ok: false,
      error: 'Diese Stunde liegt noch in der Zukunft. Bitte eine vergangene Stunde wählen.',
    });
  });

  it('rejects weekends', () => {
    const result = resolveRetroactiveOccurrence('2026-11-07', 3, now, 7);
    expect(result.ok).toBe(false);
  });

  it('rejects entries older than the lookback window', () => {
    const result = resolveRetroactiveOccurrence('2026-10-01', 3, now, 7);
    expect(result).toEqual({
      ok: false,
      error: 'Time-Outs können nur für die letzten 7 Tage nachgetragen werden.',
    });
  });

  it('rejects a rolled-over date', () => {
    const result = resolveRetroactiveOccurrence('2026-02-31', 3, now, 7);
    expect(result.ok).toBe(false);
  });
});
