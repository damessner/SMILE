import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAccountsModal } from './AdminAccountsModal';
import { ToastProvider } from './Toast';
import { getAdminUsers, resetStartPassword, requestPasswordReset } from '../services/api';

vi.mock('../services/api', () => ({
  getAdminUsers: vi.fn(),
  resetStartPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

const ACCOUNTS = [
  {
    id: 'u1',
    username: 'admin',
    role: 'admin' as const,
    teacherId: 1,
    teacherShort: 'ADM',
    teacherName: 'Administrator',
    mustChangePassword: false,
  },
  {
    id: 'u2',
    username: 'maria',
    role: 'teacher' as const,
    teacherId: 42,
    teacherShort: 'MED',
    teacherName: 'Maria Meier',
    mustChangePassword: true,
  },
];

function renderModal() {
  return render(
    <ToastProvider>
      <AdminAccountsModal onClose={() => {}} />
    </ToastProvider>
  );
}

describe('AdminAccountsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminUsers).mockResolvedValue({ users: ACCOUNTS });
    vi.mocked(resetStartPassword).mockResolvedValue({
      success: true,
      username: 'maria',
      temporaryPassword: 'smile2026',
      mustChangePassword: true,
      notice: 'Dieses Passwort wird genau einmal angezeigt.',
    });
    vi.mocked(requestPasswordReset).mockResolvedValue({ success: true } as any);
  });

  it('lists accounts and marks which ones still owe a password choice', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByText('maria')).toBeInTheDocument());
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText(/gemeinsame Startpasswort ist bekannt und unsicher/i)).toBeInTheDocument();
    // Non-participation is the actionable state, so it must be visible without opening
    // anything.
    expect(screen.getByText('Passwort offen')).toBeInTheDocument();
  });

  it('shows the reset start password once and does not copy it to the clipboard', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByText('maria')).toBeInTheDocument());

    const issueButtons = screen.getAllByRole('button', { name: /startpasswort zurücksetzen/i });
    await user.click(issueButtons[1]);

    await waitFor(() => expect(screen.getByText('smile2026')).toBeInTheDocument());
    expect(resetStartPassword).toHaveBeenCalledWith('maria');

    // A clipboard copy would outlive the dialog and expose the shared reset value.
    expect(writeText).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /notiert/i }));
    await waitFor(() =>
      expect(screen.queryByText('smile2026')).not.toBeInTheDocument()
    );
  });

  it('surfaces a load failure instead of an empty account list', async () => {
    vi.mocked(getAdminUsers).mockRejectedValue(new Error('Zugriff verweigert'));
    renderModal();

    await waitFor(() => expect(screen.getByText('Zugriff verweigert')).toBeInTheDocument());
    // An empty list would read as "no accounts exist", which is a different claim.
    expect(screen.queryByRole('button', { name: /startpasswort zurücksetzen/i })).not.toBeInTheDocument();
  });

  it('keeps the force-reset action available only for accounts that owe a password', async () => {
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByText('maria')).toBeInTheDocument());

    const buttons = screen.getAllByRole('button', { name: /passwortwechsel erzwingen/i });
    const adminRow = buttons[0];
    const mariaRow = buttons[1];

    // 'admin' already chose its own password; forcing a reset there would lock a working
    // account out for nothing.
    expect(adminRow).toBeDisabled();
    expect(mariaRow).toBeEnabled();

    await user.click(mariaRow);
    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('maria'));
  });
});