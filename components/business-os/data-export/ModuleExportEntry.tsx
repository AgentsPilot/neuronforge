'use client';

/**
 * The "Export data" entry (export redesign MX-1b, workplan §9; BQ-E5-2;
 * MX-3.1, workplan §7.2). Two looks (`row`: a settings row with a chevron,
 * mirrored in RTL; `button`: a bordered button), opening the export drawer.
 *
 * MX-3.1: the only export entry. There is no switch and no ZIP any more, so
 * the drawer reads its own history when it opens.
 */

import React, { useRef, useState } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { useOptionalLanguage } from '@/lib/business-os/LanguageContext';
import { cn } from '@/lib/utils';
import { ExportDrawer } from '@/components/business-os/data-export/ExportDrawer';
import { exportDrawerCopy } from '@/components/business-os/data-export/exportDrawerCopy';

export interface ModuleExportEntryProps {
  variant: 'row' | 'button';
  className?: string;
}

export function ModuleExportEntry({ variant, className = '' }: ModuleExportEntryProps) {
  const languageContext = useOptionalLanguage();
  const isRTL = languageContext?.isRTL ?? false;
  const copy = exportDrawerCopy(languageContext?.language);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const trigger =
    variant === 'row' ? (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
      >
        <span className="flex items-center gap-3">
          <Download className="w-5 h-5 text-[var(--v2-text-muted)]" aria-hidden="true" />
          <span className="text-sm text-[var(--v2-text-primary)]">{copy.entryLabel}</span>
        </span>
        <ChevronRight className={cn('w-4 h-4 text-[var(--v2-text-muted)]', isRTL && 'scale-x-[-1]')} aria-hidden="true" />
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--v2-border)] text-xs font-medium text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)]"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        {copy.entryLabel}
      </button>
    );

  return (
    <div className={`${variant === 'row' ? '' : 'space-y-2'} ${className}`.trim()} data-download-my-data={variant}>
      {trigger}
      {/* Inside this tree on purpose: a nested Radix layer when the entry sits in a dialog (SR-9). */}
      <ExportDrawer open={isOpen} onOpenChange={setIsOpen} returnFocusRef={triggerRef} />
    </div>
  );
}

export default ModuleExportEntry;
