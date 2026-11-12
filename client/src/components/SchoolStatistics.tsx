import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart3,
  Search,
  Printer,
  RefreshCw,
  Clock,
  TrendingUp,
  Layers,
  ExternalLink,
} from 'lucide-react';
import { getStatistics } from '../services/api';
import { PupilProfileModal } from './PupilProfileModal';
import { Skeleton } from './ui';
import type { User } from '../types';

export interface CardsSummaryTotals {
  green: number;
  yellow: number;
  red: number;
  cooldown: number;
  timeout: number;
  total: number;
}

export interface IncidentByDayOfWeek {
  day: number;
  dayName: string;
  count: number;
}

export interface IncidentByPeriod {
  period: number;
  label: string;
  time: string;
  count: number;
}

export interface ClassBreakdownItem {
  classId: number;
  className: string;
  grade: number;
  pupilCount: number;
  green: number;
  yellow: number;
  red: number;
  cooldown: number;
  timeout: number;
  totalCards: number;
  totalIncidents: number;
}

export interface PupilCardStat {
  id: number;
  fullName: string;
  classId: number;
  className: string;
  grade: number;
  green: number;
  yellow: number;
  red: number;
  timeout: number;
  cooldown: number;
  total: number;
}

export interface StatData {
  classes: Array<{ id: number; name: string; grade: number }>;
  cardsSummary?: {
    totals: CardsSummaryTotals;
    incidentsByDayOfWeek: IncidentByDayOfWeek[];
    incidentsByPeriod: IncidentByPeriod[];
  };
  classBreakdown?: ClassBreakdownItem[];
  pupilCardStats?: PupilCardStat[];
}

export interface SchoolStatisticsProps {
  initialClassId?: number | null;
  currentUser?: User;
}

interface ColorSegment {
  key: string;
  label: string;
  count: number;
  pct: number;
  colorClass: string;
}

const computeSegments = (
  green: number,
  yellow: number,
  red: number,
  timeout: number,
  cooldown: number,
): ColorSegment[] => {
  const sum = green + yellow + red + timeout + cooldown;
  if (sum === 0) return [];
  const pct = (n: number) => Math.round((n / sum) * 100);

  return [
    { key: 'green', label: 'Grün', count: green, pct: pct(green), colorClass: 'bg-emerald-500' },
    { key: 'yellow', label: 'Gelb', count: yellow, pct: pct(yellow), colorClass: 'bg-amber-400' },
    { key: 'red', label: 'Rot', count: red, pct: pct(red), colorClass: 'bg-rose-500' },
    { key: 'timeout', label: 'Time-Out', count: timeout, pct: pct(timeout), colorClass: 'bg-orange-500' },
    { key: 'cooldown', label: 'Cool-Down', count: cooldown, pct: pct(cooldown), colorClass: 'bg-sky-400' },
  ].filter((s) => s.count > 0);
};

