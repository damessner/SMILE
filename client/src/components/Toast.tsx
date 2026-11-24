import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X, Undo2 } from 'lucide-react';

/**
 * Toast system.
 *
 * Replaces the native `alert()` / `window.confirm()` calls that previously
 * interrupted nearly every action in the Schulalltag. Native dialogs block the
 * whole page, cannot be styled, and read as a crash next to an otherwise
 * polished dark interface — including for SUCCESS messages, which is exactly
 * when a teacher most needs to keep moving.
 */

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  /** Optional inline action, e.g. "Rückgängig". Extends the display time. */
  action?: ToastAction;
  durationMs: number;
  onDismiss?: () => void;
}

interface ToastApi {
  success: (message: string, opts?: { action?: ToastAction }) => number;
  error: (message: string) => number;
  info: (message: string, opts?: { action?: ToastAction }) => number;
  /** Show a toast with an explicit action button, e.g. a 5-second undo window. */
  withAction: (message: string, action: ToastAction, variant?: ToastVariant) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 4000;
/** Longer when an action is attached: 4 seconds is not enough to notice and tap "Rückgängig". */
const ACTION_DURATION = 8000;

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => {
      const target = prev.find((t) => t.id === id);
      target?.onDismiss?.();
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string, action?: ToastAction, onDismiss?: () => void) => {
      const id = nextId.current++;
      const toast: Toast = {
        id,
        variant,
        message,
        action,
        durationMs: action ? ACTION_DURATION : DEFAULT_DURATION,
        onDismiss,
      };
      // Keep the stack short so toasts never cover the pupil list.
      setToasts((prev) => [...prev, toast].slice(-MAX_VISIBLE));
      return id;
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, opts) => push('success', message, opts?.action),
      error: (message) => push('error', message),
      info: (message, opts) => push('info', message, opts?.action),
      withAction: (message, action, variant = 'info') => push(variant, message, action),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() must be used inside <ToastProvider>');
  return ctx;
}

/*
  The toast surface follows the theme (slate-900 is the raised card colour in both
  themes); only the border and icon carry the semantic colour. The previous
  `bg-emerald-950/95` stayed dark green in light mode while the app around it turned
  white — a black-looking card with near-white text.
*/
const VARIANT_STYLE: Record<ToastVariant, { wrap: string; icon: React.ReactNode }> = {
  success: {
    wrap: 'bg-slate-900/95 border-emerald-500/50 text-slate-100',
    icon: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden="true" />,
  },
  error: {
    wrap: 'bg-slate-900/95 border-rose-500/50 text-slate-100',
    icon: <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" aria-hidden="true" />,
  },
  info: {
    wrap: 'bg-slate-900/95 border-slate-600/60 text-slate-100',
    icon: <Info className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />,
  },
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      // Bottom-centre: reachable with a thumb on a held iPad, and clear of the
      // pupil rows in the middle of the screen.
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2
                 items-center w-[min(28rem,calc(100vw-2rem))] pointer-events-none"
      role="region"
      aria-label="Benachrichtigungen"
      aria-live="off"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [remaining, setRemaining] = useState(toast.durationMs);
  const [paused, setPaused] = useState(false);
  const startedAt = useRef(Date.now());
  const style = VARIANT_STYLE[toast.variant];

  useEffect(() => {
    startedAt.current = Date.now();
    setRemaining(toast.durationMs);
  }, [toast.durationMs]);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      setRemaining((r) => {
        if (r <= 250) {
          clearInterval(interval);
          return 0;
        }
        return r - 250;
      });
    }, 250);
    return () => clearInterval(interval);
  }, [paused]);

  useEffect(() => {
    if (remaining <= 0) onDismiss(toast.id);
  }, [remaining, toast.id, onDismiss]);

  const handleAction = async () => {
    await toast.action?.onClick();
    onDismiss(toast.id);
  };

  const seconds = Math.ceil(remaining / 1000);

  return (
    <div
      className={`pointer-events-auto w-full rounded-2xl border px-4 py-3 shadow-lg
                  backdrop-blur-md flex items-start gap-3 animate-[toast-in_180ms_ease-out] ${style.wrap}`}
      role="status"
      aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {style.icon}

      <p className="flex-1 text-sm font-semibold leading-snug pt-0.5">{toast.message}</p>

      {toast.action && (
        <button
          onClick={handleAction}
          className="pressable focus-ring shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl
                     bg-slate-800/10 hover:bg-slate-800/20 text-sm font-bold transition"
        >
          <Undo2 className="w-4 h-4" aria-hidden="true" />
          {toast.action.label}
        </button>
      )}

      {seconds > 0 && (
        <span className="shrink-0 text-2xs tabular-nums opacity-60 pt-1 w-6 text-right">
          {seconds}
        </span>
      )}

      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Meldung schließen"
        className="pressable focus-ring shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg
                   hover:bg-slate-800/10 transition"
      >
        <X className="w-4 h-4 opacity-70" aria-hidden="true" />
      </button>
    </div>
  );
}