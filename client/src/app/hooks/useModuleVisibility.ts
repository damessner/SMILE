import { useState } from 'react';
import type { AppTab } from '../types';

const SHOW_ALL_MODULES_KEY = 'smile_show_all_modules';

/**
 * Tab selection plus the "show all modules" toggle. Schulalltag and Schulstatistik
 * are hidden by default; the toggle persists to localStorage.
 */
export function useModuleVisibility() {
  // Default to 'bewertung'; Schulalltag & Schulstatistik are hidden by default
  const [activeTab, setActiveTab] = useState<AppTab>('bewertung');
  const [showAllModules, setShowAllModules] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SHOW_ALL_MODULES_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleAllModules = () => {
    setShowAllModules((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHOW_ALL_MODULES_KEY, String(next));
      } catch {
        // Private mode / denied storage: keep the in-memory toggle working.
      }
      if (!next && (activeTab === 'schulalltag' || activeTab === 'statistics')) {
        setActiveTab('bewertung');
      }
      return next;
    });
  };

  return { activeTab, setActiveTab, showAllModules, toggleAllModules };
}
