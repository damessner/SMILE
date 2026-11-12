import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReleaseHistoryModal, WhatsNewDialog } from './ReleaseNotes';
import {
  LATEST_RELEASE,
  RELEASES,
  hasSeenLatestRelease,
  markLatestReleaseSeen,
  whatsNewStorageKey,
} from '../lib/releases';
import type { User } from '../types';

const teacherUser: User = {
  id: 'user-1',
  username: 'Teacher',
  role: 'teacher',
  teacher: null,
};

describe('release data', () => {
  it('lists the newest release first with unique versions in date order', () => {
    expect(RELEASES.length).toBeGreaterThanOrEqual(2);
    expect(RELEASES[0]).toBe(LATEST_RELEASE);
    expect(new Set(RELEASES.map((release) => release.version)).size).toBe(RELEASES.length);

    const dates = RELEASES.map((release) => Date.parse(`${release.date}T12:00:00`));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    expect(LATEST_RELEASE.notes.length).toBeGreaterThan(0);
  });
});

describe('whats-new seen flag', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('stays unseen until the current release is marked as seen', () => {
    expect(hasSeenLatestRelease('Teacher')).toBe(false);

    markLatestReleaseSeen('Teacher');

    expect(hasSeenLatestRelease('Teacher')).toBe(true);
    // Usernames are case-insensitive, like everywhere else in the app.
    expect(hasSeenLatestRelease('teacher')).toBe(true);
  });

  it('remembers users and releases separately', () => {
    markLatestReleaseSeen('teacher');

    expect(hasSeenLatestRelease('other-teacher')).toBe(false);
    expect(whatsNewStorageKey('teacher', '9.9.9')).not.toBe(
      whatsNewStorageKey('teacher', LATEST_RELEASE.version),
    );

    window.localStorage.setItem(whatsNewStorageKey('teacher', '9.9.9'), 'true');
    expect(hasSeenLatestRelease('teacher')).toBe(true);
  });

  it('treats unknown users as seen and survives blocked storage', () => {
    expect(hasSeenLatestRelease(null)).toBe(true);
    expect(hasSeenLatestRelease('')).toBe(true);
    expect(hasSeenLatestRelease('   ')).toBe(true);

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    expect(() => markLatestReleaseSeen('teacher')).not.toThrow();
    spy.mockRestore();
  });
});

describe('WhatsNewDialog', () => {
  it('shows the newest release and offers history and dismissal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onOpenHistory = vi.fn();

    render(
      <WhatsNewDialog
        currentUser={teacherUser}
        onClose={onClose}
        onOpenHistory={onOpenHistory}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Was ist neu in SMILE/ })).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Version ${LATEST_RELEASE.version}`)),
    ).toBeInTheDocument();
    expect(screen.getByText(LATEST_RELEASE.notes[0]!.title)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Alle Änderungen ansehen/ }));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Verstanden' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ReleaseHistoryModal', () => {
  it('lists every release and starts the onboarding tour on request', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onStartTour = vi.fn();

    render(<ReleaseHistoryModal onClose={onClose} onStartTour={onStartTour} />);

    expect(
      screen.getByRole('heading', { name: /Hilfe & Versionsverlauf/ }),
    ).toBeInTheDocument();
    for (const release of RELEASES) {
      expect(screen.getByText(`v${release.version}`)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: release.title })).toBeInTheDocument();
    }
    expect(screen.getAllByText('Aktuell')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Einführung & Tour starten/ }));
    expect(onStartTour).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
