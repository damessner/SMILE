import React, { useState, useEffect, useMemo } from 'react';
import {
  Crown,
  BarChart3,
  Search,
  Printer,
  ChevronDown,
  ChevronUp,
  Award,
  Sparkles,
  Users,
  RefreshCw,
  Info,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import { getStatistics } from '../services/api';

interface TeacherVote {
  teacherId: number;
  teacherShort: string;
  teacherName: string;
  subjectCode: string;
  subjectName: string;
  isCore: boolean;
  proposedStatus?: 'Lehrling' | 'Geselle' | 'Meister' | null;
  nextStep?: string | null;
  comment?: string | null;
  positiveCount: number;
  totalRated: number;
  updatedAt: string;
}

interface PupilItem {
  id: string;
  itemKey: string;
  rating: string;
  updatedBy?: string | null;
  updatedAt: string;
}

interface PupilStat {
  id: number;
  fullName: string;
  classId: number;
  className: string;
  grade: number;
  positiveCount: number;
  totalRated: number;
  calculatedRank: 'Lehrling' | 'Geselle' | 'Meister';
  finalRank: 'Lehrling' | 'Geselle' | 'Meister';
  isConfirmed: boolean;
  overrideReason?: string | null;
  teacherVotes: TeacherVote[];
  items: PupilItem[];
}

interface StatData {
  classes: Array<{ id: number; name: string; grade: number }>;
  round: any;
  distribution: {
    lehrling: number;
    geselle: number;
    meister: number;
    total: number;
    percentLehrling: number;
    percentGeselle: number;
    percentMeister: number;
  };
  pupils: PupilStat[];
}

// Smiley Renderer Helper
export const renderSmiley = (rating: string) => {
  switch (rating) {
    case 'crown':
    case '++':
      return (
        <span className="relative inline-flex flex-col items-center justify-center -space-y-1" title="Hervorragend (Krone)">
          <Crown className="w-3 h-3 inline align-text-bottom" aria-hidden="true" />
          <span className="text-base leading-none">😊</span>
        </span>
      );
    case 'smile':
    case '+':
      return <span className="text-lg leading-none" title="Gut (😊)">😊</span>;
    case 'struggle':
    case 'strain':
    case 'o':
      return <span className="text-lg leading-none" title="Mit Mühe (😖)">😖</span>;
    case 'sad':
    case '-':
      return <span className="text-lg leading-none" title="Traurig (😢)">😢</span>;
    case 'newstart':
    case 'restart':
      return <span className="text-lg leading-none" title="Neustart (🔄)">🔄</span>;
    default:
      return <span className="text-slate-600 text-xs italic">—</span>;
  }
};

export const SchoolStatistics: React.FC<{ initialClassId?: number | null }> = ({ initialClassId }) => {
  const [data, setData] = useState<StatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState<string>(
    initialClassId ? String(initialClassId) : 'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [rankFilter, setRankFilter] = useState<'all' | 'Lehrling' | 'Geselle' | 'Meister'>('all');
  const [expandedPupilId, setExpandedPupilId] = useState<number | null>(null);

  const fetchData = async (cid: string) => {
    setLoading(true);
    try {
      const res = await getStatistics(cid);
      setData(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(selectedClassId);
  }, [selectedClassId]);

  // Filtered pupils list
  const filteredPupils = useMemo(() => {
    if (!data?.pupils) return [];
    return data.pupils.filter((p) => {
      const matchesSearch = p.fullName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRank = rankFilter === 'all' || p.finalRank === rankFilter;
      return matchesSearch && matchesRank;
    });
  }, [data?.pupils, searchQuery, rankFilter]);

  const handlePrint = () => {
    window.print();
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-400">
        <RefreshCw className="w-7 h-7 animate-spin text-amber-400 mb-2" />
        <span className="text-xs">Lade Schulstatistik &amp; Lehrervoten...</span>
      </div>
    );
  }

  const dist = data?.distribution || {
    lehrling: 0,
    geselle: 0,
    meister: 0,
    total: 0,
    percentLehrling: 0,
    percentGeselle: 0,
    percentMeister: 0,
  };

  return (
    <div className="space-y-4 print:m-0 print:p-0">
      {/* Top Header Card (Compact) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg print:hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-50 leading-tight">Schul- &amp; Klassenstatistik</h1>
              <p className="text-[11px] text-slate-400">
                Kompakte Übersicht aller Klassen, Statusverteilung und Lehrer-Voten
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-slate-50 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <Printer className="w-3.5 h-3.5 text-sky-400" />
              <span>Drucken / PDF</span>
            </button>
          </div>
        </div>

        {/* Class Selection Tabs (Compact) */}
        <div className="pt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedClassId('all')}
            className={`px-3 py-1 rounded-xl font-bold text-xs transition flex-shrink-0 ${
              selectedClassId === 'all'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-sm font-bold'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-50 hover:bg-slate-700'
            }`}
          >
            Alle Klassen (Gesamt)
          </button>
          {data?.classes.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedClassId(String(c.id))}
              className={`px-3 py-1 rounded-xl font-bold text-xs transition flex-shrink-0 ${
                selectedClassId === String(c.id)
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-sm font-bold'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-50 hover:bg-slate-700'
              }`}
            >
              Klasse {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Color Balken (Stacked Distribution Progress Bar - Compact) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-50">Status-Verteilung</h2>
            <span className="text-xs text-slate-400">
              ({dist.total} Schüler gesamt)
            </span>
          </div>

          {/* Legend Badges (Compact) */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 font-bold text-xs">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              Lehrling: {dist.lehrling} ({dist.percentLehrling}%)
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 font-bold text-xs">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              Geselle: {dist.geselle} ({dist.percentGeselle}%)
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-300 font-bold text-xs">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Meister: {dist.meister} ({dist.percentMeister}%)
            </span>
          </div>
        </div>

        {/* Compact Cumulative Color Balken */}
        <div className="w-full h-6 bg-slate-800 rounded-xl overflow-hidden flex p-0.5 gap-0.5 border border-slate-700/80 shadow-inner">
          {dist.total > 0 ? (
            <>
              {dist.percentLehrling > 0 && (
                <div
                  style={{ width: `${dist.percentLehrling}%` }}
                  className="bg-rose-500 rounded-lg flex items-center justify-center text-slate-50 text-[11px] font-bold transition-all duration-500 shadow-sm"
                  title={`Lehrling: ${dist.lehrling} (${dist.percentLehrling}%)`}
                >
                  {dist.percentLehrling >= 12 && `${dist.percentLehrling}%`}
                </div>
              )}
              {dist.percentGeselle > 0 && (
                <div
                  style={{ width: `${dist.percentGeselle}%` }}
                  className="bg-blue-500 rounded-lg flex items-center justify-center text-slate-50 text-[11px] font-bold transition-all duration-500 shadow-sm"
                  title={`Geselle: ${dist.geselle} (${dist.percentGeselle}%)`}
                >
                  {dist.percentGeselle >= 12 && `${dist.percentGeselle}%`}
                </div>
              )}
              {dist.percentMeister > 0 && (
                <div
                  style={{ width: `${dist.percentMeister}%` }}
                  className="bg-amber-400 rounded-lg flex items-center justify-center text-slate-950 text-[11px] font-bold transition-all duration-500 shadow-sm"
                  title={`Meister: ${dist.meister} (${dist.percentMeister}%)`}
                >
                  {dist.percentMeister >= 12 && `${dist.percentMeister}%`}
                </div>
              )}
            </>
          ) : (
            <div className="w-full flex items-center justify-center text-xs text-slate-500">
              Noch keine Bewertungen vorhanden
            </div>
          )}
        </div>
      </div>

      {/* Filter & Search Bar (Compact) */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-md print:hidden">
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

        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
          <button
            onClick={() => setRankFilter('all')}
            className={`px-2.5 py-1 rounded-xl font-bold text-xs transition ${
              rankFilter === 'all'
                ? 'bg-slate-700 text-slate-50'
                : 'bg-slate-800 text-slate-400 hover:text-slate-50'
            }`}
          >
            Alle ({data?.pupils.length || 0})
          </button>
          <button
            onClick={() => setRankFilter('Lehrling')}
            className={`px-2.5 py-1 rounded-xl font-bold text-xs transition flex items-center gap-1 ${
              rankFilter === 'Lehrling'
                ? 'bg-rose-500 text-slate-50'
                : 'bg-slate-800 text-rose-400 hover:bg-slate-700'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Lehrling ({dist.lehrling})
          </button>
          <button
            onClick={() => setRankFilter('Geselle')}
            className={`px-2.5 py-1 rounded-xl font-bold text-xs transition flex items-center gap-1 ${
              rankFilter === 'Geselle'
                ? 'bg-blue-500 text-slate-50'
                : 'bg-slate-800 text-blue-400 hover:bg-slate-700'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Geselle ({dist.geselle})
          </button>
          <button
            onClick={() => setRankFilter('Meister')}
            className={`px-2.5 py-1 rounded-xl font-bold text-xs transition flex items-center gap-1 ${
              rankFilter === 'Meister'
                ? 'bg-amber-400 text-slate-950 font-bold'
                : 'bg-slate-800 text-amber-400 hover:bg-slate-700'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Meister ({dist.meister})
          </button>
        </div>
      </div>

      {/* Main Pupil Table & Teachers' Votes (Dense & Compact) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Schülerübersicht ({filteredPupils.length} Einträge)
          </span>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            Klicken Sie auf eine Zeile für die detaillierte Merkmal-Aufschlüsselung
          </span>
        </div>

        <div className="divide-y divide-slate-800/80">
          {filteredPupils.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              Keine Schüler gefunden für diese Auswahl.
            </div>
          ) : (
            filteredPupils.map((pupil) => {
              const isExpanded = expandedPupilId === pupil.id;

              // Rank styling
              let rankBadgeClass = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
              let barColor = 'bg-rose-500';
              if (pupil.finalRank === 'Meister') {
                rankBadgeClass = 'bg-amber-400/20 text-amber-300 border-amber-400/40';
                barColor = 'bg-amber-400';
              } else if (pupil.finalRank === 'Geselle') {
                rankBadgeClass = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
                barColor = 'bg-blue-500';
              }

              return (
                <div key={pupil.id} className="transition hover:bg-slate-800/25">
                  {/* Summary Row (Dense) */}
                  <div
                    onClick={() => setExpandedPupilId(isExpanded ? null : pupil.id)}
                    className="py-2.5 px-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 cursor-pointer"
                  >
                    {/* Column 1: Pupil & Class */}
                    <div className="w-full lg:w-56 flex-shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-400 border border-slate-700">
                          {pupil.className}
                        </span>
                        <span className="font-bold text-slate-50 text-xs leading-tight truncate">
                          {pupil.fullName}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {pupil.positiveCount} / 18 Smileys positiv
                      </div>
                    </div>

                    {/* Column 2: Status & Balken */}
                    <div className="w-full lg:w-48 flex-shrink-0">
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${rankBadgeClass}`}
                        >
                          {pupil.finalRank}
                        </span>
                        {pupil.isConfirmed && (
                          <span className="text-[9px] text-amber-400 font-bold">
                            ✓ Konferenzbeschluss
                          </span>
                        )}
                      </div>
                      {/* Mini Score Bar */}
                      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
                        <div
                          style={{ width: `${Math.min(100, Math.round((pupil.positiveCount / 18) * 100))}%` }}
                          className={`h-full ${barColor} transition-all duration-300`}
                        />
                      </div>
                    </div>

                    {/* Column 3: Teachers' Votes (Die Stimmen der Lehrpersonen) */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1">
                        {pupil.teacherVotes.length > 0 ? (
                          pupil.teacherVotes.map((vote, idx) => {
                            let voteBadge = 'border-slate-700 bg-slate-800/80 text-slate-300';
                            if (vote.proposedStatus === 'Meister') {
                              voteBadge = 'border-amber-400/40 bg-amber-400/10 text-amber-300';
                            } else if (vote.proposedStatus === 'Geselle') {
                              voteBadge = 'border-blue-500/40 bg-blue-500/10 text-blue-300';
                            } else if (vote.proposedStatus === 'Lehrling') {
                              voteBadge = 'border-rose-500/40 bg-rose-500/10 text-rose-300';
                            }

                            return (
                              <div
                                key={idx}
                                className={`px-2 py-0.5 rounded-lg border text-[11px] flex items-center gap-1 ${voteBadge}`}
                                title={`${vote.teacherName} (${vote.subjectName}): ${
                                  vote.proposedStatus || 'Ohne Einstufung'
                                } ${vote.comment ? '· Notiz: ' + vote.comment : ''}`}
                              >
                                <span className="font-bold text-[10px] text-slate-400">
                                  {vote.teacherShort}
                                </span>
                                <span className="text-[9px] px-1 py-0.5 rounded bg-slate-900/60 font-medium">
                                  {vote.subjectCode}
                                </span>
                                {vote.proposedStatus && (
                                  <span className="font-bold text-[10px]">
                                    {vote.proposedStatus === 'Meister'
                                      ? 'Meister'
                                      : vote.proposedStatus === 'Geselle'
                                      ? 'Geselle'
                                      : 'Lehrling'}
                                  </span>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">
                            Noch keine Fachlehrer-Bewertungen eingereicht
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Column 4: Toggle Chevron */}
                    <div className="text-slate-400 flex items-center justify-end pl-2">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-amber-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Detail Section (Dense) */}
                  {isExpanded && (
                    <div className="bg-slate-950/70 p-4 border-t border-slate-800 space-y-4">
                      {/* Detailed Teacher Comments & Votes */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                          Detaillierte Fachlehrer-Rückmeldungen
                        </h4>
                        {pupil.teacherVotes.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {pupil.teacherVotes.map((v, i) => (
                              <div
                                key={i}
                                className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex flex-col justify-between"
                              >
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="font-bold text-slate-50 text-xs">
                                      {v.teacherName} ({v.teacherShort})
                                    </span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold">
                                      {v.subjectCode} · {v.subjectName}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-400 mb-1.5">
                                    Einstufung: <strong className="text-slate-50">{v.proposedStatus || 'Keine'}</strong>
                                  </div>
                                  {v.comment && (
                                    <p className="text-xs text-amber-200/90 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20 italic">
                                      &bdquo;{v.comment}&ldquo;
                                    </p>
                                  )}
                                  {v.nextStep && (
                                    <div className="text-[11px] text-sky-300 mt-1">
                                      <strong>Nächster Schritt:</strong> {v.nextStep}
                                    </div>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 mt-2 text-right">
                                  Stand: {new Date(v.updatedAt).toLocaleDateString('de-AT')}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">Keine detaillierten Voten erfasst.</p>
                        )}
                      </div>

                      {/* Criteria Breakdown Grid */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                          18-Kriterien Raster (Aktueller Stand)
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                          {pupil.items.map((it) => (
                            <div
                              key={it.id || it.itemKey}
                              className="bg-slate-900 border border-slate-800 rounded-xl p-2 flex flex-col items-center justify-center text-center"
                            >
                              <span className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                                {it.itemKey}
                              </span>
                              <div className="h-6 flex items-center justify-center">
                                {renderSmiley(it.rating)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
