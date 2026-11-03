import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

/**
 * Light / dark theme.
 *
 * Dark remains the default: the app is used in bright classrooms and on a beamer.
 *
 * Implementation note: the whole palette flips via CSS variables applied to
 * `document.documentElement` (see index.css). No component needs to know which
 * theme is active, which is why all ~1,300 colour declarations follow along
 * without being touched.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'smile_theme';

interface ThemeApi {
  theme: Theme;
  toggle: () => void;
  /** Render prop helper for contexts that must stay dark (beamer / conference). */
  forceDark: (enabled: boolean) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

/**
 * Read the stored preference and apply it.
 *
 * Also runs as an inline script in index.html before React mounts — without that,
 * a light-theme user sees a dark flash on every page load.
 */
export function applyStoredTheme(): Theme {
  let theme: Theme = 'dark';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    }
  } catch {
    // Private browsing or storage disabled: fall back to dark.
  }
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'dark';
    return (document.documentElement.getAttribute('data-theme') as Theme) || 'dark';
  });

  const set = useCallback((next: Theme) => {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply will not persist; the session still honours it.
    }
  }, []);

  const toggle = useCallback(() => {
    set(theme === 'dark' ? 'light' : 'dark');
  }, [theme, set]);

  const forceDark = useCallback((enabled: boolean) => {
    if (enabled) {
      document.documentElement.setAttribute('data-force-dark', '');
    } else {
      document.documentElement.removeAttribute('data-force-dark');
    }
  }, []);

  // Keep multiple tabs consistent.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === 'light' || e.newValue === 'dark') {
        setTheme(e.newValue);
        document.documentElement.setAttribute('data-theme', e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const api = useMemo(() => ({ theme, toggle, forceDark }), [theme, toggle, forceDark]);

  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used inside <ThemeProvider>');
  return ctx;
}

/** Compact toggle for the header bar. */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme, toggle } = useTheme();
  const nextLabel = theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren';

  return (
    <button
      onClick={toggle}
      title={nextLabel}
      aria-label={nextLabel}
      aria-pressed={theme === 'light'}
      className={`pressable focus-ring min-h-[44px] min-w-[44px] rounded-lg
                  bg-slate-800 border border-slate-700 text-slate-300
                  hover:bg-slate-700 hover:text-slate-50 transition flex items-center justify-center ${className}`}
    >
      {theme === 'dark' ? (
        <Sun className="w-4 h-4" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4" aria-hidden="true" />
      )}
    </button>
  );
};