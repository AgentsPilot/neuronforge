'use client';

/**
 * The "Export data" entry when the module export is switched on (export
 * redesign MX-1b, workplan §9; BQ-E5-2). The same two looks as the ZIP control
 * (`row`: a settings row with a chevron, mirrored in RTL; `button`: a bordered
 * button), opening the export drawer.
 *
 * ⚠️ SA C-9 (MX-4 must-do): this entry renders NO ZIP status line. Once the
 * switch is on, an owner who still has a ready ZIP loses the only "Download
 * again" link to it, which breaks XC-15 ("ready ZIPs stay downloadable until
 * they expire"). MX-1b cannot reach that state (the switch is off and never on
 * in Preview). MX-4 must keep the ZIP status line here until the last ZIP
 * expires.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { useOptionalLanguage } from '@/lib/business-os/LanguageContext';
import { cn } from '@/lib/utils';
import type { ExportHistoryRequest } from '@/lib/client/businessOsDataExport';
import { ExportDrawer } from '@/components/business-os/data-export/ExportDrawer';
import { exportDrawerCopy } from '@/components/business-os/data-export/exportDrawerCopy';

export interface ModuleExportEntryProps {
  variant: 'row' | 'button';
  className?: string;
  initialHistory: ExportHistoryRequest[] | null;
  /** Open the drawer on mount: a click on the ZIP control turned out to need it. */
  isInitiallyOpen?: boolean;
}

export function ModuleExportEntry({ variant, className = '', initialHistory, isInitiallyOpen = false }: ModuleExportEntryProps) {
  const languageContext = useOptionalLanguage();
  const isRTL = languageContext?.isRTL ?? false;
  const copy = exportDrawerCopy(languageContext?.language);
  const [isOpen, setIsOpen] = useState(isInitiallyOpen);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // The request can arrive one render after the switch turned on (the click that waited on the probe).
  useEffect(() => {
    if (isInitiallyOpen) setIsOpen(true);
  }, [isInitiallyOpen]);

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
    <div className={`${variant === 'row' ? '' : 'space-y-2'} ${className}`.trim()} data-download-my-data={variant} data-module-export="on">
      {trigger}
      {/* Inside this tree on purpose: a nested Radix layer when the entry sits in a dialog (SR-9). */}
      <ExportDrawer open={isOpen} onOpenChange={setIsOpen} initialHistory={initialHistory} returnFocusRef={triggerRef} />
    </div>
  );
}

export default ModuleExportEntry;
