import { describe, expect, it } from 'vitest';
import { sendDueWeeklyDigests } from './notification-digest.js';

describe('sendDueWeeklyDigests', () => {
  it('does nothing when SMTP is not configured', async () => {
    await expect(sendDueWeeklyDigests(new Date('2026-11-03T12:00:00'))).resolves.toBe(0);
  });
});
