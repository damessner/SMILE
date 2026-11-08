import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WebUntisView } from './WebUntisView';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getWebUntisStatus: vi.fn(),
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

function getTestMonday() {
  const d = new Date();
  const day = d.getDay();
  const diffToMonday = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return {
    dateInt: Number(`${y}${m}${dd}`),
    dateStr: `${y}-${m}-${dd}`,
  };
}

describe('WebUntisView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWebUntisStatus).mockResolvedValue({
      connected: true,
      environment: 'production',
      server: 'ms-telfs.webuntis.com',
      school: 'ms-telfs',
      account: 'service',
    });
    vi.mocked(api.getWebUntisAccount).mockResolvedValue({
      connected: false,
    });
    vi.mocked(api.getWebUntisTimetable).mockResolvedValue({
      lessons: [
        {
          id: 501,
          date: getTestMonday().dateInt,
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
          date: getTestMonday().dateInt,
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
    expect(await screen.findByText(new RegExp(`Abwesenheiten am ${getTestMonday().dateStr}`))).toBeInTheDocument();
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

  it('sends the lesson class and date when saving Lehrstoff', async () => {
    vi.mocked(api.saveWebUntisTeachingContent).mockResolvedValue({ success: true });

    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    const input = await screen.findByDisplayValue('Grammatik Grundlagen');
    expect(input).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Lehrstoff in WebUntis speichern'));

    await waitFor(() => {
      expect(api.saveWebUntisTeachingContent).toHaveBeenCalledWith(
        501,
        430,
        getTestMonday().dateStr,
        'Grammatik Grundlagen',
      );
    });
  });

  it('shows an error banner instead of claiming an empty timetable on failure', async () => {
    vi.mocked(api.getWebUntisTimetable).mockRejectedValueOnce(
      new Error('WebUntis ist nicht erreichbar.'),
    );

    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    expect(await screen.findByText('WebUntis ist nicht erreichbar.')).toBeInTheDocument();
    expect(screen.queryByText('Keine Stunden für diesen Zeitraum gefunden.')).not.toBeInTheDocument();
  });

  it('renders duty slots (MM, SPR) with badges and no Lehrstoff input, collapsing coincident slots', async () => {
    vi.mocked(api.getWebUntisTimetable).mockResolvedValueOnce({
      lessons: [
        {
          id: 601,
          date: getTestMonday().dateInt,
          startTime: 1145,
          endTime: 1235,
          classes: [{ id: 101, name: '1A' }],
          teachers: [{ id: 10, name: 'MED' }],
          subjects: [{ id: 61, name: 'MM' }],
          rooms: [{ id: 12, name: 'Speisesaal' }],
          hasTeachingContent: false,
          missingTeachingContent: false,
          missingAttendance: false,
          attendanceChecked: null,
          status: 'regular',
          isDuty: true,
          dutyType: 'lunch',
        },
        {
          id: 602,
          date: getTestMonday().dateInt,
          startTime: 1145,
          endTime: 1235,
          classes: [{ id: 102, name: '1B' }],
          teachers: [{ id: 10, name: 'MED' }],
          subjects: [{ id: 61, name: 'MM' }],
          rooms: [{ id: 12, name: 'Speisesaal' }],
          hasTeachingContent: false,
          missingTeachingContent: false,
          missingAttendance: false,
          attendanceChecked: null,
          status: 'regular',
          isDuty: true,
          dutyType: 'lunch',
        },
      ],
    });

    render(
      <WebUntisView
        currentClass={null}
        classes={[]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    // Shows duty badge
    expect(await screen.findByText('Mittagsbetreuung')).toBeInTheDocument();
    // Classes are merged together in the collapsed duty card
    expect(screen.getByText('1A, 1B')).toBeInTheDocument();
    // Does not show Lehrstoff fehlt or Lehrstoff input
    expect(screen.queryByText('Lehrstoff fehlt')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Thema / Lehrstoff...')).not.toBeInTheDocument();
    expect(screen.queryByText('Anwesenheit fehlt')).not.toBeInTheDocument();
  });
});
