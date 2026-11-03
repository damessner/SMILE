import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRestoreModal } from './AdminRestoreModal';
import { ToastProvider } from './Toast';
import { listBackups, restoreBackup, type BackupFileItem } from '../services/api';

vi.mock('../services/api', () => ({
  listBackups: vi.fn(),
  restoreBackup: vi.fn(),
}));

const MOCK_BACKUPS: BackupFileItem[] = [
  {
    id: 'smile_db_2026-10-10_1640.dump',
    filename: 'smile_db_2026-10-10_1640.dump',
    timestamp: '2026-10-10T14:40:00.000Z',
    sizeBytes: 2500000,
    sizeFormatted: '2.4 MB',
    isSafetySnapshot: false,
  },
  {
    id: 'pre-restore-safety-2026-10-10_1600.dump',
    filename: 'pre-restore-safety-2026-10-10_1600.dump',
    timestamp: '2026-10-10T14:00:00.000Z',
    sizeBytes: 2450000,
    sizeFormatted: '2.3 MB',
    isSafetySnapshot: true,
  },
];

function renderModal(onClose = vi.fn()) {
  return render(
    <ToastProvider>
      <AdminRestoreModal onClose={onClose} />
    </ToastProvider>
  );
}

describe('AdminRestoreModal (Task 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listBackups).mockResolvedValue({ backups: MOCK_BACKUPS });
    vi.mocked(restoreBackup).mockResolvedValue({
      success: true,
      message: 'Backup smile_db_2026-10-10_1640.dump wurde erfolgreich eingespielt.',
      preRestoreBackup: 'pre-restore-safety-2026-10-10_1645.dump',
    });
  });

  it('renders available backups and tags safety snapshots', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getAllByText('smile_db_2026-10-10_1640.dump').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('pre-restore-safety-2026-10-10_1600.dump')).toBeInTheDocument();
    expect(screen.getByText('Sicherheitskopie')).toBeInTheDocument();
    expect(screen.getByText('2.4 MB')).toBeInTheDocument();
  });

  it('shows hero action for latest backup', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Neuestes Backup wiederherstellen')).toBeInTheDocument();
    });
  });

  it('requires typing WIEDERHERSTELLEN before enabling the restore action', async () => {
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Neuestes Backup wiederherstellen')).toBeInTheDocument();
    });

    // Click quick hero button
    await user.click(screen.getByText('Neuestes Backup wiederherstellen'));

    // Confirmation step is visible
    expect(screen.getByText('Sicherheitsüberprüfung: Datenbank wiederherstellen')).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: /Jetzt wiederherstellen/i });
    expect(submitBtn).toBeDisabled();

    // Type partial or wrong text
    const input = screen.getByPlaceholderText('WIEDERHERSTELLEN');
    await user.type(input, 'ja');
    expect(submitBtn).toBeDisabled();

    // Type exact confirmation keyword
    await user.clear(input);
    await user.type(input, 'WIEDERHERSTELLEN');
    expect(submitBtn).toBeEnabled();

    // Execute restore
    await user.click(submitBtn);

    await waitFor(() => {
      expect(restoreBackup).toHaveBeenCalledWith('smile_db_2026-10-10_1640.dump');
    });

    // Success screen
    expect(await screen.findByText('Wiederherstellung erfolgreich abgeschlossen!')).toBeInTheDocument();
    expect(screen.getByText('pre-restore-safety-2026-10-10_1645.dump')).toBeInTheDocument();
  });

  it('can cancel confirmation and return to backup list', async () => {
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Neuestes Backup wiederherstellen')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Neuestes Backup wiederherstellen'));
    expect(screen.getByText('Sicherheitsüberprüfung: Datenbank wiederherstellen')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'Abbrechen' });
    await user.click(cancelBtn);

    expect(screen.queryByText('Sicherheitsüberprüfung: Datenbank wiederherstellen')).not.toBeInTheDocument();
    expect(screen.getByText('Vorhandene Backups (2)')).toBeInTheDocument();
  });
});
