import React from 'react';
import {
  ChevronRight,
  Clock,
  ShieldAlert,
  ShieldAlert as ShieldAlertIcon,
  Snowflake,
  X,
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';

export const RETROACTIVE_TIMEOUT_DAYS = 7;

export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function earliestRetroactiveDateKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - (RETROACTIVE_TIMEOUT_DAYS - 1));
  return localDateKey(date);
}

export interface ActiveCardModalState {
  pupilId: number;
  pupilName: string;
  cardType: 'green' | 'yellow';
  classId: number;
  className: string;
}

export interface RedCardTargetState {
  pupilId: number;
  pupilName: string;
  classId: number;
  className: string;
  deductions: Array<{
    label: string;
    currentRank: 'Lehrling' | 'Geselle' | 'Meister';
    demotedRank: 'Lehrling' | 'Geselle';
  }>;
  pendingNote: string | null;
}

export interface TimeoutTargetState {
  pupilId: number;
  pupilName: string;
  kind: 'timeout' | 'cooldown';
  classId: number;
  className: string;
}

interface SchulalltagActionSheetsProps {
  activeCardModal: ActiveCardModalState | null;
  onCloseCardModal: () => void;
  cardNote: string;
  onCardNoteChange: (value: string) => void;
  submittingCard: boolean;
  onConfirmCard: () => void;
  redCardTarget: RedCardTargetState | null;
  onCloseRedCard: () => void;
  redCardStep: 1 | 2;
  onRedCardStepChange: (step: 1 | 2) => void;
  redCardNote: string;
  onRedCardNoteChange: (value: string) => void;
  submittingRedCard: boolean;
  onConfirmRedCard: () => void;
  timeoutTarget: TimeoutTargetState | null;
  onCloseTimeout: () => void;
  timeoutTask: string;
  onTimeoutTaskChange: (value: string) => void;
  timeoutRetroactive: boolean;
  onTimeoutRetroactiveChange: (value: boolean) => void;
  timeoutRetroDate: string;
  onTimeoutRetroDateChange: (value: string) => void;
  timeoutRetroPeriod: number;
  onTimeoutRetroPeriodChange: (value: number) => void;
  submittingTimeout: boolean;
  onConfirmTimeout: () => void;
}

/**
 * Modal action sheets for issuing green/yellow cards, red cards (two-step confirmation),
 * and Lernwerkstatt time-out / cool-down entries in the Schulalltag view.
 */
