import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WebUntisConnectModal } from './WebUntisConnectModal';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  connectWebUntisAccount: vi.fn(),
  disconnectWebUntisAccount: vi.fn(),
}));

describe('WebUntisConnectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <WebUntisConnectModal
        isOpen={false}
        onClose={vi.fn()}
        accountStatus={null}
        onSuccess={vi.fn()}
        onDisconnected={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with default MS-Telfs preset and inputs when isOpen is true', () => {
    render(
      <WebUntisConnectModal
        isOpen={true}
        onClose={vi.fn()}
        accountStatus={null}
        onSuccess={vi.fn()}
        onDisconnected={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Eigenes WebUntis-Konto verknüpfen')).toBeInTheDocument();
    expect(screen.getByText('MS-Telfs (Live)')).toBeInTheDocument();
    expect(screen.getByText('Spielwiese (Test)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('z. B. dames oder Lehrkraft-Kürzel')).toBeInTheDocument();
  });

  it('allows switching to playground preset', () => {
    render(
      <WebUntisConnectModal
        isOpen={true}
        onClose={vi.fn()}
        accountStatus={null}
        onSuccess={vi.fn()}
        onDisconnected={vi.fn()}
      />,
    );

    const playgroundBtn = screen.getByText('Spielwiese (Test)');
    fireEvent.click(playgroundBtn);

    const schoolInput = screen.getByDisplayValue('PG6ef0f7d3-abdf-49b5-ab74-044ef932d877');
    expect(schoolInput).toBeInTheDocument();
  });

  it('submits credentials and calls onSuccess on success', async () => {
    vi.mocked(api.connectWebUntisAccount).mockResolvedValue({
      success: true,
      teacherShort: 'OFJ',
      teacherName: 'Ofner Johannes',
    });

    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <WebUntisConnectModal
        isOpen={true}
        onClose={onClose}
        accountStatus={null}
        onSuccess={onSuccess}
        onDisconnected={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('z. B. dames oder Lehrkraft-Kürzel'), {
      target: { value: 'OFJ' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
      target: { value: 'Secret123!' },
    });

    const submitBtn = screen.getByText('Verbindung testen & verknüpfen');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.connectWebUntisAccount).toHaveBeenCalledWith({
        server: 'ms-telfs.webuntis.com',
        school: 'ms-telfs',
        username: 'OFJ',
        secret: 'Secret123!',
        authMethod: 'password',
      });
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          teacherShort: 'OFJ',
        }),
      );
    });
  });

  it('shows error message if API fails', async () => {
    vi.mocked(api.connectWebUntisAccount).mockRejectedValue(
      new Error('Ungültiger Benutzername oder Passwort'),
    );

    render(
      <WebUntisConnectModal
        isOpen={true}
        onClose={vi.fn()}
        accountStatus={null}
        onSuccess={vi.fn()}
        onDisconnected={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('z. B. dames oder Lehrkraft-Kürzel'), {
      target: { value: 'WRONG' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
      target: { value: 'badpass' },
    });

    fireEvent.click(screen.getByText('Verbindung testen & verknüpfen'));

    expect(await screen.findByText('Ungültiger Benutzername oder Passwort')).toBeInTheDocument();
  });

  it('shows disconnect button and active status when already connected', async () => {
    const onDisconnected = vi.fn();
    vi.mocked(api.disconnectWebUntisAccount).mockResolvedValue({ success: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <WebUntisConnectModal
        isOpen={true}
        onClose={vi.fn()}
        accountStatus={{
          connected: true,
          account: {
            username: 'OFJ',
            teacherShort: 'OFJ',
            school: 'ms-telfs',
            server: 'ms-telfs.webuntis.com',
            authMethod: 'password',
            lastVerifiedAt: new Date().toISOString(),
          },
        }}
        onSuccess={vi.fn()}
        onDisconnected={onDisconnected}
      />,
    );

    expect(screen.getByText(/Aktuell verbunden als Lehrkraft: OFJ/)).toBeInTheDocument();
    const disconnectBtn = screen.getByText('Konto trennen');
    fireEvent.click(disconnectBtn);

    await waitFor(() => {
      expect(api.disconnectWebUntisAccount).toHaveBeenCalled();
      expect(onDisconnected).toHaveBeenCalled();
    });
  });
});
