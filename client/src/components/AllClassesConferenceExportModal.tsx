import React, { useState, useEffect } from 'react';
import {
  X,
  Printer,
  FileText,
  RefreshCw,
  Award,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronDown,
  Layers,
  Filter,
} from 'lucide-react';
import { SchoolClass, User } from '../types';
import { getConferenceSummary, getAllClasses } from '../services/api';
import { formatConfirmationTimestamp } from '../lib/confirmationTime';
import { formatSubjectEvidence, type SubjectEvidenceItem } from '../lib/conferenceEvidence';

interface TeacherVote {
  teacherId: number;
  teacherShort: string;
  teacherName: string;
  subjectCode: string;
  proposedStatus?: string | null;
  comment?: string | null;
  isSubmitted: boolean;
  positiveCount: number;
  hours?: number;
  weight?: number;
}

interface ConferencePupilSummary {
  id: number;
  fullName: string;
  subjectEvidence?: SubjectEvidenceItem[];
  suggestedRank: 'Lehrling' | 'Geselle' | 'Meister' | null;
  finalRank: 'Lehrling' | 'Geselle' | 'Meister' | null;
  hasRedCardDemotion: boolean;
  isConfirmed: boolean;
  confirmedAt?: string | null;
  overrideReason?: string | null;
  participation?: {
    submittedTeachers: number;
    eligibleTeachers: number;
    teachersMissing: number;
  };
  teacherVotes: TeacherVote[];
  voteStats: {
    Lehrling: number;
    Geselle: number;
    Meister: number;
    hoursLehrling?: number;
    hoursGeselle?: number;
    hoursMeister?: number;
    totalVotedHours?: number;
    pctLehrling?: number;
    pctGeselle?: number;
    pctMeister?: number;
    suggestedRankByHours?: 'Lehrling' | 'Geselle' | 'Meister' | null;
    weightedRank?: 'Lehrling' | 'Geselle' | 'Meister' | null;
  };
  cards: {
    green: Array<{ id: string; teacherShort: string }>;
    yellow: Array<{ id: string; teacherShort: string }>;
    red: Array<{ id: string; teacherShort: string; note?: string | null }>;
  };
}

interface ClassConferenceData {
  classInfo: SchoolClass;
  totalClassTeachers: number;
  isAuthorized: boolean;
  summary: ConferencePupilSummary[];
  loading: boolean;
  error: string | null;
}

interface AllClassesConferenceExportModalProps {
  classes: SchoolClass[];
  currentUser: User;
  onClose: () => void;
}

