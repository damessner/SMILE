import React from 'react';
import type { SoftLock } from '../../hooks/useLiveSync';

// 5 Smileys buttons
const RATING_BUTTONS = [
  {
    val: 'crown',
    label: (
      <div className="flex flex-col items-center justify-center leading-none gap-0.5">
        <span className="text-2xs leading-none">👑</span>
        <span className="text-sm leading-none">😊</span>
      </div>
    ),
    activeBg: 'bg-amber-400 text-slate-950 font-bold shadow-md scale-105 border-2 border-amber-300 ring-2 ring-amber-400/40',
    title: 'Hervorragend (Krone)',
  },
  {
    val: 'smile',
    label: <span className="text-lg leading-none">😊</span>,
    activeBg: 'bg-emerald-500 text-slate-950 font-bold shadow-md scale-105 border-2 border-emerald-300 ring-2 ring-emerald-500/40',
    title: 'Gut (😊)',
  },
  {
    val: 'struggle',
    label: <span className="text-lg leading-none">😖</span>,
    activeBg: 'bg-amber-500 text-slate-950 font-bold shadow-md scale-105 border-2 border-amber-300 ring-2 ring-amber-500/40',
    title: 'Mit Mühe (😖)',
  },
  {
    val: 'sad',
    label: <span className="text-lg leading-none">😢</span>,
    activeBg: 'bg-rose-500 text-slate-50 font-bold shadow-md scale-105 border-2 border-rose-300 ring-2 ring-rose-500/40',
    title: 'Traurig (😢)',
  },
  {
    val: 'newstart',
    label: <span className="text-lg leading-none">🔄</span>,
    activeBg: 'bg-sky-500 text-slate-950 font-bold shadow-md scale-105 border-2 border-sky-300 ring-2 ring-sky-500/40',
    title: 'Neustart (🔄)',
  },
];

function isRatingActive(val: string, currentRating: string | undefined): boolean {
  return currentRating === val ||
    (val === 'crown' && currentRating === '++') ||
    (val === 'smile' && currentRating === '+') ||
    (val === 'struggle' && (currentRating === 'strain' || currentRating === 'o')) ||
    (val === 'sad' && currentRating === '-') ||
    (val === 'newstart' && currentRating === 'restart');
}

interface CriterionItemCellProps {
  itemKey: string;
  description?: string;
  currentRating?: string;
  softLock?: SoftLock;
  writeBlocked: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onSelectRating: (rating: string) => void;
}

const KEYBOARD_RATING_MAP: Record<string, string> = {
  '1': 'crown',
  '2': 'smile',
  '3': 'struggle',
  '4': 'sad',
  '5': 'newstart',
  '0': '',
  Backspace: '',
  Delete: '',
};

export const CriterionItemCell: React.FC<CriterionItemCellProps> = ({
  itemKey,
  description,
  currentRating,
  softLock,
  writeBlocked,
  onFocus,
  onBlur,
  onSelectRating,
}) => {
  const isLocked = writeBlocked || !!softLock;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isLocked || e.ctrlKey || e.metaKey || e.altKey) return;
    if (Object.prototype.hasOwnProperty.call(KEYBOARD_RATING_MAP, e.key)) {
      e.preventDefault();
      onSelectRating(KEYBOARD_RATING_MAP[e.key]!);
    }
  };

  return (
    <div
      tabIndex={isLocked ? -1 : 0}
      onKeyDown={handleKeyDown}
      className={`crit-cell bg-slate-900 border rounded-xl p-2.5 @md:p-3 flex flex-col justify-between transition focus-ring ${
        softLock
          ? 'border-amber-400/50 bg-amber-500/5'
          : 'border-slate-800/80 hover:border-slate-700'
      }`}
    >
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-2xs font-bold text-slate-500 uppercase tracking-wider">
            {itemKey}
          </span>
          {softLock && (
            <span className="text-2xs text-amber-400 animate-pulse font-bold flex items-center gap-1">
              <span>✏️</span>
              <span>{softLock.teacherShort || softLock.teacherName} tippt...</span>
            </span>
          )}
        </div>
        <p
          className="crit-desc text-2xs @sm:text-sm text-slate-300 font-medium leading-snug mb-2 line-clamp-2 hover:line-clamp-none transition-all cursor-default"
          title={description}
        >
          {description}
        </p>
      </div>

      {/* Smileys Row */}
      <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-slate-800/60">
        {RATING_BUTTONS.map((btn) => {
          const isActive = isRatingActive(btn.val, currentRating);

          return (
            <button
              key={btn.val}
              type="button"
              disabled={isLocked}
              title={btn.title} aria-label={btn.title} aria-pressed={isActive}
              onFocus={onFocus}
              onBlur={onBlur}
              onClick={() => {
                // Tapping the active button deselects it to blank!
                const nextVal = isActive ? '' : btn.val;
                onSelectRating(nextVal);
              }}
              className={`flex-1 min-w-0 max-w-[40px] pointer-coarse:max-w-[44px] h-8 sm:h-8.5 pointer-coarse:h-11 rounded-lg flex items-center justify-center transition active:scale-90 disabled:opacity-40 ${
                isActive
                  ? btn.activeBg
                  : 'bg-slate-800/80 hover:bg-slate-700/80 hover:scale-105 border border-slate-700/60 text-slate-300'
              }`}
            >
              {btn.label}
            </button>
          );
        })}

        {/* Reset / Deselect Button (Explicit Blank) */}
        {currentRating && currentRating !== 'n.b.' && currentRating !== '' && (
          <button
            type="button"
            disabled={isLocked}
            title="Bewertung löschen (Leer)" aria-label="Bewertung löschen"
            onClick={() => onSelectRating('')}
            className="w-6 h-6 pointer-coarse:w-9 pointer-coarse:h-9 rounded-md bg-slate-800/40 hover:bg-rose-500/20 text-slate-500 hover:text-rose-300 border border-slate-700/40 flex items-center justify-center text-2xs font-bold transition ml-0.5"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};