export const SchulalltagActionSheets: React.FC<SchulalltagActionSheetsProps> = ({
  activeCardModal,
  onCloseCardModal,
  cardNote,
  onCardNoteChange,
  submittingCard,
  onConfirmCard,
  redCardTarget,
  onCloseRedCard,
  redCardStep,
  onRedCardStepChange,
  redCardNote,
  onRedCardNoteChange,
  submittingRedCard,
  onConfirmRedCard,
  timeoutTarget,
  onCloseTimeout,
  timeoutTask,
  onTimeoutTaskChange,
  timeoutRetroactive,
  onTimeoutRetroactiveChange,
  timeoutRetroDate,
  onTimeoutRetroDateChange,
  timeoutRetroPeriod,
  onTimeoutRetroPeriodChange,
  submittingTimeout,
  onConfirmTimeout,
}) => {
  return (
    <>
      {/* Modal: Standard Card Issue with Note (Green or Yellow) */}
      {activeCardModal && (
        <Dialog
          onClose={onCloseCardModal}
          labelledBy="schulalltag-card-modal-title"
          align="sheet"
          panelClassName="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-lg"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
            <h3 id="schulalltag-card-modal-title" className="font-bold text-slate-50 text-base flex items-center gap-2">
              <span>
                {activeCardModal.cardType === 'green' ? '★ Grüne Karte' : '▲ Gelbe Karte'} vergeben
              </span>
            </h3>
            <button
              type="button"
              aria-label="Schließen"
              onClick={onCloseCardModal}
              className="p-1.5 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm text-slate-300 mb-3">
            Für Schüler*in: <strong className="text-slate-50">{activeCardModal.pupilName}</strong> (Klasse {activeCardModal.className})
          </p>

          <div className="mb-4">
            <label className="text-2xs font-bold text-slate-400 uppercase block mb-1">
              Begründung / Notiz (optional)
            </label>
            <textarea
              rows={3}
              value={cardNote}
              onChange={(e) => onCardNoteChange(e.target.value)}
              placeholder={
                activeCardModal.cardType === 'green'
                  ? 'z.B. Vorbildliches Engagement, herausragende Mitarbeit...'
                  : 'z.B. Wiederholte Störung, Hausübung unvollständig...'
              }
              className="w-full p-3 rounded-2xl bg-slate-950 border border-slate-800 text-sm text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCloseCardModal}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold transition"
            >
              Abbrechen
            </button>
            <button
              onClick={onConfirmCard}
              disabled={submittingCard}
              className={`px-4 py-2 rounded-xl text-slate-950 font-bold text-sm transition shadow-md ${
                activeCardModal.cardType === 'green'
                  ? 'bg-emerald-500 hover:bg-emerald-400 shadow-sm'
                  : 'bg-amber-500 hover:bg-amber-400 shadow-sm'
              }`}
            >
              {submittingCard ? 'Speichere...' : 'Karte jetzt vergeben'}
            </button>
          </div>
        </Dialog>
      )}

      {/* Two-Step Security Modal: ROTE KARTE (Instant Rank Loss) */}
      {redCardTarget && (
        <Dialog
          onClose={onCloseRedCard}
          labelledBy="schulalltag-redcard-modal-title"
          align="sheet"
          panelClassName="bg-slate-900 border-2 border-rose-500/60 rounded-3xl w-full max-w-lg p-6 shadow-lg"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between pb-3 border-b border-rose-500/20 mb-4">
            <div className="flex items-center gap-2.5 text-rose-400">
              <ShieldAlert className="w-5 h-5 flex-shrink-0 animate-bounce" />
              <h3 id="schulalltag-redcard-modal-title" className="font-bold text-slate-50 text-base">
                {redCardStep === 1
                  ? 'Sicherheitswarnung: Rote Karte (Instant Rank Loss)'
                  : 'Schritt 2: Vorfallsbeschreibung erfassen'}
              </h3>
            </div>
            <button
              type="button"
              aria-label="Schließen"
              onClick={onCloseRedCard}
              className="p-1.5 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step 1: Warning & Confirmation */}
          {redCardStep === 1 && (
            <div className="space-y-4">
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 text-sm text-rose-200 space-y-2">
                <p className="text-sm font-bold text-rose-300">
                  Möchten Sie dem Schüler {redCardTarget.pupilName} wirklich eine Rote Karte geben?
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Eine <strong className="text-rose-400">Rote Karte</strong> führt zu einem <strong>sofortigen Rangverlust (Instant Rank Loss)</strong>.
                  Der Schüler wird je Fach um eine Rangstufe degradiert:
                </p>
                <div className="flex flex-col gap-2 pt-2 font-bold text-sm">
                  {redCardTarget.deductions.map((d) => (
                    <span key={d.label} className="flex items-center gap-1.5">
                      <span className="px-3 py-1 rounded-xl bg-slate-800 border border-slate-700 text-slate-300">
                        {d.label}: {d.currentRank}
                      </span>
                      <span className="text-rose-400">➔</span>
                      <span className="px-3 py-1 rounded-xl bg-rose-500/30 border border-rose-500/60 text-rose-300">
                        {d.demotedRank}
                      </span>
                    </span>
                  ))}
                </div>
                {redCardTarget.deductions.length === 0 && !redCardTarget.pendingNote && (
                  <p className="text-slate-400 text-sm">
                    Die Rote Karte zählt als Rangverlust. Die betroffenen Fächer
                    werden beim Laden der Klasse berechnet.
                  </p>
                )}
                {redCardTarget.pendingNote && (
                  <p className="text-slate-400 text-sm pt-1">{redCardTarget.pendingNote}</p>
                )}
              </div>

              <p className="text-sm text-slate-400">
                Im nächsten Schritt müssen Sie zwingend beschreiben, was genau vorgefallen ist, bevor die Rote Karte im System gespeichert wird.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={onCloseRedCard}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold transition"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => onRedCardStepChange(2)}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-slate-50 font-bold text-sm transition shadow-lg shadow-sm flex items-center gap-1.5"
                >
                  <span>Ja, weiter zur Vorfallsbeschreibung</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Mandatory Incident Description */}
          {redCardStep === 2 && (
            <div className="space-y-4">
              <div className="text-sm text-slate-300 space-y-1.5">
                Schüler*in: <strong className="text-slate-50">{redCardTarget.pupilName}</strong> (Klasse {redCardTarget.className})
                {redCardTarget.deductions.length > 0 && (
                  <>
                    <span className="block text-rose-400 font-bold">Degradierung:</span>
                    <span className="flex flex-col gap-1.5 font-bold">
                      {redCardTarget.deductions.map((d) => (
                        <span key={d.label} className="text-slate-200">
                          {d.label}: {d.currentRank} ➔ {d.demotedRank}
                        </span>
                      ))}
                    </span>
                  </>
                )}
                {redCardTarget.pendingNote && (
                  <span className="block text-slate-400 font-normal">{redCardTarget.pendingNote}</span>
                )}
              </div>

              <div>
                <label className="text-2xs font-bold uppercase text-rose-300 block mb-1.5">
                  Was ist passiert? Vorfallsbeschreibung (zwingend erforderlich):
                </label>
                <textarea
                  rows={4}
                  value={redCardNote}
                  onChange={(e) => onRedCardNoteChange(e.target.value)}
                  placeholder="Beschreiben Sie präzise und sachlich den Vorfall..."
                  className="w-full p-3.5 rounded-2xl bg-slate-950 border border-rose-500/40 text-sm text-slate-50 placeholder-slate-500 focus:outline-none focus:border-rose-400 focus-ring"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => onRedCardStepChange(1)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold transition"
                >
                  Zurück
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={onCloseRedCard}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm font-bold transition"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={onConfirmRedCard}
                    disabled={submittingRedCard || !redCardNote.trim()}
                    className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-slate-50 font-bold text-sm transition shadow-lg shadow-sm flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{submittingRedCard ? 'Speichere...' : 'Rote Karte & Degradierung bestätigen'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </Dialog>
      )}

      {/* Modal: Time-Out or consequence-free Cool-Down */}
      {timeoutTarget && (() => {
        const isCooldown = timeoutTarget.kind === 'cooldown';
        return (
          <Dialog
            onClose={onCloseTimeout}
            labelledBy="schulalltag-timeout-modal-title"
            align="sheet"
            panelClassName={`bg-slate-900 border-2 ${isCooldown ? 'border-sky-500/60' : 'border-amber-500/60'} rounded-3xl w-full max-w-lg p-6 shadow-lg`}
          >
            <div className={`flex items-center justify-between pb-3 border-b ${isCooldown ? 'border-sky-500/20' : 'border-amber-500/20'} mb-4`}>
              <div className={`flex items-center gap-2 ${isCooldown ? 'text-sky-300' : 'text-amber-400'}`}>
                {isCooldown ? (
                  <Snowflake className="w-5 h-5 flex-shrink-0" />
                ) : (
                  <Clock className="w-5 h-5 flex-shrink-0 animate-pulse" />
                )}
                <h3 id="schulalltag-timeout-modal-title" className="font-bold text-slate-50 text-base">
                  {isCooldown
                    ? 'Cool-Down (Lernwerkstatt) – kein Rangverlust'
                    : 'Schüler*in ins Time-Out (Lernwerkstatt) schicken'}
                </h3>
              </div>
              <button
                type="button"
                aria-label="Schließen"
                onClick={onCloseTimeout}
                className="p-1.5 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className={`${isCooldown ? 'bg-sky-500/10 border-sky-500/30 text-sky-200' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'} border rounded-2xl p-3.5 text-sm`}>
                <p className={`font-bold ${isCooldown ? 'text-sky-300' : 'text-amber-300'} mb-1`}>
                  {isCooldown ? (
                    <Snowflake className="w-5 h-5 inline align-text-bottom" aria-hidden="true" />
                  ) : (
                    <ShieldAlertIcon className="w-5 h-5 inline align-text-bottom" aria-hidden="true" />
                  )}{' '}
                  {isCooldown ? 'Cool-Down für' : 'Disziplinäres Time-Out für'} {timeoutTarget.pupilName} (Klasse {timeoutTarget.className})
                </p>
                <p className="text-slate-300 leading-relaxed">
                  {isCooldown
                    ? 'Der Schüler wird zur Beruhigung in die Lernwerkstatt geschickt. Es gibt keine Rote Karte, keinen Rangverlust und keine Eskalationsstufe. Eine Notiz ist optional.'
                    : timeoutRetroactive
                      ? 'Dieses Time-Out wird nachträglich für die gewählte Stunde erfasst. Es ist eine eigenständige Konsequenz; eine Rote Karte wird dadurch nicht ausgestellt.'
                      : 'Dieses Time-Out ist eine eigenständige Konsequenz. Es wird keine Rote Karte ausgestellt; eine Rote Karte würde den Rang separat senken.'}
                </p>
              </div>

              {!isCooldown && (
                <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-3.5 space-y-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-200">
                    <input
                      type="checkbox"
                      checked={timeoutRetroactive}
                      onChange={(event) => onTimeoutRetroactiveChange(event.target.checked)}
                      className="h-4 w-4 accent-amber-500"
                    />
                    Time-Out nachträglich erfassen (vergangene Stunde)
                  </label>
                  {timeoutRetroactive && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-2xs font-bold uppercase text-slate-400">
                            Datum
                          </label>
                          <input
                            type="date"
                            aria-label="Datum"
                            value={timeoutRetroDate}
                            min={earliestRetroactiveDateKey()}
                            max={localDateKey()}
                            onChange={(event) => onTimeoutRetroDateChange(event.target.value)}
                            className="min-h-[42px] w-full rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-slate-50 focus:border-amber-400 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-2xs font-bold uppercase text-slate-400">
                            Schulstunde
                          </label>
                          <select
                            aria-label="Schulstunde"
                            value={timeoutRetroPeriod}
                            onChange={(event) => onTimeoutRetroPeriodChange(Number(event.target.value))}
                            className="min-h-[42px] w-full rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-slate-50 focus:border-amber-400 focus:outline-none"
                          >
                            {Array.from({ length: 10 }, (_, index) => index + 1).map((period) => (
                              <option key={period} value={period}>
                                {period}. Stunde
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <p className="text-2xs leading-relaxed text-slate-400">
                        Nur die letzten {RETROACTIVE_TIMEOUT_DAYS} Tage. Der Eintrag wird als
                        bereits beendet gespeichert und erscheint nicht als aktiver
                        Lernwerkstatt-Aufenthalt.
                      </p>
                    </>
                  )}
                </div>
              )}

              <div>
                <label className={`text-2xs font-bold uppercase ${isCooldown ? 'text-sky-300' : 'text-amber-300'} block mb-1.5`}>
                  {isCooldown
                    ? 'Notiz / Beobachtung (optional):'
                    : 'Arbeitsauftrag für das Time-Out (zwingend erforderlich):'}
                </label>
                <textarea
                  rows={4}
                  value={timeoutTask}
                  onChange={(e) => onTimeoutTaskChange(e.target.value)}
                  placeholder={
                    isCooldown
                      ? 'z.B. Kurze Auszeit zur Beruhigung, kurze Beobachtung...'
                      : 'Geben Sie hier die Aufgaben oder Arbeitsblätter an, die der Schüler in der Lernwerkstatt bearbeiten muss...'
                  }
                  className={`w-full p-3.5 rounded-2xl bg-slate-950 border ${isCooldown ? 'border-sky-500/40 focus:border-sky-400 ' : 'border-amber-500/40 focus:border-amber-400 '} text-sm text-slate-50 placeholder-slate-500 focus-ring`}
                />
                {!isCooldown && timeoutTask.trim().length === 0 && (
                  <span className="text-2xs text-amber-400 mt-1 block">
                    * Ein konkreter Arbeitsauftrag ist zwingend erforderlich.
                  </span>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={onCloseTimeout}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold transition"
                >
                  Abbrechen
                </button>
                <button
                  onClick={onConfirmTimeout}
                  disabled={
                    submittingTimeout ||
                    (!isCooldown && !timeoutTask.trim()) ||
                    (!isCooldown && timeoutRetroactive && (!timeoutRetroDate || !timeoutRetroPeriod))
                  }
                  className={`px-5 py-2.5 rounded-xl ${isCooldown ? 'bg-sky-500 hover:bg-sky-400 text-slate-950' : 'bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950'} font-bold text-sm transition shadow-lg shadow-sm flex items-center gap-1.5 disabled:opacity-40`}
                >
                  {isCooldown ? <Snowflake className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  <span>
                    {submittingTimeout
                      ? 'Übermittle...'
                      : isCooldown
                        ? 'Cool-Down senden'
                        : timeoutRetroactive
                          ? 'Time-Out nachtragen'
                          : 'Ins Time-Out schicken'}
                  </span>
                </button>
              </div>
            </div>
          </Dialog>
        );
      })()}
    </>
  );
};
