import type { SchoolClass } from '../../types';

export interface ClassNavBarProps {
  classes: SchoolClass[];
  selectedClassId: number | null;
  currentClass: SchoolClass | null;
  pupilCount: number;
  onSelectClass: (classId: number) => void;
}

/** Class switcher sub-header shown on the Bewertung tab. */
export function ClassNavBar({ classes, selectedClassId, currentClass, pupilCount, onSelectClass }: ClassNavBarProps) {
  return (
        <nav
          aria-label="Klassenauswahl"
          data-tour="rating-classes"
          className="bg-slate-900/95 backdrop-blur-md border-b border-slate-800 sticky top-[53px] md:top-[61px] z-30 px-4 md:px-6 py-2.5 flex items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto py-0.5 no-scrollbar">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1 hidden sm:inline">
              Klassen:
            </span>
            {classes.map((cls) => {
              const isSelected = selectedClassId === cls.id;
              const subs = cls.mySubjects || [];
              return (
                <button
                  key={cls.id}
                  onClick={() => onSelectClass(cls.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`min-h-[40px] px-3.5 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-2 shrink-0 ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-md ring-2 ring-amber-400/50'
                      : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60'
                  }`}
                >
                  <span className="font-bold text-sm tracking-tight">{cls.name}</span>
                  {subs.length > 0 ? (
                    <div className="flex items-center gap-1">
                      {subs.map((s) => (
                        <span
                          key={s.code}
                          title={s.name}
                          className={`text-[11px] px-1.5 py-0.5 rounded-md font-bold tracking-wide transition ${
                            isSelected
                              ? 'bg-slate-950/20 text-slate-950'
                              : s.isCoreSmile
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          }`}
                        >
                          {s.code}
                        </span>
                      ))}
                    </div>
                  ) : cls.isKv ? (
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded-md font-bold ${
                        isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-purple-500/20 text-purple-300'
                      }`}
                    >
                      KV
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {currentClass && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-400 font-medium">
                {pupilCount} Schüler*innen
              </span>
            </div>
          )}
        </nav>
  );
}
