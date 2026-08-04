'use client';

import { useState, useEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { FileText, Check } from 'lucide-react';
import { CollapsibleSection } from '../CollapsibleSection';

interface NotesSectionProps {
  notes: string;
  onNotesChange: (notes: string) => void;
  t: (key: string) => string;
  isRTL: boolean;
  defaultOpen?: boolean;
}

export function NotesSection({
  notes,
  onNotesChange,
  t,
  isRTL,
  defaultOpen = false
}: NotesSectionProps) {
  const [localNotes, setLocalNotes] = useState(notes);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local state with props
  useEffect(() => {
    setLocalNotes(notes);
  }, [notes]);

  // Auto-save with debounce
  const handleNotesChange = (value: string) => {
    setLocalNotes(value);

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for auto-save
    saveTimeoutRef.current = setTimeout(() => {
      if (value !== notes) {
        setIsSaving(true);
        onNotesChange(value);

        // Show saved indicator
        setTimeout(() => {
          setIsSaving(false);
          setShowSaved(true);
          setTimeout(() => setShowSaved(false), 2000);
        }, 300);
      }
    }, 1000); // 1 second debounce
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Preview text for collapsed state
  const previewText = localNotes
    ? localNotes.slice(0, 100) + (localNotes.length > 100 ? '...' : '')
    : t('crm.drawer.no_notes');

  return (
    <CollapsibleSection
      title={t('crm.drawer.section_notes') || 'Notes'}
      icon={<FileText className="h-4 w-4" />}
      defaultOpen={defaultOpen}
      isRTL={isRTL}
      badge={
        (isSaving || showSaved) && (
          <span className="flex items-center gap-1 text-xs text-[var(--v2-text-muted)]">
            {isSaving ? (
              <span className="animate-pulse">{t('crm.drawer.saving') || 'Saving...'}</span>
            ) : (
              <>
                <Check className="h-3 w-3 text-green-500" />
                <span className="text-green-500">{t('crm.drawer.saved') || 'Saved'}</span>
              </>
            )}
          </span>
        )
      }
    >
      <div dir={isRTL ? 'rtl' : 'ltr'}>
        <Textarea
          value={localNotes}
          onChange={(e) => handleNotesChange(e.target.value)}
          placeholder={t('crm.drawer.notes_placeholder') || 'Add notes about this contact...'}
          className="min-h-[100px] bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] resize-y"
        />
        <p className="mt-2 text-xs text-[var(--v2-text-muted)]">
          {t('crm.drawer.notes_autosave_hint') || 'General notes about this contact. Auto-saves as you type. For timestamped entries, use the Activity section below.'}
        </p>
      </div>
    </CollapsibleSection>
  );
}
