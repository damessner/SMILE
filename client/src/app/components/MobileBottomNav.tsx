import { BarChart3, BookOpen, Calendar, ClipboardList, Clock } from 'lucide-react';
import { withViewTransition } from '../../lib/viewTransition';
import type { AppTab } from '../types';

export interface MobileBottomNavProps {
  activeTab: AppTab;
  schulalltagView: 'class' | 'lw' | 'all';
  lwActiveCount?: number;
  onSelectTab: (tab: AppTab, subView?: 'class' | 'lw') => void;
}

/**
 * Mobile bottom navigation bar for phones and narrow tablets.
 * Renders the 5 core SMILE modules cleanly with safe-area padding.
 */
export function MobileBottomNav({
  activeTab,
  schulalltagView,
  lwActiveCount = 0,
  onSelectTab,
}: MobileBottomNavProps) {
  const items: Array<{
    key: string;
    label: string;
    tab: AppTab;
    subView?: 'class' | 'lw';
    active: boolean;
    badge?: number;
    Icon: typeof Calendar;
  }> = [
    {
      key: 'schulalltag',
      label: 'Alltag',
      tab: 'schulalltag',
      subView: 'class',
      active: activeTab === 'schulalltag' && schulalltagView !== 'lw',
      Icon: Calendar,
    },
    {
      key: 'lw',
      label: 'LW',
      tab: 'schulalltag',
      subView: 'lw',
      active: activeTab === 'schulalltag' && schulalltagView === 'lw',
      badge: lwActiveCount,
      Icon: Clock,
    },
    {
      key: 'bewertung',
      label: 'Einstufung',
      tab: 'bewertung',
      active: activeTab === 'bewertung',
      Icon: ClipboardList,
    },
    {
      key: 'webuntis',
      label: 'WebUntis',
      tab: 'webuntis',
      active: activeTab === 'webuntis',
      Icon: BookOpen,
    },
    {
      key: 'statistics',
      label: 'Statistik',
      tab: 'statistics',
      active: activeTab === 'statistics',
      Icon: BarChart3,
    },
  ];

  return (
    <nav
      aria-label="Mobile Hauptnavigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 material-bottom-bar safe-bottom no-print"
    >
      <div className="flex items-center justify-around h-16 px-1">
        {items.map(({ key, label, tab, subView, active, badge, Icon }) => (
          <a
            key={key}
            href={`#${key}`}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              withViewTransition(() => onSelectTab(tab, subView));
            }}
            className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-12 rounded-xl transition-colors focus-ring ${
              active
                ? 'text-accent font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="relative">
              <Icon className="w-5 h-5" aria-hidden="true" />
              {typeof badge === 'number' && badge > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-critical text-surface-lowest text-2xs font-bold flex items-center justify-center leading-none">
                  {badge}
                </span>
              )}
            </span>
            <span className="text-2xs leading-tight">{label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
