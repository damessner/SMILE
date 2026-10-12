import React from 'react';
import { BookOpen, CheckCircle2, Clock, RotateCcw, Sparkles } from 'lucide-react';
import { getRankVisuals } from '../../lib/conferenceEvidence';
import { scoreSubject, type AssessmentRank } from '../../lib/pupilItems';
import type { PupilWithData } from '../../types';
import type { HoursInfo } from './helpers';
import type { GridSubject } from './types';

interface PupilHeaderProps {
  pupil: PupilWithData;
  mySubjects: GridSubject[];
  mySubject: GridSubject;
  isAllSubjectsMode: boolean;
  rubricItemKeys: string[];
  rank: AssessmentRank | null;
  rankColor: string;
  isSubmitted: boolean;
  showReopen: boolean;
  canWrite: boolean;
  isLockedByConference: boolean;
  isPastDeadline: boolean;
  currentHoursInfo: HoursInfo | null;
  isSaving: boolean;
  lastSavedTime: Date | null;
  ratingSaveError: string | null;
  onSubmit: () => void;
  onReopen: () => void;
  onReset: () => void;
}

export const PupilHeader: React.FC<PupilHeaderProps> = ({
  pupil,
  mySubjects,
  mySubject,
  isAllSubjectsMode,
  rubricItemKeys,
  rank,
  rankColor,
  isSubmitted,
  showReopen,
  canWrite,
  isLockedByConference,
  isPastDeadline,
  currentHoursInfo,
  isSaving,
  lastSavedTime,
  ratingSaveError,
  onSubmit,
  onReopen,
  onReset,
}) => {
  return (
    /* Pupil Header */
    <div className="pb-3 border-b border-slate-800 mb-3 shrink-0 space-y-2.5">
      {/* Row 1: Identity & Primary Actions */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-50 truncate" title={pupil.fullName}>
            {pupil.fullName}
          </h2>
          {isAllSubjectsMode ? (
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
              {mySubjects.map((s) => {
                const scored = scoreSubject(pupil.evaluations, s.code, rubricItemKeys);
                const sRank = scored.rank ?? 'Ausstehend';
                const color = getRankVisuals(scored.rank).badgeBg;
                return (
                  <span
                    key={s.code}
                    className={`px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider border shrink-0 ${color}`}
                  >
                    {s.code}: {sRank}
                  </span>
                );
              })}
            </div>
          ) : (
            <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider border shrink-0 ${rankColor}`}>
              {rank ?? 'Ausstehend'}
            </span>
          )}

          {isSubmitted && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>Eingereicht</span>
              </span>
              {showReopen && (
                <button
                  onClick={onReopen}
                  className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-50 border border-slate-700 text-[10px] font-bold transition flex items-center gap-1"
                  title="Einreichung zurücknehmen und Bewertung weiter bearbeiten"
                >
                  <RotateCcw className="w-3 h-3 text-amber-400" />
                  <span>Wieder öffnen</span>
                </button>
              )}
              <span className="text-[10px] text-slate-400">Erst zurücknehmen, um zu ändern.</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Submit Ranking Button */}
          <button
            onClick={onSubmit}
            disabled={!canWrite || isLockedByConference || isPastDeadline}
            title="Ranking einreichen und zum nächsten Schüler wechseln"
            className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-md transition active:scale-95 disabled:opacity-40 shrink-0 ${
              isSubmitted
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                : 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 shadow-sm'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{isSubmitted ? 'Erneut einreichen' : 'Ranking einreichen'}</span>
          </button>
        </div>
      </div>

      {/* Row 2: Metadata Chips & Instant-Rank Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Metadata Chips */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Prominent Subject Badge */}
          <div
            className={`px-2.5 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border shadow-sm ${
              isAllSubjectsMode
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : mySubject.isCoreSmile
                ? 'bg-amber-400/15 text-amber-300 border-amber-400/30'
                : 'bg-sky-400/15 text-sky-300 border-sky-400/30'
            }`}
            title={
              isAllSubjectsMode
                ? `Gesamtbewertung für alle deine Fächer: ${mySubjects.map((s) => s.code).join(', ')}`
                : `Aktuelles Bewertungsfach: ${mySubject.name} (${mySubject.code})`
            }
          >
            {isAllSubjectsMode ? <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <BookOpen className="w-3.5 h-3.5 opacity-80 shrink-0" />}
            <span>{isAllSubjectsMode ? '🌟 Gesamtbewertung' : mySubject.name}</span>
            <span className="font-mono text-[10px] opacity-75">
              [{isAllSubjectsMode ? mySubjects.map((s) => s.code).join(' + ') : mySubject.code}]
            </span>
          </div>

          {/* Autosave Status Badge */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs shadow-sm transition-all"
            title="Automatisches Speichern: Alle Bewertungen und Eingaben werden sofort gesichert."
          >
            {ratingSaveError ? (
              <span role="alert" className="text-rose-300 font-medium text-[11px]">
                Speichern fehlgeschlagen: {ratingSaveError}
              </span>
            ) : isSaving ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
                <span className="text-amber-300 font-medium text-[11px]">Wird gesichert...</span>
              </>
            ) : lastSavedTime ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-emerald-300 font-medium text-[11px]">
                  Gesichert ({lastSavedTime.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                </span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400/80 shrink-0" />
                <span className="text-slate-400 text-[11px]">Auto-Save aktiv</span>
              </>
            )}
          </div>

          {/* Weekly Lessons & Voting Weight Infochip */}
          {currentHoursInfo && (
            <div
              className="px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-slate-950/70 border border-slate-800 text-slate-300 flex items-center gap-1.5 shadow-sm"
              title={`Wochenstunden: ${currentHoursInfo.hours}h · Stimmgewicht in Konferenz: ${currentHoursInfo.weight}${currentHoursInfo.isTeamTeaching ? ' (Team-Teaching Kernfach x2)' : ''}`}
            >
              <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{currentHoursInfo.hours}h/Woche</span>
              <span className="text-slate-600">·</span>
              <span className="text-amber-300 font-bold">Gewicht: {currentHoursInfo.weight}</span>
              {currentHoursInfo.isTeamTeaching && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                  Team-Teaching (x2)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Reset Button */}
        <button
          type="button"
          onClick={onReset}
          disabled={!canWrite || isLockedByConference || isPastDeadline || isSubmitted}
          title="Alle 18 Bewertungen leeren / zurücksetzen"
          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-50 border border-slate-700 text-xs font-bold transition active:scale-95 flex items-center gap-1 disabled:opacity-40"
        >
          <RotateCcw className="w-3 h-3 text-amber-400" />
          <span>Reset</span>
        </button>
      </div>
    </div>
  );
};
