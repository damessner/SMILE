import { afterEach, describe, expect, it, vi } from 'vitest';

describe('conference decision metadata', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.resetModules();
  });

  it('uses the actual recording instant separately from the planned meeting date', async () => {
    process.env.SMILE_ENV_FILE = 'no-such-env-file-for-conference-date-tests';
    process.env.OFFICIAL_CONFERENCE_DATE = '2099-11-03T21:59:00.000Z';
    vi.resetModules();
    const { createConferenceConfirmationMetadata } = await import('./conferences.js');
    const recordedAt = new Date('2026-10-07T14:00:00.000Z');

    const metadata = createConferenceConfirmationMetadata(recordedAt);

    expect(metadata.confirmedAt).toEqual(recordedAt);
    expect(metadata.overrideReason).toBe('Beschluss der Klassenkonferenz vom 2099-11-03');
  });
});
