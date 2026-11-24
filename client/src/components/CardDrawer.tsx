import React, { useEffect, useRef, useState } from 'react';
import { Award, AlertTriangle, RotateCcw, Check, X } from 'lucide-react';
import { issueCard, revokeCard } from '../services/api';
import { Dialog } from './ui';
import { useToast } from './Toast';

interface CardDrawerProps {
  pupilId: number;
  classId: number;
  pupilName: string;
  onCardUpdated: () => void;
  onClose: () => void;
}

export const CardDrawer: React.FC<CardDrawerProps> = ({
  pupilId,
  classId,
  pupilName,
  onCardUpdated,
  onClose,
}) => {
  const [note, setNote] = useState('');
  const [undoCardId, setUndoCardId] = useState<string | null>(null);
  const [undoCountdown, setUndoCountdown] = useState<number | null>(null);
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
  }, []);

  const handleIssue = async (type: 'green' | 'yellow') => {
    setLoading(true);
    try {
      const res = await issueCard(pupilId, classId, type, note);
      onCardUpdated();
      setNote('');

      // Set 5-second undo buffer
      setUndoCardId(res.card.id);
      setUndoCountdown(5);

      // Only one undo window may be active. Replacing the reference without
      // clearing the old timer let the first card clear the second card's window.
      if (undoTimerRef.current) clearInterval(undoTimerRef.current);
      const interval = setInterval(() => {
        setUndoCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(interval);
            if (undoTimerRef.current === interval) undoTimerRef.current = null;
            setUndoCardId(null);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
      undoTimerRef.current = interval;
    } catch (e: any) {
      toast.error(e.message || 'Karte konnte nicht vergeben werden');
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async () => {
    if (!undoCardId) return;
    try {
      await revokeCard(undoCardId);
      if (undoTimerRef.current) {
        clearInterval(undoTimerRef.current);
        undoTimerRef.current = null;
      }
      setUndoCardId(null);
      setUndoCountdown(null);
      onCardUpdated();
      toast.success('Karte zurückgezogen.');
    } catch (e: any) {
      toast.error(e.message || 'Rückgängig machen fehlgeschlagen');
    }
  };

  return (
    <Dialog
      onClose={onClose}
      align="sheet"
      labelledBy="card-drawer-title"
      panelClassName="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg relative animate-modal-in"
    >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 id="card-drawer-title" className="text-lg font-bold text-slate-50">Karte vergeben</h3>
            <p className="text-sm text-amber-400 font-medium">{pupilName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-50 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Undo Toast */}
        {undoCardId && undoCountdown !== null && (
          <div className="mb-4 p-3.5 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-between animate-pulse">
            <span className="text-sm font-semibold">Karte gespeichert ({undoCountdown}s)</span>
            <button
              onClick={handleUndo}
              className="px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm flex items-center gap-1.5 shadow"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Rückgängig</span>
            </button>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Notiz (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z.B. Vorbildliche Hilfsbereitschaft / Störung"
            className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleIssue('green')}
            disabled={loading}
            className="h-16 rounded-2xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 font-bold flex flex-col items-center justify-center gap-1 active:scale-[0.98] transition disabled:opacity-50"
          >
            <Award className="w-6 h-6 text-emerald-400" />
            <span className="text-sm">Grüne Karte (Lob)</span>
          </button>

          <button
            onClick={() => handleIssue('yellow')}
            disabled={loading}
            className="h-16 rounded-2xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 font-bold flex flex-col items-center justify-center gap-1 active:scale-[0.98] transition disabled:opacity-50"
          >
            <AlertTriangle className="w-6 h-6 text-amber-400" />
            <span className="text-sm">Gelbe Karte (Mahnung)</span>
          </button>
        </div>
    </Dialog>
  );
};
