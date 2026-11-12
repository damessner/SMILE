import React, { useState, useEffect } from 'react';
import {
  X,
  Printer,
  Sparkles,
  Award,
  Crown,
  Star,
  AlertTriangle,
  ShieldAlert,
  Clock,
  CheckCircle2,
  FileText,
  Calendar,
  Send,
  Trash2,
  ChevronRight,
  Info,
} from 'lucide-react';
import { BehaviorStage, PupilBehaviorProfile, PupilBehaviorAction, User } from '../types';
import { BehaviorPyramid } from './BehaviorPyramid';
import { getPupilBehaviorProfile, savePupilBehaviorAction, deletePupilBehaviorAction } from '../services/api';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';

interface PupilProfileModalProps {
  pupilId: number;
  currentUser: User;
  onClose: () => void;
  onRefreshParent?: () => void;
}

export const PupilProfileModal: React.FC<PupilProfileModalProps> = ({
  pupilId,
  currentUser,
  onClose,
  onRefreshParent,
}) => {
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PupilBehaviorProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'pyramid' | 'actions' | 'history'>('pyramid');
  const [selectedStage, setSelectedStage] = useState<BehaviorStage | null>(null);

  // New action form state
  const [actionNotes, setActionNotes] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const data = await getPupilBehaviorProfile(pupilId);
      setProfile(data);
      // Select the pupil's active dominant stage by default
      const dominant = data.stages.find((s) => s.level === data.calculation.currentStage);
      if (dominant) setSelectedStage(dominant);
      else if (data.stages.length > 0) setSelectedStage(data.stages[0]);
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Laden des Schülerprofils');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [pupilId]);

  const handleRecordAction = async (stage: BehaviorStage) => {
    if (!stage) return;
    try {
      setSubmittingAction(true);
      await savePupilBehaviorAction(pupilId, {
        stageLevel: stage.level,
        stageTitle: stage.title,
        notes: actionNotes.trim() || undefined,
        status: 'completed',
      });
      toast.success(`Maßnahme „${stage.title}“ erfolgreich dokumentiert.`);
      setActionNotes('');
      await loadProfile();
      onRefreshParent?.();
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Dokumentieren der Maßnahme');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleDeleteAction = async (action: PupilBehaviorAction) => {
    const ok = await confirm({
      title: 'Maßnahme löschen?',
      message: `Möchten Sie den Eintrag „${action.stage_title}“ wirklich löschen?`,
      confirmLabel: 'Löschen',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await deletePupilBehaviorAction(pupilId, action.id);
      toast.success('Eintrag gelöscht.');
      await loadProfile();
      onRefreshParent?.();
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Löschen des Eintrags');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading && !profile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center scrim backdrop-blur-sm">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm font-semibold">Lade Schüler-Verhaltensprofil...</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const { pupil, calculation, stages, cards, timeouts, actions } = profile;
  const grade = calculation.behaviorGrade;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 scrim backdrop-blur-sm overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="relative w-full max-w-5xl bg-slate-950 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] print:max-h-none print:border-none print:shadow-none print:text-black">
        {/* Top Header Bar */}
        <div className="bg-slate-900 px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 print:border-b-2 print:border-black">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center font-bold text-lg">
              {pupil.fullName.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-50 print:text-black">
                  {pupil.fullName}
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-xs font-semibold">
                  Klasse {pupil.className}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold">
                  Rang: {pupil.currentRank}
                </span>
              </div>
              <p className="text-xs text-slate-400 print:text-gray-600 mt-0.5">
                Pädagogisches Verhaltensprofil &amp; Stufenpyramide (Österreichisches Schulmodell)
              </p>
            </div>
          </div>

          {/* Action Buttons & Grade Badge */}
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 ${
                grade === 'Sehr gut'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 ring-1 ring-emerald-400/30'
                  : grade === 'Gut'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                  : grade === 'Zufriedenstellend'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-400/40 ring-1 ring-rose-400/30'
              }`}
            >
              <Crown className="w-4 h-4" />
              <span>Verhaltensnote: {grade}</span>
            </span>

            <button
              onClick={handlePrint}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-50 border border-slate-700 transition print:hidden"
              title="Drucken / PDF"
            >
              <Printer className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 transition print:hidden"
              title="Schließen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-slate-900/60 px-6 py-2 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto print:hidden">
          <button
            onClick={() => setActiveTab('pyramid')}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeTab === 'pyramid'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Stufenpyramide</span>
          </button>

          <button
            onClick={() => setActiveTab('actions')}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeTab === 'actions'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Maßnahmen-Dokumentation ({actions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeTab === 'history'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Karten- &amp; Vorfallshistorie ({cards.length + timeouts.length})</span>
          </button>
        </div>

        {/* Tab Content Container */}
        <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6">
          {/* TAB 1: STUFENPYRAMIDE */}
          {activeTab === 'pyramid' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Visual Pyramid */}
              <div className="lg:col-span-8 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 md:p-6 shadow-inner">
                <BehaviorPyramid
                  stages={stages}
                  calculation={calculation}
                  selectedStageLevel={selectedStage?.level}
                  onSelectStage={(s) => setSelectedStage(s)}
                />
              </div>

              {/* Right Column: Stage Details & Action Recording */}
              <div className="lg:col-span-4 space-y-4">
                {selectedStage ? (
                  <div
                    className={`rounded-2xl border p-5 shadow-lg ${
                      selectedStage.type === 'green'
                        ? 'bg-emerald-950/25 border-emerald-500/35 text-slate-200'
                        : selectedStage.type === 'neutral'
                        ? 'bg-slate-900 border-slate-800 text-slate-200'
                        : 'bg-rose-950/25 border-rose-500/35 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                            selectedStage.type === 'green'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                              : selectedStage.type === 'neutral'
                              ? 'bg-slate-800 text-slate-300 border border-slate-700'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-400/40'
                          }`}
                        >
                          {selectedStage.level > 0 ? `+${selectedStage.level}` : selectedStage.level}
                        </span>
                        <h3 className="font-bold text-base text-slate-50">{selectedStage.title}</h3>
                      </div>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div>
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[11px] block">
                          Pädagogische Beschreibung:
                        </span>
                        <p className="text-slate-300 mt-0.5 leading-relaxed">
                          {selectedStage.description}
                        </p>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">Auslöser / Richtwert:</span>
                          <span className="font-bold text-amber-300">
                            {selectedStage.thresholdLabel}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">Verhaltensnote:</span>
                          <span className="font-bold text-slate-200">
                            {selectedStage.defaultGrade}
                          </span>
                        </div>
                      </div>

                      {/* Action recording box */}
                      <div className="pt-3 border-t border-slate-800 space-y-2">
                        <label className="text-slate-300 font-bold text-[11px] block">
                          Maßnahme zu dieser Stufe dokumentieren:
                        </label>
                        <textarea
                          value={actionNotes}
                          onChange={(e) => setActionNotes(e.target.value)}
                          placeholder={`Notiz/Protokoll für „${selectedStage.title}“ (optional)...`}
                          rows={2}
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                        />
                        <button
                          onClick={() => handleRecordAction(selectedStage)}
                          disabled={submittingAction}
                          className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-md shadow-amber-950/20"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Maßnahme festhalten</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 text-center text-slate-400 text-xs">
                    Klicken Sie auf eine Stufe in der Pyramide, um Details und Dokumentationsoptionen anzuzeigen.
                  </div>
                )}

                {/* Quick Info Box: Austrian school context */}
                <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-slate-300">
                    <Info className="w-4 h-4 text-sky-400" />
                    <span>Österreichisches Schulmodell</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Dieses Stufenmodell verbindet positives Verstärken (Lob, Goodies, Urkunden) mit gestufter Disziplinierung (Zurechtweisung, Mitteilungsheft, Schulleitung, Bildungsdirektion Tirol gem. § 49 SchUG).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MASSNAHMEN DOKUMENTATION */}
          {activeTab === 'actions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-50">
                    Dokumentierte Verhaltensmaßnahmen
                  </h3>
                  <p className="text-xs text-slate-400">
                    Protokoll über getätigte Interventionen, Elterngespräche, Mitteilungshefteinträge und Auszeichnungen.
                  </p>
                </div>
              </div>

              {actions.length === 0 ? (
                <div className="py-12 text-center text-slate-500 bg-slate-900/40 rounded-2xl border border-slate-800/80">
                  <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <p className="font-semibold text-slate-400">Noch keine Maßnahmen dokumentiert</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Wählen Sie in der Stufenpyramide eine Stufe aus, um eine Maßnahme zu protokollieren.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {actions.map((act) => (
                    <div
                      key={act.id}
                      className={`p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                        act.stage_level > 0
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : act.stage_level === 0
                          ? 'bg-slate-900 border-slate-800'
                          : 'bg-rose-950/20 border-rose-500/30'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-lg text-xs font-bold ${
                              act.stage_level > 0
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                                : act.stage_level === 0
                                ? 'bg-slate-800 text-slate-300'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-400/30'
                            }`}
                          >
                            Stufe {act.stage_level > 0 ? `+${act.stage_level}` : act.stage_level}
                          </span>
                          <h4 className="font-bold text-slate-50 text-sm">{act.stage_title}</h4>
                        </div>

                        {act.notes && (
                          <p className="text-xs text-slate-300 pl-1 mt-1 border-l-2 border-slate-700 italic">
                            &bdquo;{act.notes}&ldquo;
                          </p>
                        )}

                        <div className="flex items-center gap-3 text-[11px] text-slate-400 pt-1">
                          <span>
                            Erfasst von:{' '}
                            <strong className="text-amber-300">{act.teacher_short || 'Lehrkraft'}</strong>
                          </span>
                          <span>·</span>
                          <span>
                            Datum:{' '}
                            {new Date(act.action_date).toLocaleDateString('de-AT', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteAction(act)}
                        className="p-2 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 transition self-end md:self-center"
                        title="Eintrag entfernen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: KARTEN- & VORFALLSHISTORIE */}
          {activeTab === 'history' && (
            <div className="space-y-6">
              {/* Cards History */}
              <div className="space-y-3">
                <h3 className="text-base font-bold text-slate-50 flex items-center gap-2">
                  <span>Vergebene Verhaltenskarten</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-semibold">
                    {cards.length}
                  </span>
                </h3>

                {cards.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">
                    Keine Verhaltenskarten erfasst.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {cards.map((c) => (
                      <div
                        key={c.id}
                        className={`p-3.5 rounded-2xl border text-xs flex flex-col justify-between gap-2 ${
                          c.card_type === 'green'
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-slate-200'
                            : c.card_type === 'yellow'
                            ? 'bg-amber-950/20 border-amber-500/30 text-slate-200'
                            : c.card_type === 'cooldown'
                            ? 'bg-sky-950/25 border-sky-500/40 text-slate-200'
                            : 'bg-rose-950/25 border-rose-500/40 text-slate-200'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 font-bold mb-1">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  c.card_type === 'green'
                                    ? 'bg-emerald-400'
                                    : c.card_type === 'yellow'
                                    ? 'bg-amber-400'
                                    : c.card_type === 'cooldown'
                                    ? 'bg-sky-400'
                                    : 'bg-rose-400'
                                }`}
                              />
                              {c.card_type === 'green'
                                ? 'Grüne Karte (Lob)'
                                : c.card_type === 'yellow'
                                ? 'Gelbe Karte (Verwarnung)'
                                : c.card_type === 'cooldown'
                                ? 'Cool-Down (kein Rangverlust)'
                                : 'Rote Karte (Rangverlust)'}
                            </span>
                            <span className="text-[11px] text-slate-400 font-normal">
                              von {c.teacher_short || 'SL'}
                            </span>
                          </div>

                          {c.note ? (
                            <p className="text-xs text-slate-300 italic my-1 pl-2 border-l border-slate-700">
                              &bdquo;{c.note}&ldquo;
                            </p>
                          ) : (
                            <p className="text-[11px] text-slate-500 italic my-1">
                              Ohne Zusatznotiz vergeben
                            </p>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                          {new Date(c.created_at).toLocaleDateString('de-AT', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })} Uhr
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Time-Out Incidents */}
              <div className="space-y-3 pt-4 border-t border-slate-800">
                <h3 className="text-base font-bold text-slate-50 flex items-center gap-2">
                  <span>Lernwerkstatt Time-Out Einsätze</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-semibold">
                    {timeouts.length}
                  </span>
                </h3>

                {timeouts.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">
                    Keine Time-Outs oder Cool-Downs für diesen Schüler verzeichnet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {timeouts.map((ti) => (
                      <div
                        key={ti.id}
                        className={`p-4 rounded-2xl border text-xs space-y-2 ${ti.kind === 'cooldown' ? 'bg-sky-950/20 border-sky-500/30' : 'bg-rose-950/20 border-rose-500/30'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${ti.kind === 'cooldown' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-rose-500/20 text-rose-300 border-rose-500/40'}`}>
                            {ti.kind === 'cooldown' ? 'Cool-Down' : 'Time-Out Einsatz'}
                          </span>
                          {ti.retroactive && (
                            <span className="rounded-md bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-200">
                              Nachtrag
                            </span>
                          )}
                          <span className="text-slate-400 text-[11px]">
                            {new Date(ti.sent_at).toLocaleDateString('de-AT')} um{' '}
                            {new Date(ti.sent_at).toLocaleTimeString('de-AT', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            Uhr
                          </span>
                        </div>

                        <div>
                          <strong className="text-slate-300">
                            {ti.kind === 'cooldown' ? 'Notiz:' : 'Arbeitsauftrag:'}
                          </strong>
                          <p className="text-slate-200 mt-0.5 italic">
                            &bdquo;{ti.task_assignment}&ldquo;
                          </p>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                          <span>
                            Geschickt von: <strong className="text-amber-300">{ti.sent_by_short}</strong>
                          </span>
                          <span
                            className={ti.status === 'resolved' ? 'text-emerald-400' : 'text-amber-400'}
                          >
                            Status: {ti.status === 'resolved' ? 'Erledigt & zurück in Klasse' : 'Aktiv'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
