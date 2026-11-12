import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Snowflake,
  Users,
} from 'lucide-react';
import type {
  BehaviorOverview,
  BehaviorOverviewPupil,
} from '../services/api';
import { Button, EmptyState, Skeleton } from './ui';

export type AllClassesAction = 'green' | 'yellow' | 'red' | 'timeout' | 'cooldown';

interface AllClassesBehaviorPanelProps {
  data: BehaviorOverview | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onAction: (pupil: BehaviorOverviewPupil, action: AllClassesAction) => void;
}

const ACTION_STYLES: Array<{
  action: AllClassesAction;
  label: string;
  title: string;
  className: string;
  icon: React.ReactNode;
}> = [
  {
    action: 'green',
    label: 'Grün',
    title: 'Grüne Karte vergeben (Lob)',
    className: 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/30',
    icon: <Plus className="w-3.5 h-3.5" aria-hidden="true" />,
  },
  {
    action: 'yellow',
    label: 'Gelb',
    title: 'Gelbe Karte vergeben (Mahnung)',
    className: 'bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border-amber-500/30',
    icon: <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />,
  },
  {
    action: 'red',
    label: 'Rot',
    title: 'Rote Karte vergeben (sofortiger Rangverlust)',
    className: 'bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 border-rose-500/40',
    icon: <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />,
  },
  {
    action: 'timeout',
    label: 'Timeout',
    title: 'Ins Time-Out (Lernwerkstatt) schicken',
    className: 'bg-gradient-to-r from-amber-500/25 to-rose-500/25 hover:from-amber-500/40 hover:to-rose-500/40 text-amber-200 border-amber-500/40',
    icon: <Clock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />,
  },
  {
    action: 'cooldown',
    label: 'Cool-Down',
    title: 'Cool-Down in die Lernwerkstatt (kein Rangverlust, Notiz möglich)',
    className: 'bg-sky-500/15 hover:bg-sky-500/30 text-sky-200 border-sky-500/40',
    icon: <Snowflake className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />,
  },
];

function rankClass(rank: BehaviorOverviewPupil['rank']): string {
  if (rank === 'Meister') return 'bg-amber-400/20 text-amber-300 border-amber-400/40';
  if (rank === 'Geselle') return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
  if (rank === 'Lehrling') return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
  return 'bg-slate-800 text-slate-400 border-slate-700';
}

function stageClass(level: number): string {
  if (level > 0) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (level < 0) return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  return 'bg-slate-800 text-slate-300 border-slate-700';
}

interface SummaryTile {
  key: string;
  label: string;
  value: number;
  hint?: string;
  tone: 'neutral' | 'green' | 'amber' | 'rose' | 'orange' | 'sky';
}

const TILE_TONE: Record<SummaryTile['tone'], { ring: string; value: string; dot: string }> = {
  neutral: { ring: 'border-slate-700', value: 'text-slate-100', dot: 'bg-slate-400' },
  green: { ring: 'border-emerald-500/30', value: 'text-emerald-300', dot: 'bg-emerald-400' },
  amber: { ring: 'border-amber-500/30', value: 'text-amber-300', dot: 'bg-amber-400' },
  rose: { ring: 'border-rose-500/30', value: 'text-rose-300', dot: 'bg-rose-400' },
  orange: { ring: 'border-orange-500/30', value: 'text-orange-300', dot: 'bg-orange-400' },
  sky: { ring: 'border-sky-500/30', value: 'text-sky-300', dot: 'bg-sky-400' },
};

/**
 * "Alle Klassen" — the school-wide behaviour surface.
 *
 * One row per active pupil with the status a teacher needs and the same five quick
 * actions the class view offers. The header is a compact status board rather than a
 * second toolbar: a teacher glancing over the school wants totals first, pupils second.
 */
