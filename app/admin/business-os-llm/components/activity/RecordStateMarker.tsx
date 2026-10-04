/**
 * The record-state markers of one Activity row (FR-B1, AC-B17).
 *
 * Every state is TEXT, with an icon beside it; colour is never the only
 * carrier. B1a has two: priced from a fallback rate (no direction is claimed
 * until B2/B3 can read the measured price, OQ-13) and corrected (with the
 * correction's reason codes). B1b adds the audit-entry states.
 */

import { AlertTriangle, PencilLine } from 'lucide-react';

import { Chip } from '../Chip';
import { MARKER_CORRECTED, MARKER_FALLBACK, MARKER_NONE } from '../../activityCopy';
import type { ActivityRow } from '../../activityTypes';

export function RecordStateMarker({ row }: { row: ActivityRow }) {
  const markers: React.ReactNode[] = [];
  if (row.isFallbackPriced) {
    markers.push(
      <Chip key="fallback" tone="warn" testId="marker-fallback">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        {MARKER_FALLBACK}
      </Chip>
    );
  }
  if (row.corrected) {
    markers.push(
      <Chip key="corrected" tone="info" testId="marker-corrected">
        <PencilLine className="h-3 w-3" aria-hidden="true" />
        {MARKER_CORRECTED}
        {row.reasonCodes.length > 0 && <span className="font-mono font-normal">({row.reasonCodes.join(', ')})</span>}
      </Chip>
    );
  }
  if (markers.length === 0) {
    return (
      <span className="text-xs text-slate-500" data-testid="marker-none">
        {MARKER_NONE}
      </span>
    );
  }
  return <div className="flex flex-wrap gap-1">{markers}</div>;
}
