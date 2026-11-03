import React from 'react';
import { X, Printer, Award, FileText, CheckCircle2, Clock } from 'lucide-react';
import { PupilWithData, RubricCriterion, User, SchoolClass } from '../types';
import { hasSubmittedForSubject, isSubjectMatch, scoreSubject, type AssessmentRank } from '../lib/pupilItems';

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
  // The subjects this teacher teaches in the class - the same set `subjectsStr`
  // prints in the header, and the only set a status verdict may be drawn from.
  const mySubjects = currentClass.mySubjects || [];
  const subjectsStr =
    mySubjects.length > 0
      ? mySubjects.map((s) => `${s.code} (${s.name})`).join(', ')
      : 'Fachlehrer';

  const totalPupils = pupils.length;

  const rubricItemKeys = criteria.flatMap((c) => c.items.map((i) => i.key));

  const subjectsToReport =
    mySubjects.length > 0
      ? mySubjects
      : Array.from(new Set(pupils.flatMap((p) => p.evaluations.map((e) => e.subjectCode)))).map((code) => ({
          code,
          name: code,
        }));

  const subjectReports = subjectsToReport.map((s) => {
    const pupilStats = pupils.map((p, idx) => {
      const scored = scoreSubject(p.evaluations, s.code, rubricItemKeys);
      const evalRecord = p.evaluations.find((e) => isSubjectMatch(e.subjectCode, s.code));
      const isSubmitted = hasSubmittedForSubject(p.evaluations, s.code);
      const submittedAt = evalRecord?.submittedAt;
      const rank: AssessmentRank = scored.rank ?? 'Lehrling';

      return {
        index: idx + 1,
        id: p.id,
        fullName: p.fullName,
        positiveCount: scored.positiveCount,
        totalRated: scored.totalRated,
        rank,
        displayRank: scored.rank ?? 'Ausstehend',
        isSubmitted,
        submittedAt,
        comment: evalRecord?.comment || evalRecord?.nextStep || '',
      };
    });

    const submittedCount = pupilStats.filter((p) => p.isSubmitted).length;
    const openCount = totalPupils - submittedCount;

    const ratedCount = pupilStats.filter((p) => p.totalRated > 0).length;
    const lehrlingCount = pupilStats.filter((p) => p.rank === 'Lehrling' && p.totalRated > 0).length;
    const geselleCount = pupilStats.filter((p) => p.rank === 'Geselle').length;
    const meisterCount = pupilStats.filter((p) => p.rank === 'Meister').length;

    const percentLehrling = ratedCount > 0 ? Math.round((lehrlingCount / ratedCount) * 100) : 0;
    const percentGeselle = ratedCount > 0 ? Math.round((geselleCount / ratedCount) * 100) : 0;
    const percentMeister = ratedCount > 0 ? Math.round((meisterCount / ratedCount) * 100) : 0;

    return {
      subject: s,
      pupilStats,
      submittedCount,
      openCount,
      lehrlingCount,
      geselleCount,
      meisterCount,
      percentLehrling,
      percentGeselle,
      percentMeister,
    };
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      {/* Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[96vh] flex flex-col shadow-lg overflow-hidden print:m-0 print:p-0 print:border-none print:shadow-none print:bg-white print:max-h-none print:w-full print:max-w-none">
        {/* Modal Controls (Hidden in Print) */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-slate-50 text-sm">
              1-Seiten Lehrer-Export (Druckansicht Klasse {currentClass.name})
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow-md shadow-sm"
            >
              <Printer className="w-4 h-4" />
              <span>Drucken / Als PDF speichern</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 hover:bg-slate-700 transition"
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
                <span className="font-bold text-lg tracking-tight text-slate-950">SMILE</span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-300 font-bold text-slate-700">
                  MS Weissenbach
                </span>
                <span className="text-xs text-slate-500 font-medium">· Schuljahr 2026/27</span>
              </div>
              <h1 className="text-base font-bold uppercase tracking-wide text-slate-900 mt-1">
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

          {subjectReports.map((sr) => (
            <div key={sr.subject.code} className="mb-6">
              {/* Subject Section Title */}
              <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-300">
                <h2 className="text-sm font-bold text-slate-900">
                  {sr.subject.name} ({sr.subject.code})
                </h2>
                <span className="text-[11px] text-slate-600">
                  {sr.submittedCount} von {totalPupils} eingereicht
                </span>
              </div>

              {/* Summary Statistics for this subject */}
              <div className="bg-slate-50 border border-slate-300 rounded-xl p-2.5 mb-3">
                <div className="flex items-center justify-between text-[11px] mb-1.5 font-bold">
                  <span className="text-slate-800">
                    Statistik {sr.subject.name} ({totalPupils} Schüler*innen · {sr.submittedCount} eingereicht, {sr.openCount} offen)
                  </span>
                  <span className="text-slate-600 text-[10px]">
                    Stichtag Einreichung: 30.10.2026 23:59
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2">
                  <div className="bg-white border border-rose-200 rounded-lg p-1.5 shadow-sm">
                    <span className="text-[10px] uppercase font-bold text-rose-600 block">
                      <span className="inline-block w-2 h-2 rounded-full bg-rose-500 align-middle" /> Lehrling
                    </span>
                    <strong className="text-sm font-bold text-slate-900">{sr.lehrlingCount}</strong>
                    <span className="text-[10px] text-slate-500 ml-1">({sr.percentLehrling}%)</span>
                  </div>
                  <div className="bg-white border border-blue-200 rounded-lg p-1.5 shadow-sm">
                    <span className="text-[10px] uppercase font-bold text-blue-600 block">🔵 Geselle</span>
                    <strong className="text-sm font-bold text-slate-900">{sr.geselleCount}</strong>
                    <span className="text-[10px] text-slate-500 ml-1">({sr.percentGeselle}%)</span>
                  </div>
                  <div className="bg-white border border-amber-200 rounded-lg p-1.5 shadow-sm">
                    <span className="text-[10px] uppercase font-bold text-amber-600 block">
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-500 align-middle" /> Meister
                    </span>
                    <strong className="text-sm font-bold text-slate-900">{sr.meisterCount}</strong>
                    <span className="text-[10px] text-slate-500 ml-1">({sr.percentMeister}%)</span>
                  </div>
                </div>

                {/* Compact Color Balken */}
                <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex border border-slate-300">
                  {sr.percentLehrling > 0 && (
                    <div style={{ width: `${sr.percentLehrling}%` }} className="bg-rose-500 h-full" />
                  )}
                  {sr.percentGeselle > 0 && (
                    <div style={{ width: `${sr.percentGeselle}%` }} className="bg-blue-500 h-full" />
                  )}
                  {sr.percentMeister > 0 && (
                    <div style={{ width: `${sr.percentMeister}%` }} className="bg-amber-400 h-full" />
                  )}
                </div>
              </div>

              {/* Table of Pupils */}
              <table className="w-full text-left text-xs border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 text-[10px] uppercase border-b border-slate-300">
                    <th className="py-1 px-2 border-r border-slate-300 w-8 text-center">Nr.</th>
                    <th className="py-1 px-2 border-r border-slate-300 font-bold">Schüler*in</th>
                    <th className="py-1 px-2 border-r border-slate-300 w-24 text-center font-bold">Smileys</th>
                    <th className="py-1 px-2 border-r border-slate-300 w-28 text-center font-bold">Rangvorschlag</th>
                    <th className="py-1 px-2 border-r border-slate-300 w-28 text-center font-bold">Status</th>
                    <th className="py-1 px-2">Anmerkung / Nächster Schritt</th>
                  </tr>
                </thead>
                <tbody>
                  {sr.pupilStats.map((p) => {
                    let badgeClass = 'bg-slate-100 text-slate-700 border-slate-300';
                    if (p.rank === 'Meister') badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
                    else if (p.rank === 'Geselle') badgeClass = 'bg-blue-100 text-blue-800 border-blue-300';
                    else if (p.rank === 'Lehrling' && p.totalRated > 0) badgeClass = 'bg-rose-100 text-rose-800 border-rose-300';

                    return (
                      <tr key={p.id} className="border-b border-slate-200 hover:bg-slate-50/50">
                        <td className="py-1 px-2 border-r border-slate-200 text-center text-slate-500 text-[11px]">
                          {p.index}
                        </td>
                        <td className="py-1 px-2 border-r border-slate-200 font-bold text-slate-900 text-xs">
                          {p.fullName}
                        </td>
                        <td className="py-1 px-2 border-r border-slate-200 text-center font-semibold text-xs">
                          {p.positiveCount} / {rubricItemKeys.length}
                        </td>
                        <td className="py-1 px-2 border-r border-slate-200 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${badgeClass}`}>
                            {p.displayRank}
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
            </div>
          ))}

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
