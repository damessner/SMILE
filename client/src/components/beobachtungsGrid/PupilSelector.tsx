import React from 'react';
import { ClipboardList, CheckCircle2, Folder, FolderCheck } from 'lucide-react';
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
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
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
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              folderTab === 'bewertet' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {submittedCount}
          </span>
        </button>
      </div>

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
                  {(p.greenCardCount > 0 || p.yellowCardCount > 0) && (
                    <div className="flex items-center gap-2 mt-1">
                      {p.greenCardCount > 0 && (
                        <span className="text-[10px] text-emerald-400 font-bold">
                          ★ {p.greenCardCount}
                        </span>
                      )}
                      {p.yellowCardCount > 0 && (
                        <span className="text-[10px] text-amber-400 font-bold">
                          ▲ {p.yellowCardCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {!isAllSubjectsMode && (
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border flex-shrink-0 ${pRank.color}`}
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
