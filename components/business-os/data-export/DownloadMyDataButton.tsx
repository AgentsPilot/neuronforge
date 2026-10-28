'use client';

/**
 * DownloadMyDataButton: the ONE export entry (data export DE-9; export redesign
 * MX-1b, workplan §9; SR-2, SR-9, XC-15; SA MX1B-1, C-1, C-12).
 *
 * Every entry point renders this and nothing else for the export:
 *
 *   - app/business-os/settings/page.tsx        variant="row"    (Security list)
 *   - components/business-os/purge/DangerZonePanel.tsx  variant="button" (Danger zone)
 *   - components/settings/SecurityTab.tsx      variant="button" (/settings)
 *   - components/v2/settings/SecurityTabV2.tsx variant="button" (/v2/settings)
 *   - DELETE's deletion drawer (DL-2)          variant="button"
 *
 * FROZEN (SR-2 / B.6): this name, this path, these props and the default
 * export stay as they are through MX-6. Only the inside changes.
 *
 * MX-1b: it is now a switch. It asks the module export route once on mount
 * (`useModuleExportSwitch`):
 *   - not yet known, or off, or unreachable → `ZipDownloadControl`, today's
 *     "Download my data" ZIP control, moved there byte for byte. While the
 *     answer is not yet known, a click waits for it, so a click never starts a
 *     ZIP while the switch is on;
 *   - on → `ModuleExportEntry` ("Export data"), which opens the export drawer.
 * With the switch off nothing the owner sees changes (AC MX-1b).
 */

import React, { useCallback, useState } from 'react';
import { ZipDownloadControl } from '@/components/business-os/data-export/ZipDownloadControl';
import { ModuleExportEntry } from '@/components/business-os/data-export/ModuleExportEntry';
import { useModuleExportSwitch } from '@/components/business-os/data-export/useModuleExportSwitch';

export interface DownloadMyDataButtonProps {
  /** `row`: a settings-list row (Business OS Security list). `button`: a bordered button. */
  variant: 'row' | 'button';
  className?: string;
}

export function DownloadMyDataButton({ variant, className = '' }: DownloadMyDataButtonProps) {
  const moduleExport = useModuleExportSwitch();
  // A click made before the probe answered, which found the switch on: open the drawer at once.
  const [isOpenRequested, setIsOpenRequested] = useState(false);
  const { whenKnown } = moduleExport;

  const takeOverIfOn = useCallback(async (): Promise<boolean> => {
    const state = await whenKnown();
    if (state === 'on') {
      setIsOpenRequested(true);
      return true;
    }
    return false;
  }, [whenKnown]);

  if (moduleExport.state === 'on') {
    return (
      <ModuleExportEntry
        variant={variant}
        className={className}
        initialHistory={moduleExport.history}
        isInitiallyOpen={isOpenRequested}
      />
    );
  }
  return (
    <ZipDownloadControl
      variant={variant}
      className={className}
      // Only while the answer is unknown: once it is known to be off, a click is today's click.
      onBeforePrepare={moduleExport.state === 'unknown' ? takeOverIfOn : undefined}
    />
  );
}

export default DownloadMyDataButton;
