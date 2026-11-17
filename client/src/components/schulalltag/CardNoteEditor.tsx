import React, { useEffect, useState } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import type { User } from '../../types';
import { updateCardNote } from '../../services/api';
import { useToast } from '../Toast';

export type EditableCardType = 'green' | 'yellow' | 'red' | 'cooldown';

/** Matches the server rule on PUT /api/cards/:id/note. */
export function canEditCardNote(
  card: { teacher_id?: number | null },
  user: User,
  isKv?: boolean,
): boolean {
  if (user.viewAs === true) return false;
  if (user.role === 'admin' || user.role === 'head_teacher' || isKv === true) {
    return true;
  }
  return user.teacherId != null && card.teacher_id != null && card.teacher_id === user.teacherId;
}

interface CardNoteEditorProps {
  cardId: string;
  cardType: EditableCardType;
  note?: string | null;
  canEdit: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (updatedNote: string | null) => Promise<void> | void;
  emptyLabel?: string;
}

/**
 * Shared inline note display & editor used on behaviour cards in Schulalltag and PupilProfileModal.
 */
export const CardNoteEditor: React.FC<CardNoteEditorProps> = ({
  cardId,
  cardType,
  note,
  canEdit,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaved,
  emptyLabel = '(Keine Notiz)',
}) => {
  const toast = useToast();
  const [draft, setDraft] = useState(note ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setDraft(note ?? '');
    }
  }, [isEditing, note]);

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (cardType === 'red' && !trimmed) {
      toast.error('Für eine Rote Karte ist eine Begründung / Vorfallsbeschreibung zwingend erforderlich.');
      return;
    }

    const nextNote = trimmed || null;
    setSaving(true);
    try {
      await updateCardNote(cardId, nextNote);
      await onSaved(nextNote);
      toast.success('Notiz gespeichert.');
    } catch (e: any) {
      toast.error(e.message || 'Notiz konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div
        className="mt-2 space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <textarea
          rows={2}
          maxLength={2000}
          autoFocus
          aria-label="Kartennotiz bearbeiten"
          placeholder={
            cardType === 'red'
              ? 'Begründung / Vorfallsbeschreibung (erforderlich)...'
              : 'Notiz hinzufügen oder ändern...'
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onCancelEdit();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSave();
            }
          }}
          disabled={saving}
          className="w-full rounded-xl border border-amber-500/40 bg-slate-900/90 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancelEdit}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-300 transition hover:bg-slate-700 disabled:opacity-50"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            <span>Abbrechen</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
          >
            <Check className="h-3 w-3" aria-hidden="true" />
            <span>{saving ? 'Speichere...' : 'Speichern'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      {note ? (
        <p className="text-slate-300 text-xs italic break-words">&bdquo;{note}&ldquo;</p>
      ) : (
        <p className="text-slate-500 text-[11px] italic">{emptyLabel}</p>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit();
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-amber-300 transition hover:border-amber-500/40 hover:bg-slate-800 hover:text-amber-200"
          title={note ? 'Notiz bearbeiten' : 'Notiz nachträglich hinzufügen'}
        >
          {note ? (
            <>
              <Pencil className="h-3 w-3" aria-hidden="true" />
              <span>Notiz ändern</span>
            </>
          ) : (
            <>
              <Plus className="h-3 w-3" aria-hidden="true" />
              <span>Notiz hinzufügen</span>
            </>
          )}
        </button>
      )}
    </div>
  );
};
