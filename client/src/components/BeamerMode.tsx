import React, { useEffect, useState } from 'react';
import { Lock, Unlock, Gavel, X, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { getConferenceSummary, lockVoting, conferenceOverride } from '../services/api';
import { useToast } from './Toast';
import { formatSubjectEvidence } from '../lib/conferenceEvidence';

interface BeamerModeProps {
  classId: number;
  className: string;
  onClose: () => void;
}

export const BeamerMode: React.FC<BeamerModeProps> = ({ classId, className, onClose }) => {
  const [data, setData] = useState<any>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [overrideModal, setOverrideModal] = useState<{ pupilId: number; name: string; currentRank: string } | null>(null);
  const [overrideRank, setOverrideRank] = useState('Geselle');
  const [overrideReason, setOverrideReason] = useState('Beschluss der Klassenkonferenz');
  const toast = useToast();

  const loadData = async () => {
    try {
      const res = await getConferenceSummary(classId);
      setData(res);
      setIsLocked(res.isLocked ?? res.round?.isLocked ?? false);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Poll every 5s during live conference
    return () => clearInterval(interval);
  }, [classId]);

  const handleToggleLock = async () => {
    try {
      const next = !isLocked;
      await lockVoting(classId, next);
      setIsLocked(next);
      toast.success(next ? 'Abstimmung gesperrt.' : 'Abstimmung freigegeben.');
    } catch (e: any) {
      toast.error(e.message || 'Sperrstatus konnte nicht geändert werden');
    }
  };

  const handleSaveOverride = async () => {
    if (!overrideModal) return;
    try {
      await conferenceOverride(classId, overrideModal.pupilId, overrideRank, overrideReason);
      setOverrideModal(null);
      await loadData();
      toast.success('Konferenzbeschluss gespeichert.');
    } catch (e: any) {
      toast.error(e.message || 'Konferenzbeschluss fehlgeschlagen');
    }
  };

  if (loading || !data) {
    return (
      <div data-force-dark data-mode="beamer" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 text-slate-50">
        <RefreshCw className="w-8 h-8 animate-spin text-amber-400" />
      </div>
    );
  }

  return (
    <div data-force-dark data-mode="beamer" className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-50 p-6 overflow-hidden select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
        <div>
          <span className="text-sm uppercase tracking-widest text-amber-400 font-bold">
            Beamer & Konferenz-Modus
          </span>
          <h1 className="text-4xl font-black tracking-tight">Klasse {className}</h1>
          <p className="text-sm text-slate-400">
            {data.summary.length} Schüler/innen · {data.round?.name || 'Aktiver Zeitraum'}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Lock Switch */}
          <button
            onClick={handleToggleLock}
            className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border transition ${
              isLocked
                ? 'bg-red-500/20 text-red-400 border-red-500/40 hover:bg-red-500/30'
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30'
            }`}
          >
            {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            <span>{isLocked ? 'Abstimmung GESPERRT' : 'Abstimmung OFFEN'}</span>
          </button>

          <button
            onClick={onClose}
            className="p-2.5 rounded-xl bg-slate-800 text-slate-400 hover:text-slate-50 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Grid of Pupils */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.summary.map((p: any) => {
            const isMeister = p.finalRank === 'Meister';
            const isGeselle = p.finalRank === 'Geselle';

            return (
              <div
                key={p.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between gap-4 shadow-lg"
              >
                <div className="min-w-0">
                  <h3 className="font-bold text-xl text-slate-50 mb-1 truncate">{p.fullName}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                    <span>
                      Raster: <strong className="text-amber-400">{formatSubjectEvidence(p.subjectEvidence)}</strong>
                    </span>
                    {p.isConfirmed && (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Konferenz
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-3.5 py-2 rounded-xl text-sm font-black uppercase tracking-wider ${
                      isMeister
                        ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                        : isGeselle
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    }`}
                  >
                    {p.finalRank}
                  </span>

                  <button
                    onClick={() =>
                      setOverrideModal({
                        pupilId: p.id,
                        name: p.fullName,
                        currentRank: p.finalRank,
                      })
                    }
                    title="Konferenzbeschluss / Überstimmen"
                    className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                  >
                    <Gavel className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Override Modal */}
      {overrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center scrim backdrop-blur-md p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg">
            <h3 className="text-lg font-bold text-slate-50 mb-1">Konferenzbeschluss</h3>
            <p className="text-sm text-amber-400 mb-4">{overrideModal.name}</p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Endgültiger Status
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { rank: 'Lehrling', active: 'bg-rose-500 text-slate-50' },
                    { rank: 'Geselle', active: 'bg-blue-500 text-slate-50' },
                    { rank: 'Meister', active: 'bg-amber-400 text-slate-950 font-bold' },
                  ].map((btn) => (
                    <button
                      key={btn.rank}
                      onClick={() => setOverrideRank(btn.rank)}
                      className={`py-2.5 rounded-xl font-bold text-sm transition ${
                        overrideRank === btn.rank
                          ? btn.active
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {btn.rank}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Begründung / Protokollnotiz
                </label>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-50 text-sm"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setOverrideModal(null)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm transition"
              >
                Abbrechen
              </button>
              <button
                onClick={handleSaveOverride}
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition"
              >
                Beschluss sichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