export const SchoolStatistics: React.FC<SchoolStatisticsProps> = ({
  initialClassId,
  currentUser,
}) => {
  const [data, setData] = useState<StatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  const [selectedClassId, setSelectedClassId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pupilFilter, setPupilFilter] = useState<'all' | 'has_cards' | 'green' | 'yellow' | 'red' | 'timeout'>('all');
  const [selectedPupilForModal, setSelectedPupilForModal] = useState<number | null>(null);

  const fetchData = async (cid: string) => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getStatistics(cid);
      if (generation !== loadGenerationRef.current) return;
      setData(res);
    } catch (e) {
      if (generation !== loadGenerationRef.current) return;
      console.error(e);
      setLoadError(
        e instanceof Error ? e.message : 'Die Schulstatistik konnte nicht geladen werden.',
      );
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(selectedClassId);
  }, [selectedClassId]);

  const handlePrint = () => {
    window.print();
  };

  const totals = data?.cardsSummary?.totals || {
    green: 0,
    yellow: 0,
    red: 0,
    cooldown: 0,
    timeout: 0,
    total: 0,
  };

  const globalSegments = useMemo(() => {
    return computeSegments(
      totals.green,
      totals.yellow,
      totals.red,
      totals.timeout,
      totals.cooldown,
    );
  }, [totals]);

  const filteredPupils = useMemo(() => {
    if (!data?.pupilCardStats) return [];
    return data.pupilCardStats.filter((p) => {
      const matchesSearch = p.fullName.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (pupilFilter === 'has_cards') return p.total > 0;
      if (pupilFilter === 'green') return p.green > 0;
      if (pupilFilter === 'yellow') return p.yellow > 0;
      if (pupilFilter === 'red') return p.red > 0;
      if (pupilFilter === 'timeout') return p.timeout > 0;
      return true;
    });
  }, [data?.pupilCardStats, searchQuery, pupilFilter]);

  if (loadError && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-400 gap-2">
        <span className="font-bold text-rose-300">Statistik nicht verfügbar</span>
        <p className="text-xs text-center max-w-md">{loadError}</p>
        <button
          type="button"
          onClick={() => void fetchData(selectedClassId)}
          className="mt-2 px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-sm font-bold text-slate-100"
        >
          Erneut laden
        </button>
      </div>
    );
  }

  if (loading && !data) {
    // Shape-matched skeleton: header, KPI strip, then the pupil table. The old spinner
    // pushed the whole dashboard down when the data arrived.
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Schulstatistik wird geladen">
        <div className="surface-1 rounded-2xl p-4 flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, tile) => (
            <Skeleton key={tile} className="h-20 rounded-2xl" />
          ))}
        </div>
        <div className="surface-1 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-hairline">
            <Skeleton className="h-4 w-56" />
          </div>
          {Array.from({ length: 8 }).map((_, row) => (
            <div key={row} className="flex items-center gap-3 px-4 py-3 border-b border-hairline last:border-b-0">
              <Skeleton className="h-8 w-8 rounded-xl" />
              <Skeleton className="h-3.5 w-1/4" />
              <div className="ml-auto hidden sm:flex gap-1.5">
                <Skeleton className="h-7 w-10 rounded-lg" />
                <Skeleton className="h-7 w-10 rounded-lg" />
                <Skeleton className="h-7 w-10 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 print:m-0 print:p-0" aria-busy={loading}>
      {loading && data && (
        <div
          role="status"
          aria-label="Statistik wird aktualisiert"
          className="h-1 overflow-hidden rounded-full bg-slate-800 print:hidden"
        >
          <div className="h-full w-1/3 animate-loading-bar rounded-full bg-amber-400" />
        </div>
      )}
      {loadError && (
        <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => void fetchData(selectedClassId)}
            className="underline underline-offset-2 font-bold shrink-0"
          >
            Erneut laden
          </button>
        </div>
      )}

      {/* Minimalist Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg print:hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-50 leading-tight">Schulstatistik</h1>
              <p className="text-[11px] text-slate-400">
                Fakten &amp; Kennzahlen zur Verteilung von Karten und Vorfällen
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchData(selectedClassId)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-slate-50 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition"
              title="Aktualisieren"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${loading ? 'animate-spin' : ''}`} />
              <span>Aktualisieren</span>
            </button>
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-slate-50 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <Printer className="w-3.5 h-3.5 text-sky-400" />
              <span>Drucken / PDF</span>
            </button>
          </div>
        </div>

        {/* Class Filter Tabs */}
        <div className="pt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedClassId('all')}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs transition flex-shrink-0 ${
              selectedClassId === 'all'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-50 hover:bg-slate-700'
            }`}
          >
            Alle Klassen (Schulweit)
          </button>
          {data?.classes.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedClassId(String(c.id))}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs transition flex-shrink-0 ${
                selectedClassId === String(c.id)
                  ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-50 hover:bg-slate-700'
              }`}
            >
              Klasse {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards: Pure Factual Numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-3 shadow-md">
          <div className="flex items-center justify-between text-emerald-400 text-xs font-bold mb-1">
            <span>🟢 Grün</span>
            <span className="text-[11px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20">Anerkennung</span>
          </div>
          <div className="text-2xl font-black text-emerald-300">{totals.green}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Grüne Karten</p>
        </div>

        <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-3 shadow-md">
          <div className="flex items-center justify-between text-amber-400 text-xs font-bold mb-1">
            <span>🟡 Gelb</span>
            <span className="text-[11px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-amber-500/10 border border-amber-500/20">Verwarnung</span>
          </div>
          <div className="text-2xl font-black text-amber-300">{totals.yellow}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Gelbe Karten</p>
        </div>

        <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-3 shadow-md">
          <div className="flex items-center justify-between text-rose-400 text-xs font-bold mb-1">
            <span>🔴 Rot</span>
            <span className="text-[11px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-rose-500/10 border border-rose-500/20">Disziplinar</span>
          </div>
          <div className="text-2xl font-black text-rose-300">{totals.red}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Rote Karten</p>
        </div>

        <div className="bg-slate-900 border border-orange-500/30 rounded-2xl p-3 shadow-md">
          <div className="flex items-center justify-between text-orange-400 text-xs font-bold mb-1">
            <span>⏱️ Time-Out</span>
            <span className="text-[11px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-orange-500/10 border border-orange-500/20">Lernwerkstatt</span>
          </div>
          <div className="text-2xl font-black text-orange-300">{totals.timeout}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Time-Out Vorfälle</p>
        </div>

        <div className="bg-slate-900 border border-sky-500/30 rounded-2xl p-3 shadow-md">
          <div className="flex items-center justify-between text-sky-400 text-xs font-bold mb-1">
            <span>❄️ Cool-Down</span>
            <span className="text-[11px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-sky-500/10 border border-sky-500/20">Auszeit</span>
          </div>
          <div className="text-2xl font-black text-sky-300">{totals.cooldown}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Beruhigungsphasen</p>
        </div>

        <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-3 shadow-md">
          <div className="flex items-center justify-between text-slate-300 text-xs font-bold mb-1">
            <span>📊 Gesamt</span>
            <span className="text-[11px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700">Total</span>
          </div>
          <div className="text-2xl font-black text-slate-100">{totals.total}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Einträge gesamt</p>
        </div>
      </div>

      {/* Colorful Global Distribution Bar with Interactive Details on Hover */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Gesamte Farb- &amp; Vorfallsverteilung
            </h3>
            <span className="text-[11px] text-slate-400">
              ({totals.total} Einträge)
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] flex-wrap">
            <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Grün: {totals.green}
            </span>
            <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Gelb: {totals.yellow}
            </span>
            <span className="inline-flex items-center gap-1 text-rose-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Rot: {totals.red}
            </span>
            <span className="inline-flex items-center gap-1 text-orange-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Time-Out: {totals.timeout}
            </span>
            <span className="inline-flex items-center gap-1 text-sky-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400" /> Cool-Down: {totals.cooldown}
            </span>
          </div>
        </div>

        {/* The Colorful Stacked Bar */}
        <div className="w-full h-7 bg-slate-950 rounded-xl overflow-hidden flex p-0.5 gap-0.5 border border-slate-800 shadow-inner">
          {globalSegments.length > 0 ? (
            globalSegments.map((seg) => (
              <div
                key={seg.key}
                style={{ width: `${seg.pct}%` }}
                className={`${seg.colorClass} rounded-lg flex items-center justify-center text-slate-950 text-[11px] font-black transition-all duration-300 hover:brightness-110 cursor-pointer`}
                title={`${seg.label}: ${seg.count} (${seg.pct}%)`}
              >
                {seg.pct >= 8 && `${seg.pct}%`}
              </div>
            ))
          ) : (
            <div className="w-full flex items-center justify-center text-xs text-slate-500">
              Keine Karten oder Vorfälle erfasst
            </div>
          )}
        </div>
      </div>

      {/* Class Overview Table with Colorful Distribution Bars */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Klassenübersicht (Karten &amp; Vorfälle)
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            Fahren Sie über die Farbstreifen für Details
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950/60 border-b border-slate-800 text-[11px] font-bold text-slate-400">
                <th className="py-2.5 px-3">Klasse</th>
                <th className="py-2.5 px-3 text-center">Schüler</th>
                <th className="py-2.5 px-3 text-center text-emerald-400">🟢 Grün</th>
                <th className="py-2.5 px-3 text-center text-amber-400">🟡 Gelb</th>
                <th className="py-2.5 px-3 text-center text-rose-400">🔴 Rot</th>
                <th className="py-2.5 px-3 text-center text-orange-400">⏱️ Time-Out</th>
                <th className="py-2.5 px-3 text-center text-sky-400">❄️ Cool-Down</th>
                <th className="py-2.5 px-3 text-center font-bold">Gesamt</th>
                <th className="py-2.5 px-3 w-48 text-center">Farbverteilung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {data?.classBreakdown && data.classBreakdown.length > 0 ? (
                data.classBreakdown.map((cb) => {
                  const segments = computeSegments(
                    cb.green,
                    cb.yellow,
                    cb.red,
                    cb.timeout,
                    cb.cooldown,
                  );

                  const tooltipText = segments.length > 0
                    ? `Klasse ${cb.className}: ` + segments.map((s) => `${s.label}: ${s.count} (${s.pct}%)`).join(' · ')
                    : `Klasse ${cb.className}: Keine Einträge`;

                  return (
                    <tr
                      key={cb.classId}
                      onClick={() => setSelectedClassId(String(cb.classId))}
                      className="hover:bg-slate-800/40 cursor-pointer transition"
                    >
                      <td className="py-2 px-3 font-bold text-slate-100 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] text-amber-400">
                          {cb.className}
                        </span>
                        <span className="text-slate-400 text-[11px]">{cb.grade}. Schulstufe</span>
                      </td>
                      <td className="py-2 px-3 text-center text-slate-400">{cb.pupilCount}</td>
                      <td className="py-2 px-3 text-center font-bold text-emerald-400">{cb.green}</td>
                      <td className="py-2 px-3 text-center font-bold text-amber-400">{cb.yellow}</td>
                      <td className="py-2 px-3 text-center font-bold text-rose-400">{cb.red}</td>
                      <td className="py-2 px-3 text-center font-bold text-orange-400">{cb.timeout}</td>
                      <td className="py-2 px-3 text-center font-bold text-sky-400">{cb.cooldown}</td>
                      <td className="py-2 px-3 text-center font-black text-slate-200">
                        {cb.totalCards}
                      </td>
                      <td className="py-2 px-3">
                        <div
                          className="w-full h-4 bg-slate-950 rounded-lg overflow-hidden flex p-0.5 gap-0.5 border border-slate-800"
                          title={tooltipText}
                        >
                          {segments.length > 0 ? (
                            segments.map((seg) => (
                              <div
                                key={seg.key}
                                style={{ width: `${seg.pct}%` }}
                                className={`${seg.colorClass} rounded-sm`}
                              />
                            ))
                          ) : (
                            <div className="w-full text-center text-[11px] text-slate-600">—</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-slate-500">
                    Keine Klassen gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Temporal Incidents Analysis (Weekday & Period) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Weekday Distribution */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Vorfälle nach Wochentag
              </h3>
            </div>
            <span className="text-[11px] text-slate-500">Montag – Freitag</span>
          </div>

          <div className="grid grid-cols-5 gap-2 pt-2">
            {data?.cardsSummary?.incidentsByDayOfWeek.map((d) => {
              const maxCount = Math.max(
                1,
                ...(data?.cardsSummary?.incidentsByDayOfWeek.map((x) => x.count) ?? [1]),
              );
              const barHeightPct = Math.round((d.count / maxCount) * 100);

              return (
                <div key={d.day} className="flex flex-col items-center">
                  <div className="w-full h-24 bg-slate-950/60 rounded-xl p-1 flex items-end justify-center border border-slate-800">
                    <div
                      style={{ height: `${Math.max(8, barHeightPct)}%` }}
                      className={`w-full rounded-lg transition-all duration-500 flex items-center justify-center text-[11px] font-bold ${
                        d.count > 0 ? 'bg-amber-500 text-slate-950 shadow-sm' : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {d.count > 0 ? d.count : 0}
                    </div>
                  </div>
                  <span className="text-xs font-bold text-slate-300 mt-2">{d.dayName}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Period Distribution */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-orange-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Vorfälle nach Unterrichtsstunde
              </h3>
            </div>
            <span className="text-[11px] text-slate-500">1. bis 6. Stunde</span>
          </div>

          <div className="grid grid-cols-6 gap-2 pt-2">
            {data?.cardsSummary?.incidentsByPeriod.map((p) => {
              const maxCount = Math.max(
                1,
                ...(data?.cardsSummary?.incidentsByPeriod.map((x) => x.count) ?? [1]),
              );
              const barHeightPct = Math.round((p.count / maxCount) * 100);

              return (
                <div key={p.period} className="flex flex-col items-center" title={`${p.label} (${p.time}): ${p.count} Vorfälle`}>
                  <div className="w-full h-24 bg-slate-950/60 rounded-xl p-1 flex items-end justify-center border border-slate-800">
                    <div
                      style={{ height: `${Math.max(8, barHeightPct)}%` }}
                      className={`w-full rounded-lg transition-all duration-500 flex items-center justify-center text-[11px] font-bold ${
                        p.count > 0 ? 'bg-orange-500 text-slate-950 shadow-sm' : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {p.count > 0 ? p.count : 0}
                    </div>
                  </div>
                  <span className="text-xs font-bold text-slate-300 mt-2">{p.period}. Std</span>
                  <span className="text-[11px] text-slate-500 truncate max-w-full">{p.time.split(' - ')[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Pupil-Level Overview (Factual Table with Search & Filter) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        <div className="p-3 border-b border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Schüler nach Name suchen..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-0.5">
            <button
              onClick={() => setPupilFilter('all')}
              className={`px-2.5 py-1 rounded-xl font-bold text-xs transition ${
                pupilFilter === 'all'
                  ? 'bg-slate-700 text-slate-50'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-50'
              }`}
            >
              Alle ({data?.pupilCardStats?.length ?? 0})
            </button>
            <button
              onClick={() => setPupilFilter('has_cards')}
              className={`px-2.5 py-1 rounded-xl font-bold text-xs transition ${
                pupilFilter === 'has_cards'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-50'
              }`}
            >
              Mit Einträgen ({data?.pupilCardStats?.filter((p) => p.total > 0).length ?? 0})
            </button>
            <button
              onClick={() => setPupilFilter('green')}
              className={`px-2.5 py-1 rounded-xl font-bold text-xs transition ${
                pupilFilter === 'green'
                  ? 'bg-emerald-500 text-slate-950 font-bold'
                  : 'bg-slate-800 text-emerald-400 hover:text-slate-50'
              }`}
            >
              🟢 Grün
            </button>
            <button
              onClick={() => setPupilFilter('yellow')}
              className={`px-2.5 py-1 rounded-xl font-bold text-xs transition ${
                pupilFilter === 'yellow'
                  ? 'bg-amber-400 text-slate-950 font-bold'
                  : 'bg-slate-800 text-amber-400 hover:text-slate-50'
              }`}
            >
              🟡 Gelb
            </button>
            <button
              onClick={() => setPupilFilter('red')}
              className={`px-2.5 py-1 rounded-xl font-bold text-xs transition ${
                pupilFilter === 'red'
                  ? 'bg-rose-500 text-slate-50'
                  : 'bg-slate-800 text-rose-400 hover:text-slate-50'
              }`}
            >
              🔴 Rot
            </button>
            <button
              onClick={() => setPupilFilter('timeout')}
              className={`px-2.5 py-1 rounded-xl font-bold text-xs transition ${
                pupilFilter === 'timeout'
                  ? 'bg-orange-500 text-slate-50'
                  : 'bg-slate-800 text-orange-400 hover:text-slate-50'
              }`}
            >
              ⏱️ Time-Out
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950/60 border-b border-slate-800 text-[11px] font-bold text-slate-400">
                <th className="py-2.5 px-3">Klasse</th>
                <th className="py-2.5 px-3">Schüler</th>
                <th className="py-2.5 px-3 text-center text-emerald-400">🟢 Grün</th>
                <th className="py-2.5 px-3 text-center text-amber-400">🟡 Gelb</th>
                <th className="py-2.5 px-3 text-center text-rose-400">🔴 Rot</th>
                <th className="py-2.5 px-3 text-center text-orange-400">⏱️ Time-Out</th>
                <th className="py-2.5 px-3 text-center text-sky-400">❄️ Cool-Down</th>
                <th className="py-2.5 px-3 text-center font-bold">Gesamt</th>
                <th className="py-2.5 px-3 w-40 text-center">Farbverteilung</th>
                <th className="py-2.5 px-3 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredPupils.length > 0 ? (
                filteredPupils.map((p) => {
                  const segments = computeSegments(
                    p.green,
                    p.yellow,
                    p.red,
                    p.timeout,
                    p.cooldown,
                  );

                  const tooltipText = segments.length > 0
                    ? `${p.fullName}: ` + segments.map((s) => `${s.label}: ${s.count} (${s.pct}%)`).join(' · ')
                    : `${p.fullName}: Keine Einträge`;

                  return (
                    <tr key={p.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-2 px-3">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] text-amber-400 font-bold">
                          {p.className}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-bold text-slate-100">{p.fullName}</td>
                      <td className="py-2 px-3 text-center font-bold text-emerald-400">{p.green}</td>
                      <td className="py-2 px-3 text-center font-bold text-amber-400">{p.yellow}</td>
                      <td className="py-2 px-3 text-center font-bold text-rose-400">{p.red}</td>
                      <td className="py-2 px-3 text-center font-bold text-orange-400">{p.timeout}</td>
                      <td className="py-2 px-3 text-center font-bold text-sky-400">{p.cooldown}</td>
                      <td className="py-2 px-3 text-center font-black text-slate-200">{p.total}</td>
                      <td className="py-2 px-3">
                        <div
                          className="w-full h-3.5 bg-slate-950 rounded-lg overflow-hidden flex p-0.5 gap-0.5 border border-slate-800"
                          title={tooltipText}
                        >
                          {segments.length > 0 ? (
                            segments.map((seg) => (
                              <div
                                key={seg.key}
                                style={{ width: `${seg.pct}%` }}
                                className={`${seg.colorClass} rounded-sm`}
                              />
                            ))
                          ) : (
                            <div className="w-full text-center text-[11px] text-slate-600">—</div>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right">
                        {currentUser && (
                          <button
                            type="button"
                            onClick={() => setSelectedPupilForModal(p.id)}
                            className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 transition"
                            title="Profil & Historie anzeigen"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-slate-500">
                    Keine Schüler gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pupil Profile Modal */}
      {selectedPupilForModal && currentUser && (
        <PupilProfileModal
          pupilId={selectedPupilForModal}
          currentUser={currentUser}
          onClose={() => setSelectedPupilForModal(null)}
          onRefreshParent={() => void fetchData(selectedClassId)}
        />
      )}
    </div>
  );
};
