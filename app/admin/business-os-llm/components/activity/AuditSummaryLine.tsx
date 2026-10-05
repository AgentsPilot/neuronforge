/**
 * The audit-join summary (B1b, FR-B5 question 1): how many of the ROWS SHOWN
 * have no audit entry, by class, and the "too recent" boundary in minutes
 * (OQ-5). The counts are over the page, never the window, and the label says
 * so. The archive cutoff is shown as a date (SA-CR-B-2). A failed or cut
 * audit read, or an unreadable archive cutoff, is named:
 * the rows it affects show "unknown", never "lost".
 */

import { FileSearch } from 'lucide-react';

import { formatCount } from '../../costFormat';
import { formatInstant } from '../../format';
import {
  AUDIT_ARCHIVE_CUTOFF_NOTE,
  AUDIT_ARCHIVE_FAILED,
  AUDIT_READ_FAILED,
  AUDIT_READ_INCOMPLETE,
  AUDIT_SETTLE_NOTE,
  AUDIT_SUMMARY_COUNTS,
  AUDIT_SUMMARY_LABEL,
} from '../../activityCopy';
import type { ActivityAuditSummary } from '../../activityTypes';

export function AuditSummaryLine({ audit, shown }: { audit: ActivityAuditSummary; shown: number }) {
  const c = audit.noEntry;
  const cutoff = formatInstant(audit.archiveCutoff);
  return (
    <div data-testid="activity-audit-summary" className="flex items-start gap-2 text-xs text-slate-400">
      <FileSearch className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p>
          <span className="font-medium text-slate-300">{AUDIT_SUMMARY_LABEL(formatCount(shown))}</span>{' '}
          <span data-testid="activity-audit-counts">
            {AUDIT_SUMMARY_COUNTS({
              lost: formatCount(c.lost),
              mayBeArchived: formatCount(c.mayBeArchived),
              tooRecent: formatCount(c.tooRecent),
              unknown: formatCount(c.unknown),
              accountMismatch: formatCount(c.accountMismatch),
            })}
          </span>
        </p>
        <p className="text-slate-500" data-testid="activity-audit-settle">
          {AUDIT_SETTLE_NOTE(audit.settleMinutes)}
        </p>
        {cutoff && (
          <p className="text-slate-500" data-testid="activity-audit-archive-cutoff">
            {AUDIT_ARCHIVE_CUTOFF_NOTE(cutoff)}
          </p>
        )}
        {audit.status === 'failed' && (
          <p className="text-amber-300" data-testid="activity-audit-failed">
            {AUDIT_READ_FAILED}
          </p>
        )}
        {audit.status === 'incomplete' && (
          <p className="text-amber-300" data-testid="activity-audit-incomplete">
            {AUDIT_READ_INCOMPLETE}
          </p>
        )}
        {audit.archive === 'failed' && (
          <p className="text-amber-300" data-testid="activity-audit-archive-failed">
            {AUDIT_ARCHIVE_FAILED}
          </p>
        )}
      </div>
    </div>
  );
}
