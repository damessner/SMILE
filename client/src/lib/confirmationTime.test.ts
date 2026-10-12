import { describe, expect, it } from 'vitest';
import { formatConfirmationTimestamp } from './confirmationTime';

describe('formatConfirmationTimestamp', () => {
  it('renders a recorded instant as date and time', () => {
    const formatted = formatConfirmationTimestamp('2026-10-07T14:05:00.000Z');
    expect(formatted).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} Uhr$/);
  });

  it('says the instant is unknown instead of claiming today', () => {
    // A null confirmedAt means "never written". Rendering today's date would assert the
    // decision was made now, which is a factual claim the data does not support.
    expect(formatConfirmationTimestamp(null)).toBe('Zeitpunkt nicht gespeichert');
    expect(formatConfirmationTimestamp(undefined)).toBe('Zeitpunkt nicht gespeichert');
    expect(formatConfirmationTimestamp('')).toBe('Zeitpunkt nicht gespeichert');
  });

  it('does not repeat the current date for a missing timestamp', () => {
    const today = new Date().toLocaleDateString('de-AT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    expect(formatConfirmationTimestamp(null)).not.toContain(today);
  });

  it('falls back to a neutral label for an unparsable timestamp', () => {
    expect(formatConfirmationTimestamp('not-a-date')).toBe('Beschluss erfasst');
  });
});