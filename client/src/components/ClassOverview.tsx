import React, { useState, useMemo } from 'react';
import {
  FolderCheck,
  Clock,
  Play,
  Award,
  FileText,
  Search,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Undo2,
  ChevronRight,
  Sparkles,
  Info,
} from 'lucide-react';
import { PupilWithData, SchoolClass, RubricCriterion, User } from '../types';
import { isPupilFullySubmitted, isSubjectMatch } from '../lib/pupilItems';

interface ClassOverviewProps {
  currentClass: SchoolClass;
  pupils: PupilWithData[];
  onStartRating: (pupilId?: number) => void;
  onOpenKelReport: (pupil: PupilWithData) => void;
  onOpenCardDrawer: (pupilId: number, name: string) => void;
  onReopenEvaluation: (pupilId: number) => void;
  canAccessRaster?: boolean;
  mySubjects?: any[];
  currentUser: User | null;
}

export const ClassOverview: React.FC<ClassOverviewProps> = ({
  currentClass,
  pupils,
  onStartRating,
  onOpenKelReport,
  onOpenCardDrawer,
  onReopenEvaluation,
  canAccessRaster = true,
  mySubjects = [],
  currentUser,
}) => {
  const [activeFolder, setActiveFolder] = useState<'open' | 'ranked'>('open');
  const [searchQuery, setSearchQuery] = useState('');

  // Deadline: 30.10.2026 23:59:59
  const deadline = new Date(2026, 9, 30, 23, 59, 59);
  const now = new Date();
  const isPastDeadline = now > deadline;

  // Format deadline string
  const deadlineFormatted = '30.10.2026, 23:59 Uhr';

  // Calculate rank for a pupil
  const isPositiveRating = (r?: string) =>
    r === 'crown' || r === 'smile' || r === '++' || r === '+';

  const getPupilRank = (p: PupilWithData) => {
    const allItems = p.evaluations.flatMap((e) => e.items || []);
    const pos = allItems.filter((i) => isPositiveRating(i.rating)).length;
    if (pos >= 14) return { rank: 'Meister', color: 'bg-amber-400/20 text-amber-300 border-amber-400/40', barColor: 'bg-amber-400', pos };
    if (pos >= 8) return { rank: 'Geselle', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40', barColor: 'bg-blue-500', pos };
    return { rank: 'Lehrling', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40', barColor: 'bg-rose-500', pos };
  };

  // Check if this pupil is submitted by current teacher, across every subject
  // this teacher teaches in the class - not across the pupil's other subjects,
  // which may be none of the current teacher's business.
  const isPupilSubmitted = (p: PupilWithData) => {
    return isPupilFullySubmitted(p.evaluations, mySubjects.map((s) => s.code));
  };

  const getSubmissionInfo = (p: PupilWithData) => {
    const sub = p.evaluations.find(
      (e) => mySubjects.some((s) => isSubjectMatch(s.code, e.subjectCode)) && e.isSubmitted
    );
    return sub;
  };

  // Split into Open and Ranked folders. `mySubjects` is a dependency of the
  // split, not just of `isPupilSubmitted`: it arrives with the class data and
  // the folders must be recomputed when it does.
  const openPupils = useMemo(() => {
    return pupils.filter((p) => !isPupilSubmitted(p));
  }, [pupils, mySubjects]);

  const rankedPupils = useMemo(() => {
    return pupils.filter((p) => isPupilSubmitted(p));
  }, [pupils, mySubjects]);

  // Current folder filtered by search
  const currentList = activeFolder === 'open' ? openPupils : rankedPupils;
  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return currentList;
    return currentList.filter((p) => p.fullName.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [currentList, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Banner & Deadline Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold">
                Klasse {currentClass.name}
              </span>
              <h1 className="text-2xl font-bold text-slate-50">Klassenübersicht</h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {pupils.length} Schüler/innen gesamt · {rankedPupils.length} bewertet · {openPupils.length} noch offen
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Deadline Pill */}
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs">
              <Calendar className="w-4 h-4 text-sky-400" />
              <div>
                <span className="text-slate-400 block text-[10px]">Abgabefrist:</span>
                <span className={`font-bold ${isPastDeadline ? 'text-rose-400' : 'text-slate-200'}`}>
                  {deadlineFormatted} {isPastDeadline ? '(Abgelaufen)' : ''}
                </span>
              </div>
            </div>

            {/* Start Rating Mode Button */}
            <button
              data-tour="start-rating-button"
              onClick={() => onStartRating(openPupils[0]?.id || pupils[0]?.id)}
              disabled={isPastDeadline}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-sm transition active:scale-95 disabled:opacity-40"
            >
              <Play className="w-4 h-4 fill-slate-950" />
              <span>{canAccessRaster ? 'Bewertungsmodus starten' : 'Einstufung starten'}</span>
            </button>
          </div>
        </div>

        {/* Progress Bar of Ranked vs Open */}
        <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-50">{rankedPupils.length} von {pupils.length} abgeschlossen</span>
            <span>({pupils.length > 0 ? Math.round((rankedPupils.length / pupils.length) * 100) : 0}%)</span>
          </div>
          <div className="w-full sm:w-64 h-2.5 bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
            <div
              style={{
                width: `${pupils.length > 0 ? (rankedPupils.length / pupils.length) * 100 : 0}%`,
              }}
              className="bg-emerald-500 h-full transition-all duration-500"
            />
          </div>
        </div>
      </div>

      {/* Folders & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Folders Tabs: Offen vs Bewertet */}
        <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-2xl w-full sm:w-auto">
          <button
            onClick={() => setActiveFolder('open')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
              activeFolder === 'open'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-sm'
                : 'text-slate-400 hover:text-slate-50'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Offen / Zu bewerten</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeFolder === 'open' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {openPupils.length}
            </span>
          </button>

          <button
            onClick={() => setActiveFolder('ranked')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
              activeFolder === 'ranked'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-sm'
                : 'text-slate-400 hover:text-slate-50'
            }`}
          >
            <FolderCheck className="w-3.5 h-3.5" />
            <span>Bewertet (Abgeschlossen)</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeFolder === 'ranked' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {rankedPupils.length}
            </span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Schüler filtern..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* Pupils Grid in Folder */}
      {filteredList.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400">
          {activeFolder === 'open' ? (
            <div className="space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <h3 className="text-base font-bold text-slate-50">Alle Schüler dieser Klasse sind bewertet!</h3>
              <p className="text-xs text-slate-500">
                Sie haben alle Rankings eingereicht. Sie finden diese im Ordner „Bewertet (Abgeschlossen)“.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <FolderCheck className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-base font-bold text-slate-50">Noch keine Bewertungen abgeschlossen</h3>
              <p className="text-xs text-slate-500">
                Starten Sie den Bewertungsmodus, um Schüler zu ranken und einzureichen.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredList.map((pupil) => {
            const pRank = getPupilRank(pupil);
            const subInfo = getSubmissionInfo(pupil);
            const isDone = !!subInfo;

            return (
              <div
                key={pupil.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-3xl p-5 shadow-lg flex flex-col justify-between transition group"
              >
                <div>
                  {/* Header: Name and Status */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="font-bold text-base text-slate-50 group-hover:text-amber-400 transition">
                        {pupil.fullName}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-slate-400">
                          {pRank.pos} / 18 Punkte
                        </span>
                        {pupil.greenCardCount > 0 && (
                          <span className="text-[10px] text-emerald-400 font-bold">
                            ★ {pupil.greenCardCount}
                          </span>
                        )}
                        {pupil.yellowCardCount > 0 && (
                          <span className="text-[10px] text-amber-400 font-bold">
                            ▲ {pupil.yellowCardCount}
                          </span>
                        )}
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-bold uppercase tracking-wider border ${pRank.color}`}
                    >
                      {pRank.rank}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mb-4 border border-slate-700/60">
                    <div
                      style={{ width: `${Math.min(100, Math.round((pRank.pos / 18) * 100))}%` }}
                      className={`h-full ${pRank.barColor} transition-all duration-300`}
                    />
                  </div>

                  {/* Submission Timestamp Badge */}
                  {isDone && subInfo?.submittedAt && (
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] flex items-center justify-between mb-4">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Eingereicht</span>
                      </div>
                      <span className="text-[10px] text-emerald-400/80">
                        {new Date(subInfo.submittedAt).toLocaleString('de-AT', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions Bar */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onOpenCardDrawer(pupil.id, pupil.fullName)}
                      title="Verhaltenskarte"
                      className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-slate-50 transition"
                    >
                      <Award className="w-4 h-4 text-emerald-400" />
                    </button>
                    <button
                      onClick={() => onOpenKelReport(pupil)}
                      title="KEL-Bericht"
                      className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-slate-50 transition"
                    >
                      <FileText className="w-4 h-4 text-sky-400" />
                    </button>

                    {/* Reopen button if submitted and before deadline */}
                    {isDone && !isPastDeadline && (
                      <button
                        onClick={() => onReopenEvaluation(pupil.id)}
                        title="Bewertung zur Bearbeitung wieder öffnen"
                        className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-bold flex items-center gap-1 transition"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span className="text-[11px]">Öffnen</span>
                      </button>
                    )}
                  </div>

                    <button
                      onClick={() => onStartRating(pupil.id)}
                      className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
                    >
                      <span>{isDone ? 'Prüfen' : canAccessRaster ? 'Bewerten' : 'Einstufen'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
