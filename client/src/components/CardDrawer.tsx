import React, { useState } from 'react';
import { Award, AlertTriangle, RotateCcw, Check, X } from 'lucide-react';
import { issueCard, revokeCard } from '../services/api';

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
  const [loading, setLoading] = useState(false);

  const handleIssue = async (type: 'green' | 'yellow') => {
    setLoading(true);
    try {
      const res = await issueCard(pupilId, classId, type, note);
      onCardUpdated();
      setNote('');

      // Set 5-second undo buffer
      setUndoCardId(res.card.id);
      setUndoCountdown(5);

      const interval = setInterval(() => {
        setUndoCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(interval);
            setUndoCardId(null);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (e) {
      alert('Karte konnte nicht vergeben werden');
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async () => {
    if (!undoCardId) return;
    try {
      await revokeCard(undoCardId);
      setUndoCardId(null);
      setUndoCountdown(null);
      onCardUpdated();
    } catch (e) {
      alert('Rückgängig machen fehlgeschlagen');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">Karte vergeben</h3>
            <p className="text-sm text-amber-400 font-medium">{pupilName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Undo Toast */}
        {undoCardId && undoCountdown !== null && (
          <div className="mb-4 p-3.5 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-between animate-pulse">
            <span className="text-xs font-semibold">Karte gespeichert ({undoCountdown}s)</span>
            <button
              onClick={handleUndo}
              className="px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Rückgängig</span>
            </button>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Notiz (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z.B. Vorbildliche Hilfsbereitschaft / Störung"
            className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleIssue('green')}
            disabled={loading}
            className="h-16 rounded-2xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 font-bold flex flex-col items-center justify-center gap-1 active:scale-[0.98] transition disabled:opacity-50"
          >
            <Award className="w-6 h-6 text-emerald-400" />
            <span className="text-xs">Grüne Karte (Lob)</span>
          </button>

          <button
            onClick={() => handleIssue('yellow')}
            disabled={loading}
            className="h-16 rounded-2xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 font-bold flex flex-col items-center justify-center gap-1 active:scale-[0.98] transition disabled:opacity-50"
          >
            <AlertTriangle className="w-6 h-6 text-amber-400" />
            <span className="text-xs">Gelbe Karte (Mahnung)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
