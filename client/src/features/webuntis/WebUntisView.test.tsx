import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WebUntisView } from './WebUntisView';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getWebUntisStatus: vi.fn(),
  setWebUntisEnvironment: vi.fn(),
  getWebUntisAccount: vi.fn(),
  connectWebUntisAccount: vi.fn(),
  disconnectWebUntisAccount: vi.fn(),
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
    vi.mocked(api.getWebUntisAccount).mockResolvedValue({
      connected: false,
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
          hasTeachingContent: true,
          missingTeachingContent: false,
          missingAttendance: false,
          attendanceChecked: true,
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

  it('renders connect wizard button and banner when account is not connected', async () => {
    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    expect(await screen.findByText('Eigenes WebUntis-Konto verknüpfen')).toBeInTheDocument();
    expect(screen.getByText('Eigenes WebUntis-Konto noch nicht verknüpft')).toBeInTheDocument();
    expect(screen.getByText('Jetzt verknüpfen')).toBeInTheDocument();

    // Clicking button opens modal
    const connectBtn = screen.getByRole('button', { name: 'Eigenes WebUntis-Konto verknüpfen' });
    fireEvent.click(connectBtn);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Verbindung testen & verknüpfen')).toBeInTheDocument();
  });

  it('renders teacher short code when personal account is connected', async () => {
    vi.mocked(api.getWebUntisAccount).mockResolvedValue({
      connected: true,
      account: {
        username: 'OFJ',
        teacherShort: 'OFJ',
        school: 'ms-telfs',
        server: 'ms-telfs.webuntis.com',
        authMethod: 'password',
        lastVerifiedAt: new Date().toISOString(),
      },
    });

    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    expect(await screen.findByText('WebUntis: OFJ')).toBeInTheDocument();
    // Banner should not be shown when connected
    expect(screen.queryByText('Eigenes WebUntis-Konto noch nicht verknüpft')).not.toBeInTheDocument();
  });

  it('displays status badges for missing Lehrstoff and missing attendance', async () => {
    vi.mocked(api.getWebUntisTimetable).mockResolvedValue({
      lessons: [
        {
          id: 502,
          date: 20261108,
          startTime: 855,
          endTime: 945,
          classes: [{ id: 430, name: '1B' }],
          teachers: [{ id: 10, name: 'SCHUSO' }],
          subjects: [{ id: 2, name: 'M' }],
          rooms: [{ id: 1, name: 'R101' }],
          lessonText: '',
          hasTeachingContent: false,
          missingTeachingContent: true,
          missingAttendance: true,
          attendanceChecked: false,
          status: 'regular',
        },
      ],
    });

    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    // Summary chips
    expect(await screen.findByText('1x Lehrstoff fehlt')).toBeInTheDocument();
    expect(screen.getByText('1x Anwesenheit fehlt')).toBeInTheDocument();

    // Card badges
    expect(screen.getByText('Lehrstoff fehlt')).toBeInTheDocument();
    const missingAttendanceBadge = screen.getByRole('button', { name: /^Anwesenheit fehlt$/ });
    expect(missingAttendanceBadge).toBeInTheDocument();

    // Clicking missing attendance navigates to absences tab
    fireEvent.click(missingAttendanceBadge);
    expect(await screen.findByText('Abwesenheiten am 2026-11-08 (1)')).toBeInTheDocument();
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

  it('renders 5-day school week calendar and allows shifting weeks', async () => {
    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    expect(await screen.findByText('Wochen-Kalender')).toBeInTheDocument();
    expect(screen.getByText('Tages-Liste')).toBeInTheDocument();

    // 5 day column headers
    expect(screen.getByText('Montag')).toBeInTheDocument();
    expect(screen.getByText('Dienstag')).toBeInTheDocument();
    expect(screen.getByText('Mittwoch')).toBeInTheDocument();
    expect(screen.getByText('Donnerstag')).toBeInTheDocument();
    expect(screen.getByText('Freitag')).toBeInTheDocument();

    // Next week navigation
    const nextWeekBtn = screen.getByTitle('Nächste Schulwoche');
    fireEvent.click(nextWeekBtn);

    await waitFor(() => {
      expect(api.getWebUntisTimetable).toHaveBeenCalledTimes(2);
    });
  });
});
