import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SchoolStatistics } from './SchoolStatistics';
import * as api from '../services/api';
import type { User } from '../types';

vi.mock('../services/api', () => ({
  getStatistics: vi.fn(),
  getPupilBehaviorProfile: vi.fn(),
  savePupilBehaviorAction: vi.fn(),
  deletePupilBehaviorAction: vi.fn(),
}));

describe('SchoolStatistics component (minimalistic factual dashboard)', () => {
  const mockUser: User = {
    id: 'u1',
    username: 'teacher1',
    role: 'teacher',
  };

  const mockData = {
    classes: [{ id: 10, name: '3a', grade: 3 }],
    cardsSummary: {
      totals: {
        green: 5,
        yellow: 2,
        red: 1,
        timeout: 1,
        cooldown: 1,
        total: 10,
      },
      incidentsByDayOfWeek: [
        { day: 1, dayName: 'Mo', count: 1 },
        { day: 2, dayName: 'Di', count: 0 },
        { day: 3, dayName: 'Mi', count: 2 },
        { day: 4, dayName: 'Do', count: 1 },
        { day: 5, dayName: 'Fr', count: 0 },
      ],
      incidentsByPeriod: [
        { period: 1, label: '1. Stunde', time: '07:45 - 08:35', count: 0 },
        { period: 2, label: '2. Stunde', time: '08:40 - 09:30', count: 1 },
        { period: 3, label: '3. Stunde', time: '09:45 - 10:35', count: 2 },
        { period: 4, label: '4. Stunde', time: '10:40 - 11:30', count: 1 },
        { period: 5, label: '5. Stunde', time: '11:35 - 12:25', count: 0 },
        { period: 6, label: '6. Stunde', time: '12:30 - 13:20', count: 0 },
      ],
    },
    classBreakdown: [
      {
        classId: 10,
        className: '3a',
        grade: 3,
        pupilCount: 2,
        green: 5,
        yellow: 2,
        red: 1,
        timeout: 1,
        cooldown: 1,
        totalCards: 10,
        totalIncidents: 4,
      },
    ],
    pupilCardStats: [
      {
        id: 1,
        fullName: 'Anna Muster',
        classId: 10,
        className: '3a',
        grade: 3,
        green: 5,
        yellow: 0,
        red: 0,
        timeout: 0,
        cooldown: 0,
        total: 5,
      },
      {
        id: 2,
        fullName: 'Ben Problem',
        classId: 10,
        className: '3a',
        grade: 3,
        green: 0,
        yellow: 2,
        red: 1,
        timeout: 1,
        cooldown: 1,
        total: 5,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getStatistics as any).mockResolvedValue(mockData);
  });

  it('renders top KPI cards with pure factual counts', async () => {
    render(<SchoolStatistics initialClassId={10} currentUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('Schulstatistik')).toBeInTheDocument();
    });

    // Totals
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1); // green
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1); // yellow
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1); // red
    expect(screen.getAllByText('10').length).toBeGreaterThanOrEqual(1); // total
  });

  it('renders global and class colorful distribution bars with tooltip information', async () => {
    const { container } = render(<SchoolStatistics initialClassId={10} currentUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText(/Gesamte Farb- & Vorfallsverteilung/i)).toBeInTheDocument();
    });

    // Check that colored segment divs exist in DOM
    expect(container.querySelector('.bg-emerald-500')).toBeInTheDocument();
    expect(container.querySelector('.bg-amber-400')).toBeInTheDocument();
    expect(container.querySelector('.bg-rose-500')).toBeInTheDocument();
    expect(container.querySelector('.bg-orange-500')).toBeInTheDocument();
    expect(container.querySelector('.bg-sky-400')).toBeInTheDocument();

    // Check class overview table
    expect(screen.getByText(/Klassenübersicht \(Karten & Vorfälle\)/i)).toBeInTheDocument();
    expect(screen.getAllByText('3a').length).toBeGreaterThanOrEqual(1);
  });

  it('renders temporal incident distribution (weekday and period)', async () => {
    render(<SchoolStatistics initialClassId={10} currentUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText(/Vorfälle nach Wochentag/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Vorfälle nach Unterrichtsstunde/i)).toBeInTheDocument();
    expect(screen.getByText('Mo')).toBeInTheDocument();
    expect(screen.getByText('Fr')).toBeInTheDocument();
    expect(screen.getByText('1. Std')).toBeInTheDocument();
  });

  it('renders searchable pupil table and filters by name and card type', async () => {
    render(<SchoolStatistics initialClassId={10} currentUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('Anna Muster')).toBeInTheDocument();
      expect(screen.getByText('Ben Problem')).toBeInTheDocument();
    });

    // Search for Anna
    const searchInput = screen.getByPlaceholderText(/Schüler nach Name suchen.../i);
    fireEvent.change(searchInput, { target: { value: 'Anna' } });

    expect(screen.getByText('Anna Muster')).toBeInTheDocument();
    expect(screen.queryByText('Ben Problem')).toBeNull();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('Ben Problem')).toBeInTheDocument();

    // Filter by yellow cards
    fireEvent.click(screen.getByRole('button', { name: /🟡 Gelb/i }));
    expect(screen.queryByText('Anna Muster')).toBeNull();
    expect(screen.getByText('Ben Problem')).toBeInTheDocument();
  });

  it('STRICT CONSTRAINT: no subjective evaluation and no mention of "Konferenz" in UI', async () => {
    const { container } = render(<SchoolStatistics initialClassId={10} currentUser={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('Schulstatistik')).toBeInTheDocument();
    });

    // Zero mention of Konferenz
    expect(container.textContent).not.toMatch(/konferenz/i);

    // No subjective rating terms
    expect(container.textContent).not.toMatch(/vorbildlich/i);
    expect(container.textContent).not.toMatch(/handlungsbedarf/i);
    expect(container.textContent).not.toMatch(/klimastatus/i);
    expect(container.textContent).not.toMatch(/förder.*radar/i);
  });
});
