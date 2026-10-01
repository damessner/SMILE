import React from 'react';
import { X, Printer, Award, FileText, CheckCircle2, Clock } from 'lucide-react';
import { PupilWithData, RubricCriterion, User, SchoolClass } from '../types';

interface TeacherClassReportModalProps {
  currentClass: SchoolClass;
  pupils: PupilWithData[];
  criteria: RubricCriterion[];
  currentUser: User;
  onClose: () => void;
}

export const TeacherClassReportModal: React.FC<TeacherClassReportModalProps> = ({
  currentClass,
  pupils,
  criteria,
  currentUser,
  onClose,
}) => {
  const teacherName = currentUser.teacher?.fullName || currentUser.username;
  const teacherShort = currentUser.teacher?.shortName || currentUser.username;
  const subjectsStr =
    currentClass.mySubjects && currentClass.mySubjects.length > 0
      ? currentClass.mySubjects.map((s) => `${s.code} (${s.name})`).join(', ')
      : 'Fachlehrer';

  const totalPupils = pupils.length;

  const isPositive = (r?: string) =>
    r === 'crown' || r === 'smile' || r === '++' || r === '+';

  // Compute stats per pupil
  const pupilStats = pupils.map((p, idx) => {
    const allItems = p.evaluations.flatMap((e) => e.items || []);
    const pos = allItems.filter((i) => isPositive(i.rating)).length;
    let rank: 'Lehrling' | 'Geselle' | 'Meister' = 'Lehrling';
    if (pos >= 14) rank = 'Meister';
    else if (pos >= 8) rank = 'Geselle';

    const evalRecord = p.evaluations[0];
    const isSubmitted = p.evaluations.some((e) => e.isSubmitted);
    const submittedAt = p.evaluations.find((e) => e.submittedAt)?.submittedAt;

    return {
      index: idx + 1,
      id: p.id,
      fullName: p.fullName,
      positiveCount: pos,
      rank,
      isSubmitted,
      submittedAt,
      comment: evalRecord?.comment || evalRecord?.nextStep || '',
    };
  });

  const submittedCount = pupilStats.filter((p) => p.isSubmitted).length;
  const openCount = totalPupils - submittedCount;

  const lehrlingCount = pupilStats.filter((p) => p.rank === 'Lehrling').length;
  const geselleCount = pupilStats.filter((p) => p.rank === 'Geselle').length;
  const meisterCount = pupilStats.filter((p) => p.rank === 'Meister').length;

  const percentLehrling = totalPupils > 0 ? Math.round((lehrlingCount / totalPupils) * 100) : 0;
  const percentGeselle = totalPupils > 0 ? Math.round((geselleCount / totalPupils) * 100) : 0;
  const percentMeister = totalPupils > 0 ? Math.round((meisterCount / totalPupils) * 100) : 0;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      {/* Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[96vh] flex flex-col shadow-2xl overflow-hidden print:m-0 print:p-0 print:border-none print:shadow-none print:bg-white print:max-h-none print:w-full print:max-w-none">
        {/* Modal Controls (Hidden in Print) */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-white text-sm">
              1-Seiten Lehrer-Export (Druckansicht Klasse {currentClass.name})
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-1.5 transition shadow-md shadow-amber-500/20"
            >
              <Printer className="w-4 h-4" />
              <span>Drucken / Als PDF speichern</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable 1-Page Content */}
        <div
          id="printable-teacher-report"
          className="flex-1 overflow-y-auto p-6 bg-white text-slate-900 print:overflow-visible print:p-2 print:text-black"
          style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-2 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-lg tracking-tight text-slate-950">SMILE</span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-300 font-bold text-slate-700">
                  MS Neustift
                </span>
                <span className="text-xs text-slate-500 font-medium">· Schuljahr 2026/27</span>
              </div>
              <h1 className="text-base font-black uppercase tracking-wide text-slate-900 mt-1">
                Lehrer-Klassenübersicht &amp; Bewertungsprotokoll
              </h1>
            </div>
            <div className="text-right text-[11px] text-slate-600 leading-tight">
              <div><strong>Klasse:</strong> {currentClass.name}</div>
              <div><strong>Lehrperson:</strong> {teacherName} ({teacherShort})</div>
              <div><strong>Fach:</strong> {subjectsStr}</div>
              <div><strong>Konferenztermin:</strong> 03.11.2026</div>
            </div>
          </div>

          {/* Top Summary Statistics (Kompakte Gruppenstatistik) */}
          <div className="bg-slate-50 border border-slate-300 rounded-xl p-2.5 mb-3">
            <div className="flex items-center justify-between text-[11px] mb-1.5 font-bold">
              <span className="text-slate-800">
                Statistik der Gruppe ({totalPupils} Schüler*innen · {submittedCount} eingereicht, {openCount} offen)
              </span>
              <span className="text-slate-600 text-[10px]">
                Stichtag Einreichung: 30.10.2026 23:59
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2">
              <div className="bg-white border border-rose-200 rounded-lg p-1.5 shadow-sm">
                <span className="text-[10px] uppercase font-bold text-rose-600 block">🔴 Lehrling</span>
                <strong className="text-sm font-black text-slate-900">{lehrlingCount}</strong>
                <span className="text-[10px] text-slate-500 ml-1">({percentLehrling}%)</span>
              </div>
              <div className="bg-white border border-blue-200 rounded-lg p-1.5 shadow-sm">
                <span className="text-[10px] uppercase font-bold text-blue-600 block">🔵 Geselle</span>
                <strong className="text-sm font-black text-slate-900">{geselleCount}</strong>
                <span className="text-[10px] text-slate-500 ml-1">({percentGeselle}%)</span>
              </div>
              <div className="bg-white border border-amber-200 rounded-lg p-1.5 shadow-sm">
                <span className="text-[10px] uppercase font-bold text-amber-600 block">🟡 Meister</span>
                <strong className="text-sm font-black text-slate-900">{meisterCount}</strong>
                <span className="text-[10px] text-slate-500 ml-1">({percentMeister}%)</span>
              </div>
            </div>

            {/* Compact Color Balken */}
            <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex border border-slate-300">
              {percentLehrling > 0 && (
                <div style={{ width: `${percentLehrling}%` }} className="bg-rose-500 h-full" />
              )}
              {percentGeselle > 0 && (
                <div style={{ width: `${percentGeselle}%` }} className="bg-blue-500 h-full" />
              )}
              {percentMeister > 0 && (
                <div style={{ width: `${percentMeister}%` }} className="bg-amber-400 h-full" />
              )}
            </div>
          </div>

          {/* Table of Pupils */}
          <table className="w-full text-left text-xs border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 text-slate-700 text-[10px] uppercase border-b border-slate-300">
                <th className="py-1 px-2 border-r border-slate-300 w-8 text-center">Nr.</th>
                <th className="py-1 px-2 border-r border-slate-300 font-bold">Schüler*in</th>
                <th className="py-1 px-2 border-r border-slate-300 w-24 text-center font-bold">Smileys (+/👑)</th>
                <th className="py-1 px-2 border-r border-slate-300 w-28 text-center font-bold">Rangvorschlag</th>
                <th className="py-1 px-2 border-r border-slate-300 w-28 text-center font-bold">Status</th>
                <th className="py-1 px-2">Anmerkung / Nächster Schritt</th>
              </tr>
            </thead>
            <tbody>
              {pupilStats.map((p) => {
                let badgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
                if (p.rank === 'Meister') badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
                else if (p.rank === 'Geselle') badgeClass = 'bg-blue-100 text-blue-800 border-blue-300';

                return (
                  <tr key={p.id} className="border-b border-slate-200 hover:bg-slate-50/50">
                    <td className="py-1 px-2 border-r border-slate-200 text-center text-slate-500 text-[11px]">
                      {p.index}
                    </td>
                    <td className="py-1 px-2 border-r border-slate-200 font-bold text-slate-900 text-xs">
                      {p.fullName}
                    </td>
                    <td className="py-1 px-2 border-r border-slate-200 text-center font-semibold text-xs">
                      {p.positiveCount} / 18
                    </td>
                    <td className="py-1 px-2 border-r border-slate-200 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-black border uppercase ${badgeClass}`}>
                        {p.rank}
                      </span>
                    </td>
                    <td className="py-1 px-2 border-r border-slate-200 text-center text-[10px]">
                      {p.isSubmitted ? (
                        <span className="text-emerald-700 font-bold">✓ Eingereicht</span>
                      ) : (
                        <span className="text-amber-700 font-bold">○ Offen</span>
                      )}
                    </td>
                    <td className="py-1 px-2 text-[10px] text-slate-600 truncate max-w-xs">
                      {p.comment || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer Signature Field */}
          <div className="mt-4 pt-3 border-t border-slate-300 flex items-center justify-between text-[11px] text-slate-600">
            <div>
              <span>Erstellt am: {new Date().toLocaleDateString('de-AT')} um {new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} Uhr</span>
            </div>
            <div className="flex items-center gap-8">
              <span>Datum: ______________________</span>
              <span>Unterschrift: ______________________</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
