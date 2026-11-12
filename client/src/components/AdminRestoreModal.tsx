import React, { useCallback, useEffect, useState } from 'react';
import {
  RotateCcw,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Clock,
  HardDrive,
  RefreshCw,
  X,
  Database,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { listBackups, restoreBackup, type BackupFileItem } from '../services/api';
import { useToast } from './Toast';

interface Props {
  onClose: () => void;
}

function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('de-AT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export const AdminRestoreModal: React.FC<Props> = ({ onClose }) => {
  const toast = useToast();
  const [backups, setBackups] = useState<BackupFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Restore confirmation state
  const [selectedBackup, setSelectedBackup] = useState<BackupFileItem | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<{
    message: string;
    preRestoreBackup?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listBackups();
      setBackups(result.backups);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Backups konnten nicht geladen werden.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStartRestore = (backup: BackupFileItem) => {
    setSelectedBackup(backup);
    setConfirmInput('');
    setRestoreError(null);
  };

  const handleCancelConfirmation = () => {
    if (restoring) return;
    setSelectedBackup(null);
    setConfirmInput('');
    setRestoreError(null);
  };

  const handleExecuteRestore = async () => {
    if (!selectedBackup || confirmInput !== 'WIEDERHERSTELLEN') return;

    setRestoring(true);
    setRestoreError(null);

    try {
      const result = await restoreBackup(selectedBackup.id);
      setRestoreSuccess({
        message: result.message,
        preRestoreBackup: result.preRestoreBackup,
      });
      toast.success('Backup erfolgreich wiederhergestellt!');

      // Automatically reload the page after 4 seconds to refresh all data caches
      setTimeout(() => {
        window.location.reload();
      }, 4000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Wiederherstellung fehlgeschlagen.';
      setRestoreError(msg);
      toast.error(msg);
    } finally {
      setRestoring(false);
    }
  };

  const latestBackup = backups.length > 0 ? backups[0] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 scrim backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-modal-title"
    >
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h2 id="restore-modal-title" className="text-lg font-bold text-slate-100 flex items-center gap-2">
                System-Wiederherstellung (Admin)
              </h2>
              <p className="text-xs text-slate-400">
                Verfügbare Datenbank-Snapshots einsehen und bei Bedarf einspielen.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading || restoring}
              className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition disabled:opacity-40"
              title="Liste aktualisieren"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              disabled={restoring}
              className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition disabled:opacity-40"
              aria-label="Schließen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Success Overlay View */}
          {restoreSuccess ? (
            <div className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-emerald-300">
                Wiederherstellung erfolgreich abgeschlossen!
              </h3>
              <p className="text-sm text-slate-300 max-w-xl mx-auto">
                {restoreSuccess.message}
              </p>
              {restoreSuccess.preRestoreBackup && (
                <p className="text-xs text-slate-400 font-mono bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  Automatisches Sicherheits-Backup:{' '}
                  <span className="text-amber-400 font-bold">{restoreSuccess.preRestoreBackup}</span>
                </p>
              )}
              <div className="pt-2 flex flex-col items-center gap-3">
                <p className="text-xs text-slate-400 animate-pulse">
                  Die Anwendung lädt in wenigen Sekunden automatisch neu...
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/40 transition"
                >
                  Jetzt neu laden
                </button>
              </div>
            </div>
          ) : selectedBackup ? (
            /* Confirmation Step Dialog */
            <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-2xl space-y-5 animate-fade-in">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-rose-500/20 text-rose-400 shrink-0">
                  <ShieldAlert className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-rose-300">
                    Sicherheitsüberprüfung: Datenbank wiederherstellen
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Sie sind im Begriff, die gesamte SMILE-Datenbank auf den Stand von{' '}
                    <span className="font-mono font-bold text-rose-300">{selectedBackup.filename}</span>{' '}
                    (vom {formatTimestamp(selectedBackup.timestamp)}) zurückzusetzen.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-950/70 border border-rose-900/40 rounded-xl space-y-2 text-xs text-slate-300">
                <div className="flex items-center gap-2 font-semibold text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Wichtige Hinweise vor dem Ausführen:</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-400 pl-1">
                  <li>
                    Alle seit diesem Snapshot gemachten Änderungen werden mit den Daten des Backups überschrieben.
                  </li>
                  <li>
                    Das System erstellt vorab automatisch ein Sicherheits-Backup des aktuellen Ist-Zustands.
                  </li>
                  <li>
                    Alle aktiven WebSocket-Sitzungen werden getrennt, um Datenkonsistenz zu gewährleisten.
                  </li>
                </ul>
              </div>

              {restoreError && (
                <div className="p-3 bg-red-950/80 border border-red-500/40 rounded-xl text-xs text-red-200">
                  {restoreError}
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Tippen Sie zur Freigabe <span className="text-rose-400 font-mono font-bold">WIEDERHERSTELLEN</span> in das Feld ein:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  disabled={restoring}
                  placeholder="WIEDERHERSTELLEN"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600 font-mono text-sm focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCancelConfirmation}
                  disabled={restoring}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition disabled:opacity-40"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleExecuteRestore}
                  disabled={confirmInput !== 'WIEDERHERSTELLEN' || restoring}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold text-xs transition flex items-center gap-2 shadow-lg shadow-rose-900/40"
                >
                  {restoring ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Wiederherstellung läuft... Bitte warten...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      <span>Jetzt wiederherstellen</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Normal Overview: Hero Button & Table */
            <>
              {/* Informational Banner */}
              <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-start gap-3 text-xs text-slate-300">
                <Database className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-slate-200">
                    Sicherheitsgarantie bei Wiederherstellung
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    Backups werden alle 10 Minuten (06:00 – 19:00 Uhr) auf dem Server und in OneDrive gespeichert.
                    Vor jeder Einspielung wird automatisch ein frischer Sicherheits-Snapshot erstellt.
                  </p>
                </div>
              </div>

              {/* Quick Hero Button for the Most Recent Backup */}
              {latestBackup && (
                <div className="p-4 bg-gradient-to-r from-rose-950/40 to-slate-900 border border-rose-500/30 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-400 font-bold text-[11px] uppercase tracking-wider">
                        Empfohlen bei Ausfall
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatTimestamp(latestBackup.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <HardDrive className="w-4 h-4 text-rose-400" />
                      {latestBackup.filename}
                      <span className="text-xs text-slate-400 font-normal">({latestBackup.sizeFormatted})</span>
                    </p>
                  </div>
                  <button
                    onClick={() => handleStartRestore(latestBackup)}
                    className="pressable px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-rose-900/40 transition shrink-0"
                  >
                    <Zap className="w-4 h-4" />
                    <span>Neuestes Backup wiederherstellen</span>
                  </button>
                </div>
              )}

              {/* Backups Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Vorhandene Backups ({backups.length})
                  </h3>
                </div>

                {loading ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400 text-xs">
                    <RefreshCw className="w-6 h-6 animate-spin text-accent" />
                    <span>Backups werden geladen...</span>
                  </div>
                ) : loadError ? (
                  <div className="p-4 bg-red-950/50 border border-red-800/60 rounded-xl text-xs text-red-300">
                    {loadError}
                  </div>
                ) : backups.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                    Keine Backup-Dateien im Backup-Verzeichnis gefunden.
                  </div>
                ) : (
                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
                      {backups.map((b) => (
                        <div
                          key={b.id}
                          className="p-3.5 flex items-center justify-between gap-4 hover:bg-slate-800/40 transition"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-slate-200 truncate">
                                {b.filename}
                              </span>
                              {b.isSafetySnapshot && (
                                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  Sicherheitskopie
                                </span>
                              )}
                              {b.isEncrypted && (
                                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                  Verschlüsselt
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-[11px] text-slate-400">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-500" />
                                {formatTimestamp(b.timestamp)}
                              </span>
                              <span>{b.sizeFormatted}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => handleStartRestore(b)}
                            className="pressable px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/20 text-xs font-semibold transition shrink-0 flex items-center gap-1.5"
                            title={`Backup ${b.filename} einspielen`}
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Wiederherstellen</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex justify-end">
          <button
            onClick={onClose}
            disabled={restoring}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition disabled:opacity-40"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};
