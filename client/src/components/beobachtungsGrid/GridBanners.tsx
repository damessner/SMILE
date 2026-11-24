import React from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import type { ConflictEvent } from '../../hooks/useLiveSync';
import type { SubmitNotice } from './types';

interface SubmitToastBannerProps {
  notice: SubmitNotice;
  onDismiss: () => void;
}

export const SubmitToastBanner: React.FC<SubmitToastBannerProps> = ({ notice, onDismiss }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900/95 border border-emerald-500/50 shadow-2xl backdrop-blur-md text-slate-100 text-sm animate-fade-in fade-in slide-in-from-top-4 duration-300"
    >
      <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
        <CheckCircle2 className="w-5 h-5" />
      </div>
      <div>
        <p className="font-bold text-slate-100 leading-tight">
          {notice.pendingSubjects ? (
            <>
              <span className="text-amber-300">{notice.pupilName}</span>{' '}
              {notice.submittedAny ? 'teilweise eingereicht' : 'noch offen'}
            </>
          ) : (
            <>
              <span className="text-emerald-300">{notice.pupilName}</span> erfolgreich eingereicht!
            </>
          )}
        </p>
        <p className="text-sm text-slate-400 mt-0.5">
          {notice.pendingSubjects ? (
            <span>Offen: {notice.pendingSubjects.join(', ')}. Bitte ergänzen und erneut einreichen.</span>
          ) : notice.allDone ? (
            <span className="text-amber-300 font-bold">🎉 Alle Schüler dieser Klasse sind jetzt bewertet!</span>
          ) : (
            <span>
              ➔ Automatisch weiter zu: <strong className="text-amber-300">{notice.nextPupilName}</strong>
            </span>
          )}
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition ml-2"
        title="Schließen"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

interface ConflictBannerProps {
  conflict: ConflictEvent;
  onClear: () => void;
}

export const ConflictBanner: React.FC<ConflictBannerProps> = ({ conflict, onClear }) => {
  return (
    <div className="fixed top-20 right-6 z-50 max-w-md p-4 rounded-2xl bg-amber-500 text-slate-950 font-bold shadow-lg flex items-center justify-between gap-3 animate-bounce">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span className="text-sm">{conflict.message}</span>
      </div>
      <button
        onClick={onClear}
        className="px-2.5 py-1 rounded-lg bg-slate-950 text-slate-50 text-sm hover:bg-slate-800"
      >
        OK
      </button>
    </div>
  );
};
