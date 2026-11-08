import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WebUntisView } from './WebUntisView';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getWebUntisStatus: vi.fn(),
  setWebUntisEnvironment: vi.fn(),
  getWebUntisTimetable: vi.fn(),
  saveWebUntisTeachingContent: vi.fn(),
  getWebUntisAbsences: vi.fn(),
  getWebUntisEvents: vi.fn(),
  createWebUntisEvent: vi.fn(),
}));

const mockUser = {
  id: 'u1',
  username: 'testteacher',
  role: 'teacher' as const,
  teacherId: 10,
};

const mockClass = {
  id: 430,
  name: '1B',
  grade: 1,
};

describe('WebUntisView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWebUntisStatus).mockResolvedValue({
      connected: true,
      environment: 'production',
      server: 'ms-telfs.webuntis.com',
      school: 'ms-telfs',
      user: 'untis_monitor',
    });
    vi.mocked(api.getWebUntisTimetable).mockResolvedValue({
      lessons: [
        {
          id: 501,
          date: 20261108,
          startTime: 800,
          endTime: 850,
          classes: [{ id: 430, name: '1B' }],
          teachers: [{ id: 10, name: 'SCHUSO' }],
          subjects: [{ id: 1, name: 'D' }],
          rooms: [{ id: 1, name: 'R101' }],
          lessonText: 'Grammatik Grundlagen',
          status: 'regular',
        },
      ],
    });
    vi.mocked(api.getWebUntisAbsences).mockResolvedValue({
      absences: [
        {
          id: 601,
          studentId: 77,
          studentName: 'Max Mustermann',
          className: '1B',
          startTime: '08:00',
          endTime: '13:00',
          startDate: '2026-11-08',
          endDate: '2026-11-08',
          reason: 'Krankheit',
          excused: true,
        },
      ],
    });
    vi.mocked(api.getWebUntisEvents).mockResolvedValue({
      events: [
        {
          id: 701,
          studentId: 77,
          studentName: 'Max Mustermann',
          className: '1B',
          categoryId: 2,
          categoryName: 'Verhalten',
          date: 20261108,
          time: 815,
          text: '[Gelbe Karte] Unterricht gestört',
          syncedFromSmile: true,
        },
      ],
    });
  });

  it('renders WebUntis integration header and lessons tab', async () => {
    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    expect(await screen.findByText('WebUntis-Integration')).toBeInTheDocument();
    expect(screen.getByText('Stundenplan & Lehrstoff')).toBeInTheDocument();
    expect(screen.getByText('Abwesenheiten')).toBeInTheDocument();
    expect(screen.getByText('Klassenbuch & Disziplinar')).toBeInTheDocument();

    // Check lesson rendered
    expect(await screen.findByDisplayValue('Grammatik Grundlagen')).toBeInTheDocument();
  });

  it('switches to absences tab and displays absent pupils', async () => {
    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    const absencesTab = screen.getByText('Abwesenheiten');
    fireEvent.click(absencesTab);

    expect(await screen.findByText('Max Mustermann')).toBeInTheDocument();
    expect(screen.getByText('Krankheit')).toBeInTheDocument();
    expect(screen.getByText('Entschuldigt')).toBeInTheDocument();
  });

  it('switches to events tab and displays auto-synced card entries', async () => {
    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    const eventsTab = screen.getByText('Klassenbuch & Disziplinar');
    fireEvent.click(eventsTab);

    expect(await screen.findByText(/Gelbe Karte \(SMILE\)/)).toBeInTheDocument();
    expect(screen.getByText('[Gelbe Karte] Unterricht gestört')).toBeInTheDocument();
  });
});
