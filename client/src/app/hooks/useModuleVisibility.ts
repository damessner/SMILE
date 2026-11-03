import { useState } from 'react';
import type { AppTab } from '../types';

const SHOW_ALL_MODULES_KEY = 'smile_show_all_modules_v2';

/**
 * Tab selection plus the "show all modules" toggle.
 *
 * The first page is now the teacher's current lesson (Schulalltag). The old
 * key is intentionally not read: a previously hidden-modules preference must
 * not send every teacher back to the Bewertung tab on the next login.
 */
function readShowAllModules(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_ALL_MODULES_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function useModuleVisibility() {
  const [showAllModules, setShowAllModules] = useState<boolean>(readShowAllModules);
  const [activeTab, setActiveTab] = useState<AppTab>(() =>
    readShowAllModules() ? 'schulalltag' : 'bewertung',
  );

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
