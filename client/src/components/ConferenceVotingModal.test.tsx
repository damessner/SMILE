import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConferenceVotingModal } from './ConferenceVotingModal';
import { ConfirmProvider } from './ConfirmDialog';
import {
  getConferenceSummary,
  voteConference,
  voteAllConference,
} from '../services/api';
import { dissentingVotes, describeDissent } from './ConferenceVotingModal';
import type { SchoolClass, User } from '../types';

vi.mock('../services/api', () => ({
  getConferenceSummary: vi.fn(),
  voteConference: vi.fn(),
  voteAllConference: vi.fn(),
}));

const CLASSES: SchoolClass[] = [
  { id: 1, name: '1A', grade: 1 } as SchoolClass,
  { id: 2, name: '1B', grade: 1 } as SchoolClass,
];

function renderModal(overrides: Partial<Parameters<typeof ConferenceVotingModal>[0]> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <ConfirmProvider>
      <ConferenceVotingModal
        classes={CLASSES}
        initialClassId={1}
        initialViewMode="walkthrough"
        currentUser={{ id: 't-1', role: 'teacher', teacherId: 1 } as User}
        onClose={onClose}
        {...overrides}
      />
    </ConfirmProvider>,
  );
  return { onClose };
}

function pupil(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    fullName: 'Anna Muster',
    subjectEvidence: [{ subjectCode: 'D', subjectName: 'Deutsch', positiveCount: 10, totalRated: 18 }],
    suggestedRank: 'Meister',
    finalRank: null,
    hasRedCardDemotion: false,
    isConfirmed: false,
    evaluationsCount: 2,
    teacherVotes: [
      {
        teacherId: 1,
        teacherShort: 'MUE',
        teacherName: 'Maria Müller',
        subjectCode: 'D',
        proposedStatus: 'Meister',
        isSubmitted: true,
        positiveCount: 10,
        totalRated: 18,
        hours: 4,
      },
      {
        teacherId: 2,
        teacherShort: 'SCH',
        teacherName: 'Stefan Schmidt',
        subjectCode: 'M',
        proposedStatus: 'Lehrling',
        isSubmitted: true,
        positiveCount: 3,
        totalRated: 18,
        hours: 2,
      },
    ],
    voteStats: {
      Lehrling: 1,
      Geselle: 0,
      Meister: 1,
      hoursLehrling: 2,
      hoursGeselle: 0,
      hoursMeister: 4,
      totalVotedHours: 6,
      pctLehrling: 33,
      pctGeselle: 0,
      pctMeister: 67,
    },
    cards: { green: [], yellow: [], red: [] },
    ...overrides,
  };
}

