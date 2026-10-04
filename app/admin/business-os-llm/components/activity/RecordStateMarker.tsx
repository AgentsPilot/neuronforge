/**
 * The record-state markers of one Activity row (FR-B1, AC-B17).
 *
 * Every state is TEXT, with an icon beside it; colour is never the only
 * carrier. B1a has two: priced from a fallback rate (no direction is claimed
 * until B2/B3 can read the measured price, OQ-13) and corrected (with the
 * correction's reason codes). B1b adds the audit-entry states: no entry (too
 * recent, may be archived, lost), unknown (the evidence was incomplete, never
 * reported as lost) and an entry on another account (a defect marker).
 */

import { AlertTriangle, Archive, Clock, FileQuestionMark, FileX, PencilLine, ShieldAlert } from 'lucide-react';

import { Chip } from '../Chip';
import {
  ENTRY_UNKNOWN_REASONS,
  ENTRY_UNKNOWN_SHORT,
  MARKER_ACCOUNT_MISMATCH,
  MARKER_CORRECTED,
  MARKER_ENTRY_UNKNOWN,
  MARKER_FALLBACK,
  MARKER_LOST,
  MARKER_MAY_BE_ARCHIVED,
  MARKER_NONE,
  MARKER_TOO_RECENT,
} from '../../activityCopy';
import type { ActivityEntryState, ActivityRow } from '../../activityTypes';

function EntryMarker({ entry, settleMinutes }: { entry: ActivityEntryState; settleMinutes: number | null }) {
  switch (entry.state) {
    case 'found':
      return null;
    case 'too_recent':
      return (
        <Chip tone="quiet" testId="marker-entry-too-recent">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {MARKER_TOO_RECENT(settleMinutes)}
        </Chip>
      );
    case 'may_be_archived':
      return (
        <Chip tone="neutral" testId="marker-entry-may-be-archived">
          <Archive className="h-3 w-3" aria-hidden="true" />
          {MARKER_MAY_BE_ARCHIVED}
        </Chip>
      );
    case 'lost':
      return (
        <Chip tone="danger" testId="marker-entry-lost">
          <FileX className="h-3 w-3" aria-hidden="true" />
          {MARKER_LOST}
        </Chip>
      );
    case 'unknown':
      return (
        <Chip tone="warn" testId="marker-entry-unknown" title={ENTRY_UNKNOWN_REASONS[entry.reason]}>
          <FileQuestionMark className="h-3 w-3" aria-hidden="true" />
          {MARKER_ENTRY_UNKNOWN} — {ENTRY_UNKNOWN_SHORT[entry.reason]}
        </Chip>
      );
    case 'account_mismatch':
      return (
        <Chip tone="danger" testId="marker-entry-account-mismatch">
          <ShieldAlert className="h-3 w-3" aria-hidden="true" />
          {MARKER_ACCOUNT_MISMATCH}
        </Chip>
      );
  }
}

export function RecordStateMarker({ row, settleMinutes }: { row: ActivityRow; settleMinutes: number | null }) {
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
  if (row.entry.state !== 'found') {
    markers.push(<EntryMarker key="entry" entry={row.entry} settleMinutes={settleMinutes} />);
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