export const AllClassesConferenceExportModal: React.FC<AllClassesConferenceExportModalProps> = ({
  classes,
  currentUser,
  onClose,
}) => {
  const [dataMap, setDataMap] = useState<Map<number, ClassConferenceData>>(new Map());
  const [loadingAll, setLoadingAll] = useState(true);
  const [exportFilter, setExportFilter] = useState<'all' | 'before' | 'after'>('all');
  const [allClassesList, setAllClassesList] = useState<SchoolClass[]>(() =>
    classes.filter((c) => c.name !== 'LW' && (c.grade === undefined || c.grade > 0))
  );

  useEffect(() => {
    let isMounted = true;
    getAllClasses()
      .then((cls) => {
        if (isMounted && Array.isArray(cls) && cls.length > 0) {
          const valid = cls.filter((c) => c.name !== 'LW' && (c.grade === undefined || c.grade > 0));
          setAllClassesList(valid);
        }
      })
      .catch((err) => {
        console.warn('Fehler beim Laden aller Klassen, verwende übergebene Klassen:', err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Ensure all 15 classes are included in the conference export
  const targetClasses = (allClassesList.length > 0 ? allClassesList : classes).filter(
    (c) => c.name !== 'LW' && (c.grade === undefined || c.grade > 0)
  );

  const loadAllClassData = async (targetCls: SchoolClass[]) => {
    if (targetCls.length === 0) return;
    setLoadingAll(true);
    const initialMap = new Map<number, ClassConferenceData>();
    targetCls.forEach((cls) => {
      initialMap.set(cls.id, {
        classInfo: cls,
        totalClassTeachers: 0,
        isAuthorized: false,
        summary: [],
        loading: true,
        error: null,
      });
    });
    setDataMap(new Map(initialMap));

    // Fetch summaries in parallel
    await Promise.all(
      targetCls.map(async (cls) => {
        try {
          const res = await getConferenceSummary(cls.id);
          setDataMap((prev) => {
            const next = new Map(prev);
            next.set(cls.id, {
              classInfo: cls,
              totalClassTeachers: res.totalClassTeachers || 0,
              isAuthorized: !!res.isAuthorized,
              summary: res.summary || [],
              loading: false,
              error: null,
            });
            return next;
          });
        } catch (err: any) {
          setDataMap((prev) => {
            const next = new Map(prev);
            next.set(cls.id, {
              classInfo: cls,
              totalClassTeachers: 0,
              isAuthorized: false,
              summary: [],
              loading: false,
              error: err.message || 'Konnte nicht geladen werden',
            });
            return next;
          });
        }
      })
    );

    setLoadingAll(false);
  };

  useEffect(() => {
    loadAllClassData(targetClasses);
  }, [allClassesList, classes]);

  const handlePrint = () => {
    window.print();
  };

  const currentDateStr = new Date().toLocaleDateString('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const currentTimeStr = new Date().toLocaleTimeString('de-AT', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      id="all-classes-export-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto print:static print:inset-auto print:p-0 print:m-0 print:bg-white print:overflow-visible print:block"
    >
      {/* Print Page Styles to enforce exactly 1 page per class */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 6mm 8mm 6mm 8mm;
          }
          html, body {
            height: auto !important;
            min-height: auto !important;
            overflow: visible !important;
            background: #ffffff !important;
            color: #000000 !important;
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }
          body > div#root > *:not(#all-classes-export-modal-backdrop) {
            display: none !important;
          }
          #all-classes-export-modal-backdrop {
            position: static !important;
            inset: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
            overflow: visible !important;
            display: block !important;
            width: 100% !important;
            max-width: none !important;
            height: auto !important;
            min-height: auto !important;
            max-height: none !important;
          }
          #all-classes-export-card {
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            background: white !important;
            max-height: none !important;
            height: auto !important;
            overflow: visible !important;
            width: 100% !important;
            max-width: none !important;
            display: block !important;
          }
          #printable-all-classes-report {
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            display: block !important;
            width: 100% !important;
          }
          .print-class-page {
            page-break-before: auto !important;
            break-before: auto !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            box-sizing: border-box !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            padding: 4mm 0 !important;
            margin: 0 !important;
            height: 275mm !important;
            max-height: 275mm !important;
            overflow: hidden !important;
          }
          .print-class-page:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Main Container */}
      <div
        id="all-classes-export-card"
        className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-5xl max-h-[96vh] flex flex-col shadow-2xl overflow-hidden print:m-0 print:p-0 print:border-none print:shadow-none print:bg-white print:max-h-none print:w-full print:max-w-none print:overflow-visible print:block"
      >
        
        {/* Modal Controls Header (Hidden in Print) */}
        <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 no-print">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-50 text-sm flex items-center gap-2">
                <span>Gesamtexport Konferenz (Alle Klassen)</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {targetClasses.length} Klassen
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                1 A4-Seite pro Klasse · Statistiken &amp; visualisierte Voten je Schüler*in
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter Toggle */}
            <div className="flex items-center p-1 rounded-xl bg-slate-800 border border-slate-700 text-xs font-semibold">
              <button
                onClick={() => setExportFilter('all')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  exportFilter === 'all'
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Vollständig
              </button>
              <button
                onClick={() => setExportFilter('before')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  exportFilter === 'before'
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Fokus auf abgegebene Lehrkräfte-Voten vor dem Notenbeschluss"
              >
                Vor Konferenz
              </button>
              <button
                onClick={() => setExportFilter('after')}
                className={`px-3 py-1.5 rounded-lg transition ${
                  exportFilter === 'after'
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Fokus auf bestätigte Konferenz-Endränge und Beschlüsse"
              >
                Nach Konferenz
              </button>
            </div>

            <button
              onClick={handlePrint}
              disabled={loadingAll}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow-md"
            >
              <Printer className="w-4 h-4" />
              <span>Drucken / Als PDF speichern</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 hover:bg-slate-700 transition"
              title="Schließen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Loading Progress State */}
        {loadingAll && (
          <div className="p-8 flex flex-col items-center justify-center gap-3 text-slate-400 no-print">
            <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
            <span className="font-semibold text-sm">Lade Konferenzdaten für alle Klassen...</span>
          </div>
        )}

        {/* Scrollable Printable Document Content */}
        <div
          id="printable-all-classes-report"
          className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950 text-slate-900 print:bg-white print:overflow-visible print:p-0"
        >
          {targetClasses.map((cls) => {
            const classEntry = dataMap.get(cls.id);
            const summary = classEntry?.summary || [];
            const totalPupils = summary.length;

            // Stats computation
            const confirmedCount = summary.filter((p) => p.isConfirmed).length;
            const openDecisionCount = totalPupils - confirmedCount;

            const lehrlingCount = summary.filter((p) => (p.isConfirmed ? p.finalRank : p.suggestedRank) === 'Lehrling').length;
            const geselleCount = summary.filter((p) => (p.isConfirmed ? p.finalRank : p.suggestedRank) === 'Geselle').length;
            const meisterCount = summary.filter((p) => (p.isConfirmed ? p.finalRank : p.suggestedRank) === 'Meister').length;

            const pctLehrling = totalPupils > 0 ? Math.round((lehrlingCount / totalPupils) * 100) : 0;
            const pctGeselle = totalPupils > 0 ? Math.round((geselleCount / totalPupils) * 100) : 0;
            const pctMeister = totalPupils > 0 ? Math.round((meisterCount / totalPupils) * 100) : 0;

            const totalClassTeachers = classEntry?.totalClassTeachers || 0;
            // Class KV info
            const kvInfo = [cls.headTeacher1, cls.headTeacher2].filter(Boolean).join(' & ') || 'Klassenvorstand';

            return (
              <div
                key={cls.id}
                className="print-class-page bg-white rounded-2xl p-5 mb-8 last:mb-0 shadow-lg border border-slate-200 text-slate-900 print:shadow-none print:border-none print:rounded-none print:p-0"
                style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
              >
                <div>
                  {/* Class Page Header */}
                  <div className="flex items-start justify-between border-b-2 border-slate-900 pb-2 mb-2.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-base tracking-tight text-slate-950">SMILE</span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 border border-slate-300 font-bold text-slate-700">
                          MS Weissenbach
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium">· Schuljahr 2026/27</span>
                      </div>
                      <div className="flex items-center gap-2.5 mt-1">
                        <h1 className="text-lg font-black uppercase tracking-tight text-slate-950">
                          Klasse {cls.name}
                        </h1>
                        <span className="text-xs px-2 py-0.5 rounded-md font-bold bg-amber-100 text-amber-900 border border-amber-300">
                          {exportFilter === 'after'
                            ? 'Konferenz-Abschlussprotokoll'
                            : exportFilter === 'before'
                            ? 'Vorkonferenz-Übersicht (Voten)'
                            : 'Konferenzprotokoll & Votenübersicht'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-slate-600 leading-tight">
                      <div><strong>Klassenvorstand:</strong> {kvInfo}</div>
                      <div><strong>Schülerzahl:</strong> {totalPupils} · <strong>Lehrkräfte:</strong> {totalClassTeachers}</div>
                      <div><strong>Stichtag:</strong> 30.10.2026 · <strong>Konferenz:</strong> 03.11.2026</div>
                    </div>
                  </div>

                  {/* Summary Statistics Card */}
                  <div className="bg-slate-50 border border-slate-300 rounded-xl p-2 mb-2.5 text-[11px]">
                    <div className="flex items-center justify-between font-bold mb-1.5 text-slate-800">
                      <span>
                        Klassenstatistik ({totalPupils} Schüler*innen · {confirmedCount} Beschlüsse bestätigt, {openDecisionCount} offen)
                      </span>
                      <span className="text-slate-600 font-normal text-[10px]">
                        Stand: {currentDateStr}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center mb-1.5">
                      <div className="bg-white border border-rose-200 rounded-lg p-1 shadow-2xs">
                        <span className="text-[10px] uppercase font-bold text-rose-700 block">
                          <span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1 align-middle" />
                          Lehrling
                        </span>
                        <strong className="text-sm font-extrabold text-slate-900">{lehrlingCount}</strong>
                        <span className="text-[10px] text-slate-500 ml-1">({pctLehrling}%)</span>
                      </div>

                      <div className="bg-white border border-blue-200 rounded-lg p-1 shadow-2xs">
                        <span className="text-[10px] uppercase font-bold text-blue-700 block">
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1 align-middle" />
                          Geselle
                        </span>
                        <strong className="text-sm font-extrabold text-slate-900">{geselleCount}</strong>
                        <span className="text-[10px] text-slate-500 ml-1">({pctGeselle}%)</span>
                      </div>

                      <div className="bg-white border border-amber-200 rounded-lg p-1 shadow-2xs">
                        <span className="text-[10px] uppercase font-bold text-amber-700 block">
                          <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1 align-middle" />
                          Meister
                        </span>
                        <strong className="text-sm font-extrabold text-slate-900">{meisterCount}</strong>
                        <span className="text-[10px] text-slate-500 ml-1">({pctMeister}%)</span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden flex border border-slate-300">
                      {pctLehrling > 0 && <div style={{ width: `${pctLehrling}%` }} className="bg-rose-500 h-full" />}
                      {pctGeselle > 0 && <div style={{ width: `${pctGeselle}%` }} className="bg-blue-500 h-full" />}
                      {pctMeister > 0 && <div style={{ width: `${pctMeister}%` }} className="bg-amber-400 h-full" />}
                    </div>
                  </div>

                  {/* Pupil Table with Visualized Votes */}
                  {summary.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs italic">
                      Keine Schüler*innen in dieser Klasse eingetragen.
                    </div>
                  ) : (
                    <table className="w-full text-left text-[11px] border-collapse border border-slate-300">
                      <thead>
                        <tr className="bg-slate-100 text-slate-800 text-[9.5px] uppercase border-b border-slate-300 font-bold">
                          <th className="py-1 px-1.5 border-r border-slate-300 w-6 text-center">Nr.</th>
                          <th className="py-1 px-1.5 border-r border-slate-300 font-bold">Schüler*in</th>
                          <th className="py-1 px-1.5 border-r border-slate-300 w-24 text-center font-bold">Raster</th>
                          <th className="py-1 px-2 border-r border-slate-300 w-44 text-center font-bold">
                            Voten je Kategorie (Lehrkräfte)
                          </th>
                          <th className="py-1 px-1.5 border-r border-slate-300 w-24 text-center font-bold">
                            Vorschlag
                          </th>
                          <th className="py-1 px-1.5 border-r border-slate-300 w-28 text-center font-bold">
                            Konferenz-Beschluss
                          </th>
                          <th className="py-1 px-1.5">Karten &amp; Anmerkung</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.map((p, pIdx) => {
                          const vStats = p.voteStats || { Lehrling: 0, Geselle: 0, Meister: 0 };
                          const totalVotes = vStats.Lehrling + vStats.Geselle + vStats.Meister;

                          // Weighted percentage share
                          const pctL = vStats.pctLehrling ?? (totalVotes > 0 ? Math.round((vStats.Lehrling / totalVotes) * 100) : 0);
                          const pctG = vStats.pctGeselle ?? (totalVotes > 0 ? Math.round((vStats.Geselle / totalVotes) * 100) : 0);
                          const pctM = vStats.pctMeister ?? (totalVotes > 0 ? Math.round((vStats.Meister / totalVotes) * 100) : 0);

                          const suggested = p.suggestedRank;
                          const effectiveRank = p.isConfirmed ? p.finalRank : suggested;

                          let rankBadgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
                          if (effectiveRank === 'Meister') rankBadgeClass = 'bg-amber-100 text-amber-900 border-amber-300';
                          else if (effectiveRank === 'Geselle') rankBadgeClass = 'bg-blue-100 text-blue-900 border-blue-300';

                          return (
                            <tr
                              key={p.id}
                              className={`border-b border-slate-200 ${
                                pIdx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'
                              }`}
                            >
                              <td className="py-1 px-1.5 border-r border-slate-200 text-center text-slate-500 text-[10px]">
                                {pIdx + 1}
                              </td>
                              <td className="py-1 px-1.5 border-r border-slate-200 font-bold text-slate-900 truncate max-w-[130px]">
                                {p.fullName}
                              </td>
                              <td className="py-1 px-1.5 border-r border-slate-200 text-center font-semibold text-[10px]">
                                {formatSubjectEvidence(p.subjectEvidence)}
                              </td>
                              {/* Visualized Votes per Category per Pupil */}
                              <td className="py-1 px-2 border-r border-slate-200">
                                {totalVotes > 0 ? (
                                  <div className="flex flex-col gap-0.5">
                                    {/* Mini visual distribution bar */}
                                    <div className="w-full h-2 rounded bg-slate-200 overflow-hidden flex border border-slate-300">
                                      {pctL > 0 && <div style={{ width: `${pctL}%` }} className="bg-rose-500 h-full" title={`Lehrling: ${vStats.Lehrling} (${pctL}%)`} />}
                                      {pctG > 0 && <div style={{ width: `${pctG}%` }} className="bg-blue-500 h-full" title={`Geselle: ${vStats.Geselle} (${pctG}%)`} />}
                                      {pctM > 0 && <div style={{ width: `${pctM}%` }} className="bg-amber-400 h-full" title={`Meister: ${vStats.Meister} (${pctM}%)`} />}
                                    </div>
                                    {/* Vote counts & % label */}
                                    <div className="flex items-center justify-between text-[8.5px] font-bold text-slate-600">
                                      <span className={vStats.Lehrling > 0 ? 'text-rose-700' : 'text-slate-400'}>
                                        {vStats.Lehrling} L {pctL > 0 ? `(${pctL}%)` : ''}
                                      </span>
                                      <span className={vStats.Geselle > 0 ? 'text-blue-700' : 'text-slate-400'}>
                                        {vStats.Geselle} G {pctG > 0 ? `(${pctG}%)` : ''}
                                      </span>
                                      <span className={vStats.Meister > 0 ? 'text-amber-700' : 'text-slate-400'}>
                                        {vStats.Meister} M {pctM > 0 ? `(${pctM}%)` : ''}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-[9.5px] text-slate-400 italic block text-center">
                                    Keine Voten
                                  </span>
                                )}
                              </td>
                              {/* Suggested Rank */}
                              <td className="py-1 px-1.5 border-r border-slate-200 text-center">
                                <span className="text-[10px] font-semibold text-slate-700">
                                  {suggested}
                                </span>
                                {p.hasRedCardDemotion && (
                                  <span className="block text-[8px] font-bold text-rose-600">
                                    (Rangabzug Karte)
                                  </span>
                                )}
                              </td>
                              {/* Conference Decision / Confirmed Rank */}
                              <td className="py-1 px-1.5 border-r border-slate-200 text-center">
                                {p.isConfirmed ? (
                                  <div className="inline-flex items-center gap-1">
                                    <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold border uppercase ${rankBadgeClass}`}>
                                      ✓ {p.finalRank}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[9.5px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                                    ○ Ausstehend
                                  </span>
                                )}
                              </td>
                              {/* Cards & Notes */}
                              <td className="py-1 px-1.5 text-[9.5px] text-slate-600">
                                <div className="flex items-center gap-1">
                                  {p.cards.red.length > 0 && (
                                    <span className="px-1 rounded bg-rose-600 text-white font-bold text-[8.5px]">
                                      {p.cards.red.length} Rot
                                    </span>
                                  )}
                                  {p.cards.yellow.length > 0 && (
                                    <span className="px-1 rounded bg-amber-500 text-white font-bold text-[8.5px]">
                                      {p.cards.yellow.length} Gelb
                                    </span>
                                  )}
                                  <span className="truncate max-w-[120px] text-slate-500">
                                    {p.overrideReason || (p.teacherVotes[0]?.comment ?? '') || '—'}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Class Page Signature Footer */}
                <div className="mt-3 pt-2 border-t border-slate-300 flex items-center justify-between text-[9.5px] text-slate-600">
                  <div>
                    <span>Erstellt am: {currentDateStr} um {currentTimeStr} Uhr · SMILE Konferenzprotokoll</span>
                  </div>
                  <div className="flex items-center gap-6">
                    <span>Klassenvorstand: ____________________</span>
                    <span>Konferenzleitung: ____________________</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
