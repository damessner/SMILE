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
  getClassPupils: vi.fn(),
  getWebUntisOutbox: vi.fn(),
  retryWebUntisOutbox: vi.fn(),
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
    vi.mocked(api.getClassPupils).mockResolvedValue([]);
    vi.mocked(api.getWebUntisOutbox).mockResolvedValue({
      items: [],
      pendingCount: 0,
      failedCount: 0,
    });
    vi.mocked(api.retryWebUntisOutbox).mockResolvedValue({
      success: true,
      requeued: 0,
      result: { processed: 0, succeeded: 0, retried: 0, failed: 0 },
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

  it('does not write to WebUntis while Lehrstoff is only being typed', async () => {
    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    const input = await screen.findByDisplayValue('Grammatik Grundlagen');
    fireEvent.change(input, { target: { value: 'Noch nicht gespeichert' } });

    // Typing only updates local state. The WebUntis write happens on the
    // explicit save button, never on change/blur.
    expect(api.saveWebUntisTeachingContent).not.toHaveBeenCalled();
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

  it('renders duty slots (SPR, Aufsicht) with badges and no Lehrstoff input, collapsing coincident slots', async () => {
    vi.mocked(api.getWebUntisTimetable).mockResolvedValueOnce({
      lessons: [
        {
          id: 601,
          date: getTestMonday().dateInt,
          startTime: 1145,
          endTime: 1235,
          classes: [{ id: 101, name: '1A' }],
          teachers: [{ id: 10, name: 'MED' }],
          subjects: [{ id: 70, name: 'SPR' }],
          rooms: [{ id: 12, name: 'Konferenzzimmer' }],
          hasTeachingContent: false,
          missingTeachingContent: false,
          missingAttendance: false,
          attendanceChecked: null,
          status: 'regular',
          isDuty: true,
          dutyType: 'office_hour',
        },
        {
          id: 602,
          date: getTestMonday().dateInt,
          startTime: 1145,
          endTime: 1235,
          classes: [{ id: 102, name: '1B' }],
          teachers: [{ id: 10, name: 'MED' }],
          subjects: [{ id: 70, name: 'SPR' }],
          rooms: [{ id: 12, name: 'Konferenzzimmer' }],
          hasTeachingContent: false,
          missingTeachingContent: false,
          missingAttendance: false,
          attendanceChecked: null,
          status: 'regular',
          isDuty: true,
          dutyType: 'office_hour',
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
    expect(await screen.findByText('Sprechstunde')).toBeInTheDocument();
    // Classes are merged together in the collapsed duty card
    expect(screen.getByText('1A, 1B')).toBeInTheDocument();
    // Does not show Lehrstoff fehlt or Lehrstoff input
    expect(screen.queryByText('Lehrstoff fehlt')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Thema / Lehrstoff...')).not.toBeInTheDocument();
    expect(screen.queryByText('Anwesenheit fehlt')).not.toBeInTheDocument();
  });

  it('filters out MM (Mittleres Management) from the timetable', async () => {
    vi.mocked(api.getWebUntisTimetable).mockResolvedValueOnce({
      lessons: [
        {
          id: 701,
          date: getTestMonday().dateInt,
          startTime: 1145,
          endTime: 1235,
          classes: [{ id: 101, name: '1A' }],
          teachers: [{ id: 10, name: 'MED' }],
          subjects: [{ id: 61, name: 'MM' }],
          rooms: [{ id: 12, name: 'Direktion' }],
          status: 'regular',
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

    // MM is not displayed anywhere in the timetable
    expect(screen.queryByText('MM')).not.toBeInTheDocument();
    expect(screen.queryByText('Mittleres Management')).not.toBeInTheDocument();
  });

  it('loads matching class pupils when opening the event modal for a different filtered class', async () => {
    const class2A = { id: 440, name: '2A', grade: 2 };
    vi.mocked(api.getClassPupils).mockResolvedValueOnce({
      pupils: [
        {
          id: 88,
          classId: 440,
          fullName: 'Anna Beispiel',
          isSubmitted: false,
          ratings: {},
        },
      ],
    });

    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass, class2A]}
        currentUser={mockUser}
        pupils={[{ id: 77, classId: 430, fullName: 'Max Mustermann', isSubmitted: false, ratings: {} } as any]}
      />,
    );

    const filterSelect = await screen.findByDisplayValue('Alle meine Klassen & Stunden');
    fireEvent.change(filterSelect, { target: { value: '440' } });

    fireEvent.click(screen.getByText('Klassenbuch & Disziplinar'));
    fireEvent.click(await screen.findByText('Neuer Eintrag'));

    await waitFor(() => {
      expect(api.getClassPupils).toHaveBeenCalledWith(440);
    });
    expect(await screen.findByRole('option', { name: 'Anna Beispiel' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Max Mustermann' })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows failed outbox entries and retries them on button click', async () => {
    vi.mocked(api.getWebUntisAccount).mockResolvedValue({
      connected: true,
      account: {
        username: 'teacher',
        teacherShort: 'SCH',
        school: 'ms-telfs',
        server: 'ms-telfs.webuntis.com',
        authMethod: 'password',
        lastVerifiedAt: '2026-11-14T00:00:00Z',
      },
    });
    vi.mocked(api.getWebUntisOutbox)
      .mockResolvedValueOnce({
        items: [
          {
            id: 'ob-1',
            kind: 'classreg_event',
            status: 'failed',
            attempts: 5,
            maxAttempts: 5,
            lastError: 'WebUntis timeout',
            nextAttemptAt: '2026-11-14T00:00:00Z',
            createdAt: '2026-11-14T00:00:00Z',
            date: '2026-11-14',
            time: '08:15',
            eventKind: 'red',
            text: '[Rote Karte]',
          },
        ],
        pendingCount: 0,
        failedCount: 1,
      })
      .mockResolvedValueOnce({ items: [], pendingCount: 0, failedCount: 0 });
    vi.mocked(api.retryWebUntisOutbox).mockResolvedValueOnce({
      success: true,
      requeued: 1,
      result: { processed: 1, succeeded: 1, retried: 0, failed: 0 },
    });

    render(
      <WebUntisView
        currentClass={mockClass}
        classes={[mockClass]}
        currentUser={mockUser}
        pupils={[]}
      />,
    );

    expect(await screen.findByText(/1 fehlgeschlagen/)).toBeInTheDocument();
    expect(screen.getByText(/WebUntis timeout/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Erneut senden/ }));
    await waitFor(() => {
      expect(api.retryWebUntisOutbox).toHaveBeenCalledTimes(1);
    });
  });
});
