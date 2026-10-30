'use client';

/**
 * DownloadMyDataButton: the ONE export entry (data export DE-9; export redesign
 * MX-1b, workplan §9; MX-3.1, workplan §7.1; SR-2, SR-9).
 *
 * Every entry point renders this and nothing else for the export:
 *
 *   - app/business-os/settings/page.tsx        variant="row"    (Security list)
 *   - components/business-os/purge/DangerZonePanel.tsx  variant="button" (Danger zone)
 *   - components/settings/SecurityTab.tsx      variant="button" (/settings)
 *   - components/v2/settings/SecurityTabV2.tsx variant="button" (/v2/settings)
 *   - DELETE's deletion and plan cancel drawers variant="button"
 *
 * FROZEN (SR-2 / B.6): this name, this path, these props and the default
 * export stay as they are through MX-7. Only the inside changes.
 *
 * MX-3.1 (user decision 2026-10-27): the export switch and the ZIP download
 * are gone. The button always reads "Export data" and opens the export drawer,
 * which reads its own history when it opens.
 */

import React from 'react';
import { ModuleExportEntry } from '@/components/business-os/data-export/ModuleExportEntry';

export interface DownloadMyDataButtonProps {
  /** `row`: a settings-list row (Business OS Security list). `button`: a bordered button. */
  variant: 'row' | 'button';
  className?: string;
}

export function DownloadMyDataButton({ variant, className = '' }: DownloadMyDataButtonProps) {
  return <ModuleExportEntry variant={variant} className={className} />;
}

export default DownloadMyDataButton;
