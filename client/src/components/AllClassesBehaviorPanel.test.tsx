import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllClassesBehaviorPanel } from './AllClassesBehaviorPanel';
import type { BehaviorOverview, BehaviorOverviewPupil } from '../services/api';

function pupil(overrides: Partial<BehaviorOverviewPupil> = {}): BehaviorOverviewPupil {
  return {
    id: 11,
    fullName: 'Anna Muster',
    classId: 3,
    className: '3a',
    grade: 3,
    rank: null,
    stage: null,
    counts: { green: 0, yellow: 0, red: 0, timeout: 0, cooldown: 0 },
    activeIncident: null,
    canRecord: true,
    ...overrides,
  };
}

const overview: BehaviorOverview = {
  schoolWide: true,
  classes: [
    { id: 3, name: '3a', grade: 3 },
    { id: 4, name: '4b', grade: 4 },
  ],
  pupils: [
    pupil({ id: 11, fullName: 'Anna Muster', counts: { green: 2, yellow: 0, red: 0, timeout: 0, cooldown: 0 } }),
    pupil({ id: 22, fullName: 'Bert Beispiel', classId: 4, className: '4b', grade: 4 }),
  ],
};

function renderPanel(data: BehaviorOverview | null = overview) {
  return render(
    <AllClassesBehaviorPanel
      data={data}
      loading={false}
      error={null}
      onRefresh={vi.fn()}
      onAction={vi.fn()}
    />,
  );
}

describe('school-wide class selection', () => {
  it('replaces the old heading with one button per class', () => {
    renderPanel();

    expect(screen.queryByText('Schulweiter Überblick')).toBeNull();
    expect(screen.getByRole('group', { name: 'Klasse auswählen' })).toBeInTheDocument();

    const classB = screen.getByRole('button', { name: 'Klasse 4b auswählen' });
    expect(classB).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Klasse 3a auswählen' })).toBeInTheDocument();
    // The class picker must be buttons, not the old dropdown.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('filters rows and totals to the selected class and back to everyone', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Klasse 4b auswählen' }));

    expect(screen.getByText('Bert Beispiel')).toBeInTheDocument();
    expect(screen.queryByText('Anna Muster')).toBeNull();
    expect(screen.getByText(/Klasse 4b · 1 von 1 Schüler/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Klasse 4b auswählen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: /^Alle/ }));

    expect(screen.getByText('Anna Muster')).toBeInTheDocument();
    expect(screen.getByText('Bert Beispiel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Klasse 4b auswählen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows an empty state when the selected class has no pupils after a search', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Klasse 4b auswählen' }));
    await user.type(screen.getByRole('textbox', { name: 'Schüler suchen' }), 'Anna');

    expect(screen.getByText('Keine Schüler*innen gefunden.')).toBeInTheDocument();
  });
});
