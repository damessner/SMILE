/**
 * Standalone HTML export for the all-classes conference export.
 *
 * The modal's screen/print view is styled with Tailwind; a downloaded file has no
 * stylesheet, so this module builds a self-contained document with a small,
 * dedicated stylesheet instead: one A4 page per class, print-ready without the app.
 */

import { exportPalette } from './exportPalette';

export interface ConferenceExportPupil {
  index: number;
  name: string;
  participation: string;
  lehrlingVotes: number;
  geselleVotes: number;
  meisterVotes: number;
  pctLehrling: number;
  pctGeselle: number;
  pctMeister: number;
  suggestedRank: string | null;
  hasRedCardDemotion: boolean;
  confirmedRank: string | null;
  redCards: number;
  yellowCards: number;
  note: string;
}

export interface ConferenceExportClass {
  className: string;
  kvInfo: string;
  totalPupils: number;
  totalClassTeachers: number;
  confirmedCount: number;
  openDecisionCount: number;
  lehrlingCount: number;
  geselleCount: number;
  meisterCount: number;
  pctLehrling: number;
  pctGeselle: number;
  pctMeister: number;
  pupils: ConferenceExportPupil[];
}

export interface ConferenceExportOptions {
  classes: ConferenceExportClass[];
  filterLabel: string;
  generatedAt: string;
}

/** Escapes text for safe interpolation into HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Participation cell for the export table: submitted teachers over the class's
 * eligible teachers, with the rounded share (e.g. "3/7 (43 %)"). Without
 * eligible teachers the cell shows a dash instead of a misleading 0 %.
 */
export function formatParticipation(submittedTeachers: number, eligibleTeachers: number): string {
  if (eligibleTeachers <= 0) return '—';
  const pct = Math.round((submittedTeachers / eligibleTeachers) * 100);
  return `${submittedTeachers}/${eligibleTeachers} (${pct} %)`;
}

function voteBar(pupil: ConferenceExportPupil): string {
  const total = pupil.lehrlingVotes + pupil.geselleVotes + pupil.meisterVotes;
  if (total === 0) {
    return '<span class="muted">Keine Voten</span>';
  }
  const counts = [
    `${pupil.lehrlingVotes} L${pupil.pctLehrling > 0 ? ` (${pupil.pctLehrling}%)` : ''}`,
    `${pupil.geselleVotes} G${pupil.pctGeselle > 0 ? ` (${pupil.pctGeselle}%)` : ''}`,
    `${pupil.meisterVotes} M${pupil.pctMeister > 0 ? ` (${pupil.pctMeister}%)` : ''}`,
  ].join(' · ');
  return `
            <div class="votebar">
              <span class="rose" style="width:${pupil.pctLehrling}%"></span>
              <span class="blue" style="width:${pupil.pctGeselle}%"></span>
              <span class="amber" style="width:${pupil.pctMeister}%"></span>
            </div>
            <div class="votecounts">${counts}</div>`;
}

