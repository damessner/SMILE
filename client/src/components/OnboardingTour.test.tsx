import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OnboardingTour } from './OnboardingTour';
import type { User } from '../types';

const user: User = {
  id: 'user-1',
  username: 'Lehrer',
  role: 'teacher',
  teacherId: 101,
  mustChangePassword: false,
};

function renderTour(onClose: () => void) {
  return render(
    <OnboardingTour
      isOpen
      onClose={onClose}
      currentUser={user}
      activeTab="schulalltag"
      setActiveTab={vi.fn()}
    />,
  );
}

describe('OnboardingTour dismissal', () => {
  it('closes and records the seen flags', () => {
    const onClose = vi.fn();
    renderTour(onClose);

    fireEvent.click(screen.getByTitle('Tour schließen'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('smile_onboarding_seen')).toBe('true');
    expect(localStorage.getItem('smile_tour_seen_lehrer')).toBe('true');
  });

  it('still closes when Web Storage refuses the write', () => {
    // Safari private mode and browsers with site data disabled throw from setItem
    // instead of reporting a missing storage object. The exception must not escape
    // the close handler when the teacher dismisses the tour.
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    const onClose = vi.fn();
    renderTour(onClose);

    expect(() => fireEvent.click(screen.getByTitle('Tour schließen'))).not.toThrow();

    expect(onClose).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });

  it('closes from the Escape key as well', () => {
    const onClose = vi.fn();
    renderTour(onClose);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
