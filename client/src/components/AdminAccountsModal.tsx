import React, { useCallback, useEffect, useState } from 'react';
import { Eye, KeyRound, RefreshCw, ShieldAlert, Users, X } from 'lucide-react';
import {
  getAdminUsers,
  resetStartPassword,
  requestPasswordReset,
  startViewAs,
  type AdminUserAccount,
} from '../services/api';
import { useToast } from './Toast';

interface Props {
  onClose: () => void;
}

const ROLE_LABEL: Record<AdminUserAccount['role'], string> = {
  admin: 'Administration',
  head_teacher: 'Klassenvorstand',
  teacher: 'Lehrkraft',
  pupil: 'Schüler/in',
};

/**
 * Administrator-only credential handover.
 *
 * This is the delivery channel that replaces the shared bootstrap password. There is no
 * mail on this LAN, so the administrator generates a one-time credential here and hands it
 * over out of band; the account is flagged `mustChangePassword` and every mutating
 * endpoint stays closed until its owner picks their own value.
 *
 * The generated credential is shown once, in the open dialog, and deliberately not copied
 * to the clipboard automatically: a clipboard is reachable by other code on the page, and
 * the administrator is present to read and relay it.
 */
export const AdminAccountsModal: React.FC<Props> = ({ onClose }) => {
  const toast = useToast();
  const [accounts, setAccounts] = useState<AdminUserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyUsername, setBusyUsername] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ username: string; password: string; notice: string } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getAdminUsers();
      setAccounts(result.users);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Konten konnten nicht geladen werden.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleIssue = async (username: string) => {
    setBusyUsername(username);
    try {
      const result = await resetStartPassword(username);
      // Only the most recent credential is shown; a previous one is no longer knowable.
      setIssued({
        username: result.username,
        password: result.temporaryPassword,
        notice: result.notice,
      });
      toast.success(`Zugangsdaten für ${username} erstellt.`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Zugangsdaten konnten nicht erstellt werden.'
      );
    } finally {
      setBusyUsername(null);
    }
  };

  const handleViewAs = async (username: string) => {
    setBusyUsername(username);
    try {
      await startViewAs(username);
      // The server swapped the session cookie; a reload renders the target's view.
      window.location.reload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Ansicht konnte nicht geöffnet werden.'
      );
      setBusyUsername(null);
    }
  };

  const handleForceReset = async (username: string) => {
    setBusyUsername(username);
    try {
      await requestPasswordReset(username);
      toast.success(
        `${username} muss beim nächsten Anmelden ein neues Passwort setzen. Alle Sitzungen wurden beendet.`
      );
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Zurücksetzen ist nicht möglich.'
      );
    } finally {
      setBusyUsername(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center scrim p-4 backdrop-blur-sm">
      <div className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-slate-900 text-slate-200 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-bold">Konten &amp; Zugangsdaten</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {issued && (
          <div className="mx-6 mt-4 rounded-2xl border-2 border-amber-500/60 bg-amber-500/10 p-4">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-200">
                  Einmal-Passwort für {issued.username}
                </p>
                <p className="mt-2 font-mono text-xl tracking-wider text-amber-100 select-all">
                  {issued.password}
                </p>
                <p className="mt-2 text-xs text-amber-200/80">{issued.notice}</p>
                <button
                  type="button"
                  onClick={() => setIssued(null)}
                  className="mt-3 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-amber-400"
                >
                  Notiert — schließen
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-6 pt-4">
          <p className="text-xs text-slate-400">
            Konten mit <span className="text-amber-400">„Passwort offen“</span> haben ihre
            Zugangsdaten noch nicht selbst gewählt.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Neu laden"
            className="rounded-xl bg-slate-800 p-2 text-slate-300 transition hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto px-6 pb-6">
          {loadError && (
            <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {loadError}
            </p>
          )}
          {loading && !loadError && (
            <p className="px-1 py-6 text-center text-sm text-slate-400">Konten werden geladen…</p>
          )}

          {!loading && !loadError && (
            <ul className="space-y-2">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-800/60 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-bold">
                      <span className="truncate">{account.username}</span>
                      {account.mustChangePassword && (
                        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-300">
                          Passwort offen
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {ROLE_LABEL[account.role]}
                      {account.teacherShort ? ` · ${account.teacherShort}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(account.role === 'teacher' || account.role === 'head_teacher') && (
                      <button
                        type="button"
                        onClick={() => void handleViewAs(account.username)}
                        disabled={busyUsername === account.username}
                        title="App schreibgeschützt aus Sicht dieses Kontos ansehen"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-sky-500 disabled:opacity-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ansehen als
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleIssue(account.username)}
                      disabled={busyUsername === account.username}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:opacity-90 disabled:opacity-50"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Einmal-Passwort
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleForceReset(account.username)}
                      disabled={busyUsername === account.username || !account.mustChangePassword}
                      title={
                        account.mustChangePassword
                          ? 'Sitzungen beenden und beim nächsten Anmelden zum Wechsel zwingen'
                          : 'Das Konto hat bereits ein eigenes Passwort gesetzt'
                      }
                      className="rounded-xl bg-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Passwortwechsel erzwingen
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};