function pupilRow(pupil: ConferenceExportPupil): string {
  const suggestion = `${escapeHtml(pupil.suggestedRank ?? 'Ausstehend')}${pupil.hasRedCardDemotion ? ' (Rangabzug Karten)' : ''}`;
  const decision = pupil.confirmedRank
    ? `✓ ${escapeHtml(pupil.confirmedRank)}`
    : '○ Ausstehend';
  const cards = [
    pupil.redCards > 0 ? `<span class="card red">${pupil.redCards} rot</span>` : '',
    pupil.yellowCards > 0 ? `<span class="card yellow">${pupil.yellowCards} gelb</span>` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `
            <tr>
              <td class="num">${pupil.index}</td>
              <td class="name">${escapeHtml(pupil.name)}</td>
              <td>${escapeHtml(pupil.participation)}</td>
              <td class="votes">${voteBar(pupil)}</td>
              <td>${suggestion}</td>
              <td>${decision}</td>
              <td>${cards ? `${cards}<div class="note">${escapeHtml(pupil.note)}</div>` : `<div class="note">${escapeHtml(pupil.note)}</div>`}</td>
            </tr>`;
}

function classPage(cls: ConferenceExportClass, filterLabel: string, generatedAt: string): string {
  const pupilRows = cls.pupils.length
    ? cls.pupils.map((p) => pupilRow(p)).join('')
    : `<tr><td colspan="7" class="muted">Keine Schüler*innen in dieser Klasse eingetragen.</td></tr>`;
  return `
    <section class="page">
      <div>
        <header class="head">
          <div>
            <div class="brand">
              <span class="logo">SMILE</span>
              <span class="chip">MS Weissenbach</span>
              <span class="muted">· Schuljahr 2026/27</span>
            </div>
            <div class="classline">
              <h1>Klasse ${escapeHtml(cls.className)}</h1>
              <span class="badge">${escapeHtml(filterLabel)}</span>
            </div>
          </div>
          <div class="meta">
            <div><strong>Klassenvorstand:</strong> ${escapeHtml(cls.kvInfo)}</div>
            <div><strong>Schülerzahl:</strong> ${cls.totalPupils} · <strong>Lehrkräfte:</strong> ${cls.totalClassTeachers}</div>
            <div><strong>Stichtag:</strong> 30.10.2026 · <strong>Konferenz:</strong> 03.11.2026</div>
          </div>
        </header>

        <div class="stats">
          <div class="stats-title">
            Klassenstatistik (${cls.totalPupils} Schüler*innen · ${cls.confirmedCount} Beschlüsse bestätigt, ${cls.openDecisionCount} offen)
            <span class="muted">Stand: ${escapeHtml(generatedAt)}</span>
          </div>
          <div class="statgrid">
            <div class="stat rose-bg"><span>Lehrling</span><strong>${cls.lehrlingCount} (${cls.pctLehrling}%)</strong></div>
            <div class="stat blue-bg"><span>Geselle</span><strong>${cls.geselleCount} (${cls.pctGeselle}%)</strong></div>
            <div class="stat amber-bg"><span>Meister</span><strong>${cls.meisterCount} (${cls.pctMeister}%)</strong></div>
          </div>
          <div class="bar">
            <span class="rose" style="width:${cls.pctLehrling}%"></span>
            <span class="blue" style="width:${cls.pctGeselle}%"></span>
            <span class="amber" style="width:${cls.pctMeister}%"></span>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th class="num">Nr.</th>
              <th>Schüler*in</th>
              <th>Beteiligung</th>
              <th>Voten je Kategorie (Lehrkräfte)</th>
              <th>Vorschlag</th>
              <th>Konferenz-Beschluss</th>
              <th>Karten &amp; Anmerkung</th>
            </tr>
          </thead>
          <tbody>${pupilRows}
          </tbody>
        </table>
      </div>
      <footer class="sign">
        <span>Erstellt am: ${escapeHtml(generatedAt)} · SMILE Konferenzprotokoll</span>
        <span>Klassenvorstand/Konferenzleitung: ____________________</span>
      </footer>
    </section>`;
}

export function buildConferenceExportHtml(options: ConferenceExportOptions): string {
  const { classes, filterLabel, generatedAt } = options;
  const p = exportPalette;
  const pages = classes.map((cls) => classPage(cls, filterLabel, generatedAt)).join('');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Gesamtexport Konferenz (Alle Klassen)</title>
<style>
  @page { size: A4 portrait; margin: 6mm 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: ${p.ink};
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .page {
    page-break-after: always;
    break-after: page;
    break-inside: avoid;
    height: 275mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 4mm 0;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .muted { color: ${p.muted}; font-weight: 400; }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    border-bottom: 2px solid ${p.ink};
    padding-bottom: 6px;
    margin-bottom: 8px;
  }
  .brand { display: flex; align-items: center; gap: 8px; }
  .logo { font-weight: 800; font-size: 16px; letter-spacing: -0.02em; }
  .chip {
    font-size: 10.5px;
    padding: 1px 7px;
    border: 1px solid ${p.border};
    border-radius: 4px;
    background: ${p.surface};
    font-weight: 700;
    color: ${p.body};
  }
  .classline { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
  h1 { font-size: 17px; margin: 0; text-transform: uppercase; letter-spacing: -0.02em; }
  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 6px;
    font-weight: 700;
    background: ${p.badgeBg};
    color: ${p.badgeFg};
    border: 1px solid ${p.badgeBorder};
  }
  .meta { text-align: right; font-size: 10.5px; color: ${p.faint}; line-height: 1.45; }
  .stats {
    background: ${p.surfaceAlt};
    border: 1px solid ${p.border};
    border-radius: 10px;
    padding: 6px 8px;
    margin-bottom: 8px;
    font-size: 10.5px;
  }
  .stats-title { display: flex; justify-content: space-between; font-weight: 700; margin-bottom: 5px; }
  .statgrid { display: flex; gap: 6px; margin-bottom: 5px; }
  .stat {
    flex: 1;
    border: 1px solid ${p.border};
    border-radius: 6px;
    padding: 3px 6px;
    display: flex;
    justify-content: space-between;
  }
  .rose-bg { background: ${p.roseBg}; }
  .blue-bg { background: ${p.blueBg}; }
  .amber-bg { background: ${p.amberBg}; }
  .bar, .votebar {
    display: flex;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    background: ${p.track};
  }
  .votebar { height: 5px; margin-bottom: 2px; }
  .bar span, .votebar span { display: block; height: 100%; }
  .rose { background: ${p.rose}; }
  .blue { background: ${p.blue}; }
  .amber { background: ${p.amber}; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th, td { border: 1px solid ${p.border}; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: ${p.surface}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.02em; }
  .num { width: 4%; text-align: center; }
  .name { font-weight: 700; }
  .votes { width: 17%; }
  .votecounts { font-size: 9.5px; color: ${p.faint}; }
  .note { font-size: 9.5px; color: ${p.faint}; margin-top: 2px; }
  .card {
    display: inline-block;
    font-size: 9px;
    padding: 0 5px;
    border-radius: 4px;
    font-weight: 700;
    margin-right: 3px;
  }
  .card.red { background: ${p.roseCardBg}; color: ${p.roseCardFg}; border: 1px solid ${p.roseCardBorder}; }
  .card.yellow { background: ${p.amberCardBg}; color: ${p.amberCardFg}; border: 1px solid ${p.amberCardBorder}; }
  .sign {
    display: flex;
    justify-content: space-between;
    border-top: 1px solid ${p.border};
    padding-top: 5px;
    font-size: 10px;
    color: ${p.faint};
  }
</style>
</head>
<body>${pages}
</body>
</html>
`;
}
