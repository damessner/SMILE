import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Promise-based confirmation dialog.
 *
 * Replaces `window.confirm()`, which blocks the whole page, cannot be styled and
 * renders in the browser's own chrome — jarring in an otherwise dark interface,
 * and on an iPad it looks like a system prompt rather than part of the app.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: '…', message: '…' }))) return;
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for destructive, 'default' otherwise. */
  tone?: 'default' | 'danger';
}

type Resolver = (value: boolean) => void;

const ConfirmContext = createContext<
  ((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    // A second confirm while one is open resolves the first as cancelled rather
    // than leaving a promise permanently pending.
    resolver.current?.(false);
    setRequest(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);

  const api = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {request && <ConfirmDialog {...request} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm() must be used inside <ConfirmProvider>');
  return ctx;
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  tone = 'default',
  onSettle,
}: ConfirmOptions & { onSettle: (value: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const danger = tone === 'danger';

  // For a destructive action the safe choice gets focus, so a stray Enter does
  // not delete/archive/restore anything. Non-destructive confirmations keep the
  // fast Enter-to-confirm behaviour.
  React.useEffect(() => {
    (danger ? cancelRef : confirmRef).current?.focus();
  }, [danger]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center scrim backdrop-blur-sm p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onSettle(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={message ? 'confirm-message' : undefined}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-lg"
      >
        <div className="flex items-start gap-3 mb-4">
          {danger && (
            <div className="shrink-0 w-10 h-10 rounded-xl bg-rose-500/15 text-rose-400
                            flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            </div>
          )}
          <h3 id="confirm-title" className="text-lg font-extrabold text-slate-50 pt-1.5 leading-tight">
            {title}
          </h3>
        </div>

        {message && (
          <p id="confirm-message" className="text-sm text-slate-300 leading-relaxed mb-6">
            {message}
          </p>
        )}

        <div className="flex gap-3">
          <button
            ref={cancelRef}
            onClick={() => onSettle(false)}
            className="flex-1 min-h-[44px] px-4 rounded-xl bg-slate-800 border border-slate-700
                       text-slate-200 font-bold hover:bg-slate-700 transition"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={() => onSettle(true)}
            className={`flex-1 min-h-[44px] px-4 rounded-xl font-bold text-slate-50 transition
              ${danger
                ? 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-sm'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}