import React, { useState, useEffect } from 'react';
import {
  X,
  Award,
  CheckCircle2,
  AlertCircle,
  Users,
  Calendar,
  Check,
  RotateCcw,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Flame,
  LayoutGrid,
  Maximize2,
  FileText,
  UserCheck,
} from 'lucide-react';
import { SchoolClass, User } from '../types';
import { getConferenceSummary, voteConference, voteAllConference } from '../services/api';

interface TeacherVote {
  teacherId: number;
  teacherShort: string;
  teacherName: string;
  subjectCode: string;
  proposedStatus?: string | null;
  nextStep?: string | null;
  comment?: string | null;
  isSubmitted: boolean;
  submittedAt?: string | null;
  positiveCount: number;
  totalRated: number;
}

interface CardItem {
  id: string;
  teacherShort: string;
  teacherName: string;
  note?: string | null;
  createdAt: string;
}

interface ConferencePupil {
  id: number;
  fullName: string;
  positiveCount: number;
  totalRated: number;
  baseRank: 'Lehrling' | 'Geselle' | 'Meister';
  calculatedRank: 'Lehrling' | 'Geselle' | 'Meister';
  hasRedCardDemotion: boolean;
  finalRank: 'Lehrling' | 'Geselle' | 'Meister';
  isConfirmed: boolean;
  confirmedAt?: string | null;
  votesYes: number;
  votesNo: number;
  totalVoters: number;
  overrideReason?: string | null;
  evaluationsCount: number;
  teacherVotes: TeacherVote[];
  voteStats: {
    Lehrling: number;
    Geselle: number;
    Meister: number;
  };
  cards: {
    green: CardItem[];
    yellow: CardItem[];
    red: CardItem[];
  };
}

interface ConferenceVotingModalProps {
  classes: SchoolClass[];
  initialClassId: number;
  currentUser?: User | null;
  onClose: () => void;
  onVotesUpdated?: () => void;
}

