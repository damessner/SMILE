import React, { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, Mail, Save, X } from 'lucide-react';
import type { NotificationClassSubscription } from '../types';
import { getNotificationPreferences, saveNotificationPreferences } from '../services/api';
import { useToast } from './Toast';

interface NotificationSettingsModalProps {
  onClose: () => void;
}

type FlagKey = 'green' | 'yellow' | 'red' | 'timeout' | 'cooldown' | 'weeklyDigest';

const FLAGS: Array<{ key: FlagKey; label: string; short: string; className: string }> = [
  { key: 'green', label: 'Grüne Karten', short: 'Grün', className: 'accent-emerald-500' },
  { key: 'yellow', label: 'Gelbe Karten', short: 'Gelb', className: 'accent-amber-500' },
  { key: 'red', label: 'Rote Karten', short: 'Rot', className: 'accent-rose-500' },
  { key: 'timeout', label: 'Time-Outs', short: 'Time-Out', className: 'accent-orange-500' },
  { key: 'cooldown', label: 'Cool-Downs', short: 'Cool-Down', className: 'accent-sky-500' },
  { key: 'weeklyDigest', label: 'Wochenübersicht', short: 'Woche', className: 'accent-violet-500' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasAnyFlag(row: NotificationClassSubscription): boolean {
  return FLAGS.some((flag) => row[flag.key]);
}

export function NotificationSettingsModal({ onClose }: NotificationSettingsModalProps) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [classes, setClasses] = useState<NotificationClassSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getNotificationPreferences()
      .then((data) => {
        if (cancelled) return;
        setEmail(data.email ?? '');
        setClasses(data.classes ?? []);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message || 'Benachrichtigungen konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCount = useMemo(() => classes.filter(hasAnyFlag).length, [classes]);

  const setFlag = (classId: number, key: FlagKey, value: boolean) => {
    setClasses((prev) =>
      prev.map((row) => (row.classId === classId ? { ...row, [key]: value } : row)),
    );
  };

  const toggleAll = (key: FlagKey) => {
    const allOn = classes.every((row) => row[key]);
    setClasses((prev) => prev.map((row) => ({ ...row, [key]: !allOn })));
  };

  const handleSave = async () => {
    const active = classes.filter(hasAnyFlag);
    if (active.length > 0 && !EMAIL_RE.test(email.trim())) {
      toast.error('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }

    setSaving(true);
    try {
      await saveNotificationPreferences({
        email: email.trim(),
        subscriptions: active.map((row) => ({
          classId: row.classId,
          green: row.green,
          yellow: row.yellow,
          red: row.red,
          timeout: row.timeout,
          cooldown: row.cooldown,
          weeklyDigest: row.weeklyDigest,
        })),
      });
      toast.success(
        active.length > 0
          ? `Benachrichtigungen für ${active.length} Klasse(n) gespeichert.`
          : 'Benachrichtigungen entfernt.',
      );
      onClose();
    } catch (e: any) {
      toast.error(e.message || 'Benachrichtigungen konnten nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center scrim p-3 backdrop-blur-md sm:p-6">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-accent/15 p-2 text-accent">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-50">E-Mail-Benachrichtigungen</h2>
              <p className="mt-0.5 text-sm text-slate-400">
                Eigene Meldungen pro Klasse zusammenstellen. Die Adresse wird ohne Bestätigung
                gespeichert.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-800 p-2 text-slate-400 transition hover:bg-slate-700 hover:text-slate-50"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label className="mb-1.5 block text-2xs font-bold uppercase tracking-wide text-slate-400">
            Empfängeradresse
          </label>
          <div className="relative max-w-xl">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="lehrkraft@schule.at"
              className="min-h-[44px] w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-slate-50 placeholder-slate-600 focus:border-amber-400 focus:outline-none"
              autoComplete="email"
            />
          </div>
          <p className="mt-2 max-w-2xl text-2xs leading-relaxed text-amber-300/90">
            Die Mails enthalten Schülernamen, Klasse und die Notiz der Lehrkraft. Nur für
            Schulpersonal bestimmt. Bitte die Adresse sorgfältig eingeben.
          </p>

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Lade Klassen…</div>
          ) : (
            <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-950/95 text-2xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5 font-bold">Klasse</th>
                    {FLAGS.map((flag) => (
                      <th key={flag.key} className="px-2 py-2.5 text-center font-bold">
                        <button
                          type="button"
                          onClick={() => toggleAll(flag.key)}
                          className="inline-flex flex-col items-center gap-0.5 text-slate-400 transition hover:text-slate-100"
                          title={`${flag.label}: alle Klassen ein-/ausschalten`}
                        >
                          <span>{flag.short}</span>
                          <span className="text-2xs font-normal normal-case text-slate-600">
                            alle
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {classes.map((row) => (
                    <tr
                      key={row.classId}
                      className={hasAnyFlag(row) ? 'bg-slate-800/30' : 'hover:bg-slate-800/20'}
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-100">
                        {row.className}
                      </td>
                      {FLAGS.map((flag) => (
                        <td key={flag.key} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={row[flag.key]}
                            onChange={(event) => setFlag(row.classId, flag.key, event.target.checked)}
                            className={`h-5 w-5 cursor-pointer rounded border-slate-600 bg-slate-900 ${flag.className}`}
                            aria-label={`${row.className}: ${flag.label}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/60 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <CalendarDays className="h-4 w-4 text-violet-400" />
            <span>
              Wochenübersicht: montags ab 07:00 für die Vorwoche, pro ausgewählter Klasse.
            </span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="mr-2 text-sm text-slate-500">
              {selectedCount} Klasse(n) aktiv
            </span>
            <button
              onClick={onClose}
              className="min-h-[44px] rounded-xl bg-slate-800 px-4 text-sm font-bold text-slate-300 transition hover:bg-slate-700"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 text-sm font-bold text-slate-950 shadow-lg transition hover:from-amber-400 hover:to-amber-500 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Speichere…' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
