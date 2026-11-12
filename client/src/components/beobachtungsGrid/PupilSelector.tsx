import React from 'react';
import { ClipboardList, CheckCircle2, Folder, FolderCheck, Users } from 'lucide-react';
import { isPupilFullySubmitted } from '../../lib/pupilItems';
import type { PupilWithData } from '../../types';
import type { RankInfo } from './helpers';
import type { FolderTab } from './types';

interface PupilSelectorProps {
  folderTab: FolderTab;
  openCount: number;
  submittedCount: number;
  currentList: PupilWithData[];
  selectedPupilId: number;
  isAllSubjectsMode: boolean;
  subjectCodes: string[];
  onSelectFolder: (tab: FolderTab) => void;
  onSelectPupil: (pupilId: number) => void;
  calculateRank: (pupil: PupilWithData) => RankInfo;
  activeSubjectCode?: string;
  isSubjectGrouped?: boolean;
  groupFilterMode?: 'my_pupils' | 'all';
  onToggleGroupFilter?: (mode: 'my_pupils' | 'all') => void;
  myPupilCount?: number;
  totalPupilCount?: number;
}

export const PupilSelector: React.FC<PupilSelectorProps> = ({
  folderTab,
  openCount,
  submittedCount,
  currentList,
  selectedPupilId,
  isAllSubjectsMode,
  subjectCodes,
  onSelectFolder,
  onSelectPupil,
  calculateRank,
  activeSubjectCode,
  isSubjectGrouped,
  groupFilterMode = 'my_pupils',
  onToggleGroupFilter,
  myPupilCount,
  totalPupilCount,
}) => {
  return (
    <div className="w-full lg:w-80 bg-slate-900 border border-slate-800 rounded-3xl p-3 sm:p-4 flex flex-col max-h-[44vh] lg:max-h-[86vh] overflow-hidden shadow-lg shrink-0">
      {/* Folder Tabs (Offen vs Bewertet) */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950/80 rounded-2xl border border-slate-800 mb-3">
        <button
          onClick={() => onSelectFolder('offen')}
          className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
            folderTab === 'offen'
              ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-slate-50'
          }`}
        >
          <Folder className="w-3.5 h-3.5" />
          <span>Offen</span>
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
              folderTab === 'offen' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {openCount}
          </span>
        </button>

        <button
          onClick={() => onSelectFolder('bewertet')}
          className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
            folderTab === 'bewertet'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-slate-50'
          }`}
        >
          <FolderCheck className="w-3.5 h-3.5" />
          <span>Bewertet</span>
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
              folderTab === 'bewertet' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {submittedCount}
          </span>
        </button>
      </div>

      {/* Subject Group Filter (Meine Schüler vs Ganze Klasse) when subject is split */}
      {isSubjectGrouped && totalPupilCount && myPupilCount !== undefined && myPupilCount < totalPupilCount && (
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950/80 rounded-2xl border border-slate-800 mb-2.5">
          <button
            type="button"
            onClick={() => onToggleGroupFilter?.('my_pupils')}
            className={`py-1.5 px-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
              groupFilterMode === 'my_pupils'
                ? 'bg-sky-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Meine Schüler</span>
            <span
              className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                groupFilterMode === 'my_pupils' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {myPupilCount}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onToggleGroupFilter?.('all')}
            className={`py-1.5 px-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
              groupFilterMode === 'all'
                ? 'bg-sky-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <span>Ganze Klasse</span>
            <span
              className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                groupFilterMode === 'all' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {totalPupilCount}
            </span>
          </button>
        </div>
      )}

      {/* Pupil List according to active folder */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {currentList.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs px-2">
            {folderTab === 'offen' ? (
              <div>
                <span className="text-2xl block mb-2">🎉</span>
                <strong className="text-slate-50 block mb-1">Alle Schüler bewertet!</strong>
                <span>Alle Schüler dieser Klasse wurden bereits eingereicht. Sie finden diese im Ordner &bdquo;Bewertet&ldquo;.</span>
              </div>
            ) : (
              <div>
                <ClipboardList className="w-8 h-8 block mb-2 mx-auto opacity-60" aria-hidden="true" />
                <strong className="text-slate-50 block mb-1">Noch keine Einreichungen</strong>
                <span>Bewerten Sie einen Schüler und klicken Sie auf &bdquo;Ranking einreichen&ldquo;.</span>
              </div>
            )}
          </div>
        ) : (
          currentList.map((p) => {
            const isSelected = p.id === selectedPupilId;
            const pRank = calculateRank(p);
            const pDone = isPupilFullySubmitted(p.evaluations, subjectCodes);

            return (
              <button
                key={p.id}
                onClick={() => onSelectPupil(p.id)}
                className={`w-full p-3 rounded-2xl flex items-center justify-between text-left transition min-h-[48px] ${
                  isSelected
                    ? folderTab === 'offen'
                      ? 'bg-amber-500/15 border border-amber-500/40 text-slate-50'
                      : 'bg-emerald-500/15 border border-emerald-500/40 text-slate-50'
                    : 'bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800 text-slate-300'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm truncate block leading-tight">{p.fullName}</span>
                    {pDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5 mt-1">
                    {activeSubjectCode && p.assignedGroups?.[activeSubjectCode] && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-950/60 border border-sky-800/60 text-sky-300 font-mono">
                        {p.assignedGroups[activeSubjectCode]}
                      </span>
                    )}
                    {p.greenCardCount > 0 && (
                      <span className="text-[11px] text-emerald-400 font-bold">
                        ★ {p.greenCardCount}
                      </span>
                    )}
                    {p.yellowCardCount > 0 && (
                      <span className="text-[11px] text-amber-400 font-bold">
                        ▲ {p.yellowCardCount}
                      </span>
                    )}
                  </div>
                </div>

                {!isAllSubjectsMode && (
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-bold uppercase tracking-wider border flex-shrink-0 ${pRank.color}`}
                  >
                    {pRank.rank ?? 'Ausstehend'}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
