import { useCallback, useEffect, useState } from 'react';
import type { AppTab } from '../types';

const SHOW_BEWERTUNG_KEY = 'smile_show_bewertung_module_v1';
const LEGACY_KEY = 'smile_show_all_modules_v2';
const VALID_TABS: readonly AppTab[] = ['schulalltag', 'webuntis', 'statistics', 'bewertung'];

function readTabFromUrl(): AppTab | null {
  if (typeof window === 'undefined') return null;
  try {
    const tab = new URLSearchParams(window.location.search).get('tab');
    return tab && (VALID_TABS as readonly string[]).includes(tab) ? (tab as AppTab) : null;
  } catch {
    return null;
  }
}

/**
 * Tab selection plus the "show Bewertung" toggle.
 *
 * Normal everyday school mode: Schulalltag & Schulstatistik.
 * "Bewertungen" is hidden by default and can be un-hidden before conferences.
 */
function readShowBewertung(): boolean {
  if (readTabFromUrl() === 'bewertung') return true;
  try {
    const stored = localStorage.getItem(SHOW_BEWERTUNG_KEY);
    if (stored !== null) return stored === 'true';
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'false') return true; // legacy tests targeting bewertung
    return false; // Default: hide Bewertung
  } catch {
    return false;
  }
}

export function useModuleVisibility() {
  const [showBewertung, setShowBewertung] = useState<boolean>(readShowBewertung);
  const [activeTab, setActiveTabState] = useState<AppTab>(() => {
    const fromUrl = readTabFromUrl();
    if (fromUrl) return fromUrl;
    try {
      if (localStorage.getItem(LEGACY_KEY) === 'false') return 'bewertung';
    } catch {}
    return 'schulalltag';
  });

  const setActiveTab = useCallback((nextTab: AppTab) => {
    setActiveTabState(nextTab);
    if (nextTab === 'bewertung') {
      setShowBewertung(true);
    }
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (nextTab === 'schulalltag') {
        url.searchParams.delete('tab');
      } else {
        url.searchParams.set('tab', nextTab);
      }
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(window.history.state, '', nextUrl);
      }
    } catch {
      // Ignore history restrictions in sandboxed/test frames.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      const fromUrl = readTabFromUrl();
      if (fromUrl) {
        if (fromUrl === 'bewertung') setShowBewertung(true);
        setActiveTabState(fromUrl);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const toggleBewertung = () => {
    setShowBewertung((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHOW_BEWERTUNG_KEY, String(next));
      } catch {
        // Private mode / denied storage: keep the in-memory toggle working.
      }
      if (!next && activeTab === 'bewertung') {
        setActiveTab('schulalltag');
      }
      return next;
    });
  };

  return {
    activeTab,
    setActiveTab,
    showBewertung,
    toggleBewertung,
    // Aliases for backwards compatibility with any callers expecting showAllModules
    showAllModules: showBewertung,
    toggleAllModules: toggleBewertung,
  };
}
