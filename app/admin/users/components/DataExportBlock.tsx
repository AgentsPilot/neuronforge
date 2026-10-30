'use client';

/**
 * The "Data export" section of the Businesses drawer (data export DE-10a;
 * export redesign MX-3.1, workplan §8; BQ-E6.1-1 answered 2026-10-27).
 *
 * MX-3.1 removed the admin ZIP (prepare, list and audited download) together
 * with the owner's ZIP. The user accepted the gap until MX-5, which brings
 * "Send export to owner". Until then this box stays where it is, above the
 * danger area, and says so in one line. It sends no request and reads nothing.
 *
 * `accountId` stays in the props because `BusinessDetail.tsx` mounts the box
 * as `<DataExportBlock key={user.id} accountId={user.id} />` (S-6, not edited
 * here). MX-5 uses it again for the owner the export is sent to.
 */

import { DATA_EXPORT_COPY } from '../dataExportCopy';
import { DrawerBox } from './DrawerBox';

interface Props {
  /** The account the drawer is open on. Unused until MX-5 ("Send export to owner"). */
  accountId: string;
}

export function DataExportBlock(_props: Props) {
  return (
    <DrawerBox section="export" title={DATA_EXPORT_COPY.title} testId="drawer-section-export">
      <div data-testid="data-export-block" className="space-y-2">
        <p data-testid="data-export-placeholder" className="text-sm text-slate-400">
          {DATA_EXPORT_COPY.placeholder}
        </p>
      </div>
    </DrawerBox>
  );
}