export const ConferenceVotingModal: React.FC<ConferenceVotingModalProps> = ({
  classes,
  initialClassId,
  currentUser,
  onClose,
  onVotesUpdated,
}) => {
  const [selectedClassId, setSelectedClassId] = useState<number>(initialClassId);
  const [loading, setLoading] = useState(true);
  const [totalTeachers, setTotalTeachers] = useState(1);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [pupils, setPupils] = useState<ConferencePupil[]>([]);
  const [currentPupilIndex, setCurrentPupilIndex] = useState<number>(0);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'walkthrough' | 'table'>('walkthrough');

  // Local state for vote adjustments per pupil before submitting
  const [pupilVotes, setPupilVotes] = useState<
    Record<number, { rank: 'Lehrling' | 'Geselle' | 'Meister'; votesNo: number }>
  >({});

  const currentClass = classes.find((c) => c.id === selectedClassId) || classes[0];
  const currentClassIndex = classes.findIndex((c) => c.id === selectedClassId);

  // Check if current user is KV for the selected class
  const teacherShort = currentUser?.teacher?.shortName?.toUpperCase();
  const isHeadmaster =
    currentUser?.role === 'admin' ||
    teacherShort === 'MED' ||
    teacherShort === 'SLC' ||
    currentUser?.username?.toUpperCase() === 'MED' ||
    currentUser?.username?.toUpperCase() === 'SLC';

  const isClassKv = Boolean(
    currentClass &&
      teacherShort &&
      ((currentClass.headTeacher1 && currentClass.headTeacher1.toUpperCase().includes(teacherShort)) ||
        (currentClass.headTeacher2 && currentClass.headTeacher2.toUpperCase().includes(teacherShort)))
  );

  const loadData = async (cid: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getConferenceSummary(cid);
      setTotalTeachers(data.totalClassTeachers || 1);
      setIsAuthorized(data.isAuthorized);
      setPupils(data.summary || []);
      setCurrentPupilIndex(0);

      // Initialize local vote state
      const initialMap: Record<number, { rank: 'Lehrling' | 'Geselle' | 'Meister'; votesNo: number }> = {};
      for (const p of data.summary || []) {
        initialMap[p.id] = {
          rank: (p.finalRank as any) || p.calculatedRank,
          votesNo: p.votesNo || 0,
        };
      }
      setPupilVotes(initialMap);
    } catch (e: any) {
      setError(e.message || 'Fehler beim Laden der Konferenzdaten');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedClassId) {
      loadData(selectedClassId);
    }
  }, [selectedClassId]);

  // Keyboard navigation for pupil walk-through
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== 'walkthrough') return;
      if (e.key === 'ArrowLeft') {
        goToPrevPupil();
      } else if (e.key === 'ArrowRight') {
        goToNextPupil();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPupilIndex, pupils.length, viewMode]);

  const handleRankChange = (pupilId: number, rank: 'Lehrling' | 'Geselle' | 'Meister') => {
    setPupilVotes((prev) => ({
      ...prev,
      [pupilId]: {
        ...prev[pupilId],
        rank,
      },
    }));
  };

  const handleGegenstimmenChange = (pupilId: number, delta: number) => {
    setPupilVotes((prev) => {
      const current = prev[pupilId] || { rank: 'Lehrling', votesNo: 0 };
      const nextVotesNo = Math.max(0, Math.min(totalTeachers, current.votesNo + delta));
      return {
        ...prev,
        [pupilId]: {
          ...current,
          votesNo: nextVotesNo,
        },
      };
    });
  };

  const handleSetGegenstimmen = (pupilId: number, count: number) => {
    setPupilVotes((prev) => {
      const current = prev[pupilId] || { rank: 'Lehrling', votesNo: 0 };
      const nextVotesNo = Math.max(0, Math.min(totalTeachers, isNaN(count) ? 0 : count));
      return {
        ...prev,
        [pupilId]: {
          ...current,
          votesNo: nextVotesNo,
        },
      };
    });
  };

  // Toggle acceptance (Angenommen / Zurücknehmen)
  const handleToggleVoteSingle = async (p: ConferencePupil) => {
    const cur = pupilVotes[p.id] || { rank: p.finalRank || p.calculatedRank, votesNo: 0 };
    setSubmittingId(p.id);
    setError(null);
    try {
      if (p.isConfirmed) {
        // Toggle OFF / Revoke accidental acceptance
        await voteConference(
          selectedClassId,
          p.id,
          cur.rank,
          cur.votesNo,
          undefined,
          'unconfirm'
        );
      } else {
        // Confirm with official conference timestamp (03.11.2026 23:59)
        await voteConference(
          selectedClassId,
          p.id,
          cur.rank,
          cur.votesNo,
          'Beschluss der Klassenkonferenz vom 03.11.2026',
          'confirm'
        );
      }
      await loadData(selectedClassId);
      if (onVotesUpdated) onVotesUpdated();
    } catch (e: any) {
      setError(e.message || 'Fehler beim Speichern des Konferenzbeschlusses');
    } finally {
      setSubmittingId(null);
    }
  };

  const handleAcceptAllProposals = async () => {
    if (
      !window.confirm(
        `Möchten Sie wirklich alle ${pupils.length} vorgeschlagenen Einstufungen für Klasse ${currentClass?.name} einstimmig (0 Gegenstimmen) annehmen?`
      )
    ) {
      return;
    }
    setBatchSubmitting(true);
    setError(null);
    try {
      const items = pupils.map((p) => {
        const cur = pupilVotes[p.id];
        return {
          pupilId: p.id,
          rank: cur?.rank || p.calculatedRank,
          votesNo: cur?.votesNo || 0,
        };
      });
      await voteAllConference(selectedClassId, items);
      await loadData(selectedClassId);
      if (onVotesUpdated) onVotesUpdated();
    } catch (e: any) {
      setError(e.message || 'Fehler beim Stapel-Beschluss');
    } finally {
      setBatchSubmitting(false);
    }
  };

  const goToPrevClass = () => {
    if (currentClassIndex > 0) {
      setSelectedClassId(classes[currentClassIndex - 1].id);
    }
  };

  const goToNextClass = () => {
    if (currentClassIndex < classes.length - 1) {
      setSelectedClassId(classes[currentClassIndex + 1].id);
    }
  };

  const goToPrevPupil = () => {
    if (currentPupilIndex > 0) {
      setCurrentPupilIndex((prev) => prev - 1);
    }
  };

  const goToNextPupil = () => {
    if (currentPupilIndex < pupils.length - 1) {
      setCurrentPupilIndex((prev) => prev + 1);
    }
  };

  const confirmedCount = pupils.filter((p) => p.isConfirmed).length;
  const currentPupil = pupils[currentPupilIndex];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col w-screen h-screen overflow-hidden text-slate-100">
      {/* Top Vollbild Header Bar */}
      <div className="p-3.5 px-6 border-b border-slate-800 bg-slate-900/90 flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
            <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
              <span>Konferenz-Modus</span>
              <span className="text-xs px-2.5 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase font-black tracking-wider">
                {isHeadmaster ? 'Schulleitung (MED & SLC)' : isClassKv ? 'Klassenvorstand' : 'Konferenz'}
              </span>
            </h1>
          </div>

          {/* Class Stepper & Pills */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-2xl border border-slate-800">
            <button
              onClick={goToPrevClass}
              disabled={currentClassIndex <= 0}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 transition"
              title="Vorherige Klasse"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 overflow-x-auto max-w-md px-1">
              {classes.map((cls) => {
                const isThisClassKv = Boolean(
                  teacherShort &&
                    ((cls.headTeacher1 && cls.headTeacher1.toUpperCase().includes(teacherShort)) ||
                      (cls.headTeacher2 && cls.headTeacher2.toUpperCase().includes(teacherShort)))
                );

                return (
                  <button
                    key={cls.id}
                    onClick={() => setSelectedClassId(cls.id)}
                    className={`px-3 py-1 rounded-xl font-black text-xs transition flex items-center gap-1 ${
                      selectedClassId === cls.id
                        ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <span>{cls.name}</span>
                    {isThisClassKv && (
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400" title="Klassenvorstand" />
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={goToNextClass}
              disabled={currentClassIndex >= classes.length - 1}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 transition"
              title="Nächste Klasse"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Action Controls & View Switcher */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1 text-amber-400 font-bold bg-amber-400/10 px-2.5 py-1 rounded-xl border border-amber-400/20">
              <Calendar className="w-3.5 h-3.5" />
              03.11.2026
            </span>
            <span className="flex items-center gap-1 text-slate-300 font-medium">
              <Users className="w-3.5 h-3.5 text-sky-400" />
              {totalTeachers} Lehrpersonen ({currentClass?.name})
            </span>
            <span className="bg-slate-800 px-3 py-1 rounded-xl text-slate-300 font-bold border border-slate-700">
              Beschlüsse: <strong className="text-white">{confirmedCount}</strong> / {pupils.length}
            </span>
          </div>

          {/* View Mode Toggle: Walk-Through Presentation vs Overview Table */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800">
            <button
              onClick={() => setViewMode('walkthrough')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                viewMode === 'walkthrough'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Präsentationsansicht (Schüler für Schüler)"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Präsentation</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                viewMode === 'table'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Tabellarische Gesamtübersicht"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Liste</span>
            </button>
          </div>

          {isAuthorized && pupils.length > 0 && (
            <button
              onClick={handleAcceptAllProposals}
              disabled={batchSubmitting}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 transition shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{batchSubmitting ? 'Speichere...' : 'Alle annehmen'}</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition"
            title="Vollbild schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Error notification */}
      {error && (
        <div className="px-6 py-2.5 bg-red-500/15 border-b border-red-500/30 text-xs text-red-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Lade Konferenzdaten für Klasse {currentClass?.name}...
        </div>
      ) : pupils.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          Keine aktiven Schüler in Klasse {currentClass?.name} gefunden.
        </div>
      ) : viewMode === 'walkthrough' && currentPupil ? (
        /* ========================================================================= */
        /* WALKTHROUGH PRESENTATION MODE (Schüler für Schüler Beamer-Präsentation)   */
        /* ========================================================================= */
        <div className="flex-1 flex flex-col justify-between overflow-y-auto p-4 md:p-6 max-w-6xl w-full mx-auto">
          {(() => {
            const p = currentPupil;
            const cur = pupilVotes[p.id] || {
              rank: p.finalRank || p.calculatedRank,
              votesNo: p.votesNo || 0,
            };

            const votesNo = cur.votesNo;
            const votesYes = Math.max(0, totalTeachers - votesNo);
            const percentYes = Math.round((votesYes / totalTeachers) * 100);

            // Color bar & badges
            let barColor = 'bg-rose-500';
            let badgeBg = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
            if (cur.rank === 'Meister') {
              barColor = 'bg-amber-400';
              badgeBg = 'bg-amber-400/20 text-amber-300 border-amber-400/40';
            } else if (cur.rank === 'Geselle') {
              barColor = 'bg-blue-500';
              badgeBg = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
            }

            const isSubmitting = submittingId === p.id;
            const greenCards = p.cards?.green || [];
            const yellowCards = p.cards?.yellow || [];
            const redCards = p.cards?.red || [];

            return (
              <div className="space-y-5">
                {/* 1. Top Pupil Header & Rank Banner */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 shadow-xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 font-bold mb-1">
                        <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300">
                          Schüler {currentPupilIndex + 1} von {pupils.length}
                        </span>
                        <span>· Klasse {currentClass?.name}</span>
                        {p.isConfirmed && (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-black">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Beschluss erfasst</span>
                          </span>
                        )}
                      </div>
                      <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight">
                        {p.fullName}
                      </h2>
                    </div>

                    {/* Rank Badge & Red Card Demotion Indicator */}
                    <div className="flex items-center gap-3">
                      {p.hasRedCardDemotion && (
                        <div className="px-3 py-1 rounded-xl bg-rose-500/20 border border-rose-500/50 text-rose-200 text-xs font-black flex items-center gap-1.5 animate-pulse">
                          <ShieldAlert className="w-4 h-4 text-rose-400" />
                          <span>Degradiert durch Rote Karte ({p.baseRank} ➔ {p.calculatedRank})</span>
                        </div>
                      )}

                      <div className={`px-4 py-1.5 rounded-2xl text-base font-black uppercase tracking-wider border shadow-md ${badgeBg}`}>
                        {cur.rank}
                      </div>
                    </div>
                  </div>

                  {/* Positive Criteria Progress Bar */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                      <span>
                        Positive Merkmale: <strong className="text-white text-sm">{p.positiveCount}</strong> / 18
                      </span>
                      <span>
                        Vorschlag Algorithmus: <strong className="text-amber-300 font-bold">{p.calculatedRank}</strong>
                      </span>
                    </div>
                    <div className="w-full h-3.5 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
                      <div
                        style={{ width: `${Math.min(100, Math.round((p.positiveCount / 18) * 100))}%` }}
                        className={`h-full ${barColor} transition-all duration-300 rounded-full`}
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Statistical Breakdown: What each teacher voted */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-amber-400" />
                      <h3 className="font-black text-white text-sm uppercase tracking-wider">
                        Lehrer-Votings &amp; Vorschläge ({p.teacherVotes?.length || 0} Rückmeldungen)
                      </h3>
                    </div>

                    {/* Quick proposals summary tally */}
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <span className="px-2 py-0.5 rounded-lg bg-amber-400/20 text-amber-300 border border-amber-400/30">
                        {p.voteStats?.Meister || 0}x Meister
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {p.voteStats?.Geselle || 0}x Geselle
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        {p.voteStats?.Lehrling || 0}x Lehrling
                      </span>
                    </div>
                  </div>

                  {p.teacherVotes && p.teacherVotes.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {p.teacherVotes.map((tv, i) => (
                        <div
                          key={i}
                          className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="font-bold text-white text-xs">
                                {tv.subjectCode} · {tv.teacherShort}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border ${
                                  tv.proposedStatus === 'Meister'
                                    ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                                    : tv.proposedStatus === 'Geselle'
                                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                }`}
                              >
                                {tv.proposedStatus || 'Ausstehend'}
                              </span>
                            </div>

                            <div className="text-[11px] text-slate-400 mb-1">
                              Kriterien: <strong className="text-slate-200">{tv.positiveCount}</strong> positiv
                            </div>

                            {tv.comment && (
                              <p className="text-[11px] text-slate-300 italic bg-slate-900/60 p-2 rounded-xl border border-slate-800">
                                &bdquo;{tv.comment}&ldquo;
                              </p>
                            )}
                          </div>

                          {tv.nextStep && (
                            <div className="text-[10px] text-slate-400 mt-2 pt-1.5 border-t border-slate-800/60 truncate">
                              Nächster Schritt: <span className="text-slate-200">{tv.nextStep}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 py-3 italic text-center">
                      Noch keine detaillierten Beobachtungsbögen der Fachlehrer für diesen Schüler abgegeben.
                    </p>
                  )}
                </div>

                {/* 3. Verhaltenskarten mit Infotext (Grün, Gelb, Rot) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Grüne Karten */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-lg flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                        <span className="font-bold text-xs text-emerald-400 flex items-center gap-1.5">
                          <span>★</span>
                          <span>Grüne Karten</span>
                        </span>
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-black border border-emerald-500/30">
                          {greenCards.length}
                        </span>
                      </div>

                      {greenCards.length > 0 ? (
                        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                          {greenCards.map((c) => (
                            <div key={c.id} className="p-2 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs">
                              <div className="text-[10px] text-slate-400 font-bold mb-0.5">
                                von {c.teacherShort} · {new Date(c.createdAt).toLocaleDateString('de-AT')}
                              </div>
                              <div className="text-slate-200">{c.note || 'Kein Text hinterlegt'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 py-4 text-center italic">
                          Keine grünen Karten vorhanden.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Gelbe Karten */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-lg flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                        <span className="font-bold text-xs text-amber-400 flex items-center gap-1.5">
                          <span>▲</span>
                          <span>Gelbe Karten</span>
                        </span>
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-black border ${
                          yellowCards.length >= 2
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        }`}>
                          {yellowCards.length} {yellowCards.length >= 2 ? '(Mahnstufe)' : ''}
                        </span>
                      </div>

                      {yellowCards.length > 0 ? (
                        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                          {yellowCards.map((c) => (
                            <div key={c.id} className="p-2 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs">
                              <div className="text-[10px] text-slate-400 font-bold mb-0.5">
                                von {c.teacherShort} · {new Date(c.createdAt).toLocaleDateString('de-AT')}
                              </div>
                              <div className="text-slate-200">{c.note || 'Kein Text hinterlegt'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 py-4 text-center italic">
                          Keine gelben Karten vorhanden.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Rote Karten */}
                  <div className={`bg-slate-900 border rounded-3xl p-4 shadow-lg flex flex-col justify-between ${
                    redCards.length > 0 ? 'border-rose-500/60 shadow-rose-950/20' : 'border-slate-800'
                  }`}>
                    <div>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                        <span className="font-bold text-xs text-rose-400 flex items-center gap-1.5">
                          <span>🟥</span>
                          <span>Rote Karten (Rangverlust)</span>
                        </span>
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-black border ${
                          redCards.length > 0
                            ? 'bg-rose-500/30 text-rose-200 border-rose-500/60 shadow-md shadow-rose-500/20'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {redCards.length} {redCards.length > 0 ? '(Rangverlust)' : ''}
                        </span>
                      </div>

                      {redCards.length > 0 ? (
                        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                          {redCards.map((c) => (
                            <div key={c.id} className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs">
                              <div className="text-[10px] text-rose-300 font-bold mb-0.5 flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3 text-rose-400" />
                                <span>von {c.teacherShort} · {new Date(c.createdAt).toLocaleDateString('de-AT')}</span>
                              </div>
                              <div className="text-slate-100 font-medium">{c.note || 'Keine Beschreibung angegeben'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 py-4 text-center italic">
                          Keine roten Karten erfasst.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 4. Konferenz-Beschluss & Abstimmung Card */}
                <div className="bg-slate-900/90 border-2 border-amber-500/40 rounded-3xl p-5 md:p-6 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-5">
                  <div className="flex flex-wrap items-center gap-6">
                    {/* Rank Selection */}
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1.5">
                        Festgelegter Rang
                      </div>
                      {isAuthorized ? (
                        <select
                          value={cur.rank}
                          onChange={(e) =>
                            handleRankChange(p.id, e.target.value as 'Lehrling' | 'Geselle' | 'Meister')
                          }
                          className="px-3.5 py-2 rounded-xl bg-slate-950 border border-amber-400/50 text-sm font-black text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          <option value="Lehrling">🔴 Lehrling</option>
                          <option value="Geselle">🔵 Geselle</option>
                          <option value="Meister">🟡 Meister</option>
                        </select>
                      ) : (
                        <span className={`px-3 py-1.5 rounded-xl text-sm font-black border ${badgeBg}`}>
                          {cur.rank}
                        </span>
                      )}
                    </div>

                    {/* Gegenstimmen Counter */}
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
                        Gegenstimmen
                      </div>
                      {isAuthorized ? (
                        <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => handleGegenstimmenChange(p.id, -1)}
                            disabled={votesNo <= 0}
                            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-black text-sm flex items-center justify-center disabled:opacity-30 transition"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            max={totalTeachers}
                            value={votesNo}
                            onChange={(e) => handleSetGegenstimmen(p.id, parseInt(e.target.value, 10))}
                            className="w-12 text-center bg-transparent text-sm font-black text-white focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleGegenstimmenChange(p.id, 1)}
                            disabled={votesNo >= totalTeachers}
                            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-black text-sm flex items-center justify-center disabled:opacity-30 transition"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm font-bold text-slate-200">
                          {votesNo} Gegenstimmen
                        </span>
                      )}
                    </div>

                    {/* Calculated Live Result */}
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
                        Ergebnis Klassenkonferenz
                      </div>
                      <div className="text-sm font-black text-white">
                        <span className={votesNo > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                          {votesYes} von {totalTeachers} Stimmen dafür
                        </span>
                        <span className="text-slate-400 block text-xs font-normal">
                          ({percentYes}% Zustimmung)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Angenommen Button & Timestamp & Un-accept toggle */}
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
                    {p.isConfirmed ? (
                      <div className="text-right sm:mr-2">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs">
                          <Check className="w-3.5 h-3.5" />
                          <span>Angenommen</span>
                        </span>
                        <span className="block text-[11px] text-amber-300 font-mono mt-0.5" title="Offizieller Konferenzstempel">
                          03.11.2026, 23:59 Uhr
                        </span>
                      </div>
                    ) : null}

                    {isAuthorized && (
                      <div className="flex items-center gap-2">
                        {p.isConfirmed ? (
                          <button
                            onClick={() => handleToggleVoteSingle(p)}
                            disabled={isSubmitting}
                            className="px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 bg-slate-800 hover:bg-rose-500/20 hover:text-rose-300 text-slate-300 border border-slate-700 hover:border-rose-500/40 transition active:scale-95"
                            title="Aus Versehen angenommen? Hier klicken, um den Beschluss zurückzusetzen."
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                            <span>{isSubmitting ? 'Widerrufe...' : 'Annahme zurücknehmen'}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleToggleVoteSingle(p)}
                            disabled={isSubmitting}
                            className="px-6 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/25 transition active:scale-95"
                          >
                            <Check className="w-4 h-4" />
                            <span>{isSubmitting ? 'Speichere...' : 'Als Beschluss annehmen'}</span>
                          </button>
                        )}

                        <button
                          onClick={goToNextPupil}
                          disabled={currentPupilIndex >= pupils.length - 1}
                          className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1 transition disabled:opacity-30"
                          title="Zum nächsten Schüler"
                        >
                          <span>Nächster</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        /* ========================================================================= */
        /* TABLE OVERVIEW MODE                                                       */
        /* ========================================================================= */
        <div className="flex-1 overflow-y-auto p-6 max-w-7xl w-full mx-auto divide-y divide-slate-800/80">
          {pupils.map((pupil, idx) => {
            const cur = pupilVotes[pupil.id] || {
              rank: pupil.finalRank || pupil.calculatedRank,
              votesNo: pupil.votesNo || 0,
            };

            const votesNo = cur.votesNo;
            const votesYes = Math.max(0, totalTeachers - votesNo);
            const percentYes = Math.round((votesYes / totalTeachers) * 100);

            let barColor = 'bg-rose-500';
            let badgeBg = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
            if (cur.rank === 'Meister') {
              barColor = 'bg-amber-400';
              badgeBg = 'bg-amber-400/20 text-amber-300 border-amber-400/40';
            } else if (cur.rank === 'Geselle') {
              barColor = 'bg-blue-500';
              badgeBg = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
            }

            const isSubmitting = submittingId === pupil.id;

            return (
              <div
                key={pupil.id}
                className={`py-4 px-5 rounded-2xl transition flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  pupil.isConfirmed ? 'bg-slate-900/60 border border-slate-800/60' : 'hover:bg-slate-900/40'
                }`}
              >
                <div className="w-full md:w-80">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-mono text-xs w-6">{idx + 1}.</span>
                    <button
                      onClick={() => {
                        setCurrentPupilIndex(idx);
                        setViewMode('walkthrough');
                      }}
                      className="font-bold text-white text-base leading-tight truncate hover:text-amber-400 text-left"
                    >
                      {pupil.fullName}
                    </button>
                    {pupil.isConfirmed && (
                      <span title="Beschluss gefasst">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      </span>
                    )}
                    {pupil.hasRedCardDemotion && (
                      <span title="Degradiert durch Rote Karte">
                        <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
                      </span>
                    )}
                  </div>

                  <div className="mt-2 pl-8">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span>Positive Merkmale: <strong className="text-white">{pupil.positiveCount}</strong> / 18</span>
                      <span>Vorschlag: <strong className="text-amber-300">{pupil.calculatedRank}</strong></span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
                      <div
                        style={{ width: `${Math.min(100, Math.round((pupil.positiveCount / 18) * 100))}%` }}
                        className={`h-full ${barColor}`}
                      />
                    </div>
                  </div>
                </div>

                {/* Middle: Rank & Gegenstimmen */}
                <div className="flex flex-wrap items-center gap-5">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Rang
                    </div>
                    {isAuthorized ? (
                      <select
                        value={cur.rank}
                        onChange={(e) =>
                          handleRankChange(pupil.id, e.target.value as 'Lehrling' | 'Geselle' | 'Meister')
                        }
                        className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white focus:outline-none focus:border-amber-400"
                      >
                        <option value="Lehrling">🔴 Lehrling</option>
                        <option value="Geselle">🔵 Geselle</option>
                        <option value="Meister">🟡 Meister</option>
                      </select>
                    ) : (
                      <span className={`px-2.5 py-1 rounded-xl text-xs font-black border ${badgeBg}`}>
                        {cur.rank}
                      </span>
                    )}
                  </div>

                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Gegenstimmen
                    </div>
                    {isAuthorized ? (
                      <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-xl p-0.5">
                        <button
                          type="button"
                          onClick={() => handleGegenstimmenChange(pupil.id, -1)}
                          disabled={votesNo <= 0}
                          className="w-7 h-7 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-white font-black text-sm flex items-center justify-center disabled:opacity-30"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          max={totalTeachers}
                          value={votesNo}
                          onChange={(e) => handleSetGegenstimmen(pupil.id, parseInt(e.target.value, 10))}
                          className="w-10 text-center bg-transparent text-xs font-bold text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleGegenstimmenChange(pupil.id, 1)}
                          disabled={votesNo >= totalTeachers}
                          className="w-7 h-7 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-white font-black text-sm flex items-center justify-center disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-slate-300">
                        {pupil.votesNo} Gegenstimmen
                      </span>
                    )}
                  </div>

                  <div className="min-w-[150px]">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Ergebnis
                    </div>
                    <div className="text-xs font-bold text-white">
                      <span className={votesNo > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                        {votesYes} von {totalTeachers} dafür
                      </span>
                      <span className="text-slate-400 block text-[10px] font-normal">
                        ({percentYes}% Zustimmung)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Angenommen Button & Un-accept toggle */}
                <div className="flex items-center gap-3">
                  {pupil.isConfirmed ? (
                    <div className="text-right">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-xs">
                        <Check className="w-3.5 h-3.5" />
                        <span>Angenommen</span>
                      </span>
                      <span className="block text-[10px] text-slate-400 font-mono mt-0.5">
                        03.11.2026 23:59
                      </span>
                    </div>
                  ) : null}

                  {isAuthorized && (
                    <button
                      onClick={() => handleToggleVoteSingle(pupil)}
                      disabled={isSubmitting}
                      className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition ${
                        pupil.isConfirmed
                          ? 'bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700'
                          : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20 font-black'
                      }`}
                    >
                      {isSubmitting ? (
                        <span>Speichere...</span>
                      ) : pupil.isConfirmed ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Zurücknehmen</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Angenommen</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom Bar: Pupil Carousel & Navigation */}
      <div className="p-3 px-6 border-t border-slate-800 bg-slate-900/90 flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={goToPrevPupil}
            disabled={currentPupilIndex <= 0}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1 transition disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Vorheriger</span>
          </button>

          {/* Quick Pupil Thumbnails Carousel */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-xl py-1">
            {pupils.map((p, idx) => {
              const cur = pupilVotes[p.id] || { rank: p.finalRank || p.calculatedRank };
              let dotColor = 'bg-rose-500';
              if (cur.rank === 'Meister') dotColor = 'bg-amber-400';
              else if (cur.rank === 'Geselle') dotColor = 'bg-blue-500';

              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setCurrentPupilIndex(idx);
                    setViewMode('walkthrough');
                  }}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 border ${
                    currentPupilIndex === idx && viewMode === 'walkthrough'
                      ? 'bg-slate-700 text-white border-amber-400 shadow-sm'
                      : 'bg-slate-950/80 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                  title={`${idx + 1}. ${p.fullName} (${cur.rank})`}
                >
                  <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                  <span className="truncate max-w-[80px]">{p.fullName.split(' ')[0]}</span>
                  {p.isConfirmed && (
                    <Check className="w-3 h-3 text-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={goToNextPupil}
            disabled={currentPupilIndex >= pupils.length - 1}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1 transition disabled:opacity-30"
          >
            <span>Nächster</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-xs">
            Schüler <strong className="text-white">{currentPupilIndex + 1}</strong> von {pupils.length}
          </span>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};
