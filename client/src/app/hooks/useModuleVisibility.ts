import { useState } from 'react';
import type { AppTab } from '../types';

const SHOW_BEWERTUNG_KEY = 'smile_show_bewertung_module_v1';
const LEGACY_KEY = 'smile_show_all_modules_v2';

/**
 * Tab selection plus the "show Bewertung" toggle.
 *
 * Normal everyday school mode: Schulalltag & Schulstatistik.
 * "Bewertungen" is hidden by default and can be un-hidden before conferences.
 */
function readShowBewertung(): boolean {
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
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    try {
      if (localStorage.getItem(LEGACY_KEY) === 'false') return 'bewertung';
    } catch {}
    return 'schulalltag';
  });

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
