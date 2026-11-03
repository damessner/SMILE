import { describe, expect, it } from 'vitest';
import {
  buildConferenceExportHtml,
  escapeHtml,
  formatParticipation,
  type ConferenceExportClass,
  type ConferenceExportPupil,
} from './conferenceExportHtml';

function pupil(overrides: Partial<ConferenceExportPupil> = {}): ConferenceExportPupil {
  return {
    index: 1,
    name: 'Anna Muster',
    participation: '3/7 (43 %)',
    lehrlingVotes: 1,
    geselleVotes: 0,
    meisterVotes: 1,
    pctLehrling: 33,
    pctGeselle: 0,
    pctMeister: 67,
    suggestedRank: 'Meister',
    hasRedCardDemotion: false,
    confirmedRank: null,
    redCards: 0,
    yellowCards: 0,
    note: '—',
    ...overrides,
  };
}

function klass(overrides: Partial<ConferenceExportClass> = {}): ConferenceExportClass {
  return {
    className: '1A',
    kvInfo: 'MUE & SCH',
    totalPupils: 1,
    totalClassTeachers: 2,
    confirmedCount: 0,
    openDecisionCount: 1,
    lehrlingCount: 0,
    geselleCount: 0,
    meisterCount: 1,
    pctLehrling: 0,
    pctGeselle: 0,
    pctMeister: 100,
    pupils: [pupil()],
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes the five HTML control characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('renders nullish values as empty strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('formatParticipation', () => {
  it('renders submitted over eligible teachers with the rounded percentage', () => {
    expect(formatParticipation(3, 7)).toBe('3/7 (43 %)');
    expect(formatParticipation(2, 3)).toBe('2/3 (67 %)');
  });

  it('renders zero submitted votes', () => {
    expect(formatParticipation(0, 7)).toBe('0/7 (0 %)');
  });

  it('renders a dash when no teachers are eligible', () => {
    expect(formatParticipation(0, 0)).toBe('—');
  });
});

describe('buildConferenceExportHtml', () => {
  it('escapes pupil names and notes instead of emitting raw markup', () => {
    const html = buildConferenceExportHtml({
      classes: [
        klass({
          pupils: [pupil({ name: '<script>alert(1)</script>', note: 'a & b <i>' })],
        }),
      ],
      filterLabel: 'Konferenzprotokoll & Votenübersicht',
      generatedAt: '12.10.2026, 18:00 Uhr',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('a &amp; b &lt;i&gt;');
  });

  it('renders one page per class with print page breaks', () => {
    const html = buildConferenceExportHtml({
      classes: [klass(), klass({ className: '1B' })],
      filterLabel: 'Konferenzprotokoll & Votenübersicht',
      generatedAt: '12.10.2026, 18:00 Uhr',
    });

    expect(html.match(/class="page"/g)).toHaveLength(2);
    expect(html).toContain('page-break-after: always');
    expect(html).toContain('Klasse 1A');
    expect(html).toContain('Klasse 1B');
    expect(html).toContain('@page { size: A4 portrait; margin: 6mm 8mm; }');
  });

  it('renders vote percentages, ranks and the demotion marker', () => {
    const html = buildConferenceExportHtml({
      classes: [
        klass({
          pupils: [
            pupil({ hasRedCardDemotion: true, confirmedRank: 'Geselle', suggestedRank: 'Meister' }),
          ],
        }),
      ],
      filterLabel: 'Vorkonferenz-Übersicht (Voten)',
      generatedAt: '12.10.2026, 18:00 Uhr',
    });

    expect(html).toContain('1 L (33%)');
    expect(html).toContain('1 M (67%)');
    expect(html).toContain('(Rangabzug Karte)');
    expect(html).toContain('✓ Geselle');
  });

  it('renders the participation column instead of the subject raster', () => {
    const html = buildConferenceExportHtml({
      classes: [klass()],
      filterLabel: 'Konferenzprotokoll & Votenübersicht',
      generatedAt: '12.10.2026, 18:00 Uhr',
    });

    expect(html).toContain('<th>Beteiligung</th>');
    expect(html).toContain('3/7 (43 %)');
    expect(html).not.toContain('Raster');
  });

  it('falls back to the empty-class notice when a class has no pupils', () => {
    const html = buildConferenceExportHtml({
      classes: [klass({ pupils: [], totalPupils: 0, openDecisionCount: 0 })],
      filterLabel: 'Konferenzprotokoll & Votenübersicht',
      generatedAt: '12.10.2026, 18:00 Uhr',
    });

    expect(html).toContain('Keine Schüler*innen in dieser Klasse eingetragen.');
  });
});