function mockSummary(pupils: unknown[], overrides: Record<string, unknown> = {}) {
  vi.mocked(getConferenceSummary).mockResolvedValue({
    totalClassTeachers: 2,
    isAuthorized: true,
    summary: pupils,
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSummary([pupil()]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConferenceVotingModal', () => {
  it('renders the walkthrough surface for the loaded class', async () => {
    const { onClose } = renderModal();

    await waitFor(() => {
      expect(screen.getByText('Anna Muster')).toBeInTheDocument();
    });

    // Header identification.
    expect(screen.getByText('Konferenz-Modus')).toBeInTheDocument();
    expect(screen.getByText(/Lehrpersonen/)).toBeInTheDocument();

    // Subject rubric evidence is intentionally not listed in conference mode.
    expect(screen.queryByText(/Raster/)).toBeNull();
    expect(screen.queryAllByTitle(/Deutsch: 10\/18 positiv/)).toHaveLength(0);

    // Approve is available and not yet pressed.
    expect(screen.getByRole('button', { name: /Als Beschluss annehmen/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Annahme zurücknehmen/i })).toBeNull();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the confirmation stamp for an already-decided pupil', async () => {
    mockSummary([pupil({ isConfirmed: true, finalRank: 'Meister' })]);

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Beschluss erfasst')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Annahme zurücknehmen/i })).toBeInTheDocument();
  });

  it('renders one teacher vote card per submitted evaluation', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('D · MUE')).toBeInTheDocument();
    });

    expect(screen.getByText('M · SCH')).toBeInTheDocument();
    expect(screen.getByText(/Maria Müller|MUE/)).toBeInTheDocument();
  });

  it('lists the hours-weighted vote distribution', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByText(/Lehrling: 2h \(33%\)/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Meister: 4h \(67%\)/)).toBeInTheDocument();
  });

  it('navigates to the next pupil with the arrow keys', async () => {
    mockSummary([pupil({ id: 10, fullName: 'Anna Muster' }), pupil({ id: 11, fullName: 'Bernd Berger' })]);

    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Anna Muster')).toBeInTheDocument();
    });

    // The keydown listener re-attaches after the async summary load commits.
    // Retry the dispatch so a keydown racing that effect flush is not lost
    // (with two pupils the clamp keeps this idempotent).
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(screen.getByText('Bernd Berger')).toBeInTheDocument();
    });
  });

  it('starts in the editable list with suggested ranks preselected and confirms the class at once', async () => {
    mockSummary([
      pupil({ id: 10, fullName: 'Anna Muster', suggestedRank: 'Meister' }),
      pupil({ id: 11, fullName: 'Bernd Berger', suggestedRank: 'Geselle' }),
    ]);

    renderModal({ initialViewMode: 'table' });

    await waitFor(() => {
      expect(screen.getByText(/Beschlüsse bearbeiten/)).toBeInTheDocument();
    });

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    expect(selects[0].value).toBe('Meister');
    expect(selects[1].value).toBe('Geselle');

    fireEvent.click(screen.getByRole('button', { name: /Klasse bestätigen/i }));

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Alle annehmen/i }));

    await waitFor(() => {
      expect(voteAllConference).toHaveBeenCalledWith(1, [
        { pupilId: 10, rank: 'Meister' },
        { pupilId: 11, rank: 'Geselle' },
      ]);
    });
  });

  it('switches to the list view and back', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Anna Muster')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Bearbeiten/i }));
    expect(screen.getAllByText('Vorschlag').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Präsentation/i }));
    expect(screen.getByText(/Lehrer-Votings & Vorschläge/)).toBeInTheDocument();
  });

  it('confirms the current rank through the approve button', async () => {
    const onVotesUpdated = vi.fn();
    renderModal({ onVotesUpdated });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Als Beschluss annehmen/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Als Beschluss annehmen/i }));

    await waitFor(() => {
      expect(voteConference).toHaveBeenCalledWith(
        1,
        10,
        'Meister',
        expect.stringContaining('Beschluss der Klassenkonferenz vom'),
        'confirm',
      );
    });
    await waitFor(() => {
      expect(onVotesUpdated).toHaveBeenCalled();
    });
  });

  it('withdraws a decision the conference already made', async () => {
    mockSummary([pupil({ isConfirmed: true, finalRank: 'Geselle' })]);
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Annahme zurücknehmen/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Annahme zurücknehmen/i }));

    await waitFor(() => {
      expect(voteConference).toHaveBeenCalledWith(1, 10, 'Geselle', undefined, 'unconfirm');
    });
  });

  it('shows an error banner when the vote is rejected', async () => {
    vi.mocked(voteConference).mockRejectedValue(new Error('Abstimmung ist gesperrt.'));
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Als Beschluss annehmen/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Als Beschluss annehmen/i }));

    await waitFor(() => {
      expect(screen.getByText('Abstimmung ist gesperrt.')).toBeInTheDocument();
    });
  });

  it('keeps navigation inside the pupil list', async () => {
    mockSummary([pupil({ id: 10, fullName: 'Anna Muster' })]);
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Anna Muster')).toBeInTheDocument();
    });

    // One pupil only: neither arrow moves, and the counter stays put.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Anna Muster')).toBeInTheDocument();
  });

  it('renders the empty class state', async () => {
    mockSummary([]);
    renderModal();

    await waitFor(() => {
      expect(screen.getByText(/Keine aktiven Schüler/)).toBeInTheDocument();
    });
  });
});

describe('ConferenceVotingModal dissent indicator (Decision 0.3)', () => {
  it('counts the teachers whose proposal differs from the rank the board picked', async () => {    // Anna is decided as Meister, but Schmidt proposed Lehrling for Mathe.
    mockSummary([pupil({ isConfirmed: true, finalRank: 'Meister' })]);
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Beschluss erfasst')).toBeInTheDocument();
    });

    // The indicator must name the dissent count and the hours behind it.
    expect(screen.getByText('⚠️')).toBeInTheDocument();
    expect(screen.getByText('1 Gegenstimme (2h Lehrling)')).toBeInTheDocument();
    // And the dissenter itself, so the board can ask why.
    expect(screen.getByText('SCH')).toBeInTheDocument();
    expect(screen.getByTitle(/schlug Lehrling in M vor/)).toBeInTheDocument();
  });

  it('does not show the indicator when nobody dissents', async () => {
    mockSummary([
      pupil({
        isConfirmed: true,
        finalRank: 'Meister',
        teacherVotes: [
          {
            teacherId: 1,
            teacherShort: 'MUE',
            teacherName: 'Maria Müller',
            subjectCode: 'D',
            proposedStatus: 'Meister',
            isSubmitted: true,
            positiveCount: 10,
            totalRated: 18,
            hours: 4,
          },
        ],
      }),
    ]);
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Beschluss erfasst')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Gegenstimme/)).toBeNull();
  });
});

