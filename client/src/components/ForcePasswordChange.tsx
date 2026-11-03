import React, { useState } from 'react';
import { KeyRound, LogOut, ShieldAlert } from 'lucide-react';
import { changePassword, ApiError } from '../services/api';
import { User } from '../types';

interface Props {
  user: User;
  onChanged: (user: User) => void;
  onLogout: () => void;
}

/**
 * Shown when an account is still on its bootstrap password.
 *
 * The server independently rejects every mutating endpoint with
 * PASSWORD_CHANGE_REQUIRED while `must_change_password` is set, so this is a
 * convenience layer rather than the only control.
 */
export const ForcePasswordChange: React.FC<Props> = ({ user, onChanged, onLogout }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    if (newPassword.length < 12) {
      setError('Das neue Passwort muss mindestens 12 Zeichen lang sein.');
      return;
    }
    if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Das Passwort muss Groß- und Kleinbuchstaben sowie eine Ziffer enthalten.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Das neue Passwort muss sich vom bisherigen unterscheiden.');
      return;
    }

    setLoading(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      onChanged(result.user);
    } catch (err: any) {
      setError(
        err instanceof ApiError
          ? err.message
          : err.message || 'Das Passwort konnte nicht geändert werden.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-lg">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 mb-4 border border-amber-500/30">
            <KeyRound className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-50 mb-2">
            Passwort ändern
          </h1>
          <p className="text-sm text-slate-400">
            Guten Tag {user.teacher?.fullName || user.username}. Bevor Sie fortfahren
            können, muss das Startpasswort geändert werden.
          </p>
        </div>

        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-200/90">
            Das bisherige Startpasswort gilt für mehrere Konten und ist damit nicht mehr
            sicher. Bewerten, Karten und Konferenzentscheidungen sind bis zur Änderung
            gesperrt.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="cur"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2"
            >
              Bisheriges Passwort
            </label>
            <input
              id="cur"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-4 py-3.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-50 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
            />
          </div>

          <div>
            <label
              htmlFor="new"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2"
            >
              Neues Passwort
            </label>
            <input
              id="new"
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-3.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-50 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Mindestens 12 Zeichen, davon Groß- und Kleinbuchstaben sowie eine Ziffer.
            </p>
          </div>

          <div>
            <label
              htmlFor="conf"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2"
            >
              Neues Passwort bestätigen
            </label>
            <input
              id="conf"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-50 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold shadow-lg shadow-sm transition disabled:opacity-50"
            >
              {loading ? 'Wird gespeichert …' : 'Passwort ändern'}
            </button>
            <button
              type="button"
              onClick={onLogout}
              title="Abmelden"
              className="px-5 py-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};