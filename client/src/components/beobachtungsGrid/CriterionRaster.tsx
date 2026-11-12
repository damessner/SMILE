import React from 'react';
import { Crown } from 'lucide-react';
import type { SoftLock } from '../../hooks/useLiveSync';
import { findItemForSubjects } from '../../lib/pupilItems';
import type { PupilWithData, RubricCriterion } from '../../types';
import { CriterionItemCell } from './CriterionItemCell';

interface CriterionRasterProps {
  criteria: RubricCriterion[];
  pupil: PupilWithData;
  subjectCodes: string[];
  softLocks: Map<string, SoftLock>;
  writeBlocked: boolean;
  onQuickFill: (crit: RubricCriterion, rating: string) => void;
  onRateItem: (criterionId: string, itemKey: string, rating: string) => void;
  onItemFocus: (itemKey: string) => void;
  onItemBlur: (itemKey: string) => void;
}

export const CriterionRaster: React.FC<CriterionRasterProps> = ({
  criteria,
  pupil,
  subjectCodes,
  softLocks,
  writeBlocked,
  onQuickFill,
  onRateItem,
  onItemFocus,
  onItemBlur,
}) => {
  return (
    <div className="space-y-3">
      {criteria.map((crit) => (
        <div
          key={crit.id}
          className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3 sm:p-3.5 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-800/60">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                <span>{crit.name}</span>
              </h3>
            </div>

            {/* Category Quick Fill Buttons */}
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800/90 p-0.5 rounded-lg">
              <span className="text-[11px] text-slate-500 uppercase font-bold px-1 hidden sm:inline">Alle:</span>
              <button
                type="button"
                disabled={writeBlocked}
                onClick={() => onQuickFill(crit, 'crown')}
                title="Alle Merkmale dieser Kategorie mit Krone (👑) füllen" aria-label="Alle Merkmale dieser Kategorie mit Krone füllen"
                className="pressable focus-ring w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-amber-400/15 hover:bg-amber-400/30 text-amber-300 flex items-center justify-center transition disabled:opacity-30"
              >
                <Crown className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={writeBlocked}
                onClick={() => onQuickFill(crit, 'smile')}
                title="Alle Merkmale dieser Kategorie mit Gut (😊) füllen" aria-label="Alle Merkmale dieser Kategorie mit Gut füllen"
                className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 text-xs flex items-center justify-center transition disabled:opacity-30"
              >
                😊
              </button>
              <button
                type="button"
                disabled={writeBlocked}
                onClick={() => onQuickFill(crit, 'struggle')}
                title="Alle Merkmale dieser Kategorie mit Mühe (😖) füllen" aria-label="Alle Merkmale dieser Kategorie mit Mühe füllen"
                className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 text-xs flex items-center justify-center transition disabled:opacity-30"
              >
                😖
              </button>
              <button
                type="button"
                disabled={writeBlocked}
                onClick={() => onQuickFill(crit, 'sad')}
                title="Alle Merkmale dieser Kategorie mit Traurig (😢) füllen" aria-label="Alle Merkmale dieser Kategorie mit Traurig füllen"
                className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 text-xs flex items-center justify-center transition disabled:opacity-30"
              >
                😢
              </button>
              <button
                type="button"
                disabled={writeBlocked}
                onClick={() => onQuickFill(crit, 'newstart')}
                title="Alle Merkmale dieser Kategorie mit Neustart (🔄) füllen" aria-label="Alle Merkmale dieser Kategorie mit Neustart füllen"
                className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 text-xs flex items-center justify-center transition disabled:opacity-30"
              >
                🔄
              </button>
              <button
                type="button"
                disabled={writeBlocked}
                onClick={() => onQuickFill(crit, '')}
                title="Kategorie leeren" aria-label="Kategorie leeren"
                className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs flex items-center justify-center transition disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-2.5">
            {crit.items.map((it) => {
              // The rating shown here comes from the merged view of the subjects in scope, but
              // a write must carry the version of the subject it targets. In Gesamt mode each
              // subject's row has its own version, so sending one subject's version for all
              // of them makes the server's `UPDATE ... WHERE version = $4` match zero rows -
              // a conflict on cells nobody touched. Hence itemVersionForSubject in the grid.
              //
              // Scoped to the subjects in view: a pupil with no evaluation for the active
              // subject renders empty, and never another subject's ratings - which would
              // also be submitted as this subject's rank and sent with a foreign version.
              const itemData = findItemForSubjects(pupil.evaluations, subjectCodes, it.key);
              const currentRating = itemData?.rating;

              // Soft lock check
              const softLock = subjectCodes
                .map((subjectCode) => softLocks.get(`${subjectCode}|${pupil.id}|${it.key}`))
                .find((lock) => lock !== undefined);

              return (
                <CriterionItemCell
                  key={it.key}
                  itemKey={it.key}
                  description={it.desc || it.label}
                  currentRating={currentRating}
                  softLock={softLock}
                  writeBlocked={writeBlocked}
                  onFocus={() => onItemFocus(it.key)}
                  onBlur={() => onItemBlur(it.key)}
                  onSelectRating={(rating) => onRateItem(crit.id, it.key, rating)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
