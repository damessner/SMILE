import React, { useState } from 'react';
import {
  X,
  KeyRound,
  Server,
  Lock,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import {
  connectWebUntisAccount,
  disconnectWebUntisAccount,
  type WebUntisAccountStatus,
} from '../../services/api';

interface WebUntisConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountStatus: WebUntisAccountStatus | null;
  onSuccess: (result: { teacherShort: string; teacherName?: string }) => void;
  onDisconnected: () => void;
}

export const WebUntisConnectModal: React.FC<WebUntisConnectModalProps> = ({
  isOpen,
  onClose,
  accountStatus,
  onSuccess,
  onDisconnected,
}) => {
  const currentServer = accountStatus?.account?.server || 'ms-telfs.webuntis.com';
  const currentSchool = accountStatus?.account?.school || 'ms-telfs';
  const currentUsername = accountStatus?.account?.username || '';
  const currentTeacherShort = accountStatus?.account?.teacherShort || '';

  const [server, setServer] = useState<string>(currentServer);
  const [school, setSchool] = useState<string>(currentSchool);
  const [username, setUsername] = useState<string>(currentUsername);
  const [secret, setSecret] = useState<string>('');
  const [authMethod, setAuthMethod] = useState<'password' | 'loginkey'>('password');

  const [loading, setLoading] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectPreset = (preset: 'telfs' | 'playground') => {
    if (preset === 'telfs') {
      setServer('ms-telfs.webuntis.com');
      setSchool('ms-telfs');
    } else {
      setServer('playground.webuntis.com');
      setSchool('PG6ef0f7d3-abdf-49b5-ab74-044ef932d877');
    }
    setError(null);
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !secret.trim()) {
      setError('Bitte geben Sie Ihren WebUntis-Benutzernamen und das Passwort ein.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccessInfo(null);

      const res = await connectWebUntisAccount({
        server: server.trim(),
        school: school.trim(),
        username: username.trim(),
        secret: secret.trim(),
        authMethod,
      });

      setSuccessInfo(`Erfolgreich verbunden als: ${res.teacherName || res.teacherShort}`);
      onSuccess(res);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verbindung fehlgeschlagen. Bitte Zugangsdaten prüfen.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Möchten Sie Ihr persönliches WebUntis-Konto wirklich trennen?')) {
      return;
    }

    try {
      setDisconnecting(true);
      setError(null);
      await disconnectWebUntisAccount();
      onDisconnected();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trennen fehlgeschlagen.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 id="connect-modal-title" className="text-base font-bold text-slate-100">
                Eigenes WebUntis-Konto verknüpfen
              </h2>
              <p className="text-xs text-slate-400">
                Stundenplan, fehlender Lehrstoff & Anwesenheitskontrolle
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
            aria-label="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Active Connection Notice (if connected) */}
          {accountStatus?.connected && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <p className="font-bold text-emerald-300">
                    Aktuell verbunden als Lehrkraft: {currentTeacherShort || currentUsername}
                  </p>
                  <p className="text-emerald-400/80 mt-0.5 text-[11px]">
                    Benutzer: <span className="font-mono">{currentUsername}</span> ({currentSchool})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-semibold transition shrink-0 flex items-center gap-1.5"
              >
                {disconnecting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
                <span>Konto trennen</span>
              </button>
            </div>
          )}

          {/* Intro Explanation */}
          <p className="text-xs text-slate-300 leading-relaxed">
            Verbinden Sie Ihren persönlichen WebUntis-Zugang, damit SMILE automatisch Ihre Stunden abgleicht,
            Sie an fehlenden Lehrstoff und nicht geprüfte Anwesenheiten erinnert und Vorfälle direkt in Ihrem Namen erfasst.
          </p>

          <form onSubmit={handleConnect} className="space-y-4">
            {/* Server & School Preset Chips */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 flex items-center justify-between">
                <span>Schul-Server</span>
                <span className="text-[11px] text-slate-500">Schnellauswahl:</span>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectPreset('telfs')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold border transition flex items-center justify-center gap-1.5 ${
                    school === 'ms-telfs'
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <Server className="w-3 h-3" />
                  <span>MS-Telfs (Live)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectPreset('playground')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold border transition flex items-center justify-center gap-1.5 ${
                    school !== 'ms-telfs'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <Server className="w-3 h-3" />
                  <span>Spielwiese (Test)</span>
                </button>
              </div>
            </div>

            {/* Server Host & School Identifier */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Server Host</label>
                <input
                  type="text"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="ms-telfs.webuntis.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Schulname / ID</label>
                <input
                  type="text"
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                  placeholder="ms-telfs"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  required
                />
              </div>
            </div>

            {/* Auth Method Toggle */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-slate-400">Anmeldeverfahren</label>
              <div className="grid grid-cols-2 gap-2 bg-slate-800/60 p-1 rounded-xl border border-slate-700/80">
                <button
                  type="button"
                  onClick={() => setAuthMethod('password')}
                  className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold transition ${
                    authMethod === 'password'
                      ? 'bg-sky-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  WebUntis-Passwort
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMethod('loginkey')}
                  className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold transition ${
                    authMethod === 'loginkey'
                      ? 'bg-sky-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Untis-Login-Key / 2FA
                </button>
              </div>
            </div>

            {/* Username & Secret */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  WebUntis Benutzername
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="z. B. dames oder Lehrkraft-Kürzel"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {authMethod === 'password' ? 'WebUntis Passwort' : 'WebUntis Login-Key / OTP-Geheimnis'}
                </label>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  required
                />
              </div>
            </div>

            {/* Error & Success Feedback */}
            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successInfo && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{successInfo}</span>
              </div>
            )}

            {/* Privacy Note */}
            <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>
                Ihre Anmeldedaten werden mit AES-256-GCM verschlüsselt auf dem Server gespeichert und dienen ausschließlich der
                Echtzeit-Synchronisierung Ihres Klassenbuchs.
              </span>
            </div>

            {/* Submit Button */}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-sky-500 hover:bg-sky-400 text-slate-950 transition flex items-center gap-2 shadow-md shadow-sky-500/20 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Prüfe Verbindung...</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Verbindung testen & verknüpfen</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
