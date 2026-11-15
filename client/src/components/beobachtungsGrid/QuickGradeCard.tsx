import React from 'react';
import { Check, CheckCircle2, Sparkles } from 'lucide-react';
import type { AssessmentRank } from '../../lib/pupilItems';
import type { GridSubject } from './types';

const QUICK_GRADE_OPTIONS = [
  {
    rank: 'Lehrling' as const,
    label: 'Lehrling',
    dot: 'bg-rose-500',
    border: 'border-rose-500/30 hover:border-rose-500/60',
    active: 'bg-rose-500/20 border-rose-500 text-rose-200 ring-2 ring-rose-500/50 shadow-md',
    desc: 'Starke Unterstützung nötig / Basis',
  },
  {
    rank: 'Geselle' as const,
    label: 'Geselle',
    dot: 'bg-blue-500',
    border: 'border-blue-500/30 hover:border-blue-500/60',
    active: 'bg-blue-500/20 border-blue-500 text-blue-200 ring-2 ring-blue-500/50 shadow-md',
    desc: 'Solide Leistungen / Regelstandard',
  },
  {
    rank: 'Meister' as const,
    label: 'Meister',
    dot: 'bg-amber-400',
    border: 'border-amber-400/30 hover:border-amber-400/60',
    active: 'bg-amber-400/20 border-amber-400 text-amber-200 ring-2 ring-amber-400/50 shadow-md',
    desc: 'Eigenständig / Spitzenleistung',
  },
];

interface QuickGradeCardProps {
  votedRank: AssessmentRank | null;
  saveSuccessMsg: string | null;
  isAllSubjectsMode: boolean;
  mySubjects: GridSubject[];
  disabled: boolean;
  autoAdvance?: boolean;
  onToggleAutoAdvance?: (next: boolean) => void;
  onQuickGrade: (rank: AssessmentRank) => void;
}

export const QuickGradeCard: React.FC<QuickGradeCardProps> = ({
  votedRank,
  saveSuccessMsg,
  isAllSubjectsMode,
  mySubjects,
  disabled,
  autoAdvance,
  onToggleAutoAdvance,
  onQuickGrade,
}) => {
  return (
    <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 sm:p-4 shadow-sm space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Schnellbewertung (1-Klick)</span>
        </span>
        <div className="flex items-center gap-3">
          {saveSuccessMsg && (
            <span className="text-emerald-400 text-[11px] font-bold flex items-center gap-1 animate-fadeIn">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{saveSuccessMsg}</span>
            </span>
          )}
          {onToggleAutoAdvance && (
            <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(autoAdvance)}
                onChange={(e) => onToggleAutoAdvance(e.target.checked)}
                className="h-3.5 w-3.5 accent-amber-400 rounded"
              />
              <span>Auto-Weiter</span>
            </label>
          )}
        </div>
      </div>
      {isAllSubjectsMode && (
        <p className="text-[11px] text-amber-400/80">
          Gilt für alle Fächer: {mySubjects.map((subject) => subject.name).join(' · ')}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {QUICK_GRADE_OPTIONS.map((opt) => {
          // The quick-grade cards represent an explicit teacher proposal.
          // A card is only selected when the teacher explicitly clicked it,
          // or when a manual proposal already exists on the record.
          // An unrated pupil starts clean with no prior selection.
          const isSelected = votedRank === opt.rank;
          return (
            <button
              key={opt.rank}
              type="button"
              disabled={disabled}
              onClick={() => void onQuickGrade(opt.rank)}
              className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between min-h-[82px] active:scale-98 ${
                isSelected
                  ? opt.active
                  : `bg-slate-900/60 ${opt.border} text-slate-300 hover:bg-slate-900`
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${opt.dot}`} />
                  <span className="font-bold text-sm text-slate-50">{opt.label}</span>
                </div>
                {isSelected && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[11px] font-bold border border-emerald-500/30 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Gewählt
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-400 mt-2 block">
                {opt.desc}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
