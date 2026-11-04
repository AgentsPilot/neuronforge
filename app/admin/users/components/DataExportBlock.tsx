'use client';

/**
 * The "Data export" section of the Businesses drawer (data export DE-10a;
 * export redesign MX-3.1, workplan §8; MX-5 "Send export to owner", workplan
 * §4.8; SA-Q6, SA-Q10).
 *
 * MX-5: one purpose line and one button that opens the send dialog. The box
 * itself SENDS NOTHING and READS NOTHING when the drawer opens (workplan
 * E-20): DELETE's drawer pin tests fix the exact list of requests one drawer
 * opening makes. The dialog (`DataExportSendDialog`) reads only when the admin
 * opens it.
 *
 * `accountId` comes from `BusinessDetail.tsx`, which mounts the box as
 * `<DataExportBlock key={user.id} accountId={user.id} />` (S-6, not edited
 * here): the owner the export is sent to.
 */

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import { DATA_EXPORT_COPY } from '../dataExportCopy';
import { DataExportSendDialog } from './DataExportSendDialog';
import { DrawerBox, PURPOSE_LINE } from './DrawerBox';

interface Props {
  /** The account the drawer is open on: the owner the export is sent to. */
  accountId: string;
}

export function DataExportBlock({ accountId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  // Focus goes back to the opener on close (the dialog is opened by state, not a Radix trigger).
  function onCloseAutoFocus(event: Event) {
    event.preventDefault();
    openerRef.current?.focus();
  }

  return (
    <DrawerBox section="export" title={DATA_EXPORT_COPY.title} testId="drawer-section-export">
      <div data-testid="data-export-block" className="space-y-2">
        <p data-testid="data-export-purpose" className={PURPOSE_LINE}>
          {DATA_EXPORT_COPY.purpose}
        </p>
        <Button
          ref={openerRef}
          type="button"
          variant="outline"
          size="sm"
          data-testid="data-export-send-open"
          onClick={() => setIsOpen(true)}
        >
          {DATA_EXPORT_COPY.open}
        </Button>
      </div>
      <DataExportSendDialog open={isOpen} onOpenChange={setIsOpen} accountId={accountId} onCloseAutoFocus={onCloseAutoFocus} />
    </DrawerBox>
  );
}
