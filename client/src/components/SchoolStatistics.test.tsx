import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SchoolStatistics } from './SchoolStatistics';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  getStatistics: vi.fn(),
}));

describe('SchoolStatistics subject-scoped result rows', () => {
  const mockData = {
    classes: [{ id: 10, name: '3a', grade: 3 }],
    round: { id: 'round-1', name: 'Herbst 2026' },
    distribution: {
      lehrling: 1,
      geselle: 1,
      meister: 0,
      total: 2,
      percentLehrling: 50,
      percentGeselle: 50,
      percentMeister: 0,
    },
    pupils: [
      {
        id: 1,
        fullName: 'Anna Muster',
        classId: 10,
        className: '3a',
        grade: 3,
        subjectResults: [
          {
            subjectCode: 'D',
            subjectName: 'Deutsch',
            positiveCount: 4,
            totalRated: 18,
            calculatedRank: 'Lehrling' as const,
            teacherVote: {
              teacherId: 101,
              teacherShort: 'MIL',
              teacherName: 'Frau Miller',
              subjectCode: 'D',
              subjectName: 'Deutsch',
              isCore: true,
              proposedStatus: 'Lehrling' as const,
              positiveCount: 4,
              totalRated: 18,
              updatedAt: '2026-10-01T10:00:00Z',
            },
            items: [],
          },
          {
            subjectCode: 'M',
            subjectName: 'Mathematik',
            positiveCount: 10,
            totalRated: 18,
            calculatedRank: 'Geselle' as const,
            teacherVote: {
              teacherId: 102,
              teacherShort: 'SMI',
              teacherName: 'Herr Smith',
              subjectCode: 'M',
              subjectName: 'Mathematik',
              isCore: true,
              proposedStatus: 'Geselle' as const,
              positiveCount: 10,
              totalRated: 18,
              updatedAt: '2026-10-01T10:00:00Z',
            },
            items: [],
          },
        ],
        conferenceDecision: {
          rank: 'Meister' as const,
          isConfirmed: true as const,
          overrideReason: 'Pädagogischer Beschluss',
        },
        isConfirmed: true,
        teacherVotes: [],
      },
      {
        id: 2,
        fullName: 'Ben Unrated',
        classId: 10,
        className: '3a',
        grade: 3,
        subjectResults: [
          {
            subjectCode: 'D',
            subjectName: 'Deutsch',
            positiveCount: 0,
            totalRated: 0,
            calculatedRank: null,
            teacherVote: null,
            items: [],
          },
        ],
        conferenceDecision: null,
        isConfirmed: false,
        teacherVotes: [],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getStatistics as any).mockResolvedValue(mockData);
  });

  it('renders independent per-subject result rows and shows unrated subjects as pending, not Lehrling', async () => {
    render(<SchoolStatistics initialClassId={10} />);

    await waitFor(() => {
      expect(screen.getAllByText('Anna Muster').length).toBe(2);
    });

    // Anna should have two separate subject rows: Deutsch (Lehrling) and Mathematik (Geselle)
    expect(screen.getByText(/4 \/ 18 Smileys/i)).toBeInTheDocument();
    expect(screen.getByText(/10 \/ 18 Smileys/i)).toBeInTheDocument();

    // Ben has an unrated Deutsch subject; it should render as Ausstehend, NOT Lehrling
    expect(screen.getByText(/Ben Unrated/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Ausstehend/i).length).toBeGreaterThanOrEqual(1);

    // Conference decision is captioned separately as Konferenzbeschluss
    expect(screen.getAllByText(/Konferenzbeschluss: Meister/i).length).toBeGreaterThanOrEqual(1);

    // Distribution totals display correctly
    expect(screen.getByText(/2 Fächer-Ergebnisse gesamt/i)).toBeInTheDocument();
  });

  it('uses the delivered rubric item count for score labels and bars', async () => {
    (api.getStatistics as any).mockResolvedValue({
      ...mockData,
      rubricConfig: { meister: 20, geselle: 12, itemCount: 24, aggregation: 'total' },
    });
    const { container } = render(<SchoolStatistics initialClassId={10} />);

    await waitFor(() => {
      expect(screen.getByText(/4 \/ 24 Smileys/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/10 \/ 24 Smileys/i)).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 24 Smileys \(Ausstehend\)/i)).toBeInTheDocument();
    expect(container.querySelector('[style*="width: 17%"]')).toBeInTheDocument();
  });

  it('filters rows when a specific subject is selected', async () => {
    render(<SchoolStatistics initialClassId={10} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Anna Muster/i).length).toBe(2);
    });

    // Subject filter button for Mathematik
    const mathFilterButton = screen.getByRole('button', { name: /Mathematik \(M\)/i });
    fireEvent.click(mathFilterButton);

    // Only Mathematik row should remain; Ben's Deutsch row should disappear
    expect(screen.getByText(/10 \/ 18 Smileys/i)).toBeInTheDocument();
    expect(screen.queryByText(/4 \/ 18 Smileys/i)).toBeNull();
    expect(screen.queryByText(/Ben Unrated/i)).toBeNull();
    expect(screen.getAllByText(/Anna Muster/i).length).toBe(1);
  });
});
