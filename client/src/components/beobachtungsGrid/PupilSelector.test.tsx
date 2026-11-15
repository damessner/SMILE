import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PupilSelector } from './PupilSelector';
import type { PupilWithData } from '../../types';

const makePupil = (id: number, fullName: string, group?: string): PupilWithData => ({
  id,
  classId: 1,
  fullName,
  isArchived: false,
  evaluations: [],
  cards: [],
  greenCardCount: 0,
  yellowCardCount: 0,
  assignedGroups: group ? { E: group } : undefined,
});

describe('PupilSelector search and keyboard navigation', () => {
  it('filters pupils by name or group and navigates with ArrowDown/ArrowUp', () => {
    const onSelectPupil = vi.fn();
    const pupils = [
      makePupil(1, 'Anna Beispiel', 'E1'),
      makePupil(2, 'Ben Mustermann', 'E2'),
      makePupil(3, 'Clara Test', 'E1'),
    ];

    render(
      <PupilSelector
        folderTab="offen"
        openCount={3}
        submittedCount={0}
        currentList={pupils}
        selectedPupilId={1}
        isAllSubjectsMode={false}
        subjectCodes={['E']}
        activeSubjectCode="E"
        onSelectFolder={vi.fn()}
        onSelectPupil={onSelectPupil}
        calculateRank={() => ({ rank: null, totalPoints: 0, ratedCount: 0, color: '', barColor: '', pos: 0 })}
      />,
    );

    const searchInput = screen.getByLabelText('Schüler*in filtern');
    fireEvent.change(searchInput, { target: { value: 'Mustermann' } });

    expect(screen.getByText('Ben Mustermann')).toBeInTheDocument();
    expect(screen.queryByText('Anna Beispiel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Filter zurücksetzen'));
    expect(screen.getByText('Anna Beispiel')).toBeInTheDocument();

    const listbox = screen.getByRole('listbox', { name: 'Schülerauswahl' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(onSelectPupil).toHaveBeenCalledWith(2);

    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(onSelectPupil).toHaveBeenCalledWith(3);
  });
});
