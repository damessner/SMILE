import React, { useState } from 'react';
import { UserPlus, Edit2, Archive, X, Check, AlertCircle } from 'lucide-react';
import { addPupil, updatePupil, archivePupil } from '../services/api';
import { PupilWithData, SchoolClass } from '../types';

interface PupilManagerModalProps {
  currentClass: SchoolClass;
  classes: SchoolClass[];
  pupils: PupilWithData[];
  onPupilsChanged: () => void;
  onClose: () => void;
}

export const PupilManagerModal: React.FC<PupilManagerModalProps> = ({
  currentClass,
  classes,
  pupils,
  onPupilsChanged,
  onClose,
}) => {
  const [newFullName, setNewFullName] = useState('');
  const [editingPupil, setEditingPupil] = useState<{ id: number; fullName: string; classId: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim()) return;
    setLoading(true);
    try {
      await addPupil(currentClass.id, newFullName.trim());
      setNewFullName('');
      onPupilsChanged();
    } catch (e: any) {
      alert(e.message || 'Hinzufügen fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingPupil) return;
    setLoading(true);
    try {
      await updatePupil(editingPupil.id, editingPupil.fullName, editingPupil.classId);
      setEditingPupil(null);
      onPupilsChanged();
    } catch (e: any) {
      alert(e.message || 'Bearbeiten fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async (id: number, name: string) => {
    if (!confirm(`Schüler/in "${name}" wirklich archivieren? (Historische Noten bleiben erhalten)`)) return;
    setLoading(true);
    try {
      await archivePupil(id);
      onPupilsChanged();
    } catch (e: any) {
      alert(e.message || 'Archivieren fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
          <div>
            <h3 className="text-xl font-bold text-white">Schülerverwaltung</h3>
            <p className="text-xs text-slate-400">Klasse {currentClass.name} · Schüler hinzufügen, bearbeiten oder archivieren</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Add Pupil Form */}
        <form onSubmit={handleAdd} className="flex gap-2 mb-6">
          <input
            type="text"
            required
            value={newFullName}
            onChange={(e) => setNewFullName(e.target.value)}
            placeholder="Neuer Schülername (z.B. Mustermann Max)"
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow"
          >
            <UserPlus className="w-4 h-4" />
            <span>Hinzufügen</span>
          </button>
        </form>

        {/* Pupil List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {pupils.map((p) => {
            const isEditing = editingPupil?.id === p.id;

            return (
              <div
                key={p.id}
                className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 text-sm"
              >
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1 mr-2">
                    <input
                      type="text"
                      value={editingPupil.fullName}
                      onChange={(e) => setEditingPupil({ ...editingPupil, fullName: e.target.value })}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-600 text-white text-xs"
                    />
                    <select
                      value={editingPupil.classId}
                      onChange={(e) => setEditingPupil({ ...editingPupil, classId: parseInt(e.target.value, 10) })}
                      className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-600 text-white text-xs"
                    >
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleUpdate}
                      className="p-1.5 rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingPupil(null)}
                      className="p-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-semibold text-white">{p.fullName}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingPupil({ id: p.id, fullName: p.fullName, classId: p.classId })}
                        title="Bearbeiten / Klasse wechseln"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleArchive(p.id, p.fullName)}
                        title="Archivieren (Soft-Delete)"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition"
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
