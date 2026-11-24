import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldAlert,
  Clock,
  PhoneCall,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  FileText,
  UserCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { getTimeoutEscalations, acknowledgeTimeoutEscalation } from '../services/api';
import { Dialog } from './ui/Dialog';

interface PendingEscalation {
  pupilId: number;
  pupilName: string;
  classId: number;
  className: string;
  milestoneCount: number;
  totalTimeouts: number;
  timeoutsHistory: Array<{
    id: string;
    sent_at: string;
    task_assignment: string;
    status: string;
    resolved_at?: string;
    sent_by_short: string;
  }>;
}

interface HandledEscalation {
  pupilId: number;
  pupilName: string;
  className: string;
  milestoneCount: number;
  handledAt: string;
  handledByShort: string;
  handledByName: string;
  notes?: string;
  totalTimeouts: number;
}

interface TimeoutEscalationModalProps {
  onClose: () => void;
  onUpdated?: () => void;
}

export const TimeoutEscalationModal: React.FC<TimeoutEscalationModalProps> = ({
  onClose,
  onUpdated,
}) => {
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingEscalation[]>([]);
  const [handled, setHandled] = useState<HandledEscalation[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'handled'>('pending');
  const [expandedPupilId, setExpandedPupilId] = useState<number | null>(null);
  const [notesInput, setNotesInput] = useState<Record<number, string>>({});
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTimeoutEscalations();
      setPending(res.pendingEscalations || []);
      setHandled(res.handledEscalations || []);
    } catch (e: any) {
      setError(e.message || 'Fehler beim Laden der Time-Out Eskalationen');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAcknowledge = async (item: PendingEscalation) => {
    const note = notesInput[item.pupilId]?.trim() || 'Eltern verständigt & Nachholtermin am Nachmittag vereinbart';
    setSubmittingId(item.pupilId);
    setError(null);
    try {
      await acknowledgeTimeoutEscalation(item.pupilId, item.milestoneCount, note);
      await loadData();
      if (onUpdated) onUpdated();
    } catch (e: any) {
      setError(e.message || 'Fehler beim Bestätigen der Eskalation');
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <Dialog
      onClose={onClose}
      labelledBy="timeout-escalation-modal-title"
      panelClassName="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-lg overflow-hidden"
    >
        {/* Top Header */}
        <div className="p-5 px-6 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-4 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm uppercase font-bold tracking-wider text-amber-400">
                Schulleitung (SLC)
              </span>
            </div>
            <h2 id="timeout-escalation-modal-title" className="text-xl font-bold text-slate-50 mt-0.5 flex items-center gap-2">
              <span>Time-Out Eskalations-Zentrum</span>
              <span className="text-sm px-2.5 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                Mahnstufen 3, 6, 9...
              </span>
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">
              Dokumentation der Elternverständigung &amp; Vereinbarung von Nachholterminen am Nachmittag
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 hover:bg-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="p-3 px-6 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-3.5 py-1.5 rounded-xl font-bold text-sm flex items-center gap-1.5 transition ${
                activeTab === 'pending'
                  ? 'bg-rose-500 text-slate-50 font-bold shadow-md shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:text-slate-50'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Offene Eskalationen ({pending.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('handled')}
              className={`px-3.5 py-1.5 rounded-xl font-bold text-sm flex items-center gap-1.5 transition ${
                activeTab === 'handled'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:text-slate-50'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Erledigte Vereinbarungen ({handled.length})</span>
            </button>
          </div>

          <span className="text-2xs text-slate-400 hidden sm:inline">
            Eskalation erfolgt automatisch beim 3., 6., 9., 12. Time-Out
          </span>
        </div>

        {/* Error notification */}
        {error && (
          <div className="px-6 py-2 bg-red-500/15 border-b border-red-500/30 text-sm text-red-300 flex items-center gap-2 flex-shrink-0">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              Lade Eskalationsdaten...
            </div>
          ) : activeTab === 'pending' ? (
            pending.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-sm bg-slate-950/40 rounded-3xl border border-slate-800">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2 opacity-80" />
                <p className="font-bold text-slate-50 text-base">Keine offenen Time-Out Eskalationen!</p>
                <p className="text-sm text-slate-500 mt-1">
                  Alle Schüler*innen mit $\ge 3$ Time-Outs wurden bereits von SLC bearbeitet.
                </p>
              </div>
            ) : (
              pending.map((item) => {
                const isExpanded = expandedPupilId === item.pupilId;
                const isSubmitting = submittingId === item.pupilId;

                return (
                  <div
                    key={`${item.pupilId}-${item.milestoneCount}`}
                    className="bg-slate-900 border-2 border-rose-500/40 rounded-3xl p-5 shadow-lg hover:border-rose-500/60 transition"
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-slate-800">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2.5 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-sm font-bold animate-pulse">
                            🚨 {item.milestoneCount}. Time-Out erreicht!
                          </span>
                          <span className="text-sm text-slate-400 font-bold">
                            Klasse {item.className}
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-50">
                          {item.pupilName}
                        </h3>
                        <p className="text-sm text-slate-400 mt-0.5">
                          Gesamtanzahl: <strong className="text-slate-50">{item.totalTimeouts} Time-Outs</strong> im Schuljahr
                        </p>
                      </div>

                      {/* Toggle History Details */}
                      <button
                        onClick={() => setExpandedPupilId(isExpanded ? null : item.pupilId)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-bold text-slate-300 hover:text-slate-50 flex items-center gap-1.5 transition self-start"
                      >
                        <FileText className="w-3.5 h-3.5 text-amber-400" />
                        <span>{isExpanded ? 'Verlauf ausblenden' : `Alle ${item.totalTimeouts} Time-Outs ansehen`}</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {/* Expandable History of Timeouts */}
                    {isExpanded && (
                      <div className="py-3 border-b border-slate-800 space-y-2">
                        <div className="text-2xs font-bold uppercase text-slate-400 tracking-wider">
                          Protokoll aller bisherigen Time-Outs:
                        </div>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {item.timeoutsHistory.map((th, idx) => (
                            <div
                              key={th.id}
                              className="p-2.5 rounded-2xl bg-slate-950 border border-slate-800 text-sm flex flex-col gap-1"
                            >
                              <div className="flex items-center justify-between text-2xs">
                                <span className="font-bold text-amber-300">
                                  #{idx + 1} Time-Out · von {th.sent_by_short}
                                </span>
                                <span className="text-slate-500">
                                  {new Date(th.sent_at).toLocaleDateString('de-AT', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              <p className="text-slate-300 italic text-2xs">
                                Auftrag: &bdquo;{th.task_assignment}&ldquo;
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* SLC Action Box: Notes & Button */}
                    <div className="pt-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
                      <div className="flex-1">
                        <label className="text-2xs font-bold uppercase text-slate-400 block mb-1">
                          Vereinbarter Nachholtermin / Gesprächsnotiz (optional):
                        </label>
                        <input
                          type="text"
                          value={notesInput[item.pupilId] || ''}
                          onChange={(e) =>
                            setNotesInput((prev) => ({ ...prev, [item.pupilId]: e.target.value }))
                          }
                          placeholder="z.B. Nachholtermin Freitag 14:00 Uhr mit Mutter vereinbart..."
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <button
                        onClick={() => handleAcknowledge(item)}
                        disabled={isSubmitting}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold text-sm flex items-center gap-2 shadow-lg shadow-sm transition active:scale-95 flex-shrink-0"
                      >
                        <PhoneCall className="w-4 h-4" />
                        <span>
                          {isSubmitting
                            ? 'Speichere...'
                            : 'Eltern verständigt & Nachholtermin vereinbart'}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            /* Handled Escalations Tab */
            handled.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-sm">
                Noch keine erledigten Vereinbarungen hinterlegt.
              </div>
            ) : (
              <div className="space-y-3">
                {handled.map((h, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 text-sm"
                  >
                    <div>
                      <div className="flex items-center gap-2 font-bold text-slate-50 text-sm">
                        <span>{h.pupilName} ({h.className})</span>
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-2xs font-bold">
                          {h.milestoneCount}. Time-Out erledigt
                        </span>
                      </div>
                      <p className="text-slate-400 text-sm mt-0.5">
                        Notiz: <span className="text-slate-200">{h.notes}</span>
                      </p>
                    </div>

                    <div className="text-right text-2xs text-slate-500 flex-shrink-0">
                      <div>Bearbeitet von <strong className="text-slate-300">{h.handledByShort}</strong></div>
                      <div>
                        {new Date(h.handledAt).toLocaleDateString('de-AT', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="p-3 px-6 border-t border-slate-800 bg-slate-900/90 flex items-center justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-50 font-bold text-sm transition"
          >
            Schließen
          </button>
        </div>
    </Dialog>
  );
};
