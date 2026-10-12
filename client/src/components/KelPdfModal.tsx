import React from 'react';
import { Printer, X, Award, CheckCircle } from 'lucide-react';
import { PupilWithData, RubricCriterion } from '../types';
import { isSubjectMatch, scoreSubject } from '../lib/pupilItems';

interface KelPdfModalProps {
  pupil: PupilWithData;
  className: string;
  criteria: RubricCriterion[];
  subjects?: Array<{ code: string; name: string }>;
  roundName?: string;
  onClose: () => void;
}

export const KelPdfModal: React.FC<KelPdfModalProps> = ({
  pupil,
  className,
  criteria,
  subjects,
  roundName = 'Schuljahr 2026/27',
  onClose,
}) => {
  const rubricItemKeys = criteria.flatMap((c) => c.items.map((i) => i.key));

  const effectiveSubjects =
    subjects && subjects.length > 0
      ? subjects
      : Array.from(new Set(pupil.evaluations.map((e) => e.subjectCode))).map((code) => ({
          code,
          name: code,
        }));

  const subjectResults = effectiveSubjects.map((s) => {
    const scored = scoreSubject(pupil.evaluations, s.code, rubricItemKeys);
    const evalRecord = pupil.evaluations.find((e) => isSubjectMatch(e.subjectCode, s.code));

    let rankBadgeStyle = 'bg-slate-300 text-slate-700 font-bold';
    if (scored.rank === 'Meister') {
      rankBadgeStyle = 'bg-amber-400 text-slate-950 font-bold';
    } else if (scored.rank === 'Geselle') {
      rankBadgeStyle = 'bg-blue-500 text-slate-50 font-bold';
    } else if (scored.rank === 'Lehrling') {
      rankBadgeStyle = 'bg-rose-500 text-slate-50 font-bold';
    }

    return {
      subject: s,
      scored,
      rank: scored.rank ?? 'Ausstehend',
      rankBadgeStyle,
      evalRecord,
    };
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 print:p-0 print:bg-white print:static">
      {/* Control Header for Screen */}
      <div className="w-full max-w-3xl bg-white text-slate-900 rounded-3xl shadow-lg overflow-hidden print:shadow-none print:w-full print:max-w-none print:rounded-none">
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-slate-50 print:hidden">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-sm">KEL-Gespräch / Entwicklungsbericht Druckansicht</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow transition"
            >
              <Printer className="w-4 h-4" />
              <span>Drucken / PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-50 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable DIN A4 Document Content */}
        <div className="p-8 print:p-6 text-slate-800 text-sm">
          {/* Document Header */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4 mb-6">
            <div>
              <span className="text-xs uppercase font-extrabold tracking-wider text-slate-500">
                MS Weissenbach
              </span>
              <h1 className="text-2xl font-bold text-slate-900">SMILE Entwicklungsübersicht</h1>
              <p className="text-xs text-slate-600">Beobachtungsraster & KEL-Gesprächsbeiblatt · {roundName}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-500 block">Klasse: <b>{className}</b></span>
              <span className="text-xs text-slate-500 block">Datum: {new Date().toLocaleDateString('de-AT')}</span>
            </div>
          </div>

          {/* Pupil Info */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-200 mb-6">
            <div>
              <span className="text-xs uppercase font-bold text-slate-500">Schülerin / Schüler</span>
              <h2 className="text-xl font-bold text-slate-900">{pupil.fullName}</h2>
            </div>
            <div className="text-right">
              <span className="text-xs uppercase font-bold text-slate-500 block">Klasse {className}</span>
              <span className="text-xs text-slate-600 font-semibold">{subjectResults.map(s => `${s.subject.code}: ${s.rank}`).join(' · ')}</span>
            </div>
          </div>

          {/* Subject Sections */}
          {subjectResults.map((sr) => (
            <div key={sr.subject.code} className="mb-6 pb-6 border-b border-slate-200 last:border-b-0">
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-100 border border-slate-200 mb-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">Fach</span>
                  <h2 className="text-base font-bold text-slate-900">{sr.subject.name} ({sr.subject.code})</h2>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Status ({sr.scored.positiveCount}/{rubricItemKeys.length})</span>
                  <span className={`inline-block px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm ${sr.rankBadgeStyle}`}>
                    {sr.rank}
                  </span>
                </div>
              </div>

              {/* 6 Criteria Breakdown */}
              <div className="mb-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Beobachtungskriterien {sr.subject.name} (6 Dimensionen)
                </h3>
                <div className="grid grid-cols-2 gap-2.5">
                  {criteria.map((crit) => {
                    const critKeys = crit.items.map((i) => i.key);
                    const critScore = scoreSubject(pupil.evaluations, sr.subject.code, critKeys);
                    const pos = critScore.positiveCount;
                    const total = crit.items.length;
                    const isStrong = pos >= 2;

                    return (
                      <div
                        key={crit.id}
                        className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-xs text-slate-900 block">{crit.name}</span>
                          <span className="text-[11px] text-slate-500">
                            {pos} von {total} Merkmalen sicher erreicht
                          </span>
                        </div>
                        {isStrong ? (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                            Kompetent
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                            In Entwicklung
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Next Steps & Comments */}
              <div className="mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Vereinbarte Entwicklungsziele &amp; Nächste Schritte ({sr.subject.code})
                </h3>
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 min-h-[50px]">
                  <p className="text-xs text-slate-700 italic">
                    {sr.evalRecord?.nextStep ||
                      'Lernorganisation eigenständig vertiefen und gezielt Fragen bei Arbeitsaufträgen formulieren.'}
                  </p>
                </div>
              </div>
            </div>
          ))}

          {/* Signatures */}
          <div className="grid grid-cols-3 gap-8 pt-8 mt-6 border-t border-slate-300 text-center text-xs text-slate-500">
            <div>
              <div className="border-b border-slate-400 mb-1 h-8" />
              <span>Unterschrift Lehrperson</span>
            </div>
            <div>
              <div className="border-b border-slate-400 mb-1 h-8" />
              <span>Unterschrift Erziehungsberechtigte</span>
            </div>
            <div>
              <div className="border-b border-slate-400 mb-1 h-8" />
              <span>Unterschrift Schülerin / Schüler</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