describe('dissentingVotes', () => {
  it('excludes proposals on unsubmitted evaluations from conference dissent', () => {
    const withdrawn = { ...vote('SCH', 'Lehrling', 2, false) };
    expect(dissentingVotes([withdrawn], 'Meister')).toEqual([]);
  });

  const vote = (teacherShort: string, proposedStatus: string, hours: number, isSubmitted = true) => ({
    teacherId: 1,
    teacherShort,
    teacherName: teacherShort,
    subjectCode: 'D',
    proposedStatus,
    isSubmitted,
    positiveCount: 1,
    totalRated: 18,
    hours,
  });

  it('keeps only the submitted votes that proposed a different rank', () => {
    const dissent = dissentingVotes(
      [vote('MUE', 'Meister', 4), vote('SCH', 'Lehrling', 2)],
      'Meister',
    );

    expect(dissent).toHaveLength(1);
    expect(dissent[0]).toMatchObject({ teacherShort: 'SCH', proposedStatus: 'Lehrling', hours: 2 });
  });

  it('treats a teacher who never submitted a ballot as missing, not dissenting', () => {
    const dissent = dissentingVotes([vote('SCH', 'Lehrling', 2, false)], 'Meister');
    expect(dissent).toEqual([]);
  });

  it('renders an unsubmitted teacher evaluation as pending rather than an active rank', async () => {
    mockSummary([pupil({
      teacherVotes: [
        {
          teacherId: 2,
          teacherShort: 'SCH',
          teacherName: 'Stefan Schmidt',
          subjectCode: 'M',
          proposedStatus: 'Lehrling',
          isSubmitted: false,
          positiveCount: 3,
          totalRated: 18,
          hours: 2,
          comment: 'veralteter Kommentar',
        },
      ],
      voteStats: {
        Lehrling: 0,
        Geselle: 0,
        Meister: 0,
        hoursLehrling: 0,
        hoursGeselle: 0,
        hoursMeister: 0,
        totalVotedHours: 0,
        pctLehrling: 0,
        pctGeselle: 0,
        pctMeister: 0,
      },
    })]);
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Lehrer-Votings & Vorschläge (1 Rückmeldung · 0h gewichtet)')).toBeInTheDocument();
    });
    const pendingVote = within(screen.getByRole('article', { name: 'M · SCH' }));
    expect(pendingVote.getByText('Ausstehend')).toBeInTheDocument();
    expect(pendingVote.queryByText('Lehrling')).toBeNull();
    expect(pendingVote.queryByText('veralteter Kommentar')).toBeNull();
  });

  it('returns nothing while the board has not decided', () => {
    expect(dissentingVotes([vote('SCH', 'Lehrling', 2)], null)).toEqual([]);
    expect(dissentingVotes([vote('SCH', 'Lehrling', 2)], undefined)).toEqual([]);
  });

  it('describes the dissent with its weight behind the dissenting rank', () => {
    const dissent = dissentingVotes(
      [vote('MUE', 'Meister', 4), vote('SCH', 'Lehrling', 2), vote('WEB', 'Lehrling', 4)],
      'Meister',
    );

    // Two teachers dissenting on Lehrling: 6 weighted hours, one position.
    expect(describeDissent(dissent)).toBe('2 Gegenstimmen (6h Lehrling)');
  });

  it('uses the singular when exactly one teacher dissents', () => {
    const dissent = dissentingVotes([vote('SCH', 'Lehrling', 2)], 'Meister');
    expect(describeDissent(dissent)).toBe('1 Gegenstimme (2h Lehrling)');
  });

  it('describes nothing when the decision was unanimous', () => {
    expect(describeDissent([])).toBeNull();
  });
});

describe('ConferenceVotingModal unsaved rank edits', () => {
  it('keeps a table-mode rank change when another pupil is accepted', async () => {
    mockSummary([
      pupil({ id: 10, fullName: 'Anna Muster' }),
      pupil({ id: 11, fullName: 'Bert Beispiel', suggestedRank: 'Geselle' }),
    ]);
    vi.mocked(voteConference).mockResolvedValue({ success: true } as never);

    renderModal({ initialViewMode: 'table' });
    const bertSelect = await screen.findByLabelText('Rang für Bert Beispiel');
    expect(bertSelect).toHaveValue('Geselle');

    // The chair changes Bert's rank in table mode and has not confirmed the class yet.
    fireEvent.change(bertSelect, { target: { value: 'Lehrling' } });
    expect(screen.getByLabelText('Rang für Bert Beispiel')).toHaveValue('Lehrling');

    // Accepting Anna reloads the whole summary (that is how participation and the
    // confirmation badge arrive). The unsaved edit for Bert must survive that reload,
    // otherwise the following "Klasse bestätigen" submits a rank nobody chose.
    fireEvent.click(screen.getByRole('button', { name: 'Anna Muster' }));
    fireEvent.click(await screen.findByRole('button', { name: /Als Beschluss annehmen/i }));
    await waitFor(() => expect(voteConference).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle('Liste zum Bearbeiten: Vorschläge vorausgewählt'));
    await waitFor(() =>
      expect(screen.getByLabelText('Rang für Bert Beispiel')).toHaveValue('Lehrling'),
    );
  });
});
describe('conference mode dialog semantics', () => {
  it('is a modal dialog that owns focus and closes on Escape', async () => {
    const { onClose } = renderModal();

    await waitFor(() => expect(screen.getByText('Anna Muster')).toBeInTheDocument());

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'conference-mode-title');

    // Initial focus lands inside the overlay, not on the page behind it.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
