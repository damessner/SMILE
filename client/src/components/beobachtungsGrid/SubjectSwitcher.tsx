import React from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import type { GridSubject } from './types';

interface SubjectSwitcherProps {
  mySubjects: GridSubject[];
  isAllSubjectsMode: boolean;
  activeSubjectCode: string;
  onSelectSubject: (code: string) => void;
}

export const SubjectSwitcher: React.FC<SubjectSwitcherProps> = ({
  mySubjects,
  isAllSubjectsMode,
  activeSubjectCode,
  onSelectSubject,
}) => {
  return (
    /* Multi-Subject Segmented Switcher Bar (Direct Quick-Switch) */
    <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/80 rounded-2xl border border-slate-800 shrink-0 mb-3 shadow-sm overflow-x-auto no-scrollbar">
      <span className="text-2xs font-bold text-slate-400 px-2 flex items-center gap-1.5 shrink-0">
        <BookOpen className="w-3.5 h-3.5 text-amber-400" />
        <span>Fachauswahl:</span>
      </span>
      <button
        type="button"
        onClick={() => onSelectSubject('__ALL__')}
        className={`px-3 py-1.5 rounded-xl font-bold text-sm flex items-center gap-1.5 transition active:scale-95 shrink-0 ${
          isAllSubjectsMode
            ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold ring-1 ring-amber-400'
            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>🌟 Gesamt (alle {mySubjects.length} Fächer)</span>
      </button>
      {mySubjects.map((s) => {
        const isActive = activeSubjectCode === s.code;
        return (
          <button
            key={s.code}
            type="button"
            onClick={() => onSelectSubject(s.code)}
            className={`px-3 py-1.5 rounded-xl font-bold text-sm flex items-center gap-1.5 transition active:scale-95 shrink-0 ${
              isActive
                ? s.isCoreSmile
                  ? 'bg-amber-400 text-slate-950 shadow-md font-extrabold ring-1 ring-amber-300'
                  : 'bg-sky-400 text-slate-950 shadow-md font-extrabold ring-1 ring-sky-300'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <span>{s.code}</span>
            <span className="text-2xs opacity-80 font-normal">({s.name})</span>
            {typeof s.hours === 'number' && s.hours > 0 && (
              <span
                className={`text-2xs px-1.5 py-0.5 rounded font-mono font-bold ${
                  isActive ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {s.hours}h
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
