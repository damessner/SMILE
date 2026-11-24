import React, { useState } from 'react';
import { LogIn } from 'lucide-react';
import { login } from '../services/api';
import { User } from '../types';

interface LoginModalProps {
  onSuccess: (user: User) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError('');

    try {
      // The session token is set as an httpOnly cookie by the server. Nothing is
      // stored in localStorage, so an XSS bug cannot read the session.
      const data = await login(username, password);
      onSuccess(data.user);
    } catch (err: any) {
      setError(err.message || 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center scrim backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-lg relative overflow-hidden">
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center mb-8 relative">
          <div className="inline-flex items-center justify-center rounded-2xl bg-white/95 px-6 py-3.5 mb-4 shadow-md border border-slate-200/70">
            <img src="/smile-logo.svg" alt="SMILE" className="h-12 w-auto" />
          </div>
          <h1 className="sr-only">SMILE Plattform</h1>
          <p className="text-sm text-slate-400">
            MS Weissenbach · Beobachtung &amp; Konferenz
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2"
            >
              Benutzername / Lehrerkürzel
            </label>
            <input
              id="username"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="z.B. ofj, zia, brt oder admin"
              className="w-full px-4 py-3.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400 focus-ring transition"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2"
            >
              Passwort
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400 focus-ring transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-[0.99] text-slate-950 font-bold flex items-center justify-center gap-2 shadow-lg shadow-sm transition disabled:opacity-50"
          >
            {loading ? (
              <span className="inline-block w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                <span>Anmelden</span>
              </>
            )}
          </button>
        </form>

        {/*
          The published shared default ("smile2026" for every teacher, "admin123" for
          the administrator) has been removed. New accounts start with a shared initial
          password and must change it at first login.
        */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 text-center space-y-1">
          <p className="text-sm text-slate-500">
            Zugangsdaten erhalten Sie von der Schulleitung. Das Startpasswort muss beim
            ersten Anmelden geändert werden.
          </p>
          <p className="text-sm text-slate-600">
            Passwort vergessen? Bitte die Schulleitung kontaktieren.
          </p>
        </div>
      </div>
    </div>
  );
};