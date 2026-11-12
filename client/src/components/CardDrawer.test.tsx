import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CardDrawer } from './CardDrawer';
import { ToastProvider } from './Toast';

function renderDrawer() {
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <CardDrawer
        pupilId={1}
        classId={2}
        pupilName="Anna Muster"
        onCardUpdated={vi.fn()}
        onClose={onClose}
      />
    </ToastProvider>,
  );
  return { onClose };
}

describe('CardDrawer dialog shell', () => {
  it('is a modal dialog, owns focus and closes on Escape', async () => {
    const { onClose } = renderDrawer();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'card-drawer-title');

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