export const AllClassesBehaviorPanel: React.FC<AllClassesBehaviorPanelProps> = ({
  data,
  loading,
  error,
  onRefresh,
  onAction,
}) => {
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<'all' | number>('all');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // A refresh replaces the data object; use that as the timestamp of what is on screen.
  useEffect(() => {
    if (data) setUpdatedAt(new Date());
  }, [data]);

  // Totals follow the selected class; the search box only narrows the visible rows.
  const summary = useMemo<SummaryTile[]>(() => {
    const pupils = (data?.pupils ?? []).filter(
      (pupil) => classFilter === 'all' || pupil.classId === classFilter,
    );
    const totals = { green: 0, yellow: 0, red: 0, timeout: 0, cooldown: 0 };
    let activeTimeouts = 0;
    let activeCooldowns = 0;
    for (const pupil of pupils) {
      totals.green += pupil.counts.green;
      totals.yellow += pupil.counts.yellow;
      totals.red += pupil.counts.red;
      totals.timeout += pupil.counts.timeout;
      totals.cooldown += pupil.counts.cooldown;
      if (pupil.activeIncident?.kind === 'timeout') activeTimeouts += 1;
      if (pupil.activeIncident?.kind === 'cooldown') activeCooldowns += 1;
    }
    const classCount = new Set(pupils.map((pupil) => pupil.classId)).size;

    return [
      { key: 'pupils', label: 'Schüler*innen', value: pupils.length, hint: classCount === 1 ? '1 Klasse' : `${classCount} Klassen`, tone: 'neutral' },
      { key: 'green', label: 'Grüne Karten', value: totals.green, tone: 'green' },
      { key: 'yellow', label: 'Gelbe Karten', value: totals.yellow, tone: 'amber' },
      { key: 'red', label: 'Rote Karten', value: totals.red, tone: 'rose' },
      { key: 'timeout', label: 'Time-Outs', value: totals.timeout, hint: activeTimeouts > 0 ? `${activeTimeouts} aktiv` : undefined, tone: 'orange' },
      { key: 'cooldown', label: 'Cool-Downs', value: totals.cooldown, hint: activeCooldowns > 0 ? `${activeCooldowns} aktiv` : undefined, tone: 'sky' },
    ];
  }, [data, classFilter]);

  // Pupils per class for the selection buttons; independent of the current search.
  const classCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const pupil of data?.pupils ?? []) {
      counts.set(pupil.classId, (counts.get(pupil.classId) ?? 0) + 1);
    }
    return counts;
  }, [data]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLowerCase();
    const filtered = data.pupils.filter((pupil) => {
      const matchesClass = classFilter === 'all' || pupil.classId === classFilter;
      const matchesName = normalized === '' || pupil.fullName.toLowerCase().includes(normalized);
      return matchesClass && matchesName;
    });

    const byClass = new Map<number, { id: number; name: string; grade: number; pupils: BehaviorOverviewPupil[] }>();
    for (const pupil of filtered) {
      const entry = byClass.get(pupil.classId) ?? {
        id: pupil.classId,
        name: pupil.className,
        grade: pupil.grade,
        pupils: [],
      };
      entry.pupils.push(pupil);
      byClass.set(pupil.classId, entry);
    }
    return Array.from(byClass.values()).sort(
      (a, b) => a.grade - b.grade || a.name.localeCompare(b.name, 'de'),
    );
  }, [data, query, classFilter]);

  const scopedPupils =
    classFilter === 'all'
      ? data?.pupils ?? []
      : (data?.pupils ?? []).filter((pupil) => pupil.classId === classFilter);
  const selectedClass =
    classFilter === 'all'
      ? null
      : (data?.classes ?? []).find((cls) => cls.id === classFilter) ?? null;
  const total = scopedPupils.length;
  const visible = grouped.reduce((sum, group) => sum + group.pupils.length, 0);
  const statusText =
    loading && !data
      ? 'Lade Schülerstatus…'
      : classFilter === 'all'
        ? `${visible} von ${total} Schüler*innen · ${classCounts.size} ${classCounts.size === 1 ? 'Klasse' : 'Klassen'}`
        : `Klasse ${selectedClass?.name ?? classFilter} · ${visible} von ${total} Schüler*innen`;

  return (
    <div className="space-y-3">
      {/* Status board: class buttons first, then search/filter. */}
      <section className="surface-1 rounded-2xl overflow-hidden shadow-lg">
        <div className="flex flex-col gap-3 p-4 border-b border-hairline">
          <h2 className="sr-only">Schülerstatus der Klassen</h2>
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2 text-slate-400">
                <Users className="w-4 h-4" aria-hidden="true" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Klasse auswählen</span>
              </div>
              <div
                role="group"
                aria-label="Klasse auswählen"
                className="flex flex-wrap items-center gap-1.5"
              >
                <button
                  type="button"
                  onClick={() => setClassFilter('all')}
                  aria-pressed={classFilter === 'all'}
                  className={`pressable focus-ring min-h-[40px] px-3 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${
                    classFilter === 'all'
                      ? 'bg-sky-500 text-slate-950 shadow-md'
                      : 'bg-slate-800/80 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-slate-50'
                  }`}
                >
                  <span>Alle</span>
                  <span
                    className={`text-[11px] tabular ${classFilter === 'all' ? 'text-slate-900/70' : 'text-slate-500'}`}
                  >
                    {data?.pupils.length ?? 0}
                  </span>
                </button>
                {(data?.classes ?? []).map((cls) => {
                  const active = classFilter === cls.id;
                  return (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => setClassFilter(cls.id)}
                      aria-pressed={active}
                      aria-label={`Klasse ${cls.name} auswählen`}
                      title={`Klasse ${cls.name}: ${classCounts.get(cls.id) ?? 0} Schüler*innen`}
                      className={`pressable focus-ring min-h-[40px] px-3 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${
                        active
                          ? 'bg-sky-500 text-slate-950 shadow-md'
                          : 'bg-slate-800/80 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-slate-50'
                      }`}
                    >
                      <span>{cls.name}</span>
                      <span
                        className={`text-[11px] tabular ${active ? 'text-slate-900/70' : 'text-slate-500'}`}
                      >
                        {classCounts.get(cls.id) ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-400 truncate">
                {statusText}
                {updatedAt && !loading && (
                  <span className="text-slate-500">
                    {' '}
                    · Stand{' '}
                    {updatedAt.toLocaleTimeString('de-AT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    Uhr
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full lg:w-auto">
              <div className="relative w-full sm:w-60">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Schüler suchen…"
                  aria-label="Schüler suchen"
                  className="w-full min-h-[44px] pl-9 pr-3 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-50 placeholder-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>
              <Button
                variant="secondary"
                onClick={onRefresh}
                disabled={loading}
                title="Status neu laden"
                className="shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Aktualisieren</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 p-3" aria-live="polite">
          {loading && !data
            ? Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-[76px]" />
              ))
            : summary.map((tile) => {
                const tone = TILE_TONE[tile.tone];
                return (
                  <div
                    key={tile.key}
                    className={`rounded-xl border bg-slate-900/50 px-3 py-2.5 ${tone.ring}`}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
                      <span className="truncate">{tile.label}</span>
                    </div>
                    <div className={`mt-0.5 text-2xl font-black tabular leading-none ${tone.value}`}>
                      {tile.value}
                    </div>
                    <div className="mt-1 h-3 text-[11px] font-semibold text-slate-500 truncate">
                      {tile.hint ?? ''}
                    </div>
                  </div>
                );
              })}
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={onRefresh} className="focus-ring underline underline-offset-2 font-bold shrink-0">
            Erneut laden
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1].map((section) => (
            <div key={section} className="surface-1 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-hairline">
                <Skeleton className="h-4 w-40" />
              </div>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-3 px-4 py-3 border-t border-hairline">
                  <Skeleton className="h-8 w-8 rounded-xl" />
                  <Skeleton className="h-3.5 w-1/4" />
                  <div className="ml-auto hidden sm:flex gap-1.5">
                    <Skeleton className="h-10 w-14 rounded-xl" />
                    <Skeleton className="h-10 w-14 rounded-xl" />
                    <Skeleton className="h-10 w-14 rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!loading && grouped.length === 0 && (
        <EmptyState
          icon={<Users className="h-6 w-6" aria-hidden="true" />}
          title="Keine Schüler*innen gefunden."
          description="Klassenauswahl oder Suche anpassen."
        />
      )}

      {grouped.map((group) => (
        <section key={group.id} className="surface-1 rounded-2xl shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950/60 border-b border-hairline">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-extrabold text-slate-50">Klasse {group.name}</span>
              <span className="text-[11px] font-bold text-slate-400">
                {group.pupils.length} Schüler*innen
              </span>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Status · Aktionen
            </span>
          </div>

          <div className="divide-y divide-hairline">
            {group.pupils.map((pupil) => (
              <div
                key={pupil.id}
                className="px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-slate-900/40 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-extrabold text-slate-50 truncate">{pupil.fullName}</span>
                    <span
                      className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold uppercase tracking-wide ${rankClass(pupil.rank)}`}
                      title="Bestätigter Konferenzrang (falls vorhanden)"
                    >
                      {pupil.rank ?? 'Ausstehend'}
                    </span>
                    {pupil.stage && (
                      <span
                        className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold ${stageClass(pupil.stage.level)}`}
                        title={`${pupil.stage.title} · Verhaltensnote: ${pupil.stage.behaviorGrade}`}
                      >
                        Stufe {pupil.stage.level > 0 ? `+${pupil.stage.level}` : pupil.stage.level}
                      </span>
                    )}
                    {pupil.activeIncident && (
                      <span
                        className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold ${
                          pupil.activeIncident.kind === 'cooldown'
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                            : 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                        }`}
                        title={pupil.activeIncident.taskAssignment}
                      >
                        {pupil.activeIncident.kind === 'cooldown' ? 'Cool-Down aktiv' : 'Time-Out aktiv'}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-slate-400">
                    <span className="inline-flex items-center gap-1" title="Grüne Karten">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />{pupil.counts.green} Grün
                    </span>
                    <span className="inline-flex items-center gap-1" title="Gelbe Karten">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />{pupil.counts.yellow} Gelb
                    </span>
                    <span className="inline-flex items-center gap-1" title="Rote Karten">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" aria-hidden="true" />{pupil.counts.red} Rot
                    </span>
                    <span className="inline-flex items-center gap-1" title="Time-Outs">
                      <Clock className="w-2.5 h-2.5 text-orange-400" aria-hidden="true" />{pupil.counts.timeout}
                    </span>
                    <span className="inline-flex items-center gap-1" title="Cool-Downs">
                      <Snowflake className="w-2.5 h-2.5 text-sky-400" aria-hidden="true" />{pupil.counts.cooldown}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-1.5 w-full lg:w-auto shrink-0">
                  {ACTION_STYLES.map((style) => (
                    <button
                      key={style.action}
                      type="button"
                      onClick={() => onAction(pupil, style.action)}
                      disabled={!pupil.canRecord}
                      title={pupil.canRecord ? style.title : 'Keine Berechtigung für diese Klasse'}
                      aria-label={`${style.title} für ${pupil.fullName}`}
                      className={`pressable focus-ring min-h-[48px] min-w-[56px] rounded-xl border px-1.5 py-1.5 text-[11px] font-bold leading-none transition flex flex-col items-center justify-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed ${style.className}`}
                    >
                      {style.icon}
                      <span>{style.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
