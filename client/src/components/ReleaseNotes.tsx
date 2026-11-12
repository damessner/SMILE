import React from 'react';
import { ChevronRight, GraduationCap, History, Sparkles, X } from 'lucide-react';
import type { User } from '../types';
import { Dialog } from './ui';
import {
  LATEST_RELEASE,
  RELEASES,
  formatReleaseDate,
  type Release,
  type ReleaseNoteKind,
} from '../lib/releases';

const KIND_META: Record<ReleaseNoteKind, { label: string; className: string }> = {
  feature: { label: 'Neu', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  improvement: { label: 'Verbessert', className: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  fix: { label: 'Behoben', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  security: { label: 'Sicherheit', className: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

const ReleaseNoteList: React.FC<{ release: Release; dense?: boolean }> = ({ release, dense }) => (
  <ul className={dense ? 'space-y-1.5' : 'space-y-2.5'}>
    {release.notes.map((note, index) => {
      const meta = KIND_META[note.kind];
      return (
        <li key={`${release.version}-${index}`} className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.className}`}
          >
            {meta.label}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-snug text-slate-100">{note.title}</p>
            {note.text && (
              <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{note.text}</p>
            )}
          </div>
        </li>
      );
    })}
  </ul>
);

export interface WhatsNewDialogProps {
  currentUser: User;
  onClose: () => void;
  onOpenHistory: () => void;
}

/**
 * One-time notice after a release: the newest entry of `RELEASES`.
 *
 * Visibility is decided by the caller (App): the seen flag is written the moment
 * the dialog opens, so it shows exactly once per teacher and release.
 */
export const WhatsNewDialog: React.FC<WhatsNewDialogProps> = ({
  currentUser,
  onClose,
  onOpenHistory,
}) => {
  const release = LATEST_RELEASE;
  const displayName = currentUser.teacher?.fullName?.trim() || currentUser.username;

  return (
    <Dialog
      onClose={onClose}
      labelledBy="whats-new-title"
      panelClassName="w-full max-w-xl max-h-[90vh] overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl flex flex-col animate-modal-in"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-950/60 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/15 text-amber-400">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="whats-new-title" className="text-lg font-black leading-tight text-slate-50">
              Was ist neu in SMILE?
            </h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">
              Version {release.version} · {formatReleaseDate(release.date)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hinweis schließen"
          className="pressable focus-ring rounded-xl p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-50"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <p className="text-sm leading-relaxed text-slate-300">
          Hallo {displayName},
        </p>
        <p className="text-sm leading-relaxed text-slate-300">{release.summary}</p>
        <ReleaseNoteList release={release} />
        <p className="text-[11px] leading-relaxed text-slate-500">
          Dieser Hinweis erscheint nur einmal pro Update. Den vollständigen Versionsverlauf findest
          du jederzeit über das Fragezeichen (?) in der Kopfzeile.
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-slate-800 bg-slate-950/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onOpenHistory}
          className="pressable focus-ring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
        >
          <History className="h-4 w-4" aria-hidden="true" />
          <span>Alle Änderungen ansehen</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="pressable focus-ring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-black text-slate-950 shadow-md transition hover:bg-amber-400"
        >
          <span>Verstanden</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
};

export interface ReleaseHistoryModalProps {
  onClose: () => void;
  onStartTour: () => void;
}

/**
 * Help menu (?) content: the complete release history with every changelog entry,
 * plus the entry point to the onboarding tour.
 */
export const ReleaseHistoryModal: React.FC<ReleaseHistoryModalProps> = ({
  onClose,
  onStartTour,
}) => (
  <Dialog
    onClose={onClose}
    labelledBy="release-history-title"
    panelClassName="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl flex flex-col animate-modal-in"
  >
    <div className="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-950/60 px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-accent/30 bg-accent/15 text-accent">
          <History className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 id="release-history-title" className="text-lg font-black leading-tight text-slate-50">
            Hilfe &amp; Versionsverlauf
          </h2>
          <p className="mt-0.5 text-xs font-semibold text-slate-400">
            Alle Releases im Überblick · aktuell Version {LATEST_RELEASE.version}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Versionsverlauf schließen"
        className="pressable focus-ring rounded-xl p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-50"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>

    <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
      <p className="rounded-2xl border border-sky-500/25 bg-sky-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-sky-200">
        Tipp: Das Fragezeichen (?) oben rechts öffnet diesen Verlauf jederzeit. Die Einführungstour
        startest du unten.
      </p>

      {RELEASES.map((release, index) => (
        <section
          key={release.version}
          aria-label={`Version ${release.version}`}
          className={`rounded-2xl border p-4 ${
            index === 0
              ? 'border-amber-500/35 bg-amber-500/5'
              : 'border-slate-800 bg-slate-950/40'
          }`}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-lg border px-2 py-0.5 text-xs font-black ${
                index === 0
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300'
              }`}
            >
              v{release.version}
            </span>
            <span className="text-xs font-bold text-slate-400">
              {formatReleaseDate(release.date)}
            </span>
            {index === 0 && (
              <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                Aktuell
              </span>
            )}
          </div>
          <h3 className="text-base font-bold leading-tight text-slate-50">{release.title}</h3>
          <p className="mb-3 mt-1 text-xs leading-relaxed text-slate-400">{release.summary}</p>
          <ReleaseNoteList release={release} dense />
        </section>
      ))}
    </div>

    <div className="flex flex-col-reverse gap-2 border-t border-slate-800 bg-slate-950/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onStartTour}
        className="pressable focus-ring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
      >
        <GraduationCap className="h-4 w-4" aria-hidden="true" />
        <span>Einführung &amp; Tour starten</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        className="pressable focus-ring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-black text-slate-950 shadow-md transition hover:bg-amber-400"
      >
        <span>Schließen</span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </Dialog>
);
