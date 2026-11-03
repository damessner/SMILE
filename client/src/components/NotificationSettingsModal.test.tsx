import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotificationSettingsModal } from './NotificationSettingsModal';
import { ToastProvider } from './Toast';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  getNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
}));

const baseClass = {
  green: false,
  yellow: false,
  red: false,
  timeout: false,
  cooldown: false,
  weeklyDigest: false,
};

describe('NotificationSettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getNotificationPreferences).mockResolvedValue({
      email: '',
      classes: [
        { ...baseClass, classId: 1, className: '1A' },
        { ...baseClass, classId: 2, className: '1B' },
      ],
    });
    vi.mocked(api.saveNotificationPreferences).mockResolvedValue({ success: true });
  });

  it('saves the selected event and class for the entered address', async () => {
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <NotificationSettingsModal onClose={onClose} />
      </ToastProvider>,
    );

    await screen.findByText('1A');
    await userEvent.type(
      screen.getByPlaceholderText('lehrkraft@schule.at'),
      'lehrer@example.at',
    );
    await userEvent.click(screen.getByLabelText('1A: Time-Outs'));
    await userEvent.click(screen.getByRole('button', { name: /Speichern/i }));

    await waitFor(() => {
      expect(api.saveNotificationPreferences).toHaveBeenCalledWith({
        email: 'lehrer@example.at',
        subscriptions: [
          {
            classId: 1,
            green: false,
            yellow: false,
            red: false,
            timeout: true,
            cooldown: false,
            weeklyDigest: false,
          },
        ],
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses to save a subscription without a valid address', async () => {
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <NotificationSettingsModal onClose={onClose} />
      </ToastProvider>,
    );

    await screen.findByText('1A');
    await userEvent.click(screen.getByLabelText('1A: Grüne Karten'));
    await userEvent.click(screen.getByRole('button', { name: /Speichern/i }));

    await waitFor(() => {
      expect(api.saveNotificationPreferences).not.toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('can select a whole column at once', async () => {
    render(
      <ToastProvider>
        <NotificationSettingsModal onClose={vi.fn()} />
      </ToastProvider>,
    );

    await screen.findByText('1A');
    await userEvent.click(
      screen.getByTitle('Time-Outs: alle Klassen ein-/ausschalten'),
    );

    expect(screen.getByLabelText('1A: Time-Outs')).toBeChecked();
    expect(screen.getByLabelText('1B: Time-Outs')).toBeChecked();
  });
});
